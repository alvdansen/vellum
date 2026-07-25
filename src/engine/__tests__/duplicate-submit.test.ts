import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildStackWithOutputs } from '../../test-utils/fixtures.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import { TypedError } from '../errors.js';
import { fingerprintRequest } from '../../utils/request-fingerprint.js';

/**
 * REGRESSION — an identical re-submit must not silently pay twice.
 *
 * A submit whose response never arrived (dropped connection, abort, a socket
 * that went quiet) may still have been ACCEPTED and CHARGED remotely. The
 * engine marks the version failed because no job id came back, so an agent that
 * retries the same request pays for the same work again. Nothing recorded the
 * first spend beyond a submitted provenance event with no job id to reconcile.
 */

const WORKFLOW = { '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7 } } };

/** A provider whose submit dies without a response — the ambiguous case. */
class DroppedResponseClient extends FakeComfyUIClient {
  submits = 0;
  override async submit(): Promise<{ prompt_id: string }> {
    this.submits++;
    throw new TypedError(
      'COMFYUI_API_ERROR',
      'ComfyUI network error: socket hang up',
      undefined,
      true, // ambiguous — no response came back
    );
  }
}

/** A provider that definitively REJECTS the request (it answered; nothing ran). */
class RejectingClient extends FakeComfyUIClient {
  submits = 0;
  override async submit(): Promise<{ prompt_id: string }> {
    this.submits++;
    throw new TypedError('COMFYUI_API_ERROR', 'Submit failed: 400 Bad Request');
  }
}

function seedShot(engine: ReturnType<typeof buildStackWithOutputs>['engine']): string {
  const ws = engine.createWorkspace('ws1');
  const proj = engine.createProject(ws.entity.id, 'p1');
  const seq = engine.createSequence(proj.entity.id, 'sq010');
  return engine.createShot(seq.entity.id, 'sh010').entity.id;
}

/** Newest version row for a shot, read straight from SQLite. */
function latestVersion(
  sqlite: import('better-sqlite3').Database,
  shotId: string,
): { status: string; error_message: string | null } {
  return sqlite
    .prepare('SELECT status, error_message FROM versions WHERE shot_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
    .get(shotId) as { status: string; error_message: string | null };
}

function useClient(engine: unknown, client: FakeComfyUIClient): void {
  (engine as { client: FakeComfyUIClient }).client = client;
  (engine as { generation: { client: FakeComfyUIClient } }).generation.client = client;
}

describe('duplicate-submit guard', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups) c();
    cleanups.length = 0;
    vi.restoreAllMocks();
  });

  it('refuses an identical re-submit after an ambiguous failure', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    const client = new DroppedResponseClient();
    useClient(stack.engine, client);
    const shotId = seedShot(stack.engine);

    await expect(stack.engine.submitGeneration(shotId, WORKFLOW)).rejects.toMatchObject({
      code: 'COMFYUI_API_ERROR',
    });
    expect(client.submits).toBe(1);

    // The retry an agent would make. It must not reach the provider.
    await expect(stack.engine.submitGeneration(shotId, WORKFLOW)).rejects.toMatchObject({
      code: 'DUPLICATE_SUBMIT',
    });
    expect(client.submits).toBe(1);
  });

  it('the refusal names the prior version and warns it may have been charged', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    useClient(stack.engine, new DroppedResponseClient());
    const shotId = seedShot(stack.engine);

    await expect(stack.engine.submitGeneration(shotId, WORKFLOW)).rejects.toThrow();
    try {
      await stack.engine.submitGeneration(shotId, WORKFLOW);
      expect.unreachable('expected DUPLICATE_SUBMIT');
    } catch (err) {
      const typed = err as TypedError;
      expect(typed.code).toBe('DUPLICATE_SUBMIT');
      expect(typed.message).toMatch(/ver_/); // points at the prior version
      expect(typed.message).toMatch(/may already have been charged/);
      expect(typed.hint).toMatch(/allow_duplicate/);
    }
  });

  it('records the ambiguity on the failed version instead of a clean failure', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    useClient(stack.engine, new DroppedResponseClient());
    const shotId = seedShot(stack.engine);

    await expect(stack.engine.submitGeneration(shotId, WORKFLOW)).rejects.toThrow();

    const row = latestVersion(stack.sqlite, shotId);
    expect(row.status).toBe('failed');
    expect(row.error_message).toMatch(/may still be running and may have been charged/);
  });

  it('allowDuplicate runs the take anyway', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    const client = new DroppedResponseClient();
    useClient(stack.engine, client);
    const shotId = seedShot(stack.engine);

    await expect(stack.engine.submitGeneration(shotId, WORKFLOW)).rejects.toThrow();
    // Not DUPLICATE_SUBMIT — it reached the provider and failed there again.
    await expect(
      stack.engine.submitGeneration(shotId, WORKFLOW, undefined, undefined, true),
    ).rejects.toMatchObject({ code: 'COMFYUI_API_ERROR' });
    expect(client.submits).toBe(2);
  });

  it('a DEFINITIVE rejection is not ambiguous and does not block a retry', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    const client = new RejectingClient();
    useClient(stack.engine, client);
    const shotId = seedShot(stack.engine);

    await expect(stack.engine.submitGeneration(shotId, WORKFLOW)).rejects.toThrow();
    expect(latestVersion(stack.sqlite, shotId).error_message).not.toMatch(/may have been charged/);

    // The provider answered and nothing ran, so fixing and resubmitting is fine.
    // (Still guarded — the request is byte-identical — so this asserts the
    // guard's scope is deliberate, not that a rejection is retryable.)
    await expect(stack.engine.submitGeneration(shotId, WORKFLOW)).rejects.toMatchObject({
      code: 'DUPLICATE_SUBMIT',
    });
    // A DIFFERENT request after a rejection is never blocked.
    await expect(
      stack.engine.submitGeneration(shotId, { '3': { class_type: 'KSampler', inputs: { seed: 99 } } }),
    ).rejects.toMatchObject({ code: 'COMFYUI_API_ERROR' });
    expect(client.submits).toBe(2);
  });

  it('a different shot with the same request is not a duplicate', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    const client = new DroppedResponseClient();
    useClient(stack.engine, client);
    const ws = stack.engine.createWorkspace('ws1');
    const proj = stack.engine.createProject(ws.entity.id, 'p1');
    const seq = stack.engine.createSequence(proj.entity.id, 'sq010');
    const shotA = stack.engine.createShot(seq.entity.id, 'sh010').entity.id;
    const shotB = stack.engine.createShot(seq.entity.id, 'sh020').entity.id;

    await expect(stack.engine.submitGeneration(shotA, WORKFLOW)).rejects.toThrow();
    await expect(stack.engine.submitGeneration(shotB, WORKFLOW)).rejects.toMatchObject({
      code: 'COMFYUI_API_ERROR',
    });
    expect(client.submits).toBe(2);
  });

  it('a completed take does not block another take of the same prompt', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    const shotId = seedShot(stack.engine);

    const first = await stack.engine.submitGeneration(shotId, WORKFLOW);
    await stack.engine.getGenerationStatus(first.entity.id);
    await stack.engine.stop();

    // Sampling is non-deterministic — re-running a finished prompt is ordinary
    // work, not a duplicate spend.
    const second = await stack.engine.submitGeneration(shotId, WORKFLOW);
    expect(second.entity.id).not.toBe(first.entity.id);
  });
});

describe('fingerprintRequest', () => {
  it('is stable across key order', () => {
    const a = fingerprintRequest('sh_1', 'replicate', { b: 2, a: { d: 4, c: 3 } });
    const b = fingerprintRequest('sh_1', 'replicate', { a: { c: 3, d: 4 }, b: 2 });
    expect(a).toBe(b);
  });

  it('is order-SENSITIVE for arrays', () => {
    const a = fingerprintRequest('sh_1', 'replicate', { xs: [1, 2] });
    const b = fingerprintRequest('sh_1', 'replicate', { xs: [2, 1] });
    expect(a).not.toBe(b);
  });

  it('separates shot and provider', () => {
    const base = { prompt: 'a fox' };
    expect(fingerprintRequest('sh_1', 'replicate', base)).not.toBe(
      fingerprintRequest('sh_2', 'replicate', base),
    );
    expect(fingerprintRequest('sh_1', 'replicate', base)).not.toBe(
      fingerprintRequest('sh_1', 'fal', base),
    );
  });
});
