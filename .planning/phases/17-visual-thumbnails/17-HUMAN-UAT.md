---
status: partial
phase: 17-visual-thumbnails
source: [17-VERIFICATION.md]
started: 2026-05-01T22:35:00Z
updated: 2026-05-01T22:35:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Thumbnails on completed VersionCards
expected: Each VersionCard in the right pane displays a 16:9 thumbnail (the rendered output as a small WebP) without manual clicking; CLS is zero on initial paint.
result: [pending]

### 2. Skeleton shimmer for queued/running versions
expected: While a version is queued/running, `<SkeletonThumbnail/>` renders with a shimmer animation; `aria-busy='true'` is announced by screen readers; no broken-image icon ever appears.
result: [pending]

### 3. Thumbnail click bubbles to VersionDrawer
expected: Clicking a rendered thumbnail in VersionCard opens VersionDrawer (existing onSelect wiring); full-size /output viewing remains accessible from within the drawer.
result: [pending]

### 4. MP4 first-frame extraction
expected: When generating a video (MP4) version, the resulting thumbnail shows the first representative frame (NOT a black frame from the fade-in); brightness fallback engages if the first frame is dark.
result: [pending]

### 5. C2PA shield overlay on signed versions
expected: On a signed version (Phase 14 manifest_signed event present), the CR mark shield appears at bottom-right with proper drop-shadow halo on bright thumbnails; shield does NOT appear on unsigned/unknown/undefined c2paStatus.
result: [pending]

### 6. TreeSidebar shot-row thumbnail (depth=3 only)
expected: Latest completed version's thumbnail surfaces at 80×45 px in `size='sm'` variant on the selected shot's row; SkeletonThumbnail fallback on unselected shots; sequence/project/workspace rows stay text-only.
result: [pending]

### 7. Redact-cache-invalidate-revalidate cycle
expected: After triggering a Phase 16 redact event on a signed version, the cached thumbnail invalidates on disk; next render derives a fresh WebP; ETag advances; browser revalidates and shows updated bytes (no stale thumbnail surfaces).
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
