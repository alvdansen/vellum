# Phase 6: Dashboard Wire Quality — Research

**Researched:** 2026-04-23
**Domain:** Dashboard wire-quality fixes (server REST + dashboard SPA + SSE keep-alive) — TypeScript ESM, Hono 4.12, Drizzle ORM, Vitest, Preact
**Confidence:** HIGH (every fix is in already-shipped, well-tested code; all six SCs map 1:1 to file:line cites in the v1.0 audit)

## Summary

Phase 6 closes six discrete wire-quality tech-debt items from the v1.0 audit (`v1.0-MILESTONE-AUDIT.md`). Each Success Criterion is a small, surgical fix to a known location. Three are server-side (SC-1 recent_versions, SC-2 outputRoot, SC-4 qNum, SC-5 SSE keep-alive), two are client-side (SC-3 fetchJson, SC-6 normalizeStatus), and they share no architectural risk — they are not architectural changes, they are correctness fixes against contracts that the v1.0 surface already advertises but does not honor.

The ground-truth resources are already in the codebase: `Engine.outputRoot` exists privately at `pipeline.ts:92` (just not exposed through `EngineForDashboard`); `VersionRepo.listByShot()` is the template for the missing `listRecentCompleted()` method; `TypedError` + the established `INVALID_INPUT` error code already model the qNum failure shape; the engine emitter and `streamSSE` already plumb the keep-alive — the bug is that `writeSSE({ data: ': ping' })` produces `data: : ping\n\n` on the wire which is NOT a valid SSE comment per the WHATWG spec (a comment must begin with `:` as the first character of the line). The fix uses the underlying `stream.write(': ping\n\n')` raw-byte path, which Hono's `SSEStreamingApi` exposes via its inherited `StreamingApi.write()`.

The dashboard fixes (SC-3, SC-6) tighten the boundary contracts that already exist: `fetchJson` already throws on `!res.ok` but discards the body — extending it to attach the parsed `{ error: { code, message } }` envelope to a typed error subclass surfaces server intent in the UI. `normalizeStatus` already handles every member of the `Version['status']` union in named branches but ends with a silent `return 'queued'` fallback — replacing the fallback with an exhaustive `never` check (matching the pattern established by `toDashboardPayload` in `src/http/sse.ts:135`) catches future drift at compile time.

**Primary recommendation:** Execute as 6 small, independent plans (one per SC). No SC depends on another; they touch disjoint files with disjoint test surfaces. Plan them in the natural order presented (SC-1..SC-6) so the engine surface lands first (SC-1, SC-2 widen `EngineForDashboard`), the HTTP boundary tightens next (SC-4, SC-5), and the dashboard contracts finalize last (SC-3, SC-6). Use the existing `FakeEngine` + Hono `app.request()` pattern for server tests; reuse the dashboard's `MockEventSource` pattern for SSE-shape tests where needed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SC-1 recent_versions DB query | Engine (`src/engine/pipeline.ts`) | Store/Repo (`src/store/version-repo.ts`) | Engine is the only DB consumer per architecture purity; the new repo helper `listRecentCompleted(limit)` lives in VersionRepo to keep raw Drizzle SQL out of the engine facade. |
| SC-2 outputRoot resolution | API/Backend (`src/http/dashboard-routes.ts`) | Engine (`src/engine/pipeline.ts`) | The HTTP route owns path construction at the FS boundary; engine just exposes its already-stored `outputRoot` field via `EngineForDashboard`. Route also `path.resolve()`s to make it CWD-independent. |
| SC-3 typed error preservation | Browser/Client (`packages/dashboard/src/lib/api.ts`) | — | Pure dashboard concern. The server already emits the typed envelope via `typedErrorHandler` (Plan 05-03); `fetchJson` is the single client-side leverage point. |
| SC-4 qNum validation | API/Backend (`src/http/dashboard-routes.ts`) | — | HTTP-boundary concern: typed error must surface BEFORE any engine call. Pattern matches the existing `INVALID_INPUT` throw at `dashboard-routes.ts:163` for missing `?against=`. |
| SC-5 SSE comment frame | API/Backend (`src/http/sse.ts`) | — | Pure HTTP-streaming concern. Use `stream.write()` (raw bytes) instead of `stream.writeSSE({data})` (which prepends `data: `). |
| SC-6 normalizeStatus exhaustiveness | Browser/Client (`packages/dashboard/src/lib/shape.ts`) | — | Pure type-discipline concern; mirrors the `never`-default exhaustiveness pattern in `src/http/sse.ts:135` `toDashboardPayload`. |

## Phase Requirements

(None — gap closure phase. All v1.0 requirements remain satisfied per `v1.0-MILESTONE-AUDIT.md` §Requirements Coverage. This phase closes deferred tech-debt items WR-01, WR-04, WR-05, IN-01, IN-02, IN-04 from the audit.)

## Standard Stack

