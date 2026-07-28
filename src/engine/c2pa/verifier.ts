// Async verifier wrapping c2pa-node's
// createC2pa().read({asset}). Returns a VerificationReport
// suitable for the version.verify_manifest tool envelope.
//
// Architecture-purity:
//   - ZERO MCP imports
//   - ZERO SQLite-driver imports, ZERO ORM imports
//   - c2pa-node import is LAZY (mirror of signer.ts)
//
// The architecture-purity test (src/__tests__/architecture-purity.test.ts)
// allows c2pa-node imports in signer.ts + exporter.ts +
// verifier.ts (the three engine modules that legitimately need the native binding —
// note exporter.ts itself does NOT import c2pa-node; the allowed-set merely
// reserves the slot).
//
// No re-signing happens here — redaction.ts handles the re-sign
// workflow. The verifier is read-only.
//
// Failure-mode discipline:
//   - c2pa-rs read() throws / returns null → signature_status='no_manifest'
//   - native binding load throws → signature_status='no_manifest' (graceful-fail)
//   - signingCredential.untrusted:
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
 * VerificationReport shape. Locked at the engine boundary.
 * The tool envelope spreads this verbatim into structuredContent.
 */
export interface VerificationReport {
  valid: boolean;
  signature_status:
    | 'valid'
    | 'invalid'
    | 'untrusted_root'
    | 'unsupported_algorithm'
    | 'no_manifest';
  /**
   * ALWAYS false on c2pa-node 0.5.26: the binding exposes no trust-root
   * configuration, so no chain-to-root evaluation happens. `valid: true`
   * means the manifest is cryptographically intact and binds to these
   * bytes — a well-formed chain from ANY CA reports valid, including one
   * minted seconds ago. Stated in the report because the alternative is a
   * caller believing trust was checked when it never was.
   */
  trust_evaluated: false;
  /**
   * Validation codes suppressed by VELLUM_C2PA_TRUST_DEV_CERT='1' before
   * classification (e.g. signingCredential.untrusted for a self-signed dev
   * cert). Empty when the override is off or nothing was filtered. Surfaced
   * so a dev-trusted `valid: true` is distinguishable from a clean one.
   */
  dev_trust_overrides: string[];
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

// Dev-acceptable codes (mirror
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

/** c2pa-rs reads the actions assertion back as `c2pa.actions.v2`; the
 *  write side (and EXPECTED_ASSERTION_LABELS) use the bare literal. */
function normalizeActionsLabel(label: string): string {
  return label === 'c2pa.actions.v2' ? 'c2pa.actions' : label;
}

/**
 * validation_status entries reference assertions by JUMBF URI, e.g.
 * `self#jumbf=c2pa.assertions/c2pa.hash.data`. The assertion label is the
 * last path segment; null when the entry carries no usable URI.
 */
function labelFromValidationUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  const lastSegment = url.slice(url.lastIndexOf('/') + 1);
  return lastSegment.length > 0 ? normalizeActionsLabel(lastSegment) : null;
}

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
 * Native binding load failure (mirror of signer.ts) and c2pa-rs read
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

  // When VELLUM_C2PA_TRUST_DEV_CERT='1', the dev-acceptable
  // codes are filtered from validationStatus BEFORE classification. The
  // suppressed codes are carried into the report (dev_trust_overrides) so
  // a dev-trusted `valid` is distinguishable from a clean one.
  const trustDevCert = process.env.VELLUM_C2PA_TRUST_DEV_CERT === '1';
  const dev_trust_overrides: string[] = trustDevCert
    ? validationStatus
        .map((v: ValidationStatusMin) => v.code ?? '')
        .filter((c: string) => DEV_ACCEPTABLE_CODES.has(c))
    : [];
  const effectiveValidationStatus: ValidationStatusMin[] = trustDevCert
    ? validationStatus.filter((v: ValidationStatusMin) => !DEV_ACCEPTABLE_CODES.has(v.code ?? ''))
    : validationStatus;
  const signature_status = classifySignatureStatus(effectiveValidationStatus);

  // matched_assertions: ALL assertion labels whose validation_status doesn't
  // reference them as a failure. validation_status entries carry JUMBF URIs
  // ("self#jumbf=c2pa.assertions/c2pa.hash.data"), not bare labels — the
  // previous direct comparison could never match, so matched_assertions
  // could never shrink and a tampered asset reported every assertion as
  // matched alongside its dataHash.mismatch failure. Extract the label as
  // the URI's last path segment.
  const failureLabels = new Set<string>(
    effectiveValidationStatus
      .map((v: ValidationStatusMin) => labelFromValidationUrl(v.url))
      .filter((s): s is string => s !== null),
  );
  type AssertionMin = { label?: string | null };
  // c2pa-rs writes the actions assertion back as `c2pa.actions.v2`;
  // normalize to the write-side literal (same normalization the redaction
  // path applies) or Vellum reports a gap of `c2pa.actions` on every asset
  // it signed itself.
  const allLabels: string[] = ((manifest.assertions ?? []) as AssertionMin[])
    .map((a: AssertionMin) => a.label)
    .filter((s): s is string => typeof s === 'string')
    .map(normalizeActionsLabel);
  const matched_assertions = allLabels.filter((l: string) => !failureLabels.has(l));

  // gaps: labels expected in a Vellum-signed manifest but missing from this one.
  const gaps = EXPECTED_ASSERTION_LABELS.filter((l) => !allLabels.includes(l));

  // failures: discrete entries from effectiveValidationStatus with assertion + reason.
  // Same label extraction as failureLabels above, so the failing assertion is
  // reported as its label ('c2pa.hash.data'), not a raw JUMBF URI.
  const failures = effectiveValidationStatus.map((v: ValidationStatusMin) => ({
    assertion: labelFromValidationUrl(v.url) ?? 'unknown',
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
    trust_evaluated: false,
    dev_trust_overrides,
    matched_assertions,
    gaps,
    failures,
    cert_subject,
    signed_at,
  };
}

/**
 * Map c2pa-rs validation_status codes to the signature_status union.
 * Priority: untrusted_root > unsupported_algorithm > no_manifest > invalid > valid.
 * The first matching code wins (so e.g. an untrusted-root + dataHash-mismatch
 * report surfaces as 'untrusted_root' — the cert chain failure is upstream).
 *
 * c2pa-rs uses `signingCredential.untrusted` (NOT
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
    trust_evaluated: false,
    dev_trust_overrides: [],
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
