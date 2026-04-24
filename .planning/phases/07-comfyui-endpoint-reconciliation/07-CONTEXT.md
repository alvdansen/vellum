# Phase 7: ComfyUI Endpoint Reconciliation - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Pick a single `COMFYUI_API_BASE` that authenticates and returns 200 across `submit` + `status` against the live ComfyUI Cloud API; get `live-smoke.test.ts` green end-to-end (`RUN_LIVE_SMOKE=1` + `COMFYUI_API_KEY`); and document the resolution so it survives the next credential rotation. Closes the Phase 2 infrastructure tech debt captured in `.planning/v1.0-MILESTONE-AUDIT.md` Phase 02 row and project memory `project_comfy_api_endpoint_drift.md`.

**In scope:**
- Probe script that hits a base × path matrix with the current `.env` key (read-only GETs only — zero credit burn)
- Lock the winning base into `src/comfyui/client.ts` `DEFAULT_COMFYUI_API_BASE`, `.env`, and `.env.example` — single source of truth
- First-submit healthcheck in the ComfyUI client that catches future drift and throws a new `COMFYUI_ENDPOINT_DRIFT` typed error
- Cheap, non-credit-burning sentinel test for ad-hoc and future CI use (`endpoint-probe.test.ts`, gated on `RUN_PROBE=1` + key)
- `07-VERIFICATION.md` with probe matrix, chosen base, credential layout, rotation procedure, fallback-if-redirected behaviour, and a 1-paragraph cross-reference supplement appended to `02-VERIFICATION.md`
- Post-resolution memory hygiene: mark `project_comfy_api_endpoint_drift.md` resolved (or remove) and update `reference_env_comfyui_key.md` with the new locked base
- Live-smoke run end-to-end (`RUN_LIVE_SMOKE=1 npx vitest run src/comfyui/__tests__/live-smoke.test.ts`) returning a completed job

**Out of scope (belongs to other phases or v2):**
- Multi-base routing / fallback list (`COMFYUI_API_BASES=primary,secondary`) — v2 ROUTE-* territory; explicitly rejected for this phase
- Credential rotation tooling (key vault, auto-rotation) — operational concern, not a code deliverable
- Health/status dashboard surface — out of v1
- Touching any code under `src/comfyui/` beyond `client.ts` (errors taxonomy and the new healthcheck call) and the new test file
- Any change to the existing live-smoke test's gate or shape — only the underlying base needs to make it green
- Changes to `DEFAULT_ALLOWED_HOST_PATTERNS` (signed-URL allowlist) unless the probe surfaces a new redirect host
- Functional behaviour changes to `submit` / `status` / `download` HTTP paths — those routes are correct; only the BASE under them is in question

</domain>

<decisions>
## Implementation Decisions

### Endpoint Discovery (probe script)

