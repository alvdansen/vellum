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
 * Normalise the server Version status union (submitted/running/completed/
 * failed + dashboard-side queued/complete synonyms) onto the StatusPill
 * Status contract (queued/running/complete/failed). The StatusPill only
 * knows those four — any other value would miss the STATUS_STYLES map and
 * render without color. The mapping is:
 *   submitted → queued   (pre-running)
 *   completed → complete (dashboard terminology)
 *   everything already in StatusPill's union → passthrough
 *   anything else → queued (defensive fallback — never unstyled)
 */
export function normalizeStatus(raw: Version['status'] | undefined): Status {
  if (raw === 'running' || raw === 'queued' || raw === 'failed') return raw;
  if (raw === 'complete' || raw === 'completed') return 'complete';
  if (raw === 'submitted') return 'queued';
  return 'queued';
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
