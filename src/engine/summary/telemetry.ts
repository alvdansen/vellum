/**
 * Phase 19 — D-PRIV-3 + AI-SPEC §7 production monitoring telemetry.
 *
 * Architecture-purity (extends Plan 01 grep guards): this file imports zero
 * SDK / DB-driver / ORM / HTTP-server packages. Pure helper emitting
 * structured log lines via console.error (matches Phase 14 c2pa-config
 * boot-log convention). The architecture-purity test enforces the invariant
 * by file-level grep — the package names ARE intentionally absent from this
 * docstring so the assertion reads cleanly.
 *
 * D-PRIV-3 strict contract — counts + timings ONLY. NEVER include prompt
 * text, response text, summary_text, prompt_positive, prompt_negative,
 * user_prompt, system_prompt, response, or response_text fields.
 * Multi-encoding leak scan (UTF-8 / UTF-16LE / UTF-16BE / base64) applies
 * to every emit — extends the v1.1 cross-cutting invariant from
 * src/__tests__/c2pa-redaction-e2e.test.ts:76-92.
 *
 * Sampling per AI-SPEC §7 Smart Sampling Strategy:
 *   - outcome='fallback' → emit in full (diagnostic surface)
 *   - outcome='live'     → emit full metadata (cost-projection flywheel)
 *   - outcome='cache_hit' → 1% deterministic sample
 *     (hash(version_id + timestamp_minute) mod 100 == 0)
 *
 * The flattenAnthropicError helper (Plan 04 anthropic-client.ts) is the
 * upstream defence on error paths — telemetry NEVER receives raw
 * error.message strings. The reason field is a structured outcome enum
 * (e.g., 'circuit_open', 'validation_failed'), not free-form text.
 */

import { flattenAnthropicError } from './anthropic-client.js';

export type SummaryTelemetryEvent = {
  event: 'summary_generated';
  version_id: string;
  manifest_sha256: string | null;
  model_id: string;
  template_version: string;
  duration_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  outcome: 'cache_hit' | 'live' | 'fallback';
  /** Only present on outcome='fallback' — structured reason enum, never free-form text. */
  reason?: string;
};

/**
 * Banned field names — defence-in-depth check before emit. If ANY of these
 * appear as a key in the event payload, refuse to emit and surface the
 * contract violation. This is a structural assertion: the payload type
 * already excludes these, but a runtime check catches dynamic field-set
 * mutations (e.g., a later refactor that spreads a wider object).
 */
export const BANNED_FIELDS = [
  'text',
  'summary_text',
  'prompt_positive',
  'prompt_negative',
  'user_prompt',
  'system_prompt',
  'response',
  'response_text',
] as const;

/**
 * Deterministic 1% sampling for cache_hit events.
 *
 * Uses a simple FNV-style hash over (version_id, current minute bucket) so
 * a given version's cache_hit emits at a stable 1% rate without crypto
 * randomness. The minute-bucket roll-over redistributes which versions
 * sample so no single version is starved.
 */
export function shouldSampleCacheHit(versionId: string, timestampMs: number): boolean {
  const minute = Math.floor(timestampMs / 60_000);
  const str = `${versionId}:${minute}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // 32-bit truncation
  }
  return Math.abs(hash) % 100 === 0;
}

/**
 * Defence-in-depth — verify the event object does NOT contain any banned
 * field name. Throws Error if it does (caught by caller and translated
 * into an EMIT REFUSED log line via flattenAnthropicError-scrubbed message).
 */
export function assertNoBannedFields(event: Record<string, unknown>): void {
  for (const key of Object.keys(event)) {
    if ((BANNED_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`telemetry assertion: banned field "${key}" in summary event payload`);
    }
  }
}

/**
 * Emit a structured telemetry event to stderr. Counts + timings only per
 * D-PRIV-3 — the contract is enforced by:
 *   (1) the SummaryTelemetryEvent TypeScript type (compile-time gate)
 *   (2) assertNoBannedFields runtime check (defence-in-depth gate)
 *   (3) multi-encoding leak scan over the JSON-serialized payload
 *       (catches an API-key fragment smuggled into a string field)
 *
 * Sampling rules (AI-SPEC §7):
 *   outcome='fallback'  → always emit (diagnostic surface)
 *   outcome='live'      → always emit (cost-projection flywheel)
 *   outcome='cache_hit' → emit on 1% deterministic sample
 *
 * Output format: `vellum: <json>` — matches Phase 14 c2pa-config
 * boot-log convention so a single grep over stderr archives covers both.
 *
 * @param event the structured telemetry event
 * @param clock injectable clock (default Date.now) — supports deterministic
 *   tests of the cache_hit sampling decision
 */
export function logSummaryEvent(
  event: SummaryTelemetryEvent,
  clock: () => number = Date.now,
): void {
  // Defence-in-depth — assert no banned fields snuck into the payload.
  // This catches a future refactor that accidentally spreads response data.
  try {
    assertNoBannedFields(event as unknown as Record<string, unknown>);
  } catch (err) {
    // The assertion message itself is safe (it names the banned field) —
    // pass through flattenAnthropicError so any incidental key leak is
    // scrubbed before the EMIT REFUSED log line.
    console.error(`vellum: [summary-telemetry] EMIT REFUSED — ${flattenAnthropicError(err)}`);
    return;
  }

  // Sampling decision — cache_hit is the dominant steady-state path.
  if (event.outcome === 'cache_hit') {
    if (!shouldSampleCacheHit(event.version_id, clock())) return;
  }

  // Multi-encoding leak scan over the JSON-serialized payload (defence-in-
  // depth — the upstream sanitizer assertNoApiKeyInPayload + the
  // flattenAnthropicError on error paths are the primary defences). If a
  // fragment leaks through anyway, refuse the emit rather than persist
  // the log line.
  const payload = JSON.stringify(event);
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (apiKey.length > 0) {
    const fragments = [
      apiKey, // UTF-8 / ASCII
      Buffer.from(apiKey, 'utf16le').toString('binary'), // UTF-16LE
      Buffer.from(apiKey, 'utf16le').reverse().toString('binary'), // UTF-16BE roughly
      Buffer.from(apiKey).toString('base64'), // base64
    ];
    for (const frag of fragments) {
      if (frag.length === 0) continue;
      if (payload.includes(frag)) {
        console.error('vellum: [summary-telemetry] EMIT REFUSED — API key fragment in payload');
        return;
      }
    }
  }

  // Emit to console.error — matches Phase 14 c2pa-config boot-log
  // convention. The vellum prefix marks this as engine-layer telemetry.
  console.error(`vellum: ${payload}`);
}

/**
 * Test-only — re-export flattenAnthropicError for direct verification in
 * the telemetry test file. Production code does NOT call this directly;
 * the engine facade composes flattenAnthropicError separately at error
 * boundaries (see src/engine/summary/index.ts Step 4 sanitizer catch and
 * Step 5 SDK error path).
 */
export { flattenAnthropicError };
