# Phase 22: Review and Approval — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 28 (15 new + 13 modified)
**Analogs found:** 28 / 28 (100% coverage — every new file has at least one strong analog in the existing codebase)

This phase is the textbook case of "compose, don't extend." Every backend hook exists, every UI primitive exists, and the work is structural composition. Pattern extraction is high-fidelity because the precedents are concrete and recent (Phases 17–21).

---

## File Classification

### New files

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/dashboard/src/views/ReviewPanel.tsx` | view | request-response | `packages/dashboard/src/views/VersionDrawer.tsx` | exact (same 560px right-rail aside contract) |
| `packages/dashboard/src/views/ABCompareView.tsx` | view (modal) | request-response | `packages/dashboard/src/views/DiffDrawer.tsx` | role-match (pure presentation, side-by-side, but new modal mechanics) |
| `packages/dashboard/src/views/ABCompareHost.tsx` | view (mount host) | event-driven | `packages/dashboard/src/views/VersionDrawerHost.tsx` | exact (signal-gated mount of a single child component) |
| `packages/dashboard/src/views/OverlayHost.tsx` | view (mount host) | event-driven | `packages/dashboard/src/views/VersionDrawerHost.tsx` | exact (extends host pattern with discriminator branching) |
| `packages/dashboard/src/components/StatusChangePopover.tsx` | component | event-driven | `packages/dashboard/src/components/SortDropdown.tsx` | role-match (popover mechanics — outside-click + ESC + focus-return — adapted from listbox to dialog) |
| `packages/dashboard/src/components/MetadataDiff.tsx` | component | pure presentation | `packages/dashboard/src/views/DiffDrawer.tsx` lines 101-108 | exact (extracts the existing summary `<section>` plus extends with `changes[]`) |
| `packages/dashboard/src/components/QuickApproveButton.tsx` | component | event-driven | `packages/dashboard/src/components/RegenerateButton.tsx` | role-match (icon-only button, accent fill, disabled state) |
| `packages/dashboard/src/components/ReviewActionBar.tsx` | component | event-driven | `packages/dashboard/src/components/ShotGridFilterBar.tsx` + `VersionDrawer.tsx:324-340` button row | role-match (sticky button-row with conditional rendering) |
| `packages/dashboard/src/components/ReviewActionButton.tsx` | component | event-driven | `packages/dashboard/src/components/RegenerateButton.tsx` | exact (3-state mutating button with aria-busy + disabled discipline) |
| `packages/dashboard/src/components/ReviewTimeline.tsx` | component | pure presentation | `packages/dashboard/src/views/VersionDrawer.tsx:447-466` Timeline `<section>` | role-match (chronological feed; new file extends to handle discriminated union rows) |
| `packages/dashboard/src/components/ReviewPanelHeader.tsx` | component | pure presentation | `packages/dashboard/src/views/VersionDrawer.tsx:305-341` header | exact (header + title + pill + close button) |
| `packages/dashboard/src/state/review-panel.ts` | state (signal file) | event-driven | `packages/dashboard/src/state/shot-grid.ts` | exact (per-view-domain signal bag, module-singleton exports) |
| `packages/dashboard/src/types/review-panel.ts` | types | n/a | `packages/dashboard/src/types/shot-grid.ts` | exact (snake_case wire shapes + dashboard-local mirror) |
| `packages/dashboard/src/__tests__/quick-approve-flow.test.tsx` | test (integration) | event-driven | `packages/dashboard/src/__tests__/sse-signal-integration.test.tsx` | exact (full SSE → signal → render chain integration) |
| `packages/dashboard/src/__tests__/review-panel-sse-integration.test.tsx` | test (integration) | event-driven | `packages/dashboard/src/__tests__/sse-signal-integration.test.tsx` | exact (MockEventSource + state mutation through render) |
| `packages/dashboard/src/views/__tests__/ReviewPanel.test.tsx` | test | n/a | `packages/dashboard/src/views/__tests__/VersionDrawerHost.test.tsx` | exact (view test with module-singleton signal reset + api module mock) |
| `packages/dashboard/src/views/__tests__/ABCompareView.test.tsx` | test | n/a | `packages/dashboard/src/views/__tests__/VersionDrawer.test.tsx` | exact |
| `packages/dashboard/src/views/__tests__/OverlayHost.test.tsx` | test | n/a | `packages/dashboard/src/views/__tests__/VersionDrawerHost.test.tsx` | exact |
| `packages/dashboard/src/components/__tests__/StatusChangePopover.test.tsx` | test | n/a | `packages/dashboard/src/__tests__/SortDropdown.test.tsx` | exact (popover mechanics: open/close/keyboard) |
| `packages/dashboard/src/components/__tests__/ReviewActionBar.test.tsx` | test | n/a | `packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx` + RegenerateButton.test.tsx | role-match |
| `packages/dashboard/src/components/__tests__/MetadataDiff.test.tsx` | test | n/a | `packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx` | role-match (pure presentational test) |
| `packages/dashboard/src/components/__tests__/QuickApproveButton.test.tsx` | test | n/a | `packages/dashboard/src/components/__tests__/RegenerateButton.test.tsx` | exact |
| `src/__tests__/dashboard-routes-set-status.test.ts` | test (HTTP) | request-response | `src/__tests__/dashboard-routes-sort.test.ts` | exact (in-memory Engine + Hono request) |
| `src/__tests__/dashboard-routes-diff-ab.test.ts` | test (HTTP) | request-response | `src/__tests__/dashboard-routes-sort.test.ts` | exact |
| `src/__tests__/dashboard-routes-status-history.test.ts` | test (HTTP) | request-response | `src/__tests__/dashboard-routes-sort.test.ts` | exact |

### Modified files

| Modified File | Role | Change Type | Closest Analog (for the new pattern) | Match Quality |
|---------------|------|-------------|--------------------------------------|---------------|
| `packages/dashboard/src/components/ShotGridCard.tsx` | component | structural refactor (button → div + 3 sibling buttons) | self (current single-button form at lines 64-110) + Phase 22 D-13 | self-refactor |
| `packages/dashboard/src/components/ShotStatusPill.tsx` | component | add optional `onClick` prop (presentational → dual-mode) | self (current presentational form) | self-refactor |
| `packages/dashboard/src/views/DiffDrawer.tsx` | view | extract inline summary into `<MetadataDiff/>` | self (lines 101-108) | self-refactor |
| `packages/dashboard/src/App.tsx` | root | swap `<VersionDrawerHost/>` mount for `<OverlayHost/>` + add `<ABCompareHost/>` sibling | self (line 143) | minimal change |
| `packages/dashboard/src/lib/api.ts` | api | add 3 new fetch helpers | self (existing `diffVersion`, `getThumbnailUrl`, `reproduceVersion` patterns) | exact |
| `packages/dashboard/src/lib/copy.ts` | copy | append ~50 new constants | self (Phase 21 block at lines 187-298) | exact |
| `packages/dashboard/src/types/shot-grid.ts` | types | (no change — `ShotStatus` already exists) | n/a | unchanged |
| `packages/dashboard/src/state/shot-grid.ts` | state | (no change — verified `onShotStatusChanged` stays put per RESEARCH A7) | n/a | unchanged |
| `packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` | test | extend with D-13 assertions (3 sibling buttons + click delegation) | self | self-refactor |
| `packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx` | test | extend with button-mode assertions (presentational + onClick branches) | self | self-refactor |
| `src/http/dashboard-routes.ts` | http | add 3 routes (PATCH /api/shots/:id/status, GET /api/versions/:a/diff-with/:b, GET /api/shots/:id/status-history) | self (existing route patterns at lines 282-392 + Zod whitelist parsers at lines 175-219) | exact |
| `packages/dashboard/src/styles/theme.css` | css | (NO change per UI-SPEC §"Design System" — zero new design tokens; reuses `--drawer-version-width` + existing accent/surface tokens) | n/a | unchanged |

---

## Pattern Assignments

### 1. `packages/dashboard/src/views/ReviewPanel.tsx` (view, request-response)

**Analog:** `packages/dashboard/src/views/VersionDrawer.tsx`

**Imports pattern** (VersionDrawer.tsx lines 24-52):
```typescript
import { useState, useEffect, useRef } from 'preact/hooks';
import { ShotStatusPill } from '../components/ShotStatusPill.js';
import { EmptyState } from '../components/EmptyState.js';
import {
  fetchShotStatusHistory,
  setShotStatus,
} from '../lib/api.js';
import {
  REVIEW_PANEL_TITLE_PREFIX,
  REVIEW_PANEL_CLOSE_ARIA,
  REVIEW_SECTION_ACTIONS,
  REVIEW_SECTION_HISTORY,
  REVIEW_HISTORY_EMPTY,
} from '../lib/copy.js';
import type { ShotGridRow } from '../types/shot-grid.js';
import type { ShotStatusEvent, ShotHistoryEntry } from '../types/review-panel.js';
```

> **Convention:** every import targets dashboard-local modules. Zero `../../src/*` traversals (D-WEBUI-31). All copy strings flow from `lib/copy.ts` named exports — no inline literals.

**Aside container pattern** (VersionDrawer.tsx lines 299-304):
```typescript
<aside
  class="fixed inset-y-0 right-0 z-10 flex flex-col gap-4 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-xl"
  style={{ width: 'var(--drawer-version-width)' }}
  role="dialog"
  aria-label={`Review panel for ${shotName}`}
>
```

> **Copy verbatim:** `fixed inset-y-0 right-0`, `z-10`, `border-l`, `shadow-xl`, `style={{ width: 'var(--drawer-version-width)' }}` (the 560px token already exists in theme.css). `role="dialog"` + `aria-label` composed via `${REVIEW_PANEL_ARIA_LABEL_PREFIX}${shotName}`.

**Header pattern** (VersionDrawer.tsx lines 305-341, adapt for review panel):
```typescript
<header class="flex items-center justify-between gap-2">
  <div class="flex items-center gap-2">
    <h2
      class="text-base font-semibold text-[var(--color-fg)]"
      style={{ fontFamily: 'var(--font-display)' }}
    >
      {REVIEW_PANEL_TITLE_PREFIX}{shotName}
    </h2>
    <ShotStatusPill status={currentStatus} /> {/* presentational mode — no onClick */}
  </div>
  <button
    type="button"
    onClick={onClose}
    aria-label={REVIEW_PANEL_CLOSE_ARIA}
    class="inline-flex items-center justify-center rounded p-1 text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
  >
    ×
  </button>
