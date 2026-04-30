# Requirements: VFX Familiar — Milestone v1.1 Provenance Verification (C2PA)

**Defined:** 2026-04-29
**Driver:** EU AI Act Article 50 (effective Aug 2026), California SB 942 (effective Jan 2026), and SEED-001 (Matt Collie, "C2PA Content Provenance for VFX", 2026).
**Thesis:** v1.0 captured private provenance as immutable SQLite rows. v1.1 makes that provenance signed, portable, and regulator-verifiable — every generated output ships with a C2PA-signed manifest declaring AI origin, ingredient graph, and model fingerprints, with a redaction primitive that preserves the *fact* of redaction.

## v1.1 Requirements

Each requirement maps to a single roadmap phase. Coarse-grained where appropriate (a single phase implements several related assertions).

### Provenance Verification (C2PA core)

- [x] **PROV-V-01**: Server emits a signed C2PA manifest embedded in supported output formats (PNG, JPEG, MP4, WebP) at the moment the version's output is downloaded — both via the dashboard streaming route (`/api/versions/:id/output`) and the direct file path the engine writes to disk. *(Phase 14 complete 2026-04-30. TIFF added as bonus native-embed format. Concern #8 cryptographic-binding closed: every signed manifest carries a c2pa.hash.data — or c2pa.hash.bmff for MP4 — assertion that c2pa-rs verifies against the asset bytes.)*
- [x] **PROV-V-02**: Manifest includes an explicit AI-origin disclosure assertion (`c2pa.created` action assertion with ComfyUI as the generator tool and the workflow's primary model surfaced as the digitalSourceType / softwareAgent). *(Phase 14 complete 2026-04-30.)*
- [x] **PROV-V-03**: Every model referenced in the resolved prompt blob (checkpoints, LoRAs, VAEs, ControlNet weights, refiners) has a SHA-256 fingerprint captured in the version's `models_json`. Fingerprints flow into the C2PA manifest as ingredient assertions. Closes the documented `model_hash: null` gap at `src/engine/provenance.ts:69`.
- [x] **PROV-V-04**: Manifest emits an ingredient graph composed of three assertion types: `parentOf` (lineage — reproduce/iterate parents), `componentOf` (prompt-referenced control images, reference images, mask / VAEEncode source images from non-loader nodes), `inputTo` (the prompt text + key parameters). Each ingredient is linked by hash to its source artifact when available. *(Phase 15 complete 2026-04-30. parentOf + componentOf flow through c2pa-node's `manifestBuilder.addIngredient` API and surface on `manifest.ingredients[]` (NOT assertions[]); each ingredient carries c2pa-node's labeled SHA hash bound to its source bytes. inputTo is a vendor-namespaced `vfx_familiar.input` custom assertion in `manifest.assertions[]` carrying the structured prompt_positive / prompt_negative (resolved via KSampler edge walk to CLIPTextEncode ancestors per REVISION B5) + sampler params + seed; T-15-01 mitigation caps prompts at 4096 chars and never emits workflow_json verbatim. Dangling references — when ingredient bytes are unreachable at sign time — are recorded via the vendor-namespaced `vfx_familiar.unavailable_ingredient` custom assertion (architectural constraint: c2pa-node's createIngredient REQUIRES asset bytes, so unreachable ingredients cannot be c2pa.ingredient entries). End-to-end traceback v1→v2→v3 verified by independent createC2pa().read() walk against `manifest.ingredients[]`; dangling-reference verified at the manifest read-back layer. v1.1 IMAGE_INPUT_CLASS_TYPES audit: LoadImage, LoadImageMask, VAEEncode, VAEEncodeForInpaint, ControlNetApply, ControlNetApplyAdvanced — IPAdapter pack node-variants tracked as v1.2 audit deferred. v1.1 production cloud-mode: componentOf hashes will surface as `vfx_familiar.unavailable_ingredient` in production cloud-only deployments because control image bytes are not reachable from the local outputRoot — see Deferred to v1.2 below.)*
- [x] **PROV-V-05**: For output formats not on C2PA's native-embed list (OpenEXR, EXR sequences, raw PSD/TIFF stacks, etc.), the engine writes a sidecar `.c2pa` manifest file alongside the output, named `<output>.c2pa`. The dashboard surfaces both the original file and the sidecar manifest. *(Phase 14 PARTIALLY COMPLETE 2026-04-30. v1.1 ships native-embed signing for TIFF (the spec assumed sidecar; native-embed via c2pa-node's file API is BETTER). EXR/PSD remain unsigned — c2pa-node v0.5.26 has no public sidecar API and no native handler; producing pseudo-sidecars by signing placeholders is cryptographically invalid. Tracked as v1.2 deferred under "Cryptographic sidecar manifests" — see Deferred to v1.2 below. Concern #2 scope reduction.)*
- [x] **PROV-V-06**: A redaction primitive lets a tool caller (or dashboard user) strip sensitive prompt/metadata values from a version's manifest while writing a `c2pa.redacted` assertion that preserves the *fact* of redaction. The original signed manifest stays append-only in `provenance`; redaction emits a new derived manifest. *(Phase 16 complete 2026-04-30. Engine module `src/engine/c2pa/redaction.ts` (D-CTX-1) ships the bounded-resolver redaction DSL + the `vfx_familiar.redacted` vendor assertion. The pure helper `applyRedactionPolicy` rejects regex / traversal / oversized policies via `REDACT_POLICY_INVALID`. The integration helper re-signs the asset with the same Phase 14 cert (D-PLAN-2-1) under the per-version sign mutex (D-PLAN-2-4) and appends a sibling `manifest_signed` event with `redacted: true` + `redacted_fields: string[]` (matched paths verbatim plus `not_found:<path>` audit-prefix entries for soft warnings — D-PLAN-2-5). Append-only contract verified at FOUR layers: helper Test 12 (JSON string-search of stringified output), integration Test 17 (c2pa.read of re-signed bytes — active-manifest projection), wire-level Tests 5/9 (Plan 16-04 stdio + HTTP — multi-encoding scan over active-manifest projection), E2E Test 1 (Plan 16-05 — multi-encoding scan + full-row SQLite byte-identity on the original manifest_signed row). v1.1 deferred: redacted manifest's `active_manifest.ingredients[]` carries only c2pa-rs's auto-promoted parent_relationship (the full Phase-15 component graph is NOT re-threaded through buildResult.ingredientSpecs); parent chain still verifiable via `store.manifests` traversal of embedded JUMBF; full ingredient mirror tracked as `deferred-ingredient-mirror` for v1.2. Multi-step redaction (redact-then-redact) supported at engine level but not surfaced at tool layer per CONTEXT.md "Deferred Multi-step redaction".)*
- [x] **PROV-V-07**: New MCP tool actions on the existing `version` tool: `version.export_manifest` (returns the C2PA-signed manifest for a version) and `version.verify_manifest` (verifies a manifest's signature and reports gaps). Tool budget stays under the 12-tool cap — no new top-level tool, just two new actions on `version`. *(Phase 16 complete 2026-04-30. Engine modules `src/engine/c2pa/exporter.ts` + `verifier.ts` (D-CTX-2 + D-CTX-3) ship the agent-side surface. `version.export_manifest` returns the signed manifest bytes base64-encoded inline with breadcrumb + ingredients_summary. `version.verify_manifest` accepts either `{version_id}` or `{manifest_bytes_base64, format}` and returns a structured `VerificationReport` with discriminated `signature_status: 'valid' | 'invalid' | 'untrusted_root' | 'unsupported_algorithm' | 'no_manifest'`, matched_assertions, gaps, failures. D-CTX-7 architecture-purity locked: zero c2pa-node imports in `src/tools/version-tool.ts` — all SDK access flows through Engine facade methods (Plans 16-01 + 16-02). Dual-transport parity verified at the wire boundary (Plans 16-03 + 16-04 + 16-05 — stdio StdioClientTransport + Streamable HTTP both deepEqual on read-only export). Tool count remains at 7 of 12 cap; version action count grows from 4 to 7 (export_manifest + verify_manifest + redact_manifest added).)*

### Reliability gaps surfaced by v1.0 demo

- [x] **DEMO-01**: Server runs pending Drizzle migrations on boot, OR refuses to boot with a clear actionable error when `__drizzle_migrations` is behind the filesystem. Today the server boots silently with stale schema; the only signal is a downstream HTTP 500 (`no such table: tags`) on the dashboard. A unit test verifies stale-DB boot fails with `MIGRATION_PENDING` typed error.
- [x] **DEMO-02**: The recovery poller surfaces rich ComfyUI Cloud error detail. Today async terminal failures all collapse to `"ComfyUI reported failed"` regardless of cause. The submit-time error path already extracts `node_errors` via `extractFirstNodeError(...)`; the recovery-poller path discards it. Mirror the submit pattern so failed-version provenance carries the actionable detail (e.g., `"Unauthorized: Please login first"`, `"value_not_in_list: ckpt_name 'X' not in []"`).
- [x] **DEMO-03**: The dashboard renders a "non-deterministic — outputs may differ from parent" pill on reproduce-lineage versions when the partner-API model warned about non-determinism, or when a SHA-256 of v3's output differs from v4's despite verbatim reproduction. The version drawer also surfaces a side-by-side "parent vs reproduction" image comparison so the divergence is visible. Optional: emit a `reproduction_divergence` field in `version.diff` carrying the SHA-256 mismatch + warning.

## Future Requirements

Carried forward from v1.0 archive — deferred past v1.1 unless explicitly pulled in:

- **ROUTE-01..03** Multi-backend routing across ComfyUI instances by capability with failover
- **ADAPT-01..03** OpenAI-compatible function-calling REST adapter for non-MCP agents
- **ADV-01..04** Advanced operations (batch shot queuing, webhooks, hierarchy export, lineage graph visualization)

## Out of Scope (v1.1 explicit exclusions)

| Feature | Reason |
|---------|--------|
| Hardware token signing (HSM/Yubikey) | Software signing only for v1.1; HSM is a v1.2+ concern |
| Multi-CA / federated trust roots | One issuer (the user's local C2PA cert) for v1.1 |
| Streaming-friendly C2PA for live video | Out of scope; v1.1 covers final-render outputs only |
| C2PA manifest editor in dashboard | View + verify only; editing is a separate UX problem |
| Cross-shot or cross-project manifest aggregation | Per-version manifests are sufficient for the regulatory ask |
| Watermarking (visible AI marker overlay) | C2PA cryptographic signing is the regulatory-grade primitive; watermarking is a separate channel |

## Deferred to v1.2

These items were scoped out of v1.1 during Phase 14 plan-review (Concerns #2 + T-14-12 follow-ups) and are tracked here for the v1.2 milestone:

- **Cryptographic sidecar manifests for EXR / PSD / unsupported formats.** Phase 14 v1.1 ships native-embed signing only for PNG / JPEG / MP4 / WebP / TIFF. EXR / PSD have no c2pa-rs handler, and c2pa-node v0.5.26 has no public sidecar API (`signEmbeddable` / `sign_no_embed` / equivalent). Pseudo-sidecars produced by signing a placeholder PNG are cryptographically invalid (the data hash binds to the placeholder, not the EXR being labeled). v1.2 will add cryptographic sidecar support pending: (a) c2pa-node exposing `signEmbeddable` / `sign_no_embed` in its JS API, OR (b) vfx-familiar binding directly to c2pa-rs. Tracked from Phase 14 plan-checker Concern #2.
- **Sidecar HTTP route + dashboard download link.** `GET /api/versions/:id/output.c2pa` returning sidecar bytes (HTTP 404 on miss, HTTP 200 + `application/c2pa` Content-Type on hit), plus a dashboard sidecar download link below the C2paBadge when status is `unsigned:unsupported_format` AND a real sidecar exists. Removed from v1.1 (Plan 14-04 revision) because no underlying mechanism exists. Reintroduce when the cryptographic sidecar API ships. Add the `isSidecarMode` helper guarded by an extension-table parity test (engine `SIDECAR_FORMATS` ↔ dashboard `SIDECAR_EXTENSIONS`).
- **HSM / hardware-key signing.** Phase 14 v1.1 keeps the private key in process heap (T-14-12 — accept disposition documented in 14-03-PLAN). v1.2 will add support for PKCS#11 / network-attached HSMs / cloud KMS so the private key never enters Node's heap.
- **Multi-CA / federated trust roots.** v1.1 ships single configured local cert. v1.2 expands trust root management for production deployments that issue certs through internal CA chains.
- **Streaming-friendly C2PA for live video.** v1.1 covers final-render outputs only.
- **Fetch control image bytes from ComfyUI Cloud input store at sign time** (REVISION C3, Plan 15-04 closure). v1.1 ships componentOf bytes loaded from the local outputRoot/<versionId>/<filename> path — appropriate for local-Comfy deployments. In production cloud-only deployments, control / reference / VAEEncode source images live on cloud storage (uploaded by the workflow's LoadImage node) and are NOT reachable via this path. The data layer is correct; the surface is honest — those ingredients surface as `vfx_familiar.unavailable_ingredient` assertions with reason='file_not_found'. v1.2 will add a fetch path that pulls control image bytes from the ComfyUI Cloud input store at sign time, populating componentOf with real labeled hashes.
- **IPAdapter pack node-variants — image-input class-type audit** (Plan 15-01 audit limit). The IPAdapter_Plus pack ships ~12 node variants (`IPAdapter`, `IPAdapterAdvanced`, `IPAdapterTiled`, `IPAdapterUnifiedLoader`, `IPAdapterFromParams`, etc.). Each consumes an image edge. v1.1 ships LoadImage / LoadImageMask / VAEEncode / VAEEncodeForInpaint / ControlNetApply / ControlNetApplyAdvanced coverage (the canonical core image-input nodes); IPAdapter variants require an audit against the installed pack source which is out-of-scope for v1.1. v1.2 will extend IMAGE_INPUT_CLASS_TYPES + IMAGE_FIELD_BY_CLASS to cover the full IPAdapter_Plus surface.
- **Per-(parent_version_id, signed_at) LRU cache for parent ingredient bytes** (T-15-07 acceptance). Plan 15-03's Engine.buildManifestForVersion reads the parent's signed file from disk on every child sign — a stat() + streaming read. For deep lineage chains the cost is bounded but per-sign. v1.2 will add an in-memory LRU cache keyed by (parentVersionId, parent.signed_at) to amortise the parent-bytes load across rapid child-sign storms.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROV-V-01 | Phase 14 | Complete (Phase 14, 2026-04-30) |
| PROV-V-02 | Phase 14 | Complete (Phase 14, 2026-04-30) |
| PROV-V-03 | Phase 13 | Complete |
| PROV-V-04 | Phase 15 | Complete |
| PROV-V-05 | Phase 14 | Partially Complete (Phase 14, 2026-04-30 — TIFF native-embed; EXR/PSD cryptographic sidecar deferred to v1.2) |
| PROV-V-06 | Phase 16 | Complete (Phase 16, 2026-04-30) |
| PROV-V-07 | Phase 16 | Complete (Phase 16, 2026-04-30) |
| DEMO-01   | Phase 10 | Complete |
| DEMO-02   | Phase 11 | Complete |
| DEMO-03   | Phase 12 | Complete |

**Coverage:**
- v1.1 requirements: 10 total (7 PROV-V + 3 DEMO)
- Mapped to phases: 10
- Unmapped: 0

---
*Requirements defined: 2026-04-29 — v1.1 Provenance Verification (C2PA) milestone start. Hot patches `85ab50b`, `ea5641c`, `19d2bed` already on `main` and not re-planned here. Traceability filled by roadmapper 2026-04-30: 7 phases (10-16), full coverage.*

*Updated 2026-04-30: PROV-V-01 + PROV-V-02 + PROV-V-05 marked complete (Phase 14 cohort closure).
ROADMAP success criterion #1 (PNG/JPEG/MP4/WebP/TIFF signed manifests verifiable) — closed by Plans 14-02/14-03 + verified by Plan 14-05 c2pa-verification.test.ts (incl. Concern #8 c2pa.hash.data assertion proof + tamper detection).
Criterion #2 (c2pa.created with ComfyUI softwareAgent + trainedAlgorithmicMedia digitalSourceType) — closed by Plan 14-02 manifest-builder + verified by Plan 14-05 Tests 11-13.
Criterion #3 (sidecar .c2pa for EXR/PSD/TIFF + dashboard surface) — PARTIAL CLOSURE for v1.1: TIFF gets native-embed signing (the spec assumed sidecar, but native-embed via the c2pa-node file API is BETTER). EXR/PSD deferred to v1.2 cryptographic-sidecar follow-up. Dashboard surface in v1.1 is the C2paBadge (not a download link; v1.2 adds the link).
Criterion #4 (single configured local cert; key never logged or surfaced) — closed by Plans 14-01/14-02 + verified by Plan 14-05 c2pa-key-leak-negative.test.ts (9 tests, zero key-byte appearances across stdout / stderr / tool envelopes / HTTP body / provenance JSON).
Criterion #5 (dual-transport parity) — closed by architectural choice in Plan 14-03 (signing at write-time, not read-time) + verified by Plan 14-05 c2pa-dual-transport-parity.test.ts (8 parity tests, byte-identical bodies across HTTP route + direct file read).
Phase 14 cohort 5/5 plans complete; root suite 985 → 1024 passing (+39); pre-existing 5 failures unchanged.
v1.2 deferred items recorded in the Deferred to v1.2 section above (cryptographic sidecar API, EXR/PSD support, sidecar HTTP route + dashboard link, HSM signing, multi-CA federated trust).*

*Updated 2026-04-30: PROV-V-04 marked complete (Phase 15 cohort closure).
ROADMAP success criterion #1 (parentOf for reproduce/iterate-lineage versions linking parent manifest by hash) — closed by Plans 15-01/15-02/15-03 + verified by Plan 15-04 c2pa-ingredient-graph-e2e.test.ts (v3 → v2 → v1 traceback via createC2pa().read() walking manifest.ingredients[]).
Criterion #2 (componentOf for non-loader image inputs linked by hash) — closed by Plans 15-01 (extractor with KSampler edge walk + IMAGE_INPUT_CLASS_TYPES v1.1 audit) / 15-02 (builder produces IngredientSpec + vfx_familiar.unavailable_ingredient) / 15-03 (engine signs via the new signEmbedBufferWithIngredients / signEmbedFileWithIngredients pair driving c2pa-node's createIngredient + addIngredient API) + verified by Plan 15-04 e2e Test 1 (control.png surfaces as componentOf with c2pa-node labeled hash).
Criterion #3 (inputTo with structured prompt + sampler params + seed) — closed by Plan 15-01's extractInputAssertion (KSampler edge walk per REVISION B5 — prompts resolved by following positive/negative edges to CLIPTextEncode ancestors, NOT positional heuristic) + Plan 15-02's vfx_familiar.input vendor assertion + Plan 15-03's engine wiring + verified by Plan 15-03 Test E7 and Plan 15-04 e2e Test 1 (vfx_familiar.input present in v3 manifest).
Criterion #4 (end-to-end v1 → v2 → v3 fixture verifiable by independent C2PA reader) — closed by Plan 15-04 c2pa-ingredient-graph-e2e.test.ts.
Criterion #5 (dangling-reference state recorded, not silently dropped) — closed by Plan 15-01's HashOutcome typed union + Plan 15-02's vfx_familiar.unavailable_ingredient assertion shape (architectural constraint: c2pa-node's createIngredient REQUIRES asset bytes, so unreachable ingredients cannot be c2pa.ingredient entries — the vendor assertion preserves the audit trail at the assertions[] layer) + verified by Plan 15-04 c2pa-ingredient-dangling.test.ts.
Per-version sign mutex (B4 — Plan 15-03) coalesces concurrent same-version signOutput calls; recovery-poller + markCompleted-driven post-download sign for the same version are now serialised in-process; parent_manifest_pending becomes a recovery-edge fallback rather than a normal-flow outcome.
Append-only invariant preserved (T-15-03 acceptance: stale parent manifest_sha256 documented as v1.1 limitation; v1.2's version.export_manifest will re-derive on demand). T-15-06 mutex memory growth mitigated by try/finally cleanup. T-15-07 disk-I/O accepted for v1.1; LRU cache deferred.
Tool count unchanged (6/12). DB schema unchanged (manifest_signed_json column already from Phase 14 migration 0006 — payload shape extension is TS-only).
Phase 15 cohort 4/4 plans complete; root suite ≥ 1048 + new tests passing; pre-existing 5 v1.1-audit failures unchanged.*
