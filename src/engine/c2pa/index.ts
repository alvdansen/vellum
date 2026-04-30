// Phase 14 / Plan 14-02 — engine-layer C2PA module barrel export.
//
// This file re-exports the public API surface of the three submodules.
// Plan 14-03 (engine integration), Plan 14-04 (HTTP route), and Plan 14-05
// (verification tests) import from here.
//
// Architecture-purity: zero non-c2pa imports. The c2pa-node import is
// confined to ./signer.ts; everything in the barrel is re-export only.

export {
  buildManifestDefinition,
  type BuildManifestOptions,
  type ManifestDefinition,
  type PrimaryModel,
  // Phase 15 / Plan 15-02 — additive types (BuildManifestResult surface) and
  // discriminated assertion union. Plan 15-03 (Engine.signOutput) consumes
  // these from the barrel.
  type ManifestAssertion,
  type CreatedActionAssertion,
  type VendorInputAssertion,
  type VendorUnavailableIngredientAssertion,
  type BuildManifestWithIngredientsOptions,
  type IngredientAssetRef,
  type IngredientSpec,
  type BuildManifestResult,
} from './manifest-builder.js';

export {
  routeFormat,
  type FormatRoute,
  EMBED_BUFFER_FORMATS,
  EMBED_FILE_FORMATS,
  UNSUPPORTED_NATIVE_FORMATS,
} from './format-router.js';

export {
  loadSigner,
  signEmbedBuffer,
  signEmbedFile,
  isC2paNodeAvailable,
  type LoadedSigner,
} from './signer.js';

export { BUFFER_SIGNING_MAX_BYTES } from './constants.js';

// Phase 15 / Plan 15-01 — pure ingredient extraction primitives. Consumed by
// Plan 15-02 (manifest builder extension) and Plan 15-03 (engine integration).
export {
  extractParentIngredient,
  extractComponentIngredients,
  extractInputAssertion,
  INPUT_PROMPT_MAX_CHARS,
  type ComponentRole,
  type ParentIngredient,
  type ComponentIngredient,
  type InputAssertion,
} from './ingredient-extractor.js';

// Phase 15 / Plan 15-01 — streaming SHA-256 helper for component image bytes.
// Mirrors src/engine/output-hash.ts; impure (filesystem read) but
// architecture-pure (no MCP / native-binding / SQLite / ORM imports).
export { hashComponentBytes, type HashOutcome } from './ingredient-hasher.js';
