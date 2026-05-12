---
phase: 20-shot-status-engine
reviewed: 2026-05-12T00:00:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - drizzle/0008_shot_status.sql
  - drizzle/meta/_journal.json
  - src/__tests__/architecture-purity.test.ts
  - src/engine/__tests__/pipeline-shot-status.test.ts
  - src/engine/events.ts
  - src/engine/pipeline.ts
  - src/http/__tests__/sse-adapter.test.ts
  - src/http/sse.ts
  - src/store/__tests__/migrate-no-op.test.ts
  - src/store/__tests__/migrate.test.ts
  - src/store/__tests__/schema-shot-status.test.ts
  - src/store/__tests__/shot-status-repo.test.ts
  - src/store/hierarchy-repo.ts
  - src/store/schema.ts
  - src/store/shot-status-repo.ts
  - src/test-utils/fake-engine.ts
  - src/tools/__tests__/shot-tool-status.test.ts
  - src/tools/shot-tool.ts
  - src/types/__tests__/shot-status.test.ts
  - src/types/hierarchy.ts
  - src/utils/id.ts
findings:
  critical: 0
  warning: 6
  info: 7
  total: 13
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-05-12
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Phase 20 lands the Shot Status Engine across 4 plans: type contracts (Plan 01),
the append-only repo (Plan 02), the typed SSE event (Plan 03), and the
pipeline/tool/SSE wiring (Plan 04). Pattern compliance with existing analogs
(provenance-repo, hierarchy createShot facade, events.ts payload pairs) is
strong. The append-only invariant is structurally enforced both at the module
level (no update/delete exports) and the grep level (architecture-purity test).

No CRITICAL findings (no data-loss, security, or auth issues). Several WARNING
findings reflect semantic, schema-drift, and test-coverage gaps that should be
addressed before Phase 21 (Shot Grid) consumes these surfaces. INFO items are
documentation drift and minor maintainability concerns.

Most consequential issues for downstream phases:

- **WR-01**: `listShotStatusHistory.total` returns `history.length` (bounded by
  `limit`), not the true unbounded count — pagination UI consumers will see
  incorrect totals once history grows past `limit`.
- **WR-02**: Three of the four migration indexes (`idx_shots_status`,
  `idx_shots_project_status`, `idx_shots_cursor`) are declared in the migration
  SQL but missing from the Drizzle schema. Drizzle-kit regeneration would
  attempt to drop them.
- **WR-03**: `idx_shots_status` is a strict prefix of `idx_shots_project_status`
  and is fully redundant — write amplification on every `shots.status` update
  for no read benefit.
- **WR-04**: Index name `idx_shots_project_status` is misleading — the `shots`
  table has no `project_id` column; the index is on `(sequence_id, status,
  created_at DESC)`.

## Critical Issues

None.

## Warnings

### WR-01: `listShotStatusHistory.total` returns clipped count, not total available

**File:** `src/engine/pipeline.ts:781,791`

**Issue:** The facade returns `total: history.length`, where `history` is the
result of `getStatusHistory(this.db, shotId, limit)`. When the on-disk count
exceeds `limit`, `total` is clamped to `limit` — the caller has no way to know
the true count. This deviates from the rest of the codebase: `listShots`,
`listWorkspaces`, `listProjects`, `listSequences`, and `listVersionsForShot`
all return `total_count` as the unbounded COUNT(*).

The Phase 20 test enshrines this broken semantic — at
`src/engine/__tests__/pipeline-shot-status.test.ts:148-156` three status events
are inserted, the facade is called with `limit: 2`, and the test asserts
`expect(list.total).toBe(2)`. A pagination UI showing "Showing N of TOTAL"
would display "Showing 2 of 2" when there are actually 3 events.

**Fix:**

```typescript
listShotStatusHistory(
  shotId: string,
  limit: number,
): { shotId: string; history: ShotStatusEvent[]; total: number } {
  const shot = this.repo.getShot(shotId);
  if (!shot) {
    throw new TypedError('SHOT_NOT_FOUND', ...);
  }
  const history = getStatusHistory(this.db, shotId, limit);
  // Add a count query OR a `getStatusCount(db, shotId)` repo helper.
  const totalRow = this.db
    .select({ n: sql<number>`count(*)` })
    .from(shotStatusEvents)
    .where(eq(shotStatusEvents.shot_id, shotId))
    .get();
  const total = Number(totalRow?.n ?? 0);
  return { shotId, history, total };
}
```

