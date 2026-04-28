# Phase 9: Nyquist Wave 0 Closure - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Retrofit Wave 0 closure across the v1.0 functional phases so `VALIDATION.md` reports `status: closed`, `nyquist_compliant: true`, `wave_0_complete: true` for phases 01, 02, 03, and 05. Cosmetic alignment for Phase 04 (already nyquist_compliant + wave_0_complete; flip `status: draft → closed` for consistency). Update `v1.0-MILESTONE-AUDIT.md` frontmatter `nyquist.overall: partial → compliant` plus body Nyquist Compliance table refresh and a Phase 7/8-shape append section. Add a Vitest regression guard (`src/__tests__/validation-flags.test.ts`) that reads ROADMAP.md dynamically and asserts the three flags hold for v1.0 functional phases (01-05), with `[GAP CLOSURE]` phases (incl. Phase 9 itself) exempt. Zero source-code changes under `src/engine/**`, `src/store/**`, `src/tools/**`, `src/comfyui/**`, `src/http/**`, or `packages/dashboard/**`.

**In scope:**
- Walk `01-XX-PLAN.md`, `02-XX-PLAN.md`, `03-XX-PLAN.md`, `05-XX-PLAN.md` to extract final task IDs; rewrite Per-Task Verification Map in each phase's `VALIDATION.md` to use those task IDs (matches Phase 03 + Phase 04 conventions)
- Flip `status: draft → closed`, `nyquist_compliant: false → true`, `wave_0_complete: false → true` in `01-VALIDATION.md`, `02-VALIDATION.md`, `05-VALIDATION.md` frontmatter
- Flip `wave_0_complete: false → true`, `status: draft → closed` in `03-VALIDATION.md` (`nyquist_compliant: true` already set)
- Cosmetic flip: `status: draft → closed` in `04-VALIDATION.md` (both flags already true)
- Walk Wave 0 checklist in each VALIDATION.md, mark each `- [ ]` → `- [x]` where the named test infrastructure file exists in the codebase (vitest configs, fixtures, fakes, test files)
- Mark each Per-Task Map row `Status` column ✅ green where the test command runs green; ⚠️ flaky for skipped/flaky rows; preserve existing `❌ W0` markings for rows that genuinely missed (none expected per current 754/757 baseline)
- Retrofit `01-VALIDATION.md` Manual-Only section: replace 3 Inspector UI smoke rows with override note pointing at `scripts/inspector-smoke.mjs` (Phase 8 documented this as automated; 56/56 wire-level checks)
- Append "Validation Audit 2026-04-28" trail per State A workflow contract (`$HOME/.claude/get-shit-done/workflows/validate-phase.md` Step 6)
- Update `v1.0-MILESTONE-AUDIT.md` frontmatter: `nyquist.compliant: 1 → 5`, `nyquist.partial: 4 → 0`, `nyquist.overall: partial → compliant`
- Refresh body §"Nyquist Compliance" table to show all 5 phases COMPLIANT (preserve original audit timestamps, just flip status column)
- Append `## Phase 9 Closure (2026-04-28)` section to `v1.0-MILESTONE-AUDIT.md` (Phase 7/8 mirror): which 4 phases retrofitted, link to `09-VERIFICATION.md`, append-only
- New test file `src/__tests__/validation-flags.test.ts` — reads ROADMAP.md, enumerates phases marked `- [x]` complete, exempts phases whose name contains `[GAP CLOSURE]`, asserts each remaining phase has a VALIDATION.md file with `status: 'closed'` (strict equality) + `nyquist_compliant: true` + `wave_0_complete: true`
- Re-run `npx vitest run` once at Phase 9 start to confirm 754/757 baseline holds + 1 new test (validation-flags.test.ts) green
- Write `09-VERIFICATION.md` (Phase 8 shape: frontmatter + observable truths table per ROADMAP SC #1-5 + closure summary paragraph + cross-link to audit doc)

**Out of scope (belongs to other phases or milestone close):**
- Backfilling `VALIDATION.md` for phases 06, 07, 08 — exempt as `[GAP CLOSURE]` phases; gap-closure inherits upstream's validation contract
- Inline-fix for any genuinely missing test surfaced during retrofit — defer + document as Manual-Only or new tech-debt row in `v1.0-MILESTONE-AUDIT.md`; new tests belong in their own phase
- Re-running `/gsd-audit-milestone` to regenerate the audit doc end-to-end — surgical frontmatter + table edit chosen instead (preserves Phase 8's "Resolved by Phase 8" markers and the original 2026-04-23 audit body)
- Touching any code under `src/engine/**`, `src/store/**`, `src/tools/**`, `src/comfyui/**`, `src/http/**`, `packages/dashboard/**` — Phase 9 is docs-only + 1 cross-cutting test
- Modifying any `*-VERIFICATION.md` content for phases 01-05 — those are passed/green; only `*-VALIDATION.md` is in scope
- Updating `REQUIREMENTS.md` Traceability table — deferred to `/gsd-complete-milestone` per Phase 8's same boundary
- Pre-commit hook for `VALIDATION.md` flag enforcement — Vitest regression guard is sufficient
- Adding `status: closed` to phases 06-09 themselves — gap-closure phases don't have VALIDATION.md and are exempt by design
- Touching `CLAUDE.md`, `PROJECT.md`, or `STATE.md` content (session info only at phase close per standard workflow)
- Fixing the 3 currently-skipped tests (~1 RUN_PROBE-gated + 2 others) — they're skip-by-design

</domain>

<decisions>
## Implementation Decisions

### Plan structure

- **D-WAVE0-01:** Single docs-only plan touching 4 VALIDATION.md files + 1 cosmetic 04 flip + audit doc + 1 new test file. Mirrors Phase 8's shape (`08-01-PLAN.md` + 2 follow-ups was 3 plans; Phase 9 is tighter — single plan, ~5-6 tasks). No `/gsd-validate-phase` invocation per phase — surgical edits guided by this CONTEXT.md.
- **D-WAVE0-02:** Per-Task Verification Map fill style = full task-ID rewrite for phases 01, 02, 05. Walk `{padded_phase}-XX-PLAN.md` files, extract final task IDs (e.g., `01-01-T1`, `02-02-T3`), replace TBD/Per-Requirement rows with task-keyed rows matching Phase 03 + Phase 04 convention. Phase 03 already has final task IDs — verify no drift, no rewrite needed.
- **D-WAVE0-03:** Test execution model = single `npx vitest run` baseline at Phase 9 start. If 754/757 pass holds (3 skipped expected: RUN_PROBE-gated `endpoint-probe.test.ts` + 2 others), proceed to flip all 4 VALIDATION.md files. After all flips + new test added, re-run full suite once to confirm 755/758 (one new test green) + zero regressions.
- **D-WAVE0-04:** Commit boundary = 5 atomic commits (Recommended pattern):
  1. `docs(phase-09): close Phase 01 Wave 0` — `01-VALIDATION.md` frontmatter + Per-Task Map fill + Manual-Only override retrofit + audit trail
  2. `docs(phase-09): close Phase 02 Wave 0` — `02-VALIDATION.md` frontmatter + Per-Task Map fill + audit trail
  3. `docs(phase-09): close Phase 03 Wave 0` — `03-VALIDATION.md` frontmatter (only `wave_0_complete + status` flips needed) + audit trail
  4. `docs(phase-09): close Phase 05 Wave 0` — `05-VALIDATION.md` frontmatter + Per-Task Map fill + audit trail
  5. `docs(phase-09): align Phase 04 status + update milestone audit + add regression guard` — `04-VALIDATION.md` cosmetic flip + `v1.0-MILESTONE-AUDIT.md` frontmatter/body/append + new `validation-flags.test.ts` + `09-VERIFICATION.md`
  Atomic per-phase = git-revertable in isolation if any flip surfaces a problem.
- **D-WAVE0-05:** Task density = 5-6 tasks. Suggested decomposition:
  1. Vitest sanity baseline + extract final task-ID maps from `01/02/03/05-XX-PLAN.md` files
  2. Phase 01 retrofit (`01-VALIDATION.md`) — frontmatter + Per-Task Map + Manual-Only override
  3. Phase 02 retrofit (`02-VALIDATION.md`) — frontmatter + Per-Task Map
  4. Phase 03 retrofit (`03-VALIDATION.md`) — frontmatter only (Per-Task Map already final)
  5. Phase 05 retrofit (`05-VALIDATION.md`) — frontmatter + Per-Task Map
  6. Phase 04 cosmetic + audit doc + regression guard + `09-VERIFICATION.md`

### Real-gap handling

- **D-WAVE0-06:** If retrofitting surfaces a genuine MISSING test (Wave 0 promised a file that doesn't exist OR a behavior is uncovered AND not in any existing test), Phase 9's response is **defer + document**:
  - If the gap is genuinely manual-by-nature (subjective, perceptual, demo-readiness): add to that phase's Manual-Only section with rationale
  - If the gap is a real automation gap: add a new tech-debt row to `v1.0-MILESTONE-AUDIT.md` `tech_debt.phase: {N}.items[]`; flag for a future phase or v1.0.x patch milestone
  - Phase 9 does NOT inline-fix — preserves docs-only scope discipline
  - Expected baseline: zero genuine gaps surface (754/757 passing, 5 VERIFICATION.md all green)
- **D-WAVE0-07:** `wave_0_complete: true` working definition for Phase 9: (a) every Wave 0 checklist `- [ ]` item exists in the codebase as a real file/directory/script, AND (b) every Per-Task Map row has a final task ID (matching `{phase}-{plan}-T{n}` form) + a non-empty Automated Command column. Independent of whether Status column shows ✅/❌/⚠️ — Wave 0 is about test infrastructure being in place, not about every behavior being currently-green. Phase 03's existing "wave 0 complete" sign-off (line 102-107 of `03-VALIDATION.md`) is the precedent.
- **D-WAVE0-08:** Phase 01 Manual-Only retrofit: replace 3 rows ("MCP Inspector over stdio", "MCP Inspector over Streamable HTTP", "Cold-start demo") with new entries pointing at `scripts/inspector-smoke.mjs`. Format: keep the row structure (Behavior | Requirement | Why Manual | Test Instructions); under "Why Manual" write `Replaced by automated wire-level smoke (Phase 8 override accepted 2026-04-24)`; under "Test Instructions" write `Run \`node scripts/inspector-smoke.mjs\` — 56/56 checks across stdio + Streamable HTTP. See \`01-VERIFICATION.md\` frontmatter \`overrides_applied: 1\` and \`INSPECTOR-SMOKE.md\` for the 1:1 coverage map.` "Cold-start demo" entry stays as Manual-Only (it's a smoke test that verifies zero-config UX from a cold environment — `inspector-smoke.mjs` doesn't cover that specifically).
- **D-WAVE0-09:** PARTIAL row handling = ⚠️ flaky in Status column. Wave 0 still flips to true (infra exists). Add a "Known flaky tests" sub-section to the affected phase's VALIDATION.md sign-off section listing each flaky entry with rationale (e.g., "skipped pending COMFYUI_API_KEY", "skipped pending RUN_PROBE=1 + key"). Existing 3 skipped tests in current run get this treatment by default — they're skip-by-design, not failure.

### Closure scope

- **D-WAVE0-10:** Phase 04 also flipped to `status: closed` in `04-VALIDATION.md`. Already has `nyquist_compliant: true + wave_0_complete: true` (compliant template). 1-line frontmatter edit. Result: all 5 v1.0 functional phases consistent with `status: closed`. Out of strict ROADMAP SC scope (SC #1-4 enumerate 01/02/03/05 only) but defensible — Phase 9 is the natural place to land the consistency fix; no other phase will touch Phase 04's VALIDATION.md.
- **D-WAVE0-11:** `v1.0-MILESTONE-AUDIT.md` surgical edit scope:
  - **Frontmatter flips:** `nyquist.compliant: 1 → 5`, `nyquist.partial: 4 → 0`, `nyquist.missing: 0` (unchanged), `nyquist.compliant_phases: [04-asset-management] → [01-foundation-hierarchy, 02-comfyui-generation, 03-provenance-versioning, 04-asset-management, 05-web-dashboard]`, `nyquist.partial_phases: [...] → []`, `nyquist.overall: partial → compliant`
  - **Body §"Nyquist Compliance" table:** Update `nyquist_compliant` column to `true` for all 5 rows; update `wave_0_complete` column to `true` for all 5 rows; update `Status` column from `PARTIAL` to `COMPLIANT` for phases 01, 02, 03, 05 (Phase 04 already COMPLIANT)
  - **Body §"Nyquist Compliance" closing paragraph:** Update "Overall: partial. Only Phase 04 closes Wave 0 validation..." paragraph to reflect new state ("Overall: compliant. All 5 phases close Wave 0 validation...")
  - **Append section:** New `## Phase 9 Closure (2026-04-28)` section near end-of-file, before the `_Audited:_` footer line. Append-only — does NOT modify the original 2026-04-23 audit body or the existing "Resolved by Phase 8" markers Phase 8 added.
- **D-WAVE0-12:** `09-VERIFICATION.md` shape mirrors Phase 8 (`08-VERIFICATION.md`). Frontmatter (`phase: 09-nyquist-wave0-closure`, `verified: 2026-04-28T...Z`, `status: passed`, `score: 5/5 SCs verified`), Goal Achievement section with 5-row Observable Truths table (one per ROADMAP SC), 1-paragraph "How this was retrofitted" summary, "Required Artifacts" / "Key Links" tables (4 VALIDATION.md flips + cosmetic 04 + audit doc + new test file), closure summary. ~80-120 lines.
- **D-WAVE0-13:** `v1.0-MILESTONE-AUDIT.md` append-only section format = Phase 7/8 mirror. Single section heading `## Phase 9 Closure (2026-04-28)`. Body lists: (a) which 4 phases got their flags flipped + cosmetic 04 flip, (b) which Manual-Only entries were updated (Phase 01's 3 Inspector smoke rows), (c) link to `.planning/phases/09-nyquist-wave0-closure/09-VERIFICATION.md`, (d) one sentence noting the new regression guard `src/__tests__/validation-flags.test.ts`. No edits to the original 2026-04-23 audit narrative.

### Regression guard

- **D-WAVE0-14:** Add Vitest regression test at `src/__tests__/validation-flags.test.ts`. Reads ROADMAP.md dynamically (no hardcoded phase list). Enumerates all phases marked `- [x]` in the milestone phase list. Exempts phases whose name contains `[GAP CLOSURE]` (case-insensitive substring match in the phase title block). Phase 9 itself is `[GAP CLOSURE]` — auto-exempt. For each remaining phase, asserts:
  - `{phase_dir}/{padded_phase}-VALIDATION.md` file exists (strict — fails loudly if a v1.0 functional phase is missing the doc)
  - YAML frontmatter has `status: 'closed'` (strict equality, not `!= 'draft'`)
  - YAML frontmatter has `nyquist_compliant: true`
  - YAML frontmatter has `wave_0_complete: true`
- **D-WAVE0-15:** Strict `status: closed` assertion (not `!= 'draft'`). Matches ROADMAP SC #1-4 exact wording. Clear failure messages if anyone re-introduces draft. Trade-off: future states like `archived` or `superseded` would need a test update — acceptable, given the milestone is shipping and this codifies the closure ceremony.
- **D-WAVE0-16:** "VALIDATION.md must exist for complete v1.0 functional phases" rule = strict failure mode. If ROADMAP marks phase complete (`- [x]`) AND phase is NOT `[GAP CLOSURE]` AND `{padded_phase}-VALIDATION.md` doesn't exist → test fails. Forces every shipped functional phase to have a validation doc. Backwards-compatible with current state (after Phase 9: 01-05 all have VALIDATION.md, 06-09 all exempt).
- **D-WAVE0-17:** Test file home = `src/__tests__/validation-flags.test.ts` (flat under cross-cutting tests). Joins `architecture-purity.test.ts`, `tool-budget.test.ts`, `phase-attribution.test.ts` (Phase 8 sibling). Same Vitest tier, same parser style, runs always (default suite). YAML parser: prefer `js-yaml` if already in dep tree (lock-file check), otherwise roll a ~15-line regex parser like Phase 8's `phase-attribution.test.ts` (executor's call — D-ATTR-13 precedent).
- **D-WAVE0-18:** Gap-closure phase exemption strategy = `[GAP CLOSURE]` substring match in ROADMAP phase title. ROADMAP phases 06, 07, 08, 09 all carry this marker (`- [ ] **Phase 6: Dashboard Wire Quality** - [GAP CLOSURE] Phase 5 tech debt — ...`). Test extracts each `- [x] **Phase N: Name** - description` entry, checks for `[GAP CLOSURE]` in description text. Exempt phases skip all 4 assertions for that phase (file-exists + 3 frontmatter flags). Future gap-closure phases automatically inherit the exemption without test changes.

### Claude's Discretion

- **YAML parser choice for `validation-flags.test.ts`** — `js-yaml` if available in dep tree, otherwise hand-rolled regex (Phase 8's `phase-attribution.test.ts` precedent: `---\n(.*?)\n---` extraction + per-key regex). Executor's call.
- **Per-Task Map task-ID rewrite ordering** — within each phase, walk PLAN files in numeric order (01-01 then 01-02 then 01-03 etc.) so the rewritten table reads sequentially. Format/whitespace details flexible.
- **Audit doc append section exact prose** — must mention the 4 retrofitted phases + cosmetic Phase 04 flip + Phase 01 Manual-Only update + link to `09-VERIFICATION.md`. Phrasing flexible.
- **`09-VERIFICATION.md` Observable Truths table column shape** — match Phase 8's `08-VERIFICATION.md` table headers if possible, but allow per-row evidence references that match the actual artifacts (vitest output, file diffs, frontmatter excerpts).
- **Whether to add the new test to `tool-budget.test.ts` regression baseline** — `validation-flags.test.ts` is a cross-cutting invariant test, not a tool. Tool budget invariant (7 tools) unchanged. No edit needed; the test simply joins the suite.
- **Order of vitest baseline runs** — one at start to confirm 754/757 baseline; one at end to confirm 755/758 (added test) + zero regressions; optional intermediate runs after each VALIDATION.md flip if executor wants finer-grained verification (Phase 9 makes no source changes so intermediate runs are redundant — executor's call).
- **Whether to also update `STATE.md` `last_activity` line during phase close** — standard GSD workflow handles this; Phase 9 doesn't include it as a content deliverable.
- **Audit doc body §"Nyquist Compliance" closing paragraph rewrite** — keep "Optional follow-ups if you want full Nyquist compliance before archival..." line OR remove it now that Phase 9 closes the gap. Removing seems cleaner; executor's call.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor, checker) MUST read these before acting.**

### Phase 9 anchor docs

- `.planning/ROADMAP.md` §"Phase 9: Nyquist Wave 0 Closure" — Goal + 5 success criteria (3 flags per phase + audit re-audit shows compliant)
- `.planning/v1.0-MILESTONE-AUDIT.md` — §"Nyquist Compliance" table is target for body refresh; frontmatter `nyquist.*` block is target for flag flips; lines near end-of-file are target for `## Phase 9 Closure (2026-04-28)` append
- `$HOME/.claude/get-shit-done/workflows/validate-phase.md` — Canonical Wave 0 contract (defines `status: closed`, audit trail format, COVERED/PARTIAL/MISSING gap classification)
- `$HOME/.claude/get-shit-done/templates/VALIDATION.md` — Template reference (Test Infrastructure / Sampling Rate / Per-Task Map / Wave 0 Requirements / Manual-Only / Sign-Off sections)

### VALIDATION.md retrofit targets (hard dependency — these are the files Phase 9 edits)

- `.planning/phases/01-foundation-hierarchy/01-VALIDATION.md` — Heaviest fill; 16 task entries with `Plan: TBD, Wave: TBD`. Frontmatter at lines 1-7: `status: draft`, `nyquist_compliant: false`, `wave_0_complete: false` → all flipped. Manual-Only section at lines 84-89: 3 Inspector UI smoke rows → retrofitted to point at `scripts/inspector-smoke.mjs`.
- `.planning/phases/02-comfyui-generation/02-VALIDATION.md` — Per-Requirement table (not Per-Task) at lines 39-62 → rewrite to Per-Task using final task IDs from `02-01/02/03-PLAN.md`. Frontmatter at lines 1-7: same triple flip.
- `.planning/phases/03-provenance-versioning/03-VALIDATION.md` — Per-Task Map already populated with final task IDs (16 rows, 03-01-01..03-03-05). Frontmatter at lines 1-7: `nyquist_compliant: true` already set; only `wave_0_complete: false → true` and `status: draft → closed` need flipping. Validation Sign-Off section at lines 102-109 already shows checkmarks; treat as ground truth.
- `.planning/phases/04-asset-management/04-VALIDATION.md` — Compliant template. Both flags already true. Frontmatter cosmetic flip: `status: draft → closed` only.
- `.planning/phases/05-web-dashboard/05-VALIDATION.md` — Per-Requirement table at lines 42-55 → rewrite to Per-Task using final task IDs from `05-01..05-13-PLAN.md` (13 plans). Frontmatter at lines 1-7: same triple flip. Wave 0 list at lines 63-70 includes dashboard-specific test infra (`packages/dashboard/vitest.config.ts`, `packages/dashboard/src/__tests__/setup.ts`, root `vitest.config.ts` exclude pattern).

### PLAN.md sources for task-ID extraction (read-only — used to build Per-Task Map rows)

- `.planning/phases/01-foundation-hierarchy/01-01-PLAN.md`, `01-02-PLAN.md`, `01-03-PLAN.md` — Plan tasks for Phase 01 Per-Task Map fill
- `.planning/phases/02-comfyui-generation/02-01-PLAN.md`, `02-02-PLAN.md`, `02-03-PLAN.md` — Plan tasks for Phase 02 Per-Task Map fill
- `.planning/phases/05-web-dashboard/05-01-PLAN.md` through `05-13-PLAN.md` (13 files) — Plan tasks for Phase 05 Per-Task Map fill
- `.planning/phases/03-provenance-versioning/03-01-PLAN.md`, `03-02-PLAN.md`, `03-03-PLAN.md` — Read for confirmation only; Per-Task Map already final

### VERIFICATION.md sources (evidence — flips justified by these passing reports)

- `.planning/phases/01-foundation-hierarchy/01-VERIFICATION.md` — Phase 01 verification frontmatter `status: passed`, `score: 21/21 must-haves verified`. Inspector override `overrides_applied: 1` block (lines 1-18) is the source of truth for D-WAVE0-08 Manual-Only retrofit.
- `.planning/phases/02-comfyui-generation/02-VERIFICATION.md` — Phase 02 verification.
- `.planning/phases/03-provenance-versioning/03-VERIFICATION.md` — Phase 03 verification.
- `.planning/phases/04-asset-management/04-VERIFICATION.md` — Phase 04 verification.
- `.planning/phases/05-web-dashboard/05-VERIFICATION.md` — Phase 05 verification (re-verified after CR-01 closure via Plan 05-13).
- `.planning/phases/01-foundation-hierarchy/INSPECTOR-SMOKE.md` — Existing Phase 01 Inspector override doc; Phase 8 prepended an "Override Accepted 2026-04-24" header. Cited in Phase 01 Manual-Only retrofit (D-WAVE0-08).

### Source files Phase 9 creates

- `src/__tests__/validation-flags.test.ts` — NEW. Regression guard per D-WAVE0-14..18.
- `.planning/phases/09-nyquist-wave0-closure/09-VERIFICATION.md` — NEW. Phase 9's verification doc per D-WAVE0-12.

### Prior phase context (hard dependency — Phase 8 patterns are load-bearing)

- `.planning/phases/08-doc-attribution-backfill/08-CONTEXT.md` — Mirror for the docs-only gap-closure shape. D-ATTR-12..15 patterns directly inform D-WAVE0-14..18.
- `.planning/phases/08-doc-attribution-backfill/08-VERIFICATION.md` — Shape reference for `09-VERIFICATION.md` per D-WAVE0-12.
- `.planning/phases/08-doc-attribution-backfill/08-01-PLAN.md`, `08-02-PLAN.md`, `08-03-PLAN.md` — Task-decomposition reference (Phase 8 had 3 plans; Phase 9 collapses to 1 plan with 5-6 tasks).
- `.planning/phases/07-comfyui-endpoint-reconciliation/07-CONTEXT.md` D-EP-11, D-EP-12 — Supplement-section pattern for appending to upstream doc. Phase 9 audit doc append (D-WAVE0-13) mirrors this.

### Cross-cutting test conventions (sibling files for `validation-flags.test.ts`)

- `src/__tests__/architecture-purity.test.ts` — Cross-cutting invariant test, top-level describe + per-directory assertions. Style reference.
- `src/__tests__/tool-budget.test.ts` — Filesystem-parsing test using `readFile` + multi-line regex. Pattern reference for ROADMAP parsing if hand-rolling without `js-yaml`.
- `src/__tests__/phase-attribution.test.ts` — Phase 8 sibling. Direct precedent: parses ROADMAP `**Requirements**:` line + plan SUMMARY frontmatter `requirements-completed:` field. Phase 9's test does the same shape but on `VALIDATION.md` frontmatter flags.
- `src/__tests__/zero-config.test.ts` — Cross-cutting test that runs always (not gated). Tier reference.
- `src/__tests__/stdio-hygiene.test.ts` — Cross-cutting test, also flat under `src/__tests__/`. Tier reference.

### Project conventions

- `CLAUDE.md` — Tool-engine separation; Phase 9 makes no `src/engine/**`, `src/store/**`, `src/tools/**`, `src/comfyui/**`, `src/http/**`, `packages/dashboard/**` edits. New test under `src/__tests__/` with zero MCP SDK imports.
- `.planning/PROJECT.md` — "Never return raw JSON dumps to agents" convention not directly relevant; "Append-only provenance" architecture rule cited as analogue for the audit doc append pattern.
- `MEMORY.md` index — `feedback_dont_punt_on_tests.md`: wire-level tests drive acceptance. Phase 9 acceptance = vitest test green + manual re-read of all 5 retrofitted VALIDATION.md files + audit doc diff.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/__tests__/phase-attribution.test.ts`** (Phase 8) — Direct precedent for `validation-flags.test.ts`. Parses YAML frontmatter from a planning file + ROADMAP `**Requirements**:` line + asserts coverage. Phase 9's test follows identical structure (read ROADMAP → enumerate phases → check VALIDATION.md frontmatter). Phase 8's hand-rolled regex parser pattern (`---\n(.*?)\n---` + per-key regex) is reusable verbatim.
- **`src/__tests__/architecture-purity.test.ts`** — 4-assertion cross-cutting test pattern. Shape: top-level `describe('architecture purity', () => { ... })`, per-rule `it()` blocks with `expect(...).toBe(...)` + clear failure message naming the file path. Phase 9's test mirrors this with per-phase `it()` blocks.
- **`src/__tests__/tool-budget.test.ts`** — Filesystem-parsing test using `readFile` + regex. Source of the `readFile` + multi-line regex pattern Phase 9 needs for ROADMAP parsing. The `/server\.registerTool\(\s*'([a-z_-]+)'/gs` style (multi-line, global, case-sensitive) is the model for parsing ROADMAP phase blocks.
- **`scripts/inspector-smoke.mjs`** (170-line wire-level smoke script, Phase 1) — NOT touched by Phase 9. Referenced in Phase 01 Manual-Only retrofit (D-WAVE0-08) as the override target.
- **Phase 8's audit doc append pattern** — `## Resolved by Phase 8 (2026-04-24)` markers added to `tech_debt.phase: 01-foundation-hierarchy.items[]`. Phase 9 mirrors this with a top-level `## Phase 9 Closure (2026-04-28)` section instead of per-item markers (Nyquist gaps are at the audit-summary level, not per-tech-debt-item level).

### Established Patterns

- **Append-only resolution note pattern** (Phase 7/8) — Every gap-closure phase appends a dated section to the relevant upstream doc; never modifies the original audit body. Phase 9's audit doc edit splits into in-place flips (frontmatter flags + body table truth values) AND append-only narrative (`## Phase 9 Closure`).
- **Cross-cutting test tier** — Flat under `src/__tests__/`; runs in default suite; no MCP SDK imports; filesystem reads + regex parsing only. `validation-flags.test.ts` joins this tier alongside `architecture-purity.test.ts`, `tool-budget.test.ts`, `zero-config.test.ts`, `stdio-hygiene.test.ts`, `transport-parity.test.ts`, `phase-attribution.test.ts`.
- **Frontmatter flag normalization** — Three flags per VALIDATION.md (`status`, `nyquist_compliant`, `wave_0_complete`) following exact ROADMAP SC wording. Phase 04's compliant frontmatter is the template (lines 1-7 of `04-VALIDATION.md`).
- **Defense-in-depth verification** — Phase 9's bookkeeping flip is backed by (a) test suite green, (b) VERIFICATION.md green, (c) Wave 0 checklist filesystem-existence check. Three independent signals confirm each flip is honest.
- **Phase 8 atomic-commit-per-deliverable** — Phase 8 had 3 commits (one per plan); Phase 9 has 5 commits (one per phase + final). Same atomicity discipline.

### Integration Points

- **Vitest default suite** — New test runs on every `npx vitest run`. No new harness, no new fixture, no new CI lane. Contributes 1 file / ~5-7 assertions / ~50ms.
- **`src/__tests__/`** — Single new file added. Zero existing files modified.
- **`drizzle/`** — Zero touch.
- **`packages/dashboard/`** — Zero touch.
- **`src/comfyui/`, `src/engine/`, `src/store/`, `src/tools/`, `src/http/`** — Zero touch.
- **`scripts/`** — Zero touch (Phase 1's `inspector-smoke.mjs` referenced in Phase 01 Manual-Only retrofit but not modified).
- **`package.json`** — Potential touch only if executor chooses `js-yaml` over hand-rolled parser (D-WAVE0-17). Claude's Discretion (regex avoids it).
- **`.planning/STATE.md`** — Updated at phase close (session info + resume pointer) per standard GSD workflow; not a Phase 9 content deliverable.
- **`.planning/MEMORY.md`** index — No new entries; Phase 9's bookkeeping closure doesn't introduce a project memory.

### Build Order (Phase 9 task sequence)

```
1. Run `npx vitest run` baseline → expect 754 passed / 3 skipped (757 total) — gates all subsequent flips
2. Walk 01-01/02/03-PLAN.md, extract task list — build {plan, wave, task_id, requirement, command} map for Phase 01
3. Walk 02-01/02/03-PLAN.md, extract task list — same map for Phase 02
4. Walk 05-01..05-13-PLAN.md, extract task list — same map for Phase 05
5. Edit 01-VALIDATION.md: frontmatter flip + Per-Task Map rewrite + Manual-Only override + audit trail → commit 1
6. Edit 02-VALIDATION.md: frontmatter flip + Per-Task Map rewrite + audit trail → commit 2
7. Edit 03-VALIDATION.md: frontmatter flip (only `wave_0_complete` and `status`) + audit trail → commit 3
8. Edit 05-VALIDATION.md: frontmatter flip + Per-Task Map rewrite + audit trail → commit 4
9. Edit 04-VALIDATION.md: cosmetic `status: draft → closed` flip
10. Edit v1.0-MILESTONE-AUDIT.md: frontmatter flips + body Nyquist Compliance table refresh + closing paragraph rewrite + ## Phase 9 Closure (2026-04-28) append section
11. Write src/__tests__/validation-flags.test.ts: ROADMAP parser + frontmatter parser + 5 phase-level assertions
12. Run `npx vitest run` confirmation → expect 755 passed / 3 skipped (758 total), zero regressions
13. Write 09-VERIFICATION.md: frontmatter + 5-row Observable Truths table + summary paragraph + cross-link
14. Commit 5: cosmetic 04 + audit doc + new test + 09-VERIFICATION.md
15. Final full suite confirmation
```

</code_context>

<specifics>
## Specific Values (reproduce verbatim)

- **Frontmatter target state for 01/02/05-VALIDATION.md (after Phase 9):**
  ```yaml
  status: closed
  nyquist_compliant: true
  wave_0_complete: true
  ```
- **Frontmatter target state for 03-VALIDATION.md (after Phase 9):**
  ```yaml
  status: closed
  nyquist_compliant: true   # already set — preserved
  wave_0_complete: true     # was false — flipped
  ```
- **Frontmatter target state for 04-VALIDATION.md (after Phase 9):**
  ```yaml
  status: closed            # was draft — cosmetic flip
  nyquist_compliant: true   # already set — preserved
  wave_0_complete: true     # already set — preserved
  ```
- **`v1.0-MILESTONE-AUDIT.md` frontmatter target state for `nyquist.*` block:**
  ```yaml
  nyquist:
    compliant: 5
    partial: 0
    missing: 0
  ```
  ```yaml
  nyquist:
    compliant_phases: [01-foundation-hierarchy, 02-comfyui-generation, 03-provenance-versioning, 04-asset-management, 05-web-dashboard]
    partial_phases: []
    missing_phases: []
    overall: compliant
  ```
- **Audit append section heading:** `## Phase 9 Closure (2026-04-28)`
- **Audit append section content (template):**
  ```
  ## Phase 9 Closure (2026-04-28)

  Wave 0 retrofit completed across all v1.0 functional phases. Each phase's `VALIDATION.md` now reports `status: closed`, `nyquist_compliant: true`, `wave_0_complete: true`:

  - `01-VALIDATION.md` — Per-Task Verification Map filled (16 task IDs across plans 01-01/02/03); 3 Manual-Only Inspector UI smoke rows retrofitted to point at `scripts/inspector-smoke.mjs` (override accepted Phase 8, 2026-04-24).
  - `02-VALIDATION.md` — Per-Task Verification Map rewritten from per-requirement to per-task (3 plans); frontmatter triple-flipped.
  - `03-VALIDATION.md` — `wave_0_complete: false → true`; `status: draft → closed`. Per-Task Map already final from initial planning.
  - `04-VALIDATION.md` — Cosmetic `status: draft → closed` for consistency. Both flags already true.
  - `05-VALIDATION.md` — Per-Task Verification Map rewritten across 13 plans; frontmatter triple-flipped.

  New regression guard: `src/__tests__/validation-flags.test.ts` reads ROADMAP.md, exempts `[GAP CLOSURE]` phases, asserts the three flags hold for v1.0 functional phases (01-05). Catches accidental flag flip-back in future work.

  See `.planning/phases/09-nyquist-wave0-closure/09-VERIFICATION.md` for full retrofit verification and observable-truths table.
  ```
- **Phase 01 Manual-Only retrofit prose (D-WAVE0-08):** Replace 3 rows ("MCP Inspector over stdio" / "...over Streamable HTTP" / "Cold-start demo"). Keep the row count and structure; rewrite Why Manual + Test Instructions columns. Sample for one row:
  ```
  | MCP Inspector over stdio | TRNS-01 | Replaced by automated wire-level smoke (Phase 8 override accepted 2026-04-24) | Run `node scripts/inspector-smoke.mjs` — 56/56 checks across stdio + Streamable HTTP. See `01-VERIFICATION.md` frontmatter `overrides_applied: 1` and `INSPECTOR-SMOKE.md` for the 1:1 coverage map. |
  ```
- **Audit trail per VALIDATION.md (Phase 9 follows State A workflow Step 6 contract):**
  ```markdown
  ## Validation Audit 2026-04-28

  | Metric | Count |
  |--------|-------|
  | Gaps found | 0 |
  | Resolved | 0 (no real gaps surfaced; bookkeeping retrofit only) |
  | Escalated | 0 |

  Wave 0 closure: nyquist_compliant + wave_0_complete + status:closed all set in frontmatter; Per-Task Verification Map populated with final task IDs; baseline vitest run 754/757 green confirms infrastructure intact. See `.planning/phases/09-nyquist-wave0-closure/09-CONTEXT.md` decisions and `.planning/phases/09-nyquist-wave0-closure/09-VERIFICATION.md` for observable truths.
  ```
- **New test file:** `src/__tests__/validation-flags.test.ts`
- **Test runtime budget:** ~50ms (filesystem reads + regex parse, no network/DB; Phase 8's `phase-attribution.test.ts` is the cost reference)
- **Test invocation:** `npx vitest run src/__tests__/validation-flags.test.ts` (subset) or `npx vitest run` (full suite)
- **Test count delta:** +1 file / +5-7 assertions
- **Skipped test count delta:** 0 (new test runs always)
- **Vitest baseline:** 754 passed / 3 skipped / 757 total across 46 files (current state, 2026-04-28)
- **Vitest target:** 755 passed / 3 skipped / 758 total across 47 files (after Phase 9)
- **Tool count invariant (must hold):** 7 tools — `[asset, generation, project, sequence, shot, version, workspace]`
- **Architecture purity invariant (must hold):** Zero `@modelcontextprotocol/sdk` imports under `src/engine/`, `src/store/`, `src/utils/`, `src/types/`. Phase 9 adds zero MCP SDK imports — new test reads planning files only.
- **Phases retrofitted (full set):** 01, 02, 03, 04 (cosmetic), 05
- **Phases exempt from regression guard:** 06, 07, 08, 09 (`[GAP CLOSURE]` marker in ROADMAP title)
- **`[GAP CLOSURE]` marker exact text** (case-sensitive substring search in test):
  ```
  - [ ] **Phase 6: Dashboard Wire Quality** - [GAP CLOSURE] Phase 5 tech debt — ...
  - [ ] **Phase 7: ComfyUI Endpoint Reconciliation** - [GAP CLOSURE] Resolve COMFYUI_API_BASE 401/404 drift; ...
  - [ ] **Phase 8: Documentation Attribution Backfill** - [GAP CLOSURE] Attribute HIER-06 + TOOL-02..05 in ...
  - [ ] **Phase 9: Nyquist Wave 0 Closure** - [GAP CLOSURE] Retrofit VALIDATION.md Wave 0 for phases 01, 02, 03, 05
  ```
  (NOTE: ROADMAP currently shows phases 06-09 with `- [ ]` checkbox; Phase 9 may also flip its own checkbox to `- [x]` at phase close — that's standard workflow, not a Phase 9 content decision.)

</specifics>

<deferred>
## Deferred Ideas

Surfaced during discussion. Not in Phase 9 scope — preserved so they aren't lost.

- **Backfill VALIDATION.md for phases 06, 07, 08** — Gap-closure phases inherit upstream's validation contract. Phase 9 exempts them via `[GAP CLOSURE]` marker. If a future v1.0.x or v2 milestone wants per-gap-closure validation contracts, this is where to start.
- **Pre-commit hook or `/gsd-verify` integration for VALIDATION.md flag enforcement** — The Vitest test is sufficient. A hook would be redundant (CI catches it; local `npx vitest run` catches it). Can be added later if CI isn't catching drift before merges.
- **Standalone `.planning/notes/` directory for milestone-meta documentation** — Considered for `09-VERIFICATION.md` but rejected; existing per-phase verification dir + cross-link to milestone audit doc is sufficient.
- **Re-running `/gsd-audit-milestone` end-to-end** — Surgical audit doc edit chosen instead. Preserves Phase 8's "Resolved by Phase 8" markers and the original 2026-04-23 audit body. Full re-audit deferred to `/gsd-complete-milestone` if needed.
- **Inline-fix for any genuinely missing test surfaced during retrofit** — D-WAVE0-06 says defer + document. If retrofit surfaces a genuine automation gap, it goes to a new tech-debt row, not into Phase 9's source tree. Bar for promoting to a future phase: "automation would actually pay off" (some gaps may stay Manual-Only forever).
- **Updating REQUIREMENTS.md Traceability table** — Lines 147-185 still show "Pending" for all 38 v1 reqs. Same boundary Phase 8 set: deferred to `/gsd-complete-milestone`.
- **Test for the `[GAP CLOSURE]` marker exemption rule itself** — Meta-test would assert "phases 06/07/08 are correctly exempted". Phase 9's test handles this implicitly (if ROADMAP marker drops, test would fail noisily). Not worth a separate test; the failure mode is loud enough.
- **Adding an audit-doc lint script or YAML schema validator** — Could enforce `nyquist.compliant + nyquist.partial + nyquist.missing == phase_count`. Phase 9 makes the audit doc consistent at write time; future drift is unlikely (the doc is rarely edited). Defer.
- **YAML style normalization across VALIDATION.md frontmatter** — Phase 8 normalized `requirements-completed:` flow-style across SUMMARY files. Equivalent for VALIDATION.md frontmatter not needed — frontmatter blocks already use consistent block-style key-value (no list keys to normalize).
- **Promoting `validation-flags.test.ts` to also assert Manual-Only count + sign-off section presence** — Out of scope; current scope (3 flags + file existence) is the ROADMAP SC contract. If structural drift becomes a problem, extend later.

### Reviewed Todos (not folded)

- None — `gsd-sdk query todo.match-phase "09"` returned 0 todos.

</deferred>

---

*Phase: 09-nyquist-wave0-closure*
*Context gathered: 2026-04-28 via /gsd-discuss-phase*
