---
phase: 16-redaction-and-agent-surface
plan: 01
subsystem: c2pa
tags: [c2pa, agent-surface, exporter, verifier, prov-v-07, redaction, agent-tools]

# Dependency graph
requires:
  - phase: 14-c2pa-signed-manifest
    provides: Phase 14 signer.ts lazy c2pa-node load discipline + manifest_signed event payload + cert_subject_summary derivation + ACCEPTABLE_VALIDATION_CODES list
  - phase: 15-ingredient-graph
    provides: ingredients_summary mirror field on ManifestSignedPayloadFields + parent/component-aware manifest contract (Plan 15-02 D-CTX-5)
provides:
  - Pure-async exportManifest(versionId, repos, outputsDir) returning base64-encoded ExporterResult
  - Async verifyManifest(input) with discriminated input shape (versionId-form OR bytes-form) returning D-CTX-2 VerificationReport
  - Engine.exportManifestForVersion / Engine.verifyManifestForVersion facade methods (lazy-import delegation)
  - Architecture-purity centralization extension (allowed-set: signer | exporter | verifier; D-CTX-7)
  - File-level architecture-purity locks for exporter.ts (zero c2pa-node) + verifier.ts (lazy-only c2pa-node)
  - Two new TypedError codes: EXPORT_PATH_TRAVERSAL_REJECTED, C2PA_VERIFIER_LOAD_FAILED (formalized INTERNAL_ERROR fallback to type union)
