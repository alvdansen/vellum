---
phase: 22-review-and-approval
verified: 2026-05-15T00:00:00Z
status: human_needed
score: 17/17 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Section A — Review panel happy path"
    expected: "Click status pill on any shot → review panel slides in → select Approve action → StatusChangePopover appears anchored to button → enter note → Confirm → card pill flips to 'approved' optimistically → panel SSE update arrives and converges idempotently"
    why_human: "End-to-end popover anchoring, focus-trap, and SSE convergence require live browser with WebSocket/SSE connection"
  - test: "Section B — REV-05 Restore from omit"
    expected: "Shot with status='omit' shows 5th Restore button in review panel action bar; textarea is hidden (D-09); Confirm → status changes to 'wip'; system note 'Restored from omit' persisted; for all other statuses, Restore button is absent"
    why_human: "Button visibility conditional on shot status, textarea hide, and system note persistence require live browser with populated DB"
  - test: "Section C — REV-02 quick-approve hover affordance and optimistic flip"
    expected: "Hover over shot card → Check icon appears top-right; click → StatusChangePopover opens anchored to button → Confirm → card pill flips to 'approved' instantly before server responds; simulate offline → WarningPill 'Approve failed — retry' appears inside card; auto-dismisses after 5s"
    why_human: "Hover opacity transition, popover anchoring, and offline failure path require live browser with network interception"
  - test: "Section D — REV-03 A/B compare full flow"
    expected: "Open review panel for shot with >=2 completed versions → 'Compare versions…' button visible in timeline → click → checkboxes appear on completed version rows → select 2 → 'Compare' CTA enables → click → full-viewport modal opens with both thumbnails preloaded (no skeleton flash) → MetadataDiff section renders below → ESC closes modal"
    why_human: "Visual preload behavior (no skeleton flash), modal dimensions, MetadataDiff scroll, and ESC dismissal require live browser"
  - test: "Section E — Multi-tab SSE convergence (D-20)"
    expected: "Approve a shot in tab A → tab B's grid card status pill updates without refresh; quick-approve failure in tab A does not corrupt tab B's signal state"
    why_human: "Multi-tab SSE behavior requires two live browser windows with shared server"
  - test: "Section F — Reduced motion (D-22)"
    expected: "With OS 'Reduce Motion' enabled: modal backdrop fade is absent (motion-safe: classes inactive); status pill hover brightness transition is absent; WarningPill and card transitions are suppressed"
    why_human: "Requires OS accessibility setting change + live browser inspection"
  - test: "Section G — Keyboard accessibility"
    expected: "Tab through shot card: (1) thumbnail button → (2) ShotStatusPill button → (3) QuickApproveButton (visible via :focus-within on group div); Enter on pill → review panel opens with focus trapped; Enter on Check → popover opens with focus trapped; Enter on version row in review panel → version drawer opens; Shift+Tab returns focus to anchor on popover Cancel"
    why_human: "Keyboard focus order, focus-trap, and focus-return disciplines require live browser interaction"
---

# Phase 22: Review and Approval Verification Report

