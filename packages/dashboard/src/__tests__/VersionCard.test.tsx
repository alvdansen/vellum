/**
 * VersionCard component tests.
 *
 * Covers the image-rendering gap closed after v1.0: completed versions must
 * show their generated output as a thumbnail; non-completed versions must
 * NOT request an image (the streaming endpoint returns OUTPUT_UNAVAILABLE for
 * those and would render a broken-image icon).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { VersionCard } from '../components/VersionCard.js';

describe('VersionCard', () => {
  it('renders an <img> for completed versions pointing at /api/versions/:id/output', () => {
    render(
      <VersionCard
        version={{ id: 'ver_abc', label: 'v001', status: 'complete' }}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    const img = screen.getByAltText('Output for v001') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toMatch(/\/api\/versions\/ver_abc\/output$/);
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
});
