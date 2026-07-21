import { nanoid } from 'nanoid';

export type IdPrefix = 'ws' | 'proj' | 'seq' | 'shot' | 'ver' | 'prov' | 'tag' | 'meta' | 'sse' | 'prop';

/**
 * Generate a prefixed nanoid for a hierarchy entity.
 * Format: `${prefix}_<21-char-nanoid>` — the prefix aids log/error readability
 * and matches the error-message examples from RESEARCH §Cluster E (e.g. 'ws_abc').
 */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${nanoid()}`;
}
