# Phase 10 — Deferred Items

Out-of-scope discoveries logged during plan execution. NOT auto-fixed
(per the executor scope-boundary rule — only fix issues directly caused
by the current task).

## v1.1 ROADMAP-shape failures in audit tests

**Discovered:** 2026-04-30 during Plan 10-01 execution (verifying baseline
before adding `src/store/migrate.ts`).

**Symptom:** 5 test failures across two files, all caused by the v1.1
ROADMAP not matching v1.0-shaped audit-test expectations.

| File | Failing test | Root cause |
| --- | --- | --- |
| `src/__tests__/phase-attribution.test.ts` | `parses ROADMAP.md and finds at least 9 phase blocks` | v1.1 ROADMAP starts at Phase 10 — block-counting heuristic from v1.0 audit no longer matches. |
| `src/__tests__/phase-attribution.test.ts` | `every non-skipped phase declares at least one REQ-ID in ROADMAP` | v1.1 REQ-IDs (DEMO-01..03, PROV-V-01..07) format differs from v1.0 expectation. |
| `src/__tests__/phase-attribution.test.ts` | `SUMMARY requirements-completed: union ⊇ ROADMAP **Requirements**: per phase` | v1.1 phases have no SUMMARYs yet (executing). |
| `src/__tests__/validation-flags.test.ts` | `parses ROADMAP.md body progress table and finds at least 9 phases` | Same ROADMAP-shape mismatch. |
| `src/__tests__/validation-flags.test.ts` | `detects [GAP CLOSURE] phases (6, 7, 8, 9) from ROADMAP top-level checklist` | v1.1 ROADMAP has no GAP CLOSURE checklist (v1.0-only construct). |

**Origin:** Pre-existed Plan 10-01. Confirmed by stashing
`src/store/migrate.ts` and re-running both test files — same 5 failures.
Caused by commit `04d5f60` (`docs: create milestone v1.1 roadmap`) which
landed the v1.1 ROADMAP without updating the v1.0 audit-test expectations.

**Why deferred:** Out of Plan 10-01 scope (engine-layer foundation for
DEMO-01). These tests are about milestone-rollover housekeeping — they
should be updated either:
- as part of the v1.1 milestone-close audit, or
- in a small follow-up "v1.1 audit-test update" plan within Phase 10
  if a future plan hits a related blocker.

**Workaround:** Plan 10-01 success criterion is "passing count ≥ 760
(no regression)." Re-baselined: pre-Plan-10-01 v1.1 baseline is
**756/764 passing, 5 failing, 3 skipped** (the 3 pre-existing v1.0
timing flakes plus the 5 new v1.1 ROADMAP-shape failures). Plan 10-01
itself adds NO failing tests — the 756 number is unchanged across
Plan 10-01 (verified by running with and without `src/store/migrate.ts`).

**Status:** Logged. No action this plan.
