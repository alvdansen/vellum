# Phase 09: Nyquist Wave 0 Closure - Pattern Map

**Mapped:** 2026-04-28
**Files analyzed:** 8 deliverables (1 new source file + 5 modified VALIDATION.md + 1 modified audit doc + 1 new VERIFICATION.md)
**Analogs found:** 8 / 8 (100% coverage; this is a docs-heavy retrofit phase, all targets have direct precedents)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/__tests__/validation-flags.test.ts` | test (cross-cutting invariant) | filesystem-read + regex-parse | `src/__tests__/phase-attribution.test.ts` | exact (Phase 8 sibling — same shape) |
| `.planning/phases/01-foundation-hierarchy/01-VALIDATION.md` | doc (modified, heavy) | docs-only | `04-VALIDATION.md` (frontmatter target) + `03-VALIDATION.md` (Per-Task Map shape) | exact |
| `.planning/phases/02-comfyui-generation/02-VALIDATION.md` | doc (modified, heavy) | docs-only | `04-VALIDATION.md` + `03-VALIDATION.md` | exact |
| `.planning/phases/03-provenance-versioning/03-VALIDATION.md` | doc (modified, light) | docs-only | `04-VALIDATION.md` (frontmatter only) | exact |
| `.planning/phases/04-asset-management/04-VALIDATION.md` | doc (modified, cosmetic-flip) | docs-only | self (1-line frontmatter edit) | trivial |
| `.planning/phases/05-web-dashboard/05-VALIDATION.md` | doc (modified, heavy) | docs-only | `04-VALIDATION.md` + `03-VALIDATION.md` | exact |
| `.planning/v1.0-MILESTONE-AUDIT.md` | doc (modified, surgical) | docs-only | self (Phase 8 append precedent at `tech_debt.phase: 01-foundation-hierarchy.items[]`) + Phase 7 supplement section in `02-VERIFICATION.md` | exact |
| `.planning/phases/09-nyquist-wave0-closure/09-VERIFICATION.md` | doc (new) | docs-only | `08-VERIFICATION.md` | exact |

---

## Pattern Assignments

### `src/__tests__/validation-flags.test.ts` (NEW)

**Role:** Cross-cutting Vitest invariant test (joins `architecture-purity.test.ts`, `tool-budget.test.ts`, `phase-attribution.test.ts`, `zero-config.test.ts`, `stdio-hygiene.test.ts`, `transport-parity.test.ts` tier).

**Closest analog:** `src/__tests__/phase-attribution.test.ts` (Phase 8 sibling, byte-for-byte the closest precedent — parses ROADMAP.md + per-phase planning doc, asserts coverage; Phase 9's test does the same shape but on VALIDATION.md frontmatter flags instead of SUMMARY frontmatter `requirements-completed`)

**Secondary analogs:**
- `src/__tests__/tool-budget.test.ts` — `readFile` + multi-line regex pattern for filesystem-parsing (model for ROADMAP phase-block enumeration)
- `src/__tests__/architecture-purity.test.ts` — `describe + it` cross-cutting invariant shape with file-path-named failure messages

**What to copy from analog (`phase-attribution.test.ts`):**

1. **Imports + ESM filesystem usage** (lines 1-3):
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { readdirSync, readFileSync, statSync } from 'node:fs';
   import { join } from 'node:path';
   ```

2. **Hand-rolled YAML frontmatter extraction pattern** — Phase 9 needs `---\n(.*?)\n---` extraction + per-key regex for the three flags (`status`, `nyquist_compliant`, `wave_0_complete`). Phase 8's `extractRequirementsCompleted` (lines 28-56) is the model:
   ```typescript
   function extractRequirementsCompleted(summaryContent: string): string[] {
     // Flow style: requirements-completed: [A, B, C] (single line, possibly empty [])
     const flowMatch = summaryContent.match(/^requirements-completed:\s*\[([^\]]*)\]/m);
     if (flowMatch) {
       const inner = flowMatch[1].trim();
       if (inner.length === 0) return [];
       return inner.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
     }
     // Block style: ...
     // Key not present in the file — contribute empty set
     return [];
   }
   ```
   Phase 9 adapts this to a tighter `extractFlag(content, key) → string | null` helper since VALIDATION.md frontmatter is always block-style scalar values (not lists).

3. **ROADMAP phase enumeration regex with end-of-string fix** (lines 78-127):
   ```typescript
   function parseRoadmap(roadmapContent: string): PhaseInfo[] {
     const phases: PhaseInfo[] = [];
     // Match each phase block: ### Phase N: Title\n...\n**Requirements**: <line>
     // Use [\s\S] to span newlines; non-greedy match to stop at next ### Phase
     // header or end of file. JavaScript regex has no \Z anchor — use
     // $(?![\s\S]) as a portable true-end-of-string lookahead that works
     // regardless of the multiline flag.
     const phasePattern = /^### Phase (\d+(?:\.\d+)?): ([^\n]+)\n([\s\S]*?)(?=^### Phase |$(?![\s\S]))/gm;
     for (const m of roadmapContent.matchAll(phasePattern)) {
       const phaseNum = parseFloat(m[1]);
       const block = m[3];
       // ... extract title-line + reqs-line + checkbox state
     }
     return phases;
   }
   ```
   Phase 9 reuses `phasePattern` verbatim (or near-verbatim — may need to capture the title-line for `[GAP CLOSURE]` substring search per D-WAVE0-18). Critical to keep the `$(?![\s\S])` end-of-string lookahead.

