// src/utils/http-timeout.ts — deadline for provider CONTROL-PLANE HTTP calls.
//
// WHY: the engine's generation timeout is a wall-clock check against the row's
// created_at, evaluated BEFORE the status call is issued (see
// GenerationEngine.getGenerationStatus). It cannot fire while a call is in
// flight. A provider that accepts the TCP connection and then never responds
// therefore hangs the await forever: the recovery poller's slot is held for the
// life of the process, queued healthy jobs never get polled, and a
// `generation.check` tool call hangs the calling agent with it.
//
// Node's fetch has no default timeout, so every adapter needs an explicit
// deadline. This is deliberately generous — it is a hang-breaker, not a
// latency budget. A status poll still running after two minutes is wedged.
//
// SCOPE — control plane only (submit / status / result). Do NOT attach this to
// a download: those stream a body up to the 500 MiB provider cap and would be
// aborted mid-transfer on a slow link. Download safety is the byte cap plus
// the SSRF allowlist, not a deadline.

/** Deadline for a provider submit/status/result call. */
export const PROVIDER_CONTROL_TIMEOUT_MS = 120_000;

/**
 * Deadline for a provider whose "submit" performs the generation inline rather
 * than enqueuing a job (Google AI Studio's generateContent returns the finished
 * image). The work itself is happening on the far side of this call, so the
 * hang-breaker has to sit well above normal image-generation latency.
 */
export const PROVIDER_INLINE_GENERATION_TIMEOUT_MS = 300_000;

/**
 * An AbortSignal that fires after `ms`. Wrapped rather than called inline so
 * adapters share one definition of "wedged" and tests can drive a short
 * deadline through the adapter's `requestTimeoutMs` option.
 */
export function timeoutSignal(ms: number = PROVIDER_CONTROL_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}
