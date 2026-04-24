#!/usr/bin/env node
import 'dotenv/config';
/**
 * ComfyUI Cloud endpoint probe (Phase 7, D-EP-01..05).
 *
 * Walks a base × path matrix with X-API-Key to identify the live ComfyUI Cloud
 * endpoint that authenticates and returns 200 for this key. Read-only GET only
 * — zero credits burned, safe to re-run after drift or rotation.
 *
 * Invocation (MUST run from repo root — dotenv loads .env relative to cwd):
 *   npx tsx scripts/probe-comfy-endpoint.mts
 *
 * Exit codes (per 07-RESEARCH.md §Landmine 3):
 *   0 — At least one (base, path) combo returned 200 (probe winner identified)
 *   1 — All combos returned 401 (likely bad/expired key — rotate at https://platform.comfy.org)
 *   2 — All combos returned non-401 non-200 (likely endpoint drift beyond matrix)
 *   3 — Script failed to load COMFYUI_API_KEY (missing .env or missing key line)
 *   4 — Docs fetch failed AND all hardcoded bases failed (network issue)
 *
 * Security: key is never echoed to stdout. Header banner shows ****<last4> only.
 */

const ansi = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

const HARDCODED_BASES = [
  'https://cloud.comfy.org',
  'https://api.comfy.org',
  'https://www.comfy.org/api',
] as const;

const PROBE_PATHS = ['/api/queue', '/api/system_stats', '/api/history', '/'] as const;

const PROBE_TIMEOUT_MS = 5000;
const DOCS_URL = 'https://docs.comfy.org/development/cloud/overview';

/**
 * Returns the key identifier fragment for log output — never leaks the full key.
 * Used ONLY in the header banner. Body-scrub uses apiKey.replaceAll(...) directly.
 */
function last4(key: string): string {
  if (key.length < 4) return '****';
  return '****' + key.slice(-4);
}

/**
 * Wraps fetch in an AbortController with a timeout. Throws a friendlier error
 * than the default AbortError so the matrix cell shows "timeout after 5000ms"
 * rather than a stack-trace snippet.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Graceful dynamic discovery of the docs-advertised base URL. Returns null on
 * any failure (fetch error, non-2xx, regex miss) so the matrix still runs
 * against the hardcoded bases. Never throws. Per 07-RESEARCH.md §Landmine 5.
 */
async function discoverDocsBase(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(DOCS_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    // Simple regex — look for the first https://<subdomain>.comfy.org that is
    // NOT docs.comfy.org (self-reference).
    const m = html.match(/https:\/\/([a-z0-9-]+\.comfy\.org)/i);
    if (!m) return null;
    const host = m[1];
    if (host === 'docs.comfy.org') return null;
    return `https://${host}`;
  } catch {
    return null;
  }
}

interface ProbeResult {
  base: string;
  path: string;
  status: number | 'ERR' | 'TIMEOUT';
  snippet: string;
  elapsedMs: number;
}

/**
 * Executes a single probe combo: GET ${base}${path} with X-API-Key header.
 *
 * Security invariants:
 *   - redirect: 'manual' — never follow a 302 with the key header attached
 *     (T-DRIFT-02: prevents a compromised base from bouncing the key to an
 *     attacker-controlled host).
 *   - Response body is read but capped at 200 bytes before display, and any
 *     occurrence of the raw apiKey in the body is scrubbed to [redacted]
 *     (T-DRIFT-01: prevents misconfigured servers that echo the X-API-Key
 *     header in error text from leaking the key to stdout).
 */
async function probe(base: string, path: string, apiKey: string): Promise<ProbeResult> {
  const url = new URL(path, base);
  const started = Date.now();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: { 'X-API-Key': apiKey },
        redirect: 'manual',
      },
      PROBE_TIMEOUT_MS,
    );
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const msg = (err as Error).message;
    const status: 'ERR' | 'TIMEOUT' = msg.startsWith('timeout') ? 'TIMEOUT' : 'ERR';
    return { base, path, status, snippet: msg, elapsedMs };
  }
  const elapsedMs = Date.now() - started;
  let snippet = '';
  try {
    const raw = await res.text();
    snippet = raw.slice(0, 200);
    // Defense in depth: scrub the raw key value out of any echoed body content.
    snippet = snippet.replaceAll(apiKey, '[redacted]');
  } catch {
    snippet = '';
  }
  return { base, path, status: res.status, snippet, elapsedMs };
}

