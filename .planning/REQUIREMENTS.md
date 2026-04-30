# Requirements: VFX Familiar — Milestone v1.1 Provenance Verification (C2PA)

**Defined:** 2026-04-29
**Driver:** EU AI Act Article 50 (effective Aug 2026), California SB 942 (effective Jan 2026), and SEED-001 (Matt Collie, "C2PA Content Provenance for VFX", 2026).
**Thesis:** v1.0 captured private provenance as immutable SQLite rows. v1.1 makes that provenance signed, portable, and regulator-verifiable — every generated output ships with a C2PA-signed manifest declaring AI origin, ingredient graph, and model fingerprints, with a redaction primitive that preserves the *fact* of redaction.

## v1.1 Requirements

Each requirement maps to a single roadmap phase. Coarse-grained where appropriate (a single phase implements several related assertions).

### Provenance Verification (C2PA core)

- [ ] **PROV-V-01**: Server emits a signed C2PA manifest embedded in supported output formats (PNG, JPEG, MP4, WebP) at the moment the version's output is downloaded — both via the dashboard streaming route (`/api/versions/:id/output`) and the direct file path the engine writes to disk.
- [ ] **PROV-V-02**: Manifest includes an explicit AI-origin disclosure assertion (`c2pa.created` action assertion with ComfyUI as the generator tool and the workflow's primary model surfaced as the digitalSourceType / softwareAgent).
- [x] **PROV-V-03**: Every model referenced in the resolved prompt blob (checkpoints, LoRAs, VAEs, ControlNet weights, refiners) has a SHA-256 fingerprint captured in the version's `models_json`. Fingerprints flow into the C2PA manifest as ingredient assertions. Closes the documented `model_hash: null` gap at `src/engine/provenance.ts:69`.
- [ ] **PROV-V-04**: Manifest emits an ingredient graph composed of three assertion types: `parentOf` (lineage — reproduce/iterate parents), `componentOf` (prompt-referenced control images, reference images, IP-Adapter inputs from non-loader nodes), `inputTo` (the prompt text + key parameters). Each ingredient is linked by hash to its source artifact when available.
- [ ] **PROV-V-05**: For output formats not on C2PA's native-embed list (OpenEXR, EXR sequences, raw PSD/TIFF stacks, etc.), the engine writes a sidecar `.c2pa` manifest file alongside the output, named `<output>.c2pa`. The dashboard surfaces both the original file and the sidecar manifest.
- [ ] **PROV-V-06**: A redaction primitive lets a tool caller (or dashboard user) strip sensitive prompt/metadata values from a version's manifest while writing a `c2pa.redacted` assertion that preserves the *fact* of redaction. The original signed manifest stays append-only in `provenance`; redaction emits a new derived manifest.
- [ ] **PROV-V-07**: New MCP tool actions on the existing `version` tool: `version.export_manifest` (returns the C2PA-signed manifest for a version) and `version.verify_manifest` (verifies a manifest's signature and reports gaps). Tool budget stays under the 12-tool cap — no new top-level tool, just two new actions on `version`.

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

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROV-V-01 | Phase 14 | Pending |
| PROV-V-02 | Phase 14 | Pending |
| PROV-V-03 | Phase 13 | Complete |
| PROV-V-04 | Phase 15 | Pending |
| PROV-V-05 | Phase 14 | Pending |
| PROV-V-06 | Phase 16 | Pending |
| PROV-V-07 | Phase 16 | Pending |
| DEMO-01   | Phase 10 | Complete |
| DEMO-02   | Phase 11 | Complete |
| DEMO-03   | Phase 12 | Complete |

**Coverage:**
- v1.1 requirements: 10 total (7 PROV-V + 3 DEMO)
- Mapped to phases: 10
- Unmapped: 0

---
*Requirements defined: 2026-04-29 — v1.1 Provenance Verification (C2PA) milestone start. Hot patches `85ab50b`, `ea5641c`, `19d2bed` already on `main` and not re-planned here. Traceability filled by roadmapper 2026-04-30: 7 phases (10-16), full coverage.*
