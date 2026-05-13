/**
 * App — root component. Owns:
 *   - Top-level layout (header with home button + brand + ThemeToggle;
 *     flexible body)
 *   - Boot hydration (Phase 21 / Plan 21-06 gap closure — see below)
 *   - SSE lifecycle (startSse on mount, stopSse on unmount per D-WEBUI-03)
 *   - SSE → signals bridge:
 *       onSseEvent('version.created', onVersionCreated)
 *       onSseEvent('version.status_changed', onVersionStatusChanged)
 *       onSseEvent('shot.status_changed', onShotStatusChanged)  — Phase 21
 *   - View routing (signal-driven; D-03):
 *       activeView === 'home'      → <HomeView/>
 *       activeView === 'shot-grid' → <ShotGridView/>
 *
 * Phase 21 / Plan 21-04 Task T02:
 *   - Home button is a <button aria-label="Back to home view"> with the
 *     lucide-preact Home icon at size 16; positioned BEFORE the brand text
 *     inside a flex container (D-03). The button's color reflects the active
 *     view: accent when home is active, muted otherwise.
 *   - The third SSE handler ('shot.status_changed') routes to
 *     `onShotStatusChanged` from state/shot-grid.ts (the same module-scope
 *     reference is passed to both on/offSseEvent so events.ts:116
 *     listeners.delete(fn) succeeds — D-22 reference-equality contract).
 *   - The body now conditionally renders HomeView or ShotGridView based on
 *     activeView. activeView is module-singleton in state/shot-grid.ts; any
 *     consumer (the TreeSidebar grid-icon via HomeView, the home button
 *     above, URL hydrateShotGridUrlState) writing to it flips the view.
 *
 * Phase 21 / Plan 21-06 (gap closure — 21-AUDIT.md root pattern):
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
 * SECURITY — T-5-06: brand text + aria-label are literals from copy.ts;
 * no dynamic HTML rendering here.
 */

import { useEffect } from 'preact/hooks';
import { Home } from 'lucide-preact';
import { HomeView } from './views/HomeView.js';
import { ShotGridView } from './views/ShotGridView.js';
import { ActiveGenerationsPanel } from './views/ActiveGenerationsPanel.js';
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
import { hydrateSortState } from './lib/sortHelpers.js';
import { gridSort } from './state/versions.js';
import { treeSort } from './state/hierarchy.js';
import { HEADER_HOME_ARIA_LABEL } from './lib/copy.js';

export function App() {
  useEffect(() => {
    // Phase 21 / Plan 21-06 — hydrate URL state BEFORE SSE bridges.
    // The order matters: hydrateShotGridUrlState() may flip activeView
    // before any view component mounts, ensuring the correct view surface
    // renders on first paint for a deep link like `?view=shot-grid&seq=…`.
    // hydrateSortState() reconciles URL > localStorage > defaults for
    // gridSort/treeSort signals (D-13/D-15/D-16); applied here so the
    // values are stable before HomeView's page-1 fetch effect runs.
    hydrateShotGridUrlState();
    const { gridSort: initGrid, treeSort: initTree } = hydrateSortState();
    gridSort.value = initGrid;
    treeSort.value = initTree;

    onSseEvent('version.created', onVersionCreated);
    onSseEvent('version.status_changed', onVersionStatusChanged);
    // Phase 21 / D-22 — module-scope onShotStatusChanged reference. The
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

  const isHome = activeView.value === 'home';

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
            class={`flex h-7 w-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
              isHome
                ? 'text-[var(--color-accent)]'
                : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
            }`}
          >
            <Home size={16} />
          </button>
          <span
            class="text-sm font-semibold text-[var(--color-accent)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            VFX Familiar
          </span>
        </div>
        <ThemeToggle />
      </header>
      <div class="flex flex-1 overflow-hidden">
        <div class="flex-1 overflow-hidden">
          {isHome ? <HomeView /> : <ShotGridView />}
        </div>
        <ActiveGenerationsPanel />
      </div>
    </div>
  );
}
