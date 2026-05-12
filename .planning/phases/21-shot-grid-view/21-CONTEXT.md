# Phase 21: Shot Grid View - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

A new `ShotGridView` is the primary v1.3 user surface — VFX artists navigate from the TreeSidebar's per-sequence grid icon to a CSS Grid (`minmax(220px, 1fr)`, 16:9 cards) showing all shots in a sequence as `<ShotGridCard/>` instances: lazy thumbnail (existing Phase 17 pipeline) + 5-state `<ShotStatusPill/>` + version count + last-updated. View routing is signal-driven via a new `activeView` signal in `App.tsx` — `'home' | 'shot-grid'`, no router library added (REQ-01). Backend is a single new endpoint `GET /api/sequences/:id/shot-grid` returning a denormalized payload from one SQL query (no N+1), with cursor pagination for > 50 shots (REQ-04). A sticky filter bar at the top of the grid pane offers one pill per status (`All | wip | pending-review | approved | on-hold`) plus a right-aligned "Show omitted" toggle switch; filtering is client-side over the shots signal (REQ-03/05). SSE `shot.status_changed` (from Phase 20) updates affected card badges in-place; cards are keyed on `shotId` so updates don't disrupt overlays (REQ-02). Tool cap holds at 7/12 — Phase 21 adds zero new MCP tools; the new HTTP route is dashboard-only. Out of scope (later phases): review-panel actions (Phase 22), stats widget (Phase 23), hover-to-scrub + per-shot sort persistence (Phase 24).

</domain>

<decisions>
## Implementation Decisions

