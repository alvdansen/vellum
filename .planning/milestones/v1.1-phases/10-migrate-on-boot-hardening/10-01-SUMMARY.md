---
phase: 10-migrate-on-boot-hardening
plan: 01
subsystem: database
tags: [drizzle, sqlite, migration, typed-error, store-layer]

# Dependency graph
requires:
  - phase: 04-asset-management
    provides: drizzle/0004_phase4_assets.sql migration that triggered the v1.0-demo stale-schema bug this phase exists to prevent
  - phase: 07-endpoint-reconciliation
    provides: COMFYUI_ENDPOINT_DRIFT TypedError pattern (mirrored shape — code + message + remediation hint)
provides:
  - MIGRATION_PENDING ErrorCode arm in src/engine/errors.ts (Phase 10 group)
  - src/store/migrate.ts module with runMigrations(db, opts?) helper returning MigrationResult { applied, skipped }
  - Reusable typed-error wrapping that names the failing migration filename, the underlying SQL error text, and a drizzle-kit / sqlite3 remediation hint
  - Pre-check pattern that diffs drizzle journal vs. __drizzle_migrations rows to surface pending count before invoking the migrator
affects: [10-02, 10-03]

# Tech tracking
tech-stack:
  added: []  # purely additive use of existing dependencies
  patterns:
    - "Architecture-purity-clean store helper (zero MCP / hono / transport imports — file-level grep)"
    - "TypedError wrapping mirrors Phase 7's COMFYUI_ENDPOINT_DRIFT shape"
    - "Drizzle journal + __drizzle_migrations pre-check for pending count"

key-files:
  created:
    - src/store/migrate.ts
    - .planning/phases/10-migrate-on-boot-hardening/deferred-items.md
  modified:
    - src/engine/errors.ts

key-decisions:
  - "D-CTX-6 deferred — v1.1 ships AUTO-APPLY + typed-error-on-failure as the SOLE behavior. The VFX_FAMILIAR_STRICT_MIGRATIONS=1 env toggle stays out (no user demand documented; auto-apply satisfies all four ROADMAP success criteria). Strict-mode revisits in v1.2 if a use case lands."
  - "Helper unwired in this plan — Plan 10-02 wires runMigrations() into openDb() / src/server.ts boot path, Plan 10-03 drives it from a stale-DB fixture test."
  - "Comments in migrate.ts must avoid the literal string '@modelcontextprotocol/sdk' and 'hono' — the architecture-purity test uses file-level grep -r -l, so even commented mentions fail the gate. Adopted MCP-string-free wording."

patterns-established:
  - "Store-layer helpers stay zero-MCP-string (purity test is file-level grep)"
  - "Engine-layer foundation lands BEFORE wiring (separates the typed-error contract from the boot-path integration so each plan ships in isolation)"

requirements-completed: [DEMO-01]

# Metrics
duration: 6min
completed: 2026-04-30
---

# Phase 10 Plan 01: Migrate-on-boot Engine-Layer Foundation Summary

**MIGRATION_PENDING TypedError arm + runMigrations() store helper that wraps drizzle's migrate() with a pending-count pre-check and typed-error failure surface naming the failing migration filename + remediation hint.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-30T07:17:38Z
- **Completed:** 2026-04-30T07:23:07Z
- **Tasks:** 2 of 2
- **Files modified:** 1
- **Files created:** 2 (1 source, 1 deferred-items log)

## Accomplishments

- `MIGRATION_PENDING` is a typed `ErrorCode` literal in `src/engine/errors.ts` (Phase 10 group, mirroring the existing Phase-grouped section-comment style).
- `src/store/migrate.ts` exports `runMigrations(db, opts?: { migrationsFolder? })` returning `MigrationResult { applied, skipped }`, with the public `MigrationResult` type also exported.
- Pending-count pre-check: reads `drizzle/meta/_journal.json` and queries `__drizzle_migrations` to determine `applied` (the count the migrator will attempt) and `skipped` (`true` iff `applied === 0`).
- Failure path raises `TypedError('MIGRATION_PENDING', message, hint)` carrying:
  - the failing migration filename (first pending journal `tag` + `.sql`),
  - the underlying SQL error text from drizzle,
  - a fixed remediation hint pointing at `npx drizzle-kit push` and the manual `sqlite3 <db> < drizzle/<file>.sql` recovery path.
