---
phase: 07-comfyui-endpoint-reconciliation
researched: 2026-04-24
domain: Infrastructure / live-runtime gap closure (ComfyUI Cloud HTTP endpoint drift)
confidence: HIGH
status: ready-for-planning
---

# Phase 7: ComfyUI Endpoint Reconciliation - Research

**Researched:** 2026-04-24
**Domain:** Infrastructure / live-runtime gap closure (ComfyUI Cloud HTTP endpoint drift)
**Confidence:** HIGH (all claims verified against live docs + repo state + working test baseline)

## Summary

Phase 7 is a thin, well-scoped gap-closure phase. All locked decisions come from `07-CONTEXT.md`, and 14 of 15 are prescriptive enough to translate directly into tasks. This research adds five things the planner needs that CONTEXT did not pre-resolve: (1) the **current public state** of `docs.comfy.org` (confirmed `cloud.comfy.org` is the canonical base, unchanged since Phase 2 design-time research); (2) a concrete **healthcheck code sketch** grounded in the actual `ComfyUIClient` fetch pattern; (3) probe-script **landmines** (dotenv cwd dependence, tsx+mts compatibility, exit-code semantics, docs-fetch graceful degradation); (4) test-count invariants verified by running the suite (**735 passed, 2 skipped baseline**); (5) a **wave-aware build order** mapping CONTEXT's 10-step list into parallelizable work units.

**Primary recommendation:** Run the probe script FIRST to resolve the key-vs-base question (the drift memory describes a 401 on `cloud.comfy.org` — if the current key now authenticates there, the fix is likely a single `.env` base-URL flip + optional default-constant confirmation; if 401 persists, the resolution path is a key rotation, which the rotation procedure section of `07-VERIFICATION.md` must document). All subsequent code work (healthcheck, sentinel test, .env updates, docs) is mechanical once the probe winner is known.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Endpoint probe matrix execution | Operator tooling (scripts/) | — | One-shot diagnostic; not part of server runtime. Lives outside `src/` so `architecture-purity.test.ts` doesn't apply. |
| First-submit healthcheck | HTTP client (`src/comfyui/client.ts`) | — | Keeps zero DB / zero MCP coupling per `CLAUDE.md` architecture rule. ComfyUIClient already owns all HTTP-to-ComfyUI traffic. |
| Typed error emission (`COMFYUI_ENDPOINT_DRIFT`) | HTTP client | Engine errors taxonomy (`src/engine/errors.ts`) | TypedError literal type lives in errors.ts; the throw site lives in client.ts alongside the other D-GEN-40 family codes. |
| Sentinel test (drift detection) | Test layer (`src/comfyui/__tests__/`) | — | Vitest skipIf pattern mirrors `live-smoke.test.ts` IT-19 double-opt-in gate. |
| Resolution documentation | Planning docs (`.planning/phases/07/`) | Cross-reference supplement in `.planning/phases/02/` | Canonical note lives with the phase that resolved it; Phase 2 gets a 1-paragraph forward-pointer for future readers. |
| Post-resolution memory hygiene | User memory (`~/.claude/projects/.../memory/`) | — | Project memory mirrors the state of the repo; stale "drift exists" memory must be resolved or removed once live-smoke passes. |

## User Constraints (from CONTEXT.md)

### Locked Decisions

Copied verbatim from `07-CONTEXT.md <decisions>`:

**Endpoint Discovery (probe script)**
- **D-EP-01:** Discovery is **probe-first**. Write `scripts/probe-comfy-endpoint.mts` that loads `COMFYUI_API_KEY` from `.env` (via existing `dotenv` flow) and walks a base × path matrix with `X-API-Key` header, reporting status code + first 200 bytes of response body for each combo. No docs read in this phase beyond the dynamic fetch of `docs.comfy.org` in D-EP-04.
- **D-EP-02:** Probe is **read-only**. GET endpoints only — `/api/queue`, `/api/system_stats`, `/api/history`, `/` (root). Whichever returns 200 with X-API-Key is the known-good base. Zero generations queued, zero credits burned.
- **D-EP-03:** Probe lives at `scripts/probe-comfy-endpoint.mts`. Manual one-shot. Not automated in CI.
- **D-EP-04:** Probe matrix bases: `https://cloud.comfy.org`, `https://api.comfy.org`, `https://www.comfy.org/api`, plus whatever URL `docs.comfy.org/development/cloud/overview` currently advertises. Paths: `/api/queue`, `/api/system_stats`, `/api/history`, `/`.
- **D-EP-05:** Probe output format is a human-readable matrix table (Markdown to stdout is the default; structured JSON is Claude's Discretion).

**Endpoint Resilience**
- **D-EP-06:** Lock ONE base + first-submit healthcheck. Probe winner becomes the locked default in three places: `DEFAULT_COMFYUI_API_BASE` in `src/comfyui/client.ts:34`, `.env`, `.env.example`.
- **D-EP-07:** First-submit healthcheck runs once per process before `client.submit()` is invoked the first time. Cheap GET against the same known-200 endpoint the probe identified. Cached for process lifetime. Implementation in `src/comfyui/client.ts` (private `ensureEndpointHealthy()` called from `submit()`).
- **D-EP-08:** Healthcheck failure throws new typed error `COMFYUI_ENDPOINT_DRIFT`. Joins the D-GEN-40 family. Hint: `"COMFYUI_API_BASE may have drifted (got HTTP <status> on healthcheck against <base><path>). Run \`npx tsx scripts/probe-comfy-endpoint.mts\` to find the current working base, then update .env COMFYUI_API_BASE."` Surfaces via the standard D-GEN-41 envelope.
- **D-EP-09:** Drift philosophy: treat endpoint drift as an ops event, not a code-design problem. Multi-base routing is v2 ROUTE-01..03.
- **D-EP-10:** Healthcheck cache key is the (base, key-last-4) tuple held in the ComfyUIClient instance. No global static cache.

**Resolution Documentation**
- **D-EP-11:** `07-VERIFICATION.md` is canonical + 1-paragraph cross-reference supplement in `02-VERIFICATION.md`.
- **D-EP-12:** Required sections in `07-VERIFICATION.md`: (1) probe matrix + chosen base; (2) credential layout / source-of-truth; (3) rotation procedure; (4) fallback-if-redirected + memory hygiene.

**Drift Sentinel**
- **D-EP-13:** Add `src/comfyui/__tests__/endpoint-probe.test.ts` gated on `RUN_PROBE=1` + `COMFYUI_API_KEY`.
- **D-EP-14:** Sentinel asserts healthcheck endpoint returns 200. Shared `HEALTHCHECK_PATH` constant exported from `client.ts`.

**Memory Hygiene**
- **D-EP-15:** Update `project_comfy_api_endpoint_drift.md` (resolved or removed) + `reference_env_comfyui_key.md` (new locked base) + `MEMORY.md` index.

### Claude's Discretion

Copied verbatim from `07-CONTEXT.md <decisions> Claude's Discretion`:

- Probe output format detail — Markdown table default; `--json` flag if useful for sentinel test re-use. Executor's call.
- Healthcheck path constant naming — `HEALTHCHECK_PATH` vs `ENDPOINT_PROBE_PATH` vs `KNOWN_GOOD_GET_PATH`. Pick one, use consistently. **This research recommends `HEALTHCHECK_PATH`** because it matches the verb most commonly used elsewhere in the codebase (healthcheck, not probe).
- Probe script docstring style — match `scripts/inspector-smoke.mjs` shape (top-of-file JSDoc with run instructions and exit-code semantics).
- Whether to also probe POST `/api/prompt` with `{}` body — Claude's Discretion add-on. Useful for evidence, not required.
- Exact 02-VERIFICATION.md supplement wording — one paragraph + link is the contract.
- Whether to add `COMFYUI_ENDPOINT_DRIFT` to `stdio-hygiene.test.ts` — probably yes. **See §stdio-hygiene extension below — verified it's NOT in an enumerated-literal list today.**
- Whether probe tries `/api/v1/prompt` / `/v1/prompt` variants — useful diagnostic if read paths all 404, not strictly required.

### Deferred Ideas (OUT OF SCOPE)

Copied verbatim from `07-CONTEXT.md <deferred>`:

- Multi-base routing / `COMFYUI_API_BASES=primary,secondary` fallback list (v2 ROUTE-01..03).
- Nightly GitHub Action that runs the probe with key as a secret.
- Credential vault / auto-rotation tooling.
- ADR practice (`.planning/decisions/` directory) — rejected; no ADR practice exists today.
- Standalone `.planning/runbooks/` directory — rejected; resolution lives inline in `07-VERIFICATION.md`.
- Healthcheck for `status` and `download` paths (D-EP-07 only checks the read path on first `submit()`).
- POST `/api/prompt` `{}`-body dry-run as a required probe assertion.
- Re-issuing the API key as part of Phase 7 — out of scope; if the probe needs a rotation, that's a manual user action documented in the rotation procedure section.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| *(none — gap-closure phase)* | GEN-01..07 remain satisfied by FakeEngine unit tests in Phase 2. This phase closes live-runtime infrastructure only. | The 3 Success Criteria in ROADMAP.md §Phase 7 are the contract. Plans MUST have `requirements: []` frontmatter. |

**Success Criteria traceability:**

| SC# | Criterion | Research Coverage |
|-----|-----------|-------------------|
| SC-1 | `.env COMFYUI_API_BASE` points at a single endpoint returning 200 for authenticated requests, with documented rationale + credential source-of-truth | §External State + §Healthcheck Sketch + §Probe Script Landmines |
| SC-2 | Live-smoke exercises `generation.submit` + `generation.status` round-trip and returns a completed job | §Validation Architecture + §Build-Order |
| SC-3 | Endpoint decision, credential layout, and fallback-if-redirected documented in `02-VERIFICATION.md` or successor note | §Validation Architecture (documentation validation row) + D-EP-11/12 sections |

## Project Constraints (from CLAUDE.md)

Phase 7 must respect these directives:

- **Tool-engine separation:** Phase 7 touches `src/comfyui/client.ts` (engine-side HTTP layer, already zero-MCP) and creates the sentinel test. No MCP tool surface change. No new tool. Tool count stays at **7**.
- **Error responses must be human-readable with actionable guidance:** The `COMFYUI_ENDPOINT_DRIFT` hint (D-EP-08) is pre-specified and compliant.
- **Never log raw secrets:** The probe script prints status codes + first 200 bytes of body only. Must NOT echo the `COMFYUI_API_KEY` value. The existing `scrubAndTruncate()` in `client.ts:153` is not reused in the probe script (probe is outside the client), so the script must independently avoid logging `process.env.COMFYUI_API_KEY` — only use `****<last4>` if logging key identity at all. Verify the `stdio-hygiene.test.ts` assertions (no `COMFYUI_API_KEY=` in stderr, no key prefix leak) still pass after the typed-error addition.
- **nanoid for IDs:** Not applicable — no new entity IDs in this phase.
- **TypeScript ESM:** Probe script is `.mts` (verified tsx 4.21.0 runs `.mts` — see §Probe Script Landmines).

## External State (docs.comfy.org verification, 2026-04-24)

**Why this matters:** CONTEXT.md D-EP-04 says the probe matrix includes "whatever URL `docs.comfy.org/development/cloud/overview` currently advertises." Research confirms what that URL says today so the planner and executor know what the dynamic-fetch step will land on.

**Verified via WebFetch 2026-04-24:**

1. **`https://docs.comfy.org/development/cloud/overview`** — explicitly states the canonical base URL is **`https://cloud.comfy.org`**. Verbatim: *"The Comfy Cloud API provides programmatic access to run workflows on Comfy Cloud infrastructure"* with `https://cloud.comfy.org` as the documented base. No mention of `api.comfy.org`, `platform.comfy.org` as API targets, or versioned prefixes.
2. **`https://docs.comfy.org/development/cloud/api-reference`** — confirms endpoints under `/api/` (no `/v1/` prefix):
   - `POST /api/prompt` — submit workflows
   - `GET /api/queue` — retrieve queue status
   - `POST /api/queue` — manage queue (delete/cancel)
   - `GET /api/job/{prompt_id}/status` — individual job status
   - `GET /api/object_info` — node definitions
   - `POST /api/upload/image` — upload input images
   - `POST /api/upload/mask` — upload masks
   - `GET /api/view` — download output files
   - `POST /api/interrupt` — interrupt execution
3. **`/api/history_v2/{prompt_id}`** is advertised in the overview as the output-retrieval endpoint. **The older `/api/history` path referenced in D-EP-02 is NOT on the current docs page.** The probe matrix path `/api/history` may well 404 against the live base — which is *fine diagnostic information* but means the sentinel test should NOT pick `/api/history` as the locked `HEALTHCHECK_PATH`.
4. **`/api/system_stats`** is also NOT listed in the current docs. Likely a classical ComfyUI (local) endpoint that was never exposed on Cloud. Another diagnostic-only probe target.
5. **Platform URL for API key issuance:** `https://platform.comfy.org/login` → API Keys section → "+ New" → key shown ONCE on creation.
6. **Auth failure semantics:** Docs explicitly describe keeping keys secure but do NOT document 401/403/404 status-code semantics. Phase 7 must empirically verify via probe.

**Implication for the probe matrix:**

| Matrix path | Expected against `cloud.comfy.org` per current docs | Probe purpose |
|-------------|------------------------------------------------------|---------------|
| `/api/queue` | 200 (documented, read-only) | **Most likely `HEALTHCHECK_PATH` winner** |
| `/api/system_stats` | 404 (not documented on Cloud) | Diagnostic — confirms this legacy path is absent |
| `/api/history` | 404 (docs show `/api/history_v2/{id}`) | Diagnostic — confirms path deprecation |
| `/` (root) | Unknown — could be 200/301/404 | Diagnostic baseline |

**Recommended locked `HEALTHCHECK_PATH`:** `/api/queue`. It is the only path in the D-EP-02 set that is verified-present in the current Cloud docs AND is trivially cheap (GET, returns JSON queue state, no credit burn, no mutation). `/api/object_info` is an alternative if `/api/queue` turns out to require elevated scopes, but `/api/queue` is the prescribed safer default.

**Dynamic base from docs:** The dynamic fetch in D-EP-04 will almost certainly return `https://cloud.comfy.org` — the docs haven't changed the canonical base. But the probe script MUST still do the fetch (graceful degradation if docs 5xx — see §Probe Script Landmines) so future drift to a brand-new base is caught without code changes.

`[CITED: docs.comfy.org/development/cloud/overview (fetched 2026-04-24)]`
`[CITED: docs.comfy.org/development/cloud/api-reference (fetched 2026-04-24)]`

### State-of-the-Art vs. Phase 2 Design-Time Research

| Assertion | Phase 2 (2026-04-20) | Current (2026-04-24) | Change? |
|-----------|---------------------|----------------------|---------|
| Canonical base | `https://cloud.comfy.org` | `https://cloud.comfy.org` | **No change** |
| `/api/prompt` as submit endpoint | Documented | Documented | **No change** |
| `/api/job/{id}/status` as status | Documented | Documented | **No change** |
| `/api/view` for download | Documented | Documented | **No change** |
| History endpoint | `/api/history` (Phase 2 RESEARCH.md §A3 D-PROV-05 noted uncertainty) | **`/api/history_v2/{prompt_id}`** | **Renamed** (not relevant to Phase 7 probe picks — healthcheck doesn't use it — but noteworthy for Phase 3+ future work) |
| 401 on `cloud.comfy.org` with our key | Observed 2026-04-22 per `project_comfy_api_endpoint_drift.md` | Unknown; probe will resolve | Drift memory age is 2 days — needs empirical re-verification |

**Conclusion:** The Phase 2 design-time anchors are unchanged in public docs. The drift is purely about key-vs-base reconciliation at the tenant level, not a public endpoint change. This is strong evidence the fix will be mechanical (update `.env` base, possibly rotate key, lock default) once the probe runs.

## Healthcheck Implementation Sketch

> Concrete code pattern the planner can translate to a task. Grounded in the actual `ComfyUIClient` shape at `src/comfyui/client.ts` read 2026-04-24.

### Where the cache lives

Add two private instance fields to `ComfyUIClient` alongside the existing `allowed`, `allowedLiteralHosts`, `fetchImpl` fields (lines 128-140):

```typescript
// Cache flag: null = never checked; Promise = in-flight; true = confirmed 200.
// Race-safe: concurrent first-submit callers await the same Promise.
private healthCheckResult: Promise<void> | null = null;
```

**Why a Promise (not a boolean):** If two callers invoke `submit()` simultaneously on a fresh `ComfyUIClient`, a naive boolean flag would let the second one skip the check before the first one set the flag. Caching the **Promise** and awaiting it resolves the race: the first caller kicks the fetch and everyone else awaits the same result. On failure the Promise rejects and `healthCheckResult` stays null (so a retry can fire another check) — standard promise-memoization pattern.

### The healthcheck method itself

Place directly under the constructor (before `submit()`, line 189):

```typescript
/**
 * Phase 7 D-EP-07: first-submit healthcheck.
 *
 * Cheap GET against HEALTHCHECK_PATH to confirm the configured base + key
 * combo is still live. Called lazily from submit() — result cached on the
 * instance for the lifetime of the process. Never re-runs (no per-submit
 * overhead). On failure throws COMFYUI_ENDPOINT_DRIFT with an actionable
 * hint pointing at the probe script.
 *
 * Race-safe: the memoized Promise ensures concurrent submits share one
 * in-flight check. Failure leaves healthCheckResult=null so a later submit
 * can retry (drift may resolve via operator .env edit without restart).
 */
private async ensureEndpointHealthy(): Promise<void> {
  if (this.healthCheckResult) return this.healthCheckResult;
  this.healthCheckResult = (async () => {
    const url = new URL(HEALTHCHECK_PATH, this.base);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { 'X-API-Key': this.apiKey },
        // Match submit/status redirect policy — never follow across origin,
        // API key leaks otherwise (see submit() comment lines 202-205).
        redirect: 'manual',
        // Short timeout: a healthcheck should be near-instant. Use
        // AbortController rather than the nonstandard `timeout` option.
      });
    } catch (err) {
      // Failure MUST NOT set the cache — let a later submit retry.
      this.healthCheckResult = null;
      throw new TypedError(
        'COMFYUI_ENDPOINT_DRIFT',
        `ComfyUI healthcheck network error against ${this.base}${HEALTHCHECK_PATH}: ${(err as Error).message}`,
        `COMFYUI_API_BASE may have drifted. Run \`npx tsx scripts/probe-comfy-endpoint.mts\` to find the current working base, then update .env COMFYUI_API_BASE.`,
      );
    }
    if (res.status !== 200) {
      this.healthCheckResult = null;
      throw new TypedError(
        'COMFYUI_ENDPOINT_DRIFT',
        `ComfyUI healthcheck returned HTTP ${res.status} against ${this.base}${HEALTHCHECK_PATH}`,
        `COMFYUI_API_BASE may have drifted. Run \`npx tsx scripts/probe-comfy-endpoint.mts\` to find the current working base, then update .env COMFYUI_API_BASE.`,
      );
    }
    // 200 path — discard body (we only care about the status). Drain so
    // the connection can be reused by the next fetch.
    try { await res.arrayBuffer(); } catch { /* ignore */ }
  })();
  return this.healthCheckResult;
}
```

### Wiring into `submit()`

Modify `submit()` (line 190) to await the healthcheck as the first statement. Note: it is NOT called from `status()` or `download()` per D-EP-07 — the drift catch is on the first generation attempt per process.

```typescript
async submit(workflowJson: Record<string, unknown>): Promise<SubmitResponse> {
  // D-EP-07: first-submit healthcheck. Cached for process lifetime.
  // On drift, throws COMFYUI_ENDPOINT_DRIFT (caught by tool envelope in
  // generation-tool.ts → surfaces as structuredContent.code per D-GEN-41).
  await this.ensureEndpointHealthy();
  const body: SubmitRequest = { prompt: workflowJson };
  // ... existing submit() body unchanged below this line
}
```

### Exporting `HEALTHCHECK_PATH`

Per D-EP-14 the sentinel test imports the same constant. Place it at module scope alongside `DEFAULT_COMFYUI_API_BASE` (line 34) so the one-source-of-truth rule holds:

```typescript
/**
 * Phase 7 D-EP-14: path used by both the first-submit healthcheck
 * (ensureEndpointHealthy) and the sentinel test (endpoint-probe.test.ts).
 * Set by probe winner. `/api/queue` is the recommended lock because it's
 * documented, read-only, cheap, and returns JSON.
 */
