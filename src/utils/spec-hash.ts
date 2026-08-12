import { createHash } from 'node:crypto';

/**
 * sha256 hex of a project spec revision body.
 *
 * Lives here rather than in spec-repo.ts on purpose: it is a pure function with
 * no db dependency, AND the repo file is held to a structural append-only guard
 * that greps for `.update(`. Crypto's streaming `.update()` is not a Drizzle
 * mutation builder, but a grep cannot tell them apart — so the hashing stays
 * out of the file the guard protects instead of the guard being loosened.
 */
export function hashSpecContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
