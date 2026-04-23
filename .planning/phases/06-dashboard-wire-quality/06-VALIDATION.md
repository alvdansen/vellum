---
phase: 6
slug: dashboard-wire-quality
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-23
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Server framework** | Vitest 4.1.4 (`environment: 'node'`) |
| **Server config file** | `vitest.config.ts` |
| **Server quick run command** | `npm test -- --run src/http/__tests__/dashboard-routes.test.ts src/http/__tests__/sse.test.ts src/store/__tests__/version-repo.test.ts` |
| **Server full suite command** | `npm test` |
| **Dashboard framework** | Vitest 4.1.4 (`environment: 'jsdom'`) |
| **Dashboard config file** | `packages/dashboard/vitest.config.ts` |
| **Dashboard quick run command** | `npm run test:dashboard -- --run src/__tests__/api-error.test.ts src/__tests__/shape.test.ts` |
| **Dashboard full suite command** | `npm run test:dashboard` |
| **Combined phase gate** | `npm test && npm run test:dashboard` |
| **Estimated runtime** | ~30 seconds (combined) |

---

## Sampling Rate

- **After every task commit:** Run only the file(s) the task touches (per-task command in the verification map below).
- **After every plan wave:** Run `npm test` (server full) + `npm run test:dashboard` (dashboard full).
- **Before `/gsd-verify-work`:** Combined phase gate must be green: `npm test && npm run test:dashboard`.
- **Max feedback latency:** 30 seconds.

---

## Per-Task Verification Map

> One row per success criterion. Plan/Wave/Task IDs filled in by the planner; SC binding and command are fixed by RESEARCH.md.

| SC | Behavior | Test Type | Automated Command | File Exists | Status |
|----|----------|-----------|-------------------|-------------|--------|
| SC-1 | `repo.listRecentCompleted(10)` returns rows ordered by `completed_at DESC`; empty DB returns `[]` | unit (repo) | `npm test -- --run src/store/__tests__/version-repo.test.ts` | ✅ | ⬜ pending |
| SC-1 | `engine.getDashboardHome()` returns real `recent_versions` (not the audit's `[]`) | unit (engine) | `npm test -- --run src/engine/__tests__/pipeline.test.ts` | ✅ | ⬜ pending |
| SC-2 | `/api/versions/:id/output` resolves the file path against `engine.outputRoot` (not literal `'outputs'`); works from any CWD | route | `npm test -- --run src/http/__tests__/dashboard-routes.test.ts` | ✅ | ⬜ pending |
| SC-3 | `fetchJson` rethrows `DashboardApiError{ code, status, body }` for typed error envelopes; falls back to generic shape for non-JSON bodies | unit (mock fetch) | `npm run test:dashboard -- --run src/__tests__/api-error.test.ts` | ❌ W0 | ⬜ pending |
| SC-4 | `qNum` rejects negatives, non-integer floats, and non-numeric strings with HTTP 400 + `{ error: { code: 'INVALID_INPUT', … } }`; absent param still returns fallback | route | `npm test -- --run src/http/__tests__/dashboard-routes.test.ts` | ✅ | ⬜ pending |
| SC-5 | SSE keep-alive frame on the wire begins with `: ping\n\n` exactly (true SSE comment per WHATWG); MUST NOT contain `data: : ping` | route (SSE wire) | `npm test -- --run src/http/__tests__/sse.test.ts` | ✅ | ⬜ pending |
| SC-6 | `normalizeStatus` returns the documented mapping for every union member; throws on a force-cast unknown input (no silent `→ 'queued'`) | unit | `npm run test:dashboard -- --run src/__tests__/shape.test.ts` | ❌ W0 | ⬜ pending |
| Cross | All 29 existing dashboard-suite tests + all server tests still green at phase close (no regressions) | full suite | `npm test && npm run test:dashboard` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/dashboard/src/__tests__/api-error.test.ts` — covers SC-3 (NEW)
- [ ] `packages/dashboard/src/__tests__/shape.test.ts` — covers SC-6 (NEW)
- [ ] No framework install needed — existing Vitest setup covers both server (`environment: 'node'`) and dashboard (`environment: 'jsdom'`) suites.

---

## Manual-Only Verifications

| Behavior | Source | Why Manual | Test Instructions |
|----------|--------|------------|-------------------|
| Browser-rendered SSE keep-alive does not produce `data: : ping` events in `EventSource.onmessage` | SC-5 | EventSource API ignores comment lines by spec; verifying ignore behavior in jsdom is brittle. Wire-level regex assertion in the unit test is the canonical check. | (Optional) Open `/api/events` in a browser, attach `es.onmessage = e => console.log(e.data)`, wait 30s, confirm no `: ping` appears in console output. |

*Otherwise: All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (SC-3 + SC-6 test files)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
