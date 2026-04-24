# Phase 8: Documentation Attribution Backfill — Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 1 new + 4 unique modifies + 1 YAML normalization sweep (1 file in scope, 26 already conformant)
**Analogs found:** 5 / 5 (full coverage)

---

## File Classification

| Touched File | Role | Data Flow | Closest Analog | Match Quality |
|--------------|------|-----------|----------------|---------------|
| `src/__tests__/phase-attribution.test.ts` (NEW) | test, cross-cutting invariant | filesystem-parse + assert | `src/__tests__/architecture-purity.test.ts` + `src/__tests__/tool-budget.test.ts` | composite — borrows shape from purity, fs-parse from budget |
| `.planning/phases/01-foundation-hierarchy/01-02-SUMMARY.md` | doc, plan summary frontmatter | YAML reformat + prose cross-link | `01-01-SUMMARY.md:83` and `01-03-SUMMARY.md:56` (flow-style anchors) | exact (template lift) |
| `.planning/phases/01-foundation-hierarchy/01-VERIFICATION.md` | doc, verification report body | prose rewrite + delete stale stub | `01-VERIFICATION.md` frontmatter `inspector_smoke_automation:` block (lines 9–17, same file) | self-reference — body must cite the frontmatter that already exists |
| `.planning/phases/01-foundation-hierarchy/INSPECTOR-SMOKE.md` | doc, historical artifact | header paragraph prepend | none direct; analog is the verbatim header text in CONTEXT.md `<specifics>` line 192 | template-supplied (executor copies verbatim) |
| `.planning/phases/02-comfyui-generation/02-VERIFICATION.md` | doc, verification report supplement | append-only section | `02-VERIFICATION.md:158–161` (Phase 7 supplement, same file) | exact (Phase 7 prior art) |
| `.planning/v1.0-MILESTONE-AUDIT.md` | doc, audit register | append-only resolution note | Phase 7 memory hygiene `RESOLVED 2026-04-24` pattern (cited in CONTEXT.md `## Established Patterns`) | role-match |
| 26× `*-SUMMARY.md` (D-ATTR-14 sweep) | doc, plan summary frontmatter | YAML format hygiene | `01-01-SUMMARY.md:83`, etc. — already in flow style | **NO-OP confirmed** (only 01-02 is block-style) |

---

## Pattern Assignments

### `src/__tests__/phase-attribution.test.ts` (NEW — test, cross-cutting invariant)

**Role:** Filesystem-parse cross-cutting invariant test that asserts ROADMAP `**Requirements**:` declarations ⊆ union of plan-level SUMMARY `requirements-completed:` per phase. Joins the existing `architecture-purity` / `tool-budget` / `zero-config` / `stdio-hygiene` / `transport-parity` tier under `src/__tests__/`.

**Primary analog (test shape + describe layout):** `src/__tests__/architecture-purity.test.ts:1-81`

**Imports + describe shape pattern** (`architecture-purity.test.ts:1-4, 33-81`):
```typescript
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';

// ... helper function declarations above describe ...

describe('architecture purity', () => {
  it('src/engine/ has zero imports from @modelcontextprotocol/sdk', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/')).toBe(0);
  });
  // ... 6 more it() with terse expect().toBe()
});
```

**Things to preserve:**
- Top-level `describe` with the phase-name-or-invariant as label
- Multiple `it()` blocks each with one focused `expect`
- Failure messages cite file paths or REQ-IDs so the operator knows where to look
- Helper functions live above the `describe` block (not inside)

**Things to change:**
- No `execFileSync('grep', …)` — Phase 8 reads markdown not source code; use `readFileSync` + regex (see budget analog below)
- No `@modelcontextprotocol/sdk` substring scans — Phase 8 parses YAML frontmatter + a regex-extracted ROADMAP section

---

**Secondary analog (filesystem walk + multi-line regex):** `src/__tests__/tool-budget.test.ts:34-57`

