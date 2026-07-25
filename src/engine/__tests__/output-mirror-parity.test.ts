import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { buildStackWithOutputs } from '../../test-utils/fixtures.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import { mirrorPersistedOutput } from '../output-downloader.js';
import { TypedError } from '../errors.js';
import type { EngineForC2pa } from '../output-downloader.js';

/**
 * REGRESSION — the dashboard-stable output mirror must not depend on the
 * provider being able to re-serve an output from a bare filename.
 *
 * The completion hook used to re-download the finished output with an EMPTY
 * locator (`downloadOutput(client, id, root, filename, {}, this)`). Only the
 * ComfyUI adapter can resolve an output that way. Every other adapter needs
 * the locator status() handed out:
 *   - replicate/fal/byteplus keep the source URL in `opts.type` and reject a
 *     bare filename as a non-URL,
 *   - google-ai-studio needs `opts.subfolder` + `opts.type` to find its staged
 *     bytes, which the primary download has already consumed by then.
 *
 * So `/api/versions/:id/output` returned OUTPUT_UNAVAILABLE for four of five
 * providers, and because the C2PA signing hook is reachable ONLY from that
 * mirror, those outputs were never signed either. Registered external outputs
 * never mirrored at all — they complete without passing through
 * getGenerationStatus.
 *
 * The fix copies the file downloadAndPersist already wrote. These tests pin
 * that: the provider must never be asked for the bytes a second time.
 */

/**
 * Stands in for every non-ComfyUI adapter: refuses a download whose locator is
 * empty, exactly as the URL and inline-bytes adapters do in production.
 */
class LocatorRequiredClient extends FakeComfyUIClient {
  emptyLocatorDownloads = 0;

  constructor() {
    super();
    // status() hands out a real locator, like every adapter does.
    this.cannedOutputs = [{ filename: 'out.png', subfolder: 'job_abc', type: 'inline:0' }];
  }

  override async downloadToPath(
    filename: string,
    opts: { subfolder?: string; type?: string },
    destPath: string,
  ): Promise<{ path: string; url: string; contentType: string; sizeBytes: number }> {
    if (!opts?.subfolder && !opts?.type) {
      this.emptyLocatorDownloads++;
      throw new TypedError(
        'DOWNLOAD_FAILED',
        `Output '${filename}' is no longer staged — re-run the generation.`,
      );
    }
    return super.downloadToPath(filename, opts, destPath);
  }
}

/** Records every signOutput call; signs nothing (the skip path of the real engine). */
function recordingEngine(): EngineForC2pa & { signed: Array<{ versionId: string; filename: string }> } {
  const signed: Array<{ versionId: string; filename: string }> = [];
  return {
    signed,
    async signOutput(versionId: string, filename: string) {
      signed.push({ versionId, filename });
      return { signed: null, signedToPath: null };
    },
  };
}

