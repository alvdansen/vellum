---
phase: 20-shot-status-engine
plan: "02"
subsystem: store
tags: [drizzle, sqlite, shot-status, append-only, transaction, repo, tdd]

# Dependency graph
requires:
  - phase: 20-shot-status-engine
    plan: "01"
    provides: ShotStatus type, shotStatusEvents Drizzle table, 'sse' IdPrefix, migration 0008
provides:
  - insertStatusEvent (atomic dual-write of INSERT shot_status_events + UPDATE shots.status)
  - getStatusHistory (newest-first, default limit=50, empty-array on no rows)
  - getCurrentStatus (null-coalesces to 'wip' for shots with zero history — STAT-03 invariant)
  - STALE_SHOT_DAYS = 14 constant (OVR-02)
  - ShotStatusEvent interface (id, shot_id, from_status, to_status, changed_by, note, created_at)
affects:
  - 20-03 (engine event payload + SSE bridge — engine will call insertStatusEvent inside Engine.setShotStatus)
  - 20-04 (shot-tool arms — depends transitively via Engine facades)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-function repo style: insertStatusEvent / getStatusHistory / getCurrentStatus exported as standalone functions taking a Db arg (NOT a class) — matches the appendix pattern in tag-repo.ts countTagsForVersions and contrasts with ProvenanceRepo's class shape. Choice: simpler to import and tree-shake; no per-instance state needed."
    - "Synchronous-transaction dual-write: db.transaction(() => { ... }) with NO trailing () — better-sqlite3 / Drizzle calls the callback inline and runs all writes atomically. Codebase-wide pattern (assets.ts L494, metadata-repo.ts L217, tag-repo.ts L223, version-repo.ts L92) — the plan's PATTERNS.md mis-documented `db.transaction(() => { ... })()` which would not compile."
    - "Null-coalesce-to-default-state: getCurrentStatus returns 'wip' via `(history[0]?.to_status as ShotStatus) ?? 'wip'`. The double nullish-coalesce (optional chain + ??) collapses both 'no row' and 'null column value' to a single safe default. Same idiom mirrored across the codebase for safe-default returns."

key-files:
  created:
    - src/store/shot-status-repo.ts
    - src/store/__tests__/shot-status-repo.test.ts
  modified: []

key-decisions:
  - "Module-function repo (NOT a class): consistent with the plan's `<action>` spec which lists insertStatusEvent / getStatusHistory / getCurrentStatus as exported functions, AND simpler than ProvenanceRepo's class style because shot-status-repo has no per-instance state (no caches, no derived helpers). Test imports become `import { insertStatusEvent } from '../shot-status-repo.js'` rather than `repo.insertStatusEvent(...)`."
  - "FK violation as atomicity proof: the new atomicity test forces a transaction failure by INSERT-ing on a non-existent shot_id (foreign_keys=ON throws on the INSERT shot_status_events FK to shots(id)) — this catches the case where BOTH writes must roll back together. Avoids monkey-patching newId/Date.now and exercises the same path a real-world bug would (caller passes a deleted shot id)."
  - "JSDoc comments paraphrase forbidden patterns: the architecture-purity grep tests in Plan 04 will look for literal `UPDATE shot_status_events` and `DELETE.*shot_status_events` strings in this file. The first GREEN draft had these verbatim inside a comment 'Plan 04 asserts UPDATE shot_status_events ... do not appear' — paraphrased to 'forbidden SQL mutation verbs against the events table' so the comment documents the invariant without tripping the grep guard."
  - "Single db.transaction occurrence in comments: the plan verification `grep -c 'db.transaction' === 1` is a literal hard constraint. JSDoc references to the transaction shape were reduced to a single, non-`db.transaction()`-using paraphrase ('single callback, NO trailing () — the Drizzle/better-sqlite3 idiom') so only the line of code itself matches."

