---
phase: 15-ingredient-graph
plan: 02
subsystem: c2pa
tags: [c2pa, manifest-builder, ingredient-specs, vendor-input-assertion, vendor-unavailable-ingredient, t-15-04, prov-v-04]

# Dependency graph
requires:
  - phase: 15-ingredient-graph
    plan: 01
    provides: ParentIngredient + ComponentIngredient + InputAssertion types (consumed via type-only import); INPUT_PROMPT_MAX_CHARS constant (caller-side enforcement)
  - phase: 14-c2pa-manifest-scaffolding
    provides: BuildManifestOptions + ManifestDefinition shape (Phase 14 entry point preserved byte-unchanged); buildManifestDefinition is the legacy backward-compat surface; signer.ts ManifestDefinition consumer path
provides:
  - buildManifestWithIngredients pure entry point returning BuildManifestResult { definition, ingredientSpecs }
  - BuildManifestWithIngredientsOptions / IngredientAssetRef / IngredientSpec / BuildManifestResult exported types
  - ManifestAssertion discriminated union (CreatedActionAssertion | VendorInputAssertion | VendorUnavailableIngredientAssertion)
  - vfx_familiar.input + vfx_familiar.unavailable_ingredient vendor assertion shapes
  - stripToBasename T-15-04 defence-in-depth helper
  - Backward-compat invariant locked by Test 10 (Type tests) + Tests 1-12 of original Phase 14 suite
affects: [15-03-engine-integration, 15-04-end-to-end-fixture, 16-redaction-and-agent-surface]

# Tech tracking
tech-stack:
  added: []
  patterns: [discriminated-union supertype broadening preserving subtype narrowing, pickCreatedAction narrowing helper for tests, type-only import preserving architecture-purity]

key-files:
  created: []
  modified:
    - src/engine/c2pa/manifest-builder.ts (132 -> 471 lines; 8 new exported types + 1 new pure function + 1 helper; pure module preserved)
    - src/engine/c2pa/__tests__/manifest-builder.test.ts (153 -> 851 lines; 12 -> 42 tests)
    - src/engine/c2pa/index.ts (barrel re-exports for 8 new symbols)

key-decisions:
  - "Discriminated-union supertype broadening: ManifestDefinition.assertions[] became Array<ManifestAssertion> (union over c2pa.actions + vfx_familiar.input + vfx_familiar.unavailable_ingredient). Phase 14's literal CreatedActionAssertion narrows in, so legacy callers compile byte-unchanged. Type-system trick that lets us extend without breaking."
  - "pickCreatedAction narrowing helper added to manifest-builder.test.ts so the existing Phase 14 tests (which drilled into def.assertions[0]?.data.actions) keep working with one-line tweaks rather than wholesale rewrites. This is a Rule 1 fix triggered by the union broadening — the alternative was to rewrite each test."
  - "Empty ingredientAssetRefs map fallthrough: when a component has no entry in the map, the builder treats it as 'unavailable file_not_found' rather than throwing. Preserves the contract that the impure layer can omit refs for components whose bytes it knows are unreachable, without forcing it to construct an explicit unavailable ref upfront. Locked by Test 12."
  - "Always populate ingredientSpecs[] for the parent even when bytes are unavailable: the spec carries assetRef.kind='unavailable' so Plan 15-03's signer can iterate uniformly and skip cleanly without lookup gymnastics. The audit trail is ALSO surfaced via the vfx_familiar.unavailable_ingredient assertion in definition.assertions[]. Two-channel record (signer recipe + audit assertion) ensures NO information is lost."
  - "Architectural contract: definition.assertions[] NEVER carries a c2pa.ingredient label. Locked by Test 16 via .every(a => (a.label as string) !== 'c2pa.ingredient'). The native binding's BaseManifestDefinition shape deliberately excludes the `ingredients` field; ingredients are added AFTER construction via manifestBuilder.addIngredient(storableIngredient). Since createIngredient REQUIRES asset bytes (no API exists for hash-only construction), unreachable specs cannot land as c2pa.ingredient — vendor assertion is the audit channel."
  - "T-15-04 stripToBasename defence-in-depth applied even though Plan 15-01's extractComponentIngredients already pushes basenames through. Trust no caller — if a future plan or external integration constructs a ComponentIngredient with an absolute path, the stripToBasename helper still strips POSIX '/' and Windows '\\\\' separators before the value reaches auditMetadata or the unavailable assertion's metadata. Locked by Tests 17, 18."

