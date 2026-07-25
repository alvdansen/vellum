/**
 * VersionCard component tests.
 *
 * Phase 17 / Plan 17-05 Task 1 — VersionCard now delegates the inline <img>
 * to <Thumbnail size='card'/> (D-19 LOCKED — object-contain not object-cover).
 *
 * Tests:
 *   1. (UPDATED) renders <Thumbnail/> pointing at /api/versions/:id/thumbnail
 *      for completed versions — assertion regex updated from /output to /thumbnail
 *      to reflect the Plan 17-05 swap.
 *   2. (PRESERVED) omits <img> for non-completed versions — Thumbnail's skeleton
 *      path renders without an <img>, so queryByAltText still returns null.
 *   3. (NEW) when c2paStatus={status:'signed'} is passed, <C2paShield/> is in DOM
 *      (delegated through Thumbnail per D-10).
 *   4. (NEW) VersionCard's <button> wrapper intact — onClick fires onSelect when
 *      the rendered Thumbnail region is clicked (D-11 click-bubble contract).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { VersionCard } from '../components/VersionCard.js';

describe('VersionCard', () => {
  it('renders <Thumbnail/> pointing at /api/versions/:id/thumbnail for completed versions', () => {
    render(
      <VersionCard
        version={{ id: 'ver_abc', label: 'v001', status: 'complete' }}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    const img = screen.getByAltText('Output for v001') as HTMLImageElement;
    expect(img).toBeTruthy();
    // Phase 17 / Plan 17-05 (D-19): URL now points at /thumbnail, not /output.
    expect(img.src).toMatch(/\/api\/versions\/ver_abc\/thumbnail$/);
    // D-19 LOCKED: object-contain (NOT object-cover). Thumbnail wraps its own
    // class on the inner <img>; the wrapper's class prop is not applied to <img>.
    expect(img.className).toContain('object-contain');
    expect(img.className).not.toContain('object-cover');
  });

  it('omits <img> for non-completed versions (running/queued/failed)', () => {
    for (const status of ['running', 'queued', 'failed'] as const) {
      const { unmount } = render(
        <VersionCard
          version={{ id: 'ver_abc', label: 'v001', status }}
          isSelected={false}
          onSelect={vi.fn()}
        />,
      );
      // Thumbnail's skeleton render path does NOT emit an <img> for non-completed
      // statuses (D-07 unified skeleton treatment) — queryByAltText returns null.
      expect(screen.queryByAltText('Output for v001')).toBeNull();
      unmount();
    }
  });

  it('still renders label + status pill regardless of status', () => {
    render(
      <VersionCard
        version={{ id: 'ver_abc', label: 'v001', status: 'failed' }}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('v001')).toBeTruthy();
  });

  it('renders <C2paShield/> when c2paStatus.status === "signed" (Phase 17 D-10)', () => {
    render(
      <VersionCard
        version={{ id: 'ver_abc', label: 'v001', status: 'complete' }}
        isSelected={false}
        onSelect={vi.fn()}
        c2paStatus={{ status: 'signed' }}
      />,
    );
    // C2paShield exposes data-testid='c2pa-shield' (Plan 17-04 contract).
    expect(screen.getByTestId('c2pa-shield')).toBeTruthy();
  });

  it('does NOT render <C2paShield/> when c2paStatus is undefined / unsigned / unknown (Phase 17 D-10 negative)', () => {
    // undefined → no shield
    const { unmount: u1 } = render(
      <VersionCard
        version={{ id: 'ver_abc', label: 'v001', status: 'complete' }}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('c2pa-shield')).toBeNull();
    u1();

    // unsigned → no shield
    const { unmount: u2 } = render(
      <VersionCard
        version={{ id: 'ver_abc', label: 'v001', status: 'complete' }}
        isSelected={false}
        onSelect={vi.fn()}
        c2paStatus={{ status: 'unsigned', reason: 'no_cert' }}
      />,
    );
    expect(screen.queryByTestId('c2pa-shield')).toBeNull();
    u2();

    // unknown → no shield
    render(
      <VersionCard
        version={{ id: 'ver_abc', label: 'v001', status: 'complete' }}
        isSelected={false}
        onSelect={vi.fn()}
        c2paStatus={{ status: 'unknown' }}
      />,
    );
    expect(screen.queryByTestId('c2pa-shield')).toBeNull();
  });

  it('clicking the card invokes onSelect (D-11 click-bubble contract preserved)', () => {
    const onSelect = vi.fn();
    render(
      <VersionCard
        version={{ id: 'ver_abc', label: 'v001', status: 'complete' }}
        isSelected={false}
        onSelect={onSelect}
      />,
    );
    // The <button> wrapper at lines 42-50 is unchanged — clicks bubble through
    // Thumbnail (which has zero click handlers) to the parent button's onClick.
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith('ver_abc');
  });
});
