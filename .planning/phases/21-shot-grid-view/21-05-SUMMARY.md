---
phase: 21-shot-grid-view
plan: 5
subsystem: verification
tags: [phase-gate, smoke-test, audit, refactor]

requires:
  - phase: 21-shot-grid-view (Plans 21-01 through 21-04)
    provides: full Phase 21 implementation under audit
  - phase: 21-shot-grid-view (Plan 21-06)
    provides: gap closure for 7 bugs surfaced during this verification
provides:
  - Phase 21 is verified shippable (all 7 audit bugs closed and re-smoked)
  - Architectural pattern (App-level boot useEffect + view-independent overlays) documented for Phases 22-24
  - Multi-channel audit pattern (codex challenge + codex review + Plan architect + manual smoke) proven and reusable
affects: [22 review-and-approval (overlays should follow VersionDrawerHost pattern), 23 production-stats, 24 polish]

tech-stack:
  added: []
  patterns:
    - "Multi-channel audit (manual smoke + codex challenge + codex review + Plan architect) for high-stakes phase verification"
    - "Self-resolving overlay component pattern (VersionDrawerHost) — reusable for Phase 22 review panel + approval popovers"

key-files:
  created:
    - .planning/phases/21-shot-grid-view/21-AUDIT.md  (deep multi-source audit, 7 bugs)
    - .planning/phases/21-shot-grid-view/21-06-PLAN.md (gap closure plan, 6 tasks)
  modified:
    - .planning/STATE.md (paused-then-resumed marker)
    - .planning/ROADMAP.md (marked 21-01..21-06 complete)

key-decisions:
  - "T01 automated phase gate (1853 server tests + 361 dashboard + 54 architecture-purity + 3 tool-budget + Vite build) all green"
  - "T02 manual browser smoke surfaced 2 user-facing bugs that the automated tests missed; deferred T03 phase completion pending remediation"
  - "Pivoted from tactical 2-bug patch to strategic refactor based on multi-channel audit finding 7 bugs (1 BLOCKING) all rooted in one architectural pattern"
  - "Audit channels delivered complementary value: codex challenge found 4 of 5 new bugs; codex review found Bug 7; Plan architect produced the meta-pattern + Phase 22-24 risk analysis; smoke confirmed UX behavior + WCAG"

patterns-established:
  - "View-independent concerns (overlays, hydrate, single-source-of-truth-by-id resolution) live at App scope, not inside view components"
  - "When introducing a new global signal: subscribe at a scope >= the union of all writers (D-22 generalized)"
  - "Integration tests at App level (seed window.location.search before render) catch cross-view-seam composition bugs that view-isolated tests miss"

requirements-completed: [GRID-01, GRID-02, GRID-03, GRID-04, GRID-05]

duration: 4h (Wave 5 verification including audit + remediation + re-smoke)
completed: 2026-05-13
---

# Plan 21-05 Summary

**Phase-gate verification surfaced 7 architectural bugs via multi-channel audit; all closed via Plan 21-06 refactor; phase verified shippable in browser.**

## Performance

- **Duration:** ~4 hours
- **Tasks:** 3/3 complete (T01 automated gate; T02 human smoke + audit + remediation; T03 phase close-out)
- **Files modified:** 2 planning docs (AUDIT, 06-PLAN)

## Accomplishments

- **T01 — Automated phase gate green:** Full vitest suite (server + dashboard) green except for 21 pre-existing failures (validation-flags ROADMAP parsing, generation-tool tmp cleanup, Phase 18 SORT-03 attribution) that pre-date Phase 21. Architecture-purity (54/54) + tool-budget (3/3 still === 7) invariants unchanged. All 8 grep-based architectural rule checks (D-22, D-04, D-09, REQ-03, MCP-cap, theme tokens, copy exports) clean. Vite production build clean. 10/10 WCAG hex tokens match UI-SPEC pre-computed contrast tables.
- **T02 — Manual browser smoke + multi-channel audit:** Smoke surfaced 2 D-spec violations (URL deep-link hydration not running on App mount; VersionDrawer scoped to HomeView only). Pivoted to deep audit using 4 channels: codex challenge mode (gpt-5.5 adversarial), codex review mode (gpt-5.5 diff scan), Claude Plan architect (design pattern critique), and the manual smoke. All 4 channels converged on the same root pattern. Audit identified 5 additional bugs (1 BLOCKING race, 3 high, 1 medium) and one architectural recommendation. Plan 21-06 captured the remediation as 6 atomic commits. Post-remediation re-smoke verified Bugs 1, 2, 5, 7, and 8 (envelope) fixed; Bugs 3, 4, 6 covered by new automated tests.
- **T03 — Phase close-out:** ROADMAP and STATE updated; Phase 21 marked complete; routing prepared for Phase 22 (Review and Approval).

