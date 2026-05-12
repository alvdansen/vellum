---
phase: 20-shot-status-engine
plan: "01"
subsystem: database
tags: [drizzle, sqlite, migration, types, schema, shot-status, append-only]

# Dependency graph
requires:
  - phase: 19-ai-conversational-summary
    provides: drizzle migrator pattern (additive-split, idx 0007 baseline)
provides:
  - SHOT_STATUSES const + ShotStatus type (single source of truth)
  - Shot.status field (interface)
  - 'sse' IdPrefix (shot-status-event id generator)
  - shotStatusEvents Drizzle table export
  - shots.status Drizzle column (notNull default 'wip')
  - drizzle/0008_shot_status.sql migration (ALTER TABLE + CREATE TABLE + 4 indexes)
  - drizzle journal idx 8 entry
affects:
  - 20-02 (ShotStatusRepo append-only writer, consumes ShotStatus + shotStatusEvents + 'sse')
  - 20-03 (engine event payload + SSE bridge, consumes ShotStatus)
  - 20-04 (shot-tool arms, consumes ShotStatus)
  - 21-shot-grid (UI consumer of shots.status column)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Drizzle additive-split: SCHEMA_DDL omits new column/table; migrator layers it on top (Phase 2/3/12/14/19 pattern continued)"
    - "Closed-set status type via `as const` tuple + typeof index lookup (STAT-01 mirrors VersionStatus IAC-05)"
    - "Append-only event table with idx_<table>_shot_time covering index (Phase 3 provenance pattern)"

key-files:
  created:
    - drizzle/0008_shot_status.sql
    - src/types/__tests__/shot-status.test.ts
    - src/store/__tests__/schema-shot-status.test.ts
  modified:
    - src/types/hierarchy.ts
    - src/utils/id.ts
    - src/store/schema.ts
    - src/store/hierarchy-repo.ts
    - src/test-utils/fake-engine.ts
    - drizzle/meta/_journal.json
    - src/store/__tests__/migrate.test.ts
    - src/store/__tests__/migrate-no-op.test.ts

key-decisions:
  - "Placed shotStatusEvents AFTER metadata in schema.ts (newest Phase 20 addition; preserves Phase-order grouping)"
  - "Drizzle migration uses --> statement-breakpoint markers between every DDL statement (Drizzle migrator requirement — single SQL string per statement)"
  - "shots.status default 'wip' applied in BOTH Drizzle schema (notNull().default('wip')) AND repo insert (createShot writes status='wip' explicitly) — defence-in-depth; SCHEMA_DDL still omits the column to keep Phase-1 bootstrap byte-stable"
  - "Bumped EXPECTED_MIGRATIONS from 7 → 8 in both migrate.test.ts and migrate-no-op.test.ts (Rule 3 — hardcoded constant would block all migration tests)"
  - "Added status='wip' to fake-engine.ts getShot stub AND hierarchy-repo.ts createShot row (Rule 3 — Shot type required, both Shot constructors had to provide a value)"

patterns-established:
  - "STAT-01 closed-set status type: `export const SHOT_STATUSES = [...] as const; export type ShotStatus = typeof SHOT_STATUSES[number]` — directly mirrors VersionStatus (IAC-05) and is the single source of truth for the valid value set; downstream code grep-tests against the const, never against inline string literals"
  - "Append-only event table pinning: schema export name (camelCase shotStatusEvents) + SQL table name (snake_case shot_status_events) + idx_<table>_shot_time covering index named for the (shot_id, created_at) lookup that the per-shot history query in Plan 02 will use"
  - "Schema test pattern via getTableConfig: src/store/__tests__/schema-shot-status.test.ts uses drizzle-orm/sqlite-core getTableConfig() to assert column names, notNull, defaults, FK targets, and index columns — all at the Drizzle definition level, independent of the migration SQL"
  - "TDD with type-anchored runtime tests: types are erased at runtime, so the test file anchors on (a) the SHOT_STATUSES `as const` tuple values + length, (b) a Shot literal with status field (compile-time check via assignment), and (c) a generated `sse_*` id from newId() (runtime + compile-time check). Pattern is reusable for any new closed-set type"

requirements-completed: [STAT-01, STAT-02, STAT-03]

# Metrics
duration: 11min
completed: 2026-05-12
---

# Phase 20 Plan 01: Foundation — Types and Schema Summary

