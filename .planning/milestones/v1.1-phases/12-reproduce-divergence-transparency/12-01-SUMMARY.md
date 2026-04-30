---
phase: 12-reproduce-divergence-transparency
plan: 01
subsystem: provenance

tags: [drizzle, sqlite, sha256, streaming-hash, provenance, diff, reproduction, demo-03, c2pa-prep]

# Dependency graph
requires:
  - phase: 10-migrate-on-boot-hardening
    provides: "runMigrations() auto-applies pending Drizzle migrations on every openDb() — 0005 lands without boot-path code change"
  - phase: 03-provenance
    provides: "DiffResponse + DiffSnapshot types + pure diffVersions function + Engine.diffVersions facade — extension target for reproduction_divergence field"
provides:
  - "ReproductionDivergence interface (D-CTX-4 shape) on DiffResponse — sha256_mismatch + warnings + present-flags"
  - "buildReproductionDivergence pure helper assembling the field from already-resolved hashes + warnings"
  - "computeOutputSha256(outputsDir, versionId, filename) streaming SHA-256 helper for on-disk version outputs"
  - "Drizzle migration 0005 adding versions.reproduction_warnings_json TEXT NULL column"
  - "VersionRepo.setReproductionWarnings(id, warnings) — JSON-encoded UPDATE; called by GenerationEngine.reproduceVersion immediately after submit"
  - "Engine.diffVersions now async — reads disk for SHA-256 hashes when B is reproduce-lineage; awaits propagated to version-tool + dashboard-routes call sites"
affects: [12-02-dashboard, 13-model-fingerprinting, 14-c2pa-manifest]

# Tech tracking
tech-stack:
  added: []  # No new packages — uses Node built-ins (crypto.createHash, fs.createReadStream)
  patterns:
    - "Streaming SHA-256 over createReadStream — handles 100+ MB outputs without buffering"
    - "Pure helper + impure facade split — diff.ts stays I/O-free; pipeline.ts owns disk reads + DB lookups"
    - "Append-only provenance preserved — write to versions.reproduction_warnings_json (lifecycle row), never to provenance table"
    - "Migration ALTER TABLE ADD nullable column — additive-split convention; SCHEMA_DDL untouched (Phase 1 bootstrap shape preserved)"

key-files:
  created:
    - drizzle/0005_phase12_reproduction_warnings.sql
    - drizzle/meta/0005_snapshot.json
    - src/engine/output-hash.ts
    - src/engine/__tests__/output-hash.test.ts
    - src/store/__tests__/migrate-phase12.test.ts
  modified:
    - drizzle/meta/_journal.json
    - src/store/schema.ts
    - src/store/version-repo.ts
    - src/types/hierarchy.ts
    - src/types/provenance.ts
    - src/engine/diff.ts
    - src/engine/pipeline.ts
    - src/engine/generation.ts
    - src/tools/version-tool.ts
    - src/http/dashboard-routes.ts
    - src/test-utils/fake-engine.ts
    - src/store/__tests__/migrate.test.ts
    - src/store/__tests__/migrate-no-op.test.ts
    - src/http/__tests__/dashboard-routes.test.ts
    - src/tools/__tests__/version-tool.test.ts
    - src/engine/__tests__/diff.test.ts
    - src/engine/__tests__/pipeline.test.ts

key-decisions:
  - "Hash a SINGLE output (the first stored output) per version for v1.1 — multi-output reproduction hashing deferred to a later milestone (D-CTX deferred ideas)."
  - "Engine.diffVersions made async (was sync) because hash computation reads from disk via streaming SHA-256. All call sites (version-tool diff action, dashboard /api/versions/:id/diff route, FakeEngine) updated to await."
  - "reproduction_divergence is null on non-reproduce-lineage diffs (criterion #4) AND on reproduce-lineage diffs where bytes match AND warnings empty — single null branch keeps dashboard render logic simple."
  - "reproduction_warnings_json persisted via setReproductionWarnings UPDATE on the new versions row immediately after submitInternal returns — appends-only contract on provenance table preserved (writes go to versions, never to provenance)."
  - "Pure buildReproductionDivergence helper accepts already-resolved hashes + warnings; the impure facade in pipeline.ts owns disk reads + outputs_json parsing. Keeps src/engine/diff.ts I/O-free per architecture-purity guard."

