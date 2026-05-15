/**
 * ShotGridCard — single shot tile for the shot-grid CSS Grid.
 *
 * Phase 22 / Plan 22-07 — D-13 refactor: the Phase 21 whole-card-button
 * structure is REVERSED. Outer is now a `<div class="group relative">`
 * with three SIBLING `<button>` children (Pitfall 4 — never nested):
 *
 *   (a) Thumbnail button  — onSelect(versionId) → openVersionDrawer
 *                          (preserves Phase 21 D-19 thumb→VersionDrawer)
 *   (b) ShotStatusPill    — onClick → openReviewPanel(shotId)
 *                          (dual-mode pill; opens the review panel)
 *   (c) QuickApproveButton — hover-only Check icon; opens
 *                          StatusChangePopover anchored to itself; on
 *                          Confirm, optimistic + revert flow (D-12)
 *
 * The outer `class="group"` is the Tailwind v4 hover-state vehicle that
 * lets QuickApproveButton's `group-hover:opacity-100` work (D-10).
 *
 * Inline error pill (REV-02): when quickApproveError signal equals this
 * shot's id, render a WarningPill inside the card pinned to the bottom.
 *
 * Architecture-purity (D-WEBUI-31) preserved — only sibling dashboard
 * imports.
 *
 * SECURITY — T-5-06 / VersionCard precedent: shot.name + version count
 * + relative timestamp render as JSX text children (Preact auto-escapes).
 */

import type { JSX } from 'preact';
import type { ShotGridRow } from '../types/shot-grid.js';
import { ShotStatusPill } from './ShotStatusPill.js';
import { Thumbnail } from './Thumbnail.js';
import { SkeletonThumbnail } from './SkeletonThumbnail.js';
import { QuickApproveButton } from './QuickApproveButton.js';
import { WarningPill } from './WarningPill.js';
import { formatRelativeTime } from '../lib/time.js';
import { openVersionDrawer, openReviewPanel } from '../views/OverlayHost.js';
import { quickApproveError } from '../state/review-panel.js';
import {
  SHOT_CARD_OPEN_ARIA_PREFIX,
  SHOT_CARD_VERSION_COUNT_SINGULAR,
  SHOT_CARD_VERSION_COUNT_PLURAL_SUFFIX,
  SHOT_CARD_NO_VERSIONS,
  SHOT_CARD_LAST_UPDATED_PREFIX,
  REVIEW_QUICK_APPROVE_FAIL_LABEL,
  REVIEW_QUICK_APPROVE_FAIL_ARIA,
} from '../lib/copy.js';

export interface ShotGridCardProps {
  shot: ShotGridRow;
  /**
   * Phase 21 contract preserved: callers pass a versionId-selection
   * handler. Phase 22 callers should pass `openVersionDrawer` from
   * OverlayHost; legacy callers writing `selectedVersionId` directly
   * still work via OverlayHost's backward-compat fallback.
   */
  onSelect: (versionId: string) => void;
}

function formatVersionCount(n: number): string {
  if (n === 0) return SHOT_CARD_NO_VERSIONS;
  if (n === 1) return SHOT_CARD_VERSION_COUNT_SINGULAR;
  return `${n}${SHOT_CARD_VERSION_COUNT_PLURAL_SUFFIX}`;
}

export function ShotGridCard({
  shot,
  onSelect,
}: ShotGridCardProps): JSX.Element {
  const hasVersion = shot.latest_completed_version !== null;
  const isOmit = shot.status === 'omit';
  const quickApproveErr = quickApproveError.value === shot.id;

  const cardBody = (
    <div class="group relative w-full overflow-hidden rounded">
      {/* (a) Thumbnail button — preserves Phase 21 D-19 (thumb → VersionDrawer) */}
      <button
        type="button"
        onClick={
          hasVersion
            ? () => onSelect(shot.latest_completed_version!.id)
            : undefined
        }
        aria-label={`${SHOT_CARD_OPEN_ARIA_PREFIX}${shot.name}`}
        aria-disabled={!hasVersion || undefined}
        disabled={!hasVersion}
        class={`block w-full focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
          hasVersion
            ? 'hover:shadow-[0_0_0_1px_var(--color-border)]'
            : 'cursor-default'
        }`}
      >
        {hasVersion ? (
          <Thumbnail
            version={{
              id: shot.latest_completed_version!.id,
              label: shot.name,
              status: 'complete',
            }}
            size="card"
          />
        ) : (
          <SkeletonThumbnail width={220} height={124} />
        )}
      </button>

      {/* (c) QuickApproveButton — only when hasVersion (D-10 hover-only) */}
      {hasVersion ? (
        <QuickApproveButton
          shotId={shot.id}
          shotName={shot.name}
          currentStatus={shot.status}
        />
      ) : null}

      <div class="flex flex-col gap-1 p-2 text-[var(--color-fg)]">
        <div class="flex items-center justify-between gap-2">
          {/* (b) ShotStatusPill button — opens review panel (D-01 two-affordance card) */}
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
        {hasVersion ? (
          <span class="num text-xs text-[var(--color-fg-muted)]">
            {SHOT_CARD_LAST_UPDATED_PREFIX}
            {formatRelativeTime(shot.latest_completed_version!.completed_at)}
          </span>
        ) : null}
      </div>

      {/* Inline error pill — quick-approve failed */}
      {quickApproveErr ? (
        <div
          class="absolute inset-x-2 bottom-2"
          aria-live="polite"
          aria-atomic="true"
        >
          <WarningPill
            label={REVIEW_QUICK_APPROVE_FAIL_LABEL}
            ariaLabel={REVIEW_QUICK_APPROVE_FAIL_ARIA}
          />
        </div>
      ) : null}
    </div>
  );

  if (isOmit) {
    return <div class="opacity-40 transition-opacity">{cardBody}</div>;
  }
  return cardBody;
}

// Silence unused-import warnings for openVersionDrawer (kept as an
// import marker for callers wanting to migrate from onSelect-prop callback
// to direct helper usage).
void openVersionDrawer;
