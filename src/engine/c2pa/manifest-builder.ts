// Phase 14 — PROV-V-02 (D-CTX-4). Pure manifest-definition builder.
//
// Returns a c2pa-node-compatible ManifestBuilder input describing a single
// `c2pa.created` assertion that names ComfyUI as the software agent and the
// primary workflow model in the action's parameters.description.
//
// D-CTX-4 contract: ONLY the c2pa.created assertion. The ingredient graph
// (parentOf / componentOf / inputTo) lands in Phase 15.
//
// T-14-05 mitigation: parameters.description carries model NAMES (basename
// of the model file path as the prompt blob recorded it), not absolute
// filesystem paths.
//
// Architecture-purity: zero external imports — pure-function module. zero
// MCP / DB / ORM / HTTP / c2pa-node imports. The output shape matches what
// `new ManifestBuilder(def)` accepts in the signer module.

/**
 * Inputs to buildManifestDefinition. All fields are required (use null for
 * absent values where the contract permits) — there is no implicit default.
 */
export interface BuildManifestOptions {
  /** Engine-assigned version id (e.g., `ver_abc123`). Drives the `title`. */
  versionId: string;
  /**
   * MIME type of the asset being signed (e.g., `image/png`, `video/mp4`).
   * Format-router supplies this; the manifest's `format` field mirrors it.
   */
  mimeType: string;
  /**
   * Primary workflow model. NULL when no models were recorded on the
   * `completed` event (e.g., text-only workflows or pre-Phase-13 versions).
   */
  primaryModel: PrimaryModel | null;
  /**
   * ComfyUI server version captured from `/api/system_stats` at submit time.
   * NULL when not yet captured (rare). Mirrored into `softwareAgent.version`.
   */
  comfyuiVersion: string | null;
  /** Local app version (read from package.json by the caller). */
  appVersion: string;
}

/**
 * Discriminated union — primary model is either fingerprinted (hash present)
 * OR has a typed `unavailable` reason (Phase 13 D-CTX-5 reason codes).
 */
export type PrimaryModel =
  | { name: string; hash: string }
  | { name: string; hash: null; unavailable: string };

/**
 * Verbatim shape consumed by c2pa-node's ManifestBuilder constructor. Plain
 * JSON-serializable object — no class instances, no Buffers, no Promises.
 *
 * NOTE: c2pa-node's ManifestDefinition type accepts additional optional
 * fields (vendor, label, claim_generator_info, etc.) that v1.1 does not
 * populate. The narrower shape declared here is a safe SUBTYPE — passing it
 * to `new ManifestBuilder(def as never)` in the signer module is sound.
 */
export interface ManifestDefinition {
  claim_generator: string;
  format: string;
  title: string;
  assertions: Array<{
    label: 'c2pa.actions';
    data: {
      actions: Array<{
        action: 'c2pa.created';
        digitalSourceType: string;
        softwareAgent: { name: string; version: string | null };
        parameters: { description: string };
      }>;
    };
  }>;
}

/**
 * Pinned native binding version — locked by Plan 14-01's exact pin in
 * package.json. Surfaces in claim_generator for verifier introspection.
 */
const C2PA_NODE_VERSION = '0.5.26';

/** IPTC-registered URI for AI-generated/algorithmic media (D-CTX-4). */
const IPTC_TRAINED_ALGORITHMIC_MEDIA =
  'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

/**
 * Pure builder — synchronous, no I/O, no async, no calls to c2pa-node.
 * Returns a plain object suitable for `new ManifestBuilder(def)` in the
 * signer module. Calling twice with deeply-equal inputs returns deeply-
 * equal (but NOT identical-reference) outputs.
 */
export function buildManifestDefinition(opts: BuildManifestOptions): ManifestDefinition {
  const description = describePrimaryModel(opts.primaryModel);
  return {
    claim_generator: `vfx-familiar/${opts.appVersion} c2pa-node/${C2PA_NODE_VERSION}`,
    format: opts.mimeType,
    title: `Version ${opts.versionId}`,
    assertions: [
      {
        label: 'c2pa.actions',
        data: {
          actions: [
            {
              action: 'c2pa.created',
              digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA,
              softwareAgent: { name: 'ComfyUI', version: opts.comfyuiVersion },
              parameters: { description },
            },
          ],
        },
      },
    ],
  };
}

/**
 * T-14-05 mitigation: emits `model=BASENAME; hash=HEXHASH` OR
 * `model=BASENAME; hash_unavailable=REASON` OR
 * `model=unknown; hash_unavailable=no_models_recorded`.
 *
 * Caller is responsible for passing a basename (Phase 13 / D-PROV-06 already
 * extracts basenames into models_json). This helper does not strip slashes —
 * callers must not pass absolute paths.
 */
function describePrimaryModel(m: PrimaryModel | null): string {
  if (m === null) return 'model=unknown; hash_unavailable=no_models_recorded';
  if (m.hash === null) return `model=${m.name}; hash_unavailable=${m.unavailable}`;
  return `model=${m.name}; hash=${m.hash}`;
}
