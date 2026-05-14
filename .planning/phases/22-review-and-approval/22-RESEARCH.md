# Phase 22: Review and Approval — Research

**Researched:** 2026-05-14
**Domain:** Production review workflow — review panel overlay, anchored confirmation popovers, A/B version comparison, optimistic mutations + SSE-confirm, structural ShotGridCard refactor
**Confidence:** HIGH (all surfaces grounded in existing repo code; no library version drift; UI-SPEC already approved by checker)

## Summary

Phase 22 is dashboard-only — every backend hook the dashboard needs already exists in the engine facade and only needs two new HTTP routes wrapped around it. The Phase 20 engine signature `engine.setShotStatus(shotId, toStatus, changedBy, note?)` (pipeline.ts:703) takes positional args and writes UPDATE-shots + INSERT-shot_status_events in one `db.transaction()`; the new `PATCH /api/shots/:id/status` is a thin Zod-validated body unpacker that calls this function. The existing `engine.diffVersions(versionAId, versionBId)` (pipeline.ts:1062) ALREADY accepts ANY two version IDs — the pure `diffVersions()` (engine/diff.ts:172) asserts only same-shot — so D-16's "extend to arbitrary base" is a misread of training-stale state: NO engine change needed. The only requirement is a new `GET /api/versions/:a/diff-with/:b` HTTP route that calls the same async facade.

`<DiffDrawer/>` currently renders ONLY `diff.summary` (one line) — not the structured `changes[]`. The `<MetadataDiff/>` extraction needs to BOTH preserve the existing DiffDrawer surface AND surface `DiffChanges.params/models/seed/workflow/metadata` for the new A/B view. The Phase 21 `onShotStatusChanged` SSE handler (state/shot-grid.ts:160-171) already mutates `shotGrid.value.shots[idx].status` idempotently — perfect for optimistic-update flow without relocation. The `<SortDropdown/>` precedent (SortDropdown.tsx) supplies the verbatim popover mechanics (outside-click via `document.addEventListener('mousedown')` only while open, ESC closes + returns focus to trigger via `triggerRef.current?.focus()`).

**Primary recommendation:** Reuse — don't extend. Two new HTTP routes (`PATCH /api/shots/:id/status`, `GET /api/versions/:a/diff-with/:b`), one new shape `MetadataDiff` component that renders both summary AND changes, one shared `StatusChangePopover` component, one new signal file `state/review-panel.ts`. Keep `onShotStatusChanged` where it is. Tool count holds at 7/12 (zero new MCP tools).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Status transition write (engine) | API / Backend | Database | Wraps UPDATE-shots + INSERT-events in single transaction (Phase 20 lock); HTTP layer is thin Zod body unpacker [VERIFIED: pipeline.ts:703] |
| Status transition route | API / Backend | — | New `PATCH /api/shots/:id/status` mirrors MCP `set_status` arm (D-19 dual-entry) [VERIFIED: shot-tool.ts:140] |
| Status-history read | API / Backend | Database | `engine.listShotStatusHistory(shotId, limit)` ALREADY exists; either reuse a new GET route OR call existing MCP-tool-shaped endpoint (no MCP-tool endpoint exists on HTTP — see Open Question Q3 below) [VERIFIED: pipeline.ts:785] |
| Diff data path (any two versions) | API / Backend | Database + Disk | `engine.diffVersions(a, b)` already accepts arbitrary pair; new HTTP route is the only new code [VERIFIED: pipeline.ts:1062, diff.ts:172] |
| Diff metadata rendering | Browser / Client | — | Pure presentation; extracted from DiffDrawer into `<MetadataDiff/>` [CITED: 22-UI-SPEC.md L377] |
| Review panel overlay state | Browser / Client | — | New signals: `activeOverlay`, `activeReviewShotId`, `compareSelection`, `compareModalOpen` in `state/review-panel.ts` (D-18) [CITED: 22-CONTEXT.md L42] |
| Mutually-exclusive right-rail slotting | Browser / Client | — | New signal-derived `<OverlayHost/>` reads `activeOverlay` and renders ReviewPanel OR VersionDrawer (D-02) [CITED: 22-CONTEXT.md L18] |
| Quick-approve optimistic mutate | Browser / Client | API / Backend | Local `shotGrid.value.shots[idx].status` write precedes PATCH; revert + WarningPill on failure (D-12) [CITED: 22-CONTEXT.md L33] |
| Anchored confirmation popover | Browser / Client | — | Reuses `<SortDropdown/>` mechanics — `useRef` + `document.mousedown` + ESC + focus-return (D-05) [VERIFIED: SortDropdown.tsx:144-211] |
| A/B compare modal + thumbnail preload | Browser / Client | API / Backend (thumbnails) | `Image().decode()` + `<SkeletonThumbnail/>` placeholders; preload via `getThumbnailUrl(id)` (D-17) [VERIFIED: api.ts:303] |
| SSE convergence | Browser / Client | API / Backend | Existing handler at `state/shot-grid.ts:160` is idempotent — optimistic local write + later SSE = no-op [VERIFIED: state/shot-grid.ts:160-171] |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REV-01 | Review panel overlay keyed on shotId with timeline + status-transition actions + notes; each action shows confirmation popover; panel keyed on shotId so SSE doesn't disrupt | `<ReviewPanel/>` + `<ReviewPanelHeader/>` + `<ReviewActionBar/>` + `<ReviewTimeline/>` + `<StatusChangePopover/>` (UI-SPEC §"Component Inventory"); signal-driven `activeOverlay = 'review'` + `activeReviewShotId`; existing `onShotStatusChanged` in state/shot-grid.ts:160 mutates `shotGrid.value.shots[idx]` idempotently — panel header reads `shotGrid.value.shots.find(s => s.id === activeReviewShotId)` so SSE updates propagate without remount |
| REV-02 | Quick-approve from card with inline popover + optimistic update + revert on error | `<QuickApproveButton/>` on `<ShotGridCard/>` (D-10/D-13); `<StatusChangePopover action='approve'>` anchored; optimistic write to `shotGrid.value.shots[idx].status = 'approved'` BEFORE `setShotStatus()` fetch; on non-2xx revert AND render `<WarningPill/>` (D-12). Existing `<WarningPill/>` primitive at `components/WarningPill.tsx` is reusable verbatim |
| REV-03 | A/B comparison loads any two user-selected versions; thumbnails preloaded in parallel; metadata diff | `<ABCompareView/>` + `compareSelection: Signal<{a, b}>` + `compareModalOpen`. Preload via `Promise.all([imgA.decode(), imgB.decode()])` on `Image()` objects sourced from `getThumbnailUrl(versionId)`. Metadata diff via new `GET /api/versions/:a/diff-with/:b` → `engine.diffVersions(a, b)` (already supports arbitrary pair) → `<MetadataDiff/>` render. Static side-by-side per REV-03 lock — no interactive wipe |
| REV-04 | Notes stored as null when blank; notes displayed in timeline with changed_by + created_at | `note.trim() === '' ? null : note.trim()` in popover submit (D-07). Engine already accepts `note?: string` (pipeline.ts:707) and the repo layer writes `null` for undefined (shot-status-repo.ts:85 `note: note ?? null`). Timeline row component renders `changed_by` + `formatRelativeTime(created_at)` + conditional note. ShotStatusEvent type at `src/store/shot-status-repo.ts:38` has `note: string \| null` — wire shape preserved |
| REV-05 | Restore Shot action only when status === 'omit'; writes system note "Restored from omit" | Conditional `<ReviewActionRestoreButton/>` in `<ReviewActionBar/>` (visibility-gated on `currentStatus === 'omit'`). `<StatusChangePopover action='restore'>` HIDES textarea (D-09). Submit sends `{to_status: 'wip', note: 'Restored from omit'}` (literal string `RESTORE_NOTE_SYSTEM_TEXT` from copy.ts per UI-SPEC L272). No special engine path — the existing setShotStatus accepts any 5 statuses as target |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Status pill click on `<ShotGridCard/>` opens review panel keyed on `shotId`. Two-affordance card: thumbnail = view (Phase 21 D-19 preserved → VersionDrawer for `latest_completed_version.id`), `<ShotStatusPill/>` = workflow (new review panel). Frame.io / ShotGrid convention.

**D-02:** Same right-rail slot as VersionDrawer (560px, mutually exclusive). New signal `activeOverlay: Signal<'review' | 'version' | null>` replaces selectedVersionId-based exclusivity. Single mount host `<OverlayHost/>`. Status-pill click swaps rail VersionDrawer→ReviewPanel; timeline version-row click swaps it back.

**D-03:** Panel layout top-to-bottom: header (shot name + ShotStatusPill + close) → sticky-top action bar (Approve / Request Retake / Hold / Omit, plus conditional Restore per REV-05) → scrollable unified timeline below.

**D-04:** History timeline is a unified, chronologically-interleaved feed of version events (created, completed) AND `shot_status_events` rows. Merged client-side. Sort: latest first. Each version row links to its version (swaps rail to VersionDrawer). Status rows render ShotStatusPill + changed_by + relative time + optional note.

**D-05:** Anchored popover for every confirmation (panel actions AND grid-card quick-approve). Reuses `<SortDropdown/>` popover mechanics — outside-click closes without committing, ESC closes, focus returns to trigger, `aria-haspopup="dialog"` + `aria-expanded`. Content: prompt sentence + notes textarea (~3 rows) + Cancel + Confirm buttons. Single shared `<StatusChangePopover/>`.

**D-06:** Notes input inside popover for every action — one mental model, one component. Notes scoped to the specific transition. No persistent panel-level notes field.

**D-07:** All notes optional. `note.trim() === '' ? null : note.trim()` (REV-04). No required-notes UX for any action.

**D-08:** Identical popover styling across all actions; prompt sentence is the only differentiator. "Approve this shot?" / "Request retake?" / "Hold this shot?" / "Omit this shot?" / "Restore this shot to wip?". No destructive-styled Confirm — Omit is reversible via Restore (REV-05).

**D-09:** Restore-action popover variant HIDES textarea. System-generated note `'Restored from omit'` (REV-05). Popover renders prompt + Cancel + Confirm only when `action === 'restore'`.

**D-10:** Hover-only Check-icon button absolutely positioned top-right of thumbnail area (`opacity: 0` → `opacity: 1` on `:hover` + `:focus-within`). 24×24px button with 4px padding around 16px lucide-preact Check icon. `aria-label="Quick approve {shotName}"`.

**D-11:** Quick-approve only — single Check icon, not a 4-action hover bank. REV-02 specifies Approve only.

**D-12:** Optimistic-update flow: immediate `shotGrid.value.shots[idx].status = 'approved'` mutation, then `PATCH /api/shots/:id/status`. On 2xx no-op (SSE arrives shortly with same value). On non-2xx revert signal AND render `<WarningPill/>` inside card with copy "Approve failed — retry". Pill dismisses on next successful action on same card OR after 5-second timeout.

