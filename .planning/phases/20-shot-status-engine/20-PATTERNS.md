# Phase 20: Shot Status Engine — Pattern Map

**Mapped:** 2026-05-11
**Files analyzed:** 9 production files + 3 test files
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `drizzle/0008_shot_status.sql` | migration | batch | `drizzle/0007_phase19_summary_generated_event.sql` | exact |
| `drizzle/meta/_journal.json` | config | batch | `drizzle/meta/_journal.json` (extend in place) | exact |
| `src/store/schema.ts` | model | CRUD | `src/store/schema.ts` (provenance + tags tables) | exact |
| `src/store/shot-status-repo.ts` | service | CRUD + append-only | `src/store/provenance-repo.ts` | exact |
| `src/tools/shot-tool.ts` | controller | request-response | `src/tools/shot-tool.ts` (extend in place) | exact |
| `src/engine/events.ts` | model | event-driven | `src/engine/events.ts` (extend in place) | exact |
| `src/engine/pipeline.ts` | service | request-response | `src/engine/pipeline.ts` `createShot()` facade | exact |
| `src/http/sse.ts` | middleware | event-driven | `src/http/sse.ts` (extend in place) | exact |
| `src/types/hierarchy.ts` | model | transform | `src/types/hierarchy.ts` `VersionStatus` type | exact |
| `src/store/__tests__/shot-status-repo.test.ts` | test | CRUD | `src/store/__tests__/provenance-repo.test.ts` | exact |
| `src/tools/__tests__/shot-tool-status.test.ts` | test | request-response | existing tool test pattern | role-match |
| `src/__tests__/architecture-purity.test.ts` | test | batch | `src/__tests__/architecture-purity.test.ts` (extend) | exact |

---

## Pattern Assignments

### `drizzle/0008_shot_status.sql` (migration, batch)

**Analog:** `drizzle/0007_phase19_summary_generated_event.sql`

**Header comment pattern** (lines 1-17 of 0007):
```sql
-- IDM-03: ROLLBACK NOT SUPPORTED.
--
-- Phase 19 (SUM-05) — append a nullable `summary_generated_json` column to
-- `provenance` carrying the per-event JSON payload of the new
-- 'summary_generated' event_type. Pre-Phase-19 rows read NULL here.
--
-- [invariant documentation here]
ALTER TABLE `provenance` ADD `summary_generated_json` text;
```

**Migration pattern to apply for Phase 20:**
```sql
-- IDM-03: ROLLBACK NOT SUPPORTED.
--
-- Phase 20 (STAT-01..05) — add shot status workflow:
--   1. ALTER TABLE shots ADD COLUMN status (mutable denorm for O(1) grid reads)
--   2. CREATE TABLE shot_status_events (append-only audit trail — never UPDATE/DELETE)
--   3. Four covering indexes per SUMMARY.md requirement
--
-- Dual-model invariant: shots.status is a materialized cache; shot_status_events
-- is truth. Every status change writes BOTH in a single db.transaction().
-- Append-only invariant: shot_status_events rows are NEVER updated or deleted.
-- Architecture-purity grep test enforces: grep 'UPDATE shot_status_events' = empty.
-- Pre-migration shots have zero shot_status_events rows — repo null-coalesces to 'wip'.
ALTER TABLE `shots` ADD `status` text NOT NULL DEFAULT 'wip';

CREATE TABLE `shot_status_events` (
  `id`          text PRIMARY KEY NOT NULL,
  `shot_id`     text NOT NULL REFERENCES shots(id),
  `from_status` text,
  `to_status`   text NOT NULL,
  `changed_by`  text NOT NULL DEFAULT 'user',
  `note`        text,
  `created_at`  integer NOT NULL
);

CREATE INDEX `idx_shots_status` ON `shots`(`sequence_id`, `status`);
CREATE INDEX `idx_shots_project_status` ON `shots`(`project_id`, `status`, `created_at` DESC);
CREATE INDEX `idx_shot_status_events_shot_time` ON `shot_status_events`(`shot_id`, `created_at` DESC);
CREATE INDEX `idx_shots_cursor` ON `shots`(`sequence_id`, `created_at` DESC, `id`);
```

