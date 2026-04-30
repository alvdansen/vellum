---
phase: 13-model-fingerprinting
plan: 01
subsystem: provenance

tags: [sha256, model-fingerprint, streaming-hash, path-traversal, retry, provenance, c2pa-prep, prov-v-03]

# Dependency graph
requires:
  - phase: 12-reproduce-divergence-transparency
    plan: 01
    provides: "Phase 12 src/engine/output-hash.ts streaming SHA-256 + WR-02 path-traversal guard pattern — directly mirrored by src/engine/model-fingerprint.ts (createReadStream + createHash + basename guard)."
  - phase: 03-provenance-versioning
    provides: "ModelRef interface (D-PROV-06), LOADER_CLASS_TYPES set, MODEL_FIELD_BY_CLASS map, extractModels pure helper, ProvenanceWriter — all preserved byte-identical except the additive ModelRef field and the additive emit-both-null-fields update."
provides:
  - "ModelRef.model_hash_unavailable: string | null (D-CTX-1) — additive field on the existing ModelRef interface so persisted models_json can carry typed unavailable reasons (D-CTX-5) instead of silently nulling. Pure extraction emits both fields null on the pure path; Phase 13-02 fingerprinter populates exactly one after async I/O."
  - "MODEL_DIR_BY_CLASS: Record<string, string> in src/engine/provenance.ts (D-CTX-2) — 9-entry map mirroring LOADER_CLASS_TYPES. Class-type → models-subdir resolution (checkpoints / loras / vae / unet / clip / controlnet / style_models). Lockstep invariant locked by a passing test."
  - "fingerprintModel(modelsDir, classType, modelName) async helper in src/engine/model-fingerprint.ts — streaming SHA-256 with createReadStream + createHash, returns the discriminated union { model_hash } | { model_hash_unavailable }. Path-traversal guard mirrors output-hash.ts WR-02 (empty / `..` / `/` / `\\` / NUL → 'file_not_found' with no disk read). Retry policy: 3 attempts, 1s/2s sleeps between for non-ENOENT I/O errors; ENOENT goes straight to 'file_not_found'."
  - "FingerprintResult type — discriminated-union public API of model-fingerprint.ts (one of two fields is set, never both). Caller code TypeScript-narrows on the discriminator."
  - "Engine-purity invariant preserved: src/engine/model-fingerprint.ts imports only node:crypto, node:fs, node:fs/promises, node:path, and ./provenance.js (MODEL_DIR_BY_CLASS) — zero MCP / SQLite-driver / ORM imports. Architecture-purity grep gates clean."
affects: [13-02 (wires fingerprintModel into the completion path + sibling models_fingerprinted provenance event), 13-03 (diff-side parity + integration tests + file-level architecture-purity assertion), 14-c2pa-manifest (fingerprints flow into the manifest as a baseline)]

# Tech tracking
tech-stack:
  added: []  # Pure node builtins; no new dependencies
  patterns:
    - "Streaming SHA-256 reuse pattern — fingerprintModel inherits the createReadStream + createHash + digest('hex') structure from src/engine/output-hash.ts verbatim. New large-file hashes added in subsequent phases should follow this pattern (constant-memory regardless of file size)."
    - "Path-traversal defense-in-depth at engine helper boundaries — same five-check guard (length 0 / '..' / '/' / '\\\\' / NUL) used in output-hash.ts is the canonical engine-level rejection pattern for any path-resolving helper. Tampered names degrade to a typed unavailable reason rather than throwing or reading outside the configured root."
    - "Discriminated-union return type for fallible content-addressing — { model_hash } | { model_hash_unavailable }. Caller TypeScript-narrows on the discriminator, so persisted models_json and downstream consumers (Phase 13-02 sibling event, Phase 14 C2PA ingredient graph) can branch without nullable nested checks."
    - "Inter-attempt sleep schedule constant (FINGERPRINT_BETWEEN_ATTEMPT_DELAYS = [1000, 2000]) mirrors src/engine/generation.ts:34-35 DOWNLOAD_BETWEEN_ATTEMPT_DELAYS — delays BETWEEN attempts, not per-attempt; sleep BEFORE next attempt only if there is a next attempt. Engine-wide retry pattern."
    - "Lockstep map test pattern: a Record<string, T> declared in lockstep with a ReadonlySet<string> gets a coverage test in __tests__ that asserts Object.keys(map).sort() === [...set].sort(). Locks the invariant before a future engineer adds to one but not the other."

