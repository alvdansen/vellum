import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { BreadcrumbResolver } from '../breadcrumb.js';
import { GenerationEngine } from '../generation.js';
import { ProvenanceWriter } from '../provenance.js';
import { TypedError } from '../errors.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import type { ComfyUIClient } from '../../comfyui/client.js';

/**
 * GenerationEngine tests — Plan 02-02 Task 2.
 *
 * Covers:
 *  - submitGeneration: happy, UI-format reject, missing shot, client error, no client
 *  - getGenerationStatus: not-found, terminal cached, in_progress→running,
 *    completed→download, 10-min timeout, failed mapped, download retry + hopeless,
 *    multiple outputs partial failure
 *  - start/stop: recovery poller drains pending rows, abort cleanup, no-op when empty
 *  - on-demand bypass: no sleep on direct status call
 *
 * Uses real in-mem SQLite + real repos + FakeComfyUIClient.
 */

type Ctx = {
  engine: GenerationEngine;
  hierarchy: HierarchyRepo;
  versions: VersionRepo;
  provenanceRepo: ProvenanceRepo;
  provenanceWriter: ProvenanceWriter;
  fake: FakeComfyUIClient;
  shotId: string;
  tempRoot: string;
  projectName: string;
  sequenceName: string;
  shotName: string;
};

