# Phase 6: Dashboard Wire Quality - Pattern Map

**Mapped:** 2026-04-23
**Files analyzed:** 8 new code surfaces (1 repo method, 5 test surfaces, 1 error class, 1 exhaustiveness rewrite)
**Analogs found:** 8 / 8 (100% coverage — gap-closure phase against well-tested code)

## File Classification

| New/Modified Surface | Role | Data Flow | Closest Analog | Match Quality |
|----------------------|------|-----------|----------------|---------------|
| `VersionRepo.listRecentCompleted(limit)` (new method on `src/store/version-repo.ts`) | repository method (read) | CRUD (read) | `src/store/version-repo.ts:182` `listByShot()` | exact (same file, same shape) |
| New `describe('outputRoot')` in `src/http/__tests__/dashboard-routes.test.ts` | route test | request-response | Existing `describe('GET /api/versions/:id/output')` block, `dashboard-routes.test.ts:306-481` (esp. `writeTestOutput` helper + `app.request()` pattern) | exact (same file, same route) |
| New `describe('qNum validation')` in `src/http/__tests__/dashboard-routes.test.ts` | route test | request-response | Existing `describe('GET /api/versions/:id/diff')` test of `INVALID_INPUT` 400, `dashboard-routes.test.ts:293-299` | exact (same file, same error envelope, same `INVALID_INPUT` code) |
| NEW `packages/dashboard/src/__tests__/api-error.test.ts` | unit test (mock fetch) | request-response | `packages/dashboard/src/__tests__/events.test.ts` (uses `vi.stubGlobal` to replace a Web global before importing module-under-test) | role-match (same stub-global-then-import idiom; different global) |
| NEW `packages/dashboard/src/__tests__/shape.test.ts` | unit test (pure function) | transform | `packages/dashboard/src/__tests__/active-generations.test.ts` (pure-import, no stubs, signal-style state assertions) | role-match (same shape: import → call → assert; no stubs needed) |
| Replace `keep-alive ping comment emitted after 30s` test in `src/http/__tests__/sse.test.ts` | route test (SSE wire) | streaming | The existing test itself, `sse.test.ts:306-320` (already uses fake timers + `app.request` + drain) | exact (in-place harden — keep scaffold, tighten assertion to regex) |
| NEW `DashboardApiError` class in `packages/dashboard/src/lib/api.ts` | error class (typed) | error-channel | `src/engine/errors.ts:42` `TypedError` (server-side typed error with `code` + optional context fields, `name` set in constructor) | role-match (server-side analog; same `Error`-subclass with `code` + `name` discipline) |
| Rewrite `normalizeStatus` switch in `packages/dashboard/src/lib/shape.ts` | pure function (exhaustive) | transform | `src/http/sse.ts:133-138` `toDashboardPayload` `default` clause | exact (same `_exhaustive: never` idiom, planner directly cited) |

## Pattern Assignments

### `VersionRepo.listRecentCompleted(limit)` — new method on `src/store/version-repo.ts` (SC-1)

**Analog:** `src/store/version-repo.ts:182-201` `listByShot(shotId, limit, offset)` (same file, sibling method)

**Why closest:** Same class, same return type (`Version[]`), same Drizzle builder chain (`select().from(versions).where(...).orderBy(...).limit(...).all() as Version[]`), same use of `sql\`\`` template for the `ORDER BY` clause. Only differences: a single `eq(versions.status, 'completed')` filter (vs. `eq(versions.shot_id, shotId)`), no offset, no total_count wrapper (returns flat `Version[]` per the `getDashboardHome` shape).

**Imports already present** (no changes to import block — all needed symbols are in scope):
```typescript
// src/store/version-repo.ts:1-6 — already imported
import { eq, inArray, sql } from 'drizzle-orm';
import * as schema from './schema.js';
import { versions } from './schema.js';
import type { Version } from '../types/hierarchy.js';
```

