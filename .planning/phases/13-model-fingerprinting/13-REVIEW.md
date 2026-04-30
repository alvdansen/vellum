---
phase: 13-model-fingerprinting
reviewed: 2026-04-30T03:38:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/types/provenance.ts
  - src/engine/model-fingerprint.ts
  - src/engine/provenance.ts
  - src/engine/diff.ts
  - src/engine/pipeline.ts
  - src/engine/generation.ts
  - src/store/provenance-repo.ts
  - src/server.ts
  - src/__tests__/architecture-purity.test.ts
  - src/engine/__tests__/model-fingerprint.test.ts
  - src/engine/__tests__/model-fingerprint-integration.test.ts
  - src/engine/__tests__/diff.test.ts
  - src/store/__tests__/provenance-repo.test.ts
  - src/engine/__tests__/pipeline-fingerprint.test.ts
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: clean
---

# Phase 13: Code Review Report — Model Fingerprinting (PROV-V-03)

**Reviewed:** 2026-04-30T03:38:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** clean

## Summary

Phase 13 implements streaming SHA-256 fingerprinting of ComfyUI loader-resolved model files, persisted as an append-only sibling provenance event. Quality is consistently high across all three plans (13-01, 13-02, 13-03):

- **Streaming hash** mirrors Phase 12's `output-hash.ts` verbatim: `createReadStream` + `createHash('sha256').update(chunk)` keeps memory constant regardless of file size — verified safe for multi-GB checkpoints.
- **Path-traversal guard** is correctly placed BEFORE any disk I/O; rejects empty/`..`/`/`/`\\`/NUL on `modelName`, then uses `path.basename` as defense-in-depth. Verified by an explicit test that writes a sibling-secret file and confirms it is NOT read.
- **Retry policy** is hard-capped at 3 attempts (2 sleeps × 1s, 2s) with ENOENT short-circuit. No infinite-loop risk. Stream/file-descriptor lifecycle is clean — each retry constructs a fresh `createReadStream`.
- **Idempotency** uses a check-then-append pattern. The "concurrent re-entry" race is theoretically possible but unreachable through any actual call path: the hook fires once per version per process from `downloadAndPersist`, and the boot recovery sweep iterates each version exactly once.
- **Hot-path isolation** is correct by construction: the hook receiver wraps the async work in `void X.catch(...)`, so the awaited completion call returns synchronously. Test 4 in `pipeline-fingerprint.test.ts` asserts the fingerprinted event has not yet appeared at the moment `await getGenerationStatus` resolves — proves the gap.
- **Append-only invariant** preserved: `appendModelsFingerprintedEvent` delegates to `insertEvent`; no UPDATE/DELETE in `provenance-repo.ts`. Architecture-purity grep confirms zero `db.update` / `db.delete` matches. Dedicated test asserts the original `completed` row stays byte-identical after the sibling event lands.
- **diffModels** correctly compares all three fields (model_name, model_hash, model_hash_unavailable). Five transition tests (hash↔unavailable, code↔code, identical-null, identical-populated) cover the lattice.
- **Security:** no info-disclosure surfaces — error log line on retry exhaustion is operator-only console.error (T-13-05 disposition: accept). `VFX_FAMILIAR_MODELS_DIR` is read exactly once in `src/server.ts` and threaded explicitly through the Engine constructor; engine layer never touches `process.env`.
- **Architecture purity:** `src/engine/model-fingerprint.ts` imports only Node builtins + `./provenance.js`. Three new file-level assertions in `architecture-purity.test.ts` lock this in (zero MCP / better-sqlite3 / drizzle-orm).
- **Tool budget unchanged:** no `src/tools/` files modified; no new MCP tools introduced.

All 105 phase-13-relevant tests pass. TypeScript compiles cleanly under `--noEmit`. The append-only structural-invariant test in `provenance-repo.test.ts` continues to pass (the new public methods are inserts, not mutations).

The three INFO items below are quality observations, not defects — implementation matches the plan exactly and meets all five ROADMAP success criteria.

## Info

