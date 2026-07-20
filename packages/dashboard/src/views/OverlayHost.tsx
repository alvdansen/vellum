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
import {
  fetchVersion,
  fetchVersions,
  fetchShotStatusHistory,
} from '../lib/api.js';
import { selectedVersionId, versions } from '../state/versions.js';
import {
  activeOverlay,
  activeReviewShotId,
} from '../state/review-panel.js';
import { shotGrid } from '../state/shot-grid.js';
import { VersionDrawer } from './VersionDrawer.js';
import { ReviewPanel } from './ReviewPanel.js';
import type { Version } from '../types/entities.js';
import type { ShotStatusEvent } from '../types/review-panel.js';
import type { ShotStatus } from '../types/shot-grid.js';
import {
  REVIEW_PANEL_ARIA_LABEL_PREFIX,
  REVIEW_PANEL_LOADING_LABEL,
  REVIEW_HISTORY_FETCH_ERROR,
} from '../lib/copy.js';

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
            'vellum: VersionDrawerHost fetchVersion failed; clearing selection.',
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
// ReviewPanelHostInternal — Phase 22 ReviewPanel mount + cache-miss fetch.
// Replaces the 22-04 placeholder with the real composition. Fetches the
// shot's versions + status history in parallel; renders a loading shell
// (aside with REVIEW_PANEL_LOADING_LABEL) until both resolve, then mounts
// <ReviewPanel/>. SSE updates flow via shotGrid.value reads (header pill
// keys on currentShot.status so it re-renders on every store mutation).
// ============================================================================

function ReviewPanelHostInternal({
  shotId,
}: {
  shotId: string;
}): JSX.Element {
  const currentShot = shotGrid.value?.shots.find((s) => s.id === shotId);
  const shotName = currentShot?.name ?? shotId;
  const currentStatus: ShotStatus =
    (currentShot?.status as ShotStatus | undefined) ?? 'wip';

  const [data, setData] = useState<{
    versions: Version[];
    statusHistory: ShotStatusEvent[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setLoadError(null);
    Promise.all([
      fetchVersions(shotId, {}),
      fetchShotStatusHistory(shotId),
    ])
      .then(([versionsResp, historyResp]) => {
        if (!alive) return;
        setData({
          versions: versionsResp.items ?? [],
          statusHistory: historyResp.history,
        });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (typeof console !== 'undefined') {
          console.warn(
            'vellum: ReviewPanelHost fetch failed.',
            err,
          );
        }
        setLoadError(REVIEW_HISTORY_FETCH_ERROR);
      });
    return () => {
      alive = false;
    };
  }, [shotId]);

  if (data === null) {
    return (
      <aside
        role="dialog"
        aria-label={`${REVIEW_PANEL_ARIA_LABEL_PREFIX}${shotName}`}
        aria-busy={loadError === null ? 'true' : 'false'}
        class="fixed inset-y-0 right-0 z-10 flex flex-col gap-4 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-xl"
        style={{ width: 'var(--drawer-version-width)' }}
        data-testid="review-panel-loading"
      >
        <p class="text-sm text-[var(--color-fg-muted)]">
          {loadError ?? REVIEW_PANEL_LOADING_LABEL}
        </p>
      </aside>
    );
  }

  return (
    <ReviewPanel
      shotId={shotId}
      shotName={shotName}
      currentStatus={currentStatus}
      versions={data.versions}
      statusHistory={data.statusHistory}
      onClose={closeOverlay}
    />
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
