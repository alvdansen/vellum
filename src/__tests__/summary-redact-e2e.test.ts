/**
 * Phase 19 — Plan 08 Task 2A. End-to-end cache-invariant proof.
 *
 * Mirrors src/__tests__/c2pa-redaction-e2e.test.ts pattern verbatim
 * (mkdtemp + openDb + Engine + sign + redact). The cache-key invariant is:
 * Phase 16 redact mutates manifest_sha256 → cache key composite
 * (manifest_sha256, template_version, model_id) misses → fresh generation
 * runs against the redacted payload (per RESEARCH.md "Cache-key Invariant"
 * + Pitfall 3).
 *
 * Test flow:
 *   1. Sign version (Phase 14) → manifest_sha256 = SHA_A.
 *   2. First Engine.summarizeVersion call → mock generateSummary returns a
 *      validated text → cache write (manifest_sha256 = SHA_A).
 *   3. Second call → cache HIT (mock NOT invoked again).
 *   4. engine.redactManifestForVersion → manifest_sha256 mutates to SHA_B.
 *   5. Third call → cache MISS (different composite key) → fresh LLM call →
 *      new summary_generated event row written with manifest_sha256 = SHA_B.
 *   6. Assert: 2 summary_generated event rows in DB, different
 *      manifest_sha256 values, different summary_text content.
 *
 * Mock strategy: vi.mock '../engine/summary/anthropic-client.js' so
 * generateSummary is a controllable spy. The Engine setup is REAL (per
 * WARNING #6 — no placeholders): real DB, real ProvenanceRepo, real C2PA
 * sign + redact, real summarizeVersion pipeline. Only the Anthropic SDK
 * call is replaced.
 *
 * Skip-on-CI: requires openssl + bundled c2pa-node certs (mirrors
 * c2pa-redaction-e2e.test.ts environment-detection pattern).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type { Database } from 'better-sqlite3';
import type { Engine } from '../engine/pipeline.js';
import type { ProvenanceRepo } from '../store/provenance-repo.js';
import type { VersionRepo } from '../store/version-repo.js';
import { __resetCircuitBreakerStateForTests } from '../engine/summary/circuit-breaker.js';

// Mock the SDK boundary — generateSummary becomes a controllable spy.
const generateSummaryMock = vi.hoisted(
  () => vi.fn() as ReturnType<typeof vi.fn>,
);

vi.mock('../engine/summary/anthropic-client.js', () => ({
  generateSummary: generateSummaryMock,
  flattenAnthropicError: vi.fn((e: unknown) => String(e)),
  __resetAnthropicSdkStateForTests: vi.fn(),
}));

// ============================================================================
// Environment detection — same pattern as c2pa-redaction-e2e.test.ts
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

// Worktree environments share node_modules with the parent repo via lazy
// resolution (no node_modules symlinking). Test fixtures bundled inside
// node_modules/c2pa-node/tests/fixtures/ may not be reachable from a
// worktree's process.cwd(). Skip the entire describe block when missing —
// the test re-runs cleanly when merged back into main where the fixtures
// resolve via the parent repo's node_modules tree.
const haveFixtures = existsSync(BUNDLED_CERT_PATH) && existsSync(BUNDLED_KEY_PATH);

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// ============================================================================
// Seed helper — builds a real v1 signed manifest. Mirrors
// c2pa-redaction-e2e.test.ts seedSignedV1Manifest:117-246.
// ============================================================================

interface E2ESeed {
  tempRoot: string;
  outputsDir: string;
  versionId: string;
  filename: string;
  engine: Engine;
  sqlite: Database;
  provenanceRepo: ProvenanceRepo;
  versionRepo: VersionRepo;
  cleanup: () => Promise<void>;
}

async function seedSignedManifest(promptPositive: string): Promise<E2ESeed> {
  const tempRoot = await mkdtemp(join(tmpdir(), `phase19-redact-e2e-${nanoid(6)}-`));
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
        // c2pa-node v0.5.26 binding bug — TSA URL must be absent or valid.
        tsaUrl: 'http://timestamp.digicert.com',
      },
      // Phase 19 — drives Engine.summarizeVersion. The mock generateSummary
      // bypasses the actual SDK call; the apiKey value is structural only.
      anthropicConfig: { apiKey: 'sk-ant-test1234567890abcdef1234567890abcdef1234' },
    },
  );

  const ws = hierarchy.createWorkspace('phase19-redact-ws');
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const ver = versionRepo.insertVersion(shot.id);

  // Real prompt blob with KSampler edge → CLIPTextEncode positive text.
  // Phase 15 extractInputAssertion walks this graph in Engine.summarizeVersion
  // BLOCKER #1 wiring. The promptPositive will surface in the sanitized
  // payload as `prompt_positive` (D-PRIV-2 trust boundary).
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
    '6': { class_type: 'CLIPTextEncode', inputs: { text: promptPositive } },
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
    // Phase 13 fingerprint for the D-VAL-1 verbatim regex gate.
    models_json: JSON.stringify([
      {
        node_id: '4',
        class_type: 'CheckpointLoaderSimple',
        model_name: 'flux1-dev',
        model_hash: 'abc',
        model_hash_unavailable: null,
      },
    ]),
    outputs_json: JSON.stringify([{ filename }]),
  });
  // Phase 13 also writes a models_fingerprinted event so getLatestFingerprints
  // returns the same array. Engine.fingerprintModelsForVersion would normally
  // do this in the background; we seed it directly for test determinism.
  provenanceRepo.appendModelsFingerprintedEvent(ver.id, [
    {
      node_id: '4',
      class_type: 'CheckpointLoaderSimple',
      model_name: 'flux1-dev',
      model_hash: 'abc',
      model_hash_unavailable: null,
    },
  ]);

  // Sign — Phase 14 produces manifest_signed event with manifest_sha256.
  const signResult = await engine.signOutput(ver.id, filename, { bytes: TINY_PNG });
  const verDir = join(outputsDir, ver.id);
  await mkdir(verDir, { recursive: true });
  if (signResult.signed) {
    await writeFile(join(verDir, filename), signResult.signed);
  } else {
    await writeFile(join(verDir, filename), TINY_PNG);
  }
  versionRepo.markCompleted(ver.id, JSON.stringify([{ filename }]));

  const sqlite = handle.sqlite as unknown as Database;

  return {
    tempRoot,
    outputsDir,
    versionId: ver.id,
    filename,
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
// Tests
// ============================================================================

describe.skipIf(!haveOpenssl || !haveFixtures)('Phase 19 — summary redact-event cache invariant (E2E)', () => {
  let seed: E2ESeed;
  // Sentinel uniquely identifies the prompt content in the seeded version.
  const PROMPT_POSITIVE = `SUMMARY_REDACT_E2E_${nanoid(8)}`;

  beforeAll(async () => {
    seed = await seedSignedManifest(PROMPT_POSITIVE);
  }, 30_000);

  afterAll(async () => {
    if (seed) await seed.cleanup();
  });

  beforeEach(() => {
    generateSummaryMock.mockReset();
    __resetCircuitBreakerStateForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Test 1 — redact mutates manifest_sha256 → cache miss → fresh summary against redacted payload', async () => {
    // Step 1: Capture the original (pre-redact) manifest_sha256.
    const originalSignedRow = seed.sqlite
      .prepare(
        `SELECT manifest_signed_json FROM provenance
         WHERE version_id = ? AND event_type = 'manifest_signed'
         ORDER BY timestamp ASC, id ASC LIMIT 1`,
      )
      .get(seed.versionId) as { manifest_signed_json: string };
    const SHA_A = (
      JSON.parse(originalSignedRow.manifest_signed_json) as { manifest_sha256?: string }
    ).manifest_sha256;
    expect(SHA_A).toBeTruthy();

    // Step 2: First summarize call. Mock returns a validated string (D-VAL-1
    // verbatim model name "flux1-dev" passes validateSummary).
    generateSummaryMock.mockResolvedValueOnce({
      text: 'v003 generated with flux1-dev at seed 42. First-pass summary.',
      prompt_tokens: 4500,
      completion_tokens: 30,
    });
    const outcome1 = await seed.engine.summarizeVersion(seed.versionId);
    expect(outcome1.source).toBe('live');
    if (outcome1.source === 'live') {
      expect(outcome1.text).toContain('First-pass summary');
    }
    expect(generateSummaryMock).toHaveBeenCalledTimes(1);

    // Step 3: Second call → cache HIT (mock NOT invoked again).
    const outcome2 = await seed.engine.summarizeVersion(seed.versionId);
    expect(outcome2.source).toBe('cache_hit');
    if (outcome2.source === 'cache_hit') {
      expect(outcome2.text).toBe('v003 generated with flux1-dev at seed 42. First-pass summary.');
    }
    expect(generateSummaryMock).toHaveBeenCalledTimes(1); // No extra call.

    // Step 4: Redact. Phase 16 mutates manifest_sha256 → SHA_B.
    const policyPath = "assertions[label='vfx_familiar.input'].data.prompt_positive";
    const redactResult = await seed.engine.redactManifestForVersion(seed.versionId, [policyPath]);
    expect(redactResult.redactedFields).toContain(policyPath);

    // Capture the post-redact manifest_sha256.
    const allSignedRows = seed.sqlite
      .prepare(
        `SELECT manifest_signed_json, timestamp FROM provenance
         WHERE version_id = ? AND event_type = 'manifest_signed'
         ORDER BY timestamp ASC, id ASC`,
      )
      .all(seed.versionId) as Array<{ manifest_signed_json: string; timestamp: number }>;
    expect(allSignedRows.length).toBeGreaterThanOrEqual(2);
    const SHA_B = (
      JSON.parse(allSignedRows[allSignedRows.length - 1].manifest_signed_json) as {
        manifest_sha256?: string;
      }
    ).manifest_sha256;
    expect(SHA_B).toBeTruthy();
    expect(SHA_B).not.toBe(SHA_A); // Cache-key invariant — Phase 16 mutates the SHA.

    // Step 5: Third summarize call → cache MISS (different composite key) →
    // fresh LLM call. Mock returns a redaction-marker string (D-VAL-3 passes).
    generateSummaryMock.mockResolvedValueOnce({
      text: 'v003 generated with flux1-dev. (Some prompt fields were redacted.)',
      prompt_tokens: 4500,
      completion_tokens: 25,
    });
    const outcome3 = await seed.engine.summarizeVersion(seed.versionId);
    expect(outcome3.source).toBe('live');
    if (outcome3.source === 'live') {
      expect(outcome3.text).toContain('redacted');
    }
    expect(generateSummaryMock).toHaveBeenCalledTimes(2);

    // Step 6: Assert 2 summary_generated rows with different manifest_sha256.
    const summaryRows = seed.sqlite
      .prepare(
        `SELECT summary_generated_json FROM provenance
         WHERE version_id = ? AND event_type = 'summary_generated'
         ORDER BY timestamp ASC, id ASC`,
      )
      .all(seed.versionId) as Array<{ summary_generated_json: string }>;
    expect(summaryRows.length).toBe(2);
    const payloads = summaryRows.map(
      (r) =>
        JSON.parse(r.summary_generated_json) as {
          manifest_sha256: string;
          summary_text: string;
        },
    );
    expect(payloads[0].manifest_sha256).toBe(SHA_A);
    expect(payloads[1].manifest_sha256).toBe(SHA_B);
    expect(payloads[0].manifest_sha256).not.toBe(payloads[1].manifest_sha256);
    expect(payloads[0].summary_text).toContain('First-pass summary');
    expect(payloads[1].summary_text).toContain('redacted');
  }, 30_000);
});
