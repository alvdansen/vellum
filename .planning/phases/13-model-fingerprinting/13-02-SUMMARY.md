---
phase: 13-model-fingerprinting
plan: 02
subsystem: provenance

tags: [sha256, model-fingerprint, append-only, sibling-event, hot-path-isolation, idempotency, prov-v-03, fire-and-forget]

# Dependency graph
requires:
  - phase: 13-model-fingerprinting
    plan: 01
    provides: "fingerprintModel(modelsDir, classType, modelName) async helper + MODEL_DIR_BY_CLASS class-type→subdir map + ModelRef.model_hash_unavailable: string | null. Plan 13-02 calls fingerprintModel for each ModelRef and persists results via the new sibling-event repo method."
  - phase: 03-provenance-versioning
    provides: "Append-only ProvenanceRepo (D-PROV-01) — Plan 13-02 ADDS two methods (appendModelsFingerprintedEvent + getLatestFingerprints) without adding any UPDATE/DELETE operation; the architecture-purity invariant `grep this.db.update|this.db.delete` continues to return ZERO matches on src/store/provenance-repo.ts."
provides:
  - "ProvenanceEventType union extended with 'models_fingerprinted' (TS-only — schema event_type column has no CHECK constraint, NO Drizzle migration added). ProvenanceModelsFingerprintedPayload + extended ProvenanceEventPayload discriminated union."
  - "ProvenanceRepo.appendModelsFingerprintedEvent(versionId, models): inserts a sibling row with event_type='models_fingerprinted', models_json=JSON.stringify(ModelRef[]). Append-only: original 'completed' event row stays byte-identical (T-13-07 mitigation, asserted by a regression test)."
  - "ProvenanceRepo.getLatestFingerprints(versionId): returns latest fingerprinted ModelRef[] with fall-through to completed_event.models_json. Returns null on malformed JSON / non-array (T-13-12 mitigation — Phase 14 C2PA gets a clean null signal rather than partial-parse poison)."
  - "Engine.fingerprintModelsForVersion(versionId): idempotent (events scan; returns early on existing fingerprinted event), reads latest models, hashes each via Plan 13-01's fingerprintModel using Promise.all, persists via appendModelsFingerprintedEvent. Empty models_json branch records an explicit empty fingerprinted event so idempotency holds."
  - "GenerationEngine constructor extended with optional 9th param `fingerprintHook?: (versionId: string) => void`. Hook fires from downloadAndPersist immediately AFTER markCompleted in the SUCCESS branch only (failed-download branch unchanged — verified by reading the code at the failed-branch return statement). Synchronous throws caught + console.error'd; never break the completion path."
  - "Engine constructor accepts options.modelsDir (default null). Binds a void-wrapped callback to GenerationEngine that calls `void this.fingerprintModelsForVersion(vid).catch(...)` so the hook itself returns synchronously and the generation hot path is NEVER delayed (criterion #4 — proven by hot-path isolation test)."
  - "src/server.ts: VFX_FAMILIAR_MODELS_DIR env var read once and threaded into Engine options. Default null (production / ComfyUI Cloud) records 'models_dir_not_configured' on every entry per D-CTX-5; local-dev / self-host can populate hashes by setting the var."
