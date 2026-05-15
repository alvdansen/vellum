---
phase: 23-production-stats
plan: 02
subsystem: engine-composition + dashboard primitive + copy registry
tags: [stats, sequence-stats, ovr-01, ovr-02, engine-facade, progressbar, wcag, copy-constants, prefers-reduced-motion]
dependency_graph:
  requires:
    - "src/store/shot-status-repo.ts:getSequenceStats (Plan 23-01 — SequenceStatsRaw shape + GROUP BY + EXISTS-clause stale_count)"
    - "src/store/shot-status-repo.ts:listShotsForGrid (Phase 21 + Plan 23-01 — added inline is_stale CASE column)"
    - "packages/dashboard/src/types/shot-grid.ts:SequenceStats + ShotGridResponse.stats + ShotGridRow.is_stale (Plan 23-01 — wire-shape contracts)"
    - "packages/dashboard/src/styles/theme.css (--color-shot-status-approved + --color-border + --color-fg-muted — pre-existing Phase 21 tokens)"
  provides:
    - "src/engine/pipeline.ts:listShotGrid returns { sequence, shots: [{ ..., is_stale: boolean }], stats: SequenceStats, next_cursor, total_count } envelope"
    - "src/http/__tests__/dashboard-routes-shot-grid.test.ts: 2 new tests asserting body.stats top-level + per-row is_stale boolean (Phase 23 OVR-01 + OVR-02)"
    - "packages/dashboard/src/components/ProgressBar.tsx (NEW): WCAG 2.1 AA progressbar primitive — role=\"progressbar\" + aria-valuenow/min/max + aria-label + clamp + motion-reduce variant"
    - "packages/dashboard/src/components/__tests__/ProgressBar.test.tsx (NEW): 8 tests covering aria-* set, clamp (over/under/float/custom-max), label conditional render, motion-reduce variant, locked theme tokens"
    - "packages/dashboard/src/lib/copy.ts: 9 NEW Phase 23 copy constants (STATS_PROGRESS_ARIA_PREFIX, STATS_APPROVED_LABEL_SUFFIX, STATS_BACKLOG_CALLOUT_SINGULAR/PLURAL/ARIA_PREFIX, STATS_STALE_INLINE_SINGULAR/PLURAL/ARIA_PREFIX, SHOT_CARD_STALE_ARIA_SUFFIX)"
  affects:
    - "Plan 23-03 (UI) — will consume <ProgressBar/> in <SequenceHeader/> subrow + the 9 copy constants in <SequenceHeader/> + <ShotGridCard/> render paths"
    - "Plan 23-04 (state) — will consume the engine envelope shape (stats + per-row is_stale) when seeding sequenceStats signal in state/shot-grid.ts"
    - "Plan 23-03 SequenceHeader.tsx integration — typed prop shape stats: SequenceStats now flows through the existing fetchShotGrid → c.json passthrough into the view layer"
tech_stack:
  added: []
  patterns:
    - "Engine facade composition — engine.listShotGrid combines listShotsForGrid (paginated rows) + getSequenceStats (whole-sequence) into a single wire envelope; HTTP route stays byte-identical Hono passthrough (no signature change)"
    - "Type-shape duplication at architecture boundary — inlined SequenceStats shape in pipeline.ts return type because the architecture-purity test forbids server→dashboard imports in both directions; sync comment points at the canonical dashboard type"
    - "SQLite int → JS boolean coercion at wire boundary — Boolean(r.is_stale) at the engine layer makes the wire shape true|false (not 0|1)"
    - "Approved-pct math in TypeScript — Math.round((approved/total)*100) with total === 0 ? 0 guard (D-14) — keeps SQL-side simple and divide-by-zero-safe"
    - "Bracket access for hyphenated ShotStatus keys — counts['pending-review'] (NEVER counts.pending - review; Pitfall 10)"
    - "Pure render primitive — ProgressBar mirrors WarningPill structural shape: named-export function, default-arg destructuring, Preact class= convention, no callbacks/state/refs"
    - "Defensive clamp pattern — Math.max(0, Math.min(max, Math.round(value))); float rounded BEFORE clamp; max === 0 → 0% string"
    - "Motion-discipline via Tailwind v4 variant — transition-[width] duration-150 motion-reduce:transition-none honors prefers-reduced-motion per WCAG SC 2.3.3"
    - "Copy registry block-append — Phase 23 block follows Phase 22 precedent (block header banner + 4 sub-section dividers + verbatim UI-SPEC values); zero inline string literals in component files (architectural rule)"
