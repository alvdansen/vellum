---
phase: 05-web-dashboard
plan: 05
subsystem: http-sse
tags: [hono, sse, server-sent-events, event-emitter, streaming, D-WEBUI-03, D-WEBUI-06, D-WEBUI-29, T-5-01, T-5-02, T-5-08]
dependency_graph:
  requires:
    - "phase-05 plan-02 — EngineEmitter + 5 typed EngineEventMap payload types forwarded via onEvent/offEvent"
    - "phase-05 plan-03 — src/http/ directory scaffolded; shares architecture-purity invariant (zero MCP/SQLite imports)"
  provides:
    - "src/http/sse.ts — createSseHandler(engine, allowedOrigins) factory: Hono route for GET /api/events"
    - "5-event SSE forwarding: version.status_changed, version.created, tag.changed, metadata.changed, hierarchy.created"
    - "Origin-allowlist gate (T-5-01) that rejects forbidden origins BEFORE the stream opens"
    - "30s keep-alive ': ping' SSE comment (T-5-08) to beat nginx/ALB/CF proxy idle timeouts"
    - "Abort-signal-driven cleanup: clearInterval + offEvent for all 5 types on client disconnect"
  affects:
    - "phase-05 plan-06 (server.ts wiring): app.get('/api/events', createSseHandler(engine, allowedOrigins))"
    - "phase-05 plan-07+ (dashboard components): EventSource consumers for real-time panel updates"
tech-stack:
  added: []
  patterns:
    - "streamSSE from hono/streaming as the correct SSE primitive — sets Content-Type: text/event-stream + Cache-Control: no-cache + Connection: keep-alive automatically"
    - "const EVENT_TYPES tuple satisfies ReadonlyArray<keyof EngineEventMap> — compile-time membership check ensures the handler forwards every event the engine publishes (adding a 6th key without updating this array fails tsc)"
    - "Map<EventName, listener> preserves the exact function reference for cleanup — Node EventEmitter.off() requires reference equality"
    - "void writeSSE(...).catch(() => {}) inside listener — gracefully swallows post-disconnect writes; the cleanup handler below removes the listener so there is nothing else to do"
    - "Abort-gate early-return: if signal.aborted at streamSSE callback start, run cleanup and return immediately (belt-and-suspenders against race where abort fires before subscription)"
    - "Architecture-purity comment phrasing: 'MCP SDK imports' instead of the sentinel package string (Plan 04-03 / 05-02 convention — avoids tripping the substring grep)"
key-files:
  created:
    - src/http/sse.ts
    - src/http/__tests__/sse.test.ts
  modified: []
key-decisions:
  - "[Plan 05-05] Used writeSSE({ data: ': ping' }) for keep-alive per plan spec — on the wire this becomes 'data: : ping\\n\\n'. The browser EventSource ignores the empty message; proxies see the bytes and hold the TCP connection open. Semantically equivalent to the raw ': ping\\n\\n' comment form but goes through the same writeSSE path as real frames (single logging/error surface)."
  - "[Plan 05-05] EVENT_TYPES declared as `as const satisfies ReadonlyArray<keyof EngineEventMap>` — combines tuple immutability (for for-of iteration narrowing) with a compile-time check against the event-map source of truth. Adding a sixth EngineEventMap key without updating this tuple fails tsc immediately."
  - "[Plan 05-05] Cleanup path explicit: clearInterval + offEvent for every entry in `listeners` Map, even though EngineEmitter.setMaxListeners(100) would tolerate some leak. Per D-WEBUI-29 the contract is 'no listeners after disconnect'; the unit test asserts listenerCount === 0 for each of the 5 types, which forces exact cleanup rather than tolerance."
  - "[Plan 05-05] Hono test harness drives the stream async — tests use `await Promise.resolve()` twice after `app.request` to let streamSSE's `run()` callback register listeners before emitting events. Fake timers + vi.advanceTimersByTimeAsync exercise the 30s keep-alive without wall-clock delay."
  - "[Plan 05-05] Architecture-purity grep uses substring match — both sse.ts source AND comments must avoid the literal `@modelcontextprotocol/sdk` and `better-sqlite3` sentinel strings. Used 'MCP SDK imports' and described the SQLite prohibition by role ('direct SQLite imports') rather than by package name."
  - "[Plan 05-05] Origin check signature: `allowedOrigins.length > 0 && !allowedOrigins.includes(origin)` → 403. Empty list bypasses the check (dev mode, D-WEBUI-04). A request with missing Origin header (`origin = ''`) still fails the includes check when the list is populated — intentional; browser XHR always sets Origin, curl must use -H 'Origin: ...' explicitly."
