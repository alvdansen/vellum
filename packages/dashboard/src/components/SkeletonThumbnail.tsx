/**
 * SkeletonThumbnail — animated placeholder shown before a version thumbnail
 * loads (or when output is missing on disk).
 *
 * Pure component: props-in, no callbacks (read-only display).
 *
 * Uses the animate-skeleton-shimmer keyframe from theme.css (respects
 * prefers-reduced-motion — falls back to a static gray block).
 *
 * Default dimensions match the shot-detail version-card grid (160x90, 16:9).
 * Callers can override for different contexts (drawer thumbnails, nav icons).
 */

export interface SkeletonThumbnailProps {
  width?: number;
  height?: number;
}

export function SkeletonThumbnail({
  width = 160,
  height = 90,
}: SkeletonThumbnailProps) {
  return (
    <div
      class="animate-skeleton-shimmer rounded"
      style={{ width: `${width}px`, height: `${height}px` }}
      aria-hidden="true"
      role="presentation"
    />
  );
}