async function main(): Promise<void> {
  const apiKey = process.env.COMFYUI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.error(ansi.red('FATAL:') + ' COMFYUI_API_KEY not set.');
    console.error(ansi.dim('  Ensure .env exists at repo root with COMFYUI_API_KEY=... and re-run.'));
    console.error(ansi.dim(`  Current cwd: ${process.cwd()}`));
    process.exit(3);
  }

  console.log(ansi.bold('── ComfyUI Endpoint Probe (Phase 7, D-EP-01..05) ──'));
  console.log(`  cwd: ${process.cwd()}`);
  console.log(`  key: ${last4(apiKey)}`);
  console.log(`  timeout per probe: ${PROBE_TIMEOUT_MS}ms`);
  console.log('');

  // Discover docs-advertised base (graceful degradation — never aborts the run).
  const docsBase = await discoverDocsBase();
  if (docsBase) {
    console.log(ansi.dim(`  docs-advertised base: ${docsBase}`));
  } else {
    console.error(ansi.yellow('  note: docs fetch failed — proceeding with hardcoded bases only'));
  }
  console.log('');

  // Build final base list — append docsBase only if it's not already hardcoded.
  const bases: string[] = [
    ...HARDCODED_BASES,
    ...(docsBase && !HARDCODED_BASES.includes(docsBase as typeof HARDCODED_BASES[number])
      ? [docsBase]
      : []),
  ];

  // Serial matrix run — deterministic output order, avoids thundering-herd on a
  // single host. Worst case: 4 bases × 4 paths × 5s = 80s.
  const results: ProbeResult[] = [];
  for (const base of bases) {
    for (const path of PROBE_PATHS) {
      const r = await probe(base, path, apiKey);
      results.push(r);
      const statusStr =
        typeof r.status === 'number'
          ? r.status === 200
            ? ansi.green(String(r.status))
            : r.status === 401
            ? ansi.yellow(String(r.status))
            : ansi.red(String(r.status))
          : ansi.red(String(r.status));
      console.log(`  ${statusStr}  ${base}${path}  ${ansi.dim(`(${r.elapsedMs}ms)`)}`);
      if (r.snippet) {
        console.log(ansi.dim(`       ${r.snippet.slice(0, 100).replace(/\n/g, ' ')}`));
      }
    }
  }

  // Summary + exit-code computation (per Landmine 3 matrix).
  const any200 = results.some((r) => r.status === 200);
  const all401 = results.length > 0 && results.every((r) => r.status === 401);
  const hardcodedBasesAllFailed = HARDCODED_BASES.every((b) =>
    results.filter((r) => r.base === b).every((r) => r.status !== 200),
  );

  console.log('\n' + ansi.bold('── SUMMARY ──'));
  if (any200) {
    const winner = results.find((r) => r.status === 200)!;
    console.log(ansi.green(`  WINNER: ${winner.base}${winner.path} → 200`));
    console.log(
      ansi.dim(
        `  Use this as DEFAULT_COMFYUI_API_BASE (${winner.base}) and HEALTHCHECK_PATH (${winner.path}) in Phase 7 plans 02 + 03.`,
      ),
    );
    process.exit(0);
  }
  if (all401) {
    console.log(ansi.red('  NO WORKING COMBO FOUND — all responses were 401 Unauthorized.'));
    console.log(ansi.yellow('  Most likely cause: the API key needs to be rotated.'));
    console.log(ansi.yellow('  → Issue a new key at https://platform.comfy.org → API Keys → "+ New"'));
    console.log(ansi.yellow('  → Replace COMFYUI_API_KEY in .env and re-run this probe.'));
    process.exit(1);
  }
  if (!docsBase && hardcodedBasesAllFailed) {
    console.log(ansi.red('  Docs fetch failed AND all hardcoded bases failed — likely network issue.'));
    process.exit(4);
  }
  console.log(
    ansi.red('  NO 200 found. See matrix above for mixed 401/404/other — likely endpoint drift.'),
  );
  process.exit(2);
}

try {
  await main();
} catch (err) {
  console.error('\n' + ansi.red('FATAL:'), (err as Error).message);
  if ((err as Error).stack) console.error(ansi.dim((err as Error).stack!));
  process.exit(2);
}
