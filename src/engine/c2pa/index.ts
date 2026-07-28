// Engine-layer C2PA module barrel export.
//
// This file re-exports the public API surface of the submodules. The engine
// integration, the HTTP route, and the verification tests all import from
// here.
//
// Architecture-purity: zero non-c2pa imports. The c2pa-node import is
// confined to ./signer.ts; everything in the barrel is re-export only.

export {
  buildManifestDefinition,
  type BuildManifestOptions,
  type ManifestDefinition,
  type PrimaryModel,
  // Additive types (BuildManifestResult surface) and discriminated
  // assertion union. Engine.signOutput consumes these from the barrel.
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
  // Supported-MIME helper used by Engine.signOutput's
  // ingredient asset-ref resolution to avoid passing 'application/octet-stream'
  // (which c2pa-rs rejects) for unclassifiable extensions.
  getMimeForExtensionOrNull,
  type FormatRoute,
  EMBED_BUFFER_FORMATS,
  EMBED_FILE_FORMATS,
  UNSUPPORTED_NATIVE_FORMATS,
} from './format-router.js';

export {
  loadSigner,
  isC2paNodeAvailable,
  // Ingredient-aware entry points. Drive the native
  // binding's createIngredient + manifestBuilder.addIngredient for each spec
  // before sign. Architecture-purity preserved: signer.ts is STILL the only
  // file in src/ that imports the native binding.
  signEmbedBuffer,
  signEmbedFile,
  type LoadedSigner,
} from './signer.js';

// Re-export buildManifestWithIngredients so engine
// callers (pipeline.ts) only need the c2pa barrel for the full flow.
export { buildManifestWithIngredients } from './manifest-builder.js';

export { BUFFER_SIGNING_MAX_BYTES } from './constants.js';

// Pure ingredient extraction primitives. Consumed by the manifest-builder
// extension and the engine integration.
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

// Agent-surface primitives. Pure-async
// reader (exporter.ts) + lazy-binding verifier (verifier.ts). Engine facade
// methods Engine.exportManifestForVersion / verifyManifestForVersion delegate
// here.
export { exportManifest, type ExporterResult } from './exporter.js';
export {
  verifyManifest,
  type VerificationReport,
  type VerifyManifestInput,
} from './verifier.js';

// Redaction primitive. Pure helpers (apply +
// build) live in redaction.ts; the integration helper that re-signs via
// signer.ts is also exported for the Engine facade (Engine.redactManifestForVersion).
export {
  applyRedactionPolicy,
  buildRedactedManifestDefinition,
  redactManifestForVersionImpl,
  extractAssertions,
  __resetRedactionStateForTests,
  type RedactionApplied,
  type RedactionResult,
  type AssetWriterAcquire,
} from './redaction.js';
