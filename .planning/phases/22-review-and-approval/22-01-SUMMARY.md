---
phase: 22-review-and-approval
plan: 01
subsystem: api
tags: [hono, zod, http, shot-status, drizzle, sqlite, rest]

requires:
  - phase: 20-shot-status-engine
    provides: engine.setShotStatus + engine.listShotStatusHistory (positional args, transactional write) + engine.diffVersions (already accepts arbitrary pair) + SHOT_STATUSES const
provides:
  - PATCH /api/shots/:id/status — closed-set Zod whitelist, null/'' → undefined coercion (REV-04), REV-05 Restore path structural reuse
  - GET /api/versions/:a/diff-with/:b — REV-03 cross-version diff pass-through, no engine signature change (Pitfall 2 closed)
  - GET /api/shots/:id/status-history?limit=50 — RESEARCH Q1 closed (Phase 20 method now HTTP-reachable)
affects: [22-02, 22-03, 22-04, 22-05, 22-06, 22-07]

tech-stack:
  added: []
  patterns:
    - "Closed-set Zod whitelist at the HTTP boundary: z.enum(SHOT_STATUSES) for to_status, nullable+optional string for note, returning Zod path[0] only in error.message (T-22-06)"
    - "null OR '' → undefined coercion before positional engine call; engine repo writes `note ?? null` so blank inputs land as IS NULL (REV-04 invariant)"
    - "Thin route layer delegating to engine — no business logic in dashboard-routes.ts (D-19); pass-through pattern for engine.diffVersions retains shape (Pitfall 2)"

key-files:
  created:
    - src/__tests__/dashboard-routes-set-status.test.ts
    - src/__tests__/dashboard-routes-diff-ab.test.ts
    - src/__tests__/dashboard-routes-status-history.test.ts
  modified:
    - src/http/dashboard-routes.ts

key-decisions:
  - "Engine.setShotStatus called with POSITIONAL args (shotId, toStatus, changedBy, note?) — RESEARCH Pitfall 1; passing parsed.data as a struct would fail at TS compile"
  - "engine.diffVersions delegates unchanged — RESEARCH Pitfall 2 verified at src/engine/diff.ts:172, cross-shot 400 stays at engine layer"
  - "REV-04 null-when-blank invariant lives in the route's note coercion (null||'' → undefined), not in the Zod schema — keeps the wire shape liberal and the persistence shape strict"
  - "REV-05 Restore is structurally identical to other transitions — engine.setShotStatus has no transition guard, so PATCH { to_status: 'wip', note: 'Restored from omit' } commits without engine extension"
  - "Test 4 (REV-05 Restore) assertions switched from history[0]-by-position to .find() — STAT-03 ORDER BY created_at DESC has no tiebreaker for same-ms ties; the REV-05 invariant is event presence, not history position"

patterns-established:
  - "HTTP-layer Zod whitelist for closed enums: z.enum(SHOT_STATUSES) gates non-members → 400 INVALID_INPUT via TypedError before reaching the engine"
  - "Route error messages echo only the Zod path (T-22-06 XSS hygiene) — never the raw input value; dashboard renders as Preact JSX children (auto-escape)"

requirements-completed: [REV-04, REV-05]

duration: 28min
completed: 2026-05-14T05:50:00Z
---

# Plan 22-01: Server HTTP Routes Summary

**Three new dashboard HTTP routes wire Phase 20's shot-status engine to the dashboard — closed-set Zod whitelist + transactional engine delegation + REV-04 null-when-blank invariant enforced at the route layer.**

## Performance

- **Duration:** 28 min (incl. recovery from Wave 1 SSE timeout)
- **Started:** 2026-05-14T03:30:00Z (worktree dispatch — stalled at ~10min)
- **Completed:** 2026-05-14T05:50:00Z (inline recovery)
- **Tasks:** 3 (1 RED scaffold + 1 GREEN implementation + 1 regression check)
- **Files modified:** 4 (1 source + 3 new test files)

## Accomplishments

