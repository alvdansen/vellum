/**
 * Phase 21 / Plan 21-02 — Task T04 — ShotStatusPill component tests.
 *
 * Covers GRID-02 + REQ-01 (WCAG 2.1 AA): pill renders the correct
 * `bg-[var(--color-shot-status-*)]` token per status, the WCAG-AA-compliant
 * `text-[var(--color-bg)]` inverse-text class, and exposes `data-status` for
 * test selection (mirror of `StatusPill.tsx:42`).
 *
 * Per UI-SPEC §"Color" the 5 status tokens were precomputed for WCAG 2.1 AA
 * contrast in both dark and light themes; this test verifies the renderer
 * uses the right token for each status, NOT the raw color values (the token
 * definitions live in `theme.css` and are exercised by manual visual smoke).
 *
 * Landmine guards (PATTERNS §16):
 *   - Use `container.querySelector('[data-status="..."]')` not `getByTestId`
 *     (no data-testid attribute on the component spec)
 *   - Tailwind v4 generates `bg-[var(--color-shot-status-wip)]` as a literal
 *     class — `pill.className` contains the bracketed token string verbatim,
 *     not a hashed Tailwind class
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ShotStatusPill } from '../ShotStatusPill.js';

afterEach(() => {
  cleanup();
});

describe('ShotStatusPill (Phase 21 GRID-02)', () => {
  it.each([
    ['wip', 'shot-status-wip'],
    ['pending-review', 'shot-status-pending-review'],
    ['approved', 'shot-status-approved'],
    ['on-hold', 'shot-status-on-hold'],
    ['omit', 'shot-status-omit'],
  ] as const)('renders %s pill with correct bg + WCAG-AA inverse text', (status, tokenSlug) => {
    const { container } = render(<ShotStatusPill status={status} />);
    const pill = container.querySelector(
      `[data-status="${status}"]`,
    ) as HTMLElement | null;

    expect(pill).toBeTruthy();
    // Tailwind v4 emits the bracketed-token class verbatim in className
    expect(pill!.className).toContain(`bg-[var(--color-${tokenSlug})]`);
    // WCAG 2.1 AA inverse text (REQ-01 cross-cutting constraint)
    expect(pill!.className).toContain('text-[var(--color-bg)]');
    // label-uppercase convention (theme.css convention propagated to all pills)
    expect(pill!.className).toContain('uppercase');
    expect(pill!.className).toContain('tracking-widest');
    // Status literal is the visible text — color is NEVER the sole signal
    expect(pill!.textContent).toBe(status);
  });

  it('does NOT apply animate-status-pulse (shot statuses are not in-flight states)', () => {
    const { container } = render(<ShotStatusPill status="wip" />);
    const pill = container.querySelector('[data-status="wip"]') as HTMLElement;
    expect(pill.className).not.toContain('animate-status-pulse');
  });
});
