---
phase: 01-foundation-hierarchy
reviewed: 2026-04-21T05:36:25Z
depth: standard
files_reviewed: 32
files_reviewed_list:
  - .gitignore
  - package.json
  - src/__tests__/architecture-purity.test.ts
  - src/__tests__/stdio-hygiene.test.ts
  - src/__tests__/tool-budget.test.ts
  - src/__tests__/transport-parity.test.ts
  - src/__tests__/zero-config.test.ts
  - src/engine/__tests__/hierarchy.test.ts
  - src/engine/__tests__/shot-naming.test.ts
  - src/engine/breadcrumb.ts
  - src/engine/errors.ts
  - src/engine/pipeline.ts
  - src/server.ts
  - src/store/__tests__/db-init.test.ts
  - src/store/db.ts
  - src/store/hierarchy-repo.ts
  - src/store/schema.ts
  - src/test-utils/fake-engine.ts
  - src/test-utils/fixtures.ts
  - src/test-utils/matchers.ts
  - src/tools/__tests__/breadcrumb-always.test.ts
  - src/tools/__tests__/envelope.test.ts
  - src/tools/__tests__/error-wrapping.test.ts
  - src/tools/envelope.ts
  - src/tools/index.ts
  - src/tools/project-tool.ts
  - src/tools/sequence-tool.ts
  - src/tools/shape.ts
  - src/tools/shot-tool.ts
  - src/tools/workspace-tool.ts
  - src/types/hierarchy.ts
  - src/utils/cli.ts
  - src/utils/id.ts
  - tsconfig.json
  - vitest.config.ts
findings:
  critical: 0
  warning: 6
  info: 7
  total: 13
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-04-21T05:36:25Z
**Depth:** standard
**Files Reviewed:** 32 (approx; list counts the single test files + source files in the `files` config)
**Status:** issues_found

## Summary

Phase 1 delivers a well-architected foundation: the tool/engine/store/utils layering holds (verified by grep), the 4-tool budget is enforced, SQLite init obeys the pragma-before-schema ordering, and every tool response shape (breadcrumb, dual-form envelope, TypedError sanitization) is covered by tests. Parameterized queries via Drizzle protect against SQL injection, and the `toolError` fallback hardens against raw SQLite/Zod leakage with good test coverage.

The review surfaced **no Critical issues**, but found **6 Warnings** worth addressing before layering Phase 2 features on top of this foundation. The most significant are:

1. **Missing graceful shutdown / DB close path** (WR-01) — the stdio server holds a file-backed SQLite handle open for the process lifetime with no SIGINT/SIGTERM cleanup. Under WAL mode an unclean exit leaves `-wal`/`-shm` side-cars that recover but cause confusing test-time flake and potentially dropped writes at high load.
2. **HTTP transport lacks `Origin`-header validation** (WR-02) — MCP's own Streamable HTTP guidance (spec §Security) requires origin checks to block DNS-rebinding attacks even on loopback. Only the 127.0.0.1 bind is enforced.
3. **Non-POST methods on `/mcp` 404 silently** (WR-03) — the MCP Streamable HTTP spec requires `GET` and `DELETE` handling (or explicit 405/410). Current Hono route only registers `POST`.
4. **Breadcrumb resolver uses non-null assertions on parent lookups** (WR-04) — `getSequence(shot.sequence_id)!` will crash with a `TypeError: Cannot read properties of null` if a FK-orphaned row is ever inserted (e.g. by a future migration that disables FKs, or a corrupted db). Should throw a TypedError.
5. **N+1 breadcrumb resolution on shot lists** (WR-05) — `listShots(seqId, 100, 0)` issues 1 + 100×4 = 401 SELECTs; viable at 100-row cap but locks in a pattern that will bite in Phase 3+.
6. **`main()` never returns, never awaits HTTP server ready event** (WR-06) — boot-time bind errors (port in use) escape the `main().catch()` handler because `serve()` is synchronous-looking but the bind is async.

Several Info items note future maintenance risks (regex duplicated in 3 places, `versions` table shipped schema-only in Phase 1, no port range validation, etc.).

## Warnings

### WR-01: No SIGINT/SIGTERM handler; SQLite handle never closed

**File:** `src/server.ts:77-137`
**Issue:** `main()` opens a file-backed SQLite database via `openDb(dbPath)` and a long-lived `StdioServerTransport`, but registers no shutdown handlers. On SIGINT/SIGTERM (the normal way Claude Desktop / CLI detaches the server), the process exits without:
- Closing `sqlite` (no `sqlite.close()` call anywhere in `src/server.ts` — confirmed via grep)
- Disconnecting the MCP server transport
- Stopping the Hono `serve()` handle when `--http` is on

