# Phase 7: ComfyUI Endpoint Reconciliation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `07-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 07-comfyui-endpoint-reconciliation
**Areas discussed:** Endpoint discovery method, Endpoint resilience (lock-one vs runtime probe), Resolution documentation home, Drift sentinel

---

## Endpoint Discovery Method

| Option | Description | Selected |
|--------|-------------|----------|
| Probe script first | scripts/probe-comfy-endpoint.mts hits a base × path matrix with current key, reports status. Cheap, repeatable, no credit burn. | ✓ |
| Docs first, then probe | Re-read docs.comfy.org for any 2026 changes; only probe if docs ambiguous. | |
| Contact ComfyUI directly | Internal channel — ask ComfyUI org which base/key pairing the Cloud team blesses today. | |
| Trust existing key, brute-probe paths | Assume .env key is current; brute-force path discovery against api.comfy.org only. | |

**User's choice:** Probe script first.
**Notes:** Aligns with Phase 2's already-completed docs cross-reference (cloud.comfy.org confirmed 2026-04-20) and the "don't punt on tests" memory rule. Probe gives current ground-truth.

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only probes | GET /api/queue, /api/system_stats, /api/history, /. Confirms auth + base without queuing a generation. | ✓ |
| Read + minimal submit dry-run | Adds POST /api/prompt with `{}` body; 400 = route exists, 404 = wrong route. | |
| Full submit + status round-trip | Probe IS the live-smoke test; burns one cheap generation per attempt. | |

**User's choice:** Read-only probes.
**Notes:** Zero credits, safe to run repeatedly. Dry-run POST kept as Claude's Discretion add-on if useful evidence.

| Option | Description | Selected |
|--------|-------------|----------|
| scripts/probe-comfy-endpoint.mts, manual one-shot | Developer runs `npx tsx scripts/...` after suspected drift or post-rotation. Gitignored from CI. | ✓ |
| src/comfyui/__tests__/endpoint-probe.test.ts (gated) | Live test variant gated like live-smoke; co-located with verification story. | |
| Both — script for ad-hoc, test for CI rotation gate | scripts/ + tests/ versions, nightly CI run. | |

**User's choice:** scripts/ manual one-shot.
**Notes:** The drift-sentinel area added a separate gated test (D-EP-13) for the recurring case, so this script stays purely manual.

| Option | Description | Selected |
|--------|-------------|----------|
| https://cloud.comfy.org | DEFAULT_COMFYUI_API_BASE in current code + .env.example. /api/prompt path exists; key returned 401 on 2026-04-22. | ✓ |
| https://api.comfy.org | Memory says current .env points here; key accepted (no 401) but /api/prompt 404s — suggests right path lives at versioned prefix. | ✓ |
| https://www.comfy.org/api | Speculative; sometimes API lives under www. One probe rules out. | ✓ |
| Whatever docs.comfy.org currently lists | Probe fetches the canonical docs page for current advertised base; defends against future drift. | ✓ |

**User's choice:** All four (multiSelect).
**Notes:** Wide initial sweep is cheap and surfaces drift to a brand-new base if one exists.

---

## Endpoint Resilience (lock-one vs runtime probe)

| Option | Description | Selected |
|--------|-------------|----------|
| Lock one base + first-submit healthcheck | Probe winner becomes new DEFAULT_COMFYUI_API_BASE in client.ts + .env + .env.example. First-submit cheap GET healthcheck; on 401/404 throws COMFYUI_ENDPOINT_DRIFT. | ✓ |
| Lock one base, no healthcheck | Just update default; no healthcheck. First submit either works or surfaces COMFYUI_API_ERROR with underlying 4xx/5xx. | |
| Runtime probe + fallback list | Client takes COMFYUI_API_BASES=primary,secondary; on boot probes each in order, first 200 wins. | |
| Manual rotation runbook only, no code change | Probe script + documented procedure are enough; user/ops updates .env when drift hits. | |

**User's choice:** Lock one base + first-submit healthcheck.
**Notes:** Single source of truth + fast-fail on next drift. Avoids surface-area growth from multi-base fallback for an internal demo.

