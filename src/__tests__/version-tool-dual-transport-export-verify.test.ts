/**
 * Phase 16 / Plan 16-03 — wire-level dual-transport parity for
 * version.export_manifest + version.verify_manifest. Mirrors the Phase 14
 * c2pa-uat-mcp-tool.test.ts pattern: real spawned server, real MCP SDK
 * Client over BOTH stdio and Streamable HTTP, deepEqual envelope assertion.
 *
 * Coverage:
 *   - 5 stdio cases on a SIGNED seed (export happy, verify by-version,
 *     verify by-bytes with breadcrumb null, VERSION_NOT_FOUND, INVALID_INPUT)
 *   - 2 stdio cases on an UNSIGNED seed (export absent, verify no_manifest)
 *   - 3 HTTP-vs-stdio parity cases (export, verify by-version, verify by-bytes)
 *   - 1 D-PROV-08 dual-form mirror assertion at the wire boundary
 *   - 1 INVALID_INPUT error-path parity (HTTP vs stdio) — C-07
 *
 * Skip-on-CI: signed-seed tests need openssl + bundled c2pa-node certs.
 * Unsigned tests + INVALID_INPUT tests run on every host.
 *
 * D-PLAN-3-4: breadcrumb null on the bytes form is verified at the wire
 * boundary (Tests 3 + 11) — agent's pure-bytes verify path always returns
 * breadcrumb=null because the engine has no version_id to resolve from.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// ---------------------------------------------------------------
// Constants — bundled c2pa-node certs (Phase 14 pattern)
// ---------------------------------------------------------------

const haveOpenssl = (() => {
  try {
    execFileSync('which', ['openssl'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const BUNDLED_CERT_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pub');
const BUNDLED_KEY_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pem');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// ---------------------------------------------------------------
// Seed harness — pre-populate a SQLite DB + outputs dir, then close
// the DB so the spawned server can re-open it. Mirrors
// c2pa-uat-mcp-tool.test.ts:75-153 verbatim with two variants.
// ---------------------------------------------------------------

async function seedVersionInDb(opts: {
  c2paEnabled: boolean;
}): Promise<{
  dbPath: string;
  versionId: string;
  outputsDir: string;
  cleanup: () => Promise<void>;
}> {
  const tempRoot = await mkdtemp(join(tmpdir(), `vfx-1603-uat-${nanoid(6)}-`));
  const dbPath = join(tempRoot, 'test.db');
  const outputsDir = join(tempRoot, 'outputs');
  await mkdir(outputsDir, { recursive: true });

  const { openDb } = await import('../store/db.js');
  const { db, sqlite } = openDb(dbPath);
  const { HierarchyRepo } = await import('../store/hierarchy-repo.js');
  const { VersionRepo } = await import('../store/version-repo.js');
  const { ProvenanceRepo } = await import('../store/provenance-repo.js');
  const { ProvenanceWriter } = await import('../engine/provenance.js');
  const { Engine } = await import('../engine/pipeline.js');
  const { FakeComfyUIClient } = await import('../test-utils/fake-comfyui-client.js');

  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const fake = new FakeComfyUIClient();

  const engine = new Engine(
    db, hierarchy, versions, provenanceRepo,
    fake as never,
    outputsDir,
    {
      c2paConfig: opts.c2paEnabled
        ? {
            certPemPath: BUNDLED_CERT_PATH,
            privateKeyPemPath: BUNDLED_KEY_PATH,
            // MR-01 fix mirror — bundled signer needs a TSA URL.
            tsaUrl: 'http://timestamp.digicert.com',
          }
        : null,
    },
  );

  const ws = hierarchy.createWorkspace('uat-1603-ws');
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const ver = versions.insertVersion(shot.id);
  provenanceWriter.writeSubmitEvent(ver.id, {});
  provenanceRepo.insertEvent(ver.id, {
    event_type: 'completed',
    prompt_json: '{}', seed: null, models_json: '[]', outputs_json: '[]',
  });

  const filename = 'out.png';
  const signResult = await engine.signOutput(ver.id, filename, { bytes: TINY_PNG });
  const verDir = join(outputsDir, ver.id);
  await mkdir(verDir, { recursive: true });
  if (signResult.signed) {
    await writeFile(join(verDir, filename), signResult.signed);
  } else {
    await writeFile(join(verDir, filename), TINY_PNG);
  }
  versions.markCompleted(ver.id, JSON.stringify([{ filename }]));

  // Close so the spawned server can open it.
  await engine.stop();
  sqlite.close();

  return {
    dbPath, versionId: ver.id, outputsDir,
    cleanup: async (): Promise<void> => {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------
// Stdio client harness (mirror Phase 14 pattern)
// ---------------------------------------------------------------

interface StdioHandle {
  client: Client;
  close: () => Promise<void>;
}

async function connectStdio(opts: {
  dbPath: string; outputsDir: string; c2paEnabled: boolean;
}): Promise<StdioHandle> {
  const env: Record<string, string> = {
    ...process.env,
    NODE_ENV: 'test',
    VELLUM_OUTPUTS_DIR: opts.outputsDir,
    // D-PLAN-5 — accept dev cert codes during tests so signature_status='valid'
    // returns from c2pa-rs against the bundled es256 cert chain.
    VELLUM_C2PA_TRUST_DEV_CERT: '1',
  };
  if (opts.c2paEnabled) {
    env.VELLUM_C2PA_CERT_PEM_PATH = BUNDLED_CERT_PATH;
    env.VELLUM_C2PA_PRIVATE_KEY_PEM_PATH = BUNDLED_KEY_PATH;
  } else {
    delete env.VELLUM_C2PA_CERT_PEM_PATH;
    delete env.VELLUM_C2PA_PRIVATE_KEY_PEM_PATH;
  }
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', resolve('src/server.ts'), '--db', opts.dbPath],
    env, stderr: 'pipe',
  });
  const client = new Client({ name: '1603-uat', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
  return {
    client,
    close: async (): Promise<void> => {
      try { await client.close(); } catch { /* close errors are non-fatal */ }
    },
  };
}