- **D-EP-01:** Discovery is **probe-first**. Write a new script `scripts/probe-comfy-endpoint.mts` that loads `COMFYUI_API_KEY` from `.env` (via existing `dotenv` flow) and walks a base × path matrix with `X-API-Key` header, reporting status code + first 200 bytes of response body for each combo. No docs read in this phase — Phase 2 already cross-referenced `docs.comfy.org`; current state requires real network probing because the docs-vs-live disagreement is exactly what the drift memory captures.
- **D-EP-02:** Probe is **read-only**. GET endpoints only — `/api/queue`, `/api/system_stats`, `/api/history`, `/` (root). Whichever returns 200 with the X-API-Key header is the "known-good base" candidate. Zero generations queued, zero credits burned, safe to run repeatedly.
- **D-EP-03:** Probe lives at `scripts/probe-comfy-endpoint.mts`. Manual one-shot (developer runs `npx tsx scripts/probe-comfy-endpoint.mts` after suspected drift or post-rotation). Gitignored from CI runs (no automated invocation in this phase — sentinel test (D-EP-13) covers the recurring case).
- **D-EP-04:** Probe matrix bases: **all four** — `https://cloud.comfy.org`, `https://api.comfy.org`, `https://www.comfy.org/api`, plus whatever URL `docs.comfy.org/development/cloud/overview` currently advertises (fetched dynamically by the script so future drift to a brand-new base is caught). Probe paths: `/api/queue`, `/api/system_stats`, `/api/history`, `/` per D-EP-02.
- **D-EP-05:** Probe output format is a human-readable matrix table (left to executor — Markdown table to stdout is the default; structured JSON output is a Claude's-discretion improvement if useful for the sentinel test to reuse).

### Endpoint Resilience (lock-one + healthcheck)

- **D-EP-06:** **Lock one base + first-submit healthcheck.** No fallback list, no runtime probe-and-pick loop. The probe winner becomes the new locked default in three places: `src/comfyui/client.ts` exported `DEFAULT_COMFYUI_API_BASE` constant (currently `'https://cloud.comfy.org'`), `.env` `COMFYUI_API_BASE`, and `.env.example` `COMFYUI_API_BASE`. Single source of truth.
- **D-EP-07:** **First-submit healthcheck** runs once per process before `client.submit()` is invoked the first time. Cheap GET against the same read-only endpoint the probe identified as known-200 (most likely `/api/queue`). Result is cached for the process lifetime — never re-checked (no per-submit overhead). Implementation lives in `src/comfyui/client.ts` (private `ensureEndpointHealthy()` called from `submit()`).
- **D-EP-08:** Healthcheck failure (401 or 404) throws a **new typed error** `COMFYUI_ENDPOINT_DRIFT`. Joins the Phase 2 D-GEN-40 family. Hint: `"COMFYUI_API_BASE may have drifted (got HTTP <status> on healthcheck against <base><path>). Run \`npx tsx scripts/probe-comfy-endpoint.mts\` to find the current working base, then update .env COMFYUI_API_BASE."` Surfaces through the standard D-GEN-41 envelope (`isError: true, structuredContent: {code, message, hint}`).
- **D-EP-09:** **Drift philosophy:** treat endpoint drift as an ops event, not a code-design problem. We're an internal product proposal targeting a single Cloud API surface. Multi-base routing is v2 (ROUTE-01..03 in REQUIREMENTS.md). Don't add tenant config, fallback queues, or per-call probe logic in v1.
- **D-EP-10:** Healthcheck cache key is the (base, key-last-4) tuple held in the `ComfyUIClient` instance. If `Engine.start()` is called after `Engine.stop()` in the same process (uncommon — only the recovery poller restart path), a fresh `ComfyUIClient` instance gets a fresh healthcheck. No global static cache — keeps test isolation clean.

### Resolution Documentation

- **D-EP-11:** **`07-VERIFICATION.md` is the canonical resolution doc** + a 1-paragraph cross-reference supplement appended to `02-VERIFICATION.md` so future Phase 2 readers find it. Structure follows existing GSD verification shape (frontmatter, observable truths, key-link verification, etc.). The supplement in `02-VERIFICATION.md` is a single section `## Endpoint Reconciliation (Phase 7, 2026-04-XX)` with one paragraph and a link to `07-VERIFICATION.md`.
- **D-EP-12:** **Required sections** in `07-VERIFICATION.md`:
  1. **Probe matrix + chosen base** — dated table of base × path × status from one canonical run of `scripts/probe-comfy-endpoint.mts` + the single `COMFYUI_API_BASE` we picked + 1-2 sentences of rationale (which combo returned 200, healthcheck path).
  2. **Credential layout / source-of-truth** — where the key lives (`.env` at repo root, gitignored, chmod 600), how it's loaded (`dotenv` at `src/server.ts:2`), how tests gate on it (`RUN_LIVE_SMOKE=1` + `COMFYUI_API_KEY` for live-smoke, `RUN_PROBE=1` + key for the sentinel). Issuance source: ComfyUI Cloud console — link the exact UI path where keys are issued.
  3. **Rotation procedure** — numbered step-by-step: (1) issue new key in ComfyUI Cloud console, (2) replace value in `.env`, (3) re-run probe script, (4) update `DEFAULT_COMFYUI_API_BASE` in `client.ts` if base changed, (5) re-run `RUN_LIVE_SMOKE=1 npx vitest run src/comfyui/__tests__/live-smoke.test.ts`.
  4. **Fallback-if-redirected behaviour + memory hygiene** — existing `DEFAULT_ALLOWED_HOST_PATTERNS` allowlist in `src/comfyui/client.ts:113`, the `COMFYUI_ALLOWED_REDIRECT_HOSTS` env override (D-GEN-22), what to do if a probe surfaces an unknown signed-URL host. PLUS: post-resolution, mark `project_comfy_api_endpoint_drift.md` resolved (or remove) and update `reference_env_comfyui_key.md` with the new locked base (D-EP-15).

### Drift Sentinel (cheap test)

- **D-EP-13:** Add **`src/comfyui/__tests__/endpoint-probe.test.ts`** — gated on `RUN_PROBE=1` + `COMFYUI_API_KEY` (separate gate from `RUN_LIVE_SMOKE`). Adds 1 to the skipped-test count by default. Manual run: `RUN_PROBE=1 npx vitest run endpoint-probe`. Audit-friendly: stable skipped count, clear gate, predictable behaviour.
- **D-EP-14:** Sentinel asserts **healthcheck endpoint returns 200** — same shape as the runtime healthcheck (D-EP-07). Single assertion: GET `${COMFYUI_API_BASE}${HEALTHCHECK_PATH}` with `X-API-Key`, expect `res.status === 200`. Fast, narrow, fails clearly when drift hits. The runtime healthcheck and sentinel test share intent and the same path constant (extract to a shared module-level export in `client.ts`, e.g. `HEALTHCHECK_PATH`).

### Memory Hygiene (post-resolution)

- **D-EP-15:** Both relevant project memories updated as a Phase 7 closing step:
  - `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/project_comfy_api_endpoint_drift.md` — marked with a `RESOLVED 2026-04-XX → see .planning/phases/07-comfyui-endpoint-reconciliation/07-VERIFICATION.md` header. Removed entirely if Claude's confidence is high (live-smoke green for the second consecutive run is the bar).
  - `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/reference_env_comfyui_key.md` — body updated to reflect the new locked `COMFYUI_API_BASE` value. Update happens AFTER `02-VERIFICATION.md` supplement is written so the memory points at the doc, not the other way around.
  - Also update `MEMORY.md` index entries to match.

### Claude's Discretion

- **Probe output format detail** — Markdown table to stdout is the default; structured JSON (`--json` flag) is fine if it makes the sentinel test re-use the same parser. Executor's call.
- **Healthcheck path constant naming** — `HEALTHCHECK_PATH` vs `ENDPOINT_PROBE_PATH` vs `KNOWN_GOOD_GET_PATH` — pick one and use it consistently.
- **Probe script docstring style** — match the existing `inspector-smoke.mjs` shape (top-of-file JSDoc with run instructions and exit-code semantics).
- **Whether to also probe POST /api/prompt with `{}` body in the script** — D-EP-02 locks read-only as the sentinel test's contract; whether the discovery probe (one-shot, manual) ALSO does a single dry-run POST that expects 4xx is a Claude's-discretion add-on. Useful for evidence in the matrix but not required.
- **Exact `02-VERIFICATION.md` supplement wording** — one paragraph + link is the contract; specific phrasing is the writer's choice.
- **Whether to add `COMFYUI_ENDPOINT_DRIFT` to the existing `stdio-hygiene.test.ts` no-leak assertions** — probably yes (consistent with other typed errors), but exact placement is implementation detail.
- **Whether the probe script tries `/api/v1/prompt` and `/v1/prompt`** as path variants beyond the read-only set — useful diagnostic if the read paths all 404, but not strictly required by D-EP-02. Adding them is fine if they're clearly labelled "evidence-only, not the chosen healthcheck path".

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor, checker) MUST read these before acting.**

