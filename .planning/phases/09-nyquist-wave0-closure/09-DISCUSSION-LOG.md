# Phase 9: Nyquist Wave 0 Closure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `09-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-28
**Phase:** 09-nyquist-wave0-closure
**Areas discussed:** Plan structure, Real-gap handling, Closure scope, Regression guard

---

## Plan structure

### Q1: How should the Phase 9 work be structured?

| Option | Description | Selected |
|--------|-------------|----------|
| Single docs-only plan | One PLAN.md, ~6-8 tasks: read all 4 VALIDATION.md files, walk PLAN/SUMMARY for actual task IDs, surgically edit each. Mirrors Phase 8's shape. Atomic commit-per-phase via task boundaries. Lowest overhead. | ✓ |
| Plan-per-phase (4 plans) | 09-01 (Phase 01), 09-02 (Phase 02), 09-03 (Phase 03), 09-04 (Phase 05). Each plan = its own PLAN.md + SUMMARY.md. Cleaner audit trail per phase but heavy ceremony for what's mostly bookkeeping. | |
| Invoke /gsd-validate-phase per phase | Phase 9 plans literally run `/gsd-validate-phase 01` then `02` then `03` then `05`. Reuses the gsd-nyquist-auditor agent. Risk: the auditor expects to find real gaps; for bookkeeping flips it'll either no-op or generate unwanted artifacts. | |
| Hybrid: 1 plan + auditor reuse | Single plan, but task 1 invokes /gsd-validate-phase 03 first (the 'easiest' — already nyquist_compliant:true) as a sanity check that the auditor handles the bookkeeping case. If clean, do 01/02/05 surgically in remaining tasks. | |

**User's choice:** Single docs-only plan
**Notes:** Mirror Phase 8's tight scope; reserves the auditor for genuine gap-fill work.

### Q2: For phases 01, 02, 05 (Per-Requirement tables, no final task IDs), how thorough should the Per-Task Map fill be?

| Option | Description | Selected |
|--------|-------------|----------|
| Full task-ID rewrite | Walk each PLAN.md, build {plan, task} map, replace TBD/Per-Requirement rows with `01-01-T1, 01-01-T2, ..., 01-03-Tn` style — matches Phase 03 + Phase 04 conventions. Heaviest fill but produces 4 phases with identical Per-Task Map shape. | ✓ |
| Status-flip only (keep current shape) | Leave Per-Requirement tables in place for 02/05; just flip Status column from ⬜ pending → ✅ green where the test exists & passes. Preserves the audit trail of "this is what we promised at planning time" without rewriting history. Faster, less coupling to PLAN file structure. | |
| Augment, don't replace | Add a new column `Final Task ID` next to existing Per-Requirement rows. No rewrite of existing rows; just supplement. Keeps both lenses available. | |

**User's choice:** Full task-ID rewrite
**Notes:** Consistency across all 5 v1.0 phases; prepares the Per-Task Map for the regression guard's test-existence assertions if scope ever expands.

### Q3: Should each phase's bookkeeping flip be backed by a fresh full-suite vitest run, or trust existing VERIFICATION.md?

| Option | Description | Selected |
|--------|-------------|----------|
| Re-run full suite once, gate all 4 phases | One `npx vitest run` at start of Phase 9. If 754/757 still passing, proceed to flip all 4 VALIDATION.md files. Cheap (~20s), gives ground truth. | ✓ |
| Re-run per phase (4 runs) | Run `npx vitest run` scoped per phase before each flip (e.g. `src/store/__tests__` for Phase 1, `src/comfyui/__tests__` for Phase 2). More targeted but adds friction. | |
| Trust VERIFICATION.md | Each phase has a green VERIFICATION.md — use that as evidence. No fresh test run. Fastest but stale-prone. | |

**User's choice:** Re-run full suite once, gate all 4 phases
**Notes:** Single source of truth; ~20s cost is trivial. End-of-phase second run confirms +1 new test green.

### Q4: How should commits be organized within the single plan?