Note: `project_id` index requires `shots` to carry a `project_id` column or be joined — verify against actual schema. If `shots` only has `sequence_id`, drop `idx_shots_project_status` and adjust.

---

### `drizzle/meta/_journal.json` (config, batch)

**Analog:** `drizzle/meta/_journal.json` (existing file)

**Entry pattern** (lines 44-50 of journal):
```json
{
  "idx": 7,
  "version": "6",
  "when": 1778000000000,
  "tag": "0007_phase19_summary_generated_event",
  "breakpoints": true
}
```

**New entry to append:**
```json
{
  "idx": 8,
  "version": "6",
  "when": <Date.now() at write time>,
  "tag": "0008_shot_status",
  "breakpoints": true
}
```

---

### `src/store/schema.ts` (model, CRUD) — EXTEND

**Analog:** `src/store/schema.ts` — provenance table definition (lines 104-143) and tags table (lines 146-163)

**Table declaration pattern** (lines 112-143, provenance):
```typescript
export const provenance = sqliteTable('provenance', {
  id: text('id').primaryKey(),
  version_id: text('version_id')
    .notNull()
    .references(() => versions.id),
  event_type: text('event_type').notNull(),
  // ... nullable payload columns ...
  timestamp: integer('timestamp').notNull(),
}, (t) => ({
  idxVersionTime: index('idx_provenance_version_time').on(t.version_id, t.timestamp),
}));
```

**Column extension pattern for `shots`** (lines 55-64, shots table + additive column approach):
```typescript
// Add to shots table definition:
status: text('status').notNull().default('wip'),
```

Note: The project uses the SCHEMA_DDL + additive migration split (Phase 1/2 pattern from schema.ts lines 187-258). The `status` column is added via migration 0008, not in SCHEMA_DDL. SCHEMA_DDL intentionally does not declare it — same pattern as `error_code`, `outputs_json`, etc.

**New `shotStatusEvents` table** — follows provenance table shape (lines 104-143):
```typescript
export const shotStatusEvents = sqliteTable('shot_status_events', {
  id: text('id').primaryKey(),
  shot_id: text('shot_id')
    .notNull()
    .references(() => shots.id),
  from_status: text('from_status'),         // null on first-ever status set
  to_status: text('to_status').notNull(),
  changed_by: text('changed_by').notNull(),
  note: text('note'),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  idxShotTime: index('idx_shot_status_events_shot_time').on(t.shot_id, t.created_at),
}));
```

---

### `src/store/shot-status-repo.ts` (service, CRUD + append-only) — NEW

**Analog:** `src/store/provenance-repo.ts`

**File header pattern** (lines 1-14 of provenance-repo.ts):
```typescript
import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { provenance } from './schema.js';
import type { ... } from '../types/...js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';

type Db = BetterSQLite3Database<typeof schema>;
```

**Append-only class header comment pattern** (lines 52-59):
```typescript
/**
 * Append-only shot status event store (STAT-02, STAT-03).
 *
 * Structural invariant: this class has NO update/delete methods. That is
 * the enforcement of the append-only rule — the architecture-purity test
 * asserts `UPDATE shot_status_events` does not appear in this file.
 * Do not add update/delete. Events form an ordered audit log; states are
 * separate rows, never mutations.
 */
```

**`db.transaction()` pattern** — from `src/store/version-repo.ts` lines 92-130 (two operations in one transaction):
```typescript
return this.db.transaction((tx) => {
  const maxRow = tx
    .select({ m: sql<number>`COALESCE(MAX(...), 0)` })
    .from(versions)
    ...
  // second write within same transaction
  tx.insert(versions).values(row).run();
  return row;
});
```