key-files:
  created:
    - src/engine/model-fingerprint.ts
    - src/engine/__tests__/model-fingerprint.test.ts
  modified:
    - src/types/provenance.ts
    - src/engine/provenance.ts
    - src/engine/__tests__/model-extraction.test.ts
    - src/engine/__tests__/diff.test.ts

key-decisions:
  - "ModelRef extension is additive (model_hash_unavailable: string | null required-but-nullable). Existing inline ModelRef literals in tests must opt in to the new field or fail to type-check. Two such fixtures in src/engine/__tests__/diff.test.ts updated in this plan; production code paths (extractModels) set both fields null on the pure path."
  - "Path-traversal in modelName degrades to 'file_not_found' rather than a new traversal-specific reason code — keeps D-CTX-5 within its locked four codes (models_dir_not_configured, file_not_found, file_unreadable, unsupported_class_type) and keeps the downstream UX equivalent to a real ENOENT."
  - "ENOENT is NOT retried (immediate 'file_not_found'); only non-ENOENT I/O errors (EACCES, EBUSY, EISDIR, EMFILE) trigger the 3-attempt retry. ENOENT means the file genuinely is not there — retry would burn 3 seconds for no possible recovery."
  - "Inter-attempt sleep schedule is [1000, 2000] (two sleeps = three attempts) matching the src/engine/generation.ts:34-35 DOWNLOAD_BETWEEN_ATTEMPT_DELAYS pattern. Sleep BETWEEN attempts only — no sleep after the final failure (test asserts ENOENT path completes in <500ms)."
  - "The architecture-purity docstring originally proposed by the plan ('zero better-sqlite3 imports, zero drizzle-orm imports') was rephrased as 'zero SQLite-driver imports, zero ORM imports' so the literal-grep gate `grep -E 'better-sqlite3|drizzle-orm'` returns ZERO matches. Intent preserved verbatim; only the literal package-name strings replaced. (Rule 3 — gate-blocking literal-text collision in the plan's own docstring.)"
  - "console.error log on retry-exhaustion only (single line per fingerprint that exhausted attempts) — not on every failed attempt. Phase 14 may surface fingerprint status via a structured health endpoint; Phase 13 keeps observability operator-only."

patterns-established:
  - "Engine-helper additive-field pattern: when an existing pure helper's output type needs a new field that is populated by a separate impure helper, extend the type with `field: string | null`, set null on the pure path, and have the impure helper write the non-null value. Both fields end up nullable in transit during partial computation; full population is a downstream invariant rather than a type invariant."
  - "Discriminated-union helper return type: a fallible content-addressing helper returns `{ value: string } | { value_unavailable: string }`. Caller code narrows on `'value' in result` for type-safe branching. Cleaner than `{ value: string | null, error: string | null }` because the union prevents both-nullable and both-non-null states at the type level."

requirements-completed: []  # Plan 13-01 contributes to PROV-V-03 but does NOT close it. Cohort closure happens in Plan 13-03 (after fingerprinter is wired into the completion path + diff-side parity + integration tests).

# Metrics
duration: 7min
completed: 2026-04-30
---

# Phase 13 Plan 01: ModelRef extension + fingerprintModel helper Summary

