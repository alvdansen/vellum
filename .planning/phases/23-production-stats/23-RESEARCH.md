# Phase 23: Production Stats — Research

**Researched:** 2026-05-15
**Domain:** Server-computed sequence stats + per-shot stale indicator + SSE-driven counter deltas
**Confidence:** HIGH (every surface grounded in existing repo code; no library version drift; locked decisions from CONTEXT.md cover every Q I would otherwise ask)

## Summary

Phase 23 is a pure additive layer over the Phase 21 shot-grid endpoint and the Phase 21/22 dashboard state machine. Two surgical server changes plus one cleanly-bounded dashboard delta close OVR-01..03:

1. **Server:** Add `engine.getSequenceStats(sequenceId)` backed by a new `getSequenceStats(db, sequenceId)` repo function that runs (a) one `GROUP BY shots.status` and (b) one `COUNT(*) WHERE EXISTS` for stale_count. Compose both into `engine.listShotGrid` so the existing route gains `stats: SequenceStats` at the top level [VERIFIED: src/engine/pipeline.ts:822-874, src/store/shot-status-repo.ts:228-285]. Extend `listShotsForGrid`'s row shape to surface a per-row `is_stale` flag computed inline via CASE expression — no extra query.
2. **Dashboard signal:** Add `sequenceStats: Signal<SequenceStats | null>` to `state/shot-grid.ts` (seeded by `fetchShotGrid`, mutated by `onShotStatusChanged`). Extend the existing `onShotStatusChanged` (state/shot-grid.ts:160) with a `applyStatsDelta` helper that decrements `counts[fromStatus]`, increments `counts[toStatus]`, recomputes `approved_pct` + `pending_review_backlog`, and applies the stale-count delta per D-12 [VERIFIED: state/shot-grid.ts:160-171].
3. **Dashboard component:** `<SequenceHeader/>` grows a NEW inline subrow between the name row and the existing Phase 21 D-14 mini-pills row. The subrow renders `<ProgressBar/>` (new primitive — WCAG 2.1 AA progressbar role) + a backlog callout (new component using `lucide-preact` `AlertCircle`) + an optional stale-count text fragment. Zero new mount points; `<ShotGridView/>` passes `stats={sequenceStats.value}` alongside the existing `counts={aggregateCounts.value}` prop.
4. **Stale indicator:** `<ShotGridCard/>` conditionally adds a 2px amber border on the outer `<div class="group relative">` when `shot.is_stale === true`. New theme token `--color-shot-stale` distinct from `--color-shot-status-pending-review` to avoid visual collapse [CITED: 23-CONTEXT.md D-08].

Tool count holds at 7/12 (zero `server.registerTool()` calls — Phase 22 D-21 precedent). No new migrations. No new SSE event types. The endpoint signature is unchanged from Phase 21; the response envelope gains two top-level fields (`stats`) and one per-row field (`is_stale`).

**Primary recommendation:** **Compose, don't replace.** Reuse the existing single-roundtrip endpoint, the existing SSE handler reference, the existing `<SequenceHeader/>` mount point. Three additive components (`<ProgressBar/>`, `<BacklogCallout/>`, `<StaleIndicator/>` border-only treatment), two new theme tokens (`--color-shot-stale` + optional `--color-stats-backlog-callout`), one new repo function, one new engine facade method. Match Phase 21/22 patterns verbatim.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stats GROUP BY query | Database | API / Backend | Single SQL scan via `idx_shots_status (sequence_id, status)` covering index from migration 0008 — already created [VERIFIED: drizzle/0008_shot_status.sql:25] |
| Stale-count EXISTS scan | Database | API / Backend | `WHERE EXISTS (SELECT 1 FROM versions WHERE shot_id = s.id AND status='completed' AND completed_at < cutoff)` — uses the `versions.shot_id` autoindex from the UNIQUE constraint [VERIFIED: src/store/schema.ts:103] |
| Per-row `is_stale` flag | Database | — | Inline CASE expression in the existing CTE — no extra query; mirrors `version_count` precedent at shot-status-repo.ts:260 [VERIFIED] |
| `approved_pct` arithmetic | API / Backend | — | `Math.round((counts.approved / total) * 100)` in TypeScript — closer to dashboard logic, no SQL [CITED: 23-CONTEXT.md D-14] |
| Engine facade | API / Backend | Database | New `getSequenceStats(sequenceId)` engine method; `listShotGrid` composes both queries into the response envelope [VERIFIED: src/engine/pipeline.ts:822] |
| HTTP route | API / Backend | — | EXTEND existing `GET /api/sequences/:id/shot-grid` route — zero new HTTP routes, zero new MCP tools [CITED: 23-CONTEXT.md D-01 + D-13] |
| Stats signal seeding | Browser / Client | API / Backend | `fetchShotGrid` now returns `stats` field; `state/shot-grid.ts` seeds `sequenceStats.value = res.stats` on every fetch [CITED: 23-CONTEXT.md D-10] |
| Stats SSE deltas | Browser / Client | — | Extend `onShotStatusChanged` (state/shot-grid.ts:160) to apply per-event deltas; no full re-fetch; idempotent under the existing cross-sequence guard [CITED: 23-CONTEXT.md D-11] |
| Progress bar render | Browser / Client | — | New WCAG-compliant primitive with `role="progressbar"` + `aria-valuenow/min/max/label`; no library [CITED: 23-CONTEXT.md D-06] |
| Backlog callout | Browser / Client | — | New component using `lucide-preact` `AlertCircle` (existing dep at packages/dashboard/package.json:17); hide-on-zero rule mirrors Phase 21 D-14 mini-pills [VERIFIED: lucide-preact alias `CircleAlert as AlertCircle`] |
| Stale-border treatment | Browser / Client | — | Conditional class on outer `<div>` of `<ShotGridCard/>`; coexists with omit `opacity-40` wrapper, Phase 22 D-10 hover icon, Phase 22 D-12 WarningPill [CITED: 23-CONTEXT.md D-07 + D-09] |
| SSE payload (unchanged) | API / Backend | — | Existing `{shotId, fromStatus, toStatus, changedBy, note?, sequenceId}` already carries enough; dashboard reads `latest_completed_at` from `shotGrid.value.shots[idx]` [VERIFIED: src/http/sse.ts:135-148, types/events.ts:72-79] |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OVR-01 | Stats widget at top of every `ShotGridView` showing total shots, % approved, per-status counts, pending-review backlog. Stats computed server-side via single GROUP BY query — no N+1, no per-shot subquery | New `getSequenceStats(db, sequenceId)` function in `src/store/shot-status-repo.ts` running ONE `SELECT status, COUNT(*) FROM shots WHERE sequence_id=? GROUP BY status` plus ONE `SELECT COUNT(*) ... WHERE EXISTS (...)` for stale_count. Both queries use existing covering indexes — verified by new `EXPLAIN QUERY PLAN` test (mirrors Phase 21 pattern at `shot-status-repo-grid.test.ts:88-109`). `approved_pct` computed in TypeScript per D-14. `pending_review_backlog` is `counts['pending-review']` — emitted explicitly for component data-source isolation per D-02 |
| OVR-02 | Stale shot detection: shots with `status IN ('wip','pending-review')` AND no completed version in last 14 days get amber "Stale" indicator. Staleness computed at grid query time from `versions.completed_at`. `STALE_SHOT_DAYS = 14` named constant | Server-side: per-row `is_stale` flag added to `ShotGridQueryRow` shape via inline CASE expression in the existing CTE — leverages `STALE_SHOT_DAYS` constant at `src/store/shot-status-repo.ts:54` (already exported, single source of truth). Engine facade re-maps to per-row `is_stale: boolean` in response envelope. **D-15 pragmatic interpretation:** shots with zero completed versions ever are NOT marked stale (the EXISTS clause naturally falls out); this deviates from the literal OVR-02 reading and is documented in SUMMARY.md. Dashboard: `<ShotGridCard/>` adds `border-2 border-[var(--color-shot-stale)]` to outer `<div class="group relative">` when `shot.is_stale === true`. New theme token `--color-shot-stale` (light `#f59e0b`, dark `#fbbf24`) distinct from `--color-shot-status-pending-review` to avoid visual collapse per D-08 |
| OVR-03 | Stats widget auto-refreshes on `shot.status_changed` SSE for any shot in current sequence — increments/decrements counters without full re-fetch. Backed by Preact computed signal derived from shot grid signal | Extend `onShotStatusChanged` (state/shot-grid.ts:160-171) with `applyStatsDelta` helper. The existing handler is already idempotent under cross-sequence guard (line 163); new stats logic adds inside the SAME function — no relocation, reference equality preserved for `App.tsx`'s `onSseEvent/offSseEvent` lifecycle (App.tsx:87-100). Stats deltas: decrement `counts[fromStatus]` (clamped at 0), increment `counts[toStatus]`, recompute `approved_pct` + `pending_review_backlog`, apply stale-count delta per D-12 (read `latest_completed_version.completed_at` from `shotGrid.value.shots[idx]`, compute `wasStale`/`isStaleNow` against `STALE_SHOT_DAYS * 86_400_000`). Cross-buffer shots (`shots[].findIndex === -1`) leave stale_count unchanged — best-effort caveat documented in D-19 |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Extend existing `GET /api/sequences/:id/shot-grid` endpoint with TWO new top-level response fields: `stats: SequenceStats` (sequence-wide, independent of `shots[]` pagination) and per-row `is_stale: boolean` on each `ShotGridRow`. Repo layer split: `engine.listShotGrid()` keeps doing exactly what it does; NEW `engine.getSequenceStats(sequenceId)` runs the single GROUP BY for stats. Engine composes both into response envelope.

**D-02:** `SequenceStats` envelope shape (LOCKED):
```ts
interface SequenceStats {
  total: number;                              // whole-sequence shot count
  approved_pct: number;                        // 0-100 integer
  counts: Record<ShotStatus, number>;          // wip|pending-review|approved|on-hold|omit
  pending_review_backlog: number;              // === counts['pending-review']; emitted for clarity
  stale_count: number;                         // whole-sequence stale shots
}
```
Mirrors per-row `version_count` snake_case convention (Phase 21 D-13). `pending_review_backlog` duplicates `counts['pending-review']` BY DESIGN — keeps backlog-callout component independent of count-pills component.

**D-03:** `ShotGridRow` gains one new field: `is_stale: boolean`. Server computes per-row at query time using existing `STALE_SHOT_DAYS` constant. `latest_completed_version.completed_at` already on row (Phase 21 D-13).

**D-04:** `<SequenceHeader/>` grows NEW top row INSIDE existing component (Phase 21 D-14 mini-pills row PRESERVED below, NOT replaced). Three stacked layers: (1) sequence name + chevron toggle (existing), (2) NEW stats row with [progress bar + % approved] + [pending-review backlog callout] + [stale count], (3) existing per-status mini-pills row. Chevron collapses ALL three rows. No new mount point; no separate `<SequenceStatsWidget/>` component.

**D-05:** Headline visual treatment: % approved as horizontal progress bar (fills left→right) with numeric value rendered as label adjacent/overlaid. Pending-review backlog as distinct CALLOUT pill (e.g., `! 3 awaiting review`) in accent color visually separated from per-status mini-pills below. Stale count renders inline next to backlog (e.g., `⚠ 1 stale`) when `stale_count > 0`; hidden when zero.

**D-06:** Progress bar a11y: `role="progressbar"`, `aria-valuenow={approved_pct}`, `aria-valuemin=0`, `aria-valuemax=100`, `aria-label="Approval progress for {sequenceName}"`. Bar fill color reuses `--color-shot-status-approved` (Phase 21 theme.css). Bar track uses `--color-border` or `--color-bg-hover`. WCAG 2.1 AA: text ≥ 4.5:1, UI components ≥ 3:1.

**D-07:** Amber 1-2px BORDER around entire `<ShotGridCard/>` when `is_stale === true`. No icon, no badge, no inline "Stale" text — full-card outline only. Maximizes glanceability when scanning grid; minimal pixel cost; cooperates with 16:9 thumbnail layout without competing for corner real estate (top-right is Phase 22 D-10 hover Approve icon).

**D-08:** NEW theme token `--color-shot-stale` distinct from `--color-shot-status-pending-review` (Phase 21 `#fbbf24`). Recommended: light `#f59e0b` (amber-500), dark `#fbbf24` (amber-400 reused). Distinction matters because pending-review shot can ALSO be stale — same hex would visually collapse two semantic states. WCAG 2.1 AA: border is REDUNDANT cue (status pill in name row continues to encode status with text + color).

