---
phase: 08-doc-attribution-backfill
reviewed: 2026-04-25T00:01:04Z
depth: standard
files_reviewed: 1
files_reviewed_list:
  - src/__tests__/phase-attribution.test.ts
findings:
  critical: 0
  warning: 1
  info: 4
  total: 5
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-04-25T00:01:04Z
**Depth:** standard
**Files Reviewed:** 1
**Status:** issues_found

## Summary

Reviewed `src/__tests__/phase-attribution.test.ts` — a Vitest cross-cutting invariant
test that enforces D-ATTR-12 by parsing every plan-level `*-SUMMARY.md`'s
`requirements-completed:` frontmatter and comparing against the matching ROADMAP
`**Requirements**:` line. Test passes cleanly against the live tree (8 of 8
assertions green, 99ms duration).

The implementation is fit-for-purpose for the curated `.planning/` tree it walks,
and the regex strategy for two YAML shapes (flow + block) is well-commented.
Findings are split into **one warning** (a real silent-skip regression hole) and
**four info notes** (parser fragility for shapes the project does not currently
write, and a lossy phase-number field). No critical issues, no security issues,
no source-file modifications outside test scope.

The warning matters because the test is the *only* automated guard for
attribution drift. A failure mode that lets a malformed ROADMAP entry slip
through silently undermines the invariant the test is supposed to protect.

## Warnings

### WR-01: A ROADMAP phase block with a missing `**Requirements**:` line is silently dropped, weakening the D-ATTR-12 guard

**File:** `src/__tests__/phase-attribution.test.ts:90`
**Issue:** Inside `parseRoadmap`, when `reqLineMatch` is null the code does
`continue`, omitting that phase from the returned array entirely. Combined with
the sanity check at line 135 (`expect(phases.length).toBeGreaterThanOrEqual(9)`),
the failure mode is partially observable but fragile:

- If exactly one phase is missing its `**Requirements**:` line, `phases.length`
  drops to 8 and the sanity test fails — but the failure message
  (`length >= 9`) does not point to the offending phase, forcing manual diff.
- If a future ROADMAP grows to 10+ phases (Phase 10+ is plausible for v1.1),
  losing one entry would still leave `phases.length >= 9`, and the omission
  becomes **completely silent**. The test would pass while attribution drift
  goes undetected.
- The doc comment at lines 5–11 promises "every phase declared in
  ROADMAP.md with a non-'None' `**Requirements**:` line" gets checked. Today
  that promise is enforced only indirectly via a count threshold.

**Fix:** Either fail loud at parse time, or track-and-assert in a dedicated
`it()` block. Minimal change:

```typescript
function parseRoadmap(roadmapContent: string): PhaseInfo[] {
  const phases: PhaseInfo[] = [];
  const malformed: string[] = [];
  const phasePattern = /^### Phase (\d+(?:\.\d+)?): ([^\n]+)\n([\s\S]*?)(?=^### Phase |$(?![\s\S]))/gm;
  for (const m of roadmapContent.matchAll(phasePattern)) {
    const phaseNum = parseFloat(m[1]);
    const block = m[3];
    const reqLineMatch = block.match(/^\*\*Requirements\*\*:\s*(.+)$/m);
    if (!reqLineMatch) {
      malformed.push(`Phase ${m[1]}: ${m[2]}`);
      continue;
    }
    // ...rest unchanged
  }
  if (malformed.length > 0) {
    throw new Error(
      `ROADMAP.md has ${malformed.length} phase block(s) missing **Requirements**: line:\n  ` +
      malformed.join('\n  ')
    );
  }
  return phases;
}
```

This converts a silent omission into a loud parse error with a precise message,
which matches the failure-message style of the existing `it()` blocks
(file paths and REQ-IDs cited explicitly).

## Info

### IN-01: Parser does not handle multi-line flow-style arrays

**File:** `src/__tests__/phase-attribution.test.ts:30`
**Issue:** The flow-style regex `/^requirements-completed:\s*\[([^\]]*)\]/m`
requires the opening `[` and closing `]` to be on the same line. A YAML-valid
multi-line flow array would be missed and silently fall through to the block
branch (which would also miss it), returning `[]`:

```yaml
requirements-completed: [
  HIER-01,
  HIER-02,
]
```

