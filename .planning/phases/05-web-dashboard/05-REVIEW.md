---
phase: 05-web-dashboard
reviewed: 2026-04-23T00:00:00Z
depth: standard
files_reviewed: 42
files_reviewed_list:
  - .github/workflows/ci.yml
  - .gitignore
  - package.json
  - packages/dashboard/index.html
  - packages/dashboard/package.json
  - packages/dashboard/src/App.tsx
  - packages/dashboard/src/__tests__/TreeSidebar.test.tsx
  - packages/dashboard/src/__tests__/active-generations.test.ts
  - packages/dashboard/src/__tests__/events.test.ts
  - packages/dashboard/src/__tests__/setup.ts
  - packages/dashboard/src/__tests__/sse-signal-integration.test.tsx
  - packages/dashboard/src/__tests__/theme-persistence.test.ts
  - packages/dashboard/src/components/EmptyState.tsx
  - packages/dashboard/src/components/JsonBlock.tsx
  - packages/dashboard/src/components/SkeletonThumbnail.tsx
  - packages/dashboard/src/components/StatusPill.tsx
  - packages/dashboard/src/components/ThemeToggle.tsx
  - packages/dashboard/src/components/TreeSidebar.tsx
  - packages/dashboard/src/components/VersionCard.tsx
  - packages/dashboard/src/lib/api.ts
  - packages/dashboard/src/lib/events.ts
  - packages/dashboard/src/lib/shape.ts
  - packages/dashboard/src/main.tsx
  - packages/dashboard/src/state/active-generations.ts
  - packages/dashboard/src/state/hierarchy.ts
  - packages/dashboard/src/state/versions.ts
  - packages/dashboard/src/styles/theme.css
  - packages/dashboard/src/types/entities.ts
  - packages/dashboard/src/types/events.ts
  - packages/dashboard/src/views/ActiveGenerationsPanel.tsx
  - packages/dashboard/src/views/DiffDrawer.tsx
  - packages/dashboard/src/views/HomeView.tsx
  - packages/dashboard/src/views/VersionDrawer.tsx
  - packages/dashboard/tsconfig.json
  - packages/dashboard/vite.config.ts
  - packages/dashboard/vitest.config.ts
  - src/engine/errors.ts
  - src/engine/events.ts
  - src/engine/output-downloader.ts
  - src/engine/pipeline.ts
  - src/http/dashboard-routes.ts
  - src/http/error-middleware.ts
  - src/http/index.ts
  - src/http/sse.ts
  - src/http/static.ts
  - src/server.ts
  - src/test-utils/fake-engine.ts
  - src/test-utils/fixtures.ts
  - verify-phase5-dashboard.mts
  - vitest.config.ts
findings:
  critical: 1
  warning: 5
  info: 6
  total: 12
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-04-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 42 (full review set across the HTTP layer, engine event/downloader modules, dashboard Preact app, and supporting tests)
**Status:** issues_found

## Summary

Phase 5 delivers a coherent REST + SSE + static surface bolted onto the existing MCP server, with an auto-emptied Preact dashboard. The architecture-purity invariants hold: `src/http/**` has zero MCP or SQLite imports; `packages/dashboard/src/**` has zero server-path traversals and keeps its own typed EngineEventMap copy. XSS surface is small and disciplined — every dynamic string flows through Preact text children, and `JsonBlock` uses `JSON.stringify` inside `<pre>`. `dangerouslySetInnerHTML` is absent across the dashboard source. The path-traversal defence for `GET /api/versions/:id/output` is layered correctly (early substring check, then `path.basename` normalization, then `existsSync` gate, with a MIME allowlist that falls back to `application/octet-stream`). The TypedError → HTTP status mapping in `error-middleware.ts` is complete for every current ErrorCode union member, and the 500 safe default covers future codes.