4. **Phase-directory discovery via prefix-scan** (lines 102-118):
   ```typescript
   const padded = Math.floor(phaseNum) < 10 && !m[1].includes('.')
     ? m[1].padStart(2, '0')
     : m[1];
   let phaseDir = '';
   try {
     for (const entry of readdirSync(PHASES_DIR)) {
       if (entry.startsWith(`${padded}-`)) {
         phaseDir = entry;
         break;
       }
     }
   } catch {
     // Phase directory may not exist yet for unstarted phases
   }
   ```
   Reused identically. Phase 9's test then constructs `${PHASES_DIR}/${phaseDir}/${padded}-VALIDATION.md` and runs the four assertions (file exists + 3 flag values).

5. **Top-level `describe` + per-rule `it` shape with informative failure messages** (lines 129-201):
   ```typescript
   describe('phase attribution (D-ATTR-12)', () => {
     const roadmapContent = readFileSync(ROADMAP_PATH, 'utf8');
     const phases = parseRoadmap(roadmapContent);

     it('parses ROADMAP.md and finds at least 9 phase blocks', () => {
       expect(phases.length).toBeGreaterThanOrEqual(9);
     });

     it('skips gap-closure phases (6, 7, 8, 9) per D-ATTR-12 allow-list', () => {
       for (const p of phases) {
         if (SKIPPED_PHASES.has(p.number)) {
           expect(p.isSkipped, `Phase ${p.number} ROADMAP says **Requirements**: should be "None"`).toBe(true);
         }
       }
     });
     // ...
   });
   ```
   Phase 9 adapts: top describe is `describe('validation flags (D-WAVE0-14..18)', () => {...})`, top-of-file `const roadmapContent = readFileSync(ROADMAP_PATH, 'utf8'); const phases = parseRoadmap(roadmapContent);` is identical, and each `it()` block is named after the property it asserts (`'every non-gap-closure complete phase has VALIDATION.md'`, `'each VALIDATION.md sets status: closed'`, etc.).

6. **Aggregation-then-assert pattern with multi-line failure message** (lines 156-182) — the `failures` array of strings + `expect(failures, failures.join('\n')).toEqual([])` idiom for collecting all violations across the phase loop and reporting them all at once instead of failing on the first. Phase 9 needs this so a single test run shows every phase that fails (rather than only the first).

7. **Direct-shape unit tests of helper parsers** (lines 184-201) — `it('extractFlag parses status: closed', () => { ... })` red→green proof. Phase 9 should add 4-5 small parser tests for `extractFlag('status', 'status: closed\n') → 'closed'`, `extractFlag('nyquist_compliant', '...\nnyquist_compliant: true\n...') → 'true'`, etc. These give the executor a Wave 0 RED→GREEN proof.

**What to copy from `tool-budget.test.ts`:**

1. **Multi-line regex with `s` flag for spans across newlines** (lines 41-57):
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
   Same `readFileSync + matchAll` shape Phase 9 will use to read each VALIDATION.md and extract the three frontmatter flag values.

**What to copy from `architecture-purity.test.ts`:**

1. **Top-level `describe` per logical concern + per-file `it` blocks naming the file path in the test name** (lines 33-81):
   ```typescript
   describe('architecture purity', () => {
     it('src/engine/ has zero imports from @modelcontextprotocol/sdk', () => {
       expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/')).toBe(0);
     });
     // ...
   });
   ```
   Phase 9's test names mirror this shape: `it('phase 01 VALIDATION.md exists', ...)`, `it('phase 01 VALIDATION.md has status: closed', ...)`, etc. — file-path-named for fast triage when one fails.

**Adaptations needed (analog → this file):**

