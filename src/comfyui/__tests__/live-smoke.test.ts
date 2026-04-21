/**
 * Live smoke test against ComfyUI Cloud (D-GEN-42.7).
 *
 * Gated on COMFYUI_API_KEY. Skips cleanly in CI without the key. This is the
 * honest end-to-end check that replaces any wire-level human-UAT item (per
 * project memory: feedback_dont_punt_on_tests.md — if the item is wire-level,
 * drive it with real calls before escalating).
 *
 * Gate strategy: `describe.skipIf(SKIP)` where `SKIP = !process.env.COMFYUI_API_KEY`.
 * Default `npx vitest run` (no env flag) leaves the describe block skipped, so
 * CI pipelines without credentials pass without hitting the real Cloud. When
 * the key is set, the full path runs: submit → poll → download → assert file
 * on disk with non-zero size.
 *
 * Defensive probes (per RESEARCH Open Questions 1 + 2): on first run the test
 * logs the observed status-response shape AND the signed-URL redirect host to
 * stderr. These two pieces of data close the two remaining open questions and
 * let Phase 3 tighten the default allowlist in `ComfyUIClient`.
 *
 * Cleanup: the SQLite DB file (plus -wal / -shm), the downloaded output file,
 * and the entire output root tempdir are removed in `afterEach`.
 *
 * Checkpoint model name is overridable via COMFYUI_SMOKE_CHECKPOINT so the
 * test works against whatever v1-5 variant the tenant has available (RESEARCH A6).
 *
 * If the first live run surfaces `COMFYUI_API_ERROR: Unexpected redirect host: ...`,
 * update `ComfyUIClient.DEFAULT_ALLOWED_HOST_PATTERNS` in src/comfyui/client.ts
 * OR set `COMFYUI_ALLOWED_REDIRECT_HOSTS=<host>` in .env as a runtime override.
 * Record the observed host in 02-03-SUMMARY.md.
 */
import { describe, test, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as pth from 'node:path';
import { nanoid } from 'nanoid';
import { openDb } from '../../store/db.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { Engine } from '../../engine/pipeline.js';
import { ComfyUIClient } from '../client.js';
import type { StoredOutput } from '../types.js';

const SKIP = !process.env.COMFYUI_API_KEY;

/**
 * Minimal classical SD 1.5 workflow (API format). Text2image, 512×512, 10 steps
 * — cheapest possible workflow on a Pro-tier instance. See RESEARCH §A6.
 * Checkpoint name may not exist on every tenant; override via env if needed.
 */
const MINIMAL_WORKFLOW = (checkpoint: string): Record<string, unknown> => ({
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 42,
      steps: 10,
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
      model: ['4', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
  },
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: checkpoint },
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: { width: 512, height: 512, batch_size: 1 },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'a small red cube on a white table', clip: ['4', 1] },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '', clip: ['4', 1] },
  },
  '8': {
    class_type: 'VAEDecode',
    inputs: { samples: ['3', 0], vae: ['4', 2] },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'vfx-familiar-smoke', images: ['8', 0] },
  },
});

let dbPath: string;
let tempOutputRoot: string;

beforeEach(async () => {
  const tag = nanoid(6);
  dbPath = pth.join(os.tmpdir(), `vfx-smoke-${tag}.db`);
  tempOutputRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-smoke-out-${tag}-`));
});

afterEach(async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* ignore — file may not exist when the test skips */
    }
  }
  await fsp.rm(tempOutputRoot, { recursive: true, force: true });
});

describe.skipIf(SKIP)('live ComfyUI Cloud smoke (D-GEN-42.7)', () => {
  test('submit → poll → download → output file on disk', async () => {
    const apiKey = process.env.COMFYUI_API_KEY!;
    const apiBase = process.env.COMFYUI_API_BASE ?? 'https://cloud.comfy.org';
    const checkpoint =
      process.env.COMFYUI_SMOKE_CHECKPOINT ?? 'v1-5-pruned-emaonly.safetensors';

    // Full prod init path — openDb applies pragma+schema+drizzle migrator.
    const { db } = openDb(dbPath);
    const repo = new HierarchyRepo(db);
    const versions = new VersionRepo(db);
    const client = new ComfyUIClient(apiKey, apiBase);
    const engine = new Engine(repo, versions, client, tempOutputRoot);

    try {
      // Seed minimal hierarchy up to a shot.
      const ws = repo.createWorkspace(`smoke-ws-${nanoid(4)}`);
      const proj = repo.createProject(ws.id, 'smoke-proj');
      const seq = repo.createSequence(proj.id, 'sq010');
      const shot = repo.createShot(seq.id, 'sh010');

      // Submit.
      const submit = await engine.submitGeneration(shot.id, MINIMAL_WORKFLOW(checkpoint));
      expect(submit.entity.status).toBe('submitted');
      expect(typeof submit.entity.job_id).toBe('string');
      const versionId = submit.entity.id;

      // Poll via engine.getGenerationStatus — on-demand fetch inside the engine
      // handles the full status → normalise → download → persist path.
      const deadline = Date.now() + 180_000; // 3 minutes
      let terminal: 'completed' | 'failed' | undefined;
      let statusEntity: Awaited<ReturnType<typeof engine.getGenerationStatus>>['entity'] | undefined;
      let pollCount = 0;
      while (Date.now() < deadline) {
        const poll = await engine.getGenerationStatus(versionId);
        statusEntity = poll.entity;
        pollCount++;
        if (statusEntity.status === 'completed' || statusEntity.status === 'failed') {
          terminal = statusEntity.status;
          break;
        }
        // Defensive probe — log the Cloud's actual intermediate entity shape
        // ONCE (Open Question A3). Only the non-sensitive fields.
        if (pollCount === 1) {
          console.error(
            '[live-smoke] first-poll entity snapshot:',
            JSON.stringify({
              status: statusEntity.status,
              job_id: statusEntity.job_id,
              version_number: statusEntity.version_number,
            }),
          );
        }
        await new Promise((r) => setTimeout(r, 5_000)); // 5s between polls
      }

      expect(terminal).toBe('completed');
      expect(statusEntity!.outputs_json).toBeTruthy();
      const outputs = JSON.parse(statusEntity!.outputs_json as string) as StoredOutput[];
      expect(outputs.length).toBeGreaterThanOrEqual(1);

      // Confirm the downloaded file exists on disk with non-zero size.
      const firstOutput = outputs[0];
      const onDisk = await fsp.stat(firstOutput.path);
      expect(onDisk.isFile()).toBe(true);
      expect(onDisk.size).toBeGreaterThan(0);
      expect(firstOutput.content_type).toMatch(/^image\//);

      // Defensive probe — log the observed signed-URL host so RESEARCH Open
      // Question 1 + A1 closes. Phase 3 will tighten the default allowlist.
      try {
        const urlHost = new URL(firstOutput.url).hostname;
        console.error(`[live-smoke] observed signed-URL host: ${urlHost}`);
      } catch {
        /* ignore — url field is not required to be a URL per the type */
      }
    } finally {
      await engine.stop();
    }
  }, 210_000); // 3.5-minute outer timeout — matches D-GEN-25 + cold-start margin
});
