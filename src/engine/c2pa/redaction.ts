// Phase 16 / Plan 16-02 — PROV-V-06. Redaction primitive: strip named
// fields from a manifest JSON, emit a vendor-namespaced
// vfx_familiar.redacted assertion (D-CTX-1) preserving the FACT of
// redaction (NOT the original values), then re-sign the asset bytes
// with the same cert (Phase 14 D-CTX-2 single-cert config).
//
// Architecture-purity:
//   - PURE helpers (this file's first 4 exports) have ZERO external imports
//     except TypedError + the manifest-builder type surface
//   - The integration helper (redactManifestForVersionImpl, Task 2) uses
//     LAZY native-binding loading via dynamic import — same discipline as
//     signer.ts (see signer.ts ensureC2paNode pattern for reference)
//
// D-CTX-1: the vfx_familiar.redacted assertion shape mirrors Phase 15's
//   vfx_familiar.input pattern: {label: 'vfx_familiar.redacted',
//   data: {redacted_fields: string[], redacted_at: ISO8601}}. Original
//   values appear NOWHERE in the redacted MANIFEST JSON output — this is
//   a structural invariant tested at every layer (helper, integration,
//   E2E in Plan 16-05).
//
// D-CTX-1 SCOPE LIMITATION (C-01 fix): redaction operates on the C2PA
// ACTIVE manifest's JSON ONLY. The following are UNCHANGED by this primitive:
//   - ASSET BINARY: PNG tEXt/iTXt chunks, EXIF, ICC profile metadata, ID3
//     tags, video container metadata, pixel data itself.
//   - PARENT MANIFEST CHAIN: when c2pa-rs re-signs an asset that already
//     has an embedded manifest, it automatically promotes the previous
//     manifest to a `parent_relationship` ingredient inside the new active
//     manifest so the audit chain remains traversable. The PARENT's
//     pre-redaction values are still embedded inside the JUMBF chain.
//     Verifiers reading the ACTIVE manifest see redacted values; verifiers
//     traversing the parent chain see the originals.
//
// Callers requiring asset-binary scrubbing (e.g. removing prompt text
// embedded in PNG tEXt chunks by an external tool) MUST use a separate
// asset-scrubbing tool BEFORE calling redact_manifest. Callers requiring
// parent-chain scrubbing must use the c2pa-rs manifest-removal API
// directly (out of scope for v1.1; tracked deferred-items.md as a v1.2
// follow-up if surfaced by a caller).
//
// The redaction primitive's contract is bounded to the ACTIVE manifest:
//   (a) the active_manifest fields show redacted values
//   (b) a vfx_familiar.redacted assertion is appended
//   (c) the redaction policy paths actually applied are recorded
// Tests at the helper layer verify the manifest-JSON invariant via a
// multi-encoding scan; tests at the integration layer verify the
// active-manifest invariant via c2pa.read on the re-signed bytes.
//
// D-CTX-8: redaction policy DSL is bounded:
//   - max 32 entries per policy
//   - max 64 dotted/bracketed segments per entry
//   - REJECT `..`, regex metacharacters, unmatched brackets
//   - paths not present in the manifest surface as `not_found:<path>`
//     in the result (NOT errors)

import { TypedError } from '../errors.js';
import type { ManifestDefinition, ManifestAssertion } from './manifest-builder.js';

/** Sentinel value substituted for redacted leaf values. The literal string
 *  '[REDACTED]' is chosen so any caller that string-greps the redacted
 *  manifest sees an unambiguous redaction marker. */
const REDACTED_SENTINEL = '[REDACTED]';

/** Policy-entry caps per D-CTX-8 / D-PLAN-2-5. Surfaced via REDACT_POLICY_INVALID. */
const MAX_POLICY_ENTRIES = 32;
const MAX_PATH_SEGMENTS = 64;

/** C-05: Combined depth cap — segments + manifest data depth. Bounds
 *  worst-case recursion against pathological policies + nested data. */
const MAX_WALK_DEPTH = 32;

/** Output of applyRedactionPolicy — the helper that does the actual stripping. */
export interface RedactionApplied {
  /** Manifest JSON with redacted fields replaced by REDACTED_SENTINEL +
   *  vfx_familiar.redacted assertion appended to assertions[]. */
  redactedJson: ManifestDefinition;
  /** Policy paths that matched at least one location in the manifest. */
  redactedFields: string[];
  /** Policy paths that did NOT match any location in the manifest
   *  (soft warnings — surfaced to the caller, not thrown). */
  notFound: string[];
}