**Core pattern to copy** (`src/store/version-repo.ts:182-201`):
```typescript
listByShot(
  shotId: string,
  limit: number,
  offset: number,
): { items: Version[]; total_count: number } {
  const totalRow = this.db
    .select({ c: sql<number>`COUNT(*)` })
    .from(versions)
    .where(eq(versions.shot_id, shotId))
    .get();
  const items = this.db
    .select()
    .from(versions)
    .where(eq(versions.shot_id, shotId))
    .orderBy(sql`${versions.version_number} DESC`)
    .limit(limit)
    .offset(offset)
    .all() as Version[];
  return { items, total_count: Number(totalRow?.c ?? 0) };
}
```

**Deviations the new method must make:**
- Drop the `offset` parameter and the `total_count` envelope — `getDashboardHome` consumes a flat `Version[]`.
- Filter on `eq(versions.status, 'completed')` not `versions.shot_id`.
- Order by `versions.completed_at DESC` (recency) not `version_number DESC` (per-shot newest).
- Reference implementation from RESEARCH.md §SC-1 (lines 244-252):
```typescript
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

---

### New `describe('outputRoot')` block in `src/http/__tests__/dashboard-routes.test.ts` (SC-2)

**Analog:** `src/http/__tests__/dashboard-routes.test.ts:306-481` `describe('GET /api/versions/:id/output')` (same file, same route)

**Why closest:** Same route under test, same `app.request('/api/versions/:id/output')` invocation, same `engine.cans.versions.set(...)` fixture pattern, same `writeTestOutput(versionId, filename)` helper at lines 33-40. The new `outputRoot` block only needs to vary the `engine.outputRoot` field on the FakeEngine (currently absent — Plan SC-2 adds it) and assert `path.resolve()` honors it.

**Imports already present** (no changes — `mkdirSync`, `writeFileSync`, `existsSync`, `join` already imported at lines 19-20):
```typescript
// src/http/__tests__/dashboard-routes.test.ts:17-24 — already imported
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FakeEngine } from '../../test-utils/fake-engine.js';
import { createDashboardRouter } from '../dashboard-routes.js';
import { typedErrorHandler } from '../error-middleware.js';
import { TypedError } from '../../engine/errors.js';
```

**Core pattern to copy** (test scaffold from `dashboard-routes.test.ts:424-452` — `streams file with image/png Content-Type for .png output`):
```typescript
it('streams file with image/png Content-Type for .png output', async () => {
  // Write a real tiny file to outputs/ver_png_stream/out.png so the route
  // can successfully fs.createReadStream it. afterEach cleans it up.
  writeTestOutput('ver_png_stream', 'out.png');
  engine.cans.versions.set('ver_png_stream', {
    entity: {
      id: 'ver_png_stream',
      shot_id: 'shot_1',
      version_number: 1,
      status: 'completed',
      job_id: null,
      parent_version_id: null,
      notes: null,
      created_at: 0,
      completed_at: null,
      error_code: null,
      error_message: null,
      outputs_json: JSON.stringify([{ filename: 'out.png' }]),
      lineage_type: null,
      tags: [],
      metadata: [],
    },
    breadcrumb: { entries: [], text: '' },
  });
  const app = buildApp(engine);
  const res = await app.request('/api/versions/ver_png_stream/output');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/png');
});
```

**Deviations the new block must make:**
- Override `engine.outputRoot` (per-test) to a tmp dir (e.g. `path.join(os.tmpdir(), 'vfx-test-outputroot-' + Math.random())`) BEFORE building the app.
- Write the fixture file under `<engine.outputRoot>/<versionId>/<filename>` (NOT under `outputs/<...>` — that's the legacy hardcoded path the SC-2 fix replaces).
- Adjust `writeTestOutput` (or inline a variant) so the dir prefix is parameterized; cleanup must clean the new tmp dir (not the repo-relative `outputs/` tree).
- Negative test: also exercise a relative `outputRoot` (e.g. `'tmp-outputs'`) and assert `path.resolve()` produces an absolute path (re-cited at RESEARCH.md §Pitfall 2).

---

### New `describe('qNum validation')` block in `src/http/__tests__/dashboard-routes.test.ts` (SC-4)

**Analog:** `src/http/__tests__/dashboard-routes.test.ts:293-299` (within `describe('GET /api/versions/:id/diff')`) — the `returns 400 INVALID_INPUT when ?against is missing` test

**Why closest:** Same file, same `INVALID_INPUT` code, same status assertion (`expect(res.status).toBe(400)`), same envelope assertion (`expect(body.error.code).toBe('INVALID_INPUT')`), same `app.request()` invocation. The qNum tests use `/api/workspaces?limit=...` (already in `describe('GET /api/workspaces')`) which is the simplest route exercising `qNum`.

**Core pattern to copy** (`dashboard-routes.test.ts:293-299`):
```typescript
it('returns 400 INVALID_INPUT when ?against is missing', async () => {
  const app = buildApp(engine);
  const res = await app.request('/api/versions/ver_a/diff');
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe('INVALID_INPUT');
});
```

**Deviations the new block must make:**
- Cover three invalid inputs: `?limit=-1`, `?limit=1.5`, `?limit=foo`. Each must assert HTTP 400 + `body.error.code === 'INVALID_INPUT'` + `body.error.message` matches `/non-negative integer/`.
- Cover the absent-param happy path (`?` omitted entirely) → 200 + delegated call recorded in `engine.calls`.
- Repeat once for `?offset=-1` to confirm the `name` parameter is propagated into the error message (per RESEARCH.md §Pitfall 4: "the signature gains a `name` parameter so the error message tells the caller WHICH param failed").

---

### NEW `packages/dashboard/src/__tests__/api-error.test.ts` (SC-3, Wave 0)

**Analog:** `packages/dashboard/src/__tests__/events.test.ts` (entire file)

**Why closest:** Both stub a Web global (`EventSource` there, `fetch` here) using `vi.stubGlobal` BEFORE importing the module-under-test, both test a thin client wrapper that converts wire-shape data to typed objects. `events.test.ts` is the only existing dashboard test that mocks a network global — it's the established pattern.

**Imports to copy** (`packages/dashboard/src/__tests__/events.test.ts:1-6, 38, 42`):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the global BEFORE importing the module under test.
// (events.test.ts uses `vi.stubGlobal('EventSource', MockEventSource)` at line 38;
//  api-error.test.ts will use `vi.stubGlobal('fetch', mockFetch)` instead.)
vi.stubGlobal('EventSource', MockEventSource);

// Import AFTER stubbing so the module under test picks up the mock.
import { startSse, stopSse, onSseEvent, offSseEvent } from '../lib/events.js';
```

