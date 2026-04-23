import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { DEFAULT_COMFYUI_API_BASE } from '../comfyui/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverTs = resolve(__dirname, '../server.ts');

/**
 * Asserts D-21 + D-GEN-12 + D-GEN-14: stdio + credential hygiene.
 *
 *  - stdout is reserved for MCP JSON-RPC frames. Every byte on stdout during
 *    boot (with no client request in flight) is a regression.
 *  - stderr may carry log lines, but MUST NEVER contain the literal string
 *    `COMFYUI_API_KEY=` (D-GEN-12). The key value itself never appears — only
 *    the last 4 chars in the credential-presence log.
 *  - When COMFYUI_API_KEY is absent, the credential log line does NOT fire
 *    (D-GEN-14 — silent if .env missing, preserves TRNS-04 zero-config boot).
 *  - When COMFYUI_API_KEY is set, the credential log line matches the exact
 *    D-GEN-12 format: `ComfyUI credentials loaded (key ****<last4>, base <base>)`.
 *
 * These tests shell out to `npx tsx src/server.ts` — ~2s each — but it's the
 * only way to verify stdio + credential hygiene end-to-end (Pitfall 2 —
 * dotenv races caught only in the real boot path).
 */

/**
 * Spawn the server with a controlled env, capture stdout + stderr, kill after
 * 1500ms, clean up the temp DB. Returns the captured bytes.
 *
 * Note on env isolation: dotenv's side-effect import reads `.env` from the
 * cwd by default. Tests need determinism regardless of the developer's local
 * `.env` file, so callers can set DOTENV_CONFIG_PATH to a nonexistent path to
 * force-load-nothing. The caller can also set COMFYUI_API_KEY in the spawn
 * env directly — env vars take precedence over .env when dotenv loads.
 */
function bootAndKill(
  env: NodeJS.ProcessEnv,
  dbLabel: string,
  opts: { killAfterMs?: number; signal?: NodeJS.Signals; keepStdinOpen?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number | null; signalName: NodeJS.Signals | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const tmpDb = resolve(__dirname, `__stdio-${dbLabel}-${Date.now()}.db`);
    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn('npx', ['tsx', serverTs, '--db', tmpDb], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => stderrChunks.push(c));
    // Close stdin by default. Some tests (SIGTERM graceful shutdown) keep
    // stdin open so the MCP stdio transport does not exit on EOF before the
    // signal arrives.
    if (!opts.keepStdinOpen) {
      child.stdin.end();
    }
    // Phase 5 (Plan 05-01): npm workspaces hoist expanded node_modules, which
    // pushed `tsx` cold-start past the prior 1500ms window under parallel vitest
    // load. Default 3000ms is purely a timing margin — boots still complete in
    // ~1.5-2s on healthy runs; caller may still override via opts.killAfterMs.
    const killMs = opts.killAfterMs ?? 3000;
    const killSig = opts.signal ?? 'SIGTERM';
    const killTimer = setTimeout(() => child.kill(killSig), killMs);
    child.on('exit', (code, signal) => {
      clearTimeout(killTimer);
      try {
        if (!child.stdin.destroyed) child.stdin.end();
      } catch {
        /* ignore */
      }
      for (const suffix of ['', '-wal', '-shm']) {
        const p = tmpDb + suffix;
        if (existsSync(p)) {
          try {
            unlinkSync(p);
          } catch {
            // ignore — test cleanup is best-effort
          }
        }
      }
      resolvePromise({
        stdout: Buffer.concat(chunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code,
        signalName: signal,
      });
    });
    child.on('error', rejectPromise);
  });
}