/** End-to-end redaction outcome (returned by Engine.redactManifestForVersion). */
export interface RedactionResult {
  /** The newly re-signed asset bytes (with the redacted manifest embedded). */
  redactedBytes: Buffer;
  /** Policy paths actually applied. Subset of input policy. */
  redactedFields: string[];
  /** Policy paths that did not match — soft warnings. */
  notFound: string[];
  /** ISO-8601 — emitted into the vfx_familiar.redacted assertion AND
   *  recorded on the new manifest_signed event. */
  signedAt: string;
  /** MIME type of the redacted asset (mirror of the original). */
  format: string;
  /** Cert subject DN (RFC4514 — same as original). */
  certSubject: string;
}

/**
 * Pure helper: apply a redaction policy to a manifest JSON object.
 * Throws TypedError REDACT_POLICY_INVALID on any bounded-resolver violation.
 * Returns RedactionApplied with redactedJson + the matched/not-found split.
 *
 * The original JSON is NOT mutated (deep clone via structuredClone before edits).
 */
export function applyRedactionPolicy(
  manifestJson: ManifestDefinition,
  policy: readonly string[],
  now: () => string = () => new Date().toISOString(),
): RedactionApplied {
  validatePolicy(policy);

  // Deep clone — original input MUST NOT be mutated (test 14 idempotency
  // depends on this; structuredClone is V8 native + deep-copies arrays/objects).
  const json: ManifestDefinition = structuredClone(manifestJson);
  const redactedFields: string[] = [];
  const notFound: string[] = [];

  for (const entry of policy) {
    const matched = applyOneRedactionPath(json, entry);
    if (matched) {
      redactedFields.push(entry);
    } else {
      notFound.push(entry);
    }
  }

  // Append vfx_familiar.redacted assertion (D-CTX-1).
  // Even when redactedFields is empty (every path was not_found), we still
  // append the assertion so the audit trail records that a redaction was
  // attempted; Plan 16-04's tool layer surfaces this as a soft warning.
  const redactedAssertion: ManifestAssertion = {
    label: 'vfx_familiar.redacted',
    data: {
      redacted_fields: [...redactedFields],
      redacted_at: now(),
    },
  };
  json.assertions = [...(json.assertions ?? []), redactedAssertion];

  return { redactedJson: json, redactedFields, notFound };
}

/**
 * Pure helper: build a fresh ManifestDefinition wrapping the redacted JSON.
 * The redaction call site (integration helper, Task 2) uses this to produce
 * the input to signer.signEmbedBufferWithIngredients. The result intentionally
 * matches the BuildManifestResult shape EXCEPT that ingredientSpecs is empty
 * — D-PLAN-2-3 ingredient pass-through is handled at the integration layer
 * by reading the parent manifest's c2pa-node ingredient graph and threading
 * it through the BuildManifestResult.ingredientSpecs slot directly (NOT here).
 */
export function buildRedactedManifestDefinition(
  redactedJson: ManifestDefinition,
): ManifestDefinition {
  return {
    claim_generator: redactedJson.claim_generator,
    format: redactedJson.format,
    title: redactedJson.title,
    assertions: [...(redactedJson.assertions ?? [])],
  };
}

