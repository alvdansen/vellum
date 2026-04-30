---
phase: 14-c2pa-signed-manifest-emission
verified: 2026-04-30T13:55:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: null
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 14: C2PA Signed Manifest Emission Verification Report

**Phase Goal:** Embed a signed C2PA manifest in every generated output at download time with explicit AI-origin disclosure (`c2pa.created` + ComfyUI as generator), routed by output format. Single configured local cert. Dual-transport parity. v1.1 native-embed only (PNG/JPEG/MP4/WebP/TIFF). EXR/PSD deferred to v1.2.
**Verified:** 2026-04-30T13:55:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth                                                                                                                                                            | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Downloads via `/api/versions/:id/output` AND engine direct-to-disk write produce outputs with valid embedded C2PA manifest for PNG/JPEG/MP4/WebP, verifiable by independent C2PA verifier | ✓ VERIFIED | `c2pa-verification.test.ts` (17/17 pass) drives Engine.signOutput end-to-end across PNG/JPEG/MP4/WebP/TIFF, then exercises a SEPARATE `createC2pa()` instance to read manifests via `c2pa.read({buffer, mimeType})` / `c2pa.read({path, mimeType})`. Round-trip proven. Concern #8 cryptographic-binding closed (16 hits on `c2pa.hash.data` / `assertion.dataHash.mismatch` references). |
| 2   | Every embedded manifest includes `c2pa.created` assertion with ComfyUI softwareAgent + workflow's primary model                                                    | ✓ VERIFIED | `src/engine/c2pa/manifest-builder.ts:108` hardcodes `softwareAgent: { name: 'ComfyUI', version }` AND `digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'` (line 86). Tests 11-13 in `c2pa-verification.test.ts` lock this contract. Primary model derived from `provenanceRepo.getLatestFingerprints` (Phase 13). |
| 3   | For non-embed formats, sidecar .c2pa file alongside output. Dashboard surfaces both. **Note: PROV-V-05 partial scope reduction — TIFF native-embed (BETTER); EXR/PSD become unsupported_format events deferred to v1.2.** | ✓ VERIFIED | TIFF added to `EMBED_FILE_FORMATS` (`format-router.ts`); native-embed proven by Test 9 of `c2pa-verification.test.ts`. EXR/PSD route to `mode: 'unsupported'` with `reason: 'native-handler-missing'`, surface as `signed=false / status_reason='unsupported_format'` events; dual-transport parity Test 6b asserts the legacy `/output.c2pa` route returns 404 (no sidecar route in v1.1). Concern #2 scope reduction structurally locked: NO `mode: 'sidecar'` exists in the discriminated union. v1.2 deferred items captured in `REQUIREMENTS.md`. Dashboard surface = `C2paBadge` (not download link). |
| 4   | Single configured local cert; private key never logged/returned/echoed                                                                                            | ✓ VERIFIED | `c2pa-key-leak-negative.test.ts` (9/9 pass) asserts ZERO key bytes appear in: stdout, stderr+console, version.get tool envelope, HTTP body, provenance JSON. Uses random 32-byte slice + PEM `-----BEGIN PRIVATE KEY-----` marker checks. T-14-04 file-mode warning emits basename only. T-14-12 ManifestSignedPayloadFields whitelist regression guard (forbidden field names checked). `loadC2paConfigFromEnv` boot success log uses `path.basename` only. |
| 5   | Dual-transport parity: stdio + HTTP emit identical manifests for the same version                                                                                | ✓ VERIFIED | `c2pa-dual-transport-parity.test.ts` (9/9 pass). Tests 1-3 bit-compare HTTP body bytes vs `fs.readFile(outputsDir/versionId/filename)` for PNG/MP4/TIFF. Architectural achievement: signing-at-write-time (Plan 14-03) — the file IS the source of truth, both transports see same bytes. HEAD parity test asserts same headers, zero body bytes. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact                                                                          | Expected                                                | Status     | Details                                                                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/c2pa-config.ts`                                                        | `loadC2paConfigFromEnv` with realpath + allowlist       | ✓ VERIFIED | 7 `realpathSync` hits, 3 `VFX_FAMILIAR_C2PA_CERT_ROOT` hits; throws `C2PA_CONFIG_INVALID`; basename-only error messages          |
| `src/types/c2pa.ts`                                                               | `C2paConfig` type — paths only, no bytes                | ✓ VERIFIED | `{ certPemPath, privateKeyPemPath }` — paths only; `private readonly` field on Engine                                            |
| `src/engine/c2pa/format-router.ts`                                                | 3-variant discriminated union (no sidecar mode)         | ✓ VERIFIED | `embed-buffer` (PNG/JPEG), `embed-file` (MP4/WebP/TIFF), `unsupported` (EXR/PSD/unknown). NO `mode: 'sidecar'` (locked at compile time) |
| `src/engine/c2pa/manifest-builder.ts`                                             | Pure synchronous builder; D-CTX-4 contract              | ✓ VERIFIED | softwareAgent.name='ComfyUI', digitalSourceType=trainedAlgorithmicMedia, claim_generator format `vfx-familiar/<v> c2pa-node/0.5.26` |
| `src/engine/c2pa/signer.ts`                                                       | Lazy import + algorithm detection + RFC4514 subject      | ✓ VERIFIED | ONLY file in src/ that imports c2pa-node (architecture-purity gate enforced). X509Certificate-based algorithm detection (ES256/384/512, PS256/384/512, Ed25519, plain RSA fail-loud). RFC4514 subject parser with fp: fallback. |
| `src/engine/c2pa/index.ts`                                                        | Barrel re-export                                        | ✓ VERIFIED | Re-exports all public surface                                                                                                    |
| `src/engine/pipeline.ts:Engine.signOutput`                                        | 8-path orchestration with idempotency                   | ✓ VERIFIED | All 8 outcome paths covered (signing_disabled, unsupported_format, cert_load_failed, native_binding_unavailable, sign_call_failed, asset_too_large_for_buffer_api, alreadySigned, success-buffer/file). Idempotency on prior signed=true skip. Lazy signer cache. |
| `src/engine/pipeline.ts:Engine.signViaTempFiles`                                  | Atomic temp-file writes with extension preservation     | ✓ VERIFIED | Line 1131: `const ext = nodepath.extname(filename);` — Rule 1 fix from commit 72b1e48. Modes 0700/0600. nanoid(8) suffixes. try/finally cleanup. |
| `src/engine/output-downloader.ts:signFileInPlace`                                 | Pre-stat OOM guard + EXDEV fallback                     | ✓ VERIFIED | `DOWNLOADER_BUFFER_SIGNING_MAX_BYTES = 500MB` + `BUFFER_SIGNING_MAX_BYTES` defence-in-depth. `renameWithFallback` (line 221) catches EXDEV, falls back to copyFile + unlink. nanoid(8) partial paths. |
| `src/store/provenance-repo.ts:appendManifestSignedEvent`                          | Append-only sibling event                               | ✓ VERIFIED | INSERT-only. Zero `this.db.update` / `this.db.delete` calls in entire file (verified by file-level grep gate). `getLatestManifestSignedEvent` walks newest-first. |
| `src/store/schema.ts`                                                             | manifest_signed_json nullable column                    | ✓ VERIFIED | `drizzle/0006_phase14_manifest_signed_event.sql` adds nullable column. EXPECTED_MIGRATIONS bumped 5 → 6. |
| `src/types/provenance.ts`                                                         | `ManifestSignedPayloadFields` type                      | ✓ VERIFIED | 'manifest_signed' added to ProvenanceEventType union; 7 fields (filename, format, signed, cert_subject_summary, signed_at, status_reason, algorithm) — NO sidecar field. |
| `src/http/dashboard-routes.ts:GET/HEAD /api/versions/:id/output`                  | X-C2PA-Signing-Status header + HEAD support             | ✓ VERIFIED | 7 hits on `X-C2PA-Signing-Status`. `app.on('HEAD', '/api/versions/:id/output', ...)` at line 344 reuses same helpers as GET. Reads from `engine.getC2paStatusForVersion`. |
| `src/tools/version-tool.ts`                                                       | Additive c2pa_status + c2pa_status_reason envelope fields | ✓ VERIFIED | `resolveC2paStatus` helper added; envelope mirrors X-C2PA-Signing-Status semantics for agent surface. Tool budget unchanged at 6/12. |
| `packages/dashboard/src/components/C2paBadge.tsx`                                 | 3-state badge with T-14-11 XSS mitigation                | ✓ VERIFIED | 3 visual states (signed/unsigned/unknown); 6 reason codes mapped via REASON_TEXT; `replace(/[^\w ]/g, '')` sanitization for unknown codes; Preact text-node interpolation (NO dangerouslySetInnerHTML). |
| `packages/dashboard/src/views/VersionDrawer.tsx`                                  | Auto-fetch + render C2paBadge                            | ✓ VERIFIED | Line 256: `<C2paBadge status={c2paStatus} />` in Output section; useEffect auto-fetches via `getC2paStatus(version.id)`. |
| `packages/dashboard/src/lib/api.ts:getC2paStatus`                                 | HEAD-based status helper, never throws                   | ✓ VERIFIED | Defence-in-depth: collapses network/parse errors to `{ status: 'unknown' }`. |
| `packages/dashboard/dist/assets/index-CKLgl4R-.js`                                | Built dashboard bundle includes C2paBadge                | ✓ VERIFIED | Confirmed `c2pa-badge`, `C2PA: signed`, `C2PA: pending` strings present in bundled JS. |
| `scripts/gen-dev-c2pa-cert.mts`                                                   | Self-signed dev cert generator                          | ✓ VERIFIED | ES256 key + cert, output to `.c2pa-dev/` (gitignored), key chmod 0600. |
| `drizzle/0006_phase14_manifest_signed_event.sql`                                  | Migration 0006                                          | ✓ VERIFIED | Drizzle journal updated; migrate-on-boot applies it.                                                                              |