**Mock pattern to adapt** — `events.test.ts:9-37` defines a `MockEventSource` class that records instances. For `fetch`, the analog is much simpler: `vi.fn()` returning a `Response`-shaped object per test. Use `beforeEach` reset (events.test.ts:45-49 — `MockEventSource.instances = []; stopSse();`) to clear `vi.mocked(fetch).mockReset()` between tests.

**Core test idiom to copy** (`events.test.ts:51-67`):
```typescript
describe('SSE client', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    stopSse();
  });

  it('startSse() creates an EventSource at /api/events', () => {
    startSse();
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].url).toBe('/api/events');
  });
  // ...
});
```

**Deviations the new file must make:**
- Stub `fetch` (not `EventSource`). Use `vi.stubGlobal('fetch', vi.fn())` and per-test `vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({...}), { status: 404 }))`.
- Import the function under test from `../lib/api.js` (not `../lib/events.js`). Since `fetchJson` is currently a NON-exported helper at `packages/dashboard/src/lib/api.ts:24-30`, SC-3 must EXPORT it (and the new `DashboardApiError` class) before the test file can import them.
- Test surface (per RESEARCH.md §Validation Architecture SC-3):
  - 404 + structured envelope `{ error: { code: 'VERSION_NOT_FOUND', message: '...' } }` → throws `DashboardApiError` with `err.code === 'VERSION_NOT_FOUND'`, `err.status === 404`, `err.body.error.message` matches.
  - Non-JSON body (e.g. `new Response('<html>...', { status: 502 })`) → throws `DashboardApiError` with `err.code === 'HTTP_ERROR'` (graceful fallback per RESEARCH.md §Pitfall 3).
  - 200 + valid JSON → returns parsed body, no throw.

