// Phase 14 — PROV-V-02 (D-CTX-4). Pure manifest-definition builder.
//
// Returns a native-binding-compatible ManifestBuilder input describing a single
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
// Architecture-purity: zero external imports at runtime — pure-function module.
// zero MCP / DB / ORM / HTTP / native-c2pa-binding imports. The output shape
// matches what `new ManifestBuilder(def)` accepts in the signer module.
//
// Phase 15 / Plan 15-02 (D-CTX-3) — additive surface:
//   - buildManifestWithIngredients(opts): BuildManifestResult — produces a
//     clean ManifestDefinition (no ingredients field; matches the native
//     binding's BaseManifestDefinition shape) + IngredientSpec[] for the
//     impure signer to drive through createIngredient + addIngredient at
//     sign time.
//   - The Phase 14 buildManifestDefinition entry point is UNCHANGED — legacy
//     callers compile + execute byte-equal. Only the assertions[] union is
//     broadened to a SUPERTYPE; the Phase 14 c2pa.actions shape narrows in.
//   - vfx_familiar.input + vfx_familiar.unavailable_ingredient are vendor-
//     namespaced custom assertions emitted via assertions[] (legitimate use
//     of the array — c2pa.ingredient is NOT in the union: ingredients flow
//     through manifestBuilder.addIngredient at the impure layer).
//
// Type-only import below is erased at runtime — preserves architecture-purity
// grep gates that scan for the native-binding / SQLite-driver / ORM packages.
import type {
  ParentIngredient,
  ComponentIngredient,
  InputAssertion,
} from './ingredient-extractor.js';

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
 * Verbatim shape consumed by the native binding's ManifestBuilder constructor.
 * Plain JSON-serializable object — no class instances, no Buffers, no Promises.
 *
 * NOTE: The native binding's ManifestDefinition type accepts additional
 * optional fields (vendor, label, claim_generator_info, etc.) that v1.1 does
 * not populate. The narrower shape declared here is a safe SUBTYPE — passing
 * it to `new ManifestBuilder(def as never)` in the signer module is sound.
 *
 * Phase 15 broadening: assertions[] became a union (ManifestAssertion) so the
 * Phase 14 c2pa.actions shape COEXISTS with the new vendor assertions. Phase
 * 14's literal narrows in (CreatedActionAssertion is a member of the union),
 * so legacy code compiles byte-unchanged.
 */
export interface ManifestDefinition {
  claim_generator: string;
  format: string;
  title: string;
  assertions: ManifestAssertion[];
}

/**
 * Phase 15 / Plan 15-02 — discriminated union over the assertion labels v1.1
 * emits in the pure manifest definition. NOTE: c2pa.ingredient is NOT in this
 * union — ingredients flow through the native binding's manifestBuilder.addIngredient
 * call at the impure signer (Plan 15-03), NOT through assertions[]. The
 * BaseManifestDefinition shape the binding's ManifestBuilder constructor accepts
 * deliberately excludes the `ingredients` field for that reason.
 *
 * Phase 16 / Plan 16-02 (D-CTX-1) — extended with VendorRedactedAssertion. The
 * `vfx_familiar.redacted` assertion preserves the FACT of redaction without
 * the original values. Original values appear NOWHERE in the redacted manifest
 * JSON output — this is a structural invariant tested at every layer
 * (helper, integration, E2E in Plan 16-05).
 */
export type ManifestAssertion =
  | CreatedActionAssertion
  | VendorInputAssertion
  | VendorUnavailableIngredientAssertion
  | VendorRedactedAssertion;

/**
 * Phase 14 c2pa.actions assertion carrying the c2pa.created action — ComfyUI
 * software agent + AI-origin digitalSourceType + primary-model description.
 */
export interface CreatedActionAssertion {
  label: 'c2pa.actions';
  data: {
    actions: Array<{
      action: 'c2pa.created';
      digitalSourceType: string;
      softwareAgent: { name: string; version: string | null };
      parameters: { description: string };
    }>;
  };
}

/**
 * Phase 15 — vendor-namespaced custom assertion carrying the structured input
 * payload (prompt text + sampler params + seed). T-15-01 mitigation: the data
 * shape is the InputAssertion type from Plan 15-01 (capped, structured) — never
 * the workflow_json verbatim.
 */
export interface VendorInputAssertion {
  label: 'vfx_familiar.input';
  data: InputAssertion;
}

