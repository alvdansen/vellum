# Phase 7: ComfyUI Endpoint Reconciliation - Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 12 (4 new, 8 modified)
**Analogs found:** 11 / 12 (one memory file has no in-repo analog by design — see §No Analog Found)

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `scripts/probe-comfy-endpoint.mts` | NEW — operator diagnostic script | request-response (read-only HTTP matrix) | `scripts/inspector-smoke.mjs` | role-match (only existing script in `scripts/`; same operator-one-shot intent, different protocol) |
| `src/comfyui/client.ts` (modify) | HTTP client extension — add `HEALTHCHECK_PATH` export, `ensureEndpointHealthy()` private method, `submit()` wiring, swap `DEFAULT_COMFYUI_API_BASE` value | request-response | `src/comfyui/client.ts` itself (existing `submit`/`status`/`download` methods on lines 190-401) | exact (same file, same class — mirror in-place) |
| `src/engine/errors.ts` (modify) | Append `'COMFYUI_ENDPOINT_DRIFT'` literal to `ErrorCode` union | n/a (type definition) | `src/engine/errors.ts` itself (existing union entries lines 4-35) | exact (same file, same union) |
| `src/comfyui/__tests__/endpoint-probe.test.ts` | NEW — Vitest sentinel test (gated, single 200 assertion) | event-driven (test gate + single fetch) | `src/comfyui/__tests__/live-smoke.test.ts` (`describe.skipIf(SKIP)` + double-opt-in pattern) | exact (deliberate shrunk live-smoke shape per D-EP-13) |
| `src/comfyui/__tests__/client.test.ts` (extend) | Add 4 unit cases for `ensureEndpointHealthy()` | unit test | Same file's existing suites (`describe('ComfyUIClient.submit')` etc., lines 45-292+) | exact (extend in-place; reuse `mockFetch`/`jsonResponse` helpers from lines 25-40) |
| `.env.example` (modify) | Update `COMFYUI_API_BASE=…` value + add 1-line comment pointing at `07-VERIFICATION.md` | config | `.env.example` itself (already contains the line per Phase 2 D-GEN-09) | exact (in-place value swap) |
| `.env` (modify, gitignored) | Update `COMFYUI_API_BASE=…` value to the locked base | config | `.env.example` (only mirror checked into repo) | role-match (file is gitignored — analog is `.env.example`) |
| `.planning/phases/07-comfyui-endpoint-reconciliation/07-VERIFICATION.md` | NEW — canonical resolution doc (4 required sections per D-EP-12) | doc | `.planning/phases/02-comfyui-generation/02-VERIFICATION.md` | role-match (same doc family; Phase 7's content is a runbook, not a 5-must-haves verification — section headers and frontmatter style copy verbatim) |
| `.planning/phases/02-comfyui-generation/02-VERIFICATION.md` (append) | Append `## Endpoint Reconciliation (Phase 7, 2026-04-XX)` section (1 paragraph + link) | doc | The same file's existing `## ` headers (lines 19, 35, 59, 78, 89, 102, 119, 130, 146) | exact (append to existing file with matching header style) |
| `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/project_comfy_api_endpoint_drift.md` (modify) | Mark `RESOLVED 2026-04-XX` in body OR remove file entirely | memory | Existing memory files in same dir | exact (same frontmatter shape) |
| `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/reference_env_comfyui_key.md` (modify) | Update body line 9 (`COMFYUI_API_BASE=…`) to reflect locked base | memory | Same file (in-place body edit) | exact (in-place body edit) |
| `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/MEMORY.md` (modify) | Update or remove the index entries for the two memories above | memory index | `MEMORY.md` itself (3 lines, one-line-per-entry format) | exact (in-place edit) |

---

## Pattern Assignments

### `scripts/probe-comfy-endpoint.mts` (NEW — operator diagnostic, request-response)

**Analog:** `scripts/inspector-smoke.mjs`
**Why this is the closest:** It is the ONLY existing file under `scripts/`. Same intent (operator-runnable one-shot diagnostic), same execution pattern (`npx tsx` / `node`), same need for a top-of-file docstring with run instructions and exit-code semantics. The protocol differs (MCP SDK client vs. raw `fetch`) but the script-level shape is reusable verbatim.

**Header / shebang / docstring pattern** (`scripts/inspector-smoke.mjs:1-13`):
```javascript
#!/usr/bin/env node
// Programmatic MCP Inspector smoke for both transports.
// Uses the real MCP SDK client — same handshake, tool discovery,
// and invocation path the browser Inspector uses.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```
*Mirror this:* `#!/usr/bin/env node` shebang, then a `//` comment block describing intent + run command + exit-code semantics (per RESEARCH §Landmine 3), then imports. Add `import 'dotenv/config';` as the **second** line (per `src/server.ts:2` precedent — see "dotenv side-effect import" pattern below).

**ANSI-color pretty-print pattern** (`scripts/inspector-smoke.mjs:14-30`):
```javascript
const ansi = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const results = [];
let anyFail = false;

function check(label, cond, detail = '') {
  const icon = cond ? ansi.green('✓') : ansi.red('✗');
  const line = `  ${icon} ${label}${detail ? ansi.dim(' — ' + detail) : ''}`;
  console.log(line);
  results.push({ label, cond, detail });
  if (!cond) anyFail = true;
}
```
*Mirror this:* Reuse the same `ansi` helper for the matrix table (✓/✗ per cell). Probe-script analog: a `probe(base, path)` helper that pushes `{base, path, status, snippet}` records and prints a row.

**Final summary + exit-code pattern** (`scripts/inspector-smoke.mjs:255-277`):
```javascript
try {
  await runStdio();
  await runHttp();
} catch (err) {
  console.error('\n' + ansi.red('FATAL:'), err?.message || err);
  if (err?.stack) console.error(ansi.dim(err.stack));
  process.exit(2);
}

const total = results.length;
const failed = results.filter((r) => !r.cond).length;
const passed = total - failed;

console.log('\n' + ansi.bold('── SUMMARY ──'));
console.log(`  ${passed}/${total} checks passed`);
if (anyFail) {
  console.log(ansi.red(`  ${failed} FAILED`));
  for (const r of results.filter((r) => !r.cond)) {
    console.log(`    - ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  }
  process.exit(1);
}
console.log(ansi.green('  all good'));
```
*Mirror this for probe:* try/catch wrapper around the matrix run, summary block at the end. RESEARCH §Landmine 3 specifies richer exit codes (0=winner, 1=all-401, 2=all-other, 3=missing-key, 4=docs-failed-and-bases-failed); apply those semantics to the `process.exit(...)` calls.

**dotenv side-effect import** (`src/server.ts:1-2`):
```typescript
#!/usr/bin/env node
import 'dotenv/config';
// ... (all other imports below)
```
*Apply to probe:* place `import 'dotenv/config';` at line 2 immediately after the shebang. RESEARCH §Landmine 1 notes the cwd-dependency; the script must be run from repo root (document this in the top-of-file comment and print `cwd: ${process.cwd()}` in the header banner).

---

### `src/comfyui/client.ts` (MODIFY — add `HEALTHCHECK_PATH` export, `ensureEndpointHealthy()` method, swap default base)

**Analog:** Same file. The existing `submit()`, `status()`, `download()` methods (lines 190-401) are the canonical fetch-wrapper shape that `ensureEndpointHealthy()` must mirror.

**Module-level constant export pattern** (`src/comfyui/client.ts:29-34`):
```typescript
/**
 * Canonical ComfyUI Cloud base URL. Exported so server wiring and test
 * fixtures agree on one literal (no more scattered copies of the same host).
 * Per D-GEN-21; override with COMFYUI_API_BASE for self-hosted tenants.
 */
