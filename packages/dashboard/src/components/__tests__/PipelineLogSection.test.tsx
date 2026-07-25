/**
 * PipelineLogSection — collapsed-by-default, lazy-fetch on expand, and the
 * loading / error / retry / rendered states. Mocks fetchShotPipelineLog.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';

const fetchLogMock = vi.fn();
vi.mock('../../lib/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api.js')>('../../lib/api.js');
  return {
    ...actual,
    fetchShotPipelineLog: (...a: unknown[]) => fetchLogMock(...a),
  };
});

import { PipelineLogSection } from '../PipelineLogSection.js';

const SAMPLE = {
  markdown: '# Pipeline Log — SH_020\n\n- **Recorded spend:** 0.08 USD\n',
  breadcrumb: [],
  breadcrumb_text: 'Demo Show / SEQ010 / SH_020',
  shot_id: 'shot_1',
  take_count: 2,
};

beforeEach(() => {
  fetchLogMock.mockReset();
});

describe('PipelineLogSection', () => {
  it('is collapsed by default and does not fetch on mount', () => {
    const { getByRole, queryByTestId } = render(
      <PipelineLogSection shotId="shot_1" />,
    );
    expect(getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(fetchLogMock).not.toHaveBeenCalled();
    expect(queryByTestId('markdown-view')).toBeNull();
  });

  it('lazy-fetches and renders the markdown on first expand', async () => {
    fetchLogMock.mockResolvedValueOnce(SAMPLE);
    const { getByRole, getByTestId } = render(
      <PipelineLogSection shotId="shot_1" />,
    );
    fireEvent.click(getByRole('button'));
    await waitFor(() => expect(getByTestId('markdown-view')).toBeInTheDocument());
    expect(fetchLogMock).toHaveBeenCalledWith('shot_1');
    // recorded-spend line rendered
    expect(getByTestId('markdown-view').textContent).toContain('Recorded spend');
    // take-count caption
    expect(getByTestId('pipeline-log-section').textContent).toContain('2 takes');
  });

  it('shows an error surface with a working Retry', async () => {
    fetchLogMock.mockRejectedValueOnce(new Error('500'));
    const { getByRole, getByText, getByTestId } = render(
      <PipelineLogSection shotId="shot_1" />,
    );
    fireEvent.click(getByRole('button'));
    await waitFor(() => expect(getByText('Retry')).toBeInTheDocument());
    // Retry re-fetches; this time succeed
    fetchLogMock.mockResolvedValueOnce(SAMPLE);
    fireEvent.click(getByText('Retry'));
    await waitFor(() => expect(getByTestId('markdown-view')).toBeInTheDocument());
    expect(fetchLogMock).toHaveBeenCalledTimes(2);
  });

  it('does not re-fetch when collapsed and re-expanded after a successful load', async () => {
    fetchLogMock.mockResolvedValueOnce(SAMPLE);
    const { getByRole, getByTestId } = render(
      <PipelineLogSection shotId="shot_1" />,
    );
    fireEvent.click(getByRole('button')); // expand → fetch
    await waitFor(() => expect(getByTestId('markdown-view')).toBeInTheDocument());
    fireEvent.click(getByRole('button')); // collapse
    fireEvent.click(getByRole('button')); // re-expand
    // Still only one fetch — data was cached in local state
    expect(fetchLogMock).toHaveBeenCalledTimes(1);
  });
});
