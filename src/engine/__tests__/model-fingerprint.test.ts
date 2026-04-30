import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fingerprintModel } from '../model-fingerprint.js';

describe('fingerprintModel (PROV-V-03) — Task 2 contract', () => {
  it('exports an async function returning the discriminated union', async () => {
    // Minimal contract test: helper exists + returns a Promise that resolves
    // to either { model_hash } or { model_hash_unavailable }. Full surface
    // covered by the Task 3 test set below.
    const result = await fingerprintModel(null, 'CheckpointLoaderSimple', 'x.safetensors');
    expect('model_hash_unavailable' in result || 'model_hash' in result).toBe(true);
  });
});