patterns-established:
  - "STAT-02 atomic dual-write contract: insertStatusEvent writes (1) INSERT shot_status_events row and (2) UPDATE shots.status to the new to_status, inside one db.transaction. Plan 04 (engine) will call insertStatusEvent from Engine.setShotStatus — engine layer does NOT need its own transaction wrapper because this contract is self-contained at the repo boundary."
  - "STAT-03 null-coalesce-to-wip: getCurrentStatus is the canonical reader; it intentionally does NOT read shots.status (which has its own DEFAULT 'wip' from migration 0008) — instead it reads history[0]?.to_status and falls back to 'wip'. Downstream readers should call getCurrentStatus, never raw db.select on shots.status, so the invariant cannot be subverted by a schema-default change."
  - "OVR-02 stale-shot threshold: STALE_SHOT_DAYS = 14 is a named export here (NOT a magic number in grid query SQL). Phase 21 grid queries import this constant rather than inlining 14, so a future tuning change touches one location."

requirements-completed: [STAT-02, STAT-03]

# Metrics
duration: 5min
completed: 2026-05-12
---

# Phase 20 Plan 02: ShotStatusRepo — Append-Only Event Store Summary

**Append-only shot status event store with transactional dual-write (UPDATE shots + INSERT shot_status_events in one synchronous db.transaction), newest-first history reads with bounded limit, and the STAT-03 null-coalesce-to-'wip' invariant guarded by an explicit test — the data-access contract that Engine.setShotStatus (Plan 04) and the grid-stale detector (Phase 21) build against.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-12T09:30:20Z
- **Completed:** 2026-05-12T09:35:59Z
- **Tasks:** 2 (both `tdd="true"`)
- **Files created:** 2

## Accomplishments

- `insertStatusEvent(db, shotId, fromStatus, toStatus, changedBy, note?)` performs atomic dual-write via `db.transaction(() => { db.insert(shotStatusEvents).values(row).run(); db.update(shots).set({ status: toStatus }).where(eq(shots.id, shotId)).run(); })`. Generates `sse_`-prefixed id via `newId('sse')`; returns the inserted `ShotStatusEvent` row.
- `getStatusHistory(db, shotId, limit = 50)` returns newest-first rows via `orderBy(desc(shotStatusEvents.created_at))`; uses the `idx_shot_status_events_shot_time` covering index from Plan 01; returns empty array (not null) when no rows.
- `getCurrentStatus(db, shotId)` null-coalesces via `(history[0]?.to_status as ShotStatus) ?? 'wip'` — STAT-03 contract: never returns null, even when shot has zero history rows or when the underlying schema default is dropped.
- `STALE_SHOT_DAYS = 14` exported constant per OVR-02; single source of truth for Phase 21 grid query staleness checks.
- `ShotStatusEvent` interface exported with all seven columns typed precisely (`from_status: ShotStatus | null` for first-ever status sets; `note: string | null` for caller-optional notes).
- Architecture-purity invariants verified by direct grep on the file: zero `UPDATE shot_status_events`, zero `DELETE.*shot_status_events`, zero `@modelcontextprotocol/sdk` imports. Plan 04's grep tests will assert the same against the production file.
- 17 tests covering: id generation, dual-write materialization on shots.status, newest-first ordering, limit parameter (default + explicit), empty-array on no-history, null-coalesce to 'wip' (multiple scenarios), STALE_SHOT_DAYS constant, structural invariant (no update/delete/remove/clear exports), shape of ShotStatusEvent type, **atomicity rollback on FK violation**, **cross-shot isolation**, **null-coalesce path independent of shots.status default**.

## Task Commits

Each task followed TDD discipline (RED before GREEN); a third commit expands coverage with additional behavioral guards.

1. **Task 1: Create src/store/shot-status-repo.ts (TDD)**
   - RED: `fb4eeff` (test) — failing test file importing from `../shot-status-repo.js` (file does not exist); 14 tests scaffolded covering insertStatusEvent / getStatusHistory / getCurrentStatus / STALE_SHOT_DAYS / structural invariant
   - GREEN: `084b13b` (feat) — module-function repo with insertStatusEvent / getStatusHistory / getCurrentStatus / STALE_SHOT_DAYS / ShotStatusEvent; all 14 tests pass; all 4 grep gates pass

