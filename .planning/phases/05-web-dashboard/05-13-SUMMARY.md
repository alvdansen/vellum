---
phase: 05-web-dashboard
plan: 13
subsystem: api
tags: [sse, wire-shape, adapter, serialization-boundary, integration-test, WEBUI-03]

# Dependency graph
requires:
  - phase: 05-web-dashboard
    provides: createSseHandler listener wiring (Plan 05-05), EngineEmitter typed event surface (Plan 05-02), dashboard type contract and signal-backed writer (Plans 05-07/05-08), cross-cutting test scaffolding (Plan 05-11)
provides:
  - toDashboardPayload pure adapter at the SSE serialization boundary
  - Exhaustive compile-time + runtime wire-shape contract between engine-native payloads and the dashboard rendered type contract
  - End-to-end SSE seam test piping real EngineEmitter through real createSseHandler and real app.request into a reproduction of the dashboard writer
  - Architecture-purity regression guard that forbids raw JSON.stringify(payload) at the SSE listener
affects: [future-milestone, routing, reproduction, adapter-refactors]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Serialization-boundary adapter: engine-native payload shapes are translated to consumer-rendered contract by a single pure function before JSON.stringify"
    - "never-default exhaustiveness: discriminated-union switch with `const _exhaustive: never = type` arm guarantees a new EngineEventMap key fails `tsc --noEmit` until the adapter handles it"
    - "Server-side seam test pattern: real emitter + real handler + real HTTP fetch + inline reproduction of consumer writer (no cross-package runtime import)"

key-files:
  created:
    - "src/http/__tests__/sse-adapter.test.ts"
    - "src/http/__tests__/sse-e2e.test.ts"
  modified:
    - "src/http/sse.ts"
    - "src/http/__tests__/sse.test.ts"
    - "src/__tests__/architecture-purity.test.ts"

key-decisions:
  - "Wire adapter lives in src/http/sse.ts at the HTTP serialization boundary — engine payload shape and dashboard type contract are both source-of-truth and remain unchanged; the adapter is the single leverage point before JSON.stringify."
  - "tag.changed tagId is the tag string — this codebase has no tag entity with an id; tags are name-keyed strings in the assets layer."
  - "metadata.changed entityId is the version_id — Phase 5 scope only attaches metadata to versions; no entity-type ambiguity at the wire."
  - "E2E seam test reproduces the dashboard writer inline (no import from packages/dashboard/src/**) to keep the server test tree free of preact/signals runtime dependencies; the dashboard type contract is the ground truth."

patterns-established:
  - "Serialization-boundary adapter: a pure function with an exhaustive discriminated-union switch translates internal shapes to external contracts immediately before JSON.stringify. Exhaustiveness is compile-time (never-default) plus runtime throw (belt-and-braces)."
  - "Architecture-purity regression guard via static grep: a test reads the source file as text, strips line comments, and asserts the anti-pattern shape is absent — catches reintroduction on the next PR, not during live verification."
  - "End-to-end seam test that pipes real emitter → real handler → real HTTP fetch → reproduction of consumer writer. Distinct from unit tests of the adapter in isolation and structural tests of the handler with hand-rolled payloads."

requirements-completed: [WEBUI-03]

# Metrics
duration: ~20min
completed: 2026-04-23
---

# Phase 5 Plan 13: SSE Wire-Shape Adapter Summary

**Pure-function adapter at the SSE serialization boundary translates engine-native payloads to the dashboard rendered contract, unblocking live progress updates (SC-3 / WEBUI-03).**

## Performance

- **Duration:** ~20 min (four commits across ~4 min of code, ~15 min of verification loops)
- **Started:** 2026-04-23T22:05Z
- **Completed:** 2026-04-23T22:25Z
- **Tasks:** 4 (all autonomous)
- **Files modified:** 5 (2 new, 3 extended)

## Accomplishments

- `toDashboardPayload(type, payload)` pure function added to `src/http/sse.ts` with exhaustive discriminated-union switch over all 5 `EngineEventMap` keys and a `never`-default arm. Adding a sixth key to `EngineEventMap` fails `tsc --noEmit` at the default arm until the adapter handles it.
- SSE listener at the `writeSSE` call site now routes every payload through the adapter before `JSON.stringify`. Raw `JSON.stringify(payload)` no longer exists at the wire.
- 18 unit tests in `sse-adapter.test.ts` cover every translation rule (5 event types × their field renames + 4 status transitions + T-5-02 `value`-strip + runtime exhaustiveness smoke).
- 9 end-to-end tests in `sse-e2e.test.ts` pipe a real `createEngineEmitter` through the real Hono handler and `app.request` into an inline reproduction of the dashboard writer — the seam test whose absence Plan 05-11 SUMMARY explicitly flagged.
- 4 new tests in `architecture-purity.test.ts` forbid reintroduction of raw `JSON.stringify(payload)` at the listener (regression guard for CR-01).
- Live-smoke re-verification recipe embedded as a comment inside the purity test so `/gsd-verify-phase` can re-run the exact Terminal 1/2/3 sequence that empirically captured the CR-01 bug.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add toDashboardPayload adapter + wire it into the SSE listener** — `c09bf9a` (feat)
2. **Task 2: Unit tests for toDashboardPayload** — `b868a51` (test)
3. **Task 3: End-to-end seam test — real Hono + real EngineEmitter + real dashboard writer** — `b8725a3` (test)
4. **Task 4: Architecture-purity regression guard + phase-verification spot-check** — `d3f7d38` (test)

