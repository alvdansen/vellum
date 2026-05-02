/**
 * C2paShield component tests (Phase 17 — Plan 17-04 Task 2).
 *
 * Covers the C2PA shield SVG primitive: a small inline SVG overlay rendered
 * bottom-right on `<Thumbnail/>` for `c2paStatus.status === 'signed'` only
 * (D-10 LOCKED). Adobe Content Credentials "CR" mark; pure presentational —
 * no click handler, no focus ring, no hover state (D-11 LOCKED).
 *
 * Render contract (UI-SPEC §"<C2paShield/> API contract"):
 *   - Pure SVG (NOT a span — distinguishes from C2paBadge text pill)
 *   - role='img' + aria-label + inner <title> child element (NOT just a
 *     `title=` attribute — the spec-compliant native browser tooltip mechanism)
 *   - Default class 'h-5 w-5' (20×20px); caller can pass override
 *   - SVG viewBox '0 0 24 24' (matches lucide convention per UI-SPEC)
 *   - data-testid='c2pa-shield' (mirrors C2paBadge's data-testid='c2pa-badge'
 *     test-discoverability pattern)
 *   - SIGNED_TOOLTIP default = 'Signed · Verified provenance' (D-11 verbatim)
 *
 * Mirrors C2paBadge.test.tsx in structure: vitest + @testing-library/preact;
 * single render per test; data-testid for query; assert role + aria-label +
 * class composition + DOM shape.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { C2paShield } from '../components/C2paShield.js';
import { SIGNED_TOOLTIP } from '../lib/copy.js';

describe('C2paShield (Phase 17 — Plan 17-04 Task 2)', () => {
  it('Test 1: renders by default with data-testid, role=img, default aria-label', () => {
    render(<C2paShield />);
    const el = screen.getByTestId('c2pa-shield');
    expect(el).toBeTruthy();
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe(SIGNED_TOOLTIP);
    // Default tooltip string per D-11 verbatim
    expect(el.getAttribute('aria-label')).toBe('Signed · Verified provenance');
  });

  it('Test 2: custom title prop sets BOTH aria-label AND inner <title> text content', () => {
    render(<C2paShield title="Custom signed" />);
    const el = screen.getByTestId('c2pa-shield');
    expect(el.getAttribute('aria-label')).toBe('Custom signed');
    // Inner <title> child element (NOT just the attribute)
    const titleEl = el.querySelector('title');
    expect(titleEl).toBeTruthy();
    expect(titleEl?.textContent).toBe('Custom signed');
  });

  it('Test 3: default class is h-5 w-5 when no class prop given', () => {
    render(<C2paShield />);
    const el = screen.getByTestId('c2pa-shield');
    const cls = el.getAttribute('class') ?? '';
    expect(cls).toContain('h-5');
    expect(cls).toContain('w-5');
  });

  it('Test 4: passing class="h-3.5 w-3.5" overrides default — composition rule: prop replaces default', () => {
    render(<C2paShield class="h-3.5 w-3.5" />);
    const el = screen.getByTestId('c2pa-shield');
    const cls = el.getAttribute('class') ?? '';
    expect(cls).toContain('h-3.5');
    expect(cls).toContain('w-3.5');
    // The default 'h-5 w-5' must NOT leak through
    expect(cls).not.toMatch(/\bh-5\b/);
    expect(cls).not.toMatch(/\bw-5\b/);
  });

  it('Test 5: rendered element is an <svg> (NOT a <span> — distinguishes from C2paBadge)', () => {
    render(<C2paShield />);
    const el = screen.getByTestId('c2pa-shield');
    // Preact + jsdom: tagName for SVG elements is lowercase 'svg' (XML namespace)
    // or uppercase 'SVG' depending on namespace. Compare lowercased.
    expect(el.tagName.toLowerCase()).toBe('svg');
  });

  it('Test 6: contains a <title> child element matching aria-label (spec-compliant native tooltip — NOT just a `title=` attribute)', () => {
    render(<C2paShield />);
    const el = screen.getByTestId('c2pa-shield');
    const titleEl = el.querySelector('title');
    expect(titleEl).toBeTruthy();
    expect(titleEl?.textContent).toBe(el.getAttribute('aria-label'));
    // Sanity: confirm the inner element is the <title> (SVG inner-title spec).
    expect(titleEl?.tagName.toLowerCase()).toBe('title');
  });

  it('Test 7: SVG viewBox is "0 0 24 24" (matches lucide convention per UI-SPEC §"<C2paShield/> API contract")', () => {
    render(<C2paShield />);
    const el = screen.getByTestId('c2pa-shield');
    expect(el.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('Test 8: role=img is set (mirrors C2paBadge role=status — explicit ARIA role on the rendered element)', () => {
    render(<C2paShield title="Signed badge" />);
    const el = screen.getByTestId('c2pa-shield');
    // role=img is the contract for an SVG that represents meaningful imagery
    // (UI-SPEC §"<C2paShield/> API contract" + accessibility contract).
    expect(el.getAttribute('role')).toBe('img');
    // The aria-label tracks the title prop verbatim.
    expect(el.getAttribute('aria-label')).toBe('Signed badge');
  });
});