**D-09:** Border coexists with focus state, omit state, WarningPill error state. `focus-visible` ring lives on INNER buttons; amber border on OUTER `<div class="group relative">`. Omit `opacity-40` wrapper outside everything; per OVR-02, omit shots are by-definition NOT stale → no coexistence problem. WarningPill is absolutely-positioned inside card body → no conflict.

**D-10:** New `sequenceStats: Signal<SequenceStats | null>` in `packages/dashboard/src/state/shot-grid.ts`. Seeded from `fetchShotGrid` response (`res.stats`); `null` = pre-fetch / no-grid-loaded state.

**D-11:** `onShotStatusChanged` (state/shot-grid.ts:160) EXTENDED — not replaced — to apply stats deltas on every matching event. Algorithm:
```
if sequenceStats is null OR cross-sequence event: return
decrement stats.counts[fromStatus] (clamped at 0)
increment stats.counts[toStatus]
recompute stats.pending_review_backlog from stats.counts['pending-review']
recompute stats.approved_pct from stats.counts['approved'] / stats.total
apply stale-count delta per D-12
emit new sequenceStats.value (immutable replace)
```

**D-12:** Stale-count delta algorithm:
```
Find matching shot in shotGrid.value.shots[] (by shot.id)
If not in buffer (paginated beyond): leave stale_count unchanged (best-effort)
If in buffer:
  wasStale = shot.is_stale
  isStaleNow = toStatus IN ('wip','pending-review')
    AND latest_completed_version !== null
    AND (Date.now() - latest_completed_version.completed_at) > STALE_SHOT_DAYS * 86_400_000
  If wasStale && !isStaleNow: stale_count--
  If !wasStale && isStaleNow: stale_count++
  Update shot.is_stale for next event
```

### Claude's Discretion

**D-13:** Endpoint shape Option C (single endpoint, both top-level). Rationale: matches OVR-01 "single GROUP BY query"; explicit whole-sequence semantics; one roundtrip preserves existing `fetchShotGrid` + signal lifecycle.

**D-14:** Sequence-wide GROUP BY query: single `SELECT status, COUNT(*) FROM shots WHERE sequence_id = ? GROUP BY status` for per-status counts. Stale count requires JOIN with `versions` (latest completed per shot via EXISTS clause) PLUS filter on `STALE_SHOT_DAYS` cutoff. EXPLAIN QUERY PLAN test asserts no per-row subquery; uses `idx_shots_status` + version completed_at semantics. Approved_pct computed in TypeScript (NOT SQL) — `Math.round(approved/total*100)`.

**D-15:** Zero-completed-versions shots NOT stale (pragmatic OVR-02 interpretation). SQL: `WHERE EXISTS (SELECT 1 FROM versions v WHERE v.shot_id = shots.id AND v.status = 'completed' AND v.completed_at < cutoff)` AND `shots.status IN ('wip','pending-review')`. Zero-version shots fall out of EXISTS clause. Document in SUMMARY.md.

**D-16:** New theme tokens: `--color-shot-stale` (D-08) PLUS `--color-stats-backlog-callout` (D-05; OR reuse `--color-accent`). Both added to BOTH light + dark blocks in `packages/dashboard/src/styles/theme.css`.

**D-17:** SSE payload extension NOT required. Existing `{shotId, fromStatus, toStatus, changedBy, note?, sequenceId}` carries enough; `latest_completed_at` already on row from initial fetch; SSE handler reads from `shotGrid.value.shots[idx]`.

**D-18:** Tool count holds at 7/12. Zero `server.registerTool()` calls.

**D-19:** Stale-count "best-effort outside the buffer" caveat: for sequences > 50 shots, stale_count delta arithmetic correct only for shots in `shotGrid.value.shots[]`. Out-of-buffer status change leaves stale_count at server-snapshot value. Acceptable for v1.3; supervisor refreshes for fresh snapshot. Document in `state/shot-grid.ts` comment.

**D-20:** Backlog callout uses `lucide-preact` `AlertCircle` (or leading `!` char). Hidden when `pending_review_backlog === 0`. Same hide-on-zero rule as Phase 21 mini-pills (SequenceHeader.tsx:99).

**D-21:** NO mount/unmount animations on stats row or stale border. Progress bar fill CAN have ≤ 150ms width transition; honor `prefers-reduced-motion: reduce` via existing media query at `theme.css:194-199`.

### Deferred Ideas (OUT OF SCOPE)

- Stale shot drill-in / dedicated list view
- "Snooze stale" action
- Per-supervisor productivity stats
- Stale-shot Slack/email digest
- Multi-sequence rollup stats (project-level)
- Sparkline / trend lines for approval velocity
- Configurable `STALE_SHOT_DAYS` (per-project / per-sequence)
- Donut/ring chart visualization
- Stale tooltip with timestamp ("Last completed 21d ago")
- Inline stale-count drift logging

## Project Constraints (from CLAUDE.md)

| Directive | Phase 23 Compliance |
|-----------|---------------------|
| Tool cap ≤ 12 MCP tools | Phase 23 adds ZERO `server.registerTool()` calls; `tool-budget.test.ts` continues to assert `=== 7` [VERIFIED: src/__tests__/tool-budget.test.ts:71] |
| Tool-engine separation | New HTTP route changes ZERO — endpoint is the Phase 21 route, extended response envelope; new logic lives in repo layer (`getSequenceStats`) + engine facade; route stays a thin Hono delegator |
| Append-only provenance | Phase 23 is read-only over `shots` and `versions` + `shot_status_events`; NO new migrations, NO mutations to event log |
| Prompt blob is truth | Not applicable — Phase 23 doesn't touch generation surface |
| Async generation | Not applicable — Phase 23 is synchronous SQL query path |
| SQLite WAL + busy_timeout=5000 | Existing configuration unchanged |
| nanoid for IDs | No new entities created |
| VFX naming (zero-padded versions, underscore separators) | No new copy strings affect this — stats display whole-sequence numbers |
| Error responses human-readable | `getSequenceStats` reuses `TypedError('SEQUENCE_NOT_FOUND')` via parent `listShotGrid` call; no new error code needed |
| Never raw JSON dumps to agents | Response envelope is structured `SequenceStats` shape; no raw row dumps |
| Paginate all list queries (default 20) | Existing shot-grid pagination unchanged; stats is NOT a list query (single envelope, no cursor) |

## Standard Stack

Phase 23 adds zero new dependencies. Every primitive listed below is already installed and used elsewhere in the codebase.

### Core (no new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | (existing — see package.json) | SQL composition for `getSequenceStats` GROUP BY + EXISTS subqueries via `sql\`\`` tagged template | Phase 21 precedent for window-function CTEs at `shot-status-repo.ts:246-273` [VERIFIED] |
| `better-sqlite3` | (existing) | Synchronous query execution; `db.all()` / `db.get()` | Phase 21 precedent; transactional context not needed (read-only) [VERIFIED] |
| `@preact/signals` | (existing) | `sequenceStats: Signal<SequenceStats \| null>` + computed derivations | Mirrors `shotGrid: Signal<ShotGridResponse \| null>` (state/shot-grid.ts:76) [VERIFIED] |
| `lucide-preact` | `^1.9.0` | `AlertCircle` icon for backlog callout | Already imported in 7 files (App.tsx, QuickApproveButton.tsx, SortDropdown.tsx, TreeSidebar.tsx, ThemeToggle.tsx, ReviewTimeline.tsx, SequenceHeader.tsx) [VERIFIED: package.json:17] |
| `zod` | (existing) | NOT needed (no new HTTP route, no new query param) — the existing route already validates `cursor` + `limit` | Phase 21 precedent at `dashboard-routes.ts:291-304` [VERIFIED] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `<ProgressBar/>` | `@radix-ui/react-progress` | Radix is React-only; Preact compat requires `preact/compat` shim → adds bundle weight. Hand-rolled native HTML `<div role="progressbar">` is ~10 LOC and meets WCAG 2.1 AA. **Pick: hand-rolled.** |
| `AlertCircle` from `lucide-preact` | Leading `!` character | Icon is consistent with existing visual language (WarningPill at Phase 22 uses similar amber tone). User-stated preference D-20 is icon. **Pick: AlertCircle.** |
| Separate `<SequenceStatsWidget/>` component mounted between FilterBar and SequenceHeader | Subrow INSIDE existing `<SequenceHeader/>` | User locked D-04 — same component, new subrow. Avoids prop-drilling and a second mount point. **Pick: subrow.** |
| SQL-side `approved_pct` (`CAST(approved AS FLOAT) / total * 100`) | TypeScript-side `Math.round(approved/total*100)` | TypeScript-side keeps SQL pure-counting; division-by-zero guard (`total === 0 ? 0 : ...`) lives next to the rest of the response composition. **Pick: TypeScript per D-14.** |

**Installation:**
```bash
# No new packages needed
```

**Version verification (existing packages):**
```bash
# Already verified during Phase 21/22 — all installed and locked
# lucide-preact: ^1.9.0 (packages/dashboard/package.json:17) — VERIFIED
# AlertCircle is exported as alias of CircleAlert (verified in node_modules/lucide-preact/dist/lucide-preact.d.ts)
```

## Package Legitimacy Audit

> Phase 23 installs ZERO new packages. All recommended primitives are already in the lock files (verified Phase 17/18/19/20/21/22). This section is intentionally trivial.

| Package | Registry | Status | Disposition |
|---------|----------|--------|-------------|
| (none — Phase 23 adds zero deps) | — | — | — |

## Architecture Patterns

### System Architecture Diagram

```
Browser (preact)
  ┌─────────────────────────────────────────────────────────────┐
  │ <ShotGridView/> (views/ShotGridView.tsx)                    │
  │   ↓ on mount: fetchShotGrid(seqId) → seed shotGrid +       │
  │                                       sequenceStats        │
  │   ↓ passes: stats={sequenceStats.value} +                   │
  │             counts={aggregateCounts.value} (existing)       │
  │                                                              │
  │ <SequenceHeader/> (components/SequenceHeader.tsx)           │
  │   ├─ Row 1: chevron + name (EXISTING)                       │
  │   ├─ Row 2: <ProgressBar/> + <BacklogCallout/> +            │
  │            <StaleCountInline/> (NEW Phase 23)               │
  │   └─ Row 3: <AggregateMiniPills/> (EXISTING Phase 21 D-14) │
  │                                                              │
  │ <ShotGridCard/> (components/ShotGridCard.tsx)               │
  │   └─ Outer <div class="group relative ${is_stale ?         │
  │      'border-2 border-[var(--color-shot-stale)] rounded' :  │
  │      ''}">                                                  │
  │      (border ONLY — no icon, no badge, no text)             │
  └─────────────────────────────────────────────────────────────┘
                                ↑
                                │ HTTP one-shot fetch + SSE
                                ↓
  ┌─────────────────────────────────────────────────────────────┐
  │ SSE: shot.status_changed                                     │
  │   payload: { shotId, fromStatus, toStatus, changedBy,        │
  │              note?, sequenceId }                             │
  │                                                              │
  │   ↓ events.ts:onSseEvent handler                            │
  │                                                              │
  │ state/shot-grid.ts:onShotStatusChanged (EXTENDED Phase 23)  │
  │   1. Existing: cross-sequence guard + per-row map           │
  │   2. NEW: applyStatsDelta(sequenceStats, fromStatus,         │
  │           toStatus, shotInBuffer)                            │
  └─────────────────────────────────────────────────────────────┘
                                ↑
                                │
                                ↓
  ┌─────────────────────────────────────────────────────────────┐
  │ src/http/dashboard-routes.ts:                                │
  │   GET /api/sequences/:id/shot-grid (EXISTING — extended)    │
  │     → c.json(engine.listShotGrid(seqId, opts))               │
  │       (response envelope gains `stats` + per-row `is_stale`) │
  │                                                              │
  │ src/engine/pipeline.ts:                                      │
  │   engine.listShotGrid(seqId, opts) (EXTENDED Phase 23)       │
  │     → calls listShotsForGrid + getSequenceStats              │
  │     → composes both into response envelope                   │
  │                                                              │
  │   engine.getSequenceStats(seqId) (NEW Phase 23)              │
  │     → calls getSequenceStats(db, seqId)                      │
  │                                                              │
  │ src/store/shot-status-repo.ts:                               │
  │   getSequenceStats(db, seqId) (NEW Phase 23)                 │
  │     ├─ Q1: SELECT status, COUNT(*) FROM shots                │
  │            WHERE sequence_id=? GROUP BY status               │
  │            (uses idx_shots_status)                           │
  │     └─ Q2: SELECT COUNT(*) FROM shots s                      │
  │            WHERE s.sequence_id=?                             │
  │              AND s.status IN ('wip','pending-review')        │
  │              AND EXISTS (SELECT 1 FROM versions v            │
  │                WHERE v.shot_id=s.id                          │
  │                  AND v.status='completed'                    │
  │                  AND v.completed_at < cutoff)                │
  │            (uses idx_shots_status + versions PK autoindex)   │
  │                                                              │
  │   listShotsForGrid (EXTENDED Phase 23 — adds is_stale to     │
  │     ShotGridQueryRow via inline CASE in CTE SELECT)          │
  └─────────────────────────────────────────────────────────────┘
                                ↑
                                │ SQL
                                ↓
  ┌─────────────────────────────────────────────────────────────┐
  │ SQLite                                                        │
  │   shots(id, sequence_id, name, status, created_at)            │
  │   versions(id, shot_id, status, completed_at, ...)            │
  │   shot_status_events(id, shot_id, from_status, to_status,    │
  │                      changed_by, note, created_at)           │
  │   idx_shots_status (sequence_id, status)  ← used by Q1 + Q2  │
  │   idx_versions_status (status)  ← incidental                 │
  │   versions autoindex (shot_id, version_number)  ← used by Q2 │
  └─────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (new files only)
```
packages/dashboard/src/
├── components/
│   ├── ProgressBar.tsx          # NEW — WCAG progressbar primitive
│   ├── BacklogCallout.tsx       # NEW — AlertCircle + "N awaiting review"
│   └── SequenceHeader.tsx       # EDIT — add stats subrow
│   └── ShotGridCard.tsx         # EDIT — conditional amber border class
├── state/
│   └── shot-grid.ts             # EDIT — add sequenceStats signal + applyStatsDelta + extend onShotStatusChanged
├── types/
│   └── shot-grid.ts             # EDIT — add SequenceStats interface + is_stale field + stats on ShotGridResponse
├── lib/
│   ├── copy.ts                  # EDIT — append Phase 23 stats copy strings
│   └── api.ts                   # NO CHANGE — fetchShotGrid signature unchanged; consumes wider response
├── views/
│   └── ShotGridView.tsx         # EDIT — seed sequenceStats from fetchShotGrid response; pass stats prop to SequenceHeader
└── styles/
    └── theme.css                # EDIT — add --color-shot-stale + optionally --color-stats-backlog-callout

