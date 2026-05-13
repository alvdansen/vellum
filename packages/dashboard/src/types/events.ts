// packages/dashboard/src/types/events.ts
//
// Dashboard-local copy of the engine event map (D-WEBUI-31, architecture purity).
// Duplicated in pure TypeScript so no file under packages/dashboard/src/** imports
// from the server tree. Must stay in sync with the server-side EngineEventMap
// in spirit (the set of event names is frozen by D-WEBUI-06); the field shape
// here is the contract the dashboard renders against.
//
// T-5-02 mitigation: MetadataChangedPayload deliberately has NO `value` field.
// Metadata values may contain sensitive data; the SSE stream carries only the key
// + action + entity id. Components that need the current value re-fetch the
// version via GET /api/versions/:id.
//
// Plan 05-08 (types/events.ts). Follow-up (component plans) consume these types
// from '../types/events.js' ONLY — never via a server-tree traversal import.

/** version.status_changed — a version moved between queued/running/complete/failed. */
export interface VersionStatusChangedPayload {
  versionId: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  jobId?: string;
}

/** version.created — a new version entity was submitted (queued for generation). */
export interface VersionCreatedPayload {
  versionId: string;
  shotId: string;
  label: string;
}

/** tag.changed — a tag was created / updated / deleted on some entity. */
export interface TagChangedPayload {
  tagId: string;
  action: 'created' | 'updated' | 'deleted';
}

/**
 * metadata.changed — a metadata key changed on some entity.
 *
 * T-5-02 guard: this payload intentionally has NO `value` field. Never add one
 * without revisiting the info-disclosure threat model.
 */
export interface MetadataChangedPayload {
  entityId: string;
  key: string;
  // NOTE: no `value` field (T-5-02).
}

/** hierarchy.created — a workspace/project/sequence/shot was created. */
export interface HierarchyCreatedPayload {
  entityType: 'workspace' | 'project' | 'sequence' | 'shot';
  entityId: string;
  parentId?: string;
}

// ===== Phase 21 — shot grid SSE wire shape =====

/**
 * shot.status_changed — a shot's production status transitioned (Phase 20 STAT-04).
 * Wire shape is camelCase per src/http/sse.ts:135-148 toDashboardPayload case.
 * `note` coerces null → undefined (optional field) at the adapter; never null on the wire.
 *
 * The 5-value status union is inline-duplicated here per D-WEBUI-31 architecture-
 * purity (dashboard does NOT import from src/types/hierarchy.js). It MUST match
 * the server-side SHOT_STATUSES constant exactly; misalignment surfaces at compile
 * time in any consumer that subscribes via onSseEvent('shot.status_changed', ...).
 *
 * `fromStatus` is the 5-value union ∪ null — null occurs when the shot transitions
 * out of its default 'wip' state for the first time (no prior history row).
 * `toStatus` is the 5-value union, never null.
 */
export interface ShotStatusChangedPayload {
  shotId: string;
  sequenceId: string;
  fromStatus: 'wip' | 'pending-review' | 'approved' | 'on-hold' | 'omit' | null;
  toStatus: 'wip' | 'pending-review' | 'approved' | 'on-hold' | 'omit';
  changedBy: string;
  note?: string;
}

/**
 * EngineEventMap — the SSE event types the dashboard listens for (D-WEBUI-06).
 * Keys are the literal `event` strings on the wire; values are the parsed JSON
 * payload shapes the dashboard renders.
 *
 * Phase 21 closes the load-bearing gap: 'shot.status_changed' was emitted server-
 * side in Phase 20 (src/http/sse.ts:50-57 EVENT_TYPES tuple + :135-148 adapter)
 * but missing from the dashboard's local mirror until now.
 */
export type EngineEventMap = {
  'version.status_changed': VersionStatusChangedPayload;
  'version.created': VersionCreatedPayload;
  'tag.changed': TagChangedPayload;
  'metadata.changed': MetadataChangedPayload;
  'hierarchy.created': HierarchyCreatedPayload;
  'shot.status_changed': ShotStatusChangedPayload;
};
