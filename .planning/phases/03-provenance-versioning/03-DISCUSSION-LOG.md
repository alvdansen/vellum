# Phase 3: Provenance & Versioning - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 03-provenance-versioning
**Areas discussed:** Schema + capture, Tool surface, Diff representation, Iterate + reproduce UX

---

## Schema + capture

### Q1: How should provenance be stored?

| Option | Description | Selected |
|--------|-------------|----------|
| Separate append-only table | New `provenance` table with event rows (`event_type`: submitted \| completed \| failed). Preserves the CLAUDE.md invariant. `versions` stays mutable; provenance is structurally immutable. | ✓ |
| Extend `versions` with columns | Add `workflow_json`, `prompt_json`, `seed`, `models_json` nullable columns on `versions`. Simpler — one table. Append-only invariant enforced via per-column WHERE guards. | |
| Hybrid: immutable columns on versions + separate failure log | Provenance columns on versions written once at completion, plus a small `provenance_events` table for audit breadcrumbs. | |

**User's choice:** Separate append-only table (Recommended)
**Notes:** Matches the CLAUDE.md "states are separate rows" rule structurally, not via guards. Cleanest path given versions already mutate for status/error.

### Q2: When do we capture provenance data?

| Option | Description | Selected |
|--------|-------------|----------|
| Two events: submit + terminal | At submit: write workflow_json + timestamp. At completion: prompt_json + models + seed + output refs. Provenance exists even for failed generations. | ✓ |
| Completion-only | Nothing at submit. On terminal-completed, capture everything in one shot. Simpler but loses the audit trail for failed generations. | |
| Every state change | Submit, running, completed, failed each produce a row. Full timeline but overkill. | |

**User's choice:** Two events: submit + terminal (Recommended)
**Notes:** Keeps audit trail for failures even when ComfyUI rejects pre-queue.

### Q3: Where does the resolved prompt blob come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Research confirms during plan phase | gsd-phase-researcher verifies status-response vs history-endpoint vs PNG tEXt chunks. Contract lands in RESEARCH.md. | ✓ |
| Assume input workflow == prompt | Persist the input workflow_json as-is. Worst re: Pitfall 3. | |
| Extract from PNG metadata after download | Parse tEXt chunks from downloaded PNGs. Works without new endpoints. Doesn't work for non-PNG outputs. | |

**User's choice:** Research confirms during plan phase (Recommended)
**Notes:** The cheapest-reliable path isn't knowable without live API verification. Researcher owns this; CONTEXT flags it as an open contract.

### Q4: How do we capture model names and (best-effort) checksums?

| Option | Description | Selected |
|--------|-------------|----------|
| Parse loader nodes at completion — names only, checksums nullable | Walk prompt blob for CheckpointLoader*, LoraLoader*, VAELoader, etc. Store flat list. Checksums NULL in Phase 3. | ✓ |
| Parse + attempt checksum via ComfyUI endpoint | Same parse, plus best-effort hash retrieval. Adds research + a network call per generation. | |
| Don't parse — store raw prompt blob only | Skip structured extraction. Parsing done on demand. | |

**User's choice:** Parse loader nodes at completion — names only, checksums nullable (Recommended)
**Notes:** Honest and unblocked. Schema has `model_hash` field ready for when Cloud API exposes one.

---

## Tool surface

### Q1: How should Phase 3 capabilities map to MCP tools?

| Option | Description | Selected |
|--------|-------------|----------|
| Split: `version` (read) + extend `generation` (write) | New `version` tool with `get \| list \| diff \| provenance`. Existing `generation` grows `reproduce \| iterate`. 6/12. | ✓ |
| One big `version` tool | One tool with all six actions. Mixes reads and generation-creating actions. | |
| Three tools: `version` + `provenance` + extend `generation` | Clearest separation but burns two slots. | |
| Defer `list` — Phase 4 already covers it | `version` slimmed to `get \| diff \| provenance`. | |

**User's choice:** Split: `version` (read) + extend `generation` (write) (Recommended)
**Notes:** Reproduce/iterate both create new versions — they belong with the existing write path. Reads are a new surface; giving them one new tool keeps the split clean.

### Q2: What does `version.get` return vs `version.provenance`?

| Option | Description | Selected |
|--------|-------------|----------|
| Distinct: get is metadata, provenance is the heavy blob | `version.get` = cheap row + breadcrumb + output refs. `version.provenance` = all event rows with workflow_json/prompt_json/seed/models. | ✓ |
| Single get with everything inline | `version.get` ships the heavy payload. | |
| `get` with opt-in include flag | One action, `include_provenance: true`. | |

