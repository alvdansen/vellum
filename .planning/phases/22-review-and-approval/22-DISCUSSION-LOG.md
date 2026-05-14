# Phase 22: Review and Approval - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 22-review-and-approval
**Areas discussed:** Review panel surface & open-from-grid flow, Confirmation popover + notes UX per action, Quick-approve affordance on ShotGridCard, A/B version comparison — selection + layout + entry point

User invited autonomous-mode part-way through Area 3 ("activate autonomous mode, and just follow your own best recommendations and just sprint on this"). Remaining decisions from that point onward were Claude-selected per the recommended option; all four areas have full decisions captured, with autonomous selections annotated below.

---

## Review panel surface & open-from-grid flow

### Q1: How should the review panel open from the shot grid?

| Option | Description | Selected |
|--------|-------------|----------|
| Status pill click → review panel | Two-affordance card: thumbnail click preserves Phase 21 D-19 (VersionDrawer for latest_completed_version); ShotStatusPill click opens the new review panel keyed on shotId. Frame.io / ShotGrid convention. | ✓ |
| Whole-card click → review panel (replaces VersionDrawer routing) | Refactors Phase 21 D-19: card click opens review panel; VersionDrawer becomes a sub-action ('View output' button per timeline row). Breaks the Phase 21 contract. | |
| New dedicated 'Review' button on card | Third affordance alongside thumb + status pill. Three click targets — explicit but visually busy. Conflicts with quick-approve real estate. | |

**User's choice:** Status pill click → review panel
**Notes:** Aligns with Frame.io / ShotGrid pattern — artwork = view, status chip = workflow. Preserves Phase 21 D-19.

### Q2: Review panel overlay model — same right-rail slot, separate slot, or mutually exclusive?

| Option | Description | Selected |
|--------|-------------|----------|
| Same right-rail slot, mutually exclusive | Single 560px slot. New `activeOverlay = 'review' \| 'version' \| null` signal replaces `selectedVersionId` exclusivity. Opening one closes the other. | ✓ |
| Separate right-rail slots (stack them) | Two 560px rails — both can be open. Consumes 1120px. Complicates A/B comparison view. | |
| Modal-style overlay (centered, not right-rail) | Departs from VersionDrawer precedent. Awkward when user wants to keep grid context visible. | |

**User's choice:** Same right-rail slot, mutually exclusive
**Notes:** Single mount host; sets precedent for future right-rail overlays. Status-pill click swaps the rail.

### Q3: How should the review panel be structured top-to-bottom?

| Option | Description | Selected |
|--------|-------------|----------|
| Header → Action bar (sticky top) → Timeline below | Actions stay above the fold. Mirrors Frame.io / Wipster decision-as-primary-action conventions. | ✓ |
| Header → Timeline scrollable → Action bar (sticky bottom) | Forces scrolling history before acting. Possibly overkill given confirmation popovers already exist. | |
| Header → Timeline scrollable → Actions inline (in-timeline) | No dedicated action bar — actions appear inline as the topmost timeline row. Awkward for Omit (destructive next to history). | |

**User's choice:** Header → Action bar (sticky top) → Timeline below
**Notes:** Action bar contains Approve / Retake / Hold / Omit + conditional Restore when current_status === 'omit'.

### Q4: What does the review panel's history timeline contain?

| Option | Description | Selected |
|--------|-------------|----------|
| Unified timeline — interleave version + status events chronologically | Single feed merging versions + shot_status_events client-side. Tells the full story. Each version row links to its version (swaps rail to VersionDrawer). | ✓ |
| Two stacked sections — 'Versions' above 'Status history' below | Cleaner separation; easier to engineer. Less narrative. | |
| Status events only — version history stays in VersionDrawer | Strict reading of REV-01. Panel feels thin on shots without status churn. | |

**User's choice:** Unified timeline — interleave version + status events chronologically
**Notes:** Two data sources merged client-side: fetchVersions(shotId) + fetchShotStatusHistory(shotId).

---

## Confirmation popover + notes UX per action

