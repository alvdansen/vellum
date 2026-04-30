---
phase: 10-migrate-on-boot-hardening
plan: 02
subsystem: database
tags: [drizzle, sqlite, migration, typed-error, boot-path, store-layer, vitest]

# Dependency graph
requires:
  - phase: 10-migrate-on-boot-hardening
    provides: Plan 10-01 — runMigrations() store helper + MIGRATION_PENDING TypedError arm. This plan wires the helper into openDb() and proves the clean-DB no-op contract.
  - phase: 04-asset-management
    provides: drizzle/0004_phase4_assets.sql (the migration whose absence triggered the v1.0-demo stale-schema bug Plan 10 exists to prevent)
provides:
  - openDb() routed through runMigrations() — the inline drizzle migrate() call at src/store/db.ts:71 is replaced with a typed-error-aware try/catch wrapper
  - Close-before-throw guarantee on MIGRATION_PENDING — sqlite handle is closed BEFORE the typed error escapes openDb() so the WAL lock releases (DM-02 parity, structurally identical to the existing user_version-mismatch path at lines 56-61)
  - Schema-polymorphic runMigrations() — function generic now accepts BetterSQLite3Database<TSchema> so the typed db handle from drizzle(sqlite, { schema }) flows through without an unsafe cast at the call site
  - src/store/__tests__/migrate-no-op.test.ts — 4 assertions covering ROADMAP success criterion #4 (clean-DB no-op + no spurious re-apply + no WAL lock contention)
  - Dual-transport-parity inference — both stdio and --http boot through the single openDb() call at src/server.ts:154, so the typed-error surface protects both transports without per-transport branching
affects: [10-03]

# Tech tracking
tech-stack:
  added: []  # purely additive use of existing dependencies
  patterns:
    - "Close-before-throw on boot-path failures (sqlite.close() releases WAL lock before TypedError escapes — mirrors the existing DM-02 user_version-mismatch path)"
    - "Single boot-path call site as transport-parity guarantee (one openDb() = both transports protected, structural rather than per-transport)"
    - "Schema-polymorphic store helpers (runMigrations<TSchema> accepts the typed BetterSQLite3Database without forcing the call site to drop the schema generic)"

key-files:
  created:
    - src/store/__tests__/migrate-no-op.test.ts
  modified:
    - src/store/db.ts
    - src/store/migrate.ts

key-decisions:
  - "Close-before-throw on MIGRATION_PENDING — wrap runMigrations(db) in a try/catch that calls sqlite.close() before re-throwing the TypedError. The lock-release guarantee is symmetric with the existing DM-02 user_version-mismatch path (lines 56-61) so a follow-up boot attempt against the same path is never blocked by a stale WAL writer lock."
  - "Schema generic on runMigrations — original signature accepted only the no-schema BetterSQLite3Database variant, which TypeScript correctly rejected at the openDb() call site (db is typed BetterSQLite3Database<typeof schema>). Made runMigrations<TSchema extends Record<string, unknown> = Record<string, never>> polymorphic; countAppliedRows() stays narrowly-typed because it reaches past the typed query builder anyway."
  - "Wire-only this plan — no env-var strict-mode toggle (D-CTX-6 deferred to v1.2 per Plan 10-01). Plan 10-03 will exercise the failure-path against a stale-DB fixture; this plan owns the success-path no-op proof."

patterns-established:
  - "Boot-path failure handlers must close the sqlite handle before re-throwing — pattern is now used in two places in src/store/db.ts (user_version mismatch at line 60, runMigrations failure at line 79)"
  - "Single openDb() call site at src/server.ts:154 is the structural guarantee that all transports inherit boot-path checks for free — no per-transport branching needed for typed-error surfaces"
  - "Test-suite TDD on a wiring-only refactor: Task 1 has no new test file; the existing src/store/__tests__/db-init.test.ts + migrate.test.ts function as the regression guard. New tests live in Task 2's dedicated file."

requirements-completed: [DEMO-01]

# Metrics
duration: 3min
completed: 2026-04-30
---

# Phase 10 Plan 02: Wire runMigrations() into openDb() Summary

