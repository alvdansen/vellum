# VFX Familiar

## What This Is

An open-source MCP server that layers VFX production structure (project/sequence/shot/version, full provenance, asset management) over ComfyUI Cloud's API — making any MCP-compatible AI agent into an intelligent VFX pipeline manager. Ships with a light web UI for project hierarchy and provenance visibility. Every generated output now carries a regulator-verifiable C2PA-signed manifest with AI-origin disclosure, ingredient graph, and SHA-256 model fingerprints.

## Core Value

A VFX artist tells their AI familiar what they need in natural language, and it manages the entire production pipeline — routing, versioning, provenance, organization — so they never touch a folder structure or lose track of what generated what. **Every output is cryptographically signed and verifiable** — meeting EU AI Act Article 50 + California SB 942 disclosure requirements at the file level.

## Current State

**Shipped:** v1.1 Provenance Verification (C2PA) — 2026-04-30 (7 phases, 24 plans, +605 net new tests, baseline 1365/1372 passing). v1.0 MVP shipped 2026-04-28.

**v1.2 Phase 17 complete (2026-05-02):** Visual thumbnails — sharp + @ffmpeg-installer/ffmpeg sole-importer engine, atomic disk cache with strong-ETag content-addressed validator, D-05 redact-invalidation hook, dashboard `<Thumbnail/>` + `<C2paShield/>` (Adobe CR mark, Apache 2.0) wired into VersionCard grid + TreeSidebar shot rows. 6/6 must-haves verified, 0 critical/0 blocking from code review, 7 human-UAT items pending. Phase 18 (sortable folder dropdown) unblocked.

**v1.2 Phase 18 complete (2026-05-08):** Sortable folder dropdown — Latest-first version-grid default + A→Z tree default + 4-option SortDropdown (WAI-ARIA APG combobox) + LoadMoreButton with composite-cursor pagination + localStorage persistence + URL state mirror. Engine: Drizzle ORDER BY composer with closed enum whitelist (`completed_at | created_at | name | version_number` × `asc | desc`); composite cursor `(NULL-bit, sort_value, version_id)` for stable pagination. HTTP boundary: 3 Zod parsers (T-18-01/T-18-02/T-18-03/T-18-04 mitigated; 4xx INVALID_INPUT envelope; never echoes input). D-10 back-compat preserved — MCP tool callers continue to compile + execute without modification (167/167 tool tests green). 5/5 must-haves verified, 6 human-UAT items pending (visual + keyboard + URL round-trip). Phase 19 (AI conversational summary — adversarial review mandatory) unblocked.

**Stack:** TypeScript ESM Node MCP server, dual-transport (stdio + Streamable HTTP), `@modelcontextprotocol/sdk` 1.29, Hono + `@hono/node-server`, `better-sqlite3` + Drizzle ORM (WAL + busy_timeout=5000), Zod v4, nanoid, Preact + Vite dashboard, Vitest. C2PA via `c2pa-node` v0.5.26 (lazy-imported, restricted to `src/engine/c2pa/{signer,verifier,redaction}.ts`).

**Tool surface:** 7 of 12 MCP tools (workspace, project, sequence, shot, version, generation, asset). The `version` tool now has 7 actions (get + list + diff + provenance + export_manifest + verify_manifest + redact_manifest).

**Live API:** ComfyUI Cloud locked at `https://cloud.comfy.org` with healthcheck path `/api/system_stats`; live-smoke verified 2/2 green via Phase 7.

## Current Milestone: v1.2 Visual & Conversational Dashboard

**Goal:** Make the VFX Familiar dashboard a visual-first experience for VFX artists — replace text-heavy node listings with thumbnails on Project/Shot Asset cards, add smart sorting (latest-first by default) in the folder dropdown structure, and replace the raw "summary lists nodes" with an AI-written conversational summary that reads like a Supervisor or Lead describing what was made and how.

