import { describe, it, test, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { Engine } from '../pipeline.js';
import type { ComfyUIClient } from '../../comfyui/client.js';
import { parseMaxInFlight, parseSpendLimit, type SpendLimit } from '../../utils/spend-limits.js';

/**
 * Operator ceilings on what a runaway caller can set running and spend.
 *
 * The approval gate asks a human about EACH take; these bound what happens when
 * nobody is asking. Both are opt-in — unset means unlimited, which is the
 * behaviour every existing deployment already has.
 */

const WORKFLOW = { '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7 } } };

function buildEngine(options: {
  maxInFlightGenerations?: number | null;
  spendLimit?: SpendLimit | null;
}): {
  engine: Engine;
  shotId: string;
  db: ReturnType<typeof makeInMemoryDb>['db'];
  cleanup: () => void;
} {
  const { db } = makeInMemoryDb();
  const outputsDir = mkdtempSync(join(tmpdir(), 'vfx-limits-'));
  const engine = new Engine(
    db,
    new HierarchyRepo(db),
    new VersionRepo(db),
    new ProvenanceRepo(db),
    new FakeComfyUIClient() as unknown as ComfyUIClient,
    outputsDir,
    { maxConcurrentPollers: 1, ...options },
  );
  const ws = engine.createWorkspace('ws1');
  const proj = engine.createProject(ws.entity.id, 'p1');
  const seq = engine.createSequence(proj.entity.id, 'sq010');
  const shotId = engine.createShot(seq.entity.id, 'sh010').entity.id;
  return {
    engine,
    shotId,
    db,
    cleanup: () => {
      try {
        rmSync(outputsDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

/** Distinct requests, so the duplicate-submit guard is not what refuses them. */
function workflowN(n: number): Record<string, unknown> {
  return { '3': { class_type: 'KSampler', inputs: { seed: n, steps: 20, cfg: 7 } } };
}

describe('in-flight ceiling', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups) c();
    cleanups.length = 0;
  });

  it('refuses a submit once the ceiling is reached', async () => {
    const { engine, shotId, cleanup } = buildEngine({ maxInFlightGenerations: 2 });
    cleanups.push(cleanup);

    await engine.submitGeneration(shotId, workflowN(1));
    await engine.submitGeneration(shotId, workflowN(2));
    await expect(engine.submitGeneration(shotId, workflowN(3))).rejects.toMatchObject({
      code: 'TOO_MANY_IN_FLIGHT',
    });
  });

  it('leaves no version row behind when it refuses', async () => {
    const { engine, shotId, db, cleanup } = buildEngine({ maxInFlightGenerations: 1 });
    cleanups.push(cleanup);

    await engine.submitGeneration(shotId, workflowN(1));
    await expect(engine.submitGeneration(shotId, workflowN(2))).rejects.toThrow();

    // The refusal runs before any DB write, so a rejected submit must not
    // leave a row that would itself count against the ceiling forever.
    expect(new VersionRepo(db).countInFlight()).toBe(1);
  });

  it('a finished generation frees a slot', async () => {
    const { engine, shotId, cleanup } = buildEngine({ maxInFlightGenerations: 1 });
    cleanups.push(cleanup);

    const first = await engine.submitGeneration(shotId, workflowN(1));
    await expect(engine.submitGeneration(shotId, workflowN(2))).rejects.toMatchObject({
      code: 'TOO_MANY_IN_FLIGHT',
    });

    await engine.getGenerationStatus(first.entity.id); // completes via the fake
    await engine.stop();

    await expect(engine.submitGeneration(shotId, workflowN(3))).resolves.toBeDefined();
  });

  it('unset means unlimited', async () => {
    const { engine, shotId, cleanup } = buildEngine({});
    cleanups.push(cleanup);
    for (let i = 0; i < 5; i++) {
      await expect(engine.submitGeneration(shotId, workflowN(i))).resolves.toBeDefined();
    }
  });
});

describe('recorded-spend ceiling', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups) c();
    cleanups.length = 0;
  });

  it('refuses a submit once recorded spend reaches the ceiling', async () => {
    const { engine, shotId, cleanup } = buildEngine({
      spendLimit: { amount: 10, currency: 'USD', windowMs: 3_600_000 },
    });
    cleanups.push(cleanup);

    const v = await engine.submitGeneration(shotId, workflowN(1));
    engine.recordCost(v.entity.id, { amount: 10, currency: 'USD' });

    await expect(engine.submitGeneration(shotId, workflowN(2))).rejects.toMatchObject({
      code: 'SPEND_LIMIT_REACHED',
    });
  });

  it('spend below the ceiling still submits', async () => {
    const { engine, shotId, cleanup } = buildEngine({
      spendLimit: { amount: 10, currency: 'USD', windowMs: 3_600_000 },
    });
    cleanups.push(cleanup);

    const v = await engine.submitGeneration(shotId, workflowN(1));
    engine.recordCost(v.entity.id, { amount: 9.5, currency: 'USD' });
    await expect(engine.submitGeneration(shotId, workflowN(2))).resolves.toBeDefined();
  });

  it('a different currency does not count toward the ceiling', async () => {
    const { engine, shotId, cleanup } = buildEngine({
      spendLimit: { amount: 10, currency: 'USD', windowMs: 3_600_000 },
    });
    cleanups.push(cleanup);

    const v = await engine.submitGeneration(shotId, workflowN(1));
    engine.recordCost(v.entity.id, { amount: 500, currency: 'EUR' });
    // Summing mixed currencies would be meaningless, so EUR spend cannot
    // exhaust a USD budget.
    await expect(engine.submitGeneration(shotId, workflowN(2))).resolves.toBeDefined();
  });

  it('a correction replaces rather than adds to the earlier record', async () => {
    const { engine, shotId, cleanup } = buildEngine({
      spendLimit: { amount: 10, currency: 'USD', windowMs: 3_600_000 },
    });
    cleanups.push(cleanup);

    const v = await engine.submitGeneration(shotId, workflowN(1));
    engine.recordCost(v.entity.id, { amount: 8, currency: 'USD' });
    // Cost records are append-only; a correction is a NEWER sibling event.
    // Counting both would falsely total 11 and trip the ceiling.
    engine.recordCost(v.entity.id, { amount: 3, currency: 'USD', note: 'corrected' });
    await expect(engine.submitGeneration(shotId, workflowN(2))).resolves.toBeDefined();
  });

  it('spend outside the window does not count', async () => {
    const { engine, shotId, cleanup } = buildEngine({
      spendLimit: { amount: 10, currency: 'USD', windowMs: 1 }, // 1ms window
    });
    cleanups.push(cleanup);

    const v = await engine.submitGeneration(shotId, workflowN(1));
    engine.recordCost(v.entity.id, { amount: 100, currency: 'USD' });
    await new Promise((r) => setTimeout(r, 20));
    await expect(engine.submitGeneration(shotId, workflowN(2))).resolves.toBeDefined();
  });

  it('unset means unlimited', async () => {
    const { engine, shotId, cleanup } = buildEngine({});
    cleanups.push(cleanup);
    const v = await engine.submitGeneration(shotId, workflowN(1));
    engine.recordCost(v.entity.id, { amount: 1_000_000, currency: 'USD' });
    await expect(engine.submitGeneration(shotId, workflowN(2))).resolves.toBeDefined();
  });
});

