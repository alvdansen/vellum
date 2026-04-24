// packages/dashboard/src/__tests__/api-error.test.ts
//
// SC-3 (gap_closure WR-05): typed-error preservation in dashboard fetchJson.
//
// Contract (from 06-RESEARCH.md §SC-3 + 06-PATTERNS.md §NEW api-error.test.ts):
//   - fetchJson<T> rethrows `DashboardApiError { code, message, status, body }`
//     when the server returns a typed `{ error: { code, message } }` envelope.
//   - For non-JSON error bodies (HTML 502 from a proxy), the function falls back
//     to a generic `DashboardApiError('HTTP_ERROR', statusText, status, undefined)`.
//   - 200 + valid JSON returns the parsed body without throwing.
//
// Wave 0: this file is committed BEFORE Plan 04 (SC-3 implementation). The
// import at line N below will fail at first because `fetchJson` and
// `DashboardApiError` are not yet exported from ../lib/api.js. Plan 04 lands
// the exports + rewrites the function body to satisfy these assertions.
//
// Analog: events.test.ts — same vi.stubGlobal-then-import idiom, different
// global (fetch instead of EventSource).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub fetch BEFORE importing the module-under-test so the module picks up
// the mock if it caches the global at module-load time. Reset per-test.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import AFTER stubbing. These two symbols must be exported from ../lib/api.js
// — Plan 04 (SC-3) adds the exports. Until then this import fails at runtime,
// which is the desired RED-state for Wave 0.
import { fetchJson, DashboardApiError } from '../lib/api.js';

describe('DashboardApiError + fetchJson typed-error preservation (SC-3)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('attaches code/status/body when server returns VERSION_NOT_FOUND envelope', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'VERSION_NOT_FOUND', message: 'Version vX not found' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    let caught: unknown;
    try {
      await fetchJson('/api/versions/vX');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DashboardApiError);
    const err = caught as DashboardApiError;
    expect(err.code).toBe('VERSION_NOT_FOUND');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Version vX not found');
    expect(err.body).toMatchObject({ error: { code: 'VERSION_NOT_FOUND', message: 'Version vX not found' } });
  });

  it('attaches code/status when server returns INVALID_INPUT (400)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'limit must be a non-negative integer' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    let caught: unknown;
    try {
      await fetchJson('/api/workspaces?limit=-1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DashboardApiError);
    expect((caught as DashboardApiError).code).toBe('INVALID_INPUT');
    expect((caught as DashboardApiError).status).toBe(400);
    expect((caught as DashboardApiError).body).toBeDefined();
  });

  it('attaches code/status when server returns OUTPUT_UNAVAILABLE (404)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'OUTPUT_UNAVAILABLE', message: 'No outputs recorded for version vX' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    let caught: unknown;
    try {
      await fetchJson('/api/versions/vX/output');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DashboardApiError);
    expect((caught as DashboardApiError).code).toBe('OUTPUT_UNAVAILABLE');
    expect((caught as DashboardApiError).status).toBe(404);
  });

  it('falls back to HTTP_ERROR for non-JSON body (HTML 502 from proxy)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('<html><body>Bad Gateway</body></html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    let caught: unknown;
    try {
      await fetchJson('/api/workspaces');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DashboardApiError);
    expect((caught as DashboardApiError).code).toBe('HTTP_ERROR');
    expect((caught as DashboardApiError).status).toBe(502);
    expect((caught as DashboardApiError).message).toContain('502');
  });

  it('falls back to HTTP_ERROR for empty body 5xx (json parse fails gracefully)', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 500 }));
    let caught: unknown;
    try {
      await fetchJson('/api/workspaces');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DashboardApiError);
    expect((caught as DashboardApiError).code).toBe('HTTP_ERROR');
    expect((caught as DashboardApiError).status).toBe(500);
  });

  it('returns parsed body on 200 (no throw)', async () => {
    const payload = { id: 'v1', status: 'completed' };
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await fetchJson<typeof payload>('/api/versions/v1');
    expect(result).toEqual(payload);
  });
});