- Architecture-purity preserved — `src/__tests__/architecture-purity.test.ts` 18/18 green; the `src/store/ has zero imports from @modelcontextprotocol/sdk` directory-level guard covers the new file.

## Task Commits

1. **Task 1: Add MIGRATION_PENDING to ErrorCode union** — `aeda0c6` (feat)
2. **Task 2: Create src/store/migrate.ts with runMigrations() helper** — `5d80389` (feat)

_Note: the plan declared `tdd="true"` on each task, but the plan body itself directs no test files to be written in this plan — Plan 10-03 owns the stale-DB fixture test. The TDD attribute reflects the broader DEMO-01 cohort (10-01 → 10-02 → 10-03 → green); within Plan 10-01 the contract is verified by `tsc --noEmit` + the existing architecture-purity gate._

## Files Created/Modified

- **`src/engine/errors.ts`** (modified, +3/-1) — appended Phase 10 grouped `MIGRATION_PENDING` arm to the `ErrorCode` union after the existing `COMFYUI_ENDPOINT_DRIFT` line; trailing semicolon shifted from the old last arm to the new one. `TypedError` class body untouched.
- **`src/store/migrate.ts`** (created, 119 lines) — new store helper. Imports: `node:fs`, `node:path`, `drizzle-orm/better-sqlite3/migrator`, `drizzle-orm/better-sqlite3` (type-only), `../engine/errors.js`. Exports: `runMigrations`, `MigrationResult`. Internal: `readJournal()`, `countAppliedRows()` (with the project's standard `as unknown as` escape hatch to reach the raw `better-sqlite3` handle past Drizzle's typed surface), `REMEDIATION_HINT` constant.
- **`.planning/phases/10-migrate-on-boot-hardening/deferred-items.md`** (created) — logs 5 pre-existing v1.1 ROADMAP-shape audit-test failures discovered during baseline checks (commit `04d5f60`-origin, NOT caused by Plan 10-01).

## Decisions Made

- **MCP-string-free comments** — adopted on the fly. The first draft of `migrate.ts` mentioned `@modelcontextprotocol/sdk` and `hono` in a comment that documented the architecture-purity contract. The architecture-purity test uses file-level `grep -r -l` and tripped on the comment mention. Reworded both the file header and the `runMigrations` JSDoc to avoid the literal package strings while preserving the contract documentation. Logged below as Rule 1 deviation.
- **Strict-mode toggle deferred (D-CTX-6 confirmed)** — Plan 10-01 ships AUTO-APPLY + typed-error-on-failure only. No env-var branch added. Plan declares this scope explicitly; this summary re-affirms it.
- **Helper unwired this plan** — `runMigrations()` is not yet called by `openDb()` or `src/server.ts`. Plan 10-02 owns the boot-path wiring; Plan 10-03 owns the stale-DB fixture test. This is intentional sequencing per the plan's `affects: [10-02, 10-03]` graph.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] MCP-package strings in comments tripped the architecture-purity test**
- **Found during:** Task 2 (post-write verification)
- **Issue:** The first draft of `src/store/migrate.ts` had a header comment block that read "Architecture-purity contract: zero imports from @modelcontextprotocol/sdk, zero from hono ..." — and a JSDoc with the same wording. The architecture-purity test (`src/__tests__/architecture-purity.test.ts:38`) uses file-level `grep -r -l '@modelcontextprotocol/sdk' src/store/` to detect violations. The grep matched the comment literal, so the test failed (1 expected 0).
- **Fix:** Rewrote both comment locations to express the same contract without quoting the package names: "Architecture-purity contract: zero MCP-SDK imports, zero HTTP-transport imports, zero imports from any transport layer." Added an inline reminder that the file-level grep makes even comment mentions forbidden.
- **Files modified:** `src/store/migrate.ts` (comments only — no code-path change)
- **Verification:** `npx vitest run src/__tests__/architecture-purity.test.ts` 18/18 green; `grep -c "@modelcontextprotocol/sdk" src/store/migrate.ts` returns 0; `grep -c "hono" src/store/migrate.ts` returns 0; `npx tsc --noEmit` exits 0.
- **Committed in:** `5d80389` (Task 2 commit, fix folded in before commit)

