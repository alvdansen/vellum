# Phase 23: Production Stats - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 23 adds a server-computed sequence stats widget on top of every `<ShotGridView/>` and a per-shot stale indicator on every `<ShotGridCard/>`. Stats include total shots, % approved (rendered as a horizontal progress bar), pending-review backlog (rendered as a distinct callout), per-status counts (preserves the Phase 21 D-14 mini-pills row), and a stale-shot count. Stats are computed server-side via a single `GROUP BY` query over the entire sequence (whole-sequence, NOT the paginated `shots[]` window) — no N+1, no per-shot subquery. The widget appears in the existing `<SequenceHeader/>` as a NEW top row INSIDE the header, ABOVE the existing mini-pills row (Phase 21 D-14 mini-pills preserved as the counts layer; new row carries % bar + backlog callout + stale count). The amber stale treatment is a 1-2px amber BORDER around the entire `<ShotGridCard/>` (no separate icon, no badge — full-card outline for at-a-glance grid scanning); applies only when the server-computed `is_stale` flag is true. Staleness is computed at grid query time from `versions.completed_at` (per OVR-02: status ∈ ('wip','pending-review') AND no completed version in last 14 days; zero-completed-versions case decided in Claude's discretion below). The `STALE_SHOT_DAYS = 14` constant already exists at `src/store/shot-status-repo.ts:54`. SSE-driven counter updates flow via `shot.status_changed` events: a new `sequenceStats` signal is seeded from the server response on each `fetchShotGrid` and mutated incrementally by `onShotStatusChanged` (decrement `counts[fromStatus]`, increment `counts[toStatus]`, recompute `approved_pct` reactively). No full re-fetch on status change. Tool count holds at 7/12 (zero new MCP tools — HTTP-only feature, Phase 21/22 precedent). Out of scope: hover-to-scrub stale cards (Phase 24 POL-01), sort persistence (Phase 24 POL-03), sprite scrubbing on stale (Phase 24), multi-sequence rollup, stale-shot list / drill-in view, "snooze stale" supervisor action, stale-shot Slack/email digests.

</domain>

<decisions>
## Implementation Decisions

### Endpoint shape & payload
- **D-01:** Extend the existing `GET /api/sequences/:id/shot-grid` endpoint with TWO new top-level response fields: `stats` (sequence-wide stats, computed independently of `shots[]` pagination) and per-row `is_stale: boolean` on each `ShotGridRow`. Repo layer has two functions composed in the engine: `engine.listShotGrid()` keeps doing exactly what it does (paginated rows with `latest_completed_version` nested); a new `engine.getSequenceStats(sequenceId)` runs the single GROUP BY for stats. Engine composes both into the response envelope, route stays a thin Hono handler. One HTTP roundtrip, one signal lifecycle, explicit whole-sequence semantics for `stats`, type changes confined to `packages/dashboard/src/types/shot-grid.ts` + the existing `dashboard-routes-shot-grid.test.ts` harness.
- **D-02:** `stats` envelope shape (LOCKED):
  ```ts
  interface SequenceStats {
    total: number;                                // whole-sequence shot count
    approved_pct: number;                          // 0-100 integer
    counts: Record<ShotStatus, number>;            // wip|pending-review|approved|on-hold|omit
    pending_review_backlog: number;                // === counts['pending-review']; emitted explicitly for clarity
    stale_count: number;                           // whole-sequence stale shots
  }
  ```
  Mirrors the per-row `version_count` snake_case convention (Phase 21 D-13). Emitted `pending_review_backlog` is duplicative of `counts['pending-review']` by design — separates the "backlog callout" data source from the count-pills data source so the components stay independent.
- **D-03:** `ShotGridRow` gains one new field: `is_stale: boolean`. Server computes per-row at query time using the existing `STALE_SHOT_DAYS` constant. The `latest_completed_version.completed_at` is already on the row (Phase 21 D-13) — the dashboard reads BOTH `is_stale` (for the initial border render) AND `latest_completed_version.completed_at` (when re-deriving on SSE; see D-12).