// ---------------------------------------------------------------
// HTTP transport harness — spawn `--http --port` then connect via
// StreamableHTTPClientTransport. Stateless mode (no session id).
// ---------------------------------------------------------------

interface HttpHandle {
  client: Client;
  proc: ReturnType<typeof spawn>;
  close: () => Promise<void>;
}

async function connectHttp(opts: {
  dbPath: string; outputsDir: string; c2paEnabled: boolean; port: number;
}): Promise<HttpHandle> {
  const env: Record<string, string> = {
    ...process.env,
    NODE_ENV: 'test',
    VELLUM_OUTPUTS_DIR: opts.outputsDir,
    VELLUM_C2PA_TRUST_DEV_CERT: '1',
  };
  if (opts.c2paEnabled) {
    env.VELLUM_C2PA_CERT_PEM_PATH = BUNDLED_CERT_PATH;
    env.VELLUM_C2PA_PRIVATE_KEY_PEM_PATH = BUNDLED_KEY_PATH;
  }
  const proc = spawn(
    'npx',
    [
      'tsx', resolve('src/server.ts'),
      '--http', '--port', String(opts.port),
      '--db', opts.dbPath,
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Wait for boot — poll dashboard /api/dashboard/home for up to 10s.
  const deadline = Date.now() + 10_000;
  let booted = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${opts.port}/api/dashboard/home`);
      if (res.ok) { booted = true; break; }
    } catch { /* not yet listening */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!booted) {
    proc.kill('SIGTERM');
    throw new Error(`HTTP server did not boot on port ${opts.port} within 10s`);
  }
  // Now connect a real MCP SDK Client over Streamable HTTP transport.
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${opts.port}/mcp`),
  );
  const client = new Client({ name: '1603-uat-http', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
  return {
    client, proc,
    close: async (): Promise<void> => {
      try { await client.close(); } catch { /* non-fatal */ }
      proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 250));
    },
  };
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

/** Read MCP CallToolResult payload — prefers structuredContent, falls back
 *  to JSON.parse(content[0].text). */
function readPayload(result: unknown): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = result as any;
  return (r?.structuredContent as Record<string, unknown>) ??
    JSON.parse((r?.content?.[0]?.text ?? '{}') as string);
}

/** Pick a random ephemeral port that won't clash. */
function pickPort(): number {
  return 30000 + Math.floor(Math.random() * 30000);
}

// ===============================================================
// Section A — STDIO on SIGNED seed (Tests 1-3 + Tests 6-8)
// ===============================================================

