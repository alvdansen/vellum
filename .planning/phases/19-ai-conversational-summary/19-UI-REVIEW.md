# Phase 19 — UI Review

**Audited:** 2026-05-11
**Baseline:** `19-UI-SPEC.md` (approved 2026-05-08; inherits 18-UI-SPEC → 17-UI-SPEC → 05-UI-SPEC)
**Screenshots:** not captured (no dev server detected on ports 3000 / 5173 / 8080) — code-only audit
**Stack:** Preact + Tailwind v4 (shadcn N/A; `components.json` absent — registry safety section skipped per agent contract)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | All 11 spec'd Phase 19 strings exist verbatim as named constants in `lib/copy.ts`; verb-first CTAs; SR-friendly ARIA labels. |
| 2. Visuals | 4/4 | Hierarchy correctly inverted (Summary first in drawer body); zero decorative chrome; WarningPill reused verbatim. |
| 3. Color | 4/4 | Zero new tokens; Regenerate accent matches View Diff verbatim; WCAG AA contrast preserved; no hardcoded colors in Phase 19 code. |
| 4. Typography | 4/4 | 2-weight ceiling preserved (400/600); 3 sizes total; `tabular-nums` correctly applied to cooldown countdown. |
| 5. Spacing | 3/4 | All Phase 19 classes on the 4/8 grid AND match documented half-grid exceptions, BUT the disclosure body drops the spec's prescribed `pl-4` (16px) left indent. |
| 6. Experience Design | 3/4 | All 4 states implemented; ARIA + debounce + cooldown all wired; BUT the SUM-07 `PROVENANCE` heading is DROPPED entirely (UI-SPEC requires the heading "visually intact"); no explicit focus-visible ring on Regenerate. |

**Overall: 22/24**

---

## Top 3 Priority Fixes

1. **Restore the dropped `PROVENANCE` heading above the disclosure (SUM-07 contract drift)** — UI-SPEC §"Updated primary visual anchors" → Provenance row says: *"the existing `<section>` keeps its `<h3 class="label-uppercase mb-2">Provenance</h3>` heading visually intact, but the `<ul>` body wraps in `<details>`."* The actual implementation in `VersionDrawer.tsx:354-371` puts the bare `<details>` directly inside `SummarySection`'s children slot — there is no `<h3>PROVENANCE</h3>` heading at all. **User impact:** users skimming the drawer for "where did the raw provenance go?" lose the visual anchor; the existing `PROVENANCE_HEADING` constant in `copy.ts:117` is exported but unused. **Concrete fix:** wrap the `<details>` in a `<section>` (or unwrapped div) with `<h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">{PROVENANCE_HEADING}</h3>` above the `<details>` element — matches the verbatim UI-SPEC contract and consumes the already-exported constant.

2. **Add the spec'd 16px left indent (`pl-4`) on the disclosure body** — UI-SPEC §"Spacing Scale" → "Disclosure body padding" row: *"`pt-2 pl-4` (8px top, 16px left indent) — 16px left indent gives the existing provenance `<ul class="flex flex-col gap-2">` rendering visual separation from the disclosure boundary; matches Phase 5 nested-content rhythm."* The actual implementation in `VersionDrawer.tsx:359, 363` uses only `mt-2` (8px top); there is no left indent. **User impact:** when expanded, the JsonBlock list visually attaches to the left edge instead of indenting under the disclosure summary, breaking the parent/child visual relationship. **Concrete fix:** change `<div class="mt-2">` and `<ul class="mt-2 flex flex-col gap-2">` to `<div class="pt-2 pl-4">` and `<ul class="pt-2 pl-4 flex flex-col gap-2">` — exactly two class changes.

