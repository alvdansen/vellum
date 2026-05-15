# VFX Familiar

## What This Is

An open-source MCP server that layers VFX production structure (project/sequence/shot/version, full provenance, asset management) over ComfyUI Cloud's API — making any MCP-compatible AI agent into an intelligent VFX pipeline manager. Ships with a light web UI for project hierarchy and provenance visibility. Every generated output now carries a regulator-verifiable C2PA-signed manifest with AI-origin disclosure, ingredient graph, and SHA-256 model fingerprints.

## Core Value

A VFX artist tells their AI familiar what they need in natural language, and it manages the entire production pipeline — routing, versioning, provenance, organization — so they never touch a folder structure or lose track of what generated what. **Every output is cryptographically signed and verifiable** — meeting EU AI Act Article 50 + California SB 942 disclosure requirements at the file level.

## Current State

**Shipped:** v1.2 Visual & Conversational Dashboard — 2026-05-09 (3 phases, 18 plans; thumbnails, sortable dropdown, AI conversational summary). v1.1 Provenance Verification (C2PA) shipped 2026-04-30. v1.0 MVP shipped 2026-04-28.

**v1.3 starting (2026-05-11):** Production Shot Grid milestone. Goal: turn VFX Familiar into a complete production management tool — shot status workflow (WIP → Pending Review → Approved → On Hold), visual shot grid with thumbnails + status badges, review & approval surface, sequence completion stats, and the UX polish bundle deferred from v1.2 (hover-to-scrub, SSE streaming AI summary, per-shot sort persistence, cross-version narrative coherence). Phases 20+ TBD from roadmap.

**Stack:** TypeScript ESM Node MCP server, dual-transport (stdio + Streamable HTTP), `@modelcontextprotocol/sdk` 1.29, Hono + `@hono/node-server`, `better-sqlite3` + Drizzle ORM (WAL + busy_timeout=5000), Zod v4, nanoid, Preact + Vite dashboard, Vitest. C2PA via `c2pa-node` v0.5.26 (lazy-imported, restricted to `src/engine/c2pa/{signer,verifier,redaction}.ts`).

**Tool surface:** 7 of 12 MCP tools (workspace, project, sequence, shot, version, generation, asset). The `version` tool now has 7 actions (get + list + diff + provenance + export_manifest + verify_manifest + redact_manifest).

**Live API:** ComfyUI Cloud locked at `https://cloud.comfy.org` with healthcheck path `/api/system_stats`; live-smoke verified 2/2 green via Phase 7.

## Current Milestone: v1.3 Production Shot Grid

**Goal:** Turn VFX Familiar into a complete AI production management tool for VFX professionals — add a shot-status workflow with visual shot grid, review & approval surface, and sequence-level production tracking, plus the UX polish bundle deferred from v1.2.

**Driver:** Artist feedback: VFX Familiar needs to cover the full production management surface that tools like ShotGrid/ftrack/Kitsu provide, so a team can manage status, review outputs, and track progress without leaving the AI-native pipeline.

**Target features:**
1. **Shot status workflow** — WIP → Pending Review → Approved → On Hold; append-only status events (same provenance-event pattern as v1.0/v1.1); MCP tool surface so agents can query and update production status programmatically (within 12-tool cap).
2. **Shot grid view** — visual matrix of shots: thumbnail, status badge (color-coded), version count, last-updated timestamp; quick filter by status/date; responsive grid layout.
3. **Review & approval** — approve/reject from grid with optional note, A/B version compare panel, per-version reviewer notes; status change triggers append-only event.
4. **Production overview** — sequence completion stats (% approved), project roll-up dashboard, shot-count and version-count summaries.
5. **UX polish bundle (v1.2 deferrals)** — hover-to-scrub preview on thumbnails, SSE streaming AI summary updates (real-time token streaming instead of single-shot response), per-shot sort persistence across sessions, cross-version narrative coherence (summary references parent version context).