describe('parseMaxInFlight', () => {
  test.each([undefined, '', '   ', 'abc', '0', '-3', '2.5'])('%j → null (unlimited)', (raw) => {
    expect(parseMaxInFlight(raw)).toBeNull();
  });
  it('parses a positive integer', () => {
    expect(parseMaxInFlight('3')).toBe(3);
    expect(parseMaxInFlight(' 12 ')).toBe(12);
  });
});

describe('parseSpendLimit', () => {
  test.each([undefined, '', 'abc', '0', '-5'])('%j → null (unlimited)', (raw) => {
    expect(parseSpendLimit(raw, undefined, undefined)).toBeNull();
  });

  it('defaults to USD over 24h', () => {
    expect(parseSpendLimit('25', undefined, undefined)).toEqual({
      amount: 25,
      currency: 'USD',
      windowMs: 24 * 60 * 60 * 1000,
    });
  });

  it('normalizes currency and honours a window override', () => {
    expect(parseSpendLimit('25', 'eur', '6')).toEqual({
      amount: 25,
      currency: 'EUR',
      windowMs: 6 * 60 * 60 * 1000,
    });
  });

  it('falls back to the default window when it is garbage', () => {
    expect(parseSpendLimit('25', 'USD', 'soon')?.windowMs).toBe(24 * 60 * 60 * 1000);
  });
});