2. **Task 2: Expand src/store/__tests__/shot-status-repo.test.ts**
   - `8d1a8af` (test) — adds 3 behavioral guards: atomicity rollback (FK violation rolls back BOTH writes), cross-shot isolation (per-shot eq() filter integrity), null-coalesce path with explicit empty-history assertion; 17 tests pass; broader regression suite stays at 310/310 across 18 test files

## Files Created/Modified

**Created:**
- `src/store/shot-status-repo.ts` — Append-only repo with 3 exported functions + 1 interface + 1 constant. Imports only from `drizzle-orm`, `drizzle-orm/better-sqlite3`, `./schema.js`, `../types/hierarchy.js`, `../utils/id.js` — zero MCP SDK or unrelated dependencies. 124 lines including comprehensive JSDoc.
- `src/store/__tests__/shot-status-repo.test.ts` — 17-test suite. Uses `makeInMemoryDb` fixture (which runs all drizzle migrations including 0008 from Plan 01) + `HierarchyRepo` for setup. No new fixture helpers needed.

**Modified:** None — the repo file is self-contained, and all schema/migration scaffolding was landed by Plan 01.

## Decisions Made

- **Module-function repo style (not a class)**: ProvenanceRepo is a class because it has multiple sibling-event helpers + LIMIT-bounded scans + a constructor that caches the Db reference. ShotStatusRepo has only three functions and no state — module-level exported functions are simpler, work cleanly with tree-shaking, and read naturally in engine code (`insertStatusEvent(this.db, ...)` vs `this.shotStatusRepo.insertStatusEvent(...)`). The structural invariant test was adapted to check `Object.keys(shotStatusRepo)` instead of `ShotStatusRepo.prototype`.
- **Atomicity test via FK violation, not mock/spy**: The atomicity test forces a transaction failure by passing a non-existent shot_id to `insertStatusEvent`. With `foreign_keys=ON` (set in makeInMemoryDb pragma init), the INSERT shot_status_events row throws because shot_id has FK to shots(id). This exercises the actual production rollback path — no Vitest mocks needed, no test-only seams in production code. The legitimate shot's row is asserted unchanged afterwards.
- **Single `db.transaction` mention in code, paraphrased in comments**: The plan's verification gate `grep -c 'db.transaction' === 1` is a literal contract. JSDoc comments that initially referenced `db.transaction()` multiple times were rewritten to refer to "the transaction" or "the Drizzle/better-sqlite3 idiom" so the file contains the literal string exactly once — on the call site at line 88.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's PATTERNS.md and Task 1 `<action>` documented incorrect transaction syntax `db.transaction(() => { ... })()` (trailing call)**
- **Found during:** Task 1 GREEN — first test run after writing the impl
- **Issue:** First implementation copied the plan's literal `db.transaction(() => { ... })();` shape. tsc errored `TS2349: This expression is not callable. Type 'void' has no call signatures.` and runtime threw `TypeError: db.transaction(...) is not a function`. The actual codebase pattern in `src/store/tag-repo.ts` L223, `src/store/metadata-repo.ts` L217, `src/store/version-repo.ts` L92, `src/engine/assets.ts` L494 uses `db.transaction(() => { ... })` (no trailing call) — better-sqlite3 invokes the callback inline and returns the callback's return value directly. The `()` shape is from the multi-mode `db.transaction(fn).deferred()` API that better-sqlite3 / Drizzle does NOT expose here.
- **Fix:** Removed the trailing `()` from the call site. Updated the JSDoc to document the correct shape and the four established call sites for future reference.
- **Files modified:** src/store/shot-status-repo.ts
- **Verification:** `npx tsc --noEmit` exits 0; all 17 tests pass; 4 grep gates green
- **Committed in:** 084b13b (Task 1 GREEN)