/**
 * Phase 15 — vendor-namespaced custom assertion recording an ingredient whose
 * bytes were unreachable at sign time. ROADMAP criterion #5 requires the
 * dangling reference to be recorded (NOT silently dropped). Since the native
 * binding's createIngredient REQUIRES asset bytes (no API exists to construct
 * an ingredient from a precomputed hash alone), unreachable specs cannot land
 * as c2pa.ingredient entries — instead we surface them via this vendor
 * assertion so an independent C2PA reader sees what was attempted.
 */
export interface VendorUnavailableIngredientAssertion {
  label: 'vfx_familiar.unavailable_ingredient';
  data: {
    relationship: 'parentOf' | 'componentOf';
    title: string;
    /**
     * Phase 15 reason codes:
     *  - 'file_not_found'           — ENOENT (no file at the resolved path).
     *  - 'file_unreadable'          — non-ENOENT fs error (perm / I/O).
     *  - 'parent_manifest_pending'  — parent has no manifest_signed event yet.
     *  - 'mime_type_unsupported'    — file exists but routeFormat returns no
     *    mimeType (extension absent from format-router's tables). Phase 15
     *    WR-02 fix — pre-fix this fell through to 'application/octet-stream'
     *    which c2pa-rs rejects in createIngredient. Now we route it to
     *    unavailable so the manifest still signs cleanly with a clear audit.
     */
    reason: 'file_not_found' | 'file_unreadable' | 'parent_manifest_pending' | 'mime_type_unsupported';
    metadata: Record<string, string | number | null>;
  };
}

/**
 * Phase 16 / Plan 16-02 (D-CTX-1) — vendor-namespaced assertion that
 * preserves the FACT of redaction without the original values. data
 * carries the policy paths actually applied (`redacted_fields`) and an
 * ISO timestamp (`redacted_at`). Original VALUES appear nowhere.
 *
 * D-CTX-1 SCOPE LIMITATION (C-01): redaction operates on the C2PA MANIFEST
 * JSON ONLY. The ASSET BINARY (PNG tEXt/iTXt chunks, EXIF, ICC profile
 * metadata, ID3 tags, video container metadata, pixel data itself) is
 * UNCHANGED by this primitive. Callers requiring asset-binary scrubbing
 * must use a separate asset-scrubbing tool BEFORE calling redact_manifest.
 */