**ModelRef gains `model_hash_unavailable: string | null` and Phase 13's streaming SHA-256 helper `fingerprintModel` ships at the engine layer with WR-02 path-traversal defense, three-attempt retry on non-ENOENT I/O, and 17 unit-test cases mapping each Phase 13 success criterion to an explicit assertion.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-30T09:56:55Z
- **Completed:** 2026-04-30T10:03:35Z
- **Tasks:** 3
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- ModelRef type extended with `model_hash_unavailable: string | null` (D-CTX-1) so persisted models_json can carry typed unavailable reasons. Pure path emits both fields null; Phase 13-02 fingerprinter populates exactly one.
- `MODEL_DIR_BY_CLASS` map exported from src/engine/provenance.ts (D-CTX-2) with 9 entries mirroring LOADER_CLASS_TYPES. Lockstep invariant locked by a passing test.
- `fingerprintModel(modelsDir, classType, modelName)` async helper added at src/engine/model-fingerprint.ts. Returns the discriminated union `{ model_hash } | { model_hash_unavailable: <reason> }`; reason codes follow D-CTX-5 (models_dir_not_configured / file_not_found / file_unreadable / unsupported_class_type). Path-traversal guard mirrors src/engine/output-hash.ts WR-02 (empty / `..` / `/` / `\\` / NUL → 'file_not_found' with no disk read). Retry policy: 3 attempts, 1s/2s sleeps between for non-ENOENT I/O errors; ENOENT goes straight to 'file_not_found'.
- 17 unit-test cases (all passing on macOS; 16 on Windows where the chmod-EACCES test skips). Test count delta: +18 root-suite (1 new lockstep test in model-extraction.test.ts + 17 in model-fingerprint.test.ts; 824 → 842 passing). The 5 pre-existing v1.1-audit failures remain unchanged. tsc --noEmit clean.
- Architecture-purity preserved at the helper boundary: model-fingerprint.ts imports only node:crypto, node:fs, node:fs/promises, node:path, and ./provenance.js. Grep gates `grep -E "@modelcontextprotocol/sdk"` and `grep -E "better-sqlite3|drizzle-orm"` both return ZERO matches.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend ModelRef + add MODEL_DIR_BY_CLASS + update extractModels** — `8dffb9c` (feat)
2. **Task 2: Create src/engine/model-fingerprint.ts with fingerprintModel helper** — `1983baf` (feat)
3. **Task 3: Unit-test fingerprintModel — success / each reason code / retry / traversal** — `b59fac2` (test)

_Note: Tasks 1, 2, 3 each had `tdd="true"`. Task 1 followed RED (failing test asserting the new shape) → GREEN (type extension + map + extractModels emit). Task 2 followed RED (single contract test with import resolution failure) → GREEN (helper file). Task 3 expanded the Task-2 placeholder to the full 17-case surface — Task 2's GREEN already covered the implementation, so Task 3 was a single test commit (the helper code was already correct; tests passed on first run, confirming no implementation gap)._

## Files Created/Modified