affects: [16-02-redaction, 16-03-tool-surface, 16-04-end-to-end-tests, 16-05-cohort-closure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discriminated input shape — versionId-form vs bytes-form unified into one entry point with a discriminating type guard"
    - "Lazy native binding load — `await import('c2pa-node')` only inside the function, NEVER at module top-level"
    - "Path-traversal guard at engine boundary — filename containing '..', '/', '\\\\' throws TypedError before any disk access"
    - "ENOENT graceful-fail mirror — disk-read failures degrade to a discriminated 'absent'/'no_manifest' state rather than throwing"
    - "Engine facade lazy-import — pipeline.ts uses `await import('./c2pa/exporter.js')` even though exporter.ts has no c2pa-node import (consistency + future-proofing)"
    - "Architecture-purity allowed-set assertion (D-CTX-7) — replaces single-element deepEqual with subset check + sorted-array deepEqual on actual importers"

key-files:
  created:
    - src/engine/c2pa/exporter.ts
    - src/engine/c2pa/verifier.ts
    - src/engine/c2pa/__tests__/exporter.test.ts
    - src/engine/c2pa/__tests__/verifier.test.ts
    - src/engine/__tests__/pipeline-export-verify.test.ts
  modified:
    - src/engine/c2pa/index.ts
    - src/engine/pipeline.ts
    - src/engine/errors.ts
    - src/__tests__/architecture-purity.test.ts

key-decisions:
  - "D-PLAN-1 implemented: single Wave-1 plan covers BOTH exporter and verifier — they share asset-read scaffolding and the architecture-purity guard extension is one atomic edit"
  - "D-PLAN-2 implemented: Engine facade methods (exportManifestForVersion/verifyManifestForVersion) land in this plan, not Plan 16-03 — keeps Plan 16-03 a pure tool-layer change"
  - "D-PLAN-3 implemented: VerificationReport is a flat structure (matched_assertions / gaps / failures as separate top-level arrays) — tool envelope spreads into structuredContent without a serialization pass"
  - "D-PLAN-4 implemented: exporter returns base64-encoded bytes (not a stream) — appropriate for v1.1 typical sizes (~1 MB); streaming export deferred to v1.2"
  - "D-PLAN-5 implemented: dev-cert acceptance opt-in via VFX_FAMILIAR_C2PA_TRUST_DEV_CERT='1' — production default rejects untrusted-root; dev mode filters bounded set of dev-acceptable codes BEFORE classification"
  - "D-CTX-7 architecture-purity extension implemented: c2pa-node imports allowed in signer.ts | exporter.ts | verifier.ts (allowed-set assertion). exporter.ts is in the allowed-set as future-proofing reservation but does NOT actually import c2pa-node (zero-runtime-binding-load surface)"

patterns-established:
  - "Allowed-set architecture-purity assertion — replaces brittle single-element deepEqual with (a) subset check rejecting rogue importers + (b) sorted-array deepEqual on actual importers. Plan 16-02 may extend the allowed-set when redaction.ts joins the importers"
  - "VerificationReport flat shape — discriminated signature_status union + 4 array fields (matched_assertions, gaps, failures, no nesting under 'details'). Future Phase 16 plans + agent envelopes spread the report verbatim into structuredContent"
  - "Engine-recorded vs c2pa-rs-recorded fields override — versionId-form verification overlays event.signed_at + event.cert_subject_summary onto c2pa-rs's signature_info.{time,issuer} so the engine's authoritative timestamp wins"

requirements-completed: []  # PROV-V-07 NOT yet marked complete — cohort-level requirement, closes after Plan 16-03 (tool surface) wires the facade methods through to version.export_manifest + version.verify_manifest tool actions.

# Metrics
duration: 13min
completed: 2026-04-30
---

# Phase 16 Plan 1: Exporter + Verifier Engine Modules Summary

**Pure-async exportManifest + lazy-binding verifyManifest engine modules wired into Engine facade with allowed-set architecture-purity guard. PROV-V-07 agent-surface foundation.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-04-30T18:58:11Z
- **Completed:** 2026-04-30T19:11:13Z
- **Tasks:** 3
- **Files created:** 5
- **Files modified:** 4
- **Tests added:** 46 (16 exporter + 22 verifier + 6 facade + 2 architecture-purity locks)

## Accomplishments

- **PROV-V-07 engine half complete.** Two pure-engine modules (`src/engine/c2pa/exporter.ts` + `src/engine/c2pa/verifier.ts`) provide the read-only export + verify primitives that Plan 16-03's `version.export_manifest` / `version.verify_manifest` tool actions will wire to. Both modules are zero-c2pa-node-on-the-import-graph (verifier uses lazy `await import` per Phase 14 Concern #11) and zero-MCP/SQLite/ORM (architecture-purity preserved via two new file-level grep guards).
- **D-CTX-2 VerificationReport shape locked at engine boundary.** Flat structure with discriminated `signature_status: 'valid' | 'invalid' | 'untrusted_root' | 'unsupported_algorithm' | 'no_manifest'` + 4 array fields + 2 nullable scalars. All 5 branches covered by reproducible mocked-store tests; the priority order (untrusted_root > unsupported_algorithm > no_manifest > invalid > valid) is locked by `classifySignatureStatus`.
- **D-CTX-3 ExporterResult shape locked.** Three-state discriminated union (present | absent | unsupported_format) with NULL fields off the present branch — agents distinguish "asset on disk but un-signed (EXR/PSD)" from "no event recorded yet" cleanly. ENOENT graceful-fail (Phase 14 D-CTX-9 mirror) routes to 'absent' rather than throwing.
- **Architecture-purity allowed-set assertion (D-CTX-7).** The single-element `expect(nonTestFiles).toEqual(['src/engine/c2pa/signer.ts'])` deepEqual was brittle; Plan 16-02 + Plan 16-03 cohort would have required two more invasive edits. Replaced with a two-layer check: (a) subset check rejecting any rogue importer outside the allowed set `{signer, exporter, verifier}`, (b) sorted-array deepEqual on the ACTUAL importers (currently `signer.ts + verifier.ts`). Plan 16-02 only needs to add `redaction.ts` to one or both sets when it integrates the binding.

## Task Commits

Each task was committed atomically:

1. **Task 1: pure-async exportManifest + 16 unit tests** — `6a1231d` (feat)
2. **Task 2: verifyManifest with lazy c2pa-node + 22 unit tests** — `7706a48` (feat)
3. **Task 3: Engine facade + architecture-purity locks + 6 facade tests** — `ecf15d0` (feat)

_Note: TDD discipline followed — the test file in each task was authored first, confirmed RED, then the production module made it GREEN. The three commits above bundle test + production + barrel + arch-purity edits per task atomic boundary._

## Files Created/Modified

### Created

- `src/engine/c2pa/exporter.ts` (192 lines) — pure-async `exportManifest(versionId, versionRepo, provenanceRepo, outputsDir)` returning `Promise<ExporterResult>`. ZERO c2pa-node / MCP / SQLite / ORM imports. Path-traversal guard at boundary (T-16-01 mitigation).
- `src/engine/c2pa/verifier.ts` (282 lines) — async `verifyManifest(input)` with discriminated input shape. Lazy `await import('c2pa-node')` per Phase 14 Concern #11. NEVER throws on c2pa-rs failures — all 5 signature_status branches discriminate cleanly. D-PLAN-5 dev-cert opt-in via env var.
- `src/engine/c2pa/__tests__/exporter.test.ts` (361 lines, 16 tests) — covers all 3 manifest_status branches + 3 path-traversal inputs + VERSION_NOT_FOUND + pre-Phase-15 ingredients_summary mirror + idempotency + cert_subject string typing + outputs_json malformed parse. Stub repos via `Pick<...>` dependency injection; mkdtemp + writeFile fixtures for byte-identical base64 round-trip assertion.
- `src/engine/c2pa/__tests__/verifier.test.ts` (510 lines, 22 tests) — 11 bytes-form (1 happy + 4 untrusted variants + 1 unsupported_algorithm + 1 read-throw + 4 ordering/gaps/no_manifest) + 9 versionId-form (happy + 2 no_manifest short-circuits + ENOENT graceful-fail + 2 throws + 1 outputs_json null + 1 unsupported-extension graceful-fail) + 2 D-CTX-2 type-shape locks. Uses `vi.hoisted` mock state holder for clean per-test branch swaps without re-importing the verifier.
- `src/engine/__tests__/pipeline-export-verify.test.ts` (181 lines, 6 tests) — shallow Engine facade tests confirming delegation plumbing against a real Engine + in-memory SQLite + mkdtemp outputsDir. Both methods + both branches (versionId / bytes) + VERSION_NOT_FOUND.

### Modified

- `src/engine/c2pa/index.ts` — barrel re-exports for `exportManifest, ExporterResult, verifyManifest, VerificationReport, VerifyManifestInput`.
- `src/engine/pipeline.ts` — 2 new public methods on the `Engine` class (`exportManifestForVersion`, `verifyManifestForVersion`) + 2 new type imports from `./c2pa/index.js`. Both methods are thin lazy-import facades — zero business logic inline.
- `src/engine/errors.ts` — 3 new ErrorCode union entries: `EXPORT_PATH_TRAVERSAL_REJECTED`, `C2PA_VERIFIER_LOAD_FAILED` (reserved for future strict-mode callers; Phase 16 graceful-fails to no_manifest instead), `INTERNAL_ERROR` (formalizes the existing HTTP middleware fallback string into the typed union so engine modules can construct it).
- `src/__tests__/architecture-purity.test.ts` — 1 updated test (centralization assertion: D-CTX-7 allowed-set + actual-set sorted deepEqual) + 2 new file-level locks (exporter.ts zero c2pa-node + zero MCP/SQLite/ORM/hono; verifier.ts STATIC c2pa-node import REJECTED + lazy form REQUIRED + zero MCP/SQLite/ORM/hono).

## Decisions Made

All five plan-level D-PLAN decisions implemented as designed:

1. **D-PLAN-1 (single Wave-1 plan covers both modules)** — exporter and verifier share `parsePrimaryOutputFilename`, path-traversal guard logic, and VERSION_NOT_FOUND throw semantics. Bundling them avoided two near-identical test fixtures and two waves of architecture-purity tweaks.
2. **D-PLAN-2 (Engine facade lands here, not in 16-03)** — `exportManifestForVersion` + `verifyManifestForVersion` are at the engine boundary now; Plan 16-03 will only add the tool-layer Zod schema + switch arms. Mirrors Phase 14's `Engine.signOutput` cohort pattern.
3. **D-PLAN-3 (flat VerificationReport)** — `matched_assertions`, `gaps`, `failures` are top-level arrays. The tool envelope can spread the report into `structuredContent` without an extra serialization pass.
4. **D-PLAN-4 (base64 bytes, not stream)** — appropriate for v1.1 typical manifest sizes (< 1 MB). Streaming export deferred to v1.2; the v1.1 `BUFFER_SIGNING_MAX_BYTES = 500 MB` cap from Phase 14 is a safe upper bound for inline base64.
5. **D-PLAN-5 (dev-cert opt-in via env var)** — production default maps `signingCredential.untrusted` → `signature_status='untrusted_root'`. With `VFX_FAMILIAR_C2PA_TRUST_DEV_CERT='1'`, the bounded set of 5 dev-acceptable codes (`signingCredential.{untrusted,expired}`, `timeStamp.{untrusted,mismatch,outsideValidity}`, mirrors Phase 14 `ACCEPTABLE_VALIDATION_CODES` list at `src/__tests__/c2pa-verification.test.ts:241-247`) is filtered BEFORE classification — bundled test certs report 'valid' in dev/CI without compromising production strictness.

One additional architectural decision discovered during execution:

6. **D-CTX-7 architecture-purity allowed-set assertion** — the plan called for moving from `expect(nonTestFiles).toEqual(['src/engine/c2pa/signer.ts'])` to a 3-element list. Implemented as a TWO-LAYER assertion (subset check + sorted-array deepEqual on actual importers). The actual-set currently contains `signer.ts + verifier.ts` (exporter.ts is in the allowed-set but does NOT import c2pa-node — slot reserved per D-CTX-7 for future extensions). This avoids a flap in Plan 16-02 if redaction.ts ends up importing the binding directly OR going through signer.ts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] VersionRepo method name: plan said `getById`, actual is `getVersion`**
- **Found during:** Task 1 (exporter implementation)
- **Issue:** The plan's `read_first` block referenced `versionRepo.getById(versionId)`. Inspection of `src/store/version-repo.ts:184` showed `VersionRepo` exposes `getVersion(id)` instead — `getById` does not exist on the type.
- **Fix:** Used `getVersion` in both the exporter's `Pick<VersionRepo, 'getVersion'>` constraint and all test stubs. Verifier (Task 2) inherited the same correction. Engine facade (Task 3) accordingly delegates `this.versionRepo.getVersion(...)` indirectly via the engine modules.
- **Files modified:** src/engine/c2pa/exporter.ts, src/engine/c2pa/verifier.ts, src/engine/c2pa/__tests__/exporter.test.ts, src/engine/c2pa/__tests__/verifier.test.ts
- **Verification:** tsc --noEmit clean; all 38 unit tests pass.
- **Committed in:** 6a1231d (Task 1) + 7706a48 (Task 2)

