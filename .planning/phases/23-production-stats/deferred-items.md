# Phase 23 — Deferred Items

Out-of-scope test failures observed during Plan 23-02 execution at wave-base
cdc0f41 (Wave 1 merge). Logged for the verifier; NOT fixed by Plan 23-02
because they are unrelated to the engine composition / ProgressBar / copy
constants changes in this plan.

## Pre-existing test failures unrelated to Plan 23-02 code surface

All failures below read `.planning/*.md` files (REQUIREMENTS.md, ROADMAP.md,
SUMMARY.md), NOT source code. They reflect the as-of-Wave-1-merge state of
those tracking files. Plan 23-02 modifies only `src/engine/pipeline.ts`,
`src/http/__tests__/dashboard-routes-shot-grid.test.ts`,
`packages/dashboard/src/components/ProgressBar.tsx` (NEW),
`packages/dashboard/src/components/__tests__/ProgressBar.test.tsx` (NEW),
and `packages/dashboard/src/lib/copy.ts` — none of which feed into these tests.

1. `src/__tests__/phase-attribution.test.ts` (2/8 failing) — reads
   ROADMAP.md + SUMMARY.md files for phase attribution audit; trips on
   pre-Wave-2 metadata in those files.
2. `src/__tests__/validation-flags.test.ts` (2/6 failing) — reads ROADMAP.md
   to detect GAP-CLOSURE phases; trips on Wave-1-state of that file.
3. `src/__tests__/requirements-cohort-closure.test.ts` (17/18 failing) —
   reads REQUIREMENTS.md + ROADMAP.md for the Phase 14 cohort closure
   smoke. Trips on Wave-1-state of those files (these tests historically
   passed under the merged-orchestrator state with full SUMMARY metadata
   regenerated at phase-complete time).
4. `src/tools/__tests__/generation-tool.test.ts` IT-20 — flaky
   `ENOTEMPTY` tmpdir cleanup race (`/var/folders/.../vfx-gen-tool-*`);
   well-known intermittent failure NOT caused by any Plan 23-02 source
   change.

## Verifier action

The orchestrator merge step regenerates ROADMAP / REQUIREMENTS / STATE
from per-plan SUMMARYs and re-runs the suite. These tests are expected to
re-green at that point (Phase 22 went through the same flow — see
prior commits `a03a10c docs(phase-22): complete phase execution` and
`fa6c6aa docs(phase-22): evolve PROJECT.md after phase completion`).

If they still fail after the orchestrator's regeneration, that is a
separate issue NOT introduced by Plan 23-02.
