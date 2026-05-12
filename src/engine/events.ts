// src/engine/events.ts — typed engine EventEmitter (Plan 05-02, D-WEBUI-29).
//
// Thin typed wrapper over Node's built-in EventEmitter. Zero new dependencies.
// Exported type lets the SSE handler (Plan 05) and tests stay type-safe without
// coupling to EventEmitter internals.
//
// Architecture-purity invariants (D-WEBUI-31):
//  - Zero MCP SDK imports (enforced by architecture-purity.test.ts substring grep).
//  - Zero imports from hono or any HTTP layer.
//  - Only imports: node:events (built-in).

import { EventEmitter } from 'node:events';

// ================================================================
// Payload types (D-WEBUI-06)
// ================================================================

/** version.status_changed — fires from markCompleted + recovery-poller transitions. */
export interface VersionStatusChangedPayload {
  version_id: string;
  shot_id: string;
  status: 'submitted' | 'running' | 'completed' | 'failed';
  breadcrumb: string; // breadcrumb_text from BreadcrumbResolver (e.g., 'ws > p1 > sq010 > sh010 > v001')
  at: string; // ISO 8601 timestamp
}

/**
 * shot.status_changed — fires from Engine.setShotStatus (STAT-04).
 *
 * Carries the previous and new shot production states plus the sequence_id
 * so SSE clients can filter to the currently-displayed sequence without an
 * additional shot lookup. `from_status` is null on the first-ever status set
 * for a shot whose history is empty (shots.status materialized default 'wip'
 * has not yet been recorded as an event row). T-5-02 analogue: the optional
 * `note` is user-authored free text but is not PII at a higher trust level
 * than shot names themselves — supervisors author it for the team, and the
 * SSE stream is already gated by the same origin allowlist + auth that
 * shows shot identifiers. Included here so clients can render the audit
 * trail without re-fetching history on every event.
 */
export interface ShotStatusChangedPayload {
  shot_id: string;
  sequence_id: string;         // for SSE client to filter by current sequence
  from_status: string | null;  // null on first-ever status set
  to_status: string;
  changed_by: string;
  note: string | null;
  at: string; // ISO 8601 timestamp
}

/** version.created — fires from submitGeneration, reproduceVersion, iterateFromVersion. */
export interface VersionCreatedPayload {
  version_id: string;
  shot_id: string;
  breadcrumb: string;
  at: string;
}

/** tag.changed — fires from addTag / removeTag. */
export interface TagChangedPayload {
  action: 'add' | 'remove';
  version_id: string;
  shot_id: string;
  tag: string;
  at: string;
}

/**
 * metadata.changed — fires from setMetadata / removeMetadata.
 *
 * **T-5-02 mitigation**: the `value` field is deliberately absent. Metadata
 * values may contain sensitive or user-private data (artist name, internal
 * notes, render-farm credentials as a misuse case); SSE frames leave the
 * server process and land in every connected browser tab. Only the key + the
 * action + context ids + timestamp are safe to broadcast. Clients that want
 * the new value re-fetch the version via `GET /api/versions/:id`.
 */
export interface MetadataChangedPayload {
  action: 'set' | 'remove';
  version_id: string;
  shot_id: string;
  key: string;
  // NOTE: `value` MUST NOT be added here. T-5-02 info-disclosure guard.
  at: string;
}

/** hierarchy.created — fires from createWorkspace / createProject / createSequence / createShot. */
export interface HierarchyCreatedPayload {
  entity_type: 'workspace' | 'project' | 'sequence' | 'shot';
  entity_id: string;
  parent_id: string | null;
  at: string;
}

/**
 * Typed event map — pairs each event name with its payload type. Extending
 * this map is the single source of truth for new event types (both producers
 * via emitEvent and consumers via onEvent pick up the new pairing automatically).
 */
export interface EngineEventMap {
  'version.status_changed': VersionStatusChangedPayload;
  'version.created': VersionCreatedPayload;
  'tag.changed': TagChangedPayload;
  'metadata.changed': MetadataChangedPayload;
  'hierarchy.created': HierarchyCreatedPayload;
  'shot.status_changed': ShotStatusChangedPayload;
}

// ================================================================
// Typed emitter class
// ================================================================

/**
 * EngineEmitter — EventEmitter with generic-typed emit / on / off wrappers.
 *
 * Plain EventEmitter methods remain available (inherited) for library-level
 * interop, but the typed emitEvent / onEvent / offEvent are the intended API.
 * Structural compatibility with EventEmitter is preserved — FakeEngine.events
 * (from Plan 05-01) narrows from EventEmitter to EngineEmitter in Task 2
 * without a runtime change.
 */
export class EngineEmitter extends EventEmitter {
  /** Type-safe emit — payload type is inferred from the event type key. */
  emitEvent<T extends keyof EngineEventMap>(
    type: T,
    payload: EngineEventMap[T],
  ): boolean {
    return this.emit(type, payload);
  }

  /** Type-safe on — listener receives a correctly-typed payload. */
  onEvent<T extends keyof EngineEventMap>(
    type: T,
    listener: (payload: EngineEventMap[T]) => void,
  ): this {
    return this.on(type, listener as (...args: unknown[]) => void);
  }

  /** Type-safe off — mirror of onEvent for cleanup. */
  offEvent<T extends keyof EngineEventMap>(
    type: T,
    listener: (payload: EngineEventMap[T]) => void,
  ): this {
    return this.off(type, listener as (...args: unknown[]) => void);
  }
}

/**
 * Factory — called once in the Engine constructor. Raises maxListeners to
 * prevent Node's MaxListenersExceededWarning when many SSE clients connect to
 * the same emitter simultaneously (each client registers listeners for every
 * event type it renders). Default Node limit is 10; 100 supports a full demo
 * room without warnings while still flagging genuine listener leaks.
 */
export function createEngineEmitter(): EngineEmitter {
  const emitter = new EngineEmitter();
  emitter.setMaxListeners(100);
  return emitter;
}
