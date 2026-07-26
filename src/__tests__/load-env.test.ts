// src/__tests__/load-env.test.ts
//
// REGRESSION — the operator's .env must be found regardless of where the client
// launched the server from.
//
// `import 'dotenv/config'` reads .env from process.cwd(), and an MCP client
// chooses its own working directory (Claude Desktop uses `/`). So the .env
// sitting next to the repo was never read.
//
// That used to be masked by a louder bug: the database and migrations were also
// cwd-relative, so launching from anywhere but the repo root crashed at boot.
// Making those package-relative removed the crash and left this quieter failure
// — the server starts happily with ZERO providers configured, and the first
// submit reports missing credentials the operator can see in their .env file.

import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { envFilePaths } from '../load-env.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  dirs.length = 0;
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'vellum-env-'));
  dirs.push(d);
  return d;
}

describe('envFilePaths', () => {
  test('includes the package root, so a foreign cwd still finds the operator .env', () => {
    const paths = envFilePaths('/', REPO_ROOT);
    expect(paths).toContain(join(REPO_ROOT, '.env'));
  });

  test('prefers the current directory over the package root', () => {
    // Someone running from a deployment directory that has its own .env means
    // that one. dotenv keeps the first definition, so cwd must come first.
    const paths = envFilePaths('/some/deploy/dir', REPO_ROOT);
    expect(paths[0]).toBe('/some/deploy/dir/.env');
    expect(paths[1]).toBe(join(REPO_ROOT, '.env'));
  });

  test('does not list the same file twice when cwd IS the package root', () => {
    expect(envFilePaths(REPO_ROOT, REPO_ROOT)).toEqual([join(REPO_ROOT, '.env')]);
  });
});

describe('the resolved paths actually load values', () => {
  // Exercised against real dotenv with temp files, so the ordering claim above
  // is verified rather than assumed — and no .env is ever written into the repo.
  test('a package-root .env is read when cwd has none', () => {
    const cwd = tmp();
    const root = tmp();
    writeFileSync(join(root, '.env'), 'VELLUM_TEST_ONLY_A=from-package-root\n');

    const parsed: Record<string, string> = {};
    config({ path: envFilePaths(cwd, root), processEnv: parsed, quiet: true });
    expect(parsed.VELLUM_TEST_ONLY_A).toBe('from-package-root');
  });

  test('a cwd .env wins over the package root for the same key', () => {
    const cwd = tmp();
    const root = tmp();
    writeFileSync(join(cwd, '.env'), 'VELLUM_TEST_ONLY_B=from-cwd\n');
    writeFileSync(join(root, '.env'), 'VELLUM_TEST_ONLY_B=from-package-root\n');

    const parsed: Record<string, string> = {};
    config({ path: envFilePaths(cwd, root), processEnv: parsed, quiet: true });
    expect(parsed.VELLUM_TEST_ONLY_B).toBe('from-cwd');
  });

  test('keys unique to each file are both loaded', () => {
    const cwd = tmp();
    const root = tmp();
    writeFileSync(join(cwd, '.env'), 'VELLUM_TEST_ONLY_C=cwd-only\n');
    writeFileSync(join(root, '.env'), 'VELLUM_TEST_ONLY_D=root-only\n');

    const parsed: Record<string, string> = {};
    config({ path: envFilePaths(cwd, root), processEnv: parsed, quiet: true });
    expect(parsed.VELLUM_TEST_ONLY_C).toBe('cwd-only');
    expect(parsed.VELLUM_TEST_ONLY_D).toBe('root-only');
  });
});

describe('DOTENV_CONFIG_PATH override', () => {
  // dotenv's own documented knob, honoured by the `dotenv/config` preload this
  // replaced. Replacing that preload with an explicit config() call silently
  // stopped honouring it — which broke the stdio-hygiene tests that use it to
  // guarantee a spawned server cannot pick up the developer's real .env, and
  // would have broken it for any operator relying on it too.
  test('replaces the search entirely rather than extending it', () => {
    expect(envFilePaths('/cwd', '/pkg', '/explicit/.env')).toEqual(['/explicit/.env']);
  });

  test('accepts a comma-separated list', () => {
    expect(envFilePaths('/cwd', '/pkg', '/a/.env, /b/.env')).toEqual(['/a/.env', '/b/.env']);
  });

  test('an empty or blank override falls back to the normal search', () => {
    for (const override of ['', '   ', ',', undefined]) {
      const paths = envFilePaths('/cwd', '/pkg', override);
      expect(paths, JSON.stringify(override)).toEqual(['/cwd/.env', '/pkg/.env']);
    }
  });

  test('pointing it at a nonexistent file loads nothing', () => {
    const parsed: Record<string, string> = {};
    config({ path: envFilePaths('/cwd', '/pkg', '/nonexistent-vellum-env'), processEnv: parsed, quiet: true });
    expect(Object.keys(parsed)).toHaveLength(0);
  });
});