/** Validate the policy: caps + character allowlist. Throws REDACT_POLICY_INVALID. */
function validatePolicy(policy: readonly string[]): void {
  if (!Array.isArray(policy) || policy.length === 0) {
    throw new TypedError(
      'REDACT_POLICY_INVALID',
      'Redaction policy must be a non-empty array of dotted paths',
      'Provide at least one path entry, e.g., ["assertions[*].data.prompt_positive"].',
    );
  }
  if (policy.length > MAX_POLICY_ENTRIES) {
    throw new TypedError(
      'REDACT_POLICY_INVALID',
      `Redaction policy exceeds ${MAX_POLICY_ENTRIES} entries (got ${policy.length})`,
      `Cap at ${MAX_POLICY_ENTRIES} entries to bound resolver work.`,
    );
  }
  for (const entry of policy) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new TypedError(
        'REDACT_POLICY_INVALID',
        `Redaction policy entry must be a non-empty string (got ${typeof entry})`,
      );
    }
    // C-05 hardening: reject NUL bytes, Unicode bidi overrides, CR/LF, % < > ;
    // BEFORE the traversal/regex checks. These chars have no legitimate
    // place in a structural path DSL.
    // Bidi overrides (Trojan-Source class — codepoint ranges U+202A-U+202E + U+2066-U+2069):
    //   LRE/RLE/PDF + LRI/RLI/FSI/PDI.
    // eslint-disable-next-line no-control-regex
    const FORBIDDEN_CHARS_RE = new RegExp("[\u0000\r\n\u202A-\u202E\u2066-\u2069%<>;]");
    if (FORBIDDEN_CHARS_RE.test(entry)) {
      throw new TypedError(
        'REDACT_POLICY_INVALID',
        `Redaction policy entry contains forbidden control / bidi / HTML metacharacter: ${JSON.stringify(entry)}`,
        'Reject NUL, CR/LF, Unicode bidi overrides (U+202A-U+202E, U+2066-U+2069), %, <, >, ;.',
      );
    }
    // C-05 hardening: cap label-value length inside [label='X'] to 256 chars.
    const labelMatch = entry.match(/\[label\s*=\s*['"]([^'"]+)['"]\]/);
    if (labelMatch && labelMatch[1]!.length > 256) {
      throw new TypedError(
        'REDACT_POLICY_INVALID',
        `Redaction policy [label='X'] value exceeds 256 chars (got ${labelMatch[1]!.length})`,
      );
    }
    if (entry.includes('..')) {
      throw new TypedError(
        'REDACT_POLICY_INVALID',
        `Redaction policy entry contains '..' traversal segment: ${entry}`,
        'Path-traversal-style segments are rejected.',
      );
    }
    // Reject regex metacharacters (the resolver is literal-only).
    // '*' is allowed only inside [*]; reject otherwise.
    // Strategy: strip out the only legitimate occurrence of '*' (the [*]
    // wildcard), then if any '*' remains, that's a regex/glob attempt.
    if (/[\\^$+?(){}|]/.test(entry)) {
      throw new TypedError(
        'REDACT_POLICY_INVALID',
        `Redaction policy entry contains regex/glob metacharacters: ${entry}`,
        "Only literal segments + label='value' filters + [*] wildcards are supported.",
      );
    }
    const withoutWildcards = entry.replace(/\[\*\]/g, '');
    if (withoutWildcards.includes('*')) {
      throw new TypedError(
        'REDACT_POLICY_INVALID',
        `Redaction policy entry contains '*' outside the [*] wildcard syntax: ${entry}`,
        "Only literal segments + label='value' filters + [*] wildcards are supported.",
      );
    }
    // Unmatched square brackets.
    const opens = (entry.match(/\[/g) ?? []).length;
    const closes = (entry.match(/\]/g) ?? []).length;
    if (opens !== closes) {
      throw new TypedError(
        'REDACT_POLICY_INVALID',
        `Redaction policy entry has unmatched square brackets: ${entry}`,
      );
    }
    // Segment cap — split on dots, count each segment.
    const segCount = parsePathSegments(entry).length;
    if (segCount > MAX_PATH_SEGMENTS) {
      throw new TypedError(
        'REDACT_POLICY_INVALID',
        `Redaction policy entry exceeds ${MAX_PATH_SEGMENTS} segments (got ${segCount}): ${entry}`,
      );
    }
  }
}

/** Discriminated path segment representation. */
type PathSegment =
  | { kind: 'key'; key: string }
  | { kind: 'wildcard' }
  | { kind: 'label'; label: string };

/**
 * Parse a path entry into segments. Entry forms:
 *   - 'foo'                          -> [{key: 'foo'}]
 *   - 'foo.bar'                      -> [{key: 'foo'}, {key: 'bar'}]
 *   - 'arr[*].data.x'                -> [{key:'arr'},{wildcard},{key:'data'},{key:'x'}]
 *   - "assertions[label='X'].data.y" -> [{key:'assertions'},{label:'X'},{key:'data'},{key:'y'}]
 */
