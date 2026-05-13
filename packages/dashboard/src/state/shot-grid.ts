/**
 * packages/dashboard/src/state/shot-grid.ts
 *
 * Phase 21 / Plan 21-02 — Task T05.
 *
 * Co-locates the Phase 21 ShotGridView signal bag, the SSE-driven
 * `onShotStatusChanged` handler (D-22), the `aggregateCounts` computed
 * (D-14), and the URL-state hydrate/persist helpers (D-09). The view
 * (`<ShotGridView/>` shipping in Wave 4) consumes these by direct import.
 *
 * Architecture-purity invariant (D-WEBUI-31): this file performs zero
 * server-tree relative-import traversals — only the dashboard-local
 * `../types/*` barrels and the `@preact/signals` + `zod` libraries.
 *
 * Landmines preserved (PATTERNS §13):
 *   - DO NOT subscribe to SSE inside this module's top level. The
 *     subscription belongs in `App.tsx`'s useEffect (Wave 4) so the
 *     register/unregister lifecycle is tied to the dashboard mount.
 *   - DO NOT call `persistShotGridUrlState()` at module top level.
 *     Callers invoke it explicitly after signal mutations (consumer
 *     pattern matches Phase 18 `persistGridSort` precedent).
 *   - DO NOT use `history` push semantics — D-09 LOCKED `replaceState` only.
 *     Filter and view changes are view settings, not navigation events;
 *     they must not pollute browser back-stack.
 *   - DO NOT throw on URL parse failures — mirror Phase 18 D-16 graceful
 *     fallback: log `console.warn` and return defaults.
 */

import { signal, computed } from '@preact/signals';
import { z } from 'zod';
import type { ShotStatusChangedPayload } from '../types/events.js';
import type { ShotGridResponse, ShotStatus } from '../types/shot-grid.js';

// ============================================================================
// SIGNALS (D-14, D-22, RESEARCH Pattern 4-5)
// ============================================================================

/**
 * Current view — toggled by the header home icon (→ 'home') and TreeSidebar
 * grid-icon (→ 'shot-grid'). Signal-driven view routing per D-03; no router
 * library added. See 21-CONTEXT.md D-04 — switching `activeView` does NOT
 * clear `selectedShotId` or `selectedSequenceForGrid`.
 */
export const activeView = signal<'home' | 'shot-grid'>('home');

/**
 * Sequence id whose grid is currently displayed. Written by the
 * TreeSidebar grid-icon click handler (D-02). Independent of HomeView's
 * `selectedShotId` (D-04).
 */
export const selectedSequenceForGrid = signal<string | null>(null);

/**
 * The paginated shot-grid buffer — fetched via `fetchShotGrid()` on mount
 * and on `<LoadMoreButton/>` click. `null` represents the pre-fetch /
 * fetch-failed state; the view renders a loading or empty surface in that
 * branch. D-13 wire shape; cards keyed on `shotId` for in-place SSE updates.
 */
export const shotGrid = signal<ShotGridResponse | null>(null);

/**
 * Current status filter pill selection. 'all' is the default — shows every
 * status in the dataset (D-08 orthogonality with `showOmitted`). The 5
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
 * wired by Phase 18 reused component).
 */
export const gridLoadMoreError = signal<string | null>(null);

// ============================================================================
// COMPUTED — aggregate status counts (D-14)
// ============================================================================

/**
 * Aggregate status counts derived from `shotGrid.value.shots`. Drives the
 * `<SequenceHeader/>` mini-pill row (D-14). SSE-driven updates flow for
 * free — when `onShotStatusChanged` mutates a shot's status, this
 * `computed` re-derives reactively and the mini-pills re-render.
 *
 * Caveat (RESEARCH Pitfall 8): for sequences with > 50 shots the counts
 * reflect the "loaded so far" page — `shots[]` is the paginated buffer,
 * not the full sequence. Phase 23 OVR-01 ships the full server-computed
 * stats widget; Phase 21 ships only this client-side approximation.
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
// SSE HANDLER — onShotStatusChanged (D-22)
// ============================================================================

/**
 * SSE handler for `shot.status_changed` events. Subscribed by `App.tsx`'s
 * useEffect (Wave 4) via `onSseEvent('shot.status_changed', onShotStatusChanged)`.
 *
 * Three defensive branches (RESEARCH Pitfalls 2, 3, 4 + A2 cross-sequence):
 *   1. shotGrid is null → no-op (no grid loaded, nothing to update)
 *   2. cross-sequence event (payload.sequenceId !== current sequence) →
 *      ignore (the user navigated away; the stale signal still holds the
 *      previous sequence's grid). T-21-09 disposition.
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
// URL STATE — hydrate / persist (D-09, PATTERNS §13)
// ============================================================================

/**
 * URL-state shape for the shot grid view (D-09). Zod whitelist refuses
 * anything outside this set; the engine + dashboard never see raw user
 * strings. Mirrors Phase 18 D-16 fallback-with-warning precedent.
 */
const ShotGridUrlSchema = z.object({
  seq: z.string().min(1).optional(),
  view: z.enum(['home', 'shot-grid']).optional(),
  statusFilter: z
    .enum(['all', 'wip', 'pending-review', 'approved', 'on-hold', 'omit'])
    .optional(),
  showOmitted: z.enum(['0', '1']).optional(),
});

/**
 * Read the current URL search params, validate via the Zod whitelist, and
 * apply any valid values to the matching signals. Called once by
 * `App.tsx`'s mount useEffect (Wave 4).
 *
 * Failure modes (NEVER throws to caller):
 *   - SSR / no window → return without touching signals
 *   - URL parse exception → `console.warn` and return (signals at defaults)
 *   - Zod validation fail → `console.warn` and return (signals at defaults)
 *
 * Precedence (D-09): URL > signal > defaults on first mount. After mount
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
        'vfx-familiar: hydrateShotGridUrlState URL parse failed.',
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
        'vfx-familiar: shot-grid URL params invalid; using defaults.',
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
 * replace-state path (D-09 LOCKED — NEVER add to history; sort/filter/view changes are not
 * navigation events).
 *
 * Idempotent and safe to call on every signal mutation. Silent failure on
 * SSR / sandboxed `history` (some embed contexts block replaceState) —
 * matches Phase 18 precedent.
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
