---
phase: 04-asset-management
plan: 03
subsystem: engine
tags: [engine, assets, validation, scope-xor, and-filter, json-each, json-group-array, pagination, hydration, typescript]

# Dependency graph
requires:
  - phase: 01-foundation-hierarchy
    provides: "BreadcrumbResolver + TypedError envelope + nanoid prefixes + shape.ts bounds constants + makeInMemoryDb fixture + custom toThrowTypedError vitest matcher"
  - phase: 02-comfyui-generation
    provides: "GenerationEngine composition pattern — Engine facade as thin delegate, internal repo wiring in constructor"
  - phase: 03-provenance-versioning
    provides: "Engine constructor signature baseline (repo, versionRepo, provenanceRepo, client?, outputRoot?), VersionRepo.getVersion/listByShot, BreadcrumbResolver.resolve('version', ...)"
  - plan: 04-01
    provides: "src/types/assets.ts (VersionWithAssets, AssetsQueryFilter, ScopeFilter, MetadataKV, TagCount), src/tools/shape.ts bounds + TAG_REGEX, src/engine/errors.ts five Phase 4 codes"
  - plan: 04-02
    provides: "TagRepo (insertTag + deleteTag + listTagsForVersion + countTagsForVersion + listTagsInScope), MetadataRepo (upsertMetadata + deleteMetadata + listMetadataForVersion + countMetadataForVersion + listMetadataKeysInScope), widened Db type pattern, pre-check parent pattern via injected VersionRepo"
provides:
  - "src/engine/assets.ts — AssetsEngine class with 7 public methods + hydrateVersionWithAssets helper + module-local validators (validateTag, validateMetadataKey, validateMetadataValue, validateScopeXor, resolvePagination, buildQuery)"
  - "src/engine/pipeline.ts — Engine facade extended: db FIRST constructor arg, 7 new asset delegate methods, getVersion always hydrates (D-ASST-19), listVersionsForShot opt-in hydration (D-ASST-20)"
  - "src/engine/__tests__/assets.test.ts — 38 unit tests covering 15 INV-ASST invariants + 7 boundary conditions; every mandatory engine-level invariant has at least one passing test"
  - "Engine constructor signature change propagated across 14 call sites (server.ts, pipeline/hierarchy/shot-naming engine tests, 5 tool tests, transport-parity/http-origin/live-smoke infra tests)"