**Applied to `insertStatusEvent`:**
```typescript
export function insertStatusEvent(
  db: Db,
  shotId: string,
  fromStatus: ShotStatus | null,
  toStatus: ShotStatus,
  changedBy: string,
  note?: string,
): ShotStatusEvent {
  const id = newId('sse');   // 'sse' prefix — add to IdPrefix union in utils/id.ts
  const now = Date.now();
  const row: ShotStatusEvent = {
    id,
    shot_id: shotId,
    from_status: fromStatus,
    to_status: toStatus,
    changed_by: changedBy,
    note: note ?? null,
    created_at: now,
  };
  db.transaction(() => {
    db.insert(shotStatusEvents).values(row).run();
    // Materialize on shots.status for O(1) grid reads
    db.update(shots).set({ status: toStatus }).where(eq(shots.id, shotId)).run();
  })();
  return row;
}
```

Note: `db.transaction(() => { ... })()` — the Drizzle/better-sqlite3 pattern requires calling the returned function. See `src/engine/assets.ts` line 494 and `src/store/metadata-repo.ts` line 217.

**`getStatusHistory()` with null-coalesce pattern** — mirrors `getLatestCompletedEvent` (provenance-repo.ts lines 154-164):
```typescript
export function getStatusHistory(
  db: Db,
  shotId: string,
  limit = 50,
): ShotStatusEvent[] {
  const rows = db
    .select()
    .from(shotStatusEvents)
    .where(eq(shotStatusEvents.shot_id, shotId))
    .orderBy(desc(shotStatusEvents.created_at))
    .limit(limit)
    .all() as ShotStatusEvent[];
  return rows;  // empty array (not null) when no history — caller handles 'wip' default
}

export function getCurrentStatus(db: Db, shotId: string): ShotStatus {
  const history = getStatusHistory(db, shotId, 1);
  return (history[0]?.to_status as ShotStatus) ?? 'wip';  // null-coalesce to 'wip'
}
```

**STALE_SHOT_DAYS constant placement** (REQUIREMENTS.md OVR-02):
```typescript
/** Named constant per REQUIREMENTS.md OVR-02. */
export const STALE_SHOT_DAYS = 14;
```

---

### `src/tools/shot-tool.ts` (controller, request-response) — EXTEND

**Analog:** `src/tools/shot-tool.ts` (full file, 129 lines)

**Imports pattern** (lines 1-15):
```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { SHOT_NAME_REGEX } from '../types/hierarchy.js';
import { toolOk, toolError } from './envelope.js';
import {
  shapeCreateOrGet,
  shapeList,
  MAX_NAME_LENGTH,
  MAX_ID_LENGTH,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from './shape.js';
```

**Discriminated union — new arm schemas** (following CreateInput/ListInput/GetInput pattern at lines 21-43):
```typescript
const SHOT_STATUS_VALUES = ['wip', 'pending-review', 'approved', 'on-hold', 'omit'] as const;
const ShotStatusEnum = z.enum(SHOT_STATUS_VALUES);

const SetStatusInput = z.object({
  action: z.literal('set_status'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
  status: ShotStatusEnum,
  changed_by: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

const GetStatusInput = z.object({
  action: z.literal('get_status'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
});

const ListStatusHistoryInput = z.object({
  action: z.literal('list_status_history'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
  limit: z.number().int().min(1).max(50).default(20),
});
```

**Discriminated union extension** (line 45-49):
```typescript
// Before:
const ShotInputSchema = z.discriminatedUnion('action', [
  CreateInput, ListInput, GetInput,
]);
// After:
const ShotInputSchema = z.discriminatedUnion('action', [
  CreateInput, ListInput, GetInput,
  SetStatusInput, GetStatusInput, ListStatusHistoryInput,
]);
```

**inputSchema enum extension** (line 76 — RT-01 raw ZodRawShape):
```typescript
// Before:
action: z.enum(['create', 'list', 'get']),
// After:
action: z.enum(['create', 'list', 'get', 'set_status', 'get_status', 'list_status_history']),
// Also add optional fields for new arms:
status: z.string().optional(),
changed_by: z.string().optional(),
note: z.string().optional(),
```

