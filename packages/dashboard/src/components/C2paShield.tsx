/**
 * Phase 17 / Plan 17-04 — Adobe Content Credentials "CR" mark SVG overlay.
 *
 * Render contract (UI-SPEC §"<C2paShield/> API contract" lines 240-275):
 *   - Pure presentational SVG (no state, no click, no focus ring — D-11 LOCKED)
 *   - role='img' + aria-label + inner <title> (SR + native browser tooltip)
 *   - Fixed brand colors #FFFFFF body / #1A1A1A outline (D-08 — NOT theme-tokenized;
 *     the CR mark is a regulator-recognized brand element, tinting it would
 *     defeat its purpose as a recognizable signal of Content Credentials)
 *   - CSS drop-shadow halo for legibility on bright thumbnails (white sky,
 *     snow, blown highlights)
 *   - Default class h-5 w-5 (20×20 px); sm-variant callers pass h-3.5 w-3.5
 *   - viewBox 0 0 24 24 (matches lucide convention per UI-SPEC)
 *
 * D-10 LOCKED: this component renders ONLY when c2paStatus.status === 'signed'.
 * The render-predicate gate lives at the parent <Thumbnail/> call site —
 * <C2paShield/> itself has no opinion on visibility.
 *
 * D-11 LOCKED: zero interactive state. No click handler, no hover state,
 * no focus ring, no tabindex. Clicks bubble through to the parent VersionCard
 * <button> or TreeRow <div role="treeitem"> — which already exposes the full
 * C2PA state via the <C2paBadge/> text pill in VersionDrawer.
 *
 * v1.1 NOTE: <C2paBadge/> (TEXT pill in VersionDrawer) is preserved verbatim
 * — this shield does NOT replace the badge. The badge surfaces unsigned +
 * unknown reasons; the shield is the at-a-glance "signed" indicator only.
 *
 * ──────────────────────────────────────────────────────────────────────
 * License attribution — Adobe Content Credentials "CR" mark SVG
 * ──────────────────────────────────────────────────────────────────────
 * Source:    https://github.com/contentauth/verify-site (assets/svg/color/cr-icon-fill.svg)
 * License:   Apache License, Version 2.0 (LICENSE-APACHE)
 *            https://github.com/contentauth/verify-site/blob/main/LICENSE-APACHE
 * Copyright: Copyright 2020 Adobe (per the verify-site LICENSE-APACHE header).
 * Verified:  2026-05-02 (Plan 17-04 Task 1 license-verification gate, outcome A —
 *            explicit Apache 2.0 license text discovered on the upstream repo).
 * Notes:     The CR mark is a first-party asset in the contentauth/verify-site
 *            repository, which is "distributed under the terms of the Apache
 *            License (Version 2.0)" (verify-site/README.md §License). The path
 *            bytes below preserve the Adobe-authored shape; the wrapping
 *            <g transform> rescales the original 25×24 coordinate space into
 *            the 24×24 viewBox required by UI-SPEC §"<C2paShield/> API contract".
 * ──────────────────────────────────────────────────────────────────────
 */

import { SIGNED_TOOLTIP } from '../lib/copy.js';

export interface C2paShieldProps {
  /**
   * Optional class for sizing (default-fallback: h-5 w-5 = 20×20 px).
   * Composition rule: prop REPLACES default — callers pass their own
   * sizing class for the 'sm' variant (h-3.5 w-3.5 = 14×14 px).
   */
  class?: string;
  /**
   * Optional title — sets BOTH `aria-label` AND inner `<title>` text content.
   * Default: SIGNED_TOOLTIP ('Signed · Verified provenance' per D-11).
   */
  title?: string;
}

export function C2paShield({ class: className, title }: C2paShieldProps) {
  const label = title ?? SIGNED_TOOLTIP;
  return (
    <svg
      class={className ?? 'h-5 w-5'}
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      data-testid="c2pa-shield"
      style={{ filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.6))' }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{label}</title>
      {/*
       * Adobe Content Credentials "CR" mark — Apache 2.0 (Copyright 2020 Adobe).
       * Source path bytes from contentauth/verify-site (assets/svg/color/cr-icon-fill.svg).
       * Original viewBox is 0 0 25 24; we wrap in <g transform="scale(0.96 1)">
       * to fit the UI-SPEC-required 0 0 24 24 viewBox without modifying the
       * Adobe-authored path coordinates.
       */}
      <g transform="scale(0.96 1)">
        {/* Shield outline — white body, dark outline (D-08 brand colors). */}
        <path
          d="M1.54 12C1.54 5.94696 6.44696 1.04 12.5 1.04C18.553 1.04 23.46 5.94696 23.46 12V22.96H12.5C6.44696 22.96 1.54 18.053 1.54 12Z"
          fill="#FFFFFF"
          stroke="#1A1A1A"
          stroke-width="2.08"
        />
        {/* "CR" letters — dark fill on white shield body. */}
        <path
          d="M9.61051 17.322C6.89755 17.322 5.20411 15.1966 5.20411 12.6737C5.20411 10.1508 6.89755 8.02536 9.61051 8.02536C11.8051 8.02536 13.2912 9.4596 13.6886 11.3258H11.4768C11.183 10.4964 10.4918 9.99528 9.61051 9.99528C8.24539 9.99528 7.34683 11.0666 7.34683 12.6737C7.34683 14.2807 8.24539 15.3521 9.61051 15.3521C10.5264 15.3521 11.2348 14.8164 11.5113 13.9351H13.7059C13.343 15.8532 11.8396 17.322 9.61051 17.322ZM14.5797 17.0801V8.26728H16.6533V9.21768C17.1372 8.57832 17.8975 8.1636 19.038 8.1636H19.5736V10.2026H19.0207C18.2431 10.2026 17.7592 10.3754 17.3964 10.7038C16.9816 11.0494 16.7397 11.6196 16.7397 12.4836V17.0801H14.5797Z"
          fill="#1A1A1A"
        />
      </g>
    </svg>
  );
}
