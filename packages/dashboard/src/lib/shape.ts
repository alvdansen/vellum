// packages/dashboard/src/lib/shape.ts
//
// Small dashboard-local shape helpers shared across views. Adapts the raw
// server REST shapes (Version with `version_number` + union status) to the
// props shape the Plan 09 primitives expect (VersionCardVersion with `label`
// + StatusPill Status union).
//
// Architecture-purity invariant (D-WEBUI-31): this file performs zero
// server-tree relative-import traversals. Only imports from the dashboard-
// local type barrel under types/*.

import type { Version } from '../types/entities.js';
import type { Status } from '../components/StatusPill.js';

/**
 * Zero-padded version label from a Version's version_number (e.g. 1 → "v001").
 * Mirrors the server-side `versionLabel()` helper used by the MCP tool layer
 * — kept here inline per D-WEBUI-31 (no server import). If the entity does
 * not have a version_number we fall back to the entity id.
 */
export function versionLabel(v: Pick<Version, 'id' | 'version_number'>): string {
  if (typeof v.version_number === 'number' && Number.isFinite(v.version_number)) {
    return `v${String(v.version_number).padStart(3, '0')}`;
  }
  return v.id;
}

/**
 * Normalise the server Version status union onto the StatusPill Status
 * contract. The StatusPill only knows four members; the server union has
 * six (4 server states + 2 dashboard synonyms — see types/entities.ts).
 *
 * Mapping:
 *   queued | submitted   → queued
 *   running              → running
 *   complete | completed → complete
 *   failed               → failed
 *
 * undefined returns 'queued' (defensive default for missing-status payloads).
 *
 * SC-6 (Phase 6 gap_closure IN-04): the previous implementation ended with
 * a silent `return 'queued'` fallback. After CR-01 closure (Plan 05-13) the
 * SSE adapter at src/http/sse.ts:108 SERVER_TO_DASHBOARD_STATUS already
 * guarantees union-valid statuses on the wire — the fallback no longer
 * rescues any real defect. Replacing it with `_exhaustive: never` makes
 * future drift impossible to ignore: adding a 7th status to Version['status']
 * fails `npx tsc --noEmit` at the default arm immediately. Pattern matches
 * the established `_exhaustive: never` idiom at src/http/sse.ts:135
 * `toDashboardPayload` (RESEARCH.md §Pattern: Exhaustive Switch with never).
 */
export function normalizeStatus(raw: Version['status'] | undefined): Status {
  // Defensive: undefined is a valid input (Version.status is optional).
  if (raw === undefined) return 'queued';
  switch (raw) {
    case 'queued':
    case 'submitted':
      return 'queued';
    case 'running':
      return 'running';
    case 'complete':
    case 'completed':
      return 'complete';
    case 'failed':
      return 'failed';
    default: {
      // Exhaustiveness — adding a new state to Version['status'] fails here at
      // compile time. Pattern matches src/http/sse.ts:135 toDashboardPayload.
      const _exhaustive: never = raw;
      throw new Error(`normalizeStatus: unhandled status: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Unwrap a paginated list response from the server. The Engine's list*
 * methods return ListResult<T> = { items, total_count, limit, offset } but
 * Plan 08's api.ts is typed to return `T[]` directly (known Plan 08 shape
 * drift — see handoff notes in 05-08-SUMMARY.md). At runtime the body is
 * actually the wrapper object; we handle both shapes defensively here so a
 * follow-up plan correcting api.ts's typing (to ListResult<T>) doesn't
 * require churn through every view.
 *
 * Accepts: `T[]` (pre-unwrap) OR `{ items: T[] }` (wrapper shape). Always
 * returns a flat `T[]`.
 */
export function unwrapList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (
    raw !== null &&
    typeof raw === 'object' &&
    'items' in raw &&
    Array.isArray((raw as { items?: unknown }).items)
  ) {
    return (raw as { items: T[] }).items;
  }
  return [];
}
