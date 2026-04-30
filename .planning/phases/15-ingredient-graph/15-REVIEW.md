---
phase: 15-ingredient-graph
reviewed: 2026-04-30T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/engine/provenance.ts
  - src/engine/c2pa/ingredient-extractor.ts
  - src/engine/c2pa/ingredient-hasher.ts
  - src/engine/c2pa/manifest-builder.ts
  - src/engine/c2pa/signer.ts
  - src/engine/c2pa/index.ts
  - src/engine/pipeline.ts
  - src/types/provenance.ts
  - src/store/provenance-repo.ts
  - src/engine/c2pa/__tests__/ingredient-extractor.test.ts
  - src/engine/c2pa/__tests__/ingredient-hasher.test.ts
  - src/engine/c2pa/__tests__/signer-with-ingredients.test.ts
  - src/engine/__tests__/pipeline-c2pa-ingredients.test.ts
  - src/__tests__/c2pa-ingredient-graph-e2e.test.ts
  - src/__tests__/c2pa-ingredient-dangling.test.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: findings_found
---

# Phase 15: Code Review Report

**Reviewed:** 2026-04-30T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** findings_found

## Summary

Phase 15 promotes the C2PA manifest from Phase 14's "AI-origin disclosure + primary model" to a full ingredient graph carrying `parentOf` (lineage), `componentOf` (control / mask / VAEEncode source images), and `inputTo` (vendor `vfx_familiar.input` carrying structured prompt + sampler payload). The architecture is sound and the post-revision design is correct — ingredients flow via c2pa-node's `manifestBuilder.addIngredient` API (surfacing on `manifest.ingredients[]`), NOT through the assertions[] array, which would have made them invisible to third-party verifiers. Dangling references are recorded via the vendor-namespaced `vfx_familiar.unavailable_ingredient` custom assertion (architectural workaround for c2pa-node's createIngredient requiring asset bytes).

**Strengths:**

- KSampler positive/negative edge walk in `extractInputAssertion` is correctly implemented (not first/second-positional heuristic) — IA-3 test locks the contract by adding an unreferenced CLIPTextEncode and asserting it is ignored.
- Multi-KSampler workflows are handled via the lowest-node_id-with-resolvable-edges deterministic pick (IA-6).
- VAEEncode/VAEEncodeForInpaint edge-tuple resolution is correct: walks `pixels` → upstream LoadImage* one hop. Procedural `EmptyLatentImage` upstreams are silently skipped (CI-4b).
- Path-traversal guard in `hashComponentBytes` mirrors `output-hash.ts` exactly: rejects `..` / `/` / `\\` / NUL / empty before any filesystem call. T-15-04 honoured: return shape only carries hex digest OR a typed reason (no resolved path).
- `c2pa-node` centralization: only `src/engine/c2pa/signer.ts` imports the native binding. Both `ingredient-extractor.ts` and `ingredient-hasher.ts` are pure — locked by file-level grep gates in `architecture-purity.test.ts`.
- Append-only invariant preserved: `provenance-repo.ts` has zero `db.update` / `db.delete` (regression-locked).
- T-15-01 mitigation honoured: `extractInputAssertion` returns a structured bounded shape (4096-char cap with explicit truncation marker), never workflow_json verbatim. IA-1 explicitly asserts the absence of a `workflow_json` key.
- Backward-compat preserved: `buildManifestDefinition` (Phase 14 entry point) is byte-unchanged. `buildManifestWithIngredients` is additive.
- E2E test (`c2pa-ingredient-graph-e2e.test.ts`) reads `manifest.ingredients[]` (NOT `assertions[]`) — the correct c2pa-node v0.5.x surface. Test 9 sweeps for any `c2pa.ingredient`-prefixed label in `assertions[]` and asserts none exist.
- Dangling-reference test (`c2pa-ingredient-dangling.test.ts`) reads `vfx_familiar.unavailable_ingredient` from `assertions[]` (Test 1) AND asserts `manifest.ingredients[]` does NOT contain a componentOf for the missing file (Test 2) — locks both halves of the architectural constraint.
- Per-version sign mutex (B4) implemented with try/finally cleanup — entry deleted on both success and failure paths.

**Concerns** (2 warnings + 3 info — none block phase closure):

The two warnings are around the per-version sign mutex semantics (mismatched filenames coalesce silently) and a parent-asset MIME-type fallback that may emit a c2pa-rs-rejecting `application/octet-stream`. Both are bounded by current operational reality (recovery-poller + downloader call sites use a single filename per version; route-format covers all production formats), but the contracts are not as defensive as the surrounding code.

## Warnings

### WR-01: Per-version sign mutex coalesces across DIFFERENT filenames

**File:** `src/engine/pipeline.ts:982-993`
**Issue:** The mutex is keyed on `versionId` only (line 982: `this.signMutex.get(versionId)`). When a concurrent call enters with `signOutput(v, "a.png", ...)` and a second concurrent call enters with `signOutput(v, "b.png", ...)`, the second call returns the result of the FIRST (line 984: `return await inflight`). The plan docstring at line 978-981 acknowledges this ("we'd rather serialise them than race") but the actual implementation does not serialise — it COALESCES. If `a.png` succeeded with `signed: Buffer`, the caller asking for `b.png` receives the bytes for `a.png` along with `b.png`'s expectation, with no manifest_signed event recorded for `b.png`. The test suite (M1 / M2 / M3) does not exercise the cross-filename concurrent case — only same-filename concurrency (M1) and same-filename sequential (M3).

In current operational reality this is bounded: production call sites (`output-downloader.signFileInPlace` and the recovery poller) submit a single filename per version. But future call sites (e.g., a Phase 16 `version.export_manifest` re-derive feature explicitly listed in REQUIREMENTS.md v1.2 deferred) could legitimately want cross-filename concurrent signs.

**Fix:** Either (a) key the mutex on `${versionId}::${filename}` to allow per-filename concurrency (cheap and correct), OR (b) if the "lock at versionId level" semantics is intentional for serialising same-version operations, change the implementation to QUEUE rather than COALESCE — wait for the inflight promise to settle, then run the second filename's `_signOutputInner` (with its own promise registered in the map). The current "return inflight" branch only makes sense when both calls are for the same filename. Suggested patch:

```typescript
// Option (a) — finer-grained key (preserves current parallelism semantics for distinct filenames):
const mutexKey = `${versionId}::${filename}`;
const inflight = this.signMutex.get(mutexKey);
if (inflight !== undefined) {
  return await inflight;
}
const promise = this._signOutputInner(versionId, filename, input);
this.signMutex.set(mutexKey, promise);
try {
  return await promise;
} finally {
  this.signMutex.delete(mutexKey);
}

// Option (b) — keep versionId-level lock but QUEUE rather than COALESCE:
const inflight = this.signMutex.get(versionId);
if (inflight !== undefined) {
  await inflight.catch(() => undefined); // wait for first to settle, ignore its result
}
const promise = this._signOutputInner(versionId, filename, input);
this.signMutex.set(versionId, promise);
try {
  return await promise;
} finally {
  this.signMutex.delete(versionId);
}
```

Add a regression test M4 covering the cross-filename concurrent case before shipping a fix to lock the corrected semantics.

### WR-02: Parent and component MIME-type fallback to `application/octet-stream` will fail c2pa-rs ingredient extraction

**File:** `src/engine/pipeline.ts:1402, 1439`
**Issue:** When the parent's filename has an extension that `routeFormat` does not classify (e.g., a future format that has not been added to the format-router's tables), the asset ref is built with `parentMime = parentRoute.mimeType ?? 'application/octet-stream'` (line 1402). Same fallback on line 1439 for component MIME. This MIME type is then passed into `c2pa-node`'s `createIngredient({ asset: { path, mimeType: 'application/octet-stream' } })`. c2pa-rs dispatches asset handlers by MIME type and will reject `application/octet-stream` with a parse error inside `addIngredientsToBuilder`, which propagates as `C2PA_SIGNING_FAILED` and lands the version with `status_reason='sign_call_failed'` instead of cleanly recording the ingredient as unavailable. The defensive intent (sign anyway) is undermined by an avoidable failure.

