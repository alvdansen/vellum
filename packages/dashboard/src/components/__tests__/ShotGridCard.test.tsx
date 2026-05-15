/**
 * Phase 21 / Plan 21-03 — Task T01 — ShotGridCard component tests.
 *
 * Covers REQ-GRID-01 single-button card + D-16/D-17/D-19 LOCKED decisions:
 *   - Renders <Thumbnail/> when latest_completed_version !== null;
 *     <SkeletonThumbnail/> when null (D-19)
 *   - Click invokes onSelect(latest_completed_version.id) only when hasVersion;
 *     aria-disabled="true" and onClick suppressed when no version (D-19)
 *   - When status === 'omit', wraps in opacity-40 div (D-17 — pill remains 100%)
 *   - Version count text variants — 0 / 1 / 3 — exactly match copy constants
 *   - aria-label format: 'Open version drawer for {shotName}' (D-16)
 *   - When hasVersion, renders 'Updated ' prefix + relative timestamp
 *
 * Landmine guards (PATTERNS §18):
 *   - `fireEvent.click` is synchronous; `vi.fn()` records the call
 *   - Stable-DOM-across-status-mutation is a parent-level test (ShotGridView Wave 4)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { ShotGridCard } from '../ShotGridCard.js';
import type { ShotGridRow } from '../../types/shot-grid.js';

afterEach(() => cleanup());

function buildShot(overrides: Partial<ShotGridRow> = {}): ShotGridRow {
  return {
    id: 'shot_1',
    name: 'sh010',
    status: 'approved',
    version_count: 3,
    latest_completed_version: {
      id: 'ver_abc',
      thumbnail_url: '/api/versions/ver_abc/thumbnail',
      completed_at: Date.now() - 60_000, // 1 min ago
    },
    ...overrides,
  };
}

describe('ShotGridCard (Phase 21 GRID-01)', () => {
  it('renders <Thumbnail/> when latest_completed_version !== null', () => {
    const { container } = render(
      <ShotGridCard shot={buildShot()} onSelect={vi.fn()} />,
    );
    expect(container.querySelector('img')).toBeTruthy();
  });

  it('renders SkeletonThumbnail + aria-disabled + no onSelect when no completed version (D-19)', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ShotGridCard
        shot={buildShot({ latest_completed_version: null })}
        onSelect={onSelect}
      />,
    );
    // No <img> — Thumbnail not rendered
    expect(container.querySelector('img')).toBeFalsy();
    // aria-disabled='true' on the button
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // Click does NOT invoke onSelect
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('click invokes onSelect with latest_completed_version.id (D-19 / D-16)', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ShotGridCard shot={buildShot()} onSelect={onSelect} />,
    );
    const button = container.querySelector('button') as HTMLButtonElement;
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith('ver_abc');
  });

  it('omit status wraps card in opacity-40 div (D-17)', () => {
    const { container } = render(
      <ShotGridCard
        shot={buildShot({ status: 'omit' })}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector('.opacity-40')).toBeTruthy();
    // The inner pill MUST NOT itself be opacity-40 — the wrapper is.
    const pill = container.querySelector('[data-status="omit"]') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.className).not.toContain('opacity-40');
  });

  it('non-omit status does NOT wrap in opacity-40 div', () => {
    const { container } = render(
      <ShotGridCard
        shot={buildShot({ status: 'approved' })}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector('.opacity-40')).toBeFalsy();
  });

  it('version_count text variants — 0 / 1 / 3', () => {
    // The version-count surface is a <span class="num text-xs ..."> inside
    // the card's flex row — find it via the second .num span (first is the
    // version-count line; the optional Updated line is the second .num when
    // hasVersion). We instead match by sibling-of <ShotStatusPill/>: the
    // version-count span lives in the same flex row as the [data-status] pill.

    function getVersionCountText(container: Element): string | undefined {
      // Phase 22 D-13: the [data-status] span is now wrapped in a button
      // (ShotStatusPill dual-mode). Walk up two levels to find the flex
      // row that holds the count sibling.
      const pill = container.querySelector('[data-status]');
      const pillButton = pill?.closest('button');
      const row = (pillButton ?? pill)?.parentElement;
      // First .num inside the row is the version-count text we want;
      // the "Updated" line lives in a separate sibling span.
      const countSpan = row?.querySelector('.num');
      return countSpan?.textContent ?? undefined;
    }

    // 0 → "No versions yet"
    {
      const { container } = render(
        <ShotGridCard
          shot={buildShot({ version_count: 0, latest_completed_version: null })}
          onSelect={vi.fn()}
        />,
      );
      expect(getVersionCountText(container)).toBe('No versions yet');
      cleanup();
    }
    // 1 → "1 version" EXACTLY (singular, no 's')
    {
      const { container } = render(
        <ShotGridCard shot={buildShot({ version_count: 1 })} onSelect={vi.fn()} />,
      );
      expect(getVersionCountText(container)).toBe('1 version');
      cleanup();
    }
    // 3 → "3 versions" EXACTLY
    {
      const { container } = render(
        <ShotGridCard shot={buildShot({ version_count: 3 })} onSelect={vi.fn()} />,
      );
      expect(getVersionCountText(container)).toBe('3 versions');
    }
  });

  it("aria-label is 'Open version drawer for {shotName}' (D-16)", () => {
    const { container } = render(
      <ShotGridCard
        shot={buildShot({ name: 'sh042' })}
        onSelect={vi.fn()}
      />,
    );
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Open version drawer for sh042');
  });

  it("renders 'Updated ' prefix + relative timestamp when hasVersion", () => {
    // completed_at = 60 seconds ago → formatRelativeTime returns '1m ago' (just past the < 60s bucket).
    // Using 65_000ms to be safe across test runtime jitter.
    const completed_at = Date.now() - 65_000;
    const { container } = render(
      <ShotGridCard
        shot={buildShot({ latest_completed_version: { id: 'ver_x', thumbnail_url: '/t', completed_at } })}
        onSelect={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Updated ');
    // Either '1m ago' (>= 60s) or 'just now' (race) — accept either bucket
    const hasMinuteBucket = container.textContent?.includes('1m ago');
    const hasJustNow = container.textContent?.includes('just now');
    expect(hasMinuteBucket || hasJustNow).toBe(true);
  });

  it('does NOT render the Updated line when no completed version', () => {
    const { container } = render(
      <ShotGridCard
        shot={buildShot({ latest_completed_version: null, version_count: 0 })}
        onSelect={vi.fn()}
      />,
    );
    expect(container.textContent).not.toContain('Updated ');
  });
});