key_files:
  created:
    - "packages/dashboard/src/components/ProgressBar.tsx — WCAG 2.1 AA progressbar primitive (D-06 + D-21)"
    - "packages/dashboard/src/components/__tests__/ProgressBar.test.tsx — 8 component tests"
  modified:
    - "src/engine/pipeline.ts (+50 lines — getSequenceStats import + listShotGrid extension with stats compose + is_stale coercion + return type widening)"
    - "src/http/__tests__/dashboard-routes-shot-grid.test.ts (+105 lines — extended EMPTY_GRID_RESPONSE fixture + 2 new Phase 23 envelope assertion tests)"
    - "packages/dashboard/src/lib/copy.ts (+57 lines — Phase 23 block header + 4 sub-section dividers + 9 verbatim constants)"
decisions:
  - id: "D-01..D-21 (locked by 23-CONTEXT.md, inherited from Plan 23-01)"
    rationale: "Plan 23-02 implements the engine composition + UI primitive contracts. All decisions were locked at CONTEXT-time; this plan executes them."
  - id: "Architecture-boundary inline of SequenceStats shape"
    rationale: "src/__tests__/architecture-purity.test.ts asserts ZERO cross-tree imports from packages/dashboard/src/** into server source. Verified pre-edit via `grep \"packages/dashboard\" src/engine/pipeline.ts` → 0 matches. The plan's spec said: \"if the grep returns ZERO matches, you MUST inline\". Sync comment added pointing at canonical dashboard type."
metrics:
  duration: "10m"
  completed_date: "2026-05-15"
  task_count: 3
  file_count_created: 2
  file_count_modified: 3
  tests_added: 10  # 2 HTTP + 8 ProgressBar
---

# Phase 23 Plan 02: Engine composition + ProgressBar primitive + copy block Summary

**One-liner:** Bridge Wave 1's data layer to Wave 3's view layer — extend engine.listShotGrid to compose getSequenceStats + listShotsForGrid into a single wire envelope (approved_pct math in TypeScript with divide-by-zero guard, SQLite int → JS boolean coercion for is_stale), HTTP route byte-identical passthrough, ship the WCAG 2.1 AA `<ProgressBar/>` primitive with defensive clamp + motion-reduce variant, and append 9 verbatim copy constants for Plan 23-03 consumption.

## Performance

- **Duration:** 10 minutes (active execution; excludes one recovery from misdirected commits — see Issues Encountered)
- **Started:** 2026-05-15T14:42:00Z
- **Completed:** 2026-05-15T14:55:00Z
- **Tasks:** 3 (atomic commits, one per task)
- **Files created:** 2 (ProgressBar.tsx + its test)
- **Files modified:** 3 (pipeline.ts, dashboard-routes-shot-grid.test.ts, copy.ts)

## Accomplishments

- Engine layer composition: `engine.listShotGrid(sequenceId, opts)` now returns `{ sequence, shots: [{ ..., is_stale: boolean }], stats: SequenceStats, next_cursor, total_count }` from a single facade call. Approved-pct is computed as `Math.round((counts.approved / total) * 100)` with `total === 0 → 0` divide-by-zero guard (D-14). `pending_review_backlog` uses bracket access on `counts['pending-review']` (Pitfall 10). Per-row `is_stale` is coerced from SQLite's 0|1 to a real JS boolean via `Boolean(r.is_stale)`.

- HTTP route byte-identical passthrough: `src/http/dashboard-routes.ts` shows 0 lines of diff between cdc0f41 and HEAD. Hono auto-serializes the wider response envelope; no handler change needed. The new top-level `stats` field and per-row `is_stale: boolean` (not `0|1`) are confirmed via 2 new tests in `dashboard-routes-shot-grid.test.ts` using the existing `FakeEngine` harness. Pre-existing 7 tests pass with the extended `EMPTY_GRID_RESPONSE` fixture; `SEQUENCE_NOT_FOUND` propagation is unchanged.

