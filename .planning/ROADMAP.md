# Roadmap: VFX Familiar

## Overview

VFX Familiar delivers an MCP server that brings production VFX pipeline structure to AI-powered generative content via ComfyUI Cloud. Each milestone delivers a complete, independently verifiable capability set.

**v1.1** makes v1.0's private provenance signed, portable, and regulator-verifiable. Every generated output ships with a C2PA-signed manifest declaring AI origin, ingredient graph, and SHA-256 model fingerprints — with a redaction primitive that preserves the *fact* of redaction. Driven by EU AI Act Article 50 (effective Aug 2026) and California SB 942 (effective Jan 2026). Three demo-surfaced reliability gaps (DEMO-01..03) ride along.

## Milestones

- ✅ **v1.0 MVP** — Phases 1-9 (shipped 2026-04-28). Full archive: `milestones/v1.0-ROADMAP.md`, `milestones/v1.0-REQUIREMENTS.md`, `milestones/v1.0-MILESTONE-AUDIT.md`.
- 🚧 **v1.1 Provenance Verification (C2PA)** — Phases 10-16 (in progress). 7 phases, 10 requirements (7 PROV-V + 3 DEMO), 0 new top-level MCP tools (`version` gets two new actions, tool budget stays at 6 of 12 cap).

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-9) — SHIPPED 2026-04-28</summary>

**5 functional phases + 4 gap-closure phases. 46 plans, all verified green.**

- [x] Phase 1: Foundation & Hierarchy (3/3 plans) — completed 2026-04-20
- [x] Phase 2: ComfyUI Generation (3/3 plans) — completed 2026-04-21
- [x] Phase 3: Provenance & Versioning (3/3 plans) — completed 2026-04-22
- [x] Phase 4: Asset Management (5/5 plans) — completed 2026-04-22
- [x] Phase 5: Web Dashboard (13/13 plans) — completed 2026-04-23
- [x] Phase 6: Dashboard Wire Quality [GAP CLOSURE] (7/7 plans) — completed 2026-04-24
- [x] Phase 7: ComfyUI Endpoint Reconciliation [GAP CLOSURE] (8/8 plans) — completed 2026-04-24
- [x] Phase 8: Documentation Attribution Backfill [GAP CLOSURE] (3/3 plans) — completed 2026-04-25
- [x] Phase 9: Nyquist Wave 0 Closure [GAP CLOSURE] (1/1 plan) — completed 2026-04-28

See `milestones/v1.0-ROADMAP.md` for full phase details and `milestones/v1.0-MILESTONE-AUDIT.md` for the re-audit report.

</details>

### 🚧 v1.1 Provenance Verification (C2PA) — In Progress

**Milestone Goal:** Make every generated output carry a regulator-verifiable C2PA-signed manifest with AI-origin disclosure, ingredient graph, and full model fingerprinting — exposed at the agent boundary via `version.export_manifest` / `version.verify_manifest`. Close three v1.0-demo-surfaced reliability gaps along the way.

- [x] **Phase 10: Migrate-on-boot Hardening** — Server runs pending Drizzle migrations on boot or refuses to boot with a typed `MIGRATION_PENDING` error. (completed 2026-04-30)
- [x] **Phase 11: Recovery Poller Error Detail** — Async terminal failures surface ComfyUI Cloud `node_errors` instead of collapsing to `"ComfyUI reported failed"`. (completed 2026-04-30)
- [x] **Phase 12: Reproduce Divergence Transparency** — Dashboard renders a non-determinism pill + side-by-side parent-vs-reproduction comparison when reproduce-lineage outputs diverge. (completed 2026-04-30)
- [x] **Phase 13: Model Fingerprinting** — Every model in the resolved prompt blob gets a SHA-256 fingerprint captured in `models_json`; closes the `model_hash: null` gap at `src/engine/provenance.ts:69`. (completed 2026-04-30)
- [ ] **Phase 14: C2PA Signed Manifest Emission** — Signed manifests embedded in PNG/JPEG/MP4/WebP at download with explicit AI-origin disclosure; sidecar `.c2pa` for non-embed formats (EXR, PSD, TIFF).
- [ ] **Phase 15: Ingredient Graph** — Manifest carries `parentOf` / `componentOf` / `inputTo` assertions linking lineage parents, control/reference images, and prompt parameters by hash.
- [ ] **Phase 16: Redaction & Agent Surface** — Redaction primitive emits a derived manifest with `c2pa.redacted` assertion (originals stay append-only); two new `version` tool actions: `export_manifest` and `verify_manifest`.

