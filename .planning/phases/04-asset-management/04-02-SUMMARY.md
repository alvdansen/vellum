---
phase: 04-asset-management
plan: 02
subsystem: data
tags: [sqlite, drizzle, repo, idempotent-upsert, json-group-array, scope-aggregation, typescript]

# Dependency graph
requires:
  - phase: 01-foundation-hierarchy
    provides: "HierarchyRepo (pre-check parent pattern), makeInMemoryDb fixture, TypedError, nanoid newId('prefix'), custom vitest toThrowTypedError matcher"
  - phase: 03-provenance-versioning
    provides: "VersionRepo (injected for pre-check), provenance-repo.ts append-only pattern reference (Phase 4 is plain CRUD opposite)"
  - plan: 04-01
    provides: "src/store/schema.ts tags + metadata sqliteTable declarations, src/types/assets.ts (Tag/MetadataEntry/MetadataKV/TagCount/ScopeFilter), src/engine/errors.ts Phase 4 codes (VERSION_NOT_FOUND reuse), src/utils/id.ts tag/meta prefixes, drizzle/0004_phase4_assets.sql applied via makeInMemoryDb"
provides:
  - "src/store/tag-repo.ts — TagRepo class with 5 methods: insertTag (idempotent INSERT ON CONFLICT DO NOTHING + fallback SELECT), deleteTag (idempotent plain DELETE), listTagsForVersion (json_group_array ASC hydration), countTagsForVersion (for engine cap D-ASST-11), listTagsInScope (scope JOIN aggregation, count DESC name ASC)"
  - "src/store/metadata-repo.ts — MetadataRepo class with 5 methods: upsertMetadata (INSERT ON CONFLICT DO UPDATE w/ excluded.value + excluded.created_at), deleteMetadata (idempotent), listMetadataForVersion (json_group_array json_object ASC), countMetadataForVersion (for engine cap), listMetadataKeysInScope (scope JOIN aggregation, distinct key counts)"
  - "src/store/__tests__/tag-repo.test.ts — 13 independent unit tests mapping INV-ASST-01/-02 + idempotency + pre-check + hydration + scope aggregation + pagination"
  - "src/store/__tests__/metadata-repo.test.ts — 13 independent unit tests mapping INV-ASST-03/-04 + upsert semantics (value refresh, created_at refresh, same id) + scope aggregation + pagination"
