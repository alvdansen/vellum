/**
 * VersionDrawerHost — view-independent overlay that resolves the selected
 * version and renders <VersionDrawer/> regardless of activeView.
 *
 * Phase 21 / Plan 21-06 — gap closure for 21-AUDIT.md Bugs 2 and 5.
 *
 * Why a Host wrapper:
 *   - Bug 2 (D-19 violation): the original <VersionDrawer/> render lived
 *     inside HomeView, so flipping activeView to 'shot-grid' unmounted it
 *     (App.tsx:105 ternary mount switch). The overlay must persist across
 *     view changes.
 *   - Bug 5 (drawer data model): HomeView resolved `selectedVersion` from
 *     `versions.value`, which only holds versions for the currently-selected
 *     shot (HomeView's left-pane tree state). Shot-grid card clicks write
 *     arbitrary version ids that are unlikely to be in that cache, so the
 *     drawer rendered with `selectedVersion === null` and the user saw a
 *     blank overlay.
 *
 * Composition contract (preserves <VersionDrawer/>'s 3-prop interface verbatim):
 *   - Reads `selectedVersionId` signal from state/versions.ts
 *   - Returns null when selectedVersionId is null (drawer closed)
 *   - Fast path: if the id is in `versions.value` cache, render immediately
 *     (no fetch — preserves HomeView's existing flow speed)
 *   - Cache miss: call `fetchVersion(id)`, store result in local state,
 *     render once resolved. During the fetch, render null (transparent
 *     placeholder — the fetch is usually < 100ms and the click animation
 *     covers it).
 *   - On fetch failure: console.warn + clear selectedVersionId (graceful
 *     degradation; matches the audit's recommended defensive pattern for
 *     hydrate failures).
 *   - priorVersion: derived from cache when possible (same shot, version_number
 *     less than current). For cache-miss fetches we don't know the shot's
 *     other versions without a second list fetch, so priorVersion is null —
 *     View Diff button degrades gracefully (an established UX pattern;
 *     pre-existing).
 *
 * Architecture-purity (D-WEBUI-31): zero server-tree relative imports.
 *
 * SECURITY (T-5-06): no dynamic content surface here — VersionDrawer renders
 * the version data via auto-escaped JSX text children.
 */

import { useEffect, useState } from 'preact/hooks';
import { fetchVersion } from '../lib/api.js';
import { selectedVersionId, versions } from '../state/versions.js';
import type { Version } from '../types/entities.js';
import { VersionDrawer } from './VersionDrawer.js';

/**
 * Compute the prior version (next-lower `version_number` for the same shot)
 * from the cached versions list. Returns null when not derivable — either
 * the selected version has no version_number, or there are no lower-numbered
 * versions in the cache for this shot.
 *
 * Replicates the inline priorVersion derivation that used to live in
 * HomeView.tsx (Phase 5-10). Preserved verbatim shape so DiffDrawer's
 * caller-side contract stays identical.
 */
function derivePriorVersion(
  selected: Version,
  cache: readonly Version[],
): Version | null {
  if (typeof selected.version_number !== 'number') return null;
  const candidates = cache
    .filter(
      (v) =>
        v.shot_id === selected.shot_id &&
        typeof v.version_number === 'number' &&
        v.version_number < (selected.version_number as number),
    )
    .sort(
      (a, b) =>
        (b.version_number as number) - (a.version_number as number),
    );
  return candidates[0] ?? null;
}

export function VersionDrawerHost() {
  // Local cache for cache-miss fetch results. Keyed by id so a rapid
  // open-A → open-B → open-A flow reuses the first fetch result.
  const [fetched, setFetched] = useState<Record<string, Version>>({});

  const currentId = selectedVersionId.value;

  // Fast-path cache lookup — versions.value covers the home-flow scenario
  // (clicked version is for the currently-selected shot).
  const cached = currentId
    ? versions.value.find((v) => v.id === currentId) ?? null
    : null;

  // Cache-miss fetch effect. Fires only when (a) we have an id, (b) the id
  // isn't in the home cache, and (c) we haven't already fetched it.
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
        // Graceful degradation — log + clear so the overlay closes rather
        // than rendering an empty drawer. Mirrors hydrate failure pattern
        // (state/shot-grid.ts hydrateShotGridUrlState).
        if (typeof console !== 'undefined') {
          console.warn(
            'vfx-familiar: VersionDrawerHost fetchVersion failed; clearing selection.',
            err,
          );
        }
        selectedVersionId.value = null;
      });
    return () => {
      alive = false;
    };
  }, [currentId, cached, fetched]);

  // Drawer closed.
  if (!currentId) return null;

  // Resolution order: cache hit (versions.value) first, then locally-fetched.
  const resolved: Version | null =
    cached ?? (fetched[currentId] ?? null);

  // Pre-resolution state — transparent placeholder. Fetches are typically
  // sub-100ms and the click ripple covers them. If/when a longer-running
  // surface (e.g. a paid-tier diff prefetch) is added, swap in a Skeleton
  // here.
  if (!resolved) return null;

  // priorVersion is best-effort from cache. For grid-card clicks the cache
  // typically does NOT contain the resolved version, so priorVersion is
  // null — View Diff degrades to disabled (pre-existing UX).
  const priorVersion = derivePriorVersion(resolved, versions.value);

  return (
    <VersionDrawer
      version={resolved}
      priorVersion={priorVersion}
      onClose={() => {
        selectedVersionId.value = null;
      }}
    />
  );
}
