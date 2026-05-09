/**
 * Phase 19 — D-VAL-4 pure validation helper.
 *
 * Architecture-purity (Plan 01 grep guard): ZERO imports beyond local types.
 * Adversarial review can read the file in isolation; tests mock nothing.
 *
 * The two validation modes:
 *   - Non-redacted: at least ONE model_name from models_json appears verbatim
 *     (case-sensitive substring) in the summary text — D-VAL-1.
 *   - Redacted: summary contains a marker ('redacted' / 'partial' / 'redaction',
 *     case-insensitive substring) — D-VAL-3 disclosure requirement.
 *
 * Validation gates the cache write (D-VAL-2 enforced by Plan 04 facade).
 * On miss, the engine renders the deterministic-template fallback. The user
 * clicking "Regenerate" produces a fresh attempt — different temperature
 * draw may pass on next click.
 */

import type { ModelRef } from '../../types/provenance.js';

export const REDACTION_MARKERS = ['redacted', 'partial', 'redaction'] as const;

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'missing_model_name' | 'missing_redaction_marker' | 'empty' };

export function validateSummary(
  text: string,
  models: ModelRef[],
  isRedacted: boolean,
): ValidationResult {
  if (!text || text.trim().length === 0) {
    return { ok: false, reason: 'empty' };
  }

  if (isRedacted) {
    // D-VAL-3: redaction marker is mandatory; model-name regex skipped for
    // redacted versions because the redaction event may have stripped the
    // model_name entirely from sanitized payload.
    const lower = text.toLowerCase();
    const hasMarker = REDACTION_MARKERS.some((m) => lower.includes(m));
    return hasMarker ? { ok: true } : { ok: false, reason: 'missing_redaction_marker' };
  }

  // D-VAL-1: at least ONE model name appears verbatim (case-sensitive).
  // Models_json names are the same canonical strings that flow into the C2PA
  // manifest (Phase 13 PROV-V-03 surface), so case-sensitivity is correct.
  const hasModelName = models.some(
    (m) => m.model_name.length > 0 && text.includes(m.model_name),
  );
  return hasModelName ? { ok: true } : { ok: false, reason: 'missing_model_name' };
}