**2. [Rule 1 - Bug] Initial JSDoc verbatim contained the forbidden grep patterns `UPDATE shot_status_events` and `DELETE.*shot_status_events`**
- **Found during:** Task 1 GREEN — grep verification after first impl draft
- **Issue:** The class-header JSDoc described the architecture-purity guard like this: *"the architecture-purity test in Plan 04 asserts `UPDATE shot_status_events` and `DELETE.*shot_status_events` do not appear in this file"*. That comment line itself contained the literal forbidden strings, so `grep -c 'UPDATE shot_status_events' src/store/shot-status-repo.ts` returned 1 (must be 0) and the DELETE grep returned 1 (must be 0). This was a self-defeating doc — the test it described would have failed against the very file that explained it.
- **Fix:** Paraphrased the comment to *"greps this file for the forbidden SQL mutation verbs against the events table and asserts zero matches"* — same semantic meaning, no literal trigger strings.
- **Files modified:** src/store/shot-status-repo.ts
- **Verification:** `grep -c 'UPDATE shot_status_events'` returns 0; `grep -cE 'DELETE.*shot_status_events'` returns 0
- **Committed in:** 084b13b (Task 1 GREEN)

**3. [Rule 1 - Bug] JSDoc mentioned `db.transaction` four times in comments, pushing `grep -c 'db.transaction'` from 1 → 5**
- **Found during:** Task 1 GREEN — same grep verification batch
- **Issue:** The verification spec requires `grep -c 'db.transaction' src/store/shot-status-repo.ts` to return exactly 1 (the call site at the only INSERT/UPDATE invocation). The first-draft JSDoc had four additional mentions: in the outer class-header, in the insertStatusEvent header (twice), and in the comment about `db.transaction(fn).deferred()` shape. Total: 5.
- **Fix:** Compressed JSDoc to mention the construct once at the class header ("inside a single sync transaction") and once in the insertStatusEvent header ("the transaction-call shape — single callback, NO trailing `()`"). Removed `db.transaction(...)` literals from comments entirely; only line 88 — the actual call — matches the grep.
- **Files modified:** src/store/shot-status-repo.ts
- **Verification:** `grep -c 'db.transaction'` returns 1
- **Committed in:** 084b13b (Task 1 GREEN)

**4. [Rule 1 - Bug] Cross-shot isolation test passed sequence_id to createSequence (TypedError PARENT_NOT_FOUND)**
- **Found during:** Task 2 — first run of the new isolation test
- **Issue:** First draft of the isolation test attempted to seed a second shot by calling `hierarchy.createSequence(existingShot.sequence_id, 'sq020')` — but createSequence expects a project_id as its first arg, not a sequence_id. TypedError: "Parent project 'seq_xxx' not found for sequence creation".
- **Fix:** Simplified the test to create a sibling shot in the SAME sequence as shotId: `hierarchy.createShot(existingShot.sequence_id, 'sh020')`. The isolation invariant doesn't require a separate sequence — it requires two distinct shot_ids in the same DB.
- **Files modified:** src/store/__tests__/shot-status-repo.test.ts
- **Verification:** `npx vitest run src/store/__tests__/shot-status-repo.test.ts` — 17/17 pass
- **Committed in:** 8d1a8af (Task 2)

---

