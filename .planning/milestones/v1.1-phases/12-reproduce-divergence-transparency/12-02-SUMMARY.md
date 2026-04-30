---
phase: 12-reproduce-divergence-transparency
plan: 02
subsystem: ui

tags: [preact, tailwind, vite, version-drawer, divergence, demo-03, reproduction-warnings, dashboard-ux, c2pa-prep]

# Dependency graph
requires:
  - phase: 12-reproduce-divergence-transparency
    plan: 01
    provides: "DiffResponse.reproduction_divergence field shape (D-CTX-4) on /api/versions/:id/diff — sha256_mismatch + warnings + present-flags"
  - phase: 05-dashboard
    provides: "VersionDrawer right-rail dialog with lazy-fetch provenance + handleViewDiff opening DiffDrawer; StatusPill primitive (rounded-full + uppercase tracking design language)"
provides:
  - "WarningPill component — amber/yellow advisory pill primitive bound to --color-status-running token (no new design tokens). Free-form label + ariaLabel props, role='status' for assistive tech, data-testid='warning-pill' for integration tests."
  - "Version.lineage_type extension on dashboard-local entity type — optional 'reproduce' | 'iterate' | null. Legacy rows + originals carry null/undefined."
  - "VersionDrawer auto-fetch effect — on mount when version.lineage_type === 'reproduce' AND priorVersion !== null, calls diffVersion and stores reproduction_divergence in shared diff state (single fetch per drawer-open via diff !== null guard, T-12-10 mitigation)."
  - "VersionDrawer WarningPill conditional render — pill renders iff diff?.reproduction_divergence != null. Hardcoded ariaLabel 'non-deterministic — outputs may differ from parent'."
  - "VersionDrawer side-by-side comparison block — data-testid='reproduction-comparison' section renders iff parent_output_present && reproduction_output_present && priorVersion. Two <figure> elements with parent + reproduction <img> + version-label captions."
  - "Criterion #4 closure at the dashboard boundary — reproduction_divergence === null yields no pill and no block (drawer identical to a non-reproduce drawer)."
affects: [13-model-fingerprinting, 14-c2pa-manifest]

# Tech tracking
tech-stack:
  added: []  # Pure Preact + Tailwind v4; uses existing @testing-library/preact for tests
  patterns:
    - "Auto-fetch on drawer mount with shared state slot — useEffect keyed on [version.id, priorVersion?.id, version.lineage_type], early-returns on diff !== null so View Diff click reuses prefetch"
    - "Conditional render on optional engine signal — diff?.reproduction_divergence != null + parent_output_present + reproduction_output_present compose to four UI states from a single field"
    - "Dashboard-local interface duplication — ReproductionDivergence shape duplicated in VersionDrawer.tsx per D-WEBUI-31 (zero server imports under packages/dashboard/src/**), matches engine layer src/types/provenance.ts verbatim"
    - "WarningPill bound to existing --color-status-running token — reuses the amber palette already proven for the running status pill, avoids new design-token churn"

key-files:
  created:
    - packages/dashboard/src/components/WarningPill.tsx
    - packages/dashboard/src/__tests__/WarningPill.test.tsx
    - packages/dashboard/src/__tests__/VersionDrawer.test.tsx
  modified:
    - packages/dashboard/src/types/entities.ts
    - packages/dashboard/src/views/VersionDrawer.tsx
    - packages/dashboard/dist/index.html
    - packages/dashboard/dist/assets/index-9jVH_ewj.js
    - packages/dashboard/dist/assets/index-BvSMiPtf.css
    - .planning/REQUIREMENTS.md