**openDb() routed through runMigrations() with close-before-throw on MIGRATION_PENDING; clean-DB no-op contract proven by a 4-assertion regression test (ROADMAP success criterion #4); both transports inherit the typed-error surface via the single boot-path call site at src/server.ts:154.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-30T07:29:39Z
- **Completed:** 2026-04-30T07:32:48Z
- **Tasks:** 2 of 2
- **Files modified:** 2 (src/store/db.ts, src/store/migrate.ts)
- **Files created:** 1 (src/store/__tests__/migrate-no-op.test.ts)

## Accomplishments

- `openDb()` now calls `runMigrations(db)` in place of the inline `migrate(db, { migrationsFolder: './drizzle' })` at the prior `src/store/db.ts:71`. The direct `drizzle-orm/better-sqlite3/migrator` import is removed in favor of `import { runMigrations } from './migrate.js'`.
- A `try { runMigrations(db) } catch (err) { sqlite.close(); throw err; }` block guarantees the WAL lock releases before any thrown `MIGRATION_PENDING` TypedError escapes `openDb()`. This mirrors the existing DM-02 close-before-throw path on user_version mismatch.
- The `openDb()` doc-comment now declares the Phase 10 typed-error contract: "runs through runMigrations() so a failed apply surfaces as TypedError('MIGRATION_PENDING') with the failing migration filename + remediation hint, BEFORE buildEngine() / tool registration."
- `runMigrations()` is now schema-polymorphic — `runMigrations<TSchema extends Record<string, unknown> = Record<string, never>>` accepts the typed `BetterSQLite3Database<typeof schema>` flowing out of `drizzle(sqlite, { schema })` at `src/store/db.ts:64` without forcing a cast at the call site.
- `src/store/__tests__/migrate-no-op.test.ts` lands with 4 passing assertions:
  - First open against a fresh DB applies all migrations and does not throw.
  - Second open is a no-op — `runMigrations()` returns `{ applied: 0, skipped: true }`.
  - `__drizzle_migrations` row count stays at exactly 4 across both opens (no spurious re-apply).
  - Two sequential opens complete in < 2s (no WAL lock contention; failure mode would be a busy_timeout=5000ms wait).
- Dual-transport parity is structural — both stdio and `--http` boot paths flow through the single `openDb()` call at `src/server.ts:154`, so the typed-error surface protects both transports without per-transport branching.

## Task Commits

1. **Task 1: Refactor openDb() to delegate migration via runMigrations()** — `453a2f3` (feat)
   - src/store/db.ts: wired runMigrations() in place of inline migrate(); added close-before-throw try/catch
   - src/store/migrate.ts: added schema generic to runMigrations() to flow the typed db handle (Rule 3 fix)
2. **Task 2: Add clean-DB no-op regression test** — `fa99a2b` (test)
   - src/store/__tests__/migrate-no-op.test.ts: 4 assertions against ROADMAP success criterion #4

## Files Created/Modified

- **`src/store/db.ts`** (modified, +14/-7) — replaced the direct `migrate` import (line 3) with `import { runMigrations } from './migrate.js'`; replaced the inline `migrate(db, { migrationsFolder: './drizzle' })` at the prior line 71 with a `try { runMigrations(db) } catch (err) { sqlite.close(); throw err; }` block; updated the doc-comment block above the migration call to declare the Phase 10 typed-error guarantee. All pragma + user_version + DM-02-on-user_version-mismatch lines are unchanged.
- **`src/store/migrate.ts`** (modified, +5/-2) — added schema generic to `runMigrations<TSchema extends Record<string, unknown> = Record<string, never>>` so the typed `BetterSQLite3Database<typeof schema>` passes type-check at the openDb() call site; narrowed `countAppliedRows()` to the no-schema variant (with an internal `as unknown as` bridge inside `runMigrations`) since that helper reaches past the typed query builder anyway. No behavioral change — the underlying drizzle migrator is invoked with the same arguments and produces the same `__drizzle_migrations` rows on the same sequence.
- **`src/store/__tests__/migrate-no-op.test.ts`** (created, 88 lines) — 4 `it(...)` assertions inside `describe('Phase 10 — clean-DB migration no-op (DEMO-01, ROADMAP #4)', ...)`. Mirrors the `uniqueDbPath` / `cleanup` temp-file pattern from `migrate.test.ts`. Imports: `vitest`, `node:fs`, `node:os`, `node:path`, `../db.js`, `../migrate.js`. Zero MCP / hono mentions (architecture-purity safe).

## Decisions Made

- **Close-before-throw on MIGRATION_PENDING (DM-02 parity)** — Plan body specified the pattern, applied verbatim. The structural intent: a follow-up `openDb()` against the same path must not block on a stale WAL writer lock. Symmetric with the existing user_version-mismatch path at `src/store/db.ts:55-62`.
- **Schema generic on runMigrations** — added during Task 1 as a Rule 3 fix when `npx tsc --noEmit` reported `BetterSQLite3Database<typeof schema>` not assignable to `BetterSQLite3Database<Record<string, never>>`. Resolved by promoting `runMigrations` to `runMigrations<TSchema>` with a sensible `Record<string, never>` default, preserving call-site simplicity for tests that pass a no-schema handle. See deviations below.
- **Test-suite TDD on a wiring-only refactor** — Plan declared `tdd="true"` on Task 1, but the task is a contract-preserving refactor (drizzleMigrate is invoked with the same arguments at the same point in the boot sequence). The existing `src/store/__tests__/db-init.test.ts` (8 tests) and `src/store/__tests__/migrate.test.ts` (17 tests) function as the regression guard — green before and after the change. Task 2's `migrate-no-op.test.ts` is the dedicated new-test artifact for this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] runMigrations() signature did not accept the typed `BetterSQLite3Database<typeof schema>` flowing out of openDb()**
- **Found during:** Task 1 (post-edit `npx tsc --noEmit` check)
- **Issue:** Plan 10-01 typed `runMigrations(db: BetterSQLite3Database, ...)` against the no-schema-generic variant. At the new `runMigrations(db)` call site inside `openDb()`, `db` is typed `BetterSQLite3Database<typeof schema>` (the production schema), and TypeScript correctly reported `Property 'workspaces' is incompatible with index signature` on the schema mismatch. This blocked Task 1's automated verify (`npx tsc --noEmit` exits 0).
- **Fix:** Promoted `runMigrations` to a generic function `runMigrations<TSchema extends Record<string, unknown> = Record<string, never>>(db: BetterSQLite3Database<TSchema>, ...)` so it accepts any schema type. The default `Record<string, never>` keeps the no-schema call sites (e.g., the new `migrate-no-op.test.ts` uses an unannotated handle which infers from the openDb() return type) ergonomic. `countAppliedRows()` stays narrowly-typed against the no-schema variant — internally, `runMigrations` casts via `as unknown as BetterSQLite3Database<Record<string, never>>` to bridge, since the helper already reaches past the typed query builder into the raw better-sqlite3 client to read `__drizzle_migrations`.
- **Files modified:** `src/store/migrate.ts` (signature change only — no behavioral change to the migrator-invocation path or the typed-error wrap)
- **Verification:** `npx tsc --noEmit` exits 0; `npx vitest run src/store/__tests__/migrate.test.ts` 17/17 green (existing migration tests stay green — runMigrations is functionally identical on a healthy migrations folder); `npx vitest run src/__tests__/architecture-purity.test.ts` 18/18 green.
- **Committed in:** `453a2f3` (Task 1 commit, fix folded in alongside the db.ts wiring edit since they are mutually-dependent — db.ts cannot pass tsc without the migrate.ts signature change)

---

**Total deviations:** 1 auto-fixed (1 Rule-3 blocking — type signature on Plan 10-01's helper did not anticipate the schema generic flowing in from the call site)
**Impact on plan:** No scope creep. The fix is signature-only — same migrator, same TypedError wrap, same MigrationResult contract. The schema generic is the minimal correct shape for a store-layer helper that wraps drizzle's typed query builder. Identified and fixed during Task 1's automated verify; would not have been caught by Plan 10-01 alone since the helper had no production call site at that point.

## Issues Encountered

- **Pre-existing v1.1 ROADMAP-shape audit-test failures (5)** — same 5 failures already logged by Plan 10-01 in `.planning/phases/10-migrate-on-boot-hardening/deferred-items.md` (v1.0-shaped expectations vs. v1.1 ROADMAP, origin commit `04d5f60`). Confirmed unchanged: pre-Plan-10-02 baseline 756/5/3, post-Plan-10-02 760/5/3 (the +4 is Task 2's new tests; the 5 failures are byte-identical). Plan 10-02 added zero new failures. Out of scope per scope-boundary rule.

  **Test count baseline progression:**
  - v1.1 baseline (post-`04d5f60`, pre-Plan-10-01): 756 passing / 5 failing / 3 skipped
  - Post-Plan-10-01: 756 / 5 / 3 (no test files added, 0 regression)
  - Post-Plan-10-02: **760 / 5 / 3** (+4 from Task 2's 4 new assertions, 0 regression)

## User Setup Required

None — no external service configuration required. The wiring is internal to the boot path; no new env vars, no ComfyUI surface change.

## Next Phase Readiness

- **Plan 10-03 ready** — the failure-path counterpart to this plan's success-path proof. Plan 10-03 will:
  - Construct a stale-DB fixture (Phase 1 schema, missing the Phase 4 tables) so `runMigrations()` at the boot path raises `TypedError('MIGRATION_PENDING')`.
  - Assert the typed error surfaces from `openDb()` BEFORE `buildEngine()` (the single call-site invariant this plan establishes).
  - Optionally exercise the close-before-throw path (a second `openDb()` against the same fixture path should not block on a busy_timeout).
- **DEMO-01 cohort progression:** Plan 10-01 (engine foundation) → **Plan 10-02 (boot-path wiring + success-path proof)** → Plan 10-03 (failure-path proof) → DEMO-01 marked complete in REQUIREMENTS.md after Plan 10-03.
- **No blockers, no concerns.** v1.1 audit-test failures remain logged in deferred-items.md for milestone-close audit.

## Self-Check

- [x] `src/store/db.ts` modified — `git log --oneline -3` shows `453a2f3 feat(10-02): route openDb() through runMigrations() with close-before-throw`
- [x] `src/store/migrate.ts` modified — signature change folded into commit `453a2f3`
- [x] `src/store/__tests__/migrate-no-op.test.ts` exists at `/Users/macapple/comfyui-vfx-mcp/src/store/__tests__/migrate-no-op.test.ts`
- [x] Commit `453a2f3` exists in `git log --oneline --all`
- [x] Commit `fa99a2b` exists in `git log --oneline --all`
- [x] `grep "runMigrations" src/store/db.ts` returns matches (helper wired in)
- [x] `grep -B2 'throw err' src/store/db.ts | grep -q 'sqlite.close'` (close-before-throw pattern present)
- [x] `grep -c "drizzle-orm/better-sqlite3/migrator" src/store/db.ts` returns 0 (direct import removed)
- [x] `grep "Phase 10" src/store/db.ts` returns >= 1 match (doc-comment updated)
- [x] `npx tsc --noEmit` exits 0
- [x] `npx vitest run src/store/__tests__/migrate-no-op.test.ts` 4/4 passing
- [x] `npx vitest run src/store/__tests__/db-init.test.ts src/store/__tests__/migrate.test.ts src/store/__tests__/migrate-no-op.test.ts` 29/29 passing
- [x] Architecture-purity test 18/18 green (new test file uses no MCP imports)
- [x] Boot smoke test `npx tsx src/server.ts --db /tmp/phase10-smoke.db --version` exits 0 (prints `0.1.0`)
- [x] Full suite 760 passing (== v1.1 baseline + 4 from Task 2; no regression in the same 5 pre-existing failures)

## Self-Check: PASSED

All claims verified against the working tree and git log.

---
*Phase: 10-migrate-on-boot-hardening*
*Completed: 2026-04-30*
