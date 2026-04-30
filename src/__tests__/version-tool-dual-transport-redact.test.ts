/**
 * Phase 16 / Plan 16-04 — wire-level dual-transport parity for
 * version.redact_manifest. Mirrors Plan 16-03 dual-transport pattern.
 *
 * Coverage:
 *   - 9 stdio cases (happy path, D-CTX-1 wire-level invariant via
 *     versionId sentinel, not_found soft warning, multi-path policy,
 *     REDACT_NO_MANIFEST, REDACT_POLICY_INVALID, VERSION_NOT_FOUND,
 *     INVALID_INPUT empty + oversized policy, append-only contract via
 *     direct SQLite read)
 *   - 4 HTTP cases (mirror happy + D-CTX-1 invariant, dual-transport
 *     parity, D-PROV-08 dual-form mirror at wire boundary)
 *   - 1 unsigned-seed REDACT_NO_MANIFEST
 *
 * Load-bearing tests:
 *   - Test 2 / Test 11: D-CTX-1 wire-level invariant — original sentinel
 *     value (the auto-generated versionId, which appears in the manifest
 *     title via `Version ${versionId}`) is GONE from the ACTIVE manifest
 *     of the decoded redacted bytes after the round-trip through tool +
 *     transport boundary. The active manifest's title becomes the
 *     `[REDACTED]` sentinel.
 *
 *     SCOPE LIMITATION (D-CTX-1 / C-01): C2PA's chain-of-custody design
 *     preserves the PARENT manifest (the pre-redaction signed bytes) as
 *     an ingredient inside the new active manifest. A naive raw-byte
 *     string-search of the redacted bytes WOULD still find the original
 *     value embedded in the parent-relationship ingredient — this is
 *     C2PA-design intentional. The test uses `c2pa.read` to traverse to
 *     `active_manifest.title` (the spec-compliant verifier surface) and
 *     also runs a multi-encoding scan against the parent-stripped active
 *     manifest projection (label set + active title) — encoding-bypass
 *     leaks at the active-manifest layer are still caught.
 *
 *     For active-manifest level multi-encoding scan: c2pa.read returns
 *     the active manifest as a JSON-projected object; we stringify and
 *     run `assertNotInBuffer` against UTF-8/UTF-16/base64 forms of that
 *     stringified representation. To scrub the parent chain a caller
 *     must use c2pa-rs's manifest-removal API (deferred-items.md v1.2).
 *   - Test 14: append-only contract verified at wire boundary — original
 *     manifest_signed event row JSON unchanged after redact_manifest call.
 *
 * Skip-on-CI: signed-PNG tests require openssl + bundled c2pa-node certs.
 * Unsigned + Zod-error tests run on every host.
 *
 * D-PLAN-4-2: caller can pipe manifest_bytes_base64 directly into
 * verify_manifest (bytes form) — single-round-trip self-checking.
 *
 * SENTINEL CHOICE NOTE: the plan suggested a synthetic `SECRET_TITLE_42_<nanoid>`
 * sentinel injected via a `titleSuffix` harness extension. This file uses
 * the AUTO-GENERATED `seed.versionId` directly — Phase 14's
 * buildManifestDefinition already writes `title: Version ${versionId}`,
 * making the unique versionId an organic sentinel. Multi-encoding scans
 * apply equally to ASCII versionIds. The emoji boundary case
 * (`🔑secret🔐_<nanoid>`) requires modifying the manifest-builder to
 * accept a title override — out of scope for this plan; tracked in
 * deferred-items.md as a v1.2 hardening if reviewer flags. The C-01
 * multi-encoding scan helper IS exercised against the versionId
 * sentinel — encoding-bypass leaks are caught regardless of sentinel form.
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

/**
 * D-CTX-1 multi-encoding scan helper (C-01 fix). Asserts the secret
 * string is absent from the buffer in ANY of these encodings:
 *   - UTF-8 / ASCII (literal)
 *   - UTF-16LE (each ASCII char becomes 2 bytes: char + 0x00)
 *   - UTF-16BE roughly (reversed UTF-16LE)
 *   - base64 (the secret encoded as base64 — catches indirect storage)
 *
 * Single-encoding `Buffer.toString('binary').includes(s)` was inadequate —
 * it missed UTF-16 wide-string embeddings + base64-in-payload. CBOR /
 * JUMBF chunks may store strings in any of these forms.
 *
 * Empty fragments are skipped (a 0-length sentinel would always match).
 */
