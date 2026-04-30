# Phase 10: Migrate-on-boot Hardening - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Eliminate the silent stale-schema boot failure mode that surfaced during the v1.0 demo as opaque HTTP 500 (`no such table: tags`) errors. Server either applies pending migrations cleanly at startup or refuses to boot with an actionable typed error.

**Trigger context:** v1.0 demo (2026-04-29) hit a stale-schema bug where the long-lived dev `vfx-familiar.db` predated Phase 4's `0004_phase4_assets.sql` migration. The server booted silently with stale schema; the only signal was a downstream HTTP 500 (`no such table: tags`) on the dashboard's `/api/versions/:id` route. Manual `sqlite3 ... < drizzle/0004_phase4_assets.sql` fixed it after the demo, but the silent-boot failure mode is the real defect.

**Success criteria (from ROADMAP):**
1. On startup, if `__drizzle_migrations` is behind the migrations folder, server applies all pending migrations atomically before opening either transport.
2. If migration application fails, server exits non-zero with a `MIGRATION_PENDING`-typed error naming the failed migration file and remediation.
3. Unit test boots server against a deliberately-stale DB fixture and asserts the `MIGRATION_PENDING` typed error path fires before any tool registration.
4. Running the server against a clean (already-current) DB is a no-op on the migration path — no spurious migration apply, no lock contention with WAL.
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss phase was skipped per user setting. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Likely shape (planner should validate)
- Migration runner integrated into `openDb()` or a new sibling helper invoked from `src/server.ts` before `buildEngine()`.
- Use `drizzle-orm`'s migrator (`drizzle-orm/better-sqlite3/migrator`) — already a dependency.
- New `MIGRATION_PENDING` error code added to the `ErrorCode` union (alongside Phase 7's `COMFYUI_ENDPOINT_DRIFT`).
- Two-mode behavior:
  - Default (production): apply pending migrations atomically.
  - Strict mode (env var `VFX_FAMILIAR_STRICT_MIGRATIONS=1`): refuse to boot with `MIGRATION_PENDING` instead of auto-applying.
- Test seam: a `migrate()` factory function that takes a `Db` handle so tests can stub or assert.
</decisions>

<code_context>
## Existing Code Insights

- `src/store/db.ts` exposes `openDb()` returning a `BetterSQLite3Database` with WAL + busy_timeout=5000.
- `drizzle/` has migrations 0001..0004; `__drizzle_migrations` table tracks applied (3 of 4 applied to dev DB until Phase 10 lands).
- `drizzle.config.ts` is configured for `drizzle-kit generate`/`push` workflows.
- Phase 7's `ensureEndpointHealthy()` is the reference pattern for "bail on misconfiguration before tool registration" (`src/comfyui/client.ts:315`).
- `TypedError` class + `ErrorCode` union in `src/types/errors.ts`.
- Architecture-purity test enforces no MCP imports outside `src/tools/` — migration runner must respect this boundary.
</code_context>

<specifics>
## Specific Ideas

- **Atomic application:** wrap migration apply in a single transaction so a partial failure leaves `__drizzle_migrations` consistent. SQLite supports DDL inside transactions for most schema changes, but `CREATE INDEX` cannot be in a transaction with concurrent writers — verify Drizzle's migrator handles this.
- **Failure messaging:** when a migration fails, surface (a) which migration filename was attempted, (b) the underlying SQL error text, (c) a remediation hint pointing at `npx drizzle-kit push` or the manual `sqlite3 db < drizzle/00XX_*.sql` path.
- **Lock contention:** if another process holds a WAL writer lock, the migrator should retry with backoff and surface a clear error after timeout (consistent with the `busy_timeout=5000` everywhere else).
- **Stale-DB unit test fixture:** create a temp DB that has the Phase 1 schema but lacks the Phase 4 tables; assert `MIGRATION_PENDING` raises before `buildEngine()` is called.
</specifics>

<deferred>
## Deferred Ideas

- Full strict-mode toggle behavior (auto-apply vs. fail-loud) — let the planner decide if both modes are needed for v1.1 or if auto-apply is sufficient.
- Migration rollback / down.sql — out of scope; v1.0 archive (Plan 04-01) explicitly documented IDM-03 "ROLLBACK NOT SUPPORTED" as the project policy.
- CLI flag mirror of the env var — defer until users ask.
</deferred>
