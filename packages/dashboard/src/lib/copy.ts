/**
 * Phase 17 — copy strings exported as named-export constants for verbatim
 * consumption by dashboard components.
 *
 * Centralizing copy strings here gives screen-reader users, designers, and
 * future i18n efforts a single source of truth. Components import the
 * constants directly (no inline literals); tests assert verbatim equality
 * against the constant names.
 *
 * UI-SPEC §"Copywriting Contract" (lines 330-345) — Phase 17 introduces
 * 3 new copy strings; SIGNED_TOOLTIP + PREVIEW_UNAVAILABLE_PREFIX land here
 * as exported constants. The third string ('Output for ${label}') is a
 * parameterized template at the call site — it remains a JSX literal in
 * Thumbnail.tsx because the version label varies per render.
 *
 * No emojis, no Unicode escapes — Phase 17 strings use literal characters
 * (the middle dot in SIGNED_TOOLTIP is U+00B7 'MIDDLE DOT', the same
 * character used by the existing C2paBadge tone).
 */

// ================================================================
// Phase 17 / Plan 17-04 — copy strings (UI-SPEC §"Copywriting Contract")
// ================================================================

/**
 * C2PA shield tooltip — verbatim D-11 contract.
 *
 * Surfaces in two places per <C2paShield/> render:
 *   1. `aria-label` on the <svg> element (screen-reader announcement)
 *   2. Inner `<title>` element child (native browser tooltip on hover)
 *
 * Verb-first STATE LABEL (analogous to "Active generations (N)"); the
 * middle-dot separator matches existing C2paBadge tone.
 */
export const SIGNED_TOOLTIP = 'Signed · Verified provenance';

/**
 * Thumbnail alt-text fallback prefix — used when the browser fires an
 * `onerror` on the <img> (server returned 404 / 500 / network blip).
 *
 * The full alt becomes `${PREVIEW_UNAVAILABLE_PREFIX}${version.label}` —
 * e.g., `Preview unavailable for v003`. Mirrors the existing OUTPUT_UNAVAILABLE
 * error copy from Phase 5 (`Preview unavailable`); adds the version label so
 * screen-reader users have a referent. Matches D-07 unified-skeleton-on-failure
 * by giving SR equivalent semantic info to what sighted users see.
 */
export const PREVIEW_UNAVAILABLE_PREFIX = 'Preview unavailable for ';

// ================================================================
// Phase 18 / Plan 18-04 — sort-strip + dropdown + load-more copy
// (UI-SPEC §"Copywriting Contract" lines 480-545)
// ================================================================

/**
 * Sort-strip muted prefix label — single word "Sort" rendered with the
 * `.label-uppercase` utility (tracking + uppercase transform). Visible
 * sibling to the <SortDropdown/> trigger. NOT "Sort by:" — the dropdown's
 * `aria-label` already says "Sort versions by" / "Sort tree by" so the
 * visible label stays brief.
 */
export const SORT_STRIP_LABEL = 'Sort';

/**
 * Grid <SortDropdown/> trigger `aria-label`. Required prop; surfaces the
 * trigger purpose to screen-reader users since the visible label inside
 * the trigger is just the current option (e.g., "Latest").
 */
export const SORT_GRID_ARIA_LABEL = 'Sort versions by';

/**
 * Tree <SortDropdown/> trigger `aria-label`. Symmetric to grid; refers to
 * the workspace/project/sequence/shot tree.
 */
export const SORT_TREE_ARIA_LABEL = 'Sort tree by';

/**
 * <LoadMoreButton/> loading-state label. Single word + Unicode horizontal
 * ellipsis (U+2026) — matches the existing "Loading…" tone used elsewhere.
 */
export const LOAD_MORE_LOADING_LABEL = 'Loading…';

/**
 * <LoadMoreButton/> error-state retry CTA label. Used on the inline pill
 * below the button when the previous fetch failed; clicking the Retry
 * button re-fires the same onClick handler as the main button.
 */
export const LOAD_MORE_RETRY_LABEL = 'Retry';

/**
 * <LoadMoreButton/> error-state copy prefix for HTTP / server failures —
 * e.g., a 4xx/5xx envelope from /api/shots/:id/versions?cursor=… The full
 * pill copy becomes `${LOAD_MORE_ERROR_PREFIX_FAILED} · Retry` with
 * U+00B7 middle dot (matches Phase 17 SIGNED_TOOLTIP separator tone).
 */
export const LOAD_MORE_ERROR_PREFIX_FAILED = 'Failed to load';

/**
 * <LoadMoreButton/> error-state copy prefix for network failures — fetch
 * threw (offline, server down, DNS fail). Synthesized client-side; not a
 * server-emitted code.
 */
export const LOAD_MORE_ERROR_PREFIX_NETWORK = 'Network error';
