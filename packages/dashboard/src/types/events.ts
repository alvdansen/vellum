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

/**
 * EngineEventMap — the 5 SSE event types the dashboard listens for (D-WEBUI-06).
 * Keys are the literal `event` strings on the wire; values are the parsed JSON
 * payload shapes the dashboard renders.
 */
export type EngineEventMap = {
  'version.status_changed': VersionStatusChangedPayload;
  'version.created': VersionCreatedPayload;
  'tag.changed': TagChangedPayload;
  'metadata.changed': MetadataChangedPayload;
  'hierarchy.created': HierarchyCreatedPayload;
};