function parsePathSegments(entry: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let i = 0;
  while (i < entry.length) {
    // Skip leading dot (between key and key).
    if (entry[i] === '.') { i++; continue; }
    // Bracket: [*] or [label='X']
    if (entry[i] === '[') {
      const close = entry.indexOf(']', i + 1);
      if (close < 0) {
        // Already validated by validatePolicy, but defence-in-depth.
        throw new TypedError('REDACT_POLICY_INVALID', `Unmatched [ in path: ${entry}`);
      }
      const inside = entry.slice(i + 1, close);
      if (inside === '*') {
        segments.push({ kind: 'wildcard' });
      } else {
        // label='X' or label="X"
        const m = inside.match(/^label\s*=\s*['"]([^'"]+)['"]$/);
        if (!m) {
          throw new TypedError(
            'REDACT_POLICY_INVALID',
            `Unsupported bracket form (only [*] or [label='X'] allowed): ${entry}`,
          );
        }
        segments.push({ kind: 'label', label: m[1]! });
      }
      i = close + 1;
      continue;
    }
    // Plain key — read until next '.' or '['.
    const stopRel = entry.slice(i).search(/[.[]/);
    const stop = stopRel < 0 ? entry.length : i + stopRel;
    const key = entry.slice(i, stop);
    if (key.length === 0) {
      throw new TypedError('REDACT_POLICY_INVALID', `Empty key segment in path: ${entry}`);
    }
    segments.push({ kind: 'key', key });
    i = stop;
  }
  return segments;
}

/**
 * Apply ONE policy path to the JSON. Returns true if at least one location
 * was redacted; false if the path did not match anywhere (caller surfaces
 * as not_found).
 *
 * Recursively walks the segments. At leaf, replaces the value with the
 * REDACTED_SENTINEL string. For arrays-of-strings, replaces each element
 * with the sentinel.
 */
function applyOneRedactionPath(json: ManifestDefinition, path: string): boolean {
  const segments = parsePathSegments(path);
  return walkAndRedact(json as unknown as Record<string, unknown>, segments, 0);
}

function walkAndRedact(
  node: unknown,
  segments: readonly PathSegment[],
  idx: number,
  depth: number = 0,
): boolean {
  // C-05: depth guard — combined policy segments + manifest data nesting.
  if (depth > MAX_WALK_DEPTH) {
    throw new TypedError(
      'REDACT_POLICY_INVALID',
      `walkAndRedact exceeded MAX_WALK_DEPTH=${MAX_WALK_DEPTH} — combined policy + manifest depth too deep`,
    );
  }
  if (idx >= segments.length) {
    // We should never recurse past the final segment without redacting
    // — the leaf-handling lives in the parent recursion frame.
    return false;
  }
  const seg = segments[idx]!;
  const isLeaf = idx === segments.length - 1;

  if (seg.kind === 'key') {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return false;
    const obj = node as Record<string, unknown>;
    if (!(seg.key in obj)) return false;
    if (isLeaf) {
      obj[seg.key] = redactValue(obj[seg.key]);
      return true;
    }
    return walkAndRedact(obj[seg.key], segments, idx + 1, depth + 1);
  }

  if (seg.kind === 'wildcard') {
    if (!Array.isArray(node)) return false;
    let any = false;
    for (let i = 0; i < node.length; i++) {
      if (isLeaf) {
        node[i] = redactValue(node[i]);
        any = true;
      } else {
        if (walkAndRedact(node[i], segments, idx + 1, depth + 1)) any = true;
      }
    }
    return any;
  }

  // seg.kind === 'label'
  if (!Array.isArray(node)) return false;
  let any = false;
  for (let i = 0; i < node.length; i++) {
    const elem = node[i];
    if (elem === null || typeof elem !== 'object' || Array.isArray(elem)) continue;
    const labelVal = (elem as Record<string, unknown>).label;
    if (typeof labelVal !== 'string' || labelVal !== seg.label) continue;
    if (isLeaf) {
      node[i] = redactValue(elem);
      any = true;
    } else {
      if (walkAndRedact(elem, segments, idx + 1, depth + 1)) any = true;
    }
  }
  return any;
}

/** Replace any value with the redaction sentinel. C-01 fix: recursive
 *  walk that DESCENDS into nested objects/arrays preserving STRUCTURE
 *  (downstream type-narrowing relies on object/array shape) but replaces
 *  every LEAF (string / number / boolean / null) with the sentinel.
 *  Original-value leakage is structurally impossible — every primitive
 *  becomes the sentinel string; container shapes survive. */
function redactValue(v: unknown): unknown {
  // Leaf — primitive or null/undefined → sentinel.
  if (v === null || v === undefined) return REDACTED_SENTINEL;
  if (typeof v !== 'object') return REDACTED_SENTINEL;
  // Array — recurse element-wise, preserve length.
  if (Array.isArray(v)) return v.map((e) => redactValue(e));
  // Object — recurse entry-wise, preserve keys.
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, vv]) => [k, redactValue(vv)]),
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Integration helper — uses native binding (lazy import).
// ──────────────────────────────────────────────────────────────────────────
// This section uses `await import('c2pa-node')` (lazy) to read the parent
// manifest JSON, then routes through signEmbedBufferWithIngredients /
// signEmbedFileWithIngredients to re-sign with the same cert.

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { ProvenanceRepo } from '../../store/provenance-repo.js';
import type { VersionRepo } from '../../store/version-repo.js';
import type { ManifestSignedPayloadFields } from '../../types/provenance.js';
import type { LoadedSigner } from './signer.js';
import { routeFormat } from './format-router.js';
import {
  signEmbedBufferWithIngredients,
  signEmbedFileWithIngredients,
} from './signer.js';
import type { BuildManifestResult, IngredientSpec } from './manifest-builder.js';

