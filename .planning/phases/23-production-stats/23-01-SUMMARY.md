---
phase: 23-production-stats
plan: 01
subsystem: shot-status-repo + dashboard wire types + theme.css token
tags: [stats, sequence-stats, stale-shots, ovr-01, ovr-02, wire-shape, repo, sql, explain-query-plan, theme-tokens, wcag]
dependency_graph:
  requires:
    - "src/store/shot-status-repo.ts (Phase 20+21 surface — STALE_SHOT_DAYS constant, listShotsForGrid CTE, listShotsForGridSqlText)"
    - "packages/dashboard/src/types/shot-grid.ts (Phase 21 wire surface — ShotGridRow, ShotGridResponse, ShotStatus)"
    - "packages/dashboard/src/styles/theme.css (Phase 21 5-token --color-shot-status-* block)"
    - "drizzle/0008_shot_status.sql (Phase 20 idx_shots_status + idx_shots_project_status indexes)"
  provides:
    - "SequenceStats wire-type — total, approved_pct, counts (5 keys), pending_review_backlog, stale_count (D-02 LOCKED shape)"
    - "ShotGridRow.is_stale: boolean (D-03 LOCKED)"
    - "ShotGridResponse.stats: SequenceStats (D-02)"
    - "src/store/shot-status-repo.ts exports: getSequenceStats(db, sequenceId), getSequenceStatsStaleSqlText(), getSequenceStatsGroupBySqlText(), SequenceStatsRaw interface, extended ShotGridQueryRow with is_stale: number"
    - "src/store/shot-status-repo.ts: listShotsForGrid CTE outer SELECT extended with inline is_stale CASE column; listShotsForGridSqlText placeholder count grew 6→7 (cutoff added as bind #1)"
    - "packages/dashboard/src/styles/theme.css: --color-shot-stale token in both light (#b45309) and dark (#f97316) blocks"
    - "src/store/__tests__/shot-status-repo-stats.test.ts (NEW, 10 tests): counts correctness + stale semantics + EXPLAIN plan invariants"
    - "src/store/__tests__/shot-status-repo-grid.test.ts: extended with Phase 23 invariant test (is_stale CASE introduces no CORRELATED subquery on ranked CTE)"
  affects:
    - "Plan 23-02 (engine facade) — will consume getSequenceStats + ShotGridQueryRow.is_stale to compose engine.listShotGrid response with stats envelope + is_stale boolean coercion"
    - "Plan 23-03 (UI) — will consume SequenceStats props on <SequenceHeader/> + per-row is_stale on <ShotGridCard/> for the amber border render"
    - "src/http/__tests__/dashboard-routes-shot-grid.test.ts (Plan 02 will extend) — must populate stats envelope in mocks"
tech_stack:
  added: []
  patterns:
    - "Inline CASE expression in CTE outer SELECT (reuses existing LEFT JOIN ranked — no new correlated subquery)"
    - "Two-query stats: GROUP BY counts + EXISTS-clause stale count (no per-row N+1 subquery)"
    - "Cutoff binding pattern — `const cutoff = Date.now() - STALE_SHOT_DAYS * 86_400_000` computed once per call, bound as Drizzle `sql\\`...${cutoff}...\\`` placeholder"
    - "Raw-text SQL siblings for EXPLAIN tests — getSequenceStatsStaleSqlText / getSequenceStatsGroupBySqlText / listShotsForGridSqlText mirror precedent"
    - "Dual-theme token addition — both @theme dark block AND [data-theme=\"light\"] block patched in the same commit (Pitfall 6 enforcement)"
    - "Snake_case wire-shape envelope fields (approved_pct, pending_review_backlog, stale_count, version_count, total_count, next_cursor)"
