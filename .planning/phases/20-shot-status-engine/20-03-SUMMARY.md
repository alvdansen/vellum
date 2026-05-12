---
phase: 20-shot-status-engine
plan: "03"
subsystem: events
tags: [sse, events, typed-emitter, wire-shape-adapter, never-exhaustiveness, dashboard-contract, stat-04]

# Dependency graph
requires:
  - phase: 20-shot-status-engine
    plan: "01"
    provides: ShotStatus closed-set type (consumed transitively by `from_status: string | null` in the new payload; the `string` widening preserves the engine→SSE wire-shape policy of stringly-typed enums on the SSE bus)
provides:
  - ShotStatusChangedPayload interface (exported from src/engine/events.ts)
  - EngineEventMap['shot.status_changed'] entry (6th event in the typed bus)
  - EVENT_TYPES tuple extended with 'shot.status_changed' (satisfies ReadonlyArray<keyof EngineEventMap>)
  - toDashboardPayload case 'shot.status_changed' (snake_case→camelCase + note null→undefined)
  - sse-adapter.test.ts runtime exhaustiveness smoke for all 6 EngineEventMap keys
affects:
  - 20-04 (pipeline.setShotStatus emitEvent('shot.status_changed', payload) — type now exists)
  - 21-shot-grid (SSE client can render shot.status_changed frames to update grid in real time)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Typed-emitter map extension via interface field — new event types are a single-key addition to EngineEventMap (mirrors Plan 05-02 pattern; SSE EVENT_TYPES + toDashboardPayload follow automatically through `satisfies ReadonlyArray<keyof EngineEventMap>` + never-default arm)"
    - "Wire-shape adapter (CR-01 contract): snake_case engine payload → camelCase dashboard payload via toDashboardPayload pure function; nullable optional fields coerce null→undefined to match dashboard event-type contracts"
    - "Zero-write-site invariant: new event types inherit the SSE loop's shared listener closure + void+catch DoS guard for free — no new writeSSE call sites introduced (T-20-03-02 mitigation already in place is generic across types)"

key-files:
  created: []
  modified:
    - src/engine/events.ts
    - src/http/sse.ts
    - src/http/__tests__/sse-adapter.test.ts

key-decisions:
  - "Used `from_status: string | null` (not `ShotStatus | null`) in the engine payload to preserve the engine→SSE stringly-typed wire-shape convention already established for version.status_changed; the closed-set ShotStatus type is enforced at the engine API and repo layer, not on the SSE bus"
  - "Doc comment on ShotStatusChangedPayload mirrors the metadata.changed precedent (T-5-02 analogue): note IS broadcast because supervisors author it for the team and the SSE stream is already gated by the same origin allowlist + auth that exposes shot identifiers; this is documented inline so future readers don't reflexively scrub it"
  - "note?: null→undefined coercion in toDashboardPayload (mirrors parent_id?: pattern in hierarchy.created) — dashboard contract uses optional fields, not nullable; the adapter is the single leverage point for the type conversion"

patterns-established:
  - "Doc-comment growth for new EngineEventMap entries: each payload interface keeps a single-line `/** {event_name} — fires from {source} ({REQ_ID}). */` header (existing pattern from version.status_changed / version.created etc.). The grep for `shot.status_changed` in events.ts returns 2 (doc-comment header + map key) rather than the plan's projected 1 — benign + matches the codebase convention for adjacent payloads"
  - "Rule 3 blocker mechanics: widening `EngineEventMap` cascades to any `keyof EngineEventMap` indexed type — including test fixtures. The runtime smoke test in sse-adapter.test.ts uses `{ [K in keyof EngineEventMap]: EngineEventMap[K] }` for an exhaustive fixture map, so any new key requires a matching fixture + count assertion update. Pattern extends to any future plan that grows the map"

requirements-completed: [STAT-04]

# Metrics
duration: 4min
completed: 2026-05-12
---

# Phase 20 Plan 03: Engine Event Payload + SSE Bridge Summary

**ShotStatusChangedPayload interface + EngineEventMap entry + SSE EVENT_TYPES extension + toDashboardPayload case wires the 6th typed event (`shot.status_changed`) end-to-end from engine emit to dashboard frame, unblocking Plan 20-04's pipeline.setShotStatus() emit call and the future grid's real-time status updates.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-12T09:29:54Z
- **Completed:** 2026-05-12T09:34:07Z
- **Tasks:** 2
- **Files modified:** 3 (0 created, 3 modified)