- `src/types/provenance.ts` — ModelRef gains `model_hash_unavailable: string | null` field; trailing comment on `model_hash` updated from "null in Phase 3 (checksums deferred)" to D-CTX-1 prose.
- `src/engine/provenance.ts` — Adds `MODEL_DIR_BY_CLASS` map (9 entries) directly after `MODEL_FIELD_BY_CLASS`. `extractModels` push call now includes `model_hash_unavailable: null`. LOADER_CLASS_TYPES, KSAMPLER_CLASS_TYPES, MODEL_FIELD_BY_CLASS, ProvenanceWriter all byte-identical so 13-02 / 13-03 build on a stable baseline.
- `src/engine/model-fingerprint.ts` (NEW) — `fingerprintModel` async function + `FingerprintResult` discriminated-union type. Header docstring documents engine-purity invariant + WR-02 mirror + ComfyUI Cloud reality (default deployment runs with VFX_FAMILIAR_MODELS_DIR unset → every entry records 'models_dir_not_configured').
- `src/engine/__tests__/model-extraction.test.ts` — Existing model_hash:null assertion upgraded to assert both fields null on the pure path. New describe block locks the LOADER_CLASS_TYPES ↔ MODEL_DIR_BY_CLASS lockstep invariant (1 new test).
- `src/engine/__tests__/model-fingerprint.test.ts` (NEW) — 17 explicit named test cases: 5 success/content-addressed (criterion #1, #3), 3 unavailable reason codes (criterion #2 / D-CTX-5), 2 retry (criterion #4 — chmod-000 EACCES retries 3 times then 'file_unreadable', ENOENT does NOT retry), 7 path-traversal defense-in-depth (WR-02 mirror).
- `src/engine/__tests__/diff.test.ts` — Two pre-existing inline ModelRef literals updated to include `model_hash_unavailable: null` (Rule 3 — required for type-check after the additive ModelRef extension; the field is required-but-nullable so existing fixtures must opt in).

## Decisions Made

- **ModelRef extension is additive but required-but-nullable**: declaring `model_hash_unavailable: string | null` rather than optional `?: string` forces every existing fixture to opt in. Two fixtures in diff.test.ts updated. Rationale: a missing field would silently widen the type contract during persistence; explicit null on every emit means the persisted models_json shape is uniform across pre-fingerprint and post-fingerprint rows.
- **Path-traversal in modelName → 'file_not_found' (not a new reason code)**: keeps D-CTX-5 within its locked four codes and keeps the downstream UX equivalent to a real ENOENT. The honesty contract is "you cannot prove the bytes match"; the *reason* (no file vs. tampered name) is operator-debuggable from the console.error log path, not user-facing.
- **ENOENT skips the retry loop**: file genuinely not there means retry buys nothing. Test asserts the ENOENT path returns in <500ms.
- **Inter-attempt sleep [1000, 2000]**: two sleeps = three attempts. Mirrors src/engine/generation.ts:34-35 (DOWNLOAD_BETWEEN_ATTEMPT_DELAYS) so the retry pattern is engine-wide rather than per-helper. Test asserts the EACCES path takes ≥3s and the console.error log fires once.
- **Architecture-purity docstring rephrased**: see the auto-fixed deviation below. Intent preserved verbatim.
- **Engine-purity invariant proven by grep + import structure (full positive assertion lives in 13-03)**: this plan's verify section uses three grep gates (no @modelcontextprotocol/sdk, no better-sqlite3, no drizzle-orm). 13-03 will add a file-level architecture-purity test extension that asserts the same invariant programmatically.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Architecture-purity grep gate vs docstring literal-text collision**
- **Found during:** Task 2 (create model-fingerprint.ts)
- **Issue:** The plan's `<action>` block instructed the docstring to read "zero MCP-SDK imports, zero better-sqlite3 imports, zero drizzle-orm imports (architecture-purity guard)". The plan's `<verify>` block then required `grep -E "better-sqlite3|drizzle-orm" src/engine/model-fingerprint.ts` to return ZERO matches. The literal docstring text would match the literal grep, blocking the verify gate.
- **Fix:** Rephrased the docstring as "zero MCP-SDK imports, zero SQLite-driver imports, zero ORM imports (architecture-purity guard — proven by grep gates and the architecture-purity test in src/__tests__/architecture-purity.test.ts)". Identical intent; literal package-name strings ('better-sqlite3', 'drizzle-orm') replaced with their generic English descriptors so the grep gate passes cleanly.
- **Files modified:** src/engine/model-fingerprint.ts (docstring header only)
- **Verification:** `grep -E "better-sqlite3|drizzle-orm" src/engine/model-fingerprint.ts` → ZERO matches. `grep -E "@modelcontextprotocol/sdk" src/engine/model-fingerprint.ts` → ZERO matches.
- **Committed in:** `1983baf` (Task 2 commit, fix bundled with helper creation per Rule 3 scope-boundary)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking literal-text collision in the plan's own docstring vs. the plan's own grep gate)
**Impact on plan:** Cosmetic; intent of the architecture-purity docstring fully preserved. No scope creep, no behavioral change to fingerprintModel itself.

