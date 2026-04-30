---
phase: 16-redaction-and-agent-surface
plan: 04
subsystem: api
tags: [c2pa, redaction, agent-surface, mcp-tool, redact-manifest, prov-v-06, dual-transport, d-ctx-1, append-only]

# Dependency graph
requires:
  - phase: 16-redaction-and-agent-surface (Plan 16-02)
    provides: "Engine.redactManifestForVersion facade + RedactionResult interface + 6 new ErrorCodes (REDACT_NO_MANIFEST, REDACT_PARENT_UNREADABLE, REDACT_POLICY_INVALID, REDACT_TIMEOUT, REDACT_SIGNING_DISABLED, REDACT_DB_WRITE_FAILED)"
  - phase: 16-redaction-and-agent-surface (Plan 16-03)
    provides: "export_manifest + verify_manifest version-tool actions; wire-level dual-transport harness pattern (seedSignedVersionInDb + connectStdio + connectHttp + readPayload helpers)"
  - phase: 14-c2pa-signed-manifest
    provides: "buildManifestDefinition (title='Version ${versionId}'); LocalSigner load pattern; bundled c2pa-node dev cert paths; VFX_FAMILIAR_C2PA_TRUST_DEV_CERT env var; RUNTIME DEVIATION mitigation (VFX_FAMILIAR_C2PA_TSA_URL)"
provides:
  - "version.redact_manifest agent-surface action — third PROV-V-06 wire surface (after Plan 16-03's export_manifest + verify_manifest); D-PROV-08 dual-form envelope with manifest_bytes_base64 + redacted_fields + not_found"
  - "Tool-layer architecture-purity preserved at PROV-V-06 wire boundary (zero c2pa-node imports in version-tool.ts)"
  - "D-CTX-1 wire-level invariant locked at three layers: helper (Plan 16-02 Test 12), integration (Plan 16-02 Test 17), WIRE (this plan Tests 2 + 11)"
  - "Append-only contract verified at wire boundary (Test 14 — direct SQLite read before/after redact_manifest)"
  - "C-08 byte-equal round-trip lock — redact-then-verify-by-bytes self-checking via tool-layer envelope (Test 21 unit)"
  - "C-08 3-way equivalence lock (Test 22 unit) — input policy ↔ engine RedactionResult.redactedFields ↔ envelope.redacted_fields"
affects: [16-05, future-redaction-extensions, agent-surface-clients]

# Tech tracking
tech-stack:
  added: []   # no new runtime dependencies
  patterns:
    - "Tool layer extension pattern: discriminated z.union arm + envelope shaper + switch case + inputSchema enum extension; ZERO logic inline; engine facade dispatch only (mirror Plan 16-03)"
    - "D-CTX-1 wire-level invariant test pattern: c2pa.read on decoded bytes → assert active_manifest.title === '[REDACTED]' + multi-encoding scan over active-manifest projection (NOT raw bytes — parent chain legitimately preserves originals via C2PA chain-of-custody design)"
    - "Multi-encoding scan helper: assertNotInBuffer(buf, secret, label) covers UTF-8/ASCII, UTF-16LE, UTF-16BE-roughly, base64; catches encoding-bypass leaks"
    - "Tool-layer test mock harness pattern: createMockServer + buildStack + seedCompleted (mirror Plan 16-03 unit-test pattern verbatim)"

key-files:
  created:
    - "src/tools/__tests__/version-tool-redact.test.ts (23 unit tests; 626 lines)"
    - "src/__tests__/version-tool-dual-transport-redact.test.ts (14 wire-level tests; 791 lines)"
  modified:
    - "src/tools/version-tool.ts (+128 lines: RedactManifestInput Zod schema + MAX_REDACTION_POLICY_ENTRIES + MAX_REDACTION_POLICY_ENTRY_LENGTH constants + shapeRedactManifestEnvelope + switch case + inputSchema.action enum extension + redaction_policy field addition + tool description prose)"
    - "src/tools/__tests__/version-tool-export-verify.test.ts (Rule 3 deviation — Test 25 sentinel rejected literal updated from 'redact_manifest' to 'not_a_real_action' since redact_manifest is now a valid action enum member)"