The single critical finding is a wire-shape contract drift between the server's SSE emitter and the dashboard's event consumers — the server emits snake_case keys (`version_id`, `shot_id`) plus an enum (`'completed'`) that the dashboard doesn't support. No `label` field exists on the server payload at all, so `onVersionCreated` will write `label: undefined` into the signal, and `onVersionStatusChanged` will push `'completed'` into `ActiveGeneration.status` where the StatusPill style map only has `'complete'`. Crucially, no test at the seam catches this: `sse.test.ts` asserts snake_case forwarding on the server side, `events.test.ts` and `sse-signal-integration.test.tsx` on the dashboard side use hand-rolled camelCase payloads via a MockEventSource, so both sides pass in isolation while production wire traffic would silently drop rows.

Remaining findings are lower severity: a hardcoded `'outputs'` path root in `dashboard-routes.ts` that diverges from the engine's configurable `outputRoot`; REST routes inherit no explicit origin gate (only `/mcp` and `/api/events` do); a placeholder `recent_versions: []` in `getDashboardHome` is dead wiring until a follow-up; and a handful of style / robustness suggestions around query-param parsing and the SSE keep-alive encoding.

## Critical Issues

### CR-01: SSE payload wire-shape drift — server emits snake_case, dashboard expects camelCase + different status enum

**Files:**
- `src/engine/events.ts:19-33` (server payload types)
- `src/engine/pipeline.ts:330-336, 356-362, 545-550, 564-568` (server emission sites)
- `src/http/sse.ts:77-81` (server SSE wire — forwards payload verbatim)
- `packages/dashboard/src/types/events.ts:18-29` (dashboard expected shapes)
- `packages/dashboard/src/state/active-generations.ts:49-74` (dashboard writers)

**Issue:** The server's `EngineEventMap` and the dashboard's `EngineEventMap` are not wire-compatible. Three separate axes of drift, all on hot paths:

1. **Key casing.** Server emits `{ version_id, shot_id, ... }` (see `src/engine/events.ts:20-33`). The SSE handler forwards the payload verbatim through `JSON.stringify(payload)` at `src/http/sse.ts:79`. The dashboard reads `payload.versionId` / `payload.shotId` at `packages/dashboard/src/state/active-generations.ts:53-54,72`. Result: `versionId` is `undefined`, every active-generation row is keyed by `undefined`, and `onVersionStatusChanged` can never find the row it should update (`g.versionId === payload.versionId` becomes `undefined === undefined` — collapses all rows to one match or none, depending on call order).

2. **Missing `label` field.** `VersionCreatedPayload` on the server (`src/engine/events.ts:28-33`) has `{ version_id, shot_id, breadcrumb, at }` — NO `label`. The dashboard writer reads `payload.label` (`active-generations.ts:55`) to populate the UI row; this will be `undefined`, and the `ActiveGenerationsPanel` renders `{g.label}` (`views/ActiveGenerationsPanel.tsx:46`), producing an empty `<span>` where the version label should appear.

3. **Status enum mismatch.** Server `VersionStatusChangedPayload.status` is `'submitted' | 'running' | 'completed' | 'failed'` (`events.ts:22`). Dashboard `VersionStatusChangedPayload.status` is `'queued' | 'running' | 'complete' | 'failed'` (`types/events.ts:20`). When the server emits `status: 'completed'` on completion, the dashboard pushes `'completed'` into `ActiveGeneration.status` (an impossible value for the TS union) and `StatusPill` looks up `STATUS_STYLES['completed']` → `undefined`, so the `class={...${undefined}}` interpolation renders an unstyled pill. Likewise `'submitted'` never maps to `'queued'` on the way in.

Why no test catches this:
- `src/http/__tests__/sse.test.ts:129-237` emits/asserts snake_case payloads — correct on the server side.
- `packages/dashboard/src/__tests__/events.test.ts:72-83` and `sse-signal-integration.test.tsx:111-167` dispatch hand-rolled camelCase `{ versionId, shotId, label }` through a MockEventSource — correct from the dashboard's side, *if* the server actually produced camelCase.

There's no end-to-end test that pipes a real `engine.events.emitEvent('version.created', realPayload)` through a real SSE stream into the real dashboard writer. Plan 05-08 SUMMARY explicitly called out `serialization-boundary-drift` as a threat; the integration test file's preamble claims to be "the regression gate", but it only exercises the dashboard's dispatcher against its own hand-crafted frames.

