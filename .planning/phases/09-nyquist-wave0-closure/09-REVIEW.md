---
phase: 09-nyquist-wave0-closure
reviewed: 2026-04-28T16:30:00Z
depth: standard
files_reviewed: 1
files_reviewed_list:
  - src/__tests__/validation-flags.test.ts
findings:
  critical: 0
  warning: 0
  info: 2
  total: 2
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-04-28T16:30:00Z
**Depth:** standard
**Files Reviewed:** 1
**Status:** issues_found (2 Info — no Critical, no Warning)

## Summary

Reviewed `src/__tests__/validation-flags.test.ts` (152 lines, +1 cross-cutting Vitest invariant). The test reads `.planning/ROADMAP.md` and per-phase `VALIDATION.md` frontmatter to enforce three closure flags (`status: closed`, `nyquist_compliant: true`, `wave_0_complete: true`) on every shipped non-`[GAP CLOSURE]` v1.0 functional phase, with `[GAP CLOSURE]` phases auto-exempted via top-level checklist substring detection.

**Architecture purity** is preserved: zero imports from `@modelcontextprotocol/sdk`, `better-sqlite3`, or `drizzle-orm` (verified via grep, exit=1). The file uses only `node:fs` and `node:path` plus Vitest, matching the cross-cutting invariant tier convention established by `phase-attribution.test.ts` (the explicit Phase 8 precedent the file cites).

**Behavioral correctness** verified: 6/6 tests pass in 98ms (well under the 50ms-class budget the file claims; ~95ms in isolation reported by `09-VERIFICATION.md`). Full cross-cutting tier (8 files, 55 tests) passes in 6.53s with the new file added — zero regressions.

**Regex parsers** (`extractFlag`, `checklistPattern`, `tablePattern`) were spot-checked against the live `ROADMAP.md` body progress table and all 7 existing `VALIDATION.md` frontmatters. Each VALIDATION.md yields exactly 3 flag matches anchored at the start of line — no body-text false positives, no aliasing risks. The `^...$` + `m` flag correctly returns the first frontmatter match, ignoring any later occurrences.

**Code quality** is high: clear JSDoc preamble cites all five decision IDs (D-WAVE0-14..18) with rationale; failure-aggregation pattern produces a single multi-line error so a single `vitest run` reveals every offending phase; helper unit tests (lines 141-151) provide the RED→GREEN proof for the hand-rolled YAML parser. The two findings below are minor and forward-looking — neither blocks closure or causes any current bug.

No Critical or Warning issues found. Test is ready to ship.

## Info

### IN-01: Latent type-key drift between checklist (parseFloat) and body table (parseInt)

**File:** `src/__tests__/validation-flags.test.ts:57, 67`
**Issue:** `parseRoadmapPhases` builds the checklist `Map<number, ...>` keyed by `parseFloat(m[1])` (line 57), then looks up by `parseInt(m[1], 10)` from the body progress table (line 67). For integer phases (1–9) these coincide because `parseFloat('6') === 6 === parseInt('6', 10)`. However, ROADMAP.md documents decimal phase numbering (e.g. `2.1`, `2.2` per lines 10-13: "Decimal phases (2.1, 2.2): Urgent insertions"). If a decimal phase is ever added to the body progress table (e.g. `| 2.1. Title | ... |`), the body-table regex `/^\| (\d+)\. /` would capture only `2`, while the checklist captured `2.1` — `checklist.get(2)` would return `undefined`, the description text would silently drop to `''`, and `isGapClosure` would always be `false` for that phase. Currently no decimal phase appears in either list, so this is purely latent.

**Fix:** Either (a) align the parsers — change line 67 to `const num = parseFloat(m[1]);` to match the checklist key type and update the body-table regex to `/^\| (\d+(?:\.\d+)?)\. /` — or (b) leave a `// TODO(decimal-phases)` comment near line 67 acknowledging the gap, since the body-table regex is the lookup driver and currently only emits integers. Option (a) is cleaner and preempts a silent bug if a future urgent insertion lands in the progress table:

```typescript
// line 64
const tablePattern = /^\| (\d+(?:\.\d+)?)\. ([^|]+?)\s*\| ([\d?]+)\/([\d?]+) \| (Complete|Planned[^|]*)\s*\|/gm;
// line 67
const num = parseFloat(m[1]);
// line 72 — keep zero-pad for two-digit integer dirs; decimal phases use their literal form
const padded = Number.isInteger(num) ? String(num).padStart(2, '0') : m[1];
```

### IN-02: `parseRoadmapPhases` re-scans `.planning/phases/` once per phase row

**File:** `src/__tests__/validation-flags.test.ts:74-83`
**Issue:** Inside the `for (const m of roadmapContent.matchAll(tablePattern))` loop, each iteration calls `readdirSync(PHASES_DIR)` and walks the entries to find the directory whose name starts with the zero-padded phase number. With 9 phases × ~9 entries, this is ~81 string compares — well within the 50ms budget the file claims, and matches the pattern `phase-attribution.test.ts` already uses (lines 107-118). Still, hoisting the readdir to a single call before the loop and building a `Map<padded, dirname>` would eliminate the redundancy and serve as a clearer template if a future phase ever has dozens of plans.

**Fix:** Out-of-scope per `<review_scope>` v1 ("Performance issues … are NOT in scope"). Flagging only as **Info** because it is a code-quality / consistency observation. No action recommended unless the phase count grows >50 or `phase-attribution.test.ts` is also refactored. Suggested shape if revisited:

```typescript
let phaseDirsByPadded: Map<string, string> = new Map();
try {
  for (const entry of readdirSync(PHASES_DIR)) {
    const m = entry.match(/^(\d+)-/);
    if (m) phaseDirsByPadded.set(m[1], entry);
  }
} catch { /* dir absent — leave map empty */ }
// then inside the loop: const phaseDir = phaseDirsByPadded.get(padded) ?? '';
```

---

## Notes on items considered and rejected

The reviewer specifically considered and rejected the following as findings, since each was either intentional, project-convention-aligned, or already addressed:

- **Hand-rolled YAML regex parser** — Intentional per D-WAVE0-17 (cited line 25-27 of the test). `js-yaml` is not in the dep tree; matches `phase-attribution.test.ts` precedent. Adding js-yaml for 3-line scalar lookups would be over-engineering per project conventions in CLAUDE.md ("Use existing project conventions").
- **Top-level `readFileSync` outside `it`/`beforeAll`** (line 97) — Vitest hoists `describe` body before `it` registration; this matches `phase-attribution.test.ts:130` exactly and is a known Wave 0 idiom. Throwing at module load (e.g. ROADMAP missing) is the desired failure mode.
- **`parseRoadmapPhases` returning empty array silently when `PHASES_DIR` is absent** (lines 74-83 catch block) — Intentional per inline comment "Phases dir absent — leave phaseDir empty"; the empty `phaseDir` is later turned into a clear failure message at line 115 (`failures.push(...no phase directory found...)`).
- **String `'true'` comparison instead of boolean coercion** (lines 130, 133) — Correct: `extractFlag` is a regex scalar extractor returning `string | null`, and YAML `true` serializes as the literal text `true`. Strict equality is the documented contract per D-WAVE0-15.
- **Test file imports use ESM `node:fs` / `node:path` prefixes** — Matches the project's ESM convention (CLAUDE.md: "Runtime: Node.js (TypeScript, ESM)") and existing tier files.
- **No security findings** — File reads only `.planning/`-prefixed paths (constants on lines 32-33). No user input, no shell exec, no network, no SQL. Repo-tracked planning docs only. Threat model T-09-01 in 09-01-PLAN.md explicitly accepts this.

---

_Reviewed: 2026-04-28T16:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
