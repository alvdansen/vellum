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
    // Phase 14 Plan 04 Task 2 — auto-fetch in VersionDrawer reads C2PA signing
    // status via HEAD on the output route. Default mock returns
    // { status: 'unknown' } so pre-Phase-14 tests pass through unchanged
    // (badge renders 'C2PA: pending' without any other change to the drawer).
    getC2paStatus: vi.fn(),
  };
});

import {
  diffVersion as mockDiffVersion,
  getProvenance as mockGetProvenance,
  getC2paStatus as mockGetC2paStatus,
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
    vi.mocked(mockGetC2paStatus).mockReset();
    // Default to 'unknown' so Phase 12 reproduction tests don't have to care
    // about C2PA. Phase 14 tests below override per-test.
    vi.mocked(mockGetC2paStatus).mockResolvedValue({ status: 'unknown' });
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

describe('VersionDrawer C2PA signing badge (Phase 14 — Plan 14-04 Task 2)', () => {
  beforeEach(() => {
    vi.mocked(mockDiffVersion).mockReset();
    vi.mocked(mockGetProvenance).mockReset();
    vi.mocked(mockGetProvenance).mockResolvedValue({ events: [] });
    vi.mocked(mockGetC2paStatus).mockReset();
  });

  it('renders "C2PA: signed" badge in Output section when getC2paStatus returns signed', async () => {
    vi.mocked(mockGetC2paStatus).mockResolvedValue({ status: 'signed' });
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockGetC2paStatus)).toHaveBeenCalledWith('ver_b');
    });
    await waitFor(() => {
      const badge = screen.getByTestId('c2pa-badge');
      expect(badge.textContent).toMatch(/C2PA:\s*signed/i);
    });
  });

  it('renders "C2PA: unsigned (unsupported format)" badge when getC2paStatus returns unsigned + unsupported_format', async () => {
    vi.mocked(mockGetC2paStatus).mockResolvedValue({
      status: 'unsigned',
      reason: 'unsupported_format',
    });
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      const badge = screen.getByTestId('c2pa-badge');
      expect(badge.textContent).toMatch(/C2PA:\s*unsigned\s*\(unsupported format\)/i);
    });
  });

  it('renders "C2PA: pending" badge when getC2paStatus returns unknown (legacy / pre-Phase-14)', async () => {
    vi.mocked(mockGetC2paStatus).mockResolvedValue({ status: 'unknown' });
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      const badge = screen.getByTestId('c2pa-badge');
      expect(badge.textContent).toMatch(/C2PA:\s*pending/i);
    });
  });

  it('renders "C2PA: unsigned (signing disabled)" badge for status_reason=signing_disabled', async () => {
    vi.mocked(mockGetC2paStatus).mockResolvedValue({
      status: 'unsigned',
      reason: 'signing_disabled',
    });
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      const badge = screen.getByTestId('c2pa-badge');
      expect(badge.textContent).toMatch(/C2PA:\s*unsigned\s*\(signing disabled\)/i);
    });
  });

  it('does NOT render any sidecar download link (v1.1 scope reduction — Concern #2)', async () => {
    vi.mocked(mockGetC2paStatus).mockResolvedValue({ status: 'signed' });
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('c2pa-badge')).toBeTruthy();
    });
    // No "Sidecar (.c2pa)" / "Download manifest" / similar text.
    expect(screen.queryByText(/sidecar.*\.c2pa/i)).toBeNull();
    expect(screen.queryByText(/download manifest/i)).toBeNull();
    // No anchor with href ending in '.c2pa'. Iterate all anchors and assert.
    const anchors = document.querySelectorAll('a');
    for (const a of Array.from(anchors)) {
      expect(a.getAttribute('href')).not.toMatch(/\.c2pa$/);
    }
  });

  it('badge renders only when version status is complete (Output section is hidden otherwise)', async () => {
    vi.mocked(mockGetC2paStatus).mockResolvedValue({ status: 'signed' });
    // version.status = 'submitted' triggers the StatusPill but skips the
    // Output section — the badge lives inside the Output section so it
    // should NOT render when the version is not yet complete.
    render(
      <VersionDrawer
        version={{ ...baseVersion, status: 'submitted' }}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    // Wait long enough for any potential auto-fetch to have settled.
    await waitFor(() => {
      expect(vi.mocked(mockGetProvenance)).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('c2pa-badge')).toBeNull();
  });

  it('handles getC2paStatus rejection gracefully — falls back to "C2PA: pending"', async () => {
    vi.mocked(mockGetC2paStatus).mockRejectedValue(new Error('Network error'));
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      const badge = screen.getByTestId('c2pa-badge');
      expect(badge.textContent).toMatch(/C2PA:\s*pending/i);
    });
  });

  it('issues exactly one getC2paStatus call per drawer mount', async () => {
    vi.mocked(mockGetC2paStatus).mockResolvedValue({ status: 'signed' });
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockGetC2paStatus)).toHaveBeenCalledTimes(1);
    });
    // Wait a microtask to confirm no second fetch fires.
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(mockGetC2paStatus)).toHaveBeenCalledTimes(1);
  });

  it('T-14-11: badge text is rendered as a text node (no innerHTML / no <script>)', async () => {
    vi.mocked(mockGetC2paStatus).mockResolvedValue({
      status: 'unsigned',
      reason: '<script>alert(1)</script>',
    });
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      const badge = screen.getByTestId('c2pa-badge');
      // Angle brackets must NOT appear in the rendered text — replace() filter
      // strips them BEFORE Preact emits the text node, AND Preact's text
      // interpolation escapes any leftovers as text content (defence in depth).
      expect(badge.textContent).not.toMatch(/<|>/);
      // No <script> elements injected anywhere in the drawer.
      expect(document.querySelectorAll('script').length).toBe(0);
    });
  });
});