## Accomplishments

- **ShotStatusChangedPayload** exported from `src/engine/events.ts` with the contract specified in 20-PATTERNS.md: `shot_id`, `sequence_id`, `from_status: string | null`, `to_status`, `changed_by`, `note: string | null`, `at: ISO 8601 timestamp`
- **EngineEventMap** extended with `'shot.status_changed': ShotStatusChangedPayload` as the 6th typed event (no reordering of the existing 5)
- **EVENT_TYPES** tuple in `src/http/sse.ts` extended with `'shot.status_changed'` (satisfies-check still holds — `as const satisfies ReadonlyArray<keyof EngineEventMap>`)
- **toDashboardPayload** switch in `src/http/sse.ts` gains a `case 'shot.status_changed'` arm that performs the engine→dashboard wire-shape transform: snake_case→camelCase + `note?: null→undefined` coercion (mirrors the `parent_id?: undefined` pattern in `hierarchy.created`)
- **Zero new writeSSE call sites** — the existing loop at sse.ts:175-197 inherits the new event type automatically through the shared `listener` closure + `void stream.writeSSE({...}).catch(() => {})` pattern (T-20-03-02 mitigation generic across types)
- **sse-adapter.test.ts exhaustiveness smoke** updated: fixtures map now includes `'shot.status_changed'` with realistic shape; `expect(keys.length).toBe(5)` bumped to 6
- **`npx tsc --noEmit` exits 0** — the `satisfies` constraint on EVENT_TYPES and the `never`-default arm in `toDashboardPayload` both confirm exhaustive handling

## Task Commits

Each task was committed atomically; the `satisfies + never` mechanism intentionally caused tsc to fail between Task 1 and Task 2 — the failure is what proves the type-level enforcement works.

1. **Task 1: Add ShotStatusChangedPayload and extend EngineEventMap in src/engine/events.ts**
   - `a42f250` (feat) — new interface + map entry; documented in the commit message that tsc is intentionally red until Task 2 lands the matching SSE adapter case

2. **Task 2: Extend EVENT_TYPES, toDashboardPayload, and the exhaustiveness test fixture**
   - `a6354cd` (feat) — import ShotStatusChangedPayload; add EVENT_TYPES entry; add toDashboardPayload case; Rule 3 fix in sse-adapter.test.ts (fixtures map width + count assertion)

## Files Modified

- `src/engine/events.ts` — added ShotStatusChangedPayload interface (lines 27-47) immediately after VersionStatusChangedPayload, maintaining the doc-comment+interface pattern used by the other 4 payloads; added `'shot.status_changed': ShotStatusChangedPayload;` as the 6th entry in EngineEventMap (preserving the order of the existing 5)
- `src/http/sse.ts` — extended type import from `'../engine/events.js'` to pull in ShotStatusChangedPayload; bumped the EVENT_TYPES tuple from 5 to 6 entries (`'shot.status_changed'` appended); added `case 'shot.status_changed'` to toDashboardPayload immediately before the `default` (never) arm; updated the EVENT_TYPES header comment from "5 event types" to "6 event types (D-WEBUI-06, STAT-04)"
- `src/http/__tests__/sse-adapter.test.ts` — Rule 3 fix: extended the `{ [K in keyof EngineEventMap]: EngineEventMap[K] }` fixtures map with a `'shot.status_changed'` entry (from_status: 'wip', to_status: 'pending-review', note: null) and bumped `expect(keys.length).toBe(5)` → `toBe(6)`; renamed the describe-it title from "all 5 EngineEventMap keys" to "all 6 EngineEventMap keys"

## Decisions Made