**Phase Goal:** VFX supervisors approve, retake, hold, or omit shots from a review panel; compare two versions side-by-side; quick-approve directly from the grid.
**Verified:** 2026-05-15T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ShotStatusPill renders as `<span>` (presentational) when no onClick prop; renders as `<button aria-haspopup="dialog">` when onClick provided (D-13 dual-mode) | VERIFIED | `ShotStatusPill.tsx` lines 86–99: `if (onClick !== undefined)` branches to `<button ... aria-haspopup="dialog">`; else returns bare `pillContent` span |
| 2 | ShotGridCard outer element is `<div class="group">`, NOT `<button>` (D-13 reverses Phase 21 D-16) | VERIFIED | `ShotGridCard.tsx` line 75: `<div class="group relative w-full overflow-hidden rounded">` is the card body root |
| 3 | ShotGridCard has 3 sibling `<button>` children when hasVersion=true: thumbnail-button, ShotStatusPill-button, QuickApproveButton — none nested | VERIFIED | `ShotGridCard.tsx`: (a) thumbnail `<button>` lines 77–105; (b) `<ShotStatusPill ... onClick={...}>` line 119 renders as button; (c) `<QuickApproveButton>` lines 108–113 — all siblings inside the group div, never nested |
| 4 | ShotGridCard has 2 sibling `<button>` children when hasVersion=false (no QuickApproveButton) | VERIFIED | `ShotGridCard.tsx` lines 108–113: `{hasVersion ? <QuickApproveButton ...> : null}` — QuickApproveButton only mounts when hasVersion is true |
| 5 | Thumbnail-button click triggers onSelect(latest_completed_version.id) → openVersionDrawer (D-01 / D-19) | VERIFIED | `ShotGridCard.tsx` line 81: `onClick={hasVersion ? () => onSelect(shot.latest_completed_version!.id) : undefined}` |
| 6 | ShotStatusPill click triggers openReviewPanel(shot.id) — opens review panel (D-01) | VERIFIED | `ShotGridCard.tsx` line 120: `onClick={() => openReviewPanel(shot.id)}`; `openReviewPanel` imported from `../views/OverlayHost.js` |
| 7 | QuickApproveButton is absolutely positioned top-right; opacity-0 by default; opacity-100 on group-hover OR group-focus-within (D-10) | VERIFIED | `QuickApproveButton.tsx` line 106: `class="absolute top-1 right-1 z-1 inline-flex ... opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"` |
| 8 | QuickApproveButton is the ONLY hover action on the card — single Check icon, NOT a 4-action hover bank (D-11) | VERIFIED | `ShotGridCard.tsx` contains exactly one `<QuickApproveButton>` mount; no other hover-affordance component present |
| 9 | QuickApproveButton click opens `<StatusChangePopover action='approve'>` anchored to the button | VERIFIED | `QuickApproveButton.tsx` lines 110–116: `<StatusChangePopover action="approve" anchorRef={anchorRef} isOpen={isOpen} onConfirm={handleQuickApprove} onCancel={...}>` |
| 10 | Popover Confirm triggers optimistic mutation: `shotGrid.value.shots[idx].status='approved'` BEFORE awaiting PATCH (D-12) | VERIFIED | `QuickApproveButton.tsx` lines 56–65: `shotGrid.value = { ...current, shots: current.shots.map(...) }` then `quickApproveError.value = null` then `setIsOpen(false)` — all before `await setShotStatus(...)` at line 69 |
| 11 | On PATCH success, no additional UI change (SSE arrives → no-op idempotent handler) | VERIFIED | `QuickApproveButton.tsx` lines 72–74: comment confirms "SSE will arrive; idempotent handler no-ops" — success branch is intentionally empty |
| 12 | On PATCH failure: signal reverts AND WarningPill renders inside card; auto-dismisses after 5s with Pitfall 5 guard | VERIFIED | `QuickApproveButton.tsx` lines 76–93: revert via `shotGrid.value = { ...cur, ... }`, set `quickApproveError.value = shotId`, then `setTimeout(() => { if (quickApproveError.value === shotId) quickApproveError.value = null; }, 5000)`. `ShotGridCard.tsx` lines 72, 137–149: reads `quickApproveError.value === shot.id` → renders `<WarningPill>` |
| 13 | ReviewTimeline has 'Compare versions…' entry button (visible when versions.length >= 2); click enters compare-mode; checkboxes appear on version rows; selecting 2 enables Compare CTA which flips compareModalOpen=true | VERIFIED | `ReviewTimeline.tsx` lines 76–79: `canEnterCompareMode = versionIds.length >= 2`; lines 139–149: entry button conditional on `!compareMode && canEnterCompareMode`; lines 210–223: checkboxes on `isCompareable` rows; lines 165–169: CTA `onClick={() => { compareModalOpen.value = true; }}` |
| 14 | Full server suite green (1868 passed, matches Phase 21 baseline + 21 pre-existing failures) | VERIFIED | 22-07-SUMMARY.md phase gate check #1: `1868 passed / 21 pre-existing failures` |
| 15 | Full dashboard suite green (443/443) | VERIFIED | 22-07-SUMMARY.md phase gate check #2: `443/443 passed` |
| 16 | Tool-budget assertion === 7 (D-21) | VERIFIED | 22-07-SUMMARY.md phase gate check #3: `3/3 passed — assertion === 7 holds` |
| 17 | Architecture-purity test green; append-only invariant preserved | VERIFIED | 22-07-SUMMARY.md phase gate checks #4 and #5: `54/54 passed`; `0 matches in production code` for `UPDATE shot_status_events` |

**Score:** 17/17 truths verified (automated)

---

### Requirements Coverage

