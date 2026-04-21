import type { Config } from 'drizzle-kit';

/**
 * drizzle-kit configuration for schema introspection and migration generation.
 * Phase-2 addition: Drizzle migrator owns the ledger from 0001 onward.
 * Phase 1's `user_version=1` pragma coexists — separate mechanisms (see
 * .planning/phases/02-comfyui-generation/02-RESEARCH.md §A7).
 *
 * Regenerate migrations after a schema.ts change:
 *   npx drizzle-kit generate
 */
export default {
  dialect: 'sqlite',
  schema: './src/store/schema.ts',
  out: './drizzle',
} satisfies Config;
