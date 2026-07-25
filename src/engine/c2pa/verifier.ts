// Phase 16 / Plan 16-01 — PROV-V-07. Async verifier wrapping c2pa-node's
// createC2pa().read({asset}). Returns a VerificationReport (D-CTX-2 shape)
// suitable for the version.verify_manifest tool envelope.
//
// Architecture-purity:
//   - ZERO MCP imports
//   - ZERO SQLite-driver imports, ZERO ORM imports
//   - c2pa-node import is LAZY (Phase 14 Concern #11 pattern, mirror of signer.ts)
//
// Per D-CTX-7, the architecture-purity test (src/__tests__/architecture-purity.test.ts)
// is updated this plan to allow c2pa-node imports in signer.ts + exporter.ts +
// verifier.ts (the three engine modules that legitimately need the native binding —
// note exporter.ts itself does NOT import c2pa-node; the allowed-set merely
// reserves the slot for the wave).
//
// No re-signing happens here — Plan 16-02's redaction.ts handles the re-sign
// workflow. The verifier is read-only.
//
// Failure-mode discipline:
//   - c2pa-rs read() throws / returns null → signature_status='no_manifest'
//   - native binding load throws → signature_status='no_manifest' (graceful-fail)
//   - signingCredential.untrusted (D-PLAN-5):
//       VELLUM_C2PA_TRUST_DEV_CERT='1' → filtered (dev-mode); valid
//       otherwise → signature_status='untrusted_root' (production default)
//   - claimSignature.algorithmUnsupported → 'unsupported_algorithm'
//   - any other validation_status code → 'invalid'

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { TypedError } from '../errors.js';
import { routeFormat } from './format-router.js';
import type { ProvenanceRepo } from '../../store/provenance-repo.js';
import type { VersionRepo } from '../../store/version-repo.js';

/**
 * D-CTX-2 — VerificationReport shape. Locked at the engine boundary.
 * The tool envelope (Plan 16-03) spreads this verbatim into structuredContent.
 */
export interface VerificationReport {
  valid: boolean;
  signature_status:
    | 'valid'
    | 'invalid'
    | 'untrusted_root'
    | 'unsupported_algorithm'
    | 'no_manifest';
  matched_assertions: string[]; // labels of valid assertions, in manifest order
  gaps: string[]; // expected-but-missing assertions
  failures: Array<{ assertion: string; reason: string }>;
  cert_subject: string | null; // CN/O from cert OR engine-recorded summary
  signed_at: string | null; // ISO from manifest_signed event OR signature_info.time
}

/**
 * verifyManifest — discriminated input.
 *  - { versionId, versionRepo, provenanceRepo, outputsDir } — read disk bytes,
 *    infer mimeType via routeFormat, then call read(buffer) internally.
 *  - { manifestBytes, format } — direct buffer-mode verification (used by
 *    redaction tests + agent's pure-bytes verify path).
 */
export type VerifyManifestInput =
  | {
      versionId: string;
      versionRepo: Pick<VersionRepo, 'getVersion'>;
      provenanceRepo: Pick<ProvenanceRepo, 'getLatestManifestSignedEvent'>;
      outputsDir: string;
    }
  | {
      manifestBytes: Buffer;
      format: string;
    };

// D-PLAN-5 dev-acceptable codes (mirror Phase 14
// src/__tests__/c2pa-verification.test.ts:241-247). Filtered from
// validation_status BEFORE classification when
// VELLUM_C2PA_TRUST_DEV_CERT='1'.
const DEV_ACCEPTABLE_CODES: ReadonlySet<string> = new Set([
  'signingCredential.untrusted',
  'signingCredential.expired',
  'timeStamp.untrusted',
  'timeStamp.mismatch',
  'timeStamp.outsideValidity',
]);

const EXPECTED_ASSERTION_LABELS: readonly string[] = [
  'c2pa.actions',
  'vellum.input',
];

/**
 * Read + verify embedded manifest. Returns a VerificationReport — never
 * throws on c2pa-rs failures (those map to discriminated signature_status).
 * Throws only on TypedError surfaces (VERSION_NOT_FOUND, EXPORT_PATH_TRAVERSAL_REJECTED).
 */
