# Phase 2: ComfyUI Generation - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver an async ComfyUI Cloud generation surface over the Phase 1 hierarchy. One MCP tool (`generation`) with actions `submit` and `status`. Submit returns immediately with a new `version` row (status `submitted`) attached to a shot; the internal client validates API-format workflow JSON, submits to ComfyUI Cloud, and records the returned `prompt_id` as `job_id`. Status fetches fresh from ComfyUI for non-terminal rows, advances `submitted → running → completed | failed`, and on terminal-completion downloads outputs to a VFX-conforming on-disk path. Completed rows are the first real entries in the `versions` table. GEN-01..GEN-07.

**In scope:**
- One MCP tool `generation` with `action: submit | status`
- ComfyUI Cloud API client (HTTP only in Phase 2 — `POST /api/prompt`, `GET /api/job/{id}/status`, `GET /api/view` with 302 follow)
- Workflow format detection (API format accepted; UI format rejected with a helpful error)
- Async lifecycle: submit returns non-blocking with `{version, breadcrumb}`, status advances state machine
- Exponential-backoff **on-start recovery poller** for pending `submitted|running` rows (reset per-process only — not a continuous background loop)
- Auto-version number allocation within a shot (first = `v001`, monotonic per shot)
- Output download to `./outputs/{project}/{sequence}/{shot}/v###/{filename}.ext` on completion
- Typed error surface: `COMFYUI_CREDENTIALS_MISSING`, `INVALID_WORKFLOW_FORMAT`, `COMFYUI_API_ERROR`, `COMFYUI_RATE_LIMITED`, `DOWNLOAD_FAILED`, `GENERATION_TIMEOUT`, `VERSION_NOT_FOUND`
- `.env` loading via `dotenv` for `COMFYUI_API_KEY` + `COMFYUI_API_BASE`
- Unit + integration tests including a live-API smoke with a throwaway cheap workflow (gated on `COMFYUI_API_KEY` presence)

**Out of scope (belongs to later phases):**
- Provenance capture of the prompt blob / model checksums / diff / reproduce / iterate — Phase 3
- `provenance` table + `tags` + `metadata` + paginated search — Phases 3–4
- Web dashboard, SSE, REST API — Phase 5
- WebSocket progress stream from ComfyUI — post-v1 upgrade path (tool surface stays the same)
- Input-asset upload (workflows with `LoadImage` referencing local files) — deferred, tracked below
- Multi-backend routing, webhooks, batch queuing — v2
- Update/delete on `versions` — append-only by GEN-04, same spirit as Phase 1 create-only hierarchy
- Jobs table with dedicated progress tracking — `versions.status` + `versions.job_id` carry Phase 2

</domain>

<decisions>
## Implementation Decisions

### Tool Surface (GEN-01, GEN-02, GEN-03 · TOOL-01, TOOL-02, TOOL-03, TOOL-04)

- **D-GEN-01:** One MCP tool for Phase 2: `generation`. Noun, snake_case, no prefix — matches Phase 1 D-02 naming.
- **D-GEN-02:** `action` values: `'submit' | 'status'`. Discriminated Zod union on `action` at the tool boundary. No `list` action in Phase 2 — listing versions is covered by a future Phase 3/4 tool; Phase 2 only creates and inspects generations.
- **D-GEN-03:** Tool budget: Phase 2 uses **1 of 8 remaining slots**. Running total: 5 of 12. Remaining budget after Phase 2: 7 (Phase 3 provenance ~3, Phase 4 query ~2, reserve ~2).
- **D-GEN-04:** `action: submit` input schema (Zod v4): `{ action: 'submit', shot_id: string, workflow_json: Record<string, unknown>, notes?: string }`. `workflow_json` is the ComfyUI API-format blob verbatim — no pre-transformation by the tool.
- **D-GEN-05:** `action: submit` response: full version record + Phase 1 breadcrumb envelope. Shape: `{ entity: { id, shot_id, version_number, version_label, status: 'submitted', job_id, created_at, notes }, breadcrumb: [...], breadcrumb_text: 'ws > proj > seq > shot > v001' }`. Breadcrumb now extends to include the new version leaf. `version_label` is the rendered `v###` string (D-GEN-10); `version_number` is the integer (e.g. `1`). Wrapped in the Phase 1 dual-form envelope `{ structuredContent, content: [{type:'text', text: JSON.stringify(structured)}] }` (D-25).
- **D-GEN-06:** `action: status` input schema: `{ action: 'status', version_id: string }`. `version_id` is the handle the agent received from `submit` — stable, indexed, keeps the surface small (no `job_id` lookup path in Phase 2).
- **D-GEN-07:** `action: status` response: fresh-fetched state + full version record + breadcrumb. Shape: `{ entity: { id, shot_id, version_number, version_label, status, job_id, progress, error, created_at, completed_at }, breadcrumb, breadcrumb_text }` where `status ∈ 'submitted' | 'running' | 'completed' | 'failed'`, `progress` is `number | null` (0.0–1.0 when ComfyUI reports it, `null` otherwise), `error` is `string | null` (populated on `failed`), `completed_at` is `number | null` epoch-ms (populated on terminal states).
- **D-GEN-08:** Tool description names the expected format explicitly: "Submits a ComfyUI API-format workflow (also called 'prompt format'). UI-format exports will be rejected — enable 'Dev Mode > Save (API Format)' in ComfyUI to export the right shape." Description kept short per Pitfall #1 (tool description token budget).