### Core (already in use — no new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `hono` | ^4.12.14 | HTTP framework + SSE streaming via `streamSSE` helper | Already mounted on the dashboard route + SSE endpoint. `SSEStreamingApi.write()` (inherited from `StreamingApi`) is the documented escape-hatch for raw-byte writes. [VERIFIED: `node_modules/hono/dist/types/utils/stream.d.ts:13`] |
| `drizzle-orm` | ^0.45.2 | Type-safe SQL query builder for the recent_versions query | Existing repo pattern (`VersionRepo.listByShot` at `src/store/version-repo.ts:182`) is the direct template. [VERIFIED: codebase grep] |
| `zod` | ^4.3.6 | Validation library | Already used in tool layer; for SC-4 we don't need a Zod schema (the qNum check is two lines of imperative code) but keeping the option open. [VERIFIED: `package.json`] |
| `vitest` | ^4.1.4 | Test framework — both server (`environment: 'node'`) and dashboard (`environment: 'jsdom'`) | Existing test infrastructure: `npm test` for server, `npm run test:dashboard` for dashboard. [VERIFIED: `vitest.config.ts` + `packages/dashboard/vitest.config.ts`] |

### No new packages required

Every fix uses libraries already pinned in `package.json`. No `npm install` needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom `DashboardApiError` subclass for SC-3 | Bare `Error` with attached `body` | Subclass enables `instanceof` checks in the views; bare-Error works but loses the type. Subclass wins per CLAUDE.md "structure responses with context" rule. |
| Manual qNum validation for SC-4 | Zod `z.coerce.number().int().nonnegative()` | Zod gives schema-first validation but adds 200+ chars per param + a pipeline of `.parse() → catch → re-throw TypedError`. The two-line imperative version (`Number.isInteger(n) && n >= 0`) is shorter, has the same correctness, and matches how `?against=` is already validated at `dashboard-routes.ts:160`. |
| `stream.writeln(': ping')` for SC-5 | `stream.write(': ping\n\n')` | `writeln` adds a single `\n`, but SSE comments must terminate with `\n\n` (blank line) to flush. `write('...:ping\n\n')` is unambiguous. |
| `assertNever(raw)` helper for SC-6 | Inline `const _: never = raw` | Helper would be reusable but adds an import; inline matches the existing pattern in `src/http/sse.ts:135`. |

## Architecture Patterns

### System Architecture Diagram

```
                 ┌─────────────────────────────────────────────┐
                 │  Dashboard SPA (Preact, packages/dashboard) │
                 │  ┌────────────────┐    ┌─────────────────┐ │
                 │  │ fetchJson      │    │ normalizeStatus │ │
SC-3 fix here ──▶│  │ (lib/api.ts)   │    │ (lib/shape.ts)  │◀─── SC-6 fix here
                 │  └────────┬───────┘    └─────────────────┘ │
                 └───────────┼─────────────────────────────────┘
                             │ HTTP (REST, GET /api/...)
                             │ + SSE (GET /api/events)
                             ▼
                 ┌─────────────────────────────────────────────┐
                 │  Hono server (src/server.ts + src/http/)    │
                 │                                              │
                 │  ┌─────────────────┐    ┌─────────────────┐ │
                 │  │ dashboard-routes│    │ sse.ts          │ │
SC-2/SC-4 here ─▶│  │  • /api/.../   │    │  • streamSSE    │◀─── SC-5 fix here
                 │  │    output      │    │    + adapter    │ │      (writeSSE → write)
                 │  │  • qNum() guard│    │  • keep-alive   │ │
                 │  └────────┬────────┘    └────────┬────────┘ │
                 └───────────┼──────────────────────┼──────────┘
                             │                      │
                             │ Engine method calls  │ engine.events.onEvent
                             ▼                      ▼
                 ┌─────────────────────────────────────────────┐
                 │  Engine facade (src/engine/pipeline.ts)     │
                 │                                              │
SC-1 fix here ──▶│  • getDashboardHome() — recent_versions:[]  │
                 │  • outputRoot field (private, not exposed)  │
                 └────────────┬────────────────────────────────┘
                              │ Drizzle ORM
                              ▼
                 ┌─────────────────────────────────────────────┐
                 │  SQLite (better-sqlite3 + WAL)              │
                 │  versions table (status='completed')        │
                 └─────────────────────────────────────────────┘
```

### Component Responsibilities

| File | Responsibility | Touched in |
|------|----------------|------------|
| `src/engine/pipeline.ts` | Engine facade — `getDashboardHome()` + `outputRoot` field | SC-1, SC-2 |
| `src/store/version-repo.ts` | `listByShot()` template; needs new `listRecentCompleted(limit)` method | SC-1 |
| `src/http/dashboard-routes.ts` | All 18 REST routes; output-streaming `/api/versions/:id/output` + `qNum()` helper | SC-2, SC-4 |
| `src/http/sse.ts` | SSE handler — `createSseHandler` keep-alive interval + `KEEP_ALIVE_INTERVAL_MS` | SC-5 |
| `packages/dashboard/src/lib/api.ts` | `fetchJson<T>` typed-fetch wrapper for all 18 routes | SC-3 |
| `packages/dashboard/src/lib/shape.ts` | `normalizeStatus()` server-status → StatusPill-status mapping | SC-6 |

