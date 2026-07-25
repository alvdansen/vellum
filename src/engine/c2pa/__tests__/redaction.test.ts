/**
 * Phase 16 / Plan 16-02 Task 1 — pure-helper unit tests for redaction.ts.
 *
 * Covers:
 *   - applyRedactionPolicy DSL modes (top-level, wildcard, label-targeted,
 *     multiple paths)
 *   - bounded resolver (REDACT_POLICY_INVALID on traversal, regex metachars,
 *     unmatched brackets, segment cap, entry cap, empty policy)
 *   - structural sentinel walk (C-01 fix — Test 15a) — every leaf becomes
 *     the REDACTED sentinel; no original-value leakage through container
 *     shapes
 *   - vellum.redacted assertion shape (D-CTX-1) appended in every
 *     redaction call
 *   - idempotent on already-redacted manifests
 *   - buildRedactedManifestDefinition reflects the redacted JSON
 *
 * Integration tests (Tests 16-26) cover the c2pa-node-backed
 * redactManifestForVersionImpl helper in Task 2.
 */

import { describe, it, expect } from 'vitest';
import {
  applyRedactionPolicy,
  buildRedactedManifestDefinition,
} from '../redaction.js';
import type { ManifestDefinition } from '../manifest-builder.js';
import { TypedError } from '../../errors.js';

const STUB_NOW = (): string => '2026-04-30T12:00:00.000Z';

function makeManifest(over: Partial<ManifestDefinition> = {}): ManifestDefinition {
  return {
    claim_generator: 'vellum/0.1 c2pa-node/0.5.26',
    format: 'image/png',
    title: 'Version ver_xyz',
    assertions: [],
    ...over,
  };
}