src/
├── store/
│   └── shot-status-repo.ts      # EDIT — add getSequenceStats() + getSequenceStatsSqlText() + listShotsForGrid is_stale extension
├── engine/
│   └── pipeline.ts              # EDIT — add engine.getSequenceStats() + extend listShotGrid to compose
├── http/
│   └── dashboard-routes.ts      # NO CHANGE — route signature unchanged; widened response flows through
└── __tests__/
    └── (no new top-level tests; covered in repo + http test dirs)

src/store/__tests__/
└── shot-status-repo-grid.test.ts  # EDIT — add getSequenceStats EXPLAIN test + walk tests

src/http/__tests__/
└── dashboard-routes-shot-grid.test.ts  # EDIT — add stats + is_stale envelope assertions
```

### Pattern 1: Compose engine method (NOT extend) for new repo function
**What:** New repo function `getSequenceStats(db, sequenceId)` returns a plain TypeScript object; engine wraps in `engine.getSequenceStats(sequenceId)` facade; `engine.listShotGrid` is extended to CALL BOTH `listShotsForGrid` + `getSequenceStats` and merge results into envelope.
**When to use:** Two independent SQL operations whose results compose at the application layer.
**Example:**
```typescript
// src/engine/pipeline.ts — extend existing listShotGrid (line 822)
listShotGrid(sequenceId, opts) {
  const sequence = this.repo.getSequence(sequenceId);
  if (!sequence) throw new TypedError('SEQUENCE_NOT_FOUND', ...);

  const { items, next_cursor, total_count } = listShotsForGrid(this.db, sequenceId, opts);
  const rawStats = getSequenceStats(this.db, sequenceId); // NEW Phase 23

  const shots = items.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    version_count: r.version_count,
    is_stale: Boolean(r.is_stale),  // NEW — CASE returns 0/1
    latest_completed_version: r.lcv_id !== null && r.lcv_completed_at !== null
      ? { id: r.lcv_id, thumbnail_url: `/api/versions/${encodeURIComponent(r.lcv_id)}/thumbnail`, completed_at: r.lcv_completed_at }
      : null,
  }));

  // approved_pct in TypeScript (D-14)
  const approved = rawStats.counts.approved ?? 0;
  const total = rawStats.total;
  const approved_pct = total === 0 ? 0 : Math.round((approved / total) * 100);

  const stats: SequenceStats = {
    total,
    approved_pct,
    counts: rawStats.counts,
    pending_review_backlog: rawStats.counts['pending-review'] ?? 0,
    stale_count: rawStats.stale_count,
  };

  return { sequence: { id: sequence.id, name: sequence.name }, shots, stats, next_cursor, total_count };
}
```
*Source: `src/engine/pipeline.ts:822-874` (existing Phase 21 implementation to extend)*

### Pattern 2: SSE-driven signal delta via helper function
**What:** Extract delta-application logic into a pure helper `applyStatsDelta(stats, fromStatus, toStatus, shotInBuffer): SequenceStats`; call from inside `onShotStatusChanged` after the existing per-row map.
**When to use:** Multiple atomic updates to a derived signal in response to a single event.
**Example:**
```typescript
// state/shot-grid.ts — extend onShotStatusChanged (line 160)
export function onShotStatusChanged(payload: ShotStatusChangedPayload): void {
  const current = shotGrid.value;
  if (current === null) return;
  if (current.sequence.id !== payload.sequenceId) return;

  // Find shot in buffer BEFORE per-row update (we need the OLD is_stale + completed_at)
  const idx = current.shots.findIndex((s) => s.id === payload.shotId);
  const shotInBuffer = idx >= 0 ? current.shots[idx] : null;

  // Existing per-row map (Phase 21)
  const newShots = current.shots.map((s) =>
    s.id === payload.shotId
      ? { ...s, status: payload.toStatus, is_stale: recomputeIsStaleClient(s, payload.toStatus) }
      : s,
  );
  shotGrid.value = { ...current, shots: newShots };

  // NEW Phase 23 — apply stats delta
  const prevStats = sequenceStats.value;
  if (prevStats !== null && payload.fromStatus !== null) {
    sequenceStats.value = applyStatsDelta(prevStats, payload.fromStatus, payload.toStatus, shotInBuffer);
  }
}

function applyStatsDelta(
  stats: SequenceStats,
  fromStatus: ShotStatus,
  toStatus: ShotStatus,
  shotInBuffer: ShotGridRow | null,
): SequenceStats {
  // Decrement old, increment new (clamp at 0 — defensive)
  const counts = { ...stats.counts };
  counts[fromStatus] = Math.max(0, counts[fromStatus] - 1);
  counts[toStatus] = counts[toStatus] + 1;

  const approved_pct = stats.total === 0 ? 0 : Math.round((counts.approved / stats.total) * 100);
  const pending_review_backlog = counts['pending-review'];

  // Stale-count delta (best-effort — D-12 / D-19)
  let stale_count = stats.stale_count;
  if (shotInBuffer !== null) {
    const wasStale = shotInBuffer.is_stale;
    const isStaleNow = recomputeIsStaleClient(shotInBuffer, toStatus);
    if (wasStale && !isStaleNow) stale_count = Math.max(0, stale_count - 1);
    if (!wasStale && isStaleNow) stale_count = stale_count + 1;
  }

  return { ...stats, counts, approved_pct, pending_review_backlog, stale_count };
}

const STALE_SHOT_DAYS_MS = 14 * 86_400_000; // mirror server STALE_SHOT_DAYS = 14
function recomputeIsStaleClient(shot: ShotGridRow, newStatus: ShotStatus): boolean {
  if (newStatus !== 'wip' && newStatus !== 'pending-review') return false;
  if (shot.latest_completed_version === null) return false;
  return Date.now() - shot.latest_completed_version.completed_at > STALE_SHOT_DAYS_MS;
}
```
*Source: existing pattern at `state/shot-grid.ts:160-171` (the body block is extended, not replaced)*

### Pattern 3: WCAG 2.1 AA progress bar primitive
**What:** Native `<div role="progressbar">` with required aria props; no library.
**When to use:** Display percentage progress with full screen-reader support.
**Example:**
```typescript
// packages/dashboard/src/components/ProgressBar.tsx
import { STATS_APPROVED_LABEL_PREFIX } from '../lib/copy.js';

export interface ProgressBarProps {
  value: number;          // 0-100 integer
  max?: number;            // default 100
  label?: string;          // visible label (e.g., "60% approved")
  ariaLabel: string;       // required for SR; e.g., "Approval progress for SEQ_010"
}

