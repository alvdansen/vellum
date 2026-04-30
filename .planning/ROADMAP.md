# Roadmap: VFX Familiar

## Overview

VFX Familiar delivers an MCP server that brings production VFX pipeline structure to AI-powered generative content via ComfyUI Cloud. Each milestone delivers a complete, independently verifiable capability set.

## Milestones

- ✅ **v1.0 MVP** — Phases 1-9 (shipped 2026-04-28). Full archive: `milestones/v1.0-ROADMAP.md`, `milestones/v1.0-REQUIREMENTS.md`, `milestones/v1.0-MILESTONE-AUDIT.md`.
- ✅ **v1.1 Provenance Verification (C2PA)** — Phases 10-16 (shipped 2026-04-30). 7 phases, 24 plans, 10 requirements (7 PROV-V + 3 DEMO). Full archive: `milestones/v1.1-ROADMAP.md`, `milestones/v1.1-REQUIREMENTS.md`, `milestones/v1.1-MILESTONE-AUDIT.md`.

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

</details>

<details>
<summary>✅ v1.1 Provenance Verification (C2PA) (Phases 10-16) — SHIPPED 2026-04-30</summary>

**7 phases, 24 plans, 10 requirements (7 PROV-V + 3 DEMO). All verified green. Adversarial codex-substitute review caught 5 BLOCKERS + 6 CONCERNS at planning stage; all closed before execute.**

- [x] Phase 10: Migrate-on-boot Hardening (3/3 plans) — completed 2026-04-30
- [x] Phase 11: Recovery Poller Error Detail (2/2 plans) — completed 2026-04-30
- [x] Phase 12: Reproduce Divergence Transparency (2/2 plans) — completed 2026-04-30
- [x] Phase 13: Model Fingerprinting (3/3 plans) — completed 2026-04-30
- [x] Phase 14: C2PA Signed Manifest Emission (5/5 plans) — completed 2026-04-30
- [x] Phase 15: Ingredient Graph (4/4 plans) — completed 2026-04-30
- [x] Phase 16: Redaction & Agent Surface (5/5 plans) — completed 2026-04-30

**Test trajectory:** 760 (v1.0 close) → 1365 (post-Phase-16) = +605 net new tests. Tool count holds at 7 of 12 cap; `version` action count grew 4 → 7 (added export_manifest + verify_manifest + redact_manifest).

</details>

## Future Milestones

- **v1.2 C2PA Hardening** (candidate scope): HSM/Yubikey signing, multi-CA / federated trust roots, cryptographic sidecar manifests for EXR/PSD when c2pa-node exposes the sidecar API, sidecar HTTP route + dashboard download link, IPAdapter pack node-variants audit, fetch control image bytes from ComfyUI Cloud input store at sign time, parent-bytes LRU cache, full ingredient mirror in redacted manifests, redaction path size-guard symmetry.
- **Multi-Backend Routing** (ROUTE-01..03) — route generation to specific ComfyUI instances by capability with failover.
- **Function-Calling Adapter** (ADAPT-01..03) — OpenAI-compatible REST endpoint for non-MCP agents.
- **Advanced Operations** (ADV-01..04) — batch queuing, webhooks, hierarchy export, lineage visualization.
- **Streaming-friendly C2PA for live video.**
- **In-dashboard manifest editor + cross-shot/cross-project manifest aggregation + watermarking channel** (separate, lower-priority surfaces).

## Progress

| Phase | Milestone | Plans | Status   | Completed  |
| ----- | --------- | ----- | -------- | ---------- |
| 1-9   | v1.0      | 46/46 | Complete | 2026-04-28 |
| 10-16 | v1.1      | 24/24 | Complete | 2026-04-30 |