**Key context:**
- Shot status workflow extends the existing provenance event table — append-only, no new top-level MCP tools required if status is a new action on the existing `shot` or `version` tool
- Shot grid is a new dashboard view composing existing `<Thumbnail/>` + new `<StatusBadge/>` primitives
- Review/approval requires a reviewer-notes column on a new or extended table — additive Drizzle migration
- SSE streaming AI summary needs Anthropic SDK streaming mode (already integrated in Phase 19, but single-shot); Phase 19 ships in permanent fallback mode for Claude Max users (no API key) — streaming is additive
- Tool cap: 7 of 12 used; shot-status actions likely fit as new action arms on existing tools

## Next Milestone Goals (v1.4+ Candidates)

**Theme:** C2PA hardening + multi-backend routing + enterprise features.

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

### Validated (v1.2 — Visual & Conversational Dashboard)

- ✓ **Thumbnails on Project/Shot Asset cards** — visual asset preview augments the side list, lazy-loaded with in-progress/missing fallback (Phase 17 complete 2026-05-02; sharp + ffmpeg-installer thumbnail engine, atomic disk cache, redact-invalidation hook, C2paShield overlay)
- ✓ **Sortable dropdown folder structure** — latest-first default + 4-option SortDropdown (WAI-ARIA APG combobox) + composite-cursor pagination + localStorage + URL state mirror (Phase 18 complete 2026-05-08)
- ✓ **AI-generated conversational asset summary** — Supervisor/Lead voice 2-4 sentences grounded in prompt blob + ingredient graph + model fingerprints; permanent fallback mode for Claude Max users (Phase 19 complete 2026-05-09; ships in fallback mode by design)

### Validated (v1.3 — Production Shot Grid, in progress)

- ✓ **Shot status workflow (backend)** — WIP → Pending Review → Approved → On Hold → Omit; append-only `shot_status_events` table + transactional dual-write in `shot-status-repo.ts`; `shot` tool gains 3 action arms (`set_status` / `get_status` / `list_status_history`) — tool count stays 7 of 12 cap; `shot.status_changed` SSE event wired through engine event bus (Phase 20 complete 2026-05-12; STAT-01..05 backend; dashboard surfaces deferred to Phase 21)

### Active (v1.3 — Production Shot Grid)

- [ ] **Shot grid view** — visual matrix: thumbnail, color-coded status badge, version count, last-updated; filter by status/date; responsive grid layout
- [ ] **Review & approval** — approve/reject from grid with optional note, A/B version compare panel, per-version reviewer notes; status changes emit append-only events
- [ ] **Production overview** — sequence completion stats (% approved), project roll-up, shot-count and version-count summaries
- [ ] **UX polish bundle (v1.2 deferrals)** — hover-to-scrub preview, SSE streaming AI summary, per-shot sort persistence, cross-version narrative coherence

### Active (v1.4+ candidates — deferred from v1.3 pivot)

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
*Last updated: 2026-05-15 — v1.3 Phase 22 (Review and Approval) complete. 7 plans shipped: server HTTP routes (PATCH /shots/:id/status + GET /versions/:a/diff-with/:b + GET /shots/:id/status-history), dashboard foundation (types + 3 fetch helpers + 66 copy constants), StatusChangePopover + MetadataDiff extraction, OverlayHost mutex (D-02) + state/review-panel.ts (6 signals), full ReviewPanel composition (Header + ActionBar + ActionButton + Timeline + mergeHistory), ABCompareView modal (parallel preload + Pitfall 7 fallback), and D-13 ShotGridCard refactor (3 sibling buttons + QuickApproveButton optimistic flow + ReviewTimeline compare-mode). All REV-01..REV-05 functional loops closed; 17/17 automated must-haves verified; 7 manual smoke items deferred to UAT. Tool count holds at 7/12. Dashboard suite 443/443; server suite 1868 passes (baseline preserved). Phase 23 (Production Stats) unblocked.*
