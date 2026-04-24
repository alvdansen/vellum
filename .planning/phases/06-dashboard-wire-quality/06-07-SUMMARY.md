---
phase: 06-dashboard-wire-quality
plan: 07
subsystem: ui
tags: [typescript, exhaustiveness, never-type, switch, dashboard, preact, type-discipline]

# Dependency graph
requires:
  - phase: 06-dashboard-wire-quality/01
    provides: Wave 0 test scaffold packages/dashboard/src/__tests__/shape.test.ts (9 cases, 2 RED cases for the throw-on-unknown contract)
  - phase: 05-web-dashboard/13
    provides: CR-01 closure — SSE adapter at src/http/sse.ts:108 SERVER_TO_DASHBOARD_STATUS guarantees union-valid statuses on the wire (prerequisite for dropping the silent fallback in normalizeStatus)
provides:
  - Compile-time exhaustiveness guard on the Version['status'] → StatusPill Status mapping via _exhaustive: never default arm
  - Runtime throw (instead of silent mis-render) if a value ever bypasses the type system via force-cast
  - Green GREEN-state for Plan 06-01's two RED assertion cases (throws on 'aborted', throws on 'cancelled')
affects: [future phases adding a 7th member to Version['status'] — fails npx tsc --noEmit at shape.ts:69 immediately]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exhaustive switch with const _exhaustive: never default arm (second occurrence in the repo — mirrors src/http/sse.ts:135 toDashboardPayload; established as the repo-wide idiom for closed-union discrimination)"

key-files:
  created: []
  modified:
    - packages/dashboard/src/lib/shape.ts
    - packages/dashboard/dist/index.html
    - packages/dashboard/dist/assets/index-Bv1uHhfG.js (renamed from index-zoyhvWiF.js by Vite content hash)

key-decisions:
  - "[Plan 06-07] Kept undefined→'queued' defensive default BEFORE the switch — the function signature accepts Version['status'] | undefined, so undefined is not an exhaustiveness failure but a documented optional-input case; the switch only discriminates over the six defined union members"
  - "[Plan 06-07] Committed rebuilt dashboard dist/ alongside source change — Plan 05-12 convention makes dist/ a tracked runtime artifact (server serves it at runtime with no install-time build); leaving it stale after a source change would drift the committed artifact from its source"
  - "[Plan 06-07] Validated Plan 06-01 contract via an ephemeral sanity test file (shape-sanity.test.ts) because the real test file lives in a parallel Wave 1 worktree; all 9 cases passed 9/9; sanity file deleted before commit so Plan 06-01 owns packages/dashboard/src/__tests__/shape.test.ts cleanly"

patterns-established:
  - "Second-occurrence validation of the _exhaustive: never switch idiom for closed unions in this repo (first at src/http/sse.ts:135; now at packages/dashboard/src/lib/shape.ts:69) — repo-wide convention for closed-union discrimination going forward"

requirements-completed: []  # Plan frontmatter `requirements: []` — no REQ-IDs bound to this plan. gap_closure: [IN-04].

# Metrics
duration: 3min
completed: 2026-04-24
---

# Phase 06 Plan 07: normalizeStatus Exhaustiveness Summary

**Rewrote `normalizeStatus` from silent-fallback if/else chain to an exhaustive `switch` with `_exhaustive: never` default arm — compile-time catches future Version['status'] drift, runtime throws on force-cast bypass.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-24T00:22:46Z
- **Completed:** 2026-04-24T00:26:12Z
- **Tasks:** 1
- **Files modified:** 3 (1 source + 2 dist artifacts)

## Accomplishments

- Replaced if/else chain at `packages/dashboard/src/lib/shape.ts:39-44` with `switch (raw)` over all six members of `Version['status']` (`queued | submitted | running | complete | completed | failed`) with grouped case arms matching RESEARCH.md §SC-6 exactly.
- Added `default: { const _exhaustive: never = raw; throw new Error(\`normalizeStatus: unhandled status: ${String(_exhaustive)}\`); }` — mirrors `src/http/sse.ts:135` `toDashboardPayload` idiom verbatim (second occurrence establishes repo-wide convention).
- Removed the silent `return 'queued'` fallback (no longer load-bearing after Plan 05-13 CR-01 closure — SSE adapter at `src/http/sse.ts:108` already guarantees union-valid statuses on the wire).
- Preserved `undefined → 'queued'` as a guard BEFORE the switch (function signature still accepts `Version['status'] | undefined`).
- Rebuilt committed dashboard `dist/` so the runtime-served artifact stays in sync with source (Plan 05-12 convention).

## Task Commits

1. **Task 1: Rewrite normalizeStatus with switch + never-default arm** — `48744a4` (feat)

_Note: Plan-level TDD: the RED scaffold (`packages/dashboard/src/__tests__/shape.test.ts`) is committed by the parallel Wave 1 agent Plan 06-01. This plan is the GREEN half — Task 1 makes the two "throws on unknown" RED cases (aborted, cancelled) pass by editing only the production module. No test file is modified or created by this plan._

## Files Created/Modified