describe('Plan 16-02 Task 1 — applyRedactionPolicy pure helper', () => {
  it('Test 1 — top-level redaction (claim_generator)', () => {
    const manifest = makeManifest({ claim_generator: 'vellum/0.1' });
    const r = applyRedactionPolicy(manifest, ['claim_generator'], STUB_NOW);
    expect(r.redactedFields).toEqual(['claim_generator']);
    expect(r.notFound).toEqual([]);
    expect(r.redactedJson.claim_generator).toBe('[REDACTED]');
    expect(r.redactedJson.title).toBe('Version ver_xyz'); // untouched
    // vellum.redacted appended.
    const last = r.redactedJson.assertions[r.redactedJson.assertions.length - 1]!;
    expect(last.label).toBe('vellum.redacted');
  });

  it('Test 2 — wildcard array index (assertions[*].data.prompt_positive)', () => {
    const manifest = makeManifest({
      assertions: [
        {
          label: 'vellum.input',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { prompt_positive: 'cat', seed: 42 } as any,
        },
      ],
    });
    const r = applyRedactionPolicy(
      manifest,
      ['assertions[*].data.prompt_positive'],
      STUB_NOW,
    );
    expect(r.redactedFields).toEqual(['assertions[*].data.prompt_positive']);
    const inputAssertion = r.redactedJson.assertions[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (inputAssertion as any).data as Record<string, unknown>;
    expect(data.prompt_positive).toBe('[REDACTED]');
    expect(data.seed).toBe(42);
  });

  it('Test 3 — label-targeted (assertions[label=...].data.prompt_negative)', () => {
    const manifest = makeManifest({
      assertions: [
        {
          label: 'vellum.input',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { prompt_negative: 'blurry', seed: 7 } as any,
        },
        {
          label: 'c2pa.actions',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { actions: [{ action: 'c2pa.created' }] } as any,
        },
      ],
    });
    const r = applyRedactionPolicy(
      manifest,
      ["assertions[label='vellum.input'].data.prompt_negative"],
      STUB_NOW,
    );
    expect(r.redactedFields).toEqual([
      "assertions[label='vellum.input'].data.prompt_negative",
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputData = (r.redactedJson.assertions[0] as any).data as Record<string, unknown>;
    expect(inputData.prompt_negative).toBe('[REDACTED]');
    expect(inputData.seed).toBe(7);
    // c2pa.actions assertion untouched
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actionsData = (r.redactedJson.assertions[1] as any).data;
    expect(actionsData).toEqual({ actions: [{ action: 'c2pa.created' }] });
  });

  it('Test 4 — multiple paths (3 entries, all matched)', () => {
    const manifest = makeManifest({
      claim_generator: 'a',
      title: 'b',
      assertions: [
        {
          label: 'vellum.input',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { prompt_positive: 'p' } as any,
        },
      ],
    });
    const r = applyRedactionPolicy(
      manifest,
      ['claim_generator', 'title', 'assertions[*].data.prompt_positive'],
      STUB_NOW,
    );
    expect(r.redactedFields).toEqual([
      'claim_generator',
      'title',
      'assertions[*].data.prompt_positive',
    ]);
    expect(r.notFound).toEqual([]);
    expect(r.redactedJson.claim_generator).toBe('[REDACTED]');
    expect(r.redactedJson.title).toBe('[REDACTED]');
  });

  it('Test 5 — path not found surfaces as soft warning (not error)', () => {
    const manifest = makeManifest();
    const r = applyRedactionPolicy(
      manifest,
      ["assertions[label='nonexistent.label'].data.foo"],
      STUB_NOW,
    );
    expect(r.redactedFields).toEqual([]);
    expect(r.notFound).toEqual([
      "assertions[label='nonexistent.label'].data.foo",
    ]);
    // vellum.redacted still appended (audit trail).
    const last = r.redactedJson.assertions[r.redactedJson.assertions.length - 1]!;
    expect(last.label).toBe('vellum.redacted');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((last as any).data.redacted_fields).toEqual([]);
  });

  it('Test 6 — traversal rejection (../etc/passwd)', () => {
    expect(() =>
      applyRedactionPolicy(makeManifest(), ['../etc/passwd'], STUB_NOW),
    ).toThrowError(TypedError);
    try {
      applyRedactionPolicy(makeManifest(), ['../etc/passwd'], STUB_NOW);
    } catch (err) {
      expect((err as TypedError).code).toBe('REDACT_POLICY_INVALID');
      expect((err as TypedError).message).toContain('..');
    }
  });

  it('Test 7 — regex metacharacter rejection (assertions[*].data.foo.*)', () => {
    expect(() =>
      applyRedactionPolicy(
        makeManifest(),
        ['assertions[*].data.foo.*'],
        STUB_NOW,
      ),
    ).toThrowError(TypedError);
    try {
      applyRedactionPolicy(
        makeManifest(),
        ['assertions[*].data.foo.*'],
        STUB_NOW,
      );
    } catch (err) {
      expect((err as TypedError).code).toBe('REDACT_POLICY_INVALID');
    }
  });

  it('Test 8 — unmatched bracket rejection (assertions[*.data.foo)', () => {
    try {
      applyRedactionPolicy(
        makeManifest(),
        ['assertions[*.data.foo'],
        STUB_NOW,
      );
      expect.fail('expected throw');
    } catch (err) {
      expect((err as TypedError).code).toBe('REDACT_POLICY_INVALID');
    }
  });

  it('Test 9 — segment cap (65 dotted segments)', () => {
    const tooDeep = Array.from({ length: 65 }, (_, i) => `k${i}`).join('.');
    try {
      applyRedactionPolicy(makeManifest(), [tooDeep], STUB_NOW);
      expect.fail('expected throw');
    } catch (err) {
      expect((err as TypedError).code).toBe('REDACT_POLICY_INVALID');
      expect((err as TypedError).message).toContain('64 segments');
    }
  });

  it('Test 10 — entry cap (33 entries)', () => {
    const tooMany = Array.from({ length: 33 }, (_, i) => `k${i}`);
    try {
      applyRedactionPolicy(makeManifest(), tooMany, STUB_NOW);
      expect.fail('expected throw');
    } catch (err) {
      expect((err as TypedError).code).toBe('REDACT_POLICY_INVALID');
      expect((err as TypedError).message).toContain('32 entries');
    }
  });

  it('Test 11 — empty policy rejected', () => {
    try {
      applyRedactionPolicy(makeManifest(), [], STUB_NOW);
      expect.fail('expected throw');
    } catch (err) {
      expect((err as TypedError).code).toBe('REDACT_POLICY_INVALID');
      expect((err as TypedError).message).toMatch(/non-empty/i);
    }
  });

  it('Test 12 — no original values leaked (string-search of stringified output)', () => {
    const manifest = makeManifest({ title: 'SECRET_VALUE_42_XYZ' });
    const r = applyRedactionPolicy(manifest, ['title'], STUB_NOW);
    const stringified = JSON.stringify(r.redactedJson);
    expect(stringified).not.toContain('SECRET_VALUE_42_XYZ');
    // vellum.redacted assertion carries the PATH, not the value
    expect(stringified).toContain('"redacted_fields":["title"]');
  });

  it('Test 13 — vellum.redacted assertion has parseable ISO timestamp', () => {
    const r = applyRedactionPolicy(
      makeManifest(),
      ['claim_generator'],
      () => '2026-04-30T12:00:00.000Z',
    );
    const last = r.redactedJson.assertions[r.redactedJson.assertions.length - 1]!;
    expect(last.label).toBe('vellum.redacted');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (last as any).data;
    expect(data.redacted_at).toBe('2026-04-30T12:00:00.000Z');
    expect(Number.isFinite(Date.parse(data.redacted_at))).toBe(true);
  });

  it('Test 14 — idempotent on already-redacted manifest (multi-redaction trail)', () => {
    const m1 = makeManifest({ claim_generator: 'a', title: 'b' });
    const r1 = applyRedactionPolicy(m1, ['claim_generator'], STUB_NOW);
    expect(r1.redactedFields).toEqual(['claim_generator']);
    const r2 = applyRedactionPolicy(r1.redactedJson, ['title'], STUB_NOW);
    expect(r2.redactedFields).toEqual(['title']);
    expect(r2.redactedJson.title).toBe('[REDACTED]');
    // Two vellum.redacted assertions appended (one per redaction).
    const redactedAssertions = r2.redactedJson.assertions.filter(
      (a) => a.label === 'vellum.redacted',
    );
    expect(redactedAssertions.length).toBe(2);
  });

  it('Test 15 — buildRedactedManifestDefinition reflects redacted JSON', () => {
    const m = makeManifest({ claim_generator: 'a', title: 't' });
    const r = applyRedactionPolicy(m, ['claim_generator'], STUB_NOW);
    const def = buildRedactedManifestDefinition(r.redactedJson);
    expect(def.claim_generator).toBe(r.redactedJson.claim_generator);
    expect(def.format).toBe(r.redactedJson.format);
    expect(def.title).toBe(r.redactedJson.title);
    expect(def.assertions).toEqual(r.redactedJson.assertions);
  });

  it('Test 15a (C-01) — redaction preserves nested structure with sentinel leaves', () => {
    const manifest = makeManifest({
      assertions: [
        {
          label: 'vellum.input',
          data: {
            prompt_positive: 'cat',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sampler: { seed: 42, steps: 20 } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tags: ['a', 'b'] as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        },
      ],
    });
    const r = applyRedactionPolicy(
      manifest,
      ["assertions[label='vellum.input'].data"],
      STUB_NOW,
    );
    expect(r.redactedFields).toEqual([
      "assertions[label='vellum.input'].data",
    ]);
    // The whole `data` was redacted at leaf-level recursively.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const redactedData = (r.redactedJson.assertions[0] as any).data;
    expect(redactedData.prompt_positive).toBe('[REDACTED]');
    expect(redactedData.sampler).toEqual({
      seed: '[REDACTED]',
      steps: '[REDACTED]',
    });
    expect(redactedData.tags).toEqual(['[REDACTED]', '[REDACTED]']);
    // Structural keys preserved.
    expect(Object.keys(redactedData).sort()).toEqual(
      ['prompt_positive', 'sampler', 'tags'].sort(),
    );
    expect(Object.keys(redactedData.sampler).sort()).toEqual(
      ['seed', 'steps'].sort(),
    );
    expect(Array.isArray(redactedData.tags)).toBe(true);
    expect(redactedData.tags.length).toBe(2);
    // Critically: original VALUES (cat / 42 / a) appear nowhere in the JSON.
    const stringified = JSON.stringify(r.redactedJson);
    expect(stringified).not.toContain('"cat"');
    expect(stringified).not.toContain('42');
    expect(stringified).not.toContain('"a"');
  });

  it('Test 15b — original input is NOT mutated (structuredClone discipline)', () => {
    const manifest = makeManifest({
      claim_generator: 'original',
      assertions: [
        {
          label: 'vellum.input',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { prompt_positive: 'cat' } as any,
        },
      ],
    });
    const before = JSON.stringify(manifest);
    applyRedactionPolicy(
      manifest,
      ['claim_generator', "assertions[label='vellum.input'].data.prompt_positive"],
      STUB_NOW,
    );
    const after = JSON.stringify(manifest);
    expect(after).toBe(before);
  });

  it('Test 15c (C-05 hardening) — NUL byte rejected', () => {
    try {
      applyRedactionPolicy(makeManifest(), [`foo${String.fromCharCode(0)}bar`], STUB_NOW);
      expect.fail('expected throw');
    } catch (err) {
      expect((err as TypedError).code).toBe('REDACT_POLICY_INVALID');
    }
  });

  it('Test 15d (C-05 hardening) — Unicode bidi override (U+202A) rejected', () => {
    try {
      applyRedactionPolicy(makeManifest(), [`foo${String.fromCodePoint(0x202A)}bar`], STUB_NOW);
      expect.fail('expected throw');
    } catch (err) {
      expect((err as TypedError).code).toBe('REDACT_POLICY_INVALID');
    }
  });

  it('Test 15e (C-05 hardening) — CR/LF rejected', () => {
    try {
      applyRedactionPolicy(makeManifest(), ['foo\nbar'], STUB_NOW);
      expect.fail('expected throw');
    } catch (err) {
      expect((err as TypedError).code).toBe('REDACT_POLICY_INVALID');
    }
  });

  it('Test 15f (C-05 hardening) — label longer than 256 chars rejected', () => {
    const longLabel = 'a'.repeat(257);
    try {
      applyRedactionPolicy(
        makeManifest(),
        [`assertions[label='${longLabel}'].data.x`],
        STUB_NOW,
      );
      expect.fail('expected throw');
    } catch (err) {
      expect((err as TypedError).code).toBe('REDACT_POLICY_INVALID');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Plan 16-02 Task 2 — integration tests for Engine.redactManifestForVersion
// + redactManifestForVersionImpl. Real Phase 14 dev cert + native binding;
// covers happy path round-trip, no-leak invariant, original event row
// byte-identity, error mappings (REDACT_NO_MANIFEST, REDACT_PARENT_UNREADABLE),
// concurrency mutex serialization, ingredient pass-through, C-03 normalization
// of c2pa.actions.v2 → c2pa.actions on read.
// ──────────────────────────────────────────────────────────────────────────

// All declared in this section to keep the integration set a single block.
import { Engine } from '../../pipeline.js';
import { HierarchyRepo } from '../../../store/hierarchy-repo.js';
import { VersionRepo } from '../../../store/version-repo.js';
import { ProvenanceRepo } from '../../../store/provenance-repo.js';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { extractAssertions } from '../redaction.js';
import { execFileSync } from 'node:child_process';
import type { ManifestSignedPayloadFields } from '../../../types/provenance.js';
import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

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

// 4x4 PNG (8 bytes header + 56 bytes IHDR/IDAT/IEND placeholder is too small;
// use a real valid 1x1 PNG via base64).
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe.skipIf(!haveOpenssl)(
  'Plan 16-02 Task 2 — Engine.redactManifestForVersion integration',
  () => {
    let engine: Engine;
    let outputsDir: string;
    let dbHandle: { sqlite: { close: () => void } } | null = null;
    let provenanceRepo: ProvenanceRepo;
    let versionRepo: VersionRepo;
    let versionId: string;
    const FILENAME = 'out.png';

    beforeAll(async () => {
      // Dev-cert opt-in so signed-by-dev-cert tests pass through verifier-style
      // checks without hitting untrusted_root.
      process.env.VELLUM_C2PA_TRUST_DEV_CERT = '1';
    });

    afterAll(async () => {
      delete process.env.VELLUM_C2PA_TRUST_DEV_CERT;
    });

    beforeEach(async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), 'vfx-redact-test-'));
      outputsDir = join(tempRoot, 'outputs');
      await mkdir(outputsDir, { recursive: true });
      const dbPath = join(tempRoot, 'test.db');

      const { openDb } = await import('../../../store/db.js');
      const handle = openDb(dbPath);
      dbHandle = handle;

      const hierarchy = new HierarchyRepo(handle.db);
      versionRepo = new VersionRepo(handle.db);
      provenanceRepo = new ProvenanceRepo(handle.db);

      engine = new Engine(
        handle.db,
        hierarchy,
        versionRepo,
        provenanceRepo,
        null,
        outputsDir,
        {
          c2paConfig: {
            certPemPath: BUNDLED_CERT_PATH,
            privateKeyPemPath: BUNDLED_KEY_PATH,
            tsaUrl: 'http://timestamp.digicert.com',
          },
        },
      );

      // Seed: workspace -> project -> sequence -> shot -> version.
      const ws = hierarchy.createWorkspace('redact-ws');
      const proj = hierarchy.createProject(ws.id, 'p1');
      const seq = hierarchy.createSequence(proj.id, 'sq010');
      const shot = hierarchy.createShot(seq.id, 'sh010');
      const ver = versionRepo.insertVersion(shot.id);
      versionId = ver.id;
      provenanceRepo.insertEvent(ver.id, {
        event_type: 'submitted',
        workflow_json: '{}',
      });
      provenanceRepo.insertEvent(ver.id, {
        event_type: 'completed',
        prompt_json: '{}',
        seed: null,
        models_json: '[]',
        outputs_json: JSON.stringify([{ filename: FILENAME }]),
      });

      // Sign the PNG to seed manifest_signed event AND embed manifest in disk file.
      const signResult = await engine.signOutput(ver.id, FILENAME, { bytes: TINY_PNG });
      if (signResult.signed) {
        const verDir = join(outputsDir, ver.id);
        await mkdir(verDir, { recursive: true });
        await writeFile(join(verDir, FILENAME), signResult.signed);
      }
      versionRepo.markCompleted(ver.id, JSON.stringify([{ filename: FILENAME }]));
    });

    afterEach(async () => {
      try {
        await engine.stop();
      } catch {
        // best-effort
      }
      if (dbHandle) {
        try {
          dbHandle.sqlite.close();
        } catch {
          // best-effort
        }
        dbHandle = null;
      }
      try {
        await rm(outputsDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    });

    it('Test 16 — happy path: redact claim_generator, c2pa.read shows redacted manifest', async () => {
      const result = await engine.redactManifestForVersion(versionId, [
        'claim_generator',
      ]);
      expect(result.redactedFields).toEqual(['claim_generator']);
      expect(result.notFound).toEqual([]);
      expect(result.redactedBytes.length).toBeGreaterThan(0);
      expect(result.format).toBe('image/png');
      expect(result.signedAt.length).toBeGreaterThan(0);

      // c2pa.read on the result.redactedBytes must show:
      //   - claim_generator === '[REDACTED]'
      //   - vellum.redacted assertion
      //   - c2pa.actions assertion (round-tripped through normalization)
      const c2paNode = await import('c2pa-node');
      const c2pa = c2paNode.createC2pa();
      const store = await c2pa.read({
        buffer: result.redactedBytes,
        mimeType: 'image/png',
      });
      expect(store).not.toBeNull();
      expect(store!.active_manifest).not.toBeNull();
      const manifest = store!.active_manifest!;
      // c2pa-rs APPENDS its own generator suffix (`c2pa-node/x.x c2pa-rs/y.y`)
      // to claim_generator on every sign — so the redacted value starts with
      // '[REDACTED]' rather than equaling it exactly. The redaction is
      // structurally correct: the original `vellum/0.1` substring is
      // GONE; only the c2pa-rs-appended self-identification remains after
      // the sentinel.
      expect(manifest.claim_generator).toMatch(/^\[REDACTED\]/);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const labels = (manifest.assertions ?? []).map((a: any) => a.label);
      expect(labels).toContain('vellum.redacted');
      // c2pa-rs normalizes label on read; allowlist either form.
      const hasActions =
        labels.includes('c2pa.actions') || labels.includes('c2pa.actions.v2');
      expect(hasActions).toBe(true);
    });

    it('Test 16b (C-03) — extractAssertions normalizes c2pa.actions.v2 → c2pa.actions', () => {
      // Synthetic ResolvedManifest-shaped object.
      const synthetic = {
        assertions: [
          {
            label: 'c2pa.actions.v2',
            data: { actions: [{ action: 'c2pa.created' }] },
          },
          {
            label: 'vellum.input',
            data: { prompt_positive: 'foo' },
          },
          {
            label: 'unknown.label',
            data: { hello: 'world' },
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      const out = extractAssertions(synthetic);
      // Unknown label dropped; v2 normalized.
      const labels = out.map((a) => a.label);
      expect(labels).toContain('c2pa.actions');
      expect(labels).toContain('vellum.input');
      expect(labels).not.toContain('unknown.label');
      expect(labels).not.toContain('c2pa.actions.v2');
    });

    it('Test 17 — active manifest carries redacted values (D-CTX-1 active-manifest invariant)', async () => {
      // D-CTX-1 invariant lock: the ACTIVE manifest read via c2pa.read MUST
      // expose redacted values, NOT the originals. This is the C2PA-spec
      // surface that downstream verifiers consult.
      //
      // SCOPE LIMITATION (C-01 / D-CTX-1): C2PA's chain-of-custody design
      // preserves the PARENT manifest (the pre-redaction bytes signed by the
      // same key) as an ingredient inside the new active manifest. When
      // `c2pa-rs` re-signs an asset that already has an embedded manifest, it
      // automatically promotes the previous manifest to a `parent_relationship`
      // ingredient so the audit trail can be traversed. This means a callers
      // string-search of the raw redacted bytes may STILL find the original
      // value within the embedded parent-manifest chain. This is C2PA-design
      // intentional — to scrub the parent chain a caller would need to use
      // `c2pa-rs`'s manifest-removal API (out of scope for v1.1; tracked
      // deferred-items.md as v1.2 follow-up).
      //
      // The redaction primitive's contract is bounded to the ACTIVE manifest:
      // (a) the active_manifest fields show redacted values
      // (b) a vellum.redacted assertion is appended
      // (c) the redaction policy paths actually applied are recorded
      const c2paNode = await import('c2pa-node');
      const c2pa = c2paNode.createC2pa();
      const verDir = join(outputsDir, versionId);
      const parentBytes = await readFile(join(verDir, FILENAME));
      const parentStore = await c2pa.read({
        buffer: parentBytes,
        mimeType: 'image/png',
      });
      const originalTitle = parentStore!.active_manifest!.title as string;
      expect(typeof originalTitle).toBe('string');
      expect(originalTitle.length).toBeGreaterThan(0);
      expect(originalTitle.startsWith('Version ')).toBe(true);

      const result = await engine.redactManifestForVersion(versionId, ['title']);
      expect(result.redactedFields).toEqual(['title']);

      // (a) Active manifest title is the sentinel.
      const redactedStore = await c2pa.read({
        buffer: result.redactedBytes,
        mimeType: 'image/png',
      });
      expect(redactedStore!.active_manifest!.title).toBe('[REDACTED]');
      // (b) vellum.redacted assertion present.
      const labels = (redactedStore!.active_manifest!.assertions ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (a: any) => a.label,
      );
      expect(labels).toContain('vellum.redacted');
      // (c) redactedFields recorded.
      expect(result.redactedFields).toEqual(['title']);
    });

    it('Test 18 (C-02) — original manifest_signed event row byte-identical after redaction (full-row equality)', async () => {
      // Capture the original event row directly from SQLite.
      const dbInst = (dbHandle!.sqlite as unknown as {
        prepare: (s: string) => { all: (...args: unknown[]) => unknown[]; get: (...args: unknown[]) => unknown };
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allRowsBefore = dbInst.prepare(
        `SELECT * FROM provenance WHERE version_id = ? AND event_type = 'manifest_signed' ORDER BY timestamp ASC, id ASC`,
      ).all(versionId) as any[];
      expect(allRowsBefore.length).toBe(1);
      const originalRowBefore = allRowsBefore[0];
      const originalIdBefore = originalRowBefore.id;

      await engine.redactManifestForVersion(versionId, ['claim_generator']);

      const allRowsAfter = dbInst.prepare(
        `SELECT * FROM provenance WHERE version_id = ? AND event_type = 'manifest_signed' ORDER BY timestamp ASC, id ASC`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ).all(versionId) as any[];
      expect(allRowsAfter.length).toBe(2);
      // The first row (oldest) MUST be byte-identical to the original.
      const originalRowAfter = allRowsAfter[0];
      expect(originalRowAfter.id).toBe(originalIdBefore);
      expect(originalRowAfter).toEqual(originalRowBefore);
      // The new row MUST carry redacted=true.
      const newRow = allRowsAfter[1];
      const newPayload = JSON.parse(newRow.manifest_signed_json) as ManifestSignedPayloadFields;
      expect(newPayload.redacted).toBe(true);
      expect(newPayload.redacted_fields).toEqual(['claim_generator']);
    });

    it('Test 19 — getLatestManifestSignedEvent returns redacted=true row after redaction', async () => {
      await engine.redactManifestForVersion(versionId, ['claim_generator']);
      const latest = provenanceRepo.getLatestManifestSignedEvent(versionId, FILENAME);
      expect(latest).not.toBeNull();
      expect(latest!.redacted).toBe(true);
      expect(latest!.redacted_fields).toEqual(['claim_generator']);
      expect(latest!.signed).toBe(true);
      expect(latest!.format).toBe('image/png');
      expect(latest!.cert_subject_summary.length).toBeGreaterThan(0);
    });

    it('Test 20 — corrupt parent bytes → REDACT_PARENT_UNREADABLE', async () => {
      // Overwrite the disk file with corrupt bytes.
      const verDir = join(outputsDir, versionId);
      await writeFile(join(verDir, FILENAME), Buffer.from('not a real png'));
      try {
        await engine.redactManifestForVersion(versionId, ['claim_generator']);
        expect.fail('expected REDACT_PARENT_UNREADABLE');
      } catch (err) {
        expect((err as TypedError).code).toBe('REDACT_PARENT_UNREADABLE');
      }
    });

    it('Test 21 — version with no manifest_signed event → REDACT_NO_MANIFEST', async () => {
      // Create a fresh version with no manifest_signed event.
      const handle = dbHandle!;
      const hierarchy = new HierarchyRepo(handle.sqlite as never);
      // Simpler: create a version row + completed event but skip signing.
      const newVer = versionRepo.insertVersion(
        // get original shot id from the existing version
        (versionRepo.getVersion(versionId) as unknown as { shot_id: string }).shot_id,
      );
      provenanceRepo.insertEvent(newVer.id, {
        event_type: 'completed',
        prompt_json: '{}',
        seed: null,
        models_json: '[]',
        outputs_json: JSON.stringify([{ filename: 'other.png' }]),
      });
      versionRepo.markCompleted(newVer.id, JSON.stringify([{ filename: 'other.png' }]));
      try {
        await engine.redactManifestForVersion(newVer.id, ['claim_generator']);
        expect.fail('expected REDACT_NO_MANIFEST');
      } catch (err) {
        expect((err as TypedError).code).toBe('REDACT_NO_MANIFEST');
      }
      // Suppress unused warning
      void hierarchy;
    });

    it('Test 22 — manifest_signed event with signed=false → REDACT_NO_MANIFEST', async () => {
      // Create a version + manifest_signed event with signed=false.
      const newVer = versionRepo.insertVersion(
        (versionRepo.getVersion(versionId) as unknown as { shot_id: string }).shot_id,
      );
      const newFn = 'other2.png';
      provenanceRepo.insertEvent(newVer.id, {
        event_type: 'completed',
        prompt_json: '{}',
        seed: null,
        models_json: '[]',
        outputs_json: JSON.stringify([{ filename: newFn }]),
      });
      versionRepo.markCompleted(newVer.id, JSON.stringify([{ filename: newFn }]));
      provenanceRepo.appendManifestSignedEvent(newVer.id, {
        filename: newFn,
        format: '',
        signed: false,
        cert_subject_summary: '',
        signed_at: new Date().toISOString(),
        status_reason: 'signing_disabled',
        algorithm: '',
      });
      try {
        await engine.redactManifestForVersion(newVer.id, ['claim_generator']);
        expect.fail('expected REDACT_NO_MANIFEST');
      } catch (err) {
        expect((err as TypedError).code).toBe('REDACT_NO_MANIFEST');
      }
    });

    it('Test 23 — concurrency: redact + sign serialize on same compound key (mutex)', async () => {
      // Launch redact + sign concurrently. Both must succeed.
      // The redact path overwrites the disk file atomically; the second
      // signOutput call (on already-signed file) sees the prior manifest_signed
      // event with signed=true and short-circuits with alreadySigned=true.
      const redactPromise = engine.redactManifestForVersion(versionId, [
        'claim_generator',
      ]);
      // Concurrent signOutput on same versionId+filename — coalescing inside
      // signMutex (there's no in-flight signOutput right now), so this enters
      // the assetWriterMutex queue AFTER redact.
      const signPromise = engine.signOutput(versionId, FILENAME, { bytes: TINY_PNG });
      const [redactRes, signRes] = await Promise.all([redactPromise, signPromise]);
      expect(redactRes.redactedFields).toEqual(['claim_generator']);
      // signOutput on already-signed is alreadySigned=true (Phase 14 idempotency).
      expect(signRes.alreadySigned).toBe(true);
      // Event count: 1 original + 1 redacted = 2 (the redacted creates a new
      // manifest_signed; signOutput's already-signed branch creates ZERO new).
      const events = provenanceRepo
        .getEventsForVersion(versionId)
        .filter((e) => e.event_type === 'manifest_signed');
      expect(events.length).toBe(2);
    });

    it('Test 26 — REDACT_POLICY_INVALID propagates through Engine.redactManifestForVersion', async () => {
      try {
        await engine.redactManifestForVersion(versionId, []);
        expect.fail('expected REDACT_POLICY_INVALID');
      } catch (err) {
        expect((err as TypedError).code).toBe('REDACT_POLICY_INVALID');
      }
    });
  },
);

// Test 25 (architecture-purity) lives in src/__tests__/architecture-purity.test.ts
// — that file's "redaction.ts uses lazy c2pa-node + zero MCP/SQLite/ORM/hono"
// case asserts the file-level lock; running it here would duplicate. The
// directory-wide checks in architecture-purity.test.ts also assert the
// allowed-set + actual-set equality covering redaction.ts.