key_files:
  created:
    - "src/store/__tests__/shot-status-repo-stats.test.ts (10 tests — counts + stale semantics + EXPLAIN invariants)"
  modified:
    - "packages/dashboard/src/types/shot-grid.ts (+48 lines — SequenceStats interface + is_stale + stats envelope field)"
    - "packages/dashboard/src/styles/theme.css (+6 lines — --color-shot-stale token in both blocks at lines 61 + 125)"
    - "src/store/shot-status-repo.ts (+182 lines — getSequenceStats + 2 sql-text helpers + ShotGridQueryRow.is_stale + listShotsForGrid CASE + listShotsForGridSqlText cutoff bind)"
    - "src/store/__tests__/shot-status-repo-grid.test.ts (+19 lines — Phase 23 invariant test + STALE_SHOT_DAYS import + cutoff bind across 2 existing EXPLAIN tests)"
    - "packages/dashboard/src/__tests__/App.test.tsx (+10 lines — required fields propagated to deep-link fixture)"
    - "packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx (+2 lines — is_stale default in buildShot fixture)"
    - "packages/dashboard/src/state/__tests__/shot-grid.test.ts (+24 lines — is_stale + stats defaults across seedShotGrid + 2 aggregateCounts inline fixtures)"
    - "packages/dashboard/src/views/__tests__/ShotGridView.test.tsx (+10 lines — is_stale + stats defaults in makeShot + buildResponse fixtures)"
decisions:
  - id: "D-01..D-21 (all 21 locked decisions inherited from 23-CONTEXT.md)"
    rationale: "Plan 23-01 implements the contracts only (types + theme + repo SQL). All implementation decisions were locked at CONTEXT-time; this plan executes them. The two UI-SPEC A5 escalations (D-08 hex values) supersede CONTEXT recommendations and were applied verbatim."
metrics:
  duration: "16m 16s"
  completed_date: "2026-05-15"
  task_count: 3
  file_count_modified: 8
  file_count_created: 1
  tests_added: 10
  tests_extended: 1
---

# Phase 23 Plan 01: Sequence stats foundations — wire types, theme token, repo SQL Summary

**One-liner:** Lock the read-only stats data path — server-side `getSequenceStats` (GROUP BY + EXISTS-clause stale_count, both index-backed), inline `is_stale` CASE on `listShotsForGrid` (reuses existing CTE — no new correlated subquery), dashboard wire types (`SequenceStats` + `is_stale` + `stats` envelope field), and the `--color-shot-stale` theme token in both light/dark blocks (UI-SPEC LOCKED contrast-verified hex values).

## Objective

Establish the deterministic, contrast-verified, EXPLAIN-tested foundation for Phase 23 Waves 2/3 to consume. Plan 23-02 (engine composition) and Plan 23-03 (UI) build directly against the contracts published here.

## What was built

### 1. Dashboard wire types — packages/dashboard/src/types/shot-grid.ts

**Published interface (D-02 LOCKED):**
```ts
export interface SequenceStats {
  total: number;                              // whole-sequence shot count
  approved_pct: number;                        // 0-100 integer (engine computes Math.round)
  counts: Record<ShotStatus, number>;          // all 5 keys initialized to 0
  pending_review_backlog: number;              // === counts['pending-review'] BY DESIGN
  stale_count: number;                         // whole-sequence stale shots
}
```

**Extended interfaces (D-03 / D-02):**
- `ShotGridRow.is_stale: boolean` — required, server-computed via inline CASE
- `ShotGridResponse.stats: SequenceStats` — required, sequence-wide aggregate

Both new fields are **required (not optional)** so downstream consumers receive a hard typecheck error if they forget to populate them. This propagated to 4 existing test fixtures (App.test.tsx, ShotGridCard.test.tsx, shot-grid.test.ts, ShotGridView.test.tsx) — all updated to populate neutral defaults (`is_stale: false`, neutral `stats` envelope). Dashboard typecheck passes; dashboard test suite holds at 443/443.

### 2. Theme token — packages/dashboard/src/styles/theme.css

**LOCKED hex values per UI-SPEC §"Color > Token 1" (A5 escalation supersedes CONTEXT D-08 recommendations):**
- Line 61 (dark @theme block): `--color-shot-stale: #f97316;` (orange-500, 5.41:1 vs `#202020`)
- Line 125 (light `[data-theme="light"]` block): `--color-shot-stale: #b45309;` (amber-700, 4.62:1 vs `#fafafa`)

