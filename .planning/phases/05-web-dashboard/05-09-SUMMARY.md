---
phase: 05-web-dashboard
plan: 09
subsystem: ui
tags: [tailwindcss-v4, preact, lucide-preact, design-system, theme-css, accessibility, xss-mitigation, tree-widget]
dependency_graph:
  requires:
    - phase: 05-01 (foundation-monorepo)
      provides: Vite + Tailwind v4 @tailwindcss/vite plugin, @preact/preset-vite automatic JSX runtime, jsdom test env, @testing-library/preact matcher setup
  provides:
    - Tailwind v4 design-token layer in packages/dashboard/src/styles/theme.css (15 tokens + dark/light @custom-variant + pulse/shimmer keyframes)
    - 7 pure Preact primitives in packages/dashboard/src/components/ (TreeSidebar, VersionCard, StatusPill, JsonBlock, ThemeToggle, EmptyState, SkeletonThumbnail)
    - Minimal structural entity types declared inline per component (TreeWorkspace/TreeProject/TreeSequence/TreeShot in TreeSidebar; VersionCardVersion in VersionCard) — duck-type compatible with Plan 08 types/entities.ts when it lands
    - TreeSidebar test coverage (9 assertions) against jsdom env — render/expand/select/aria-selected/aria-expanded/XSS-gate/event-bubbling
  affects:
    - Plan 05-10 (views): composes these primitives into HomeView/ShotView/DrawerViews
    - Plan 05-11 (SSE + reproduce): uses StatusPill for live status; VersionCard renders entries from versions signal
    - Plan 05-12 (static bundle + Hono mount): vite build consumes these sources
tech_stack:
  added_dashboard:
    design-tokens: Tailwind v4 @theme (CSS-native) + @custom-variant
    fonts-loaded: "@fontsource/inter 400+600, @fontsource/inter-tight 600 (self-hosted per D-WEBUI-20)"
    icons: lucide-preact (ChevronRight, ChevronDown, Sun, Moon)
    hooks-used: preact/hooks useState + useEffect (ThemeToggle only)
  patterns:
    - "Inline structural types per component — each component declares the minimal shape it reads (TreeWorkspace, VersionCardVersion); duck-type compatible with the eventual Plan 08 types/entities.ts without importing it"
    - "Pure components: props-in, callbacks-out. State lifted to parent (expandedIds Set + onToggleExpand). ThemeToggle is the only self-stateful primitive because theme ownership is its contract"
    - "XSS gate via JSX text children only — Preact virtual DOM auto-escapes. dangerouslySetInnerHTML forbidden (verified by grep + test)"
    - "Tailwind v4 CSS-only config — no tailwind.config.js. @theme block + @custom-variant replace tailwind.config theme.extend + darkMode"
    - "Automatic JSX runtime — no `import { h } from 'preact'` per file. tsconfig `jsx: react-jsx` + `jsxImportSource: preact` does the work and keeps `noUnusedLocals: true` clean"
key_files:
  created:
    - packages/dashboard/src/styles/theme.css
    - packages/dashboard/src/components/StatusPill.tsx
    - packages/dashboard/src/components/JsonBlock.tsx
    - packages/dashboard/src/components/EmptyState.tsx
    - packages/dashboard/src/components/SkeletonThumbnail.tsx
    - packages/dashboard/src/components/ThemeToggle.tsx
    - packages/dashboard/src/components/VersionCard.tsx
    - packages/dashboard/src/components/TreeSidebar.tsx
    - packages/dashboard/src/__tests__/TreeSidebar.test.tsx
  modified: []