key-decisions:
  - "WarningPill binds to existing --color-status-running amber token rather than introducing new --color-warning. Mirrors the running status pill's color exactly — runtime amber/yellow distinction is signaled to assistive tech via role='status' + aria-label, not by hue alone."
  - "Auto-fetch effect deps array intentionally excludes `diff` — including it would retrigger the effect on every successful fetch and cause infinite refetch under StrictMode. The `if (diff !== null) return` guard inside the body handles the re-render-with-already-loaded case (T-12-10 mitigation)."
  - "ReproductionDivergence interface duplicated in VersionDrawer.tsx (not imported from server tree) per D-WEBUI-31. Adds 8 lines of duplication; preserves the architecture invariant that the dashboard is a transport-only consumer."
  - "Pill text 'non-deterministic' is hardcoded in the WarningPill default; ariaLabel 'non-deterministic — outputs may differ from parent' is hardcoded by the VersionDrawer caller. T-12-11 disposition: no user-controlled data flows into the pill text — XSS surface = 0."
  - "Comparison block <img> srcs reuse getOutputUrl which targets /api/versions/:id/output (existing Phase 5 route). T-12-08 disposition accepted: same auth posture as the existing single-output render — no new disclosure surface."

patterns-established:
  - "Mounting effect with shared state slot pattern: useEffect for auto-fetch + same `diff` state used by handleViewDiff click handler; the click handler's `if (!diff)` guard naturally handles prefetch reuse without code duplication. Single round-trip per drawer-open guaranteed."
  - "Engine→dashboard signal propagation pattern: optional `?` field on diff envelope (engine side), nullable interface field with default `null` (dashboard side), conditional JSX renders gated by `!= null` checks. Adding a new signal in this family means: 1 engine field + 1 interface field + N JSX guards — no infrastructure churn."
  - "Test-driven divergence-state coverage: 4 UI states (a/b/c/d from CONTEXT.md success criteria) each get a dedicated integration test. Adding a 5th state means adding a 5th test — the pattern is already grooved."

requirements-completed: [DEMO-03]

# Metrics
duration: 6min
completed: 2026-04-30
---

# Phase 12 Plan 02: Reproduce Divergence Transparency — Dashboard Surfacing Summary

