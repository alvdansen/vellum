/**
 * Thumbnail component tests (Phase 17 — Plan 17-04 Task 3).
 *
 * Covers the <Thumbnail/> wrapper component that VersionCard + TreeSidebar
 * shot rows consume in Plan 17-05. Owns lazy-load <img loading="lazy"> +
 * skeleton fallback + C2PA shield overlay logic per UI-SPEC §"<Thumbnail/>
 * API contract" (lines 181-237).
 *
 * Render contract verified by these 9 tests:
 *   - Test 1: complete + no shield → real <img> at /api/versions/.../thumbnail
 *   - Test 2: queued/running/failed → no <img>, skeleton present, aria-busy='true'
 *   - Test 3: signed status → <C2paShield/> overlay rendered
 *   - Test 4: unsigned/unknown/undefined → NO shield (D-10 LOCKED)
 *   - Test 5: img onError → swap to skeleton + aria-label='Preview unavailable for ...'
 *   - Test 6: <img> has loading='lazy' attribute (REQUIREMENTS.md VIS-01)
 *   - Test 7: explicit width + height HTML attributes for CLS=0
 *   - Test 8: size='sm' wrapper has inline width: 80px style (UI-SPEC dimensional)
 *   - Test 9: size='sm' shield class h-3.5 w-3.5; size='card' shield h-5 w-5
 *
 * Mirrors VersionCard.test.tsx in structure: vitest + @testing-library/preact;
 * one render per test; screen.getByAltText / queryByTestId for queries;
 * vi.fn() for callback isolation.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { Thumbnail } from '../components/Thumbnail.js';
import type { ThumbnailVersion } from '../components/Thumbnail.js';

// Helper — minimal version satisfying <ThumbnailVersion> for these tests.
function makeVersion(overrides: Partial<ThumbnailVersion> = {}): ThumbnailVersion {
  return {
    id: 'ver_abc',
    label: 'v001',
    status: 'complete',
    ...overrides,
  };
}

describe('Thumbnail (Phase 17 — Plan 17-04 Task 3)', () => {
  it('Test 1: renders <img> at /api/versions/:id/thumbnail for completed version (no shield)', () => {
    render(<Thumbnail version={makeVersion({ status: 'complete' })} />);
    const img = screen.getByAltText('Output for v001') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toMatch(/\/api\/versions\/ver_abc\/thumbnail$/);
    // No shield without c2paStatus
    expect(screen.queryByTestId('c2pa-shield')).toBeNull();
  });

  it('Test 2: renders skeleton (no img) for non-completed versions; aria-busy="true"', () => {
    for (const status of ['queued', 'running', 'failed'] as const) {
      const { unmount, container } = render(
        <Thumbnail version={makeVersion({ status })} />,
      );
      // No real <img>
      expect(screen.queryByAltText('Output for v001')).toBeNull();
      // Skeleton present (the SkeletonThumbnail uses role='presentation' + aria-hidden)
      const skeleton = container.querySelector('[role="presentation"]');
      expect(skeleton).toBeTruthy();
      // The wrapper carries aria-busy='true' while loading (UI-SPEC accessibility)
      const wrapper = container.firstElementChild as HTMLElement | null;
      expect(wrapper?.getAttribute('aria-busy')).toBe('true');
      unmount();
    }
  });

  it('Test 3: renders <C2paShield/> ONLY for c2paStatus.status === "signed" (D-10 LOCKED)', () => {
    render(
      <Thumbnail
        version={makeVersion({ status: 'complete' })}
        c2paStatus={{ status: 'signed' }}
      />,
    );
    expect(screen.getByTestId('c2pa-shield')).toBeTruthy();
  });

  it('Test 4: does NOT render <C2paShield/> for unsigned / unknown / undefined (D-10 LOCKED)', () => {
    const cases: Array<{ label: string; c2paStatus?: import('../lib/api.js').C2paStatus }> = [
      { label: 'unsigned', c2paStatus: { status: 'unsigned', reason: 'cert_load_failed' } },
      { label: 'unknown', c2paStatus: { status: 'unknown' } },
      { label: 'undefined', c2paStatus: undefined },
    ];
    for (const { label, c2paStatus } of cases) {
      const { unmount } = render(
        <Thumbnail
          version={makeVersion({ status: 'complete', label })}
          c2paStatus={c2paStatus}
        />,
      );
      expect(screen.queryByTestId('c2pa-shield')).toBeNull();
      unmount();
    }
  });

  it('Test 5: img onError → swaps to skeleton + aria-label="Preview unavailable for v001"', () => {
    const { container } = render(
      <Thumbnail version={makeVersion({ status: 'complete', label: 'v001' })} />,
    );
    const img = screen.getByAltText('Output for v001') as HTMLImageElement;
    expect(img).toBeTruthy();
    // Fire the browser's onerror event on the <img>
    fireEvent.error(img);
    // After onError: <img> is gone, skeleton renders, wrapper aria-label set
    expect(screen.queryByAltText('Output for v001')).toBeNull();
    const skeleton = container.querySelector('[role="presentation"]');
    expect(skeleton).toBeTruthy();
    const wrapper = container.firstElementChild as HTMLElement | null;
    expect(wrapper?.getAttribute('aria-label')).toBe('Preview unavailable for v001');
  });

  it('Test 6: <img> has loading="lazy" attribute (REQUIREMENTS.md VIS-01)', () => {
    render(<Thumbnail version={makeVersion({ status: 'complete' })} />);
    const img = screen.getByAltText('Output for v001') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('Test 7: explicit width + height HTML attributes for CLS=0 (size variant matrix)', () => {
    // size='card' (default) → 640×360 intrinsic ratio attributes
    const { unmount: unmountCard } = render(
      <Thumbnail version={makeVersion({ status: 'complete' })} />,
    );
    const cardImg = screen.getByAltText('Output for v001') as HTMLImageElement;
    expect(cardImg.getAttribute('width')).toBe('640');
    expect(cardImg.getAttribute('height')).toBe('360');
    unmountCard();

    // size='sm' → 80×45 (TreeSidebar fixed dimensions)
    render(
      <Thumbnail
        version={makeVersion({ status: 'complete' })}
        size="sm"
      />,
    );
    const smImg = screen.getByAltText('Output for v001') as HTMLImageElement;
    expect(smImg.getAttribute('width')).toBe('80');
    expect(smImg.getAttribute('height')).toBe('45');
  });

  it('Test 8: size="sm" wrapper has inline width: 80px style (UI-SPEC §"Dimensional contract")', () => {
    const { container } = render(
      <Thumbnail
        version={makeVersion({ status: 'complete' })}
        size="sm"
      />,
    );
    const wrapper = container.firstElementChild as HTMLElement | null;
    // Inline width: 80px style on the outer wrapper
    expect(wrapper?.style.width).toBe('80px');
  });

  it('Test 9: shield class differs by size variant — sm: h-3.5 w-3.5; card: h-5 w-5', () => {
    // size='sm' → shield receives h-3.5 w-3.5 sizing
    const { unmount: unmountSm, container: smContainer } = render(
      <Thumbnail
        version={makeVersion({ status: 'complete' })}
        size="sm"
        c2paStatus={{ status: 'signed' }}
      />,
    );
    const smShield = smContainer.querySelector('[data-testid="c2pa-shield"]') as Element | null;
    expect(smShield).toBeTruthy();
    const smCls = smShield?.getAttribute('class') ?? '';
    expect(smCls).toContain('h-3.5');
    expect(smCls).toContain('w-3.5');
    unmountSm();

    // size='card' (default) → shield receives h-5 w-5 sizing
    const { container: cardContainer } = render(
      <Thumbnail
        version={makeVersion({ status: 'complete' })}
        c2paStatus={{ status: 'signed' }}
      />,
    );
    const cardShield = cardContainer.querySelector('[data-testid="c2pa-shield"]') as Element | null;
    expect(cardShield).toBeTruthy();
    const cardCls = cardShield?.getAttribute('class') ?? '';
    expect(cardCls).toContain('h-5');
    expect(cardCls).toContain('w-5');
  });

  // ────────────────────────────────────────────────────────────────────
  // Additional contract tests — UI-SPEC API surface coverage beyond the
  // 9 behaviors enumerated in the plan. Each test below maps to a
  // separate prop/contract in UI-SPEC §"<Thumbnail/> API contract".
  // ────────────────────────────────────────────────────────────────────

  it('Test 10: ariaLabel prop overrides the default "Output for ${label}" alt text', () => {
    render(
      <Thumbnail
        version={makeVersion({ status: 'complete', label: 'v003' })}
        ariaLabel="Custom alt text"
      />,
    );
    // Default alt is gone; custom alt is rendered as the <img> alt attribute
    expect(screen.queryByAltText('Output for v003')).toBeNull();
    const img = screen.getByAltText('Custom alt text') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('alt')).toBe('Custom alt text');
  });

  it('Test 11: optional class prop is composed onto the wrapper (NOT applied to <img>)', () => {
    const { container } = render(
      <Thumbnail
        version={makeVersion({ status: 'complete' })}
        class="custom-wrapper-class"
      />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const wrapperCls = wrapper.getAttribute('class') ?? '';
    // Wrapper has BOTH the default and the user-supplied composition
    expect(wrapperCls).toContain('custom-wrapper-class');
    expect(wrapperCls).toContain('aspect-video');
    // The <img> inside does NOT receive the wrapper class
    const img = screen.getByAltText('Output for v001') as HTMLImageElement;
    const imgCls = img.getAttribute('class') ?? '';
    expect(imgCls).not.toContain('custom-wrapper-class');
  });

  it('Test 12: D-07 + D-10 interaction — shield NOT rendered for signed status when version is non-complete', () => {
    // A version with c2paStatus.signed but status='running' is showing the
    // skeleton (D-07 unified treatment). The shield must NOT render on top of
    // the skeleton — the skeleton is the entire visual surface during
    // in-progress generation. UI-SPEC §"Render contract" only emits the
    // shield on the complete + no-error render path.
    render(
      <Thumbnail
        version={makeVersion({ status: 'running' })}
        c2paStatus={{ status: 'signed' }}
      />,
    );
    expect(screen.queryByTestId('c2pa-shield')).toBeNull();
    // And no <img> either
    expect(screen.queryByAltText('Output for v001')).toBeNull();
  });
});
