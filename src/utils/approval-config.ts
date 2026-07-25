/**
 * Approval-gate configuration parsing (no silent credit spend).
 *
 * Single source of truth for reading VELLUM_REQUIRE_APPROVAL so the engine
 * wiring (server.ts) and the capabilities resource (tools/resources.ts) can
 * never drift on how the flag is interpreted.
 *
 * FAIL CLOSED: a misconfigured spend gate must err toward MORE gating, not
 * less. Only explicit off-values disable it; every other non-empty value —
 * including operator typos like `True`, `TRUE`, `yes`, `on`, or ` 1` — enables
 * it. Unset / empty defaults OFF (the gate is opt-in), matching prior behavior.
 */

/** Explicit off-values (case-insensitive, trimmed). Everything else non-empty is ON. */
const OFF_VALUES: ReadonlySet<string> = new Set(['0', 'false', 'no', 'off']);

/**
 * True when the approval gate should be enforced for the given raw env value.
 *
 * - `undefined` / `''` (unset)            → false (opt-in default)
 * - `'0' | 'false' | 'no' | 'off'`        → false (explicit disable)
 * - anything else non-empty               → true  (fail-closed; typo-safe)
 */
export function isApprovalRequired(raw: string | undefined): boolean {
  if (raw == null) return false;
  const v = raw.trim().toLowerCase();
  if (v === '') return false;
  return !OFF_VALUES.has(v);
}
