---
phase: 13-model-fingerprinting
plan: 03
subsystem: provenance

tags: [diff-parity, integration-test, architecture-purity, hash-unavailable, getlatestfingerprints, prov-v-03, phase-13-close]

# Dependency graph
requires:
  - phase: 13-model-fingerprinting
    plan: 01
    provides: "ModelRef.model_hash_unavailable: string | null + fingerprintModel + MODEL_DIR_BY_CLASS — the diff-side parity in this plan compares model_hash_unavailable across versions; the integration tests run fingerprintModel via Engine.fingerprintModelsForVersion."
  - phase: 13-model-fingerprinting
    plan: 02
    provides: "Engine.fingerprintModelsForVersion + GenerationEngine fingerprintHook + ProvenanceRepo.appendModelsFingerprintedEvent + ProvenanceRepo.getLatestFingerprints — Plan 13-03 calls these from the integration tests and from the new loadDiffSnapshot path."
provides:
  - "ModelChange.before / .after extended with `hash_unavailable: string | null` (D-CTX-1 propagation). Both sides of every ModelChange now carry the complete state — hash + hash_unavailable — so Phase 14 C2PA consumers see exactly what fingerprint state each side reflects."
  - "diffModels (src/engine/diff.ts) compares model_name, model_hash, AND model_hash_unavailable. A change in any of the three triggers a ModelChange, including the cross-field `hash → unavailable` and `unavailable → hash` transitions important for auditability."
  - "Engine.loadDiffSnapshot reads from provenanceRepo.getLatestFingerprints (post-fingerprint view) instead of raw completed_event.models_json (pre-fingerprint all-null view). Pre-Phase-13 rows fall through to the completed event via getLatestFingerprints' built-in fall-through, so legacy behavior is unchanged. The legacy try/catch JSON.parse block in loadDiffSnapshot is REMOVED — getLatestFingerprints handles parsing internally."
  - "End-to-end integration tests at src/engine/__tests__/model-fingerprint-integration.test.ts (5 cases) prove criteria #1, #2, #3 and the diff-boundary post-fingerprint read."
  - "File-level architecture-purity assertions for src/engine/model-fingerprint.ts (3 new tests) — zero MCP-SDK / better-sqlite3 / drizzle-orm imports asserted at the file granularity, in addition to the directory-wide guard at line 34."
  - "PROV-V-03 cohort closure: Phase 13 ROADMAP success criteria #1, #2, #3, #4, #5 all have automated coverage across Plans 13-01 + 13-02 + 13-03."