### Q1: What form factor should the per-action confirmation take?

| Option | Description | Selected |
|--------|-------------|----------|
| Anchored popover | Floating popover anchored to action button. Reuses SortDropdown mechanics (outside-click close, ESC, focus return). Contains prompt + notes textarea + Cancel + Confirm. Works on grid and in panel. | ✓ |
| Button morphs into Confirm + Cancel pair | Compact, no popover library. But no place for notes without a two-step flow. Awkward on small grid card. | |
| Modal dialog with backdrop | Heavier visual weight. Two patterns needed if used selectively. Inconsistent. | |

**User's choice:** Anchored popover
**Notes:** Single shared `<StatusChangePopover/>` consumed by both review panel and grid quick-approve.

### Q2: Where does the notes input live inside the review panel?

| Option | Description | Selected |
|--------|-------------|----------|
| Inside the popover for every action | Same UX everywhere. One mental model, one component. Notes scoped to specific transition. | ✓ |
| Form-style: dedicated notes field in the panel, popover just confirms | Easier to write longer notes. Two patterns (asymmetric with grid). Risk of writing note then clicking wrong action. | |
| Conditional: popover-notes for grid; panel-form-notes for in-panel | Explicit different patterns by context. Most flexible but two confirmation flavors to maintain. | |

**User's choice:** Inside the popover for every action
**Notes:** Avoids the "wrote a note then clicked wrong action" failure mode.

### Q3: Are notes required for any actions, or optional everywhere?

| Option | Description | Selected |
|--------|-------------|----------|
| All notes optional — stored as null when blank | REV-04 storage rule (null when blank). Low friction. Quick-approve stays one-popover-one-click. | ✓ |
| Required for Retake and Hold; optional for Approve and Omit | Forces a 'why' on transitions that need artist context. | |
| Required for Omit (destructive); optional for everything else | Only the irreversible-feeling action requires justification. | |

**User's choice:** All notes optional — stored as null when blank
**Notes:** Submit handler: `note.trim() === '' ? null : note.trim()`.

### Q4: Should the confirmation popover have varying visual severity per action?

| Option | Description | Selected |
|--------|-------------|----------|
| Identical popover; prompt copy is the only differentiator | Same shape, colors, button placement. Prompts vary: 'Approve this shot?' / 'Hold this shot?' / etc. | ✓ |
| Omit gets a destructive style (red Confirm button + warning hint) | Signals 'disruptive one' without blocking the flow. Two CSS variants to maintain. | |
| Per-action color coding matching each status's pill color | Strong visual reinforcement. Color tokens designed for badges, not buttons — WCAG contrast risk for button text. | |

**User's choice:** Identical popover; prompt copy is the only differentiator
**Notes:** Justification: Omit is reversible via Restore (REV-05) — not truly destructive, so loud styling would overstate the friction.

---

## Quick-approve affordance on ShotGridCard

### Q1: Where on the ShotGridCard does the quick-approve button live?

| Option | Description | Selected |
|--------|-------------|----------|
| Hover-only Approve icon, top-right corner of the thumbnail | Absolute-positioned Check icon. Appears on card hover or keyboard focus. Aligns with Phase 24's planned hover affordances. | ✓ |
| Always-visible Approve button in the bottom-right of the card footer | No hover discovery cost; tap-friendly. Eats footer space Phase 23/24 might want. | |
| Right-click / context menu on the card | Zero pixels added. Very discoverable for power users; invisible for new users. Mobile/touch has no equivalent. | |

**User's choice:** Hover-only Approve icon, top-right corner of the thumbnail
**Notes:** 24×24px target with 4px padding around 16px lucide-preact Check icon. Aria-label 'Quick approve {shotName}'.

### Q2: Quick-approve only, or other quick actions on hover too?

| Option | Description | Selected |
|--------|-------------|----------|
| Quick-approve only — a single Check icon | REV-02 specifies Approve only. Approve is highest-frequency action. Less visual noise. | ✓ |
| All 4 actions on hover — row of icons | Completes grid-level review surface. More icons to disambiguate. Risk of accidental Omit on hover. | |
| Single hover icon — opens a 4-action menu | Compromise. Two-step (pick action, then confirm). Adds a click vs single-Approve path. | |