key-decisions:
  - "[D-PLAN-4-6 / C-08 documentation]: payload-internal certSubject (RedactionResult, camelCase) maps verbatim to envelope cert_subject (snake_case) — Phase 14-style convention boundary, NOT a bug; documented in shapeRedactManifestEnvelope JSDoc"
  - "[D-PLAN-4-3 defence-in-depth]: Zod schema caps redaction_policy at 32 entries (mirror engine's D-CTX-8 cap) and 1024 chars per entry — coarse pre-engine guard against pathological payloads; engine's bounded-resolver enforces character allowlist + 64-segment cap as second layer"
  - "[D-PLAN-4-2 envelope mirror]: redact_manifest envelope mirrors export_manifest's manifest_bytes_base64 + cert_subject + format + signed_at + breadcrumb pattern + adds redaction-specific redacted_fields/not_found — caller can pipe straight into verify_manifest (bytes form) for self-checking redact-then-verify"
  - "[Sentinel choice for D-CTX-1 wire-level test]: used auto-generated seed.versionId rather than synthetic SECRET_TITLE_42 — Phase 14's buildManifestDefinition writes 'title: Version ${versionId}', making the unique versionId an organic sentinel without harness change; emoji boundary case requires manifest-builder titleOverride extension (deferred-items.md v1.2 if reviewer flags)"
  - "[D-CTX-1 SCOPE LIMITATION reaffirmation at wire boundary]: C2PA's chain-of-custody design preserves the parent manifest as parent_relationship ingredient — original values may legitimately appear in raw bytes. Test 2 + Test 11 read active_manifest via c2pa.read (the spec-compliant verifier surface) and assert title === '[REDACTED]' + run multi-encoding scan over the active-manifest projection (NOT raw bytes); parent-chain scrubbing requires c2pa-rs's manifest-removal API (deferred-items.md v1.2 follow-up)"
  - "[Phase 14 RUNTIME DEVIATION mitigation in test harness]: VFX_FAMILIAR_C2PA_TSA_URL='http://timestamp.digicert.com' set in spawned-server env so the LocalSigner literal carries a valid TSA URL; without it c2pa-node v0.5.26 fails at sign time with 'failed to downcast any to string' (LocalSigner property omission downcast bug, documented in src/engine/c2pa/signer.ts file header)"
  - "[Test 4 + Test 14 isolation pattern]: each test seeds a fresh DB + outputsDir because redact_manifest writes redacted bytes back to disk; reusing the shared describe-block seed would cause cross-test pollution (Test 14's append-only-contract assertion depends on the seed having exactly 1 manifest_signed event before redact)"

patterns-established:
  - "Tool-action TDD pattern (Plan 16-03 + 16-04): RED — write 23 unit tests covering Zod validation surfaces + dispatch + envelope shape + error mapping + invariants + cross-layer; GREEN — extend tool layer with schema + union arm + inputSchema field + envelope shaper + switch case; commit each phase atomically"
  - "Active-manifest projection D-CTX-1 verification pattern: c2pa.read(redactedBytes) → JSON.stringify({claim_generator, format, title, assertions}) → assertNotInBuffer with multi-encoding scan; the projection scope respects C2PA chain-of-custody by NOT scanning the parent ingredient chain"

requirements-completed: []   # PROV-V-06 cohort closure happens in Plan 16-05 (E2E + cohort closure); this plan is Wave 3 of 4

# Metrics
duration: 14min
completed: 2026-04-30
---

# Phase 16 Plan 04: redact_manifest Agent-Surface Action Summary