### IN-01: Idempotency check is non-atomic (race-window theoretical, not exploitable)

**File:** `src/engine/pipeline.ts:711-715`
**Issue:** The idempotency guard reads `getEventsForVersion` and writes via `appendModelsFingerprintedEvent` in two separate steps. If two callers invoked `fingerprintModelsForVersion(sameVersionId)` in parallel, both could observe `alreadyFingerprinted === false` and both could append a sibling event — yielding two `models_fingerprinted` rows for the same version.

In the current code there is no path that triggers concurrent invocation for a single versionId:
- `downloadAndPersist` calls the hook exactly once per completion (single-flight by definition).
- The boot recovery sweep (`engine.start()`) iterates each pending version once via `drivePoller`.
- Tests (`pipeline-fingerprint.test.ts` Test 3) use sequential `await` calls, so the race is not exercised.

The race is therefore latent rather than active. Phase 14 (C2PA manifest emission) may introduce on-demand re-fingerprint paths; if so, a SQLite-level UNIQUE constraint on `(version_id, event_type='models_fingerprinted')` or a transactional "INSERT ... WHERE NOT EXISTS" would close the gap.

**Fix:** No action required for v1.1. Document the assumption in the JSDoc on `fingerprintModelsForVersion` ("idempotent under serial calls — concurrent invocation for the same version is not a supported call pattern") so a future refactor knows the boundary. Optional defensive measure if Phase 14 needs concurrent triggers:

```typescript
// Optional: re-check after the hash work, before the append, to narrow the
// race window. Two concurrent callers would still both append, but the
// recovery path wouldn't worsen the situation.
const fingerprinted = await Promise.all(/* ... */);
const eventsAfterHash = this.provenanceRepo.getEventsForVersion(versionId);
if (eventsAfterHash.some((e) => e.event_type === 'models_fingerprinted')) return;
this.provenanceRepo.appendModelsFingerprintedEvent(versionId, fingerprinted);
```

### IN-02: Retry log captures only the LAST error code, not the dominant one

**File:** `src/engine/model-fingerprint.ts:127-129`
**Issue:** The `lastErrCode` variable is overwritten on every retry, so the operator-visible "fingerprint unreadable after 3 attempts" log line shows the code from attempt 3 only. If attempts 1–2 saw `EACCES` and attempt 3 saw `EBUSY`, the log reports `EBUSY` and obscures the dominant failure.

In practice, persistent permission/lock errors usually return the same code on every attempt, so this rarely matters. But for diagnosing flapping I/O, a multi-code summary would be more useful.

**Fix:** Optional — collect codes in an array and log the set:

```typescript
const seenCodes: string[] = [];
// inside catch:
if (code) seenCodes.push(code);
// at exhaustion:
console.error(
  `vfx-familiar: model fingerprint unreadable after ${FINGERPRINT_MAX_ATTEMPTS} attempts: ${fullPath} (codes: ${[...new Set(seenCodes)].join(',') || 'UNKNOWN'})`,
);
```

Defer until operational telemetry surfaces the need.

### IN-03: `fingerprintModelsForVersion` duplicates ModelRef field mapping in both narrowing branches

**File:** `src/engine/pipeline.ts:737-752`
**Issue:** The discriminated-union narrowing produces two near-identical object literals — both copy `node_id`, `class_type`, `model_name` verbatim, differing only in which of the two hash fields gets the value. Could be DRYer:

```typescript
const base = {
  node_id: m.node_id,
  class_type: m.class_type,
  model_name: m.model_name,
};
return 'model_hash' in result
  ? { ...base, model_hash: result.model_hash, model_hash_unavailable: null }
  : { ...base, model_hash: null, model_hash_unavailable: result.model_hash_unavailable };
```

The current shape is more verbose but explicit, and TypeScript's `'model_hash' in result` narrowing works correctly with both forms. Style only — no behavioral concern.

**Fix:** Optional. Current code is acceptable; a future refactor can DRY this up if a third field ever joins the union.

---

_Reviewed: 2026-04-30T03:38:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