patterns-established:
  - "Type broadening as supertype: when extending an interface field's union, the original literal must narrow IN (be a member of the new union). Tests verify backward-compat by constructing the original literal shape explicitly and assigning to the broadened type."
  - "Two-channel ingredient recording: assetRef='unavailable' in IngredientSpec[] for the signer's iteration path + vfx_familiar.unavailable_ingredient assertion in definition.assertions[] for independent C2PA reader visibility. Single source of metadata (auditMetadata Record) feeds both."
  - "Type-only `import type` from sibling pure modules preserves architecture-purity grep guards (which scan the file for runtime import statements). The TypeScript compiler erases type-only imports at build time."

requirements-completed: []  # PROV-V-04 cohort closure happens in Plan 15-04 (full v1->v2->v3 ingredient-graph fixture). This plan is the contract layer between extractors (15-01) and engine integration (15-03).

# Metrics
duration: 9min
completed: 2026-04-30
---

# Phase 15 Plan 02: Manifest Builder Extension Summary

**Pure manifest builder extension producing BuildManifestResult { definition, ingredientSpecs } for the impure signer to drive; vfx_familiar.input + vfx_familiar.unavailable_ingredient vendor assertions land in definition.assertions[]; ingredients flow via the native binding's manifestBuilder.addIngredient at sign time (NOT via assertions[]).**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-30T16:01:40Z
- **Completed:** 2026-04-30T16:11:08Z
- **Tasks:** 2
- **Files modified:** 3 (1 new function added, 2 test files extended)

## Accomplishments

