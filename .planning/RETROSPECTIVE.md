# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-04-28
**Phases:** 9 (5 functional + 4 gap-closure) | **Plans:** 46 | **Tasks:** 127

### What Was Built

- Pure-engine substrate: SQLite+WAL store, Drizzle schema, HierarchyRepo, Engine facade with zero MCP dependency (Phase 1)
- Dual-transport MCP server (stdio + Streamable HTTP) over a single process via shared buildServer factory; 5 cross-cutting integration tests lock parity (Phase 1)
- Async ComfyUI Cloud generation: SSRF-safe redirect gate, two-phase submit, AbortController-wired recovery poller, 3-attempt download retry (Phase 2)
- Append-only provenance: ProvenanceRepo with 4 public methods (no UPDATE/DELETE), structurally enforced; submit-event + terminal-event two-event model; PNG tEXt prompt extraction (Phase 3)
- Reproduce/iterate lineage: prototype-pollution guarded node-scoped overrides, lineage_type tracking, reproduction_warnings always present (Phase 3)
- Asset management: 7-action asset MCP tool, idempotent TagRepo/MetadataRepo, AND-only SQL filters with json_each, paginated query+total_count (Phase 4)
- Preact + Tailwind v4 dashboard with @preact/signals, 18 REST routes, 5-event SSE bus, 38.55 kB JS + 21.70 kB CSS bundle (Phase 5)
- Audit-driven gap closure: 4 phases (06-09) closed all v1.0-MILESTONE-AUDIT tech debt before archival; re-audit flipped from `tech_debt` to `passed`

### What Worked

- **Engine-first, tools-thin:** Every phase started with pure Engine logic + Vitest, then thin MCP tool wrappers. Architecture-purity tests caught any tool→engine inversion attempt at compile time.
- **Cross-cutting invariant tests as a tier:** `architecture-purity.test.ts`, `phase-attribution.test.ts` (Phase 8), `validation-flags.test.ts` (Phase 9) catch entire bug classes without needing per-feature regression tests.
- **Programmatic UAT over Inspector UI:** `scripts/inspector-smoke.mjs` runs real `Client` + `StdioClientTransport` for 56/56 wire-level checks; faster, deterministic, CI-able. Replacing manual UI smoke saved time at every phase boundary.
- **Audit-driven close, not feature-driven close:** When Phase 5 audit surfaced 6 wire-quality items + endpoint drift + attribution gaps + Nyquist Wave 0 partials, the answer was 4 explicit gap-closure phases (06-09) — not "ship and document tech debt." Re-audit confirmed this was the right call.
- **gsd-sdk milestone.complete CLI handled the structural archival.** The AI focused on judgment-heavy work (ROADMAP rewrite, PROJECT.md evolution, requirements outcome attribution).
- **Plan-level SUMMARY frontmatter as ground truth:** When attribution drift surfaced (Phase 8), the regression guard could mechanically check SUMMARY ⊇ ROADMAP requirements without any human in the loop.

### What Was Inefficient

