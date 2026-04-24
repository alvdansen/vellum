---
phase: 07-comfyui-endpoint-reconciliation
verified: 2026-04-24T21:35:00Z
status: passed
score: 4/4 sections complete
overrides_applied: 0
re_verification: null
---

# Phase 7: ComfyUI Endpoint Reconciliation — Resolution Report

**Phase Goal:** Reconcile the `COMFYUI_API_BASE` endpoint drift so live-smoke authenticates and returns 200 across stdio + HTTP transports, closing the Phase 2 infrastructure tech debt captured in project memory.

**Verified:** 2026-04-24T21:35:00Z
**Status:** PASSED
**Re-verification:** No — initial resolution

---

## 1. Probe Matrix and Chosen Base

### Probe Run (2026-04-24, `scripts/probe-comfy-endpoint.mts`)

Invocation: `npx tsx scripts/probe-comfy-endpoint.mts` from repo root. Zero credit burn (GET-only). Exit code 0 (winner found). `docs.comfy.org` fetch failed; Landmine 5 graceful degradation proceeded with 3 hardcoded bases (the fallback still produced an unambiguous winner).

| Base | Path | Status | Latency | First-bytes snippet |
|------|------|--------|---------|---------------------|
| `https://cloud.comfy.org` | `/api/queue` | 401 | 308ms | `{"message":"invalid API key"}` |
| `https://cloud.comfy.org` | `/api/system_stats` | **200** | 163ms | `{"devices":[],"system":{"argv":[],"cloud_version":"v0.82.0","comfyui_version":"v0.19.5",...` **WINNER** |
| `https://cloud.comfy.org` | `/api/history` | 401 | 82ms | `{"message":"authentication method not allowed"}` |
| `https://cloud.comfy.org` | `/` | 200 | 87ms | `<!doctype html> <html lang="en">   <head> <meta charset="UTF-8" /> <title>ComfyUI</title>` (HTML, not API) |
| `https://api.comfy.org` | `/api/queue` | 404 | 204ms | `{"message":"Not Found"}` |
| `https://api.comfy.org` | `/api/system_stats` | 404 | 191ms | `{"message":"Not Found"}` |
| `https://api.comfy.org` | `/api/history` | 404 | 90ms | `{"message":"Not Found"}` |
| `https://api.comfy.org` | `/` | 404 | 98ms | `{"message":"Not Found"}` |
| `https://www.comfy.org/api` | `/api/queue` | 404 | 177ms | `The page could not be found NOT_FOUND sfo1::...` |
| `https://www.comfy.org/api` | `/api/system_stats` | 404 | 52ms | `The page could not be found NOT_FOUND sfo1::...` |
| `https://www.comfy.org/api` | `/api/history` | 404 | 59ms | `The page could not be found NOT_FOUND sfo1::...` |
| `https://www.comfy.org/api` | `/` | 200 | 55ms | `<!DOCTYPE html><html lang="en" class="overflow-x-clip"> ...` (marketing HTML, not API) |

### Chosen Base

**`COMFYUI_API_BASE=https://cloud.comfy.org`** with **`HEALTHCHECK_PATH=/api/system_stats`**.

Rationale: only (base, path) combo that returned 200 with an authenticated-JSON response for the current X-API-Key format. `/api/system_stats` is a read-only endpoint that is trivially cheap to hit from `ensureEndpointHealthy` (D-EP-07) — zero credit burn per call.

**Auth-method-per-endpoint asymmetry (observed on `cloud.comfy.org`):** the same X-API-Key that authenticates `/api/system_stats` (200) is rejected by `/api/queue` (401 `"invalid API key"`) and `/api/history` (401 `"authentication method not allowed"`). `HEALTHCHECK_PATH` therefore MUST be `/api/system_stats` specifically — do NOT switch to `/api/queue` expecting it to work.

### Live-Smoke Evidence

| Run | Timestamp (UTC) | Duration | Exit | Tests | Notes |
|-----|-----------------|----------|------|-------|-------|
| 1 | 2026-04-24T21:27:13Z → 21:28:18Z | 64.63s | 0 | 2 passed / 0 skipped | Cold start; first-poll entity snapshot `{"status":"running","job_id":"<cloud-uuid>","version_number":1}`; D-EP-07 healthcheck fired once, no DRIFT |
| 2 | 2026-04-24T21:28:25Z → 21:28:49Z | 23.11s | 0 | 2 passed / 0 skipped | Warm worker — 41s faster than Run 1; D-EP-07 healthcheck re-memoized from Run 1 cache within same process |

