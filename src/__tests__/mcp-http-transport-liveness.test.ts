import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SERVER_ENTRY } from '../test-utils/boot-server.js';

/**
 * REGRESSION — repeated POSTs to /mcp must not kill the server process.
 *
 * The HTTP transport used to bridge through fetch-to-node's Node-shaped req/res
 * shim. That shim turns the response's 'finish' event into a ReadableStream
 * `controller.close()`, and on this path 'finish' fired twice: the second
 * close() threw ERR_INVALID_STATE from a TIMER callback, outside any try/catch,
 * so it reached the process as an uncaught exception. The server died on
 * roughly the third POST, taking the stdio transport, the dashboard, the REST
 * API and SSE with it. Every user following the README's Streamable HTTP
 * instructions hit it in their first session.
 *
 * WHY THIS TEST SPAWNS A REAL SERVER: the pre-existing dual-transport tests
 * drive the Hono app in-process via `app.fetch`, which never crosses the
 * Node-response bridge at all. 2200+ green tests did not see this. Only a
 * really-listening server over a real socket exercises it.
 */

const POST_COUNT = 6;

async function poll(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Deliberately node:http with `agent: false`, NOT global fetch.
 *
 * fetch keeps the socket alive and reuses it, which changes when the server's
 * response 'close' fires and masks the bug entirely — against the broken build,
 * six keep-alive fetches all return 200 and the process survives (the throw is
 * still logged, but never lands fatally). A real MCP client, and curl, open a
 * connection per request and close it, which is what drives the fatal path.
 * This test only means something if it disconnects like they do.
 */
function mcpPost(port: number): Promise<number> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        agent: false, // no keep-alive: one connection per request, then close
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume(); // drain like a real client
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.setTimeout(5_000, () => {
      req.destroy();
      resolve(0);
    });
    req.on('error', () => resolve(0)); // connection refused / reset — server gone
    req.end(body);
  });
}

describe('MCP Streamable HTTP transport survives repeated requests', () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  let dir: string | undefined;

  afterEach(() => {
    child?.kill('SIGKILL');
    child = undefined;
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      dir = undefined;
    }
  });

  it(`serves ${POST_COUNT} sequential POST /mcp calls and stays alive`, async () => {
    dir = mkdtempSync(join(tmpdir(), 'vellum-mcp-live-'));
    // A port unlikely to collide with a developer's running server.
    const port = 41000 + Math.floor(Math.random() * 2000);
    let stderr = '';

    child = spawn(
      process.execPath,
      ['--import', 'tsx', SERVER_ENTRY, '--http', '--port', String(port), '--db', join(dir, 't.db')],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        // Keep the child off the developer's real outputs dir and credentials.
        env: {
          ...process.env,
          VELLUM_OUTPUTS_DIR: join(dir, 'out'),
          COMFYUI_API_KEY: '',
          GOOGLE_AI_STUDIO_API_KEY: '',
          GEMINI_API_KEY: '',
        },
      },
    ) as ChildProcessWithoutNullStreams;
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });

    const up = await poll(`http://127.0.0.1:${port}/api/workspaces`, 25_000);
    expect(up, `server never became ready. stderr:\n${stderr.slice(-1500)}`).toBe(true);

    const statuses: number[] = [];
    for (let i = 0; i < POST_COUNT; i++) {
      statuses.push(await mcpPost(port));
    }

    // Every request answered — not just the first two before the crash.
    expect(statuses).toEqual(Array<number>(POST_COUNT).fill(200));

    // The process is still running, and the OTHER surfaces it shares with are
    // still served (the crash took the whole process, not just /mcp).
    expect(child.exitCode, `server exited. stderr:\n${stderr.slice(-1500)}`).toBeNull();
    expect(await poll(`http://127.0.0.1:${port}/api/workspaces`, 3_000)).toBe(true);

    // And nothing was thrown asynchronously past the handler.
    expect(stderr).not.toMatch(/ERR_INVALID_STATE/);
    expect(stderr).not.toMatch(/Controller is already closed/);
  }, 60_000);
});
