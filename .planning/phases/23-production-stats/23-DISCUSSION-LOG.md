# Phase 23: Production Stats - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 23-production-stats
**Areas discussed:** Endpoint shape, Header layout, Stats hierarchy, Stale on card

---

## Endpoint

| Option | Description | Selected |
|--------|-------------|----------|
| Extend /shot-grid response | Add top-level `stats` field + per-shot `is_stale`/`latest_completed_at` to GET /api/sequences/:id/shot-grid. One roundtrip, one signal flow, response-shape change ripples through types/shot-grid.ts and the dashboard-routes-shot-grid.test.ts harness. | |
| Separate /stats endpoint | New GET /api/sequences/:id/stats returning {total, approved_pct, counts, pending_review_backlog, stale_count}. Existing shot-grid endpoint only adds per-shot is_stale. Two roundtrips, two signals, cleaner separation, lets future stats consumers reuse the endpoint without paginated shots. | |
| Single endpoint, both top-level | Return `{ sequence, stats, shots, next_cursor, total_count }` on the existing route — stats is explicitly whole-sequence (NOT derived from the paginated shots[] window). One roundtrip, types stay co-located, but every shot-grid fetch recomputes stats server-side. | ✓ |

**User's choice:** Timothy invoked autonomous mode mid-discuss ("just independently keep developing this... do all research, sprint without me"). Claude self-selected the third option (single endpoint, both top-level) per the recommended approach.
**Notes:** Matches OVR-01's "single GROUP BY query" without ambiguity; explicit whole-sequence semantics for stats while preserving the existing fetchShotGrid + signal lifecycle. Repo layer splits into `listShotGrid()` (paginated rows) + `getSequenceStats()` (whole-sequence GROUP BY) composed in the engine facade.

---

## Header layout

| Option | Description | Selected |
|--------|-------------|----------|
| Replace mini-pills inside <SequenceHeader/> | <SequenceHeader/> grows the richer widget in place of its 5 derived mini-pills (Phase 21 D-14 anticipated this). Keeps the collapsible chevron behavior; aggregateCounts computed deleted; data source flips from client-derived to server-supplied. Tight, minimal surface area, no new mount points. | |
| Augment header — add stats ABOVE the existing pills | Keep the Phase 21 mini-pills AND add a new top row inside <SequenceHeader/> for the % approved bar + backlog callout + stale count. Two information layers. More vertical space; double-counts visually since pills already encode counts. | ✓ |
| New <SequenceStatsWidget/> between FilterBar and SequenceHeader | Stats widget is a NEW component mounted between <ShotGridFilterBar/> and <SequenceHeader/>; <SequenceHeader/> keeps its current mini-pills + chevron. Three layers of header chrome; clean separation; more vertical space before the grid. | |

**User's choice:** Augment header — add stats ABOVE the existing pills.
**Notes:** Phase 21 D-14 mini-pills are preserved as the per-status counts layer below the new stats row. Implementation stays inside `SequenceHeader.tsx` (props extension; no new mount point). The chevron toggle collapses ALL three layers (name row + new stats row + mini-pills row).

---

## Stats hierarchy

| Option | Description | Selected |
|--------|-------------|----------|
| Progress bar for %, callout for backlog | Horizontal progress bar fills to approved %, with the percentage number overlaid or beside it. Pending-review backlog gets a distinct callout pill ("3 awaiting review") in an accent color separate from the count mini-pills. Supervisor-native — mirrors ShotGrid/ftrack progress signal. | ✓ |
| Plain numeric callouts, no bar | Big bold "60%" + label "approved" as a callout; "3" + label "pending review" as a separate callout; per-status counts as small pills below. No progress-bar UI. Cleaner, less visual weight, treats backlog as just another headline stat. | |
| Single inline row, % and backlog as pills | Everything is a small pill in one row — `[60% approved]` `[3 pending]` `[1 stale]` `[w 5]` `[pr 3]` `[a 12]` `[oh 2]`. Minimal vertical space; least hierarchy; supervisor scans left-to-right. Closest to Phase 21's existing mini-pill aesthetic. | |
| Donut/ring chart + text | Small donut chart visualizing approved/pending/other proportions, with the % number in the center and a legend beside it. Per-status counts as pills below. Most visual; adds a chart-rendering concern (SVG inline, no new dep). | |