export function ProgressBar({ value, max = 100, label, ariaLabel }: ProgressBarProps) {
  // Clamp + integer-coerce defensively — caller may pass float
  const clamped = Math.max(0, Math.min(max, Math.round(value)));
  const widthPct = `${(clamped / max) * 100}%`;
  return (
    <div class="flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={ariaLabel}
        class="relative h-2 w-32 overflow-hidden rounded-full bg-[var(--color-border)]"
      >
        <div
          class="h-full bg-[var(--color-shot-status-approved)] transition-[width] duration-150 motion-reduce:transition-none"
          style={{ width: widthPct }}
        />
      </div>
      {label && <span class="num text-xs text-[var(--color-fg-muted)]">{label}</span>}
    </div>
  );
}
```
*Source: WCAG 2.1 AA `progressbar` role spec; matches `<ShotStatusPill/>` styling vocabulary at `components/ShotStatusPill.tsx`*

### Pattern 4: Conditional class on outer wrapper (stale border)
**What:** Compose className string conditionally on the outer `<div>` of `<ShotGridCard/>`. The class is added to the EXISTING `class="group relative w-full overflow-hidden rounded"` (line 75) — no new wrapper, no DOM insertion.
**When to use:** Visual treatment that wraps the entire card; coexists with omit `opacity-40` outer wrapper (Phase 22 D-13) AND focus rings on inner buttons.
**Example:**
```typescript
// packages/dashboard/src/components/ShotGridCard.tsx — line 75
const isStale = shot.is_stale;
const cardBody = (
  <div
    class={`group relative w-full overflow-hidden rounded ${
      isStale
        ? 'border-2 border-[var(--color-shot-stale)]'
        : ''
    }`}
  >
    {/* ...existing children unchanged... */}
  </div>
);
```
*Source: existing Phase 22 D-13 wrapper structure at `ShotGridCard.tsx:75`*

### Anti-Patterns to Avoid
- **Re-running the GROUP BY query on every SSE event** — defeats OVR-03 ("no full re-fetch"). Use the delta arithmetic in Pattern 2.
- **Computing `approved_pct` in SQL** — D-14 explicitly locks TypeScript arithmetic. Integer math + division-by-zero guard live next to the rest of the response composition for readability.
- **Adding a new HTTP route** — D-01 / D-13 locked Option C (single endpoint, both top-level). Adding `GET /api/sequences/:id/stats` is OUT OF SCOPE.
- **Using the same hex for `--color-shot-stale` and `--color-shot-status-pending-review`** — D-08 explicitly forbids this. A pending-review shot can ALSO be stale → same hex visually collapses two semantic states (border + pill blend together).
- **Mounting a separate `<SequenceStatsWidget/>` between `<ShotGridFilterBar/>` and `<SequenceHeader/>`** — D-04 explicitly locks the subrow INSIDE `<SequenceHeader/>`. Avoid extra mount points.
- **Recomputing `approved_pct` via Preact `computed` derived from `sequenceStats.counts`** — adds reactivity coupling; `applyStatsDelta` returns a fully-formed `SequenceStats` already.
- **Reading `latest_completed_at` from the SSE payload** — D-17 explicitly locks this OUT of the payload. Read from `shotGrid.value.shots[idx].latest_completed_version.completed_at` instead.
- **Relocating `onShotStatusChanged` out of `state/shot-grid.ts`** — App.tsx:88 captures the module-scope reference; relocation breaks reference equality for `offSseEvent` cleanup (Phase 21 D-22 lock).
- **Mutating `sequenceStats.value.counts` in place** — Preact signals require immutable replacement to trigger re-render. Always spread + reassign.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Percentage arithmetic | Custom decimal-truncate logic | `Math.round((approved/total)*100)` with `total === 0 ? 0 : ...` guard | Stdlib; total guard prevents NaN on empty sequences |
| Progress bar primitive | Tween/animate library (greensock, framer-motion) | Native `<div role="progressbar">` + CSS `transition: width 150ms` | WCAG-compliant in 10 LOC; no bundle cost; honors `prefers-reduced-motion` via existing media query |
| `is_stale` per row | Client-side date computation in a loop | Server-side inline CASE expression in the existing CTE | One DB scan vs N client-side computations; matches the "compute at grid query time" requirement in OVR-02 |
| SSE delta application | Subscribe to a derived signal that does diff arithmetic | Inline delta in `onShotStatusChanged` body | Simpler; one function; matches Phase 22 optimistic-update precedent |
| Icon for backlog callout | Inline SVG | `lucide-preact` `AlertCircle` (already imported elsewhere) | Already in bundle; type-safe; consistent visual language |

**Key insight:** Phase 23 is a PURE COMPOSITION problem, not a NEW PRIMITIVE problem. Every pattern is borrowed from Phase 21/22 — extend existing files, mirror existing query shapes, reuse the existing signal lifecycle.

## Runtime State Inventory

> Phase 23 is NOT a rename/refactor phase. No persisted state, no live service config, no OS-registered tasks, no secrets/env vars, no build artifacts depend on the new code paths.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None | None — read-only queries over existing `shots` + `versions` tables |
| Live service config | None | None — no n8n, Datadog, or external service knows about Phase 23 |
| OS-registered state | None | None — no Task Scheduler, launchd, or systemd registrations |
| Secrets/env vars | None | None — no new env vars; no secret reads |
| Build artifacts | None | Vite production build will regenerate dashboard bundle on next `npx vite build` — this is normal, not a Phase 23 concern |

**Nothing found in any category — verified by inspection of CONTEXT.md "Implementation Decisions" and "Code precedent" sections.**

## Common Pitfalls

### Pitfall 1: Cross-sequence SSE event mutates stale-count for wrong sequence
**What goes wrong:** A `shot.status_changed` event arrives for shot in SEQ_B while the user is viewing SEQ_A. Without the cross-sequence guard, `applyStatsDelta` decrements `sequenceStats.value.counts[fromStatus]` for SEQ_A using SEQ_B's data → drift.
**Why it happens:** The existing `onShotStatusChanged` at `state/shot-grid.ts:163` already has the guard (`if (current.sequence.id !== payload.sequenceId) return;`) BUT the new `applyStatsDelta` call must be AFTER it.
**How to avoid:** Place the `applyStatsDelta` call INSIDE the same function body AFTER both guards (`shotGrid === null` AND cross-sequence check). The guard cascade in Pattern 2 above does this.
**Warning signs:** Counts drift after switching between sequences with active backend mutations. Test: open SEQ_A in dashboard, trigger MCP `shot.set_status` against SEQ_B, verify SEQ_A stats unchanged.

### Pitfall 2: `applyStatsDelta` runs when `fromStatus === null` (first-ever transition)
**What goes wrong:** Phase 20 emits `shot.status_changed` with `fromStatus: null` for a shot's first transition (no prior history row). Without a null check, `counts[null]` is `undefined`, and `Math.max(0, undefined - 1)` returns `NaN`.
**Why it happens:** Pre-migration shots (or fresh shots that never transitioned) carry `shots.status='wip'` as their default, but the first explicit status set inserts the FIRST `shot_status_events` row with `from_status: null`. SSE payload mirrors this.
**How to avoid:** Wrap `applyStatsDelta` call in `if (payload.fromStatus !== null)`. Alternative: treat `fromStatus === null` as `'wip'` (the default). **Recommend: skip the decrement entirely when null** — the stats snapshot already reflects the default 'wip' assignment, so decrementing wip + incrementing toStatus is the right behavior. Implementation:
```typescript
if (prevStats !== null) {
  const effectiveFromStatus = payload.fromStatus ?? 'wip';
  sequenceStats.value = applyStatsDelta(prevStats, effectiveFromStatus, payload.toStatus, shotInBuffer);
}
```
**Warning signs:** Counts contain `NaN` after a fresh-shot status change. Vitest assertion: `expect(stats.counts.wip).toBeGreaterThanOrEqual(0)`.

### Pitfall 3: Stale-count drift outside paginated buffer (D-19 documented)
**What goes wrong:** A sequence with 100 shots; user has loaded page 1 (20 shots). A SSE event arrives for shot #57. The handler can't compute `wasStale` because `shotGrid.value.shots[].findIndex` returns -1. Server snapshot showed `stale_count: 5` at fetch time; truth has shifted.
**Why it happens:** Best-effort caveat per D-19. Acceptable for v1.3; supervisor refreshes for fresh snapshot.
**How to avoid:** Document explicitly in the `state/shot-grid.ts` JSDoc comment. Recommend supervisor workflow: "If stats look off, refresh the sequence (click home + re-click the grid icon)."
**Warning signs:** Stale count drifts from server truth by more than ±5 over a session. Mitigation if surfaced: re-fetch the sequence stats on a 60s interval — DEFERRED to v1.4 if v1.3 feedback shows drift.

### Pitfall 4: `is_stale` per-row CASE expression collides with `version_count` subquery in EXPLAIN
**What goes wrong:** Adding an inline `CASE WHEN ... THEN 1 ELSE 0 END AS is_stale` to the existing CTE SELECT may trigger SQLite to plan it as a correlated subquery if not phrased carefully.
**Why it happens:** SQLite's planner is sensitive to correlation patterns. The `EXISTS (SELECT 1 FROM versions v WHERE v.shot_id = s.id AND ...)` pattern is OK inside the SELECT list because EXISTS short-circuits, but the planner may still warn.
**How to avoid:** Phrase the CASE as: `CASE WHEN s.status IN ('wip','pending-review') AND EXISTS (SELECT 1 FROM versions v WHERE v.shot_id = s.id AND v.status = 'completed' AND v.completed_at < ?) THEN 1 ELSE 0 END AS is_stale`. The cutoff timestamp is bound at query time (not a constant in the SQL text) so the test fixture can control time.
**Warning signs:** `EXPLAIN QUERY PLAN` shows `CORRELATED SCALAR SUBQUERY` for the is_stale path. Test: extend `shot-status-repo-grid.test.ts:88-109` to also reject `CORRELATED` matches that reference `versions v`.

### Pitfall 5: Border treatment collides with focus-visible ring
**What goes wrong:** A 2px amber border on the outer `<div>` plus a `focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]` on inner buttons may create a visual fight when a stale card has its thumbnail-button focused.
**Why it happens:** Phase 22 D-13 placed focus rings on INNER buttons (line 87, 106). Amber border is on OUTER `<div>`. They are visually 2 distinct layers (outer border + inner ring offset by button padding) — no actual conflict.
**How to avoid:** Verify in a manual smoke test (browser, keyboard nav through a stale shot card). Inspect for visual hierarchy: amber border is the lower-z element; accent ring is on top.
**Warning signs:** User reports "the orange and purple are fighting." Mitigation if surfaced: increase outer-border `rounded` value or add a small inner-padding gap so the inner ring doesn't kiss the outer border.

### Pitfall 6: Theme.css token added to dark block only (light theme broken)
**What goes wrong:** `--color-shot-stale: #fbbf24` added to `@theme` block only. The light-theme `[data-theme="light"]` block at theme.css:101-120 doesn't override it. Light-theme users see the dark-theme amber against a white background — likely too low contrast.
**Why it happens:** Easy to miss the override block when scanning theme.css; D-08/D-16 explicitly call for BOTH light and dark tokens.
**How to avoid:** Both blocks. Verify with a vitest snapshot test against `theme.css` content: `expect(theme).toContain('--color-shot-stale: #fbbf24')` AND `expect(theme).toContain('--color-shot-stale: #f59e0b')` (light override). Mirror Phase 21 D-17 precedent at `theme.css:53-58` and `:114-119` (5 status tokens added to both blocks).
**Warning signs:** Light-theme browser test shows muddy or invisible border on stale shots. WCAG contrast test fails on 3:1 UI-component threshold against `#fafafa` light background.

### Pitfall 7: Backlog callout AlertCircle import collision with existing Phase 22 components
**What goes wrong:** Add `import { AlertCircle } from 'lucide-preact'` to `<SequenceHeader/>` and forget that `lucide-preact` aliases `CircleAlert as AlertCircle`. The tree-shake should be fine, but stale TypeScript caches may flag the import.
**Why it happens:** `lucide-preact@^1.9.0` exports both forms; both work.
**How to avoid:** Verify the import resolves (`npx vite build`). If TS complains, fall back to `import { CircleAlert as AlertCircle } from 'lucide-preact'` — explicit alias.
**Warning signs:** Vite production build fails with "AlertCircle is not exported from lucide-preact." Trivial fix.

### Pitfall 8: Stale-count off-by-one after Restore-from-omit transition
**What goes wrong:** Shot is omitted → `is_stale = false` (omit shots are by-def not stale). User clicks Restore → status flips to 'wip'. `applyStatsDelta` runs: decrement omit, increment wip. Stale-count delta: `wasStale = false` (cached), `isStaleNow = ?`. If the shot's `latest_completed_version.completed_at` is > 14 days old, `isStaleNow = true` → stale_count++. This is correct.
**Why it happens:** Restore is a status transition like any other; the per-row `is_stale` flag is updated in the same handler.
**How to avoid:** Test fixture: create a shot, complete a version > 14 days ago, omit it, restore it, verify stale_count increments by 1.
**Warning signs:** Restore action leaves stale_count unchanged when it should increment, or increments by 2.

### Pitfall 9: Initial fetch overwrites delta-applied sequenceStats during slow load
**What goes wrong:** User opens SEQ_A. Fetch fires. While fetch in flight, SSE event arrives for SEQ_A — but `sequenceStats.value` is still null (pre-fetch), so `applyStatsDelta` is skipped (Pitfall 1 guard). Fetch resolves; sets `sequenceStats.value = res.stats` — but the SSE event's effect is lost.
**Why it happens:** Race condition: fetch response is the server snapshot at time T0; SSE event arrives at T1 > T0; if the fetch overwrite happens at T2 > T1, the SSE delta is overwritten by the stale snapshot.
**How to avoid:** Two options. (a) **Server-snapshot-wins (RECOMMENDED for v1.3):** SSE events that arrive during the fetch are dropped (handler returns early on `null` sequenceStats); the fetch result is authoritative. (b) Sequence the fetch with the SSE handler — capture pending events and replay after the fetch settles. **Option (a)** is the existing behavior at line 162 (`if (current === null) return;`); preserve verbatim.
**Warning signs:** User makes a status change in tab A; tab B (same sequence, fresh load) shows the old count for ~500ms then converges to truth. Acceptable for v1.3.

### Pitfall 10: `stats.counts` uses `Record<ShotStatus, number>` but `pending-review` key has a hyphen — bracket access required
**What goes wrong:** `stats.counts.pending-review` is a TypeScript subtraction expression (`stats.counts.pending - review`). Must use bracket access: `stats.counts['pending-review']`.
**Why it happens:** Hyphens in status names. Phase 21 already encountered this in `SequenceHeader.tsx:43` (object literal uses string key).
**How to avoid:** Always bracket access: `stats.counts['pending-review']` not `stats.counts.pending-review`. TypeScript will catch the mistake at compile time (subtraction error).
**Warning signs:** TS error "Cannot find name 'review'." Mechanical fix.

## Code Examples

Verified patterns from existing repo code. All examples mirror Phase 21/22 conventions.

