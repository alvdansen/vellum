---
phase: 05-web-dashboard
plan: 03
subsystem: http-error-middleware
tags: [http, hono, error-handling, typed-errors, rest, sse-foundation, D-WEBUI-34, T-5-09]
dependency_graph:
  requires:
    - phase-05 plan-01 complete (OUTPUT_UNAVAILABLE added to ErrorCode union)
    - hono ^4.12.14 (already installed in root package.json)
  provides:
    - src/http/ directory (first file — scaffolds the HTTP layer)
    - typedErrorHandler (Hono ErrorHandler; shared by all 18 dashboard REST routes + SSE)
    - statusForCode(code): pure TypedError code → HTTP status mapping
  affects:
    - Plan 05-04 (dashboard REST routes): app.onError(typedErrorHandler) at mount time
    - Plan 05-05 (SSE endpoint): same onError hook — consistent error shape across REST + SSE
    - Plan 05-06 (server.ts wiring): imports + mounts the middleware on /api sub-app
tech_stack:
  added: []
  patterns:
    - Pattern+allowlist status mapping — prefix checks (INVALID_, COMFYUI_) + explicit Sets for exceptions
    - Unknown-code preservation — fallthrough 500 keeps original TypedError code in body (debugging aid, zero info leak)
    - ContentfulStatusCode narrowing — hono/utils/http-status type rejects bodyless codes (101/204/205/304) at compile time
key_files:
  created:
    - src/http/error-middleware.ts (108 lines — typedErrorHandler + statusForCode + 5 status Sets)
    - src/http/__tests__/error-middleware.test.ts (110 lines — 27 status-mapping tests + 4 handler tests)
  modified: []
decisions:
  - "[Plan 05-03] statusForCode strategy: prefix + allowlist Set. INVALID_* covers 5 codes, COMFYUI_* covers 3 codes; explicit Sets cover the rest. No regex, no default-export of a lookup table — Sets give O(1) lookup + explicit membership (reviewer reads the Set to see exactly which codes are in each bucket)."
  - "[Plan 05-03] ITERATE_INVALID_PATCH is in a separate BAD_REQUEST_CODES Set (not tacked onto the TAG_INVALID/METADATA_INVALID inline test as the plan's reference implementation did). Plan's inline approach would have silently missed ITERATE_INVALID_PATCH — the 400-prefix pattern only fires on startsWith('INVALID_'). The test caught this in RED→GREEN transition (Rule 1 fix before committing GREEN)."
  - "[Plan 05-03] ContentfulStatusCode (not StatusCode) from hono/utils/http-status. Hono's c.json overload signatures accept ContentfulStatusCode (a narrower subtype). StatusCode would work at runtime but tsc flagged it (Rule 3 blocking fix — full tsc --noEmit had to stay green). Since all 5 of our mappings (400/404/409/422/500/502) are body-bearing, ContentfulStatusCode is actually the correct type."
  - "[Plan 05-03] Unknown TypedError code preserves original code string (not replaced with INTERNAL_ERROR). Rationale: TypedError instances are authored by engine code and carry structural trust; preserving the code string aids debugging (client sees SOME_FUTURE_CODE in body, not a useless INTERNAL_ERROR). Only bare Error instances (not TypedError) get the INTERNAL_ERROR replacement — those could carry arbitrary raw error messages from SQLite/Node."
  - "[Plan 05-03] Hono ErrorHandler signature (err: Error, c: Context) — err is declared as Error (not TypedError). typedErrorHandler uses `instanceof TypedError` at runtime to narrow. This is the canonical Hono pattern — library types can't narrow arbitrary Error subclasses."
metrics:
  duration_minutes: 8
  task_count: 1
  file_count: 2
  commits: 2
  tests_added: 31
  tests_passing: 608
  tests_skipped: 2
  completed_date: "2026-04-23"
---

# Phase 5 Plan 3: HTTP Error Middleware (typedErrorHandler + statusForCode) Summary