| Requirement | Phase Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| REV-01 | 22-05, 22-07 | Review panel with StatusChangePopover confirmation for each action (no bare one-click status change) | SATISFIED | `StatusChangePopover.tsx`: shared popover with action prop; all 5 actions route through `onConfirm`; `ReviewActionBar.tsx` confirmed in 22-05-SUMMARY |
| REV-02 | 22-01, 22-07 | Quick-approve from grid; optimistic signal update before PATCH; revert on failure | SATISFIED | `QuickApproveButton.tsx`: mutation at lines 57–63 before `await setShotStatus` at line 69; revert at lines 77–84; Pitfall 5 guard at lines 89–93 |
| REV-03 | 22-02, 22-06, 22-07 | A/B comparison: thumbnails preloaded in parallel before panel mounts; metadata diff displayed | SATISFIED | `ABCompareView.tsx`: `preloadBoth()` uses `Promise.all([preloadOne(a), preloadOne(b)])` with Pitfall 7 fallback; `ReviewTimeline.tsx` Compare CTA flips `compareModalOpen.value = true` |
| REV-04 | 22-01, 22-05 | Empty notes stored as null (not empty string) at both client and server | SATISFIED | `StatusChangePopover.tsx`: `note.trim() === '' ? null : note.trim()`; `dashboard-routes.ts`: `note === null || note === '' ? undefined : note`; engine writes `note ?? null` |
| REV-05 | 22-05, 22-07 | Restore only when status='omit'; writes system note 'Restored from omit'; no textarea for restore action | SATISFIED | 22-05-SUMMARY confirmed `currentStatus === 'omit'` visibility gate in `ReviewActionBar.tsx`; `StatusChangePopover.tsx` lines: D-09 textarea hidden for restore; `RESTORE_NOTE_SYSTEM_TEXT` constant used |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/dashboard/src/components/ShotStatusPill.tsx` | Dual-mode pill containing `aria-haspopup="dialog"` | VERIFIED | 101 lines; `aria-haspopup="dialog"` at line 91; onClick branch/presentational branch both present |
| `packages/dashboard/src/components/QuickApproveButton.tsx` | Hover-only Check icon button + optimistic approval flow; min 60 lines | VERIFIED | 120 lines; full Pattern 3 optimistic flow; exports `QuickApproveButton` and `QuickApproveButtonProps` |
| `packages/dashboard/src/components/ShotGridCard.tsx` | Refactored root `<div class="group">` + 3 sibling buttons | VERIFIED | 163 lines; `class="group relative"` at line 75; 3 sibling button children |
| `packages/dashboard/src/components/ReviewTimeline.tsx` | Extended with compare-mode; contains `compareSelection` reference | VERIFIED | 273 lines; `compareSelection` imported and used for checkbox state; `compareModalOpen.value = true` at line 168 |
| `packages/dashboard/src/__tests__/quick-approve-flow.test.tsx` | Optimistic mutation + revert + WarningPill 5s dismissal integration tests; min 100 lines | VERIFIED | 22-07-SUMMARY reports +216 LOC; 6 tests including fake-timer Pitfall 5 verification |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ShotGridCard.tsx` | `OverlayHost.tsx` `openReviewPanel` | Pill click → `openReviewPanel(shot.id)` | VERIFIED | Line 120: `onClick={() => openReviewPanel(shot.id)}`; imported at line 37 |
| `ShotGridCard.tsx` | `OverlayHost.tsx` `openVersionDrawer` | Thumbnail click → `onSelect(versionId)` | VERIFIED | Line 81: `onClick={() => onSelect(...)`; `openVersionDrawer` imported (silenced via `void openVersionDrawer` line 162) |
| `QuickApproveButton.tsx` → `handleQuickApprove` | `lib/api.ts setShotStatus` + `state/shot-grid.ts shotGrid` + `state/review-panel.ts quickApproveError` | Optimistic mutation before PATCH; revert + error signal on failure | VERIFIED | `shotGrid.value` mutation at line 57; `setShotStatus` call at line 69; `quickApproveError.value = shotId` at line 86 |
| `ReviewTimeline.tsx` | `state/review-panel.ts compareSelection + compareModalOpen` | Compare-mode entry → LRU-2 checkbox → Compare CTA flips `compareModalOpen=true` | VERIFIED | `compareSelection` imported and mutated in `handleCheckboxToggle`; `compareModalOpen.value = true` at line 168 |
| `OverlayHost.tsx` D-02 mutex | Review panel XOR version drawer (never co-mount) | `activeOverlay` discriminator (`'review' | 'version' | null`) | VERIFIED | `OverlayHost.tsx`: single `if/else if` chain; `openVersionDrawer` sets `activeReviewShotId.value = null`; `openReviewPanel` sets `activeOverlay.value = 'review'` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `QuickApproveButton.tsx` | `shotGrid.value.shots[idx].status` | `state/shot-grid.ts` Preact signal; populated via SSE + initial fetch | Yes — signal reflects server state; optimistic mutation writes to it before PATCH | FLOWING |
| `ShotGridCard.tsx` | `quickApproveError.value` | `state/review-panel.ts` Preact signal; written by `QuickApproveButton` on failure | Yes — real error signal from PATCH failure path | FLOWING |
| `ReviewTimeline.tsx` | `compareSelection.value` | `state/review-panel.ts` Preact signal; mutated by `handleCheckboxToggle` | Yes — checkbox interactions write real versionIds from entries prop | FLOWING |
| `ABCompareView.tsx` | `thumbnailA / thumbnailB` state | `preloadBoth()` via `Promise.all([preloadOne(a), preloadOne(b)])`; URLs from `getThumbnailUrl` | Yes — parallel decode of real image URLs; Pitfall 7 fallback on error | FLOWING |

