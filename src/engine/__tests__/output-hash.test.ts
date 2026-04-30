import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { computeOutputSha256 } from '../output-hash.js';

const TEST_BYTES_HASH =
  // SHA-256 of "test" (4 bytes)
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('computeOutputSha256 (DEMO-03)', () => {
  let outputsDir: string;
  beforeEach(async () => {
    outputsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vfx-hash-'));
  });
  afterEach(async () => {
    await fs.rm(outputsDir, { recursive: true, force: true });
  });

  it('returns the correct SHA-256 hex for a known 4-byte file', async () => {
    const verDir = path.join(outputsDir, 'ver_a');
    await fs.mkdir(verDir, { recursive: true });
    await fs.writeFile(path.join(verDir, 'out.png'), 'test');
    const hash = await computeOutputSha256(outputsDir, 'ver_a', 'out.png');
    expect(hash).toBe(TEST_BYTES_HASH);
  });

  it('returns null when the file does not exist (no throw)', async () => {
    const verDir = path.join(outputsDir, 'ver_a');
    await fs.mkdir(verDir, { recursive: true });
    const hash = await computeOutputSha256(outputsDir, 'ver_a', 'missing.png');
    expect(hash).toBeNull();
  });

  it('returns null when the versionId directory does not exist (no throw)', async () => {
    const hash = await computeOutputSha256(outputsDir, 'ver_nope', 'out.png');
    expect(hash).toBeNull();
  });

  it('streams a 1 MB file and produces the correct hash', async () => {
    const verDir = path.join(outputsDir, 'ver_big');
    await fs.mkdir(verDir, { recursive: true });
    const big = Buffer.alloc(1024 * 1024); // zeros
    await fs.writeFile(path.join(verDir, 'big.bin'), big);
    const hash = await computeOutputSha256(outputsDir, 'ver_big', 'big.bin');
    // Reference hash via Node crypto on the same buffer.
    const expected = createHash('sha256').update(big).digest('hex');
    expect(hash).toBe(expected);
  });

  it('resolves the path strictly as <outputsDir>/<versionId>/<filename>', async () => {
    // Same filename in two different versionId dirs must produce different
    // results — proves the path includes versionId.
    const verA = path.join(outputsDir, 'ver_a');
    const verB = path.join(outputsDir, 'ver_b');
    await fs.mkdir(verA, { recursive: true });
    await fs.mkdir(verB, { recursive: true });
    await fs.writeFile(path.join(verA, 'out.png'), 'aaaa');
    await fs.writeFile(path.join(verB, 'out.png'), 'bbbb');
    const hashA = await computeOutputSha256(outputsDir, 'ver_a', 'out.png');
    const hashB = await computeOutputSha256(outputsDir, 'ver_b', 'out.png');
    expect(hashA).not.toBe(hashB);
    expect(hashA).toBe(createHash('sha256').update('aaaa').digest('hex'));
    expect(hashB).toBe(createHash('sha256').update('bbbb').digest('hex'));
  });
});