**Impact:** Every `version.created` SSE frame during live use drops into an `undefined`-keyed row with an empty label; every `version.status_changed` frame with `status: 'completed'` lands on a panel with no green pill. Feature-critical — the Active Generations panel is WEBUI-01's headline surface.

**Fix:** Add a wire adapter at the SSE boundary. Cleanest location is `src/http/sse.ts` — translate each EngineEventMap payload to the dashboard's contract before `JSON.stringify`. Example:

```typescript
// src/http/sse.ts
import { versionLabel } from '../utils/version-label.js'; // already exists in tool layer

function toWire(type: keyof EngineEventMap, payload: EngineEventMap[keyof EngineEventMap], engine: Engine): unknown {
  switch (type) {
    case 'version.created': {
      const p = payload as VersionCreatedPayload;
      const v = engine.getVersion(p.version_id).entity;
      return {
        versionId: p.version_id,
        shotId: p.shot_id,
        label: versionLabel(v), // resolve from version_number server-side
      };
    }
    case 'version.status_changed': {
      const p = payload as VersionStatusChangedPayload;
      const statusMap: Record<string, string> = {
        submitted: 'queued',
        completed: 'complete',
        running: 'running',
        failed: 'failed',
      };
      return {
        versionId: p.version_id,
        status: statusMap[p.status] ?? 'queued',
      };
    }
    // ... tag.changed / metadata.changed / hierarchy.created similarly
    default:
      return payload;
  }
}

const listener = (payload: unknown) => {
  void stream
    .writeSSE({ data: JSON.stringify(toWire(type, payload, engine)), event: type })
    .catch(() => {});
};
```

Alternative (lower-effort, worse ergonomics): change `packages/dashboard/src/types/events.ts` + all consumers to use snake_case + the server's 4-value status enum, and update `lib/shape.ts::normalizeStatus` to be the central translator at read time. Either way, add an integration test that drives `FakeEngine.events.emitEvent('version.created', {...real server shape...})` through `createSseHandler` into a real dashboard `onSseEvent('version.created', onVersionCreated)` consumer, asserting the row appears with the expected `label` and `status`.

## Warnings

### WR-01: `dashboard-routes.ts` hardcodes `'outputs'` as the output root while Engine supports a configurable `outputRoot`

**File:** `src/http/dashboard-routes.ts:227`
**Issue:** `const filePath = path.join('outputs', versionId, filename);` is a literal string. The Engine constructor (`src/engine/pipeline.ts:100`) accepts `outputRoot: string = 'outputs'` and threads it through to `downloadOutput` (`pipeline.ts:375`), so downloads land at `<outputRoot>/<versionId>/<filename>`. The HTTP route looks at `'outputs'/<versionId>/<filename>` regardless. If a deployment changes `outputRoot` (tests already do — `buildStackWithOutputs` uses `mkdtempSync(...)`), the route 404s on files that were downloaded successfully. Additionally, `path.join('outputs', ...)` resolves relative to `process.cwd()`, so running the server from a non-repo directory breaks the route even at defaults. This will bite the first operator who runs from a systemd unit with a custom WorkingDirectory.

**Fix:** Thread `outputRoot` through `createDashboardRouter`. Two small changes:

```typescript
// src/http/dashboard-routes.ts
export function createDashboardRouter(
  engine: EngineForDashboard,
  outputsRoot: string = 'outputs',
): Hono {
  // ...
  app.get('/api/versions/:id/output', (c) => {
    // ...
    const filePath = path.resolve(outputsRoot, versionId, filename);
    // ...
  });
}
```

Then in `src/server.ts:322`: `app.route('/', createDashboardRouter(engine, 'outputs'))` (or expose the same constant used at Engine construction). Use `path.resolve` rather than `path.join` to anchor against an explicit absolute root when operators configure one.

### WR-02: REST routes have no origin allowlist — only `/mcp` and `/api/events` enforce it