---

### NEW `packages/dashboard/src/__tests__/shape.test.ts` (SC-6, Wave 0)

**Analog:** `packages/dashboard/src/__tests__/active-generations.test.ts` (entire file)

**Why closest:** Both test a pure module from `packages/dashboard/src/`, neither stubs a global, neither uses jsdom-specific APIs (despite running in jsdom env). `active-generations.test.ts` is the simplest example of a no-stub, no-render dashboard test — pure import → call → assert.

**Imports to copy** (`packages/dashboard/src/__tests__/active-generations.test.ts:15-20`):
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  activeGenerations,
  onVersionCreated,
  onVersionStatusChanged,
} from '../state/active-generations.js';
```

**Core test idiom to copy** (`active-generations.test.ts:22-41`):
```typescript
describe('activeGenerations signal', () => {
  beforeEach(() => {
    // Reset the signal between tests so order-independent.
    activeGenerations.value = [];
  });

  it('starts empty', () => {
    expect(activeGenerations.value).toHaveLength(0);
  });

  it('onVersionCreated adds entry with status queued', () => {
    onVersionCreated({ versionId: 'v1', shotId: 's1', label: 'v001' });
    expect(activeGenerations.value).toHaveLength(1);
    expect(activeGenerations.value[0]).toMatchObject({
      versionId: 'v1',
      shotId: 's1',
      label: 'v001',
      status: 'queued',
    });
  });
  // ...
});
```

**Deviations the new file must make:**
- Import from `../lib/shape.js` (not `../state/active-generations.js`).
- No `beforeEach` reset needed — `normalizeStatus` is pure (no side-state).
- Test surface (per RESEARCH.md §Validation Architecture SC-6):
  - Each of six valid inputs (`'submitted', 'running', 'completed', 'failed', 'queued', 'complete'`) maps to the documented `Status`.
  - `undefined` returns `'queued'`.
  - For exhaustiveness verification: cast a string literal to `Version['status']` (e.g. `normalizeStatus('aborted' as unknown as Version['status'])`) and assert it `THROWS`.
  - Optional: a TypeScript-level negative test (a `// @ts-expect-error` line) confirming a non-union value fails compilation — but the runtime throw assertion is the primary contract.

---

### Replace `keep-alive ping comment emitted after 30s` test in `src/http/__tests__/sse.test.ts` (SC-5)

**Analog:** The existing test itself, `src/http/__tests__/sse.test.ts:306-320`

**Why closest:** This is an in-place harden, not a new test. The scaffolding (`buildApp`, `AbortController`, fake timers via `vi.advanceTimersByTimeAsync`, `drain` helper) is already exactly correct. Only the assertion changes from a substring check to a wire-level regex.

**Existing test to harden** (`sse.test.ts:306-320`):
```typescript
it('keep-alive ping comment emitted after 30s (T-5-08)', async () => {
  const { app } = buildApp();
  const controller = new AbortController();
  const resPromise = app.request('/api/events', { signal: controller.signal });
  // Let the streamSSE cb register the setInterval.
  await Promise.resolve();
  await Promise.resolve();
  // Advance past the 30s keep-alive tick.
  await vi.advanceTimersByTimeAsync(31_000);
  controller.abort();
  const text = await drain((await resPromise).body);
  // SSE comment form: ": ping" — a bare colon-prefixed line the browser
  // EventSource ignores, but that keeps the TCP connection from going idle.
  expect(text).toContain(': ping');
});
```