The block-style fallback at line 39 would then also fail to match because the
next line is `  HIER-01,` (no `-` bullet). The phase would silently report empty
attribution and the superset test would mis-fire.

This is a low-probability concern today — the project writes single-line flow
or hyphen-bullet block, both of which work. But the test is meant to be a
project-wide invariant, and the gap is undocumented.

**Fix:** Either widen the regex to `\[([\s\S]*?)\]` and tolerate newlines, or
add a comment at line 29 noting that multi-line flow is intentionally
unsupported per project YAML convention. The comment route is cheaper:

```typescript
// Flow style (single-line only — project convention forbids multi-line `[\n...\n]`):
const flowMatch = summaryContent.match(/^requirements-completed:\s*\[([^\]]*)\]/m);
```

### IN-02: Block-style parser does not strip inline `#` comments

**File:** `src/__tests__/phase-attribution.test.ts:43`
**Issue:** The block bullet regex `/^[ \t]+-[ \t]+(.+?)[ \t]*$/` captures
everything from `- ` to end-of-line, including a YAML inline comment. A line
like `  - HIER-01  # core hierarchy` would yield the literal string
`HIER-01  # core hierarchy`, which would not match the corresponding ROADMAP
ID and would falsely trigger a missing-attribution failure.

No SUMMARY in the current tree has inline comments on bullet items, so the
defect is latent. But the test will become misleading if anyone adds them.

**Fix:** Trim trailing `# ...` from the captured value before pushing:

```typescript
const itemMatch = line.match(/^[ \t]+-[ \t]+(.+?)[ \t]*$/);
if (itemMatch) {
  let raw = itemMatch[1].replace(/^['"](.*)['"]$/, '$1');
  raw = raw.replace(/\s+#.*$/, '').trim();  // strip YAML inline comment
  items.push(raw);
}
```

### IN-03: `PhaseInfo.number` collapses decimal phases via `Math.floor`, losing identity

**File:** `src/__tests__/phase-attribution.test.ts:120`
**Issue:** `phases.push({ number: Math.floor(phaseNum), ... })` stores `2` for
both `Phase 2` and `Phase 2.1`. The downstream `SKIPPED_PHASES.has(p.number)`
check at line 140 is therefore identity-blind for decimal phases — a hypothetical
`Phase 6.1` would be skipped automatically (because 6 is in the allow-list)
without that decision being made explicitly.

This is consistent with the project's "decimal phases are inserted gap closures"
convention (CLAUDE.md / ROADMAP overview), so it may be intentional. Still, the
field is lossy and the failure messages reference `p.number` which would print
`2` for Phase 2.1 — confusing during triage.

**Fix:** Either preserve the original string capture as a separate field for
diagnostics, or document the lossy intent at the field site:

```typescript
interface PhaseInfo {
  number: number;          // Math.floor — decimals collapse to integer (allow-list keys are integers)
  numberRaw: string;       // verbatim m[1], used in failure messages
  // ...
}
```

Then use `p.numberRaw` in the failure-message templates at lines 141, 151, 161,
and 175.

### IN-04: `readdirSync(PHASES_DIR)` is called once per ROADMAP phase inside the parse loop

**File:** `src/__tests__/phase-attribution.test.ts:108`
**Issue:** The phase-directory resolver calls `readdirSync(PHASES_DIR)` inside
the `for (const m of ... .matchAll(phasePattern))` loop — N readdir syscalls
where N is the phase count. With 9 phases this is negligible (~1ms), but
hoisting the call once before the loop is cleaner and makes the intent
("scan once, match many") clearer:

```typescript
let phaseDirEntries: string[] = [];
try {
  phaseDirEntries = readdirSync(PHASES_DIR);
} catch {
  // Phase directory may not exist yet for unstarted phases.
}
for (const m of roadmapContent.matchAll(phasePattern)) {
  // ...
  let phaseDir = '';
  for (const entry of phaseDirEntries) {
    if (entry.startsWith(`${padded}-`)) {
      phaseDir = entry;
      break;
    }
  }
  // ...
}
```

The 50ms cost budget cited at line 20 has plenty of headroom either way. This
is purely a structure/clarity nudge.

---

_Reviewed: 2026-04-25T00:01:04Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
