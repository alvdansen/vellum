---
phase: 01-foundation-hierarchy
plan: 01
subsystem: foundation
tags: [typescript, esm, sqlite, drizzle, wal, vitest, nanoid, zod, engine]

# Dependency graph
requires:
  - phase: none
    provides: greenfield start
provides:
  - ESM-native vfx-familiar package with pinned runtime + dev deps
  - SQLite+WAL openDb() with pragma-first init and user_version=1 migration gate
  - Drizzle schema + raw SCHEMA_DDL dual-export for 5 hierarchy tables
  - HierarchyRepo — typed CRUD for workspace/project/sequence/shot with TypedError wrapping
  - BreadcrumbResolver — engine-owned leaf→root tree walk with ' > ' text form
  - Engine facade — 12 methods, returns {entity, breadcrumb} and {items, total, limit, offset}
  - TypedError class + 8 error codes (WORKSPACE/PROJECT/SEQUENCE/SHOT_NOT_FOUND, PARENT_NOT_FOUND, DUPLICATE_NAME, INVALID_SHOT_FORMAT, INVALID_INPUT)
  - Test infrastructure: vitest config, makeInMemoryDb fixture, toThrowTypedError matcher, FakeEngine spy
affects: [01-02, 01-03, 02-01, 03-01]

# Tech tracking
tech-stack:
  added:
    - "@modelcontextprotocol/sdk@^1.29.0"
    - "hono@^4.12.14"
    - "@hono/node-server@^2.0.0"
    - "better-sqlite3@^12.9.0"
    - "drizzle-orm@^0.45.2"
    - "zod@^4.3.6"
    - "nanoid@^5.1.9"
    - "fetch-to-node@^2.1.0"
    - "typescript@^5.7"
    - "vitest@^4.1.4"
    - "tsx@^4.21.0"
    - "drizzle-kit@^0.31.0"
    - "@modelcontextprotocol/inspector"
  patterns:
    - "S1: Tool-Engine purity — zero @modelcontextprotocol/sdk imports under src/engine, src/store, src/utils, src/types"
    - "S3: TypedError wrapping — raw SQLite and Zod errors never cross the engine boundary"
    - "S4: Breadcrumb on every response — engine.breadcrumb.resolve() is the single call path"
    - "S5: Pragma-before-schema DB init — journal_mode → busy_timeout → foreign_keys → user_version → DDL"
    - "S6: stderr-only logging — zero console.log / process.stdout.write anywhere in src/"
    - "S7: ESM .js import suffixes with NodeNext + moduleResolution NodeNext"
    - "S8: List envelope {items, total, limit, offset} — locked for Phase 4 inheritance"

key-files:
  created:
    - "package.json"
    - "tsconfig.json"
    - ".gitignore"
    - "vitest.config.ts"
    - "src/types/hierarchy.ts"
    - "src/utils/id.ts"
    - "src/engine/errors.ts"
    - "src/engine/breadcrumb.ts"
    - "src/engine/pipeline.ts"
    - "src/store/schema.ts"
    - "src/store/db.ts"
    - "src/store/hierarchy-repo.ts"
    - "src/test-utils/fixtures.ts"
    - "src/test-utils/matchers.ts"
    - "src/test-utils/fake-engine.ts"
    - "src/engine/__tests__/hierarchy.test.ts"
    - "src/engine/__tests__/shot-naming.test.ts"
    - "src/store/__tests__/db-init.test.ts"
  modified: []

key-decisions:
  - "Prefixed nanoid ids (ws_, proj_, seq_, shot_) for log readability — matches error-message examples from RESEARCH"
  - "isUniqueViolation() accepts both SQLITE_CONSTRAINT_UNIQUE and SQLITE_CONSTRAINT_PRIMARYKEY with UNIQUE-in-message fallback for version robustness"
  - "Shot regex ^sh\\d{3,}$ enforced at the Engine layer BEFORE repo delegation — repo is regex-agnostic"
  - "fetch-to-node pinned to ^2.1.0 (not ^1.0.0) and @hono/node-server pinned to ^2.0.0 (not ^1.19.12) — actual available versions; STACK.md pins were stale"
  - "user_version migration gate: fresh db (user_version=0) → install DDL + stamp 1; existing db !== 1 → throw explicit mismatch error"

patterns-established:
  - "S1 Tool-Engine purity: verified via grep across all of src/ (zero MCP SDK imports in engine/store/utils/types)"
  - "S3 TypedError wrapping: HierarchyRepo catches SQLITE_CONSTRAINT_* → throws DUPLICATE_NAME; parent missing → throws PARENT_NOT_FOUND; test asserts message does NOT contain SQLITE_CONSTRAINT"
  - "S4 Breadcrumb-on-every-response: every create/get returns {entity, breadcrumb}; every list item carries its own breadcrumb entries + text"
  - "S5 Pragma-before-schema: openDb() runs journal_mode=WAL → busy_timeout=5000 → foreign_keys=ON → user_version check → SCHEMA_DDL exec → user_version=1 stamp, in that order, test-pinned"
  - "S8 List envelope {items, total, limit, offset}: locked shape consumed by Plans 02/03 and inherited by Phase 4 search"