The current production format set (PNG/JPEG/MP4/WebP/TIFF) is fully covered by `routeFormat`, so this is latent. But adding a new format to `EMBED_FILE_FORMATS` requires updating `format-router.ts` AND remembering to NOT pass octet-stream — a coupling that isn't surfaced anywhere.

**Fix:** When `routeFormat(filename).mimeType` is null, mark the asset ref as unavailable with reason `file_unreadable` (or a new `format_unsupported` reason added to the union) instead of assigning octet-stream. The vendor unavailable assertion will then carry a clean audit trail and the sign will proceed without the c2pa-rs rejection.

```typescript
// Parent (line ~1401):
const parentRoute = routeFormat(parentFilename);
if (parentRoute.mimeType === null) {
  ingredientAssetRefs.set('parent', { kind: 'unavailable', reason: 'file_unreadable' });
} else {
  const parentPath = nodepath.join(this.outputRoot, parentOf.parent_version_id, parentFilename);
  try {
    await stat(parentPath);
    ingredientAssetRefs.set('parent', { kind: 'file', path: parentPath, mimeType: parentRoute.mimeType });
  } catch (err) {
    // existing ENOENT / other handling
  }
}

// Component (line ~1438): same pattern.
```

## Info

### IN-01: `_signOutputInner` filename-pinned `prior` lookup vs. coalesced mutex semantics

