// Phase 16 / Plan 16-03 — co-located unit tests for the two new
// `version` tool actions: `export_manifest` + `verify_manifest`.
//
// Coverage matrix:
//   - 11 Zod validation cases (each rejection surface for both new arms)
//   - 9 dispatch / envelope-shape cases (export + verify by-version + by-bytes)
//   - 4 error-mapping cases (TypedError → toolError preserved verbatim)
//   - 1 envelope dual-form mirror invariant (D-PROV-08)
//   - 1 architecture-purity self-check (zero c2pa-node imports in tool layer)
//
// These tests intentionally bypass the McpServer.registerTool indirection by
// invoking `registerVersion(server, engine)` against a recording mock and
// capturing the registered handler closure — same pattern the dual-transport
// test file uses, just with mocked engine facade methods instead of a real
// spawned process.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { ProvenanceWriter } from '../../engine/provenance.js';
import { Engine } from '../../engine/pipeline.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import type { ComfyUIClient } from '../../comfyui/client.js';
import { registerVersion } from '../version-tool.js';
import { TypedError } from '../../engine/errors.js';
import type { ExporterResult } from '../../engine/c2pa/exporter.js';
import type { VerificationReport } from '../../engine/c2pa/verifier.js';

type CapturedHandler = (
  rawInput: Record<string, unknown>,
) => Promise<{
  isError?: boolean;
  structuredContent: Record<string, unknown>;
  content: Array<{ type: 'text'; text: string }>;
}>;

interface MockMcpServer {
  registerTool: (
    name: string,
    config: { inputSchema: Record<string, unknown> },
    handler: CapturedHandler,
  ) => void;
  registeredHandler: CapturedHandler | null;
  registeredInputSchema: Record<string, unknown> | null;
}

function createMockServer(): MockMcpServer {
  const mock: MockMcpServer = {
    registeredHandler: null,
    registeredInputSchema: null,
    registerTool: (_name, config, handler) => {
      mock.registeredHandler = handler;
      mock.registeredInputSchema = config.inputSchema;
    },
  };
  return mock;
}

