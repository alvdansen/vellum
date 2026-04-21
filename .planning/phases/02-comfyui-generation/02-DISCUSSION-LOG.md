# Phase 2: ComfyUI Generation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `02-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 02-comfyui-generation
**Areas discussed:** Config & secrets, Tool surface shape, Polling & status model, Output file handling

---

## Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Config & secrets | Resolves TRNS-04 "no env vars" vs `.env` tension | ✓ |
| Tool surface shape | 1 vs 2 tools; naming; return shape | ✓ |
| Polling & status model | Background vs on-demand; backoff; timeout | ✓ |
| Output file handling | Download-in-Phase-2 vs defer; on-disk layout | ✓ |

All four initially-offered gray areas were selected.

---

## Config & secrets

### Q1: Where does the server read COMFYUI_API_KEY and COMFYUI_API_BASE from?

| Option | Description | Selected |
|--------|-------------|----------|
| `.env` via `dotenv` (Recommended) | Add `dotenv` dep; load `.env` from CWD at server start. Matches memory/reference for this project. | ✓ |
| CLI flags (`--comfyui-api-key`) | Preserves "no env vars" but leaks key into process args (visible in `ps`). | |
| JSON config file at `~/.vfx-familiar/config.json` | Explicit file; adds a second config surface the demo has to explain. | |

**User's choice:** `.env` via `dotenv` (Recommended)

### Q2: When does the server require the key to be present?

| Option | Description | Selected |
|--------|-------------|----------|
| At submit-time only (Recommended) | Server boots zero-config — preserves TRNS-04. `generation submit` fails with typed `COMFYUI_CREDENTIALS_MISSING` + hint. Hierarchy tools still work. | ✓ |
| At server boot | Server refuses to start without the key. Breaks TRNS-04. | |

**User's choice:** At submit-time only (Recommended)

### Q3: Is COMFYUI_API_BASE configurable or hardcoded to api.comfy.org?

| Option | Description | Selected |
|--------|-------------|----------|
| Configurable via `.env` (Recommended) | Default `https://api.comfy.org`. Allows pointing at staging / local ComfyUI. | ✓ |
| Hardcoded to `https://api.comfy.org` | Zero ambiguity but locks out staging/local testing. | |

**User's choice:** Configurable via `.env` (Recommended)

### Q4: What's the logging rule for the API key?

| Option | Description | Selected |
|--------|-------------|----------|
| Log presence only (Recommended) | `ComfyUI credentials loaded (key ****${last4}, base ${base})`. Never logs key value. | ✓ |
| No logging at all | Safer but harder to debug "why is submit failing". | |
| Full key in debug mode only | Mask by default, full key under `--debug`. Risk of accidental leak in demo recordings. | |

**User's choice:** Log presence only (Recommended)

---

## Tool surface shape

### Q1: How many Phase 2 tools? (8 slots remain in the 12-tool cap)

| Option | Description | Selected |
|--------|-------------|----------|
| One tool with actions (Recommended) | Single `generation` tool with `action: submit | status`. Uses 1 of 8. Matches Phase 1 D-02 pattern. | ✓ |
| Two tools (`generation` + `job`) | Uses 2 of 8. Matches ARCHITECTURE.md's conceptual split. | |

**User's choice:** One tool with actions (Recommended)

### Q2: What name for the primary tool?

| Option | Description | Selected |
|--------|-------------|----------|
| `generation` (Recommended) | Noun, snake_case, no prefix. Matches Phase 1 naming. | ✓ |
| `version` | Conflates with Phase 3 diff/reproduce/iterate. | |
| `generate` | Verb — breaks noun-only convention. | |

**User's choice:** `generation` (Recommended)

### Q3: What does `action: submit` return to the agent?

| Option | Description | Selected |
|--------|-------------|----------|
| Full version record + breadcrumb (Recommended) | Mirrors Phase 1 envelope; one shape for create/get/list product-wide. | ✓ |
| Minimal `{versionId, versionNumber, jobId}` | Smaller response; requires a follow-up `shot get` call for hierarchy context. | |

**User's choice:** Full version record + breadcrumb (Recommended)

### Q4: Does `action: status` include progress percentage or just state?

| Option | Description | Selected |
|--------|-------------|----------|
| State + optional progress if available (Recommended) | Full version record + `progress: number \| null`, `error: string \| null`, `completed_at`. | ✓ |
| State only | Simpler schema; no "42% done" capability. | |

**User's choice:** State + optional progress if available (Recommended)

---

## Polling & status model

### Q1: How does the server learn that a ComfyUI job finished?

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: on-demand + light background (Recommended) | `action: status` fetches fresh + persists. On-start recovery poller wakes pending jobs. No always-on loop. | ✓ |
| Pure agent-driven (on-demand only) | Status only advances when agent calls `action: status`. Rows stay at `submitted` if agent never checks. | |
| Always-on background poller | Background loop polls on backoff. Lifecycle complexity + quota burn. | |

**User's choice:** Hybrid: on-demand + light background (Recommended)

### Q2: What exponential backoff cadence for the on-start recovery poller?