**Deviations the rewrite must make** (per RESEARCH.md §Validation Architecture SC-5):
- Replace `expect(text).toContain(': ping')` with TWO assertions:
  - **Positive regex:** `expect(text).toMatch(/(^|\n): ping\n\n/)` — `: ping` must appear at the START of a line followed by the SSE frame terminator `\n\n`.
  - **Negative regex:** `expect(text).not.toMatch(/data: : ping/)` — guarantees the bug shape (Hono's `writeSSE` prefix) cannot recur silently.
- Update the inline comment to reference the WHATWG SSE spec ("a comment line MUST begin with `:` as the first character") and the `stream.write(': ping\n\n')` raw-write path.
- Per RESEARCH.md Assumption A5, the existing `expect(text).toContain(': ping')` substring check still passes after the fix (`: ping\n\n` still contains `: ping`), so any OTHER tests that assert on this substring stay green.

---

### NEW `DashboardApiError` class in `packages/dashboard/src/lib/api.ts` (SC-3)

**Analog:** `src/engine/errors.ts:42-51` `TypedError`

**Why closest:** Server-side typed-error class with `code` + optional context fields, sets `name` in constructor. The dashboard side needs the SAME shape (`code` + `message` + extras) so a UI consumer's `instanceof` + switch on `err.code` works symmetrically across boundaries.

**Imports already present** (no new imports — `DashboardApiError` extends the global `Error`):
```typescript
// packages/dashboard/src/lib/api.ts:12-18 — no error-class imports needed
import type {
  Workspace,
  Project,
  Sequence,
  Shot,
  Version,
} from '../types/entities.js';
```

**Core pattern to copy** (`src/engine/errors.ts:42-51`):
```typescript
export class TypedError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = 'TypedError';
  }
}
```

**Deviations the new class must make:**
- Class name: `DashboardApiError` (not `TypedError` — avoids name clash if a future plan dual-imports).
- `code` is `string` (not the closed `ErrorCode` union) — the dashboard must accept any code the server emits, including unknown future codes; UI can switch on known ones and fall through to a generic "unknown error" branch.
- Add `status: number` field (HTTP status — 4xx/5xx) for UI affordances ("Retry" on 502, "Sign in" on 401).
- Add `body?: unknown` field carrying the parsed envelope verbatim (or `undefined` if non-JSON).
- Reference implementation from RESEARCH.md §SC-3 (lines 295-305):
```typescript
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
```

---

### Rewrite `normalizeStatus` switch in `packages/dashboard/src/lib/shape.ts` (SC-6)

**Analog:** `src/http/sse.ts:133-138` `toDashboardPayload` `default` clause (planner explicitly cited this as the established analog)

**Why closest:** Same `_exhaustive: never` idiom for catching unhandled union members at compile time. RESEARCH.md §Pattern: Exhaustive Switch with `never` (lines 149-160) directly cites this as the pattern to copy.

**Imports already present** (no new imports — uses TypeScript-native `never`):
```typescript
// packages/dashboard/src/lib/shape.ts:12-13 — already imported
import type { Version } from '../types/entities.js';
import type { Status } from '../components/StatusPill.js';
```

**Core pattern to copy** (`src/http/sse.ts:133-138`):
```typescript
default: {
  // Exhaustiveness check — any unhandled key fails here.
  const _exhaustive: never = type;
  throw new Error(`toDashboardPayload: unhandled event type: ${String(_exhaustive)}`);
}
```

**Deviations the rewrite must make:**
- Convert the current if/else chain (`shape.ts:39-44`) to a `switch (raw)` over the `Version['status']` union.
- Handle the `undefined` input BEFORE the switch (currently the function signature accepts `Version['status'] | undefined`; per docstring `undefined` returns `'queued'`).
- Group cases per RESEARCH.md §SC-6 (lines 365-383):
  - `'queued' | 'submitted'` → `'queued'`
  - `'running'` → `'running'`
  - `'complete' | 'completed'` → `'complete'`
  - `'failed'` → `'failed'`
- `default:` clause uses `_exhaustive: never = raw` and throws with message `\`normalizeStatus: unhandled status: ${String(_exhaustive)}\``.
- Remove the existing `return 'queued'` fallback (no longer load-bearing per RESEARCH.md §State of the Art).

---

## Shared Patterns

### TypedError at HTTP boundary (applies to SC-4)

**Source:** `src/http/dashboard-routes.ts:160-170` (existing — `INVALID_INPUT` throw on `/diff` route)
**Apply to:** SC-4 (`qNum` validation throw)
```typescript
throw new TypedError(
  'INVALID_INPUT',
  "Missing required query parameter 'against'",
  'Call GET /api/versions/:id/diff?against=<other_version_id>',
);
```
The `typedErrorHandler` at `src/http/error-middleware.ts:104` already maps `INVALID_INPUT` → 400 (via `error-middleware.ts:85` `code.startsWith('INVALID_')`). New `qNum` throws inherit this mapping for free — no error-handler edits needed.

### EngineForDashboard structural Pick widening (applies to SC-1, SC-2)

**Source:** `src/http/dashboard-routes.ts:54-73` (existing 17-key Pick)
**Apply to:** SC-1 (no widening — `getDashboardHome` already in the Pick) and SC-2 (add `'outputRoot'` to the Pick).
```typescript
export type EngineForDashboard = Pick<
  Engine,
  | 'listWorkspaces'
  | /* ...existing 16 methods... */
  | 'getDashboardHome'
  | 'outputRoot'              // ← SC-2 add
>;
```
**Critical co-edit for SC-2:** `src/test-utils/fake-engine.ts` must mirror — add `public readonly outputRoot: string = 'outputs';` to `class FakeEngine` so the structural compatibility check passes at test-time.

### FakeEngine + buildApp test scaffold (applies to SC-2, SC-4)

**Source:** `src/http/__tests__/dashboard-routes.test.ts:52-71` (existing `buildApp` + per-test `engine` lifecycle)
**Apply to:** All new server-route tests in `dashboard-routes.test.ts`.
```typescript
function buildApp(engine: FakeEngine): Hono {
  const app = new Hono();
  app.onError(typedErrorHandler);
  const router = createDashboardRouter(engine as never);
  app.route('/', router);
  return app;
}

describe('createDashboardRouter', () => {
  let engine: FakeEngine;

  beforeEach(() => {
    engine = new FakeEngine();
    engine.reset();
  });
  // ...
});
```

### vi.stubGlobal-then-import idiom (applies to SC-3)

**Source:** `packages/dashboard/src/__tests__/events.test.ts:38, 42` (existing — stub `EventSource` before importing `lib/events.js`)
**Apply to:** SC-3 (stub `fetch` before importing `lib/api.js`).
```typescript
vi.stubGlobal('EventSource', MockEventSource);

// Import AFTER stubbing so the module-under-test picks up the mock if it
// caches the global at module-load time.
import { startSse, stopSse, onSseEvent, offSseEvent } from '../lib/events.js';
```
Same ordering for SC-3 (stub `fetch` first, then import `fetchJson` + `DashboardApiError`).

---

## No Analog Found

None. Every new code surface in Phase 6 has a closest analog already present in the codebase. This is consistent with the gap-closure character of the phase: every fix hardens an existing surface against an already-shipped contract.

## Metadata

**Analog search scope:**
- `src/store/version-repo.ts` (sibling-method analog for SC-1)
- `src/http/__tests__/dashboard-routes.test.ts` (in-file describe-block analogs for SC-2, SC-4)
- `src/http/__tests__/sse.test.ts` (in-file scaffold analog for SC-5)
- `packages/dashboard/src/__tests__/` (test-file analogs for SC-3, SC-6)
- `src/engine/errors.ts` (typed-error class analog for SC-3)
- `src/http/sse.ts` (`_exhaustive: never` analog for SC-6 — directly cited in RESEARCH.md)

**Files scanned:** 8 (all ranges non-overlapping; no re-reads)

**Pattern extraction date:** 2026-04-23
