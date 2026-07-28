/**
 * packages/dashboard/src/state/shot-grid.ts
 *
 * Co-locates the ShotGridView signal bag, the SSE-driven
 * `onShotStatusChanged` handler, the `aggregateCounts` computed
 * value, and the URL-state hydrate/persist helpers. The view
 * (`<ShotGridView/>`) consumes these by direct import.
 *
 * Architecture-purity invariant: this file performs zero
 * server-tree relative-import traversals — only the dashboard-local
 * `../types/*` barrels and the `@preact/signals` + `zod` libraries.
 *
 * Landmines preserved:
 *   - DO NOT subscribe to SSE inside this module's top level. The
 *     subscription belongs in `App.tsx`'s useEffect so the
 *     register/unregister lifecycle is tied to the dashboard mount.
 *   - DO NOT call `persistShotGridUrlState()` at module top level.
 *     Callers invoke it explicitly after signal mutations (consumer
 *     pattern matches the `persistGridSort` precedent).
 *   - DO NOT use `history` push semantics — this file locks `replaceState` only.
 *     Filter and view changes are view settings, not navigation events;
 *     they must not pollute browser back-stack.
 *   - DO NOT throw on URL parse failures — follow the graceful
 *     fallback: log `console.warn` and return defaults.
 */

import { signal, computed } from '@preact/signals';
import { z } from 'zod';
import type { ShotStatusChangedPayload } from '../types/events.js';
import type { ShotGridResponse, ShotStatus } from '../types/shot-grid.js';

// ============================================================================
// SIGNALS
// ============================================================================

/**
 * Current view — toggled by the header home icon (→ 'home'), the TreeSidebar
 * grid-icon (→ 'shot-grid'), and the header approvals button (→ 'approvals',
 * the approval-gate inbox). Signal-driven view routing; no
 * router library added. Switching `activeView` does
 * NOT clear `selectedShotId` or `selectedSequenceForGrid`.
 */
export const activeView = signal<'home' | 'shot-grid' | 'approvals'>('home');

/**
 * Sequence-header expanded/collapsed state. Open by default by contract.
 *
 * Why module-level rather than component state:
 *   Moved from `useState` inside `<ShotGridView/>` because ShotGridView is
 *   unmounted whenever `activeView === 'home'`, which silently resets a
 *   useState back to its default. This is a
 *   view-independent concern — the contract says "session-only state (no
 *   localStorage)" which is exactly what a module-singleton signal provides:
 *   survives view remounts, resets on full page reload.
 *
 * Writers: <SequenceHeader/> chevron toggle inside ShotGridView. Readers:
 * ShotGridView's render branches that decide whether to render the body
 * (collapsed = hide grid + load-more footer).
 */
export const headerExpanded = signal<boolean>(true);

/**
 * Sequence id whose grid is currently displayed. Written by the
 * TreeSidebar grid-icon click handler. Independent of HomeView's
 * `selectedShotId`.
 */
export const selectedSequenceForGrid = signal<string | null>(null);

/**
 * The paginated shot-grid buffer — fetched via `fetchShotGrid()` on mount
 * and on `<LoadMoreButton/>` click. `null` represents the pre-fetch /
 * fetch-failed state; the view renders a loading or empty surface in that
 * branch. Fixed wire shape; cards keyed on `shotId` for in-place SSE updates.
 */
export const shotGrid = signal<ShotGridResponse | null>(null);

/**
 * Current status filter pill selection. 'all' is the default — shows every
 * status in the dataset (orthogonal to `showOmitted`). The 5
 * status values gate the visible subset to one status. Client-side filter
 * per REQ-03; the endpoint does NOT receive this value as a query param.
 */
export const statusFilter = signal<'all' | ShotStatus>('all');

/**
 * "Show omitted" toggle. When `false` (default), the visible dataset
 * excludes `status === 'omit'` shots entirely. When `true`, omit shots
 * render with `opacity-40` per REQ-05. Two-control orthogonality with
 * `statusFilter`: this gates the dataset, `statusFilter` filters within it.
 */
export const showOmitted = signal<boolean>(false);

/**
 * Loading flag for the initial grid fetch + load-more requests. Drives
 * the `<LoadMoreButton/>` aria-busy state and any future skeleton overlay
 * on the grid pane.
 */
export const gridIsFetching = signal<boolean>(false);

/**
 * Most-recent load-more error message, or `null` when the last load-more
 * attempt succeeded. Drives the `<LoadMoreButton/>` retry pill (already
 * wired by the reused component).
 */
export const gridLoadMoreError = signal<string | null>(null);

// ============================================================================
// COMPUTED — aggregate status counts
// ============================================================================

/**
 * Aggregate status counts derived from `shotGrid.value.shots`. Drives the
 * `<SequenceHeader/>` mini-pill row. SSE-driven updates flow for
 * free — when `onShotStatusChanged` mutates a shot's status, this
 * `computed` re-derives reactively and the mini-pills re-render.
 *
 * Caveat: for sequences with > 50 shots the counts
 * reflect the "loaded so far" page — `shots[]` is the paginated buffer,
 * not the full sequence. The server-computed stats widget (OVR-01)
 * carries the full numbers; this is only a client-side approximation.
 */