/** Function-shape of the per-version mutex acquire (compound key versionId+filename).
 *  Engine owns the Map<string, Promise<unknown>> + acquire/release; this
 *  helper takes the bound acquire callback so the engine can keep the Map
 *  encapsulated. */
export type AssetWriterAcquire = <T>(
  versionId: string,
  filename: string,
  task: () => Promise<T>,
) => Promise<T>;

/** Phase 17 / Plan 17-03 (D-05) — function-shape of the engine's thumbnail
 *  invalidation callback. Called AFTER the atomicRename inside the try block
 *  (NOT before — calling before creates a stale-cache window when the rewrite
 *  fails). Engine.invalidateThumbnail is idempotent (best-effort unlink of
 *  cache + sentinel) so a no-op call is safe.
 *
 *  Structural callback rather than a hard import on the Engine class —
 *  keeps the c2pa → engine boundary composition-friendly (mirrors the
 *  AssetWriterAcquire shape). */
export type ThumbnailInvalidate = (
  versionId: string,
  filename: string,
) => Promise<void>;

/** Lazy native-binding module + load-error caching (mirror signer.ts pattern). */
let c2paNodeModule: typeof import('c2pa-node') | null = null;
let c2paNodeLoadError: Error | null = null;

async function ensureC2paNode(): Promise<typeof import('c2pa-node')> {
  if (c2paNodeModule !== null) return c2paNodeModule;
  if (c2paNodeLoadError !== null) {
    throw new TypedError(
      'REDACT_PARENT_UNREADABLE',
      `Native binding unavailable: ${c2paNodeLoadError.message}`,
      'Verify c2pa-node prebuilds installed for this platform.',
    );
  }
  try {
    c2paNodeModule = await import('c2pa-node');
    return c2paNodeModule;
  } catch (err) {
    c2paNodeLoadError = err as Error;
    throw new TypedError(
      'REDACT_PARENT_UNREADABLE',
      `Native binding unavailable: ${(err as Error).message}`,
    );
  }
}

/** Test-only reset for vi.mock interactions. */
export function __resetRedactionStateForTests(): void {
  c2paNodeModule = null;
  c2paNodeLoadError = null;
}

/** Project the c2pa-rs `ResolvedManifest.assertions` into our ManifestAssertion
 *  union (Phase 16 / D-CTX-1 + C-03). c2pa-rs renames `c2pa.actions` →
 *  `c2pa.actions.v2` on read (the actions-v2 spec rev). On write, our
 *  manifest-builder emits the shorter `c2pa.actions` literal (Phase 14
 *  CreatedActionAssertion union). When redaction reads-back native-binding
 *  output and re-builds a ManifestDefinition, unmapped labels would fail
 *  validation downstream. Normalize:
 *    - 'c2pa.actions.v2' → 'c2pa.actions' (write-side label)
 *  AND validate against KNOWN_LABELS — unknown labels are dropped (real-world
 *  c2pa-rs may emit additional standard assertions like c2pa.hash.data that
 *  we don't redact AND don't need to round-trip into the re-build pipeline;
 *  c2pa-rs re-computes them at sign time).
 *  Replaces the unsafe `as ManifestAssertion` cast with proper validation. */
const KNOWN_ASSERTION_LABELS: ReadonlySet<string> = new Set([
  'c2pa.actions',
  'vfx_familiar.input',
  'vfx_familiar.unavailable_ingredient',
  'vfx_familiar.redacted',
]);