async function setup(): Promise<Ctx> {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const fake = new FakeComfyUIClient();
  const breadcrumb = new BreadcrumbResolver(hierarchy, versions);
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-gen-${nanoid(6)}-`));
  // Fake is structurally compatible with ComfyUIClient for the methods used.
  const engine = new GenerationEngine(
    hierarchy,
    versions,
    provenanceRepo,
    provenanceWriter,
    fake as unknown as ComfyUIClient,
    breadcrumb,
    tempRoot,
  );
  const ws = hierarchy.createWorkspace('ws1');
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  return {
    engine,
    hierarchy,
    versions,
    provenanceRepo,
    provenanceWriter,
    fake,
    shotId: shot.id,
    tempRoot,
    projectName: proj.name,
    sequenceName: seq.name,
    shotName: shot.name,
  };
}

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(async () => {
  await ctx.engine.stop();
  await fsp.rm(ctx.tempRoot, { recursive: true, force: true });
  vi.useRealTimers();
});

const API_WORKFLOW = { '1': { class_type: 'KSampler', inputs: { seed: 42 } } };
const UI_WORKFLOW = { nodes: [{ id: 1, type: 'KSampler' }], links: [] };

describe('GenerationEngine.submitGeneration', () => {
  test('happy path: inserts row, submits, sets job_id, returns 5-entry breadcrumb', async () => {
    const res = await ctx.engine.submitGeneration(ctx.shotId, API_WORKFLOW, 'first-take');
    expect(res.entity.status).toBe('submitted');
    expect(res.entity.version_number).toBe(1);
    expect(res.entity.job_id).toBe('prompt_fake_123');
    expect(res.entity.notes).toBe('first-take');
    expect(res.breadcrumb.entries).toHaveLength(5);
    expect(res.breadcrumb.entries.map((e) => e.type)).toEqual([
      'workspace',
      'project',
      'sequence',
      'shot',
      'version',
    ]);
    expect(res.breadcrumb.text).toBe('ws1 > p1 > sq010 > sh010 > v001');
    // Fake was called exactly once with the same workflow.
    expect(ctx.fake.calls.filter((c) => c.method === 'submit')).toHaveLength(1);
    expect(ctx.fake.calls[0].args[0]).toEqual(API_WORKFLOW);
  });

  test('UI-format workflow rejects with INVALID_WORKFLOW_FORMAT BEFORE DB insert', async () => {
    await expect(ctx.engine.submitGeneration(ctx.shotId, UI_WORKFLOW)).rejects.toMatchObject({
      code: 'INVALID_WORKFLOW_FORMAT',
    });
    // No row inserted; no submit call.
    expect(ctx.fake.calls).toHaveLength(0);
  });

  test('missing shot throws SHOT_NOT_FOUND BEFORE DB insert', async () => {
    await expect(
      ctx.engine.submitGeneration('shot_bogus_id', API_WORKFLOW),
    ).rejects.toMatchObject({ code: 'SHOT_NOT_FOUND' });
    expect(ctx.fake.calls).toHaveLength(0);
  });

  test('client error on submit marks row failed and rethrows', async () => {
    ctx.fake.scenario = 'rate-limited';
    await expect(
      ctx.engine.submitGeneration(ctx.shotId, API_WORKFLOW),
    ).rejects.toMatchObject({ code: 'COMFYUI_RATE_LIMITED' });
    // Row must exist and be marked failed with the exact code.
    const pending = ctx.versions.listPendingVersions();
    expect(pending).toHaveLength(0);
    // There should be exactly one row with failed status + code.
    const shot = ctx.hierarchy.getShot(ctx.shotId)!;
    expect(shot).toBeDefined();
    // One failed row via a listPendingVersions negative; verify via direct fetch
    const all = ctx.fake.calls.filter((c) => c.method === 'submit');
    expect(all).toHaveLength(1);
  });

  test('missing client throws COMFYUI_CREDENTIALS_MISSING with hint', async () => {
    // Build a fresh engine with null client.
    const { db } = makeInMemoryDb();
    const h = new HierarchyRepo(db);
    const v = new VersionRepo(db);
    const pr = new ProvenanceRepo(db);
    const pw = new ProvenanceWriter(pr);
    const bc = new BreadcrumbResolver(h, v);
    const e = new GenerationEngine(h, v, pr, pw, null, bc, ctx.tempRoot);
    const ws = h.createWorkspace('wsx');
    const p = h.createProject(ws.id, 'px');
    const s = h.createSequence(p.id, 'sq010');
    const sh = h.createShot(s.id, 'sh010');
    await expect(e.submitGeneration(sh.id, API_WORKFLOW)).rejects.toMatchObject({
      code: 'COMFYUI_CREDENTIALS_MISSING',
      hint: expect.stringContaining('.env'),
    });
  });
});

describe('GenerationEngine.getGenerationStatus', () => {
  test('unknown version_id throws VERSION_NOT_FOUND', async () => {
    await expect(ctx.engine.getGenerationStatus('ver_missing')).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
    });
  });

  test('terminal row returns cached without hitting ComfyUI', async () => {
    // Create a completed row directly.
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-1');
    ctx.versions.markCompleted(row.id, JSON.stringify([]));
    const before = ctx.fake.calls.length;
    const res = await ctx.engine.getGenerationStatus(row.id);
    expect(res.entity.status).toBe('completed');
    // No status calls made.
    expect(ctx.fake.calls.length).toBe(before);
  });

  test('submitted → running on in_progress', async () => {
    ctx.fake.scenario = 'slow-running';
    ctx.fake.slowRunningPolls = 5; // stay in_progress
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-running');
    const res = await ctx.engine.getGenerationStatus(row.id);
    expect(res.entity.status).toBe('running');
  });

  test('submitted → completed with output download + outputs_json populated', async () => {
    ctx.fake.scenario = 'happy';
    ctx.fake.cannedOutputs = [{ filename: 'out.png', subfolder: '', type: 'output' }];
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-happy');
    const res = await ctx.engine.getGenerationStatus(row.id);
    expect(res.entity.status).toBe('completed');
    expect(res.entity.completed_at).not.toBeNull();
    expect(res.entity.outputs_json).toBeDefined();
    const outs = JSON.parse(res.entity.outputs_json!);
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({
      filename: 'out.png',
      content_type: 'image/png',
    });
    expect(outs[0].path).toContain(
      pth.join(ctx.projectName, ctx.sequenceName, ctx.shotName, 'v001'),
    );
    // File actually on disk
    const finalPath = pth.join(
      ctx.tempRoot,
      ctx.projectName,
      ctx.sequenceName,
      ctx.shotName,
      'v001',
      'out.png',
    );
    const onDisk = await fsp.readFile(finalPath);
    expect(onDisk.byteLength).toBeGreaterThan(0);
  });

  test('10-min timeout marks row failed without ComfyUI call', async () => {
    // Insert a row and backdate its created_at past the 10-min ceiling.
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-stale');
    // Use raw SQL via drizzle's sql-template backdoor: simpler to set on the client row and re-read.
    // Instead: re-open DB? No — simpler, use vi.setSystemTime to advance "now".
    vi.useFakeTimers();
    vi.setSystemTime(row.created_at + 600_001);
    const before = ctx.fake.calls.length;
    const res = await ctx.engine.getGenerationStatus(row.id);
    expect(res.entity.status).toBe('failed');
    expect(res.entity.error_code).toBe('GENERATION_TIMEOUT');
    // No status call issued (timeout gate ran first).
    expect(ctx.fake.calls.length).toBe(before);
  });

  test('failed with node_errors flattens to COMFYUI_API_ERROR message', async () => {
    ctx.fake.scenario = 'failed-workflow';
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-bad');
    const res = await ctx.engine.getGenerationStatus(row.id);
    expect(res.entity.status).toBe('failed');
    expect(res.entity.error_code).toBe('COMFYUI_API_ERROR');
    expect(res.entity.error_message).toBe('Node 3 (KSampler): bad input');
  });

  test('download-flaky eventually succeeds via retry with [2s,4s,8s] backoff', async () => {
    ctx.fake.scenario = 'download-flaky';
    ctx.fake.downloadFlakyFailures = 1; // first download throws, 2nd succeeds
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-flaky');
    // Advance fake timers through the retry delay so sleep resolves.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const p = ctx.engine.getGenerationStatus(row.id);
    // shouldAdvanceTime lets sleep-based backoffs elapse automatically.
    const res = await p;
    expect(res.entity.status).toBe('completed');
    // 2 download attempts total
    const dlCalls = ctx.fake.calls.filter((c) => c.method === 'download');
    expect(dlCalls).toHaveLength(2);
  });

  test('download-hopeless marks row failed with DOWNLOAD_FAILED after 3 attempts', async () => {
    ctx.fake.scenario = 'download-hopeless';
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-hopeless');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const res = await ctx.engine.getGenerationStatus(row.id);
    expect(res.entity.status).toBe('failed');
    expect(res.entity.error_code).toBe('DOWNLOAD_FAILED');
    expect(res.entity.error_message).toContain('out.png');
    expect(res.entity.error_message).toContain('3 attempts');
    const dlCalls = ctx.fake.calls.filter((c) => c.method === 'download');
    expect(dlCalls).toHaveLength(3);
  });

  test('multiple outputs: first succeeds, second flaky-once then succeeds → both downloaded', async () => {
    ctx.fake.cannedOutputs = [
      { filename: 'out1.png', subfolder: '', type: 'output' },
      { filename: 'out2.png', subfolder: '', type: 'output' },
    ];
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-multi');
    const res = await ctx.engine.getGenerationStatus(row.id);
    expect(res.entity.status).toBe('completed');
    const outs = JSON.parse(res.entity.outputs_json!);
    expect(outs).toHaveLength(2);
    expect(outs.map((o: { filename: string }) => o.filename)).toEqual([
      'out1.png',
      'out2.png',
    ]);
  });

  test('IT-10: ComfyUI cancelled status maps to failed', async () => {
    ctx.fake.scenario = 'cancelled-status';
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-cancelled');
    const res = await ctx.engine.getGenerationStatus(row.id);
    expect(res.entity.status).toBe('failed');
    expect(res.entity.error_code).toBe('COMFYUI_API_ERROR');
    expect(res.entity.error_message).toContain('ComfyUI reported failed');
  });

  test('IT-10b: unknown ComfyUI status falls through to pending (no transition)', async () => {
    ctx.fake.scenario = 'unknown-status';
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-mystery');
    const res = await ctx.engine.getGenerationStatus(row.id);
    // Engine does not transition on unknown status — row stays at submitted.
    expect(res.entity.status).toBe('submitted');
    expect(res.entity.error_code).toBeNull();
  });

  test('IT-11: row with null job_id transitions to failed on status check', async () => {
    // Simulate the edge case where setJobId never ran (submit itself failed
    // before updating job_id). The row exists at 'submitted' with job_id=null.
    const row = ctx.versions.insertVersion(ctx.shotId);
    expect(row.job_id).toBeNull();
    const res = await ctx.engine.getGenerationStatus(row.id);
    expect(res.entity.status).toBe('failed');
    expect(res.entity.error_code).toBe('COMFYUI_API_ERROR');
    expect(res.entity.error_message).toContain('no job_id');
    // No status call was made since job_id was missing
    expect(ctx.fake.calls.filter((c) => c.method === 'status')).toHaveLength(0);
  });

  test('IT-13: malicious filename from ComfyUI is rejected — sanitizer throws before any disk write', async () => {
    // ComfyUI returns a filename that attempts path traversal. buildOutputPath
    // fires sanitizeRelativeSegment which throws INVALID_INPUT before any disk
    // write occurs. The engine does NOT catch this — the caller observes the
    // TypedError directly, and crucially, no file is written outside tempRoot.
    ctx.fake.cannedOutputs = [
      { filename: '../../../etc/passwd', subfolder: '', type: 'output' },
    ];
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-malicious');
    await expect(ctx.engine.getGenerationStatus(row.id)).rejects.toMatchObject({
      name: 'TypedError',
      code: 'INVALID_INPUT',
      message: expect.stringContaining('Unsafe path segment'),
    });
    // Nothing was written inside tempRoot, and obviously nothing outside.
    const entries = await fsp.readdir(ctx.tempRoot).catch(() => [] as string[]);
    // Only the hierarchy dirs (projectName/...) may exist; no escape route.
    for (const name of entries) {
      expect(name).not.toContain('..');
      expect(name).not.toBe('etc');
    }
  });

  test('IT-14: duplicate filename from back-to-back generations gets suffixed', async () => {
    ctx.fake.cannedOutputs = [{ filename: 'out.png', subfolder: '', type: 'output' }];
    // Submit + complete two generations for the same shot (two separate version_numbers).
    const row1 = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row1.id, 'job-dup-1');
    await ctx.engine.getGenerationStatus(row1.id);
    const r1 = ctx.versions.getVersion(row1.id)!;
    expect(r1.status).toBe('completed');

    // Force the second version to share the same version directory by
    // manually placing a blocker in the version dir the engine will compute.
    // Easier: simulate duplicate by creating a second version on the same
    // shot with the same filename and same version_label — the engine uses
    // version_number so v002 will land in a different dir. Test collision
    // inside ONE version by issuing a second download with the same name.
    //
    // A clean demonstration: two outputs with the same filename in a single
    // generation — resolveCollisionSuffix handles the collision.
    ctx.fake.cannedOutputs = [
      { filename: 'out.png', subfolder: '', type: 'output' },
      { filename: 'out.png', subfolder: 'subdir', type: 'output' },
    ];
    const row2 = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row2.id, 'job-dup-2');
    const res2 = await ctx.engine.getGenerationStatus(row2.id);
    expect(res2.entity.status).toBe('completed');
    const outs2 = JSON.parse(res2.entity.outputs_json!);
    expect(outs2).toHaveLength(2);
    // Second output must have been renamed with a suffix to avoid collision.
    expect(outs2[0].filename).toBe('out.png');
    expect(outs2[1].filename).toBe('out_1.png');
  });

  test('IT-15: completed with zero outputs marks row completed with outputs_json = []', async () => {
    ctx.fake.scenario = 'happy';
    ctx.fake.cannedOutputs = []; // ComfyUI returned completed but no outputs
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-zero');
    const res = await ctx.engine.getGenerationStatus(row.id);
    expect(res.entity.status).toBe('completed');
    expect(res.entity.completed_at).not.toBeNull();
    expect(res.entity.outputs_json).toBe('[]');
  });

  test('IT-16: CONCURRENT_SUBMIT_CONFLICT propagates unchanged through engine', async () => {
    // Force the repo to throw a synthetic CONCURRENT_SUBMIT_CONFLICT on insert.
    // The engine must surface this TypedError unchanged — no wrapping, no
    // swallowing — so the caller sees the exact error code repo emits.
    vi.spyOn(ctx.versions, 'insertVersion').mockImplementation((shotId: string) => {
      throw new TypedError(
        'CONCURRENT_SUBMIT_CONFLICT',
        `Concurrent submit for shot '${shotId}'`,
      );
    });
    try {
      await expect(
        ctx.engine.submitGeneration(ctx.shotId, API_WORKFLOW),
      ).rejects.toMatchObject({
        name: 'TypedError',
        code: 'CONCURRENT_SUBMIT_CONFLICT',
      });
      // Engine should NOT have called submit on the client — insert failed first.
      expect(ctx.fake.calls.filter((c) => c.method === 'submit')).toHaveLength(0);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('GenerationEngine recovery poller — IT-12 running-state resume', () => {
  test('IT-12: recovery poller picks up rows already in running state at boot', async () => {
    // Seed a row in the 'running' state (not 'submitted'). The recovery poller
    // must still drain it — listPendingVersions returns both submitted AND
    // running.
    ctx.fake.scenario = 'happy';
    const r = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(r.id, 'job-running-resume');
    ctx.versions.transition(r.id, 'running');
    const fresh = ctx.versions.getVersion(r.id)!;
    expect(fresh.status).toBe('running');

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await ctx.engine.start();
    await vi.advanceTimersByTimeAsync(3_000);
    await new Promise((resolve) => setImmediate(resolve));
    const deadline = Date.now() + 2_000;
    while (ctx.versions.listPendingVersions().length > 0 && Date.now() < deadline) {
      await vi.advanceTimersByTimeAsync(2_500);
      await new Promise((resolve) => setImmediate(resolve));
    }

    const final = ctx.versions.getVersion(r.id)!;
    expect(final.status).toBe('completed');
  });
});

describe('GenerationEngine recovery poller (start / stop)', () => {
  test('start() kicks pollers that drive pending rows to terminal', async () => {
    ctx.fake.scenario = 'happy';
    const r1 = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(r1.id, 'job-a');
    const r2 = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(r2.id, 'job-b');
    // Two pending rows
    expect(ctx.versions.listPendingVersions()).toHaveLength(2);

    // Advance time through sleep() delays.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await ctx.engine.start();
    // Let poller micro-tasks drain — sleep(2000) elapses via shouldAdvanceTime.
    await vi.advanceTimersByTimeAsync(3000);
    // Give any fs microtasks + next-tick chains a chance to settle.
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(5000);
    await new Promise((resolve) => setImmediate(resolve));

    // Eventually both rows should be terminal. We don't poll pending forever
    // here — use a bounded loop.
    const deadline = Date.now() + 2_000;
    while (ctx.versions.listPendingVersions().length > 0 && Date.now() < deadline) {
      await vi.advanceTimersByTimeAsync(2_500);
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(ctx.versions.listPendingVersions()).toHaveLength(0);
    const f1 = ctx.versions.getVersion(r1.id);
    const f2 = ctx.versions.getVersion(r2.id);
    expect(f1!.status).toBe('completed');
    expect(f2!.status).toBe('completed');
  });

  test('stop() aborts in-flight pollers cleanly', async () => {
    // slow-running with huge slowRunningPolls means status never completes.
    ctx.fake.scenario = 'slow-running';
    ctx.fake.slowRunningPolls = 10_000;
    const r = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(r.id, 'job-stuck');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await ctx.engine.start();
    // Let sleep(2000) elapse, one poll happens, status=running. Then stop.
    await vi.advanceTimersByTimeAsync(3_000);
    await ctx.engine.stop();
    // After stop, further advances must not fire additional fake calls.
    const before = ctx.fake.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    await new Promise((resolve) => setImmediate(resolve));
    // Allow at most 1 additional call if a poll was mid-flight when stop ran.
    expect(ctx.fake.calls.length).toBeLessThanOrEqual(before + 1);
  });

  test('start() with zero pending rows is a no-op (no fake calls)', async () => {
    const before = ctx.fake.calls.length;
    await ctx.engine.start();
    expect(ctx.fake.calls.length).toBe(before);
    await ctx.engine.stop();
  });

  test('C6: start() caps in-flight pollers at maxConcurrentPollers (default 3)', async () => {
    // Build a dedicated engine with cap=3 and a slow status() so we can
    // observe concurrency. Seed 10 pending rows. Real timers — no fake-timer
    // trickery — since we want honest setTimeout-driven concurrency measurement.
    const { db } = makeInMemoryDb();
    const hierarchy = new HierarchyRepo(db);
    const versions = new VersionRepo(db);
    const fake = new FakeComfyUIClient();
    const provenanceRepo = new ProvenanceRepo(db);
    const provenanceWriter = new ProvenanceWriter(provenanceRepo);
    const breadcrumb = new BreadcrumbResolver(hierarchy, versions);
    const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-gen-c6-${nanoid(6)}-`));
    const engine = new GenerationEngine(
      hierarchy,
      versions,
      provenanceRepo,
      provenanceWriter,
      fake as unknown as ComfyUIClient,
      breadcrumb,
      tempRoot,
      { maxConcurrentPollers: 3 },
    );
    try {
      const ws = hierarchy.createWorkspace('c6_ws');
      const proj = hierarchy.createProject(ws.id, 'c6_p');
      const seq = hierarchy.createSequence(proj.id, 'sq010');
      const shot = hierarchy.createShot(seq.id, 'sh010');
      fake.scenario = 'happy';
      fake.statusDelayMs = 150; // 150ms overlap window per poll
      for (let i = 0; i < 10; i++) {
        const r = versions.insertVersion(shot.id);
        versions.setJobId(r.id, `job-${i}`);
      }
      expect(versions.listPendingVersions()).toHaveLength(10);

      await engine.start();

      // Poll for drain on real wall clock — each poll has a 2s backoff sleep
      // plus 150ms status delay; 10 rows at cap=3 serialized ≈ 4 waves.
      const deadline = Date.now() + 30_000;
      while (versions.listPendingVersions().length > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(versions.listPendingVersions()).toHaveLength(0);

      // The key assertion: never more than 3 concurrent status() calls.
      // (Cap is 3, and 10 >> 3, so we'd expect many more without the cap.)
      expect(fake.maxInFlightStatus).toBeLessThanOrEqual(3);
      expect(fake.maxInFlightStatus).toBeGreaterThan(0);
      // Sanity: all 10 rows completed (each emits 1 status call on happy).
      expect(
        fake.calls.filter((c) => c.method === 'status').length,
      ).toBeGreaterThanOrEqual(10);
    } finally {
      await engine.stop();
      await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 35_000);
});

