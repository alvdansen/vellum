/**
 * VersionDrawer Phase 19 integration tests (Plan 19-06 Task 3).
 *
 * Covers the 3 surgical changes to VersionDrawer:
 *   1. <SummarySection/> inserted ABOVE Output (visual hierarchy)
 *   2. Existing Provenance JSX relocated inside <details>/<summary> disclosure
 *      (collapsed by default, SUM-07)
 *   3. summary auto-fetch via useEffect([version.id]) + 500ms debounce on
 *      Regenerate + localStorage first-use ack
 *
 * Mocking strategy: vi.mock the api module + state/summaries module so we can
 * assert the auto-fetch + Regenerate handler contract without touching fetch.
 * Mirrors the sse-signal-integration.test.tsx + existing VersionDrawer.test.tsx
 * patterns at packages/dashboard/src/__tests__/VersionDrawer.test.tsx.
 *
 * The 16 tests live under views/__tests__/ per the plan path; the existing
 * 15 reproduction-divergence + C2PA tests at src/__tests__/VersionDrawer.test.tsx
 * remain unchanged (this file is additive — extends, does not replace).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';

/**
 * In-memory localStorage polyfill — Node 25+ ships an experimental native
 * `localStorage` global that takes precedence over jsdom's implementation
 * and is a no-op without `--localstorage-file`. Mirrors the polyfill used
 * by src/__tests__/theme-persistence.test.ts (the canonical precedent for
 * dashboard tests that need browser-equivalent localStorage).
 */
function makeMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    key(index: number): string | null {
      return Object.keys(store)[index] ?? null;
    },
    removeItem(key: string): void {
      delete store[key];
    },
    setItem(key: string, value: string): void {
      store[key] = String(value);
    },
  };
}

// Install the polyfill BEFORE importing VersionDrawer so the module-level
// useState initializer's localStorage read binds to the real implementation.
vi.stubGlobal('localStorage', makeMemoryStorage());

vi.mock('../../lib/api.js', async () => {
  const actual = (await vi.importActual('../../lib/api.js')) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    getProvenance: vi.fn(),
    diffVersion: vi.fn(),
    getOutputUrl: (id: string) => `/api/versions/${id}/output`,
    getC2paStatus: vi.fn(),
    getSummary: vi.fn(),
    regenerateSummary: vi.fn(),
  };
});

vi.mock('../../state/summaries.js', async () => {
  const { signal } = (await vi.importActual('@preact/signals')) as {
    signal: <T>(v: T) => { value: T };
  };
  return {
    summarySignal: signal(new Map()),
    fetchSummary: vi.fn(),
  };
});

import { VersionDrawer } from '../VersionDrawer.js';
import type { Version } from '../../types/entities.js';
import {
  diffVersion as mockDiffVersion,
  getProvenance as mockGetProvenance,
  getC2paStatus as mockGetC2paStatus,
} from '../../lib/api.js';
import {
  fetchSummary as mockFetchSummary,
  summarySignal,
} from '../../state/summaries.js';
import { SUMMARY_FIRST_USE_LOCALSTORAGE_KEY } from '../../lib/copy.js';

const baseVersion: Version = {
  id: 'ver_b',
  shot_id: 'shot_1',
  version_number: 3,
  status: 'completed',
};

const successResp = {
  state: 'success' as const,
  text: 'v003 generated with flux1-dev at seed 42.',
  source: 'cache_hit' as const,
  generated_at: '2026-05-09T11:30:00.000Z',
  template_version: '1.0.0',
  model_id: 'claude-haiku-4-5-20251001',
  regenerateAvailableAtMs: null,
};

