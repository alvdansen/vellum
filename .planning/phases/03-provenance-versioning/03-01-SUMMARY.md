---
phase: 03-provenance-versioning
plan: 01
subsystem: database
tags: [drizzle, sqlite, provenance, append-only, png-metadata, diff-engine, prototype-pollution]

# Dependency graph
requires:
  - phase: 02-comfyui-generation
    provides: VersionRepo, Version type, versions table, openDb/migrate() pipeline, makeInMemoryDb test harness, TypedError, isUniqueViolation pattern
  - phase: 01-foundation-hierarchy
    provides: HierarchyRepo, nanoid-prefixed IDs, Drizzle schema + SCHEMA_DDL split, engine-purity rule

provides:
  - drizzle/0003_phase3_provenance.sql additive migration (provenance table + lineage_type column + idx_provenance_version_time index)
  - src/store/provenance.ts schema declarations (sqliteTable provenance + versions.lineage_type)
  - src/types/provenance.ts canonical types (ProvenanceEvent, ModelRef, IterateOverride, DiffResponse, DiffSnapshot, DiffChanges, ParamChange, ModelChange, SeedChange, WorkflowStructureChange, MetadataChange, DiffInput)
  - src/types/hierarchy.ts Version extended with lineage_type field
  - src/utils/id.ts IdPrefix union extended with 'prov'
  - src/engine/errors.ts ErrorCode union extended with PROVENANCE_UNAVAILABLE, REPRODUCE_BLOCKED, ITERATE_INVALID_PATCH, VERSION_NOT_COMPLETED
  - src/store/provenance-repo.ts append-only ProvenanceRepo (insertEvent, getEventsForVersion, getLatestCompletedEvent, getSubmitEvent) + ProvenanceEventPayload union
  - src/engine/provenance.ts pure module exporting LOADER_CLASS_TYPES, KSAMPLER_CLASS_TYPES, MODEL_FIELD_BY_CLASS, extractModels, extractSeed, ProvenanceWriter
  - src/engine/diff-summary.ts buildSummary (deterministic template, MAX_CHANGES=6, HARD_CAP=400)
  - src/engine/diff.ts diffVersions (D-PROV-15 shape, same-shot + completed-state guards)
  - src/engine/iterate-merge.ts applyOverrides + applySeedShortcut + findKSamplerNodes with FORBIDDEN_KEYS prototype-pollution guard
  - src/comfyui/png-metadata.ts extractTextChunk (PNG tEXt walker)
  - src/store/version-repo.ts insertVersion seeds lineage_type: null on direct submits

affects:
  - 03-02 (Plan 2 integration — wires ProvenanceWriter into generation.submitInternal, consumes extractModels/extractSeed, extends Engine facade)
  - 03-03 (Plan 3 tool surface — builds version tool on top of diffVersions; extends generation tool with reproduce/iterate actions driven by applyOverrides/applySeedShortcut)

# Tech tracking
tech-stack:
  added: []  # Phase 3 added no new deps — pure composition over Phase 1/2 stack (better-sqlite3, drizzle-orm, zod, nanoid)
  patterns:
    - Append-only repo (zero UPDATE/DELETE methods by construction; structural prototype assertion in tests)
    - Pure engine modules (zero MCP imports, zero DB imports — composition via constructor-injected repos)
    - Deterministic summary template (no LLM involvement; stable ordering, elision at N changes)
    - Prototype-pollution guard via FORBIDDEN_KEYS ReadonlySet (rejects __proto__, constructor, prototype on both outer and nested keys)
    - Two-event provenance model (submit + terminal) without intermediate 'running' rows
    - JSON.parse-exposed __proto__ testing (object-literal syntax sets prototype, not own-property, so real attack vector tested via JSON path)

