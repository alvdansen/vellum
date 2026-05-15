---
status: partial
phase: 22-review-and-approval
source: [22-VERIFICATION.md]
started: 2026-05-15T00:00:00Z
updated: 2026-05-15T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Review panel happy path
expected: Click status pill on any shot → review panel slides in → select Approve action → StatusChangePopover appears anchored to button → enter note → Confirm → card pill flips to 'approved' optimistically → panel SSE update arrives and converges idempotently
result: [pending]

### 2. REV-05 Restore from omit
expected: Shot with status='omit' shows 5th Restore button in review panel action bar; textarea is hidden (D-09); Confirm → status changes to 'wip'; system note 'Restored from omit' persisted; for all other statuses, Restore button is absent
result: [pending]

### 3. REV-02 quick-approve hover affordance and optimistic flip
expected: Hover over shot card → Check icon appears top-right; click → StatusChangePopover opens anchored to button → Confirm → card pill flips to 'approved' instantly before server responds; simulate offline → WarningPill 'Approve failed — retry' appears inside card; auto-dismisses after 5s
result: [pending]

### 4. REV-03 A/B compare full flow
expected: Open review panel for shot with >=2 completed versions → 'Compare versions…' button visible in timeline → click → checkboxes appear on completed version rows → select 2 → 'Compare' CTA enables → click → full-viewport modal opens with both thumbnails preloaded (no skeleton flash) → MetadataDiff section renders below → ESC closes modal
result: [pending]

### 5. Multi-tab SSE convergence (D-20)
expected: Approve a shot in tab A → tab B's grid card status pill updates without refresh; quick-approve failure in tab A does not corrupt tab B's signal state
result: [pending]

### 6. Reduced motion (D-22)
expected: With OS 'Reduce Motion' enabled — modal backdrop fade is absent (motion-safe: classes inactive); status pill hover brightness transition is absent; WarningPill and card transitions are suppressed
result: [pending]

### 7. Keyboard accessibility
expected: Tab through shot card — (1) thumbnail button → (2) ShotStatusPill button → (3) QuickApproveButton (visible via :focus-within on group div); Enter on pill → review panel opens with focus trapped; Enter on Check → popover opens with focus trapped; Enter on version row in review panel → version drawer opens; Shift+Tab returns focus to anchor on popover Cancel
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