patterns-established:
  - "Streaming hash utility pattern: createReadStream + createHash('sha256').update + digest('hex'); ENOENT → null; other I/O errors propagate."
  - "Engine facade async-conversion pattern: when adding I/O to a previously sync method, propagate await through call sites in same plan (tool layer, HTTP route, test fakes) — type system catches missed sites at compile time."
  - "Pre-existing test count integrity check: ALWAYS bump hardcoded EXPECTED_MIGRATIONS constants when adding a Drizzle migration; otherwise unrelated tests fail and obscure the new work."

requirements-completed: [DEMO-03]  # Engine cohort done; dashboard cohort lands in Plan 12-02 — REQ marked complete after both cohorts done.

# Metrics
duration: 17min
completed: 2026-04-30
---

# Phase 12 Plan 01: Reproduce Divergence Transparency — Engine Layer Summary

**Engine + tool surface for DEMO-03: version.diff envelope now carries a `reproduction_divergence` field that surfaces SHA-256 mismatches and partner-API non-determinism warnings on reproduce-lineage versions — null when bytes match AND no warnings (criterion #4).**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-04-30T08:51:10Z
- **Completed:** 2026-04-30T09:08:31Z
- **Tasks:** 3
- **Files created:** 5
- **Files modified:** 17 (12 src + 5 test/fixture/tooling)

## Accomplishments

- Drizzle migration 0005 adds `versions.reproduction_warnings_json TEXT NULL` column. Phase 10's `runMigrations()` auto-applies on next `openDb()` — no boot-path code change needed.
- Pure SHA-256 streaming hash utility `computeOutputSha256(outputsDir, versionId, filename)` lands at `src/engine/output-hash.ts` with zero MCP-SDK / SQLite-driver / ORM imports. Handles large videos (100+ MB) via `createReadStream` without OOM.
- `DiffResponse` extended with optional `reproduction_divergence` field (D-CTX-4 shape). Pure helper `buildReproductionDivergence` in `diff.ts` assembles the field from already-resolved hashes + warnings; impure facade in `pipeline.ts` owns disk reads + `outputs_json` parsing.
- `Engine.diffVersions` converted from sync to async — when B is reproduce-lineage, reads B's `reproduction_warnings_json`, hashes both outputs via streaming SHA-256, and attaches the assembled divergence. All call sites (version-tool, dashboard-routes, FakeEngine) updated to await.
- `GenerationEngine.reproduceVersion` persists warnings on the new version row via `VersionRepo.setReproductionWarnings(id, warnings)` immediately after `submitInternal` returns. Append-only provenance contract preserved — writes go to `versions`, not `provenance`.
- Engine layer architecture-purity preserved across all four touched files (diff.ts, pipeline.ts, output-hash.ts, generation.ts) — zero MCP-SDK imports verified by `architecture-purity.test.ts`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Drizzle migration 0005 + schema mirror + Version type extension** — `3547fc5` (feat)
2. **Task 2: SHA-256 streaming hash utility (engine layer, MCP-free)** — `09db939` (feat)
3. **Task 3: DiffResponse type extension + pure helper + facade wiring + reproduce-write path** — `68adb1f` (feat)

## Files Created/Modified

### Created
- `drizzle/0005_phase12_reproduction_warnings.sql` — additive ALTER TABLE adding the new column.
- `drizzle/meta/0005_snapshot.json` — Drizzle snapshot copy of 0004 with new column inside `tables.versions.columns`; new `id` UUID, `prevId` set to 0004's `id`.
- `src/engine/output-hash.ts` — pure streaming SHA-256 helper (44 lines, zero MCP/DB imports).
- `src/engine/__tests__/output-hash.test.ts` — 5 unit tests (known-hash, missing-file, missing-dir, 1MB streaming, strict path resolution).
- `src/store/__tests__/migrate-phase12.test.ts` — 3 tests (column shape, JSON round-trip, NULL legacy semantics).

### Modified
- `drizzle/meta/_journal.json` — appended idx=5 entry for `0005_phase12_reproduction_warnings`.
- `src/store/schema.ts` — added `reproduction_warnings_json: text(...)` after `lineage_type` on `versions`.
- `src/store/version-repo.ts` — added `null` initialiser in `doInsert`; new `setReproductionWarnings(id, warnings)` UPDATE method.
- `src/types/hierarchy.ts` — `Version` interface gains `reproduction_warnings_json: string | null`.
- `src/types/provenance.ts` — new `ReproductionDivergence` interface; `DiffResponse` extended with optional `reproduction_divergence?: ReproductionDivergence | null`.
- `src/engine/diff.ts` — imports `ReproductionDivergence`; new pure `buildReproductionDivergence` helper.
- `src/engine/pipeline.ts` — `Engine.diffVersions` now async; new private `computeReproductionDivergence` + `firstStoredFilename` helpers.
- `src/engine/generation.ts` — `reproduceVersion` calls `setReproductionWarnings` after submit.
- `src/tools/version-tool.ts` — `shapeDiffEnvelope` forwards `reproduction_divergence` (defaults null); `case 'diff'` awaits `engine.diffVersions`.
- `src/http/dashboard-routes.ts` — `/api/versions/:id/diff` handler awaits `engine.diffVersions`.
- `src/test-utils/fake-engine.ts` — `Version` fixtures gain `reproduction_warnings_json: null`; `diffVersions` returns Promise with default `reproduction_divergence: null`.
- `src/store/__tests__/migrate-no-op.test.ts` — `EXPECTED_MIGRATIONS` bumped 4→5.
- `src/store/__tests__/migrate.test.ts` — same bump (Rule 1 fix; was hardcoded).
- `src/http/__tests__/dashboard-routes.test.ts` — 7 inline `VersionWithAssets` fixtures gain `reproduction_warnings_json: null`.
- `src/tools/__tests__/version-tool.test.ts` — `shapeDiff` forwards `reproduction_divergence`; `invokeDiff` awaits engine call.
- `src/engine/__tests__/diff.test.ts` — 7 new `buildReproductionDivergence` pure-helper tests covering all 4 divergence states + null edge cases.
- `src/engine/__tests__/pipeline.test.ts` — 3 existing `Engine.diffVersions` tests updated to `async/await`; new describe block with 5 integration tests + `seedReproducePair` helper.

## Decisions Made

- **D-CTX-4 shape locked at engine boundary.** `reproduction_divergence` is `null` for non-reproduce-lineage diffs (criterion #4) AND for reproduce-lineage diffs where bytes match AND warnings empty. Anything non-null means at least one signal fired. Dashboard plan (12-02) renders pill iff non-null; comparison block iff `parent_output_present && reproduction_output_present`.
- **Hash a single output per version.** v1.1 hashes `outputs_json[0].filename`. Multi-output reproductions are out of scope (D-CTX deferred ideas). When the time comes, the pure helper signature accepts a single hash pair, so multi-output support means iterating in the facade — no field shape change.
- **Async signature change is correct.** `Engine.diffVersions` reads disk for hashes; making it async is the only honest signature. The change propagates to two production call sites (version-tool diff action, dashboard-routes /api/versions/:id/diff) and one fake (FakeEngine) — all caught by TypeScript at compile time.
- **`setReproductionWarnings` is a plain UPDATE without `completed_at IS NULL` guard.** Warnings are sticky to the row and may be written for any non-terminal status; reproduce-lineage rows reach this path immediately after submit (status='submitted'). The terminal-immutability invariant on completion timestamps is unaffected.
- **Empty arrays persisted as `'[]'` so the read path can distinguish "no warnings recorded" (NULL — legacy) from "explicitly empty" (`'[]'`).** D-CTX-5 backward-compat shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] EXPECTED_MIGRATIONS in migrate.test.ts hardcoded to 4**
- **Found during:** Task 3 (after migration 0005 landed)
- **Issue:** `src/store/__tests__/migrate.test.ts:14` hardcoded `EXPECTED_MIGRATIONS = 4`. Adding migration 0005 made `__drizzle_migrations` row count 5, so 3 assertions in that file failed.
- **Fix:** Bumped `EXPECTED_MIGRATIONS` to 5 with a comment naming the new migration. Mirrors the same bump already applied to `migrate-no-op.test.ts` in Task 1.
- **Files modified:** `src/store/__tests__/migrate.test.ts`
- **Verification:** All 12 migrate.test.ts assertions pass after the bump.
- **Committed in:** `68adb1f` (Task 3 commit — bundled because the failure surfaced when running the full suite at the end of Task 3).

**2. [Rule 3 — Blocking] Inline `VersionWithAssets` test fixtures missing new field**
- **Found during:** Task 1 (after `Version` type extended in `src/types/hierarchy.ts`)
- **Issue:** 7 inline `engine.cans.versions.set(...)` fixtures in `src/http/__tests__/dashboard-routes.test.ts` constructed `VersionWithAssets`-shaped objects without the new `reproduction_warnings_json` field. TypeScript was about to fail.
- **Fix:** Added `reproduction_warnings_json: null` to all 7 fixtures via `replace_all` on the consistent `lineage_type: null,\n          tags: [],` pattern. Also added the field to the two `Version` constructions in `src/test-utils/fake-engine.ts` (one inside `getVersion` default, one inside `reproduceVersion` default).
- **Files modified:** `src/test-utils/fake-engine.ts`, `src/http/__tests__/dashboard-routes.test.ts`
- **Verification:** `npx tsc --noEmit` exits 0; all 60 dashboard-routes tests pass.
- **Committed in:** `3547fc5` (Task 1 commit — bundled because the type extension belongs to Task 1).

**3. [Rule 2 — Missing critical] `firstStoredFilename` helper for safe `outputs_json` parsing**
- **Found during:** Task 3 (writing the facade `computeReproductionDivergence`)
- **Issue:** Plan said "the first stored output filename" but didn't specify a helper — directly inlining `JSON.parse(v.outputs_json)?.[0]?.filename` would crash on legacy rows where `outputs_json` is `null` or malformed JSON. Phase 5's download-on-completion path already has the equivalent try/catch pattern at `pipeline.ts:369-384`.
- **Fix:** Added a private `firstStoredFilename(versionId): string | null` helper that mirrors the Phase 5 try/catch shape. Returns `null` on missing-row, missing-`outputs_json`, malformed JSON, or empty array.
- **Files modified:** `src/engine/pipeline.ts`
- **Verification:** Test 7 of pipeline.test.ts ("reproduce-lineage with bytes matching + no warnings → null") exercises the happy path; the legacy/null path is covered structurally by `outputs_json: null` versions in the same test setup.
- **Committed in:** `68adb1f` (Task 3 commit).

---

**Total deviations:** 3 auto-fixed (1 Rule 1 bug, 1 Rule 3 blocking, 1 Rule 2 missing-critical)
**Impact on plan:** All deviations were downstream consequences of the new column and async signature change. No scope creep — every fix was required to make the planned change land without breaking existing tests or production paths.

## Issues Encountered

- **Transient generation-tool tmpdir cleanup race.** During the full-suite run, `IT-20: status on a completed row` occasionally fails with `ENOTEMPTY: directory not empty, rmdir <tmpdir>/<versionId>`. Confirmed transient: passes in isolation, passes 3-of-3 on consecutive full-suite runs after the migrate.test.ts fix. Same race documented in `.planning/phases/10-migrate-on-boot-hardening/deferred-items.md` ("3 pre-existing v1.0 timing flakes"). Out of scope for this plan.

## Architecture-Purity Proof (file-level grep results)

```
$ grep -c "@modelcontextprotocol/sdk" src/engine/diff.ts
0
$ grep -c "@modelcontextprotocol/sdk" src/engine/pipeline.ts
0
$ grep -c "@modelcontextprotocol/sdk" src/engine/output-hash.ts
0
$ grep -c "@modelcontextprotocol/sdk" src/engine/generation.ts
0
$ grep -cE "better-sqlite3|drizzle-orm" src/engine/output-hash.ts
0
```

`src/__tests__/architecture-purity.test.ts` continues to pass all 18 assertions.

## Test Count Delta

- **Baseline (end of Phase 11):** 797 passing / 5 pre-existing failing / 3 skipped
- **After Plan 12-01:** 817 passing / 5 pre-existing failing / 3 skipped (3 consecutive runs confirm stable)
- **Delta:** +20 new tests
  - migrate-phase12.test.ts: +3
  - output-hash.test.ts: +5
  - diff.test.ts (buildReproductionDivergence describe): +7
  - pipeline.test.ts (Engine.diffVersions reproduction_divergence describe): +5
- **Pre-existing 5 v1.1 ROADMAP-shape audit failures:** unchanged (documented in deferred-items.md).

## DEMO-03 Cohort Progress

| Cohort step | Plan | Status |
|---|---|---|
| Engine layer (this plan) — migration + diff field + write path | 12-01 | DONE |
| Dashboard surfacing — WarningPill + auto-fetch + comparison block | 12-02 | TODO |

**ROADMAP success criterion #3** ("`version.diff` (engine + tool path) optionally includes a `reproduction_divergence` field carrying SHA-256 mismatch detail and any partner-API non-determinism warnings") is closed at the engine + tool boundary by this plan. Both `engine.diffVersions` and the `version` MCP tool's `diff` action now emit the field; the HTTP `/api/versions/:id/diff` route inherits it.

**ROADMAP success criterion #4** (bit-identical reproductions yield no pill / no comparison block) is closed at the engine boundary — `reproduction_divergence === null` is the dashboard's signal to render nothing.

Criteria #1 + #2 are dashboard-side and land in Plan 12-02.

## Handoff Note for Plan 12-02

The dashboard now reads `reproduction_divergence` from a single round-trip to `GET /api/versions/:id/diff?against=<parent>`. Field shape matches D-CTX-4 verbatim:

```ts
reproduction_divergence: null | {
  sha256_mismatch: { parent: string; reproduction: string } | null;
  warnings: string[];
  parent_output_present: boolean;
  reproduction_output_present: boolean;
}
```

Render rules (per CONTEXT.md §Specifics):
- **Pill render rule:** `reproduction_divergence !== null` → render the "non-deterministic" pill in the version drawer header.
- **Comparison block render rule:** `reproduction_divergence?.parent_output_present === true && reproduction_divergence?.reproduction_output_present === true` → render side-by-side `<img>` block (each via `getOutputUrl(versionId)`).
- **No-divergence path:** `reproduction_divergence === null` → drawer looks identical to a non-reproduce version's drawer (no pill, no block).

The dashboard's existing `lazy-fetch on View Diff click` flow becomes `auto-fetch on VersionDrawer mount when entity.lineage_type === 'reproduce' && priorVersion exists`. The `priorVersion` is the version with `version_number = entity.version_number - 1` on the same shot (already exposed via the version list).

## Self-Check: PASSED

```
$ ls .planning/phases/12-reproduce-divergence-transparency/12-01-SUMMARY.md
$ ls drizzle/0005_phase12_reproduction_warnings.sql drizzle/meta/0005_snapshot.json
$ ls src/engine/output-hash.ts src/engine/__tests__/output-hash.test.ts
$ ls src/store/__tests__/migrate-phase12.test.ts
all FOUND

$ git log --oneline --all | grep -E "3547fc5|09db939|68adb1f"
3547fc5 feat(12-01): add 0005 migration + reproduction_warnings_json column
09db939 feat(12-01): add SHA-256 streaming hash utility for version outputs
68adb1f feat(12-01): wire reproduction_divergence into version.diff envelope
all FOUND
```

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` already covered. The 0005 migration adds a derived display column on an existing trust boundary; `output-hash.ts` reads files from the same on-disk layout that `output-downloader.ts` writes (D-WEBUI-26 boundary already analyzed in Phase 5). C2PA tamper-evidence for output bytes themselves is Phase 14's domain (T-12-01 disposition: accept).
