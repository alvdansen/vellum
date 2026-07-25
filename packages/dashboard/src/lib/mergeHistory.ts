/**
 * Phase 22 / Plan 22-05 — mergeHistory pure utility.
 *
 * Merges a shot's versions and status events into a single chronologically-
 * sorted timeline (newest-first) for the ReviewPanel timeline (D-04). The
 * dashboard treats version creation, version completion, and status
 * transitions as peer events in one feed (RESEARCH Example 4).
 *
 * Emission rules:
 *  - Every Version emits a `{ kind: 'version', event: 'created', at: created_at }` row.
 *  - Every Version with `completed_at` non-null also emits a `{ event: 'completed', at: completed_at }` row.
 *  - Every ShotStatusEvent emits a `{ kind: 'status', event }` row at event.created_at.
 *
 * Sort: descending by `at` (newest first). Tiebreaker: status events win
 * (kind='status' sorts before kind='version' at the same `at`). This
 * matches D-04's "status changes are the headline; versions are auxiliary".
 *
 * Pure function: deterministic, no side effects, no I/O. Safe to call from
 * a render function (re-runs are cheap — versions/statusEvents arrays are
 * typically <100 entries per shot).
 */

import type { Version } from '../types/entities.js';
import type {
  ShotStatusEvent,
  ShotHistoryEntry,
} from '../types/review-panel.js';

/**
 * Engine wire-shape extension: PaginatedVersionsResponse.items[] carries
 * `completed_at: number | null` (epoch ms) and a numeric `created_at_ms`,
 * but the dashboard Version interface predates these fields. Treat the
 * extra fields as optional/unknown and read defensively at runtime so the
 * mergeHistory pure function stays type-safe without touching 22-02.
 */
type VersionWithTimestamps = Version & {
  completed_at?: number | null;
  created_at_ms?: number;
};

function getCreatedAtMs(v: VersionWithTimestamps): number | null {
  if (typeof v.created_at_ms === 'number') return v.created_at_ms;
  if (typeof v.created_at === 'number') return v.created_at as unknown as number;
  if (typeof v.created_at === 'string') {
    const t = Date.parse(v.created_at);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function mergeHistory(
  versions: readonly Version[],
  statusEvents: readonly ShotStatusEvent[],
): ShotHistoryEntry[] {
  const entries: ShotHistoryEntry[] = [];

  for (const v of versions as readonly VersionWithTimestamps[]) {
    const createdAt = getCreatedAtMs(v);
    if (createdAt !== null) {
      entries.push({ kind: 'version', version: v, event: 'created', at: createdAt });
    }
    if (typeof v.completed_at === 'number') {
      entries.push({ kind: 'version', version: v, event: 'completed', at: v.completed_at });
    }
  }

  for (const e of statusEvents) {
    entries.push({ kind: 'status', event: e });
  }

  entries.sort((a, b) => {
    const aAt = a.kind === 'status' ? a.event.created_at : a.at;
    const bAt = b.kind === 'status' ? b.event.created_at : b.at;
    if (bAt !== aAt) return bAt - aAt;
    // Tie-break: status events sort before version events
    if (a.kind === 'status' && b.kind === 'version') return -1;
    if (a.kind === 'version' && b.kind === 'status') return 1;
    return 0;
  });

  return entries;
}