**Total deviations:** 4 auto-fixed (3× Rule 1 bug in plan-prescribed code/docs, 1× Rule 1 bug in my own test code)
**Impact on plan:** All four were mechanical and self-evident. The transaction-syntax issue (Deviation #1) is significant — the plan's PATTERNS.md should be updated for future readers, but the canonical pattern is already established across four other files in the codebase, so the fix was unambiguous. Deviations #2 and #3 are a class of "verification-grep meta-trap" where documenting an architecture rule can break the rule's own check; flagged here as a pattern for future plans to avoid.

## Issues Encountered

- **Plan-attribution test will keep failing until Plan 20-04 ships** (same caveat as Plan 01 SUMMARY): `src/__tests__/phase-attribution.test.ts` asserts that EVERY ROADMAP requirement appears in at least one SUMMARY's `requirements-completed`. This SUMMARY claims [STAT-02, STAT-03]; Plan 01 SUMMARY already claims [STAT-01, STAT-02, STAT-03]. STAT-04 and STAT-05 still belong to Plans 03/04 and will only be attributed once those SUMMARYs are written. Expected behavior, not a regression.

## Pre-existing Test Failures (Out of Scope)

The C2PA signer/verifier/redaction/ingredient tests (~20 files, ENOENT on c2pa-node test fixtures) and the phase-attribution test (SORT-03, SUM-05 pre-existing attribution gaps) continue to fail as they did at base commit — confirmed by Plan 01 SUMMARY. Not caused by this plan.

## User Setup Required

None.

## Next Phase Readiness

- **Plan 20-03 (engine event payload + SSE bridge)**: unblocked. Imports `ShotStatus` from `../types/hierarchy.js` (Plan 01) and the `ShotStatusEvent` interface from `./shot-status-repo.js` (this plan). The engine's `setShotStatus` facade (Plan 04) will call `insertStatusEvent` and then emit `shot.status_changed` via the new event payload from Plan 03.
- **Plan 20-04 (shot-tool arms)**: unblocked transitively via Plans 02 + 03. The tool layer will call engine.setShotStatus / engine.getShotStatus / engine.listShotStatusHistory; the engine layer wraps the repo functions exported here.
- **Plan 21+ (shot grid)**: unblocked for the read paths — getCurrentStatus and STALE_SHOT_DAYS will be imported by the grid query and stale-shot detector.
- **No blockers or concerns for downstream plans.**

## Self-Check: PASSED

Verified at end of execution:

- `[ -f src/store/shot-status-repo.ts ]` → FOUND
- `[ -f src/store/__tests__/shot-status-repo.test.ts ]` → FOUND
- `git log --all | grep fb4eeff` → FOUND (Task 1 RED commit)
- `git log --all | grep 084b13b` → FOUND (Task 1 GREEN commit)
- `git log --all | grep 8d1a8af` → FOUND (Task 2 commit)
- `npx tsc --noEmit` → exit 0
- `grep -c "db.transaction" src/store/shot-status-repo.ts` → 1 (matches plan spec)
- `grep -c "UPDATE shot_status_events" src/store/shot-status-repo.ts` → 0 (matches plan spec)
- `grep -cE "DELETE.*shot_status_events" src/store/shot-status-repo.ts` → 0 (matches plan spec — append-only invariant)
- `grep -c "@modelcontextprotocol/sdk" src/store/shot-status-repo.ts` → 0 (matches plan spec — tool-engine separation)
- `npx vitest run src/store/__tests__/shot-status-repo.test.ts` → 17/17 pass
- Full regression: `npx vitest run src/store/__tests__ src/__tests__/architecture-purity.test.ts src/types/__tests__/shot-status.test.ts` → 310/310 pass (was 307; +3 from new Task 2 tests)

## TDD Gate Compliance

Both tasks are `tdd="true"`:

- **Task 1:** `fb4eeff` (test commit, RED — file does not compile because shot-status-repo.ts is missing) → `084b13b` (feat commit, GREEN — all 14 tests pass) ✓
- **Task 2:** `8d1a8af` (test commit only — adds 3 additional behavioral guards on top of the GREEN suite from Task 1). All 17 tests pass. Strictly speaking Task 2's `tdd="true"` produces only a test commit because the production code was already in place; the new tests verify behaviors (atomicity rollback, cross-shot isolation, null-coalesce path) that were not explicitly asserted by Task 1's RED scaffold but are now locked in.

All TDD gates compliant.

---
*Phase: 20-shot-status-engine*
*Plan: 20-02*
*Completed: 2026-05-12*