affects: [04-04, 04-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Widened Db type pattern extended from repo layer (04-02) into engine facade: accepts narrow BaseDb publicly, casts once to $client-surfaced Db internally (this.db = db as Db). Keeps callers transparent to widening."
    - "AND-only filter SQL via json_each + HAVING COUNT (RESEARCH Pattern 1-3) — single cacheable SQL shape per optional-field-set, injection-safe by construction (user tags/metadata round-trip through SQLite's JSON parser, never concat)."
    - "Correlated-subquery hydration (RESEARCH Pattern 4) for queryAssets items — renders empty sets as [] not [null] (Pitfall #2 closed)."
    - "COUNT + paged SELECT in db.transaction() for snapshot-consistent total_count (RESEARCH Pattern 5)."
    - "Whitespace-specific hint for TAG_INVALID / METADATA_INVALID before generic regex rejection (RESEARCH Pitfall #7) — error-hint ergonomics pattern."
    - "Scope XOR at engine boundary (D-ASST-13) — future non-MCP adapters inherit the rule."
    - "Engine-layer raw-JS validation (regex + length caps + XOR + pagination defaults) as defence-in-depth with Plan 04-04 Zod."

key-files:
  created:
    - "src/engine/assets.ts"
    - "src/engine/__tests__/assets.test.ts"
  modified:
    - "src/engine/pipeline.ts"
    - "src/engine/__tests__/pipeline.test.ts"
    - "src/engine/__tests__/hierarchy.test.ts"
    - "src/engine/__tests__/shot-naming.test.ts"
    - "src/tools/__tests__/breadcrumb-always.test.ts"
    - "src/tools/__tests__/error-wrapping.test.ts"
    - "src/tools/__tests__/input-bounds.test.ts"
    - "src/tools/__tests__/generation-tool.test.ts"
    - "src/tools/__tests__/version-tool.test.ts"
    - "src/__tests__/transport-parity.test.ts"
    - "src/__tests__/http-origin.test.ts"
    - "src/comfyui/__tests__/live-smoke.test.ts"
    - "src/server.ts"

key-decisions:
  - "[Plan 04-03] Engine constructor's Db parameter uses BaseDb (narrow) public type; widened to Db (with $client) internally via `this.db = db as Db`. Callers (server.ts, 13 test harnesses) don't need to know about the widening — pattern mirrors Plan 04-02's widening at the repo boundary."
  - "[Plan 04-03] server.ts updated alongside test harnesses in Task 2 (Rule 3 blocking fix — omitting it would break `npx tsc --noEmit` green criterion). Deviates from plan guidance reserving server.ts for Plan 04, but acceptance criteria mandate clean tsc; Plan 04 still owns the asset-tool wiring in server.ts."
  - "[Plan 04-03] INV-ASST-10 ordering test controls created_at via raw UPDATE to distinct timestamps (1000/2000/3000ms), then verifies the id-DESC tiebreaker separately with all-equal timestamps. Original test relied on inserts-within-same-millisecond falling back to nanoid ordering, which is not insertion-ordered — brittle and incorrect expectation."
  - "[Plan 04-03] Setup for setMetadata cap check reads existing metadata to distinguish upsert (free) from new insert (cap-checked). Avoids rejecting upserts on an already-present key when version is at cap, while still blocking new keys beyond MAX_METADATA_PER_VERSION=100."
  - "[Plan 04-03] MetadataRepo pre-check in upsertMetadata surfaces VERSION_NOT_FOUND from the repo; engine's setMetadata cap check runs first but doesn't pre-check version existence — the repo call surfaces it. Clean division."
  - "[Plan 04-03] Architecture-purity test uses grep-based substring match, so the original JSDoc comment `Zero @modelcontextprotocol/sdk imports` in assets.ts triggered a false positive. Rewrote to `Zero MCP SDK imports (D-33...)` — same semantics, no sentinel string."

patterns-established:
  - "Engine-constructor-signature propagation pattern: when Engine constructor gains/reorders parameters, update all call sites in one commit. 14 call sites identified via `grep -rn 'new Engine(' src/`; 2 in src/__tests__/, 1 in src/server.ts, the rest in src/engine/__tests__/ + src/tools/__tests__/ + src/comfyui/__tests__/."
  - "Engine-layer raw-JS validation pattern for Phase 4+ additions: regex/length/cap/XOR checks at engine boundary; Zod defence-in-depth at tool layer. Errors use TypedError with code + message + hint."
  - "Tie-breaker-safe ordering tests: when testing a secondary sort on a non-deterministic key (nanoid), control the primary sort key explicitly and assert the secondary key separately with primary held constant."

requirements-completed: [ASST-01, ASST-02, ASST-03, ASST-04, ASST-05]

# Metrics
duration: 11min
completed: 2026-04-23
---

# Phase 4 Plan 03: AssetsEngine + Engine Facade Extension Summary

**Phase 4 core business logic landed: 7 asset operations + hydrateVersionWithAssets helper, AND-only SQL filter composition, scope XOR enforcement, inclusive date-range bounds, pagination defaults — all with zero MCP/Zod imports, 38 unit tests green, full suite at 530/531 (1 pre-existing timing flake under full-suite load).**

## Performance

- **Duration:** ~11 min wall-clock (started 2026-04-23T05:50:05Z, ended 2026-04-23T06:01:29Z)
- **Tasks:** 2 (Task 1 TDD RED, Task 2 TDD GREEN)
- **Commits:** 2 atomic (1 test + 1 feat — TDD gate ordering preserved)
- **Lines of code:**
  - `src/engine/assets.ts`: 628 (export class AssetsEngine + 6 module-local helpers)
  - `src/engine/__tests__/assets.test.ts`: 538 (38 test cases, 5 describe groups)
  - `src/engine/pipeline.ts`: 481 (was 392; +89 lines for Phase 4 imports, wiring, getVersion/listVersionsForShot hydration, 7 delegate methods)
  - **Total new/modified:** 1,166 lines in 2 new files + 13 call-site updates
- **Test suite runtime:** 38 assets tests complete in ~475ms; 114 combined engine suite in ~18.8s; full suite in ~20s

## Accomplishments

- **AssetsEngine** (`src/engine/assets.ts`) — 7 public methods matching the planner-locked API exactly, zero deviations from the `<interfaces>` block:
  - `addTag(versionId, tag)` — tag regex + cap validation (`MAX_TAGS_PER_VERSION=50`) + idempotent TagRepo.insertTag delegation
  - `removeTag(versionId, tag)` — idempotent; pre-checks version existence for the D-ASST-04 refreshed-entity contract
  - `setMetadata(versionId, key, value)` — key regex + value length + cap validation (`MAX_METADATA_PER_VERSION=100`) with upsert-aware cap (existing keys bypass cap)
  - `removeMetadata(versionId, key)` — idempotent; same pre-check as removeTag
  - `queryAssets(filter)` — RESEARCH Pattern 3 verbatim: scope JOINs, status filter, inclusive date range, tags+metadata AND via `json_each`, fixed `ORDER BY created_at DESC, id DESC`, COUNT+paged SELECT wrapped in `db.transaction()`. Every item hydrates with tags+metadata+breadcrumb (D-ASST-22/24).
  - `listTags(scope)` — scope XOR + pagination resolution + TagRepo.listTagsInScope delegation + scope echo in response
  - `listMetadataKeys(scope)` — same shape, aggregating by distinct keys
  - `hydrateVersionWithAssets(version)` — single raw-SQL query with two correlated `json_group_array` subqueries (RESEARCH Pattern 4) — empty sets render as `[]`, tags ASC, metadata ASC by key

- **Module-local validators** — pure functions, not exported from AssetsEngine:
  - `validateTag(tag)` — whitespace-specific hint path (RESEARCH Pitfall #7), length check, regex check
  - `validateMetadataKey(key)` — same shape, METADATA_INVALID code
  - `validateMetadataValue(key, value)` — non-empty, ≤ MAX_METADATA_VALUE_LENGTH=2000; value NOT interpolated into error messages (D-ASST-25 info-disclosure mitigation)
  - `validateScopeXor(scope)` — presence count check; on violation throws INVALID_SCOPE with both conflicting field names in the message
  - `resolvePagination(limit, offset)` — default 20, cap 100, offset min 0 (D-ASST-18)
  - `buildQuery(filter)` — composes two parameterized SQL strings + shared whereParams; all user input via `?` placeholders or `json_each(?)` — zero string concat

- **Engine facade** (`src/engine/pipeline.ts`) — extension matches plan shape:
  - Constructor signature: `new Engine(db, repo, versionRepo, provenanceRepo, client?, outputRoot?, options?)` — db is now the FIRST argument
  - Internal widening: accepts narrow `BaseDb` publicly, casts to widened `Db` (with `$client`) internally; TagRepo + MetadataRepo + AssetsEngine receive the widened Db
  - `getVersion` now returns `{entity: VersionWithAssets, breadcrumb: Breadcrumb}` — always hydrated (D-ASST-19)
  - `listVersionsForShot` gains 4th param `options: { include_tags?: boolean; include_metadata?: boolean } = {}` — default `{}` preserves Phase 3 payload; `include_tags && include_metadata` returns full VersionWithAssets; single-flag combos return the opt-in array only
  - 7 new one-line delegate methods: `addTag`, `removeTag`, `setMetadata`, `removeMetadata`, `queryAssets`, `listTags`, `listMetadataKeys`

- **Test coverage** — 38 tests in 5 describe groups:

  | Invariant | Test count | Source |
  |-----------|------------|--------|
  | INV-ASST-05 (tags within-field AND) | 1 | D-ASST-14 |
  | INV-ASST-06 (metadata within-field AND) | 1 | D-ASST-14 |
  | INV-ASST-07 (cross-field AND) | 1 | D-ASST-14 |
  | INV-ASST-08 (scope XOR 2+ fields → INVALID_SCOPE) | 2 (2-field, 3-field) | D-ASST-13 |
  | INV-ASST-09 (empty scope — global) | 1 | D-ASST-13 |
  | INV-ASST-10 (ordering created_at DESC, id DESC) | 1 (with tiebreak subcase) | D-ASST-16 |
  | INV-ASST-11 (date range inclusive) | 1 | D-ASST-15 |
  | INV-ASST-12 (date_from > date_to → INVALID_INPUT) | 1 | D-ASST-15 |
  | INV-ASST-13 (total_count reflects full match set) | 1 | D-ASST-18 |
  | INV-ASST-14 (listTags default limit 20, cap 100) | 2 | D-ASST-18 |
  | INV-ASST-17 (MAX_TAGS_PER_VERSION → TAG_LIMIT_EXCEEDED) | 1 | D-ASST-11, D-ASST-23 |
  | INV-ASST-18 (MAX_METADATA_PER_VERSION → METADATA_LIMIT_EXCEEDED) | 1 | D-ASST-11, D-ASST-23 |
  | INV-ASST-19 (VERSION_NOT_FOUND on mutators) | 3 (addTag, removeTag, removeMetadata) | D-ASST-24 |
  | INV-ASST-23 (tag/metadata regex + whitespace hint) | 4 (whitespace tag, regex tag, key whitespace, colon positive) | D-ASST-11 |
  | INV-ASST-24 (query always hydrates tags+metadata) | 1 | D-ASST-22 |
  | addTag/setMetadata idempotency | 2 | D-ASST-03 |
  | hydrateVersionWithAssets (empty + populated) | 2 | D-ASST-19, Pitfall #2 |
  | Boundary: 0-result, offset>total, tags>20 cap, upsert value replace, value max, empty value, project scope walk, listTags scoping | 13 | VALIDATION.md Boundary Conditions |

- **Architecture purity** — `src/engine/assets.ts` imports only from drizzle-orm, better-sqlite3, store/*, types/*, engine/errors, engine/breadcrumb, utils/outputs, tools/shape (pure constants). Zero `@modelcontextprotocol/sdk`, zero `zod`. `architecture-purity.test.ts` passes 7/7.

- **Constructor propagation** — All 14 `new Engine(...)` call sites updated to pass `db` as first arg. Every test harness that destructures `{ db }` from `makeInMemoryDb()` was already in position to prepend it; only `src/engine/__tests__/pipeline.test.ts` and `src/tools/__tests__/version-tool.test.ts` required multi-line reformatting. server.ts uses the existing `db` from `openDb(dbPath)`.

## Task Commits

Each task committed atomically with TDD gate ordering preserved:

1. **Task 1 (TDD RED — AssetsEngine tests):** `2aa2fc7` (test) — `test(04-03): add failing AssetsEngine test scaffold (38 cases, RED)`
2. **Task 2 (TDD GREEN — AssetsEngine impl + pipeline extension):** `00aace4` (feat) — `feat(04-03): land AssetsEngine + extend Engine facade — 7 asset actions + always-hydrate getVersion, opt-in listVersionsForShot (GREEN)`

## Files Created/Modified

**Created (2 files):**
- `src/engine/assets.ts` — AssetsEngine class + 6 module-local helpers; 628 LOC
- `src/engine/__tests__/assets.test.ts` — 38 unit tests in 5 describe groups; 538 LOC

**Modified (13 files):**
- `src/engine/pipeline.ts` — Engine constructor signature change, internal asset wiring, getVersion/listVersionsForShot hydration, 7 delegate methods (+89 LOC)
- `src/engine/__tests__/pipeline.test.ts` — `new Engine(` gains `db` first arg
- `src/engine/__tests__/hierarchy.test.ts` — same
- `src/engine/__tests__/shot-naming.test.ts` — same
- `src/tools/__tests__/breadcrumb-always.test.ts` — same
- `src/tools/__tests__/error-wrapping.test.ts` — same
- `src/tools/__tests__/input-bounds.test.ts` — same
- `src/tools/__tests__/generation-tool.test.ts` — same (2 call sites)
- `src/tools/__tests__/version-tool.test.ts` — same (constructor only; tool-level asset assertions are Plan 04-05's job)
- `src/__tests__/transport-parity.test.ts` — same
- `src/__tests__/http-origin.test.ts` — same
- `src/comfyui/__tests__/live-smoke.test.ts` — same (2 call sites)
- `src/server.ts` — same (prod call site; per plan guidance Plan 04's asset-tool wiring lives here too)

## Decisions Made

- **Widened Db type at engine boundary**: Engine constructor publicly accepts `BaseDb = BetterSQLite3Database<typeof schema>` (the narrow class type). Inside the constructor, `this.db = db as Db` casts once to the widened `Db = BaseDb & { $client: SqliteClient }` — the factory runtime-value has `$client` but the class declaration omits it. Same widening pattern Plan 04-02 established at the repo boundary. Keeps 14 call sites free of any type-level knowledge of the widening.
- **server.ts updated alongside test harnesses in Task 2**: The plan reserved server.ts for Plan 04 ("that's Plan 04's responsibility to wire the new tool — which also means bumping the Engine constructor call"). But the acceptance criterion `npx tsc --noEmit exits 0` required server.ts to be updated; skipping it would leave the repo non-compiling. Rule 3 blocking fix — update in same commit, Plan 04 still owns asset-tool wiring (`registerAsset` import + call).
- **INV-ASST-10 ordering test rewritten**: Original test seeded three versions in the same millisecond and expected insert-order ids, then asserted `[v3.id, v2.id, v1.id]`. But when `created_at` ties, the secondary `id DESC` kicks in, and nanoid ordering is not insertion-ordered. Rewrote with raw-SQL UPDATE to set distinct timestamps (1000/2000/3000), then asserted the created_at-DESC primary ordering. Added a second subcase with all-equal timestamps that asserts the id-DESC tiebreaker (`sorted.reverse()`). Cleanly exercises D-ASST-16's stable ordering contract.
- **setMetadata cap is upsert-aware**: The plan's `<interfaces>` block showed a simple count-check, but that would reject upsertMetadata on an already-present key when the version is at cap. Added a check for key presence via `listMetadataForVersion` — upserts on existing keys bypass the cap (they don't add a row), new-key inserts trigger METADATA_LIMIT_EXCEEDED. Small cost (one indexed read) for correct upsert semantics.
- **Architecture-purity false positive avoided**: JSDoc originally said "Zero `@modelcontextprotocol/sdk` imports (D-33, ...)". The architecture-purity test uses `grep -l '@modelcontextprotocol/sdk' src/engine/` which matches substring on any line, including comments. Rewrote to "Zero MCP SDK imports" — semantically identical, no sentinel string. This mirrors the pattern Phase 3 had to adopt when its JSDoc mentioned the SDK.
- **Whitespace-specific hint for TAG_INVALID / METADATA_INVALID**: Per RESEARCH Pitfall #7, whitespace is detected with `/\s/.test(tag)` BEFORE the generic TAG_REGEX check, emitting a distinct hint ("Tags cannot contain spaces — use underscores or dashes..."). Generic-regex rejection still fires for e.g. `$hero` with a different hint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] server.ts constructor update required for `npx tsc --noEmit` green**
- **Found during:** Task 2 verification (TypeScript compilation)
- **Issue:** Plan guidance said server.ts updates are Plan 04's responsibility. But after extending Engine's constructor signature (db FIRST), server.ts had `new Engine(repo, versionRepo, ...)` which failed type-check: `HierarchyRepo` is not assignable to `BetterSQLite3Database`. Acceptance criterion `npx tsc --noEmit exits 0` would fail without the fix.
- **Fix:** Prepended `db` to `new Engine(` call in server.ts. The plan's "Plan 04 owns server.ts" guidance applied to the asset-tool wiring (`registerAsset` import + call), not to the constructor propagation — which is a cross-cutting constructor-signature change that Plan 03 created. Updated in same Task 2 commit.
- **Files modified:** `src/server.ts` (line 183)
- **Verification:** `npx tsc --noEmit` returns exit 0 with zero output.
- **Committed in:** `00aace4` (Task 2 GREEN)

**2. [Rule 3 - Blocking] BaseDb/Db widening required for Engine constructor to accept makeInMemoryDb() fixtures**
- **Found during:** Task 2 initial tsc run (13 errors across all 14 call sites)
- **Issue:** Initial `pipeline.ts` declared `constructor(private db: Db, ...)` where `Db = BetterSQLite3Database<typeof schema> & { $client: SqliteClient }`. But `makeInMemoryDb()` returns `{ db: BetterSQLite3Database<typeof schema> }` — the class declaration omits `$client`. All 14 callers type-error: `Property '$client' is missing`.
- **Fix:** Split the type into `BaseDb` (narrow public) and `Db` (widened internal). Constructor accepts `BaseDb`; the first body line is `this.db = db as Db`. `TagRepo` + `MetadataRepo` + `AssetsEngine` receive the widened `this.db`. Zero caller changes required — 14 call sites inherit the clean behavior. Same widening convention Plan 04-02 established at the repo boundary.
- **Files modified:** `src/engine/pipeline.ts` (type alias + constructor body)
- **Verification:** `npx tsc --noEmit` exit 0; all 13 existing call sites compile unchanged.
- **Committed in:** `00aace4` (Task 2 GREEN)

**3. [Rule 1 - Bug] INV-ASST-10 ordering test asserted incorrect expectation**
- **Found during:** Task 2 test run (1 failure out of 38)
- **Issue:** Test seeded three versions in quick succession and asserted `[v3.id, v2.id, v1.id]` ordering. But when three `insertVersion` calls happen within the same millisecond, the `created_at` values collide, and the SQL falls back to the secondary `id DESC` sort — which is lexicographic nanoid DESC, not insertion-order. The test was brittle and asserted something that was never contractually guaranteed when timestamps collide.
- **Fix:** Rewrote the test to use raw SQL `UPDATE versions SET created_at = ? WHERE id = ?` to assign distinct timestamps (1000/2000/3000), then verify created_at-DESC primary ordering (`[v3, v2, v1]`). Added a second subcase with all-equal timestamps (5000) and asserted the id-DESC tiebreaker via `[v1, v2, v3].sort().reverse()`. Now cleanly exercises both the primary and secondary sort contracts from D-ASST-16.
- **Files modified:** `src/engine/__tests__/assets.test.ts` (1 test)
- **Verification:** 38/38 assets tests green.
- **Committed in:** `00aace4` (Task 2 GREEN — bundled with the main implementation commit)

**4. [Rule 1 - Bug] Architecture-purity false positive from JSDoc containing `@modelcontextprotocol/sdk` sentinel string**
- **Found during:** Task 2 full-suite run
- **Issue:** `architecture-purity.test.ts` uses `grep -r -l '@modelcontextprotocol/sdk' src/engine/` and expects 0 matches. My JSDoc comment contained the literal sentinel string ("Zero `@modelcontextprotocol/sdk` imports..."). The test reported `src/engine/` has 1 match — which was the comment, not an import.
- **Fix:** Rewrote JSDoc to "Zero MCP SDK imports (D-33, D-ASST-26, D-ASST-29) — enforced by grep-based architecture-purity.test.ts." — semantically identical, no sentinel string. The same pattern Phase 3 had to adopt when its JSDoc mentioned the SDK.
- **Files modified:** `src/engine/assets.ts` (1 JSDoc line)
- **Verification:** `grep -c '@modelcontextprotocol/sdk' src/engine/assets.ts` returns 0; architecture-purity test 7/7 green.
- **Committed in:** `00aace4` (Task 2 GREEN — bundled)

### No other deviations

Every locked method signature, SQL pattern, hydration shape, scope XOR check, date range bound, pagination default, and validation error code matches the plan's `<interfaces>` + `<must_haves>` + RESEARCH verbatim code blocks. The 4 auto-fixed issues are all low-impact and bundled into Task 2 (blocking-fix and bug-fix clauses of the deviation rules).

---

**Total deviations:** 4 auto-fixed (2 blocking, 2 bugs).
**Impact on plan:** Zero shape change. Plan architecture intact: 7 methods, correct SQL patterns, correct error codes, correct validation ordering. The auto-fixes closed small gaps in test fidelity, type-system ergonomics, and tool-compatibility that the plan's interface block did not fully specify.

## Threat-Model Verification

| Threat ID | Disposition | Mitigation verified? |
|-----------|-------------|----------------------|
| T-04-03-01 (SQL injection in buildQuery) | mitigate | Verified — every user-derived field (tags array, metadata array, scope IDs, status, dates, tag + metadata-key filter values) binds via `?` placeholder or round-trips through `json_each(?)` / `json_extract(value, '$.key')`. SQL template is a constant string; zero `${...}` interpolation of user input. |
| T-04-03-02 (scope XOR bypass) | mitigate | Verified — `validateScopeXor` counts non-empty scope fields; rejects ≥2 with INVALID_SCOPE naming the conflicting fields. 2 tests cover 2-field and 3-field violations. |
| T-04-03-03 (TypedError info leak) | mitigate | Verified — all hints cite specific identifiers (`Tag '<tag>'`, `Version '<id>'`, `Metadata key '<key>'`) without exposing the metadata value. validateMetadataValue explicitly does not interpolate the value into error messages. |
| T-04-03-04 (DoS on filter.tags/metadata unbounded arrays) | mitigate | Verified — engine rejects >20 entries in either array with INVALID_INPUT. Each tag + metadata key is re-validated by regex before query. Tool layer (Plan 04-04) caps via Zod independently. |
| T-04-03-05 (prototype pollution via metadata key) | accept (no risk) | Verified — metadata keys are TEXT column values, never used as JS object keys. `listMetadataForVersion` returns `Array<{key, value}>` objects with explicit key assignment; no `obj[key] = value` bridge. Not applicable. |
| T-04-03-06 (MAX_TAGS_PER_VERSION TOCTOU) | accept | Verified — JSDoc cites the race. Pre-insert `countTagsForVersion` runs, then idempotent `INSERT ON CONFLICT DO NOTHING` executes. Concurrent adds could both see count=49 and both insert (final count 50 — still at cap). Per CLAUDE.md demo-scale stance. |
| T-04-03-07 (DoS on large metadata value) | mitigate | Verified — `validateMetadataValue` rejects `length > 2000`. Tool Zod also caps. No DB row ever stores >2000-byte value. |
| T-04-03-08 (missing breadcrumb on asset response) | mitigate | Verified — every mutator routes through `buildMutationResponse` which attaches `breadcrumb: this.breadcrumb.resolve('version', id)`. `queryAssets` items each get `breadcrumb`. `listTags`/`listMetadataKeys` echo the scope (D-ASST-06 aggregate lists don't carry breadcrumb, but echo the scope in `response.scope`). Tests assert breadcrumb presence on INV-ASST-24 item + 5-entry length. |

## Issues Encountered

- **Pre-existing timing flake under full-suite load:** `stdio-hygiene.test.ts` ("writes zero bytes to stdout during boot") and `zero-config.test.ts` ("auto-creates db with WAL + schema on first run") both spawn `npx tsx src/server.ts` child processes with 1500ms SIGTERM timeouts. Under full-suite concurrent load these occasionally fail; in isolation they pass reliably (verified twice). Plan 04-02 SUMMARY documented the same flake ("Next three consecutive full runs all passed"). Not a Phase 4 regression — no changes to server.ts boot flow or spawn timing.
- Hook-layer read-before-edit reminders fired repeatedly during the constructor-propagation sweep even though all target files had been Read earlier in the session. The edits all succeeded regardless (per tool results). Noted for visibility — not blocking.

## Downstream Impact (Plans 04-04, 04-05)

Plan 04-03's surface exports available to Plans 04-04 and 04-05:

- **AssetsEngine 7 methods** via `engine.addTag/removeTag/setMetadata/removeMetadata/queryAssets/listTags/listMetadataKeys` — Plan 04-04 writes `src/tools/asset-tool.ts` as a thin 7-action discriminated Zod union delegating one-for-one.
- **hydrateVersionWithAssets helper** via `engine.assets.hydrateVersionWithAssets(version)` (reachable through AssetsEngine directly if wired, or via the `getVersion` / `listVersionsForShot` facade methods). Plan 04-05's `version-tool.ts` extension calls `engine.getVersion` / `engine.listVersionsForShot` — both already hydrate per the new facade contract.
- **Extended Engine.getVersion return type:** Now returns `{entity: VersionWithAssets, breadcrumb}` — Plan 04-05 updates `shapeVersionEntity` to carry the inline `tags` + `metadata` into the tool envelope.
- **Extended Engine.listVersionsForShot signature:** Now accepts `options?: {include_tags?, include_metadata?}` — Plan 04-05 passes through the Zod-validated flags from `version.list` input.
- **Mutation response shape (AssetMutationResponse):** `{entity: VersionWithAssets & {version_label}, breadcrumb: Breadcrumb}` — Plan 04-04 `asset-tool.ts` shapes via `shapeCreateOrGet(...)` or a bespoke shaper.
- **Query response shape (QueryResponse):** `{items: (VersionWithAssets & {version_label, breadcrumb})[], total_count, limit, offset}` — Plan 04-04 shapes via `shapeList(...)` or bespoke (items already carry breadcrumb as a `Breadcrumb` object, not the split `{entries, text}` pattern — the shaper flattens it).
- **TagListResponse shape** (listTags / listMetadataKeys): `{items: TagCount[], total_count, limit, offset, scope}` — Plan 04-04 shapes directly, no breadcrumb on the aggregate (D-ASST-06).

No blockers, no open questions carried forward.

## Next Phase Readiness

- **Plan 04-04 (`src/tools/asset-tool.ts`):** Unblocked. The seven-action discriminated Zod union maps 1:1 to the seven AssetsEngine methods. Input validation (regex + caps + pagination + scope presence) continues in Zod; engine layer re-validates as defence-in-depth. `registerAsset(server, engine)` wiring + server.ts import add.
- **Plan 04-05 (version-tool extension + cross-cutting):** Unblocked. `Engine.getVersion` already returns VersionWithAssets; `Engine.listVersionsForShot` already accepts include flags. Plan 04-05 updates `shapeVersionEntity` to surface tags + metadata in `structuredContent`, updates `version.list` Zod schema with `include_tags?` / `include_metadata?` booleans, adds 6 new test assertions (INV-ASST-15, 16, 17, 22, 23, 25).

## Self-Check: PASSED

**Files verified to exist:**
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/engine/assets.ts (628 LOC)
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/engine/__tests__/assets.test.ts (538 LOC, 38 tests)
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/engine/pipeline.ts (481 LOC — was 392)

**Commits verified:**
- FOUND: 2aa2fc7 (Task 1 RED — AssetsEngine tests)
- FOUND: 00aace4 (Task 2 GREEN — AssetsEngine impl + pipeline extension)

**Architecture purity verified:**
- `grep -c '@modelcontextprotocol/sdk' src/engine/assets.ts` → 0
- `grep -rn '@modelcontextprotocol/sdk' src/engine/` → no matches
- `architecture-purity.test.ts` → 7/7 green

**TDD gate sequence verified (plan-level type=execute, RED → GREEN order preserved):**
- Task 1: test commit (2aa2fc7) precedes Task 2's feat commit (00aace4) ✓

**Test suite verified:**
- `npx vitest run src/engine/__tests__/assets.test.ts` → 38/38 passed
- `npx vitest run src/engine/__tests__/assets.test.ts src/engine/__tests__/pipeline.test.ts src/engine/__tests__/generation.test.ts src/engine/__tests__/hierarchy.test.ts` → 114/114 passed (core engine suite)
- Full suite: 530/531 (1 flaky stdio-hygiene or zero-config test under load — pre-existing, documented in Plan 04-02)
- `npx tsc --noEmit` → clean

**Constructor propagation verified:**
- `grep -rn 'new Engine(' src/ --include="*.ts"` → 14 call sites, all pass `db` as first arg

---

*Phase: 04-asset-management*
*Completed: 2026-04-23*