## Phase Details

### Phase 10: Migrate-on-boot Hardening
**Goal**: Eliminate the silent stale-schema boot failure mode that surfaced during the v1.0 demo as opaque HTTP 500 (`no such table: tags`) errors. Server either applies pending migrations cleanly at startup or refuses to boot with an actionable typed error.
**Depends on**: Nothing (infrastructure prerequisite for all v1.1 phases — schema work in Phases 13-16 must land on a guaranteed-current DB)
**Requirements**: DEMO-01
**Success Criteria** (what must be TRUE):
  1. On startup, if `__drizzle_migrations` is behind the migrations folder, the server applies all pending migrations atomically before opening either transport.
  2. If migration application fails, the server exits non-zero with a `MIGRATION_PENDING`-typed error message naming the failed migration file and the suggested remediation.
  3. A unit test boots the server against a deliberately-stale DB fixture and asserts the `MIGRATION_PENDING` typed error path fires before any tool registration.
  4. Running the server against a clean (already-current) DB is a no-op on the migration path — no spurious migration apply, no lock contention with WAL.
**Plans**: 3 plans
  - [x] 10-01-PLAN.md — Add MIGRATION_PENDING ErrorCode + create runMigrations() helper (engine layer)
  - [x] 10-02-PLAN.md — Wire runMigrations() into openDb() boot path + clean-DB no-op test
  - [x] 10-03-PLAN.md — Stale-DB / migration-failure test (typed error fires before tool registration)

### Phase 11: Recovery Poller Error Detail
**Goal**: Make async terminal-failure provenance match submit-time fidelity. Today the recovery poller collapses every terminal failure to `"ComfyUI reported failed"`; the submit path already extracts `node_errors` via `extractFirstNodeError(...)`. Mirror the submit pattern in the recovery poller so failed-version provenance carries the actionable Cloud detail.
**Depends on**: Phase 10 (migrations current — recovery-poller path writes to the provenance table)
**Requirements**: DEMO-02
**Success Criteria** (what must be TRUE):
  1. When the recovery poller observes a terminal `failed` Cloud status with a `node_errors` body, the resulting provenance failed-event row carries the extracted human-readable detail (e.g., `"Unauthorized: Please login first"`, `"value_not_in_list: ckpt_name 'X' not in []"`) — not the generic collapse string.
  2. The submit-time and recovery-poller error-extraction paths share a single helper (`extractFirstNodeError` or equivalent), proven by a same-fixture test that asserts both paths produce identical extracted detail.
  3. Existing failed-version dashboard cards render the new actionable error string verbatim — no field renaming, no UI rework.
  4. When `node_errors` is absent or unparseable, the path falls back gracefully to the generic `"ComfyUI reported failed"` string with no thrown error.
**Plans**: 2 plans
  - [x] 11-01-PLAN.md — flattenComfyError helper + dual call-site refactor (helper + unit tests)
  - [x] 11-02-PLAN.md — Same-fixture parity test (helper + submit-path + status-path)

### Phase 12: Reproduce Divergence Transparency
**Goal**: When a reproduce-lineage output diverges from its parent (because the partner-API model is non-deterministic, or because a SHA-256 of v3's output differs from v4's despite verbatim prompt replay), surface that divergence in the UI rather than silently shipping a "reproduction" that isn't bit-identical.
**Depends on**: Phase 10 (migrations current)
**Requirements**: DEMO-03
**Success Criteria** (what must be TRUE):
  1. The version drawer renders a "non-deterministic — outputs may differ from parent" pill on any reproduce-lineage version when the partner-API response carried a non-determinism warning OR the SHA-256 of the reproduction output differs from the parent's output.
  2. The version drawer surfaces a side-by-side "parent vs reproduction" image comparison block when both outputs exist on disk.
  3. `version.diff` (engine + tool path) optionally includes a `reproduction_divergence` field carrying the SHA-256 mismatch detail and any partner-API non-determinism warnings.
  4. A reproduce-lineage version whose output IS bit-identical to its parent shows no divergence pill and no comparison block — the UI signal is unambiguous.