---

### Behavioral Spot-Checks

The phase gate in 22-07-SUMMARY.md constitutes the behavioral evidence for this phase. Direct re-execution deferred to avoid environment-specific dependency on running server.

| Behavior | Evidence Source | Result | Status |
|----------|----------------|--------|--------|
| Server suite (1868 tests) | 22-07-SUMMARY phase gate check #1 | 1868 passed / 21 pre-existing failures | PASS |
| Dashboard suite (443 tests) | 22-07-SUMMARY phase gate check #2 | 443/443 passed | PASS |
| Tool-budget assertion `=== 7` | 22-07-SUMMARY phase gate check #3 | 3/3 tests passed | PASS |
| Architecture-purity (54 tests) | 22-07-SUMMARY phase gate check #4 | 54/54 passed | PASS |
| Append-only grep | 22-07-SUMMARY phase gate check #5 | 0 matches in production code | PASS |
| TypeScript both sides | 22-07-SUMMARY phase gate check #6 | Both `npx tsc --noEmit` exit 0 | PASS |
| Vite build | 22-07-SUMMARY phase gate check #7 | 229ms / 154KB JS / 32KB CSS | PASS |
| copy.ts exports count | 22-07-SUMMARY phase gate check #8 | 118 (≥ 104 floor) | PASS |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `ShotGridCard.tsx` | 159–162 | `void openVersionDrawer;` to silence unused-import warning | Info | Intentional marker for callers; no functional impact. Documented in JSDoc. |

No unreferenced TBD, FIXME, or XXX markers found in Phase 22 files. The JSDoc rephrasing in `state/review-panel.ts` (22-07 fix) eliminated the only architecture-purity grep false-positive; no residue.

---

### Human Verification Required

The following items were explicitly deferred from automated gate to Timothy's UAT per the 22-07-PLAN.md Task 4 manual QA checklist (autonomous-mode execution). All 7 require a live browser with the server running and a populated database.

#### 1. Review Panel Happy Path (Section A)

**Test:** Open any shot card → click status pill → verify review panel slides in → select any action button → verify StatusChangePopover appears anchored to that button → enter a note → click Confirm → verify card pill in grid updates immediately.
**Expected:** Panel mounts without co-mounting the version drawer; popover is visually anchored to button; card pill color changes before server response (optimistic); SSE arrives and pill stays stable.
**Why human:** Popover anchoring position, panel slide animation, and SSE convergence cannot be asserted via grep or unit test.

#### 2. REV-05 Restore from Omit (Section B)

**Test:** Set a shot to 'omit' status via the review panel. Re-open the review panel for that shot. Inspect the action bar for a 5th button labeled "Restore". Confirm no textarea is shown. Click Restore → Confirm → observe status change.
**Expected:** Restore button visible only for omit-status shots; hidden for all other statuses. No textarea rendered. Status transitions to 'wip'. System note 'Restored from omit' persisted (visible in timeline).
**Why human:** Visibility gate is a conditional render that requires the shot to actually be in 'omit' status in the running DB; timeline note persistence requires end-to-end server write.

#### 3. REV-02 Quick-Approve Hover + Offline Failure (Section C)

**Test:** Hover over a shot card → verify Check icon fades in top-right. Click it → verify popover opens. Confirm → verify pill flips to 'approved' instantly. Disconnect network → hover over a different shot → click Check → Confirm → verify WarningPill "Approve failed — retry" appears inside the card. Wait 5 seconds → verify WarningPill auto-dismisses.
**Expected:** Opacity transition visible; optimistic flip instant; failure pill appears and auto-dismisses; retrying after reconnect succeeds and Pitfall 5 guard prevents stale dismiss from overwriting new state.
**Why human:** Hover opacity CSS transition, network interception, and timer behavior require live browser.

