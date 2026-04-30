# Phase 16 Plan Revision Response — Adversarial Crypto-Correctness Review

**Reviewer:** gsd-plan-checker (codex substitute, 2026-04-30)
**Revisor:** gsd-plan-phase planner (Opus 4.7)
**Date:** 2026-04-30

This document records how each BLOCKER + CONCERN from
`16-PLAN-CHECK-CODEX-SUBSTITUTE.md` was addressed across plans 16-01..16-05.

## Status Summary

| ID    | Class    | Disposition | Plans Edited                                     |
|-------|----------|-------------|--------------------------------------------------|
| C-01  | BLOCKER  | REVISED     | 16-02, 16-04, 16-05                              |
| C-02  | BLOCKER  | REVISED     | 16-02 (helper docstring + Test 18 + Test 14)    |
| C-03  | BLOCKER  | REVISED     | 16-02 (manifest-builder + extractAssertions + Test 16/16b) |
| C-04  | BLOCKER  | REVISED     | 16-02, 16-05                                     |
| C-09  | BLOCKER  | REVISED     | 16-01, 16-05                                     |
| C-05  | CONCERN  | REVISED     | 16-02 (validatePolicy + walkAndRedact depth), 16-03 (base64 cap), 16-04 (Zod cap unchanged — already at 1024 chars; engine layer enforces 32-entry cap) |
| C-06  | CONCERN  | REVISED     | 16-02 (REDACT_SIGNING_DISABLED + REDACT_DB_WRITE_FAILED + REDACT_TIMEOUT) |
| C-07  | CONCERN  | REVISED     | 16-03 (error-path parity Test 14 + 5MB Test 15 + SSE Test 15a) |
| C-08  | CONCERN  | REVISED     | 16-04 (D-PLAN-4-6 + Tests 21-23)                 |
| C-10  | CONCERN  | REVISED     | 16-05 (Step 0 verifier-gate + rollback procedure + arch-purity SET-equality note) |
| C-11  | CONCERN  | REVISED     | 16-03 (Test 26), 16-04 (Test 24)                 |
| C-12  | CONCERN  | REVISED     | 16-04 (depends_on: ["16-02", "16-03"])           |

All 5 BLOCKERS + all 6 CONCERNS REVISED. None deferred. None not-applicable.

## Per-Plan Revision Detail

### Plan 16-01 (1170 → 1217 lines)

**BLOCKER C-04 (architecture-purity SET-equality):** Step 2 of Task 3 reshaped
the centralization test from a pure SUBSET check to a TWO-LAYER assertion:
(a) violations check (no rogue importer outside the allowed set), AND
(b) sorted-array deepEqual on EXACT actual-importer list. This locks in
`['signer.ts', 'verifier.ts'].sort()` for the Plan-16-01 wave (exporter.ts
reserves a slot but does NOT actually import c2pa-node), and Plan 16-02
extends to the 4-element list at its wave.

**BLOCKER C-09 (verifier dev-cert handling):** Added new D-PLAN-5 decision
documenting the opt-in via `VFX_FAMILIAR_C2PA_TRUST_DEV_CERT` env var:

- Production default (env unset): `signingCredential.untrusted` →
  `signature_status='untrusted_root'` + `valid=false`.
- Dev mode (env='1'): the verifier filters DEV_ACCEPTABLE_CODES (mirror
  of Phase 14's ACCEPTABLE_VALIDATION_CODES list at
  `src/__tests__/c2pa-verification.test.ts:241-247`) BEFORE
  classifySignatureStatus runs.

Also corrected the validation_status code literal in classifySignatureStatus
from `claimSignature.untrusted` → `signingCredential.untrusted` (the actual
c2pa-rs code per the Phase 14 reference). Added Test 4b for the dev-cert
opt-in branch.

**Test count:** +1 (Test 4b dev-cert opt-in branch) → behaviors block now
asserts 13 unit cases (was 12).

### Plan 16-02 (1360 → ~1500 lines)

**BLOCKER C-01 (recursive structure-preserving redactValue + multi-encoding scan
+ scope limitation docstring):**

- Rewrote `redactValue()` (line ~700-706): recursive walk descending into
  nested objects/arrays preserving STRUCTURE; replaces every LEAF with the
  sentinel string. Original-value leakage is now structurally impossible.