key-files:
  created:
    - drizzle/0003_phase3_provenance.sql
    - drizzle/meta/0003_snapshot.json
    - src/types/provenance.ts
    - src/store/provenance-repo.ts
    - src/engine/provenance.ts
    - src/engine/diff.ts
    - src/engine/diff-summary.ts
    - src/engine/iterate-merge.ts
    - src/comfyui/png-metadata.ts
    - src/store/__tests__/provenance-repo.test.ts
    - src/engine/__tests__/model-extraction.test.ts
    - src/engine/__tests__/seed-extraction.test.ts
    - src/engine/__tests__/diff.test.ts
    - src/engine/__tests__/iterate-merge.test.ts
    - src/comfyui/__tests__/png-metadata.test.ts
  modified:
    - src/store/schema.ts (provenance sqliteTable + versions.lineage_type)
    - src/types/hierarchy.ts (Version.lineage_type)
    - src/utils/id.ts (IdPrefix gains 'prov')
    - src/engine/errors.ts (ErrorCode +4 Phase 3 codes)
    - src/store/version-repo.ts (insertVersion seeds lineage_type: null)
    - src/store/__tests__/migrate.test.ts (EXPECTED_MIGRATIONS=3 + Phase 3 schema assertions)
    - drizzle/meta/_journal.json (entry 3 added)

key-decisions:
  - "Drizzle-generated 0003_curious_violations.sql discarded; hand-authored 0003_phase3_provenance.sql kept. Journal entry renamed to match. drizzle-kit emitted spurious DROP INDEX statements for DM-03 indexes (removed from schema but still physically present on pre-existing DBs) which would fail on fresh DBs — the plan-authored file has the clean additive-only shape."
  - "ProvenanceRepo follows append-only invariant structurally: no update/delete methods on prototype; test asserts this via Object.getOwnPropertyNames check as T-03-01 mitigation."
  - "Prototype-pollution tests use JSON.parse-derived input because object-literal syntax ({__proto__: ...}) sets prototype rather than creating an own-property — Object.entries would skip the key entirely. JSON input is the real attack vector and exercises the FORBIDDEN_KEYS guard correctly."
  - "VersionRepo.insertVersion seeds lineage_type: null on direct submits (Rule 3 blocking-issue auto-fix — the Version type gained the required field in Task 3 and the existing code path had to satisfy TypeScript's exhaustive object check). Plan 2 will add the lineage-accepting variant for reproduce/iterate INSERT-time assignment."

patterns-established:
  - "Append-only repo: public method surface limited to insert* + get*; constructor takes Db only; prototype-introspection tests enforce no mutation methods exist"
  - "Pure engine module: zero MCP / zero DB imports; constructor-injected collaborators; exported helpers testable in isolation; sort outputs deterministically (numeric-first node_id ordering)"
  - "Two-event provenance: single submit row (workflow_json captured at submit), single terminal row (prompt_json + models + seed OR error), chronological ordering via timestamp + covering index (version_id, timestamp)"
  - "Discriminated payload union for event writes: ProvenanceEventPayload narrows via event_type literal, insertEvent conditionally populates columns per discriminated branch"
  - "Deterministic diff summary: template-based string generator with stable multi-category ordering (params by node_id asc + field alpha → models → seed → workflow → metadata), MAX_CHANGES elision with '…and N more changes', HARD_CAP truncation"

requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06]

# Metrics
duration: 11min
completed: 2026-04-23
---

# Phase 3 Plan 1: Provenance Foundations Summary

**Append-only provenance table + pure engine modules for diff, iterate-merge, and PNG tEXt extraction — zero-coupling foundation that Plan 2 and Plan 3 compose into the submit path and tool surface**

## Performance

- **Duration:** 11 min
- **Started:** 2026-04-23T01:30:46Z
- **Completed:** 2026-04-23T01:41:30Z (approx.)
- **Tasks:** 9
- **Files modified:** 22 (7 source + 7 test + 2 migration + 1 schema + 5 existing extensions)

## Accomplishments

- **Migration 0003 landed.** `provenance` table + `versions.lineage_type` column + `idx_provenance_version_time` covering index all applied via the existing `migrate()` call in `openDb()` — no drizzle-kit push required, Task 9 extension of `migrate.test.ts` is the authoritative gate (now green).
- **ProvenanceRepo is structurally append-only.** Public method list locked to `insertEvent`, `getEventsForVersion`, `getLatestCompletedEvent`, `getSubmitEvent`. Zero UPDATE/DELETE call sites. T-03-01 (provenance tampering) mitigated at the repo layer.
- **Five pure engine modules ready for Plan 2 composition:**
  - `extractModels` walks 9 loader class_types → `ModelRef[]` sorted by node_id
  - `extractSeed` resolves 0/1/many KSampler variants deterministically
  - `diffVersions` produces the full D-PROV-15 shape (params + models + seed + workflow + metadata) with field-level depth on shared node ids
  - `buildSummary` emits deterministic template strings ≤400 chars with `"…and N more changes"` elision at 6 entries
  - `applyOverrides` + `applySeedShortcut` merge iterate inputs with prototype-pollution guard (T-03-02 mitigated)
