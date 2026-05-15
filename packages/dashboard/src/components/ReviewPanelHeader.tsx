/**
 * Phase 22 / Plan 22-05 — ReviewPanelHeader.
 *
 * Top strip of the right-rail review panel: title prefix + shot name +
 * presentational ShotStatusPill + close X. SSE updates to the shot's
 * status propagate via the parent's currentStatus prop (parent reads
 * `shotGrid.value.shots.find(...)` so the prop refreshes on every render).
 *
 * Architecture-purity (D-WEBUI-31): only sibling dashboard imports.
 */

import type { JSX } from 'preact';
import type { ShotStatus } from '../types/shot-grid.js';
import { ShotStatusPill } from './ShotStatusPill.js';
import {
  REVIEW_PANEL_TITLE_PREFIX,
  REVIEW_PANEL_CLOSE_ARIA,
} from '../lib/copy.js';

export interface ReviewPanelHeaderProps {
  shotName: string;
  currentStatus: ShotStatus;
  onClose: () => void;
}

export function ReviewPanelHeader({
  shotName,
  currentStatus,
  onClose,
}: ReviewPanelHeaderProps): JSX.Element {
  return (
    <header class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2
          class="text-base font-semibold text-[var(--color-fg)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {REVIEW_PANEL_TITLE_PREFIX}
          {shotName}
        </h2>
        <ShotStatusPill status={currentStatus} />
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
  );
}