| Option | Description | Selected |
|--------|-------------|----------|
| One commit per phase + final (5 commits) | `docs(phase-09): close Phase 01 Wave 0`, `... Phase 02 Wave 0`, `... Phase 03 Wave 0`, `... Phase 05 Wave 0`, then `docs(phase-09): update milestone audit + add closure note`. Atomic per-phase — if a flip surfaces a problem, it's git-revertable in isolation. | ✓ |
| One commit per task (per Phase 8 cadence) | Phase 8 used ~3-5 atomic commits aligned to plan tasks. Same here: one commit per task in the PLAN. Higher granularity, more checkpoints. | |
| Single squash commit | One `docs(phase-09): close Wave 0 across phases 01/02/03/05` commit at end. Cleanest history but no atomic rollback. | |

**User's choice:** One commit per phase + final (5 commits)
**Notes:** Per-phase atomicity matches the audit-doc per-phase rows.

### Q5: Approximately how many tasks should Phase 9's PLAN.md decompose into?

| Option | Description | Selected |
|--------|-------------|----------|
| 5-6 tasks | T1: vitest sanity baseline + extract task-ID maps from PLAN files. T2-T5: per-phase VALIDATION.md retrofit (01, 02, 03, 05). T6: milestone audit doc + 09-VERIFICATION.md. Mirrors Phase 8's task density. | ✓ |
| 3 tasks (coarser) | T1: read all PLANs, build maps, run vitest. T2: surgical edits to all 4 VALIDATION.md. T3: audit doc + 09-VERIFICATION.md. Less ceremony. | |
| 8-10 tasks (finer) | Per-phase VALIDATION.md gets 2 tasks each (frontmatter flip + Per-Task Map fill). Higher resolution; more commits. | |

**User's choice:** 5-6 tasks
**Notes:** Phase 8's density is proven for docs-only work.

---

## Real-gap handling

### Q6: If retrofitting surfaces a genuine MISSING test (Wave 0 promised a file that doesn't exist OR a behavior is uncovered), what's Phase 9's response?

| Option | Description | Selected |
|--------|-------------|----------|
| Defer + document | Mark the gap as Manual-Only OR add a new tech-debt row to v1.0-MILESTONE-AUDIT.md. Preserves Phase 9 as docs-only. The gap becomes a future phase or Manual-Only entry. ROADMAP SC#1-4 (`wave_0_complete: true`) still satisfiable because Wave 0 is about test infrastructure existing, not about every behavior having an automated assertion. | ✓ |
| Inline-fix (Phase 9 widens) | Add the missing test in Phase 9. Risks scope creep into source-code-adjacent territory; breaks the docs-only promise. Only justifiable if the gap is a 1-line test addition. | |
| Stop and escalate | First gap surfaces → halt, ask user inline. Preserves scope discipline but adds checkpoints into execution flow. | |
| Document & flip-anyway | Note the gap in the VALIDATION.md Manual-Only section AND flip wave_0_complete:true. Trades strict honesty for closure. | |

**User's choice:** Defer + document
**Notes:** Hard scope discipline; expected to be a no-op given 754/757 baseline + 5/5 green VERIFICATION.md.

### Q7: What's Phase 9's working definition of `wave_0_complete: true`?

| Option | Description | Selected |
|--------|-------------|----------|
| Test infra exists + Per-Task Map populated | Wave 0 is about test scaffolding being in place. Phases 01/02/03/05 all have vitest configured + matchers + fixtures + 754 tests across 46 files. wave_0_complete:true means: (a) every Wave 0 checklist item exists in the codebase, (b) every Per-Task Map row has a final task ID + automated command, regardless of ✅ vs ⬜ status. | ✓ |
| All Per-Task Map rows show ✅ green | Stricter: wave_0_complete:true requires every row's Status column = ✅ green AND command runs green. Couples flag to live test state. | |
| Wave 0 checklist items all checked | Just the `## Wave 0 Requirements` section's `- [ ]` boxes → `- [x]`. Status column independent. | |

