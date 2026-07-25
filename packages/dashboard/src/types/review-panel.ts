// packages/dashboard/src/types/review-panel.ts
//
// Phase 22 — wire-shape types for the review-and-approval surface.
//
// Consumers:
//   - PATCH /api/shots/:id/status            (SetShotStatusBody → SetShotStatusResponse)
//   - GET   /api/shots/:id/status-history    (StatusHistoryResponse)
//   - GET   /api/versions/:a/diff-with/:b    (consumed via existing DiffSummaryShape; not declared here)
//
// Architecture-purity (D-WEBUI-31): zero imports from src/. The 5-value
// shot status union is re-derived from `./shot-grid.js` (which itself
// re-derives it from the canonical ShotStatusChangedPayload SSE shape in
// `./events.js`). A future-Phase status addition propagates here
// automatically — no double-duplication of the 5-state literal.
//
// Field-naming convention: snake_case for wire-level fields (mirrors the
// engine ShotStatusEvent row at src/store/shot-status-repo.ts:38 and the
// existing shot-grid envelope convention). The exception is the engine's
// `listShotStatusHistory` return shape — the engine returns camelCase
// `shotId` at pipeline.ts:788 — so StatusHistoryResponse mirrors that one
// camelCase key verbatim (intentional, not an oversight).

import type { ShotStatus } from './shot-grid.js';
import type { Version } from './entities.js';

/**
 * Phase 22 D-04 — mirror of src/store/shot-status-repo.ts:38 ShotStatusEvent.
 *
 * Dashboard never imports from src/ (D-WEBUI-31); the type is hand-mirrored
 * here. MUST match the server's response shape from the engine's
 * `listShotStatusHistory` and the row shape stored in `shot_status_events`.
 *
 * REV-04 invariant: `note` is `null` when the caller did not provide one —
 * never the empty string. The popover submit handler converts
 * `note.trim() === ''` to `null` before sending the PATCH body.
 */
export interface ShotStatusEvent {
  id: string;
  shot_id: string;
  from_status: ShotStatus | null;
  to_status: ShotStatus;
  changed_by: string;
  note: string | null;
  created_at: number;
}

/**
 * Phase 22 D-04 — discriminated union for the unified review-panel timeline.
 *
 * The timeline merges two data sources into one chronologically-sorted feed:
 *   - Version events (from fetchVersions) — each Version contributes one or
 *     two entries: `created` always, plus `completed` when `completed_at`
 *     is non-null.
 *   - Status events (from fetchShotStatusHistory) — each ShotStatusEvent
 *     contributes one entry.
 *
 * The `kind` discriminator lets <ReviewTimeline/> branch its row renderer
 * without type assertions. `Version.completed_at` is `number | null` (engine
 * convention); a non-null value flows into the `completed` entry's `at`.
 */
export type ShotHistoryEntry =
  | {
      kind: 'version';
      version: Version;
      event: 'created' | 'completed';
      at: number;
    }
  | {
      kind: 'status';
      event: ShotStatusEvent;
    };

/**
 * Phase 22 — the 5 action verbs the review surface supports.
 *
 * - `approve` / `retake` / `hold` / `omit` map directly to a target
 *   ShotStatus transition.
 * - `restore` is the conditional fifth action — only valid when
 *   `currentStatus === 'omit'` (REV-05) — and writes the system-generated
 *   note `'Restored from omit'` (D-09).
 *
 * NOTE: this type alias is the action-bar verb vocabulary; it is NOT the
 * wire-level `to_status` value. The mapping from verb → ShotStatus lives
 * in the popover submit handler (next plan).
 */
export type ReviewAction = 'approve' | 'retake' | 'hold' | 'omit' | 'restore';

/**
 * Phase 22 D-19 — body shape sent to PATCH /api/shots/:id/status.
 *
 * Server-side Zod schema (src/http/dashboard-routes.ts, added in 22-01):
 *   { to_status: enum<SHOT_STATUSES>, note?: string|null (max 500), changed_by?: string (max 100) }
 *
 * REV-04: `note` is the user's free-text note (or `null`). The popover
 * submit handler enforces `note.trim() === '' ? null : note.trim()`
 * client-side; the server Zod re-validates at the trust boundary.
 *
 * `changed_by` defaults to `'user'` server-side when omitted; provided
 * only when a tool-call path needs to override (Phase 22 dashboard path
 * leaves it undefined).
 */
export interface SetShotStatusBody {
  to_status: ShotStatus;
  note?: string | null;
  changed_by?: string;
}

/**
 * Phase 22 D-19 — response shape from PATCH /api/shots/:id/status.
 *
 * Mirrors the existing get_status MCP arm output (and re-fetches the
 * recent history snapshot for the dashboard to refresh its timeline
 * without a second round-trip).
 *
 * `status` is the post-transition value (`result.newStatus` server-side);
 * `history` is the latest page of `shot_status_events` (newest first,
 * default limit applied server-side).
 */
export interface SetShotStatusResponse {
  status: ShotStatus;
  history: ShotStatusEvent[];
}

/**
 * Phase 22 — response shape from GET /api/shots/:id/status-history.
 *
 * Mirrors `engine.listShotStatusHistory` at src/engine/pipeline.ts:788
 * verbatim. NOTE the camelCase `shotId` — the engine returns camelCase
 * here, NOT snake_case (verified by reading pipeline.ts:798).
 * Dashboard mirrors the engine's actual return key naming; do not
 * rename to `shot_id` "for consistency".
 *
 * `total` is the count of history rows returned in `history` (bounded
 * by the engine-side limit parameter — default 50 via the client helper).
 */
export interface StatusHistoryResponse {
  shotId: string;
  history: ShotStatusEvent[];
  total: number;
}
