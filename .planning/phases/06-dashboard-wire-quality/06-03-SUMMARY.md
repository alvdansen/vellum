---
phase: 06-dashboard-wire-quality
plan: 03
subsystem: http
tags: [dashboard, engine-facade, path-resolution, structural-pick, fake-engine]

# Dependency graph
requires:
  - phase: 05-web-dashboard
    provides: Engine.outputRoot field (D-WEBUI-26) + /api/versions/:id/output route + EngineForDashboard structural Pick + FakeEngine surface
  - phase: 06-dashboard-wire-quality
    plan: 02
    provides: pipeline.ts in a known-good state (line-range stability for the outputRoot field edit)
provides:
  - Engine.outputRoot widened from private-readonly to public-readonly — HTTP layer reads it through EngineForDashboard structural Pick
  - EngineForDashboard Pick extended from 17 to 18 keys (`'outputRoot'` appended)
  - FakeEngine.outputRoot mirror field (writable per-test; default 'outputs') — structural parity with the real Engine surface
  - Output route resolves file paths via `path.resolve(engine.outputRoot, versionId, filename)` — CWD-independent; absolute + relative roots both honored
  - 3 new SC-2 route tests: absolute root, relative root, default 'outputs' regression guard
affects:
  - Future deployments that construct the Engine with a non-default outputRoot (already supported at `pipeline.ts:100` `outputRoot: string = 'outputs'`) — the dashboard output route will now read from the correct disk location regardless of CWD
  - Any future HTTP route that needs to read engine configuration — the EngineForDashboard structural Pick pattern is reusable (append a key, land the matching field on FakeEngine, done)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Widening a private class field to public-readonly is safe and backward-compatible — existing internal usages keep working; new external readers get type-clean access"
    - "Structural Pick<T, K> widening over a single string key (`| 'outputRoot'`) is additive — no existing key removed or altered, no API break"
    - "FakeEngine field parity pattern: mirror the new public field with `public` (not `public readonly`) so tests can per-test-mutate; the structural Pick only checks for the accessor, readonly modifiers are erased"
    - "path.resolve(engineConfigPath, ...segments) over path.join(literal, ...segments) — honors operator-supplied root configuration AND produces CWD-independent absolute paths"

key-files:
  created:
    - .planning/phases/06-dashboard-wire-quality/06-03-SUMMARY.md
  modified:
    - src/engine/pipeline.ts (+3/-1 lines — outputRoot widened to public-readonly with SC-2 docstring)
    - src/http/dashboard-routes.ts (+5/-1 lines — Pick extended with 'outputRoot'; route uses path.resolve with SC-2 marker comment)
    - src/test-utils/fake-engine.ts (+6 lines — outputRoot public field with SC-2 docstring)
    - src/http/__tests__/dashboard-routes.test.ts (+97 lines — new SC-2 describe block with 3 tests + 2 new imports)

key-decisions:
  - "FakeEngine.outputRoot declared as `public` (not `public readonly`) to allow per-test mutation — structural Pick compatibility is preserved because `readonly` modifiers are erased at runtime and TypeScript treats `readonly string` assignable to `string` in the structural-Pick-accepts-writable direction"
  - "SC-2 marker comment embedded in dashboard-routes.ts at the path.resolve call site — future readers see the linkage to gap_closure WR-01 without needing to grep planning docs"
  - "Test insertion as a SEPARATE describe block (not appended to the existing output-route block) — grouping the 3 SC-2 cases makes the resolution behavior a single logical unit for future readers and keeps the existing T-5-04 traversal / MIME tests topically independent"
  - "Absolute-root test includes a negative regression assertion — `expect(existsSync(join('outputs', versionId, 'out.png'))).toBe(false)` proves the route is NOT falling back to the legacy hardcoded path even when the tmp-dir fixture coincidentally matches the legacy prefix"

patterns-established:
  - "Widening-a-private-field pattern: convert `private readonly X: T` to `public readonly X: T` when an external subsystem needs read access — constructor assignment still works (`public readonly` permits assignment in the constructor body); no API break for existing internal callers"
  - "EngineForDashboard Pick widening pattern: for each new engine field/method the HTTP layer needs, append one key to the Pick + land the matching field on FakeEngine; zero casts at the Hono route mount site"
  - "CWD-safe path resolution pattern: use `path.resolve(configuredRoot, ...segments)` instead of `path.join(literal, ...segments)` when `configuredRoot` may be absolute or relative — resolve() naturally handles both and never produces a relative result"

requirements-completed: []

# Metrics
duration: 3min
completed: 2026-04-24
---