**D-13:** ShotGridCard structural refactor: card root becomes `<div>` (NOT `<button>` — Phase 21 D-16 reversed). Three real `<button>` children: thumbnail-area button (opens VersionDrawer), `<ShotStatusPill/>` as button (opens review panel), hover Check-icon button (D-10). Omit-opacity-40 wrapper stays at outer card div.

**D-14:** Version selection via multi-select compare-mode in review panel timeline. Header "Compare versions…" button (visible only when ≥2 versions). Click enters compare-mode: version rows gain checkboxes; status rows excluded. User picks exactly 2 → "Compare" CTA enables → opens A/B view. ESC or "Cancel compare" exits. Selection state in `compareSelection: Signal<{a, b}>`.

**D-15:** A/B view renders as full-viewport modal with semi-transparent backdrop. Triggered from inside review panel; closes back to review panel (panel stays open in right-rail behind backdrop). Closes on backdrop click, ESC, explicit close button. `compareModalOpen: Signal<boolean>`.

**D-16:** Metadata diff data path: new server endpoint `GET /api/versions/:a/diff-with/:b` returning existing `DiffSummaryShape`. Engine reuses `diffVersion()` extended to accept arbitrary base. Display layer: extract metadata-rendering portion of `<DiffDrawer/>` into `<MetadataDiff/>`; both DiffDrawer (Phase 12) and ABCompareView consume it.

**D-17:** Thumbnail preload per REV-03: on mount of `<ABCompareView/>`, fire `Promise.all([imgA.decode(), imgB.decode()])` against `getOutputUrl(versionId, 'thumb.webp')` for both versions. Only render comparison once both resolve. During preload, render two `<SkeletonThumbnail/>` placeholders. `.decode()` over `.onload`. Fallback to `.onload` if `.decode()` rejects.

### Claude's Discretion

**D-18:** New signal file `packages/dashboard/src/state/review-panel.ts` houses: `activeReviewShotId`, `activeOverlay`, `compareSelection`, `compareModalOpen`, and (per UI-SPEC § "Component Inventory") possibly `actionInFlight` + `reviewHistory` cache. Phase 21 `onShotStatusChanged` STAYS in `state/shot-grid.ts` (mirrors Phase 21 per-view-domain convention; no relocation required since the handler is reference-stable via module export).

**D-19:** HTTP endpoint `PATCH /api/shots/:id/status` in `src/http/dashboard-routes.ts`. Body Zod: `{to_status: ShotStatus, note?: string | null, changed_by?: string}`. Thin Hono handler delegates to `engine.setShotStatus(shotId, to_status, changed_by ?? 'user', note ?? undefined)`. Reuses Phase 20's transaction discipline (engine internal). Response shape: `{status: ShotStatus, history: ShotStatusEvent[]}`. Errors: 400 invalid status, 404 unknown shot (TypedError SHOT_NOT_FOUND), 500 transaction failure.

**D-20:** SSE handler interaction with optimistic update: existing `onSseEvent('shot.status_changed', onShotStatusChanged)` registered in App.tsx (Phase 21 D-22) is idempotent. For optimistic quick-approve: local mutation precedes SSE; when SSE arrives with same value, handler is no-op. PATCH fails before SSE → local revert client-side only. Multi-tab convergence works automatically.

**D-21:** Tool count holds at 7/12. Phase 22 is dashboard-only; engine + MCP wires for `set_status`/`get_status`/`list_status_history` exist from Phase 20. New PATCH endpoint is HTTP-only, NOT registered via `server.registerTool()`. `tool-budget.test.ts` continues to assert `=== 7`.

**D-22:** Animation discipline: review panel mount/unmount NO animation. Popover mount/unmount NO animation. A/B modal backdrop fade ≤150ms with `prefers-reduced-motion: reduce` honored.

**D-23:** `<ABCompareView/>` renders inside new top-level mount point `<ABCompareHost/>` (sibling to `<OverlayHost/>` in App.tsx). Modal backdrop captures focus (focus-trap), `role="dialog"` + `aria-modal="true"`. ESC + backdrop-click close. Inside: header (shot name + "v{A} vs v{B}" + close) → side-by-side thumbnail strip → `<MetadataDiff/>`.

### Deferred Ideas (OUT OF SCOPE)

- Interactive wipe in A/B comparison (REV-03 lock — static side-by-side only)
- Bulk multi-card selection + batch approve
- Quick actions for Retake/Hold/Omit on grid card (Approve only per D-11)
- Touch/mobile equivalent of hover Approve icon (desktop-first)
- Per-shot review history beyond version + status events
- Email/Slack notifications on status change
- Persistent A/B compare-state across panel close
- Inline note editing in timeline (REV-04 append-only invariant)
- Compare across shots (scoped to two versions of THE SAME shot — D-14)
- Confirmation-popover destructive-action styling (D-08 lock — Omit is reversible)

## Project Constraints (from CLAUDE.md)

| Constraint | Phase 22 Verification |
|------------|-----------------------|
| **Tool cap: Maximum 12 MCP tools** | Phase 22 holds at 7/12 (D-21). New PATCH endpoint is HTTP-only — NOT registered via `server.registerTool()`. `src/__tests__/tool-budget.test.ts` assertion `=== 7` MUST remain green. [VERIFIED: tool-budget.test.ts asserts count via grep across src/tools/] |
| **Tool-engine separation** | New `PATCH /api/shots/:id/status` and `GET /api/versions/:a/diff-with/:b` are thin Zod-validated entry points delegating to existing engine methods. HTTP layer has zero MCP SDK imports (architecture-purity test enforces). |
| **Append-only provenance** | `shot_status_events` rows NEVER updated or deleted. Phase 20's grep test `UPDATE shot_status_events` must return zero. Phase 22 adds zero direct SQL paths; all writes flow through `engine.setShotStatus()` → `insertStatusEvent()` (shot-status-repo.ts:69). |
| **Prompt blob is truth** | N/A for Phase 22 — no generation paths touched. |
| **Async generation** | N/A for Phase 22 — no submit paths. |
| **SQLite WAL** | Inherited; no DB schema changes. |
| **Error responses must be human-readable** | New HTTP route surfaces `TypedError('SHOT_NOT_FOUND')` → 404 with actionable hint via existing `typedErrorHandler` middleware. Zod body validation surfaces as 400 `INVALID_INPUT` with structured `path` field per existing pattern (dashboard-routes.ts:159-166). |
| **Paginate all list queries** | `engine.listShotStatusHistory(shotId, limit)` accepts `limit` (default 20, max 50 per shot-tool Zod schema). New status-history HTTP route inherits same default. |
| **Never return raw JSON dumps** | PATCH response is structured `{status, history}`; engine TypedErrors get human-readable `hint` field. |

## Standard Stack

### Core (existing — Phase 22 adds zero new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `preact` | ^10.29.1 | View library | Project-wide UI framework [VERIFIED: packages/dashboard/package.json] |
| `@preact/signals` | ^2.9.0 | Reactive state primitives | All Phase 22 signals (`activeOverlay`, `compareSelection`, etc.) live in `state/review-panel.ts` per Phase 21 convention [VERIFIED: packages/dashboard/package.json] |
| `@modelcontextprotocol/sdk` | (server-only) | MCP tool registration | Not used by Phase 22 (D-21 — zero new tools) [CITED: 22-CONTEXT.md D-21] |
| `hono` | (server-only) | HTTP routing | Phase 22 adds 2 routes in `src/http/dashboard-routes.ts` [VERIFIED: dashboard-routes.ts:23] |
| `better-sqlite3` + `drizzle-orm` | (server-only) | DB layer | Engine handles all SQL; Phase 22 makes no direct DB calls |
| `zod` | (latest) | Schema validation | Body schema for `PATCH /api/shots/:id/status`: `{to_status: ShotStatusEnum, note?, changed_by?}` — mirrors `shot.set_status` tool arm (shot-tool.ts:51) |
| `vitest` | ^4.1.5 | Test runner | All Phase 22 tests via `@testing-library/preact` per existing pattern [VERIFIED: dashboard package.json] |
| `@testing-library/preact` | ^3.2.4 | Component tests | `render` + `fireEvent.click` / `fireEvent.keyDown({ key: 'Escape' })` per SortDropdown test patterns [VERIFIED: SortDropdown.test.tsx] |
| `lucide-preact` | ^1.9.0 | Icon library | New icons consumed: `Check` (QuickApprove), `X` (modal close), `GitCompare` (compare entry), `ArrowLeft` (optional modal back). All already shipped — no install [VERIFIED: package.json] |

### Supporting (Preact APIs)

| API | Purpose | When to Use |
|-----|---------|-------------|
| `useRef<HTMLElement>` | Anchor references for popover positioning + focus return | `<StatusChangePopover/>` anchor ref (mirrors SortDropdown.tsx:120 `triggerRef = useRef<HTMLButtonElement>()`) |
| `useEffect` + `document.addEventListener('mousedown')` | Outside-click close (only while open; cleanup unregisters) | SortDropdown.tsx:158-171 pattern verbatim |
| `useState` + `useId` | Local popover open state + unique IDs for `aria-controls` | Match SortDropdown.tsx:118-123 |
| `Promise.all([imgA.decode(), imgB.decode()])` | Parallel thumbnail preload | A/B view mount; `.decode()` is paint-ready (no flash); fallback to `.onload` per D-17 |
| `setTimeout` | 5s auto-dismiss for failed quick-approve WarningPill | D-12; track timer-id in `useEffect` cleanup to cancel on unmount or next success |

### Installation

Zero `npm install` calls. All required dependencies are shipped via Phase 21.