**Switch case arm pattern** (lines 87-104):
```typescript
case 'set_status':
  return toolOk(engine.setShotStatus(
    input.id,
    input.status,
    input.changed_by ?? 'user',
    input.note,
  ));
case 'get_status':
  return toolOk(engine.getShotStatus(input.id));
case 'list_status_history':
  return toolOk(engine.listShotStatusHistory(input.id, input.limit));
```

**Exhaustiveness guard** (line 98-102):
```typescript
default: {
  const _exhaustive: never = input;
  throw new TypedError('INVALID_INPUT', `Unhandled shot action: ${String(_exhaustive)}`);
}
```

**Description update** (line 69):
```typescript
// Before:
"Manage shots within a sequence. Shot names must match ^sh\\d{3,}$ (e.g. sh010, sh020). Actions: create, list, get."
// After:
"Manage shots within a sequence. Shot names must match ^sh\\d{3,}$ (e.g. sh010, sh020). Actions: create, list, get, set_status, get_status, list_status_history."
```

---

### `src/engine/events.ts` (model, event-driven) — EXTEND

**Analog:** `src/engine/events.ts` (full file, 135 lines)

**Payload interface pattern** (lines 19-25 — `VersionStatusChangedPayload`):
```typescript
/** version.status_changed — fires from markCompleted + recovery-poller transitions. */
export interface VersionStatusChangedPayload {
  version_id: string;
  shot_id: string;
  status: 'submitted' | 'running' | 'completed' | 'failed';
  breadcrumb: string;
  at: string; // ISO 8601 timestamp
}
```

**New payload interface for Phase 20:**
```typescript
/** shot.status_changed — fires from Engine.setShotStatus (STAT-04). */
export interface ShotStatusChangedPayload {
  shot_id: string;
  sequence_id: string;         // for SSE client to filter by current sequence
  from_status: string | null;  // null on first-ever status set
  to_status: string;
  changed_by: string;
  note: string | null;
  at: string; // ISO 8601 timestamp
}
```

**EngineEventMap extension** (lines 76-82):
```typescript
// Before:
export interface EngineEventMap {
  'version.status_changed': VersionStatusChangedPayload;
  'version.created': VersionCreatedPayload;
  'tag.changed': TagChangedPayload;
  'metadata.changed': MetadataChangedPayload;
  'hierarchy.created': HierarchyCreatedPayload;
}
// After — add one entry:
export interface EngineEventMap {
  'version.status_changed': VersionStatusChangedPayload;
  'version.created': VersionCreatedPayload;
  'tag.changed': TagChangedPayload;
  'metadata.changed': MetadataChangedPayload;
  'hierarchy.created': HierarchyCreatedPayload;
  'shot.status_changed': ShotStatusChangedPayload;
}
```

---

### `src/engine/pipeline.ts` (service, request-response) — EXTEND

**Analog:** `src/engine/pipeline.ts` `createShot()` facade (lines 625-641)

**Facade method pattern:**
```typescript
createShot(sequenceId: string, name: string): { entity: Shot; breadcrumb: Breadcrumb } {
  // 1. validate
  if (!SHOT_NAME_REGEX.test(name)) {
    throw new TypedError('INVALID_SHOT_FORMAT', ...);
  }
  // 2. delegate to repo
  const entity = this.repo.createShot(sequenceId, name);
  // 3. emit event
  this.events.emitEvent('hierarchy.created', {
    entity_type: 'shot',
    entity_id: entity.id,
    parent_id: sequenceId,
    at: this.nowIso(),
  });
  // 4. return with breadcrumb
  return { entity, breadcrumb: this.breadcrumb.resolve('shot', entity.id) };
}
```