**Driver:** Direct VFX artist feedback (Timothy Paul Bielec, 2026-04-30): "VFX artists are very visual learners (no surprise huh?) so if you could feature thumbnails for the Project or Shot Asset below, that would be very helpful. Also different sorting options so you can pull up latest generations quickly in the dropdown folder structure would be neat. It would be really cool if the 'Summary' didn't just list the nodes, but instead provided an intelligent summary of the asset and the workflow that was used to make it. Make it feel conversational like a Supervisor or Lead wrote it."

**Target features:**
1. **Thumbnails on Project/Shot Asset cards** — every asset card in the side list and main grid surfaces the rendered output thumbnail (lazy-loaded, fallback for in-progress/missing). The list view stays — thumbnails augment, not replace.
2. **Sortable dropdown folder structure** — folder/asset pickers default to "latest first" with toggleable sort options (date created, version number, name, modified). State preserved per user preference.
3. **AI-generated conversational asset summary** — replaces raw node listing in the VersionDrawer "Summary" section. Style: Supervisor/Lead writing 2-4 sentences about what was made (e.g., "v003 is a tighter close-up of the dragon's eye, generated with Flux + the cinematic_fantasy LoRA at seed 42, swapping the wide-angle env map for a HDRI from the parent shot."). Built on top of the existing prompt blob + Phase 15 ingredient graph + Phase 13 model fingerprints — grounded in actual provenance, not hallucination.

**Pivot context:** v1.2 was tentatively scoped at v1.1 close as "C2PA Hardening" (HSM/Yubikey signing, EXR/PSD sidecar, multi-CA trust roots). The artist feedback indicates dashboard UX is the higher-value next step — direct user-demand signal vs. infrastructure improvement. C2PA hardening shifts to v1.3+ candidate scope (deferred items remain documented in v1.1 archive).

**Key context:**
- All three features build on existing v1.0/v1.1 surfaces — no new top-level MCP tools needed (tool count holds at 7 of 12)
- Conversational summary requires LLM-at-engine-layer for the first time — adds a dependency surface (model choice, latency budget, cost-per-call, fallback) that drives research
- Thumbnails require a new dashboard route + asset thumbnail pipeline; current `/api/versions/:id/output` serves full-size bytes
- Existing `version.diff` + Phase 15 ingredient graph + Phase 13 model fingerprints give the conversational summary structured ground truth

## Next Milestone Goals (v1.3+ Candidates)

**Theme:** C2PA hardening + cloud-mode parity + multi-backend routing.

**Candidate scope:**
- HSM/Yubikey signing — get the private key out of process heap (T-14-12 follow-up)
- Cryptographic sidecar manifests for EXR/PSD when `c2pa-node` exposes the sidecar API
- Sidecar HTTP route + dashboard download link (paired with above)
- Multi-CA / federated trust roots for production deployments
- IPAdapter pack node-variants audit (~12 forms; Plan 15-01 audit limit)
- Fetch control image bytes from ComfyUI Cloud input store at sign time (REVISION C3 follow-up)
- Parent-bytes LRU cache (T-15-07 acceptance)
- Full ingredient mirror in redacted manifests (deferred-ingredient-mirror)
- Redaction path size-guard symmetry (BUFFER_SIGNING_MAX_BYTES enforcement on redact)
- Streaming-friendly C2PA for live video

Plus carried-forward backlog: Multi-Backend Routing (ROUTE-01..03), Function-Calling Adapter (ADAPT-01..03), Advanced Operations (ADV-01..04).

## Requirements

### Validated (v1.0)