- Added D-CTX-1 SCOPE LIMITATION comment block: "manifest JSON only; ASSET
  BINARY (PNG tEXt/iTXt, EXIF, ID3, pixel data) UNCHANGED. Asset-binary
  scrubbing is out of scope v1.1."
- Added Test 15a (helper-level structure preservation): policy
  `["assertions[label='vfx_familiar.input'].data"]` redacts the WHOLE
  `data` object but result is a same-shape object with sentinel leaves.
- Updated Test 17 (integration multi-encoding scan): added
  `assertNotInBuffer` helper covering UTF-8, UTF-16LE, UTF-16BE-roughly,
  base64 — plus a non-ASCII (emoji) sentinel test.
- Updated T-16-08 threat model row to reference Test 12 + 15a + 17
  multi-layer mitigation.

**BLOCKER C-02 (append-only ordering + full-row equality):**

- Test 18 description updated to use `ORDER BY timestamp ASC, id ASC` (was
  `timestamp ASC` alone — non-deterministic at ms tick) AND
  `SELECT * FROM provenance WHERE id = ?` for full-row deepEqual (was
  column-only equality on manifest_signed_json).
- Added docstring on the test + on appendManifestSignedRedactedEvent: the
  redacted=true GUARD runs BEFORE insertEvent (pre-commit reject; no row
  inserted on misuse).

**BLOCKER C-03 (TypeScript shape mismatch + actions chain normalization):**

- Added `manifest-builder.ts` to `files_modified[]` (Plan 16-02 frontmatter).
- New Step 0 (BEFORE redaction.ts creation): edit
  `src/engine/c2pa/manifest-builder.ts` to add `VendorRedactedAssertion`
  interface and extend `ManifestAssertion` discriminated union. Without
  this, `as ManifestAssertion` in redaction.ts FAILS `tsc --noEmit`.
- Replaced unsafe `as ManifestAssertion` cast in `extractAssertions` with
  proper validation: KNOWN_ASSERTION_LABELS Set + `c2pa.actions.v2` →
  `c2pa.actions` normalization + drop of unknown labels.
- Test 16 enhanced (d): assert BOTH `vfx_familiar.redacted` AND
  `c2pa.actions[.v2]` survive after redact (proves actions chain
  round-trip).
- New Test 16b: extractAssertions normalization round-trip — synthetic
  c2pa-node ResolvedManifest with `c2pa.actions.v2` + `unknown.label` →
  output has `c2pa.actions` (normalized) + only known labels (unknown
  dropped); no "unknown label" rejection at downstream re-sign.

**BLOCKER C-04 (mutex semantics + atomic disk write):**

- Replaced D-PLAN-2-4 with full pseudocode for unified
  `acquireAssetWriterLock` (FIFO serializing, distinct from Plan 15-03's
  coalescing signMutex). Both Engine.signOutput AND
  Engine.redactManifestForVersion acquire this map.
- 30s acquire timeout; throws REDACT_TIMEOUT typed error.
- Added atomic disk write block in `redactManifestForVersionImpl`:
  temp + rename pattern; on failure, cleans up temp file and throws
  REDACT_DB_WRITE_FAILED. The disk file is overwritten BEFORE the new
  manifest_signed event is inserted.
- Updated facade call from `acquireSignMutex.bind(this)` →
  `acquireAssetWriterLock.bind(this)`.
- Updated T-16-13 threat row: now references unified mutex + serializing
  semantics. Added T-16-15a row for assetWriterMutex acquire-hang DoS.

**CONCERN C-05 (policy DSL hardening):**

- `validatePolicy` rejects NUL bytes, CR/LF, Unicode bidi overrides
  (U+202A-U+202E + U+2066-U+2069), %, <, > BEFORE traversal/regex checks.
- Added 256-char cap on `[label='X']` value.
- Added `MAX_WALK_DEPTH=32` depth check in `walkAndRedact` (combined
  policy segments + manifest data nesting).
- All 3 recursion call sites updated to pass `depth + 1`.

**CONCERN C-06 (error-mapping cleanup):**

- Added 3 new ErrorCode values: `REDACT_TIMEOUT`, `REDACT_SIGNING_DISABLED`,
  `REDACT_DB_WRITE_FAILED`.
