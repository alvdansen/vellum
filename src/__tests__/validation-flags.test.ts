import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Asserts D-WAVE0-14..18: every v1.0 functional phase marked complete
 * in ROADMAP.md whose title does NOT contain "[GAP CLOSURE]" has a
 * VALIDATION.md with `status: 'closed'`, `nyquist_compliant: true`,
 * `wave_0_complete: true` in its frontmatter.
 *
 * Detection strategy (D-WAVE0-14, D-WAVE0-18):
 *   - Body progress table (lines 215+ of ROADMAP.md) is the truthful
 *     completion signal: rows like `| 1. Foundation & Hierarchy | 3/3 | Complete | 2026-04-20 |`
 *     identify shipped phases. Top-level checklist (lines 15-23) remains
 *     `- [ ]` until milestone close — DO NOT use it for completion.
 *   - Top-level checklist IS used to detect `[GAP CLOSURE]` markers
 *     (substring match in description text). Phases 6-9 carry the marker
 *     and are auto-exempt from the 3-flag assertion. Future gap-closure
 *     phases inherit this exemption automatically without code change.
 *
 * Strict equality (D-WAVE0-15): `status === 'closed'` (not `!== 'draft'`).
 * Strict file existence (D-WAVE0-16): VALIDATION.md must exist for every
 * complete non-gap-closure phase.
 *
 * YAML parser (D-WAVE0-17): hand-rolled regex per Phase 8 precedent
 * (`phase-attribution.test.ts`). `js-yaml` not in dep tree; adding it
 * for 3-line scalar lookups would be over-engineering.
 *
 * Cost budget: ~50ms (filesystem reads + regex parse, no spawn/network/DB).
 */

const PHASES_DIR = '.planning/phases';
const ROADMAP_PATH = '.planning/ROADMAP.md';

interface PhaseInfo {
  number: number;
  title: string;
  isComplete: boolean;
  isGapClosure: boolean;
  phaseDir: string;
  padded: string;
}

function extractFlag(content: string, key: string): string | null {
  // Match `key: value` on its own line in the YAML frontmatter.
  // Block-style scalars only — VALIDATION.md frontmatter has no list keys.
  const m = content.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  return m ? m[1] : null;
}

function parseRoadmapPhases(roadmapContent: string): PhaseInfo[] {
  // Top-level checklist parsing (catches description text with [GAP CLOSURE] marker).
  // Pattern: - [x|space] **Phase N: Title** - description
  const checklistPattern = /^- \[[ x]\] \*\*Phase (\d+(?:\.\d+)?): ([^*]+)\*\* - (.+)$/gm;
  const checklist = new Map<number, { title: string; description: string }>();
  for (const m of roadmapContent.matchAll(checklistPattern)) {
    const num = parseFloat(m[1]);
    checklist.set(num, { title: m[2].trim(), description: m[3].trim() });
  }

  // Body progress table parsing — the truthful completion signal.
  // Pattern: | N. Title | X/Y or X/? | Status | Date |
  // ROADMAP uses `0/?` for unknown plan counts on gap-closure phases.
  const tablePattern = /^\| (\d+)\. ([^|]+?)\s*\| ([\d?]+)\/([\d?]+) \| (Complete|Planned[^|]*)\s*\|/gm;
  const phases: PhaseInfo[] = [];
  for (const m of roadmapContent.matchAll(tablePattern)) {
    const num = parseInt(m[1], 10);
    const isComplete = m[5].trim() === 'Complete';
    const checklistEntry = checklist.get(num);
    const description = checklistEntry?.description ?? '';
    const isGapClosure = /\[GAP CLOSURE\]/.test(description);
    const padded = String(num).padStart(2, '0');
    let phaseDir = '';
    try {
      for (const entry of readdirSync(PHASES_DIR)) {
        if (entry.startsWith(`${padded}-`)) {
          phaseDir = entry;
          break;
        }
      }
    } catch {
      // Phases dir absent — leave phaseDir empty.
    }
    phases.push({
      number: num,
      title: m[2].trim(),
      isComplete,
      isGapClosure,
      phaseDir,
      padded,
    });
  }
  return phases;
}

describe('validation flags (D-WAVE0-14..18)', () => {
  const roadmapContent = readFileSync(ROADMAP_PATH, 'utf8');
  const phases = parseRoadmapPhases(roadmapContent);

  it('parses ROADMAP.md body progress table and finds at least 9 phases', () => {
    expect(phases.length).toBeGreaterThanOrEqual(9);
  });

  it('detects [GAP CLOSURE] phases (6, 7, 8, 9) from ROADMAP top-level checklist', () => {
    const gapClosure = phases.filter((p) => p.isGapClosure).map((p) => p.number);
    expect(gapClosure.sort()).toEqual([6, 7, 8, 9]);
  });

  it('every complete non-gap-closure phase has VALIDATION.md with the 3 closure flags set (D-WAVE0-14, D-WAVE0-15, D-WAVE0-16)', () => {
    const failures: string[] = [];
    for (const p of phases) {
      if (!p.isComplete) continue;
      if (p.isGapClosure) continue;
      if (!p.phaseDir) {
        failures.push(`Phase ${p.number}: no phase directory found in ${PHASES_DIR}/`);
        continue;
      }
      const validationPath = join(PHASES_DIR, p.phaseDir, `${p.padded}-VALIDATION.md`);
      if (!existsSync(validationPath)) {
        failures.push(`Phase ${p.number} (${p.phaseDir}): VALIDATION.md missing at ${validationPath}`);
        continue;
      }
      const content = readFileSync(validationPath, 'utf8');
      const status = extractFlag(content, 'status');
      const nyquist = extractFlag(content, 'nyquist_compliant');
      const wave0 = extractFlag(content, 'wave_0_complete');
      if (status !== 'closed') {
        failures.push(`Phase ${p.number}: status=${status} (expected 'closed')`);
      }
      if (nyquist !== 'true') {
        failures.push(`Phase ${p.number}: nyquist_compliant=${nyquist} (expected 'true')`);
      }
      if (wave0 !== 'true') {
        failures.push(`Phase ${p.number}: wave_0_complete=${wave0} (expected 'true')`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  // Direct-shape unit tests of helper parsers (Wave 0 RED→GREEN proof).
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
