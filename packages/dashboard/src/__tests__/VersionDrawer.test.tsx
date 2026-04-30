/**
 * VersionDrawer reproduction divergence integration tests (Phase 12 — DEMO-03).
 *
 * Covers the four user-visible UI states the dashboard cohort closes:
 *   (a) Non-reproduce-lineage: drawer never auto-fetches diff — no pill, no block.
 *   (b) Reproduce-lineage + bytes match (reproduction_divergence === null):
 *       drawer DOES auto-fetch, but renders no pill / no block (criterion #4).
 *   (c) Reproduce-lineage + sha256_mismatch + both outputs present: pill + block.
 *   (d) Reproduce-lineage + warnings non-empty + outputs missing: pill, no block.
 *
 * Plus two guardrails:
 *   - priorVersion=null + reproduce-lineage: never auto-fetches (no parent to diff).
 *   - "View Diff" click after auto-fetch: existing diff is reused (no refetch).
 *
 * Mocking strategy: vi.mock the api module so we can both count diffVersion
 * calls and feed canned responses per test. Mirrors the
 * sse-signal-integration.test.tsx pattern of stubbing the boundary at the
 * module level rather than spying on globals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import { VersionDrawer } from '../views/VersionDrawer.js';
import type { Version } from '../types/entities.js';

vi.mock('../lib/api.js', async () => {
  const actual = (await vi.importActual('../lib/api.js')) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    getProvenance: vi.fn(),
    diffVersion: vi.fn(),
    getOutputUrl: (id: string) => `/api/versions/${id}/output`,
  };
});

import {
  diffVersion as mockDiffVersion,
  getProvenance as mockGetProvenance,
} from '../lib/api.js';

const baseVersion: Version = {
  id: 'ver_b',
  shot_id: 'shot_1',
  version_number: 2,
  status: 'completed',
};
const priorVersion: Version = {
  id: 'ver_a',
  shot_id: 'shot_1',
  version_number: 1,
  status: 'completed',
};

describe('VersionDrawer reproduction divergence (Phase 12 — DEMO-03)', () => {
  beforeEach(() => {
    vi.mocked(mockDiffVersion).mockReset();
    vi.mocked(mockGetProvenance).mockReset();
    vi.mocked(mockGetProvenance).mockResolvedValue({ events: [] });
  });

  it('non-reproduce-lineage: never auto-fetches diff; no pill; no comparison block', async () => {
    render(
      <VersionDrawer
        version={{ ...baseVersion, lineage_type: null }}
        priorVersion={priorVersion}
        onClose={() => {}}
      />,
    );
    // Wait for the provenance effect to settle so we know any auto-fetch effect
    // would also have had its chance to fire.
    await waitFor(() => {
      expect(vi.mocked(mockGetProvenance)).toHaveBeenCalled();
    });
    expect(vi.mocked(mockDiffVersion)).not.toHaveBeenCalled();
    expect(screen.queryByTestId('warning-pill')).toBeNull();
    expect(screen.queryByTestId('reproduction-comparison')).toBeNull();
  });

  it('reproduce-lineage + reproduction_divergence=null: fetches diff but renders no pill / no block (criterion #4)', async () => {
    vi.mocked(mockDiffVersion).mockResolvedValue({
      summary: 'No changes.',
      changes: {},
      reproduction_divergence: null,
    });
    render(
      <VersionDrawer
        version={{ ...baseVersion, lineage_type: 'reproduce' }}
        priorVersion={priorVersion}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockDiffVersion)).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId('warning-pill')).toBeNull();
    expect(screen.queryByTestId('reproduction-comparison')).toBeNull();
  });

  it('reproduce-lineage + sha256_mismatch populated: renders pill AND comparison block', async () => {
    vi.mocked(mockDiffVersion).mockResolvedValue({
      summary: 'No changes.',
      changes: {},
      reproduction_divergence: {
        sha256_mismatch: { parent: 'aaa', reproduction: 'bbb' },
        warnings: [],
        parent_output_present: true,
        reproduction_output_present: true,
      },
    });
    render(
      <VersionDrawer
        version={{ ...baseVersion, lineage_type: 'reproduce' }}
        priorVersion={priorVersion}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('warning-pill')).not.toBeNull();
    });
    expect(screen.queryByTestId('reproduction-comparison')).not.toBeNull();
    // Comparison block carries two output images — one for parent, one for
    // reproduction — pointing at the correct getOutputUrl URLs.
    const parentImg = screen.getByAltText(/parent output/i) as HTMLImageElement;
    const reproImg = screen.getByAltText(/reproduction output/i) as HTMLImageElement;
    expect(parentImg.src).toMatch(/\/api\/versions\/ver_a\/output$/);
    expect(reproImg.src).toMatch(/\/api\/versions\/ver_b\/output$/);
  });

  it('reproduce-lineage + warnings non-empty + outputs missing: renders pill but NO comparison block', async () => {
    vi.mocked(mockDiffVersion).mockResolvedValue({
      summary: 'No changes.',
      changes: {},
      reproduction_divergence: {
        sha256_mismatch: null,
        warnings: ['Cloud API did not expose model metadata — reproduction is best-effort'],
        parent_output_present: false,
        reproduction_output_present: false,
      },
    });
    render(
      <VersionDrawer
        version={{ ...baseVersion, lineage_type: 'reproduce' }}
        priorVersion={priorVersion}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('warning-pill')).not.toBeNull();
    });
    expect(screen.queryByTestId('reproduction-comparison')).toBeNull();
  });

  it('reproduce-lineage + priorVersion=null: never auto-fetches; no pill; no block', async () => {
    render(
      <VersionDrawer
        version={{ ...baseVersion, lineage_type: 'reproduce' }}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockGetProvenance)).toHaveBeenCalled();
    });
    expect(vi.mocked(mockDiffVersion)).not.toHaveBeenCalled();
    expect(screen.queryByTestId('warning-pill')).toBeNull();
    expect(screen.queryByTestId('reproduction-comparison')).toBeNull();
  });

  it('clicking "View Diff" after auto-fetch does not refetch — diff is reused', async () => {
    vi.mocked(mockDiffVersion).mockResolvedValue({
      summary: 'No changes.',
      changes: {},
      reproduction_divergence: null,
    });
    render(
      <VersionDrawer
        version={{ ...baseVersion, lineage_type: 'reproduce' }}
        priorVersion={priorVersion}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockDiffVersion)).toHaveBeenCalledTimes(1);
    });
    const btn = screen.getByText(/view diff/i);
    btn.click();
    // Allow a microtask for any potential refetch to fire.
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(mockDiffVersion)).toHaveBeenCalledTimes(1);
  });
});
