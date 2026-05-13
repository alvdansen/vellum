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
  /** Opaque base64url cursor for the next page. null when no more pages. */
  next_cursor: string | null;
  /** Total shot count for the sequence (cursor-independent). */
  total_count: number;
}
