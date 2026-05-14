---
phase: 22
slug: review-and-approval
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Test framework + per-requirement test map sourced from `22-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (server + dashboard) + @testing-library/preact 3.2.4 + jsdom 29.0.2 |
| **Config files** | `vitest.config.ts` (server root) + `packages/dashboard/vitest.config.ts` (dashboard) |
| **Quick run command** | `npx vitest run <single-test-file>` |
| **Full suite command** | `npx vitest run` (server) + `cd packages/dashboard && npx vitest run` (dashboard) |
| **Estimated runtime** | ~30 seconds (quick subset) / ~3 min (full both sides) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <task-test-file>` (dashboard subset for UI tasks; server subset for HTTP tasks) — < 30s
- **After every plan wave:** Run `npx vitest run` (server) + `cd packages/dashboard && npx vitest run` (dashboard) — full both sides
- **Before `/gsd-verify-work`:** Full suite green + tool-budget + architecture-purity + append-only grep (Phase 21 Wave 5 gate template)
- **Max feedback latency:** 30 seconds for per-task; 3 min for per-wave

---

## Per-Task Verification Map

> Filled by `gsd-planner` from each task's `<verify>` block. Initial seed below from RESEARCH §"Phase Requirements → Test Map".

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| REV-01 | ReviewPanel renders header + action bar + timeline when `activeOverlay='review'` | unit | `npx vitest run packages/dashboard/src/views/__tests__/ReviewPanel.test.tsx` | ❌ W0 | ⬜ pending |
| REV-01 | SSE `shot.status_changed` for open shot updates header pill in-place; review state preserved | integration | `npx vitest run packages/dashboard/src/__tests__/review-panel-sse-integration.test.tsx` | ❌ W0 | ⬜ pending |
| REV-01 | Popover gating: action button → opens popover; Confirm fires `onConfirm(note)`; outside-click cancels | unit | `npx vitest run packages/dashboard/src/components/__tests__/StatusChangePopover.test.tsx` | ❌ W0 | ⬜ pending |
| REV-02 | Quick-approve optimistic + revert: mutation precedes PATCH; PATCH 2xx no-op; error reverts + WarningPill | integration | `npx vitest run packages/dashboard/src/__tests__/quick-approve-flow.test.tsx` | ❌ W0 | ⬜ pending |
| REV-02 | WarningPill 5s auto-dismiss timer clears `quickApproveError` signal | unit | (covered in `quick-approve-flow.test.tsx`) | ❌ W0 | ⬜ pending |
| REV-03 | A/B view: skeletons → `.decode()` resolves → side-by-side thumbnails + MetadataDiff | unit | `npx vitest run packages/dashboard/src/views/__tests__/ABCompareView.test.tsx` | ❌ W0 | ⬜ pending |
| REV-03 | Preload failure: `.decode()` rejects → `.onload` fallback rejects → COMPARE_MODAL_THUMB_LOAD_FAIL renders | unit | (covered in `ABCompareView.test.tsx`) | ❌ W0 | ⬜ pending |
| REV-04 | Engine: `setShotStatus(shotId, 'approved', 'user', undefined)` writes `note: null` to `shot_status_events` | integration (server) | `npx vitest run src/__tests__/dashboard-routes-set-status.test.ts` | ❌ W0 | ⬜ pending |
| REV-04 | Client: Popover with empty textarea → `onConfirm(null)` not `onConfirm('')` | unit | (covered in `StatusChangePopover.test.tsx`) | ❌ W0 | ⬜ pending |
| REV-05 | Restore button: `currentStatus='omit'` → visible; else not in DOM | unit | `npx vitest run packages/dashboard/src/components/__tests__/ReviewActionBar.test.tsx` | ❌ W0 | ⬜ pending |
| REV-05 | Restore popover: `action='restore'` hides textarea; submit sends literal `RESTORE_NOTE_SYSTEM_TEXT` | unit | (covered in `StatusChangePopover.test.tsx`) | ❌ W0 | ⬜ pending |
| D-13 | ShotGridCard: root is `<div>` (not button); 3 sibling buttons present; no button-in-button | unit | `npx vitest run packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` | ✅ (extend) | ⬜ pending |
| D-13 | ShotStatusPill: `onClick` → `<button>` with `aria-haspopup="dialog"`; absent → `<span>` | unit | `npx vitest run packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx` | ✅ (extend) | ⬜ pending |
| D-02 | Mutual-exclusion overlay: `activeOverlay='review'` unmounts VersionDrawer; `'version'` unmounts ReviewPanel | unit | `npx vitest run packages/dashboard/src/views/__tests__/OverlayHost.test.tsx` | ❌ W0 | ⬜ pending |
| D-19 | PATCH route delegates to engine; SHOT_NOT_FOUND → 404; INVALID_INPUT → 400 | unit (server) | `npx vitest run src/__tests__/dashboard-routes-set-status.test.ts` | ❌ W0 | ⬜ pending |
| D-16 | GET diff route delegates to `engine.diffVersions(a, b)`; different shots → 400 | unit (server) | `npx vitest run src/__tests__/dashboard-routes-diff-ab.test.ts` | ❌ W0 | ⬜ pending |
| D-21 | Tool count holds at 7 | server invariant | `npx vitest run src/__tests__/tool-budget.test.ts` | ✅ | ⬜ pending |
| Architecture | No MCP imports in HTTP routes (purity rule) | repo-purity | `npx vitest run src/__tests__/architecture-purity.test.ts` | ✅ | ⬜ pending |
| Append-only | `UPDATE shot_status_events` grep returns zero | repo-purity | `grep -r "UPDATE shot_status_events" src/` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

