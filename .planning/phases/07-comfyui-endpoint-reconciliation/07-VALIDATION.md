---
phase: 07
slug: comfyui-endpoint-reconciliation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Phase 7 is a gap-closure phase (`phase_req_ids: null`) — success is measured against the 3 roadmap Success Criteria (SC-1, SC-2, SC-3) rather than REQ-IDs.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.4 |
| **Config file** | `/Users/macapple/comfyui-vfx-mcp/vitest.config.ts` (root; node environment; excludes `packages/**`) |
| **Quick run command** | `npx vitest run src/comfyui/__tests__/ src/__tests__/stdio-hygiene.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Live-smoke gate** | `RUN_LIVE_SMOKE=1 npx vitest run src/comfyui/__tests__/live-smoke.test.ts` |
| **Probe sentinel gate** | `RUN_PROBE=1 npx vitest run src/comfyui/__tests__/endpoint-probe.test.ts` |
| **Baseline (pre-Phase 7)** | 735 passed / 2 skipped tests across 45 passed / 1 skipped files |
| **Projected (post-Phase 7)** | 735+N passed / 3 skipped tests across 46 passed / 1 skipped files |
| **Estimated runtime (full)** | ~40 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/comfyui/__tests__/ src/__tests__/stdio-hygiene.test.ts src/__tests__/tool-budget.test.ts src/__tests__/architecture-purity.test.ts`
- **After every plan wave:** Run `npx vitest run` (full suite — target 735+ passing, 3 skipped)
- **After every plan wave (with live key available):** Run `RUN_PROBE=1 npx vitest run endpoint-probe`
- **Phase gate (SC-2):** `RUN_LIVE_SMOKE=1 npx vitest run src/comfyui/__tests__/live-smoke.test.ts` returns green (both live-smoke tests must pass)
- **Phase gate (SC-1, SC-3):** manual review of `07-VERIFICATION.md` content + probe-matrix table completeness
- **Max feedback latency:** ~15 seconds (quick run); ~40 seconds (full suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Success Criterion | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-XX | 01 | 0/1 | SC-1 | — | Probe script loads `.env` via dotenv, sends `X-API-Key` (never logs raw key — last-4 only) | manual (operator) | `npx tsx scripts/probe-comfy-endpoint.mts` | ❌ W0 — `scripts/probe-comfy-endpoint.mts` | ⬜ pending |
| 07-01-XX | 01 | 1 | SC-1 | — | Probe exits non-zero with actionable message if all bases return 401 | manual (operator) | `npx tsx scripts/probe-comfy-endpoint.mts` | ❌ W0 | ⬜ pending |
| 07-02-XX | 02 | 2 | SC-1 | T-drift | `DEFAULT_COMFYUI_API_BASE` in `src/comfyui/client.ts:34` matches winning probe base | unit | `npx vitest run src/comfyui/__tests__/client.test.ts` | existing — extend | ⬜ pending |
| 07-02-XX | 02 | 2 | SC-1 | T-drift | `HEALTHCHECK_PATH` exported from `src/comfyui/client.ts` | unit | `npx vitest run src/comfyui/__tests__/client.test.ts` | existing — extend | ⬜ pending |
| 07-04-XX | 04 | 2 | SC-2 | T-drift | `ensureEndpointHealthy()` fires exactly once per `ComfyUIClient` instance (cache hit on subsequent submits) | unit | `npx vitest run src/comfyui/__tests__/client.test.ts` | ❌ W0 — extend existing file | ⬜ pending |
| 07-04-XX | 04 | 2 | SC-2 | T-drift | Healthcheck race-safe: concurrent `submit()` calls share one healthcheck fetch (no N+1 probes) | unit | `npx vitest run src/comfyui/__tests__/client.test.ts` | ❌ W0 — extend existing file | ⬜ pending |
| 07-04-XX | 04 | 2 | SC-2 | T-drift | Healthcheck failure throws `TypedError('COMFYUI_ENDPOINT_DRIFT', ...)` with actionable hint naming the probe script | unit | `npx vitest run src/comfyui/__tests__/client.test.ts` | ❌ W0 — extend existing file | ⬜ pending |
| 07-04-XX | 04 | 2 | SC-2 | T-drift | Healthcheck cache reopens on new `ComfyUIClient` instance (no global static leak) | unit | `npx vitest run src/comfyui/__tests__/client.test.ts` | ❌ W0 — extend existing file | ⬜ pending |
| 07-05-XX | 05 | 3 | SC-1 | — | Sentinel test asserts `GET ${BASE}${HEALTHCHECK_PATH}` with `X-API-Key` returns 200; gated on `RUN_PROBE=1` + `COMFYUI_API_KEY` | unit (opt-in) | `RUN_PROBE=1 COMFYUI_API_KEY=… npx vitest run endpoint-probe` | ❌ W0 — `src/comfyui/__tests__/endpoint-probe.test.ts` | ⬜ pending |
| 07-05-XX | 05 | 3 | SC-1 | — | Sentinel test is DEFAULT-SKIPPED (skipped count becomes 3 post-Phase 7) | unit | `npx vitest run` (report: `3 skipped`) | — derived | ⬜ pending |
| 07-03-XX | 03 | 2 | SC-1 | — | `.env` `COMFYUI_API_BASE` matches winning probe base | manual (grep) | `grep '^COMFYUI_API_BASE=' .env` | existing — value update | ⬜ pending |
| 07-03-XX | 03 | 2 | SC-1 | — | `.env.example` `COMFYUI_API_BASE` matches winning probe base + rotation comment present | unit | `grep -E '(COMFYUI_API_BASE=|07-VERIFICATION)' .env.example` | existing — value+comment update | ⬜ pending |
| 07-06-XX | 06 | 4 | SC-2 | — | `RUN_LIVE_SMOKE=1 npx vitest run live-smoke` returns a completed job (both tests pass) | integration (live) | `RUN_LIVE_SMOKE=1 COMFYUI_API_KEY=… npx vitest run src/comfyui/__tests__/live-smoke.test.ts` | existing — no modification | ⬜ pending |
| 07-06-XX | 06 | 4 | Regression | — | Existing full suite stays green (735+N passed, 3 skipped) | unit+integration | `npx vitest run` | existing | ⬜ pending |
| 07-06-XX | 06 | 4 | Regression | — | `stdio-hygiene.test.ts` still passes (no stdout leak from healthcheck/probe) | unit | `npx vitest run src/__tests__/stdio-hygiene.test.ts` | existing — no change | ⬜ pending |
| 07-06-XX | 06 | 4 | Regression | — | `tool-budget.test.ts` still reports 7 tools | unit | `npx vitest run src/__tests__/tool-budget.test.ts` | existing — no change | ⬜ pending |
| 07-06-XX | 06 | 4 | Regression | — | `architecture-purity.test.ts` still passes (no MCP deps leak into `src/comfyui/`) | unit | `npx vitest run src/__tests__/architecture-purity.test.ts` | existing — no change | ⬜ pending |
| 07-06-XX | 06 | 4 | Regression | — | `transport-parity.test.ts` still passes | unit | `npx vitest run src/__tests__/transport-parity.test.ts` | existing — no change | ⬜ pending |
| 07-07-XX | 07 | 5 | SC-3 | — | `07-VERIFICATION.md` exists with all 4 required sections (D-EP-12) | documentation | `ls .planning/phases/07-comfyui-endpoint-reconciliation/07-VERIFICATION.md` + manual review against D-EP-12 checklist | ❌ W5 — create | ⬜ pending |
| 07-07-XX | 07 | 5 | SC-3 | — | Probe matrix table in `07-VERIFICATION.md` contains actual Wave 1 observations (not placeholders) | documentation | `grep -A20 'Probe Matrix' 07-VERIFICATION.md` + manual review | ❌ W5 — create | ⬜ pending |
| 07-07-XX | 07 | 5 | SC-3 | — | `02-VERIFICATION.md` appended with `## Endpoint Reconciliation (Phase 7, 2026-04-XX)` section + link | documentation | `grep -n 'Endpoint Reconciliation (Phase 7' .planning/phases/02-comfyui-generation/02-VERIFICATION.md` | existing — append | ⬜ pending |
| 07-07-XX | 07 | 5 | SC-3 | — | Rotation procedure executable end-to-end by a new operator (no external consultation needed) | manual | Walk `07-VERIFICATION.md §3 Rotation Procedure` with a fresh key | ❌ W5 — create | ⬜ pending |
| 07-08-XX | 08 | 5 | SC-3 | — | `project_comfy_api_endpoint_drift.md` header marked RESOLVED or file removed | manual | `grep -i 'resolved' ~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/project_comfy_api_endpoint_drift.md` OR confirm removal | existing — update | ⬜ pending |
| 07-08-XX | 08 | 5 | SC-3 | — | `reference_env_comfyui_key.md` body reflects the new locked base | manual | `grep 'COMFYUI_API_BASE' ~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/reference_env_comfyui_key.md` | existing — update | ⬜ pending |
| 07-08-XX | 08 | 5 | SC-3 | — | `MEMORY.md` index entries match the post-Phase 7 memory states | manual | `cat ~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/MEMORY.md` | existing — update | ⬜ pending |

*Task IDs are placeholders (`07-NN-XX`) — planner assigns concrete IDs. Threat refs populated only if Phase 7 security gate surfaces explicit threats (drift-related threats noted as `T-drift`). Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files / scripts that must exist (or be extended) before Wave 2+ execution can assert against them:

- [ ] `scripts/probe-comfy-endpoint.mts` — NEW. Operator one-shot diagnostic. Loads `.env` via `import 'dotenv/config'`. Matrix probe (4 bases × 4 paths) + dynamic docs-advertised base discovery + timeout-per-request + exit-code semantics (0 = green, 10 = no base returned 200 with current key, 20 = all 401 → rotate key guidance).
- [ ] `src/comfyui/__tests__/endpoint-probe.test.ts` — NEW. Sentinel test. Gated on `process.env.COMFYUI_API_KEY && process.env.RUN_PROBE === '1'`. Single assertion: `fetch(${DEFAULT_COMFYUI_API_BASE}${HEALTHCHECK_PATH}, { headers: { 'X-API-Key': COMFYUI_API_KEY }}).status === 200`. Imports `HEALTHCHECK_PATH` from `../client.js`.
- [ ] `src/comfyui/__tests__/client.test.ts` — EXTEND. Add 4 unit cases for `ensureEndpointHealthy()`: (1) success-cache-hit-on-second-submit, (2) failure-throws-COMFYUI_ENDPOINT_DRIFT-with-hint, (3) concurrent-submits-memoize-one-healthcheck, (4) failure-does-not-poison-cache-new-instance-can-recover.

**Framework install:** None needed. Vitest is already installed (^4.1.4) and running 45 test files.

---

## Manual-Only Verifications

| Behavior | Success Criterion | Why Manual | Test Instructions |
|----------|-------------------|------------|-------------------|
| Probe script dynamic docs fetch succeeds AND parses out the currently-advertised base | SC-1 | External HTTP request to `https://docs.comfy.org/development/cloud/overview`; flaky network / HTML structure change would make an automated test brittle. Graceful-degradation path is the code's responsibility; reviewing that it happens is human work. | Run `npx tsx scripts/probe-comfy-endpoint.mts` with network connectivity; verify one row in the matrix is labelled "docs-advertised" and the URL matches what `curl -sL docs.comfy.org/development/cloud/overview \| grep -Ei 'cloud\.comfy\.org\|api\.comfy\.org'` returns. |
| Live-smoke returns a completed job (not just HTTP 200) | SC-2 | Exercises the real ComfyUI Cloud GPU queue; cost + nondeterminism. Gated on `RUN_LIVE_SMOKE=1`; operator-only. | `RUN_LIVE_SMOKE=1 COMFYUI_API_KEY=… npx vitest run src/comfyui/__tests__/live-smoke.test.ts` → both tests pass AND the downloaded image/asset is non-empty. |
| Rotation procedure walks end-to-end | SC-3 | Requires issuing a new key in the ComfyUI Cloud console (external system). Cannot be automated in v1. | With stakeholder present, follow `07-VERIFICATION.md §3 Rotation Procedure` steps 1–5 using a test key, confirm live-smoke goes green post-rotation, then roll back to production key. |
| Resolution documentation is reviewable by a new operator | SC-3 | Subjective writing-quality review. Markdown renders correctly, links resolve, no placeholders. | Open `07-VERIFICATION.md` in a rendered viewer; click every link; verify probe-matrix table cells are concrete values (no `{X}` or TBD). |
| Project memory hygiene is accurate post-resolution | SC-3 | Memory files live outside the repo (`~/.claude/projects/...`) and aren't auto-tested. | `grep -l RESOLVED ~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/project_comfy_api_endpoint_drift.md` OR confirm file removal; `grep COMFYUI_API_BASE ~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/reference_env_comfyui_key.md` shows new locked base. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify OR Wave 0 dependencies OR are listed in the Manual-Only table
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (manual-only tasks clustered at start of Wave 1 and end of Wave 5 — intentional; automated coverage dominates Waves 2–4)
- [ ] Wave 0 covers all MISSING references (probe script, sentinel test, healthcheck unit tests)
- [ ] No watch-mode flags — all commands use `vitest run` (single-run)
- [ ] Feedback latency < 40s for full suite, < 15s for quick run
- [ ] `nyquist_compliant: true` set in frontmatter after planner assigns real task IDs and populates the map

**Approval:** pending
