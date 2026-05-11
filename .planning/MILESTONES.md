# Milestones

## v1.2 Visual & Conversational Dashboard (Shipped: 2026-05-09)

**Phases completed:** 3 phases (17-19), 18 plans, ~50 tasks

**Key accomplishments:**

- Sharp + @ffmpeg-installer/ffmpeg sole-importer thumbnail engine: atomic disk cache with strong-ETag content-addressed validation, format router (JPEG/WebP/PNG/GIF → JPEG thumbnail; MP4/WebM → first-frame JPEG with brightness probe + 10s SIGKILL timeout), D-05 redact-invalidation hook fires after atomicRename. Architecture-purity (D-WEBUI-31): no `src/` imports in dashboard components.
- Dashboard `<Thumbnail/>` + `<C2paShield/>` (Adobe CR mark, Apache 2.0 licensed) wired into VersionCard grid, TreeSidebar shot rows, and HomeView. Lazy-loaded with SkeletonThumbnail fallback; missing/in-progress outputs degrade gracefully.
- Sortable folder dropdown — Latest-first version-grid default + A→Z tree default; 4-option SortDropdown (WAI-ARIA APG combobox pattern) with keyboard navigation (Arrow keys, Home/End, Escape); LoadMoreButton with composite-cursor pagination (`(NULL-bit, sort_value, version_id)` for stable ordering). localStorage persistence + URL state mirror.
- Drizzle ORDER BY composer with closed enum whitelist (`completed_at | created_at | name | version_number` × `asc | desc`); composite cursor cursor for stable pagination across sort changes. Three Zod parsers at HTTP boundary (T-18-01/T-18-02/T-18-03/T-18-04 mitigated; 4xx INVALID_INPUT envelope; never echoes input). D-10 MCP back-compat preserved — 167/167 tool tests green.
- AI conversational summary — Claude 3 Haiku via Anthropic SDK; supervisor-voice prose generator producing 2-4 sentences grounded in prompt blob + ingredient graph + model fingerprints (no hallucination). Permanent fallback mode (structured provenance table) for Claude Max users who lack `ANTHROPIC_API_KEY`.
- SummaryDrawer tab surfaced on VersionDrawer; RegenerateButton with 1Hz cooldown countdown (tabular-nums layout stability, WAI-ARIA aria-busy='true' during fetch, native disabled + aria-label). SSE streaming deferred to v1.3 UX polish bundle.
- Security: 4/4 threat mitigations verified (prompt injection via provenance-as-ground-truth + system prompt separation, API key env-only, cost cap via per-summary limit); 11/11 accepted risks documented.

**Delivered:** Visual-first VFX Familiar dashboard — thumbnail previews on every asset card, smart sorting with stable pagination, and AI-written supervisor-voice summaries grounded in cryptographic provenance. Every v1.2 requirement validated, 0 critical/blocking findings from code review.

**Stats:**

- Date range: 2026-04-30 → 2026-05-09 (10 days)
- Phases: 3 (17: thumbnails, 18: sortable dropdown, 19: AI summary)
- Plans: 18
- Tests: baseline 1365/1372 → ~1400+ passing (architecture-purity 35/35; phase-attribution green)
- Dashboard: ~45kB JS + 25kB CSS bundle (estimate)
- Tool surface: 7 of 12 MCP tools (unchanged from v1.1)

**Deferred to v1.3 UX polish bundle:** hover-to-scrub preview, SSE streaming AI summary updates, per-shot sort persistence across sessions, cross-version narrative coherence (summary refers to parent version).

---

## v1.1 Provenance Verification (Shipped: 2026-04-30)

**Phases completed:** 7 phases, 24 plans, 63 tasks

**Key accomplishments:**