**User's choice:** Distinct: get is metadata, provenance is the heavy blob (Recommended)
**Notes:** Separation forces the right behavior — agents don't get surprise 50KB payloads on list-then-get-each.

### Q3: What does `version.list` return per item?

| Option | Description | Selected |
|--------|-------------|----------|
| Metadata only, paginated | `{id, version_number, status, created_at, parent_version_id, breadcrumb}` per item. Matches Phase 1 D-24 envelope. | ✓ |
| Metadata + output thumbnails | Adds output file refs. | |
| Defer `list` to Phase 4 | Drop list entirely. Phase 4 ASST-03 search supersedes. | |

**User's choice:** Metadata only, paginated (Recommended)
**Notes:** Phase 1 D-24 envelope already locked. Default limit 20.

### Q4: Do `generation.reproduce` and `generation.iterate` return the new version eagerly or via status-polling?

| Option | Description | Selected |
|--------|-------------|----------|
| Same as submit: eager non-blocking with `{version, breadcrumb}` | Reuses Phase 2 D-GEN-05 envelope. New version row returned (status=submitted), agent polls via existing generation.status. | ✓ |
| Synchronous: wait for completion | Block until done. Violates D-GEN-02 non-blocking rule. | |
| Return both original and new | Includes both versions in response. | |

**User's choice:** Same as submit: eager non-blocking with `{version, breadcrumb}` (Recommended)
**Notes:** Zero new response shapes. Reuses status-polling for the async path.

### Q5: New error codes reserved for Phase 3 (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| `PROVENANCE_UNAVAILABLE` | For provenance calls on versions that failed before the prompt blob was captured. | ✓ |
| `REPRODUCE_BLOCKED` | When reproduce cannot proceed — stored prompt blob missing, etc. | ✓ |
| `ITERATE_INVALID_PATCH` | When agent-provided override references a non-existent node or malformed shape. | ✓ |
| `VERSION_NOT_COMPLETED` | For diff/reproduce on versions still in submitted/running/failed. | ✓ |

**User's choice:** All four codes reserved.
**Notes:** Honest signals over generic errors.

---

## Diff representation

### Q1: What does `version.diff(versionA, versionB)` return?

| Option | Description | Selected |
|--------|-------------|----------|
| Structured JSON + human summary string | `{summary: "…", changes: {…}}`. Both machine-readable and a pasteable sentence. Matches Pitfall UX guidance. | ✓ |
| Structured JSON only | Machine-readable changes only. | |
| JSON Patch (RFC 6902) | Standard `[{op, path, value}]` format. Less readable for VFX artists. | |
| Human summary only | Natural-language paragraph only. Too lossy for PROV-04's "structured comparison". | |

**User's choice:** Structured JSON + human summary string (Recommended)
**Notes:** Dashboard (Phase 5) and chat agents both benefit from the summary; diff logic and tooling use `changes`.

### Q2: What gets compared in the diff? (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Prompt blob changes (node inputs, seeds, values) | Per-node field-level diff of `prompt_json`. | ✓ |
| Workflow structure (nodes added/removed/rewired) | Did the workflow shape change? | ✓ |
| Model changes (names, checksums) | Model-identity differences. | ✓ |
| Metadata (timestamps, outputs, status) | `created_at`, output filenames, file sizes. | ✓ |

**User's choice:** All four.
**Notes:** Comprehensive by default. No include/exclude flags in Phase 3 — a truthful diff is the whole point.

### Q3: Can you diff versions across different shots, or only within the same shot?

| Option | Description | Selected |
|--------|-------------|----------|
| Same shot only | Cross-shot returns INVALID_INPUT. | ✓ |
| Any two versions, cross-shot allowed | No restriction. | |
| Same shot by default, flag to override | `allow_cross_shot: true` opt-in. | |

**User's choice:** Same shot only (Recommended)
**Notes:** Cross-shot diffs are rarely VFX-meaningful. If a user actually needs it, add in Phase 4+ via opt-in flag (tracked in Deferred Ideas).

### Q4: How deep does the prompt-blob diff go?

| Option | Description | Selected |
|--------|-------------|----------|
| Field-level within each node | For matching node IDs, compare `class_type` + each `inputs.<field>`. Skip link arrays. | ✓ |
| Whole-node replace-only | Any field differs → whole node marked changed. Noisier. | |
| Deep recursive JSON diff | Walk every key/index, emit every changed path. Too noisy. | |

**User's choice:** Field-level within each node (Recommended)
**Notes:** Good balance of signal vs. noise. Link arrays surface via WorkflowStructureChange when nodes are added/removed/rewired.

