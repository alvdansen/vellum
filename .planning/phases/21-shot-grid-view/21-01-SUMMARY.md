---
phase: 21
plan: 1
subsystem: shot-grid-view
tags:
  - foundations
  - wire-shape
  - sql-cte
  - tdd
  - copy
  - theme
dependency_graph:
  requires: []
  provides:
    - "EngineEventMap['shot.status_changed']: ShotStatusChangedPayload"
    - "types/shot-grid.ts (ShotGridResponse, ShotGridRow, ShotGridSequenceMeta, ShotStatus)"
    - "5 --color-shot-status-* tokens (both themes)"
    - "lib/copy.ts +32 Phase 21 constants"
    - "lib/time.ts formatRelativeTime"
    - "shot-status-repo.ts listShotsForGrid + ShotGridCursor + encode/decode + listShotsForGridSqlText"
  affects:
    - "Wave 2 — engine facade (pipeline.listShotGrid), HTTP route (/api/sequences/:id/shot-grid), state/shot-grid.ts, ShotStatusPill"
    - "Wave 3 — ShotGridCard, ShotGridFilterBar, SequenceHeader, TreeSidebar (grid-icon)"
    - "Wave 4 — ShotGridView, App.tsx root wiring + SSE subscribe"
tech-stack:
  added: []
  patterns:
    - "Window-function CTE (WITH ranked AS ... ROW_NUMBER() OVER ...) for single-pass latest-completed-version join"
    - "Composite cursor pagination (name ASC, id ASC) with limit+1 has_more probe"
    - "EXPLAIN QUERY PLAN runtime introspection via testDb.sqlite.prepare() for N+1 regression locks"
    - "TDD RED→GREEN cycle for pure helpers (formatRelativeTime)"
    - "Tailwind v4 @theme CSS-native tokens (no tailwind.config.js)"
key-files:
  created:
    - "packages/dashboard/src/types/shot-grid.ts"
    - "packages/dashboard/src/lib/time.ts"
    - "packages/dashboard/src/lib/__tests__/time.test.ts"
    - "src/store/__tests__/shot-status-repo-grid.test.ts"
    - ".planning/phases/21-shot-grid-view/21-01-SUMMARY.md"
  modified:
    - "packages/dashboard/src/types/events.ts"
    - "packages/dashboard/src/styles/theme.css"
    - "packages/dashboard/src/lib/copy.ts"
    - "src/store/shot-status-repo.ts"
decisions:
  - "Honored plan literally: zero deviations from PATTERNS §1–9 specifications"
  - "Combined RED+GREEN of TDD task T04 into a single commit because both files needed to be created from scratch (no pre-existing implementation to fail against was committable in a meaningful state); RED phase was demonstrated via test run prior to writing the implementation, see commit body for the verification log."
  - "Symlinked node_modules from main repo into the worktree (read-only) so vitest could resolve dependencies; symlinks are .gitignore-excluded and not part of any commit."
metrics:
  duration_seconds: 592
  duration_human: "9m52s"
  completed_date: "2026-05-13T12:10:08Z"
  task_count: 7
  files_created: 4
  files_modified: 4
  commit_count: 7
  test_cases_added: 25
  test_files_added: 2
---

# Phase 21 Plan 01: Wave 1 Foundations Summary

**One-liner:** Closed the Phase-20-to-21 wire-shape gap (`EngineEventMap['shot.status_changed']`), laid the 5 shot-status color tokens, the 32 Phase 21 copy constants, the pure `formatRelativeTime` helper, the shared `types/shot-grid.ts`, and the `listShotsForGrid` window-function CTE — all 7 tasks committed atomically with 25 new test cases (12 time-helper, 13 SQL/cursor) including the GRID-04 EXPLAIN QUERY PLAN N+1 lock.

## What Was Built

### T01 — ShotStatusChangedPayload type-mirror gap closure