3. **Add an explicit `focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]` to RegenerateButton** — UI-SPEC §"Hover/focus states" Regenerate-button focus-visible row: *"Browser default focus ring (executor MAY apply 2px accent outline matching Phase 5 keyboard baseline if browser default is too subtle)."* Sister components `LoadMoreButton.tsx:108` and `SortDropdown.tsx:227` BOTH carry this exact utility; the View Diff button at `VersionDrawer.tsx:327` also lacks it (pre-existing inconsistency Phase 19 inherits). **User impact:** on a saturated accent fill, the browser default focus ring is sometimes invisible — keyboard-only users may lose track of focus. **Concrete fix:** append `focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]` to the `baseClass` literal in `RegenerateButton.tsx:104`. Mirrors LoadMoreButton precedent verbatim. Optionally apply the same to `VersionDrawer.tsx:327` View Diff button for full visual consistency (out-of-scope but pre-existing gap).

---

## Detailed Findings

### Pillar 1: Copywriting (4/4) — PASS

**Evidence:**
- All 11 Phase 19 NEW visible strings exist as named-constant exports in `packages/dashboard/src/lib/copy.ts:110-167`:
  - `SUMMARY_HEADING = 'SUMMARY'` (line 110) ✓ matches UI-SPEC §"Section heading" verbatim
  - `PROVENANCE_HEADING = 'PROVENANCE'` (line 117) ✓ exported but **currently unused** — see Pillar 6 finding
  - `SUMMARY_DISCLOSURE_TOGGLE = 'Show provenance details'` (line 125) ✓ matches REQUIREMENTS.md SUM-07 verbatim
  - `REGENERATE_BUTTON_LABEL = 'Regenerate'` (line 128) ✓ matches UI-SPEC verbatim
  - `REGENERATE_BUTTON_FETCHING = 'Regenerating…'` (line 135) ✓ U+2026 ellipsis (not `...`) matches Phase 18 LOAD_MORE_LOADING_LABEL tone
  - `WARNING_PILL_FALLBACK_LABEL = 'AI summary unavailable'` (line 138) ✓ matches UI-SPEC verbatim
  - `WARNING_PILL_FALLBACK_ARIA = 'AI summary unavailable; showing structured details'` (line 144-145) ✓ matches REQUIREMENTS.md SUM-06 verbatim
  - `SUMMARY_ERROR_FALLBACK = '(AI summary unavailable; please retry.)'` (line 151) ✓ matches UI-SPEC verbatim
  - `SUMMARY_FIRST_USE_DISCLOSURE = 'AI summary uses your prompt text'` (line 159) ✓ matches CONTEXT.md D-PRIV-2 verbatim
  - `SUMMARY_FIRST_USE_LOCALSTORAGE_KEY = 'vfx-familiar:summary:first-use-acked'` (line 167) ✓ namespaced per UI-SPEC
  - 2 helper templates: `regenerateButtonAriaLabel(versionLabel)` (line 173) and `regenerateButtonCooldownLabel(cooldownSeconds)` (line 182) ✓ both produce the spec'd templates verbatim
- Tabular-nums explicitly noted in cooldown helper docstring; applied via Tailwind utility on RegenerateButton.tsx:104.
- Generic-CTA grep across `src/**/*.{tsx,ts}` returns ZERO matches for Submit/Click Here/OK/Cancel/Save in user-facing surfaces.
- Network/throttle error template at `src/__tests__/getSummary.test.ts:257` (`'Regenerate throttled — try again in 30s'`) is test-only synthetic and never surfaces to UI per Plan 19-05's "no toast — silent fallback" contract.

**No findings to escalate.** Pillar 4/4.

### Pillar 2: Visuals (4/4) — PASS