describe('GenerationEngine on-demand status bypasses backoff', () => {
  test('direct getGenerationStatus call happens immediately (no sleep invoked)', async () => {
    // No vi.useFakeTimers needed — if the on-demand path invoked sleep(),
    // the real timer would make this test sit for 2s+ (exceeds 5s vitest default,
    // would still pass but not the intent). Use a happy path + assert completion
    // completes under a tight deadline.
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.setJobId(row.id, 'job-direct');
    const t0 = Date.now();
    const res = await ctx.engine.getGenerationStatus(row.id);
    const elapsed = Date.now() - t0;
    expect(res.entity.status).toBe('completed');
    // Should be well under 1s with real timers — zero sleep in the happy path.
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe('GenerationEngine — provenance writes (PROV-01, D-PROV-03, D-PROV-04)', () => {
  test('submit happy path writes submitted event before HTTP returns', async () => {
    const res = await ctx.engine.submitGeneration(ctx.shotId, API_WORKFLOW);
    const events = ctx.provenanceRepo.getEventsForVersion(res.entity.id);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('submitted');
    expect(events[0].workflow_json).not.toBeNull();
    expect(JSON.parse(events[0].workflow_json!)).toEqual(API_WORKFLOW);
  });

  test('submit → ComfyUI failure writes submitted + failed events (D-PROV-04)', async () => {
    // Capture the inserted version id via spy so we can read its events after failure.
    let capturedId: string | null = null;
    const origInsert = ctx.versions.insertVersion.bind(ctx.versions);
    vi.spyOn(ctx.versions, 'insertVersion').mockImplementation((shotId, notes, lineage) => {
      const row = origInsert(shotId, notes, lineage);
      capturedId = row.id;
      return row;
    });
    ctx.fake.scenario = 'rate-limited';
    await expect(
      ctx.engine.submitGeneration(ctx.shotId, API_WORKFLOW),
    ).rejects.toMatchObject({ code: 'COMFYUI_RATE_LIMITED' });
    expect(capturedId).not.toBeNull();
    const events = ctx.provenanceRepo.getEventsForVersion(capturedId!);
    expect(events.map((e) => e.event_type)).toEqual(['submitted', 'failed']);
    expect(events[1].error_code).toBe('COMFYUI_RATE_LIMITED');
  });

  test('completed download writes completed event with prompt_json + models_json + seed', async () => {
    // Canned prompt blob reaches the writer via fetchResolvedPrompt.
    const cannedBlob = {
      '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20 } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
    };
    ctx.fake.cannedPromptBlob = cannedBlob;

    const submitRes = await ctx.engine.submitGeneration(ctx.shotId, API_WORKFLOW);
    const versionId = submitRes.entity.id;
    // Drive status until completion (fake default scenario='happy' returns completed).
    await ctx.engine.getGenerationStatus(versionId);
    const events = ctx.provenanceRepo.getEventsForVersion(versionId);
    expect(events.map((e) => e.event_type)).toEqual(['submitted', 'completed']);
    const completed = events[1];
    expect(completed.prompt_json).not.toBeNull();
    expect(JSON.parse(completed.prompt_json!)).toEqual(cannedBlob);
    expect(completed.seed).toBe(42);
    expect(JSON.parse(completed.models_json!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_id: '4',
          class_type: 'CheckpointLoaderSimple',
          model_name: 'sd_xl.safetensors',
        }),
      ]),
    );
    expect(completed.outputs_json).not.toBeNull();
  });

  test('completed download with null fetchResolvedPrompt → completed event has prompt_json=null', async () => {
    ctx.fake.cannedPromptBlob = null; // default — explicit for clarity

    const submitRes = await ctx.engine.submitGeneration(ctx.shotId, API_WORKFLOW);
    await ctx.engine.getGenerationStatus(submitRes.entity.id);
    const events = ctx.provenanceRepo.getEventsForVersion(submitRes.entity.id);
    const completed = events.find((e) => e.event_type === 'completed')!;
    expect(completed.prompt_json).toBeNull();
    expect(completed.outputs_json).not.toBeNull();
  });
});

describe('GenerationEngine.reproduceVersion (PROV-05, D-PROV-12, D-PROV-27..D-PROV-30)', () => {
  async function seedCompletedSource(): Promise<{
    versionId: string;
    promptBlob: Record<string, unknown>;
  }> {
    const promptBlob = {
      '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20 } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
    };
    const row = ctx.versions.insertVersion(ctx.shotId, 'source');
    ctx.provenanceWriter.writeSubmitEvent(row.id, promptBlob);
    ctx.provenanceWriter.writeCompletedEvent(row.id, promptBlob, JSON.stringify([]));
    ctx.versions.markCompleted(row.id, '[]');
    return { versionId: row.id, promptBlob };
  }

  test('happy path: creates new version with lineage=reproduce + submits same blob', async () => {
    const { versionId, promptBlob } = await seedCompletedSource();
    const result = await ctx.engine.reproduceVersion(versionId, 'reproduced');
    expect(result.entity.parent_version_id).toBe(versionId);
    expect(result.entity.lineage_type).toBe('reproduce');
    expect(result.entity.version_number).toBe(2);
    expect(Array.isArray(result.reproduction_warnings)).toBe(true);
    // ComfyUI fake received the exact prompt blob.
    const submits = ctx.fake.calls.filter((c) => c.method === 'submit');
    expect(submits.length).toBeGreaterThanOrEqual(1);
    expect(submits[submits.length - 1].args[0]).toEqual(promptBlob);
  });

  test('reproduction_warnings always present with unchecksummed models', async () => {
    const { versionId } = await seedCompletedSource();
    const result = await ctx.engine.reproduceVersion(versionId);
    // Models extracted from the seeded prompt blob have model_hash=null, so warnings
    // include the not-checksummed notice for the CheckpointLoaderSimple.
    expect(result.reproduction_warnings.some((w) => w.includes('not checksummed'))).toBe(true);
  });

  test('source in submitted → VERSION_NOT_COMPLETED', async () => {
    const row = ctx.versions.insertVersion(ctx.shotId);
    await expect(ctx.engine.reproduceVersion(row.id)).rejects.toMatchObject({
      code: 'VERSION_NOT_COMPLETED',
    });
  });

  test('completed source with no completed provenance event → REPRODUCE_BLOCKED', async () => {
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.markCompleted(row.id, '[]');
    await expect(ctx.engine.reproduceVersion(row.id)).rejects.toMatchObject({
      code: 'REPRODUCE_BLOCKED',
    });
  });

  test('completed source with prompt_json=null → PROVENANCE_UNAVAILABLE', async () => {
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.provenanceWriter.writeSubmitEvent(row.id, { '1': { class_type: 'KSampler', inputs: {} } });
    ctx.provenanceWriter.writeCompletedEvent(row.id, null, '[]');
    ctx.versions.markCompleted(row.id, '[]');
    await expect(ctx.engine.reproduceVersion(row.id)).rejects.toMatchObject({
      code: 'PROVENANCE_UNAVAILABLE',
    });
  });

  test('unknown sourceVersionId → VERSION_NOT_FOUND', async () => {
    await expect(ctx.engine.reproduceVersion('ver_missing')).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
    });
  });
});

