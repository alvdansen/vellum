// src/load-env.ts — find the operator's .env wherever the server was launched from.
//
// `import 'dotenv/config'` reads `.env` from process.cwd(). An MCP client picks
// its own working directory — Claude Desktop launches from `/` — so the .env the
// operator wrote next to the repo was simply never read.
//
// That used to be masked: the server ALSO resolved its database and migrations
// against cwd, so launching from anywhere but the repo root crashed at boot with
// a loud MIGRATION_PENDING. Fixing those to be package-relative removed the
// crash and left this quieter failure behind — the server now starts happily
// with zero providers configured, and the first `generation submit` reports
// missing credentials the operator can see plainly sitting in their .env file.
//
// So look in both places: the package root (where the .env lives next to the
// repo the client was pointed at) and the current directory (which is the repo
// root for `npm start`, and is what anyone running from a deployment directory
// expects). Real environment variables always win over both — dotenv never
// overwrites an existing value.

import { config } from 'dotenv';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The .env files to consult, most specific first.
 *
 * Order matters: dotenv does not overwrite a variable that is already set, so
 * the FIRST file to define a key wins. cwd comes first — someone who runs the
 * server from a directory holding its own .env means that one.
 *
 * Exported so the ordering can be asserted without writing a .env into the
 * repository root during a test run.
 */
export function envFilePaths(
  cwd: string = process.cwd(),
  root: string = packageRoot,
  override: string | undefined = process.env.DOTENV_CONFIG_PATH,
): string[] {
  // `DOTENV_CONFIG_PATH` is dotenv's own documented override, honoured by the
  // `dotenv/config` preload this replaced. Anyone using it — including the
  // stdio-hygiene tests, which point it at a nonexistent file to guarantee the
  // developer's real .env cannot bleed into a spawned server — means EXACTLY
  // those files and no others, so it replaces the search rather than extending
  // it. Dropping support for it would have silently changed what a documented
  // knob does.
  const explicit = override
    ?.split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (explicit?.length) return explicit;

  const cwdEnv = path.join(cwd, '.env');
  const packageEnv = path.join(root, '.env');
  return cwdEnv === packageEnv ? [cwdEnv] : [cwdEnv, packageEnv];
}

/** Load .env from the current directory and the package root. */
export function loadEnv(): void {
  config({ path: envFilePaths(), quiet: true });
}
