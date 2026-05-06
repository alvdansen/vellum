# Phase 18: Sortable Folder Dropdown - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 18-sortable-folder-dropdown
**Areas discussed:** NULL completed_at handling, Tree sidebar sort control, URL state mirror format & precedence, Pagination UX

---

## NULL completed_at handling

### Q1 — Where do in-progress versions go on "Latest" sort?

| Option | Description | Selected |
|--------|-------------|----------|
| Top — in-progress first (Recommended) | NULLS FIRST. In-progress at top with SkeletonThumbnail; sub-sorted by created_at DESC. Cost: composite cursor needs NULLS FIRST clause + tiebreaker. | ✓ |
| Bottom — completed first, then in-progress | NULLS LAST. Strict literal reading of SORT-01. Cleanest invariant; in-progress sinks below scroll until finished. | |
| Filter out in-progress entirely | Hide non-complete rows; ActiveGenerationsPanel handles them separately. Behavior change vs today; may surprise users mid-render. | |
| Coalesce — sort by COALESCE(completed_at, created_at) DESC | Single coherent recency ordering. Mixes 'done' and 'in-flight' under same key. | |

**User's choice:** Top — in-progress first
**Notes:** Drives D-01..D-04. Aligns with "in-flight work is never buried" UX rule.

### Q2 — Where do in-progress versions go on "Oldest" sort?

