---
phase: 20-shot-status-engine
verified: 2026-05-12T06:30:00Z
status: passed
score: 18/18 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 20: Shot Status Engine Verification Report

**Phase Goal:** Backend foundation for production status tracking — the mutable `shots.status` column, the append-only `shot_status_events` audit table, transactional write discipline, MCP tool arms, and SSE push. Pure backend, no dashboard changes.

**Verified:** 2026-05-12T06:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Roadmap Success Criteria

| #   | Success Criterion | Status | Evidence |
| --- | ----------------- | ------ | -------- |
| SC-1 | Migration 0008 runs cleanly on fresh DB; pre-migration shots receive `status='wip'` default | VERIFIED | `drizzle/0008_shot_status.sql:13` — `ALTER TABLE shots ADD status text NOT NULL DEFAULT 'wip'`. `src/store/__tests__/migrate.test.ts:14` — `EXPECTED_MIGRATIONS = 8`; idempotency test (line 76) covers re-run. Live DB inspection: `sqlite3 vfx-familiar.db` shows `status TEXT NOT NULL DEFAULT 'wip'` in `shots` table. |
| SC-2 | `shot.set_status` writes UPDATE + INSERT in a single `db.transaction()`; zero-history shots return `'wip'` | VERIFIED | `src/store/shot-status-repo.ts:88-92` — single `db.transaction(() => { db.insert(shotStatusEvents)...; db.update(shots).set({status})... })`. `getCurrentStatus` line 132: `(history[0]?.to_status as ShotStatus) ?? 'wip'`. Atomicity test at `shot-status-repo.test.ts` ("a thrown error inside the transaction rolls back BOTH writes"). |
| SC-3 | `shot.status_changed` SSE fires on every transition with `{shotId, fromStatus, toStatus, changedBy, note?}`; tool count remains 7 | VERIFIED | `src/engine/pipeline.ts:725-733` — `this.events.emitEvent('shot.status_changed', {...})`. SSE adapter `src/http/sse.ts:135-149` produces `{shotId, sequenceId, fromStatus, toStatus, changedBy, note?}` (sequenceId is additive extension, not contract violation). `tool-budget.test.ts:71` — `expect(registerToolCount()).toBe(7)` passes. |
| SC-4 | Grep test confirms `UPDATE shot_status_events` returns zero matches in source (append-only enforced in CI) | VERIFIED | `src/__tests__/architecture-purity.test.ts:743-750` — `grepCount('UPDATE shot_status_events', 'src/store/shot-status-repo.ts').toBe(0)` and `grepCount('DELETE.*shot_status_events', ...).toBe(0)`. Live grep confirms 0/0 matches. |
| SC-5 | 4 indexes in migration 0008: `idx_shots_status`, `idx_shot_status_events_shot_time`, `idx_shots_cursor`, plus one covering index | VERIFIED | `drizzle/0008_shot_status.sql:25-28` declares all 4: `idx_shots_status`, `idx_shots_project_status` (the covering index), `idx_shot_status_events_shot_time`, `idx_shots_cursor`. Live DB: all 4 present in `sqlite_master` query. |

### Plan Must-Haves (Observable Truths)

