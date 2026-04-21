import { describe, test, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import '../../test-utils/matchers.js';
import {
  versionLabel,
  buildOutputPath,
  ensureDir,
  resolveCollisionSuffix,
  sanitizeRelativeSegment,
} from '../outputs.js';

/**
 * Tests for src/utils/outputs.ts per D-GEN-17 + D-GEN-33 + D-GEN-35.
 * Also covers T-02-01-01 path-traversal defense (sanitizeRelativeSegment).
 */

function uniqueTmpDir(label: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return path.join(os.tmpdir(), `vfx-familiar-${label}-${rand}`);
}

describe('versionLabel (D-GEN-17)', () => {
  test.each([
    [1, 'v001'],
    [10, 'v010'],
    [999, 'v999'],
    [1000, 'v1000'],
    [9999, 'v9999'],
  ])('versionLabel(%i) === %s', (n, expected) => {
    expect(versionLabel(n)).toBe(expected);
  });
});

describe('buildOutputPath (D-GEN-33)', () => {
  test('POSIX-separated path template', () => {
    const p = buildOutputPath({
      projectName: 'My Project',
      sequenceName: 'sq010',
      shotName: 'sh010',
      versionLabel: 'v001',
      filename: 'img.png',
    });
    expect(p).toBe('outputs/My Project/sq010/sh010/v001/img.png');
  });

  test('custom root segment', () => {
    const p = buildOutputPath({
      projectName: 'p',
      sequenceName: 's',
      shotName: 'sh010',
      versionLabel: 'v001',
      filename: 'img.png',
      root: 'alt',
    });
    expect(p).toBe('alt/p/s/sh010/v001/img.png');
  });
});

describe('sanitizeRelativeSegment (T-02-01-01 path-traversal guard)', () => {
  const SAFE = {
    projectName: 'p',
    sequenceName: 's',
    shotName: 'sh010',
    versionLabel: 'v001',
    filename: 'img.png',
  } as const;

  test('rejects ".." anywhere in the filename', () => {
    expect(() => buildOutputPath({ ...SAFE, filename: '../etc/passwd' })).toThrowTypedError(
      'INVALID_INPUT',
    );
  });

  test('rejects forward slash in filename', () => {
    expect(() => buildOutputPath({ ...SAFE, filename: 'evil/sub/file.png' })).toThrowTypedError(
      'INVALID_INPUT',
    );
  });

  test('rejects backslash in filename', () => {
    expect(() => buildOutputPath({ ...SAFE, filename: 'evil\\path.png' })).toThrowTypedError(
      'INVALID_INPUT',
    );
  });

  test('rejects NUL byte in filename', () => {
    expect(() => buildOutputPath({ ...SAFE, filename: 'evil\0byte.png' })).toThrowTypedError(
      'INVALID_INPUT',
    );
  });

  // C1: every segment — not just filename — must be sanitized.
  // Agent-supplied project/sequence/shot names must not escape the outputs root.
  test('C1: rejects ".." in projectName', () => {
    expect(() => buildOutputPath({ ...SAFE, projectName: '..' })).toThrowTypedError(
      'INVALID_INPUT',
    );
    expect(() => buildOutputPath({ ...SAFE, projectName: '../escape' })).toThrowTypedError(
      'INVALID_INPUT',
    );
  });

  test('C1: rejects slash in sequenceName', () => {
    expect(() => buildOutputPath({ ...SAFE, sequenceName: 'a/b' })).toThrowTypedError(
      'INVALID_INPUT',
    );
  });

  test('C1: rejects backslash in shotName', () => {
    expect(() => buildOutputPath({ ...SAFE, shotName: 'sh\\010' })).toThrowTypedError(
      'INVALID_INPUT',
    );
  });

  test('C1: rejects NUL in any segment', () => {
    expect(() => buildOutputPath({ ...SAFE, projectName: 'p\0' })).toThrowTypedError(
      'INVALID_INPUT',
    );
  });

  test('C1: rejects empty or whitespace-only segment', () => {
    expect(() => buildOutputPath({ ...SAFE, projectName: '' })).toThrowTypedError(
      'INVALID_INPUT',
    );
    expect(() => buildOutputPath({ ...SAFE, sequenceName: '   ' })).toThrowTypedError(
      'INVALID_INPUT',
    );
  });

  test('C1: rejects literal "." or ".." segment', () => {
    expect(() => buildOutputPath({ ...SAFE, shotName: '.' })).toThrowTypedError('INVALID_INPUT');
    expect(() => buildOutputPath({ ...SAFE, versionLabel: '..' })).toThrowTypedError(
      'INVALID_INPUT',
    );
  });

  test('sanitizeRelativeSegment accepts normal names with dots and spaces', () => {
    expect(sanitizeRelativeSegment('My Project')).toBe('My Project');
    expect(sanitizeRelativeSegment('v001')).toBe('v001');
    expect(sanitizeRelativeSegment('img.png')).toBe('img.png');
    expect(sanitizeRelativeSegment('file.tar.gz')).toBe('file.tar.gz');
  });
});

describe('ensureDir + resolveCollisionSuffix (D-GEN-35)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = uniqueTmpDir('outputs');
    await ensureDir(dir);
  });

  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('ensureDir is idempotent — second call does not throw on existing dir', async () => {
    await expect(ensureDir(dir)).resolves.toBeUndefined();
    await expect(ensureDir(dir)).resolves.toBeUndefined();
  });

  test('ensureDir creates nested directories recursively', async () => {
    const nested = path.join(dir, 'a', 'b', 'c');
    await expect(ensureDir(nested)).resolves.toBeUndefined();
    expect(fs.existsSync(nested)).toBe(true);
  });

  test('resolveCollisionSuffix returns original filename when no collision', async () => {
    const name = await resolveCollisionSuffix(dir, 'img.png');
    expect(name).toBe('img.png');
  });

  test('resolveCollisionSuffix bumps to _1 when original exists', async () => {
    fs.writeFileSync(path.join(dir, 'img.png'), 'x');
    const name = await resolveCollisionSuffix(dir, 'img.png');
    expect(name).toBe('img_1.png');
  });

  test('resolveCollisionSuffix bumps to _2 when _1 also exists', async () => {
    fs.writeFileSync(path.join(dir, 'img.png'), 'x');
    fs.writeFileSync(path.join(dir, 'img_1.png'), 'x');
    const name = await resolveCollisionSuffix(dir, 'img.png');
    expect(name).toBe('img_2.png');
  });

  test('resolveCollisionSuffix handles filenames with no extension', async () => {
    fs.writeFileSync(path.join(dir, 'README'), 'x');
    const name = await resolveCollisionSuffix(dir, 'README');
    expect(name).toBe('README_1');
  });
});