</header>
```

> Use `×` U+00D7 verbatim (matches VersionDrawer.tsx:338 close-button literal). UI-SPEC alternatively allows `<X size={16}/>` from `lucide-preact` (Claude-selected per autonomous mode at UI-SPEC L60); pick one and stay consistent across review-panel/modal close buttons.

**Section heading pattern** (VersionDrawer.tsx lines 355, 380, 417, 448):
```typescript
<h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">
  {REVIEW_SECTION_ACTIONS}
</h3>
```

> `label-uppercase` is a Tailwind v4 utility class declared in `theme.css` (verified at VersionDrawer.tsx:355). Always pair with `mb-2` and `text-[var(--color-fg-muted)]`.

**Composition skeleton:**
```typescript
export interface ReviewPanelProps {
  shotId: string;
  shotName: string;
  currentStatus: ShotStatus;
  versions: Version[];                  // for timeline merger
  statusHistory: ShotStatusEvent[];     // for timeline merger
  onClose: () => void;
}

export function ReviewPanel({ shotId, shotName, currentStatus, versions, statusHistory, onClose }: ReviewPanelProps) {
  return (
    <aside class="..." role="dialog" aria-label={`${REVIEW_PANEL_ARIA_LABEL_PREFIX}${shotName}`}>
      <ReviewPanelHeader shotName={shotName} currentStatus={currentStatus} onClose={onClose} />
      <ReviewActionBar shotId={shotId} currentStatus={currentStatus} />
      <ReviewTimeline shotId={shotId} entries={mergeHistory(versions, statusHistory)} />
    </aside>
  );
}
```

---

### 2. `packages/dashboard/src/views/ABCompareView.tsx` (view, modal)

**Analog:** `packages/dashboard/src/views/DiffDrawer.tsx` (for the side-by-side grid pattern) + new modal mechanics (no existing modal precedent in codebase).

**Side-by-side grid pattern** (DiffDrawer.tsx lines 70-99 — adapt for thumbnails):
```typescript
<div class="grid grid-cols-2 gap-4">
  <section>
    <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">v{versionA.version_number}</h3>
    {preloadState === 'ready' ? (
      <Thumbnail version={{ id: versionAId, label: `v${versionA.version_number}`, status: 'complete' }} size="card" />
    ) : (
      <SkeletonThumbnail width={640} height={360} />
    )}
  </section>
  <section>
    <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">v{versionB.version_number}</h3>
    {preloadState === 'ready' ? (
      <Thumbnail version={{ id: versionBId, label: `v${versionB.version_number}`, status: 'complete' }} size="card" />
    ) : (
      <SkeletonThumbnail width={640} height={360} />
    )}
  </section>
</div>
```

**Modal backdrop + focus-trap (NEW pattern — no existing precedent):**
```typescript
useEffect(() => {
  // Focus-trap: move focus to close button on mount; trap Tab cycle
  closeBtnRef.current?.focus();

  function onDocKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }
  document.addEventListener('keydown', onDocKeyDown);
  return () => document.removeEventListener('keydown', onDocKeyDown);
}, [onClose]);

return (
  <div
    class="fixed inset-0 z-30 flex items-center justify-center bg-black/60"
    onClick={(e) => {
      if (e.target === e.currentTarget) onClose(); // backdrop click closes
    }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      class="relative flex flex-col gap-6 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-2xl"
      style={{
        width: 'min(1200px, calc(100vw - 96px))',
        maxHeight: 'calc(100vh - 96px)',
        overflowY: 'auto',
      }}
    >
      <header class="flex items-center justify-between">
        <h2 id={titleId} class="text-base font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
          {COMPARE_MODAL_TITLE_PREFIX}v{versionA.version_number}{COMPARE_MODAL_TITLE_INFIX}v{versionB.version_number}
        </h2>
        <button ref={closeBtnRef} type="button" onClick={onClose} aria-label={COMPARE_MODAL_CLOSE_ARIA}>
          <X size={16} />
        </button>
      </header>
      {/* side-by-side grid (above) + <MetadataDiff/> below */}
    </div>
  </div>
);
```

**Preload pattern (RESEARCH Pattern 5, lines 558-590):**
```typescript
useEffect(() => {
  let alive = true;
  setPreloadState('loading');
  preloadBoth(versionAId, versionBId)
    .then(() => { if (alive) setPreloadState('ready'); })
    .catch(() => { if (alive) setPreloadState('error'); });
  return () => { alive = false; };
}, [versionAId, versionBId]);

function preloadBoth(a: string, b: string): Promise<void> {
  function preloadOne(url: string): Promise<void> {
    const img = new Image();
    img.src = url;
    return img.decode().catch(() => new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
    }));
  }
  return Promise.all([
    preloadOne(getThumbnailUrl(a)),
    preloadOne(getThumbnailUrl(b)),
  ]).then(() => undefined);
}
```

> **Pitfall 7 mitigation:** `.onload` AND `.onerror` both wired; the inner `new Promise` resolves on load, rejects on error. Otherwise a 404 thumbnail leaves the skeleton spinning forever.

---

### 3. `packages/dashboard/src/views/OverlayHost.tsx` (view, mount host)

**Analog:** `packages/dashboard/src/views/VersionDrawerHost.tsx` (exact)

**Imports pattern** (VersionDrawerHost.tsx lines 43-47):
```typescript
import { useEffect, useState } from 'preact/hooks';
import { fetchVersion } from '../lib/api.js';
import { selectedVersionId, versions } from '../state/versions.js';
import { activeOverlay, activeReviewShotId } from '../state/review-panel.js';
import { shotGrid } from '../state/shot-grid.js';
import type { Version } from '../types/entities.js';
import { VersionDrawer } from './VersionDrawer.js';
import { ReviewPanel } from './ReviewPanel.js';
```

**Discriminator branching pattern (RESEARCH Pattern 4, lines 496-549):**
```typescript
export function OverlayHost() {
  const overlay = activeOverlay.value;

  if (overlay === null) {
    // Backward compat: legacy callers might still write to selectedVersionId
    // directly without flipping activeOverlay. Fall back to version drawer.
    if (selectedVersionId.value !== null) {
      return <VersionDrawerHostInternal />;
    }
    return null;
  }

  if (overlay === 'review') {
    const shotId = activeReviewShotId.value;
    if (shotId === null) {
      console.warn('OverlayHost: activeOverlay=review but activeReviewShotId is null');
      return null;
    }
    return <ReviewPanelHostInternal shotId={shotId} />;
  }

  if (overlay === 'version') {
    if (selectedVersionId.value === null) {
      console.warn('OverlayHost: activeOverlay=version but selectedVersionId is null');
      return null;
    }
    return <VersionDrawerHostInternal />;
  }

  return null;
}

// Helpers to keep mutex invariant in one place
export function openVersionDrawer(versionId: string) {
  selectedVersionId.value = versionId;
  activeOverlay.value = 'version';
  activeReviewShotId.value = null;
}

export function openReviewPanel(shotId: string) {
  activeReviewShotId.value = shotId;
  activeOverlay.value = 'review';
}