export const aggregateCounts = computed<Record<ShotStatus, number>>(() => {
  const init: Record<ShotStatus, number> = {
    'wip': 0,
    'pending-review': 0,
    'approved': 0,
    'on-hold': 0,
    'omit': 0,
  };
  const shots = shotGrid.value?.shots ?? [];
  return shots.reduce<Record<ShotStatus, number>>((acc, s) => {
    acc[s.status]++;
    return acc;
  }, init);
});

// ============================================================================
// SSE HANDLER — onShotStatusChanged
// ============================================================================

/**
 * SSE handler for `shot.status_changed` events. Subscribed by `App.tsx`'s
 * useEffect via `onSseEvent('shot.status_changed', onShotStatusChanged)`.
 *
 * Three defensive branches (incl. the A2 cross-sequence case):
 *   1. shotGrid is null → no-op (no grid loaded, nothing to update)
 *   2. cross-sequence event (payload.sequenceId !== current sequence) →
 *      ignore (the user navigated away; the stale signal still holds the
 *      previous sequence's grid).
 *   3. unknown shotId → `.map`'s identity passthrough leaves the row
 *      unchanged; safe against out-of-order frames or already-replaced
 *      rows.
 *
 * On a matching event the entire `shotGrid.value` is replaced (immutable
 * update) so signal subscribers re-render. The targeted shot row gets a
 * fresh object (new identity → Preact rerender); other rows share their
 * previous identity (no needless thumbnail re-decode).
 */
export function onShotStatusChanged(payload: ShotStatusChangedPayload): void {
  const current = shotGrid.value;
  if (current === null) return;
  if (current.sequence.id !== payload.sequenceId) return;

  shotGrid.value = {
    ...current,
    shots: current.shots.map((s) =>
      s.id === payload.shotId ? { ...s, status: payload.toStatus } : s,
    ),
  };
}

// ============================================================================
// URL STATE — hydrate / persist
// ============================================================================

/**
 * URL-state shape for the shot grid view. Zod whitelist refuses
 * anything outside this set; the engine + dashboard never see raw user
 * strings. Follows the fallback-with-warning precedent.
 */
const ShotGridUrlSchema = z.object({
  seq: z.string().min(1).optional(),
  view: z.enum(['home', 'shot-grid', 'approvals']).optional(),
  statusFilter: z
    .enum(['all', 'wip', 'pending-review', 'approved', 'on-hold', 'omit'])
    .optional(),
  showOmitted: z.enum(['0', '1']).optional(),
});

/**
 * Read the current URL search params, validate via the Zod whitelist, and
 * apply any valid values to the matching signals. Called once by
 * `App.tsx`'s mount useEffect.
 *
 * Failure modes (NEVER throws to caller):
 *   - SSR / no window → return without touching signals
 *   - URL parse exception → `console.warn` and return (signals at defaults)
 *   - Zod validation fail → `console.warn` and return (signals at defaults)
 *
 * Precedence: URL > signal > defaults on first mount. After mount
 * the signal is the only writer; `persistShotGridUrlState` mirrors signal
 * mutations into the URL via `replaceState`.
 */
export function hydrateShotGridUrlState(): void {
  if (typeof window === 'undefined' || !window.location) return;

  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn(
        'vellum: hydrateShotGridUrlState URL parse failed.',
        err,
      );
    }
    return;
  }

  const raw = Object.fromEntries(url.searchParams);
  const parsed = ShotGridUrlSchema.safeParse(raw);
  if (!parsed.success) {
    if (typeof console !== 'undefined') {
      console.warn(
        'vellum: shot-grid URL params invalid; using defaults.',
        parsed.error,
      );
    }
    return;
  }

  const v = parsed.data;
  if (v.view) activeView.value = v.view;
  if (v.seq) selectedSequenceForGrid.value = v.seq;
  if (v.statusFilter) statusFilter.value = v.statusFilter;
  if (v.showOmitted !== undefined) {
    showOmitted.value = v.showOmitted === '1';
  }
}

/**
 * Mirror the current signal values into the URL via the History API
 * replace-state path (NEVER add to history; sort/filter/view changes are not
 * navigation events).
 *
 * Idempotent and safe to call on every signal mutation. Silent failure on
 * SSR / sandboxed `history` (some embed contexts block replaceState) —
 * matches the `persistGridSort` precedent.
 */
export function persistShotGridUrlState(): void {
  if (
    typeof window === 'undefined' ||
    !window.location ||
    typeof history === 'undefined'
  ) {
    return;
  }

  try {
    const url = new URL(window.location.href);
    url.searchParams.set('view', activeView.value);
    if (selectedSequenceForGrid.value) {
      url.searchParams.set('seq', selectedSequenceForGrid.value);
    } else {
      url.searchParams.delete('seq');
    }
    url.searchParams.set('statusFilter', statusFilter.value);
    url.searchParams.set('showOmitted', showOmitted.value ? '1' : '0');
    history.replaceState(null, '', url.toString());
  } catch {
    /* history unavailable / blocked — silent */
  }
}
