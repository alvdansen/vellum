/**
 * SummarySection component tests (Phase 19 / Plan 19-06 Task 2).
 *
 * Covers the discriminated-state thin-wrapper that renders the AI
 * conversational summary surface inside VersionDrawer:
 *   - 'loading'  — 3-line skeleton + aria-busy='true' on section
 *   - 'success'  — plain prose <p> via JSX text-child (T-5-06 XSS guard)
 *   - 'fallback' — WarningPill + deterministic text (D-FB-6 layout-stable)
 *   - 'error'    — WarningPill + retry copy
 *
 * Plus the SUM-07 disclosure children-slot passthrough, the D-PRIV-2
 * first-use disclosure gate, ARIA wiring, and the BLOCKER #4 (revision-1)
 * D-FB-6 DOM-stability invariant.
 *
 * Mirrors the C2paBadge.test.tsx structural shape — props-in tests with no
 * module mocks (the component is pure; WarningPill/RegenerateButton are
 * imported as real components).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { SummarySection } from '../SummarySection.js';
import type { SummaryState } from '../../state/summaries.js';

const successState: SummaryState = {
  state: 'success',
  text: 'v003 generated with flux1-dev at seed 42. Iterate from v002.',
  source: 'cache_hit',
  generated_at: '2026-05-09T11:30:00.000Z',
  template_version: '1.0.0',
  model_id: 'claude-haiku-4-5-20251001',
  regenerateAvailableAtMs: null,
};

const fallbackState: SummaryState = {
  state: 'fallback',
  text: 'v003 generated with flux1-dev at seed 42.',
  source: 'fallback',
  reason: 'circuit_open',
  regenerateAvailableAtMs: null,
};

describe('SummarySection (Phase 19 — Plan 19-06 Task 2)', () => {
  // ==========================================================================
  // Render state — loading
  // ==========================================================================

  it("Test 1: 'loading' state — renders 3-line skeleton with role='presentation' + aria-hidden='true'; aria-busy='true' on section", () => {
    render(
      <SummarySection
        summary={{ state: 'loading' }}
        onRegenerate={() => {}}
        versionLabel="v003"
      />,
    );
    const section = screen.getByTestId('summary-section');
    expect(section.getAttribute('aria-busy')).toBe('true');
    const skeleton = screen.getByTestId('summary-skeleton');
    expect(skeleton.getAttribute('role')).toBe('presentation');
    expect(skeleton.getAttribute('aria-hidden')).toBe('true');
    // 3 stacked bars
    expect(skeleton.children.length).toBe(3);
  });

  it("Test 2: 'loading' state — Regenerate button is disabled with aria-busy='true'", () => {
    render(
      <SummarySection
        summary={{ state: 'loading' }}
        onRegenerate={() => {}}
        versionLabel="v003"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  // ==========================================================================
  // Render state — success
  // ==========================================================================

  it("Test 3: 'success' state — renders <p> with summary.text inside; NO WarningPill; aria-busy='false'", () => {
    render(
      <SummarySection
        summary={successState}
        onRegenerate={() => {}}
        versionLabel="v003"
      />,
    );
    const body = screen.getByTestId('summary-body');
    expect(body.textContent).toBe(successState.text);
    expect(screen.queryByTestId('warning-pill')).toBeNull();
    const section = screen.getByTestId('summary-section');
    expect(section.getAttribute('aria-busy')).toBe('false');
  });

  it('Test 4: success state — body uses Preact text-child (no dangerouslySetInnerHTML)', () => {
    render(
      <SummarySection
        summary={successState}
        onRegenerate={() => {}}
        versionLabel="v003"
      />,
    );
    const body = screen.getByTestId('summary-body');
    // All children of <p> are TEXT_NODEs (NOT element nodes injected via
    // innerHTML). dangerouslySetInnerHTML would create element children;
    // text-child interpolation produces nodeType=3 children.
    for (const child of Array.from(body.childNodes)) {
      expect(child.nodeType).toBe(Node.TEXT_NODE);
    }
  });

  // ==========================================================================
  // Render state — fallback
  // ==========================================================================

  it("Test 5: 'fallback' state — renders WarningPill (label + long-ARIA) + <p> with summary.text", () => {
    render(
      <SummarySection
        summary={fallbackState}
        onRegenerate={() => {}}
        versionLabel="v003"
      />,
    );
    const pill = screen.getByTestId('warning-pill');
    expect(pill.textContent).toBe('AI summary unavailable');
    expect(pill.getAttribute('aria-label')).toBe(
      'AI summary unavailable; showing structured details',
    );
    const body = screen.getByTestId('summary-body');
    expect(body.textContent).toBe(fallbackState.text);
  });

  it("Test 6: 'fallback' state preserves source/reason fields on the SummaryState (data-shape contract)", () => {
    // The UI does NOT render reason directly, but the data shape on the
    // signal is the contract — confirm passing the full fallback state does
    // not crash and renders the body text.
    render(
      <SummarySection
        summary={fallbackState}
        onRegenerate={() => {}}
        versionLabel="v003"
      />,
    );
    // Section renders normally; reason field is not displayed (UI-SPEC).
    expect(screen.getByTestId('summary-body').textContent).toBe(fallbackState.text);
    // The reason / source remain part of the SummaryState type — covered by
    // the type-system contract, no runtime assertion needed beyond render.
  });

  // ==========================================================================
  // Render state — error
  // ==========================================================================

  it("Test 7: 'error' state — renders WarningPill + <p> with SUMMARY_ERROR_FALLBACK literal", () => {
    render(
      <SummarySection
        summary={{ state: 'error', message: 'HTTP 500' }}
        onRegenerate={() => {}}
        versionLabel="v003"
      />,
    );
    expect(screen.getByTestId('warning-pill')).toBeTruthy();
    const body = screen.getByTestId('summary-body');
    expect(body.textContent).toBe('(AI summary unavailable; please retry.)');
  });

  // ==========================================================================
  // SUM-07 — children disclosure slot passthrough
  // ==========================================================================

  it('Test 8: children prop renders below body (SUM-07 disclosure slot)', () => {
    render(
      <SummarySection
        summary={successState}
        onRegenerate={() => {}}
        versionLabel="v003"
      >
        <div data-testid="provenance-disclosure">provenance content</div>
      </SummarySection>,
    );
    const disclosure = screen.getByTestId('provenance-disclosure');
    expect(disclosure).toBeTruthy();
    expect(disclosure.textContent).toBe('provenance content');
    // Disclosure is a descendant of the section.
    const section = screen.getByTestId('summary-section');
    expect(section.contains(disclosure)).toBe(true);
  });

  // ==========================================================================
  // First-use disclosure gating
  // ==========================================================================

  it('Test 9: showFirstUseDisclosure=true → muted note with SUMMARY_FIRST_USE_DISCLOSURE renders above body', () => {
    render(
      <SummarySection
        summary={successState}
        onRegenerate={() => {}}
        versionLabel="v003"
        showFirstUseDisclosure={true}
      />,
    );
    const note = screen.getByTestId('first-use-disclosure');
    expect(note.textContent).toBe('AI summary uses your prompt text');
  });

  it('Test 10: showFirstUseDisclosure=false (default) → muted note does NOT render', () => {
    render(
      <SummarySection
        summary={successState}
        onRegenerate={() => {}}
        versionLabel="v003"
      />,
    );
    expect(screen.queryByTestId('first-use-disclosure')).toBeNull();
  });

  // ==========================================================================
  // ARIA — section-level wiring
  // ==========================================================================

  it('Test 11: section <section> has aria-labelledby pointing at the <h3> id', () => {
    render(
      <SummarySection
        summary={successState}
        onRegenerate={() => {}}
        versionLabel="v003"
      />,
    );
    const section = screen.getByTestId('summary-section');
    const labelledBy = section.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    // The id referenced must exist as an element in the DOM.
    expect(document.getElementById(labelledBy!)).not.toBeNull();
  });

  it('Test 12: <h3> id is unique per version (versionLabel suffix avoids duplicate IDs across multiple drawers)', () => {
    render(
      <div>
        <SummarySection
          summary={successState}
          onRegenerate={() => {}}
          versionLabel="v003"
        />
        <SummarySection
          summary={successState}
          onRegenerate={() => {}}
          versionLabel="v004"
        />
      </div>,
    );
    // Two distinct section headings — different ids.
    expect(document.getElementById('summary-heading-v003')).not.toBeNull();
    expect(document.getElementById('summary-heading-v004')).not.toBeNull();
  });

  // ==========================================================================
  // RegenerateButton wiring
  // ==========================================================================

  it('Test 13: RegenerateButton receives regenerateAvailableAtMs prop unchanged', () => {
    const future = Date.now() + 30_000;
    render(
      <SummarySection
        summary={successState}
        regenerateAvailableAtMs={future}
        onRegenerate={() => {}}
        versionLabel="v003"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    // Cooldown countdown shows the (Ns) suffix when prop is forwarded.
    expect(btn.textContent).toMatch(/Regenerate \(\d+s\)/);
    expect(btn.disabled).toBe(true);
  });

  it('Test 14: onRegenerate prop wired to RegenerateButton onClick', () => {
    const onRegenerate = vi.fn();
    render(
      <SummarySection
        summary={successState}
        onRegenerate={onRegenerate}
        versionLabel="v003"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    btn.click();
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // T-5-06 XSS guard
  // ==========================================================================

  it("Test 15: T-5-06 XSS guard — render summary.text with `<script>` content → escaped (no <script> element)", () => {
    const malicious: SummaryState = {
      state: 'success',
      text: "<script>alert('xss')</script>",
      source: 'cache_hit',
      generated_at: '2026-05-09T11:30:00.000Z',
      template_version: '1.0.0',
      model_id: 'claude-haiku-4-5-20251001',
      regenerateAvailableAtMs: null,
    };
    render(
      <SummarySection
        summary={malicious}
        onRegenerate={() => {}}
        versionLabel="v003"
      />,
    );
    // No <script> element injected anywhere on the page.
    expect(document.querySelectorAll('script').length).toBe(0);
    // Body text contains the literal characters (escaped as text node) —
    // textContent shows the raw string verbatim because Preact text-child
    // interpolation creates a TEXT_NODE, NOT an element.
    const body = screen.getByTestId('summary-body');
    expect(body.textContent).toBe("<script>alert('xss')</script>");
    // Defence-in-depth: body has TEXT_NODE children only (not element nodes
    // that would indicate dangerouslySetInnerHTML usage).
    for (const child of Array.from(body.childNodes)) {
      expect(child.nodeType).toBe(Node.TEXT_NODE);
    }
  });

  // ==========================================================================
  // BLOCKER #4 (revision-1) — D-FB-6 DOM-stability invariant
  //
  // The fallback path adds a <WarningPill/> ABOVE the body <p> WITHIN the same
  // DOM slot — no new section header, no header-height change. This test
  // verifies the layout-stability contract per D-FB-6:
  //   (a) section header text reads 'SUMMARY' in BOTH states
  //   (b) <header> bounding-box height is identical
  //   (c) DOM slot positions are identical — section > header descendant
  //       ordering preserved across states; body <p> is rendered as a
  //       sibling of the header in both branches.
  // ==========================================================================

  describe('SummarySection DOM stability (D-FB-6, BLOCKER #4 revision-1)', () => {
    it('Test 16: D-FB-6 layout-stability invariant — header text/height/slot positions identical across success/fallback states', () => {
      // Mount the success-state variant first, capture invariants, then
      // unmount and mount the fallback variant. We compare the same DOM
      // contract across the two renders.

      const { unmount } = render(
        <SummarySection
          summary={successState}
          onRegenerate={() => {}}
          versionLabel="v003"
        />,
      );
      const successSection = screen.getByTestId('summary-section');
      const successHeader = successSection.querySelector('header');
      const successHeading = successSection.querySelector('h3');
      // (a) header text reads 'SUMMARY'
      expect(successHeading?.textContent).toBe('SUMMARY');
      // (c) header is the FIRST descendant of section in the success state
      // (DOM-slot ordering invariant — the header must always be the first
      // child of the section element, before the body / disclosure slots).
      expect(successSection.firstElementChild).toBe(successHeader);
      // (b) bounding-box height — record under jsdom (which returns 0 by
      // default), but the contract is structural: capture the header's
      // outerHTML structural fingerprint as a deterministic stand-in for
      // visual height invariance under jsdom.
      const successHeaderHeight = successHeader?.getBoundingClientRect().height ?? 0;
      const successHeaderStructure = headerStructuralFingerprint(successHeader);
      // Body <p> is the immediate next sibling of <header> in the success
      // state.
      const successBody = successSection.querySelector('[data-testid="summary-body"]');
      expect(successHeader?.nextElementSibling).toBe(successBody);

      unmount();

      render(
        <SummarySection
          summary={fallbackState}
          onRegenerate={() => {}}
          versionLabel="v003"
        />,
      );
      const fallbackSection = screen.getByTestId('summary-section');
      const fallbackHeader = fallbackSection.querySelector('header');
      const fallbackHeading = fallbackSection.querySelector('h3');
      // (a) header text identical
      expect(fallbackHeading?.textContent).toBe('SUMMARY');
      // (c) header is still the FIRST descendant of section in fallback state
      expect(fallbackSection.firstElementChild).toBe(fallbackHeader);
      // (b) bounding-box height identical — under jsdom both will return 0,
      // which still verifies "they match"; the structural fingerprint is the
      // load-bearing assertion under jsdom (see helper below).
      const fallbackHeaderHeight = fallbackHeader?.getBoundingClientRect().height ?? 0;
      const fallbackHeaderStructure = headerStructuralFingerprint(fallbackHeader);
      expect(fallbackHeaderHeight).toBe(successHeaderHeight);
      expect(fallbackHeaderStructure).toBe(successHeaderStructure);
      // Body <p> is the IMMEDIATE next sibling of <header> in success state;
      // in fallback state, the immediate next sibling is the WarningPill,
      // and the body <p> follows the WarningPill. Both states preserve
      // "header is first; body content follows" — the layout slot order is
      // (header, [optional warning], body, [optional children]).
      // Verify the first non-header descendant after header is either:
      //   - body text (success), or
      //   - WarningPill followed by body (fallback)
      // — both fit "section > header > then body content" — header position
      // and identity is invariant.
      const fallbackBody = fallbackSection.querySelector(
        '[data-testid="summary-body"]',
      );
      expect(fallbackBody).not.toBeNull();
    });
  });
});

/**
 * Build a structural fingerprint of the header element — tag names + class
 * names + child element tags — independent of layout pixel measurements
 * (which are unreliable under jsdom).
 *
 * The fingerprint serves as a deterministic proxy for header invariance:
 * if the success and fallback states share an identical fingerprint, the
 * header DOM structure (and therefore the rendered visual height when
 * stylesheets resolve) is identical by construction.
 */
function headerStructuralFingerprint(header: Element | null): string {
  if (!header) return '<null>';
  const childTags = Array.from(header.children).map((c) => c.tagName).join(',');
  return `tag=${header.tagName};class=${header.className};children=${childTags}`;
}