**User's choice:** Progress bar for %, callout for backlog.
**Notes:** Progress bar fill uses `--color-shot-status-approved` (green); track uses `--color-border` or `--color-bg-hover`. Bar gets `role="progressbar"` + `aria-valuenow={approved_pct}`. Backlog callout (`! 3 awaiting review`) uses a leading AlertCircle icon and an accent background distinct from the per-status mini-pills below. Stale count (`⚠ 1 stale`) rides next to the backlog callout when > 0; hidden entirely when zero.

---

## Stale on card

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in name row + treat zero-versions as stale | Small amber icon + "Stale" text adjacent to <ShotStatusPill/> in the bottom name row. Avoids competing with the top-right hover Approve icon (Phase 22 D-10). Brand-new shots with no completed versions render as Stale per literal OVR-02 reading. | |
| Inline in name row + grace period for new shots | Same placement (next to status pill in name row) BUT shots with NO completed versions ever (latest_completed_version === null) are NOT marked stale. Staleness only applies when there's a real prior completed version > 14d old. Avoids surprising users who just created shots. | |
| Top-LEFT corner amber dot/icon, no text | Small absolutely-positioned amber dot/icon at top-left of the thumbnail (corner-pair with the top-right hover Approve icon — symmetric). Compact, doesn't push name-row content. Tooltip + aria-label carry the "Stale" semantics for WCAG. | |
| Amber border around the entire card | 1-2px amber border outlines the whole card when stale; no separate icon. Strong glanceability — supervisor scans the grid and sees all stale shots at once. More visually loud; potentially clashes with focus-visible ring styling. | ✓ |

**User's choice:** Amber border around the entire card.
**Notes:** Border is on the OUTER `<div class="group relative">` wrapper of `<ShotGridCard/>` — inner buttons keep their existing focus rings. New theme token `--color-shot-stale` (distinct from `--color-shot-status-pending-review` amber `#fbbf24` to avoid visual collapse). Recommended: light theme `#f59e0b` (amber-500, orange-leaning), dark theme `#fbbf24`. Grace period for zero-completed-versions shots applied (Claude's discretion D-15) — only shots with a real prior completed version > 14d old are stale. Coexists with omit `opacity-40` wrapper (an omit shot is by definition not stale since OVR-02 requires status ∈ ('wip','pending-review')).

---

## Claude's Discretion

- **D-13 endpoint shape:** Selected Option C (single endpoint, both top-level) on Timothy's behalf when he invoked autonomous mode for Q1. Rationale captured in CONTEXT.md.
- **D-15 zero-completed-versions stale rule:** Pragmatic interpretation of OVR-02 — shots with no completed versions ever are NOT marked stale, even though literal reading ("no completed version in last 14 days") would qualify them. Avoids surprising users who just created shots. Documented as a small deviation from the literal requirement.
- **D-08 theme token strategy:** Add a NEW `--color-shot-stale` token (light: `#f59e0b`, dark: `#fbbf24`) rather than reusing `--color-shot-status-pending-review` (already `#fbbf24` in light) — the pending-review status can also be stale, and using the same hex would visually collapse two semantic states.
- **D-17 SSE payload extension:** NOT required — existing payload carries enough info for client-side delta arithmetic; keeps Phase 20's wire surface minimal.
- **D-19 stale-count best-effort caveat:** For sequences with paginated shots beyond the loaded buffer, stale_count delta arithmetic is best-effort. Server-snapshot value remains until next full re-fetch. Acceptable for v1.3 supervisor workflow; documented as a code comment in `state/shot-grid.ts`.
- **D-21 animation discipline:** No mount/unmount animations on the new stats row or stale-border addition (UI restraint precedent from Phase 22 D-22). Progress bar width transition ≤ 150ms with `prefers-reduced-motion: reduce` honored.

## Deferred Ideas

(Captured in CONTEXT.md `<deferred>` section.)

- Stale shot drill-in / dedicated list view
- "Snooze stale" supervisor action
- Per-supervisor productivity stats
- Stale-shot Slack/email digest
- Multi-sequence (project-level) stats rollup
- Sparkline / approval velocity trend lines
- Configurable `STALE_SHOT_DAYS` (per-project / per-sequence)
- Donut/ring chart visualization (Q3 option D, not picked)
- Stale tooltip with timestamp
- Inline stale-count delta logging (debug-only)