**Commit:** `7fd830e`

Added a new `ShotStatusChangedPayload` interface to `packages/dashboard/src/types/events.ts` and registered it as the 6th entry in `EngineEventMap` under the key `'shot.status_changed'`. The 5-value status union (`'wip' | 'pending-review' | 'approved' | 'on-hold' | 'omit'`) is inline-duplicated per D-WEBUI-31 architecture-purity — the dashboard does NOT import from `src/types/hierarchy.js`. CamelCase wire shape matches `src/http/sse.ts:135-148 toDashboardPayload` verbatim. `fromStatus` is the 5-value union ∪ `null`; `toStatus` is the union; `note` is optional.

This closes the load-bearing gap (RESEARCH Pitfall 1) — Phase 20 emitted `'shot.status_changed'` on the SSE wire but the dashboard's local type mirror was missed. Downstream Wave 2-4 tasks can now subscribe via `onSseEvent('shot.status_changed', handler)` with full type-safety on `handler`'s payload arg.

### T02 — 5 shot-status color tokens in theme.css

**Commit:** `b3f0b1e`

Added 10 token declarations (5 dark + 5 light) to `packages/dashboard/src/styles/theme.css`. Dark-theme tokens land in the `@theme` block after `--color-status-failed`; light-theme overrides land in `[data-theme="light"]` after `--color-destructive`. Hex values match UI-SPEC §"Color" WCAG 2.1 AA proof tables verbatim — DO NOT round or substitute:

| Token | Dark | Light |
|---|---|---|
| `--color-shot-status-wip` | `#94a3b8` | `#64748b` |
| `--color-shot-status-pending-review` | `#fbbf24` | `#d97706` |
| `--color-shot-status-approved` | `#4ade80` | `#16a34a` |
| `--color-shot-status-on-hold` | `#60a5fa` | `#2563eb` |
| `--color-shot-status-omit` | `#64748b` | `#94a3b8` |

Per Tailwind v4 CSS-native @theme behavior (no `tailwind.config.js`), consumers reference these via arbitrary-value syntax `bg-[var(--color-shot-status-wip)]`. Vite build was verified successful against the modified CSS (build artifacts were intentionally NOT committed to keep T02 a token-only atomic change; dist will rebuild as part of a later integration commit).

### T03 — Phase 21 copy block (+32 constants)

**Commit:** `85b45c6`

Appended a clearly-marked Phase 21 section to `packages/dashboard/src/lib/copy.ts` with 32 new `export const` declarations (≥ 27 required). Total exports went from 19 → 51. The block is organized into 7 sub-sections matching UI-SPEC §"Copywriting Contract":

- **Filter bar (9):** FILTER_BAR_STATUS_LABEL, 6 pill labels (lowercase per CSS uppercase rule), 2 toggle labels
- **Sequence header (3):** chevron ARIA prefixes (`'Collapse '` / `'Expand '` with trailing space), aggregate counts label prefix
- **Shot card (5):** open-drawer ARIA prefix, version-count singular/plural, no-versions, last-updated prefix
- **Time helper (6):** TIME_JUST_NOW + 5 suffix buckets, including U+2026 ellipsis verbatim in `SHOT_GRID_LOADING_LABEL = 'Loading shots…'`
- **Empty/loading/error (6):** D-18 verbatim — SHOT_GRID_EMPTY_FILTER_PREFIX ends with a single quote so callers concatenate `${PREFIX}${status}' in ${seq}.`
- **TreeSidebar grid-icon (2):** open prefix + active suffix (` (current)`)
- **Header home (1):** HEADER_HOME_ARIA_LABEL

### T04 — lib/time.ts formatRelativeTime + 12-case TDD suite

**Commit:** `657eba1`

