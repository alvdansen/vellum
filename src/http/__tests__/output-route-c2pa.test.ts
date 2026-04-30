// Phase 14 Plan 04 Task 1: GET /api/versions/:id/output — X-C2PA-Signing-Status
// response header tests.
//
// The Plan 14-03 downloader hook signs files at write-time; the HTTP route in
// Plan 14-04 does NOT re-sign. It streams the file from disk and reads the
// latest manifest_signed event for header values. T-14-10 mitigation: the
// route's body bytes / Content-Type / Cache-Control are byte-identical to the
// pre-Phase-14 baseline; X-C2PA-Signing-Status is purely additive.
//
// Header value matrix (Plan 14-04):
//   - 'signed'                               — manifest_signed event has signed=true
//   - 'unsigned:<status_reason>'             — manifest_signed event has signed=false
//   - 'unknown'                              — no manifest_signed event for the version+filename
//
// HEAD request returns the same header without the body (for the dashboard's
// lightweight status check via the new packages/dashboard/src/lib/api.ts
// getC2paStatus helper).
//
// Architecture purity: this file does NOT import c2pa-node directly. The
// FakeEngine satisfies the EngineForDashboard structural pick (Plan 14-04
// extends it with getC2paStatusForVersion).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FakeEngine } from '../../test-utils/fake-engine.js';
import { createDashboardRouter } from '../dashboard-routes.js';
import { typedErrorHandler } from '../error-middleware.js';
import type { ManifestSignedPayloadFields } from '../../types/provenance.js';

// ---- FS fixture helpers (mirror dashboard-routes.test.ts) ----
const TEST_VERSION_IDS = new Set<string>();

function writeTestOutput(
  versionId: string,
  filename: string,
  content?: Buffer,
): string {
  const dir = join('outputs', versionId);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, filename);
  writeFileSync(p, content ?? Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  TEST_VERSION_IDS.add(versionId);
  return p;
}