**Sentinel opt-in** (2026-04-24T21:28:56Z, 307ms, 0 credits): `RUN_PROBE=1 npx vitest run src/comfyui/__tests__/endpoint-probe.test.ts` — 1 passed. Confirms `HEALTHCHECK_PATH=/api/system_stats` alignment between runtime client (Plan 02) and sentinel test (Plan 05).

### Download Redirect Target

Observed signed-URL host: **`storage.googleapis.com`** (captured via post-run direct probe of `/api/view` 302 target for a completed job's preview-output filename).

Matched by the existing `/(^|\.)googleapis\.com$/` pattern in `DEFAULT_ALLOWED_HOST_PATTERNS` (`src/comfyui/client.ts:230`) — **no allowlist widening needed**. The default allowlist (Phase 2 D-GEN-22) already anticipated GCS, AWS, R2, and cloud.comfy.org as the plausible signed-URL host tiers.

### Plan-01 probe-matrix scope gap (documented here for future maintainers)

The probe matrix covered only **read-only GET** endpoints. Phase 7 live-smoke acceptance (Plan 06) surfaced two latent issues that the probe could not detect:

1. **Per-endpoint auth asymmetry.** The earlier `COMFYUI_API_KEY` (rotated during Plan 06) authenticated `/api/system_stats` (200) but was rejected by `POST /api/prompt` (401). The D-EP-07 healthcheck catches "endpoint moved" drift but not "key lost submit privilege on specific routes" drift. Remediation: §3 Rotation Procedure, step 5b.
2. **Status endpoint shape mismatch.** Phase 2's `ComfyUIClient.status()` targeted `GET /api/job/{id}/status` (singular), which returns dispatch-state only — no `outputs` field, no workflow prompt. The plural `GET /api/jobs/{id}` is the correct status endpoint for completion detection. Remediation: D-EP-17 (commit `b94a8df`) switched the client to the plural endpoint and added `extractOutputs` to flatten the nested `outputs[nodeId][mediaType][]` shape.

A follow-up probe revision that also tests `POST /api/prompt` with a minimal validation payload would catch per-endpoint scope asymmetry earlier; out of scope for Phase 7, captured here for future prioritisation.

---

## 2. Credential Layout / Source-of-Truth

### Where the key lives

- **File:** `.env` at repo root (NOT `.env.example`)
- **Permissions:** `chmod 600` (non-world-readable; Plan 03 Task 2 enforcement)
- **Gitignore:** `.gitignore:12` excludes `.env` (never committed)
- **Loading:** `import 'dotenv/config'` at `src/server.ts:2` (before any relative imports — matches D-GEN-09 pattern)
- **Read by:** `Engine` wiring in `src/server.ts` via `process.env.COMFYUI_API_KEY` and `process.env.COMFYUI_API_BASE`

### Where the base lives (three sources, single truth — D-EP-06)

1. **`.env`** — operator's live value. Used at server boot.
2. **`.env.example`** — committed template with the locked base + rotation-procedure reference. Locked in Plan 03.
3. **`src/comfyui/client.ts:36`** — `DEFAULT_COMFYUI_API_BASE` constant. Used when `.env` is absent or variable empty. Locked in Plan 02.

All three MUST agree. Plan 03 Task 3 included a cross-file consistency check that fails loudly on drift.

### How tests gate on credentials

- **Live-smoke** (`src/comfyui/__tests__/live-smoke.test.ts`): `RUN_LIVE_SMOKE=1` + `COMFYUI_API_KEY`. Burns credits per run; 2 tests. Invocation: `set -a && source .env && set +a && RUN_LIVE_SMOKE=1 npx vitest run src/comfyui/__tests__/live-smoke.test.ts`. (The `set -a / source .env / set +a` pattern is required because vitest does not auto-load `.env` — without it, `process.env.COMFYUI_API_KEY` is undefined at module-evaluation time and `describe.skipIf(SKIP)` silently skips.) Optional override: `COMFYUI_SMOKE_CHECKPOINT=<available-ckpt>` when the default `v1-5-pruned-emaonly.safetensors` is not on the account's checkpoint list.
- **Sentinel** (`src/comfyui/__tests__/endpoint-probe.test.ts`): `RUN_PROBE=1` + `COMFYUI_API_KEY`. Zero credit burn (read-only GET against `HEALTHCHECK_PATH`). Invocation: `set -a && source .env && set +a && RUN_PROBE=1 npx vitest run src/comfyui/__tests__/endpoint-probe.test.ts`.
- **Unit tests** (`src/comfyui/__tests__/client.test.ts`): use `fetchImpl` injection with fake `KEY = 'sk-test-fake'`. Never hit the network. Always run.

### Key issuance source

ComfyUI Cloud console: `https://platform.comfy.org/login` → **API Keys** section → **"+ New"** button. Key value is shown ONCE on creation; copy to `.env` immediately. Dashboard shows `****<last4>` thereafter for identification.

---

## 3. Rotation Procedure

Follow these steps in order when the current key needs to be rotated (e.g., suspected exposure, scheduled rotation, failed probe with all-401 exit code, per-endpoint scope asymmetry).

1. **Issue a new key.**
   - Visit `https://platform.comfy.org/login` and sign in.
   - Navigate to **API Keys** → **"+ New"**.
   - Copy the full key value from the one-time display. Do NOT close the modal before copying.

2. **Replace the value in `.env`.**
   - Open `.env` at repo root (chmod 600; operator's terminal must have read access).
   - Replace the `COMFYUI_API_KEY=...` line with the new key. Keep quoting style if present.
   - Do NOT commit `.env` — it's gitignored; verify with `git status` showing no new changes staged.

3. **Re-run the probe.**
   - From repo root: `npx tsx scripts/probe-comfy-endpoint.mts`
   - Verify the SUMMARY banner says **WINNER: <base><path> → 200** (exit 0).
   - If it says "NO WORKING COMBO" (exit 1), the new key was issued against a different host than the current `COMFYUI_API_BASE`. Check the Cloud console for the endpoint associated with the key and update step 4 accordingly.

4. **Update base + HEALTHCHECK_PATH if they changed.**
   - Compare the probe winner's `<base>` and `<path>` to the current values in:
     - `.env` (`COMFYUI_API_BASE=<old>`)
     - `.env.example` (`COMFYUI_API_BASE=<old>`)
     - `src/comfyui/client.ts:36` (`DEFAULT_COMFYUI_API_BASE`)
     - `src/comfyui/client.ts:51` (`export const HEALTHCHECK_PATH`)
   - If the probe winner differs from any site, update the three `COMFYUI_API_BASE` sites to match and update `HEALTHCHECK_PATH` if the path changed.
   - Confirm consistency: `grep '^COMFYUI_API_BASE=' .env .env.example` must show the same value both lines; `grep 'DEFAULT_COMFYUI_API_BASE = ' src/comfyui/client.ts` must show the same string.

5. **Re-run live-smoke.**
   - From repo root: `set -a && source .env && set +a && RUN_LIVE_SMOKE=1 npx vitest run src/comfyui/__tests__/live-smoke.test.ts`
   - Expect `Tests 2 passed | 0 skipped`, exit 0.
   - **If live-smoke fails with `COMFYUI_ENDPOINT_DRIFT`** → the healthcheck is catching drift that the probe missed; run the probe again and investigate the matrix.
   - **If live-smoke fails with `COMFYUI_API_ERROR: 401 Unauthorized` from `POST /api/prompt` AND the probe still passes on `/api/system_stats`** → per-endpoint scope asymmetry. The key authenticates read endpoints but is not authorised for submit. Rotate to a fresh key; if that also fails, contact ComfyUI Cloud support — the account itself may be submit-gated (verification, payment, tier restriction).
   - **If live-smoke fails with `COMFYUI_API_ERROR: ... prompt_outputs_failed_validation`** → the smoke workflow's checkpoint name isn't available on the current account tier. Inspect the error's `node_errors.<n>.errors[0].details` for the list of available checkpoints, then set `COMFYUI_SMOKE_CHECKPOINT=<available-ckpt>` and retry.
   - **If live-smoke fails with `COMFYUI_API_ERROR` unrelated to the above** → possibly a transient Cloud outage. Retry once; if still failing, halt and consult ComfyUI Cloud status.

6. **Update memory and optionally commit docs.**
   - If the base or `HEALTHCHECK_PATH` changed, update `07-VERIFICATION.md §1` with the new probe matrix and run timestamps.
   - Per D-EP-15, also update `reference_env_comfyui_key.md` to reflect the new locked base (memory hygiene — Plan 08 pattern).

---

## 4. Fallback-If-Redirected and Memory Hygiene

### Redirect allowlist (D-GEN-22)

`ComfyUIClient.download()` fetches the signed-URL via a two-hop redirect pattern:
1. `GET /api/view` → 302 with `Location` header.
2. `GET <signed-url>` → 200 with the file stream (API key dropped on the second hop per ComfyUI Cloud docs).

The redirect target hostname MUST match one of the patterns in `DEFAULT_ALLOWED_HOST_PATTERNS` at `src/comfyui/client.ts:228`:

```typescript
const DEFAULT_ALLOWED_HOST_PATTERNS: RegExp[] = [
  /(^|\.)cloud\.comfy\.org$/,
  /(^|\.)googleapis\.com$/,
  /(^|\.)amazonaws\.com$/,
  /(^|\.)r2\.cloudflarestorage\.com$/,
];
```

If the probe or live-smoke surfaces a redirect to a host NOT on the allowlist, the download fails with `COMFYUI_API_ERROR: Unexpected redirect host: <host>`. Two remediation paths:

- **Runtime override:** set `COMFYUI_ALLOWED_REDIRECT_HOSTS=<host>` in `.env` (comma-separated, matched as EXACT or `.<host>` suffix per IS-01). No code change.
- **Code update:** add the new regex pattern to `DEFAULT_ALLOWED_HOST_PATTERNS` in `src/comfyui/client.ts:228`. Requires a code review because it widens the SSRF allowlist; prefer the runtime override for one-off probes.

The Phase 7 live-smoke (Plans 06) observed signed-URL host `storage.googleapis.com` — inside the existing `googleapis.com` pattern. No widening needed.

### Memory hygiene (D-EP-15)

Post-Phase-7 state of the three relevant project memories (updated by Plan 08):

- `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/project_comfy_api_endpoint_drift.md` — removed entirely per D-EP-15 (criterion met: live-smoke green for the second consecutive run per Pitfall #5, Plan 06 delivered this).
- `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/reference_env_comfyui_key.md` — body updated to reflect the locked `COMFYUI_API_BASE=https://cloud.comfy.org`, with a closing sentence referencing §2 Credential Layout and §3 Rotation Procedure in this document. `description` + `originSessionId` frontmatter fields preserved byte-for-byte.
- `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/MEMORY.md` — index entries updated to match: line 2 rewritten with the locked base, line 3 (drift entry) removed.

If a future agent encounters endpoint-drift symptoms and the drift-memory is gone, this document is the canonical reference — start at §3 Rotation Procedure.

### Downstream client translation (D-EP-16, D-EP-17)

Phase 7 Plan 06 surfaced two Phase 2 tech-debt issues that required Rule 3 blocking fixes during live-smoke acceptance:

- **D-EP-16 (`b06d097`):** `normalizeCloudStatus` module-level helper in `src/comfyui/client.ts` translates ComfyUI Cloud's on-the-wire terminal strings (`"success"`, `"error"`) to the engine's canonical `StatusResponse['status']` vocabulary (`"completed"`, `"failed"`). Kept as defense-in-depth even after D-EP-17 switched to the canonical-vocabulary plural endpoint — undocumented intermediate states map to `"pending"` so the poll loop keeps trying rather than prematurely advancing downstream state.
- **D-EP-17 (`b94a8df`):** `ComfyUIClient.status()` URL switched from singular `/api/job/{id}/status` (dispatch-state only; no outputs) to plural `/api/jobs/{id}` (full execution record). `extractOutputs` helper flattens the nested `outputs[nodeId][mediaType][]` shape to a flat `ComfyOutput[]`. `error_message` top-level fallback handles failed-job worker tracebacks.

Both fixes are isolated to `src/comfyui/client.ts` + its test file. Engine-facing types (`StatusResponse`, `ComfyOutput`) unchanged — the translation layer is entirely at the client boundary, keeping the engine Cloud-vocabulary-free.

---

_Verified: 2026-04-24T21:35:00Z_
_Verifier: Claude (Plan 07 executor)_
