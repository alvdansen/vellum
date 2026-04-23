---
phase: 04-asset-management
plan: 05
subsystem: tools
tags: [mcp-tool, version, hydration, include-flags, fixtures, tdd, phase-4-closure]

# Dependency graph
requires:
  - phase: 01-foundation-hierarchy
    provides: "shapeList, MAX_ID_LENGTH/MAX_PAGE_SIZE/DEFAULT_PAGE_SIZE, versionLabel, toolOk/toolError envelope, TypedError, makeInMemoryDb fixture, discriminated Zod union + raw ZodRawShape RT-01/RT-02 pattern"
  - phase: 03-provenance-versioning
    provides: "Existing version tool Phase 3 shape (get/list/diff/provenance actions), direct-mirror test pattern with invokeGet/invokeList/invokeDiff/invokeProvenance, shapeVersionEntity/shapeDiffEnvelope/shapeProvenanceEnvelope"
  - plan: 04-01
    provides: "VersionWithAssets type in src/types/assets.ts, DbWithClient widening pattern for TagRepo/MetadataRepo"
  - plan: 04-02
    provides: "TagRepo (insertTag), MetadataRepo (upsertMetadata) — fixture helpers compose these repos"
  - plan: 04-03
    provides: "Engine.getVersion returns VersionWithAssets (always-hydrated per D-ASST-19), Engine.listVersionsForShot accepts {include_tags?, include_metadata?} 4th-arg options (D-ASST-20), hydrateVersionWithAssets helper (consumed through facade)"
  - plan: 04-04
    provides: "Tool-budget at 7 confirmed, architecture-purity extended for Phase 4 files, stdio-hygiene Phase 4 assertion — Plan 05 inherits unchanged"
provides:
  - "src/tools/version-tool.ts — shapeVersionEntity now types entity as VersionWithAssets; ListInput Zod schema grows include_tags/include_metadata defaults; inputSchema (raw ZodRawShape) grows both as optional booleans; case 'list' passes options object to engine.listVersionsForShot; tool description mentions new hydration + flags; diff + provenance UNCHANGED"
  - "src/tools/__tests__/version-tool.test.ts — 8 new it() blocks across 3 new describe groups covering INV-ASST-15 (3 cases), INV-ASST-16/17/22/23 (4 cases), INV-ASST-25 (1 case); buildStack exposes testDb so fixture helpers attach to stack's db"
  - "src/test-utils/fixtures.ts — 7 Phase 4 seeding helpers: seedAssetFixtures, versionWithTags, versionWithMetadata, hierarchyWithVersionsAcrossScopes, versionsWithTimestampSpread, versionsWithStatusVariety, versionsAtCap; DbWithClient type widening re-introduced at fixture boundary"
affects: [05 (dashboard), future-phases, closure-phase-4]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direct-mirror test updates to absorb production tool's Zod schema changes: local ListInput schema and invokeList helper both updated to include new flags and pass them to the engine; mirrors the production version-tool.ts one-to-one so test assertions exercise identical behavior."
    - "Fixture composition without retrofitting: fixture helpers (versionWithTags / versionWithMetadata) operate on an injected TestDb rather than assuming their own hierarchy. Tests that already have a stack+shot pass stack.testDb as the helper argument; tests that need a new hierarchy use seedAssetFixtures standalone."
    - "JSON-serialize-and-regex contract assertion for negative-surface checks: provenance response non-regression is verified by JSON.stringify + /\"tags\"\\s*:/ + /\"metadata\"\\s*:/ scans — belt-and-suspenders on top of positive events[] assertion."
    - "buildStack exposes testDb (not just db) so Phase 4 helpers can attach rows to the same in-memory database the Engine reads from. Non-breaking — existing destructures of stack.db still work through stack.testDb.db."

key-files:
  created: []
  modified:
    - "src/tools/version-tool.ts (232 LOC, +23 net)"
    - "src/tools/__tests__/version-tool.test.ts (558 LOC, +175 net — 180 additions + 5 mirror updates)"
    - "src/test-utils/fixtures.ts (318 LOC, +288 net — 7 fixture helpers)"

