/**
 * api.ts pure helper tests (Phase 17 — Plan 17-04 Task 2).
 *
 * Covers the URL-helper functions in lib/api.ts that DO NOT fetch — they
 * compose `${BASE}/api/...` URLs and return them as strings for callers to
 * pass directly to `<img src=...>` or similar.
 *
 * Phase 17 focus: getThumbnailUrl. Mirrors getOutputUrl shape exactly
 * (encodeURIComponent on the path segment + same-origin BASE = '').
 *
 * Server route (Phase 17 Plan 17-03): GET /api/versions/:id/thumbnail
 * (≤640×360 WebP cached on disk; supports If-None-Match conditional GET).
 *
 * The optional `filename` parameter is reserved for v1.3 multi-output versions;
 * v1.2 ships single-thumbnail-per-version (server resolves outputs_json[0]).
 */

import { describe, it, expect } from 'vitest';
import { getThumbnailUrl } from '../lib/api.js';

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