**File:** `src/server.ts:292-323`
**Issue:** The comment at `src/server.ts:317-319` says "the REST router inherits it implicitly via the app-level origin policy the browser enforces via CORS", but no `cors()` middleware is registered and no route-level origin gate exists on the 18 dashboard routes. Same-origin policy *does* protect JSON reads by browsers (no CORS preflight → blocked read), so a browser on `evil.com` cannot exfiltrate data. But:

1. A non-browser client can still hit every REST route from any origin (low risk given these are read-only, but inconsistent with the stated posture).
2. The `POST /api/versions/:id/reproduce` mutation endpoint is reachable via a simple HTML form submission from a cross-origin page because `Content-Type: application/json` is not a simple header — Hono's json() parse would reject a form-encoded body, so the mutation itself is unreachable via CSRF. This is accidentally safe, not architecturally safe.
3. The `POST /api/assets/query`/`list_tags`/`list_metadata_keys` endpoints are similarly read-only but reachable cross-origin to non-browser clients.

The comment in `server.ts` is misleading — it asserts a protection that isn't code.

**Fix:** Either (a) apply the same origin check to the REST router as the SSE handler uses:

```typescript
// src/server.ts — before app.route('/', createDashboardRouter(engine))
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/events') return next(); // already gated
  const origin = c.req.header('origin');
  if (origin && httpAllowedOrigins.length > 0 && !httpAllowedOrigins.includes(origin)) {
    return c.json({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Origin not allowed' } }, 403);
  }
  return next();
});
```

or (b) update the comment to accurately describe the protection: "Browsers enforce same-origin policy against the JSON read endpoints; non-browser cross-origin reads are permitted by design since these expose read-only catalog data." Pick one; don't leave a comment that claims protection it doesn't provide.

### WR-03: SSE handler forwards payloads verbatim with no envelope validation; a stray `value` field on `metadata.changed` would leak

**File:** `src/http/sse.ts:77-81`
**Issue:** The handler's payload flow is `engine.events.emitEvent(type, payload)` → listener(payload) → `stream.writeSSE({ data: JSON.stringify(payload) })`. The `MetadataChangedPayload` TypeScript interface deliberately omits `value` (T-5-02), and `sse.test.ts:200-215` has a regex `expect(text).not.toMatch(/"value"\s*:/)`. Both are type-level + single-test guards. A future refactor that changes `setMetadata`'s emit to `this.events.emitEvent('metadata.changed', { ...otherFields, value } as any)` (via structural-type escape hatch — e.g., spreading a fuller object) would still pass the current SSE test (which only covers one specific payload), because TypeScript won't catch `as any` and the runtime check is absent.

This is a defense-in-depth gap on a surface that the threat model explicitly calls out (T-5-02 info disclosure). The payload shape is the product of three files: the emit site, the TypeScript interface, and the SSE forwarder. A single runtime filter in the SSE forwarder would make the contract impossible to accidentally break.

**Fix:** Add a tiny scrubber before `JSON.stringify`:

```typescript
// src/http/sse.ts
const SSE_ALLOWED_FIELDS: Record<string, Set<string>> = {
  'metadata.changed': new Set(['action', 'version_id', 'shot_id', 'key', 'at']),
  // other event types can keep the passthrough default
};

function scrubPayload(type: string, payload: unknown): unknown {
  const allowed = SSE_ALLOWED_FIELDS[type];
  if (!allowed || !payload || typeof payload !== 'object') return payload;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

const listener = (payload: unknown) => {
  void stream
    .writeSSE({ data: JSON.stringify(scrubPayload(type, payload)), event: type })
    .catch(() => {});
};
```

Cost is negligible; it makes T-5-02 a runtime invariant the way T-5-04 (path traversal) already is.

### WR-04: `getDashboardHome` returns hardcoded `recent_versions: []` — dead wiring for a documented contract