key-decisions:
  - "[Plan 04-05] Widened Db type (DbWithClient = BetterSQLite3Database & { $client }) re-introduced at src/test-utils/fixtures.ts top-level to satisfy TagRepo/MetadataRepo constructor arity. Mirrors Plan 04-02 pattern in src/store/__tests__/tag-repo.test.ts (DbWithClient local alias + cast at call site). Rule 3 blocking — tsc refused the narrow TestDb.db without the cast."
  - "[Plan 04-05] Dropped unused Version type import from src/tools/version-tool.ts — shapeVersionEntity now types entity as VersionWithAssets; Version is no longer referenced as a type (only in comments)."
  - "[Plan 04-05] Added 8 new test cases instead of the plan's target 6 — split the list-include-flags coverage into 4 cases (default both-off; include_tags only; include_metadata only; both-on) for complete truth-table coverage. Still hits the 6 required INV-ASST-XX invariants (15, 16, 17, 22, 23, 25)."
  - "[Plan 04-05] buildStack() extended to expose testDb so Phase 4 fixture helpers (versionWithTags / versionWithMetadata) can attach tags/metadata rows to the same in-memory database the Engine queries through. Non-breaking — existing destructures of stack.hierarchy / stack.versions unchanged."
  - "[Plan 04-05] No existing Phase 2/3 test assertions required update — existing tests used either toBe/toBeUndefined on individual fields or toMatchObject/toEqual on arrays that don't intersect with the new inline tags/metadata keys. Additive-only propagation from engine up through the shaper worked as designed."

patterns-established:
  - "Test-file mirror update pattern for tool-surface Zod extensions: when the production tool's Zod schema grows optional fields, the test file's local mirror schema + invokeX helper must grow the same fields so direct-mirror assertions exercise identical behavior. One-commit update — schema + invokeX helper together."
  - "Stack-exposed testDb pattern for Phase 4+ fixture integration: stack builders that need Phase 4 tag/metadata fixture composition should return the full TestDb (not just db) so fixture helpers can attach rows to the same database."
  - "Negative-surface regex contract for provenance-like read paths: D-ASST-21 lock (tags/metadata NEVER in provenance stream) is asserted via JSON.stringify + /\"tags\"\\s*:/ scan — cheap, exhaustive, catches any future drift."

requirements-completed: [ASST-01, ASST-02, ASST-04, ASST-05]

# Metrics
duration: 11min
completed: 2026-04-23
---

# Phase 4 Plan 05: Version Tool Phase 4 Hydration + Fixture Extensions Summary

**Version tool wired for Phase 4 — `get` always returns inline tags (ASC) + metadata (ASC by key); `list` grows include_tags/include_metadata opt-in flags with cheap default payload; `provenance` + `diff` untouched. Fixture helpers (7) extracted for engine + tool test composition. 23/23 version-tool tests green (15 existing + 8 new); full suite 568/572 with two pre-existing timing flakes.**

## Performance

- **Duration:** ~11 min wall-clock (started 2026-04-23T06:28:35Z, ended 2026-04-23T06:39:28Z)
- **Tasks:** 3 (fixtures extension, tool extension, test extension)
- **Commits:** 3 atomic (1 feat per task for file-type alignment; no TDD RED/GREEN split since the plan was structured as additive extension)
- **Lines of code:**
  - `src/test-utils/fixtures.ts`: 318 (was 30; +288 for 7 helpers + DbWithClient alias)
  - `src/tools/version-tool.ts`: 232 (was 209; +23 net — VersionWithAssets import, schema extensions, description update)
  - `src/tools/__tests__/version-tool.test.ts`: 558 (was 383; +175 net — 8 new it() blocks + 5 mirror updates)
  - **Total new/modified:** +486 lines across 3 files
- **Test suite runtime:** 23/23 version-tool tests in 481ms; full suite in ~20s (568/572)

## Accomplishments

