// packages/dashboard/src/types/shot-grid.ts
//
// Phase 21 — wire-shape types for GET /api/sequences/:id/shot-grid (D-13).
//
// Architecture-purity (D-WEBUI-31): zero imports from src/. The 5-value
// shot status union is re-derived from the canonical ShotStatusChangedPayload
// definition in ./events.js so a future-Phase status addition propagates
// here automatically (no double-duplication of the 5-state literal).
//
// Field-naming convention: snake_case for envelope-level pagination fields
// (`next_cursor`, `total_count`, `version_count`, `latest_completed_version`,
// `thumbnail_url`, `completed_at`) — mirrors PaginatedVersionsResponse at
// src/lib/api.ts:209-215 and the existing server convention. CamelCase is
// reserved for SSE wire-shape payloads (see events.ts).

import type { ShotStatusChangedPayload } from './events.js';

/**
 * The 5-value shot status union, re-derived from the canonical SSE payload
 * shape. Equivalent at the type level to `'wip' | 'pending-review' |
 * 'approved' | 'on-hold' | 'omit'` but with a single source of truth.
 */
export type ShotStatus = ShotStatusChangedPayload['toStatus'];

/**
 * Sequence metadata embedded in the ShotGridResponse — minimal pair the
 * <SequenceHeader/> component renders (id + display name). Per D-13 the
 * payload trims the full Sequence entity to the two fields the grid needs.
 */
export interface ShotGridSequenceMeta {
  id: string;
  name: string;
}

/**
 * Phase 23 — D-02 LOCKED envelope shape for whole-sequence stats. Server
 * computes via a single GROUP BY query (per OVR-01 "no N+1") and ships the
 * result as a top-level field on `ShotGridResponse`. The dashboard seeds the
 * `sequenceStats` signal from this on every `fetchShotGrid` and applies
 * incremental deltas via `onShotStatusChanged` (D-10 / D-11). Mirrors the
 * snake_case envelope convention already established at lines 11-14 for
 * `next_cursor`, `total_count`, `version_count` (Phase 21 D-13).
 *
 * Field semantics:
 *   - `total`: whole-sequence shot count — independent of grid pagination.
 *   - `approved_pct`: 0-100 integer (Math.round on the engine side per D-14).
 *   - `counts`: per-status bucket for all 5 ShotStatus values. The server
 *     repo function initializes ALL 5 keys to 0 even when SQLite's GROUP BY
 *     emits sparse rows, so consumers can read `counts[status]` without
 *     undefined-checks.
 *   - `pending_review_backlog`: equal to `counts['pending-review']` BY DESIGN
 *     (D-02). The duplicate field lets the backlog-callout component stay
 *     data-source-independent of the per-status mini-pills row below it.
 *   - `stale_count`: whole-sequence stale shots — uses the D-15 pragmatic
 *     reading (zero-completed-version shots fall out via EXISTS clause).
 */
export interface SequenceStats {
  total: number;
  approved_pct: number;
  counts: Record<ShotStatus, number>;
  pending_review_backlog: number;
  stale_count: number;
}

/**
 * A single shot row in the grid response (D-13 LOCKED payload). The
 * `latest_completed_version` nested object is `null` for shots with zero
 * completed versions (D-19 disables card click in that branch). The
 * `version_count` includes ALL versions (submitted/running/completed/failed),
 * not just completed — the count surface in the card is total.
 */
export interface ShotGridRow {
  id: string;
  name: string;
  status: ShotStatus;
  version_count: number;
  /**
   * Phase 23 — D-03 per-row staleness flag, computed server-side at grid
   * query time via the inline `is_stale` CASE column in `listShotsForGrid`.
   * Uses the `STALE_SHOT_DAYS = 14` constant and matches the D-15 grace
   * period (zero-completed-version shots are NEVER stale even if calendar-
   * older than the cutoff — the CASE's `r.completed_at IS NOT NULL` branch
   * falls out). The dashboard reads this for the initial amber-border
   * render and re-derives client-side on `shot.status_changed` SSE events.
   */
  is_stale: boolean;
  latest_completed_version: {
    id: string;
    /** Constructed server-side via /api/versions/:id/thumbnail (PATTERN 10). */
    thumbnail_url: string;
    /** Epoch ms when the latest completed version finished generating. */
    completed_at: number;
  } | null;
}

/**
 * The envelope shape returned by GET /api/sequences/:id/shot-grid (D-13).
 * `shots[]` is the paginated buffer; `next_cursor` is the opaque base64url
 * cursor (null when no more pages); `total_count` is cursor-independent
 * (same value on every page of the walk).
 */
export interface ShotGridResponse {
  sequence: ShotGridSequenceMeta;
  shots: ShotGridRow[];
  /**
   * Phase 23 — D-02 sequence-wide aggregate stats (whole-sequence, NOT the
   * paginated `shots[]` window). Server computes via a single GROUP BY +
   * EXISTS-clause stale_count; total count derives from Σ counts (no extra
   * COUNT roundtrip). Independent of pagination — every page of the cursor
   * walk carries the same stats envelope.
   */
  stats: SequenceStats;
  /** Opaque base64url cursor for the next page. null when no more pages. */
  next_cursor: string | null;
  /** Total shot count for the sequence (cursor-independent). */
  total_count: number;
}
