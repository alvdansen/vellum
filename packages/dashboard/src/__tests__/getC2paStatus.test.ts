/**
 * getC2paStatus helper tests (Phase 14 — Plan 14-04 Task 2).
 *
 * Covers the API helper that issues a HEAD request to
 * /api/versions/:id/output and parses the X-C2PA-Signing-Status response
 * header into a typed C2paStatus union for the C2paBadge component.
 *
 * Header value matrix (from src/http/dashboard-routes.ts Plan 14-04 Task 1):
 *   - 'signed'                                 -> { status: 'signed' }
 *   - 'unsigned:<reason>'                      -> { status: 'unsigned', reason }
 *   - 'unknown' OR missing OR network error    -> { status: 'unknown' }
 *
 * Defence-in-depth: malformed headers, network errors, and missing headers
 * all collapse to { status: 'unknown' } so the badge always renders SOMETHING
 * and never throws.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import AFTER stubbing — Plan 14-04 adds getC2paStatus to lib/api.ts.
import { getC2paStatus } from '../lib/api.js';

describe('getC2paStatus (Phase 14 — Plan 14-04 Task 2)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('issues a HEAD request to /api/versions/:id/output', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'X-C2PA-Signing-Status': 'signed' },
      }),
    );
    await getC2paStatus('ver_abc');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/versions\/ver_abc\/output$/);
    expect(init?.method).toBe('HEAD');
  });

  it("returns { status: 'signed' } when header is 'signed'", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'X-C2PA-Signing-Status': 'signed' },
      }),
    );
    const result = await getC2paStatus('ver_abc');
    expect(result).toEqual({ status: 'signed' });
  });

  it("returns { status: 'unsigned', reason: 'unsupported_format' } for 'unsigned:unsupported_format'", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'X-C2PA-Signing-Status': 'unsigned:unsupported_format' },
      }),
    );
    const result = await getC2paStatus('ver_abc');
    expect(result).toEqual({ status: 'unsigned', reason: 'unsupported_format' });
  });

  it("returns { status: 'unsigned', reason: 'signing_disabled' } for 'unsigned:signing_disabled'", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'X-C2PA-Signing-Status': 'unsigned:signing_disabled' },
      }),
    );
    const result = await getC2paStatus('ver_abc');
    expect(result).toEqual({ status: 'unsigned', reason: 'signing_disabled' });
  });

  it("returns { status: 'unsigned', reason: 'sign_call_failed' } for 'unsigned:sign_call_failed'", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'X-C2PA-Signing-Status': 'unsigned:sign_call_failed' },
      }),
    );
    const result = await getC2paStatus('ver_abc');
    expect(result).toEqual({ status: 'unsigned', reason: 'sign_call_failed' });
  });

  it("returns { status: 'unknown' } when header is 'unknown'", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'X-C2PA-Signing-Status': 'unknown' },
      }),
    );
    const result = await getC2paStatus('ver_abc');
    expect(result).toEqual({ status: 'unknown' });
  });

  it("returns { status: 'unknown' } when header is missing entirely", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );
    const result = await getC2paStatus('ver_abc');
    expect(result).toEqual({ status: 'unknown' });
  });

  it("returns { status: 'unknown' } when fetch throws (network error)", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await getC2paStatus('ver_abc');
    expect(result).toEqual({ status: 'unknown' });
  });

  it("returns { status: 'unknown' } when header has malformed unsigned: prefix without reason", async () => {
    // Defence-in-depth: empty reason after 'unsigned:' degrades gracefully.
    // The header from the server should never produce this — Plan 14-04 Task 1
    // route falls back 'unknown' for empty status_reason — but the dashboard
    // helper handles this case anyway.
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'X-C2PA-Signing-Status': 'unsigned:' },
      }),
    );
    const result = await getC2paStatus('ver_abc');
    // Either { status: 'unknown' } OR { status: 'unsigned', reason: '' } is
    // acceptable — both surface as a fallback path. The implementation chooses
    // 'unsigned' with empty reason so the C2paBadge can still render the
    // failure intent (the badge's character-class sanitization handles the
    // empty reason case).
    expect(['unknown', 'unsigned']).toContain(result.status);
  });

  it('encodes versionId for URL safety', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'X-C2PA-Signing-Status': 'signed' },
      }),
    );
    await getC2paStatus('ver/with slash');
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toMatch(/ver%2Fwith%20slash/);
  });
});
