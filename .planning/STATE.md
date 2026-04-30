---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Provenance Verification
status: verifying
stopped_at: Completed 16-04-PLAN.md
last_updated: "2026-04-30T20:38:08.710Z"
last_activity: 2026-04-30
progress:
  total_phases: 7
  completed_phases: 7
  total_plans: 24
  completed_plans: 24
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-29 after v1.1 milestone start)

**Core value:** A VFX artist tells their AI familiar what they need in natural language, and it manages the entire production pipeline -- routing, versioning, provenance, organization -- so they never touch a folder structure or lose track of what generated what.
**Current focus:** Phase 16 — Redaction & Agent Surface

## Current Position

Phase: 16 (Redaction & Agent Surface) — EXECUTING
Plan: 5 of 5
Status: Phase complete — ready for verification
Last activity: 2026-04-30

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 33 (v1.0 baseline)
- Average duration: --
- Total execution time: 0 hours

**By Phase (v1.0 archive):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | - | - |
| 02 | 3 | - | - |
| 03 | 3 | - | - |
| 04 | 5 | - | - |
| 06 | 7 | - | - |
| 07 | 8 | - | - |
| 08 | 3 | - | - |
| 09 | 1 | - | - |

**Recent Trend:**

- Last 5 plans: --
- Trend: -- (v1.1 plans pending)

*Updated after each plan completion*
| Phase 10 P01 | 6min | 2 tasks | 3 files |
| Phase 10 P02 | 3min | 2 tasks | 3 files |
| Phase 10 P03 | 2min | 1 tasks | 1 files |
| Phase 11 P01 | 5min | 2 tasks | 4 files |
| Phase 11 P02 | 6min | 2 tasks | 2 files |
| Phase 12 P01 | 17min | 3 tasks | 17 files |
| Phase 12 P02 | 6min | 2 tasks | 5 files |
| Phase 13 P01 | 7min | 3 tasks | 6 files |
| Phase 13 P02 | 7min | 2 tasks | 7 files |
| Phase 13 P03 | 6min | 2 tasks | 5 files |
| Phase 14 P01 | 9min | 4 tasks | 12 files |
| Phase Phase 14 PP02 | 19min | 4 tasks | 11 files |
| Phase 14 P03 | 18min | 3 tasks tasks | 12 files files |
| Phase 14 P04 | 11 | 2 tasks tasks | 10 files files |
| Phase 14 P05 | 22min | 5 tasks tasks | 10 files files |
| Phase 15 P01 | 19min | 4 tasks | 7 files |
| Phase 15 PP02 | 9min | 2 tasks | 3 files |
| Phase 15 P03 | 22min | 5 tasks | 9 files |
| Phase 15 P04 | 13min | 5 tasks | 5 files |
| Phase 16 P01 | 13min | 3 tasks | 9 files |
| Phase 16 P03 | 11min | 2 tasks | 3 files |
| Phase 16 P02 | 80min | - tasks | - files |
| Phase 16 P02 | 80min | 2 tasks | 9 files |
| Phase Phase 16 PP04 | 14min | 2 tasks tasks | 3 files files |
| Phase 16 P05 | 22min | 4 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap v1.1]: 7 phases (10-16) derived from 10 requirements; DEMO-01/02/03 placed first as independent infrastructure (Phases 10-12), C2PA chain forms Phases 13→14→15→16 with strict dependency order (fingerprints → manifest scaffolding → ingredient graph → redaction + agent surface).
- [Roadmap v1.1]: PROV-V-07 (`version.export_manifest` / `version.verify_manifest`) implemented as new actions on the existing `version` tool — tool budget stays at 6 of 12, no new top-level tool.
- [Roadmap v1.1]: PROV-V-01 + PROV-V-02 + PROV-V-05 grouped into Phase 14 (single embed/sidecar emission surface); splitting them across phases would force two manifest-emission code paths.
- [Roadmap v1.1]: Phase 10 sequenced first because every subsequent phase touches `models_json` shape, manifest fields, or new tables — migrate-on-boot guarantee removes a class of integration failures.
- [v1.0 Roadmap, archived]: 5 v1 phases derived from 7 requirement categories; TOOL requirements folded into Phase 1.
- [v1.0 Roadmap, archived]: v2 requirements (routing, adapter, advanced ops) tracked as Future, not executed in current roadmap.