**SHOT_STATUSES closed-set type tuple, shot.status Drizzle column with 'wip' default, append-only shotStatusEvents table with covering index, and migration 0008 with statement-breakpoint-separated DDL — the contracts Plans 02, 03, and 04 build against.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-05-12T09:15:08Z
- **Completed:** 2026-05-12T09:25:39Z
- **Tasks:** 3
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments

- ShotStatus closed-set type (`'wip' | 'pending-review' | 'approved' | 'on-hold' | 'omit'`) anchored on a runtime tuple SHOT_STATUSES, single source of truth for the value set
- Shot interface now carries `status: ShotStatus`; hierarchy-repo's createShot writes default `'wip'` on every insert (defence-in-depth alongside the migration's column DEFAULT)
- `'sse'` (Shot Status Event) IdPrefix registered for the Plan 02 repo to call `newId('sse')`
- shotStatusEvents Drizzle table exported with 7 columns + idx_shot_status_events_shot_time covering index on `(shot_id, created_at)`
- drizzle/0008_shot_status.sql migration applies cleanly with proper `--> statement-breakpoint` separation; ALTER TABLE + CREATE TABLE + 4 covering indexes (idx_shots_status, idx_shots_project_status, idx_shot_status_events_shot_time, idx_shots_cursor)
- Drizzle journal idx 8 entry tagged `0008_shot_status` extends the migration ledger

## Task Commits

Each task was committed atomically with TDD discipline (RED before GREEN where applicable):

1. **Task 1: Extend types/hierarchy.ts and utils/id.ts (TDD)**
   - RED: `7635fa0` (test) — failing test for SHOT_STATUSES tuple + ShotStatus type + Shot.status field + 'sse' IdPrefix
   - GREEN: `91f2593` (feat) — implementation of SHOT_STATUSES, ShotStatus, Shot.status, IdPrefix='sse' + Rule 3 fixes to hierarchy-repo + fake-engine

2. **Task 2: Extend src/store/schema.ts with shotStatusEvents table and shots.status column (TDD)**
   - RED: `f944c09` (test) — 10 failing tests against shotStatusEvents schema shape via getTableConfig
   - GREEN: `9d27ea6` (feat) — shots.status Drizzle column + shotStatusEvents table export + idx_shot_status_events_shot_time

3. **Task 3: Write migration 0008_shot_status.sql and update journal**
   - `ebd3f39` (feat) — migration SQL with --> statement-breakpoint separators, journal entry idx 8, EXPECTED_MIGRATIONS bumped 7→8 in two test files

## Files Created/Modified

**Created:**
- `drizzle/0008_shot_status.sql` — Migration DDL: ALTER TABLE shots ADD status text NOT NULL DEFAULT 'wip', CREATE TABLE shot_status_events with FK to shots(id), 4 covering indexes (status, project_status, shot_time, cursor); uses `--> statement-breakpoint` per Drizzle migrator requirements
- `src/types/__tests__/shot-status.test.ts` — TDD anchor for STAT-01 (SHOT_STATUSES tuple values + Shot interface field) and STAT-02 ('sse' IdPrefix runtime + compile-time)
- `src/store/__tests__/schema-shot-status.test.ts` — getTableConfig-based 10-test guard for shots.status column + shotStatusEvents table shape, FK, and index

**Modified:**
- `src/types/hierarchy.ts` — Added SHOT_STATUSES `as const` tuple, ShotStatus type, Shot.status field with documenting comment
- `src/utils/id.ts` — IdPrefix union extended with `'sse'`
- `src/store/schema.ts` — shots gains status column (notNull default 'wip'); new shotStatusEvents table after metadata; preserved SCHEMA_DDL additive-split invariant
- `src/store/hierarchy-repo.ts` — createShot row includes `status: 'wip'` (Rule 3 fix — Shot type required after status field addition)
- `src/test-utils/fake-engine.ts` — getShot stub literal carries `status: 'wip'` (Rule 3 fix — same Shot contract)
- `drizzle/meta/_journal.json` — idx 8 entry appended for 0008_shot_status
- `src/store/__tests__/migrate.test.ts` — EXPECTED_MIGRATIONS 7 → 8 (Rule 3 — hardcoded constant)
- `src/store/__tests__/migrate-no-op.test.ts` — EXPECTED_MIGRATIONS 7 → 8 (Rule 3 — same constant)

## Decisions Made