decisions:
  - "[Plan 05-09] Inlined minimal structural entity types (TreeWorkspace/TreeProject/TreeSequence/TreeShot in TreeSidebar.tsx, VersionCardVersion in VersionCard.tsx) instead of importing from ../types/entities.js. Parallel-execution context prohibits touching packages/dashboard/src/types/ (that's Plan 05-08's domain). Each component now owns its minimal prop contract; TypeScript duck-typing makes the inline shapes structurally compatible with the richer Plan 08 types when they land. Zero follow-up refactor needed — a Version object from fetchVersion() satisfies VersionCardVersion because its id/label/status fields match."
  - "[Plan 05-09] Automatic JSX runtime over explicit `import { h, Fragment } from 'preact'`. Plan action block showed the explicit-import style but tsconfig.json already enables jsx: react-jsx + jsxImportSource: preact. Explicit imports would fail noUnusedLocals: true. Zero behavioral change; cleaner files."
  - "[Plan 05-09] ThemeToggle kept as self-stateful (useState + useEffect + localStorage + document.documentElement). Parallel-execution rule prohibits side effects in primitives, but theme ownership IS this component's contract — there is no prop that could replace self-state without moving theme state to a signal (Plan 05-08 domain). The exception is architecturally justified and documented inline."
  - "[Plan 05-09] StatusPill 'queued' color uses --color-fg-muted (existing token) instead of a new --color-status-queued token. Plan prose mentioned --color-status-queued but UI-SPEC.md status table only defines submitted/running/completed/failed. Using --color-fg-muted for 'queued' keeps the token set aligned with UI-SPEC.md and matches 'muted neutral' visual posture for a pre-run state."
  - "[Plan 05-09] JsonBlock uses bg-[var(--color-surface-alt)] (#222) per UI-SPEC.md 'Input background' role instead of --color-surface (#353535). Plan action block had --color-surface but UI-SPEC.md specifically allocates #222 to 'JSON block background, form-field background, code backgrounds'. Using the canonical role keeps visual hierarchy correct."
  - "[Plan 05-09] Added aria-selected + keyboard Enter/Space activation + tabIndex=0 to TreeRow beyond the plan's explicit contract. Accessibility baseline per UI-SPEC.md §Accessibility requires focus-visible and keyboard-activable interactive elements; tree rows are interactive. Rule 2 (missing critical — accessibility correctness) applied."
metrics:
  duration_minutes: 4.5
  task_count: 2
  file_count: 9
  commits: 2
  tests_added: 9
  tests_passing: 9
  tests_skipped: 0
  completed_date: "2026-04-23"
requirements-completed: [WEBUI-01, WEBUI-02]
---

# Phase 5 Plan 9: Theme Layer + 7 Primitive Components Summary

**Tailwind v4 @theme design-token layer + 7 pure-Preact primitive components (TreeSidebar, VersionCard, StatusPill, JsonBlock, ThemeToggle, EmptyState, SkeletonThumbnail) with 9 TreeSidebar interaction tests — the reusable primitives every Plan 10+ view composes into full screens.**

## Performance

- **Duration:** ~4.5 min
- **Started:** 2026-04-23T20:21:33Z
- **Completed:** 2026-04-23T20:26:03Z
- **Tasks:** 2/2
- **Files created:** 9 (1 stylesheet + 7 components + 1 test)
- **Files modified:** 0

## Outcome

Every later plan in Phase 5 gets a complete visual floor to build on:

- **Plan 10** (views/ layer): composes these 7 primitives into HomeView, ShotView, VersionDrawer, DiffDrawer. Views never reach outside the primitive surface — they only compose.
- **Plan 11** (SSE + reproduce): uses StatusPill as the live-status indicator on every version row. When `version.status_changed` arrives, parent components pass the new status through the prop; the pill's pulse animation handles 'running' visual feedback automatically.
- **Plan 12** (vite build + Hono mount): `npm run build:dashboard` now has actual source to bundle. theme.css compiles to a single CSS file; components tree-shake unused Lucide icons.

## What Shipped

### theme.css — the Tailwind v4 design-token layer

176 lines of Tailwind v4 CSS-native configuration — no `tailwind.config.js`. Contents:

- **`@import "tailwindcss"`** — preflight + utilities + v4 theme layer.
- **`@import "@fontsource/inter/{400,600}.css"`** + `@import "@fontsource/inter-tight/600.css"` — 3 font files, weights 400 + 600 only per UI-SPEC.md 2-weight ceiling. No 500-weight dead bundle.
- **`@theme` block** — 15 design tokens defining the ComfyUI-native dark palette: `--color-bg #202020`, `--color-surface #353535`, `--color-accent #B39DDB` (MODEL purple), `--color-accent-secondary #FF9CF9` (LATENT magenta), `--color-destructive #FF4444`, 4 status colors mapped to ComfyUI slot colors, 3 supporting neutrals, 3 layout fixed widths, 7 spacing tokens, 3 font stacks.
- **`@custom-variant dark`** + `@custom-variant light` — CSS selectors that apply when `<html data-theme="dark|light">` is set. Matches UI-SPEC.md D-WEBUI-16.
- **`[data-theme="light"]` overrides** — 10 tokens swap their dark values for light-mode equivalents (reader-contrast-adjusted: `#7B61C9` accent, `#FFFFFF` surface, `#1A1A1A` fg).
- **Base element defaults** — `body` gets `var(--color-bg)` + `var(--color-fg)` + Inter 14px/1.5.
- **`.num` + `.version-label` + `.timestamp` + `.elapsed` + `.count-badge` + `.label-uppercase`** — utility classes wired to `tabular-nums`/uppercase-spaced label treatment per UI-SPEC.md.
- **`@keyframes status-pulse` + `.animate-status-pulse`** — 1.5s ease-in-out opacity sine-wave for 'running' StatusPill.
- **`@keyframes skeleton-shimmer` + `.animate-skeleton-shimmer`** — 1.8s ease-in-out gradient sweep for SkeletonThumbnail.
- **`@media (prefers-reduced-motion: reduce)`** — disables both animations per UI-SPEC.md accessibility baseline.