- **Task 1 (fixtures.ts)** — 7 Phase 4 seeding helpers with typed signatures, JSDoc, DbWithClient widening at boundary:
  - `seedAssetFixtures(testDb, {versionCount, tagsPerVersion, metadataPerVersion})` — bulk seed for query-correctness tests; returns hierarchy ids + versions + flat tag/key arrays
  - `versionWithTags(testDb, versionId, tags)` — attach tag set via idempotent insertTag
  - `versionWithMetadata(testDb, versionId, metadataMap)` — attach key/value map via upsertMetadata
  - `hierarchyWithVersionsAcrossScopes(testDb)` — 2 projects × 1 shot × 1-2 versions for scope filter tests
  - `versionsWithTimestampSpread(testDb, timestamps)` — raw-SQL created_at override for date-range tests
  - `versionsWithStatusVariety(testDb)` — one version per (submitted/running/completed/failed) state
  - `versionsAtCap(testDb, {tagCount, metadataCount})` — MAX_TAGS/METADATA_PER_VERSION cap fixture
  - All helpers construct HierarchyRepo + VersionRepo + (when needed) TagRepo + MetadataRepo against the injected TestDb; no cross-helper coupling; compose cleanly with each other.

- **Task 2 (version-tool.ts)** — additive extension, zero breakage to Phase 2/3:
  - `shapeVersionEntity` type signature widened: `entity: Version → VersionWithAssets`; body unchanged (spread carries tags/metadata through automatically)
  - `ListInput` Zod schema grows `include_tags`/`include_metadata` with `.default(false)` (D-ASST-20)
  - Raw `inputSchema` (top-level ZodRawShape exposed to MCP tools/list) grows both as `z.boolean().optional()` — tools/list advertises the new surface
  - `case 'list'` handler passes `{include_tags, include_metadata}` options object to `engine.listVersionsForShot` (4th arg, per Plan 04-03 signature)
  - Tool `description` updated to call out inline tags+metadata on get, the new flags on list, and D-ASST-21 (tags/metadata NOT in provenance event stream)
  - `case 'get'`, `case 'diff'`, `case 'provenance'` handlers UNCHANGED
  - Dropped unused `Version` type import (now references `VersionWithAssets` only)

