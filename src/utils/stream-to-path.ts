import { createWriteStream } from 'node:fs';
import { nanoid } from 'nanoid';
import { rename, unlink } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';

/**
 * Default per-read IDLE timeout for a streaming download (ms). This bounds how
 * long a SINGLE read from the source may take to yield the next chunk — i.e. it
 * fires only when the source goes SILENT for this long (a stalled or hung
 * delivery host that accepted the connection then stopped sending). It is NOT a
 * total-duration cap: a legitimately large asset that keeps arriving never trips
 * it, and (crucially) a slow local sink applying backpressure does NOT trip it,
 * because the timer only wraps reads from the source, not writes to disk. Total
 * asset size is bounded separately by `maxBytes`.
 *
 * Without this, a source that trickles then stalls would pin a poller slot
 * indefinitely — the engine's 10-min generation timeout is checked BEFORE
 * polling, not during a download.
 */
export const DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

/**
 * Node's setTimeout clamps any delay > 2^31-1 ms (~24.8 days) down to 1ms (with
 * a stderr TimeoutOverflowWarning) — which would make a "set it huge so it never
 * trips" value do the exact opposite and fail every download after ~1ms. So a
 * value at/above this bound is treated as "disable" (the operator's evident
 * intent), not passed to setTimeout.
 */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Resolve the download idle timeout from VELLUM_DOWNLOAD_IDLE_TIMEOUT_MS, falling
 * back to the default. Returns `undefined` (idle timeout DISABLED) when the value
 * is non-positive, unparseable, or so large it would overflow the timer — the
 * two natural "turn it off" operator inputs. Read lazily per download (cheap) so
 * it can be tuned without a restart.
 */
export function resolveDownloadIdleTimeoutMs(): number | undefined {
  const raw = process.env.VELLUM_DOWNLOAD_IDLE_TIMEOUT_MS;
  if (raw == null || raw === '') return DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined; // explicit disable
  if (n >= MAX_TIMER_MS) return undefined; // "effectively never" — don't overflow the timer
  return n;
}

/**
 * IM-02: shared atomic-write helper used by the real `ComfyUIClient.downloadToPath`,
 * `FakeComfyUIClient.downloadToPath`, the URL-provider adapters (via
 * guardedStreamDownload), and the ingest download path. Extracts the
 * temp-then-rename streaming logic so the atomic-write invariant lives in exactly
 * one place.
 *
 * Contract:
 *  - Writes to a per-call unique `{destPath}.{pid}.{nanoid}.partial` first, so
 *    concurrent downloaders of one output cannot clobber each other's temp.
 *  - Optionally honours `maxBytes`, throwing once the observed byte count exceeds
 *    the cap.
 *  - Optionally honours `idleTimeoutMs` (see DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS):
 *    each READ from the source is raced against the timeout, so a source that
 *    goes silent for that long fails the download. The write side (disk) is NOT
 *    timed — backpressure from a slow sink (a busy NAS/SMB output root) never
 *    counts as a stall.
 *  - On success, renames `.partial` to `destPath`.
 *  - On any failure (source stall, overflow, write error, rename error), the
 *    source is cancelled, the writer destroyed, the partial unlinked, and the
 *    error rethrown. Caller wraps it in a TypedError.
 *  - Returns the number of bytes streamed (observed on-the-wire).
 */
export async function streamToPath(
  body: ReadableStream<Uint8Array>,
  destPath: string,
  options: { maxBytes?: number; filenameForError?: string; idleTimeoutMs?: number } = {},
): Promise<{ bytes: number }> {
  // UNIQUE per call. This used to be a fixed `${destPath}.partial`, so two
  // downloaders racing for the same output wrote the same temp file: whichever
  // renamed first won, and the loser's rename failed with ENOENT ("no such file
  // or directory") after streaming the whole payload — a download reported as
  // failed even though the bytes had arrived, and a stray .partial left behind.
  // Rename stays atomic because the temp is still in the destination directory.
  const partial = `${destPath}.${process.pid}.${nanoid(6)}.partial`;
  const label = options.filenameForError ?? destPath;
  const { maxBytes, idleTimeoutMs: idleMs } = options;
  let bytes = 0;

  const reader = body.getReader();
  const writer = createWriteStream(partial);
  // Latch the first writer error so a stall on `await drain` (which would never
  // emit 'drain' after an error) can be raced to rejection instead of hanging.
  // The trailing .catch keeps a late rejection from surfacing as unhandled once
  // the happy path has already resolved.
  let rejectOnWriterError!: (err: unknown) => void;
  const writerError = new Promise<never>((_, reject) => {
    rejectOnWriterError = reject;
  });
  writerError.catch(() => undefined);
  writer.on('error', (err) => rejectOnWriterError(err));

  /**
   * Read the next chunk, racing the source read against the idle deadline. The
   * timer wraps ONLY the read — never a write/drain — so sink backpressure can
   * never be misread as a source stall.
   */
  const readChunk = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (idleMs === undefined) return reader.read();
    const readP = reader.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        readP,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Download '${label}' stalled — no data for ${idleMs}ms`)),
            idleMs,
          );
          timer.unref?.();
        }),
      ]);
    } catch (err) {
      // The idle timer won; make sure the still-pending read doesn't become an
      // unhandled rejection when we cancel the source below.
      readP.catch(() => undefined);
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  try {
    for (;;) {
      const { done, value } = await readChunk();
      if (done) break;
      bytes += value.byteLength;
      if (maxBytes !== undefined && bytes > maxBytes) {
        throw new Error(
          `Download '${label}' exceeded maxBytes=${maxBytes} (saw ${bytes})`,
        );
      }
      if (!writer.write(value)) {
        // Backpressure — wait for the sink to drain (or surface a write error).
        // No idle timer runs here, so a slow disk is never a "stall".
        await Promise.race([once(writer, 'drain'), writerError]);
      }
    }
    writer.end();
    await finished(writer); // resolves on clean close; rejects if the writer errored
    await rename(partial, destPath);
    return { bytes };
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    writer.destroy();
    // Await the writer's actual close before unlinking. createWriteStream opens
    // the fd asynchronously, so unlinking eagerly could race a pending open and
    // leave the .partial re-created AFTER the unlink. `finished` settles only
    // once the fd (and any pending open) is closed.
    await finished(writer).catch(() => undefined);
    await unlink(partial).catch(() => undefined);
    throw err;
  }
}
