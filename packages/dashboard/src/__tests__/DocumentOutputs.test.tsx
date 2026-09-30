import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { Thumbnail } from '../components/Thumbnail.js';
import { primaryOutput } from '../lib/output-kind.js';

vi.mock('../lib/api.js', async () => ({
  ...await vi.importActual('../lib/api.js'),
  getProvenance: vi.fn().mockResolvedValue({ events: [] }),
  getC2paStatus: vi.fn().mockResolvedValue({ status: 'unknown' }),
}));
vi.mock('../state/summaries.js', async () => {
  const { signal } = await import('@preact/signals');
  return { summarySignal: signal(new Map()), fetchSummary: vi.fn().mockResolvedValue({ state: 'success', text: 'Generation summary' }) };
});
import { VersionDrawer } from '../views/VersionDrawer.js';
import { fetchSummary } from '../state/summaries.js';

const base = { id: 'ver_document', shot_id: 'shot_docs', version_number: 1, status: 'completed' as const };
const outputJson = (mime: string, filename = 'receipt.json') => JSON.stringify([{ content_type: mime, filename, url: 'https://untrusted.invalid/file' }]);

beforeEach(() => vi.mocked(fetchSummary).mockClear());

describe('Terminal preview states and stored documents', () => {
  it('stops animating after an image error and retries when the version changes', () => {
    const { container, rerender } = render(<Thumbnail version={{ id: 'one', label: 'v001', status: 'complete' }} />);
    fireEvent.error(screen.getByAltText('Output for v001'));
    expect(screen.getByText('Preview unavailable')).toBeTruthy();
    expect(container.querySelector('.animate-skeleton-shimmer')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    rerender(<Thumbnail version={{ id: 'two', label: 'v002', status: 'complete' }} />);
    expect(screen.getByAltText('Output for v002').getAttribute('src')).toContain('/two/thumbnail');
  });

  it('a failed generation is a static terminal state', () => {
    const { container } = render(<Thumbnail version={{ id: 'failed', label: 'v001', status: 'failed' }} />);
    expect(screen.getByText('Generation failed')).toBeTruthy();
    expect(container.querySelector('.animate-skeleton-shimmer')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('shows the stored document, provenance and download without inventing a generation summary', async () => {
    const { container } = render(<VersionDrawer version={{ ...base, outputs_json: outputJson('application/json'), notes: 'Preparation receipt; no model job ran.' }} priorVersion={null} onClose={() => {}} />);
    expect(screen.getByText('Stored document')).toBeTruthy();
    expect(screen.getByText('Preparation receipt; no model job ran.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Download receipt.json' });
    expect(link.getAttribute('href')).toBe('/api/versions/ver_document/output');
    expect(link.getAttribute('download')).toBe('receipt.json');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('button', { name: /Regenerate/ })).toBeNull();
    await waitFor(() => expect(screen.getByTestId('provenance-disclosure')).toBeTruthy());
    expect(fetchSummary).not.toHaveBeenCalled();
  });

  it.each(['video', 'audio'] as const)('uses a %s player for a media output', (kind) => {
    const { container } = render(<VersionDrawer version={{ ...base, outputs_json: outputJson(kind + '/mp4', 'take.mp4') }} priorVersion={null} onClose={() => {}} />);
    const player = container.querySelector(kind);
    expect(player?.hasAttribute('controls')).toBe(true);
    expect(player?.getAttribute('src')).toBe('/api/versions/ver_document/output');
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps the image display path for existing image records', async () => {
    render(<VersionDrawer version={{ ...base, outputs_json: outputJson('image/png', 'frame.png') }} priorVersion={null} onClose={() => {}} />);
    expect(screen.getByAltText('Output for v001')).toBeTruthy();
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledWith('ver_document'));
  });

  it('handles legacy and malformed output metadata without treating an unknown file as a document', () => {
    expect(primaryOutput('{broken').kind).toBe('unknown');
    expect(primaryOutput(null).kind).toBe('unknown');
    expect(primaryOutput(JSON.stringify([{ filename: 'frame.png' }])).kind).toBe('unknown');
    expect(primaryOutput(JSON.stringify([{ filename: 'NOTES.MD' }])).kind).toBe('file');
    expect(primaryOutput(outputJson('text/markdown; charset=utf-8')).kind).toBe('file');
  });
});