**Hono error handler that converts every engine `TypedError` to a semantically correct HTTP status code with a stable `{ error: { code, message } }` JSON shape — the shared error surface for all 18 dashboard REST routes (Plan 05-04) and the SSE endpoint (Plan 05-05).**

## Outcome

`src/http/error-middleware.ts` is the first file in the new HTTP layer. It exports two symbols that Plans 05-04 and 05-05 depend on:

- `typedErrorHandler` — a `Hono` `ErrorHandler` to be installed via `app.onError(typedErrorHandler)`. Returns `{ error: { code, message } }` with the correct HTTP status. Zero stack leaks (T-5-09 verified).
- `statusForCode(code)` — pure status mapping. Exported so Plans 04/05 can build expected-response fixtures without instantiating a whole Hono app.

Architectural purity held: zero `@modelcontextprotocol/sdk` imports, zero `better-sqlite3` imports — this is strictly the HTTP layer.

## What Shipped

### `statusForCode(code)` — pure code → status mapping

Hybrid strategy: pattern checks (string `startsWith`) for high-density families, `Set` allowlists for exceptions.

| Family             | Pattern / Set                                                          | Status | Rationale                       |
| ------------------ | ---------------------------------------------------------------------- | ------ | ------------------------------- |
| Not found          | `NOT_FOUND_CODES` Set (8 codes — includes `*_UNAVAILABLE`)             | 404    | Resource missing                |
| Bad request        | `startsWith('INVALID_')` OR `BAD_REQUEST_CODES` Set (3 codes)          | 400    | Validation failure              |
| Bad gateway        | `BAD_GATEWAY_CODES` Set OR `startsWith('COMFYUI_')`                    | 502    | Upstream service failure        |
| Unprocessable      | `UNPROCESSABLE_CODES` Set (4 codes)                                    | 422    | Precondition/limit failed       |
| Conflict           | `CONFLICT_CODES` Set (2 codes)                                         | 409    | Uniqueness / concurrency        |
| Unknown            | (fallthrough)                                                          | 500    | Preserved in body (not hidden)  |

Exact coverage (from the canonical `ErrorCode` union in `src/engine/errors.ts`):

- **404 (8 codes):** `WORKSPACE_NOT_FOUND`, `PROJECT_NOT_FOUND`, `SEQUENCE_NOT_FOUND`, `SHOT_NOT_FOUND`, `VERSION_NOT_FOUND`, `PARENT_NOT_FOUND`, `PROVENANCE_UNAVAILABLE`, `OUTPUT_UNAVAILABLE`.
- **400 (7 codes):** `INVALID_INPUT`, `INVALID_SHOT_FORMAT`, `INVALID_WORKFLOW_FORMAT`, `INVALID_SCOPE`, `ITERATE_INVALID_PATCH`, `TAG_INVALID`, `METADATA_INVALID`.
- **502 (5 codes):** `COMFYUI_API_ERROR`, `COMFYUI_CREDENTIALS_MISSING`, `COMFYUI_RATE_LIMITED`, `GENERATION_TIMEOUT`, `DOWNLOAD_FAILED`.
- **422 (4 codes):** `REPRODUCE_BLOCKED`, `VERSION_NOT_COMPLETED`, `TAG_LIMIT_EXCEEDED`, `METADATA_LIMIT_EXCEEDED`.
- **409 (2 codes):** `DUPLICATE_NAME`, `CONCURRENT_SUBMIT_CONFLICT`.
- **500 (fallthrough):** any unknown code; original code preserved in body for debugging.

**26 of 26** codes in the union are explicitly covered. Any future code (e.g., `SOME_FUTURE_CODE`) falls to 500 with the code string preserved — no silent remapping.

### `typedErrorHandler` — Hono ErrorHandler

```typescript
export const typedErrorHandler: ErrorHandler = (err, c) => {
  if (err instanceof TypedError) {
    return c.json(
      { error: { code: err.code, message: err.message } },
      statusForCode(err.code) as ContentfulStatusCode,
    );
  }
  return c.json({ error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
};
```

