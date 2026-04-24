import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Asserts D-ATTR-12: per phase declared in .planning/ROADMAP.md with
 * a non-"None" **Requirements**: line, the union of all plan-level
 * SUMMARY frontmatter `requirements-completed:` declarations is a
 * superset of the ROADMAP-declared REQ-ID set.
 *
 * Phases 6, 7, 8, 9 declare `**Requirements**: None (...)` and are
 * skipped (gap-closure phases — no functional REQ-IDs to bind).
 *
 * Two YAML styles are accepted (D-ATTR-12 critical invariant):
 *   flow:  requirements-completed: [HIER-01, HIER-02]
 *   block: requirements-completed:\n  - HIER-01\n  - HIER-02
 * This lets the test pass on the pre-normalization tree (01-02 in block
 * style) AND on the post-normalization tree (all flow style).
 *
 * Cost budget: ~50ms (filesystem reads + regex parse, no spawn/network/DB).
 */

const PHASES_DIR = '.planning/phases';
const ROADMAP_PATH = '.planning/ROADMAP.md';
// D-ATTR-12 + ## Specific Values line 200: Phases 6, 7, 8, 9 skipped (gap closure, **Requirements**: None).
const SKIPPED_PHASES = new Set([6, 7, 8, 9]);

function extractRequirementsCompleted(summaryContent: string): string[] {
  // Flow style: requirements-completed: [A, B, C] (single line, possibly empty [])
  const flowMatch = summaryContent.match(/^requirements-completed:\s*\[([^\]]*)\]/m);
  if (flowMatch) {
    const inner = flowMatch[1].trim();
    if (inner.length === 0) return [];
    return inner.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }
  // Block style: requirements-completed:\n  - A\n  - B (multi-line)
  // Match the key line then any number of indented "- value" lines.
  // Stop at the first line that is not indented or not a bullet.
  const blockKeyMatch = summaryContent.match(/^requirements-completed:\s*\n((?:[ \t]+-[ \t]+.+\n?)+)/m);
  if (blockKeyMatch) {
    const items: string[] = [];
    for (const line of blockKeyMatch[1].split('\n')) {
      const itemMatch = line.match(/^[ \t]+-[ \t]+(.+?)[ \t]*$/);
      if (itemMatch) {
        // Strip surrounding quotes (block items can be quoted strings, e.g.
        // Phase 7 SC-string values — those phases are skipped anyway, but
        // we tolerate the shape to avoid false parse errors).
        const raw = itemMatch[1].replace(/^['"](.*)['"]$/, '$1');
        items.push(raw);
      }
    }
    return items;
  }
  // Key not present in the file — contribute empty set (D-ATTR-12: missing key is NOT a parse error).
  return [];
}

function readSummaryFilesForPhase(phaseDir: string): string[] {
  const fullDir = join(PHASES_DIR, phaseDir);
  if (!statSync(fullDir).isDirectory()) return [];
  const summaryFiles: string[] = [];
  for (const entry of readdirSync(fullDir)) {
    // Match {NN}-{NN}-SUMMARY.md (e.g. 01-02-SUMMARY.md, 02.1-01-SUMMARY.md)
    if (/^\d+(?:\.\d+)?-\d+-SUMMARY\.md$/.test(entry)) {
      summaryFiles.push(join(fullDir, entry));
    }
  }
  return summaryFiles.sort();
}

interface PhaseInfo {
  number: number;
  declaredRequirements: string[];  // empty if **Requirements**: None
  isSkipped: boolean;              // true if **Requirements**: starts with "None"
  phaseDir: string;                // directory name like "01-foundation-hierarchy"
}

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
    const reqLineMatch = block.match(/^\*\*Requirements\*\*:\s*(.+)$/m);
    if (!reqLineMatch) continue;  // No **Requirements**: line — skip this phase
    const reqLine = reqLineMatch[1].trim();
    const isSkipped = /^None\b/.test(reqLine);
    const declaredRequirements = isSkipped
      ? []
      : reqLine
          .split(',')
          .map((s) => s.trim())
          // Drop trailing parenthetical or comment if any (defensive)
          .map((s) => s.replace(/\s*\(.*$/, ''))
          .filter((s) => /^[A-Z]+-\d+$/.test(s));
    // Derive phaseDir from phase number — best-effort scan of .planning/phases/
    // for a directory starting with the zero-padded phase number.
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
      // Phase directory may not exist yet for unstarted phases; that's fine
      // — declaredRequirements stays the same; readSummaryFilesForPhase
      // returns [] gracefully.
    }
    phases.push({
      number: Math.floor(phaseNum),
      declaredRequirements,
      isSkipped,
      phaseDir,
    });
  }
  return phases;
}

