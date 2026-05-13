/**
 * ShotGridCard — single shot tile for the shot-grid CSS Grid.
 *
 * Pure component: props-in, single onSelect callback. No fetch, no signal
 * reads. Composed from <Thumbnail/> (Phase 17) + <SkeletonThumbnail/> (Phase 17
 * fallback) + <ShotStatusPill/> (Wave 2) + formatRelativeTime (Wave 1).
 *
 * D-16: entire card is a single <button> with aria-label="Open version
 * drawer for {shotName}". Click target = whole 220×~140px card.
 * D-19: when latest_completed_version === null, render SkeletonThumbnail +
 * aria-disabled="true" + skip onClick wiring.
 * D-17 (omit dimming): when status === 'omit', wrap in opacity-40 div.
 *
 * Parent (ShotGridView, Wave 4) owns the `.map((shot) =>
 * <ShotGridCard key={shot.id} ... />)` — key is NOT set inside this component
 * (Pitfall 5).
 *
 * SECURITY — T-5-06 / VersionCard precedent: shot.name + version count
 * + relative timestamp render as JSX text children (Preact auto-escapes).
 */

import type { ShotGridRow } from '../types/shot-grid.js';
import { ShotStatusPill } from './ShotStatusPill.js';
import { Thumbnail } from './Thumbnail.js';
import { SkeletonThumbnail } from './SkeletonThumbnail.js';
import { formatRelativeTime } from '../lib/time.js';
import {
  SHOT_CARD_OPEN_ARIA_PREFIX,
  SHOT_CARD_VERSION_COUNT_SINGULAR,
  SHOT_CARD_VERSION_COUNT_PLURAL_SUFFIX,
  SHOT_CARD_NO_VERSIONS,
  SHOT_CARD_LAST_UPDATED_PREFIX,
} from '../lib/copy.js';

export interface ShotGridCardProps {
  shot: ShotGridRow;
  onSelect: (versionId: string) => void;
}

/**
 * Render the version-count copy variant for a shot row.
 *   0 → SHOT_CARD_NO_VERSIONS ('No versions yet')
 *   1 → SHOT_CARD_VERSION_COUNT_SINGULAR ('1 version')
 *   n → `${n} versions`  (uses SHOT_CARD_VERSION_COUNT_PLURAL_SUFFIX)
 */
function formatVersionCount(n: number): string {
  if (n === 0) return SHOT_CARD_NO_VERSIONS;
  if (n === 1) return SHOT_CARD_VERSION_COUNT_SINGULAR;
  return `${n}${SHOT_CARD_VERSION_COUNT_PLURAL_SUFFIX}`;
}

export function ShotGridCard({ shot, onSelect }: ShotGridCardProps) {
  const hasVersion = shot.latest_completed_version !== null;
  const disabled = !hasVersion;
  const isOmit = shot.status === 'omit';

  // D-19: skip onClick entirely when no latest version (assistive-tech
  // friendly — the button is also natively `disabled` so keyboard activation
  // is suppressed by the browser even if onClick were defined).
  const handleClick = hasVersion
    ? () => onSelect(shot.latest_completed_version!.id)
    : undefined;

  const button = (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`${SHOT_CARD_OPEN_ARIA_PREFIX}${shot.name}`}
      // aria-disabled MUST be the string 'true' or absent; `|| undefined`
      // collapses the attribute away when the card is enabled.
      aria-disabled={disabled || undefined}
      disabled={disabled}
      class={`w-full overflow-hidden rounded text-left transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
        disabled
          ? 'cursor-default'
          : 'hover:shadow-[0_0_0_1px_var(--color-border)]'
      }`}
    >
      {hasVersion ? (
        <Thumbnail
          version={{
            id: shot.latest_completed_version!.id,
            label: shot.name,
            // Hard-coded 'complete' — Thumbnail's contract is per-version
            // status, but the shot grid only invokes Thumbnail when the
            // shot HAS a completed version. PATTERNS §17 landmine.
            status: 'complete',
          }}
          size="card"
        />
      ) : (
        // 220×124 = 16:9 ratio of the locked card width (D-16, UI-SPEC line 52).
        <SkeletonThumbnail width={220} height={124} />
      )}
      <div class="flex flex-col gap-1 p-2 text-[var(--color-fg)]">
        <div class="flex items-center justify-between gap-2">
          <ShotStatusPill status={shot.status} />
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
    </button>
  );

  // D-17: omit shots get an opacity-40 wrapper. The pill itself stays at
  // 100% opacity so the status label remains WCAG-AA legible against the
  // dimmed thumbnail / name.
  if (isOmit) {
    return <div class="opacity-40 transition-opacity">{button}</div>;
  }
  return button;
}
