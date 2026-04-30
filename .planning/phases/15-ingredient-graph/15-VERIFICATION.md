---
phase: 15-ingredient-graph
verified: 2026-04-30T17:14:20Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: null
---

# Phase 15: Ingredient Graph Verification Report

**Phase Goal:** Promote the C2PA manifest from "AI-origin disclosure + model fingerprints" to a full ingredient graph: `parentOf` for lineage (reproduce/iterate parents), `componentOf` for prompt-referenced control/reference/VAEEncode-source inputs, `inputTo` for prompt text + key parameters. Each ingredient links to its source artifact by hash where available.

**Verified:** 2026-04-30T17:14:20Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth                                                                                                                                                                                                          | Status     | Evidence                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Manifests for reproduce-lineage and iterate-lineage versions carry a `parentOf` ingredient assertion linking the parent version's manifest by hash                                                              | ✓ VERIFIED | `extractParentIngredient` in `ingredient-extractor.ts:209`; `addIngredientsToBuilder` in `signer.ts:542` drives `c2pa.createIngredient` + `manifestBuilder.addIngredient` with relationship='parentOf'; e2e Test 1 walks v3 → v2 chain via `manifest.ingredients[]` |
| 2   | Manifests carry a `componentOf` assertion for every non-loader-node input image referenced in the prompt blob, linked by SHA-256 of the input bytes when reachable                                              | ✓ VERIFIED | `IMAGE_INPUT_CLASS_TYPES` (6 entries, disjoint from LOADER_CLASS_TYPES); `extractComponentIngredients` walks via KSampler edge walk (Test IA-3 lock); e2e Test 2 verifies control.png surfaces as componentOf via `manifest.ingredients[]` |
| 3   | Manifests carry an `inputTo` assertion encoding the resolved prompt text plus seed and primary sampler parameters as a structured payload                                                                       | ✓ VERIFIED | `extractInputAssertion` (KSampler edge walk per REVISION B5); `vfx_familiar.input` vendor assertion in `manifest.assertions[]`; T-15-01 mitigation caps at 4096 chars with explicit truncation marker; e2e Tests 5+6 lock per-version inputTo |
| 4   | A v1 → v2 (reproduce + control image) → v3 fixture produces a v3 manifest whose ingredient graph traces back through v2 → v1, with hashes pinned at every step — verifiable by an independent C2PA reader     | ✓ VERIFIED | `c2pa-ingredient-graph-e2e.test.ts` (509 lines, 9 tests); uses `createC2pa().read()` (independent verifier path Phase 14 established); per-child parent binding distinct (v2.parentOf.instance_id ≠ v3.parentOf.instance_id) |
| 5   | When an ingredient's source artifact is unreachable, the assertion records the dangling-reference state rather than silently dropping the ingredient                                                            | ✓ VERIFIED | `c2pa-ingredient-dangling.test.ts` (293 lines, 5 tests); vendor `vfx_familiar.unavailable_ingredient` carries `reason='file_not_found'` + `metadata.input_filename='control.png'`; `unavailable_count=1` in ingredients_summary    |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact                                                                | Expected                                                                                       | Status     | Details                                                                                                                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/c2pa/ingredient-extractor.ts`                              | Pure extractors: extractParentIngredient + extractComponentIngredients + extractInputAssertion | ✓ VERIFIED | 313 lines; 3 pure functions + 4 types + INPUT_PROMPT_MAX_CHARS; KSampler edge walk via TEXT_ENCODER_CLASSES set                       |
| `src/engine/c2pa/ingredient-hasher.ts`                                 | Streaming SHA-256 with path-traversal guard + discriminated HashOutcome union                  | ✓ VERIFIED | 84 lines; mirrors output-hash.ts; HashOutcome = `{ hash } \| { component_unavailable: 'file_not_found' \| 'file_unreadable' }`        |
| `src/engine/c2pa/manifest-builder.ts` (extended)                       | buildManifestWithIngredients returns `BuildManifestResult { definition, ingredientSpecs }`     | ✓ VERIFIED | 471 lines; `buildManifestDefinition` (Phase 14) preserved byte-equal; new function at line 336; vfx_familiar.input + unavailable_ingredient |
| `src/engine/c2pa/signer.ts` (extended)                                 | signEmbedBufferWithIngredients + signEmbedFileWithIngredients drive c2pa.createIngredient + manifestBuilder.addIngredient | ✓ VERIFIED | New functions at lines 449 + 489; `addIngredientsToBuilder` at line 542; signer remains SOLE c2pa-node consumer in src/engine/        |
| `src/engine/pipeline.ts` (extended)                                    | Engine.signOutput per-version mutex (Map<versionId, Promise>); buildManifestForVersion         | ✓ VERIFIED | `signMutex: Map<string, Promise<...>>` at line 266; thin shim at 982-994; `_signOutputInner` holds Phase 14 logic; T-15-06 unconditional finally cleanup |
| `src/store/provenance-repo.ts`                                         | manifest_signed payload extended with manifest_sha256 + ingredients_summary (TS-only)          | ✓ VERIFIED | Type extension in `src/types/provenance.ts:62-77`; provenance-repo.ts unchanged at code level (TEXT column reuses storage)             |
| `src/__tests__/c2pa-ingredient-graph-e2e.test.ts`                      | v1→v2→v3 traceback via createC2pa().read() walking manifest.ingredients[]                      | ✓ VERIFIED | 509 lines, 9 tests pass; reads `manifest.ingredients[]` (NOT assertions[])                                                              |
| `src/__tests__/c2pa-ingredient-dangling.test.ts`                       | vfx_familiar.unavailable_ingredient assertion in assertions[]; ingredient NOT in ingredients[] | ✓ VERIFIED | 293 lines, 5 tests pass; T-15-04 stripToBasename lock                                                                                  |