**Plans**: 2 plans
  - [x] 12-01-PLAN.md — Engine: 0005 migration + reproduction_warnings_json column + DiffResponse.reproduction_divergence field + computeOutputSha256 helper + facade wiring
  - [x] 12-02-PLAN.md — Dashboard: WarningPill + VersionDrawer auto-fetch on reproduce-lineage + side-by-side parent-vs-reproduction comparison block
**UI hint**: yes

### Phase 13: Model Fingerprinting
**Goal**: Capture a SHA-256 fingerprint for every model referenced in the resolved prompt blob (checkpoints, LoRAs, VAEs, ControlNet weights, refiners) into the version's `models_json`. This is the foundational data layer that Phase 14's C2PA manifest and Phase 15's ingredient graph reference. Closes the documented `model_hash: null` gap at `src/engine/provenance.ts:69`.
**Depends on**: Phase 10 (`models_json` shape may evolve — needs migrate-on-boot guarantee)
**Requirements**: PROV-V-03
**Success Criteria** (what must be TRUE):
  1. Every model name surfaced by `extractModels()` from the resolved prompt blob has a populated `model_hash` SHA-256 field in the version's `models_json` (no more `model_hash: null` for resolvable models).
  2. When a model file is unreachable from the server's resolution path, the entry records a typed `model_hash_unavailable: <reason>` rather than silently nulling — auditability over best-effort.
  3. Fingerprint capture is content-addressed: identical model bytes across two versions yield identical hashes (proven by a fixture test using a stable test model file).
  4. Fingerprinting does not block the generation hot path — hashes are computed and persisted on a background path that retries on transient I/O errors.
  5. The architecture-purity test continues to pass: model fingerprinting lives in the engine layer, with zero MCP/tool/HTTP imports.
**Plans**: 3 plans
  - [x] 13-01-PLAN.md — ModelRef extension + MODEL_DIR_BY_CLASS + fingerprintModel helper (engine layer + unit tests)
  - [x] 13-02-PLAN.md — Wire fingerprinter into completion path + sibling models_fingerprinted provenance event (idempotent, non-blocking)
  - [x] 13-03-PLAN.md — Diff-side parity (model_hash_unavailable transitions) + end-to-end integration tests + file-level architecture-purity assertion

### Phase 14: C2PA Signed Manifest Emission
**Goal**: Embed a signed C2PA manifest in every generated output at download time, with an explicit AI-origin disclosure assertion (`c2pa.created` + ComfyUI as generator). For formats not on C2PA's native-embed list, write a sidecar `.c2pa` file alongside the output. This phase establishes the manifest emission scaffolding that Phase 15's ingredient graph and Phase 16's redaction primitive build on.
**Depends on**: Phase 13 (model fingerprints flow into the manifest as a baseline — even before Phase 15 promotes them into the full ingredient graph)
**Requirements**: PROV-V-01, PROV-V-02, PROV-V-05
**Success Criteria** (what must be TRUE):
  1. Downloads via `/api/versions/:id/output` (dashboard streaming route) and the engine's direct-to-disk write path both produce outputs with a valid embedded C2PA manifest for PNG / JPEG / MP4 / WebP, verifiable by an independent C2PA verifier (e.g., `c2patool`).
  2. Every embedded manifest includes a `c2pa.created` assertion naming ComfyUI as the generator/softwareAgent and surfacing the workflow's primary model as the digitalSourceType.
  3. For OpenEXR / EXR sequences / PSD / TIFF outputs, the engine writes a sidecar `.c2pa` file at `<output>.c2pa` and the dashboard surfaces both the original artifact and the sidecar manifest as distinct downloadable resources.
  4. The signing path uses a single configured local C2PA cert (no HSM, no federated trust roots — explicit v1.1 scope per REQUIREMENTS Out-of-Scope table); private key never logged, never returned in any tool envelope, never echoed to stdout.
  5. Dual-transport parity holds: stdio and Streamable HTTP paths both emit identical manifests for the same version (verified by an integration test that downloads via both transports and bit-compares the manifest bytes).