### Stats widget composition & visual hierarchy
- **D-04:** `<SequenceHeader/>` grows a NEW top row INSIDE the existing component (Phase 21 D-14 mini-pills row PRESERVED below, NOT replaced). Header now renders three stacked layers: (1) sequence name + chevron toggle (existing), (2) NEW stats row with [progress bar + % approved] + [pending-review backlog callout] + [stale count], (3) existing per-status mini-pills row. Chevron collapses ALL three rows. No new mount point; no separate `<SequenceStatsWidget/>` component sitting between `<ShotGridFilterBar/>` and `<SequenceHeader/>`. The implementation stays inside `SequenceHeader.tsx` — adds props for the new stats payload and renders an inline subrow.
- **D-05:** Headline stats visual treatment: % approved is a horizontal progress bar (fills left→right to the percentage) with the numeric value rendered AS A LABEL adjacent to or overlaid on the bar (e.g., `[▓▓▓▓▓▓░░░░] 60% approved`). Pending-review backlog renders as a distinct CALLOUT pill (e.g., `! 3 awaiting review`) in an accent color visually separated from the per-status mini-pills below; uses a different background token from the Phase 21 mini-pill set (recommend a new `--color-stats-backlog-callout` or reuse `--color-accent`). Stale count renders inline next to the backlog callout (e.g., `⚠ 1 stale`) when `stale_count > 0`; hidden entirely when zero. Per-status mini-pills row below remains exactly as Phase 21 D-14 built it.
- **D-06:** Progress bar accessibility: `role="progressbar"`, `aria-valuenow={approved_pct}`, `aria-valuemin=0`, `aria-valuemax=100`, `aria-label="Approval progress for {sequenceName}"`. Bar fill color reuses `--color-shot-status-approved` (green family from Phase 21 theme.css); bar track uses `--color-border` or `--color-bg-hover`. WCAG 2.1 AA: bar text label ≥ 4.5:1 contrast; UI components ≥ 3:1.

### Stale indicator on `<ShotGridCard/>`
- **D-07:** Amber 1-2px BORDER around the entire `<ShotGridCard/>` when `is_stale === true`. No separate icon, no badge, no inline "Stale" text — full-card outline only. Maximizes glanceability when supervisor scans the grid; minimal pixel cost; cooperates with the existing 16:9 thumbnail layout without competing for corner real estate (top-right is Phase 22 D-10 hover Approve icon).
- **D-08:** Use a NEW theme token `--color-shot-stale` distinct from `--color-shot-status-pending-review` (Phase 21 amber `#fbbf24`). Recommended values: light theme `#f59e0b` (amber-500, more saturated/orange-leaning) and dark theme `#fbbf24` (amber-400 reused). The distinction matters because a pending-review shot can ALSO be stale — using the same hex would visually collapse two semantic states. WCAG 2.1 AA: the border alone is not the only signal (status pill in the name row continues to encode WIP/pending-review status with text + color); the border adds a redundant orthogonal cue.
- **D-09:** Border coexistence with focus state, omit state, and the WarningPill error state:
  - `focus-visible` ring uses `var(--color-accent)` and currently lives on the inner buttons (thumbnail, status pill, quick-approve). The amber stale border is on the OUTER `<div class="group relative">` wrapper and does not conflict — focus rings still render on top of inner elements.
  - The `omit` opacity-40 wrapper (Phase 22 D-13) wraps the entire card body. When a shot is BOTH `omit` AND stale: `is_stale` is only true when status ∈ ('wip','pending-review') per OVR-02, so an omit shot is by definition NOT stale. No coexistence problem.
  - The inline `<WarningPill/>` for quick-approve failure (Phase 22 D-12) renders pinned to the card's bottom. The amber stale border is on the outer wrapper; the warning pill is absolutely-positioned inside the card body. No conflict.

### SSE-driven counter updates (OVR-03)
- **D-10:** A new `sequenceStats: Signal<SequenceStats | null>` is added to `packages/dashboard/src/state/shot-grid.ts`. Seeded from `fetchShotGrid` response (`res.stats`); `null` represents the pre-fetch / no-grid-loaded state. Lives alongside the existing `shotGrid`, `statusFilter`, `showOmitted` signals — same per-domain co-location convention Phase 21 established.
- **D-11:** `onShotStatusChanged` (state/shot-grid.ts:160) is EXTENDED — not replaced — to apply stats deltas on every matching event. Algorithm:
  ```
  if sequenceStats is null OR cross-sequence event: return
  decrement stats.counts[fromStatus] (clamped at 0)
  increment stats.counts[toStatus]
  recompute stats.pending_review_backlog from stats.counts['pending-review']
  recompute stats.approved_pct from stats.counts['approved'] / stats.total
  apply stale-count delta per D-12
  emit new sequenceStats.value (immutable replace)
  ```
  Existing per-shot row update (Phase 21 D-22) stays intact; this just adds the stats-signal mutation. The existing cross-sequence guard (`current.sequence.id !== payload.sequenceId`) reuses for the new stats path too.