WAL mode recovers cleanly on next open, but (a) the stdio-hygiene and zero-config tests already rely on `child.kill('SIGTERM')` + leftover `.db-wal`/`.db-shm` cleanup (see `src/__tests__/stdio-hygiene.test.ts:42-46` and `src/__tests__/zero-config.test.ts:76-80`) — that's a telltale sign the cleanup is leaking; and (b) any future phase that uses `PRAGMA wal_autocheckpoint=OFF` or switches to a stateful HTTP transport will drop pending checkpoints.

**Fix:**
```typescript
// Add after buildServer() returns / before main exits:
async function registerShutdown(
  sqlite: Database.Database,
  stdioServer: McpServer,
  httpHandle?: { close: (cb?: () => void) => void },
): Promise<void> {
  const shutdown = async (signal: string) => {
    console.error(`vfx-familiar: received ${signal}, shutting down`);
    try { await stdioServer.close(); } catch { /* best effort */ }
    if (httpHandle) {
      await new Promise<void>((r) => httpHandle.close(() => r()));
    }
    try { sqlite.close(); } catch { /* best effort */ }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// In main():
const { db, sqlite } = openDb(dbPath);   // capture sqlite too, not just db
// ...
const httpHandle = args.http ? serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }) : undefined;
await registerShutdown(sqlite, stdioServer, httpHandle);
```
This also removes the `sqlite`-unused destructure (line 94 currently only pulls `db`).

---

### WR-02: HTTP transport accepts any Origin (DNS-rebinding risk)

**File:** `src/server.ts:110-130`
**Issue:** The Streamable HTTP transport is bound to `127.0.0.1` (good), but the Hono route accepts any `Origin` header. The MCP Streamable HTTP spec (§Security) and the SDK's `StreamableHTTPServerTransport` documentation explicitly warn that an attacker can still reach the server via DNS rebinding: a malicious page served from `evil.com` resolves `evil.com` to `127.0.0.1` and posts to `http://127.0.0.1:3000/mcp`. Without Origin validation, browser same-origin policy does NOT protect the server. This is the exact attack vector referenced in the project context ("CORS, port binding… DoS surface").

**Fix:**
```typescript
app.post('/mcp', async (c) => {
  const origin = c.req.header('origin');
  // Allow absent Origin (non-browser clients like the Inspector) but reject
  // cross-origin browser requests. Localhost-only while auth is not in place.
  if (origin !== undefined) {
    const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
    if (!allowed.test(origin)) {
      return c.text('Forbidden origin', 403);
    }
  }
  // ... rest unchanged
});
```
Also note: `T-03-04` (future ComfyUI keys in headers) elevates the severity of this gap — once secrets are in request headers, any origin leak leaks those secrets.

---

### WR-03: `/mcp` only handles POST; GET and DELETE fall through silently

**File:** `src/server.ts:113-122`
**Issue:** MCP Streamable HTTP (spec §Transport) defines three verbs on the endpoint:
- `POST`: client → server messages (implemented)
- `GET`: server → client SSE stream (unimplemented — Hono will 404)
- `DELETE`: explicit session termination (unimplemented — Hono will 404)

The stateless mode (`sessionIdGenerator: undefined`) legitimately skips DELETE, but the GET/SSE channel is the only way a server can push unsolicited notifications to the client. For Phase 1 the tools are synchronous so this may be intentional — but there is no comment justifying the omission, and a 404 on GET is more confusing than an explicit 405.

**Fix:**
```typescript
app.on('GET', '/mcp', (c) =>
  c.text('Method Not Allowed: stateless Streamable HTTP accepts POST only', 405, {
    Allow: 'POST',
  }),
);
app.on('DELETE', '/mcp', (c) => c.text('Method Not Allowed', 405, { Allow: 'POST' }));
```
Alternatively, add a single-line comment on the POST route: `// Stateless mode: GET/SSE and DELETE not required per MCP spec §Transport; other verbs will 404.` to make the design decision legible.

---

### WR-04: Non-null assertions on parent lookups in BreadcrumbResolver will crash on orphan rows

