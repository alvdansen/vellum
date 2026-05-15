/**
 * Phase 22 / Plan 22-05 — ReviewPanel.
 *
 * Top-level composition of the right-rail review panel. Mounted by
 * OverlayHost when activeOverlay='review' (D-02 mutex with VersionDrawer).
 *
 * Layout top-to-bottom (D-03 sticky-action-bar lock):
 *  - ReviewPanelHeader     — title + ShotStatusPill + close X
 *  - ReviewActionBar       — 4-or-5 action buttons + popover orchestration
 *  - ReviewTimeline        — unified version+status events feed (D-04)
 *
 * Pure-composition: no signals, no fetch — the caller (OverlayHost) does
 * the cache-miss fetch and passes resolved data via props. This keeps the
 * composition layer testable in isolation.
 */

import type { JSX } from 'preact';
import type { Version } from '../types/entities.js';
import type { ShotStatusEvent } from '../types/review-panel.js';
import type { ShotStatus } from '../types/shot-grid.js';
import { ReviewPanelHeader } from '../components/ReviewPanelHeader.js';
import { ReviewActionBar } from '../components/ReviewActionBar.js';
import { ReviewTimeline } from '../components/ReviewTimeline.js';
import { openVersionDrawer } from './OverlayHost.js';
import { mergeHistory } from '../lib/mergeHistory.js';
import { REVIEW_PANEL_ARIA_LABEL_PREFIX } from '../lib/copy.js';

export interface ReviewPanelProps {
  shotId: string;
  shotName: string;
  currentStatus: ShotStatus;
  versions: Version[];
  statusHistory: ShotStatusEvent[];
  onClose: () => void;
}

export function ReviewPanel({
  shotId,
  shotName,
  currentStatus,
  versions,
  statusHistory,
  onClose,
}: ReviewPanelProps): JSX.Element {
  const entries = mergeHistory(versions, statusHistory);
  return (
    <aside
      class="fixed inset-y-0 right-0 z-10 flex flex-col gap-4 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-xl"
      style={{ width: 'var(--drawer-version-width)' }}
      role="dialog"
      aria-label={`${REVIEW_PANEL_ARIA_LABEL_PREFIX}${shotName}`}
    >
      <ReviewPanelHeader
        shotName={shotName}
        currentStatus={currentStatus}
        onClose={onClose}
      />
      <ReviewActionBar
        shotId={shotId}
        currentStatus={currentStatus}
        versions={versions}
        statusHistory={statusHistory}
      />
      <ReviewTimeline
        entries={entries}
        onVersionClick={(versionId) => openVersionDrawer(versionId)}
      />
    </aside>
  );
}
