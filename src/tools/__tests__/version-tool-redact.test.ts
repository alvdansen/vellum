// Phase 16 / Plan 16-04 — co-located unit tests for the new
// `version` tool action: `redact_manifest`.
//
// Coverage matrix:
//   - 10 Zod validation cases (each rejection surface for the new arm)
//   - 3 dispatch / envelope-shape cases (happy + breadcrumb + dual-form mirror)
//   - 5 error-mapping cases (TypedError → toolError preserved verbatim)
//   - 1 architecture-purity self-check (zero c2pa-node imports in tool layer)
//   - 1 action-enum visibility (registered inputSchema includes 'redact_manifest')
//   - 3 C-08 cross-layer invariants (byte-equal round-trip, 3-way equivalence,
//     multi-entry policy ordering)
//
// These tests intentionally bypass the McpServer.registerTool indirection by
// invoking `registerVersion(server, engine)` against a recording mock and
// capturing the registered handler closure — same pattern Plan 16-03 used.

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
import type { RedactionResult } from '../../engine/c2pa/redaction.js';
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
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-ver-tool-redact-${nanoid(6)}-`));
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
// Section A — Zod validation (Tests 1-10). Drives the registered handler
// directly with payload variants; expects INVALID_INPUT for any malformed
// shape.
// =====================================================================

describe('version redact_manifest — Zod validation', () => {
  it('Test 1 — happy: {action: redact_manifest, version_id, redaction_policy: 1 entry} parses', async () => {
    registerVersion(server as never, stack.engine);
    expect(server.registeredHandler).not.toBeNull();
    // version_id is unknown — engine returns VERSION_NOT_FOUND, not INVALID_INPUT.
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: 'ver_doesnt_exist',
      redaction_policy: ['claim_generator'],
    });
    expect(res.isError).toBe(true);
    // Either VERSION_NOT_FOUND (when c2paConfig is null path returns
    // REDACT_SIGNING_DISABLED first; engine in this test has c2paConfig=null
    // because we didn't pass any). Both are "Zod parse SUCCEEDED" outcomes.
    expect((res.structuredContent as { code: string }).code).not.toBe('INVALID_INPUT');
  });

  it('Test 2 — happy with multi-path policy: 3 entries parses', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: 'ver_doesnt_exist',
      redaction_policy: [
        'claim_generator',
        'assertions[*].data.prompt_positive',
        "assertions[label='vellum.input'].data.prompt_negative",
      ],
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).not.toBe('INVALID_INPUT');
  });

  it('Test 3 — missing version_id rejects with INVALID_INPUT', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      redaction_policy: ['claim_generator'],
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('Test 4 — missing redaction_policy rejects with INVALID_INPUT', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: 'ver_xyz',
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('Test 5 — empty redaction_policy rejects with INVALID_INPUT (min(1))', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: 'ver_xyz',
      redaction_policy: [],
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('Test 6 — redaction_policy too large (33 entries) rejects with INVALID_INPUT', async () => {
    registerVersion(server as never, stack.engine);
    const policy = Array.from({ length: 33 }, (_, i) => `field_${i}`);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: 'ver_xyz',
      redaction_policy: policy,
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('Test 7 — non-string entry rejects with INVALID_INPUT', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: 'ver_xyz',
      redaction_policy: ['valid', 42],
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('Test 8 — empty string entry rejects with INVALID_INPUT (each entry min(1))', async () => {
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: 'ver_xyz',
      redaction_policy: [''],
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('Test 9 — entry > 1024 chars rejects with INVALID_INPUT (D-PLAN-4-3)', async () => {
    registerVersion(server as never, stack.engine);
    const oversize = 'a'.repeat(1025);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: 'ver_xyz',
      redaction_policy: [oversize],
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('Test 10 — version_id constraints: empty + > MAX_ID_LENGTH each reject with INVALID_INPUT', async () => {
    registerVersion(server as never, stack.engine);
    const empty = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: '',
      redaction_policy: ['claim_generator'],
    });
    expect(empty.isError).toBe(true);
    expect((empty.structuredContent as { code: string }).code).toBe('INVALID_INPUT');

    const oversize = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: 'a'.repeat(200),
      redaction_policy: ['claim_generator'],
    });
    expect(oversize.isError).toBe(true);
    expect((oversize.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });
});

// =====================================================================
// Section B — Dispatch + envelope shape (Tests 11-13). Mocks the engine
// facade method to assert the tool layer wires the call + reshapes the
// response correctly.
// =====================================================================

describe('version redact_manifest — dispatch + envelope', () => {
  const FIXTURE_REDACTED_BYTES = Buffer.from('fake-redacted-png-bytes');
  const fakeResult: RedactionResult = {
    redactedBytes: FIXTURE_REDACTED_BYTES,
    redactedFields: ['claim_generator'],
    notFound: ["assertions[label='nonexistent'].data.foo"],
    signedAt: '2026-04-30T12:00:00.000Z',
    format: 'image/png',
    certSubject: 'CN=test-cert',
  };

  it('Test 11 — happy dispatch: engine.redactManifestForVersion called + envelope shaped', async () => {
    const versionId = seedCompleted(stack, stack.shotId);
    const redactSpy = vi
      .spyOn(stack.engine, 'redactManifestForVersion')
      .mockResolvedValue(fakeResult);
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: versionId,
      redaction_policy: ['claim_generator'],
    });
    expect(res.isError).toBeFalsy();
    expect(redactSpy).toHaveBeenCalledWith(versionId, ['claim_generator']);
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.version_id).toBe(versionId);
    expect(sc.manifest_bytes_base64).toBe(FIXTURE_REDACTED_BYTES.toString('base64'));
    expect(
      Buffer.from(sc.manifest_bytes_base64 as string, 'base64').equals(FIXTURE_REDACTED_BYTES),
    ).toBe(true);
    expect(sc.redacted_fields).toEqual(['claim_generator']);
    expect(sc.not_found).toEqual(["assertions[label='nonexistent'].data.foo"]);
    expect(sc.signed_at).toBe('2026-04-30T12:00:00.000Z');
    expect(sc.format).toBe('image/png');
    expect(sc.cert_subject).toBe('CN=test-cert');
    expect(sc.breadcrumb).toBeDefined();
    expect(typeof sc.breadcrumb_text).toBe('string');
  });

  it('Test 12 — breadcrumb resolved via engine.getVersion', async () => {
    const versionId = seedCompleted(stack, stack.shotId);
    vi.spyOn(stack.engine, 'redactManifestForVersion').mockResolvedValue(fakeResult);
    const getVersionSpy = vi.spyOn(stack.engine, 'getVersion');
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: versionId,
      redaction_policy: ['claim_generator'],
    });
    expect(res.isError).toBeFalsy();
    // Engine.getVersion called for breadcrumb resolution.
    expect(getVersionSpy).toHaveBeenCalledWith(versionId);
    const sc = res.structuredContent as Record<string, unknown>;
    // 5 entries: workspace, project, sequence, shot, version.
    expect(Array.isArray(sc.breadcrumb)).toBe(true);
    expect((sc.breadcrumb as unknown[]).length).toBe(5);
    expect((sc.breadcrumb_text as string).length).toBeGreaterThan(0);
  });

  it('Test 13 — D-PROV-08 dual-form mirror: JSON.parse(content[0].text) === structuredContent', async () => {
    const versionId = seedCompleted(stack, stack.shotId);
    vi.spyOn(stack.engine, 'redactManifestForVersion').mockResolvedValue(fakeResult);
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: versionId,
      redaction_policy: ['claim_generator'],
    });
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
  });
});

// =====================================================================
// Section C — Error mapping (Tests 14-18). Five engine TypedError surfaces
// flow verbatim through toolError.
// =====================================================================

describe('version redact_manifest — error mapping', () => {
  it('Test 14 — VERSION_NOT_FOUND from engine surfaces verbatim', async () => {
    vi.spyOn(stack.engine, 'redactManifestForVersion').mockRejectedValue(
      new TypedError('VERSION_NOT_FOUND', "Version 'ver_xyz' not found"),
    );
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: 'ver_xyz_pretendexists',
      redaction_policy: ['claim_generator'],
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { code: string; message: string };
    expect(sc.code).toBe('VERSION_NOT_FOUND');
    expect(sc.message).toContain('ver_xyz');
  });

  it('Test 15 — REDACT_NO_MANIFEST preserved with hint', async () => {
    vi.spyOn(stack.engine, 'redactManifestForVersion').mockRejectedValue(
      new TypedError(
        'REDACT_NO_MANIFEST',
        "No manifest_signed event for version 'ver_xyz' / filename 'out.png'",
        'Sign the version first via the download path, then retry redaction.',
      ),
    );
    const versionId = seedCompleted(stack, stack.shotId);
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: versionId,
      redaction_policy: ['claim_generator'],
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { code: string; hint?: string };
    expect(sc.code).toBe('REDACT_NO_MANIFEST');
    expect(sc.hint).toMatch(/Sign the version/);
  });

  it('Test 16 — REDACT_PARENT_UNREADABLE preserved', async () => {
    vi.spyOn(stack.engine, 'redactManifestForVersion').mockRejectedValue(
      new TypedError(
        'REDACT_PARENT_UNREADABLE',
        'c2pa.read failed on parent asset: corrupt JUMBF',
        'Parent manifest could not be parsed.',
      ),
    );
    const versionId = seedCompleted(stack, stack.shotId);
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: versionId,
      redaction_policy: ['claim_generator'],
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { code: string };
    expect(sc.code).toBe('REDACT_PARENT_UNREADABLE');
  });

  it('Test 17 — REDACT_POLICY_INVALID preserved with actionable hint', async () => {
    vi.spyOn(stack.engine, 'redactManifestForVersion').mockRejectedValue(
      new TypedError(
        'REDACT_POLICY_INVALID',
        "Redaction policy entry contains '..' traversal segment: ../etc/passwd",
        'Path-traversal-style segments are rejected.',
      ),
    );
    const versionId = seedCompleted(stack, stack.shotId);
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: versionId,
      redaction_policy: ['../etc/passwd'],
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { code: string; message: string; hint?: string };
    expect(sc.code).toBe('REDACT_POLICY_INVALID');
    expect(sc.message).toContain('..');
    expect(sc.hint).toMatch(/traversal/);
  });

  it('Test 18 — EXPORT_PATH_TRAVERSAL_REJECTED preserved', async () => {
    vi.spyOn(stack.engine, 'redactManifestForVersion').mockRejectedValue(
      new TypedError(
        'EXPORT_PATH_TRAVERSAL_REJECTED',
        'Filename contains path-traversal characters: ../etc/passwd',
      ),
    );
    const versionId = seedCompleted(stack, stack.shotId);
    registerVersion(server as never, stack.engine);
    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: versionId,
      redaction_policy: ['claim_generator'],
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { code: string };
    expect(sc.code).toBe('EXPORT_PATH_TRAVERSAL_REJECTED');
  });
});

// =====================================================================
// Section D — Invariants (Tests 19-20). Architecture-purity self-check
// + action-enum visibility.
// =====================================================================

describe('version redact_manifest — invariants', () => {
  it('Test 19 — architecture-purity: version-tool.ts has zero c2pa-node imports', () => {
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

  it('Test 20 — registerTool inputSchema action enum lists all 7 actions including redact_manifest', () => {
    registerVersion(server as never, stack.engine);
    expect(server.registeredInputSchema).not.toBeNull();
    // ZodEnum exposes parse — every supported literal must succeed.
    const actionSchema = server.registeredInputSchema!.action as unknown as z.ZodType<string>;
    expect(() => actionSchema.parse('get')).not.toThrow();
    expect(() => actionSchema.parse('list')).not.toThrow();
    expect(() => actionSchema.parse('diff')).not.toThrow();
    expect(() => actionSchema.parse('provenance')).not.toThrow();
    expect(() => actionSchema.parse('export_manifest')).not.toThrow();
    expect(() => actionSchema.parse('verify_manifest')).not.toThrow();
    expect(() => actionSchema.parse('redact_manifest')).not.toThrow();
    // Unknown action MUST reject (sanity).
    expect(() => actionSchema.parse('not_a_real_action')).toThrow();
    // Field redaction_policy is present in the inputSchema (optional at the
    // ZodRawShape layer; the inner z.union arm requires it).
    expect(server.registeredInputSchema!.redaction_policy).toBeDefined();
  });
});

// =====================================================================
// Section E — C-08 cross-layer invariants (Tests 21-23). Wire-level byte-
// equal round-trip, 3-way equivalence, multi-entry policy ordering.
// =====================================================================

describe('version redact_manifest — C-08 cross-layer invariants', () => {
  it('Test 21 — C-08: byte-equal round-trip — redact decodes to engine bytes; verify-by-bytes consumes same buffer', async () => {
    const versionId = seedCompleted(stack, stack.shotId);
    const ENGINE_BYTES = Buffer.from('fake-redacted-png-with-jumbf-headers-and-cbor-payload');
    const redactSpy = vi
      .spyOn(stack.engine, 'redactManifestForVersion')
      .mockResolvedValue({
        redactedBytes: ENGINE_BYTES,
        redactedFields: ['title'],
        notFound: [],
        signedAt: '2026-04-30T12:00:00.000Z',
        format: 'image/png',
        certSubject: 'CN=Dev Cert',
      });
    registerVersion(server as never, stack.engine);

    // Step 1: redact_manifest via the tool handler.
    const redactRes = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: versionId,
      redaction_policy: ['title'],
    });
    expect(redactRes.isError).toBeFalsy();
    expect(redactSpy).toHaveBeenCalledWith(versionId, ['title']);
    const redactSc = redactRes.structuredContent as Record<string, unknown>;
    const decoded = Buffer.from(redactSc.manifest_bytes_base64 as string, 'base64');

    // Assertion (a): decoded buffer equals engine's redactedBytes byte-for-byte.
    expect(decoded.equals(ENGINE_BYTES)).toBe(true);

    // Step 2: feed decoded bytes into verify_manifest (bytes form). Mock the
    // verifier to return a valid report with vellum.redacted in matched.
    const verifyReport: VerificationReport = {
      valid: true,
      signature_status: 'valid',
      matched_assertions: ['c2pa.actions', 'vellum.redacted'],
      gaps: [],
      failures: [],
      cert_subject: 'CN=Dev Cert',
      signed_at: '2026-04-30T12:00:00.000Z',
    };
    const verifySpy = vi
      .spyOn(stack.engine, 'verifyManifestForVersion')
      .mockResolvedValue(verifyReport);
    const verifyRes = await server.registeredHandler!({
      action: 'verify_manifest',
      manifest_bytes_base64: redactSc.manifest_bytes_base64 as string,
      format: redactSc.format as string,
    });
    expect(verifyRes.isError).toBeFalsy();
    // Engine.verifyManifestForVersion got the byte-equal Buffer + same format.
    const verifyArg = verifySpy.mock.calls[0]![0] as { manifestBytes: Buffer; format: string };
    expect(verifyArg.manifestBytes.equals(ENGINE_BYTES)).toBe(true);
    expect(verifyArg.format).toBe('image/png');
    // Assertion (b): verify report is valid + matched_assertions includes
    // 'vellum.redacted' (proves redact-then-verify round-trip works).
    const verifySc = verifyRes.structuredContent as Record<string, unknown>;
    expect(verifySc.valid).toBe(true);
    expect(verifySc.matched_assertions).toContain('vellum.redacted');
  });

  it('Test 22 — C-08: 3-way equivalence — input policy ↔ envelope.redacted_fields ↔ engine RedactionResult', async () => {
    // Simulates the chain: caller-supplied policy entry → engine RedactionResult.redactedFields
    // → envelope.redacted_fields. The 3-way equivalence catches drift at any layer.
    const versionId = seedCompleted(stack, stack.shotId);
    const inputPolicy = ["assertions[label='vellum.input'].data.prompt_positive"];
    // Engine returns the SAME path string in redactedFields.
    const engineRedactedFields = [...inputPolicy];
    vi.spyOn(stack.engine, 'redactManifestForVersion').mockResolvedValue({
      redactedBytes: Buffer.from('fake-redacted-bytes'),
      redactedFields: engineRedactedFields,
      notFound: [],
      signedAt: '2026-04-30T12:00:00.000Z',
      format: 'image/png',
      certSubject: 'CN=Dev Cert',
    });
    registerVersion(server as never, stack.engine);

    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: versionId,
      redaction_policy: inputPolicy,
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    const envelopeRedactedFields = sc.redacted_fields as string[];

    // 3-way equivalence: policy[0] === engineRedactedFields[0] === envelope.redacted_fields[0].
    expect(envelopeRedactedFields).toEqual(engineRedactedFields);
    expect(envelopeRedactedFields).toEqual(inputPolicy);
    expect(envelopeRedactedFields[0]).toBe(inputPolicy[0]);
    expect(envelopeRedactedFields[0]).toBe(engineRedactedFields[0]);
  });

  it('Test 23 — C-08: multi-entry policy preserves engine ordering (NOT input declaration order)', async () => {
    // Documents that the ENGINE's order reflects actual application order,
    // which may differ from input declaration order based on resolver depth.
    // The envelope MUST forward engine's order verbatim.
    const versionId = seedCompleted(stack, stack.shotId);
    const inputPolicy = [
      'claim_generator',
      'title',
      "assertions[label='vellum.input'].data.seed",
    ];
    // Engine returns a DIFFERENT order — say title first, then nested, then claim_generator.
    const engineOrder = [
      'title',
      "assertions[label='vellum.input'].data.seed",
      'claim_generator',
    ];
    vi.spyOn(stack.engine, 'redactManifestForVersion').mockResolvedValue({
      redactedBytes: Buffer.from('fake-redacted-bytes'),
      redactedFields: engineOrder,
      notFound: [],
      signedAt: '2026-04-30T12:00:00.000Z',
      format: 'image/png',
      certSubject: 'CN=Dev Cert',
    });
    registerVersion(server as never, stack.engine);

    const res = await server.registeredHandler!({
      action: 'redact_manifest',
      version_id: versionId,
      redaction_policy: inputPolicy,
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    const envelopeRedactedFields = sc.redacted_fields as string[];

    // Envelope preserves ENGINE's order (NOT input order).
    expect(envelopeRedactedFields).toEqual(engineOrder);
    expect(envelopeRedactedFields).not.toEqual(inputPolicy);
  });
});
