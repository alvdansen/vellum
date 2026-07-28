/**
 * App — root component. Owns:
 *   - Top-level layout (header with home button + brand + ThemeToggle;
 *     flexible body)
 *   - Boot hydration (URL state hydrated before SSE — see below)
 *   - SSE lifecycle (startSse on mount, stopSse on unmount)
 *   - SSE → signals bridge:
 *       onSseEvent('version.created', onVersionCreated)
 *       onSseEvent('version.status_changed', onVersionStatusChanged)
 *       onSseEvent('shot.status_changed', onShotStatusChanged)
 *   - View routing (signal-driven):
 *       activeView === 'home'      → <HomeView/>
 *       activeView === 'shot-grid' → <ShotGridView/>
 *   - Global overlays: <OverlayHost/> branches on
 *     activeOverlay between ReviewPanel and VersionDrawer regardless of
 *     activeView. Pattern: any future overlay keyed on a global signal
 *     mounts as a sibling of <AppBody> here, not inside a view.
 *
 * Header navigation:
 *   - Home button is a <button aria-label="Back to home view"> with the
 *     lucide-preact Home icon at size 16; positioned BEFORE the brand text
 *     inside a flex container. The button's color reflects the active
 *     view: accent when home is active, muted otherwise.
 *   - The third SSE handler ('shot.status_changed') routes to
 *     `onShotStatusChanged` from state/shot-grid.ts (the same module-scope
 *     reference is passed to both on/offSseEvent so events.ts:116
 *     listeners.delete(fn) succeeds — reference-equality contract).
 *   - The body now conditionally renders HomeView or ShotGridView based on
 *     activeView. activeView is module-singleton in state/shot-grid.ts; any
 *     consumer (the TreeSidebar grid-icon via HomeView, the home button
 *     above, URL hydrateShotGridUrlState) writing to it flips the view.
 *
 * Boot-order rationale:
 *   - URL hydration runs HERE, before SSE subscription. Previously each
 *     view called its own hydrate function inside a useEffect in the view
 *     component, so the URL-keyed signals (activeView, treeSort, gridSort)
 *     could not flip until the matching view had already mounted —
 *     chicken-and-egg for `?view=shot-grid` deep links. Hoisting hydrate
 *     into App.tsx makes mount-time URL state authoritative for view
 *     routing.
 *
 * Pure glue — no fetch (views own their own hydration), no mutation other
 * than signal updates via the SSE bridge + the home button click handler.
 *
 * SECURITY: brand text + aria-label are literals from copy.ts;
 * no dynamic HTML rendering here.
 */

import { useEffect } from 'preact/hooks';
import { Home, Inbox } from 'lucide-preact';
import { HomeView } from './views/HomeView.js';
import { ShotGridView } from './views/ShotGridView.js';
import { ApprovalsPanel } from './views/ApprovalsPanel.js';
import { ActiveGenerationsPanel } from './views/ActiveGenerationsPanel.js';
import { OverlayHost } from './views/OverlayHost.js';
import { ABCompareHost } from './views/ABCompareHost.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { startSse, stopSse, onSseEvent, offSseEvent } from './lib/events.js';
import {
  onVersionCreated,
  onVersionStatusChanged,
} from './state/active-generations.js';
import {
  activeView,
  onShotStatusChanged,
  persistShotGridUrlState,
  hydrateShotGridUrlState,
} from './state/shot-grid.js';
import {
  pendingProposalCount,
  loadProposalCounts,
} from './state/proposals.js';
import { hydrateSortState } from './lib/sortHelpers.js';
import { gridSort } from './state/versions.js';
import { treeSort } from './state/hierarchy.js';
import {
  HEADER_HOME_ARIA_LABEL,
  APPROVALS_NAV_ARIA_LABEL,
  APPROVALS_NAV_BADGE_ARIA_PREFIX,
  APPROVALS_NAV_BADGE_ARIA_SUFFIX,
} from './lib/copy.js';