export const HEALTHCHECK_PATH = '/api/queue'; // TODO: confirmed by probe run
```

### Adding `COMFYUI_ENDPOINT_DRIFT` to the error taxonomy

Single-line change in `src/engine/errors.ts` (read 2026-04-24, currently ends with `OUTPUT_UNAVAILABLE` at line 35). Append one literal to the `ErrorCode` union:

```typescript
  // Phase 7 — endpoint reconciliation (D-EP-08)
  | 'COMFYUI_ENDPOINT_DRIFT'
```

Per CONTEXT.md D-EP-08 this code joins the D-GEN-40 family semantically but is declared as a single literal. No `TypedError` class changes required — the new literal flows through the existing tool envelope path unchanged.

### Test-level concerns

- The existing `client.test.ts` (38629 bytes, 400+ tests at file size estimate) uses `fetchImpl` injection for unit tests. **New tests for `ensureEndpointHealthy()`** should use the same seam:
  1. First-submit failure path: fetchImpl returns 401 → submit throws `COMFYUI_ENDPOINT_DRIFT` (not `COMFYUI_API_ERROR`).
  2. First-submit success path: fetchImpl returns 200 → submit proceeds, subsequent submits skip the check (second fetchImpl call is the POST /api/prompt, not another GET /api/queue).
  3. Race path: two concurrent `submit()` calls trigger ONE fetchImpl GET to HEALTHCHECK_PATH — the memoization works.
  4. Failure-retry path: first check throws, cache not set, next submit triggers a fresh fetchImpl call.
- **Live-smoke impact:** Zero new assertions needed. Once the base is locked and returns 200, the existing `describe.skipIf(SKIP)` block passes the healthcheck on its first submit and continues unchanged.

## Probe Script Landmines

> These are non-obvious failure modes that CONTEXT.md did not pre-resolve.

### Landmine 1: dotenv cwd dependence

`import 'dotenv/config'` loads `.env` **from process.cwd()**, not from the script's `__dirname`. If a user runs:

```bash
cd scripts/
npx tsx probe-comfy-endpoint.mts
```

...from inside `scripts/`, the probe will look for `./env` in `scripts/`, find nothing, and report `COMFYUI_API_KEY` as missing. **Mitigation:** Document the correct invocation verbatim (`npx tsx scripts/probe-comfy-endpoint.mts` run from the REPO ROOT) in the top-of-file JSDoc. Additionally, the probe script should print `cwd: ${process.cwd()}` in its header output so a mis-invocation is instantly diagnosable from the matrix-report output.

**Alternative hardening (Claude's Discretion):** resolve `.env` relative to the script via `dotenv.config({ path: new URL('../.env', import.meta.url).pathname })` instead of the side-effect import. More resilient, but adds code complexity. Recommend keeping the simple `import 'dotenv/config'` and trusting the documented invocation pattern — this is a one-shot operator script, not a library.

### Landmine 2: tsx + .mts compatibility

**Verified 2026-04-24:** `tsx v4.21.0` + Node v25.6.1 runs `.mts` files cleanly via `npx tsx /tmp/test.mts` — no tsconfig include required. The repo's `tsconfig.json` `include` is `["src/**/*.ts"]` which does NOT include `.mts` files under `scripts/`, but tsx doesn't require the file to be in the tsconfig include path to execute it. Type-checking via `npx tsc --noEmit` will NOT pick up the probe script (that's fine — it's an operator tool, not a library).

**Caveat:** The repo's other `.mts` file (`verify-phase3-uat.mts`, `verify-phase4-tool-surface.mts`, `verify-phase5-dashboard.mts`) are at repo root. Placing the probe at `scripts/probe-comfy-endpoint.mts` is a minor deviation — `scripts/` currently holds `inspector-smoke.mjs` (a `.mjs` file). Either location works; CONTEXT.md D-EP-03 locks `scripts/probe-comfy-endpoint.mts`, so go with that.

### Landmine 3: All-bases-401 exit semantics

Per CONTEXT.md the probe is read-only and should never silently claim success when nothing works. Define exit codes in the top-of-file docstring and enforce:

```
Exit codes:
  0 — At least one base × path combo returned 200 (probe winner identified)
  1 — All combos returned 401 (likely bad/expired key — rotation needed)
  2 — All combos returned non-401 non-200 (likely endpoint drift beyond our matrix)
  3 — Script failed to load COMFYUI_API_KEY (missing .env or missing key line)
  4 — Docs fetch failed AND all hardcoded bases failed (unusual — network issue)