- **3 new HTTP routes** live in `src/http/dashboard-routes.ts`, wiring Phase 20's status engine to the dashboard via Zod-validated, TypedError-mapped thin pass-throughs.
- **15 new test cases green** across 3 test files; full server suite at 1868 passed (1853 baseline + 15 new) with the 21 pre-existing failures unchanged.
- **REV-04 server-side closed:** PATCH body `note: null` and `note: ''` both persist as `IS NULL` in `shot_status_events` (verified via engine.listShotStatusHistory).
- **REV-05 verified:** `{ to_status: 'wip', note: 'Restored from omit' }` commits without engine extension — Restore is structurally identical to other transitions.
- **No engine signature changes** — RESEARCH Pitfall 1 (positional args) + Pitfall 2 (diffVersions already accepts arbitrary pair) both honored.
- **Architecture-purity green:** zero MCP SDK imports in dashboard-routes.ts (D-19 boundary preserved); tool-budget unchanged at 7/12 (D-21).

## Task Commits

1. **Task 1: RED scaffolds (3 test files)** — `8cb9bf0` (test)
2. **Task 2: 3 GREEN route implementations** — `0d7cd08` (feat)
3. **Test 4 deterministic-ordering fix** — `b48e384` (chore) — Task 3 follow-up after full-suite revealed same-ms timestamp flake

_Task 3 (full-suite regression check) was verification-only and produced the chore commit above; no source changes._

## Files Created/Modified

- `src/http/dashboard-routes.ts` — Extended EngineForDashboard Pick with `setShotStatus` + `listShotStatusHistory`; added SHOT_STATUSES import; declared `SetShotStatusBody` Zod schema; added 3 routes (PATCH /api/shots/:id/status, GET /api/versions/:a/diff-with/:b, GET /api/shots/:id/status-history). +92 LOC.
- `src/__tests__/dashboard-routes-set-status.test.ts` — 8 tests covering happy path, REV-04 null-note invariant (3 ways), REV-05 Restore, invalid to_status (400), unknown shot (404), 500-char note cap, changed_by attribution. **+217 LOC**.
- `src/__tests__/dashboard-routes-diff-ab.test.ts` — 3 tests covering same-shot diff, cross-shot 400 INVALID_INPUT, unknown :a 404. **+158 LOC**.
- `src/__tests__/dashboard-routes-status-history.test.ts` — 4 tests covering empty state, after-PATCH state, limit=abc 400, unknown shot 404. **+126 LOC**.

## Verification

- **3 new test files:** all green (15 tests).
- **Tool budget:** `npx vitest run src/__tests__/tool-budget.test.ts` exits 0 — assertion `=== 7` unchanged (D-21).
- **Architecture-purity:** `npx vitest run src/__tests__/architecture-purity.test.ts` exits 0 — no MCP imports in dashboard-routes.ts (D-19).
- **Append-only invariant:** `grep -rn 'UPDATE shot_status_events' src/` matches only documentation comments and the architecture-purity test's enforcement helper — zero actual SQL statements (Phase 20 invariant intact).
- **Full server suite:** 1868 passed | 21 failed | 3 skipped. The 21 failures match the pre-existing baseline from STATE.md exactly (validation-flags, requirements-cohort-closure, phase-attribution, 15-plans — all pre-date Phase 22).
- **Key-link greps (from plan acceptance criteria):**
  - `app.patch('/api/shots/:id/status'` — 1 match
  - `app.get('/api/versions/:a/diff-with/:b'` — 1 match
  - `app.get('/api/shots/:id/status-history'` — 1 match
  - `engine.setShotStatus(\s*shotId,` — 1 match (positional args, Pitfall 1 confirmed)
  - `baseVersionId` — 0 matches (Pitfall 2 confirmed — no engine extension)

## Self-Check: PASSED

- [x] All 3 tasks executed
- [x] Each task committed individually (test/feat/chore — 3 commits)
- [x] SUMMARY.md created
- [x] No modifications to shared orchestrator artifacts (STATE.md, ROADMAP.md untouched in this plan)

## Recovery Note (Phase 22 Wave 1 SSE Timeout)

This plan's executor worktree (worktree-agent-a560…) stalled at Task 2 mid-implementation due to an Anthropic SSE stream idle timeout (#2410-class, Opus 4.7 at ~200K cache_read). The orchestrator:
1. Cherry-picked the Task 1 RED commit from the worktree back to main.
2. Applied the partial Task 2 WIP (EngineForDashboard Pick extension + SHOT_STATUSES import + Zod schema declaration — 60 lines) as a starting patch.
3. Completed Task 2 inline (added 3 route handlers, +92 LOC) — committed as `0d7cd08`.
4. Ran full-suite Task 3 verification inline — surfaced the REV-05 same-ms tie issue, fixed with the test-determinism patch in `b48e384`.

Plan outcome is unchanged versus the subagent path — same diff would have landed.