## Issues Encountered

- Initial baseline run reported 823 passing / 6 failing rather than 824/5; the 6th failure (`generation-tool.test.ts > IT-20`) was an `ENOTEMPTY` rmdir race in a tmp directory — confirmed flaky by re-running just that test file (31/31 pass). Real baseline holds at 824 passing / 5 pre-existing failing / 3 skipped, matching the prompt. No fix required; flake is in the test fixture cleanup path, not in production code.

## Anchor IDs for 13-02 and 13-03

The following symbols/types are now stable and referenced by future plans:

- **`MODEL_DIR_BY_CLASS`** (src/engine/provenance.ts:45) — class-type → models-subdir map; 9 entries; lockstep invariant with LOADER_CLASS_TYPES locked by a test.
- **`fingerprintModel`** (src/engine/model-fingerprint.ts:60) — async helper; signature `(modelsDir: string | null, classType: string, modelName: string) => Promise<FingerprintResult>`. 13-02 calls this from a batch entry point in src/engine/pipeline.ts (or generation.ts) after `writeCompletedEvent` returns.
- **`FingerprintResult`** (src/engine/model-fingerprint.ts:43) — discriminated-union return type `{ model_hash: string } | { model_hash_unavailable: string }`. Caller narrows on `'model_hash' in result` for type-safe branching.
- **`ModelRef.model_hash_unavailable`** (src/types/provenance.ts:33) — string | null field on the persisted models_json shape; populated by 13-02's fingerprinter call site.
- **Reason-code literals** (src/engine/model-fingerprint.ts) — exactly four: `'models_dir_not_configured'`, `'file_not_found'`, `'file_unreadable'`, `'unsupported_class_type'`. 13-03 diff-side code branches on these.
- **`FINGERPRINT_BETWEEN_ATTEMPT_DELAYS`** (file-local, intentionally not exported) — `[1000, 2000]`. 13-02 / 13-03 should NOT import this; it is implementation detail. The retry policy is observable via the `'file_unreadable'` reason code on exhaustion.

## Next Plan Readiness

**13-02 ready to start:** ModelRef shape + `MODEL_DIR_BY_CLASS` + `fingerprintModel` are all stable. 13-02's job is to:
1. Wire `fingerprintModel` into the completion path (after `writeCompletedEvent` returns synchronously, run `void fingerprintModelsForVersion(versionId)`).
2. Write a sibling `models_fingerprinted` provenance event carrying the populated `model_hash` / `model_hash_unavailable` per entry (preserves append-only contract per D-CTX-3 recommendation).
3. Add hot-path-isolation test (criterion #4) — completion returns before the fingerprinter resolves; the sibling event row appears asynchronously.
4. Add idempotency: if `models_fingerprinted` event already exists for a version, skip recomputation (crash-recovery boot path).

**Phase 13 cohort progress:** 1/3 plans complete. PROV-V-03 NOT yet marked complete in REQUIREMENTS.md — closure happens after Plan 13-03 (cohort: 13-01 helper + 13-02 completion-path wiring + 13-03 diff parity + integration tests + file-level purity assertion).

## Self-Check: PASSED

All claimed files and commits verified on disk and in git history.

- ✓ `src/engine/model-fingerprint.ts` exists
- ✓ `src/engine/__tests__/model-fingerprint.test.ts` exists
- ✓ `src/types/provenance.ts` modified
- ✓ `src/engine/provenance.ts` modified
- ✓ `src/engine/__tests__/model-extraction.test.ts` modified
- ✓ `src/engine/__tests__/diff.test.ts` modified
- ✓ Commit `8dffb9c` (Task 1) in git log
- ✓ Commit `1983baf` (Task 2) in git log
- ✓ Commit `b59fac2` (Task 3) in git log

---
*Phase: 13-model-fingerprinting*
*Plan: 01*
*Completed: 2026-04-30*