**File:** `src/engine/pipeline.ts:676`
**Issue:** The dashboard home aggregate (D-WEBUI-01) documents three rails: active, recent-completed, workspaces. The engine method returns `const recent: Version[] = [];` with a comment saying a later plan may add this. Plan 05-12 ships WEBUI-01 as a must-have for the phase. The `DashboardHome` type on the dashboard (`packages/dashboard/src/lib/api.ts:222-226`) still promises `recent_versions: Version[]`, and `verify-phase5-dashboard.mts` only checks `/api/dashboard/home` is 200, not the content. A consumer (AI agent, human reader) following the documented shape will see an empty recent list even when versions have completed, making it look like a bug rather than unbuilt.

**Fix:** Either (a) wire the real query by extending `VersionRepo` with a small `listRecentCompleted(limit: number): Version[]` method and calling it here, or (b) remove the field from the response type so consumers don't expect it:

```typescript
// Preferred — wire it up:
getDashboardHome(): { active_versions: Version[]; recent_versions: Version[]; workspaces: Workspace[] } {
  const active = this.versionRepo.listPendingVersions();
  const recent = this.versionRepo.listRecentCompleted?.(10) ?? [];  // new repo method
  const { items: workspaces } = this.repo.listWorkspaces(50, 0);
  return { active_versions: active, recent_versions: recent, workspaces };
}
```

If this is deferred to a post-Phase-5 plan, add a `TODO(WEBUI-02):` comment with a plan/issue number, and update the field's docstring on the response type so the contract is honest about the current state.

### WR-05: Dashboard `fetchJson` discards error body — surfaces only status number; swallows typed error code from server

**File:** `packages/dashboard/src/lib/api.ts:24-30`
**Issue:** The server produces well-shaped `{ error: { code, message } }` bodies (see `src/http/error-middleware.ts:107`), but the client throws `new Error("HTTP 404: Not Found")` without reading the body. Views uniformly swallow these thrown errors into empty states (`HomeView.tsx:90-92, 111-113`; `VersionDrawer.tsx:74-76, 93-95`). The user sees an empty panel with no feedback — indistinguishable from "nothing exists" vs "server had a typed error I could show you".

This is the defensive choice for Phase 5 (no toast/error-banner primitive exists yet), but it discards information the server already went to the trouble of structuring. When a `VERSION_NOT_FOUND` fires because a version was reaped between a click and the fetch, the user sees nothing — not "This version was deleted".

**Fix:** Preserve the body so downstream UI can surface it later without rewiring fetches. Minimum-churn version:

```typescript
// packages/dashboard/src/lib/api.ts
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `${res.status} ${res.statusText ?? ''}`.trim();
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* non-JSON body — keep the status fallback */
    }
    const err = new Error(message);
    (err as Error & { code?: string; status?: number }).code = code;
    (err as Error & { code?: string; status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}
```

Views can keep their current catch blocks; a later plan that adds a toast primitive reads `err.code` / `err.message` without touching every fetch site.

## Info

### IN-01: `qNum` silently coerces negative numbers and non-integer floats into pagination

**File:** `src/http/dashboard-routes.ts:88-92`
**Issue:** `qNum('-5', 20)` returns `-5`; `qNum('3.7', 20)` returns `3.7`. These flow into `engine.listWorkspaces(limit, offset)` etc. The engine's repo layer likely tolerates them via SQL `LIMIT -5 OFFSET 3.7` (SQLite clamps negatives and truncates floats), but the behaviour is undefined by contract. A malicious `?limit=-1` from a browser tab doesn't leak data but produces an inconsistent response shape for consumers.
**Fix:** Clamp to a sane range and to integers:
```typescript
const qNum = (raw: string | undefined, fallback: number, min = 0, max = 500): number => {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
};
```

### IN-02: SSE keep-alive `: ping` is not actually an SSE comment on the wire