describe('dashboard-stable output mirror — provider parity', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups) c();
    cleanups.length = 0;
    vi.restoreAllMocks();
  });

  it('a provider that cannot re-serve from a bare filename still gets a mirror', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    const engine = stack.engine;
    // Swap in the locator-requiring provider — the engine holds the client by
    // reference, so this stands in for replicate/fal/byteplus/google.
    const client = new LocatorRequiredClient();
    (engine as unknown as { client: FakeComfyUIClient }).client = client;
    (
      engine as unknown as { generation: { client: FakeComfyUIClient } }
    ).generation.client = client;

    const ws = engine.createWorkspace('ws1');
    const proj = engine.createProject(ws.entity.id, 'p1');
    const seq = engine.createSequence(proj.entity.id, 'sq010');
    const shot = engine.createShot(seq.entity.id, 'sh010');

    const submitted = await engine.submitGeneration(shot.entity.id, {
      '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7 } },
    });
    const completed = await engine.getGenerationStatus(submitted.entity.id);
    expect(completed.entity.status).toBe('completed');

    const stored = JSON.parse(completed.entity.outputs_json!) as Array<{
      filename: string;
      path: string;
    }>;
    const mirrorPath = join(stack.outputsDir, submitted.entity.id, stored[0]!.filename);

    // The mirror is fire-and-forget; stop() joins the in-flight set.
    await engine.stop();

    expect(existsSync(mirrorPath)).toBe(true);
    // The persisted (hierarchy) file and the mirror hold the same bytes.
    expect(readFileSync(mirrorPath)).toEqual(readFileSync(stored[0]!.path));
    // And the provider was never asked to serve the output a second time.
    expect(client.emptyLocatorDownloads).toBe(0);
  });

  it('a registered external output gets a mirror too', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    const engine = stack.engine;

    const ws = engine.createWorkspace('ws1');
    const proj = engine.createProject(ws.entity.id, 'p1');
    const seq = engine.createSequence(proj.entity.id, 'sq010');
    const shot = engine.createShot(seq.entity.id, 'sh010');

    const registered = await engine.registerExternalOutput({
      shotId: shot.entity.id,
      providerId: 'replicate',
      outputs: [
        {
          filename: 'external.png',
          bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          content_type: 'image/png',
        },
      ],
    });

    const stored = JSON.parse(registered.entity.outputs_json!) as Array<{
      filename: string;
      path: string;
    }>;
    const mirrorPath = join(stack.outputsDir, registered.entity.id, stored[0]!.filename);

    await engine.stop();

    expect(existsSync(mirrorPath)).toBe(true);
    expect(readFileSync(mirrorPath)).toEqual(readFileSync(stored[0]!.path));
  });
});

describe('mirrorPersistedOutput', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups) c();
    cleanups.length = 0;
    vi.restoreAllMocks();
  });

  function seedSource(outputsDir: string, name = 'shot_v001.png'): string {
    const src = join(outputsDir, 'PROJ', 'SEQ', 'sh010', 'v001', name);
    mkdirSync(dirname(src), { recursive: true });
    writeFileSync(src, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return src;
  }

  it('copies the persisted file to outputsDir/versionId/filename', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    const src = seedSource(stack.outputsDir);

    const result = await mirrorPersistedOutput('ver_1', stack.outputsDir, src, 'shot_v001.png');

    const expected = join(stack.outputsDir, 'ver_1', 'shot_v001.png');
    expect(result).toBe(expected);
    expect(readFileSync(expected)).toEqual(readFileSync(src));
  });

  it('runs the C2PA signing hook on the mirror', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    const src = seedSource(stack.outputsDir);
    const engine = recordingEngine();

    await mirrorPersistedOutput('ver_2', stack.outputsDir, src, 'shot_v001.png', engine);

    expect(engine.signed).toEqual([{ versionId: 'ver_2', filename: 'shot_v001.png' }]);
  });

  it('missing source: returns null, does not throw, leaves no partial behind', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await mirrorPersistedOutput(
      'ver_3',
      stack.outputsDir,
      join(stack.outputsDir, 'nope', 'missing.png'),
      'missing.png',
    );

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    const versionDir = join(stack.outputsDir, 'ver_3');
    const leftovers = existsSync(versionDir)
      ? readdirSync(versionDir).filter((f) => f.includes('.partial'))
      : [];
    expect(leftovers).toEqual([]);
  });

  it('source already IS the mirror path: does not truncate the file', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    // A legacy row whose persisted path is the mirror itself — copying it onto
    // itself would empty it.
    const selfPath = join(stack.outputsDir, 'ver_4', 'self.png');
    mkdirSync(dirname(selfPath), { recursive: true });
    writeFileSync(selfPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = await mirrorPersistedOutput('ver_4', stack.outputsDir, selfPath, 'self.png');

    expect(result).toBe(selfPath);
    expect(readFileSync(selfPath).byteLength).toBe(4);
  });
});