**redact_manifest version-tool action with D-CTX-1 wire-level invariant + D-PROV-08 dual-form envelope, completing PROV-V-06 wire surface (cohort closure pending Plan 16-05)**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-04-30T19:52:26Z
- **Completed:** 2026-04-30T20:08:00Z (approx)
- **Tasks:** 2 (TDD: RED + GREEN per task)
- **Files modified:** 3 (1 source, 1 unit test, 1 dual-transport test)

## Accomplishments

- **redact_manifest action** wired through version tool's discriminated union (action count 6 → 7; tool count remains 7 of 12 cap)
- **Architecture-purity preserved** — version-tool.ts has ZERO c2pa-node imports (all access via Engine facade)
- **D-CTX-1 wire-level invariant** locked at THREE layers across Phase 16:
  - helper test (Plan 16-02 Test 12): JSON-string search of pure-helper output
  - integration test (Plan 16-02 Test 17): c2pa.read on re-signed bytes — active manifest assertion
  - **WIRE test (this plan Tests 2 + 11)**: c2pa.read on bytes returned over stdio + HTTP transports — multi-encoding scan over active-manifest projection
- **Append-only contract** verified at wire boundary (Test 14 — direct SQLite read before/after; original manifest_signed event row JSON byte-identical)
- **C-08 byte-equal round-trip** verified (Test 21 unit) — redact_manifest decodes to engine's redactedBytes byte-for-byte; verify_manifest by-bytes consumes same buffer
- **C-08 3-way equivalence** locked (Test 22 unit) — input policy ↔ engine RedactionResult.redactedFields ↔ envelope.redacted_fields
- **C-08 multi-entry policy ordering** documented (Test 23 unit) — envelope preserves engine's order verbatim, NOT input declaration order
- **Defence-in-depth Zod caps**: redaction_policy ≤ 32 entries × ≤ 1024 chars per entry (mirror engine's D-CTX-8 cap; coarse pre-engine guard against pathological payloads)
- **Verbatim error code passthrough**: 5 engine TypedError codes flow through toolError unchanged (VERSION_NOT_FOUND, REDACT_NO_MANIFEST, REDACT_PARENT_UNREADABLE, REDACT_POLICY_INVALID, EXPORT_PATH_TRAVERSAL_REJECTED)
- **D-PROV-08 dual-form mirror** at HTTP wire boundary (Test 13)
- **Dual-transport parity** (Test 12) — stdio + HTTP envelopes deepEqual after stripping non-deterministic fields (signed_at + manifest_bytes_base64)

## Task Commits

1. **Task 1 RED** — `dccb7be` (test): 23 failing tests added; 13 fail because action not registered, 10 pass on Zod-negative paths since the union rejects unknown 'redact_manifest' literal as INVALID_INPUT
2. **Task 1 GREEN** — `fc984da` (feat): RedactManifestInput schema + union extension + shapeRedactManifestEnvelope + switch case + inputSchema field + tool description; Rule 3 deviation in version-tool-export-verify.test.ts (Test 25 sentinel updated)
3. **Task 2** — `fd99293` (test): 14 wire-level dual-transport tests (stdio + HTTP parity, D-CTX-1 active-manifest invariant, append-only contract, dual-transport deepEqual, D-PROV-08 mirror)

## Files Created/Modified

- `src/tools/version-tool.ts` — extended with redact_manifest action arm (+~128 lines)
- `src/tools/__tests__/version-tool-redact.test.ts` — 23 unit tests covering Zod + dispatch + envelope + error mapping + invariants + C-08 cross-layer (NEW, 626 lines)
- `src/__tests__/version-tool-dual-transport-redact.test.ts` — 14 wire-level dual-transport tests (NEW, 791 lines)
- `src/tools/__tests__/version-tool-export-verify.test.ts` — Rule 3 deviation: Test 25 sentinel updated (was rejecting 'redact_manifest' as unknown; now valid)

## Decisions Made

See frontmatter `key-decisions` for the full list. Key highlights:

- **Sentinel choice**: used auto-generated `seed.versionId` directly — Phase 14's buildManifestDefinition writes `title: Version ${versionId}`, organic sentinel without harness change
- **D-CTX-1 active-manifest scope**: c2pa.read on bytes → check active_manifest.title === '[REDACTED]' + multi-encoding scan over active-manifest projection (claim_generator + format + title + assertions[]); parent chain legitimately preserves originals via C2PA chain-of-custody design
- **Naming drift documentation (D-PLAN-4-6 / C-08)**: engine's RedactionResult.certSubject (camelCase, payload-internal) → envelope.cert_subject (snake_case, agent-facing) — INTENTIONAL Phase 14-style convention boundary, NOT a bug; documented in shapeRedactManifestEnvelope JSDoc

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan 16-03 Test 25 sentinel collision after enum extension**

- **Found during:** Task 1 GREEN (after extending the version-tool inputSchema action enum)
- **Issue:** Plan 16-03 Test 25 (`registerTool inputSchema action enum lists all 6 actions`) used `'redact_manifest'` as the sentinel for the rejection-path assertion (`expect(() => actionSchema.parse('redact_manifest')).toThrow()`). Once Plan 16-04 added 'redact_manifest' to the enum, this assertion broke.
- **Fix:** Updated Test 25 in `src/tools/__tests__/version-tool-export-verify.test.ts` to: (a) add `not.toThrow()` assertion for 'redact_manifest' (it's now a valid enum member), (b) swap the rejection-path sentinel to `'not_a_real_action'` (a clearly-invalid literal that will never become a valid action). Direct consequence of this plan's surface change — bundled into Task 1 GREEN commit per Rule 3 scope-boundary.
- **Files modified:** src/tools/__tests__/version-tool-export-verify.test.ts
- **Verification:** Architecture-purity test green (35 passing); version-tool-export-verify.test.ts (25 tests) green; version-tool-redact.test.ts (23 tests) green
- **Committed in:** fc984da (Task 1 GREEN commit)

**2. [Rule 3 - Blocking] Phase 14 RUNTIME DEVIATION mitigation needed in dual-transport spawn env**

- **Found during:** Task 2 (running first dual-transport test)
- **Issue:** Initial test run failed with `C2PA_SIGNING_FAILED: c2pa-node sign() rejected the asset: TypeError: failed to downcast any to string` on the spawned server's redact_manifest path. The spawned server's signer was loading WITHOUT VFX_FAMILIAR_C2PA_TSA_URL, so the LocalSigner literal omitted the property. Phase 14's documented runtime deviation (src/engine/c2pa/signer.ts file header) — c2pa-node v0.5.26 native binding requires tsaUrl to be ABSENT or a VALID URL (the LocalSigner property-omission path triggers a downcast bug at sign time, NOT load time). Plan 16-03's dual-transport tests don't exercise re-sign so they didn't trip this.
- **Fix:** Added `env.VFX_FAMILIAR_C2PA_TSA_URL = 'http://timestamp.digicert.com'` to BOTH `connectStdio` and `connectHttp` spawn-env builders when `c2paEnabled=true` (mirror c2pa-node's createTestSigner default + Phase 14 sign harness pattern).
- **Files modified:** src/__tests__/version-tool-dual-transport-redact.test.ts
- **Verification:** All 14 wire-level tests pass (signed PNG round-trip through redact_manifest works on bundled c2pa-node es256 cert chain).
- **Committed in:** fd99293 (Task 2 commit)

**3. [Rule 1 - Bug] Initial D-CTX-1 wire-level test approach was over-aggressive**

- **Found during:** Task 2 (running D-CTX-1 invariant tests after fixing the TSA URL deviation)
- **Issue:** Initial Tests 2 + 4 + 11 used a raw-byte string-search of the redacted bytes via `assertNotInBuffer(redactedBuf, originalTitle, ...)`. This failed because C2PA's chain-of-custody design preserves the parent manifest (with original title) as a `parent_relationship` ingredient inside the new active manifest — the original title legitimately appears in the JUMBF chain via the parent ingredient. Plan 16-02 Test 17 had already documented this scope limitation but the test approach in this plan inherited the "naive raw-byte scan" idea from the planner's original test sketch.
- **Fix:** Updated Tests 2 + 4 + 11 to mirror Plan 16-02 Test 17's pattern: `c2pa.read` the redacted bytes → assert `active_manifest.title === '[REDACTED]'` + multi-encoding scan over the active-manifest projection (claim_generator + format + title + assertions[]). The active-manifest projection is the spec-compliant verifier surface; D-CTX-1 only governs that surface, NOT the parent chain.
- **Files modified:** src/__tests__/version-tool-dual-transport-redact.test.ts (Tests 2, 4, 11 + file header documentation explaining the SCOPE LIMITATION)
- **Verification:** All 14 wire-level tests pass; D-CTX-1 wire-level invariant verified at the active-manifest projection layer (the layer the spec governs).
- **Committed in:** fd99293 (Task 2 commit)

**4. [Rule 1 - Bug] claim_generator strict-equality assertion broke after c2pa-rs version-suffix appending**

- **Found during:** Task 2 (running multi-path Test 4 after fixing the active-manifest projection approach)
- **Issue:** Test 4's assertion `expect(redactedStore!.active_manifest!.claim_generator).toBe('[REDACTED]')` failed because c2pa-rs APPENDS its own version info to claim_generator at write time (e.g., `'[REDACTED] c2pa-node/0.5.26 c2pa-rs/0.49.2'`).
- **Fix:** Updated to prefix-match regex: `expect(...).toMatch(/^\[REDACTED\]/)` (mirror Plan 16-02 redaction.test.ts pattern at line 599+).
- **Files modified:** src/__tests__/version-tool-dual-transport-redact.test.ts (Test 4)
- **Verification:** Test 4 green; tests pass (14/14).
- **Committed in:** fd99293 (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (3 Rule 3 blocking, 1 Rule 1 bug — though the Rule 1 case is more "matching the established convention from Plan 16-02").

**Impact on plan:** All deviations were direct consequences of plan-execution boundary issues — Plan 16-03's Test 25 sentinel collision (the planner couldn't have foreseen Plan 16-04 would extend the same enum), Phase 14's runtime deviation re-asserted at the redact wire boundary (Plan 16-03's tests didn't exercise re-sign), the C2PA chain-of-custody scope limitation re-asserting at the wire layer (the planner's test sketch used the naive byte-search approach that Plan 16-02 had already documented as inadequate), and c2pa-rs's version-suffix appending convention. No scope creep; all auto-fixes preserve the plan's intent.

## Issues Encountered

- **c2pa-node v0.5.26 LocalSigner downcast bug** — re-asserted at the redact_manifest wire boundary because redact re-signs (Plan 16-03's export+verify don't sign). Resolved via VFX_FAMILIAR_C2PA_TSA_URL env var in spawn harness (mirror Phase 14 pattern).
- **C2PA chain-of-custody parent preservation** — naive raw-byte string search of redacted bytes finds original values in the parent ingredient chain. Resolved by switching D-CTX-1 wire-level test to active-manifest projection approach (the spec-compliant verifier surface).
- **c2pa-rs version-suffix appending to claim_generator** — strict equality fails on `'[REDACTED] c2pa-node/...'`. Resolved via prefix regex match (mirror Plan 16-02 redaction.test.ts pattern).

## User Setup Required

None — no external service configuration required for this plan. The bundled c2pa-node es256 dev cert chain at `node_modules/c2pa-node/tests/fixtures/certs/` covers all signing tests; VFX_FAMILIAR_C2PA_TRUST_DEV_CERT=1 in the spawn env opts the verifier into accepting dev cert codes.

## Next Phase Readiness

- **Plan 16-05 (E2E + cohort closure) UNBLOCKED.** This plan completes the third agent-surface action (redact_manifest); the cohort of three actions (export_manifest + verify_manifest + redact_manifest) now exists at the wire boundary.
- **PROV-V-06 wire-level surface complete** pending Plan 16-05 cohort closure (Plan 16-05 ties the cohort together with end-to-end fixture tests proving sign → export → redact → verify round-trip across both transports).
- **Architecture-purity invariant carries forward**: version-tool.ts ZERO c2pa-node imports preserved across Plans 16-03 + 16-04 (architecture-purity guard at architecture-purity.test.ts grep gate green; Test 19 in version-tool-redact.test.ts re-asserts file-level).
- **Pre-existing 4 v1.1-audit failures unchanged** (validation-flags.test.ts × 2 + phase-attribution.test.ts × 2 — ROADMAP-shape audit failures from Phase 10 baseline; logged in deferred-items.md for milestone close).
- **Test count delta**: +37 root tests (1306 → 1343 passing).

## Test Counts

| Layer | Before Plan 16-04 | After Plan 16-04 | Delta |
|-------|-------------------|------------------|-------|
| Root suite (passing) | 1306 | 1343 | +37 |
| Failing (pre-existing v1.1-audit) | 4 | 4 | 0 |
| Skipped | 3 | 3 | 0 |

New tests:
- 23 unit tests in `src/tools/__tests__/version-tool-redact.test.ts`:
  - 10 Zod validation cases (size + length caps + version_id constraints)
  - 3 dispatch + envelope shape (happy + breadcrumb + D-PROV-08 dual-form mirror)
  - 5 error mapping (VERSION_NOT_FOUND, REDACT_NO_MANIFEST, REDACT_PARENT_UNREADABLE, REDACT_POLICY_INVALID, EXPORT_PATH_TRAVERSAL_REJECTED)
  - 2 invariants (architecture-purity self-check + action-enum visibility)
  - 3 C-08 cross-layer (byte-equal round-trip, 3-way equivalence, multi-entry policy ordering)
- 14 wire-level tests in `src/__tests__/version-tool-dual-transport-redact.test.ts`:
  - 8 stdio (signed seed): happy path, D-CTX-1 active-manifest invariant, not_found soft warning, multi-path policy + active-manifest invariant, REDACT_POLICY_INVALID on traversal, VERSION_NOT_FOUND, INVALID_INPUT empty + oversized policy
  - 1 stdio (signed seed): append-only contract via direct SQLite read
  - 1 stdio (unsigned seed): REDACT_NO_MANIFEST or REDACT_SIGNING_DISABLED
  - 4 HTTP parity: happy path, D-CTX-1 active-manifest invariant, dual-transport deepEqual, D-PROV-08 dual-form mirror

## Self-Check: PASSED

- [x] `src/tools/version-tool.ts` — verified contains RedactManifestInput, MAX_REDACTION_POLICY_ENTRIES, MAX_REDACTION_POLICY_ENTRY_LENGTH, shapeRedactManifestEnvelope, redactManifestForVersion call, 'redact_manifest' literal (in case + enum)
- [x] `src/tools/version-tool.ts` — ZERO c2pa-node imports (architecture-purity grep gate green)
- [x] `src/tools/__tests__/version-tool-redact.test.ts` exists (626 lines)
- [x] `src/__tests__/version-tool-dual-transport-redact.test.ts` exists (791 lines)
- [x] Commits exist in `git log`: dccb7be, fc984da, fd99293
- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run` — 1343 passing / 4 pre-existing failing / 3 skipped
- [x] Architecture-purity test green (35 passing)

---
*Phase: 16-redaction-and-agent-surface*
*Plan: 04 (Wave 3 of 4)*
*Completed: 2026-04-30*