- **PNG tEXt chunk extractor lands** — primary path for D-PROV-05 prompt-blob capture on completion events; returns `null` on malformed input so PROVENANCE_UNAVAILABLE surfaces naturally upstream.
- **ErrorCode union extended unconditionally** with the four Phase 3 codes (PROVENANCE_UNAVAILABLE, REPRODUCE_BLOCKED, ITERATE_INVALID_PATCH, VERSION_NOT_COMPLETED).
- **92 new unit tests green** across 7 test files; full project suite 384/384 passing (+1 pre-existing gated skip). TypeScript clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema migration 0003 and drizzle declarations** — `fd51a17` (feat)
2. **Task 2: Migration-applies verification gate (no source edits)** — *no commit — verification gate satisfied by Task 9*
3. **Task 3: Provenance + hierarchy types, IdPrefix, ErrorCode** — `42625c0` (feat)
4. **Task 4: ProvenanceRepo append-only event store** — `ca6768c` (feat)
5. **Task 5: Pure engine/provenance.ts (extractModels, extractSeed, ProvenanceWriter)** — `2c992ef` (feat)
6. **Task 6: Pure diff-summary + diff engine** — `6abf2bc` (feat)
7. **Task 7: Pure iterate-merge with prototype-pollution guard** — `c4d2ddc` (feat)
8. **Task 8: PNG tEXt chunk extractor** — `3c5d0f2` (feat)
9. **Task 9: Extend migrate.test.ts to assert Phase 3 schema landed** — `676ceed` (test)

_Note: No TDD RED/GREEN split pattern used — all Phase 3 pure modules wrote implementation + tests in a single commit per task; TDD mode is disabled in config.json for this project._

## Files Created/Modified

### Created
- `drizzle/0003_phase3_provenance.sql` — additive migration (table + index + column)
- `drizzle/meta/0003_snapshot.json` — drizzle schema snapshot
- `src/types/provenance.ts` — ProvenanceEvent, ModelRef, IterateOverride, diff shapes, DiffSnapshot, DiffInput
- `src/store/provenance-repo.ts` — ProvenanceRepo (append-only) + ProvenanceEventPayload union
- `src/engine/provenance.ts` — LOADER_CLASS_TYPES, KSAMPLER_CLASS_TYPES, MODEL_FIELD_BY_CLASS, extractModels, extractSeed, ProvenanceWriter
- `src/engine/diff.ts` — diffVersions (pure, 5-category changes)
- `src/engine/diff-summary.ts` — buildSummary (deterministic template)
- `src/engine/iterate-merge.ts` — applyOverrides, applySeedShortcut, findKSamplerNodes, FORBIDDEN_KEYS
- `src/comfyui/png-metadata.ts` — extractTextChunk, PNG_MAGIC
- `src/store/__tests__/provenance-repo.test.ts` — 12 tests
- `src/engine/__tests__/model-extraction.test.ts` — 11 tests (table-driven)
- `src/engine/__tests__/seed-extraction.test.ts` — 10 tests
- `src/engine/__tests__/diff.test.ts` — 13 tests
- `src/engine/__tests__/iterate-merge.test.ts` — 24 tests
- `src/comfyui/__tests__/png-metadata.test.ts` — 11 tests

### Modified
- `src/store/schema.ts` — `provenance` sqliteTable + `versions.lineage_type` column
- `src/types/hierarchy.ts` — `Version.lineage_type` added
- `src/utils/id.ts` — IdPrefix gains `'prov'`
- `src/engine/errors.ts` — ErrorCode +4 Phase 3 codes
- `src/store/version-repo.ts` — insertVersion seeds `lineage_type: null`
- `src/store/__tests__/migrate.test.ts` — EXPECTED_MIGRATIONS=3 + 4 new Phase 3 assertions
- `drizzle/meta/_journal.json` — entry 3 renamed to `0003_phase3_provenance`

## Decisions Made

