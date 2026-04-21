#!/usr/bin/env node
// Programmatic MCP Inspector smoke for both transports.
// Uses the real MCP SDK client — same handshake, tool discovery,
// and invocation path the browser Inspector uses.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ansi = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const results = [];
let anyFail = false;

function check(label, cond, detail = '') {
  const icon = cond ? ansi.green('✓') : ansi.red('✗');
  const line = `  ${icon} ${label}${detail ? ansi.dim(' — ' + detail) : ''}`;
  console.log(line);
  results.push({ label, cond, detail });
  if (!cond) anyFail = true;
}

async function runToolSuite(client, label) {
  console.log(ansi.bold(`\n── ${label} ──`));

  // 1. tools/list
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  check('tools/list returns 4 tools',
        tools.length === 4,
        `got [${tools.join(', ')}]`);
  check('tools are {project, sequence, shot, workspace}',
        JSON.stringify(tools) === JSON.stringify(['project', 'sequence', 'shot', 'workspace']));

  // 2. workspace create → capture id + breadcrumb
  const wsResult = await client.callTool({
    name: 'workspace',
    arguments: { action: 'create', name: 'demo' },
  });
  const wsStruct = wsResult.structuredContent;
  check('workspace create returns structuredContent',
        wsStruct && typeof wsStruct === 'object');
  check('workspace create breadcrumb_text === "demo"',
        wsStruct?.breadcrumb_text === 'demo',
        `got "${wsStruct?.breadcrumb_text}"`);
  check('workspace entity.id looks like ws_<nanoid>',
        typeof wsStruct?.entity?.id === 'string' && /^ws_.{21,}$/.test(wsStruct.entity.id),
        wsStruct?.entity?.id);
  check('workspace entity.name === "demo"',
        wsStruct?.entity?.name === 'demo');
  check('response content[0] is text mirror of structuredContent',
        wsResult.content?.[0]?.type === 'text' &&
        wsResult.content[0].text === JSON.stringify(wsStruct));
  check('workspace create isError is not true',
        wsResult.isError !== true);
  check('workspace breadcrumb array length === 1',
        Array.isArray(wsStruct?.breadcrumb) && wsStruct.breadcrumb.length === 1);

  const wsId = wsStruct.entity.id;

  // 3. project create (parent = workspace)
  const projResult = await client.callTool({
    name: 'project',
    arguments: { action: 'create', workspaceId: wsId, name: 'my-proj' },
  });
  const projStruct = projResult.structuredContent;
  check('project create breadcrumb_text === "demo > my-proj"',
        projStruct?.breadcrumb_text === 'demo > my-proj',
        `got "${projStruct?.breadcrumb_text}"`);
  // entity uses DB column naming (workspace_id snake_case per schema.ts)
  check('project entity.workspace_id === workspace id',
        projStruct?.entity?.workspace_id === wsId,
        `got "${projStruct?.entity?.workspace_id}"`);
  const projId = projStruct.entity.id;

  // 4. sequence create (parent = project)
  const seqResult = await client.callTool({
    name: 'sequence',
    arguments: { action: 'create', projectId: projId, name: 'sq010' },
  });
  const seqStruct = seqResult.structuredContent;
  check('sequence create breadcrumb_text === "demo > my-proj > sq010"',
        seqStruct?.breadcrumb_text === 'demo > my-proj > sq010',
        `got "${seqStruct?.breadcrumb_text}"`);
  const seqId = seqStruct.entity.id;

  // 5. shot create sh010 → success (4-level breadcrumb)
  const shotOk = await client.callTool({
    name: 'shot',
    arguments: { action: 'create', sequenceId: seqId, name: 'sh010' },
  });
  const shotStruct = shotOk.structuredContent;
  check('shot sh010 create succeeds (isError not true)',
        shotOk.isError !== true);
  check('shot breadcrumb_text has 4 levels: "demo > my-proj > sq010 > sh010"',
        shotStruct?.breadcrumb_text === 'demo > my-proj > sq010 > sh010',
        `got "${shotStruct?.breadcrumb_text}"`);
  check('shot breadcrumb array length === 4',
        Array.isArray(shotStruct?.breadcrumb) && shotStruct.breadcrumb.length === 4);

  // 6. shot create SH010 → isError:true, INVALID_SHOT_FORMAT surfaced.
  // NOTE: MCP SDK 1.29 intercepts Zod inputSchema validation BEFORE the tool
  // handler runs, so this path returns a -32602 validation error with the
  // raw Zod message embedded in content[0].text. Engine-level TypedErrors
  // (duplicate name, parent not found) DO go through the full envelope and
  // carry structuredContent.code — checked below.
  const shotBad = await client.callTool({
    name: 'shot',
    arguments: { action: 'create', sequenceId: seqId, name: 'SH010' },
  });
  check('shot SH010 returns isError:true',
        shotBad.isError === true);
  const badText = shotBad.content?.[0]?.text || '';
  check('shot SH010 response text contains the INVALID_SHOT_FORMAT sentinel',
        badText.includes('INVALID_SHOT_FORMAT'),
        `got "${badText.slice(0, 80)}..."`);
  check('shot SH010 response leaks NO SQLite error codes',
        !/SQLITE_CONSTRAINT_|SQLITE_BUSY|SQLITE_LOCKED/.test(JSON.stringify(shotBad)));

  // 6b. Engine-level TypedError: duplicate workspace name → DUPLICATE_NAME
  //     (bypasses Zod, goes through engine, hits handler's catch → toolError)
  const dup = await client.callTool({
    name: 'workspace',
    arguments: { action: 'create', name: 'demo' },  // same as earlier
  });
  check('duplicate workspace returns isError:true',
        dup.isError === true);
  check('duplicate workspace has structuredContent.code === DUPLICATE_NAME',
        dup.structuredContent?.code === 'DUPLICATE_NAME',
        `got "${dup.structuredContent?.code}"`);
  check('duplicate workspace response does NOT leak SQLITE_CONSTRAINT',
        !/SQLITE_CONSTRAINT/.test(JSON.stringify(dup)));

  // 6c. Engine-level TypedError: project with nonexistent workspace → PARENT_NOT_FOUND
  const orphan = await client.callTool({
    name: 'project',
    arguments: { action: 'create', workspaceId: 'ws_doesnotexist', name: 'x' },
  });
  check('orphan project returns isError:true',
        orphan.isError === true);
  check('orphan project has structuredContent.code === PARENT_NOT_FOUND',
        orphan.structuredContent?.code === 'PARENT_NOT_FOUND',
        `got "${orphan.structuredContent?.code}"`);

  // 7. list shots → pagination envelope
  const listResult = await client.callTool({
    name: 'shot',
    arguments: { action: 'list', sequenceId: seqId },
  });
  const listStruct = listResult.structuredContent;
  check('shot list envelope has {items, total, limit, offset}',
        Array.isArray(listStruct?.items) &&
        typeof listStruct?.total === 'number' &&
        listStruct?.limit === 20 &&
        listStruct?.offset === 0);
  check('shot list contains exactly 1 shot (the sh010 we created)',
        listStruct?.total === 1 && listStruct.items.length === 1);
  check('shot list item carries its own breadcrumb_text',
        listStruct?.items?.[0]?.breadcrumb_text === 'demo > my-proj > sq010 > sh010');

  // 8. get by id → round-trip
  const getShot = await client.callTool({
    name: 'shot',
    arguments: { action: 'get', id: listStruct.items[0].id },
  });
  check('shot get returns same id we created',
        getShot.structuredContent?.entity?.id === listStruct.items[0].id);
  check('shot get breadcrumb_text matches list view',
        getShot.structuredContent?.breadcrumb_text === 'demo > my-proj > sq010 > sh010');
}