- `c2paConfig === null` now throws REDACT_SIGNING_DISABLED (was
  REDACT_NO_MANIFEST — wrong semantic).
- `appendManifestSignedRedactedEvent` insert wrapped in try/catch;
  failures throw REDACT_DB_WRITE_FAILED with actionable hint
  ("disk file IS overwritten; next call will append a new row over
  the same disk state").

**Test count:** +2 (Test 15a structure preservation + Test 16b extractAssertions
normalization) → 28 cases (was 26). Note: Test 16 was enhanced (not added)
to also assert actions chain survival.

### Plan 16-03 (1036 → ~1075 lines)

**CONCERN C-05 (HTTP body limit hardening):**

- `MAX_VERIFY_BYTES_BASE64` reduced from 700 MB → 100 MB (verify is
  metadata, not asset bytes — 700 MB was too lenient for DoS protection).
- Documented Hono bodyLimit must be configured to match (≥100 MB).
- Updated T-16-17 threat row + Test 9 description.

**CONCERN C-07 (dual-transport parity):**

- New Test 14: error-path parity (INVALID_INPUT over BOTH transports →
  deepEqual envelopes; catches transport-specific error reformatting).
- New Test 15: 5MB base64 round-trip parity (export over stdio →
  re-feed to verify_manifest by bytes form over HTTP); catches base64
  chunking / Hono body limits / Streamable HTTP framing issues.
- New Test 15a: SSE response form fallback OR document SSE disabled.

**CONCERN C-11 (tools/list runtime test):**

- New Test 26: spawn real server, call MCP `tools/list`, parse
  inputSchema; assert action enum array contains both new actions.
  Documents Zod `z.union` JSON-Schema discriminator limitation as
  v1.2 deferred work.

**Test count:** +4 (Tests 14, 15, 15a, 26).

### Plan 16-04 (995 → ~1040 lines)

**CONCERN C-08 (envelope vs RedactionResult drift):**

- New D-PLAN-4-6 decision: documents `cert_subject_summary` (payload) vs
  `cert_subject` (envelope) drift as Phase 14-style convention boundary
  (intentional, not a bug).
- New Test 21: wire-level byte-equal round-trip (redact → decode → verify).
- New Test 22: 3-way equivalence (input policy ↔ result.redactedFields ↔
  vfx_familiar.redacted assertion data).
- New Test 23: multi-entry policy ordering (3+ entries; envelope preserves
  ENGINE's order verbatim, not input declaration order).

**CONCERN C-11 (tools/list runtime test):**

- New Test 24: dual-transport tools/list verification.
- Documents JSON-Schema discriminator limitation; tracks v1.2 refactor
  in deferred-items.

**CONCERN C-12 (depends_on consistency):**

- Frontmatter `depends_on` updated from `["16-02"]` → `["16-02", "16-03"]`
  (16-04 extends the same version-tool.ts that 16-03 modified — must
  serialize on the same file).

**BLOCKER C-01 (multi-encoding scan in wire tests):**

- Added `SECRET_EMOJI_FRAGMENT` non-ASCII sentinel + `assertNotInBuffer`
  helper to the test file's harness section.
- Updated stdio Test 2 + HTTP Test 11 to use the multi-encoding helper
  for both ASCII and emoji sentinels.
- Updated Test 2 + Test 11 behavior descriptions to reflect multi-encoding
  scan requirement.

**Test count:** +4 (Tests 21, 22, 23, 24); existing Tests 2 + 11 enhanced
with multi-encoding scan.

### Plan 16-05 (1474 → ~1530 lines)

**BLOCKER C-04 (Scenario B beforeAll cleanup + atomic-write proof):**

- Removed manual `writeFile(join(verDir, seed.filename), redactResult.redactedBytes)`
  from Scenario B beforeAll.
- Test 5 explicitly asserts the engine's atomic write succeeded —
  `Engine.exportManifestForVersion` AFTER `Engine.redactManifestForVersion`
  returns bytes equal to redactResult.redactedBytes (proving
  atomic-write+rename inside the redact path persisted them, not the
  test harness).

**BLOCKER C-09 (E2E + UAT enhancements):**

- Scenario A Test 1: rewrote IT block with the multi-encoding scan helper
  + actions chain survival assertion (`c2pa.actions` OR `c2pa.actions.v2`).
- Scenario B Test 6: sets `VFX_FAMILIAR_C2PA_TRUST_DEV_CERT='1'` in the
  test body (with try/finally restore) so the verifier filters dev-cert
  validation_status codes and reports `valid=true` + `signature_status='valid'`.
- Scenario C Test 7: added explicit assertion that NEW manifest_signed
  event row has `redacted: true` + `redacted_fields: ['not_found:<path>']`
  (audit trail records what was attempted).

**BLOCKER C-01 (multi-encoding scan in wire UAT):**

- Added `SECRET_EMOJI_FRAGMENT` + `assertNotInBuffer` helper to the
  c2pa-redaction-uat-mcp-tool.test.ts harness.
- Test 5 (stdio) + Test 9 (HTTP) updated to use multi-encoding scan
  for both ASCII and emoji sentinels.

**CONCERN C-10 (cohort closure timing + verifier-gate + rollback):**

- New Step 0 in Task 4: BEFORE planning doc edits, run full vitest suite;
  assert pre-existing failure count is exactly 4 (the v1.1-audit baseline)
  AND new test artifacts pass. If gsd-verifier sign-off is preferred,
  document the alternative path.
- Rollback procedure documented: `git restore .planning/REQUIREMENTS.md
  .planning/ROADMAP.md` to revert just the doc changes; test artifacts
  are independently committable so failure to close the cohort doesn't
  require reverting them.
- Behavior bullet added: arch-purity allowed-set deepEqual semantics
  preserved at cohort level — sorted-array deepEqual on EXACT 4-element
  list (signer.ts, exporter.ts, verifier.ts, redaction.ts).

**Test count:** ~30 wire-level UAT cases (Tests 1-12 documented, +2
emoji sentinel multi-encoding additions inline).

## File-Modified List Update

Cumulative changes across all 5 plans:

```
src/engine/c2pa/exporter.ts                            (16-01)
src/engine/c2pa/__tests__/exporter.test.ts             (16-01)
src/engine/c2pa/verifier.ts                            (16-01) — D-PLAN-5 dev-cert opt-in
src/engine/c2pa/__tests__/verifier.test.ts             (16-01) — Test 4b
src/engine/c2pa/index.ts                               (16-01, 16-02)
src/engine/pipeline.ts                                 (16-01, 16-02) — facade methods
src/engine/c2pa/manifest-builder.ts                    (16-02 — NEW per C-03 fix)
src/engine/c2pa/redaction.ts                           (16-02) — recursive redactValue + multi-encoding + atomic disk write + REDACT_* errors + bidi rejection + depth check
src/engine/c2pa/__tests__/redaction.test.ts            (16-02) — Test 15a + Test 16b
src/types/provenance.ts                                (16-02) — additive redacted? + redacted_fields?
src/store/provenance-repo.ts                           (16-02) — appendManifestSignedRedactedEvent + guard
src/engine/errors.ts                                   (16-02) — 6 new ErrorCode values (was 3)
src/__tests__/architecture-purity.test.ts              (16-01, 16-02) — 4-file allowed-set with SET-equality
src/tools/version-tool.ts                              (16-03, 16-04)
src/tools/__tests__/version-tool-export-verify.test.ts (16-03) — Tests 14, 15, 15a, 26
src/tools/__tests__/version-tool-redact.test.ts        (16-04) — Tests 21, 22, 23, 24
src/__tests__/version-tool-dual-transport-export-verify.test.ts (16-03)
src/__tests__/version-tool-dual-transport-redact.test.ts        (16-04) — multi-encoding scan
src/__tests__/c2pa-redaction-e2e.test.ts               (16-05) — Scenario A multi-encoding + Scenario B atomic-write proof + Scenario C audit row check
src/__tests__/c2pa-redaction-uat-mcp-tool.test.ts      (16-05) — multi-encoding scan + dev-cert env var
verify-phase16-uat.mts                                 (16-05)
.planning/REQUIREMENTS.md                              (16-05)
.planning/ROADMAP.md                                   (16-05)
.planning/phases/16-redaction-and-agent-surface/deferred-items.md (16-05)
```

## Test Count Delta

Pre-revision estimate: +151 tests across Phase 16.
Post-revision estimate: +165 tests across Phase 16.

Breakdown:

| Plan  | Pre-rev | Post-rev | Delta | New tests added                                    |
|-------|---------|----------|-------|----------------------------------------------------|
| 16-01 | +25     | +26      | +1    | Test 4b (dev-cert opt-in)                          |
| 16-02 | +26     | +28      | +2    | Test 15a (structure preservation), Test 16b (extractAssertions normalization) |
| 16-03 | +36     | +40      | +4    | Test 14 (error-path parity), Test 15 (5MB), Test 15a (SSE), Test 26 (tools/list) |
| 16-04 | +34     | +38      | +4    | Test 21 (wire-byte round-trip), Test 22 (3-way equiv), Test 23 (multi-entry order), Test 24 (tools/list) |
| 16-05 | +30     | +33      | +3    | Multi-encoding emoji sentinel scans on Tests 5 + 9; Scenario C Test 7 audit row check |
| **Total** | **+151** | **+165** | **+14** | |

Plus enhanced tests (no new test count, but altered behaviors):
- 16-01: Test 4 — corrected to use `signingCredential.untrusted` (the actual c2pa-rs code).
- 16-02: Test 16 — enhanced (d) actions chain survival.
- 16-02: Test 17 — multi-encoding scan helper + emoji sentinel.
- 16-02: Test 18 — full-row equality + ORDER BY (timestamp, id).
- 16-04: Tests 2 + 11 — multi-encoding scan helper + emoji sentinel.
- 16-05: Scenario A Test 1 — multi-encoding helper + actions chain.
- 16-05: Scenario B Test 5 — atomic-write engine proof (no manual writeFile).
- 16-05: Scenario B Test 6 — VFX_FAMILIAR_C2PA_TRUST_DEV_CERT env var.

## Open Items / Notes for Executor

1. The atomic disk write block in 16-02 redactManifestForVersionImpl uses
   a fresh `nanoid()` for the temp filename suffix. The `nanoid` import
   is already at the file's import block (added by Plan 16-02 baseline);
   the executor should NOT re-import — re-using the existing import is
   sufficient.

2. The `acquireAssetWriterLock` helper on the Engine class is a NEW
   addition. Engine.signOutput must ALSO be updated (mentioned in the
   D-PLAN-2-4 prose) to call `acquireAssetWriterLock` as its outer
   wrap so sign + redact serialize. This is a minor refactor of the
   existing Plan 15-03 signMutex flow — keep signMutex for in-flight
   coalescing of the SAME signOutput call (dashboard double-click
   protection), and add assetWriterMutex as the OUTER serializing layer.

3. The architecture-purity test extension for the SET-equality semantics
   (C-04 + C-10) ships in TWO plans:
   - Plan 16-01 establishes the 3-element form (signer + verifier actually
     import; exporter reserves but doesn't import yet).
   - Plan 16-02 extends to 4 elements (adds redaction.ts).
   Both plans must keep the SET-equality assertion in sync — the executor
   should mechanically extend the expected list when adding redaction.ts.

4. The dev-cert opt-in via VFX_FAMILIAR_C2PA_TRUST_DEV_CERT (D-PLAN-5 in
   Plan 16-01) lands in verifier.ts. Plan 16-05's Scenario B Test 6 sets
   the env var; tests in Plan 16-01 (Test 4 + 4b) exercise BOTH branches
   (default production-strict + dev opt-in). Production agents inherit
   the strict default — no opt-in pollution into production.

## Compliance with Mandate

The user mandate was: "For phases 14/15/16 (C2PA crypto correctness matters),
invoke /gstack-codex review at plan stage before execute."

The adversarial review surfaced 5 BLOCKERS + 6 CONCERNS. ALL 11 are now
addressed via surgical edits to plans 16-01 through 16-05. No source
code was modified during this revision — only PLAN.md files. Plans
remain executable; execute-phase will pick them up unchanged in
shape (frontmatter, task structure, verify blocks). The revisions
deepen the test coverage + tighten the engine semantics rather than
expanding scope.

The post-revision plans are ready for `/gsd-execute-phase 16`.
