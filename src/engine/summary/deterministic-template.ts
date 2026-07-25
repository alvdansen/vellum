/**
 * Phase 19 — D-FB-1 deterministic-template fallback summary.
 *
 * Architecture-purity (Plan 01 grep guard): ZERO imports beyond local types.
 * Pure helper — no I/O, no SDK calls, no DB access.
 *
 * Renders structural sentences (NOT pseudo-conversational prose per D-FB-5).
 * Pairs with a <WarningPill> in the dashboard so users always see something
 * readable. Mirrors src/engine/diff-summary.ts:48-69 sorted-ordering +
 * capped-output + fallback-string-for-empty pattern.
 *
 * Output shape examples:
 *   "v003 generated with flux1-dev at seed 42. Iterate from v002. Additional models: cinematic_fantasy, detail_boost."
 *   "v005 generated with sd_xl_base_1.0.safetensors at seed unspecified. Some prompt fields were redacted."
 *   "v007 provenance unavailable."  // when completed event is null
 *
 * D-VAL-3 round-trip: the redacted-mode output emits 'Some prompt fields were
 * redacted' which contains the substring 'redacted' — the validator's
 * REDACTION_MARKERS array recognises this case-insensitively, so the
 * deterministic-template fallback ALWAYS satisfies the validator's
 * redaction-marker requirement on redacted versions.
 */

import type { ModelRef } from '../../types/provenance.js';
import type { ProvenanceCompletedPayload } from '../../store/provenance-repo.js';

const HARD_CAP = 320;

export interface BuildDeterministicSummaryArgs {
  completed: ProvenanceCompletedPayload | null;
  models: ModelRef[] | null;
  parentVersionLabel: string | null;
  isRedacted: boolean;
  versionLabel: string;
}

export function buildDeterministicSummary(args: BuildDeterministicSummaryArgs): string {
  const { completed, models, parentVersionLabel, isRedacted, versionLabel } = args;

  // Edge case: missing provenance → honest fallback string (mirrors diff-summary.ts "No changes." pattern).
  if (!completed) {
    return `${versionLabel} provenance unavailable.`;
  }

  const parts: string[] = [];

  // Sentence 1: model + version label + seed (always present when completed exists).
  const primaryModel = models?.[0]?.model_name ?? 'an unknown model';
  const seedField = (completed as { seed?: number | null }).seed;
  const seedDisplay = typeof seedField === 'number' ? String(seedField) : 'unspecified';
  parts.push(`${versionLabel} generated with ${primaryModel} at seed ${seedDisplay}`);

  // Sentence 2: lineage (only on iterate-lineage versions).
  if (parentVersionLabel) {
    parts.push(`Iterate from ${parentVersionLabel}`);
  }

  // Sentence 3: model count (only on multi-model versions).
  if (models && models.length > 1) {
    const extras = models.slice(1).map((m) => m.model_name).join(', ');
    parts.push(`Additional models: ${extras}`);
  }

  // Sentence 4: redaction marker (D-VAL-3 — also satisfies the validator's redaction-marker requirement).
  if (isRedacted) {
    parts.push('Some prompt fields were redacted');
  }

  let out = parts.join('. ') + '.';
  if (out.length > HARD_CAP) {
    out = out.slice(0, HARD_CAP - 1) + '…';
  }
  return out;
}