- ✓ Project hierarchy: workspace → project → sequence → shot → version — v1.0 (Phase 1: 76 unit tests + 56 live-client smoke checks; dual-transport parity locked)
- ✓ MCP server wraps ComfyUI Cloud API as structured tools (submit, status) with async non-blocking generation and exponential-backoff polling — v1.0 (Phase 2: GEN-01..07; SSRF-safe redirect gate; Phase 7 endpoint reconciliation made live-smoke green)
- ✓ Automatic versioning on every generation (never overwrites) — v1.0 (Phase 2: VersionRepo MAX(version_number)+1 + append-only markCompleted guard)
- ✓ Full provenance capture: workflow JSON, prompt JSON, seed, model names (checksums nullable), timestamp — v1.0 (Phase 3: PROV-01..06; append-only ProvenanceRepo + two-event submit/terminal model)
- ✓ Diff between versions — v1.0 (Phase 3: pure diffVersions returning structured {summary, changes:{params, models, seed, workflow, metadata}})
- ✓ Reproduce any version exactly — v1.0 (Phase 3: engine.reproduceVersion re-submits stored prompt_json verbatim with lineage_type='reproduce')
- ✓ Iterate from a version with specified changes — v1.0 (Phase 3: node-scoped overrides with FORBIDDEN_KEYS prototype-pollution guard + optional seed shortcut; lineage_type='iterate' + parent_version_id)
- ✓ Asset tagging and arbitrary metadata attachment — v1.0 (Phase 4: idempotent TagRepo/MetadataRepo; asset MCP tool with 7-action Zod discriminated union)
- ✓ Asset query/filter by tags, metadata, project hierarchy, date range — v1.0 (Phase 4: AND-only SQL filters with json_each tag membership, scope XOR, inclusive date range, paginated with total_count)
- ✓ Light web UI showing project hierarchy, provenance trail, and live generation status — v1.0 (Phase 5: 13 plans, Preact + Tailwind v4 + signals; SSE wire-shape adapter at Plan 05-13 unblocked WEBUI-03; Phase 6 closed wire-quality tech debt)
- ✓ Coarse-grained MCP tool design at or below 12-tool cap with structured envelope + actionable errors — v1.0 (TOOL-01..05 enforced by architecture-purity tests across all phases)

### Validated (v1.1)

- ✓ **C2PA-signed manifest emission** in PNG/JPEG/MP4/WebP/TIFF at download — v1.1 (PROV-V-01, Phase 14; `c2pa.hash.data` + `c2pa.hash.bmff` cryptographic binding; tamper detection verified)
- ✓ **AI-origin disclosure assertion** (`c2pa.created` + ComfyUI softwareAgent + trainedAlgorithmicMedia) — v1.1 (PROV-V-02, Phase 14)
- ✓ **SHA-256 model fingerprints** for every checkpoint/LoRA/VAE/ControlNet referenced — v1.1 (PROV-V-03, Phase 13; closes `model_hash: null` gap at provenance.ts:69; flows into manifest as primaryModel)
- ✓ **Ingredient graph** — `parentOf` (lineage) + `componentOf` (control/reference images) + `vfx_familiar.input` vendor assertion (prompt + sampler params + seed) — v1.1 (PROV-V-04, Phase 15; KSampler edge walk for prompt resolution; v3→v2→v1 traceback verified by independent c2pa-node read)
- ⚠ **Sidecar `.c2pa` for non-embed formats** — v1.1 PARTIAL (TIFF promoted to native-embed which is BETTER; EXR/PSD deferred to v1.2 pending c2pa-node sidecar API; explicit scope reduction in REQUIREMENTS.md)
- ✓ **Redaction primitive** with `vfx_familiar.redacted` vendor assertion preserving the FACT of redaction — v1.1 (PROV-V-06, Phase 16; original signed manifest stays append-only; multi-encoding leak scan UTF-8/UTF-16LE/UTF-16BE/base64 + emoji clean at 4 layers)
- ✓ **`version.export_manifest` + `version.verify_manifest` (+ `redact_manifest`) MCP tool actions** — v1.1 (PROV-V-07, Phase 16; dual-transport parity stdio + Streamable HTTP; tool count stays 7 of 12 cap; version actions 4 → 7)
- ✓ **Migrate-on-boot or refuse with `MIGRATION_PENDING`** — v1.1 (DEMO-01, Phase 10; runMigrations wraps drizzle migrate with typed-error surface; clean-DB no-op proven)
- ✓ **Recovery poller surfaces ComfyUI Cloud `node_errors`** — v1.1 (DEMO-02, Phase 11; flattenComfyError single source for submit + recovery paths; 14-case parity test green)
- ✓ **Reproduce-divergence transparency** with WarningPill + side-by-side comparison — v1.1 (DEMO-03, Phase 12; reproduction_divergence field on DiffResponse)

