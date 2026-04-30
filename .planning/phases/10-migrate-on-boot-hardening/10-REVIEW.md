---
phase: 10-migrate-on-boot-hardening
reviewed: 2026-04-30T00:55:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/engine/errors.ts
  - src/store/migrate.ts
  - src/store/db.ts
  - src/store/__tests__/migrate-no-op.test.ts
  - src/store/__tests__/migrate-stale-db.test.ts
findings:
  critical: 0
  warning: 0
  info: 4
  total: 4
status: findings_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-04-30T00:55:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** findings_found (4 INFO, 0 LOW, 0 MEDIUM, 0 HIGH)

## Summary

Phase 10 lands a clean migrate-on-boot hardening cohort. The engine-layer
foundation (`MIGRATION_PENDING` ErrorCode + `runMigrations()` helper), the
boot-path wiring (`openDb()` close-before-throw), and the two test files all
hit the bar: real assertions, real DB roundtrip, typed-error envelope
end-to-end, architecture purity preserved (zero MCP imports across all five
files; verified via `grep -c "@modelcontextprotocol/sdk"` returning 0 for
each), WAL + busy_timeout=5000 invariant unchanged, no new MCP tools, no
breach of the tool-engine separation rule.

Project-rule audit: PASSED.
- `src/store/migrate.ts`: zero MCP imports, zero hono imports, zero
  `src/tools/` imports — pure store-layer helper.
- `src/store/db.ts`: WAL + busy_timeout=5000 pragmas preserved unchanged at
  lines 47-48; the new `runMigrations()` call slots in at the same position
  the inline drizzle migrator used to occupy.
- `src/engine/errors.ts`: additive arm only, comment-grouped consistently
  with existing Phase-N section comments.
- `TypedError(MIGRATION_PENDING, ...)` carries a human-readable `.message`
  + actionable `.hint` referencing both `drizzle-kit push` AND
  `sqlite3 <db> < drizzle/<migration>.sql` — meets CLAUDE.md "error
  responses must be human-readable with actionable guidance".
- Tool budget unchanged at 6/12 (no new MCP tool registrations).

Test-quality audit: real, not claim-only. The 4 no-op assertions exercise
two consecutive `openDb()` calls against a real SQLite file; the 7 stale-DB
assertions inspect `.code`, `.message`, and `.hint` on a real `TypedError`
instance; the `engineConstructorSpy` proof is structural-only (and the test
file is honest about that — see IN-04 below for the one slight oversell in
the verification doc, not in the test itself).

All findings below are INFO — observations to consider for future
maintenance, not defects warranting a fix in this phase.

## Info

### IN-01: `MigrationResult.applied` is the pre-apply pending count, not the post-apply actual count