**Version verification:** No new packages — verified `lucide-preact@1.9.0` already lists `Check`, `X`, `GitCompare`, `ArrowLeft` icons in its index (standard lucide icon set since v1.0).

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────────────┐
                          │  Dashboard (Preact + Signals)              │
                          │  packages/dashboard/                       │
                          └─────────────────────────────────────────────┘
                                          │
        ┌─────────────────────────────────┼───────────────────────────────┐
        │                                 │                                │
        ▼                                 ▼                                ▼
  ┌──────────┐                  ┌─────────────────┐               ┌─────────────────┐
  │ ShotGrid │ status pill ──→  │ activeOverlay   │ ←── ESC/X ──→ │ OverlayHost     │
  │ Card     │ click            │ Signal          │               │ (renders panel  │
  │ (refac.) │ ──── thumb ───→  │ 'review'|       │               │  OR drawer)     │
  │ ┌──────┐ │                  │ 'version'|null  │               └─────────────────┘
  │ │ [✓]  │ │                  └─────────────────┘                       │
  │ └──────┘ │                          │                                 │
  └─────┬────┘                          │                          ┌──────┴──────┐
        │ quick-approve click           │                          │             │
        ▼                               ▼                          ▼             ▼
  ┌──────────────────┐         ┌──────────────────┐         ┌──────────┐   ┌──────────┐
  │ StatusChange     │ ←─────── │ ReviewPanel     │          │ Version  │   │ Review   │
  │ Popover (anchor) │         │ ┌──────────────┐ │          │ Drawer   │   │ Panel    │
  │ - prompt         │         │ │ Action Bar   │ │          │ (Ph 5/12)│   │ (new)    │
  │ - <textarea>     │ click   │ │ [Approve]    │ │          └──────────┘   └──────────┘
  │ - [Cancel]       │ ────────│ │ [Retake]…    │ │
  │ - [Confirm]      │         │ └──────────────┘ │
  └──────────────────┘         │ ┌──────────────┐ │
        │ Confirm              │ │ Timeline     │ │   click "Compare versions…"
        ▼                       │ │ (versions +  │ │              │
  ┌──────────────────┐         │ │  status      │ │              ▼
  │ optimistic       │         │ │  events)     │ │     ┌──────────────────┐
  │ shotGrid.value   │         │ │              │ │     │ compareMode +    │
  │ .shots[i].status │         │ │ + checkboxes │ │     │ compareSelection │
  │ = 'approved'     │         │ │   (compare-  │ │     │ {a, b}           │
  └──────────────────┘         │ │    mode)     │ │     └──────────────────┘
        │                       │ └──────────────┘ │              │
        ▼                       └──────────────────┘     pick 2 → click [Compare]
  ┌──────────────────┐                                            │
  │ api.setShotStatus│                                            ▼
  │ → PATCH          │                                  ┌──────────────────┐
  │ /api/shots/:id/  │ ───┐                            │ ABCompareHost +  │
  │ status           │    │                            │ ABCompareView    │
  └──────────────────┘    │                            │ (modal overlay)  │
        │ 2xx              │                            │  ┌────┐ ┌────┐  │
        ▼                 │                            │  │ vA │ │ vB │  │
  ┌──────────────────┐    │                            │  │preload│preload│
  │ Server emits     │    │                            │  └────┘ └────┘  │
  │ shot.status_     │ ◀──┘                            │ <MetadataDiff/> │
  │ changed SSE      │                                  └──────────────────┘
  └──────────────────┘                                          │
        │                                                       │
        ▼                                            ┌──────────────────────┐
  ┌──────────────────┐                                │ GET /api/versions/   │
  │ onShotStatus     │                                │ :a/diff-with/:b      │
  │ Changed handler  │                                └──────────────────────┘
  │ (state/shot-grid)│ ◀─── idempotent ───→                    │
  │ shots[i].status  │     re-write same value                 ▼
  │ = payload.to     │     (no-op for optimistic)    ┌──────────────────────┐
  └──────────────────┘                                │ engine.diffVersions   │
                                                      │ (already arbitrary)   │
                                                      └──────────────────────┘
```

**Data flow tracing — quick-approve:**
1. User hovers ShotGridCard → CSS-only `opacity-0 → opacity-100` on `<QuickApproveButton/>`
2. Click → `<StatusChangePopover action='approve'>` opens anchored
3. Confirm → optimistic mutation of `shotGrid.value.shots[idx].status = 'approved'`
4. `api.setShotStatus(shotId, {to_status: 'approved', note: null, changed_by: 'user'})` → `PATCH /api/shots/:id/status`
5. Server: Hono handler unpacks body → `engine.setShotStatus(shotId, 'approved', 'user', undefined)` → repo: `db.transaction(() => { INSERT shot_status_events; UPDATE shots SET status; })` → `engine.events.emitEvent('shot.status_changed', {...})`
6. SSE adapter (`src/http/sse.ts:135-148`) maps to dashboard camelCase payload → wire
7. Dashboard `onShotStatusChanged` handler in `state/shot-grid.ts:160` sets `shots[idx].status = 'approved'` (idempotent no-op since already correct)
8. On failure (step 5/6): client catch → revert `shots[idx].status = priorStatus` → set `quickApproveError = shotId` → render `<WarningPill/>` → 5s `setTimeout` clears it

**Data flow tracing — A/B compare:**
1. Review panel timeline → click "Compare versions…" → `compareMode = true` (local panel state)
2. Click two checkboxes → `compareSelection.value = {a: vA.id, b: vB.id}`
3. Click "Compare" CTA → `compareModalOpen.value = true`
4. `<ABCompareHost/>` mounts `<ABCompareView/>` → preload: `Promise.all([new Image().decode() for {a, b}])` using `getThumbnailUrl(id)`
5. In parallel: `api.diffVersions(a, b)` → `GET /api/versions/:a/diff-with/:b` → `engine.diffVersions(a, b)` (existing async facade)
6. Preload resolves → render `<Thumbnail/>` pair side-by-side; diff resolves → render `<MetadataDiff summary changes/>`
7. ESC / backdrop click / close button → `compareModalOpen.value = false`; review panel stays open behind

### Recommended Project Structure

```
packages/dashboard/src/
├── views/
│   ├── OverlayHost.tsx                       # NEW — reads activeOverlay; renders ReviewPanel OR VersionDrawer
│   ├── VersionDrawerHost.tsx                 # MERGED — re-exports from OverlayHost for backward compat (per UI-SPEC L390)
│   ├── ReviewPanel.tsx                       # NEW — composes header + action bar + timeline
│   ├── ABCompareHost.tsx                     # NEW — mounts ABCompareView when compareModalOpen
│   └── ABCompareView.tsx                     # NEW — full-viewport modal
├── components/
│   ├── ReviewPanelHeader.tsx                 # NEW — shot name + ShotStatusPill + close X
│   ├── ReviewActionBar.tsx                   # NEW — sticky 4(+1) action row
│   ├── ReviewActionButton.tsx                # NEW — reusable action-bar button w/ popover trigger
│   ├── ReviewTimeline.tsx                    # NEW — chronologically-interleaved feed
│   ├── StatusChangePopover.tsx               # NEW — shared anchored popover
│   ├── MetadataDiff.tsx                      # NEW — extracted from DiffDrawer; renders summary + changes
│   ├── QuickApproveButton.tsx                # NEW — hover Check icon
│   ├── ShotGridCard.tsx                      # MODIFIED — root div + 3 sibling buttons (D-13 refactor)
│   └── ShotStatusPill.tsx                    # MODIFIED — onClick prop promotes to <button>
├── state/
│   └── review-panel.ts                       # NEW — activeOverlay, activeReviewShotId, compareSelection, compareModalOpen, actionInFlight
├── lib/
│   ├── api.ts                                # MODIFIED — adds setShotStatus, fetchShotStatusHistory, diffVersionsAB
│   └── copy.ts                               # MODIFIED — appends ~50 REVIEW_*, POPOVER_*, COMPARE_* constants per UI-SPEC §"Copywriting Contract"
├── types/
│   └── review-panel.ts                       # NEW — ShotStatusEvent, ShotHistoryEntry, ReviewAction, SetShotStatusBody
└── views/DiffDrawer.tsx                      # MODIFIED — consumes <MetadataDiff/> instead of inline summary section

src/
├── http/
│   └── dashboard-routes.ts                   # MODIFIED — adds PATCH /api/shots/:id/status + GET /api/shots/:id/status-history + GET /api/versions/:a/diff-with/:b
└── (no engine, repo, or schema changes)
```

### Pattern 1: Engine-Facade Delegation for HTTP Mutations (D-19)

**What:** A new HTTP route that mutates state delegates to the same engine method the MCP tool uses — they are PARALLEL thin entry points to ONE engine path.

**When to use:** Any phase that needs an HTTP equivalent of an existing MCP tool action without forking business logic.

**Example:**
```typescript
// Source: project pattern at src/http/dashboard-routes.ts (Phase 5 dashboard router)
// + src/tools/shot-tool.ts:140 (set_status arm — Phase 20)

// Phase 22 D-19 — PATCH /api/shots/:id/status
app.patch('/api/shots/:id/status', async (c) => {
  const shotId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const SetStatusBody = z.object({
    to_status: z.enum(SHOT_STATUSES),       // reuses existing const from src/types/hierarchy.ts
    note: z.string().max(500).nullable().optional(),
    changed_by: z.string().max(100).optional(),
  });

  const parsed = SetStatusBody.safeParse(body);
  if (!parsed.success) {
    throw new TypedError(
      'INVALID_INPUT',
      `Invalid status transition body: ${parsed.error.issues[0].path.join('.')}`,
      `Expected { to_status: ShotStatus, note?: string|null, changed_by?: string }`,
    );
  }

  // Delegate to same engine method as MCP set_status arm (shot-tool.ts:140-152).
  // engine.setShotStatus throws TypedError('SHOT_NOT_FOUND') → 404 via typedErrorHandler.
  const result = engine.setShotStatus(
    shotId,
    parsed.data.to_status,
    parsed.data.changed_by ?? 'user',
    parsed.data.note ?? undefined,  // engine accepts undefined (not null); repo writes null
  );

  // D-19 response shape: { status, history } — echoes shape of get_status arm
  const history = engine.listShotStatusHistory(shotId, 50).history;
  return c.json({ status: result.newStatus, history });
});
```

> **Engine signature note:** `engine.setShotStatus(shotId, toStatus, changedBy, note?)` takes POSITIONAL args per `pipeline.ts:703`. The HTTP handler MUST unpack the body object into positional args; do NOT pass `parsed.data` as a struct. The engine internally maps `note?: string` to `note ?? null` at the repo layer via `note: note ?? null` (shot-status-repo.ts:85).

### Pattern 2: Anchored Confirmation Popover (D-05)

**What:** A floating popover that is positioned relative to its anchor button, closes on outside-click + ESC, and returns focus to the anchor on close.

**When to use:** Any user action that requires explicit confirmation but should not jump the user to a different surface.

**Example:**
```typescript
// Source: SortDropdown.tsx:144-171 (Phase 18 — verified pattern)
// + WAI-ARIA APG non-modal dialog adaptations

