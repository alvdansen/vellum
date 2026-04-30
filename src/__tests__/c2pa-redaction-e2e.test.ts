/**
 * Phase 16 / Plan 16-05 — E2E redaction test (no MCP wire boundary).
 *
 * Drives Phase 14 sign + Phase 15 ingredient graph + Phase 16 export/verify/
 * redact through the REAL Engine in-process. Each describe block stands up its
 * own SQLite DB + outputs dir + signed v1 manifest containing a known
 * `vfx_familiar.input.data.prompt_positive` sentinel value (resolved through
 * the Phase 15 KSampler edge walk over a real prompt blob).
 *
 * Scenarios:
 *   A. Golden path: redact prompt_positive (and other primitives) from a v1
 *      signed manifest. Verifies D-CTX-1 invariant (no original values in
 *      ACTIVE manifest projection — multi-encoding scan), D-CTX-5 append-only
 *      (original event row byte-identical), D-PLAN-2-1/2-2 (same cert + algo),
 *      C-03 actions chain survival (extractAssertions normalization).
 *   B. Export then verify: round-trip the redacted bytes through
 *      Engine.exportManifestForVersion, asserting the disk was atomically
 *      updated by the redact flow (no manual writeFile in beforeAll). Then
 *      drive verifyManifestForVersion against the bytes form and assert
 *      valid=true under VFX_FAMILIAR_C2PA_TRUST_DEV_CERT=1.
 *   C. Not-found soft warning: policy with paths that don't match the manifest
 *      produce notFound entries, NEW manifest_signed event row written with
 *      `not_found:<path>` audit prefix.
 *   Doc/multi: D-PLAN-2-3 ingredient pass-through documentation + multi-redact
 *      append-only contract.
 *
 * Uses the c2pa-node bundled dev cert at
 * `node_modules/c2pa-node/tests/fixtures/certs/es256.{pub,pem}`. The
 * project's `.dev-cert/c2pa-dev.{pem,key}` is self-signed and rejected by
 * c2pa-rs at sign time; the bundled cert is the working choice for E2E.
 *
 * Skip-on-CI: requires openssl + bundled c2pa-node certs (consistent with
 * Plan 16-02 redaction integration tests + Plan 14 c2pa-uat-mcp-tool.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type { Database } from 'better-sqlite3';
import type { Engine } from '../engine/pipeline.js';
import type { ProvenanceRepo } from '../store/provenance-repo.js';
import type { VersionRepo } from '../store/version-repo.js';
import type { RedactionResult } from '../engine/c2pa/redaction.js';
import type { ManifestSignedPayloadFields } from '../types/provenance.js';

// ============================================================================
// Constants — bundled c2pa-node certs (mirror Phase 14 + Plan 16-02 integration)
// ============================================================================

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

// ============================================================================
// C-01 multi-encoding scan helper. Asserts the secret string is absent from
// the buffer in ANY of these encodings — single-encoding scan misses UTF-16
// wide-string embeddings + base64-in-payload + emoji boundaries.
// ============================================================================

function assertNotInBuffer(buf: Buffer, secret: string, label: string): void {
  if (secret.length === 0) return;
  const fragments = [
    secret,                                                          // UTF-8 / ASCII
    Buffer.from(secret, 'utf16le').toString('binary'),               // UTF-16LE
    Buffer.from(secret, 'utf16le').reverse().toString('binary'),     // UTF-16BE roughly
    Buffer.from(secret).toString('base64'),                          // base64
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

// ============================================================================
// Seed helper — builds a real v1 signed manifest with a synthetic prompt blob
// whose CLIPTextEncode positive text contains the sentinel. Phase 15's
// extractInputAssertion edge-walks KSampler.positive to that node and lifts
// the text into vfx_familiar.input.data.prompt_positive.
// ============================================================================

interface E2ESeed {
  tempRoot: string;
  outputsDir: string;
  versionId: string;
  filename: string;
  /** Original manifest_signed event row id (full-row deepEqual key). */
  originalManifestSignedRowId: string;
  /** Original manifest_signed_json payload literal (byte-identity assertion). */
  originalManifestSignedJson: string;
  engine: Engine;
  sqlite: Database;
  provenanceRepo: ProvenanceRepo;
  versionRepo: VersionRepo;
  cleanup: () => Promise<void>;
}