patterns-established:
  - "SSE handler factory over inline route registration — keeps server.ts wiring as one-liner, gives tests a unit-testable surface without spinning up the full server"
  - "5-type subscribe/forward loop with typed tuple — adding a new EngineEventMap key requires updating this tuple (single edit, compile-time enforcement)"
requirements-completed: [WEBUI-03]
metrics:
  duration_minutes: 10
  task_count: 1
  file_count: 2
  commits: 2
  tests_added: 11
  tests_passing: 643
  tests_skipped: 2
  completed_date: "2026-04-23"
---

# Phase 5 Plan 5: SSE Handler for Dashboard Event Stream Summary

**Hono `streamSSE` handler at `GET /api/events` that forwards 5 typed EngineEventMap payloads to every connected browser, with origin-allowlist gate before stream open, 30s keep-alive ping for proxy timeouts, and full listener cleanup on client disconnect.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-23T19:32:13Z
- **Completed:** 2026-04-23T19:43:03Z
- **Tasks:** 1 (TDD RED → GREEN; no REFACTOR)
- **Files created:** 2
- **Files modified:** 0

## Accomplishments

- **`src/http/sse.ts`** (128 lines, ≥70 plan minimum): `createSseHandler(engine, allowedOrigins)` — Hono route factory for `GET /api/events`. Subscribes to all 5 EngineEventMap event types via `engine.events.onEvent(type, listener)`; forwards each payload as an SSE frame with `event:<type>` header + JSON-stringified data line. Origin allowlist check (T-5-01) returns 403 before `streamSSE` opens the response. Keep-alive `': ping'` comment every 30s (T-5-08). Full cleanup on abort signal: `clearInterval` + `offEvent` for every subscribed type.
- **`src/http/__tests__/sse.test.ts`** (287 lines, ≥80 plan minimum): **11 tests green on first GREEN run**. Content-type assertion, 4 origin-gate scenarios (not-in-allowlist → 403, empty allowlist passthrough, in-allowlist passthrough, no-listener-leak on reject), 5 event-forwarding tests (one per EngineEventMap type), cleanup assertion (offEvent called for all 5 + listenerCount === 0), keep-alive ping test (fake timers advance 31s).
- **T-5-02 regression guard** in `metadata.changed` forwarding test — asserts `text.not.toMatch(/"value"\s*:/)` on the wire bytes. Since `MetadataChangedPayload` type omits `value` at the type level AND pipeline.ts emits without it, this test would catch a future any-cast that smuggles `value` through the SSE stream.
- **Architecture-purity passes**: zero `@modelcontextprotocol/sdk` imports, zero `better-sqlite3` imports in sse.ts (verified by both `grep` at commit time and by `architecture-purity.test.ts` substring check — 10/10 green).
- **Test suite count:** full root run 643 passed | 2 skipped (up from 608 post-05-03 baseline + the 24 tests accrued by intermediate merges, + 11 new from this plan). Zero regressions. `tsc --noEmit` clean.

## Task Commits

1. **Task 1 RED** — `3b629cf` `test(05-05): add failing tests for createSseHandler (RED)` — 11 tests; expected FAIL with `Cannot find module '../sse.js'`.
2. **Task 1 GREEN** — `c936d6f` `feat(05-05): implement createSseHandler for dashboard SSE (GREEN)` — 128-line implementation; all 11 assertions pass; full suite green; tsc clean.

_Task 1 went RED → GREEN with no REFACTOR commit — the implementation is already minimal (1 tuple constant, 1 MS constant, 1 handler factory with a single inner async callback), no dead code._

## Files Created / Modified

### Created

- **`src/http/sse.ts`** — Exports `createSseHandler(engine: Engine, allowedOrigins: string[] = [])`. Imports: `Context` (type) from `hono`, `streamSSE` from `hono/streaming`, `Engine` (type) from `../engine/pipeline.js`, `EngineEventMap` (type) from `../engine/events.js`. Zero runtime imports from any MCP SDK or SQLite module. The handler:
  1. Reads `Origin` header; if `allowedOrigins` is non-empty and the origin is not included → `c.text('Forbidden', 403)` (stream never opened, no listeners attached).
  2. Otherwise returns `streamSSE(c, async (stream) => { ... })`.
  3. Inside the stream callback: for each of the 5 `EVENT_TYPES`, creates a `listener(payload)` that calls `void stream.writeSSE({ data: JSON.stringify(payload), event: type }).catch(() => {})`; attaches via `engine.events.onEvent(type, listener)`; stores in a `Map` keyed by type.
  4. `setInterval` every 30s writes `: ping` SSE comment.
  5. `await new Promise<void>((resolve) => signal.addEventListener('abort', resolve, { once: true }))` blocks the callback until client disconnects.
  6. Cleanup: `clearInterval(keepAliveInterval)` + iterate `EVENT_TYPES` calling `engine.events.offEvent(type, listener)`.
  7. Early-return cleanup if `signal.aborted` at callback entry (covers the race where abort fires before subscription completes).