export function closeOverlay() {
  activeOverlay.value = null;
  selectedVersionId.value = null;
  activeReviewShotId.value = null;
}
```

**Cache-miss fetch effect pattern** (VersionDrawerHost.tsx lines 93-119):
```typescript
useEffect(() => {
  if (!currentId) return;
  if (cached) return;
  if (fetched[currentId]) return;
  let alive = true;
  fetchVersion(currentId)
    .then((v) => {
      if (!alive) return;
      setFetched((prev) => ({ ...prev, [v.id]: v }));
    })
    .catch((err) => {
      if (!alive) return;
      console.warn('vfx-familiar: fetchVersion failed; clearing selection.', err);
      selectedVersionId.value = null;
    });
  return () => { alive = false; };
}, [currentId, cached, fetched]);
```

> Use this exact `let alive = true` + cleanup pattern for the ReviewPanel host's status-history fetch.

---

### 4. `packages/dashboard/src/components/StatusChangePopover.tsx` (component, event-driven)

**Analog:** `packages/dashboard/src/components/SortDropdown.tsx` (role-match — popover mechanics, different content)

**Imports pattern** (SortDropdown.tsx lines 54-57):
```typescript
import { useState, useRef, useEffect, useId } from 'preact/hooks';
import type { JSX, RefObject } from 'preact';
import {
  REVIEW_APPROVE_PROMPT, REVIEW_RETAKE_PROMPT, REVIEW_HOLD_PROMPT,
  REVIEW_OMIT_PROMPT, REVIEW_RESTORE_PROMPT,
  POPOVER_CANCEL_LABEL, POPOVER_CONFIRM_LABEL, POPOVER_CONFIRM_PENDING,
  POPOVER_NOTE_PLACEHOLDER, POPOVER_NOTE_LABEL,
  POPOVER_DIALOG_ARIA_LABEL_PREFIX,
  RESTORE_NOTE_SYSTEM_TEXT,
} from '../lib/copy.js';
import type { ReviewAction } from '../types/review-panel.js';
```

**Outside-click handler pattern (SortDropdown.tsx lines 155-171):**
```typescript
// Outside-click — mousedown (NOT click) so close happens BEFORE focusin
// from new target. ONLY attached while open. Cleanup unregisters.
useEffect(() => {
  if (!isOpen) return;
  function onDocMouseDown(e: MouseEvent): void {
    const t = e.target as Node;
    if (
      !popoverRef.current?.contains(t) &&
      !anchorRef.current?.contains(t)
    ) {
      anchorRef.current?.focus();  // return focus to trigger BEFORE close
      onCancel();
    }
  }
  document.addEventListener('mousedown', onDocMouseDown);
  return () => document.removeEventListener('mousedown', onDocMouseDown);
}, [isOpen, anchorRef, onCancel]);
```

**Focus return on ESC pattern (SortDropdown.tsx lines 144-147, 181-184):**
```typescript
function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>) {
  if (e.key === 'Escape') {
    e.preventDefault();
    anchorRef.current?.focus();
    onCancel();
  }
}
```

**Confirm-with-pending pattern (RESEARCH Pattern 2, lines 384-432; merges with RegenerateButton pattern):**
```typescript
const PROMPT_FOR: Record<ReviewAction, string> = {
  approve: REVIEW_APPROVE_PROMPT,
  retake: REVIEW_RETAKE_PROMPT,
  hold: REVIEW_HOLD_PROMPT,
  omit: REVIEW_OMIT_PROMPT,
  restore: REVIEW_RESTORE_PROMPT,
};

async function handleConfirm() {
  setPending(true);
  const finalNote = action === 'restore'
    ? RESTORE_NOTE_SYSTEM_TEXT
    : (note.trim() === '' ? null : note.trim());
  try {
    await onConfirm(finalNote);
  } finally {
    setPending(false);
  }
}
```

**Dialog markup (non-modal — outside-click cancels):**
```typescript
if (!isOpen) return null;
const promptId = useId();

return (
  <div
    ref={popoverRef}
    role="dialog"
    aria-modal="false"
    aria-labelledby={promptId}
    onKeyDown={onKeyDown}
    class="absolute z-20 mt-2 min-w-[280px] max-w-[360px] rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg"
  >
    <p id={promptId} class="text-sm mb-2">{PROMPT_FOR[action]}</p>
    {action !== 'restore' && (
      <textarea
        ref={textareaRef}
        value={note}
        onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        rows={3}
        placeholder={POPOVER_NOTE_PLACEHOLDER}
        aria-label={POPOVER_NOTE_LABEL}
        class="block w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-2 text-sm text-[var(--color-fg)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      />
    )}
    <div class="mt-3 flex justify-end gap-1">
      <button data-cancel type="button" onClick={onCancel} disabled={pending}>
        {POPOVER_CANCEL_LABEL}
      </button>
      <button
        type="button"
        onClick={handleConfirm}
        disabled={pending}
        aria-busy={pending}
        class="rounded bg-[var(--color-accent)] px-2 py-1 text-xs font-normal text-[var(--color-bg)] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50"
      >
        {pending ? POPOVER_CONFIRM_PENDING : POPOVER_CONFIRM_LABEL}
      </button>
    </div>
  </div>
);
```

> **Pitfall 9 mitigation:** NEVER wrap in `<form>`; Enter inside textarea must insert a newline, not submit. Use `type="button"` on Cancel + Confirm and explicit `onClick`.

---

### 5. `packages/dashboard/src/components/MetadataDiff.tsx` (component, pure presentation)

**Analog:** `packages/dashboard/src/views/DiffDrawer.tsx` lines 101-108 (exact — extract)

**Existing inline pattern to extract** (DiffDrawer.tsx lines 101-108):
```typescript
{diff ? (
  <section>
    <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">Summary</h3>
    <p class="rounded bg-[var(--color-surface-alt)] p-3 text-sm text-[var(--color-fg)]">
      {diff.summary}
    </p>
  </section>
) : null}
```

**New extracted component contract (with changes extension):**
```typescript
import { COMPARE_MODAL_DIFF_EMPTY, COMPARE_MODAL_SECTION_METADATA } from '../lib/copy.js';

export interface DiffChanges {
  params?: Array<{ key: string; before: unknown; after: unknown }>;
  models?: Array<{ name: string; before: string; after: string }>;
  seed?: { before: number; after: number };
  workflow?: { changed: boolean };
  metadata?: Array<{ key: string; before: unknown; after: unknown }>;
}

export interface MetadataDiffProps {
  summary: string;
  changes?: DiffChanges;
}

export function MetadataDiff({ summary, changes }: MetadataDiffProps) {
  const hasChanges = changes !== undefined &&
    (changes.params?.length || changes.models?.length || changes.seed || changes.workflow?.changed || changes.metadata?.length);

  return (
    <section>
      <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">{COMPARE_MODAL_SECTION_METADATA}</h3>
      <p class="rounded bg-[var(--color-surface-alt)] p-3 text-sm text-[var(--color-fg)]">
        {summary}
      </p>
      {hasChanges ? (
        <ul class="mt-3 flex flex-col gap-2">
          {/* render changes.params / changes.models / changes.seed / etc as detail rows */}
        </ul>
      ) : (
        <p class="mt-3 text-sm text-[var(--color-fg-muted)]">{COMPARE_MODAL_DIFF_EMPTY}</p>
      )}
    </section>
  );
}
```

> **DiffDrawer refactor:** replace lines 101-108 with `<MetadataDiff summary={diff.summary} />` (no `changes` prop because current DiffDrawer doesn't surface them — backward compatibility preserved per RESEARCH Assumption A2).

---

### 6. `packages/dashboard/src/components/QuickApproveButton.tsx` (component, event-driven)

**Analog:** `packages/dashboard/src/components/RegenerateButton.tsx` (role-match — icon-only button with state)

**Imports pattern:**
```typescript
import { useRef, useState } from 'preact/hooks';
import { Check } from 'lucide-preact';
import { setShotStatus } from '../lib/api.js';
import { shotGrid } from '../state/shot-grid.js';
import { StatusChangePopover } from './StatusChangePopover.js';
import { REVIEW_QUICK_APPROVE_ARIA_PREFIX } from '../lib/copy.js';
import type { ShotStatus } from '../types/shot-grid.js';
```

**Hover-reveal pattern (D-10 LOCKED — group-hover Tailwind utility):**
```typescript
export interface QuickApproveButtonProps {
  shotId: string;
  shotName: string;
  currentStatus: ShotStatus;
}