export async function verifyManifest(
  input: VerifyManifestInput,
): Promise<VerificationReport> {
  // Branch 1: versionId form — resolve disk bytes + mimeType, then recurse
  // into Branch 2 with the buffer. We also surface signed_at + cert_subject
  // from the manifest_signed event so the report carries the engine's
  // recorded timestamp + cert summary (in addition to whatever c2pa-rs
  // surfaces from signature_info).
  if ('versionId' in input) {
    const { versionId, versionRepo, provenanceRepo, outputsDir } = input;
    const version = versionRepo.getVersion(versionId);
    if (!version) {
      throw new TypedError(
        'VERSION_NOT_FOUND',
        `Version '${versionId}' not found`,
      );
    }
    const filename = parsePrimaryOutputFilename(version.outputs_json);
    if (filename === null) {
      return makeNoManifestResult(null, null);
    }
    // Path-traversal guard (mirror exporter.ts).
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new TypedError(
        'EXPORT_PATH_TRAVERSAL_REJECTED',
        `Filename contains path-traversal characters: ${filename}`,
        `Filenames must be basenames (no /, \\, or .. components).`,
      );
    }
    const event = provenanceRepo.getLatestManifestSignedEvent(versionId, filename);
    if (event === null || event.signed === false) {
      return makeNoManifestResult(null, null);
    }
    const safeName = path.basename(filename);
    const fullPath = path.join(outputsDir, versionId, safeName);
    let bytes: Buffer;
    try {
      bytes = await readFile(fullPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return makeNoManifestResult(
          event.cert_subject_summary || null,
          event.signed_at,
        );
      }
      throw new TypedError(
        'INTERNAL_ERROR',
        `Failed to read manifest bytes: ${(err as Error).message}`,
      );
    }
    const route = routeFormat(filename);
    if (route.mode === 'unsupported' || !route.mimeType) {
      return makeNoManifestResult(
        event.cert_subject_summary || null,
        event.signed_at,
      );
    }
    const inner = await readAndClassify(bytes, route.mimeType);
    // Override signed_at + cert_subject with engine-recorded values when present.
    // (c2pa-rs's signature_info may not carry the signed_at we recorded; the
    //  engine's timestamp is authoritative for the dual-form report.)
    return {
      ...inner,
      signed_at: event.signed_at ?? inner.signed_at,
      cert_subject: event.cert_subject_summary || inner.cert_subject,
    };
  }

  // Branch 2: buffer form.
  return await readAndClassify(input.manifestBytes, input.format);
}

/**
 * Lazy-load c2pa-node + invoke read; classify into VerificationReport.
 *
 * Native binding load failure (Phase 14 Concern #11 mirror) and c2pa-rs read
 * exceptions BOTH degrade to 'no_manifest' — the verifier is read-only and
 * agents see a clean discriminated outcome rather than an opaque load error.
 */
