#!/usr/bin/env npx tsx
/**
 * Phase 16 Provenance Agent Surface — live smoke test.
 *
 * Exercises the new MCP version tool actions (export_manifest,
 * verify_manifest, redact_manifest) against a server already started on
 * PORT (default 3000). Five sequential checks map to PROV-V-06 + PROV-V-07
 * surface:
 *   1. GET /api/dashboard/home  — server is up
 *   2. POST /mcp tools/list     — version tool exposes the new actions
 *   3. POST /mcp tools/call     — export_manifest VERSION_NOT_FOUND error path
 *   4. POST /mcp tools/call     — verify_manifest INVALID_INPUT (missing
 *                                 discriminator: neither version_id NOR bytes)
 *   5. POST /mcp tools/call     — redact_manifest error path on traversal +
 *                                 missing-version (REDACT_POLICY_INVALID OR
 *                                 VERSION_NOT_FOUND OR INVALID_INPUT — any of
 *                                 these is a valid signal that the action is
 *                                 wired through Zod + the engine)
 *
 * The script does NOT seed a signed manifest — it only exercises the WIRING
 * (tool registration, Zod validation, error code mapping, transport
 * mounting). For a full happy-path smoke, the user must seed a signed
 * version first via the dashboard or a separate script. Error-path checks
 * require no seed state.
 *
 * Usage:
 *   npx tsx verify-phase16-uat.mts             # default port 3000
 *   npx tsx verify-phase16-uat.mts 13001       # custom port
 *   PORT=13001 npx tsx verify-phase16-uat.mts
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed (stderr prints which)
 *
 * Phase 16 cohort closure (Plan 16-05 D-PLAN-5-1).
 */

import { nanoid } from 'nanoid';

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

/**
 * The vfx-familiar HTTP server runs Streamable HTTP in STATELESS mode
 * (sessionIdGenerator: undefined per src/server.ts comment). No mcp-session-id
 * is issued; clients can call tools/list and tools/call directly without
 * an initialize handshake. We still POST initialize as a sanity check (it
 * tests the SSE pipeline end-to-end), but we ignore the absent session id.
 */
async function initializeStatelessProbe(): Promise<void> {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'phase16-smoke', version: '0.0.1' },
      },
    }),
  });
  if (!res.ok) throw new Error(`initialize failed: HTTP ${res.status}`);
  // Drain body to free the connection.
  await res.text();
}

/**
 * Parse an SSE response body for the JSON-RPC payload. Streamable HTTP
 * responses use SSE framing; the JSON-RPC reply is emitted as a single
 * `data:` event line. Falls back to raw JSON parse if no SSE framing.
 */
function parseSseJson(text: string): { result?: unknown; error?: unknown } {
  const dataLine = text.split(/\r?\n/).find((l) => l.startsWith('data:'));
  const jsonText = dataLine ? dataLine.slice('data:'.length).trim() : text.trim();
  return JSON.parse(jsonText) as { result?: unknown; error?: unknown };
}

/**
 * Issue a JSON-RPC tools/call against /mcp (stateless transport — no
 * session id required) and return the unwrapped result.
 */
async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ structuredContent?: unknown; isError?: boolean; content?: unknown }> {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: nanoid(), method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  if (!res.ok) throw new Error(`tools/call HTTP ${res.status}`);
  const text = await res.text();
  let parsed: { result?: unknown; error?: unknown };
  try {
    parsed = parseSseJson(text);
  } catch (err) {
    throw new Error(`Failed to parse tools/call response: ${(err as Error).message} -- raw: ${text.slice(0, 200)}`);
  }
  if (parsed.error) throw new Error(`MCP error: ${JSON.stringify(parsed.error)}`);
  if (!parsed.result) throw new Error('No result in tools/call response');
  return parsed.result as { structuredContent?: unknown; isError?: boolean; content?: unknown };
}

