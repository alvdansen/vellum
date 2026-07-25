/**
 * Thumbnail — thin presentational wrapper component owning lazy-load
 * <img loading="lazy"> + skeleton fallback + C2PA shield overlay logic.
 *
 * Phase 17 / Plan 17-04 Task 3 primitive. Consumed by VersionCard +
 * TreeSidebar shot rows in Plan 17-05; this file ships the public API
 * contract (UI-SPEC §"<Thumbnail/> API contract" lines 181-237) so Plan 05
 * can plug it into the actual consumers without further coordination.
 *
 * Render contract (verbatim from UI-SPEC):
 *   - version.status !== 'complete' → <SkeletonThumbnail/> at the size
 *     variant's dimensions, aria-busy='true' on the wrapper (D-07 unified
 *     skeleton for in-progress / loading / failed)
 *   - version.status === 'complete' AND no thumbnail-fetch error →
 *     <img loading="lazy" src={getThumbnailUrl(version.id)} class="object-contain"
 *           alt={ariaLabel ?? defaultAlt} width={W} height={H} /> wrapped
 *     in <div class="relative aspect-video">
 *   - browser onerror fires → swap to <SkeletonThumbnail/> AND set
 *     aria-label='Preview unavailable for ${version.label}' (D-07 same shimmer)
 *   - c2paStatus.status === 'signed' AND complete AND no error → append
 *     <C2paShield/> absolute-positioned bottom-right (D-10 LOCKED — predicate
 *     is signed-only; unsigned + unknown + undefined render NO overlay)
 *
 * Dimensional contract (UI-SPEC §"Dimensional contract"):
 *   - size='card' (default): aspect-video w-full (height computed from width
 *     via 16:9 ratio); explicit width=640 height=360 HTML attrs for CLS=0
 *   - size='sm': aspect-video flex-shrink-0 with inline width: 80px style;
 *     explicit width=80 height=45 HTML attrs for CLS=0
 *
 * Click-target contract (UI-SPEC §"Click-target contract" + D-11 LOCKED):
 *   - <Thumbnail/> itself has NO click handler. Clicks bubble to the parent
 *     VersionCard <button> or TreeRow <div role="treeitem"> — both already
 *     own their own onClick wiring upstream of this component
 *
 * Performance contract (UI-SPEC §"Performance contract" + REQUIREMENTS.md
 * VIS-01):
 *   - loading="lazy" — browser-native lazy-load (NO IntersectionObserver shim)
 *   - explicit width + height HTML attributes — guarantees CLS=0 on initial paint
 *   - decoding="async" — frees the main thread during decode
 *
 * SECURITY notes (mirrors VersionCard.tsx T-5-06):
 *   - alt={ariaLabel ?? `Output for ${version.label}`} — JSX text interpolation;
 *     Preact escapes the version label as a TEXT_NODE attribute. No
 *     dangerouslySetInnerHTML is used.
 *
 * v1.2 NOTE: <Thumbnail/> is consumer-agnostic — it does NOT fetch
 * c2paStatus itself; the parent threads it down via prop. The existing
 * VersionDrawer pattern (auto-fetch via useEffect calling getC2paStatus)
 * is preserved verbatim by Plan 17-05's wiring.
 */

import { useState } from 'preact/hooks';
import { SkeletonThumbnail } from './SkeletonThumbnail.js';
import { C2paShield } from './C2paShield.js';
import { getThumbnailUrl } from '../lib/api.js';
import type { C2paStatus } from '../lib/api.js';
import { PREVIEW_UNAVAILABLE_PREFIX } from '../lib/copy.js';
import type { Status } from './StatusPill.js';

export type ThumbnailSize = 'card' | 'sm';

/**
 * Minimal version shape needed by Thumbnail. The full Version record from
 * the data layer (Phase 8 entities.ts) is structurally compatible — any
 * object with these fields satisfies the prop type. Mirrors the
 * VersionCardVersion pattern from VersionCard.tsx.
 */
export interface ThumbnailVersion {
  id: string;
  /**
   * Output filename — reserved for v1.3 multi-output; v1.2 server resolves
   * outputs_json[0].filename internally. v1.2 callers leave this undefined.
   */
  filename?: string;
  /**
   * Version status governs render path: 'complete' → real thumbnail;
   * otherwise → skeleton (D-07 unified treatment).
   */
  status: Status;
  /**
   * Free-form label used for accessible alt text (e.g., 'v003'). Mirrors
   * VersionCard's existing `Output for ${version.label}` string verbatim.
   */
  label: string;
}