export function StatusChangePopover({
  action,
  anchorRef,
  isOpen,
  onConfirm,
  onCancel,
}: Props) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const promptId = useId();

  // Auto-focus textarea on open (or cancel button if action === 'restore')
  useEffect(() => {
    if (!isOpen) return;
    if (action === 'restore') {
      // No textarea — focus first interactive (Cancel button)
      popoverRef.current?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    } else {
      textareaRef.current?.focus();
    }
  }, [isOpen, action]);

  // Outside-click — only attached while open; mousedown (not click) so close
  // happens BEFORE focusin from new target. Mirrors SortDropdown.tsx:158-171.
  useEffect(() => {
    if (!isOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (
        !popoverRef.current?.contains(t) &&
        !anchorRef.current?.contains(t)
      ) {
        anchorRef.current?.focus();  // return focus to trigger
        onCancel();
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [isOpen, anchorRef, onCancel]);

  function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      anchorRef.current?.focus();
      onCancel();
    }
  }

  if (!isOpen) return null;

  async function handleConfirm() {
    setPending(true);
    const finalNote = action === 'restore'
      ? RESTORE_NOTE_SYSTEM_TEXT  // D-09: system-generated literal
      : (note.trim() === '' ? null : note.trim());  // D-07: REV-04 null-when-blank
    try {
      await onConfirm(finalNote);
      // Parent closes popover on success
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="false"          // non-modal dialog — outside-click cancels
      aria-labelledby={promptId}
      onKeyDown={onKeyDown}
      class="..."                  /* anchored positioning + shadow-lg per UI-SPEC */
    >
      <p id={promptId}>{PROMPT_FOR[action]}</p>
      {action !== 'restore' && (
        <textarea
          ref={textareaRef}
          value={note}
          onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          rows={3}
          placeholder={POPOVER_NOTE_PLACEHOLDER}
        />
      )}
      <div class="...buttons">
        <button data-cancel type="button" onClick={onCancel} disabled={pending}>
          {POPOVER_CANCEL_LABEL}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? POPOVER_CONFIRM_PENDING : POPOVER_CONFIRM_LABEL}
        </button>
      </div>
    </div>
  );
}
```

> **WAI-ARIA pattern selection:** Use `role="dialog"` + `aria-modal="false"` — the SortDropdown precedent uses `role="listbox"` because it's a select-only combobox; for a popover with arbitrary content (textarea + buttons), the dialog role is correct, and non-modal because the outside-click-cancel behavior is incompatible with modal semantics. (UI-SPEC §"Component Inventory" L376 confirms this choice.)

> **Focus return:** `anchorRef.current?.focus()` MUST fire BEFORE `onCancel()` triggers the parent's `isOpen=false` flip. This prevents focus from falling to `<body>` when the popover unmounts.

### Pattern 3: Optimistic Mutation + SSE Convergence (D-12, D-20)

**What:** Client mutates local state IMMEDIATELY on user confirmation; the network call follows; SSE arrives later with the same value and is a no-op; on network failure the client reverts.

**When to use:** Any UI action where instant feedback matters and the server-confirmed state will arrive shortly via SSE.

**Example:**
```typescript
// Source: D-12 + state/shot-grid.ts:160-171 (existing idempotent SSE handler)

async function handleQuickApprove(shotId: string, priorStatus: ShotStatus) {
  // 1. Optimistic mutation FIRST
  const current = shotGrid.value;
  if (!current) return;
  const idx = current.shots.findIndex((s) => s.id === shotId);
  if (idx < 0) return;

  shotGrid.value = {
    ...current,
    shots: current.shots.map((s, i) =>
      i === idx ? { ...s, status: 'approved' } : s
    ),
  };
  quickApproveError.value = null;  // clear any prior error pill

  // 2. PATCH
  try {
    await setShotStatus(shotId, { to_status: 'approved', note: null, changed_by: 'user' });
    // 3a. Success: no-op. SSE will arrive shortly with same value (idempotent handler).
  } catch (err) {
    // 3b. Revert. Local-only — no SSE will fire for the rollback.
    shotGrid.value = {
      ...shotGrid.value!,
      shots: shotGrid.value!.shots.map((s, i) =>
        i === idx ? { ...s, status: priorStatus } : s
      ),
    };
    quickApproveError.value = shotId;
    // Auto-dismiss after 5s
    setTimeout(() => {
      if (quickApproveError.value === shotId) quickApproveError.value = null;
    }, 5000);
  }
}
```

> **SSE handler is already correct:** `onShotStatusChanged` at `state/shot-grid.ts:160-171` does `shots.map(s => s.id === payload.shotId ? { ...s, status: payload.toStatus } : s)` — when `payload.toStatus === 'approved'` and the local state ALREADY says `status === 'approved'`, the new object identity is created but the value is unchanged. Preact rerenders the row but visually nothing flickers. Multi-tab: another tab's approval emits the same SSE; all tabs converge.

### Pattern 4: Mutually-Exclusive Overlay Slotting via Signal Discriminator (D-02)

**What:** A single signal `activeOverlay: 'review' | 'version' | null` is the source of truth for which right-rail overlay (if any) is visible. The mount host reads the discriminator and renders the appropriate component.

**When to use:** When multiple right-rail-style overlays exist and must NEVER co-occupy the rail.

**Example:**
```typescript
// Source: New per D-02; generalizes VersionDrawerHost.tsx (Phase 21 Plan 21-06)

export function OverlayHost() {
  const overlay = activeOverlay.value;

  if (overlay === null) {
    // Backward compat shim per UI-SPEC L369: if a legacy code path wrote to
    // selectedVersionId directly without flipping activeOverlay, fall back to
    // the version drawer. Phase 22 migrates all writers to use the helper.
    if (selectedVersionId.value !== null) {
      return <VersionDrawerHostInternal />;
    }
    return null;
  }

  if (overlay === 'review') {
    const shotId = activeReviewShotId.value;
    if (shotId === null) {
      console.warn('OverlayHost: activeOverlay=review but activeReviewShotId is null');
      return null;
    }
    return <ReviewPanelHost shotId={shotId} />;
  }

  if (overlay === 'version') {
    if (selectedVersionId.value === null) {
      console.warn('OverlayHost: activeOverlay=version but selectedVersionId is null');
      return null;
    }
    return <VersionDrawerHostInternal />;
  }

  return null;
}

// Helper for callers — keeps mutex invariant in one place
export function openVersionDrawer(versionId: string) {
  selectedVersionId.value = versionId;
  activeOverlay.value = 'version';
  activeReviewShotId.value = null;
}

export function openReviewPanel(shotId: string) {
  activeReviewShotId.value = shotId;
  activeOverlay.value = 'review';
  // Do NOT clear selectedVersionId — when user clicks a version row inside
  // review panel timeline, openVersionDrawer() swaps and the previous review
  // state can be restored via "back to review" (D-04 contract).
}

export function closeOverlay() {
  activeOverlay.value = null;
  selectedVersionId.value = null;
  activeReviewShotId.value = null;
}
```

### Pattern 5: Image Preload with `.decode()` + Fallback (D-17, REV-03)

**What:** Use `HTMLImageElement.decode()` to wait for paint-ready image data — eliminates the brief flash when the `<img>` element renders before decode completes.

**When to use:** Any UI surface where two or more images must appear simultaneously (parallel side-by-side comparison).

**Example:**
```typescript
// Source: D-17 + getThumbnailUrl(versionId) at api.ts:303

function preloadBoth(versionAId: string, versionBId: string): Promise<void> {
  const urlA = getThumbnailUrl(versionAId);
  const urlB = getThumbnailUrl(versionBId);

  function preloadOne(url: string): Promise<void> {
    const img = new Image();
    img.src = url;
    // .decode() is paint-ready resolution; falls back to .onload for older
    // browsers (Safari < 15 in some edge cases per MDN).
    return img.decode().catch(() => new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
    }));
  }

  return Promise.all([preloadOne(urlA), preloadOne(urlB)]).then(() => undefined);
}