describe('phase attribution (D-ATTR-12)', () => {
  const roadmapContent = readFileSync(ROADMAP_PATH, 'utf8');
  const phases = parseRoadmap(roadmapContent);

  it('parses ROADMAP.md and finds at least 9 phase blocks', () => {
    // Sanity: regression guard against ROADMAP regex breakage.
    expect(phases.length).toBeGreaterThanOrEqual(9);
  });

  it('skips gap-closure phases (6, 7, 8, 9) per D-ATTR-12 allow-list', () => {
    for (const p of phases) {
      if (SKIPPED_PHASES.has(p.number)) {
        expect(p.isSkipped, `Phase ${p.number} ROADMAP says **Requirements**: should be "None"`).toBe(true);
      }
    }
  });

  it('every non-skipped phase declares at least one REQ-ID in ROADMAP', () => {
    for (const p of phases) {
      if (p.isSkipped) continue;
      expect(
        p.declaredRequirements.length,
        `Phase ${p.number} declares 0 REQ-IDs in ROADMAP **Requirements**: line`,
      ).toBeGreaterThan(0);
    }
  });

  it('SUMMARY requirements-completed: union ⊇ ROADMAP **Requirements**: per phase', () => {
    const failures: string[] = [];
    for (const p of phases) {
      if (p.isSkipped) continue;
      if (!p.phaseDir) {
        failures.push(`Phase ${p.number}: no phase directory found in ${PHASES_DIR}/`);
        continue;
      }
      const summaryFiles = readSummaryFilesForPhase(p.phaseDir);
      const claimed = new Set<string>();
      for (const f of summaryFiles) {
        const content = readFileSync(f, 'utf8');
        for (const r of extractRequirementsCompleted(content)) {
          claimed.add(r);
        }
      }
      const missing = p.declaredRequirements.filter((r) => !claimed.has(r));
      if (missing.length > 0) {
        failures.push(
          `Phase ${p.number} (${p.phaseDir}) missing attribution for: [${missing.join(', ')}]. ` +
          `Declared in ROADMAP: [${p.declaredRequirements.join(', ')}]. ` +
          `Claimed across SUMMARYs: [${[...claimed].sort().join(', ')}]`
        );
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  // Direct-shape unit tests of the parsers (Wave 0 RED→GREEN proof).
  it('extractRequirementsCompleted parses flow-style', () => {
    expect(extractRequirementsCompleted('requirements-completed: [HIER-01, HIER-02]'))
      .toEqual(['HIER-01', 'HIER-02']);
  });

  it('extractRequirementsCompleted parses block-style', () => {
    const block = 'requirements-completed:\n  - HIER-01\n  - HIER-02\n  - HIER-03\n';
    expect(extractRequirementsCompleted(block)).toEqual(['HIER-01', 'HIER-02', 'HIER-03']);
  });

  it('extractRequirementsCompleted returns [] for missing key', () => {
    expect(extractRequirementsCompleted('phase: 05-web-dashboard\nplan: 01\n')).toEqual([]);
  });

  it('extractRequirementsCompleted returns [] for empty flow []', () => {
    expect(extractRequirementsCompleted('requirements-completed: []')).toEqual([]);
  });
});