describe.skipIf(!haveOpenssl)('Phase 16 — version.export_manifest + verify_manifest STDIO (signed)', () => {
  let seed: Awaited<ReturnType<typeof seedVersionInDb>>;
  let handle: StdioHandle;

  beforeAll(async () => {
    seed = await seedVersionInDb({ c2paEnabled: true });
    handle = await connectStdio({
      dbPath: seed.dbPath, outputsDir: seed.outputsDir, c2paEnabled: true,
    });
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.close();
    if (seed) await seed.cleanup();
  });

  it('Test 1 — export_manifest returns manifest_status=present + manifest_bytes_base64 non-null', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: seed.versionId },
    });
    const payload = readPayload(result);
    expect(payload.version_id).toBe(seed.versionId);
    expect(payload.manifest_status).toBe('present');
    expect(payload.manifest_bytes_base64).not.toBeNull();
    expect(typeof payload.manifest_bytes_base64).toBe('string');
    // cert_subject is non-null on a successful sign — the engine recorded
    // the cert summary at sign time.
    expect(payload.cert_subject).toBeTypeOf('string');
    expect(payload.breadcrumb).toBeDefined();
    expect(Array.isArray(payload.breadcrumb)).toBe(true);
    expect(payload.breadcrumb_text).toBeTypeOf('string');
  });

  it('Test 2 — verify_manifest by version_id returns valid=true + signature_status=valid', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: { action: 'verify_manifest', version_id: seed.versionId },
    });
    const payload = readPayload(result);
    expect(payload.valid).toBe(true);
    expect(payload.signature_status).toBe('valid');
    expect(Array.isArray(payload.matched_assertions)).toBe(true);
    expect((payload.matched_assertions as unknown[]).length).toBeGreaterThan(0);
    expect(payload.breadcrumb).toBeDefined();
    expect(payload.breadcrumb).not.toBeNull();
  });

  it('Test 3 — verify_manifest by bytes returns valid=true + breadcrumb NULL (D-PLAN-3-4)', async () => {
    // First export to capture the bytes inline.
    const exportRes = await handle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: seed.versionId },
    });
    const exportPayload = readPayload(exportRes);
    expect(exportPayload.manifest_bytes_base64).toBeTypeOf('string');
    // Now feed bytes back to verify_manifest.
    const verifyRes = await handle.client.callTool({
      name: 'version',
      arguments: {
        action: 'verify_manifest',
        manifest_bytes_base64: exportPayload.manifest_bytes_base64,
        format: 'image/png',
      },
    });
    const verifyPayload = readPayload(verifyRes);
    expect(verifyPayload.valid).toBe(true);
    expect(verifyPayload.signature_status).toBe('valid');
    // D-PLAN-3-4: breadcrumb null on bytes form.
    expect(verifyPayload.breadcrumb).toBeNull();
    expect(verifyPayload.breadcrumb_text).toBeNull();
  });

  it('Test 6 — export_manifest VERSION_NOT_FOUND', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: 'ver_does_not_exist' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).isError).toBe(true);
    const payload = readPayload(result);
    expect(payload.code).toBe('VERSION_NOT_FOUND');
  });

  it('Test 7 — export_manifest INVALID_INPUT (empty version_id)', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: '' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).isError).toBe(true);
    const payload = readPayload(result);
    expect(payload.code).toBe('INVALID_INPUT');
  });

  it('Test 8 — verify_manifest INVALID_INPUT (no version_id, no bytes)', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: { action: 'verify_manifest' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).isError).toBe(true);
    const payload = readPayload(result);
    expect(payload.code).toBe('INVALID_INPUT');
  });
});

// ===============================================================
// Section B — STDIO on UNSIGNED seed (Tests 4-5)
// ===============================================================

describe('Phase 16 — version.export_manifest + verify_manifest STDIO (unsigned)', () => {
  let seed: Awaited<ReturnType<typeof seedVersionInDb>>;
  let handle: StdioHandle;

  beforeAll(async () => {
    seed = await seedVersionInDb({ c2paEnabled: false });
    handle = await connectStdio({
      dbPath: seed.dbPath, outputsDir: seed.outputsDir, c2paEnabled: false,
    });
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.close();
    if (seed) await seed.cleanup();
  });

  it('Test 4 — export_manifest returns manifest_status=absent on unsigned version', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: seed.versionId },
    });
    const payload = readPayload(result);
    expect(payload.manifest_status).toBe('absent');
    expect(payload.manifest_bytes_base64).toBeNull();
    expect(payload.breadcrumb).toBeDefined();
  });

  it('Test 5 — verify_manifest returns signature_status=no_manifest on unsigned version', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: { action: 'verify_manifest', version_id: seed.versionId },
    });
    const payload = readPayload(result);
    expect(payload.valid).toBe(false);
    expect(payload.signature_status).toBe('no_manifest');
  });
});

