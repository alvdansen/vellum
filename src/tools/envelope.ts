import { z } from 'zod';
import { TypedError } from '../engine/errors.js';

/** Structured content payload shape expected by MCP's CallToolResult. */
type StructuredContent = { [key: string]: unknown };

/**
 * Map a Zod failure at the tool boundary into a typed INVALID_INPUT error.
 *
 * Every tool used to inline this and keep only `issue.path`, discarding the
 * reason — so `{action:'diff'}` on the version tool reported `Invalid input at
 * 'input.'`, naming neither the field nor the problem, and a rejected name gave
 * no clue which rule it broke. The path alone is also empty for whole-object
 * issues, which is exactly the unrecognized-key case below.
 *
 * Zod's own message is safe to surface: these are schema-authored strings
 * ("Too small: expected number to be >=1"), not driver output. toolError still
 * refuses to interpolate anything it has not typed (D-13, D-32).
 */
export function zodInputError(err: z.ZodError): TypedError {
  let first = err.issues[0];
  if (!first) return new TypedError('INVALID_INPUT', 'Invalid input');

  // A plain z.union (the version tool) wraps every arm's failures in one
  // invalid_union issue; a discriminatedUnion emits it only for an unknown
  // action. Drill into the arm the caller most plausibly meant — the branch
  // that did NOT fail on the action literal — so the surfaced issue names a
  // real field instead of the useless top-level "Invalid input".
  if (first.code === 'invalid_union') {
    const branches = first.errors;
    if (!branches || branches.length === 0) {
      return new TypedError(
        'INVALID_INPUT',
        `Invalid input at 'input.action': unrecognized action for this tool`,
        'Call tools/list to see the action enum for this tool.',
      );
    }
    const isActionMismatch = (i: { path: PropertyKey[]; code: string }) =>
      i.path.length === 1 && i.path[0] === 'action';
    const intended = branches.filter((b) => !b.some(isActionMismatch));
    const pool = (intended.length > 0 ? intended : branches)
      .slice()
      .sort((a, b) => a.length - b.length)[0]!;
    first = (pool.find((i) => !isActionMismatch(i)) ?? pool[0]!) as typeof first;
  }

  if (first.code === 'unrecognized_keys') {
    const keys = first.keys;
    const label = keys.length === 1 ? 'field' : 'fields';
    return new TypedError(
      'INVALID_INPUT',
      `Unrecognized ${label} for this action: ${keys.map((k) => `'${k}'`).join(', ')}`,
      'Unknown fields are rejected rather than ignored, so a mistyped filter cannot silently widen the result set. Check the spelling against this action in the tool schema — parent ids are camelCase on workspace/project/sequence/shot and snake_case on generation/version/asset.',
    );
  }

  const path = first.path.join('.');
  const at = path ? `input.${path}` : 'input';
  return new TypedError('INVALID_INPUT', `Invalid input at '${at}': ${first.message}`);
}

/**
 * Wrap a successful engine result into the MCP dual-form response (D-25).
 *
 * Contract: `JSON.parse(content[0].text)` must deep-equal `structuredContent`.
 * Clients that understand `structuredContent` use it directly; older clients fall
 * back to the text content block.
 */
export function toolOk(structured: StructuredContent) {
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