async function readAndClassify(
  bytes: Buffer,
  mimeType: string,
): Promise<VerificationReport> {
  let c2paNode: typeof import('c2pa-node');
  try {
    c2paNode = await import('c2pa-node');
  } catch {
    // Native binding unavailable on host — surface as no_manifest so the
    // caller sees a clean signal rather than an opaque load error.
    return makeNoManifestResult(null, null);
  }
  const c2pa = c2paNode.createC2pa();
  let store: import('c2pa-node').ResolvedManifestStore | null = null;
  try {
    store = await c2pa.read({ buffer: bytes, mimeType });
  } catch {
    // Corrupt JUMBF / unparseable manifest — no_manifest.
    return makeNoManifestResult(null, null);
  }
  if (store === null || store.active_manifest === null) {
    return makeNoManifestResult(null, null);
  }
  const manifest = store.active_manifest;
  // c2pa-node's ValidationStatus has an `[property: string]: any` index
  // signature that bleeds implicit-any through every field access. We narrow
  // to a local minimal shape (code + url only — the two fields we read).
  type ValidationStatusMin = { code?: string | null; url?: string | null };
  const validationStatus: ValidationStatusMin[] =
    (store.validation_status ?? []) as ValidationStatusMin[];

  // D-PLAN-5: when VELLUM_C2PA_TRUST_DEV_CERT='1', the dev-acceptable
  // codes are filtered from validationStatus BEFORE classification.
  const trustDevCert = process.env.VELLUM_C2PA_TRUST_DEV_CERT === '1';
  const effectiveValidationStatus: ValidationStatusMin[] = trustDevCert
    ? validationStatus.filter((v: ValidationStatusMin) => !DEV_ACCEPTABLE_CODES.has(v.code ?? ''))
    : validationStatus;
  const signature_status = classifySignatureStatus(effectiveValidationStatus);

  // matched_assertions: ALL assertion labels whose validation_status doesn't
  // explicitly reference them as a failure. The order matches manifest order.
  const failureLabels = new Set<string>(
    effectiveValidationStatus
      .map((v: ValidationStatusMin) => (typeof v.url === 'string' ? v.url : ''))
      .filter((s: string) => s.length > 0),
  );
  type AssertionMin = { label?: string | null };
  const allLabels: string[] = ((manifest.assertions ?? []) as AssertionMin[])
    .map((a: AssertionMin) => a.label)
    .filter((s): s is string => typeof s === 'string');
  const matched_assertions = allLabels.filter((l: string) => !failureLabels.has(l));

  // gaps: labels expected in a Phase 14/15 manifest but missing from this one.
  const gaps = EXPECTED_ASSERTION_LABELS.filter((l) => !allLabels.includes(l));

  // failures: discrete entries from effectiveValidationStatus with assertion + reason.
  const failures = effectiveValidationStatus.map((v: ValidationStatusMin) => ({
    assertion: typeof v.url === 'string' && v.url.length > 0 ? v.url : 'unknown',
    reason: typeof v.code === 'string' && v.code.length > 0 ? v.code : 'unknown',
  }));

  // cert_subject: extract from signature_info.issuer if present.
  const cert_subject =
    manifest.signature_info && typeof manifest.signature_info.issuer === 'string'
      ? manifest.signature_info.issuer
      : null;
  // signed_at: signature_info.time if present (ISO).
  const signed_at =
    manifest.signature_info && typeof manifest.signature_info.time === 'string'
      ? manifest.signature_info.time
      : null;

  return {
    valid: signature_status === 'valid' && failures.length === 0,
    signature_status,
    matched_assertions,
    gaps,
    failures,
    cert_subject,
    signed_at,
  };
}

/**
 * Map c2pa-rs validation_status codes to the D-CTX-2 signature_status union.
 * Priority: untrusted_root > unsupported_algorithm > no_manifest > invalid > valid.
 * The first matching code wins (so e.g. an untrusted-root + dataHash-mismatch
 * report surfaces as 'untrusted_root' — the cert chain failure is upstream).
 *
 * D-PLAN-5: c2pa-rs uses `signingCredential.untrusted` (NOT
 * `claimSignature.untrusted`) — verified at
 * src/__tests__/c2pa-verification.test.ts:241-247.
 */
function classifySignatureStatus(
  vs: ReadonlyArray<{ code?: string | null; url?: string | null }>,
): VerificationReport['signature_status'] {
  const codes = vs.map((v) => v.code ?? '');
  if (codes.includes('signingCredential.untrusted')) return 'untrusted_root';
  if (codes.includes('claimSignature.algorithmUnsupported')) return 'unsupported_algorithm';
  if (codes.some((c) => c === 'claim.signatureMissing')) return 'no_manifest';
  if (codes.length > 0) return 'invalid'; // any other failure
  return 'valid';
}

function makeNoManifestResult(
  cert_subject: string | null,
  signed_at: string | null,
): VerificationReport {
  return {
    valid: false,
    signature_status: 'no_manifest',
    matched_assertions: [],
    gaps: [],
    failures: [],
    cert_subject,
    signed_at,
  };
}

function parsePrimaryOutputFilename(outputsJson: string | null): string | null {
  if (!outputsJson) return null;
  try {
    const parsed = JSON.parse(outputsJson) as Array<{ filename?: string }>;
    if (!Array.isArray(parsed)) return null;
    const filename = parsed[0]?.filename;
    return typeof filename === 'string' && filename.length > 0 ? filename : null;
  } catch {
    return null;
  }
}