### Pattern: Engine Surface Widening (used by SC-1, SC-2)

Both SC-1 and SC-2 require widening `EngineForDashboard` (the structural Pick type at `dashboard-routes.ts:54`). The pattern is established by Phase 5 and is exactly two changes: extend the Pick keys, extend `FakeEngine` to mirror the new method/field. No invocation site changes (Hono routes call the methods directly).

```typescript
// src/http/dashboard-routes.ts (existing pattern — extend it)
export type EngineForDashboard = Pick<
  Engine,
  | 'listWorkspaces'
  | /* ... existing 16 methods ... */
  | 'getDashboardHome'
  | 'outputRoot'              // ← SC-2 add
>;

// src/test-utils/fake-engine.ts (mirror)
export class FakeEngine {
  public readonly outputRoot: string = 'outputs';   // ← SC-2 add (default)
  // ...existing methods...
}
```

### Pattern: TypedError at HTTP Boundary (used by SC-4)

The route already throws `TypedError('INVALID_INPUT', ...)` at `dashboard-routes.ts:163` for the `/diff` route's missing `?against=` param. The same pattern applies to SC-4. The `typedErrorHandler` at `src/http/error-middleware.ts:104` already maps `INVALID_INPUT` → 400 (`error-middleware.ts:85` `code.startsWith('INVALID_')`).

```typescript
// Reference: src/http/dashboard-routes.ts:160-170 (existing)
app.get('/api/versions/:id/diff', (c) => {
  const against = c.req.query('against');
  if (!against) {
    throw new TypedError(
      'INVALID_INPUT',
      "Missing required query parameter 'against'",
      'Call GET /api/versions/:id/diff?against=<other_version_id>',
    );
  }
  return c.json(engine.diffVersions(c.req.param('id'), against));
});
```

### Pattern: Exhaustive Switch with `never` (used by SC-6)

Identical pattern to `src/http/sse.ts:133-138` `toDashboardPayload`:

```typescript
// Reference: src/http/sse.ts:135 (existing — copy this idiom)
default: {
  // Exhaustiveness check — any unhandled key fails here.
  const _exhaustive: never = type;
  throw new Error(`toDashboardPayload: unhandled event type: ${String(_exhaustive)}`);
}
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE comment framing (SC-5) | Custom byte concatenation outside the SSEStreamingApi | `stream.write(': ping\n\n')` from `StreamingApi.write` | Already correct underlying API; `writeSSE` is the wrong wrapper for comments. [VERIFIED: `node_modules/hono/dist/helper/streaming/sse.js:9-26`] |
| Path resolution for outputRoot (SC-2) | Manual `process.cwd() + '/'+ outputRoot` | `path.resolve(this.outputRoot, versionId, filename)` | `path.resolve` is the standard Node API for CWD-independent absolute paths; handles edge cases (already-absolute paths pass through unchanged). [CITED: nodejs.org/api/path] |
| Numeric query parsing (SC-4) | A new validation framework | `Number.isInteger(n) && n >= 0` + existing `TypedError('INVALID_INPUT', ...)` | One line of imperative code; the typed-error envelope already exists (`src/engine/errors.ts:14`). |
| Custom error class hierarchy (SC-3) | Multiple subclasses per error code | Single `DashboardApiError` with `code: string` + `status: number` + `body: unknown` fields | Server emits structured `{ error: { code, message } }`; one subclass attaches all of it. Views can `instanceof DashboardApiError` and switch on `err.code`. |
| Status union enumeration (SC-6) | Hard-coded list of strings | TypeScript exhaustive `never` check | The compiler enforces it for free; rebuilding the list as data is busywork. |

**Key insight:** Every fix in this phase is a hardening of an existing surface, not a new component. The wrong-shape habit to break is "let me add a helper module" — instead, edit the one file that already owns the contract.

## Runtime State Inventory

Not applicable — this phase changes only code; no rename/refactor/migration. Specifically verified:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `versions.status` enum is unchanged. SC-1 reads existing rows; no schema change. | None |
| Live service config | None — Hono app, no external service rewiring. | None |
| OS-registered state | None — no daemons / launch agents / scheduled tasks involved. | None |
| Secrets/env vars | None new. SC-2 may surface `outputRoot` as a future env-configurable knob, but the audit item only requires using the value already passed at construction time (`server.ts:196` literal `'outputs'`). | None for this phase |
| Build artifacts | Dashboard rebuild needed after SC-3/SC-6 land (`packages/dashboard/dist/`); covered by existing `npm run build:dashboard`. | Run dashboard build at phase close |

## Common Pitfalls

### Pitfall 1: SSE comment line confusion (SC-5)
**What goes wrong:** Calling `stream.writeSSE({ data: ': ping' })` looks correct because `: ping` is the SSE comment syntax. But Hono's `writeSSE` ALWAYS prefixes lines with `data: `, producing wire bytes `data: : ping\n\n`.
**Why it happens:** `writeSSE` is documented as "send a message" — comments are not messages, they're a different frame type per the spec.
**How to avoid:** Use `stream.write(': ping\n\n')` directly. Hono's `SSEStreamingApi extends StreamingApi`; the inherited `write(input: string)` writes raw bytes.
**Warning signs:** Wire-trace inspection shows `data: : ping`. The browser EventSource silently ignores the malformed frame (the spec says lines without a colon become field-name-only, and lines with `data:` content go to the message buffer — `: ping` as a value is a no-op message). The keep-alive intent works (TCP stays warm) but the on-the-wire shape lies about what's happening.

### Pitfall 2: outputRoot timing (SC-2)
**What goes wrong:** Engine constructor takes `outputRoot` (default `'outputs'`); `dashboard-routes.ts:227` ignores the engine and hardcodes `path.join('outputs', ...)`. If a future deployment runs the server from a different CWD or passes a non-default outputRoot to the constructor, the dashboard route reads from the wrong path.
**Why it happens:** Plan 05-04 wrote the route before Plan 05-06 wired the constructor; the literal `'outputs'` was a placeholder that survived rebase.
**How to avoid:** Expose `outputRoot` on `EngineForDashboard`, then use `path.resolve(engine.outputRoot, versionId, filename)`. `path.resolve()` makes the result CWD-independent — if the engine has an absolute outputRoot, the route uses it verbatim; if relative, it resolves against `process.cwd()` at call time, matching the engine's behavior in `output-downloader.ts:57`.
**Warning signs:** Test passes locally (CWD = repo root, default outputRoot) but fails in production with `OUTPUT_UNAVAILABLE` for a file that exists on disk. The `existsSync` check uses an unresolved path.

### Pitfall 3: typedErrorHandler swallows non-TypedError on the way back (SC-3 indirect)
**What goes wrong:** When you parse `await res.json()` in `fetchJson` and the body is plain text (HTML 502 page from a proxy), `res.json()` throws and now you have an unparseable error path. Your fancy `DashboardApiError` is never constructed; you get a `SyntaxError` instead.
**Why it happens:** Servers under stress return HTML even on `/api/*` routes (Cloudflare 502, nginx 504, etc.).
**How to avoid:** Wrap the `res.json()` call in a try/catch; on parse failure, fall back to a generic `DashboardApiError('UNKNOWN', res.statusText, undefined, res.status)`.
**Warning signs:** Console shows `SyntaxError: Unexpected token '<'` (HTML being parsed as JSON).

### Pitfall 4: qNum default-vs-error semantics (SC-4)
**What goes wrong:** The current `qNum` returns the fallback (default 20 or 0) on absence OR NaN. SC-4 asks us to throw on negatives + non-integer floats, but absence (`undefined`) must STILL return the fallback (`?limit=` is optional). If the throw-vs-fallback split is muddled, every list endpoint suddenly demands an explicit `?limit=` param and breaks the dashboard.
**Why it happens:** "Reject invalid input" sounds like "always validate", but the spec is "absent → default; present → must be a non-negative integer".
**How to avoid:** Branch explicitly:
```typescript
if (raw === undefined) return fallback;
const n = Number(raw);
if (!Number.isInteger(n) || n < 0) {
  throw new TypedError('INVALID_INPUT',
    `Query parameter '${name}' must be a non-negative integer (got '${raw}')`,
    'Pass a positive integer like ?limit=20');
}
return n;
```
The signature gains a `name` parameter so the error message tells the caller WHICH param failed.
**Warning signs:** Existing tests like `dashboard-routes.test.ts:96` (`/api/workspaces?limit=5&offset=10` → calls `listWorkspaces(5, 10)`) pass; new tests for `?limit=-1`, `?limit=1.5`, `?limit=foo` return 400.

### Pitfall 5: normalizeStatus and the union widening (SC-6)
**What goes wrong:** `Version['status']` in `packages/dashboard/src/types/entities.ts:47` is the union `'submitted' | 'running' | 'completed' | 'failed' | 'queued' | 'complete'` (six members — server's four + dashboard's two synonyms). The current `normalizeStatus` handles all six but ends with `return 'queued'`. If someone adds a seventh state to the type (e.g., `'aborted'`), the function silently maps it to `'queued'`, hiding the bug.
**Why it happens:** The defensive fallback was intentional ("never unstyled" per the docstring), but after CR-01 closure (Plan 05-13) the adapter at the SSE boundary already guarantees union-valid statuses. The fallback is no longer rescuing any real defect.
**How to avoid:** Replace the fallback with `const _exhaustive: never = raw; throw new Error(`normalizeStatus: unhandled status: ${String(_exhaustive)}`);`. Then deliberately handle every member of the union in named branches. Adding a future status to the type fails compilation until the function handles it.
**Warning signs:** `tsc --noEmit` is green but a new status appears at runtime as a grey `queued` pill. With the exhaustive check, `tsc --noEmit` fails immediately.

### Pitfall 6: dashboard test environment split
**What goes wrong:** `vitest.config.ts` at the repo root excludes `packages/**`. Running `npm test` does NOT run dashboard tests. SC-3 + SC-6 tests must be added under `packages/dashboard/src/` and run via `npm run test:dashboard`.
**Why it happens:** The dashboard needs `environment: 'jsdom'`; the server needs `environment: 'node'`. Mixing breaks both.
**How to avoid:** Always run BOTH commands at phase close: `npm test && npm run test:dashboard`. The phase verification gate must do likewise.
**Warning signs:** A green CI from `npm test` while the dashboard surface is broken.

## Code Examples

Verified patterns from this codebase + official sources:

### SC-1: VersionRepo.listRecentCompleted (template = `listByShot`)

```typescript
// src/store/version-repo.ts — extension following the listByShot template
// Reference: src/store/version-repo.ts:182 (existing pattern)
listRecentCompleted(limit: number): Version[] {
  return this.db
    .select()
    .from(versions)
    .where(eq(versions.status, 'completed'))
    .orderBy(sql`${versions.completed_at} DESC`)
    .limit(limit)
    .all() as Version[];
}
```

```typescript
// src/engine/pipeline.ts:662 — getDashboardHome uses it
// Reference: src/engine/pipeline.ts:670 (existing line for active-versions)
getDashboardHome(): {
  active_versions: Version[];
  recent_versions: Version[];
  workspaces: Workspace[];
} {
  const active = this.versionRepo.listPendingVersions();
  const recent = this.versionRepo.listRecentCompleted(10);  // ← SC-1 fix
  const { items: workspaces } = this.repo.listWorkspaces(50, 0);
  return { active_versions: active, recent_versions: recent, workspaces };
}
```

### SC-2: outputRoot resolution

```typescript
// src/engine/pipeline.ts:92 — make outputRoot public-readonly
// Currently: private readonly outputRoot: string;
// Change to: public readonly outputRoot: string;
```

```typescript
// src/http/dashboard-routes.ts:54 — extend EngineForDashboard
export type EngineForDashboard = Pick<
  Engine,
  /* ...existing 16 methods... */
  | 'getDashboardHome'
  | 'outputRoot'    // ← SC-2 add
