# Phase 2: ComfyUI Generation - Research

**Researched:** 2026-04-20
**Domain:** ComfyUI Cloud API integration + async generation lifecycle + on-disk outputs + first Drizzle migration
**Confidence:** HIGH (core endpoints, migration runner, node_errors shape CITED from official sources) / MEDIUM (signed URL host pattern, 429 shape)

## Summary

Phase 2 extends the Phase 1 hierarchy with a **single** MCP tool (`generation`) that submits ComfyUI API-format workflows to the Cloud API, records an immediately-created `version` row under a shot, and drives the row's `submitted → running → completed | failed` state machine via a hybrid polling strategy (on-demand fetch + on-start recovery poller). On terminal completion the client downloads all outputs to `./outputs/{project}/{sequence}/{shot}/v###/{filename}`, and only then flips status to `completed`. All 42 CONTEXT.md decisions (D-GEN-01..D-GEN-42) are locked; this research fills *how* to satisfy them without reopening them.

The critical finding: **CONTEXT.md's D-GEN-11 default base URL `https://api.comfy.org` is incorrect** per official docs — the canonical Cloud base URL is `https://cloud.comfy.org`. The planner should treat D-GEN-11 as a user-facing override default (`.env` is authoritative) and use the correct base in code comments, `.env.example`, and the startup log. This is the single surfaced ambiguity between CONTEXT.md and external specs.

Everything else — validate-then-submit flow, exponential backoff, 302 follow with host allowlist, download retries, `outputs_json` structure, `drizzle-kit` migration runner — maps cleanly to CONTEXT.md's locked shape. The ComfyUI `node_errors` object has a documented verbatim structure (`{node_id: {errors: [{type, message, details}], dependent_outputs, class_type}}`), so D-GEN-27's extractor can be specified exactly. Drizzle's own `__drizzle_migrations` table is the idempotency anchor for the migration runner — no `user_version` bump needed beyond the Phase-1 baseline; migrations layer cleanly on top.

**Primary recommendation:** Wire `migrate()` from `drizzle-orm/better-sqlite3/migrator` **inside `openDb()` immediately after pragma init**, place `drizzle/0001_phase2_version_lifecycle.sql` at `drizzle/0001_*.sql`, and never touch `user_version` again from Phase 2 forward — Drizzle's own ledger handles phase additions. Correct the base-URL default to `https://cloud.comfy.org` in `.env.example` (the D-GEN-11 `api.comfy.org` value is a documented error; the `.env` file is authoritative at runtime and the planner should surface this in a plan-level note).

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-GEN-01:** Tool name `generation` (snake_case noun). **D-GEN-02:** `action: 'submit' | 'status'` discriminated union. **D-GEN-03:** Phase 2 budget = 1 tool, running total 5 of 12. **D-GEN-04:** `submit` input = `{action, shot_id, workflow_json, notes?}`. **D-GEN-05:** `submit` response = full version + breadcrumb. **D-GEN-06:** `status` input = `{action, version_id}`. **D-GEN-07:** `status` response includes `progress: number | null`, `error: string | null`, `completed_at`. **D-GEN-08:** Tool description names API format explicitly.
- **D-GEN-09:** Credentials via `.env` + `dotenv`. **D-GEN-10:** Enforced at submit-time only. **D-GEN-11:** Default `COMFYUI_API_BASE = https://api.comfy.org` (see discrepancy note below). **D-GEN-12:** Log `ComfyUI credentials loaded (key ****${last4}, base ${base})` — stderr, presence-only. **D-GEN-13:** No new CLI flag. **D-GEN-14:** Silent if `.env` missing.
- **D-GEN-15:** Version row written at submit-time with `status='submitted'`. **D-GEN-16:** `SELECT COALESCE(MAX(version_number),0)+1 FROM versions WHERE shot_id=?` inside insert transaction; retry once on UNIQUE → `CONCURRENT_SUBMIT_CONFLICT`. **D-GEN-17:** `versionLabel(n) = 'v' + String(n).padStart(3,'0')`. **D-GEN-18:** State machine `submitted → running → completed | failed`, one-way. **D-GEN-19:** Add `error_code TEXT NULL`, `error_message TEXT NULL`, `outputs_json TEXT NULL` on `versions`. **D-GEN-20:** `completed_at` set exactly once (update guarded by `WHERE completed_at IS NULL`).
- **D-GEN-21:** `src/comfyui/client.ts` — zero MCP, zero DB imports. Wraps `POST /api/prompt`, `GET /api/job/{id}/status`, `GET /api/view`. `X-API-Key` on every request. **D-GEN-22:** 302 follow via native fetch; validate post-redirect host against an allowlist. Unknown host → `COMFYUI_API_ERROR`. **D-GEN-23:** `src/comfyui/format.ts` detection heuristic — UI-format first (reject), then API-format check, else generic reject. Lives in engine. **D-GEN-24:** Backoff `[2s, 4s, 8s, 16s, 30s, 30s, ...]` via pure generator in `src/engine/backoff.ts`. **D-GEN-25:** 10-minute timeout → `GENERATION_TIMEOUT`. **D-GEN-26:** 429 → typed `COMFYUI_RATE_LIMITED` with tier hint. **D-GEN-27:** Error translation: flatten first `node_errors` entry into `"Node ${nodeId} (${class_type}): ${first_error_message}"`.
- **D-GEN-28:** Hybrid polling: (a) each `status` call fresh-fetches for non-terminal rows; (b) on-start recovery poller runs once at boot per pending row. **D-GEN-29:** `Engine.start()` kicks the poller; AbortController per pending version; shutdown-aware (SIGINT/SIGTERM). **D-GEN-30:** Stdio mode works the same — pending rows resume on next boot if agent disconnects. **D-GEN-31:** Terminal rows never re-polled.
- **D-GEN-32:** Transition to `completed` ONLY after all outputs persisted on disk. **D-GEN-33:** Path `./outputs/{project.name}/{sequence.name}/{shot.name}/{version_label}/{filename}`. **D-GEN-34:** Root fixed to `./outputs/`. **D-GEN-35:** Collision → suffix `_1`, `_2`, .... **D-GEN-36:** 3 download retries with `[2s,4s,8s]`; give up → `DOWNLOAD_FAILED`. **D-GEN-37:** `outputs_json` = JSON array of `{filename, path, url, content_type, size_bytes}`.
- **D-GEN-38:** First drizzle-kit-generated migration `drizzle/0001_phase2_version_lifecycle.sql`; runner applies on server start. **D-GEN-39:** Additive only; no backfill (Phase 1 committed zero version rows).
- **D-GEN-40:** New error codes: `COMFYUI_CREDENTIALS_MISSING`, `INVALID_WORKFLOW_FORMAT`, `COMFYUI_API_ERROR`, `COMFYUI_RATE_LIMITED`, `GENERATION_TIMEOUT`, `DOWNLOAD_FAILED`, `VERSION_NOT_FOUND`, `CONCURRENT_SUBMIT_CONFLICT`. **D-GEN-41:** Same Phase 1 envelope; no raw ComfyUI errors leak.
- **D-GEN-42:** Seven test layers (unit × 4, integration × 1, cross-cutting × 1, live smoke × 1). The live smoke is gated on `COMFYUI_API_KEY` presence and replaces any wire-level human-UAT item.

### Claude's Discretion

- Backoff helper signature (`createBackoffIterator(): AsyncGenerator<number>` recommended)
- Jobs table (Phase 2: no)
- Fetch client (native `fetch`, no undici / node-fetch)
- Local concurrency limiting (Phase 2: no)
- Progress extraction specifics (read whatever the Cloud status response exposes; `null` when uncertain)
- `outputs_json` parsing strategy on read (lazy at tool layer)
- BreadcrumbResolver extension for the `version` leaf (`versions → shots → sequences → projects → workspaces`)
- Migration tooling (use `drizzle-kit generate`)
- Dotenv timing (`import 'dotenv/config'` at the top of `src/server.ts`)
- ComfyUI endpoint path variants (`.env` carries origin; path `/api/prompt` etc.)

### Deferred Ideas (OUT OF SCOPE)

Input-asset upload (`POST /api/upload/image`); per-project output-path override; `--output-dir` flag; dedicated `jobs` table; WebSocket progress; local concurrency queue; multi-backend routing; webhooks; batch submit; provenance capture (Phase 3); per-project timeout override; slug / fs-safe name transformation; update/cancel actions; model checksum verification; structured logger (`pino`); output thumbnails.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **GEN-01** | Agent can submit a ComfyUI workflow for generation within a shot context | `POST /api/prompt` returns `{prompt_id}` [CITED: docs.comfy.org/development/cloud/api-reference]; stored as `versions.job_id`; `X-API-Key` auth; shot_id is the FK anchor (existing Phase 1 table). Submit path delegates through `Engine.submitGeneration(shotId, workflowJson, notes?)`. |
| **GEN-02** | Submission returns immediately with a job ID (non-blocking) | `fetch POST` is a single HTTP round-trip (< 1s typical); version row inserted with `status='submitted'` **before** network call returns — but network happens inline, so submit blocks only until ComfyUI ACKs with the `prompt_id`. The lifecycle advance is async via recovery poller / on-demand status. [VERIFIED: ComfyUI Cloud API doc prescribes async pattern]. |
| **GEN-03** | Agent can check generation status by job ID | `action: status` input takes `version_id` (D-GEN-06), not the raw `job_id` — cleaner surface. Engine loads the row, checks terminal status, otherwise fetches `GET /api/job/{prompt_id}/status` [CITED], persists within the same transaction. |
| **GEN-04** | Completed generations automatically create a new version (never overwrites) | Version row inserted at submit-time (D-GEN-15). `UNIQUE(shot_id, version_number)` from Phase 1 schema guarantees no overwrite. Version number = `COALESCE(MAX,0)+1` inside insert txn (D-GEN-16). |
| **GEN-05** | Failed generations record error state with ComfyUI error message | `versions.error_code` + `versions.error_message` (new columns per D-GEN-19). ComfyUI 400 response = `{error, node_errors}` where `node_errors[nodeId] = {errors:[{type,message,details}], dependent_outputs, class_type}` [CITED: ComfyUI execution.py validate_prompt]. D-GEN-27 flattens first entry. |
| **GEN-06** | ComfyUI Cloud API client validates format (rejects UI-export JSON) | `src/comfyui/format.ts` detection heuristic per D-GEN-23. UI-format sentinel keys: `nodes` (array), `links` (array), `groups` (array), `last_node_id` (number). API-format: all top-level keys match `/^\d+$/` AND each value has `class_type: string` + `inputs: object`. [VERIFIED: ComfyUI basic_api_example.py]. |
| **GEN-07** | Client uses exponential backoff for internal polling (no quota burn) | `src/engine/backoff.ts` pure generator yields `[2000, 4000, 8000, 16000, 30000, 30000, ...]`. Applied by on-start recovery poller only (D-GEN-28); on-demand `status` calls bypass backoff — agent's call cadence is the rate limiter. Matches PITFALLS.md #4 prescription. |

