---
phase: 07-comfyui-endpoint-reconciliation
plan: 01
subsystem: infra
tags: [phase-07, probe, endpoint-reconciliation, comfyui, diagnostic, operator-script]

# Dependency graph
requires:
  - phase: 02-comfyui-generation
    provides: "X-API-Key auth pattern (D-GEN-21), dotenv load pattern (D-GEN-09), secret-scrubbing log convention (D-GEN-12), DEFAULT_COMFYUI_API_BASE constant in src/comfyui/client.ts:34"
provides:
  - "scripts/probe-comfy-endpoint.mts — one-shot read-only base × path matrix probe against live ComfyUI Cloud API"
  - "Authoritative (base, path) winner: https://cloud.comfy.org + /api/system_stats — locks DEFAULT_COMFYUI_API_BASE and HEALTHCHECK_PATH for Plans 02 + 03"
  - "Auth-method-per-endpoint quirk observation — /queue and /history reject the same key that /system_stats accepts"
affects: [07-02, 07-03, 07-07, comfyui-client, live-smoke, endpoint-probe-sentinel, 02-VERIFICATION]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Operator diagnostic script shape (mirrors scripts/inspector-smoke.mjs): shebang + dotenv/config side-effect + JSDoc exit-code matrix + ANSI helpers + SUMMARY block + documented process.exit(N)"
    - "Read-only probe matrix with AbortController 5s timeout per request, redirect: 'manual', X-API-Key header, snippet scrubbed via replaceAll(apiKey, '[redacted]')"
    - "Graceful degradation for external docs fetch (Landmine 5): log-and-continue on failure, never throw"
    - "Documented 5-tier exit-code matrix (0=winner, 1=all-401=rotate-key, 2=endpoint-drift-beyond-matrix, 3=missing-key, 4=docs-fail-and-hardcoded-fail)"

key-files:
  created:
    - "scripts/probe-comfy-endpoint.mts (Task 1, commit a32f518)"
    - ".planning/phases/07-comfyui-endpoint-reconciliation/07-01-SUMMARY.md"
  modified: []

key-decisions:
  - "Probe-winner base: https://cloud.comfy.org — only hardcoded base that returned 200 on any read-only path with the current X-API-Key"
  - "Healthcheck path: /api/system_stats — the ONLY /api/* path under cloud.comfy.org that authenticates with the current key format; /api/queue returns 401 'invalid API key', /api/history returns 401 'authentication method not allowed'"
  - "Plans 02 + 03 will substitute <WINNING_BASE>=https://cloud.comfy.org and <HEALTHCHECK_PATH>=/api/system_stats verbatim into DEFAULT_COMFYUI_API_BASE, HEALTHCHECK_PATH constant, .env, and .env.example"
  - "docs.comfy.org/development/cloud/overview fetch failed during the probe run — Landmine 5 graceful degradation kicked in; probe proceeded with 3 hardcoded bases only and still produced an unambiguous winner"

patterns-established:
  - "Operator diagnostic script: shebang at line 1, `import 'dotenv/config'` at line 2, JSDoc with documented exit codes, ANSI helper object, check()/results pattern from inspector-smoke.mjs, final SUMMARY block, documented process.exit(N)"
  - "Probe helper pattern: AbortController-wrapped fetch + manual-redirect + X-API-Key header + first-200-bytes body snippet with API-key scrubber — reusable shape for the D-EP-13 sentinel test"
  - "Auth-method-per-endpoint awareness: not all /api/* paths on cloud.comfy.org accept the same auth method with the same key; healthcheck path selection MUST use the endpoint that returned 200 in the probe matrix, not an arbitrary /api/* path"

requirements-completed: []

# Metrics
duration: ~12min (Task 1 scaffold + checkpoint) + operator probe run
completed: 2026-04-24
---

# Phase 7 Plan 01: Endpoint Probe Scaffold Summary