**File:** `src/engine/breadcrumb.ts:24-26, 36-37, 46`
**Issue:** The breadcrumb resolver uses non-null assertions (`!`) on every parent fetch:
```typescript
const seq = this.repo.getSequence(shot.sequence_id)!;
const proj = this.repo.getProject(seq.project_id)!;
const ws = this.repo.getWorkspace(proj.workspace_id)!;
```
This is safe today because FKs are enforced and `createShot`/`createSequence`/`createProject` all pre-check their parent (see `hierarchy-repo.ts:95, 161, 228`). But (a) a future `DELETE` or `CASCADE` migration could create orphans, (b) someone running `PRAGMA foreign_keys=OFF` briefly for a maintenance task could land bad data, (c) `better-sqlite3` applies `foreign_keys=ON` per-connection, so a second tool opening the file without the pragma bypasses FK enforcement. If any of these happen, the `!` triggers a raw `TypeError: Cannot read properties of null (reading 'project_id')` that escapes the engine → hits the `toolError` fallback → agent sees `INVALID_INPUT / Unexpected internal error` with no indication of the real corruption.

**Fix:** Throw a TypedError so the error code is actionable:
```typescript
case 'shot': {
  const shot = this.repo.getShot(id);
  if (!shot) throw new TypedError('SHOT_NOT_FOUND', `Shot '${id}' not found`);
  const seq = this.repo.getSequence(shot.sequence_id);
  if (!seq) throw new TypedError(
    'SEQUENCE_NOT_FOUND',
    `Shot '${id}' references missing sequence '${shot.sequence_id}' — hierarchy corruption`,
  );
  const proj = this.repo.getProject(seq.project_id);
  if (!proj) throw new TypedError(
    'PROJECT_NOT_FOUND',
    `Sequence '${seq.id}' references missing project '${seq.project_id}' — hierarchy corruption`,
  );
  const ws = this.repo.getWorkspace(proj.workspace_id);
  if (!ws) throw new TypedError(
    'WORKSPACE_NOT_FOUND',
    `Project '${proj.id}' references missing workspace '${proj.workspace_id}' — hierarchy corruption`,
  );
  // ... entries.push as before
}
```
Apply the same pattern to the `sequence` and `project` cases.

---

### WR-05: N+1 breadcrumb queries on every list() call

**File:** `src/engine/pipeline.ts:63-71, 97-109, 135-147, 178-190`
**Issue:** Each list method walks the returned items and resolves a fresh breadcrumb for every row:
```typescript
items: items.map((s) => ({ ...s, ...this.breadcrumb.resolve('shot', s.id) })),
```
`BreadcrumbResolver.resolve('shot', id)` issues up to 4 SELECTs per call. At the `limit.max=100` ceiling that's 401 SELECTs for a single `listShots` response, with the same workspace/project rows being re-fetched on every iteration. SQLite + WAL can handle this volume today, but:
- Phase 3's versions list will have the same 5-level walk → 501 SELECTs worst case.
- The in-memory pattern locks in: tools that walk deeper hierarchies (future asset library, render queue) will compound the hit.

The spec (per project-context notes: "Paginate all list queries — default 20, include total count") is honored, but the internal query budget is not. This isn't a correctness bug — it's a design smell that will require a bigger rework later if not caught now.

**Fix:** For Phase 1 keep as-is (working set ≤100 rows, in-process SQLite). Document the known cost with a TODO at each list site:
```typescript
listShots(/*...*/) {
  const { items, total } = this.repo.listShots(sequenceId, limit, offset);
  // TODO(phase 3): batch breadcrumb resolution — currently O(limit × 4) SELECTs.
  // Mitigation path: single SELECT with JOIN through sequences→projects→workspaces,
  // then build BreadcrumbEntry[] from the joined row. See PATTERNS.md #breadcrumb-batch.
  return {
    items: items.map(/* ... */),
    // ...
  };
}
```
If a quick win is preferred, cache workspace/project lookups within a single list() call via a per-call `Map<string, Workspace>`.

---

### WR-06: Boot-time bind errors from Hono `serve()` escape the top-level catch

**File:** `src/server.ts:126-130, 133-137`
**Issue:** `main()` is an `async` function and its rejection is captured at line 133: `main().catch(err => {...})`. But `serve({...})` from `@hono/node-server` starts the listener synchronously and can throw asynchronously — `EADDRINUSE`, permission denied, etc. are emitted on the underlying `net.Server`'s `error` event, not as a promise rejection. Currently:
1. `serve({...})` returns an `http.Server` handle immediately.
2. Any bind error fires on the server instance asynchronously — there's no handler attached, so it becomes an unhandled `'error'` event → Node's default handler crashes the process with a raw stack trace.
3. The `console.error('vfx-familiar: http transport listening on ...')` at line 127 lies — it prints even if the bind then fails.