**Evidence:**
- **Hierarchy correctly inverted** per UI-SPEC §"Hierarchy enforcement rules" #1: `VersionDrawer.tsx:347-372` renders `<SummarySection/>` as the FIRST child of the drawer body, IMMEDIATELY below the `<header>` and ABOVE the conditional Output `<section>` at line 374. Document order: header → summary → output → reproduction-comparison → timeline.
- **Zero decorative chrome on the summary block** per UI-SPEC §"Hierarchy enforcement rules" #2: `SummarySection.tsx:97` container class = `bg-[var(--color-surface)] p-3 rounded` — no border, no shadow, no badge, no decorative icon. Matches the existing Timeline `<ul>` rounding pattern at `VersionDrawer.tsx:445`.
- **WarningPill reused verbatim** per UI-SPEC §"Component Inventory": `SummarySection.tsx:147-149` and `:161-163` invoke `<WarningPill/>` (Phase 12 component) with `WARNING_PILL_FALLBACK_LABEL` + `WARNING_PILL_FALLBACK_ARIA` props. The `WarningPill.tsx:35` class string is unmodified — props-in only.
- **Sentence-shaped skeleton** per UI-SPEC §"Inline 3-line skeleton block": `SummarySection.tsx:189-199` renders three stacked bars with widths `w-[95%]` / `w-full` / `w-3/5` (≈ 95% / 100% / 60%) at `h-[14px]` height — exactly matches the spec.
- **Optional `RotateCw` icon dropped per planner discretion**, allowed by UI-SPEC §"Icon library": *"planner may drop it for a text-only button if visual weight feels excessive."* `lucide-preact` is imported only by `TreeSidebar.tsx`, `ThemeToggle.tsx`, `SortDropdown.tsx` — NOT by RegenerateButton. The text-only Regenerate button is contract-compliant.
- **DOM-stability invariant locked** per BLOCKER #4 / D-FB-6: success and fallback states share an identical structural fingerprint (header + body), verified by `SummarySection.test.tsx` Test 16.

**No findings to escalate.** Pillar 4/4.

### Pillar 3: Color (4/4) — PASS

**Evidence:**
- **Zero new color tokens introduced** per UI-SPEC §"Color": every visual element references existing tokens from Phase 5's `theme.css`.
- **Phase 19 component color audit (only theme tokens):**
  - `SummarySection.tsx:97` → `bg-[var(--color-surface)]` (card surface — UI-SPEC matrix line 114)
  - `SummarySection.tsx:109` → `text-[var(--color-fg-muted)]` (heading — UI-SPEC matrix line 117)
  - `SummarySection.tsx:137, 151, 166` → `text-[var(--color-fg)]` (body — UI-SPEC matrix lines 115-116; SAME color in success AND fallback per "no tonal color shift")
  - `SummarySection.tsx:195-197` → `bg-[var(--color-border-subtle)]` (skeleton — UI-SPEC matrix line 123)
  - `RegenerateButton.tsx:104` → `bg-[var(--color-accent)]` + `text-[var(--color-bg)]` (matches View Diff button at `VersionDrawer.tsx:327` verbatim — UI-SPEC matrix line 118-122)