---

**Total deviations:** 1 auto-fixed (1 Rule-1 bug — false-positive on the very purity gate the file is supposed to satisfy)
**Impact on plan:** No scope creep — comment-only fix to satisfy a test assumption the plan wording itself implied (`grep -L "@modelcontextprotocol/sdk" src/store/migrate.ts | grep -q migrate.ts`). The plan's automated `<verify>` block actually uses `grep -L` (list files NOT matching) which would also have flagged the bug; rewording satisfies both.

## Issues Encountered

- **Pre-existing v1.1 ROADMAP-shape test failures (5)** — discovered during baseline check. `src/__tests__/phase-attribution.test.ts` and `src/__tests__/validation-flags.test.ts` carry v1.0-shaped expectations (e.g., "at least 9 phase blocks", "GAP CLOSURE phases 6, 7, 8, 9"). The v1.1 ROADMAP committed at `04d5f60` does not match. **Confirmed pre-existing**: stashed `src/store/migrate.ts`, re-ran the two suites, got the identical 5 failures. NOT caused by Plan 10-01. Out of scope per scope-boundary rule. Logged in `.planning/phases/10-migrate-on-boot-hardening/deferred-items.md` for the v1.1 milestone-close audit (or a follow-up "v1.1 audit-test update" plan if a future plan blocks on it).

  **Test count baseline reset for v1.1:** v1.0 archived at 760/763 passing. Post-`04d5f60` v1.1 baseline is **756/764 passing, 5 failing, 3 skipped** (the same 3 pre-existing v1.0 timing flakes plus the 5 ROADMAP-shape failures). **Plan 10-01 added zero new failures.** Verified by running with and without `src/store/migrate.ts` — 756 passing in both cases. The success-criterion "passing count ≥ 760" should be read against this v1.1 baseline; Plan 10-01 holds the line at 756.

- **No engine-layer code path consumes `runMigrations()` yet.** This is intentional — see Decisions Made.

## User Setup Required

None — no external service configuration required for this plan. The helper is local code only and is not yet wired to the boot path.

## Next Phase Readiness

- **Plan 10-02 ready** — can wire `runMigrations()` into `openDb()` (replacing the unguarded `migrate(db, { migrationsFolder: './drizzle' })` call at `src/store/db.ts:71`) and ensure `MIGRATION_PENDING` typed errors propagate up before either MCP transport opens.
- **Plan 10-03 ready** — can drive `runMigrations()` from a stale-DB fixture test (Phase 1 schema, missing 0004 tables) and assert the `MIGRATION_PENDING` typed error path fires.
- **No blockers, no concerns.** v1.1 ROADMAP-shape audit-test failures are deferred and tracked.

## Self-Check

- [x] `src/engine/errors.ts` modified — `git log --oneline -2` shows `aeda0c6 feat(10-01): add MIGRATION_PENDING ErrorCode arm`
- [x] `src/store/migrate.ts` exists at `/Users/macapple/comfyui-vfx-mcp/src/store/migrate.ts`
- [x] `.planning/phases/10-migrate-on-boot-hardening/deferred-items.md` exists
- [x] Commit `aeda0c6` exists in `git log --oneline --all`
- [x] Commit `5d80389` exists in `git log --oneline --all`
- [x] `grep "MIGRATION_PENDING" src/engine/errors.ts` returns 1 match
- [x] `grep "export function runMigrations" src/store/migrate.ts` returns 1 match
- [x] `grep -cE "@modelcontextprotocol/sdk|from .src/tools" src/store/migrate.ts` returns 0
- [x] `npx tsc --noEmit` exits 0
- [x] Architecture-purity test 18/18 green
- [x] Full suite 756 passing (== v1.1 baseline; no regression)

## Self-Check: PASSED

All claims verified against the working tree and git log.

---
*Phase: 10-migrate-on-boot-hardening*
*Completed: 2026-04-30*