---

## Iterate + reproduce UX

### Q1: How does an agent specify modifications on `generation.iterate`?

| Option | Description | Selected |
|--------|-------------|----------|
| Node-scoped overrides + convenience shortcuts | `{ version_id, overrides?: nodeId→{inputs:{}}, seed?, notes? }`. Deep-merges into stored prompt blob. `seed` resolves to KSampler's seed field. | ✓ |
| JSON Patch (RFC 6902) | Standard patch operations. Higher friction for agents. | |
| Full workflow replacement + parent link | Agent rebuilds whole prompt, just passes parent. Defeats the point of "iterate from". | |
| Convenience only (seed/prompt/model) | Friendly for 80% case; no escape hatch. | |

**User's choice:** Node-scoped overrides + convenience shortcuts (Recommended)
**Notes:** Clean surface + escape hatch + easy seed-only iteration. JSON Patch tracked as a deferred additive format.

### Q2: How does `generation.reproduce` handle environment/model drift since the original?

| Option | Description | Selected |
|--------|-------------|----------|
| Best-effort verify + warn in response | Re-submit verbatim. Include `reproduction_warnings: [...]` listing anything unverifiable. Matches Pitfall 3 honesty model. | ✓ |
| Silent re-submit | POST the stored prompt blob. Caveat lives only in tool description. | |
| Strict: block if drift detected | REPRODUCE_BLOCKED on any mismatch. Brittle since Cloud likely doesn't expose checksums. | |
| Capture environment at submit + compare | Snapshot ComfyUI version/instance at submit, compare on reproduce. Deferred. | |

**User's choice:** Best-effort verify + warn in response (Recommended)
**Notes:** Honest about limits. Always returns warnings array (empty when clean) so agents know it exists.

### Q3: When an agent reproduces/iterates from v003 (itself a reproduction of v001), where does parent_version_id point?

| Option | Description | Selected |
|--------|-------------|----------|
| Immediate parent only | `new.parent_version_id = v003`. Chains walked on demand. | ✓ |
| Root of lineage | `new.parent_version_id = v001`. Single lookup, but loses immediate source. | |
| Both: add `lineage_root` column | Tracks both. More schema, no information loss. | |

**User's choice:** Immediate parent only (Recommended)
**Notes:** Simple schema, no ambiguity. `lineage_root` can be layered in later if chain queries become hot (tracked in Deferred).

### Q4: How do we distinguish `reproduce` from `iterate` in provenance records?

| Option | Description | Selected |
|--------|-------------|----------|
| `lineage_type` column on versions | Add `lineage_type TEXT NULL` = `'reproduce' \| 'iterate' \| NULL`. Queryable and cheap. | ✓ |
| Infer from diff | No stored field. Compute at display time. Fragile. | |
| Event row on provenance | Store intent as event_type on provenance. Less ergonomic for version-level queries. | |

**User's choice:** `lineage_type` column on versions (Recommended)
**Notes:** Small schema delta. Makes "show me all reproductions of v001" a single WHERE clause.

---

## Claude's Discretion

Areas where the user deferred to Claude or the planner:

- Provenance repo file location and internal API (`src/store/provenance-repo.ts`)
- Diff engine file location (`src/engine/diff.ts` + `src/engine/diff-summary.ts`)
- Summary template exact wording (planner picks)
- Override merge depth (shallow at `inputs` level is sufficient per Phase 3)
- `models_json` on failed events (null is fine)
- `outputs_json` duplication on provenance rows (acceptable)
- Exact warning message phrasing (per Pitfall 3 honesty)
- Provenance row ID prefix `prov_` (follows Phase 1 D-11 pattern)
- Migration file number `0003_phase3_provenance.sql` (planner confirms against `drizzle/meta`)

## Deferred Ideas

Mentioned during discussion, noted for future phases:

- Environment-info capture at submit (ComfyUI version, instance ID) for strict drift detection
- Model checksum retrieval via separate ComfyUI endpoint
- Cross-shot diff with opt-in flag
- LLM-generated diff summary layered over the deterministic template
- JSON Patch (RFC 6902) interchange on `iterate`
- `lineage_root` materialized column for fast ancestor queries
- PNG metadata parser as independent utility
- `version.delete` / `version.archive` soft-delete semantics
- Diff pagination/elision beyond 6 changes
- Artist / machine capture (multi-user, v2)
- `version.history` lineage-chain walker
- Webhook / SSE on terminal events (Phase 5)
- Structured logger bump (pino)