Also update the test at `pipeline-shot-status.test.ts:155` to assert
`expect(list.total).toBe(3)` and add a separate `expect(list.history).toHaveLength(2)`
assertion.

---

### WR-02: Drizzle schema is missing 3 of 4 migration indexes

**File:** `src/store/schema.ts:55-71,209-221`

**Issue:** Migration `drizzle/0008_shot_status.sql` declares four indexes:

```sql
CREATE INDEX `idx_shots_status` ON `shots` (`sequence_id`,`status`);
CREATE INDEX `idx_shots_project_status` ON `shots` (`sequence_id`,`status`,`created_at` DESC);
CREATE INDEX `idx_shot_status_events_shot_time` ON `shot_status_events` (`shot_id`,`created_at` DESC);
CREATE INDEX `idx_shots_cursor` ON `shots` (`sequence_id`,`created_at` DESC,`id`);
```

But the Drizzle schema only declares ONE of them — `idxShotTime` on
`shotStatusEvents` (schema.ts:220). The three `shots`-table indexes are absent
from the `shots` Drizzle definition (schema.ts:55-71). Every prior phase that
added an index to a migration SQL also declared it in `schema.ts`:
- `idx_metadata_key_value` → schema.ts:188
- `idx_tags_tag` → schema.ts:169
- `idx_versions_status` → schema.ts:108
- `idx_provenance_version_time` → schema.ts:149

Phase 20 breaks this convention. Consequences:
1. Running `npx drizzle-kit generate` against the current schema would emit a
   migration that DROPs `idx_shots_status`, `idx_shots_project_status`, and
   `idx_shots_cursor` (Drizzle treats schema.ts as source of truth).
2. The `migrate.test.ts` row-count assertion passes only because the indexes
   were created when migration 0008 executed; there is no test asserting the
   indexes exist on disk.

**Fix:** Add the three `shots`-table indexes to the Drizzle `shots`
definition in `src/store/schema.ts`:

```typescript
export const shots = sqliteTable('shots', {
  // ... existing columns ...
  status: text('status').notNull().default('wip'),
}, (t) => ({
  uniqueNamePerSequence: unique().on(t.sequence_id, t.name),
  // Phase 20 additions — keep in sync with drizzle/0008_shot_status.sql.
  idxStatus: index('idx_shots_status').on(t.sequence_id, t.status),
  idxProjectStatus: index('idx_shots_project_status').on(
    t.sequence_id, t.status, t.created_at,
  ),
  idxCursor: index('idx_shots_cursor').on(
    t.sequence_id, t.created_at, t.id,
  ),
}));
```

Also extend `migrate.test.ts` to assert the four new indexes are present on
`sqlite_master` after `openDb()` — mirrors the existing
`idx_provenance_version_time` assertion at `migrate.test.ts:141-149`.

---

### WR-03: `idx_shots_status` is a redundant prefix of `idx_shots_project_status`

**File:** `drizzle/0008_shot_status.sql:25-26`

**Issue:** The two indexes are:

```sql
CREATE INDEX `idx_shots_status`         ON `shots` (`sequence_id`,`status`);
CREATE INDEX `idx_shots_project_status` ON `shots` (`sequence_id`,`status`,`created_at` DESC);
```

`idx_shots_status` is a strict prefix of `idx_shots_project_status`. SQLite's
query planner can use the longer index to satisfy any query that would have
hit the shorter one — including `WHERE sequence_id = ? AND status = ?` and
`WHERE sequence_id = ?`. The shorter index adds zero query-planner value
while incurring write amplification on every `INSERT INTO shots` and every
`UPDATE shots SET status = ?` (i.e., every single status transition).

This mirrors the DM-03 lesson already documented in `src/store/schema.ts:26-31`:

> DM-03: `idx_{projects,sequences,shots,versions}_{fk}` indexes were redundant
> with the implicit UNIQUE autoindexes whose leading column matches the FK
> (confirmed via `EXPLAIN QUERY PLAN`). Dropped from the Drizzle schema to
> stop write-amplifying every insert.

