import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverTs = resolve(__dirname, '../server.ts');

/**
 * Asserts D-21: stdout is reserved for MCP JSON-RPC frames.
 *
 * Boot the server with no input (stdin closed immediately). Every byte that
 * reaches stdout must parse as a valid JSON-RPC frame (object with
 * jsonrpc:"2.0"). Anything non-framed — help text, log lines, stack traces —
 * breaks the MCP protocol for stdio clients.
 *
 * This test shells out to `npx tsx` — slower than unit tests (~2s) but it's
 * the only way to verify stdio hygiene end-to-end. Any future addition of
 * console.log anywhere in the boot path will trip this test.
 */
describe('stdio hygiene', () => {
  it('writes zero bytes to stdout during boot with stdin closed', async () => {
    const tmpDb = resolve(__dirname, `__stdio-hygiene-${Date.now()}.db`);
    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn('npx', ['tsx', serverTs, '--db', tmpDb], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (c) => chunks.push(c));
      child.stderr.on('data', (c) => stderrChunks.push(c));
      // Close stdin — server will stay up on stdio transport but not emit any
      // JSON-RPC frames without a client request. Give it a moment then kill.
      child.stdin.end();
      setTimeout(() => child.kill('SIGTERM'), 1500);
      child.on('exit', () => resolvePromise());
      child.on('error', rejectPromise);
    });

    if (existsSync(tmpDb)) unlinkSync(tmpDb);
    const tmpDbWal = `${tmpDb}-wal`;
    const tmpDbShm = `${tmpDb}-shm`;
    if (existsSync(tmpDbWal)) unlinkSync(tmpDbWal);
    if (existsSync(tmpDbShm)) unlinkSync(tmpDbShm);

    const stdout = Buffer.concat(chunks).toString('utf8');
    const stderr = Buffer.concat(stderrChunks).toString('utf8');

    expect(stdout).toBe('');
    // stderr should have the boot marker from server.ts.
    expect(stderr).toMatch(/stdio transport connected/);
  }, 10_000);
});
