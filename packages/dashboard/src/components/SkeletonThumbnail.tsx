/**
 * SkeletonThumbnail — animated placeholder shown before a version thumbnail
 * loads (or when output is missing on disk).
 *
 * Pure component: props-in, no callbacks (read-only display).
 *
 * Uses the animate-skeleton-shimmer keyframe from theme.css (respects
 * prefers-reduced-motion — falls back to a static gray block).
 *
 * Two modes:
 *  - `fill` — stretch to the parent. Use inside any fluid wrapper that
 *    already dictates the shape (aspect-video w-full cards, the drawer).
 *    Fixed-pixel skeletons inside fluid wrappers were the bug: a 640x360
 *    block floating in a 1388x781 card left the rest of the card dead, and
 *    at narrow widths it overflowed and clipped.
 *  - fixed width/height — only for slots that are genuinely fixed-size
 *    (the 80x45 tree-sidebar thumb). Defaults 160x90 (16:9).
 */

export interface SkeletonThumbnailProps {
  width?: number;
  height?: number;
  /** Stretch to the parent instead of fixed pixels. Wins over width/height. */
  fill?: boolean;
}

export function SkeletonThumbnail({
  width = 160,
  height = 90,
  fill = false,
}: SkeletonThumbnailProps) {
  return (
    <div
      class={`animate-skeleton-shimmer rounded${fill ? ' h-full w-full' : ''}`}
      style={fill ? undefined : { width: `${width}px`, height: `${height}px` }}
      aria-hidden="true"
      role="presentation"
    />
  );
}