**New `setShotStatus()` facade:**
```typescript
setShotStatus(
  shotId: string,
  toStatus: ShotStatus,
  changedBy: string,
  note?: string,
): { shotId: string; name: string; previousStatus: ShotStatus; newStatus: ShotStatus; eventId: string } {
  // 1. validate shot exists
  const shot = this.repo.getShot(shotId);
  if (!shot) throw new TypedError('SHOT_NOT_FOUND', `Shot '${shotId}' not found`);
  const previousStatus = shot.status ?? 'wip';   // null-coalesce
  // 2. delegate to repo (wraps UPDATE shots + INSERT shot_status_events in transaction)
  const event = insertStatusEvent(this.db, shotId, previousStatus, toStatus, changedBy, note);
  // 3. emit SSE event
  this.events.emitEvent('shot.status_changed', {
    shot_id: shotId,
    sequence_id: shot.sequence_id,
    from_status: previousStatus,
    to_status: toStatus,
    changed_by: changedBy,
    note: note ?? null,
    at: this.nowIso(),
  });
  return { shotId, name: shot.name, previousStatus, newStatus: toStatus, eventId: event.id };
}
```

**`getShotStatus()` and `listShotStatusHistory()` facades** — simpler, no event emission:
```typescript
getShotStatus(shotId: string): { shotId: string; name: string; status: ShotStatus; lastChangedAt: number | null } {
  const shot = this.repo.getShot(shotId);
  if (!shot) throw new TypedError('SHOT_NOT_FOUND', `Shot '${shotId}' not found`);
  const history = getStatusHistory(this.db, shotId, 1);
  return {
    shotId,
    name: shot.name,
    status: (shot.status as ShotStatus) ?? 'wip',
    lastChangedAt: history[0]?.created_at ?? null,
  };
}

listShotStatusHistory(shotId: string, limit: number): { shotId: string; history: ShotStatusEvent[]; total: number } {
  const shot = this.repo.getShot(shotId);
  if (!shot) throw new TypedError('SHOT_NOT_FOUND', `Shot '${shotId}' not found`);
  const history = getStatusHistory(this.db, shotId, limit);
  return { shotId, history, total: history.length };
}
```

---

### `src/http/sse.ts` (middleware, event-driven) — EXTEND

**Analog:** `src/http/sse.ts` (full file, 242 lines)

**EVENT_TYPES const extension** (lines 49-55):
```typescript
// Before:
const EVENT_TYPES = [
  'version.status_changed',
  'version.created',
  'tag.changed',
  'metadata.changed',
  'hierarchy.created',
] as const satisfies ReadonlyArray<keyof EngineEventMap>;

// After — add one entry:
const EVENT_TYPES = [
  'version.status_changed',
  'version.created',
  'tag.changed',
  'metadata.changed',
  'hierarchy.created',
  'shot.status_changed',
] as const satisfies ReadonlyArray<keyof EngineEventMap>;
```

**`toDashboardPayload()` switch case extension** (lines 96-138):

The `satisfies ReadonlyArray<keyof EngineEventMap>` constraint on EVENT_TYPES + the `never` exhaustiveness arm in `toDashboardPayload` will cause a compile error until the new case is added:

```typescript
// Import the new payload type at top of file:
import type {
  // ... existing imports ...
  ShotStatusChangedPayload,
} from '../engine/events.js';

// New case in toDashboardPayload switch:
case 'shot.status_changed': {
  const p = payload as ShotStatusChangedPayload;
  return {
    shotId: p.shot_id,
    sequenceId: p.sequence_id,
    fromStatus: p.from_status,
    toStatus: p.to_status,
    changedBy: p.changed_by,
    note: p.note ?? undefined,
  };
}
```

**void + .catch() pattern** (lines 182-191 — mandatory for every writeSSE call):
```typescript
const listener = (payload: unknown) => {
  void stream
    .writeSSE({
      data: JSON.stringify(
        toDashboardPayload(type, payload as EngineEventMap[typeof type]),
      ),
      event: type,
    })
    .catch(() => {});
};
```

