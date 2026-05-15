/**
 * OverlayHost — generalised right-rail overlay mount host (D-02 / RESEARCH
 * Pattern 4).
 *
 * Reads the `activeOverlay` discriminator from state/review-panel.ts and
 * mounts EXACTLY ONE of:
 *  - `<ReviewPanelHostInternal/>` when activeOverlay='review' (Phase 22)
 *  - `<VersionDrawerHostInternal/>` when activeOverlay='version' (Phase 21)
 *
 * Mutex invariant (D-02): no two right-rail overlays mount simultaneously.
 * The three exported helpers (openVersionDrawer / openReviewPanel /
 * closeOverlay) are the ONLY sanctioned mutation paths — they keep
 * activeOverlay and its companion signals (selectedVersionId,
 * activeReviewShotId) in lockstep.
 *
 * Backward-compat shim: if `activeOverlay === null` but
 * `selectedVersionId !== null` (legacy direct-mutation callers — HomeView
 * still writes selectedVersionId directly in some paths), OverlayHost falls
 * back to rendering the version drawer. This preserves Phase 21 behavior
 * unchanged until those call sites migrate to `openVersionDrawer(id)`.
 *
 * Defensive guards: inconsistent state (e.g., activeOverlay='review' but
 * activeReviewShotId=null) renders null + console.warn. Never throws.
 *
 * Architecture-purity (D-WEBUI-31): only sibling and parent-relative imports.
 *
 * VersionDrawerHostInternal is the Phase 21 VersionDrawerHost component
 * body, copied verbatim into this file so the public VersionDrawerHost
 * (now a re-export shim from views/VersionDrawerHost.ts) stays a one-line
 * pass-through to OverlayHost — keeping the cache + fetch logic in ONE
 * place.
 */

import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { fetchVersion } from '../lib/api.js';
import { selectedVersionId, versions } from '../state/versions.js';
import {
  activeOverlay,
  activeReviewShotId,
} from '../state/review-panel.js';
import { VersionDrawer } from './VersionDrawer.js';
import type { Version } from '../types/entities.js';
import { REVIEW_PANEL_ARIA_LABEL_PREFIX } from '../lib/copy.js';

// ============================================================================
// VersionDrawerHostInternal — Phase 21 VersionDrawerHost logic, verbatim.
// Lives here so the public VersionDrawerHost shim (re-exported from
// views/VersionDrawerHost.ts) can stay a one-liner. Behavior unchanged:
//  - Reads selectedVersionId; returns null when null
//  - Cache hit via versions.value (Phase 5-10 flow)
//  - Cache miss → fetchVersion(id) + local cache by id; transparent render
//    until resolved
//  - Fetch failure → console.warn + clear selectedVersionId (graceful)
//  - priorVersion derived from cache when possible; null otherwise (View
//    Diff degrades gracefully)
// ============================================================================

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

function VersionDrawerHostInternal(): JSX.Element | null {
  const [fetched, setFetched] = useState<Record<string, Version>>({});
  const currentId = selectedVersionId.value;
  const cached = currentId
    ? versions.value.find((v) => v.id === currentId) ?? null
    : null;

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

  if (!currentId) return null;

  const resolved: Version | null = cached ?? fetched[currentId] ?? null;
  if (!resolved) return null;

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

// ============================================================================
// ReviewPanelHostInternal — Phase 22 review panel placeholder.
// Plan 22-05 replaces this with the full ReviewPanel composition. For now,
// renders a minimal aside so OverlayHost integration tests can assert
// shotId pass-through.
// ============================================================================

function ReviewPanelHostInternal({
  shotId,
}: {
  shotId: string;
}): JSX.Element {
  return (
    <aside
      role="dialog"
      aria-label={`${REVIEW_PANEL_ARIA_LABEL_PREFIX}${shotId}`}
      data-testid="review-panel-placeholder"
      data-shot-id={shotId}
      class="fixed inset-y-0 right-0 z-10 flex flex-col gap-4 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-xl"
      style={{ width: 'var(--drawer-version-width)' }}
    >
      Review for {shotId}
    </aside>
  );
}

// ============================================================================
// Public OverlayHost — discriminator branch over activeOverlay.
// ============================================================================

export function OverlayHost(): JSX.Element | null {
  const overlay = activeOverlay.value;

  if (overlay === null) {
    // Backward-compat fallback: legacy callers writing selectedVersionId
    // directly without flipping activeOverlay still get the version drawer.
    if (selectedVersionId.value !== null) {
      return <VersionDrawerHostInternal />;
    }
    return null;
  }

  if (overlay === 'review') {
    const shotId = activeReviewShotId.value;
    if (shotId === null) {
      if (typeof console !== 'undefined') {
        console.warn(
          'OverlayHost: activeOverlay=review but activeReviewShotId is null',
        );
      }
      return null;
    }
    return <ReviewPanelHostInternal shotId={shotId} />;
  }

  if (overlay === 'version') {
    if (selectedVersionId.value === null) {
      if (typeof console !== 'undefined') {
        console.warn(
          'OverlayHost: activeOverlay=version but selectedVersionId is null',
        );
      }
      return null;
    }
    return <VersionDrawerHostInternal />;
  }

  return null;
}

// ============================================================================
// Mutex helpers — the only sanctioned mutation paths.
// ============================================================================

/**
 * Open the VersionDrawer for `versionId`. Flips activeOverlay='version',
 * writes selectedVersionId, clears any in-flight review-panel shot id.
 * Mutex-safe: review panel (if open) unmounts on the next render.
 */
export function openVersionDrawer(versionId: string): void {
  selectedVersionId.value = versionId;
  activeOverlay.value = 'version';
  activeReviewShotId.value = null;
}

/**
 * Open the ReviewPanel for `shotId`. Flips activeOverlay='review', writes
 * activeReviewShotId. Does NOT clear selectedVersionId — the version drawer
 * can remain "selected in the cache" so a subsequent openVersionDrawer hits
 * the fast path.
 */
export function openReviewPanel(shotId: string): void {
  activeReviewShotId.value = shotId;
  activeOverlay.value = 'review';
}

/**
 * Close any open right-rail overlay. Clears all three signals so the next
 * open call starts from a clean slate.
 */
export function closeOverlay(): void {
  activeOverlay.value = null;
  selectedVersionId.value = null;
  activeReviewShotId.value = null;
}
