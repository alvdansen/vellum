/**
 * Phase 22 / Plan 22-06 — ABCompareView tests.
 *
 * Covers REV-03 parallel preload + Pitfall 7 fallback + diff fetch +
 * 3 close paths (ESC / backdrop / close button).
 *
 * Mocks:
 *  - lib/api.js: diffVersionsAB + getThumbnailUrl
 *  - HTMLImageElement.prototype.decode via vi.spyOn so the test controls
 *    whether the modern preload path resolves or falls back
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { ABCompareView } from '../ABCompareView.js';
import {
  COMPARE_MODAL_DIFF_LOADING,
  COMPARE_MODAL_DIFF_ERROR,
  COMPARE_MODAL_THUMB_LOAD_FAIL,
  COMPARE_MODAL_DIFF_EMPTY,
  COMPARE_MODAL_CLOSE_ARIA,
} from '../../lib/copy.js';

const diffVersionsABMock = vi.fn();
const getThumbnailUrlMock = vi.fn(
  (id: string, _filename?: string) => `/api/versions/${id}/thumbnail`,
);
vi.mock('../../lib/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api.js')>(
      '../../lib/api.js',
    );
  return {
    ...actual,
    diffVersionsAB: (a: string, b: string) => diffVersionsABMock(a, b),
    getThumbnailUrl: (id: string, filename?: string) =>
      getThumbnailUrlMock(id, filename),
  };
});

// Thumbnail itself dispatches getC2paStatus / version-status side effects;
// stub it for these unit tests.
vi.mock('../../components/Thumbnail.js', () => ({
  Thumbnail: ({ version }: { version: { id: string; label: string } }) => (
    <img
      data-testid="thumbnail-stub"
      data-version-id={version.id}
      alt={version.label}
    />
  ),
}));

// jsdom doesn't ship HTMLImageElement.prototype.decode — install a default
// implementation so vi.spyOn can replace it per-test.
if (typeof HTMLImageElement.prototype.decode !== 'function') {
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    value: function () {
      return Promise.resolve();
    },
    writable: true,
    configurable: true,
  });
}

let decodeSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  diffVersionsABMock.mockReset();
  // Default decode → resolve immediately (modern path)
  decodeSpy = vi
    .spyOn(HTMLImageElement.prototype, 'decode')
    .mockResolvedValue(undefined);
});

afterEach(() => {
  decodeSpy?.mockRestore();
  decodeSpy = null;
  cleanup();
});

const VA = { id: 'v-a', version_number: 1 };
const VB = { id: 'v-b', version_number: 2 };

describe('ABCompareView — dialog accessibility', () => {
  it('renders role=dialog + aria-modal=true + aria-labelledby pointing at title id', () => {
    diffVersionsABMock.mockResolvedValue({ summary: 'no changes', changes: {} });
    const { container } = render(
      <ABCompareView
        shotName="SH_010"
        versionA={VA}
        versionB={VB}
        onClose={() => {}}
      />,
    );
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const labelledById = dialog?.getAttribute('aria-labelledby');
    expect(labelledById).toBeTruthy();
    const titleEl = labelledById
      ? (container.querySelector(`#${labelledById}`) as HTMLElement | null)
      : null;
    expect(titleEl?.textContent).toContain('SH_010');
    expect(titleEl?.textContent).toContain('v1');
    expect(titleEl?.textContent).toContain('v2');
  });
});

describe('ABCompareView — preload pending → success', () => {
  it('renders 2 SkeletonThumbnail placeholders while preload pending; swaps to Thumbnails once .decode() resolves', async () => {
    diffVersionsABMock.mockResolvedValue({ summary: 'x', changes: {} });
    // .decode resolves quickly; allow microtasks to flush
    const { container } = render(
      <ABCompareView
        shotName="SH_010"
        versionA={VA}
        versionB={VB}
        onClose={() => {}}
      />,
    );
    // Initial: skeletons (presentation role)
    const skeletons = container.querySelectorAll('[role="presentation"]');
    expect(skeletons.length).toBe(2);
    // After preload resolves, Thumbnails replace skeletons
    await waitFor(() => {
      const thumbs = container.querySelectorAll('[data-testid="thumbnail-stub"]');
      expect(thumbs.length).toBe(2);
    });
  });
});

describe('ABCompareView — preload error fallback (Pitfall 7)', () => {
  it('when .decode rejects AND .onerror fires, surfaces COMPARE_MODAL_THUMB_LOAD_FAIL', async () => {
    decodeSpy?.mockRejectedValue(new Error('decode rejected'));
    // jsdom Image doesn't dispatch onerror on src assignment. Patch the
    // src setter so it queues a synthetic onerror after the .decode
    // catch path attaches the handler. Microtask delay lets the
    // preloadOne fallback's `img.onerror = ...` assignment run first.
    const origSrcDescriptor = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'src',
    );
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      set(this: HTMLImageElement, value: string) {
        origSrcDescriptor?.set?.call(this, value);
        // Queue the onerror dispatch for after the .decode catch handler
        // wires up onload/onerror on this image.
        queueMicrotask(() => {
          queueMicrotask(() => {
            this.onerror?.(new Event('error'));
          });
        });
      },
      get() {
        return origSrcDescriptor?.get?.call(this);
      },
      configurable: true,
    });
    diffVersionsABMock.mockResolvedValue({ summary: 'x', changes: {} });
    const { getByText } = render(
      <ABCompareView
        shotName="SH_010"
        versionA={VA}
        versionB={VB}
        onClose={() => {}}
      />,
    );
    try {
      await waitFor(
        () => {
          expect(getByText(COMPARE_MODAL_THUMB_LOAD_FAIL)).toBeTruthy();
        },
        { timeout: 2000 },
      );
    } finally {
      // Restore the src descriptor for the rest of the suite.
      if (origSrcDescriptor) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', origSrcDescriptor);
      }
    }
  });
});

describe('ABCompareView — diff fetch states', () => {
  it('while diffVersionsAB pending, renders COMPARE_MODAL_DIFF_LOADING', async () => {
    // Never-resolving promise to keep diff in loading state
    diffVersionsABMock.mockReturnValue(new Promise(() => {}));
    const { getByText } = render(
      <ABCompareView
        shotName="SH_010"
        versionA={VA}
        versionB={VB}
        onClose={() => {}}
      />,
    );
    expect(getByText(COMPARE_MODAL_DIFF_LOADING)).toBeTruthy();
  });

  it('when diffVersionsAB rejects, renders COMPARE_MODAL_DIFF_ERROR', async () => {
    diffVersionsABMock.mockRejectedValue(new Error('500'));
    const { getByText } = render(
      <ABCompareView
        shotName="SH_010"
        versionA={VA}
        versionB={VB}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(getByText(COMPARE_MODAL_DIFF_ERROR)).toBeTruthy(),
    );
  });

  it('when diffVersionsAB resolves with empty changes, renders COMPARE_MODAL_DIFF_EMPTY (via MetadataDiff)', async () => {
    diffVersionsABMock.mockResolvedValue({
      summary: 'no meaningful changes',
      changes: { params: [], models: [], metadata: [] },
    });
    const { getByText } = render(
      <ABCompareView
        shotName="SH_010"
        versionA={VA}
        versionB={VB}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(getByText(COMPARE_MODAL_DIFF_EMPTY)).toBeTruthy(),
    );
  });
});

describe('ABCompareView — close paths', () => {
  it('ESC keydown on document fires onClose', () => {
    diffVersionsABMock.mockResolvedValue({ summary: 'x', changes: {} });
    const onClose = vi.fn();
    render(
      <ABCompareView
        shotName="SH_010"
        versionA={VA}
        versionB={VB}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('click on backdrop (e.target === e.currentTarget) fires onClose', () => {
    diffVersionsABMock.mockResolvedValue({ summary: 'x', changes: {} });
    const onClose = vi.fn();
    const { getByTestId } = render(
      <ABCompareView
        shotName="SH_010"
        versionA={VA}
        versionB={VB}
        onClose={onClose}
      />,
    );
    const backdrop = getByTestId('ab-compare-backdrop');
    // Native click event on the backdrop element — Preact's synthetic
    // handler reads e.target/e.currentTarget; same element on a click
    // dispatch passes the guard.
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('click on close button fires onClose', () => {
    diffVersionsABMock.mockResolvedValue({ summary: 'x', changes: {} });
    const onClose = vi.fn();
    const { container } = render(
      <ABCompareView
        shotName="SH_010"
        versionA={VA}
        versionB={VB}
        onClose={onClose}
      />,
    );
    const closeBtn = container.querySelector(
      `button[aria-label="${COMPARE_MODAL_CLOSE_ARIA}"]`,
    ) as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('click INSIDE modal body (not on backdrop) does NOT fire onClose', () => {
    diffVersionsABMock.mockResolvedValue({ summary: 'x', changes: {} });
    const onClose = vi.fn();
    const { container } = render(
      <ABCompareView
        shotName="SH_010"
        versionA={VA}
        versionB={VB}
        onClose={onClose}
      />,
    );
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });
});
