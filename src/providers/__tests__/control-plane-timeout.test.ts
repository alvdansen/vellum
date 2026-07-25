import { describe, it, expect } from 'vitest';
import { ReplicateAdapter } from '../replicate-adapter.js';
import { FalAdapter } from '../fal-adapter.js';
import { ByteplusAdapter } from '../byteplus-adapter.js';
import { GoogleAIStudioAdapter } from '../google-ai-studio-adapter.js';
import { ComfyUIClient } from '../../comfyui/client.js';
import {
  PROVIDER_CONTROL_TIMEOUT_MS,
  PROVIDER_INLINE_GENERATION_TIMEOUT_MS,
  timeoutSignal,
} from '../../utils/http-timeout.js';

/**
 * REGRESSION — a provider that accepts the connection and never answers must
 * not hang the caller forever.
 *
 * Node's fetch has no default timeout, and the engine's generation timeout is a
 * wall-clock check against created_at evaluated BEFORE the status call is
 * issued, so it cannot fire while a call is in flight. A wedged socket used to
 * hold a recovery poller's slot for the life of the process, starving every
 * queued job behind it, and hung the `generation.check` tool call (and the
 * agent waiting on it) indefinitely.
 */

/** A server that accepts the request and then says nothing, ever. */
function hangingFetch(): typeof fetch {
  return ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // no deadline attached — hangs forever, which is the bug
      if (signal.aborted) {
        reject(signal.reason ?? new Error('aborted'));
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
    })) as unknown as typeof fetch;
}

const TIMEOUT_MS = 25;

describe('provider control-plane calls carry a deadline', () => {
  it('replicate status() rejects instead of hanging', async () => {
    const a = new ReplicateAdapter('tok', undefined, {
      fetchImpl: hangingFetch(),
      requestTimeoutMs: TIMEOUT_MS,
    });
    await expect(a.status('job_1')).rejects.toMatchObject({ code: 'REPLICATE_API_ERROR' });
  });

  it('replicate submit() rejects instead of hanging', async () => {
    const a = new ReplicateAdapter('tok', undefined, {
      fetchImpl: hangingFetch(),
      requestTimeoutMs: TIMEOUT_MS,
    });
    await expect(
      a.submit({ version: 'owner/m:v1', input: { prompt: 'x' } }),
    ).rejects.toMatchObject({ code: 'REPLICATE_API_ERROR' });
  });

  it('fal status() rejects instead of hanging', async () => {
    const a = new FalAdapter('tok', undefined, {
      fetchImpl: hangingFetch(),
      requestTimeoutMs: TIMEOUT_MS,
    });
    await expect(a.status('job_1')).rejects.toMatchObject({ code: 'FAL_API_ERROR' });
  });

  it('byteplus status() rejects instead of hanging', async () => {
    const a = new ByteplusAdapter('tok', undefined, {
      fetchImpl: hangingFetch(),
      requestTimeoutMs: TIMEOUT_MS,
    });
    await expect(a.status('job_1')).rejects.toMatchObject({ code: 'BYTEPLUS_API_ERROR' });
  });

  it('google submit() rejects instead of hanging', async () => {
    const a = new GoogleAIStudioAdapter('key', undefined, {
      fetchImpl: hangingFetch(),
      requestTimeoutMs: TIMEOUT_MS,
    });
    await expect(a.submit({ prompt: 'a fox' })).rejects.toMatchObject({
      code: 'GOOGLE_API_ERROR',
    });
  });

  it('comfyui status() rejects instead of hanging', async () => {
    const c = new ComfyUIClient('key', 'https://api.comfy.org', {
      fetchImpl: hangingFetch(),
      requestTimeoutMs: TIMEOUT_MS,
    });
    await expect(c.status('job_1')).rejects.toMatchObject({ code: 'COMFYUI_API_ERROR' });
  });
});

describe('http-timeout defaults', () => {
  it('the control-plane deadline is generous enough to be a hang-breaker, not a latency budget', () => {
    expect(PROVIDER_CONTROL_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('an inline-generation provider gets a longer deadline than a polling one', () => {
    // Google's "submit" performs the whole generation, so its ceiling has to
    // sit above normal image-generation latency.
    expect(PROVIDER_INLINE_GENERATION_TIMEOUT_MS).toBeGreaterThan(PROVIDER_CONTROL_TIMEOUT_MS);
  });

  it('timeoutSignal returns a signal that aborts', async () => {
    const signal = timeoutSignal(5);
    await new Promise((r) => setTimeout(r, 40));
    expect(signal.aborted).toBe(true);
  });
});