export const DEFAULT_COMFYUI_API_BASE = 'https://cloud.comfy.org';
```
*Mirror for `HEALTHCHECK_PATH`:* place a sibling `export const HEALTHCHECK_PATH = '...'` declaration directly under `DEFAULT_COMFYUI_API_BASE` (lines 35-ish), with a JSDoc block citing D-EP-14. The value is set by the probe winner (per RESEARCH External State, the recommended default is `/api/queue`; the executor MUST confirm via Wave 1 probe before committing the literal).

**Fetch-wrapper pattern (use for healthcheck)** (`src/comfyui/client.ts:190-251`, especially lines 192-212):
```typescript
async submit(workflowJson: Record<string, unknown>): Promise<SubmitResponse> {
  const body: SubmitRequest = { prompt: workflowJson };
  const url = new URL('/api/prompt', this.base);
  let res: Response;
  try {
    res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify(body),
      // Do NOT follow redirects automatically. Node's fetch preserves
      // custom headers (including X-API-Key) across cross-origin redirects.
      // A single 302 from a compromised base URL would exfiltrate the key.
      redirect: 'manual',
    });
  } catch (err) {
    throw new TypedError(
      'COMFYUI_API_ERROR',
      this.scrubAndTruncate(`ComfyUI network error: ${(err as Error).message}`),
    );
  }
