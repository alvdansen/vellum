// packages/dashboard/src/lib/api.ts
//
// Typed fetch wrappers for the 18 dashboard REST routes served by
// src/http/dashboard-routes.ts (Plan 05-04). Same-origin (empty BASE) —
// the static handler and the API live on the same Node process in prod,
// and Vite proxies /api -> http://127.0.0.1:3000 in dev (D-WEBUI-13).
//
// Architecture-purity invariant (D-WEBUI-31): zero imports from ../../../src/**.
// Only imports: the dashboard-local type barrel under ../types/*.

import type {
  Workspace,
  Project,
  Sequence,
  Shot,
  Version,
} from '../types/entities.js';

/** Same-origin base. No hardcoded host; Vite dev server proxies to the API. */
const BASE = '';

/** Small helper — fetch JSON and throw with status on !ok. */
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}${res.statusText ? `: ${res.statusText}` : ''}`);
  }
  return (await res.json()) as T;
}

/** Build a query string from a plain record; undefined values are skipped. */
function qs(params?: Record<string, string | number | boolean | undefined>): string {
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

/** 3. GET /api/workspaces/:id/projects */
export function fetchProjects(workspaceId: string): Promise<Project[]> {
  return fetchJson<Project[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/projects`,
  );
}

/** 4. GET /api/projects/:id */
export function fetchProject(id: string): Promise<Project> {
  return fetchJson<Project>(`/api/projects/${encodeURIComponent(id)}`);
}

/** 5. GET /api/projects/:id/sequences */
export function fetchSequences(projectId: string): Promise<Sequence[]> {
  return fetchJson<Sequence[]>(
    `/api/projects/${encodeURIComponent(projectId)}/sequences`,
  );
}

/** 6. GET /api/sequences/:id */
export function fetchSequence(id: string): Promise<Sequence> {
  return fetchJson<Sequence>(`/api/sequences/${encodeURIComponent(id)}`);
}

/** 7. GET /api/sequences/:id/shots */
export function fetchShots(sequenceId: string): Promise<Shot[]> {
  return fetchJson<Shot[]>(
    `/api/sequences/${encodeURIComponent(sequenceId)}/shots`,
  );
}

/** 8. GET /api/shots/:id */
export function fetchShot(id: string): Promise<Shot> {
  return fetchJson<Shot>(`/api/shots/${encodeURIComponent(id)}`);
}

// ================================================================
// Version reads (9-13)
// ================================================================

/** Parameters for GET /api/shots/:id/versions. */
export interface FetchVersionsParams {
  limit?: number;
  offset?: number;
  include_tags?: boolean;
  include_metadata?: boolean;
}

/** 9. GET /api/shots/:id/versions?limit=&offset=&include_tags=&include_metadata= */
export function fetchVersions(
  shotId: string,
  params?: FetchVersionsParams,
): Promise<Version[]> {
  return fetchJson<Version[]>(
    `/api/shots/${encodeURIComponent(shotId)}/versions${qs(params)}`,
  );
}

/** 10. GET /api/versions/:id */
export function fetchVersion(id: string): Promise<Version> {
  return fetchJson<Version>(`/api/versions/${encodeURIComponent(id)}`);
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