**Read-only matrix probe `scripts/probe-comfy-endpoint.mts` identifies `https://cloud.comfy.org` + `/api/system_stats` as the single (base, path) combo that authenticates with the current COMFYUI_API_KEY — locks the default base and healthcheck path for Phase 7 Plans 02 + 03.**

## Performance

- **Duration:** ~12 min scaffold + operator probe run
- **Completed:** 2026-04-24
- **Tasks:** 2 (1 auto + 1 human-action checkpoint)
- **Files created:** 1 source artifact (`scripts/probe-comfy-endpoint.mts`) + 1 plan summary
- **Files modified:** 0
- **ComfyUI credits burned:** 0 (GET-only matrix confirmed)

## Accomplishments

- Delivered `scripts/probe-comfy-endpoint.mts` — a one-shot operator diagnostic that walks a base × path matrix against the live ComfyUI Cloud API with the current `COMFYUI_API_KEY`, prints a human-readable status-code matrix, and exits 0/1/2/3/4 per the Landmine 3 contract. Script is standalone (no `src/` imports) with a 5000ms `AbortController` timeout per probe, `redirect: 'manual'` (anti-SSRF), and a snippet scrubber that replaces the raw key with `[redacted]` before logging.
- Operator ran the probe and captured the authoritative matrix — see **Probe Matrix Result** section below (verbatim for 07-VERIFICATION.md §1 transcription in Plan 07).
- Resolved the 2026-04-22 drift memory contradiction: `cloud.comfy.org` is the live base; `api.comfy.org` returns 404 on every probed path; `www.comfy.org/api/` is HTML marketing site, not an API.
- Identified an auth-method-per-endpoint quirk: `/api/queue` and `/api/history` reject the X-API-Key with different 401 messages, while `/api/system_stats` accepts it with 200. This narrows Plan 02's healthcheck path choice to `/api/system_stats` specifically, not just "any /api/* GET".

## Task Commits

Each task was committed atomically:

1. **Task 1: Create `scripts/probe-comfy-endpoint.mts`** — `a32f518` (feat)
2. **Task 2: Operator runs probe + reports winner** — checkpoint (human-action, no code commit; matrix result captured below)

**Plan metadata:** this SUMMARY commit (docs)

## Files Created/Modified

- `scripts/probe-comfy-endpoint.mts` — NEW. One-shot operator diagnostic. Walks 3 hardcoded bases × 4 read-only paths with X-API-Key, prints ANSI-coloured matrix, exits 0/1/2/3/4 per documented contract. Addresses all 7 probe landmines (dotenv cwd echo, tsx+.mts, exit-code matrix, AbortController timeout, docs-fetch graceful degradation, secret hygiene, missing-key fail-fast).

## Probe Matrix Result

Operator ran `npx tsx scripts/probe-comfy-endpoint.mts` from repo root on 2026-04-24 with the live `COMFYUI_API_KEY` (last-4 `43da`). Verbatim output (preserved for 07-VERIFICATION.md §1 transcription in Plan 07):