- **No hardcoded hex/rgb/rgba in Phase 19 components.** The only hardcoded color in dashboard `.tsx` files is `C2paShield.tsx:71, 86, 87, 93` — D-08 brand-token exception introduced by Phase 17, NOT by Phase 19.
- **Accent visual mass check:** dashboard-wide `--color-accent` usage = 9 unique elements (App nav link, VersionCard selected ring + selected fill, TreeSidebar selected fill, RegenerateButton, LoadMoreButton focus-ring, SortDropdown focus-ring + selected option, View Diff button). Phase 19 adds exactly ONE entry (Regenerate CTA) per UI-SPEC §"Accent reserved for". Within budget.
- **Theme adaptation:** all classes use `var(--color-*)` so the `[data-theme="light"]` override on `<html>` automatically swaps tokens (per UI-SPEC §"Color guarantees" #1).
- **Skeleton uses existing `animate-skeleton-shimmer` keyframe verbatim** per UI-SPEC §"Color guarantees" #3 — no new keyframes.

**No findings to escalate.** Pillar 4/4.

### Pillar 4: Typography (4/4) — PASS

**Evidence:**
- **Distinct font sizes in use across the dashboard:** `text-xs` (12px, 14 occurrences), `text-sm` (14px, 15 occurrences), `text-base` (16px, 2 occurrences) — only **3 sizes** total, well under the 4-size soft cap. Phase 19 uses ONLY `text-xs` (heading + Regenerate button + first-use disclosure) and `text-sm` (summary body + disclosure summary). No size proliferation.
- **Distinct font weights in use across the dashboard:** `font-normal` (8 occurrences) + `font-semibold` (3 occurrences) — exactly the **2-weight ceiling** preserved per UI-SPEC §"Typography" *"Weights ceiling preserved: exactly 2 weights (400 + 600)."* Phase 19 uses ONLY `font-normal`.
- **`tabular-nums` correctly applied** per UI-SPEC §"Tabular numerics": `RegenerateButton.tsx:104` carries the `tabular-nums` Tailwind utility on the entire button class string. Cooldown countdown digit (`Regenerate (53s)`) does not jitter as the timer decrements.
- **`label-uppercase` heading utility correctly used** per UI-SPEC §"Typography" Body row: `SummarySection.tsx:109` heading class = `label-uppercase text-[var(--color-fg-muted)]` — matches existing `OUTPUT`/`TIMELINE` headings at `VersionDrawer.tsx:376, 444` verbatim. Same Phase 5 inheritance.
- **Disclosure summary text** per UI-SPEC §"Typography" Body row: `VersionDrawer.tsx:355` summary class = `cursor-pointer text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]` — 14px body size + muted-default + foreground-on-hover. Matches `<TreeRow/>` hover treatment per spec.

**No findings to escalate.** Pillar 4/4.

### Pillar 5: Spacing (3/4) — WARNING

**Evidence — passing:**
- All Phase 19 spacing classes land on the documented 4/8 grid (with the explicit half-grid exceptions UI-SPEC calls out):
  - **Top spacing distribution (top 11):** `gap-2` (16x), `px-2` (10x), `gap-1` (9x), `mb-2` (8x), `py-2` (7x), `py-1` (6x), `p-3` (5x), `mt-2` (5x), `px-4` (4x), `px-3` (3x), `p-4` (3x). All clean 4-multiples.
  - **Phase 19 specific values:** `p-3` (12px card padding — matches Timeline `<ul>` precedent per UI-SPEC line 65); `gap-1.5` (6px skeleton gap — matches UI-SPEC line 75); `mb-2` (8px header bottom — matches UI-SPEC line 69); `gap-2` (8px header gap — matches UI-SPEC line 69); `mt-2` (8px between WarningPill and body — matches UI-SPEC line 312 "mb-2 spacing").
- **Arbitrary values audit:** `h-[14px] w-[95%]` on skeleton bars at `SummarySection.tsx:195-197` — explicitly authorized by UI-SPEC §"Inline 3-line skeleton block" line 75 (*"3 stacked horizontal bars at 14px height (matches body line-height); widths randomized 95% / 100% / 60% to evoke sentence shape"*). `min-w-[200px]` on LoadMoreButton + `min-w-[180px]` on SortDropdown popover are pre-existing Phase 17/18 elements, not introduced by Phase 19.
- **Header strip pattern** per UI-SPEC §"Header strip" line 69: `SummarySection.tsx:106` header class = `flex items-center justify-between gap-2 mb-2` — exact verbatim match.

**Evidence — failing:**
- **WARNING — Disclosure body padding deviates from UI-SPEC.** UI-SPEC §"Spacing Scale" Disclosure-body row prescribes `pt-2 pl-4` (8px top, 16px left indent). The actual implementation at `VersionDrawer.tsx:359, 363` uses only `mt-2` (8px top equivalent) — the `pl-4` (16px left indent) is missing entirely. The spec rationale: *"16px left indent gives the existing provenance `<ul class="flex flex-col gap-2">` rendering visual separation from the disclosure boundary; matches Phase 5 nested-content rhythm."* The current implementation lets the JsonBlock list attach flush to the left edge instead of nesting visually under the disclosure summary.
  - **Fix:** change line 359 `<div class="mt-2">` → `<div class="pt-2 pl-4">`; line 363 `<ul class="mt-2 flex flex-col gap-2">` → `<ul class="pt-2 pl-4 flex flex-col gap-2">`. Two-class fix.

**Pillar 3/4 — one specific contract drift; no proliferation issues, no arbitrary-value abuse.**

### Pillar 6: Experience Design (3/4) — WARNING

**Evidence — passing:**
- **All 4 discriminated states implemented** per UI-SPEC §"Render contract" table:
  - `'loading'` → 3-line skeleton via `<SummarySkeleton/>` at `SummarySection.tsx:133, 187-200`
  - `'success'` → body `<p>` at `SummarySection.tsx:135-142`
  - `'fallback'` → WarningPill + body `<p>` at `SummarySection.tsx:144-157`
  - `'error'` → WarningPill + `SUMMARY_ERROR_FALLBACK` body at `SummarySection.tsx:159-172`
- **Auto-fetch lifecycle correctly mirrors Phase 14 C2PA pattern** per UI-SPEC §"Auto-fetch lifecycle": `VersionDrawer.tsx:182-198` uses `let alive = true` + cleanup function, identical shape to the C2PA effect at lines 159-173.
- **500ms client debounce + 60s server throttle** per UI-SPEC §"Click handling" + SUM-04: `VersionDrawer.tsx:200-233` `handleRegenerate` uses `lastRegenerateClickRef` for the 500ms debounce; the engine returns `regenerateAvailableAtMs` for the 60s cooldown; RegenerateButton `setInterval` ticks the countdown.
- **Accessibility contract complete** per UI-SPEC §"Accessibility Contract":
  - Section wrapper `aria-labelledby={headingId}` (`SummarySection.tsx:102`)
  - Heading `id={headingId}` (`SummarySection.tsx:108`)
  - `aria-busy={isLoading ? 'true' : 'false'}` (`SummarySection.tsx:103`)
  - Skeleton `role="presentation" aria-hidden="true"` (`SummarySection.tsx:191-192`)
  - RegenerateButton `aria-label`, `aria-busy`, native HTML `disabled` (`RegenerateButton.tsx:111-113`)
- **D-PRIV-2 first-use disclosure** correctly implemented per UI-SPEC §"One-time first-use disclosure": `VersionDrawer.tsx:117-128` reads localStorage with try/catch defensive fallback for privacy-mode browsers; `:213-220` dismisses on first Regenerate click; SummarySection prop-gates the muted note at `:121-130`.
- **SUM-07 disclosure** uses native `<details>/<summary>` for keyboard + SR-friendly toggle, collapsed-by-default (no `open` attribute) per UI-SPEC §"Disclosure" lines 638-643.
- **DOM-stability invariant** verified per BLOCKER #4 / D-FB-6 — success and fallback states share identical structural fingerprint (header + body), so layout doesn't reflow between states.
- **Defensive contracts at all 3 layers:** lib/api collapses errors to envelopes; state/summaries.fetchSummary NEVER throws; SummarySection has `'error'` discriminator render branch.
- **T-5-06 / T-19-33 XSS guard:** zero `dangerouslySetInnerHTML` in `SummarySection.tsx` (verified by grep; only docstring mentions in comment context). All dynamic text flows through Preact JSX text-child interpolation.

**Evidence — failing:**
- **BLOCKER — `PROVENANCE` heading dropped entirely.** UI-SPEC §"Updated primary visual anchors" Provenance row line 173 says: *"the existing `<section>` keeps its `<h3 class="label-uppercase mb-2">Provenance</h3>` heading visually intact, but the `<ul>` body wraps in `<details>`."* The Phase 19 implementation in `VersionDrawer.tsx:354-371` puts the bare `<details>` directly inside `SummarySection`'s children slot — the `<h3>PROVENANCE</h3>` heading does not render anywhere. The exported `PROVENANCE_HEADING = 'PROVENANCE'` constant in `copy.ts:117` is unused. **User impact:** users searching for "where did the raw provenance go?" lose the visual anchor; the visible cue is just `Show provenance details` which under-communicates that the content is the same Provenance section, just collapsed. **Fix:** wrap `<details>` in either a fragment or a div, with `<h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">{PROVENANCE_HEADING}</h3>` immediately above (mirrors `OUTPUT`/`TIMELINE` heading rhythm at `VersionDrawer.tsx:376, 444`). Also update the integration tests that assert disclosure structure to match.
- **WARNING — RegenerateButton has no explicit focus-visible ring.** UI-SPEC §"Hover/focus states" line 708 says: *"Browser default focus ring (executor MAY apply 2px accent outline matching Phase 5 keyboard baseline if browser default is too subtle)."* Sister components (`LoadMoreButton.tsx:108`, `SortDropdown.tsx:227`) both apply `focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]`. RegenerateButton's accent-on-accent fill makes browser default ring particularly hard to see. **User impact:** keyboard-only users may lose track of focus when tabbing through drawer header → SummarySection. **Fix:** append `focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]` to the `baseClass` literal in `RegenerateButton.tsx:104`.

**Pillar 3/4 — one BLOCKER (heading drop) + one WARNING (focus ring).**

---

## Additional Observations (not pillar-affecting)

- **Test coverage strong:** 44 new dashboard tests cover all 4 render branches, ARIA wiring, debounce, cooldown, localStorage gating, XSS round-trip, DOM-stability invariant. 273 total dashboard tests pass.
- **Architecture purity preserved:** `state/summaries.ts` has zero server-tree imports (only `@preact/signals` + `../lib/api.js`); verified by grep.
- **The View Diff button at `VersionDrawer.tsx:327` ALSO lacks `focus-visible:ring-*`** — pre-existing inconsistency, NOT introduced by Phase 19, but flagged because the same fix would close both gaps in one edit.
- **The skeleton block uses bracket-arbitrary widths but they round-trip cleanly** — `w-[95%]` is on the documented half-grid acceptable per UI-SPEC for "fine typographic spacing per Phase 5 precedent" and explicitly authorized for the skeleton layout.
- **Disclosure `mt-4` (16px top) on the `<details>` element** at `VersionDrawer.tsx:354` — UI-SPEC does not explicitly call out spacing between SummarySection body and the children-slot disclosure; `mt-4` reads correctly as a "section break" between the AI summary prose and the structural detail nest. Acceptable researcher-discretion territory.

---

## Files Audited

- `/Users/macapple/comfyui-vfx-mcp/packages/dashboard/src/components/SummarySection.tsx` (200 lines)
- `/Users/macapple/comfyui-vfx-mcp/packages/dashboard/src/components/RegenerateButton.tsx` (120 lines)
- `/Users/macapple/comfyui-vfx-mcp/packages/dashboard/src/views/VersionDrawer.tsx` (498 lines — focus on Phase 19 modifications at lines 32, 41-49, 105-133, 175-241, 347-372)
- `/Users/macapple/comfyui-vfx-mcp/packages/dashboard/src/lib/copy.ts` (184 lines — focus on Phase 19 additions at lines 105-184)
- `/Users/macapple/comfyui-vfx-mcp/packages/dashboard/src/state/summaries.ts` (128 lines)
- `/Users/macapple/comfyui-vfx-mcp/packages/dashboard/src/components/WarningPill.tsx` (44 lines, reused verbatim)

**Cross-reference baseline:**
- `/Users/macapple/comfyui-vfx-mcp/.planning/phases/19-ai-conversational-summary/19-UI-SPEC.md` (approved design contract)
- `/Users/macapple/comfyui-vfx-mcp/.planning/phases/19-ai-conversational-summary/19-CONTEXT.md` (locked decisions D-PRIV-1..5, D-LLM-1..6, D-FB-1..6, D-VAL-1..4)
- `/Users/macapple/comfyui-vfx-mcp/.planning/phases/19-ai-conversational-summary/19-{01..08}-SUMMARY.md` (8 execution summaries)
