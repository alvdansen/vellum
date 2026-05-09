---
phase: 19-ai-conversational-summary
plan: 06
subsystem: ui

tags: [preact, dashboard, summary-section, regenerate-button, accessibility, tdd]

# Dependency graph
requires:
  - phase: 19-ai-conversational-summary
    provides: Engine.summarizeVersion 8-outcome facade + HTTP routes + summarySignal/fetchSummary state surface (Plans 04-05)
  - phase: 12-reproduce-divergence
    provides: WarningPill component (verbatim reuse for SUM-06 fallback marker)
  - phase: 14-c2pa-manifest-emission
    provides: Auto-fetch + alive cancellation pattern (mirrored verbatim by summary auto-fetch)
  - phase: 17-thumbnail-skeleton-shimmer
    provides: animate-skeleton-shimmer keyframe (reused for the 3-line skeleton)
  - phase: 18-sortable-folder-dropdown
    provides: lib/copy.ts named-constant pattern (extended with 11 new Phase 19 constants)

provides:
  - SummarySection.tsx — 4-state discriminated render component (loading skeleton / success / fallback / error) with WarningPill + RegenerateButton + SUM-07 children disclosure slot
  - RegenerateButton.tsx — pure presentational button with 3 render states (default / cooldown / fetching), 1Hz countdown via setInterval, ARIA contract + interval cleanup
  - lib/copy.ts — 11 new named-constant Phase 19 copy strings (SUMMARY_HEADING, PROVENANCE_HEADING, SUMMARY_DISCLOSURE_TOGGLE, REGENERATE_BUTTON_LABEL/FETCHING, WARNING_PILL_FALLBACK_LABEL/ARIA, SUMMARY_ERROR_FALLBACK, SUMMARY_FIRST_USE_DISCLOSURE/LOCALSTORAGE_KEY) + 2 helper functions (regenerateButtonAriaLabel, regenerateButtonCooldownLabel)
  - VersionDrawer.tsx — 3 surgical changes wiring SummarySection above Output, relocating Provenance into a collapsed <details> disclosure (SUM-07), and adding summary auto-fetch + 500ms-debounced Regenerate handler + D-PRIV-2 first-use localStorage gate
  - 44 new dashboard tests (12 RegenerateButton + 16 SummarySection + 16 VersionDrawer Phase 19) — DOM-stability invariant (D-FB-6 / BLOCKER #4 revision-1) verified at the component layer

affects:
  - phase: 19-07 (eval suite consumes the SUM-01..06 user-facing surface end-to-end)
  - phase: 19-08 (HUMAN-UAT.md + ADVERSARIAL-REVIEW.md reference the dashboard surface)
  - future: any planner adding new dashboard components needs the named-constant copy pattern + the architecture-purity (D-WEBUI-31) discipline preserved here

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discriminated-state render — branched JSX on summary.state (4 branches) mirrors C2paBadge.tsx Phase 14 precedent"
    - "1Hz countdown timer via useEffect+setInterval keyed on regenerateAvailableAtMs (NOT on the tick `now` variable to avoid teardown/setup loops in fake-timer test environments)"
    - "T-5-06 XSS guard via Preact text-child interpolation only — zero dangerouslySetInnerHTML usage; all 4 dynamic-text render paths use {summary.text} JSX text nodes"
    - "DOM-stability invariant testing — structural fingerprint (tag + class + child-tag list) as a deterministic proxy for visual-height invariance under jsdom"
    - "In-memory localStorage polyfill (vi.stubGlobal) — required since Node 25+ ships a no-op native localStorage that shadows jsdom's implementation"

key-files:
  created:
    - "packages/dashboard/src/components/RegenerateButton.tsx"
    - "packages/dashboard/src/components/SummarySection.tsx"
    - "packages/dashboard/src/components/__tests__/RegenerateButton.test.tsx"
    - "packages/dashboard/src/components/__tests__/SummarySection.test.tsx"
    - "packages/dashboard/src/views/__tests__/VersionDrawer.test.tsx"
  modified:
    - "packages/dashboard/src/lib/copy.ts (+11 named constants + 2 helpers)"
    - "packages/dashboard/src/views/VersionDrawer.tsx (3 surgical changes per UI-SPEC)"

key-decisions:
  - "1Hz countdown effect deps: keyed on regenerateAvailableAtMs ALONE — using `now` as a dep would re-install the interval on every tick, breaking fake-timer-driven tests where each advance fires only one interval before teardown/setup re-keys the new interval. The effect samples Date.now() inside the interval callback; cooldown rendering naturally degrades to 0 once the deadline elapses."
  - "DOM-stability test uses structural fingerprint (tag/class/child-tag list) instead of pixel-height comparisons — jsdom returns 0 for all getBoundingClientRect.height calls, so structural fingerprint is the load-bearing invariant under the test environment. The pixel-height equality remains in the assertion (both return 0, the equality holds trivially), but the structural fingerprint is the meaningful contract under jsdom."
  - "Test-file location: Plan-specified components/__tests__/ and views/__tests__/ subdirectories. Vitest config already includes both `src/**/*.test.{ts,tsx}` AND `src/**/__tests__/**/*.test.{ts,tsx}` patterns, so both the existing src/__tests__/ tests AND the new subdirectory tests are picked up by the same test command."
  - "localStorage polyfill: reused the makeMemoryStorage pattern from src/__tests__/theme-persistence.test.ts verbatim — Node 25+ ships an experimental native localStorage that's a no-op without --localstorage-file, shadowing jsdom's working implementation. The polyfill is installed via vi.stubGlobal at file top BEFORE the VersionDrawer import so the useState initializer's read binds to the real implementation."

patterns-established:
  - "Pattern: Phase 19 named-constant copy strings — every visible string in the SummarySection / RegenerateButton flows through a named export from lib/copy.ts with a docstring citing the UI-SPEC § that locks the verbatim wording. Tests assert against the constants directly (no inline string literals in component or test code)."
  - "Pattern: SUM-07 children-slot disclosure — the relocated Provenance section is a <details> element inside SummarySection's children prop. The component itself owns no provenance domain knowledge — VersionDrawer composes the disclosure body and SummarySection just renders the children slot at the bottom of its DOM. Future planners can drop other content under the same disclosure pattern."
  - "Pattern: 500ms client-debounce + 60s server-throttle — useRef-backed last-click timestamp guards against rapid Regenerate clicks WITHOUT triggering re-renders. Pairs with the Plan 19-05 server-side 60s throttle for the 2-line defence against T-19-35 LLM-spam DoS."

requirements-completed:
  - SUM-01
  - SUM-04
  - SUM-06
  - SUM-07

# Metrics
duration: 27min
completed: 2026-05-09
---

# Phase 19 Plan 19-06: Dashboard Component Layer Summary

**SummarySection + RegenerateButton + VersionDrawer wiring — 4-state discriminated render with WarningPill reuse, SUM-07 children-slot disclosure, T-5-06 XSS guard, D-PRIV-2 first-use localStorage ack, and BLOCKER #4 D-FB-6 DOM-stability invariant verified at the component layer.**

## Performance

- **Duration:** ~27 min
- **Tasks:** 3
- **Files modified:** 7 (2 created components + 3 created test files + 1 modified copy.ts + 1 modified VersionDrawer.tsx)
- **Lines:** +1772 / -15
- **Test count delta:** +44 (12 RegenerateButton + 16 SummarySection + 16 VersionDrawer Phase 19); 273 dashboard tests now pass (was 229)

## Accomplishments

- **SummarySection.tsx** — thin-wrapper composition component with 4 discriminated render branches (loading skeleton / success prose / fallback WarningPill+text / error WarningPill+retry). Reuses Phase 12 `<WarningPill/>` verbatim (props-in only). T-5-06 XSS guard verified: every `{summary.text}` and `{SUMMARY_ERROR_FALLBACK}` render path uses Preact JSX text-child interpolation; zero `dangerouslySetInnerHTML` usage in either source or docstrings (verified by grep).
- **RegenerateButton.tsx** — pure presentational button with 3 render states (default / cooldown / fetching), 1Hz countdown via `setInterval` (text content tick — does NOT violate `prefers-reduced-motion: reduce` per UI-SPEC), native HTML `disabled` attribute (removes from tab order + blocks clicks), `aria-busy` toggle on fetch, interval cleanup on unmount.
- **lib/copy.ts** — extended with 11 named-constant Phase 19 copy strings + 2 helper functions for templated copy. Every visible label exported as a constant; tests assert against constant names verbatim.
- **VersionDrawer.tsx** — 3 surgical changes: `<SummarySection>` above Output, Provenance relocated inside a `<details>` disclosure (SUM-07 collapsed-by-default), summary auto-fetch via `useEffect([version.id])` mirroring Phase 14 C2PA pattern verbatim, `handleRegenerate` with 500ms client debounce + D-PRIV-2 localStorage first-use ack on first click.
- **D-FB-6 DOM-stability invariant verified** (BLOCKER #4 revision-1) — Test 16 in `SummarySection.test.tsx` mounts both `success` and `fallback` states and asserts header text is `'SUMMARY'` in both, header bounding-box height is identical (zero under jsdom; structural fingerprint is the load-bearing assertion), DOM slot ordering is identical (header is first child of section in both states; body element follows header in both branches). Test docstring cites D-FB-6 verbatim so cross-decision provenance is auditable from the test file alone.

## Task Commits

Each task was committed atomically:

1. **Task 1: copy.ts named constants + RegenerateButton + 12 tests** — `5ca78cc` (feat)
2. **Task 2: SummarySection + 16 tests including BLOCKER #4 D-FB-6** — `6bda3c4` (feat)
3. **Task 3: VersionDrawer 3 surgical changes + 16 tests** — `8ef8632` (feat)

## Files Created/Modified

- `packages/dashboard/src/components/RegenerateButton.tsx` — pure presentational button with 3 render states + 1Hz cooldown + ARIA contract + interval cleanup
- `packages/dashboard/src/components/SummarySection.tsx` — 4-state discriminated render with WarningPill reuse + skeleton block + SUM-07 children slot
- `packages/dashboard/src/components/__tests__/RegenerateButton.test.tsx` — 12 unit tests covering all render states, click handlers (enabled + disabled), ARIA wiring, fake-timer countdown ticking, unmount-cleanup invariants, tabular-nums for digit-jitter prevention
- `packages/dashboard/src/components/__tests__/SummarySection.test.tsx` — 16 unit tests covering all 4 render states, ARIA wiring (aria-labelledby + aria-busy + skeleton aria-hidden + role='presentation'), SUM-07 children-slot passthrough, D-PRIV-2 first-use disclosure gating, RegenerateButton wiring, T-5-06 `<script>`-string XSS round-trip, and D-FB-6 DOM-stability invariant
- `packages/dashboard/src/views/__tests__/VersionDrawer.test.tsx` — 16 integration tests covering auto-fetch on mount + version.id change, auto-fetch cancellation, Regenerate click → fetchSummary({ regenerate: true }), 500ms debounce, Provenance-inside-`<details>` structural contract, SummarySection above Output in DOM order, first-use disclosure localStorage gating, Regenerate-click auto-ack, defensive privacy-mode degradation, summarySignal mirroring, and error-state surfacing
- `packages/dashboard/src/lib/copy.ts` — added 11 named-constant exports + 2 helper functions for Phase 19 copy
- `packages/dashboard/src/views/VersionDrawer.tsx` — added imports + summary state hooks + auto-fetch effect + handleRegenerate + replaced standalone Provenance section with SummarySection containing a `<details>` disclosure children slot

## Decisions Made

- **1Hz countdown effect deps key**: keyed solely on `regenerateAvailableAtMs` rather than the standard `[regenerateAvailableAtMs, now]` pattern. Using `now` as a dep causes the effect to tear down + reinstall the interval on EVERY tick, which breaks fake-timer-driven tests because each `vi.advanceTimersByTimeAsync(N)` fires only one interval before teardown re-keys the new interval. The current shape samples `Date.now()` inside the interval callback, so the countdown still ticks correctly in real-time and the cooldown rendering degrades to 0 naturally once the deadline elapses.
- **Test path layout**: followed plan-specified `components/__tests__/` and `views/__tests__/` subdirectories. The existing dashboard convention (per Phase 17 / Phase 18) is `src/__tests__/`. Vitest config already includes both glob patterns, so both convention surfaces co-exist; the plan path keeps tests visually close to their components for the new Phase 19 surface.
- **localStorage polyfill**: reused the canonical `makeMemoryStorage` precedent from `src/__tests__/theme-persistence.test.ts`. Node 25+ ships an experimental native `localStorage` global that's a no-op without `--localstorage-file` and shadows jsdom's implementation; without the polyfill, `localStorage.setItem` is undefined inside tests despite being available at runtime in real browsers.
- **DOM-stability test under jsdom**: `getBoundingClientRect().height` returns 0 for every element under jsdom regardless of CSS, so the pixel-height assertion (`expect(fallbackHeight).toBe(successHeight)`) holds trivially. The load-bearing assertion is the structural fingerprint (tag + class + child-tag list), which is a deterministic proxy for visual-height invariance — if the success and fallback variants share an identical fingerprint, the rendered header height is identical by construction once stylesheets resolve.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing dashboard dependencies**
- **Found during:** Task 1 (vitest run-time)
- **Issue:** Worktree's `node_modules/` was empty — `@preact/preset-vite` not resolvable. Per project memory ("Run npm install after worktree merge"), the worktree's npm install does not sync main's `node_modules`.
- **Fix:** Ran `npm install` at the worktree root.
- **Files modified:** none (no source edits; only `node_modules/` populated)
- **Verification:** `npx vitest run` no longer throws `ERR_MODULE_NOT_FOUND`.

**2. [Rule 1 - Bug] RegenerateButton interval re-installed on every tick (test-only artifact)**
- **Found during:** Task 1 (Test 8 — countdown ticks down via fake timers)
- **Issue:** The plan's recommended `useEffect(...) , [regenerateAvailableAtMs, now]` deps array caused the interval to tear down and reinstall on every tick because `setNow(Date.now())` mutates `now`, retriggering the effect. Under `vi.useFakeTimers()`, each `vi.advanceTimersByTimeAsync(N)` only fires ONE interval before teardown — so a 2000ms advance after the first tick only shows ONE more decrement instead of two.
- **Fix:** Changed deps to `[regenerateAvailableAtMs]` only. The effect installs the interval once and keeps it running until either unmount or `regenerateAvailableAtMs` changes. The interval callback re-samples `Date.now()` every second; the cooldown rendering naturally degrades to 0 once the deadline elapses because `cooldownSeconds = Math.ceil((regenerateAvailableAtMs - now) / 1000)` floors to 0.
- **Files modified:** `packages/dashboard/src/components/RegenerateButton.tsx`
- **Verification:** Test 8 passes (`Regenerate (5s)` → after 1000ms `(4s)` → after 2000ms `(2s)`). All 12 RegenerateButton tests pass.

**3. [Rule 3 - Blocking] localStorage polyfill needed for VersionDrawer Phase 19 tests**
- **Found during:** Task 3 (VersionDrawer test run; Tests 10-13 failed with `localStorage.setItem is not a function`)
- **Issue:** Node 25+ ships an experimental native `localStorage` global that's a no-op without the `--localstorage-file` runtime flag. This native global shadows jsdom's working implementation, so `localStorage.setItem` evaluates to `undefined` inside the test file despite working in real browsers. The plan didn't anticipate this because the existing dashboard test corpus relies on the same polyfill (see `src/__tests__/theme-persistence.test.ts` verbatim precedent).
- **Fix:** Added an in-memory `makeMemoryStorage()` polyfill installed via `vi.stubGlobal('localStorage', ...)` at the top of `views/__tests__/VersionDrawer.test.tsx`, mirroring the canonical precedent verbatim. Test 13 (defensive — localStorage throws) was rewritten to use a temporary `vi.stubGlobal` swap to a throwing variant + restore on `finally`.
- **Files modified:** `packages/dashboard/src/views/__tests__/VersionDrawer.test.tsx`
- **Verification:** All 16 Task 3 tests pass; full dashboard suite green (273/273).

---

**Total deviations:** 3 auto-fixed (1 missing-dep blocking, 1 bug, 1 missing-polyfill blocking)
**Impact on plan:** All auto-fixes were necessary for tests to run. None changed the production component behavior or violated any acceptance criterion. No scope creep — the deviations are infrastructure (npm install, polyfill) + a single dep-array tightening that improved both test reliability AND production correctness (no spurious teardown/reinstall thrash).

## Issues Encountered

- **Pre-existing meta-test failures in root suite** (out of scope per SCOPE BOUNDARY rule): `src/__tests__/phase-attribution.test.ts`, `src/__tests__/requirements-cohort-closure.test.ts`, `src/__tests__/validation-flags.test.ts` — 20 failures total. Verified these failures exist at the base commit `c25cec2` BEFORE any Plan 19-06 work landed; they're related to ROADMAP.md / REQUIREMENTS.md attribution metadata and are NOT introduced by this plan. Logged for the Phase 19 orchestrator to pick up if relevant.

## User Setup Required

None — no external service configuration required for this plan. The dashboard component layer is purely client-side; the engine + HTTP routes (Plans 04-05) already require ANTHROPIC_API_KEY, but that's out of scope for the dashboard layer.

## Threat Surface Analysis

All plan-declared threats (T-19-33 through T-19-39) are addressed at the component layer:

- **T-19-33 (XSS via summary.text)**: Mitigated via Preact JSX text-child interpolation only. Zero `dangerouslySetInnerHTML` usage (verified by grep returning 0 matches in `SummarySection.tsx`). Test 15 round-trips `<script>alert('xss')</script>` through summary.text and asserts `document.querySelectorAll('script').length === 0`.
- **T-19-34 (first-use disclosure cross-tab leak)**: Accept disposition. localStorage is per-origin per-user-profile; the dismissal is UX nicety, not security state.
- **T-19-35 (Regenerate spam DoS)**: Mitigated via 500ms client debounce + Plan 19-05's 60s server throttle (2-line defence). Test 5 verifies two clicks within 500ms call fetchSummary once.
- **T-19-36 (localStorage key collision)**: Accept disposition. Key is namespaced `vfx-familiar:summary:first-use-acked`. Privacy-mode failures degrade gracefully via try/catch — Test 13 verifies handleRegenerate does not throw when localStorage.setItem rejects.
- **T-19-37 (versionId leak via auto-fetch)**: Accept disposition per CONTEXT.md. versionId is a nanoid (not security-sensitive); single-user demo scope per PROJECT.md.
- **T-19-38 (Provenance disclosure breaks UAT scripts)**: Mitigated. JsonBlock rendering is preserved verbatim; only the wrapping changes from `<section>` to `<details><summary>...</summary>`. Test 8 verifies `pre` elements with provenance JSON exist inside the disclosure body.
- **T-19-39 (Regenerate clicks during loading bypass debounce)**: Mitigated. RegenerateButton is `disabled` while `isFetching=true` (HTML disabled removes from tab order + blocks clicks). Test 6 in `RegenerateButton.test.tsx` verifies disabled-click is no-op.

No new threat surface flags — Plan 19-06 introduced zero new network endpoints, no new auth paths, no new file-access patterns, and no new schema changes at trust boundaries.

## Next Phase Readiness

- **Plan 19-07 ready**: Dashboard component layer complete. Plan 19-07 builds the eval suite + voice-quality fixtures consuming the SUM-01..06 user-facing surface end-to-end.
- **Plan 19-08 ready**: Telemetry + adversarial-review-class E2E tests can reference the dashboard surface artifacts directly (`SummarySection.tsx`, `VersionDrawer.tsx` integration).
- **Manual UAT (deferred to Plan 19-08 HUMAN-UAT.md)**: Voice quality, skeleton-shimmer aesthetic match, regenerate cooldown UX, first-use disclosure surfacing — all human-judgment territory; the structural shape is automated by this plan + Plan 19-07.

## Self-Check: PASSED

All declared artifacts and commits verified:

**Files (8/8 present):**
- ✓ `packages/dashboard/src/components/RegenerateButton.tsx`
- ✓ `packages/dashboard/src/components/SummarySection.tsx`
- ✓ `packages/dashboard/src/components/__tests__/RegenerateButton.test.tsx`
- ✓ `packages/dashboard/src/components/__tests__/SummarySection.test.tsx`
- ✓ `packages/dashboard/src/views/__tests__/VersionDrawer.test.tsx`
- ✓ `packages/dashboard/src/lib/copy.ts`
- ✓ `packages/dashboard/src/views/VersionDrawer.tsx`
- ✓ `.planning/phases/19-ai-conversational-summary/19-06-SUMMARY.md`

**Commits (3/3 present in git log):**
- ✓ `5ca78cc` — feat(19-06): add 11 named-constant copy strings + RegenerateButton component
- ✓ `6bda3c4` — feat(19-06): add SummarySection component with 4 discriminated render states
- ✓ `8ef8632` — feat(19-06): wire SummarySection into VersionDrawer + relocate Provenance disclosure

**Test counts (44 new dashboard tests, 273 total dashboard suite passing):**
- ✓ 12 RegenerateButton tests
- ✓ 16 SummarySection tests (incl. BLOCKER #4 D-FB-6 DOM-stability test)
- ✓ 16 VersionDrawer Phase 19 integration tests
- ✓ 15 pre-existing VersionDrawer tests still green
- ✓ Full dashboard suite: 26 test files, 273 tests, all green

**TypeScript:** `cd packages/dashboard && npx tsc --noEmit` exits 0 (clean).

---

*Phase: 19-ai-conversational-summary*
*Completed: 2026-05-09*