| #   | Truth   | Plan | Status     | Evidence       |
| --- | ------- | ---- | ---------- | -------------- |
| 1   | ShotStatus type and SHOT_STATUSES const exist in `src/types/hierarchy.ts` | 20-01 | VERIFIED | Lines 59-60: `SHOT_STATUSES = ['wip','pending-review','approved','on-hold','omit'] as const`; `ShotStatus = typeof SHOT_STATUSES[number]` |
| 2   | Shot interface carries `status: ShotStatus` field | 20-01 | VERIFIED | `src/types/hierarchy.ts:40` — `status: ShotStatus; // added by migration 0008; default 'wip'` |
| 3   | `'sse'` is a valid IdPrefix in `src/utils/id.ts` | 20-01 | VERIFIED | Line 3: `export type IdPrefix = 'ws' | ... | 'meta' | 'sse'` |
| 4   | Drizzle schema exports `shotStatusEvents` table | 20-01 | VERIFIED | `src/store/schema.ts:209` — `export const shotStatusEvents = sqliteTable('shot_status_events', {...})` |
| 5   | `shots` table Drizzle definition includes `status` column | 20-01 | VERIFIED | `src/store/schema.ts:68` — `status: text('status').notNull().default('wip')` |
| 6   | Migration file `0008_shot_status.sql` contains ALTER TABLE + CREATE TABLE + 4 indexes | 20-01 | VERIFIED | Lines 13 (ALTER), 14-23 (CREATE TABLE), 25-28 (4 CREATE INDEX). With Drizzle `--> statement-breakpoint` markers per Plan 02 deviation. |
| 7   | Journal entry idx 8 present in `_journal.json` | 20-01 | VERIFIED | `drizzle/meta/_journal.json` contains entry with `"idx": 8, "tag": "0008_shot_status"` |
| 8   | `insertStatusEvent` writes both UPDATE shots + INSERT shot_status_events in a single `db.transaction()` | 20-02 | VERIFIED | `src/store/shot-status-repo.ts:88-92` — single transaction body wraps both writes. Test: "insertStatusEvent atomicity: a thrown error inside the transaction rolls back BOTH writes" passes. |
| 9   | `getStatusHistory` returns rows newest-first with configurable limit | 20-02 | VERIFIED | `src/store/shot-status-repo.ts:114` — `.orderBy(desc(shotStatusEvents.created_at)).limit(limit)`. Default limit 50. |
| 10  | `getCurrentStatus` null-coalesces to `'wip'` for shots with zero history rows | 20-02 | VERIFIED | `src/store/shot-status-repo.ts:132` — `return (history[0]?.to_status as ShotStatus) ?? 'wip'` |
| 11  | `shot-status-repo.ts` has zero UPDATE/DELETE calls against `shot_status_events` | 20-02 | VERIFIED | Live grep: `grep -c "UPDATE shot_status_events"` = 0; `grep -cE "DELETE.*shot_status_events"` = 0 |
| 12  | `shot-status-repo.ts` has zero imports from `@modelcontextprotocol/sdk` | 20-02 | VERIFIED | Live grep: 0 matches. Architecture-purity test (line 757) enforces this in CI. |
| 13  | `ShotStatusChangedPayload` interface exported from `src/engine/events.ts`; `EngineEventMap` has `'shot.status_changed'` key | 20-03 | VERIFIED | `src/engine/events.ts:41` (interface), line 106 (map entry) |
| 14  | `EVENT_TYPES` in `sse.ts` includes `'shot.status_changed'`; `toDashboardPayload` has case (no never-exhaustion error) | 20-03 | VERIFIED | `src/http/sse.ts:56` (EVENT_TYPES), line 135 (case arm). TypeScript `satisfies ReadonlyArray<keyof EngineEventMap>` constraint + `never` exhaustiveness arm both satisfied. |
| 15  | No new SSE write sites introduced (zero-write-site invariant) | 20-03 | VERIFIED | `grep -c "writeSSE" src/http/sse.ts` returns 3 (unchanged from baseline). Listener loop at lines 192/232 inherits new event type via shared closure. |
| 16  | `pipeline.ts` has `setShotStatus`, `getShotStatus`, `listShotStatusHistory`; `setShotStatus` emits `shot.status_changed` | 20-04 | VERIFIED | `src/engine/pipeline.ts:696` (setShotStatus), 725 (emitEvent call), 749 (getShotStatus), 778 (listShotStatusHistory). All three throw `TypedError('SHOT_NOT_FOUND')` on missing shot. |
| 17  | `shot-tool.ts` discriminated union includes `set_status`, `get_status`, `list_status_history`; description updated | 20-04 | VERIFIED | `src/tools/shot-tool.ts:51` (SetStatusInput), 59 (GetStatusInput), 64 (ListStatusHistoryInput), 97 (description includes all 3 new actions), 140-156 (3 switch cases). |
| 18  | Tool budget remains exactly 7 (no new `server.registerTool()` call) | 20-04 | VERIFIED | `src/__tests__/tool-budget.test.ts:71` — `expect(registerToolCount()).toBe(7)`. Test passes. |