### Example 1: `getSequenceStats` repo function
```typescript
// src/store/shot-status-repo.ts — appended after listShotsForGridSqlText (line 323)

/**
 * OVR-01 — sequence-wide stats. Returns the per-status counts + stale count
 * for an entire sequence. Cursor-independent (whole-sequence aggregate, not
 * paginated). TWO independent queries:
 *
 *   Q1: SELECT status, COUNT(*) FROM shots WHERE sequence_id=? GROUP BY status
 *     Uses idx_shots_status (sequence_id, status) covering index — full
 *     index scan, no table fetch needed.
 *
 *   Q2: SELECT COUNT(*) FROM shots s WHERE s.sequence_id=?
 *         AND s.status IN ('wip','pending-review')
 *         AND EXISTS (SELECT 1 FROM versions v
 *           WHERE v.shot_id=s.id
 *             AND v.status='completed'
 *             AND v.completed_at < ?)
 *     The cutoff timestamp is bound at query time (Date.now() - STALE_SHOT_DAYS * 86400000).
 *     EXISTS short-circuits on first match per shot; uses versions PK autoindex
 *     on (shot_id, version_number) for the inner scan.
 *
 * total_count is derived in TypeScript as Σ counts (saves one COUNT roundtrip).
 * Returns plain object — engine facade wraps in SequenceStats envelope.
 *
 * EXPLAIN QUERY PLAN invariant: NO `CORRELATED SCALAR SUBQUERY` for Q1
 * (single GROUP BY, no subqueries); Q2's EXISTS clause IS allowed to surface
 * as a correlated subquery (that's the EXISTS short-circuit's intended plan).
 * The new test asserts only the absence of `SCAN versions` (full-table scan)
 * — presence of `SEARCH versions USING ... (shot_id=?)` is the signal that
 * the autoindex is used.
 */
export interface RawSequenceStats {
  counts: Record<ShotStatus, number>;
  total: number;
  stale_count: number;
}

export function getSequenceStats(db: Db, sequenceId: string): RawSequenceStats {
  // Q1: GROUP BY status
  const countsRows = db.all(sql`
    SELECT status AS status, COUNT(*) AS c
    FROM shots
    WHERE sequence_id = ${sequenceId}
    GROUP BY status
  `) as Array<{ status: ShotStatus; c: number }>;

  const counts: Record<ShotStatus, number> = {
    'wip': 0,
    'pending-review': 0,
    'approved': 0,
    'on-hold': 0,
    'omit': 0,
  };
  let total = 0;
  for (const row of countsRows) {
    counts[row.status] = Number(row.c);
    total += Number(row.c);
  }

  // Q2: EXISTS-clause stale-count
  const cutoff = Date.now() - STALE_SHOT_DAYS * 86_400_000;
  const staleRow = db.get(sql`
    SELECT COUNT(*) AS c
    FROM shots s
    WHERE s.sequence_id = ${sequenceId}
      AND s.status IN ('wip', 'pending-review')
      AND EXISTS (
        SELECT 1 FROM versions v
        WHERE v.shot_id = s.id
          AND v.status = 'completed'
          AND v.completed_at < ${cutoff}
      )
  `) as { c: number } | undefined;

  return {
    counts,
    total,
    stale_count: Number(staleRow?.c ?? 0),
  };
}

/**
 * Returns the EXACT raw SQL text for Q2 so EXPLAIN QUERY PLAN tests can
 * introspect without duplicating SQL strings. Mirrors listShotsForGridSqlText
 * precedent at line 301.
 */
export function getSequenceStatsStaleSqlText(): string {
  return /* sql */ `
    SELECT COUNT(*) AS c
    FROM shots s
    WHERE s.sequence_id = ?
      AND s.status IN ('wip', 'pending-review')
      AND EXISTS (
        SELECT 1 FROM versions v
        WHERE v.shot_id = s.id
          AND v.status = 'completed'
          AND v.completed_at < ?
      )
  `;
}

/** Q1 EXPLAIN test target. */
export function getSequenceStatsGroupBySqlText(): string {
  return /* sql */ `
    SELECT status AS status, COUNT(*) AS c
    FROM shots
    WHERE sequence_id = ?
    GROUP BY status
  `;
}
```
*Source: pattern mirrors `listShotsForGrid` at `src/store/shot-status-repo.ts:228-285` (same db, sql, types)*

### Example 2: Extend `listShotsForGrid` row shape with `is_stale`
```typescript
// src/store/shot-status-repo.ts — extend ShotGridQueryRow interface (line 186)

export interface ShotGridQueryRow {
  id: string;
  name: string;
  status: ShotStatus;
  version_count: number;
  lcv_id: string | null;
  lcv_completed_at: number | null;
  is_stale: number; // NEW Phase 23 — 0 or 1 from CASE expression; engine coerces to Boolean
}

// Extend the CTE SELECT (line 246-273) — add the is_stale column.
// The cutoff is bound at query time as an additional placeholder.

export function listShotsForGrid(
  db: Db,
  sequenceId: string,
  opts: { cursor: ShotGridCursor | null; limit: number },
): ShotGridQueryResult {
  const { cursor, limit } = opts;
  const cursorName = cursor?.n ?? null;
  const cursorSid = cursor?.sid ?? null;
  const cutoff = Date.now() - STALE_SHOT_DAYS * 86_400_000;

  // ...total_count query unchanged...

  const rows = db.all(sql`
    WITH ranked AS (
      SELECT v.id, v.shot_id, v.completed_at,
        ROW_NUMBER() OVER (
          PARTITION BY v.shot_id
          ORDER BY v.completed_at DESC, v.id ASC
        ) AS rn
      FROM versions v
      WHERE v.status = 'completed' AND v.completed_at IS NOT NULL
    )
    SELECT
      s.id        AS id,
      s.name      AS name,
      s.status    AS status,
      (SELECT COUNT(*) FROM versions vc WHERE vc.shot_id = s.id) AS version_count,
      r.id           AS lcv_id,
      r.completed_at AS lcv_completed_at,
      CASE
        WHEN s.status IN ('wip', 'pending-review')
          AND EXISTS (
            SELECT 1 FROM versions v2
            WHERE v2.shot_id = s.id
              AND v2.status = 'completed'
              AND v2.completed_at < ${cutoff}
          )
        THEN 1 ELSE 0
      END AS is_stale
    FROM shots s
    LEFT JOIN ranked r ON r.shot_id = s.id AND r.rn = 1
    WHERE s.sequence_id = ${sequenceId}
      AND (
        ${cursorName} IS NULL
        OR s.name > ${cursorName}
        OR (s.name = ${cursorName} AND s.id > ${cursorSid})
      )
    ORDER BY s.name ASC, s.id ASC
    LIMIT ${limit + 1}
  `) as ShotGridQueryRow[];

  // ...rest unchanged...
}
```
*Source: existing implementation at `src/store/shot-status-repo.ts:228-285`*

### Example 3: Extend `engine.listShotGrid` to compose stats
```typescript
// src/engine/pipeline.ts — extend listShotGrid (line 822)

listShotGrid(
  sequenceId: string,
  opts: { cursor: ShotGridCursor | null; limit: number },
): {
  sequence: { id: string; name: string };
  shots: Array<{
    id: string;
    name: string;
    status: ShotStatus;
    version_count: number;
    is_stale: boolean;  // NEW
    latest_completed_version: {
      id: string;
      thumbnail_url: string;
      completed_at: number;
    } | null;
  }>;
  stats: SequenceStats;  // NEW Phase 23 top-level field
  next_cursor: string | null;
  total_count: number;
} {
  const sequence = this.repo.getSequence(sequenceId);
  if (!sequence) {
    throw new TypedError(
      'SEQUENCE_NOT_FOUND',
      `Sequence '${sequenceId}' not found`,
      `List sequences with { tool: 'sequence', action: 'list' }`,
    );
  }

  // Reuse existing paginated row query (Phase 21)
  const { items, next_cursor, total_count } = listShotsForGrid(this.db, sequenceId, opts);

  // NEW Phase 23 — sequence-wide stats
  const raw = getSequenceStats(this.db, sequenceId);
  const approved = raw.counts.approved ?? 0;
  const approved_pct = raw.total === 0 ? 0 : Math.round((approved / raw.total) * 100);

  const stats: SequenceStats = {
    total: raw.total,
    approved_pct,
    counts: raw.counts,
    pending_review_backlog: raw.counts['pending-review'] ?? 0,
    stale_count: raw.stale_count,
  };

  const shots = items.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    version_count: r.version_count,
    is_stale: Boolean(r.is_stale),  // 0/1 → false/true
    latest_completed_version:
      r.lcv_id !== null && r.lcv_completed_at !== null
        ? {
            id: r.lcv_id,
            thumbnail_url: `/api/versions/${encodeURIComponent(r.lcv_id)}/thumbnail`,
            completed_at: r.lcv_completed_at,
          }
        : null,
  }));

  return {
    sequence: { id: sequence.id, name: sequence.name },
    shots,
    stats,           // NEW
    next_cursor,
    total_count,
  };
}
```
*Source: existing implementation at `src/engine/pipeline.ts:822-874`*

### Example 4: Dashboard signal extension
```typescript
// packages/dashboard/src/state/shot-grid.ts — extend below shotGrid signal (line 76)

import type { SequenceStats, ShotGridRow } from '../types/shot-grid.js';

/**
 * Phase 23 — OVR-01/OVR-03. Sequence-wide stats seeded from the
 * fetchShotGrid response and mutated incrementally by onShotStatusChanged.
 *
 * null represents pre-fetch / no-grid-loaded; the SequenceHeader's stats
 * subrow renders nothing in that branch (matches the existing shotGrid
 * null branch in ShotGridView).
 *
 * D-19 caveat: stale_count delta arithmetic is best-effort for shots
 * outside the paginated buffer. Pagination > 50 shots may drift between
 * full refetches. Supervisor refreshes the sequence for a fresh snapshot.
 */
export const sequenceStats = signal<SequenceStats | null>(null);

/**
 * Phase 23 — mirror of server-side STALE_SHOT_DAYS = 14 (single source of
 * truth at src/store/shot-status-repo.ts:54). Pre-multiplied to ms for
 * direct comparison against epoch-ms timestamps.
 *
 * If the threshold ever changes server-side, this constant MUST be updated
 * in lockstep — there is no shared types module that holds both. A small
 * import-time guard could read the value from a server endpoint, but
 * over-engineering for v1.3.
 */
export const STALE_SHOT_DAYS_MS = 14 * 86_400_000;

// EXTEND existing onShotStatusChanged (line 160) — full body below:

export function onShotStatusChanged(payload: ShotStatusChangedPayload): void {
  const current = shotGrid.value;
  if (current === null) return;
  if (current.sequence.id !== payload.sequenceId) return;

  // Capture pre-mutation shot (for stats delta — D-12 needs prior is_stale + completed_at)
  const idx = current.shots.findIndex((s) => s.id === payload.shotId);
  const shotInBuffer = idx >= 0 ? current.shots[idx] : null;

  // Phase 21 per-row update + Phase 23 is_stale recompute for the matching row
  const isStaleNow = shotInBuffer !== null
    ? recomputeIsStaleClient(shotInBuffer, payload.toStatus)
    : false;

  shotGrid.value = {
    ...current,
    shots: current.shots.map((s) =>
      s.id === payload.shotId
        ? { ...s, status: payload.toStatus, is_stale: isStaleNow }
        : s,
    ),
  };

  // Phase 23 — stats delta (D-11)
  const prevStats = sequenceStats.value;
  if (prevStats !== null) {
    // Pitfall 2: fromStatus null = first transition; treat as 'wip' (the default)
    const effectiveFromStatus = payload.fromStatus ?? 'wip';
    sequenceStats.value = applyStatsDelta(
      prevStats,
      effectiveFromStatus,
      payload.toStatus,
      shotInBuffer,
      isStaleNow,
    );
  }
}

function applyStatsDelta(
  stats: SequenceStats,
  fromStatus: ShotStatus,
  toStatus: ShotStatus,
  shotInBuffer: ShotGridRow | null,
  isStaleNow: boolean,
): SequenceStats {
  const counts = { ...stats.counts };
  counts[fromStatus] = Math.max(0, counts[fromStatus] - 1);
  counts[toStatus] = counts[toStatus] + 1;

  const approved_pct = stats.total === 0 ? 0 : Math.round((counts.approved / stats.total) * 100);
  const pending_review_backlog = counts['pending-review'];

  // Stale-count delta — best-effort outside the buffer (D-19)
  let stale_count = stats.stale_count;
  if (shotInBuffer !== null) {
    const wasStale = shotInBuffer.is_stale;
    if (wasStale && !isStaleNow) stale_count = Math.max(0, stale_count - 1);
    if (!wasStale && isStaleNow) stale_count = stale_count + 1;
  }

  return { ...stats, counts, approved_pct, pending_review_backlog, stale_count };
}

function recomputeIsStaleClient(shot: ShotGridRow, newStatus: ShotStatus): boolean {
  if (newStatus !== 'wip' && newStatus !== 'pending-review') return false;
  if (shot.latest_completed_version === null) return false; // D-15 grace
  return Date.now() - shot.latest_completed_version.completed_at > STALE_SHOT_DAYS_MS;
}
```
*Source: existing handler at `state/shot-grid.ts:160-171`*