- **D-12:** Stale-count delta requires knowing both the prior `is_stale` state (the row in `shotGrid.value.shots[]`) AND the post-transition state. Algorithm:
  ```
  Find the matching shot in shotGrid.value.shots[] (by shot.id)
  If not in buffer (paginated beyond): leave stale_count unchanged (best-effort; server snapshot stays accurate until next fetch)
  If in buffer:
    wasStale = shot.is_stale  // server-supplied, possibly delta-updated by prior events
    isStaleNow =
      toStatus IN ('wip','pending-review')
      AND latest_completed_version !== null   (per D-15 grace period)
      AND (Date.now() - latest_completed_version.completed_at) > STALE_SHOT_DAYS * 86_400_000
    If wasStale && !isStaleNow: stale_count--
    If !wasStale && isStaleNow: stale_count++
    Update the row's is_stale flag for next event
  ```
  `STALE_SHOT_DAYS` is imported as a dashboard-side constant mirroring the engine value (or hoisted to a shared types module — Phase 23 picks whichever the existing precedent supports). Document the "best-effort outside the buffer" caveat in the signal file as a comment.

### Claude's Discretion
- **D-13:** Endpoint shape choice (Q1 — user invoked autonomous mode): selected Option C ("single endpoint, both top-level"). Rationale: matches OVR-01 "single GROUP BY query" without ambiguity; explicit whole-sequence semantics for stats; one roundtrip preserves the existing `fetchShotGrid` + signal lifecycle; types and tests stay co-located with the existing shot-grid contract. The repo-layer split into `listShotGrid()` (paginated rows) + `getSequenceStats()` (whole-sequence GROUP BY) preserves the single-purpose-function discipline.
- **D-14:** Sequence-wide GROUP BY query for stats (REQ OVR-01 lock): single `SELECT status, COUNT(*) FROM shots WHERE sequence_id = ? GROUP BY status` produces the per-status counts. Stale count requires a JOIN with `versions` (latest completed per shot via window function) PLUS a filter on `STALE_SHOT_DAYS` cutoff; structure the query to use the same `idx_shots_status` + version completed_at indexes Phase 20 created. EXPLAIN QUERY PLAN test asserts no per-row subquery and uses the existing indexes. Approved_pct is computed in the repo function (not SQL) — integer math `Math.round(approved/total*100)` lives in TypeScript for clarity.
- **D-15:** Stale-eligibility for shots with ZERO completed versions ever: a shot whose `latest_completed_version === null` is NOT marked stale, regardless of `created_at`. Rationale: literal OVR-02 reading ("no completed version in last 14 days") would mark every brand-new shot stale immediately, which surprises users. Pragmatic interpretation: stale signals a shot that USED TO BE WORKED on but went idle — a shot with zero versions hasn't started yet. The SQL query encodes this as `WHERE EXISTS (SELECT 1 FROM versions v WHERE v.shot_id = shots.id AND v.status = 'complete' AND v.completed_at < cutoff)` AND `shots.status IN ('wip','pending-review')`. Zero-version shots fall out of the EXISTS clause. Document this as a small deviation from the literal requirement in the SUMMARY.md.
- **D-16:** New theme tokens: `--color-shot-stale` (D-08 above) PLUS `--color-stats-backlog-callout` (D-05 above; or reuse `--color-accent` if no distinct color is justified during design review). Both tokens added to both light and dark theme blocks in `packages/dashboard/src/styles/theme.css`. WCAG check at planning time.
- **D-17:** SSE payload extension NOT required for v1.3 — the existing `{ shotId, fromStatus, toStatus, changedBy, note?, sequenceId }` payload carries enough info for the dashboard to apply per-row + stats deltas. `latest_completed_at` is already on the row from the initial fetch; SSE handler reads it from `shotGrid.value.shots[idx]` rather than from the SSE payload. Keeping the SSE payload minimal preserves Phase 20's wire surface.
- **D-18:** Tool count holds at 7/12 (Phase 21 D-12 + Phase 22 D-21 precedent — dashboard-only HTTP extension, zero `server.registerTool()` calls).
- **D-19:** Stale-count "best-effort outside the buffer" caveat (D-12): for sequences with > 50 shots where the user has not loaded all pages, stale_count delta arithmetic is correct only for shots within `shotGrid.value.shots[]`. A status change for a shot beyond the loaded buffer leaves stale_count at its server-snapshot value (no client-side guess). Acceptable for v1.3: stale_count is approximate between full refetches; supervisor can refresh by re-opening the sequence to get a fresh snapshot. Document as a code comment in `state/shot-grid.ts` and in the phase SUMMARY.md.
- **D-20:** Backlog callout treatment: `! 3 awaiting review` uses a leading `!` icon or `lucide-preact` AlertCircle (matching the existing `<WarningPill/>` style language). When `pending_review_backlog === 0` the callout is hidden entirely (does not render as `! 0 awaiting`); same hide-on-zero rule as the per-status mini-pills (Phase 21 SequenceHeader.tsx:99).
- **D-21:** Animation discipline: NO mount/unmount animations on the new stats row or stale-border treatment (Phase 22 D-22 precedent reused — UI restraint). Progress bar fill on stat update CAN have a ≤ 150ms width transition that respects `prefers-reduced-motion: reduce`. Stale border addition/removal on SSE delta is instantaneous.