**File:** `src/store/migrate.ts:99-122`
**Issue:** `runMigrations()` returns `{ applied: pending, ... }` where
`pending` is calculated BEFORE `drizzleMigrate(db, ...)` runs (line 106).
The JSDoc at lines 19-22 documents this honestly ("number of pending
migration entries observed before the migrator ran"), but the field name
`applied` reads like "what was just applied" to most consumers — which is
NOT what it stores. Concretely: on a fresh DB with 4 journal entries, the
function returns `{ applied: 4 }` even if `drizzleMigrate()` partially
succeeded and partially failed (the failure path throws, but the success
return value is the pre-count, not a post-count). Today this is harmless —
the only consumer is the test in `migrate-no-op.test.ts` which checks
`applied === 0`, and that case is invariant. But if a future caller
compares pre/post counts to detect partial-apply situations, the naming
will mislead.

**Fix:** Either rename the field (`pendingBeforeApply`) OR re-query
`countAppliedRows(db)` AFTER the `drizzleMigrate()` call and return the
delta. Lowest-risk option: keep the field, add a one-line JSDoc warning
that this is the pre-apply count.

```typescript
export interface MigrationResult {
  /**
   * Pending count observed BEFORE drizzleMigrate() ran. NOT a post-apply
   * count — does not re-read __drizzle_migrations after success. On a
   * clean (already-current) DB this is 0 and `skipped` is true.
   */
  applied: number;
  skipped: boolean;
}
```

### IN-02: `countAppliedRows` swallows all exceptions, not just "no such table"

**File:** `src/store/migrate.ts:62-76`
**Issue:** The `try { ... } catch { return 0; }` block was sized to handle
the fresh-DB case where `__drizzle_migrations` doesn't yet exist. It also
silently swallows: a closed-handle error, a permission error, a corrupt-DB
error, or a TypeScript-level error from the two `as unknown as` casts
returning `null` for `rawDb`. In practice, those failures would re-surface
on the next line (`drizzleMigrate(db, ...)` at line 111) which would throw
and produce a `MIGRATION_PENDING` typed error — so the user-visible surface
is fine. But the misleading `applied = 0` reading inside the catch could
make `pending = totalInJournal` and the error message would name the
*first* journal tag instead of the *real* failing tag. Minor diagnostic
fidelity loss only.

**Fix:** Narrow the catch to "no such table" specifically. better-sqlite3
exposes `err.code === 'SQLITE_ERROR'` and `err.message` includes the
phrase. Example:

```typescript
} catch (err) {
  const msg = (err as Error)?.message ?? '';
  if (msg.includes('no such table')) return 0;
  // Re-throw anything else — don't paper over real failures here.
  throw err;
}
```

This is safe to defer; today's behavior is "always-actionable error from
the next line" which is acceptable.

### IN-03: Five sub-tests duplicate ~7 lines of DB-setup boilerplate

**File:** `src/store/__tests__/migrate-stale-db.test.ts:58-94, 96-108, 110-129, 197-212`
**Issue:** Five `it(...)` blocks each repeat the same 7-line incantation:
```typescript
const { runMigrations } = await import('../migrate.js');
const Database = (await import('better-sqlite3')).default;
const { drizzle } = await import('drizzle-orm/better-sqlite3');
const sqlite = new Database(dbPath);
const db = drizzle(sqlite);
```
≈ 35 duplicated lines. Only the first sub-test (line 65) also sets
`sqlite.pragma('journal_mode = WAL')` — the other four skip it. The
inconsistency is harmless because the `vi.mock` makes the migrator throw
before any pragma matters, but it adds noise.

**Fix:** Extract a single helper local to the test file. The lazy-import
contract (vi.mock hoist must precede module resolution) is preserved
because the helper is itself lazy:

```typescript
async function openDrizzleHandle(dbPath: string): Promise<{
  db: BetterSQLite3Database; sqlite: Database.Database;
  runMigrations: typeof import('../migrate.js').runMigrations;
}> {
  const { runMigrations } = await import('../migrate.js');
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  return { db: drizzle(sqlite), sqlite, runMigrations };
}
```

Defer until the next time this file is touched.

### IN-04: "Boot path bails before tool registration" test asserts a JS tautology, not engine-layer wiring

**File:** `src/store/__tests__/migrate-stale-db.test.ts:162-189`
**Issue:** The `simulateBoot()` test at line 178-185 defines a local
function:
```typescript
function simulateBoot(): void {
  const { db } = openDb(dbPath);   // throws on Phase 10 mock
  engineConstructorSpy(db);         // unreachable
}
```
…and then asserts `engineConstructorSpy` was never called. This is
trivially true given that `openDb` threw — the same assertion would hold
for any callback placed after any throwing call in any sync function.
The test is honest about this in its comment ("structural assertion —
we don't import server.ts ... we don't import src/engine/pipeline.ts's
Engine"), and the architecture-purity directory-level guard at
`src/__tests__/architecture-purity.test.ts:38` separately prevents the
real Engine from being imported into a store-layer test. So this is the
best test shape available given the boundary constraint.

The 10-VERIFICATION.md doc (lines 24, 105) and 10-03-PLAN.md sell this as
proof that the bail "happens BEFORE engine construction" — which it does
in the literal sense (the spy isn't called), but the proof is at the level
of "JS exceptions propagate" not "the actual engine code path is
guarded". The strongest available behavioral proof would be a separate
integration-level test (e.g., spawn `tsx src/server.ts --db <stale> --version`
and assert exit code + stderr) — out of scope for store-layer tests.

**Fix:** No code change needed in this phase. If a future phase adds
integration-level boot-path coverage, this test stays useful as a unit-level
backstop. Optionally, soften the comment from "Plan 10's close-before-throw
contract guarantees openDb's throw escapes before any engine code runs" to
"if openDb's throw escapes, downstream callers (Engine, tool registration,
HTTP listener, stdio dispatcher) cannot run — proven structurally by the
unreachable line below."

---

_Reviewed: 2026-04-30T00:55:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