### Config & Secrets (resolves TRNS-04 tension for GEN-01)

- **D-GEN-09:** ComfyUI credentials read from `.env` via `dotenv`. Expected variables: `COMFYUI_API_KEY` (required for `submit`), `COMFYUI_API_BASE` (optional, default `https://cloud.comfy.org`). `dotenv` loaded at `src/server.ts` entry **before** engine instantiation. `.env` file already present at repo root, gitignored, chmod 600.
- **D-GEN-10:** Enforcement timing is **submit-time only** — preserves Phase 1 TRNS-04. Server still boots with zero config; `workspace/project/sequence/shot` tools work without credentials. `generation submit` checks for `COMFYUI_API_KEY` on first invocation per process; missing key returns `COMFYUI_CREDENTIALS_MISSING` with hint `"Set COMFYUI_API_KEY in .env at the repo root. See .env.example."`. Hierarchy-only demos and CI runs that never call generation still boot cleanly.
- **D-GEN-11:** `COMFYUI_API_BASE` default is the exact string `https://cloud.comfy.org` (no trailing slash). Overridable via `.env` so the demo rig can point at staging or a local ComfyUI without code changes. Value logged at startup-time-of-first-submit as part of D-GEN-12. *(Updated 2026-04-20 during plan-phase: research cross-referenced docs.comfy.org and confirmed `cloud.comfy.org`; prior value `api.comfy.org` in discuss-phase was incorrect.)*
- **D-GEN-12:** Credential logging rule — **presence only**. On the first `submit` per process, stderr emits one line: `ComfyUI credentials loaded (key ****${last4}, base ${base})`. Never log the key value. Enforced by a grep check in `src/__tests__/stdio-hygiene.test.ts` (existing) extended to assert no `COMFYUI_API_KEY=` string appears in any log path.
- **D-GEN-13:** No CLI flag added for the API key in Phase 2 — `.env` is the single source. Keeps Phase 1's 5-flag CLI contract (D-19) unchanged. An `.env.example` file is committed (without the actual key) so new contributors know what to set.
- **D-GEN-14:** `.env` loading is **silent if `.env` is missing** — this is the zero-config boot path. Only the first `submit` call fails with `COMFYUI_CREDENTIALS_MISSING`.

### Version Lifecycle & State Machine (GEN-02, GEN-03, GEN-04, GEN-05)

- **D-GEN-15:** Version row is written at **submit-time** with `status='submitted'`. Rationale: GEN-05 requires failed generations to record state, which means the row must exist before ComfyUI terminal results are known. Also gives the agent a stable `version_id` to poll.
- **D-GEN-16:** Version number allocation: `SELECT COALESCE(MAX(version_number), 0) + 1 FROM versions WHERE shot_id = ?` inside the insert transaction. First version for a shot is integer `1`, rendered `v001` via D-GEN-17. UNIQUE(shot_id, version_number) (already enforced by Phase 1 schema) catches concurrent submits; retry once on UNIQUE violation, then surface as `CONCURRENT_SUBMIT_CONFLICT` (very rare — single-user demo).
- **D-GEN-17:** Version label format locked (CLAUDE.md + Phase 1 D-08): `v` + zero-padded number, minimum 3 digits. Render helper: `versionLabel(n) = 'v' + String(n).padStart(3, '0')`. Labels ≥ `v1000` are unpadded beyond 4 digits (`v1000`). Label is rendered in the response envelope and in disk paths; the integer `version_number` is the canonical sort/compare key.
- **D-GEN-18:** State machine — single direction, never rolls back:
  - `submitted` — row inserted, workflow POSTed to ComfyUI, `prompt_id` stored as `job_id`
  - `running` — ComfyUI status reports in-progress (first non-submitted fetch)
  - `completed` — ComfyUI reports completed **AND** outputs downloaded to disk (D-GEN-25)
  - `failed` — ComfyUI reports failed, OR download failed after retries, OR D-GEN-22 timeout tripped, OR workflow format validation failed pre-submit
- **D-GEN-19:** New error column on `versions`: `error_code TEXT NULL` + `error_message TEXT NULL`. Nullable; populated only on `failed`. Phase 1 schema add — requires a `drizzle-kit generate` migration for this phase (Phase 1 D-09 noted migrations become mandatory at first schema change). Also add `outputs_json TEXT NULL` (JSON array of `{filename, path, url, content_type, size_bytes}`) populated on `completed`.
- **D-GEN-20:** `completed_at` is set exactly once when status transitions to `completed` OR `failed`. Immutable thereafter (enforced by WHERE clause `completed_at IS NULL` on the update).