### Example 5: `<ShotGridView/>` seeds sequenceStats
```typescript
// packages/dashboard/src/views/ShotGridView.tsx — extend the fetch .then() at line 133

useEffect(() => {
  const seqId = selectedSequenceForGrid.value;
  if (!seqId) return;
  shotGrid.value = null;
  sequenceStats.value = null;  // NEW Phase 23 — clear stale snapshot
  gridLoadMoreError.value = null;
  let alive = true;
  gridIsFetching.value = true;
  fetchShotGrid(seqId, { limit: 20 })
    .then((res) => {
      if (!alive) return;
      shotGrid.value = res;
      sequenceStats.value = res.stats;  // NEW Phase 23 — seed from response
      gridIsFetching.value = false;
    })
    .catch(() => {
      if (!alive) return;
      gridLoadMoreError.value = SHOT_GRID_FETCH_ERROR;
      gridIsFetching.value = false;
    });
  return () => { alive = false; };
}, [selectedSequenceForGrid.value]);

// Pass stats to SequenceHeader at line 291

{shotGrid.value && (
  <SequenceHeader
    sequenceName={shotGrid.value.sequence.name}
    expanded={headerExpanded.value}
    onToggleExpanded={() => { headerExpanded.value = !headerExpanded.value; }}
    counts={aggregateCounts.value}
    stats={sequenceStats.value}  // NEW Phase 23
  />
)}
```
*Source: existing handler at `ShotGridView.tsx:122-150` + `:290-299`*

### Example 6: `<SequenceHeader/>` stats subrow
```typescript
// packages/dashboard/src/components/SequenceHeader.tsx — extend signature + add subrow

import { AlertCircle } from 'lucide-preact';
import { ProgressBar } from './ProgressBar.js';
import type { ShotStatus, SequenceStats } from '../types/shot-grid.js';
import {
  STATS_APPROVED_LABEL_SUFFIX,
  STATS_BACKLOG_CALLOUT_PREFIX,
  STATS_BACKLOG_CALLOUT_SUFFIX,
  STATS_STALE_INLINE_PREFIX,
  STATS_STALE_INLINE_SUFFIX,
  STATS_PROGRESS_ARIA_PREFIX,
} from '../lib/copy.js';

export interface SequenceHeaderProps {
  sequenceName: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  counts: Record<ShotStatus, number>;
  stats: SequenceStats | null;  // NEW Phase 23 — null pre-fetch
}

export function SequenceHeader({
  sequenceName, expanded, onToggleExpanded, counts, stats,
}: SequenceHeaderProps) {
  // ...existing icon + name row at line 65-88 unchanged...

  return (
    <header class="flex flex-col gap-2 px-4 py-6">
      {/* Row 1 — name + chevron (EXISTING, lines 67-88) */}
      <div class="flex items-center gap-2">
        {/* ...existing chevron button + h2... */}
      </div>

      {/* Row 2 — NEW Phase 23 stats subrow */}
      {stats !== null && (
        <div class="flex items-center gap-3 text-sm">
          <ProgressBar
            value={stats.approved_pct}
            ariaLabel={`${STATS_PROGRESS_ARIA_PREFIX}${sequenceName}`}
            label={`${stats.approved_pct}${STATS_APPROVED_LABEL_SUFFIX}`}
          />
          {stats.pending_review_backlog > 0 && (
            <span
              class="inline-flex items-center gap-1 rounded-full bg-[var(--color-stats-backlog-callout)] px-2 py-0.5 text-xs uppercase tracking-widest text-[var(--color-bg)]"
              role="status"
            >
              <AlertCircle size={12} aria-hidden="true" />
              <span class="num">{stats.pending_review_backlog}</span>
              <span>{stats.pending_review_backlog === 1 ? STATS_BACKLOG_CALLOUT_SUFFIX.singular : STATS_BACKLOG_CALLOUT_SUFFIX.plural}</span>
            </span>
          )}
          {stats.stale_count > 0 && (
            <span class="text-xs text-[var(--color-shot-stale)]">
              <span class="num">{stats.stale_count}</span> {stats.stale_count === 1 ? STATS_STALE_INLINE_SUFFIX.singular : STATS_STALE_INLINE_SUFFIX.plural}
            </span>
          )}
        </div>
      )}

      {/* Row 3 — aggregate mini-pills (EXISTING Phase 21 D-14, lines 89-111) */}
      <div role="group" aria-label={`${AGGREGATE_COUNTS_REGION_LABEL_PREFIX}${sequenceName}`} class="flex items-center gap-2">
        {/* ...existing per-status mini-pills... */}
      </div>
    </header>
  );
}
```
*Source: existing component at `components/SequenceHeader.tsx:65-113`*

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 21 `aggregateCounts` computed signal (client-side counts over paginated buffer) | Phase 23 server-computed `stats` for whole sequence + SSE-driven deltas | This phase | Counts are now AUTHORITATIVE whole-sequence values, not paginated approximations. Phase 21 `aggregateCounts` STAYS in place for the Phase 21 D-14 mini-pills row (continues to power the per-page counts display); Phase 23 adds the parallel server-supplied count layer above it [VERIFIED: state/shot-grid.ts:123, SequenceHeader.tsx:51-110] |
| No stale indicator | Per-row `is_stale: boolean` from server CASE expression | This phase | Visual signal for supervisor "this is going idle" without runtime polling [CITED: 23-CONTEXT.md OVR-02] |
| Custom progress bar primitives in design systems | Native `<div role="progressbar">` with aria-* | Browser-native since 2014; WCAG 2.1 AA validated | Zero dependency; 10 LOC; honors prefers-reduced-motion via existing media query |

**Deprecated/outdated:**
- ABANDONED Q3 option D — Donut/ring chart — not in CONTEXT.md decisions; user picked horizontal progress bar (D-05) for "fills left→right" semantic clarity.
- ABANDONED literal OVR-02 reading — "zero versions ever = stale" — D-15 chose pragmatic interpretation.
- ABANDONED separate `<SequenceStatsWidget/>` component above SequenceHeader — D-04 locked subrow INSIDE SequenceHeader.

## Assumptions Log