**User's choice:** Test infra exists + Per-Task Map populated
**Notes:** Phase 03's existing sign-off (lines 102-107) is the precedent — wave_0_complete:true precedes per-row ✅ markings.

### Q8: Phase 01's Manual-Only section lists 3 Inspector UI smoke checks. Phase 8 documented these as overridden by `scripts/inspector-smoke.mjs`. Should Phase 9 retrofit Phase 01's Manual-Only?

| Option | Description | Selected |
|--------|-------------|----------|
| Replace with override note | Update the 3 Manual-Only rows: 'Replaced by `scripts/inspector-smoke.mjs` (override accepted Phase 8, 2026-04-24).' Reflects current truth and keeps the audit trail consistent across phases. | ✓ |
| Leave as-is | Manual-Only entries are historical. Override is recorded in 01-VERIFICATION.md frontmatter; this section is a planning artifact, not a current-state mirror. | |
| Remove the 3 rows entirely | Delete since they're no longer manual-only. Risks losing the historical 'we considered this manual at planning time' context. | |

**User's choice:** Replace with override note
**Notes:** Cold-start demo row stays Manual-Only; the 2 Inspector smoke rows pivot to point at `inspector-smoke.mjs`.

### Q9: If a row is PARTIAL (test file exists but some assertions are skipped/flaky), how does Phase 9 mark it?

| Option | Description | Selected |
|--------|-------------|----------|
| ⚠️ flaky in Status, count toward green | Mark as flaky in the Status column. Wave 0 still complete (infra exists). Add a 'Known flakies' line to VALIDATION.md sign-off so the file is honest. Existing skipped tests (3 in current run) get this treatment by default. | ✓ |
| Treat as MISSING (defer) | Stricter — PARTIAL gets the same defer-and-document treatment as MISSING. Heavier. | |
| Treat as COVERED | If the file exists and the suite is overall green, mark ✅. Loses signal. | |

**User's choice:** ⚠️ flaky in Status, count toward green
**Notes:** RUN_PROBE-gated test + 2 other skipped-by-design entries get this treatment.

---

## Closure scope

### Q10: Phase 04's VALIDATION.md has `status: draft` (already nyquist_compliant + wave_0_complete). Should Phase 9 also flip it to `status: closed` for consistency?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, flip 04 too | Cheap consistency — 1-line frontmatter edit. Result: all 5 v1.0 phases have `status: closed`, making `partial → compliant` re-audit clean. ROADMAP SC didn't promise this but Phase 9 is the natural place. | ✓ |
| Leave 04 alone | Strict ROADMAP SC scope (only 01/02/03/05). Phase 04's draft status persists. Slight inconsistency but defensible. | |
| Add as a deferred-ideas item | Note the inconsistency in Phase 9's deferred section, address in `/gsd-complete-milestone`. Postpones the cleanup. | |

**User's choice:** Yes, flip 04 too
**Notes:** Cosmetic; required for the regression guard to pass cleanly across all 5 v1.0 functional phases.

### Q11: How surgically should Phase 9 update `v1.0-MILESTONE-AUDIT.md`?

| Option | Description | Selected |
|--------|-------------|----------|
| Frontmatter flip + Nyquist table refresh | Update frontmatter `nyquist.compliant: 1 → 5`, `nyquist.partial: 4 → 0`, `nyquist.overall: partial → compliant`. Update body §'Nyquist Compliance' table to show all 5 phases as COMPLIANT. Append a §'Phase 9 Closure (2026-04-25)' note. Mirrors Phase 8's append-only pattern. | ✓ |
| Frontmatter only | Just the YAML frontmatter flags. Body table stays stale. Risks audit body drifting from frontmatter. | |
| Full re-audit (run /gsd-audit-milestone) | Spawn the auditor to regenerate the entire audit doc. Heavy — risks losing existing audit context. Out of scope for a docs-only phase. | |

**User's choice:** Frontmatter flip + Nyquist table refresh
**Notes:** Date in append section is 2026-04-28 (corrected from option label); preserves Phase 8's "Resolved by Phase 8" markers.