// ─────── Run stdio client ───────
async function runStdio() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'vfx-smoke-stdio-'));
  const dbPath = join(tmpDir, 'smoke.db');

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/server.ts', '--db', dbPath],
    cwd: process.cwd(),
  });
  const client = new Client({ name: 'smoke-client', version: '0.0.1' });
  await client.connect(transport);
  try {
    await runToolSuite(client, 'STDIO transport (spawned: npx tsx src/server.ts)');
  } finally {
    await client.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─────── Run HTTP client ───────
async function runHttp() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'vfx-smoke-http-'));
  const dbPath = join(tmpDir, 'smoke.db');
  const port = 3097;

  const child = spawn('npx', ['tsx', 'src/server.ts', '--http', '--port', String(port), '--db', dbPath], {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  // Drain stderr so it doesn't block
  child.stderr.on('data', () => {});

  // Wait for the server to be listening
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`, { method: 'GET' });
      if (res.status === 404 || res.status === 405 || res.ok) { ready = true; break; }
    } catch {
      // ECONNREFUSED — server not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!ready) {
    // fallback: try the MCP endpoint directly
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        if (res) { ready = true; break; }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!ready) {
    console.log(ansi.red('HTTP server did not come up in time'));
    child.kill();
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error('HTTP server start timeout');
  }

  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  const client = new Client({ name: 'smoke-client', version: '0.0.1' });
  await client.connect(transport);
  try {
    await runToolSuite(client, 'STREAMABLE HTTP transport (127.0.0.1:' + port + '/mcp)');
  } finally {
    await client.close();
    child.kill('SIGTERM');
    // Give it a moment to shut down
    await new Promise((r) => setTimeout(r, 200));
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

try {
  await runStdio();
  await runHttp();
} catch (err) {
  console.error('\n' + ansi.red('FATAL:'), err?.message || err);
  if (err?.stack) console.error(ansi.dim(err.stack));
  process.exit(2);
}

const total = results.length;
const failed = results.filter((r) => !r.cond).length;
const passed = total - failed;

console.log('\n' + ansi.bold('── SUMMARY ──'));
console.log(`  ${passed}/${total} checks passed`);
if (anyFail) {
  console.log(ansi.red(`  ${failed} FAILED`));
  for (const r of results.filter((r) => !r.cond)) {
    console.log(`    - ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  }
  process.exit(1);
}
console.log(ansi.green('  all good'));