async function buildStack() {
  const testDb = makeInMemoryDb();
  const { db } = testDb;
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const fake = new FakeComfyUIClient();
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-ver-tool-ev-${nanoid(6)}-`));
  const engine = new Engine(
    db,
    hierarchy,
    versions,
    provenanceRepo,
    fake as unknown as ComfyUIClient,
    tempRoot,
  );
  const ws = hierarchy.createWorkspace('ws1');
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  return {
    engine, hierarchy, versions, provenanceRepo, provenanceWriter,
    shotId: shot.id, tempRoot, testDb,
  };
}

function seedCompleted(
  stack: Awaited<ReturnType<typeof buildStack>>,
  shotId: string,
): string {
  const row = stack.versions.insertVersion(shotId);
  stack.provenanceWriter.writeSubmitEvent(row.id, {});
  stack.provenanceWriter.writeCompletedEvent(row.id, {}, '[]');
  stack.versions.markCompleted(row.id, '[]');
  return row.id;
}

let stack: Awaited<ReturnType<typeof buildStack>>;
let server: MockMcpServer;

beforeEach(async () => {
  stack = await buildStack();
  server = createMockServer();
});

afterEach(async () => {
  await stack.engine.stop();
  await fsp.rm(stack.tempRoot, { recursive: true, force: true });
});

// =====================================================================
// Section A — Zod validation (11 cases). No engine wiring required —
// these just call the registered handler and catch the structured INVALID_INPUT
// surface. We register against the real engine then exercise the Zod path.
// =====================================================================

describe('version export_manifest — Zod validation', () => {
  it('Test 1 — happy: {action: export_manifest, version_id} parses', async () => {
    registerVersion(server as never, stack.engine);
    expect(server.registeredHandler).not.toBeNull();
    // version_id is unknown — engine returns VERSION_NOT_FOUND, not INVALID_INPUT.
    const res = await server.registeredHandler!({
      action: 'export_manifest',
      version_id: 'ver_doesnt_exist',
    });
    // Zod parse SUCCEEDED — engine layer returns VERSION_NOT_FOUND.
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('VERSION_NOT_FOUND');
  });

  it('Test 2 — missing version_id rejects with INVALID_INPUT', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({ action: 'export_manifest' });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { code: string; message: string };
    expect(sc.code).toBe('INVALID_INPUT');
    // With z.union (no discriminator), the first ZodError issue surfaces at
    // the union level (path: []); the wrapped message format is
    // `Invalid input at 'input.'`. The CODE is what callers depend on; the
    // message is best-effort. v1.2 tracked in deferred-items.md to switch to
    // hand-written inputSchema for nicer ZodError paths.
    expect(sc.message).toMatch(/Invalid input/);
  });

  it('Test 3 — empty version_id rejects with INVALID_INPUT (min(1))', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'export_manifest',
      version_id: '',
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('Test 4 — version_id too long rejects with INVALID_INPUT (max(MAX_ID_LENGTH))', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'export_manifest',
      version_id: 'a'.repeat(200),
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });
});

describe('version verify_manifest — Zod validation', () => {
  it('Test 5 — happy by-version_id: {action: verify_manifest, version_id} parses', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'verify_manifest',
      version_id: 'ver_doesnt_exist',
    });
    // Zod SUCCEEDED — engine returns VERSION_NOT_FOUND on the version-id branch.
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('VERSION_NOT_FOUND');
  });

  it('Test 6 — happy by-bytes: {action: verify_manifest, manifest_bytes_base64, format} parses', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'verify_manifest',
      manifest_bytes_base64: 'AAAA', // 3 zero bytes — not a valid JUMBF, engine returns no_manifest
      format: 'image/png',
    });
    // Zod parse SUCCEEDED — engine surfaces signature_status='no_manifest'.
    // The engine never throws on c2pa-rs failures, so isError is undefined / false.
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { signature_status: string };
    expect(sc.signature_status).toBe('no_manifest');
  });

  it('Test 7 — missing both rejects with INVALID_INPUT', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({ action: 'verify_manifest' });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('Test 8 — both version_id AND bytes: union resolves first matching arm (version_id wins)', async () => {
    registerVersion(server as never, stack.engine);
    // version_id arm appears first in the union → matches first; bytes form is ignored.
    const res = await server.registeredHandler!({
      action: 'verify_manifest',
      version_id: 'ver_doesnt_exist',
      manifest_bytes_base64: 'AAAA',
      format: 'image/png',
    });
    // version-id arm took: VERSION_NOT_FOUND.
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('VERSION_NOT_FOUND');
  });

  it('Test 9 — base64 too large rejects with INVALID_INPUT (max(MAX_VERIFY_BYTES_BASE64))', async () => {
    registerVersion(server as never, stack.engine);
    // 100MB cap + 1 — 'A' * (100*1024*1024 + 1).
    // Allocating a 100MB+ string uses real memory; we just exceed the cap.
    const oversize = 'A'.repeat(100 * 1024 * 1024 + 1);
    const res = await server.registeredHandler!({
      action: 'verify_manifest',
      manifest_bytes_base64: oversize,
      format: 'image/png',
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('Test 10 — empty format rejects with INVALID_INPUT (min(1))', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'verify_manifest',
      manifest_bytes_base64: 'AAAA',
      format: '',
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('Test 11 — empty manifest_bytes_base64 rejects with INVALID_INPUT (min(1))', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'verify_manifest',
      manifest_bytes_base64: '',
      format: 'image/png',
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });
});

// =====================================================================
// Section B — Dispatch + envelope shape (Tests 12-22). Mocks Engine
// facade methods to assert the tool layer wires the call + reshapes
// the response correctly.
// =====================================================================

describe('version export_manifest — dispatch + envelope', () => {
  it('Test 12 — happy dispatch: engine.exportManifestForVersion called + envelope shaped', async () => {
    const versionId = seedCompleted(stack, stack.shotId);
    const fixedResult: ExporterResult = {
      format: 'image/png',
      signed_at: '2026-04-30T12:00:00Z',
      manifest_bytes_base64: 'BASE64DATAGOESHERE',
      manifest_status: 'present',
      cert_subject: 'CN=Dev Cert',
      ingredients_summary: {
        parent_count: 1,
        component_count: 2,
        input_assertion: true,
        unavailable_count: 0,
      },
    };
    const exportSpy = vi
      .spyOn(stack.engine, 'exportManifestForVersion')
      .mockResolvedValue(fixedResult);
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'export_manifest',
      version_id: versionId,
    });
    expect(res.isError).toBeFalsy();
    expect(exportSpy).toHaveBeenCalledWith(versionId);
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.version_id).toBe(versionId);
    expect(sc.format).toBe('image/png');
    expect(sc.signed_at).toBe('2026-04-30T12:00:00Z');
    expect(sc.manifest_bytes_base64).toBe('BASE64DATAGOESHERE');
    expect(sc.manifest_status).toBe('present');
    expect(sc.cert_subject).toBe('CN=Dev Cert');
    expect(sc.ingredients_summary).toEqual({
      parent_count: 1, component_count: 2, input_assertion: true, unavailable_count: 0,
    });
    // Breadcrumb: 5 entries (workspace, project, sequence, shot, version) + text.
    expect(Array.isArray(sc.breadcrumb)).toBe(true);
    expect((sc.breadcrumb as unknown[]).length).toBe(5);
    expect(typeof sc.breadcrumb_text).toBe('string');
  });

  it('Test 13 — VERSION_NOT_FOUND from engine surfaces verbatim', async () => {
    vi.spyOn(stack.engine, 'exportManifestForVersion').mockRejectedValue(
      new TypedError('VERSION_NOT_FOUND', "Version 'ver_xyz' not found"),
    );
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'export_manifest',
      version_id: 'ver_xyz_pretendexists', // valid Zod, but engine throws
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { code: string; message: string };
    expect(sc.code).toBe('VERSION_NOT_FOUND');
    expect(sc.message).toContain("ver_xyz");
  });

  it('Test 14 — EXPORT_PATH_TRAVERSAL_REJECTED preserved with hint', async () => {
    vi.spyOn(stack.engine, 'exportManifestForVersion').mockRejectedValue(
      new TypedError(
        'EXPORT_PATH_TRAVERSAL_REJECTED',
        'Filename contains path-traversal characters: ../etc/passwd',
        'Filenames must be basenames (no /, \\, or .. components).',
      ),
    );
    const versionId = seedCompleted(stack, stack.shotId);
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'export_manifest',
      version_id: versionId,
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { code: string; hint?: string };
    expect(sc.code).toBe('EXPORT_PATH_TRAVERSAL_REJECTED');
    expect(sc.hint).toMatch(/basenames/);
  });

  it('Test 15 — manifest_status=absent: bytes null, status carries through', async () => {
    const versionId = seedCompleted(stack, stack.shotId);
    vi.spyOn(stack.engine, 'exportManifestForVersion').mockResolvedValue({
      format: '',
      signed_at: null,
      manifest_bytes_base64: null,
      manifest_status: 'absent',
      cert_subject: null,
      ingredients_summary: null,
    });
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'export_manifest',
      version_id: versionId,
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.manifest_status).toBe('absent');
    expect(sc.manifest_bytes_base64).toBeNull();
    expect(sc.cert_subject).toBeNull();
    expect(sc.ingredients_summary).toBeNull();
    // Breadcrumb still resolved — version exists.
    expect(Array.isArray(sc.breadcrumb)).toBe(true);
  });

  it('Test 16 — manifest_status=unsupported_format: format + signed_at retained', async () => {
    const versionId = seedCompleted(stack, stack.shotId);
    vi.spyOn(stack.engine, 'exportManifestForVersion').mockResolvedValue({
      format: 'image/exr',
      signed_at: '2026-04-30T12:00:00Z',
      manifest_bytes_base64: null,
      manifest_status: 'unsupported_format',
      cert_subject: null,
      ingredients_summary: null,
    });
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'export_manifest',
      version_id: versionId,
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.manifest_status).toBe('unsupported_format');
    expect(sc.format).toBe('image/exr');
    expect(sc.signed_at).toBe('2026-04-30T12:00:00Z');
    expect(sc.manifest_bytes_base64).toBeNull();
  });
});

describe('version verify_manifest — dispatch + envelope', () => {
  it('Test 17 — by version_id: engine called with {versionId}, breadcrumb resolved non-null', async () => {
    const versionId = seedCompleted(stack, stack.shotId);
    const fixedReport: VerificationReport = {
      valid: true,
      signature_status: 'valid',
      matched_assertions: ['c2pa.actions', 'vfx_familiar.input'],
      gaps: [],
      failures: [],
      cert_subject: 'CN=Dev Cert',
      signed_at: '2026-04-30T12:00:00Z',
    };
    const verifySpy = vi
      .spyOn(stack.engine, 'verifyManifestForVersion')
      .mockResolvedValue(fixedReport);
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'verify_manifest',
      version_id: versionId,
    });
    expect(res.isError).toBeFalsy();
    expect(verifySpy).toHaveBeenCalledWith({ versionId });
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.valid).toBe(true);
    expect(sc.signature_status).toBe('valid');
    expect(sc.matched_assertions).toEqual(['c2pa.actions', 'vfx_familiar.input']);
    expect(sc.gaps).toEqual([]);
    expect(sc.failures).toEqual([]);
    expect(sc.cert_subject).toBe('CN=Dev Cert');
    expect(sc.signed_at).toBe('2026-04-30T12:00:00Z');
    // breadcrumb non-null on version-id branch.
    expect(Array.isArray(sc.breadcrumb)).toBe(true);
    expect((sc.breadcrumb as unknown[]).length).toBe(5);
    expect(typeof sc.breadcrumb_text).toBe('string');
  });

  it('Test 18 — by bytes: engine called with {manifestBytes, format}, breadcrumb NULL', async () => {
    const fixedReport: VerificationReport = {
      valid: true,
      signature_status: 'valid',
      matched_assertions: ['c2pa.actions'],
      gaps: [],
      failures: [],
      cert_subject: null,
      signed_at: null,
    };
    const verifySpy = vi
      .spyOn(stack.engine, 'verifyManifestForVersion')
      .mockResolvedValue(fixedReport);
    registerVersion(server as never, stack.engine);
    // 'iVBORw0KGgoAAAA' decodes to 11 bytes; we just need ANY base64 string.
    const sampleBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    const res = await server.registeredHandler!({
      action: 'verify_manifest',
      manifest_bytes_base64: sampleBase64,
      format: 'image/png',
    });
    expect(res.isError).toBeFalsy();
    // Assert engine called with discriminated bytes form.
    expect(verifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestBytes: expect.any(Buffer),
        format: 'image/png',
      }),
    );
    const callArg = verifySpy.mock.calls[0]![0] as { manifestBytes: Buffer; format: string };
    expect(callArg.manifestBytes.length).toBe(4);   // PNG magic header bytes
    expect(callArg.manifestBytes.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.breadcrumb).toBeNull();           // D-PLAN-3-4
    expect(sc.breadcrumb_text).toBeNull();
  });

  it('Test 19 — base64 round-trip: input bytes equal decoded buffer', async () => {
    const sourceBytes = Buffer.from('hello world', 'utf-8');
    const verifySpy = vi
      .spyOn(stack.engine, 'verifyManifestForVersion')
      .mockResolvedValue({
        valid: false, signature_status: 'no_manifest',
        matched_assertions: [], gaps: [], failures: [],
        cert_subject: null, signed_at: null,
      });
    registerVersion(server as never, stack.engine);
    await server.registeredHandler!({
      action: 'verify_manifest',
      manifest_bytes_base64: sourceBytes.toString('base64'),
      format: 'image/png',
    });
    const callArg = verifySpy.mock.calls[0]![0] as { manifestBytes: Buffer; format: string };
    expect(callArg.manifestBytes.length).toBe(sourceBytes.length);
    expect(callArg.manifestBytes.equals(sourceBytes)).toBe(true);
  });

  it('Test 20 — invalid base64 → engine surfaces signature_status=no_manifest', async () => {
    // Buffer.from(badbase64, 'base64') silently truncates rather than throwing.
    // The engine then either returns no_manifest (unparseable JUMBF) — verified here.
    vi.spyOn(stack.engine, 'verifyManifestForVersion').mockResolvedValue({
      valid: false, signature_status: 'no_manifest',
      matched_assertions: [], gaps: [], failures: [],
      cert_subject: null, signed_at: null,
    });
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'verify_manifest',
      manifest_bytes_base64: '!!!not-base64!!!',
      format: 'image/png',
    });
    // Buffer.from doesn't throw on garbage. Engine surfaces no_manifest. No isError.
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { signature_status: string };
    expect(sc.signature_status).toBe('no_manifest');
  });

  it('Test 21 — VERSION_NOT_FOUND on version-id branch surfaces verbatim', async () => {
    vi.spyOn(stack.engine, 'verifyManifestForVersion').mockRejectedValue(
      new TypedError('VERSION_NOT_FOUND', "Version 'ver_xyz' not found"),
    );
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'verify_manifest',
      version_id: 'ver_xyz_pretend',
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { code: string };
    expect(sc.code).toBe('VERSION_NOT_FOUND');
  });

  it('Test 22 — C2PA_VERIFIER_LOAD_FAILED preserved with hint', async () => {
    vi.spyOn(stack.engine, 'verifyManifestForVersion').mockRejectedValue(
      new TypedError(
        'C2PA_VERIFIER_LOAD_FAILED',
        'Native binding load failed',
        'Reinstall c2pa-node bindings (see CONTRIBUTING.md)',
      ),
    );
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'verify_manifest',
      manifest_bytes_base64: 'AAAA',
      format: 'image/png',
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { code: string; hint?: string };
    expect(sc.code).toBe('C2PA_VERIFIER_LOAD_FAILED');
    expect(sc.hint).toMatch(/binding/i);
  });
});

// =====================================================================
// Section C — Invariants (Tests 23-25). Dual-form mirror, action-enum
// extension, architecture-purity self-check.
// =====================================================================

describe('version export_manifest + verify_manifest — invariants', () => {
  it('Test 23 — D-PROV-08 dual-form mirror: JSON.parse(content[0].text) === structuredContent', async () => {
    const versionId = seedCompleted(stack, stack.shotId);
    vi.spyOn(stack.engine, 'exportManifestForVersion').mockResolvedValue({
      format: 'image/png',
      signed_at: '2026-04-30T12:00:00Z',
      manifest_bytes_base64: 'AAAA',
      manifest_status: 'present',
      cert_subject: 'CN=X',
      ingredients_summary: null,
    });
    registerVersion(server as never, stack.engine);
    const exportRes = await server.registeredHandler!({
      action: 'export_manifest',
      version_id: versionId,
    });
    expect(JSON.parse(exportRes.content[0].text)).toEqual(exportRes.structuredContent);

    vi.spyOn(stack.engine, 'verifyManifestForVersion').mockResolvedValue({
      valid: true, signature_status: 'valid',
      matched_assertions: [], gaps: [], failures: [],
      cert_subject: null, signed_at: null,
    });
    const verifyRes = await server.registeredHandler!({
      action: 'verify_manifest',
      manifest_bytes_base64: 'AAAA',
      format: 'image/png',
    });
    expect(JSON.parse(verifyRes.content[0].text)).toEqual(verifyRes.structuredContent);
  });

  it('Test 24 — architecture-purity: version-tool.ts has zero c2pa-node imports', () => {
    // Self-check matching the architecture-purity guard pattern.
    let out = '';
    let exitCode = 0;
    try {
      out = execFileSync(
        'grep',
        [
          '-E',
          "from[[:space:]]+['\"]c2pa-node|import[[:space:]]*\\([[:space:]]*['\"]c2pa-node",
          'src/tools/version-tool.ts',
        ],
        { encoding: 'utf8' },
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 1) {
        // grep found no matches — that's the GREEN state we want.
        exitCode = 1;
      } else {
        throw err;
      }
    }
    expect(out.trim(), `c2pa-node import in version-tool.ts:\n${out}`).toBe('');
    expect(exitCode).toBe(1);
  });

  it('Test 25 — registerTool inputSchema action enum lists all 6 actions', () => {
    registerVersion(server as never, stack.engine);
    expect(server.registeredInputSchema).not.toBeNull();
    // The inputSchema.action is a Zod enum at this point — invoke its parse to
    // verify the literal set. Cast through unknown so we don't depend on Zod's
    // internal ZodEnum generic shape.
    const actionSchema = server.registeredInputSchema!.action as unknown as z.ZodType<string>;
    // ZodEnum exposes its options via .options on the def.
    // We resolve via parse — every supported literal must succeed.
    expect(() => actionSchema.parse('get')).not.toThrow();
    expect(() => actionSchema.parse('list')).not.toThrow();
    expect(() => actionSchema.parse('diff')).not.toThrow();
    expect(() => actionSchema.parse('provenance')).not.toThrow();
    expect(() => actionSchema.parse('export_manifest')).not.toThrow();
    expect(() => actionSchema.parse('verify_manifest')).not.toThrow();
    // Phase 16 / Plan 16-04 — redact_manifest is now a valid action enum
    // member. The unknown-action sentinel is updated to a clearly-invalid
    // literal that the enum will never accept.
    expect(() => actionSchema.parse('redact_manifest')).not.toThrow();
    // And an unknown action MUST reject (sanity).
    expect(() => actionSchema.parse('not_a_real_action')).toThrow();
  });
});