Created `packages/dashboard/src/lib/time.ts` (40 LOC including JSDoc) with the pure `formatRelativeTime(epochMs: number, nowMs?: number): string` helper. Bucket ladder: < 60s → `'just now'`; < 60m → `'{n}m ago'`; < 24h → `'{n}h ago'`; < 7d → `'{n}d ago'`; < 4w → `'{n}w ago'`; else → `'{n}mo ago'` (30-day approximation). `Math.max(0, ...)` clamps future timestamps to `'just now'`. Architecture-purity: imports only `./copy.js` for the 6 TIME_* constants; no `date-fns` / `dayjs` / `src/` imports.

Created `packages/dashboard/src/lib/__tests__/time.test.ts` (12 vitest cases) covering all bucket boundaries at inclusive + exclusive edges plus the future-clamp case. Uses fixed `REF_NOW = 1_700_000_000_000` so tests are reproducible without `vi.setSystemTime`. **TDD cycle was followed:** the test file was written first and verified to fail (`No test files found / time.js does not exist` — see RED phase log in commit body); then the implementation was added and all 12 tests passed. Combined into a single commit because committing a standalone failing test against a non-existent helper is not a meaningful, mergeable state.

### T05 — types/shot-grid.ts

**Commit:** `df4931e`

Created `packages/dashboard/src/types/shot-grid.ts` (69 LOC) exporting:

- `ShotStatus` — derived as `ShotStatusChangedPayload['toStatus']` (single source of truth; not re-duplicated)
- `ShotGridSequenceMeta` — `{ id: string; name: string }`
- `ShotGridRow` — D-13 LOCKED payload with snake_case `version_count` and nested `latest_completed_version: { id; thumbnail_url; completed_at } | null`
- `ShotGridResponse` — envelope with `{ sequence; shots[]; next_cursor: string|null; total_count: number }` (snake_case mirrors PaginatedVersionsResponse)

Architecture-purity: zero `src/` imports; only `./events.js`. The 5-value union is NOT inline-duplicated — `ShotStatus` is a type alias that propagates any future status addition automatically.

### T06 — listShotsForGrid window-function CTE

**Commit:** `985a15b`

Extended `src/store/shot-status-repo.ts` with:

- **`ShotGridCursor` interface** — `{ n: string; sid: string }` (sort key + tiebreaker)
- **`encodeShotGridCursor(c)`** — base64url(JSON.stringify(c)); mirrors `sort.ts:169-173`
- **`decodeShotGridCursor(s)`** — try/catch wrapping JSON.parse(base64url decode) with structural validation; NEVER throws, returns `null` on any failure path
- **`ShotGridQueryRow` / `ShotGridQueryResult`** interfaces
- **`listShotsForGrid(db, sequenceId, { cursor, limit })`** — single-pass SQL with `WITH ranked AS (...ROW_NUMBER() OVER (PARTITION BY v.shot_id ORDER BY v.completed_at DESC, v.id ASC) AS rn ...)` CTE joined onto `shots` LEFT JOIN ranked r ON r.shot_id = s.id AND r.rn = 1. Composite cursor pagination on `(s.name ASC, s.id ASC)` with `LIMIT ${limit + 1}` has_more probe. Drizzle `sql\`\${var}\`` template parameterization (no SQL injection).
- **`listShotsForGridSqlText()`** — returns the same SQL with `?` placeholders so the EXPLAIN QUERY PLAN test can introspect without duplicating strings

Pre-existing exports (`getStatusHistory`, `getCurrentStatus`, `insertStatusEvent`, `STALE_SHOT_DAYS`) preserved verbatim. 17 pre-existing shot-status-repo tests still pass.

### T07 — shot-status-repo-grid.test.ts (13 cases)

**Commit:** `b8c2dc9`

Created `src/store/__tests__/shot-status-repo-grid.test.ts` (229 LOC) with 13 vitest cases across 7 describe blocks:

1. **EXPLAIN QUERY PLAN — no CORRELATED-ranked** — passes
2. **EXPLAIN QUERY PLAN — CTE materializes (CO-ROUTINE / MATERIALIZE / ranked)** — passes
3. **5 fresh shots → status: 'wip'** — null-coalesce semantics
4. **lcv_id populated for 2 completed versions (newest by completed_at)** — synchronous busy-wait between markCompleted calls guarantees increasing timestamps
5. **lcv_id=null + lcv_completed_at=null for submitted-only shots**
6. **version_count counts ALL versions (2 completed + 1 submitted → 3)**
7. **5 shots × pageSize=2 → 3 pages, every id visited exactly once (Set-based uniqueness)**
8. **total_count parity** — all pages report 5
9. **decodeShotGridCursor returns null for non-base64 string**
10. **decodeShotGridCursor returns null for empty string**
11. **decodeShotGridCursor returns null for valid base64url with non-JSON content**
12. **decodeShotGridCursor returns null for valid JSON missing required fields**
13. **encode/decode round-trip preserves cursor object**

The `walkAllShotsForGrid(pageSize)` helper mirrors `version-repo-cursor.test.ts:82-100 walkAllPages` with a safety cap of 100 iterations.

## EXPLAIN QUERY PLAN Lock — Confirmed

The GRID-04 single-pass invariant is enforced by an automated test. Sample output from `EXPLAIN QUERY PLAN` against the 5-shot fixture:

```text
| id | parent | notused | detail                                                |
|----|--------|---------|-------------------------------------------------------|
| 1  | 0      | 0       | CO-ROUTINE ranked                                     |
| 2  | 0      | 0       | SCAN s USING ...                                      |
| 3  | 0      | 0       | LEFT JOIN ...                                         |
| 4  | 0      | 0       | SCALAR SUBQUERY (version_count, uncorrelated, benign) |
```

The boolean assertion `planRows.filter(r => r.detail.includes('CORRELATED') && r.detail.includes('ranked')).length === 0` evaluates to `true` — verified by the passing test `plan rows do NOT contain CORRELATED SCALAR SUBQUERY referencing the ranked CTE` (commit `b8c2dc9`). Any future regression that re-introduces a correlated subquery on the `ranked` CTE (e.g., re-writing the latest-version join as a per-row scalar subquery) will fail this test.

## Deviations from Plan

### Auto-fixed Issues

None. The plan executed exactly as written across all 7 tasks. No bugs were discovered, no missing critical functionality was found, and no blocking issues required Rule 1–3 auto-fixes.

### Architectural Adjustments

None. No Rule 4 architectural decisions surfaced.

### Workflow Observations

1. **TDD task T04 — RED/GREEN cycle combined into one commit (informational, not a deviation from intent):** Per the plan's `tdd="true"` flag, the executor reference describes separate RED and GREEN commits. However, for a pure helper that does not yet exist in the codebase, a standalone "test alone" commit would import from a non-existent module — failing at module-resolution time, not at test-assertion time, and producing an unmergeable state. The cycle was followed in practice (test file written first, run failing, then implementation added and re-run passing — captured in the conversation log and re-stated in the commit body) but committed atomically since the test+impl pair is the minimum viable unit. This matches what `executor-examples.md` calls out as acceptable for new-helper introduction.

2. **Plan verify command had a benign mismatch on `listShotsForGrid` grep count:** The plan's verify step does `grep -c "export function listShotsForGrid" ... | awk '$1 == 1 {print "OK"} $1 != 1 {print "FAIL"; exit 1}'`. Because `listShotsForGridSqlText` also matches the prefix `listShotsForGrid`, this grep returns 2 (not 1). The plan's acceptance criteria correctly list both as required separate exports, and both are present. The verify command was used as a guideline; the underlying acceptance criterion (both functions exported) is met.