- **`from_status: string | null` not `ShotStatus | null`** in the engine payload: the engine→SSE bus uses stringly-typed enums (precedent: `version.status_changed` declares its status union inline as `'submitted' | 'running' | 'completed' | 'failed'` rather than importing `VersionStatus`). The closed-set ShotStatus type is enforced at the engine API + repo layer (Plans 20-01, 20-02, 20-04), not on the SSE wire. This preserves SSE bus layering and avoids a transitive type-import dependency from `engine/events.ts` to `types/hierarchy.ts`.
- **note IS broadcast on the SSE wire** (in contrast to `metadata.changed` which scrubs `value` per T-5-02): documented inline in the ShotStatusChangedPayload header comment that supervisor-authored notes are at the same trust level as the shot names themselves (which the SSE stream already exposes via `shot_id`), and the stream is already gated by the same origin allowlist + auth. The threat-model accept disposition for T-20-03-01 covers this explicitly.
- **`note?: null→undefined` coercion in toDashboardPayload** mirrors the `parent_id?: undefined` pattern in the existing `hierarchy.created` case — dashboard event-type contracts use optional fields, not nullable; the adapter is the single leverage point for the conversion (one-arm fix, no client-side null handling needed).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] sse-adapter.test.ts fixtures map fails compile after widening EngineEventMap**
- **Found during:** Task 1 verify (`npx tsc --noEmit` after extending EngineEventMap)
- **Issue:** `src/http/__tests__/sse-adapter.test.ts:225` declares `const minimalByType: { [K in keyof EngineEventMap]: EngineEventMap[K] }` as an exhaustive fixtures map. Adding `'shot.status_changed'` to EngineEventMap broadens the mapped-type domain, and the existing object literal (5 entries) became incomplete — TS2741 "Property ''shot.status_changed'' is missing in type ...". The plan's Task 1 verification step said "Run `npx tsc --noEmit` to verify zero errors" but didn't anticipate this test fixture would also need to grow.
- **Fix:** Added `'shot.status_changed': { shot_id: 'sh1', sequence_id: 'sq1', from_status: 'wip', to_status: 'pending-review', changed_by: 'user', note: null, at: 't' }` to the fixtures map. Bumped the adjacent `expect(keys.length).toBe(5)` assertion to `toBe(6)` (otherwise the test would fail at runtime even after compiling). Renamed the it-title from "all 5 EngineEventMap keys are handled" to "all 6 EngineEventMap keys are handled" so the test continues to self-document the assertion count.
- **Files modified:** src/http/__tests__/sse-adapter.test.ts
- **Verification:** `npx tsc --noEmit` exits 0; the sse-adapter.test.ts suite passes 18/18; full HTTP + architecture-purity suite passes 193/193.
- **Committed in:** `a6354cd` (Task 2 commit) — grouped with the sse.ts case-arm addition because they're a single logical unit (both close the satisfies+never compile error).
- **Pattern note:** This is the same shape of issue Plan 20-01 hit twice (fake-engine.ts `getShot` stub + hierarchy-repo.ts `createShot` row both needed `status: 'wip'` after Shot interface widening). Any future plan that adds a key to EngineEventMap will cascade through `keyof EngineEventMap` mapped types — the exhaustiveness smoke fixture is the closest analog.

### Doc-comment grep over-count vs plan projection

- **Plan verification said:** `grep -c "shot.status_changed" src/engine/events.ts` returns 1
- **Actual result:** returns 2
- **Why:** The plan author projected only the EngineEventMap key as the matching occurrence, but the existing pattern in events.ts is `/** {event_name} — fires from ... */` doc-comment headers on every payload interface (see line 18 for `version.status_changed`, line 27 for `version.created`, etc.). Following the established convention required adding the same header for ShotStatusChangedPayload, which adds a second match at line 28. Functionally the EngineEventMap key (line 106) is the load-bearing usage; the doc-comment match is benign and matches the codebase convention for adjacent payloads.

---

**Total deviations:** 1 auto-fixed (Rule 3 - Blocking) + 1 benign verification-count over-count
**Impact on plan:** The Rule 3 fix is a mechanical consequence of widening `EngineEventMap` (the same cascade pattern Plan 20-01 already documented). Zero scope creep. Plan-level `must_haves.truths` all met: tsc clean, interfaces exported, map entry added, EVENT_TYPES extended, switch case added, no new writeSSE sites.

## Issues Encountered

- **Plan's Task 1 verify step was overly optimistic about tsc cleanliness:** "Run `npx tsc --noEmit` to verify zero errors" after Task 1 alone cannot succeed because (a) the never-exhaustiveness arm in `toDashboardPayload` (sse.ts:135) requires Task 2 + (b) the test fixture map width requires the Rule 3 fix bundled with Task 2. Resolved by committing Task 1 with a commit-message note that tsc is intentionally red until Task 2 lands, and bundling the Rule 3 test fix into Task 2's commit. Future plans that grow EngineEventMap should expect the same two-step compile transient.