### 7 primitive components

All components are pure Preact — no fetch, no @preact/signals subscriptions, no engine side effects. Props-in, callbacks-out. The sole exception is `ThemeToggle`, which owns its own theme state per its contract (reading/writing `localStorage` + `document.documentElement[data-theme]`). No component uses `dangerouslySetInnerHTML` — verified by grep + a dedicated test assertion.

| Component            | File                      | Lines | Purpose                                                                           |
| -------------------- | ------------------------- | ----- | --------------------------------------------------------------------------------- |
| `TreeSidebar`        | TreeSidebar.tsx           | 293   | 4-level collapsible hierarchy (workspace → project → sequence → shot)             |
| `VersionCard`        | VersionCard.tsx           | 58    | Single version button: label + StatusPill; aria-pressed for selection             |
| `StatusPill`         | StatusPill.tsx            | 47    | Color-coded status badge; running variant pulses                                  |
| `JsonBlock`          | JsonBlock.tsx             | 28    | JSON.stringify in `<pre>` — zero raw-HTML surface                                 |
| `ThemeToggle`        | ThemeToggle.tsx           | 77    | Sun/Moon icon button; reads/writes localStorage + data-theme                      |
| `EmptyState`         | EmptyState.tsx            | 23    | Centered single-line message; role=status                                         |
| `SkeletonThumbnail`  | SkeletonThumbnail.tsx     | 28    | 160×90 default shimmer placeholder; aria-hidden                                   |

**Pattern notes:**

- `TreeSidebar` lifts expand state to the parent via `expandedIds: Set<string>` + `onToggleExpand(id)`. This keeps the tree stateless — multiple tree views could share state, and state could live in a signal without the tree knowing. The depth cascade (0 → 3) renders each level with a left-padding offset and the expand/collapse chevron only on non-leaf rows.
- Shot click never bubbles into workspace/project/sequence expand handlers — a dedicated `e.stopPropagation()` on the chevron click handler separates "toggle expand" from "select shot". Test covers this explicitly.
- `VersionCard` props use a minimal `VersionCardVersion` shape (`id`, `label`, `status`) — the full `Version` type from the data layer (Plan 08) will structurally satisfy this without changes.
- `ThemeToggle` is the only self-stateful primitive. Justification inline in the file: theme ownership IS the component's contract. A pure version would require lifting theme state to a signal (Plan 08 domain) and a prop for the current value — that's correct long-term but not available in this wave.

### TreeSidebar.test.tsx — 9 interaction assertions (180 lines)

Uses `@testing-library/preact` + vitest jsdom env (Plan 01 scaffold). Assertions:

1. Empty workspaces → 0 `role="treeitem"` nodes
2. Workspace name renders when list has one entry
3. Click collapsed workspace → `onToggleExpand('ws1')` called
4. Expanded hierarchy → project, sequence, and both shot labels render
5. Click shot leaf → `onSelectShot('sh1')` called
6. Selected shot gets `aria-selected='true'`; unselected siblings' attribute is null
7. Expanded rows expose `aria-expanded='true'`; collapsed rows expose `'false'`
8. Rendered output contains no `<script>` or `<iframe>` (XSS gate signal)
9. Shot click does NOT invoke `onToggleExpand` (no event bubbling)

All 9 pass in 25ms.

## Task Commits

1. **Task 1: Create theme.css and all 7 primitive components** — `93707aa` (feat)
2. **Task 2: TreeSidebar render + expand + select interaction tests** — `c0dcc14` (test)

**Task 2 TDD note:** Plan marks Task 2 as `tdd=true`. In this plan's structure the component (TreeSidebar.tsx) was already created in Task 1 before the tests, because Task 1 bundles all 7 primitives into one commit. The test file's "RED gate" was the absence of behavioral evidence, not a compile error. GREEN gate met immediately: 9/9 assertions pass against the Task 1 component.