**File-walk + regex extraction pattern** (`tool-budget.test.ts:41-57`):
```typescript
function registeredToolNames(): string[] {
  const names: string[] = [];
  const toolsDir = 'src/tools';
  for (const entry of readdirSync(toolsDir)) {
    const full = join(toolsDir, entry);
    if (!statSync(full).isFile()) continue;
    if (!entry.endsWith('.ts')) continue;
    const content = readFileSync(full, 'utf8');
    // Match `server.registerTool(` followed by whitespace/newlines then
    // a single-quoted lowercase name. `s` flag lets `.` span newlines.
    const pattern = /server\.registerTool\(\s*'([a-z_-]+)'/gs;
    for (const m of content.matchAll(pattern)) {
      names.push(m[1]);
    }
  }
  return names.sort();
}
```

**Things to preserve:**
- `readdirSync` + per-file gate (`isFile()` + extension check)
- `readFileSync(full, 'utf8')` then `content.matchAll(pattern)` for multi-line YAML/markdown
- Sort the output for stable assertions
- Comment on the regex flag (`s` for newline-spanning) so the next reader doesn't strip it

**Things to change:**
- Walk `.planning/phases/**/*-SUMMARY.md` instead of `src/tools/*.ts` — recurse into phase subdirs OR enumerate explicitly per `## Specific Values` (27 files listed)
- Use **two regex shapes** for `requirements-completed:` to cover both YAML styles per **D-ATTR-12** — see Critical Invariant below

---

**Tertiary analog (NOT used — gate pattern explicitly out of scope):** `src/__tests__/stdio-hygiene.test.ts`

**Why excluded:** stdio-hygiene uses spawn-based child processes. Phase 8 test reads files only — no spawn, no env, no DB. Also: stdio-hygiene shows `describe.skipIf` gating; **D-ATTR-13 explicitly says Phase 8's test is NOT gated** (runs always in default suite).

---

#### CRITICAL INVARIANT — Two YAML Styles MUST Both Parse (D-ATTR-12)

The test must accept **both** of these as valid `requirements-completed:` declarations on `01-02-SUMMARY.md` so the test passes **before** D-ATTR-01 normalization runs. The CONTEXT specifies this directly: `must support both flow-style [A, B, C] and block-style - A\n - B YAML so legacy drift is accepted before normalization and the test doesn't false-flag normalized output`.

**Flow-style** (`01-01-SUMMARY.md:83`, **the post-normalization target**):
```yaml
requirements-completed: [TRNS-04, HIER-01, HIER-02, HIER-03, HIER-04, HIER-05]
```

**Block-style** (`01-02-SUMMARY.md:60-71`, **the pre-normalization state — must still parse green**):
```yaml
requirements-completed:
  - HIER-01
  - HIER-02
  - HIER-03
  - HIER-04
  - HIER-05
  - HIER-06
  - TOOL-01
  - TOOL-02
  - TOOL-03
  - TOOL-04
  - TOOL-05
```

**Suggested regex pair** (executor's discretion per Claude's Discretion line 73):

```typescript
// Flow style: requirements-completed: [A, B, C] (single line)
const flowPattern = /^requirements-completed:\s*\[([^\]]*)\]/m;
// Block style: requirements-completed:\n  - A\n  - B (multi-line, terminated by next top-level key or blank line)
const blockPattern = /^requirements-completed:\s*\n((?:\s+-\s+\S+\s*\n)+)/m;
```

Or: pull in `js-yaml` (already implicit via drizzle-kit per Claude's Discretion line 73) for full YAML parse — both are sanctioned.

#### CRITICAL INVARIANT — ROADMAP "None" phases MUST be skipped (D-ATTR-12)

Phases 6, 7, 8, 9 declare `**Requirements**: None (...)` per `ROADMAP.md` lines 128, 151, 172, 183. The test must skip these — assertion only fires for phases where the literal word "None" does not lead the requirements line.

**Reference text from `ROADMAP.md:172`** (verbatim):
```
**Requirements**: None (docs-only — HIER-06 and TOOL-02..05 are already verified satisfied; this closes the attribution gap)
```

The skip predicate should match `^None\b` after the `**Requirements**:` prefix is stripped — both `None` and `None (...)` shapes. Allow-list per `## Specific Values` line 200: `Phases skipped by the regression test (gap-closure, **Requirements**: None): 6, 7, 8, 9`.

---

### `.planning/phases/01-foundation-hierarchy/01-02-SUMMARY.md` (doc, frontmatter + prose)

**Role:** Plan summary frontmatter (YAML) reformat + body prose cross-link.

**D-ATTR-01 — Reformat lines 60–71 (block-style → flow-style one-line)**

**Closest analog:** `01-01-SUMMARY.md:83` (sibling plan in same phase directory)

**Current state** (`01-02-SUMMARY.md:60-71`, what exists today):
```yaml
requirements-completed:
  - HIER-01
  - HIER-02
  - HIER-03
  - HIER-04
  - HIER-05
  - HIER-06
  - TOOL-01
  - TOOL-02
  - TOOL-03
  - TOOL-04
  - TOOL-05
```

**Target state** (verbatim from CONTEXT `## Specific Values` line 190 — D-ATTR-01):
```yaml
requirements-completed: [HIER-01, HIER-02, HIER-03, HIER-04, HIER-05, HIER-06, TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05]
```

**Things to preserve:**
- The 11 REQ-IDs in the same order (HIER-01..06, TOOL-01..05) — no reordering, no additions
- Surrounding YAML keys untouched (`patterns-established:` immediately above on lines 54–58, `# Metrics` block immediately below on lines 73–75)
- One blank line above and one blank line below the key

**Things to change:**
- Collapse 11 lines → 1 line; that's the entire diff for D-ATTR-01

---

**D-ATTR-07 — Cross-link sentence in `## Open Loose Ends for Plan 03` section (around line 334) or `## User Setup Required`**

**Closest analog:** No exact prior-art for this exact link — the sentence is template-supplied verbatim by CONTEXT `## Specific Values` line 193.

**Current state** (`01-02-SUMMARY.md:334-340`, "Open Loose Ends for Plan 03"):
```
## Open Loose Ends for Plan 03

- **No src/server.ts yet.** Plan 03 writes the CLI parser + dual-transport bootstrap + registers all 4 tools via `src/tools/index.ts`.
- **Transport parity test, stdio-hygiene test, zero-config test** (from VALIDATION.md) remain to be written in Plan 03 — they depend on a real server.
- **Architecture-purity test** (from VALIDATION.md, D-33) could be added now but the plan scoped it to Plan 03's validation sweep. grep-verified manually as a pre-commit check for Wave 2.
- **MCP Inspector smoke tests** (both transports) remain manual verifications blocked until Plan 03 delivers the server.
- **Tool-budget test** (from VALIDATION.md): could be added as a unit test checking `server._registeredTools` has exactly 4 keys after all 4 registers run. The smoke test in error-wrapping.test.ts covers the same invariant inline; a dedicated file can be added later if desired.
```

**Target state — append one sentence** (verbatim from CONTEXT line 193 — D-ATTR-07):

```
- **MCP Inspector UI smoke overridden on 2026-04-24** — see `01-VERIFICATION.md` `overrides_applied: 1` and `scripts/inspector-smoke.mjs` (56/56 wire-level checks across both transports).
```

**Things to preserve:**
- The 5 existing bullets unchanged (the "MCP Inspector smoke tests" bullet at line ~339 is **historical context** of the deferral — leave it; the new bullet is a **state update on top of it**)
- Both `01-VERIFICATION.md` and `scripts/inspector-smoke.mjs` cited as backticked filenames so the cross-link is grep-discoverable

**Things to change:**
- Add one new bullet at the end of the existing "Open Loose Ends for Plan 03" list (or, alternative per Claude's Discretion line 71, place under `## User Setup Required` if the executor finds that section more appropriate — `01-02-SUMMARY.md` does not currently have a `User Setup Required` section per the file scan, so default to "Open Loose Ends for Plan 03")

---

### `.planning/phases/01-foundation-hierarchy/01-VERIFICATION.md` (doc, body prose rewrite + delete)

**Role:** Verification report body — rewrite the "Human Verification Required" section to match the existing frontmatter override metadata, then delete the unfilled YAML stub.

**D-ATTR-05 — Rewrite lines 196–231 ("Human Verification Required" → "Automated Verification (Inspector UI Override Accepted)")**

**Self-reference analog (the prose must cite this existing block):** `01-VERIFICATION.md:1-18` — the frontmatter is the authoritative override record, the new body must restate its content.

**Existing frontmatter** (lines 1–18, **DO NOT MODIFY** — this is the source of truth the new body section will reference):
```yaml
---
phase: 01-foundation-hierarchy
verified: 2026-04-20T22:45:00Z
revised: 2026-04-21T06:05:00Z
status: passed
score: 21/21 must-haves verified (automated); 2 Inspector smoke checks also automated via scripts/inspector-smoke.mjs (56/56 wire-level checks pass across both transports)
overrides_applied: 1
override_reason: "Inspector UI UX rendering is cosmetic; all contract-level assertions (tool discovery, JSON-RPC handshake, hierarchy walk, error shape) are driven programmatically by a real MCP SDK Client against both stdio and Streamable HTTP transports. See 01-HUMAN-UAT.md for the resolution trail and scripts/inspector-smoke.mjs for the drive script."
inspector_smoke_automation:
  script: "scripts/inspector-smoke.mjs"
  checks_total: 56
  checks_passed: 56
  transports_covered: ["stdio", "streamable-http"]
  sdk_version: "@modelcontextprotocol/sdk ^1.29"
  notes:
    - "Zod inputSchema failures are intercepted by MCP SDK 1.29 before the tool handler runs; SH010 returns isError:true with INVALID_SHOT_FORMAT surfaced in content[0].text but NOT in structuredContent.code. Engine-level TypedErrors (DUPLICATE_NAME, PARENT_NOT_FOUND) DO carry structuredContent.code correctly."
    - "Follow-up for Phase 2+ (non-blocking): flatten Zod errors into the same typed envelope so structuredContent.code is consistent across every isError path."
---
```

**Current body state** (lines 196–231, what to replace):
```markdown
### Human Verification Required

Both items below concern the *interactive MCP Inspector UI smoke* that was explicitly deferred in `INSPECTOR-SMOKE.md`. All wire-level automated tests pass; these are the UX/browser-client layer checks that the plan itself flagged as pre-release-only.

#### 1. MCP Inspector UI smoke over stdio

**Test:**
```bash
npx @modelcontextprotocol/inspector npx tsx src/server.ts
```
Open Inspector UI in browser; verify:
- Tool panel lists exactly 4 tools: `workspace`, `project`, `sequence`, `shot`
- Invoke `workspace` with `{"action":"create","name":"test"}` → response shows `structuredContent` with `breadcrumb` (1-entry array) and `breadcrumb_text: "test"`
[…lines 209–231 continue with the second deferral item…]
```

**Target state — section heading + body** (per CONTEXT `## Specific Values` line 191):

Heading replacement: `### Human Verification Required` → `### Automated Verification (Inspector UI Override Accepted)`

Body must reference all four anchor items from CONTEXT D-ATTR-05 line 47:
1. `scripts/inspector-smoke.mjs` (56/56 wire-level checks across stdio + Streamable HTTP)
2. Frontmatter `overrides_applied: 1`
3. Frontmatter `inspector_smoke_automation:` block
4. `INSPECTOR-SMOKE.md` (1:1 Inspector-assertion → automated-test coverage map)

**Things to preserve:**
- The two `####` subheadings (1. stdio, 2. HTTP) shape — but rewritten as **completed-state-of-affairs** (e.g. "Covered by … 56/56 checks") not deferral language
- Reference to `INSPECTOR-SMOKE.md` as the historical 1:1 coverage map (per D-ATTR-05 wording: "See also `INSPECTOR-SMOKE.md`")
- Body must read as **current state**, not "future deferral" — Claude's Discretion line 71: "deferred-to-pre-release language must not persist"

**Things to change:**
- Drop the literal `npx @modelcontextprotocol/inspector` invocation snippets (those were the deferred-to-human commands; they are no longer required)
- Drop the "Why human" rationale paragraphs — the override is now accepted, no need to re-justify the deferral

---

**D-ATTR-06 — Delete lines 241–253 (unfilled override YAML stub with `<name>` / `<ISO timestamp>` placeholders)**

**Current state** (lines 241–253, what to delete entirely):
```markdown
**Recommendation:** Treat status as `human_needed` strictly for the Inspector UI smoke checks. If the developer considers automated coverage (InMemoryTransport parity + live HTTP curl + 76 passing tests) sufficient and wishes to mark Phase 1 complete without the Inspector UI smoke, an override in this VERIFICATION.md's `overrides:` frontmatter would be appropriate:

```yaml
overrides:
  - must_have: "MCP Inspector UI smoke over stdio"
    reason: "Plan explicitly deferred to local pre-release verification; automated coverage maps 1:1 per INSPECTOR-SMOKE.md; transport-parity + stdio-hygiene + live HTTP curl cover the wire-level contract"
    accepted_by: "<name>"
    accepted_at: "<ISO timestamp>"
  - must_have: "MCP Inspector UI smoke over Streamable HTTP"
    reason: "Same as above — UX-layer check not required for Phase 1 functional sign-off"
    accepted_by: "<name>"
    accepted_at: "<ISO timestamp>"
```

With both overrides accepted, status becomes `passed` at 21/21 must-haves.
```

**Things to preserve:**
- Surrounding context above (Gaps Summary, ends around line 239) and below (the closing footer `---\n_Verified: ..._\n_Verifier: ..._` lines 257–260) untouched
- Logical document flow — after the deletion, the section above (`Gaps Summary` ending) flows directly into the closing footer

**Things to change:**
- Wholesale delete the recommendation paragraph + the YAML override stub (the stub is **stale instruction**, not data — the frontmatter `overrides_applied: 1` is the canonical record per CONTEXT D-ATTR-06)

---

### `.planning/phases/01-foundation-hierarchy/INSPECTOR-SMOKE.md` (doc, prepend header)

**Role:** Historical artifact — preserve below the prepended header. Add resolution flag at top.

**D-ATTR-08 — Prepend "Override Accepted 2026-04-24" header paragraph above existing title**

**Current state** (`INSPECTOR-SMOKE.md:1`):
```
# Phase 01 MCP Inspector Smoke — Results

**Plan:** 01-foundation-hierarchy / 01-03
**Date:** 2026-04-21
```

**Target state** — prepend per CONTEXT `## Specific Values` line 192 (verbatim):

```markdown
**Override accepted 2026-04-24.** `scripts/inspector-smoke.mjs` is the authoritative wire-level gate for Phase 1's Inspector UI UX smoke checks (56/56 across stdio + Streamable HTTP). The deferred-to-local-verification framing below is preserved as historical rationale + 1:1 coverage map.

# Phase 01 MCP Inspector Smoke — Results

**Plan:** 01-foundation-hierarchy / 01-03
**Date:** 2026-04-21
```

**Things to preserve:**
- All 170 existing lines below the new header — **the entire historical 1:1 coverage map and curl evidence is kept intact** (CONTEXT D-ATTR-08: "Keeps file intact; flags resolution state at the top so readers know the deferral is closed")
- The `# Phase 01 MCP Inspector Smoke — Results` H1 stays as the document title — the prepended block is plain prose, not a heading
- Backticked filename references (`scripts/inspector-smoke.mjs`) for grep-discoverability

**Things to change:**
- Add ONE blank line between the prepended paragraph and the existing `# Phase 01 …` H1 so markdown renderers don't merge them
- No other edits to the file

---

### `.planning/phases/02-comfyui-generation/02-VERIFICATION.md` (doc, append-only supplement)

**Role:** Append the SDK 1.29 Zod inputSchema caveat as a new H2 section at end of file. **Append-only** — do not edit anything above.

**D-ATTR-09 — Append `## MCP SDK 1.29 Zod inputSchema Envelope Caveat (Phase 8, 2026-04-24)`**

**Closest analog (literal prior-art):** `02-VERIFICATION.md:158-161` — the Phase 7 supplement that already lives in the same file.

**Phase 7 supplement pattern** (`02-VERIFICATION.md:158-161`, verbatim):
```markdown
---

## Endpoint Reconciliation (Phase 7, 2026-04-24)

The Phase 2 live-smoke entry (see §"Behavioral Spot-Checks > Live-smoke gated") remained untested end-to-end until Phase 7 resolved the `COMFYUI_API_BASE` drift observed on 2026-04-22. As of 2026-04-24, the locked `COMFYUI_API_BASE` is `https://cloud.comfy.org`, with `HEALTHCHECK_PATH=/api/system_stats` exported from `src/comfyui/client.ts` and a first-submit healthcheck wired into `ComfyUIClient.submit()` to catch future drift as `TypedError('COMFYUI_ENDPOINT_DRIFT')`. Phase 7 additionally surfaced two Phase 2 tech-debt items fixed in-flight — D-EP-16 (`normalizeCloudStatus` translates Cloud's `'success'`/`'error'` terminals to canonical vocabulary) and D-EP-17 (status fetch switched from the singular `/api/job/{id}/status` endpoint, which omits outputs, to the plural `/api/jobs/{id}` endpoint with a nested-outputs flattener). See [`07-VERIFICATION.md`](../07-comfyui-endpoint-reconciliation/07-VERIFICATION.md) for the probe matrix, credential layout, rotation procedure, and fallback-if-redirected behaviour.
```

**Things to preserve from Phase 7's shape:**
- `---` horizontal rule separator before the new H2 (Phase 7 used one — the cosmetic `---` is **part of the Phase 7 prior-art shape** per Claude's Discretion line 76)
- H2 heading format: `## {Topic} (Phase N, YYYY-MM-DD)` — Phase 8's heading is **literally** `## MCP SDK 1.29 Zod inputSchema Envelope Caveat (Phase 8, 2026-04-24)` per CONTEXT line 194
- Cross-link to the originating phase's canonical doc — Phase 7 linked back to `07-VERIFICATION.md`; Phase 8 should link back to where the live evidence lives (`INSPECTOR-SMOKE.md` §3 per CONTEXT line 110, and the originating phase's authoritative override frontmatter in `01-VERIFICATION.md`)
- Single-paragraph density — Phase 7's supplement is one tight paragraph. Phase 8's spec calls for **three concise paragraphs** per D-ATTR-10, so a logical break per topic (runtime / symptom / engine-contrast) is appropriate

**Things to change vs Phase 7:**
- Three paragraphs instead of one (D-ATTR-10 explicitly: runtime behavior + visible symptom + engine-layer contrast)
- Embed the verbatim Zod-intercept JSON-RPC response from CONTEXT `## Specific Values` lines 205–215 (live evidence) as a fenced code block

**Position:** **End of file**, after the Phase 7 supplement at lines 158–161 (per Claude's Discretion line 76: "Phase 7 supplement is already there (lines 158–161); Phase 8 supplement goes after it").

**Citation targets the body must include** (D-ATTR-10 §1, §2, §3):
- §1 (runtime): cite `src/tools/shot-tool.ts:32` (Zod regex with sentinel — `.regex(SHOT_NAME_REGEX, 'INVALID_SHOT_FORMAT')`) — the SDK 1.29 intercept short-circuits the handler's catch block at lines 106–118. Cite `INSPECTOR-SMOKE.md` §3 lines 97–118 (the live `SH010` repro).
- §2 (symptom): include the verbatim JSON from CONTEXT lines 205–215. Reference `structuredContent.code` is **not populated** for SDK-intercepted Zod errors — the sentinel message (`INVALID_SHOT_FORMAT`) is in `content[0].text` only.
- §3 (engine contrast): cite `src/tools/envelope.ts:32-60` (TypedError → `structuredContent.code` mapping), `src/store/hierarchy-repo.ts:55-63` (DUPLICATE_NAME source) and `:95-101` (PARENT_NOT_FOUND source), and `src/engine/pipeline.ts:19,275-284` (defense-in-depth shot regex enforcement: line 19 imports `SHOT_NAME_REGEX`, lines 275–284 are the `createShot` block with regex test + TypedError throw at line 279; still fires for non-SDK callers).

**No fix proposal** (D-ATTR-10 final sentence): "no code snippet for a `flattenZodError()` helper, no TODO scaffolding."

---

### `.planning/v1.0-MILESTONE-AUDIT.md` (doc, append-only resolution notes)

**Role:** Append "Resolved by Phase 8 (2026-04-24)" notes to three Phase 01 tech_debt items in the YAML frontmatter.

**D-ATTR-03 — Append resolution notes to lines 19–23**

**Closest analog (established pattern):** Phase 7 memory hygiene D-EP-15 — `RESOLVED 2026-04-24` header appended to `project_comfy_api_endpoint_drift.md` (cited in CONTEXT `## Established Patterns` line 153). The audit-file analog is established prior-art: append, never overwrite.

**Current state** (`v1.0-MILESTONE-AUDIT.md:18-23`, the three tech_debt items to mark resolved):
```yaml
tech_debt:
  - phase: 01-foundation-hierarchy
    items:
      - "Inspector UI UX smoke checks (items 1 & 2 of ROADMAP SCs) overridden — now automated via scripts/inspector-smoke.mjs (56/56 wire-level checks pass); browser-client UX layer not manually verified"
      - "Zod inputSchema errors do not flow through the typed structuredContent.code envelope — MCP SDK 1.29 intercepts them before the handler. Non-blocking follow-up for transport parity of error shape"
      - "5 requirement attributions (HIER-06, TOOL-02..05) are verified in 01-VERIFICATION.md but not attributed to any 01-XX-SUMMARY.md frontmatter — documentation-level only, not a functional gap"
```

**Target state — append resolution suffix** (verbatim template from CONTEXT `## Specific Values` line 195):

```
Resolved by Phase 8 (2026-04-24) — see .planning/phases/08-doc-attribution-backfill/08-VERIFICATION.md.
```

**Two acceptable shapes per Claude's Discretion line 77:**

**Shape A (per-item append):**
```yaml
tech_debt:
  - phase: 01-foundation-hierarchy
    items:
      - "Inspector UI UX smoke checks ... not manually verified. Resolved by Phase 8 (2026-04-24) — see .planning/phases/08-doc-attribution-backfill/08-VERIFICATION.md."
      - "Zod inputSchema errors ... error shape. Resolved by Phase 8 (2026-04-24) — see .planning/phases/08-doc-attribution-backfill/08-VERIFICATION.md."
      - "5 requirement attributions ... not a functional gap. Resolved by Phase 8 (2026-04-24) — see .planning/phases/08-doc-attribution-backfill/08-VERIFICATION.md."
```

**Shape B (single closing line at end of Phase 01 block):**
```yaml
tech_debt:
  - phase: 01-foundation-hierarchy
    items:
      - "Inspector UI UX smoke checks ... not manually verified"
      - "Zod inputSchema errors ... error shape"
      - "5 requirement attributions ... not a functional gap"
      - "ALL THREE ITEMS ABOVE: Resolved by Phase 8 (2026-04-24) — see .planning/phases/08-doc-attribution-backfill/08-VERIFICATION.md."
```

**Things to preserve:**
- The three original tech-debt strings — **append-only** — no editing of historical text (CONTEXT line 153 + line 21: "Append-only; preserves audit history")
- Other phases' tech-debt entries (Phase 02 line 24–26, Phase 05 line 27–34) untouched — Phase 8 only touches Phase 01 items
- YAML indentation (two-space indent under `items:`) preserved exactly
- Status flag at line 4 (`status: tech_debt`) **unchanged** — Phase 8 closes 3 of 9 items but does not change milestone status (that's `/gsd-complete-milestone`'s job)

**Things to change:**
- Pick Shape A or Shape B (executor's discretion); both satisfy append-only

**Note on `08-VERIFICATION.md` reference:** The audit notes point at `08-VERIFICATION.md` which **does not yet exist** at planning time — it gets written at phase close (CONTEXT line 78: "08-VERIFICATION.md gets written in phase close, not here"). The forward-reference is intentional; the link resolves once Phase 8 is verified.

---

### YAML Normalization Sweep (D-ATTR-14)

**Scope:** 27 SUMMARY files listed in CONTEXT `## Specific Values` line 199.

**ACTUAL FINDING from filesystem scan:** Only **`01-02-SUMMARY.md`** is currently block-style (lines 60–71). **All other 26 files are already flow-style** — the sweep is a NO-OP for those files.

**Confirmation table (filesystem scan 2026-04-24):**

| File | Current style | Action needed |
|------|---------------|---------------|
| `01-01-SUMMARY.md:83` | flow `[TRNS-04, HIER-01, ...]` | NO-OP (already conformant) |
| `01-02-SUMMARY.md:60-71` | block `- HIER-01\n - HIER-02\n ...` | **REFORMAT** (D-ATTR-01) |
| `01-03-SUMMARY.md:56` | flow `[TRNS-01, TRNS-02, ...]` | NO-OP |
| `02-01..02-03-SUMMARY.md` | flow `[GEN-04, ...]` | NO-OP (3 files) |
| `03-01..03-03-SUMMARY.md` | flow `[PROV-01, ...]` | NO-OP (3 files) |
| `04-01..04-05-SUMMARY.md` | flow (incl. empty `[]` for 04-02) | NO-OP (5 files) |
| `05-01..05-13-SUMMARY.md` | flow `[WEBUI-XX, ...]` | NO-OP (13 files; 05-12 not scanned but expected flow per pattern) |

**Implication for the planner:**
- The D-ATTR-14 normalization sweep collapses to a **single edit on 01-02-SUMMARY.md** which is **identical to the D-ATTR-01 reformat**. The planner should not split this into 27 separate plan-actions; one action suffices.
- The D-ATTR-12 test must still accept both styles (per the invariant above) so future drift on any of these 27 files won't false-flag, AND so the test passes both before AND after the single 01-02 reformat.
- Spot-check 05-12 (not in the awk scan above — the scan covered 05-04 through 05-11 + 05-13) at executor time; 05-12 is in the D-ATTR-14 list and may have a different style. If found block-style, reformat to flow per the same D-ATTR-01 template.

---

## Shared Patterns

### Append-only resolution notation
**Source:** CONTEXT `## Established Patterns` line 153 (Phase 7 prior-art on `project_comfy_api_endpoint_drift.md`)
**Apply to:** `v1.0-MILESTONE-AUDIT.md` (D-ATTR-03), `02-VERIFICATION.md` (D-ATTR-09), `INSPECTOR-SMOKE.md` (D-ATTR-08)

In all three cases, the document's existing content is **not modified**. New material is **prepended** (INSPECTOR-SMOKE.md), **appended** (02-VERIFICATION.md, audit), or **suffixed within an existing item** (audit Shape A). No deletion of historical text. No rewriting of past prose. The only deletion in this phase is **D-ATTR-06's removal of the unfilled override YAML stub at 01-VERIFICATION.md:241–253** — and that stub was already stale instruction (placeholder `<name>` / `<ISO timestamp>`), not authoritative data.

### Phase-tagged supplement heading shape
**Source:** `02-VERIFICATION.md:159` — `## Endpoint Reconciliation (Phase 7, 2026-04-24)`
**Apply to:** `02-VERIFICATION.md` Phase 8 supplement (D-ATTR-09)

The `## {Topic} (Phase N, YYYY-MM-DD)` shape is established Phase 7 prior-art. Phase 8 supplement heading is verbatim `## MCP SDK 1.29 Zod inputSchema Envelope Caveat (Phase 8, 2026-04-24)` per CONTEXT line 194. Future supplements (Phase 9+, milestone close) will inherit this shape.

### Flow-style YAML list convention
**Source:** `01-01-SUMMARY.md:83`, `01-03-SUMMARY.md:56`, plus 24 other Phase 2–5 SUMMARY files
**Apply to:** `01-02-SUMMARY.md:60-71` (D-ATTR-01)

`requirements-completed: [REQ-1, REQ-2, ...]` — single line, comma-space-separated, brackets immediately after the colon-space. Two-thirds of Phase 1 SUMMARY files already use this; the filesystem scan confirms ~26/27 of the D-ATTR-14 in-scope files conform. Normalizing 01-02 brings the full set to one style.

### Cross-cutting invariant test tier under `src/__tests__/`
**Source:** `architecture-purity.test.ts`, `tool-budget.test.ts`, `zero-config.test.ts`, `stdio-hygiene.test.ts`, `transport-parity.test.ts`, `http-origin.test.ts`
**Apply to:** `src/__tests__/phase-attribution.test.ts` (D-ATTR-12)

Phase 8's new test joins this tier flat-in-`src/__tests__/` (NOT in a subdirectory per Claude's Discretion line 75). It runs in the default suite, never gated. Cost budget per D-ATTR-13: ~50 ms. Test file count delta: +1. Skipped test count delta: 0. Architecture purity invariant (zero MCP SDK imports anywhere in `src/__tests__/`) holds — the new test reads markdown only.

### Defense-in-depth regex (Phase 1 T2 pattern, cited in caveat)
**Source:** `01-02-SUMMARY.md:58` (T2 pattern), `src/tools/shot-tool.ts:32` (Zod regex w/ sentinel) + `:106-118` (handler catch), `src/engine/pipeline.ts:19` (regex import) + `:275-284` (createShot block w/ TypedError throw at line 279)
**Apply to:** `02-VERIFICATION.md` Phase 8 supplement §3 (engine-layer contrast paragraph)

The Phase 1 T2 pattern (Zod-at-tool + regex-at-engine) is the reason SDK 1.29's inputSchema intercept doesn't fully break the shot-regex contract — engine-level enforcement still fires for non-SDK callers. The supplement's §3 must cite this so readers understand why `INVALID_SHOT_FORMAT` is still **reachable** via the typed envelope (just not via the MCP handler path today).

---

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| (none) | — | All 7 unique-touched-files / 1 new file have at least role-match analogs in the codebase or planning docs. |

---

## Subtle Invariants (planner MUST surface in plan actions)

1. **Two YAML styles must both parse** — `phase-attribution.test.ts` accepts flow `[A, B]` AND block `- A\n - B`. If the executor implements only flow-parse, the test will false-fail on `01-02-SUMMARY.md` BEFORE D-ATTR-01 normalization runs. Build Order step 2 (per CONTEXT lines 171–172) explicitly says the test must be green on the pre-normalization tree.

2. **"None" phase skip allow-list** — Phases 6, 7, 8, 9 declare `**Requirements**: None (...)` per ROADMAP. The test must skip these. Without the skip, every gap-closure phase fails the union-⊇ assertion (since their plan SUMMARYs declare zero requirements but the ROADMAP cites no requirements either — the assertion would degenerate). Allow-list per CONTEXT line 200.

3. **Audit notes are append-only** — Do not rewrite the three Phase 01 tech-debt strings (`v1.0-MILESTONE-AUDIT.md:21-23`). Append a resolution suffix (Shape A) or a closing line (Shape B), but the original prose stays as-is. The `audited: 2026-04-23T23:00:00Z` frontmatter timestamp **is also unchanged** — Phase 8 does not re-audit, it resolves prior-audited items.

4. **Phase 7 supplement is the literal template, not just inspiration** — The `## {Topic} (Phase N, YYYY-MM-DD)` heading shape, the `---` separator before it, the cross-link back to the originating phase's authoritative doc, the prose density — all four are inherited from `02-VERIFICATION.md:158-161`. Phase 8 supplement sits **immediately after** Phase 7's supplement.

5. **D-ATTR-14 is mostly NO-OP** — Filesystem scan confirms only `01-02-SUMMARY.md` is block-style today; the other 26 files in the D-ATTR-14 list are already flow-style. The planner should not produce 27 separate plan actions; one D-ATTR-01-shaped action covers the lone normalization. Spot-check 05-12 at executor time as a precaution.

6. **No source-code touches** — Zero edits under `src/engine/**`, `src/store/**`, `src/tools/**`, `src/comfyui/**`, `src/http/**`, `packages/dashboard/**`. The lone source-tree write is `src/__tests__/phase-attribution.test.ts` (NEW). Architecture purity invariant from `architecture-purity.test.ts` holds without modification — the new test does not import `@modelcontextprotocol/sdk`, `better-sqlite3`, or `drizzle-orm`. Tool budget invariant (7 tools) holds — Phase 8 registers no tools.

7. **`overrides_applied: 0` on `02-VERIFICATION.md` does not change** — Phase 8's supplement is informational forward-projection of the SDK 1.29 caveat, not a Phase 2 override. Frontmatter (`02-VERIFICATION.md:1-8`) stays untouched. New supplement appends at end, after Phase 7's supplement.

8. **D-ATTR-07 cross-link is one sentence, not a section** — CONTEXT line 49 emphasizes "single sentence — ... One cross-ref, zero duplication." The new bullet should not duplicate the override rationale already in `01-VERIFICATION.md`'s frontmatter; it should grep-link to it.

9. **`08-VERIFICATION.md` is forward-referenced but not yet written** — The audit resolution notes (D-ATTR-03) and possibly the supplement cross-links point at `08-VERIFICATION.md`. That file is created at phase close (CONTEXT line 78), not in this planning step. Forward-reference is intentional; the link is dead until phase close.

---

## Metadata

**Analog search scope:**
- `src/__tests__/` (6 files scanned for cross-cutting test patterns)
- `.planning/phases/01-foundation-hierarchy/` (5 docs scanned: 01-01..01-03 SUMMARY, 01-VERIFICATION, INSPECTOR-SMOKE)
- `.planning/phases/02-comfyui-generation/02-VERIFICATION.md` (Phase 7 supplement prior-art)
- `.planning/phases/05-web-dashboard/` (13 SUMMARY files spot-scanned for YAML style)
- `.planning/phases/0[1-5]-*/0?-0?-SUMMARY.md` (full 27-file YAML style scan via awk)
- `.planning/v1.0-MILESTONE-AUDIT.md` (audit register)

**Files scanned:** ~40 (test sources + planning docs + audit + ROADMAP)
**Pattern extraction date:** 2026-04-24