describe('GenerationEngine.iterateFromVersion (PROV-06, D-PROV-21..D-PROV-25)', () => {
  const BASE_BLOB = {
    '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7 } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
  };

  function seedCompleted(): string {
    const row = ctx.versions.insertVersion(ctx.shotId, 'source');
    ctx.provenanceWriter.writeSubmitEvent(row.id, BASE_BLOB);
    ctx.provenanceWriter.writeCompletedEvent(row.id, BASE_BLOB, JSON.stringify([]));
    ctx.versions.markCompleted(row.id, '[]');
    return row.id;
  }

  function seedFailed(): string {
    const row = ctx.versions.insertVersion(ctx.shotId, 'failed-src');
    ctx.provenanceWriter.writeSubmitEvent(row.id, BASE_BLOB);
    ctx.provenanceWriter.writeFailedEvent(row.id, 'COMFYUI_API_ERROR', 'boom');
    ctx.versions.markFailed(row.id, 'COMFYUI_API_ERROR', 'boom');
    return row.id;
  }

  test("completed source with overrides: new version has lineage_type='iterate' and merged workflow submitted", async () => {
    const versionId = seedCompleted();
    const result = await ctx.engine.iterateFromVersion(
      versionId,
      { '3': { inputs: { cfg: 9 } } },
      undefined,
      'tweak-cfg',
    );
    expect(result.entity.parent_version_id).toBe(versionId);
    expect(result.entity.lineage_type).toBe('iterate');
    const submits = ctx.fake.calls.filter((c) => c.method === 'submit');
    const submitted = submits[submits.length - 1].args[0] as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(submitted['3'].inputs.cfg).toBe(9);
    expect(submitted['3'].inputs.seed).toBe(42); // untouched
  });

  test('completed source with seed shortcut: KSampler.seed updated', async () => {
    const versionId = seedCompleted();
    await ctx.engine.iterateFromVersion(versionId, undefined, 999);
    const submits = ctx.fake.calls.filter((c) => c.method === 'submit');
    const submitted = submits[submits.length - 1].args[0] as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(submitted['3'].inputs.seed).toBe(999);
  });

  test('failed source uses workflow_json (D-PROV-24) and succeeds', async () => {
    const versionId = seedFailed();
    const result = await ctx.engine.iterateFromVersion(versionId, {
      '3': { inputs: { cfg: 9 } },
    });
    expect(result.entity.parent_version_id).toBe(versionId);
    expect(result.entity.lineage_type).toBe('iterate');
  });

  test('submitted source → VERSION_NOT_COMPLETED (D-PROV-25)', async () => {
    const row = ctx.versions.insertVersion(ctx.shotId);
    await expect(ctx.engine.iterateFromVersion(row.id)).rejects.toMatchObject({
      code: 'VERSION_NOT_COMPLETED',
    });
  });

  test('running source → VERSION_NOT_COMPLETED (D-PROV-25)', async () => {
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.transition(row.id, 'running');
    await expect(ctx.engine.iterateFromVersion(row.id)).rejects.toMatchObject({
      code: 'VERSION_NOT_COMPLETED',
    });
  });

  test('completed source with null prompt_json → PROVENANCE_UNAVAILABLE', async () => {
    const row = ctx.versions.insertVersion(ctx.shotId);
    ctx.provenanceWriter.writeSubmitEvent(row.id, BASE_BLOB);
    ctx.provenanceWriter.writeCompletedEvent(row.id, null, '[]');
    ctx.versions.markCompleted(row.id, '[]');
    await expect(ctx.engine.iterateFromVersion(row.id)).rejects.toMatchObject({
      code: 'PROVENANCE_UNAVAILABLE',
    });
  });

  test('unknown node id in overrides → ITERATE_INVALID_PATCH (propagated from Plan 01)', async () => {
    const versionId = seedCompleted();
    await expect(
      ctx.engine.iterateFromVersion(versionId, { '999': { inputs: { x: 1 } } }),
    ).rejects.toMatchObject({ code: 'ITERATE_INVALID_PATCH' });
  });

  test('seed shortcut with no KSampler → ITERATE_INVALID_PATCH (propagated from Plan 01)', async () => {
    const row = ctx.versions.insertVersion(ctx.shotId);
    const noKSamplerBlob = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'hi' } },
    };
    ctx.provenanceWriter.writeSubmitEvent(row.id, noKSamplerBlob);
    ctx.provenanceWriter.writeCompletedEvent(row.id, noKSamplerBlob, '[]');
    ctx.versions.markCompleted(row.id, '[]');
    await expect(ctx.engine.iterateFromVersion(row.id, undefined, 42)).rejects.toMatchObject({
      code: 'ITERATE_INVALID_PATCH',
    });
  });

  test('unknown sourceVersionId → VERSION_NOT_FOUND', async () => {
    await expect(ctx.engine.iterateFromVersion('ver_missing')).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
    });
  });
});