// Inside <ABCompareView/>:
useEffect(() => {
  let alive = true;
  setPreloadState('loading');
  preloadBoth(versionAId, versionBId)
    .then(() => { if (alive) setPreloadState('ready'); })
    .catch(() => { if (alive) setPreloadState('error'); });
  return () => { alive = false; };
}, [versionAId, versionBId]);
```

> **Why `getThumbnailUrl` not `getOutputUrl`:** Thumbnails are cached server-side at ≤640×360 WebP (Phase 17) — fast decode, immutable URL, no CLS. Full output images can be 2-4MB PNGs that take seconds; D-17's parallel preload depends on the thumbnail variant. CONTEXT.md L39 says `'thumb.webp'` filename — the existing `getThumbnailUrl(versionId)` resolves the route which derives the thumbnail filename server-side; no need to pass `'thumb.webp'` explicitly. (UI-SPEC §"Reused (no change)" L401 confirms `<Thumbnail/>` is the consumer.)

### Anti-Patterns to Avoid

- **Double-nested buttons:** The Phase 22 D-13 refactor turns `<ShotGridCard/>` from `<button>` to `<div>` with THREE sibling buttons. NEVER nest `<button>` inside `<button>` — it's invalid HTML and breaks keyboard a11y. The current Phase 21 code at `components/ShotGridCard.tsx:65-110` is a single `<button>` wrapping everything — every interactive child stays inside that one `<button>`. Phase 22 reverses this completely.

- **Persistent panel notes:** D-06 forbids a panel-level notes field separate from the popover. Doing so creates the "wrote note → clicked wrong action" failure mode. Notes ALWAYS live inside the popover that's about to commit the transition.

- **Forking engine for HTTP path:** D-19 forbids forking `setShotStatus`. The new PATCH route MUST delegate to the same engine function the MCP tool uses. Forking would split transaction discipline (Phase 20 STAT-02 lock).

- **Fade animation on panel/popover:** D-22 forbids mount/unmount animations on review panel and popover. Only the A/B modal backdrop has a single ≤150ms fade. Adding `transition: opacity` to popover mount violates the restraint principle.

- **`aria-pressed` on action buttons:** Action buttons are COMMAND buttons (open a popover) — NOT toggle buttons. `aria-pressed` is wrong; use `aria-haspopup="dialog"` + `aria-expanded={popoverIsOpen}`. (UI-SPEC L717 confirms.)

- **Hidden Restore (disabled state):** REV-05 + UI-SPEC L566-567 lock visibility-gated rendering. Do NOT render Restore as a disabled button for non-omit shots — render NOTHING. Visibility-gated rendering matches the data model (Restore is meaningful only from `omit` state).

- **Sync .decode():** `img.decode()` returns a Promise. Awaiting it inside `useEffect` synchronously blocks the cleanup return. Always wrap in a `let alive = true` + cleanup pattern (D-17 example above).

- **Reading parent_version_id for diff:** The engine's `diffVersions(a, b)` does NOT walk `parent_version_id` — it takes both IDs explicitly. D-16's "extend to accept arbitrary base" is based on a misread of the engine; no change is needed. (See Open Question Q2 below for verification.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Popover positioning + outside-click | Custom floating-positioner library | Reuse `<SortDropdown/>` mechanics (useRef + document mousedown) | Already battle-tested with 18 tests in SortDropdown.test.tsx; no z-index conflicts; no dependency on `@floating-ui` |
| Image preload | Manual `<link rel="prefetch">` injection | `new Image().decode()` | `.decode()` is paint-ready (no flash); native; no extension to HTMLImage required |
| Focus trap (A/B modal) | Custom tab-cycle handler | Existing browser focus behavior + single-tab-stop modal | UI-SPEC L476-479: the A/B modal currently has ONE focusable element (close button), so tab naturally cycles to it; full focus-trap library is overkill for this surface |
| Engine setShotStatus path | New mutation path in HTTP layer | Delegate to `engine.setShotStatus()` | D-19 lock: HTTP route is parallel thin entry, not a forked path. Transaction discipline lives in the engine; bypassing it would break STAT-02 |
| Diff data fetching | Walk parent_version_id manually | `engine.diffVersions(a, b)` | Existing facade ALREADY supports arbitrary pair (pipeline.ts:1062). Pure diff at engine/diff.ts:172 asserts same shot_id and that's it |
| MetadataDiff rendering | Build new diff renderer from scratch | Extract from `<DiffDrawer/>` + extend to render `changes[]` | DiffDrawer currently renders only `summary` (one line). Extract the summary block AND add structured `changes` rendering — both consumers (DiffDrawer + ABCompareView) get the richer view for free |
| Timeline merge logic | Three separate fetch effects + merge in render | One client-side merger: `mergeHistory(versions, statusEvents)` returning `ShotHistoryEntry[]` sorted desc | Pure function; easy to unit-test; produces immutable feed |
| SSE handler relocation | Move `onShotStatusChanged` to `state/review-panel.ts` | KEEP at `state/shot-grid.ts:160` (already idempotent) | D-20 says "may relocate" but UI-SPEC L380 corrects: handler stays. Reference-stable via module export — App.tsx's on/offSseEvent pair already works |
| New design tokens | Add Phase-22-specific CSS vars | Reuse Phase 17/18/21 tokens (UI-SPEC §"Color" L107) | UI-SPEC explicitly enforces zero new tokens. `--drawer-version-width: 560px` already exists for the 560px review panel. Status colors, accent, surfaces all reused |
| New MCP tool registration | Add `server.registerTool()` for status | The Phase 20 `shot` tool's `set_status` arm IS the MCP path | D-21 lock: tool count holds at 7. The HTTP endpoint is dual-entry; both MCP and HTTP go through the engine |

**Key insight:** Phase 22 is the textbook case of "compose, don't extend." Every backend hook exists; every UI primitive exists; the work is pure composition + one structural refactor of `<ShotGridCard/>`. Avoid the temptation to "improve" the engine while you're here.

## Runtime State Inventory

> Phase 22 introduces no rename, refactor of identifiers, or migration. SKIPPED.

## Common Pitfalls

### Pitfall 1: Engine signature confusion — positional vs. body
**What goes wrong:** Plan writes `engine.setShotStatus({shotId, toStatus, note, changedBy})` instead of `engine.setShotStatus(shotId, toStatus, changedBy, note?)`.
**Why it happens:** The HTTP body IS an object — easy to assume the engine takes the same shape.
**How to avoid:** Read `src/engine/pipeline.ts:703-714` before writing the HTTP handler. Engine takes 4 positional args: `(shotId, toStatus, changedBy, note?)`. The handler must destructure and unpack.
**Warning signs:** TypeScript error "Argument of type '{ ... }' is not assignable to parameter of type 'string'". If you see this, you passed an object instead of positional args.

### Pitfall 2: Diff facade arbitrary-pair assumption mismatch
**What goes wrong:** Plan extends `engine.diffVersions()` to add a `baseVersionId` param, breaking existing callers.
**Why it happens:** D-16 says "extend `diffVersion()` to accept an arbitrary base" — implies the existing function takes one ID + walks parent. It does NOT. The existing facade ALREADY takes `(versionAId, versionBId)`. The MCP `version.diff` arm passes both explicitly (`version-tool.ts:556`).
**How to avoid:** Read `src/engine/pipeline.ts:1062-1090` and `src/engine/diff.ts:172` BEFORE making any engine signature change. The plan should specify "GET /api/versions/:a/diff-with/:b is a new ROUTE; engine is unchanged."
**Warning signs:** PR introduces a new `baseVersionId` param to `diffVersions()` or `pureDiffVersions()`. STOP — that's the bug.

### Pitfall 3: SSE handler reference instability breaks off-subscription
**What goes wrong:** Plan moves `onShotStatusChanged` body inline to App.tsx useEffect, breaks `offSseEvent` because the on/off pair receive different function references.
**Why it happens:** Inlining the handler creates a new function on every render; the cleanup function's `offSseEvent('shot.status_changed', inlineFn)` sees a DIFFERENT reference than what was registered.
**How to avoid:** Keep `onShotStatusChanged` as a module-level export from `state/shot-grid.ts:160` (already correct). App.tsx imports it and passes the same reference to both on/off. Phase 21 D-22 already locked this.
**Warning signs:** SSE handlers fire multiple times per event (off didn't remove the prior subscription) OR SSE never fires on second mount (off cleared it but the new on used a stale function).

### Pitfall 4: ShotGridCard nested buttons
**What goes wrong:** D-13 refactor leaves `<ShotStatusPill/>` inside the card's outer `<button>` — invalid HTML.
**Why it happens:** Phase 21 D-16 made the entire card a `<button>` with all content inside. Phase 22 reverses this. If the refactor only updates the outer element from `button` to `div` without restructuring children, the existing structure has a `<button>` (was outer card) containing children that now need to be `<button>`s themselves — but if you just "promote" `ShotStatusPill` to a button while leaving the outer as a button too, you get nested.
**How to avoid:** Plan must specify: (1) outer `<div class="group">`, (2) THREE siblings — thumbnail-area button, ShotStatusPill button, hover Check button — NOT nested. UI-SPEC L387 makes this explicit.
**Warning signs:** Browser dev-tools shows `<button><button>...</button></button>` OR React/Preact dev mode hydration mismatch warning OR keyboard tab order skips the inner button.

### Pitfall 5: WarningPill autodismiss leaks timeout
**What goes wrong:** Quick-approve fails → 5s `setTimeout` fires → component unmounted → timeout still references stale signal → uncaught error or stale state mutation.
**Why it happens:** `setTimeout` is not cancelled on unmount or on the next successful action.
**How to avoid:** Track the timer id in `useEffect` and cleanup; OR use a guard: `if (quickApproveError.value === shotId) quickApproveError.value = null;` so the timeout is a no-op if the value changed.
**Warning signs:** Test failures with "Cannot read property of undefined" after a fast-forward delay, or React warning about setState on unmounted component (Preact equivalent).

### Pitfall 6: A/B modal opens with stale compareSelection
**What goes wrong:** User entered compare-mode, selected v1+v2, opened modal, closed it, reopened — sees stale v1+v2 selection from prior shot.
**Why it happens:** `compareSelection` is signal-global; clearing it on modal close is one approach, but per UI-SPEC L526 "user can re-open or cancel-compare". Need to clear when switching SHOTS, not when closing modal.
**How to avoid:** Reset `compareSelection.value = {a: null, b: null}` when `activeReviewShotId` changes (via `useEffect` on review-panel mount), not in modal lifecycle.
**Warning signs:** Modal shows comparison for a shot the user is no longer reviewing, or the compare-mode persists into a different shot's panel.

### Pitfall 7: Image.decode() rejection causes infinite skeleton
**What goes wrong:** Thumbnail URL 404s; `.decode()` rejects; fallback `.onload` never fires; skeleton stays forever.
**Why it happens:** When the network 404s, `.onload` is NOT triggered — `.onerror` fires instead. The fallback in Pattern 5 only listens to `.onload`.
**How to avoid:** Fallback Promise must wire BOTH `onload` AND `onerror` (resolve on load, reject on error). Then a `.catch` in the parent useEffect surfaces the error state and renders `COMPARE_MODAL_THUMB_LOAD_FAIL` copy.
**Warning signs:** Skeleton thumbnails never resolve; no error copy shown.

### Pitfall 8: Optimistic mutation overwrites concurrent SSE
**What goes wrong:** User A quick-approves; user B (different tab) holds the same shot at almost the same moment. User A's local says `approved`; B's SSE arrives saying `on-hold`. The local-vs-SSE flow needs to converge to `on-hold` (most recent server state wins).
**Why it happens:** The optimistic mutation runs locally without server sequencing. The SSE handler IS idempotent set-to-broadcasted-value — but if the broadcast arrives BEFORE the PATCH that triggered it (network reorder), the optimistic value temporarily "wins" until the next SSE arrives.
**How to avoid:** Per D-20: optimistic + SSE-confirm is idempotent because the SSE handler always converges to broadcasted value. The user-A optimistic write WILL be overwritten by user-B's broadcast (correctly — last-writer-wins). No special coordination needed; the engine is the serializer.
**Warning signs:** Test that asserts "optimistic mutation persists after SSE arrives" — that test is wrong; SSE always wins.

### Pitfall 9: Popover textarea Enter submits form
**What goes wrong:** User types note, hits Enter to insert a newline, popover commits instead.
**Why it happens:** Default form behavior — Enter on textarea inserts newline, but if the textarea is inside a `<form>` with a submit button, Enter on the textarea may submit the form.
**How to avoid:** Don't wrap popover in a `<form>`. Use buttons with `type="button"` and explicit `onClick`. UI-SPEC L441 specifies Enter inserts newline, does NOT submit.
**Warning signs:** Browser submits the entire page on Enter inside textarea, or popover commits on every Enter keystroke.

### Pitfall 10: `lib/copy.ts` constant count assertion breaks
**What goes wrong:** Phase 22 adds ~50 copy constants. If the test asserts `>= 46` (Phase 21 floor), it passes. If a test asserts an EXACT count, it fails.
**Why it happens:** Phase 21 STATE.md says "Copy.ts exports: 51 (≥ 46 required)" — this is a floor, not an equality.
**How to avoid:** Add new exports freely; ensure `≥ 46` floor (or new floor specified by Phase 22 plan) is the assertion shape. NEVER use `===` on copy export count.
**Warning signs:** Test fails with "expected 46, got 96" — that's an equality test you need to update.

## Code Examples

### Example 1: HTTP route — PATCH /api/shots/:id/status

```typescript
// Source: project pattern at src/http/dashboard-routes.ts (mirror /api/sequences/:id/shot-grid Phase 21 shape)
// + engine signature at src/engine/pipeline.ts:703

import { SHOT_STATUSES } from '../types/hierarchy.js';

// Inside createDashboardRouter (after the shot-grid route ~ line 340):
const SetShotStatusBody = z.object({
  to_status: z.enum(SHOT_STATUSES),
  note: z.string().max(500).nullable().optional(),
  changed_by: z.string().max(100).optional(),
});

app.patch('/api/shots/:id/status', async (c) => {
  const shotId = c.req.param('id');
  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = SetShotStatusBody.safeParse(rawBody);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new TypedError(
      'INVALID_INPUT',
      `Invalid PATCH body at '${first.path.join('.')}'`,
      `Expected { to_status: <one of: ${SHOT_STATUSES.join(', ')}>, note?: string|null, changed_by?: string }`,
    );
  }

  // engine.setShotStatus throws TypedError('SHOT_NOT_FOUND') for unknown shotId,
  // surfaced as 404 by the global typedErrorHandler.
  const result = engine.setShotStatus(
    shotId,
    parsed.data.to_status,
    parsed.data.changed_by ?? 'user',
    parsed.data.note === null ? undefined : parsed.data.note,
  );

  // Echo current status + recent history for the dashboard to refresh its timeline.
  const { history } = engine.listShotStatusHistory(shotId, 50);
  return c.json({
    status: result.newStatus,
    history,
  });
});
```

> The engine type signature is `setShotStatus(shotId, toStatus, changedBy, note?)` returning `{shotId, name, previousStatus, newStatus, eventId}`. The HTTP response uses `result.newStatus` (the actual transition outcome) and re-fetches history for the freshest timeline.

### Example 2: HTTP route — GET /api/versions/:a/diff-with/:b

```typescript
// Source: existing engine method at src/engine/pipeline.ts:1062
// + mirrors GET /api/versions/:id/diff?against= pattern at dashboard-routes.ts:379