**User's choice:** Quick-approve only — a single Check icon
**Notes:** "Most shots pass on first look" supervisor workflow heuristic.

### Q3: When the optimistic quick-approve PATCH fails, how should the error be surfaced?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline error pill on the card + auto-revert | Status reverts; small `<WarningPill/>` appears in card. Self-contained per-card. Reuses Phase 18 primitive. | ✓ |
| Global toast notification + auto-revert | Higher visibility but breaks per-card encapsulation. Needs new toast system. | |
| Both: inline pill + global toast | Maximum visibility. Risks toast spam on batch operations. | |

**User's choice:** Inline error pill on the card + auto-revert
**Notes:** Pill dismisses on next successful action or after 5-second timeout (Claude discretion).

### Q4: Phase 21's whole-card `<button>` can't host nested buttons — how to restructure?

| Option | Description | Selected |
|--------|-------------|----------|
| Card becomes a `<div>`; thumbnail is the explicit 'View' button | Three real `<button>`s: thumbnail, status pill, hover Approve icon. Valid HTML. Smaller VersionDrawer click target but explicit. | ✓ |
| Card stays as `<div role='button' tabindex='0'>`; child buttons stop propagation | Preserves whole-card click target. role='button' on div requires manual keyboard handlers — code-smell when a real `<button>` would do. | |
| Combined 'view' area as one button — thumbnail + name + last-updated | Larger view click target. Less consistent visual model. | |

**User's choice:** Card becomes a `<div>`; thumbnail is the explicit 'View' button
**Notes:** Three sibling buttons inside the `<div>`. Shot name + version count + last-updated stay as plain text. Omit-opacity-40 wrapper from Phase 21 D-17 stays at the outer `<div>`.

---

## A/B version comparison — selection + layout + entry point

> All four decisions in this area were Claude-selected per the user's autonomous-mode invite. Alternatives below reflect Claude's analysis before commit; no AskUserQuestion was fired.

### Q1: Version selection mechanism (Claude-selected)

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-select compare-mode in the review panel timeline | Header "Compare versions..." button; rows gain checkboxes; pick 2; "Compare" CTA activates. Honors Area 1 D-04 unified timeline. | ✓ |
| Per-row "Compare to..." dropdown | Each version row has a "Compare to..." button opening a list of other versions. Fewer clicks but clutters the unified timeline. | |
| Sticky comparison-pair drop zone | Drag-or-click versions into "A" and "B" slots at the panel footer. More direct manipulation; novel UI pattern not used elsewhere in dashboard. | |

**Claude's choice:** Multi-select compare-mode in the timeline
**Notes:** Honors the unified-timeline decision (D-04); explicit mode entry/exit (Compare button → checkbox mode → Cancel/Compare). Selection state in `compareSelection: Signal<{ a, b }>`.

### Q2: A/B view surface (Claude-selected)

| Option | Description | Selected |
|--------|-------------|----------|
| Full-viewport modal overlay with backdrop | Triggered from review panel; closes back to panel. Preserves right-rail context. Standard lightbox pattern. | ✓ |
| New `activeView = 'compare'` route (full-page) | Navigates away from grid + panel. Needs explicit Back button to return. | |
| Side-by-side rendering inside the review panel | Right-rail (560px) too narrow for two thumbnails side-by-side. Layout breaks. | |

**Claude's choice:** Full-viewport modal overlay with backdrop
**Notes:** Closes on backdrop click, ESC, explicit close button. Review panel stays open in the right-rail behind backdrop.

### Q3: Metadata diff endpoint and shape (Claude-selected)