### Key Link Verification

| From                                     | To                                            | Via                                                                                  | Status   | Details                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Engine.signOutput`                      | `buildManifestForVersion` → extractors        | direct method call at pipeline.ts:1067                                               | ✓ WIRED  | `buildManifestForVersion` calls all three pure extractors with parent-manifest-hash callback (line 1353+); resolves asset refs via stat() at outputRoot       |
| `Engine.signOutput`                      | `buildManifestWithIngredients`                | imported from `../c2pa/index.ts` (barrel)                                            | ✓ WIRED  | Result threaded through to signer at pipeline.ts:1148                                                                                                          |
| `Engine.signOutput`                      | `signEmbedBufferWithIngredients` / `signEmbedFileWithIngredients` | dispatched on mimeType buffer-API support                                            | ✓ WIRED  | signViaTempFilesWithIngredients wraps the file-based variant for mp4/webp/tiff                                                                                  |
| `signEmbedBufferWithIngredients`         | `c2pa.createIngredient` + `manifestBuilder.addIngredient` | `addIngredientsToBuilder` helper at signer.ts:542                                    | ✓ WIRED  | Iterates ingredientSpecs; skips kind='unavailable'; sets relationship='parentOf'/'componentOf' (literal strings — c2pa-node v0.5.26 enum runtime-export bug) |
| `extractComponentIngredients`            | KSampler edge walk for VAEEncode pixels       | resolveImageFilename at ingredient-extractor.ts:94                                   | ✓ WIRED  | One-hop walk to upstream LoadImage*; skips procedural producers                                                                                                |
| `extractInputAssertion`                  | CLIPTextEncode via KSampler.positive/negative | resolveCLIPTextFromEdge at ingredient-extractor.ts:173                               | ✓ WIRED  | Follows edge tuples; recognises CLIPTextEncode + CLIPTextEncodeSDXL + CLIPTextEncodeSDXLRefiner; text_g/text_l fallback                                       |
| `Engine.signOutput`                      | `signMutex` per-version coalesce              | thin shim at pipeline.ts:982; `try/finally` cleanup at 988-993                       | ✓ WIRED  | M1 test proves coalescing produces exactly ONE manifest_signed event; M3 proves no entry leak                                                                  |
| `manifest_signed event`                  | `manifest_sha256` + `ingredients_summary` payload fields | `summariseIngredientsFromResult` at pipeline.ts:165; `streamSha256` at pipeline.ts:142 | ✓ WIRED  | TS-optional fields; pre-Phase-15 rows parse cleanly; whitelist updated in c2pa-key-leak-negative.test.ts                                                       |

### Data-Flow Trace (Level 4)

| Artifact                                             | Data Variable                          | Source                                                                                                | Produces Real Data | Status      |
| ---------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------ | ----------- |
| `Engine.signOutput` → manifest_signed event payload | `manifest_sha256`                      | `streamSha256(signedFilePath)` (file branch) or `createHash('sha256').update(signedBytes)` (buffer)   | Yes                | ✓ FLOWING   |
| `Engine.signOutput` → manifest_signed event payload | `ingredients_summary.parent_count`     | `summariseIngredientsFromResult(BuildManifestResult)` counts ingredientSpecs by relationship          | Yes                | ✓ FLOWING   |
| `manifest.ingredients[]` (read-back via createC2pa) | parentOf entries                       | `c2pa.createIngredient({ asset: { path: outputRoot/<parentId>/<filename> } })` + `addIngredient`     | Yes                | ✓ FLOWING   |
| `manifest.ingredients[]` (read-back via createC2pa) | componentOf entries                    | `c2pa.createIngredient({ asset: { path: outputRoot/<versionId>/<filename> } })` + `addIngredient`    | Yes (when bytes reachable) | ✓ FLOWING   |
| `manifest.assertions[]` → vfx_familiar.input        | structured prompt + sampler + seed     | `extractInputAssertion(promptBlob, seed)` — KSampler edge walk → CLIPTextEncode `inputs.text`         | Yes                | ✓ FLOWING   |
| `manifest.assertions[]` → vfx_familiar.unavailable_ingredient | reason + metadata             | buildManifestWithIngredients emits when `assetRef.kind === 'unavailable'`; reason flows from stat()  | Yes (typed reasons) | ✓ FLOWING   |

### Behavioral Spot-Checks

| Behavior                                                                         | Command                                                                            | Result                                                          | Status     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------- |
| TypeScript compilation clean                                                     | `npx tsc --noEmit`                                                                 | exit 0; zero errors                                              | ✓ PASS     |
| Full root suite produces expected counts                                         | `npx vitest run`                                                                   | 1175 passing / 5 pre-existing failing / 3 skipped (1183 tests)   | ✓ PASS     |
| Dashboard suite unchanged                                                        | `cd packages/dashboard && npx vitest run`                                          | 88/88 passing                                                   | ✓ PASS     |
| End-to-end ingredient graph + dangling tests pass                                | `npx vitest run src/__tests__/c2pa-ingredient-{graph-e2e,dangling}.test.ts`        | 14/14 passing (9 e2e + 5 dangling)                              | ✓ PASS     |
| Pipeline-c2pa-ingredients integration tests pass                                 | `npx vitest run src/engine/__tests__/pipeline-c2pa-ingredients.test.ts`            | 18/18 passing                                                   | ✓ PASS     |
| Cohort-closure smoke tests pass                                                  | `npx vitest run src/__tests__/requirements-cohort-closure.test.ts`                 | 18/18 passing                                                   | ✓ PASS     |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                              | Status       | Evidence                                                                                                                                                                            |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PROV-V-04   | Phase 15    | Manifest emits ingredient graph: parentOf + componentOf + inputTo, linked by hash where available       | ✓ SATISFIED  | REQUIREMENTS.md:16 marks `[x]`; Traceability row "Complete"; ROADMAP success criteria #1-#5 all closed (see closure paragraph at REQUIREMENTS.md:91-99); 5 ROADMAP truths VERIFIED |

### Anti-Patterns Found

| File                                                       | Line | Pattern                                  | Severity | Impact                                                                                          |
| ---------------------------------------------------------- | ---- | ---------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| _none_                                                     | -    | -                                        | -        | Zero TODO/FIXME/PLACEHOLDER markers in Phase 15 source files; all return-null paths are typed-reason fallbacks (HashOutcome union, AssetRef discriminated union) |

Pre-existing 5 v1.1-audit ROADMAP-shape failures (3 phase-attribution + 2 validation-flags tests) are out of scope for Phase 15 — they parse v1.0 archive ROADMAP shapes against v1.1 ROADMAP layout. Documented in STATE.md as carried forward across Phases 10-15.

### Architecture-Purity Status

| File                                                       | MCP | c2pa-node                                       | SQLite-driver | ORM | HTTP-server | Notes                                                       |
| ---------------------------------------------------------- | --- | ----------------------------------------------- | ------------- | --- | ----------- | ----------------------------------------------------------- |
| `src/engine/c2pa/ingredient-extractor.ts`                 | 0   | 0                                               | 0             | 0   | 0           | File-level grep guard (architecture-purity.test.ts:246)     |
| `src/engine/c2pa/ingredient-hasher.ts`                    | 0   | 0                                               | 0             | 0   | 0           | File-level grep guard (architecture-purity.test.ts:263)     |
| `src/engine/c2pa/manifest-builder.ts`                     | 0   | 0                                               | 0             | 0   | 0           | Type-only `import type` from sibling pure module is erased   |
| `src/engine/c2pa/signer.ts`                               | 0   | **12** (the SOLE c2pa-node consumer in src/engine/c2pa/) | 0             | 0   | 0           | All references inside one file; locked by architecture-purity.test.ts:166 |
| `src/engine/pipeline.ts`                                  | 0   | 0                                               | drizzle types-only | drizzle types-only | 0 | Imports c2pa primitives via `c2pa/index.ts` barrel only; zero c2pa-node imports |
| `src/__tests__/c2pa-ingredient-graph-e2e.test.ts`         | 0   | 1 (createC2pa for read-back, test-file scope)   | 0             | 0   | 0           | Test-file scope exempt by directory-purity rule (mirrors Phase 14 c2pa-verification.test.ts) |
| `src/__tests__/c2pa-ingredient-dangling.test.ts`          | 0   | 1 (createC2pa for read-back, test-file scope)   | 0             | 0   | 0           | Same — test-file scope                                       |

Independent grep confirms NO c2pa-node imports in `src/` outside of `src/engine/c2pa/signer.ts` and the documented test files (`src/__tests__/c2pa-ingredient-{graph-e2e,dangling}.test.ts`, `src/__tests__/c2pa-verification.test.ts`).

### Human Verification Required

_None._ All ROADMAP success criteria are closed at the integration boundary by automated tests:
- Criteria #1-#3 are structural assertions (label / instance_id / title / relationship) on `manifest.ingredients[]` + `manifest.assertions[]` — fully verifiable by `createC2pa().read()`.
- Criterion #4 (independent C2PA reader) is closed by the e2e test using a fresh `createC2pa()` instance with no shared signer state — the gold-standard independent-verifier proof Phase 14 established.
- Criterion #5 (dangling reference) is closed by the dangling test asserting both presence (`vfx_familiar.unavailable_ingredient` in assertions[] with typed reason) and absence (no componentOf entry in ingredients[]) at the manifest read-back layer.

The cryptographic-binding proof (asset bytes → manifest hash → c2pa.hash.data) lives in Phase 14's c2pa-verification.test.ts (Tests 4 + 17 tamper detection) and stays valid under Phase 15 since the signer's underlying sign call is the same code path. The Phase 15 ingredient flow only adds createIngredient + addIngredient calls BEFORE sign — the cryptographic envelope is unchanged.

### Gaps Summary

_No gaps._

All 5 ROADMAP success criteria are met. All 7 must-have artifacts are present, substantive, wired, and produce real data. All 8 key links are wired. All 6 behavioral spot-checks pass. Architecture-purity preserved (signer.ts remains SOLE c2pa-node consumer in `src/engine/c2pa/`; test files exempt by directory scope, matching Phase 14 pattern). Append-only invariant on `provenance` table preserved (TS-only payload extension; manifest_signed_json TEXT column reuses Phase 14 storage).

### Documented v1.1 Limitations (Acknowledged Trade-offs)

These are NOT gaps — they are explicit v1.1 / v1.2 scope boundaries documented in REQUIREMENTS.md "Deferred to v1.2" section:

1. **Production cloud-mode component bytes.** In ComfyUI Cloud deployments, control / reference / VAEEncode source images live on cloud storage; outputRoot/<versionId>/<filename> typically does NOT see them. The expected outcome is dangling-reference (`vfx_familiar.unavailable_ingredient` assertion + `unavailable_count` incremented). Plan 15-04 dangling test proves this is correctly recorded. v1.2 deferred: REVISION C3 fetch path from ComfyUI Cloud input store.
2. **IPAdapter pack node-variants** (~12 forms in IP-Adapter Plus pack) NOT in IMAGE_INPUT_CLASS_TYPES. v1.1 ships 6 canonical core image-input nodes. v1.2 audit will extend.
3. **Conditioning-graph traversal** (ConditioningCombine / ConditioningConcat) not followed by extractInputAssertion. Direct CLIPTextEncode ancestors only in v1.1.
4. **VAEEncode upstream walks** are one-hop only (e.g., LoadImage → ImageScale → VAEEncode skips ImageScale). Multi-hop deferred to v1.2.
5. **T-15-07 disk I/O** on every child sign for parent ingredient bytes accepted for v1.1; LRU cache deferred.
6. **Stale parent manifest_sha256** (T-15-03) accepted via re-sign idempotency from Plan 14-03; v1.2 export_manifest will re-derive on demand.
7. **vfx_familiar.* assertion versioning** has no `_schema_version` field in v1.1; v1.2 may add.
8. **stripToBasename Unicode separators** — ASCII `/` and `\\` only in v1.1.

---

_Verified: 2026-04-30T17:14:20Z_
_Verifier: Claude (gsd-verifier)_