**File:** `src/engine/pipeline.ts:1008`
**Issue:** Inside `_signOutputInner` the filename-keyed idempotency check (`getLatestManifestSignedEvent(versionId, filename)`) runs only for the FIRST caller because of the version-keyed mutex (see WR-01). A second concurrent caller for a different filename never reaches the inner check. This is a downstream symptom of WR-01 — fixing WR-01 (Option a) resolves it. Filing as Info to ensure the fix is applied at the entry point, not bandaged inside `_signOutputInner`.
**Fix:** Resolve via WR-01 fix.

### IN-02: `addIngredientsToBuilder` runtime-deviation comment is correct, but unused parameter `_c2paNode` is misleading

**File:** `src/engine/c2pa/signer.ts:541-569`
**Issue:** The signature carries `_c2paNode: typeof import('c2pa-node')` (line 543) but the body never reads it (the relationship value is assigned via the literal-string cast on line 565-567 because `c2paNode.Relationship` is undefined at runtime). The function header comment block (lines 527-541) accurately documents WHY — the binding declares an enum in `types.d.ts` but ships no runtime export. The leading underscore is the agreed-upon "deliberately unused" convention. This is fine for maintenance but adds two parameters to the signature unnecessarily — `_signer` is also unused (line 544). A future maintainer reading the signature without the doc-block may try to remove the unused params.
**Fix:** Add a brief code-level comment IMMEDIATELY above the signature (not in the deviation block) noting that `_c2paNode` and `_signer` are reserved for the future-version replacement. Or remove both params and inline the helper into `signEmbedBufferWithIngredients` / `signEmbedFileWithIngredients`. The current state is functionally correct.

### IN-03: Test M3 cannot directly assert mutex map cleanup

**File:** `src/engine/__tests__/pipeline-c2pa-ingredients.test.ts:236-246`
**Issue:** Test M3 comment at line 244-245 reads "Mutex is in-process state — no observable property to assert directly, but the fact that we got here without timeout proves no entry leaked." This is a weak guarantee: a leaked entry would only manifest as a hang/deadlock if a second concurrent call came in for the same versionId after the first settled. Test M3's second call uses the alreadySigned shortcut which short-circuits before the mutex check (line 1009-1011), so the mutex code path on the second call is never exercised at all in this test. A more robust test would: (a) sign a version, (b) append a manual `signed:false` event so the alreadySigned shortcut doesn't fire, (c) sign again concurrently with a third call — assert both promises settle (which proves the prior leaked promise didn't block them).
**Fix:** Add an M4 test exercising the post-cleanup mutex behavior explicitly, OR expose `signMutex.size` via a test-only accessor (mirror `__resetC2paNodeStateForTests` pattern from `signer.ts:94`) so M3 can assert `expect(engine.__signMutexSizeForTests()).toBe(0)` after the awaited call.

---

_Reviewed: 2026-04-30T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
