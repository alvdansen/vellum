// packages/dashboard/src/lib/api.ts
//
// Typed fetch wrappers for the 18 dashboard REST routes served by the
// server-side dashboard-routes module (Plan 05-04). Same-origin (empty BASE)
// — the static handler and the API live on the same Node process in prod,
// and Vite proxies /api -> http://127.0.0.1:3000 in dev (D-WEBUI-13).
//
// Architecture-purity invariant (D-WEBUI-31): this file performs zero
// server-tree relative-import traversals. Only imports: the dashboard-local
// type barrel under ../types/* and dashboard-local sort utilities under ./sort*.
//
// Phase 18 / Plan 18-05 Task 1 — fetchVersions migrates to a paginated
// response envelope (PaginatedVersionsResponse) and gains optional ?sort= +
// ?cursor= query params. fetchProjects / fetchSequences / fetchShots gain
// optional ?sort= for the hierarchy tree's first-fetch lockstep with the
// client-side compareTreeNodes re-sort.

import type {
  Workspace,
  Project,
  Sequence,
  Shot,
  Version,
} from '../types/entities.js';
import type { VersionSort, HierarchySort } from './sortTypes.js';
import { serializeSortValue } from './sortHelpers.js';
// Phase 21 / Plan 21-02 — D-13 wire shape for fetchShotGrid. The dashboard's
// ShotGridView calls fetchShotGrid(seqId, { cursor, limit }) on mount and on
// LoadMoreButton click; the engine builds thumbnail_url server-side so this
// module never assembles URL strings.
import type { ShotGridResponse } from '../types/shot-grid.js';

/** Same-origin base. No hardcoded host; Vite dev server proxies to the API. */
const BASE = '';

/**
 * Typed error thrown by `fetchJson` when the server returns a non-2xx response.
 * SC-3 (Phase 6 gap_closure WR-05): preserves the typed error envelope the
 * server emits via `typedErrorHandler` (src/http/error-middleware.ts) so UI
 * consumers can `instanceof DashboardApiError` and switch on `err.code`.
 *
 * Analog: src/engine/errors.ts TypedError (server-side typed error). Diverges
 * by typing `code` as `string` (the dashboard accepts any code the server
 * emits, including future codes the dashboard's enum does not yet know about),
 * adding `status: number` (HTTP status — 4xx/5xx), and adding `body?: unknown`
 * (the parsed envelope verbatim, useful for debugging).
 */
export class DashboardApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'DashboardApiError';
  }
}

/**
 * Fetch JSON from the dashboard API surface; throw `DashboardApiError` on
 * non-2xx with the typed envelope preserved when the server emitted one.
 *
 * Behavior matrix (SC-3 / 06-RESEARCH.md):
 *   - 2xx: parse and return as T.
 *   - non-2xx + JSON body matching `{ error: { code, message } }`:
 *       throw DashboardApiError(error.code, error.message, status, body)
 *   - non-2xx + non-JSON body (HTML 502 from a proxy, empty body, etc.):
 *       throw DashboardApiError('HTTP_ERROR', `HTTP <status>: <text>`, status)
 *
 * The try/catch around `res.json()` (06-RESEARCH.md §Pitfall 3) prevents a
 * SyntaxError from masking the original HTTP failure — without it, an HTML
 * 502 response would surface as an unhandled JSON parse error in the UI
 * instead of a typed DashboardApiError.
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    let body: unknown;
    let code = 'HTTP_ERROR';
    let message = `HTTP ${res.status}${res.statusText ? `: ${res.statusText}` : ''}`;
    try {
      body = await res.json();
      const envelope = body as { error?: { code?: string; message?: string } };
      if (envelope?.error?.code) code = envelope.error.code;
      if (envelope?.error?.message) message = envelope.error.message;
    } catch {
      // Body is not JSON (HTML 502 from a proxy, empty body, malformed JSON).
      // Fall through with the default 'HTTP_ERROR' code + status-derived message.
    }
    throw new DashboardApiError(code, message, res.status, body);
  }
  return (await res.json()) as T;
}

/** Build a query string from a plain object; undefined values are skipped. */
function qs(params?: Record<string, unknown>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.set(k, String(v));
  return `?${sp.toString()}`;
}

