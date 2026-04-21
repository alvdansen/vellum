import { TypedError } from '../engine/errors.js';

/**
 * Wrap a successful engine result into the MCP dual-form response (D-25).
 *
 * Contract: `JSON.parse(content[0].text)` must deep-equal `structuredContent`.
 * Clients that understand `structuredContent` use it directly; older clients fall
 * back to the text content block.
 */
export function toolOk(structured: unknown) {
  return {
    structuredContent: structured,
    content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
  };
}

/**
 * Map an error thrown at the tool boundary into an MCP error response (D-28).
 *
 * Behavior:
 *  - `TypedError` → `{ isError: true, structuredContent: { code, message, hint? } }`.
 *    The `hint` key is only present when `err.hint` is truthy (D-31).
 *  - Anything else (`Error`, plain object, string, SQLite driver error, Zod
 *    failure) → defence-in-depth re-wrap as a generic `INVALID_INPUT` payload.
 *    The raw error is logged to stderr (D-21) but NEVER interpolated into the
 *    response body (D-13, D-32). No `SQLITE_CONSTRAINT_*` or Zod stack shape ever
 *    reaches the agent.
 */
export function toolError(err: unknown) {
  if (err instanceof TypedError) {
    const payload: { code: string; message: string; hint?: string } = {
      code: err.code,
      message: err.message,
    };
    if (err.hint) {
      payload.hint = err.hint;
    }
    return {
      isError: true,
      structuredContent: payload,
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    };
  }

  // Defence-in-depth: never leak raw Zod / SQLite / Error shape to the agent.
  // stderr is the only logging channel for the stdio transport (D-21).
  console.error('[envelope] Unwrapped error at tool boundary:', err);
  const fallback = {
    code: 'INVALID_INPUT' as const,
    message: 'Unexpected internal error',
  };
  return {
    isError: true,
    structuredContent: fallback,
    content: [{ type: 'text' as const, text: JSON.stringify(fallback) }],
  };
}