- New pure entry point `buildManifestWithIngredients(opts: BuildManifestWithIngredientsOptions): BuildManifestResult` lives at the bottom of `src/engine/c2pa/manifest-builder.ts`, alongside the unchanged Phase 14 `buildManifestDefinition`. Both are exported.
- `BuildManifestResult` carries `{ definition, ingredientSpecs }`. `definition` is the clean BaseManifestDefinition-compatible shape (no `ingredients` field). `ingredientSpecs` is the recipe Plan 15-03's signer iterates.
- `IngredientAssetRef` discriminated union: `{ kind: 'buffer', buffer, mimeType }` | `{ kind: 'file', path, mimeType }` | `{ kind: 'unavailable', reason }`. Reason taxonomy: `file_not_found | file_unreadable | parent_manifest_pending`.
- `ManifestAssertion` discriminated union broadens `ManifestDefinition.assertions[]`: `CreatedActionAssertion | VendorInputAssertion | VendorUnavailableIngredientAssertion`. Phase 14's c2pa.actions literal narrows in — backward-compat preserved.
- `vfx_familiar.input` carries the Plan 15-01 InputAssertion verbatim (locked by Test 4 deepEqual). `vfx_familiar.unavailable_ingredient` carries `{ relationship, title, reason, metadata }` so independent C2PA readers see what was attempted (ROADMAP criterion #5).
- T-15-04 `stripToBasename` defence-in-depth strips POSIX `/` and Windows `\\` separators from `auditMetadata.input_filename` and the unavailable assertion's `metadata.input_filename`. Locked by Tests 17 + 18.
- Architectural contract locked: `definition.assertions[]` NEVER contains a `c2pa.ingredient` label (Test 16 every-not-equal). The native binding's `createIngredient` requires asset bytes — unreachable ingredients flow through the vendor unavailable_ingredient assertion as the audit channel.
- 30 new tests (10 Task 1 type-shape + 20 Task 2 behavior) bring manifest-builder.test.ts from 12 to 42 passing. Root suite 1096 -> 1126 passing; pre-existing 5 v1.1-audit failures unchanged. Dashboard 88/88 unchanged.
- Architecture-purity preserved: `src/engine/c2pa/manifest-builder.ts` retains zero forbidden imports (zero `from 'c2pa-node'` / `from '@modelcontextprotocol/sdk'` / `from 'better-sqlite3'` / `from 'drizzle-orm'` / etc.). Type-only `import type` from `./ingredient-extractor.js` is erased at runtime.
- `src/engine/c2pa/index.ts` re-exports all 8 new symbols (buildManifestWithIngredients function + 7 types) so Plan 15-03 (Engine integration) imports cleanly through the barrel.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add IngredientSpec / BuildManifestResult / vendor assertion types** — `c961b74` (feat)
2. **Task 2: Implement buildManifestWithIngredients pure entry point** — `19e94ac` (feat)

**Plan metadata:** _appended in a final docs commit at the end of plan execution (this SUMMARY + STATE / ROADMAP updates)_

_Note: Both tasks followed RED -> GREEN — type-shape tests authored first against missing imports (RED at tsc level), then types added to the implementation (GREEN); behavior tests authored next against missing function (RED at runtime), then function implemented (GREEN). No REFACTOR commits were needed; types and function shipped clean from GREEN._

## Files Created/Modified

### Modified
- `src/engine/c2pa/manifest-builder.ts` (132 -> 471 lines)
  - **Added:** 8 exported types — `BuildManifestWithIngredientsOptions`, `IngredientAssetRef`, `IngredientSpec`, `BuildManifestResult`, `ManifestAssertion`, `CreatedActionAssertion`, `VendorInputAssertion`, `VendorUnavailableIngredientAssertion`.
  - **Added:** `buildManifestWithIngredients` pure function + `stripToBasename` private helper.
  - **Modified:** `ManifestDefinition.assertions` field broadened from narrow tuple-ish array to `ManifestAssertion[]` discriminated union (supertype — Phase 14 literal narrows in).
  - **Modified:** Header docstring rephrased to use generic descriptions ("the native binding") instead of literal forbidden-package strings, mirroring the Phase 13 / Plan 13-01 / Plan 15-01 pattern (Rule 3 deviation; see Deviations below).
  - **Unchanged:** `buildManifestDefinition` body — Phase 14 callers compile + execute byte-equal.
- `src/engine/c2pa/__tests__/manifest-builder.test.ts` (153 -> 851 lines, 12 -> 42 tests)
  - **Added:** Phase 15 Task 1 type-shape tests (10 tests in 1 describe block).
  - **Added:** Phase 15 Task 2 behavior tests (20 tests in 9 describe blocks).
  - **Added:** `pickCreatedAction` narrowing helper at file top so existing Phase 14 tests can drill into the c2pa.actions shape after the union broadening (Rule 1 fix; see Deviations below).
  - **Modified:** Phase 14 Tests 1, 5, 6, 7, 8, 9, 10, 11 use the narrowing helper (line-level patches; assertions otherwise byte-unchanged).
- `src/engine/c2pa/index.ts` — barrel re-exports for 8 new symbols. Maintains the convention that downstream callers (Plan 15-03 Engine integration) import from the barrel rather than the file directly.

## Architectural Contract: How Ingredients Flow

The previous draft of Plan 15-02 (per CONTEXT.md D-CTX-3) emitted parentOf / componentOf as `c2pa.ingredient` entries inside `assertions[]`. The plan-checker B1 spotted that this was wrong — the native binding's `BaseManifestDefinition` (the type its `ManifestBuilder` constructor accepts) deliberately EXCLUDES the `ingredients` field. Ingredients are added AFTER construction via `manifestBuilder.addIngredient(storableIngredient)`, where `storableIngredient` comes from `c2pa.createIngredient({asset, title, hash?})`.

The `createIngredient` API REQUIRES the asset bytes (BufferAsset or FileAsset) — even if a `hash` field is supplied, the binding still calls `bindings.create_ingredient(asset)` which streams the bytes through native code. NO public API exists to construct an ingredient purely from a precomputed hash.

This drove the Plan 15-02 architectural choice:

- **Reachable ingredient bytes** → drive `c2pa.createIngredient` → produce a `StorableIngredient` → `manifestBuilder.addIngredient` (this happens at the IMPURE signer layer in Plan 15-03)
- **Unreachable ingredient bytes** → record via `vfx_familiar.unavailable_ingredient` custom assertion (preserves the audit trail per ROADMAP criterion #5)

The pure builder's job is therefore to produce:
1. The cleaned `ManifestDefinition` (no `ingredients` field — matches the binding's `BaseManifestDefinition` shape)
2. The `IngredientSpec[]` recipe the impure layer iterates
3. The `vfx_familiar.*` custom assertions that DO land in `assertions[]`

The two-channel record (signer recipe + audit assertion for unavailable) ensures NO information is lost when bytes are unreachable. The signer skips entries whose `assetRef.kind === 'unavailable'`, but the audit assertion in `definition.assertions[]` still records the attempt.

## Test Coverage Detail

**Task 1 type-shape tests (10 in `Plan 15-02 Task 1 — additive types compile + match expected shapes`):**
- Type 1: BuildManifestOptions Phase 14 5-field shape preserved
- Type 2: IngredientAssetRef discriminated union (buffer / file / unavailable + 3 reason variants)
- Type 3: IngredientSpec compiles for both parentOf and componentOf relationships
- Type 4: BuildManifestResult { definition, ingredientSpecs } shape
- Type 5: VendorInputAssertion accepts InputAssertion verbatim
- Type 6: VendorUnavailableIngredientAssertion shape with metadata payload
- Type 7: CreatedActionAssertion is a member of ManifestAssertion union
- Type 8: BuildManifestWithIngredientsOptions extends BuildManifestOptions correctly
- Type 9: ManifestDefinition.assertions accepts the broadened union
- Type 10: Backward-compat — buildManifestDefinition still returns assertions:[c2pa.actions] (length 1)

**Task 2 behavior tests (20 in 9 describe blocks):**
- Block 1 (BuildManifestResult shape): Tests 1-2 — fields present, claim_generator/format/title
- Block 2 (c2pa.created assertion preserved): Test 3 — c2pa.actions structure unchanged
- Block 3 (vfx_familiar.input): Tests 4-5 — verbatim payload, exact-2-assertion default
- Block 4 (parentOf reachable): Tests 6-7 — file + buffer assetRef variants, auditMetadata
- Block 5 (parentOf unavailable): Tests 8-9 — parent_manifest_pending audit assertion + null parentOf
- Block 6 (componentOf reachable + unavailable): Tests 10-13 — file_not_found, missing-from-map fallback, empty case
- Block 7 (ordering invariants): Tests 14-15 — assertions and ingredientSpecs ordering
- Block 8 (architectural contract): Test 16 — NO c2pa.ingredient label EVER
- Block 9 (T-15-04 stripToBasename): Tests 17-19 — POSIX, Windows, identity
- Block 10 (purity): Test 20 — idempotency + no-Promise

## Test Count Delta

| Suite | Before Plan 15-02 | After Plan 15-02 | Delta |
|-------|--------------------|------------------|-------|
| Root passing | 1096 | 1126 | +30 |
| Root pre-existing failures | 5 | 5 | 0 |
| Root skipped | 3 | 3 | 0 |
| Dashboard passing | 88 | 88 | 0 |
| manifest-builder.test.ts | 12 | 42 | +30 |
| architecture-purity.test.ts | 32 | 32 | 0 |

**Pre-existing 5 v1.1-audit ROADMAP-shape failures unchanged** — same files, same test names as documented in STATE.md (phase-attribution.test.ts × 3, validation-flags.test.ts × 2). Out-of-scope for Plan 15-02.

## Threat Mitigations Locked by Tests

| Threat ID | Category | Mitigation Test | Test Name |
|-----------|----------|-----------------|-----------|
| T-15-01 (extension) | Information Disclosure (input assertion shape) | Test 4 | "definition.assertions[1] is vfx_familiar.input with the inputTo data verbatim" — deepEqual against the structured InputAssertion (Plan 15-01 already enforces 4096-char cap + bounded shape) |
| T-15-04 | Information Disclosure (path leak) | Tests 17, 18 | "input_filename containing absolute POSIX path" + "Windows backslashes" — auditMetadata.input_filename never contains '/' or '\\\\'; same applied to unavailable assertion's metadata.input_filename |

## Decisions Made

- **Discriminated-union supertype broadening** chosen over a separate "ManifestDefinitionWithIngredients" type. The supertype approach lets Phase 14 `buildManifestDefinition` keep returning `ManifestDefinition` (the broadened type) while its body's literal narrows in to one specific union member — legacy callers compile byte-unchanged.
- **pickCreatedAction narrowing helper** in tests rather than rewriting the Phase 14 test assertions. The helper is one extra `const created = pickCreatedAction(def);` line per test that needed it, throwing if the wrong shape was returned. Keeps the original assertion intent (`expect(created.data.actions[0]?.action).toBe('c2pa.created')`) unchanged.
- **stripToBasename inlined** as a private helper rather than imported from `node:path`. The plan called for "Pure string ops — no path module dependency to keep this module pure-string." Mirrors the discipline the wider c2pa/ folder follows: zero non-essential imports, even from Node built-ins. The inline function is 5 lines and handles both POSIX `/` and Windows `\\` separators.
- **`ingredientSpecs[]` always includes the parent entry even when unavailable** (with `assetRef.kind='unavailable'`). Plan 15-03's signer can iterate the array uniformly and skip cleanly via `if (spec.assetRef.kind === 'unavailable') continue;`. The alternative (only include reachable specs in the array, fall through to assertions for unavailable) would have forced the signer to do two-channel lookups. Locked by Tests 8 + 11.
- **Map fallthrough = file_not_found** rather than `throw`. When `ingredientAssetRefs.get('5')` returns `undefined`, the builder treats the missing entry as `unavailable file_not_found`. Preserves a convention where the impure caller can omit refs for components whose bytes it knows are unreachable, without forcing it to construct an explicit unavailable ref upfront. Locked by Test 12.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] pickCreatedAction narrowing helper added to manifest-builder.test.ts**
- **Found during:** Task 1 GREEN — after broadening `ManifestDefinition.assertions` to the discriminated union, the existing Phase 14 tests (which drilled into `def.assertions[0]?.data.actions`) failed tsc with "Property 'actions' does not exist on type 'InputAssertion | { actions: ... } | { ... }'". The union broadening forced narrowing.
- **Issue:** The plan's Task 1 `<action>` block instructed broadening `ManifestDefinition.assertions` to `ManifestAssertion[]` but did not specify how the existing Phase 14 tests should be patched. Without a narrowing helper, every test that drilled into shape-specific fields would have needed an inline `if (a.label !== 'c2pa.actions') throw...` boilerplate.
- **Fix:** Added a one-function `pickCreatedAction` helper at the test file top that narrows by label, throwing if the wrong shape was returned. Updated 8 existing Phase 14 tests to use it (Tests 1, 5, 6, 7, 8, 9, 10, 11). Kept the original `expect(...).toBe(...)` shape — only the `def.assertions[0]?.data.actions` access became `pickCreatedAction(def).data.actions`.
- **Files modified:** `src/engine/c2pa/__tests__/manifest-builder.test.ts` (helper + 8 Phase 14 test patches).
- **Verification:** All 12 Phase 14 tests still pass byte-unchanged in their assertion intent; tsc clean.
- **Committed in:** `c961b74` (Task 1 commit, bundled per Rule 1 scope-boundary).

**2. [Rule 3 - Blocking] Header docstring rephrasing to avoid literal forbidden-package strings**
- **Found during:** Task 1 RED -> GREEN transition (when expanding the file header to describe Phase 15 additions).
- **Issue:** The plan's docstring template included the literal substring `c2pa-node` in the architecture-purity description ("zero MCP / DB / ORM / HTTP / c2pa-node imports"). The architecture-purity test at `src/__tests__/architecture-purity.test.ts:202` greps for `from[[:space:]]*['"]c2pa-node` (a regex matching IMPORT statements specifically), so the docstring would NOT have triggered that gate — but for consistency with the Phase 13 / Plan 13-01 / Plan 15-01 docstring discipline (which rephrases to avoid literal package-name strings everywhere), I rephrased preemptively. Same intent (no native-binding imports), no literal `c2pa-node` in the file. The `claim_generator` runtime string `vfx-familiar/<v> c2pa-node/<v>` is intentional output (not an import) and was preserved.
- **Files modified:** `src/engine/c2pa/manifest-builder.ts` (file header docstring + a few inline docstrings on the new types).
- **Verification:** `grep -E "from[[:space:]]*['\"]c2pa-node" src/engine/c2pa/manifest-builder.ts` returns no match; `grep -E "@modelcontextprotocol/sdk|c2pa-node|better-sqlite3|drizzle-orm" src/engine/c2pa/manifest-builder.ts` shows only the `claim_generator` runtime string and docstring mentions, none of which are import statements. tsc clean. Architecture-purity 32/32 unchanged.
- **Committed in:** `c961b74` (Task 1 commit, bundled per Rule 3 scope-boundary).

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug from union-broadening forcing test narrowing; 1 Rule 3 blocking from forbidden-package literal in docstring per the recurring Phase 13 / Plan 15-01 pattern)
**Impact on plan:** Both fixes preserve the plan's stated intent. The narrowing helper is the standard TypeScript pattern for working with discriminated unions in tests; the docstring rephrasing follows the established project discipline. No scope creep; no behavioral change.

## Issues Encountered

None during planned work — TDD RED -> GREEN ran cleanly for both tasks. Task 1 RED was at the tsc level (8 missing-export errors + 4 narrow-type errors); Task 2 RED was at the runtime level (20 `buildManifestWithIngredients is not a function` failures). Both transitions to GREEN required no debugging beyond the planned work.

## v1.2 Audit Items (Carried Forward to Plan 15-04 Closure)

- **vfx_familiar.* assertion versioning:** This plan introduces vendor-namespaced assertions without a version field in the data shape. If the assertion schema changes in v1.2, independent C2PA readers may need to handle multiple variants. Plan 15-04's closure paragraph should record this as a v1.2 consideration (add `_schema_version: '1.0'` or similar to the data payload).
- **stripToBasename and Unicode separators:** The helper handles ASCII `/` and `\\` only. Some filesystems (rare on macOS, common on archive-imported paths) may carry non-ASCII path separators (e.g., U+FF0F FULLWIDTH SOLIDUS, U+2215 DIVISION SLASH). For v1.1 we accept the basename intact; v1.2 audit should sweep for additional separator variants.
- **IngredientSpec.title format:** The current title format is `"Parent <version_id>"` for parent and `"<role> image (<filename>)"` for components. These appear in independent C2PA readers; Plan 15-04's fixture closure should document the format and lock it as a v1.1 contract (or rephrase if the format proves inconvenient for human inspection).

## Architecture-Purity Status

| File | MCP | native-binding | SQLite-driver | ORM | HTTP-server | Verified by |
|------|-----|----------------|---------------|-----|-------------|-------------|
| src/engine/c2pa/manifest-builder.ts | 0 | 0 | 0 | 0 | 0 | file-level grep at architecture-purity.test.ts:202 + directory-level guards |
| src/engine/c2pa/index.ts | 0 (re-exports only) | 0 | 0 | 0 | 0 | directory-level grep guards |

The type-only `import type { ParentIngredient, ComponentIngredient, InputAssertion } from './ingredient-extractor.js'` at the top of manifest-builder.ts is erased at compile time — TypeScript's `import type` syntax produces zero runtime import. The architecture-purity tests grep for runtime `from '<package>'` patterns and would not match a type-only import even if it was from a forbidden package. (The current import is from a sibling pure module, so this is doubly safe.)

## Self-Check: PASSED

Verified by direct re-reading after writing this SUMMARY:
- FOUND: `src/engine/c2pa/manifest-builder.ts` (471 lines)
- FOUND: `buildManifestWithIngredients` exported function in manifest-builder.ts (5 grep matches incl. docstring + signature)
- FOUND: `buildManifestDefinition` still exported (Phase 14 entry point) (3 grep matches)
- FOUND: `BuildManifestResult` + `IngredientSpec` + `IngredientAssetRef` exported types (multiple grep matches)
- FOUND: `vfx_familiar.input` + `vfx_familiar.unavailable_ingredient` literals in manifest-builder.ts (16 grep matches)
- ZERO: `c2pa.ingredient` label literal in manifest-builder.ts (verified architectural contract)
- ZERO: forbidden import statements (`@modelcontextprotocol/sdk` / `c2pa-node` / `better-sqlite3` / `drizzle-orm`) in manifest-builder.ts
- FOUND commit `c961b74`: feat(15-02) IngredientSpec / BuildManifestResult / vendor assertion types
- FOUND commit `19e94ac`: feat(15-02) buildManifestWithIngredients pure entry point
- VERIFIED: `npx vitest run src/engine/c2pa/__tests__/manifest-builder.test.ts` -> 42 passing
- VERIFIED: `npx vitest run` -> 1126 passing / 5 pre-existing failing / 3 skipped (1096 + 30 new tests)
- VERIFIED: `npx tsc --noEmit` clean
- VERIFIED: dashboard tests 88/88 unchanged

## Next Phase Readiness

**Plan 15-03 (Engine Integration) unblocked.** Plan 15-03 imports `buildManifestWithIngredients` + `BuildManifestResult` + `IngredientSpec` + `IngredientAssetRef` from `src/engine/c2pa/index.ts` (the barrel) and threads them through `Engine.signOutput`:
1. Reads the version + parent_version_id, calls `extractParentIngredient` (Plan 15-01) with a `getParentManifestHash` lookup.
2. Walks the resolved prompt blob via `extractComponentIngredients` (Plan 15-01) to collect components.
3. Builds an `inputTo` payload via `extractInputAssertion` (Plan 15-01).
4. For each ingredient, resolves an `IngredientAssetRef` from disk (file path / buffer / typed unavailable reason) and passes the map to `buildManifestWithIngredients`.
5. Iterates `result.ingredientSpecs[]`, calls `c2pa.createIngredient` + `manifestBuilder.addIngredient` for reachable specs, skips unavailable.
6. Calls `c2pa.sign` with the manifestBuilder + the result.definition's c2pa.created + vfx_familiar.input + vfx_familiar.unavailable_ingredient assertions all baked in.

The contract between Plan 15-02 (this plan) and Plan 15-03 is the `BuildManifestResult` type alone. Plan 15-03 does not need to know about the discriminated union internals — it iterates `ingredientSpecs[]` and inspects `assetRef.kind`.

**Plan 15-04 (End-to-End Fixture)** consumes the same contract through Plan 15-03's runtime integration. The fixture's verifier reads the signed file via `c2pa.read(buffer)`, walks `Manifest.ingredients[]` (populated by Plan 15-03's `addIngredient` calls) for parentOf + componentOf, AND walks `Manifest.activeAssertions[]` for the vfx_familiar.input + vfx_familiar.unavailable_ingredient entries. Both channels are independently verifiable by an independent C2PA reader.

---
*Phase: 15-ingredient-graph*
*Completed: 2026-04-30*
