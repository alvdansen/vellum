# Phase 22: Review and Approval - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 22 wires the Phase-20 status engine into the supervisor's review workflow. A new right-rail review panel (mutually exclusive with `<VersionDrawer/>` in the same 560px slot) lets supervisors commit status transitions (Approve, Request Retake, Hold, Omit, plus conditional Restore) via an anchored confirmation popover with an optional note. Inline quick-approve appears as a hover-only check icon on each `<ShotGridCard/>` (refactored from Phase 21's whole-card-button to a `<div>` with three distinct interactive children). A full-viewport A/B comparison modal renders any two user-selected versions of a single shot side-by-side with preloaded thumbnails and a reused metadata-diff display. The shot card now hosts three click affordances — thumbnail → VersionDrawer (Phase 21 D-19 preserved), status pill → review panel (new), hover Approve icon → quick-approve confirmation. Backend mutations route through a new `PATCH /api/shots/:id/status` HTTP endpoint that delegates to the same engine function as the MCP `set_status` arm; tool cap holds at 7/12 (Phase 22 adds zero MCP tools). Out of scope: interactive wipe in A/B comparison (REV-03 lock — static side-by-side only), bulk multi-card actions, touch/mobile equivalents for hover affordances, status-history analytics beyond timeline display.

</domain>

<decisions>
## Implementation Decisions

### Review panel surface & open-from-grid flow
- **D-01:** Status pill click on `<ShotGridCard/>` opens the review panel keyed on `shotId`. Two-affordance card: thumbnail click preserves Phase 21 D-19 (opens `<VersionDrawer/>` for `latest_completed_version.id`), `<ShotStatusPill/>` click opens the new review panel. Frame.io / ShotGrid convention — artwork = view, status chip = workflow.
- **D-02:** Same right-rail slot as `<VersionDrawer/>` (560px width), mutually exclusive. New signal `activeOverlay: Signal<'review' | 'version' | null>` replaces the current `selectedVersionId`-based exclusivity. Single mount host (`<OverlayHost/>` — generalize the existing `<VersionDrawerHost/>` or wrap it). Opening one closes the other; ESC and close-button both transition `activeOverlay` to `null`. Status-pill click swaps the rail from VersionDrawer → ReviewPanel; clicking a version row inside the review panel's timeline swaps it back.
- **D-03:** Panel layout top-to-bottom: header (shot name + current `<ShotStatusPill/>` + close button) → sticky-top action bar (Approve / Request Retake / Hold / Omit, plus conditional Restore when `current_status === 'omit'` per REV-05) → scrollable unified timeline below. Actions stay above the fold and don't scroll away.
- **D-04:** History timeline is a unified, chronologically-interleaved feed of version events (created, completed) AND `shot_status_events` rows. Merged client-side from two data sources: the existing `fetchVersions(shotId)` (or a new shot-scoped variant) + a new `fetchShotStatusHistory(shotId)` that wraps `list_status_history`. Sort: latest first (REV-01 lock). Each version row links to its version — clicking swaps the rail from review → VersionDrawer (mutual exclusion from D-02). Status rows render `<ShotStatusPill/>` + `changed_by` + `formatRelativeTime(created_at)` + optional note text.