| Option | Description | Selected |
|--------|-------------|----------|
| 2s → 4s → 8s → 16s → cap at 30s (Recommended) | PITFALLS.md Pitfall #4 prescription. Fast first reaction; caps to avoid quota burn. | ✓ |
| 5s → 10s → 20s → cap at 60s | Gentler on quota; slower first-result feel. | |
| Fixed 5s interval | Simpler; bursts quota harder under multiple jobs. | |

**User's choice:** 2s → 4s → 8s → 16s → cap at 30s (Recommended)

### Q3: When should the server give up on a pending job and mark it failed?

| Option | Description | Selected |
|--------|-------------|----------|
| 10 minutes (Recommended) | PITFALLS.md Pitfall #4 default. Covers image gen + short video. | ✓ |
| 30 minutes | Safer for long video; pending rows linger longer on ComfyUI silent drops. | |
| No timeout — trust ComfyUI's terminal states | Risks orphaned `submitted` rows if Cloud drops the job. | |

**User's choice:** 10 minutes (Recommended)

### Q4: When the agent calls `action: status`, do we fetch fresh from ComfyUI or return DB state?

| Option | Description | Selected |
|--------|-------------|----------|
| Always fresh if not terminal (Recommended) | Fetch-and-persist for `submitted|running`. Cached for `completed|failed`. | ✓ |
| Cached always (trust the background poller) | Fast; but up to 30s stale in the recommended backoff. | |
| Fresh only if DB row older than 2s | Quota-friendly de-dupe; marginal benefit vs Option 1 under the 10-min ceiling. | |

**User's choice:** Always fresh if not terminal (Recommended)

---

## Output file handling

### Q1: Does Phase 2 download ComfyUI output files, or defer that to Phase 3?

| Option | Description | Selected |
|--------|-------------|----------|
| Download in Phase 2 (Recommended) | Fetch outputs via `/api/view` (302 follow), write to local disk, store paths on the version. | ✓ |
| Store URLs only, defer download to Phase 3 | Signed URLs expire — artist can't reopen assets. Incomplete demo. | |
| On-demand download via new MCP tool | Adds a tool, splits responsibility awkwardly. | |

**User's choice:** Download in Phase 2 (Recommended)

### Q2: Where on disk should outputs land?

| Option | Description | Selected |
|--------|-------------|----------|
| VFX-style hierarchy path (Recommended) | `./outputs/{project}/{seq}/{shot}/v###/{filename}.ext`. Matches ARCHITECTURE.md and VFX artist expectations. | ✓ |
| Flat by versionId | `./outputs/{versionId}/{filename}.ext`. Simpler; opaque IDs in Finder. | |
| Configurable via `--output-dir` flag | Expands Phase 1's 5-flag CLI contract. | |

**User's choice:** VFX-style hierarchy path (Recommended)

### Q3: What does `status: completed` mean — before or after download?

| Option | Description | Selected |
|--------|-------------|----------|
| After download succeeds (Recommended) | Completion = ComfyUI done + outputs on disk. Failed download → separate terminal state. | ✓ |
| As soon as ComfyUI reports completed | Separate `outputs_ready: bool` flag needed; more state for the agent to reason about. | |

**User's choice:** After download succeeds (Recommended)

### Q4: What happens if ComfyUI says done but the output download fails?

| Option | Description | Selected |
|--------|-------------|----------|
| Retry 3x, then mark `failed` with `DOWNLOAD_FAILED` (Recommended) | 3 retries with 2s/4s/8s backoff. On give-up: `status=failed`. | ✓ |
| Mark completed, flag `outputs_missing=true` | Ambiguous: completed + outputs_missing = "kind of done". | |
| Keep retrying indefinitely (background) | Jobs never finalize if URL is permanently dead. | |

**User's choice:** Retry 3x, then mark `failed` with `DOWNLOAD_FAILED` (Recommended)

---

## Wrap-up

### Q5: Ready for context, or explore more gray areas?

| Option | Description | Selected |
|--------|-------------|----------|
| I'm ready for context | Write CONTEXT.md with decisions above. Remaining gaps go under Claude's Discretion. | ✓ |
| Explore more gray areas | Dig into format validation, auto-versioning timing, concurrency handling. | |

**User's choice:** I'm ready for context

---

## Claude's Discretion

Items explicitly left to the planner / executor (documented in CONTEXT.md §Claude's Discretion):

- Backoff helper signature
- Whether a `jobs` table is added (Phase 2: no)
- HTTP client choice (native `fetch`)
- Local concurrency limiting (Phase 2: no)
- Progress extraction specifics from ComfyUI's response shape
- `outputs_json` parsing strategy on read
- `BreadcrumbResolver` extension for the `version` leaf
- `drizzle-kit` migration generation
- Exact `dotenv` loading point
- ComfyUI API endpoint path variants (`/api/...` vs versioned)

## Deferred Ideas

Captured in CONTEXT.md §Deferred Ideas. Highlights:
- Input-asset upload
- Per-project output-path template override
- `--output-dir` CLI flag
- Dedicated `jobs` table
- ComfyUI WebSocket progress stream
- Local concurrency queue (v2 ROUTE-*)
- Update/cancel on versions
- ComfyUI model checksum verification (Phase 3 best-effort)
- Structured logger (`pino`)
- Output thumbnails (Phase 5)
