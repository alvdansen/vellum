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