The same logic applies here.

**Fix:** Drop `idx_shots_status` from the migration. Add a follow-up migration
`drizzle/0009_drop_redundant_shots_status_idx.sql`:

```sql
-- IDM-03: ROLLBACK NOT SUPPORTED.
--
-- Phase 20 follow-up — `idx_shots_status` (sequence_id, status) is a strict
-- prefix of `idx_shots_project_status` (sequence_id, status, created_at DESC).
-- SQLite uses the longer index for both query shapes; the shorter one only
-- contributes write amplification. Mirrors the DM-03 lesson.
DROP INDEX IF EXISTS `idx_shots_status`;
```

Update `EXPECTED_MIGRATIONS` in `migrate.test.ts:14` and `migrate-no-op.test.ts:29`.

---

### WR-04: Index name `idx_shots_project_status` is misleading — table has no `project_id`

**File:** `drizzle/0008_shot_status.sql:26`

**Issue:** The index name implies it indexes on `project_id`:

```sql
CREATE INDEX `idx_shots_project_status` ON `shots` (`sequence_id`,`status`,`created_at` DESC);
```

But the `shots` table has no `project_id` column — only `sequence_id`
(schema.ts:55-71, hierarchy-repo.ts:266-276). The index leads with
`sequence_id`. The Phase 20 PATTERNS.md at
`.planning/phases/20-shot-status-engine/20-PATTERNS.md:78` even flagged this:

> Note: `project_id` index requires `shots` to carry a `project_id` column or
> be joined — verify against actual schema. If `shots` only has `sequence_id`,
> drop `idx_shots_project_status` and adjust.

The verification step never happened. The index was kept with a misleading
name.

**Fix:** Rename to reflect actual indexed columns. Combined with WR-03 (drop
the redundant `idx_shots_status`), the surviving index should be:

```sql
CREATE INDEX `idx_shots_sequence_status_time` ON `shots` (`sequence_id`,`status`,`created_at` DESC);
```

This requires a `DROP INDEX` + `CREATE INDEX` migration (SQLite has no
`ALTER INDEX ... RENAME`). If renaming is undesired due to migration
overhead, at minimum add a comment in the migration SQL explaining the name
is historical:

```sql
-- NOTE: name retained for migration stability — index columns are
-- (sequence_id, status, created_at DESC), NOT project_id.
CREATE INDEX `idx_shots_project_status` ...
```

---

### WR-05: `ShotStatusChangedPayload.from_status` is structurally `string | null` but is never null in practice

**File:** `src/engine/events.ts:32-44`, `src/engine/pipeline.ts:716,728`

**Issue:** The payload type and docstring both claim `from_status: string | null`
with the explanation:

```
* `from_status` is null on the first-ever status set for a shot whose history
* is empty (shots.status materialized default 'wip' has not yet been recorded
* as an event row).
```

But the actual implementation at `pipeline.ts:716` reads:

```typescript
const previousStatus = (shot.status as ShotStatus) ?? 'wip';
```

`shot.status` is `TEXT NOT NULL DEFAULT 'wip'` (migration 0008 line 13). It
can never be null. The `?? 'wip'` clause is dead code. Consequently
`previousStatus` is always a non-null `ShotStatus`, and the payload emitted at
`pipeline.ts:725-733` always has `from_status` populated.

The TDD anchor at `pipeline-shot-status.test.ts:79` confirms this:

```typescript
expect(payload.from_status).toBe('wip');  // not null, even on first-ever set
```

The `string | null` type forces every consumer to handle a null path that
production code never reaches.

**Fix:** Narrow the payload type and update the docstring:

```typescript
export interface ShotStatusChangedPayload {
  shot_id: string;
  sequence_id: string;
  from_status: ShotStatus;   // always populated — materialized default 'wip'
  to_status: ShotStatus;
  changed_by: string;
  note: string | null;
  at: string;
}
```

Update the docstring in `events.ts:30-40` to remove the claim about null
`from_status`. Also remove the `?? 'wip'` dead code in `pipeline.ts:716,767`.

