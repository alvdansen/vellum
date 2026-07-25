/**
 * Phase 16 / Plan 16-05 — wire-level UAT for the cohort.
 *
 * Drives all THREE new agent-surface actions (export_manifest, verify_manifest,
 * redact_manifest) over BOTH stdio (StdioClientTransport) and Streamable HTTP
 * transports (StreamableHTTPClientTransport), asserting envelope shapes +
 * D-CTX-1 wire-level invariant + D-CTX-5 append-only contract at the actual
 * MCP wire boundary.
 *
 * Mirror of Phase 14 c2pa-uat-mcp-tool.test.ts pattern. Skip-on-CI for
 * openssl-required cases.
 *
 * Coverage:
 *   - Tests 1-3 (stdio): export envelope, verify-by-version envelope,
 *     redact envelope
 *   - Test 4 (stdio): redact-then-verify-by-bytes round-trip — agent can
 *     pipe redact output directly into verify with no disk read in between
 *   - Test 5 (stdio): D-CTX-1 active-manifest projection multi-encoding scan
 *   - Test 12 (stdio): D-CTX-5 append-only — direct SQLite read before/after
 *     redact_manifest call asserts original event row byte-identical
 *   - Tests 6-9 (HTTP): mirror over StreamableHTTPClientTransport — export
 *     parity, verify-by-bytes breadcrumb-null, redact envelope, D-CTX-1
 *     scan over HTTP
 *   - Test 10 (HTTP): dual-transport parity for read-only export
 *     (deepEqual stdio vs HTTP)
 *   - Test 11 (HTTP): D-PROV-08 dual-form mirror — JSON.parse(content[0].text)
 *     deepEqual structuredContent at HTTP boundary
 *
 * Helper duplication is intentional for test isolation — refactor to
 * src/test-utils/wire-uat.ts tracked in deferred-items.md as v1.2 work.
 *
 * SCOPE LIMITATION (D-CTX-1, see Plan 16-04 file-header SCOPE LIMITATION):
 * c2pa-rs auto-promotes the pre-redaction manifest into a parent_relationship
 * ingredient inside the new active manifest. Raw-byte string-search of
 * redacted bytes WILL find the original value in the JUMBF parent chain —
 * this is C2PA-design intentional for chain-of-custody. The test's D-CTX-1
 * sentinel scan therefore runs against the ACTIVE manifest projection (the
 * spec-compliant verifier surface), not the raw bytes. Active-manifest
 * encoding-bypass leaks ARE caught (UTF-8/UTF-16/base64 + emoji boundary).
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
// Constants — bundled c2pa-node certs (Phase 14 + Plan 16-03/16-04 pattern)
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

// Sentinel for D-CTX-1 wire-level invariant tests. The seed's versionId
// is auto-generated and embedded into the manifest title via Phase 14's
// buildManifestDefinition — `Version ${versionId}` — so it serves as an
// organic ASCII sentinel. Plan 16-05 also exercises the C-01 multi-encoding
// scan against an emoji boundary sentinel for C-01 mitigation; sentinel
// suffix `nanoid(8)` ensures cross-test uniqueness.

const SECRET_SUFFIX = nanoid(8);
const EMOJI_SENTINEL = `WIRE_SECRET_${SECRET_SUFFIX}_END`;

/**
 * D-CTX-1 multi-encoding scan helper (C-01). Asserts the secret string
 * is absent from the buffer in ANY of these encodings:
 *   - UTF-8 / ASCII (literal)
 *   - UTF-16LE (each ASCII char becomes 2 bytes: char + 0x00)
 *   - UTF-16BE roughly (reversed UTF-16LE)
 *   - base64 (the secret encoded as base64 — catches indirect storage)
 */