export function QuickApproveButton({ shotId, shotName, currentStatus }: QuickApproveButtonProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`${REVIEW_QUICK_APPROVE_ARIA_PREFIX}${shotName}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        class="absolute top-1 right-1 z-1 inline-flex h-6 w-6 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] hover:bg-[var(--color-shot-status-approved)] hover:text-[var(--color-bg)]"
      >
        <Check size={16} />
      </button>
      <StatusChangePopover
        action="approve"
        anchorRef={anchorRef}
        isOpen={isOpen}
        onConfirm={async (note) => {
          await handleQuickApprove(shotId, currentStatus, note);
          setIsOpen(false);
        }}
        onCancel={() => setIsOpen(false)}
      />
    </>
  );
}
```

> The parent `ShotGridCard` outer `<div>` MUST add `class="group"` so the `group-hover:opacity-100` selector reveals the button. Tailwind v4 generates `group-hover:` variants directly — no config file.

---

### 7. `packages/dashboard/src/components/ReviewActionButton.tsx` (component, event-driven)

**Analog:** `packages/dashboard/src/components/RegenerateButton.tsx` (exact — 3-state mutating button)

**Match all RegenerateButton conventions verbatim:**

```typescript
import {
  REVIEW_ACTION_APPROVE_LABEL, REVIEW_ACTION_APPROVE_PENDING,
  REVIEW_ACTION_RETAKE_LABEL, REVIEW_ACTION_RETAKE_PENDING,
  REVIEW_ACTION_HOLD_LABEL, REVIEW_ACTION_HOLD_PENDING,
  REVIEW_ACTION_OMIT_LABEL, REVIEW_ACTION_OMIT_PENDING,
  REVIEW_ACTION_RESTORE_LABEL, REVIEW_ACTION_RESTORE_PENDING,
} from '../lib/copy.js';
import type { ReviewAction } from '../types/review-panel.js';

const LABELS: Record<ReviewAction, { default: string; pending: string }> = {
  approve: { default: REVIEW_ACTION_APPROVE_LABEL, pending: REVIEW_ACTION_APPROVE_PENDING },
  retake:  { default: REVIEW_ACTION_RETAKE_LABEL,  pending: REVIEW_ACTION_RETAKE_PENDING  },
  hold:    { default: REVIEW_ACTION_HOLD_LABEL,    pending: REVIEW_ACTION_HOLD_PENDING    },
  omit:    { default: REVIEW_ACTION_OMIT_LABEL,    pending: REVIEW_ACTION_OMIT_PENDING    },
  restore: { default: REVIEW_ACTION_RESTORE_LABEL, pending: REVIEW_ACTION_RESTORE_PENDING },
};

export interface ReviewActionButtonProps {
  action: ReviewAction;
  ariaLabel: string;
  disabled: boolean;
  isPending: boolean;
  popoverIsOpen: boolean;
  onClick: () => void;
}

export function ReviewActionButton({ action, ariaLabel, disabled, isPending, popoverIsOpen, onClick }: ReviewActionButtonProps) {
  const isDisabled = disabled || isPending;
  return (
    <button
      type="button"
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={isPending ? 'true' : 'false'}
      aria-haspopup="dialog"
      aria-expanded={popoverIsOpen}
      aria-label={ariaLabel}
      class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-sm font-normal text-[var(--color-fg)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-colors"
    >
      {isPending ? LABELS[action].pending : LABELS[action].default}
    </button>
  );
}
```

> Mirror `RegenerateButton.tsx:107-119` button-attribute structure verbatim (`type`, `disabled`, `aria-busy`, `onClick={isDisabled ? undefined : onClick}`).

---

### 8. `packages/dashboard/src/components/ReviewActionBar.tsx` (component, event-driven)

**Analog:** Composition of `ReviewActionButton` instances + `<ShotGridFilterBar/>` flex-wrap row pattern.

**Layout pattern (UI-SPEC §"Responsive Behavior" lines 661-671):**
```typescript
<div class="sticky top-0 z-1 flex flex-wrap gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] py-2">
  <ReviewActionButton action="approve" ... />
  <ReviewActionButton action="retake" ... />
  <ReviewActionButton action="hold" ... />
  <ReviewActionButton action="omit" ... />
  {currentStatus === 'omit' && <ReviewActionButton action="restore" ... />}
</div>
```

> **D-08 visibility-gated rendering:** Render Restore as a real button only when `currentStatus === 'omit'`. Do NOT render-disabled — render NOTHING. Pitfall avoidance in RESEARCH lines 604-606.

> **Popover anchoring:** each button owns a `useRef<HTMLButtonElement>`; the popover renders inside the same parent (sibling to the button) with `position: absolute`.

---

### 9. `packages/dashboard/src/components/ReviewTimeline.tsx` (component, pure presentation)

**Analog:** `packages/dashboard/src/views/VersionDrawer.tsx:447-466` Timeline section

**Existing timeline pattern (VersionDrawer.tsx:447-466):**
```typescript
<section>
  <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">Timeline</h3>
  <ul class="flex flex-col gap-1 rounded bg-[var(--color-surface)] p-3 text-sm text-[var(--color-fg)]">
    {/* rows */}
  </ul>
</section>
```

**Extended discriminated-union row rendering (Phase 22 D-04):**
```typescript
import { formatRelativeTime } from '../lib/time.js';
import { ShotStatusPill } from './ShotStatusPill.js';
import { EmptyState } from './EmptyState.js';
import {
  REVIEW_SECTION_HISTORY, REVIEW_HISTORY_EMPTY,
  TIMELINE_CHANGED_BY_PREFIX,
  TIMELINE_VERSION_CREATED_PREFIX, TIMELINE_VERSION_CREATED_SUFFIX,
  TIMELINE_VERSION_COMPLETED_PREFIX, TIMELINE_VERSION_COMPLETED_SUFFIX,
  TIMELINE_STATUS_CHANGED_PREFIX,
  TIMELINE_VERSION_ROW_ARIA_PREFIX, TIMELINE_VERSION_ROW_ARIA_SUFFIX,
} from '../lib/copy.js';

export function ReviewTimeline({ entries, onVersionClick }: { entries: ShotHistoryEntry[]; onVersionClick: (id: string) => void }) {
  return (
    <section role="log" aria-label="Shot history">
      <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">{REVIEW_SECTION_HISTORY}</h3>
      {entries.length === 0 ? (
        <EmptyState message={REVIEW_HISTORY_EMPTY} />
      ) : (
        <ul class="flex flex-col gap-1">
          {entries.map((entry) => (
            <li key={entry.kind === 'version' ? `v-${entry.version.id}-${entry.event}` : `s-${entry.event.id}`}>
              {entry.kind === 'version' ? (
                <button type="button" onClick={() => onVersionClick(entry.version.id)} aria-label={`${TIMELINE_VERSION_ROW_ARIA_PREFIX}${versionLabel(entry.version)}${TIMELINE_VERSION_ROW_ARIA_SUFFIX}`} class="flex w-full items-center justify-between gap-2 rounded bg-[var(--color-surface)] px-2 py-2 hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
                  <span class="num text-sm">{entry.event === 'created' ? `${TIMELINE_VERSION_CREATED_PREFIX}${versionLabel(entry.version)}${TIMELINE_VERSION_CREATED_SUFFIX}` : `${TIMELINE_VERSION_COMPLETED_PREFIX}${versionLabel(entry.version)}${TIMELINE_VERSION_COMPLETED_SUFFIX}`}</span>
                  <span class="num text-xs text-[var(--color-fg-muted)]">{formatRelativeTime(entry.at)}</span>
                </button>
              ) : (
                <div class="flex items-center justify-between gap-2 rounded bg-[var(--color-surface)] px-2 py-2">
                  <span class="flex items-center gap-2 text-sm">
                    {TIMELINE_STATUS_CHANGED_PREFIX}
                    <ShotStatusPill status={entry.event.to_status} />
                  </span>
                  <span class="num text-xs text-[var(--color-fg-muted)]">{TIMELINE_CHANGED_BY_PREFIX}{entry.event.changed_by} · {formatRelativeTime(entry.event.created_at)}</span>
                </div>
              )}
              {entry.kind === 'status' && entry.event.note && (
                <p class="ml-2 text-xs text-[var(--color-fg-muted)]">"{entry.event.note}"</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

> **`role="log"` choice:** UI-SPEC L719 (Claude-selected per autonomous mode). `role="feed"` is also valid but requires more boilerplate (`aria-busy`/`aria-setsize`).

> **`num` utility class:** declared in `theme.css:128-136` as `font-variant-numeric: tabular-nums; font-feature-settings: "tnum"`. Use on every timestamp, version label, count.

---

### 10. `packages/dashboard/src/state/review-panel.ts` (state, signal file)

**Analog:** `packages/dashboard/src/state/shot-grid.ts` (exact — per-view-domain signal bag)

**File header pattern (shot-grid.ts lines 1-27):**
```typescript
/**
 * packages/dashboard/src/state/review-panel.ts
 *
 * Phase 22 / Plan 22-XX — review panel + A/B compare modal signal bag.
 *
 * Co-locates the activeOverlay discriminator, activeReviewShotId, compareSelection,
 * compareModalOpen, and actionInFlight signals consumed by <OverlayHost/>,
 * <ReviewPanel/>, <ReviewActionBar/>, and <ABCompareView/>.
 *
 * Architecture-purity invariant (D-WEBUI-31): this file performs zero
 * server-tree relative-import traversals — only dashboard-local types and
 * @preact/signals.
 *
 * Landmines preserved (PATTERNS §22):
 *   - DO NOT relocate onShotStatusChanged from state/shot-grid.ts here.
 *     RESEARCH A7 confirms the handler is already correct (idempotent
 *     set-to-broadcasted-value); moving it would break the reference-stable
 *     module-export contract App.tsx relies on for off-subscription cleanup.
 *   - DO NOT mirror review state into the URL — review-panel open/close is
 *     session-only per UI-SPEC §"URL State Contract" line 728-732.
 */

import { signal } from '@preact/signals';
import type { ReviewAction } from '../types/review-panel.js';
```

**Signal declarations pattern (shot-grid.ts lines 38-99):**
```typescript
/**
 * Phase 22 D-02 — single source of truth for which right-rail overlay is
 * visible. Mutually-exclusive: 'review' | 'version' | null.
 */
export const activeOverlay = signal<'review' | 'version' | null>(null);

/**
 * Phase 22 D-02 — when activeOverlay === 'review', this signal holds the
 * shot id whose review panel is open. ALWAYS null when activeOverlay !== 'review'.
 */
export const activeReviewShotId = signal<string | null>(null);

/**
 * Phase 22 D-14 — A/B compare selection state. Both nulls = no selection;
 * one set + one null = waiting for second click; both set = ready to open modal.
 */
export const compareSelection = signal<{ a: string | null; b: string | null }>({ a: null, b: null });

/**
 * Phase 22 D-15 — A/B compare modal visibility. Decoupled from compareSelection
 * so users can close the modal and re-open it with the same selection.
 */
export const compareModalOpen = signal<boolean>(false);

/**
 * Phase 22 — currently-in-flight action transition (per-shot is enforced at
 * call-site; this signal tracks the panel-level action button). null = idle.
 */
export const actionInFlight = signal<ReviewAction | null>(null);

/**
 * Phase 22 — local error pill state for failed quick-approve. Keyed by shotId
 * (single string) — only one card can show the error pill at a time per D-12.
 */
export const quickApproveError = signal<string | null>(null);
```

---

### 11. `packages/dashboard/src/types/review-panel.ts` (types)

**Analog:** `packages/dashboard/src/types/shot-grid.ts` (exact)

**Pattern (shot-grid.ts lines 1-23):**
```typescript
// packages/dashboard/src/types/review-panel.ts
//
// Phase 22 — wire-shape types for PATCH /api/shots/:id/status, GET
// /api/shots/:id/status-history, and GET /api/versions/:a/diff-with/:b.
//
// Architecture-purity (D-WEBUI-31): zero imports from src/. ShotStatus is
// re-derived from ShotStatusChangedPayload in ./events.js.
//
// Field-naming convention: snake_case for wire-level fields (mirrors engine
// ShotStatusEvent + the existing shot-grid envelope convention).

import type { ShotStatus } from './shot-grid.js';

/**
 * Mirror of src/store/shot-status-repo.ts ShotStatusEvent. Dashboard never
 * imports from src/ (D-WEBUI-31); type is hand-mirrored here. MUST match
 * the server's response shape from GET /api/shots/:id/status-history.
 */
export interface ShotStatusEvent {
  id: string;
  shot_id: string;
  from_status: ShotStatus | null;
  to_status: ShotStatus;
  changed_by: string;
  note: string | null;
  created_at: number;
}

/**
 * Discriminated union for unified timeline rendering (Phase 22 D-04). The
 * timeline merger (mergeHistory) produces a sorted ShotHistoryEntry[] from
 * Version[] + ShotStatusEvent[].
 */
export type ShotHistoryEntry =
  | { kind: 'version'; version: Version; event: 'created' | 'completed'; at: number }
  | { kind: 'status'; event: ShotStatusEvent };

/** The 5 action verbs the review surface supports. */
export type ReviewAction = 'approve' | 'retake' | 'hold' | 'omit' | 'restore';

/** Body shape sent to PATCH /api/shots/:id/status. */
export interface SetShotStatusBody {
  to_status: ShotStatus;
  note?: string | null;
  changed_by?: string;
}

/** Response shape from PATCH /api/shots/:id/status. */
export interface SetShotStatusResponse {
  status: ShotStatus;
  history: ShotStatusEvent[];
}
```

---

### 12. `packages/dashboard/src/lib/api.ts` (modifications)

**Analog:** existing `diffVersion`, `reproduceVersion`, `fetchVersion` helpers in same file.

**Existing pattern (api.ts lines 269-273):**
```typescript
/** 12. GET /api/versions/:id/diff?against=<other> */
export function diffVersion(versionId: string, against: string): Promise<unknown> {
  return fetchJson<unknown>(
    `/api/versions/${encodeURIComponent(versionId)}/diff?against=${encodeURIComponent(against)}`,
  );
}
```

**Existing mutation pattern (api.ts lines 378-388 — reproduceVersion):**
```typescript
/** 14. POST /api/versions/:id/reproduce (empty body). */
export function reproduceVersion(id: string): Promise<ReproduceVersionResponse> {
  return fetchJson<ReproduceVersionResponse>(
    `/api/versions/${encodeURIComponent(id)}/reproduce`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
}
```

**Three additions for Phase 22 (RESEARCH Example 3):**
```typescript
// ===== Phase 22 — review and approval =====

import type {
  SetShotStatusBody, SetShotStatusResponse, ShotStatusEvent,
} from '../types/review-panel.js';
import type { DiffSummaryShape } from '../types/diff.js'; // or wherever DiffResponseShape lives

/**
 * Phase 22 D-19 — PATCH /api/shots/:id/status.
 *
 * Engine signature on the server is positional: setShotStatus(shotId, toStatus, changedBy, note?).
 * The HTTP handler unpacks the body object; this client wraps the body.
 *
 * Returns {status, history} echoing the get_status shape.
 */
export function setShotStatus(
  shotId: string,
  body: SetShotStatusBody,
): Promise<SetShotStatusResponse> {
  return fetchJson<SetShotStatusResponse>(
    `/api/shots/${encodeURIComponent(shotId)}/status`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

/**
 * Phase 22 — GET /api/shots/:id/status-history?limit=50.
 *
 * Server route is NEW (no existing HTTP exposure of engine.listShotStatusHistory
 * per RESEARCH A6). Returns {shotId, history, total} mirroring the engine method's
 * return shape.
 */
export function fetchShotStatusHistory(
  shotId: string,
  limit = 50,
): Promise<{ shotId: string; history: ShotStatusEvent[]; total: number }> {
  return fetchJson(
    `/api/shots/${encodeURIComponent(shotId)}/status-history?limit=${limit}`,
  );
}

/**
 * Phase 22 D-16 — GET /api/versions/:a/diff-with/:b.
 *
 * Server route is NEW. Engine.diffVersions already accepts arbitrary pairs
 * (RESEARCH Pitfall 2 — no engine signature change required).
 */
export function diffVersionsAB(a: string, b: string): Promise<DiffSummaryShape> {
  return fetchJson<DiffSummaryShape>(
    `/api/versions/${encodeURIComponent(a)}/diff-with/${encodeURIComponent(b)}`,
  );
}
```

---

### 13. `packages/dashboard/src/lib/copy.ts` (modifications)

**Analog:** Phase 21 copy block at lines 187-298 (exact — section comment + named exports).

**Section header pattern:**
```typescript
// ================================================================
// Phase 22 — review and approval copy
// (UI-SPEC §"Copywriting Contract" — verbatim named-constant exports)
//
// All Phase 22 surfaces — ReviewPanel, StatusChangePopover, ABCompareView,
// QuickApproveButton, ReviewActionBar, ReviewTimeline — import from this
// block. Zero inline string literals in component files (architectural rule).
// ================================================================
```

**Verbatim exports per UI-SPEC §"Copywriting Contract" (lines 191-340):**
- Action bar labels: `REVIEW_ACTION_APPROVE_LABEL`, `REVIEW_ACTION_RETAKE_LABEL`, `REVIEW_ACTION_HOLD_LABEL`, `REVIEW_ACTION_OMIT_LABEL`, `REVIEW_ACTION_RESTORE_LABEL`
- Action bar ARIA: `REVIEW_ACTION_APPROVE_ARIA`, etc.
- Pending labels: `REVIEW_ACTION_APPROVE_PENDING = 'Approving…'` (U+2026 verbatim)
- Popover prompts: `REVIEW_APPROVE_PROMPT = 'Approve this shot?'`, `REVIEW_RETAKE_PROMPT`, `REVIEW_HOLD_PROMPT`, `REVIEW_OMIT_PROMPT`, `REVIEW_RESTORE_PROMPT`
- Popover controls: `POPOVER_CANCEL_LABEL`, `POPOVER_CONFIRM_LABEL`, `POPOVER_CONFIRM_PENDING`, `POPOVER_NOTE_PLACEHOLDER`, `POPOVER_NOTE_LABEL`, `POPOVER_DIALOG_ARIA_LABEL_PREFIX`
- Quick-approve: `REVIEW_QUICK_APPROVE_ARIA_PREFIX`, `REVIEW_QUICK_APPROVE_FAIL_LABEL`, `REVIEW_QUICK_APPROVE_FAIL_ARIA`
- Panel + sections: `REVIEW_PANEL_TITLE_PREFIX`, `REVIEW_PANEL_ARIA_LABEL_PREFIX`, `REVIEW_PANEL_CLOSE_ARIA`, `REVIEW_SECTION_ACTIONS`, `REVIEW_SECTION_HISTORY`, `REVIEW_HISTORY_EMPTY`
- Timeline attribution: `TIMELINE_CHANGED_BY_PREFIX`, `TIMELINE_VERSION_CREATED_PREFIX`, `TIMELINE_VERSION_CREATED_SUFFIX`, `TIMELINE_VERSION_COMPLETED_PREFIX`, `TIMELINE_VERSION_COMPLETED_SUFFIX`, `TIMELINE_STATUS_CHANGED_PREFIX`, `TIMELINE_VERSION_ROW_ARIA_PREFIX`, `TIMELINE_VERSION_ROW_ARIA_SUFFIX`, `RESTORE_NOTE_SYSTEM_TEXT = 'Restored from omit'`
- Compare mode: `COMPARE_MODE_ENTER_LABEL`, `COMPARE_MODE_ENTER_ARIA`, `COMPARE_MODE_CTA_LABEL`, `COMPARE_MODE_CTA_DISABLED_ARIA`, `COMPARE_MODE_CTA_READY_ARIA`, `COMPARE_MODE_CANCEL_LABEL`, `COMPARE_MODE_CHECKBOX_ARIA_PREFIX`, `COMPARE_MODE_HINT`
- A/B modal: `COMPARE_MODAL_TITLE_PREFIX`, `COMPARE_MODAL_TITLE_INFIX`, `COMPARE_MODAL_ARIA_LABEL_PREFIX`, `COMPARE_MODAL_CLOSE_ARIA`, `COMPARE_MODAL_SECTION_THUMBNAILS`, `COMPARE_MODAL_SECTION_METADATA`, `COMPARE_MODAL_LOADING_LABEL`, `COMPARE_MODAL_DIFF_LOADING`, `COMPARE_MODAL_DIFF_ERROR`, `COMPARE_MODAL_DIFF_EMPTY`, `COMPARE_MODAL_THUMB_LOAD_FAIL`
- Error/loading: `REVIEW_PANEL_ACTION_FAIL_PREFIX`, `REVIEW_HISTORY_FETCH_ERROR`, `REVIEW_PANEL_LOADING_LABEL`

> **Pitfall 10 mitigation:** if a test asserts on copy export count, use `>= 46` (Phase 21 floor) — NEVER `===`.

---

### 14. `src/http/dashboard-routes.ts` (3 new routes)

**Analog:** existing routes at lines 282-392 (exact — same Hono + Zod pattern)

**Imports addition (already exists at lines 23-46):**
```typescript
import { z } from 'zod';
import { TypedError } from '../engine/errors.js';
import { SHOT_STATUSES, type ShotStatus } from '../types/hierarchy.js';
```

**PATCH /api/shots/:id/status (RESEARCH Example 1 + D-19):**
```typescript
// Phase 22 D-19 — PATCH /api/shots/:id/status
// Thin Hono handler delegating to engine.setShotStatus (positional args).
//
// Engine signature: setShotStatus(shotId, toStatus, changedBy, note?)
// HTTP body shape:  { to_status, note?, changed_by? }
// Response shape:   { status, history }
//
// Reuses Phase 20's atomic transaction discipline (UPDATE shots + INSERT
// shot_status_events) at the repo layer; HTTP handler MUST NOT introduce
// a parallel mutation path.
const SetShotStatusBody = z.object({
  to_status: z.enum(SHOT_STATUSES),
  note: z.string().max(500).nullable().optional(),
  changed_by: z.string().max(100).optional(),
});

app.patch('/api/shots/:id/status', async (c) => {
  const shotId = c.req.param('id');
  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = SetShotStatusBody.safeParse(rawBody);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new TypedError(
      'INVALID_INPUT',
      `Invalid PATCH body at '${first.path.join('.')}'`,
      `Expected { to_status: <one of: ${SHOT_STATUSES.join(', ')}>, note?: string|null, changed_by?: string }`,
    );
  }

  // POSITIONAL ARGS — engine takes (shotId, toStatus, changedBy, note?).
  // Pitfall 1 mitigation: DO NOT pass parsed.data as a struct.
  const result = engine.setShotStatus(
    shotId,
    parsed.data.to_status,
    parsed.data.changed_by ?? 'user',
    parsed.data.note === null ? undefined : parsed.data.note,
  );

  // Echo current status + recent history (50-row cap mirrors get_status arm).
  const { history } = engine.listShotStatusHistory(shotId, 50);
  return c.json({ status: result.newStatus, history });
});
```

**GET /api/versions/:a/diff-with/:b (RESEARCH Example 2 + D-16):**
```typescript
// Phase 22 D-16 — GET /api/versions/:a/diff-with/:b
// engine.diffVersions already accepts arbitrary pair; no engine change needed.
app.get('/api/versions/:a/diff-with/:b', async (c) => {
  const a = c.req.param('a');
  const b = c.req.param('b');
  return c.json(await engine.diffVersions(a, b));
});
```

**GET /api/shots/:id/status-history (NEW, per RESEARCH A6):**
```typescript
// Phase 22 — GET /api/shots/:id/status-history?limit=50
// Wraps engine.listShotStatusHistory (Phase 20) which currently has no HTTP exposure.
// Engine returns { shotId, history, total } — passed through verbatim.
app.get('/api/shots/:id/status-history', (c) => {
  const shotId = c.req.param('id');
  const limit = qNum(c.req.query('limit'), 50, 'limit');
  return c.json(engine.listShotStatusHistory(shotId, limit));
});
```

**Engine type widening (EngineForDashboard struct):**
```typescript
// Add to the Pick<Engine, ...> union at lines 72-118:
| 'setShotStatus'
| 'diffVersions'           // already there at line 85
| 'listShotStatusHistory'
```

---

### 15. `packages/dashboard/src/components/ShotGridCard.tsx` (D-13 structural refactor)

**Analog:** self (current single-button form at lines 64-110)

**Current structure (Phase 21 — to be REPLACED):**
```typescript
// Lines 64-110: single <button> wrapping everything
const button = (
  <button type="button" onClick={handleClick} aria-label={...} disabled={disabled} class="w-full ...">
    {hasVersion ? <Thumbnail ... /> : <SkeletonThumbnail ... />}
    <div class="flex flex-col gap-1 p-2 ...">
      <div class="flex items-center justify-between gap-2">
        <ShotStatusPill status={shot.status} />
        <span class="num text-xs ...">{formatVersionCount(...)}</span>
      </div>
      <span class="truncate text-sm font-normal">{shot.name}</span>
      {hasVersion && <span class="num text-xs ...">Updated {formatRelativeTime(...)}</span>}
    </div>
  </button>
);
```

**New structure (Phase 22 D-13 — RESEARCH Example 5, lines 853-921):**
```typescript
import { QuickApproveButton } from './QuickApproveButton.js';
import { openVersionDrawer, openReviewPanel } from '../views/OverlayHost.js';
import { quickApproveError } from '../state/review-panel.js';
import { WarningPill } from './WarningPill.js';
import { REVIEW_QUICK_APPROVE_FAIL_LABEL, REVIEW_QUICK_APPROVE_FAIL_ARIA } from '../lib/copy.js';

export function ShotGridCard({ shot, onSelect }: ShotGridCardProps) {
  const hasVersion = shot.latest_completed_version !== null;
  const isOmit = shot.status === 'omit';
  const quickApproveErr = quickApproveError.value === shot.id;

  const cardBody = (
    <div class="group relative w-full overflow-hidden rounded">
      {/* (a) Thumbnail-area button — preserves Phase 21 D-19 */}
      <button
        type="button"
        onClick={hasVersion ? () => onSelect(shot.latest_completed_version!.id) : undefined}
        aria-label={`${SHOT_CARD_OPEN_ARIA_PREFIX}${shot.name}`}
        aria-disabled={!hasVersion || undefined}
        disabled={!hasVersion}
        class="block w-full focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {hasVersion ? (
          <Thumbnail version={{ id: shot.latest_completed_version!.id, label: shot.name, status: 'complete' }} size="card" />
        ) : (
          <SkeletonThumbnail width={220} height={124} />
        )}
      </button>

      {/* (c) Hover Check-icon button (D-10) — only when hasVersion */}
      {hasVersion && (
        <QuickApproveButton shotId={shot.id} shotName={shot.name} currentStatus={shot.status} />
      )}

      <div class="flex flex-col gap-1 p-2 text-[var(--color-fg)]">
        <div class="flex items-center justify-between gap-2">
          {/* (b) ShotStatusPill-as-button (D-13) — opens review panel */}
          <ShotStatusPill
            status={shot.status}
            onClick={() => openReviewPanel(shot.id)}
            ariaLabel={`Open review panel for ${shot.name} (status: ${shot.status})`}
          />
          <span class="num text-xs text-[var(--color-fg-muted)]">
            {formatVersionCount(shot.version_count)}
          </span>
        </div>
        <span class="truncate text-sm font-normal">{shot.name}</span>
        {hasVersion && (
          <span class="num text-xs text-[var(--color-fg-muted)]">
            {SHOT_CARD_LAST_UPDATED_PREFIX}
            {formatRelativeTime(shot.latest_completed_version!.completed_at)}
          </span>
        )}
      </div>

      {/* Inline error pill (D-12) — quick-approve failed */}
      {quickApproveErr && (
        <div class="absolute inset-x-2 bottom-2" aria-live="polite" aria-atomic="true">
          <WarningPill label={REVIEW_QUICK_APPROVE_FAIL_LABEL} ariaLabel={REVIEW_QUICK_APPROVE_FAIL_ARIA} />
        </div>
      )}
    </div>
  );

  if (isOmit) return <div class="opacity-40 transition-opacity">{cardBody}</div>;
  return cardBody;
}
```

> **Critical:** outer `<div class="group">` is required for `group-hover:opacity-100` on `QuickApproveButton` per D-10 (Pitfall 4 mitigation — verify no nested `<button>`).

> **Click delegation:** `onSelect(shot.latest_completed_version!.id)` continues to call the existing handler. Inside Phase 22, the ShotGridView's `onSelect` callback flips `activeOverlay = 'version'` + `selectedVersionId` via `openVersionDrawer()`. The parent `ShotGridView` migrates to call the new helper.

---

### 16. `packages/dashboard/src/components/ShotStatusPill.tsx` (D-13 dual-mode)

**Analog:** self (current presentational at lines 58-67)

**Current structure (Phase 21 — to be EXTENDED):**
```typescript
export function ShotStatusPill({ status }: ShotStatusPillProps) {
  return (
    <span
      class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-normal uppercase tracking-widest ${SHOT_STATUS_STYLES[status]}`}
      data-status={status}
    >
      {status}
    </span>
  );
}
```

**New dual-mode (RESEARCH Example 6, lines 930-961):**
```typescript
export interface ShotStatusPillProps {
  status: ShotStatus;
  /** When provided, the pill renders as <button>. When undefined, renders as presentational <span>. */
  onClick?: () => void;
  /** REQUIRED when onClick is provided. */
  ariaLabel?: string;
}

export function ShotStatusPill({ status, onClick, ariaLabel }: ShotStatusPillProps) {
  const pillContent = (
    <span
      class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-normal uppercase tracking-widest ${SHOT_STATUS_STYLES[status]}`}
      data-status={status}
    >
      {status}
    </span>
  );

  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? `Open review for status ${status}`}
        aria-haspopup="dialog"
        class="rounded-full focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] motion-safe:transition-[filter] hover:brightness-110"
      >
        {pillContent}
      </button>
    );
  }

  return pillContent;
}
```

> **Backward compat:** All existing call-sites (timeline status rows, VersionDrawer header) continue to render the `<span>` form because they don't pass `onClick`. Only ShotGridCard (Phase 22) provides `onClick`.

---

### 17. `packages/dashboard/src/App.tsx` (minimal swap)

**Analog:** self (current line 143)

**Current (Phase 21):**
```typescript
import { VersionDrawerHost } from './views/VersionDrawerHost.js';
// ...
<VersionDrawerHost />
```

**New (Phase 22):**
```typescript
import { OverlayHost } from './views/OverlayHost.js';
import { ABCompareHost } from './views/ABCompareHost.js';
// ...
{/* Phase 22 — generalized right-rail overlay (review or version) */}
<OverlayHost />
{/* Phase 22 — A/B compare modal mount */}
<ABCompareHost />
```

> **No SSE handler change:** `onShotStatusChanged` continues to be imported from `state/shot-grid.ts` (RESEARCH A7 — handler stays put; reference-stable for off-subscription cleanup).

---

## Shared Patterns

### Shared Pattern A: Architecture-Purity Import Convention

**Source:** `packages/dashboard/src/state/shot-grid.ts:11-13`, `packages/dashboard/src/lib/api.ts:8-10`, all dashboard test files

**Apply to:** Every new file in `packages/dashboard/src/**/*`

```typescript
// Architecture-purity invariant (D-WEBUI-31): this file performs zero
// server-tree relative-import traversals — only the dashboard-local
// `../types/*` barrels and the `@preact/signals` + `zod` libraries.
```

> **Enforcement:** `src/__tests__/architecture-purity.test.ts` greps for `from '../../src/` or `from '../src/'` patterns across `packages/dashboard/src/**`. Any new Phase 22 file with such an import fails the test. Mirror types via re-derivation (see `types/shot-grid.ts:23` deriving `ShotStatus` from `ShotStatusChangedPayload['toStatus']`).

