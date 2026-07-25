// packages/dashboard/src/types/proposals.ts
//
// Wire-shape types for the approval-gate surface (no silent credit spend).
// The server exposes three routes backed by the ProposalRepo
// (src/store/proposal-repo.ts) + Engine proposal methods:
//   - GET  /api/proposals?shot_id=&status=&limit=&offset=
//   - POST /api/proposals/:id/approve   (body { note? })
//   - POST /api/proposals/:id/reject    (body { note? })
//
// Architecture-purity (D-WEBUI-31): zero imports from src/. `Proposal` is a
// hand-mirror of the ProposalRepo row shape (proposal-repo.ts:22) — it MUST
// stay in lockstep with that row. `request_json` is deliberately typed as a
// raw `string` here (verbatim over the wire); the dashboard parses it at the
// render boundary via `parseProposalRequest` (state/proposals.ts) rather than
// trusting a pre-parsed shape.

import type { Version } from './entities.js';

/**
 * The three proposal kinds — mirror ProposalKind (proposal-repo.ts:19).
 *
 * - `submit`    — a fresh generation; request_json is the verbatim provider
 *                 request (a ComfyUI graph, or a URL-provider request body).
 * - `reproduce` — re-run a prior version byte-for-byte; request_json is
 *                 `{ version_id }`.
 * - `iterate`   — re-run with param overrides; request_json is
 *                 `{ version_id, overrides?, seed? }`.
 */
export type ProposalKind = 'submit' | 'reproduce' | 'iterate';

/** Proposal lifecycle states — mirror ProposalStatus (proposal-repo.ts:20). */
export type ProposalStatus = 'proposed' | 'approved' | 'rejected';

/**
 * The raw proposal row as served by GET /api/proposals (verbatim ProposalRepo
 * row). Field naming is snake_case wire convention. `request_json` is a JSON
 * STRING — parse it client-side (see parseProposalRequest); never assume it is
 * an object.
 *
 * Nullable fields track the lifecycle:
 *   - decided_at / decided_note — null until approve|reject claims the row.
 *   - version_id — set only after an approved proposal's execution created a
 *     version (the linked take).
 *   - execution_error — set when an approved proposal's execution threw
 *     (claimed but produced no version — the at-most-once window, see
 *     pipeline.ts approveProposal).
 */
export interface Proposal {
  id: string;
  shot_id: string;
  kind: ProposalKind;
  provider: string | null;
  request_json: string;
  notes: string | null;
  cost_estimate: string | null;
  status: ProposalStatus;
  created_at: number;
  decided_at: number | null;
  decided_note: string | null;
  version_id: string | null;
  execution_error: string | null;
}

/**
 * Response shape from GET /api/proposals. Mirrors Engine.listProposals
 * (pipeline.ts:1717) — the paginated envelope with the echoed limit/offset.
 */
export interface ProposalListResponse {
  items: Proposal[];
  total_count: number;
  limit: number;
  offset: number;
}

/**
 * Response shape from POST /api/proposals/:id/approve (201). Mirrors
 * Engine.approveProposal (pipeline.ts:1645): the decided proposal (now with
 * version_id linked), the created version entity, a breadcrumb, and optional
 * reproduction warnings (present for reproduce/iterate request-replay paths).
 */
export interface ApproveProposalResponse {
  proposal: Proposal;
  entity: Version;
  breadcrumb: unknown;
  reproduction_warnings?: string[];
}

/** Response shape from POST /api/proposals/:id/reject. */
export interface RejectProposalResponse {
  proposal: Proposal;
}

/**
 * The proposal-list status filter as surfaced in the ApprovalsPanel tabs.
 * `'all'` is a dashboard-only sentinel (the server omits the `status` query
 * param when 'all' is selected); the other three map 1:1 to ProposalStatus.
 */
export type ProposalStatusFilter = 'all' | ProposalStatus;