app.get('/api/versions/:a/diff-with/:b', async (c) => {
  const a = c.req.param('a');
  const b = c.req.param('b');
  // engine.diffVersions is async (reads disk for output hashes when B is
  // reproduce-lineage). Mirrors existing /diff endpoint at line 391.
  return c.json(await engine.diffVersions(a, b));
});
```

> No new engine code. `engine.diffVersions` already accepts any two version IDs; the pure function asserts same `shot_id` (engine/diff.ts:27-33) and throws `TypedError('INVALID_INPUT')` if they differ — surfaced as 400 by the global handler.

### Example 3: Optimistic quick-approve flow (api.ts addition + handler)

```typescript
// Source: api.ts:270 pattern for diffVersion → fetchJson
// + D-12 optimistic+revert flow

// In lib/api.ts:
export interface SetShotStatusBody {
  to_status: ShotStatus;
  note?: string | null;
  changed_by?: string;
}

export interface SetShotStatusResponse {
  status: ShotStatus;
  history: ShotStatusEvent[];
}

export function setShotStatus(
  shotId: string,
  body: SetShotStatusBody,
): Promise<SetShotStatusResponse> {
  return fetchJson<SetShotStatusResponse>(
    `/api/shots/${encodeURIComponent(shotId)}/status`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export function fetchShotStatusHistory(
  shotId: string,
  limit = 50,
): Promise<{ history: ShotStatusEvent[]; total: number }> {
  // NEW route GET /api/shots/:id/status-history (see Open Question Q3 — new HTTP route required)
  return fetchJson(
    `/api/shots/${encodeURIComponent(shotId)}/status-history?limit=${limit}`,
  );
}

export function diffVersionsAB(a: string, b: string): Promise<DiffResponseShape> {
  return fetchJson<DiffResponseShape>(
    `/api/versions/${encodeURIComponent(a)}/diff-with/${encodeURIComponent(b)}`,
  );
}
```

### Example 4: Timeline merger — pure function

```typescript
// Source: Phase 22 new utility (no existing precedent). Pure, no signals.

import type { Version } from '../types/entities.js';
import type { ShotStatusEvent } from '../types/review-panel.js';

export type ShotHistoryEntry =
  | { kind: 'version'; version: Version; event: 'created' | 'completed'; at: number }
  | { kind: 'status'; event: ShotStatusEvent };

export function mergeHistory(
  versions: Version[],
  statusEvents: ShotStatusEvent[],
): ShotHistoryEntry[] {
  const entries: ShotHistoryEntry[] = [];

  for (const v of versions) {
    entries.push({ kind: 'version', version: v, event: 'created', at: v.created_at });
    if (v.completed_at !== null) {
      entries.push({ kind: 'version', version: v, event: 'completed', at: v.completed_at });
    }
  }
  for (const e of statusEvents) {
    entries.push({ kind: 'status', event: e });
  }

  // Sort newest first per REV-01 / D-04. Ties: status events win (more specific) — Claude discretion.
  return entries.sort((a, b) => {
    const aAt = a.kind === 'version' ? a.at : a.event.created_at;
    const bAt = b.kind === 'version' ? b.at : b.event.created_at;
    if (bAt !== aAt) return bAt - aAt;
    if (a.kind !== b.kind) return a.kind === 'status' ? -1 : 1;
    return 0;
  });
}
```

### Example 5: ShotGridCard refactor — three sibling buttons

```typescript
// Source: D-13 refactor of components/ShotGridCard.tsx (current single-button form at line 64-110)

export function ShotGridCard({ shot, onSelect }: ShotGridCardProps) {
  const hasVersion = shot.latest_completed_version !== null;
  const isOmit = shot.status === 'omit';
  const quickApproveErr = quickApproveError.value === shot.id;

  const cardBody = (
    <div class="group relative w-full overflow-hidden rounded">
      {/* Thumbnail button (preserves Phase 21 D-19) */}
      <button
        type="button"
        onClick={hasVersion ? () => onSelect(shot.latest_completed_version!.id) : undefined}
        aria-label={`${SHOT_CARD_OPEN_ARIA_PREFIX}${shot.name}`}
        aria-disabled={!hasVersion || undefined}
        disabled={!hasVersion}
        class="block w-full focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {hasVersion ? (
          <Thumbnail version={{ id: shot.latest_completed_version!.id, label: shot.name, status: 'complete' }} size="card" />
        ) : (
          <SkeletonThumbnail width={220} height={124} />
        )}
      </button>

      {/* Hover quick-approve button (D-10) — only when shot has versions */}
      {hasVersion && (
        <QuickApproveButton
          shotId={shot.id}
          shotName={shot.name}
          currentStatus={shot.status}
        />
      )}

      <div class="flex flex-col gap-1 p-2 text-[var(--color-fg)]">
        <div class="flex items-center justify-between gap-2">
          {/* ShotStatusPill button (D-13) — opens review panel */}
          <ShotStatusPill
            status={shot.status}
            onClick={() => openReviewPanel(shot.id)}
            ariaLabel={`Open review panel for ${shot.name} (status: ${shot.status})`}
          />
          <span class="num text-xs text-[var(--color-fg-muted)]">
            {formatVersionCount(shot.version_count)}
          </span>
        </div>
        <span class="truncate text-sm font-normal">{shot.name}</span>
        {hasVersion && (
          <span class="num text-xs text-[var(--color-fg-muted)]">
            {SHOT_CARD_LAST_UPDATED_PREFIX}
            {formatRelativeTime(shot.latest_completed_version!.completed_at)}
          </span>
        )}
      </div>

      {/* Inline error pill (D-12) — quick-approve failed */}
      {quickApproveErr && (
        <div class="absolute inset-x-2 bottom-2" aria-live="polite" aria-atomic="true">
          <WarningPill
            label={REVIEW_QUICK_APPROVE_FAIL_LABEL}
            ariaLabel={REVIEW_QUICK_APPROVE_FAIL_ARIA}
          />
        </div>
      )}
    </div>
  );

  if (isOmit) return <div class="opacity-40 transition-opacity">{cardBody}</div>;
  return cardBody;
}
```

> `class="group"` on the outer `<div>` enables `group-hover:opacity-100` on `<QuickApproveButton/>`'s `opacity-0` default.

### Example 6: ShotStatusPill dual-mode (presentational vs button)

```typescript
// Source: D-13 mod to components/ShotStatusPill.tsx (current presentational at line 58-67)

export interface ShotStatusPillProps {
  status: ShotStatus;
  onClick?: () => void;       // NEW — when provided, renders as <button>
  ariaLabel?: string;          // REQUIRED when onClick is set
}

