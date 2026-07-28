/**
 * HomeView version pane — failure and race behaviour.
 *
 * Two reproduced defects pinned here:
 *  1. A page-1 fetch failure rendered "No versions yet" — a provenance tool
 *     asserting an empty history because a request failed. It must render an
 *     alert with a Retry, and never the empty-state copy.
 *  2. Clicking shot B while shot A's page-1 was in flight let A's late
 *     response overwrite B's rows, cursor and total_count (no request token;
 *     ShotGridView had the guard, HomeView didn't).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { h } from 'preact';
import { render, screen, waitFor } from '@testing-library/preact';

import { HomeView } from '../views/HomeView.js';
import { workspaces, selectedShotId } from '../state/hierarchy.js';
import {
  versions,
  selectedVersionId,
  gridCursor,
  gridTotalCount,
  gridIsFetching,
  gridLoadMoreError,
} from '../state/versions.js';

function resetSignals() {
  workspaces.value = [];
  selectedShotId.value = null;
  versions.value = [];
  selectedVersionId.value = null;
  gridCursor.value = null;
  gridTotalCount.value = 0;
  gridIsFetching.value = false;
  gridLoadMoreError.value = null;
}

afterEach(() => {
  resetSignals();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const versionsBody = (ids: string[], total: number) => ({
  items: ids.map((id, i) => ({
    id,
    version_number: i + 1,
    status: 'completed',
    completed_at: 1000 + i,
  })),
  total_count: total,
  next_cursor: null,
  limit: 20,
});

describe('HomeView version pane', () => {
  it('page-1 failure renders an alert with Retry, never "No versions yet"', async () => {
    resetSignals();
    let fail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/versions')) {
          if (fail) return Promise.resolve(new Response('boom', { status: 500 }));
          return Promise.resolve(jsonResponse(versionsBody(['ver_1'], 1)));
        }
        return Promise.resolve(jsonResponse({ items: [], total_count: 0 }));
      }),
    );

    render(h(HomeView, {}));
    selectedShotId.value = 'shot_x';

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('versions did not load');
    expect(screen.queryByText('No versions yet')).toBeNull();

    // Retry with the server healthy again loads the list.
    fail = false;
    screen.getByRole('button', { name: 'Retry' }).click();
    await waitFor(() => expect(versions.value.map((v) => v.id)).toEqual(['ver_1']));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("shot A's late response does not overwrite shot B's rows", async () => {
    resetSignals();
    let releaseA: (() => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('shot_a/versions')) {
          // Hold A's response until after B has resolved.
          return new Promise<Response>((resolve) => {
            releaseA = () => resolve(jsonResponse(versionsBody(['ver_a1', 'ver_a2'], 40)));
          });
        }
        if (url.includes('shot_b/versions')) {
          return Promise.resolve(jsonResponse(versionsBody(['ver_b1'], 1)));
        }
        return Promise.resolve(jsonResponse({ items: [], total_count: 0 }));
      }),
    );

    render(h(HomeView, {}));
    selectedShotId.value = 'shot_a';
    await waitFor(() => expect(releaseA).not.toBeNull());

    // Switch to B while A is still in flight; B resolves first.
    selectedShotId.value = 'shot_b';
    await waitFor(() => expect(versions.value.map((v) => v.id)).toEqual(['ver_b1']));

    // A's stale response lands — it must be dropped, not attributed to B.
    releaseA!();
    await new Promise((r) => setTimeout(r, 20));
    expect(versions.value.map((v) => v.id)).toEqual(['ver_b1']);
    expect(gridTotalCount.value).toBe(1);
  });
});
