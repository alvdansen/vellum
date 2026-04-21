// Typed error model for VFX Familiar engine (D-28..D-32).
// These 8 codes cover Phase 1. Plans 02/03 will re-use them; later phases may extend.

export type ErrorCode =
  | 'WORKSPACE_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'SEQUENCE_NOT_FOUND'
  | 'SHOT_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'DUPLICATE_NAME'
  | 'INVALID_SHOT_FORMAT'
  | 'INVALID_INPUT';

/**
 * Typed engine error. Every error thrown below the tool boundary is a TypedError.
 * Tool envelope maps this to MCP's `{ isError: true, structuredContent: { code, message, hint } }`.
 * Raw Zod or SQLite errors must never reach the agent — see D-13, D-32.
 */
export class TypedError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = 'TypedError';
  }
}