- **shotStatusEvents placement after metadata**: keeps Phase-order grouping in schema.ts (Phase 4 metadata is the previous-newest table); Plan 02 repo lives in its own file so source-of-truth ordering is unaffected.
- **Drizzle migration uses --> statement-breakpoint markers**: the original plan SQL was a single multi-statement block which the Drizzle migrator rejects with `RangeError: The supplied SQL string contains more than one statement`. Resolved by inserting `--> statement-breakpoint` between each DDL — pattern already used in migrations 0003/0004.
- **shots.status default in two places**: Drizzle schema `notNull().default('wip')` + hierarchy-repo createShot row `status: 'wip'`. This is defence-in-depth — at runtime the Drizzle insert path always provides an explicit value, and even if a future schema sync drops the default the application never inserts NULL. SCHEMA_DDL deliberately omits the column to preserve the Phase-1 bootstrap byte-stability invariant (D-IM-04).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] hierarchy-repo.createShot row missing `status` field after Shot interface change**
- **Found during:** Task 1 (GREEN phase, after adding `status: ShotStatus` to Shot interface)
- **Issue:** TypeScript error TS2741 "Property 'status' is missing in type ... required in type 'Shot'" at src/store/hierarchy-repo.ts:266 (`const row: Shot = { ... }`)
- **Fix:** Added `status: 'wip'` to the row literal, with comment explaining alignment with migration 0008 DEFAULT
- **Files modified:** src/store/hierarchy-repo.ts
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** 91f2593 (Task 1 GREEN commit)

**2. [Rule 3 - Blocker] fake-engine.ts getShot stub missing `status` field**
- **Found during:** Task 1 (GREEN phase, same tsc check)
- **Issue:** TS2322 "Property 'status' is missing in type ..." at src/test-utils/fake-engine.ts:149-151 — the test fake's default Shot literal lacked the new field
- **Fix:** Added `status: 'wip'` (default) with explanatory comment
- **Files modified:** src/test-utils/fake-engine.ts
- **Verification:** `npx tsc --noEmit` exits 0; all 167 tools tests + 23 pipeline tests still pass
- **Committed in:** 91f2593 (Task 1 GREEN commit)

**3. [Rule 3 - Blocker] Migration 0008 SQL is rejected by Drizzle migrator (multi-statement string)**
- **Found during:** Task 3 (after writing the SQL exactly as the plan specified)
- **Issue:** `npx vitest run src/store/__tests__/migrate.test.ts` failed with `RangeError: The supplied SQL string contains more than one statement` — the Drizzle migrator (which is what the production server uses) splits a migration file on `--> statement-breakpoint` markers, NOT on `;`. The plan's SQL had `;`-separated statements only.
- **Fix:** Rewrote drizzle/0008_shot_status.sql with `--> statement-breakpoint` markers between every DDL statement, matching the established patterns in migrations 0003/0004. Also normalized backtick-quoted identifiers and Drizzle's `FOREIGN KEY (...) REFERENCES ... ON UPDATE/DELETE no action` form for parity with 0003/0004.
- **Files modified:** drizzle/0008_shot_status.sql
- **Verification:** All 21 migration tests pass; full store test suite 236/236 green
- **Committed in:** ebd3f39 (Task 3 commit)

**4. [Rule 3 - Blocker] EXPECTED_MIGRATIONS hardcoded as 7 in two test files**
- **Found during:** Task 3 (after adding migration 0008, migration tests failed asserting __drizzle_migrations row count)
- **Issue:** Both src/store/__tests__/migrate.test.ts (line 14) and src/store/__tests__/migrate-no-op.test.ts (line 29) declared `const EXPECTED_MIGRATIONS = 7;` — would have blocked the whole migration test suite (21 tests) after the migration count increased to 8
- **Fix:** Bumped both constants to 8 with updated comment referencing Phase 20 STAT-01..05
- **Files modified:** src/store/__tests__/migrate.test.ts, src/store/__tests__/migrate-no-op.test.ts
- **Verification:** Both files compile clean and run 21/21 passing migration tests
- **Committed in:** ebd3f39 (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (all Rule 3 — Blocking)
**Impact on plan:** All four are mechanical consequences of the plan's own work (Task 1 widened Shot interface → constructors must provide value; Task 3 added a migration → migrator and assertion constants must accept it). Zero scope creep. The plan's verification gates pass: `npx tsc --noEmit` clean, all five greps return the expected counts, all 21 migration tests + 10 schema tests + 5 type tests + 52 architecture-purity tests + 23 pipeline tests + 141 http tests + 167 tools tests + 236 total store tests pass.

## Issues Encountered

- **Plan's migration SQL lacked Drizzle statement-breakpoint markers** — see deviation #3. Worth flagging for Plan 02: when writing the repo's transactional UPDATE shots + INSERT shot_status_events, the migration SQL is byte-stable now, and the schema.ts Drizzle definition + Plan 02 repo will agree on column names, types, and defaults.
- **Plan-attribution test will keep failing until Plan 20-04 ships** — `src/__tests__/phase-attribution.test.ts` asserts that EVERY ROADMAP requirement in EVERY phase appears in at least one SUMMARY's `requirements-completed`. This SUMMARY claims [STAT-01, STAT-02, STAT-03] (matching the plan's frontmatter `requirements:` field), but STAT-04 and STAT-05 belong to Plans 03/04 and will only be attributed once those SUMMARYs are written. **This is expected behavior — not a regression.** (Pre-existing failures in the same test for SORT-03 and SUM-05 are unrelated and pre-date Phase 20.)