- **Task 3 (version-tool.test.ts)** — 8 new it() blocks across 3 new describe groups, every INV-ASST invariant at least one passing test:

  | Invariant | Describe group | Test case count |
  |-----------|---------------|-----------------|
  | INV-ASST-15 (get always hydrates ASC) | version tool — get — Phase 4 hydration | 3 (tags ASC, metadata ASC, empty arrays) |
  | INV-ASST-16 (list default omits tags) | version tool — list — Phase 4 include flags | 1 (combined with 22) |
  | INV-ASST-17 (include_tags=true adds tags) | version tool — list — Phase 4 include flags | 2 (tags-only, both-on) |
  | INV-ASST-22 (list default omits metadata) | version tool — list — Phase 4 include flags | 1 (combined with 16) |
  | INV-ASST-23 (include_metadata=true adds metadata) | version tool — list — Phase 4 include flags | 2 (metadata-only, both-on) |
  | INV-ASST-25 (provenance UNCHANGED) | version tool — provenance — Phase 4 non-regression | 1 |

  - Direct-mirror updates: local `ListInput` schema + `invokeList` helper now match production tool's Phase 4 shape; `shapeVersion` types entity as `VersionWithAssets`; `buildStack()` exposes `testDb` so fixture helpers can attach rows.
  - No existing Phase 2/3 assertion required adjustment — all 15 existing tests pass unchanged (toBe/toBeUndefined on individual fields and array maps don't intersect with the new inline keys).

## Task Commits

| Task | Name | Commit | Type |
|------|------|--------|------|
| 1 | Extend fixtures.ts with 7 Phase 4 seeding helpers | `d7092eb` | feat |
| 2 | Version tool get always hydrates, list gains include flags | `468a688` | feat |
| 3 | Add 8 Phase 4 assertions to version-tool.test.ts | `aa89b1f` | test |
| Metadata | docs: complete plan | (this commit) | docs |

## Files Created/Modified

**Created (0 files):** All Plan 05 work is additive extension to existing files.

**Modified (3 files):**
- `src/test-utils/fixtures.ts` — 30 → 318 LOC. Added DbWithClient type alias + 7 new exported helpers + module banner comment. Existing `makeInMemoryDb` function unchanged.
- `src/tools/version-tool.ts` — 209 → 232 LOC. Added VersionWithAssets import + dropped unused Version import; widened shapeVersionEntity type annotation; extended ListInput + raw inputSchema with include_tags/include_metadata; updated case 'list' handler to pass options; refreshed tool description.
- `src/tools/__tests__/version-tool.test.ts` — 383 → 558 LOC. Added 3 fixture imports; updated local ListInput + invokeList + shapeVersion; extended buildStack to expose testDb; appended 8 new it() blocks in 3 new describe groups.

## Decisions Made

- **Widened Db type at fixtures boundary**: DbWithClient = `BetterSQLite3Database<typeof schema> & { $client: SqliteClient }` added at src/test-utils/fixtures.ts top level because TagRepo + MetadataRepo constructors require the $client intersection. Narrow TestDb.db is the exported public type; DbWithClient is internal-only. Mirrors Plan 04-02 pattern (`src/store/__tests__/tag-repo.test.ts` DbWithClient local alias + cast at call site). Rule 3 blocking fix — tsc refused the narrow TestDb.db without the cast.
- **8 tests over the planned 6**: Split list-include-flags coverage into 4 cases (default both-off, include_tags only, include_metadata only, both-on) for truth-table completeness. Still hits all 6 required INV-ASST-XX invariants (15, 16, 17, 22, 23, 25). The extra two cases guard against regressions where e.g. `include_tags=true` accidentally also adds metadata (cross-flag leak) — a realistic drift risk the plan's 1-per-flag coverage would have missed.
- **No pre-check test-file audit required**: Plan Task 3 Step A said to run existing tests first and watch for `toEqual`/`toStrictEqual` failures on the entity shape. Ran the suite; 15/15 existing passed. Phase 2/3 tests used `expect(sc.entity.id).toBe(...)` / `toBeNull` / `toBe('v001')` patterns, plus `toHaveLength(5)` on arrays — no exact-equals on the full entity shape. Additive propagation of `tags`/`metadata` keys was transparent to the assertion layer.
- **buildStack() exposes testDb in addition to hierarchy/versions**: Non-breaking addition. All Phase 4 fixture helpers (`versionWithTags`, `versionWithMetadata`) accept a TestDb argument so they can construct their own repo instances against the same in-memory database the Engine reads from. Alternative (exposing just `db`) would force callers to manually handle the DbWithClient cast — centralizing in the helpers keeps test call sites clean.
- **`seedAssetFixtures` constructs its own hierarchy (distinct from stack's)**: Intentional — `seedAssetFixtures` is for tests that need a fresh workspace/project/sequence/shot chain with specific version counts + tag/metadata density, not for augmenting an existing stack's shot. For the latter, `versionWithTags` / `versionWithMetadata` compose with any existing `versionId`. Tests that want both options use both helpers in combination (as done in INV-ASST-16/22 test case).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] DbWithClient widening required at fixtures boundary for TagRepo/MetadataRepo constructor call sites**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** Initial fixtures.ts code passed `db` (narrow `BetterSQLite3Database<typeof schema>` from TestDb) directly into `new TagRepo(db, v)` and `new MetadataRepo(db, v)`. Both repo classes expect the widened Db type with `$client` intersection (per Plan 04-02). Six tsc errors across `seedAssetFixtures`, `versionWithTags`, `versionWithMetadata`, `versionsAtCap`.
- **Fix:** Added `type DbWithClient = BetterSQLite3Database<typeof schema> & { $client: SqliteClient }` at top of fixtures.ts + `import type { Database as SqliteClient } from 'better-sqlite3'`. Cast `db as DbWithClient` at the four TagRepo/MetadataRepo constructor call sites. Mirrors the exact pattern used in `src/store/__tests__/tag-repo.test.ts`.
- **Files modified:** `src/test-utils/fixtures.ts` (one-commit bundle with Task 1)
- **Verification:** `npx tsc --noEmit` exits 0; all 7 helpers compile cleanly; no leak to public TestDb surface.
- **Committed in:** `d7092eb` (Task 1 commit — bundled per Plan 04-02 precedent for widening-related fixes)

**2. [Rule 3 - Blocking] Unused `Version` type import in version-tool.ts**
- **Found during:** Task 2 post-edit grep check
- **Issue:** After widening `shapeVersionEntity` to take `VersionWithAssets`, the only remaining `Version` references in version-tool.ts were in JSDoc comments and string literals — the type was not used at the type system level. TSC allowed it (noUnusedLocals not strict on type-only imports in this config) but it's drift debt.
- **Fix:** Changed `import type { Version, Breadcrumb } from '../types/hierarchy.js'` to `import type { Breadcrumb } from '../types/hierarchy.js'`. VersionWithAssets (imported separately from types/assets.js) covers all type-level references.
- **Files modified:** `src/tools/version-tool.ts`
- **Verification:** `npx tsc --noEmit` exits 0; version-tool.test.ts passes unchanged (15/15 existing).
- **Committed in:** `468a688` (Task 2 — bundled since it's a direct consequence of the type widening)

### No other deviations

The plan's `<interfaces>` block specified exact edits — every edit matches verbatim. The 2 auto-fixed issues are both type-system adjustments: Rule 3 widening for TagRepo/MetadataRepo (known Plan 04-02 pattern) and Rule 3 import cleanup after type annotation change. Both are direct consequences of following the plan; neither required any shape change to the plan's interface or behavior.

---

**Total deviations:** 2 auto-fixed (2 blocking, 0 bugs, 0 missing critical).
**Impact on plan:** Zero shape change. Plan architecture intact: additive `include_tags`/`include_metadata` flags, VersionWithAssets typing, 7 fixture helpers, 6+ new INV-ASST assertions. Both auto-fixes closed small type-system gaps the plan's interface block did not fully specify (one is a Plan 04-02 carryover; the other a direct consequence of the widening).

## Threat-Model Verification

| Threat ID | Disposition | Mitigation verified? |
|-----------|-------------|----------------------|
| T-04-05-01 (DoS on version.list with both flags at limit=100) | accept | Default limit=20 inherited from Phase 1 D-24; MAX_PAGE_SIZE=100 cap at Zod; per-item hydration is <50ms at demo scale (RESEARCH benchmarks). Accepted per plan. |
| T-04-05-02 (information disclosure in tool description) | mitigate | Verified — description cites flag names + shape semantics only, no user data or environment values; identical pattern to version-tool.ts Phase 3 description. |
| T-04-05-03 (backward compatibility drift on version.get) | mitigate | Verified — all 15 existing Phase 2/3 tests pass unchanged; entity grows tags/metadata keys without removing or renaming any existing keys. `toBe`/`toBeUndefined`/`toHaveLength` assertions on individual fields continue to match. |
| T-04-05-04 (tags/metadata leak into provenance response) | mitigate | Verified — INV-ASST-25 regression test (new describe group "version tool — provenance — Phase 4 non-regression") JSON.stringify+regex scans the provenance response and asserts no `"tags":` or `"metadata":` keys appear. Covers both top-level and nested drift. |

## Issues Encountered

- **Pre-existing timing flakes reproduced under full-suite load:** `stdio-hygiene.test.ts` ("writes zero bytes to stdout during boot with stdin closed") and `zero-config.test.ts` ("auto-creates db with WAL + schema on first run") both failed under concurrent full-suite load (568/572). Both spawn `npx tsx src/server.ts` child processes with 1500ms SIGTERM timeouts. Verified non-regression by running them in isolation: **9/9 green** in `npx vitest run src/__tests__/stdio-hygiene.test.ts src/__tests__/zero-config.test.ts`. This is the same flake documented in Plan 04-02 (493/495), Plan 04-03 (530/531), and Plan 04-04 (562/564) summaries — not a Phase 4-05 regression.
- Hook-layer read-before-edit reminders fired repeatedly during every Edit, even though the target file had been Read at session start (fixtures.ts, version-tool.ts, version-tool.test.ts all read in the initial context-loading phase). Edits all succeeded; noted for visibility only.

## Phase 4 Closure (Plan 05 completes the phase)

Plan 05 is the final plan in Phase 4. With its completion, Phase 4 Asset Management is functionally complete:

| Success Criterion | Plan | Status |
|-------------------|------|--------|
| ASST-01 (add/remove tags on versions) | 04-02 (repo) + 04-03 (engine) + 04-04 (asset tool) + 04-05 (version.get hydration) | Complete |
| ASST-02 (add/remove metadata on versions) | 04-02 + 04-03 + 04-04 + 04-05 | Complete |
| ASST-03 (cross-hierarchy query by scope) | 04-03 (AND-only filter) + 04-04 (asset.query tool action) | Complete |
| ASST-04 (filter by tags + metadata + date range + status) | 04-03 (validator + SQL composer) + 04-04 (Zod schema + envelope) | Complete |
| ASST-05 (breadcrumb on every response) | 04-03 (queryAssets items carry breadcrumb) + 04-04 (shaper functions) + 04-05 (version.get + version.list list items) | Complete |

Phase 4 tool-budget stands at 7 of 12 (`workspace`, `project`, `sequence`, `shot`, `generation`, `version`, `asset`); remaining reserve for Phase 5 + post-v1 = 5 slots.

## Downstream Impact (Phase 5 dashboard + future)

- **Dashboard (Phase 5) agent-facing tool surface**: Stable for Phase 5 work. `version.get` always returns inline tags + metadata (dashboard version-detail views inherit this automatically). `version.list` default omits for cheap payload; dashboard UI sets `include_tags=true`/`include_metadata=true` when rendering list views that show tag chips or metadata badges.
- **Fixture extensions (7 helpers)**: Consumable by Phase 5 tests for dashboard + SSE integration scenarios. `seedAssetFixtures` is the workhorse; `hierarchyWithVersionsAcrossScopes` scopes tests to realistic multi-project data; `versionsAtCap` + `versionsWithStatusVariety` cover edge-case rendering.
- **Version-tool shape is now Phase-4-terminal**: No further edits expected. Any future Phase 5+ hydration additions (e.g., `include_outputs=true` for dashboard thumbnails) follow the same D-ASST-20 opt-in pattern.

## Next Phase Readiness

- Phase 4 complete — all 5 success criteria satisfied across Plans 01-05.
- Tool budget: 7 / 12. Remaining 5 slots for Phase 5 (likely 1-2 dashboard-specific tools if any) + post-v1 reserve.
- No blockers, no open questions, no deferred items specific to Plan 05.
- Phase 4 pre-existing concerns carried forward:
  - stdio-hygiene + zero-config timing flakes under concurrent full-suite load (pass in isolation; documented in all four prior summaries).
  - Phase 2 endpoint drift (api.comfy.org 404 / cloud.comfy.org 401) — pre-existing infrastructure issue, not Phase 4 scope.

## Self-Check: PASSED

**Files verified to exist:**
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/test-utils/fixtures.ts (318 LOC, 7 helpers)
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/tools/version-tool.ts (232 LOC, VersionWithAssets + include flags)
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/tools/__tests__/version-tool.test.ts (558 LOC, 23 tests)

**Commits verified:**
- FOUND: d7092eb (Task 1 — fixtures extensions)
- FOUND: 468a688 (Task 2 — version-tool Phase 4 hydration + flags)
- FOUND: aa89b1f (Task 3 — version-tool.test.ts Phase 4 assertions)

**Acceptance criteria grep counts:**
- `grep -c 'include_tags' src/tools/version-tool.ts` → 4 (target ≥ 3) — PASS
- `grep -c 'VersionWithAssets' src/tools/version-tool.ts` → 5 (target ≥ 2) — PASS
- `grep -c 'seedAssetFixtures' src/test-utils/fixtures.ts` → 2 (target ≥ 1) — PASS
- `grep -c 'INV-ASST-1[5-7]\|INV-ASST-2[2-3]\|INV-ASST-25' src/tools/__tests__/version-tool.test.ts` → 18 (target ≥ 5) — PASS

**Test suite verified:**
- `npx vitest run src/tools/__tests__/version-tool.test.ts` → 23/23 green (15 existing + 8 new Phase 4)
- `npx vitest run` full suite → 568 passed + 2 pre-existing flakes + 2 skipped (= 572 total); flakes pass in isolation
- `npx tsc --noEmit` → exits 0 (clean)

---

*Phase: 04-asset-management*
*Completed: 2026-04-23*