- **Kept hand-authored migration, discarded drizzle-kit auto-generated file.** `npx drizzle-kit generate` emitted `0003_curious_violations.sql` with extraneous `DROP INDEX` statements for the DM-03 indexes (removed from schema but still present on any pre-existing DB, and *not* created on fresh DBs — so `DROP INDEX` without `IF EXISTS` would fail on fresh DBs). The plan-authored `0003_phase3_provenance.sql` has the clean additive-only shape. Journal entry renamed to match; snapshot file kept (reflects current schema state correctly).
- **Discriminated union for event payloads.** `ProvenanceEventPayload` narrows on `event_type` literal, letting `insertEvent` populate columns without casts. Better ergonomics + compile-time safety than a single optional-everything shape.
- **Prototype-pollution tests use JSON.parse input.** Object-literal `{__proto__: ...}` syntax sets the prototype instead of creating an own-property, so `Object.entries` would skip the key entirely and the FORBIDDEN_KEYS guard would never fire. Real-world attack vector is agent-supplied JSON (via MCP tool input → Zod → engine), so tests mirror that path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] VersionRepo.insertVersion missing lineage_type field**
- **Found during:** Task 3 (Version type gained lineage_type)
- **Issue:** Extending `Version` with the new `lineage_type: 'reproduce' | 'iterate' | null` field made the existing `row` object literal in `VersionRepo.insertVersion` fail TypeScript's exhaustive object check (TS2741).
- **Fix:** Seeded `lineage_type: null` on direct submits — matches D-PROV-33 (NULL marks originals from `generation.submit`; Plan 2 extends the repo with a lineage-accepting variant for reproduce/iterate INSERT-time assignment).
- **Files modified:** `src/store/version-repo.ts`
- **Verification:** `npx tsc --noEmit` clean; existing `version-repo.test.ts` (14 tests) still green.
- **Committed in:** `42625c0` (Task 3 commit, included as part of the type-extension change)

**2. [Rule 1 - Bug] diff test fixtures missing workflow_json/prompt_json**
- **Found during:** Task 6 (initial run failed 2 of 13 tests)
- **Issue:** The `snap()` fixture helper defaulted both `workflow_json: null` and `prompt_json: null`, making the `status: 'completed'` snapshot fail `notReady()` → `VERSION_NOT_COMPLETED`. Tests for model change + metadata change required diff-ready snapshots.
- **Fix:** Tests pass a minimal `prompt_json` (or `workflow_json` for the failed-vs-completed case) so `pickBlob` returns something and `notReady` false.
- **Files modified:** `src/engine/__tests__/diff.test.ts`
- **Verification:** `npx vitest run src/engine/__tests__/diff.test.ts` — 13/13 green.
- **Committed in:** `6abf2bc` (Task 6 commit)

**3. [Rule 1 - Bug] iterate-merge prototype-pollution tests not exercising guard**
- **Found during:** Task 7 (initial run failed 2 of 24 tests)
- **Issue:** Object-literal `{__proto__: ...}` syntax assigns to the prototype chain — it does NOT create an own-property called `__proto__`. `Object.entries()` only iterates own enumerable properties, so the outer-key guard never fired for literal-syntax input.
- **Fix:** Tests use `JSON.parse('{"__proto__": ...}')` which DOES create an own-property named `__proto__` (JSON.parse is explicitly safe from this coercion per ECMAScript spec). This matches the real-world attack vector: malicious agent input arriving via MCP tool → Zod → engine.
- **Files modified:** `src/engine/__tests__/iterate-merge.test.ts`
- **Verification:** `npx vitest run src/engine/__tests__/iterate-merge.test.ts` — 24/24 green; the guard now fires as intended.
- **Committed in:** `c4d2ddc` (Task 7 commit)

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 bugs)
**Impact on plan:** All three are test-fixture or TypeScript-compile necessities; no scope creep. Rule 3 fix unblocks the next task; Rule 1 fixes ensure tests actually exercise what they claim. Threat-model assertion (T-03-02 prototype-pollution guard) now has real coverage.

## Issues Encountered

- **Drizzle-kit generator emitted DROP INDEX statements** for the DM-03 indexes (dropped from schema.ts but physically present on existing DBs). The generator cannot know that those indexes were intentionally left behind as "harmless leftovers" per the schema.ts comment. Solution: discard the generated SQL, keep the hand-authored additive file. The generated snapshot is still correct and needed for future `drizzle-kit generate` continuity. Documented as a Plan 2 non-issue.

