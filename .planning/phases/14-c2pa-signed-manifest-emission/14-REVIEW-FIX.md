---
phase: 14
fixed_at: 2026-04-30T07:14:00Z
review_path: .planning/phases/14-c2pa-signed-manifest-emission/14-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: applied
---

# Phase 14: Code Review Fix Report

**Fixed at:** 2026-04-30T07:14:00Z
**Source review:** .planning/phases/14-c2pa-signed-manifest-emission/14-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (3 MEDIUM)
- Fixed: 3
- Skipped: 0

Test counts after the cohort:
- Root: 1048 passing / 5 pre-existing failing / 3 skipped (was 1038/5/3 baseline; +10 new tests added by these fixes).
- Dashboard: 88 passing (unchanged baseline).

The 5 pre-existing failures live in `src/__tests__/phase-attribution.test.ts` and `src/__tests__/validation-flags.test.ts` (per `.planning/phases/10-migrate-on-boot-hardening/deferred-items.md`); none of the fixes touched those files.

## Fixed Issues

### MR-03: BUFFER_SIGNING_MAX_BYTES duplicated across pipeline.ts + output-downloader.ts

**Files modified:** `src/engine/c2pa/constants.ts` (new), `src/engine/c2pa/index.ts`, `src/engine/pipeline.ts`, `src/engine/output-downloader.ts`
**Commit:** ae2dea1
**Applied fix:** Created a new shared module `src/engine/c2pa/constants.ts` exporting the 500 MB buffer-signing cap. `pipeline.ts` now imports and re-exports it (preserving the existing public-symbol contract for callers that import it from `pipeline.js`); `output-downloader.ts` imports it directly. The legacy `DOWNLOADER_BUFFER_SIGNING_MAX_BYTES` local declaration and its "keep in sync" comment block are gone — the drift class is eliminated by construction.

The new file has zero MCP / HTTP / SQLite / drizzle imports, mirroring the rest of `src/engine/c2pa/`. Architecture-purity test directory-level guards already cover it (no new test required for the purity dimension; the import-level enforcement IS the test).

### MR-02: getLatestManifestSignedEvent unbounded full scan + JSON.parse per row

**Files modified:** `src/store/provenance-repo.ts`, `src/store/__tests__/provenance-repo-manifest-signed.test.ts`
**Commit:** a141d5a
**Applied fix:** Added `.limit(MANIFEST_SIGNED_LOOKUP_LIMIT)` (=50) to the `getLatestManifestSignedEvent` query. The newest-first `ORDER BY timestamp DESC` (backed by the existing `idx_provenance_version_time` (version_id, timestamp) index) means the matching filename is overwhelmingly within the first 1-2 rows; capping at 50 prevents the recovery-poller multi-attempt scenario from O(N) scanning across all signed/skipped events for a long-lived version. The constant is exported for tests.

No new index migration was required — the existing `idx_provenance_version_time` covers the WHERE + ORDER BY shape, and SQLite walks the index in reverse for the DESC order. A new migration would not have changed the query plan because the additional `event_type='manifest_signed'` filter is satisfied via the small per-version row scan after the index seek.

Two new tests added in `provenance-repo-manifest-signed.test.ts`:
- Test 10 (source-level guard): asserts `.limit(MANIFEST_SIGNED_LOOKUP_LIMIT)` literal is present and `orderBy(desc(provenance.timestamp))` still pairs with the LIMIT — a regression that drops either trips immediately.
- Test 11 (semantic guard): inserts a sequence of mixed-filename events and asserts the lookup still returns the LATEST matching `target.png` event after the LIMIT prunes oldest entries.

### MR-01: Default TSA URL is a third-party plaintext endpoint with no override

**Files modified:** `src/types/c2pa.ts`, `src/utils/c2pa-config.ts`, `src/engine/c2pa/signer.ts`, `src/engine/pipeline.ts`, `src/server.ts`, `src/__tests__/c2pa-config.test.ts`, `src/engine/c2pa/__tests__/signer.test.ts`, plus shape-update sweeps across `src/__tests__/c2pa-verification.test.ts`, `src/__tests__/c2pa-key-leak-negative.test.ts`, `src/__tests__/c2pa-dual-transport-parity.test.ts`, `src/__tests__/c2pa-uat-mcp-tool.test.ts`, `src/engine/__tests__/sign-output.test.ts`, `src/engine/__tests__/pipeline-c2pa-config.test.ts`
**Commit:** 5558570
**Applied fix:** Added `tsaUrl: string | null` to the `C2paConfig` type and threaded it through `loadC2paConfigFromEnv` (reading `VFX_FAMILIAR_C2PA_TSA_URL`) → Engine constructor → `Engine.getOrLoadSigner` → `loadSigner`. Empty/whitespace env values are normalized to null. The Engine call site at `pipeline.ts` now passes `c2paConfig.tsaUrl` verbatim — operators control the TSA endpoint without source-level changes.

The hard-coded `DEFAULT_TSA_URL` constant was renamed to `FALLBACK_TSA_URL` and demoted to a documented fallback used ONLY when `loadSigner` is called without a third argument (back-compat for non-engine callers). The boot log surfaces the TSA URL choice (or "unset" hint) so operators see the breadcrumb.

**Reviewer-recommended trade-off (REVIEW.md MR-01 OR clause):** the c2pa-node v0.5.26 native binding has a real bug — `signClaimBytes` throws "TypeError: failed to downcast any to string" when the LocalSigner literal omits `tsaUrl` entirely. Test 12/13 in `signer.test.ts` (real PNG sign + read round-trip) confirmed this empirically. The reviewer's preferred path ("default to null where the c2pa-node bug allows") was therefore not fully reachable without breaking real signing. Per REVIEW.md's explicit OR clause — "OR keep DigiCert as a documented fallback only when null would crash" — `FALLBACK_TSA_URL` retains the public DigiCert default for the no-third-arg call path. Engine call sites pass null when env var unset; the binding bug then surfaces gracefully via `status_reason='sign_call_failed'` (D-CTX-9 graceful-fail) and an actionable boot-log hint pointing operators to set the env var.

This commit therefore satisfies the OPERATOR-CONTROLLABLE goal of the finding (no source changes required to override or disable TSA, and the choice is logged at boot) while honestly surfacing the c2pa-node v0.5.26 binding limitation. A future c2pa-node v0.5.27+ that fixes the binding would let us flip the default to null without code changes.

8 new tests added across the cohort:
- 4 in `c2pa-config.test.ts` (Tests 12-15): env var unset → tsaUrl null; env var set → flows through verbatim; empty/whitespace env values → treated as unset.
- 4 in `signer.test.ts` (Tests 21-24): default-arg loadSigner uses FALLBACK_TSA_URL; explicit null OMITS the property in the LocalSigner literal (via vi.doMock spy); explicit URL passes through verbatim; source-level guard ensures the legacy `DEFAULT_TSA_URL` constant name is gone and the engine call site references `c2paConfig.tsaUrl`.

The 6 existing `REAL_C2PA_CONFIG` literals across test files were updated to declare `tsaUrl: 'http://timestamp.digicert.com'` explicitly (the same URL c2pa-node's own `createTestSigner` uses). This is a TEST-ONLY fixture pin, not the production default — matched the pre-MR-01 behavior of those tests so the real-signing round-trips stay green while the production code path is now operator-controllable.

---

_Fixed: 2026-04-30T07:14:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