### Active (v1.2 — Visual & Conversational Dashboard)

- [x] **Thumbnails on Project/Shot Asset cards** — visual asset preview augments the side list, lazy-loaded with in-progress/missing fallback (Phase 17 complete 2026-05-02; sharp + ffmpeg-installer thumbnail engine, atomic disk cache, redact-invalidation hook, C2paShield overlay; 7 human UAT items pending in 17-HUMAN-UAT.md)
- [ ] **Sortable dropdown folder structure** — latest-first default + toggleable sort (date, version, name, modified) with per-user state preservation
- [ ] **AI-generated conversational asset summary** — Supervisor/Lead voice 2-4 sentences grounded in prompt blob + Phase 15 ingredient graph + Phase 13 model fingerprints (no hallucination — structured provenance is ground truth)

### Active (v1.3+ candidates — deferred from v1.2 pivot)

- [ ] HSM/Yubikey signing — private key out of process heap
- [ ] Cryptographic sidecar manifests for EXR/PSD (gated on c2pa-node sidecar API)
- [ ] Multi-CA / federated trust roots
- [ ] IPAdapter pack node-variants audit (~12 forms)
- [ ] Fetch control image bytes from ComfyUI Cloud input store at sign time
- [ ] Parent-bytes LRU cache (T-15-07)
- [ ] Full ingredient mirror in redacted manifests
- [ ] Redaction path size-guard symmetry
- [ ] Streaming-friendly C2PA for live video
- [ ] Multi-backend routing (multiple ComfyUI instances by capability) — ROUTE-01..03 in archive
- [ ] Function-calling adapter for non-MCP agents (OpenAI-compatible REST) — ADAPT-01..03 in archive
- [ ] Demo video: full loop from natural language → structured VFX output at scale
- [ ] Advanced operations (ADV-01..04): batch queuing, webhooks, hierarchy export, lineage visualization

### Out of Scope

- Local ComfyUI installation management — targeting Cloud API, not local venvs (validated by Phase 2/7 — Cloud is the ship target)
- Custom node development — we wrap existing ComfyUI functionality
- ShotGrid/Ftrack integration — v2+ opportunity
- Real-time collaboration — single-user pipeline management first
- Workflow authoring UI — users bring their own ComfyUI workflows
- AI-powered scheduling/optimization — adds complexity without demo value
- Review/approval workflow — production feature, not pipeline management
- Multi-user authentication — single-artist demo scope
- C2PA manifest editor in dashboard — view + verify only; editing is a separate UX problem
- Watermarking (visible AI marker overlay) — C2PA cryptographic signing is the regulatory-grade primitive
- Cross-shot or cross-project manifest aggregation — per-version manifests are sufficient for the regulatory ask

## Context

**Industry Pain (from VFX conversations):**
- Studios can't adopt ComfyUI at scale (50-1000+ shots) due to asset management chaos
- They need Project → Sequence → Shot hierarchy with version control
- Full provenance is non-negotiable: workflow, params, seed, model version (checksummed), artist, machine, timestamp
- Doug Hogan (VFX industry): "We don't just care about the final image, we care about exactly HOW it was made"
- ComfyUI already embeds workflow in PNG metadata — we extend with project/shot/version context AND C2PA cryptographic signing
- This pain point surfaces in every studio conversation — high-value, immediate need
- **Regulatory layer (new for v1.1):** EU AI Act Article 50 (effective Aug 2026) and California SB 942 (effective Jan 2026) require AI-generated content disclosure; C2PA is the regulator-grade primitive for cryptographic provenance