```
── ComfyUI Endpoint Probe (Phase 7, D-EP-01..05) ──
  cwd: /Users/macapple/comfyui-vfx-mcp
  key: ****43da
  timeout per probe: 5000ms

  note: docs fetch failed — proceeding with hardcoded bases only

  401  https://cloud.comfy.org/api/queue  (308ms)
       {"message":"invalid API key"}
  200  https://cloud.comfy.org/api/system_stats  (163ms)
       {"devices":[],"system":{"argv":[],"cloud_version":"v0.82.0","comfyui_version":"v0.19.5","embedded_py
  401  https://cloud.comfy.org/api/history  (82ms)
       {"message":"authentication method not allowed"}
  200  https://cloud.comfy.org/  (87ms)
       <!doctype html> <html lang="en">   <head>     <meta charset="UTF-8" />     <title>ComfyUI</title>
  404  https://api.comfy.org/api/queue  (204ms)
       {"message":"Not Found"}
  404  https://api.comfy.org/api/system_stats  (191ms)
       {"message":"Not Found"}
  404  https://api.comfy.org/api/history  (90ms)
       {"message":"Not Found"}
  404  https://api.comfy.org/  (98ms)
       {"message":"Not Found"}
  404  https://www.comfy.org/api/api/queue  (177ms)
       The page could not be found  NOT_FOUND  sfo1::zdpvx-1777054239891-498d0ab2855f
  404  https://www.comfy.org/api/api/system_stats  (52ms)
       The page could not be found  NOT_FOUND  sfo1::tthf6-1777054239951-370b66895807
  404  https://www.comfy.org/api/api/history  (59ms)
       The page could not be found  NOT_FOUND  sfo1::lwl9p-1777054240009-ac5fc3cf6cc5
  200  https://www.comfy.org/api/  (55ms)
       <!DOCTYPE html><html lang="en" class="overflow-x-clip"> <head><meta charset="utf-8"><meta name="view

── SUMMARY ──
  WINNER: https://cloud.comfy.org/api/system_stats → 200
  Use this as DEFAULT_COMFYUI_API_BASE (https://cloud.comfy.org) and HEALTHCHECK_PATH (/api/system_stats) in Phase 7 plans 02 + 03.
```

**Probe exit code:** `0` (winner found — per Landmine 3 matrix)

## Winner (authoritative for Plans 02 + 03)

| Constant                       | Value                        | Lock site                                                                 |
| ------------------------------ | ---------------------------- | ------------------------------------------------------------------------- |
| `DEFAULT_COMFYUI_API_BASE`     | `https://cloud.comfy.org`    | `src/comfyui/client.ts:34` (Plan 02), `.env` + `.env.example` (Plan 03)   |
| `HEALTHCHECK_PATH`             | `/api/system_stats`          | `src/comfyui/client.ts` exported const (Plan 02), used by D-EP-13 sentinel (Plan 04) and D-EP-07 first-submit healthcheck (Plan 02) |

Plan 02 (`ensureEndpointHealthy` + `HEALTHCHECK_PATH` export) and Plan 03 (`.env` + `.env.example` edits) MUST substitute these two values verbatim. No other combo returned 200 under any hardcoded base.

## Decisions Made

- **Healthcheck path: `/api/system_stats` (not `/api/queue`).** The D-EP-07 sketch originally suggested `/api/queue` as the canonical healthcheck candidate. The live probe matrix forced a revision: `/api/queue` returns `401 {"message":"invalid API key"}` with the exact same X-API-Key that `/api/system_stats` accepts with 200. The safe healthcheck path is therefore the one that actually authenticates — `/api/system_stats`. Plan 02 `ensureEndpointHealthy()` will target `/api/system_stats`; Plan 04 sentinel test will assert 200 against the same path.
- **`www.comfy.org/api/` 200 ignored.** The 200 returned by `https://www.comfy.org/api/` (no path suffix) is the HTML marketing homepage body (`<!DOCTYPE html>...`), not a usable JSON API endpoint. The probe `WINNER` selection correctly picks the first `status === 200` in matrix iteration order, which is `cloud.comfy.org/api/system_stats` — the genuine API 200 — not the marketing page. No change needed; recording here so Plan 07's 07-VERIFICATION.md narrative can call this out.

## Deviations from Plan

### Plan-driven / expected findings (not deviations)

**1. [Expected - Landmine 5] Docs-fetch graceful degradation triggered**

- **Found during:** Task 2 (operator probe run)
- **Observation:** `docs.comfy.org/development/cloud/overview` fetch failed at probe time; the script logged `note: docs fetch failed — proceeding with hardcoded bases only` and continued with the 3 hardcoded bases. This is the exact Landmine 5 contract.
- **Impact:** None. The hardcoded base `cloud.comfy.org` won the matrix; the docs-advertised base would only have mattered if all hardcoded bases failed.
- **Follow-up:** Plan 07's 07-VERIFICATION.md §2 should note that the probe's docs-fetch is a discovery nicety, not a correctness dependency. If docs drift to a new base in the future, the probe's Landmine 5 fallback still surfaces the issue via exit code 4 (docs fail AND hardcoded fail).