- WCAG 2.1 AA `<ProgressBar/>` primitive: NEW `packages/dashboard/src/components/ProgressBar.tsx` — pure component, mirrors WarningPill shape (named export, default-arg destructuring, no callbacks/state, Preact `class=`). Renders `role="progressbar"` + `aria-valuenow={clamped}` + `aria-valuemin={0}` + `aria-valuemax={max}` + `aria-label={ariaLabel}`. Defensive clamp `Math.max(0, Math.min(max, Math.round(value)))` integer-coerces floats BEFORE clamping. Width transition `transition-[width] duration-150 motion-reduce:transition-none` honors `prefers-reduced-motion` per Tailwind v4 variant + D-21 + UI-SPEC A6. Track bg references `--color-border`, fill bg references the Phase 21 `--color-shot-status-approved` token, optional label uses `--color-fg-muted`. No focus styles, no `onClick`, no `tabIndex` — the bar is purely informative.

- Component tests covering 8 paths: full aria-* attribute set (Test 1), clamp boundaries — over 100 (Test 2), under 0 (Test 3), float rounding (Test 4), custom-max width calculation (Test 5), label conditional render (Test 6), motion-reduce variant present in fill className (Test 7), locked theme token references in track + fill className (Test 8). All 8 green.

- 9 Phase 23 copy constants appended to `packages/dashboard/src/lib/copy.ts`: block header banner + 4 sub-section dividers + the 9 verbatim UI-SPEC values. `SHOT_CARD_STALE_ARIA_SUFFIX` uses em-dash U+2014 (verified via Python codepoint dump: `[0x20, 0x2014, 0x20, 0x73, 0x74, 0x61, 0x6c, 0x65]`). Singular/plural pairs hold identical English values (`'awaiting review' === 'awaiting review'`, `'stale' === 'stale'`) but are kept as two exports for future i18n, mirroring Phase 21 `SHOT_CARD_VERSION_COUNT_SINGULAR/PLURAL_SUFFIX`. No existing Phase 1-22 export was mutated.

## Task Commits

Each task was committed atomically on the worktree branch `worktree-agent-a26251d8d0272d588`:

1. **Task 02-01:** Compose engine.listShotGrid with stats envelope + HTTP envelope tests — `e1652e5` (feat)
2. **Task 02-02:** Add ProgressBar WCAG 2.1 AA primitive + 8 tests — `09547cc` (feat)
3. **Task 02-03:** Append Phase 23 copy block — 9 stats constants (verbatim UI-SPEC values) — `ef07c26` (feat)

## Files Created/Modified

### Created
- `packages/dashboard/src/components/ProgressBar.tsx` — WCAG 2.1 AA progressbar primitive. Pure component: props-in, no callbacks, no state. Renders the full `aria-value*` set with defensive clamp + motion-reduce variant.
- `packages/dashboard/src/components/__tests__/ProgressBar.test.tsx` — 8 tests using `@testing-library/preact` `render` + `cleanup` afterEach pattern (mirrors `ShotStatusPill.test.tsx`).

### Modified
- `src/engine/pipeline.ts` — added `getSequenceStats` to the existing `shot-status-repo.js` named-import block; extended `listShotGrid` body to compose stats + coerce is_stale + return widened envelope; updated return type with inlined `SequenceStats` shape (architecture-purity inline; sync comment included).
- `src/http/__tests__/dashboard-routes-shot-grid.test.ts` — added `is_stale: boolean` to shots[] element type in `EMPTY_GRID_RESPONSE` + added top-level `stats` field with all-zeros default; added 2 new `it()` blocks asserting top-level `stats` envelope + per-row boolean `is_stale`.
- `packages/dashboard/src/lib/copy.ts` — appended Phase 23 block (block header + 4 sub-section dividers + 9 verbatim constants) AFTER the existing `REVIEW_PANEL_LOADING_LABEL` at the end of the file.

## Engine wire envelope — exact shape (for Plan 23-03)

