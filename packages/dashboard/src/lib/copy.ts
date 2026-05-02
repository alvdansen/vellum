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