| Option | Description | Selected |
|--------|-------------|----------|
| GET /api/queue (or whatever probe found) | Reuse the same read-only endpoint the probe script identified as known-200. Same auth path. | ✓ |
| GET / (root) with no body assertion | Cheapest possible check; root returns 200 on most ComfyUI deployments. | |
| OPTIONS /api/prompt (preflight) | Confirms prompt route exists without burning a job; some servers return 405 for OPTIONS. | |
| No healthcheck — skip this question | Selected if you picked "Lock no healthcheck" or "Manual rotation runbook only" above. | |

**User's choice:** GET /api/queue (or whatever probe found).
**Notes:** Probe winner doubles as healthcheck path — no separate convention to maintain.

| Option | Description | Selected |
|--------|-------------|----------|
| TypedError COMFYUI_ENDPOINT_DRIFT with hint | New typed error joining D-GEN-40 family; hint points at the probe script + .env update path. | ✓ |
| Reuse COMFYUI_API_ERROR with enriched hint | No new code; existing COMFYUI_API_ERROR with hint that mentions the probe script. | |
| Reuse COMFYUI_CREDENTIALS_MISSING | Misleading — 401 could be drift OR a real key issue. | |
| stderr warning only, don't fail submit | Log warning, let submit proceed; underlying error surfaces naturally. | |

**User's choice:** TypedError COMFYUI_ENDPOINT_DRIFT with hint.
**Notes:** Distinct code makes the error category easy to grep + future agent UX clear about what went wrong vs other COMFYUI_API_ERROR causes.

| Option | Description | Selected |
|--------|-------------|----------|
| Pin to working base, treat drift as ops event | Internal product proposal targeting a single Cloud API; probe + healthcheck handle drift; don't over-engineer for multi-tenant in v1. | ✓ |
| Document multi-base pattern as v2 | Lock one now, but add a note that multi-base routing belongs in v2 (REQUIREMENTS.md ROUTE-* tracks this). | |
| Allow override via env, no other code | COMFYUI_API_BASE already overridable via .env (D-GEN-09); just lock new default and let advanced users handle resilience. | |

**User's choice:** Pin to working base, treat drift as ops event.
**Notes:** Multi-base routing already tracked in REQUIREMENTS.md v2 ROUTE-* — captured in deferred ideas section of CONTEXT.md.

---

## Resolution Documentation Home

| Option | Description | Selected |
|--------|-------------|----------|
| 07-VERIFICATION.md, brief 02-VERIFICATION supplement | Phase 7 produces own VERIFICATION.md per standard GSD shape; cross-reference from 1-paragraph supplement at bottom of 02-VERIFICATION.md. | ✓ |
| Append section to 02-VERIFICATION.md only | No 07-VERIFICATION.md; new ## Endpoint Reconciliation section appended to 02-VERIFICATION. | |
| Standalone .planning/runbooks/comfyui-endpoint.md | Operational runbook lives outside phase tree; creates new directory pattern we don't have. | |
| ADR in .planning/decisions/ | ADR-style note; project doesn't currently have ADR practice. | |

**User's choice:** 07-VERIFICATION.md + 02-VERIFICATION supplement.
**Notes:** Lives where future audits look first; cross-reference makes it discoverable from the Phase 2 entry point too.

| Option | Description | Selected |
|--------|-------------|----------|
| Probe matrix + chosen base | Dated table from probe-comfy-endpoint.mts (base × path × status) + the single COMFYUI_API_BASE picked + 1-2 sentences of rationale. | ✓ |
| Credential layout / source-of-truth | Where key lives, how loaded, how surfaced in tests. Per SC-3 explicitly. | ✓ |
| Rotation procedure | Step-by-step rotation procedure that survives next rotation. | ✓ |
| Fallback-if-redirected + memory hygiene | Existing DEFAULT_ALLOWED_HOST_PATTERNS + COMFYUI_ALLOWED_REDIRECT_HOSTS override + post-resolution memory updates. | ✓ |

**User's choice:** All four (multiSelect).
**Notes:** Each section maps to an SC-3 sub-clause or a maintenance-need surfaced during discussion.

| Option | Description | Selected |
|--------|-------------|----------|
| Both updated to reflect new state | drift memory marked RESOLVED (or removed); reference memory updated with new locked base. | ✓ |
| Drift memory removed, reference updated | Drift memory served its purpose; once live-smoke green, delete cleanly. | |
| Leave memories alone, doc supersedes | Memories are point-in-time; resolution doc is new source of truth. | |