affects: [14-c2pa-manifest (consumes getLatestFingerprints + the extended ModelChange shape for the manifest's ingredient-graph fingerprint baseline)]

# Tech tracking
tech-stack:
  added: []  # No new dependencies — purely additive across diff path + integration test surface + architecture-purity surface.
  patterns:
    - "Diff-side parity for additive type extensions: when an interface gains an additive field, the same diff helper that already compared a sibling field MUST be extended to compare the new one, otherwise transitions on the new field are silently dropped. Surfaced here as the model_hash_unavailable triggers on diffModels — the type-extension change in Plan 13-01 was incomplete without this."
    - "Read-from-derived-event in repo helpers: when a derived-data sibling event (e.g., 'models_fingerprinted') exists for a row, prefer reading from it via a single helper that falls through to the original event when the derived row is absent. Plan 13-03's loadDiffSnapshot replacement is one line — `getLatestFingerprints(versionId)` — because the fall-through is encapsulated in the repo. Keeps the engine layer free of branch logic about which event to prefer."
    - "Integration tests that prove the cross-layer chain end-to-end: criterion #1 + #2 are individually proven by unit tests in 13-01 + 13-02, but the full submit→completed→fingerprint→getLatestFingerprints→diff chain is only proven by an integration test that drives the real Engine + repo + writer wiring. The 5 tests in model-fingerprint-integration.test.ts cover the resolvable / unresolvable / content-addressed / diff-boundary / mixed-state surface."
    - "File-level architecture-purity assertions as regression marketing: the directory-wide guard at line 34 already covers a new file transitively. Adding a file-level assertion is duplicative on the happy path but invaluable when a regression IS introduced — the failure message points directly at the regression source instead of the directory. Three assertions per pure-engine file (MCP-SDK / SQLite-driver / ORM) is the canonical pattern."
    - "TDD across two adjacent tasks (Task 1: type-extension RED-GREEN; Task 2: integration-test RED-GREEN): each task's RED phase asserts a different layer of the same change. Task 1 RED proved the type extension was missing on the in-memory diffModels; Task 2 RED (Tests 4+5 only) proved the loadDiffSnapshot read path was still pre-fingerprint. Both REDs were resolved by the same Phase 13 thesis (post-fingerprint view propagates through diff)."

key-files:
  created:
    - src/engine/__tests__/model-fingerprint-integration.test.ts
  modified:
    - src/types/provenance.ts
    - src/engine/diff.ts
    - src/engine/__tests__/diff.test.ts
    - src/engine/pipeline.ts
    - src/__tests__/architecture-purity.test.ts

key-decisions:
  - "ModelChange shape extension is additive but required-but-nullable on both new fields (hash_unavailable). Existing dashboard / Phase 14 consumers that read only `name` / `hash` continue to work; new consumers that branch on `hash_unavailable` see the typed reason code. Same pattern as Plan 13-01's ModelRef extension."
  - "Test 5 (mixed state) persists the v2 'models_fingerprinted' event directly via appendModelsFingerprintedEvent rather than juggling two engine instances with different modelsDir env. Reasoning: the test's intent is to assert that hash → unavailable transitions surface in version.diff. A second engine adds wiring complexity without tightening the assertion. Documented this choice in the test's name suffix and inline comment."
  - "loadDiffSnapshot replacement is exactly one line — `const models = this.provenanceRepo.getLatestFingerprints(versionId)`. The legacy try/catch JSON.parse is removed because getLatestFingerprints handles parsing internally and returns null on malformed JSON or non-array (T-13-12 mitigation, asserted by Plan 13-02's repo tests). No double-parse, no double-degrade — single repo entry point owns the contract."
  - "diffModels' `changed` boolean is now a 3-condition OR (model_name OR model_hash OR model_hash_unavailable). The before/after objects always populate both `hash` and `hash_unavailable` regardless of which field actually triggered the change — consumers branch on whichever is non-null per D-CTX-1. Simpler than emitting only the changed field's value (which would force consumers to read both fields anyway)."
  - "PROV-V-03 closure happens AFTER Plan 13-03 is committed (this plan). The cohort spans 13-01 (helper) + 13-02 (completion-path wiring) + 13-03 (diff parity + integration + purity). REQUIREMENTS.md mark-complete + Phase 13 ROADMAP row update happen in the orchestrator's post-task hooks per the plan's <constraint> section."

patterns-established:
  - "Type-extension propagation pattern: when an interface field is added in plan N (e.g., ModelRef.model_hash_unavailable), every helper that compares the interface for differences MUST be audited in the same or next plan to fire on the new field. Otherwise the field is silently absorbed at the comparison boundary and downstream consumers see stale 'no change' when there is one."
  - "End-to-end integration test triple: when an async background path (here: fingerprinter) writes a derived event read by a consumer (here: diff), the integration test must exercise: (1) the resolvable case end-to-end, (2) the unresolvable case end-to-end, (3) the diff path reading the derived event. Otherwise unit tests alone leave the integration boundary untested."

requirements-completed: [PROV-V-03]  # Plan 13-03 closes the cohort. 13-01 + 13-02 + 13-03 together provide automated coverage for ROADMAP success criteria #1, #2, #3, #4, #5.

# Metrics
duration: 6min
completed: 2026-04-30
---

# Phase 13 Plan 03: Diff parity + integration tests + file-level architecture-purity Summary

**Phase 13 close: ModelChange shape extended to carry `hash_unavailable` on both sides, diffModels fires on hash↔unavailable transitions, loadDiffSnapshot reads the post-fingerprint view via getLatestFingerprints, 5 end-to-end integration tests prove criteria #1/#2/#3 + the diff boundary, 3 file-level architecture-purity assertions lock src/engine/model-fingerprint.ts as zero-MCP / zero-SQLite-driver / zero-ORM. PROV-V-03 cohort closure.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-30T10:24:15Z
- **Completed:** 2026-04-30T10:30:38Z
- **Tasks:** 2 (both `tdd="true"`)
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- **ModelChange shape extension (D-CTX-1 propagation):** `before` and `after` now carry both `hash: string | null` and `hash_unavailable: string | null`. The cross-field state is fully visible to every ModelChange consumer — Phase 14 C2PA, dashboard, future ingredient-graph emitters all branch on the discriminated state without needing to re-read the underlying ModelRef.
- **diffModels surfaces hash↔unavailable transitions:** the `changed` predicate now ORs three conditions (model_name, model_hash, model_hash_unavailable). Every ModelChange's before/after carries both new fields populated. Existing tests (`'model change detected'` at lines 87-127 of diff.test.ts) updated additively to assert both fields populate as null on the pre-fingerprint stable case.
- **5 new transition test cases (`Phase 13 — model_hash_unavailable transitions in diffModels` describe block):**
  - Test A: hash populated → unavailable (e.g., file deleted between v1 and v2)
  - Test B: unavailable → hash (e.g., modelsDir configured between v1 and v2)
  - Test C: unavailable code change (file_not_found → file_unreadable, e.g., I/O permission flip)
  - Test D: identical entries with both fields null produce no ModelChange
  - Test E: identical entries with same populated hash produce no ModelChange (post-fingerprint stability)
- **loadDiffSnapshot reads post-fingerprint view:** the legacy try/catch JSON.parse block on `completed_event.models_json` is REPLACED with a single line: `const models = this.provenanceRepo.getLatestFingerprints(versionId)`. getLatestFingerprints prefers the latest fingerprinted event with built-in fall-through to the completed event, so pre-Phase-13 rows behave unchanged. Malformed-JSON / non-array fail-soft contract is delegated to getLatestFingerprints (T-13-12 mitigation already asserted by Plan 13-02's repo tests).
- **5 end-to-end integration tests at `src/engine/__tests__/model-fingerprint-integration.test.ts`:**
  - Test 1 (criterion #1, populated path): VFX_FAMILIAR_MODELS_DIR set with fixture files → both ModelRefs in getLatestFingerprints carry lowercase 64-hex `model_hash` and `model_hash_unavailable: null`.
  - Test 2 (criterion #2, Cloud-only path): modelsDir unset → both entries carry `model_hash: null` and `model_hash_unavailable: 'models_dir_not_configured'`.
  - Test 3 (criterion #3, content-addressed): two distinct version_ids referencing the same checkpoint file produce identical hashes — `v1[0].model_hash === v2[0].model_hash`. Same bytes → same hash regardless of version_id.
  - Test 4 (diff boundary post-fingerprint read): Engine.diffVersions surfaces populated `before.hash` AND `after.hash` (both lowercase 64-hex) AND `before.hash_unavailable === null` AND `after.hash_unavailable === null` after the fingerprinter runs for both versions. Proves loadDiffSnapshot reads from getLatestFingerprints rather than the all-null completed_event.models_json.
  - Test 5 (mixed state in diff): hash → unavailable transition surfaces in version.diff after v1 fingerprints normally and v2 receives an explicit appendModelsFingerprintedEvent with the unavailable shape. ModelChange has `before.hash` populated and `after.hash_unavailable === 'models_dir_not_configured'`.
- **3 new file-level architecture-purity assertions for `src/engine/model-fingerprint.ts`:** zero @modelcontextprotocol/sdk imports, zero better-sqlite3 imports, zero drizzle-orm imports (PROV-V-03 — criterion #5). The directory-wide src/engine/ guard at line 34 already covers it transitively; file-level assertions fire in isolation if a regression is introduced to this one file.
- **Test count delta: +13 root-suite (5 diff transition + 5 integration + 3 architecture-purity).** Real root-suite passing: 868 (Plan 13-02 baseline 856 + 12 net delta when IT-20 ENOTEMPTY flake passes; +13 when it fails). 5 pre-existing v1.1-audit failures unchanged. tsc --noEmit clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend ModelChange shape + teach diffModels to compare model_hash_unavailable** — `0f57275` (feat) — TDD: RED-then-GREEN. Started by updating diff.test.ts (existing 'model change detected' test asserts the new fields populate as null; 5 new transition tests A-E). RED: 4 of the 5 new tests fail because ModelChange.before/after lack `hash_unavailable` and diffModels does not yet OR on the third field. GREEN: extended the ModelChange interface in src/types/provenance.ts and updated the diffModels body in src/engine/diff.ts to populate both new fields and OR on all three triggers. 25/25 diff tests pass; tsc clean.
2. **Task 2: Update loadDiffSnapshot + integration tests + architecture-purity assertion** — `185b6bd` (feat) — TDD: created src/engine/__tests__/model-fingerprint-integration.test.ts with 5 tests (Tests 1-3 pass independently of the loadDiffSnapshot change; Tests 4-5 RED until the change lands). Replaced the loadDiffSnapshot try/catch JSON.parse with a single getLatestFingerprints call; Tests 4-5 GREEN. Added 3 file-level architecture-purity assertions for src/engine/model-fingerprint.ts. 80/80 in the touched test surface pass; tsc clean; full root suite 868 passing.

## Files Created/Modified

- `src/types/provenance.ts` — `ModelChange.before` and `.after` extended with `hash_unavailable: string | null`. JSDoc updated to reference D-CTX-1 + Phase 13. The pre-existing `model_hash_unavailable` field on ModelRef (added in Plan 13-01) is reused — same vocabulary on both sides of the diff boundary.
- `src/engine/diff.ts` — `diffModels` body updated. The `changed` boolean now ORs three conditions; the `before` / `after` objects always populate `hash` and `hash_unavailable`. Inline comment documents the Phase 14 C2PA story.
- `src/engine/__tests__/diff.test.ts` — Existing 'model change detected' test gained 4 new asserts (`before.hash`, `before.hash_unavailable`, `after.hash`, `after.hash_unavailable` all null on the no-fingerprint case). New `describe('Phase 13 — model_hash_unavailable transitions in diffModels')` block with 5 tests (A-E).
- `src/engine/pipeline.ts` — `loadDiffSnapshot` legacy try/catch JSON.parse block (lines 622-629 in pre-13-03 state) REPLACED with a single line `const models: ModelRef[] | null = this.provenanceRepo.getLatestFingerprints(versionId)`. Inline comment documents the Phase 13 PROV-V-03 contract and the fall-through behavior. The `completed` local variable is still used for prompt_json + seed reads — only the models_json branch is replaced.
- `src/engine/__tests__/model-fingerprint-integration.test.ts` (NEW) — 5 end-to-end tests + a `setupEngine` helper mirroring the Plan 13-02 helper at pipeline-fingerprint.test.ts. Uses `makeInMemoryDb` from src/test-utils/fixtures.ts + FakeComfyUIClient. Tests 1, 3, 4 use a tmpdir with fixture files; Test 2 uses modelsDir=null; Test 5 uses appendModelsFingerprintedEvent directly to set up the v2 unavailable shape.
- `src/__tests__/architecture-purity.test.ts` — 3 new file-level assertions for src/engine/model-fingerprint.ts inserted after the Phase 4 file-level block (after the metadata-repo.ts assertion). Mirrors the Phase 4 src/engine/assets.ts pattern at line 70.

## Decisions Made

- **Test 5 (mixed state) uses appendModelsFingerprintedEvent directly for v2 rather than two engine instances.** Two engines with different modelsDir would produce the same artifact but add wiring complexity; the test's intent is to assert that hash → unavailable transitions flow through diffVersions, not to exercise the full env-var threading. Documented in the test's inline comment.
- **loadDiffSnapshot replacement is exactly one line.** The legacy try/catch JSON.parse is delegated to getLatestFingerprints (T-13-12 mitigation already proven in Plan 13-02 repo tests). Keeps the engine layer free of duplicate parse/degrade logic.
- **ModelChange's `before.hash` and `before.hash_unavailable` (and `after.*`) always populate, regardless of which field triggered the diff.** Consumers branch on whichever is non-null per D-CTX-1. Simpler than emitting only the changed field, which would force consumers to do a sibling-field re-read anyway.
- **Three file-level architecture-purity assertions are duplicative on the happy path but invaluable on regression.** The directory-wide guard at line 34 already covers `src/engine/model-fingerprint.ts` transitively. The file-level versions fire with a file-specific test name when a regression is introduced, making the failure source obvious. Mirror of the Phase 4 src/engine/assets.ts + src/store/tag-repo.ts + src/store/metadata-repo.ts pattern at lines 70-80.
- **TDD across two adjacent tasks.** Task 1 RED proved the type extension was missing on the in-memory diffModels surface. Task 2 RED (Tests 4 + 5 only — Tests 1-3 are independent unit-level) proved the loadDiffSnapshot read path was still pre-fingerprint. Both REDs landed under the same overarching Phase 13 thesis: post-fingerprint view propagates through every diff boundary.

## Deviations from Plan

None - plan executed exactly as written.

The plan's `<action>` blocks for both tasks were precise and required no deviations:
- Task 1's TDD flow (update existing test → add new transition tests → RED → extend type → extend diffModels → GREEN) ran cleanly with 4 expected RED failures resolving to 25/25 GREEN.
- Task 2's three sub-actions (loadDiffSnapshot one-line replacement, new integration test file, three file-level architecture-purity assertions) all landed without modification. Tests 4 + 5 RED before the loadDiffSnapshot change, GREEN after.

## Issues Encountered

- **One flaky test in the shared-suite run:** `generation-tool.test.ts > IT-20` ENOTEMPTY rmdir race in a tmp directory — the same documented flake seen in Plans 13-01 + 13-02 SUMMARY (`Initial baseline run reported ... a 6th failure ... ENOTEMPTY rmdir race`). Re-running the file in isolation gives 31/31 pass. Real test count: 868 passing / 5 pre-existing v1.1-audit failures / 3 skipped (when IT-20 passes, which it does in isolation). No production-code change required; flake is in the test fixture cleanup path.
- **No other surprises.** The plan's `<interfaces>` block was accurate — ModelChange / diffModels / loadDiffSnapshot lines matched the actual file. The Plan 13-02 anchor IDs (`getLatestFingerprints`, `appendModelsFingerprintedEvent`, `Engine.fingerprintModelsForVersion`) all resolved as documented.

## Verification

- **Diff tests:** `npx vitest run src/engine/__tests__/diff.test.ts` → 25/25 pass (20 pre-existing + 5 new transition tests).
- **Integration tests:** `npx vitest run src/engine/__tests__/model-fingerprint-integration.test.ts` → 5/5 pass.
- **Architecture-purity tests:** `npx vitest run src/__tests__/architecture-purity.test.ts` → 21/21 pass (18 pre-existing + 3 new file-level assertions for src/engine/model-fingerprint.ts).
- **No regressions:** `npx vitest run src/engine/__tests__/pipeline.test.ts src/engine/__tests__/pipeline-fingerprint.test.ts` → 38 + 6 = 44/44 pass byte-unchanged. The loadDiffSnapshot change is observationally equivalent for pre-Phase-13 rows because getLatestFingerprints falls through to the completed event when no fingerprinted sibling exists.
- **TypeScript:** `npx tsc --noEmit -p .` exits 0.
- **Root suite:** 868 passing / 5 pre-existing v1.1-audit failures / 3 skipped (when IT-20 isolation-passes; on shared-suite runs the IT-20 flake brings the total to 6 failing). +13 net new passing tests vs Plan 13-02 baseline 856.
- **Plan-level grep gates (all pass):**
  - `grep "hash_unavailable" src/types/provenance.ts` → 5 matches (≥3 required).
  - `grep "model_hash_unavailable" src/engine/diff.ts` → 3 matches (≥1 required).
  - `grep "hash_unavailable" src/engine/diff.ts` → 4 matches (≥3 required).
  - `grep "getLatestFingerprints" src/engine/pipeline.ts` → 3 matches (≥1 required — new line 627 + Plan 13-02's 2 matches at 710/717).
  - `grep "model-fingerprint.ts" src/__tests__/architecture-purity.test.ts` → 6 matches (≥3 required).
  - `grep -E "@modelcontextprotocol/sdk" src/engine/model-fingerprint.ts` → 0 matches (purity preserved).

## ROADMAP Success Criterion → Test Mapping

The Phase 13 success criteria from `.planning/ROADMAP.md` lines 95-99 now have automated coverage across Plans 13-01 + 13-02 + 13-03:

| Criterion | Test File(s) | Test Name(s) |
|-----------|--------------|--------------|
| #1 (every model has populated `model_hash`) | model-fingerprint.test.ts (Plan 13-01), pipeline-fingerprint.test.ts Test 2 (Plan 13-02), model-fingerprint-integration.test.ts Tests 1 + 4 (Plan 13-03) | `'populates model_hash when modelsDir is set and files exist'`, `'submit→completed→fingerprint flow populates model_hash when VFX_FAMILIAR_MODELS_DIR is set'`, `'engine.diffVersions reads populated hashes after fingerprinter runs'` |
| #2 (typed `model_hash_unavailable` reasons) | model-fingerprint.test.ts (Plan 13-01 — 3 reason-code unit tests), pipeline-fingerprint.test.ts Test 1 (Plan 13-02), model-fingerprint-integration.test.ts Test 2 + 5 (Plan 13-03) | `'records models_dir_not_configured when modelsDir is null'`, `'submit→completed→fingerprint flow records models_dir_not_configured when VFX_FAMILIAR_MODELS_DIR is unset'`, `'a hash → unavailable transition surfaces in version.diff'` |
| #3 (content-addressed across versions) | model-fingerprint.test.ts (Plan 13-01 — 2 same-bytes tests), model-fingerprint-integration.test.ts Test 3 (Plan 13-03) | `'two versions referencing the same checkpoint produce identical model_hash entries'` |
| #4 (hot-path isolation, retries on transient I/O) | model-fingerprint.test.ts (Plan 13-01 — retry tests), pipeline-fingerprint.test.ts Test 4 (Plan 13-02 — `'completion path does not block on fingerprinting'`) | Plan 13-02's hot-path-isolation test asserts zero fingerprinted events at the moment getGenerationStatus returns 'completed'. Retry tests in 13-01 prove non-ENOENT I/O retries up to 3 attempts. |
| #5 (architecture-purity preserved) | architecture-purity.test.ts file-level assertions (Plan 13-03 — 3 new tests) | `'src/engine/model-fingerprint.ts has zero imports from @modelcontextprotocol/sdk'`, `'... better-sqlite3'`, `'... drizzle-orm'` |

## Anchor IDs for Phase 14

The following symbols / shapes are now stable and referenced by Phase 14 (C2PA Signed Manifest Emission):

- **`getLatestFingerprints`** (src/store/provenance-repo.ts:144) — `(versionId: string) => ModelRef[] | null`. Phase 14's manifest emission reads this to populate the ingredient-graph fingerprints baseline. Returns null when no fingerprints exist yet (pre-Phase-13 rows or fingerprinter not yet run).
- **`ModelRef.model_hash`** (src/types/provenance.ts:35) — `string | null`. Lowercase 64-hex SHA-256 when populated.
- **`ModelRef.model_hash_unavailable`** (src/types/provenance.ts:36) — `string | null`. One of four typed reason codes (D-CTX-5): `'models_dir_not_configured'` | `'file_not_found'` | `'file_unreadable'` | `'unsupported_class_type'`.
- **`ModelChange.before / .after`** (src/types/provenance.ts:54-63) — `{ name: string; hash: string | null; hash_unavailable: string | null }`. Phase 14's "manifest delta between v1 and v2" surface (if any) reads from this shape.
- **`Engine.loadDiffSnapshot`** (src/engine/pipeline.ts:605) — private; reads via `getLatestFingerprints` so DiffSnapshot.models_json carries the post-fingerprint view. Phase 14 should NOT call this directly; use `Engine.diffVersions` for the public contract.

## Next Plan Readiness

**Phase 13 closure:** All three plans complete. PROV-V-03 ready to mark complete in `.planning/REQUIREMENTS.md` (cohort-level requirement). Phase 13 ROADMAP row ready to flip from `[ ]` to `[x]` with completion date 2026-04-30.

**Phase 14 (C2PA Signed Manifest Emission) ready to start:** the manifest's ingredient-graph baseline reads `getLatestFingerprints(versionId)` as the canonical source of model fingerprints. ModelRef.model_hash + ModelRef.model_hash_unavailable are stable and typed. The downstream surface (Phase 15 ingredient graph, Phase 16 redaction) layers on top of Phase 14's manifest scaffolding.

## Self-Check: PASSED

All claimed files and commits verified on disk and in git history.

- `src/engine/__tests__/model-fingerprint-integration.test.ts` exists.
- `src/types/provenance.ts` modified.
- `src/engine/diff.ts` modified.
- `src/engine/__tests__/diff.test.ts` modified.
- `src/engine/pipeline.ts` modified.
- `src/__tests__/architecture-purity.test.ts` modified.
- Commit `0f57275` (Task 1) in git log.
- Commit `185b6bd` (Task 2) in git log.

---
*Phase: 13-model-fingerprinting*
*Plan: 03*
*Completed: 2026-04-30*