// ================================================================
// Hierarchy reads (1-8)
// ================================================================

/** 1. GET /api/workspaces */
export function fetchWorkspaces(): Promise<Workspace[]> {
  return fetchJson<Workspace[]>('/api/workspaces');
}

/** 2. GET /api/workspaces/:id */
export function fetchWorkspace(id: string): Promise<Workspace> {
  return fetchJson<Workspace>(`/api/workspaces/${encodeURIComponent(id)}`);
}

/**
 * 3. GET /api/workspaces/:id/projects?sort=field:dir
 *
 * Phase 18 / Plan 18-05 Task 1 — optional `sort` parameter (omitted →
 * server-side default `name:asc` per src/store/sort.ts; Plan 18-03 wires
 * the `?sort=` Zod whitelist parser at the HTTP boundary).
 */
export function fetchProjects(
  workspaceId: string,
  sort?: HierarchySort,
): Promise<Project[]> {
  const query = sort ? qs({ sort: serializeSortValue(sort) }) : '';
  return fetchJson<Project[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/projects${query}`,
  );
}

/** 4. GET /api/projects/:id */
export function fetchProject(id: string): Promise<Project> {
  return fetchJson<Project>(`/api/projects/${encodeURIComponent(id)}`);
}

/**
 * 5. GET /api/projects/:id/sequences?sort=field:dir
 *
 * Phase 18 / Plan 18-05 Task 1 — symmetric with fetchProjects (see header).
 */
export function fetchSequences(
  projectId: string,
  sort?: HierarchySort,
): Promise<Sequence[]> {
  const query = sort ? qs({ sort: serializeSortValue(sort) }) : '';
  return fetchJson<Sequence[]>(
    `/api/projects/${encodeURIComponent(projectId)}/sequences${query}`,
  );
}

/** 6. GET /api/sequences/:id */
export function fetchSequence(id: string): Promise<Sequence> {
  return fetchJson<Sequence>(`/api/sequences/${encodeURIComponent(id)}`);
}

/**
 * 7. GET /api/sequences/:id/shots?sort=field:dir
 *
 * Phase 18 / Plan 18-05 Task 1 — symmetric with fetchProjects (see header).
 */
export function fetchShots(
  sequenceId: string,
  sort?: HierarchySort,
): Promise<Shot[]> {
  const query = sort ? qs({ sort: serializeSortValue(sort) }) : '';
  return fetchJson<Shot[]>(
    `/api/sequences/${encodeURIComponent(sequenceId)}/shots${query}`,
  );
}

/** 8. GET /api/shots/:id */
export function fetchShot(id: string): Promise<Shot> {
  return fetchJson<Shot>(`/api/shots/${encodeURIComponent(id)}`);
}

// ================================================================
// Version reads (9-13)
// ================================================================

/**
 * Parameters for GET /api/shots/:id/versions.
 *
 * Phase 18 / Plan 18-05 Task 1 — gains `sort` (VersionSort, serialized to
 * `?sort=field:dir` via serializeSortValue) + `cursor` (opaque base64url
 * string from a previous response's `next_cursor`). The pre-Phase-18
 * `offset` parameter is DROPPED — the server route now uses cursor
 * pagination per SORT-05 + D-22 (Plan 18-03 HTTP layer).
 */
export interface FetchVersionsParams {
  /** Phase 18 SORT-02 — version-grid sort. When omitted, server defaults to Latest. */
  sort?: VersionSort;
  /** Phase 18 SORT-05 — opaque cursor from a previous response's next_cursor; null/undefined = page 1. */
  cursor?: string | null;
  /** Page size. Default 20 per CLAUDE.md "Paginate all list queries" + D-18. */
  limit?: number;
  include_tags?: boolean;
  include_metadata?: boolean;
}

/**
 * Phase 18 / Plan 18-05 Task 1 — Response shape for GET /api/shots/:id/versions.
 *
 * The pre-Phase-18 route returned a bare `Version[]`; the new route returns
 * an envelope with cursor pagination + total_count. HomeView derives
 * `has_more` from `next_cursor !== null` rather than a server-emitted flag
 * (D-22 + UI-SPEC §"Sort Strip — pagination").
 */
export interface PaginatedVersionsResponse {
  items: Version[];
  /** Opaque base64url cursor for the next page. null when no more pages. */
  next_cursor: string | null;
  /** Total row count for the shot (cursor-independent). */
  total_count: number;
}

/**
 * 9. GET /api/shots/:id/versions?sort=&cursor=&limit=&include_tags=&include_metadata=
 *
 * Phase 18 / Plan 18-05 Task 1 — migrated to PaginatedVersionsResponse return
 * shape. Server contract (Plan 18-03):
 *   - Omitted `?sort=` → defaults to `completed_at:desc` with NULL pin to top
 *   - Omitted `?cursor=` → page 1 (no pagination state)
 *   - Malformed `?sort=` or `?cursor=` → 400 INVALID_INPUT envelope
 *     (DashboardApiError with code='INVALID_INPUT')
 *
 * `cursor: null` is intentionally collapsed to undefined here so qs() omits
 * the param from the URL (server treats missing-cursor as page 1).
 */
export function fetchVersions(
  shotId: string,
  params?: FetchVersionsParams,
): Promise<PaginatedVersionsResponse> {
  const queryParams: Record<string, unknown> = {
    sort: params?.sort ? serializeSortValue(params.sort) : undefined,
    // null collapses to undefined → qs() skips it
    cursor: params?.cursor ?? undefined,
    limit: params?.limit,
    include_tags: params?.include_tags,
    include_metadata: params?.include_metadata,
  };
  return fetchJson<PaginatedVersionsResponse>(
    `/api/shots/${encodeURIComponent(shotId)}/versions${qs(queryParams)}`,
  );
}

/** 10. GET /api/versions/:id */
export function fetchVersion(id: string): Promise<Version> {
  // The server envelopes the response as `{ entity: Version, breadcrumb }`.
  // First real consumer (VersionDrawerHost, Plan 21-06) infinite-looped on
  // `v.id === undefined`; envelope unwrap restores the declared type.
  return fetchJson<{ entity: Version; breadcrumb?: unknown }>(
    `/api/versions/${encodeURIComponent(id)}`,
  ).then((r) => r.entity);
}

/** 11. GET /api/versions/:id/provenance */
export function getProvenance(versionId: string): Promise<unknown> {
  return fetchJson<unknown>(
    `/api/versions/${encodeURIComponent(versionId)}/provenance`,
  );
}

/** 12. GET /api/versions/:id/diff?against=<other> */
export function diffVersion(versionId: string, against: string): Promise<unknown> {
  return fetchJson<unknown>(
    `/api/versions/${encodeURIComponent(versionId)}/diff?against=${encodeURIComponent(against)}`,
  );
}

/**
 * 13. Returns the URL string for the version's rendered output.
 * Does NOT fetch — callers pass the returned string directly to `<img src=...>`
 * or similar. Intentional URL helper per plan (D-WEBUI-26).
 */
export function getOutputUrl(versionId: string): string {
  return `${BASE}/api/versions/${encodeURIComponent(versionId)}/output`;
}

/**
 * Phase 17 / Plan 17-04 — returns the URL string for the version's
 * thumbnail. Does NOT fetch — callers pass the returned string directly
 * to <img src=...>.
 *
 * Server route: GET /api/versions/:id/thumbnail (Phase 17 Plan 17-03).
 * Returns ≤640×360 WebP cached on disk; supports If-None-Match conditional
 * GET (304 fast path); 503 + THUMBNAIL_FAILED envelope on derivation failure.
 *
 * Mirrors getOutputUrl shape verbatim (encodeURIComponent on path segment +
 * same-origin BASE = ''). Pure function — composes a string and returns it.
 *
 * The optional `filename` parameter is reserved for future multi-output
 * versions; v1.2 ships single-thumbnail-per-version, so the server resolves
 * the primary output's filename internally via outputs_json[0].filename.
 * v1.3 may use the filename query parameter when a single version surfaces
 * multiple outputs (e.g., one image + one mask).
 */
export function getThumbnailUrl(versionId: string, filename?: string): string {
  const base = `${BASE}/api/versions/${encodeURIComponent(versionId)}/thumbnail`;
  return filename ? `${base}?filename=${encodeURIComponent(filename)}` : base;
}

// ================================================================
// Phase 14 Plan 04 Task 2 — C2PA signing-status surfacing
// ================================================================

/**
 * Discriminated union returned by `getC2paStatus`. The C2paBadge component
 * pattern-matches on `status` to render the badge text + color.
 *
 *   - signed   — manifest_signed event has signed=true
 *   - unsigned — signed=false (with a reason string from the engine enum)
 *   - unknown  — no event recorded yet, or network/parse error (defence in
 *                depth: never throws; the badge always renders SOMETHING)
 */
export type C2paStatus =
  | { status: 'signed' }
  | { status: 'unsigned'; reason: string }
  | { status: 'unknown' };

/**
 * Phase 14 Plan 04 — fetch the C2PA signing status for a version's primary
 * output by issuing a HEAD request to /api/versions/:id/output and reading
 * the X-C2PA-Signing-Status response header. The HEAD is lightweight (no
 * body transfer); the engine NEVER signs at request time so this is a pure
 * read of the latest manifest_signed event.
 *
 * Header value mapping (from src/http/dashboard-routes.ts Plan 14-04 Task 1):
 *   - 'signed'                                 -> { status: 'signed' }
 *   - 'unsigned:<reason>'                      -> { status: 'unsigned', reason }
 *   - 'unknown' OR missing OR fetch-throw      -> { status: 'unknown' }
 *
 * Defence in depth: the helper never throws — network errors, missing
 * headers, and malformed values all collapse to { status: 'unknown' } so the
 * C2paBadge always has something to render.
 */
export async function getC2paStatus(versionId: string): Promise<C2paStatus> {
  try {
    const res = await fetch(
      `${BASE}/api/versions/${encodeURIComponent(versionId)}/output`,
      { method: 'HEAD' },
    );
    const header = res.headers.get('X-C2PA-Signing-Status');
    if (!header) return { status: 'unknown' };
    if (header === 'signed') return { status: 'signed' };
    if (header === 'unknown') return { status: 'unknown' };
    if (header.startsWith('unsigned:')) {
      const reason = header.slice('unsigned:'.length);
      // Empty reason after 'unsigned:' is a malformed header — degrade to
      // 'unsigned' with empty reason (the C2paBadge sanitizes/translates
      // unknown reasons via its translation map + character-class filter).
      return { status: 'unsigned', reason };
    }
    return { status: 'unknown' };
  } catch {
    // Network error / CORS / aborted — never throw to the caller.
    return { status: 'unknown' };
  }
}

// ================================================================
// Version mutations (14)
// ================================================================

/** Shape returned by POST /api/versions/:id/reproduce (per CONTEXT.md route catalog). */
export interface ReproduceVersionResponse {
  version_id: string;
  status: string;
  breadcrumb: unknown;
  breadcrumb_text: string;
}

/** 14. POST /api/versions/:id/reproduce (empty body). */
export function reproduceVersion(id: string): Promise<ReproduceVersionResponse> {
  return fetchJson<ReproduceVersionResponse>(
    `/api/versions/${encodeURIComponent(id)}/reproduce`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
}

// ================================================================
// Phase 19 Plan 19-05 Task 2 — AI conversational summary helpers
// ================================================================

/**
 * Discriminated response shape returned by getSummary + regenerateSummary.
 * Mirrors the Plan 19-05 SummaryState contract exposed through state/summaries.ts
 * (UI-SPEC SummarySection contract).
 *
 * NOTE: 'success' merges 'live' + 'cache_hit' SummaryOutcome variants — the
 * dashboard UI does NOT distinguish them visually (per UI-SPEC "discriminated
 * state union" decision). The server-side telemetry/log layer keeps the
 * distinction; the dashboard treats both as "ready to render prose".
 *
 * Defence in depth (Phase 14 getC2paStatus precedent at lines 332-354): any
 * network error / parse failure / unexpected envelope shape collapses to
 * { state: 'error' } so the caller never has to handle thrown exceptions.
 */
export type SummaryFetchResponse =
  | {
      state: 'success';
      text: string;
      source: 'live' | 'cache_hit';
      generated_at: string;
      template_version: string;
      model_id: string;
      regenerateAvailableAtMs: number | null;
    }
  | {
      state: 'fallback';
      text: string;
      source: 'fallback';
      reason?: string;
      regenerateAvailableAtMs: number | null;
    }
  | { state: 'error'; message?: string };

/**
 * GET /api/versions/:id/summary.
 *
 * Maps the server's SummaryOutcome envelope (cache_hit | live | fallback)
 * augmented with regenerate_available_at_ms into the dashboard's
 * SummaryFetchResponse. Defensive — collapses network errors / parse errors
 * / unexpected source values to { state: 'error' } per Phase 14 getC2paStatus
 * precedent.
 *
 * NEVER throws to the caller — the dashboard signal layer relies on this
 * contract to keep the discriminated state union total.
 */
export async function getSummary(versionId: string): Promise<SummaryFetchResponse> {
  try {
    const res = await fetch(
      `${BASE}/api/versions/${encodeURIComponent(versionId)}/summary`,
    );
    if (!res.ok) {
      return { state: 'error', message: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return mapSummaryEnvelope(data);
  } catch (err) {
    return {
      state: 'error',
      message: err instanceof Error ? err.message : 'unknown',
    };
  }
}

/**
 * POST /api/versions/:id/summary/regenerate.
 *
 * Forces a fresh LLM call (server bypasses cache lookup at engine step 2 when
 * options.regenerate=true). Returns the same SummaryFetchResponse shape.
 *
 * Defensive: a 429 throttle response collapses to { state: 'error' } and the
 * caller's previously-rendered summary stays visible (the 60s cooldown
 * countdown handles the visual feedback). NEVER throws.
 */
export async function regenerateSummary(
  versionId: string,
): Promise<SummaryFetchResponse> {
  try {
    const res = await fetch(
      `${BASE}/api/versions/${encodeURIComponent(versionId)}/summary/regenerate`,
      { method: 'POST' },
    );
    if (!res.ok) {
      // 429 throttle, 5xx server error, etc. — surface as error envelope.
      // The dashboard countdown timer continues to use the
      // regenerate_available_at_ms from the previous successful fetch.
      return { state: 'error', message: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return mapSummaryEnvelope(data);
  } catch (err) {
    return {
      state: 'error',
      message: err instanceof Error ? err.message : 'unknown',
    };
  }
}

/**
 * Map the server's SummaryOutcome envelope shape (with regenerate_available_at_ms
 * augmentation from Plan 19-05 routes) into the dashboard's
 * SummaryFetchResponse shape. Tolerates malformed responses by collapsing to
 * { state: 'error', message: ... } — defensive parsing per the Phase 14
 * getC2paStatus precedent.
 */
function mapSummaryEnvelope(data: unknown): SummaryFetchResponse {
  if (typeof data !== 'object' || data === null) {
    return { state: 'error', message: 'malformed response' };
  }
  const envelope = data as Record<string, unknown>;
  const source = envelope.source;
  const text = typeof envelope.text === 'string' ? envelope.text : '';
  const regenerateAvailableAtMs =
    typeof envelope.regenerate_available_at_ms === 'number'
      ? envelope.regenerate_available_at_ms
      : null;

  if (source === 'cache_hit' || source === 'live') {
    return {
      state: 'success',
      text,
      source,
      generated_at:
        typeof envelope.generated_at === 'string' ? envelope.generated_at : '',
      template_version:
        typeof envelope.template_version === 'string'
          ? envelope.template_version
          : '',
      model_id:
        typeof envelope.model_id === 'string' ? envelope.model_id : '',
      regenerateAvailableAtMs,
    };
  }
  if (source === 'fallback') {
    return {
      state: 'fallback',
      text,
      source: 'fallback',
      reason: typeof envelope.reason === 'string' ? envelope.reason : undefined,
      regenerateAvailableAtMs,
    };
  }
  return { state: 'error', message: 'unexpected source' };
}

// ================================================================
// Asset queries (15-17)
// ================================================================

/** Generic paginated response shape for the three /api/assets/* POST endpoints. */
export interface PaginatedResponse<T> {
  items: T[];
  total_count: number;
  limit: number;
  offset: number;
}

/** A single tag-count row from POST /api/assets/list_tags. */
export interface TagCount {
  name: string;
  count: number;
}

/** Body+response for POST /api/assets/query (body mirrors asset.query input). */
export function queryAssets<T = unknown>(
  body: unknown,
): Promise<PaginatedResponse<T>> {
  return fetchJson<PaginatedResponse<T>>('/api/assets/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

/** POST /api/assets/list_tags (body mirrors asset.list_tags input). */
export function listTags(body: unknown): Promise<PaginatedResponse<TagCount>> {
  return fetchJson<PaginatedResponse<TagCount>>('/api/assets/list_tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

/** POST /api/assets/list_metadata_keys (same paginated {items:[{name,count}]} shape). */
export function listMetadataKeys(
  body: unknown,
): Promise<PaginatedResponse<TagCount>> {
  return fetchJson<PaginatedResponse<TagCount>>('/api/assets/list_metadata_keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

// ================================================================
// Dashboard home (18)
// ================================================================

/** Response shape for GET /api/dashboard/home. */
export interface DashboardHome {
  active_versions: Version[];
  recent_versions: Version[];
  workspaces: Workspace[];
}

/** 18. GET /api/dashboard/home — aggregate for the home view. */
export function getDashboardHome(): Promise<DashboardHome> {
  return fetchJson<DashboardHome>('/api/dashboard/home');
}

// ===== Phase 21 — shot grid fetch =====

/**
 * Parameters for GET /api/sequences/:id/shot-grid (D-13).
 *
 * Phase 21 narrows the surface deliberately (REQ-03 / D-08 / D-21 LOCKED):
 * the endpoint takes ONLY `cursor` + `limit` query params. Status filter
 * and Show-omitted gating are dashboard-side state mutations (see
 * `state/shot-grid.ts`), not server params. Sort is fixed `name ASC` for
 * Phase 21; Phase 24 POL-03 may introduce variability.
 */
export interface FetchShotGridParams {
  /** Phase 21 GRID-04 — opaque cursor from a previous response's next_cursor;
   *  null/undefined = page 1. The `?? undefined` collapse mirrors fetchVersions. */
  cursor?: string | null;
  /** Default 20 per CLAUDE.md "Paginate all list queries". */
  limit?: number;
}

/**
 * 19. GET /api/sequences/:id/shot-grid?cursor=&limit=
 *
 * Phase 21 / Plan 21-02 — denormalized shot grid surface backing
 * ShotGridView. Returns `{ sequence, shots[], next_cursor, total_count }`
 * per D-13; `latest_completed_version` is nested per row with a
 * server-built `thumbnail_url` (the dashboard never assembles URL strings).
 *
 * `cursor: null` is intentionally collapsed to undefined so qs() omits the
 * param from the URL — the server treats missing-cursor as page 1. Mirrors
 * the fetchVersions precedent at api.ts:237.
 *
 * Error envelopes (translated via fetchJson → DashboardApiError):
 *   - 400 INVALID_INPUT — malformed cursor or limit
 *   - 404 SEQUENCE_NOT_FOUND — sequenceId not in workspace
 */
export function fetchShotGrid(
  sequenceId: string,
  params?: FetchShotGridParams,
): Promise<ShotGridResponse> {
  const queryParams: Record<string, unknown> = {
    // null collapses to undefined → qs() skips it (fetchVersions:237 precedent)
    cursor: params?.cursor ?? undefined,
    limit: params?.limit,
  };
  return fetchJson<ShotGridResponse>(
    `/api/sequences/${encodeURIComponent(sequenceId)}/shot-grid${qs(queryParams)}`,
  );
}