**User's choice:** Both updated to reflect new state.
**Notes:** Mark-resolved-or-remove is the actual contract — leaves Claude judgment on whether deletion is safe based on consecutive-green live-smoke runs.

---

## Drift Sentinel

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — endpoint-probe.test.ts | New src/comfyui/__tests__/endpoint-probe.test.ts gated on RUN_PROBE=1 + COMFYUI_API_KEY. Manual ad-hoc + future CI use. | ✓ |
| No — healthcheck + probe script are enough | First-submit healthcheck + scripts/probe-comfy-endpoint.mts cover both runtime and ad-hoc cases. | |
| Yes — nightly GitHub Action only | No new test file; nightly workflow runs probe script with key as secret, posts to channel on red. | |
| Yes — both endpoint-probe.test.ts AND nightly | Test for ad-hoc and CI use, plus nightly automation. Most paranoid. | |

**User's choice:** Yes — endpoint-probe.test.ts.
**Notes:** Gives the manual-run safety net without committing to nightly CI infra we don't currently have. Nightly captured as deferred idea.

| Option | Description | Selected |
|--------|-------------|----------|
| Healthcheck endpoint returns 200 | GET against locked COMFYUI_API_BASE + chosen healthcheck path with X-API-Key; assert status 200. One assertion. | ✓ |
| Healthcheck + /api/prompt route exists check | Two assertions: read endpoint 200 + POST /api/prompt with empty body 400 (proves route exists). | |
| Full probe matrix re-run | Re-runs full base × path matrix from probe script and asserts chosen pairing still wins. | |

**User's choice:** Healthcheck endpoint returns 200.
**Notes:** Same shape as runtime healthcheck (D-EP-07) — they share intent and the path constant. Keeps the test narrow and the failure mode unambiguous.

| Option | Description | Selected |
|--------|-------------|----------|
| Add 1 skipped (default), reachable via RUN_PROBE=1 | Joins live-smoke as skipped-by-default; total skipped becomes baseline+1. Standard pattern, audit-friendly. | ✓ |
| Add to live-smoke.test.ts as a nested describe | Co-locate with live-smoke; same RUN_LIVE_SMOKE=1 + key gate. | |
| New gate variable RUN_PROBE=1 (separate from RUN_LIVE_SMOKE) | Two distinct gates; probe is safe to run more freely. | |

**User's choice:** Add 1 skipped (default), reachable via RUN_PROBE=1.
**Notes:** This option also implies the new RUN_PROBE=1 gate (third option's content) — they're the same in practice; the chosen option just frames it via the audit-count consequence.

---

## Claude's Discretion

Areas where the user explicitly deferred to Claude during planning/execution:

- Probe script output format (Markdown table to stdout vs structured JSON via `--json` flag)
- Healthcheck path constant naming (`HEALTHCHECK_PATH` vs `ENDPOINT_PROBE_PATH` vs `KNOWN_GOOD_GET_PATH`)
- Probe script docstring style (matching `scripts/inspector-smoke.mjs`)
- Whether the discovery probe (one-shot, manual) ALSO does a single dry-run POST that expects 4xx — useful evidence in the matrix but not required by D-EP-02
- Exact 02-VERIFICATION.md supplement wording (one paragraph + link is the contract; phrasing is the writer's choice)
- Whether to add `COMFYUI_ENDPOINT_DRIFT` to `stdio-hygiene.test.ts` no-leak assertions
- Whether the probe script tries `/api/v1/prompt` and `/v1/prompt` path variants beyond the read-only set (evidence-only diagnostic)

## Deferred Ideas

Mentioned during discussion, captured in 07-CONTEXT.md `<deferred>` section for future phases:

- Multi-base routing / `COMFYUI_API_BASES=primary,secondary` fallback list (v2 ROUTE-01..03)
- Nightly GitHub Action that runs the probe script with key as a secret
- Credential vault / auto-rotation tooling
- ADR practice (`.planning/decisions/` directory)
- Standalone `.planning/runbooks/` directory
- Healthcheck for `status` and `download` paths (in addition to first-submit healthcheck)
- POST `/api/prompt` `{}`-body dry-run probe assertion in the script
- Re-issuing the API key as part of Phase 7 (out of scope; manual user action documented in rotation procedure)