**2. [Rule 3 - Blocking issue] Architecture-purity grep matches docstring literal package names**
- **Found during:** Task 2 (verifier introduced the regression)
- **Issue:** verifier.ts header docstring originally stated "ZERO better-sqlite3 / drizzle-orm imports" — the `grep -rl` in `src/engine/c2pa/ has zero imports from better-sqlite3 (PROV-V-01)` matched the literal string in the comment, failing the test even though no import existed.
- **Fix:** Rephrased docstring to "ZERO SQLite-driver imports, ZERO ORM imports" (semantically identical, no literal package-name strings). This is the THIRD recurrence of this Phase 13/15-01 docstring-vs-grep-collision pattern (logged in MEMORY).
- **Files modified:** src/engine/c2pa/verifier.ts
- **Verification:** architecture-purity 32/32 → 32/32 passing after rephrase. Then 34/34 once Task 3 added the two new file-level locks.
- **Committed in:** 7706a48 (Task 2)

**3. [Rule 3 - Blocking issue] Implicit-any from c2pa-node ValidationStatus index signature**
- **Found during:** Task 2 (after writing verifier.ts)
- **Issue:** c2pa-node's `ValidationStatus` and `ManifestAssertion` types declare `[property: string]: any` index signatures. When `validation_status.filter(v => ...)` and `manifest.assertions.map(a => a.label)` were typed implicitly via `store.validation_status ?? []`, TypeScript narrowed the array element type to `any` — generating implicit-any warnings on every `v` and `a` parameter.
- **Fix:** Added local minimal-shape type aliases (`type ValidationStatusMin = { code?: string | null; url?: string | null }`, `type AssertionMin = { label?: string | null }`) and explicit casts at the boundaries. The minimal shapes capture only the two fields the verifier actually reads.
- **Files modified:** src/engine/c2pa/verifier.ts
- **Verification:** tsc --noEmit clean.
- **Committed in:** 7706a48 (Task 2 — bundled before commit)