requirements-completed: [TRNS-04, HIER-01, HIER-02, HIER-03, HIER-04, HIER-05]

# Metrics
duration: 13min
completed: 2026-04-21
---

# Phase 01 Plan 01: Foundation Types + Store + Engine Summary

**Pure-engine substrate for VFX Familiar — SQLite+WAL store, Drizzle schema, HierarchyRepo, BreadcrumbResolver, and a 12-method Engine facade with shot-regex enforcement — all with zero MCP SDK dependency.**

## Performance

- **Duration:** 13 min (754 s)
- **Started:** 2026-04-21T04:42:52Z
- **Completed:** 2026-04-21T04:55:26Z
- **Tasks:** 8 of 8
- **Files created:** 18
- **Files modified:** 0 (greenfield)
- **Commits:** 8 task commits + 1 final metadata commit
- **Tests authored:** 39 (8 db-init + 15 shot-naming parameterized + 16 hierarchy integration)
- **Test runtime:** ~300ms

## Accomplishments

- **Pure-engine substrate ready:** Tool-layer (Plan 02) and server-layer (Plan 03) can now be added without touching any code below the tool boundary — the Engine facade exposes the exact `{entity, breadcrumb}` / `{items, total, limit, offset}` shapes they consume.
- **WAL-mode store with version gate:** `openDb()` enforces the `journal_mode=WAL → busy_timeout=5000 → foreign_keys=ON → user_version` order invariant (D-20, Pitfall #6, #10). `user_version` is stamped on first run, validated on re-open. Future schema changes will bump SCHEMA_VERSION cleanly.
- **Typed error model locked:** `TypedError` + 8 error codes. `HierarchyRepo` wraps `SQLITE_CONSTRAINT_*` into `DUPLICATE_NAME`; parent-missing checks throw `PARENT_NOT_FOUND` before the insert. Raw SQLite messages never leak — test-verified.
- **Shot regex centralized:** `^sh\d{3,}$` enforced once in `Engine.createShot()`. 6 valid cases (sh010, sh020, sh015, sh0120, sh1000, sh999999) + 10 invalid (SH010, sh1, sh_010, shot010, sh01, SH_010, sh-010, sh010a, '', Sh010) all covered parametrically.
- **Breadcrumbs on every response:** `BreadcrumbResolver.resolve()` walks leaf→root via the repo (at most 4 SELECTs for shot case). `' > '` separator locked. Test asserts 4-level `demo-ws > my-proj > sq010 > sh010` traversal.
- **39 tests green in ~300ms:** Full suite passes. `npx tsc --noEmit` clean. Pattern S1 grep-verified: zero `@modelcontextprotocol/sdk` matches under `src/engine`, `src/store`, `src/utils`, `src/types`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize package.json, tsconfig, install deps** - `3196b26` (chore)
2. **Task 2: Scaffold vitest config + test utilities** - `6d92da4` (chore)
3. **Task 3: Hierarchy types, id generator, TypedError** - `d949619` (feat)
4. **Task 4: Drizzle schema + SCHEMA_DDL for 5 tables** - `ddc5cfb` (feat)
5. **Task 5: openDb() with pragma-first init + 8 db-init tests** - `ad658e1` (feat)
6. **Task 6: HierarchyRepo with typed CRUD + constraint wrapping** - `bedd2e3` (feat)
7. **Task 7: BreadcrumbResolver for engine-level tree-walk** - `ff8ca1b` (feat)
8. **Task 8: Engine facade + shot regex + 31 engine tests** - `dbbea51` (feat)

## Files Created

**Scaffolding (Task 1-2):**
- `package.json` — ESM `"type": "module"`, 8 runtime deps + 7 dev deps, NodeNext-compatible scripts
- `tsconfig.json` — ES2022 target, NodeNext module+moduleResolution, strict, vitest/globals types
- `.gitignore` — node_modules, dist, *.db/*.db-wal/*.db-shm, coverage, .DS_Store, .env
- `vitest.config.ts` — ESM config, node env, 10s timeout, dashboard excluded from coverage

**Test utilities (Task 2):**
- `src/test-utils/fixtures.ts` — `makeInMemoryDb()` applies WAL pragmas + SCHEMA_DDL to `:memory:`
- `src/test-utils/matchers.ts` — `toThrowTypedError(code)` custom matcher with TS augmentation
- `src/test-utils/fake-engine.ts` — `FakeEngine` spy with all 12 methods + shot regex for Plan 02 consumption

**Foundation layer (Task 3):**
- `src/types/hierarchy.ts` — Workspace, Project, Sequence, Shot, Version, EntityType, BreadcrumbEntry, Breadcrumb (zero imports)
- `src/utils/id.ts` — `newId(prefix)` returns `${prefix}_<21-char-nanoid>`
- `src/engine/errors.ts` — `TypedError` class + 8-code `ErrorCode` union

**Store layer (Task 4-6):**
- `src/store/schema.ts` — 5 Drizzle tables (workspaces/projects/sequences/shots/versions) + SCHEMA_DDL string
- `src/store/db.ts` — `openDb(path)` with invariant pragma order + `SCHEMA_VERSION=1` user_version gate
- `src/store/hierarchy-repo.ts` — 12-method `HierarchyRepo` class, parameterized Drizzle queries, SQLITE_CONSTRAINT wrapping

**Engine layer (Task 7-8):**
- `src/engine/breadcrumb.ts` — `BreadcrumbResolver` with 4 branches, ' > ' separator, root→leaf ordering
- `src/engine/pipeline.ts` — `Engine` facade, 12 methods, shot regex `^sh\d{3,}$` enforced in createShot

**Tests (Task 5 + 8):**
- `src/store/__tests__/db-init.test.ts` — 8 tests: WAL, busy_timeout, foreign_keys, user_version, version mismatch, 5 tables, 4 indexes, idempotent re-open
- `src/engine/__tests__/shot-naming.test.ts` — 16 parameterized (6 valid + 10 invalid shot names)
- `src/engine/__tests__/hierarchy.test.ts` — 13 integration tests: create/get/list, duplicate wrapping, parent missing, pagination, breadcrumb traversal, newId uniqueness

## Decisions Made

- **Prefixed nanoid IDs (`ws_`, `proj_`, `seq_`, `shot_`, `ver_`)** — RESEARCH Cluster E error messages (`'ws_abc'`) used prefixed form. Applied verbatim so error messages stay grep-friendly. PATTERNS.md flagged this as a planner decision point and recommended prefixed.
- **Shot regex at Engine layer only (not at repo)** — Repo is regex-agnostic. Plan 02 may add defense-in-depth via Zod regex at tool boundary, but the canonical gate is `Engine.createShot()`. Aligns with D-07 / D-33 / S1.
- **`isUniqueViolation()` is tolerant** — Matches `SQLITE_CONSTRAINT_UNIQUE`, `SQLITE_CONSTRAINT_PRIMARYKEY`, and any `SQLITE_CONSTRAINT_*` whose message contains `UNIQUE`. Guards against better-sqlite3 version drift without false positives on e.g. `NOT NULL` constraint codes.
- **SCHEMA_DDL mirrors the Drizzle schema by hand** — Both exports live side-by-side in `src/store/schema.ts`. First-run path + in-memory fixture both `exec()` the DDL string; query builder uses Drizzle tables. Any future schema change must touch both — documented in the file header.
- **versions.parent_version_id is a forward self-reference** — SQLite tolerates this at CREATE TABLE time. Kept inline rather than deferred constraint because Phase 2+ will need the FK active from the first version insert.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `fetch-to-node@^1.0.0` and `@hono/node-server@^1.19.12` don't exist on npm**
- **Found during:** Task 1 (`npm install`)
- **Issue:** STACK.md pinned `fetch-to-node@^1.0.0` and `@hono/node-server@^1.19.12`. Both libraries have since moved to v2 — npm registry only has `fetch-to-node@{2.0.0, 2.1.0}` and `@hono/node-server@{2.0.0+}`. Install failed with `ETARGET / No matching version found`.
- **Fix:** Installed `fetch-to-node@^2.1.0` and `@hono/node-server@^2.0.0` — the actual available latest-majors. Both libraries preserve the same API shape (`toReqRes` / `toFetchResponse`) that the Plan 03 server bootstrap depends on.
- **Files modified:** `package.json`, `package-lock.json`
- **Verification:** `npm install` succeeded, 0 vulnerabilities reported on runtime deps; install count 130 packages.
- **Committed in:** `3196b26` (Task 1 commit)
- **Follow-up note:** STACK.md version pins should be refreshed before Plan 03 server bootstrap to avoid repeating the ETARGET confusion. The behavioral contract is unchanged — v2 of both libraries still ship the same bridging functions used by `mcp-hono-stateless`.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No functional regression. Plan 03 server will need to import the same `toReqRes` / `toFetchResponse` functions; v2 keeps that API. STACK.md refresh is a documentation task for the doc-writer, not a blocker.

## Issues Encountered

None during planned work. All 8 tasks executed in order without rollback. One Rule 3 deviation (above) for the ETARGET version issue.

## User Setup Required

None — no external service configuration required. The project is a pure Node.js + SQLite library at this stage. Plan 03 will introduce the Streamable HTTP listener that might warrant port configuration documentation.

## Engine Contract for Plans 02/03

**Surface consumed by Plan 02 tools:**

```typescript
class Engine {
  createWorkspace(name: string): { entity: Workspace; breadcrumb: Breadcrumb };
  getWorkspace(id: string): { entity: Workspace; breadcrumb: Breadcrumb };
  listWorkspaces(limit: number, offset: number): { items: (Workspace & Breadcrumb)[]; total; limit; offset };
  // ... same shape for project/sequence (parameterized by parent id)
  createShot(sequenceId: string, name: string): { entity: Shot; breadcrumb: Breadcrumb };
  // ... etc
}
```

**Error codes available (8 total):**
`WORKSPACE_NOT_FOUND`, `PROJECT_NOT_FOUND`, `SEQUENCE_NOT_FOUND`, `SHOT_NOT_FOUND`, `PARENT_NOT_FOUND`, `DUPLICATE_NAME`, `INVALID_SHOT_FORMAT`, `INVALID_INPUT`

**TypedError → MCP envelope contract for Plan 02 `envelope.toolError()`:**
- Input: `TypedError` with `code`, `message`, optional `hint`
- Output: `{ isError: true, structuredContent: { code, message, hint? }, content: [{ type: 'text', text: JSON.stringify(...) }] }`
- Unknown errors → defensive re-wrap as `INVALID_INPUT` with generic message + stderr log

**List envelope (S8, locked):** `{ items: Array<Entity & Breadcrumb>, total: number, limit: number, offset: number }` — Phase 4 search will inherit this shape.

## Open Loose Ends for Plans 02/03

- **Plan 02 (Wave 2 — tools):** No MCP server, no `registerTool` calls, no Zod schemas yet. Plan 02 creates `src/tools/{workspace,project,sequence,shot}-tool.ts`, `src/tools/envelope.ts`, and `src/tools/index.ts`. Each tool is a thin Zod-validated delegate — one `engine.*(…)` call per action.
- **Plan 03 (Wave 3 — server):** No `src/server.ts` entrypoint. Plan 03 writes the 5-flag CLI parser, dual-transport bootstrap (stdio always + optional Streamable HTTP via Hono + `fetch-to-node@2.1.0`), and the `mcp-hono-stateless` pattern.
- **STACK.md refresh:** Version pins for `fetch-to-node` and `@hono/node-server` are now v2. Doc-writer should update STACK.md during Phase 1 retrospective.

## Threat Flags

No new threat surface introduced beyond what the plan's `<threat_model>` already enumerates. All mitigations from the threat register are in place:
- **T-01-01 Tampering (Drizzle parameterized queries):** Verified — `src/store/hierarchy-repo.ts` uses `db.insert(table).values(...).run()` and `db.select().where(eq(...))` throughout. No `${...}` string interpolation into any raw SQL path.
- **T-01-02 Information Disclosure (SQLITE_CONSTRAINT wrapping):** Verified by `hierarchy.test.ts` "duplicate workspace name throws DUPLICATE_NAME (not raw SQLite)" — asserts message does NOT contain `SQLITE_CONSTRAINT`.
- **T-01-04 TypedError hint safety:** Verified — `newId()` produces only nanoid strings, no user input interpolated into hint text (hint strings are literal at every throw site).
- **T-01-05 Shot regex:** Verified — `SHOT_REGEX = /^sh\d{3,}$/` is a module-level literal, both-ends anchored. No runtime construction.

## Self-Check: PASSED

- All 18 files created exist at listed paths
- All 8 task commits exist in `git log --oneline`
- Full test suite (`npx vitest run`) exits 0 with 39/39 passing
- `npx tsc --noEmit` exits 0 with zero errors
- Zero `@modelcontextprotocol/sdk` imports under `src/engine`, `src/store`, `src/utils`, `src/types`
- Zero `console.log` / `process.stdout.write` anywhere in `src/`

## Next Phase Readiness

Plan 02 (tools) can begin immediately. The Engine facade is the sole dependency and is fully wired with breadcrumbs + error handling. Plan 02 adds ≤ 40-line Zod-validated tool files that delegate to the engine — no business logic below the tool layer.

Plan 03 (server) depends on Plan 02's `registerWorkspace/Project/Sequence/Shot` exports. It can be started once Plan 02 lands its tool barrel (`src/tools/index.ts`).

---
*Phase: 01-foundation-hierarchy*
*Plan: 01*
*Completed: 2026-04-21*