**Plan metadata:** `f042fb5` (docs: register plan 05-13 in roadmap) + `b92f93c` (docs: plan file).

## Files Created/Modified

- `src/http/sse.ts` — Added `toDashboardPayload` adapter + header docstring documenting the wire-shape boundary; wired at `writeSSE` call site.
- `src/http/__tests__/sse.test.ts` — Updated the 5 forwarding tests to assert dashboard-contract substrings (camelCase + dashboard status enum) instead of the obsolete snake_case assertions.
- `src/http/__tests__/sse-adapter.test.ts` — New unit-test file; 6 describe blocks, 18 `it` assertions.
- `src/http/__tests__/sse-e2e.test.ts` — New end-to-end seam test; 9 `it` assertions including the required-named test `'version.created SSE frame populates dashboard ActiveGeneration row with label'`. Architecture-purity respected: zero imports from `packages/dashboard/src/**`.
- `src/__tests__/architecture-purity.test.ts` — Extended with a 4-test CR-01 regression guard block + in-file live-smoke re-verification recipe.

## Closed Gaps

**CR-01 — SSE wire-shape drift.** The SSE endpoint forwarded engine-native payloads (snake_case keys + server status enum `'submitted' | 'running' | 'completed' | 'failed'` + no `label` field) while the dashboard expected camelCase keys + a 4-state dashboard enum + a breadcrumb-derived `label`. Every real `version.created` frame landed in the dashboard's active-generations store with undefined fields; every `version.status_changed` wrote an off-union status the `StatusPill` could not render. The adapter translates at the single leverage point immediately before `JSON.stringify`, and the new seam test pipes a real `engine.events.emitEvent()` through the actual SSE stream into a reproduction of the dashboard writer — the missing regression gate that would have caught this.

## Decisions Made

1. **Adapter location:** `src/http/sse.ts`, not the engine and not the dashboard. The engine payload shape stays source-of-truth for internal use (provenance, reproduction); the dashboard type contract stays source-of-truth for rendered state. Adapter is the single leverage point before `JSON.stringify`.
2. **`tag.changed` tagId = tag string.** The codebase has no tag entity with an id; tags are name-keyed strings in the assets layer (src/engine/assets.ts). The string is the natural identifier.
3. **`metadata.changed` entityId = version_id.** Phase 5 scope only attaches metadata to versions; no entity-type ambiguity at the wire.
4. **E2E seam test reproduces writer inline.** Importing `packages/dashboard/src/state/active-generations.ts` would pull preact/signals runtime into the server test harness. Reproducing the writer logic inline against the dashboard TYPE contract (ground truth) keeps the server test tree clean and the two writers trivially drift-detectable via `sse-adapter.test.ts` shape assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Architecture-purity grep needed line-comment stripping**
- **Found during:** Task 4 (CR-01 regression guard)
- **Issue:** The header docstring in `src/http/sse.ts` contains the phrase `raw JSON.stringify(payload) is never reintroduced at the listener` as documentation. The naive regex `/JSON\.stringify\(\s*payload\s*\)/g` would match the prose reference and fail the guard even when the code is correct.
- **Fix:** The purity test strips `//` line comments from the file text before matching, so the guard only sees executable code.
- **Files modified:** `src/__tests__/architecture-purity.test.ts` (the guard implementation itself)
- **Verification:** Temporarily regressed `sse.ts` to raw `JSON.stringify(payload)` — tests 2 and 3 correctly fail; reverted and all 18 architecture-purity tests green.
- **Committed in:** `d3f7d38` (Task 4 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 3 blocking)
**Impact on plan:** Necessary for correctness of the guard itself; zero scope creep.

## Issues Encountered

None. The plan was self-contained; the interfaces block locked every translation rule; the task bodies spelled out the test file contents.

## Re-verification Evidence

```
npx tsc --noEmit                                              → 0 errors
npx vitest run src/http/__tests__/sse-adapter.test.ts        → 1 file, 18 tests passed
npx vitest run src/http/__tests__/sse-e2e.test.ts            → 1 file, 9 tests passed
npx vitest run src/http/__tests__/sse.test.ts                → 1 file, 9 tests passed
npx vitest run src/__tests__/architecture-purity.test.ts     → 1 file, 18 tests passed (14 existing + 4 new)
npx vitest run                                               → 45 passed | 1 skipped (46 files); 718 passed | 2 skipped (720 tests) — up from 687 baseline
npm run test:dashboard                                       → 5 files, 29/29 passed
```

**Server test count:** 687 → 718 (+31 new tests; zero regressions).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **CR-01 closed.** The previously-failing roadmap success criterion (SC-3 / WEBUI-03 "Active generations show live progress updates via SSE without manual refresh") should now verify green on re-run of `/gsd-verify-phase 05`.
- **Secondary concerns remain deferred** per the user's scope-guard decision in 05-CONTEXT.md: WR-04 (`recent_versions` hardcoded empty in `getDashboardHome`), WR-01 (hardcoded `'outputs'` path root in the output-streaming route), WR-05 (dashboard `fetchJson` discards typed error bodies), and IN-01..IN-04. These do not block any SC and were explicitly scoped out of Plan 05-13.
- **Handoff to /gsd-verify-phase:** Re-run the behavioral spot-check from `05-VERIFICATION.md §Behavioral Spot-Checks` (Terminal 1/2/3 recipe embedded in `architecture-purity.test.ts`) to capture a live camelCase SSE frame that confirms the fix on a running server. The automated regression gate is already in place via `sse-e2e.test.ts`.

---
*Phase: 05-web-dashboard*
*Completed: 2026-04-23*