### ComfyUI Client & API Integration (GEN-01, GEN-05, GEN-06, GEN-07)

- **D-GEN-21:** ComfyUI client lives in `src/comfyui/client.ts` (zero MCP imports, zero DB imports — pure HTTP over `fetch`). Wraps four endpoints for Phase 2: `POST /api/prompt`, `GET /api/job/{prompt_id}/status`, `GET /api/view` (with 302 redirect follow via `fetch`'s native redirect mode `'follow'` validated against the configured `COMFYUI_API_BASE` + the approved host list). Auth header: `X-API-Key: ${COMFYUI_API_KEY}` on every request.
- **D-GEN-22:** Redirect safety (Pitfall Integration Gotcha): `fetch` follows 302 redirects automatically, but the client validates the post-redirect URL resolves to one of: `cloud.comfy.org`, `storage.googleapis.com/comfy-*` (ComfyUI Cloud signed URL host pattern — permissive default, widen after first live-smoke), or a host matching the `COMFYUI_API_BASE` origin. Unknown redirect target → `COMFYUI_API_ERROR` with message `"Unexpected redirect host: ${host}"`. Prevents SSRF. Allowlist overridable via `COMFYUI_ALLOWED_REDIRECT_HOSTS` env var (comma-separated) for demo-rig flexibility.
- **D-GEN-23:** Workflow format validation lives in `src/comfyui/format.ts`. Detection heuristic (run before submit; order of checks):
  1. If payload has top-level keys `nodes` (array), `links` (array), `groups` (array), or `last_node_id` (number) → **UI format** → reject `INVALID_WORKFLOW_FORMAT` with hint `"Export the workflow with 'Dev Mode > Save (API Format)' enabled in ComfyUI. API format uses numeric string keys (\"1\", \"2\", ...) with class_type/inputs per node."`.
  2. If payload is a plain object whose keys are numeric strings (`/^\d+$/`) and each value has `class_type` (string) and `inputs` (object) → **API format** → accept.
  3. Anything else → `INVALID_WORKFLOW_FORMAT` with a generic hint.
  Validation happens in the engine (not the tool) so the adapter / future REST surface gets the same guard.
- **D-GEN-24:** Exponential backoff (GEN-07 · Pitfall #4): schedule `[2s, 4s, 8s, 16s, 30s, 30s, ...]` capped at **30s**, reset per-job. Applied by the **on-start recovery poller** (D-GEN-28). On-demand `status` calls (D-GEN-07) bypass backoff — the agent's own call pace is the rate limiter. `src/engine/backoff.ts` encapsulates the sequence as a pure generator so Phase 3 can reuse.
- **D-GEN-25:** Timeout: 10 minutes from version `created_at`. Enforced during status fetch — if the version is still `submitted|running` and `now - created_at > 600_000 ms`, transition to `failed` with `error_code='GENERATION_TIMEOUT'`. Matches Pitfall #4 default. Overridable per-project later (see Deferred Ideas).
- **D-GEN-26:** ComfyUI 429 (rate limit) passes through as typed `COMFYUI_RATE_LIMITED` with hint `"ComfyUI concurrency limit reached (Free: 1, Creator: 3, Pro: 5 concurrent jobs). Wait for an in-flight generation to complete and retry."` — surface the truth, don't enforce locally in Phase 2 (deferred to v2 ROUTE-* when multi-backend lands).
- **D-GEN-27:** ComfyUI error translation (UX Pitfall): when the status response contains `{error: {node_errors: {nodeId: {...}}}}`, the client flattens the first `node_errors` entry into a readable sentence `"Node ${nodeId} (${class_type}): ${first_error_message}"`. Stored as `versions.error_message`. Raw ComfyUI error object is kept in memory for Phase 3's provenance capture but not persisted in Phase 2.

### Polling Model (GEN-07)

- **D-GEN-28:** Polling strategy is **hybrid** (Pitfall #4): (a) every `action: status` call for a non-terminal version fetches fresh from ComfyUI and persists the result inside the same engine call (write transaction); (b) on server start, a one-shot **recovery poller** enumerates versions with `status IN ('submitted','running')` and drives each to terminal or timeout using D-GEN-24 backoff. No continuous background loop when no jobs are pending.
- **D-GEN-29:** Recovery poller starts inside `Engine.start()` (new method). It runs as an async, unreferenced `setInterval`-style task per pending version, using the D-GEN-24 backoff sequence. Shutdown-aware: on server stop (SIGINT / SIGTERM / process exit), all pending polls are cancelled (AbortController per poll).
- **D-GEN-30:** Stdio-mode caveat: when the transport is stdio only, a long-lived server process is still expected (MCP clients keep the connection open). Recovery poller works the same. If the agent disconnects immediately after submit, the server process exits — pending jobs remain in the DB and resume on the next server start.
- **D-GEN-31:** Terminal states are never re-polled. Once `completed|failed`, cached DB state is returned without an API roundtrip (D-GEN-07 confirms this).

### Output Download & Disk Layout (GEN-04)

- **D-GEN-32:** On ComfyUI terminal-completion, the client downloads all outputs listed in the status response. Only once every output file is persisted to disk is the version transitioned to `status='completed'`. Matches Pitfall "Looks Done But Isn't" Checklist item (output download + redirect handling).
- **D-GEN-33:** On-disk path template: `./outputs/{project.name}/{sequence.name}/{shot.name}/{version_label}/{filename}` where `filename` preserves the original name from ComfyUI's response (e.g. `ComfyUI_00001_.png`). Directories created with `fs.mkdir({ recursive: true })`. Project / sequence / shot / version names used verbatim per Phase 1 D-14 (no slugification in Phase 2). If a component contains filesystem-unsafe characters for the host OS, that's a Phase 3 concern — Phase 2 assumes names are already fs-safe (the demo-scope constraint).
- **D-GEN-34:** Output-path root: fixed to `./outputs/` relative to server CWD. No CLI flag in Phase 2 (preserves Phase 1 5-flag contract). Configurable output root deferred to a future phase — see Deferred Ideas.
- **D-GEN-35:** Filename collision handling: if `{filename}` already exists at the target path (rare because version directory is freshly created), suffix with `_1`, `_2`, ... before the extension — match Phase 1 D-14 "UNIQUE → suffix increment" pattern. Log the rename to stderr.
- **D-GEN-36:** Download retry policy: 3 attempts with backoff `2s/4s/8s` per file. If any file ultimately fails, transition the version to `status='failed'`, `error_code='DOWNLOAD_FAILED'`, `error_message='Failed to download output <filename> after 3 attempts'`. Previously-downloaded files in the version directory remain (debug artifact); Phase 3 provenance records the partial attempt. Rationale: "completed" must mean "the artist can open the file" (D-GEN-25 decision).
- **D-GEN-37:** `outputs_json` (D-GEN-19) shape on completion: JSON array of `{filename, path, url, content_type, size_bytes}` where `path` is the POSIX-style relative path under `./outputs/...`, `url` is the original ComfyUI signed URL (captured for audit, expires per ComfyUI policy), `size_bytes` is a number (bytes on disk).

### Schema Change (first migration in the project)

- **D-GEN-38:** Phase 2 is the first phase that requires a `versions` schema change (`error_code`, `error_message`, `outputs_json` columns added). Phase 1 D-09 already provisioned `drizzle-kit generate` for first-schema-change path. Migration file named `0001_phase2_version_lifecycle.sql`. Runner applies migrations on server start (idempotent via `user_version` pragma — Phase 1 Pitfall #10 follow-through).
- **D-GEN-39:** Migration is additive only (new nullable columns). No data backfill needed — Phase 1 committed zero version rows (D-10).

### Error Surface (TOOL-05, extends Phase 1 D-28..D-32)

- **D-GEN-40:** New typed error codes reserved for Phase 2 (SCREAMING_SNAKE_CASE):
  - `COMFYUI_CREDENTIALS_MISSING` — hint points at `.env.example`
  - `INVALID_WORKFLOW_FORMAT` — hint shows how to export API format from ComfyUI
  - `COMFYUI_API_ERROR` — for 4xx/5xx that don't map to more specific codes; includes HTTP status in the message
  - `COMFYUI_RATE_LIMITED` — 429 passthrough with tier hint
  - `GENERATION_TIMEOUT` — 10-min ceiling tripped
  - `DOWNLOAD_FAILED` — outputs unreachable after retries
  - `VERSION_NOT_FOUND` — when `action: status` references an unknown `version_id`
  - `CONCURRENT_SUBMIT_CONFLICT` — UNIQUE(shot_id, version_number) retry exhausted (rare)
- **D-GEN-41:** All Phase 2 errors follow Phase 1 D-28..D-32: `{isError: true, structuredContent: {code, message, hint?}}`, Zod validation failures re-wrapped as `INVALID_INPUT`, no raw ComfyUI error objects leak to the agent.

### Testing Strategy

- **D-GEN-42:** Test layers and what each covers:
  1. **Unit — format detection** (`src/comfyui/__tests__/format.test.ts`): UI-format rejection, API-format acceptance, edge cases (empty object, arrays, nested mixed).
  2. **Unit — backoff** (`src/engine/__tests__/backoff.test.ts`): sequence, cap, reset semantics.
  3. **Unit — version-repo** (`src/store/__tests__/version-repo.test.ts`): allocation monotonicity, UNIQUE conflict retry, state transition rules (no regressions, no completed→running, completed_at immutability).
  4. **Unit — engine generation** (`src/engine/__tests__/generation.test.ts`): submit path, status transitions, timeout tripping, download retry, disk-path construction. Uses a **fake ComfyUI client** injected into Engine (pattern matches Phase 1 `fake-engine.ts`).
  5. **Integration — tool envelope** (`src/tools/__tests__/generation-tool.test.ts`): Zod validation, action discrimination, breadcrumb on every response, error wrapping.
  6. **Cross-cutting** (extend Phase 1 suites): `architecture-purity.test.ts` asserts `src/comfyui/` has zero MCP imports; `tool-budget.test.ts` updated from 4 → 5 tools; `stdio-hygiene.test.ts` asserts no `COMFYUI_API_KEY=` appears on stdout/stderr.
  7. **Live smoke** (`src/comfyui/__tests__/live-smoke.test.ts`): gated on `process.env.COMFYUI_API_KEY` presence — skips cleanly in CI without the key. Submits a minimal cheap workflow (Phase 2 picks the cheapest one-step workflow documented in ComfyUI Cloud's reference), polls via the real hybrid strategy, asserts `completed` + output file exists on disk. Cleanup: deletes the downloaded file and the DB row. This is the first honest "does it work end-to-end against the live API" check and replaces any human-UAT wire-level item (per memory: "don't punt on tests").

### Claude's Discretion

- **Backoff helper signature** — `createBackoffIterator(): AsyncGenerator<number>` emitting `[2000, 4000, 8000, 16000, 30000, 30000, ...]`. Exact control-flow shape is an implementation detail for the planner.
- **Jobs table** — Not added in Phase 2. `versions.status` + `versions.job_id` + `versions.completed_at` + `error_code`/`error_message`/`outputs_json` cover the whole lifecycle. If Phase 3/4 needs per-submission granularity (e.g. retries), a `jobs` table or a dedicated `provenance` table (Phase 3) becomes the home.
- **Fetch client** — Native `fetch` (Node 20+). No `undici` / `node-fetch` dep.
- **Concurrency limiting** — None enforced locally in Phase 2. The free-tier 1-job cap is surfaced via `COMFYUI_RATE_LIMITED` when it trips. A local queue is a v2 concern (ROUTE-*).
- **Progress extraction** — Read whatever the Cloud API's job-status response exposes (may be `progress: 0-1`, `current_node`, `executed`, or absent). Pass the most useful 0-1 float forward; when uncertain, leave `null`.
- **`outputs_json` parsing on read** — Tool responses parse `outputs_json` lazily; repo returns the string column. Saves a parse on list-heavy reads later.
- **Breadcrumb extension for version leaf** — `BreadcrumbResolver.resolve('version', versionId)` walks up from `versions → shots → sequences → projects → workspaces`. Engine extends `BreadcrumbResolver` (Phase 1 D-35); repo adds the `versions → shots` join method.
- **Schema migration tooling** — Use `drizzle-kit generate` to produce `0001_phase2_version_lifecycle.sql`. Runner is a tiny startup step that checks `user_version` pragma and applies newer migrations in order.
- **Dotenv timing** — `import 'dotenv/config'` at the very top of `src/server.ts` (before any relative imports that might read env). Engine code never reads `process.env` directly — credentials are passed into the ComfyUI client constructor at Engine wiring time.
- **ComfyUI API endpoint variants** — If the Cloud API exposes `/v1/prompt` or similar versioned paths by the time of implementation, use the documented versioned path as the default base URL suffix. The `.env` base URL is the whole origin, not origin+path.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor, checker) MUST read these before acting.**

### Prior phase context (hard dependency)

- `.planning/phases/01-foundation-hierarchy/01-CONTEXT.md` — All Phase 1 decisions (D-01..D-36) are load-bearing: tool naming, error codes, envelope, tool-engine separation, SQLite pragmas, CLI contract, breadcrumb model
- `.planning/phases/01-foundation-hierarchy/01-PLAN.md` through `01-03-PLAN.md` — Plan artifacts that show how Phase 1 decisions landed in code
- `.planning/phases/01-foundation-hierarchy/01-PATTERNS.md` — Established patterns Phase 2 must reuse (tool shape, envelope, error wrapping, repo shape)

### Project research (MUST read — locks macro decisions)

- `.planning/research/SUMMARY.md` — Executive summary + critical risks
- `.planning/research/STACK.md` §"ComfyUI Cloud API Notes" — Endpoints, auth header, concurrency tiers, experimental-API warning. Locks HTTP-client libs (native `fetch`, no `node-fetch`).
- `.planning/research/ARCHITECTURE.md` §"Pattern 4: ComfyUI Job Lifecycle Bridge" + §"Generation Request Flow" + §"Database Schema" — Architectural pattern, end-to-end data flow (submit → poll → download → persist), and the target provenance/jobs schema Phase 2 partially implements
- `.planning/research/PITFALLS.md` — Pitfall #2 (UI vs API format — D-GEN-23), #3 (Provenance gaps — Phase 3 concern, shapes what Phase 2 must capture), #4 (Polling loop — D-GEN-24, D-GEN-25, D-GEN-28), #6 (SQLite WAL — already satisfied Phase 1), "Integration Gotchas" (302 redirect follow — D-GEN-22), "Looks Done But Isn't" Checklist (format validation, output download, redirect handling, timeout, concurrent access)
- `.planning/research/FEATURES.md` — Feature landscape; confirms async submit + status is the standard async-gen pattern

### Project instructions

- `CLAUDE.md` — Project conventions: **"Prompt blob is truth"** (the ComfyUI prompt blob contains resolved seeds and actual model paths — Phase 2 stores `job_id`; Phase 3 captures the prompt blob itself), **async generation** rule (submit returns immediately), **exponential backoff** rule (D-GEN-24), nanoid IDs, VFX version naming (D-GEN-17), error responses "human-readable with actionable guidance" (D-GEN-40), never-raw-JSON responses
- `.planning/PROJECT.md` — Vision, ComfyUI Cloud as the API target (not local), open-protocol (MCP) commitment
- `.planning/REQUIREMENTS.md` — GEN-01..GEN-07 definitions in full (Phase 2 scope). PROV-01..PROV-06 define Phase 3 scope that Phase 2 must not preempt
- `.planning/ROADMAP.md` §"Phase 2: ComfyUI Generation" — Goal statement + five success criteria (non-blocking submit, status progression, auto-versioning, format rejection, backoff-not-burn)
- `.planning/STATE.md` — Accumulated decisions from Phase 1 plans (note particularly the "Concerns" section flagging that live API access + model checksum availability need confirmation in Phase 2)

### External specs (must be honored during implementation)

- **ComfyUI Cloud API overview** — https://docs.comfy.org/development/cloud/overview (experimental status, auth pattern)
- **ComfyUI Cloud API reference** — https://docs.comfy.org/development/cloud/api-reference (endpoints: `POST /api/prompt`, `GET /api/job/{id}/status`, `GET /api/view`, concurrency tiers)
- **ComfyUI API vs UI format canonical issue** — https://github.com/comfyanonymous/ComfyUI/issues/1335 (reference for D-GEN-23 detection heuristic)
- **MCP TypeScript SDK** — https://github.com/modelcontextprotocol/typescript-sdk (v1.29 — Phase 1 already locks version; no SDK changes expected in Phase 2)
- **MCP Streamable HTTP transport spec** — https://modelcontextprotocol.io/specification/2025-03-26/basic/transports (no new transport concerns in Phase 2; both transports reuse the same tool)
- **Two JSON Blobs inside ComfyUI PNGs** — https://www.numonic.ai/blog/ai-dam-comfyui-two-json-blobs (background for why Phase 3 will capture both; Phase 2 only stores the submitted workflow JSON, not extracted prompt blob)

### Project credentials

- `.env` at repo root (gitignored, chmod 600) — `COMFYUI_API_KEY`, `COMFYUI_API_BASE`. **Never echo, never commit, never log the value.** See memory: `reference_env_comfyui_key.md`.
- `.env.example` to be added in Phase 2 with placeholder values and commentary.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (Phase 1 artefacts Phase 2 builds on)

- **`src/engine/pipeline.ts` — `Engine` class.** Phase 2 extends this class with `submitGeneration(shotId, workflowJson, notes?)` and `getGenerationStatus(versionId)` methods, plus an `Engine.start()` that kicks the recovery poller. Alternative: move generation ops to `src/engine/generation.ts` and have `Engine` compose both — planner's call, but the facade stays `Engine`.
- **`src/engine/breadcrumb.ts` — `BreadcrumbResolver`.** Extend with a `'version'` type case that walks `versions → shots → sequences → projects → workspaces` and renders `ws > proj > seq > shot > v001`. The integer → `v###` render is centralised via the D-GEN-17 helper.
- **`src/engine/errors.ts` — `TypedError`.** Reused verbatim. Phase 2 just adds new string literal codes (D-GEN-40).
- **`src/store/hierarchy-repo.ts` — `HierarchyRepo`.** Phase 2 adds a `VersionRepo` alongside (separate file for clarity) or extends in place. Prepared-statement pattern and plain-object return shape are Phase 1 conventions.
- **`src/store/schema.ts` — `versions` table already declared.** Phase 2 adds nullable columns (`error_code`, `error_message`, `outputs_json`) via the first drizzle-kit migration of the project.
- **`src/store/db.ts` — `openDb()` + SQLite WAL pragmas.** No changes needed; add the migration runner hook here.
- **`src/tools/shape.ts` — response envelope helpers (`toolOk`, `toolError`).** Reused directly by `generation-tool.ts`.
- **`src/tools/envelope.ts` — breadcrumb attachment helper.** Reused.
- **`src/test-utils/fake-engine.ts` — the Phase 1 fake Engine pattern.** Extend with generation-op fakes so tool-layer tests don't pull in a real ComfyUI client or DB.

### Established Patterns (Phase 2 must match)

- **Tool file shape** — Zod input schema, action discrimination, thin delegate to engine. `generation-tool.ts` mirrors `workspace-tool.ts` structure.
- **Repo shape** — `better-sqlite3` prepared statements, plain typed return objects, UNIQUE violation → typed error.
- **Engine shape** — constructor-injected repos and clients, zero MCP imports. `src/comfyui/client.ts` likewise has zero MCP and zero DB imports.
- **Response envelope** — `{ structuredContent, content: [text] }` dual-form with breadcrumb on every response (Phase 1 D-22..D-27).
- **Error wrapping** — typed code, no raw Zod / SQLite / ComfyUI errors surfaced to the agent (D-28..D-32 + D-GEN-41).
- **Architecture-purity test** — `src/__tests__/architecture-purity.test.ts` greps for forbidden imports. Extend to assert `src/comfyui/**` has zero `@modelcontextprotocol/sdk` imports and zero `better-sqlite3`/`drizzle` imports.
- **Tool-budget test** — `src/__tests__/tool-budget.test.ts` counts `registerTool` calls in `src/tools/`. Expected count bumps from 4 → 5.

### Integration Points

- **`src/server.ts` — entry point.** Add `import 'dotenv/config'` at the very top (before any relative imports). Register `generation` tool via new `registerGeneration(server, engine)`. Call `engine.start()` after DB is open so the recovery poller picks up any pending versions from prior runs.
- **`src/tools/index.ts` — tool barrel.** Add `export { registerGeneration } from './generation-tool.js';`.
- **`src/tools/generation-tool.ts` — NEW.** MCP tool registration, Zod schemas, discriminated union on `action`, delegates to `engine.submitGeneration` / `engine.getGenerationStatus`. Breadcrumb enrichment via existing envelope helpers.
- **`src/engine/generation.ts` — NEW (or extend `pipeline.ts`).** Generation operations: submit path, status advance, disk download, timeout check. Imports `ComfyUIClient`, `VersionRepo`, `HierarchyRepo`, `BreadcrumbResolver`.
- **`src/engine/backoff.ts` — NEW.** Reusable exponential backoff generator (D-GEN-24). Pure function, zero dependencies.
- **`src/comfyui/client.ts` — NEW.** HTTP-only client. Exposes `submit(workflowJson) → {prompt_id}`, `status(prompt_id) → {state, progress, outputs?, error?}`, `download(signedUrl, destPath) → {bytes, contentType}`.
- **`src/comfyui/format.ts` — NEW.** `isApiFormat(unknown) → boolean`, `isUiFormat(unknown) → boolean`, `validateWorkflowFormat(unknown) → void | throws INVALID_WORKFLOW_FORMAT`.
- **`src/comfyui/types.ts` — NEW.** API request/response TypeScript types (narrow, not a full SDK).
- **`src/utils/outputs.ts` — NEW.** Disk-path builder: `buildOutputPath({workspace, project, sequence, shot, versionLabel, filename}) → string`. Filesystem helpers (mkdir recursive, collision-suffix).
- **`src/store/version-repo.ts` — NEW.** Versions CRUD with state-transition guards (D-GEN-18, D-GEN-20). Prepared statements, plain-object returns, typed errors on UNIQUE/FK violations.
- **`drizzle/0001_phase2_version_lifecycle.sql` — NEW migration.** Adds `error_code`, `error_message`, `outputs_json` nullable columns on `versions`.
- **`.env.example` — NEW.** Placeholder for `COMFYUI_API_KEY` + `COMFYUI_API_BASE` with commentary. Committed. Real `.env` stays gitignored.

### Build Order (Phase 2 subset — respects Phase 1 layering)

```
1. drizzle/0001_phase2_version_lifecycle.sql + migration runner hook in store/db.ts
2. src/store/version-repo.ts                       (depends on schema, typed errors)
3. src/engine/backoff.ts                           (pure helper, no deps)
4. src/comfyui/types.ts                            (types only, no deps)
5. src/comfyui/format.ts                           (pure helpers, depends on typed errors)
6. src/comfyui/client.ts                           (depends on types + format + typed errors)
7. src/utils/outputs.ts                            (filesystem helpers, no MCP deps)
8. src/engine/breadcrumb.ts                        (extend for 'version' leaf)
9. src/engine/generation.ts or extend pipeline.ts  (depends on version-repo, ComfyUI client, breadcrumb, backoff, outputs)
10. src/tools/generation-tool.ts                   (depends on engine, shape, envelope)
11. src/tools/index.ts                             (barrel export)
12. src/server.ts                                  (dotenv, registerGeneration, engine.start())
13. Tests (unit first, then tool, then cross-cutting, then live-smoke)
```

</code_context>

<specifics>
## Specific Values (reproduce verbatim)

- **Tool name:** `generation` (lowercase, noun, snake_case, no prefix)
- **Action values:** `"submit"`, `"status"` (lowercase strings, discriminated union)
- **Env var names:** `COMFYUI_API_KEY`, `COMFYUI_API_BASE`
- **Default base URL:** `https://cloud.comfy.org` (no trailing slash)
- **Auth header:** `X-API-Key: ${COMFYUI_API_KEY}`
- **Version label format:** `v` + zero-padded integer, min 3 digits (`v001`, `v002`, ..., `v999`, `v1000`)
- **Version state machine:** `'submitted' | 'running' | 'completed' | 'failed'` (one-way; no rollback)
- **Error codes:** `COMFYUI_CREDENTIALS_MISSING`, `INVALID_WORKFLOW_FORMAT`, `COMFYUI_API_ERROR`, `COMFYUI_RATE_LIMITED`, `GENERATION_TIMEOUT`, `DOWNLOAD_FAILED`, `VERSION_NOT_FOUND`, `CONCURRENT_SUBMIT_CONFLICT` (all SCREAMING_SNAKE_CASE)
- **Backoff schedule:** `[2000, 4000, 8000, 16000, 30000, 30000, ...]` ms (cap at 30s, reset per job)
- **Generation timeout:** 600_000 ms (10 minutes)
- **Download retries:** 3 attempts, backoff `[2000, 4000, 8000]` ms per file
- **Output path template:** `./outputs/{project.name}/{sequence.name}/{shot.name}/{version_label}/{filename}`
- **Key-log format:** `ComfyUI credentials loaded (key ****${last4}, base ${base})` (stderr only)
- **Migration file name:** `drizzle/0001_phase2_version_lifecycle.sql`
- **Schema additions on `versions`:** `error_code TEXT NULL`, `error_message TEXT NULL`, `outputs_json TEXT NULL` (all nullable)
- **Version number allocation SQL:** `SELECT COALESCE(MAX(version_number), 0) + 1 FROM versions WHERE shot_id = ?` (inside insert transaction)
- **Tool-budget invariant:** Phase 2 total tools = 5 of 12 (`workspace`, `project`, `sequence`, `shot`, `generation`)

</specifics>

<deferred>
## Deferred Ideas

Surfaced during discussion. Not in Phase 2 scope — preserved so they aren't lost.

- **Input-asset upload** — Workflows referencing `LoadImage` etc. need an upload path (`POST /api/upload/image`). Phase 2 assumes self-contained workflows. Add as an `action: upload_input` on `generation` or a dedicated tool when the first real workflow demands it. Phase 3+ likely.
- **Per-project output-path template override** — `./outputs/` root is hardcoded in Phase 2. Per-project override (via the existing `naming_template` column on `workspaces`/`projects` from Phase 1 D-09) ships when the first studio asks.
- **`--output-dir` CLI flag** — Phase 2 keeps Phase 1's 5-flag contract. Add if a user asks to store outputs elsewhere without editing `server.ts`.
- **Jobs table** — Not needed for Phase 2 (versions covers the lifecycle). A dedicated `jobs` table becomes useful when Phase 3 provenance needs per-attempt granularity, or when multi-backend routing (v2) needs its own work queue.
- **ComfyUI WebSocket progress** — HTTP polling is sufficient for Phase 2. WS (`/ws?clientId=...&token=...`) can later replace polling for smoother progress without changing the MCP tool surface.
- **Concurrency / queue enforcement** — Local queue that respects ComfyUI's per-tier concurrency limit (Free 1 / Creator 3 / Pro 5) is a v2 ROUTE-* concern. Phase 2 passes through 429 as `COMFYUI_RATE_LIMITED`.
- **Multi-backend routing** (ROUTE-01..03) — Tracked in REQUIREMENTS.md v2.
- **Webhook notifications** (ADV-02) — v2.
- **Batch submit** (ADV-01) — v2.
- **Provenance capture** (PROV-01..06) — Phase 3 by design. Phase 2 stores `job_id` + output URLs/paths; Phase 3 captures the prompt blob, model checksums, seed-from-prompt, and enables diff / reproduce / iterate.
- **Per-project timeout override** — 10-min timeout is hardcoded. Per-project config deferred until a workflow justifies it (e.g. long video gen).
- **Slugification / fs-safe name transformation** — Phase 2 uses names verbatim per Phase 1 D-14. A separate slug pass ships when a real user name contains fs-unsafe characters.
- **Update / cancel actions on versions** — Phase 2 is create-only on versions (matches Phase 1 create-only hierarchy). Cancel-mid-flight (`POST /api/job/{id}/cancel` if it exists) is a later UX improvement.
- **ComfyUI model checksum verification** — Cloud API may not expose model hashes; Phase 2 stores model names implicit in the workflow. Phase 3 will attempt best-effort hash capture and honestly flag when unavailable.
- **Structured logger** — Phase 1 deferred `pino`; same call holds. Phase 2 stderr logging is still `console.error`.
- **Output thumbnails** — Phase 5 dashboard may want them. Generate on completion? Lazy? Out of scope for Phase 2.

</deferred>

---

*Phase: 02-comfyui-generation*
*Context gathered: 2026-04-20 via /gsd-discuss-phase*