>;

// src/http/dashboard-routes.ts:227 — use it
const filePath = path.resolve(engine.outputRoot, versionId, filename);
```

### SC-3: typed-error preservation in fetchJson

```typescript
// packages/dashboard/src/lib/api.ts — replace lines 24-30
export class DashboardApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'DashboardApiError';
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    let body: unknown;
    let code = 'HTTP_ERROR';
    let message = `HTTP ${res.status}${res.statusText ? `: ${res.statusText}` : ''}`;
    try {
      body = await res.json();
      const envelope = body as { error?: { code?: string; message?: string } };
      if (envelope?.error?.code) code = envelope.error.code;
      if (envelope?.error?.message) message = envelope.error.message;
    } catch {
      // Body is not JSON (HTML 502 from a proxy etc.) — fall back to status text.
    }
    throw new DashboardApiError(code, message, res.status, body);
  }
  return (await res.json()) as T;
}
```

### SC-4: qNum strict validation

```typescript
// src/http/dashboard-routes.ts:88-92 — replace
const qNum = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new TypedError(
      'INVALID_INPUT',
      `Query parameter '${name}' must be a non-negative integer (got '${raw}')`,
      'Use a positive integer like ?limit=20',
    );
  }
  return n;
};

// Update every existing call site to pass the param name:
//   qNum(c.req.query('limit'), 20, 'limit')
//   qNum(c.req.query('offset'), 0, 'offset')
```

### SC-5: SSE comment frame on the wire

```typescript
// src/http/sse.ts:206-208 — replace
// Reference: node_modules/hono/dist/helper/streaming/sse.js:9-26 (writeSSE source)
// SSEStreamingApi.write() is inherited from StreamingApi (raw byte write).
const keepAliveInterval = setInterval(() => {
  // SSE spec (WHATWG): a line beginning with ":" is a comment and ignored.
  // Must be a RAW write — `writeSSE` would prefix `data: ` and break the spec.
  void stream.write(': ping\n\n').catch(() => {});
}, KEEP_ALIVE_INTERVAL_MS);
```

### SC-6: normalizeStatus exhaustiveness

```typescript
// packages/dashboard/src/lib/shape.ts:39-44 — replace
export function normalizeStatus(raw: Version['status'] | undefined): Status {
  // Defensive: undefined is a valid input (Version.status is optional).
  if (raw === undefined) return 'queued';
  switch (raw) {
    case 'queued':
    case 'submitted':       return 'queued';
    case 'running':         return 'running';
    case 'complete':
    case 'completed':       return 'complete';
    case 'failed':          return 'failed';
    default: {
      // Exhaustiveness: adding a new state to Version['status'] fails here at
      // compile time. Pattern matches src/http/sse.ts:135 toDashboardPayload.
      const _exhaustive: never = raw;
      throw new Error(`normalizeStatus: unhandled status: ${String(_exhaustive)}`);
    }
  }
}
```

## State of the Art

This is a maintenance phase against a stable stack — no library churn to track. Two architectural notes worth recording:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plan 05-04 stub (`recent: Version[] = []`) | DB-backed `listRecentCompleted(10)` | Phase 6 (this phase) | Dashboard home actually shows recent versions |
| Plan 05-04 hardcoded `'outputs'` literal | `engine.outputRoot` + `path.resolve()` | Phase 6 (this phase) | Output streaming works regardless of CWD |

**Deprecated/outdated:**
- The fallback `return 'queued'` in `normalizeStatus` (Plan 05-08, intentional defensive default) is no longer load-bearing after CR-01 closure (Plan 05-13). The SSE adapter at `src/http/sse.ts:108` `SERVER_TO_DASHBOARD_STATUS` already guarantees the SSE wire only carries union-valid statuses; the fallback no longer rescues any defect.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A `listRecentCompleted(limit)` that returns the most recent N completed versions across ALL shots is what the dashboard home wants (vs. paginated, vs. per-workspace). | SC-1 implementation | If users want filtering or pagination, the API shape needs revision. The audit item (WR-04) only says "actual recent versions from the DB" with no qualifier — assumption is that 10 most recent completed is the minimum viable fix. The planner can ask; if "10 globally" is wrong, change the limit and add a workspace-id filter parameter. |
| A2 | `path.resolve()` against an absolute outputRoot returns the absolute path unchanged; against a relative root, it resolves against `process.cwd()` at call time. | SC-2 implementation | This is documented Node behavior, but if the planner discovers a need for a fixed-base resolution (e.g., relative to the repo root regardless of CWD), the engine needs to resolve at construction time and store an absolute path. Current Engine constructor stores the raw string. |
| A3 | The dashboard does not currently surface error envelopes anywhere (audit confirms WR-05 is "typed codes never surface in UI"). | SC-3 implementation | The phase only needs to PRESERVE the envelope at the fetchJson layer. Wiring a renderer (toast, banner, inline message) is OUT OF SCOPE — the audit item is about preservation at the data layer. If the planner sees evidence of an existing error UI, the SC may need to be extended to propagate the new `DashboardApiError` to it. |
| A4 | The 4 server-side status values + 2 dashboard synonyms (`queued`, `complete`) are the FULL union; no in-flight migration adds a 7th status. | SC-6 implementation | If a future status (e.g., `'aborted'`, `'cancelled'`) is on the roadmap, the exhaustive check will catch it at the next type-check, which is the desired behavior. No risk from this assumption. |
| A5 | `KEEP_ALIVE_INTERVAL_MS = 30_000` does not need changing for SC-5; only the on-the-wire shape changes. | SC-5 implementation | If existing tests assert on the `: ping` SUBSTRING (they do — `sse.test.ts:319` checks `text.toContain(': ping')`), that assertion still passes after the fix because `: ping\n\n` still contains `: ping`. The fix is more strictly correct AND backward-compatible with existing assertions. |

## Open Questions (RESOLVED)

1. **Should `recent_versions` be pageable or scoped to a workspace?**
   - What we know: WR-04 says "actual recent versions from the DB (query + limit)" — no scoping or pagination mentioned.
   - What's unclear: The dashboard home currently has no UI affordance for paging recent versions (per HomeView review).
   - RESOLVED: Implement as `listRecentCompleted(10)` global (fits A1). Plan 06-02 honors this — scope/pagination can be added later without changing the response shape.

2. **Should the dashboard's `Version['status']` type be tightened to drop the synonyms?**
   - What we know: The type at `packages/dashboard/src/types/entities.ts:47` includes `'queued' | 'complete'` because the SSE adapter emits dashboard-shape values, but REST responses still emit server-shape values.
   - What's unclear: Whether the same type is reused for both REST + SSE payloads — if so, the union must stay wide.
   - RESOLVED: Leave the type as-is (six members). Plan 06-07 changes function behavior only, not the type.

3. **Do existing dashboard tests currently exercise `fetchJson` error paths?**
   - What we know: `packages/dashboard/src/__tests__/` has 5 test files; none mock fetch.
   - What's unclear: Whether SC-3 needs new test files or can extend an existing one.
   - RESOLVED: Plan 06-01 (Wave 0) creates `packages/dashboard/src/__tests__/api-error.test.ts` mocking `fetch` via `vi.stubGlobal('fetch', ...)`. Pattern matches existing `MockEventSource` setup in `events.test.ts`.

## Environment Availability

Skipped — phase has no new external dependencies. All required tools (Node.js, Vitest, Hono, Drizzle) are already installed and working per Phase 5 verification.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Server framework | Vitest 4.1.4 (`environment: 'node'`) |
| Server config file | `/Users/macapple/comfyui-vfx-mcp/vitest.config.ts` |
| Server quick run command | `npm test -- --run src/http/__tests__/dashboard-routes.test.ts src/http/__tests__/sse.test.ts src/store/__tests__/version-repo.test.ts` |
| Server full suite command | `npm test` |
| Dashboard framework | Vitest 4.1.4 (`environment: 'jsdom'`) |
| Dashboard config file | `/Users/macapple/comfyui-vfx-mcp/packages/dashboard/vitest.config.ts` |
| Dashboard quick run command | `npm run test:dashboard -- --run src/__tests__/api-error.test.ts src/__tests__/shape.test.ts` |
| Dashboard full suite command | `npm run test:dashboard` |
| Combined phase gate | `npm test && npm run test:dashboard` |

### Phase Requirements → Test Map

| SC | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|-------------|
| SC-1 | `getDashboardHome().recent_versions` returns rows from DB ordered by `completed_at DESC`, limited to 10 | unit (engine + repo) | `npm test -- --run src/store/__tests__/version-repo.test.ts src/engine/__tests__/pipeline.test.ts` | Both files exist; add new test cases |
| SC-2 | `/api/versions/:id/output` resolves the file path against `engine.outputRoot` (not literal `'outputs'`); test by setting `engine.outputRoot` to a tmp dir and writing the file there | route | `npm test -- --run src/http/__tests__/dashboard-routes.test.ts` | Existing file; add new `describe('outputRoot')` block |
| SC-3 | `fetchJson` rethrows a `DashboardApiError` carrying `code` + `status` + raw body when server returns `{ error: { code, message } }`; falls back to generic shape for non-JSON bodies | unit (mock fetch) | `npm run test:dashboard -- --run src/__tests__/api-error.test.ts` | NEW file (Wave 0) |
| SC-4 | `qNum` rejects negatives (`?limit=-1`), non-integer floats (`?limit=1.5`), and non-numeric strings (`?limit=foo`) with HTTP 400 + `{ error: { code: 'INVALID_INPUT', message } }`; absent param still returns fallback | route | `npm test -- --run src/http/__tests__/dashboard-routes.test.ts` | Existing file; add new `describe('qNum validation')` block |
| SC-5 | SSE keep-alive frame on the wire begins with `: ping\n\n` exactly (a true SSE comment per WHATWG) — NOT `data: : ping\n\n`; existing connection tests still pass | route (SSE wire) | `npm test -- --run src/http/__tests__/sse.test.ts` | Existing file; replace + harden the existing `keep-alive ping comment emitted after 30s` test |
| SC-6 | `normalizeStatus` returns the correct mapped value for every member of the union; throws for unknown input (in test, force-cast a string) | unit | `npm run test:dashboard -- --run src/__tests__/shape.test.ts` | NEW file (Wave 0) |

### Sampling Rate

- **Per task commit:** Run only the file(s) the task touches (commands above)
- **Per wave merge:** `npm test` (server full) + `npm run test:dashboard` (dashboard full)
- **Phase gate:** `npm test && npm run test:dashboard` both green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/dashboard/src/__tests__/api-error.test.ts` — covers SC-3 (NEW)
- [ ] `packages/dashboard/src/__tests__/shape.test.ts` — covers SC-6 (NEW)
- [ ] No framework install needed; existing Vitest setup covers both