---

### Shared Pattern B: Module-Singleton Signal Reset in Tests

**Source:** `packages/dashboard/src/__tests__/sse-signal-integration.test.tsx:84-86`

**Apply to:** Every test that touches `state/review-panel.ts` signals

```typescript
beforeEach(() => {
  // Reset module-singleton signals so each test starts fresh
  activeOverlay.value = null;
  activeReviewShotId.value = null;
  compareSelection.value = { a: null, b: null };
  compareModalOpen.value = false;
  actionInFlight.value = null;
  quickApproveError.value = null;
});
```

> Module-singleton signals leak across tests unless explicitly reset.

---

### Shared Pattern C: API Module Mock with Hoisted vi.mock

**Source:** `packages/dashboard/src/views/__tests__/VersionDrawerHost.test.tsx:58-70`

**Apply to:** Every component test that triggers a fetch helper

```typescript
vi.mock('../../lib/api.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    setShotStatus: vi.fn(),
    fetchShotStatusHistory: vi.fn(),
    diffVersionsAB: vi.fn(),
    getThumbnailUrl: (id: string) => `/api/versions/${id}/thumbnail`,
  };
});
```

> Preserves real exports for helpers not under test (`...actual`) while replacing the specific ones with `vi.fn()`. `getThumbnailUrl` is replaced with a deterministic string (avoid encodeURIComponent churn in assertions).