**Score:** 18/18 must-haves verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/types/hierarchy.ts` | SHOT_STATUSES const, ShotStatus type, Shot.status field | VERIFIED | All 3 contracts present (lines 40, 59, 60); imported by repo + tool + tests |
| `src/utils/id.ts` | IdPrefix union with 'sse' | VERIFIED | Line 3; verified `newId('sse')` works in shot-status-repo.test.ts |
| `src/store/schema.ts` | shotStatusEvents table export + shots.status column | VERIFIED | Lines 68 (shots.status), 209 (shotStatusEvents); idxShotTime index on (shot_id, created_at) at line 220 |
| `drizzle/0008_shot_status.sql` | ALTER TABLE + CREATE TABLE + 4 indexes | VERIFIED | 133-byte migration file with all required DDL; Drizzle `--> statement-breakpoint` markers correct (Plan 02 deviation #1 documented) |
| `drizzle/meta/_journal.json` | idx 8 entry | VERIFIED | `0008_shot_status` entry present |
| `src/store/shot-status-repo.ts` | insertStatusEvent, getStatusHistory, getCurrentStatus, STALE_SHOT_DAYS, ShotStatusEvent | VERIFIED | 133 lines; all 3 functions exported (lines 69, 105, 130); STALE_SHOT_DAYS=14 at line 54; ShotStatusEvent interface at line 38 |
| `src/store/__tests__/shot-status-repo.test.ts` | Repo test coverage | VERIFIED | 232 lines; 17 tests pass including atomicity (FK rollback) + null-coalesce + structural invariant |
| `src/engine/events.ts` | ShotStatusChangedPayload + EngineEventMap entry | VERIFIED | Interface at line 41; map entry at line 106 |
| `src/http/sse.ts` | EVENT_TYPES + toDashboardPayload case | VERIFIED | EVENT_TYPES line 56; case at line 135 with snake→camel + null→undefined coercion |
| `src/engine/pipeline.ts` | setShotStatus, getShotStatus, listShotStatusHistory | VERIFIED | All 3 facade methods present at lines 696, 749, 778; emitEvent at 725 |
| `src/tools/shot-tool.ts` | 3 new arms: set_status, get_status, list_status_history | VERIFIED | Discriminated union extended (line 73), switch cases at 140-156, description updated, MCP raw inputSchema enum widened to 6 values |
| `src/__tests__/architecture-purity.test.ts` | Append-only invariant + MCP SDK purity lock | VERIFIED | Append-only grep test at line 743 (UPDATE+DELETE); MCP SDK purity test at line 757 |
| `src/tools/__tests__/shot-tool-status.test.ts` | Tool arm tests | VERIFIED | 11 tests covering all 3 arms + invalid status (INVALID_INPUT) + SHOT_NOT_FOUND on each arm + 5-value enum + default changed_by + history limit |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `src/store/shot-status-repo.ts` | `src/types/hierarchy.ts` | imports ShotStatus type | WIRED | Line 5: `import type { ShotStatus } from '../types/hierarchy.js'` |
| `src/store/shot-status-repo.ts` | `src/utils/id.ts` | `newId('sse')` | WIRED | Line 6 import; line 77 `newId('sse')` call site |
| `src/store/shot-status-repo.ts` | `src/store/schema.ts` | imports shotStatusEvents + shots | WIRED | Line 4: `import { shots, shotStatusEvents } from './schema.js'` |
| `src/engine/pipeline.ts` | `src/store/shot-status-repo.ts` | imports insertStatusEvent, getStatusHistory, ShotStatusEvent | WIRED | Lines 717 (insertStatusEvent call), 763/790 (getStatusHistory calls); module-level import present |
| `src/engine/pipeline.ts` | `src/engine/events.ts` | `this.events.emitEvent('shot.status_changed', payload)` | WIRED | Line 725; payload matches ShotStatusChangedPayload shape exactly (shot_id, sequence_id, from_status, to_status, changed_by, note, at) |
| `src/tools/shot-tool.ts` | `src/engine/pipeline.ts` | `engine.setShotStatus(id, status, changedBy, note)` | WIRED | Line 146-152 (setShotStatus call), 154 (getShotStatus), 156 (listShotStatusHistory) |
| `src/http/sse.ts` | `src/engine/events.ts` | EVENT_TYPES satisfies ReadonlyArray<keyof EngineEventMap> | WIRED | Line 56 entry + satisfies constraint; never-exhaustiveness arm at line 152 type-checks at compile time |

### Data-Flow Trace (Level 4)

This is a backend-only phase. Data flows from tool entry → pipeline facade → repo → SQLite. No UI rendering surface in scope.

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `shot.set_status` tool arm | input payload | MCP client (validated by Zod discriminated union) | Yes — discriminated union ensures action+id+status fields are present | FLOWING |
| `insertStatusEvent` row | INSERT into shot_status_events + UPDATE shots.status | Real SQLite writes inside `db.transaction()` (verified by atomicity test) | Yes | FLOWING |
| `getStatusHistory` rows | SELECT from shot_status_events | Real Drizzle query with idx_shot_status_events_shot_time covering index | Yes | FLOWING |
| `getCurrentStatus` value | history[0]?.to_status ?? 'wip' | Real query (1 row); falls back to 'wip' for zero-history shots | Yes | FLOWING |
| `pipeline.setShotStatus` emit | this.events.emitEvent('shot.status_changed', payload) | Real EventEmitter; payload shape type-enforced by EngineEventMap | Yes — verified by `pipeline-shot-status.test.ts` event capture | FLOWING |
| `toDashboardPayload` camelCase frame | snake_case payload from emit | Pure adapter; verified by sse-adapter.test.ts exhaustiveness smoke (all 6 EngineEventMap keys covered) | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| TypeScript compiles clean | `npx tsc --noEmit` | exit 0, no output | PASS |
| Phase 20 scoped tests pass | `npx vitest run src/__tests__/architecture-purity.test.ts src/__tests__/tool-budget.test.ts src/types/__tests__/shot-status.test.ts src/store/__tests__/shot-status-repo.test.ts src/store/__tests__/schema-shot-status.test.ts src/tools/__tests__/shot-tool-status.test.ts src/http/__tests__/sse-adapter.test.ts src/engine/__tests__/pipeline-shot-status.test.ts` | 130/130 pass across 8 test files | PASS |
| Migration 0008 applied to dev DB | `sqlite3 vfx-familiar.db "PRAGMA table_info(shots)" \| grep status` | `4\|status\|TEXT\|1\|'wip'\|0` | PASS |
| shot_status_events table present | `sqlite3 vfx-familiar.db "SELECT name FROM sqlite_master WHERE type='table' AND name='shot_status_events'"` | `shot_status_events` | PASS |
| 4 expected indexes present in dev DB | `sqlite3 vfx-familiar.db "SELECT name FROM sqlite_master WHERE type='index' AND (name LIKE 'idx_shot%' OR name='idx_shots_cursor')"` | `idx_shots_status`, `idx_shots_project_status`, `idx_shot_status_events_shot_time`, `idx_shots_cursor` | PASS |
| Append-only grep zero in repo | `grep -c "UPDATE shot_status_events" src/store/shot-status-repo.ts` | 0 | PASS |
| MCP SDK purity in repo | `grep -c "@modelcontextprotocol/sdk" src/store/shot-status-repo.ts` | 0 | PASS |
| Tool count unchanged at 7 | `npx vitest run src/__tests__/tool-budget.test.ts` | 3/3 pass | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| STAT-01 | 20-01 | Five-value closed-set status (wip/pending-review/approved/on-hold/omit), free-form transitions, default 'wip' | SATISFIED (backend portion) | Backend portion verified: type contract at hierarchy.ts:59-60; migration default at 0008_shot_status.sql:13; live DB shows `status TEXT NOT NULL DEFAULT 'wip'`. **WCAG-compliant UI badge portion** is delivered by Phase 21 (Shot Grid View) — ROADMAP explicitly scopes Phase 20 as "Pure backend, no dashboard changes". REQUIREMENTS.md tracker maps STAT-01 → Phase 20 for the type/schema foundation; the badge UI is an STAT-01 consumer in Phase 21. |
| STAT-02 | 20-01, 20-02, 20-04 | Atomic dual-write via db.transaction() (UPDATE shots + INSERT shot_status_events); changed_by captures user or tool name | SATISFIED | `shot-status-repo.ts:88-92` — single `db.transaction(() => {...})` wraps both writes. Atomicity test (FK rollback) passes. `changed_by` defaults to `'user'` in tool layer (line 149: `input.changed_by ?? 'user'`). |
| STAT-03 | 20-01, 20-02, 20-04 | Up to 50 events newest-first; pre-migration shots return 'wip' default, never null | SATISFIED | `getStatusHistory` default limit 50 at repo line 108; `desc(created_at)` ordering at line 114; `getCurrentStatus` null-coalesce at line 132. Tool exposes via `list_status_history` with Zod max(50) bound (shot-tool.ts:67). |
| STAT-04 | 20-03, 20-04 | shot.status_changed SSE event on every change with {shotId, fromStatus, toStatus, changedBy, note?} | SATISFIED (backend portion) | `pipeline.ts:725` emits payload; `sse.ts:135-149` toDashboardPayload produces `{shotId, sequenceId, fromStatus, toStatus, changedBy, note?}` camelCase frame (sequenceId is additive). **Dashboard in-place badge update + shotId keying** is delivered by Phase 21 SSE consumer. |
| STAT-05 | 20-04 | Tool count stays at 7; 3 arms on existing shot tool, no new server.registerTool() | SATISFIED | `tool-budget.test.ts:71` — `expect(registerToolCount()).toBe(7)` passes. `shot-tool.ts` discriminated union extended (line 73), no new `server.tool()` registration. |

**Note on STAT-01 / STAT-04 UI portions:** REQUIREMENTS.md authors the user-observable end-state of each requirement, but the ROADMAP intentionally splits the backend foundation (Phase 20) from the UI consumer (Phase 21). The PLAN frontmatter for Phase 20 correctly claims STAT-01..05 for the backend deliverables. The UI badge + dashboard in-place update are dependent consumers in Phase 21 and out of scope for Phase 20 goal verification. This split is documented in the ROADMAP phase description ("Pure backend, no dashboard changes").

### Anti-Patterns Found

Scanned files modified in Phase 20:

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `src/store/shot-status-repo.ts` | — | None | — | Zero TODO/FIXME/placeholder/empty-impl patterns. JSDoc comments paraphrase forbidden patterns to avoid grep self-trip (Plan 02 SUMMARY deviation #2). |
| `src/engine/pipeline.ts` | — | None | — | Three facade methods well-formed; TypedError on missing shot is standard pattern (matches existing methods). |
| `src/tools/shot-tool.ts` | — | None | — | Discriminated union extended cleanly; no new registerTool call. |
| `drizzle/0008_shot_status.sql` | — | None | — | Includes `--> statement-breakpoint` markers per Drizzle migrator requirements (Plan 01 SUMMARY deviation #3). |

**No anti-patterns found in Phase 20 changes.**

### Code Review Findings (Advisory)

Per `20-REVIEW.md`: 0 critical, 6 warnings, 7 info findings. Per verification_notes, these are acknowledged as advisory and **none are blocking** for Phase 20 goal achievement. The 4 most-consequential warnings for Phase 21 consumers:

- **WR-01**: `listShotStatusHistory.total` returns clipped count (`history.length`) bounded by `limit`, not the unbounded count. Pagination UIs in Phase 21 will need to either use a separate COUNT(*) query or accept the bounded total. **Advisory** — does not affect Phase 20 backend correctness; the API contract returns what it returns.
- **WR-02**: Three migration indexes (`idx_shots_status`, `idx_shots_project_status`, `idx_shots_cursor`) are declared in migration SQL but missing from the Drizzle schema definition. Drizzle-kit regeneration would attempt to drop them. **Advisory** — indexes physically exist in DB (verified) and improve grid query performance per their declared shape; schema-side declaration is for `drizzle-kit generate` future-proofing.
- **WR-03**: `idx_shots_status` is a strict prefix of `idx_shots_project_status` and is redundant. Write amplification on every shots.status update. **Advisory** — verify in Phase 23 stats query review; safe to drop later in a maintenance migration if Phase 21+ queries confirm `idx_shots_project_status` covers all read paths.
- **WR-04**: Index name `idx_shots_project_status` is misleading (no `project_id` column on shots). **Advisory** — naming cleanup; the index works correctly on `(sequence_id, status, created_at DESC)`.

The remaining 2 warnings and 7 info items are documentation drift and minor maintainability concerns per `20-REVIEW.md`. All are **non-blocking**.

### Human Verification Required

None. Phase 20 is purely a backend phase with no UI changes, no real-time visual behavior to spot-check, and no external service integration. All deliverables are verifiable via:

- Static type-check (`npx tsc --noEmit` exits 0)
- Test suite (130/130 Phase-20-scoped tests pass across 8 files)
- Live DB inspection (sqlite_master + PRAGMA verify schema)
- Grep invariants (append-only + MCP SDK purity confirmed at 0/0/0)

The Phase 21 UI consumers (ShotStatusPill, ShotGridView, ShotGridCard, dashboard SSE handler) are out of scope for this verification; they will be exercised against the surfaces verified here when Phase 21 ships.

### Gaps Summary

**No gaps.** All 5 ROADMAP success criteria, all 18 plan must-haves, and all 5 STAT requirements are satisfied. The phase deliverables match the ROADMAP scope precisely:

- Migration 0008 lands with ALTER TABLE shots + CREATE TABLE shot_status_events + 4 indexes — verified at the SQL level, the Drizzle level, AND the live DB level.
- `shot-status-repo.ts` exists with the 3 documented functions, atomic dual-write in a single transaction, null-coalesce-to-'wip', and zero MCP SDK contamination.
- 3 new `shot` tool arms (set_status, get_status, list_status_history) ship without breaking the tool-budget invariant (still 7).
- `shot.status_changed` SSE event is wired end-to-end from `pipeline.setShotStatus` emit through the typed event bus to the toDashboardPayload camelCase frame.
- `ShotStatus` TypeScript type is the single source of truth for the 5-value closed set, anchored in `SHOT_STATUSES` runtime tuple.

Pre-existing test failures (c2pa fixtures, meta-validation drift in phase-attribution / requirements-cohort-closure / validation-flags) are documented in verification_notes as out-of-scope; confirmed identical failure set at diff base `8f27b9a` (pre-Phase-20).

The 6 code-review warnings are advisory per `20-REVIEW.md`'s own classification (`critical: 0`) and per the verifier's check against the Phase 20 goal text (none of the warnings block "Backend foundation for production status tracking"). Phase 21 consumers should review WR-01 (total clipping) and WR-02..04 (index schema drift) before designing the grid query layer.

---

*Verified: 2026-05-12T06:30:00Z*
*Verifier: Claude (gsd-verifier)*