**4. [Rule 3 - Architecture-purity edit ordering] Centralization assertion update bundled with Task 2 instead of Task 3**
- **Found during:** Task 2 (after creating verifier.ts)
- **Issue:** The plan placed the architecture-purity centralization assertion update in Task 3 ("Step 2 — Architecture-purity guard extension"). However, the moment verifier.ts lands, the existing single-element `toEqual(['src/engine/c2pa/signer.ts'])` deepEqual breaks — every commit between Task 2 and Task 3 would have a known-failing test.
- **Fix:** Bundled the centralization assertion update (D-CTX-7 allowed-set + sorted-array deepEqual) into Task 2's commit so the suite stays green between commits. Task 3's architecture-purity work then focused only on the two new file-level locks (exporter.ts + verifier.ts) — strictly additive, zero risk to Task 2's commit cleanliness.
- **Files modified:** src/__tests__/architecture-purity.test.ts (centralization update in Task 2 commit; file-level locks in Task 3 commit)
- **Verification:** Each commit individually leaves the architecture-purity suite green: Task 1 = 32/32, Task 2 = 32/32, Task 3 = 34/34.
- **Committed in:** 7706a48 (centralization), ecf15d0 (file-level locks)

**5. [Rule 2 - Missing critical functionality] INTERNAL_ERROR was not in the TypedError union**
- **Found during:** Task 1 (writing exporter.ts)
- **Issue:** The exporter's non-ENOENT bubble path constructs `throw new TypedError('INTERNAL_ERROR', ...)`. Inspection showed `INTERNAL_ERROR` was used as a literal string in `src/http/error-middleware.ts:111` for unknown-error fallback, but was NEVER part of the `ErrorCode` type union — the typed-throw call would fail compilation.
- **Fix:** Added `INTERNAL_ERROR` to the `ErrorCode` union. Pre-existing HTTP middleware usage continues to work (it's just a string literal in a JSON response). Engine modules that throw `INTERNAL_ERROR` now type-check correctly. This is a strict additive change — every existing assignment to `ErrorCode` continues to type-check.
- **Files modified:** src/engine/errors.ts
- **Verification:** tsc --noEmit clean; HTTP error-middleware.test.ts still passing (literal-string usage in middleware unchanged).
- **Committed in:** 6a1231d (Task 1)

---

**Total deviations:** 5 auto-fixed (5 Rule 3 blocking issues, of which 1 is also Rule 2 missing-functionality)
**Impact on plan:** All five fixes were necessary for the plan to compile + pass its own verification gates. None expanded scope. The docstring-vs-grep collision is a recurring Phase 13/15-01 pattern logged in MEMORY (third occurrence) — opportunity for a future skill rule that flags new MCP/SQLite/ORM/hono package names in docstrings.

## Issues Encountered

**One observed flaky failure during the FULL root-suite run (not related to my changes):**
`src/tools/__tests__/generation-tool.test.ts > IT-20: status on a completed row...` failed once with `ENOTEMPTY: directory not empty, rmdir '/var/folders/.../vfx-gen-tool-...'`. Re-running the test in isolation passed cleanly (31/31). This is a parallel-test cleanup race in the `mkdtemp + rmtree` pattern, pre-existing and unrelated to Plan 16-01. Not regressed by this plan's changes; logged here as observational only — not a deferred item.

The 4 pre-existing v1.1-audit failures (phase-attribution + validation-flags ROADMAP-shape) remained unchanged across all three task commits, as expected. Logged in `.planning/phases/10-migrate-on-boot-hardening/deferred-items.md` for milestone-close audit.

## TDD Gate Compliance

All three tasks followed the test-first discipline:

- **Task 1 (exporter)** — `exporter.test.ts` authored first, run with `npx vitest run` to confirm `Cannot find module '../exporter.js'` (RED). Then `exporter.ts` written; tests went 16/16 GREEN. Per task atomic boundary, both files were committed in a single `feat(...)` commit (no separate `test(...)` then `feat(...)` commits — the per-task commit captured the full RED→GREEN cycle as a unit per the plan's task definition).
- **Task 2 (verifier)** — `verifier.test.ts` authored first (with the lazy-import vi.mock pattern), confirmed 20 tests RED + 2 type-shape tests passing without module dependency. `verifier.ts` written; all 22 tests GREEN. tsc revealed implicit-any warnings; minimal-shape types added; tsc clean. Architecture-purity centralization assertion updated to keep the suite green. Single `feat(...)` commit.
- **Task 3 (Engine facade)** — `pipeline-export-verify.test.ts` authored alongside the pipeline.ts changes. The test file imports the new methods; if the methods didn't exist, tsc would have failed before vitest. RED→GREEN happened within the single edit cycle. Two new architecture-purity locks added in the same commit.

The plan-level frontmatter `type: tdd` is honored: each task atomic commit contains a `feat(...)` (the production module) AND the test file that proves it works. No commits without test coverage.

## Self-Check

Verified before final submission.

**Files exist:**
- `src/engine/c2pa/exporter.ts` — FOUND (192 lines)
- `src/engine/c2pa/verifier.ts` — FOUND (282 lines)
- `src/engine/c2pa/__tests__/exporter.test.ts` — FOUND (361 lines, 16 tests)
- `src/engine/c2pa/__tests__/verifier.test.ts` — FOUND (510 lines, 22 tests)
- `src/engine/__tests__/pipeline-export-verify.test.ts` — FOUND (181 lines, 6 tests)

**Commits exist:**
- `6a1231d` (Task 1) — FOUND
- `7706a48` (Task 2) — FOUND
- `ecf15d0` (Task 3) — FOUND

**Symbols exist:**
- `Engine.exportManifestForVersion` in pipeline.ts — FOUND (1 declaration)
- `Engine.verifyManifestForVersion` in pipeline.ts — FOUND (1 declaration)
- `ExporterResult, VerificationReport, VerifyManifestInput` exported from `src/engine/c2pa/index.ts` — FOUND (3 type re-exports)
- `EXPORT_PATH_TRAVERSAL_REJECTED, C2PA_VERIFIER_LOAD_FAILED` in errors.ts — FOUND (2 union entries)

**Architecture-purity gates:**
- exporter.ts: zero c2pa-node (static OR dynamic), zero MCP, zero SQLite, zero ORM, zero hono — PASS
- verifier.ts: zero static c2pa-node, ONE lazy `await import('c2pa-node')` form, zero MCP, zero SQLite, zero ORM, zero hono — PASS
- Centralization (allowed-set): subset check + actual-set sorted-array deepEqual — PASS

**Test counts:**
- exporter.test.ts: 16/16 — PASS
- verifier.test.ts: 22/22 — PASS
- pipeline-export-verify.test.ts: 6/6 — PASS
- architecture-purity.test.ts: 34/34 (was 32, +2 new file-level locks) — PASS
- Root suite: 1236 passing / 4 pre-existing v1.1-audit failures unchanged / 3 skipped — PASS
- Dashboard: 88/88 unchanged — PASS

## Self-Check: PASSED

## User Setup Required

None — no external service configuration required. The dev-cert env var `VFX_FAMILIAR_C2PA_TRUST_DEV_CERT` is OPT-IN, not required; production default rejects untrusted-root cleanly. No new environment variables, dashboard configuration, or CLI tools introduced.

## Next Phase Readiness

**Plan 16-02 (Redaction) UNBLOCKED:**
- exporter.ts's path-traversal guard + present-branch logic is reusable as a reference for the redaction primitive's read path.
- verifier.ts's `c2pa.read({asset})` discipline is reusable for parent-manifest JSON read in the redaction re-sign workflow.
- `addAllowedC2paNodeImporters` allowed-set in architecture-purity is one-line-extendable when redaction.ts lands.

**Plan 16-03 (Tool surface) UNBLOCKED:**
- Engine.exportManifestForVersion + Engine.verifyManifestForVersion are the engine boundary contracts the tool layer wires through.
- D-CTX-2 VerificationReport flat shape ensures the tool envelope can spread the report verbatim into `structuredContent` without an extra serialization pass.
- D-CTX-3 ExporterResult three-state discriminated union maps cleanly to the tool's response envelope.

**Plan 16-04 + 16-05** depend on 16-02 + 16-03 landing first; no direct unblocks from this plan.

**PROV-V-07 closure:** Cohort-level requirement; mark complete after Plan 16-03 wires `version.export_manifest` + `version.verify_manifest` tool actions to the facade methods.

---
*Phase: 16-redaction-and-agent-surface*
*Completed: 2026-04-30*