---

### `src/types/hierarchy.ts` (model, transform) — EXTEND

**Analog:** `src/types/hierarchy.ts` `VersionStatus` type (lines 43-50)

**`VersionStatus` union type pattern:**
```typescript
/**
 * IAC-05: closed set of version lifecycle states (D-GEN-18 state machine).
 * Engine-level `mapState` already treats this as a closed union; narrowing
 * the type here lets callers pattern-match exhaustively and catches stale
 * string comparisons at compile time. The SQLite column stays TEXT — a
 * cast at the repo boundary preserves schema compatibility without forcing
 * a migration.
 */
export type VersionStatus = 'submitted' | 'running' | 'completed' | 'failed';
```

**New `ShotStatus` type following the same pattern:**
```typescript
/**
 * STAT-01: closed set of shot production states. Free DAG — no transition
 * guards. Supervisors can transition any → any. The SQLite column stays
 * TEXT with DEFAULT 'wip'; the SHOT_STATUSES constant is the single source
 * of truth for the valid set (grep test enforces no inline string comparisons).
 */
export const SHOT_STATUSES = ['wip', 'pending-review', 'approved', 'on-hold', 'omit'] as const;
export type ShotStatus = typeof SHOT_STATUSES[number];
```

Note: also add `status` field to the `Shot` interface (lines 35-40):
```typescript
export interface Shot {
  id: string;
  sequence_id: string;
  name: string;
  created_at: number;
  status: ShotStatus;   // added by migration 0008; default 'wip'
}
```

---

### `src/store/__tests__/shot-status-repo.test.ts` (test, CRUD)

**Analog:** `src/store/__tests__/provenance-repo.test.ts`

**Test file structure pattern** (lines 1-34):
```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { ShotStatusRepo } from '../shot-status-repo.js';  // new import

describe('ShotStatusRepo — append-only event store (STAT-02, STAT-03)', () => {
  let repo: ShotStatusRepo;
  let shotId: string;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    repo = new ShotStatusRepo(db);
    const hierarchy = new HierarchyRepo(db);
    const ws = hierarchy.createWorkspace('ws1');
    const proj = hierarchy.createProject(ws.id, 'p1');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const shot = hierarchy.createShot(seq.id, 'sh010');
    shotId = shot.id;
  });

  test('insertStatusEvent generates sse_-prefixed id + returns row', () => { ... });
  test('insertStatusEvent writes UPDATE shots.status in same transaction', () => { ... });
  test('getStatusHistory returns newest-first up to limit=50', () => { ... });
  test('getCurrentStatus null-coalesces to wip for shot with zero history', () => { ... });
  test('structural invariant: no update/delete methods on ShotStatusRepo prototype', () => {
    const proto = Object.getOwnPropertyNames(ShotStatusRepo.prototype);
    expect(proto.filter(m => /update|delete|remove|clear/i.test(m))).toHaveLength(0);
  });
});
```

---

### `src/tools/__tests__/shot-tool-status.test.ts` (test, request-response)

**Analog:** existing tool test pattern (same structure as provenance-repo test but testing tool arms via a FakeEngine)

**Test pattern:**
```typescript
import { describe, test, expect } from 'vitest';
import { registerShot } from '../shot-tool.js';
// Use FakeEngine pattern (established in src/engine/__tests__)

describe('shot tool — set_status / get_status / list_status_history arms (STAT-05)', () => {
  test('set_status arm calls engine.setShotStatus and returns toolOk', () => { ... });
  test('get_status arm calls engine.getShotStatus', () => { ... });
  test('list_status_history arm calls engine.listShotStatusHistory', () => { ... });
  test('invalid status value returns toolError INVALID_INPUT', () => { ... });
  test('tool budget remains at 7 (STAT-05)', () => {
    // Count registered tools — must stay === 7
  });
});
```

---

### `src/__tests__/architecture-purity.test.ts` (test, batch) — EXTEND