Two-branch dispatch:

1. **TypedError path** (expected): use `statusForCode(err.code)` for status, emit `{ error: { code, message } }` body. `err.hint` is deliberately NOT in the body — agent-oriented hints are an MCP tool-envelope concern, not an HTTP response concern (D-WEBUI-34).
2. **Unknown Error path** (safety net): use 500 + `INTERNAL_ERROR` code. Any raw SQLite/Node error that escaped engine code never leaks its original class name or constraint string to the client.

Stack traces never appear in either branch — verified by the `response body has no stack field` assertion.

## TDD Gate Compliance

Task 1 followed RED → GREEN (no REFACTOR needed):

- **RED** `15f5d67`: `test(05-03): add failing tests for typedErrorHandler + statusForCode` — 31 tests (27 status-mapping + 4 handler); suite fails with `Cannot find module '../error-middleware.js'`. Confirmed RED.
- **GREEN** `3c45b35`: `feat(05-03): implement typedErrorHandler + statusForCode for dashboard HTTP surface` — 108-line implementation; all 31 assertions pass; full suite 608 passed | 2 skipped; tsc clean.
- **REFACTOR**: not needed. Implementation is already minimal (6 ordered guards, 5 data sets, docstring — single responsibility, zero dead code).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's reference implementation of `statusForCode` missed `ITERATE_INVALID_PATCH`**

- **Found during:** Task 1 GREEN — first run after implementing the plan's literal code returned 500 for `ITERATE_INVALID_PATCH` (test expected 400).
- **Investigation:** The plan's `<action>` block checks `code.startsWith('INVALID_') || code === 'TAG_INVALID' || code === 'METADATA_INVALID'`. `ITERATE_INVALID_PATCH` has `INVALID` in the middle of the string — it doesn't start with `INVALID_`, so the prefix check misses it. The explicit `code === ...` tail only names `TAG_INVALID` and `METADATA_INVALID`.
- **Fix:** Introduced `BAD_REQUEST_CODES = new Set(['TAG_INVALID', 'METADATA_INVALID', 'ITERATE_INVALID_PATCH'])`. The guard becomes `code.startsWith('INVALID_') || BAD_REQUEST_CODES.has(code)`. Symmetric with the other four Sets and extensible for future validation codes.
- **Files modified:** `src/http/error-middleware.ts`
- **Commit:** `3c45b35` (bundled with GREEN; never committed the buggy intermediate state)

**2. [Rule 3 - Type fix] `StatusCode` → `ContentfulStatusCode` import from `hono/utils/http-status`**

- **Found during:** Task 1 post-GREEN — tests were passing at runtime but `npx tsc --noEmit` reported `TS2769: No overload matches this call` at `c.json(..., statusForCode(err.code) as StatusCode)`.
- **Investigation:** Hono's `c.json` (v4.12.14) signature accepts `ContentfulStatusCode | undefined`, not `StatusCode`. `StatusCode` includes bodyless codes (101/204/205/304) that `c.json` rejects at the type level because they're incompatible with a JSON body. `ContentfulStatusCode` is the narrower subtype that strips those out. All five of our mappings (400/404/409/422/500/502) are contentful, so the narrower type is actually the more correct one.
- **Fix:** `import type { ContentfulStatusCode } from 'hono/utils/http-status'` + cast as `ContentfulStatusCode`. No runtime change.
- **Files modified:** `src/http/error-middleware.ts`
- **Commit:** `3c45b35` (bundled with GREEN before commit)

### Auth Gates

None. This plan adds pure functions + a synchronous Hono middleware. No network calls, no auth boundaries.

## Deferred Issues

None. Every `ErrorCode` in the union has an explicit mapping; unknown codes fall through to 500 with the code preserved in the body. No test was skipped.

## Known Stubs