### Confirmation popover + notes UX per action
- **D-05:** Anchored popover for every confirmation (panel actions AND grid-card quick-approve). Reuses the `<SortDropdown/>` popover mechanics — outside-click closes without committing, ESC closes, focus returns to trigger button, `aria-haspopup="dialog"` + `aria-expanded`. Content: prompt sentence (action-specific) + notes `<textarea>` (optional, multiline ~3 rows) + Cancel + Confirm buttons. Single shared component `<StatusChangePopover/>` consumed by both surfaces.
- **D-06:** Notes input lives inside the popover for every action — one mental model, one component. Notes are scoped to the specific transition being committed. No persistent panel-level notes field. Avoids the "I wrote a note then clicked the wrong action" failure mode.
- **D-07:** All notes optional — REV-04 storage rule (null when blank, not empty string) drives the submit handler: `note.trim() === '' ? null : note.trim()`. No required-notes UX for any action. Quick-approve from grid stays one-popover-one-click for the common "looks good" path.
- **D-08:** Identical popover styling across all actions; the prompt sentence is the only differentiator: "Approve this shot?" / "Request retake?" / "Hold this shot?" / "Omit this shot?" / "Restore this shot to wip?". No destructive-styled Confirm button, no per-action color coding. Justification: Omit is reversible via Restore (REV-05) — it isn't truly destructive, so loud styling would overstate the friction.
- **D-09:** Restore-action popover variant: hides the notes textarea. The note is system-generated per REV-05 — the literal string `'Restored from omit'`. Showing an editable textarea would be misleading (the user's input would be ignored). Popover renders prompt + Cancel + Confirm only when `action === 'restore'`.

### Quick-approve affordance on ShotGridCard
- **D-10:** Hover-only Check-icon button absolutely positioned in the top-right corner of the thumbnail area (`position: absolute; top: 4px; right: 4px; opacity: 0` → `opacity: 1` on card `:hover` + on `:focus-within` for keyboard a11y). 24×24px clickable target with 4px padding around a 16px `lucide-preact` Check icon. `aria-label="Quick approve {shotName}"`. Anchors the confirmation popover when clicked.
- **D-11:** Quick-approve only — single Check icon, not a 4-action hover bank. REV-02 specifies Approve only; the review panel handles Retake / Hold / Omit. Approve is the highest-frequency action ("most shots pass on first look") so concentrating the grid affordance there matches the workflow and minimizes per-card visual noise.
- **D-12:** Optimistic-update flow: on Confirm, immediately mutate `shotGrid.value.shots[idx].status = 'approved'` (signal update), then dispatch `PATCH /api/shots/:id/status`. On 2xx, do nothing further (SSE `shot.status_changed` arrives shortly after and is a no-op for the local cache — already-correct value). On non-2xx or network error, revert the signal mutation AND render a `<WarningPill/>` (reuse the existing Phase 18 primitive) anchored inside the card with copy "Approve failed — retry". Pill dismisses on next successful action on the same card or after a 5-second timeout (Claude discretion).
- **D-13:** ShotGridCard structural refactor: card root becomes a `<div>` (not a `<button>` — Phase 21 D-16 reversed). Three real `<button>` children: (a) thumbnail area `<button aria-label="Open version drawer for {shot}">` wraps the 16:9 thumbnail / SkeletonThumbnail; (b) `<ShotStatusPill/>` becomes a `<button>` in the existing name+pill row, opening the review panel; (c) hover Check-icon `<button>` per D-10. Shot name + version count + last-updated-relative timestamp remain plain text (not interactive). All buttons sibling, no nesting — valid HTML, WCAG-compliant focus order. The omit-opacity-40 wrapper from Phase 21 D-17 stays at the outer card `<div>`.

### A/B version comparison — selection + layout + entry point
- **D-14:** Version selection via multi-select compare-mode in the review panel timeline. Timeline header shows a "Compare versions..." button (visible only when the shot has ≥2 versions). Clicking enters compare-mode: version rows in the timeline gain a checkbox at the left edge; status rows are excluded from selection (only version rows are A/B-comparable). User picks exactly 2 → header's "Compare" CTA enables → clicking opens the A/B view. ESC or "Cancel compare" exits compare-mode without opening anything. Selection state lives in `compareSelection: Signal<{ a: string | null; b: string | null }>`.
- **D-15:** A/B view renders as a full-viewport modal overlay with semi-transparent backdrop. Triggered from inside the review panel; closes back to the review panel (the panel stays open in the right-rail behind the backdrop). Closes on backdrop click, ESC, and an explicit close button in the modal header. Justification: the 560px right-rail is too narrow for side-by-side thumbnails; switching `activeView` would lose the review-panel context the user just came from. Modal preserves the "back to where I was" mental model. State: `compareModalOpen: Signal<boolean>`.
- **D-16:** Metadata diff data path: new server endpoint `GET /api/versions/:a/diff-with/:b` returning the existing `DiffSummaryShape` (`{ summary, changes, reproduction_divergence }`) Phase 12's DiffDrawer already consumes. Engine reuses `diffVersion()` but extends it to accept an arbitrary base version id rather than implicitly using the parent. Display layer: extract the metadata-rendering portion of `<DiffDrawer/>` into a smaller `<MetadataDiff/>` component (props: `summary`, `changes`); both `<DiffDrawer/>` (Phase 12) and the new `<ABCompareView/>` (Phase 22) consume it. No duplicated diff-rendering logic.
- **D-17:** Thumbnail preload mechanism per REV-03: on mount of `<ABCompareView/>`, fire `Promise.all([imgA.decode(), imgB.decode()])` against `getOutputUrl(versionId, 'thumb.webp')` for both selected versions. Only render the side-by-side comparison panel once both promises resolve. During the preload, render two `<SkeletonThumbnail/>` placeholders with explicit width/height (Phase 17 CLS=0 pattern). `.decode()` is preferred over the bare `load` event — it resolves when the image is paint-ready, avoiding the brief flash. Fallback to `.onload` if `.decode()` rejects (very old browsers).

### Claude's Discretion
- **D-18:** New signal file `packages/dashboard/src/state/review-panel.ts` houses: `activeReviewShotId: Signal<string | null>` (which shot's review panel is open), `activeOverlay: Signal<'review' | 'version' | null>` (mutual exclusion per D-02), `compareSelection: Signal<{ a: string | null; b: string | null }>` (A/B selection), `compareModalOpen: Signal<boolean>` (A/B modal visibility), and the `onShotStatusChanged` SSE handler that already mutates `shotGrid.value.shots` (move it here from Phase 21 D-22's App.tsx location or re-export). Mirrors Phase 21's `state/shot-grid.ts` per-view-domain convention.
- **D-19:** HTTP endpoint `PATCH /api/shots/:id/status` added to `src/http/dashboard-routes.ts`. Body schema (Zod): `{ to_status: ShotStatus, note?: string | null, changed_by?: string }`. Thin Hono handler delegates to `engine/pipeline.ts setShotStatus(db, shotId, body)` — the same engine function backing the MCP `set_status` arm (`src/tools/shot-tool.ts:140`). Reuses the existing `db.transaction()` discipline that wraps the UPDATE shots + INSERT shot_status_events pair (Phase 20 STAT-02). Response: `{ status: ShotStatus, history: ShotStatusEvent[] }` (echoes the same shape `get_status` returns). On error: 400 for invalid `to_status`, 404 for unknown shot, 500 for transaction failure.
- **D-20:** SSE handler interaction with optimistic update: the existing `onSseEvent('shot.status_changed', onShotStatusChanged)` registered in App.tsx (Phase 21 D-22) sets `shotGrid.value.shots[idx].status = event.toStatus` idempotently. For an optimistic quick-approve, the local mutation precedes the SSE; when the SSE arrives with the same value, the handler is a no-op (already-correct state). When the PATCH fails before any SSE could fire, the local revert happens client-side only — no SSE for the rollback. Multi-tab safety: another tab approving the same shot fires `shot.status_changed` regardless of who initiated; the handler converges all open tabs to the latest server state.
- **D-21:** Tool count holds at 7/12. Phase 22 is dashboard-only — engine + MCP wire for `set_status`/`get_status`/`list_status_history` already exists from Phase 20. The new `PATCH /api/shots/:id/status` endpoint is HTTP-only, not registered via `server.registerTool()`. `src/__tests__/tool-budget.test.ts` continues to assert `=== 7`.
- **D-22:** Animation discipline: review panel mount/unmount has NO animation (Phase 5 UI restraint precedent reused by SortDropdown Phase 18). Confirmation popover mount/unmount also NO animation (matches the `<SortDropdown/>` popover). A/B modal backdrop fade is acceptable but capped at ≤150ms with `prefers-reduced-motion: reduce` honored via existing theme.css media query.
- **D-23:** `<ABCompareView/>` modal renders inside a new top-level mount point (e.g., `<ABCompareHost/>` mounted as a sibling to `<OverlayHost/>` in App.tsx). Modal backdrop captures focus (focus-trap), backdrop has `role="dialog"` + `aria-modal="true"` + labelled by the modal header text. ESC and backdrop-click both close. Inside: header (shot name + "v{A} vs v{B}" + close button) → side-by-side thumbnail strip → `<MetadataDiff/>` section below.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 milestone scope and locked requirements
- `.planning/REQUIREMENTS.md` §"Review (REV)" — REV-01..05 (Phase 22's locked requirements: review panel as VersionDrawer-style overlay keyed on shotId with confirmation popovers; quick-approve from grid card with optimistic + revert; A/B comparison of any two versions with parallel-preloaded thumbnails and metadata diff; notes stored as null when blank; Restore Shot only when current_status === 'omit')
- `.planning/ROADMAP.md` §"Phase 22: Review and Approval" — 5 success criteria (review panel overlay + confirmation popovers; inline quick-approve with optimistic update + revert; A/B view loads any two versions with parallel preload; Restore Shot conditional on omit status writing system note; notes stored as null not empty string)
- `.planning/PROJECT.md` §"Current Milestone: v1.3 Production Shot Grid" — milestone driver, tool surface (7/12 cap holds), engine-as-shared-layer architecture rule

### Prior-phase decisions to carry forward
- `.planning/phases/20-shot-status-engine/` — Phase 20 wire surface: `ShotStatus` type + `SHOT_STATUSES` const exported from `src/types/hierarchy.ts`; `set_status` tool arm (`src/tools/shot-tool.ts:52, :140`) writes UPDATE shots + INSERT shot_status_events in a single `db.transaction()`; `getCurrentStatus(db, shotId)` null-coalesces to `'wip'`; `shot.status_changed` SSE event fires with `{ shotId, fromStatus, toStatus, changedBy, note? }`; `shot_status_events` is append-only (grep test `UPDATE shot_status_events` returns zero)
- `.planning/phases/21-shot-grid-view/21-CONTEXT.md` — Phase 21 patterns Phase 22 modifies or reuses: D-16 ShotGridCard-as-whole-button (Phase 22 D-13 reverses → div), D-17 ShotStatusPill (Phase 22 D-13 makes it a button), D-19 thumbnail click → VersionDrawer for latest_completed_version (Phase 22 D-01 preserves), D-22 App.tsx SSE handler registration for `shot.status_changed` (Phase 22 D-20 reuses, may relocate to state/review-panel.ts), Phase 21 D-12 explicit "Phase 22 does its own structural changes when it lands" clearance for the card refactor
- `.planning/phases/19-ai-conversational-summary/19-CONTEXT.md` — D-PRIV-2 first-use disclosure precedent in VersionDrawer (Phase 22 may reference for the review-panel header copy if any privacy-sensitive surface emerges; currently none)
- `.planning/phases/17-visual-thumbnails/17-CONTEXT.md` — `<Thumbnail/>` lazy-load + `<SkeletonThumbnail/>` for CLS=0 patterns (Phase 22 D-17 reuses for A/B view preload placeholders); Phase 17 `/api/versions/:id/output.thumb.webp` URL shape used by the A/B preload's `Image().decode()` calls
- `.planning/phases/12-*` (Phase 12 DiffDrawer + `:id/diff` endpoint) — referenced by Phase 22 D-16; the new `GET /api/versions/:a/diff-with/:b` endpoint reuses the `DiffSummaryShape` and extracts a `<MetadataDiff/>` component from `<DiffDrawer/>` for shared display. Verify with `Read packages/dashboard/src/views/DiffDrawer.tsx` + the existing `diffVersion()` engine call site during planning.
- `.planning/phases/18-sortable-folder-dropdown/18-CONTEXT.md` — `<SortDropdown/>` popover mechanics (anchored, outside-click-close, ESC-close, focus-return-to-trigger) are the precedent Phase 22 D-05 reuses for `<StatusChangePopover/>`; `<WarningPill/>` reused by Phase 22 D-12 for inline quick-approve failure indicator

### Code precedent (patterns to mirror) — files to read before planning
- `packages/dashboard/src/views/VersionDrawer.tsx` — overlay precedent (560px right-rail, header + sections + close); Phase 22's review panel mirrors this structure but with action bar + unified timeline content
- `packages/dashboard/src/views/VersionDrawerHost.tsx` — current mount host; Phase 22 either generalizes this to `<OverlayHost/>` (rendering review-panel OR version-drawer based on `activeOverlay` signal) or adds a sibling `<ReviewPanelHost/>` with mutual-exclusion logic
- `packages/dashboard/src/views/DiffDrawer.tsx` — Phase 12 metadata-diff display layer; Phase 22 extracts the diff-rendering portion into a shared `<MetadataDiff/>` for both `<DiffDrawer/>` and the new `<ABCompareView/>`
- `packages/dashboard/src/components/ShotGridCard.tsx` — current Phase 21 whole-button structure; Phase 22 refactors per D-13 (root → `<div>`, three sibling buttons)
- `packages/dashboard/src/components/ShotStatusPill.tsx` — currently a presentational pill; Phase 22 D-13 promotes it to `<button>` accepting an `onClick` prop for opening the review panel. Keep the pill variant as the base; the button is a wrapper or an `as` prop.
- `packages/dashboard/src/components/SortDropdown.tsx` — popover-mechanics precedent (outside-click + ESC + focus-return); Phase 22 D-05 `<StatusChangePopover/>` adopts these patterns
- `packages/dashboard/src/components/WarningPill.tsx` — Phase 18 inline-error primitive; Phase 22 D-12 reuses inside `<ShotGridCard/>` for quick-approve failure
- `packages/dashboard/src/components/RegenerateButton.tsx` — mutating-action precedent (loading state, debounce); Phase 22's Confirm-button-inside-popover should adopt similar disable-during-pending behavior
- `packages/dashboard/src/state/shot-grid.ts` — per-view signal-file convention Phase 22 D-18 mirrors with a new `state/review-panel.ts`
- `packages/dashboard/src/App.tsx:27-58` — SSE handler registration site (Phase 21 D-22 added `onShotStatusChanged`); Phase 22 D-20 keeps this and may relocate the handler body into `state/review-panel.ts`
- `packages/dashboard/src/lib/api.ts` — fetch-helper layer; Phase 22 adds `setShotStatus(shotId, body)`, `fetchShotStatusHistory(shotId)`, and `diffVersions(a, b)` consumers
- `packages/dashboard/src/lib/copy.ts` — copy registry (Phase 21 added ≥46 exports per the `tool-budget`-style copy assertion); Phase 22 adds review-action copy strings (`REVIEW_APPROVE_PROMPT`, `REVIEW_RETAKE_PROMPT`, `REVIEW_HOLD_PROMPT`, `REVIEW_OMIT_PROMPT`, `REVIEW_RESTORE_PROMPT`, `REVIEW_QUICK_APPROVE_ARIA`, `REVIEW_QUICK_APPROVE_FAIL_RETRY`, etc.)
- `packages/dashboard/src/types/shot-grid.ts` — `ShotGridRow` and `ShotGridResponse` types (Phase 21); Phase 22 adds `ShotStatusEvent` (mirror engine), `ShotHistoryEntry` discriminated union (`{ kind: 'version', ... } | { kind: 'status', ... }`) for unified timeline rendering
- `src/tools/shot-tool.ts:52, :108, :140` — `set_status` arm — Phase 22 D-19's new HTTP endpoint delegates to the same engine function this arm calls
- `src/store/shot-status-repo.ts` — append-only event log persistence; Phase 22 reads via the new endpoint
- `src/store/version-repo.ts` — existing `diffVersion()` for current-vs-parent; Phase 22 D-16 extends to accept an arbitrary base version id (signature change: add optional `baseVersionId` param defaulting to the parent for backward compat)
- `src/http/dashboard-routes.ts` — Phase 22 D-19 adds `PATCH /api/shots/:id/status`; D-16 adds `GET /api/versions/:a/diff-with/:b`
- `src/engine/pipeline.ts` — facade additions: `setShotStatus(db, shotId, { to_status, note, changed_by })` (likely already exists for Phase 20's MCP arm — verify exact name during planning) and `diffVersionsArbitrary(db, a, b)` (or extend existing `diffVersion`)
- `src/__tests__/tool-budget.test.ts` — Phase 22 must not break this (=== 7); D-21 affirms zero new MCP tools
- `src/__tests__/architecture-purity.test.ts` — Phase 22 introduces no new native bindings; allowed-set unchanged

### Cross-cutting
- `CLAUDE.md` §"Architecture Rules" — "Tool cap: Maximum 12 MCP tools" → Phase 22 holds at 7/12 (D-21); "Tool-engine separation: MCP tools are thin Zod-validated entry points that delegate to engine services. Engine has zero MCP dependency." → D-19's new HTTP endpoint is the inverse: HTTP route as a parallel thin entry point delegating to the same engine; "Append-only provenance: Provenance records are never updated or deleted. States are separate rows." → applies to `shot_status_events` (Phase 20 lock); "Paginate all list queries (default 20, include total count)" → `list_status_history` already paginated by Phase 20; the new `PATCH /api/shots/:id/status` is non-list, returns full history snapshot
- `CLAUDE.md` §"Conventions" — "Error responses must be human-readable with actionable guidance" → D-19's 400/404/500 error bodies include actionable next-step copy; "Never return raw JSON dumps to agents — structure responses with context" applies to the response envelope shape
- `.planning/STATE.md` — current position: Phase 21 Wave 5 awaiting human gate; resume per Phase 21 first; Phase 22 begins after Phase 21 ships

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`<VersionDrawer/>` + `<VersionDrawerHost/>`** (Phase 5/12) — overlay precedent for the review panel; same 560px right-rail width via `--drawer-version-width`; header + sections + close button structure transfers verbatim. Phase 22 either generalizes the host to render review-panel OR version-drawer based on `activeOverlay`, or runs two hosts with mutual-exclusion guard.
- **`<DiffDrawer/>` + `diffVersion()` engine call + `DiffSummaryShape`** (Phase 12) — A/B metadata-diff data path; Phase 22 extends the engine function to accept an arbitrary base, adds a new HTTP route, extracts a shared `<MetadataDiff/>` display component, and reuses the shape end-to-end.
- **`<SortDropdown/>` popover mechanics** (Phase 18) — anchored popover with outside-click-close, ESC-close, focus-return-to-trigger, `aria-haspopup`/`aria-expanded`/`aria-controls` plumbing. Phase 22's `<StatusChangePopover/>` adopts these mechanics; only the contents differ (prompt + textarea + buttons vs sort-options list).
- **`<WarningPill/>`** (Phase 18) — inline error display; Phase 22 D-12 reuses inside `<ShotGridCard/>` for quick-approve failure indicator.
- **`<SkeletonThumbnail/>`** (Phase 17) — loading-placeholder pattern; Phase 22 D-17 reuses for A/B view's parallel-preload waiting state.
- **`<ShotStatusPill/>`** (Phase 21) — 5-status badge; Phase 22 D-13 promotes to a `<button>` (acceptable variant: `as="button"` prop, or a wrapping `<button>` containing the existing pill markup); keeps WCAG 2.1 AA compliance (color + text label).
- **`formatRelativeTime`** (Phase 17/19) — relative timestamp display ("2h ago"); Phase 22 reuses for timeline rows' `created_at` display.
- **`@preact/signals` + signal-derived view routing** — Phase 19's `selectedVersionId` and Phase 21's `activeView` set the no-router precedent; Phase 22 D-02 / D-18 add `activeOverlay`, `activeReviewShotId`, `compareSelection`, `compareModalOpen` signals in a new `state/review-panel.ts` file.
- **Phase 20 engine function** for status mutation — `setShotStatus(db, shotId, { to_status, note, changed_by })` (or equivalent name — verify during planning); Phase 22 D-19's new HTTP route delegates to it.
- **Phase 21 SSE handler** `onShotStatusChanged` registered in App.tsx — Phase 22 D-20 reuses; mutation logic is idempotent (sets to broadcasted value regardless of current local state), so optimistic + SSE-confirm flow works without coordination.

### Established Patterns
- **Signal-driven view routing** (Phase 19/21) — no `react-router-dom` or similar; view state is signal flips. Phase 22 D-02 generalizes this to right-rail overlay slotting via `activeOverlay`.
- **Optimistic update + SSE-confirm + error-revert** — Phase 21 didn't ship this exact pattern (read-only), but the SSE handler is built for it (idempotent set-to-broadcasted-value). Phase 22 D-12 establishes the full pattern: signal mutate → PATCH → revert on failure → render `<WarningPill/>`.
- **Append-only event log + transactional write** (Phase 20) — `shot_status_events` rows are immutable; the UPDATE shots + INSERT shot_status_events happens in a single `db.transaction()`. Phase 22 D-19's new HTTP route reuses the same engine path that already enforces this.
- **Mutually-exclusive overlay slotting** (new pattern this phase) — Phase 22 D-02 introduces `activeOverlay` exclusion; precedent for future phases that add more right-rail overlays (e.g., a comments drawer, a settings drawer) — generalizes cleanly.
- **WCAG 2.1 AA badges + buttons** — color + text label, ≥4.5:1 contrast for text, ≥3:1 for UI components; Phase 22 D-13's `<ShotStatusPill/>`-as-button + the hover Approve icon both inherit; popover trigger relationships properly aria-labelled per D-05.
- **Tool-engine separation** — HTTP and MCP are parallel thin entry points to the engine. Phase 22 D-19 reinforces.
- **CSS Grid + 16:9 cards** (Phase 21 D-16) — Phase 22 D-10 inserts the hover Check icon via `position: absolute` inside the thumbnail wrapper — no grid disruption.

### Integration Points
- **`packages/dashboard/src/views/ReviewPanel.tsx`** (new) — top-level component for the review surface. Props: `{ shotId: string; onClose: () => void }`. Composes `<ReviewPanelHeader/>`, `<ReviewActionBar/>`, `<ReviewTimeline/>`. Mirrors `<VersionDrawer/>` shape.
- **`packages/dashboard/src/views/ABCompareView.tsx`** (new) — modal-overlay component for A/B comparison. Props: `{ shotId: string; versionAId: string; versionBId: string; onClose: () => void }`. Composes thumbnail strip + `<MetadataDiff/>`. Mount via new `<ABCompareHost/>` sibling to `<OverlayHost/>`.
- **`packages/dashboard/src/views/OverlayHost.tsx`** (new — generalizes `<VersionDrawerHost/>`) — single right-rail mount point that renders `<VersionDrawer/>` OR `<ReviewPanel/>` based on `activeOverlay.value`. Backward-compat: if a phase doesn't migrate to `activeOverlay`, the existing `selectedVersionId` path still works via a shim.
- **`packages/dashboard/src/components/StatusChangePopover.tsx`** (new) — shared anchored popover. Props: `{ action: 'approve' | 'retake' | 'hold' | 'omit' | 'restore'; anchorRef; onConfirm: (note: string | null) => Promise<void>; onCancel: () => void }`. Reuses `<SortDropdown/>` mechanics.
- **`packages/dashboard/src/components/MetadataDiff.tsx`** (new — extracted from `<DiffDrawer/>`) — display layer for `DiffSummaryShape.summary` + `.changes`. Used by both `<DiffDrawer/>` (Phase 12, refactor to consume) and `<ABCompareView/>` (Phase 22).
- **`packages/dashboard/src/components/ShotGridCard.tsx`** — refactored per D-13: root → `<div>`, three sibling buttons (thumb-as-View, ShotStatusPill-as-button, hover Check icon).
- **`packages/dashboard/src/components/ShotStatusPill.tsx`** — extended to render as a button when `onClick` prop provided; presentational mode preserved for non-interactive contexts (e.g., review panel header).
- **`packages/dashboard/src/state/review-panel.ts`** (new) — `activeReviewShotId`, `activeOverlay`, `compareSelection`, `compareModalOpen` signals + `onShotStatusChanged` SSE handler (relocated from App.tsx or re-exported).
- **`packages/dashboard/src/lib/api.ts`** — adds `setShotStatus(shotId, { to_status, note?, changed_by? })` → `PATCH /api/shots/:id/status` consumer; `fetchShotStatusHistory(shotId)` → wraps engine query (probably reuses existing path); `diffVersions(a, b)` → `GET /api/versions/:a/diff-with/:b` consumer.
- **`packages/dashboard/src/lib/copy.ts`** — adds Phase 22 copy strings (REVIEW_*_PROMPT, REVIEW_QUICK_APPROVE_*, COMPARE_*, RESTORE_*) per Phase 19 / Phase 21 copy-registry convention.
- **`packages/dashboard/src/types/shot-grid.ts`** — adds `ShotStatusEvent` type (mirror engine) and `ShotHistoryEntry` discriminated union for unified timeline.
- **`packages/dashboard/src/App.tsx`** — adopts the new `activeOverlay` signal in the right-rail conditional render; SSE handler import path may shift to `state/review-panel.ts`; minimal change.
- **`src/http/dashboard-routes.ts`** — adds two new routes per D-16 / D-19. Zod schemas for both request shapes.
- **`src/engine/pipeline.ts`** — adds `diffVersionsArbitrary` (or extends existing `diffVersion` with an optional baseVersionId param defaulting to parent for backward compat); verifies the existing `setShotStatus` engine path used by the MCP `set_status` arm.
- **`src/store/version-repo.ts` `diffVersion()`** — signature change to accept arbitrary base (D-16). Existing callers (Phase 12 MCP arm) pass no second arg → defaults to parent → unchanged behavior.
- **`src/__tests__/architecture-purity.test.ts`** — no new native bindings; allowed-set unchanged.
- **`src/__tests__/tool-budget.test.ts`** — must remain green at `=== 7`.

</code_context>

<specifics>
## Specific Ideas

- **Frame.io / ShotGrid pattern** — status chip = workflow surface; artwork area = view surface. Phase 22 D-01 adopts this directly: thumbnail click → view (VersionDrawer); status pill click → workflow (review panel).
- **"Most shots pass on first look"** — supervisor-workflow heuristic informing D-11 (Approve-only grid affordance). Other transitions (Retake, Hold, Omit) are lower-frequency and benefit from the deliberation of opening the panel.
- **Mutually-exclusive right-rail slotting** — emerged during Area 1 discussion (D-02). Single signal `activeOverlay` governs both Drawer and Panel. Sets a clean precedent for future right-rail-style features.
- **`.decode()` over bare `.onload`** — D-17 thumbnail preload mechanism; `.decode()` resolves when image is paint-ready (no flash); falls back to `.onload` if `.decode()` rejects.
- **`<SortDropdown/>` popover mechanics as shared primitive** — anchored + outside-click-close + ESC + focus-return are exactly the contract the confirmation popover needs. D-05 adopts; future popovers (e.g., a comments dropdown, a filter popover) should also extract from this.
- **Restore notes are system-generated, not user input** — REV-05 + D-09 lock — popover hides the textarea for Restore action specifically. Honest UI: don't show a field whose input will be ignored.

</specifics>

<deferred>
## Deferred Ideas

- **Interactive wipe in A/B comparison** — REV-03 explicitly excludes for v1.3 ("No interactive wipe in v1.3 — static side-by-side only."). Candidate for a future polish phase if supervisor feedback requests it; would extend `<ABCompareView/>` with a draggable divider over the two thumbnails.
- **Bulk multi-card selection + batch approve** — shift-click multi-select cards on the grid, then a batch-approve action. Not in REV-* spec; would expand REV-02 to a multi-shot path. Candidate for a future milestone if VFX artists report friction with one-at-a-time approval.
- **Quick actions for Retake / Hold / Omit on the grid card** — Phase 22 D-11 limits the hover affordance to Approve only. If supervisor feedback shows the panel is friction for high-frequency Retake/Hold, a follow-up phase could add a hover-banner with all 4 actions (or the menu variant from the Area 3 Q2 options).
- **Touch / mobile equivalent of the hover Approve icon** — D-10 is hover-only; touch devices have no hover. v1.3 is desktop-first; a future mobile-pass phase could replace hover with a long-press menu or always-visible footer button (option B from Q1).
- **Per-shot review history beyond version + status events** — timeline currently merges versions + status events (D-04). Future additions could include: comments, time-on-status analytics, supervisor productivity stats. None in v1.3 spec.
- **Email / Slack notifications on status change** — out of scope for v1.3 (no integration layer). Candidate for a future "notifications" milestone after the core review workflow is validated.
- **Persistent A/B compare-state across panel close** — `compareSelection` clears when the review panel closes (D-14 implicit). A future phase could persist the most-recent-pair per shot if supervisors report wanting to "come back to the same comparison".
- **Inline note editing in the timeline** — Phase 22 honors REV-04 (notes append-only — never editable). If a user makes a typo, they have to write a new status-transition note (or a no-op transition with the corrected note). Deferred — append-only is a strong invariant.
- **Compare across shots (not just within a shot)** — A/B view is scoped to two versions of THE SAME shot (D-14). Compare-across-shots is a different mental model (cross-shot consistency review) and is out of v1.3 scope.
- **Confirmation-popover destructive-action styling** — Area 2 Q4 surfaced this; D-08 chose identical styling because Omit is reversible. If supervisor feedback reveals accidental Omits, a follow-up phase could add the destructive variant (option B from that question).

</deferred>

---

*Phase: 22-review-and-approval*
*Context gathered: 2026-05-14*
