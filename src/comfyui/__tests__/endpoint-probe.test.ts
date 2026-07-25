/**
 * Endpoint drift sentinel (Phase 7, D-EP-13 + D-EP-14).
 *
 * Gated on COMFYUI_API_KEY + RUN_PROBE=1 double opt-in (mirrors live-smoke's
 * IT-19 pattern). When opted in, this test issues ONE raw GET against
 * ${COMFYUI_API_BASE}${HEALTHCHECK_PATH} and asserts res.status === 200.
 *
 * Why it exists (D-EP-13):
 *   The first-submit healthcheck in ComfyUIClient.ensureEndpointHealthy catches
 *   drift at runtime but only fires when an MCP agent submits a workflow. The
 *   sentinel gives operators + future CI a fast, standalone way to verify the
 *   locked base is still alive without spinning up the whole engine or burning
 *   a single credit.
 *
 *   Read-only GET against HEALTHCHECK_PATH — zero credit burn, safe to re-run.
 *
 * Gate strategy:
 *   const SKIP_PROBE = !process.env.COMFYUI_API_KEY || process.env.RUN_PROBE !== '1';
 *   describe.skipIf(SKIP_PROBE)('endpoint-probe sentinel (D-EP-13)', ...);
 *
 * Default `npx vitest run` (no RUN_PROBE) leaves the describe block skipped
 * even when COMFYUI_API_KEY is loaded from .env. This keeps the quick-run
 * baseline at 2 skipped tests from live-smoke PLUS 1 skipped here = 3 total
 * skipped (D-EP-13 invariant).
 *
 * Manual run:
 *   RUN_PROBE=1 npx vitest run src/comfyui/__tests__/endpoint-probe.test.ts
 *
 * If this sentinel fails with status ≠ 200, drift has returned. Run
 * `npx tsx scripts/probe-comfy-endpoint.mts` to diagnose the current live
 * endpoint, then update .env + src/comfyui/client.ts DEFAULT_COMFYUI_API_BASE
 * per 07-VERIFICATION.md §Rotation Procedure.
 */
import { describe, test, expect } from 'vitest';
import { DEFAULT_COMFYUI_API_BASE, HEALTHCHECK_PATH } from '../client.js';

// D-EP-13: double opt-in. Separate RUN_PROBE flag (not RUN_LIVE_SMOKE) so a
// routine `RUN_LIVE_SMOKE=1 npx vitest run` does not also fire the sentinel —
// the sentinel is cheap but semantically distinct (drift-only vs full round-trip).
const SKIP_PROBE =
  !process.env.COMFYUI_API_KEY || process.env.RUN_PROBE !== '1';

describe.skipIf(SKIP_PROBE)('endpoint-probe sentinel (D-EP-13)', () => {
  test('healthcheck endpoint returns 200 for the current key', async () => {
    const apiKey = process.env.COMFYUI_API_KEY!;
    const apiBase = process.env.COMFYUI_API_BASE ?? DEFAULT_COMFYUI_API_BASE;
    const url = new URL(HEALTHCHECK_PATH, apiBase);

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey },
      // D-GEN-22: never auto-follow — Node's fetch preserves X-API-Key across
      // cross-origin redirects, which would leak the key on a drifted base URL.
      redirect: 'manual',
    });

    expect(res.status).toBe(200);
  }, 10_000); // 10s outer timeout — healthcheck should be sub-second in practice.
});