## Pre-existing Test Failures (Out of Scope)

The following test failures pre-date this plan and are **not caused by Plan 20-03 changes** (confirmed: the touched-files scope `npx vitest run src/http src/__tests__/architecture-purity.test.ts` passes 193/193):

- **C2PA signer/verifier tests (~20 files)**: all fail with `ENOENT: no such file or directory, open '/.../node_modules/c2pa-node/tests/fixtures/certs/es256.pub'`. Documented in Plan 20-01 SUMMARY. Out of scope (env issue, predates Phase 20).
- **phase-attribution.test.ts (SORT-03 attribution, SUM-05 attribution)**: pre-existing missing-attribution claims in v1.2 phase summaries. Documented in Plan 20-01 SUMMARY. Out of scope.
- **phase-attribution.test.ts (STAT-05 attribution)**: will pass once Plan 20-04 ships its SUMMARY (STAT-05 is owned by Plan 20-04). Plan 20-03's frontmatter claims only STAT-04, which this SUMMARY attributes. **Expected behavior — not a regression.**

## User Setup Required

None — purely internal wire-up; no external service or configuration changes.

## Next Phase Readiness

- **Plan 20-04 (shot-tool arms + pipeline.setShotStatus facade)**: unblocked. `engine.events.emitEvent('shot.status_changed', { shot_id, sequence_id, from_status, to_status, changed_by, note, at })` is now type-checked at the call site; missing fields will fail compile. The SSE bridge will pick up the emit automatically through the existing loop — no further sse.ts edits needed in Plan 20-04.
- **Plan 21-shot-grid (UI consumer)**: unblocked for SSE-side type expectations. Dashboard event-type contract on the wire is `{ shotId, sequenceId, fromStatus, toStatus, changedBy, note? }` — already documented in `packages/dashboard/src/types/events.ts` if a corresponding `ShotStatusChangedEvent` is declared there, or to be added in the grid plan.
- **No blockers for downstream plans.** All `must_haves.artifacts` in this plan's frontmatter are exported, typed, and test-anchored.

## Self-Check: PASSED

Verified at end of execution:

- `[ -f src/engine/events.ts ]` → FOUND
- `[ -f src/http/sse.ts ]` → FOUND
- `[ -f src/http/__tests__/sse-adapter.test.ts ]` → FOUND
- `git log --all | grep a42f250` → FOUND (Task 1: events.ts extension)
- `git log --all | grep a6354cd` → FOUND (Task 2: sse.ts extension + test fixture fix)
- `npx tsc --noEmit` → exit 0
- `grep -c "ShotStatusChangedPayload" src/engine/events.ts` → 2 (interface + map value type, >= 2)
- `grep -c "shot.status_changed" src/engine/events.ts` → 2 (doc-comment + map key; >= 1 as required, count diff explained above)
- `grep -c "shot.status_changed" src/http/sse.ts` → 2 (EVENT_TYPES entry + case arm; >= 2)
- `grep -c "ShotStatusChangedPayload" src/http/sse.ts` → 2 (import + case cast; >= 1)
- `grep -c "writeSSE" src/http/sse.ts` → 3 (unchanged from baseline)
- `npx vitest run src/http src/__tests__/architecture-purity.test.ts` → 193/193 passed

## TDD Gate Compliance

Neither task in this plan had `tdd="true"` (both were `type="auto"` per the plan frontmatter), so the RED/GREEN/REFACTOR cycle does not apply at the task level. The plan is gated by:
- Compile-time exhaustiveness check at sse.ts:135 (`never` arm) — would have caught a missing case automatically
- Runtime exhaustiveness smoke in sse-adapter.test.ts:220-252 — covers all 6 keys, would have caught a missing case at runtime
- Type-level `satisfies ReadonlyArray<keyof EngineEventMap>` constraint on EVENT_TYPES — would have caught a missing tuple entry

Both gates passed. The plan is compliant with the "tests + types co-enforce contracts" pattern even without TDD framing.

---
*Phase: 20-shot-status-engine*
*Plan: 20-03*
*Completed: 2026-05-12*
