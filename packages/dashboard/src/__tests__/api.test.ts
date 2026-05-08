/**
 * api.ts pure helper tests (Phase 17 — Plan 17-04 Task 2 + Phase 18 — Plan 18-05 Task 1).
 *
 * Phase 17 covers the URL-helper functions in lib/api.ts that DO NOT fetch —
 * they compose `${BASE}/api/...` URLs and return them as strings for callers
 * to pass directly to `<img src=...>` or similar.
 *
 * Phase 18 / Plan 18-05 Task 1 covers the migrated fetchVersions return shape
 * (Promise<PaginatedVersionsResponse> instead of Promise<Version[]>) plus the
 * new ?sort= and ?cursor= query-param serialization, AND the optional ?sort=
 * parameter on fetchProjects / fetchSequences / fetchShots.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getThumbnailUrl,
  fetchVersions,
  fetchProjects,
  fetchSequences,
  fetchShots,
  DashboardApiError,
} from '../lib/api.js';

describe('getThumbnailUrl (Phase 17 — Plan 17-04 Task 2)', () => {
  it("Test 1: getThumbnailUrl('ver_abc') returns '/api/versions/ver_abc/thumbnail'", () => {
    expect(getThumbnailUrl('ver_abc')).toBe('/api/versions/ver_abc/thumbnail');
  });

  it("Test 2: getThumbnailUrl('id with spaces') uses encodeURIComponent (no raw spaces)", () => {
    const url = getThumbnailUrl('id with spaces');
    // No raw space characters in the URL
    expect(url).not.toMatch(/ /);
    // Exact encoding
    expect(url).toBe('/api/versions/id%20with%20spaces/thumbnail');
  });

  it("Test 3: getThumbnailUrl('ver_abc', 'a.png') = '/api/versions/ver_abc/thumbnail?filename=a.png' (filename URL-encoded)", () => {
    expect(getThumbnailUrl('ver_abc', 'a.png')).toBe(
      '/api/versions/ver_abc/thumbnail?filename=a.png',
    );
    // Filename with special characters is URL-encoded
    expect(getThumbnailUrl('ver_abc', 'a b.png')).toBe(
      '/api/versions/ver_abc/thumbnail?filename=a%20b.png',
    );
    // Forward slashes / question marks in filename get encoded
    expect(getThumbnailUrl('ver_abc', 'sub/dir.png')).toBe(
      '/api/versions/ver_abc/thumbnail?filename=sub%2Fdir.png',
    );
  });
});

// ================================================================
// Phase 18 / Plan 18-05 Task 1 — fetchVersions paginated response +
// ?sort= / ?cursor= serialization + hierarchy fetcher sort param
// ================================================================

/** Build a 2xx Response object with a JSON body and Content-Type header. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchVersions — Plan 18-05 paginated response shape', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  it("Test 3: returns PaginatedVersionsResponse shape ({items, next_cursor, total_count})", async () => {
    const mockResponse = {
      items: [{ id: 'ver_1', shot_id: 'shot_test', version_number: 1 }],
      next_cursor: null,
      total_count: 1,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockResponse));
    const result = await fetchVersions('shot_test');
    expect(result).toEqual(mockResponse);
    expect(result.items).toHaveLength(1);
    expect(result.next_cursor).toBeNull();
    expect(result.total_count).toBe(1);
  });

  it("Test 4: serializes sort param as 'sort=field%3Adir' (URL-encoded colon)", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ items: [], next_cursor: null, total_count: 0 }),
    );
    await fetchVersions('shot_test', {
      sort: { field: 'completed_at', dir: 'desc' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('sort=completed_at%3Adesc');
  });

  it("Test 5: passes cursor through as 'cursor=opaque_string'", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ items: [], next_cursor: null, total_count: 0 }),
    );
    await fetchVersions('shot_test', { cursor: 'opaque_string' });
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('cursor=opaque_string');
  });

  it('Test 6: cursor=null is omitted from URL (qs() skips undefined/null)', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ items: [], next_cursor: null, total_count: 0 }),
    );
    await fetchVersions('shot_test', { cursor: null });
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('cursor=');
  });

  it("Test 7: no params produces a clean URL with no query string", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ items: [], next_cursor: null, total_count: 0 }),
    );
    await fetchVersions('shot_test');
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toBe('/api/shots/shot_test/versions');
  });

  it('Test 12: 4xx INVALID_INPUT envelope throws DashboardApiError with code preserved', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'INVALID_INPUT',
            message: "sort must be one of 'completed_at:asc'...",
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    let caught: unknown;
    try {
      await fetchVersions('shot_test', {
        sort: { field: 'completed_at', dir: 'desc' },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DashboardApiError);
    expect((caught as DashboardApiError).code).toBe('INVALID_INPUT');
    expect((caught as DashboardApiError).status).toBe(400);
  });
});

describe('fetchProjects / fetchSequences / fetchShots — optional sort param', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  it("Test 8: fetchProjects(workspaceId, sort) appends ?sort=field%3Aasc", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([]));
    await fetchProjects('ws_id', { field: 'name', dir: 'asc' });
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('sort=name%3Aasc');
    expect(calledUrl).toContain('/api/workspaces/ws_id/projects');
  });

  it('Test 9: fetchProjects(workspaceId) (no sort) omits ?sort= entirely', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([]));
    await fetchProjects('ws_id');
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('sort=');
    expect(calledUrl).toBe('/api/workspaces/ws_id/projects');
  });

  it("Test 10: fetchSequences(projectId, sort) appends ?sort=field%3Adir", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([]));
    await fetchSequences('proj_id', { field: 'created_at', dir: 'desc' });
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('sort=created_at%3Adesc');
    expect(calledUrl).toContain('/api/projects/proj_id/sequences');
  });

  it("Test 11: fetchShots(sequenceId, sort) appends ?sort=field%3Adir", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([]));
    await fetchShots('seq_id', { field: 'name', dir: 'desc' });
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('sort=name%3Adesc');
    expect(calledUrl).toContain('/api/sequences/seq_id/shots');
  });
});