describe('VersionDrawer Phase 19 — Plan 19-06 Task 3 (summary surface)', () => {
  beforeEach(() => {
    vi.mocked(mockDiffVersion).mockReset();
    vi.mocked(mockGetProvenance).mockReset();
    vi.mocked(mockGetProvenance).mockResolvedValue({
      events: [{ event_type: 'generation_started', payload: { foo: 1 } }],
    });
    vi.mocked(mockGetC2paStatus).mockReset();
    vi.mocked(mockGetC2paStatus).mockResolvedValue({ status: 'unknown' });
    vi.mocked(mockFetchSummary).mockReset();
    vi.mocked(mockFetchSummary).mockResolvedValue(successResp);
    summarySignal.value = new Map();
    // Reset localStorage for the first-use disclosure tests.
    try {
      localStorage.clear();
    } catch {
      /* SSR / privacy-mode safe */
    }
  });

  // ==========================================================================
  // Auto-fetch on mount + version.id change
  // ==========================================================================

  it('Test 1: mount with version.id="ver_b" → fetchSummary called with "ver_b"; SummarySection renders, success state lands', async () => {
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockFetchSummary)).toHaveBeenCalledWith('ver_b');
    });
    await waitFor(() => {
      const body = screen.getByTestId('summary-body');
      expect(body.textContent).toBe(successResp.text);
    });
  });

  it('Test 2: version.id change ("ver_b" → "ver_c") → fetchSummary called twice (once per id)', async () => {
    const { rerender } = render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockFetchSummary)).toHaveBeenCalledWith('ver_b');
    });

    rerender(
      <VersionDrawer
        version={{ ...baseVersion, id: 'ver_c' }}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockFetchSummary)).toHaveBeenCalledWith('ver_c');
    });
    expect(vi.mocked(mockFetchSummary).mock.calls.map((c) => c[0])).toEqual([
      'ver_b',
      'ver_c',
    ]);
  });

  it('Test 3: auto-fetch cancellation — unmount mid-fetch does NOT crash (alive guard)', async () => {
    // Construct a never-resolving promise; unmount mid-flight should not
    // produce console errors / crashes (defence-in-depth via let alive=true).
    vi.mocked(mockFetchSummary).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    const { unmount } = render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    // Wait for the effect to fire.
    await waitFor(() => {
      expect(vi.mocked(mockFetchSummary)).toHaveBeenCalled();
    });
    // Unmount mid-flight — must not throw.
    expect(() => unmount()).not.toThrow();
  });

  // ==========================================================================
  // Regenerate button — calls fetchSummary({ regenerate: true })
  // ==========================================================================

  it('Test 4: Regenerate button click → fetchSummary called with { regenerate: true }', async () => {
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockFetchSummary)).toHaveBeenCalled();
    });
    // Reset call history to focus on the Regenerate-triggered call only.
    vi.mocked(mockFetchSummary).mockClear();
    // Wait for success state to land so Regenerate button is enabled.
    await waitFor(() => {
      const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    btn.click();
    await waitFor(() => {
      expect(vi.mocked(mockFetchSummary)).toHaveBeenCalledWith('ver_b', {
        regenerate: true,
      });
    });
  });

  // ==========================================================================
  // 500ms debounce — two clicks within 500ms call fetchSummary once
  // ==========================================================================

  it('Test 5: 500ms debounce — two clicks within 500ms → fetchSummary called once', async () => {
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockFetchSummary)).toHaveBeenCalled();
    });
    vi.mocked(mockFetchSummary).mockClear();
    await waitFor(() => {
      const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    btn.click();
    btn.click(); // immediate second click — should be debounced

    // Allow microtasks to settle before asserting.
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(mockFetchSummary)).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // Provenance is INSIDE a <details> disclosure (SUM-07) — collapsed by default
  // ==========================================================================

  it('Test 6: Provenance is INSIDE <details><summary>Show provenance details</summary>... (SUM-07)', async () => {
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockGetProvenance)).toHaveBeenCalled();
    });
    const disclosure = screen.getByTestId('provenance-disclosure');
    expect(disclosure.tagName).toBe('DETAILS');
    const summary = disclosure.querySelector('summary');
    expect(summary?.textContent).toBe('Show provenance details');
  });

  it('Test 7: Provenance disclosure is COLLAPSED by default (no `open` attribute)', async () => {
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockGetProvenance)).toHaveBeenCalled();
    });
    const disclosure = screen.getByTestId('provenance-disclosure') as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);
  });

  it('Test 8: Existing Provenance JSON rendering preserved verbatim — JsonBlock components render inside disclosure body', async () => {
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockGetProvenance)).toHaveBeenCalled();
    });
    const disclosure = screen.getByTestId('provenance-disclosure');
    // The existing JsonBlock primitive renders <pre>{JSON.stringify(...)}</pre>
    // — at least one <pre> element should live inside the disclosure body.
    await waitFor(() => {
      const pre = disclosure.querySelector('pre');
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toMatch(/generation_started/);
    });
  });

  // ==========================================================================
  // SummarySection appears ABOVE the Output section in DOM order
  // ==========================================================================

  it('Test 9: SummarySection appears ABOVE the Output section in DOM order', async () => {
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockFetchSummary)).toHaveBeenCalled();
    });
    const summarySection = screen.getByTestId('summary-section');
    // Output section is identified by its 'Output' h3 heading.
    const outputHeading = Array.from(document.querySelectorAll('h3')).find((h) =>
      /^Output$/.test(h.textContent ?? ''),
    );
    expect(outputHeading).toBeTruthy();
    // SummarySection must precede Output heading in DOCUMENT_POSITION order.
    const position = summarySection.compareDocumentPosition(outputHeading!);
    // Node.DOCUMENT_POSITION_FOLLOWING === 4 — Output follows SummarySection.
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // ==========================================================================
  // First-use disclosure — gated by localStorage
  // ==========================================================================

  it('Test 10: localStorage key absent → showFirstUseDisclosure=true → SummarySection renders the muted note', async () => {
    // Clean key — disclosure should appear.
    localStorage.removeItem(SUMMARY_FIRST_USE_LOCALSTORAGE_KEY);
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      const note = screen.getByTestId('first-use-disclosure');
      expect(note.textContent).toBe('AI summary uses your prompt text');
    });
  });

  it('Test 11: localStorage key="true" → showFirstUseDisclosure=false → muted note NOT rendered', async () => {
    localStorage.setItem(SUMMARY_FIRST_USE_LOCALSTORAGE_KEY, 'true');
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockFetchSummary)).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('first-use-disclosure')).toBeNull();
  });

  // ==========================================================================
  // Auto-ack — clicking Regenerate writes localStorage AND hides disclosure
  // ==========================================================================

  it('Test 12: clicking Regenerate writes localStorage AND hides the first-use disclosure', async () => {
    localStorage.removeItem(SUMMARY_FIRST_USE_LOCALSTORAGE_KEY);
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('first-use-disclosure')).toBeTruthy();
    });
    await waitFor(() => {
      const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    btn.click();

    await waitFor(() => {
      expect(localStorage.getItem(SUMMARY_FIRST_USE_LOCALSTORAGE_KEY)).toBe('true');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('first-use-disclosure')).toBeNull();
    });
  });

  // ==========================================================================
  // Defensive — localStorage throws (privacy mode)
  // ==========================================================================

  it('Test 13: defensive — localStorage throws → handleRegenerate does NOT crash; degrades gracefully', async () => {
    // Replace the polyfilled localStorage with a throwing variant for this
    // test — simulates a privacy-mode browser where setItem rejects writes.
    // Restored at the end of the test so subsequent tests see the clean
    // memory polyfill again.
    const previous = globalThis.localStorage;
    const throwingStorage: Storage = {
      length: 0,
      clear() {
        /* noop */
      },
      getItem() {
        return null;
      },
      key() {
        return null;
      },
      removeItem() {
        /* noop */
      },
      setItem() {
        throw new Error('privacy-mode storage denied');
      },
    };
    vi.stubGlobal('localStorage', throwingStorage);
    try {
      render(
        <VersionDrawer
          version={baseVersion}
          priorVersion={null}
          onClose={() => {}}
        />,
      );
      await waitFor(() => {
        expect(vi.mocked(mockFetchSummary)).toHaveBeenCalled();
      });
      await waitFor(() => {
        const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
      });
      const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
      // Click must not throw despite the localStorage failure — the
      // try/catch in handleRegenerate degrades the ack to in-memory only.
      expect(() => btn.click()).not.toThrow();
    } finally {
      vi.stubGlobal('localStorage', previous);
    }
  });

  // ==========================================================================
  // summarySignal mirroring — successful fetch writes to summarySignal.value
  // ==========================================================================

  it('Test 14: summarySignal mirroring — successful fetch writes to summarySignal.value', async () => {
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(summarySignal.value.has('ver_b')).toBe(true);
    });
    const got = summarySignal.value.get('ver_b');
    expect(got?.state).toBe('success');
  });

  // ==========================================================================
  // EmptyState fallback when provenance.length === 0 still works inside disclosure
  // ==========================================================================

  it('Test 15: EmptyState fallback when provenance.length === 0 still works inside the disclosure body', async () => {
    vi.mocked(mockGetProvenance).mockResolvedValue({ events: [] });
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(vi.mocked(mockGetProvenance)).toHaveBeenCalled();
    });
    const disclosure = screen.getByTestId('provenance-disclosure');
    // EmptyState renders a span/div with the message text.
    await waitFor(() => {
      expect(disclosure.textContent).toMatch(/No provenance records/);
    });
  });

  // ==========================================================================
  // Auto-fetch error path — surface to summary state
  // ==========================================================================

  it('Test 16: fetchSummary returning error envelope → summary state="error"; WarningPill renders inside SummarySection', async () => {
    vi.mocked(mockFetchSummary).mockResolvedValueOnce({
      state: 'error',
      message: 'HTTP 500',
    });
    render(
      <VersionDrawer
        version={baseVersion}
        priorVersion={null}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      const body = screen.getByTestId('summary-body');
      expect(body.textContent).toMatch(/AI summary unavailable; please retry/);
    });
    expect(screen.getByTestId('warning-pill')).toBeTruthy();
  });
});