### Phase 7 anchor docs

- `.planning/ROADMAP.md` §"Phase 7: ComfyUI Endpoint Reconciliation" — Goal + 3 success criteria (single base returning 200, live-smoke round-trip green, decision documented in 02-VERIFICATION.md or successor)
- `.planning/v1.0-MILESTONE-AUDIT.md` §"Phase 02 — ComfyUI Generation" tech debt row + §"Tech Debt (deferred, non-blocking)" — Defines the gap closure scope and explicitly says "Infrastructure/credentials issue, not a code defect"

### Prior phase context (hard dependency — Phase 2 decisions are load-bearing)

- `.planning/phases/02-comfyui-generation/02-CONTEXT.md` — Especially D-GEN-09 (`.env` + `dotenv` model), D-GEN-10 (zero-config boot preserved), D-GEN-11 (`https://cloud.comfy.org` was the design-time default), D-GEN-12 (`****last4` log format), D-GEN-13 (no CLI flag for the key), D-GEN-21 (X-API-Key auth), D-GEN-22 (redirect allowlist + `COMFYUI_ALLOWED_REDIRECT_HOSTS` override), D-GEN-40 (typed-error family that `COMFYUI_ENDPOINT_DRIFT` joins), D-GEN-41 (typed envelope), D-GEN-42.7 (live-smoke gate)
- `.planning/phases/02-comfyui-generation/02-VERIFICATION.md` — Required artifacts list (Phase 7 must not break any of these), Key Link table (`src/comfyui/client.ts` ↔ `src/engine/generation.ts` wiring shape stays the same), live-smoke entry (Phase 7 makes this go green)