If null `from_status` is required for some future migration scenario (e.g.,
pre-Phase-20 DBs upgrading and surfacing events without a prior status),
document the path explicitly and add a test that exercises it. As written,
the null branch is unreachable.

---

### WR-06: No dedicated unit tests for `toDashboardPayload('shot.status_changed', ...)` adapter case

**File:** `src/http/__tests__/sse-adapter.test.ts`

**Issue:** Every other `toDashboardPayload` case has a dedicated `describe`
block with explicit camelCase mapping assertions and field-omission checks:

- `version.created` — `describe` at line 18, 4 tests
- `version.status_changed` — `describe` at line 61, 5 tests
- `hierarchy.created` — `describe` at line 121, 3 tests
- `tag.changed` — `describe` at line 156, 2 tests
- `metadata.changed` — `describe` at line 180, 3 tests

But `shot.status_changed` has NO dedicated `describe` block. It appears only
inside the exhaustiveness smoke test (line 220-264) which calls the adapter
once with a single payload and asserts only `typeof out === 'object'`. There
are no assertions for:

- `fromStatus` ← `from_status` mapping
- `toStatus` ← `to_status` mapping
- `changedBy` ← `changed_by` mapping
- `note: null` coerced to `note: undefined` (the documented behaviour at
  `sse.ts:147`)
- `at` and other engine-internal fields dropped from the output
- `sequenceId` carried through (the SSE filtering use case documented in
  `events.ts:32`)

A regression in any of these mappings would pass the test suite.

**Fix:** Add a dedicated `describe` block mirroring the shape of the other
five — sample skeleton:

```typescript
describe('toDashboardPayload — shot.status_changed', () => {
  it('renames snake_case keys to camelCase', () => {
    const out = toDashboardPayload('shot.status_changed', {
      shot_id: 'shot_1',
      sequence_id: 'seq_1',
      from_status: 'wip',
      to_status: 'approved',
      changed_by: 'supervisor',
      note: 'ship it',
      at: '2026-05-12T00:00:00.000Z',
    });
    expect(out).toEqual({
      shotId: 'shot_1',
      sequenceId: 'seq_1',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'supervisor',
      note: 'ship it',
    });
  });

  it('coerces note: null to note: undefined (matches optional dashboard field)', () => {
    const out = toDashboardPayload('shot.status_changed', {
      shot_id: 'shot_1', sequence_id: 'seq_1',
      from_status: 'wip', to_status: 'on-hold',
      changed_by: 'user', note: null, at: 't',
    });
    expect((out as { note?: string }).note).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/"note"/);
  });

  it('omits at and shot_id snake_case forms from the output', () => {
    const out = toDashboardPayload('shot.status_changed', {
      shot_id: 'shot_1', sequence_id: 'seq_1',
      from_status: 'wip', to_status: 'approved',
      changed_by: 'user', note: null, at: 't',
    });
    expect(out).not.toHaveProperty('at');
    expect(out).not.toHaveProperty('shot_id');
    expect(out).not.toHaveProperty('from_status');
  });
});
```

## Info

### IN-01: Dashboard `EngineEventMap` does not declare `shot.status_changed`

**File:** `packages/dashboard/src/types/events.ts:61-67`

**Issue:** The dashboard's contract still only declares 5 event types:

```typescript
export type EngineEventMap = {
  'version.status_changed': VersionStatusChangedPayload;
  'version.created': VersionCreatedPayload;
  'tag.changed': TagChangedPayload;
  'metadata.changed': MetadataChangedPayload;
  'hierarchy.created': HierarchyCreatedPayload;
};
```

The server now emits `shot.status_changed`, but the dashboard's typed event map
omits it. `.planning/phases/20-shot-status-engine/20-03-SUMMARY.md` line 140
explicitly defers this to Plan 21 ("to be added in the grid plan"). This is
intentional and acknowledged. Documenting here as awareness for the next phase.

**Fix:** No action required in Phase 20 — Phase 21 should add the
`ShotStatusChangedPayload` interface and extend the dashboard's `EngineEventMap`
to match the SSE wire shape produced by `sse.ts:141-149`.

---

### IN-02: Stale header comment in `src/http/sse.ts` references "5 EngineEventMap payload types"