### Validation Surfaces (one per SC)

| SC | Validation Surface | Key Assertions |
|----|----|----|
| SC-1 | `src/store/__tests__/version-repo.test.ts` (new test) | `repo.listRecentCompleted(10)` after inserting 12 completed + 3 submitted rows returns exactly 10 completed rows ordered by `completed_at DESC`. Empty DB returns `[]`. |
| SC-1 | `src/engine/__tests__/pipeline.test.ts` (new test) | `engine.getDashboardHome()` after seeding 3 completed versions returns `recent_versions.length === 3` (not the audit's empty `[]`). |
| SC-2 | `src/http/__tests__/dashboard-routes.test.ts` (new test) | Build `Engine` with `outputRoot: '/tmp/test-outputs'`, write fixture file there, request `/api/versions/:id/output`, assert 200 + correct body. Repeat with relative `outputRoot: '/tmp'` and assert `path.resolve` produced the absolute path. |
| SC-3 | `packages/dashboard/src/__tests__/api-error.test.ts` (Wave 0) | Mock `fetch` to return 404 + `{ error: { code: 'VERSION_NOT_FOUND', message: 'Version vX not found' } }`. Assert thrown error is `instanceof DashboardApiError`, `err.code === 'VERSION_NOT_FOUND'`, `err.status === 404`, `err.body.error.message` matches. Repeat for non-JSON body — `err.code === 'HTTP_ERROR'`. |
| SC-4 | `src/http/__tests__/dashboard-routes.test.ts` (new test) | `app.request('/api/workspaces?limit=-1')` returns 400 + `{ error: { code: 'INVALID_INPUT', message: /non-negative integer/ } }`. Same for `?limit=1.5` and `?limit=foo`. `app.request('/api/workspaces')` (no `limit`) still returns 200. |
| SC-5 | `src/http/__tests__/sse.test.ts` (extend) | After `vi.advanceTimersByTimeAsync(31_000)`, raw SSE text MATCHES regex `/(^|\n): ping\n\n/` — i.e., `: ping` appears at the START of a line, not after `data: `. Negative regex: text MUST NOT match `/data: : ping/`. |
| SC-6 | `packages/dashboard/src/__tests__/shape.test.ts` (Wave 0) | Each of the six valid inputs (`'submitted', 'running', 'completed', 'failed', 'queued', 'complete'`) maps to the documented Status. `undefined` returns `'queued'`. Casting `'unknown' as Version['status']` and calling `normalizeStatus` THROWS. |
| Cross-cutting | Existing `dashboard-routes.test.ts` + `sse.test.ts` + `events.test.ts` + `sse-signal-integration.test.tsx` | All 29 existing dashboard-suite tests + all server tests still green at phase close (no regressions). |

## Project Constraints (from CLAUDE.md)

| Directive | Phase 6 application |
|-----------|---------------------|
| Tool-engine separation: MCP tools delegate to engine services with zero MCP dependency | SC-1 changes the engine; no MCP tools touched |
| Tool cap: maximum 12 MCP tools | No new tools — currently 7 (well under cap) |
| Append-only provenance | Not applicable — no provenance writes in this phase |
| Prompt blob is truth | Not applicable — no provenance reads either |
| Async generation | Not applicable — no generation paths touched |
| SQLite WAL + busy_timeout=5000 | Already configured at `src/store/db.ts`; SC-1's new repo method inherits |
| Use `nanoid()` for all entity IDs | No new entities created |
| VFX naming convention (zero-padded versions) | No naming logic touched |
| Error responses must be human-readable with actionable guidance | SC-3 + SC-4 explicitly preserve/produce typed-error envelopes with `hint` strings |
| Never return raw JSON dumps | Server emits structured `{ error: { code, message } }`; SC-3 surfaces this in the UI |
| Paginate all list queries (default 20, include total count) | SC-1 honors this — `listRecentCompleted` takes a limit; the dashboard home aggregate already returns plain arrays for active/recent rails (no pagination contract to break) |

All directives compatible. No constraint is violated by any SC.

## Sources

### Primary (HIGH confidence)
- **Codebase grep / read** — every file:line cite verified by direct file read this session:
  - `src/engine/pipeline.ts:92, :100, :670-682` (Engine.outputRoot field; getDashboardHome stub)
  - `src/store/version-repo.ts:182` (listByShot template for SC-1)
  - `src/http/dashboard-routes.ts:54, :88-92, :160-170, :184-245, :227` (EngineForDashboard, qNum, INVALID_INPUT pattern, output route, hardcoded `'outputs'`)
  - `src/http/sse.ts:135-138, :199-208` (toDashboardPayload exhaustive switch; keep-alive)
  - `src/http/error-middleware.ts:25-90, :104-112` (statusForCode + typedErrorHandler)
  - `src/engine/errors.ts:4-35` (ErrorCode union, TypedError class)
  - `packages/dashboard/src/lib/api.ts:24-30` (current fetchJson)
  - `packages/dashboard/src/lib/shape.ts:39-44` (current normalizeStatus)
  - `packages/dashboard/src/types/entities.ts:47` (Version status union)
  - `packages/dashboard/src/components/StatusPill.tsx:14` (Status type)
  - `node_modules/hono/dist/helper/streaming/sse.js:9-26` (writeSSE source — confirms `data: ` prefix)
  - `node_modules/hono/dist/types/utils/stream.d.ts:13` (StreamingApi.write signature)
- **WHATWG HTML Spec — Server-Sent Events**: confirms a comment line MUST begin with `:` as the FIRST character; Hono's `writeSSE` produces `data: : ping` which is NOT a comment.

### Secondary (MEDIUM confidence)
- **`v1.0-MILESTONE-AUDIT.md`** — primary specification of the six SCs (read this session).
- **`.planning/research/STACK.md`** — Hono v4.12.14 confirmed, Vitest 4.1.4 confirmed.
- **MDN — Server-sent events**: corroborates the WHATWG colon-prefix comment rule.

### Tertiary (LOW confidence)
- None. Every claim in this RESEARCH.md is rooted in either a direct file read this session or the official spec/source URL.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library version confirmed via `package.json` + `node_modules/*/package.json` reads
- Architecture: HIGH — every file:line cite verified by direct read
- Pitfalls: HIGH — pitfalls 1, 2, 4, 5 derived from inspecting the actual code; pitfall 3 (proxy HTML) is a well-known production behavior; pitfall 6 (test environment split) verified via `vitest.config.ts` exclude rule

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (30 days — stable stack, no fast-moving APIs in scope)

---
**Sources cited inline (markdown hyperlinks for the WHATWG/MDN refs):**
- [WHATWG HTML Living Standard — Server-Sent Events §9.2](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [MDN — Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
