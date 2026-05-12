# Phase 21: Shot Grid View - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 21-shot-grid-view
**Areas discussed:** TreeSidebar grid-icon nav, Filter bar UX + persistence, Forward-compat for 22/23/24
**Area skipped (deferred to Claude's discretion):** Shot card click behavior

---

## TreeSidebar grid-icon nav

### Q1: Where should the per-sequence grid icon sit on the sequence row?

| Option | Description | Selected |
|--------|-------------|----------|
| Right-end, always visible | Icon at right edge of every sequence row, parallel to chevron. Most discoverable; Frame.io / ShotGrid pattern. | ✓ |
| Right-end, hover-only | Icon appears on row hover (VS Code Explorer / Notion pattern). Cleaner rest state, less discoverable. | |
| Inline before name | `[grid-icon] [chevron] Name` — icon is a permanent visual anchor of the row. | |
| Click sequence name to open grid | No icon — sequence name becomes the grid-opening affordance. Simplest visual; conflates two interactions. | |

**User's choice:** Right-end, always visible
**Notes:** Recommended option. Frame.io / ShotGrid-style discoverability for VFX artists.

### Q2: Where does the 'home' icon live to return to HomeView?

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard header | Home icon top-left in existing `<header>` next to brand. Always visible; mirrors universal 'go home' pattern. | ✓ |
| TreeSidebar header | Home icon above the workspace list (inside the left rail). Contextual to sidebar's navigation role. | |
| Both header + sidebar | Dashboard header primary + ShotGridView contextual back link. Redundant but max discoverable. | |

**User's choice:** Dashboard header (top-left, next to brand)
**Notes:** Recommended option. Universal navigation affordance, mirrors Linear / Notion / GitHub.

### Q3: What happens to prior shot selection on view switch?

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve selectedShotId | Independent signals; returning home restores prior shot + version selection. Frame.io-style. | ✓ |
| Clear on view switch | Switching views resets relevant signals. Simpler mental model; loses context. | |
| Preserve + auto-sync | Clicking a card in ShotGridView updates selectedShotId. Tight coupling between views. | |

**User's choice:** Preserve selectedShotId (independent signals)
**Notes:** Recommended option. Pick up exactly where you left off.

### Q4: Visual indication of active sequence in TreeSidebar?

| Option | Description | Selected |
|--------|-------------|----------|
| Grid icon turns accent color | Only the icon changes — fills with --color-accent + aria-current='page'. Minimal visual noise. | ✓ |
| Row tint + icon accent | Background tint + icon color change. Maximally legible at a glance; adds a second visual signal. | |
| Left accent bar on row | Vertical accent bar on row's left edge (Linear / VS Code pattern); no icon color change. | |

**User's choice:** Grid icon turns accent color (aria-current='page')
**Notes:** Recommended option. Restrained styling matches existing TreeSidebar visual rhythm.

---

## Filter bar UX + persistence

### Q1: Where does the 'Show omitted' toggle sit in the filter bar?

| Option | Description | Selected |
|--------|-------------|----------|
| Right-aligned toggle switch | iOS-style switch at far right. Visually distinct from status pills (different KIND of control). Frame.io 'Show archived' pattern. | ✓ |
| 6th pill at far right | A 6th 'Show omitted' pill alongside status pills. Consistent control vocabulary; conflates filter with dataset gate. | |
| Inline text link | Plain '+ Show omitted' text link. Smallest visual footprint, least discoverable. | |

**User's choice:** Right-aligned toggle switch
**Notes:** Recommended option. Distinguishes dataset-gate from filter-selector.

### Q2: What does the 'All' pill show?

| Option | Description | Selected |
|--------|-------------|----------|
| All = everything in current dataset | 'Show omitted' is the DATASET gate; 'All' resets the status FILTER. Two orthogonal controls; clean mental model. | ✓ |
| All = literally everything always | 'All' overrides Show omitted — always shows all 5 statuses. Simpler semantics; Show omitted feels half-effective. | |
| All = active only, no separate toggle | Remove Show omitted; 'omit' pill always in bar. Simplest filter model; loses at-a-glance hidden-omit surfacing. | |

**User's choice:** All = everything in current dataset
**Notes:** Recommended option. Clean separation between dataset gate and filter reset.

### Q3: URL mirror for filter state?

| Option | Description | Selected |
|--------|-------------|----------|
| No URL mirror — session signal only | Filter lives purely in activeView signal. Resets on page reload. Matches REQ-03 literally. | |
| URL mirror like sort | Add ?statusFilter=...&showOmitted=... via history.replaceState. Shareable links; matches Phase 18 precedent. | ✓ |
| Full Phase 18 precedence | URL > localStorage > defaults. Most powerful; survives cross-session. Arguably over-engineered for a 6-pill bar. | |

**User's choice:** URL mirror like sort (Phase 18 precedent)
**Notes:** Recommended option. Shareability without the persistent-filter-surprise risk of full localStorage.

### Q4: Sticky filter bar on scroll?

| Option | Description | Selected |
|--------|-------------|----------|
| Sticky at top of grid pane | position: sticky; top: 0. Stays visible while scrolling. Frame.io / Linear pattern. | ✓ |
| Scrolls with content | Filter bar part of normal document flow; scrolls out of view. User scrolls back to top to change filter. | |
| Sticky + auto-hides on scroll-down | Smart-hide pattern. More complex; potential jankiness with rapid scrolls. | |

**User's choice:** Sticky at top of grid pane
**Notes:** Recommended option. Don't make supervisor scroll back to change filter.

---

## Forward-compat for 22/23/24

### Q1: What's the forward-compat philosophy for Phase 21?

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal now; later phases do their own work | Build only what Phase 21 requirements ask for. Later phases each refactor what they need. | ✓ |
| Reserve extension points (no functionality) | Lay structural groundwork without feature: card hover slot, header `<aside>` slot, placeholder `is_stale: false`. | |
| Cheap wins opportunistically | Take low-cost forward-compat (hover-to-zoom on image thumbs = ~5 LOC); skip expensive ones. | |

**User's choice:** Minimal now; later phases do their own work
**Notes:** Recommended option. Aligns with CLAUDE.md "Don't design for hypothetical future requirements."

### Q2: Endpoint payload shape?

| Option | Description | Selected |
|--------|-------------|----------|
| Lean joined shape | Exactly what GRID-01..05 needs. Nested `latest_completed_version` object. | ✓ |
| Flat shape (no nested version) | Hoist version fields to shot row with `latest_*` prefix. Easier client iteration; loses semantic grouping. | |
| Lean + sequence-level status_counts | Adds `status_counts` from server GROUP BY. Pre-bakes header counts; Phase 23 would extend. | |

**User's choice:** Lean joined shape (no server-side status_counts)
**Notes:** Recommended option. Status counts client-derived from shots signal (D-14).

### Q3: How should aggregate status counts render in the sequence header?

| Option | Description | Selected |
|--------|-------------|----------|
| Color-coded mini-pills next to title | Tiny status-colored count badges in a row. Reads at-a-glance; reuses StatusPill design system. | ✓ |
| Inline muted text | `12 shots — 3 wip, 2 pending, 5 approved, 1 hold, 1 omit` after sequence name in muted color. | |
| Single total count + collapsed detail | `12 shots [≡]`; per-status counts in popover. Cleanest header; per-status discoverability buried. | |

**User's choice:** Color-coded mini-pills next to title
**Notes:** Recommended option. Phase 23 replaces with full server-computed stats widget when it lands.

### Q4: What does collapsing the sequence header do in single-sequence view?

| Option | Description | Selected |
|--------|-------------|----------|
| Collapses the shot grid below the header | Chevron toggles aria-expanded; collapsed state hides the grid. Useful for at-a-glance counts. Session-only state. | ✓ |
| Skip collapse for v1 — interpret as forward-compat | No chevron; grid always visible. Defer collapse interaction to future multi-sequence rollup. | |
| Collapse + persist (per-sequence localStorage) | Collapse state persists per sequence. Mirrors Phase 18 localStorage scope; adds complexity for single-sequence view. | |

**User's choice:** Collapses the shot grid below the header (session-only, open by default)
**Notes:** Recommended option. Lets supervisor scan TreeSidebar across sequences without grid noise.

---

## Claude's Discretion

Items where the user deferred to Claude's judgement (skipped area + items not asked):

- **Shot card click behavior** (skipped area): whole card clickable, opens VersionDrawer for `latest_completed_version.id`; skeleton-only cards (`latest_completed_version === null`) are not clickable (`aria-disabled="true"`). Matches Phase 17 `<SkeletonThumbnail/>` precedent.
- **`<ShotStatusPill/>` design**: extends existing `<StatusPill/>` saturated-bg + inverse-text vocabulary; 5 new CSS custom properties for shot-status colors in `theme.css`.
- **Active filter pill styling**: filled `--color-accent` background, inverse text; inactive: outlined with `--color-border`, muted text. `aria-pressed` for state.
- **Empty state copy**: zero-shot-in-sequence → "No shots in this sequence yet. Shots are created via the MCP agent."; zero-shots-match-filter → status-aware "No shots with status '{status}' in {sequenceName}." Reuses existing `<EmptyState/>` component.
- **Pagination UX**: reuse Phase 18 `<LoadMoreButton/>` verbatim at the bottom of the shot grid; default limit 20.
- **Default shot sort**: `shot.name ASC` (alphabetical, SHOT_010 convention) per Phase 18 "VFX artists know names, not creation dates" precedent; no sort dropdown on shot grid (REQ-03 says only status filter).
- **Sequence-grouped layout interpretation**: Phase 21 ships ONE sequence header per ShotGridView; "grouped" wording in REQ-01 read as forward-compat for future multi-sequence rollup.
- **SSE handler**: extend `App.tsx` SSE registration with `onShotStatusChanged` handler; updates the matching shot in `shotGrid.value.shots`; cards keyed on shotId for in-place updates.

## Deferred Ideas

Ideas mentioned during discussion that were noted for future phases:

- Multi-sequence shot grid rollup (project-level grid across all sequences) — future v1.4+ candidate
- Per-shot card hover affordances (quick-approve, "Open in review panel") — Phase 22 (REV-02)
- Stats widget in ShotGridView header (% approved, backlog, stale-shot count) — Phase 23 (OVR-01 + OVR-03)
- Stale shot indicator (amber warning at 14 days) — Phase 23 (OVR-02)
- Hover-to-scrub video thumbnails + hover-to-zoom image thumbnails — Phase 24 (POL-01)
- Per-shot sort persistence + sort dropdown on shot grid — Phase 24 (POL-03)
- Workspace-level or project-level grid icon (rolling up across sequences) — explicitly out of Phase 21 scope
- localStorage persistence for filter state — rejected in favor of URL mirror only (D-09); reconsider if URL-only loses value
