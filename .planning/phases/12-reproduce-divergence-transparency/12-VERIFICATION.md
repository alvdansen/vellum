---
phase: 12-reproduce-divergence-transparency
verified: 2026-04-30T09:30:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Bit-identical reproduction (criterion #4 negative path)"
    expected: "Open reproduction's drawer in browser. No amber pill in header. No comparison block in body. Drawer looks identical to a non-reproduce drawer."
    why_human: "Visual check that the negative path produces a clean, unambiguous UI signal — automated tests confirm DOM absence but not visual feel."
  - test: "Mismatched bytes (criterion #1 happy path + #2)"
    expected: "Open reproduction's drawer when bytes diverge from parent. Amber WarningPill appears in header next to StatusPill (label 'non-deterministic'). Side-by-side comparison block renders below Output section showing two images with 'Parent (vNNN) / Reproduction (vNNN)' captions."
    why_human: "Verify amber/yellow contrast meets WCAG AA against the dark theme; confirm the spatial layout (pill placement next to StatusPill, comparison block between Output and Timeline) reads correctly."
  - test: "Warnings only, outputs missing (criterion #1 partner-API path)"
    expected: "Trigger reproduction where partner-API warned about non-determinism but neither output is on disk. Open drawer. Amber WarningPill renders in header. NO comparison block (parent_output_present + reproduction_output_present both false from engine)."
    why_human: "Confirm the conditional render rules compose correctly (pill renders independently of comparison block based on parent_output_present + reproduction_output_present)."
  - test: "Screen-reader announcement"
    expected: "Tab through drawer with VoiceOver/NVDA. Pill announces via role='status' + aria-label='non-deterministic — outputs may differ from parent'."
    why_human: "Accessibility behavior cannot be verified through DOM tests alone — needs assistive tech actually parsing the live region."
---

# Phase 12: Reproduce Divergence Transparency Verification Report

**Phase Goal:** When a reproduce-lineage output diverges from its parent (because the partner-API model is non-deterministic, or because a SHA-256 of v3's output differs from v4's despite verbatim prompt replay), surface that divergence in the UI rather than silently shipping a "reproduction" that isn't bit-identical.

**Verified:** 2026-04-30T09:30:00Z
**Status:** human_needed (automated checks all pass; visual/a11y smoke test outstanding)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1   | Version drawer renders divergence pill when partner-API non-determinism warning OR SHA-256 of reproduction differs from parent. | VERIFIED | VersionDrawer.tsx:174 conditional `{diff?.reproduction_divergence != null && (<WarningPill .../>)}` — fires when warnings non-empty OR sha256_mismatch non-null (per buildReproductionDivergence). Dashboard test "reproduce-lineage + sha256_mismatch populated: renders pill AND comparison block" + "warnings non-empty + outputs missing: renders pill but NO comparison block" both PASS. |
| 2   | Version drawer surfaces side-by-side parent-vs-reproduction comparison block when both outputs exist on disk. | VERIFIED | VersionDrawer.tsx:227-258 conditional `parent_output_present && reproduction_output_present && priorVersion` renders `<section data-testid="reproduction-comparison">` with two `<figure><img/><figcaption/></figure>` elements using getOutputUrl. Dashboard test asserts both /api/versions/ver_a/output and /api/versions/ver_b/output srcs render. |
| 3   | `version.diff` (engine + tool path) optionally includes a `reproduction_divergence` field. | VERIFIED | DiffResponse extended at src/types/provenance.ts:99 with `reproduction_divergence?: ReproductionDivergence \| null`. Engine.diffVersions (pipeline.ts:483-511) computes the field when B has lineage_type='reproduce'. Tool envelope shapeDiffEnvelope (version-tool.ts:134-150) forwards it. HTTP route /api/versions/:id/diff awaits the engine call (dashboard-routes.ts:184). |
| 4   | Bit-identical reproduction shows no pill and no comparison block. | VERIFIED | buildReproductionDivergence (diff.ts:208) returns null when warnings empty AND hashes match. Dashboard test "reproduce-lineage + reproduction_divergence=null: fetches diff but renders no pill / no block (criterion #4)" PASSES. Test "non-reproduce-lineage: never auto-fetches diff; no pill; no comparison block" confirms guard for non-reproduce path. |

**Score:** 4/4 ROADMAP success criteria verified

### PLAN must-haves verification

#### Plan 12-01 (Engine layer) — 6 truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | version.diff returns reproduction_divergence (null for non-reproduce; populated when divergence). | VERIFIED | shapeDiffEnvelope forwards `result.reproduction_divergence ?? null` (version-tool.ts:146). pipeline.ts:494 only computes when versionB.lineage_type==='reproduce'. |
| 2 | When B is reproduce-lineage AND SHA-256 of B's first output differs from A's, sha256_mismatch carries both hashes. | VERIFIED | buildReproductionDivergence builds `{parent: args.parentHash!, reproduction: args.reproductionHash!}` when bothPresent && hashesMismatch (diff.ts:212). Pipeline tests (pipeline.test.ts new describe block) cover this state. |
| 3 | When source's reproduction_warnings_json populated, warnings array carried. | VERIFIED | pipeline.ts:526-533 parses JSON.parse(warningsJson) and filters string[] before passing to buildReproductionDivergence. Tested via pipeline.test.ts integration tests. |
| 4 | When bytes match AND no warnings, reproduction_divergence is null (criterion #4 negative). | VERIFIED | diff.ts:208 — `if (!hasWarnings && !hashesMismatch) return null`. Engine integration test "reproduce-lineage with bytes matching + no warnings → null" passes. |
| 5 | Hashing reads files via streaming SHA-256; engine layer zero MCP imports. | VERIFIED | output-hash.ts uses createReadStream + createHash('sha256'). `grep -c "@modelcontextprotocol/sdk" src/engine/output-hash.ts` → 0. architecture-purity.test.ts passes. |
| 6 | engine.reproduceVersion persists reproduction_warnings_json at INSERT (no UPDATE on provenance). | VERIFIED | generation.ts:290 calls `this.versions.setReproductionWarnings(result.entity.id, warnings)` on the new version row (versions table, NOT provenance). provenance-repo.ts has zero UPDATE/DELETE. |

#### Plan 12-02 (Dashboard cohort) — 6 truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When lineage_type==='reproduce' AND priorVersion exists, VersionDrawer auto-fetches diff on mount. | VERIFIED | VersionDrawer.tsx:109-129 useEffect with deps `[version.id, priorVersion?.id, version.lineage_type]`, calls diffVersion. Test "fetches diff but renders no pill / no block" asserts `mockDiffVersion.toHaveBeenCalledTimes(1)`. |
| 2 | When reproduction_divergence !== null, amber WarningPill renders next to StatusPill. | VERIFIED | VersionDrawer.tsx:170-179 — `<StatusPill/>` followed by `{diff?.reproduction_divergence != null && (<WarningPill/>)}`. WarningPill.tsx binds to `bg-[var(--color-status-running)]` (amber #ffa931 per theme.css:49). Test asserts `screen.queryByTestId('warning-pill')` not null. |
| 3 | When both parent_output_present + reproduction_output_present, side-by-side `<img>` block renders. | VERIFIED | VersionDrawer.tsx:227-258 conditional + section[data-testid='reproduction-comparison']. Test asserts both `/api/versions/ver_a/output` and `/api/versions/ver_b/output` srcs render via getByAltText(/parent\|reproduction/i). |
| 4 | When B is reproduce-lineage but reproduction_divergence===null, neither pill nor block render (criterion #4). | VERIFIED | Both conditional renders short-circuit on null. Test "reproduction_divergence=null: ... renders no pill / no block (criterion #4)" PASSES. |
| 5 | When B is NOT reproduce-lineage, drawer never auto-fetches; never renders pill/block. | VERIFIED | useEffect early-return `if (version.lineage_type !== 'reproduce') return;`. Test asserts mockDiffVersion never called for non-reproduce. |
| 6 | Dashboard build (`cd packages/dashboard && npx vite build`) exits 0. | VERIFIED | Build run during verification: ✓ built in 169ms. Emitted index-BvSMiPtf.css (22.33 kB) + index-9jVH_ewj.js (41.16 kB). Exit code 0. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types/provenance.ts` | DiffResponse + ReproductionDivergence interface | VERIFIED | ReproductionDivergence interface (lines 85-90) with sha256_mismatch + warnings + present-flags exactly per D-CTX-4. DiffResponse extended (line 99). |
| `src/engine/output-hash.ts` | computeOutputSha256 streaming SHA-256 helper | VERIFIED | 50 lines, uses createHash + createReadStream + stat. ENOENT → null; other errors propagate. Zero MCP/SQLite/ORM imports. |
| `src/engine/diff.ts` | buildReproductionDivergence pure helper | VERIFIED | Pure function (lines 195-219). Returns null when warnings empty AND no hashesMismatch. sha256_mismatch null when either hash null OR hashes equal. |
| `src/engine/pipeline.ts` | Engine.diffVersions facade async + computeReproductionDivergence + firstStoredFilename | VERIFIED | diffVersions converted to async (line 483); computeReproductionDivergence private method (lines 520-543); firstStoredFilename helper (lines 548-557) parses outputs_json safely. |
| `src/engine/generation.ts` | reproduceVersion persists warnings | VERIFIED | Line 290: `this.versions.setReproductionWarnings(result.entity.id, warnings)` after submitInternal returns. |
| `src/store/version-repo.ts` | setReproductionWarnings UPDATE helper | VERIFIED | Lines 160-166. Plain Drizzle update; no completed_at guard (warnings sticky to row regardless of status). |
| `src/store/schema.ts` | reproduction_warnings_json column on versions | VERIFIED | Line 94: `reproduction_warnings_json: text('reproduction_warnings_json')`. |
| `src/types/hierarchy.ts` | Version.reproduction_warnings_json: string \| null | VERIFIED | Field added. doInsert in version-repo.ts:111 inserts NULL by default. |
| `drizzle/0005_phase12_reproduction_warnings.sql` | ALTER TABLE add column | VERIFIED | 12 lines. `ALTER TABLE \`versions\` ADD \`reproduction_warnings_json\` text;` |
| `drizzle/meta/_journal.json` | idx 5 entry | VERIFIED | Entry tag `0005_phase12_reproduction_warnings` present. |
| `drizzle/meta/0005_snapshot.json` | Drizzle snapshot | VERIFIED | 16266 bytes. |
| `packages/dashboard/src/components/WarningPill.tsx` | Amber pill primitive | VERIFIED | 43 lines. Renders `<span class="warning-pill ... bg-[var(--color-status-running)]">{label}</span>` with role="status" + aria-label + data-testid. |
| `packages/dashboard/src/views/VersionDrawer.tsx` | Auto-fetch + WarningPill render + comparison block | VERIFIED | All three landmarks present (auto-fetch effect at L109, WarningPill conditional at L174, comparison block at L227-258). |
| `packages/dashboard/src/types/entities.ts` | Version.lineage_type | VERIFIED | Line 58: `lineage_type?: 'reproduce' \| 'iterate' \| null`. |
| `src/engine/__tests__/output-hash.test.ts` | 5 unit tests | VERIFIED | File present (2950 bytes). |
| `src/store/__tests__/migrate-phase12.test.ts` | 3 migration tests | VERIFIED | File present (3826 bytes). |
| `packages/dashboard/src/__tests__/WarningPill.test.tsx` | 5 component tests | VERIFIED | File present (2052 bytes). |
| `packages/dashboard/src/__tests__/VersionDrawer.test.tsx` | 6 integration tests | VERIFIED | File present (6955 bytes). All 6 tests PASS. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|---------|---------|
| Engine.diffVersions facade | computeOutputSha256 | facade reads outputs_json filename, hashes via streaming SHA-256 | WIRED | pipeline.ts:537+540 — `await computeOutputSha256(this.outputRoot, parentVersionId, parentFilename)`. Imported at line 15. |
| Engine.diffVersions facade | buildReproductionDivergence | facade calls pure helper to assemble field | WIRED | pipeline.ts:542 — `return buildReproductionDivergence({ warnings, parentHash, reproductionHash })`. Imported at line 14. |
| GenerationEngine.reproduceVersion | VersionRepo.setReproductionWarnings | writes warnings JSON to new version row | WIRED | generation.ts:290 — `this.versions.setReproductionWarnings(result.entity.id, warnings)`. setReproductionWarnings defined version-repo.ts:160. |
| Migration 0005 | openDb (via runMigrations) | Phase 10 boot path auto-applies on next openDb | WIRED | src/store/db.ts:3 imports runMigrations; openDb invokes runMigrations during init. _journal.json carries idx=5 entry; migrate-phase12.test.ts confirms column present after openDb on clean DB. |
| VersionDrawer auto-fetch effect | api.diffVersion | auto-fetches /api/versions/:id/diff?against=<priorId> | WIRED | VersionDrawer.tsx:114 — `diffVersion(priorVersion.id, version.id)`. Imported at line 32. |
| VersionDrawer WarningPill render | components/WarningPill.tsx | renders when reproduction_divergence !== null | WIRED | VersionDrawer.tsx:174 conditional render. Imported at line 28. |
| VersionDrawer comparison block | api.getOutputUrl | side-by-side `<img>` elements when both outputs present | WIRED | VersionDrawer.tsx:237 + 248 — `src={getOutputUrl(priorVersion.id)}` + `src={getOutputUrl(version.id)}`. Imported at line 32. |
| Tool envelope shapeDiffEnvelope | engine.diffVersions | tool action 'diff' awaits engine + forwards reproduction_divergence | WIRED | version-tool.ts:215 — `shapeDiffEnvelope(await engine.diffVersions(...))`. shapeDiffEnvelope at lines 134-150 forwards reproduction_divergence (defaults null). |
| HTTP route /api/versions/:id/diff | engine.diffVersions | dashboard-routes awaits engine call | WIRED | dashboard-routes.ts:184 — `return c.json(await engine.diffVersions(...))`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| VersionDrawer (reproduction_divergence pill + block) | `diff: DiffSummaryShape` | Auto-fetch effect calls `diffVersion(priorVersion.id, version.id)` → `/api/versions/:id/diff` HTTP route → `engine.diffVersions(...)` → `pipeline.computeReproductionDivergence(...)` → `buildReproductionDivergence(...)` from real warnings (parsed from `versions.reproduction_warnings_json`) + real SHA-256 hashes from on-disk output files. | YES — full chain: dashboard fetches engine, engine reads DB column + hashes disk bytes, pure helper assembles field. | FLOWING |
| VersionDrawer (comparison block `<img>`s) | `parent_output_present` / `reproduction_output_present` | Booleans set by `buildReproductionDivergence` based on whether `computeOutputSha256` returned non-null hashes (i.e., whether files exist on disk). | YES — driven by actual filesystem stat() calls. | FLOWING |
| WarningPill | `label` prop | Hardcoded 'non-deterministic' default + caller passes hardcoded label/ariaLabel | YES — display-only, no user-controlled data. T-12-11 closed. | FLOWING |
| reproduce-lineage `versions.reproduction_warnings_json` | Persisted column | `engine.reproduceVersion` → `versions.setReproductionWarnings(id, JSON.stringify(warnings))` after submitInternal. Warnings derived from `models_json` parse (model_hash null) + empty-models fallback in generation.ts:265-274. | YES — real warnings from generation engine logic. | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Root test suite | `npx vitest run` | 817 passing / 5 pre-existing failing / 3 skipped (54 test files; 2 failed = phase-attribution.test.ts + validation-flags.test.ts, both documented in deferred-items.md). | PASS |
| Dashboard test suite | `cd packages/dashboard && npx vitest run` | 58 passing / 0 failing (10 test files, 1.71s duration). | PASS |
| TypeScript root | `npx tsc --noEmit` | Exit 0, no errors. | PASS |
| Dashboard build | `cd packages/dashboard && npx vite build` | Exit 0, ✓ built in 169ms; emitted 41.16 kB JS + 22.33 kB CSS. | PASS |
| Architecture-purity (output-hash.ts MCP-free) | `grep -c "@modelcontextprotocol/sdk" src/engine/output-hash.ts` | 0 | PASS |
| Architecture-purity (pipeline.ts MCP-free) | `grep -c "@modelcontextprotocol/sdk" src/engine/pipeline.ts` | 0 | PASS |
| Architecture-purity (diff.ts + generation.ts MCP-free) | grep | both 0 | PASS |
| Type contract (reproduction_divergence on DiffResponse) | `grep "reproduction_divergence" src/types/provenance.ts` | 4 matches (interface + comments + field declaration) | PASS |
| Streaming hash present | `grep "computeOutputSha256" src/engine/output-hash.ts` | export async function present | PASS |
| Migration 0005 in journal | `grep "0005_phase12_reproduction_warnings" drizzle/meta/_journal.json` | idx=5 entry present | PASS |
| reproduction_divergence wired in dashboard | `grep -c "reproduction_divergence" packages/dashboard/src/views/VersionDrawer.tsx` | 6 (>=3 done criterion) | PASS |
| Comparison block testid present | `grep 'data-testid="reproduction-comparison"'` | found in VersionDrawer.tsx | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DEMO-03 | 12-01 + 12-02 | Dashboard renders pill + side-by-side comparison on reproduce-lineage versions when partner-API non-determinism warning OR SHA-256 mismatch detected. Optional: emit `reproduction_divergence` in version.diff. | SATISFIED | All 4 ROADMAP success criteria verified. REQUIREMENTS.md (line 25) marked `[x]` and Traceability table marked Complete. Implementation: engine cohort (Plan 12-01) + dashboard cohort (Plan 12-02). |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| _none_ | | | | No TODO/FIXME/PLACEHOLDER markers added by this phase. No empty render returns. No hardcoded empty data flows to the UI (every `[]` initial state is overwritten by real fetch/store/parse). |

### Pre-existing failures (out of scope)

The 5 pre-existing test failures from `phase-attribution.test.ts` (3 tests) and `validation-flags.test.ts` (2 tests) match the documented baseline at `.planning/phases/10-migrate-on-boot-hardening/deferred-items.md`. These are caused by the v1.1 ROADMAP shape not matching v1.0 audit-test expectations — pre-existed Plan 10-01 (origin commit 04d5f60) and unchanged across all of Phase 10/11/12. Out of scope for this verification.

## Human Verification Required

Automated checks all pass (817 + 58 tests, type check, build, architecture-purity, append-only). The following require human eyes/ears:

### 1. Bit-identical reproduction (criterion #4 negative path)

**Test:** Boot the server in HTTP mode (`npx tsx src/server.ts --http`), generate a version, reproduce it where the partner-API model is deterministic enough that bytes match. Open the reproduction's drawer in the browser dashboard.

**Expected:** No amber WarningPill in the header. No comparison block in the body. Drawer looks identical to a non-reproduce drawer.

**Why human:** Visual confirmation that the negative path (criterion #4) yields a clean, unambiguous UI signal — automated tests confirm DOM absence but not visual feel.

### 2. Mismatched bytes (criterion #1 happy path + criterion #2)

**Test:** Generate a version, reproduce it where bytes diverge from the parent (or seed a divergence by writing different bytes to the parent's output file before opening the drawer). Open the reproduction's drawer.

**Expected:** Amber WarningPill in the header next to StatusPill (label "non-deterministic"). Comparison block appears between the Output section and Timeline section, showing two `<img>` elements side-by-side with "Parent (vNNN) / Reproduction (vNNN)" captions.

**Why human:** Verify amber/yellow contrast against the dark theme meets WCAG AA; confirm the spatial layout reads correctly (pill placement next to StatusPill, comparison block sandwiched between Output and Timeline sections per VersionDrawer.tsx render order).

### 3. Warnings only, outputs missing (criterion #1 partner-API path)

**Test:** Trigger a reproduction where the partner-API response carried a non-determinism warning but neither parent nor reproduction outputs are on disk yet. Open the reproduction's drawer.

**Expected:** Amber WarningPill renders in the header. NO comparison block (engine reports both `parent_output_present` and `reproduction_output_present` as false).

**Why human:** Confirm the conditional render rules compose correctly — pill renders independently of the comparison block based on the present-flags. Automated tests cover the DOM-level rule but visual confirmation in the running app guards against integration drift.

### 4. Screen-reader announcement

**Test:** Tab through the drawer with VoiceOver (Mac) or NVDA (Windows).

**Expected:** WarningPill is announced via its `role="status"` + `aria-label="non-deterministic — outputs may differ from parent"`.

**Why human:** Assistive-tech behavior cannot be verified through DOM tests alone — needs assistive tech actually parsing the live region. Tests confirm the attributes are set; only a screen reader confirms the announcement is meaningful.

### Gaps Summary

No gaps. All automated checks pass; phase implementation is complete and matches the locked D-CTX-4 contract. The four human-verification items are smoke checks on visual styling, layout, and a11y — recommended before declaring the phase fully shipped, but the underlying logic (conditional renders, async fetch, append-only persistence, architecture-purity) is fully covered by 817+58 passing tests.

---

_Verified: 2026-04-30T09:30:00Z_
_Verifier: Claude (gsd-verifier)_
