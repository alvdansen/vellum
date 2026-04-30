# Phase 16 Deferred Items (v1.2 Candidates)

**Created:** 2026-04-30 (Phase 16 cohort closure)
**Status:** Tracked for v1.2 milestone planning

Phase 16 shipped the v1.1 agent surface (PROV-V-06 + PROV-V-07) but
surfaced three follow-up items that are out-of-scope for v1.1 and
tracked here for v1.2 prioritization.

## deferred-ingredient-mirror

**Source:** Plan 16-02 D-PLAN-2-3
**Description:** When `Engine.redactManifestForVersion` re-signs the
redacted manifest, it does NOT re-thread the parent's ingredient graph
(Phase 15's `manifest.ingredients[]`) through the new c2pa-node
`addIngredient` calls. Plan 16-02's redaction.ts builds a
`BuildManifestResult` with `ingredientSpecs: []` (empty — see
src/engine/c2pa/redaction.ts line ~699 in the integration helper).

**v1.1 observed behavior** (verified by Plan 16-05 E2E Test 9):
c2pa-rs's auto-promotion produces ONE ingredient — the
`parent_relationship` carrying the previous active manifest's bytes.
The full Phase-15 component graph (loaded checkpoints, controlnet
inputs, reference images, IP-Adapter inputs) is NOT mirrored to the
redacted manifest. Programmatic readers expecting
`active_manifest.ingredients[]` to surface the same component-level
data as the parent will see only the auto-promoted parent.

**Workarounds today:**
- Walk `store.manifests` (the JUMBF traversal API) to inspect the
  parent's ingredient graph — c2pa-rs preserves the parent manifest's
  embedded ingredients verbatim inside the JUMBF chain.
- For audit + compliance: the original signed manifest event row stays
  byte-identical in the `provenance` table (D-CTX-5 append-only); the
  full Phase-15 ingredient graph is recoverable from the original
  manifest_signed_json.

**v1.2 fix:** extend `redactManifestForVersionImpl` to read the parent's
`store.active_manifest.ingredients[]` from `c2pa.read({asset})`, project
each into an `IngredientSpec` (Phase 15's contract), and pass them
through `BuildManifestResult.ingredientSpecs` for re-threading. The
Phase 15 `signEmbedBufferWithIngredients` /
`signEmbedFileWithIngredients` already accept this shape — the
plumbing change is contained to redaction.ts's BuildManifestResult
construction.

**Impact (v1.1 callers):** Verifying the parent chain of components
requires `store.manifests` walk instead of `active_manifest.ingredients`
direct read. Documented in `src/__tests__/c2pa-redaction-e2e.test.ts`
Test 9.

## shared wire-UAT test util refactor

**Source:** Plan 16-05 D-PLAN-5-3
**Description:** Five test files now duplicate the same harness:
  - `src/__tests__/c2pa-uat-mcp-tool.test.ts` (Phase 14)
  - `src/__tests__/version-tool-dual-transport-export-verify.test.ts` (Plan 16-03)
  - `src/__tests__/version-tool-dual-transport-redact.test.ts` (Plan 16-04)
  - `src/__tests__/c2pa-redaction-uat-mcp-tool.test.ts` (Plan 16-05)
  - `src/__tests__/c2pa-redaction-e2e.test.ts` (Plan 16-05 — partial)

Each implements `seedSignedVersionInDb`, `connectMcpClient` /
`connectStdio` / `connectHttp`, `spawnHttpServer` / `httpCallTool`,
`readPayload`. The duplication is intentional for test isolation across
phases (a single shared helper file would couple all phase test suites
to a single harness revision and complicate hot-fixes), but v1.2 may
consolidate into `src/test-utils/wire-uat.ts` once the surface
stabilizes.

**v1.2 fix:** factor the harnesses into `src/test-utils/wire-uat.ts`
with each function exported. Tests opt into the shared harness OR
inline as needed. Maintain backward compatibility with Phase 14's
pattern.

**Impact (v1.1):** ~600 lines of duplication across 5 test files.
Acceptable for v1.1 ship.

## redaction-of-redaction (multi-step)

**Source:** CONTEXT.md "Deferred Multi-step redaction"
**Description:** Plan 16-02's `applyRedactionPolicy` helper supports
re-redacting an already-redacted manifest (Test 14 confirms — the
`vfx_familiar.redacted` assertion is APPENDED to the array, allowing a
multi-step audit trail at the helper boundary). The integration helper
`Engine.redactManifestForVersion` ALSO supports this implicitly because
it operates on the LATEST `manifest_signed` event each call (which is
the previous redaction's output for sequential calls). Plan 16-05 E2E
Test 10 verifies the multi-redact append-only contract: each redact
produces a sibling event row, originals + intermediate redactions all
byte-identical.

OBSERVED LIMITATION at the c2pa-rs read boundary: when c2pa.read
parses a manifest with multiple `vfx_familiar.redacted` assertions
(stacked from sequential redacts), only the FIRST assertion is
returned (assertion deduplication-by-label inside c2pa-rs). The full
audit trail is recoverable from the SQLite `provenance` table; the
embedded JSON view collapses to the first redaction's metadata.

The tool layer does NOT explicitly surface multi-step redaction.
A v1.1 caller who wants to redact additional fields after an initial
redaction must call `redact_manifest` again with the additional policy
paths, and the engine will redact-from-the-latest each time (NOT from
the original — this is consistent with CONTEXT.md "v1.1 redacts a
fresh-from-original manifest each time" once the LATEST event is the
original on first call, the LATEST is the previous redaction on second
call, etc.).

**v1.2 fix:** consider exposing a `redact_manifest` option that lets
the caller choose `from_latest` (default — current v1.1 behavior) or
`from_original` (always start from the un-redacted bytes). OR expose
a separate `redact_from_original` action for the alternate semantics.
Independently, investigate whether c2pa-rs assertion deduplication can
be configured (or worked around with hash-suffixed labels) so multiple
`vfx_familiar.redacted` assertions stack cleanly in the embedded
manifest view.

**Impact (v1.1):** Multi-step redaction works at the engine level but
the semantics are "redact-from-latest" implicitly. Documented in
`src/__tests__/c2pa-redaction-e2e.test.ts` Test 10.

---
*Captured: 2026-04-30 — Phase 16 cohort closure (Plan 16-05).*
