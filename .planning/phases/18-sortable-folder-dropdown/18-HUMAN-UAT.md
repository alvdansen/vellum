---
status: partial
phase: 18-sortable-folder-dropdown
source: [18-VERIFICATION.md]
started: 2026-05-08
updated: 2026-05-08
---

## Current Test

[awaiting human testing]

## Tests

### 1. Visual fidelity of SortDropdown across themes
expected: Dark/light themes render dropdown with correct contrast + focus rings; option list aligns with trigger; chevron rotates on open.
result: [pending]

### 2. Keyboard navigation through SortDropdown
expected: Tab focuses trigger; Enter/Space opens; Arrow Up/Down moves selection; Enter commits; Escape closes without commit; matches WAI-ARIA APG combobox spec.
result: [pending]

### 3. URL share-link round-trip
expected: Copy URL with ?gridSort=&treeSort=; paste in fresh tab; observe identical sort state on hydrate (URL → localStorage → defaults reconciliation).
result: [pending]

### 4. In-progress band visual
expected: When versions have NULL completed_at (queued/running), they appear in their own band at the top regardless of sort direction (D-01 NULL-pin).
result: [pending]

### 5. "Load more" perceived latency
expected: On real database with 100+ versions, LoadMoreButton click feels responsive (<200ms perceived); loading state shows during fetch; "(M remaining)" caption updates correctly.
result: [pending]

### 6. Tree re-sort propagation
expected: Toggle treeSort dropdown; sort applies across all 4 hierarchy levels (workspace → project → sequence → shot) in real time without page reload (D-09 single tree-wide sort).
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