---

### Shared Pattern D: TypedError → typedErrorHandler Translation

**Source:** `src/http/dashboard-routes.ts:159-166, 196-201, 217-226`

**Apply to:** All 3 new Phase 22 HTTP routes

```typescript
throw new TypedError(
  'INVALID_INPUT',
  `Invalid PATCH body at '${path}'`,
  `Expected { to_status: <one of: ${SHOT_STATUSES.join(', ')}>, note?: string|null, changed_by?: string }`,
);
```

> The global `typedErrorHandler` (mounted via `app.onError(typedErrorHandler)`) translates `TypedError` instances to structured 4xx/5xx envelopes. Phase 22 routes throw `INVALID_INPUT` for bad bodies (400) and rely on the engine to throw `SHOT_NOT_FOUND` (→ 404) / `VERSION_NOT_FOUND` (→ 404). Information-disclosure hygiene: NEVER echo the malformed input verbatim in the error message (T-18-03 precedent).

---

### Shared Pattern E: WAI-ARIA Pattern Choices

**Source:** `SortDropdown.tsx` (combobox/listbox), `DiffDrawer.tsx:50-51` (dialog)

**Apply to:** All popovers, modals, action buttons

| Surface | Role | Modal? | Labelled-by | Notes |
|---------|------|--------|-------------|-------|
| `StatusChangePopover` | `role="dialog"` | `aria-modal="false"` | `aria-labelledby={promptId}` | Non-modal — outside-click cancels |
| `ABCompareView` | `role="dialog"` | `aria-modal="true"` | `aria-labelledby={titleId}` | Modal — focus-trap on close button |
| `ReviewActionButton` (each) | (default `button`) | n/a | `aria-label` + `aria-haspopup="dialog"` + `aria-expanded={open}` | Command pattern, NOT toggle (no `aria-pressed`) |
| `QuickApproveButton` | (default `button`) | n/a | `aria-label="Quick approve {shotName}"` + `aria-haspopup="dialog"` | |
| `ShotStatusPill` (button mode) | (default `button`) | n/a | `aria-label` + `aria-haspopup="dialog"` | |
| `ReviewPanel` aside | `role="dialog"` | (none — implicitly non-modal because outside-click doesn't close — Phase 5 lock per UI-SPEC L426) | `aria-label={REVIEW_PANEL_ARIA_LABEL_PREFIX + shotName}` | |
| `ReviewTimeline` `<section>` | `role="log"` | n/a | `aria-label="Shot history"` | Claude-selected per autonomous mode |

> **Pitfall avoidance (UI-SPEC L717):** action buttons are COMMAND buttons — they open a popover. `aria-pressed` is WRONG; use `aria-haspopup="dialog"` + `aria-expanded={popoverIsOpen}`.

---

### Shared Pattern F: Focus Management

**Source:** `SortDropdown.tsx:144-147` (focus return), `RegenerateButton.tsx:114` (disable on pending)

**Apply to:** All Phase 22 popovers and modals

| Trigger | Focus moves to |
|---------|----------------|
| Open StatusChangePopover (action !== 'restore') | textarea |
| Open StatusChangePopover (action === 'restore') | Cancel button |
| Close StatusChangePopover (any path: ESC, outside-click, Cancel, Confirm-success) | trigger button (`anchorRef.current?.focus()`) |
| Open ABCompareView | close button |
| Close ABCompareView | "Compare" CTA in the review panel timeline |
| Open ReviewPanel | first action bar button (Approve) |
| Close ReviewPanel | (default — back to the previously-focused element) |

> **Implementation:** call `anchorRef.current?.focus()` BEFORE flipping the parent's `isOpen=false` to prevent focus falling to `<body>` when the popover unmounts.

---

### Shared Pattern G: Mutation-In-Flight UI Discipline

**Source:** `RegenerateButton.tsx:107-119`

**Apply to:** ReviewActionButton, StatusChangePopover Confirm, QuickApproveButton

```typescript
disabled={isDisabled}
aria-disabled={isDisabled || undefined}
aria-busy={isPending ? 'true' : 'false'}
onClick={isDisabled ? undefined : onClick}
```

> The `onClick={isDisabled ? undefined : onClick}` is defence-in-depth: HTML's native disabled-click suppression doesn't always fire reliably (older Safari, custom focus rings); passing `undefined` to a disabled button additionally guards. Mirrors RegenerateButton.tsx:114.

> **Per-button vs per-bar disabled:** the in-flight action button gets `aria-busy="true"` + the "{verb}ing…" pending label; ALL other action buttons get `disabled={true}` + greyed text. Per UI-SPEC §"Status transition in-flight behavior" lines 502-506.

---

### Shared Pattern H: HTTP Test Fixture Setup

**Source:** `src/__tests__/dashboard-routes-sort.test.ts:46-83`

**Apply to:** All 3 new Phase 22 HTTP tests (`dashboard-routes-set-status.test.ts`, `dashboard-routes-diff-ab.test.ts`, `dashboard-routes-status-history.test.ts`)

```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { Engine } from '../engine/pipeline.js';
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import { VersionRepo } from '../store/version-repo.js';
import { ProvenanceRepo } from '../store/provenance-repo.js';
import { FakeComfyUIClient } from '../test-utils/fake-comfyui-client.js';
import { makeInMemoryDb, type TestDb } from '../test-utils/fixtures.js';
import { createDashboardRouter } from '../http/dashboard-routes.js';
import { typedErrorHandler } from '../http/error-middleware.js';

let fix: Fixture;

beforeEach(() => {
  const testDb = makeInMemoryDb();
  const hierarchyRepo = new HierarchyRepo(testDb.db);
  // ... etc — construct full engine ...
  const engine = new Engine(testDb.db, hierarchyRepo, versionRepo, provenanceRepo, fake as never, 'outputs');

  const app = new Hono();
  app.onError(typedErrorHandler);
  app.route('/', createDashboardRouter(engine as never));

  fix = { testDb, engine, app, /* + parent chain ids */ };
});

// Test pattern:
test('Test N: PATCH /api/shots/:id/status with valid body returns {status, history}', async () => {
  const res = await fix.app.request(`/api/shots/${fix.shotId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to_status: 'approved' }),
  });
  expect(res.status).toBe(200);
  const body = await res.json() as { status: string; history: Array<{ to_status: string }> };
  expect(body.status).toBe('approved');
  expect(body.history[0].to_status).toBe('approved');
});