**File:** `src/http/sse.ts:96-98`
**Issue:** The comment at lines 89-95 claims `: ping` is an SSE comment, but `stream.writeSSE({ data: ': ping' })` produces `data: : ping\n\n` — a regular data frame with value `": ping"`, not a comment. Per the EventSource spec, a real comment is a line that starts with `:` at the start of the SSE frame (e.g., just `: ping\n\n`, no `data:` prefix). The current encoding still achieves the goal (bytes flow → TCP stays warm) and the browser's EventSource fires a `message` event with `data = ": ping"`, but since no client code registers a `message` listener (only typed `version.created` etc.), the ping is silently ignored. Harmless today; misleading if a future consumer adds a generic `message` handler.
**Fix:** Either use Hono's raw writer for a true comment line (if exposed), or rephrase the comment to describe the actual behavior: "We send `: ping` as data (the browser fires an untyped message event clients ignore), which keeps the TCP session from going idle. An empty-line comment would be more spec-correct but Hono's streamSSE prefixes `data:` to every write."

### IN-03: `outputs_json` parse in `dashboard-routes.ts` assumes a specific field layout without type narrowing

**File:** `src/http/dashboard-routes.ts:188-197`
**Issue:** The parsed array is typed as `Array<{ filename?: string }>` but no runtime check verifies entries are objects. A malformed `outputs_json` like `[null, "string"]` would hit `parsed[0]?.filename` → `undefined`, landing in the "no filename" branch gracefully, but a `[{}, {filename: "good.png"}]` would treat the first entry's missing filename as OUTPUT_UNAVAILABLE rather than falling through to the next usable output. Minor robustness.
**Fix:** Either lift the find-first-usable logic (`parsed.find((e) => typeof e?.filename === 'string')`) or tolerate it explicitly by documenting that only `outputs_json[0]` is served.

### IN-04: `normalizeStatus` fallback to `'queued'` for unknown status values silently masks server drift

**File:** `packages/dashboard/src/lib/shape.ts:39-44`
**Issue:** If the server introduces a new status value (e.g., `'cancelled'`), the dashboard renders it as `'queued'` without any signal to the developer. This is intentional per the docstring ("never unstyled"), but combined with CR-01's status drift, it makes drift invisible in dev too. A `console.warn` during development would surface the issue without breaking prod.
**Fix:** Consider:
```typescript
export function normalizeStatus(raw: Version['status'] | undefined): Status {
  if (raw === 'running' || raw === 'queued' || raw === 'failed') return raw;
  if (raw === 'complete' || raw === 'completed') return 'complete';
  if (raw === 'submitted') return 'queued';
  if (raw !== undefined && import.meta.env.DEV) {
    console.warn(`normalizeStatus: unknown status '${raw}' — rendering as 'queued'`);
  }
  return 'queued';
}
```

### IN-05: `App.tsx` registers SSE listeners in useEffect but does not guard against double-mount in StrictMode

**File:** `packages/dashboard/src/App.tsx:28-37`
**Issue:** Preact's behavior under hot-reload / StrictMode can invoke effects twice. The `startSse()` / `stopSse()` calls are idempotent (verified in `events.test.ts:57-61`), and `onSseEvent` uses a Set so duplicate adds merge. The cleanup correctly calls `offSseEvent` for each registered handler. This is safe, but it relies on the dispatch layer's idempotency — an implementation detail the App shouldn't have to know about. Worth documenting in the App comment.
**Fix:** Add a one-line comment referencing the `events.ts` singleton pattern so future edits don't introduce a duplicate-subscribe regression:
```typescript
useEffect(() => {
  // SSE lifecycle — events.ts keeps a singleton EventSource + a Set of
  // per-type listeners so double-mount under StrictMode/HMR is a no-op.
  onSseEvent('version.created', onVersionCreated);
  // ...
}, []);
```

### IN-06: `HomeView.hydrateChildrenOf` does no deduplication of in-flight fetches

**File:** `packages/dashboard/src/views/HomeView.tsx:119-176`
**Issue:** A user clicking rapidly on a workspace node (open → close → open while the first fetch is in flight) can trigger two concurrent `fetchProjects(id)` calls. The second resolves after the first, overwriting the cache. Not a correctness bug (both calls return the same data), but a small network-efficiency waste. Not a deal-breaker for a local-dev dashboard with small hierarchies.
**Fix:** Track in-flight keys in a `Set<string>` before firing the fetch and bail if the key is already pending, or use a `Record<string, Promise<T>>` cache. Low priority.

---

_Reviewed: 2026-04-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