async function main(): Promise<void> {
  const results: CheckResult[] = [];

  // Check 1 — server up.
  results.push(
    await check('GET /api/dashboard/home -> 200', async () => {
      const res = await fetch(`${BASE}/api/dashboard/home`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      await res.text();
    }),
  );

  if (!results[0]!.ok) {
    console.error(`[FAIL] ${results[0]!.name}: ${results[0]!.detail}`);
    console.error(`Hint: start the server with 'npx tsx src/server.ts --http --port ${PORT}'`);
    process.exit(1);
  }

  try {
    await initializeStatelessProbe();
  } catch (err) {
    console.error(`[FAIL] MCP initialize: ${String(err)}`);
    process.exit(1);
  }

  // Check 2 — tools/list reflects the three new version tool actions.
  results.push(
    await check('POST /mcp tools/list -> version exposes export/verify/redact', async () => {
      const res = await fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0', id: nanoid(), method: 'tools/list', params: {},
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const body = parseSseJson(text) as {
        result?: { tools?: Array<{ name: string; inputSchema?: unknown }> };
      };
      const tools = body.result?.tools ?? [];
      const version = tools.find((t) => t.name === 'version');
      if (!version) throw new Error('version tool not registered');
      const schema = JSON.stringify(version.inputSchema ?? {});
      for (const required of ['export_manifest', 'verify_manifest', 'redact_manifest']) {
        if (!schema.includes(required)) {
          throw new Error(`version tool inputSchema missing '${required}' literal`);
        }
      }
    }),
  );

  // Check 3 — export_manifest VERSION_NOT_FOUND on a guaranteed-missing version.
  results.push(
    await check('POST /mcp version.export_manifest -> VERSION_NOT_FOUND on missing version', async () => {
      const result = await callTool('version', {
        action: 'export_manifest',
        version_id: 'ver_does_not_exist_phase16_smoke',
      });
      if (!result.isError) throw new Error('Expected isError=true');
      const code = (result.structuredContent as { code?: string } | undefined)?.code;
      if (code !== 'VERSION_NOT_FOUND') {
        throw new Error(`Expected code=VERSION_NOT_FOUND, got ${code}`);
      }
    }),
  );

  // Check 4 — verify_manifest INVALID_INPUT (no discriminator fields).
  results.push(
    await check('POST /mcp version.verify_manifest -> INVALID_INPUT on missing discriminator', async () => {
      const result = await callTool('version', {
        action: 'verify_manifest',
      });
      if (!result.isError) throw new Error('Expected isError=true');
      const code = (result.structuredContent as { code?: string } | undefined)?.code;
      if (code !== 'INVALID_INPUT') {
        throw new Error(`Expected code=INVALID_INPUT, got ${code}`);
      }
    }),
  );

  // Check 5 — redact_manifest error code on traversal + missing-version.
  // Multiple engine validation orderings produce different valid codes:
  //   - REDACT_SIGNING_DISABLED — c2paConfig is null at server boot (no
  //     VFX_FAMILIAR_C2PA_CERT_PEM_PATH env var). Engine bails BEFORE
  //     validating the version row. This is a typical local-dev smoke run.
  //   - VERSION_NOT_FOUND — engine validates version row before resolver.
  //   - REDACT_POLICY_INVALID — engine's bounded resolver rejects the
  //     traversal path.
  //   - INVALID_INPUT — Zod rejects the policy entry.
  // All four are acceptable smoke signals — they prove the action is wired
  // end-to-end through the version tool router + engine facade.
  results.push(
    await check('POST /mcp version.redact_manifest -> error code on traversal policy', async () => {
      const result = await callTool('version', {
        action: 'redact_manifest',
        version_id: 'ver_does_not_exist_phase16_smoke',
        redaction_policy: ['../etc/passwd'],
      });
      if (!result.isError) throw new Error('Expected isError=true');
      const code = (result.structuredContent as { code?: string } | undefined)?.code;
      const acceptable = new Set([
        'REDACT_SIGNING_DISABLED',
        'VERSION_NOT_FOUND',
        'REDACT_POLICY_INVALID',
        'INVALID_INPUT',
      ]);
      if (typeof code !== 'string' || !acceptable.has(code)) {
        throw new Error(
          `Expected one of ${Array.from(acceptable).join('/')}, got ${code}`,
        );
      }
    }),
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`Phase 16 smoke: ${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) {
    const status = r.ok ? 'OK  ' : 'FAIL';
    console.log(`  [${status}] ${r.name}${r.ok ? '' : ` -- ${r.detail}`}`);
  }
  if (failed.length > 0) {
    for (const r of failed) console.error(`[FAIL] ${r.name}: ${r.detail}`);
    process.exit(1);
  }
}

await main();
