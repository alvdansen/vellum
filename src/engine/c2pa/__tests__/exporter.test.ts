/**
 * Phase 16 / Plan 16-01 Task 1 — exporter unit tests.
 *
 * Covers all 3 manifest_status branches (present | absent | unsupported_format),
 * path-traversal rejection at the boundary (T-16-01), graceful-fail on ENOENT
 * (D-CTX-9 mirror), VERSION_NOT_FOUND surface, and ingredients_summary mirror
 * preservation (Phase 15 D-CTX-5 additive field).
 *
 * Architecture-purity friendly: the tests stub VersionRepo + ProvenanceRepo via
 * Pick<...> so no real SQLite database is opened. mkdtemp + writeFile produce
 * the on-disk fixtures for the present-manifest path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportManifest, type ExporterResult } from '../exporter.js';
import { TypedError } from '../../errors.js';
import type { Version } from '../../../types/hierarchy.js';
import type { ManifestSignedPayloadFields } from '../../../types/provenance.js';

// PNG signature followed by 56 pad bytes — recognizable header so the test
// can confirm byte-identical round-trip through base64.
const PNG_FIXTURE = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(56, 0xab),
]);

const VERSION_ID = 'ver_test_alpha';
const FILENAME = 'output.png';

interface StubRepo {
  versionRepo: {
    getVersion: (id: string) => Version | null;
  };
  provenanceRepo: {
    getLatestManifestSignedEvent: (
      versionId: string,
      filename: string,
    ) => ManifestSignedPayloadFields | null;
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
}): StubRepo {
  return {
    versionRepo: {
      getVersion: (id: string) => (id === VERSION_ID ? opts.version : null),
    },
    provenanceRepo: {
      getLatestManifestSignedEvent: () => opts.event,
    },
  };
}

describe('exportManifest (PROV-V-07)', () => {
  let outputsDir: string;

  beforeEach(async () => {
    outputsDir = await mkdtemp(join(tmpdir(), 'vfx-export-test-'));
  });

  afterEach(async () => {
    try {
      await rm(outputsDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('Test 1 — outputs_json null → manifest_status absent (does not throw)', async () => {
    const stubs = stubRepos({ version: makeStubVersion(null), event: null });
    const result = await exportManifest(
      VERSION_ID,
      stubs.versionRepo,
      stubs.provenanceRepo,
      outputsDir,
    );
    expect(result).toEqual<ExporterResult>({
      format: '',
      signed_at: null,
      manifest_bytes_base64: null,
      manifest_status: 'absent',
      cert_subject: null,
      ingredients_summary: null,
    });
  });

  it('Test 1b — outputs_json empty array → absent', async () => {
    const stubs = stubRepos({ version: makeStubVersion('[]'), event: null });
    const result = await exportManifest(
      VERSION_ID,
      stubs.versionRepo,
      stubs.provenanceRepo,
      outputsDir,
    );
    expect(result.manifest_status).toBe('absent');
    expect(result.manifest_bytes_base64).toBeNull();
  });

  it('Test 2 — signed=true + disk file present → manifest_status present + base64 round-trip', async () => {
    // Arrange — write the PNG fixture into outputsDir/<versionId>/<filename>
    const verDir = join(outputsDir, VERSION_ID);
    await mkdir(verDir, { recursive: true });
    await writeFile(join(verDir, FILENAME), PNG_FIXTURE);

    const event: ManifestSignedPayloadFields = {
      filename: FILENAME,
      format: 'image/png',
      signed: true,
      cert_subject_summary: 'CN=test-cert',
      signed_at: '2026-04-30T12:00:00.000Z',
      status_reason: '',
      algorithm: 'Es256',
      manifest_sha256: 'deadbeef',
      ingredients_summary: {
        parent_count: 1,
        component_count: 2,
        input_assertion: true,
        unavailable_count: 0,
      },
    };
    const outputsJson = JSON.stringify([{ filename: FILENAME }]);
    const stubs = stubRepos({ version: makeStubVersion(outputsJson), event });

    // Act
    const result = await exportManifest(
      VERSION_ID,
      stubs.versionRepo,
      stubs.provenanceRepo,
      outputsDir,
    );

    // Assert
    expect(result.manifest_status).toBe('present');
    expect(result.format).toBe('image/png');
    expect(result.signed_at).toBe('2026-04-30T12:00:00.000Z');
    expect(result.cert_subject).toBe('CN=test-cert');
    expect(result.ingredients_summary).toEqual({
      parent_count: 1,
      component_count: 2,
      input_assertion: true,
      unavailable_count: 0,
    });
    // base64 round-trip — decoded bytes must equal disk bytes byte-identically
    expect(result.manifest_bytes_base64).not.toBeNull();
    const decoded = Buffer.from(result.manifest_bytes_base64!, 'base64');
    expect(decoded.equals(PNG_FIXTURE)).toBe(true);
  });

  it('Test 3 — signed=false + status_reason=unsupported_format → manifest_status unsupported_format (no disk read)', async () => {
    // Note: deliberately do NOT write a disk file; the path should NOT be touched.
    const event: ManifestSignedPayloadFields = {
      filename: FILENAME,
      format: 'image/x-exr',
      signed: false,
      cert_subject_summary: '',
      signed_at: '2026-04-30T12:00:00.000Z',
      status_reason: 'unsupported_format',
      algorithm: '',
    };
    const outputsJson = JSON.stringify([{ filename: FILENAME }]);
    const stubs = stubRepos({ version: makeStubVersion(outputsJson), event });
    const result = await exportManifest(
      VERSION_ID,
      stubs.versionRepo,
      stubs.provenanceRepo,
      outputsDir,
    );
    expect(result.manifest_status).toBe('unsupported_format');
    expect(result.format).toBe('image/x-exr');
    expect(result.signed_at).toBe('2026-04-30T12:00:00.000Z');
    expect(result.manifest_bytes_base64).toBeNull();
    expect(result.cert_subject).toBeNull();
    expect(result.ingredients_summary).toBeNull();
  });

  it('Test 4 — signed=false + status_reason=signing_disabled → absent', async () => {
    const event: ManifestSignedPayloadFields = {
      filename: FILENAME,
      format: 'image/png',
      signed: false,
      cert_subject_summary: '',
      signed_at: '2026-04-30T12:00:00.000Z',
      status_reason: 'signing_disabled',
      algorithm: '',
    };
    const outputsJson = JSON.stringify([{ filename: FILENAME }]);
    const stubs = stubRepos({ version: makeStubVersion(outputsJson), event });
    const result = await exportManifest(
      VERSION_ID,
      stubs.versionRepo,
      stubs.provenanceRepo,
      outputsDir,
    );
    expect(result.manifest_status).toBe('absent');
    expect(result.manifest_bytes_base64).toBeNull();
    expect(result.cert_subject).toBeNull();
  });

  it('Test 4b — signed=false + status_reason=sign_call_failed → absent', async () => {
    const event: ManifestSignedPayloadFields = {
      filename: FILENAME,
      format: 'image/png',
      signed: false,
      cert_subject_summary: 'CN=test-cert',
      signed_at: '2026-04-30T12:00:00.000Z',
      status_reason: 'sign_call_failed',
      algorithm: 'Es256',
    };
    const outputsJson = JSON.stringify([{ filename: FILENAME }]);
    const stubs = stubRepos({ version: makeStubVersion(outputsJson), event });
    const result = await exportManifest(
      VERSION_ID,
      stubs.versionRepo,
      stubs.provenanceRepo,
      outputsDir,
    );
    expect(result.manifest_status).toBe('absent');
  });

  it('Test 5 — signed=true but disk file missing (ENOENT) → absent (graceful-fail)', async () => {
    // Note: outputsDir/<versionId>/<filename> never written.
    const event: ManifestSignedPayloadFields = {
      filename: FILENAME,
      format: 'image/png',
      signed: true,
      cert_subject_summary: 'CN=test-cert',
      signed_at: '2026-04-30T12:00:00.000Z',
      status_reason: '',
      algorithm: 'Es256',
    };
    const outputsJson = JSON.stringify([{ filename: FILENAME }]);
    const stubs = stubRepos({ version: makeStubVersion(outputsJson), event });
    const result = await exportManifest(
      VERSION_ID,
      stubs.versionRepo,
      stubs.provenanceRepo,
      outputsDir,
    );
    expect(result.manifest_status).toBe('absent');
    expect(result.manifest_bytes_base64).toBeNull();
  });

  it('Test 6a — filename containing .. → throws EXPORT_PATH_TRAVERSAL_REJECTED', async () => {
    const outputsJson = JSON.stringify([{ filename: '../etc/passwd' }]);
    const stubs = stubRepos({ version: makeStubVersion(outputsJson), event: null });
    await expect(
      exportManifest(VERSION_ID, stubs.versionRepo, stubs.provenanceRepo, outputsDir),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'EXPORT_PATH_TRAVERSAL_REJECTED',
    });
  });

  it('Test 6b — filename containing forward slash → throws EXPORT_PATH_TRAVERSAL_REJECTED', async () => {
    const outputsJson = JSON.stringify([{ filename: 'dir/sub.png' }]);
    const stubs = stubRepos({ version: makeStubVersion(outputsJson), event: null });
    await expect(
      exportManifest(VERSION_ID, stubs.versionRepo, stubs.provenanceRepo, outputsDir),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'EXPORT_PATH_TRAVERSAL_REJECTED',
    });
  });

  it('Test 6c — filename containing backslash → throws EXPORT_PATH_TRAVERSAL_REJECTED', async () => {
    const outputsJson = JSON.stringify([{ filename: '\\windows\\system32\\foo.png' }]);
    const stubs = stubRepos({ version: makeStubVersion(outputsJson), event: null });
    await expect(
      exportManifest(VERSION_ID, stubs.versionRepo, stubs.provenanceRepo, outputsDir),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'EXPORT_PATH_TRAVERSAL_REJECTED',
    });
  });

  it('Test 7 — version row missing → throws VERSION_NOT_FOUND', async () => {
    const stubs = stubRepos({ version: null, event: null });
    await expect(
      exportManifest(VERSION_ID, stubs.versionRepo, stubs.provenanceRepo, outputsDir),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'VERSION_NOT_FOUND',
    });
  });

  it('Test 8 — pre-Phase-15 row (ingredients_summary undefined) → result.ingredients_summary is null', async () => {
    const verDir = join(outputsDir, VERSION_ID);
    await mkdir(verDir, { recursive: true });
    await writeFile(join(verDir, FILENAME), PNG_FIXTURE);

    const event: ManifestSignedPayloadFields = {
      filename: FILENAME,
      format: 'image/png',
      signed: true,
      cert_subject_summary: 'CN=test-cert',
      signed_at: '2026-04-30T12:00:00.000Z',
      status_reason: '',
      algorithm: 'Es256',
      // ingredients_summary intentionally undefined (pre-Phase-15 row shape)
    };
    const outputsJson = JSON.stringify([{ filename: FILENAME }]);
    const stubs = stubRepos({ version: makeStubVersion(outputsJson), event });
    const result = await exportManifest(
      VERSION_ID,
      stubs.versionRepo,
      stubs.provenanceRepo,
      outputsDir,
    );
    expect(result.manifest_status).toBe('present');
    expect(result.ingredients_summary).toBeNull();
  });

  it('Test 9 — present result has cert_subject as a STRING (the cert_subject_summary)', async () => {
    const verDir = join(outputsDir, VERSION_ID);
    await mkdir(verDir, { recursive: true });
    await writeFile(join(verDir, FILENAME), PNG_FIXTURE);

    const event: ManifestSignedPayloadFields = {
      filename: FILENAME,
      format: 'image/png',
      signed: true,
      cert_subject_summary: 'CN=Issuer X',
      signed_at: '2026-04-30T12:00:00.000Z',
      status_reason: '',
      algorithm: 'Es256',
    };
    const outputsJson = JSON.stringify([{ filename: FILENAME }]);
    const stubs = stubRepos({ version: makeStubVersion(outputsJson), event });
    const result = await exportManifest(
      VERSION_ID,
      stubs.versionRepo,
      stubs.provenanceRepo,
      outputsDir,
    );
    expect(result.cert_subject).toBe('CN=Issuer X');
    expect(typeof result.cert_subject).toBe('string');
  });

  it('Test 10 — idempotent: two calls with same args produce deep-equal results', async () => {
    const verDir = join(outputsDir, VERSION_ID);
    await mkdir(verDir, { recursive: true });
    await writeFile(join(verDir, FILENAME), PNG_FIXTURE);

    const event: ManifestSignedPayloadFields = {
      filename: FILENAME,
      format: 'image/png',
      signed: true,
      cert_subject_summary: 'CN=test',
      signed_at: '2026-04-30T12:00:00.000Z',
      status_reason: '',
      algorithm: 'Es256',
      ingredients_summary: {
        parent_count: 0,
        component_count: 1,
        input_assertion: true,
        unavailable_count: 0,
      },
    };
    const outputsJson = JSON.stringify([{ filename: FILENAME }]);
    const stubs = stubRepos({ version: makeStubVersion(outputsJson), event });

    const r1 = await exportManifest(
      VERSION_ID,
      stubs.versionRepo,
      stubs.provenanceRepo,
      outputsDir,
    );
    const r2 = await exportManifest(
      VERSION_ID,
      stubs.versionRepo,
      stubs.provenanceRepo,
      outputsDir,
    );
    expect(r1).toEqual(r2);
  });

  it('Test 11 — TypedError shape for path traversal carries actionable hint', () => {
    // Construct manually since we have no async path here — assertion is
    // structural to confirm the new ErrorCode + hint thread through.
    const err = new TypedError('EXPORT_PATH_TRAVERSAL_REJECTED', 'msg', 'a hint');
    expect(err.code).toBe('EXPORT_PATH_TRAVERSAL_REJECTED');
    expect(err.hint).toBe('a hint');
  });

  it('Test 12 — outputs_json malformed (parse error) → absent (does not throw)', async () => {
    const stubs = stubRepos({
      version: makeStubVersion('not json {{{'),
      event: null,
    });
    const result = await exportManifest(
      VERSION_ID,
      stubs.versionRepo,
      stubs.provenanceRepo,
      outputsDir,
    );
    expect(result.manifest_status).toBe('absent');
  });
});