**File:** `src/http/sse.ts:4`

**Issue:** The header docstring says "Forwards the 5 EngineEventMap payload
types to every connected browser as SSE `event:`+`data:` frames." After Phase
20, there are 6 event types in the const tuple at lines 50-57 (the
`shot.status_changed` entry was added). The comment at line 48 (`adding a
seventh event type would fail the satisfies check`) was updated to anticipate
the next addition, but line 4 was missed.

**Fix:**

```typescript
// Single global stream at GET /api/events. Forwards the 6 EngineEventMap
// payload types to every connected browser as SSE `event:`+`data:` frames.
```

---

### IN-03: `getShotStatus.lastChangedAt` uses epoch-ms while sibling payload uses ISO 8601

**File:** `src/engine/pipeline.ts:749-770`

**Issue:** `getShotStatus` returns `lastChangedAt: number | null` (epoch
milliseconds — `history[0]?.created_at ?? null`). The sibling
`shot.status_changed` SSE payload uses `at: string` (ISO 8601 via
`this.nowIso()`). Other engine reads also use epoch-ms for stored timestamps
(e.g., `Shot.created_at: number`) and ISO 8601 for emitted event timestamps.

This is consistent with the project convention (stored = epoch-ms, wire =
ISO) but worth documenting in the facade docstring so consumers know which to
use for serialization.

**Fix:** Add a one-line note in the `getShotStatus` docstring at
`pipeline.ts:743-748`:

```typescript
/**
 * STAT-04 — read the current status of a shot plus the timestamp of the most
 * recent status event. `status` is null-coalesced to 'wip' so callers never
 * need to handle a null state. `lastChangedAt` is null for shots that have
 * never been transitioned. `lastChangedAt` is epoch-ms; convert with
 * `new Date(lastChangedAt).toISOString()` if you need an ISO string.
 */
```

---

### IN-04: `setShotStatus` emits `shot.status_changed` even when `from_status === to_status` (no-op transitions)

**File:** `src/engine/pipeline.ts:696-741`

**Issue:** The facade does not short-circuit when the requested `toStatus`
matches `shot.status`. A caller invoking `setShotStatus(shotId, 'wip', 'user')`
on a shot already in `'wip'` will:

1. Write a new `shot_status_events` row with `from_status === to_status`.
2. Run `UPDATE shots SET status = 'wip'` (no-op write).
3. Emit `shot.status_changed` with `from_status === to_status`.

Contrast with `getGenerationStatus` at `pipeline.ts:831` which guards on
`beforeStatus !== afterStatus` before emitting.

Whether to emit or not is a product design decision. Phase 20 SUMMARY.md
explicitly says "free DAG — no transition guards", so the current behavior is
defensible (every transition produces an audit row). But it's worth surfacing
because:

- The audit table grows with redundant rows from accidental double-clicks in
  the future Shot Grid UI.
- SSE consumers receive events that represent no state change.
- The dashboard may need to dedupe.

**Fix:** Document the intent explicitly in the facade docstring at
`pipeline.ts:687-694`:

```typescript
/**
 * STAT-04 — transition a shot to `toStatus`, emitting 'shot.status_changed'.
 *
 * NOTE: by design, every call writes a new event row AND emits an SSE
 * event, even when toStatus === current status. This matches the "free DAG,
 * no transition guards" requirement (STAT-01) and gives supervisors an
 * audit row for "re-affirmed at T". UI consumers that want to suppress
 * no-op transitions should compare to the prior status client-side.
 * ...
 */
```

If product changes its mind, add a guard before the emit:

```typescript
if (previousStatus === toStatus) {
  // No state change — return without writing or emitting.
  return { shotId, name: shot.name, previousStatus, newStatus: toStatus, eventId: '' };
}
```

---

### IN-05: Repo `insertStatusEvent` accepts any string at runtime (no `SHOT_STATUSES` validation)

**File:** `src/store/shot-status-repo.ts:69-94`

**Issue:** The function signature constrains `toStatus: ShotStatus`, but
TypeScript types are erased at runtime. The Zod enum at
`src/tools/shot-tool.ts:49` gates tool-layer callers, but a non-tool caller
(future HTTP route, future engine method, fuzz test) could pass an arbitrary
string and persist it. The DB column has no `CHECK` constraint either.