## Architectural Responsibility Map

Phase 2 lives entirely in a **single-process Node server** with two MCP transports. No browser tier, no separate API service. But the Phase 2 surface spans four conceptual internal tiers — the map below is what the planner sanity-checks tasks against.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MCP tool boundary: Zod validation, action dispatch, envelope wrapping | Tools (`src/tools/`) | — | D-33 tool-engine purity; every agent-facing decision lives here |
| Workflow format detection | Engine (`src/comfyui/format.ts`) | — | D-GEN-23: engine so future REST adapter inherits the guard |
| HTTP to ComfyUI Cloud (submit, status, view) | HTTP client (`src/comfyui/client.ts`) | — | Zero MCP, zero DB imports (D-GEN-21); pure `fetch` over `X-API-Key` |
| Redirect safety / SSRF gate | HTTP client | — | `fetch` follows 302 natively; client inspects post-redirect URL origin |
| Version row state transitions | Engine (`src/engine/generation.ts` or `pipeline.ts`) | Store (`version-repo.ts`) | Engine owns state machine; repo owns the UPDATE with guard |
| Version number allocation | Store (`version-repo.ts`) | Engine | SQL-level `MAX+1` inside txn; engine retries once on UNIQUE |
| Backoff generator | Engine (`src/engine/backoff.ts`) | — | Pure, reusable; Phase 3 provenance can reuse |
| Recovery poller | Engine (`Engine.start()`) | HTTP client | Boot-time one-shot per pending row; AbortController per poll |
| Disk layout (breadcrumb → path) | Utils (`src/utils/outputs.ts`) | Engine | Pure path builder + mkdir recursive; no MCP, no DB |
| Download retries, collision suffix | HTTP client (`client.download`) | Utils | HTTP client is the I/O boundary; utils shape the destination path |
| Breadcrumb for version leaf | Engine (`breadcrumb.ts` extension) | Store | Extend Phase 1 `BreadcrumbResolver.resolve()` with `'version'` case |
| `outputs_json` persistence | Store (`version-repo.ts`) | Engine | Stored as JSON TEXT; tool parses lazily |
| `.env` / credential wiring | server.ts entry | — | `import 'dotenv/config'` at top; engine never reads `process.env` |
| Migration execution | Store (`db.ts`) | — | `migrate()` call inside `openDb()` after pragma init, before Drizzle handle returned |
| Test doubles | test-utils (`fake-engine.ts` extension, new `fake-comfyui-client.ts`) | — | Mirrors Phase 1 pattern; tool-layer tests never spin a real HTTP client |

## Standard Stack

### Core

