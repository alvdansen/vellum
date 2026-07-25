/**
 * Phase 19 — SUM-06. Anthropic API key boot-validation.
 *
 * Reads ANTHROPIC_API_KEY from env, validates format, and returns
 * { apiKey } OR null (summary feature disabled — graceful degradation
 * to deterministic-template fallback per D-FB-2).
 *
 * Throws TypedError('ANTHROPIC_CONFIG_INVALID', ...) when the env var is
 * SET but malformed (wrong prefix / too short). Throwing BEFORE any
 * Engine construction is the parity-with-Phase-10 MIGRATION_PENDING
 * pattern — fail-fast at boot, never mid-operation.
 *
 * Path/secret leak hygiene (D-PRIV-4): Error messages emit ONLY the
 * last-4 of the API key (****abcd), never the full key. Mirrors
 * src/utils/c2pa-config.ts basename-only path discipline.
 *
 * Mirrors loadC2paConfigFromEnv at src/utils/c2pa-config.ts:46-104:
 * pure helper, exported for tests, imported by src/server.ts boot path.
 */

import { TypedError } from '../engine/errors.js';

export interface AnthropicConfig {
  apiKey: string;
}

export function loadAnthropicConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AnthropicConfig | null {
  const apiKey = env.ANTHROPIC_API_KEY;

  // Unset → feature disabled (D-FB-2 graceful degradation).
  if (!apiKey || apiKey.trim().length === 0) return null;

  // Validate format. last-4 ONLY in any error message (D-PRIV-4).
  if (!apiKey.startsWith('sk-ant-')) {
    throw new TypedError(
      'ANTHROPIC_CONFIG_INVALID',
      `ANTHROPIC_API_KEY format invalid (last 4: ****${apiKey.slice(-4)})`,
      'ANTHROPIC_API_KEY must start with "sk-ant-". See https://console.anthropic.com/settings/keys.',
    );
  }
  if (apiKey.length < 30) {
    throw new TypedError(
      'ANTHROPIC_CONFIG_INVALID',
      `ANTHROPIC_API_KEY too short (last 4: ****${apiKey.slice(-4)})`,
      'Verify the key was pasted in full from console.anthropic.com.',
    );
  }
  return { apiKey };
}