This mirrors the codebase convention — `VersionStatus` and friends rely on
the same TS-only gate. Defense-in-depth would add runtime validation at the
repo boundary:

```typescript
import { SHOT_STATUSES } from '../types/hierarchy.js';

export function insertStatusEvent(...): ShotStatusEvent {
  if (!SHOT_STATUSES.includes(toStatus)) {
    throw new Error(`insertStatusEvent: invalid toStatus '${toStatus}'`);
  }
  if (fromStatus !== null && !SHOT_STATUSES.includes(fromStatus)) {
    throw new Error(`insertStatusEvent: invalid fromStatus '${fromStatus}'`);
  }
  // ... rest unchanged ...
}
```

**Fix:** Optional — follow codebase convention (no runtime check) OR add
runtime validation as shown above. If skipping, document the intent.

---

### IN-06: Atomicity test docstring at `shot-status-repo.test.ts:158-199` contains contradictory exploration prose

**File:** `src/store/__tests__/shot-status-repo.test.ts:163-189`

**Issue:** The test docstring includes stream-of-consciousness exploration:

```typescript
// Force a transaction failure by inserting a duplicate primary key on the
// shot_status_events INSERT. We first insert a successful event so the
// generated `sse_` id exists; then attempt a second call where we pre-seed
// the same id via direct SQL — the inner INSERT will throw a UNIQUE
// constraint violation, which must roll back the accompanying UPDATE shots.
// ...
// We monkey-patch newId? No — simpler: directly INSERT a row with a known
// id, then verify a second insertStatusEvent doesn't succeed if the id
// collides (uncommon since nanoid is 21-char random — instead, we force
// failure via a different route: cause the UPDATE to fail by attempting to
// update a non-existent shot id within the transaction).
// ...
// Simulate via raw call: insertStatusEvent on a non-existent shot will
// INSERT the event row (FK to shots not enforced as deferrable here? — let's
// check). With foreign_keys=ON, the INSERT will fail because shot_id has
// FK to shots(id). That throws inside the transaction and the entire
// transaction rolls back.
```

The first paragraph describes a strategy (`duplicate primary key`) that was
abandoned. The second paragraph rambles through alternatives. The third
paragraph lands on the actual strategy (FK violation on shot_id). A reviewer
or future maintainer reading this docstring has to mentally discard the first
two paragraphs.

**Fix:** Tighten the docstring to describe only the actual test strategy:

```typescript
test('insertStatusEvent atomicity: a thrown error inside the transaction rolls back BOTH writes (STAT-02)', () => {
  // Force a transaction failure by calling insertStatusEvent with a non-
  // existent shot_id — the FK constraint on shot_status_events.shot_id
  // (REFERENCES shots(id)) raises a constraint violation on INSERT, which
  // must roll back the accompanying UPDATE shots.
  //
  // After the failed transaction, the prior legitimate shot's row and
  // history must be unchanged: no orphan event, no spurious shots.status flip.
```

---

### IN-07: `idx_shot_status_events_shot_time` declared with DESC in migration but ASC in Drizzle schema

**File:** `src/store/schema.ts:220`, `drizzle/0008_shot_status.sql:27`

**Issue:** Migration:

```sql
CREATE INDEX `idx_shot_status_events_shot_time` ON `shot_status_events` (`shot_id`,`created_at` DESC);
```

Drizzle:

```typescript
idxShotTime: index('idx_shot_status_events_shot_time').on(t.shot_id, t.created_at),
```

The Drizzle definition does not specify `desc()`. SQLite is forgiving — it
walks an ASC index in reverse when the ORDER BY is DESC — so the runtime query
performance is the same. But the schema drift means `drizzle-kit generate`
would attempt to re-create the index without DESC.

**Fix:** Match the Drizzle definition to the migration:

```typescript
import { desc } from 'drizzle-orm';

idxShotTime: index('idx_shot_status_events_shot_time').on(
  t.shot_id, desc(t.created_at),
),
```

OR remove DESC from the migration (preferred — SQLite ASC + reverse scan is
functionally equivalent and avoids the asymmetry).

---

_Reviewed: 2026-05-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