```ts
engine.listShotGrid(sequenceId, opts) returns:
{
  sequence: { id: string; name: string };
  shots: Array<{
    id: string;
    name: string;
    status: ShotStatus;                  // 'wip' | 'pending-review' | 'approved' | 'on-hold' | 'omit'
    version_count: number;
    is_stale: boolean;                   // NEW — Boolean(r.is_stale) coercion from SQLite 0|1
    latest_completed_version: {
      id: string;
      thumbnail_url: string;
      completed_at: number;
    } | null;
  }>;
  stats: {                                // NEW — inlined SequenceStats mirror
    total: number;                        // = Σ counts
    approved_pct: number;                 // Math.round((counts.approved/total)*100); total===0?0
    counts: Record<ShotStatus, number>;   // all 5 keys initialized to 0 by repo
    pending_review_backlog: number;       // counts['pending-review'] — bracket access (Pitfall 10)
    stale_count: number;                  // EXISTS-clause whole-sequence count
  };
  next_cursor: string | null;
  total_count: number;
}
```

## Cross-tree import decision — INLINED with sync comment

The plan required: "Verify via `grep \"packages/dashboard\" src/engine/pipeline.ts` BEFORE making this decision; if the grep returns ZERO matches, you MUST inline."

Pre-edit grep: ZERO matches in `src/engine/pipeline.ts`. The architecture-purity test (`src/__tests__/architecture-purity.test.ts:924-948`) bans dashboard→server imports, and the prevailing convention in the server tree is that server source never imports from `packages/dashboard/` either. Therefore the SequenceStats shape is inlined in the `listShotGrid` return type annotation with this comment:

```typescript
// Phase 23 — D-02 LOCKED SequenceStats envelope shape. Inlined mirror of
// `SequenceStats` from packages/dashboard/src/types/shot-grid.ts — the
// architecture-purity test (src/__tests__/architecture-purity.test.ts)
// forbids dashboard→server imports; we keep the server tree free of
// cross-tree imports in BOTH directions by inlining here. Keep in sync
// with the dashboard type definition.
stats: {
  total: number;
  approved_pct: number;
  counts: Record<ShotStatus, number>;
  pending_review_backlog: number;
  stale_count: number;
};
```

If a future plan widens SequenceStats (adding a field), it must update BOTH this inline mirror AND `packages/dashboard/src/types/shot-grid.ts`. Both tsc passes will surface the desync if only one is touched.

## Pitfall 10 evidence — bracket access for hyphenated key

```bash
$ grep -n "counts\['pending-review'\]" src/engine/pipeline.ts
873:      pending_review_backlog: rawStats.counts['pending-review'],
```