```

The probe script's final block must compute the summary BEFORE exiting. If no 200 anywhere, print a big banner: *"NO WORKING BASE × PATH COMBO FOUND. Most likely cause: the API key needs to be rotated at https://platform.comfy.org. See `07-VERIFICATION.md` §Rotation Procedure."* This is what the drift memory was complaining about two days ago — the rotation path must be discoverable from the probe output.

### Landmine 4: Probe request timeout

The probe walks 4 bases × 4 paths = 16 combos. At worst-case network latency (DNS failure, TCP timeout) each could hang for ~30s by default on Node 25. That's an 8-minute probe. **Mitigation:** wrap each fetch in an `AbortController` with a `5000ms` timeout. Document in the top-of-file docstring: *"Each probe combo has a 5s timeout. Full matrix completes in ≤80s worst case."* Serial vs parallel is Claude's Discretion — serial is easier to read in the output table and avoids thundering-herd patterns against a single host; parallel finishes in ~5s if all bases resolve. Recommend **serial by default** for deterministic reading; add `--parallel` flag only if operator speed matters.

### Landmine 5: Dynamic docs fetch graceful degradation

D-EP-04 says the probe fetches `docs.comfy.org/development/cloud/overview` dynamically to pick up drift-to-brand-new-base cases. If that fetch fails (404, 5xx, DNS issue, timeout), the probe MUST NOT abort — it should log the failure to stderr and proceed with the three hardcoded bases. Skeleton:

```typescript
async function discoverDocsBase(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://docs.comfy.org/development/cloud/overview', {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    // Simple regex — look for the first https://[something].comfy.org
    // that is NOT docs.comfy.org. Per 2026-04-24 docs, this will find
    // https://cloud.comfy.org.
    const m = html.match(/https:\/\/([a-z0-9-]+\.comfy\.org)/i);
    if (!m) return null;
    const host = m[1];
    if (host === 'docs.comfy.org') return null; // self-reference
    return `https://${host}`;
  } catch {
    return null;
  }
}
```

**Parsing tradeoff:** The docs page is HTML-with-MDX. A proper parser is overkill for a one-shot operator script. A simple `match()` regex for `https://*.comfy.org` URLs is sufficient because (a) the docs currently advertise `cloud.comfy.org` by name, (b) if the docs change structure, the probe matrix still includes the three hardcoded bases and the matrix output is still diagnostic.

### Landmine 6: Secret hygiene in probe output

The probe prints status codes + first 200 bytes of response body. If a 4xx response body echoes `X-API-Key: <value>` back in its error text (rare but possible for misconfigured servers), the probe would leak the key to stdout. **Mitigation:** apply a `scrubKey` helper to every body snippet before printing — same idea as `scrubAndTruncate()` in `client.ts:153` but inline (the probe is outside the client). Show `****<last4>` in the header banner instead of the full key. Verify the output never contains the full key by grepping the probe output against the key value in CI/post-run.

### Landmine 7: Repo state assumption — missing `.env`

The drift memory notes `.env` currently has `COMFYUI_API_BASE=https://api.comfy.org`. The probe script MUST tolerate:

- `.env` missing entirely (e.g., fresh clone before operator adds it) → log "no .env found, cannot probe" → exit code 3.
- `.env` present but missing `COMFYUI_API_KEY` → log "COMFYUI_API_KEY not set in .env" → exit code 3.
- `.env` present but `COMFYUI_API_BASE` set to a broken value → ignore it entirely (the probe walks its own base matrix, doesn't use the env base).

## stdio-hygiene Extension (CONTEXT Claude's Discretion)

**Verified 2026-04-24:** `src/__tests__/stdio-hygiene.test.ts` (8 tests, green against current baseline) does NOT enumerate typed-error codes in any assertion. Its checks are about:

1. Zero stdout bytes on boot (line 96)
2. No `COMFYUI_API_KEY=` substring in stderr (line 111)
3. Silent-if-missing-key (line 128)
4. Exact credential-log format with key set (line 143)
5. IS-02 bad-base cleartext (line 158)
6. IS-02 bad-base loopback (line 170)
7. Phase 4 SQL non-leak on boot (line 182)
8. IT-18 SIGTERM graceful shutdown (line 210)

**Conclusion:** `stdio-hygiene.test.ts` does NOT enumerate error codes. Adding `COMFYUI_ENDPOINT_DRIFT` to an enumerated list is a false choice — there IS no such list. The discretion point in CONTEXT.md was worded as if there might be one.

**What to verify instead:** After adding the healthcheck, re-run `stdio-hygiene.test.ts` to ensure all 8 tests still pass. None of them will fail — the healthcheck is engine-side, not boot-path, and doesn't log to stderr at boot. Record this as "no stdio-hygiene extension needed — existing tests cover the surface" in the verification section.

**If the executor wants to be defensive** they could add one NEW stdio-hygiene assertion: *"stderr on boot never contains `COMFYUI_ENDPOINT_DRIFT`"* (proof the error isn't being eagerly thrown at boot). That would be a 3-line addition parallel to the existing `COMFYUI_API_KEY=` check. Recommend skipping — the invariant is obvious and architecture-purity already enforces that `src/comfyui/` never throws during module-load.

## Test-Count Invariants (verified 2026-04-24)

**Current baseline (measured):**

```
Test Files  45 passed | 1 skipped (46)
Tests       735 passed | 2 skipped (737)
```

The 1 skipped test file is `src/comfyui/__tests__/live-smoke.test.ts` containing 2 test cases (both gated on `!process.env.COMFYUI_API_KEY || process.env.RUN_LIVE_SMOKE !== '1'`). Without the double-opt-in, both skip, reported as 2 skipped tests in 1 file.

**Post-Phase-7 projected baseline:**

```
Test Files  46 passed | 1 skipped (47)    # Option A: sentinel gates at describe level
            45 passed | 2 skipped (47)    # Option B: sentinel is a whole new file describe.skipIf
Tests       N passed | 3 skipped (N+3)    # +1 for the new sentinel skipIf assertion
```

**Recommendation:** Option B (new file with `describe.skipIf`) matches live-smoke shape verbatim. Executor adds `src/comfyui/__tests__/endpoint-probe.test.ts` with one `describe.skipIf(SKIP_PROBE)` containing one `test()`. This gives:
- **Test Files: 46 passed | 2 skipped (48)**
- **Tests: 735 passed | 3 skipped (738)**

The planner's verification-step assertion should be: after Phase 7, `vitest run` reports ≥ 735 passed and ≤ 3 skipped (allowing +N new unit tests for the healthcheck, which DO run — see §Healthcheck Sketch test-level concerns). A crisp formulation: **"skipped count goes from 2 to 3; passed count rises by the number of new unit-style healthcheck tests."**

## Build-Order and Wave Recommendations

> This is the planner's raw material. Annotates CONTEXT.md's 10-step list with wave boundaries and parallelization opportunities.

### Dependency graph

```
                 ┌─────────────────────────────────────────┐
                 │ Step 1: probe-comfy-endpoint.mts        │
                 │ (standalone, reads .env via dotenv)     │
                 └────────────────┬────────────────────────┘
                                  │ blocks all downstream
                 ┌────────────────▼────────────────────────┐
                 │ Step 2: Manual probe run                │
                 │ (operator + Claude) — identifies winning│
                 │ base + HEALTHCHECK_PATH                 │
                 └────────────────┬────────────────────────┘
                                  │ identifies the locked base constant
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
┌───────▼────────┐      ┌─────────▼────────┐      ┌────────▼──────────┐
│ Step 3: client │      │ Step 4: .env +   │      │ Step 3-partial:   │
│  .ts healthck+ │      │ .env.example     │      │ errors.ts add     │
│  HEALTHCHECK_  │      │ update           │      │ COMFYUI_ENDPOINT_ │
│  PATH constant │      │                  │      │ DRIFT literal     │
└───────┬────────┘      └──────────────────┘      └────────┬──────────┘
        │                                                   │
        │ both needed before sentinel test                  │
        └───────────────────────┬───────────────────────────┘
                                │
                ┌───────────────▼───────────────────────────┐
                │ Step 5: endpoint-probe.test.ts            │
                │ (imports HEALTHCHECK_PATH from client.ts) │
                └───────────────┬───────────────────────────┘
                                │
                ┌───────────────▼───────────────────────────┐
                │ Step 7: Run live-smoke                    │
                │ RUN_LIVE_SMOKE=1 npx vitest run live-smoke│
                │ MUST return green (SC-2 gate)             │
                └───────────────┬───────────────────────────┘
                                │ only once green
        ┌───────────────────────┼───────────────────────────┐
        │                       │                           │
┌───────▼──────┐     ┌──────────▼────────┐     ┌───────────▼──────────┐
│ Step 8:      │     │ Step 9: 02-VERIFY │     │ Step 10: memory      │
│ 07-VERIFY    │     │ supplement        │     │ updates              │
│ canonical    │     │                   │     │ (drift / ref / index)│
└──────────────┘     └───────────────────┘     └──────────────────────┘
```

### Wave mapping (for gsd-execute-phase parallelism)

| Wave | Steps | Can run in parallel? | Gate before next wave |
|------|-------|----------------------|-----------------------|
| **Wave 0** | Probe script (Step 1) | N/A — single file | Probe script exists + is executable |
| **Wave 1** | Manual probe run (Step 2) | N/A — operator action + Claude observation | Probe winner identified + `HEALTHCHECK_PATH` value decided |
| **Wave 2** | Client.ts healthcheck + HEALTHCHECK_PATH export (Step 3) AND errors.ts ErrorCode addition (partial Step 3) AND .env/.env.example update (Step 4) | **Yes — 3 tasks in parallel.** Only shared dependency is the locked base string (known after Wave 1). `client.ts` references `errors.ts` TypedError but the import already exists — no new cross-file dependency. `.env` and `.env.example` are orthogonal. | `npx tsc --noEmit` green; `npx vitest run` green; client.ts unit tests for healthcheck pass |
| **Wave 3** | endpoint-probe.test.ts (Step 5) AND stdio-hygiene verification pass (Step 6, optional) | **Yes — 2 tasks in parallel.** Sentinel imports `HEALTHCHECK_PATH` from client.ts (now present). stdio-hygiene re-run is a check, not a code change. | Sentinel test file exists with correct describe.skipIf shape; `RUN_PROBE=1 npx vitest run endpoint-probe` green with a live key |
| **Wave 4** | Live-smoke end-to-end (Step 7) | N/A — this is the phase acceptance gate | `RUN_LIVE_SMOKE=1 npx vitest run src/comfyui/__tests__/live-smoke.test.ts` returns green with a completed job |
| **Wave 5** | 07-VERIFICATION.md (Step 8) AND 02-VERIFICATION.md supplement (Step 9) AND memory updates (Step 10) | **Yes — 3 tasks in parallel.** All three are doc/memory writes with no shared state beyond the already-locked base string and HEALTHCHECK_PATH. | All three docs present; probe matrix table populated with actual Wave 1 data; memory `project_comfy_api_endpoint_drift.md` marked resolved (or removed) with pointer to `07-VERIFICATION.md` |

### Blocking vs. non-blocking nuance

- **Wave 0 → 1 is HARD BLOCKING.** The probe must run and return a winner before any constant is locked. Attempting Wave 2 before Wave 1 means writing `HEALTHCHECK_PATH = '/api/queue'` speculatively and hoping — but if the probe reveals `/api/queue` 401s too, the whole chain backtracks. Do NOT parallelize into Wave 2 work.
- **Wave 2 internal parallelism is low-risk** because the three tasks share only a string constant. Worst-case conflict is a merge in `client.ts` (one writer) — acceptable.
- **Wave 5 is deliberately LAST** because the verification doc's probe-matrix table should reflect the *actual* matrix observed during Wave 1, not a speculative one. Writing `07-VERIFICATION.md` before the probe runs would force a later rewrite.

### If the probe identifies a NEW base (not in D-EP-04 hardcoded list)

Edge case: docs-dynamic fetch returns some URL that isn't `cloud.comfy.org`, `api.comfy.org`, or `www.comfy.org/api` — e.g., ComfyUI introduces `https://api.v2.comfy.org` since Phase 2. Graceful path:

1. Probe matrix shows 200 on the new base.
2. Executor locks that URL into `DEFAULT_COMFYUI_API_BASE`, `.env`, `.env.example`.
3. Executor also extends the `DEFAULT_ALLOWED_HOST_PATTERNS` array (line 113 of `client.ts`) if the signed-URL download redirects now land on a new host tied to the new base. **BUT** D-EP-12 §4 says no changes to `DEFAULT_ALLOWED_HOST_PATTERNS` unless the probe surfaces a new redirect host — the probe is read-only and won't test signed-URL redirects. Live-smoke (Wave 4) would surface any missing redirect host. Punt to Wave 4 observation.
4. Executor documents the new base in `07-VERIFICATION.md` §1 (Probe Matrix) with rationale.

## Validation Architecture

> Required per `.planning/config.json` `workflow.nyquist_validation: true`. This section is the ONLY source for `07-VALIDATION.md` downstream.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.4 |
| Config file | `/Users/macapple/comfyui-vfx-mcp/vitest.config.ts` (root); node environment; excludes `packages/**` |
| Quick run command | `npx vitest run src/comfyui/__tests__/ src/__tests__/stdio-hygiene.test.ts` |
| Full suite command | `npx vitest run` |
| Live-smoke gate | `RUN_LIVE_SMOKE=1 npx vitest run src/comfyui/__tests__/live-smoke.test.ts` |
| Probe sentinel gate | `RUN_PROBE=1 npx vitest run src/comfyui/__tests__/endpoint-probe.test.ts` |

### Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-1 | `.env COMFYUI_API_BASE` returns 200 for authenticated requests | **manual (probe)** + automated (sentinel) | `RUN_PROBE=1 COMFYUI_API_KEY=... npx vitest run endpoint-probe` | Wave 0 — `src/comfyui/__tests__/endpoint-probe.test.ts` |
| SC-1 | `DEFAULT_COMFYUI_API_BASE` constant matches the winning probe base | unit | `npx vitest run src/comfyui/__tests__/client.test.ts` | existing — verify assertion against new constant |
| SC-1 | Probe script itself executes cleanly with valid key | manual-only (operator) | `npx tsx scripts/probe-comfy-endpoint.mts` | Wave 0 — `scripts/probe-comfy-endpoint.mts` |
| SC-2 | Live-smoke submit → poll → download → completed version | integration (live) | `RUN_LIVE_SMOKE=1 npx vitest run src/comfyui/__tests__/live-smoke.test.ts` | existing — `src/comfyui/__tests__/live-smoke.test.ts` |
| SC-2 | First-submit healthcheck fires exactly once per ComfyUIClient instance | unit | `npx vitest run src/comfyui/__tests__/client.test.ts` | Wave 0 — extend `src/comfyui/__tests__/client.test.ts` with ensureEndpointHealthy tests |
| SC-2 | Healthcheck race-safe: concurrent submit() calls share one healthcheck fetch | unit | `npx vitest run src/comfyui/__tests__/client.test.ts` | Wave 0 — same file |
| SC-2 | Healthcheck failure throws `COMFYUI_ENDPOINT_DRIFT` with actionable hint | unit | `npx vitest run src/comfyui/__tests__/client.test.ts` | Wave 0 — same file |
| SC-3 | `07-VERIFICATION.md` exists with 4 required sections | documentation | `ls .planning/phases/07-comfyui-endpoint-reconciliation/07-VERIFICATION.md` + manual review | Wave 5 — created |
| SC-3 | `02-VERIFICATION.md` appended with Phase 7 cross-reference paragraph | documentation | `grep -n "Endpoint Reconciliation (Phase 7" .planning/phases/02-comfyui-generation/02-VERIFICATION.md` | existing — append |
| SC-3 | Rotation procedure is executable end-to-end by a new operator | manual | Walk the procedure in `07-VERIFICATION.md` §3 with a fresh key | Wave 5 — manual check |
| Observability | Sentinel test runs standalone with a live key, catches future drift | manual (opt-in) | `RUN_PROBE=1 npx vitest run endpoint-probe` | Wave 3 created |
| Observability | Typed error `COMFYUI_ENDPOINT_DRIFT` surfaces through tool envelope | unit | Existing `src/tools/__tests__/error-wrapping.test.ts` + new assertion | existing — may extend |
| Regression | Existing live-smoke stays green | integration (live) | Same as SC-2 | existing |
| Regression | `stdio-hygiene.test.ts` still passes | unit | `npx vitest run src/__tests__/stdio-hygiene.test.ts` | existing — no change |
| Regression | `tool-budget.test.ts` still reports 7 tools | unit | `npx vitest run src/__tests__/tool-budget.test.ts` | existing — no change |
| Regression | `architecture-purity.test.ts` still passes | unit | `npx vitest run src/__tests__/architecture-purity.test.ts` | existing — no change |
| Regression | `transport-parity.test.ts` still passes | unit | `npx vitest run src/__tests__/transport-parity.test.ts` | existing — no change |

### Sampling Rate

- **Per task commit:** `npx vitest run src/comfyui/__tests__/` + `npx vitest run src/__tests__/stdio-hygiene.test.ts src/__tests__/tool-budget.test.ts src/__tests__/architecture-purity.test.ts`
- **Per wave merge:** `npx vitest run` (full suite — 735 passing, 2→3 skipped)
- **Per wave merge (with live key):** `RUN_PROBE=1 npx vitest run endpoint-probe`
- **Phase gate (SC-2):** `RUN_LIVE_SMOKE=1 npx vitest run src/comfyui/__tests__/live-smoke.test.ts` returns green with a completed job (two live-smoke tests, both must pass)
- **Phase gate (SC-1, SC-3):** manual review of `07-VERIFICATION.md` content + probe-matrix table completeness

### Wave 0 Gaps (test files that must be created before or during implementation)

- [ ] `src/comfyui/__tests__/endpoint-probe.test.ts` — sentinel gated on `RUN_PROBE=1` + `COMFYUI_API_KEY`, imports `HEALTHCHECK_PATH` from `client.ts`, single assertion: `GET ${base}${HEALTHCHECK_PATH}` returns 200 with `X-API-Key` header.
- [ ] `scripts/probe-comfy-endpoint.mts` — one-shot operator diagnostic, matrix probe + docs-dynamic discovery + exit-code semantics.
- [ ] Extensions to existing `src/comfyui/__tests__/client.test.ts` for `ensureEndpointHealthy()` unit tests (4 cases: success-cache-hit, failure-throws-drift, concurrent-races-memoize, failure-retry-reopens-cache).

**None of these require new framework install** — Vitest is already the test runner for everything in `src/**/__tests__/`.

### Documentation Validation

- `07-VERIFICATION.md` passes review when all 4 required sections (D-EP-12) are present AND the probe-matrix table is populated with actual Wave 1 observations (not placeholders).
- `02-VERIFICATION.md` supplement passes review when the paragraph-plus-link is appended AND the link resolves to `07-VERIFICATION.md`.
- Rotation procedure (D-EP-12 §3) passes review when a different agent (or future human) can follow the numbered steps and issue a new key + update `.env` + re-run live-smoke without consulting any other doc.
- Memory updates (D-EP-15) pass review when: (a) `project_comfy_api_endpoint_drift.md` header has `RESOLVED 2026-04-XX → .planning/phases/07-comfyui-endpoint-reconciliation/07-VERIFICATION.md`, (b) `reference_env_comfyui_key.md` body reflects the locked base, (c) `MEMORY.md` index entries match the above.

## Common Pitfalls (project-specific)

### Pitfall 1: Hardcoding `/api/queue` as HEALTHCHECK_PATH without the probe confirming

**What goes wrong:** If `/api/queue` requires elevated scope (e.g., Creator tier), the current key may 401 on it while the submit endpoint still works. Locking it as the healthcheck would block all generations.
**Why it happens:** Docs imply `/api/queue` is generally-available but don't state scope requirements.
**How to avoid:** Let the probe empirically verify. If `/api/queue` 401s for the current key, fall back to `/api/object_info` (also documented, also read-only, returns node definitions). Document the fallback choice in `07-VERIFICATION.md` §1 rationale.
**Warning signs:** Sentinel test passes at tier X, fails at tier Y during a real generation.

### Pitfall 2: Memoizing a rejected healthcheck promise

**What goes wrong:** The first healthcheck 401s; subsequent submit calls await the same rejected promise and keep throwing `COMFYUI_ENDPOINT_DRIFT` even after the operator edits `.env` — but `.env` edits require a server restart, so this is less severe than it sounds. HOWEVER, if an operator edits `.env` AT RUNTIME (e.g., via some future hot-reload), the stale cached rejection would persist.
**Why it happens:** Standard promise memoization stores the rejection alongside success.
**How to avoid:** On failure, explicitly reset `this.healthCheckResult = null` inside the IIFE before throwing. Next submit triggers a fresh fetch.
**Warning signs:** Tests show a second-submit doesn't re-fetch on failure. Covered by the "failure-retry-reopens-cache" unit test in Wave 2.

### Pitfall 3: Probe script credit burn

**What goes wrong:** Executor accidentally adds a POST `/api/prompt` to the probe matrix, or runs the Claude's Discretion POST-`{}` dry-run against the wrong base that happens to accept it, queuing a real generation.
**Why it happens:** D-EP-02 is explicit but Claude's Discretion tempts expansion.
**How to avoid:** Keep the matrix strictly GET. If the discretion POST is added, guard with an `--include-post` flag that defaults to off and print a banner warning before firing it.
**Warning signs:** Probe output mentions a `prompt_id` or `202 Accepted` response — means something was queued.

### Pitfall 4: `.env.example` drift

**What goes wrong:** Executor updates `.env` with the new locked base but forgets `.env.example`. New contributors clone the repo, copy `.env.example` → `.env`, use the stale base, hit 401 on first generation attempt, file an issue.
**Why it happens:** `.env` is gitignored and `.env.example` is the only mirror checked into git. Forgetting to sync them is a classic.
**How to avoid:** CONTEXT.md D-EP-06 lists the three update sites. The plan task must update all three. Add a grep-based verification: `grep -n "COMFYUI_API_BASE" .env.example src/comfyui/client.ts` shows both using the same string.
**Warning signs:** `grep COMFYUI_API_BASE .env.example` and `grep DEFAULT_COMFYUI_API_BASE src/comfyui/client.ts` return different URLs.

### Pitfall 5: Forgetting to run the live-smoke TWICE before calling Phase 7 done

**What goes wrong:** A single live-smoke pass might succeed due to transient state. D-EP-15 says "live-smoke green for the second consecutive run is the bar" for memory removal (vs marking resolved).
**Why it happens:** Optimism after one green run.
**How to avoid:** Phase acceptance gate includes "run live-smoke twice back-to-back, both complete successfully." Record both timestamps in `07-VERIFICATION.md` §1.
**Warning signs:** Second run 401s or times out — the drift is intermittent, not resolved.

## Code Examples

Verified patterns from this repo (read 2026-04-24):

### Existing fetch wrapper shape (reference for healthcheck)

```typescript
// Source: src/comfyui/client.ts:195 (submit method fetch call)
res = await this.fetchImpl(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': this.apiKey,
  },
  body: JSON.stringify(body),
  redirect: 'manual',
});
```

### TypedError throw pattern

```typescript
// Source: src/comfyui/client.ts:241 (submit 4xx path)
throw new TypedError(
  'COMFYUI_API_ERROR',
  this.scrubAndTruncate(
    nodeMessage ?? `ComfyUI request failed: ${res.status} ${res.statusText}`,
  ),
);
```

### Gated test pattern (for sentinel)

```typescript
// Source: src/comfyui/__tests__/live-smoke.test.ts:56 + 125
const SKIP = !process.env.COMFYUI_API_KEY || process.env.RUN_LIVE_SMOKE !== '1';
// ...
describe.skipIf(SKIP)('live ComfyUI Cloud smoke (D-GEN-42.7)', () => {
  test('submit → poll → download → output file on disk', async () => { /* ... */ });
});
```

### Probe script docstring style

```javascript
// Source: scripts/inspector-smoke.mjs:1-13 (top-of-file, .mjs but same shape applies to .mts)
#!/usr/bin/env node
// Programmatic MCP Inspector smoke for both transports.
// Uses the real MCP SDK client — same handshake, tool discovery,
// and invocation path the browser Inspector uses.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// ... (imports block)
```

### dotenv side-effect import at the very top

```typescript
// Source: src/server.ts:2
#!/usr/bin/env node
import 'dotenv/config';
// ... (all other imports below)
```

## Assumptions Log

> Claims in this research tagged `[ASSUMED]`. If empty, all claims were verified or cited.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `/api/queue` is the best `HEALTHCHECK_PATH` default | External State, Healthcheck Sketch | LOW — the probe will empirically verify. If `/api/queue` fails for scope reasons, fallback to `/api/object_info` is clean and documented. |
| A2 | The drift memory's 401 on `cloud.comfy.org` reflects a key-scoping issue, not an endpoint change | Summary, External State | LOW — docs explicitly anchor `cloud.comfy.org` as canonical in 2026-04-24. The probe will identify if this is wrong (the memory is 2 days old and self-describes as point-in-time). |
| A3 | tsx 4.21.0 runs `.mts` cleanly from any cwd | Probe Script Landmines | NONE — verified by running `npx tsx /tmp/test.mts` during research. |
| A4 | `stdio-hygiene.test.ts` does not need any change | stdio-hygiene Extension | LOW — verified by reading all 8 tests in the file. None enumerate typed-error codes. |
| A5 | Test-count baseline is 735 passed / 2 skipped | Test-Count Invariants | NONE — measured by running `npx vitest run` 2026-04-24. |
| A6 | The docs-fetch discovery will return `https://cloud.comfy.org` (unchanged) | External State | NONE — verified by WebFetch against docs.comfy.org 2026-04-24. |

**Three claims tagged `[ASSUMED]`** — all with LOW risk because the probe script itself is the empirical test that resolves them. None block planning; all are flagged for the executor to verify at Wave 1.

## Open Questions (RESOLVED)

1. **What is the current API key's scope?** The drift memory says `cloud.comfy.org` 401'd the key on 2026-04-22. Docs don't document key-vs-endpoint scoping. **What we know:** key was issued at `platform.comfy.org`. **What's unclear:** whether it's tied to a specific service (`api.comfy.org`) or a specific tier. **Recommendation:** the probe will reveal which bases return 401 vs 404 vs 200 — that resolves scoping empirically. If ALL bases 401, the resolution is key rotation (explicitly in scope per CONTEXT.md rotation procedure). If `cloud.comfy.org` returns 200 but `api.comfy.org` returns 401, the resolution is base update only.

2. **Does `cloud.comfy.org` still return 401 today (2026-04-24) as it did 2026-04-22?** Memory is 2 days old. Docs unchanged. **Recommendation:** Wave 1 probe answers this. If it now returns 200, `.env` + `DEFAULT_COMFYUI_API_BASE` both change to `cloud.comfy.org` (the code default is already that — so the fix is a single `.env` line edit + memory hygiene).

3. **Are `/api/queue` and `/api/object_info` both available at the Free tier?** Cannot answer from docs. **Recommendation:** try `/api/queue` first in probe; if 401/403 with Free-tier key, fall back to `/api/object_info`. Document whichever returns 200 in `07-VERIFICATION.md` §1 with observed tier.

4. **Will the docs page parse reliably with a simple regex?** WebFetch returns an LLM-summarized version; the actual HTML structure at raw fetch time may differ. **Recommendation:** Test the regex during probe script development; if the regex fails to find a URL, the probe falls back to the three hardcoded bases (graceful degradation — see Landmine 5). No blocking issue.

## Sources

### Primary (HIGH confidence)
- `docs.comfy.org/development/cloud/overview` — fetched 2026-04-24 via WebFetch; confirms `https://cloud.comfy.org` as canonical base, documents `POST /api/prompt`, `GET /api/job/{id}/status`, `GET /api/view`, `GET /api/history_v2/{id}`, `wss://cloud.comfy.org/ws`.
- `docs.comfy.org/development/cloud/api-reference` — fetched 2026-04-24 via WebFetch; enumerates `/api/queue` (GET+POST), `/api/object_info`, `/api/upload/image`, `/api/upload/mask`, `/api/view`, `/api/interrupt`, `/api/prompt`, `/api/job/{prompt_id}/status`.
- `src/comfyui/client.ts` (501 lines) — read fully 2026-04-24. `DEFAULT_COMFYUI_API_BASE` at line 34; `DEFAULT_ALLOWED_HOST_PATTERNS` at line 113; `ComfyUIClient` class constructor at line 167; `submit()` at line 190; `status()` at line 255; `download()` at line 329; `fetchImpl` injection pattern at line 186.
- `src/comfyui/__tests__/live-smoke.test.ts` — read fully 2026-04-24. `SKIP` gate at line 56; `describe.skipIf(SKIP)` at line 125; 2 tests inside.
- `src/engine/errors.ts` — read fully 2026-04-24. `ErrorCode` union ends with `OUTPUT_UNAVAILABLE` at line 35; `TypedError` class at line 42.
- `src/__tests__/stdio-hygiene.test.ts` — read fully 2026-04-24. 8 tests; none enumerate error-code literals.
- `package.json` — read 2026-04-24. Node ^20 engines, tsx 4.21.0, vitest 4.1.4, Node v25.6.1 measured.
- `tsconfig.json` — read 2026-04-24. ESM NodeNext, strict, `include: src/**/*.ts` only.
- `vitest.config.ts` — read 2026-04-24. Node env, 10s default test timeout, packages/** excluded.
- `scripts/inspector-smoke.mjs` (278 lines) — read fully 2026-04-24. Reference shape for probe script.
- `.env.example` — read 2026-04-24 via Bash find. Current contents include `COMFYUI_API_BASE=https://cloud.comfy.org`.
- `.planning/phases/02-comfyui-generation/02-VERIFICATION.md` — read fully 2026-04-24. Anchors Phase 2 verification artifacts Phase 7 must not break.
- `.planning/phases/02-comfyui-generation/02-CONTEXT.md` — read 2026-04-24 for D-GEN-09..13, D-GEN-21, D-GEN-40, D-GEN-41, D-GEN-42.7.
- `.planning/phases/07-comfyui-endpoint-reconciliation/07-CONTEXT.md` — read fully 2026-04-24.
- `.planning/ROADMAP.md` §Phase 7 — read 2026-04-24.
- `.planning/v1.0-MILESTONE-AUDIT.md` — read 2026-04-24 (Phase 02 tech debt row).
- `.planning/config.json` — read 2026-04-24; `nyquist_validation: true` verified.
- `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/project_comfy_api_endpoint_drift.md` — read 2026-04-24 (memory is 2 days old per system reminder).
- `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/reference_env_comfyui_key.md` — read 2026-04-24 (3 days old per system reminder).
- **Test-suite baseline measurement:** `npx vitest run` completed 2026-04-24 with `Test Files 45 passed | 1 skipped (46); Tests 735 passed | 2 skipped (737)`.

### Secondary (MEDIUM confidence)
- `src/utils/validate-base-url.ts` — read 2026-04-24. Confirms IS-02 base-URL validation already guards http / private / loopback; Phase 7 does not touch this.
- CONTEXT7 or equivalent library docs for dotenv ESM hoisting — not consulted; the pattern is locked by Phase 2 D-GEN-09 and needs no revision.

### Tertiary (LOW confidence)
- None. No unverified WebSearch claims in this research.

## Metadata

**Confidence breakdown:**
- External state (docs.comfy.org): **HIGH** — WebFetch against authoritative source; cross-verified between /overview and /api-reference.
- Healthcheck code sketch: **HIGH** — grounded in actual client.ts patterns read line-by-line.
- Probe landmines: **HIGH** — all 7 landmines verified by reading relevant source or testing (tsx .mts test ran clean).
- Test-count invariants: **HIGH** — measured by running the suite.
- Build-order: **HIGH** — derived from CONTEXT.md's 10 steps with explicit dependency analysis.
- Validation architecture: **HIGH** — every row maps to a concrete command or file path.
- Open questions: **MEDIUM** — 3 of 4 resolvable only by running the probe; the 4th (regex parsing) is defensive and has fallback.

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days — docs.comfy.org state may drift, and the memory's 2-day-old 401 observation needs re-verification during Wave 1 anyway). If Phase 7 is not started by 2026-05-01, re-run the docs WebFetch to confirm the canonical base hasn't changed.