- Replace SUMMARY-file enumeration + `requirements-completed` parsing with single VALIDATION.md per phase + 3 flag parsers
- Replace `SKIPPED_PHASES = new Set([6, 7, 8, 9])` with dynamic `[GAP CLOSURE]` substring detection in ROADMAP phase title (D-WAVE0-18 — auto-exempts future gap-closure phases without test code edit)
- Add ROADMAP completeness checkbox detection: only assert on phases marked `- [x]` in ROADMAP (D-WAVE0-14)
- Strict equality: `status === 'closed'` (not `!== 'draft'`) per D-WAVE0-15
- File-existence assertion: `existsSync(validationPath)` is strict-required for non-exempt complete phases (D-WAVE0-16)
- Cost budget: ~50ms (filesystem read + regex parse, identical to Phase 8's `phase-attribution.test.ts` per CONTEXT.md `## Specifics` line 297)

**Code excerpt skeleton (composed from analogs above; executor fills concrete logic):**

```typescript
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Asserts D-WAVE0-14..18: every v1.0 functional phase marked complete
 * (- [x]) in ROADMAP.md whose title does NOT contain "[GAP CLOSURE]"
 * has a VALIDATION.md with `status: 'closed'`, `nyquist_compliant: true`,
 * `wave_0_complete: true` in its frontmatter.
 *
 * Cost budget: ~50ms (filesystem reads + regex parse, no spawn/network/DB).
 */

const PHASES_DIR = '.planning/phases';
const ROADMAP_PATH = '.planning/ROADMAP.md';

interface PhaseInfo {
  number: number;
  title: string;            // "Phase 1: Foundation & Hierarchy"
  isComplete: boolean;       // true if ROADMAP marks - [x]
  isGapClosure: boolean;     // true if title contains "[GAP CLOSURE]"
  phaseDir: string;          // "01-foundation-hierarchy"
}

function extractFlag(content: string, key: string): string | null {
  // Match `key: value` on its own line in the YAML frontmatter
  const m = content.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  return m ? m[1] : null;
}

function parseRoadmap(roadmapContent: string): PhaseInfo[] {
  // ROADMAP entries live in a top-level checklist (not under ### Phase
  // headings) — adapt phase-attribution.test.ts pattern to match
  // `- [x] **Phase N: Title** - description` lines instead.
  // Executor: refine regex for the actual ROADMAP format if different.
  // ...
}

describe('validation flags (D-WAVE0-14..18)', () => {
  const roadmapContent = readFileSync(ROADMAP_PATH, 'utf8');
  const phases = parseRoadmap(roadmapContent);

  it('parses ROADMAP.md and finds at least 9 phase blocks', () => {
    expect(phases.length).toBeGreaterThanOrEqual(9);
  });

  it('every complete non-gap-closure phase has VALIDATION.md with the 3 closure flags set', () => {
    const failures: string[] = [];
    for (const p of phases) {
      if (!p.isComplete) continue;
      if (p.isGapClosure) continue;
      const validationPath = join(PHASES_DIR, p.phaseDir, `${String(p.number).padStart(2, '0')}-VALIDATION.md`);
      if (!existsSync(validationPath)) {
        failures.push(`Phase ${p.number} (${p.phaseDir}): VALIDATION.md missing at ${validationPath}`);
        continue;
      }
      const content = readFileSync(validationPath, 'utf8');
      const status = extractFlag(content, 'status');
      const nyquist = extractFlag(content, 'nyquist_compliant');
      const wave0 = extractFlag(content, 'wave_0_complete');
      if (status !== 'closed') failures.push(`Phase ${p.number}: status=${status} (expected 'closed')`);
      if (nyquist !== 'true') failures.push(`Phase ${p.number}: nyquist_compliant=${nyquist} (expected 'true')`);
      if (wave0 !== 'true') failures.push(`Phase ${p.number}: wave_0_complete=${wave0} (expected 'true')`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  // Direct-shape unit tests of the parsers (Wave 0 RED→GREEN proof).
  it('extractFlag parses status: closed', () => {
    expect(extractFlag('---\nstatus: closed\n---\n', 'status')).toBe('closed');
  });

  it('extractFlag parses nyquist_compliant: true', () => {
    expect(extractFlag('nyquist_compliant: true\n', 'nyquist_compliant')).toBe('true');
  });

  it('extractFlag returns null for missing key', () => {
    expect(extractFlag('phase: 5\n', 'status')).toBeNull();
  });
});
```

**Critical constraint:** Zero `@modelcontextprotocol/sdk` imports, zero DB imports. Test reads planning files only — joins the same purity tier as `phase-attribution.test.ts` (CONTEXT.md `<canonical_refs>` line 169 + `## Specifics` line 304).

---

### `.planning/phases/04-asset-management/04-VALIDATION.md` (modified, COSMETIC FLIP only)

**Role:** Compliant template — both flags already true. Phase 9 makes a 1-line frontmatter edit.

**Closest analog:** Self. Lines 1-7 of this file are the COMPLIANT FRONTMATTER TEMPLATE the other 4 retrofits target.

**What to copy from analog:** The frontmatter shape itself.

**Code excerpt (lines 1-8 of `04-VALIDATION.md` — the compliant template):**
```yaml
---
phase: 4
slug: asset-management
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-22
---
```

**Adaptations needed:**
- Single edit on line 4: `status: draft` → `status: closed`
- Append `## Validation Audit 2026-04-28` trail per State A workflow contract (see Shared Pattern §"Audit trail per VALIDATION.md" below)

---

### `.planning/phases/01-foundation-hierarchy/01-VALIDATION.md` (modified, HEAVY)

**Role:** Heaviest fill — 16 task entries with `Plan: TBD, Wave: TBD`, plus Manual-Only Inspector UI smoke retrofit.

**Closest analog (frontmatter target):** `04-VALIDATION.md` lines 1-8 (compliant template).

**Closest analog (Per-Task Map shape):** `03-VALIDATION.md` lines 41-59 — the populated-with-final-task-IDs precedent.

**Closest analog (Manual-Only override format):** `INSPECTOR-SMOKE.md` line 1 prepended override note + Phase 7 supplement section in `02-VERIFICATION.md` lines 158-161.

**What to copy from analogs:**

1. **Frontmatter triple-flip target** (from `04-VALIDATION.md`):
   ```yaml
   ---
   phase: 01
   slug: foundation-hierarchy
   status: closed              # was draft
   nyquist_compliant: true     # was false
   wave_0_complete: true       # was false
   created: 2026-04-20
   ---
   ```

2. **Per-Task Map row format with final task IDs** (from `03-VALIDATION.md` lines 43-59 — the gold reference):
   ```markdown
   | Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
   |---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
   | 03-01-01 | 01 | 1 | PROV-01, PROV-02 | T-03-03 | schema migration 0003 + drizzle declarations (provenance + lineage_type) — type-level verification | schema | `npx tsc --noEmit` | ✅ | ⬜ pending |
   | 03-01-02 | 01 | 1 | PROV-01 | — | migration 0003 applies automatically via migrate() in openDb() (no drizzle-kit push) | infra | `npx vitest run src/store/__tests__/migrate.test.ts` | ❌ W0 | ⬜ pending |
   ```
   Use `{padded_phase}-{plan}-{NN}` form (e.g. `01-01-01`, `01-02-03`). Walk `01-01/02/03-PLAN.md` files in numeric order to extract task IDs.

3. **Per-Task Map Status column convention**:
   ```
   *Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
   ```
   Per D-WAVE0-09: PARTIAL/skipped rows get ⚠️ flaky in Status; preserve any existing ❌ W0 markings (none expected per current 754/757 baseline).

4. **Manual-Only override row format** (from CONTEXT.md `<specifics>` line 282 verbatim):
   ```markdown
   | MCP Inspector over stdio | TRNS-01 | Replaced by automated wire-level smoke (Phase 8 override accepted 2026-04-24) | Run `node scripts/inspector-smoke.mjs` — 56/56 checks across stdio + Streamable HTTP. See `01-VERIFICATION.md` frontmatter `overrides_applied: 1` and `INSPECTOR-SMOKE.md` for the 1:1 coverage map. |
   ```
   Replace 3 rows ("MCP Inspector over stdio" / "...over Streamable HTTP" / "Cold-start demo") at lines 84-89 of current `01-VALIDATION.md`. Keep "Cold-start demo" as Manual-Only (zero-config UX from cold environment is not covered by `inspector-smoke.mjs`) per D-WAVE0-08 final clause.

5. **Audit trail format** (Shared Pattern §"Audit trail per VALIDATION.md" — see below).

**Adaptations needed:**
- Replace lines 46-61 (16 TBD-task rows) with task-ID rows extracted from `01-01/02/03-PLAN.md` files
- Flip frontmatter at lines 1-7
- Replace lines 84-89 (Manual-Only Inspector smoke block)
- Append audit trail at end of file
- Preserve everything else verbatim (Test Infrastructure, Sampling Rate, Wave 0 Requirements list at lines 71-78, Sign-Off section)

**Code excerpt (current state to replace) — `01-VALIDATION.md` lines 84-89:**
```markdown
| MCP Inspector over stdio | TRNS-01 | Real MCP client roundtrip — protocol framing, capability negotiation, tool discovery | `npx @modelcontextprotocol/inspector npx tsx src/server.ts` → open Inspector UI → verify 4 tools listed → invoke `workspace action=create name=test` → see breadcrumb in response |
| MCP Inspector over Streamable HTTP | TRNS-02 | Transport-specific integration — session handshake, HTTP transport framing | `npx tsx src/server.ts --http` in one terminal; `npx @modelcontextprotocol/inspector` → select HTTP, URL `http://localhost:3000/mcp` → verify same 4 tools → invoke `workspace action=list` → see envelope |
| Cold-start demo | TRNS-04 | Validates zero-config claim against a truly empty environment | `rm -f ./vfx-familiar.db && npx tsx src/server.ts --http` → Inspector → create workspace → project → sequence → shot (`sh010`) → verify breadcrumb walks correctly at each step |
```

---

### `.planning/phases/02-comfyui-generation/02-VALIDATION.md` (modified, HEAVY)

**Role:** Per-Requirement → Per-Task table conversion + frontmatter triple-flip.

**Closest analog (frontmatter target):** `04-VALIDATION.md` lines 1-8.

**Closest analog (Per-Task Map shape):** `03-VALIDATION.md` lines 41-59.

**What to copy from analogs:** Same as Phase 01 above — frontmatter shape from `04-VALIDATION.md`, Per-Task Map row format from `03-VALIDATION.md`. Walk `02-01/02/03-PLAN.md` files for task IDs (use `02-{plan}-{NN}` form).

**Adaptations needed:**
- Convert lines 39-62 (current Per-Requirement table — see excerpt) into Per-Task table with final task IDs
- Note: current table uses `Req ID | Behavior | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status` — Phase 9 expands to the 10-column Per-Task shape with `Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status`
- Each task row preserves the existing `Threat Ref` / `Secure Behavior` / `Automated Command` content; only Task ID + Plan + Wave columns are newly populated
- Existing `Cross-cutting` and `Migration` rows in 02-VALIDATION.md (lines 58-61) merge into the appropriate task rows

**Code excerpt (current state to convert) — `02-VALIDATION.md` lines 39-44 (sample rows):**
```markdown
| Req ID | Behavior | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|------------|-----------------|-----------|-------------------|-------------|--------|
| GEN-01 | submit inserts version row with status='submitted', job_id from `prompt_id` | V5 / V8 | Zod rejects malformed workflow at tool boundary; no raw ComfyUI errors surfaced | unit | `npx vitest run src/engine/__tests__/generation.test.ts -t "submit inserts version row"` | ❌ W0 | ⬜ pending |
```

---

### `.planning/phases/03-provenance-versioning/03-VALIDATION.md` (modified, LIGHT)

**Role:** Already has Per-Task Map populated. Only frontmatter `wave_0_complete: false → true` and `status: draft → closed` need flipping. `nyquist_compliant: true` already set.

**Closest analog:** Self (Per-Task Map already final at lines 41-59) + `04-VALIDATION.md` for frontmatter target.

**What to copy from analog:** Confirm no drift in lines 41-59. Target frontmatter:

```yaml
---
phase: 3
slug: provenance-versioning
status: closed              # was draft
nyquist_compliant: true     # already set — preserved
wave_0_complete: true       # was false
created: 2026-04-22
---
```

**Adaptations needed:**
- 2-line frontmatter edit only (lines 4 + 6)
- Preserve Validation Sign-Off section (lines 102-107) which already shows checkmarks
- Preserve everything else verbatim
- Append audit trail

---

### `.planning/phases/05-web-dashboard/05-VALIDATION.md` (modified, HEAVY)

**Role:** Per-Requirement → Per-Task table conversion across 13 plans (largest fill).

**Closest analog (frontmatter target):** `04-VALIDATION.md` lines 1-8.

**Closest analog (Per-Task Map shape):** `03-VALIDATION.md` lines 41-59.

**What to copy from analogs:** Same as Phase 01 + Phase 02. Walk `05-01-PLAN.md` through `05-13-PLAN.md` (13 files, the most plans of any v1.0 functional phase) for task IDs.

**Adaptations needed:**
- Convert lines 42-55 (current Per-Requirement table) into Per-Task with final task IDs across 13 plans
- Use `05-{plan}-{NN}` form
- Preserve dashboard-specific Wave 0 Requirements list at lines 63-70 (`packages/dashboard/vitest.config.ts`, `packages/dashboard/src/__tests__/setup.ts`, root `vitest.config.ts` exclude pattern)
- Cosmetic note: 05-VALIDATION uses `created: 2026-04-23` (not 2026-04-20 like Phase 01); preserve

**Code excerpt (current state to convert) — `05-VALIDATION.md` lines 42-44:**
```markdown
| Requirement | Coverage Layer | Test File(s) | Test Type | Automated Command | Status |
|-------------|----------------|--------------|-----------|-------------------|--------|
| WEBUI-01 (browse hierarchy) | Server unit | `src/http/__tests__/dashboard-routes.test.ts` | unit | `npx vitest run src/http/__tests__/dashboard-routes.test.ts` | ⬜ pending |
```

Note: this table has 6 columns (`Requirement | Coverage Layer | Test File(s) | Test Type | Automated Command | Status`) — different shape from Phase 02's. Phase 9 conversion to Per-Task expands BOTH to the canonical 10-column form from Phase 03.

---

### `.planning/v1.0-MILESTONE-AUDIT.md` (modified, SURGICAL)

**Role:** Frontmatter flag flips + body Nyquist Compliance table refresh + closing paragraph rewrite + append-only `## Phase 9 Closure (2026-04-28)` section.

**Closest analog (in-place flip pattern):** Phase 8's edits to lines 21-23 (the three `tech_debt.phase: 01-foundation-hierarchy.items[]` rows that received `Resolved by Phase 8 (2026-04-24)` suffixes — same audit doc, different field).

**Closest analog (append-only supplement-section pattern):** Phase 7's `## Endpoint Reconciliation (Phase 7, 2026-04-24)` section appended to `02-VERIFICATION.md` (lines 158-161). Phase 8's `## MCP SDK 1.29 Zod inputSchema Envelope Caveat (Phase 8, 2026-04-24)` (lines 165-184) appended after Phase 7's. Both gap-closure phases append, never modify the original audit body.

**Phase 9 audit doc edit splits into THREE patterns:**

1. **Frontmatter in-place flips** (target state — current state at lines 5-15 shown for contrast):

   Current lines 10-13:
   ```yaml
     nyquist:
       compliant: 1
       partial: 4
       missing: 0
   ```

   Target:
   ```yaml
     nyquist:
       compliant: 5
       partial: 0
       missing: 0
   ```

   Current lines 35-39:
   ```yaml
   nyquist:
     compliant_phases: [04-asset-management]
     partial_phases: [01-foundation-hierarchy, 02-comfyui-generation, 03-provenance-versioning, 05-web-dashboard]
     missing_phases: []
     overall: partial
   ```

   Target:
   ```yaml
   nyquist:
     compliant_phases: [01-foundation-hierarchy, 02-comfyui-generation, 03-provenance-versioning, 04-asset-management, 05-web-dashboard]
     partial_phases: []
     missing_phases: []
     overall: compliant
   ```

2. **Body §"Nyquist Compliance" table refresh** (lines 154-164 of audit doc — current state):

   Current table:
   ```markdown
   | Phase | VALIDATION.md | nyquist_compliant | wave_0_complete | Status |
   |-------|---------------|-------------------|-----------------|--------|
   | 01 | exists (draft) | false | false | PARTIAL — strategy defined, Wave 0 not closed |
   | 02 | exists (draft) | false | false | PARTIAL — strategy defined, Wave 0 not closed |
   | 03 | exists (draft) | true | false | PARTIAL — compliance flag set, Wave 0 not closed |
   | 04 | exists (draft) | true | true | COMPLIANT |
   | 05 | exists (draft) | false | false | PARTIAL — strategy defined, Wave 0 not closed |
   ```

   Target: flip `nyquist_compliant`, `wave_0_complete`, `Status` columns to true/true/COMPLIANT for all 5 rows. Update `VALIDATION.md` column `(draft)` → `(closed)` for all 5. Preserve original audit timestamps (the table doesn't show timestamps but the surrounding paragraphs reference 2026-04-23 — preserve).

3. **Closing paragraph rewrite** (lines 164-166 of audit doc):

   Current:
   ```
   **Overall:** partial. Only Phase 04 closes Wave 0 validation. The remaining four phases have VALIDATION.md scaffolds (`status: draft`) but did not close Wave 0...

   **Optional follow-ups if you want full Nyquist compliance before archival:** run `/gsd-validate-phase {01,02,03,05}` to fill the Wave 0 gaps per phase...
   ```

   Target: rewrite to "Overall: compliant. All 5 phases close Wave 0 validation..." per D-WAVE0-11 closing paragraph rewrite. Per Claude's Discretion in CONTEXT.md, executor may also delete the "Optional follow-ups" line entirely — Phase 9 closes that gap, so the line is now stale.

4. **Append-only `## Phase 9 Closure (2026-04-28)` section** (per D-WAVE0-13, mirrors Phase 7/8 supplement shape):

   Position: near end-of-file, BEFORE the `_Audited:_` footer at line 215.

   Phase 7's supplement-section pattern (from `02-VERIFICATION.md` line 159):
   ```markdown
   ---

   ## Endpoint Reconciliation (Phase 7, 2026-04-24)

   The Phase 2 live-smoke entry (see §"Behavioral Spot-Checks > Live-smoke gated") remained untested end-to-end until Phase 7 resolved the `COMFYUI_API_BASE` drift observed on 2026-04-22. As of 2026-04-24, the locked `COMFYUI_API_BASE` is `https://cloud.comfy.org`, with `HEALTHCHECK_PATH=/api/system_stats`...
   See [`07-VERIFICATION.md`](../07-comfyui-endpoint-reconciliation/07-VERIFICATION.md) for the probe matrix...
   ```

   Phase 8's supplement-section pattern (from `02-VERIFICATION.md` line 165):
   ```markdown
   ---

   ## MCP SDK 1.29 Zod inputSchema Envelope Caveat (Phase 8, 2026-04-24)

   **Runtime behavior.** ...
   **Visible symptom.** ...
   **Engine-layer contrast.** ...
   ```

   Phase 9's section (from CONTEXT.md `<specifics>` lines 264-279, verbatim):
   ```markdown
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

**Adaptations needed:**
- Append-only — DO NOT modify the original 2026-04-23 audit body
- DO NOT touch Phase 8's "Resolved by Phase 8" markers at lines 21-23 (preserve verbatim)
- DO NOT touch other tech_debt blocks (Phase 02 endpoint drift; Phase 05 WR-04/01/05/IN-01/02/04) per CONTEXT.md `<domain>` (Phase 9 is Wave 0 closure, not tech-debt resolution)

---

### `.planning/phases/09-nyquist-wave0-closure/09-VERIFICATION.md` (NEW)

**Role:** Phase 9's verification doc per D-WAVE0-12.

**Closest analog:** `08-VERIFICATION.md` (Phase 8 sibling, same gap-closure shape).

**What to copy from analog (`08-VERIFICATION.md`):**

1. **Frontmatter** (lines 1-8 of `08-VERIFICATION.md`):
   ```yaml
   ---
   phase: 08-doc-attribution-backfill
   verified: 2026-04-25T00:05:00Z
   status: passed
   score: 6/6 must-haves verified
   overrides_applied: 0
   re_verification: null
   ---
   ```

   Phase 9 adapts:
   ```yaml
   ---
   phase: 09-nyquist-wave0-closure
   verified: 2026-04-28T...Z
   status: passed
   score: 5/5 SCs verified
   overrides_applied: 0
   re_verification: null
   ---
   ```

2. **Title + Phase Goal preamble** (lines 10-17):
   ```markdown
   # Phase 8: Documentation Attribution Backfill Verification Report

   **Phase Goal:** Close the three Phase 1 documentation-only tech debt items so plan-level attribution matches what the Phase 1 VERIFICATION already verified, the inspector UI smoke override is visible in writeup, and the Zod inputSchema envelope caveat is findable.

   **Verified:** 2026-04-25T00:05:00Z
   **Status:** passed
   **Re-verification:** No — initial verification

   ## Goal Achievement
   ```

3. **Observable Truths table** (lines 23-34) — 5-row table for Phase 9, one per ROADMAP SC #1-5. Phase 8 had 6 truths; Phase 9 has 5. Column shape:
   ```markdown
   ### Observable Truths

   | #   | Truth | Status     | Evidence       |
   | --- | ----- | ---------- | -------------- |
   | 1 | `01-02-SUMMARY.md` frontmatter `requirements-completed:` lists all 5 IDs (HIER-06, TOOL-02..05) plus the original 6, matching what 01-VERIFICATION.md attributes to plan 01-02 | VERIFIED | Line 60 of 01-02-SUMMARY.md reads `requirements-completed: [HIER-01, HIER-02, ...]` (flow-style, single line, all 11 IDs in declared order). 01-VERIFICATION.md Requirements Coverage table (lines 161-177) attributes HIER-01..06 + TOOL-01..05 to plan 01-02. Match: complete. |
   ```

   Phase 9 adapts: 5 rows mapping to ROADMAP SC #1 (Phase 01 closes Wave 0), #2 (Phase 02), #3 (Phase 03), #4 (Phase 05), #5 (audit shows compliant after re-audit). Cosmetic Phase 04 flip is mentioned in Required Artifacts table, not Observable Truths (out of strict ROADMAP SC scope per D-WAVE0-10).

4. **Score line + Required Artifacts table** (lines 33-44):
   ```markdown
   **Score:** 6/6 truths verified

   ### Required Artifacts

   | Artifact | Expected | Status | Details |
   | -------- | -------- | ------ | ------- |
   | `src/__tests__/phase-attribution.test.ts` | Cross-cutting Vitest invariant — 8 assertions, accepts both YAML styles, runs in default suite | VERIFIED | 202 lines; 8/8 tests pass in 129ms; ... |
   | ... |
   ```

   Phase 9 lists: 4 retrofitted VALIDATION.md flips + cosmetic 04 + audit doc + new test file (7 rows total).

5. **Key Link Verification table** (lines 46-58):
   ```markdown
   ### Key Link Verification

   | From | To | Via | Status | Details |
   | ---- | -- | --- | ------ | ------- |
   | `src/__tests__/phase-attribution.test.ts` | `.planning/phases/*/[0-9]*-[0-9]*-SUMMARY.md` | `readdirSync` + `readFileSync` + flow/block regex | WIRED | ... |
   ```

   Phase 9 adapts: `src/__tests__/validation-flags.test.ts` → `.planning/ROADMAP.md` + per-phase VALIDATION.md; `09-VERIFICATION.md` → `09-CONTEXT.md` decisions; `v1.0-MILESTONE-AUDIT.md` Phase 9 Closure section → `09-VERIFICATION.md`.

6. **Behavioral Spot-Checks table** (lines 71-89):
   ```markdown
   ### Behavioral Spot-Checks

   Live commands executed during verification:

   | Behavior | Command | Result | Status |
   | -------- | ------- | ------ | ------ |
   | Regression guard runs in default suite | `npx vitest run src/__tests__/phase-attribution.test.ts` | 8 passed in 129ms | PASS |
   | Full Vitest suite green | `npx vitest run` | 754 passed / 3 skipped / 0 failed in 19.56s | PASS |
   ```

   Phase 9 captures: pre-flip baseline (`npx vitest run` → 754/757), post-flip + new test (`npx vitest run` → 755/758 zero regressions), per-phase frontmatter inspections (`grep "^status:" 0{1,2,3,4,5}-VALIDATION.md` → 5x `closed`), audit frontmatter inspection (`grep "overall: compliant" v1.0-MILESTONE-AUDIT.md` → 1 match).

7. **Gaps Summary closing paragraph** (lines 139-147):
   ```markdown
   ### Gaps Summary

   **Zero gaps.** All three ROADMAP success criteria closed; all three orchestrator-additional checks pass; the regression-guard test passes; the full Vitest suite passes; TypeScript is clean. ...
   ```

   Phase 9 adapts: "Zero gaps. All five ROADMAP success criteria closed (4 phase frontmatter triple-flips + audit doc re-audit shows compliant); cosmetic Phase 04 flip closes consistency loop; the new regression guard runs green; the full Vitest suite passes (755/758, +1 from baseline); zero source code modified..."

8. **Footer** (lines 149-153):
   ```markdown
   ---

   _Verified: 2026-04-25T00:05:00Z_
   _Verifier: Claude (gsd-verifier)_
   ```

   Phase 9 adapts the timestamp.

**Adaptations needed:**
- 5 Observable Truths instead of 6 (matches ROADMAP SC count)
- ~80-120 lines target per CONTEXT.md D-WAVE0-12 (Phase 8 was 153 lines; Phase 9 is similar but tighter — fewer must-haves, simpler artifact list)
- Anti-Patterns Found and Requirements Coverage sections per Phase 8: Phase 9 adapts to "Zero anti-patterns" + "Phase 9 declares `**Requirements**: None (gap closure)`" (mirror of Phase 8's lines 92-122)
- Data-Flow Trace section per Phase 8 line 60-68: Phase 9's data-flow analog is "the `validation-flags.test.ts` filesystem walk" — mirror Phase 8's Level 4 trace shape

---

## Shared Patterns

### Audit trail per VALIDATION.md (Phase 9 Step 6 of validate-phase workflow contract)

**Source:** `$HOME/.claude/get-shit-done/workflows/validate-phase.md` Step 6 lines 121-132 + CONTEXT.md `<specifics>` lines 285-295.

**Apply to:** All 5 modified VALIDATION.md files (01, 02, 03, 04, 05).

**Concrete excerpt (verbatim from CONTEXT.md `<specifics>`):**
```markdown
## Validation Audit 2026-04-28

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 (no real gaps surfaced; bookkeeping retrofit only) |
| Escalated | 0 |

Wave 0 closure: nyquist_compliant + wave_0_complete + status:closed all set in frontmatter; Per-Task Verification Map populated with final task IDs; baseline vitest run 754/757 green confirms infrastructure intact. See `.planning/phases/09-nyquist-wave0-closure/09-CONTEXT.md` decisions and `.planning/phases/09-nyquist-wave0-closure/09-VERIFICATION.md` for observable truths.
```

**Position:** Append at end of each VALIDATION.md (after Validation Sign-Off section, after `**Approval:** ...` line, separated by `---`).

**Workflow contract origin (validate-phase.md lines 121-132):**
```markdown
**State A (update):**
1. Update Per-Task Map statuses, add escalated to Manual-Only, update frontmatter
2. Append audit trail:

\`\`\`markdown
## Validation Audit {date}
| Metric | Count |
|--------|-------|
| Gaps found | {N} |
| Resolved | {M} |
| Escalated | {K} |
\`\`\`
```

Phase 9 always reports `0 / 0 / 0` since this is bookkeeping (D-WAVE0-06 expected baseline: zero genuine gaps surface).

---

### Atomic-commit-per-deliverable boundary (Phase 7/8 inheritance)

**Source:** Phase 8's commit history — D-WAVE0-04 in CONTEXT.md.

**Apply to:** All 5 commits Phase 9 produces.

**Pattern:** One commit per VALIDATION.md flip, with the commit message mentioning the specific phase + the audit trail addition. Atomic per-phase = git-revertable in isolation if any flip surfaces a problem.

**Commit messages (verbatim from CONTEXT.md D-WAVE0-04):**
1. `docs(phase-09): close Phase 01 Wave 0`
2. `docs(phase-09): close Phase 02 Wave 0`
3. `docs(phase-09): close Phase 03 Wave 0`
4. `docs(phase-09): close Phase 05 Wave 0`
5. `docs(phase-09): align Phase 04 status + update milestone audit + add regression guard`

---

### Append-only resolution-note pattern (Phase 7/8 inheritance)

**Source:** Phase 8's append at `tech_debt.phase: 01-foundation-hierarchy.items[]` (`v1.0-MILESTONE-AUDIT.md` lines 21-23 — three suffix appends `Resolved by Phase 8 (2026-04-24) — see .planning/phases/08-doc-attribution-backfill/08-VERIFICATION.md.`). Phase 7's `## Endpoint Reconciliation (Phase 7, 2026-04-24)` section appended to `02-VERIFICATION.md` lines 158-161.

**Apply to:** `v1.0-MILESTONE-AUDIT.md` `## Phase 9 Closure (2026-04-28)` section.

**Pattern:** Every gap-closure phase appends a dated section to the relevant upstream doc; never modifies the original audit body. Phase 9's audit doc edit splits into in-place flips (frontmatter + body table truth values) AND append-only narrative — frontmatter/body is corrected truth (the audit's own report changes because state changed), narrative is historical record (the resolution event itself is appended).

---

### Frontmatter flag normalization (compliant template = Phase 04)

**Source:** `04-VALIDATION.md` lines 1-8 (compliant frontmatter template).

**Apply to:** All 5 VALIDATION.md files.

**Pattern:** Three flags per VALIDATION.md (`status`, `nyquist_compliant`, `wave_0_complete`) following exact ROADMAP SC wording.

**Excerpt:**
```yaml
---
phase: {N}
slug: {slug}
status: closed
nyquist_compliant: true
wave_0_complete: true
created: {original-date — preserve}
---
```

Phase-specific notes:
- 01: was `status: draft, nyquist_compliant: false, wave_0_complete: false` → all flipped
- 02: was `status: draft, nyquist_compliant: false, wave_0_complete: false` → all flipped
- 03: was `status: draft, nyquist_compliant: true, wave_0_complete: false` → 2 flipped (`nyquist_compliant` preserved)
- 04: was `status: draft, nyquist_compliant: true, wave_0_complete: true` → 1 flipped (cosmetic)
- 05: was `status: draft, nyquist_compliant: false, wave_0_complete: false` → all flipped
- `created` field preserved verbatim (do NOT update to 2026-04-28 — Phase 9 closes the doc, doesn't re-create it)

---

### Cross-cutting test tier purity (no MCP SDK, no DB)

**Source:** `architecture-purity.test.ts` describe block lines 33-81 + `phase-attribution.test.ts` line 130 + `tool-budget.test.ts` line 19.

**Apply to:** `src/__tests__/validation-flags.test.ts`.

**Pattern:** Cross-cutting invariant tests under `src/__tests__/` (flat) read planning/source files only via `node:fs` + regex parsing. Zero `@modelcontextprotocol/sdk` imports. Zero `better-sqlite3` / `drizzle-orm` imports. Run always (default suite, not gated). Cost ~50ms each.

**Concrete: imports allowed:**
```typescript
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
```

**Concrete: imports forbidden** (would fail `architecture-purity.test.ts`):
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/...';   // FORBIDDEN
import Database from 'better-sqlite3';                        // FORBIDDEN (architecture purity)
import { drizzle } from 'drizzle-orm/...';                    // FORBIDDEN (architecture purity)
```

(`architecture-purity.test.ts` only enforces these on `src/engine/`, `src/store/`, `src/utils/`, `src/types/`, `src/comfyui/`, `src/http/` — not on `src/__tests__/`. But CONTEXT.md `<canonical_refs>` line 169 + `## Specifics` line 304 bind Phase 9's test to the same purity tier voluntarily, since the cross-cutting tests are conceptually pure-by-convention.)

---

## No Analog Found

None. This is a docs-heavy retrofit phase with strong precedents at every position:
- Cross-cutting test analog: `phase-attribution.test.ts` (Phase 8, exact match)
- Frontmatter analog: `04-VALIDATION.md` (compliant template)
- Per-Task Map analog: `03-VALIDATION.md` (populated precedent)
- Audit doc append analog: Phase 8's `tech_debt.phase` markers + Phase 7's supplement section
- VERIFICATION.md analog: `08-VERIFICATION.md` (gap-closure shape)
- Audit trail analog: `validate-phase.md` Step 6 + CONTEXT.md `<specifics>` exact prose
- Inspector override analog: `INSPECTOR-SMOKE.md` line 1 prepended override + Phase 8's verified state

---

## Metadata

**Analog search scope:**
- `src/__tests__/` (cross-cutting test tier — 7 sibling files inspected)
- `.planning/phases/0{1..8}-*/` (5 VALIDATION.md, 6 VERIFICATION.md, 4 CONTEXT.md, plan files)
- `.planning/v1.0-MILESTONE-AUDIT.md` (in-place edit precedents)
- `$HOME/.claude/get-shit-done/workflows/validate-phase.md` (Step 6 audit-trail format)
- `.planning/phases/01-foundation-hierarchy/INSPECTOR-SMOKE.md` (override-accepted header)

**Files scanned:** 14 directly read in this pass.

**Pattern extraction date:** 2026-04-28