# Phase 06 Plan 03: outputRoot Resolution (SC-2 / WR-01) Summary

**Engine.outputRoot is now public-readonly, surfaced through EngineForDashboard, mirrored on FakeEngine, and `/api/versions/:id/output` resolves via `path.resolve(engine.outputRoot, versionId, filename)` — the dashboard streaming route no longer depends on server CWD or the hardcoded `outputs` literal.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-24T00:44:16Z
- **Completed:** 2026-04-24T00:47:05Z
- **Tasks:** 2 (both TDD-tagged; Task 2 adds RED→GREEN-equivalent test coverage against Task 1's widened surface)
- **Files modified:** 4 (3 production, 1 test)
- **Files created:** 1 (SUMMARY.md)

## Accomplishments

- Closed audit item WR-01: the output-streaming route at `dashboard-routes.ts:232` now resolves against `engine.outputRoot` via `path.resolve`, eliminating the CWD-coupling and hardcoded-literal bugs identified in the v1.0 audit.
- Widened `Engine.outputRoot` from `private readonly` to `public readonly` — zero call-site disruption (constructor assignment still works under `public readonly`), but the HTTP layer can now read the field through a structural Pick.
- Extended `EngineForDashboard` Pick with `'outputRoot'` — 18 keys total. FakeEngine gained the mirror field (`public outputRoot: string = 'outputs'`, writable so tests can point it at a tmp dir).
- Added 3 new SC-2 tests covering absolute root resolution (proves CWD-independence with a negative regression check), relative root resolution (proves `path.resolve()` honors `process.cwd()`), and default `'outputs'` regression (proves existing behavior is preserved).

## Task Commits

Both tasks landed atomically on the worktree branch:

1. **Task 1 — widen + route rewrite** — `9abfff9` (feat)
   - `feat(06-03): widen Engine.outputRoot + route uses path.resolve (SC-2 WR-01)`
   - Files: `src/engine/pipeline.ts`, `src/http/dashboard-routes.ts`, `src/test-utils/fake-engine.ts`
2. **Task 2 — SC-2 test block** — `99731fd` (test)
   - `test(06-03): add SC-2 outputRoot resolution test block (3 cases)`
   - Files: `src/http/__tests__/dashboard-routes.test.ts`

_No REFACTOR commits — both changes were single-pass minimal and required no cleanup._

## Files Created/Modified

**Production code:**
- `src/engine/pipeline.ts` — Changed `private readonly outputRoot: string;` → `public readonly outputRoot: string;` with a 3-line JSDoc citing the SC-2 / WR-01 linkage. Constructor body unchanged (the assignment `this.outputRoot = outputRoot;` at line 108 still works under `public readonly`).
- `src/http/dashboard-routes.ts` — Two edits: (1) appended `| 'outputRoot'` to the `EngineForDashboard` Pick (17 → 18 keys); (2) replaced the `const filePath = path.join('outputs', versionId, filename);` literal at line 227 with `const filePath = path.resolve(engine.outputRoot, versionId, filename);` and a 4-line SC-2 marker comment. The existing T-5-04 security guards (lines 211-221) and `existsSync` / `createReadStream` calls are untouched — the change is purely in path-resolution, not the security envelope.
- `src/test-utils/fake-engine.ts` — Inserted `public outputRoot: string = 'outputs';` immediately below the `calls` field with a 4-line JSDoc citing SC-2. Declared as `public` (not `public readonly`) so tests can mutate it per-test to point at a tmp dir. Structural Pick compatibility is preserved because readonly modifiers are erased at runtime.

**Tests:**
- `src/http/__tests__/dashboard-routes.test.ts` — Added 2 new imports (`tmpdir` from `node:os`, `resolve as resolvePath` from `node:path`) and a new `describe('GET /api/versions/:id/output — outputRoot resolution (SC-2)')` block with 3 tests, a per-block `afterEach` that cleans the tracked tmp roots, and two local helpers (`writeUnder` for arbitrary-root fixture writes and `seedVersion` for the version entity fixture — kept local to the block to avoid conflicting with the existing `writeTestOutput` helper).

## Decisions Made

- **FakeEngine.outputRoot is `public`, not `public readonly`:** Tests need to mutate the field per-test to point at a tmp dir. TypeScript's structural Pick only requires the presence of an `outputRoot` accessor of type `string`; `readonly` modifiers don't affect structural compatibility (readonly erases at runtime, and the compiler treats `readonly T` as assignable to `T` in the Pick-accepts-writable direction). This is the simplest path and required no test-layer type-widening.
- **Absolute-root test includes a negative regression assertion:** `expect(existsSync(join('outputs', versionId, 'out.png'))).toBe(false)` fires if the route is still using the hardcoded path even when the tmp-dir fixture coincidentally matches the legacy prefix. This makes the test a true regression guard rather than a pass-by-coincidence.
- **Two dedicated path module imports (`join` + `resolve as resolvePath`):** The existing `join` import stays (used by `writeUnder` and the negative-regression check); `resolve` is imported as `resolvePath` to avoid shadowing the global `resolve` function often used in Promise code. Clean, no friction.
- **New SC-2 describe block is a sibling, not nested:** Grouping the 3 SC-2 cases as a sibling `describe` under the `createDashboardRouter` parent keeps the T-5-04 traversal tests topically independent from the SC-2 resolution tests. The block reuses the parent's `engine` binding and `buildApp` helper naturally (describe blocks inherit the parent's scope).

