import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fingerprintModel } from '../model-fingerprint.js';

// SHA-256 of the 4-byte string "test".
const TEST_BYTES_HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('fingerprintModel (PROV-V-03)', () => {
  let modelsDir: string;
  beforeEach(async () => {
    modelsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vfx-fp-'));
  });
  afterEach(async () => {
    await fs.rm(modelsDir, { recursive: true, force: true });
  });

  describe('success path (criterion #1, #3)', () => {
    it('returns the correct SHA-256 hex for a known 4-byte checkpoint file', async () => {
      const dir = path.join(modelsDir, 'checkpoints');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'sd.safetensors'), 'test');
      const result = await fingerprintModel(modelsDir, 'CheckpointLoaderSimple', 'sd.safetensors');
      expect(result).toEqual({ model_hash: TEST_BYTES_HASH });
    });

    it('produces lowercase-hex hashes', async () => {
      const dir = path.join(modelsDir, 'loras');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'a.safetensors'), 'aaaa');
      const result = await fingerprintModel(modelsDir, 'LoraLoader', 'a.safetensors');
      expect('model_hash' in result).toBe(true);
      if ('model_hash' in result) {
        expect(result.model_hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('two calls against the same file return identical model_hash (content-addressed)', async () => {
      const dir = path.join(modelsDir, 'vae');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'v.pt'), 'identical-bytes');
      const a = await fingerprintModel(modelsDir, 'VAELoader', 'v.pt');
      const b = await fingerprintModel(modelsDir, 'VAELoader', 'v.pt');
      expect(a).toEqual(b);
    });

    it('identical bytes in different subdirs hash to the same value', async () => {
      // Proves the hash is over BYTES, not path. Same 'shared.safetensors' name
      // appears under both checkpoints/ and loras/ — different class_types
      // resolve to different subdirs, but identical content yields identical
      // model_hash (criterion #3, content-addressed).
      const ckptDir = path.join(modelsDir, 'checkpoints');
      const loraDir = path.join(modelsDir, 'loras');
      await fs.mkdir(ckptDir, { recursive: true });
      await fs.mkdir(loraDir, { recursive: true });
      await fs.writeFile(path.join(ckptDir, 'shared.safetensors'), 'same-bytes');
      await fs.writeFile(path.join(loraDir, 'shared.safetensors'), 'same-bytes');
      const ckpt = await fingerprintModel(modelsDir, 'CheckpointLoaderSimple', 'shared.safetensors');
      const lora = await fingerprintModel(modelsDir, 'LoraLoader', 'shared.safetensors');
      expect('model_hash' in ckpt && 'model_hash' in lora).toBe(true);
      if ('model_hash' in ckpt && 'model_hash' in lora) {
        expect(ckpt.model_hash).toBe(lora.model_hash);
      }
    });

    it('streams a 1 MB file and produces the correct hash', async () => {
      const dir = path.join(modelsDir, 'unet');
      await fs.mkdir(dir, { recursive: true });
      const big = Buffer.alloc(1024 * 1024); // zeros
      await fs.writeFile(path.join(dir, 'u.safetensors'), big);
      const result = await fingerprintModel(modelsDir, 'UNETLoader', 'u.safetensors');
      const expected = createHash('sha256').update(big).digest('hex');
      expect(result).toEqual({ model_hash: expected });
    });
  });

  describe('unavailable reason codes (criterion #2 — D-CTX-5)', () => {
    it("returns 'models_dir_not_configured' when modelsDir is null", async () => {
      const result = await fingerprintModel(null, 'CheckpointLoaderSimple', 'sd.safetensors');
      expect(result).toEqual({ model_hash_unavailable: 'models_dir_not_configured' });
    });

    it("returns 'unsupported_class_type' for an unknown class_type", async () => {
      const result = await fingerprintModel(modelsDir, 'MyCustomLoader', 'x.safetensors');
      expect(result).toEqual({ model_hash_unavailable: 'unsupported_class_type' });
    });

    it("returns 'file_not_found' when modelsDir is set but file is absent", async () => {
      const result = await fingerprintModel(modelsDir, 'CheckpointLoaderSimple', 'missing.safetensors');
      expect(result).toEqual({ model_hash_unavailable: 'file_not_found' });
    });
  });

  describe('retry on transient I/O errors (criterion #4 — partial)', () => {
    // Strategy: chmod-000 a real file to force EACCES on stat/open. The helper
    // must retry, then surface 'file_unreadable'. Skipped on Windows where
    // chmod semantics differ. Note: this test will silently fail to provoke
    // EACCES if running as root (chmod 000 is bypassed); locally Timothy is
    // not root, and CI runs as a non-root user.
    const isWindows = process.platform === 'win32';

    it.skipIf(isWindows)("retries on EACCES then surfaces 'file_unreadable'", async () => {
      const dir = path.join(modelsDir, 'checkpoints');
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, 'locked.safetensors');
      await fs.writeFile(filePath, 'bytes');
      await fs.chmod(filePath, 0o000);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const result = await fingerprintModel(modelsDir, 'CheckpointLoaderSimple', 'locked.safetensors');
        expect(result).toEqual({ model_hash_unavailable: 'file_unreadable' });
        expect(errSpy).toHaveBeenCalledOnce();
        expect(errSpy.mock.calls[0]?.[0]).toMatch(/fingerprint unreadable after 3 attempts/);
      } finally {
        errSpy.mockRestore();
        // Restore perms so afterEach rm() can clean up the dir.
        await fs.chmod(filePath, 0o644);
      }
    }, 10_000); // 10s budget covers 1s + 2s sleeps + I/O.

    it('does NOT retry on ENOENT (file_not_found is immediate)', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const start = Date.now();
      try {
        const result = await fingerprintModel(modelsDir, 'LoraLoader', 'nope.safetensors');
        const elapsed = Date.now() - start;
        expect(result).toEqual({ model_hash_unavailable: 'file_not_found' });
        // No retry sleeps fired — must be well under the 1s first-sleep
        // threshold. Generous bound (500ms) accommodates slow CI.
        expect(elapsed).toBeLessThan(500);
        expect(errSpy).not.toHaveBeenCalled();
      } finally {
        errSpy.mockRestore();
      }
    });
  });

  describe('path-traversal defense-in-depth (WR-02 mirror)', () => {
    it("returns 'file_not_found' for modelName='..'", async () => {
      const result = await fingerprintModel(modelsDir, 'CheckpointLoaderSimple', '..');
      expect(result).toEqual({ model_hash_unavailable: 'file_not_found' });
    });

    it("returns 'file_not_found' for modelName='../../etc/passwd'", async () => {
      const result = await fingerprintModel(modelsDir, 'CheckpointLoaderSimple', '../../etc/passwd');
      expect(result).toEqual({ model_hash_unavailable: 'file_not_found' });
    });

    it("returns 'file_not_found' for modelName containing '/'", async () => {
      const result = await fingerprintModel(modelsDir, 'CheckpointLoaderSimple', 'a/b.safetensors');
      expect(result).toEqual({ model_hash_unavailable: 'file_not_found' });
    });

    it("returns 'file_not_found' for modelName containing '\\\\'", async () => {
      const result = await fingerprintModel(modelsDir, 'CheckpointLoaderSimple', 'a\\b.safetensors');
      expect(result).toEqual({ model_hash_unavailable: 'file_not_found' });
    });

    it("returns 'file_not_found' for modelName containing NUL", async () => {
      const result = await fingerprintModel(modelsDir, 'CheckpointLoaderSimple', 'safe.safetensors\0.evil');
      expect(result).toEqual({ model_hash_unavailable: 'file_not_found' });
    });

    it("returns 'file_not_found' for empty modelName", async () => {
      const result = await fingerprintModel(modelsDir, 'CheckpointLoaderSimple', '');
      expect(result).toEqual({ model_hash_unavailable: 'file_not_found' });
    });

    it('does NOT hash a tampered traversal target even if it exists on disk', async () => {
      // Write a sibling-of-modelsDir file that '../sibling-secret.txt' would
      // resolve to. Helper MUST refuse and NOT read its bytes — same downstream
      // UX as a real ENOENT.
      const sibling = path.join(modelsDir, '..', 'sibling-secret.txt');
      await fs.writeFile(sibling, 'secret-bytes');
      try {
        const result = await fingerprintModel(modelsDir, 'CheckpointLoaderSimple', '../sibling-secret.txt');
        expect(result).toEqual({ model_hash_unavailable: 'file_not_found' });
      } finally {
        await fs.rm(sibling, { force: true });
      }
    });
  });
});