New test files required (created before or as part of their owning plan's first task):

- [ ] `packages/dashboard/src/views/__tests__/ReviewPanel.test.tsx` — REV-01 structure + mount
- [ ] `packages/dashboard/src/views/__tests__/ABCompareView.test.tsx` — REV-03 preload + render + error
- [ ] `packages/dashboard/src/views/__tests__/OverlayHost.test.tsx` — D-02 mutual exclusion
- [ ] `packages/dashboard/src/components/__tests__/StatusChangePopover.test.tsx` — popover mechanics + REV-04 + REV-05 popover variant
- [ ] `packages/dashboard/src/components/__tests__/ReviewActionBar.test.tsx` — Restore visibility + action button states
- [ ] `packages/dashboard/src/components/__tests__/MetadataDiff.test.tsx` — summary + changes rendering
- [ ] `packages/dashboard/src/components/__tests__/QuickApproveButton.test.tsx` — hover affordance + click → popover
- [ ] `packages/dashboard/src/__tests__/quick-approve-flow.test.tsx` — REV-02 integration (optimistic + revert + WarningPill)
- [ ] `packages/dashboard/src/__tests__/review-panel-sse-integration.test.tsx` — SSE convergence with open review panel
- [ ] `src/__tests__/dashboard-routes-set-status.test.ts` — D-19 HTTP route + error envelopes
- [ ] `src/__tests__/dashboard-routes-diff-ab.test.ts` — D-16 HTTP route + cross-shot 400 path
- [ ] `src/__tests__/dashboard-routes-status-history.test.ts` — new `GET /api/shots/:id/status-history` route (RESEARCH Q1)
- [ ] Extend `packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` — D-13 refactor assertions
- [ ] Extend `packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx` — button-mode rendering

No new framework install needed; all test infrastructure exists (Vitest + @testing-library/preact + jsdom).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual preload behavior — no thumbnail flash on A/B modal mount | REV-03 | jsdom does not paint; `.decode()` resolves synchronously in mocked env | Open dashboard in browser, pick 2 versions, click Compare; both thumbs appear together with no progressive paint |
| Focus return after popover close | REV-01 | `triggerRef.current?.focus()` is unobservable in some test envs; verify visually | Tab to action button, Enter to open popover, ESC; focus ring returns to trigger button |
| Hover affordance discoverability | REV-02 | jsdom does not emit hover; visual-only contract | Hover any shot card; Check icon fades in within 150ms |
| Modal backdrop reduced-motion respect | UI-SPEC §"Animation discipline" | OS-level `prefers-reduced-motion` setting | Enable Reduce Motion in macOS; verify backdrop fade is skipped |
| Multi-tab SSE convergence | D-20 | Cross-window state not testable in jsdom | Open two browser tabs; approve from tab A; tab B's card updates to "approved" within SSE latency |

---

## Validation Sign-Off

- [ ] All tasks have `<verify>` automated commands or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING test file references
- [ ] No `--watch` flags in any verify command
- [ ] Feedback latency < 30s per task; < 3 min per wave
- [ ] `nyquist_compliant: true` set in frontmatter after planner fills `<verify>` blocks

**Approval:** pending
