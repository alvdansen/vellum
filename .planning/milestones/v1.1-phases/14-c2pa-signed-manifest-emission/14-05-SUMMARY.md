---
phase: 14
plan: 05
subsystem: c2pa-verification-cohort-closure
tags: [c2pa, c2pa-node, verification, mcp-sdk, sdio-client, key-leak, t-14-01, t-14-02, t-14-12, concern-8, dual-transport-parity, requirements-cohort, prov-v-01, prov-v-02, prov-v-05]
requires:
  - 14-01 (c2pa-node@0.5.26 pinned + C2paConfig boot validation)
  - 14-02 (engine-layer signer + format-router + manifest-builder)
  - 14-03 (Engine.signOutput + manifest_signed event + downloader hook)
  - 14-04 (HTTP X-C2PA-Signing-Status header + dashboard C2paBadge)
provides:
  - End-to-end c2pa-node round-trip verification across PNG/JPEG/MP4/WebP/TIFF + EXR/PSD unsigned-path tests + claim_generator format + Concern #8 tamper detection
  - Dual-transport parity (HTTP route bytes ≡ direct file read) — automated coverage of ROADMAP success criterion #5
  - Key-leak negative tests proving private-key bytes appear in ZERO captured channels (T-14-01, T-14-02, T-14-12 mitigations)
  - Wire-level UAT via real MCP SDK Client + StdioClientTransport + spawned server child process (MEMORY.md feedback_dont_punt_on_tests)
  - version.get response envelope additive c2pa_status + c2pa_status_reason fields (agent-facing surface mirroring HTTP X-C2PA-Signing-Status)
  - VFX_FAMILIAR_OUTPUTS_DIR env var support for configurable outputs root
  - Rule 1 silent-failure bug fix in Engine.signViaTempFiles — temp files now preserve filename extension so c2pa-rs's BMFF/RIFF/TIFF asset handlers select correctly
  - REQUIREMENTS.md cohort closure for PROV-V-01 / PROV-V-02 / PROV-V-05 + new "Deferred to v1.2" section (cryptographic sidecar, sidecar HTTP route, HSM signing, multi-CA, streaming-friendly C2PA)
  - ROADMAP.md Phase 14 row + checklist marked Complete (5/5 plans, 2026-04-30)
affects:
  - Phase 15 (Ingredient Graph) — depends on Phase 14's manifest scaffolding, which is now locked
  - Phase 16 (Redaction & Agent Surface) — version.get c2pa_status field is the additive non-breaking precedent for export_manifest / verify_manifest
  - v1.2 milestone — deferred items now formally tracked
tech-stack:
  added:
    - "@modelcontextprotocol/sdk Client + StdioClientTransport (already in deps; this plan exercises the client surface for the first time end-to-end)"
  patterns:
    - "Independent-verifier round-trip: drive Engine.signOutput, then exercise a fresh createC2pa() instance (no shared signer state) to read manifests — proves the signed asset is verifiable by ANY c2pa-node consumer, not just the signing instance."
    - "Concern #8 cryptographic-binding proof: c2pa-rs's resolved-manifest shape does NOT surface c2pa.hash.data in the user-facing assertions array (it is an internal system assertion verified by the c2pa-rs validator). Proof has TWO legs: (a) clean validation_status when reading unmodified bytes proves the validator computed + matched the asserted hash; (b) a tamper test (single-byte flip in IDAT region) produces validation_status with 'assertion.dataHash.mismatch' AND a URL referencing self#jumbf=/c2pa/<urn>/c2pa.assertions/c2pa.hash.data — proving the assertion lives in the JUMBF box AND binds to the asset bytes."
    - "Random 32-byte slice key-leak detection: 5 deterministic-offset slices of the actual key bytes provide statistically-strong negative evidence. PEM private-key markers ('-----BEGIN PRIVATE KEY-----' / RSA / EC variants) are tested as additional belt-and-suspenders. Public CERTIFICATE markers are EXPLICITLY ALLOWED (the cert is embedded in JUMBF for verification — DER form, not PEM). The assertion is private-key-bytes-only."
    - "Wire-level UAT via spawned server child process: pre-seed a SQLite DB file with a workspace/project/sequence/shot/completed-version + signed PNG output + manifest_signed event using the production engine + repos directly, close the DB cleanly, then spawn `npx tsx src/server.ts --db <tmpDb>` with c2paConfig env vars set + connect a real MCP SDK Client. Tool calls flow through the actual stdio framing layer."
    - "VFX_FAMILIAR_OUTPUTS_DIR env override: mirrors the VFX_FAMILIAR_MODELS_DIR pattern. Default 'outputs' relative to cwd preserved for backward compatibility."