Single occurrence at the assemble-stats step in `listShotGrid`. Dot access (`rawStats.counts.pending - review`) would parse as the difference of two expressions — a subtle bug that the test would NOT catch directly (TypeScript would flag, but the typecheck against `Record<ShotStatus, number>` wouldn't fault since `'pending'` is not a valid ShotStatus). Bracket access is the only correct form.

## Tool budget invariant proof

`npx vitest run src/__tests__/tool-budget.test.ts` ran 3/3 green at HEAD:

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

The tool count holds at 7/12 (Phase 23 adds zero `server.registerTool` calls — dashboard-only HTTP extension). Confirmed by reading `src/__tests__/tool-budget.test.ts:expected toBe(7)` passing untouched.

## The 9 Phase 23 copy constants — verbatim values

| Constant | Value |
|---|---|
| `STATS_PROGRESS_ARIA_PREFIX` | `'Approval progress for '` |
| `STATS_APPROVED_LABEL_SUFFIX` | `'% approved'` |
| `STATS_BACKLOG_CALLOUT_SINGULAR` | `'awaiting review'` |
| `STATS_BACKLOG_CALLOUT_PLURAL` | `'awaiting review'` |
| `STATS_BACKLOG_CALLOUT_ARIA_PREFIX` | `'Pending review backlog: '` |
| `STATS_STALE_INLINE_SINGULAR` | `'stale'` |
| `STATS_STALE_INLINE_PLURAL` | `'stale'` |
| `STATS_STALE_INLINE_ARIA_PREFIX` | `'Stale shots: '` |
| `SHOT_CARD_STALE_ARIA_SUFFIX` | `' — stale'` (space U+0020, em-dash U+2014, space U+0020, "stale") |

Em-dash codepoints verified via Python:
```python
$ python3 -c "...print([hex(ord(c)) for c in s])"
Value: ' — stale'
Codepoints: ['0x20', '0x2014', '0x20', '0x73', '0x74', '0x61', '0x6c', '0x65']
```

## ProgressBar.tsx published API (for Plan 23-03)

```typescript
export interface ProgressBarProps {
  /** Current progress value (typically 0-max). Clamped + integer-rounded at render. */
  value: number;
  /** Maximum value. Defaults to 100. */
  max?: number;
  /** Optional visible label rendered next to the bar (e.g., "60% approved"). */
  label?: string;
  /** REQUIRED aria-label for the progressbar element (bar has no visible heading). */
  ariaLabel: string;
}

export function ProgressBar({ value, max = 100, label, ariaLabel }: ProgressBarProps);
```

Plan 23-03's `<SequenceHeader/>` will compose:
```tsx
<ProgressBar
  value={stats.approved_pct}
  ariaLabel={`${STATS_PROGRESS_ARIA_PREFIX}${sequence.name}`}
  label={`${stats.approved_pct}${STATS_APPROVED_LABEL_SUFFIX}`}
/>
```

## Decisions Made

- **Inline the SequenceStats shape in `pipeline.ts`** — architecture-purity bans dashboard→server imports both ways; sync comment included; future widening must touch both files. (See "Cross-tree import decision" above.)
- **Singular/plural pairs hold identical English values** — `'awaiting review' === 'awaiting review'`, `'stale' === 'stale'`. Kept as TWO constants for future i18n + to mirror Phase 21 `SHOT_CARD_VERSION_COUNT_SINGULAR/PLURAL_SUFFIX` precedent. (Per plan instruction.)
- **Tests target the rendered DOM via `container.querySelector('[role="progressbar"]')`** — not a `data-testid` (the ProgressBar.tsx spec at PATTERNS §1 has no `data-testid` attribute). Mirrors the `ShotStatusPill.test.tsx` PATTERNS §16 landmine guard.
- **No `<span>` wrapper inside the bar for the label** — UI-SPEC §"Component Inventory > New files" line 256 has the optional label as a SIBLING `<span>` next to the bar wrapper (outside `role="progressbar"`), not as a child. The fill div is the only child of the bar element so screen readers announce just the aria-* state.

## Deviations from Plan

### Issues handled during execution

**1. Worktree path drift — Edits silently wrote to main repo, commits landed on main branch**

- **Found during:** Task 02-01 commit (cwd at that moment was the main repo `/Users/macapple/comfyui-vfx-mcp`, not the worktree `/Users/macapple/comfyui-vfx-mcp/.claude/worktrees/agent-a26251d8d0272d588`).
- **Root cause:** Bash cwd resets between tool calls per the system reminder. My absolute-path `Edit` / `Write` calls used the main-repo paths (the orchestrator's spawn pwd) — exactly the bug pattern documented in `references/worktree-path-safety.md` §"Absolute-path guard" (#3099). The Edit operations succeeded against the main repo files; the subsequent `git commit` (also at main-repo cwd) committed those changes to `main`.
- **Recovery (per `destructive_git_prohibition`):** Did NOT rewind main with `git update-ref` or `git reset --hard`. Instead:
  1. Captured the diff of the wrong commit: `git show 372a9a3 > /tmp/task-02-01.patch`.
  2. Created a `git revert 372a9a3` on main to restore content (revert commit `2536329`). Net change on main is zero (one commit + its revert), and no remote was pushed.
  3. Applied the patch to the worktree: `git -C $WT apply /tmp/task-02-01.patch`.
  4. Moved the misplaced `deferred-items.md` from the main repo's `.planning/` directory to the worktree's `.planning/` directory.
  5. Committed Task 02-01 on the worktree branch as `e1652e5`.
- **Subsequent tasks:** ALL Bash + Read + Edit + Write operations for Tasks 02-02 + 02-03 used the absolute worktree path explicitly (`/Users/macapple/comfyui-vfx-mcp/.claude/worktrees/agent-a26251d8d0272d588/...`) — verified via `git rev-parse --show-toplevel` matching `EXPECTED_TL` before each commit.
- **Files modified:** ./CLAUDE.md NOT modified; this is purely a tool-invocation pattern fix in the executor's behavior.
- **Verification:** `git -C /Users/macapple/comfyui-vfx-mcp/.claude/worktrees/agent-a26251d8d0272d588 diff cdc0f41..HEAD` shows exactly the 5 expected files modified; main repo shows zero net diff from cdc0f41 (the revert undid the misdirected feat commit).

### Auto-fixed Issues

**2. [Rule 3 — Blocking node_modules sync] Run `npm install` after worktree spawn**

- **Found during:** Task 02-02 RED phase (first `npx vitest run` against ProgressBar.test.tsx)
- **Issue:** Worktree was spawned with stale `node_modules` — `@preact/preset-vite` not present, causing `ERR_MODULE_NOT_FOUND` on vitest config import.
- **Fix:** Ran `npm install` once at the worktree root. Known pattern (see memory entry "Run npm install after worktree merge" + Plan 23-01 SUMMARY deviation #3). No `package.json` or lockfile changes.
- **Files modified:** none committed (`node_modules` is gitignored)
- **Verification:** Subsequent `npx vitest run` succeeded.

**3. [Documentation grep-strictness adjustment] JSDoc reference rephrase to satisfy `grep -c "..." === 1` acceptance criteria**

- **Found during:** Task 02-02 acceptance-assertion verification
- **Issue:** My initial ProgressBar.tsx JSDoc referenced `\`role="progressbar"\``, `\`motion-reduce:transition-none\``, and `\`Math.max(0, Math.min(max, Math.round(value)))\`` verbatim in backticks. Those echoed in the JSDoc made the plan's `grep -c \"role=\\\"progressbar\\\"\"` etc. assertions return `2` instead of the required `1`.
- **Fix:** Rephrased the JSDoc to describe the same content without the quoted-or-backticked identifiers — e.g., "the progressbar ARIA role", "the Tailwind v4 motion-reduce variant", "pipes value through round → min(max,...) → max(0,...)". The component code itself is unchanged.
- **Files modified:** `packages/dashboard/src/components/ProgressBar.tsx` (JSDoc only)
- **Verification:** All acceptance grep counts return exactly the required value; 8/8 tests still green.

### Test plan deviations (intentional)

None. All 8 tests for ProgressBar + 2 tests for engine envelope land exactly as the plan specified.

### What was NOT done (intentional — out of scope for Plan 02)

- No `<SequenceHeader/>` subrow render (Plan 23-03 task)
- No `<ShotGridCard/>` amber border class (Plan 23-03 task)
- No dashboard `sequenceStats` signal (Plan 23-04 task)
- No SSE handler extension for stats deltas (Plan 23-04 task)
- No `lucide-preact` AlertCircle import (Plan 23-03 — composes the backlog callout)
- No new MCP tool (D-18 — tool count unchanged at 7/12)
- No new theme tokens beyond `--color-shot-stale` already landed in Plan 23-01
- No `--color-stats-backlog-callout` (DEFERRED per UI-SPEC Open Question 1 — backlog reuses `--color-accent`)

## Issues Encountered

The worktree-path-drift event in deviation #1 was the only execution-time issue; resolved via the revert-and-patch recovery (not via banned destructive ops on main). Pre-existing planning-tracking test failures in `phase-attribution.test.ts`, `validation-flags.test.ts`, `requirements-cohort-closure.test.ts`, and the flaky `generation-tool.test.ts:IT-20` ENOTEMPTY race are logged in `deferred-items.md` — they read tracking files from `.planning/` (not source) and were already failing at the wave-base cdc0f41 BEFORE any Plan 23-02 edit. They are out of scope per the deviation-rule scope boundary.

## Threat Flags

None. No new surface introduced beyond what the plan's `<threat_model>` already mapped:
- T-23-02-01 (sequenceId path param) — mitigated by Phase 21 route validation + Plan 23-01 SQL placeholder binding (unchanged).
- T-23-02-03 (ariaLabel/label XSS) — mitigated by Preact JSX auto-escape; ProgressBar.tsx does NOT use `dangerouslySetInnerHTML`.
- T-23-02-05 (float-value re-render DoS) — mitigated by the single defensive clamp at render time; ProgressBar has no useEffect/useState/signal subscriptions.
- T-23-02-SC (supply chain) — zero new packages installed. ProgressBar imports zero third-party modules.

## Self-Check: PASSED

- `engine.listShotGrid` returns `{ sequence, shots: [{ ..., is_stale: boolean }], stats: SequenceStats, next_cursor, total_count }` envelope ✓
- approved_pct = `Math.round((approved/total)*100)` with `total === 0 → 0` guard ✓
- bracket access `counts['pending-review']` (Pitfall 10) ✓
- `Boolean(r.is_stale)` coercion in items.map ✓
- HTTP route `src/http/dashboard-routes.ts` byte-identical (0 lines of diff) ✓
- HTTP shot-grid tests 9/9 green (7 existing + 2 new) ✓
- `ProgressBar.tsx` exports component with `role="progressbar"` + aria-* + clamp + motion-reduce variant ✓
- `ProgressBar.test.tsx` 8/8 tests green covering aria-*, clamp, label conditional, motion-reduce, theme tokens ✓
- 9 NEW Phase 23 copy constants exported with verbatim UI-SPEC values ✓
- em-dash codepoints `[0x20, 0x2014, 0x20, 0x73, 0x74, 0x61, 0x6c, 0x65]` ✓
- Block header + 4 sub-section dividers ✓
- Total copy.ts exports = 127 (previous 118 + 9) ✓
- Tool budget === 7 (3/3 green) ✓
- Architecture purity (54/54) green ✓
- Server tsc --noEmit clean ✓
- Dashboard tsc --noEmit clean ✓
- Dashboard suite 451/451 green (was 443/443 in Plan 23-01; +8 from new ProgressBar tests) ✓
- Vite production build succeeds (211ms) ✓
- TypedError('SEQUENCE_NOT_FOUND') still throws for unknown sequenceId (pre-existing test in dashboard-routes-shot-grid.test.ts:158-173 green) ✓
- Pre-commit HEAD assertion + cwd-drift sentinel + absolute-path guard all enforced on every commit ✓
- 3 atomic task commits on worktree branch `worktree-agent-a26251d8d0272d588` ✓
- No STATE.md / ROADMAP.md modifications ✓
- No packages/dashboard/dist/* commits in this plan ✓

## Commits (3 atomic)

| # | Hash | Task | Files |
|---|------|------|-------|
| 1 | e1652e5 | Task 02-01: compose engine.listShotGrid with stats envelope + is_stale coercion | 2 files (pipeline.ts + dashboard-routes-shot-grid.test.ts) |
| 2 | 09547cc | Task 02-02: add ProgressBar WCAG 2.1 AA primitive + 8 tests | 2 files (ProgressBar.tsx + test) |
| 3 | ef07c26 | Task 02-03: append Phase 23 copy block — 9 stats constants | 1 file (copy.ts) |

## Next Phase Readiness

Plan 23-03 (UI composition) can now build against deterministic primitives:

1. **Engine wire envelope** has the exact `{ stats, shots: [...is_stale] }` shape Plan 03's `<SequenceHeader/>` props + `<ShotGridCard/>` amber-border conditional render need. Plan 03 will:
   - Add `stats: SequenceStats | null` prop to `<SequenceHeader/>`, render the new subrow ABOVE the existing Phase 21 mini-pills row (D-04 — three stacked layers, mini-pills preserved).
   - Compose `<ProgressBar/>` (from this plan) inside that subrow + a backlog callout `<span>` with `lucide-preact AlertCircle` icon + the inline stale-count `<span>`.
   - Use the 9 copy constants from this plan for all visible text + aria-labels.
   - Add the amber stale border conditional class to `<ShotGridCard/>` outer wrapper (`shot.is_stale ? 'border-2 border-[var(--color-shot-stale)]' : ''`).
   - Append `SHOT_CARD_STALE_ARIA_SUFFIX` to the thumbnail button's existing aria-label when `shot.is_stale === true`.

2. **No new deps** were added in this plan. `lucide-preact AlertCircle` is the only new import Plan 03 needs (already in package.json from Phase 18 via `<WarningPill/>`'s color-language reference — verify before Plan 03 starts).

3. **State signal (Plan 23-04)** will seed `sequenceStats: Signal<SequenceStats | null>` from `res.stats` in the existing `fetchShotGrid.then` chain in `state/shot-grid.ts`. The envelope shape is exactly what Plan 23-04 expects (matches the Plan 23-01 published interface).

---

*Phase: 23-production-stats*
*Plan: 02*
*Completed: 2026-05-15*