function cleanupTestOutputs(): void {
  for (const id of TEST_VERSION_IDS) {
    const dir = join('outputs', id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  TEST_VERSION_IDS.clear();
}

function buildApp(engine: FakeEngine): Hono {
  const app = new Hono();
  app.onError(typedErrorHandler);
  const router = createDashboardRouter(engine as never);
  app.route('/', router);
  return app;
}

/** Seed a version envelope on FakeEngine + write a corresponding fs output. */
function seedVersionWithOutput(
  engine: FakeEngine,
  versionId: string,
  filename: string,
  content?: Buffer,
): void {
  engine.cans.versions.set(versionId, {
    entity: {
      id: versionId,
      shot_id: 'shot_1',
      version_number: 1,
      status: 'completed',
      job_id: null,
      parent_version_id: null,
      notes: null,
      created_at: 0,
      completed_at: null,
      error_code: null,
      error_message: null,
      outputs_json: JSON.stringify([{ filename }]),
      lineage_type: null,
      reproduction_warnings_json: null,
      tags: [],
      metadata: [],
    },
    breadcrumb: { entries: [], text: '' },
  });
  writeTestOutput(versionId, filename, content);
}

/**
 * Extend a FakeEngine instance with a stub `getC2paStatusForVersion` accessor
 * so the route can read it without instantiating a real Engine + DB. The
 * EngineForDashboard structural pick now includes getC2paStatusForVersion
 * (Plan 14-04 extension).
 */
function withC2paStatus(
  engine: FakeEngine,
  stub: (versionId: string, filename: string) => ManifestSignedPayloadFields | null,
): FakeEngine {
  // FakeEngine doesn't yet declare this method — assign at runtime; tests that
  // exercise the header path provide their own stub. The structural Pick at
  // dashboard-routes.ts widens to accept this property.
  (engine as unknown as {
    getC2paStatusForVersion: (id: string, filename: string) => ManifestSignedPayloadFields | null;
  }).getC2paStatusForVersion = stub;
  return engine;
}

/** Build a signed payload fixture (signed=true). */
function signedPayload(filename: string): ManifestSignedPayloadFields {
  return {
    filename,
    format: 'image/png',
    signed: true,
    cert_subject_summary: 'CN=VFX Familiar Dev',
    signed_at: '2026-04-30T12:00:00.000Z',
    status_reason: '',
    algorithm: 'es256',
  };
}

/** Build an unsigned payload fixture (signed=false) with the given reason. */
function unsignedPayload(filename: string, reason: string): ManifestSignedPayloadFields {
  return {
    filename,
    format: '',
    signed: false,
    cert_subject_summary: '',
    signed_at: '2026-04-30T12:00:00.000Z',
    status_reason: reason,
    algorithm: '',
  };
}

describe('GET /api/versions/:id/output — X-C2PA-Signing-Status header (Plan 14-04 Task 1)', () => {
  let engine: FakeEngine;

  beforeEach(() => {
    engine = new FakeEngine();
    engine.reset();
  });

  afterEach(() => {
    cleanupTestOutputs();
  });

  // -------- Test 1: signed=true -> 'signed' --------
  it("Test 1: sets X-C2PA-Signing-Status='signed' when manifest_signed event has signed=true", async () => {
    seedVersionWithOutput(engine, 'ver_signed', 'out.png');
    withC2paStatus(engine, (_v, f) => signedPayload(f));
    const app = buildApp(engine);
    const res = await app.request('/api/versions/ver_signed/output');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-C2PA-Signing-Status')).toBe('signed');
    // Body bytes must be byte-identical to the source file (T-14-10 mitigation).
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  // -------- Test 2: signed=false / signing_disabled -------
  it("Test 2: sets header to 'unsigned:signing_disabled' for signing_disabled reason", async () => {
    seedVersionWithOutput(engine, 'ver_disabled', 'out.png');
    withC2paStatus(engine, (_v, f) => unsignedPayload(f, 'signing_disabled'));
    const app = buildApp(engine);
    const res = await app.request('/api/versions/ver_disabled/output');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-C2PA-Signing-Status')).toBe('unsigned:signing_disabled');
  });

  // -------- Test 3: signed=false / unsupported_format -------
  it("Test 3: sets header to 'unsigned:unsupported_format' for unsupported_format reason (EXR/PSD/unknown)", async () => {
    seedVersionWithOutput(engine, 'ver_unsup', 'out.exr');
    withC2paStatus(engine, (_v, f) => unsignedPayload(f, 'unsupported_format'));
    const app = buildApp(engine);
    const res = await app.request('/api/versions/ver_unsup/output');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-C2PA-Signing-Status')).toBe('unsigned:unsupported_format');
  });

  // -------- Test 4: signed=false / sign_call_failed -------
  it("Test 4: sets header to 'unsigned:sign_call_failed' for sign_call_failed reason", async () => {
    seedVersionWithOutput(engine, 'ver_signfail', 'out.png');
    withC2paStatus(engine, (_v, f) => unsignedPayload(f, 'sign_call_failed'));
    const app = buildApp(engine);
    const res = await app.request('/api/versions/ver_signfail/output');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-C2PA-Signing-Status')).toBe('unsigned:sign_call_failed');
  });

  // -------- Test 5: signed=false / cert_load_failed -------
  it("Test 5: sets header to 'unsigned:cert_load_failed' for cert_load_failed reason", async () => {
    seedVersionWithOutput(engine, 'ver_certfail', 'out.png');
    withC2paStatus(engine, (_v, f) => unsignedPayload(f, 'cert_load_failed'));
    const app = buildApp(engine);
    const res = await app.request('/api/versions/ver_certfail/output');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-C2PA-Signing-Status')).toBe('unsigned:cert_load_failed');
  });

  // -------- Test 6: signed=false / native_binding_unavailable -------
  it("Test 6: sets header to 'unsigned:native_binding_unavailable' for native_binding_unavailable reason", async () => {
    seedVersionWithOutput(engine, 'ver_nobind', 'out.png');
    withC2paStatus(engine, (_v, f) => unsignedPayload(f, 'native_binding_unavailable'));
    const app = buildApp(engine);
    const res = await app.request('/api/versions/ver_nobind/output');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-C2PA-Signing-Status')).toBe('unsigned:native_binding_unavailable');
  });

  // -------- Test 7: no manifest_signed event -> 'unknown' --------
  it("Test 7: sets header to 'unknown' when no manifest_signed event exists yet", async () => {
    seedVersionWithOutput(engine, 'ver_unknown', 'out.png');
    withC2paStatus(engine, () => null); // no event yet (legacy / pre-Phase-14 / download in progress)
    const app = buildApp(engine);
    const res = await app.request('/api/versions/ver_unknown/output');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-C2PA-Signing-Status')).toBe('unknown');
  });

  // -------- Test 8: T-14-10 mitigation — body bytes / Content-Type / Cache-Control unchanged --------
  it('Test 8: T-14-10 — body bytes + Content-Type + Cache-Control are byte-identical to pre-Phase-14 baseline', async () => {
    const fixedBody = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic + signature head
    seedVersionWithOutput(engine, 'ver_baseline', 'out.png', fixedBody);
    withC2paStatus(engine, (_v, f) => signedPayload(f));
    const app = buildApp(engine);
    const res = await app.request('/api/versions/ver_baseline/output');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, immutable');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf)).toEqual(Array.from(fixedBody));
    // X-C2PA-Signing-Status is purely additive — pre-Phase-14 callers ignore it.
    expect(res.headers.get('X-C2PA-Signing-Status')).toBe('signed');
  });

  // -------- Test 9: HEAD request -- same header, no body --------
  it('Test 9: HEAD request returns same X-C2PA-Signing-Status header without body', async () => {
    seedVersionWithOutput(engine, 'ver_head', 'out.png');
    withC2paStatus(engine, (_v, f) => signedPayload(f));
    const app = buildApp(engine);
    const res = await app.request('/api/versions/ver_head/output', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-C2PA-Signing-Status')).toBe('signed');
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, immutable');
    // HEAD: no body bytes regardless of underlying file size.
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.byteLength).toBe(0);
  });

  // -------- Bonus: HEAD on unsigned reason flows through too --------
  it('Test 9b: HEAD request reflects unsigned:<reason> header value', async () => {
    seedVersionWithOutput(engine, 'ver_head_unsup', 'out.exr');
    withC2paStatus(engine, (_v, f) => unsignedPayload(f, 'unsupported_format'));
    const app = buildApp(engine);
    const res = await app.request('/api/versions/ver_head_unsup/output', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-C2PA-Signing-Status')).toBe('unsigned:unsupported_format');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.byteLength).toBe(0);
  });

  // -------- Bonus: HEAD on missing manifest event -> 'unknown' --------
  it('Test 9c: HEAD request reflects unknown header value when no event recorded', async () => {
    seedVersionWithOutput(engine, 'ver_head_unknown', 'out.png');
    withC2paStatus(engine, () => null);
    const app = buildApp(engine);
    const res = await app.request('/api/versions/ver_head_unknown/output', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-C2PA-Signing-Status')).toBe('unknown');
  });
});
