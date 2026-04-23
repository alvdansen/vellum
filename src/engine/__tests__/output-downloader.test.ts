import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStackWithOutputs } from '../../test-utils/fixtures.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import { downloadOutput } from '../output-downloader.js';
import { TypedError } from '../errors.js';
import type { ComfyUIClient } from '../../comfyui/client.js';

/**
 * Plan 05-02 Task 1 — output-downloader tests.
 *
 * D-WEBUI-26: non-fatal download. Every failure returns null, never throws.
 * T-5-03 (mitigate): no raw fetch — reuses ComfyUIClient.downloadToPath which
 * enforces bearer auth + SSRF guard + byte cap + allowlisted base URL.
 *
 * Covers:
 *  - Happy path: file lands in outputsDir/versionId/filename
 *  - client=null → returns null, no throw, logs to stderr
 *  - downloadToPath throws DOWNLOAD_FAILED → returns null, no throw
 *  - mkdir called before downloadToPath (directory created before write)
 */

describe('downloadOutput', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups) c();
    cleanups.length = 0;
    vi.restoreAllMocks();
  });

  it('happy path: writes file to outputsDir/versionId/filename and returns the absolute path', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);

    const filename = 'ComfyUI_00001_.png';
    const result = await downloadOutput(
      stack.client as unknown as ComfyUIClient,
      'ver_happy',
      stack.outputsDir,
      filename,
    );

    expect(result).not.toBeNull();
    const expectedPath = join(stack.outputsDir, 'ver_happy', filename);
    expect(result).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);

    // Fake writes the PNG magic header — verify content was actually written.
    const buf = readFileSync(expectedPath);
    expect(buf.byteLength).toBe(4);
    expect(buf[0]).toBe(0x89); // PNG magic byte 1
    expect(buf[1]).toBe(0x50); // 'P'

    // Confirm the fake's downloadToPath was invoked with the correct filename.
    const dlCalls = stack.client.calls.filter((c) => c.method === 'download');
    expect(dlCalls).toHaveLength(1);
    expect(dlCalls[0].args[0]).toBe(filename);
  });

  it('client=null: returns null, does not throw, logs to stderr', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await downloadOutput(null, 'ver_nullclient', '/tmp/nonexistent', 'out.png');

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    // Log must mention the version id so ops can diagnose which version's
    // download was skipped.
    const loggedArgs = errSpy.mock.calls.flat();
    const loggedStr = loggedArgs.map(String).join(' ');
    expect(loggedStr).toContain('ver_nullclient');
  });

  it('downloadToPath throws DOWNLOAD_FAILED: returns null, does not throw, logs to stderr', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);

    // Force the fake into hopeless scenario — every download call throws.
    stack.client.scenario = 'download-hopeless';

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await downloadOutput(
      stack.client as unknown as ComfyUIClient,
      'ver_fail',
      stack.outputsDir,
      'flaky.png',
    );

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    const loggedStr = errSpy.mock.calls.flat().map(String).join(' ');
    expect(loggedStr).toContain('ver_fail');
    expect(loggedStr).toContain('flaky.png');
  });

  it('mkdir is called before downloadToPath (directory created before write attempt)', async () => {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);

    const filename = 'test.png';
    const result = await downloadOutput(
      stack.client as unknown as ComfyUIClient,
      'ver_mkdir',
      stack.outputsDir,
      filename,
    );

    expect(result).not.toBeNull();
    // Version subdirectory must exist after the call — proves mkdir fired
    // before downloadToPath wrote the file (otherwise fs.writeFile would
    // throw ENOENT and the download would have failed).
    expect(existsSync(join(stack.outputsDir, 'ver_mkdir'))).toBe(true);
    expect(existsSync(join(stack.outputsDir, 'ver_mkdir', filename))).toBe(true);
  });

  it('typed DOWNLOAD_FAILED from downloadToPath is caught (non-fatal contract)', async () => {
    // Build a bare client stub whose downloadToPath throws a TypedError directly.
    const stubClient = {
      downloadToPath: async (): Promise<never> => {
        throw new TypedError('DOWNLOAD_FAILED', 'synthesized typed download failure');
      },
    } as unknown as ComfyUIClient;

    const fakeForDir = new FakeComfyUIClient();
    void fakeForDir; // silence unused — used only to document intent

    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await downloadOutput(stubClient, 'ver_typed', stack.outputsDir, 'typed.png');

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    // No TypedError leaked past the downloader — the contract holds.
  });
});
