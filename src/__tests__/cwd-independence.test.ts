import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_ENTRY, READY_MARKER } from '../test-utils/boot-server.js';
import { runMigrations } from '../store/migrate.js';

/**
 * REGRESSION — the server must boot from ANY working directory.
 *
 * The migrations folder defaulted to './drizzle' and the database to
 * './vellum.db', both resolved against process.cwd(). An MCP client launches
 * the server with a cwd it chooses (Claude Desktop uses '/'), so openDb threw
 * `MIGRATION_PENDING: Can't find meta/_journal.json file` before either
 * transport came up. Every client following the README's config block hit a
 * hard boot crash; the repo root was the only directory it worked from.
 *
 * Migrations and the package's own database belong to the MODULE, not to
 * whoever launched the process.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TSX_LOADER = join(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs');

/** Boot the server with an explicit cwd; resolve what it printed. */
function bootFrom(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--import', TSX_LOADER, SERVER_ENTRY, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, COMFYUI_API_KEY: '', GOOGLE_AI_STUDIO_API_KEY: '', ...env },
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`server never became ready from cwd=${cwd}. stderr:\n${stderr.slice(-1500)}`));
    }, 25_000);
    timer.unref?.();
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
      if (stderr.includes(READY_MARKER)) {
        clearTimeout(timer);
        child.kill('SIGKILL');
        resolvePromise(stderr);
      }
    });
    child.stdin.end();
    child.on('close', () => {
      clearTimeout(timer);
      // Closed without the marker → it crashed. Resolve so the test can assert
      // on the message rather than failing with a bare timeout.
      resolvePromise(stderr);
    });
    child.on('error', reject);
  });
}

describe('the server boots from any working directory', () => {
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

  it('the default migrations folder is absolute and really exists', () => {
    // Guards the fix at its root: a cwd-relative default would be neither.
    const result = runMigrations.toString();
    expect(result).toContain('DEFAULT_MIGRATIONS_FOLDER');
    expect(existsSync(join(REPO_ROOT, 'drizzle', 'meta', '_journal.json'))).toBe(true);
  });

  it('boots from a foreign cwd instead of throwing MIGRATION_PENDING', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vellum-cwd-'));
    dirs.push(dir);

    const stderr = await bootFrom(dir, ['--db', join(dir, 'probe.db')], {
      VELLUM_OUTPUTS_DIR: join(dir, 'out'),
    });

    expect(stderr).not.toMatch(/MIGRATION_PENDING/);
    expect(stderr).not.toMatch(/Can't find meta\/_journal\.json/);
    expect(stderr).toContain(READY_MARKER);
    expect(existsSync(join(dir, 'probe.db'))).toBe(true);
  }, 40_000);

  it('with no --db, resolves the database against the package root, not the caller', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vellum-cwd-'));
    dirs.push(dir);

    const stderr = await bootFrom(dir, [], { VELLUM_OUTPUTS_DIR: join(dir, 'out') });

    expect(stderr).toContain(READY_MARKER);
    // The db line names an absolute path under the package, and the caller's
    // directory is left clean — a cwd-relative default littered a fresh, empty
    // database wherever the client happened to start.
    expect(stderr).toMatch(/vellum: db=\//);
    expect(readdirSync(dir).filter((f) => f.endsWith('.db'))).toEqual([]);
  }, 40_000);

  it('VELLUM_DB_PATH overrides the default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vellum-cwd-'));
    dirs.push(dir);
    const dbPath = join(dir, 'env-chosen.db');

    const stderr = await bootFrom(dir, [], {
      VELLUM_DB_PATH: dbPath,
      VELLUM_OUTPUTS_DIR: join(dir, 'out'),
    });

    expect(stderr).toContain(`vellum: db=${dbPath}`);
    expect(existsSync(dbPath)).toBe(true);
  }, 40_000);

  // The three cases above all set VELLUM_OUTPUTS_DIR explicitly, so none of them
  // ever exercised the SHIPPED default — which is exactly how the outputs root
  // stayed cwd-relative after the database and migrations were fixed. This one
  // leaves it unset on purpose.
  it('with VELLUM_OUTPUTS_DIR unset, the outputs root is absolute and not the caller directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vellum-cwd-'));
    dirs.push(dir);

    const stderr = await bootFrom(dir, ['--db', join(dir, 'probe.db')]);

    expect(stderr).toContain(READY_MARKER);
    // Absolute, under the package — not the bare relative 'outputs' that every
    // consumer then re-resolved against whatever cwd the client chose.
    expect(stderr).toMatch(/vellum: outputs=\//);
    expect(stderr).toContain(`vellum: outputs=${join(REPO_ROOT, 'outputs')}`);
    expect(readdirSync(dir)).not.toContain('outputs');
  }, 40_000);

  it('a RELATIVE VELLUM_OUTPUTS_DIR is resolved to an absolute path', async () => {
    // An operator typing a relative path means it relative to where they are
    // standing — but it must still be pinned once, at boot, not re-resolved by
    // every consumer against whatever cwd happens to be current later.
    const dir = mkdtempSync(join(tmpdir(), 'vellum-cwd-'));
    dirs.push(dir);

    const stderr = await bootFrom(dir, ['--db', join(dir, 'probe.db')], {
      VELLUM_OUTPUTS_DIR: 'renders',
    });

    expect(stderr).toContain(READY_MARKER);
    // realpath: on macOS the temp dir is /var/... but path.resolve inside the
    // child yields the /private/var/... it actually is.
    expect(stderr).toContain(`vellum: outputs=${join(realpathSync(dir), 'renders')}`);
  }, 40_000);
});