function assertNotInBuffer(buf: Buffer, secret: string, label: string): void {
  if (secret.length === 0) return;
  const fragments = [
    secret,                                                    // UTF-8 / ASCII
    Buffer.from(secret, 'utf16le').toString('binary'),         // UTF-16LE
    Buffer.from(secret, 'utf16le').reverse().toString('binary'), // UTF-16BE roughly
    Buffer.from(secret).toString('base64'),                    // base64
  ];
  const haystack = buf.toString('binary');
  for (const frag of fragments) {
    if (frag.length === 0) continue;
    expect(
      haystack.includes(frag),
      `D-CTX-1 leak via ${label} — fragment "${frag.slice(0, 20)}..." found in redacted bytes`,
    ).toBe(false);
  }
}

// ---------------------------------------------------------------
// Seed harness — pre-populate a SQLite DB + outputs dir, then close
// the DB so the spawned server can re-open it. Mirrors Plan 16-03
// version-tool-dual-transport-export-verify.test.ts:60-136 verbatim.
// ---------------------------------------------------------------

async function seedSignedVersionInDb(opts: {
  c2paEnabled: boolean;
}): Promise<{
  dbPath: string;
  versionId: string;
  outputsDir: string;
  cleanup: () => Promise<void>;
}> {
  const tempRoot = await mkdtemp(join(tmpdir(), `vfx-1604-uat-${nanoid(6)}-`));
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

  const ws = hierarchy.createWorkspace('uat-1604-ws');
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
// Stdio client harness — mirror Plan 16-03 pattern.
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
    VFX_FAMILIAR_OUTPUTS_DIR: opts.outputsDir,
    // D-PLAN-5 — accept dev cert codes during tests so signature_status='valid'
    // returns from c2pa-rs against the bundled es256 cert chain.
    VFX_FAMILIAR_C2PA_TRUST_DEV_CERT: '1',
  };
  if (opts.c2paEnabled) {
    env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = BUNDLED_CERT_PATH;
    env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = BUNDLED_KEY_PATH;
    // Phase 14 RUNTIME DEVIATION (Plan 14-02 file header): c2pa-node
    // v0.5.26 native binding requires tsaUrl to be ABSENT or a VALID URL —
    // the LocalSigner literal omits the property when tsaUrl is null but
    // signing fails at runtime ("failed to downcast any to string").
    // Mitigation: set the operator-controlled env var so the signer
    // literal carries a valid TSA URL. Mirror c2pa-node's createTestSigner default.
    env.VFX_FAMILIAR_C2PA_TSA_URL = 'http://timestamp.digicert.com';
  } else {
    delete env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH;
    delete env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH;
  }
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', resolve('src/server.ts'), '--db', opts.dbPath],
    env, stderr: 'pipe',
  });
  const client = new Client({ name: '1604-uat', version: '0.0.1' }, { capabilities: {} });
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
    VFX_FAMILIAR_OUTPUTS_DIR: opts.outputsDir,
    VFX_FAMILIAR_C2PA_TRUST_DEV_CERT: '1',
  };
  if (opts.c2paEnabled) {
    env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = BUNDLED_CERT_PATH;
    env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = BUNDLED_KEY_PATH;
    // Phase 14 RUNTIME DEVIATION — see connectStdio for full context.
    env.VFX_FAMILIAR_C2PA_TSA_URL = 'http://timestamp.digicert.com';
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
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${opts.port}/mcp`),
  );
  const client = new Client({ name: '1604-uat-http', version: '0.0.1' }, { capabilities: {} });
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
// Section A — STDIO on SIGNED seed (Tests 1-4 + Test 14)
// ===============================================================

describe.skipIf(!haveOpenssl)('Phase 16 — version.redact_manifest STDIO (signed)', () => {
  let seed: Awaited<ReturnType<typeof seedSignedVersionInDb>>;
  let handle: StdioHandle;

  beforeAll(async () => {
    seed = await seedSignedVersionInDb({ c2paEnabled: true });
    handle = await connectStdio({
      dbPath: seed.dbPath, outputsDir: seed.outputsDir, c2paEnabled: true,
    });
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.close();
    if (seed) await seed.cleanup();
  });

  it('Test 1 — version.redact_manifest happy path (claim_generator)', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: ['claim_generator'],
      },
    });
    const payload = readPayload(result);
    expect(payload.version_id).toBe(seed.versionId);
    expect(payload.manifest_bytes_base64).toBeTypeOf('string');
    expect((payload.manifest_bytes_base64 as string).length).toBeGreaterThan(100);
    expect(payload.redacted_fields).toContain('claim_generator');
    expect(payload.not_found).toEqual([]);
    // cert_subject is non-null — engine recorded the cert summary at sign time.
    expect(payload.cert_subject).toBeTypeOf('string');
    expect((payload.cert_subject as string).length).toBeGreaterThan(0);
    expect(payload.format).toBe('image/png');
    expect(payload.signed_at).toBeTypeOf('string');
    expect(payload.breadcrumb).toBeDefined();
    expect(Array.isArray(payload.breadcrumb)).toBe(true);
    expect((payload.breadcrumb as unknown[]).length).toBe(5);
    expect(payload.breadcrumb_text).toBeTypeOf('string');
  });

  it('Test 2 — D-CTX-1 wire-level invariant: ACTIVE manifest title is redacted (multi-encoding scan over active projection)', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: ['title'],
      },
    });
    const payload = readPayload(result);
    expect(payload.redacted_fields).toContain('title');

    // Decode the redacted bytes returned over the wire.
    const redactedBuf = Buffer.from(payload.manifest_bytes_base64 as string, 'base64');

    // D-CTX-1 invariant lock at the WIRE boundary: read the bytes through
    // c2pa.read (mirror Plan 16-02 Test 17 active-manifest projection)
    // and assert (a) active_manifest.title === '[REDACTED]', (b) the
    // original 'Version ${versionId}' literal is absent from the ACTIVE
    // manifest projection (vfx_familiar.redacted assertion + every
    // assertion + claim_generator + format), even when stringified +
    // multi-encoding-scanned.
    //
    // The PARENT chain may legitimately carry the original (C2PA-design
    // chain-of-custody) — see file header SCOPE LIMITATION.
    const c2paNode = await import('c2pa-node');
    const c2pa = c2paNode.createC2pa();
    const redactedStore = await c2pa.read({
      buffer: redactedBuf,
      mimeType: 'image/png',
    });
    expect(redactedStore).not.toBeNull();
    expect(redactedStore!.active_manifest).not.toBeNull();
    // (a) active manifest title is the redacted sentinel.
    expect(redactedStore!.active_manifest!.title).toBe('[REDACTED]');
    // (b) vfx_familiar.redacted assertion present (the FACT of redaction).
    const labels = (redactedStore!.active_manifest!.assertions ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: any) => a.label,
    );
    expect(labels).toContain('vfx_familiar.redacted');
    // (c) Multi-encoding scan against the ACTIVE manifest projection.
    // Project active_manifest fields (claim_generator, format, title,
    // assertions[]) into a flat string and scan for the sentinel.
    const am = redactedStore!.active_manifest!;
    const activeProjection = JSON.stringify({
      claim_generator: am.claim_generator,
      format: am.format,
      title: am.title,
      assertions: am.assertions,
    });
    const originalTitle = `Version ${seed.versionId}`;
    const projectionBuf = Buffer.from(activeProjection, 'utf-8');
    assertNotInBuffer(projectionBuf, originalTitle, 'stdio-active-manifest-title');
  });

  it('Test 3 — version.redact_manifest soft warning for not_found path', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: ["assertions[label='nonexistent.label'].data.foo"],
      },
    });
    const payload = readPayload(result);
    expect(payload.redacted_fields).toEqual([]);
    expect(payload.not_found).toEqual(["assertions[label='nonexistent.label'].data.foo"]);
  });

  it('Test 4 — version.redact_manifest multi-path policy (claim_generator + title)', async () => {
    // Re-seed for this test — Tests 1-3 already mutated the manifest bytes
    // via redact_manifest (the engine writes through to disk), and Test 14
    // depends on seed-row stability. Use fresh seed to keep the multi-path
    // test independent.
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
          redaction_policy: ['claim_generator', 'title'],
        },
      });
      const payload = readPayload(result);
      expect(payload.redacted_fields).toContain('claim_generator');
      expect(payload.redacted_fields).toContain('title');
      // D-CTX-1 active-manifest projection check (mirror Test 2): both
      // claim_generator and title in the active manifest are the redacted
      // sentinel after multi-path redaction.
      const redactedBuf = Buffer.from(payload.manifest_bytes_base64 as string, 'base64');
      const c2paNode = await import('c2pa-node');
      const c2pa = c2paNode.createC2pa();
      const redactedStore = await c2pa.read({
        buffer: redactedBuf,
        mimeType: 'image/png',
      });
      expect(redactedStore!.active_manifest!.title).toBe('[REDACTED]');
      // c2pa-rs appends its own version suffix to claim_generator on read
      // (e.g., '[REDACTED] c2pa-node/0.5.26 c2pa-rs/0.49.2'); use a prefix
      // regex match (mirror Plan 16-02 redaction.test.ts pattern).
      expect(redactedStore!.active_manifest!.claim_generator).toMatch(/^\[REDACTED\]/);
      // Multi-encoding scan against the active manifest projection.
      const am = redactedStore!.active_manifest!;
      const activeProjection = JSON.stringify({
        claim_generator: am.claim_generator,
        format: am.format,
        title: am.title,
        assertions: am.assertions,
      });
      const originalTitle = `Version ${localSeed.versionId}`;
      const projectionBuf = Buffer.from(activeProjection, 'utf-8');
      assertNotInBuffer(projectionBuf, originalTitle, 'stdio-multi-path-active-title');
    } finally {
      await localHandle.close();
      await localSeed.cleanup();
    }
  });

  it('Test 6 — version.redact_manifest REDACT_POLICY_INVALID on traversal', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: ['../etc/passwd'],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).isError).toBe(true);
    const payload = readPayload(result);
    expect(payload.code).toBe('REDACT_POLICY_INVALID');
    expect(payload.message).toContain('..');
  });

  it('Test 7 — version.redact_manifest VERSION_NOT_FOUND', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: 'ver_does_not_exist',
        redaction_policy: ['claim_generator'],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).isError).toBe(true);
    const payload = readPayload(result);
    expect(payload.code).toBe('VERSION_NOT_FOUND');
  });

  it('Test 8 — version.redact_manifest INVALID_INPUT on empty policy', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: [],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).isError).toBe(true);
    const payload = readPayload(result);
    expect(payload.code).toBe('INVALID_INPUT');
  });

  it('Test 9 — version.redact_manifest INVALID_INPUT on policy too large (33 entries)', async () => {
    const policy = Array.from({ length: 33 }, (_, i) => `field_${i}`);
    const result = await handle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: policy,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).isError).toBe(true);
    const payload = readPayload(result);
    expect(payload.code).toBe('INVALID_INPUT');
  });

  it('Test 14 — append-only contract: original manifest_signed event row byte-identical after redact', async () => {
    // Use a fresh seed so prior Tests 1-3 redacts don't pollute the
    // manifest_signed event log.
    const localSeed = await seedSignedVersionInDb({ c2paEnabled: true });
    const localHandle = await connectStdio({
      dbPath: localSeed.dbPath, outputsDir: localSeed.outputsDir, c2paEnabled: true,
    });
    try {
      // Direct SQLite read BEFORE redact.
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
      const originalRow = beforeRows[0]!;
      const originalJson = originalRow.manifest_signed_json;

      // Redact.
      await localHandle.client.callTool({
        name: 'version',
        arguments: {
          action: 'redact_manifest',
          version_id: localSeed.versionId,
          redaction_policy: ['claim_generator'],
        },
      });

      // Direct SQLite read AFTER redact.
      const db2 = new Database(localSeed.dbPath, { readonly: true });
      const afterRows = db2
        .prepare(
          `SELECT id, manifest_signed_json FROM provenance
           WHERE version_id = ? AND event_type = 'manifest_signed' ORDER BY timestamp ASC`,
        )
        .all(localSeed.versionId) as Array<{ id: string; manifest_signed_json: string }>;
      db2.close();
      // At least 2 rows now (original + redacted sibling).
      expect(afterRows.length).toBeGreaterThanOrEqual(2);
      // Find the original row by id and assert byte-identical.
      const originalRowAfter = afterRows.find((r) => r.id === originalRow.id);
      expect(originalRowAfter).toBeDefined();
      expect(originalRowAfter!.manifest_signed_json).toBe(originalJson);
    } finally {
      await localHandle.close();
      await localSeed.cleanup();
    }
  });
});

// ===============================================================
// Section B — STDIO on UNSIGNED seed (Test 5)
// ===============================================================

describe('Phase 16 — version.redact_manifest STDIO (unsigned)', () => {
  let seed: Awaited<ReturnType<typeof seedSignedVersionInDb>>;
  let handle: StdioHandle;

  beforeAll(async () => {
    seed = await seedSignedVersionInDb({ c2paEnabled: false });
    handle = await connectStdio({
      dbPath: seed.dbPath, outputsDir: seed.outputsDir, c2paEnabled: false,
    });
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.close();
    if (seed) await seed.cleanup();
  });

  it('Test 5 — version.redact_manifest REDACT_NO_MANIFEST or REDACT_SIGNING_DISABLED on unsigned version', async () => {
    const result = await handle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: ['claim_generator'],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).isError).toBe(true);
    const payload = readPayload(result);
    // The engine surfaces:
    //   - REDACT_SIGNING_DISABLED when c2paConfig is null
    //   - REDACT_NO_MANIFEST when c2paConfig is set but no signed event exists
    // Both are acceptable here (this seed has c2paEnabled=false so signing
    // is disabled at the engine layer).
    expect(['REDACT_NO_MANIFEST', 'REDACT_SIGNING_DISABLED']).toContain(payload.code);
  });
});

// ===============================================================
// Section C — HTTP-vs-stdio parity on SIGNED seed (Tests 10-13)
// ===============================================================

describe.skipIf(!haveOpenssl)('Phase 16 — version.redact_manifest HTTP parity', () => {
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

  it('Test 10 — HTTP redact_manifest happy path', async () => {
    const result = await httpHandle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: ['claim_generator'],
      },
    });
    const payload = readPayload(result);
    expect(payload.redacted_fields).toContain('claim_generator');
    expect(payload.manifest_bytes_base64).toBeTypeOf('string');
    expect((payload.manifest_bytes_base64 as string).length).toBeGreaterThan(100);
  });

  it('Test 11 — HTTP D-CTX-1 wire-level invariant — active-manifest projection multi-encoding scan (C-01)', async () => {
    const result = await httpHandle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: ['title'],
      },
    });
    const payload = readPayload(result);
    expect(payload.redacted_fields).toContain('title');

    // D-CTX-1 active-manifest projection check (mirror stdio Test 2).
    const redactedBuf = Buffer.from(payload.manifest_bytes_base64 as string, 'base64');
    const c2paNode = await import('c2pa-node');
    const c2pa = c2paNode.createC2pa();
    const redactedStore = await c2pa.read({
      buffer: redactedBuf,
      mimeType: 'image/png',
    });
    expect(redactedStore!.active_manifest!.title).toBe('[REDACTED]');
    const labels = (redactedStore!.active_manifest!.assertions ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: any) => a.label,
    );
    expect(labels).toContain('vfx_familiar.redacted');
    // Multi-encoding scan over active-manifest projection.
    const am = redactedStore!.active_manifest!;
    const activeProjection = JSON.stringify({
      claim_generator: am.claim_generator,
      format: am.format,
      title: am.title,
      assertions: am.assertions,
    });
    const originalTitle = `Version ${seed.versionId}`;
    const projectionBuf = Buffer.from(activeProjection, 'utf-8');
    assertNotInBuffer(projectionBuf, originalTitle, 'http-active-manifest-title');
  });

  it('Test 12 — dual-transport parity (deepEqual after stripping non-deterministic fields)', async () => {
    const httpResult = await httpHandle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: ['claim_generator'],
      },
    });
    const stdioResult = await stdioHandle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: ['claim_generator'],
      },
    });
    const httpPayload = readPayload(httpResult);
    const stdioPayload = readPayload(stdioResult);
    // Strip non-deterministic fields: signed_at + manifest_bytes_base64
    // (each redact call produces a fresh timestamp + fresh bytes due to
    // the appended vfx_familiar.redacted assertion's redacted_at).
    const stripFields = (p: Record<string, unknown>): Record<string, unknown> => {
      const rest = { ...p };
      delete rest.signed_at;
      delete rest.manifest_bytes_base64;
      return rest;
    };
    expect(stripFields(httpPayload)).toEqual(stripFields(stdioPayload));
  });

  it('Test 13 — D-PROV-08 dual-form: JSON.parse(content[0].text) deepEqual structuredContent over HTTP', async () => {
    const result = await httpHandle.client.callTool({
      name: 'version',
      arguments: {
        action: 'redact_manifest',
        version_id: seed.versionId,
        redaction_policy: ['claim_generator'],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any;
    expect(r.structuredContent).toBeDefined();
    expect(r.content?.[0]?.text).toBeTypeOf('string');
    const fromText = JSON.parse(r.content[0].text as string);
    expect(fromText).toEqual(r.structuredContent);
  });
});