None. The middleware is production-complete — no TODOs, no placeholder responses, no inert branches. Plans 05-04 and 05-05 consume this module verbatim via `app.onError(typedErrorHandler)`.

## Threat Flags

No new threat surface beyond what's documented in the plan's `<threat_model>`. The two relevant threats both hold:

- **T-5-09 (Information Disclosure via error body):** Mitigated. `err.stack` never appears in any response body (verified by `response body has no stack field` test). Unknown (non-TypedError) throws collapse to `INTERNAL_ERROR` so raw SQLite / Node error class names never reach the client.
- **T-5-01 (Spoofing via missing CORS):** Transferred to Plan 05-06 at `app.use('*', cors(...))` mount time. Error responses emitted here inherit whatever CORS the mount applies.

## Plan 04 + Plan 05 Handoff Note

**For Plan 05-04 (REST routes):**

```typescript
import { typedErrorHandler } from './error-middleware.js';

const app = new Hono();
app.onError(typedErrorHandler);
// ...routes that throw TypedError...
```

Routes throw `TypedError('SHOT_NOT_FOUND', 'shot sh001 not in seq_X')` and the middleware produces `404 { error: { code: 'SHOT_NOT_FOUND', message: '...' } }` automatically.

**For Plan 05-05 (SSE):**

The SSE endpoint's initial connection response uses `c.json` for pre-stream errors (e.g., version not found before the stream opens) — `typedErrorHandler` applies there. Once the stream is live, SSE-specific error framing takes over (emitted as `event: error\ndata: {...}\n\n`); that framing lives in the SSE handler, not in this middleware.

**For Plan 05-06 (server.ts mount):**

Mount order must be: `app.onError(typedErrorHandler)` BEFORE route registration. Hono's `onError` is process-wide for the app instance; installing it early ensures handler registration failures also go through the middleware.

## Commits

| Commit    | Message                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `15f5d67` | test(05-03): add failing tests for typedErrorHandler + statusForCode         |
| `3c45b35` | feat(05-03): implement typedErrorHandler + statusForCode for dashboard HTTP surface |

## Test Evidence

New-tests only:

```
 ✓ src/http/__tests__/error-middleware.test.ts (31 tests) 24ms
 Test Files  1 passed (1)
      Tests  31 passed (31)
   Duration  145ms
```

Full suite (regression guard):

```
 Test Files  37 passed | 1 skipped (38)
      Tests  608 passed | 2 skipped (610)
   Duration  ~19s
```

- 577 pre-existing tests → unchanged (no regressions).
- 31 new tests in `src/http/__tests__/error-middleware.test.ts` all green: 27 status-mapping cases (8 + 7 + 5 + 4 + 2 + 1) + 4 handler behavior cases.
- `npx tsc --noEmit` → zero errors.
- Architecture purity: `grep -E "(modelcontextprotocol|better-sqlite3|drizzle)"` against `src/http/error-middleware.ts` returns only the negative reference in the header comment (documenting the prohibition), zero actual imports.

## Success Criteria Check

- [x] `statusForCode` maps all 26 known error codes to correct HTTP status with no fallthrough
- [x] Unknown codes → 500 with original code string preserved in body (`SOME_FUTURE_CODE` test)
- [x] `typedErrorHandler` returns `{ error: { code, message } }` — no stack, no extra fields (verified by direct body-shape assertion)
- [x] `src/http/error-middleware.ts` has zero MCP SDK imports and zero SQLite imports (grep verified)
- [x] All tests pass in < 10 seconds (145ms for this file, ~19s for the full suite)
- [x] File line counts clear plan minimums: 108 lines (≥ 40) for middleware, 110 lines (≥ 60) for tests

## Self-Check: PASSED

All created files verified on disk:
- `src/http/error-middleware.ts` — FOUND (108 lines)
- `src/http/__tests__/error-middleware.test.ts` — FOUND (110 lines)

All commits verified in git log:
- `15f5d67` — FOUND (RED)
- `3c45b35` — FOUND (GREEN)
