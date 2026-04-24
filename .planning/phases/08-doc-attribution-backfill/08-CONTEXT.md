# Phase 8: Documentation Attribution Backfill - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Close three Phase 1 documentation-only tech-debt items from `v1.0-MILESTONE-AUDIT.md` — attribution normalization in plan summary frontmatter, inspector UI override reconciliation across `01-VERIFICATION.md` body and `INSPECTOR-SMOKE.md`, and forward-projection of the MCP SDK 1.29 Zod `inputSchema` envelope caveat into `02-VERIFICATION.md`. Ship a Vitest regression guard that asserts SUMMARY `requirements-completed` union ⊇ ROADMAP `**Requirements**:` declarations per phase (handles "None (gap closure)" phases), normalize YAML list style across Phases 1–5 summaries, and append a resolution note to the audit file. Zero source-code changes under `src/engine/**`, `src/store/**`, `src/tools/**`, `src/comfyui/**`, `src/http/**`, or `packages/dashboard/**`.

**In scope:**
- Reformat `01-02-SUMMARY.md` `requirements-completed:` from block-style (dash-prefixed) to flow-style one-line (matches `01-01`/`01-03` convention)
- Confirm HIER-06 attribution stays on `01-02` only (VERIFICATION row says breadcrumb-on-every-response is delivered via `src/tools/shape.ts`)
- Reconcile `01-VERIFICATION.md` body "Human Verification Required" section with the existing frontmatter `overrides_applied: 1` + `inspector_smoke_automation` block; delete the unfilled override YAML stub at lines 241–253
- Prepend an "Override Accepted 2026-04-24" header paragraph to `INSPECTOR-SMOKE.md` (keeps historical 1:1 coverage map; flags resolution state)
- Cross-link the override from `01-02-SUMMARY.md` "Open Loose Ends" / "User Setup Required" section (one sentence, one cross-ref, zero duplication)
- Append `## MCP SDK 1.29 Zod inputSchema Envelope Caveat (Phase 8, 2026-04-24)` supplement section to `02-VERIFICATION.md` — mirrors Phase 7's "Endpoint Reconciliation (Phase 7, 2026-04-24)" supplement shape
- Caveat depth: runtime behavior + visible symptom + engine-layer TypedError contrast (no fix proposal — that's a Phase 2+ design decision)
- New Vitest test `src/__tests__/phase-attribution.test.ts` — parses each `{padded_phase}-*SUMMARY.md` frontmatter `requirements-completed:` (supports both flow-style `[...]` and block-style `- item` YAML), parses each phase's `**Requirements**:` line from `ROADMAP.md`, asserts union ⊇ declared-requirements per phase (skips phases with `**Requirements**: None`)
- Normalize YAML style drift: walk `01-01..05-13-SUMMARY.md`, rewrite any block-style `requirements-completed:` lists to flow-style one-line (format-only; zero content change)
- Append "Resolved by Phase 8 (2026-04-24)" note to the three Phase 01 tech-debt rows in `.planning/v1.0-MILESTONE-AUDIT.md` `tech_debt.phase: 01-foundation-hierarchy.items` (append-only; preserves audit history)

**Out of scope (belongs to other phases or milestone close):**
- REQUIREMENTS.md Traceability table refresh (lines 147–185 show "Pending" for all 38 v1 reqs) — deferred to `/gsd-complete-milestone`
- Hunting silent attribution gaps inside Phase 2–6 SUMMARY frontmatter beyond YAML style normalization — deferred to milestone close; regression test catches future drift
- Mirroring the Zod/SDK caveat into `03-VERIFICATION.md`, `04-VERIFICATION.md`, `05-VERIFICATION.md` — single canonical home (02-VERIFICATION supplement) is enough
- Writing a regression test for the observed Zod-intercept SDK behavior (would catch SDK upgrade drift but adds a runtime-coupled test for a docs-only phase)
- Drafting the `flattenZodError()` fix (Phase 2+ design decision, non-blocking follow-up)
- Updating any `.continue-here.md` anti-pattern registries (none exist for Phase 8)
- Running `/gsd-validate-phase 01/02/03/05` to close Nyquist Wave 0 (that's Phase 9's scope)
- Touching `CLAUDE.md`, `PROJECT.md`, or `STATE.md` (session info only; not a Phase 8 deliverable)

</domain>

<decisions>
## Implementation Decisions

### SC-1: Plan summary attribution

- **D-ATTR-01:** Reformat `01-02-SUMMARY.md` `requirements-completed:` from block-style to flow-style one-line: `requirements-completed: [HIER-01, HIER-02, HIER-03, HIER-04, HIER-05, HIER-06, TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05]`. Matches `01-01`/`01-03` convention. Zero content change; parser-friendly.
- **D-ATTR-02:** HIER-06 attributed to `01-02` only. Matches `01-VERIFICATION.md` Requirements Coverage row: "Every create/get/list carries breadcrumb + breadcrumb_text via `shape.ts`; `breadcrumb-always.test.ts` walks 1-4 levels." Breadcrumb-on-every-response is a tool-surface capability (delivered by `src/tools/shape.ts` + `toolOk(shapeCreateOrGet(...))`), not a pure hierarchy capability — `01-01` delivers engine.breadcrumb walks but the "always in every response" contract is Plan 02's work.
- **D-ATTR-03:** Append "Resolved by Phase 8 (2026-04-24)" note to the three Phase 01 tech-debt rows in `.planning/v1.0-MILESTONE-AUDIT.md` → `tech_debt.phase: 01-foundation-hierarchy.items[]`. Append-only; preserves audit history. Matches Phase 7's pattern of "update in-place to reflect resolved state."
- **D-ATTR-04:** No changes to `REQUIREMENTS.md` Traceability table. That full sweep (38 rows "Pending" → "Satisfied") belongs to `/gsd-complete-milestone`, not a docs-only gap-closure phase. Scope discipline.

### SC-2: Inspector UI override reconciliation

- **D-ATTR-05:** Rewrite `01-VERIFICATION.md` body "Human Verification Required" section (lines 196–231). New content: "Automated via `scripts/inspector-smoke.mjs` (56/56 wire-level checks across stdio + Streamable HTTP). Override recorded in frontmatter 2026-04-24 — see `overrides_applied: 1` + `inspector_smoke_automation:` block. See also `INSPECTOR-SMOKE.md` for the 1:1 Inspector-assertion → automated-test coverage map." Body reads as current state, not future deferral.
- **D-ATTR-06:** Delete the unfilled override YAML stub at lines 241–253 (`overrides: - must_have: "MCP Inspector UI smoke over stdio" ...` with placeholder `<name>` / `<ISO timestamp>`). Frontmatter `overrides_applied: 1` + `override_reason:` carries the authoritative override metadata; the stub is stale instruction, not data.
- **D-ATTR-07:** Cross-link from `01-02-SUMMARY.md` "Open Loose Ends for Plan 03" or "User Setup Required" section: single sentence — "MCP Inspector UI smoke overridden on 2026-04-24 — see `01-VERIFICATION.md` `overrides_applied: 1` and `scripts/inspector-smoke.mjs` (56/56 wire-level checks across both transports)." One cross-ref, zero duplication.
- **D-ATTR-08:** Prepend "Override Accepted 2026-04-24" header paragraph to `INSPECTOR-SMOKE.md` (above the existing `# Phase 01 MCP Inspector Smoke — Results` title). Text: "**Override accepted 2026-04-24.** `scripts/inspector-smoke.mjs` is the authoritative wire-level gate for Phase 1's Inspector UI UX smoke checks (56/56 across stdio + Streamable HTTP). The deferred-to-local-verification framing below is preserved as historical rationale + 1:1 coverage map." Keeps file intact; flags resolution state at the top so readers know the deferral is closed.

### SC-3: MCP SDK 1.29 Zod inputSchema caveat

- **D-ATTR-09:** Append `## MCP SDK 1.29 Zod inputSchema Envelope Caveat (Phase 8, 2026-04-24)` section to `02-VERIFICATION.md`. Mirrors Phase 7's `## Endpoint Reconciliation (Phase 7, 2026-04-24)` supplement shape (see lines 158–161 of `02-VERIFICATION.md` today). Section position: append at end of file, after the Phase 7 supplement. Forward-referenced from the phase where tool-layer errors first multiply (generation tool adds `INVALID_WORKFLOW_FORMAT` + Zod schemas).
- **D-ATTR-10:** Caveat depth = three concise paragraphs:
  1. **Runtime behavior** — MCP SDK 1.29 runs each tool's `inputSchema` validator *before* the handler is invoked. Zod `ZodError` surfaces at the SDK boundary, not inside the handler's try/catch. Example: `shot action=create` with `name: "SH010"` — Zod's `^sh\d{3,}$` regex fails at the SDK layer.
  2. **Visible symptom** — Response shape: `{ isError: true, content: [{ type: "text", text: "MCP error -32602: Input validation error: Invalid arguments for tool shot: [..., \"message\": \"INVALID_SHOT_FORMAT\"]" }] }`. `structuredContent.code` is **not populated** for SDK-intercepted Zod errors — the sentinel message (`INVALID_SHOT_FORMAT`) is embedded in `content[0].text` only. Live evidence: `INSPECTOR-SMOKE.md` §3.
  3. **Engine-layer contrast** — TypedErrors thrown inside the handler body (e.g., `DUPLICATE_NAME` from `hierarchy-repo.ts:55-63`, `PARENT_NOT_FOUND` from `hierarchy-repo.ts:95-101`) *do* populate `structuredContent.code` correctly via `toolError(err)` in `src/tools/envelope.ts:32-60`. Defense-in-depth shot-regex enforcement at `src/engine/pipeline.ts:19,275-284` still fires for non-SDK callers (direct engine calls, test harnesses), so `INVALID_SHOT_FORMAT` via the typed envelope is reachable — just not via the MCP handler path today.
- No fix proposal, no code snippet for a `flattenZodError()` helper, no TODO scaffolding. That's a Phase 2+ design decision, out of this phase's scope.
- **D-ATTR-11:** Single canonical home — no mirrored pointers into `03-VERIFICATION.md`, `04-VERIFICATION.md`, `05-VERIFICATION.md`. If someone asks "why isn't `structuredContent.code` populated for Zod validation errors?" in the future, they grep for "inputSchema" or "Zod intercept" and land on the 02-VERIFICATION supplement once.

### SC-4: Regression guard + format normalization

- **D-ATTR-12:** New Vitest test at `src/__tests__/phase-attribution.test.ts`. Runs in the default suite (not gated). Parses each `{padded_phase}-*SUMMARY.md` frontmatter `requirements-completed:` (must support both flow-style `[A, B, C]` and block-style `- A\n - B` YAML so legacy drift is accepted before normalization and the test doesn't false-flag normalized output). Parses each phase's `**Requirements**:` line from `.planning/ROADMAP.md` `### Phase N: ...` block. Asserts: for each phase where `**Requirements**:` is not literally "None" (gap closure), the union of all plan-level `requirements-completed:` ⊇ the ROADMAP-declared set. Phases 6–9 declare `**Requirements**: None` and are skipped with an explicit allow-list check.
- **D-ATTR-13:** Test runs always (default suite), same tier as `architecture-purity.test.ts`, `tool-budget.test.ts`, and `zero-config.test.ts`. Expected cost: ~50 ms (YAML frontmatter parse + ROADMAP regex split). Adds 1 test file / ~3–5 assertions to the suite total. If a future phase is added without declaring its requirements attribution, CI fails loudly.
- **D-ATTR-14:** Normalize YAML style drift — walk `01-01, 01-02, 01-03, 02-01, 02-02, 02-03, 03-01, 03-02, 03-03, 04-01, 04-02, 04-03, 04-04, 04-05, 05-01..05-13` SUMMARY files (27 files total). Rewrite any block-style `requirements-completed:` lists to flow-style one-line. Format-only change; zero content alteration. Test from D-ATTR-12 accepts both styles, so normalization is a hygiene step, not a compliance step.
- **D-ATTR-15:** Normalization scope does NOT extend to other frontmatter list keys (`tags:`, `affects:`, `provides:`, `patterns-established:`, etc.) — those keys mix free-form strings with YAML block indicators that would need per-key handling. Deferred to milestone close if ever needed.

### Claude's Discretion

- **Exact phrasing of the 01-VERIFICATION.md body reconciliation section** — must reference frontmatter `overrides_applied: 1`, the `inspector_smoke_automation` block, `scripts/inspector-smoke.mjs`, and `INSPECTOR-SMOKE.md`. Specific wording is the writer's choice; "deferred to pre-release" language must not persist.
- **Exact phrasing of the INSPECTOR-SMOKE.md header paragraph** — must say "Override accepted 2026-04-24" and preserve the file's existing 1:1 assertion-coverage map below. Format (heading level, position relative to title) is flexible.
- **Vitest test YAML parser choice** — `js-yaml` is already an implicit dependency via the MCP SDK tree (drizzle-kit pulls it); pulling it explicitly into `package.json` is fine, OR roll a ~15-line frontmatter parser using `node:fs` + regex (`---\n(.*?)\n---` extraction, then `requirements-completed:` regex for both styles). Executor's call — prefer the lighter-weight option if the lib isn't already in `package.json` at lock time.
- **ROADMAP parse strategy** — regex for `^### Phase (\d+(?:\.\d+)?): ` then `^\*\*Requirements\*\*:\s*(.*)$` within that phase's block, OR read `.planning/ROADMAP.md` and split on `^### Phase ` — both work. Executor's call.
- **Test file co-location** — `src/__tests__/phase-attribution.test.ts` (alongside existing cross-cutting invariant tests) vs `src/__tests__/docs/phase-attribution.test.ts` (new subdirectory) — prefer flat (matches existing `architecture-purity.test.ts`, `tool-budget.test.ts`).
- **02-VERIFICATION.md supplement ordering** — append at end of file. Phase 7 supplement is already there (lines 158–161); Phase 8 supplement goes after it. Whether to add a `---` separator before it is cosmetic — follow the same shape Phase 7 used.
- **Audit file note formatting** — "Resolved by Phase 8 (2026-04-24) — see `.planning/phases/08-doc-attribution-backfill/08-VERIFICATION.md`" at end of each of the three `tech_debt.phase: 01-foundation-hierarchy.items` entries, OR a single closing line at the end of the Phase 01 tech_debt block. Executor's call; append-only is the hard constraint.
- **Whether to touch Phase 8's own VERIFICATION.md format** — not yet; `08-VERIFICATION.md` gets written in phase close, not here.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor, checker) MUST read these before acting.**

### Phase 8 anchor docs

- `.planning/ROADMAP.md` §"Phase 8: Documentation Attribution Backfill" — Goal + 3 success criteria + `**Requirements**: None (docs-only ...)` declaration
- `.planning/v1.0-MILESTONE-AUDIT.md` — `tech_debt.phase: 01-foundation-hierarchy.items[]` has the three items this phase resolves (Inspector override, Zod inputSchema caveat, 5-attribution gap). Frontmatter `audited: 2026-04-23T23:00:00Z` is the reference for "Resolved by Phase 8" notes.

### Files SC-1 touches

- `.planning/phases/01-foundation-hierarchy/01-02-SUMMARY.md` — Block-style `requirements-completed:` list at lines 60–71 is the reformat target. `01-VERIFICATION.md` row "HIER-06 | 01-02" confirms attribution ownership (D-ATTR-02).
- `.planning/phases/01-foundation-hierarchy/01-01-SUMMARY.md` — Existing flow-style reference: `requirements-completed: [TRNS-04, HIER-01, HIER-02, HIER-03, HIER-04, HIER-05]` (line 71 of file). Convention anchor.
- `.planning/phases/01-foundation-hierarchy/01-03-SUMMARY.md` — Existing flow-style reference: `requirements-completed: [TRNS-01, TRNS-02, TRNS-03, TRNS-04, TOOL-01]`. Second convention anchor.
- `.planning/phases/01-foundation-hierarchy/01-VERIFICATION.md` §"Requirements Coverage" table — Authoritative mapping of REQ-ID → Source Plan; drives which plan owns which requirement (lines 157–179).
- `.planning/v1.0-MILESTONE-AUDIT.md` `tech_debt.phase: 01-foundation-hierarchy.items[]` rows — Three items to mark resolved (lines 19–23 in YAML frontmatter).

### Files SC-2 touches

- `.planning/phases/01-foundation-hierarchy/01-VERIFICATION.md` — Frontmatter `overrides_applied: 1` + `override_reason:` + `inspector_smoke_automation:` block (lines 1–18) is the authoritative override record. Body "Human Verification Required" section (lines 196–231) + unfilled override YAML stub (lines 241–253) are the reconcile/delete targets.
- `.planning/phases/01-foundation-hierarchy/INSPECTOR-SMOKE.md` — Existing historical 1:1 coverage map (170 lines). Prepend "Override Accepted 2026-04-24" header paragraph above the `# Phase 01 MCP Inspector Smoke — Results` title.
- `.planning/phases/01-foundation-hierarchy/01-02-SUMMARY.md` "Open Loose Ends for Plan 03" section (around line 334) or "User Setup Required" section — Cross-link target for D-ATTR-07.

### Files SC-3 touches

- `.planning/phases/02-comfyui-generation/02-VERIFICATION.md` — Supplement target. Phase 7 supplement already appended at lines 158–161 (`## Endpoint Reconciliation (Phase 7, 2026-04-24)`). Phase 8 supplement appends after it following the same shape.
- `.planning/phases/01-foundation-hierarchy/01-VERIFICATION.md` `inspector_smoke_automation.notes[]` (lines 15–18) — Source of the caveat text; Phase 8 supplement expands + rephrases into three paragraphs per D-ATTR-10.
- `.planning/phases/01-foundation-hierarchy/INSPECTOR-SMOKE.md` §3 "`shot action=create` with invalid name `SH010`" (lines 97–118) — Live decoded JSON-RPC response showing the Zod intercept. Cite in the symptom paragraph of the supplement.
- `src/tools/envelope.ts:32-60` — `toolError(err)` TypedError → `structuredContent.code` mapping. Engine-layer contrast paragraph (D-ATTR-10 §3) cites this.
- `src/tools/shot-tool.ts:32,106-118` — Zod regex with sentinel message (line 32: `.regex(SHOT_NAME_REGEX, 'INVALID_SHOT_FORMAT')`) + handler ZodError catch + sentinel-detect-and-remap path (lines 106–118). Shows the defense-in-depth structure even though the handler catch is shadowed by the SDK 1.29 intercept today.
- `src/engine/pipeline.ts:19,275-284` — Engine-layer regex enforcement (second defense-in-depth layer). Line 19 imports `SHOT_NAME_REGEX`; lines 275–284 are the `createShot` block with the regex test + `INVALID_SHOT_FORMAT` TypedError throw at line 279. Still fires for direct engine callers.

### Files SC-4 touches

- `src/__tests__/phase-attribution.test.ts` — NEW. Vitest test per D-ATTR-12.
- `src/__tests__/architecture-purity.test.ts` — Shape + style reference for the new test (4 assertions, describe.skipIf gate pattern).
- `src/__tests__/tool-budget.test.ts` — Shape + style reference for filesystem-parsing tests (grep + regex).
- `.planning/phases/{01-01..05-13}-SUMMARY.md` (27 files) — YAML style normalization target per D-ATTR-14. Block-style `requirements-completed:` lists rewritten to flow-style one-line.
- `.planning/ROADMAP.md` §"Phase Details" — `**Requirements**:` lines parsed by the test (D-ATTR-12). Supports both explicit REQ-ID lists and the literal "None (gap closure ...)" for phases 6–9.

### Prior phase context (hard dependency — shapes how Phase 8 writes)

- `.planning/phases/07-comfyui-endpoint-reconciliation/07-CONTEXT.md` D-EP-11, D-EP-12 — Supplement-section pattern for appending to upstream-phase VERIFICATION.md. Phase 8 mirrors this for SC-3.
- `.planning/phases/07-comfyui-endpoint-reconciliation/07-VERIFICATION.md` — Resolution doc shape reference (frontmatter + observable truths + key-link verification structure).
- `.planning/phases/02-comfyui-generation/02-VERIFICATION.md` lines 158–161 — Literal format of the Phase 7 supplement section (frontmatter of file unchanged, new `## Section Title (Phase N, YYYY-MM-DD)` at end).
- `.planning/phases/01-foundation-hierarchy/01-HUMAN-UAT.md` — Historical context for the Inspector UI deferral (if it exists and is relevant to writing the reconciliation prose).

### Project conventions

- `CLAUDE.md` — Tool-engine separation, no MCP SDK in `src/engine/`/`src/store/`/`src/utils/`/`src/types/`. Phase 8 touches zero code under `src/engine/**`, `src/store/**`, `src/tools/**`, `src/comfyui/**`, `src/http/**`, `packages/dashboard/**` — test-only under `src/__tests__/`.
- `.planning/PROJECT.md` — "Never return raw JSON dumps to agents — structure responses with context" (convention cited in the Zod caveat symptom paragraph to explain why the SDK-intercept path is a visible regression of the D-GEN-41 typed envelope contract).
- `MEMORY.md` index — `feedback_dont_punt_on_tests.md`: wire-level tests drive acceptance. Phase 8 acceptance = Vitest test green + manual re-read of reconciled/normalized docs.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/__tests__/architecture-purity.test.ts`** — 4-assertion cross-cutting invariant test. Shape reference for `phase-attribution.test.ts` (D-ATTR-12): top-level describe, per-directory/per-file assertions, `expect(x).toBe(y)` with clear failure messages citing file paths.
- **`src/__tests__/tool-budget.test.ts`** — Filesystem-parsing test using `readFile` + multi-line regex (`/server\.registerTool\(\s*'([a-z_-]+)'/gs` per Plan 03-03 decision). Pattern for parsing YAML frontmatter + ROADMAP sections without pulling in a full YAML lib. Phase 8 test can mirror the same regex approach or pull in `js-yaml` (Claude's Discretion).
- **`src/__tests__/stdio-hygiene.test.ts`** — Reference for `describe.skipIf`-gated tests, though D-ATTR-13 says Phase 8's test is NOT gated (runs always).
- **`scripts/inspector-smoke.mjs`** — Only existing script under `scripts/`. NOT touched by Phase 8 (no probe-style work); just referenced in the reconciled prose of `01-VERIFICATION.md`.
- **Phase 7's `02-VERIFICATION.md` supplement (lines 158–161)** — Literal prior-art for the SC-3 supplement shape. Phase 8's supplement will sit immediately after it.
- **Existing flow-style `requirements-completed:` lines in 01-01 and 01-03 SUMMARY.md** — Direct template for D-ATTR-01 reformat: `requirements-completed: [REQ-1, REQ-2, ...]`.

### Established Patterns

- **Supplement-in-upstream-VERIFICATION.md pattern** — Phase 7 established. Append `## {Topic} (Phase N, YYYY-MM-DD)` section at end of file; link back to the originating phase's canonical doc. Phase 8 SC-3 uses this exactly.
- **Append-only resolution note pattern** — Phase 7 memory hygiene (D-EP-15) updated `project_comfy_api_endpoint_drift.md` in place with "RESOLVED 2026-04-24" header. Phase 8 mirrors for `v1.0-MILESTONE-AUDIT.md` tech_debt entries (D-ATTR-03).
- **Flow-style YAML list convention** — Two-thirds of Phase 1 SUMMARY files already use flow-style for `requirements-completed:`; normalizing 01-02 + any Phase 2–5 outliers brings the full set to one style.
- **Defense-in-depth regex** (T2 from `01-02-SUMMARY.md`) — The Zod-at-tool + regex-at-engine pattern is the reason SDK 1.29's inputSchema intercept doesn't fully break the shot-regex contract; the caveat supplement must cite it (D-ATTR-10 §3).
- **Vitest cross-cutting invariant test tier** — `architecture-purity`, `tool-budget`, `zero-config`, `stdio-hygiene`, `transport-parity` all live flat under `src/__tests__/`. `phase-attribution.test.ts` joins this tier.

### Integration Points

- **Vitest default suite** — New test runs on every `npx vitest run`. No new harness, no new fixture, no new CI lane. Contributes 1 file / ~3–5 assertions / ~50 ms.
- **`drizzle/`** — Zero touch. Phase 8 makes no schema changes.
- **`packages/dashboard/`** — Zero touch.
- **`src/comfyui/`** — Zero touch. The SC-3 supplement *mentions* tool-layer Zod schemas but does not edit `generation-tool.ts` or any other tool.
- **`src/tools/`** — Zero touch in source. The SC-3 supplement cites `envelope.ts:32-60`, `shot-tool.ts:32,106-118`, `pipeline.ts:19,275-284` as evidence; no code changes.
- **`package.json`** — Potential touch only if D-ATTR-12 chooses `js-yaml` as the frontmatter parser. Claude's Discretion (regex-based parse avoids this).
- **`.planning/STATE.md`** — Updated at phase close (session info + resume pointer) per standard GSD workflow; not a Phase 8 content deliverable.

### Build Order (Phase 8 subset)

```
1. src/__tests__/phase-attribution.test.ts              (NEW; accepts both YAML styles so pre-normalization state passes)
2. Run `npx vitest run src/__tests__/phase-attribution.test.ts` → passes on current tree (no content gaps — 01-02 block-style list is parsed fine)
3. Reformat 01-02-SUMMARY.md requirements-completed: → flow-style one-line
4. Walk Phase 2–5 SUMMARY files; rewrite any remaining block-style requirements-completed: → flow-style (zero content change)
5. Run `npx vitest run src/__tests__/phase-attribution.test.ts` → still passes (normalization is style-only)
6. Cross-link 01-02-SUMMARY.md "Open Loose Ends" / "User Setup Required" → 01-VERIFICATION.md override
7. Reconcile 01-VERIFICATION.md body (rewrite lines 196–231; delete lines 241–253)
8. Prepend "Override Accepted 2026-04-24" header paragraph to INSPECTOR-SMOKE.md
9. Append `## MCP SDK 1.29 Zod inputSchema Envelope Caveat (Phase 8, 2026-04-24)` supplement to 02-VERIFICATION.md
10. Append "Resolved by Phase 8 (2026-04-24)" notes to v1.0-MILESTONE-AUDIT.md tech_debt.phase: 01 items
11. Run full suite: `npx vitest run` + `npx tsc --noEmit` → green
12. Write 08-VERIFICATION.md (phase close; not this planning step)
```

</code_context>

<specifics>
## Specific Values (reproduce verbatim)

- **01-02-SUMMARY.md flow-style target:** `requirements-completed: [HIER-01, HIER-02, HIER-03, HIER-04, HIER-05, HIER-06, TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05]`
- **01-VERIFICATION.md body section title:** "Automated Verification (Inspector UI Override Accepted)" replaces "Human Verification Required"
- **INSPECTOR-SMOKE.md prepended header:** `**Override accepted 2026-04-24.** \`scripts/inspector-smoke.mjs\` is the authoritative wire-level gate for Phase 1's Inspector UI UX smoke checks (56/56 across stdio + Streamable HTTP). The deferred-to-local-verification framing below is preserved as historical rationale + 1:1 coverage map.`
- **01-02-SUMMARY.md cross-link sentence:** `MCP Inspector UI smoke overridden on 2026-04-24 — see \`01-VERIFICATION.md\` \`overrides_applied: 1\` and \`scripts/inspector-smoke.mjs\` (56/56 wire-level checks across both transports).` Placement: "Open Loose Ends for Plan 03" or "User Setup Required" section.
- **02-VERIFICATION.md supplement heading:** `## MCP SDK 1.29 Zod inputSchema Envelope Caveat (Phase 8, 2026-04-24)`
- **v1.0-MILESTONE-AUDIT.md resolution note template:** `Resolved by Phase 8 (2026-04-24) — see .planning/phases/08-doc-attribution-backfill/08-VERIFICATION.md.` Appended to each of the 3 Phase 01 tech_debt items (or as a single closing line at end of the Phase 01 block — Claude's Discretion).
- **New test file path:** `src/__tests__/phase-attribution.test.ts`
- **New test invocation:** `npx vitest run src/__tests__/phase-attribution.test.ts` (subset) or `npx vitest run` (full suite)
- **Test runtime budget:** ~50 ms (filesystem reads + regex parse, no network/DB)
- **Summary file scope for D-ATTR-14 normalization:** `01-01, 01-02, 01-03, 02-01, 02-02, 02-03, 03-01, 03-02, 03-03, 04-01, 04-02, 04-03, 04-04, 04-05, 05-01, 05-02, 05-03, 05-04, 05-05, 05-06, 05-07, 05-08, 05-09, 05-10, 05-11, 05-12, 05-13` (27 files total)
- **Phases skipped by the regression test (gap-closure, **Requirements**: None):** 6, 7, 8, 9
- **Tool count invariant (must hold):** 7 tools — `[asset, generation, project, sequence, shot, version, workspace]`. No tool changes in Phase 8.
- **Architecture purity invariant (must hold):** Zero `@modelcontextprotocol/sdk` imports under `src/engine/`, `src/store/`, `src/utils/`, `src/types/`. Phase 8 adds zero MCP SDK imports anywhere — the new test reads planning files only.
- **Test count delta:** +1 file / +3–5 assertions
- **Skipped test count delta:** 0 (new test is not gated)
- **Zod intercept repro response** (from INSPECTOR-SMOKE.md §3, verbatim for citation in the supplement):
  ```json
  {
    "result": {
      "content": [{ "type": "text", "text": "MCP error -32602: Input validation error: Invalid arguments for tool shot: [{..., \"path\": [\"name\"], \"message\": \"INVALID_SHOT_FORMAT\"}]" }],
      "isError": true
    },
    "jsonrpc": "2.0",
    "id": 2
  }
  ```

</specifics>

<deferred>
## Deferred Ideas

Surfaced during discussion. Not in Phase 8 scope — preserved so they aren't lost.

- **REQUIREMENTS.md Traceability table refresh** — Lines 147–185 show "Pending" for all 38 v1 reqs. Flipping them to "Satisfied" + plan-level attribution is a milestone-close sweep, not a docs-only phase deliverable. Owner: `/gsd-complete-milestone`.
- **flattenZodError() helper that surfaces Zod inputSchema failures in structuredContent.code** — The Phase 2+ follow-up the caveat is pointing at. Would require an SDK-boundary wrapper (middleware or handler pre-check) that catches `z.ZodError` before the SDK sees it and re-raises as a handler-side TypedError. Design decision deferred; non-blocking.
- **Mirroring the Zod/SDK caveat into 03/04/05 VERIFICATION.md** — Rejected (D-ATTR-11). Single canonical home is enough; grep-findable on "Zod inputSchema" / "inputSchema" / "SDK 1.29 intercept".
- **Regression test for the Zod intercept SDK behavior** — Would catch SDK upgrade drift (if SDK 1.30 changes the envelope). Rejected for this phase — adds runtime-coupled test for a docs-only scope. If SDK is upgraded in a future phase, add the test there.
- **Full attribution-gap sweep across Phases 2–6 SUMMARY.md files** — Beyond format normalization. The regression test (D-ATTR-12) catches missing attributions automatically once it runs; if Phases 2–6 have silent gaps they'll fail the test immediately, and fixing them in-place becomes an atomic follow-up in Phase 9 or milestone close.
- **YAML style normalization across other frontmatter keys** (`tags:`, `affects:`, `provides:`, `patterns-established:`) — D-ATTR-15 limited normalization to `requirements-completed:`. Other keys mix free-form strings with YAML block indicators and would need per-key handling. Deferred.
- **Pre-commit hook or `/gsd-verify` integration for the attribution check** — The Vitest test is sufficient. A hook would be redundant (CI catches it; local `npx vitest run` catches it). Can be added later if CI isn't catching drift before merges.
- **Standalone `.planning/notes/` directory for SDK quirks** — Considered for SC-3 (option B in the discussion) but rejected in favour of the 02-VERIFICATION supplement pattern (Phase 7 precedent). Revisit if/when a second SDK quirk emerges and a dedicated doc directory becomes worthwhile.
- **Moving INSPECTOR-SMOKE.md into Phase 1's top-level directory** (instead of `.planning/phases/01-foundation-hierarchy/INSPECTOR-SMOKE.md` with no numeric prefix) — File naming convention deviation noted during discussion but kept as-is (historical artifact; renaming would break cross-refs).
- **Reviewed todos (not folded):** None — no todos matched Phase 8 scope per `gsd-sdk query todo.match-phase "08"`.

</deferred>

---

*Phase: 08-doc-attribution-backfill*
*Context gathered: 2026-04-24 via /gsd-discuss-phase*