- **`src/http/__tests__/sse.test.ts`** — 11 tests driving the handler through Hono's `app.request` test harness. A `drain()` helper reads the `ReadableStream<Uint8Array>` body to a UTF-8 string so frame-content assertions can run against the literal wire bytes. `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(31_000)` exercises the 30s keep-alive without wall-clock delay. `vi.spyOn(engine.events, 'offEvent')` is the primary cleanup assertion, backed by `listenerCount === 0` per type as a belt-and-suspenders check.

### Modified

None. Plan 05-05's surface is strictly additive — no edits to engine, pipeline, server.ts, or test utilities.

## Decisions Made

- **Tuple-with-`satisfies` for EVENT_TYPES** — declaring `const EVENT_TYPES = [...] as const satisfies ReadonlyArray<keyof EngineEventMap>` gets both immutability (for narrow iteration typing) and a compile-time check that every entry is a valid key of EngineEventMap. Future phases that add a sixth event type (unlikely, but possible) will fail `tsc` until this tuple is updated — a useful landmine.
- **Cleanup via Map, not array** — the 5 listeners are kept in a `Map<EventName, listener>` rather than an array of `{ type, fn }` objects. Gives O(1) per-type lookup during cleanup and makes the "remove exactly the function we registered" invariant obvious at the call site. Node's EventEmitter.off requires reference equality; a less-careful implementation that created a fresh closure at cleanup time would be a silent listener leak.
- **Origin check order** — allowlist check happens in the outer handler BEFORE `streamSSE` is invoked. A forbidden origin never sees the streaming path at all: no header flush, no listener registration, no writeSSE call. Verified by the test that asserts `engine.events.listenerCount('version.created') === 0` after a rejected request.
- **`void writeSSE(...).catch(() => {})` instead of await** — the listener fires synchronously from EventEmitter's emit loop; `await` would serialize writes behind each other and block the event-emitting code path (which lives in the engine facade, not in the HTTP layer — we must never slow the engine down with HTTP backpressure). The `.catch(() => {})` swallows the post-disconnect stream-closed error since the subsequent cleanup handler removes the listener anyway.
- **Keep-alive via writeSSE, not raw stream.write** — RESEARCH.md §2 uses `void stream.write(': ping\n\n')` (raw SSE comment). The plan's `<action>` block uses `stream.writeSSE({ data: ': ping' })`, which produces `data: : ping\n\n` on the wire. Both keep the connection open; `writeSSE` goes through the same error-handling surface as real frames (single place to instrument if we ever need metrics). Went with the plan's `writeSSE` form for conformance; the test assertion `toContain(': ping')` accepts either wire shape.
- **Async test timing — `await Promise.resolve()` twice** — Hono's `streamSSE` invokes its callback via fire-and-forget `run()`, so the listener registration happens in a subsequent microtask after `app.request` returns. Tests use two microtask yields (one for streamSSE's internal Promise.then in `run`, one for the first `await` inside our callback) so listeners are attached before any `emitEvent` call — otherwise the event would fire before anyone was listening and the assertion would fail with zero bytes in the stream body.

## Deviations from Plan

None. Plan 05-05 executed exactly as written:

- Test file structure matches the plan's `<action>` block (same test names, same coverage).
- Implementation matches the plan's reference code: `streamSSE` + `onEvent/offEvent` + `setInterval` 30s + `: ping` keep-alive + abort-signal cleanup + origin-allowlist check.
- Tuple form + single-task TDD loop followed the plan literally.
- Test adaptation allowed by the plan's `<action>` note ("it is acceptable to test event registration/deregistration by spying on `engine.events.onEvent` and `engine.events.offEvent` directly rather than reading the raw SSE bytes") was NOT needed — the Hono harness plus a `drain()` helper handles the raw bytes cleanly. We kept the spy-based cleanup assertion anyway as a belt-and-suspenders layer.

## Issues Encountered