Both pass WCAG 2.1 AA UI-component contrast (≥3:1) and are visually DISTINCT from `--color-shot-status-pending-review` (Phase 21 amber `#fbbf24` dark / `#d97706` light), so a shot that is BOTH pending-review AND stale renders two semantic cues — no visual collapse.

**REJECTED hex values** (failed UI-SPEC A5 escalation, NOT used):
- `#fbbf24` (would visually collapse with pending-review amber)
- `#f59e0b` (failed 3:1 vs `#fafafa`)

**Pitfall 6 verification:** `grep -c "^\s*--color-shot-stale" theme.css === 2` ✓ — both blocks patched in a single atomic commit.

### 3. Repo functions — src/store/shot-status-repo.ts

**Published function signature (the engine layer at Plan 23-02 will consume this):**
```ts
export interface SequenceStatsRaw {
  total: number;
  counts: Record<ShotStatus, number>;
  stale_count: number;
}
export function getSequenceStats(db: Db, sequenceId: string): SequenceStatsRaw;
```

The function executes TWO independent queries:
- **Q1 (GROUP BY counts):** `SELECT status, COUNT(*) FROM shots WHERE sequence_id = ? GROUP BY status` — uses `idx_shots_status` covering index (see EXPLAIN below). Initializes all 5 `ShotStatus` keys to 0 in TypeScript so callers never see undefined for sparse buckets.
- **Q2 (EXISTS-clause stale_count):** filters `shots.status IN ('wip','pending-review')` AND `EXISTS (SELECT 1 FROM versions v WHERE v.shot_id = shots.id AND v.status = 'completed' AND v.completed_at IS NOT NULL AND v.completed_at < cutoff)`. The `cutoff = Date.now() - STALE_SHOT_DAYS * 86_400_000` is computed in TypeScript at function entry.

`total` is derived in TS as Σ counts (saves one extra COUNT(*) roundtrip). The engine layer (Plan 23-02) computes `approved_pct` via `Math.round(counts.approved / total * 100)` per D-14 — keeping integer math in TypeScript for clarity.

**`STALE_SHOT_DAYS = 14` at line 54 is UNCHANGED** — single source of truth preserved.

### 4. listShotsForGrid CTE extension — src/store/shot-status-repo.ts

The existing Phase 21 window-function CTE gains ONE new column in its outer SELECT:

```sql
CASE
  WHEN s.status IN ('wip','pending-review')
    AND r.completed_at IS NOT NULL
    AND r.completed_at < ${cutoff}
  THEN 1 ELSE 0
END AS is_stale
```

This reuses the existing `LEFT JOIN ranked r ON r.shot_id = s.id AND r.rn = 1` relation — **no new correlated subquery is introduced** in the EXPLAIN plan, preserving the Phase 21 GRID-04 single-scan invariant on the `ranked` CTE.

`ShotGridQueryRow.is_stale: number` returns 0|1 from SQLite. The Plan 23-02 engine facade coerces this to a real boolean (`Boolean(row.is_stale)`) before emitting `is_stale: boolean` on the wire.