**Plans**: 5 plans
  - [x] 14-01-PLAN.md — Dependency + env config + dev cert helper
  - [x] 14-02-PLAN.md — C2PA module: manifest builder + signer wrapper + format router
  - [x] 14-03-PLAN.md — Engine integration: embed/sidecar emitter + provenance event
  - [ ] 14-04-PLAN.md — HTTP route integration + dashboard sidecar surface
  - [ ] 14-05-PLAN.md — Verification + parity + key-leak negative tests
**UI hint**: yes

### Phase 15: Ingredient Graph
**Goal**: Promote the C2PA manifest from "AI-origin disclosure + model fingerprints" to a full ingredient graph: `parentOf` for lineage (reproduce/iterate parents), `componentOf` for prompt-referenced control/reference/IP-Adapter inputs, `inputTo` for prompt text + key parameters. Each ingredient links to its source artifact by hash where available.
**Depends on**: Phase 14 (manifest scaffolding) + Phase 13 (model fingerprints already populated)
**Requirements**: PROV-V-04
**Success Criteria** (what must be TRUE):
  1. Manifests for reproduce-lineage and iterate-lineage versions carry a `parentOf` ingredient assertion linking the parent version's manifest by hash.
  2. Manifests carry a `componentOf` assertion for every non-loader-node input image referenced in the prompt blob (control images, reference images, IP-Adapter inputs), linked by SHA-256 of the input bytes when the file is reachable.
  3. Manifests carry an `inputTo` assertion encoding the resolved prompt text plus the seed and the primary sampler parameters as a structured payload.
  4. A test fixture that generates v1, reproduces it as v2 (control image + LoRA), and iterates from v2 as v3 produces a v3 manifest whose ingredient graph traces back through v2 → v1, with control-image and LoRA hashes pinned at every step — verifiable by an independent C2PA reader.
  5. When an ingredient's source artifact is unreachable (e.g., control image deleted from disk after generation), the assertion records the dangling-reference state rather than silently dropping the ingredient.
**Plans**: 3 plans
  - [ ] 10-01-PLAN.md — Add MIGRATION_PENDING ErrorCode + create runMigrations() helper (engine layer)
  - [ ] 10-02-PLAN.md — Wire runMigrations() into openDb() boot path + clean-DB no-op test
  - [ ] 10-03-PLAN.md — Stale-DB / migration-failure test (typed error fires before tool registration)

### Phase 16: Redaction & Agent Surface
**Goal**: Close the v1.1 surface at the agent boundary. Add a redaction primitive that strips sensitive prompt/metadata values from a version's manifest while emitting a `c2pa.redacted` assertion preserving the *fact* of redaction (originals remain append-only in the `provenance` table). Add the two new `version` MCP tool actions: `export_manifest` (returns the C2PA-signed manifest) and `verify_manifest` (verifies signature + reports gaps). Tool budget stays at 6 of 12 — no new top-level tool.
**Depends on**: Phase 15 (full manifest ingredient graph must exist before redaction can operate on it)
**Requirements**: PROV-V-06, PROV-V-07
**Success Criteria** (what must be TRUE):
  1. The redaction primitive accepts a version_id + a redaction policy (which fields/assertions to strip) and produces a *new derived* manifest carrying a `c2pa.redacted` assertion that names the redacted fields without exposing their original values; the original signed manifest in `provenance` is byte-for-byte unchanged (append-only contract preserved).
  2. `version.export_manifest` returns the C2PA-signed manifest (or its closest derived form) for any version_id in a structured envelope with breadcrumb, conforming to the v1.0 dual-form response contract.
  3. `version.verify_manifest` accepts a manifest payload (or a version_id), verifies the signature against the configured trust root, and returns a structured report listing matched assertions, gaps, and any signature failures — with actionable, agent-readable error detail when verification fails.
  4. The architecture-purity test passes: redaction logic and manifest export/verify live in the engine layer; the `version` tool is a thin Zod-validated entry point with no engine logic inline. Tool count stays at 6 (no new top-level tool registration).
  5. The discriminated-union schema for the `version` tool extends cleanly: `export_manifest` and `verify_manifest` round-trip through stdio AND Streamable HTTP transports identically (parity test green).
  6. The cross-cutting `phase-attribution.test.ts` and `validation-flags.test.ts` guards remain green; the architecture-purity test gains explicit assertions blocking C2PA SDK imports outside `src/engine/c2pa/`.