**WarningPill + VersionDrawer auto-fetch + side-by-side comparison block close DEMO-03 at the dashboard boundary: reproduce-lineage versions whose bytes drift from their parent OR carry partner-API non-determinism warnings now render an amber pill in the drawer header AND a parent-vs-reproduction <img> comparison block in the body, while bit-identical reproductions render neither (criterion #4).**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-30T09:15:29Z
- **Completed:** 2026-04-30T09:21:10Z
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 6 (3 dashboard src + 3 dist artifacts; ignoring REQUIREMENTS.md the metadata commit owns)

## Accomplishments

- WarningPill primitive lands at `packages/dashboard/src/components/WarningPill.tsx` (43 lines). Mirrors StatusPill's structural shape (rounded-full, uppercase tracking, --color-bg text on saturated background) but binds to the existing --color-status-running amber token — zero new design tokens introduced (CONTEXT.md "no new design tokens" honored). Carries `role="status"` + `aria-label` defaulting to `Warning: <label>` for assistive tech, plus `data-testid="warning-pill"` for stable integration-test selectors. The `.warning-pill` marker class lets theme overrides target the pill without grepping JSX.
- Dashboard `Version` type extended with optional + nullable `lineage_type: 'reproduce' | 'iterate' | null` — legacy rows and originals carry null/undefined, reproduce-lineage rows trigger the new auto-fetch effect.
- `VersionDrawer` gains a second `useEffect` keyed on `[version.id, priorVersion?.id, version.lineage_type]` that auto-fetches the diff envelope on mount when version is reproduce-lineage AND priorVersion exists. Reuses the same `diff` state slot as the existing "View Diff" button — a subsequent click finds `diff !== null` and short-circuits, guaranteeing a single round-trip per drawer-open (T-12-10 mitigation: `diff` deliberately excluded from the deps array; the body guard handles re-renders).
- WarningPill conditional render in the drawer header next to StatusPill: pill renders iff `diff?.reproduction_divergence != null`. Hardcoded label + ariaLabel — no user-controlled data flows into the pill text (T-12-11 disposition: XSS surface = 0).
- Side-by-side comparison block lands as a new `<section data-testid="reproduction-comparison">` between the existing Output section and the Timeline section. Renders iff `parent_output_present && reproduction_output_present && priorVersion`, contains two `<figure>` elements with parent + reproduction `<img>` + captions naming the version labels (e.g., "Parent (v001)" / "Reproduction (v002)"). T-12-08 disposition accepted: srcs reuse the existing `/api/versions/:id/output` route — same auth posture as the existing single-output render above the block.
- Criterion #4 (bit-identical reproductions show no pill + no block) closes at the dashboard boundary. The engine sends `reproduction_divergence: null` for matching bytes + empty warnings, and both conditional renders short-circuit on `null`. Drawer is structurally identical to a non-reproduce-lineage drawer in this case.
- Dashboard build pipeline stays green — `npx vite build` exits 0, ships a 41 kB JS bundle + 22 kB CSS. The build emitted new content-hashed bundle filenames; old `dist/assets/index-DG_Bi5i8.css` and `index-JFiMB5gT.js` were removed by Vite's `emptyOutDir`.

## Task Commits

Each task was committed atomically following the TDD RED → GREEN cycle:

1. **Task 1: WarningPill component + Version.lineage_type field** — `9cc5fb0` (feat)
   - Test commit + implementation commit bundled per project convention (single atomic task commit).
   - 5 component tests covering label default, custom label, amber/yellow/warning class, role + aria-label defaults, custom aria-label.
2. **Task 2: VersionDrawer auto-fetch + WarningPill render + comparison block** — `aceb493` (feat)
   - 6 integration tests covering all four UI states (criteria a/b/c/d) plus two guardrails (priorVersion=null no-fetch path, View Diff click reuses prefetch).
   - Includes rebuilt `dist/` artifacts (vite emit) so the runtime-served bundle reflects the source change.

**Plan metadata commit:** lands after this SUMMARY.md is written.

## Files Created/Modified

### Created

- `packages/dashboard/src/components/WarningPill.tsx` (43 lines) — pure Preact functional component, props-in / no callbacks. Renders `<span class="warning-pill ... bg-[var(--color-status-running)] ...">{label}</span>` with role="status" + aria-label.
- `packages/dashboard/src/__tests__/WarningPill.test.tsx` (50 lines) — 5 component tests via @testing-library/preact, asserts label rendering, custom-label override, amber/yellow/warning class match, role + aria-label defaults, custom aria-label override.
- `packages/dashboard/src/__tests__/VersionDrawer.test.tsx` (194 lines) — 6 integration tests via vi.mock of `../lib/api.js` (mocks getProvenance + diffVersion as vi.fn() spies, getOutputUrl as a deterministic id-based stringifier).

### Modified

- `packages/dashboard/src/types/entities.ts` (+8 lines) — added `lineage_type?: 'reproduce' | 'iterate' | null` to the `Version` interface with a doc-block tying it to Phase 12 / DEMO-03.
- `packages/dashboard/src/views/VersionDrawer.tsx` (+100 lines) — added `WarningPill` import, `ReproductionDivergence` interface (D-WEBUI-31 dashboard-side duplication), `reproduction_divergence` field on `DiffSummaryShape`, second `useEffect` for auto-fetch on reproduce-lineage drawer mount, WarningPill conditional render in header, side-by-side comparison block between Output and Timeline sections.
- `packages/dashboard/dist/index.html` — updated entry HTML referencing the new bundle hashes.
- `packages/dashboard/dist/assets/index-9jVH_ewj.js` — new 41 kB JS bundle (from vite build).
- `packages/dashboard/dist/assets/index-BvSMiPtf.css` — new 22 kB CSS bundle (from vite build).
- `.planning/REQUIREMENTS.md` — DEMO-03 checkbox flipped `[ ]` → `[x]`; Traceability table row flipped `Pending` → `Complete`.

### Deleted (Vite emptyOutDir)

- `packages/dashboard/dist/assets/index-DG_Bi5i8.css` — superseded by index-BvSMiPtf.css.
- `packages/dashboard/dist/assets/index-JFiMB5gT.js` — superseded by index-9jVH_ewj.js.

## Decisions Made

- **D-PLAN-12-02-1 — Bind WarningPill to existing --color-status-running token.** Avoids introducing a new --color-warning design token; the running status pill already proves amber/yellow against both light and dark themes for WCAG AA contrast (text is --color-bg). Runtime distinction between "this is a running version" and "this is a non-deterministic warning" comes from role + aria-label semantics + spatial context (header vs warning lozenge), not hue alone.
- **D-PLAN-12-02-2 — Auto-fetch effect deps array excludes `diff`.** Including `diff` in `[version.id, priorVersion?.id, version.lineage_type]` would refire the effect after every successful fetch and cause infinite refetch under StrictMode. The `if (diff !== null) return` guard inside the effect body handles the re-render-with-already-loaded case. ESLint's react-hooks/exhaustive-deps rule is suppressed locally with a comment naming the rationale.
- **D-PLAN-12-02-3 — Duplicate ReproductionDivergence interface dashboard-side.** D-WEBUI-31 forbids any import traversing into `src/types/...` from `packages/dashboard/src/...`. The 8-line interface duplication is the trade for keeping the dashboard a transport-only consumer of the engine's REST surface. The duplication lives at `packages/dashboard/src/views/VersionDrawer.tsx` lines 47-53 (next to `DiffSummaryShape` for spatial proximity).
- **D-PLAN-12-02-4 — Hardcoded label + ariaLabel.** Pill text 'non-deterministic' is the WarningPill component default; ariaLabel 'non-deterministic — outputs may differ from parent' is hardcoded at the VersionDrawer call site. T-12-11 disposition: no user-controlled data flows into the pill text — XSS surface = 0. If a future plan needs to surface specific divergence reasons (e.g., "sha256 mismatch detected" vs "warnings: ..."), the WarningPill already accepts a custom label without component change.

## Deviations from Plan

None — plan executed exactly as written.

The plan's reference to `bg-amber-500` (Tailwind v4 default palette) vs `bg-[var(--color-status-warning)]` (CSS-token variant) was decided in favor of the existing token (`--color-status-running` is amber per theme.css:51). The plan explicitly accepted both options ("If the project's Tailwind palette does not include amber-500, fall back to a CSS variable approach matching StatusPill style" — action 1.2) and the test regex `/amber|yellow|warning/` was designed to match either. The `.warning-pill` marker class added to the implementation satisfies the `/warning/` arm of the regex while keeping the design-token binding for the actual color.

## Issues Encountered

None. Tests went RED → GREEN cleanly with the planned implementation; no iteration on the auto-fetch effect logic or the conditional render guards. Vite build exited 0 on first run after the source change.

## Test Count Delta

- **Baseline (end of Plan 12-01):** 817 passing / 5 pre-existing failing / 3 skipped (root suite, `npx vitest run`).
- **After Plan 12-02 (root suite):** 817 passing / 5 pre-existing failing / 3 skipped — unchanged. The dashboard package is excluded from the root suite via `vitest.config.ts:exclude: ['packages/**', ...]` (Phase 5 D-WEBUI-08 isolation; root uses `environment: 'node'`, dashboard needs `jsdom`).
- **Dashboard suite (`cd packages/dashboard && npx vitest run`):** 47 → 58 passing (+11 tests).
  - WarningPill.test.tsx: +5
  - VersionDrawer.test.tsx: +6
- **Pre-existing 5 v1.1 ROADMAP-shape audit failures:** unchanged. Documented in `.planning/phases/10-migrate-on-boot-hardening/deferred-items.md`. Out of scope.

## DEMO-03 Cohort Closure

| Cohort step | Plan | Status |
|---|---|---|
| Engine layer — migration + diff field + write path | 12-01 | DONE |
| Dashboard surfacing — WarningPill + auto-fetch + comparison block | 12-02 | **DONE (this plan)** |

**ROADMAP success criterion #1** (pill renders on reproduce-lineage versions when warnings exist OR sha256 mismatch detected) closed at dashboard boundary by this plan.

**ROADMAP success criterion #2** (side-by-side parent-vs-reproduction `<img>` block when both outputs are on disk) closed at dashboard boundary by this plan.

**ROADMAP success criteria #3 + #4** were closed at the engine + tool boundary by Plan 12-01; this plan extends #4 closure to the dashboard render layer (`reproduction_divergence === null` → no pill, no block, drawer matches non-reproduce drawer exactly).

DEMO-03 marked complete in REQUIREMENTS.md (cohort-level requirement; both Plan 12-01 and Plan 12-02 needed to land before flipping the checkbox).

## Manual Smoke Checklist (for the verifier)

Boot the server with HTTP transport, then exercise the three reproduce-lineage states in the dashboard browser UI:

1. **Bit-identical reproduction (criterion #4 negative path).** Submit version, reproduce it, ensure the partner-API model is deterministic enough that bytes match on disk. Open the reproduction's drawer. Expect: no pill in the header, no comparison block in the body. Drawer looks identical to the parent's drawer.
2. **Mismatched bytes (criterion #1 happy path).** Submit version, reproduce it, observe the bytes diverge from the parent (or seed a divergence by overwriting the parent's output file with different bytes during the test). Open the reproduction's drawer. Expect: amber WarningPill in the header next to the StatusPill (label "non-deterministic"), comparison block in the body with two images side-by-side and "Parent (v001) / Reproduction (v002)" captions.
3. **Warnings only, outputs missing (criterion #1 partner-API path).** Trigger a reproduction where the partner-API response carried a non-determinism warning but neither parent nor reproduction output bytes are on disk yet. Open the reproduction's drawer. Expect: amber WarningPill in the header, no comparison block (engine reports both `parent_output_present` and `reproduction_output_present` as false).

Tab through the drawer with a screen reader; the WarningPill should be announced via its `role="status"` + `aria-label="non-deterministic — outputs may differ from parent"`.

## Phase 12 Verifier Readiness

Plan 12-01 (engine) and Plan 12-02 (dashboard) cohort closed. Ready for `/gsd-verify-phase 12`.

Verifier should confirm:
- 5 success criteria from `.planning/phases/12-reproduce-divergence-transparency/12-CONTEXT.md` all closed (engine emits the field, tool surface forwards it, dashboard renders pill + block under the documented gates).
- DEMO-03 marked complete in REQUIREMENTS.md.
- 5 pre-existing v1.1 ROADMAP-shape audit failures still present (deferred — out of scope).
- Dashboard build (`cd packages/dashboard && npx vite build`) exits 0.
- Architecture-purity preserved (engine-layer files still zero-MCP-import; dashboard-layer files still zero-server-import).

## Self-Check: PASSED

```
$ ls .planning/phases/12-reproduce-divergence-transparency/12-02-SUMMARY.md
$ ls packages/dashboard/src/components/WarningPill.tsx
$ ls packages/dashboard/src/__tests__/WarningPill.test.tsx
$ ls packages/dashboard/src/__tests__/VersionDrawer.test.tsx
all FOUND

$ git log --oneline | grep -E "9cc5fb0|aceb493"
9cc5fb0 feat(12-02): add WarningPill component + Version.lineage_type field
aceb493 feat(12-02): wire reproduction_divergence into VersionDrawer
all FOUND

$ grep -c "reproduction_divergence" packages/dashboard/src/views/VersionDrawer.tsx
6  (>= 3, satisfies done criterion)

$ grep -E '<WarningPill' packages/dashboard/src/views/VersionDrawer.tsx
              <WarningPill
FOUND

$ grep -E 'data-testid="reproduction-comparison"' packages/dashboard/src/views/VersionDrawer.tsx
          <section data-testid="reproduction-comparison">
FOUND

$ cd packages/dashboard && npx vite build && echo "EXIT=$?"
EXIT=0

$ npx tsc --noEmit && echo "ROOT EXIT=$?"
$ cd packages/dashboard && npx tsc --noEmit && echo "DASHBOARD EXIT=$?"
both exit 0
```

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` already covered. T-12-08 (comparison block <img>) reuses an existing route; T-12-10 (auto-fetch DoS) mitigated by the `diff !== null` guard; T-12-11 (XSS via warning label) closed by hardcoded text — no user-controlled data flows into the pill. T-12-12 (sha256 hex tooltip) is out of scope this plan and stays deferred. T-12-09 (tampering via crafted server response) accepted — display-only signal; signed C2PA manifest in Phase 14 closes the underlying trust gap.