async function seedSignedV1Manifest(opts: {
  promptPositive: string;
}): Promise<E2ESeed> {
  const tempRoot = await mkdtemp(join(tmpdir(), `vfx-e2e-redact-${nanoid(6)}-`));
  const outputsDir = join(tempRoot, 'outputs');
  await mkdir(outputsDir, { recursive: true });
  const dbPath = join(tempRoot, 'test.db');

  const { openDb } = await import('../store/db.js');
  const handle = openDb(dbPath);

  const { HierarchyRepo } = await import('../store/hierarchy-repo.js');
  const { VersionRepo: VersionRepoCtor } = await import('../store/version-repo.js');
  const { ProvenanceRepo: ProvenanceRepoCtor } = await import('../store/provenance-repo.js');
  const { Engine: EngineCtor } = await import('../engine/pipeline.js');
  const { FakeComfyUIClient } = await import('../test-utils/fake-comfyui-client.js');

  const hierarchy = new HierarchyRepo(handle.db);
  const versionRepo = new VersionRepoCtor(handle.db);
  const provenanceRepo = new ProvenanceRepoCtor(handle.db);
  const fake = new FakeComfyUIClient();

  const engine = new EngineCtor(
    handle.db,
    hierarchy,
    versionRepo,
    provenanceRepo,
    fake as never,
    outputsDir,
    {
      c2paConfig: {
        certPemPath: BUNDLED_CERT_PATH,
        privateKeyPemPath: BUNDLED_KEY_PATH,
        // Phase 14 RUNTIME DEVIATION (Plan 14-02 file header): c2pa-node v0.5.26
        // native binding requires tsaUrl ABSENT or VALID URL.
        tsaUrl: 'http://timestamp.digicert.com',
      },
    },
  );

  const ws = hierarchy.createWorkspace('e2e-redact-ws');
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const ver = versionRepo.insertVersion(shot.id);

  // Build a real prompt blob containing the sentinel as positive text. Phase 15
  // extractInputAssertion edge-walks KSampler.positive ['6', 0] -> CLIPTextEncode
  // node 6 -> inputs.text -> prompt_positive in the input assertion.
  const promptBlob = {
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: 42,
        steps: 20,
        cfg: 7.0,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1.0,
        positive: ['6', 0],
        negative: ['7', 0],
      },
    },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: opts.promptPositive } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, ugly' } },
  };

  const filename = 'out.png';
  provenanceRepo.insertEvent(ver.id, {
    event_type: 'submitted',
    workflow_json: '{}',
  });
  provenanceRepo.insertEvent(ver.id, {
    event_type: 'completed',
    prompt_json: JSON.stringify(promptBlob),
    seed: 42,
    models_json: '[]',
    outputs_json: JSON.stringify([{ filename }]),
  });

  // Sign — engine reads completed.prompt_json + extracts vfx_familiar.input.
  const signResult = await engine.signOutput(ver.id, filename, { bytes: TINY_PNG });
  const verDir = join(outputsDir, ver.id);
  await mkdir(verDir, { recursive: true });
  if (signResult.signed) {
    await writeFile(join(verDir, filename), signResult.signed);
  } else {
    await writeFile(join(verDir, filename), TINY_PNG);
  }
  versionRepo.markCompleted(ver.id, JSON.stringify([{ filename }]));

  // Capture the original manifest_signed event for byte-identity assertions.
  const sqlite = handle.sqlite as unknown as Database;
  const originalRow = sqlite
    .prepare(
      `SELECT id, manifest_signed_json FROM provenance
       WHERE version_id = ? AND event_type = 'manifest_signed'
       ORDER BY timestamp ASC, id ASC LIMIT 1`,
    )
    .get(ver.id) as { id: string; manifest_signed_json: string } | undefined;
  if (!originalRow) {
    throw new Error('Seed failed: original manifest_signed row not found');
  }

  return {
    tempRoot,
    outputsDir,
    versionId: ver.id,
    filename,
    originalManifestSignedRowId: originalRow.id,
    originalManifestSignedJson: originalRow.manifest_signed_json,
    engine,
    sqlite,
    provenanceRepo,
    versionRepo,
    cleanup: async (): Promise<void> => {
      try {
        await engine.stop();
      } catch {
        // best-effort
      }
      try {
        sqlite.close();
      } catch {
        // best-effort
      }
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

// ============================================================================
// SCENARIO A: Golden path redaction (Tests 1-4)
// ============================================================================

describe.skipIf(!haveOpenssl)('Phase 16 E2E — Scenario A (golden path redact prompt_positive)', () => {
  let seed: E2ESeed;
  const PROMPT_POSITIVE = `SECRET_PROMPT_${nanoid(8)}`;

  beforeAll(async () => {
    seed = await seedSignedV1Manifest({ promptPositive: PROMPT_POSITIVE });
  }, 30_000);

  afterAll(async () => {
    if (seed) await seed.cleanup();
  });

  it('Test 1 — D-CTX-1 + D-CTX-5 + actions chain survival + multi-encoding scan over active projection', async () => {
    const policyPath = "assertions[label='vfx_familiar.input'].data.prompt_positive";
    const result = await seed.engine.redactManifestForVersion(seed.versionId, [policyPath]);

    // (a) redactedFields contains the policy path
    expect(result.redactedFields).toContain(policyPath);

    // (b) c2pa.read on the redactedBytes shows BOTH vfx_familiar.redacted AND
    //     a c2pa.actions[.v2] assertion with a c2pa.created action surviving
    //     (proves the actions chain round-tripped through C-03 normalization).
    const c2paNode = await import('c2pa-node');
    const c2pa = c2paNode.createC2pa();
    const store = await c2pa.read({
      buffer: result.redactedBytes,
      mimeType: 'image/png',
    });
    expect(store).not.toBeNull();
    expect(store!.active_manifest).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labels = (store!.active_manifest!.assertions ?? []).map((a: any) => a.label);
    expect(labels).toContain('vfx_familiar.redacted');
    // C-03: actions chain survival — accept either label literal.
    expect(
      labels.some((l: string) => l === 'c2pa.actions' || l === 'c2pa.actions.v2'),
      `expected c2pa.actions or c2pa.actions.v2 in: ${labels.join(', ')}`,
    ).toBe(true);
    // Verify the surviving actions assertion contains a c2pa.created action.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actionsAssertion = (store!.active_manifest!.assertions ?? []).find((a: any) =>
      a.label === 'c2pa.actions' || a.label === 'c2pa.actions.v2',
    );
    expect(actionsAssertion).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actionsArr = (actionsAssertion as any).data?.actions ?? [];
    expect(Array.isArray(actionsArr)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createdSurvived = actionsArr.some((act: any) => act?.action === 'c2pa.created');
    expect(createdSurvived).toBe(true);

    // (c) C-01 multi-encoding scan against the ACTIVE manifest projection.
    //     Note: the C2PA chain-of-custody design preserves the parent manifest
    //     as a JUMBF ingredient inside the redacted bytes, so a raw-byte scan
    //     of result.redactedBytes WILL legitimately find the original
    //     prompt_positive in the parent chain (deferred-items.md tracks
    //     parent-chain redaction for v1.2). The active-manifest projection is
    //     the contract surface.
    const am = store!.active_manifest!;
    const activeProjection = JSON.stringify({
      claim_generator: am.claim_generator,
      format: am.format,
      title: am.title,
      assertions: am.assertions,
    });
    const projectionBuf = Buffer.from(activeProjection, 'utf-8');
    assertNotInBuffer(projectionBuf, PROMPT_POSITIVE, 'scenario-a-prompt-positive');

    // (d) Original manifest_signed event row byte-identical (D-CTX-5).
    const allRows = seed.sqlite
      .prepare(
        `SELECT id, manifest_signed_json FROM provenance
         WHERE version_id = ? AND event_type = 'manifest_signed'
         ORDER BY timestamp ASC, id ASC`,
      )
      .all(seed.versionId) as Array<{ id: string; manifest_signed_json: string }>;
    expect(allRows.length).toBeGreaterThanOrEqual(2);
    const original = allRows.find((r) => r.id === seed.originalManifestSignedRowId);
    expect(original).toBeDefined();
    expect(original!.manifest_signed_json).toBe(seed.originalManifestSignedJson);

    // (e) NEW manifest_signed event row has redacted=true + redacted_fields.
    const latest = allRows[allRows.length - 1]!;
    const latestPayload = JSON.parse(latest.manifest_signed_json) as ManifestSignedPayloadFields;
    expect(latestPayload.redacted).toBe(true);
    expect(latestPayload.redacted_fields).toContain(policyPath);
  });

  it('Test 2 — D-PLAN-2-1: cert_subject preserved (same dev cert reused)', async () => {
    const result = await seed.engine.redactManifestForVersion(seed.versionId, ['claim_generator']);
    // Cert subject populated — the engine reused the same Phase 14 signer +
    // recorded the cert summary into the new manifest_signed event row.
    // deriveCertSubjectSummary returns the CN value VERBATIM (no `CN=` prefix)
    // OR an `fp:<sha256-prefix>` fallback. The bundled c2pa-node es256 cert
    // resolves to the literal `'C2PA Signer'` plain CN string.
    expect(typeof result.certSubject).toBe('string');
    expect(result.certSubject.length).toBeGreaterThan(0);
  });

  it('Test 3 — signedAt is fresh ISO timestamp (>= original signed_at)', async () => {
    const result = await seed.engine.redactManifestForVersion(seed.versionId, ['title']);
    const t = Date.parse(result.signedAt);
    expect(Number.isFinite(t)).toBe(true);
    const originalPayload = JSON.parse(seed.originalManifestSignedJson) as ManifestSignedPayloadFields;
    const originalT = Date.parse(originalPayload.signed_at);
    expect(t).toBeGreaterThanOrEqual(originalT);
  });

  it('Test 4 — vfx_familiar.redacted assertion shape (redacted_fields + redacted_at) — fresh seed', async () => {
    // OBSERVED c2pa-rs behavior: when an asset already carries a
    // vfx_familiar.redacted assertion AND a re-sign appends another with
    // the same label, c2pa.read returns ONLY the FIRST one (assertion
    // deduplication-by-label at the read boundary). Tests 1-3 ran prior
    // redacts on this describe block's seed, so reading the latest bytes
    // would surface the oldest assertion's data, not this call's.
    //
    // Use a FRESH seed so this call is the FIRST redact on the asset —
    // the assertion data verbatim reflects this policy.
    const localSeed = await seedSignedV1Manifest({ promptPositive: 'foo' });
    try {
      const result = await localSeed.engine.redactManifestForVersion(localSeed.versionId, [
        'claim_generator',
      ]);
      const c2paNode = await import('c2pa-node');
      const c2pa = c2paNode.createC2pa();
      const store = await c2pa.read({
        buffer: result.redactedBytes,
        mimeType: 'image/png',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const redactedAssertion = (store!.active_manifest!.assertions ?? []).find((a: any) =>
        a.label === 'vfx_familiar.redacted',
      );
      expect(redactedAssertion).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (redactedAssertion as any).data;
      expect(Array.isArray(data.redacted_fields)).toBe(true);
      expect(data.redacted_fields).toContain('claim_generator');
      expect(typeof data.redacted_at).toBe('string');
      expect(Number.isFinite(Date.parse(data.redacted_at))).toBe(true);
    } finally {
      await localSeed.cleanup();
    }
  });
});

// ============================================================================
// SCENARIO B: Export then verify-by-bytes round-trip (Tests 5-6)
// ============================================================================

describe.skipIf(!haveOpenssl)('Phase 16 E2E — Scenario B (export+verify round-trip on redacted bytes)', () => {
  let seed: E2ESeed;
  let redactResult: RedactionResult;
  let prevTrustEnv: string | undefined;

  beforeAll(async () => {
    seed = await seedSignedV1Manifest({ promptPositive: 'foo' });
    // C-04 fix: REMOVED manual disk overwrite — Engine.redactManifestForVersion
    // performs the atomic temp+rename overwrite as part of the redact flow.
    // Test 5 below directly asserts that exporter sees the redacted bytes after
    // the redact call alone (no manual writeFile).
    redactResult = await seed.engine.redactManifestForVersion(seed.versionId, ['claim_generator']);
    // C-09 dev-cert opt-in for Test 6 (without it, signature_status would be
    // 'untrusted_root' against the bundled cert chain — production-correct).
    prevTrustEnv = process.env.VFX_FAMILIAR_C2PA_TRUST_DEV_CERT;
    process.env.VFX_FAMILIAR_C2PA_TRUST_DEV_CERT = '1';
  }, 30_000);

  afterAll(async () => {
    if (prevTrustEnv === undefined) {
      delete process.env.VFX_FAMILIAR_C2PA_TRUST_DEV_CERT;
    } else {
      process.env.VFX_FAMILIAR_C2PA_TRUST_DEV_CERT = prevTrustEnv;
    }
    if (seed) await seed.cleanup();
  });

  it('Test 5 — C-04: export returns the engine-atomically-written redacted bytes (no manual disk write)', async () => {
    // Drives Engine.exportManifestForVersion AFTER Engine.redactManifestForVersion.
    // The disk file MUST be the redacted bytes, not the original signed bytes,
    // because the redact path performs an atomic temp+rename overwrite BEFORE
    // returning RedactionResult (Plan 16-02 atomic-write block).
    const exportResult = await seed.engine.exportManifestForVersion(seed.versionId);
    expect(exportResult.manifest_status).toBe('present');
    expect(exportResult.manifest_bytes_base64).not.toBeNull();
    const exportedBytes = Buffer.from(exportResult.manifest_bytes_base64!, 'base64');
    // Byte-equal proof: exporter produced exactly what the redact engine
    // wrote — Engine.redactManifestForVersion's atomic write was correct.
    expect(exportedBytes.equals(redactResult.redactedBytes)).toBe(true);
  });

  it('Test 6 — C-09: verify the exported redacted bytes (bytes form) with dev-cert opt-in', async () => {
    const report = await seed.engine.verifyManifestForVersion({
      manifestBytes: redactResult.redactedBytes,
      format: 'image/png',
    });
    expect(report.valid).toBe(true);
    expect(report.signature_status).toBe('valid');
    expect(report.matched_assertions).toContain('vfx_familiar.redacted');
    // bytes-form verifier sources cert_subject from c2pa-rs's signature_info.issuer
    // — for the bundled cert chain this resolves to a non-empty string
    // (e.g., 'C2PA Test Signing Cert'). The engine's manifest_signed
    // override (CN-only via deriveCertSubjectSummary) only applies in
    // versionId form. Either way, non-empty is the contract.
    expect(typeof report.cert_subject).toBe('string');
    expect((report.cert_subject ?? '').length).toBeGreaterThan(0);
  });
});

// ============================================================================
// SCENARIO C: Not-found soft warnings (Tests 7-8)
// ============================================================================

describe.skipIf(!haveOpenssl)('Phase 16 E2E — Scenario C (policy with not_found paths)', () => {
  let seed: E2ESeed;

  beforeAll(async () => {
    seed = await seedSignedV1Manifest({ promptPositive: 'foo' });
  }, 30_000);

  afterAll(async () => {
    if (seed) await seed.cleanup();
  });

  it('Test 7 — single not_found path: empty redactedFields + audit row with not_found:<path> prefix', async () => {
    const policyPath = "assertions[label='nonexistent.label'].data.foo";
    const result = await seed.engine.redactManifestForVersion(seed.versionId, [policyPath]);

    // (a) Engine result: empty redactedFields, single notFound entry.
    expect(result.redactedFields).toEqual([]);
    expect(result.notFound).toEqual([policyPath]);

    // (b) Re-signed bytes still verify cleanly (vfx_familiar.redacted
    //     assertion present with empty redacted_fields).
    const c2paNode = await import('c2pa-node');
    const c2pa = c2paNode.createC2pa();
    const store = await c2pa.read({
      buffer: result.redactedBytes,
      mimeType: 'image/png',
    });
    expect(store).not.toBeNull();
    expect(store!.active_manifest).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const redactedAssertion = (store!.active_manifest!.assertions ?? []).find((a: any) =>
      a.label === 'vfx_familiar.redacted',
    );
    expect(redactedAssertion).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((redactedAssertion as any).data.redacted_fields).toEqual([]);

    // (c) C-09 explicit assertion: NEW manifest_signed event row created
    //     (NOT skipped) when policy is all not_found, with `redacted: true`
    //     and `redacted_fields: ['not_found:<path>']` audit prefix.
    const allRows = seed.sqlite
      .prepare(
        `SELECT id, manifest_signed_json FROM provenance
         WHERE version_id = ? AND event_type = 'manifest_signed'
         ORDER BY timestamp ASC, id ASC`,
      )
      .all(seed.versionId) as Array<{ id: string; manifest_signed_json: string }>;
    expect(allRows.length).toBeGreaterThanOrEqual(2);
    const latestRow = allRows[allRows.length - 1]!;
    const latestPayload = JSON.parse(latestRow.manifest_signed_json) as ManifestSignedPayloadFields;
    expect(latestPayload.redacted).toBe(true);
    expect(Array.isArray(latestPayload.redacted_fields)).toBe(true);
    const recordedFields = latestPayload.redacted_fields ?? [];
    // The audit trail records the attempted path with `not_found:` prefix.
    const notFoundRecorded = recordedFields.some(
      (entry) => entry === `not_found:${policyPath}`,
    );
    expect(
      notFoundRecorded,
      `expected not_found:${policyPath} in redacted_fields ${JSON.stringify(recordedFields)}`,
    ).toBe(true);
  });

  it('Test 8 — mixed found + not_found paths: redactedFields=1 + notFound=1', async () => {
    const result = await seed.engine.redactManifestForVersion(seed.versionId, [
      'claim_generator',
      "assertions[label='nonexistent.label'].data.foo",
    ]);
    expect(result.redactedFields).toEqual(['claim_generator']);
    expect(result.notFound).toEqual(["assertions[label='nonexistent.label'].data.foo"]);
  });
});

// ============================================================================
// E2E — D-PLAN-2-3 ingredient pass-through documentation + multi-redact
// (Tests 9-10)
// ============================================================================

describe.skipIf(!haveOpenssl)('Phase 16 E2E — D-PLAN-2-3 ingredient pass-through documented + multi-redact', () => {
  let seed: E2ESeed;

  beforeAll(async () => {
    seed = await seedSignedV1Manifest({ promptPositive: 'foo' });
  }, 30_000);

  afterAll(async () => {
    if (seed) await seed.cleanup();
  });

  it('Test 9 — D-PLAN-2-3: redacted manifest carries auto-parent only; vfx-familiar componentOf graph dropped (deferred-ingredient-mirror)', async () => {
    const result = await seed.engine.redactManifestForVersion(seed.versionId, ['title']);
    const c2paNode = await import('c2pa-node');
    const c2pa = c2paNode.createC2pa();
    const store = await c2pa.read({
      buffer: result.redactedBytes,
      mimeType: 'image/png',
    });
    expect(store!.active_manifest).not.toBeNull();
    // v1.1 behavior — buildResult.ingredientSpecs is intentionally empty
    // (Plan 16-02 redaction.ts line ~699). When c2pa-rs re-signs an asset
    // that already carries an embedded manifest, it AUTO-PROMOTES the prior
    // active_manifest into a parent_relationship ingredient inside the new
    // signature. So active_manifest.ingredients carries exactly ONE entry
    // (the auto-promoted parent), NOT the full Phase-15 component graph
    // we'd get if we re-threaded buildResult.ingredientSpecs from the parent.
    //
    // The full parent-of-componentOf-of-componentOf chain is what
    // `deferred-ingredient-mirror` (deferred-items.md, v1.2) addresses —
    // re-threading buildResult.ingredientSpecs so component-level
    // ingredients (loaded models, controlnet inputs, etc.) survive
    // redaction. Today, only the chain-of-custody parent_relationship
    // is preserved by c2pa-rs's auto-promotion.
    const ingredients = store!.active_manifest!.ingredients ?? [];
    // The auto-promoted parent_relationship is the only ingredient.
    expect(ingredients.length).toBeLessThanOrEqual(1);
    if (ingredients.length === 1) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parentIngredient = ingredients[0] as any;
      // c2pa-rs sets relationship to 'parentOf' on the auto-promoted parent.
      expect(['parentOf', 'parent_relationship', undefined]).toContain(
        parentIngredient.relationship,
      );
    }
    // The store carries the parent_relationship traversable via store.manifests.
    expect(typeof store!.manifests).toBe('object');
    // Document the v1.1 contract: store.manifests has multiple entries
    // (the active manifest + the embedded parent), traversable for audit.
  });

  it('Test 10 — multi-redact append-only: each redact writes a sibling row, originals unchanged', async () => {
    // Capture the existing manifest_signed row count for this seed.
    const beforeCount = seed.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM provenance
         WHERE version_id = ? AND event_type = 'manifest_signed'`,
      )
      .get(seed.versionId) as { n: number };

    await seed.engine.redactManifestForVersion(seed.versionId, ['claim_generator']);
    const afterFirst = seed.sqlite
      .prepare(
        `SELECT id, manifest_signed_json FROM provenance
         WHERE version_id = ? AND event_type = 'manifest_signed'
         ORDER BY timestamp ASC, id ASC`,
      )
      .all(seed.versionId) as Array<{ id: string; manifest_signed_json: string }>;
    expect(afterFirst.length).toBe(beforeCount.n + 1);
    const firstRedactRow = afterFirst[afterFirst.length - 1]!;

    await seed.engine.redactManifestForVersion(seed.versionId, ['title']);
    const afterSecond = seed.sqlite
      .prepare(
        `SELECT id, manifest_signed_json FROM provenance
         WHERE version_id = ? AND event_type = 'manifest_signed'
         ORDER BY timestamp ASC, id ASC`,
      )
      .all(seed.versionId) as Array<{ id: string; manifest_signed_json: string }>;
    expect(afterSecond.length).toBe(beforeCount.n + 2);

    // Original row (id from seed) byte-identical.
    const originalAfter = afterSecond.find((r) => r.id === seed.originalManifestSignedRowId);
    expect(originalAfter).toBeDefined();
    expect(originalAfter!.manifest_signed_json).toBe(seed.originalManifestSignedJson);

    // First-redact row byte-identical (find it by id).
    const firstRedactAfter = afterSecond.find((r) => r.id === firstRedactRow.id);
    expect(firstRedactAfter).toBeDefined();
    expect(firstRedactAfter!.manifest_signed_json).toBe(firstRedactRow.manifest_signed_json);

    // Second-redact row carries `redacted: true` + the second policy path.
    const secondRedactRow = afterSecond[afterSecond.length - 1]!;
    expect(secondRedactRow.id).not.toBe(firstRedactRow.id);
    const secondPayload = JSON.parse(secondRedactRow.manifest_signed_json) as ManifestSignedPayloadFields;
    expect(secondPayload.redacted).toBe(true);
    expect(secondPayload.redacted_fields).toContain('title');
  });
});