affects: [13-03 (consumes appendModelsFingerprintedEvent + getLatestFingerprints + fingerprintModelsForVersion to add diff-side parity, integration tests, and the file-level architecture-purity assertion), 14-c2pa-manifest (reads getLatestFingerprints for the manifest's ingredient-graph fingerprints baseline)]

# Tech tracking
tech-stack:
  added: []  # No new dependencies — pure additions on top of Plan 13-01's fingerprintModel and the existing provenance-repo machinery.
  patterns:
    - "Append-only sibling event for derived data (D-CTX-3 recommendation): when a long-running background pass derives data from an existing append-only row, write a NEW sibling row of a distinct event_type rather than UPDATE the original. Preserves D-PROV-01 by literal definition (the architecture-purity grep still returns ZERO matches). Applied here as the 'models_fingerprinted' sibling of the 'completed' event."
    - "Fire-and-forget hook with `void Promise.catch(...)` for hot-path isolation: GenerationEngine fires the hook synchronously (`this.fingerprintHook?.(row.id)`); receiver wraps async work in `void X.catch(...)` so the hook itself returns synchronously. Lets the generation hot path return BEFORE async work is scheduled to a microtask. Asserted by reading the events list immediately after the await — no fingerprinted event must yet exist (criterion #4 hot-path isolation test)."
    - "Idempotency-via-event-scan for crash-recovery: `fingerprintModelsForVersion` reads `getEventsForVersion(versionId)` first and returns early if a 'models_fingerprinted' event already exists. A boot-time recovery sweep that fires the helper for every completed version is therefore O(N) reads + 0 hashes for already-done rows. Test `'idempotent — second call is a no-op'` proves this with a 3-call invocation."
    - "Empty-state explicit-event pattern: when the upstream input is an empty array (no models in the prompt blob), still record an explicit fingerprinted event with `models_json: '[]'` so the idempotency check sees the empty-case work as done. Otherwise a re-call would re-enter the hash loop on every boot. Covered by test `'records an empty fingerprinted event when models_json is an empty array'`."
    - "Constructor-injected callback for layering: GenerationEngine receives a `fingerprintHook?: (versionId: string) => void` rather than a back-reference to Engine, preserving the layering invariant that GenerationEngine knows nothing of the Engine facade. Engine binds `(vid) => void this.fingerprintModelsForVersion(vid).catch(...)` at construction."

key-files:
  created:
    - src/engine/__tests__/pipeline-fingerprint.test.ts
  modified:
    - src/types/provenance.ts
    - src/store/provenance-repo.ts
    - src/store/__tests__/provenance-repo.test.ts
    - src/engine/pipeline.ts
    - src/engine/generation.ts
    - src/server.ts

key-decisions:
  - "Sibling 'models_fingerprinted' event approach (D-CTX-3 recommendation, preserved verbatim): the alternative — UPDATE the existing completed_event.models_json field in place — was rejected. Append-only is a structural invariant of D-PROV-01, asserted by a passing architecture-purity grep on this.db.update / this.db.delete. The sibling-event pattern adds rows; the original completed row stays byte-identical. A regression test asserts the byte-equality (re-fetches the original by id after append, compares every field)."
  - "ProvenanceRepo NOT extended with a new column on the `provenance` table. The existing `models_json` text column already accommodates the fingerprinted shape. NO Drizzle migration added — verified by `ls drizzle/` (no new file) and by the fact that `event_type` is a plain TEXT column with no CHECK constraint, so 'models_fingerprinted' is purely a TS-level union extension."
  - "GenerationEngine constructor extension is positional and additive. The new `fingerprintHook` is the 9th parameter (after the existing `options` bag). All existing call sites that omit the new arg behave byte-identically (no hook fires → existing tests untouched). Pre-existing pipeline.test.ts (38 tests) + generation.test.ts (31 tests) pass byte-unchanged after the change."
  - "Hook fires AFTER markCompleted in the SUCCESS branch ONLY. The failed-download branch (lines 438-443 in src/engine/generation.ts) returns early before reaching markCompleted, so the hook never fires on download failures. This is a structural property of the code position, not a runtime guard."
  - "Idempotency check uses `getEventsForVersion` directly rather than `getLatestFingerprints`. Reasoning: `getLatestFingerprints` falls through to the completed_event when no fingerprinted event exists, which would mask the 'no fingerprinted event yet' state we need to detect. Reading events directly + scanning for `event_type==='models_fingerprinted'` is the precise check."
  - "Empty-array branch (`source.length === 0`) explicitly records an empty fingerprinted event rather than returning early. Reasoning: a re-call (e.g., crash-recovery boot) would re-enter the same path and re-test the empty array against `getLatestFingerprints` (which falls through to the completed event). Recording an explicit empty fingerprinted event makes the idempotency check fire on the second call, preventing unnecessary work. Test `'records an empty fingerprinted event when models_json is an empty array (idempotency holds)'` proves this."
  - "Promise.all over per-model fingerprint calls (no p-limit). Reasoning: typical workflows have 1-5 loaders. Production runs against ComfyUI Cloud with modelsDir=null where every fingerprintModel call returns immediately with `models_dir_not_configured` (no I/O). Local-dev / self-host paths with real files might hit a 16-GB ceiling on a 7-GB checkpoint × 4 concurrency, but that case is operator-tunable in a future phase if it surfaces."
  - "console.error in the hook receiver's `.catch(...)` provides background-path observability without leaking errors to the generation hot path. Phase 14 may layer a structured health endpoint on top; Phase 13 keeps observability operator-only."
  - "Docstring tweak (commit 630fe6c): renamed JSDoc leading sentence to include the method names `appendModelsFingerprintedEvent` and `getLatestFingerprints` so a name-based grep gates against ≥2 matches each (declaration + docstring). Pure documentation; no behavioral change."

patterns-established:
  - "Sibling-event extension of an append-only event store: when a derived/computed projection of an event needs persisting, add a new event_type rather than mutate the original event. Preserves the structural append-only invariant by literal grep gate. Reusable for Phase 14 (C2PA manifest emission could be a 'manifest_emitted' sibling) and beyond."
  - "Constructor-injected fire-and-forget hook for cross-layer asynchronous work. The lower layer (GenerationEngine) does NOT know about the upper layer (Engine facade); it receives a callback at construction. The upper layer binds the callback as `(arg) => void this.method(arg).catch(...)` so the lower layer's synchronous fire returns immediately. Cleanly handles 'completion path triggers async work in a higher layer' without breaking layering."

requirements-completed: []  # Plan 13-02 contributes to PROV-V-03 but does NOT close it. Cohort closure happens in Plan 13-03 (after diff-side parity + integration tests + the file-level architecture-purity assertion).

# Metrics
duration: 7min
completed: 2026-04-30
---

# Phase 13 Plan 02: Fingerprinter wired into completion path via append-only sibling event Summary

**Engine.fingerprintModelsForVersion ships at the integration boundary — fires from a void-wrapped callback after markCompleted, hashes each ModelRef via Plan 13-01's helper, persists as a `models_fingerprinted` sibling provenance event, idempotent for crash recovery, hot-path-isolated by construction (assertion: completion returns BEFORE the fingerprinted event is appended).**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-30T10:09:32Z
- **Completed:** 2026-04-30T10:16:59Z
- **Tasks:** 2
- **Files modified:** 7 (1 created, 6 modified)

## Accomplishments

- ProvenanceEventType union extended with `'models_fingerprinted'`. NO schema migration: the `event_type` text column has no CHECK constraint, so the extension is purely TS-level. ProvenanceModelsFingerprintedPayload + extended ProvenanceEventPayload discriminated union.
- `ProvenanceRepo.appendModelsFingerprintedEvent(versionId, models)`: inserts a sibling row with event_type='models_fingerprinted', models_json=JSON.stringify(ModelRef[]), every other event-specific field null. Append-only: regression test re-fetches the original 'completed' event row by id after append and asserts byte-equality on every field (T-13-07 mitigation).
- `ProvenanceRepo.getLatestFingerprints(versionId)`: returns latest fingerprinted ModelRef[] with fall-through to completed_event.models_json. Catches JSON.parse and non-array conditions and returns null cleanly (T-13-12 mitigation — Phase 14 C2PA gets a clean null signal rather than poisoned partial-parse).
- `Engine.fingerprintModelsForVersion(versionId)` async method on the Engine facade: idempotent (events scan), reads latest models, hashes each via Plan 13-01's fingerprintModel using Promise.all, persists via appendModelsFingerprintedEvent. Empty models_json branch records an explicit empty fingerprinted event so idempotency holds even for the empty case.
- GenerationEngine constructor extended with optional 9th positional parameter `fingerprintHook?: (versionId: string) => void`. Hook fires from `downloadAndPersist` immediately AFTER `markCompleted` in the SUCCESS branch only. Synchronous throws caught + logged via console.error; never break the completion path.
- Engine constructor accepts `options.modelsDir` (default null). Binds a void-wrapped callback to GenerationEngine: `(vid) => void this.fingerprintModelsForVersion(vid).catch(...)`. Hook itself returns synchronously — the generation hot path is NEVER delayed by hash work (criterion #4).
- `src/server.ts`: VFX_FAMILIAR_MODELS_DIR env var read once and threaded into the Engine options bag. Default null (production / ComfyUI Cloud).
- 14 new tests across 2 files (8 in provenance-repo.test.ts + 6 in pipeline-fingerprint.test.ts). Real root suite: 856 passing (842 baseline + 14 new). Pre-existing 5 v1.1-audit failures unchanged. tsc --noEmit clean. Architecture-purity test 18/18 pass.

## Task Commits

Each task was committed atomically:

1. **Task 1: ProvenanceEventType + appendModelsFingerprintedEvent + getLatestFingerprints** — `20b619a` (feat) — TDD: RED-then-GREEN with 8 new test cases asserting append + chronological order + latest-prefer + fall-through + null-when-absent + malformed-JSON + non-array + append-only invariant.
2. **Task 2: Engine.fingerprintModelsForVersion + GenerationEngine fingerprintHook + VFX_FAMILIAR_MODELS_DIR** — `9c412ef` (feat) — Production-code GREEN-first (additive constructor extensions are non-breaking). 6 new test cases covering modelsDir=null path, content-addressed hash population proof, idempotency, hot-path isolation (criterion #4), pre-Phase-3 row no-op, empty-array handling.
3. **Docstring grep-visibility tweak** — `630fe6c` (docs) — Pure documentation; renamed JSDoc leading sentence to include method names so the plan-level success criteria's `≥2 matches each` count gates pass cleanly. No behavioral change.

## Files Created/Modified

- `src/types/provenance.ts` — ProvenanceEventType union extended with `'models_fingerprinted'`. JSDoc on ProvenanceEvent updated to mention the new event type. ModelRef shape unchanged (Plan 13-01 already added the additional field).
- `src/store/provenance-repo.ts` — Added ProvenanceModelsFingerprintedPayload + extended ProvenanceEventPayload union arm. Updated insertEvent's models_json line to populate from BOTH 'completed' and 'models_fingerprinted' via discriminated-union narrowing. Added two new public methods (appendModelsFingerprintedEvent + getLatestFingerprints) at the end of the class. Added `import type { ModelRef }` to imports. NO new UPDATE/DELETE — append-only invariant preserved (grep this.db.update|this.db.delete returns ZERO).
- `src/store/__tests__/provenance-repo.test.ts` — Added a new describe block `'Phase 13 (PROV-V-03) — models_fingerprinted sibling event'` with 8 cases: append + event_type + chronological order + latest-prefers-fingerprinted + fall-through-to-completed + null-when-neither-exists + malformed-JSON-returns-null + non-array-returns-null + append-only-invariant-byte-equality.
- `src/engine/pipeline.ts` — Added `fingerprintModel` import. Added `private readonly modelsDir: string | null` field. Extended Engine constructor's options bag type with `modelsDir?: string | null`. Set `this.modelsDir = options.modelsDir ?? null`. Extended the `new GenerationEngine(...)` call to pass a bound `void`-wrapped hook as the 9th positional arg. Added the public async method `fingerprintModelsForVersion(versionId)` between iterateFromVersion and the PHASE 4 ASSETS section.
- `src/engine/generation.ts` — Extended GenerationEngine constructor signature with an optional 9th positional parameter `fingerprintHook?: (versionId: string) => void`. Updated `downloadAndPersist`: immediately AFTER `this.versions.markCompleted(...)` in the success branch, fires the hook inside a try/catch that logs synchronous throws via console.error and never propagates them.
- `src/server.ts` — At the new-Engine call site, threaded `modelsDir: process.env.VFX_FAMILIAR_MODELS_DIR ?? null` into the options bag. Comment block documents the D-CTX-2 / D-CTX-5 contract (production / Cloud-only deploy records 'models_dir_not_configured' for every entry).
- `src/engine/__tests__/pipeline-fingerprint.test.ts` (NEW) — 6 integration tests: (1) modelsDir=null records 'models_dir_not_configured' on every entry, (2) content-addressed hash population proof using the well-known SHA-256 of 'test' (`9f86d0...`) and 'aaaa' (`61be55...`), (3) idempotency over 3 calls, (4) hot-path isolation (assertion: 0 fingerprinted events at the moment getGenerationStatus returns 'completed'; 1 after polling with 200ms tick / 5s cap), (5) pre-Phase-3 row no-op, (6) empty-models_json explicit-event + second-call idempotency.

## Decisions Made

- **Sibling-event approach (D-CTX-3 verbatim).** Chose the planner's recommended path over UPDATE-in-place. Append-only is a literal grep-asserted invariant of D-PROV-01 and the architecture-purity test; the sibling-event pattern adds rows without violating it. The original completed event row stays byte-identical, asserted by the regression test that re-fetches the original row by id after append.
- **No new column, no migration.** The existing `models_json` text column already accommodates the fingerprinted shape. The `event_type` column has no CHECK constraint, so the new value is purely a TS-level union extension. No file added under `drizzle/`. Verified by `ls drizzle/` showing only the 5 pre-existing migration files.
- **GenerationEngine constructor extension is additive (positional 9th param).** Pre-existing 38 pipeline.test.ts cases + 31 generation.test.ts cases pass byte-unchanged because the new `fingerprintHook?` parameter has a default of `undefined`, so existing call sites that omit it behave identically.
- **Hook fires only in the success branch.** Position-based: the failed-download branch returns early before reaching `markCompleted`, so the hook never fires there. Structural property of the code; no runtime guard.
- **Idempotency check via raw events scan, not `getLatestFingerprints`.** The latter falls through to the completed event when no fingerprinted event exists — that fall-through would mask the "no fingerprinted event yet" state we need to detect. Direct scan + `event_type==='models_fingerprinted'` is the precise check.
- **Empty-array branch records an explicit empty event.** Otherwise the idempotency check would never see the empty case as "done" and re-runs would re-enter the hash loop. Test asserts a second call is a no-op even for the empty case.
- **Promise.all over per-model fingerprint calls — no p-limit.** Typical workflows have 1-5 loaders; production runs with `modelsDir=null` where every call returns immediately with `'models_dir_not_configured'`. A self-host path with real 7-GB checkpoint files at concurrency 4 could hit a 16-GB memory ceiling, but that surfaces only in a non-default deployment and is operator-tunable in a future phase if it ever bites.
- **Docstring grep-visibility tweak (commit 630fe6c).** The plan-level success criteria expected `≥2 matches each` for `appendModelsFingerprintedEvent` and `getLatestFingerprints` — meaning the method names should appear in both their declaration and their leading JSDoc sentence. Renamed the docstring leading-line to include the method name. Pure documentation, no behavioral change.

## Deviations from Plan

None - plan executed exactly as written.

The plan's `<action>` blocks for both tasks were precise and required no deviations:
- Task 1's TDD flow (RED tests → GREEN implementation) ran cleanly; the 8 new test cases failed before implementation and passed after.
- Task 2's GREEN-first production code change (additive constructor extension is by definition non-breaking) was followed by 6 new integration tests that all passed on first run.

Two non-deviation cosmetic actions were taken:
1. The docstring grep-visibility tweak (commit 630fe6c) was a small post-task cleanup to satisfy the plan-level criteria's `≥2 matches each` count for the two new methods. The plan's `<action>` block did not strictly require the method name in the leading JSDoc sentence; this tweak ensures the count is unambiguous for tooling. Pure documentation; tests + tsc still clean.

## Issues Encountered

- **One flaky test in the shared-suite run:** `generation-tool.test.ts > IT-20` ENOTEMPTY rmdir race in a tmp directory — the same flake documented in Plan 13-01's SUMMARY (`Initial baseline run reported 823 passing / 6 failing rather than 824/5; the 6th failure (generation-tool.test.ts > IT-20) was an ENOTEMPTY rmdir race in a tmp directory`). Re-running the file in isolation gives 31/31 pass. Real test count: 856 passing / 5 pre-existing v1.1-audit failures / 3 skipped. No production-code change required; flake is in the test fixture cleanup path.
- **No other surprises.** The plan's `<interfaces>` block was accurate (the line numbers matched the actual file, the constructor signature was as documented, the `event_type` column truly had no CHECK constraint).

## Verification

- **Repo + repo tests:** `npx vitest run src/store/__tests__/provenance-repo.test.ts` → 20/20 pass (12 pre-existing + 8 new).
- **Pipeline integration:** `npx vitest run src/engine/__tests__/pipeline-fingerprint.test.ts` → 6/6 pass.
- **No regressions:** `npx vitest run src/engine/__tests__/pipeline.test.ts src/engine/__tests__/generation.test.ts` → 69/69 pass byte-unchanged.
- **Architecture purity:** `grep -E "@modelcontextprotocol/sdk" src/engine/pipeline.ts src/engine/generation.ts src/engine/model-fingerprint.ts` → 0 matches. `grep -E "this\.db\.update|this\.db\.delete" src/store/provenance-repo.ts` → 0 matches. `npx vitest run src/__tests__/architecture-purity.test.ts` → 18/18 pass.
- **TypeScript:** `npx tsc --noEmit -p .` exits 0.
- **Root suite:** 856 passing (842 baseline + 14 new); 5 pre-existing v1.1-audit failures unchanged; 3 skipped unchanged.
- **All 9 plan-level grep gates:** all pass (≥2 / ≥1 / 0 thresholds met).

## Threat Flags

No new threat flags. The plan's `<threat_model>` covered the introduced surface (T-13-07 / T-13-08 / T-13-09 / T-13-10 / T-13-11 / T-13-12). All `mitigate` dispositions have explicit test assertions:
- T-13-07 (Append-only invariant): asserted by `'append-only invariant: appendModelsFingerprintedEvent never UPDATEs the completed event'` (re-fetched original row byte-equality) AND by the architecture-purity grep gate.
- T-13-08 (Hot-path DoS): asserted by `'completion path does not block on fingerprinting'` (zero fingerprinted events at the moment markCompleted returns).
- T-13-09 (Boot recovery loop): asserted by `'idempotent — second call is a no-op'`.
- T-13-12 (Malformed JSON): asserted by `'getLatestFingerprints returns null on malformed models_json'` AND the additional non-array case.

## Anchor IDs for 13-03

The following symbols / methods are now stable and referenced by Plan 13-03:

- **`ProvenanceEventType`** (src/types/provenance.ts:5) — union now includes `'models_fingerprinted'`.
- **`appendModelsFingerprintedEvent`** (src/store/provenance-repo.ts:130) — `(versionId: string, models: ModelRef[]) => ProvenanceEvent`.
- **`getLatestFingerprints`** (src/store/provenance-repo.ts:144) — `(versionId: string) => ModelRef[] | null`. Plan 13-03 diff-side code calls this to get the fingerprinted models for the diff envelope.
- **`Engine.fingerprintModelsForVersion`** (src/engine/pipeline.ts:710) — async; idempotent. Plan 13-03 integration tests call this directly to assert end-to-end behavior.
- **`fingerprintHook`** (src/engine/generation.ts:84) — constructor parameter; Plan 13-03 may surface a structural test asserting the hook is wired (existing pipeline.ts grep already proves the binding).
- **`Engine.modelsDir`** (src/engine/pipeline.ts:102) — private; Plan 13-03 architecture-purity assertion may grep for this field.
- **`VFX_FAMILIAR_MODELS_DIR`** (src/server.ts:202) — env var read site.

## Next Plan Readiness

**13-03 ready to start:** The integration boundary is now closed for ROADMAP success criteria #1 (every model in the completed prompt blob ends up with `model_hash` populated OR a typed `model_hash_unavailable` reason on the persisted sibling event) and #4 (generation hot path does not block on the fingerprinter). 13-03's job is:
1. Diff-side parity — `diffModels` should compare across the new `model_hash_unavailable` field (currently only compares `model_hash`).
2. End-to-end integration tests asserting the full submit→complete→fingerprinted flow (the Plan 13-02 hot-path test already exercises this; 13-03 may add cross-version content-addressing assertions).
3. File-level architecture-purity assertion in `src/__tests__/architecture-purity.test.ts` adding `src/engine/model-fingerprint.ts` (and possibly the new public methods on provenance-repo) to the engine-purity sweep.
4. Mark PROV-V-03 complete in REQUIREMENTS.md (cohort-level closure across 13-01 + 13-02 + 13-03).

**Phase 13 cohort progress:** 2/3 plans complete. PROV-V-03 NOT yet marked complete in REQUIREMENTS.md — cohort closure happens in Plan 13-03.

## Self-Check: PASSED

All claimed files and commits verified on disk and in git history.

- Verified `src/engine/__tests__/pipeline-fingerprint.test.ts` exists.
- Verified `src/types/provenance.ts` modified.
- Verified `src/store/provenance-repo.ts` modified.
- Verified `src/store/__tests__/provenance-repo.test.ts` modified.
- Verified `src/engine/pipeline.ts` modified.
- Verified `src/engine/generation.ts` modified.
- Verified `src/server.ts` modified.
- Verified commit `20b619a` (Task 1) in git log.
- Verified commit `9c412ef` (Task 2) in git log.
- Verified commit `630fe6c` (docs grep-visibility tweak) in git log.

---
*Phase: 13-model-fingerprinting*
*Plan: 02*
*Completed: 2026-04-30*