#### 4. REV-03 A/B Compare Full Flow (Section D)

**Test:** Open review panel for a shot with ≥2 completed versions. Locate "Compare versions…" button in the timeline header. Click it → verify checkboxes appear on completed version rows only. Check 2 rows → verify Compare CTA enables. Click Compare → verify full-viewport modal opens with BOTH thumbnails visible simultaneously (no skeleton visible after open). Verify MetadataDiff section appears below thumbnails. Press ESC → verify modal closes.
**Expected:** No per-thumbnail skeleton flash (Promise.all parallel preload resolves before modal opens); MetadataDiff renders diff data or empty state; all 3 close paths work (ESC, backdrop, close button).
**Why human:** Visual preload timing (no flash) and modal dimensions require live browser inspection.

#### 5. Multi-Tab SSE Convergence (Section E / D-20)

**Test:** Open the dashboard in two browser tabs. In tab A, approve a shot via the review panel. Observe tab B's grid without refreshing.
**Expected:** Tab B's card pill updates to 'approved' within SSE latency without any page reload. Quick-approve failure in tab A does not affect tab B's `quickApproveError` signal (signals are per-tab).
**Why human:** Multi-tab SSE behavior requires two live browser windows connected to the same server.

#### 6. Reduced Motion (Section F / D-22)

**Test:** Enable "Reduce Motion" in OS accessibility settings. Open the dashboard. Hover over shot cards, open the A/B modal, approve a shot.
**Expected:** Modal backdrop fade is absent (motion-safe: classes inactive); card hover transitions suppressed; status pill hover brightness transition absent; WarningPill transitions suppressed.
**Why human:** Requires OS-level accessibility setting change and live browser CSS inspection.

#### 7. Keyboard Accessibility (Section G)

**Test:** Use Tab key to navigate shot cards. Verify order: (1) thumbnail button → (2) ShotStatusPill button → (3) QuickApproveButton becomes visible via `:focus-within` on the group div. Press Enter on pill → review panel opens with focus trapped inside. Press Enter on Check icon → StatusChangePopover opens with focus on confirm/cancel. Press Shift+Tab from popover → verify focus returns to anchor button on Cancel.
**Expected:** QuickApproveButton is reachable via keyboard through group-focus-within visibility; both overlays (panel, popover) trap focus; focus returns to trigger element on dismiss.
**Why human:** Focus order, trap, and return disciplines require live keyboard navigation in a browser.

---

### Gaps Summary

No automated gaps found. All 17 observable truths verified against codebase artifacts. All 5 REV requirements (REV-01 through REV-05) satisfied. All 8 phase gate checks documented as passing in 22-07-SUMMARY.md.

The 7 manual browser smoke items (sections A–G) are the only open items. These are deferred human verification items, not gaps in the implementation.

**Key invariants confirmed:**

- **D-02 mutex:** OverlayHost branches exclusively on `activeOverlay` discriminator; `openVersionDrawer` clears `activeReviewShotId` before switching overlay; review panel and version drawer cannot co-mount.
- **D-05/D-08:** StatusChangePopover is the single confirmation gate for all 5 review actions; no bare one-click status changes exist anywhere in the codebase.
- **REV-02 optimistic flow:** `shotGrid.value` mutated at line 57 of QuickApproveButton.tsx; `await setShotStatus(...)` appears at line 69 — mutation provably precedes the network call.
- **REV-03 parallel preload:** `Promise.all([preloadOne(a), preloadOne(b)])` in ABCompareView.tsx; Pitfall 7 fallback wires both `.onload` and `.onerror`.
- **REV-04 null-when-blank:** Both client trim (`'' → null`) and server coerce (`'' → undefined`) verified in source.
- **REV-05 Restore gate:** Visibility conditional on `currentStatus === 'omit'`; system note `RESTORE_NOTE_SYSTEM_TEXT` used; textarea hidden for restore action.
- **Tool count:** `=== 7` assertion holds (D-21 phase gate 3/3 green).
- **Architecture-purity:** 54/54 purity tests pass; `dashboard-routes.ts` confirmed zero MCP SDK imports.
- **Append-only invariant:** Zero `UPDATE shot_status_events` matches in production code.

---

_Verified: 2026-05-15T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