export interface VendorRedactedAssertion {
  label: 'vfx_familiar.redacted';
  data: {
    redacted_fields: string[];
    redacted_at: string;
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Phase 15 / Plan 15-02 — buildManifestWithIngredients additive surface.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Phase 15 (D-CTX-3) — input shape for buildManifestWithIngredients. Extends
 * BuildManifestOptions with the ingredient triple (already resolved by Plan
 * 15-03's Engine.buildIngredientsForVersion). This shape does NOT include
 * hashes — the native binding computes its own labeled SHA when
 * createIngredient is called at the impure signer layer.
 */
export interface BuildManifestWithIngredientsOptions extends BuildManifestOptions {
  ingredients: {
    parentOf: ParentIngredient | null;
    componentOf: ComponentIngredient[];
    inputTo: InputAssertion;
  };
  /**
   * Asset references for the ingredient bytes — provided by the impure caller
   * (Plan 15-03 Engine.signOutput) which has access to the filesystem. The
   * pure builder uses these to decide which spec is reachable (drives
   * createIngredient at sign time) vs unreachable (records via
   * vfx_familiar.unavailable_ingredient).
   *
   * Map keyed by:
   *   - parentOf:    'parent' (single)
   *   - componentOf: ComponentIngredient.node_id
   */
  ingredientAssetRefs: ReadonlyMap<string, IngredientAssetRef>;
}

/**
 * Phase 15 — discriminated reference to ingredient asset bytes. The impure
 * caller produces this map; the pure builder doesn't open files.
 *
 * - 'buffer': in-memory bytes + mimeType (image/jpeg / image/png shape). The
 *   native binding's createIngredient accepts BufferAsset for these MIME types.
 * - 'file':   absolute path + mimeType. createIngredient accepts FileAsset for
 *   any format the underlying c2pa-rs has a handler for.
 * - 'unavailable': bytes could not be loaded; the typed reason is surfaced in
 *   the vfx_familiar.unavailable_ingredient assertion so the audit trail
 *   records what was attempted (ROADMAP criterion #5).
 */
export type IngredientAssetRef =
  | { kind: 'buffer'; buffer: Buffer; mimeType: string }
  | { kind: 'file'; path: string; mimeType: string }
  | {
      kind: 'unavailable';
      // Mirror of VendorUnavailableIngredientAssertion.data.reason — keep in
      // sync. Phase 15 WR-02 added 'mime_type_unsupported'.
      reason:
        | 'file_not_found'
        | 'file_unreadable'
        | 'parent_manifest_pending'
        | 'mime_type_unsupported';
    };

/**
 * Phase 15 — recipe for one ingredient the impure signer should drive through
 * createIngredient + manifestBuilder.addIngredient.
 *
 * The signer:
 *   1. Inspects assetRef.kind. If 'unavailable' — skip createIngredient and
 *      let the vfx_familiar.unavailable_ingredient assertion (in
 *      BuildManifestResult.definition.assertions[]) carry the audit trail.
 *   2. For 'buffer' or 'file' — calls createIngredient({asset, title}) with
 *      that AssetRef (let the native binding compute its own labeled hash).
 *   3. Sets the returned StorableIngredient.ingredient.relationship to
 *      Relationship.ParentOf or Relationship.ComponentOf (matches
 *      spec.relationship verbatim).
 *   4. Calls manifestBuilder.addIngredient(storable).
 *
 * The IngredientSpec is the contract — it carries everything the signer needs
 * without requiring the signer to know about ParentIngredient /
 * ComponentIngredient internals.
 */
export interface IngredientSpec {
  /** Maps to the native binding's Relationship enum. */
  relationship: 'parentOf' | 'componentOf';
  /** Human-readable title surfaced as the ingredient's title field. */
  title: string;
  /** Asset reference — the impure caller resolves this from disk / DB. */
  assetRef: IngredientAssetRef;
  /**
   * Audit metadata the impure signer ignores at sign time but the pure
   * builder mirrors into the vfx_familiar.unavailable_ingredient assertion
   * when assetRef.kind === 'unavailable'. Carries version_id / lineage_type
   * for parents, node_id / role / filename for components.
   */
  auditMetadata: Record<string, string | number | null>;
}

/**
 * Phase 15 — output of buildManifestWithIngredients.
 *
 * - definition: clean BaseManifestDefinition-compatible shape (Phase 14
 *   c2pa.created assertion + vfx_familiar.input + zero-or-more
 *   vfx_familiar.unavailable_ingredient — NO c2pa.ingredient entries). This
 *   is what the impure signer hands to `new ManifestBuilder(def)`.
 * - ingredientSpecs: recipe list (parent + each component) the signer feeds
 *   to createIngredient + addIngredient. The signer skips entries whose
 *   assetRef.kind === 'unavailable' (the audit trail is already in the
 *   definition's vfx_familiar.unavailable_ingredient assertion).
 */
export interface BuildManifestResult {
  definition: ManifestDefinition;
  ingredientSpecs: IngredientSpec[];
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
 * Pure builder — synchronous, no I/O, no async, no calls to the native binding.
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
 * Phase 15 / Plan 15-02 — pure entry point that produces both:
 *   1. A clean ManifestDefinition (no ingredients field — matches the native
 *      binding's BaseManifestDefinition shape) carrying the c2pa.created
 *      action (Phase 14) + vfx_familiar.input (the structured prompt + sampler
 *      payload) + zero-or-more vfx_familiar.unavailable_ingredient entries
 *      (one per spec whose bytes are unreachable).
 *   2. A list of IngredientSpec records the impure signer (Plan 15-03) drives
 *      through createIngredient + manifestBuilder.addIngredient to populate
 *      Manifest.ingredients[] (NOT assertions[]).
 *
 * Ingredient flow at runtime (impure side, not this function):
 *   const builder = new c2pa.ManifestBuilder(result.definition);
 *   for (const spec of result.ingredientSpecs) {
 *     if (spec.assetRef.kind === 'unavailable') continue;  // already in assertion
 *     const storable = await c2pa.createIngredient({
 *       asset: spec.assetRef.kind === 'buffer'
 *         ? { buffer: spec.assetRef.buffer, mimeType: spec.assetRef.mimeType }
 *         : { path: spec.assetRef.path, mimeType: spec.assetRef.mimeType },
 *       title: spec.title,
 *     });
 *     storable.ingredient.relationship = spec.relationship === 'parentOf'
 *       ? c2pa.Relationship.ParentOf
 *       : c2pa.Relationship.ComponentOf;
 *     builder.addIngredient(storable);
 *   }
 *   await c2pa.sign({ asset, manifest: builder, ... });
 *
 * Pure: zero I/O, synchronous. Idempotent (deeply-equal inputs ->
 * deeply-equal outputs).
 *
 * Architectural contract: definition.assertions[] NEVER contains a
 * c2pa.ingredient entry. The native binding's BaseManifestDefinition shape
 * deliberately excludes the `ingredients` field — ingredients are added AFTER
 * construction via manifestBuilder.addIngredient(storableIngredient), where
 * storableIngredient comes from c2pa.createIngredient({asset, title, hash?}).
 * Since createIngredient REQUIRES asset bytes (no public API exists to build
 * an ingredient purely from a precomputed hash), unreachable specs cannot
 * land as c2pa.ingredient entries — instead we surface them via the
 * vfx_familiar.unavailable_ingredient vendor assertion so an independent
 * C2PA reader sees what was attempted (ROADMAP criterion #5).
 */
export function buildManifestWithIngredients(
  opts: BuildManifestWithIngredientsOptions,
): BuildManifestResult {
  const description = describePrimaryModel(opts.primaryModel);
  const assertions: ManifestAssertion[] = [
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
    {
      label: 'vfx_familiar.input',
      data: opts.ingredients.inputTo,
    },
  ];

  const ingredientSpecs: IngredientSpec[] = [];

  // ── parentOf — single spec when present.
  if (opts.ingredients.parentOf !== null) {
    const p = opts.ingredients.parentOf;
    const auditMetadata: Record<string, string | number | null> = {
      version_id: p.parent_version_id,
      lineage_type: p.lineage_type,
      manifest_hash: p.manifest_hash,
    };
    const title = `Parent ${p.parent_version_id}`;
    const assetRef = opts.ingredientAssetRefs.get('parent');
    if (assetRef && assetRef.kind !== 'unavailable') {
      ingredientSpecs.push({
        relationship: 'parentOf',
        title,
        assetRef,
        auditMetadata,
      });
    } else {
      // assetRef missing OR unavailable -> record the dangling reference.
      const reason:
        | 'file_not_found'
        | 'file_unreadable'
        | 'parent_manifest_pending'
        | 'mime_type_unsupported' =
        assetRef?.kind === 'unavailable'
          ? assetRef.reason
          : (p.parent_unavailable ?? 'parent_manifest_pending');
      // Always also surface in ingredientSpecs (with assetRef='unavailable')
      // so Plan 15-03's signer can skip cleanly without lookup gymnastics.
      ingredientSpecs.push({
        relationship: 'parentOf',
        title,
        assetRef: { kind: 'unavailable', reason },
        auditMetadata,
      });
      assertions.push({
        label: 'vfx_familiar.unavailable_ingredient',
        data: {
          relationship: 'parentOf',
          title,
          reason,
          metadata: auditMetadata,
        },
      });
    }
  }

  // ── componentOf — one spec per ingredient. extractComponentIngredients
  // already returns the list sorted by node_id (Plan 15-01 contract); we
  // preserve that order through this loop without re-sorting.
  for (const c of opts.ingredients.componentOf) {
    const safeFilename = stripToBasename(c.input_filename); // T-15-04
    const auditMetadata: Record<string, string | number | null> = {
      node_id: c.node_id,
      role: c.role,
      input_filename: safeFilename,
      class_type: c.class_type,
    };
    const title = `${c.role} image (${safeFilename})`;
    const assetRef = opts.ingredientAssetRefs.get(c.node_id);
    if (assetRef && assetRef.kind !== 'unavailable') {
      ingredientSpecs.push({
        relationship: 'componentOf',
        title,
        assetRef,
        auditMetadata,
      });
    } else {
      const reason:
        | 'file_not_found'
        | 'file_unreadable'
        | 'parent_manifest_pending'
        | 'mime_type_unsupported' =
        assetRef?.kind === 'unavailable' ? assetRef.reason : 'file_not_found';
      ingredientSpecs.push({
        relationship: 'componentOf',
        title,
        assetRef: { kind: 'unavailable', reason },
        auditMetadata,
      });
      assertions.push({
        label: 'vfx_familiar.unavailable_ingredient',
        data: {
          relationship: 'componentOf',
          title,
          reason,
          metadata: auditMetadata,
        },
      });
    }
  }

  const definition: ManifestDefinition = {
    claim_generator: `vfx-familiar/${opts.appVersion} c2pa-node/${C2PA_NODE_VERSION}`,
    format: opts.mimeType,
    title: `Version ${opts.versionId}`,
    assertions,
  };

  return { definition, ingredientSpecs };
}

/**
 * T-15-04 defence-in-depth: trust no caller, strip to basename. Pure string
 * ops — no path module dependency to keep this module pure-string. Handles
 * both POSIX ('/') and Windows ('\\') separators; if both appear, the later
 * one wins (mirrors path.basename semantics on the respective platform).
 */
function stripToBasename(p: string): string {
  const lastSlash = p.lastIndexOf('/');
  const lastBackslash = p.lastIndexOf('\\');
  const idx = Math.max(lastSlash, lastBackslash);
  if (idx === -1) return p;
  return p.slice(idx + 1);
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