## User Setup Required

None — no external service configuration required. All changes are schema-additive and confined to the existing SQLite database; live-smoke provenance validation (which DOES require `COMFYUI_API_KEY`) is Plan 3's Task 03-03-04, not this plan's concern.

## Threat Flags

None — all new surface added in this plan was explicitly covered in the plan's `<threat_model>` (T-03-01 through T-03-05). No unplanned security-relevant changes.

## Known Stubs

None. Every symbol defined in this plan is fully implemented. No placeholders. `ProvenanceWriter.writeCompletedEvent` accepts `null` for the prompt blob (Phase 3 deferred path when PNG extraction fails), but that's explicit behavior per D-PROV-05 — the PROVENANCE_UNAVAILABLE error code is reserved for upstream callers to surface.

## Next Phase Readiness

- **Plan 2 unblocked.** Every module here has zero coupling to the existing submit path; Plan 2 imports and composes.
  - `ProvenanceWriter` (constructor-injected repo) drops into the submit + terminal gates in `GenerationEngine.submitInternal`.
  - `extractModels` / `extractSeed` / `LOADER_CLASS_TYPES` / `KSAMPLER_CLASS_TYPES` available for any submit/reproduce/iterate code path.
  - `diffVersions` takes two `DiffSnapshot` instances; Plan 2 constructs them from `Version` + latest-completed `ProvenanceEvent` + `models_json` JSON.parse.
  - `applyOverrides` + `applySeedShortcut` ready for `engine.iterateFromVersion` — Plan 2 calls them after loading the source's prompt blob, before `validateWorkflowFormat` + submit.
  - `extractTextChunk` ready for `ComfyUIClient.fetchResolvedPrompt` — Plan 2 wires the HTTP download → PNG parse → prompt-blob string path.
- **Lineage storage path decided.** Plan 2 will extend `VersionRepo.insertVersion` to accept an optional `{ parent_version_id, lineage_type }` second argument — the existing null-defaulted INSERT path stays intact for Phase 2 consumers.
- **No open decisions blocking Plan 2.** D-PROV-05 (prompt-blob source) is resolved via PNG tEXt primary path; D-PROV-28 (drift-warnings phrasing) has sample strings in the plan and Plan 2 picks exact wording.
- **No open decisions blocking Plan 3.** All tool-surface patterns (Zod discriminated union, breadcrumb envelope, TypedError → envelope mapping) already land from Phase 2; Plan 3 just wires them to the new engine methods.

## Self-Check: PASSED

All claimed artefacts exist and all claimed commits are in `git log`.

Verified files exist:
- drizzle/0003_phase3_provenance.sql — FOUND
- drizzle/meta/0003_snapshot.json — FOUND
- src/types/provenance.ts — FOUND
- src/store/provenance-repo.ts — FOUND
- src/engine/provenance.ts — FOUND
- src/engine/diff.ts — FOUND
- src/engine/diff-summary.ts — FOUND
- src/engine/iterate-merge.ts — FOUND
- src/comfyui/png-metadata.ts — FOUND
- All 7 new test files — FOUND (see `git log --name-only`)

Verified commits exist:
- fd51a17 (Task 1) — FOUND
- 42625c0 (Task 3) — FOUND
- ca6768c (Task 4) — FOUND
- 2c992ef (Task 5) — FOUND
- 6abf2bc (Task 6) — FOUND
- c4d2ddc (Task 7) — FOUND
- 3c5d0f2 (Task 8) — FOUND
- 676ceed (Task 9) — FOUND

Verified invariants:
- `npx tsc -p tsconfig.json --noEmit` clean (no output = success)
- `npx vitest run` — 384 passed + 1 skipped across 30 test files
- `npx vitest run src/store/__tests__/provenance-repo.test.ts src/store/__tests__/migrate.test.ts src/engine/__tests__/*.test.ts src/comfyui/__tests__/png-metadata.test.ts` — 92 passed across 7 files
- `grep -c "this\.db\." src/store/provenance-repo.ts` — 1 match, which is `this.db.insert(...)` (the sole mutation is INSERT; no UPDATE / DELETE call sites exist — append-only invariant holds)

---
*Phase: 03-provenance-versioning*
*Completed: 2026-04-23*