**Analog:** `src/__tests__/architecture-purity.test.ts` (full file, 918 lines)

**Append-only grep test pattern** — new test to add inside the existing `describe('architecture purity', ...)` block:

```typescript
// Phase 20 — STAT-02 append-only invariant for shot_status_events.
// shot_status_events rows are never updated or deleted.
// Mirrors provenance-repo append-only guard (D-PROV-01).
it('shot_status_events is never UPDATE-d or DELETE-d in src/store/shot-status-repo.ts', () => {
  expect(
    grepCount('UPDATE shot_status_events', 'src/store/shot-status-repo.ts'),
  ).toBe(0);
  expect(
    grepCount('DELETE.*shot_status_events', 'src/store/shot-status-repo.ts'),
  ).toBe(0);
});

// Phase 20 — file-level purity lock for shot-status-repo.ts (mirrors tag-repo.ts lock)
it('src/store/shot-status-repo.ts has zero imports from @modelcontextprotocol/sdk', () => {
  expect(grepCount('@modelcontextprotocol/sdk', 'src/store/shot-status-repo.ts')).toBe(0);
});
```

---

## Shared Patterns

### `newId()` prefix registration
**Source:** `src/utils/id.ts` line 3
**Apply to:** `src/store/shot-status-repo.ts` and `src/utils/id.ts`

The `IdPrefix` union must be extended to include the `'sse'` prefix:
```typescript
// Before:
export type IdPrefix = 'ws' | 'proj' | 'seq' | 'shot' | 'ver' | 'prov' | 'tag' | 'meta';
// After:
export type IdPrefix = 'ws' | 'proj' | 'seq' | 'shot' | 'ver' | 'prov' | 'tag' | 'meta' | 'sse';
```

### Tool-engine separation (D-33)
**Source:** `src/tools/shot-tool.ts` lines 63-129
**Apply to:** `src/tools/shot-tool.ts` new arms

Tools are thin Zod-validated delegates. Each new arm: (1) parse with `ShotInputSchema.parse(rawInput)`, (2) call exactly one `engine.*` method, (3) return `toolOk(result)` or let `toolError(err)` in the catch handle it. No DB access, no business logic in the tool layer.

### Error handling
**Source:** `src/tools/shot-tool.ts` lines 106-127
**Apply to:** `src/tools/shot-tool.ts` (inherits existing catch block — no change needed)

```typescript
} catch (err) {
  if (err instanceof z.ZodError) {
    const first = err.issues[0];
    const path = first.path.join('.');
    return toolError(new TypedError('INVALID_INPUT', `Invalid input at 'input.${path}'`));
  }
  return toolError(err);
}
```

`toolError` handles `TypedError` (e.g., `SHOT_NOT_FOUND`) generically — no new error handling code needed in the tool layer.

### `void + .catch(() => {})` for SSE writes
**Source:** `src/http/sse.ts` lines 182-191
**Apply to:** `src/http/sse.ts` (the new `shot.status_changed` listener is generated by the existing loop — no new write site needed)

The for-loop at lines 175-197 automatically handles any new event type added to `EVENT_TYPES`. The void+catch pattern is already in place for all listeners via the shared `listener` closure. No new write sites are introduced by Phase 20.

### ISO timestamp helper
**Source:** `src/engine/pipeline.ts` — `this.nowIso()` private method (used throughout pipeline)
**Apply to:** `src/engine/pipeline.ts` new facade methods

All `at:` fields in event payloads use `this.nowIso()`, not `Date.now()` or `new Date().toISOString()` directly.

---

## No Analog Found

No files in Phase 20 lack a close codebase analog. All 9 production files map exactly.

---

## Metadata

**Analog search scope:** `src/store/`, `src/tools/`, `src/engine/`, `src/http/`, `src/types/`, `src/__tests__/`, `drizzle/`
**Files scanned:** 12 source files read directly
**Pattern extraction date:** 2026-05-11
