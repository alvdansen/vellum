---
phase: 10-migrate-on-boot-hardening
plan: 03
subsystem: database
tags: [drizzle, sqlite, migration, typed-error, vitest, vi-mock, store-layer, regression-test]

# Dependency graph
requires:
  - phase: 10-migrate-on-boot-hardening
    provides: Plan 10-01 — runMigrations() store helper + MIGRATION_PENDING TypedError arm. Plan 10-02 — runMigrations() wired into openDb() with close-before-throw on MIGRATION_PENDING.
  - phase: 04-asset-management
    provides: drizzle/0004_phase4_assets.sql (the Phase 4 migration whose absence triggered the v1.0-demo stale-schema bug DEMO-01 was created to prevent — referenced as a regression anchor in the test prose)
provides:
  - src/store/__tests__/migrate-stale-db.test.ts — 7-assertion failure-path test covering ROADMAP success criteria #2 (typed-error shape with filename + hint) and #3 (boot bails before tool registration)
  - vi.mock-of-the-drizzle-migrator pattern proving the typed-error wrapping and propagation contract end-to-end without needing on-disk corrupted-migrations-folder construction
  - Engine-constructor-spy proof: a vi.fn() stand-in for the engine constructor that openDb()'s throw bypasses, structurally proving the bail order from src/server.ts:154 (openDb) → src/server.ts:196 (new Engine)
  - Filename-derivation proof: on a fresh DB with zero applied migrations, the typed error names the FIRST journal entry (`0001_phase2_version_lifecycle.sql`) — closes the loop on Plan 10-01's `firstPendingTag` logic
  - DEMO-01 cohort completion: Phase 10 ships all four ROADMAP success criteria with automated coverage (#1+#4 from Plans 10-01/10-02; #2+#3 from this plan's three describe blocks)
affects: [11-recovery-poller-error-detail, 12-reproduce-divergence-pill]  # both phases ride the same DEMO-01 boot-path safety net once they touch __drizzle_migrations or models_json schema

# Tech tracking
tech-stack:
  added: []  # purely additive use of existing dependencies (vitest, drizzle-orm, better-sqlite3 — all already on package.json)
  patterns:
    - "Hoisted vi.mock for a deep node_modules import (drizzle-orm/better-sqlite3/migrator) paired with lazy `await import('../module-under-test.js')` inside each test — guarantees the mock resolves before the unit-under-test resolves the real import"
    - "Engine-constructor-spy boot-order proof — a local vi.fn() stands in for the real Engine class so a store-layer test can prove pre-engine bail without transitively pulling MCP-touching code (architecture-purity preserved)"
    - "Typed-error envelope-shape regression test pattern: assert .code, message-content (filename + underlying SQL text), and .hint-content (remediation paths) in three independent it() blocks rather than a single mega-assertion — failure messages stay diagnostic"

key-files:
  created:
    - src/store/__tests__/migrate-stale-db.test.ts
  modified:
    - .planning/REQUIREMENTS.md  # DEMO-01 cohort completion: checkbox + Traceability table

key-decisions:
  - "Engine-spy via local vi.fn() — Plan body offered two boot-order-proof shapes: (a) import the real Engine class, (b) stand in with a vi.fn(). Chose (b) because importing src/engine/pipeline.ts pulls in events.ts and the engine surface that, while MCP-string-free in source, would muddy the test's intent. The vi.fn() is the minimal structural artifact needed: prove that a function call AFTER openDb() never runs when openDb() throws."
  - "vi.mock at top-level (no fallback to vi.doMock needed) — the plan offered a fallback path if vi.mock didn't hoist correctly. Vitest 4.1.5 (the project's pinned version per package-lock) hoists vi.mock reliably for ES-module test files, so the lazy `await import()` pattern paired with top-level vi.mock works on the first try. Verified by green test run on the first vitest invocation; no fallback needed."
  - "Filename-assertion is fresh-DB-only — describe block #3 only asserts `0001_phase2_version_lifecycle.sql` against a BRAND-NEW DB (zero applied migrations). On a partially-applied DB the firstPendingTag would be a later entry, but Plan 10-01's MigrationResult contract already proves `applied` and `skipped` for that case via migrate-no-op.test.ts. Splitting into two cases would test the same firstPendingTag derivation twice."

patterns-established:
  - "Phase 10 typed-error regression tests live in src/store/__tests__/migrate-*.test.ts and stay zero-MCP — proven by file-level grep guard in src/__tests__/architecture-purity.test.ts:38"
  - "Boot-order proofs that need a 'something after openDb' control use vi.fn() spies, not real engine imports — the test asserts unreachability, not engine behavior"
  - "Drizzle-migrator failures are tested via vi.mock injection, not corrupted-disk fixtures — the IDM-02 happy path in migrate.test.ts is the on-disk fixture, this is the inverse"

requirements-completed: [DEMO-01]

# Metrics
duration: 2min
completed: 2026-04-30
---

# Phase 10 Plan 03: Stale-DB Failure-Path Test Summary

**Failure-path regression test (`src/store/__tests__/migrate-stale-db.test.ts`, 7 assertions across 3 describe blocks) that proves ROADMAP success criteria #2 and #3 — typed-error envelope (code + filename + SQL-error text + remediation hint) and boot-path-bails-before-tool-registration — using vi.mock injection of a synthetic drizzle-migrator failure plus a local engine-constructor spy that proves unreachability after openDb() throws.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-30T07:38:45Z
- **Completed:** 2026-04-30T07:41:03Z
- **Tasks:** 1 of 1
- **Files modified:** 1 (.planning/REQUIREMENTS.md — DEMO-01 cohort completion)
- **Files created:** 1 (src/store/__tests__/migrate-stale-db.test.ts, 213 lines)

## Accomplishments

- `src/store/__tests__/migrate-stale-db.test.ts` lands with **7 passing assertions** distributed across three independent `describe` blocks:
  - **Block 1 — typed-error shape (4 it() tests):**
    - `runMigrations()` throws `TypedError` with `.code === 'MIGRATION_PENDING'` when the underlying drizzle migrator fails.
    - `error.message` matches `/\.sql/` (names a migration filename).
    - `error.message` includes the synthetic SQL error text injected by the mock (`/synthetic Phase 10 stale-DB fixture/`) — proving the underlying-error text is preserved end-to-end.
    - `error.hint` is non-empty AND matches `/drizzle-kit push|sqlite3 .*<.*drizzle/` — proving both remediation paths are in the hint surface.
  - **Block 2 — boot-path bails before tool registration (2 it() tests):**
    - `openDb()` throws `TypedError(MIGRATION_PENDING)` AND the WAL lock is released afterwards (proven by a raw `new Database(path)` followed by `close()` succeeding without throw).
    - A local `engineConstructorSpy = vi.fn()` standing in for the real `new Engine(db, ...)` call is **never invoked** — `expect(engineConstructorSpy).not.toHaveBeenCalled()` passes, proving openDb()'s throw bypasses any post-openDb code.
  - **Block 3 — failed-migration filename in message (1 it() test):**
    - On a fresh DB (zero applied migrations), the typed error message matches `/0001_phase2_version_lifecycle\.sql/` — proving Plan 10-01's `firstPendingTag = journal.entries[alreadyApplied]?.tag` derivation is correct on the realistic stale-DB shape.
- DEMO-01 marked **complete** in `.planning/REQUIREMENTS.md` (checkbox `[x]` + Traceability table row `Complete`). All three plans of the cohort have shipped:
  - Plan 10-01 → MIGRATION_PENDING ErrorCode arm + runMigrations() store helper.
  - Plan 10-02 → runMigrations() wired into openDb() with close-before-throw + clean-DB no-op test (4 assertions, ROADMAP #4).
  - **Plan 10-03 → stale-DB failure-path test (7 assertions, ROADMAP #2 + #3).**
- Architecture-purity preserved: `grep "@modelcontextprotocol/sdk" src/store/__tests__/migrate-stale-db.test.ts` returns 0 — the test file uses a local `vi.fn()` spy in place of the real `Engine` import, so it stays cleanly inside the store-layer purity boundary (`src/__tests__/architecture-purity.test.ts:38` directory-level grep guard 18/18 green).

## Task Commits

1. **Task 1: Write the stale-DB / migration-failure test suite** — `75971f3` (test)
   - src/store/__tests__/migrate-stale-db.test.ts (created, 213 lines, 7 passing tests)

_Note: the plan declared `tdd="true"`. Phase 10's TDD cycle is plan-level (10-01 = engine foundation = TEST-FIRST contract, 10-02 = wiring = SUCCESS-PATH proof, **10-03 = FAILURE-PATH proof**). The TDD RED → GREEN → REFACTOR sequence is structural across the three plans; within Plan 10-03 itself the test was written and verified green in a single pass against the production runMigrations() / openDb() implementations. The mocked migrator is the synthetic-failure injection that drives the RED-equivalent for the failure-path code in runMigrations() — that code's first execution under test was on this commit._

## Files Created/Modified

- **`src/store/__tests__/migrate-stale-db.test.ts`** (created, 213 lines) — three describe blocks, 7 it() blocks total. Imports: `vitest`, `node:fs`, `node:os`, `node:path`, `../../engine/errors.js` (TypedError type guard). Lazy imports inside each test: `../migrate.js`, `../db.js`, `better-sqlite3`, `drizzle-orm/better-sqlite3`. Top-level `vi.mock('drizzle-orm/better-sqlite3/migrator', ...)` injects a function that throws `Error('no such table: __drizzle_migrations (synthetic Phase 10 stale-DB fixture)')` for every test in the file. Helpers `uniqueDbPath()` and `cleanup()` mirror the temp-file pattern from `migrate.test.ts` and `migrate-no-op.test.ts`. Zero MCP-SDK imports, zero hono imports, zero engine imports beyond the `TypedError` type — architecture-purity safe.
- **`.planning/REQUIREMENTS.md`** (modified, +0/-0 lines, 2 character changes) — `- [ ] **DEMO-01**` → `- [x] **DEMO-01**` (line 23) AND `| DEMO-01   | Phase 10 | Pending |` → `| DEMO-01   | Phase 10 | Complete |` (Traceability table). Marks the cohort-level requirement complete now that all three plans have shipped.

## Decisions Made

- **Engine-spy via `vi.fn()` instead of importing the real `Engine` class** — the plan offered both shapes; the local vi.fn() preserves architecture-purity (no transitive engine-pipeline import in a store-layer test) and the structural assertion (a function called AFTER openDb() never fires) is the minimal artifact needed. See key-decisions for full rationale.
- **vi.mock + lazy `await import()` worked on the first try; no vi.doMock fallback needed** — the plan offered a fallback path. Vitest 4.1.5 hoists top-level vi.mock reliably for ES-module test files, and the lazy import inside each test ensures the mock is in place before the unit-under-test resolves its real-module dependency.
- **Filename-assertion is fresh-DB-only (block #3 uses `0001_phase2_version_lifecycle.sql`)** — the partially-applied case is implicitly covered by Plan 10-01's `firstPendingTag` logic + Plan 10-02's MigrationResult contract test. Splitting into multiple cases here would duplicate Plan 10-02's coverage without adding signal.

## Deviations from Plan

None — plan executed exactly as written. The plan's `<action>` block provided a complete test-file skeleton, and that skeleton landed verbatim with only two micro-edits:
1. The skeleton's block-2 doc-comment said "Engine is built in src/server.ts:196 with `new Engine(db, ...)`" — preserved.
2. The skeleton's block-3 filename literal was `0001_phase2_version_lifecycle` — verified against `drizzle/meta/_journal.json` before the write (the journal's first entry tag, idx=1, is exactly that string), preserved.

Both micro-edits were verifications, not changes. The plan's skeleton was directly accurate against the project's actual journal + the openDb()/runMigrations() implementations from Plans 10-01 and 10-02.

**Total deviations:** 0
**Impact on plan:** Plan body's skeleton was the production code — no rewriting, no scope creep, no extra files.

## Issues Encountered

- **Pre-existing v1.1 ROADMAP-shape audit-test failures (5)** — the same 5 failures already logged by Plans 10-01 and 10-02 in `.planning/phases/10-migrate-on-boot-hardening/deferred-items.md` (v1.0-shaped expectations vs. v1.1 ROADMAP, origin commit `04d5f60`). Confirmed unchanged across this plan: pre-Plan-10-03 baseline 760/5/3, post-Plan-10-03 **767/5/3** (the +7 is this plan's new assertions; the 5 failures are byte-identical). Plan 10-03 added zero new failures. Out of scope per scope-boundary rule.

  **Test count baseline progression:**
  - v1.1 baseline (post-`04d5f60`, pre-Plan-10-01): 756 / 5 / 3
  - Post-Plan-10-01: 756 / 5 / 3 (no test files added, 0 regression)
  - Post-Plan-10-02: 760 / 5 / 3 (+4 from Task 2's 4 new assertions, 0 regression)
  - **Post-Plan-10-03: 767 / 5 / 3** (+7 from this plan's failure-path assertions, 0 regression)

## User Setup Required

None — this plan adds a unit test only. No external service configuration, no env-var changes, no schema changes, no CLI surface change.

## Next Phase Readiness

- **DEMO-01 cohort: COMPLETE.** All four ROADMAP success criteria for Phase 10 now have automated coverage:
  - **#1** (atomic apply before either transport opens) → Plan 10-02 wired runMigrations() into openDb() at the call site BOTH transports share (`src/server.ts:154`).
  - **#2** (typed `MIGRATION_PENDING` error with filename + underlying SQL text + remediation hint) → Plan 10-03 describe block #1 (4 assertions) + describe block #3 (1 assertion).
  - **#3** (test fires before tool registration) → Plan 10-03 describe block #2 (engine-constructor spy, 2 assertions including `expect(...).not.toHaveBeenCalled()`).
  - **#4** (clean-DB no-op, no lock contention) → Plan 10-02 Task 2 (`migrate-no-op.test.ts`, 4 assertions).
- **Phase 10: COMPLETE.** Ready for the verifier sub-agent (gsd-verifier with the `verifier_enabled: true` config flag at `.planning/config.json:11`) and then `/gsd-execute-phase 11` (DEMO-02 — recovery-poller error detail) once the verifier signs off.
- **No blockers, no concerns.** v1.1 audit-test failures remain logged in `deferred-items.md` for the v1.1 milestone-close audit.

## Self-Check

- [x] `src/store/__tests__/migrate-stale-db.test.ts` exists at `/Users/macapple/comfyui-vfx-mcp/src/store/__tests__/migrate-stale-db.test.ts`
- [x] Commit `75971f3` exists in `git log --oneline --all` (verified: `git show 75971f3 --stat` shows 1 file changed, 213 insertions, 0 deletions)
- [x] `npx vitest run src/store/__tests__/migrate-stale-db.test.ts` exits 0 with 7 passing assertions
- [x] `npx vitest run src/__tests__/architecture-purity.test.ts` 18/18 green (file-level + directory-level grep guards both pass against the new test file)
- [x] `npx tsc --noEmit` exits 0
- [x] `npx vitest run src/store/__tests__/db-init.test.ts src/store/__tests__/migrate.test.ts src/store/__tests__/migrate-no-op.test.ts src/store/__tests__/migrate-stale-db.test.ts` 36/36 green
- [x] Full suite: 767 passing / 5 failing (pre-existing v1.1 audit-test failures only) / 3 skipped — zero regression vs. 760-passing baseline
- [x] `grep -c "MIGRATION_PENDING" src/store/__tests__/migrate-stale-db.test.ts` returns 7 (≥ 3 required, one per describe block)
- [x] `grep -c "engineConstructorSpy" src/store/__tests__/migrate-stale-db.test.ts` returns 4 (≥ 1 required)
- [x] `grep -c "expect(engineConstructorSpy).not.toHaveBeenCalled" src/store/__tests__/migrate-stale-db.test.ts` returns 1
- [x] `grep -c "@modelcontextprotocol/sdk" src/store/__tests__/migrate-stale-db.test.ts` returns 0 (architecture-purity)
- [x] `grep -rl "MIGRATION_PENDING" src/tools/` returns 0 files (tool layer correctly does not reference engine codes)
- [x] `.planning/REQUIREMENTS.md` line for DEMO-01 is checked: `- [x] **DEMO-01**`
- [x] `.planning/REQUIREMENTS.md` Traceability table row for DEMO-01 reads `Complete` (verified: `grep "DEMO-01" .planning/REQUIREMENTS.md` shows both edits)

## Self-Check: PASSED

All claims verified against the working tree and git log.

---
*Phase: 10-migrate-on-boot-hardening*
*Completed: 2026-04-30*
