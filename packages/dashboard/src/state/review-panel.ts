/**
 * Review panel + A/B compare modal signal bag.
 *
 * Per-domain signal module: declares the 6 module-singleton signals the
 * review surface keys on. Module pattern mirrors state/shot-grid.ts
 * (`signal<T>(initial)` + JSDoc per export + zero
 * src/ traversals for architecture-purity).
 *
 * Landmines preserved:
 *  - `onShotStatusChanged` STAYS in state/shot-grid.ts.
 *    Reference equality of the handler matters for the SSE off-subscription
 *    cleanup — relocating it would break that.
 *  - Review-panel state is NEVER mirrored into the URL.
 *    Reload returns to the default view; overlays are session-local.
 *
 * Architecture-purity: no server-tree imports;
 * ReviewAction is sibling-imported from ./types/review-panel.js.
 *
 * Mutex invariant: `activeOverlay` is the single source of truth for
 * which right-rail overlay is mounted. OverlayHost (views/OverlayHost.tsx)
 * is the only consumer that branches on it; the three exported helpers
 * `openVersionDrawer / openReviewPanel / closeOverlay` are the only
 * sanctioned mutation paths.
 */

import { signal } from '@preact/signals';
import type { ReviewAction } from '../types/review-panel.js';

/**
 * Mutex discriminator — selects which right-rail overlay is mounted.
 *
 * `null` = no overlay open. `'version'` = VersionDrawer mounted (existing
 * surface; the companion signal is `selectedVersionId` in
 * state/versions.ts). `'review'` = ReviewPanel mounted (the
 * companion signal is `activeReviewShotId` below).
 *
 * Mutation: only via OverlayHost's exported helpers. Direct mutation from
 * elsewhere is supported only as a backward-compat shim (legacy callers
 * that write `selectedVersionId` directly — OverlayHost falls back to the
 * version drawer when `activeOverlay === null && selectedVersionId !== null`).
 */
export const activeOverlay = signal<'review' | 'version' | null>(null);

/**
 * Companion signal to `activeOverlay === 'review'`. Holds the shot id whose
 * review panel is open. MUST be non-null whenever activeOverlay='review';
 * OverlayHost guards via console.warn + null render otherwise (defensive,
 * never throws — warn-on-inconsistency keeps the surface alive).
 */
export const activeReviewShotId = signal<string | null>(null);

/**
 * Compare-mode selection — the two version ids the user has checked
 * for A/B comparison. Both null when compare mode is inactive; either field
 * non-null means the user is mid-selection. When BOTH non-null, the
 * `COMPARE_MODE_CTA_LABEL` "Compare" CTA enables, and clicking it flips
 * `compareModalOpen` (below) to true.
 *
 * Shape `{ a, b }` (not a tuple) lets test mutations target each side
 * independently without re-creating the whole record. LRU caching of the
 * thumbnail Image() objects across (a, b) tuples is the secondary
 * decision and lives inside ReviewTimeline, NOT here.
 */
export const compareSelection = signal<{
  a: string | null;
  b: string | null;
}>({ a: null, b: null });

/**
 * A/B compare modal visibility. Independent of `activeOverlay` — the
 * modal renders OVER any open right-rail overlay (Pitfall: never mutex with
 * the version/review drawers; the modal IS the z-30 layer above them).
 *
 * Setting to true mounts the ABCompareView modal via ABCompareHost (sibling
 * of OverlayHost in App.tsx). Setting to false unmounts it; the parent
 * compareSelection is NOT cleared on close — leaving the selection allows
 * "Open compare again" without re-selecting.
 */
export const compareModalOpen = signal<boolean>(false);

/**
 * REV-02 — currently in-flight review action (the verb the user
 * just clicked, before the PATCH resolves). Non-null marks the originating
 * ActionButton as `aria-busy` and disables siblings. Null when no action
 * is pending (ready to accept the next click).
 *
 * Mutated by ReviewActionBar immediately before the optimistic
 * status flip, cleared after the PATCH resolves OR rejects.
 */
export const actionInFlight = signal<ReviewAction | null>(null);

/**
 * REV-02 — quick-approve PATCH failure message. Non-null surfaces
 * the inline `<WarningPill/>` ("Approve failed — retry") next to the
 * grid card's status pill. Click dismissal clears it; a successful retry
 * also clears it. NEVER persisted; lives only for the session.
 */
export const quickApproveError = signal<string | null>(null);