## Deviations from Plan

None — plan executed exactly as written. Task 2's plan text included minor typos (`engine.cans.versions.set(...)` is correct and was used unchanged) and the final test-block structure matches the plan's action description line-for-line.

## Issues Encountered

No unexpected issues. Clean worktree, clean baseline, clean post-change tsc, clean full server suite (729 passed, 2 skipped, 0 failed). The IT-20 ENOTEMPTY flake reported in the 06-02 SUMMARY did NOT surface this run — the full suite was green end-to-end.

## User Setup Required

None — no external service configuration required.

## Next Wave Readiness

- Wave 2 is a single plan (06-03); no sibling coordination needed.
- The plan's impact is confined to the dashboard output-streaming path and the FakeEngine surface — no downstream plan in Phase 06 (Wave 3+) depends on further outputRoot work.
- Phase 07 reconciliation (real ComfyUI completions populating real output files) can now be tested end-to-end against a non-default outputRoot — the fixture seam is fully paved.
- The `EngineForDashboard` widening pattern is now a documented precedent for future HTTP→Engine field exposures.

## Self-Check: PASSED

- FOUND: `src/engine/pipeline.ts:94` — `public readonly outputRoot: string;`
- FOUND: `src/engine/pipeline.ts` — no `private readonly outputRoot` (grep returns 0)
- FOUND: `src/http/dashboard-routes.ts:73` — `| 'outputRoot'` in the Pick
- FOUND: `src/http/dashboard-routes.ts` — no `path.join('outputs'` (grep returns 0)
- FOUND: `src/http/dashboard-routes.ts:232` — `path.resolve(engine.outputRoot, versionId, filename)`
- FOUND: `src/http/dashboard-routes.ts:228` — SC-2 marker comment
- FOUND: `src/test-utils/fake-engine.ts:41` — `public outputRoot: string = 'outputs';`
- FOUND: `src/http/__tests__/dashboard-routes.test.ts:488` — `describe('GET /api/versions/:id/output — outputRoot resolution (SC-2)', ...)`
- FOUND: `src/http/__tests__/dashboard-routes.test.ts:21` — `import { tmpdir } from 'node:os';`
- FOUND commit `9abfff9` in `git log` (Task 1 feat)
- FOUND commit `99731fd` in `git log` (Task 2 test)
- FOUND: target test suite passes 38/38 (`npx vitest run src/http/__tests__/dashboard-routes.test.ts`)
- FOUND: full server suite passes 729/731 (2 skipped, 0 failed)
- FOUND: `npx tsc --noEmit` is green

## TDD Gate Compliance

Plan 06-03 uses a pragmatic 2-task TDD layout: Task 1 widens the surface while keeping existing tests green (non-regression gate — all 35 pre-existing dashboard-route tests pass post-widening), then Task 2 adds the SC-2 test block that exercises the NEW behavior (path.resolve over path.join). Each task is a separate atomic commit:

- Task 1: `feat(06-03)` commit `9abfff9` — widened Engine + extended Pick + mirrored FakeEngine + rewrote route; existing 35 tests stayed green as the regression guard.
- Task 2: `test(06-03)` commit `99731fd` — added 3 SC-2 tests (absolute root, relative root, default 'outputs' regression) against Task 1's widened surface; all 3 pass green.

Gate sequence in git log: `feat(06-03)` → `test(06-03)`. This ordering is consistent with the plan's task ordering (Task 1 before Task 2). A pure RED-first sequence would have been possible (test(06-03) first with tests failing against the old route, then feat(06-03) to implement) but the plan's action description explicitly orders implementation → tests. No REFACTOR commits — both implementations are single-pass minimal.

---
*Phase: 06-dashboard-wire-quality*
*Completed: 2026-04-24*
