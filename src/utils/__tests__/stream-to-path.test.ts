import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import {
  streamToPath,
  resolveDownloadIdleTimeoutMs,
  DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
} from '../stream-to-path.js';

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vellum-s2p-'));
});
afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

/** A ReadableStream that emits `chunks` spaced `gapMs` apart, then closes. */
function pacedStream(chunks: Uint8Array[], gapMs: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          if (i < chunks.length) {
            controller.enqueue(chunks[i++]);
          } else {
            controller.close();
          }
          resolve();
        }, gapMs);
      });
    },
  });
}

/** A ReadableStream that emits one chunk then STALLS forever (never closes). */
function stallingStream(first: Uint8Array): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(first);
        return;
      }
      // Return a promise that never resolves → the stream goes silent.
      return new Promise<void>(() => {});
    },
  });
}

const B = (n: number) => new Uint8Array(n).fill(1);

describe('streamToPath idle timeout', () => {
  test('a mid-stream stall trips the idle timeout and unlinks the partial', async () => {
    const dest = path.join(dir, 'stalled.bin');
    await expect(
      streamToPath(stallingStream(B(4)), dest, {
        filenameForError: 'stalled.bin',
        idleTimeoutMs: 80,
      }),
    ).rejects.toThrow(/stalled — no data for 80ms/);
    // Neither the final file nor the .partial survives a failed download.
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.partial`)).toBe(false);
  });

  test('a source that never sends any chunk also trips the idle timeout (armed before first byte)', async () => {
    const dest = path.join(dir, 'silent.bin');
    const silent = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => {}); // never enqueues, never closes
      },
    });
    await expect(
      streamToPath(silent, dest, { filenameForError: 'silent.bin', idleTimeoutMs: 60 }),
    ).rejects.toThrow(/stalled/);
    expect(fs.existsSync(`${dest}.partial`)).toBe(false);
  });

  test('sink backpressure does NOT trip the idle timeout (times source reads, not disk writes)', async () => {
    // The regression the reviewer reproduced: a fast source feeding a slow sink
    // (a busy NAS/SMB output root) must NOT be force-failed. The source has all
    // bytes ready immediately, but the WRITE side settles slowly (150ms/chunk)
    // via a real backpressuring Writable — well past the 80ms idle window. The
    // download must still complete because the idle timer only times source
    // reads, never disk writes. (ESM can't spy createWriteStream, so mock
    // node:fs via doMock + a fresh dynamic import, scoped to this test.)
    vi.resetModules();
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const dest = path.join(dir, 'backpressure.bin');
    // Write delay (400ms) is ~2.7x the idle window (150ms). The window is kept
    // comfortably large so brief event-loop contention under a full parallel
    // suite doesn't starve a legit source read into a false stall.
    vi.doMock('node:fs', () => ({
      ...actualFs,
      createWriteStream: (p: fs.PathLike) =>
        new Writable({
          highWaterMark: 1, // write() returns false → caller must await 'drain'
          write(chunk: Buffer, _enc, cb) {
            actualFs.appendFileSync(p as fs.PathOrFileDescriptor, chunk);
            setTimeout(cb, 400); // delay 'drain' well past the 150ms idle window
          },
        }),
    }));
    const { streamToPath: s2p } = await import('../stream-to-path.js');
    try {
      const chunks = Array.from({ length: 4 }, () => B(1024));
      const fastSource = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of chunks) controller.enqueue(c);
          controller.close();
        },
      });
      const { bytes } = await s2p(fastSource, dest, {
        filenameForError: 'backpressure.bin',
        idleTimeoutMs: 150,
      });
      expect(bytes).toBe(4 * 1024);
      expect(actualFs.existsSync(dest)).toBe(true);
      expect((await fsp.readFile(dest)).byteLength).toBe(4 * 1024);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('a slow-but-progressing stream is NOT cut off (idle timer resets per read)', async () => {
    const dest = path.join(dir, 'slow.bin');
    // Chunks arrive every 30ms; idle window is 100ms — each chunk resets it, so
    // the total (>100ms across 5 chunks) never trips the idle timeout.
    const chunks = [B(2), B(2), B(2), B(2), B(2)];
    const { bytes } = await streamToPath(pacedStream(chunks, 30), dest, {
      filenameForError: 'slow.bin',
      idleTimeoutMs: 100,
    });
    expect(bytes).toBe(10);
    expect(fs.existsSync(dest)).toBe(true);
    expect((await fsp.readFile(dest)).byteLength).toBe(10);
  });

  test('idleTimeoutMs undefined disables the timeout (a stalled stream is not force-failed by us)', async () => {
    const dest = path.join(dir, 'noidle.bin');
    // With no idle timeout, our helper does not arm a timer. Drive a paced
    // stream that DOES complete to prove the disabled path streams normally.
    const { bytes } = await streamToPath(pacedStream([B(3), B(3)], 120), dest, {
      filenameForError: 'noidle.bin',
      // idleTimeoutMs intentionally omitted
    });
    expect(bytes).toBe(6);
    expect(fs.existsSync(dest)).toBe(true);
  });
});

describe('resolveDownloadIdleTimeoutMs', () => {
  const KEY = 'VELLUM_DOWNLOAD_IDLE_TIMEOUT_MS';
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  test('defaults when unset', () => {
    delete process.env[KEY];
    expect(resolveDownloadIdleTimeoutMs()).toBe(DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS);
  });

  test('honours a positive override', () => {
    process.env[KEY] = '5000';
    expect(resolveDownloadIdleTimeoutMs()).toBe(5000);
  });

  test('a non-positive / unparseable value disables the timeout (undefined)', () => {
    for (const v of ['0', '-1', 'abc']) {
      process.env[KEY] = v;
      expect(resolveDownloadIdleTimeoutMs()).toBeUndefined();
    }
  });

  test('a value at/above the timer overflow bound disables (does NOT clamp to 1ms)', () => {
    // Node clamps setTimeout delays > 2^31-1 to 1ms; a "huge = never trip" input
    // must therefore disable, not instantly fail every download.
    for (const v of ['2147483647', '3000000000', '999999999999']) {
      process.env[KEY] = v;
      expect(resolveDownloadIdleTimeoutMs()).toBeUndefined();
    }
  });

  test('the largest safe value just under the bound is honoured', () => {
    process.env[KEY] = '2147483646';
    expect(resolveDownloadIdleTimeoutMs()).toBe(2147483646);
  });
});