This is annoying for users (bad UX when port 3000 is busy) and confusing for anyone debugging — the log says "listening" and then the process dies with a stack frame.

**Fix:**
```typescript
if (args.http) {
  const port = args.port ?? 3000;
  const app = new Hono();
  app.post('/mcp', async (c) => { /* ... */ });
  const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`vfx-familiar: port ${port} is in use. Try --port <N>.`);
    } else {
      console.error('vfx-familiar: http transport error:', err);
    }
    process.exit(1);
  });
  // Only log "listening" after listening event fires:
  server.on('listening', () => {
    console.error(`vfx-familiar: http transport listening on http://127.0.0.1:${port}/mcp`);
  });
}
```

---

## Info

### IN-01: Shot regex duplicated in 3 locations; drift risk

**File:** `src/engine/pipeline.ts:13`, `src/tools/shot-tool.ts:17`, `src/test-utils/fake-engine.ts:16`
**Issue:** The pattern `/^sh\d{3,}$/` is declared independently in the engine, the shot-tool Zod schema, and the test fake. D-07 mandates the engine is the authority, but no single source of truth prevents one copy drifting (e.g. someone tightening to `sh\d{3,4}` in the tool layer but missing the engine).

**Fix:** Export the regex from a shared location:
```typescript
// src/types/hierarchy.ts
export const SHOT_NAME_REGEX = /^sh\d{3,}$/;
```
Then import from all three call-sites. Defence-in-depth is preserved (each layer still checks independently) but drift is impossible.

---

### IN-02: `sqlite` destructured but unused in server boot

**File:** `src/server.ts:94`
**Issue:** `const { db } = openDb(dbPath);` — the `sqlite` half of `OpenDbResult` is discarded. Once WR-01 (shutdown) is implemented it'll be needed; for now it just leaves no handle to `.close()`.

**Fix:** Either (a) capture both: `const { db, sqlite } = openDb(dbPath);` even if unused, so the shutdown refactor is trivial; or (b) add a `/* sqlite retained implicitly on drizzle handle */` comment. Preference: (a).

---

### IN-03: `versions` table shipped schema-only — dead columns until Phase 2

**File:** `src/store/schema.ts:51-66, 109-120`
**Issue:** The `versions` table (with `status`, `job_id`, `parent_version_id`, `notes`, `completed_at`) is declared by Phase 1 DDL but has zero insert/select paths anywhere in `hierarchy-repo.ts`. This is explicitly called out as a D-10 decision (schema-only in Phase 1), so it is intended. Flagging only so reviewers of a future phase know they can't `DROP` or rename columns without a migration — user_version=1 is already committed with this schema.

**Fix:** Add a one-line comment at the versions table declaration citing D-10:
```typescript
// Phase 1 ships this table schema-only (D-10). Writes arrive in Phase 2.
// Any column change here requires a user_version bump + migration.
export const versions = sqliteTable('versions', {
```

---

### IN-04: `--port` accepts ports >65535 and port 1-1023 without warning

**File:** `src/utils/cli.ts:87-90`
**Issue:** `requireInt` rejects zero and non-integers, but accepts any positive integer. `--port 99999` will fail at Hono `serve()` time (escaping into WR-06's unhandled error path). `--port 80` will succeed on macOS (user ports), but fail with EACCES on Linux as non-root.

**Fix:** Tighten the validator:
```typescript
function requireInt(s: string | undefined, flag: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    die(`${flag} requires an integer in 1..65535`);
  }
  if (n < 1024) {
    console.error(`${flag}: warning — port ${n} is in the privileged range (<1024); bind may fail.`);
  }
  return n;
}
```

---

### IN-05: Unused `TypedError` import in `errors.ts` — harmless but `export type ErrorCode` could be inline

**File:** `src/engine/errors.ts:1-28`
**Issue:** No bug; style note only. `ErrorCode` is declared as a `type` alias; consumers like `toolError` use `err.code: string` (via structural check), not the union type, so the export surface is small. The file is clean. Flag only: consider moving `ErrorCode` next to `TypedError` as a member type `TypedError.Code` — keeps the public API narrower.

**Fix:** Optional; skip unless consolidating the engine public API.

---

### IN-06: `console.error` on startup mixes operational info with the stdio log channel

**File:** `src/server.ts:95, 105, 127-129`
**Issue:** D-21 says stderr is the log channel. The project honors this — all three startup messages go via `console.error`. But they carry operational info (`db=…`, `listening on …`) that a user running `npx tsx src/server.ts` on a terminal may want on stdout for piping/grep purposes. This is a user-facing choice, not a bug. D-21 is the right call for stdio-protocol safety; this note just makes the trade-off explicit.

**Fix:** No change. If a future phase adds a `--quiet` flag, gate these on non-quiet mode.

---

### IN-07: Test approach note — `_registeredTools` is SDK-private

**File:** `src/tools/__tests__/error-wrapping.test.ts:233`
**Issue:** The smoke test casts `server as unknown as { _registeredTools: Record<string, unknown> }` to inspect private SDK internals. This works today (MCP SDK 1.29) but will silently break on any SDK minor-version bump that renames `_registeredTools`. The transport-parity test (`src/__tests__/transport-parity.test.ts:72`) uses the public `client.listTools()` API and is robust.

**Fix:** Convert the smoke assertion to use `listTools()`:
```typescript
const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'smoke', version: '0.0.0' });
await server.connect(serverTx);
await client.connect(clientTx);
const tools = (await client.listTools()).tools.map((t) => t.name).sort();
expect(tools).toEqual(['project', 'sequence', 'shot', 'workspace']);
await client.close();
```
Or — cheaper — leave the test and add a one-line comment noting the SDK coupling so the next SDK bump is easy to fix:
```typescript
// SDK-private: _registeredTools may rename; see transport-parity.test.ts for the public-API version.
```

---

## Architectural Invariants — Verified

The critical Phase 1 invariants were all checked and pass:

| Invariant | Check | Result |
|---|---|---|
| D-33 tool-engine separation | `grep @modelcontextprotocol/sdk src/engine/ src/store/ src/utils/ src/types/` | ZERO matches |
| TOOL-01 tool cap (≤12) | `grep -rE 'server\.registerTool\(' src/tools/` | 4 calls |
| D-21 stdio hygiene | `grep -rnE 'console\.(log|info|warn|debug)' src/` | Only comment refs in tests; no source-code calls |
| D-21 stdout hygiene | `grep -rn 'process\.stdout' src/` | ZERO source matches |
| D-20 pragma-before-schema | `openDb()` lines 23-30 | WAL → busy_timeout → foreign_keys → user_version → DDL, in that exact order |
| Parameterized queries | All `hierarchy-repo.ts` SELECT/INSERT use Drizzle's `eq(…)` / `values(…)` builders | No raw `sql\`…${userInput}…\`` interpolation found |
| D-25 dual-form envelope | `toolOk` / `toolError` tests in `envelope.test.ts` | Every payload round-trips: `JSON.parse(content[0].text) === structuredContent` |
| D-28/D-32 raw-error sanitization | `envelope.test.ts:135-148` asserts wire-form excludes `SQLITE_CONSTRAINT`, `UNIQUE constraint failed`, `workspaces.name` | PASS |
| D-22/D-23 breadcrumb-on-every-response | `breadcrumb-always.test.ts` (207 lines) covers create + get + list for all 4 entity types | PASS |

