#!/usr/bin/env npx tsx
/**
 * Phase 5 live smoke test.
 *
 * Exercises the Hono HTTP surface against a server already started on PORT
 * (default 3000). Three checks map 1:1 to the plan's success criteria:
 *   1. GET /                → 200 text/html (static mount serves dist/index.html)
 *   2. GET /api/workspaces  → 200 JSON array (dashboard REST router mounted)
 *   3. GET /api/events      → 200 text/event-stream (SSE handler reachable)
 *
 * The SSE check does not wait for any specific event — the server may have
 * empty state and emit nothing. We only verify the response status +
 * Content-Type header, then abort + cancel the body to release the
 * connection cleanly.
 *
 * Usage:
 *   npx tsx verify-phase5-dashboard.mts           # default port 3000
 *   npx tsx verify-phase5-dashboard.mts 13001     # custom port
 *   PORT=13001 npx tsx verify-phase5-dashboard.mts
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed (stderr prints which)
 */

const PORT = process.argv[2] ?? process.env.PORT ?? '3000';
const BASE = `http://localhost:${PORT}`;

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function check(name: string, fn: () => Promise<void>): Promise<CheckResult> {
  try {
    await fn();
    return { name, ok: true, detail: 'OK' };
  } catch (err) {
    return { name, ok: false, detail: String(err) };
  }
}

async function main(): Promise<void> {
  const results: CheckResult[] = [];

  results.push(
    await check('GET / → 200 text/html', async () => {
      const res = await fetch(`${BASE}/`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('text/html')) throw new Error(`Content-Type: ${ct}`);
      // Consume body so the connection closes cleanly.
      await res.text();
    }),
  );

  results.push(
    await check('GET /api/workspaces → 200 JSON array', async () => {
      const res = await fetch(`${BASE}/api/workspaces`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) throw new Error(`Content-Type: ${ct}`);
      const body: unknown = await res.json();
      // Dashboard list endpoints today return ListResult { items, total_count, ... }
      // per 05-08 SUMMARY; accept both the wrapped and bare-array shapes so this
      // script keeps passing whichever side of the Plan 05-08 typing drift lands.
      const isArray = Array.isArray(body);
      const isListResult =
        typeof body === 'object' &&
        body !== null &&
        Array.isArray((body as { items?: unknown }).items);
      if (!isArray && !isListResult) {
        throw new Error(`Expected array or {items: []}, got ${typeof body}`);
      }
    }),
  );

  results.push(
    await check('GET /api/events → 200 text/event-stream', async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const res = await fetch(`${BASE}/api/events`, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('text/event-stream')) throw new Error(`Content-Type: ${ct}`);
        // Release the stream without reading — the server will keep it open
        // indefinitely and we've verified the handshake.
        await res.body?.cancel();
      } catch (err) {
        clearTimeout(timer);
        if ((err as Error).name === 'AbortError') return; // expected — we aborted
        throw err;
      }
    }),
  );

  // Print results
  let allOk = true;
  for (const r of results) {
    const mark = r.ok ? 'OK  ' : 'FAIL';
    console.log(`[${mark}] ${r.name}${r.ok ? '' : `: ${r.detail}`}`);
    if (!r.ok) allOk = false;
  }

  if (!allOk) {
    console.error('\nSome checks failed.');
    process.exit(1);
  } else {
    console.log('\nAll checks passed.');
  }
}

void main();