- **Worktree-vs-main-repo path gotcha (own goal, resolved inside the RED phase).** Initial Write of the test file targeted the main-repo absolute path `/Users/macapple/comfyui-vfx-mcp/src/http/__tests__/sse.test.ts` instead of the worktree path `/Users/macapple/comfyui-vfx-mcp/.claude/worktrees/agent-a47b93c1/src/http/__tests__/sse.test.ts`. Vitest in the worktree reported `No test files found`; `git status` in the main repo showed the stray file. Removed the stray file, re-wrote to the correct path; zero impact on commit history (no RED commit made before the fix). Captured here so future parallel-executor runs know to sanity-check `pwd` before `Write`.

## Auth Gates

None. SSE handler ships with zero external API calls.

## Known Stubs

None. The handler is production-complete — no TODOs, no placeholder comments, no inert branches.

## Threat Flags

No new threat surface beyond the plan's `<threat_model>`. All three documented mitigations hold:

- **T-5-01 (Spoofing via CORS/origin):** Mitigated. Origin check happens in the outer handler before `streamSSE` is invoked. Unit test `origin not in allowlist → 403, stream never opened` asserts both the 403 status AND that `engine.events.listenerCount('version.created') === 0` after the rejection.
- **T-5-02 (Information Disclosure via metadata `value`):** Mitigated (inherited from Plan 05-02). `MetadataChangedPayload` type omits `value`; pipeline.ts emits without it. SSE test `forwards metadata.changed without leaking value` adds a regression guard at the wire level: `expect(text).not.toMatch(/"value"\s*:/)` on the literal response bytes.
- **T-5-08 (DoS via resource exhaustion):** Mitigated. `EngineEmitter.setMaxListeners(100)` in Plan 05-02 tolerates many concurrent SSE clients without `MaxListenersExceededWarning`. `clearInterval` + `offEvent`×5 on disconnect ensures no listener leak. Unit test asserts `listenerCount === 0` for each of the 5 types after an aborted stream.

## Plan 06 Handoff Note

Plan 05-06 (server.ts wiring) mounts this handler:

```typescript
import { createSseHandler } from './http/sse.js';

const sseHandler = createSseHandler(engine, httpAllowedOrigins);
app.get('/api/events', sseHandler);
// Order per D-WEBUI-12: /mcp first, then /api/*, then static catch-all.
```

`httpAllowedOrigins` is the same `HTTP_ALLOWED_ORIGINS`-derived array already consumed by the `/mcp` route (`server.ts:232+` per plan 05-CONTEXT). Reuse verbatim.

## Verification Evidence

- `npx vitest run src/http/__tests__/sse.test.ts` — **11 passed** (0 skipped, 0 failed). 145ms.
- `npx vitest run src/http/__tests__/sse.test.ts src/http/__tests__/error-middleware.test.ts` — **42 passed**. 144ms.
- `npx vitest run --no-coverage` (full root) — **643 passed | 2 skipped**. 19.35s.
- `npx tsc --noEmit` — zero errors.
- `grep "@modelcontextprotocol" src/http/sse.ts` — OK (no match).
- `grep "better-sqlite3" src/http/sse.ts` — OK (no match).
- `npx vitest run src/__tests__/architecture-purity.test.ts` — 10/10 green.
- `grep -E "engine\.events\.(on|off)Event" src/http/sse.ts` — matches at `onEvent` + `offEvent` call sites (plan `key_links.pattern` satisfied).
- Line counts: sse.ts 128 lines (≥70 minimum), sse.test.ts 287 lines (≥80 minimum) — both clear plan thresholds.

## Success Criteria Check

- [x] SSE handler returns `Content-Type: text/event-stream` (verified by the `returns text/event-stream content type` test).
- [x] All 5 event types forwarded as SSE data lines with correct event names (5 dedicated tests, one per type).
- [x] Origin not in allowlist → 403 (verified).
- [x] On disconnect: `offEvent` called for all 5 event types, no listener leak (spy + listenerCount assertions).
- [x] Keep-alive ping emitted every 30s (fake-timer advance test).
- [x] Zero MCP SDK imports in `src/http/sse.ts` (grep + architecture-purity test).
- [x] Full root vitest suite green (643 passed | 2 skipped).

## Self-Check: PASSED

All created files verified on disk:

- `src/http/sse.ts` — FOUND (128 lines)
- `src/http/__tests__/sse.test.ts` — FOUND (287 lines)

All commits verified in git log:

- `3b629cf` — FOUND (Task 1 RED)
- `c936d6f` — FOUND (Task 1 GREEN)

---

*Phase: 05-web-dashboard*
*Plan: 05*
*Completed: 2026-04-23*