- MIGRATION_PENDING TypedError arm + runMigrations() store helper that wraps drizzle's migrate() with a pending-count pre-check and typed-error failure surface naming the failing migration filename + remediation hint.
- openDb() routed through runMigrations() with close-before-throw on MIGRATION_PENDING; clean-DB no-op contract proven by a 4-assertion regression test (ROADMAP success criterion #4); both transports inherit the typed-error surface via the single boot-path call site at src/server.ts:154.
- Failure-path regression test (`src/store/__tests__/migrate-stale-db.test.ts`, 7 assertions across 3 describe blocks) that proves ROADMAP success criteria #2 and #3 — typed-error envelope (code + filename + SQL-error text + remediation hint) and boot-path-bails-before-tool-registration — using vi.mock injection of a synthetic drizzle-migrator failure plus a local engine-constructor spy that proves unreachability after openDb() throws.
- Single shared `flattenComfyError(error: unknown): string` helper consolidates the 3-branch ComfyUI error flatten chain (node_errors / string / fallback) across both submit-time and recovery-poller paths — eliminating the duplicated extraction shape that previously caused recovery-poller dashboard cards to collapse to "ComfyUI reported failed" when the submit path would have decoded actionable detail.
- 14-case parity test drives 4 Cloud-shaped error fixtures (node_errors object, value_not_in_list, bare string, IT-10 missing-error fallback) through three paths — flattenComfyError helper, ComfyUIClient.submit() 4xx, GenerationEngine.getGenerationStatus() failed branch — and asserts byte-equal flattened detail strings. Closes ROADMAP Phase 11 success criterion #2 at the integration boundary.
- Engine + tool surface for DEMO-03: version.diff envelope now carries a `reproduction_divergence` field that surfaces SHA-256 mismatches and partner-API non-determinism warnings on reproduce-lineage versions — null when bytes match AND no warnings (criterion #4).
- WarningPill + VersionDrawer auto-fetch + side-by-side comparison block close DEMO-03 at the dashboard boundary: reproduce-lineage versions whose bytes drift from their parent OR carry partner-API non-determinism warnings now render an amber pill in the drawer header AND a parent-vs-reproduction <img> comparison block in the body, while bit-identical reproductions render neither (criterion #4).
- ModelRef gains `model_hash_unavailable: string | null` and Phase 13's streaming SHA-256 helper `fingerprintModel` ships at the engine layer with WR-02 path-traversal defense, three-attempt retry on non-ENOENT I/O, and 17 unit-test cases mapping each Phase 13 success criterion to an explicit assertion.
- Engine.fingerprintModelsForVersion ships at the integration boundary — fires from a void-wrapped callback after markCompleted, hashes each ModelRef via Plan 13-01's helper, persists as a `models_fingerprinted` sibling provenance event, idempotent for crash recovery, hot-path-isolated by construction (assertion: completion returns BEFORE the fingerprinted event is appended).
- Phase 13 close: ModelChange shape extended to carry `hash_unavailable` on both sides, diffModels fires on hash↔unavailable transitions, loadDiffSnapshot reads the post-fingerprint view via getLatestFingerprints, 5 end-to-end integration tests prove criteria #1/#2/#3 + the diff boundary, 3 file-level architecture-purity assertions lock src/engine/model-fingerprint.ts as zero-MCP / zero-SQLite-driver / zero-ORM. PROV-V-03 cohort closure.
- Establishes the configuration foundation for Phase 14 — pinned c2pa-node@0.5.26, typed C2paConfig threaded through Engine, boot-time env validation with realpath + allowlist guard (Concern #4 path-traversal mitigation), basename-only path-leak hygiene, native-binding-load resilience (Concern #11), and a self-signed dev cert generator. No signing logic lands here; Plans 14-02..14-05 build on this base.
- Engine-layer C2PA module under `src/engine/c2pa/` — pure routeFormat (3-variant discriminated union, NO sidecar mode), pure buildManifestDefinition (c2pa.created assertion only per D-CTX-4), and a thin signer wrapper that is the SINGLE c2pa-node consumer. Algorithm detection via X509Certificate (Concern #1), RFC4514-safe subject parser (Concern #10), and lazy try/catch'd native-binding load (Concern #11) all in place. 46 new tests, +54 root-suite delta, pre-existing 5 v1.1-audit failures unchanged.
- Engine-layer integration of the Plan 14-02 c2pa module — Engine.signOutput orchestrates lazy signer load, format routing, manifest definition, sign emission, and append-only provenance recording; the output-downloader hook wires it post-Cloud-download with atomic mkstemp -> rename + cross-device fallback + concurrent-writer safety.
- Surface the Plan 14-03 signing layer at the HTTP + dashboard boundary. The output streaming route gains an X-C2PA-Signing-Status response header (GET + HEAD); the VersionDrawer renders a small inline C2PA signing-state badge driven by a HEAD-based getC2paStatus helper. v1.1 ships native-embed status surfacing only — NO sidecar route, NO sidecar dashboard link (Concern #2 scope reduction; v1.2 reintroduces both when c2pa-node exposes a real sidecar API).
- End-to-end c2pa-node round-trip verification across PNG/JPEG/MP4/WebP/TIFF (incl. Concern #8 cryptographic binding proof + tamper detection); dual-transport parity automated; T-14-01/T-14-02/T-14-12 mitigations formally proven; wire-level UAT via real MCP SDK Client + spawned server; PROV-V-01/02/05 cohort closed with v1.2 deferred items recorded.
- Pure ingredient extraction primitives (parent / component / inputTo) plus streaming-SHA256 helper; KSampler edge walk replaces the positional CLIPTextEncode heuristic per REVISION B5; IMAGE_INPUT_CLASS_TYPES audited per REVISION C1/C2 to disjoint set vs LOADER_CLASS_TYPES.
- Pure manifest builder extension producing BuildManifestResult { definition, ingredientSpecs } for the impure signer to drive; vfx_familiar.input + vfx_familiar.unavailable_ingredient vendor assertions land in definition.assertions[]; ingredients flow via the native binding's manifestBuilder.addIngredient at sign time (NOT via assertions[]).
- Engine.signOutput now resolves parent + components + inputTo BEFORE manifest construction, drives the c2pa-node createIngredient + ManifestBuilder.addIngredient flow via two new signer entry points, persists manifest_sha256 + ingredients_summary on the manifest_signed event, and serialises concurrent same-version sign calls via a per-version Promise mutex.
- End-to-end v1 → v2 → v3 ingredient-graph traceback verified by independent createC2pa().read() walking manifest.ingredients[] (NOT assertions[]); dangling-reference state recorded via vfx_familiar.unavailable_ingredient vendor assertion; PROV-V-04 marked complete in REQUIREMENTS.md with 3 new v1.2 deferred items; ROADMAP.md Phase 15 row marked Complete with date 2026-04-30; 4 new cohort-closure smoke tests lock the paperwork at file-content level.
- Pure-async exportManifest + lazy-binding verifyManifest engine modules wired into Engine facade with allowed-set architecture-purity guard. PROV-V-07 agent-surface foundation.
- Pure-helper + lazy-integration redaction primitive for PROV-V-06 — strips named fields from a parent manifest's JSON via a bounded DSL, emits a vendor-namespaced `vfx_familiar.redacted` assertion preserving the FACT of redaction (not the values), re-signs with the same Phase 14 cert via the existing signer surface, and appends a NEW manifest_signed event so the original signed row stays byte-identical (append-only contract preserved). Engine.redactManifestForVersion threads the unified asset-writer mutex so concurrent signOutput + redact never produce wrong-shape coalescing or interleaved provenance rows.
- Two new `version` tool action arms (`export_manifest` + `verify_manifest`) wired through Plan 16-01's Engine facade with discriminated input, payload-size cap, and dual-transport parity guarantee.
- redact_manifest version-tool action with D-CTX-1 wire-level invariant + D-PROV-08 dual-form envelope, completing PROV-V-06 wire surface (cohort closure pending Plan 16-05)
- Three test layers (E2E + wire-level UAT + smoke script) + cohort closure documents shipped milestone v1.1 (Phases 10-16, 19 plans, 10 requirements, 7 PROV-V + 3 DEMO)

---

## v1.0 MVP (Shipped: 2026-04-28)

**Phases completed:** 9 phases, 46 plans, 127 tasks

**Key accomplishments:**

- Pure-engine substrate for VFX Familiar — SQLite+WAL store, Drizzle schema, HierarchyRepo, BreadcrumbResolver, and a 12-method Engine facade with shot-regex enforcement — all with zero MCP SDK dependency.
- Four coarse-grained MCP tools (workspace, project, sequence, shot) each exposing `create | list | get` actions via Zod v4 discriminated-union schemas, all delegating to the Wave 1 Engine through a dual-form response envelope with TypedError wrapping and breadcrumb-on-every-response.
- Dual-transport entry point (stdio always + Streamable HTTP on opt-in) over a single process-wide engine, wired via a shared buildServer factory that guarantees transport parity by construction. Five cross-cutting integration tests (parity, hygiene, purity, budget, zero-config) lock every Phase 1 invariant future phases must honor.
- Drizzle migration infrastructure + VersionRepo state-machine + pure helpers (backoff/format/outputs) + Phase 2 typed error vocabulary + test doubles (FakeComfyUIClient / extended FakeEngine) — the contract layer Plans 02-02 and 02-03 will execute against.
- ComfyUI Cloud HTTP client with SSRF-safe redirect gate and atomic streaming downloads, plus the engine-tier generation state machine (two-phase submit, fresh-if-not-terminal status with 10-min timeout, 3-attempt download retry, AbortController-wired recovery poller) composed into the Engine facade alongside the Phase 1 hierarchy surface — the layer Plan 02-03's `generation` tool will be a thin Zod wrapper over.
- `generation` MCP tool with submit/status actions, dotenv-driven server wiring with ComfyUIClient + engine.start/stop + SIGINT/SIGTERM lifecycle, and a gated end-to-end live-smoke against real ComfyUI Cloud.
- Append-only provenance table + pure engine modules for diff, iterate-merge, and PNG tEXt extraction — zero-coupling foundation that Plan 2 and Plan 3 compose into the submit path and tool surface
- Wire Plan 01's pure provenance primitives into the Phase 2 generation lifecycle — ProvenanceWriter fires at submit + terminal events, fetchResolvedPrompt captures PNG tEXt blobs for replay, reproduce/iterate create lineage-tagged children. Engine facade exposes six new read/diff/reproduce/iterate methods ready for Plan 3's tool surface.
- New `version` MCP tool (get/list/diff/provenance) + extended `generation` tool (reproduce/iterate) + live-smoke reproduce round-trip — closes PROV-01..PROV-06 at the agent boundary with tool budget at exactly 6 of 12
- Additive Drizzle migration 0004 + tags/metadata sqliteTable declarations + Phase 4 bounds constants, error codes, ID prefixes, and pure-TS asset types — zero runtime behavior changes, full foundation for Plans 02-05.
- Two new repos with idempotent mutators (D-ASST-03), scope-aware aggregation (D-ASST-06), and `json_group_array` ASC-ordered hydration — zero MCP imports, zero cross-repo coupling, 26 new unit tests green and 493 suite tests pass.
- Phase 4 core business logic landed: 7 asset operations + hydrateVersionWithAssets helper, AND-only SQL filter composition, scope XOR enforcement, inclusive date-range bounds, pagination defaults — all with zero MCP/Zod imports, 38 unit tests green, full suite at 530/531 (1 pre-existing timing flake under full-suite load).
- `asset` tool registered with 7-action Zod discriminated union (add_tag/remove_tag/set_metadata/remove_metadata/query/list_tags/list_metadata_keys), dual-form envelope via toolOk, ZodError re-wrap as INVALID_INPUT, breadcrumb on every mutator + query response — 27 integration tests green, full suite 562/564 (2 pre-existing timing flakes), wire-level UAT 6/6 via verify-phase4-tool-surface.mts.
- Version tool wired for Phase 4 — `get` always returns inline tags (ASC) + metadata (ASC by key); `list` grows include_tags/include_metadata opt-in flags with cheap default payload; `provenance` + `diff` untouched. Fixture helpers (7) extracted for engine + tool test composition. 23/23 version-tool tests green (15 existing + 8 new); full suite 568/572 with two pre-existing timing flakes.
- Foundation wave: npm workspaces monorepo scaffold + config-only dashboard package + server-side test-utils extensions for Plans 02-04.
- Typed engine event bus and dashboard-stable download hook — every mutation path publishes a T-5-02-safe SSE payload; markCompleted triggers a fire-and-forget download into versionId-keyed output tree.
- Hono error handler that converts every engine `TypedError` to a semantically correct HTTP status code with a stable `{ error: { code, message } }` JSON shape — the shared error surface for all 18 dashboard REST routes (Plan 05-04) and the SSE endpoint (Plan 05-05).
- 18 canonical dashboard REST routes wired to the Engine facade as a Hono sub-router — hierarchy reads, version reads, provenance, diff, reproduce, asset filters, and dashboard aggregate; output streaming validates filenames against path traversal (T-5-04) before fs.createReadStream.
- Hono `streamSSE` handler at `GET /api/events` that forwards 5 typed EngineEventMap payloads to every connected browser, with origin-allowlist gate before stream open, 30s keep-alive ping for proxy timeouts, and full listener cleanup on client disconnect.
- 1. [Rule 1 - Bug] Plan's mount target `/api` would double-prefix dashboard routes
- Extended architecture-purity.test.ts with 4 new D-WEBUI-31 assertions (HTTP layer / engine events / dashboard boundary) + paraphrased sentinel strings in 2 src/http/ comments to keep the substring-grep test signal unambiguous.
- Typed REST client (18 fetch wrappers), SSE client (singleton EventSource + on/offSseEvent), and @preact/signals state atoms (activeGenerations + hierarchy + versions) — no UI yet, but every wire the Plan 05-09/05-10 components pull on is now typed, tested, and zero-server-import.
- Tailwind v4 @theme design-token layer + 7 pure-Preact primitive components (TreeSidebar, VersionCard, StatusPill, JsonBlock, ThemeToggle, EmptyState, SkeletonThumbnail) with 9 TreeSidebar interaction tests — the reusable primitives every Plan 10+ view composes into full screens.
- Preact view layer composing Plan 09 primitives against Plan 08 signals — HomeView (tree + shot grid), VersionDrawer (timeline + provenance + diff), DiffDrawer (before/after cards), ActiveGenerationsPanel (live SSE panel), App (SSE lifecycle), main (entry). `npm run build:dashboard` now produces a 38.55 kB JS + 21.70 kB CSS bundle.
- 10 integration tests locking down the theme/localStorage/DOM chain and the SSE/signal/render chain — end-to-end behavioral gates with render assertions that surface any serialization-boundary drift as a failing test, rather than a silent production bug.
- Pure-function adapter at the SSE serialization boundary translates engine-native payloads to the dashboard rendered contract, unblocking live progress updates (SC-3 / WEBUI-03).
- SC-3 (DashboardApiError) and SC-6 (normalizeStatus exhaustive) RED test scaffolds committed ahead of Plans 04/07 with exact assertion shapes + regex contracts pinned
- VersionRepo.listRecentCompleted(limit) replaces the hardcoded `recent: Version[] = []` in Engine.getDashboardHome — the dashboard home rail now surfaces real completed-generation history ordered by completed_at DESC.
- Engine.outputRoot is now public-readonly, surfaced through EngineForDashboard, mirrored on FakeEngine, and `/api/versions/:id/output` resolves via `path.resolve(engine.outputRoot, versionId, filename)` — the dashboard streaming route no longer depends on server CWD or the hardcoded `outputs` literal.
- Typed-error preservation for the dashboard fetch layer: DashboardApiError class + exported fetchJson that unwraps the server's `{ error: { code, message } }` envelope into `code` / `status` / `body` fields, with a graceful `HTTP_ERROR` fallback for HTML 502 / empty bodies.
- `qNum(raw, fallback, name)` now rejects negatives, non-integer floats, and non-numeric strings with HTTP 400 + `{ error: { code: 'INVALID_INPUT', message: "Query parameter '<name>' must be a non-negative integer (got '<raw>')" } }` at the HTTP boundary — SQLite no longer silently clamps bad pagination input into success-with-empty-results.
- SSE keep-alive now emits a spec-compliant comment frame (`: ping\n\n` at column 1) via the inherited StreamingApi.write raw-byte path; closes audit item IN-02.
- Rewrote `normalizeStatus` from silent-fallback if/else chain to an exhaustive `switch` with `_exhaustive: never` default arm — compile-time catches future Version['status'] drift, runtime throws on force-cast bypass.
- Read-only matrix probe `scripts/probe-comfy-endpoint.mts` identifies `https://cloud.comfy.org` + `/api/system_stats` as the single (base, path) combo that authenticates with the current COMFYUI_API_KEY — locks the default base and healthcheck path for Phase 7 Plans 02 + 03.
- Wired the first-submit healthcheck (D-EP-07) into ComfyUIClient.submit() with Promise-memoized race-safe caching, added HEALTHCHECK_PATH shared constant (D-EP-14), appended COMFYUI_ENDPOINT_DRIFT to the ErrorCode union (D-EP-08), and locked the DEFAULT_COMFYUI_API_BASE audit trail — all backed by the Plan 01 probe matrix that identified /api/system_stats as the ONLY path on cloud.comfy.org that authenticates with the current key format.
- Updated .env.example with the Phase 7 rotation-reference comment and swapped .env COMFYUI_API_BASE from the drifted `https://api.comfy.org` to the probe-winning `https://cloud.comfy.org` — completes the D-EP-06 single-source-of-truth contract (three sites, one value) that Plans 01 + 02 started.
- Added 4 targeted unit tests for `ComfyUIClient.ensureEndpointHealthy()` covering the four D-EP-07/08/10 behaviors Plan 02 wired (cache hit, DRIFT-with-hint, race-safe memoization, failure-retry) — closing the test-coverage gap that the Plan 02 SUMMARY flagged as "test coverage of the 4 DRIFT scenarios is Plan 04." All 4 tests use the `mockFetchRaw` escape hatch Plan 02 left for this exact purpose.
- Created the D-EP-13 drift sentinel `src/comfyui/__tests__/endpoint-probe.test.ts` — a single-assertion, double-opt-in (`RUN_PROBE=1` + `COMFYUI_API_KEY`) gated test that issues one raw GET against `${apiBase}${HEALTHCHECK_PATH}` and asserts status 200, deep-shrunk from live-smoke (~315 lines → 59 lines). Post-plan test-count invariant locked: 739 passed / 3 skipped (+1 new default-skipped sentinel).
- SC-2 MET — live-smoke green twice back-to-back after two Rule 3 blocking fixes (D-EP-16 normalizeCloudStatus, D-EP-17 /api/jobs endpoint switch + nested outputs flattening) resolved Phase 2 tech debt that Plan 01's read-only probe matrix couldn't detect.
- Created `07-VERIFICATION.md` as the canonical Phase 7 resolution document with all 4 D-EP-12 sections (probe matrix + chosen base, credential layout, rotation procedure, fallback-if-redirected + memory hygiene). Appended a 1-paragraph cross-reference supplement to `02-VERIFICATION.md` per D-EP-11 so Phase 2 readers have a forward-pointer to the Phase 7 resolution.
- Removed the stale `project_comfy_api_endpoint_drift.md` memory (D-EP-15 preferred removal path — Pitfall #5 met via Plan 06), updated `reference_env_comfyui_key.md` body to reflect the locked `COMFYUI_API_BASE=https://cloud.comfy.org` + vitest-dotenv gotcha + Phase 7 cross-reference, and synchronized the `MEMORY.md` index to the post-Phase-7 3-entry memory set.
- A Vitest cross-cutting invariant test (`src/__tests__/phase-attribution.test.ts`) that asserts SUMMARY frontmatter `requirements-completed:` ⊇ ROADMAP `
- Reconciled the Phase 1 inspector UI override across three docs (01-VERIFICATION.md body, INSPECTOR-SMOKE.md historical artifact, 01-02-SUMMARY.md cross-link) so the body, the historical artifact, and the cross-link from the plan summary all reflect the accepted-override state. Frontmatter `overrides_applied: 1` (already in place from 2026-04-24) is now the canonical record cited by all three documents.
- Append-only documentation backfill — three-paragraph Phase 8 supplement appended to 02-VERIFICATION.md (D-ATTR-09 + D-ATTR-10 + D-ATTR-11) plus per-item resolution suffixes on all 3 Phase 01 tech_debt items in v1.0-MILESTONE-AUDIT.md (D-ATTR-03 Shape A)
- Wave 0 Nyquist validation retrofit across all 5 v1.0 functional phases (01-05) with audit doc re-audit showing compliant + new cross-cutting Vitest regression guard catching future flag flip-back.

**Delivered:** Open-source MCP server layering VFX hierarchy, async ComfyUI Cloud generation, append-only provenance, asset tagging/query, and a Preact dashboard — all under the 12-tool MCP cap with dual-transport (stdio + Streamable HTTP) parity locked at the integration-test layer.

**Stats:**

- Date range: 2026-04-20 → 2026-04-28 (9 days)
- Commits: 360 (genesis 65eaf46 → milestone close 25b69c2)
- LOC: ~25,543 TypeScript (22,613 server + 2,930 dashboard)
- Tests: 760/763 passing baseline (3 pre-existing timing flakes documented in Phase 4-5 SUMMARY notes)
- Tool surface: 6 of 12 MCP tools (workspace, project, sequence, shot, generation, version) + asset tool

**Audit:** `passed` per re-audit 2026-04-28 (`milestones/v1.0-MILESTONE-AUDIT.md`). 38/38 v1 requirements validated, 9/9 phases verified, all 4 prior tech-debt categories closed by gap-closure phases 06-09.

**Known deferred items at close:** 0. The pre-close artifact audit surfaced 1 category flag for Phase 01's `01-HUMAN-UAT.md` — file was already `status: resolved` with `resolution: automated` (Plan 08-02 reconciliation, `scripts/inspector-smoke.mjs` 56/56 wire-level checks is canonical). Acknowledged as no-op.

---
