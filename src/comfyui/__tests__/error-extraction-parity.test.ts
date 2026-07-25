import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import '../../test-utils/matchers.js';
import { flattenComfyError } from '../format.js';
import { ComfyUIClient, DEFAULT_COMFYUI_API_BASE, HEALTHCHECK_PATH } from '../client.js';
import type { TypedError } from '../../engine/errors.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { BreadcrumbResolver } from '../../engine/breadcrumb.js';
import { GenerationEngine } from '../../engine/generation.js';
import { ProvenanceWriter } from '../../engine/provenance.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import type { ComfyUIClient as ComfyUIClientType } from '../client.js';

/**
 * DEMO-02 same-fixture parity test (Plan 11-02 / Phase 11).
 *
 * Drives identical Cloud-shaped error bodies through THREE paths:
 *   1. flattenComfyError directly (helper-level proof).
 *   2. ComfyUIClient.submit() against a mocked fetch returning 4xx (submit-time path).
 *   3. GenerationEngine.getGenerationStatus() against the FakeComfyUIClient
 *      with cannedFailedError set per fixture (status / recovery-poller path).
 *
 * For each fixture, all three paths must produce byte-identical flattened
 * detail strings. This is the structural guard against future drift between
 * the two call sites — closes ROADMAP Phase 11 success criterion #2.
 *
 * Parity scope: fixtures contain no API-key-shaped substrings, so the
 * submit-time scrubAndTruncate and the status-time scrubErrorValue are
 * both no-ops on the flattened output; byte-equality holds. A dirty-input
 * scrub-correctness test is out of scope for this plan (covered by the
 * existing IS-04 test in client.test.ts).
 *
 * IT-10 cross-check: the cancelled-status fake fixture (no error field)
 * must produce the literal `'ComfyUI reported failed'` byte-for-byte —
 * preserves the existing IT-10 contract at generation.test.ts:301-309 with
 * a faster-firing duplicate assertion in this file.
 */

// -- Fixtures -----------------------------------------------------------

interface ParityFixture {
  label: string;
  body: unknown;
  expected: string;
}

const FIXTURE_A: ParityFixture = {
  label: 'node_errors object — Unauthorized message',
  body: {
    node_errors: {
      '3': {
        errors: [{ type: 'auth_error', message: 'Unauthorized: Please login first' }],
        dependent_outputs: [],
        class_type: 'KSampler',
      },
    },
  },
  expected: 'Node 3 (KSampler): Unauthorized: Please login first',
};

const FIXTURE_B: ParityFixture = {
  label: 'node_errors object — value_not_in_list shape',
  body: {
    node_errors: {
      '5': {
        errors: [
          {
            type: 'value_not_in_list',
            message: "value_not_in_list: ckpt_name 'X' not in []",
          },
        ],
        dependent_outputs: [],
        class_type: 'CheckpointLoaderSimple',
      },
    },
  },
  expected: "Node 5 (CheckpointLoaderSimple): value_not_in_list: ckpt_name 'X' not in []",
};

const FIXTURE_C: ParityFixture = {
  label: 'string error — opaque Cloud message',
  body: 'Cloud bored, retry later',
  expected: 'Cloud bored, retry later',
};

const FIXTURE_D: ParityFixture = {
  label: 'missing error — IT-10 fallback parity',
  body: undefined,
  expected: 'ComfyUI reported failed',
};

const ALL_FIXTURES: readonly ParityFixture[] = [FIXTURE_A, FIXTURE_B, FIXTURE_C, FIXTURE_D];

// -- Helpers ------------------------------------------------------------

const KEY = 'test-parity-key';
const BASE = DEFAULT_COMFYUI_API_BASE;

/**
 * Mock fetch that intercepts the HEALTHCHECK_PATH GET and returns 200 (so the
 * D-EP-07 first-submit healthcheck doesn't blow the test) and returns a
 * canned 4xx response for the actual /api/prompt POST. Mirrors the pattern
 * in client.test.ts:mockFetch but hard-wires a single canned response.
 *
 * `body` is the JSON-serializable error body; `undefined` sends an empty
 * body so JSON.parse falls through to null (Fixture D path).
 */
