---
phase: 5
slug: web-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-23
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

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

> Populated by planner from PLAN.md task list. Each task line below maps `task_id` → planned automated check.
> Initial scaffold lists requirement-level coverage; planner refines per-task IDs after PLAN.md is generated.

| Requirement | Coverage Layer | Test File(s) | Test Type | Automated Command | Status |
|-------------|----------------|--------------|-----------|-------------------|--------|
| WEBUI-01 (browse hierarchy) | Server unit | `src/http/__tests__/dashboard-routes.test.ts` | unit | `npx vitest run src/http/__tests__/dashboard-routes.test.ts` | ⬜ pending |
| WEBUI-01 | Dashboard component | `packages/dashboard/src/__tests__/TreeSidebar.test.tsx` | unit (snapshot + interaction) | `npm run test:dashboard -- TreeSidebar` | ⬜ pending |
| WEBUI-02 (version timeline + provenance drawer) | Server unit | `src/http/__tests__/dashboard-routes.test.ts` (versions/:id, /provenance, /diff) | unit | `npx vitest run src/http/__tests__/dashboard-routes.test.ts` | ⬜ pending |
| WEBUI-02 | Dashboard component | `packages/dashboard/src/__tests__/VersionDrawer.test.tsx`, `DiffDrawer.test.tsx` | unit | `npm run test:dashboard` | ⬜ pending |
| WEBUI-03 (live SSE updates) | Server unit | `src/http/__tests__/sse.test.ts`, `src/engine/__tests__/events.test.ts` | unit | `npx vitest run src/http/__tests__/sse.test.ts src/engine/__tests__/events.test.ts` | ⬜ pending |
| WEBUI-03 | Dashboard component | `packages/dashboard/src/__tests__/active-generations.test.tsx`, `events.test.ts` | unit | `npm run test:dashboard` | ⬜ pending |
| WEBUI-03 | Live smoke | `verify-phase5-dashboard.mts` | smoke | `npx tsx verify-phase5-dashboard.mts` | ⬜ pending |
| WEBUI-04 (static bundle from Hono) | Server unit | `src/http/__tests__/static.test.ts` | unit | `npx vitest run src/http/__tests__/static.test.ts` | ⬜ pending |
| WEBUI-04 | Cross-cutting | `src/__tests__/architecture-purity.test.ts` (extended) | unit | `npx vitest run src/__tests__/architecture-purity.test.ts` | ⬜ pending |
| WEBUI-04 | Cross-cutting | `src/__tests__/tool-budget.test.ts` (stays 7/12) | unit | `npx vitest run src/__tests__/tool-budget.test.ts` | ⬜ pending |
| WEBUI-05 (no build step required) | CI freshness | `.github/workflows/ci.yml` step `npm run build:dashboard && git diff --exit-code packages/dashboard/dist` | CI gate | (CI; locally `npm run build:dashboard && git diff --exit-code packages/dashboard/dist`) | ⬜ pending |
| WEBUI-05 | Server unit | `src/http/__tests__/static.test.ts` (fallback HTML when dist/ missing) | unit | `npx vitest run src/http/__tests__/static.test.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/dashboard/package.json` — declare vitest, @testing-library/preact, jsdom, happy-dom (planner picks env)
- [ ] `packages/dashboard/vitest.config.ts` — jsdom env + setup file path
- [ ] `packages/dashboard/src/__tests__/setup.ts` — `@testing-library/jest-dom` matchers; cleanup hooks
- [ ] Root `vitest.config.ts` — extend `exclude` to ignore `packages/**` so the root run does not double-collect dashboard tests
- [ ] `src/test-utils/fake-engine.ts` — extend with `events: EventEmitter` field used by SSE/route tests
- [ ] `src/test-utils/fixtures.ts` — add `buildStackWithOutputs()` helper for output-downloader tests
- [ ] Root `package.json` — add `"workspaces": ["packages/*"]` and the `build:dashboard / dev:dashboard / test:dashboard` scripts before any dashboard test can run

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ComfyUI-native aesthetic feels right | WEBUI-01, WEBUI-02 | Subjective design polish; cannot grep for "feels right" | Open dashboard at `http://127.0.0.1:3000/`; toggle dark/light; navigate workspace → project → sequence → shot; visually compare against UI-SPEC.md screenshots/tokens |
| Live update perception (no jitter, motion timing) | WEBUI-03 | Motion timing (150-200ms ease-out, pulse on running) is perceptual | Submit a generation via MCP; watch active-generations panel update on `version.created`; observe pulse on `running`, flash-on-complete |
| Demo audience can use it | WEBUI-01..05 | Cross-functional demo readiness | Walk a non-technical viewer through the home view → workspace → shot → version drawer; record any confusion |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