affects: [04-03, 04-04, 04-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-check parent pattern continues — repo constructor-injects VersionRepo (mirrors hierarchy-repo.ts:99 createProject → getWorkspace). VERSION_NOT_FOUND surfaces as a typed error; SQLITE_CONSTRAINT_FOREIGNKEY never leaks (RESEARCH Pitfall #3)."
    - "Widened Db type: drizzle()'s intersection `BetterSQLite3Database<T> & { $client: Database }` exposed at type level so repos can call raw `this.db.$client.prepare(...)` for json_group_array + scope-JOIN SQL without per-call `as any` casts. First time in project — tag-repo and metadata-repo define the pattern; future aggregation repos inherit."
    - "Idempotent mutator split: insertTag (INSERT ON CONFLICT DO NOTHING + fallback SELECT on empty RETURNING) vs upsertMetadata (INSERT ON CONFLICT DO UPDATE — always emits RETURNING row, no fallback needed). Both mutator paths are single-statement, no transaction wrapper (RESEARCH Pitfall #1)."
    - "Module-local buildScopeFragment helper: duplicated verbatim between tag-repo.ts and metadata-repo.ts per RESEARCH §'Alternatives Considered and Rejected' — repo files stay independent; no cross-repo coupling. Plan 05 can extract if complexity warrants; Phase 4 accepts the duplication."
    - "Intentional test-helper duplication: buildSmallHierarchy + buildMultiProjectHierarchy defined inline in both tag-repo.test.ts and metadata-repo.test.ts. No fixtures.ts churn in Plan 02; Plan 05 may extract."

key-files:
  created:
    - "src/store/tag-repo.ts"
    - "src/store/metadata-repo.ts"
    - "src/store/__tests__/tag-repo.test.ts"
    - "src/store/__tests__/metadata-repo.test.ts"
  modified: []

key-decisions:
  - "[Plan 04-02] Widened Db type to `BetterSQLite3Database<typeof schema> & { $client: SqliteClient }` — drizzle 0.45.2's `drizzle()` factory returns this intersection but the class declaration itself omits $client. Widening at the repo type alias keeps json_group_array + scope-JOIN SQL type-clean without per-call casts."
  - "[Plan 04-02] insertTag uses INSERT-then-fallback-SELECT rather than single SELECT-then-INSERT — preserves single-statement atomicity on first-insert path (no transaction needed per Pitfall #1); fallback SELECT only fires on duplicate path where ON CONFLICT DO NOTHING returned empty."
  - "[Plan 04-02] upsertMetadata does NOT need a fallback SELECT — unlike DO NOTHING, DO UPDATE RETURNING always emits one row (insert or update path). This is a key semantic asymmetry between the two mutator patterns."
  - "[Plan 04-02] buildScopeFragment kept module-local in both repos; no extraction to a shared helper. Matches RESEARCH §Alternatives-Rejected guidance (don't inflate hierarchy-repo with a walker); duplication is 30 lines each, easier to maintain independently."
  - "[Plan 04-02] TOCTOU race on count→compare→insert for cap enforcement is accepted at demo scale per RESEARCH Pitfall #6. Neither repo adds SERIALIZABLE locking; engine (Plan 03) does the pre-insert count+compare."
  - "[Plan 04-02] Test helpers (buildSmallHierarchy + buildMultiProjectHierarchy) duplicated between tag-repo.test.ts and metadata-repo.test.ts — intentional per plan guidance. Each test file is independently runnable."

patterns-established:
  - "Widened Db type with $client intersection for raw-SQL access — future repos doing json_group_array / scope JOINs copy this type alias verbatim."
  - "Pre-check parent via injected sibling repo: constructor(private db, private versionRepo) — VERSION_NOT_FOUND thrown before any INSERT that would FK-fail. Same shape as hierarchy-repo's PARENT_NOT_FOUND."
  - "ON CONFLICT split — DO NOTHING for plain idempotent insert (needs fallback SELECT on empty RETURNING), DO UPDATE for upsert (RETURNING always yields a row). Choice depends on whether UPDATE semantics are wanted on duplicate."

requirements-completed: []

# Metrics
duration: 10min
completed: 2026-04-23
---

# Phase 4 Plan 02: Repositories (TagRepo + MetadataRepo) Summary

**Two new repos with idempotent mutators (D-ASST-03), scope-aware aggregation (D-ASST-06), and `json_group_array` ASC-ordered hydration — zero MCP imports, zero cross-repo coupling, 26 new unit tests green and 493 suite tests pass.**

## Performance

- **Duration:** ~10 min wall-clock (started 05:34:25Z, ended 05:43:53Z)
- **Tasks:** 3 (Task 1 RED, Task 2 GREEN for TagRepo; Task 3 combined RED+GREEN for MetadataRepo)
- **Commits:** 4 atomic (1 test + 1 feat per repo — TDD ordering preserved)
- **Lines of code:**
  - `src/store/tag-repo.ts`: 234
  - `src/store/metadata-repo.ts`: 228
  - `src/store/__tests__/tag-repo.test.ts`: 292 (13 tests)
  - `src/store/__tests__/metadata-repo.test.ts`: 315 (13 tests)
  - **Total new:** 1,069 lines across 4 files
- **Full test-suite runtime:** ~19.2s (500 tests — 493 pass + 2 skipped, +26 vs Plan 01 baseline of 467)

## Accomplishments

- **TagRepo** (`src/store/tag-repo.ts`, 234 LOC) — 5 methods all matching the planner-locked API exactly:
  - `insertTag(versionId, tag): { id, inserted }` — INSERT ON CONFLICT(version_id, tag) DO NOTHING RETURNING id + fallback SELECT when RETURNING empty; `inserted=false` means duplicate (D-ASST-03 idempotent). Pre-check via `versionRepo.getVersion` → VERSION_NOT_FOUND on miss (RESEARCH Pitfall #3).
  - `deleteTag(versionId, tag): void` — plain DELETE, no pre-check (0 rows affected = idempotent no-op, INV-ASST-02).
  - `listTagsForVersion(versionId): string[]` — raw SQL `json_group_array(tag ORDER BY tag)` via `this.db.$client.prepare(...)`. Renders empty sets as `[]` not `[null]` (Pitfall #2). D-ASST-04 / D-ASST-19 ordering.
  - `countTagsForVersion(versionId): number` — Drizzle `select COUNT(*)` for engine cap (D-ASST-11 MAX_TAGS_PER_VERSION=50).
  - `listTagsInScope(scope, limit, offset): { items, total_count }` — raw SQL INNER JOIN `versions → shots → sequences → projects` via module-local `buildScopeFragment`; items ordered `count DESC, name ASC`; total_count = `COUNT(DISTINCT tag)` on same JOIN; wrapped in `db.transaction()` for snapshot consistency.

- **MetadataRepo** (`src/store/metadata-repo.ts`, 228 LOC) — 5 methods mirroring TagRepo structurally with upsert semantics:
  - `upsertMetadata(versionId, key, value): { id }` — INSERT ON CONFLICT(version_id, key) DO UPDATE SET `value=excluded.value, created_at=excluded.created_at` RETURNING id. Always returns the SAME id across upserts for a given (version_id, key) pair (INV-ASST-03). `created_at` is last-touch (D-ASST-08). Pre-check via VersionRepo.
  - `deleteMetadata(versionId, key): void` — plain DELETE (INV-ASST-04).
  - `listMetadataForVersion(versionId): MetadataKV[]` — raw SQL `json_group_array(json_object('key', key, 'value', value) ORDER BY key)` — renders empty as `[]`.
  - `countMetadataForVersion(versionId): number` — for D-ASST-11 MAX_METADATA_PER_VERSION=100 enforcement.
  - `listMetadataKeysInScope(scope, limit, offset)` — same SQL shape as `listTagsInScope` but aggregating `m.key` (D-ASST-06: count KEYS, not key+value pairs).

- **Test coverage** — 26 tests total, full traceability to business-logic invariants:

  | Invariant | Source | Test file | Test case name (excerpt) |
  |-----------|--------|-----------|-----------------|
  | INV-ASST-01 | D-ASST-03 | tag-repo.test.ts | "insertTag on an existing (version_id, tag) pair returns { id: existing, inserted: false }" + "after duplicate insertTag calls, exactly one row exists" |
  | INV-ASST-02 | D-ASST-03 | tag-repo.test.ts | "deleteTag on a missing (version_id, tag) pair returns void and throws nothing" |
  | INV-ASST-03 | D-ASST-03, D-ASST-08 | metadata-repo.test.ts | "upsertMetadata second call with same key UPDATEs value, returns same id, refreshes created_at" + "after multiple upsertMetadata calls with same (version_id, key), exactly one row exists" |
  | INV-ASST-04 | D-ASST-03 | metadata-repo.test.ts | "deleteMetadata on a missing key returns void and throws nothing" |

- **Architecture purity** — existing `src/__tests__/architecture-purity.test.ts` runs `grep -r '@modelcontextprotocol/sdk' src/store/` on every test run. Both new repos pass (7/7 purity assertions green). No cross-repo coupling: `tag-repo.ts` does not import `metadata-repo.ts` and vice versa.

## Task Commits

Each task committed atomically with TDD gate ordering preserved:

1. **Task 1 (TDD RED — TagRepo tests):** `be3d679` (test) — `test(04-02): add failing TagRepo test scaffold (13 cases, RED)`
2. **Task 2 (TDD GREEN — TagRepo impl):** `966fa24` (feat) — `feat(04-02): implement TagRepo — idempotent insert, scope aggregation, json_group_array hydration (GREEN)`
3. **Task 3a (TDD RED — MetadataRepo tests):** `26ff1f4` (test) — `test(04-02): add failing MetadataRepo test scaffold (13 cases, RED)`
4. **Task 3b (TDD GREEN — MetadataRepo impl):** `c7b36aa` (feat) — `feat(04-02): implement MetadataRepo — upsert semantics, scope aggregation (GREEN)`

## Files Created/Modified

**Created (4 files):**
- `src/store/tag-repo.ts` — TagRepo class + module-local `buildScopeFragment` helper; 234 LOC
- `src/store/metadata-repo.ts` — MetadataRepo class + duplicated `buildScopeFragment` helper; 228 LOC
- `src/store/__tests__/tag-repo.test.ts` — 13 independent unit tests (INV-ASST-01/-02 + idempotency + pre-check + [] vs [null] + scope aggregation + pagination); 292 LOC
- `src/store/__tests__/metadata-repo.test.ts` — 13 independent unit tests (INV-ASST-03/-04 + upsert semantics + same-id-across-upserts + created_at refresh + scope aggregation); 315 LOC

**Modified (none):** Plan 04-01's foundation (schema.ts, id.ts, errors.ts, shape.ts, types/assets.ts) is reused verbatim. No edits to existing Phase 1/2/3 files.

## Decisions Made

- **Widened Db type** across both repos: `BetterSQLite3Database<typeof schema> & { $client: SqliteClient }`. The class declaration in drizzle-orm 0.45.2 omits `$client`, but the factory function's return type surfaces it via intersection. Widening at the repo type alias lets raw-SQL paths (json_group_array, scope JOINs) compile cleanly without per-call casts.
- **INSERT-then-fallback-SELECT for `insertTag`** rather than SELECT-then-INSERT: preserves single-statement atomicity on the common first-write path (Pitfall #1 — ON CONFLICT + transaction can auto-rollback); fallback SELECT only fires on the duplicate path where DO NOTHING returned empty. INV-ASST-01 guarantee: second call returns the original id.
- **No fallback SELECT for `upsertMetadata`**: unlike DO NOTHING, ON CONFLICT DO UPDATE RETURNING always emits one row (insert or update path). Semantic asymmetry between the two mutator shapes is why tag-repo's pattern is not copy-pasteable to metadata-repo.
- **`buildScopeFragment` duplicated verbatim**: per RESEARCH §"Alternatives Considered and Rejected" — repo files stay independent; no shared helper module. 30 lines each, easy to edit in isolation, zero cross-repo coupling.
- **Test helpers duplicated (buildSmallHierarchy, buildMultiProjectHierarchy)**: intentional per plan guidance — tag-repo.test.ts and metadata-repo.test.ts stay independently runnable. No churn in `src/test-utils/fixtures.ts` during Plan 02.
- **`listTagsInScope` / `listMetadataKeysInScope` total_count = DISTINCT**: counts distinct tag names / distinct key names (not row counts). Matches the agent UX of "how many unique tags are in this workspace". Documented in the JSDoc.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `$client` missing from `BetterSQLite3Database<T>` TypeScript declaration**
- **Found during:** Task 2 verification (`npx tsc --noEmit`)
- **Issue:** Plan's `<interfaces>` block declared `type Db = BetterSQLite3Database<typeof schema>` and used `this.db.$client.prepare(...)` in 3 places. Runtime works (drizzle factory returns `BetterSQLite3Database & { $client: Database }` intersection), but the class declaration alone does NOT expose `$client` — tsc errored on all 3 `$client` accesses in tag-repo.ts plus 3 in the test file.
- **Fix:** Widened the `Db` type alias to `BetterSQLite3Database<typeof schema> & { $client: SqliteClient }` in both tag-repo.ts and metadata-repo.ts. Replicated in both test files as a local type `DbWithClient`. Added 1-line import `import type { Database as SqliteClient } from 'better-sqlite3'` (already a transitive dependency — no new install).
- **Files modified:** `src/store/tag-repo.ts`, `src/store/metadata-repo.ts`, `src/store/__tests__/tag-repo.test.ts`, `src/store/__tests__/metadata-repo.test.ts`
- **Verification:** `npx tsc --noEmit` exits 0; all 26 tests pass.
- **Committed in:** `966fa24` (TagRepo impl — applied to both tag-repo.ts and tag-repo.test.ts) and `c7b36aa` (MetadataRepo impl). No separate fix commit — the fix was inherent to making the tasks compile.

### No other deviations

Every locked method signature matches the plan's `<interfaces>` block exactly. Error codes (`VERSION_NOT_FOUND`), SQL patterns (ON CONFLICT DO NOTHING / DO UPDATE), hydration shape (json_group_array + json_object), scope JOIN structure, and ordering (count DESC name ASC) all follow the RESEARCH / CONTEXT locked specs.

---

**Total deviations:** 1 auto-fixed (Rule 3 — TypeScript declaration widening for `$client`).
**Impact on plan:** Zero shape change. The plan's verbatim SQL and method signatures were correct; the only adjustment was at the type-system layer to match what drizzle's factory actually returns vs. what its class alone exports.

## Threat-Model Verification

| Threat ID | Disposition | Mitigation verified? |
|-----------|-------------|----------------------|
| T-04-02-01 (SQL injection via scope JOINs) | mitigate | Verified — `buildScopeFragment` parameterizes every user-derived value via `?` placeholders + `scopeParams` array. `itemsSql` / `countSql` contain only fixed column names and JOIN clauses. No `${...}` interpolation of scope fields anywhere. |
| T-04-02-02 (raw SqliteError leak) | mitigate | Verified — `insertTag` and `upsertMetadata` pre-check via `versionRepo.getVersion` → throw `VERSION_NOT_FOUND`. For UNIQUE collisions, `onConflictDoNothing` returns empty array (no throw); `onConflictDoUpdate` returns the updated row (no throw). |
| T-04-02-03 (DoS on `json_group_array`) | accept | Documented via JSDoc — engine enforces `MAX_TAGS_PER_VERSION=50` / `MAX_METADATA_PER_VERSION=100` pre-insert. Even at caps, aggregates stay <3 KB. |
| T-04-02-04 (TOCTOU on cap) | accept | JSDoc notes the race accepted at demo scale (RESEARCH Pitfall #6). No repo-layer mitigation. |
| T-04-02-05 (scope bypass) | mitigate | Verified — `buildScopeFragment` branches in workspace → project → sequence → shot order, ignoring later fields. Engine (Plan 03) enforces XOR explicitly. |

## Issues Encountered

- Transient CI-like flake during one full-suite run: 2 unrelated tests (in `stdio-hygiene.test.ts` or `generation.test.ts` — timing-sensitive polling tests) failed once on a single invocation. Next three consecutive full runs all passed 493/493. Not a Phase 4 regression; the Phase 4 tests (26/26) passed every run. Noted for visibility only.
- Test file line count (292 + 315) exceeds the plan's ≥150 minimum by nearly 2x — the extra lines come from the interface types on `buildSmallHierarchy` and `buildMultiProjectHierarchy` (plus case 13 pagination coverage). No refactor warranted.

## Downstream Impact (Plans 03-05)

Plan 04-02's surface exports available to Plans 03-05:

- **TagRepo class** (composed by Plan 03's `src/engine/assets.ts`): insertTag, deleteTag, listTagsForVersion, countTagsForVersion, listTagsInScope.
- **MetadataRepo class** (composed by Plan 03): upsertMetadata, deleteMetadata, listMetadataForVersion, countMetadataForVersion, listMetadataKeysInScope.
- **Pre-check pattern**: Plan 03 engine will call `VersionRepo.getVersion` upstream for extended pre-cap-check (count + compare + insert) — repo's own pre-check acts as defence-in-depth.
- **Scope JOIN shape**: Plan 03's `asset.query` implementation will combine these scope-aware aggregations with the full `AssetsQueryFilter` (Pattern 3 of RESEARCH) — the buildScopeFragment shape is validated here and reusable at the engine layer.
- **Widened Db type pattern**: future repos doing aggregation or raw SQL (e.g., if Plan 03 adds a dedicated asset-query-repo) copy the `Db = BetterSQLite3Database<typeof schema> & { $client: SqliteClient }` type alias.

No blockers, no open questions carried forward.

## Next Phase Readiness

- Plan 04-03 (`src/engine/assets.ts`) is unblocked — it can inject TagRepo + MetadataRepo + VersionRepo via constructor and compose them behind the seven asset operations (addTag, removeTag, setMetadata, removeMetadata, queryAssets, listTags, listMetadataKeys) + `hydrateVersionWithAssets` helper.
- Plan 04-04 (`src/tools/asset-tool.ts`) is unblocked — Zod schema validates against `shape.ts` constants, delegates to engine methods which in turn call the repos from this plan.
- Plan 04-05 (version-tool extension + cross-cutting tests) is unblocked — `hydrateVersionWithAssets` will call `listTagsForVersion` + `listMetadataForVersion` on every version entity.

## Self-Check: PASSED

**Files verified to exist:**
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/store/tag-repo.ts (234 LOC)
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/store/metadata-repo.ts (228 LOC)
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/store/__tests__/tag-repo.test.ts (292 LOC, 13 tests)
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/store/__tests__/metadata-repo.test.ts (315 LOC, 13 tests)

**Commits verified:**
- FOUND: be3d679 (Task 1 RED — TagRepo tests)
- FOUND: 966fa24 (Task 2 GREEN — TagRepo impl)
- FOUND: 26ff1f4 (Task 3a RED — MetadataRepo tests)
- FOUND: c7b36aa (Task 3b GREEN — MetadataRepo impl)

**Architecture purity verified:**
- `grep -l '@modelcontextprotocol/sdk' src/store/tag-repo.ts` → no matches
- `grep -l '@modelcontextprotocol/sdk' src/store/metadata-repo.ts` → no matches
- `grep -l 'metadata-repo\|tag-repo' src/store/*.ts` excluding each file — no cross-repo coupling
- `architecture-purity.test.ts` → 7/7 green in full suite

**TDD gate sequence verified (plan-level type=execute, not type=tdd, but RED→GREEN order preserved per task):**
- Task 1: test commit (be3d679) precedes Task 2's feat commit (966fa24) ✓
- Task 3a: test commit (26ff1f4) precedes Task 3b's feat commit (c7b36aa) ✓

**Full suite verified:**
- `npx vitest run` → 493 passed | 2 skipped (live-smoke), 33 files all green
- `npx tsc --noEmit` → clean

---

*Phase: 04-asset-management*
*Completed: 2026-04-23*