export function App() {
  useEffect(() => {
    // Hydrate URL state BEFORE SSE bridges.
    // The order matters: hydrateShotGridUrlState() may flip activeView
    // before any view component mounts, ensuring the correct view surface
    // renders on first paint for a deep link like `?view=shot-grid&seq=…`.
    // hydrateSortState() reconciles URL > localStorage > defaults for
    // gridSort/treeSort signals; applied here so the
    // values are stable before HomeView's page-1 fetch effect runs.
    hydrateShotGridUrlState();
    const { gridSort: initGrid, treeSort: initTree } = hydrateSortState();
    gridSort.value = initGrid;
    treeSort.value = initTree;

    // Populate the header approvals badge (pending-spend backlog). Fire-and-
    // forget; the ApprovalsPanel re-fetches on its own mount + after decides.
    void loadProposalCounts();

    onSseEvent('version.created', onVersionCreated);
    onSseEvent('version.status_changed', onVersionStatusChanged);
    // Module-scope onShotStatusChanged reference. The
    // SAME function ref is passed to offSseEvent below so events.ts:116
    // Set.delete(fn) finds it; lifting the handler into state/shot-grid.ts
    // makes the module export reference-stable across renders.
    onSseEvent('shot.status_changed', onShotStatusChanged);
    startSse();
    return () => {
      offSseEvent('version.created', onVersionCreated);
      offSseEvent('version.status_changed', onVersionStatusChanged);
      offSseEvent('shot.status_changed', onShotStatusChanged);
      stopSse();
    };
  }, []);

  const view = activeView.value;
  const isHome = view === 'home';
  const isApprovals = view === 'approvals';
  const pending = pendingProposalCount.value;

  return (
    <div class="flex h-screen flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
      <header class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              activeView.value = 'home';
              // Mirror the view switch into the URL via replaceState so a
              // refresh or share-link reflects the home view. Idempotent.
              persistShotGridUrlState();
            }}
            aria-label={HEADER_HOME_ARIA_LABEL}
            aria-current={isHome ? 'page' : undefined}
            class={`flex h-7 w-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
              isHome
                ? 'text-[var(--color-accent)]'
                : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
            }`}
          >
            <Home size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              activeView.value = 'approvals';
              persistShotGridUrlState();
            }}
            aria-label={
              pending > 0
                ? `${APPROVALS_NAV_ARIA_LABEL}${APPROVALS_NAV_BADGE_ARIA_PREFIX}${pending}${APPROVALS_NAV_BADGE_ARIA_SUFFIX}`
                : APPROVALS_NAV_ARIA_LABEL
            }
            aria-current={isApprovals ? 'page' : undefined}
            class={`relative flex h-7 w-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
              isApprovals
                ? 'text-[var(--color-accent)]'
                : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
            }`}
          >
            <Inbox size={16} />
            {pending > 0 ? (
              <span
                class="absolute -right-1 -top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-[var(--color-shot-status-pending-review)] px-1 text-[10px] font-semibold leading-none tabular-nums text-[var(--color-bg)]"
                data-testid="approvals-nav-badge"
                aria-hidden="true"
              >
                {pending > 99 ? '99+' : pending}
              </span>
            ) : null}
          </button>
          <span
            class="text-sm font-semibold text-[var(--color-accent)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Vellum
          </span>
        </div>
        <ThemeToggle />
      </header>
      <div class="flex flex-1 overflow-hidden">
        <div class="flex-1 overflow-hidden">
          {isHome ? (
            <HomeView />
          ) : isApprovals ? (
            <ApprovalsPanel />
          ) : (
            <ShotGridView />
          )}
        </div>
        {isApprovals ? null : <ActiveGenerationsPanel />}
      </div>
      {/* Generalised overlay host — overlays are mutually exclusive.
       *  OverlayHost branches on activeOverlay between ReviewPanel and
       *  VersionDrawer; a backward-compat fallback covers the legacy
       *  selectedVersionId direct-mutation flow (its open/close
       *  invariants are preserved). ABCompareHost sibling renders the
       *  z-30 A/B compare modal when compareModalOpen=true (placeholder
       *  until the real ABCompareView composition lands). */}
      <OverlayHost />
      <ABCompareHost />
    </div>
  );
}