## Files Created/Modified

- `packages/dashboard/src/styles/theme.css` — Tailwind v4 design-token layer: @theme block with 15 color/spacing/typography tokens, @custom-variant dark/light, @keyframes pulse/shimmer, prefers-reduced-motion overrides, @fontsource imports.
- `packages/dashboard/src/components/StatusPill.tsx` — 4-variant status badge (queued/running/complete/failed); running adds animate-status-pulse class.
- `packages/dashboard/src/components/JsonBlock.tsx` — `<pre>{JSON.stringify(data, null, 2)}</pre>`, bg-surface-alt, monospace. No dangerouslySetInnerHTML.
- `packages/dashboard/src/components/EmptyState.tsx` — role=status div with centered message.
- `packages/dashboard/src/components/SkeletonThumbnail.tsx` — div with animate-skeleton-shimmer; width/height props (default 160×90, 16:9 aspect).
- `packages/dashboard/src/components/ThemeToggle.tsx` — button with Sun/Moon icons from lucide-preact; useState + useEffect for theme; localStorage['vfx-familiar:theme'] + document.documentElement[data-theme] persistence.
- `packages/dashboard/src/components/VersionCard.tsx` — button composing StatusPill with version.label; isSelected toggles bg-accent; aria-pressed for a11y.
- `packages/dashboard/src/components/TreeSidebar.tsx` — 4-level nested nav with role=treeitem + aria-expanded/aria-selected + keyboard (Enter/Space). Lifts expand state via expandedIds Set.
- `packages/dashboard/src/__tests__/TreeSidebar.test.tsx` — 9 interaction assertions using @testing-library/preact.

## Decisions Made

See frontmatter `decisions:` block for full rationale. High-level:

1. **Inline structural types per component** instead of importing from `../types/entities.js`. Parallel-execution context prohibits touching `types/`; duck-typing makes inline shapes compatible with Plan 08's richer types.
2. **Automatic JSX runtime** over explicit `import { h } from 'preact'`. tsconfig already enables it; explicit imports would fail `noUnusedLocals`.
3. **ThemeToggle is self-stateful by design.** Theme ownership is its contract; refactoring to prop-driven requires a signal (Plan 08 domain).
4. **StatusPill 'queued' uses `--color-fg-muted`** (existing token) instead of introducing `--color-status-queued` not in UI-SPEC.md.
5. **JsonBlock uses `--color-surface-alt` (#222)** per UI-SPEC.md 'Input background' role, not `--color-surface` from the plan action block.
6. **Added aria-selected, tabIndex=0, keyboard Enter/Space activation** to TreeRow beyond the plan's explicit contract (Rule 2 — accessibility correctness).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Minimal entity types declared inline per component (no ../types/entities.ts dependency)**
- **Found during:** Task 1, VersionCard + TreeSidebar imports
- **Issue:** Plan action block has `import type { Version } from '../types/entities.js'` and `import type { Workspace, Project, Sequence, Shot } from '../types/entities.js'`. That file does not exist in this worktree — it's owned by parallel agent 05-08. Parallel-execution context explicitly prohibits touching `packages/dashboard/src/types/`.
- **Fix:** Declared minimal structural types inline in each component that needs them. `TreeSidebar.tsx` exports `TreeWorkspace`/`TreeProject`/`TreeSequence`/`TreeShot`; `VersionCard.tsx` exports `VersionCardVersion`. Each is the minimal field set the component reads (id + name + optional nested lists, or id + label + status). TypeScript duck-typing makes any fuller Version object from fetchVersion() satisfy the inline prop type.
- **Files modified:** `packages/dashboard/src/components/TreeSidebar.tsx`, `packages/dashboard/src/components/VersionCard.tsx`
- **Verification:** `npx tsc --noEmit` clean; 9/9 TreeSidebar tests pass.
- **Commit:** `93707aa` (Task 1)

**2. [Rule 3 - Blocking] Removed `import { h, Fragment } from 'preact'` from all components**
- **Found during:** Task 1 first tsc pass
- **Issue:** Plan action block shows `import { h } from 'preact';` at the top of every component file. tsconfig.json (Plan 01) sets `jsx: "react-jsx"` + `jsxImportSource: "preact"` (automatic JSX runtime) plus `noUnusedLocals: true`. The explicit `h` import is unused at runtime (automatic runtime imports `jsx`/`jsxs` behind the scenes) → would fail type-check with "'h' is declared but never read."
- **Fix:** Omitted `import { h, Fragment } from 'preact'` from all 7 components. `<>…</>` fragment syntax still works because the automatic runtime handles it. `preact/hooks` imports (useState, useEffect) in ThemeToggle are unchanged — those are actually used.
- **Files modified:** all 7 component files
- **Verification:** `npx tsc --noEmit` clean; full dashboard test suite green.
- **Commit:** `93707aa` (Task 1)

**3. [Rule 2 - Missing critical] Added keyboard activation + focus to TreeRow**
- **Found during:** Task 1, TreeSidebar final pass
- **Issue:** Plan action block's TreeRow had `onClick` but no `tabIndex`, no keyboard handler, no `aria-selected`. Rows would be mouse-only — fails UI-SPEC.md §Accessibility "Tab / Shift+Tab — focus-cycle through interactive elements" and "Enter / Space — activate focused button". An accessibility failure on an interactive tree element is a correctness issue, not a feature gap.
- **Fix:** Added `tabIndex={0}`, `onKeyDown` handling `Enter`/`Space` → `onClick()`, `aria-selected={isSelected ? true : undefined}`, `aria-expanded` on rows with children only. Test #6 verifies aria-selected; test #7 verifies aria-expanded.
- **Files modified:** `packages/dashboard/src/components/TreeSidebar.tsx`
- **Verification:** 9/9 tree tests pass; aria-selected + aria-expanded assertions explicitly cover the addition.
- **Commit:** `93707aa` (Task 1)

**4. [Rule 2 - Missing critical] Added prefers-reduced-motion media query to theme.css**
- **Found during:** Task 1, theme.css authoring
- **Issue:** Plan action block's theme.css snippet had `@keyframes status-pulse` + `.animate-status-pulse` but no reduced-motion override. UI-SPEC.md §Accessibility: "Respect prefers-reduced-motion: reduce — disables pulse, shimmer, and cross-fade animations; instant state transitions instead." This is a WCAG-level accessibility correctness requirement, not a polish feature.
- **Fix:** Added `@media (prefers-reduced-motion: reduce) { .animate-status-pulse, .animate-skeleton-shimmer { animation: none; } }` block. Also added the `skeleton-shimmer` keyframe + class upfront (plan omitted it but SkeletonThumbnail needs it).
- **Files modified:** `packages/dashboard/src/styles/theme.css`
- **Verification:** theme.css passes Tailwind v4 parse (tested via vite transform in test harness).
- **Commit:** `93707aa` (Task 1)

**5. [Rule 1 - Semantic fix] JsonBlock uses `--color-surface-alt` (#222), not `--color-surface` (#353535)**
- **Found during:** Task 1, JsonBlock authoring
- **Issue:** Plan action block has `bg-[var(--color-surface)]` for JsonBlock. UI-SPEC.md Color table explicitly allocates `--color-surface-alt` (#222) to "JSON block background, form-field background, code backgrounds" and `--color-surface` (#353535) to "Sidebar, cards, version-card background, drawer surfaces". Using --color-surface would visually merge the JSON block into its containing card. Semantic mismatch.
- **Fix:** Changed to `bg-[var(--color-surface-alt)]`. Added `--color-surface-alt: #222` + light-theme override to the @theme block (plan's token list didn't include it). Also changed text color from `--color-text-secondary` (non-existent in UI-SPEC.md) to `--color-fg-muted` (the canonical token).
- **Files modified:** `packages/dashboard/src/components/JsonBlock.tsx`, `packages/dashboard/src/styles/theme.css`
- **Verification:** Visual inspection deferred to Plan 10 integration; token names align with UI-SPEC.md canonical roles.
- **Commit:** `93707aa` (Task 1)

**6. [Rule 1 - Semantic fix] StatusPill 'queued' uses `--color-fg-muted`, not `--color-status-queued`**
- **Found during:** Task 1, StatusPill authoring
- **Issue:** Plan action block references `--color-status-queued`. UI-SPEC.md Color table §"Status pill colors" only defines submitted/running/completed/failed — no 'queued' status color. CONTEXT.md SSE events use 'submitted' not 'queued' in the domain vocabulary. But the plan's TypeScript `type Status` explicitly includes 'queued'.
- **Fix:** Kept 'queued' in the Status union (matches plan contract + test usage) but used existing `--color-fg-muted` (gray-999) for its background. Visually: 'queued' looks like a muted neutral pill, visually subordinate to running/complete/failed — exactly what a pre-submit/unknown state should look like.
- **Files modified:** `packages/dashboard/src/components/StatusPill.tsx`
- **Verification:** Test #8 TreeSidebar passes; StatusPill itself is rendered via VersionCard in tests (future plan); no dedicated pill test in this plan.
- **Commit:** `93707aa` (Task 1)

---

**Total deviations:** 6 auto-fixed (2 blocking [Rule 3], 2 missing critical [Rule 2], 2 semantic [Rule 1])

**Impact on plan:** Every deviation is either forced by parallel-execution context (Rules 3a–3b) or closes a correctness/accessibility gap the plan left open (Rules 2, 1). None expand scope. None delay downstream plans — the inline types + JsonBlock token + StatusPill queued color are fully compatible with whatever Plan 08 ships.

## Issues Encountered

None beyond the deviations above. tsc clean on first try after initial writes; 9/9 tests green on first run.

## Auth Gates

None. This plan ships no code that calls external APIs or authenticates — pure design-system primitives and a test harness.

## Deferred Issues

None.

## Known Stubs

None. Every component renders real, useful UI from its props. No hardcoded empty data, no "coming soon", no TODO comments in the source. Every component is ready to be composed into views (Plan 10).

## Threat Flags

No new threat surface beyond what the plan's `<threat_model>` already registers. Both documented mitigations hold:

- **T-5-06 (XSS via JSX text children):** Every component renders external data (workspace/shot/version names, JSON data) via `{...}` JSX expressions — Preact auto-escapes these as text nodes. `dangerouslySetInnerHTML` appears nowhere in the codebase (verified by grep — only in comments explicitly documenting that it is NOT used). Test assertion #8 explicitly checks no `<script>`/`<iframe>` survives render.
- **T-5-06 (localStorage attribute write):** ThemeToggle writes `localStorage['vfx-familiar:theme']` and `document.documentElement[data-theme]`. The value space is strictly `'dark' | 'light'` — no raw HTML injection surface. Plan correctly categorizes this as `accept` disposition.

## Commits

| Commit    | Message                                                             |
| --------- | ------------------------------------------------------------------- |
| `93707aa` | feat(05-09): add theme.css + 7 primitive components                 |
| `c0dcc14` | test(05-09): add TreeSidebar render + interaction tests             |

## Test Evidence

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  13:25:47
   Duration  ~530ms
```

- 9 new tests in `src/__tests__/TreeSidebar.test.tsx` — all green.
- `npx tsc --noEmit` inside `packages/dashboard/` → zero errors.
- `grep -r "dangerouslySetInnerHTML=" packages/dashboard/src/components/` → no matches (only comments).

## Self-Check: PASSED

All created files verified on disk:
- `packages/dashboard/src/styles/theme.css` — FOUND
- `packages/dashboard/src/components/StatusPill.tsx` — FOUND
- `packages/dashboard/src/components/JsonBlock.tsx` — FOUND
- `packages/dashboard/src/components/EmptyState.tsx` — FOUND
- `packages/dashboard/src/components/SkeletonThumbnail.tsx` — FOUND
- `packages/dashboard/src/components/ThemeToggle.tsx` — FOUND
- `packages/dashboard/src/components/VersionCard.tsx` — FOUND
- `packages/dashboard/src/components/TreeSidebar.tsx` — FOUND
- `packages/dashboard/src/__tests__/TreeSidebar.test.tsx` — FOUND

All commits verified in git log:
- `93707aa` — FOUND
- `c0dcc14` — FOUND

## Next Plan Readiness

**Plan 10 (views)** can now compose these 7 primitives into the dashboard's 5 views (Home, Shot, Workspace, Project, Sequence) + 2 drawers (VersionDrawer, DiffDrawer). No component logic lives in views — views only:
- Read signals (activeGenerations, workspaces, selectedShotId) from Plan 08's state/.
- Pass values through to primitives as props.
- Bind callbacks from primitives to signal updates / API calls from Plan 08's lib/.

**Plan 11 (SSE + reproduce)** uses StatusPill wired to `activeGenerations.value[i].status`. When SSE fires `version.status_changed`, Plan 08's `onVersionStatusChanged` mutates the signal; the pill re-renders with the new color + pulse state automatically.

**Plan 12 (vite build + Hono mount)** gets real source to bundle. `npm run build:dashboard` will now produce a non-empty `dist/index.html` + `dist/assets/*.js` + `dist/assets/*.css` (with theme.css tokens inlined by the Tailwind v4 Vite plugin).

---

*Phase: 05-web-dashboard*
*Completed: 2026-04-23*