export function ShotStatusPill({ status, onClick, ariaLabel }: ShotStatusPillProps) {
  const pillContent = (
    <span
      class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-normal uppercase tracking-widest ${SHOT_STATUS_STYLES[status]}`}
      data-status={status}
    >
      {status}
    </span>
  );

  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? `Open review for status ${status}`}
        aria-haspopup="dialog"
        class="rounded-full focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] motion-safe:transition-[filter] hover:brightness-110"
      >
        {pillContent}
      </button>
    );
  }

  return pillContent;
}
```

> The button wraps the existing `<span>` — no double pill rendering. Focus ring on outer button; pill internal styles unchanged.

## State of the Art

| Old Approach (training-era / Phase 5-12) | Current Approach (Phase 17-21 lessons) | Impact for Phase 22 |
|--------------|------------------|--------|
| `<DiffDrawer/>` renders only `summary` (one line) | New `<MetadataDiff/>` extracts + extends to also render `changes[]` | Phase 12 DiffDrawer keeps working (passes `summary` only); ABCompareView passes both |
| Whole-card-button (`<button>`-wrapper) | Card-as-`<div>` + multiple sibling buttons | D-13 reverses Phase 21 D-16 — Phase 22's third interactive area (quick-approve) forces the restructure |
| `selectedVersionId`-based overlay exclusivity | Discriminated `activeOverlay: 'review' | 'version' | null` | Generalizes to N overlays; future phases can add comments/settings drawers without re-architecting |
| `setShotStatus(arg1, arg2, arg3, arg4)` positional engine API | (unchanged — POSITIONAL is the stable form) | Plan must NOT propose changing to body-style; engine is stable |
| `engine.diffVersions(a, b)` (already arbitrary pair) | (unchanged — was already general) | D-16's "extend" wording is misleading; no engine change |
| `<button>`-as-card + nested button assumption | Three siblings + outer `<div class="group">` | Tailwind `group-hover:opacity-100` is the canonical CSS pattern for revealing hover affordances |
| Image preload via `img.onload` | `img.decode()` paint-ready Promise | Eliminates flash; native API since Chrome 64 / Safari 15 |
| `useState` for SSE handler reference | Module-export the handler (reference-stable) | Phase 21 D-22 locked this; Phase 22 inherits |

**Deprecated/outdated:**
- The "current vs parent" implicit base in `diffVersions()` — never existed. Engine has always taken explicit pair.
- The `selectedVersionId`-only overlay model — Phase 22 generalizes to `activeOverlay` discriminated signal.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `engine.diffVersions(a, b)` semantics: same-shot assertion only; no parent walk; arbitrary pair supported. | Pattern, Pitfall 2, Example 2 | Low — verified by reading `src/engine/diff.ts:27-33` + `src/engine/pipeline.ts:1062-1090`. If wrong, plan needs to add `baseVersionId` param to engine. |
| A2 | The `<DiffDrawer/>` Phase 12 caller does NOT depend on `changes[]` rendering; only `summary` is currently surfaced. | Pattern, Don't Hand-Roll | Low — verified by reading `packages/dashboard/src/views/DiffDrawer.tsx:101-108` which renders only `<p>{diff.summary}</p>`. If wrong, MetadataDiff extraction must preserve exact current behavior. |
| A3 | Existing `lib/api.ts` `fetchJson` helper supports PATCH method via `RequestInit.method`. | Code Example 3 | Low — verified by reading `api.ts:76-110`. fetchJson accepts `init?: RequestInit` and passes through. |
| A4 | `SHOT_STATUSES` const from `src/types/hierarchy.ts` is server-side; dashboard re-derives via `ShotStatusChangedPayload['toStatus']` per architecture-purity (D-WEBUI-31). | Code Example 1, Project Constraints | Low — verified by reading `packages/dashboard/src/types/shot-grid.ts:23`. Dashboard MUST NOT import from `src/`. |
| A5 | `getThumbnailUrl(versionId)` returns the route URL (not the file URL with explicit filename) — server resolves the thumbnail filename internally. | Pattern 5 | Low — verified at `api.ts:303`. Phase 17 caches thumbnails server-side; client never assembles filename. |
| A6 | The Phase 20 `engine.listShotStatusHistory(shotId, limit)` is callable from HTTP — but no HTTP route currently exposes it; Phase 22 must add one for the dashboard's history fetch. | Open Questions, Pattern, Example 3 | Medium — confirmed no `/api/shots/.../status-history` route in current `dashboard-routes.ts`. Phase 22 plan MUST add this route (D-19 likely needs broadening to include the read endpoint, or assume the dashboard reads history as part of the PATCH response only). |
| A7 | `onShotStatusChanged` handler reference can stay in `state/shot-grid.ts`; no relocation needed despite D-18's "may relocate to state/review-panel.ts" suggestion. | Don't Hand-Roll, Pattern, UI-SPEC L380 | Low — UI-SPEC explicitly says "The Phase-21 onShotStatusChanged handler stays in state/shot-grid.ts (no relocation needed)". Confirmed by reading state/shot-grid.ts:160-171. |
| A8 | The new `<MetadataDiff/>` extracted from DiffDrawer should render BOTH summary AND structured changes (params, models, seed, workflow, metadata) — even though current DiffDrawer only renders summary. | Don't Hand-Roll | Medium — Phase 22 D-16 just says "extract". A2 confirms current renders only summary; ABCompareView needs richer output. Plan MAY decide to ship only summary in MetadataDiff for v1.3 and defer changes rendering — discuss with checker. |
| A9 | Five-second autodismiss timer for WarningPill is Claude's discretion (D-12 says "5-second timeout (Claude discretion)"). | Pitfall 5, D-12 | Low — explicitly in scope. |
| A10 | LRU-2 selection in compare-mode (third click unchecks oldest) is Claude discretion per UI-SPEC L520. | UI-SPEC L520 | Low — explicit. |

**Where an assumption needs user confirmation:** A6 (HTTP route for status-history) and A8 (MetadataDiff scope) should be surfaced to the plan-checker. Both are tractable interpretations of CONTEXT.md but have minor design implications.

## Open Questions

1. **HTTP route for `fetchShotStatusHistory`**
   - What we know: `engine.listShotStatusHistory(shotId, limit)` exists (pipeline.ts:785). The MCP `shot.list_status_history` arm calls it (shot-tool.ts:155). NO HTTP route currently exposes status history (verified by reading dashboard-routes.ts in full).
   - What's unclear: Should Phase 22 add `GET /api/shots/:id/status-history?limit=50`, OR fold history into the PATCH response only (D-19's "Response shape: {status, history}"), OR add `GET /api/shots/:id` returning the full shot + history?
   - Recommendation: Add `GET /api/shots/:id/status-history?limit=50` as a new HTTP route. Mirrors the MCP tool surface 1:1, lets the dashboard refresh history on review-panel mount without a transition. The PATCH response's history (D-19) is a nice-to-have but not load-bearing. Plan task: extend `src/http/dashboard-routes.ts` with this third route alongside the two D-16/D-19 routes.

2. **`<MetadataDiff/>` scope: summary only or summary + changes?**
   - What we know: D-16 says "extract the metadata-rendering portion of `<DiffDrawer/>` into a smaller `<MetadataDiff/>` component (props: summary, changes)". Current DiffDrawer renders only `summary` (verified at views/DiffDrawer.tsx:101-108).
   - What's unclear: Does MetadataDiff render `changes` for the new ABCompareView (no current consumer of changes), OR ship summary-only for v1.3 and defer changes display to a polish phase?
   - Recommendation: MetadataDiff renders BOTH summary AND structured changes. Specifically:
     - `summary`: existing one-liner block (reused verbatim from DiffDrawer).
     - `changes`: structured list grouped by category (params, models, seed, workflow, metadata) — each entry is one line. ABCompareView passes both; DiffDrawer migrates to also pass both (the changes block is purely additive — DiffDrawer currently has empty space below summary). UI-SPEC L378 `(props: summary, changes)` confirms both props.
   - Plan task: define `<MetadataDiff summary={...} changes={...}/>` with explicit per-category sub-sections; null/empty arrays render the section as "No changes".

3. **PATCH response shape — full history vs. just status?**
   - What we know: D-19 specifies `{status: ShotStatus, history: ShotStatusEvent[]}` (full history echo).
   - What's unclear: Is the dashboard expected to use this history payload to update its timeline cache, OR does it ignore the response and rely on SSE + the separate history fetch?
   - Recommendation: Return both. Dashboard prefers the PATCH response for the immediate UI update (lower latency than awaiting SSE), but falls back to SSE + history fetch for multi-tab convergence. The duplicate write (PATCH response + SSE handler) is harmless because the SSE handler is idempotent.

4. **A/B compare modal — render layer (z-index hierarchy)?**
   - What we know: D-23 says "modal renders inside a new top-level mount point". UI-SPEC §"Layout Reference Diagram" shows ReviewPanel visible behind backdrop.
   - What's unclear: What z-index ranks are in play? VersionDrawer is `z-10`; DiffDrawer is `z-20`; the new ABCompareView modal needs to be above ReviewPanel AND any drawer.
   - Recommendation: ABCompareView uses `z-30` for the backdrop+modal cluster (above both `z-10` drawers and `z-20` DiffDrawer). Document the z-index ladder as a comment in `theme.css` so future overlay phases know what's available.

5. **Compare-mode keyboard shortcut**
   - What we know: UI-SPEC L455 specifies ESC exits compare-mode (when no popover is open).
   - What's unclear: Should there be a keyboard shortcut to ENTER compare-mode (e.g., 'c' on focused timeline)?
   - Recommendation: NO — Phase 22 is mouse + tab-key primary. Adding a hotkey would require documenting a keyboard map. Defer to a polish phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Server runtime | (assumed via project setup) | 18+ | — |
| Preact + @preact/signals | Dashboard | YES (already installed) | 10.29.1 + 2.9.0 | — |
| Hono | Server HTTP | YES (already installed) | (server) | — |
| better-sqlite3 + drizzle-orm | DB layer | YES (already installed) | (server) | — |
| Zod | Validation | YES (already installed) | (server + client) | — |
| Vitest + @testing-library/preact | Tests | YES (already installed) | 4.1.5 + 3.2.4 | — |
| `lucide-preact` (icons: Check, X, GitCompare, ArrowLeft) | UI | YES — installed v1.9.0; all 4 icons in catalog | 1.9.0 | — |
| `HTMLImageElement.decode()` API | A/B preload | YES (native; Chrome 64+, Safari 15+) | native | Fallback to `.onload` per D-17 (verified safe path) |
| EventSource (SSE) | Optimistic + convergence | YES (Phase 5 wired) | native | — |
| jsdom (Vitest env) | Component tests | YES | 29.0.2 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** `HTMLImageElement.decode()` already has a documented fallback (D-17). No action required.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 (server + dashboard); @testing-library/preact 3.2.4 (component tests); jsdom 29.0.2 (DOM env) |
| Config file | `vitest.config.ts` (server root) + `packages/dashboard/vitest.config.ts` (dashboard) |
| Quick run command | `npx vitest run packages/dashboard/src/__tests__/StatusChangePopover.test.tsx` (single file, dashboard side) |
| Full suite command | `npx vitest` (server) + `cd packages/dashboard && npx vitest run` (dashboard) — same shape used in Phase 21 Wave 5 |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REV-01 (panel mount + structure) | ReviewPanel renders header + action bar + timeline when activeOverlay='review' | unit | `npx vitest run packages/dashboard/src/views/__tests__/ReviewPanel.test.tsx` | ❌ Wave 0 |
| REV-01 (panel keyed on shotId — SSE non-disruption) | SSE shot.status_changed for the open shot updates header pill in-place; review state preserved | integration | `npx vitest run packages/dashboard/src/__tests__/review-panel-sse-integration.test.tsx` | ❌ Wave 0 |
| REV-01 (confirmation popover gating) | Action button click opens popover; Confirm fires onConfirm with note text; outside-click cancels without firing | unit | `npx vitest run packages/dashboard/src/components/__tests__/StatusChangePopover.test.tsx` | ❌ Wave 0 |
| REV-02 (quick-approve optimistic + revert) | Optimistic mutation precedes PATCH; PATCH 2xx is no-op; PATCH error reverts AND renders WarningPill | integration | `npx vitest run packages/dashboard/src/__tests__/quick-approve-flow.test.tsx` | ❌ Wave 0 |
| REV-02 (WarningPill 5s auto-dismiss) | Mock 5000ms timer; assert quickApproveError signal clears | unit | (covered in `quick-approve-flow.test.tsx`) | ❌ Wave 0 |
| REV-03 (parallel preload + side-by-side render) | A/B view mounts with skeletons; preload Promise resolves; thumbnails appear; metadata diff renders | unit | `npx vitest run packages/dashboard/src/views/__tests__/ABCompareView.test.tsx` | ❌ Wave 0 |
| REV-03 (preload failure surfaces error copy) | `.decode()` rejects → fallback `.onload` rejects → error state renders COMPARE_MODAL_THUMB_LOAD_FAIL | unit | (covered in `ABCompareView.test.tsx`) | ❌ Wave 0 |
| REV-04 (note null when blank — engine pathway) | `engine.setShotStatus(shotId, 'approved', 'user', undefined)` writes `note: null` to shot_status_events | integration (server) | `npx vitest run src/__tests__/dashboard-routes-set-status.test.ts` | ❌ Wave 0 |
| REV-04 (note null when blank — client-side) | Popover with empty textarea → onConfirm receives `null` (not `''`) | unit | (covered in `StatusChangePopover.test.tsx`) | ❌ Wave 0 |
| REV-05 (Restore button visibility-gated) | currentStatus='omit' → Restore visible; otherwise not in DOM | unit | `npx vitest run packages/dashboard/src/components/__tests__/ReviewActionBar.test.tsx` | ❌ Wave 0 |
| REV-05 (Restore popover hides textarea + sends literal note) | action='restore' popover does NOT render textarea; submit sends RESTORE_NOTE_SYSTEM_TEXT | unit | (covered in `StatusChangePopover.test.tsx`) | ❌ Wave 0 |
| D-13 (ShotGridCard refactor — 3 sibling buttons) | Card root is div (not button); 3 nested buttons present (thumb, pill, quick-approve); no button-in-button | unit | `npx vitest run packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` | ✅ exists (Phase 21) — needs new test cases |
| D-13 (ShotStatusPill button mode) | onClick prop → renders as `<button>` with aria-haspopup="dialog"; absent → renders as `<span>` | unit | `npx vitest run packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx` | ✅ exists (Phase 21) — needs new test cases |
| D-02 (mutual-exclusion overlay) | Setting activeOverlay='review' unmounts VersionDrawer; setting 'version' unmounts ReviewPanel | unit | `npx vitest run packages/dashboard/src/views/__tests__/OverlayHost.test.tsx` | ❌ Wave 0 |
| D-21 (tool count holds at 7) | tool-budget.test.ts assertion === 7 | server invariant | `npx vitest run src/__tests__/tool-budget.test.ts` | ✅ exists |
| D-19 (HTTP route delegates to engine) | PATCH route calls engine.setShotStatus with positional args; SHOT_NOT_FOUND → 404; INVALID_INPUT → 400 | unit (server) | `npx vitest run src/__tests__/dashboard-routes-set-status.test.ts` | ❌ Wave 0 |
| D-16 (diff route delegates to engine) | GET /api/versions/:a/diff-with/:b calls engine.diffVersions(a, b); different shots → 400 | unit (server) | `npx vitest run src/__tests__/dashboard-routes-diff-ab.test.ts` | ❌ Wave 0 |
| Append-only invariant | grep `UPDATE shot_status_events` in src/ returns zero | repo-purity | `grep -r "UPDATE shot_status_events" src/` (existing test) | ✅ exists (Phase 20) |
| Architecture purity (no MCP imports in HTTP routes) | architecture-purity.test.ts | repo-purity | `npx vitest run src/__tests__/architecture-purity.test.ts` | ✅ exists |

### Sampling Rate

- **Per task commit:** `npx vitest run` (dashboard subset for UI tasks; server subset for HTTP tasks) — < 30s
- **Per wave merge:** `npx vitest` (server) + `cd packages/dashboard && npx vitest run` (dashboard) — full both sides
- **Phase gate:** Full both suites green + tool-budget + architecture-purity + append-only grep (mirrors Phase 21 Wave 5 gate)

### Wave 0 Gaps

- [ ] `packages/dashboard/src/views/__tests__/ReviewPanel.test.tsx` — covers REV-01 structure + mount
- [ ] `packages/dashboard/src/views/__tests__/ABCompareView.test.tsx` — covers REV-03 preload + render + error
- [ ] `packages/dashboard/src/views/__tests__/OverlayHost.test.tsx` — covers D-02 mutual exclusion
- [ ] `packages/dashboard/src/components/__tests__/StatusChangePopover.test.tsx` — covers popover mechanics + REV-04 + REV-05 popover variant
- [ ] `packages/dashboard/src/components/__tests__/ReviewActionBar.test.tsx` — covers Restore visibility + button states
- [ ] `packages/dashboard/src/components/__tests__/MetadataDiff.test.tsx` — covers summary + changes rendering
- [ ] `packages/dashboard/src/components/__tests__/QuickApproveButton.test.tsx` — covers hover affordance + click → popover
- [ ] `packages/dashboard/src/__tests__/quick-approve-flow.test.tsx` — REV-02 integration (optimistic + revert + WarningPill)
- [ ] `packages/dashboard/src/__tests__/review-panel-sse-integration.test.tsx` — SSE convergence with open review panel
- [ ] `src/__tests__/dashboard-routes-set-status.test.ts` — covers D-19 HTTP route + error envelopes
- [ ] `src/__tests__/dashboard-routes-diff-ab.test.ts` — covers D-16 HTTP route + cross-shot 400 path
- [ ] `src/__tests__/dashboard-routes-status-history.test.ts` — covers new GET /api/shots/:id/status-history route (per Open Question Q1)
- [ ] Existing `ShotGridCard.test.tsx` extensions: D-13 refactor assertions (3 sibling buttons, no button-in-button)
- [ ] Existing `ShotStatusPill.test.tsx` extensions: button-mode rendering when onClick provided

No new framework install needed; all test infra exists.

## Security Domain

> Required since `security_enforcement` defaults to enabled (no config override identified).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | NO | No auth surface modified; existing single-user model (CLAUDE.md "Single-artist demo scope" — Phase 19 D-PRIV-2). Phase 22 inherits. |
| V3 Session Management | NO | No session storage changes. |
| V4 Access Control | NO | All endpoints same-origin; no per-shot ACL in scope. |
| V5 Input Validation | YES | Zod whitelist at HTTP boundary for both new routes. `to_status` against `SHOT_STATUSES` enum; `note` max-length 500; `changed_by` max-length 100; `shotId` and version IDs as path params (no length check beyond what Hono's router accepts — limited risk because they hit a `getShot` / `getVersion` lookup that throws SHOT_NOT_FOUND / VERSION_NOT_FOUND for unknown IDs). |
| V6 Cryptography | NO | No new cryptography. |

### Known Threat Patterns for Phase 22 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stored XSS via `note` field | T (Tampering) | Notes render as JSX text children — Preact auto-escapes (T-5-06 precedent). Verified by inspection: timeline row renders `{event.note}` directly, no `dangerouslySetInnerHTML`. |
| SQL injection via `to_status` | Tampering | Zod enum closed against `SHOT_STATUSES`; Drizzle ORM `.update(shots).set({ status: toStatus })` uses parameterized binding. |
| Path traversal on diff route | Tampering | Path params `:a` and `:b` flow into `engine.getVersion()` lookup; non-existent IDs throw TypedError('VERSION_NOT_FOUND') → 404. No filesystem access for diff metadata. |
| CSRF on PATCH route | Tampering | Same-origin policy + existing dashboard origin lockdown (Phase 5 D-WEBUI-04). No new CSRF surface introduced. |
| Info-disclosure via SSE | I (Disclosure) | Existing T-20-03-01 disposition (already-authenticated stream). Phase 22 emits no new SSE events; reuses Phase 20's `shot.status_changed`. |
| DoS via large note payload | D (Denial) | Zod `note.max(500)` mirrors MCP tool's `note.max(500)` (shot-tool.ts:56). Larger payloads → 400 INVALID_INPUT. |
| Replay of stale PATCH (optimistic flow) | T | Idempotent at engine level — setting status to current value is a no-op write that still inserts an event. Acceptable (audit trail captures every commit even if no-op). |

## Sources

### Primary (HIGH confidence — verified from repo code)

- `src/engine/pipeline.ts:703-748` (setShotStatus signature) — engine method that the MCP tool calls + that the new PATCH route delegates to
- `src/engine/pipeline.ts:1062-1090` (diffVersions facade) — async, accepts arbitrary version pair; no parent walk
- `src/engine/diff.ts:172-184` (pureDiffVersions) — asserts same shot_id; returns `{summary, changes}`
- `src/tools/shot-tool.ts:140-156` (set_status / get_status / list_status_history MCP arms) — engine call pattern to mirror in HTTP layer
- `src/store/shot-status-repo.ts:69-95` (insertStatusEvent) — transaction discipline, `note ?? null`
- `src/store/shot-status-repo.ts:38-46` (ShotStatusEvent type) — wire shape for dashboard timeline
- `src/types/provenance.ts:218-254` (DiffResponse + MetadataChange) — shape MetadataDiff renders
- `src/http/dashboard-routes.ts` (full file) — existing Hono route patterns + TypedError handling
- `src/http/sse.ts:135-148` (toDashboardPayload shot.status_changed) — SSE camelCase mapping confirmed
- `packages/dashboard/src/views/VersionDrawer.tsx:299-341` (drawer aside structure) — pattern ReviewPanel mirrors
- `packages/dashboard/src/views/VersionDrawerHost.tsx` (mount host with cache-miss fetch) — pattern OverlayHost extends
- `packages/dashboard/src/views/DiffDrawer.tsx:45-110` (DiffDrawer current shape) — confirms only `summary` is rendered today
- `packages/dashboard/src/components/SortDropdown.tsx:144-211` (popover mechanics) — StatusChangePopover precedent
- `packages/dashboard/src/components/ShotGridCard.tsx:52-120` (Phase 21 current form) — refactor source-of-truth
- `packages/dashboard/src/components/ShotStatusPill.tsx:58-67` (presentational form) — button-mode promotion source
- `packages/dashboard/src/components/WarningPill.tsx:29-43` (amber pill primitive) — quick-approve failure pill
- `packages/dashboard/src/state/shot-grid.ts:160-171` (onShotStatusChanged) — idempotent SSE handler — STAYS HERE
- `packages/dashboard/src/App.tsx:73-100` (SSE register/cleanup) — reference-equality contract
- `packages/dashboard/src/lib/api.ts:270-306` (diffVersion + getOutputUrl + getThumbnailUrl) — fetch-helper conventions
- `packages/dashboard/src/lib/copy.ts:186-310` (Phase 21 copy block) — append-after convention
- `packages/dashboard/src/lib/events.ts:97-117` (onSseEvent/offSseEvent) — handler-reference semantics
- `packages/dashboard/src/types/events.ts:72-79` (ShotStatusChangedPayload) — dashboard wire shape
- `packages/dashboard/src/types/shot-grid.ts:18-69` (ShotStatus + ShotGridRow + ShotGridResponse) — types to extend
- `packages/dashboard/src/__tests__/SortDropdown.test.tsx:216-262` (popover test patterns) — outside-click + ESC + focus-return assertions
- `packages/dashboard/src/styles/theme.css:29-78` (existing tokens) — zero new tokens needed per UI-SPEC
- `.planning/phases/22-review-and-approval/22-UI-SPEC.md` — checker-approved visual contract
- `.planning/phases/22-review-and-approval/22-CONTEXT.md` — 23 locked decisions
- `.planning/REQUIREMENTS.md` REV-01..05 — locked requirements

### Secondary (MEDIUM confidence — convention or pattern inference)

- Phase 17 `<SkeletonThumbnail width height/>` API — explicit dimensions for CLS=0 (referenced by D-17 for A/B preload state)
- Phase 12 DiffSummaryShape via `src/types/provenance.ts` — used by both DiffDrawer (existing) + ABCompareView (new)
- Phase 21 D-22 SSE handler reference-equality contract — propagates to Phase 22 unchanged

### Tertiary (LOW confidence — Claude discretion items)

- Z-index ladder for ABCompareView modal (proposed `z-30`) — needs documentation in theme.css
- Restore action confirmation copy match — uses literal `RESTORE_NOTE_SYSTEM_TEXT = 'Restored from omit'` per REV-05 (verified in UI-SPEC L272)
- Compare-mode LRU-2 selection logic — Claude discretion per UI-SPEC L520

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; all libs already shipped (verified `package.json`)
- Architecture: HIGH — every backend hook verified by reading the actual engine file; UI patterns grounded in Phase 17/18/21 precedents
- Pitfalls: HIGH — Pitfalls 1-10 derived from real code patterns (positional engine sig, nested button antipattern, SSE handler stability, etc.); 8 of 10 are bugs we can preempt by reading specific line numbers
- Validation Architecture: HIGH — test framework already wired; Wave 0 gap list is precise file paths

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (30 days; stable codebase, no library churn expected)
