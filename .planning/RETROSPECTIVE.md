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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 9 | 46 | Established the GSD pattern: research → plan → execute → verify → audit → gap-close. Established cross-cutting invariant test tier. |

### Cumulative Quality

| Milestone | Test Baseline | Tool Cap Used | LOC | Cross-Cutting Tests |
|-----------|---------------|---------------|-----|---------------------|
| v1.0 | 760/763 | 6/12 (workspace, project, sequence, shot, generation, version) + asset | 25,543 TS | 3 (architecture-purity, phase-attribution, validation-flags) |

### Top Lessons (Verified Across Milestones)

*(To be populated as v1.1+ milestones validate or contradict v1.0 lessons.)*

1. **Don't punt on tests** — first appeared as Phase 3 UAT decision; reinforced in Phase 4 (verify-phase4-tool-surface.mts) and Phase 7 (live-smoke).
2. **Audit-driven close beats feature-driven close** — established v1.0; will be tested at v1.1 against the milestone-audit-then-close ritual.