### Auto-fixed Issues

None — Task 1 implemented the plan verbatim; Task 2 was a human-action checkpoint with no code path.

---

**Total deviations:** 0 auto-fixed; 1 plan-driven expected finding (docs-fetch fallback confirmed working as designed)
**Impact on plan:** Zero scope creep. The probe's matrix correctly handles both expected and degraded-discovery paths.

## Issues Encountered

**1. Auth-method-per-endpoint asymmetry on cloud.comfy.org (captured for Plan 02 awareness)**

- **What:** The same X-API-Key that authenticates for `GET /api/system_stats` (200) is rejected by `GET /api/queue` (401 `"invalid API key"`) and `GET /api/history` (401 `"authentication method not allowed"`) on the same host.
- **Why this matters:** If Plan 02's `ensureEndpointHealthy()` were written against `/api/queue` (the original D-EP-07 candidate path), it would ALWAYS 401 with the current key — causing every process to throw `COMFYUI_ENDPOINT_DRIFT` on first submit. Plan 02 MUST use `/api/system_stats` as the `HEALTHCHECK_PATH` (locked by this probe's matrix).
- **Hypothesis (not required to verify in Phase 7):** ComfyUI Cloud may be routing `/api/queue` and `/api/history` through a different auth layer (perhaps expecting a session cookie or workflow-scoped key), while `/api/system_stats` accepts plain X-API-Key. Immaterial to Phase 7's scope — we just pick the endpoint that works.
- **Resolution:** Lock `HEALTHCHECK_PATH = '/api/system_stats'` in Plan 02; call this out in 07-VERIFICATION.md §1 so future maintainers understand the non-obvious path choice.

## User Setup Required

None — no external service configuration introduced by this plan. The probe reuses the existing `.env` / `COMFYUI_API_KEY` layout from Phase 2 (D-GEN-09).

## Next Phase Readiness

- **Plan 07-02 (Wave 2, client healthcheck + typed error) is unblocked.** Consumes `<WINNING_BASE>=https://cloud.comfy.org` and `<HEALTHCHECK_PATH>=/api/system_stats` from this summary.
- **Plan 07-03 (Wave 2, `.env` + `.env.example` update) is unblocked.** Consumes the same two values.
- **No blockers.** Probe is a zero-credit read-only diagnostic — safe to re-run after any future drift or key rotation.
- **Note for Plan 07-07 (final verification / memory hygiene):** the auth-method-per-endpoint quirk should be called out explicitly in 07-VERIFICATION.md §1 as a known-and-accepted ComfyUI Cloud behaviour, so a future maintainer rewriting the healthcheck doesn't naively switch to `/api/queue` expecting it to work.

## Self-Check

- [x] `scripts/probe-comfy-endpoint.mts` exists (verified — commit `a32f518` artifact present in working tree)
- [x] Task 1 commit `a32f518` present in `git log --oneline` (verified: `a32f518 feat(07-01): add probe-comfy-endpoint.mts diagnostic script`)
- [x] Verbatim probe matrix captured above
- [x] Winner `(https://cloud.comfy.org, /api/system_stats)` captured with lock-site table
- [x] Auth-method-per-endpoint quirk documented for Plan 02 consumption
- [x] Landmine 5 (docs-fetch fallback) deviation noted
- [x] Exit code 0 recorded; zero credits burned
- [x] Task 1 artifact left unmodified (no re-commits to `scripts/probe-comfy-endpoint.mts`)

## Self-Check: PASSED

---
*Phase: 07-comfyui-endpoint-reconciliation*
*Plan: 01*
*Completed: 2026-04-24*
