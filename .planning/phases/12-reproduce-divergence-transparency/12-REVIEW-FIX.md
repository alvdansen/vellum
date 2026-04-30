---
phase: 12-reproduce-divergence-transparency
fixed_at: 2026-04-30T02:38:00Z
review_path: .planning/phases/12-reproduce-divergence-transparency/12-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: applied
test_baseline_before: 817 root passing / 5 pre-existing failing / 3 skipped + 58 dashboard passing
test_baseline_after: 824 root passing / 5 pre-existing failing / 3 skipped + 58 dashboard passing
test_delta: +7 root tests (6 WR-02 path-traversal + 1 WR-01 EISDIR), 0 regressions
---

# Phase 12: Code Review Fix Report

**Fixed at:** 2026-04-30T02:38:00Z
**Source review:** `.planning/phases/12-reproduce-divergence-transparency/12-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (WR-01 + WR-02; LOW/INFO out of scope for `critical_warning` mode)
- Fixed: 2
- Skipped: 0
- Test baseline (before): 817 root passing / 5 pre-existing failing / 3 skipped (+ 58 dashboard passing)
- Test baseline (after): 824 root passing / 5 pre-existing failing / 3 skipped (+ 58 dashboard passing)
- Delta: +7 net new tests (6 WR-02 path-traversal regression + 1 WR-01 EISDIR regression). No regressions.

## Fixed Issues

### WR-01: Unhandled hash-throw breaks `version.diff` for non-ENOENT I/O errors

**Files modified:**
- `src/engine/pipeline.ts` (lines 520-568 — added `safeHash` inner helper to `Engine.computeReproductionDivergence`)
- `src/engine/__tests__/pipeline.test.ts` (added 1 EISDIR regression test in the divergence describe block)

**Commit:** `e06893a`

**Applied fix:** Wrapped both `computeOutputSha256` calls inside `Engine.computeReproductionDivergence` in a local `safeHash` helper that catches non-ENOENT I/O failures (EACCES/EISDIR/EBUSY/EMFILE/...), logs them via `console.error` for operator visibility, and returns `null`. This keeps the diff envelope intact: `*_output_present=false`, `sha256_mismatch=null`, but `warnings` still surface — preserving the honesty-contract guarantee that partner-API non-determinism warnings remain visible to the user even when disk state is broken.

**Regression test:** Added `WR-01: EISDIR on reproduction output returns divergence with warnings preserved (no throw)` in `pipeline.test.ts`. The test:
1. Seeds a reproduce-lineage pair with bytes-matching parent/reproduction + a persisted partner-API warning.
2. Replaces the reproduction's on-disk output FILE with a DIRECTORY at the same path. `stat()` succeeds (so the existing ENOENT short-circuit does NOT fire), but `createReadStream` rejects with EISDIR — the exact non-ENOENT case the helper re-throws.
3. Asserts `engine.diffVersions(parentId, reproductionId)` resolves successfully (does not reject), the divergence object surfaces with the warnings array intact, `reproduction_output_present=false`, `parent_output_present=true`, `sha256_mismatch=null`.
4. Asserts `console.error` was invoked with a message containing `output-hash unreadable` and the reproduction's versionId — operator visibility guarantee.

**Note on test instrumentation:** The first attempt used `vi.spyOn(console, 'error')`; spy did not register the call (likely a vi/global-console identity quirk). Switched to a direct global-swap pattern (`origErr = console.error; console.error = capture; ... console.error = origErr`) which captures the call reliably. The replacement runs only inside the test scope and is restored in a `try/finally`.

### WR-02: `computeOutputSha256` lacks defense-in-depth path-traversal guard

**Files modified:**
- `src/engine/output-hash.ts` (lines 38-58 — added pre-resolution guard before `path.join`)
- `src/engine/__tests__/output-hash.test.ts` (added 6 regression tests in a new `WR-02 defense-in-depth path-traversal guard` describe block)

**Commit:** `f5476fe`

**Applied fix (Option A from REVIEW.md):** Mirrored the basename + separator check from `src/http/dashboard-routes.ts:222-236` directly inside `computeOutputSha256`, applied as the FIRST step before any path resolution. Returns `null` (no throw) on any of: empty filename, contains `..`, contains `/`, contains `\`, contains NUL (`\0`). After the guard passes, normalizes via `path.basename` then `path.join`.

Treats path traversal as semantically equivalent to "no comparable bytes" — the same downstream UX as a missing file. Preserves the helper's contract that it never throws on missing-file cases. Engine-side single trust boundary, per the REVIEW recommendation.

**Regression tests:** Added 6 tests covering:
1. `..` parent-traversal in 4 forms (`..`, `../etc/passwd`, `../../etc/passwd`, `foo..bar.png`).
2. `/` forward slash (e.g., `a/b.png`, `/etc/passwd`).
3. `\` backslash (e.g., `a\\b.png`, `..\\..\\etc\\passwd`).
4. NUL byte (`safe.png\0.evil`).
5. Empty filename (`''`).
6. **Critical attack-prevention test:** writes a sibling-secret file at `<outputsDir>/../sibling-secret.txt` (a real existing file outside `versionId`). Calls `computeOutputSha256(outputsDir, 'ver_a', '../sibling-secret.txt')`. Without the guard, `path.join` would resolve to the secret file and hash its bytes. WITH the guard, the call returns `null` and never reads the secret.

All 6 tests pass — confirms the guard rejects every separator variant before path resolution.

## Skipped Issues

None.

## Constraint Compliance

- **Test baseline:** 817 root passing / 5 pre-existing failing / 3 skipped → 824 root passing / 5 pre-existing failing / 3 skipped. PASS — pre-existing failures stayed at 5; net +7 new passing tests; 0 regressions.
- **Dashboard baseline:** 58 passing → 58 passing. PASS — Phase 12 fixes are server-only.
- **Architecture-purity:** `npx vitest run src/__tests__/architecture-purity.test.ts` → 18/18 passing. PASS — `src/engine/output-hash.ts` remains zero-MCP-imports, zero-drizzle, zero-sqlite.
- **Append-only provenance:** No UPDATEs introduced. PASS — both fixes are read-path / hash-path; `provenance` table untouched.
- **TypeScript:** `npx tsc --noEmit` exits 0. PASS.
- **Streaming SHA-256 pattern:** `crypto.createHash('sha256')` + `createReadStream` unchanged. PASS — fix only adds a pre-resolution guard ahead of the existing pattern.
- **Atomic commits:** Two commits, one per finding, conventional-commits format `fix(12): ...`. PASS.

## Verification Commands Run

```bash
# WR-02 grep success criterion
grep -E "filename\.includes\('\\.\\.'\)|filename\.includes\('/'\)" src/engine/output-hash.ts
#   filename.includes('..') ||
#   filename.includes('/') ||

# WR-01 grep success criterion
grep -B2 "computeOutputSha256" src/engine/pipeline.ts | grep -E "try|safeHash|catch"
#   try {

# TypeScript
npx tsc --noEmit  # exits 0

# Targeted tests
npx vitest run src/engine/__tests__/output-hash.test.ts
#   11 passed (was 5 — +6 new WR-02 tests)
npx vitest run src/engine/__tests__/pipeline.test.ts
#   23 passed (was 22 — +1 new WR-01 EISDIR test)
npx vitest run src/__tests__/architecture-purity.test.ts
#   18 passed (unchanged)

# Full suite
npx vitest run
#   824 passed | 5 pre-existing failed | 3 skipped (was 817 / 5 / 3)
cd packages/dashboard && npx vitest run
#   58 passed (unchanged)
```

## Commits

| Commit | Finding | Files |
|--------|---------|-------|
| `f5476fe` | WR-02 path-traversal guard | `src/engine/output-hash.ts`, `src/engine/__tests__/output-hash.test.ts` |
| `e06893a` | WR-01 graceful degradation | `src/engine/pipeline.ts`, `src/engine/__tests__/pipeline.test.ts` |

---

_Fixed: 2026-04-30T02:38:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
