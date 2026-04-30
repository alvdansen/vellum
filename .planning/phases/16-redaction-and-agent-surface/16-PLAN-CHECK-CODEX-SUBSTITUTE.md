# Phase 16 Plans — Adversarial Review (Codex Substitute)

**Reviewer:** gsd-plan-checker (substituting for codex per crypto-correctness gate)
**Date:** 2026-04-30
**Verdict:** 5 BLOCKERS + 6 CONCERNS — plans MUST revise before execute

## BLOCKERS

### C-01: D-CTX-1 invariant — no original-value leak after redaction
1. Plan 16-02 line 700-706 redactValue() collapses nested objects to `'[REDACTED]'` string — breaks structural type compatibility
2. c2pa.thumbnail leakage path unaddressed (auto-derived by c2pa-rs from asset bytes; not in `assertions[]`; policy DSL can't reach it)
3. Plan 16-02 redaction is C2PA-manifest-only, NOT asset-scrubbing — PNG tEXt/iTXt, EXIF, ID3, pixel data unchanged. D-CTX-1 must explicitly document this limitation
4. String-search testing inadequate — single .toString('binary') scan misses UTF-16, CBOR, base64-in-payload encodings

**Fix:**
- Recursive redactValue() preserving structure; replace LEAF values with sentinel
- D-CTX-1 docstring: "manifest JSON only; asset binary unchanged"
- Multi-encoding scan in tests: UTF-8/UTF-16LE/base64 fragments + non-ASCII sentinel

### C-02: Append-only contract — race condition on epoch-ms ordering
1. timestamp = Date.now() ms — same-ms tick has non-deterministic SQLite ordering; ORDER BY ASC can flip
2. Test asserts only manifest_signed_json column equality, not full row
3. Test should use `(timestamp, id)` ordering or fetch by primary key
4. JSON.stringify NOT canonical — within-session invariant only

**Fix:**
- ORDER BY timestamp ASC, id ASC (deterministic)
- SELECT * WHERE id = ? (full row equality)
- Plan 16-02 docstring: clarify within-session invariant

### C-03: c2pa-node ManifestDefinition shape mismatch
1. `vfx_familiar.redacted` NOT in closed ManifestAssertion union → tsc --noEmit FAILS at `as ManifestAssertion` cast
2. c2pa-rs renames `c2pa.actions` → `c2pa.actions.v2` on read; redaction integration helper has no normalization
3. extractAssertions cast unsafe — c2pa-rs read returns labels not in project's narrow union

**Fix:**
- Plan 16-02 must add VendorRedactedAssertion interface to ManifestAssertion discriminated union in src/engine/c2pa/manifest-builder.ts
- Plan 16-02 add normalization step: c2pa.actions.v2 → c2pa.actions
- Replace `as ManifestAssertion` cast with proper validation/filtering

### C-04: Per-version sign mutex — silent data corruption
1. Existing signMutex is COALESCING (returns same Promise), not serializing — redact's caller would get signOutput's wrong-shape result
2. Plan 16-02 acknowledges no timeout — DoS surface; agents can't recover from hang
3. Plan 16-02 NEVER WRITES redacted bytes to disk — disk file remains original signed bytes
4. Subsequent verify_manifest by versionId verifies STALE original bytes → silent crypto-correctness failure
5. Plan 16-05 Scenario B Test 5 MANUALLY writes redacted to disk in beforeAll — HIDES this bug

**Fix:**
- Plan 16-02: introduce SEPARATE mutex map for redaction (not signMutex), OR document that redact and sign are mutually exclusive on shared lock
- Plan 16-02: add 30s acquisition timeout → REDACT_TIMEOUT error code
- Plan 16-02: ATOMIC write redacted bytes (temp + rename) AS PART OF mutex-held flow
- Plan 16-05 Scenario B: REMOVE manual disk overwrite in beforeAll; rely on engine surface

### C-09: Plan 16-05 E2E — multiple holes
1. Scenario B Test 5 manually writes disk → hides C-04 bug
2. Single-encoding scan (same as C-01)
3. Doesn't assert c2pa.actions[.v2] survived after redact
4. Test 6 doesn't specify whether `signingCredential.untrusted` (bundled dev cert) maps to valid (filter) or untrusted_root

**Fix:**
- Remove manual disk overwrite; rely on engine
- Multi-encoding fragment scan
- Add c2pa.actions[.v2] survival assertion
- Plan 16-01 verifier.ts: explicit allowlist for `signingCredential.untrusted` matching c2pa-verification.test.ts:241-247 — surface as `valid` for dev cert; document trust-root logic

## CONCERNS

### C-05: Policy DSL — control chars/bidi/HTTP body limit
- Reject NUL bytes, Unicode bidi overrides (‪-‮ + ⁦-⁩), CR/LF, % < >
- Cap label-value at 256 chars
- Document Hono bodyLimit; cap MAX_VERIFY_BYTES_BASE64 reasonably (≤ 100MB)
- Add depth check in walkAndRedact (max depth 32 combined)

### C-06: Error-mapping inconsistency
- c2paConfig === null is "signing disabled" not "no manifest" → new code REDACT_SIGNING_DISABLED
- Plan 16-02 must catch C2PA_SIGNING_FAILED OR pass through; Plan 16-04 tool layer must map it
- DB insert atomicity: if appendManifestSignedRedactedEvent throws, do NOT return RedactionResult to caller
- Add REDACT_TIMEOUT for mutex acquisition (paired with C-04 fix)

### C-07: Dual-transport parity — error paths + SSE
- Add error-path parity test (INVALID_INPUT over BOTH transports → deepEqual envelopes)
- Plan 16-03: handle SSE response form OR document SSE disabled
- Add 5MB base64 round-trip parity test

### C-08: Envelope vs RedactionResult naming + tests
- Document `cert_subject_summary` (payload) vs `cert_subject` (envelope) drift
- Add wire-level byte-equal round-trip (redact → decode base64 → verify-by-bytes → asserts valid)
- Add 3-way equivalence test (input policy ↔ result.redactedFields ↔ vfx_familiar.redacted assertion)
- Multi-entry policy ordering test

### C-10: Cohort closure timing
- Plan 16-05 Task 4 needs explicit verifier-gate before doc updates
- VERIFICATION.md to be written before cohort closure
- Architecture-purity centralization edits must preserve SET-equality semantics (sorted-array deepEqual exact 4-element)
- Document rollback if mid-cohort failure

### C-11: Tool registration
- inputSchema is hand-coded; Zod discriminatedUnion limitation acknowledged but JSON-Schema generation produces anyOf without discriminator → less useful for MCP clients
- Add runtime tools/list test
- Track 7-action version tool as v1.2 deferred

## PASSED
- C-12: Plan dependency wave consistency (minor: Plan 16-04 depends_on should explicitly include "16-03" for clarity)