### Source files Phase 7 touches

- `src/comfyui/client.ts` (501 lines) — `DEFAULT_COMFYUI_API_BASE` at line 34 (constant to update), `DEFAULT_ALLOWED_HOST_PATTERNS` at line 113 (referenced in D-EP-12 fallback section), `ComfyUIClient` class (host of new `ensureEndpointHealthy()` method per D-EP-07). Reading the full file is required before editing — auth header pattern and the manual-redirect SSRF gate are non-negotiable invariants.
- `src/comfyui/__tests__/live-smoke.test.ts` (315 lines) — Existing test that must go green at the end of Phase 7. Phase 7 does NOT modify the gate (`RUN_LIVE_SMOKE=1` + `COMFYUI_API_KEY`) or workflow (D-GEN-42.7 contract); only the underlying base needs to make it pass. Provides the reference test shape for `endpoint-probe.test.ts` (D-EP-13).
- `.env.example` — Currently lists `COMFYUI_API_BASE=https://cloud.comfy.org`. Update to the locked base + add a comment pointing at `07-VERIFICATION.md` rotation procedure.
- `src/__tests__/stdio-hygiene.test.ts` — May need extension to include `COMFYUI_ENDPOINT_DRIFT` in the no-leak assertions (Claude's Discretion per the decision body).

### Source files Phase 7 creates

- `scripts/probe-comfy-endpoint.mts` — NEW. Probe script per D-EP-01..05. Match shape of existing `scripts/inspector-smoke.mjs` (only existing script in `scripts/`).
- `src/comfyui/__tests__/endpoint-probe.test.ts` — NEW. Sentinel test per D-EP-13..14.
- `.planning/phases/07-comfyui-endpoint-reconciliation/07-VERIFICATION.md` — NEW. Resolution doc per D-EP-11..12.

### Project memories (READ + UPDATE per D-EP-15)

- `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/project_comfy_api_endpoint_drift.md` — Records the 2026-04-22 drift state. Resolution path documented in body. **Mark resolved or remove at Phase 7 close.**
- `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/reference_env_comfyui_key.md` — States `.env` currently points at `api.comfy.org`. Conflicts with `DEFAULT_COMFYUI_API_BASE` in code (`cloud.comfy.org`). **Update body to reflect the locked base after Phase 7 ships.**
- `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/feedback_dont_punt_on_tests.md` — Live-smoke is the wire-level gate; do not escalate to human-UAT for any of the 3 SCs.
- `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/MEMORY.md` — Index entries for the two memories above must be updated to match new states.

### Project conventions

- `CLAUDE.md` — Tool-engine separation (Phase 7 keeps zero MCP deps in `src/comfyui/`), error responses must be human-readable with actionable guidance (D-EP-08 hint format), never log raw secrets (D-GEN-12)
- `.planning/PROJECT.md` — Open-source, MCP-native, ComfyUI Cloud as the API target (single base, not multi-tenant — anchors D-EP-09)
- `.planning/REQUIREMENTS.md` §v2 ROUTE-01..03 — Multi-backend routing is explicitly v2; reaffirms D-EP-09

### External docs (verify state during planning/execution)

- `https://docs.comfy.org/development/cloud/overview` — May have changed since Phase 2 design-time research (2026-04-20). Probe script should fetch the page or its API reference to find the currently-advertised base URL (D-EP-04).
- `https://docs.comfy.org/development/cloud/api-reference` — Source of truth for endpoint paths if it has been updated.
- ComfyUI Cloud console (account/API keys page) — Where keys are issued. Link must appear in the rotation procedure section of `07-VERIFICATION.md` (D-EP-12 §3).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/comfyui/client.ts:34` — `DEFAULT_COMFYUI_API_BASE` exported constant.** Update site for the locked base (D-EP-06). Already exported per `live-smoke.test.ts:50` (`import { ComfyUIClient, DEFAULT_COMFYUI_API_BASE } from '../client.js'`) so all consumers pick up the new value automatically.
- **`src/comfyui/client.ts` — `ComfyUIClient` class.** Healthcheck method (D-EP-07) lives here as a private async method called from `submit()` first invocation. Reuse the existing `fetch` wrapper pattern used by `submit`/`status`/`download` (manual or follow redirect, X-API-Key header).
- **`src/comfyui/client.ts:113` — `DEFAULT_ALLOWED_HOST_PATTERNS`.** Referenced verbatim in the doc's fallback-if-redirected section (D-EP-12 §4). No change to the array contents in Phase 7.
- **`src/engine/errors.ts` — `TypedError`.** Reused verbatim for `COMFYUI_ENDPOINT_DRIFT` (D-EP-08). New string literal joins the D-GEN-40 family.
- **`src/comfyui/__tests__/live-smoke.test.ts` — gate pattern (`describe.skipIf(SKIP)`)** and the `RUN_LIVE_SMOKE=1` + key double opt-in (IT-19). Sentinel test (D-EP-13) mirrors the same shape with `RUN_PROBE=1` + key.
- **`scripts/inspector-smoke.mjs`** — Only existing script in `scripts/`. Use as the docstring + run-instructions reference for `scripts/probe-comfy-endpoint.mts`.
- **`.env.example`** — Already has `COMFYUI_API_BASE=...` line; just update the value and add a comment pointing at the rotation runbook.
- **`dotenv` import at `src/server.ts:2`** — Probe script reuses the same loading pattern: `import 'dotenv/config'` at the top of `scripts/probe-comfy-endpoint.mts`.

### Established Patterns

- **Test gate pattern** — `describe.skipIf(!process.env.X || process.env.Y !== '1')` with both an env var present-check AND an explicit opt-in flag (IT-19 from live-smoke). Sentinel test (D-EP-13) uses the same pattern with `RUN_PROBE`.
- **Typed error pattern** — `throw new TypedError('CODE_LITERAL', message, hint?)`. New `COMFYUI_ENDPOINT_DRIFT` follows the SCREAMING_SNAKE_CASE + actionable hint convention (D-GEN-40, D-GEN-41).
- **HTTP client pattern** — Native `fetch` only (no `node-fetch`/`undici`), `X-API-Key: ${apiKey}` header on every request, manual redirect handling for downloads (302 → allowlist check). Healthcheck uses standard `redirect: 'follow'` since it's a simple GET against a known-stable endpoint.
- **`stderr`-only logging** — `console.error` for any operational logs, never `console.log` (stdio transport hygiene). Healthcheck failure log line (if any beyond the thrown error) goes to stderr.
- **`.env.example` commit pattern** — Real `.env` stays gitignored; `.env.example` lives at repo root with placeholder values + 1-line comments per variable.

### Integration Points

- **`src/comfyui/client.ts` `submit()` method** — First-submit healthcheck invocation point. Lazy: only the FIRST `submit()` call per `ComfyUIClient` instance triggers `ensureEndpointHealthy()`. Result cached on the instance.
- **`src/engine/generation.ts` `submitGeneration()`** — No code change required here; the new typed error from `client.submit()` propagates through the existing error-handling path and surfaces via the standard envelope (`tools/generation-tool.ts` → MCP response).
- **`src/server.ts`** — No change required. `COMFYUI_API_BASE` is read at `Engine` wiring time as it is today; the only difference is the locked-in default value (D-EP-06).
- **`drizzle/`** — No schema changes in Phase 7. Migration count stays at whatever Phase 5/6 left it.
- **`packages/dashboard/`** — Untouched. Endpoint reconciliation has zero dashboard impact.
- **`src/__tests__/architecture-purity.test.ts`** — No expected change; `src/comfyui/` purity invariants stand. Phase 7 only adds new code in `src/comfyui/__tests__/` and the new `scripts/probe-comfy-endpoint.mts` (which is outside `src/` so the assertions don't apply).
- **`src/__tests__/tool-budget.test.ts`** — No tool count change. Stays at 7 (audit-confirmed: `[asset, generation, project, sequence, shot, version, workspace]`).

### Build Order (Phase 7 subset)

```
1. scripts/probe-comfy-endpoint.mts                       (no deps; reads .env via dotenv, native fetch)
2. Run probe manually → identify winning base + healthcheck path
3. Update src/comfyui/client.ts:
   - DEFAULT_COMFYUI_API_BASE = '<winning base>'
   - export const HEALTHCHECK_PATH = '<winning path>'
   - private ensureEndpointHealthy() + first-submit cache
   - new TypedError code 'COMFYUI_ENDPOINT_DRIFT' wired
4. Update .env (locked base) and .env.example (locked base + rotation comment)
5. src/comfyui/__tests__/endpoint-probe.test.ts            (RUN_PROBE=1 gated, single 200 assertion)
6. (Optional Claude's discretion) src/__tests__/stdio-hygiene.test.ts extended for new code
7. Run live-smoke: RUN_LIVE_SMOKE=1 npx vitest run src/comfyui/__tests__/live-smoke.test.ts
8. Write 07-VERIFICATION.md (probe matrix, chosen base, credential layout, rotation, fallback+memory hygiene)
9. Append cross-reference supplement to 02-VERIFICATION.md
10. Update project memories (drift → resolved, reference → new locked base) + MEMORY.md index
```

</code_context>

<specifics>
## Specific Values (reproduce verbatim)

- **Probe script path:** `scripts/probe-comfy-endpoint.mts`
- **Probe script invocation:** `npx tsx scripts/probe-comfy-endpoint.mts`
- **Probe matrix bases:** `https://cloud.comfy.org`, `https://api.comfy.org`, `https://www.comfy.org/api`, plus the docs-advertised base fetched from `https://docs.comfy.org/development/cloud/overview` at probe time
- **Probe matrix paths (read-only):** `/api/queue`, `/api/system_stats`, `/api/history`, `/`
- **Auth header on every probe:** `X-API-Key: ${COMFYUI_API_KEY}` (matches D-GEN-21)
- **New typed error code:** `COMFYUI_ENDPOINT_DRIFT` (SCREAMING_SNAKE_CASE, joins D-GEN-40 family)
- **Healthcheck path constant:** exported from `src/comfyui/client.ts` (e.g. `export const HEALTHCHECK_PATH = '/api/queue'` — actual value set by probe winner)
- **Sentinel test path:** `src/comfyui/__tests__/endpoint-probe.test.ts`
- **Sentinel test gate:** `process.env.COMFYUI_API_KEY && process.env.RUN_PROBE === '1'`
- **Sentinel test invocation:** `RUN_PROBE=1 npx vitest run src/comfyui/__tests__/endpoint-probe.test.ts`
- **Live-smoke invocation (final acceptance gate):** `RUN_LIVE_SMOKE=1 npx vitest run src/comfyui/__tests__/live-smoke.test.ts`
- **Resolution doc paths:** `.planning/phases/07-comfyui-endpoint-reconciliation/07-VERIFICATION.md` (canonical) + appended `## Endpoint Reconciliation (Phase 7, 2026-04-XX)` section in `.planning/phases/02-comfyui-generation/02-VERIFICATION.md` (cross-reference supplement)
- **Memories to update:**
  - `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/project_comfy_api_endpoint_drift.md` (mark resolved or remove)
  - `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/reference_env_comfyui_key.md` (update locked base)
  - `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/MEMORY.md` (index entries)
- **Update sites for the locked base:**
  1. `src/comfyui/client.ts:34` — `DEFAULT_COMFYUI_API_BASE`
  2. `.env` — `COMFYUI_API_BASE=...`
  3. `.env.example` — `COMFYUI_API_BASE=...` + 1-line comment pointing at `07-VERIFICATION.md`
- **Tool count invariant (must hold):** 7 tools — `[asset, generation, project, sequence, shot, version, workspace]`
- **Skipped test count invariant (after Phase 7):** baseline + 1 (sentinel test joins live-smoke as default-skipped)

</specifics>

<deferred>
## Deferred Ideas

Surfaced during discussion. Not in Phase 7 scope — preserved so they aren't lost.

- **Multi-base routing / `COMFYUI_API_BASES=primary,secondary` fallback list** — Explicitly rejected for v1 (D-EP-09). Belongs in v2 with REQUIREMENTS.md ROUTE-01..03 (Multi-Backend Routing).
- **Nightly GitHub Action that runs the probe script with key as a secret** — Useful CI surface but adds infra we don't have today. Defer until endpoint stability becomes a recurring issue. Sentinel test (D-EP-13) gives us the manual-run safety net in the meantime.
- **Credential vault / auto-rotation tooling** — Out of scope for v1 (operational, not a code deliverable). `.env` + `chmod 600` is the v1 contract.
- **ADR practice** — `.planning/decisions/` directory for ADR-style notes was considered for Phase 7 but rejected (D-EP-11) because the project doesn't currently have an ADR practice and establishing one for a single item is heavy. Revisit if/when other phases want a repeatable decision-log pattern.
- **Standalone `.planning/runbooks/` directory** — Considered for the resolution doc; rejected in favour of `07-VERIFICATION.md` because we don't have a runbooks directory pattern today and the rotation procedure is brief enough to live inline.
- **Healthcheck for `status` and `download` paths** — D-EP-07 only checks the read-only path on first `submit()`. If `status` or `download` paths drift independently of `submit`, they'll still surface `COMFYUI_API_ERROR` naturally. A multi-path healthcheck is over-engineering for v1.
- **POST `/api/prompt` `{}`-body dry-run probe** — Considered as a richer probe assertion (D-EP-02) but kept as Claude's Discretion only. The read-only matrix is sufficient evidence for the chosen base.
- **Re-issuing the API key as part of Phase 7** — Out of scope. If the probe identifies a base where the current key works, no rotation needed. If no base works with the current key, that's a manual user action (issue new key in console, drop into `.env`, re-probe) — documented in the rotation procedure section of `07-VERIFICATION.md` (D-EP-12 §3).

</deferred>

---

*Phase: 07-comfyui-endpoint-reconciliation*
*Context gathered: 2026-04-24 via /gsd-discuss-phase*
