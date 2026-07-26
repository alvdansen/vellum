// src/resolve-db-path.ts — decide which database file the server opens.
//
// Pulled out of server.ts so it can be ASSERTED WITHOUT OPENING ANYTHING.
//
// The cwd-independence test used to prove the default by booting a real server
// with no `--db` and reading the path it logged. That works, but booting also
// opens the file and runs migrations — so `npm test` opened, WAL-mode'd and
// migrated the developer's own database sitting in the repo root. On a machine
// where only the legacy file exists, that was 196 KB of real work; on a fresh
// clone it silently created and migrated one, leaving a suite that is supposed
// to be hermetic with a database behind it. A contributor running `npm test` on
// a branch that adds a migration applied it to their live data, unprompted.
//
// Resolution order, most specific first:
//   1. `--db` on the command line
//   2. `VELLUM_DB_PATH`
//   3. the package's own `vellum.db`
//
// with one exception at (3): if `vellum.db` does not exist but the pre-rename
// `vfx-familiar.db` does, adopt it in place rather than starting empty beside
// somebody's existing work.

import * as path from 'node:path';
import { existsSync as realExistsSync } from 'node:fs';

export const DEFAULT_DB_BASENAME = 'vellum.db';
export const LEGACY_DB_BASENAME = 'vfx-familiar.db';

export interface ResolveDbPathInput {
  /** `--db`, the most specific source. */
  argDb?: string;
  /** `VELLUM_DB_PATH`, already trimmed to undefined when blank. */
  envDb?: string;
  /** The package root — NOT process.cwd(); see the header. */
  packageRoot: string;
  /** Injectable for tests, so resolution can be exercised with no filesystem. */
  exists?: (p: string) => boolean;
}

export function resolveDbPath({
  argDb,
  envDb,
  packageRoot,
  exists = realExistsSync,
}: ResolveDbPathInput): string {
  if (argDb) return argDb;
  if (envDb) return envDb;
  const preferred = path.join(packageRoot, DEFAULT_DB_BASENAME);
  const legacy = path.join(packageRoot, LEGACY_DB_BASENAME);
  return !exists(preferred) && exists(legacy) ? legacy : preferred;
}