## Notes on Items NOT Flagged

For the record — these were considered and rejected as non-issues:

- **SQL injection via Drizzle bindings:** All `where(eq(column, userVar))` calls use parameterized queries. No template strings are interpolated into SQL.
- **Race conditions in WAL init:** `openDb()` is synchronous (better-sqlite3 is blocking); no concurrent init path. The `user_version === 0` branch is atomic within a single `Database` constructor call.
- **Unbounded list queries:** Every list path is capped at `z.number().int().min(1).max(100).default(20)`. Engine signatures take `limit: number` as required, so no default-to-unbounded path exists.
- **Port conflict on parallel tests:** `stdio-hygiene` and `zero-config` tests use `--db ${tmpDb}-${Date.now()}.db` with cleanup; no shared port tests exist yet (HTTP transport is not exercised end-to-end in tests).
- **nanoid collision:** 21-char alphanumeric → ~149 bits of entropy; collision probability is negligible. `newId('ws')` prefix prevents cross-entity id collisions structurally.
- **Zod v4 discriminated union safety:** `z.discriminatedUnion('action', [...])` correctly narrows `input` to each variant in the switch; the `async (input) => {...}` body's `switch(input.action)` is exhaustive over the 3 discriminants.

---

_Reviewed: 2026-04-21T05:36:25Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