export function extractAssertions(
  manifest: import('c2pa-node').ResolvedManifest,
): ManifestAssertion[] {
  const out = manifest.assertions ?? [];
  const normalized: ManifestAssertion[] = [];
  for (const a of out) {
    if (typeof a.label !== 'string') continue;
    // C-03: normalize the v2 label to the write-side literal.
    const label = a.label === 'c2pa.actions.v2' ? 'c2pa.actions' : a.label;
    if (!KNOWN_ASSERTION_LABELS.has(label)) {
      // Unknown label — drop rather than pass through unsafely.
      continue;
    }
    // Reconstruct with the normalized label; preserve data verbatim.
    // The cast is safe because label is a known literal.
    normalized.push({ label, data: a.data } as ManifestAssertion);
  }
  return normalized;
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

/**
 * Engine-side integration entry point. Reads the parent's signed bytes,
 * extracts the parent manifest JSON via c2pa.read, applies the redaction
 * policy via applyRedactionPolicy, re-signs via the SAME signer Phase 14
 * loaded (signer arg below; engine threads it through), and appends a NEW
 * manifest_signed event with redacted=true.
 *
 * D-PLAN-2-1: same cert chain (signer is the loaded LoadedSigner from
 *   the engine's first signOutput call; redaction does NOT load a new one).
 * D-PLAN-2-2: signer.algorithm is reused as-is.
 * D-PLAN-2-3: ingredientSpecs is empty for the redacted manifest — the
 *   parent's ingredient graph is structurally separate from assertions[].
 *   Re-signing with a NEW manifest definition (just the redacted assertions)
 *   emits a fresh manifest. v1.2 may extend ingredientSpecs to mirror
 *   parent.ingredients[].
 *
 * Per-(versionId, filename) UNIFIED `assetWriterMutex` (D-PLAN-2-4 / C-04):
 * the engine wraps the entire redaction flow so concurrent signOutput +
 * redactManifestForVersion calls on the same (versionId, filename) serialize
 * with FIFO semantics (NOT coalescing).
 *
 * Disk write is ATOMIC (C-04): `redactedBytes` written to a temp path then
 * `fs.rename` to the original output path; on rename failure the temp is
 * cleaned up + the original file is unchanged. After atomic write, the
 * audit row is appended via appendManifestSignedRedactedEvent (C-06: if the
 * insert fails, REDACT_DB_WRITE_FAILED surfaces — disk has been overwritten
 * but the caller knows the audit row is missing).
 *
 * @throws TypedError REDACT_NO_MANIFEST when no signed manifest_signed event exists
 * @throws TypedError REDACT_PARENT_UNREADABLE when c2pa.read fails on the parent bytes
 * @throws TypedError REDACT_POLICY_INVALID when applyRedactionPolicy rejects the policy
 * @throws TypedError REDACT_DB_WRITE_FAILED when atomic write or audit-row insert fails
 * @throws TypedError VERSION_NOT_FOUND when the version row does not exist
 * @throws TypedError EXPORT_PATH_TRAVERSAL_REJECTED when filename has traversal chars
 */
export async function redactManifestForVersionImpl(
  versionId: string,
  redactionPolicy: readonly string[],
  versionRepo: Pick<VersionRepo, 'getVersion'>,
  provenanceRepo: Pick<
    ProvenanceRepo,
    'getLatestManifestSignedEvent' | 'appendManifestSignedRedactedEvent'
  >,
  outputsDir: string,
  signer: LoadedSigner,
  assetWriterAcquire: AssetWriterAcquire,
  // Phase 17 / Plan 17-03 (D-05) — optional callback invoked AFTER atomicRename
  // succeeds. Engine binds engine.invalidateThumbnail; tests pass a stub or
  // omit (defaults to a no-op). Failures inside the callback are NON-FATAL
  // (try/catch swallow + console.warn) so the redact success path is preserved.
  thumbnailInvalidate: ThumbnailInvalidate = async () => { /* no-op default */ },
  now: () => string = () => new Date().toISOString(),
): Promise<RedactionResult> {
  const version = versionRepo.getVersion(versionId);
  if (!version) {
    throw new TypedError(
      'VERSION_NOT_FOUND',
      `Version '${versionId}' not found`,
      'Confirm the version_id matches an existing version row.',
    );
  }

  const filename = parsePrimaryOutputFilename(version.outputs_json);
  if (filename === null) {
    throw new TypedError(
      'REDACT_NO_MANIFEST',
      `Version '${versionId}' has no output filename to redact`,
      'Redaction requires a signed output. Submit + complete the version, then retry.',
    );
  }

  // Path-traversal guard.
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new TypedError(
      'EXPORT_PATH_TRAVERSAL_REJECTED',
      `Filename contains path-traversal characters: ${filename}`,
    );
  }

  return await assetWriterAcquire(versionId, filename, async () => {
    const event = provenanceRepo.getLatestManifestSignedEvent(versionId, filename);
    if (event === null) {
      throw new TypedError(
        'REDACT_NO_MANIFEST',
        `No manifest_signed event for version '${versionId}' / filename '${filename}'`,
        'Sign the version first via the download path, then retry redaction.',
      );
    }
    if (event.signed === false) {
      throw new TypedError(
        'REDACT_NO_MANIFEST',
        `Latest manifest_signed event for '${versionId}' is unsigned (status_reason='${event.status_reason}')`,
        'Cannot redact an unsigned manifest. Configure c2pa signing and re-download.',
      );
    }

    const safeName = path.basename(filename);
    const fullPath = path.join(outputsDir, versionId, safeName);
    const resolvedRoot = path.resolve(outputsDir);
    const resolvedFull = path.resolve(fullPath);
    if (
      !resolvedFull.startsWith(resolvedRoot + path.sep) &&
      resolvedFull !== resolvedRoot
    ) {
      throw new TypedError(
        'EXPORT_PATH_TRAVERSAL_REJECTED',
        `Resolved path escapes outputsDir: ${fullPath}`,
      );
    }

    let parentBytes: Buffer;
    try {
      parentBytes = await readFile(fullPath);
    } catch (err) {
      throw new TypedError(
        'REDACT_PARENT_UNREADABLE',
        `Failed to read parent asset bytes: ${(err as Error).message}`,
        'The signed asset must exist on disk for redaction to read its embedded manifest.',
      );
    }

    const route = routeFormat(filename);
    if (route.mode === 'unsupported' || !route.mimeType) {
      throw new TypedError(
        'REDACT_PARENT_UNREADABLE',
        `Format unsupported for redaction: ${filename} (mode=${route.mode})`,
        'Redaction requires a c2pa-supported format (PNG/JPEG/MP4/WebP/TIFF).',
      );
    }

    // Read the parent manifest JSON via the native binding.
    const c2paNode = await ensureC2paNode();
    const c2pa = c2paNode.createC2pa();
    let store: import('c2pa-node').ResolvedManifestStore | null = null;
    try {
      store = await c2pa.read({
        buffer: parentBytes,
        mimeType: route.mimeType,
      });
    } catch (err) {
      throw new TypedError(
        'REDACT_PARENT_UNREADABLE',
        `c2pa.read failed on parent asset: ${(err as Error).message}`,
        'Parent manifest could not be parsed. Verify the asset has a valid embedded manifest.',
      );
    }
    if (store === null || store.active_manifest === null) {
      throw new TypedError(
        'REDACT_PARENT_UNREADABLE',
        'Parent asset has no active manifest to redact',
        'The asset must contain a signed C2PA manifest before redaction.',
      );
    }

    // Project the active_manifest into a ManifestDefinition shape suitable
    // for the redaction helper. We carry forward only the fields the
    // redaction policy can reach: claim_generator, format, title,
    // assertions[]. Ingredient relationships are NOT redacted here
    // (D-PLAN-2-3 deferred-ingredient-mirror).
    const parentDef: ManifestDefinition = {
      claim_generator:
        typeof store.active_manifest.claim_generator === 'string'
          ? store.active_manifest.claim_generator
          : '',
      format:
        typeof store.active_manifest.format === 'string'
          ? store.active_manifest.format
          : route.mimeType,
      title:
        typeof store.active_manifest.title === 'string'
          ? store.active_manifest.title
          : `Version ${versionId}`,
      assertions: extractAssertions(store.active_manifest),
    };

    // Apply the policy.
    const applied = applyRedactionPolicy(parentDef, redactionPolicy, now);
    const redactedDef = buildRedactedManifestDefinition(applied.redactedJson);

    // Build a BuildManifestResult with empty ingredientSpecs (D-PLAN-2-3
    // v1.1 — ingredient graph not re-mirrored; tracked deferred).
    const buildResult: BuildManifestResult = {
      definition: redactedDef,
      ingredientSpecs: [] as IngredientSpec[],
    };

    // Re-sign via the format-router dispatch (mirror Engine.signOutput).
    let redactedBytes: Buffer;
    if (route.mode === 'embed-buffer') {
      redactedBytes = await signEmbedBufferWithIngredients(
        parentBytes,
        route.mimeType,
        buildResult,
        signer,
      );
    } else {
      // embed-file mode — sign through the file API. Write parent to temp,
      // sign to dest temp, read dest into Buffer.
      const { writeFile, rm, mkdtemp } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const tmp = await mkdtemp(path.join(tmpdir(), 'redact-'));
      const srcPath = path.join(tmp, `src${path.extname(filename)}`);
      const destPath = path.join(tmp, `dest${path.extname(filename)}`);
      try {
        await writeFile(srcPath, parentBytes);
        await signEmbedFileWithIngredients(
          srcPath,
          destPath,
          route.mimeType,
          buildResult,
          signer,
        );
        redactedBytes = await readFile(destPath);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    }

    const signedAt = now();

    // C-04 fix: ATOMIC disk write of redactedBytes to the version's
    // primary output path. Without this, the disk file remains the ORIGINAL
    // signed bytes — a subsequent verify_manifest by versionId would verify
    // STALE original bytes. The write is atomic via temp + rename.
    const {
      writeFile: atomicWriteFile,
      rename: atomicRename,
      unlink: atomicUnlink,
    } = await import('node:fs/promises');
    const { nanoid: nanoidFn } = await import('nanoid');
    const tempPathFresh = `${fullPath}.redact-tmp-${nanoidFn()}`;
    try {
      await atomicWriteFile(tempPathFresh, redactedBytes);
      await atomicRename(tempPathFresh, fullPath);
      // Phase 17 / Plan 17-03 (D-05) — invalidate thumbnail cache AFTER the
      // rewrite lands. Idempotent unlink of <fullPath>.thumb.webp +
      // <fullPath>.thumb.failed via the engine's invalidateCache delegate.
      // Per Pattern 7: ordering is critical — invalidating BEFORE the rename
      // creates a stale-cache window if the rename fails. Calling AFTER ensures
      // invalidation only happens for actually-rewritten bytes.
      try {
        await thumbnailInvalidate(versionId, filename);
      } catch (err) {
        // Non-fatal — the redact succeeded; a stale thumb at worst returns one
        // outdated 304 until the user navigates away. Log + continue so the
        // append-only manifest_signed event still emits below.
        console.warn(
          `vfx-familiar: thumb invalidate after redact failed (versionId=${versionId}, filename=${filename}): ${(err as Error).message}`,
        );
      }
    } catch (err) {
      // Best-effort cleanup of temp file on failure.
      try { await atomicUnlink(tempPathFresh); } catch { /* ignore */ }
      throw new TypedError(
        'REDACT_DB_WRITE_FAILED',
        `Atomic disk overwrite failed: ${(err as Error).message}`,
        'The redacted bytes were re-signed in memory but could not be persisted to disk. The original signed file remains intact.',
      );
    }

    // Append NEW manifest_signed event with redacted=true.
    // D-PLAN-2-5 (Plan 16-02): the audit row's redacted_fields surfaces BOTH
    // matched paths (verbatim) AND not-found paths (prefixed `not_found:`) so
    // the trail records every redaction *attempt*. Without the not_found
    // entries, an "all paths missed" redaction would write an event row with
    // an empty redacted_fields[] — indistinguishable from a successful redact
    // of zero fields. The prefix preserves the soft-warning semantic at the
    // audit boundary; programmatic readers can still split on the prefix.
    const auditRedactedFields: string[] = [
      ...applied.redactedFields,
      ...applied.notFound.map((p) => `not_found:${p}`),
    ];
    const newPayload: ManifestSignedPayloadFields = {
      filename,
      format: route.mimeType,
      signed: true,
      cert_subject_summary: signer.certSubjectSummary,
      signed_at: signedAt,
      status_reason: '',
      algorithm: String(signer.algorithm),
      redacted: true,
      redacted_fields: auditRedactedFields,
    };
    // C-06 fix: if the DB insert throws, do NOT return RedactionResult
    // (caller would believe redaction succeeded but no audit row exists).
    try {
      provenanceRepo.appendManifestSignedRedactedEvent(versionId, newPayload);
    } catch (err) {
      throw new TypedError(
        'REDACT_DB_WRITE_FAILED',
        `appendManifestSignedRedactedEvent failed: ${(err as Error).message}`,
        'The redacted bytes were written to disk but the audit row could not be appended. Inspect the provenance table; the next redact_manifest call will append a new row over the same disk state.',
      );
    }

    return {
      redactedBytes,
      redactedFields: applied.redactedFields,
      notFound: applied.notFound,
      signedAt,
      format: route.mimeType,
      certSubject: signer.certSubjectSummary,
    };
  });
}