(Older v1.0 plan-level decisions archived in `milestones/v1.0-ROADMAP.md` and per-phase SUMMARY documents under `.planning/phases/`.)

- [Phase 10]: D-CTX-6 strict-mode env toggle deferred — v1.1 ships AUTO-APPLY + typed-error-on-failure as the sole behavior. MIGRATION_PENDING TypedError + runMigrations() helper landed; helper unwired (Plan 10-02 wires boot path).
- [Phase 10]: 5 v1.1 ROADMAP-shape audit-test failures pre-existed Plan 10-01 (origin commit 04d5f60). Out of scope; logged in .planning/phases/10-migrate-on-boot-hardening/deferred-items.md for milestone-close audit. Plan 10-01 added zero new failures (756 passing, unchanged).
- [Phase 10]: DEMO-01 NOT marked complete in REQUIREMENTS.md after Plan 10-01. The requirement is cohort-level (engine foundation in 10-01, boot-path wiring in 10-02, fixture test in 10-03). Mark complete after Plan 10-03.
- [Phase 10]: Plan 10-02 wired runMigrations() into openDb() with DM-02-parity close-before-throw on MIGRATION_PENDING. Both stdio and --http transports inherit the typed-error surface via the single src/server.ts:154 call site. ROADMAP success criterion #4 (clean-DB no-op) proven by 4-assertion regression test. DEMO-01 cohort 2/3 done; mark requirement complete after Plan 10-03.
- [Phase 10]: runMigrations() promoted to schema-polymorphic generic during Plan 10-02 wiring (Rule 3 fix). Plan 10-01's no-schema-only signature did not accept the typed BetterSQLite3Database<typeof schema> at the openDb() call site. Single signature change in src/store/migrate.ts; no behavioral change to the migrator-invocation path or TypedError wrap.
- [Phase 10]: Plan 10-03 closed the DEMO-01 cohort with 7 failure-path assertions across 3 describe blocks. vi.mock injection of a synthetic drizzle-migrator failure proves the typed-error envelope (code + filename + SQL-text + remediation hint) and a local engine-constructor vi.fn() spy proves openDb() bails before any post-openDb code runs (engineConstructorSpy never invoked). DEMO-01 marked complete in REQUIREMENTS.md (cohort-level requirement). Phase 10 ready for verifier.
- [Phase 10]: All four ROADMAP success criteria for migrate-on-boot hardening have automated coverage. #1 (atomic apply before transports) + #4 (clean-DB no-op) from Plans 10-01/10-02. #2 (typed MIGRATION_PENDING with filename + hint) + #3 (test fires before tool registration) from Plan 10-03. Architecture-purity preserved across all three plans — store-layer migration helpers stay zero-MCP, proven by file-level grep guard in src/__tests__/architecture-purity.test.ts.
- [Phase 11]: Plan 11-01 introduced flattenComfyError(error: unknown): string in src/comfyui/format.ts as the single source of truth for the 3-branch ComfyUI error flatten chain (node_errors / string / 'ComfyUI reported failed' fallback). Both submit-time (src/comfyui/client.ts:436) and recovery-poller (src/engine/generation.ts:207) call sites delegate to it. extractFirstNodeError stays unchanged as the underlying primitive. IT-10 cancelled-status contract preserved. Architecture-purity preserved. Helper-level closure of ROADMAP success criteria 1-4; integration-level parity proof comes in Plan 11-02.
- [Phase 11]: DEMO-02 NOT marked complete in REQUIREMENTS.md after Plan 11-01. The requirement is cohort-level (helper + dual call-site refactor in 11-01, byte-for-byte same-fixture parity test in 11-02). Mark complete after Plan 11-02.
- [Phase 11]: Plan 11-02 added same-fixture parity test at src/comfyui/__tests__/error-extraction-parity.test.ts (354 lines, 14 named test cases). Drives 4 Cloud-shaped error fixtures (node_errors object, value_not_in_list, bare string, IT-10 missing-error fallback) through 3 paths (helper / submit / status) and asserts byte-equal output. Cross-arm sweep + IT-10 cross-check provide structural guard against future drift between submit-time and recovery-poller error-extraction call sites. ROADMAP Phase 11 success criterion #2 closed at integration boundary.
- [Phase 11]: FakeComfyUIClient gained additive cannedFailedError escape-hatch (default null preserves legacy { node_errors: cannedNodeErrors } wrap) plus OMIT_ERROR sentinel symbol. Purely opt-in — every pre-existing failed-workflow test continues to behave byte-for-byte unchanged (46/46 generation.test.ts passing). FakeScenario union, default cannedNodeErrors fixture, and all other scenarios untouched. Threat T-11-06 mitigation honoured.
- [Phase 11]: DEMO-02 marked complete in REQUIREMENTS.md after Plan 11-02. Cohort-level closure: 11-01 added flattenComfyError helper + dual call-site refactor, 11-02 added the byte-for-byte same-fixture parity test. ROADMAP success criteria #1 (recovery poller surfaces actionable detail), #2 (single helper proven), #3 (no field rename / UI rework), and #4 (graceful fallback when node_errors absent) all provably closed. Phase 11 ready for /gsd-verify-phase 11.
- [Phase 12]: Plan 12-01 closed engine-layer cohort for DEMO-03. ReproductionDivergence interface (D-CTX-4) + buildReproductionDivergence pure helper + computeOutputSha256 streaming hash + migration 0005 + Engine.diffVersions async-conversion + GenerationEngine.reproduceVersion warning persistence. Architecture-purity preserved across all 4 touched engine files. ROADMAP success criteria #3 + #4 closed at engine + tool boundary; criteria #1 + #2 land in Plan 12-02 (dashboard).
- [Phase 12]: Plan 12-02 closed dashboard cohort for DEMO-03. WarningPill component (43 lines) bound to existing --color-status-running token (no new design tokens) + Version.lineage_type extension + VersionDrawer auto-fetch effect + WarningPill conditional render + side-by-side parent-vs-reproduction comparison block. Auto-fetch effect deps array deliberately excludes diff (T-12-10 mitigation: body guard handles re-render-with-already-loaded case). ReproductionDivergence interface duplicated dashboard-side per D-WEBUI-31. 11 new tests (5 WarningPill + 6 VersionDrawer integration). DEMO-03 cohort 2/2 closed; marked complete in REQUIREMENTS.md.
- [Phase 12]: All four ROADMAP success criteria for reproduce divergence transparency have automated coverage. #1 (pill on warnings OR sha256 mismatch) + #2 (side-by-side comparison block when both outputs on disk) closed by Plan 12-02 dashboard cohort. #3 (engine + tool emits reproduction_divergence) + #4 (bit-identical reproduction → null → no UI signal) closed by Plan 12-01 engine cohort and confirmed by Plan 12-02 dashboard render guards. Architecture-purity preserved (engine layer zero-MCP, dashboard zero-server-import). Phase 12 ready for /gsd-verify-phase 12.
- [Phase 13]: Plan 13-01 closed the data-shape + helper foundation for PROV-V-03. ModelRef gains `model_hash_unavailable: string | null` (D-CTX-1) — additive required-but-nullable so persisted models_json carries typed unavailable reasons (D-CTX-5: `models_dir_not_configured` / `file_not_found` / `file_unreadable` / `unsupported_class_type`). MODEL_DIR_BY_CLASS exported (9 entries, lockstep with LOADER_CLASS_TYPES, locked by a passing test). `fingerprintModel` async helper at `src/engine/model-fingerprint.ts` streams SHA-256 via createReadStream + createHash, mirrors output-hash.ts WR-02 (path-traversal in modelName degrades to `file_not_found`, no disk read), retries 3 attempts with 1s/2s sleeps for non-ENOENT I/O errors. Architecture-purity preserved at the helper boundary — zero MCP / SQLite-driver / ORM imports (grep gates clean). +18 root-suite tests (824 → 842 passing); 5 pre-existing failures unchanged. Phase 13 cohort 1/3; PROV-V-03 closure happens in 13-03 (after 13-02 wires fingerprinter into completion path + 13-03 adds diff parity + integration tests + file-level architecture-purity assertion).
- [Phase 13]: One Rule-3 deviation auto-fixed in Plan 13-01 — the plan's own `<action>` block instructed a docstring containing the literal strings 'better-sqlite3' and 'drizzle-orm', and the same plan's `<verify>` block required `grep -E 'better-sqlite3|drizzle-orm'` to return ZERO matches. Rephrased the docstring as 'zero SQLite-driver imports, zero ORM imports' (same intent, no literal package-name strings) so the gate passes cleanly. Bundled into the Task 2 commit per Rule 3 scope-boundary.
- [Phase 13]: Plan 13-02 wired Plan 13-01's fingerprintModel into the completion path via the D-CTX-3-recommended sibling 'models_fingerprinted' provenance event. Append-only invariant on src/store/provenance-repo.ts preserved (literal grep this.db.update|this.db.delete still returns ZERO). T-13-07 mitigation asserted by a regression test that re-fetches the original 'completed' row by id after appendModelsFingerprintedEvent and asserts byte-equality on every field. Engine.fingerprintModelsForVersion is idempotent (events scan, returns early on existing fingerprinted event) so the boot-time recovery path is O(N) reads + 0 hashes for already-done rows. Hot-path isolation (criterion #4) proven by the GenerationEngine.downloadAndPersist hook: fires synchronously, receiver wraps async work in 'void X.catch(...)', test asserts zero fingerprinted events at the moment getGenerationStatus returns 'completed'. NO Drizzle migration added — the event_type column has no CHECK constraint, so the union extension is purely TS-level. ROADMAP success criteria #1 + #4 closed at the integration boundary; PROV-V-03 cohort closure happens in 13-03.
- [Phase 13]: [Phase 13]: Plan 13-03 closed Phase 13. ModelChange shape extended with hash_unavailable on both sides; diffModels fires on hash↔unavailable transitions; loadDiffSnapshot reads getLatestFingerprints (post-fingerprint view) instead of raw completed_event.models_json (legacy try/catch JSON.parse removed); 5 end-to-end integration tests prove criteria #1/#2/#3 + the diff boundary; 3 file-level architecture-purity assertions lock src/engine/model-fingerprint.ts as zero-MCP / zero-SQLite-driver / zero-ORM. Test count: +13 root-suite (5 diff transition + 5 integration + 3 architecture-purity). 5 pre-existing v1.1-audit failures unchanged. PROV-V-03 cohort closed; Phase 13 ready for /gsd-verify-phase 13.
- [Phase 13]: [Phase 13]: All 5 ROADMAP success criteria have automated coverage. #1 (populated model_hash) by Plan 13-02 Test 2 + Plan 13-03 Tests 1, 4. #2 (typed model_hash_unavailable) by 13-01 reason-codes + 13-02 Test 1 + 13-03 Tests 2, 5. #3 (content-addressed) by 13-01 same-bytes + 13-03 Test 3. #4 (hot-path isolation) by 13-02 Test 4. #5 (architecture-purity) by 13-01 grep gates + 13-03 file-level vitest assertions. Phase 14 (C2PA) ready: reads getLatestFingerprints(versionId) as canonical source of model fingerprints for ingredient assertions.
- [Phase 14]: Plan 14-01 closed Phase 14 configuration foundation. c2pa-node@0.5.26 pinned EXACTLY. C2paConfig threaded through Engine constructor as additive options.c2paConfig (default null, 42 existing pipeline tests pass byte-unchanged). loadC2paConfigFromEnv at src/utils/c2pa-config.ts mirrors validateBaseUrlFromEnv pattern: throws TypedError('C2PA_CONFIG_INVALID', ...) BEFORE Engine construction on misconfig (Phase 10 MIGRATION_PENDING parity). Concern #4 (path-traversal) mitigated by realpathSync + allowlist containment (cwd default; VFX_FAMILIAR_C2PA_CERT_ROOT override). Path-leak hygiene: error messages and boot success log emit basenames only via path.basename. Concern #11 enforced by architecture-purity grep gate: src/server.ts has ZERO static c2pa-node imports — Plan 14-02 lazy-imports in signer wrapper. Dev cert script at scripts/gen-dev-c2pa-cert.mts (ES256, .c2pa-dev/ gitignored). +18 tests (13 c2pa-config + 4 pipeline-c2pa-config + 1 arch-purity); root suite 869 → 887; pre-existing 5 v1.1-audit failures unchanged. PROV-V-01 NOT yet marked complete (cohort-level).
- [Phase ?]: [Phase 14]: Plan 14-02 closed engine-layer c2pa module foundation. src/engine/c2pa/ with 4 submodules (format-router, manifest-builder, signer, barrel index) — signer is the SOLE c2pa-node consumer (architecture-purity grep gate enforces). Concern #1 algorithm detection via X509Certificate built-ins (ES256/384/512, PS256/384/512, Ed25519; plain RSA fail-loud); Concern #10 RFC4514-aware subject parser (CN -> O -> fp: fallback); Concern #11 lazy + try/catch'd dynamic import (cached error short-circuits, no retry). Concern #2 sidecar reduction structurally locked via TypeScript exhaustiveness check (no mode 'sidecar' value). Runtime DEVIATION: c2pa-node v0.5.26 native binding requires tsaUrl ABSENT or VALID URL — TS-optional property with undefined value triggers downcast bug. Workaround: loadSigner builds LocalSigner literal with TWO branches (property omitted when caller passes null); default 'http://timestamp.digicert.com' mirrors createTestSigner. End-to-end signing tests use c2pa-node bundled cert chain (self-signed .c2pa-dev/ rejected by c2pa-rs). +54 tests; root suite 887 -> 941 passing. Pre-existing 5 v1.1-audit failures unchanged. PROV-V-01 NOT yet marked complete (cohort closure in 14-04/14-05).
- [Phase ?]: [Phase 14]: Plan 14-03 closed engine integration cohort. Engine.signOutput method handles 8 outcome paths (signing_disabled, unsupported_format, cert_load_failed, native_binding_unavailable, sign_call_failed, asset_too_large_for_buffer_api, alreadySigned, success-buffer/file). Lazy signer cache + Concern #11 binding-error distinction. Concern #5 temp dir 0700/0600 with try/finally cleanup; Concern #6 BUFFER_SIGNING_MAX_BYTES (500MB) defence-in-depth at downloader pre-stat + engine cap; Concern #7 idempotency via getLatestManifestSignedEvent + alreadySigned shortcut emits ZERO events on skip; Concern #9 nanoid(8) unique partial paths. EXDEV cross-device rename fallback. T-14-12 ACCEPTED (key in heap, software-only v1.1; HSM v1.2+). v1.1 Concern #2 scope reduction structurally locked: NO sidecar field; EXR/PSD surface as unsupported_format with original file untouched. Drizzle 0006 migration adds nullable manifest_signed_json column. +33 tests; root suite 941 -> 974 passing; pre-existing 5 v1.1-audit failures unchanged. Architecture-purity preserved: zero c2pa-node imports in pipeline.ts/output-downloader.ts/provenance-repo.ts. tsc --noEmit clean. Phase 14 cohort 3/5; PROV-V-01 cohort closure in 14-04/14-05.
- [Phase 14]: Plan 14-04 closed HTTP + dashboard surface for C2PA signing state. GET/HEAD /api/versions/:id/output sets X-C2PA-Signing-Status response header (signed | unsigned:<reason> | unknown) sourced from the Plan 14-03 manifest_signed event accessor. The HTTP layer NEVER signs — files are signed at write-time by the downloader hook (D-CTX-8 → Plan 14-03 revision); benefits preserved (dual-transport parity for free, no signing latency on hot HTTP path, simpler crash safety). v1.1 Concern #2 scope reduction LOCKED at HTTP + dashboard layer: NO sidecar route at /output.c2pa, NO sidecar download link in VersionDrawer, NO SIDECAR_EXTENSIONS dashboard duplication. T-14-10 mitigation Test 8 asserts body bytes + Content-Type + Cache-Control byte-identical to pre-Phase-14 baseline. T-14-11 XSS mitigation: 3 defence layers (known-codes translation map + character-class sanitization filter, Preact text-node interpolation, NO dangerouslySetInnerHTML). +41 tests (root 974 → 985 [+11]; dashboard 58 → 88 [+30]); pre-existing 5 v1.1-audit failures unchanged. Phase 14 cohort 4/5; PROV-V-01 closure in Plan 14-05.
- [Phase 14]: Plan 14-05 closed Phase 14 with full verification cohort. 5 test files (+53 root tests, 985 -> 1038), Concern #8 cryptographic-binding closed via two-leg proof (clean validation_status when reading unmodified bytes + tamper test produces dataHash.mismatch URL referencing c2pa.assertions/c2pa.hash.data). Rule 1 silent-failure bug fixed in Engine.signViaTempFiles (temp files now preserve filename extension so c2pa-rs's BMFF/RIFF/TIFF asset handlers select correctly). version.get response envelope gained additive c2pa_status + c2pa_status_reason fields. Wire-level UAT honors MEMORY.md feedback_dont_punt_on_tests via real MCP SDK Client + spawned server child process. PROV-V-01/02/05 cohort closure with v1.2 deferred items recorded. Phase 14 cohort 5/5; ready for /gsd-verify-phase 14.
- [Phase ?]: [Phase 15]: Plan 15-01 closed extraction primitives. IMAGE_INPUT_CLASS_TYPES audited per REVISION C1/C2 (6 entries: LoadImage, LoadImageMask, VAEEncode, VAEEncodeForInpaint, ControlNetApply, ControlNetApplyAdvanced; model loaders deliberately excluded; disjointness vs LOADER_CLASS_TYPES locked by test). REVISION B5 KSampler edge walk shipped — prompt_positive/negative resolved by following positive/negative as [node_id, output_index] tuples to CLIPTextEncode-class ancestors; IA-3 test ('unreferenced CLIPTextEncode is ignored') locks the behaviour. extractParentIngredient + extractComponentIngredients + extractInputAssertion (pure) + hashComponentBytes (impure streaming-SHA256 mirroring output-hash.ts WR-02 with discriminated HashOutcome union). 41 new tests + 5 v1.1 audit + 2 file-level architecture-purity guards. Root suite 1048 -> 1096 passing; pre-existing 5 v1.1-audit failures unchanged. Architecture-purity preserved: zero MCP / native-binding / SQLite / ORM imports in either new file. Three Rule-3 docstring-vs-grep collisions auto-fixed (mirrors Phase 13 Plan 13-01 pattern). PROV-V-04 NOT marked complete — cohort closure happens in Plan 15-04 after manifest builder extension (15-02), engine integration (15-03), and end-to-end fixture (15-04).
- [Phase ?]: [Phase 15]: Plan 15-02 closed manifest builder extension. New buildManifestWithIngredients pure entry point returns BuildManifestResult { definition, ingredientSpecs }; Phase 14 buildManifestDefinition unchanged byte-equal. ManifestDefinition.assertions broadened to discriminated union; Phase 14 literal narrows in. Architectural contract locked by Test 16: definition.assertions[] NEVER carries c2pa.ingredient — that is Plan 15-03's territory via manifestBuilder.addIngredient. Two-channel record for unavailable ingredients (ingredientSpecs assetRef='unavailable' + vfx_familiar.unavailable_ingredient assertion). T-15-04 stripToBasename defence-in-depth (Tests 17, 18). 30 new tests; root suite 1096 -> 1126 passing; pre-existing 5 v1.1-audit failures unchanged. Two Rule deviations auto-fixed (Rule 1 narrowing helper; Rule 3 docstring rephrasing). PROV-V-04 cohort closure in Plan 15-04. Plan 15-03 unblocked.
- [Phase ?]: [Phase 15]: Plan 15-04 closed Phase 15 cohort. End-to-end traceback test + dangling-reference test prove ingredient-graph behavior at the manifest read-back layer. PROV-V-04 marked complete (3 places). ROADMAP Phase 15 row Complete 2026-04-30. 18 new tests; root 1157 -> 1175 passing; pre-existing 5 failures unchanged. 4 Rule deviations auto-fixed during Task 1 GREEN. Phase 15 4/4 plans complete; ready for /gsd-verify-phase 15.
- [Phase ?]: [Phase 16]: Plan 16-01 closed PROV-V-07 engine half. Pure-async exportManifest + lazy-c2pa-node verifyManifest + Engine facade methods. D-CTX-7 architecture-purity allowed-set assertion replaces single-element deepEqual. ZERO MCP/SQLite/ORM imports across both new modules. 5 Rule-3 deviations auto-fixed (VersionRepo getById -> getVersion + docstring-vs-grep collision recurring pattern + implicit-any from c2pa-node index signatures + arch-purity assertion bundling order + INTERNAL_ERROR added to ErrorCode union). 46 new tests; root suite 1190 -> 1236 passing; pre-existing 4 v1.1-audit failures unchanged. PROV-V-07 NOT marked complete (cohort closure in Plan 16-03 after tool surface wires through). Plans 16-02 (redaction) + 16-03 (tool surface) UNBLOCKED.
- [Phase 16]: Plan 16-03: two new agent-surface tool actions (export_manifest + verify_manifest) wired through Plan 16-01 facade with discriminated input + 100MB payload-size cap (T-16-17) + dual-transport parity guarantee
- [Phase ?]: [Phase 16]: Plan 16-02 closed PROV-V-06 redaction primitive. Pure applyRedactionPolicy + buildRedactedManifestDefinition helpers + lazy-binding redactManifestForVersionImpl + Engine.redactManifestForVersion facade. C-04 unified assetWriterMutex (FIFO-serializing) wraps signOutput AND redactManifestForVersion; preserves Phase 14/15 idempotent-retry coalescing. C-01 recursive redactValue() preserves nested structure with sentinel leaves. D-CTX-1 scope locked: ACTIVE manifest only — parent chain + asset binary out-of-scope (deferred v1.2). 6 new ErrorCodes. 31 new tests; root +32 net new; tsc clean. PROV-V-06 cohort closed.
- [Phase Phase 16]: [Phase 16]: Plan 16-04 closed redact_manifest agent-surface action. Tool layer extension pattern: discriminated z.union arm + envelope shaper + switch case + inputSchema enum extension; ZERO logic inline; engine facade dispatch only (mirror Plan 16-03). Action count grows from 6 to 7 (top-level tool count remains 7 of 12 cap). Architecture-purity preserved: ZERO c2pa-node imports in version-tool.ts. D-CTX-1 wire-level invariant locked at THREE layers across Phase 16: helper (16-02 Test 12), integration (16-02 Test 17), WIRE (this plan Tests 2 + 11 — c2pa.read on bytes returned over stdio + HTTP + multi-encoding scan over active-manifest projection). Append-only contract verified at wire boundary (Test 14 direct SQLite read before/after). C-08 byte-equal round-trip + 3-way equivalence + multi-entry policy ordering documented (unit Tests 21-23). Defence-in-depth Zod caps: redaction_policy <=32 entries x <=1024 chars per entry. Verbatim error code passthrough: 5 engine TypedError codes flow through toolError unchanged. 4 Rule deviations auto-fixed (3 Rule 3 blocking + 1 Rule 1 bug — all direct consequences of plan-execution boundary issues; no scope creep). Test count: +37 root tests (1306 -> 1343 passing); pre-existing 4 v1.1-audit failures unchanged. PROV-V-06 wire-level surface complete pending Plan 16-05 cohort closure.
- [Phase ?]: [Phase 16]: Plan 16-05 closed Phase 16 + milestone v1.1 with three-test-layer cohort closure (E2E + wire-level UAT + smoke script). 22 new root tests (+10 E2E + +12 wire-level UAT) — 1343 -> 1365 passing. Pre-existing 4 v1.1-audit failures unchanged. Rule 1 fix to Plan 16-02 redaction.ts D-PLAN-2-5 not_found prefix in audit-row redacted_fields. Three v1.2 candidates captured in deferred-items.md (deferred-ingredient-mirror, shared wire-UAT test util refactor, redaction-of-redaction multi-step). PROV-V-06 + PROV-V-07 marked Complete; ROADMAP milestone v1.1 SHIPPED 2026-04-30.

### Pending Todos

None yet.

### Blockers/Concerns

(All v1.0 blockers resolved. Phase 2 ComfyUI Cloud access locked at https://cloud.comfy.org via Phase 7. Model checksums confirmed null-on-Cloud per PROV-02 — closes the loop on the prior concern; full closure happens in Phase 13 of v1.1 via C2PA model fingerprinting per SEED-001. `c2pa-node` ecosystem available for v1.1; specific package version pinned during Phase 14 plan derivation.)

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-04-30T20:38:00.447Z
Stopped at: Completed 16-04-PLAN.md
Resume file: None

**Planned Phase:** Phase 15 — Ingredient Graph (in progress, 2/4 plans). Run `/gsd-execute-phase 15-ingredient-graph` to continue with Plan 15-03.