**Technical Context (post-v1.1):**
- ComfyUI Cloud API base locked at `https://cloud.comfy.org`; healthcheck `/api/system_stats`; jobs at `/api/jobs` (Phase 7 D-EP-17)
- MCP SDK 1.29 — Zod inputSchema → structuredContent.code intercept caveat documented in 02-VERIFICATION.md (Phase 8)
- TypeScript MCP server avoids Python dependency conflicts with ComfyUI's environment
- SQLite WAL + busy_timeout=5000 + Drizzle ORM; 6 migrations (0001-0006); state lives at `~/.config/vfx-familiar/db.sqlite` by default. Phase 10 added migrate-on-boot guarantee.
- Preact + Tailwind v4 dashboard, ~38.55 kB JS + 21.70 kB CSS; v1.1 added `WarningPill` + `C2paBadge` components
- Test baseline: 1365/1372 passing as of Phase 16. 4 pre-existing v1.1-audit ROADMAP-shape failures (predates Phase 10; v1.0-shaped audit tests vs v1.1 ROADMAP layout) tracked at Phase 10 deferred-items.md
- Cross-cutting regression guards: `architecture-purity.test.ts` (35/35 — extends to block c2pa-node imports outside `src/engine/c2pa/{signer,verifier,redaction}.ts`), `phase-attribution.test.ts`, `validation-flags.test.ts`
- C2PA: `c2pa-node` v0.5.26 (lazy-imported via `await import('c2pa-node')` discipline; native binding load resilient via try/catch); dev cert generator at `scripts/gen-dev-c2pa-cert.mts`; production deploys configure VFX_FAMILIAR_C2PA_CERT_PEM_PATH + VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH + VFX_FAMILIAR_C2PA_TSA_URL; tests opt into dev cert via VFX_FAMILIAR_C2PA_TRUST_DEV_CERT=1

**Positioning:**
- Internal product feature proposal at ComfyUI org
- Demo targets the whole org (engineers + product + leadership)
- Open-source — community can extend, not locked to any AI provider
- The "VFX Familiar" brand: your AI assistant that knows your pipeline
- **Regulatory-ready (v1.1):** Every output ships with cryptographically signed AI disclosure — meets EU AI Act Article 50 + California SB 942 file-level disclosure requirements

## Constraints