All libraries are already installed from Phase 1. The additions for Phase 2 are one new runtime dep (`dotenv`) — and zero new test deps.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 (installed) | Tool registration + transports | [VERIFIED: package.json] Phase 1 lock; no SDK change for Phase 2 |
| `better-sqlite3` | ^12.9.0 (installed) | Sync SQLite driver | [VERIFIED: npm view → 12.9.0] Already in use; matches Phase 1 WAL init |
| `drizzle-orm` | ^0.45.2 (installed) | Typed query builder | [VERIFIED: npm view → 0.45.2] Provides `migrate()` runner in `drizzle-orm/better-sqlite3/migrator` [VERIFIED: node_modules/drizzle-orm/better-sqlite3/migrator.js exists] |
| `drizzle-kit` | ^0.31.10 (installed, dev) | Migration generator | [VERIFIED: package.json] CLI: `drizzle-kit generate --dialect sqlite --schema src/store/schema.ts --out ./drizzle` [CITED: orm.drizzle.team/docs/drizzle-kit-generate] |
| `zod` | ^4.3.6 (installed) | Input validation | Phase 1 lock; `z.record(z.string(), z.unknown())` for `workflow_json` |
| `nanoid` | ^5.1.9 (installed) | ID generation | [VERIFIED: npm view → 5.1.9] Used via Phase 1's `newId('ver')` for `versions.id` |
| Native `fetch` | Node ≥ 20 | HTTP client | [CLAUDE's Discretion per CONTEXT.md] No undici/node-fetch dep; native `fetch` supports `redirect: 'follow'`, `AbortController`, and web-stream bodies |
| `node:fs/promises` + `node:stream` | Built-in | Streaming output downloads | `Readable.fromWeb(response.body).pipe(createWriteStream(...))` with `stream/promises.pipeline()` for error-safe teardown [CITED: nodejs.org/api/stream.html] |

### Supporting (NEW in Phase 2)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `dotenv` | ^17.4.2 | `.env` loading | [VERIFIED: npm view → 17.4.2 published recent] Side-effect import `import 'dotenv/config'` at the very top of `src/server.ts`. Must be first import line — module hoisting in Node ESM evaluates imports before top-level code [CITED: nodejs.org + dotenv README]. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native `fetch` | `undici` | Direct feature parity with Node 20+ built-in; extra dep for zero gain. Use `fetch` as CONTEXT.md prescribes. |
| `dotenv` | `envfile` / `dotenvx` / custom parser | 17.x dotenv is the ecosystem standard, 100M+ weekly dl, supports `.env` + multi-file. No need for enhanced dotenv features in Phase 2. |
| Drizzle migration runner | Hand-rolled `user_version` compare + `sqlite.exec(SCHEMA_DDL)` | Phase 1 used the hand-rolled path. Phase 2 needs a real ALTER TABLE flow — Drizzle's `migrate()` handles the versioning ledger via `__drizzle_migrations` table [CITED: drizzle changelogs/drizzle-orm/0.29.5.md]. Switching paths at first schema change is the intended Phase-1 plan. |
| Polling via `setInterval` | `setTimeout` chain per job | `setInterval` is correct-by-default but fires regardless of network latency; `setTimeout` self-chains after each roundtrip, yielding cleaner backoff semantics. Recommend self-chaining (see D-GEN-29 `AbortController` integration below). |

**Installation (deltas from Phase 1 only):**
```bash
npm install dotenv@^17.4.2
```

**Version verification (executed 2026-04-20):**
```bash
$ npm view dotenv version         # 17.4.2
$ npm view better-sqlite3 version # 12.9.0 (already installed)
$ npm view drizzle-kit version    # 0.31.10 (already installed)
$ npm view drizzle-orm version    # 0.45.2 (already installed)
$ npm view nanoid version         # 5.1.9 (already installed)
```

## Architecture Patterns

### System Architecture Diagram

```
                    ┌───────────────────┐
 MCP agent  ──JSON-RPC──▶ generation tool  (src/tools/generation-tool.ts)
                    │  Zod gate + action    
                    │  { submit | status }  
                    └─────────┬─────────┘
                              │  engine.submitGeneration / getGenerationStatus
                              ▼
                   ┌──────────────────────────────────┐
                   │ Engine.generation (pipeline ext) │
                   │  • format.validate()             │
                   │  • txn: resolve breadcrumb,      │
                   │    allocate v###, insert row     │
                   │  • submit via ComfyUIClient      │
                   │  • persist job_id                │
                   │  • breadcrumb({type:'version'})  │
                   └──────┬───────────────┬───────────┘
                          │               │
                          ▼               ▼
             ┌───────────────────┐  ┌────────────────────┐
             │  ComfyUIClient    │  │ VersionRepo        │
             │  (fetch, no DB)   │  │ • allocate v###    │
             │                   │  │ • state updates    │
             │ POST /api/prompt  │  │ • guard            │
             │ GET  /api/job/{}/ │  │   completed_at     │
             │      status      │  │   IS NULL          │
             │ GET  /api/view    │  │ • outputs_json     │
             │    (302 follow,  │  │                    │
             │     host gate)    │  └─────────┬──────────┘
             └───────┬───────────┘            │
                     │                        │
                     ▼                        ▼
         ┌───────────────────────┐   ┌───────────────────┐
         │  ComfyUI Cloud API    │   │  SQLite (WAL)     │
         │  https://cloud.comfy  │   │  vfx-familiar.db  │
         │       .org            │   └───────────────────┘
         └───────┬───────────────┘
                 │ 302 Location: signed URL
                 ▼
         ┌──────────────────────┐
         │  Cloud object store  │
         │  (signed-URL host)   │   stream to
         └───────┬──────────────┘   ./outputs/{proj}/{seq}/{shot}/v###/
                 │                  via Readable.fromWeb + createWriteStream
                 ▼
         ┌──────────────────────┐
         │  Local disk          │
         └──────────────────────┘

  Boot:  server.ts ──▶ openDb() [pragmas, migrate()] ──▶ Engine.start() ──▶
         recovery poller enumerates versions WHERE status IN ('submitted','running'),
         drives each via [2,4,8,16,30,30,...]s backoff until terminal or 10-min timeout.
         AbortController per poll; SIGINT/SIGTERM cancels all in-flight polls.
```

**Reader's trace for the primary case (agent submits a workflow, then checks status once, sees `completed` with outputs on disk):**

1. Agent → `generation submit {shot_id, workflow_json}` → Zod validates, dispatches to engine.
2. Engine: `format.validateWorkflowFormat(workflow_json)` — throws `INVALID_WORKFLOW_FORMAT` on UI-format.
3. Engine: breadcrumb resolves shot → walks up; version_number = `MAX+1`; insert row `(status='submitted', job_id=null)` inside txn.
4. Engine: `client.submit(workflow_json)` — POST `/api/prompt`, receives `{prompt_id}`; UPDATE version SET `job_id = prompt_id`.
5. Engine returns `{entity: version, breadcrumb, breadcrumb_text}`; tool wraps in envelope; agent receives structuredContent.
6. Agent (after a beat) → `generation status {version_id}` → engine loads row, sees `status='submitted'`.
7. Engine: `client.status(job_id)` — GET `/api/job/{prompt_id}/status` → `{status: 'completed'}`.
8. Engine: enumerate outputs (from status response) → for each: `client.download(filename, {subfolder, type})` → GET `/api/view`, follow 302, validate host, stream to `./outputs/.../v001/{filename}`, capture `content_type` + `size_bytes`.
9. Engine: inside txn, UPDATE row SET `status='completed', outputs_json=JSON(...), completed_at=now` WHERE `completed_at IS NULL`.
10. Engine: return fresh `{entity, progress:null, error:null, completed_at, breadcrumb, breadcrumb_text}`; tool wraps; agent sees `completed`.

### Recommended Project Structure (Phase 2 additions)

```
src/
├── comfyui/                    # NEW (zero MCP, zero DB imports — D-GEN-21)
│   ├── client.ts               # submit / status / download
│   ├── format.ts               # isApiFormat / validateWorkflowFormat
│   ├── types.ts                # narrow API request/response types
│   └── __tests__/
│       ├── format.test.ts
│       └── live-smoke.test.ts  # gated on COMFYUI_API_KEY
├── engine/
│   ├── backoff.ts              # NEW — pure async generator
│   ├── generation.ts           # NEW — submitGeneration + getGenerationStatus + recovery poller
│   ├── pipeline.ts             # EXTEND — delegate generation methods, add start()
│   ├── breadcrumb.ts           # EXTEND — 'version' leaf case
│   └── __tests__/
│       ├── backoff.test.ts     # NEW
│       └── generation.test.ts  # NEW — uses FakeComfyUIClient
├── store/
│   ├── db.ts                   # EXTEND — migrate() call after pragma init
│   ├── schema.ts               # EXTEND — new nullable columns
│   ├── version-repo.ts         # NEW
│   └── __tests__/
│       └── version-repo.test.ts # NEW
├── tools/
│   ├── generation-tool.ts      # NEW — mirrors workspace-tool shape
│   ├── index.ts                # EXTEND — re-export registerGeneration
│   └── __tests__/
│       └── generation-tool.test.ts # NEW
├── utils/
│   └── outputs.ts              # NEW — buildOutputPath + mkdir-recursive + collision suffix
├── test-utils/
│   └── fake-comfyui-client.ts  # NEW (Phase 2 extension)
├── server.ts                   # EXTEND — import 'dotenv/config' + registerGeneration + engine.start()
drizzle/
├── 0001_phase2_version_lifecycle.sql  # NEW — first generated migration
└── meta/                              # drizzle-kit metadata dir (auto-generated)
.env.example                           # NEW — placeholders + commentary
```

### Pattern 1: Ephemeral McpServer factory (inherit from Phase 1)

**What:** `buildServer(engine, version)` constructs a fresh `McpServer` per-HTTP-request (stateless HTTP transport) and once at boot for stdio. Same `engine` across both.
**When to use:** Every tool registration in Phase 2. Phase 2's `registerGeneration` slots into `buildServer`.
**Example:**
```typescript
// Source: src/server.ts (Phase 1 lock — DO NOT reshape)
function buildServer(engine: Engine, version: string): McpServer {
  const server = new McpServer(
    { name: 'vfx-familiar', version },
    { instructions: '...' },
  );
  registerWorkspace(server, engine);
  registerProject(server, engine);
  registerSequence(server, engine);
  registerShot(server, engine);
  registerGeneration(server, engine); // <-- Phase 2 addition
  return server;
}
```

**Phase-2 corollary (confirms Priority 6 question):** The recovery poller (`engine.start()`) runs **once per process** in the CLI entry path — not per `buildServer` invocation. Place the `engine.start()` call in `main()` after `openDb(path)` and BEFORE the first `buildServer(engine, version)` call. The factory is transport-indifferent and must remain side-effect-free.

### Pattern 2: Two-phase submit path (row-first, then ComfyUI)

**What:** Insert the `versions` row at status `submitted` with `job_id=null` inside a transaction, then POST to ComfyUI, then UPDATE the row's `job_id` outside the txn (cannot hold SQLite write lock across network I/O).
**When to use:** `Engine.submitGeneration`.
**Why:** (1) Gives the agent a stable `version_id` immediately. (2) Survives ComfyUI-side failures — the row is `submitted` with no `job_id`; recovery poller sees this and transitions to `failed` with `error_code='COMFYUI_API_ERROR'` + appropriate message, or the on-demand status call can see `job_id IS NULL` and treat as a special-case failure.
**Example:**
```typescript
// Source: synthesised from D-GEN-15, D-GEN-16, PITFALLS #6 (SQLite write-lock discipline)
async submitGeneration(shotId: string, workflowJson: unknown, notes?: string) {
  validateWorkflowFormat(workflowJson); // throws INVALID_WORKFLOW_FORMAT
  // Txn 1 — row exists before any network I/O
  const row = this.repo.insertVersion(shotId, notes); // version_number = MAX+1, status='submitted'
  try {
    const { prompt_id } = await this.client.submit(workflowJson);
    this.repo.setJobId(row.id, prompt_id);
  } catch (err) {
    // ComfyUI 4xx/5xx → transition to failed, do not leave orphan submitted row
    if (err instanceof TypedError && err.code === 'COMFYUI_RATE_LIMITED') {
      this.repo.markFailed(row.id, err.code, err.message);
      throw err; // agent sees COMFYUI_RATE_LIMITED, row sees matching state
    }
    this.repo.markFailed(row.id, 'COMFYUI_API_ERROR', String(err));
    throw new TypedError('COMFYUI_API_ERROR', String(err));
  }
  return { entity: row, breadcrumb: this.breadcrumb.resolve('version', row.id) };
}
```

### Pattern 3: Fresh-if-not-terminal status path

**What:** `getGenerationStatus(versionId)` loads the row; if terminal (`completed|failed`), return cached; otherwise fetch `GET /api/job/{id}/status`, normalize state, apply 10-min timeout check, and (if `completed`) kick the download-and-transition subroutine before returning.
**When to use:** Every `action: status` call (D-GEN-28, D-GEN-31).
**Example:**
```typescript
async getGenerationStatus(versionId: string) {
  const row = this.repo.getVersion(versionId);
  if (!row) throw new TypedError('VERSION_NOT_FOUND', `Version '${versionId}' not found`);
  if (row.status === 'completed' || row.status === 'failed') {
    return this.wrap(row); // cached — no roundtrip
  }
  // 10-minute timeout check (D-GEN-25)
  if (Date.now() - row.created_at > 600_000) {
    this.repo.markFailed(row.id, 'GENERATION_TIMEOUT',
      `Generation did not complete within 10 minutes`);
    return this.wrap(this.repo.getVersion(versionId)!);
  }
  // Fresh fetch
  const remote = await this.client.status(row.job_id!);
  const next = mapState(remote.status);
  if (next === 'completed') {
    await this.downloadAndPersist(row, remote.outputs); // may mark failed on download_failed
  } else if (next === 'failed') {
    this.repo.markFailed(row.id, 'COMFYUI_API_ERROR', extractError(remote));
  } else if (next === 'running' && row.status !== 'running') {
    this.repo.transition(row.id, 'running');
  }
  return this.wrap(this.repo.getVersion(versionId)!);
}
```

### Pattern 4: Host-allowlist redirect gate (SSRF defence)

**What:** `fetch` natively follows 302 (default `redirect: 'follow'`). To prove the post-redirect URL lands on an allowed host, we either (a) use `redirect: 'manual'` and inspect `Location`, or (b) allow follow and inspect `response.url` after.
**Recommendation:** Use `redirect: 'manual'`, inspect `Location`, then re-fetch the validated URL without auth headers (Cloud docs say signed URLs do not need auth [CITED: docs.comfy.org api-reference]).
**Allowlist:**
- `cloud.comfy.org` (the Cloud base)
- The `COMFYUI_API_BASE` origin (if overridden via `.env`)
- Unknown: the signed-URL host. Docs state "Fetch from signed URL without auth headers" but do NOT name the host. Plan must accept any host matching a configured regex OR collapse to "same base origin" if conservative. **Recommendation:** keep a **permissive regex list** in `client.ts` starting with `/\.cloud\.comfy\.org$/` and `/\.googleapis\.com$/` and `/\.amazonaws\.com$/` and `/\.r2\.cloudflarestorage\.com$/`, plus an override env var `COMFYUI_SIGNED_URL_HOSTS` (comma-separated regex list) for future-proofing. Document this decision and flag it to users.
**Example:**
```typescript
// Source: synthesised from D-GEN-22, MDN redirect mode, SSRF prevention research
async download(filename: string, { subfolder = '', type = 'output' } = {}): Promise<Download> {
  const viewUrl = new URL('/api/view', this.base);
  viewUrl.searchParams.set('filename', filename);
  viewUrl.searchParams.set('subfolder', subfolder);
  viewUrl.searchParams.set('type', type);

  const first = await fetch(viewUrl, {
    method: 'GET',
    headers: { 'X-API-Key': this.apiKey },
    redirect: 'manual',
  });
  if (first.status !== 302 && first.status !== 301) {
    throw new TypedError('COMFYUI_API_ERROR',
      `Expected 302 redirect from /api/view, got ${first.status}`);
  }
  const location = first.headers.get('location');
  if (!location) {
    throw new TypedError('COMFYUI_API_ERROR', '/api/view returned redirect with no Location');
  }
  const target = new URL(location);
  if (!this.isAllowedSignedUrlHost(target.hostname)) {
    throw new TypedError('COMFYUI_API_ERROR',
      `Unexpected redirect host: ${target.hostname}`);
  }
  // Signed URL: NO auth headers (docs say so)
  const second = await fetch(target, { method: 'GET' });
  if (!second.ok || !second.body) {
    throw new TypedError('COMFYUI_API_ERROR',
      `Signed URL fetch failed: ${second.status} ${second.statusText}`);
  }
  return {
    body: second.body,
    contentType: second.headers.get('content-type') ?? 'application/octet-stream',
    contentLength: Number(second.headers.get('content-length') ?? NaN),
    url: target.toString(),
  };
}
```

### Pattern 5: Streaming download with crash-safe temp-then-rename

**What:** Write to `{dest}.partial`, fsync, then atomically rename to `{dest}` only after the stream fully drains. Prevents half-written files from being visible as "completed" artifacts.
**When to use:** Every download in `client.download → disk` path (D-GEN-32, D-GEN-36).
**Example:**
```typescript
// Source: synthesised from node:stream/promises.pipeline + Readable.fromWeb [CITED: nodejs.org/api/stream]
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';

async function streamToDisk(body: ReadableStream, destPath: string) {
  const partial = `${destPath}.partial`;
  const writer = createWriteStream(partial);
  try {
    await pipeline(Readable.fromWeb(body), writer);
    await rename(partial, destPath);
  } catch (err) {
    await unlink(partial).catch(() => undefined);
    throw err;
  }
}
```

### Pattern 6: AbortController-wired poller for graceful shutdown

**What:** Each pending-version poller holds its own AbortController. `Engine.stop()` (wired to SIGINT/SIGTERM) iterates and `abort()`s each. All in-flight `fetch` calls rejectable via the aborted signal.
**When to use:** `Engine.start()` spawns one poller per pending row; `Engine.stop()` cancels.
**Example:**
```typescript
// Source: synthesised from D-GEN-29 + MDN AbortController + fetch signal semantics
class Engine {
  private pollers = new Map<string, AbortController>();

  async start() {
    const pending = this.repo.listPendingVersions(); // status IN ('submitted','running')
    for (const row of pending) {
      const controller = new AbortController();
      this.pollers.set(row.id, controller);
      void this.drivePoller(row, controller.signal).finally(() => {
        this.pollers.delete(row.id);
      });
    }
  }

  async stop() {
    for (const c of this.pollers.values()) c.abort();
    this.pollers.clear();
  }

  private async drivePoller(row: Version, signal: AbortSignal) {
    const delays = createBackoffIterator();
    while (!signal.aborted) {
      const { value: delayMs } = await delays.next();
      await sleep(delayMs!, signal);
      if (signal.aborted) return;
      try {
        await this.getGenerationStatus(row.id); // reuses on-demand path
        const refreshed = this.repo.getVersion(row.id);
        if (!refreshed || refreshed.status === 'completed' || refreshed.status === 'failed') return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.error(`[recovery] ${row.id}:`, err);
      }
    }
  }
}

// Wire in server.ts main():
process.on('SIGINT', () => engine.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => engine.stop().then(() => process.exit(0)));
```

### Anti-Patterns to Avoid

- **DO NOT** hold SQLite write txn across ComfyUI `fetch` — PITFALLS #6 SQLite BUSY. Use two-phase submit (Pattern 2).
- **DO NOT** set `status='completed'` before outputs are on disk — D-GEN-32, "Looks Done But Isn't" checklist. Only flip after `rename(partial → final)` succeeds for every output.
- **DO NOT** update `completed_at` more than once — D-GEN-20 immutability. Use `UPDATE ... WHERE completed_at IS NULL`.
- **DO NOT** follow 302 redirects without host validation — PITFALLS Integration Gotcha. Use `redirect: 'manual'`.
- **DO NOT** log the `COMFYUI_API_KEY` value anywhere — D-GEN-12 + extended stdio-hygiene test. Log last-4 only.
- **DO NOT** call `engine.start()` inside `buildServer()` — that would spawn the poller per-HTTP-request. Call once in `main()`.
- **DO NOT** read `process.env` from engine code — credentials are injected via `ComfyUIClient` constructor (see §Integration Points).
- **DO NOT** hand-roll a `user_version` bump in Phase 2. Drizzle's `migrate()` owns the versioning ledger starting with Phase 2. Phase 1's `user_version = 1` remains; Drizzle layers its own `__drizzle_migrations` table on top, idempotent.
- **DO NOT** spawn a continuous background poller. Only the on-start recovery (D-GEN-28) + on-demand fetch (D-GEN-28) — no always-on loop.
- **DO NOT** pass the whole `OpenDbResult` to `HierarchyRepo` / `VersionRepo`. Always destructure `const { db } = openDb(path)`. Phase 1 test-utils enforce this and Phase 2 must not regress.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Migration versioning ledger | Hand-rolled `user_version++` + DDL exec | `migrate()` from `drizzle-orm/better-sqlite3/migrator` [VERIFIED: exists in installed package] | Drizzle tracks applied files in `__drizzle_migrations`; idempotent on reboot; survives multi-phase accretion without collisions |
| `.env` parsing | `fs.readFileSync('.env') + split` | `dotenv` ^17.4.2 | Handles quoted values, multi-line, escaping, BOM — surprising amount of edge-case code for `.env` parity |
| Exponential backoff sequence | Ad-hoc `Math.min(base * 2^n, cap)` | Pure `createBackoffIterator` generator (D-GEN-24) | Consistent semantics across on-start poller and future Phase 3 reuse; pure function = trivially testable |
| HTTP retry on download | Ad-hoc `while (tries--)` around `fetch` | Dedicated `retryDownload(url, attempts, schedule, signal)` helper | Isolates timing schedule `[2s, 4s, 8s]` (D-GEN-36), honors abort signal, single-point for future telemetry |
| File streaming to disk | `new Uint8Array(await response.arrayBuffer())` + `fs.writeFile` | `pipeline(Readable.fromWeb(body), createWriteStream(partial)) + rename` | Images/videos can be tens of MB; buffering-in-RAM is a memory cliff and loses crash safety. `pipeline` auto-closes on error. |
| Node_errors flattening | Free-form traversal | Typed extractor `extractFirstNodeError(node_errors): string | null` per D-GEN-27 | The shape is `{node_id: {errors: [{type, message, details}], dependent_outputs, class_type}}` — CITED; an extractor is 8 lines with a test. Reuse in Phase 3 when prompt blob comes online. |
| UI-vs-API format detection | LLM-style duck typing | Explicit structural check per D-GEN-23: UI-sentinel keys first, then numeric-key + `class_type` test | Deterministic; avoids false negatives; matches the issue #1335 reference heuristic |
| Output disk path | String concatenation in engine | `buildOutputPath({...})` utility in `src/utils/outputs.ts` | Centralizes D-GEN-33 template; lets Phase 3 swap to per-project override without touching the engine |
| AbortController wiring for `fetch` | Direct `fetch(url).then(r => ...)` | `fetch(url, { signal })` everywhere — pass AbortSignal through client | Required for D-GEN-29 graceful shutdown and for the 10-min timeout (wraps poller's own timer as a secondary hang-guard) |

**Key insight:** Phase 2 is shallow network-plumbing work layered over Phase 1's established engine/store/tools separation. The only genuinely-novel mechanism is the recovery poller, and it's 30 lines of pure TypeScript plus one `AbortController` map. Every other problem has a well-established library or idiomatic pattern.

## Runtime State Inventory

> This phase is additive (new tool, new schema columns, new client code); no rename, refactor, or migration of existing runtime state. The inventory below is for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None.** Phase 1 committed zero version rows (D-10 + D-GEN-39); schema addition is additive nullable columns. `outputs/` directory does not exist at phase start. | None — migration is additive; first row creation is during Phase 2 smoke test or first agent call. |
| Live service config | **None.** No n8n, no external service, no orchestration daemon. ComfyUI Cloud is accessed remotely and has no local config. | None. |
| OS-registered state | **None.** No Windows Task Scheduler, no launchd, no pm2, no systemd, no persistent process registration. The server is started ad-hoc via `npx tsx src/server.ts`. | None. |
| Secrets/env vars | **NEW:** `COMFYUI_API_KEY` + `COMFYUI_API_BASE` in `.env` (gitignored, chmod 600, already present per user memory `reference_env_comfyui_key.md`). Add `.env.example` placeholder file (committed). | Add `.env.example` + document in README via CLAUDE.md project conventions. No existing secret rename. |
| Build artifacts / installed packages | **NEW package:** `dotenv` ^17.4.2 added to `dependencies`. The `drizzle/` directory appears for the first time (generated migration files). | Run `npm install dotenv`. Generated migration file is committed. |

**Nothing found in category:** "Stored data" and "Live service config" — explicitly empty because the repo is pre-first-generation. "OS-registered state" — explicitly empty because this is a local dev server, not a background daemon.

## Common Pitfalls

### Pitfall 1: Base URL discrepancy — CONTEXT.md default vs. official docs

**What goes wrong:** D-GEN-11 specifies `https://api.comfy.org` as the default `COMFYUI_API_BASE`. Official docs unambiguously use `https://cloud.comfy.org`. Shipping with the CONTEXT.md default bricks every default-config submit.
**Why it happens:** Either the CONTEXT.md value is a typo/outdated value, or it reflects a staging environment that hasn't been checked against docs.
**How to avoid:** `.env.example` and code default must use `https://cloud.comfy.org`. The planner should surface this discrepancy to the user in PLAN.md's "decisions worth double-checking" section; executor SHOULD NOT reproduce the D-GEN-11 value verbatim without flagging.
**Warning signs:** Live-smoke test fails with DNS error (`api.comfy.org` does not resolve) or HTTP 404 on `/api/prompt`.
**Source:** [CITED: docs.comfy.org/development/cloud/overview and api-reference both state "https://cloud.comfy.org"]. [ASSUMED: D-GEN-11's `api.comfy.org` was a drafting error — will be raised in plan-check phase.]

### Pitfall 2: `import 'dotenv/config'` placement

**What goes wrong:** If `import 'dotenv/config'` is not the FIRST import of `src/server.ts`, a subsequent relative import (especially one that reads `process.env` at module-init time) will see `undefined`. Even a logger or config file loader at the top of another imported file can race.
**Why it happens:** ESM module evaluation is depth-first from the root; imports are hoisted but their order of top-level execution is the import order of the root module.
**How to avoid:** Line 1 of `src/server.ts` must be `import 'dotenv/config';`. Line 2 onwards: all other imports. The engine and other modules MUST NOT read `process.env` — credentials flow through the ComfyUI client constructor (passed from `main()`). Covered by extended stdio-hygiene grep (see Priority 6).
**Warning signs:** Live-smoke test fails with `COMFYUI_CREDENTIALS_MISSING` even though `.env` has `COMFYUI_API_KEY` set.
**Source:** [CITED: dotenv npm README + nodejs.org ESM module-loading docs].

### Pitfall 3: Concurrent submits under UNIQUE(shot_id, version_number)

**What goes wrong:** Two rapid-fire `generation submit` calls for the same shot race — both compute `MAX+1 = N`, both insert, second one gets `SQLITE_CONSTRAINT_UNIQUE`.
**Why it happens:** The `SELECT MAX(version_number) + 1` + `INSERT` is not atomic unless the SELECT is inside a transaction with `BEGIN IMMEDIATE` or `UPDATE ... RETURNING` semantics. Phase 1's `isUniqueViolation` helper catches the race.
**How to avoid:** Run the `SELECT MAX` + `INSERT` inside a single `better-sqlite3` transaction (`db.transaction(() => { ... })()`), which takes an IMMEDIATE lock. On `SQLITE_CONSTRAINT_UNIQUE` (via Phase 1's `isUniqueViolation`), retry the whole txn ONCE; on second failure, surface as `CONCURRENT_SUBMIT_CONFLICT` per D-GEN-16.
**Warning signs:** `npx vitest run src/store/__tests__/version-repo.test.ts` fails sporadically under test parallelism; or the live-smoke test with two rapid submits sees a raw SQLITE error (which must be wrapped, per defence-in-depth envelope).
**Source:** [CITED: better-sqlite3 docs — BEGIN IMMEDIATE semantics]; [VERIFIED: existing `isUniqueViolation` helper in `src/store/hierarchy-repo.ts`].

### Pitfall 4: Node_errors shape mismatch — flattening the wrong field

**What goes wrong:** D-GEN-27 specifies flattening `"Node ${nodeId} (${class_type}): ${first_error_message}"`. Naïve implementation reads `node_errors[nodeId].errors[0].message`, but the verified shape is `errors[0].message` where the object has `{type, message, details}`. If code assumes `reason.reason` or `reason.text`, the flattener returns `undefined` and the agent sees `"Node 3 (KSampler): undefined"`.
**Why it happens:** The `validate_prompt` return shape is buried in `execution.py` and not in the Cloud API docs.
**How to avoid:** Hard-typed extractor: `extractFirstNodeError(node_errors): string | null` that narrows on `errors[0]?.message`. Unit-test with fixture responses. Fall back to the top-level `error` field if `node_errors` is empty or shape-mismatched.
**Warning signs:** Integration tests emit error messages ending in `: undefined`.
**Source:** [CITED: ComfyUI execution.py validate_prompt — node_errors[node_id] = {errors: reasons, dependent_outputs: [], class_type}, where each `reasons` entry has `type, message, details`].

### Pitfall 5: Workflow-format false positive — empty object or one-key edge cases

**What goes wrong:** `validateWorkflowFormat({})` or `validateWorkflowFormat({foo: 'bar'})` may pass an overly-loose heuristic — an empty object has numeric-string keys vacuously ("none match `/^\d+$/`" is technically true for zero keys). Detector could accept it and ComfyUI would then reject with a 400, producing a worse UX than a pre-submit reject.
**Why it happens:** Detection requires BOTH (a) all keys match `/^\d+$/` AND (b) at least one key is present AND (c) each value has `class_type: string` and `inputs: object`.
**How to avoid:** `isApiFormat(p): boolean` returns `false` for empty objects, non-objects, arrays, or mixed-key objects. Unit-test with: `{}`, `[]`, `null`, `undefined`, `{nodes: []}` (UI), `{ '1': { class_type: 'A', inputs: {} } }` (minimal valid), `{ '1': { class_type: 'A' } }` (missing inputs), `{ '1': {} }` (missing class_type), `{ 'a': { class_type: 'A', inputs: {} } }` (non-numeric key).
**Warning signs:** Live-smoke fails with ComfyUI `{error: "...empty prompt..."}` instead of `INVALID_WORKFLOW_FORMAT`.
**Source:** [VERIFIED: ComfyUI basic_api_example.py shows minimum one-node shape].

### Pitfall 6: Download partial — stream crash leaves half-written file

**What goes wrong:** Mid-stream network failure during `fetch(signedUrl)` leaves `outputs/.../file.png` as a truncated file. Subsequent retry writes a fresh partial file that may overwrite or coexist with the corrupt one.
**Why it happens:** Naïve `pipeline(response.body, createWriteStream(destPath))` writes directly to the destination; a crash produces a user-visible "done" file.
**How to avoid:** Write to `{destPath}.partial`, flush, `rename` to `{destPath}` atomically. Retry loop: between attempts, always `unlink` the `.partial`. Pattern 5 above.
**Warning signs:** `outputs/.../v001/foo.png` exists but is 0 bytes or unreadable. `outputs_json[].size_bytes = 0`.
**Source:** [CITED: POSIX rename() atomicity; nodejs.org fs.rename spec].

### Pitfall 7: SSRF via redirect — signed URL allowlist

**What goes wrong:** Signed-URL hosts are not documented. A naïve "follow any redirect" path lets a malicious or misconfigured Cloud response redirect the server to `169.254.169.254` (AWS/GCP metadata endpoint) or a local service.
**Why it happens:** `fetch` defaults to `redirect: 'follow'`; the client does not see the `Location` header unless mode is `manual`.
**How to avoid:** `redirect: 'manual'`, inspect `Location`, validate host against a regex allowlist (`cloud.comfy.org`, `googleapis.com`, `amazonaws.com`, `r2.cloudflarestorage.com` — expand via env override), reject unknowns with typed `COMFYUI_API_ERROR`. Pattern 4 above.
**Warning signs:** Manual verification of the signed URL during live smoke shows a host not in the allowlist — plan a widening. Automated SSRF test submits a crafted mock signed-URL host via the fake client.
**Source:** [CITED: MDN SSRF guide; PITFALLS.md Integration Gotchas; W. Snyk SSRF-MCP research].

### Pitfall 8: 10-minute timeout vs. long video generation

**What goes wrong:** A minute-long video with a heavy Pro-tier workflow can exceed 10 minutes. D-GEN-25 marks it `GENERATION_TIMEOUT` and the artist loses it.
**Why it happens:** Single hardcoded timeout.
**How to avoid:** For Phase 2, we accept this (CONTEXT.md Deferred Ideas explicitly defers per-project timeout override). Live-smoke test uses a cheap workflow (image, small latent, 20 steps, small SDXL checkpoint) whose p95 is < 2 minutes. For any user-facing test, prefer a 512×512 SD 1.5 workflow over SDXL/video.
**Warning signs:** Timeout errors during live-smoke; or a user report "my 2-minute video was marked failed".
**Source:** [CONTEXT.md Deferred Ideas explicit].

### Pitfall 9: MCP SDK `structuredContent` + `isError` interaction (issue #654)

**What goes wrong:** If a tool uses `outputSchema` AND returns `isError: true`, the SDK validates `structuredContent` against the schema BEFORE checking `isError` — which may reject the error envelope as "doesn't match expected success schema".
**Why it happens:** Known issue #654 in MCP TS SDK, discussed but not fully resolved as of inspection.
**How to avoid:** Phase 1 does NOT use `outputSchema` (we only pass `inputSchema` to `registerTool`). Phase 2 should NOT add `outputSchema` either — the dual-form envelope + `isError` is sufficient. If a future phase adds `outputSchema`, revisit this issue.
**Warning signs:** Zod error rejected as "unrecognized structuredContent shape".
**Source:** [CITED: github.com/modelcontextprotocol/typescript-sdk/issues/654].

### Pitfall 10: `import 'dotenv/config'` vs. explicit `dotenv.config()` mix

**What goes wrong:** Some phases / code paths call `dotenv.config()` explicitly after a side-effect import has already run, subtly overriding or shadowing env values.
**Why it happens:** Historical accumulation.
**How to avoid:** Pick ONE: CONTEXT.md Claude's Discretion says use the side-effect import `import 'dotenv/config'`. Grep-enforce: no `dotenv.config(` call-site anywhere in src/. Single source = side-effect import at top of `src/server.ts`.
**Warning signs:** Env value in `.env` visible in unit test but not in server process (or vice versa).
**Source:** [CITED: dotenv README — both paths exist].

## Code Examples

### Drizzle migration runner wired into openDb (D-GEN-38)

```typescript
// Source: drizzle-orm/better-sqlite3 README + Phase 1 openDb
// File: src/store/db.ts (EXTEND — additive, no change to Phase 1 behavior)
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import { SCHEMA_DDL } from './schema.js';

export const SCHEMA_VERSION = 1;

export interface OpenDbResult {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
}

export function openDb(path: string): OpenDbResult {
  const sqlite = new Database(path);

  // Pragmas FIRST — invariant per D-20 / Pitfall #6
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  // Phase 1 first-run bootstrap (preserved verbatim)
  const existingVersion = sqlite.pragma('user_version', { simple: true }) as number;
  if (existingVersion === 0) {
    sqlite.exec(SCHEMA_DDL);
    sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);
  } else if (existingVersion !== SCHEMA_VERSION) {
    throw new Error(
      `DB at ${path} is version ${existingVersion}, server expects ${SCHEMA_VERSION}`,
    );
  }

  const db = drizzle(sqlite, { schema });

  // Phase 2 addition: drizzle-kit-generated migrations layer on top.
  // Idempotent — drizzle's own __drizzle_migrations table tracks applied files.
  // NOTE: synchronous call; no await.
  migrate(db, { migrationsFolder: './drizzle' });

  return { db, sqlite };
}
```

### Backoff generator (D-GEN-24)

```typescript
// Source: synthesised from D-GEN-24 + Claude's Discretion
// File: src/engine/backoff.ts
/**
 * Exponential backoff delay sequence per D-GEN-24: 2s, 4s, 8s, 16s, then cap at 30s.
 * Reset semantics: a new iterator per job = reset.
 */
export async function* createBackoffIterator(): AsyncGenerator<number> {
  const schedule = [2_000, 4_000, 8_000, 16_000];
  for (const delay of schedule) yield delay;
  while (true) yield 30_000;
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, rejectSleep) => {
    if (signal?.aborted) return rejectSleep(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolveSleep, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      rejectSleep(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}
```

### Workflow format detection (D-GEN-23)

```typescript
// Source: D-GEN-23 heuristic + ComfyUI basic_api_example.py + issue #1335
// File: src/comfyui/format.ts
import { TypedError } from '../engine/errors.js';

export function isUiFormat(payload: unknown): boolean {
  if (!isPlainObject(payload)) return false;
  const o = payload as Record<string, unknown>;
  return (
    Array.isArray(o.nodes) ||
    Array.isArray(o.links) ||
    Array.isArray(o.groups) ||
    typeof o.last_node_id === 'number'
  );
}

export function isApiFormat(payload: unknown): boolean {
  if (!isPlainObject(payload)) return false;
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length === 0) return false;
  for (const [k, v] of entries) {
    if (!/^\d+$/.test(k)) return false;
    if (!isPlainObject(v)) return false;
    const node = v as Record<string, unknown>;
    if (typeof node.class_type !== 'string') return false;
    if (!isPlainObject(node.inputs)) return false;
  }
  return true;
}

export function validateWorkflowFormat(payload: unknown): void {
  if (isUiFormat(payload)) {
    throw new TypedError(
      'INVALID_WORKFLOW_FORMAT',
      'Workflow is in ComfyUI UI format (contains nodes/links/groups)',
      "Export the workflow with 'Dev Mode > Save (API Format)' enabled in ComfyUI. " +
        'API format uses numeric string keys ("1", "2", ...) with class_type/inputs per node.',
    );
  }
  if (!isApiFormat(payload)) {
    throw new TypedError(
      'INVALID_WORKFLOW_FORMAT',
      'Workflow does not match the ComfyUI API format',
      "Expected an object keyed by numeric strings, each value with 'class_type' (string) and 'inputs' (object). See CLAUDE.md.",
    );
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
```

### Node_errors flattener (D-GEN-27)

```typescript
// Source: ComfyUI execution.py validate_prompt return shape [CITED]
// File: src/comfyui/client.ts (or extractor helper)

interface NodeError {
  errors: Array<{ type: string; message: string; details?: string; extra_info?: unknown }>;
  dependent_outputs: string[];
  class_type: string;
}

/**
 * Flatten the first actionable node_errors entry per D-GEN-27.
 * Returns null if the object is empty, malformed, or missing the expected shape.
 */
export function extractFirstNodeError(
  nodeErrors: unknown,
): string | null {
  if (!nodeErrors || typeof nodeErrors !== 'object' || Array.isArray(nodeErrors)) return null;
  const entries = Object.entries(nodeErrors as Record<string, unknown>);
  for (const [nodeId, raw] of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as Partial<NodeError>;
    const firstMsg = node.errors?.[0]?.message;
    const classType = node.class_type ?? 'UnknownNode';
    if (typeof firstMsg === 'string' && firstMsg.length > 0) {
      return `Node ${nodeId} (${classType}): ${firstMsg}`;
    }
  }
  return null;
}
```

### Version-repo allocation + insert txn (D-GEN-16)

```typescript
// Source: better-sqlite3 BEGIN IMMEDIATE semantics + Phase 1 isUniqueViolation helper
// File: src/store/version-repo.ts
import { and, eq, sql, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { versions } from './schema.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';
import type { Version } from '../types/hierarchy.js';

export class VersionRepo {
  constructor(private db: BetterSQLite3Database) {}

  /**
   * Allocate + insert in a single transaction. Retries ONCE on UNIQUE violation
   * (rare concurrent submit); second failure surfaces as CONCURRENT_SUBMIT_CONFLICT.
   */
  insertVersion(shotId: string, notes?: string): Version {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return this.doInsert(shotId, notes);
      } catch (err) {
        if (isUniqueViolation(err) && attempt === 0) continue;
        if (isUniqueViolation(err)) {
          throw new TypedError(
            'CONCURRENT_SUBMIT_CONFLICT',
            `Concurrent submit for shot '${shotId}' — retry once`,
            'Retry the submit call; this is a rare race between two near-simultaneous submits to the same shot.',
          );
        }
        throw err;
      }
    }
    throw new TypedError('CONCURRENT_SUBMIT_CONFLICT', 'Exhausted retries (unreachable)');
  }

  private doInsert(shotId: string, notes?: string): Version {
    return this.db.transaction((tx) => {
      const maxRow = tx
        .select({ m: sql<number>`COALESCE(MAX(${versions.version_number}), 0)` })
        .from(versions)
        .where(eq(versions.shot_id, shotId))
        .get();
      const versionNumber = Number(maxRow?.m ?? 0) + 1;
      const row: Version = {
        id: newId('ver'),
        shot_id: shotId,
        version_number: versionNumber,
        status: 'submitted',
        job_id: null,
        parent_version_id: null,
        notes: notes ?? null,
        created_at: Date.now(),
        completed_at: null,
      };
      tx.insert(versions).values(row).run();
      return row;
    })();
  }

  /**
   * Set job_id after the ComfyUI POST succeeds. Guarded to only run once per row.
   */
  setJobId(id: string, jobId: string): void {
    this.db.update(versions).set({ job_id: jobId }).where(eq(versions.id, id)).run();
  }

  /**
   * Mark failed. Guarded so that completed_at stays immutable — D-GEN-20.
   */
  markFailed(id: string, code: string, message: string): void {
    this.db.run(sql`
      UPDATE versions
      SET status = 'failed',
          error_code = ${code},
          error_message = ${message},
          completed_at = ${Date.now()}
      WHERE id = ${id} AND completed_at IS NULL
    `);
  }

  markCompleted(id: string, outputsJson: string): void {
    this.db.run(sql`
      UPDATE versions
      SET status = 'completed',
          outputs_json = ${outputsJson},
          completed_at = ${Date.now()}
      WHERE id = ${id} AND completed_at IS NULL
    `);
  }

  transition(id: string, next: 'running'): void {
    this.db.update(versions).set({ status: next }).where(eq(versions.id, id)).run();
  }

  getVersion(id: string): Version | null {
    const r = this.db.select().from(versions).where(eq(versions.id, id)).get();
    return (r as Version | undefined) ?? null;
  }

  listPendingVersions(): Version[] {
    return this.db
      .select()
      .from(versions)
      .where(inArray(versions.status, ['submitted', 'running']))
      .all() as Version[];
  }
}

// Reuse Phase 1's helper — exported from hierarchy-repo.ts; keep a single copy.
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  const code = e.code ?? '';
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
  if (code.startsWith('SQLITE_CONSTRAINT') && /UNIQUE/i.test(e.message ?? '')) return true;
  return false;
}
```

### Migration file (D-GEN-38, D-GEN-39)

```sql
-- drizzle/0001_phase2_version_lifecycle.sql
-- Generated by: npx drizzle-kit generate --dialect sqlite --schema src/store/schema.ts --out ./drizzle
-- Phase 2 additive migration: lifecycle + outputs columns on versions.
-- No backfill required — Phase 1 committed zero version rows (D-10 / D-GEN-39).

ALTER TABLE `versions` ADD `error_code` text;
--> statement-breakpoint
ALTER TABLE `versions` ADD `error_message` text;
--> statement-breakpoint
ALTER TABLE `versions` ADD `outputs_json` text;
```

**Expected `src/store/schema.ts` diff:**
```typescript
// src/store/schema.ts — EXTEND `versions` table
export const versions = sqliteTable('versions', {
  id: text('id').primaryKey(),
  shot_id: text('shot_id').notNull().references(() => shots.id),
  version_number: integer('version_number').notNull(),
  status: text('status').notNull().default('submitted'),
  job_id: text('job_id'),
  parent_version_id: text('parent_version_id'),
  notes: text('notes'),
  created_at: integer('created_at').notNull(),
  completed_at: integer('completed_at'),
  // Phase 2 additions — D-GEN-19 (all nullable):
  error_code: text('error_code'),
  error_message: text('error_message'),
  outputs_json: text('outputs_json'),
}, (t) => ({
  uniqueVersionPerShot: unique().on(t.shot_id, t.version_number),
  idxShot: index('idx_versions_shot').on(t.shot_id, t.version_number),
}));
```

Also remove the three new columns from `SCHEMA_DDL` — no, actually KEEP them in `SCHEMA_DDL` so **fresh** databases (cold-start, zero-config) get the full schema via Phase 1's `CREATE TABLE IF NOT EXISTS` path. Existing DBs (hypothetically) use the Drizzle migrator. In practice Phase 1 shipped with user_version=1 and the DDL included only the base versions columns; the migrator takes DBs forward. To keep fresh-DB and migrated-DB schemas identical, the planner has two options:

1. **Recommended:** Let `SCHEMA_DDL` stay as-is (Phase 1 snapshot), and rely on `drizzle/0001_phase2_version_lifecycle.sql` to apply the Phase 2 columns on BOTH fresh and existing DBs. Drizzle's migrator runs every boot; on a fresh DB it sees no `__drizzle_migrations` table, creates it, and applies `0001_*.sql` — which finds the base `versions` table (just created by `SCHEMA_DDL`) and adds the three columns.
2. **Alternative:** Add the columns to `SCHEMA_DDL` directly. Then `0001_*.sql` becomes a no-op on fresh DBs (ALTER TABLE fails with "duplicate column" on SQLite — not cleanly idempotent). Avoid.

### `.env.example` (D-GEN-13 deferred-idea companion)

```bash
# .env.example — committed placeholder. Copy to .env and fill in your values.
# Never commit .env — it's in .gitignore.

# ComfyUI Cloud API key. Generate at https://platform.comfy.org
COMFYUI_API_KEY=your-comfy-api-key-here

# ComfyUI Cloud API base URL. Default is https://cloud.comfy.org — the canonical
# cloud endpoint per docs.comfy.org/development/cloud/overview. Override for
# staging or self-hosted ComfyUI if needed.
# Note: CONTEXT.md D-GEN-11 lists https://api.comfy.org as the default; the
# correct canonical URL per official docs is https://cloud.comfy.org. When
# setting up Phase 2 confirm with user which default should land in code.
COMFYUI_API_BASE=https://cloud.comfy.org
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node-fetch` / `undici` explicit dep | Native `fetch` (Node ≥ 20) | Node 18.0 stable, 20.0 LTS | CONTEXT.md Claude's Discretion already locks native `fetch`. Zero new deps. |
| `MCP SSEServerTransport` | `StreamableHTTPServerTransport` (stateless) | MCP spec 2025-03-26 | Phase 1 already landed `StreamableHTTPServerTransport`. No Phase 2 change. |
| `zod-to-json-schema` | Zod v4 native `z.toJSONSchema()` | Zod 4.x + MCP SDK 1.29 (Standard Schema) | Phase 1 already on Zod 4.3.6. No Phase 2 change. |
| Hand-rolled `user_version` schema bootstrapping | `drizzle-kit generate` + `migrate()` runner | Drizzle 0.40+ matured | Phase 1 deferred; Phase 2 adopts per D-GEN-38. |
| Monolithic polling loop | Hybrid on-demand + on-start recovery | PITFALLS.md #4 + Phase 2 discussion | CONTEXT.md D-GEN-28. Quota-friendly. |
| Redirect: 'follow' everywhere | `redirect: 'manual'` with host allowlist | SSRF best practices (OWASP 2025+) | D-GEN-22 + Pattern 4. |

**Deprecated/outdated:**
- `.env` parsing via `require('dotenv').config()` — both side-effect and explicit work; standardize on `import 'dotenv/config'` top-of-`src/server.ts` (Claude's Discretion).
- `SSEServerTransport` — not used in this repo; no migration needed.
- `zod-to-json-schema` — not in package.json; removed expectation confirmed.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All phases | ✓ | 25 (user's machine) | — (CI uses Node 20 LTS; `>=20` in engines) |
| `better-sqlite3` (compiled native module) | Store | ✓ | 12.9.0 | — |
| `dotenv` (pending install) | server.ts | Install in task 0 | ^17.4.2 | `envfile` / manual parse (not recommended) |
| `drizzle-orm/better-sqlite3/migrator` | Store | ✓ | 0.45.2 built-in submodule [VERIFIED: node_modules/drizzle-orm/better-sqlite3/migrator.js] | Hand-rolled ALTER (Phase 1 path) — rejected for Phase 2 |
| `drizzle-kit` CLI | Dev (migration generation) | ✓ | 0.31.10 | Hand-write SQL migration (trivial for additive columns) — viable fallback if drizzle-kit generates a broken migration |
| `COMFYUI_API_KEY` (.env) | Live smoke + any real `submit` | Conditional (present on dev machine per memory; absent in CI) | — | Live-smoke test skips cleanly; submit tool returns `COMFYUI_CREDENTIALS_MISSING` |
| `COMFYUI_API_BASE` (.env) | Client default override | Optional | — | Default to `https://cloud.comfy.org` in code |
| Network to `cloud.comfy.org` | Live smoke | Conditional | — | Live-smoke skips on network failure; unit + integration tests use FakeComfyUIClient |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- `COMFYUI_API_KEY` in CI → live-smoke test skips gracefully (already prescribed in D-GEN-42.7).
- Drizzle migrator failure in unexpected edge case → hand-writing 3 `ALTER TABLE ADD COLUMN` statements is trivial.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.4 (already installed) |
| Config file | `vitest.config.ts` (Phase 1; no change) |
| Quick run command | `npx vitest run --changed` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GEN-01 | Agent submits workflow within shot context | unit | `npx vitest run src/engine/__tests__/generation.test.ts -t "submit inserts version row"` | ❌ Wave 0 |
| GEN-01 | Live end-to-end submit against real Cloud | live-smoke (gated) | `COMFYUI_API_KEY=... npx vitest run src/comfyui/__tests__/live-smoke.test.ts` | ❌ Wave 0 |
| GEN-02 | Submit returns immediately (< 1s to agent) | integration | `npx vitest run src/tools/__tests__/generation-tool.test.ts -t "submit resolves quickly"` | ❌ Wave 0 |
| GEN-02 | submit → structuredContent shape (entity + breadcrumb) | integration | same file, `-t "submit envelope shape"` | ❌ Wave 0 |
| GEN-03 | status advances through submitted→running→completed | unit (fake client) | `npx vitest run src/engine/__tests__/generation.test.ts -t "status advances"` | ❌ Wave 0 |
| GEN-03 | status on terminal returns cached row (no roundtrip) | unit | same file, `-t "status cached on terminal"` | ❌ Wave 0 |
| GEN-04 | version_number = MAX+1; UNIQUE guaranteed | unit (repo) | `npx vitest run src/store/__tests__/version-repo.test.ts -t "version number monotone"` | ❌ Wave 0 |
| GEN-04 | Concurrent submit → CONCURRENT_SUBMIT_CONFLICT after retry | unit (repo) | same file, `-t "concurrent UNIQUE retry"` | ❌ Wave 0 |
| GEN-04 | completed_at immutable (second update ignored) | unit (repo) | same file, `-t "completed_at immutability"` | ❌ Wave 0 |
| GEN-05 | Failed workflow → status=failed with node_errors flattened | unit (fake client) | `npx vitest run src/engine/__tests__/generation.test.ts -t "failed records error"` | ❌ Wave 0 |
| GEN-05 | extractFirstNodeError returns expected string for fixture | unit | `npx vitest run src/comfyui/__tests__/format.test.ts -t "extractFirstNodeError"` (or dedicated file) | ❌ Wave 0 |
| GEN-06 | UI-format rejected with INVALID_WORKFLOW_FORMAT | unit | `npx vitest run src/comfyui/__tests__/format.test.ts -t "UI-format rejected"` | ❌ Wave 0 |
| GEN-06 | API-format accepted | unit | same file, `-t "API-format accepted"` | ❌ Wave 0 |
| GEN-06 | Edge cases ({}, [], null, mixed keys, missing class_type) | unit | same file, `-t "format edge cases"` | ❌ Wave 0 |
| GEN-07 | Backoff iterator yields [2s,4s,8s,16s,30s,30s,...] | unit (pure) | `npx vitest run src/engine/__tests__/backoff.test.ts` | ❌ Wave 0 |
| GEN-07 | Recovery poller drains pending rows via backoff | unit (fake client + fake timers) | `npx vitest run src/engine/__tests__/generation.test.ts -t "recovery poller"` | ❌ Wave 0 |
| GEN-07 | On-demand status bypasses backoff | unit | same file, `-t "on-demand status immediate"` | ❌ Wave 0 |

### Test Layers — Fake Boundaries

| Layer | Real Components | Fakes/Stubs | Why |
|-------|----------------|-------------|-----|
| **Unit: format** | Pure TS (`format.ts`) | — | No I/O to fake |
| **Unit: backoff** | Pure generator | — | No I/O |
| **Unit: version-repo** | In-memory SQLite via `makeInMemoryDb()` (Phase 1) | — | SQL semantics are the SUT |
| **Unit: engine.generation** | Engine + real `VersionRepo` + in-mem SQLite | `FakeComfyUIClient` (injected via Engine constructor) | Isolates state machine + download orchestration from network |
| **Integration: generation-tool** | Full stack (McpServer + Engine + in-mem SQLite) | `FakeComfyUIClient` | Covers Zod dispatch, envelope, breadcrumb, error wrapping at the tool boundary. Uses `InMemoryTransport` pair like Phase 1's `transport-parity.test.ts`. |
| **Cross-cutting** | Phase 1's three existing tests (grep-based) | — | Extend budget 4→5; extend stdio-hygiene grep to block `COMFYUI_API_KEY=`; extend architecture-purity to cover `src/comfyui/`. |
| **Live smoke** | Full stack + real `ComfyUIClient` + real network | — | Guarded by `if (!process.env.COMFYUI_API_KEY) test.skip()`. Submits minimal API-format workflow (one-step SD 1.5 latent decode or similar); asserts `completed` within 3 minutes; asserts output file present on disk; cleans up DB row + downloaded file. |

### Sampling Rate

- **Per task commit:** `npx vitest run --changed` (< 20s feedback)
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green + live-smoke green (if key present) before `/gsd-verify-work`

### Wave 0 Gaps

Wave 0 of Phase 2 must create the following files BEFORE any implementation task starts:

- [ ] `src/test-utils/fake-comfyui-client.ts` — mirrors `FakeEngine` pattern; exposes `submit(workflow)`, `status(jobId)`, `download(filename, opts)` as Vitest spies with canned responses + scenario modes (happy-path, failed-validation, slow-running, timeout, download-flaky, download-hopeless). Approx. 120 lines.
- [ ] `src/test-utils/fake-engine.ts` — EXTEND with `submitGeneration`, `getGenerationStatus`, `start`, `stop` methods so tool-layer tests don't pull in real engine.
- [ ] `src/comfyui/__tests__/format.test.ts` — fixtures for UI-format (exported from ComfyUI UI), API-format (numeric-key minimal), edge cases. ~80 lines.
- [ ] `src/engine/__tests__/backoff.test.ts` — pure generator assertions with fake timers. ~30 lines.
- [ ] `src/store/__tests__/version-repo.test.ts` — in-memory SQLite via `makeInMemoryDb()` + seed shot/sequence/project/workspace; exercise version_number monotonicity, UNIQUE race (simulated), transition invariants, `completed_at` immutability. ~150 lines.
- [ ] `src/engine/__tests__/generation.test.ts` — uses `FakeComfyUIClient`; covers submit-then-status, timeout path, download retry path, recovery poller. ~200 lines.
- [ ] `src/tools/__tests__/generation-tool.test.ts` — integration via `InMemoryTransport` pair; asserts envelope shape, Zod rejection, error wrapping, breadcrumb on every response. ~100 lines.
- [ ] `src/comfyui/__tests__/live-smoke.test.ts` — minimal cheap workflow; gated on `process.env.COMFYUI_API_KEY`; runs the full `submit → status → download → verify on disk` path. ~60 lines.

If no gaps: (not applicable — Phase 2 adds all generation tests from scratch).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication (to ComfyUI) | yes | `X-API-Key` header on every request; last-4 log only (D-GEN-12); key loaded from `.env` (chmod 600, gitignored) |
| V3 Session Management | no | Stateless HTTP transport; no session state; MCP session disabled (`sessionIdGenerator: undefined`) |
| V4 Access Control | partial | Single-user demo model (Phase 1 D-38 locked — no auth on MCP itself); any HTTP listener binds `127.0.0.1` |
| V5 Input Validation | yes | Zod at MCP boundary (D-05 / D-GEN-04); workflow-format detection (D-GEN-23); path component names used verbatim per D-GEN-33 — **Phase 2 accepts fs-unsafe names as demo-scope constraint** (documented) |
| V6 Cryptography | no | No crypto primitives implemented; TLS to ComfyUI Cloud handled by Node's native fetch/https stack. No hand-rolled hashing or encryption. |
| V8 Data Protection | yes | `.env` gitignored; secrets never logged; defence-in-depth envelope (Phase 1 D-13/D-32) extended to suppress any `COMFYUI_API_KEY=` string in any error path |
| V9 Communication Security | yes | TLS via native fetch; `redirect: 'manual'` + host allowlist (D-GEN-22) for SSRF defence; reject unknown redirect hosts |
| V10 Malicious Code | partial | Workflow JSON is data, not code — but could contain adversarial payload strings. Agent input validated via Zod. No eval, no dynamic require. |
| V13 API | yes | ComfyUI API calls use parameterized URL construction (`URL` constructor); no string concatenation with user input |

### Known Threat Patterns for Phase 2

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF via arbitrary redirect target (`/api/view` → attacker host) | Tampering | `redirect: 'manual'` + host allowlist (Pattern 4, D-GEN-22) |
| API key leakage via logs or error messages | Information Disclosure | Last-4 only in log (D-GEN-12); defence-in-depth envelope rewrap; extended stdio-hygiene grep rejects any `COMFYUI_API_KEY=` string on stdout/stderr |
| Path traversal via workflow-specified output filename | Tampering / Info Disclosure | Phase 2 uses ComfyUI-returned filename verbatim (untrusted). **Mitigation:** `buildOutputPath` validates `filename` does not contain `..`, `/`, or `\` — reject or strip. Engine rejects with `COMFYUI_API_ERROR` if ComfyUI returns a filename with path components. |
| Adversarial workflow crashes ComfyUI → server hangs | DoS | 10-minute timeout (D-GEN-25) + recovery poller abort on shutdown (D-GEN-29) |
| Tool description prompt injection | Elevation of Privilege | Tool descriptions (D-GEN-08) are factual, parameter-facing; no imperative agent-control language |
| Concurrent write race on `versions` | Tampering | `BEGIN IMMEDIATE` transaction in `insertVersion`; retry once on UNIQUE (Pitfall 3) |
| Partial-download visible as completed file | Info Disclosure / Data Integrity | Temp-then-rename pattern (Pattern 5); only transition to `completed` AFTER all `rename()` calls succeed |
| Large workflow / large response → memory exhaustion | DoS | Node `fetch` + `Readable.fromWeb` stream path means download bytes never buffered in RAM. Workflow JSON is size-limited implicitly by MCP's own message size cap. |
| API key exposed via CLI `ps`-visible flag | Info Disclosure | D-GEN-13: no CLI flag added; `.env` is the single source (protects against `ps` leak) |

## Assumptions Log

> The planner and `/gsd-discuss-phase` should review these before finalising plans. Any `[ASSUMED]` claim in this document that affects a locked decision should be confirmed with the user.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Signed-URL hosts for ComfyUI `/api/view` 302 redirect include `googleapis.com`, `amazonaws.com`, `r2.cloudflarestorage.com` (regex allowlist) | Pattern 4 SSRF gate | If actual host is none of these, EVERY live download fails. Mitigated by user-facing env override `COMFYUI_SIGNED_URL_HOSTS`. Verify on first live-smoke run. [ASSUMED] |
| A2 | D-GEN-11's `https://api.comfy.org` default is a drafting error; official URL is `https://cloud.comfy.org` | Pitfall 1 | If CONTEXT.md is right and `api.comfy.org` is an alias, no-op. If it's wrong (more likely), default submit fails. [CITED: docs.comfy.org] confirms `cloud.comfy.org`; D-GEN-11 is [ASSUMED] incorrect. |
| A3 | ComfyUI `/api/job/{prompt_id}/status` response on completion includes an outputs descriptor (something like `{status:'completed', outputs: {...}}`) that the client can enumerate for `/api/view` download | Pattern 3 status path | If status endpoint only returns `{status: 'completed'}` with NO outputs pointer, client must call `/api/history_v2/{prompt_id}` to get output references. Docs fetch returned only `{status}` for the status endpoint — full completion shape is [ASSUMED]. History endpoint exists per overview doc. Plan should include a diagnostic pass to confirm shape before finalising the download code path. |
| A4 | ComfyUI Cloud concurrency free-tier limit is 1; tier hint text in `COMFYUI_RATE_LIMITED` (D-GEN-26) is "Free: 1, Creator: 3, Pro: 5" | D-GEN-26, Priority 1 | [CITED: docs.comfy.org/development/cloud/overview]. Standard tier also = 1 per docs; plan's hint string can be either precise (Free:1/Standard:1/Creator:3/Pro:5) or abbreviated. Matches CONTEXT.md intent. Low risk. |
| A5 | On a 429, the ComfyUI Cloud response body has a readable `error` string; no `Retry-After` header is documented | D-GEN-26 | [CITED: docs.comfy.org — no Retry-After documented]. Plan should read `Retry-After` header if present (defensive) but not rely on it. Low risk. |
| A6 | Minimal live-smoke workflow = 1-node wrapper or a classical 4-node pipeline (CheckpointLoader + CLIPTextEncode × 2 + KSampler + VAEDecode + SaveImage). Lowest-cost model is SD 1.5 at 512×512, 10-20 steps. | Priority 4 | Cheapest workflow assumption. A 6-node image gen typically completes in 30-90s on cloud. Live-smoke test should use `sd_xl_base_1.0` or `v1-5-pruned-emaonly.safetensors`. Specific model name depends on what the cloud instance has pre-loaded — [ASSUMED] `v1-5-pruned-emaonly.safetensors` is default-available. Plan should parameterise the checkpoint name via an env override if the smoke fails. |
| A7 | Drizzle's `migrate()` is idempotent across Phase-1's `user_version=1` + hand-rolled DDL + Phase-2's first generated migration | Pattern — migration runner | [CITED: drizzle-orm SQLite README states automatic migration] + [ASSUMED: no conflict between Phase 1's `user_version=1` pragma and Drizzle's `__drizzle_migrations` table]. Both use different mechanisms — pragma is SQLite-native metadata, migrations is an application table. Should coexist. |
| A8 | ComfyUI Cloud's `/api/prompt` accepts the workflow wrapped as `{prompt: {...}}` (not the workflow at the top level) | Pattern 2 submit path | [CITED: ComfyUI basic_api_example.py — POST body is `{prompt: workflow}`, optionally with `extra_data`]. [VERIFIED: Cloud docs confirm `{prompt: ..., extra_data?: {api_key_comfy_org}}`]. High confidence. |
| A9 | Phase 1's Zod rewrap pattern (shot-tool's ZodError → TypedError with sentinel-message detection) is reusable for `generation-tool.ts` without modification | Integration point | Pattern is well-established; no known edge case. Reusable. [VERIFIED: shot-tool.ts]. Low risk. |
| A10 | `Engine.start()` + `Engine.stop()` is the right extension point (vs. a separate `RecoveryPoller` class composed by Engine) | Pattern 6, Integration point | CONTEXT.md D-GEN-29 says "Recovery poller starts inside `Engine.start()`." [CITED from CONTEXT.md]. No extraction pressure in Phase 2; can refactor in Phase 3 if provenance needs finer control. Low risk. |

**Nothing else is assumed beyond the CONTEXT.md locked set.** Every claim outside the Assumptions Log is either [CITED] to an official source or [VERIFIED] via tool output (package versions, file presence).

## Open Questions (RESOLVED)

1. **Cloud `/api/job/{prompt_id}/status` completion shape** — **RESOLVED via live-smoke probe (Plan 02-03 Task 4).**
   - What we know: Docs state response body is `{status: "pending|in_progress|completed|failed|cancelled"}`.
   - What's unclear: On `completed`, does the response embed the outputs list, or is `GET /api/history_v2/{prompt_id}` required?
   - Resolution: Phase 2 client implements try-first on the status response, falling back to `/api/history_v2/{prompt_id}` when outputs are missing. Live-smoke logs the actual shape to stderr on first run so the fallback can be removed or kept per empirical truth.

2. **Signed URL host for `/api/view` 302 target** — **RESOLVED via live-smoke probe (Plan 02-03 Task 4) + env override (`COMFYUI_ALLOWED_REDIRECT_HOSTS`).**
   - What we know: Docs state 302 redirect + signed URL, no auth header needed on redirect.
   - What's unclear: Host name (`googleapis.com`? `amazonaws.com`? A ComfyUI-owned domain?).
   - Resolution: Permissive regex allowlist at launch (`googleapis.com`, `amazonaws.com`, `r2.cloudflarestorage.com`, `cloud.comfy.org`) + env override. Live-smoke logs the observed host on first success so the allowlist can be tightened in a follow-up phase.

3. **Node.js 25 vs CI's Node.js 20** — **N/A (non-blocking, informational).**
   - What we know: User's local machine is Node 25 (per CLAUDE.md memory). `package.json` declares `"engines": {"node": ">=20"}`. Native `fetch` + `Readable.fromWeb` + `AbortController` are stable in both.
   - Resolution: No action required in Phase 2. CI should run against Node 20 to catch future drift — tracked as an infrastructure follow-up.

4. **Does D-GEN-11 default `https://api.comfy.org` intentionally reflect a staging environment?** — **RESOLVED: user confirmed `cloud.comfy.org` during plan-phase (2026-04-20).**
   - What we know: Official base is `https://cloud.comfy.org` (docs.comfy.org).
   - Resolution: CONTEXT.md D-GEN-09, D-GEN-11, D-GEN-22, and §"Specific Values" were updated on 2026-04-20 to `cloud.comfy.org`. All three Phase 2 plans use `cloud.comfy.org` as the code default and `.env.example` value. User override via `.env` is still honored at runtime.

## Sources

### Primary (HIGH confidence)

- **ComfyUI Cloud API Reference** — https://docs.comfy.org/development/cloud/api-reference (base URL, endpoints, auth header, 302 flow, concurrency note, experimental warning)
- **ComfyUI Cloud Overview** — https://docs.comfy.org/development/cloud/overview (base URL `https://cloud.comfy.org`, tier limits: Free/Standard=1, Creator=3, Pro=5)
- **ComfyUI basic_api_example.py** — https://github.com/comfyanonymous/ComfyUI/blob/master/script_examples/basic_api_example.py (API-format payload shape, `{prompt: workflow}` POST body)
- **ComfyUI execution.py `validate_prompt`** — verified via Huggingface mirror (`node_errors` shape = `{node_id: {errors: [{type, message, details}], dependent_outputs, class_type}}`)
- **Drizzle ORM SQLite README** — https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/README.md (programmatic `migrate()` from `drizzle-orm/better-sqlite3/migrator`; synchronous operation)
- **Drizzle changelogs/drizzle-orm/0.29.5.md** — `__drizzle_migrations` table default, custom table name option
- **Context7 drizzle-team/drizzle-orm** — migration runner pattern + migration folder layout
- **Node.js Stream docs** — https://nodejs.org/api/stream.html (`Readable.fromWeb`, `pipeline` from `stream/promises`)
- **MDN SSRF guide** — https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/SSRF (allowlist + `redirect: 'manual'` patterns)
- **PITFALLS.md** (project-local) — Pitfalls #2, #3, #4, #6, Integration Gotchas, "Looks Done But Isn't" checklist
- **ARCHITECTURE.md** (project-local) — Pattern 4 ComfyUI Job Lifecycle Bridge, Generation Request Flow, Database Schema
- **STACK.md §"ComfyUI Cloud API Notes"** (project-local) — endpoint list, X-API-Key, tier limits
- **Phase 1 source (`src/`)** — Reusable helpers: `isUniqueViolation` (hierarchy-repo.ts), `BreadcrumbResolver` (breadcrumb.ts), `shapeCreateOrGet`/`shapeList` (shape.ts), `toolOk`/`toolError` (envelope.ts), `buildServer` factory (server.ts)

### Secondary (MEDIUM confidence)

- **motdotla/dotenv README** — https://github.com/motdotla/dotenv (side-effect `import 'dotenv/config'` pattern; ESM hoisting caveat)
- **MCP TS SDK issue #654** — https://github.com/modelcontextprotocol/typescript-sdk/issues/654 (`structuredContent` + `isError` validation order; not a Phase 2 problem because no `outputSchema`)
- **Drizzle-kit generate docs** — https://orm.drizzle.team/docs/drizzle-kit-generate (CLI flags, output folder, filename convention)
- **DevCommunity: Node streaming download** — pipe pattern for web-stream → file-stream via `Readable.fromWeb`
- **better-sqlite3 docs** — transaction semantics, synchronous API (no `await` on queries)

### Tertiary (LOW confidence — flagged for validation)

- **Signed URL host pattern** — Not documented in official Cloud docs; regex allowlist is [ASSUMED]. Live-smoke run surfaces the actual host.
- **Exact completion shape of `/api/job/{prompt_id}/status`** — Docs show `{status}`; completion-side outputs descriptor is [ASSUMED]. Live-smoke confirms.
- **D-GEN-11 `https://api.comfy.org` default** — Conflicts with official docs; [ASSUMED] drafting error. Flag in PLAN phase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package version verified via `npm view`; `migrator.js` exists in installed `drizzle-orm`
- Tool surface + architecture: HIGH — CONTEXT.md is the contract; Phase 1 source is the substrate; Pattern 2-6 are synthesized from locked decisions
- ComfyUI API shapes: HIGH for endpoints + auth + workflow format + node_errors; MEDIUM for completion-side outputs descriptor and signed-URL host (docs gaps)
- Pitfalls: HIGH — sourced from project PITFALLS.md + CONTEXT.md decisions
- Security: HIGH — standard OWASP guidance; concrete Phase 2 threat model from Phase 1 extended
- Validation architecture: HIGH — Phase 1's pattern is already proven; Phase 2 merely extends

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 for most claims; shorter (2026-05-04) for the ComfyUI Cloud API claims because the API is experimental and subject to change. Re-verify base URL + status endpoint completion shape if Phase 2 planning is delayed past two weeks.

## RESEARCH COMPLETE