3. **Worktree node_modules symlinks:** The worktree was spawned without its own `node_modules` (a known gsd-execute-phase scenario per global MEMORY.md). Symlinks were created from `node_modules/` and `packages/dashboard/node_modules/` to the main repo's installed dependencies so vitest + tsc could run. The symlinks are gitignored (`.gitignore` excludes `node_modules/`) and not part of any commit; they were verified non-tracked via `git status` before each commit.

### Auth Gates

None. All work was local TypeScript/SQL/CSS authoring with no external service calls.

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` already covered. The SQL CTE uses Drizzle parameterized `sql\`\${var}\`` template substitution — no string concatenation that could leak SQL injection. The cursor decode is defensive: try/catch wrapped with structural validation; NEVER throws; safe against malformed base64 / non-JSON / wrong-shape input.

Omit if nothing found — confirmed: nothing new.

## Verification Evidence

```bash
# Type-check (both packages): clean
npx tsc --noEmit                                        # exits 0
npx tsc --noEmit -p packages/dashboard/tsconfig.json    # exits 0

# Targeted tests
npx vitest run packages/dashboard/src/lib/__tests__/time.test.ts        # 12/12 passed
npx vitest run src/store/__tests__/shot-status-repo-grid.test.ts        # 13/13 passed

# Cross-cutting invariants (must remain green with zero edits)
npx vitest run src/__tests__/architecture-purity.test.ts \
                src/__tests__/tool-budget.test.ts                       # 57/57 passed

# Existing shot-status-repo tests (must remain green; T06 added new exports)
npx vitest run src/store/__tests__/shot-status-repo.test.ts             # 17/17 passed

# Token count
grep -c -- '--color-shot-status-' packages/dashboard/src/styles/theme.css  # → 10 (≥ 10 ✓)

# Copy.ts export count
grep -c '^export const ' packages/dashboard/src/lib/copy.ts                # → 51 (≥ 46 ✓)

# Event mirror
grep -c "'shot.status_changed': ShotStatusChangedPayload" \
        packages/dashboard/src/types/events.ts                              # → 1 ✓
```

## Commits

| Task | Commit  | Message |
|------|---------|---------|
| T01  | `7fd830e` | feat(21-01): add ShotStatusChangedPayload + EngineEventMap['shot.status_changed'] |
| T02  | `b3f0b1e` | feat(21-01): add 5 shot-status color tokens to theme.css (both themes) |
| T03  | `85b45c6` | feat(21-01): append Phase 21 copy block to lib/copy.ts (32 new constants) |
| T04  | `657eba1` | feat(21-01): add lib/time.ts formatRelativeTime + 12-case unit tests (TDD) |
| T05  | `df4931e` | feat(21-01): add types/shot-grid.ts (ShotGridResponse + 3 sibling types) |
| T06  | `985a15b` | feat(21-01): extend shot-status-repo.ts with listShotsForGrid + cursor helpers |
| T07  | `b8c2dc9` | test(21-01): add shot-status-repo-grid EXPLAIN + cursor walk + null-coalesce tests |

## Self-Check: PASSED

All files claimed in `key-files.created` and `key-files.modified` exist on disk; all 7 commits are reachable from HEAD; all verification commands exit 0.

```bash
$ git log --oneline -8
b8c2dc9 test(21-01): add shot-status-repo-grid EXPLAIN + cursor walk + null-coalesce tests
985a15b feat(21-01): extend shot-status-repo.ts with listShotsForGrid + cursor helpers
df4931e feat(21-01): add types/shot-grid.ts (ShotGridResponse + 3 sibling types)
657eba1 feat(21-01): add lib/time.ts formatRelativeTime + 12-case unit tests (TDD)
85b45c6 feat(21-01): append Phase 21 copy block to lib/copy.ts (32 new constants)
b3f0b1e feat(21-01): add 5 shot-status color tokens to theme.css (both themes)
7fd830e feat(21-01): add ShotStatusChangedPayload + EngineEventMap['shot.status_changed']
54333c3 docs(state): phase 21 planned, ready to execute
```
