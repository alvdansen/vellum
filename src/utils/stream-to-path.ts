import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';

/**
 * IM-02: shared atomic-write helper used by the real `ComfyUIClient.downloadToPath`
 * and `FakeComfyUIClient.downloadToPath`. Extracts the temp-then-rename streaming
 * logic so the fake stays free of engine-internal code and the atomic-write
 * invariant lives in exactly one place.
 *
 * Contract:
 *  - Writes to `{destPath}.partial` first.
 *  - Optionally honours `maxBytes` by destroying the readable mid-pipe when
 *    the observed byte count exceeds the cap.
 *  - On success, renames `.partial` to `destPath`.
 *  - On any failure (stream open, pipe, rename), the partial file is unlinked
 *    and the error is rethrown. Caller is responsible for wrapping in a
 *    TypedError. IP-03: createWriteStream runs inside the try block so
 *    synchronous constructor errors (EACCES, ENOSPC, ENOTDIR) are caught too.
 *  - Returns the number of bytes streamed (observed on-the-wire).
 */
export async function streamToPath(
  body: ReadableStream<Uint8Array>,
  destPath: string,
  options: { maxBytes?: number; filenameForError?: string } = {},
): Promise<{ bytes: number }> {
  const partial = `${destPath}.partial`;
  let bytes = 0;
  let overflow = false;
  const label = options.filenameForError ?? destPath;
  try {
    const writer = createWriteStream(partial);
    const readable = Readable.fromWeb(
      body as unknown as import('node:stream/web').ReadableStream,
    );
    readable.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (
        options.maxBytes !== undefined &&
        bytes > options.maxBytes &&
        !overflow
      ) {
        overflow = true;
        readable.destroy(
          new Error(
            `Download '${label}' exceeded maxBytes=${options.maxBytes} (saw ${bytes})`,
          ),
        );
      }
    });
    await pipeline(readable, writer);
    await rename(partial, destPath);
    return { bytes };
  } catch (err) {
    await unlink(partial).catch(() => undefined);
    throw err;
  }
}