- `packages/dashboard/src/lib/shape.ts` — `normalizeStatus` rewritten (28 lines), docstring expanded with SC-6 gap_closure IN-04 marker; imports and `versionLabel` / `unwrapList` unchanged per plan guard.
- `packages/dashboard/dist/index.html` — one-line script-tag hash update (Vite content-hashed bundle name rotated).
- `packages/dashboard/dist/assets/index-Bv1uHhfG.js` — renamed from `index-zoyhvWiF.js` (same dir, same purpose, new hash; this is git's file-rename view of a hash rotation).

## Decisions Made

- **Kept undefined guard BEFORE the switch.** The six-member union's exhaustiveness check should not be diluted by an `undefined` branch inside the switch — the documented contract is "undefined means missing-status payload, return 'queued' as defensive default." Hoisting the guard above `switch (raw)` keeps the default arm's `_exhaustive: never` narrow to a genuine type-system violation.
- **Included the rebuilt `dist/` in the Task 1 commit.** `packages/dashboard/dist/` is tracked (Plan 05-12 convention: the server serves it at runtime, no install-time build). Leaving the committed artifact out of sync with its source would mislead anyone running the committed `dist` without rebuilding.
- **Validated Plan 06-01's contract via a throwaway sanity test.** The real test file `shape.test.ts` is committed by a sibling Wave 1 agent and isn't in this worktree. I authored a temporary `shape-sanity.test.ts` with the exact 9 assertions documented in Plan 06-01 Task 2 and Plan 06-07 `<interfaces>`, ran it (9/9 pass), then deleted it before staging so the commit contains zero test-file changes. Plan 06-01 owns the test file cleanly; Plan 06-07 owns only the production module.

## Deviations from Plan

None — plan executed exactly as written. The plan specified an exact replacement function body in its `<action>` block; the committed code matches that body byte-for-byte (plus the `build:dashboard` rebuild which the plan explicitly required via acceptance criterion "Build still works").

## Issues Encountered

- **Worktree `node_modules/` not pre-installed.** First `npm run test:dashboard` invocation failed with `ERR_MODULE_NOT_FOUND '@preact/preset-vite'` because the parallel-executor worktree was spun up without deps. Ran `npm install --no-audit --prefer-offline` (4s, 547 packages) to restore the workspace; this is a worktree-bootstrap cost, not a deviation from the plan's scope.

## Verification

All plan acceptance criteria passed in this worktree:

| Criterion | Command | Result |
|-----------|---------|--------|
| `_exhaustive: never = raw` marker | `grep -q "_exhaustive: never = raw" packages/dashboard/src/lib/shape.ts` | PASS |
| Throw message format | `grep -q "normalizeStatus: unhandled status:" packages/dashboard/src/lib/shape.ts` | PASS |
| No 3rd `return 'queued'` silent fallback (expect exactly 2) | `grep -A 30 "export function normalizeStatus" ... \| grep -c "return 'queued'"` | 2 (PASS) |
| `switch (raw)` replaces if/else chain | `grep -A 15 "export function normalizeStatus" ... \| grep -q "switch (raw)"` | PASS |
| SC-6 marker comment | `grep -q "SC-6 (Phase 6 gap_closure IN-04)" ...` | PASS |
| Dashboard typecheck clean | `npx tsc --noEmit -p packages/dashboard` | exit 0 |
| Full dashboard suite (5 files, 29 tests) | `npm run test:dashboard` | 29 passed |
| Dashboard build | `npm run build:dashboard` | exit 0 |
| Server suite (no regressions) | `npm test` | 718 passed, 2 skipped |
| Plan 06-01 contract (sanity file, deleted pre-commit) | 9 assertions mirroring shape.test.ts | 9/9 PASS |

## TDD Gate Compliance

This plan's type is `execute` (not plan-level `tdd`). Task 1 is `tdd="true"`, but the RED gate lives in Plan 06-01 (a parallel Wave 1 agent commits `shape.test.ts` with 2 RED cases for this plan to turn GREEN). Since Plan 06-01 runs concurrently, its RED commit is not visible in this worktree's branch — the orchestrator merge unifies both waves. From this worktree's linear git log, only a `feat(06-07):` commit exists. Plan 06-01's `test(06-01):` commit on its sibling worktree satisfies the RED prerequisite; the sanity-file ephemeral run in this worktree proves the GREEN semantics.

## Next Phase Readiness

- **SC-6 (IN-04) closed on the production side.** The dashboard's `normalizeStatus` is now type-safe against Version['status'] union drift. Any future plan that widens the union (e.g., adding `'aborted'` or `'cancelled'`) will see `npx tsc --noEmit` fail at `packages/dashboard/src/lib/shape.ts:69` and be forced to handle the new case explicitly.
- **Plan 06-01 Wave 0 file (`shape.test.ts`) becomes fully GREEN after the orchestrator merges this commit + Plan 06-01's commit.** No further action on the SC-6 track.
- **No blockers introduced.** The threat model predicts zero new trust boundaries (pure dashboard-local function). The only runtime behavior change is that previously-unreachable force-cast inputs now throw instead of silently mapping to `'queued'` — and the SSE adapter already prevents such inputs from reaching this function at runtime (T-06-07-02 mitigated upstream).

## Self-Check: PASSED

- FOUND: packages/dashboard/src/lib/shape.ts (modified)
- FOUND: packages/dashboard/dist/index.html (modified)
- FOUND: packages/dashboard/dist/assets/index-Bv1uHhfG.js (created by rebuild, renamed view of prior hash)
- FOUND: commit 48744a4 in git log
- FOUND: SC-6 marker in source at `packages/dashboard/src/lib/shape.ts:41`
- FOUND: `_exhaustive: never = raw` in source at `packages/dashboard/src/lib/shape.ts:68`
- FOUND: throw template with exact regex pattern `/normalizeStatus: unhandled status: /`

---
*Phase: 06-dashboard-wire-quality*
*Completed: 2026-04-24*