export interface ThumbnailProps {
  /** Version metadata required for URL derivation + state-driven render. */
  version: ThumbnailVersion;
  /**
   * 'card' = aspect-video full-width (VersionCard parent);
   * 'sm' = 80×45 fixed (TreeSidebar shot row).
   * Default: 'card'.
   */
  size?: ThumbnailSize;
  /**
   * C2PA signing status. When undefined or not 'signed', NO shield is
   * rendered (D-10 LOCKED). Source of truth is the X-C2PA-Signing-Status
   * response header from HEAD /api/versions/:id/output (Phase 14 contract);
   * dashboard consumes via getC2paStatus from lib/api.ts.
   */
  c2paStatus?: C2paStatus;
  /** Optional class for the outermost wrapper (composition with parent). */
  class?: string;
  /**
   * Optional ARIA label override; defaults to `Output for ${version.label}`
   * (preserves the existing VersionCard.tsx:55 string verbatim — no churn
   * for SR users; preserves existing test assertions).
   */
  ariaLabel?: string;
}

export function Thumbnail({
  version,
  size = 'card',
  c2paStatus,
  class: className,
  ariaLabel,
}: ThumbnailProps) {
  const [imgError, setImgError] = useState(false);
  const [, setImgLoaded] = useState(false);

  const isComplete = version.status === 'complete';
  const showSkeleton = !isComplete || imgError;

  // Wrapper class matrix per UI-SPEC §"Dimensional contract".
  // 'card' → fluid width via aspect-video w-full
  // 'sm'   → flex-shrink-0 + inline width: 80px style (TreeSidebar density)
  const wrapperClass =
    size === 'sm'
      ? 'relative block aspect-video flex-shrink-0 overflow-hidden rounded'
      : 'relative block aspect-video w-full overflow-hidden rounded';
  const wrapperStyle = size === 'sm' ? { width: '80px' } : undefined;

  // Skeleton render path — D-07 unified treatment for queued/running/failed
  // AND browser-onerror fallback (no broken image icons; same shimmer).
  if (showSkeleton) {
    const skelW = size === 'sm' ? 80 : 640;
    const skelH = size === 'sm' ? 45 : 360;
    return (
      <div
        class={`${wrapperClass}${className ? ` ${className}` : ''}`}
        style={wrapperStyle}
        aria-busy={!isComplete ? 'true' : undefined}
        aria-label={
          imgError ? `${PREVIEW_UNAVAILABLE_PREFIX}${version.label}` : undefined
        }
      >
        <SkeletonThumbnail width={skelW} height={skelH} />
      </div>
    );
  }

  // Complete + no error render path — real <img> + optional shield.
  // Shield class matrix per UI-SPEC §"Spacing Scale" Phase 17 fixed-pixel
  // exceptions table:
  //   sm:   absolute right-1 bottom-1 h-3.5 w-3.5  (4px offset, 14×14 px)
  //   card: absolute right-1.5 bottom-1.5 h-5 w-5  (6px offset, 20×20 px)
  const shieldClass =
    size === 'sm'
      ? 'absolute right-1 bottom-1 h-3.5 w-3.5'
      : 'absolute right-1.5 bottom-1.5 h-5 w-5';
  // Explicit width + height HTML attributes for CLS=0 (REQUIREMENTS.md VIS-01).
  // 'card' uses 640×360 as the intrinsic-ratio attributes; CSS aspect-video +
  // w-full lets the browser compute the actual rendered size from the ratio.
  const widthAttr = size === 'sm' ? 80 : 640;
  const heightAttr = size === 'sm' ? 45 : 360;

  return (
    <div
      class={`${wrapperClass}${className ? ` ${className}` : ''}`}
      style={wrapperStyle}
    >
      <img
        src={getThumbnailUrl(version.id)}
        alt={ariaLabel ?? `Output for ${version.label}`}
        class="block h-full w-full object-contain"
        loading="lazy"
        decoding="async"
        width={widthAttr}
        height={heightAttr}
        onLoad={() => setImgLoaded(true)}
        onError={() => setImgError(true)}
      />
      {c2paStatus?.status === 'signed' && <C2paShield class={shieldClass} />}
    </div>
  );
}