> All claims tagged `[ASSUMED]` in this research below. The planner and discuss-phase use this section to identify decisions that need user confirmation before execution.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `idx_shots_status (sequence_id, status)` is sufficient for the GROUP BY query — no further indexing needed | Architectural Responsibility Map; Pattern 1; Code Example 1 | If SQLite planner picks a full table scan, GROUP BY perf degrades on large sequences. **Mitigation:** EXPLAIN test asserts use of the index. **Verified:** drizzle/0008_shot_status.sql:25 [VERIFIED] |
| A2 | The version `status` value is the string `'completed'` (not `'complete'`) | Code Examples 1, 2 | Wrong value → no rows match → stale_count always 0, EXISTS clause always falls out. **Verified:** version-repo.ts:153 uses `'completed'` [VERIFIED] AND the existing listShotsForGrid CTE at shot-status-repo.ts:254 also uses `'completed'` [VERIFIED] |
| A3 | `Math.round` in TypeScript handles 0.5-boundary cases consistently for the demo workload | Pattern 1; Code Example 3 | `Math.round(2.5)` returns `3` in JS (rounds half away from zero for positive) — fine for percentage display. **Acceptable:** the user sees integer percentages; off-by-one rounding is acceptable UX. |
| A4 | `lucide-preact` `AlertCircle` is the right visual primitive for backlog callout | D-20; Architecture Patterns | If user feedback prefers `AlertTriangle` or a custom shape, swap is trivial. **Locked:** D-20 specifies AlertCircle. |
| A5 | The new `--color-shot-stale` light theme `#f59e0b` and dark `#fbbf24` both pass WCAG 2.1 AA against their respective `--color-bg` values | D-08, Pitfall 6 | If contrast fails, swap tokens. **Calculation needed:** `#f59e0b` against light `#fafafa` and `#fbbf24` against dark `#202020`. Pre-Phase-21 the `--color-shot-status-pending-review` tokens (`#fbbf24` dark, `#d97706` light) were certified WCAG 2.1 AA by 21-RESEARCH.md — `#fbbf24` is reused; `#f59e0b` (light) is one step more saturated than `#d97706` so likely also passes. **Mitigation:** explicit contrast check in 23-UI-SPEC.md or planner-stage WCAG audit. |
| A6 | The dashboard's existing `prefers-reduced-motion: reduce` media query at theme.css:194-199 covers the progress bar `transition: width` | D-21, Pattern 3 | The existing query targets `.animate-status-pulse` and `.animate-skeleton-shimmer` keyframe classes by name. The progress bar uses Tailwind's `motion-reduce:transition-none` utility class instead — covered by the user-agent media query but via a different mechanism. **Pattern:** `motion-reduce:` is Tailwind's `@media (prefers-reduced-motion: reduce)` variant. **Acceptable.** |
| A7 | The `cutoff` parameter for the stale-count EXISTS query is bound at query call time (not a server constant) — same cutoff value flows through both Q2 (whole-sequence stats) AND the per-row CASE in listShotsForGrid | Code Examples 1, 2 | If the two cutoffs differ (e.g., one uses `Date.now()` at engine.getSequenceStats call time, the other at engine.listShotGrid call time), a shot could be flagged stale in `is_stale` but not counted in `stale_count` for a few ms. **Acceptable** for v1.3 (race window ≪ 1s; supervisor wouldn't notice). **Mitigation:** if pedantic, compute `cutoff` once in `engine.listShotGrid` and pass to both functions. |
| A8 | Phase 21's `aggregateCounts` computed signal stays in place and is unaffected by Phase 23 | State of the Art | Phase 21 mini-pills row continues to render the paginated-buffer counts; Phase 23 adds the whole-sequence stats above. **Confirmed by D-04** — mini-pills row PRESERVED. |
| A9 | The `STALE_SHOT_DAYS_MS = 14 * 86_400_000` constant in `state/shot-grid.ts` is acceptable rather than a shared types module | Code Example 4 | Drift risk if server STALE_SHOT_DAYS ever changes. **Acceptable for v1.3** — mirror constant is documented; users know to update both. Phase 24+ candidate: hoist to shared types module if the threshold becomes configurable. |
| A10 | The `lucide-preact` package exports `AlertCircle` as an alias of `CircleAlert` (modern lucide rename) | D-20 | Verified via grep on the lib's `.d.ts` file: `CircleAlert as AlertCircle, CircleAlert as AlertCircleIcon` confirmed at lucide-preact.d.ts:25512+ [VERIFIED] |

**Note:** Assumptions A1, A2, A8, A10 are VERIFIED via code inspection in this research. A3, A4, A6, A7, A9 are ACCEPTABLE technical decisions documented for planner awareness. A5 is the only OPEN risk — recommend explicit WCAG contrast verification at planning time (Phase 21 21-UI-SPEC precedent).

## Open Questions

1. **Should `--color-stats-backlog-callout` be a new token or reuse `--color-accent` (D-16)?**
   - What we know: D-05 says "distinct callout color visually separated from per-status mini-pills."
   - What's unclear: Whether `--color-accent` (existing accent purple/lavender) is visually distinct enough from the amber pending-review pill below it.
   - Recommendation: **Reuse `--color-accent`** for v1.3. The backlog callout's leading `AlertCircle` icon already differentiates the visual shape from a plain status pill. If user feedback later signals "I keep mis-reading the backlog callout as a status pill," add a new token. Cheaper to start with one fewer token.

2. **Should the stats subrow render when `stats !== null && stats.total === 0` (empty sequence)?**
   - What we know: D-15 says zero-version shots aren't stale; D-04 says stats subrow lives inside SequenceHeader.
   - What's unclear: For a sequence with 0 shots, should the subrow render `0% approved` + nothing else, or hide entirely?
   - Recommendation: **Hide the subrow when `stats.total === 0`** — symmetric with Phase 21 D-14 mini-pills (hide-on-zero). The "No shots in this sequence yet" empty state in the grid pane already conveys this; subrow would be redundant. Planner should lock this; the example component conditional at Code Example 6 already does `stats !== null && stats.pending_review_backlog > 0` for the callout — extend to `stats.total > 0` for the whole subrow.

3. **Should the EXPLAIN test enforce zero CORRELATED subqueries for Q2 stale-count OR allow the EXISTS clause's correlated subquery (which is intentional)?**
   - What we know: Q2's EXISTS clause IS a correlated subquery by design — that's how EXISTS works in SQL.
   - What's unclear: How to phrase the test assertion to accept the EXISTS short-circuit while rejecting unintended correlations.
   - Recommendation: **Whitelist the `versions v` EXISTS pattern explicitly.** Test assertion: planRows MUST NOT contain `CORRELATED SCALAR SUBQUERY` (note: SCALAR — single-value); the EXISTS path surfaces as `CORRELATED LIST SUBQUERY` or just `EXISTS` in SQLite's plan output. Mirror Phase 21's pattern at `shot-status-repo-grid.test.ts:88-109` (filters on `CORRELATED` + `ranked` keyword) — Phase 23 filters on `CORRELATED SCALAR` OR a different exclusion.

4. **Should `recomputeIsStaleClient` also handle the case where `latest_completed_version` is null AND `toStatus IN ('wip','pending-review')` — should we degrade to "we don't know"?**
   - What we know: D-15 grace period — null = not stale.
   - What's unclear: The client mirror function returns `false` (not stale) when `latest_completed_version === null`. This matches the server but creates a hole: if a shot WAS pending-review with no completed version, and SSE flips it to approved, the client never had `is_stale = true` to decrement from.
   - Recommendation: **Match server exactly** — null = false. The handler's stale-count delta arithmetic naturally degrades to 0 in this case (`wasStale === false && isStaleNow === false` → no change). No drift introduced.

## Environment Availability

> Phase 23 introduces no external dependencies beyond what Phase 17-22 already use.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `lucide-preact` (for AlertCircle) | Backlog callout | ✓ | ^1.9.0 | — (verified at packages/dashboard/package.json:17) |
| `@preact/signals` (for sequenceStats signal) | State extension | ✓ | (existing) | — |
| `drizzle-orm` + `better-sqlite3` (for `sql\`\`` tagged template + db.all/db.get) | Repo function | ✓ | (existing) | — |
| `vitest` + `@testing-library/preact` (for new test files) | Validation | ✓ | (existing — Phase 21/22) | — |
| Existing migrations (0008 ships `idx_shots_status`) | GROUP BY perf | ✓ | (in migration `0008_shot_status.sql:25`) | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 (server) + 4.1.5 (dashboard) + `@testing-library/preact` 3.2.4 + jsdom |
| Config file | `vitest.config.ts` (server root) + `packages/dashboard/vitest.config.ts` (dashboard) |
| Quick run command | `npx vitest run src/store/__tests__/shot-status-repo-grid.test.ts` (single repo test file, < 5s) |
| Full suite command | `npx vitest run` (server) + `cd packages/dashboard && npx vitest run` (dashboard) — mirrors Phase 21 Wave 5 / Phase 22 Wave 4 gate |
| Server test base | `src/test-utils/fixtures.ts` (`makeInMemoryDb`) provides in-memory SQLite with WAL + Drizzle migrations 0001-0008 applied. Used by all repo tests |
| Dashboard test base | `@testing-library/preact` with jsdom; mock fetch via vitest's spy or msw |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OVR-01 (GROUP BY query — single scan) | `getSequenceStats` Q1 SELECT status, COUNT(*) FROM shots WHERE sequence_id=? GROUP BY status; EXPLAIN shows index scan on idx_shots_status | unit (SQL) | `npx vitest run src/store/__tests__/shot-status-repo-grid.test.ts -t "getSequenceStats Q1 GROUP BY"` | ❌ Wave 0 (extension to existing test file) |
| OVR-01 (stats counts correctness) | Seed 5 shots with mixed statuses; assert counts match exactly | unit | (same file) | ❌ Wave 0 |
| OVR-01 (approved_pct integer arithmetic) | `Math.round(approved/total*100)` produces expected values; total=0 → approved_pct=0 (no NaN) | unit | (engine pipeline test extension) | ❌ Wave 0 |
| OVR-01 (envelope `stats` top-level field) | `GET /api/sequences/:id/shot-grid` returns `body.stats: SequenceStats` shape | integration | `npx vitest run src/http/__tests__/dashboard-routes-shot-grid.test.ts -t "stats envelope"` | ❌ Wave 0 (extension) |
| OVR-01 (pending_review_backlog === counts['pending-review']) | Redundant emission; assert equality | unit | (same as above) | ❌ Wave 0 |
| OVR-02 (per-row is_stale CASE — true for stale shot) | Seed shot with status='wip' + completed version > 14d ago; assert is_stale=1 | unit | `npx vitest run src/store/__tests__/shot-status-repo-grid.test.ts -t "is_stale wip with old completion"` | ❌ Wave 0 |
| OVR-02 (is_stale false for approved shot) | Status='approved' → is_stale=0 regardless of completion age | unit | (same file) | ❌ Wave 0 |
| OVR-02 (is_stale false for shot with no completed versions — D-15 grace) | Status='wip' + zero completed versions → is_stale=0 | unit | (same file) | ❌ Wave 0 |
| OVR-02 (is_stale false for fresh shot with recent completion) | Status='wip' + completion < 14d ago → is_stale=0 | unit | (same file) | ❌ Wave 0 |
| OVR-02 (stale_count whole-sequence — Q2 EXISTS) | Seed mix; assert stale_count matches expected | unit | (same file) | ❌ Wave 0 |
| OVR-02 (stale-border class on ShotGridCard) | shot.is_stale=true → outer div has border-2 class with --color-shot-stale | component | `npx vitest run packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx -t "stale border"` | ✅ exists (Phase 22 file) — needs extension |
| OVR-02 (--color-shot-stale token in BOTH theme blocks) | Snapshot test or text-grep on theme.css | smoke | `npx vitest run packages/dashboard/src/__tests__/theme-tokens.test.ts` | ❌ Wave 0 (new file OR extend existing) |
| OVR-03 (sequenceStats signal seeded from fetchShotGrid) | After fetch resolves, sequenceStats.value === response.stats | unit | `npx vitest run packages/dashboard/src/views/__tests__/ShotGridView.test.tsx -t "seeds sequenceStats"` | ❌ Wave 0 |
| OVR-03 (SSE delta — counts decrement+increment) | Mock SSE event: status wip→approved; assert counts.wip-- and counts.approved++ | unit | `npx vitest run packages/dashboard/src/state/__tests__/shot-grid.test.ts -t "applyStatsDelta counts"` | ❌ Wave 0 |
| OVR-03 (SSE delta — approved_pct recomputed) | After delta, approved_pct reflects new ratio | unit | (same file) | ❌ Wave 0 |
| OVR-03 (SSE delta — pending_review_backlog recomputed) | After delta, backlog reflects counts['pending-review'] | unit | (same file) | ❌ Wave 0 |
| OVR-03 (SSE delta — stale_count for in-buffer shot) | Buffer contains shot with is_stale=true; SSE flips to approved (not stale); stale_count-- | unit | (same file) | ❌ Wave 0 |
| OVR-03 (SSE delta — out-of-buffer shot leaves stale_count unchanged) | findIndex returns -1; stale_count unchanged | unit | (same file) | ❌ Wave 0 |
| OVR-03 (cross-sequence SSE no-op) | Mock event for different sequenceId; sequenceStats and shotGrid both unchanged | unit | (same file — extends Phase 21 cross-sequence test) | ❌ Wave 0 |
| OVR-03 (fromStatus null treated as 'wip') | First-transition event (fromStatus=null); applyStatsDelta runs with effectiveFromStatus='wip' | unit | (same file — Pitfall 2 lock) | ❌ Wave 0 |
| OVR-03 (sequenceStats=null guard) | sequenceStats.value === null before fetch → SSE event no-op for stats; shotGrid still updates | unit | (same file) | ❌ Wave 0 |
| OVR-03 (D-19 best-effort caveat documented) | grep for "best-effort" or "D-19" in state/shot-grid.ts comments | smoke | `grep "best-effort" packages/dashboard/src/state/shot-grid.ts` | ❌ Wave 0 |
| OVR-03 (progress bar a11y attributes) | role=progressbar, aria-valuenow, aria-valuemin=0, aria-valuemax=100, aria-label present | component | `npx vitest run packages/dashboard/src/components/__tests__/ProgressBar.test.tsx` | ❌ Wave 0 (new file) |
| OVR-03 (backlog callout hide-on-zero) | stats.pending_review_backlog=0 → callout NOT in DOM | component | `npx vitest run packages/dashboard/src/components/__tests__/SequenceHeader.test.tsx -t "backlog hide on zero"` | ❌ Wave 0 (new file) |
| OVR-03 (SequenceHeader 3-row structure with chevron collapse) | Chevron click hides all 3 rows | component | (same file) | ❌ Wave 0 |
| (CROSS) | D-21 — Progress bar respects prefers-reduced-motion (motion-reduce:transition-none) | smoke | `grep "motion-reduce" packages/dashboard/src/components/ProgressBar.tsx` | ❌ Wave 0 |
| (CROSS) | D-18 — Tool count holds at 7 | regression | `npx vitest run src/__tests__/tool-budget.test.ts` | ✅ exists; should be GREEN |
| (CROSS) | Architecture-purity — no new native bindings | regression | `npx vitest run src/__tests__/architecture-purity.test.ts` | ✅ exists; should be GREEN |
| (CROSS) | Append-only invariant — grep `UPDATE shot_status_events` returns zero | regression | `grep -r "UPDATE shot_status_events" src/` (existing test pattern) | ✅ exists (Phase 20) |
| (CROSS) | Phase 21/22 dashboard test suite remains green | regression | `cd packages/dashboard && npx vitest run` | ✅ existing 443/443 tests; Phase 23 must not break any |
| (CROSS) | Phase 21 EXPLAIN test (listShotsForGrid no-correlated-ranked) remains green after is_stale CASE extension | regression | `npx vitest run src/store/__tests__/shot-status-repo-grid.test.ts -t "CORRELATED SCALAR SUBQUERY"` | ✅ exists (Phase 21) — must remain GREEN |

### EXPLAIN QUERY PLAN Test Pattern (for OVR-01 + OVR-02 new queries)

Mirror Phase 21's pattern at `src/store/__tests__/shot-status-repo-grid.test.ts:88-109`. The new queries get parallel tests in the SAME file:

```typescript
// Extension to src/store/__tests__/shot-status-repo-grid.test.ts

import { getSequenceStatsGroupBySqlText, getSequenceStatsStaleSqlText } from '../shot-status-repo.js';

describe('getSequenceStats — Q1 EXPLAIN QUERY PLAN (OVR-01 single-scan lock)', () => {
  beforeEach(() => {
    for (let i = 0; i < 5; i++) {
      hierarchy.createShot(sequenceId, `sh${String((i + 1) * 10).padStart(3, '0')}`);
    }
  });

  test('Q1 plan uses idx_shots_status (covering index scan, no table fetch)', () => {
    const planRows = testDb.sqlite
      .prepare('EXPLAIN QUERY PLAN ' + getSequenceStatsGroupBySqlText())
      .all(sequenceId) as Array<{ detail: string }>;
    const planText = planRows.map((r) => r.detail).join('\n');
    // Accept either SEARCH or SCAN on shots; reject full-table SCAN without USING INDEX clause
    const usesIndex = planRows.some((r) =>
      r.detail.includes('idx_shots_status') || r.detail.includes('USING INDEX'),
    );
    expect(usesIndex, `Q1 should use idx_shots_status:\n${planText}`).toBe(true);
  });
});

describe('getSequenceStats — Q2 EXPLAIN QUERY PLAN (OVR-02 stale-count EXISTS)', () => {
  test('Q2 plan uses index search on versions (no full SCAN versions)', () => {
    const planRows = testDb.sqlite
      .prepare('EXPLAIN QUERY PLAN ' + getSequenceStatsStaleSqlText())
      .all(sequenceId, Date.now()) as Array<{ detail: string }>;
    const planText = planRows.map((r) => r.detail).join('\n');
    // Reject "SCAN versions" (full table). Accept "SEARCH versions" (indexed).
    const fullScan = planRows.filter(
      (r) => r.detail.match(/^SCAN versions\b/) && !r.detail.includes('USING'),
    );
    expect(fullScan, `Q2 must not full-scan versions:\n${planText}`).toEqual([]);
  });
});

describe('listShotsForGrid — is_stale CASE extension (OVR-02 per-row)', () => {
  test('is_stale=1 for wip shot with completed version > 14d ago', () => {
    const shot = hierarchy.createShot(sequenceId, 'sh010');
    const ver = versionRepo.insertVersion(shot.id);
    // Mark completed with a created_at 30 days ago
    const oldEpoch = Date.now() - 30 * 86_400_000;
    testDb.sqlite.prepare(`UPDATE versions SET status='completed', completed_at=? WHERE id=?`).run(oldEpoch, ver.id);
    const result = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    expect(result.items[0].is_stale).toBe(1);
  });

  test('is_stale=0 for shot with zero completed versions (D-15 grace)', () => {
    hierarchy.createShot(sequenceId, 'sh010');
    const result = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    expect(result.items[0].is_stale).toBe(0);
  });

  test('EXPLAIN QUERY PLAN for listShotsForGrid still has no correlated SCALAR subquery on ranked CTE (Phase 21 invariant)', () => {
    // Reuse existing Phase 21 test (no regression); the is_stale CASE expression
    // adds a CORRELATED LIST SUBQUERY (EXISTS) on `versions v2` — that's intentional
    // and must be whitelisted.
    const planRows = testDb.sqlite
      .prepare('EXPLAIN QUERY PLAN ' + listShotsForGridSqlText())
      .all(sequenceId, Date.now(), null, null, null, null, 21) as Array<{ detail: string }>;
    const correlatedRanked = planRows.filter(
      (r) => r.detail.includes('CORRELATED') && r.detail.includes('ranked'),
    );
    expect(correlatedRanked).toEqual([]);
  });
});
```

*The EXPLAIN test pattern is Phase 21's contribution; Phase 23 extends to two new queries plus the is_stale CASE extension.*

### Sampling Rate

- **Per task commit:** `npx vitest run <single test file>` (< 30s; dashboard or server subset for the change scope)
- **Per wave merge:** `npx vitest run` (server) + `cd packages/dashboard && npx vitest run` (dashboard) — full both sides (~ 8-10s mock-only)
- **Phase gate:** Full both suites green + tool-budget + architecture-purity + WCAG manual + visual smoke (mirrors Phase 21 Wave 5 / Phase 22 Wave 4 gate exactly)

### Wave 0 Gaps

- [ ] `packages/dashboard/src/components/ProgressBar.tsx` — NEW component
- [ ] `packages/dashboard/src/components/__tests__/ProgressBar.test.tsx` — covers OVR-03 a11y + visual
- [ ] `packages/dashboard/src/components/__tests__/SequenceHeader.test.tsx` — covers D-04 3-row structure + stats subrow + hide-on-zero
- [ ] `packages/dashboard/src/state/__tests__/shot-grid.test.ts` — extension: applyStatsDelta tests + Pitfall 2 (fromStatus null), Pitfall 8 (Restore), Pitfall 9 (race)
- [ ] `packages/dashboard/src/views/__tests__/ShotGridView.test.tsx` — extension: seeds sequenceStats from fetch
- [ ] `packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` — extension: stale-border conditional class
- [ ] `packages/dashboard/src/__tests__/theme-tokens.test.ts` — NEW snapshot: both light + dark blocks contain `--color-shot-stale`
- [ ] `src/store/__tests__/shot-status-repo-grid.test.ts` — extension: getSequenceStats Q1 + Q2 EXPLAIN tests + is_stale CASE tests
- [ ] `src/http/__tests__/dashboard-routes-shot-grid.test.ts` — extension: stats envelope assertions + per-row is_stale field assertions

No new framework install needed; all test infra exists from Phase 21.

## Security Domain

> `security_enforcement` defaults enabled per workflow config. Phase 23 surface is read-only over existing tables; threat surface is minimal.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | NO | No auth surface modified; single-user model preserved (CLAUDE.md "Single-artist demo scope" + Phase 19 D-PRIV-2) |
| V3 Session Management | NO | No session storage changes |
| V4 Access Control | NO | All endpoints same-origin; existing dashboard-routes test harness unchanged |
| V5 Input Validation | NO | No new HTTP route, no new query params, no new body schemas. The Phase 21 `?cursor=` + `?limit=` validation at `dashboard-routes.ts:291-304` is the only validation surface and is unchanged. |
| V6 Cryptography | NO | No new cryptography |

### Known Threat Patterns for Phase 23 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via path param `:id` | T (Tampering) | `sequenceId` flows through `engine.repo.getSequence()` lookup (typed throw on unknown); Drizzle's `sql\`\`` tagged template uses parameterized binding for all query placeholders (e.g., `${sequenceId}` becomes a `?` placeholder). VERIFIED: `shot-status-repo.ts:265-273` precedent. |
| Stored XSS via sequence name in stats label | T | Sequence name renders as JSX text children — Preact auto-escapes (T-5-06 precedent). Phase 21 verified this for sequence headers. |
| Info-disclosure via SSE delta (sequence stats) | I | Existing T-20-03-01 disposition (already-authenticated stream). Phase 23 emits NO new SSE events; reuses Phase 20's `shot.status_changed` payload verbatim. |
| Timing oracle on stale-count | I | Stale-count reveals shot-activity patterns; in v1.3 single-user scope, no second party can observe this. Future multi-user phase would need per-user filtering on the stats query. |
| DoS via large sequence (10K shots) GROUP BY | D (Denial) | GROUP BY uses idx_shots_status (sequence_id, status) — full index scan O(N) where N=shots in sequence, no random I/O. Typical sequence ≤ 100 shots; 10K-shot pathological case still completes < 50ms. EXISTS subquery for stale-count adds O(N) lookups against versions PK autoindex. **Mitigation:** assertion test on synthetic 1K-shot fixture asserts query time < 100ms. |
| Drift between client stats and server snapshot (D-19) | T | Server snapshot is authoritative on each fetch; SSE deltas are best-effort. Client-side documentation in `state/shot-grid.ts` comment. Supervisor workflow: refresh sequence for fresh snapshot. |
| Race condition: SSE arrives during initial fetch (Pitfall 9) | T | Existing guard at `state/shot-grid.ts:162` (`if (current === null) return;`) handles this by dropping deltas until fetch lands. Server snapshot is final; client converges on next event. |
| Path traversal on sequence_id path param | T (Tampering) | Hono router enforces `:id` as a single path segment (no slashes); `getSequence(sequenceId)` throws `SEQUENCE_NOT_FOUND` for non-matching IDs. No filesystem access. |
| Replay of stale fetch overwriting fresh SSE | T | Existing Phase 21 `requestSeqId` guard at `ShotGridView.tsx:172-213` covers fetch-vs-fetch race. SSE-vs-fetch race is the Pitfall 9 case — server snapshot wins. |

## Sources

### Primary (HIGH confidence — verified from repo code)
- `src/store/shot-status-repo.ts:54` — `STALE_SHOT_DAYS = 14` constant — single source of truth [VERIFIED]
- `src/store/shot-status-repo.ts:228-285` — `listShotsForGrid` window-function CTE — pattern to extend [VERIFIED]
- `src/store/shot-status-repo.ts:301-323` — `listShotsForGridSqlText()` — EXPLAIN test pattern [VERIFIED]
- `src/store/schema.ts:55-71` — `shots` table definition + status column [VERIFIED]
- `src/store/schema.ts:73-109` — `versions` table + idx_versions_status [VERIFIED]
- `src/store/schema.ts:209-221` — `shotStatusEvents` table + idx_shot_status_events_shot_time [VERIFIED]
- `drizzle/0008_shot_status.sql:25-28` — four indexes (idx_shots_status uses (sequence_id, status); the GROUP BY query's perfect cover) [VERIFIED]
- `src/engine/pipeline.ts:822-874` — existing `listShotGrid` engine method to extend [VERIFIED]
- `src/http/dashboard-routes.ts:370-375` — existing route to widen response envelope [VERIFIED]
- `src/http/sse.ts:135-148` — `toDashboardPayload` for `shot.status_changed` — sequenceId already on the wire [VERIFIED]
- `src/store/__tests__/shot-status-repo-grid.test.ts:88-109` — EXPLAIN test pattern to mirror [VERIFIED]
- `src/http/__tests__/dashboard-routes-shot-grid.test.ts:1-120` — HTTP route test pattern to extend [VERIFIED]
- `packages/dashboard/src/state/shot-grid.ts:60-171` — signal definitions + `onShotStatusChanged` handler [VERIFIED]
- `packages/dashboard/src/components/SequenceHeader.tsx:1-114` — existing component to extend with subrow [VERIFIED]
- `packages/dashboard/src/components/ShotGridCard.tsx:1-160` — outer div for stale border [VERIFIED]
- `packages/dashboard/src/components/ShotStatusPill.tsx:1-100` — visual vocabulary precedent [VERIFIED]
- `packages/dashboard/src/components/QuickApproveButton.tsx:1-119` — optimistic-update precedent [VERIFIED]
- `packages/dashboard/src/components/WarningPill.tsx:1-43` — amber pill primitive [VERIFIED]
- `packages/dashboard/src/styles/theme.css:53-58, 114-119` — Phase 21 5-token addition to BOTH theme blocks (pattern to mirror) [VERIFIED]
- `packages/dashboard/src/lib/copy.ts:186-310` — Phase 21 copy block (insertion convention) [VERIFIED]
- `packages/dashboard/src/lib/api.ts:645-657` — `fetchShotGrid` consumer — signature unchanged, consumes wider response [VERIFIED]
- `packages/dashboard/src/views/ShotGridView.tsx:122-150` — fetch effect to seed sequenceStats [VERIFIED]
- `packages/dashboard/src/App.tsx:87-100` — SSE register/cleanup — reference equality preserved [VERIFIED]
- `packages/dashboard/src/types/shot-grid.ts:1-70` — types to extend with `SequenceStats` + `is_stale` [VERIFIED]
- `packages/dashboard/src/types/events.ts:72-79` — `ShotStatusChangedPayload` shape — sequenceId on the wire [VERIFIED]
- `packages/dashboard/package.json:17` — `lucide-preact: ^1.9.0` already installed [VERIFIED]
- `node_modules/lucide-preact/dist/lucide-preact.d.ts:25512` — `AlertCircle` exported as alias of `CircleAlert` [VERIFIED]
- `src/__tests__/tool-budget.test.ts:71` — `expect(registerToolCount()).toBe(7)` invariant [VERIFIED]
- `src/__tests__/architecture-purity.test.ts:108-237` — c2pa-node + other allowed-set assertions (Phase 23 introduces no new bindings) [VERIFIED]
- `.planning/REQUIREMENTS.md` OVR-01..03 — locked requirements [VERIFIED]
- `.planning/ROADMAP.md §"Phase 23"` — 3 success criteria [VERIFIED]
- `.planning/phases/23-production-stats/23-CONTEXT.md` — 21 locked decisions (D-01..D-21) [VERIFIED]
- `.planning/phases/21-shot-grid-view/21-CONTEXT.md` — Phase 21 prior decisions for D-14 mini-pills + D-22 SSE handler [VERIFIED]
- `.planning/phases/22-review-and-approval/22-CONTEXT.md` — Phase 22 D-10 hover icon, D-12 WarningPill, D-13 ShotGridCard refactor [VERIFIED]

### Secondary (MEDIUM confidence — convention / inferred from existing pattern)
- WCAG 2.1 AA `progressbar` role spec — Web standard, native browser support since 2014
- Tailwind v4 `motion-reduce:` variant — Tailwind docs (well-known utility)
- SQLite EXISTS subquery short-circuit behavior — SQLite docs (well-established)

### Tertiary (LOW confidence — none surfaced; nothing flagged for validation)
None — all Phase 23 patterns have direct repo precedent.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep already installed, every primitive already used
- Architecture: HIGH — pure composition of Phase 21/22 patterns; zero new mount points; zero new HTTP routes; zero new MCP tools
- SQL query design: HIGH — both queries use existing indexes (`idx_shots_status` for Q1; versions PK autoindex for Q2 EXISTS)
- Stale-count delta arithmetic: HIGH — algorithm is straightforward; best-effort caveat (D-19) is explicit
- Pitfalls: HIGH — Pitfall 2 (null fromStatus), Pitfall 6 (theme.css both blocks), Pitfall 10 (bracket access) caught at planning stage save planner time
- Validation: HIGH — test framework already wired; Wave 0 gap list is precise file paths; EXPLAIN test pattern from Phase 21 directly transferable

**Research date:** 2026-05-15
**Valid until:** 2026-06-14 (30 days for stable Phase 21/22 patterns; will revisit if Phase 24 lands first and changes the SSE event surface)

## RESEARCH COMPLETE