```
*Mirror for `ensureEndpointHealthy()`:* same `URL` construction (`new URL(HEALTHCHECK_PATH, this.base)`), same `this.fetchImpl(...)` call, same `headers: { 'X-API-Key': this.apiKey }`, same `redirect: 'manual'` (per RESEARCH §Healthcheck Sketch — the "manual redirect for X-API-Key safety" invariant is non-negotiable). Method is `'GET'`. Wrap in try/catch and translate failures into `TypedError('COMFYUI_ENDPOINT_DRIFT', ...)` (NOT `COMFYUI_API_ERROR`).

**TypedError throw pattern** (`src/comfyui/client.ts:240-245`, also `:208-211`):
```typescript
throw new TypedError(
  'COMFYUI_API_ERROR',
  this.scrubAndTruncate(
    nodeMessage ?? `ComfyUI request failed: ${res.status} ${res.statusText}`,
  ),
);
```
*Mirror for `COMFYUI_ENDPOINT_DRIFT`:* three-arg form (code, message, hint). Message includes `${this.base}${HEALTHCHECK_PATH}` and the observed status. Hint is the verbatim D-EP-08 string: `` `COMFYUI_API_BASE may have drifted (got HTTP ${status} on healthcheck against ${base}${path}). Run \`npx tsx scripts/probe-comfy-endpoint.mts\` to find the current working base, then update .env COMFYUI_API_BASE.` ``. Note: `scrubAndTruncate(...)` is **not** required for the healthcheck message body since it does not echo upstream content — but call it anyway for consistency with the rest of the file (it's a no-op on safe strings and adds zero cost).

**Where to wire the call** (`src/comfyui/client.ts:189-191`):
```typescript
/** POST /api/prompt — returns { prompt_id } (D-GEN-21). */
async submit(workflowJson: Record<string, unknown>): Promise<SubmitResponse> {
  const body: SubmitRequest = { prompt: workflowJson };
```
*Insert as first statement of `submit()`:* `await this.ensureEndpointHealthy();` immediately after the opening brace, BEFORE the `const body = ...` line. Add an inline comment citing D-EP-07 ("first-submit healthcheck; cached for process lifetime").

**Instance-field placement** (lines 127-141 — class declaration through `fetchImpl`):
```typescript
export class ComfyUIClient {
  private allowed: RegExp[];
  // [...long IS-01 comment...]
  private allowedLiteralHosts: string[];
  private fetchImpl: typeof fetch;
```
*Mirror:* add `private healthCheckResult: Promise<void> | null = null;` as a sibling field just after `fetchImpl`. Use `Promise<void>` (not `boolean`) per RESEARCH §Healthcheck Sketch — race-safe memoization. Add a 2-line comment explaining why a Promise (so concurrent callers share one in-flight check; on failure reset to null so retries can fire).

**Default base value swap** (line 34):
```typescript
export const DEFAULT_COMFYUI_API_BASE = 'https://cloud.comfy.org';
```
*Action:* swap the literal to whatever the probe winner is. Per RESEARCH External State (verified 2026-04-24 against `docs.comfy.org`), this is overwhelmingly likely to remain `'https://cloud.comfy.org'` — but the probe is the source of truth. If the value is unchanged, still touch the file (to update the JSDoc above with a `@since 2026-04-XX (Phase 7) — confirmed by probe` line) so the change is auditable.

---

### `src/engine/errors.ts` (MODIFY — append `COMFYUI_ENDPOINT_DRIFT` to `ErrorCode` union)

**Analog:** Same file. Existing union entries (lines 4-35) define the convention.

**ErrorCode union shape** (`src/engine/errors.ts:1-35`):
```typescript
// Typed error model for VFX Familiar engine (D-28..D-32, extended by D-GEN-40).
// Phase 1 codes + Phase 2 generation-lifecycle codes.

export type ErrorCode =
  // Phase 1 — hierarchy
  | 'WORKSPACE_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'SEQUENCE_NOT_FOUND'
  | 'SHOT_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'DUPLICATE_NAME'
  | 'INVALID_SHOT_FORMAT'
  | 'INVALID_INPUT'
  // Phase 2 — generation (D-GEN-40)
  | 'INVALID_WORKFLOW_FORMAT'
  | 'COMFYUI_CREDENTIALS_MISSING'
  | 'COMFYUI_API_ERROR'
  | 'COMFYUI_RATE_LIMITED'
  | 'GENERATION_TIMEOUT'
  | 'DOWNLOAD_FAILED'
  | 'CONCURRENT_SUBMIT_CONFLICT'
  // Phase 3 — provenance & versioning (D-PROV-36)
  | 'PROVENANCE_UNAVAILABLE'
  | 'REPRODUCE_BLOCKED'
  | 'ITERATE_INVALID_PATCH'
  | 'VERSION_NOT_COMPLETED'
  // Phase 4 — asset management (D-ASST-23)
  | 'TAG_INVALID'
  | 'METADATA_INVALID'
  | 'TAG_LIMIT_EXCEEDED'
  | 'METADATA_LIMIT_EXCEEDED'
  | 'INVALID_SCOPE'
  // Phase 5 — web dashboard (D-WEBUI-34)
  | 'OUTPUT_UNAVAILABLE';
```
*Mirror:* add a new comment-grouped entry **AFTER** `'OUTPUT_UNAVAILABLE'` (line 35) to preserve phase-chronological grouping. Note: the existing convention is **not alphabetical** — entries are grouped by phase with a `// Phase N — <area>` header comment. The `OUTPUT_UNAVAILABLE` entry currently terminates the union (no trailing `;` until the close). The new entry must:
1. Keep the trailing `;` on the LAST entry only.
2. Convert the current `'OUTPUT_UNAVAILABLE';` to `'OUTPUT_UNAVAILABLE'` (drop semicolon).
3. Add a new comment `// Phase 7 — endpoint reconciliation (D-EP-08)` followed by `| 'COMFYUI_ENDPOINT_DRIFT';` (new terminating semicolon).

Concrete diff target (insert at line 35-36):
```typescript
  // Phase 5 — web dashboard (D-WEBUI-34)
  | 'OUTPUT_UNAVAILABLE'
  // Phase 7 — endpoint reconciliation (D-EP-08)
  | 'COMFYUI_ENDPOINT_DRIFT';
```

No `TypedError` class change required — the new literal flows through the existing constructor unchanged (`src/engine/errors.ts:42-51`).

---

### `src/comfyui/__tests__/endpoint-probe.test.ts` (NEW — sentinel test, gated 200 assertion)

**Analog:** `src/comfyui/__tests__/live-smoke.test.ts` (315 lines). This is the canonical reference per D-EP-13 — the sentinel is deliberately a shrunk live-smoke (one assertion, same gate idiom, same import shape).

**File-header docstring shape** (`src/comfyui/__tests__/live-smoke.test.ts:1-38`):
```typescript
/**
 * Live smoke test against ComfyUI Cloud (D-GEN-42.7).
 *
 * Gated on COMFYUI_API_KEY. Skips cleanly in CI without the key. This is the
 * honest end-to-end check that replaces any wire-level human-UAT item (per
 * project memory: feedback_dont_punt_on_tests.md — if the item is wire-level,
 * drive it with real calls before escalating).
 *
 * IT-19: double-opt-in gate. COMFYUI_API_KEY alone is no longer sufficient to
 * enable the live smoke test — the developer must ALSO set RUN_LIVE_SMOKE=1.
 * [...]
 *
 * Gate strategy: `describe.skipIf(SKIP)` where
 *   SKIP = !process.env.COMFYUI_API_KEY || process.env.RUN_LIVE_SMOKE !== '1'
 *
 * Default `npx vitest run` (no RUN_LIVE_SMOKE) leaves the describe block
 * skipped even when the developer's .env defines COMFYUI_API_KEY. [...]
 */
```
*Mirror for sentinel:* same JSDoc shape — cite D-EP-13 + D-EP-14, document the gate (`RUN_PROBE=1` + `COMFYUI_API_KEY`), explain the single-assertion intent (catch endpoint drift cheaply without burning credits — read-only GET against `HEALTHCHECK_PATH`).

**Imports + gate constant** (`src/comfyui/__tests__/live-smoke.test.ts:39-56`):
```typescript
import { describe, test, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as pth from 'node:path';
import { nanoid } from 'nanoid';
import { openDb } from '../../store/db.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { Engine } from '../../engine/pipeline.js';
import { ComfyUIClient, DEFAULT_COMFYUI_API_BASE } from '../client.js';
import type { StoredOutput } from '../types.js';

// IT-19: double-opt-in. Credit-burning tests require BOTH a real API key AND
// an explicit RUN_LIVE_SMOKE=1 flag so a routine `npx vitest run` with a
// loaded .env never hits the Cloud by accident.
const SKIP = !process.env.COMFYUI_API_KEY || process.env.RUN_LIVE_SMOKE !== '1';
```
*Mirror for sentinel:* much narrower import surface — only `describe, test, expect` from vitest plus `DEFAULT_COMFYUI_API_BASE, HEALTHCHECK_PATH` from `'../client.js'`. NO database, NO engine, NO ComfyUIClient — the sentinel issues raw `fetch` directly (it's testing the wire-level endpoint contract, not the client wiring). Gate constant:
```typescript
// D-EP-13: separate gate from RUN_LIVE_SMOKE. Read-only GET — burns no credits.
// Manual run: RUN_PROBE=1 npx vitest run src/comfyui/__tests__/endpoint-probe.test.ts
const SKIP = !process.env.COMFYUI_API_KEY || process.env.RUN_PROBE !== '1';
```

**describe.skipIf shape** (`src/comfyui/__tests__/live-smoke.test.ts:125-126`):
```typescript
describe.skipIf(SKIP)('live ComfyUI Cloud smoke (D-GEN-42.7)', () => {
  test('submit → poll → download → output file on disk', async () => {
```
*Mirror for sentinel:* one `describe.skipIf(SKIP)('endpoint-probe sentinel (D-EP-13)', () => { ... })` with one `test('healthcheck endpoint returns 200', async () => { ... })`. Inside the test:
1. Read `apiKey = process.env.COMFYUI_API_KEY!`.
2. Read `apiBase = process.env.COMFYUI_API_BASE ?? DEFAULT_COMFYUI_API_BASE` (mirror live-smoke line 128).
3. Construct `url = new URL(HEALTHCHECK_PATH, apiBase)`.
4. `const res = await fetch(url, { method: 'GET', headers: { 'X-API-Key': apiKey }, redirect: 'manual' });`
5. `expect(res.status).toBe(200);`

Use the live-smoke `apiBase` resolution pattern verbatim — `process.env.COMFYUI_API_BASE ?? DEFAULT_COMFYUI_API_BASE` — so an operator override via `.env` still flows through.

---

### `src/comfyui/__tests__/client.test.ts` (EXTEND — 4 unit cases for `ensureEndpointHealthy()`)

**Analog:** Same file. Existing tests use `mockFetch`/`jsonResponse` helpers (lines 25-40) and the `fetchImpl` injection seam — reuse verbatim.

**Test setup helpers (already at lines 25-40)** — DO NOT recreate, import / reuse:
```typescript
function mockFetch(
  fn: (req: Request | URL | string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const BASE = DEFAULT_COMFYUI_API_BASE;
const KEY = 'sk-test-fake';
```

**Test pattern reference (existing — for shape)** (`src/comfyui/__tests__/client.test.ts:46-65`):
```typescript
test('POST /api/prompt with X-API-Key and {prompt: workflow} body returns {prompt_id}', async () => {
  let capturedInit: RequestInit | undefined;
  let capturedUrl: URL | string | Request | undefined;
  const client = new ComfyUIClient(KEY, BASE, {
    fetchImpl: mockFetch(async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(200, { prompt_id: 'abc123' });
    }),
  });
  const out = await client.submit({ '1': { class_type: 'KSampler', inputs: {} } });
  expect(out.prompt_id).toBe('abc123');
  const u = new URL(capturedUrl!.toString());
  expect(u.pathname).toBe('/api/prompt');
  expect(u.origin).toBe(BASE);
  expect((capturedInit!.headers as Record<string, string>)['X-API-Key']).toBe(KEY);
```

**TypedError-rejection assertion pattern** (`src/comfyui/__tests__/client.test.ts:66-76`):
```typescript
test('429 surfaces COMFYUI_RATE_LIMITED with tier hint', async () => {
  const client = new ComfyUIClient(KEY, BASE, {
    fetchImpl: mockFetch(async () => jsonResponse(429, { error: 'rate limited' })),
  });
  await expect(
    client.submit({ '1': { class_type: 'A', inputs: {} } }),
  ).rejects.toMatchObject({
    name: 'TypedError',
    code: 'COMFYUI_RATE_LIMITED',
  });
});
```
*Apply to 4 new test cases:* Add a new `describe('ComfyUIClient.ensureEndpointHealthy (D-EP-07)', () => { ... })` block at the end of the file (or after the existing `ComfyUIClient.submit` describe). The 4 cases per RESEARCH §Healthcheck Sketch test-level concerns:

1. **Success path + cache hit on second submit:**
   - Provide a `fetchImpl` that returns `200` for GET `HEALTHCHECK_PATH` and `200 { prompt_id }` for POST `/api/prompt`.
   - Call `submit()` twice on the SAME client.
   - Assert: GET `HEALTHCHECK_PATH` was called exactly ONCE total (memoization works); POST `/api/prompt` was called twice; both submits succeeded.

2. **Failure throws DRIFT (not COMFYUI_API_ERROR):**
   - Provide a `fetchImpl` that returns `401` for the GET healthcheck.
   - Call `submit()`.
   - Use `.rejects.toMatchObject({ name: 'TypedError', code: 'COMFYUI_ENDPOINT_DRIFT' })`.
   - Additionally assert the thrown error's `hint` contains `'scripts/probe-comfy-endpoint.mts'`.

3. **Concurrent submits memoize ONE in-flight healthcheck:**
   - Provide a `fetchImpl` whose GET resolves after a deferred `await` (use `new Promise(r => setTimeout(r, 10))`).
   - Call `submit()` twice in parallel via `Promise.all([client.submit(w), client.submit(w)])`.
   - Assert: the GET fetchImpl handler was invoked exactly ONCE (the second submit awaited the first's in-flight Promise).

4. **Failure-retry-reopens-cache (RESEARCH §Pitfall 2):**
   - Provide a `fetchImpl` whose first GET returns `401`, second GET returns `200`, then `200 { prompt_id }` for the POST.
   - Call `submit()` once → expect rejection with `COMFYUI_ENDPOINT_DRIFT`.
   - Call `submit()` AGAIN on the same client → expect success.
   - Assert GET was called exactly TWICE (proves `healthCheckResult` was reset to `null` on the first failure so the second submit retried).

All four cases use the same `mockFetch`/`jsonResponse`/`KEY`/`BASE` helpers already in the file. **Do not import additional vitest helpers** — `describe, test, expect` are already imported on line 1.

---

### `.env.example` (MODIFY — value swap + comment)

**Analog:** Existing `.env.example` itself (already contains `COMFYUI_API_BASE=...` per Phase 2 D-GEN-09 and 02-VERIFICATION.md line 51 confirmation).

> **Permission note:** This pattern-mapper agent could not directly read `.env.example` due to permission restriction on dot-prefixed files in this sandbox. The contents are anchored by `02-VERIFICATION.md:51`: "Contains `COMFYUI_API_KEY`, `COMFYUI_API_BASE=https://cloud.comfy.org`, `COMFYUI_ALLOWED_REDIRECT_HOSTS`." The planner / executor can `Read` the file directly — it is gitignored only in spirit (`.env` is ignored, `.env.example` is committed).

*Action for the planner:* the executor reads `.env.example` first, locates the existing `COMFYUI_API_BASE=...` line, swaps the value to the probe winner, and adds a 1-line comment immediately above it (single-`#` style, matching the rest of the file). Suggested comment text:
```
# Locked by Phase 7 (Endpoint Reconciliation) — see .planning/phases/07-comfyui-endpoint-reconciliation/07-VERIFICATION.md §Rotation Procedure
COMFYUI_API_BASE=<winner>
```
The exact comment style (inline `#` after value vs. preceding line) must be confirmed against the file's existing convention at `Read` time. Fall back to "preceding line" style if neither convention is dominant.

---

### `.env` (MODIFY, gitignored — value swap only)

**Analog:** `.env.example` (the only mirror of `.env`'s shape that is checked into the repo).

> **Why gitignored:** Per Phase 2 D-GEN-09 + project memory `reference_env_comfyui_key.md`, `.env` is gitignored (`.gitignore:1`) and `chmod 600`. This pattern-mapper cannot read it.

*Action for the executor:* mirror the value change in `.env.example` into `.env`. Do NOT add the explanatory comment to `.env` (operator's secrets file — keep it minimal, single key/value lines). Do NOT echo the file contents during execution. Verify by `grep COMFYUI_API_BASE .env` ONLY (never the key value).

---

### `.planning/phases/07-comfyui-endpoint-reconciliation/07-VERIFICATION.md` (NEW — canonical resolution doc)

**Analog:** `.planning/phases/02-comfyui-generation/02-VERIFICATION.md` (156 lines).

**Frontmatter pattern** (`02-VERIFICATION.md:1-9`):
```markdown
---
phase: 02-comfyui-generation
verified: 2026-04-21T10:35:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: null
---

# Phase 2: ComfyUI Generation Verification Report

**Phase Goal:** An agent can submit ComfyUI workflows for generation within a shot context [...]
**Verified:** 2026-04-21T10:35:00Z
**Status:** PASSED
**Re-verification:** No — initial verification
```
*Mirror for 07:* identical frontmatter shape with `phase: 07-comfyui-endpoint-reconciliation`, `verified: <ISO timestamp at write time>`, `status: passed`, `score: 4/4 sections complete` (matches D-EP-12), `overrides_applied: 0`, `re_verification: null`. Title `# Phase 7: ComfyUI Endpoint Reconciliation - Resolution Report`. Then a phase-goal paragraph that paraphrases CONTEXT.md domain block.

**Section-header convention** (existing top-level headers in `02-VERIFICATION.md`):
- `## Goal Achievement` (line 19)
- `### Observable Truths (Phase-level Success Criteria)` (line 21)
- `### Required Artifacts` (line 35)
- `### Key Link Verification` (line 59)
- `### Data-Flow Trace (Level 4)` (line 78)
- `### Behavioral Spot-Checks` (line 89)
- `### Requirements Coverage` (line 102)
- `### Anti-Patterns Found` (line 119)
- `### Human Verification Required` (line 130)
- `## Gaps Summary` (line 146)

*Mirror for 07:* the four required sections per D-EP-12 are NOT a verbatim copy of these — Phase 7 is a runbook, not a multi-truth verification. Use `##` for the four required sections and `###` for sub-sections within. Suggested headers:
- `## 1. Probe Matrix and Chosen Base` (D-EP-12 §1)
- `## 2. Credential Layout / Source-of-Truth` (D-EP-12 §2)
- `## 3. Rotation Procedure` (D-EP-12 §3)
- `## 4. Fallback-If-Redirected and Memory Hygiene` (D-EP-12 §4)

**Table style for probe matrix** (referencing `02-VERIFICATION.md:23-29` Observable Truths table):
```markdown
| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Agent can submit a workflow [...] | VERIFIED | `src/tools/generation-tool.ts:85` delegates to [...] |
```
*Mirror for §1 probe matrix:*
```markdown
| Base | Path | Status | First 200 bytes | Notes |
|------|------|--------|-----------------|-------|
| https://cloud.comfy.org | /api/queue | 200 | `{"queue_running":[],"queue_pending":[]}` | **WINNER** (chosen base + healthcheck) |
| https://cloud.comfy.org | /api/system_stats | 404 | `Not Found` | Diagnostic — legacy local-ComfyUI path absent on Cloud |
| ... etc ... |
```
The probe-matrix table comes from a real Wave 1 run (per RESEARCH §Build-Order Wave 5 — populate AFTER the probe runs).

---

### `.planning/phases/02-comfyui-generation/02-VERIFICATION.md` (APPEND — cross-reference supplement)

**Analog:** Same file's existing `## ` headers. Append a new H2 section below the existing tail.

**Header style of existing sections** (e.g., `02-VERIFICATION.md:19`, `:35`, `:59`):
```markdown
## Goal Achievement
```
```markdown
### Required Artifacts
```

**Existing tail** (`02-VERIFICATION.md:146-156`):
```markdown
## Gaps Summary

No gaps. All 5 phase-level success criteria are verified. [...]

Test state confirmed: 188 passing, 1 skipped (gated live-smoke), 0 failed. `npx tsc --noEmit` exits 0.

---

_Verified: 2026-04-21T10:35:00Z_
_Verifier: Claude (gsd-verifier)_
```
*Append AFTER the trailing `_Verifier:_` line:* a new `## Endpoint Reconciliation (Phase 7, 2026-04-XX)` section following the existing `## ` header convention. Content is one paragraph + a link to `07-VERIFICATION.md`. Suggested skeleton:
```markdown

---

## Endpoint Reconciliation (Phase 7, 2026-04-XX)

The Phase 2 live-smoke gap noted under "Behavioral Spot-Checks > Live-smoke gated" was closed by Phase 7 (Endpoint Reconciliation). The locked `COMFYUI_API_BASE` is `<winner>`, with `<HEALTHCHECK_PATH>` exported from `src/comfyui/client.ts` as the read-only first-submit healthcheck path. See [`07-VERIFICATION.md`](../07-comfyui-endpoint-reconciliation/07-VERIFICATION.md) for the probe matrix, credential layout, rotation procedure, and fallback-if-redirected behaviour.
```
The exact wording is Claude's Discretion per CONTEXT.md — the contract is "one paragraph + link." Use the relative link path (`../07-comfyui-endpoint-reconciliation/07-VERIFICATION.md`) so it resolves from inside the `02-comfyui-generation` directory.

---

### `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/project_comfy_api_endpoint_drift.md` (MODIFY — mark RESOLVED or remove)

**Analog:** Same file (in-place body edit). Existing memory file shape is the convention.

**Memory file frontmatter shape** (`project_comfy_api_endpoint_drift.md:1-6`):
```markdown
---
name: ComfyUI Cloud API endpoint drift
description: The ComfyUI Cloud public API has multiple hosts that don't overlap — `cloud.comfy.org` has `/api/prompt` but rejected our key as 401; `api.comfy.org` accepts our key but returns 404 on `/api/prompt`. Live-smoke tests have been effectively broken since at least 2026-04-22.
type: project
originSessionId: 93103d4e-7653-4b8a-9557-824c18157184
---
```
*Mirror for resolution:* per D-EP-15 there are two valid actions. Pick **(b) remove entirely** if live-smoke is green for the second consecutive run (the bar set by D-EP-15); otherwise (a) modify in-place by:
1. Updating the `description:` line to start with `RESOLVED 2026-04-XX → see .planning/phases/07-comfyui-endpoint-reconciliation/07-VERIFICATION.md.` followed by a brief past-tense recap.
2. Inserting a new line at the top of the body: `**RESOLVED 2026-04-XX** — see [`07-VERIFICATION.md`](../../../comfyui-vfx-mcp/.planning/phases/07-comfyui-endpoint-reconciliation/07-VERIFICATION.md).`
3. Leaving the rest of the body intact for historical context.

The frontmatter `originSessionId` field MUST be preserved if the file is modified (not removed) — it is the unique identifier for the original observation.

---

### `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/reference_env_comfyui_key.md` (MODIFY — body update)

**Analog:** Same file (in-place body edit).

**Current body** (`reference_env_comfyui_key.md:7-13`):
```markdown
The ComfyUI Cloud API credentials live in `.env` at the project root:
- `COMFYUI_API_KEY` — official api.comfy.org key
- `COMFYUI_API_BASE=https://api.comfy.org`

`.env` is gitignored (`.gitignore:1`) and chmod 600. Never commit it, never echo the key in responses, never write it into any file that gets committed (including CLAUDE.md, .planning/, or code comments).

Phase 2 (`comfyui-generation`) is the first phase that will read these — expect `dotenv` or similar to load `.env` when the server boots in generation mode.
```
*Mirror for update:* swap the two lines describing the key's host + the base URL to reflect the locked Phase 7 base. Add a sentence at the end: `Locked as of Phase 7 (2026-04-XX) — see .planning/phases/07-comfyui-endpoint-reconciliation/07-VERIFICATION.md §1.` The frontmatter (`name`, `description`, `type`, `originSessionId`) stays intact except the `description:` field, which should be updated to reflect the locked base ONLY if it currently asserts a base URL (it does not, per the file body — it just says "where the key + base are stored," which is still accurate).

---

### `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/MEMORY.md` (MODIFY — index entries)

**Analog:** Same file. Three lines, one-line-per-entry format.

**Current contents** (full file, 3 lines):
```markdown
- [Don't punt on tests](feedback_dont_punt_on_tests.md) — If a "human UAT" item is wire-level (tool calls, JSON-RPC, HTTP), drive it with MCP SDK client or curl before escalating
- [ComfyUI API key location](reference_env_comfyui_key.md) — COMFYUI_API_KEY + COMFYUI_API_BASE live in .env at repo root; gitignored, chmod 600, never echo
- [ComfyUI API endpoint drift](project_comfy_api_endpoint_drift.md) — `cloud.comfy.org` vs `api.comfy.org` diverged; live-smoke fails on both as of 2026-04-22; needs key/base reconciliation
```
*Mirror for update:*
1. **Line 2** (`reference_env_comfyui_key.md`): rewrite the right-hand summary to reflect the locked base (e.g., `… COMFYUI_API_BASE=<winner> locked Phase 7 …`).
2. **Line 3** (`project_comfy_api_endpoint_drift.md`):
   - If the source memory was REMOVED, delete this line entirely.
   - If the source memory was MARKED RESOLVED, replace the right-hand summary with: `RESOLVED Phase 7 2026-04-XX → see .planning/phases/07/07-VERIFICATION.md`.

The format is unambiguous: `- [Title](filename.md) — one-line summary`. Match it byte-for-byte (single dash, single space, square brackets, `—` em-dash separator). The first line (`feedback_dont_punt_on_tests.md`) stays unchanged.

---

## Shared Patterns

### Authentication (X-API-Key on every ComfyUI HTTP call)
**Source:** `src/comfyui/client.ts:198-200`, `:261`, `:340`
**Apply to:** Healthcheck call in `ensureEndpointHealthy()`; probe script's per-combo fetch; sentinel test's single fetch
```typescript
headers: { 'X-API-Key': this.apiKey },  // ComfyUIClient methods
```
```typescript
headers: { 'X-API-Key': process.env.COMFYUI_API_KEY! },  // Probe script + sentinel test
```
The header name is **exactly** `X-API-Key` (capital X, capital A, capital K, capital K — not `x-api-key`, not `Authorization: Bearer …`, not `apikey`). All four code sites share this constant string. Per D-GEN-21 + D-EP-04.

### Redirect policy (manual, never follow — X-API-Key leakage prevention)
**Source:** `src/comfyui/client.ts:202-205` (verbatim comment), `:264`, `:341`
**Apply to:** Healthcheck call AND probe script per-combo fetch AND sentinel test
```typescript
// Do NOT follow redirects automatically. Node's fetch preserves
// custom headers (including X-API-Key) across cross-origin redirects.
// A single 302 from a compromised base URL would exfiltrate the key.
redirect: 'manual',
```
The probe / sentinel can choose `redirect: 'follow'` ONLY if the operator has explicitly confirmed the target host is fully owned by ComfyUI (currently true for `cloud.comfy.org` per RESEARCH External State, but the safer default is `'manual'` — matches the rest of the codebase). RESEARCH §Healthcheck Sketch recommends `'manual'` for the healthcheck.

### Error throw style (TypedError with SCREAMING_SNAKE_CASE code + actionable hint)
**Source:** `src/comfyui/client.ts:208-211`, `:222-224`, `:240-245`
**Apply to:** `ensureEndpointHealthy()` failure paths
```typescript
throw new TypedError(
  'COMFYUI_RATE_LIMITED',
  `ComfyUI returned 429 (concurrency limit reached)`,
  'ComfyUI concurrency limit reached (Free: 1, Creator: 3, Pro: 5 concurrent jobs). Wait for an in-flight generation to complete and retry.',
);
```
Three-arg form is preferred for codes that have an actionable operator action (`COMFYUI_ENDPOINT_DRIFT` qualifies — the operator action is "run the probe + edit `.env`"). Two-arg form (no hint) is used for codes that are pure-information (e.g., bare network errors). Per CLAUDE.md "Error responses must be human-readable with actionable guidance."

### Test gate (double opt-in: env var present + explicit flag)
**Source:** `src/comfyui/__tests__/live-smoke.test.ts:53-56`
**Apply to:** `endpoint-probe.test.ts` (with `RUN_PROBE` substituted for `RUN_LIVE_SMOKE`)
```typescript
// IT-19: double-opt-in. Credit-burning tests require BOTH a real API key AND
// an explicit RUN_LIVE_SMOKE=1 flag so a routine `npx vitest run` with a
// loaded .env never hits the Cloud by accident.
const SKIP = !process.env.COMFYUI_API_KEY || process.env.RUN_LIVE_SMOKE !== '1';
```
The skipped-test count goes from 2 → 3 after Phase 7 per RESEARCH §Test-Count Invariants.

### Stderr-only logging (no stdout outside of MCP envelope)
**Source:** `src/comfyui/__tests__/live-smoke.test.ts:170-178` (the defensive probe `console.error` calls)
**Apply to:** Probe script (every output goes to stdout — it's an operator one-shot, not an MCP server, so console.log is fine for the MATRIX TABLE; but warnings + key-identity-banner go to stderr to keep the table parseable). Healthcheck failure logs (if any) go through `console.error` per CLAUDE.md "stdio transport hygiene."
```typescript
console.error(
  '[live-smoke] first-poll entity snapshot:',
  JSON.stringify({ status: ..., job_id: ..., version_number: ... }),
);
```
The probe script is OUTSIDE the MCP server transport boundary, so `console.log` for its matrix table is acceptable (and necessary — operators read the table). The "no stdout" rule applies to processes serving MCP via stdio, not to operator tools.

### Test-isolation (always use `fetchImpl` injection in unit tests; never mock global `fetch`)
**Source:** `src/comfyui/client.ts:101-106` (option), `:186` (default-then-inject), test usage at `client.test.ts:25-29`
**Apply to:** New `ensureEndpointHealthy` unit tests
```typescript
export interface ComfyUIClientOptions {
  /** Additional hosts allowed as 302 redirect targets beyond the built-in defaults. */
  additionalAllowedHosts?: string[];
  /**
   * Test seam — override `fetch` for deterministic unit tests. Production leaves
   * undefined (uses global fetch).
   */
  fetchImpl?: typeof fetch;
}
```
The new tests use `new ComfyUIClient(KEY, BASE, { fetchImpl: mockFetch(...) })` — never `vi.spyOn(global, 'fetch')` (would interfere with parallel test isolation).

---

## No Analog Found

**File:** `.env` (locked base value swap).
**Reason:** Permission-denied for read by this pattern-mapper agent (gitignored / sensitive). The file's shape mirrors `.env.example` (planner / executor must `Read` the file directly to confirm the existing line format and any inline comments). This is not a missing-pattern problem — `.env.example` is the canonical analog for shape — but the actual write is blind to this agent.

**File:** Probe script's "all-bases-401" exit-code semantics (RESEARCH §Landmine 3).
**Reason:** No existing operator script in this repo has multi-tier exit codes. `inspector-smoke.mjs` uses 0/1/2 for pass/fail/fatal (lines 261, 275, ~). The 0/1/2/3/4 exit-code matrix specified in RESEARCH §Landmine 3 is a Phase 7 invention; the planner should reference RESEARCH §Landmine 3 verbatim rather than expecting a pre-existing pattern in the repo.

**File:** Healthcheck Promise-based memoization for race-safety (RESEARCH §Healthcheck Sketch).
**Reason:** No existing class in `src/comfyui/` or `src/engine/` uses Promise-as-cache memoization for an instance-level lazy initializer. The closest pattern is the `start()` / `stop()` AbortController wiring in `src/engine/generation.ts` (referenced in `02-VERIFICATION.md:65-66`), but that solves a different problem (cancellation, not memoization). The planner should reference RESEARCH §Healthcheck Sketch lines 167-235 verbatim — that code sketch IS the canonical pattern for this phase.

---

## Metadata

**Analog search scope:**
- `/Users/macapple/comfyui-vfx-mcp/scripts/` (1 file: `inspector-smoke.mjs`)
- `/Users/macapple/comfyui-vfx-mcp/src/comfyui/` (full directory: `client.ts`, `format.ts`, `png-metadata.ts`, `types.ts`)
- `/Users/macapple/comfyui-vfx-mcp/src/comfyui/__tests__/` (4 files: `client.test.ts`, `live-smoke.test.ts`, `format.test.ts`, `png-metadata.test.ts`)
- `/Users/macapple/comfyui-vfx-mcp/src/engine/errors.ts`
- `/Users/macapple/comfyui-vfx-mcp/.planning/phases/02-comfyui-generation/02-VERIFICATION.md`
- `/Users/macapple/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/` (4 files: `feedback_dont_punt_on_tests.md`, `MEMORY.md`, `project_comfy_api_endpoint_drift.md`, `reference_env_comfyui_key.md`)

**Files scanned:** 12
**Files read in full:** 7 (`inspector-smoke.mjs`, `client.ts`, `errors.ts`, `live-smoke.test.ts`, `project_comfy_api_endpoint_drift.md`, `reference_env_comfyui_key.md`, `MEMORY.md`)
**Files read partially (targeted ranges):** 3 (`client.test.ts` lines 1-220, `02-VERIFICATION.md` lines 1-220, `feedback_dont_punt_on_tests.md` full)
**Files unreadable due to permissions:** 1 (`.env.example` — sandbox restriction on dot-prefixed files; `.env.example` is committed, planner can read directly)
**Pattern extraction date:** 2026-04-24