**Plans**: 3 plans
  - [ ] 10-01-PLAN.md — Add MIGRATION_PENDING ErrorCode + create runMigrations() helper (engine layer)
  - [ ] 10-02-PLAN.md — Wire runMigrations() into openDb() boot path + clean-DB no-op test
  - [ ] 10-03-PLAN.md — Stale-DB / migration-failure test (typed error fires before tool registration)

## Future Milestones

- **Multi-Backend Routing** (ROUTE-01..03) — route generation to specific ComfyUI instances by capability with failover.
- **Function-Calling Adapter** (ADAPT-01..03) — OpenAI-compatible REST endpoint for non-MCP agents.
- **Advanced Operations** (ADV-01..04) — batch queuing, webhooks, hierarchy export, lineage visualization.
- **C2PA hardening (v1.2+ candidates):** HSM/Yubikey signing, multi-CA / federated trust roots, streaming-friendly C2PA for live video, in-dashboard manifest editor, cross-shot/cross-project manifest aggregation, watermarking channel.

## Progress

**Execution Order:**
Phases execute in numeric order: 10 → 11 → 12 → 13 → 14 → 15 → 16. Phases 10/11/12 are independent of one another (all only depend on the v1.0 baseline + Phase 10's migrate-on-boot guarantee for the schema); Phases 13 → 14 → 15 → 16 form a strict dependency chain.

| Phase | Milestone | Plans | Status   | Completed  |
| ----- | --------- | ----- | -------- | ---------- |
| 1. Foundation & Hierarchy           | v1.0 | 3/3 | Complete | 2026-04-20 |
| 2. ComfyUI Generation               | v1.0 | 3/3 | Complete | 2026-04-21 |
| 3. Provenance & Versioning          | v1.0 | 3/3 | Complete | 2026-04-22 |
| 4. Asset Management                 | v1.0 | 5/5 | Complete | 2026-04-22 |
| 5. Web Dashboard                    | v1.0 | 13/13 | Complete | 2026-04-23 |
| 6. Dashboard Wire Quality           | v1.0 | 7/7 | Complete | 2026-04-24 |
| 7. ComfyUI Endpoint Reconciliation  | v1.0 | 8/8 | Complete | 2026-04-24 |
| 8. Documentation Attribution Backfill | v1.0 | 3/3 | Complete | 2026-04-25 |
| 9. Nyquist Wave 0 Closure           | v1.0 | 1/1 | Complete | 2026-04-28 |
| 10. Migrate-on-boot Hardening       | v1.1 | 3/3 | Complete   | 2026-04-30 |
| 11. Recovery Poller Error Detail    | v1.1 | 2/2 | Complete   | 2026-04-30 |
| 12. Reproduce Divergence Transparency | v1.1 | 2/2 | Complete   | 2026-04-30 |
| 13. Model Fingerprinting            | v1.1 | 3/3 | Complete   | 2026-04-30 |
| 14. C2PA Signed Manifest Emission   | v1.1 | 3/5 | In Progress|  |
| 15. Ingredient Graph                | v1.1 | 0/TBD | Not started | - |
| 16. Redaction & Agent Surface       | v1.1 | 0/TBD | Not started | - |
