---
phase: 5
slug: web-dashboard
status: closed
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-23
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Phase 9 retrofit (2026-04-28) converted the Per-Requirement table to Per-Task across 13 plans (29 task rows total).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (server-side existing; dashboard-side new in Wave 0) |
| **Config file** | `vitest.config.ts` (root, existing) + `packages/dashboard/vitest.config.ts` (NEW, Wave 0) |
| **Quick run command** | `npx vitest run --no-coverage --reporter=basic` |
| **Full suite command** | `npx vitest run` (root) + `npm run test:dashboard` (workspace) |
| **Estimated runtime** | ~30 seconds (root) + ~10 seconds (dashboard) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --no-coverage --reporter=basic` (server-side scope)
- **After every plan wave:** Run full suite (root + dashboard workspace)
- **Before `/gsd-verify-work`:** Full suite must be green; live smoke `verify-phase5-dashboard.mts` must pass
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 0 | WEBUI-01..05 | — | Wave 0: monorepo scaffold + dashboard config-only files + OUTPUT_UNAVAILABLE error code extension | scaffold | `test -f packages/dashboard/package.json && test -f packages/dashboard/vitest.config.ts && test -f packages/dashboard/src/__tests__/setup.ts` | ✅ | ✅ green |
| 05-01-02 | 01 | 0 | — | — | Wave 0: extend test-utils with FakeEngine.events + buildStackWithOutputs(); root suite green | scaffold | `npx vitest run` | ✅ | ✅ green |
| 05-02-01 | 02 | 1 | WEBUI-03 | — | EngineEmitter (typed events) + output-downloader pure function + tests | unit | `npx vitest run src/engine/__tests__/events.test.ts src/engine/__tests__/output-downloader.test.ts` | ✅ | ✅ green |
| 05-02-02 | 02 | 1 | WEBUI-03 | — | Pipeline.events field + emit calls + downloader hook + pipeline-events test | integration | `npx vitest run src/engine/__tests__/pipeline-events.test.ts` | ✅ | ✅ green |
| 05-03-01 | 03 | 1 | TOOL-05 | — | typedErrorHandler + statusForCode middleware (42 unit cases — 4 typed errors → 4 statuses, fallback 500) | unit | `npx vitest run src/http/__tests__/typed-error-handler.test.ts` | ✅ | ✅ green |
| 05-04-01 | 04 | 2 | WEBUI-01, WEBUI-02 | — | 18 REST dashboard routes (workspaces/projects/sequences/shots/versions/diff/provenance/output/home) + test scaffold | integration | `npx vitest run src/http/__tests__/dashboard-routes.test.ts` | ✅ | ✅ green |
| 05-04-02 | 04 | 2 | WEBUI-01, WEBUI-02 | — | src/http/index.ts barrel export | typecheck | `npx tsc --noEmit` | ✅ | ✅ green |
| 05-05-01 | 05 | 2 | WEBUI-03 | — | createSseHandler — 5 event types, keep-alive comment frame, origin check, cleanup on disconnect | integration | `npx vitest run src/http/__tests__/sse.test.ts` | ✅ | ✅ green |
| 05-06-01 | 06 | 3 | WEBUI-04, WEBUI-05 | — | createStaticHandler — serves packages/dashboard/dist; fallback HTML when dist/ missing | unit | `npx vitest run src/http/__tests__/static.test.ts` | ✅ | ✅ green |
| 05-06-02 | 06 | 3 | WEBUI-04 | — | server.ts mount order — SSE → API → static (precedence preserves SSE long-poll) | integration | `npx vitest run src/__tests__/transport-parity.test.ts` | ✅ | ✅ green |
| 05-07-01 | 07 | 3 | WEBUI-04, TOOL-01 | — | architecture-purity HTTP layer + dashboard boundary; tool-budget invariant unchanged at 7 | grep-based unit | `npx vitest run src/__tests__/architecture-purity.test.ts src/__tests__/tool-budget.test.ts` | ✅ | ✅ green |
| 05-08-01 | 08 | 4 | WEBUI-01, WEBUI-03 | — | Dashboard data layer — types/events.ts + lib/api.ts fetch wrappers + lib/events.ts SSE client | unit | `npm run test:dashboard -- events api-error` | ✅ | ✅ green |
| 05-08-02 | 08 | 4 | WEBUI-01, WEBUI-03 | — | State signals (active-generations, hierarchy, versions) + active-gen tests | unit | `npm run test:dashboard -- active-generations` | ✅ | ✅ green |
| 05-09-01 | 09 | 4 | WEBUI-01, WEBUI-02 | — | Design system — theme.css (Tailwind v4) + 7 primitive components | unit (typecheck) | `cd packages/dashboard && npx tsc --noEmit` | ✅ | ✅ green |
| 05-09-02 | 09 | 4 | WEBUI-01 | — | TreeSidebar tests — render + expand + select interaction | unit | `npm run test:dashboard -- TreeSidebar` | ✅ | ✅ green |
| 05-10-01 | 10 | 4 | WEBUI-01, WEBUI-02, WEBUI-03 | — | Views — HomeView, VersionDrawer, DiffDrawer, ActiveGenerationsPanel + App.tsx + main.tsx | typecheck | `npx tsc --noEmit` | ✅ | ✅ green |
| 05-10-02 | 10 | 4 | WEBUI-04, WEBUI-05 | — | Vite build compiles cleanly against Plan 01's config | build | `cd packages/dashboard && npx vite build` | ✅ | ✅ green |
| 05-11-01 | 11 | 4 | WEBUI-01 | — | Dashboard cross-cutting — theme-persistence (localStorage + data-theme attribute) | unit | `npm run test:dashboard -- theme-persistence` | ✅ | ✅ green |
| 05-11-02 | 11 | 4 | WEBUI-03 | — | sse-signal-integration — SSE event → signal → panel render | unit | `npm run test:dashboard -- sse-signal-integration` | ✅ | ✅ green |
| 05-12-02 | 12 | 4 | WEBUI-04, WEBUI-05 | — | Build dist + commit + extend CI freshness gate (`build:dashboard && git diff --exit-code packages/dashboard/dist`) + live smoke script | CI gate + smoke | (CI; locally `npm run build:dashboard && git diff --exit-code packages/dashboard/dist && npx tsx verify-phase5-dashboard.mts`) | ✅ | ✅ green |
| 05-13-01 | 13 | 5 | WEBUI-03 | — | toDashboardPayload pure adapter (CR-01 closure) + wire into SSE listener | unit | `npx vitest run src/http/__tests__/sse-payload-adapter.test.ts` | ✅ | ✅ green |
| 05-13-02 | 13 | 5 | WEBUI-03 | — | Unit tests for toDashboardPayload (exhaustive switch + never-default + status union mapping) | unit | `npx vitest run src/http/__tests__/sse-payload-adapter.test.ts` | ✅ | ✅ green |
| 05-13-03 | 13 | 5 | WEBUI-03 | — | End-to-end seam test — real Hono + real EngineEmitter + real dashboard writer (sse-e2e.test.ts) | integration | `npx vitest run src/http/__tests__/sse-e2e.test.ts` | ✅ | ✅ green |
| 05-13-04 | 13 | 5 | WEBUI-04, TOOL-01 | — | Architecture-purity regression guard for SSE adapter + phase-verification spot-check | grep-based unit | `npx vitest run src/__tests__/architecture-purity.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/dashboard/package.json` — declare vitest, @testing-library/preact, jsdom, happy-dom (planner picks env)
- [x] `packages/dashboard/vitest.config.ts` — jsdom env + setup file path
- [x] `packages/dashboard/src/__tests__/setup.ts` — `@testing-library/jest-dom` matchers; cleanup hooks
- [x] Root `vitest.config.ts` — extend `exclude` to ignore `packages/**` so the root run does not double-collect dashboard tests
- [x] `src/test-utils/fake-engine.ts` — extend with `events: EventEmitter` field used by SSE/route tests
- [x] `src/test-utils/fixtures.ts` — add `buildStackWithOutputs()` helper for output-downloader tests
- [x] Root `package.json` — add `"workspaces": ["packages/*"]` and the `build:dashboard / dev:dashboard / test:dashboard` scripts before any dashboard test can run

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ComfyUI-native aesthetic feels right | WEBUI-01, WEBUI-02 | Subjective design polish; cannot grep for "feels right" | Open dashboard at `http://127.0.0.1:3000/`; toggle dark/light; navigate workspace → project → sequence → shot; visually compare against UI-SPEC.md screenshots/tokens |
| Live update perception (no jitter, motion timing) | WEBUI-03 | Motion timing (150-200ms ease-out, pulse on running) is perceptual | Submit a generation via MCP; watch active-generations panel update on `version.created`; observe pulse on `running`, flash-on-complete |
| Demo audience can use it | WEBUI-01..05 | Cross-functional demo readiness | Walk a non-technical viewer through the home view → workspace → shot → version drawer; record any confusion |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter (Phase 9, 2026-04-28)

**Approval:** closed 2026-04-28 (Phase 9 retrofit)

---

## Validation Audit 2026-04-28

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 (no real gaps surfaced; bookkeeping retrofit only) |
| Escalated | 0 |

Wave 0 closure: nyquist_compliant + wave_0_complete + status:closed all set in frontmatter; Per-Task Verification Map populated with final task IDs across 13 plans; baseline vitest run 754/757 green confirms infrastructure intact. See `.planning/phases/09-nyquist-wave0-closure/09-CONTEXT.md` decisions and `.planning/phases/09-nyquist-wave0-closure/09-VERIFICATION.md` for observable truths.