describe('stdio hygiene', () => {
  it('writes zero bytes to stdout during boot with stdin closed (D-21)', async () => {
    // Scrub env so the test is deterministic regardless of the developer's
    // local `.env`. DOTENV_CONFIG_PATH to a nonexistent path makes dotenv's
    // side-effect import a no-op.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOTENV_CONFIG_PATH: '/nonexistent-stdio-hygiene-stdout',
    };
    const { stdout, stderr } = await bootAndKill(env, 'zero-stdout');
    expect(stdout).toBe('');
    // stderr should have the boot marker from server.ts.
    expect(stderr).toMatch(/stdio transport connected/);
  }, 15_000);

  it('stderr never contains the literal "COMFYUI_API_KEY=" (D-GEN-12 secret hygiene)', async () => {
    // Boot with a fake key via the spawn env — env vars take precedence over
    // .env loading (dotenv does not override pre-existing process.env keys).
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      COMFYUI_API_KEY: 'sk-fake-abcdef1234567890',
      DOTENV_CONFIG_PATH: '/nonexistent-stdio-hygiene-key-leak',
    };
    const { stderr } = await bootAndKill(env, 'key-leak');
    // The literal assignment string must never appear in any log path.
    expect(stderr).not.toContain('COMFYUI_API_KEY=');
    // Defence-in-depth: neither the full key nor any prefix of it may leak.
    expect(stderr).not.toContain('sk-fake-abcdef1234567890');
    expect(stderr).not.toContain('abcdef');
  }, 15_000);

  it('without COMFYUI_API_KEY, no credential-loaded log line (D-GEN-14 silent)', async () => {
    // Force dotenv to load nothing so the developer's real .env cannot bleed
    // COMFYUI_API_KEY into the process under test.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOTENV_CONFIG_PATH: '/nonexistent-stdio-hygiene-no-key',
    };
    const { stderr } = await bootAndKill(env, 'no-key');
    expect(stderr).not.toMatch(/ComfyUI credentials loaded/);
    // Sanity: the stdio-connected marker still fires, so the server really
    // did boot (this is not a silent failure masquerading as silence).
    expect(stderr).toMatch(/stdio transport connected/);
  }, 15_000);

  it('with COMFYUI_API_KEY set, stderr has key ****last4 + base log (D-GEN-12 format)', async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      COMFYUI_API_KEY: 'sk-fake-abcdef1234567890',
      DOTENV_CONFIG_PATH: '/nonexistent-stdio-hygiene-with-key',
    };
    const { stderr } = await bootAndKill(env, 'with-key');
    // Exact D-GEN-12 format: `ComfyUI credentials loaded (key ****7890, base <DEFAULT_COMFYUI_API_BASE>)`.
    const escapedBase = DEFAULT_COMFYUI_API_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(stderr).toMatch(
      new RegExp(`ComfyUI credentials loaded \\(key \\*\\*\\*\\*7890, base ${escapedBase}\\)`),
    );
  }, 15_000);

  it('IS-02: bad COMFYUI_API_BASE (http://) causes non-zero exit at boot', async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOTENV_CONFIG_PATH: '/nonexistent-stdio-hygiene-bad-base',
      COMFYUI_API_BASE: 'http://cloud.comfy.org', // cleartext — must be rejected
    };
    const { stderr, exitCode } = await bootAndKill(env, 'bad-base-http');
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/cleartext|https|COMFYUI_API_BASE/i);
  }, 15_000);

  it('IS-02: bad COMFYUI_API_BASE (loopback host) causes non-zero exit at boot', async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOTENV_CONFIG_PATH: '/nonexistent-stdio-hygiene-bad-base-loopback',
      COMFYUI_API_BASE: 'https://127.0.0.1:8188', // private — must be rejected
    };
    const { stderr, exitCode } = await bootAndKill(env, 'bad-base-loopback');
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/private|loopback|COMFYUI_API_BASE/i);
  }, 15_000);

  it('Phase 4 tool registration does not leak SQL to stdout or stderr on boot (D-ASST-26, T-04-04-04)', async () => {
    // Boot the server with Phase 4's asset tool registered; verify the
    // additional tables (tags, metadata) + their indexes do NOT cause any
    // SQL DDL/DML to echo into stdout or stderr. Guards against an
    // accidentally-chatty migration logger or repo-level debug trace in
    // src/engine/assets.ts, src/store/tag-repo.ts, src/store/metadata-repo.ts.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOTENV_CONFIG_PATH: '/nonexistent-stdio-hygiene-phase4-boot',
    };
    const { stdout, stderr } = await bootAndKill(env, 'phase4-boot');
    // stdout must be empty on boot — stdio transport reserves it for JSON-RPC
    // frames. No client requests are sent in this test, so any byte is a leak.
    expect(stdout).toBe('');
    // stderr may carry credentials + DB path logs but MUST NOT carry raw SQL
    // statements from the Phase 4 migration or repo layers.
    expect(stderr).not.toContain('INSERT INTO tags');
    expect(stderr).not.toContain('INSERT INTO metadata');
    expect(stderr).not.toContain('CREATE TABLE `tags`');
    expect(stderr).not.toContain('CREATE TABLE `metadata`');
    // Defence-in-depth: raw unquoted identifiers (`tags` / `metadata`) also
    // shouldn't appear in log lines as a DDL giveaway. The credential-presence
    // log and boot-marker logs are noun-free.
    expect(stderr).not.toContain('idx_tags_tag');
    expect(stderr).not.toContain('idx_metadata_key_value');
  }, 15_000);

  it('IT-18: SIGTERM triggers graceful shutdown with exit 0 and a "shutting down" log line', async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOTENV_CONFIG_PATH: '/nonexistent-stdio-hygiene-sigterm',
    };
    // Keep stdin open so the MCP stdio transport does not exit on EOF. Send
    // SIGTERM after 2s — enough time for tsx cold start + stdio connect +
    // engine.start(). The graceful shutdown handler must call engine.stop()
    // and process.exit(0); bootAndKill waits for `exit`.
    const { stderr, exitCode } = await bootAndKill(env, 'sigterm', {
      killAfterMs: 2000,
      signal: 'SIGTERM',
      keepStdinOpen: true,
    });
    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/SIGTERM received/);
    expect(stderr).toMatch(/shutting down/);
  }, 20_000);
});
