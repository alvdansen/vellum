import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildStackWithOutputs } from '../../test-utils/fixtures.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import { streamToPath } from '../../utils/stream-to-path.js';

/**
 * REGRESSION — concurrent completion must not duplicate an append-only record
 * or download the same asset twice.
 *
 * getGenerationStatus reads its terminal-state short-circuit BEFORE the
 * provider call and the download, so two callers arriving inside that async
 * window both sailed past it: each polled, each ran downloadAndPersist, and
 * each appended a `completed` provenance event. Only markCompleted was
 * idempotent, so the version row looked right while the record it is supposed
 * to guarantee had gained a permanent duplicate.
 *
 * The dashboard poller, an agent's `generation.check`, and the boot recovery
 * poller all reach this path, so the collision needs no unusual setup.
 */

const WORKFLOW = { '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7 } } };

describe('concurrent getGenerationStatus', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups) c();
    cleanups.length = 0;
  });

  async function seed(): Promise<{
    stack: ReturnType<typeof buildStackWithOutputs>;
    versionId: string;
  }> {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    const ws = stack.engine.createWorkspace('ws1');
    const proj = stack.engine.createProject(ws.entity.id, 'p1');
    const seq = stack.engine.createSequence(proj.entity.id, 'sq010');
    const shot = stack.engine.createShot(seq.entity.id, 'sh010');
    const submitted = await stack.engine.submitGeneration(shot.entity.id, WORKFLOW);
    return { stack, versionId: submitted.entity.id };
  }

  function completedEvents(
    sqlite: import('better-sqlite3').Database,
    versionId: string,
  ): number {
    const row = sqlite
      .prepare("SELECT COUNT(*) AS n FROM provenance WHERE version_id = ? AND event_type = 'completed'")
      .get(versionId) as { n: number };
    return row.n;
  }

  it('two simultaneous checks append exactly one completed event', async () => {
    const { stack, versionId } = await seed();
    // Give the provider a real async window for the second caller to enter.
    (stack.client as FakeComfyUIClient).statusDelayMs = 40;

    await Promise.all([
      stack.engine.getGenerationStatus(versionId),
      stack.engine.getGenerationStatus(versionId),
    ]);
    await stack.engine.stop();

    expect(completedEvents(stack.sqlite, versionId)).toBe(1);
  });

  it('two simultaneous checks download the asset once, not twice', async () => {
    const { stack, versionId } = await seed();
    const client = stack.client as FakeComfyUIClient;
    client.statusDelayMs = 40;

    await Promise.all([
      stack.engine.getGenerationStatus(versionId),
      stack.engine.getGenerationStatus(versionId),
    ]);
    await stack.engine.stop();

    const downloads = client.calls.filter((c) => c.method === 'download');
    expect(downloads).toHaveLength(1);
  });

  it('five simultaneous checks still append exactly one completed event', async () => {
    const { stack, versionId } = await seed();
    (stack.client as FakeComfyUIClient).statusDelayMs = 30;

    const results = await Promise.all(
      Array.from({ length: 5 }, () => stack.engine.getGenerationStatus(versionId)),
    );
    await stack.engine.stop();

    expect(completedEvents(stack.sqlite, versionId)).toBe(1);
    // Every caller still gets a correct answer.
    for (const r of results) expect(r.entity.status).toBe('completed');
  });

  it('another writer failing the version mid-flight leaves no contradicting completion', async () => {
    // REGRESSION — the CROSS-PROCESS half, which the in-process mutex above
    // cannot close (it is per-instance). Process B fails the version while
    // process A is inside its async download window. The event write used to be
    // unconditional on the failed side and gated by a read-then-write existence
    // check on the completed side, so the append-only record ended up holding
    // both a `failed` and a `completed` event for one version — permanently.
    //
    // Now the guarded row UPDATE is the arbiter: whoever gets changes === 1
    // writes the event, and the loser writes nothing. Simulated here by making
    // the other writer's transition land during A's status delay, which is the
    // same interleaving two processes produce.
    const { stack, versionId } = await seed();
    const client = stack.client as FakeComfyUIClient;
    client.statusDelayMs = 60;

    const inFlight = stack.engine.getGenerationStatus(versionId);
    // The "other process" claims the terminal transition first.
    await new Promise((r) => setTimeout(r, 20));
    stack.sqlite
      .prepare(
        "UPDATE versions SET status='failed', error_code='GENERATION_TIMEOUT', completed_at=? WHERE id=? AND completed_at IS NULL",
      )
      .run(Date.now(), versionId);

    await inFlight;
    await stack.engine.stop();

    const failed = stack.sqlite
      .prepare("SELECT COUNT(*) AS n FROM provenance WHERE version_id=? AND event_type='failed'")
      .get(versionId) as { n: number };
    // Exactly one terminal event, and it is the one the row agrees with.
    expect(completedEvents(stack.sqlite, versionId)).toBe(0);
    expect(failed.n).toBe(0); // the other writer owns writing its own event
    const row = stack.sqlite
      .prepare('SELECT status FROM versions WHERE id=?')
      .get(versionId) as { status: string };
    expect(row.status).toBe('failed');
  });
  it('a writer that loses the completion claim leaves the record with just the winner\'s completion', async () => {
    // An end-to-end guard on the invariant: a caller that LOSES the terminal
    // claim must contribute nothing to the append-only record.
    //
    // Honest scope note — this is a guard, not a verified regression test. It
    // does NOT fail against the code before the fingerprint hook was moved
    // inside the winner branch: reproducing that duplication needs the losing
    // process to reach the hook with a winner's completed event already visible
    // to it, and this single-process simulation does not get there. The hook
    // gating is pinned at the repo level instead, by "the loser does not run its
    // append at all" in terminal-transition-claim.test.ts. What this test does
    // pin is the outcome that matters at the boundary: one completion, no
    // contradiction, nothing extra.
    const { stack, versionId } = await seed();
    const client = stack.client as FakeComfyUIClient;
    client.statusDelayMs = 60;

    const inFlight = stack.engine.getGenerationStatus(versionId);
    await new Promise((r) => setTimeout(r, 20));
    // The "other process" wins the terminal transition mid-download — row AND
    // event, the way a real winner leaves it. The event matters: the fingerprint
    // hook bails when there is no completed event to read a prompt blob from, so
    // a winner simulated by a bare UPDATE cannot expose the duplication at all.
    stack.sqlite
      .prepare(
        "UPDATE versions SET status='completed', outputs_json='[]', completed_at=? WHERE id=? AND completed_at IS NULL",
      )
      .run(Date.now(), versionId);
    stack.sqlite
      .prepare(
        "INSERT INTO provenance (id, version_id, event_type, timestamp, prompt_json, outputs_json) VALUES (?,?,?,?,?,?)",
      )
      .run(
        'prov_winner_test',
        versionId,
        'completed',
        Date.now(),
        JSON.stringify({ '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } } }),
        '[]',
      );

    await inFlight;
    // The fingerprint hook is fire-and-forget (`void X.catch(...)`), so its
    // event lands AFTER the completion path returns. Settle before asserting —
    // without this the test passes against the buggy code simply by reading the
    // table too early.
    await new Promise((r) => setTimeout(r, 300));
    await stack.engine.stop();

    const counts = stack.sqlite
      .prepare('SELECT event_type, COUNT(*) AS n FROM provenance WHERE version_id=? GROUP BY event_type')
      .all(versionId) as Array<{ event_type: string; n: number }>;
    const byType = Object.fromEntries(counts.map((r) => [r.event_type, r.n]));

    // Exactly the winner's one completion, and nothing hanging off it that the
    // LOSER contributed — no second completion, no failure, and no
    // models_fingerprinted appended by a caller that did not win the claim.
    expect(byType.completed ?? 0).toBe(1);
    expect(byType.models_fingerprinted ?? 0).toBe(0);
    expect(byType.failed ?? 0).toBe(0);
  });

});