`listShotsForGridSqlText()` placeholder count grew from 6 to 7 (the cutoff is bind #1). The 2 existing EXPLAIN tests in `shot-status-repo-grid.test.ts` were updated to pass `(cutoff, sequenceId, null, null, null, null, 21)`.

## Tests

### NEW — src/store/__tests__/shot-status-repo-stats.test.ts (10 tests, all green)

| Test | Assertion |
|------|-----------|
| 1. 5 fresh wip shots | counts.wip=5, all other counts=0, total=5, stale_count=0 |
| 2. Mixed-status fixture | one shot in each status → counts=1 per key, total=5, stale_count=0 |
| 3. wip + completed > 14d old | stale_count=1, listShotsForGrid is_stale=1 |
| 4. **D-15 grace** — zero-version wip shot | stale_count=0, is_stale=0 (EXISTS falls out) |
| 5. **OVR-02 filter** — approved + completed > 14d old | stale_count=0 (status filter excludes) |
| 6. wip + completed < 14d old | stale_count=0, is_stale=0 |
| 7. pending-review + completed > 14d old | stale_count=1, is_stale=1 (both qualifying statuses covered) |
| 8 (T7). Q1 EXPLAIN — GROUP BY | uses idx_shots_status; NO `SCAN shots` full-table scan |
| 9 (T8). Q2 EXPLAIN — EXISTS | NO `SCAN versions` AND NO `SCAN shots` (both index-backed) |
| 10 (T8b). Q2 EXPLAIN — positive | versions accessed via SEARCH/INDEX (not full scan) |

### EXTENDED — src/store/__tests__/shot-status-repo-grid.test.ts

- Bind list grew 6→7 (cutoff added as bind #1) across both pre-existing EXPLAIN tests.
- NEW test: `Phase 23 invariant — is_stale CASE introduces NO CORRELATED subquery on the ranked CTE` — extends the GRID-04 single-scan invariant to lock against Phase 23 regression.
- All 14 grid tests green (including new invariant); Phase 21 lock preserved.

### Actual EXPLAIN plan outputs (captured at run-time)

**Q1 (GROUP BY counts):**
```json
[
  {
    "detail": "SEARCH shots USING COVERING INDEX idx_shots_status (sequence_id=?)"
  }
]
```
✓ Uses the `idx_shots_status (sequence_id, status)` covering index from drizzle/0008_shot_status.sql:25 — full index scan, no table fetch needed. The whole query satisfies from the index.

**Q2 (EXISTS-clause stale_count):**
```json
[
  {
    "detail": "SEARCH shots USING INDEX idx_shots_project_status (sequence_id=? AND status=?)"
  },
  {
    "detail": "SEARCH v EXISTS USING INDEX idx_versions_status (status=?)"
  }
]
```
✓ Outer `shots` scan uses `idx_shots_project_status` (a different Phase 20 index — also covers `sequence_id` + `status`). Inner EXISTS subquery uses `idx_versions_status` for the `v.status='completed'` filter. **No full SCAN on either table.**

Note: The RESEARCH document predicted the planner would pick `idx_shots_status` for the EXISTS path; the actual planner picked `idx_shots_project_status` (also a covering index on `(sequence_id, status)`-equivalent — both are valid index paths). The Test 8 negative assertion (`no SCAN shots`) catches the actual invariant correctly.

## Pitfall 6 verification — both theme.css blocks patched

```
$ grep -n "^[[:space:]]*--color-shot-stale" packages/dashboard/src/styles/theme.css
61:  --color-shot-stale: #f97316;  /* orange-500 — DISTINCT from pending-review amber per D-08 */
125:  --color-shot-stale: #b45309;  /* amber-700 — passes 4.62:1 vs #fafafa; distinct from pending-review #d97706 */
```

Two declarations, one per block, in the SAME commit. Light-theme contrast guaranteed; dark-theme contrast guaranteed. UI-SPEC §"Color" LOCKED values applied verbatim.

## D-15 grace period — implementation note for Plan 03

**Server behavior (LOCKED in this plan):**
- `getSequenceStats` Q2: `EXISTS (SELECT 1 FROM versions v ...)` — falls out when shot has zero completed versions.
- `listShotsForGrid` CASE: `r.completed_at IS NOT NULL AND r.completed_at < cutoff` — `r.completed_at` is NULL when LEFT JOIN ranked produces no match (zero completed versions).

**Net effect:** A wip shot created 30 days ago but with no completed versions is NOT stale. Only shots with a prior *real* completed version older than 14 days qualify.

**Plan 03 implication:** The dashboard's `recomputeIsStaleClient` (state/shot-grid.ts) MUST match this — `row.latest_completed_version === null` → return false. This is documented in 23-PATTERNS.md §5 (analog code excerpt at line 392-397).

## Phase 21 regression status

- Existing Phase 21 GRID-04 EXPLAIN test (`plan rows do NOT contain CORRELATED SCALAR SUBQUERY referencing the ranked CTE`) — **still green** with the new Phase 23 CASE column added.
- New invariant test added — affirms the Phase 23 CASE introduces NO new CORRELATED subquery on the `ranked` CTE.
- All 14 tests in shot-status-repo-grid.test.ts green.
- Full 277/277 tests green across src/store/__tests__.
- Dashboard suite holds at 443/443.
- architecture-purity (54/54) + tool-budget (3/3) unchanged.

## Deviations from Plan

### Auto-fixed Issues (Rule 3 — blocking)

**1. [Rule 3 — Blocking typecheck] Propagate new required fields to 4 existing test fixtures**
- **Found during:** Task 01-01 verification
- **Issue:** Adding `is_stale: boolean` (required) to `ShotGridRow` and `stats: SequenceStats` (required) to `ShotGridResponse` broke 4 existing test fixture files (`App.test.tsx`, `ShotGridCard.test.tsx`, `shot-grid.test.ts`, `ShotGridView.test.tsx`) with 15 TypeScript errors.
- **Fix:** Added neutral defaults (`is_stale: false`, a `stats` envelope with zero stale_count and zero pending_review_backlog) to each fixture's builder function and inline literal. Preserves the original test semantics — none of the affected tests assert on `is_stale` or `stats`.
- **Files modified:** packages/dashboard/src/__tests__/App.test.tsx, packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx, packages/dashboard/src/state/__tests__/shot-grid.test.ts, packages/dashboard/src/views/__tests__/ShotGridView.test.tsx
- **Commit:** b1787c0 (Task 01-01)
- **Rationale:** This is the **desired effect** per the plan's `<done>` block: "is_stale and stats fields are required (not optional) so downstream consumers will receive a hard typecheck error if they forget to populate them." The 4 test fixtures are downstream consumers; populating them propagates the contract correctly.

**2. [Rule 3 — Blocking parse error] Replace backticks in SQL inline comments with hyphens**
- **Found during:** Task 01-03 first test run
- **Issue:** My JSDoc-style SQL `--` comments in the `listShotsForGrid` body used backticks for column names (e.g., `` `r.completed_at IS NOT NULL` ``). The outer Drizzle `sql\`...\`` tagged template literal interpreted those inner backticks as the closing delimiter of the JS template, causing a parser error.
- **Fix:** Rewrote the SQL-inline comments to use plain text references (no backticks).
- **File modified:** src/store/shot-status-repo.ts (one comment block at the is_stale CASE)
- **Commit:** d3d6f80 (Task 01-03)

**3. [Rule 3 — Blocking node_modules sync] Run `npm install` after worktree spawn**
- **Found during:** First attempt at vitest run for dashboard tests (after Task 01-01 edits)
- **Issue:** Worktree was spawned with stale `node_modules` (missing `@preact/preset-vite`).
- **Fix:** Ran `npm install` once at the repo root. This is a known pattern (see memory entry "Run npm install after worktree merge"). No package.json or lockfile changes resulted.
- **Files modified:** none (only `node_modules/` populated)
- **Commit:** none required — `node_modules` is gitignored.

### Test plan deviations (intentional)

**4. [Plan-spec deviation] Added an extra "Test 8b" — positive EXPLAIN-plan evidence**
- **What:** Added a third EXPLAIN-plan test that affirms the versions access uses an index (not a full scan), as positive evidence of the autoindex path.
- **Why:** The plan's Test 8 is a negative assertion (`no SCAN versions`); 8b documents the positive plan-row evidence for future readers.
- **Test count:** Plan requires "8+ tests" per Task 01-03 acceptance criteria; this plan delivers 10 (1, 2, 3, 4, 5, 6, +1 pending-review case, 7, 8, 8b).

### Other observations

**5. [Index choice deviation from RESEARCH expectation]**
- **What:** RESEARCH §"Pitfall 1" and Pattern 9 predicted the planner would pick `idx_shots_status (sequence_id, status)` for the EXISTS Q2 path. The actual planner picked `idx_shots_project_status (sequence_id, status)` — a sibling index (BOTH from migration 0008). 
- **Impact:** None. Both indexes provide `(sequence_id, status)` lookup; the negative test (`no SCAN shots`) catches what matters. The plan's whitelist phrasing for Test 7 (`r.detail.includes('idx_shots_status') || r.detail.includes('SEARCH shots')`) is permissive enough that this works either way.

### What was NOT done (intentional — out of scope for Plan 01)

- No engine-layer composition (Plan 23-02 task)
- No `approved_pct` Math.round (Plan 23-02 task at engine boundary)
- No `<SequenceHeader/>` subrow render (Plan 23-03)
- No `<ShotGridCard/>` amber border class (Plan 23-03)
- No dashboard `sequenceStats` signal (Plan 23-02)
- No `--color-stats-backlog-callout` token (DEFERRED per UI-SPEC Open Question 1 — backlog callout reuses `--color-accent`)
- No CONTEXT D-15 documentation in user-facing copy (Plan 23-03 will document in the stale-shot tooltip text, if added)

## Self-Check: PASSED

- types/shot-grid.ts exports SequenceStats interface ✓
- ShotGridRow gained is_stale: boolean ✓
- ShotGridResponse gained stats: SequenceStats ✓
- theme.css has --color-shot-stale in BOTH blocks (lines 61 + 125) — count === 2 ✓
- LOCKED hex values applied: #f97316 (dark) + #b45309 (light) ✓
- REJECTED hex values absent: #fbbf24 + #f59e0b NOT used as --color-shot-stale ✓
- DEFERRED token absent: --color-stats-backlog-callout NOT added ✓
- shot-status-repo.ts exports getSequenceStats + getSequenceStatsStaleSqlText + getSequenceStatsGroupBySqlText ✓
- STALE_SHOT_DAYS = 14 at line 54 unchanged ✓
- listShotsForGrid extended with is_stale CASE (reuses ranked CTE — no new correlated subquery) ✓
- shot-status-repo-stats.test.ts (NEW) — 10/10 tests green ✓
- shot-status-repo-grid.test.ts (EXTENDED) — 14/14 tests green ✓
- Phase 21 GRID-04 invariant preserved — CORRELATED-on-ranked check still passes ✓
- Dashboard typecheck (`npx tsc --noEmit -p packages/dashboard`) — exit 0 ✓
- Vite production build (`npx vite build`) — ✓ 204ms
- architecture-purity (54/54) + tool-budget (3/3) — unchanged ✓
- Pre-commit HEAD safety: branch `worktree-agent-a3fd8e2dff88a6101` (per-agent namespace) ✓
- Per-task deletion check: clean (no unexpected deletions in any of 3 commits) ✓

## Commits (3 atomic + 1 SUMMARY)

| # | Hash | Task | Files |
|---|------|------|-------|
| 1 | b1787c0 | Task 01-01: Extend dashboard wire types | 5 files (1 src + 4 test fixtures) |
| 2 | 7b1e902 | Task 01-02: Add --color-shot-stale theme token | 1 file (theme.css) |
| 3 | d3d6f80 | Task 01-03: getSequenceStats + is_stale CASE + tests | 3 files (repo + 2 tests) |

**Total:** 1 file created, 8 files modified, +579 / -11 lines.

## Next: Plan 23-02 readiness

Plan 02 (engine composition) can now build against deterministic types and a contrast-verified palette:
- Engine `listShotGrid` will call `getSequenceStats(db, sequenceId)` alongside the existing `listShotsForGrid(db, sequenceId, opts)`, coerce per-row `is_stale: number → boolean`, compute `approved_pct = Math.round(counts.approved / total * 100)` (or 0 when total === 0), and merge into the single `ShotGridResponse` envelope.
- The HTTP route at `src/http/dashboard-routes.ts:370-375` stays a thin Hono handler (no signature change).
- Test harness at `src/http/__tests__/dashboard-routes-shot-grid.test.ts` will need to populate the new `stats` envelope and per-row `is_stale: false` defaults — same pattern as the 4 dashboard fixtures already updated in this plan.
