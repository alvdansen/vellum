/**
 * api.ts approval-gate + pipeline-log helper tests.
 *
 * Covers the four proposal/pipeline-log methods added for the dashboard
 * approvals surface: fetchProposals (query serialization), approveProposal /
 * rejectProposal (URL + body shape), and fetchShotPipelineLog. Mirrors the
 * mocked-fetch style of api.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchProposals,
  approveProposal,
  rejectProposal,
  fetchShotPipelineLog,
  DashboardApiError,
} from '../lib/api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

describe('fetchProposals', () => {
  it('hits /api/proposals with no params when none supplied', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ items: [], total_count: 0, limit: 20, offset: 0 }),
    );
    const res = await fetchProposals();
    expect(fetchSpy).toHaveBeenCalledWith('/api/proposals', undefined);
    expect(res.total_count).toBe(0);
  });

  it('serializes status + limit + offset + shot_id into the query string', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ items: [], total_count: 0, limit: 5, offset: 10 }),
    );
    await fetchProposals({
      status: 'proposed',
      limit: 5,
      offset: 10,
      shot_id: 'shot_x',
    });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/proposals?');
    expect(url).toContain('status=proposed');
    expect(url).toContain('limit=5');
    expect(url).toContain('offset=10');
    expect(url).toContain('shot_id=shot_x');
  });

  it('throws DashboardApiError with typed code on a 400 status envelope', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'INVALID_INPUT', message: "Invalid status 'nope'" } },
        400,
      ),
    );
    const err = await fetchProposals({ status: 'proposed' }).catch((e) => e);
    expect(err).toBeInstanceOf(DashboardApiError);
    expect(err).toMatchObject({ code: 'INVALID_INPUT', status: 400 });
  });
});

describe('approveProposal / rejectProposal', () => {
  it('POSTs to /approve with the note in the JSON body', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ proposal: { id: 'prop_1' }, entity: {}, breadcrumb: {} }),
    );
    await approveProposal('prop_1', 'looks good');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/proposals/prop_1/approve');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ note: 'looks good' });
  });

  it('omits the note key (undefined) when no note is given on approve', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ proposal: { id: 'prop_1' }, entity: {}, breadcrumb: {} }),
    );
    await approveProposal('prop_1');
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    // note:undefined is dropped by JSON.stringify → empty object body
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('encodes the proposal id in the path', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ proposal: { id: 'a/b' } }));
    await rejectProposal('a/b', null);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe('/api/proposals/a%2Fb/reject');
  });

  it('POSTs to /reject with the note body', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ proposal: { id: 'prop_2' } }));
    await rejectProposal('prop_2', 'off-model');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/proposals/prop_2/reject');
    expect(JSON.parse(init.body as string)).toEqual({ note: 'off-model' });
  });
});

describe('fetchShotPipelineLog', () => {
  it('GETs /api/shots/:id/pipeline-log and returns the markdown envelope', async () => {
    const body = {
      markdown: '# Pipeline log\n',
      breadcrumb: [],
      breadcrumb_text: 'Demo Show / SEQ010 / SH_020',
      shot_id: 'shot_1',
      take_count: 2,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(body));
    const res = await fetchShotPipelineLog('shot_1');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/shots/shot_1/pipeline-log',
      undefined,
    );
    expect(res).toEqual(body);
  });

  it('surfaces a 404 SHOT_NOT_FOUND as a DashboardApiError', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'SHOT_NOT_FOUND', message: 'not found' } },
        404,
      ),
    );
    await expect(fetchShotPipelineLog('nope')).rejects.toMatchObject({
      code: 'SHOT_NOT_FOUND',
      status: 404,
    });
  });
});
