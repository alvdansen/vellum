import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { hashComponentBytes, type HashOutcome } from '../ingredient-hasher.js';

/**
 * Phase 15 Plan 15-01 Task 3 — streaming SHA-256 for component image
 * inputs referenced in the resolved prompt blob.
 *
 * Mirrors src/engine/output-hash.ts: same path-traversal guard, same
 * createReadStream + createHash pipeline. Returns a discriminated union
 * { hash } | { component_unavailable: 'file_not_found' | 'file_unreadable' }
 * so callers (Plan 15-03 Engine.signOutput) can record the typed
 * unavailable reason directly into the c2pa.ingredient assertion.
 *
 * T-15-02 mitigation: filename traversal characters ('..', '/', '\\', NUL)
 * rejected BEFORE any filesystem call; degrades to 'file_not_found'.
 * T-15-04 mitigation: returns ONLY the hex digest OR a typed reason —
 * NEVER the resolved filesystem path.
 */

// SHA-256 of UTF-8 "test" (4 bytes)
const TEST_BYTES_HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('hashComponentBytes (PROV-V-04 D-CTX-2; mirrors output-hash.ts)', () => {
  let inputsDir: string;
  beforeEach(async () => {
    inputsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vfx-ingredient-hash-'));
  });
  afterEach(async () => {
    // Best-effort cleanup; for the EACCES test we re-chmod first.
    try {
      await fs.rm(inputsDir, { recursive: true, force: true });
    } catch {
      // ignore on platforms / permissions where cleanup may fail
    }
  });

  it('Test 1 — happy path: known bytes → expected hash', async () => {
    const verDir = path.join(inputsDir, 'ver_alpha');
    await fs.mkdir(verDir, { recursive: true });
    await fs.writeFile(path.join(verDir, 'control.png'), 'test');
    const result = await hashComponentBytes(inputsDir, 'ver_alpha', 'control.png');
    expect(result).toEqual<HashOutcome>({ hash: TEST_BYTES_HASH });
  });

  it('Test 2 — file_not_found: file does not exist → typed unavailable', async () => {
    const verDir = path.join(inputsDir, 'ver_alpha');
    await fs.mkdir(verDir, { recursive: true });
    const result = await hashComponentBytes(inputsDir, 'ver_alpha', 'missing.png');
    expect(result).toEqual<HashOutcome>({ component_unavailable: 'file_not_found' });
  });

  it('Test 2b — versionId directory does not exist → file_not_found (no throw)', async () => {
    const result = await hashComponentBytes(inputsDir, 'ver_nope', 'control.png');
    expect(result).toEqual<HashOutcome>({ component_unavailable: 'file_not_found' });
  });

  it("Test 3 — path-traversal '..' → file_not_found (degrade, never reach filesystem)", async () => {
    const result = await hashComponentBytes(inputsDir, 'ver_alpha', '../etc/passwd');
    expect(result).toEqual<HashOutcome>({ component_unavailable: 'file_not_found' });
  });

  it("Test 4 — path-traversal absolute '/' → file_not_found", async () => {
    const result = await hashComponentBytes(inputsDir, 'ver_alpha', '/etc/passwd');
    expect(result).toEqual<HashOutcome>({ component_unavailable: 'file_not_found' });
  });

  it("Test 5 — path-traversal Windows '\\' → file_not_found", async () => {
    const result = await hashComponentBytes(inputsDir, 'ver_alpha', '..\\windows\\system32');
    expect(result).toEqual<HashOutcome>({ component_unavailable: 'file_not_found' });
  });

  it("Test 6 — NUL byte in filename → file_not_found", async () => {
    const result = await hashComponentBytes(inputsDir, 'ver_alpha', 'good\0bad.png');
    expect(result).toEqual<HashOutcome>({ component_unavailable: 'file_not_found' });
  });

  it('Test 6b — empty filename → file_not_found', async () => {
    const result = await hashComponentBytes(inputsDir, 'ver_alpha', '');
    expect(result).toEqual<HashOutcome>({ component_unavailable: 'file_not_found' });
  });

  it('Test 7 — file_unreadable: chmod 000 on parent dir → typed unavailable (POSIX only)', async () => {
    // On Windows, chmod is largely a no-op so EACCES does not surface;
    // skip the test conditionally — the architecture-purity intent is
    // preserved on POSIX.
    if (process.platform === 'win32') {
      return;
    }
    // On macOS/Linux, root user often bypasses POSIX permission checks; skip
    // the test in that case so CI containers running as root don't false-pass.
    if (process.getuid && process.getuid() === 0) {
      return;
    }
    const verDir = path.join(inputsDir, 'ver_perm');
    await fs.mkdir(verDir, { recursive: true });
    await fs.writeFile(path.join(verDir, 'control.png'), 'test');
    // Chmod the version dir to 000 → stat() throws EACCES on the file path
    await fs.chmod(verDir, 0o000);
    try {
      const result = await hashComponentBytes(inputsDir, 'ver_perm', 'control.png');
      expect(result).toEqual<HashOutcome>({ component_unavailable: 'file_unreadable' });
    } finally {
      // Restore so afterEach's rm(recursive) can cleanup
      await fs.chmod(verDir, 0o755);
    }
  });

  it('Test 8 — content-addressed: identical bytes in different versionId paths produce identical hashes', async () => {
    const verA = path.join(inputsDir, 'ver_a');
    const verB = path.join(inputsDir, 'ver_b');
    await fs.mkdir(verA, { recursive: true });
    await fs.mkdir(verB, { recursive: true });
    const bytes = Buffer.from('shared-content-bytes');
    await fs.writeFile(path.join(verA, 'control.png'), bytes);
    await fs.writeFile(path.join(verB, 'control.png'), bytes);
    const ra = await hashComponentBytes(inputsDir, 'ver_a', 'control.png');
    const rb = await hashComponentBytes(inputsDir, 'ver_b', 'control.png');
    expect('hash' in ra && 'hash' in rb).toBe(true);
    if ('hash' in ra && 'hash' in rb) {
      expect(ra.hash).toBe(rb.hash);
      // And the hash is content-addressed:
      const expected = createHash('sha256').update(bytes).digest('hex');
      expect(ra.hash).toBe(expected);
    }
  });

  it('Test 9 — large file (10MB random bytes) completes without OOM (streaming proof)', async () => {
    const verDir = path.join(inputsDir, 'ver_big');
    await fs.mkdir(verDir, { recursive: true });
    const big = Buffer.alloc(10 * 1024 * 1024); // 10MB zeros
    await fs.writeFile(path.join(verDir, 'big.bin'), big);
    const result = await hashComponentBytes(inputsDir, 'ver_big', 'big.bin');
    expect('hash' in result).toBe(true);
    if ('hash' in result) {
      const expected = createHash('sha256').update(big).digest('hex');
      expect(result.hash).toBe(expected);
    }
  });

  it('Test 10 — return shape never contains the resolved filesystem path (T-15-04)', async () => {
    // Ensure we never leak absolute paths via the return shape — only the
    // hex digest OR a typed reason code.
    const verDir = path.join(inputsDir, 'ver_alpha');
    await fs.mkdir(verDir, { recursive: true });
    await fs.writeFile(path.join(verDir, 'control.png'), 'test');
    const result = await hashComponentBytes(inputsDir, 'ver_alpha', 'control.png');
    const json = JSON.stringify(result);
    expect(json).not.toContain(inputsDir);
    expect(json).not.toContain('control.png');
    expect(json).not.toContain('ver_alpha');
  });

  it('Test 11 — discriminated union: success branch has only hash field; failure branch has only component_unavailable', async () => {
    const verDir = path.join(inputsDir, 'ver_alpha');
    await fs.mkdir(verDir, { recursive: true });
    await fs.writeFile(path.join(verDir, 'control.png'), 'test');

    const success = await hashComponentBytes(inputsDir, 'ver_alpha', 'control.png');
    expect(Object.keys(success).sort()).toEqual(['hash']);

    const failure = await hashComponentBytes(inputsDir, 'ver_alpha', 'missing.png');
    expect(Object.keys(failure).sort()).toEqual(['component_unavailable']);
  });
});