test('Test N: PATCH /api/shots/:id/status with bad to_status returns 400 INVALID_INPUT', async () => {
  const res = await fix.app.request(`/api/shots/${fix.shotId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to_status: 'invalid_status' }),
  });
  expect(res.status).toBe(400);
  const body = await res.json() as { error?: { code?: string } };
  expect(body.error?.code).toBe('INVALID_INPUT');
});
```

---

### Shared Pattern I: Optimistic Mutation + SSE Convergence (D-12, D-20)

**Source:** RESEARCH Pattern 3 (lines 448-484); existing idempotent handler at `state/shot-grid.ts:160-171`

**Apply to:** Quick-approve handler in `QuickApproveButton.tsx`

```typescript
async function handleQuickApprove(shotId: string, priorStatus: ShotStatus, note: string | null) {
  // 1. Optimistic mutation FIRST
  const current = shotGrid.value;
  if (!current) return;
  const idx = current.shots.findIndex((s) => s.id === shotId);
  if (idx < 0) return;

  shotGrid.value = {
    ...current,
    shots: current.shots.map((s, i) => i === idx ? { ...s, status: 'approved' } : s),
  };
  quickApproveError.value = null;

  // 2. PATCH
  try {
    await setShotStatus(shotId, { to_status: 'approved', note, changed_by: 'user' });
    // 3a. SSE will arrive shortly with same value — onShotStatusChanged is idempotent (no-op).
  } catch (err) {
    // 3b. Revert. Local-only — no SSE for the rollback.
    shotGrid.value = {
      ...shotGrid.value!,
      shots: shotGrid.value!.shots.map((s, i) => i === idx ? { ...s, status: priorStatus } : s),
    };
    quickApproveError.value = shotId;
    // Auto-dismiss after 5s (Pitfall 5 mitigation — guard against unmount)
    setTimeout(() => {
      if (quickApproveError.value === shotId) quickApproveError.value = null;
    }, 5000);
  }
}
```

> The SSE handler (`state/shot-grid.ts:160-171`) is ALREADY idempotent — it sets `shots[idx].status = payload.toStatus` regardless of current value. The optimistic write and the eventual SSE both end at the same state; Preact creates a new object identity but the visual is unchanged.

---

### Shared Pattern J: Tailwind v4 Bracketed-Token Class Convention

**Source:** `ShotStatusPill.tsx:46-56`, `ShotGridCard.tsx:73-78`, all Phase 21 components

**Apply to:** Every new Phase 22 component class string

```typescript
// CORRECT — Tailwind v4 generates the bracketed class verbatim:
class="bg-[var(--color-surface)] text-[var(--color-fg)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"

// WRONG — no Tailwind config to alias these:
class="bg-surface text-fg"  // would generate 'bg-surface' as raw class, not the CSS var
```

> Phase 22 reuses `--drawer-version-width`, `--color-bg`, `--color-fg`, `--color-fg-muted`, `--color-fg-dim`, `--color-surface`, `--color-surface-alt`, `--color-border`, `--color-accent`, `--color-shot-status-*` (5 status tokens), `--color-status-running`. All exist in `theme.css`; ZERO new tokens (UI-SPEC §"Spacing Scale" line 31).

---

## No Analog Found

**No files in Phase 22 lack an analog.** Every new file either:
1. Has an exact same-role + same-data-flow precedent (VersionDrawer → ReviewPanel, VersionDrawerHost → OverlayHost, SortDropdown → StatusChangePopover, RegenerateButton → ReviewActionButton, etc.)
2. Has a strong role-match precedent (DiffDrawer side-by-side → ABCompareView side-by-side)
3. Is a clean extraction from an existing file (MetadataDiff from DiffDrawer lines 101-108)

**The one near-miss:** the ABCompareView modal overlay (full-viewport backdrop + focus-trap) has NO existing modal precedent in the codebase. The codebase has right-rail aside-style "drawers" (VersionDrawer, DiffDrawer) but no full-viewport modal overlay. RESEARCH provides the full pattern (Pattern + RESEARCH lines 438-482, UI-SPEC §"Responsive Behavior" lines 617-642 with the CSS recipe). Planner should:
- Apply the existing dialog + aria-modal + focus-trap conventions (Shared Pattern E + F)
- Use the CSS recipe from UI-SPEC verbatim for layout
- Use the SortDropdown-style outside-click listener BUT lift it to the backdrop click + ESC key (per UI-SPEC §"Interaction Contracts" lines 449-451)

---

## Metadata

**Analog search scope:**
- `packages/dashboard/src/views/**` — overlay & view patterns
- `packages/dashboard/src/components/**` — component patterns
- `packages/dashboard/src/state/**` — signal patterns
- `packages/dashboard/src/lib/**` — fetch helper + copy patterns
- `packages/dashboard/src/types/**` — type mirror patterns
- `packages/dashboard/src/__tests__/**`, `**/components/__tests__/**`, `**/views/__tests__/**` — test patterns
- `src/http/dashboard-routes.ts` — HTTP route patterns
- `src/engine/pipeline.ts` — engine facade signatures (lines 703-799 status; 1062-1090 diff)
- `src/tools/shot-tool.ts` — MCP arm pattern (lines 140-156 set_status / get_status / list_status_history)
- `src/store/shot-status-repo.ts` — wire-shape types (lines 38-46 ShotStatusEvent)
- `src/__tests__/dashboard-routes-sort.test.ts` — HTTP test pattern

**Files scanned:** ~30 source files + ~15 test files

**Pattern extraction date:** 2026-05-14

**Critical convention checklist (all locked):**
- Architecture-purity (D-WEBUI-31): NO server-tree imports in `packages/dashboard/src/**`
- Tool cap (D-21): zero new MCP tools — Phase 22 holds at 7/12
- Append-only provenance (Phase 20 STAT-02): zero new SQL paths; all writes flow through `engine.setShotStatus`
- Engine signature (Pitfall 1): `setShotStatus(shotId, toStatus, changedBy, note?)` is POSITIONAL
- Diff facade (Pitfall 2): `engine.diffVersions(a, b)` ALREADY accepts arbitrary pair — NO engine change
- SSE handler reference stability (Pitfall 3): `onShotStatusChanged` STAYS in `state/shot-grid.ts:160`
- No nested buttons (Pitfall 4): ShotGridCard outer = `<div class="group">`, three siblings as buttons
- WarningPill timeout (Pitfall 5): guard with `if (quickApproveError.value === shotId)` before clearing
- compareSelection reset (Pitfall 6): clear on `activeReviewShotId` change, NOT on modal close
- Image.decode() (Pitfall 7): wire `onload` + `onerror` in the fallback Promise
- SSE wins on multi-tab (Pitfall 8): last-writer-wins via idempotent handler; no special coordination
- Popover form (Pitfall 9): NEVER wrap in `<form>`; Enter inside textarea inserts newline
- Copy count assertion (Pitfall 10): use `>= 46` floor, never `===`