function makeSubmit4xxFetch(status: number, body: unknown): typeof fetch {
  const wrapped = async (req: Request | URL | string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const urlStr =
      typeof req === 'string' ? req : req instanceof URL ? req.toString() : (req as Request).url;
    try {
      const pathname = new URL(urlStr).pathname;
      if (method === 'GET' && pathname === HEALTHCHECK_PATH) {
        return new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    } catch {
      /* fall through */
    }
    // Default: return the canned 4xx for any non-healthcheck call (the POST).
    const text = body === undefined ? '' : JSON.stringify(body);
    return new Response(text, {
      status,
      statusText: 'Bad Request',
      headers: { 'content-type': 'application/json' },
    });
  };
  return wrapped as unknown as typeof fetch;
}

/**
 * Status-path arm: create a real GenerationEngine + repos + FakeComfyUIClient.
 * Mirrors src/engine/__tests__/generation.test.ts setup() pattern verbatim.
 */
type StatusCtx = {
  engine: GenerationEngine;
  versions: VersionRepo;
  provenanceRepo: ProvenanceRepo;
  fake: FakeComfyUIClient;
  shotId: string;
  tempRoot: string;
};

async function setupStatusArm(): Promise<StatusCtx> {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const fake = new FakeComfyUIClient();
  const breadcrumb = new BreadcrumbResolver(hierarchy, versions);
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-parity-${nanoid(6)}-`));
  const engine = new GenerationEngine(
    hierarchy,
    versions,
    provenanceRepo,
    provenanceWriter,
    fake as unknown as ComfyUIClientType,
    breadcrumb,
    tempRoot,
  );
  const ws = hierarchy.createWorkspace('ws-parity');
  const proj = hierarchy.createProject(ws.id, 'p-parity');
  const seq = hierarchy.createSequence(proj.id, 'sq-parity');
  const shot = hierarchy.createShot(seq.id, 'sh-parity');
  return { engine, versions, provenanceRepo, fake, shotId: shot.id, tempRoot };
}

// -- Tests --------------------------------------------------------------

describe('error-extraction parity (DEMO-02 — submit + status + helper produce identical detail)', () => {
  let ctx: StatusCtx;

  beforeEach(async () => {
    ctx = await setupStatusArm();
  });

  afterEach(async () => {
    await ctx.engine.stop();
    await fsp.rm(ctx.tempRoot, { recursive: true, force: true });
    vi.useRealTimers();
  });

  // -------------------- Helper-direct arm --------------------
  // One named test() per fixture (4 cases) — lexical 1-to-1 with runtime so
  // the verify-block grep counts match the case count. Body is identical;
  // a shared helper keeps the assertion logic single-source.
  function assertHelperParity(f: ParityFixture): void {
    // For Fixtures A and B, the helper receives the wrapping object
    // (status-path shape with .node_errors). For Fixture C, the bare
    // string. For Fixture D, undefined. This mirrors what each call site
    // passes to the helper.
    const out = flattenComfyError(f.body);
    expect(out).toBe(f.expected);
  }

  describe('Arm 1: flattenComfyError direct', () => {
    test(`Fixture A: ${FIXTURE_A.label}`, () => assertHelperParity(FIXTURE_A));
    test(`Fixture B: ${FIXTURE_B.label}`, () => assertHelperParity(FIXTURE_B));
    test(`Fixture C: ${FIXTURE_C.label}`, () => assertHelperParity(FIXTURE_C));
    test(`Fixture D: ${FIXTURE_D.label}`, () => assertHelperParity(FIXTURE_D));
  });

  // -------------------- Submit-time arm --------------------
  // Submit-time receives the parsed body via JSON.parse. For Fixture C, the
  // body is a bare string — JSON.stringify('Cloud bored, retry later') →
  // '"Cloud bored, retry later"' (a JSON string literal), which parses back
  // to the bare string. flattenComfyError handles that branch. For Fixture D
  // (missing error), we send an empty body so JSON.parse returns null →
  // flattenComfyError(null) → 'ComfyUI reported failed' → submit's fallback
  // flips to the status/statusText line because the helper-fallback literal
  // is the SIGNAL for "no actionable detail".
  async function assertSubmitParity(f: ParityFixture): Promise<void> {
    const fetchImpl = makeSubmit4xxFetch(400, f.body);
    const client = new ComfyUIClient(KEY, BASE, { fetchImpl });

    let caught: TypedError | undefined;
    try {
      await client.submit({ '1': { class_type: 'KSampler', inputs: {} } });
    } catch (err) {
      caught = err as TypedError;
    }
    expect(caught).toBeDefined();
    expect(caught!.name).toBe('TypedError');
    expect(caught!.code).toBe('COMFYUI_API_ERROR');

    if (f.expected === 'ComfyUI reported failed') {
      // Fixture D / fallback — submit flips to status/statusText. The
      // helper's fallback literal is the SIGNAL for submit to switch
      // wording. Assert the operator-friendly fallback fires (proves
      // the helper-fallback short-circuit is wired correctly per the
      // Plan 11-01 decision: "treat 'ComfyUI reported failed' as 'no
      // actionable detail' so 5xx / empty-body responses keep the
      // existing 'ComfyUI request failed: {status} {statusText}' fallback").
      expect(caught!.message).toMatch(/ComfyUI request failed: 400/);
    } else {
      // Fixtures A / B / C — TypedError.message contains the byte-equal
      // helper output (post-scrubAndTruncate; clean fixtures → no-op).
      expect(caught!.message).toContain(f.expected);
    }
  }

  describe('Arm 2: ComfyUIClient.submit() 4xx → TypedError.message', () => {
    test(`Fixture A: ${FIXTURE_A.label}`, async () => {
      await assertSubmitParity(FIXTURE_A);
    });
    test(`Fixture B: ${FIXTURE_B.label}`, async () => {
      await assertSubmitParity(FIXTURE_B);
    });
    test(`Fixture C: ${FIXTURE_C.label}`, async () => {
      await assertSubmitParity(FIXTURE_C);
    });
    test(`Fixture D: ${FIXTURE_D.label}`, async () => {
      await assertSubmitParity(FIXTURE_D);
    });
  });

  // -------------------- Status-path arm --------------------
  // Drive the four fixtures through the fake's escape hatch:
  //   A/B: object with node_errors → set cannedFailedError to the object
  //        verbatim. The engine's failed branch sees remote.error ===
  //        { node_errors: {...} } and flattenComfyError extracts the same
  //        string the helper-direct arm produced.
  //   C:   string → set cannedFailedError = string.
  //   D:   undefined → use OMIT_ERROR sentinel so status() returns
  //        { status: 'failed' } with no error field at all.
  async function assertStatusParity(f: ParityFixture): Promise<void> {
    ctx.fake.scenario = 'failed-workflow';
    if (f.body === undefined) {
      ctx.fake.cannedFailedError = FakeComfyUIClient.OMIT_ERROR;
    } else {
      ctx.fake.cannedFailedError = f.body;
    }

    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, `job-parity-${nanoid(4)}`);
    const res = await ctx.engine.getGenerationStatus(row.id);

    expect(res.entity.status).toBe('failed');
    expect(res.entity.error_code).toBe('COMFYUI_API_ERROR');
    // Byte-equal parity with the helper-direct arm.
    // Status path's scrubErrorValue is a no-op on clean fixtures (no
    // API-key-shaped substrings), so flattenComfyError output reaches
    // versions.error_message verbatim.
    expect(res.entity.error_message).toBe(f.expected);
  }

  describe('Arm 3: GenerationEngine.getGenerationStatus() failed branch → versions.error_message', () => {
    test(`Fixture A: ${FIXTURE_A.label}`, async () => {
      await assertStatusParity(FIXTURE_A);
    });
    test(`Fixture B: ${FIXTURE_B.label}`, async () => {
      await assertStatusParity(FIXTURE_B);
    });
    test(`Fixture C: ${FIXTURE_C.label}`, async () => {
      await assertStatusParity(FIXTURE_C);
    });
    test(`Fixture D: ${FIXTURE_D.label}`, async () => {
      await assertStatusParity(FIXTURE_D);
    });
  });

  // -------------------- Cross-arm parity proof --------------------
  test('parity invariant: helper output equals status-path versions.error_message for all fixtures', async () => {
    // Proves byte-equality across the helper-direct and status-path arms in
    // a single sweep. (Submit-path is asserted separately above because it
    // wraps with scrubAndTruncate + a status/statusText fallback for the
    // missing-error case — see Plan 11-01 decision #1.)
    for (const f of ALL_FIXTURES) {
      // Reset fake state for each fixture inside the loop.
      ctx.fake.reset();
      ctx.fake.scenario = 'failed-workflow';
      if (f.body === undefined) {
        ctx.fake.cannedFailedError = FakeComfyUIClient.OMIT_ERROR;
      } else {
        ctx.fake.cannedFailedError = f.body;
      }

      const helperOutput = flattenComfyError(f.body);
      const row = ctx.versions.insertVersion(ctx.shotId);
      ctx.versions.setJobId(row.id, `job-sweep-${nanoid(4)}`);
      const res = await ctx.engine.getGenerationStatus(row.id);

      expect(helperOutput).toBe(f.expected);
      expect(res.entity.error_message).toBe(helperOutput);
    }
  });

  // -------------------- IT-10 regression cross-check --------------------
  test('IT-10 contract: cancelled-status (no error field) emits exact "ComfyUI reported failed" literal via parity helper', async () => {
    // Mirrors the IT-10 assertion in src/engine/__tests__/generation.test.ts:308.
    // Belt-and-suspenders: if a future refactor accidentally changes the
    // helper's third branch literal, this test fires first (faster signal
    // than waiting for the IT-10 test to break in a separate file).
    ctx.fake.scenario = 'cancelled-status'; // returns { status: 'cancelled' } with no error
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-it10-parity');
    const res = await ctx.engine.getGenerationStatus(row.id);
    expect(res.entity.status).toBe('failed');
    expect(res.entity.error_message).toBe('ComfyUI reported failed');
    // Byte-equal helper assertion as well.
    expect(flattenComfyError(undefined)).toBe('ComfyUI reported failed');
  });
});