- **REQUIREMENTS.md checkbox drift:** GEN-01..07 and WEBUI-01..05 checkboxes stayed `[ ]` and traceability all said "Pending" even after phases shipped. The audit was authoritative, but the surface text was stale until milestone close. A `/gsd-transition` checkpoint that mechanically toggled checkboxes per phase would have removed this lag.
- **Phase 5 wire-quality drift not caught at plan time:** WR-01/04/05 + IN-01/02/04 each had a one-line root cause (hardcoded `[]`, hardcoded `'outputs'`, dropped typed errors, qNum permissive, SSE keep-alive `data:` prefix, normalizeStatus silent fallback). Architecture-purity tests didn't catch them because they're behavior bugs, not architecture violations. Lesson: behavioral wire-shape tests at the seam (Plan 05-13's pattern) are worth scheduling at the start of UI phases, not after.
- **ComfyUI endpoint drift took two phases to fully resolve:** Phase 2 shipped against `https://api.comfy.org` (default at the time). Live-smoke 401/404'd. Phase 7 ran a read-only probe matrix to find `https://cloud.comfy.org` + `/api/system_stats`, then needed two D-EP-16/17 Rule 3 blocking fixes during Plan 07-06 to actually green live-smoke. Investing the probe earlier would have caught the endpoint divergence at Phase 2 instead of after Phase 5.
- **Attribution gaps were silent until audit:** HIER-06 + TOOL-02..05 were verified satisfied in `01-VERIFICATION.md` but missing from `01-02-SUMMARY.md` frontmatter `requirements-completed`. The audit caught it; Phase 8 backfilled. Lesson: a per-phase pre-close attribution check (the test added in Plan 08-01) belongs in the plan template, not as a backfill.

### Patterns Established

- **Pure-function adapter at serialization boundaries (Plan 05-13 pattern):** When two layers have legitimately different shapes (engine event vs render contract), a pure adapter with a seam test is the cleanest fix. Don't bend either side.
- **Read-only probe matrices for endpoint discovery (Plan 07-01 pattern):** Before committing infra config, run a matrix of (base × path) combos with the real auth header. Locks the endpoint with audit trail.
- **Structural enforcement of immutability:** ProvenanceRepo has only insert/get methods — there is no setter, so append-only isn't a convention, it's a type-level guarantee. Prototype assertion test makes structural change a failing build.
- **Discriminated-union Zod schemas for action-style tools:** Every multi-action MCP tool (workspace, project, sequence, shot, generation, version, asset) uses Zod v4 discriminated union on `action`, dual-form envelope via `toolOk`. Single edit point for breadcrumb contract.
- **Frontmatter-driven cross-cutting tests:** Phase 8 added `phase-attribution.test.ts` that reads SUMMARY frontmatter `requirements-completed:` and asserts ⊇ ROADMAP. Same shape works for any other plan-level invariant.
- **Decimal phases for audit-driven inserts:** Gap-closure phases 06-09 weren't decimal because they didn't insert between integer phases — they extended the milestone. Decimal numbering (e.g., 2.1) is reserved for true insertions; integer continuation is for milestone-boundary closure work.

### Key Lessons

1. **Don't punt on tests.** When a "human UAT" item is wire-level (tool calls, JSON-RPC, HTTP), drive it with the MCP SDK client or curl before escalating. Programmatic UAT over Inspector UI saved time on every phase boundary; manual UAT would have lagged or skipped silently.
2. **Audit the milestone before closing it.** The first audit (2026-04-23) surfaced 4 tech debt categories. Closing then would have shipped a v1.0 with known gaps in the audit doc. Phases 06-09 took 5 days; the re-audit flipped the milestone from `tech_debt` to `passed`. Worth it.
3. **Probe live endpoints before committing infra config.** Phase 2 baked `api.comfy.org` into the client. Phase 7 spent a plan to discover `cloud.comfy.org` + `/api/system_stats` is the only working combo. The cost was real; the fix path is `Plan 07-01` shape (read-only probe matrix → lock decision).
4. **Cross-cutting invariant tests beat per-feature regression tests.** Three tests (`architecture-purity`, `phase-attribution`, `validation-flags`) catch entire classes of drift. Each was added because of a specific incident; each now prevents the class.
5. **REQUIREMENTS bookkeeping needs a phase-transition mechanic.** Manual checkbox toggling is too lossy. Future: a per-phase script that reads SUMMARY frontmatter `requirements-completed:` and toggles `[x]` in REQUIREMENTS.md, with a regression guard that asserts traceability matches.
6. **Memory hygiene at phase boundaries matters.** Phase 7's Plan 07-08 explicitly removed the stale `project_comfy_api_endpoint_drift.md` memory once the drift was resolved. Stale memory is a future-Claude landmine.

### Cost Observations

- Model mix: predominantly Claude Opus 4.7 (1M context) for orchestration, planning, and verification. Subagent spawns for research and execution.
- Sessions: 9 days of execution; phase 5 (web dashboard) was the largest single phase at 13 plans.
- Notable: gap-closure phases 06-09 were significantly cheaper than functional phases — no research, no UI design, mechanical fixes against pre-identified audit items. Investing in a thorough audit was net-positive on token spend.

---

## Milestone: v1.1 — Provenance Verification (C2PA)

**Shipped:** 2026-04-30
**Phases:** 7 (Phases 10-16) | **Plans:** 24 | **Tasks:** 63

### What Was Built

- Migrate-on-boot guarantee: server applies pending Drizzle migrations atomically OR refuses to boot with `MIGRATION_PENDING` typed error before tool registration (Phase 10, DEMO-01)
- Single `flattenComfyError` helper consolidates ComfyUI Cloud error extraction across submit + recovery-poller paths; recovery-poller dashboard cards no longer collapse to "ComfyUI reported failed" (Phase 11, DEMO-02)
- `reproduction_divergence` field on DiffResponse + WarningPill + side-by-side parent-vs-reproduction comparison block in VersionDrawer (Phase 12, DEMO-03)
- SHA-256 model fingerprinting for every checkpoint/LoRA/VAE/ControlNet via `Engine.fingerprintModelsForVersion` — fires post-completion via void-wrapped callback for hot-path isolation; closes `model_hash: null` gap (Phase 13, PROV-V-03)
- C2PA signed manifest emission via `c2pa-node` v0.5.26 — signs PNG/JPEG/MP4/WebP/TIFF at download time with `c2pa.created` AI-origin disclosure + `c2pa.hash.data`/`c2pa.hash.bmff` cryptographic binding; X-C2PA-Signing-Status response header + dashboard C2paBadge (Phase 14, PROV-V-01/02/05)
- Ingredient graph: `parentOf` (lineage), `componentOf` (control/reference images), `vfx_familiar.input` vendor assertion (prompt + sampler params + seed via KSampler edge walk to CLIPTextEncode ancestors); `vfx_familiar.unavailable_ingredient` for dangling refs (Phase 15, PROV-V-04)
- Redaction primitive with `vfx_familiar.redacted` vendor assertion preserving the FACT of redaction; original signed manifest stays append-only via sibling event row pattern (Phase 16, PROV-V-06)
- Three new `version` MCP tool actions: `export_manifest` + `verify_manifest` + `redact_manifest`. Tool count stays at 7 of 12 cap (Phase 16, PROV-V-07)
- Unified `assetWriterMutex` (Phase 16) replaces per-version sign mutex coalescing pattern with FIFO serialization for sign + redact on (versionId, filename); 30s timeout → REDACT_TIMEOUT
- Atomic disk write for redacted bytes (temp + rename) — Plan 16-05 Scenario B verifies via Engine.exportManifestForVersion (no manual disk overwrite)
- Architecture-purity allowed-set: c2pa-node imports restricted to `src/engine/c2pa/{signer,verifier,redaction}.ts` (3 actual importers in 4-element set including reserved exporter slot)

### What Worked

- **Adversarial codex-substitute review at planning stage caught 5 BLOCKERS in Phase 16 alone.** Codex CLI not installed locally, so `gsd-plan-checker` substituted as adversarial reviewer per the user's crypto-correctness mandate. The review found the C-04 silent-data-corruption pattern (coalescing mutex applied to non-idempotent redact), the C-03 TypeScript-`as`-cast hiding ManifestAssertion union shape mismatch, and the C-09 E2E test that manually overwrote disk and HID the C-04 bug. **All five BLOCKERS were closed in surgical revisions before execute.** This validates v1.0 lesson "audit-driven close beats feature-driven close" — extends to "adversarial-review-driven plan beats optimistic-plan execute."
- **Cross-AI surrogate worked when the primary tool was unavailable.** Codex CLI absent → gsd-plan-checker substituted with the same brief structure ("be ruthless, find the next bug"). The AI agent didn't need to BE codex to PLAY the codex role — the framing was the load-bearing piece.
- **Wave-based parallel execution shaved time on Wave 2.** Plans 16-02 (redaction engine) + 16-03 (export+verify tool surface) had zero file overlap and ran in parallel via two concurrent gsd-executor agents. ~80 minutes saved vs serial execution.
- **Goal-backward verification (gsd-verifier) caught the gap between "tasks complete" and "phase delivered."** Phase 16 had 13/13 must-haves verified by reading actual code, not by accepting SUMMARY claims. The verifier confirmed all 11 adversarial-review revisions landed in implementation, including the multi-encoding leak scan helpers at 4 layers.
- **Lazy `await import('c2pa-node')` discipline scaled cleanly.** Phase 14 established the pattern; Phases 15 + 16 reused it without modification. Native binding load failures degrade gracefully to unsigned mode in dev, fail-loud via env config in production.
- **Vendor-namespaced custom assertions (`vfx_familiar.*`) sidestepped C2PA spec ambiguity.** Phase 15 + 16 used `vfx_familiar.input`, `vfx_familiar.unavailable_ingredient`, and `vfx_familiar.redacted` instead of negotiating against the spec's `c2pa.*` reserved labels. Simpler integration, clearer separation of concerns, easy migration path if C2PA standardizes the equivalents in v1.2+.
- **Hot patches stayed out of v1.1 phase planning.** The 3 v1.0-demo hot patches (85ab50b, ea5641c, 19d2bed) were already on main; the v1.1 plan never re-opened them. Saved ~2 plans of redundant work.

### What Was Inefficient

- **Codex CLI absence forced an ad-hoc substitution every Phase 14/15/16 plan stage.** The user's crypto-correctness mandate explicitly invoked `/gstack-codex review` — but the tool was not installed. Each phase, the orchestrator rediscovered this and routed to gsd-plan-checker. v1.2 should establish a documented fallback chain or install codex CLI proactively.
- **Plan size grew to 60-90KB per file.** Phase 16's 5 plans totaled ~280KB across just plan files (excluding context, plan-check, and revision-response docs). Adversarial-review-driven planning created comprehensive plans, but the size pushed several executor agent runs near the 20-minute timeout. Future phases should consider splitting Wave-1 plans into smaller atomic chunks.
- **The first Phase 15 plan-set had a FATAL design flaw** (ingredients-in-`assertions[]` instead of separate `ingredients[]` array per c2pa-node v0.5.26 API). Caught by adversarial review, but only after a full plan-set was written. v1.2 should front-load c2pa-node API surface verification before plan-set creation, not as part of plan-check.
- **One agent socket dropped after 20 minutes during Phase 16 planning** mid-work after creating Plan 16-01. Recovery required dispatching a fresh planner with a tighter brief for Plans 16-02 through 16-05. Total cost: ~1 retry cycle per phase. v1.2 should investigate persistent-agent reconnection or split planning across multiple shorter dispatches.
- **The 5 pre-existing v1.1-audit ROADMAP-shape failures (now 4)** are predictable noise. They flag as failures every test run, requiring acknowledgment. v1.2 should either fix the audit tests to handle v1.1 ROADMAP shape OR mark them as known-skipped.
- **Phase 14 silent-failure bug (commit 72b1e48)** — Engine.signViaTempFiles emitted unsigned bytes with `signed: true` for MP4/WebP/TIFF because temp files lacked extension. c2pa-rs detects format from path extension. Caught by Plan 14-05 verification, not by Plan 14-03 execution. Lesson: when wrapping a native library, every assumption about path/format/extension matters; explicit tests for each format-detection branch.

### Patterns Established

- **Adversarial review at plan stage as a separate orchestration step** (not just verifier-after-execute). For phases tagged crypto/security-critical, route plan output through a "find the next bug" reviewer BEFORE executor dispatch. Document the BLOCKER/CONCERN classification in a separate review file alongside the plans.
- **Surgical-edit revisions over rewrites.** Phase 16's plan-revision step applied targeted Edit calls to the 5 plan files based on the review's specific findings. Plans grew modestly (~10-15% per file) instead of doubling. Faster than rewriting, easier to verify the revision response addressed each finding.
- **Wave-based parallel orchestration** with explicit `depends_on` frontmatter. Phase 16's 4 waves (16-01 → {16-02 ⊥ 16-03} → 16-04 → 16-05) ran cleanly with two parallel agents in Wave 2. The orchestrator validated zero file overlap before parallel dispatch.
- **Multi-layer invariant verification.** Phase 16's append-only contract was verified at 4 layers: helper unit test (JSON string-search), integration test (c2pa.read of re-signed bytes), wire-level test (multi-encoding scan over active-manifest projection), E2E test (multi-encoding + full-row SQLite byte-identity). Single-layer assertions are insufficient for crypto-correctness.
- **Multi-encoding leak scanning** (UTF-8 + UTF-16LE + UTF-16BE + base64 + non-ASCII sentinel) for any redaction-style invariant. Single `.toString('binary')` scan misses real leak channels.
- **Lazy native-binding import + graceful degradation** for any C/Rust binding wrapped in TypeScript. Avoids cascading boot failure when the binding isn't installed; production fails loud via env-config validation.
- **Architecture-purity allowed-set tests** for any restricted import. Phase 16 extended the c2pa-node allowed-set from 1 element (signer.ts) to 4 (signer + exporter + verifier + redaction). The test asserts sorted-array deepEqual on exact membership — adding a 5th file fails the test, forcing explicit review.

### Key Lessons

1. **Crypto-correctness lives in the planning layer, not the test layer.** Phases 14 + 15 + 16 each had blocker-class bugs caught at plan-check before any code was written. The cost of catching them at execute time would have been 10-50× the plan-check cost. Adversarial review IS the deliverable, not just the test suite.
2. **TypeScript `as` casts are crypto-correctness anti-patterns.** Phase 16's C-03 finding (extractAssertions cast) was a real shape mismatch hidden by a single cast. When a function bridges two systems with different type guarantees (project's narrow ManifestAssertion vs c2pa-node's wide Manifest), the bridge needs a runtime validation step, not a TypeScript cast.
3. **Coalescing mutexes are wrong for non-idempotent operations.** Phase 14's signMutex coalesces same-version sign requests for idempotent retry — correct. Phase 16 needed the SAME slot for redact, which is NOT idempotent. The fix: a unified `assetWriterMutex` (FIFO) with per-operation handling. Lesson: name the mutex after what it PROTECTS (asset writer) not what it ENFORCES (sign coalescing).
4. **Atomic write semantics matter more for re-write than first-write.** Phase 14 wrote signed bytes once via temp + rename. Phase 16's redact REPLACES already-on-disk bytes. The temp + rename pattern is the SAME, but the failure mode is different (concurrent reader sees stale bytes if write is non-atomic). Mirror Phase 14's discipline.
5. **Multi-encoding tests catch real leak channels.** Single-encoding scans miss UTF-16 (PNG iTXt), CBOR (c2pa-rs internal), base64-in-payload. Adversarial-review C-01 anti-pattern.
6. **Manifest JSON redaction ≠ asset-binary redaction.** Phase 16's redaction primitive operates on the C2PA manifest JSON only. PNG `tEXt`/`iTXt` chunks, EXR/PSD pixel data, EXIF passthrough — all unchanged. Document this limitation explicitly in D-CTX-1; users requiring asset-binary scrubbing need a separate v1.2+ tool.
7. **Append-only contract requires deterministic ordering at ms tick.** SQLite `timestamp = epoch ms` with `ORDER BY ASC` has non-deterministic ordering when two events share a ms tick. Use `(timestamp, id)` or fetch by primary key. Phase 16 C-02 anti-pattern.
8. **Goal-backward verification beats task-forward verification.** The gsd-verifier reads actual code against phase goal/CONTEXT.md/REQUIREMENTS.md, not against PLAN.md task lists. Catches the "tasks complete but phase didn't deliver" anti-pattern.

### Cost Observations

- Model mix: predominantly Claude Opus 4.7 (1M context) for orchestration. gsd-executor agents spawned per plan; gsd-verifier per phase; gsd-plan-checker per crypto-correctness phase (3 invocations: 14, 15, 16). Wave-2 parallel execution in Phase 16 used 2 concurrent gsd-executors.
- Sessions: ~2 days of execution (Phases 10-12 mechanical, Phase 13 fingerprinting, Phase 14-16 the C2PA core). Adversarial review added ~30-45 minutes per crypto-correctness phase.
- Notable: Phase 16's 5 plans + adversarial review + 5 plan revisions + 4 wave-execution dispatches + 1 verification + 1 milestone audit = ~5.5 hours of agent time across all subagents. The adversarial review step paid back ~20-30× in caught-bugs-at-plan-stage. Token spend was concentrated in the planning phase (large plans + plan-check + revisions); execution was relatively cheap once plans were correct.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 9 | 46 | Established the GSD pattern: research → plan → execute → verify → audit → gap-close. Established cross-cutting invariant test tier. |
| v1.1 | 7 | 24 | Established adversarial-review-at-plan-stage for crypto-correctness phases (codex-substitute pattern). Established wave-based parallel orchestration with explicit depends_on frontmatter. Established multi-layer invariant verification (helper + integration + wire + E2E). Architecture-purity allowed-set extension pattern for restricted imports. |

### Cumulative Quality

| Milestone | Test Baseline | Tool Cap Used | LOC | Cross-Cutting Tests |
|-----------|---------------|---------------|-----|---------------------|
| v1.0 | 760/763 | 6/12 (workspace, project, sequence, shot, generation, version) + asset | 25,543 TS | 3 (architecture-purity, phase-attribution, validation-flags) |
| v1.1 | 1365/1372 | 7/12 (added asset to top-level; version actions 4 → 7) | ~30,000 TS (+~4,500) | 3 (architecture-purity extended to c2pa-node allowed-set; phase-attribution + validation-flags ROADMAP-shape adjusted) |

### Top Lessons (Verified Across Milestones)

1. **Don't punt on tests** — first appeared as Phase 3 UAT decision; reinforced in Phase 4 (verify-phase4-tool-surface.mts), Phase 7 (live-smoke), Phase 14 (c2pa-uat-mcp-tool wire-level), Phase 16 (verify-phase16-uat.mts smoke against live server). VERIFIED across 2 milestones.
2. **Audit-driven close beats feature-driven close** — established v1.0; VERIFIED v1.1 (gsd-audit-milestone after Phase 16 confirmed PASSED before complete-milestone). Plus its corollary: **Adversarial-review-driven plan beats optimistic-plan execute** — established v1.1 (Phase 14: 11 issues, Phase 15: FATAL flaw, Phase 16: 5 BLOCKERS + 6 CONCERNS, all caught at plan stage).
3. **Architecture-purity allowed-set tests scale linearly with restricted-import surface.** v1.0 had 1 (engine has zero MCP); v1.1 added c2pa-node restricted to 3 files. The pattern: when a dependency MUST live in a small allowed-set, codify the set in a sorted-array deepEqual assertion that fails on additions. Forces explicit review.
4. **Goal-backward verification catches "tasks-complete-but-phase-didn't-deliver."** New v1.1 lesson; will be tested in v1.2.
5. **Vendor-namespaced custom extensions sidestep spec ambiguity.** New v1.1 lesson (vfx_familiar.input/unavailable_ingredient/redacted vs c2pa.* reserved labels); will be tested as more C2PA spec interactions arrive in v1.2.