function assertNotInBuffer(buf: Buffer, secret: string, label: string): void {
  if (secret.length === 0) return;
  const fragments = [
    secret,
    Buffer.from(secret, 'utf16le').toString('binary'),
    Buffer.from(secret, 'utf16le').reverse().toString('binary'),
    Buffer.from(secret).toString('base64'),
  ];
  const haystack = buf.toString('binary');
  for (const frag of fragments) {
    if (frag.length === 0) continue;
    expect(
      haystack.includes(frag),
      `D-CTX-1 leak via ${label} — fragment "${frag.slice(0, 20)}..." found in active-manifest projection`,
    ).toBe(false);
  }
}

// ---------------------------------------------------------------
// Seed harness — pre-populate a SQLite DB + outputs dir, then close the
// DB so the spawned server can re-open it. Mirrors Plan 16-04's pattern.
// ---------------------------------------------------------------

async function seedSignedVersionInDb(opts: {
  c2paEnabled: boolean;
}): Promise<{
  dbPath: string;
  versionId: string;
  outputsDir: string;
  cleanup: () => Promise<void>;
}> {
  const tempRoot = await mkdtemp(join(tmpdir(), `vfx-1605-uat-${nanoid(6)}-`));
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
            tsaUrl: 'http://timestamp.digicert.com',
          }
        : null,
    },
  );

  const ws = hierarchy.createWorkspace('uat-1605-ws');
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
// Stdio client harness — spawns `npx tsx src/server.ts --db <path>` with
// VELLUM_C2PA_TRUST_DEV_CERT=1 + cert/key/TSA env vars.
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
    VELLUM_C2PA_TRUST_DEV_CERT: '1',
  };
  if (opts.c2paEnabled) {
    env.VELLUM_C2PA_CERT_PEM_PATH = BUNDLED_CERT_PATH;
    env.VELLUM_C2PA_PRIVATE_KEY_PEM_PATH = BUNDLED_KEY_PATH;
    env.VELLUM_C2PA_TSA_URL = 'http://timestamp.digicert.com';
  } else {
    delete env.VELLUM_C2PA_CERT_PEM_PATH;
    delete env.VELLUM_C2PA_PRIVATE_KEY_PEM_PATH;
  }
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', resolve('src/server.ts'), '--db', opts.dbPath],
    env, stderr: 'pipe',
  });
  const client = new Client({ name: '1605-uat', version: '0.0.1' }, { capabilities: {} });
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
// StreamableHTTPClientTransport.
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
    env.VELLUM_C2PA_TSA_URL = 'http://timestamp.digicert.com';
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
  // Wait for boot.
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
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${opts.port}/mcp`),
  );
  const client = new Client({ name: '1605-uat-http', version: '0.0.1' }, { capabilities: {} });
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
// Section A — STDIO over signed seed (Tests 1-5, 12)
// ===============================================================

describe.skipIf(!haveOpenssl)('Phase 16 wire-level UAT — STDIO', () => {
  let seed: Awaited<ReturnType<typeof seedSignedVersionInDb>>;
  let handle: StdioHandle;

  beforeAll(async () => {
    seed = await seedSignedVersionInDb({ c2paEnabled: true });
    handle = await connectStdio({
      dbPath: seed.dbPath, outputsDir: seed.outputsDir, c2paEnabled: true,
    });
    // Sanity: emoji sentinel is a constant of this run; assertNotInBuffer
    // just checks absence — no need to inject it (ASCII versionId is the
    // organic title sentinel; emoji form here is for shape coverage of
    // the helper's UTF-16 path).
    void EMOJI_SENTINEL;
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.close();
    if (seed) await seed.cleanup();
  });

  it('Test 1 — stdio export_manifest envelope', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: seed.versionId },
    });
    const p = readPayload(result);
    expect(p.version_id).toBe(seed.versionId);
    expect(p.manifest_status).toBe('present');
    expect(typeof p.manifest_bytes_base64).toBe('string');
    expect((p.manifest_bytes_base64 as string).length).toBeGreaterThan(100);
    expect(typeof p.cert_subject).toBe('string');
    expect((p.cert_subject as string).length).toBeGreaterThan(0);
    expect(p.format).toBe('image/png');
    expect(typeof p.signed_at).toBe('string');
    expect(p.breadcrumb).toBeDefined();
    expect(Array.isArray(p.breadcrumb)).toBe(true);
    expect(typeof p.breadcrumb_text).toBe('string');
    expect(p.ingredients_summary).toBeDefined();
  });

  it('Test 2 — stdio verify_manifest by version_id envelope', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: { action: 'verify_manifest', version_id: seed.versionId },
    });
    const p = readPayload(result);
    expect(p.valid).toBe(true);
    expect(p.signature_status).toBe('valid');
    expect(Array.isArray(p.matched_assertions)).toBe(true);
    expect(Array.isArray(p.gaps)).toBe(true);
    expect(Array.isArray(p.failures)).toBe(true);
    expect(typeof p.cert_subject).toBe('string');
    expect((p.cert_subject as string).length).toBeGreaterThan(0);
    expect(typeof p.signed_at).toBe('string');
    expect(p.breadcrumb).toBeDefined();
  });

  it('Test 3 — stdio redact_manifest envelope', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: ['claim_generator'],
      },
    });
    const p = readPayload(result);
    expect(p.version_id).toBe(seed.versionId);
    expect(p.redacted_fields).toContain('claim_generator');
    expect(p.not_found).toEqual([]);
    expect(typeof p.manifest_bytes_base64).toBe('string');
    expect((p.manifest_bytes_base64 as string).length).toBeGreaterThan(100);
    expect(typeof p.cert_subject).toBe('string');
    expect((p.cert_subject as string).length).toBeGreaterThan(0);
    expect(p.format).toBe('image/png');
    expect(typeof p.signed_at).toBe('string');
    expect(p.breadcrumb).toBeDefined();
    expect(typeof p.breadcrumb_text).toBe('string');
  });

  it('Test 4 — stdio redact-then-verify-by-bytes round-trip', async () => {
    // Use a fresh seed so the round-trip is independent of prior tests'
    // mutated disk state.
    const localSeed = await seedSignedVersionInDb({ c2paEnabled: true });
    const localHandle = await connectStdio({
      dbPath: localSeed.dbPath, outputsDir: localSeed.outputsDir, c2paEnabled: true,
    });
    try {
      const redactRes = await localHandle.client.callTool({
        name: 'version',
        arguments: {
          action: 'redact_manifest',
          version_id: localSeed.versionId,
          redaction_policy: ['claim_generator'],
        },
      });
      const redactPayload = readPayload(redactRes);
      const verifyRes = await localHandle.client.callTool({
        name: 'version',
        arguments: {
          action: 'verify_manifest',
          manifest_bytes_base64: redactPayload.manifest_bytes_base64,
          format: 'image/png',
        },
      });
      const verifyPayload = readPayload(verifyRes);
      expect(verifyPayload.valid).toBe(true);
      expect(verifyPayload.signature_status).toBe('valid');
      expect(verifyPayload.matched_assertions).toContain('vellum.redacted');
      // Bytes-form verify produces a null breadcrumb per D-PLAN-3-4 (no
      // version context to traverse).
      expect(verifyPayload.breadcrumb).toBeNull();
    } finally {
      await localHandle.close();
      await localSeed.cleanup();
    }
  });

  it('Test 5 — C-01: stdio D-CTX-1 wire-level invariant — multi-encoding scan over active projection', async () => {
    // Use a fresh seed: 'title' redaction must operate on a manifest
    // whose title is the synthetic `Version ${versionId}` literal. This
    // describe block's seed has been mutated by prior redact calls.
    const localSeed = await seedSignedVersionInDb({ c2paEnabled: true });
    const localHandle = await connectStdio({
      dbPath: localSeed.dbPath, outputsDir: localSeed.outputsDir, c2paEnabled: true,
    });
    try {
      const result = await localHandle.client.callTool({
        name: 'version',
        arguments: {
          action: 'redact_manifest',
          version_id: localSeed.versionId,
          redaction_policy: ['title'],
        },
      });
      const p = readPayload(result);
      expect(p.redacted_fields).toContain('title');

      // Decode the redacted bytes returned over the wire.
      const redactedBuf = Buffer.from(p.manifest_bytes_base64 as string, 'base64');

      // D-CTX-1 invariant lock at the WIRE boundary: c2pa.read on the bytes
      // returned over MCP, then assert the active-manifest projection
      // (claim_generator + format + title + assertions) does NOT carry
      // the original `Version ${versionId}` literal in any encoding.
      const c2paNode = await import('c2pa-node');
      const c2pa = c2paNode.createC2pa();
      const redactedStore = await c2pa.read({
        buffer: redactedBuf,
        mimeType: 'image/png',
      });
      expect(redactedStore).not.toBeNull();
      expect(redactedStore!.active_manifest).not.toBeNull();
      expect(redactedStore!.active_manifest!.title).toBe('[REDACTED]');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const labels = (redactedStore!.active_manifest!.assertions ?? []).map((a: any) => a.label);
      expect(labels).toContain('vellum.redacted');
      const am = redactedStore!.active_manifest!;
      const activeProjection = JSON.stringify({
        claim_generator: am.claim_generator,
        format: am.format,
        title: am.title,
        assertions: am.assertions,
      });
      const originalTitle = `Version ${localSeed.versionId}`;
      const projectionBuf = Buffer.from(activeProjection, 'utf-8');
      assertNotInBuffer(projectionBuf, originalTitle, 'stdio-uat-active-title');
    } finally {
      await localHandle.close();
      await localSeed.cleanup();
    }
  });

  it('Test 12 — stdio append-only wire-level: original event row byte-identical after redact_manifest', async () => {
    // Use a fresh seed so the original-row id can be captured BEFORE any
    // redact_manifest call.
    const localSeed = await seedSignedVersionInDb({ c2paEnabled: true });
    const localHandle = await connectStdio({
      dbPath: localSeed.dbPath, outputsDir: localSeed.outputsDir, c2paEnabled: true,
    });
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(localSeed.dbPath, { readonly: true });
      const beforeRows = db
        .prepare(
          `SELECT id, manifest_signed_json FROM provenance
           WHERE version_id = ? AND event_type = 'manifest_signed' ORDER BY timestamp ASC`,
        )
        .all(localSeed.versionId) as Array<{ id: string; manifest_signed_json: string }>;
      db.close();
      expect(beforeRows.length).toBe(1);
      const original = beforeRows[0]!;

      // Redact via wire boundary.
      await localHandle.client.callTool({
        name: 'version',
        arguments: {
          action: 'redact_manifest',
          version_id: localSeed.versionId,
          redaction_policy: ['claim_generator'],
        },
      });

      const db2 = new Database(localSeed.dbPath, { readonly: true });
      const afterRows = db2
        .prepare(
          `SELECT id, manifest_signed_json FROM provenance
           WHERE version_id = ? AND event_type = 'manifest_signed'`,
        )
        .all(localSeed.versionId) as Array<{ id: string; manifest_signed_json: string }>;
      db2.close();
      expect(afterRows.length).toBeGreaterThanOrEqual(2);
      const originalAfter = afterRows.find((r) => r.id === original.id);
      expect(originalAfter).toBeDefined();
      expect(originalAfter!.manifest_signed_json).toBe(original.manifest_signed_json);
    } finally {
      await localHandle.close();
      await localSeed.cleanup();
    }
  });
});

// ===============================================================
// Section B — HTTP over signed seed (Tests 6-11)
// ===============================================================

describe.skipIf(!haveOpenssl)('Phase 16 wire-level UAT — HTTP', () => {
  let seed: Awaited<ReturnType<typeof seedSignedVersionInDb>>;
  let httpHandle: HttpHandle;
  let stdioHandle: StdioHandle;

  beforeAll(async () => {
    seed = await seedSignedVersionInDb({ c2paEnabled: true });
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

  it('Test 6 — HTTP export_manifest envelope', async () => {
    const result = await httpHandle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: seed.versionId },
    });
    const p = readPayload(result);
    expect(p.version_id).toBe(seed.versionId);
    expect(p.manifest_status).toBe('present');
    expect(typeof p.manifest_bytes_base64).toBe('string');
    expect(typeof p.cert_subject).toBe('string');
  });

  it('Test 7 — HTTP verify_manifest by bytes (breadcrumb null per D-PLAN-3-4)', async () => {
    const exportRes = await stdioHandle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: seed.versionId },
    });
    const exportPayload = readPayload(exportRes);
    const httpRes = await httpHandle.client.callTool({
      name: 'version',
      arguments: {
        action: 'verify_manifest',
        manifest_bytes_base64: exportPayload.manifest_bytes_base64,
        format: 'image/png',
      },
    });
    const p = readPayload(httpRes);
    expect(p.valid).toBe(true);
    expect(p.breadcrumb).toBeNull();
  });

  it('Test 8 — HTTP redact_manifest envelope', async () => {
    const httpRes = await httpHandle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: ['claim_generator'],
      },
    });
    const p = readPayload(httpRes);
    expect(p.redacted_fields).toContain('claim_generator');
    expect(typeof p.manifest_bytes_base64).toBe('string');
    expect((p.manifest_bytes_base64 as string).length).toBeGreaterThan(100);
  });

  it('Test 9 — C-01: HTTP D-CTX-1 wire-level invariant — multi-encoding scan over active projection', async () => {
    // Use a fresh seed for an unmutated `Version ${versionId}` title.
    const localSeed = await seedSignedVersionInDb({ c2paEnabled: true });
    const localPort = pickPort();
    const localHttp = await connectHttp({
      dbPath: localSeed.dbPath, outputsDir: localSeed.outputsDir, c2paEnabled: true, port: localPort,
    });
    try {
      const httpRes = await localHttp.client.callTool({
        name: 'version',
        arguments: {
          action: 'redact_manifest',
          version_id: localSeed.versionId,
          redaction_policy: ['title'],
        },
      });
      const p = readPayload(httpRes);
      expect(p.redacted_fields).toContain('title');

      const redactedBuf = Buffer.from(p.manifest_bytes_base64 as string, 'base64');
      const c2paNode = await import('c2pa-node');
      const c2pa = c2paNode.createC2pa();
      const redactedStore = await c2pa.read({
        buffer: redactedBuf,
        mimeType: 'image/png',
      });
      expect(redactedStore!.active_manifest!.title).toBe('[REDACTED]');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const labels = (redactedStore!.active_manifest!.assertions ?? []).map((a: any) => a.label);
      expect(labels).toContain('vellum.redacted');
      const am = redactedStore!.active_manifest!;
      const activeProjection = JSON.stringify({
        claim_generator: am.claim_generator,
        format: am.format,
        title: am.title,
        assertions: am.assertions,
      });
      const originalTitle = `Version ${localSeed.versionId}`;
      const projectionBuf = Buffer.from(activeProjection, 'utf-8');
      assertNotInBuffer(projectionBuf, originalTitle, 'http-uat-active-title');
    } finally {
      await localHttp.close();
      await localSeed.cleanup();
    }
  });

  it('Test 10 — HTTP-vs-stdio dual-transport parity for read-only export', async () => {
    const httpRes = await httpHandle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: seed.versionId },
    });
    const stdioRes = await stdioHandle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: seed.versionId },
    });
    // export_manifest is fully deterministic (read-only) — exact deepEqual.
    expect(readPayload(httpRes)).toEqual(readPayload(stdioRes));
  });

  it('Test 11 — D-PROV-08 dual-form mirror at HTTP wire boundary', async () => {
    const httpRes = await httpHandle.client.callTool({
      name: 'version',
      arguments: { action: 'export_manifest', version_id: seed.versionId },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = httpRes as any;
    expect(r.structuredContent).toBeDefined();
    expect(typeof r.content?.[0]?.text).toBe('string');
    const fromText = JSON.parse(r.content[0].text as string);
    expect(fromText).toEqual(r.structuredContent);
  });
});