| Option | Description | Selected |
|--------|-------------|----------|
| Top — always pinned (Recommended) | NULLS FIRST on BOTH directions. Consistent rule; simpler mental model. Tradeoff: violates strict SQL symmetry. | ✓ |
| Bottom — mirror Latest | NULLS FIRST on DESC, NULLS LAST on ASC. Symmetric SQL behavior. Tradeoff: artists sorting Oldest miss recent in-flight work. | |
| Filter out on Oldest | Hide in-progress when sort=Oldest. Inconsistent (some sorts hide rows, others don't). | |

**User's choice:** Top — always pinned
**Notes:** Confirms "in-flight always visible" UX rule applies regardless of sort direction. Drives the composite cursor's first ORDER BY term `(completed_at IS NULL) DESC` which never flips with sort direction.

---

## Tree sidebar sort control

### Q1 — Should the tree sidebar get a visible sort control?

| Option | Description | Selected |
|--------|-------------|----------|
| One tree-wide dropdown (Recommended) | Small <SortDropdown/> above TreeSidebar, applies to all levels. Reuses grid dropdown component. localStorage key: vfx-familiar:sort:tree. | ✓ |
| Hardcoded A→Z, no control | Simplest UI, smallest plan. Tradeoff: SORT-03 sort persistence only applies to the grid. | |
| Per-level toggle | Each level sorts independently. Most flexible, complex UI, more state. Possibly v1.3. | |
| A→Z default, only via Preferences menu | No inline UI. Implies adding a Preferences panel — scope creep. | |

**User's choice:** One tree-wide dropdown
**Notes:** Drives D-06..D-11. Same `<SortDropdown/>` component used on both panes (reuse, not duplicate). Engine `listProjects/listSequences/listShots` gain narrower whitelist enum (`name | created_at`).

---

## URL state mirror format & precedence

### Q1 — What URL shape encodes the sort state?

| Option | Description | Selected |
|--------|-------------|----------|
| Separate query params (Recommended) | ?gridSort=completed_at:desc&treeSort=name:asc. Easy to read, easy to extend, no routing library needed. | ✓ |
| One combined param | ?sort=grid:...,tree:... Less namespace pollution. Harder to read, harder to extend. | |
| Hash-based | #sort/... Client-only, unusual for sort state, weird back/forward. | |
| Path-based | /sort/grid/.../tree/... REST-style. Requires routing library — scope creep. | |

**User's choice:** Separate query params
**Notes:** Sets the precedent for future URL state additions (selected shot, version, etc.).

### Q2 — Who wins when localStorage and URL disagree on first load?

| Option | Description | Selected |
|--------|-------------|----------|
| URL wins, doesn't touch localStorage (Recommended) | URL applies on first load; personal pref preserved. User changes update both going forward. | ✓ |
| URL wins AND writes to localStorage | Simpler invariant. Clicking a teammate's link silently overwrites user's pref. | |
| localStorage wins, URL ignored | Effectively kills shareable views. | |
| URL only if explicitly opted-in | Adds explicit toggle. Extra UI surface for v1.2. | |

**User's choice:** URL wins, doesn't touch localStorage
**Notes:** "Shareable links don't hijack personal preferences" UX rule. Drives D-13.

### Q3 — How should the URL update on dropdown change?

| Option | Description | Selected |
|--------|-------------|----------|
| replaceState — no back-stack entry (Recommended) | URL updates in place; back button doesn't replay sort toggles. Matches Linear/Figma/GitHub PRs. | ✓ |
| pushState — each change adds history | User can back-arrow through sort history. Pollutes navigation. | |
| Explicit 'Copy link' only | Don't update URL reactively. Adds UI surface; URL no longer mirrors state per SORT-03. | |

**User's choice:** replaceState — no back-stack entry
**Notes:** Drives D-14.

### Q4 — Show URL params explicitly when on default sort, or stay clean?

| Option | Description | Selected |
|--------|-------------|----------|
| Always explicit (Recommended) | URL always shows gridSort + treeSort, even on defaults. Deterministic shareable links. Noisier URLs. | ✓ |
| Hide params on default | Empty URL = defaults. Cleaner URLs. Tradeoff: shareable 'reset to default' link can be overridden by recipient's localStorage. | |
| Always explicit, but hide when both default | Middle path. Subtle rule, more test cases. | |

**User's choice:** Always explicit
**Notes:** Drives D-15. Deterministic shareable links win over URL aesthetic.

---

## Pagination UX

### Q1 — What's the pagination surface on the version grid?

| Option | Description | Selected |
|--------|-------------|----------|
| 'Load more' button (Recommended) | Fetch first page of 20. Bottom button: 'Load 20 more (32 remaining)'. Predictable, easy to test. | ✓ |
| Infinite scroll | IntersectionObserver auto-trigger. Smooth/modern. More complex, harder to test. | |
| Numbered pages | Classic 'Page 1 of 8'. Cursor doesn't natively support 'jump to page N'. Awkward fit. | |
| No UI — increase the cap | Keep 'fetch all' approach. Punts cursor pagination, violates SORT-05. | |

**User's choice:** 'Load more' button
**Notes:** Drives D-17. Conservative v1.2 ship; infinite scroll deferred to v1.3.

### Q2 — When sort changes (cursor resets to page 1), what happens to scroll?

| Option | Description | Selected |
|--------|-------------|----------|
| Snap to top (Recommended) | Sort change → cursor reset → scrollTop=0. Consistent 'fresh sort, fresh view'. | ✓ |
| Preserve scroll position | Stay where the user was. Tradeoff: items shift under cursor; what they were looking at may be off-screen. | |
| Smart-restore — scroll to last-clicked card if still rendered | Best UX, most code. Edge cases when version is now off-page. | |

**User's choice:** Snap to top
**Notes:** Drives D-19.

---

## Claude's Discretion

The user delegated the following implementation choices to Claude — these are noted in CONTEXT.md `<decisions>` "Claude's Discretion" subsection and resolved during research/planning:

- `<SortDropdown/>` component implementation: keyboard nav, ARIA roles, focus styling, theme tokens. Match Phase 17 thin-wrapper polish bar.
- Cursor encoding: opaque base64-encoded JSON `{ completed_at, version_id }` (industry standard pattern).
- "Load more" loading state: skeleton card row OR button-internal spinner.
- "Load more" error handling: inline error pill below button with Retry action.
- Total count display text: "Load N more (M remaining)" preferred over "Page X of Y".
- HTTP route migration: cursor as query param, GET stays GET, no POST.
- Tree sort propagation: client-side re-sort from cached children OR server re-fetch on tree-sort change. Recommend client-side re-sort (faster, no extra fetches).
- URL parse error mode: graceful fallback to default + console warning, never throw.
- localStorage write failure: silent fall-through (mirrors theme toggle pattern).
- ARIA labels for the dropdown: `aria-label="Sort versions by"` / `aria-label="Sort tree by"`.
- Engine ORDER BY enum naming: `SortField` / `SortDirection` / `HierarchySortField` exported from `src/store/types.ts` (or new `sort.ts`).
- Bounded-key LRU helper: `setBoundedLocalStorageEntry(prefix, key, value, maxKeys)` with cap ~50.

## Deferred Ideas

(Captured in CONTEXT.md `<deferred>` section.)

- Per-shot sort persistence (REQUIREMENTS-deferred to v1.3)
- Per-level tree sort (v1.3 if user demand surfaces)
- Infinite scroll on the version grid (v1.3)
- Numbered pagination (rejected — awkward fit with cursor)
- Smart-restore scroll position on sort change (v1.3 polish)
- "Recently active" / tag-recency sort (REQUIREMENTS-deferred)
- Explicit "Copy shareable link" button (rejected — reactive URL is the contract)
- Total count display as "Page X of Y" (rejected — cursor doesn't page-jump)
- URL pushState granularity (rejected — sort is not a navigation event)
- Auto-refresh of grid on new version completion / SSE-driven slide-in (v1.3 or Phase 19)
- Three-way precedence with server-stored sort preferences (out of scope — single-user demo)