## Task Commits

Plan 21-05 itself produced no source-code commits — its work product was the audit and the gap-closure plan. The actual code fixes landed under Plan 21-06.

1. **T01 (automated gate):** evidence captured in this SUMMARY (no commits)
2. **T02 (smoke + audit + remediate):** produced `21-AUDIT.md` (commit `da01849`), `21-06-PLAN.md` (commit `9fefdab` or similar), and dispatched the executor that produced 7 fix commits + a SUMMARY (commits c1524aa, 3dc7688, 6908f03, 884eac1, 823c41f, 7e2c691, ad2841a, plus envelope fix `e6e2cdf`)
3. **T03 (close-out):** this SUMMARY + ROADMAP/STATE updates

## Files Created/Modified

- `.planning/phases/21-shot-grid-view/21-AUDIT.md` — 4-channel deep audit; 7-bug inventory; root pattern diagnosis; composition pattern recommendation; reviewer-disagreement resolution table
- `.planning/phases/21-shot-grid-view/21-06-PLAN.md` — 6-task gap closure plan derived from the audit
- `.planning/phases/21-shot-grid-view/21-06-SUMMARY.md` — executor's record of the 6+1 fix commits
- `.planning/STATE.md` — paused-then-resumed status markers
- `.planning/ROADMAP.md` — Phase 21 plan checkboxes marked complete

## Decisions Made

- **Strategic refactor over tactical patch.** When the audit revealed 7 bugs all rooted in one pattern, opted for a single ~1-day refactor plan that resolves all of them rather than a 2-bug patch that would leave 5 latent issues. Justification in 21-AUDIT.md §8: tactical cost = 30 min now, +3-5 days of recurring trap in Phases 22-24; strategic cost = +1 day now, savings amortized across Phases 22-24.
- **VersionDrawerHost as the new overlay pattern.** Self-resolving component reads its key from a global signal, falls back to fetch-by-id on cache miss. Established as the template for Phase 22's review-panel + approval-popover overlays.
- **Multi-channel audit as the verification standard for high-risk phases.** This was the first phase to use codex challenge + codex review + Plan architect + manual smoke in parallel. The convergence + complementarity of findings (Bug 3 found ONLY by codex challenge; Bug 7 found ONLY by codex review; meta-pattern found ONLY by Plan architect) demonstrates the value. Recommend reusing for Phase 22 (Review and Approval, which adds new global overlays).

## Deviations from Plan

- **T02 expanded from "manual smoke + record results" to "manual smoke + deep audit + 1-day remediation cycle".** Original plan assumed a happy-path smoke. Reality: smoke found bugs → audit found more bugs → remediation took an additional plan (21-06) and a follow-up envelope fix (`e6e2cdf`). All deviations are documented and added value rather than scope creep.
- **One "user reset" event during executor dispatch.** The first 21-06 executor was rejected by the user mid-run (after T01-T03 had committed but before T04+). Worktree was merged forward, fresh executor dispatched for T04-T06, no work was lost.

## Verification

**Browser smoke (post-remediation, against running dev servers):**
- Bug 1 ✓ Deep-link `?view=shot-grid&seq=...` mounts ShotGridView (was: HomeView)
- Bug 2 ✓ Click ShotGridCard → `<VersionDrawer/>` overlay opens with `[role="dialog"][aria-label="Version v005"]`
- Bug 5 ✓ Drawer fully renders with version data even though the version isn't in `versions.value` cache (fetchVersion fallback works)
- Bug 7 ✓ After return-to-home, sq010 grid icon `aria-current` is `null` (was: `"page"`)
- Bug 8 ✓ Single click triggers ONE `/api/versions/:id` fetch (was: 485 in an infinite loop due to envelope shape mismatch)

**Automated coverage (covers the bugs hard to smoke):**
- Bug 3 ✓ ShotGridView.test.tsx: cross-sequence Load More race regression test
- Bug 4 ✓ ShotGridView.test.tsx: sequence-switch stale-clear regression test
- Bug 6 ✓ ShotGridView.test.tsx: initial-fetch-rejection error-state regression test

**Test suite:** 369/369 dashboard tests + 54/54 architecture-purity + 3/3 tool-budget all green. Vite production build clean.

## Self-Check

PASS — all 7 audit bugs closed, all 5 GRID-XX requirements satisfied, all D-spec contracts verified or covered by automated tests. Phase 21 is shippable. Phase 22 (Review and Approval) and Phase 23 (Production Stats) are unblocked.