// ===============================================================
// Section C — HTTP-vs-stdio parity on SIGNED seed (Tests 9-13)
// ===============================================================

describe.skipIf(!haveOpenssl)('Phase 16 — version.export_manifest + verify_manifest HTTP parity', () => {
  let seed: Awaited<ReturnType<typeof seedVersionInDb>>;
  let httpHandle: HttpHandle;
  let stdioHandle: StdioHandle;

  beforeAll(async () => {
    seed = await seedVersionInDb({ c2paEnabled: true });
    const port = pickPort();
    httpHandle = await connectHttp({
      dbPath: seed.dbPath, outputsDir: seed.outputsDir, c2paEnabled: true, port,
    });
    stdioHandle = await connectStdio({
      dbPath: seed.dbPath, outputsDir: seed.outputsDir, c2paEnabled: true,
    });
  }, 60_000);

  afterAll(async () => {
    if (httpHandle) await httpHandle.close();
    if (stdioHandle) await stdioHandle.close();
    if (seed) await seed.cleanup();
  });

  it('Test 9 — HTTP export_manifest envelope deepEqual stdio export_manifest envelope', async () => {
    const httpRes = await httpHandle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: seed.versionId },
    });
    const stdioRes = await stdioHandle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: seed.versionId },
    });
    const httpPayload = readPayload(httpRes);
    const stdioPayload = readPayload(stdioRes);
    expect(httpPayload).toEqual(stdioPayload);
    expect(httpPayload.manifest_status).toBe('present');
  });

  it('Test 10 — HTTP verify_manifest by version_id deepEqual stdio', async () => {
    const httpRes = await httpHandle.client.callTool({
      name: 'version',
      arguments: { action: 'verify_manifest', version_id: seed.versionId },
    });
    const stdioRes = await stdioHandle.client.callTool({
      name: 'version',
      arguments: { action: 'verify_manifest', version_id: seed.versionId },
    });
    expect(readPayload(httpRes)).toEqual(readPayload(stdioRes));
  });

  it('Test 11 — HTTP verify_manifest by bytes deepEqual stdio (breadcrumb null)', async () => {
    // Capture bytes via stdio.
    const exportRes = await stdioHandle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: seed.versionId },
    });
    const exportPayload = readPayload(exportRes);
    const args = {
      action: 'verify_manifest' as const,
      manifest_bytes_base64: exportPayload.manifest_bytes_base64 as string,
      format: 'image/png',
    };
    const httpRes = await httpHandle.client.callTool({ name: 'version', arguments: args });
    const stdioRes = await stdioHandle.client.callTool({ name: 'version', arguments: args });
    const httpPayload = readPayload(httpRes);
    const stdioPayload = readPayload(stdioRes);
    expect(httpPayload).toEqual(stdioPayload);
    // D-PLAN-3-4 verified at the wire boundary.
    expect(httpPayload.breadcrumb).toBeNull();
    expect(stdioPayload.breadcrumb).toBeNull();
  });

  it('Test 13 — D-PROV-08 dual-form: JSON.parse(content[0].text) deepEqual structuredContent over HTTP', async () => {
    const result = await httpHandle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: seed.versionId },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any;
    expect(r.structuredContent).toBeDefined();
    expect(r.content?.[0]?.text).toBeTypeOf('string');
    const fromText = JSON.parse(r.content[0].text as string);
    expect(fromText).toEqual(r.structuredContent);
  });

  it('Test 14 (C-07) — INVALID_INPUT envelope deepEqual across HTTP and stdio', async () => {
    const args = { action: 'verify_manifest' };
    const httpRes = await httpHandle.client.callTool({ name: 'version', arguments: args });
    const stdioRes = await stdioHandle.client.callTool({ name: 'version', arguments: args });
    // Both transports must present an isError envelope with identical
    // structuredContent {code, message}.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((httpRes as any).isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((stdioRes as any).isError).toBe(true);
    const httpPayload = readPayload(httpRes);
    const stdioPayload = readPayload(stdioRes);
    expect(httpPayload).toEqual(stdioPayload);
    expect(httpPayload.code).toBe('INVALID_INPUT');
  });
});