| Option | Description | Selected |
|--------|-------------|----------|
| New endpoint `GET /api/versions/:a/diff-with/:b` reusing Phase 12 DiffSummaryShape | Engine extends `diffVersion()` with optional baseVersionId param. Extract `<MetadataDiff/>` from `<DiffDrawer/>` for shared display. | ✓ |
| Compute diff client-side from two versions' loaded data | No new endpoint. Duplicates engine diff logic in client. Harder to keep consistent with Phase 12's diff semantics. | |
| Extend Phase 12's `:id/diff` endpoint with `?compare=` query param | Single endpoint. URL becomes confusing (`:id/diff?compare=:other` reads as "diff of id, compared to other" which is ambiguous). | |

**Claude's choice:** New endpoint `GET /api/versions/:a/diff-with/:b`
**Notes:** Engine `diffVersion()` signature change: add optional `baseVersionId` defaulting to parent (backward compat for Phase 12 callers). New `<MetadataDiff/>` component shared by `<DiffDrawer/>` and `<ABCompareView/>`.

### Q4: Thumbnail preload mechanism (Claude-selected)

| Option | Description | Selected |
|--------|-------------|----------|
| `Promise.all([imgA.decode(), imgB.decode()])` before render | `.decode()` resolves when image is paint-ready. Falls back to `.onload` if `.decode()` rejects. Honors REV-03 spec verbatim. | ✓ |
| Bare `new Image().src` parallel + arbitrary delay before render | Simpler but possible flash if render fires before image is ready. | |
| `<img loading="eager">` paired siblings, render immediately | Spec REV-03 explicitly says "preloaded in parallel BEFORE the comparison panel mounts". This option violates that. | |

**Claude's choice:** `Promise.all([imgA.decode(), imgB.decode()])`
**Notes:** During preload, render two `<SkeletonThumbnail/>` placeholders with explicit width/height (Phase 17 CLS=0 pattern). Reuses `getOutputUrl(versionId, 'thumb.webp')`.

---

## Claude's Discretion

The following decisions were not framed as AskUserQuestion items but follow from the chosen options and codebase conventions:

- **D-09 (Restore-action popover hides the textarea)** — REV-05 locks the note value as the literal string 'Restored from omit'. Showing an editable textarea would mislead.
- **D-18 (New `state/review-panel.ts` signal file)** — mirrors Phase 21's `state/shot-grid.ts` per-view-domain convention.
- **D-19 (New `PATCH /api/shots/:id/status` HTTP endpoint)** — dashboard talks HTTP, MCP arm is engine-shared. Thin Hono handler delegates to the same engine function the MCP `set_status` arm already uses.
- **D-20 (SSE handler interacts with optimistic update idempotently)** — Phase 21 D-22 SSE handler already sets to broadcasted value regardless of current local state, so optimistic + SSE-confirm works without coordination.
- **D-21 (Tool count holds at 7/12)** — Phase 22 is dashboard-only; no new MCP tools.
- **D-22 (Animation discipline: no panel/popover mount animations; modal backdrop fade ≤150ms with prefers-reduced-motion honored)** — Phase 5 UI restraint precedent reused by SortDropdown.
- **D-23 (New top-level `<ABCompareHost/>` mount point sibling to overlay host; focus-trap + aria-modal + ESC + backdrop-click close)** — WCAG modal conventions; matches dialog-pattern best practices.

## Deferred Ideas

- Interactive wipe in A/B comparison — REV-03 lock excludes from v1.3.
- Bulk multi-card selection + batch approve — out of REV-* scope.
- Quick actions for Retake / Hold / Omit on the grid card — start with Approve only; revisit if feedback signals friction.
- Touch / mobile equivalent of hover Approve — v1.3 is desktop-first.
- Per-shot review history beyond version + status events (comments, time-on-status analytics) — not in v1.3.
- Email / Slack notifications on status change — no integration layer in v1.3.
- Persistent A/B compare-state across panel close — `compareSelection` clears on panel close.
- Inline note editing in the timeline — append-only invariant (REV-04 lock).
- Compare across shots (not just within a shot) — A/B is shot-scoped for v1.3.
- Confirmation-popover destructive-action styling — Omit reversible via Restore; revisit if accidental Omits become a pattern.
