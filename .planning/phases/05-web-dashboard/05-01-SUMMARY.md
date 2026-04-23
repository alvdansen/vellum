---
phase: 05-web-dashboard
plan: 01
subsystem: foundation-monorepo
tags: [monorepo, npm-workspaces, preact, vite, tailwindcss, vitest, fake-engine, test-utils, OUTPUT_UNAVAILABLE]
dependency_graph:
  requires:
    - phase-04 complete (Engine facade stable, VersionWithAssets type in place)
  provides:
    - npm workspaces monorepo: packages/dashboard/ registered
    - root scripts: build:dashboard / dev:dashboard / test:dashboard
    - typed error code: OUTPUT_UNAVAILABLE (D-WEBUI-34)
    - FakeEngine (public events: EventEmitter + calls[] + cans.*) for Plan 03 routes
    - buildStackWithOutputs() tmp-dir Engine stack for Plan 02 output-downloader
    - root vitest.config.ts excludes packages/** (isolated dashboard jsdom runner)
  affects:
    - Plan 02 (engine events + output-downloader): consumes FakeEngine.events
    - Plan 03 (HTTP routes + SSE): consumes FakeEngine full read surface
    - Plan 04 (static mount + server.ts wiring): consumes scaffold + workspaces
    - Plan 05+ (dashboard src): relies on scaffold for Vite HMR + theme.css + jsdom tests
tech_stack:
  added_root:
    - npm workspaces: ["packages/*"]
  added_dashboard_deps:
    runtime:
      preact: "^10.29.1"
      "@preact/signals": "^2.9.0"
      "@fontsource/inter": "^5.2.8"
      "@fontsource/inter-tight": "^5.2.7"
      lucide-preact: "^1.9.0"
    dev:
      typescript: "^5.9.3"
      vite: "^8.0.10"
      "@preact/preset-vite": "^2.10.5"
      tailwindcss: "^4.2.4"
      "@tailwindcss/vite": "^4.2.4"
      vitest: "^4.1.5"
      "@testing-library/preact": "^3.2.4"
      "@testing-library/jest-dom": "^6.9.1"   # 6.10.0 not yet published on npm registry at Plan 01 run
      jsdom: "^29.0.2"
  patterns:
    - FakeEngine as per-test fixture with public events emitter (analog: FakeComfyUIClient)
    - buildStackWithOutputs returns {engine, outputsDir, client, sqlite, cleanup} (analog: buildStack)
    - npm workspaces hoist — some deps land at root node_modules, some stay in packages/dashboard/node_modules
key_files:
  created:
    - packages/dashboard/package.json
    - packages/dashboard/tsconfig.json
    - packages/dashboard/vite.config.ts
    - packages/dashboard/vitest.config.ts
    - packages/dashboard/index.html
    - packages/dashboard/src/__tests__/setup.ts
    - src/test-utils/fake-engine.ts
    - src/test-utils/__tests__/test-utils-extensions.test.ts
  modified:
    - package.json (workspaces field + 3 dashboard scripts)
    - package-lock.json (npm install regenerate)
    - .gitignore (outputs/ + packages/dashboard/node_modules/)
    - vitest.config.ts (exclude packages/**)
    - src/engine/errors.ts (OUTPUT_UNAVAILABLE)
    - src/test-utils/fixtures.ts (buildStackWithOutputs appended)
    - src/__tests__/zero-config.test.ts (1500ms -> 3000ms subprocess timeout — Rule 3)
    - src/__tests__/stdio-hygiene.test.ts (default killAfterMs 1500 -> 3000 — Rule 3)
decisions:
  - "[Plan 05-01] @testing-library/jest-dom pinned ^6.9.1 instead of plan's ^6.10.0 — 6.10.0 not yet published (npm view max = 6.9.1 as of 2026-04-23). Rule 3 blocking fix: dependency resolution unblocked plan-execute."
  - "[Plan 05-01] Root vitest upgraded 4.1.4 -> 4.1.5 automatically via npm workspaces resolver (dashboard pins ^4.1.5). No API breakage — full suite green."
  - "[Plan 05-01] subprocess-boot tests (zero-config, stdio-hygiene) had 1500ms kill timer that was tight even pre-monorepo; npm workspaces install hoisted dashboard devDeps into root node_modules, increasing tsx cold-start under parallel vitest load past 1500ms. Bumped to 3000ms in both tests as Rule 3 blocking fix — semantic unchanged (boot must complete before stdio inspection), timing margin only."
  - "[Plan 05-01] FakeEngine.diffVersions return shape: matched actual DiffResponse from src/types/provenance.ts ({summary: string, changes: DiffChanges}) instead of plan's {summary: {total_changes, sections}} object-shape which does not exist in the type system. Plan prose lists the structured summary as a UI presentation concern; the engine returns the pure-string summary from diff.ts buildSummary()."
  - "[Plan 05-01] FakeEngine uses `satisfies` narrowing on literal entity fixtures (Workspace/Project/Sequence/Shot/Version/VersionWithAssets) instead of `as never` cast. Cleaner types at zero runtime cost; catches structural drift if hierarchy.ts shapes change."
metrics:
  duration_minutes: 10.7
  task_count: 2
  file_count: 14
  commits: 3
  tests_added: 7
  tests_passing: 577
  tests_skipped: 2
  completed_date: "2026-04-23"
---

# Phase 5 Plan 1: Web Dashboard Foundation (Monorepo + FakeEngine + OUTPUT_UNAVAILABLE) Summary

**Foundation wave: npm workspaces monorepo scaffold + config-only dashboard package + server-side test-utils extensions for Plans 02-04.**

## Outcome

Every later plan in Phase 5 depends on the floor this plan built:

- **Plan 02** (engine events + output-downloader) gets `OUTPUT_UNAVAILABLE` typed error code and `buildStackWithOutputs()` for filesystem-wiring tests.
- **Plan 03** (HTTP dashboard routes + SSE) gets `FakeEngine` with `events: EventEmitter` and a full read-method surface (hierarchy, version, provenance, diff, assets) so route unit tests can assert handler shape without seeding a real DB.
- **Plan 04** (static mount + server.ts wiring) gets `packages/dashboard/dist/` as a committable build target per D-WEBUI-09.
- **Plan 05+** (dashboard component source) gets the full Vite + Tailwind v4 + Vitest-jsdom scaffold.

## What Shipped

### Root monorepo migration

- `package.json` adds `"workspaces": ["packages/*"]`. Three new scripts (`build:dashboard`, `dev:dashboard`, `test:dashboard`) delegate via `npm run <task> --workspace=packages/dashboard`. Zero new runtime or devDependencies added to the root — every Preact/Vite/Tailwind/Vitest-jsdom dep is isolated in `packages/dashboard/package.json`.
- `.gitignore` adds `outputs/` (D-WEBUI-26 runtime ComfyUI downloads) + `packages/dashboard/node_modules/` (defensive). `packages/dashboard/dist/` is deliberately NOT ignored — it IS committed per D-WEBUI-09, so fresh `git clone && npm install && npm run start:http` serves the built dashboard immediately.
- Root `vitest.config.ts` excludes `packages/**` so the root Node-env run never double-collects dashboard jsdom tests. Root run: `npx vitest run` -> 577 passed. Dashboard run (future plans): `npm run test:dashboard` -> separate Vitest process with jsdom env.
- `npm install` at root succeeds, hoists most deps (preact, vite, @preact/preset-vite, vitest) to root `node_modules`; some stay in `packages/dashboard/node_modules/` (@tailwindcss/vite, platform-specific binaries). All resolve correctly at runtime. better-sqlite3 native bindings rebuilt cleanly — existing server tests (570 total) unaffected.

### Dashboard workspace scaffold (config-only — no source code yet)

All files are config-only; zero application logic. Plan 05 onwards ships `src/main.tsx`, `src/lib/`, `src/components/`, `src/views/`, `src/styles/theme.css`.

- `packages/dashboard/package.json`: Preact ^10.29.1 + @preact/signals ^2.9.0 + lucide-preact ^1.9.0 + @fontsource/inter ^5.2.8 + @fontsource/inter-tight ^5.2.7 (runtime). Vite ^8.0.10 + @preact/preset-vite ^2.10.5 + tailwindcss ^4.2.4 + @tailwindcss/vite ^4.2.4 + vitest ^4.1.5 + @testing-library/preact ^3.2.4 + @testing-library/jest-dom ^6.9.1 + jsdom ^29.0.2 (dev).
- `packages/dashboard/tsconfig.json`: `"jsxImportSource": "preact"` + `"jsx": "react-jsx"` (automatic JSX runtime — no `import { h } from 'preact'` per file), `"strict": true`, `"noUnusedLocals/Parameters": true`. Includes Vitest + jest-dom ambient types.
- `packages/dashboard/vite.config.ts`: `preact()` + `tailwindcss()` plugins; dev server port 5173 with `/api` proxy -> http://127.0.0.1:3000 (D-WEBUI-13 two-process dev loop). Build target ES2022, single bundle.
- `packages/dashboard/vitest.config.ts`: jsdom env + global setup file + `preact()` plugin so JSX in test files resolves.
- `packages/dashboard/index.html`: SPA shell with `<div id="app"></div>` + FOUC-prevention theme script (`localStorage.getItem('vfx-familiar:theme')` applied to `<html data-theme>` BEFORE any render — D-WEBUI-16).
- `packages/dashboard/src/__tests__/setup.ts`: loads `@testing-library/jest-dom/vitest` matchers + `cleanup()` hook `afterEach` (prevents cross-test DOM leaks).

### OUTPUT_UNAVAILABLE typed error code

Extended `src/engine/errors.ts` ErrorCode union with `'OUTPUT_UNAVAILABLE'` (D-WEBUI-34). Reserved for the `GET /api/versions/:id/output` 404 path when the version exists but the downloaded file is missing on disk. TypedError class unchanged.

### FakeEngine (new test-util)

`src/test-utils/fake-engine.ts` exports `FakeEngine` class + `buildFakeEngine()` factory. Mirrors the real `Engine` facade's public read surface that dashboard REST routes (Plan 03) will delegate to:

- **Hierarchy:** `getWorkspace`, `listWorkspaces`, `getProject`, `listProjects`, `getSequence`, `listSequences`, `getShot`, `listShots`
- **Version:** `getVersion` (returns `VersionWithAssets` with `tags: []` + `metadata: []` defaults), `listVersionsForShot` (include_tags/include_metadata options passthrough), `getProvenance`, `diffVersions`
- **Asset:** `queryAssets`, `listTags`, `listMetadataKeys`
- **Mutation:** `reproduceVersion` (async; returns typed `{entity, breadcrumb, reproduction_warnings}` with `lineage_type: 'reproduce'`)

Key features:

- **`events: EventEmitter`** — public field, plain `node:events` emitter. Plan 02 will narrow to typed `EngineEmitter` (extends EventEmitter; structurally compatible — no migration needed).
- **`calls: Array<{method, args}>`** — every method push-appends its invocation record. Tests assert `engine.calls).toContainEqual({method: 'getVersion', args: ['ver_42']})`.
- **`cans` override map** — per-test fixtures. Test populates `engine.cans.versions.set('ver_X', {...})` before invoking; method returns that exact object instead of the default.
- **`reset()`** — clears calls, removes all listeners, empties every cans map/list.

### buildStackWithOutputs() (new fixture)

Appended to `src/test-utils/fixtures.ts`. Returns a real `Engine` wired against an in-memory SQLite DB + fresh `tmpdir()` for outputs/:

```typescript
const stack = buildStackWithOutputs();
// stack.engine   - real Engine instance with all repos + FakeComfyUIClient
// stack.outputsDir - /tmp/vfx-test-outputs-abc123 (real filesystem path)
// stack.client   - FakeComfyUIClient (scenario-driven)
// stack.sqlite   - raw better-sqlite3 Database handle
// stack.cleanup() - rmSync(outputsDir, {recursive, force})
```

Plan 02's output-downloader tests use this for happy-path + flaky-download scenarios where the downloader helper needs a real tmp directory to write into.

## TDD Gate Compliance

Task 2 followed RED -> GREEN -> REFACTOR:

- RED commit `a3db266`: `test(05-01): add failing tests for FakeEngine.events + buildStackWithOutputs` — 7 assertions; test file imports `../fake-engine.js` which didn't exist. Cannot-find-module error confirmed RED.
- GREEN commit `13c991c`: `feat(05-01): implement FakeEngine.events + buildStackWithOutputs() helpers` — 324 lines added; all 7 assertions pass.
- REFACTOR: none needed. Code is already minimal (single responsibility per class/function, typed via `satisfies`, mirrors the existing `FakeComfyUIClient` + `makeInMemoryDb` patterns).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] @testing-library/jest-dom ^6.10.0 does not exist on npm registry**
- **Found during:** Task 1 first `npm install` — ETARGET "No matching version found for @testing-library/jest-dom@^6.10.0".
- **Investigation:** `npm view @testing-library/jest-dom versions` -> latest published is 6.9.1 (2026-04-23). Plan's 05-RESEARCH.md §1 package.json skeleton happens to lock this range; the version hasn't shipped yet.
- **Fix:** Pin `^6.9.1` in `packages/dashboard/package.json`. Non-breaking — jest-dom 6.x is stable; 6.9.1 covers all matchers (`toBeInTheDocument`, `toHaveClass`, `toHaveTextContent`) used in dashboard component tests (future plans).
- **Files modified:** `packages/dashboard/package.json`
- **Commit:** `d0d72b4`

**2. [Rule 3 - Blocking] Subprocess-boot test flakes under parallel vitest load after monorepo install**
- **Found during:** Task 1 post-install full suite run — 2 tests failing (`zero-config > auto-creates db`, `stdio-hygiene > writes zero bytes to stdout during boot`).
- **Investigation:** Both tests `spawn('npx', ['tsx', 'src/server.ts'])` and `setTimeout(() => child.kill('SIGTERM'), 1500)`. When run in isolation (`--no-file-parallelism`), all 570 tests passed. Under default parallelism, the two subprocess tests hit the 1500ms window tight: monorepo install hoisted dashboard devDeps (preact, vite, vitest 4.1.5, @preact/preset-vite, etc.) into root `node_modules`, and `npx tsx` cold-start now resolves a larger tree. Boot completes ~1.6–2s; the 1500ms kill fires BEFORE the `openDb()` call wrote the db file / `stdio transport connected` log line.
- **Fix:** Bump kill timer from 1500ms to 3000ms in both tests (plus outer test timeout 10_000 -> 15_000 in zero-config). Semantic unchanged — tests still assert "boot completes before we kill the process and inspect output". Timing margin only.
- **Files modified:** `src/__tests__/zero-config.test.ts`, `src/__tests__/stdio-hygiene.test.ts`
- **Commit:** `d0d72b4`

**3. [Rule 3 - Type fix] FakeEngine.diffVersions return shape**
- **Found during:** Task 2 GREEN implementation — plan's action block declared the fake's default return as `{ summary: { total_changes: 0, sections: {...} }, changes: {...} }`.
- **Investigation:** Real `DiffResponse` type in `src/types/provenance.ts` is `{ summary: string; changes: DiffChanges }`. The structured summary object is a UI presentation concern (D-WEBUI-25 diff drawer), not an engine-layer return shape. Engine's `diff.ts::buildSummary(changes)` returns a plain string like `"2 param changes, 1 model change, seed unchanged"`.
- **Fix:** Fake returns `{summary: 'no changes', changes: {params:[], models:[], seed:null, workflow:[], metadata:[]}, breadcrumb: [], breadcrumb_text: ''}` — matches the real `Engine.diffVersions` envelope exactly.
- **Files modified:** `src/test-utils/fake-engine.ts` (no commit alone — bundled with GREEN commit)
- **Commit:** `13c991c`

### Auth Gates

None. This plan ships no code that calls external APIs.

## Deferred Issues

None.

## Known Stubs

None. Dashboard workspace ships zero application source — that's deliberate per plan objective ("ZERO behavioral code in the actual application — only the floor everything else stands on"). Plan 05+ will add `src/main.tsx` + components + views.

## Threat Flags

No new threat surface introduced beyond what's already in the plan's `<threat_model>`. All three documented mitigations hold:
- **T-5-07 (dep supply-chain pinning):** Every dashboard dep pinned to a specific caret range; no `*`, no git URLs, no file: deps. Only deviation is `@testing-library/jest-dom` -> `^6.9.1` (latest published).
- **Boundary leak mitigation:** Zero dashboard-only deps (preact, vite, tailwindcss, @preact/signals, lucide-preact, @fontsource/*, @preact/preset-vite, @tailwindcss/vite, jsdom, @testing-library/preact, @testing-library/jest-dom) appear in root `package.json` — verified programmatically: `node -e "..."` script scanned root deps and printed `root is clean of dashboard deps`.
- **gitignore drift:** `.gitignore` asserts `outputs/` present AND `packages/dashboard/dist` absent. Confirmed via `grep -q "outputs/" .gitignore && ! grep -q "packages/dashboard/dist" .gitignore`.

## Plan 02 + Plan 03 Handoff Note

**FakeEngine.events is currently typed as plain `EventEmitter` from `node:events`.** Plan 02 will:
1. Create `src/engine/events.ts` with a typed `EngineEventMap` + `EngineEmitter` interface (extends `EventEmitter`).
2. Narrow `FakeEngine.events` field type to `EngineEmitter` — ZERO runtime change, pure TypeScript narrowing (EngineEmitter extends EventEmitter -> structurally compatible today).
3. Plan 03 SSE handler then subscribes with typed `engine.events.on('version.created', (payload: VersionCreatedPayload) => ...)`.

Until then, Plan 03 route tests can emit arbitrary payloads via `engine.events.emit('version.created', {...anything})`. The assertion focus is on the HTTP route's response shape, not the event payload — that typing lands in Plan 02.

## Commits

| Commit    | Message                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `d0d72b4` | feat(05-01): convert repo to npm workspaces monorepo + scaffold dashboard + OUTPUT_UNAVAILABLE error code |
| `a3db266` | test(05-01): add failing tests for FakeEngine.events + buildStackWithOutputs |
| `13c991c` | feat(05-01): implement FakeEngine.events + buildStackWithOutputs() helpers   |

## Test Evidence

```
 Test Files  36 passed | 1 skipped (37)
      Tests  577 passed | 2 skipped (579)
   Duration  ~19s
```

- 570 existing server tests -> unchanged (no regressions).
- 7 new tests in `src/test-utils/__tests__/test-utils-extensions.test.ts` all green.
- `npx tsc --noEmit` -> zero errors.
- `npx vitest list | grep packages/dashboard` -> 0 matches (root run does NOT collect dashboard tests — isolation verified).
- `npm install` at root -> clean; both root + dashboard deps installed; better-sqlite3 native bindings resolved.

## Self-Check: PASSED

All created files verified on disk:
- `packages/dashboard/package.json` — FOUND
- `packages/dashboard/tsconfig.json` — FOUND
- `packages/dashboard/vite.config.ts` — FOUND
- `packages/dashboard/vitest.config.ts` — FOUND
- `packages/dashboard/index.html` — FOUND
- `packages/dashboard/src/__tests__/setup.ts` — FOUND
- `src/test-utils/fake-engine.ts` — FOUND
- `src/test-utils/__tests__/test-utils-extensions.test.ts` — FOUND

All commits verified in git log:
- `d0d72b4` — FOUND
- `a3db266` — FOUND
- `13c991c` — FOUND