## Pre-existing Test Failures (Out of Scope)

The following test failures pre-date this plan and are **not caused by Phase 20 changes** (confirmed by checking out base commit `e60d2cb` and reproducing each failure):

- **C2PA signer/verifier/redaction/ingredient tests (~20 files)**: all fail with `ENOENT: no such file or directory, open '/.../node_modules/c2pa-node/tests/fixtures/certs/es256.pub'`. The c2pa-node package's test fixtures are not installed in this worktree's node_modules. Out of scope (env issue, predates Phase 20).
- **phase-attribution.test.ts (SORT-03 attribution, SUM-05 attribution)**: pre-existing missing-attribution claims in v1.2 phase summaries. Logged as pre-existing in lessons memory; deferred to v1.2 SUMMARY repair work, out of scope for Phase 20.

## User Setup Required

None — no external service configuration required for this foundation plan.

## Next Phase Readiness

- **Plan 20-02 (ShotStatusRepo + tests)**: unblocked. Imports `ShotStatus` from `../types/hierarchy.js`, `newId('sse')` from `../utils/id.js`, `shotStatusEvents` and `shots` from `./schema.js`. The migration 0008 will be applied to test in-memory DBs automatically via the existing `makeInMemoryDb()` fixture (Drizzle migrator runs all files in `./drizzle`).
- **Plan 20-03 (engine event payload + SSE bridge)**: unblocked for the type imports it needs (ShotStatus, ShotStatusEvent if Plan 02 exports it).
- **Plan 20-04 (shot-tool arms)**: depends on 20-02 + 20-03 outputs, transitively depends on this plan.
- **No blockers or concerns for downstream plans.** All key files in this plan's `provides` block are exported, typed, and test-anchored.

## Self-Check: PASSED

Verified at end of execution:

- `[ -f src/types/hierarchy.ts ]` → FOUND
- `[ -f src/utils/id.ts ]` → FOUND
- `[ -f src/store/schema.ts ]` → FOUND
- `[ -f drizzle/0008_shot_status.sql ]` → FOUND
- `[ -f drizzle/meta/_journal.json ]` → FOUND
- `[ -f src/types/__tests__/shot-status.test.ts ]` → FOUND (created)
- `[ -f src/store/__tests__/schema-shot-status.test.ts ]` → FOUND (created)
- `git log --all | grep 7635fa0` → FOUND (Task 1 RED)
- `git log --all | grep 91f2593` → FOUND (Task 1 GREEN)
- `git log --all | grep f944c09` → FOUND (Task 2 RED)
- `git log --all | grep 9d27ea6` → FOUND (Task 2 GREEN)
- `git log --all | grep ebd3f39` → FOUND (Task 3)
- `npx tsc --noEmit` → exit 0
- `grep -c "SHOT_STATUSES" src/types/hierarchy.ts` → 3 (>= 1)
- `grep -c "ShotStatus" src/types/hierarchy.ts` → 2 (>= 2)
- `grep -c "'sse'" src/utils/id.ts` → 1
- `grep -c "shotStatusEvents" src/store/schema.ts` → 3 (>= 2)
- `grep -c "0008_shot_status" drizzle/meta/_journal.json` → 1

## TDD Gate Compliance

Tasks 1 and 2 are `tdd="true"` — both followed the RED/GREEN cycle:

- **Task 1:** `7635fa0` (test commit, RED) → `91f2593` (feat commit, GREEN) ✓
- **Task 2:** `f944c09` (test commit, RED) → `9d27ea6` (feat commit, GREEN) ✓
- **Task 3:** `type="auto"` with no tdd attribute — single feat commit `ebd3f39` ✓

All TDD gates compliant.

---
*Phase: 20-shot-status-engine*
*Plan: 20-01*
*Completed: 2026-05-12*
