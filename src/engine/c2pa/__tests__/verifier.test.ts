/**
 * Phase 16 / Plan 16-01 Task 2 — verifier unit tests.
 *
 * Covers all 5 signature_status branches (valid | invalid | untrusted_root |
 * unsupported_algorithm | no_manifest), discriminated input form
 * (versionId-form vs bytes-form), format inference via routeFormat, dev-cert
 * opt-in via VFX_FAMILIAR_C2PA_TRUST_DEV_CERT, ENOENT graceful-fail, and
 * version-row-missing throw.
 *
 * Test fixtures use vi.mock('c2pa-node', ...) for reproducible signature_status
 * branch coverage without network or platform-specific binding requirements.
 * The real-binding round-trip happens in Phase 14's c2pa-verification.test.ts;
 * here we lock the verifier's classification logic and shape conformance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Version } from '../../../types/hierarchy.js';
import type { ManifestSignedPayloadFields } from '../../../types/provenance.js';

// We re-import verifier inside each test that needs a fresh c2pa-node mock so
// the lazy-import path picks up the mock cleanly. Static imports here are
// for type-only references.
import type { VerificationReport, VerifyManifestInput } from '../verifier.js';

const PNG_FIXTURE = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(56, 0xab),
]);

const VERSION_ID = 'ver_test_alpha';
const FILENAME = 'output.png';

// --- Type-shape verification (Test 12) ---
describe('VerificationReport — D-CTX-2 type-shape lock (Test 12)', () => {
  it('signature_status discriminated union contains exactly 5 values', () => {
    // Type-only assertion via exhaustive switch — runs but doesn't actually
    // call the verifier. The .never assignment fails compilation if the
    // union ever gains/loses a value.
    const allValues: VerificationReport['signature_status'][] = [
      'valid',
      'invalid',
      'untrusted_root',
      'unsupported_algorithm',
      'no_manifest',
    ];
    function assertCovered(s: VerificationReport['signature_status']): string {
      switch (s) {
        case 'valid':
          return 'a';
        case 'invalid':
          return 'b';
        case 'untrusted_root':
          return 'c';
        case 'unsupported_algorithm':
          return 'd';
        case 'no_manifest':
          return 'e';
        default: {
          const _exhaustive: never = s;
          return _exhaustive;
        }
      }
    }
    expect(allValues.map(assertCovered)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('VerificationReport carries all D-CTX-2 fields (compile-time check via assignment)', () => {
    const r: VerificationReport = {
      valid: false,
      signature_status: 'no_manifest',
      matched_assertions: [],
      gaps: [],
      failures: [],
      cert_subject: null,
      signed_at: null,
    };
    expect(r.signature_status).toBe('no_manifest');
    expect(Array.isArray(r.matched_assertions)).toBe(true);
    expect(Array.isArray(r.gaps)).toBe(true);
    expect(Array.isArray(r.failures)).toBe(true);
  });
});

// --- Mocked c2pa-node — covers signature_status branches reproducibly ---
//
// The verifier's c2pa-node import is lazy via `await import('c2pa-node')`,
// so vi.mock applied in this file scope intercepts those calls.

interface ResolvedManifestLike {
  assertions?: Array<{ label?: string }>;
  signature_info?: { issuer?: string; time?: string } | null;
}
interface ResolvedManifestStoreLike {
  active_manifest: ResolvedManifestLike | null;
  validation_status?: Array<{ code?: string; url?: string }> | null;
}

function makeMock(store: ResolvedManifestStoreLike | null) {
  const readFn = vi.fn(async (_asset: unknown) => store);
  return {
    createC2pa: vi.fn(() => ({ read: readFn })),
    __readMock: readFn,
  };
}

function valid_store(): ResolvedManifestStoreLike {
  return {
    active_manifest: {
      assertions: [
        { label: 'c2pa.actions' },
        { label: 'vfx_familiar.input' },
        { label: 'c2pa.hash.data' },
      ],
      signature_info: {
        issuer: 'CN=test-cert',
        time: '2026-04-30T12:00:00.000Z',
      },
    },
    validation_status: [],
  };
}

function tampered_store(): ResolvedManifestStoreLike {
  return {
    active_manifest: {
      assertions: [
        { label: 'c2pa.actions' },
        { label: 'vfx_familiar.input' },
        { label: 'c2pa.hash.data' },
      ],
      signature_info: {
        issuer: 'CN=test-cert',
        time: '2026-04-30T12:00:00.000Z',
      },
    },
    validation_status: [
      { code: 'assertion.dataHash.mismatch', url: 'c2pa.hash.data' },
    ],
  };
}

function untrusted_store(): ResolvedManifestStoreLike {
  return {
    active_manifest: {
      assertions: [
        { label: 'c2pa.actions' },
        { label: 'vfx_familiar.input' },
      ],
      signature_info: {
        issuer: 'CN=untrusted-dev',
        time: '2026-04-30T12:00:00.000Z',
      },
    },
    validation_status: [
      { code: 'signingCredential.untrusted', url: 'claim.signature' },
    ],
  };
}

function unsupported_alg_store(): ResolvedManifestStoreLike {
  return {
    active_manifest: {
      assertions: [{ label: 'c2pa.actions' }],
      signature_info: { issuer: 'CN=test', time: '2026-04-30T12:00:00.000Z' },
    },
    validation_status: [
      { code: 'claimSignature.algorithmUnsupported', url: 'claim.signature' },
    ],
  };
}

function makeStubVersion(outputs_json: string | null): Version {
  return {
    id: VERSION_ID,
    shot_id: 'shot_test',
    version_number: 1,
    status: 'completed',
    job_id: null,
    parent_version_id: null,
    notes: null,
    created_at: 1700000000,
    completed_at: 1700000001,
    error_code: null,
    error_message: null,
    outputs_json,
    lineage_type: null,
    reproduction_warnings_json: null,
  };
}

function stubRepos(opts: {
  version: Version | null;
  event: ManifestSignedPayloadFields | null;
}) {
  return {
    versionRepo: {
      getVersion: () => opts.version,
    },
    provenanceRepo: {
      getLatestManifestSignedEvent: () => opts.event,
    },
  };
}

// Use vi.hoisted so mocks survive vi.mock hoisting; we need a way to swap the
// active store between tests. The factory returns a getter that reads a
// module-scoped mutable holder.
const mockState = vi.hoisted(() => ({
  store: null as ResolvedManifestStoreLike | null,
  shouldThrow: false as boolean,
  shouldThrowImport: false as boolean,
}));

vi.mock('c2pa-node', async () => {
  if (mockState.shouldThrowImport) {
    throw new Error('synthetic native binding load failure');
  }
  return {
    createC2pa: () => ({
      read: async () => {
        if (mockState.shouldThrow) {
          throw new Error('synthetic c2pa-rs read failure');
        }
        return mockState.store;
      },
    }),
  };
});

beforeEach(() => {
  mockState.store = null;
  mockState.shouldThrow = false;
  mockState.shouldThrowImport = false;
  delete process.env.VFX_FAMILIAR_C2PA_TRUST_DEV_CERT;
});

afterEach(() => {
  delete process.env.VFX_FAMILIAR_C2PA_TRUST_DEV_CERT;
});

// --- Buffer-form tests ---

describe('verifyManifest — bytes-form (Tests 1-5, 9-11)', () => {
  it('Test 1 — valid signature → valid + matched_assertions populated + cert_subject from signature_info', async () => {
    mockState.store = valid_store();
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      manifestBytes: PNG_FIXTURE,
      format: 'image/png',
    });
    expect(r.signature_status).toBe('valid');
    expect(r.valid).toBe(true);
    expect(r.matched_assertions).toContain('c2pa.actions');
    expect(r.matched_assertions).toContain('vfx_familiar.input');
    expect(r.failures).toEqual([]);
    expect(r.cert_subject).toBe('CN=test-cert');
    expect(r.signed_at).toBe('2026-04-30T12:00:00.000Z');
  });

  it('Test 2 — null active_manifest → no_manifest', async () => {
    mockState.store = { active_manifest: null, validation_status: [] };
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      manifestBytes: PNG_FIXTURE,
      format: 'image/png',
    });
    expect(r.signature_status).toBe('no_manifest');
    expect(r.valid).toBe(false);
    expect(r.matched_assertions).toEqual([]);
    expect(r.failures).toEqual([]);
    expect(r.cert_subject).toBeNull();
    expect(r.signed_at).toBeNull();
  });

  it('Test 2b — c2pa.read returns null entirely → no_manifest', async () => {
    mockState.store = null;
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      manifestBytes: PNG_FIXTURE,
      format: 'image/png',
    });
    expect(r.signature_status).toBe('no_manifest');
  });

  it('Test 3 — tampered (assertion.dataHash.mismatch) → invalid + failures populated', async () => {
    mockState.store = tampered_store();
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      manifestBytes: PNG_FIXTURE,
      format: 'image/png',
    });
    expect(r.signature_status).toBe('invalid');
    expect(r.valid).toBe(false);
    expect(r.failures.length).toBeGreaterThan(0);
    expect(r.failures[0]!.reason).toBe('assertion.dataHash.mismatch');
  });

  it('Test 4 — signingCredential.untrusted (production default) → untrusted_root + valid=false', async () => {
    mockState.store = untrusted_store();
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      manifestBytes: PNG_FIXTURE,
      format: 'image/png',
    });
    expect(r.signature_status).toBe('untrusted_root');
    expect(r.valid).toBe(false);
    expect(r.failures.length).toBeGreaterThan(0);
  });

  it('Test 4b — signingCredential.untrusted + dev-cert env=1 → valid (D-PLAN-5)', async () => {
    mockState.store = untrusted_store();
    process.env.VFX_FAMILIAR_C2PA_TRUST_DEV_CERT = '1';
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      manifestBytes: PNG_FIXTURE,
      format: 'image/png',
    });
    expect(r.signature_status).toBe('valid');
    expect(r.valid).toBe(true);
  });

  it('Test 4c — dev-cert env unset → still untrusted_root (negative case for D-PLAN-5)', async () => {
    mockState.store = untrusted_store();
    // Explicitly do NOT set the env var
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      manifestBytes: PNG_FIXTURE,
      format: 'image/png',
    });
    expect(r.signature_status).toBe('untrusted_root');
  });

  it('Test 4d — dev-cert env=0 (not "1") → still untrusted_root (only "1" enables dev mode)', async () => {
    mockState.store = untrusted_store();
    process.env.VFX_FAMILIAR_C2PA_TRUST_DEV_CERT = '0';
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      manifestBytes: PNG_FIXTURE,
      format: 'image/png',
    });
    expect(r.signature_status).toBe('untrusted_root');
  });

  it('Test 5 — claimSignature.algorithmUnsupported → unsupported_algorithm', async () => {
    mockState.store = unsupported_alg_store();
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      manifestBytes: PNG_FIXTURE,
      format: 'image/png',
    });
    expect(r.signature_status).toBe('unsupported_algorithm');
    expect(r.valid).toBe(false);
  });

  it('Test 9 — corrupt bytes (read throws) → no_manifest (does NOT bubble error)', async () => {
    mockState.shouldThrow = true;
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      manifestBytes: Buffer.from([0, 0, 0, 0]),
      format: 'image/png',
    });
    expect(r.signature_status).toBe('no_manifest');
  });

  it('Test 10 — matched_assertions order matches assertion order in manifest', async () => {
    mockState.store = {
      active_manifest: {
        assertions: [
          { label: 'c2pa.actions' },
          { label: 'vfx_familiar.input' },
          { label: 'extra.label' },
        ],
        signature_info: { issuer: 'X', time: 'T' },
      },
      validation_status: [],
    };
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      manifestBytes: PNG_FIXTURE,
      format: 'image/png',
    });
    expect(r.matched_assertions).toEqual([
      'c2pa.actions',
      'vfx_familiar.input',
      'extra.label',
    ]);
  });

  it('Test 11 — gaps surface c2pa.actions when assertion missing', async () => {
    mockState.store = {
      active_manifest: {
        assertions: [{ label: 'something.else' }],
        signature_info: { issuer: 'X', time: 'T' },
      },
      validation_status: [],
    };
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      manifestBytes: PNG_FIXTURE,
      format: 'image/png',
    });
    expect(r.gaps).toContain('c2pa.actions');
    expect(r.gaps).toContain('vfx_familiar.input');
  });
});

// --- versionId-form tests ---

describe('verifyManifest — versionId-form (Tests 6-8)', () => {
  let outputsDir: string;

  beforeEach(async () => {
    outputsDir = await mkdtemp(join(tmpdir(), 'vfx-verifier-test-'));
  });

  afterEach(async () => {
    try {
      await rm(outputsDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('Test 6 — versionId-form happy path: reads disk + infers mimeType + classifies valid', async () => {
    mockState.store = valid_store();
    const verDir = join(outputsDir, VERSION_ID);
    await mkdir(verDir, { recursive: true });
    await writeFile(join(verDir, FILENAME), PNG_FIXTURE);
    const event: ManifestSignedPayloadFields = {
      filename: FILENAME,
      format: 'image/png',
      signed: true,
      cert_subject_summary: 'CN=engine-recorded-cert',
      signed_at: '2026-04-30T11:00:00.000Z',
      status_reason: '',
      algorithm: 'Es256',
    };
    const stubs = stubRepos({
      version: makeStubVersion(JSON.stringify([{ filename: FILENAME }])),
      event,
    });
    const { verifyManifest } = await import('../verifier.js');
    const input: VerifyManifestInput = {
      versionId: VERSION_ID,
      versionRepo: stubs.versionRepo,
      provenanceRepo: stubs.provenanceRepo,
      outputsDir,
    };
    const r = await verifyManifest(input);
    expect(r.signature_status).toBe('valid');
    // Engine-recorded values override c2pa-rs's values in versionId-form.
    expect(r.cert_subject).toBe('CN=engine-recorded-cert');
    expect(r.signed_at).toBe('2026-04-30T11:00:00.000Z');
  });

  it('Test 7 — versionId-form with no manifest_signed event → no_manifest (disk file NOT read)', async () => {
    // Mock store deliberately set to a value that WOULD be valid — to confirm
    // the verifier short-circuits BEFORE invoking c2pa-rs.
    mockState.store = valid_store();
    const stubs = stubRepos({
      version: makeStubVersion(JSON.stringify([{ filename: FILENAME }])),
      event: null,
    });
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      versionId: VERSION_ID,
      versionRepo: stubs.versionRepo,
      provenanceRepo: stubs.provenanceRepo,
      outputsDir,
    });
    expect(r.signature_status).toBe('no_manifest');
    expect(r.cert_subject).toBeNull();
    expect(r.signed_at).toBeNull();
    expect(r.matched_assertions).toEqual([]);
  });

  it('Test 7b — versionId-form with signed=false event → no_manifest (no disk read)', async () => {
    mockState.store = valid_store();
    const event: ManifestSignedPayloadFields = {
      filename: FILENAME,
      format: 'image/png',
      signed: false,
      cert_subject_summary: '',
      signed_at: '2026-04-30T11:00:00.000Z',
      status_reason: 'signing_disabled',
      algorithm: '',
    };
    const stubs = stubRepos({
      version: makeStubVersion(JSON.stringify([{ filename: FILENAME }])),
      event,
    });
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      versionId: VERSION_ID,
      versionRepo: stubs.versionRepo,
      provenanceRepo: stubs.provenanceRepo,
      outputsDir,
    });
    expect(r.signature_status).toBe('no_manifest');
  });

  it('Test 8 — versionId-form, disk file missing (ENOENT) → no_manifest (graceful-fail)', async () => {
    mockState.store = valid_store();
    // Note: deliberately do NOT write disk file.
    const event: ManifestSignedPayloadFields = {
      filename: FILENAME,
      format: 'image/png',
      signed: true,
      cert_subject_summary: 'CN=test',
      signed_at: '2026-04-30T11:00:00.000Z',
      status_reason: '',
      algorithm: 'Es256',
    };
    const stubs = stubRepos({
      version: makeStubVersion(JSON.stringify([{ filename: FILENAME }])),
      event,
    });
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      versionId: VERSION_ID,
      versionRepo: stubs.versionRepo,
      provenanceRepo: stubs.provenanceRepo,
      outputsDir,
    });
    expect(r.signature_status).toBe('no_manifest');
    // engine-recorded cert_subject + signed_at preserved on the no_manifest
    // graceful-fail path so callers see the engine's view of the failed sign.
    expect(r.cert_subject).toBe('CN=test');
    expect(r.signed_at).toBe('2026-04-30T11:00:00.000Z');
  });

  it('Test 8b — versionId-form with missing version row → throws VERSION_NOT_FOUND', async () => {
    const stubs = stubRepos({ version: null, event: null });
    const { verifyManifest } = await import('../verifier.js');
    await expect(
      verifyManifest({
        versionId: VERSION_ID,
        versionRepo: stubs.versionRepo,
        provenanceRepo: stubs.provenanceRepo,
        outputsDir,
      }),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'VERSION_NOT_FOUND',
    });
  });

  it('Test 8c — versionId-form with traversal in filename → throws EXPORT_PATH_TRAVERSAL_REJECTED', async () => {
    const stubs = stubRepos({
      version: makeStubVersion(JSON.stringify([{ filename: '../etc/passwd' }])),
      event: null,
    });
    const { verifyManifest } = await import('../verifier.js');
    await expect(
      verifyManifest({
        versionId: VERSION_ID,
        versionRepo: stubs.versionRepo,
        provenanceRepo: stubs.provenanceRepo,
        outputsDir,
      }),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'EXPORT_PATH_TRAVERSAL_REJECTED',
    });
  });

  it('Test 8d — versionId-form with outputs_json null → no_manifest (no disk read)', async () => {
    const stubs = stubRepos({
      version: makeStubVersion(null),
      event: null,
    });
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      versionId: VERSION_ID,
      versionRepo: stubs.versionRepo,
      provenanceRepo: stubs.provenanceRepo,
      outputsDir,
    });
    expect(r.signature_status).toBe('no_manifest');
  });

  it('Test 8e — versionId-form, unsupported_format extension → no_manifest', async () => {
    mockState.store = valid_store();
    const event: ManifestSignedPayloadFields = {
      filename: 'foo.exr',
      format: 'image/x-exr',
      signed: true, // even if the engine claimed signed=true, routeFormat will say unsupported
      cert_subject_summary: 'CN=test',
      signed_at: '2026-04-30T11:00:00.000Z',
      status_reason: '',
      algorithm: 'Es256',
    };
    // Write the file so ENOENT does not short-circuit before format check.
    const verDir = join(outputsDir, VERSION_ID);
    await mkdir(verDir, { recursive: true });
    await writeFile(join(verDir, 'foo.exr'), PNG_FIXTURE);
    const stubs = stubRepos({
      version: makeStubVersion(JSON.stringify([{ filename: 'foo.exr' }])),
      event,
    });
    const { verifyManifest } = await import('../verifier.js');
    const r = await verifyManifest({
      versionId: VERSION_ID,
      versionRepo: stubs.versionRepo,
      provenanceRepo: stubs.provenanceRepo,
      outputsDir,
    });
    expect(r.signature_status).toBe('no_manifest');
  });
});