### Q12: Phase 9's own VERIFICATION.md — what shape and depth?

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 8 shape: frontmatter + observable truths + closure summary | Mirror `08-VERIFICATION.md`: 'verified' frontmatter, observable truths table (per ROADMAP SC#1-5), 1 paragraph 'How this was retrofitted', closure note. ~80-120 lines. | ✓ |
| Lighter — just SC table + paragraph | Single SC verification table + 1-paragraph summary. ~30 lines. Acceptable since Phase 9 is bookkeeping. | |
| Heavier — per-phase appendices | Main doc + appendices for each of the 4 retrofitted phases showing diff/before-after for the VALIDATION.md flips. Higher fidelity for future audits. | |

**User's choice:** Phase 8 shape: frontmatter + observable truths + closure summary

### Q13: Append-only resolution note format on `v1.0-MILESTONE-AUDIT.md`?

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 7/8 mirror | Add `## Phase 9 Closure (2026-04-25)` section near the end with: (a) which 4 phases got their flags flipped, (b) which Manual-Only entries were updated, (c) link to `09-VERIFICATION.md`. Append-only — preserves the original 2026-04-23 audit body. Pattern proven in Phases 7+8. | ✓ |
| In-place row edits + section note | Body Nyquist Compliance table gets in-place 'PARTIAL→COMPLIANT' flips per row, PLUS the closure section. Both edit-and-append. Tighter integration. | |
| Per-phase resolution lines | Append `Resolved by Phase 9 (2026-04-25)` line after each phase's row in body Nyquist table. Mirrors Phase 8's per-tech-debt-item note style. | |

**User's choice:** Phase 7/8 mirror
**Notes:** Date 2026-04-28 in actual section heading (corrected from option label).

---

## Regression guard

### Q14: Should Phase 9 add a Vitest regression guard for VALIDATION.md flags? If yes, what scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — v1.0 phases only | New `src/__tests__/validation-flags.test.ts` (Phase 8 shape, ~50ms). Asserts: for each phase 01-05, `VALIDATION.md` frontmatter has `status:closed + nyquist_compliant:true + wave_0_complete:true`. Hardcoded allowlist of 5 phases. Catches accidental flag flip-back. ~30 lines, zero runtime coupling. | |
| Yes — all milestone phases (broader) | Same test, but reads ROADMAP.md to enumerate phases dynamically. Asserts all phases marked complete in ROADMAP also have closed VALIDATION.md flags. Catches drift for future phases too. ~60 lines, slightly more parsing. | ✓ |
| Skip — docs are static | These flags are written once and never drift like `requirements-completed:` does. Static docs need static review at milestone close, not a runtime test. The `/gsd-audit-milestone` re-run is the natural guard. | |
| Defer — add to milestone close | Note in deferred ideas. If milestone audit reveals drift, address there. Phase 9 stays minimal. | |

**User's choice:** Yes — all milestone phases (broader)
**Notes:** Dynamic-discovery handles future phases automatically.

### Q15: If Phase 9 adds the regression test, should it also assert `status: draft` is NOT present on completed phases?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — explicit `status:closed` assertion | Test asserts `status === 'closed'` (not just `!= 'draft'`). Clear failure messages if anyone re-introduces draft. Matches ROADMAP SC#1-4 exact wording. | ✓ |
| Looser — allow any non-draft | Assert `status !== 'draft'`. Permits future states like 'archived' / 'superseded'. Slightly less strict. | |
| Don't check status | Only check the two boolean flags. The `status: closed` ROADMAP requirement satisfied at write time but not enforced post-hoc. | |

**User's choice:** Yes — explicit `status:closed` assertion

### Q16: How should the test handle phases without a `VALIDATION.md`?

| Option | Description | Selected |
|--------|-------------|----------|
| Skip phases without VALIDATION.md | If `{padded_phase}-VALIDATION.md` doesn't exist, skip silently — don't fail. This matches reality during Phase 10+ work-in-progress. Test only enforces flags on phases that HAVE a VALIDATION.md. | |
| Require VALIDATION.md for all complete phases | If ROADMAP marks a phase complete (`- [x]`) but no VALIDATION.md exists, fail. Forces every shipped phase to have a validation doc. Stricter but creates back-pressure for unfinished retrofit work. | ✓ |
| Require VALIDATION.md for ALL phases | Every phase in ROADMAP, complete or not, must have VALIDATION.md. Failure mode for new phases that haven't started planning yet. Probably too strict. | |

**User's choice:** Require VALIDATION.md for all complete phases
**Notes:** This choice surfaced a real gap — phases 06/07/08 have no VALIDATION.md. Resolved via Q18 (gap-closure exemption).

### Q17: Where does the regression test file live and what's its name?

| Option | Description | Selected |
|--------|-------------|----------|
| src/__tests__/validation-flags.test.ts | Flat under cross-cutting tests, alongside `architecture-purity.test.ts`, `tool-budget.test.ts`, `phase-attribution.test.ts` (Phase 8 sibling). Same Vitest tier, same parser style, runs always. | ✓ |
| src/__tests__/phase-validation.test.ts | More phase-domain naming. Same location. | |
| src/__tests__/nyquist-closure.test.ts | Names the audit concept. Same location. Slightly less discoverable when looking for "validation" docs. | |

**User's choice:** src/__tests__/validation-flags.test.ts

### Q18: Phases 06/07/08 (gap-closure phases) have no VALIDATION.md. Strict assertion would fail. How should the test treat gap-closure phases?

| Option | Description | Selected |
|--------|-------------|----------|
| Exempt gap-closure phases | Test reads ROADMAP, looks for `[GAP CLOSURE]` marker in phase name, skips those. Functional v1.0 phases (01-05) MUST have VALIDATION.md; gap-closure phases inherit upstream's validation contract. Phase 9 itself also exempt. | ✓ |
| Backfill VALIDATION.md for 06/07/08 in Phase 9 | Heavy scope expansion. Adds 3 more retrofit targets to the plan. Could be 8-10 tasks instead of 5-6. Honest end state but violates docs-only-tight-scope shape. | |
| Allowlist 01-05 explicitly, defer 06-09 question | Hardcoded `KNOWN_PHASES = ['01', '02', '03', '04', '05']` in the test. Future phases need explicit addition. Simplest to implement; loses dynamic-discovery benefit. | |
| Skip silently if VALIDATION.md missing (revert prior choice) | Backtrack to the looser rule. Test only enforces flags on phases that HAVE a VALIDATION.md. Gap-closure phases just don't have one and that's fine. | |

**User's choice:** Exempt gap-closure phases
**Notes:** `[GAP CLOSURE]` substring marker matches phases 06-09 today; future gap-closure phases auto-exempt without test changes.

---

## Claude's Discretion

Areas where the user explicitly deferred to executor judgment:

- YAML parser choice for `validation-flags.test.ts` (`js-yaml` vs hand-rolled regex)
- Per-Task Map task-ID rewrite ordering within each phase
- Audit doc append section exact prose
- `09-VERIFICATION.md` Observable Truths table column shape
- Order of vitest baseline runs (intermediate runs after each flip optional)
- Audit doc body §"Nyquist Compliance" closing paragraph rewrite (keep "Optional follow-ups..." line or remove)

## Deferred Ideas

Surfaced during discussion. Not in Phase 9 scope:

- Backfill VALIDATION.md for phases 06, 07, 08 (gap-closure phases)
- Pre-commit hook for VALIDATION.md flag enforcement
- `/gsd-audit-milestone` end-to-end re-run
- Inline-fix for any genuinely missing test surfaced during retrofit
- Updating REQUIREMENTS.md Traceability table
- Meta-test for the `[GAP CLOSURE]` exemption rule itself
- Audit-doc lint script or YAML schema validator
- YAML style normalization across VALIDATION.md frontmatter
- Promoting `validation-flags.test.ts` to assert Manual-Only count + sign-off section presence