/**
 * REGRESSION — two downloaders of one output must not share a temp file.
 *
 * streamToPath wrote every download to a fixed `${destPath}.partial`. Two
 * downloaders resolving the same final path therefore wrote the same temp: the
 * first rename won, and the second failed with ENOENT after streaming the whole
 * payload — a completed transfer reported as a failure, with a stray .partial
 * left on disk.
 */
describe('streamToPath temp files', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
    dirs.length = 0;
  });

  function bytes(n: number): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(n).fill(7));
        controller.close();
      },
    });
  }

  it('two concurrent writes to the same destination both succeed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vellum-partial-'));
    dirs.push(dir);
    const dest = join(dir, 'take.bin');

    const results = await Promise.allSettled([
      streamToPath(bytes(2048), dest),
      streamToPath(bytes(2048), dest),
    ]);

    // Neither loses its payload to the other's rename.
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    // And no temp file is orphaned next to the output.
    expect(readdirSync(dir).filter((f) => f.includes('.partial'))).toEqual([]);
  });

  it('the temp path is unique per call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vellum-partial-'));
    dirs.push(dir);
    const dest = join(dir, 'sub', 'take.bin');
    mkdirSync(dirname(dest), { recursive: true });
    // A stale temp under the OLD fixed scheme must not be picked up or clobbered.
    writeFileSync(`${dest}.partial`, 'stale');

    await streamToPath(bytes(512), dest);

    expect(readdirSync(dirname(dest)).sort()).toEqual(['take.bin', 'take.bin.partial']);
  });
});
