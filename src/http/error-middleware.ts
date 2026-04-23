// Hono error-middleware for the dashboard REST + SSE surface (Phase 5 / D-WEBUI-34).
//
// - statusForCode(): pure code → HTTP status mapping. Pattern-based with explicit
//   overrides for codes that don't fit the pattern (TAG_INVALID, *_UNAVAILABLE, etc.).
// - typedErrorHandler: Hono ErrorHandler that:
//     • Converts any TypedError thrown below the route boundary into
//       { error: { code, message } } with the mapped status.
//     • Converts unknown Error instances into 500 + { error: { code: 'INTERNAL_ERROR', message } }.
//     • Never leaks stack traces (T-5-09 mitigation — verified by unit test).
//
// Architecture note: this file is part of the HTTP layer, so it does NOT import
// `@modelcontextprotocol/sdk` or `better-sqlite3` (tool-engine separation).

import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { TypedError } from '../engine/errors.js';

// Explicit 404 set — includes the *_NOT_FOUND pattern plus *_UNAVAILABLE codes
// (PROVENANCE_UNAVAILABLE + OUTPUT_UNAVAILABLE) which are "found the entity but
// the associated resource is missing" cases and should map to 404, not 400.
const NOT_FOUND_CODES = new Set<string>([
  'WORKSPACE_NOT_FOUND',
  'PROJECT_NOT_FOUND',
  'SEQUENCE_NOT_FOUND',
  'SHOT_NOT_FOUND',
  'VERSION_NOT_FOUND',
  'PARENT_NOT_FOUND',
  'PROVENANCE_UNAVAILABLE',
  'OUTPUT_UNAVAILABLE',
]);

// Explicit 422 set — precondition/limit failures (cannot be completed in current state).
const UNPROCESSABLE_CODES = new Set<string>([
  'REPRODUCE_BLOCKED',
  'VERSION_NOT_COMPLETED',
  'TAG_LIMIT_EXCEEDED',
  'METADATA_LIMIT_EXCEEDED',
]);

// Explicit 409 set — uniqueness / optimistic-concurrency conflicts.
const CONFLICT_CODES = new Set<string>([
  'DUPLICATE_NAME',
  'CONCURRENT_SUBMIT_CONFLICT',
]);

// Explicit 502 set — upstream gateway / external service failures.
// Also covers the COMFYUI_* pattern (any future COMFYUI_* code falls here).
const BAD_GATEWAY_CODES = new Set<string>([
  'COMFYUI_API_ERROR',
  'COMFYUI_CREDENTIALS_MISSING',
  'COMFYUI_RATE_LIMITED',
  'GENERATION_TIMEOUT',
  'DOWNLOAD_FAILED',
]);

// Explicit 400 set — validation codes that don't start with INVALID_.
// TAG_INVALID + METADATA_INVALID are *_INVALID (suffix); ITERATE_INVALID_PATCH
// is *_INVALID_* (middle). Combined with the INVALID_* prefix check below, this
// covers every validation code in the ErrorCode union.
const BAD_REQUEST_CODES = new Set<string>([
  'TAG_INVALID',
  'METADATA_INVALID',
  'ITERATE_INVALID_PATCH',
]);

/**
 * Map a TypedError code string to the appropriate HTTP status code.
 *
 * Pattern-and-allowlist strategy:
 *   1. Explicit 404 set (NOT_FOUND + UNAVAILABLE codes).
 *   2. INVALID_* prefix OR BAD_REQUEST set → 400 (covers TAG_INVALID,
 *      METADATA_INVALID, ITERATE_INVALID_PATCH — codes that don't start with INVALID_).
 *   3. Bad-gateway set OR COMFYUI_* prefix → 502.
 *   4. Unprocessable set → 422.
 *   5. Conflict set → 409.
 *   6. Unknown code → 500 (fallthrough; original code is preserved in the body
 *      by `typedErrorHandler`).
 */
export function statusForCode(code: string): number {
  if (NOT_FOUND_CODES.has(code)) return 404;
  if (code.startsWith('INVALID_') || BAD_REQUEST_CODES.has(code)) return 400;
  if (BAD_GATEWAY_CODES.has(code) || code.startsWith('COMFYUI_')) return 502;
  if (UNPROCESSABLE_CODES.has(code)) return 422;
  if (CONFLICT_CODES.has(code)) return 409;
  return 500;
}

/**
 * Hono ErrorHandler shared by every dashboard REST route (Plan 05-04) and the
 * SSE endpoint (Plan 05-05). Usage:
 *
 *   import { typedErrorHandler } from './error-middleware.js';
 *   app.onError(typedErrorHandler);
 *
 * Response shape is always `{ error: { code, message } }` — never includes
 * stack traces or internal state. Unknown (non-TypedError) throws are coerced
 * into `INTERNAL_ERROR` so clients never see a leaked SQLite constraint name
 * or raw Node error class string.
 */
export const typedErrorHandler: ErrorHandler = (err, c) => {
  if (err instanceof TypedError) {
    return c.json(
      { error: { code: err.code, message: err.message } },
      statusForCode(err.code) as ContentfulStatusCode,
    );
  }
  return c.json({ error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
};