- **API Target**: ComfyUI Cloud API (not local installs) — this is what the company ships
- **Language**: TypeScript — clean MCP SDK support, no Python conflicts, team familiarity
- **Demo Quality**: Must be taken seriously by the whole org — no hacky MVP vibes
- **Open Protocol**: MCP-native, with function-calling adapter — zero vendor lock-in
- **Portable Store**: SQLite — no external database dependency for the demo
- **Tool Cap**: 12 MCP tools max — coarse-grained `action` parameters; enforced at test layer (currently 7 of 12 used)
- **Append-only provenance**: provenance table has zero UPDATE/DELETE statements anywhere in src/ (architecturally locked)
- **C2PA architecture-purity**: c2pa-node imports restricted to `src/engine/c2pa/{signer,verifier,redaction}.ts` only; tool layer never imports c2pa-node directly

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript over Python | Avoids ComfyUI venv conflicts; better MCP SDK | ✓ Good — zero Python conflicts shipped |
| ComfyUI Cloud API (not local) | We work here; demo what we ship | ✓ Good — locked endpoint via Phase 7 |
| SQLite project store | Portable, serverless, embeddable | ✓ Good — WAL + busy_timeout=5000 production-ready |
| MCP as primary protocol | Open standard, multi-agent compatible | ✓ Good — works on Claude Desktop + Inspector |
| "VFX Familiar" branding | Resonant name for the AI pipeline assistant concept | ✓ Good |
| Light web UI included | Whole-org audience needs visual proof, not just CLI | ✓ Good — Preact + signals shipped under 60kB |
| GSD + Gstack harness | GSD parents lifecycle, Gstack gates quality at milestones | ✓ Good — 16 phases, 70 plans, full audit pipeline |
| Coarse-grained tool design (action params) | Stay under 12-tool cap; agent UX cleaner | ✓ Good — 7 of 12 cap consumed at v1.1; version actions 4 → 7 cleanly via discriminated union |
| Append-only provenance | Immutability is the core differentiator | ✓ Good — structurally enforced (zero UPDATE/DELETE in src/); v1.1 Phase 16 redact emits sibling row, original byte-identical |
| Dual-transport (stdio + Streamable HTTP) one process | Single binary; transport parity by construction | ✓ Good — buildServer factory; integration tests lock parity; Phase 16 wire-level UAT confirms 3 new actions parity |
| Drizzle ORM + hand-authored migrations | Schema diff visibility + readable SQL | ✓ Good — 6 migrations through v1.1; Phase 10 added migrate-on-boot guarantee |
| Inspector UI smoke replaced by programmatic MCP SDK client | UAT had to be wire-level, not vibe-level | ✓ Good — `scripts/inspector-smoke.mjs` 56/56 wire checks; Phase 14/16 added MCP-SDK Client wire-level UAT for C2PA actions (memory: don't punt on tests) |
| Plan 05-13 SSE wire-shape adapter | Engine event vs render contract drift was a class of bug | ✓ Good — pure adapter at serialization boundary, locked WEBUI-03 |
| 4 gap-closure phases (06-09) before v1.0 close | Audit-driven, not feature-driven; honest milestone | ✓ Good — re-audit flipped from `tech_debt` to `passed` |
| Lazy c2pa-node import (Phase 14 D-CTX-1) | Native binding load can fail in some environments; lazy import lets the rest of the server boot | ✓ Good — graceful degradation to unsigned; production fail-loud via env config |
| Single-cert C2PA config for v1.1 | One issuer (the user's local C2PA cert); HSM and multi-CA deferred to v1.2 | ✓ Good — operator-controllable TSA URL prevents silent third-party callout |
| Vendor-namespaced redaction assertion (`vfx_familiar.redacted`) | Matches Phase 15 `vfx_familiar.input` + `vfx_familiar.unavailable_ingredient` pattern; simpler than C2PA spec's native redacted_assertions for v1.1 | ✓ Good — ManifestAssertion union extended cleanly; clean re-sign with same Phase 14 cert |
| Unified `assetWriterMutex` (Phase 16 C-04 fix) | Sign + redact must serialize on (versionId, filename); old per-version sign coalescing was unsafe for redact | ✓ Good — adversarial review caught the silent-data-corruption pattern at planning stage; 30s timeout + REDACT_TIMEOUT mapping |
| Atomic disk write for redacted bytes (temp + rename) | Power-loss + concurrent-reader safety; mirrors Phase 14 download write discipline | ✓ Good — Plan 16-05 Scenario B verifies via Engine.exportManifestForVersion (not manual disk overwrite) |
| Adversarial codex-substitute review for crypto-correctness phases (14/15/16) | User mandate; codex CLI not installed | ✓ Good — caught 11 issues in Phase 14, 1 FATAL in Phase 15, 5 BLOCKERS + 6 CONCERNS in Phase 16; ALL revised before execute |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-02 — v1.2 Phase 17 (Visual Thumbnails) complete. 5 plans shipped: engine thumbnail foundation (sharp sole-importer + format router + atomic FS cache), MP4 first-frame extraction (@ffmpeg-installer/ffmpeg sole-importer with brightness fallback + 10s SIGKILL timeout), engine wired into pipeline + C2PA redact-invalidation hook (D-05 ordering — invalidate AFTER atomicRename), dashboard `<Thumbnail/>` + `<C2paShield/>` (Adobe CR mark, Apache 2.0), and consumer wiring into VersionCard grid + TreeSidebar shot rows + HomeView. All VIS-01..06 satisfied. 7 human-UAT items pending in 17-HUMAN-UAT.md (visual perception checks). Phase 18 (sortable folder dropdown) and Phase 19 (AI conversational summary) unblocked. v1.2 milestone started 2026-04-30 (pivot from C2PA hardening based on artist feedback).*