key-files:
  created:
    - src/__tests__/c2pa-verification.test.ts (744 lines, 17 tests — independent verification + Concern #8 + tamper detection)
    - src/__tests__/c2pa-dual-transport-parity.test.ts (558 lines, 9 tests — HTTP body ≡ direct file read)
    - src/__tests__/c2pa-key-leak-negative.test.ts (525 lines, 9 tests — T-14-01/T-14-02/T-14-12 mitigation proof)
    - src/__tests__/c2pa-uat-mcp-tool.test.ts (370 lines, 4 tests — wire-level UAT via MCP SDK Client)
    - src/__tests__/requirements-cohort-closure.test.ts (84 lines, 14 tests — cohort closure smoke)
  modified:
    - src/engine/pipeline.ts (Rule 1 fix: signViaTempFiles now accepts filename + preserves extension on temp paths)
    - src/tools/version-tool.ts (additive c2pa_status + c2pa_status_reason fields on version.get envelope; resolveC2paStatus helper)
    - src/server.ts (VFX_FAMILIAR_OUTPUTS_DIR env var support)
    - .planning/REQUIREMENTS.md (PROV-V-01/02/05 [x]; Traceability table updated; new Deferred to v1.2 section; closure footer)
    - .planning/ROADMAP.md (Phase 14 row 5/5 Complete 2026-04-30; checklist [x]; detail section [x] for 14-05)
key-decisions:
  - "Concern #8 closure pivots on c2pa-rs's resolved-manifest behavior — c2pa.hash.data is NOT user-facing in the assertions array. We close the cryptographic-binding requirement via clean validation_status (validator verified) + tamper-mismatch URL referencing c2pa.assertions/c2pa.hash.data (assertion exists in JUMBF + binds)."
  - "Rule 1 silent-failure fix in Engine.signViaTempFiles is non-negotiable correctness. Before fix: MP4/WebP/TIFF signing emitted unsigned bytes with signed=true in the manifest_signed event. After fix: c2pa-rs's BMFF/RIFF/TIFF asset handlers select correctly because temp paths preserve the filename's extension."
  - "Wire-level UAT honors MEMORY.md feedback_dont_punt_on_tests strictly. The version tool's envelope is the AGENT-FACING signing-status surface; the X-C2PA-Signing-Status header is the BROWSER-FACING surface. Both surfaces now have automated proof — neither is a human-checklist item."
  - "PROV-V-05 marked Partially Complete (not Complete) because EXR/PSD remain unsigned. Spec assumed sidecar; v1.1 ships native-embed for TIFF (BETTER) but defers EXR/PSD to v1.2 cryptographic-sidecar follow-up. This is honest scope tracking — claiming Complete would mask the deferred work."
  - "5 v1.2 deferred items captured at cohort closure time so the v1.2 milestone planner inherits the complete deferred set: cryptographic sidecar (EXR/PSD), sidecar HTTP route + dashboard link, HSM signing (T-14-12 follow-up), multi-CA / federated trust roots, streaming-friendly C2PA for live video."
  - "Concern #2 v1.1 scope reduction is structurally LOCKED: zero sidecar-related code in dashboard-routes.ts, zero SIDECAR_EXTENSIONS table dashboard-side, zero output.c2pa route. Verification: sidecar-route 404 test in dual-transport parity (Test 6b)."
patterns-established:
  - "Independent-verifier round-trip + Concern #8 two-leg proof for cryptographic binding"
  - "Random 32-byte slice key-leak detection across 5 captured channels (stdout / stderr / tool envelopes / HTTP body / provenance JSON)"
  - "Wire-level UAT pattern: pre-seed DB → close cleanly → spawn server → real MCP SDK Client"
  - "Cohort-closure footer mapping all ROADMAP success criteria to plans + verification, with explicit deferred items"
requirements-completed: [PROV-V-01, PROV-V-02, PROV-V-05]
metrics:
  duration_minutes: 22
  completed: 2026-04-30
  tasks_total: 5
  tasks_completed: 5
  tests_added: 53
  tests_added_root_suite: 53
  tests_added_dashboard_suite: 0
  tests_passing_root_before: 985
  tests_passing_root_after: 1038
  tests_passing_dashboard_before: 88
  tests_passing_dashboard_after: 88
  pre_existing_root_failures: 5
  new_files: 5
  modified_files: 5
---

# Phase 14 Plan 05: Verification + Parity + Key-Leak Negative Tests + Cohort Closure Summary

**End-to-end c2pa-node round-trip verification across PNG/JPEG/MP4/WebP/TIFF (incl. Concern #8 cryptographic binding proof + tamper detection); dual-transport parity automated; T-14-01/T-14-02/T-14-12 mitigations formally proven; wire-level UAT via real MCP SDK Client + spawned server; PROV-V-01/02/05 cohort closed with v1.2 deferred items recorded.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-04-30T13:18:16Z
- **Completed:** 2026-04-30T13:40:26Z
- **Tasks:** 5/5
- **Files modified:** 10 (5 created + 5 modified)

## Accomplishments

- **17-test independent c2pa-node verification** across all 5 v1.1 embed formats (PNG/JPEG/MP4/WebP/TIFF) plus EXR/PSD unsigned-path tests, claim_generator format, and Concern #8 tamper detection.
- **9-test dual-transport parity** — HTTP body bytes ≡ direct file-read bytes (ROADMAP success criterion #5 now automated).
- **9-test key-leak negative suite** — T-14-01 + T-14-02 + T-14-12 mitigations formally proven via random 32-byte slice + PEM private-key marker checks across 5 captured channels.
- **4-test wire-level UAT** — version.get c2pa_status field exercised through real MCP SDK Client + StdioClientTransport + spawned server child process (honors MEMORY.md feedback_dont_punt_on_tests).
- **14-test cohort-closure smoke** — REQUIREMENTS.md + ROADMAP.md state verified post-closure.
- **Rule 1 silent-failure bug fix** in Engine.signViaTempFiles — temp files now preserve filename extension so c2pa-rs's BMFF/RIFF/TIFF handlers select correctly.
- **PROV-V-01 + PROV-V-02 + PROV-V-05 cohort closure** with explicit v1.2 deferred items section (cryptographic sidecar API, sidecar HTTP route, HSM signing, multi-CA, streaming-friendly C2PA).
- **ROADMAP.md Phase 14 → Complete (5/5, 2026-04-30)** in row + checklist + detail section.

## Task Commits

1. **Task 1: c2pa-verification.test.ts + Rule 1 fix** — `72b1e48` (test+fix)
2. **Task 2: c2pa-dual-transport-parity.test.ts** — `85561e7` (test)
3. **Task 3: c2pa-key-leak-negative.test.ts** — `e59969a` (test)
4. **Task 4: c2pa-uat-mcp-tool.test.ts + version.get c2pa_status field + VFX_FAMILIAR_OUTPUTS_DIR** — `6bfff69` (feat)
5. **Task 5: REQUIREMENTS.md + ROADMAP.md cohort closure + smoke test** — `e56e5d5` (docs)

Plan metadata commit: see post-task closing commit.

## Files Created/Modified

### Created (5 files, 2281 total lines)

- **`src/__tests__/c2pa-verification.test.ts`** (744 lines, 17 tests) — Drives Engine.signOutput end-to-end, then exercises a SEPARATE C2pa instance (no shared signer state) to read manifests via c2pa.read({buffer, mimeType}) and c2pa.read({path, mimeType}). Tests cover PNG/JPEG/MP4/WebP/TIFF round-trips + Concern #8 cryptographic-binding proof (validation_status clean OR tamper-mismatch URL referencing c2pa.assertions/c2pa.hash.data) + EXR/PSD unsigned-path assertions + D-CTX-4 manifest contract (softwareAgent.name, digitalSourceType, parameters.description regex, claim_generator format).
- **`src/__tests__/c2pa-dual-transport-parity.test.ts`** (558 lines, 9 tests) — Builds a real Engine + Hono dashboard router; signs a fixture; writes signed bytes to outputsDir/versionId/filename; bit-compares fs.readFile(path) vs Buffer.from(await response.arrayBuffer()) for in-process Hono GET on PNG/MP4/TIFF. Header parity (X-C2PA-Signing-Status matches engine.getC2paStatusForVersion). Signing-disabled path. EXR (v1.1 unsupported_format) + sidecar-route 404 verification. Cache-Control parity. HEAD parity (same headers, zero body bytes).
- **`src/__tests__/c2pa-key-leak-negative.test.ts`** (525 lines, 9 tests) — Monkey-patches process.stdout.write + process.stderr.write + console.{log,error,warn} during signing run; serializes tool envelope + provenance event JSON + HTTP response body; runs assertNoKeyBytesIn against each channel using random 32-byte slices + PEM private-key markers. T-14-04 file-mode warning capture. T-14-12 process-heap awareness regression guard (parses src/types/provenance.ts to extract ManifestSignedPayloadFields field names + asserts forbidden field names like `private_key`/`raw_key`/etc. are absent + asserts present fields are in the known whitelist).
- **`src/__tests__/c2pa-uat-mcp-tool.test.ts`** (370 lines, 4 tests) — Pre-seeds a temp SQLite DB + outputs dir using the production engine + repos directly, then closes the DB and spawns `npx tsx src/server.ts --db <tmpDb>` as a child process. Connects a real `Client` via `StdioClientTransport` and calls `version.get` + asserts the response envelope has `c2pa_status='signed' | 'unsigned'` with proper `c2pa_status_reason`. Test 3 also exercises the --http transport variant via `fetch` against `GET /api/versions/:id/output` and asserts the `X-C2PA-Signing-Status` header value. Test 4 documents the openssl skip-guard contract.
- **`src/__tests__/requirements-cohort-closure.test.ts`** (84 lines, 14 tests) — Smoke test asserting the on-disk state of REQUIREMENTS.md + ROADMAP.md after closure (PROV-V-01/02/05 [x] + Traceability rows + Deferred to v1.2 section + ROADMAP Phase 14 5/5 Complete + checklist + detail section + footer Concern #8 reference).

### Modified (5 files)

- **`src/engine/pipeline.ts`** — Rule 1 fix in `signViaTempFiles`: now accepts `filename: string` parameter + preserves `nodepath.extname(filename)` on both src and dest temp paths. Signature change rippled to the single caller in `signOutput`. **Critical correctness fix** — without this, MP4/WebP/TIFF signing emitted unsigned bytes with `signed: true` in the manifest_signed event (silent failure that made ROADMAP success criterion #1 unverifiable for file-API formats).
- **`src/tools/version-tool.ts`** — Additive non-breaking `c2pa_status` + `c2pa_status_reason` fields on the `version.get` response envelope. New `resolveC2paStatus` helper reads `outputs[0].filename` from the version row + calls `engine.getC2paStatusForVersion(versionId, filename)`. Mirrors the X-C2PA-Signing-Status header semantics (3 states: signed | unsigned | unknown) for the agent surface. Tool budget unchanged (still 6 of 12).
- **`src/server.ts`** — `VFX_FAMILIAR_OUTPUTS_DIR` env var support (mirrors `VFX_FAMILIAR_MODELS_DIR`). Default 'outputs' preserved for backward compatibility. Required for the wire-level UAT to redirect outputs to a temp dir without polluting the workspace.
- **`.planning/REQUIREMENTS.md`** — PROV-V-01 [x] Complete; PROV-V-02 [x] Complete; PROV-V-05 [x] Partially Complete; Traceability table updated; new "Deferred to v1.2" section with 5 items (cryptographic sidecar, sidecar HTTP route, HSM signing, multi-CA, streaming-friendly C2PA); closure footer with all 5 ROADMAP success criteria mapped to plans + verification.
- **`.planning/ROADMAP.md`** — Phase 14 row: 4/5 In Progress → 5/5 Complete (2026-04-30); detail section: 14-05-PLAN.md [ ] → [x]; upper checklist: Phase 14 [ ] → [x] with completion date.

## Decisions Made

1. **Concern #8 closure approach** — c2pa-rs's resolved-manifest shape does NOT surface `c2pa.hash.data` in the user-facing `assertions` array (it is an internal system assertion verified by the c2pa-rs validator). We close the cryptographic-binding requirement via TWO complementary asserts:
   - **Leg (a):** clean `validation_status` when reading unmodified bytes proves the validator computed + matched the asserted hash.
   - **Leg (b):** tamper test (single-byte flip in IDAT region of signed PNG) produces `validation_status` with `'assertion.dataHash.mismatch'` AND the entry's URL is `self#jumbf=/c2pa/<urn>/c2pa.assertions/c2pa.hash.data` — proving the assertion EXISTS in the JUMBF box AND BINDS to the asset bytes.
   Together (a) + (b) close Concern #8 unambiguously.

2. **Rule 1 silent-failure fix in Engine.signViaTempFiles** is non-negotiable correctness. Without the extension-preserving temp paths, c2pa-rs's BMFF/RIFF/TIFF asset handlers fail handler selection silently — c2pa-node's sign() returns no-op output, the engine reads the unsigned src bytes back from the dest temp, and emits a `signed: true` manifest_signed event for an asset that contains zero C2PA bytes. The bug was discovered when Test 7 of c2pa-verification.test.ts surfaced `c2pa.read` returning null for an MP4 the engine claimed was signed. The fix preserves the original filename's extension on both src and dest temp paths.

3. **PROV-V-05 marked Partially Complete (not Complete)** because EXR/PSD remain unsigned. The original spec assumed sidecar; v1.1 ships native-embed signing for TIFF (BETTER outcome — cryptographically bound, not a placeholder pseudo-sidecar) but defers EXR/PSD to v1.2 cryptographic-sidecar follow-up. Honest scope tracking — claiming Complete would mask the deferred work.

4. **Wire-level UAT pattern: pre-seed → close → spawn** rather than building outputs in the spawned process. Pre-seeds a temp SQLite DB + outputs dir using the production engine + repos in the test process (mirrors the exact row shape the production engine writes), closes the DB cleanly with `sqlite.close()`, then spawns the server child process. This is faster than driving creation through the MCP client, and exercises the real boot path (openDb + migrations + transport bootstrap) end-to-end.

5. **VFX_FAMILIAR_OUTPUTS_DIR env override** mirrors the existing VFX_FAMILIAR_MODELS_DIR pattern. Default 'outputs' relative to cwd preserved for production deployments. Required for the spawned-server UAT test to redirect outputs to a temp dir.

6. **5 v1.2 deferred items captured at cohort closure time** so the v1.2 milestone planner inherits the complete deferred set without losing context: cryptographic sidecar manifests for EXR/PSD/unsupported formats (pending c2pa-node API additions OR c2pa-rs binding), sidecar HTTP route + dashboard download link (output.c2pa), HSM/hardware-key signing (T-14-12 follow-up), multi-CA/federated trust roots, streaming-friendly C2PA for live video.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Engine.signViaTempFiles silently emitted unsigned MP4/WebP/TIFF outputs**

- **Found during:** Task 1 (c2pa-verification.test.ts MP4 round-trip — Tests 7-8 failed because c2pa.read returned null for signed bytes the engine reported as signed=true)
- **Issue:** `signViaTempFiles` created temp files at `<tmpRoot>/src-<nanoid>` and `<tmpRoot>/dest-<nanoid>` with NO file extension. c2pa-rs's asset-handler selection looks at the file extension to pick BMFF (mp4) / RIFF (webp) / TIFF (tif/tiff). Without the extension, c2pa-node's sign() exits successfully but produces no-op output (the dest file size matches src size). The engine then read those unsigned bytes back, emitted a `manifest_signed` event with `signed: true`, and returned the bytes to the caller. Critical silent-failure bug that breaks ROADMAP success criterion #1 ("verifiable by an independent C2PA verifier") for all file-API formats.
- **Fix:** `signViaTempFiles` now accepts the original `filename: string` parameter + preserves `nodepath.extname(filename)` on both src and dest temp paths (e.g., `src-abcdef12.mp4`, `dest-abcdef12.mp4`). Signature change rippled to the single caller in `signOutput` — `route.mode === 'embed-file'` branch.
- **Files modified:** `src/engine/pipeline.ts`
- **Verification:** Test 1 of c2pa-verification.test.ts now passes the MP4 round-trip with non-null `active_manifest` + `c2pa.hash.bmff.v2` assertion. Existing 24 sign-output.test.ts tests continue to pass (they only asserted `bytes-different-from-input` so they didn't catch this bug originally). Existing 22 signer.test.ts tests continue to pass.
- **Committed in:** `72b1e48` (Task 1 commit, bundled with the verification test that found it)

**2. [Rule 2 - Missing Critical] VFX_FAMILIAR_OUTPUTS_DIR env var support**

- **Found during:** Task 4 (Test 3 of c2pa-uat-mcp-tool.test.ts — HTTP transport variant returned 404 because the spawned server hardcoded outputs root to `'outputs'` cwd-relative)
- **Issue:** `src/server.ts:218` hardcoded the outputs root as `'outputs'`, ignoring any env override. The UAT test needs to redirect outputs to a temp dir to avoid polluting the workspace's `outputs/` directory across test runs. This is also a Rule 2 missing-critical for production deployments where ops needs to point outputs at a different filesystem mount.
- **Fix:** Read `process.env.VFX_FAMILIAR_OUTPUTS_DIR` with `'outputs'` fallback; mirrors the existing `VFX_FAMILIAR_MODELS_DIR` pattern. Default preserved for backward compatibility.
- **Files modified:** `src/server.ts`
- **Verification:** UAT Test 3 now passes with HTTP 200 + `X-C2PA-Signing-Status: signed`. All other tests continue to pass.
- **Committed in:** `6bfff69` (Task 4 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug, 1 Rule 2 missing-critical).
**Impact on plan:** Both fixes essential for correctness. The Rule 1 fix specifically closes a silent-failure mode that would have broken ROADMAP success criterion #1 for MP4/WebP/TIFF in production. No scope creep — both fixes are within the plan's "verification first" mandate.

## Test Coverage

**53 new tests** (across 5 files) in the root suite:
- `src/__tests__/c2pa-verification.test.ts` (+17): 4 PNG (incl. Concern #8) + 2 JPEG + 2 MP4 + 1 WebP + 1 TIFF + 4 D-CTX-4 manifest contract + 2 EXR/PSD unsigned + 1 tamper detection
- `src/__tests__/c2pa-dual-transport-parity.test.ts` (+9): 3 buffer/file format parity (PNG/MP4/TIFF) + 1 header parity + 1 signing-disabled + 1 EXR + 1 sidecar-route 404 + 1 Cache-Control + 1 HEAD parity
- `src/__tests__/c2pa-key-leak-negative.test.ts` (+9): 2 stdout/stderr/console + 1 tool envelope + 1 HTTP body + 1 provenance JSON + 1 cert subject summary + 1 T-14-04 file-mode warning + 1 public cert allowed + 1 T-14-12 schema regression guard
- `src/__tests__/c2pa-uat-mcp-tool.test.ts` (+4): 1 stdio signed + 1 stdio unsigned + 1 --http variant + 1 skip-guard documentation
- `src/__tests__/requirements-cohort-closure.test.ts` (+14): 3 PROV-V checkboxes + 3 Traceability rows + 5 Deferred to v1.2 + 1 footer Concern #8 + 3 ROADMAP markers (row + detail + checklist)

**Test counts:**
- Root: 985 → 1038 passing (+53). Pre-existing 5 v1.1-audit failures unchanged.
- Dashboard: 88 → 88 passing (no dashboard changes in Plan 14-05).
- `npx tsc --noEmit` exits 0.

## ROADMAP Success Criteria Coverage Map

| Criterion | Closed by | Verified by | v1.1 / v1.2 split |
|---|---|---|---|
| #1 PNG/JPEG/MP4/WebP/TIFF signed manifests verifiable by independent C2PA verifier | Plans 14-02 (manifest builder + signer wrapper) + 14-03 (Engine.signOutput) | Plan 14-05 c2pa-verification.test.ts (17 tests, including Concern #8 c2pa.hash.data assertion proof + tamper detection) | v1.1 ships PNG/JPEG/MP4/WebP/TIFF (TIFF added as bonus) |
| #2 c2pa.created with ComfyUI softwareAgent + trainedAlgorithmicMedia digitalSourceType | Plan 14-02 manifest-builder | Plan 14-05 Tests 11-13 of c2pa-verification.test.ts | v1.1 complete |
| #3 sidecar .c2pa for EXR/PSD/TIFF + dashboard surface | Plan 14-03 (engine integration) for TIFF native-embed; v1.2 for cryptographic sidecar | Plan 14-05 Test 6 of c2pa-dual-transport-parity.test.ts (EXR unsigned + 404 sidecar route) | **PARTIAL CLOSURE** — TIFF native-embed (BETTER than spec); EXR/PSD deferred to v1.2 cryptographic-sidecar follow-up. Dashboard surface in v1.1 is the C2paBadge (not a download link; v1.2 adds the link). |
| #4 single configured local cert; key never logged or surfaced | Plans 14-01/14-02 (config + signer wrapper) | Plan 14-05 c2pa-key-leak-negative.test.ts (9 tests, zero key-byte appearances across stdout / stderr / tool envelopes / HTTP body / provenance JSON) | v1.1 complete |
| #5 dual-transport parity (stdio + Streamable HTTP emit identical bytes) | Architectural choice in Plan 14-03 (signing at write-time) | Plan 14-05 c2pa-dual-transport-parity.test.ts (9 parity tests, byte-identical bodies across HTTP route + direct file read) | v1.1 complete |

## Phase 14 Cohort State (5/5 plans)

- **14-01-PLAN** (Plan 14-01): c2pa-node@0.5.26 pin + C2paConfig + dev cert helper + path-leak hygiene — `2c66f44` `9b34db8` `4d54d57` `7d1c97d`
- **14-02-PLAN** (Plan 14-02): engine-layer c2pa module (signer + format-router + manifest-builder) — `0fc6a12` `64bd71e` `cce4cf1` `eed8e92`
- **14-03-PLAN** (Plan 14-03): Engine.signOutput + manifest_signed event + downloader hook — `40b3d34` `c64bca6` `9a7e62a`
- **14-04-PLAN** (Plan 14-04): HTTP X-C2PA-Signing-Status header + dashboard C2paBadge — `6b5c97b` `b437a80` `60216a1` `9b37100` `19b98c8`
- **14-05-PLAN** (Plan 14-05, this plan): Verification + parity + key-leak negative + UAT + cohort closure — `72b1e48` `85561e7` `e59969a` `6bfff69` `e56e5d5`

## v1.2 Deferred Items Recorded

In `.planning/REQUIREMENTS.md` Deferred to v1.2 section:
1. **Cryptographic sidecar manifests for EXR/PSD/unsupported formats** (Concern #2 follow-up) — pending c2pa-node `signEmbeddable` / `sign_no_embed` API exposure OR direct c2pa-rs binding
2. **Sidecar HTTP route + dashboard download link** (`GET /api/versions/:id/output.c2pa`) — reintroduce when cryptographic sidecar API ships; add `isSidecarMode` helper guarded by extension-table parity test
3. **HSM / hardware-key signing** (T-14-12 follow-up) — PKCS#11 / network-attached HSMs / cloud KMS so private key never enters Node's heap
4. **Multi-CA / federated trust roots** — for production deployments with internal CA chains
5. **Streaming-friendly C2PA for live video** — final-render outputs only in v1.1

## Issues Encountered

- **MP4 fixture creation requires ffmpeg.** Tests 7-8 of c2pa-verification.test.ts and Test 2 of c2pa-dual-transport-parity.test.ts skip cleanly when ffmpeg is absent (CI guard documented). The fixture generator caches the generated MP4 under `tests/fixtures/c2pa/algorithms/larger.mp4` (gitignored).
- **Self-signed dev cert at .c2pa-dev/cert.pem is rejected by c2pa-rs** with `CertificateProfileError(SelfSignedCertificate)`. The verification tests use c2pa-node's bundled test cert chain (proper trust chain) for end-to-end signing — same pattern as the existing signer.test.ts. Documented in tests/fixtures/c2pa/README.md.
- **The Rule 1 silent-failure bug in Engine.signViaTempFiles** was a true latent defect — it survived 24 sign-output.test.ts tests because those tests only asserted `bytes-different-from-input` (which a no-op file copy passes). Discovered only by running c2pa.read on the signed bytes in Plan 14-05's verification test. This is a strong argument for the verification-first approach the plan mandates.

## Next Phase Readiness

- **Phase 15 (Ingredient Graph) unblocked.** Phase 14's manifest scaffolding is now locked + verified. Phase 15 will extend the c2pa.created assertion with `parentOf` / `componentOf` / `inputTo` ingredient assertions.
- **Phase 16 (Redaction & Agent Surface)** has the additive-non-breaking precedent — `version.get` envelope gained `c2pa_status` / `c2pa_status_reason` fields without bumping the schema version. Phase 16's `version.export_manifest` + `version.verify_manifest` actions can follow the same pattern.
- **v1.2 milestone planner** has 5 deferred items recorded with full context.

## Self-Check: PASSED

| Predicate | Result |
|---|---|
| `npx vitest run src/__tests__/c2pa-verification.test.ts` | 17/17 passing |
| `npx vitest run src/__tests__/c2pa-dual-transport-parity.test.ts` | 9/9 passing |
| `npx vitest run src/__tests__/c2pa-key-leak-negative.test.ts` | 9/9 passing |
| `npx vitest run src/__tests__/c2pa-uat-mcp-tool.test.ts` | 4/4 passing |
| `npx vitest run src/__tests__/requirements-cohort-closure.test.ts` | 14/14 passing |
| `npx vitest run` total | 1038 passing, 5 pre-existing failures unchanged, 3 skipped |
| `cd packages/dashboard && npx vitest run` | 88/88 passing (unchanged from Plan 14-04 baseline) |
| `npx tsc --noEmit` | exits 0 |
| `grep "\\[x\\] \\*\\*PROV-V-01\\*\\*" .planning/REQUIREMENTS.md` | 1 match |
| `grep "\\[x\\] \\*\\*PROV-V-02\\*\\*" .planning/REQUIREMENTS.md` | 1 match |
| `grep "\\[x\\] \\*\\*PROV-V-05\\*\\*" .planning/REQUIREMENTS.md` | 1 match |
| `grep -E "PROV-V-01.*Phase 14.*Complete" .planning/REQUIREMENTS.md` | 1 match |
| `grep "Deferred to v1\\.2" .planning/REQUIREMENTS.md` | 1+ match |
| `grep "Cryptographic sidecar" .planning/REQUIREMENTS.md` | 1+ match |
| `grep -E "Phase 14.*5/5.*Complete" .planning/ROADMAP.md` | 1 match |
| `grep "c2pa\\.hash\\.data" src/__tests__/c2pa-verification.test.ts` | 5+ matches |
| `grep "assertion\\.dataHash\\.mismatch" src/__tests__/c2pa-verification.test.ts` | 1+ match |

---
*Phase: 14-c2pa-signed-manifest-emission*
*Completed: 2026-04-30*