### Folded Todos
None — `gsd-sdk query todo.match-phase 23` returned zero matches.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 milestone scope and locked requirements
- `.planning/REQUIREMENTS.md` §"Production Overview / Stats (OVR)" — OVR-01..03 (Phase 23's locked requirements: stats widget at top of every `ShotGridView` with total shots, % approved, per-status counts, pending-review backlog; stale detection at 14 days for shots in 'wip'/'pending-review' status with no completed version in the window; single GROUP BY query no N+1; `STALE_SHOT_DAYS = 14` named constant; SSE-driven counter update via Preact computed signal derived from the shot grid signal)
- `.planning/REQUIREMENTS.md` §"Cross-Cutting Constraints" — tool cap at 7/12 (Phase 23 holds), WCAG 2.1 AA badges, signal-driven view routing (no router), append-only shot_status_events, single-transaction status writes (Phase 20 wire surface), null-coalesce at repo layer
- `.planning/REQUIREMENTS.md` §"Out of Scope" — explicit v1.3 exclusions; 20-state ShotGrid status machine is not in scope, automated status transitions on version completion are out, client approval portal out
- `.planning/ROADMAP.md` §"Phase 23: Production Stats" — 3 success criteria (stats widget computed via single GROUP BY query; stale indicator at 14d threshold computed at grid query time; SSE-driven counter update with signal-derived value)
- `.planning/PROJECT.md` §"Current Milestone: v1.3 Production Shot Grid" — milestone driver (production management surface for VFX artists), tool surface (7/12 cap), engine-as-shared-layer architecture rule, "VFX artists know names, not creation dates" precedent

### Prior-phase decisions to carry forward
- `.planning/phases/20-shot-status-engine/20-CONTEXT.md` — Phase 20 wire surface: `ShotStatus` type + `SHOT_STATUSES` const exported from `src/types/hierarchy.ts`; `set_status` tool arm writes UPDATE shots + INSERT shot_status_events in a single `db.transaction()`; `getCurrentStatus(db, shotId)` null-coalesces to `'wip'`; `shot.status_changed` SSE event fires with `{ shotId, fromStatus, toStatus, changedBy, note?, sequenceId }`; `shot_status_events` is append-only (grep test enforced); `STALE_SHOT_DAYS = 14` named constant lives at `src/store/shot-status-repo.ts:54`
- `.planning/phases/21-shot-grid-view/21-CONTEXT.md` — Phase 21 patterns Phase 23 extends:
  - **D-13 endpoint payload** explicitly excluded `is_stale` / `latest_completed_at` at shot row level — "Phase 23 either denormalizes those fields up or adds a `STALE_SHOT_DAYS` computed column". Phase 23 adds `is_stale: boolean` per row (D-03 above).
  - **D-14 aggregate counts** "Phase 23 replaces this with the full server-computed stats widget" — Phase 23 PRESERVES the mini-pills as the counts layer below the new stats row (D-04 above; partial reinterpretation of D-14's "replaces" — Phase 23 augments instead, keeping the mini-pills as the granular counts layer).
  - **D-22 SSE handler** registration in App.tsx for `shot.status_changed` reused; Phase 23 extends `onShotStatusChanged` body to apply stats deltas (D-11 above).
  - **`aggregateCounts` computed** in state/shot-grid.ts:123 stays in place — Phase 21 already documents it reflects the paginated buffer only; Phase 23 supersedes for the new stats widget but the mini-pills row below still consumes it.
- `.planning/phases/22-review-and-approval/22-CONTEXT.md` — Phase 22 surfaces Phase 23 must not break:
  - **D-10 hover Approve icon** absolutely positioned top-right corner of thumbnail — Phase 23 stale border is on the OUTER wrapper; no positional conflict.
  - **D-12 quick-approve optimistic + revert** flow with `<WarningPill/>` inline error — Phase 23 stats SSE handler updates AFTER the local optimistic mutation; same idempotent-set-to-broadcasted-value pattern.
  - **D-13 ShotGridCard refactor** root `<div class="group relative">` with three sibling buttons — Phase 23 stale border is added to this outer `<div>` (NOT a new wrapper); coexists with the omit `opacity-40` outer wrapper from D-13 (omit shots are by definition not stale per OVR-02 status filter).
  - **D-20 SSE handler interaction** with optimistic update — idempotent SSE arrival as no-op for already-correct local state; Phase 23 stats deltas apply on every event regardless of whether a local mutation preceded the SSE.
- `.planning/phases/17-visual-thumbnails/17-CONTEXT.md` — `<Thumbnail/>` lazy-load pattern preserved; Phase 23 does NOT change the thumbnail pipeline.

### Code precedent (patterns to mirror) — files to read before planning
- `src/store/shot-status-repo.ts:54` — `STALE_SHOT_DAYS = 14` named constant; single source of truth for the threshold
- `src/store/shot-status-repo.ts:69-94` — `insertStatusEvent` transactional dual-write pattern (Phase 20 STAT-02); the new stats query lives in this file OR a new `src/store/sequence-stats-repo.ts` if cleaner separation is preferred (planner's call)
- `src/store/version-repo.ts` — existing `listRecentCompleted` + completed-at ordering patterns; the stale-detection query uses similar window-function / EXISTS-clause syntax
- `src/store/hierarchy-repo.ts listShots` — shot list query that the stats query joins against (or filters by `sequence_id`)
- `src/http/dashboard-routes.ts:370-375` — existing `GET /api/sequences/:id/shot-grid` route; Phase 23 EXTENDS the response envelope (adds `stats` + per-row `is_stale`); route signature unchanged
- `src/engine/pipeline.ts` — engine facade; Phase 23 adds `engine.getSequenceStats(sequenceId)` or extends `engine.listShotGrid` to compose both queries into the response
- `src/__tests__/architecture-purity.test.ts` — no new native bindings; allowed-set unchanged
- `src/__tests__/tool-budget.test.ts` — must remain `=== 7` (Phase 23 adds zero MCP tools)
- `src/http/__tests__/dashboard-routes-shot-grid.test.ts` — existing route harness; Phase 23 adds tests for the new `stats` envelope field + per-row `is_stale` field; existing tests remain green
- `src/store/__tests__/shot-status-repo.test.ts` — Phase 20's harness already covers `STALE_SHOT_DAYS = 14` constant; Phase 23 adds tests for the new sequence stats query
- `packages/dashboard/src/views/ShotGridView.tsx` — Phase 21 view; Phase 23 mutates only at the seed-`sequenceStats` step (after `fetchShotGrid` resolves) and passes `sequenceStats.value` props to `<SequenceHeader/>`
- `packages/dashboard/src/components/SequenceHeader.tsx` — Phase 21 D-14 component; Phase 23 adds new props + new stats subrow (D-04 above) INSIDE the existing component; mini-pills row preserved
- `packages/dashboard/src/components/ShotGridCard.tsx` — Phase 22 D-13 refactored to outer `<div class="group relative">`; Phase 23 conditionally adds an amber border class (e.g., `class="ring-2 ring-[var(--color-shot-stale)]"` or a `class="border-2 border-..."` variant — implementation pattern at planning time)
- `packages/dashboard/src/components/WarningPill.tsx` — amber/yellow advisory pill (uses `--color-status-running`); REFERENCE for the new backlog-callout component's visual language (not reused directly — backlog is "informational" not "warning")
- `packages/dashboard/src/state/shot-grid.ts` — Phase 21 signal home; Phase 23 ADDS `sequenceStats` signal + extends `onShotStatusChanged` handler (D-11 + D-12 above); does NOT replace existing exports
- `packages/dashboard/src/types/shot-grid.ts` — Phase 21 wire-shape types; Phase 23 ADDS `SequenceStats` type + extends `ShotGridRow` with `is_stale: boolean` + extends `ShotGridResponse` with `stats: SequenceStats`
- `packages/dashboard/src/lib/api.ts` — `fetchShotGrid` consumer; Phase 23 does NOT change its signature, just consumes the wider response shape
- `packages/dashboard/src/lib/copy.ts` — copy registry; Phase 23 adds stats-related copy strings (e.g., `STATS_APPROVED_LABEL`, `STATS_BACKLOG_PREFIX`, `STATS_BACKLOG_SUFFIX`, `STATS_STALE_PREFIX`, `STATS_STALE_SUFFIX`, `STATS_PROGRESS_ARIA_PREFIX`)
- `packages/dashboard/src/styles/theme.css:51-58` — Phase 21 added 5 `--color-shot-status-*` tokens; Phase 23 ADDS `--color-shot-stale` + optionally `--color-stats-backlog-callout` to both light (`:root`) and dark (`[data-theme="dark"]`) blocks
- `packages/dashboard/src/components/StatusPill.tsx`, `ShotStatusPill.tsx` — existing pill design vocabulary; Phase 23's new backlog callout adopts the saturated-bg + inverse-text style; progress bar uses `--color-shot-status-approved` for fill

### Cross-cutting
- `CLAUDE.md` §"Architecture Rules" — "Tool cap: Maximum 12 MCP tools" → Phase 23 holds at 7/12 (D-18 confirms); "Tool-engine separation: MCP tools are thin Zod-validated entry points that delegate to engine services" → Phase 23 HTTP route stays a thin Hono handler delegating to engine composition; "Append-only provenance: Provenance records are never updated or deleted" → applies transitively to the stats source (shot_status_events stays append-only); "Paginate all list queries (default 20, include total count)" → existing shot-grid pagination unchanged; stats is NOT a list query (single envelope, no cursor)
- `CLAUDE.md` §"Conventions" — "Error responses must be human-readable with actionable guidance" → stats query failures bubble through the existing TypedError mechanism (SEQUENCE_NOT_FOUND for unknown id, INVALID_INPUT for malformed cursor — both unchanged); "Never return raw JSON dumps to agents — structure responses with context" applies to the envelope shape
- `.planning/STATE.md` — current position: Phase 22 complete; Phase 23 ready to plan; resume → `/gsd-plan-phase 23`
- `.continue-here.md` (none in phase dir) — no blocking anti-patterns recorded

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`<SequenceHeader/>`** (Phase 21 D-14/D-15) — already structures the chevron + name + counts header; Phase 23 grows a new subrow INSIDE this component (props extension; no new mount point).
- **`aggregateCounts` computed signal** (Phase 21 state/shot-grid.ts:123) — stays in place; the mini-pills row below the new stats row continues to consume it. Note its existing caveat ("loaded so far" pagination); Phase 23's new server-supplied counts are the authoritative whole-sequence values.
- **`onShotStatusChanged` SSE handler** (Phase 21 state/shot-grid.ts:160) — Phase 23 extends with stats deltas (D-11 above); existing per-row identity-preserving update preserved.
- **`STALE_SHOT_DAYS = 14` constant** (Phase 20 src/store/shot-status-repo.ts:54) — single source of truth; Phase 23 imports server-side AND mirrors on the dashboard (or hoists to a shared types module).
- **`WarningPill` color language** (Phase 18 component, uses `--color-status-running` amber) — REFERENCE for the new backlog callout's visual style; not reused as a component.
- **`fetchShotGrid` + `shotGrid` signal** (Phase 21 state/shot-grid.ts:76) — Phase 23 EXTENDS the response consumer to also seed `sequenceStats`; signature unchanged.
- **Phase 21 D-22 SSE subscription in App.tsx** — already registers `onShotStatusChanged` on `shot.status_changed`; Phase 23 reuses (no new subscription).
- **`TypedError('SEQUENCE_NOT_FOUND')` mechanism** (existing engine + global handler) — Phase 23 stats query reuses for unknown sequence id; no new error code needed.
- **Phase 21 `tool-budget.test.ts` + `architecture-purity.test.ts`** — both stay green (Phase 23 adds zero MCP tools, zero new native bindings).

### Established Patterns
- **Signal-driven view routing + per-domain signal files** (Phase 21/22) — Phase 23 adds `sequenceStats` to `state/shot-grid.ts` (NOT a new file); same per-domain convention.
- **Server-computed source + client-mutated signal + SSE delta** — Phase 23 establishes a stats variant of this pattern: server seeds, SSE deltas, no re-fetch. Phase 22 quick-approve set the optimistic-update + SSE-confirm precedent; Phase 23 stats deltas extend the same idempotent-converge model.
- **WCAG 2.1 AA badges + buttons** — Phase 23 progress bar + callout + stale border all comply: progress bar has `role="progressbar"` with `aria-valuenow`; backlog callout has text + color (not color alone); stale border is a redundant orthogonal cue (status pill in name row already encodes status).
- **Tool-engine separation** — HTTP route stays thin; new stats logic lives in engine + repo layer.
- **Append-only event log + transactional dual-write** (Phase 20) — Phase 23 does NOT mutate this — it just READS the materialized `shots.status` column for the GROUP BY. No new migrations required.
- **Snake_case envelope fields** (Phase 21 D-13 / types/shot-grid.ts:11-14) — Phase 23 stats fields follow: `approved_pct`, `pending_review_backlog`, `stale_count`, `total`.

### Integration Points
- **`packages/dashboard/src/components/SequenceHeader.tsx`** — extended with new `stats: SequenceStats | null` prop and new inline subrow; new copy strings; new theme tokens; collapsible chevron applies to all three rows.
- **`packages/dashboard/src/views/ShotGridView.tsx:290-299`** — already passes `counts={aggregateCounts.value}` to `<SequenceHeader/>`; Phase 23 also passes `stats={sequenceStats.value}` from the new signal; otherwise unchanged.
- **`packages/dashboard/src/components/ShotGridCard.tsx:75`** — outer `<div class="group relative">` gains conditional amber border class when `shot.is_stale === true`; recommend: `class={`group relative ${shot.is_stale ? 'border-2 border-[var(--color-shot-stale)] rounded' : ''}`}`. Wrapper preserves the existing `opacity-40` omit wrapper outside it.
- **`packages/dashboard/src/state/shot-grid.ts`** — adds `sequenceStats: Signal<SequenceStats | null>`; extends `onShotStatusChanged` per D-11/D-12; adds the dashboard-side `STALE_SHOT_DAYS_MS = 14 * 86_400_000` mirror constant (or imports a shared types module — planner's call).
- **`packages/dashboard/src/types/shot-grid.ts`** — adds `SequenceStats` interface; extends `ShotGridRow` with `is_stale: boolean`; extends `ShotGridResponse` with `stats: SequenceStats`.
- **`packages/dashboard/src/lib/copy.ts`** — adds stats copy strings; tests check exported-count threshold (Phase 21 added ≥46 exports; Phase 23 raises floor proportionally).
- **`packages/dashboard/src/styles/theme.css`** — adds `--color-shot-stale` (and optionally `--color-stats-backlog-callout`) to both light + dark blocks; WCAG check at planning time.
- **`src/http/dashboard-routes.ts:370-375`** — extends `GET /api/sequences/:id/shot-grid` response envelope; no route signature change; existing test harness extended with stats + is_stale assertions.
- **`src/engine/pipeline.ts`** — adds `getSequenceStats(sequenceId)` engine method OR extends `listShotGrid` to compose both queries; the existing `listShotGrid` interface adds `stats` to the return envelope.
- **`src/store/shot-status-repo.ts`** OR new `src/store/sequence-stats-repo.ts` — implements the GROUP BY query + stale-shot count via JOIN with `versions` (EXISTS-clause for D-15 zero-version grace period). EXPLAIN QUERY PLAN test asserts use of `idx_shots_status` + version completed_at index, no per-row subquery.
- **No new MCP tools** — `tool-budget.test.ts` stays `=== 7`.
- **No new migrations** — Phase 23 is read-only over `shots` and `versions`; no schema changes.

</code_context>

<specifics>
## Specific Ideas

- **"Augment, don't replace" header layout** — Timothy explicitly picked the augmented layout (stats row ABOVE existing mini-pills). The Phase 21 D-14 mini-pills row stays as the per-status counts layer; the new stats row carries the headline (% bar + backlog callout + stale count). This is Phase 21's D-14 "Phase 23 replaces..." being softened: replace the SEMANTIC ROLE of the mini-pills (as the supervisor's primary signal) without deleting them.
- **Progress bar + backlog callout as the headline duo** — Timothy picked Option A for stats hierarchy: progress bar for %, distinct callout for pending-review backlog. The bar is the "are we close to done" signal; the callout is the "what do I need to do now" signal. Stale count rides next to the callout when present.
- **Amber BORDER, not amber icon** — Timothy picked the whole-card outline. Strongest glanceability when scanning the grid; no card-corner real estate competition. Use a NEW theme token distinct from `pending-review` amber to avoid visual collapse (D-08).
- **Frame.io / ShotGrid stats vocabulary** — Carries forward from Phase 21/22 conversations: stats live in the sequence header (per-sequence, not global); supervisors scan top-down (headline → details).
- **OVR-02 literal vs. pragmatic reading** — D-15 chose pragmatic: zero-version shots not marked stale. Documented as a small deviation; can be flipped to literal-reading by changing one EXISTS clause if user feedback signals otherwise.

</specifics>

<deferred>
## Deferred Ideas

- **Stale shot drill-in / dedicated list view** — clicking the stale count opens a filtered view of just stale shots. Not in OVR-* spec. Candidate for a future polish phase or v1.4.
- **"Snooze stale" action** — supervisor marks a shot as "intentionally idle" to suppress stale signal. Adds a column to `shots` table; out of v1.3 scope.
- **Per-supervisor productivity stats** — average time-on-status, approval rate per supervisor, etc. Out of v1.3 scope (no auth / no per-user surface in single-artist demo persona).
- **Stale-shot Slack/email digest** — daily report of stale shots needing attention. Out of v1.3 scope (no notification layer; deferred indefinitely).
- **Multi-sequence rollup stats** (project-level stats widget) — Phase 21 D-20 already deferred project-level grid; same deferral applies here. Candidate for v1.4 if VFX artists report "show me everything stale across the project."
- **Sparkline / trend lines for approval velocity** — % approved as a trend over time, not just current snapshot. Adds time-series storage and aggregation; out of v1.3 scope.
- **Configurable STALE_SHOT_DAYS** — make the threshold per-project or per-sequence rather than a hardcoded 14. REQUIREMENTS.md explicitly says "configurable in future milestone" (Q2 resolution at line 18).
- **Donut/ring chart visualization** — Q3 option D ("Donut/ring chart") was not picked; if supervisor feedback signals demand it, this is a contained additive change to the new stats row.
- **Stale tooltip with timestamp** — hover the amber border to see "Last completed version 21d ago". Nice polish, not in OVR-* spec. Candidate for Phase 24 if it fits the polish budget.
- **Inline stale-count delta logging** — log to console when stats delta arithmetic disagrees with server snapshot on next refetch (helps detect drift). Debug-only; out of v1.3 ship scope.

### Reviewed Todos (not folded)
None — `gsd-sdk query todo.match-phase 23` returned zero matches; no reviewed-but-deferred todos.

</deferred>

---

*Phase: 23-production-stats*
*Context gathered: 2026-05-15*