### Key Link Verification

| From                                  | To                                                         | Via                                                                  | Status   | Details                                                                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/server.ts`                       | `Engine.options.c2paConfig`                                | `loadC2paConfigFromEnv()` → constructor option                       | ✓ WIRED  | Boot path threading; throw-before-Engine-construct on misconfig                                                                                                                      |
| `src/engine/output-downloader.ts`     | `Engine.signOutput`                                        | `EngineForC2pa` structural Pick + `signFileInPlace` private helper   | ✓ WIRED  | Hook fires post-Cloud-download for every completed version (line 124: `await signFileInPlace(...)`)                                                                                    |
| `src/http/dashboard-routes.ts`        | `Engine.getC2paStatusForVersion`                           | EngineForDashboard structural Pick read accessor                     | ✓ WIRED  | Reads only — does NOT sign. Header sourced from manifest_signed event                                                                                                                |
| `src/tools/version-tool.ts`           | `Engine.getC2paStatusForVersion`                           | `resolveC2paStatus` helper                                           | ✓ WIRED  | version.get envelope additive fields surface signing status to MCP agents                                                                                                            |
| `Engine.signOutput`                   | `provenanceRepo.appendManifestSignedEvent`                 | All 6 status_reason codes append; success appends signed=true        | ✓ WIRED  | INSERT-only. Skip path emits ZERO events when alreadySigned (Concern #7). Architectural-purity verified — no this.db.update/delete in entire repo. |
| `Engine.signOutput`                   | `signer.ts` (loadSigner / signEmbedBuffer / signEmbedFile) | Via barrel `src/engine/c2pa/index.ts`                                | ✓ WIRED  | Lazy signer cache: 1 load per process. PNG/JPEG via signEmbedBuffer; MP4/WebP/TIFF via signEmbedFile through signViaTempFiles. |
| `c2pa-node` native binding            | `signer.ts` ONLY (no other file in src/)                   | architecture-purity grep gate (excludes __tests__/)                  | ✓ WIRED  | Robust regex covers static + dynamic imports + either quote style. 30/30 architecture-purity tests pass. |
| `VersionDrawer.tsx`                   | `getC2paStatus` API helper                                 | `useEffect` auto-fetch keyed by version.id                           | ✓ WIRED  | C2paBadge mounts in Output section when version.status === 'complete'. |
| `Engine.signViaTempFiles`             | Original filename extension                                | `nodepath.extname(filename)` (line 1131)                             | ✓ WIRED  | Rule 1 fix (commit 72b1e48): temp paths preserve extension so c2pa-rs's BMFF/RIFF/TIFF asset handlers select correctly. |

### Data-Flow Trace (Level 4)

| Artifact                                | Data Variable             | Source                                                       | Produces Real Data | Status      |
| --------------------------------------- | ------------------------- | ------------------------------------------------------------ | ------------------ | ----------- |
| `C2paBadge` (dashboard)                 | `c2paStatus` prop          | `getC2paStatus(version.id)` HEAD request → X-C2PA header     | YES                | ✓ FLOWING   |
| `VersionDrawer` (dashboard)             | `c2paStatus` state slot    | `useEffect` fetches on mount when version.id changes         | YES                | ✓ FLOWING   |
| HTTP `X-C2PA-Signing-Status` header     | `signingStatus` string     | `engine.getC2paStatusForVersion(versionId, filename)` reads from manifest_signed event in provenance table | YES (real DB query — `getLatestManifestSignedEvent` walks rows newest-first) | ✓ FLOWING   |
| `version.get` envelope `c2pa_status`    | `c2paStatus.c2pa_status`   | `resolveC2paStatus` calls `engine.getC2paStatusForVersion`   | YES                | ✓ FLOWING   |
| `Engine.signOutput` manifest definition | `primaryModel`             | `provenanceRepo.getLatestFingerprints(versionId)` → `derivePrimaryModel` projection (Phase 13 source) | YES                | ✓ FLOWING   |
| Signed asset bytes                      | `signedBytes` Buffer / file at `signedToPath` | `signEmbedBuffer` / `signEmbedFile` (c2pa-node native binding signs with cert+key from c2paConfig) | YES (cryptographically bound — proven by Concern #8 tamper test) | ✓ FLOWING   |
| `manifest_signed_json` provenance row   | Payload via `appendManifestSignedEvent` | All 8 outcome paths in Engine.signOutput append a JSON payload | YES                | ✓ FLOWING   |

### Behavioral Spot-Checks

| Behavior                                                                          | Command                                                                                                                                | Result                                                                                  | Status   |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------- |
| Root vitest suite runs                                                            | `npx vitest run`                                                                                                                       | 1038 passing, 5 pre-existing v1.1-audit failures (validation-flags + phase-attribution), 3 skipped — matches SUMMARY claim   | ✓ PASS   |
| TypeScript clean                                                                  | `npx tsc --noEmit`                                                                                                                     | exit 0 (no output)                                                                      | ✓ PASS   |
| Dashboard vitest suite runs                                                       | `cd packages/dashboard && npx vitest run`                                                                                              | 88 passing / 12 test files                                                              | ✓ PASS   |
| All 5 Plan-14-05 verification tests pass                                          | `npx vitest run src/__tests__/c2pa-verification.test.ts src/__tests__/c2pa-dual-transport-parity.test.ts src/__tests__/c2pa-key-leak-negative.test.ts src/__tests__/c2pa-uat-mcp-tool.test.ts src/__tests__/requirements-cohort-closure.test.ts` | 53 passing / 5 test files                                                  | ✓ PASS   |
| Architecture purity (c2pa-node centralization)                                    | `npx vitest run src/__tests__/architecture-purity.test.ts`                                                                             | 30/30 passing                                                                            | ✓ PASS   |
| c2pa-node imports centralized to signer.ts (production code)                      | `grep -rE "from\s*['\"]c2pa-node\|import\s*\(\s*['\"]c2pa-node" src/`                                                                  | Only `src/engine/c2pa/signer.ts` (production); test files (`c2pa-verification.test.ts`) and architecture-purity docstring references are exempt | ✓ PASS   |
| Append-only invariant on provenance-repo                                          | `grep -E "this.db.update\|this.db.delete" src/store/provenance-repo.ts`                                                                | ZERO matches                                                                            | ✓ PASS   |
| `manifest_signed` symbol present in types + repo                                  | `grep "appendManifestSignedEvent\|manifest_signed" src/store/provenance-repo.ts src/types/provenance.ts`                              | 20+ hits (method, JSDoc, type union arm)                                                | ✓ PASS   |
| PROV-V-05 partial-completion note in REQUIREMENTS.md                              | `grep "PROV-V-05" .planning/REQUIREMENTS.md`                                                                                            | "Partially Complete (Phase 14, 2026-04-30 — TIFF native-embed; EXR/PSD cryptographic sidecar deferred to v1.2)" | ✓ PASS   |
| Rule 1 fix in commit 72b1e48                                                      | `git show 72b1e48 -- src/engine/pipeline.ts \| grep extname`                                                                            | `nodepath.extname(filename)` line added                                                  | ✓ PASS   |
| Dashboard bundle contains C2paBadge                                               | `grep -oE "c2pa-badge\|C2PA: signed" packages/dashboard/dist/assets/*.js`                                                              | "c2pa-badge", "C2PA: signed" present in built bundle                                    | ✓ PASS   |

### Requirements Coverage

| Requirement | Source Plan       | Description                                                                                                          | Status            | Evidence                                                                                                                                                                                                                                                            |
| ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PROV-V-01   | 14-01..05 cohort  | Server emits a signed C2PA manifest embedded in supported output formats at download time, both via dashboard streaming route and direct file write. | ✓ SATISFIED       | All 5 plans cohort-closed. `c2pa-verification.test.ts` proves PNG/JPEG/MP4/WebP/TIFF round-trip. `c2pa-dual-transport-parity.test.ts` proves both download paths emit identical bytes. Concern #8 cryptographic-binding closed by validation_status + tamper test.   |
| PROV-V-02   | 14-02..05 cohort  | Manifest includes explicit AI-origin disclosure (`c2pa.created` action with ComfyUI as generator, primary model as digitalSourceType / softwareAgent). | ✓ SATISFIED       | `manifest-builder.ts` hardcodes `softwareAgent.name='ComfyUI'` + `digitalSourceType: trainedAlgorithmicMedia`. Tests 11-13 lock the contract. Primary model derived from Phase 13's getLatestFingerprints. |
| PROV-V-05   | 14-01..05 cohort  | For non-embed formats, sidecar `.c2pa` file alongside output. Dashboard surfaces both.                              | ⚠️ PARTIAL (deferred to v1.2 per Concern #2) | TIFF added to native-embed (BETTER than spec). EXR/PSD deferred — c2pa-node v0.5.26 has no public sidecar API. v1.2 deferred items captured in `REQUIREMENTS.md` "Deferred to v1.2" section. Dashboard `C2paBadge` surfaces signing state for all formats. **This partial completion is explicitly approved by the partial-scope-reduction note in REQUIREMENTS.md** — no gap. |

### Anti-Patterns Found

| File                                                | Line     | Pattern                          | Severity | Impact                                                                                                                                                              |
| --------------------------------------------------- | -------- | -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)                                              | -        | -                                | -        | All code paths reviewed: no TODO/FIXME/HACK comments, no `return null` stubs in component code, no hardcoded empty data flowing to render, no `console.log`-only handlers. v1.2 deferred items are EXPLICIT scope decisions, not anti-patterns. |

### Human Verification Required

None. The C2paBadge component is exercised by 11 dedicated dashboard tests + 8 VersionDrawer integration tests covering all 3 visual states, 6 reason codes, T-14-11 XSS mitigation (script payload sanitization), and ARIA accessibility. The dashboard bundle is rebuilt and verified to include the badge strings. Browser-rendered visual smoke could be added but is not required for this verification — the rendered output strings are tested at the JSX/DOM level.

### Gaps Summary

**No gaps.** All 5 ROADMAP success criteria verified at the codebase + test level. Phase 14 cohort closure is complete:

- **PROV-V-01 + PROV-V-02:** Fully complete. Five formats (PNG/JPEG/MP4/WebP/TIFF) sign + verify round-trip with c2pa-rs-validated cryptographic binding.
- **PROV-V-05:** Partially complete by explicit scope reduction (Concern #2). TIFF native-embed shipped (better than the original sidecar spec). EXR/PSD deferred to v1.2 with full v1.2 deferred-items list captured in REQUIREMENTS.md (cryptographic sidecar API, sidecar HTTP route, HSM signing, multi-CA, streaming-friendly C2PA). This is honest scope tracking, not a gap.
- **Dual-transport parity (success criterion #5):** Achieved trivially via signing-at-write-time (Plan 14-03 architectural choice). HTTP body bytes ≡ direct file read.
- **Key-leak negatives:** Random 32-byte slice + PEM marker checks across 5 channels (stdout, stderr+console, tool envelope, HTTP body, provenance JSON). T-14-12 schema regression guard prevents future regressions.
- **Architecture purity:** 30/30 tests pass; c2pa-node centralized to signer.ts only; append-only provenance preserved (zero this.db.update/delete in entire repo).

**Rule 1 silent-failure bug fix verified in commit 72b1e48** — `Engine.signViaTempFiles` now accepts the original filename and preserves `nodepath.extname(filename)` on temp paths. Without this, MP4/WebP/TIFF would have shipped unsigned bytes with `signed: true` in the manifest_signed event. The fix was discovered during Plan 14-05's verification-first methodology — strong validation of the verification-first approach the plan mandates.

**Test counts confirmed:**
- Root suite: **1038 passing**, 5 pre-existing v1.1-audit failures (unchanged, documented in `.planning/phases/10-migrate-on-boot-hardening/deferred-items.md`), 3 skipped
- Dashboard suite: **88 passing**
- TypeScript: `npx tsc --noEmit` clean
- Architecture purity: 30/30 pass

Phase 14 is locked. Phase 15 (Ingredient Graph) is unblocked.

---

_Verified: 2026-04-30T13:55:00Z_
_Verifier: Claude (gsd-verifier)_