### TreeSidebar grid-icon navigation
- **D-01:** Per-sequence grid icon (Lucide `LayoutGrid` or equivalent) renders at the right edge of every sequence row in the TreeSidebar — always visible, parallel to the existing chevron toggle. Frame.io / ShotGrid pattern. No grid icon on workspace/project/shot rows (single-sequence scope only).
- **D-02:** Click handler distinct from the row-expand chevron: clicking the grid icon flips `activeView` to `'shot-grid'` and writes the sequence id to `selectedSequenceForGrid` signal; clicking the chevron continues to expand/collapse the children list as today. Icon button gets `aria-label="Open shot grid for {sequenceName}"`.
- **D-03:** Home icon (Lucide `Home` or equivalent) renders in the existing dashboard `<header>` element top-left, immediately before the "VFX Familiar" brand text. Always visible from any view; clicking it sets `activeView = 'home'`. Brand text stays the same — home icon is a separate `<button>`. `aria-label="Back to home view"`.
- **D-04:** Independent signals — `selectedShotId` (HomeView's state) and `selectedSequenceForGrid` (ShotGridView's state) are unrelated. Switching `activeView` does NOT clear either signal. User who selected SH020 in HomeView, opens SEQ_030's grid, then clicks home — returns to HomeView with SH020 still selected and its versions panel rehydrated. Card clicks in ShotGridView open the VersionDrawer overlay (per Claude discretion D-19); they do NOT mutate `selectedShotId`.
- **D-05:** Active-sequence visual indication in TreeSidebar: the grid icon for the currently-displayed sequence (the one whose grid is showing) fills with `--color-accent` and receives `aria-current="page"`. No row tinting, no left accent bar — minimal visual noise per the TreeSidebar's restrained style.
- **D-06:** Returning to home view from `activeView = 'shot-grid'` does NOT clear `selectedSequenceForGrid`. If user re-opens the grid (via any sequence's icon), the new sequence id replaces it. Stale value is benign — it's only read when `activeView === 'shot-grid'`.

### Filter bar UX + persistence
- **D-07:** Filter bar layout: 5 status pills + 1 "All" pill at left (left-to-right: `All | wip | pending-review | approved | on-hold`) and a right-aligned `<Toggle/>` switch labeled "Show omitted". The "omit" status does NOT get its own pill in the bar — filtering by `omit` happens implicitly when "Show omitted" is on (the dataset includes omit shots, and clicking the "omit" pill would be the natural way IF we had one; instead, when Show omitted is on, the "omit" pill appears as the 6th pill to allow filter-to-omit). When Show omitted is off, the omit pill is hidden from the bar entirely.
- **D-08:** "All" semantics — "All" resets the status FILTER to show every status in the current dataset. The dataset is gated by the "Show omitted" toggle: OFF means `wip | pending-review | approved | on-hold`; ON means those four PLUS `omit` (with `opacity-40` visual dimming per REQ-05). Two orthogonal controls; "Show omitted" gates the dataset; "All" resets the filter within that dataset.
- **D-09:** Filter state persistence — session signal (REQ-03 lock) PLUS URL mirror following Phase 18 sort precedent. URL shape: `?seq={seqId}&view=shot-grid&statusFilter={status|all}&showOmitted={0|1}`. Updates via `history.replaceState` on every filter/toggle change. Validation against the same Zod whitelist as the engine; malformed values → fallback to default + log warning, do not throw (mirrors D-16 in Phase 18 CONTEXT.md). URL precedence over signal on first mount; signal is the source of truth thereafter.
- **D-10:** Filter bar position: `position: sticky; top: 0` within the ShotGridView's scroll container. Stays visible during shot grid scroll; `z-index` set above grid cards but below VersionDrawer overlay. Background uses `--color-bg` with `border-bottom: 1px solid var(--color-border)` to visually separate from scrolling content.
- **D-11:** Active pill styling: filled background `--color-accent` with text color `--color-bg` (inverts for contrast). Inactive pills: outlined with `border: 1px solid var(--color-border)`, text `--color-fg-muted`. Mirrors current `<StatusPill/>` convention for selected state. Pills are keyboard-focusable buttons with `aria-pressed` state.

### Forward-compat for Phase 22/23/24 (minimal-now stance)
- **D-12:** Build only what Phase 21's GRID-01..05 requirements ask for. No speculative slots, no placeholder fields in the endpoint response, no reserved card hover containers. Phase 22 (quick-approve), Phase 23 (stats widget + stale indicator), and Phase 24 (hover-to-scrub + hover-to-zoom) each do their own structural changes when they land. Aligns with CLAUDE.md "Don't design for hypothetical future requirements."
- **D-13:** Endpoint payload shape (LEAN joined):
  ```ts
  {
    sequence: { id: string; name: string };
    shots: Array<{
      id: string;
      name: string;
      status: ShotStatus;          // 'wip' | 'pending-review' | 'approved' | 'on-hold' | 'omit'
      version_count: number;
      latest_completed_version: {
        id: string;
        thumbnail_url: string;     // points at existing /api/versions/:id/output.thumb.webp path
        completed_at: number;      // epoch ms
      } | null;
    }>;
    next_cursor: string | null;
    total_count: number;
  }
  ```
  No `latest_completed_at` at the shot row level (it's nested in `latest_completed_version`), no `is_stale` placeholder (Phase 23 adds the staleness compute), no `status_counts` (client-derived from `shots[].status`). Endpoint is `GET /api/sequences/:id/shot-grid?cursor=&limit=`.
- **D-14:** Aggregate status counts in the sequence header (REQ-01 "aggregate status counts") are CLIENT-derived from `shots.value.reduce((acc, s) => { acc[s.status]++; return acc; }, {...zeros})` via a Preact `computed` signal. Render as a row of color-coded mini-pills next to the sequence name — each pill shows count + status, color-coded to its status using the same color tokens as `<ShotStatusPill/>`. SSE-driven updates flow for free (when a status_changed event mutates `shots.value`, the derived counts re-compute reactively). Phase 23 replaces this with the full server-computed stats widget (% approved, backlog, stale).
- **D-15:** Collapsible sequence header behavior (REQ-01 "collapsible sequence header"): chevron in header toggles `aria-expanded`; collapsed state hides the shot grid (just header + counts visible). Open by default; session-only state (no localStorage persistence). Useful for at-a-glance counts when navigating between sequences via TreeSidebar without grid noise.

### Claude's Discretion
- **D-16:** `<ShotGridCard/>` design — entire card is a single `<button>` with `aria-label="Open version drawer for {shotName}"`. Click target = whole card (220×~140px including padding). Internal layout: 16:9 thumbnail at top, then a row with `<ShotStatusPill/>` + version count badge + shot name, with `last-completed-at` as a relative timestamp (e.g., "2h ago") in muted text below. Phase 22 will likely refactor this to add absolutely-positioned hover affordances; Phase 21 builds without that complexity.
- **D-17:** `<ShotStatusPill/>` (new component) follows the existing `<StatusPill/>` shape but with the 5 shot statuses. Color tokens: introduce per-status CSS custom properties for the 5 statuses (`--color-shot-status-wip`, `--color-shot-status-pending-review`, etc.) in `theme.css`, mirroring the existing `--color-status-running` / `--color-status-completed` precedent. WCAG 2.1 AA compliant per REQ-01 (color + text, text contrast ≥ 4.5:1, UI components ≥ 3:1).
- **D-18:** Empty state when zero shots match the active filter: reuse the existing `<EmptyState/>` component (already in `packages/dashboard/src/components/EmptyState.tsx`) with status-aware copy — e.g., "No shots with status 'pending-review' in SEQ_030_final_battle." Plain message, no action button. When the SEQUENCE itself has zero shots: copy reads "No shots in this sequence yet. Shots are created via the MCP agent." No action button.
- **D-19:** Shot card click → VersionDrawer for `latest_completed_version.id`. When `latest_completed_version === null` (shot has no completed versions yet), the card renders with `<SkeletonThumbnail/>` and the click target is disabled (`aria-disabled="true"`, no pointer cursor). Per the user's choice to skip discussing this gray area; this behavior matches the Phase 17 `<SkeletonThumbnail/>` precedent.
- **D-20:** Sequence-grouped layout (REQ-01) — Phase 21 ships ONE sequence header (the one whose grid is open) over the grid. The endpoint is per-sequence, so multi-sequence rollup isn't in scope. The "grouped" wording in REQ-01 is interpreted as forward-compat for a future project-level rollup; for now, one header per ShotGridView.
- **D-21:** Pagination UI (REQ-04 cursor pagination > 50 shots) — reuse the existing `<LoadMoreButton/>` component from Phase 18 (already at `packages/dashboard/src/components/LoadMoreButton.tsx`), positioned at the bottom of the shot grid. Default limit: 20 (matches CLAUDE.md "Paginate all list queries (default 20, include total count)"). Loading state and error pill behavior already implemented in the component.
- **D-22:** SSE handler — extend `App.tsx` to register `onSseEvent('shot.status_changed', onShotStatusChanged)` alongside the existing `version.created` and `version.status_changed` handlers. The handler updates the matching shot in `shotGrid.value.shots` array. Cards keyed on `shotId` ensure update is in-place (REQ-02 lock). New event type already wired by Phase 20 in `events.ts` / engine event map.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 milestone scope and constraints
- `.planning/REQUIREMENTS.md` §"Shot Grid View (GRID)" — GRID-01..05 (this phase's locked requirements); cross-cutting constraints lock tool cap at 7/12, signal-driven view routing (no router), append-only event log, WCAG 2.1 AA badges, single GROUP BY-style query (no N+1)
- `.planning/ROADMAP.md` §"Phase 21: Shot Grid View" — 5 success criteria (TreeSidebar grid icon → `activeView` switch; single SQL query verified via EXPLAIN QUERY PLAN; CSS Grid `minmax(220px, 1fr)` + 16:9 aspect ratio; client-side status filter; SSE in-place badge update)
- `.planning/PROJECT.md` §"Current Milestone: v1.3 Production Shot Grid" — milestone driver (VFX artist feedback for production management surface); tool surface (7/12 cap); architecture rules (signal-driven routing precedent via VersionDrawer overlay)

### Prior-phase decisions to carry forward
- `.planning/phases/20-shot-status-engine/20-04-SUMMARY.md` — Phase 20 wire surface: `shot.status_changed` SSE event emitted with `{ shotId, fromStatus, toStatus, changedBy, note? }`; `ShotStatus` type and `SHOT_STATUSES` const exported from `src/types/hierarchy.ts`; `getCurrentStatus(db, shotId)` null-coalesces to `'wip'`; `shot-status-repo.ts` is the canonical query surface (extend with a `listShotsForGrid(sequenceId, cursor, limit)` reader for the new endpoint, or compose existing primitives in pipeline)
- `.planning/phases/18-sortable-folder-dropdown/18-CONTEXT.md` — Phase 18 patterns directly reused: composite cursor pagination shape, `<LoadMoreButton/>` UX, URL state via `history.replaceState`, three-way precedence (URL > localStorage > defaults) — Phase 21 simplifies to URL + signal (no localStorage), but the URL parse + Zod-whitelist + fallback-with-warning pattern transfers 1:1; `vfx-familiar:` localStorage prefix established (Phase 21 does not add new keys); D-22 GET endpoint precedent (cursor as opaque base64 query param)
- `.planning/phases/17-visual-thumbnails/17-CONTEXT.md` — `<Thumbnail/>` lazy-load pattern (`loading="lazy"`, explicit width/height for CLS=0); `<SkeletonThumbnail/>` for missing/in-progress versions; existing `/api/versions/:id/output` thumbnail route shape

### Code precedent (patterns to mirror)
- `packages/dashboard/src/App.tsx:27-58` — current root component; Phase 21 extends with `activeView` signal in state, conditional render of HomeView vs ShotGridView, home-icon `<button>` in `<header>`, and new SSE handler registration for `shot.status_changed`
- `packages/dashboard/src/components/TreeSidebar.tsx` — pure component; Phase 21 adds grid-icon affordance on sequence rows. Either: (a) add an `onOpenGrid?: (sequenceId: string) => void` prop and a `currentGridSequenceId?: string` prop for the active-state visual (preferred — keeps component pure), or (b) lift the icon button to the parent. Recommend (a).
- `packages/dashboard/src/components/StatusPill.tsx` — design vocabulary for the new `<ShotStatusPill/>` component (saturated background + inverse text; `data-status` attribute for testing); 5 statuses vs the existing 4 version statuses — distinct components, NOT a unified pill
- `packages/dashboard/src/components/Thumbnail.tsx` — Phase 17 thin-wrapper pattern; `<ShotGridCard/>` reuses this component with the `latest_completed_version.thumbnail_url` and `<SkeletonThumbnail/>` fallback
- `packages/dashboard/src/components/LoadMoreButton.tsx` — Phase 18 cursor-pagination UX; Phase 21 reuses verbatim (same loading state, error pill, "Load N more" copy)
- `packages/dashboard/src/components/EmptyState.tsx` — existing empty-state component; Phase 21 reuses with status-aware copy strings
- `packages/dashboard/src/views/HomeView.tsx` — current single-view layout; Phase 21's ShotGridView mirrors the two-pane structure conceptually (sticky header + scrollable content) but composes different children
- `packages/dashboard/src/lib/api.ts` — fetch helper layer; Phase 21 adds `fetchShotGrid(sequenceId, { statusFilter, showOmitted, cursor, limit })` consumer
- `packages/dashboard/src/lib/events.ts` — SSE event subscription layer; Phase 21 reads from this with `onSseEvent('shot.status_changed', ...)`; no API change needed (the event type is already in the registry from Phase 20)
- `packages/dashboard/src/state/` — signals home; Phase 21 adds `activeView`, `selectedSequenceForGrid`, `shotGrid` (paginated buffer), `statusFilter`, `showOmitted` signals — each in a focused file matching the per-domain split (e.g., `state/shot-grid.ts`)
- `src/store/shot-status-repo.ts:130` — `getCurrentStatus(db, shotId)` null-coalesce reference for the new query; the new `listShotsForGrid` query inherits the same null-coalesce semantics (a shot with zero status events returns `'wip'`)
- `src/store/version-repo.ts:202-221` (`listByShot`) and `:232-240` (`listRecentCompleted`) — `version_number`/`completed_at` ordering patterns for the latest-completed-version subquery / window function inside the GROUP BY join
- `src/store/hierarchy-repo.ts` `listShots` — current shot list query that the new endpoint joins against (with latest-completed-version join + status field). Confirm pagination cursor shape matches Phase 18 composite-cursor pattern (cursor encodes `(sort_key, shot_id)` for stability)
- `src/http/dashboard-routes.ts` — Hono route registry; Phase 21 adds `GET /api/sequences/:id/shot-grid` route handler with Zod query parsing (status filter is not server-applied per REQ-03 — but cursor and limit are; sequenceId is path param)
- `src/__tests__/architecture-purity.test.ts` — confirms new files don't violate sole-importer rules; Phase 21 introduces no new native bindings, so the allowed-set is unchanged

### Cross-cutting
- `CLAUDE.md` §"Architecture Rules" — "Tool cap: Maximum 12 MCP tools" (Phase 21 holds at 7/12, dashboard-only feature; no new `server.registerTool()` calls)
- `CLAUDE.md` §"Conventions" — "Paginate all list queries (default 20, include total count)" → Phase 21 endpoint default limit = 20; `total_count` always included
- `CLAUDE.md` §"Architecture Rules" — "Tool-engine separation: MCP tools are thin Zod-validated entry points that delegate to engine services. Engine has zero MCP dependency." → applies to the new endpoint: Hono route is thin, real query lives in `shot-status-repo.ts` (or a new `shot-grid-repo.ts` if compose is cleaner)
- `.planning/STATE.md` — current position: Phase 20 complete, Phase 21 ready to plan; resume → `/gsd-plan-phase 21`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`<Thumbnail/>` + `<SkeletonThumbnail/>`** (Phase 17) — `<ShotGridCard/>` thumbnail slot is a direct reuse; lazy-load + explicit dimensions for CLS=0. `<SkeletonThumbnail/>` for shots with no completed version.
- **`<LoadMoreButton/>`** (Phase 18) — cursor-pagination UX is verbatim reusable at the bottom of the shot grid (loading state + retry pill + "Load N more" copy already implemented).
- **`<EmptyState/>`** — existing empty-state primitive for the zero-shots and zero-filter-matches cases.
- **`<StatusPill/>` design tokens** — the saturated-background-with-inverse-text vocabulary directly transfers to `<ShotStatusPill/>` (distinct component for the 5 shot statuses vs the 4 version statuses).
- **`@preact/signals` + computed derivations** — aggregate status counts are a `computed(() => ...)` over the shots signal; SSE-driven counter updates flow for free.
- **`fetchVersions` / `fetchShots` shape in `lib/api.ts`** — Phase 21's `fetchShotGrid` follows the same `qs()` helper + `BASE = ''` same-origin GET pattern; Vite proxies `/api → 127.0.0.1:3000` in dev (Phase 5 D-WEBUI-13).
- **`onSseEvent / offSseEvent` registry in `App.tsx`** — Phase 21 adds one new handler subscription (`shot.status_changed`) alongside the existing version-event handlers; lifecycle (mount subscribe, unmount unsubscribe) already wired.
- **Phase 20's `ShotStatus` type + `SHOT_STATUSES` const** — single source of truth for the 5-status union; the new `<ShotStatusPill/>` imports both. Wire-shape contract for SSE payload (`fromStatus`, `toStatus`) already typed.

### Established Patterns
- **Signal-driven view routing** — Phase 19's `VersionDrawer` overlay sets the precedent for view changes without a router (`selectedVersionId` signal flip). Phase 21 generalizes via `activeView: 'home' | 'shot-grid'` (D-03/D-04). No `react-router-dom` or similar dependency added.
- **URL state via `history.replaceState`** — Phase 18 D-12..D-16 established the URL-state-mirror precedent; Phase 21 extends with `?seq=&view=&statusFilter=&showOmitted=` (D-09). Zod whitelist + fallback-with-warning pattern transferred 1:1.
- **Composite cursor pagination** — Phase 18 D-03 (composite cursor with stable tiebreaker) — Phase 21 cursor encodes `(some_sort_key, shot_id)` for stability. Shot grid default sort is `shot.name ASC` (alphabetical, per VFX naming convention SHOT_010, SHOT_020, etc.); cursor is opaque base64.
- **Lazy-load thumbnails** — `loading="lazy"` + explicit width/height (Phase 17); standard for all dashboard image surfaces; Phase 21 follows.
- **WCAG 2.1 AA badge contract** — Phase 19/20 cross-cutting rule for status badges (color + text, never color alone; ≥ 4.5:1 contrast for text); Phase 21 propagates to `<ShotStatusPill/>`.
- **Tool-engine separation** — engine has zero MCP dependency; HTTP route is a thin Hono handler that delegates to a repo function. Phase 21 follows: thin Hono route, real query lives in store layer.

### Integration Points
- **`packages/dashboard/src/App.tsx`** — extend with `activeView` signal in state, conditional render of HomeView vs ShotGridView, home-icon button in `<header>`, new SSE handler subscription for `shot.status_changed`. Most surface-level change in Phase 21.
- **`packages/dashboard/src/components/TreeSidebar.tsx`** — add `onOpenGrid?: (sequenceId: string) => void` and `currentGridSequenceId?: string` props; render grid-icon button at sequence-row right-end with active-state styling. Component stays pure (D-01..D-02).
- **`packages/dashboard/src/views/`** — new `ShotGridView.tsx` (top-level), new `ShotGridCard.tsx` (child component for individual cards); follows the existing views/ + components/ split convention.
- **`packages/dashboard/src/components/`** — new `ShotStatusPill.tsx` (5-status color-coded pill); reuses the StatusPill design tokens; introduces 5 new CSS custom properties in `theme.css` for the 5 shot-status colors.
- **`packages/dashboard/src/state/`** — new `state/shot-grid.ts` for the per-view signals (`activeView`, `selectedSequenceForGrid`, `shotGrid`, `statusFilter`, `showOmitted`); SSE handler `onShotStatusChanged` (mirrors existing `onVersionStatusChanged` shape) lives here too.
- **`packages/dashboard/src/lib/api.ts`** — add `fetchShotGrid(sequenceId, { cursor?, limit? })` consumer; return type `{ sequence, shots, next_cursor, total_count }`.
- **`packages/dashboard/src/types/`** — add a `ShotGridResponse` type and a `ShotGridRow` type; mirror server response shape exactly. `ShotStatus` is imported from a shared types module that the engine and dashboard both consume (mirrors v1.0 `Version` type sharing).
- **`src/http/dashboard-routes.ts`** — new `GET /api/sequences/:id/shot-grid` route handler; Zod parses `cursor` and `limit` query params and the `:id` path param; delegates to engine/repo for the actual query. No status-filter or omit-filter query param (those are client-side per REQ-03).
- **`src/store/shot-status-repo.ts` or new `src/store/shot-grid-repo.ts`** — single SQL query that joins `shots` + `versions` (filtered to `status='complete'` + latest by `completed_at` per shot, e.g., via window function `ROW_NUMBER() OVER (PARTITION BY shot_id ORDER BY completed_at DESC)`) + denormalizes onto the shot row. Returns `{ shots[], next_cursor, total_count }`. Test verifies `EXPLAIN QUERY PLAN` shows no per-row subquery (REQ-04 lock).
- **`src/engine/pipeline.ts` (facade)** — add `listShotGrid(sequenceId, opts)` facade method delegating to the new repo function. Keeps the tool-engine separation.
- **`packages/dashboard/src/lib/events.ts`** — `shot.status_changed` event type already added by Phase 20; no API change. Phase 21 just subscribes via the existing `onSseEvent` interface.
- **No append-only impact** — Phase 21 is read-only over `shots` and `versions`; no migrations, no new tables. Schema migration count holds at 0008.
- **No new MCP tools** — REQ-05 cross-cutting constraint locks tool count at 7/12; Phase 21 adds zero `server.registerTool()` calls.
- **`src/__tests__/architecture-purity.test.ts`** — no new native bindings, no new sole-importer entries. Confirm during planning.

</code_context>

<specifics>
## Specific Ideas

- **Frame.io / ShotGrid TreeSidebar pattern** — every sequence row has a persistent right-edge grid icon (D-01 visual model). User-affirmed during discussion.
- **"VFX artists know names, not creation dates"** — direct user quote precedent from Phase 18 CONTEXT.md applies to the default shot grid sort: shots are ordered by `name ASC` (SHOT_010, SHOT_020, SHOT_030 convention), not by completed_at or any version-level metric. Confirms the default cursor sort key.
- **Color-coded mini-pills next to title** for aggregate counts (D-14) is the Phase 21 substitute for the eventual Phase 23 stats widget — same visual vocabulary (`<ShotStatusPill/>` color tokens), smaller surface.
- **"Show omitted" toggle is a dataset gate, not a status filter** — emerged during the "All" semantics discussion. The two controls are orthogonal and the URL mirrors both independently (`?statusFilter=...&showOmitted=...`).
- **Phase 18 URL state precedent transfers 1:1** — `history.replaceState` (not pushState; sort and filter are view settings, not navigation events); Zod whitelist + fallback-with-warning; precedence URL > signal > defaults on first mount.
- **Phase 19 `VersionDrawer` overlay sets the signal-driven view-change precedent** — `selectedVersionId` flip opens overlay; the same model generalizes to `activeView` for full-page view switching.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-sequence shot grid rollup** (project-level shot grid showing all sequences) — REQ-01's "grouped under a collapsible sequence header" wording reads as forward-compat for this. Phase 21 ships single-sequence only. Candidate for a future v1.4+ milestone if VFX artists request "show me all shots across the project".
- **Per-shot card hover affordances** (quick-approve, "Open in review panel") — Phase 22 territory (REV-02 explicitly). Phase 21 builds without reserved hover slots; Phase 22 refactors `<ShotGridCard/>` to add `position: relative` + absolutely-positioned action button when it lands.
- **Stats widget in ShotGridView header** (% approved, pending-review backlog, stale-shot count) — Phase 23 (OVR-01 + OVR-03) territory. Phase 21 ships only the client-derived aggregate status counts (D-14); Phase 23 replaces with the richer server-computed widget.
- **Stale shot indicator** (amber warning icon on shots with no completed version in 14 days) — Phase 23 OVR-02. Phase 21 endpoint payload does NOT include `is_stale` or `latest_completed_at` at the shot row level (`completed_at` is nested in `latest_completed_version`); Phase 23 either denormalizes those fields up or adds a `STALE_SHOT_DAYS` computed column.
- **Hover-to-scrub video thumbnails + hover-to-zoom image thumbnails** — Phase 24 POL-01. Phase 21 uses the existing Phase 17 `<Thumbnail/>` component verbatim; Phase 24 extends the thumbnail pipeline (sprite sheet, scrub CSS, image-zoom CSS).
- **Per-shot sort persistence** — Phase 24 POL-03. Phase 21 ships a single default sort (`shot.name ASC`); no sort dropdown on the shot grid (REQ-03 says only a status filter bar). If sort variability emerges as a need before Phase 24, that's a scope decision for Phase 24 planning.
- **Sort dropdown on shot grid** — not in any v1.3 requirement. The Phase 18 SortDropdown applies only to the version grid and tree, not to the shot grid. Deferred indefinitely; reconsider when artist feedback signals need.
- **Workspace-level or project-level grid icon** (rolling up across sequences) — D-01 explicitly restricts grid icons to sequence rows only. Per-sequence scoping is intentional; multi-level grids are deferred to a future milestone.
- **localStorage persistence for filter state** — D-09 chose URL mirror without localStorage. Cross-session persistence is intentionally NOT shipped (avoids the "I forgot the filter was on" surprise). Reconsider if user feedback indicates the URL-only model loses value.

</deferred>

---

*Phase: 21-shot-grid-view*
*Context gathered: 2026-05-12*
