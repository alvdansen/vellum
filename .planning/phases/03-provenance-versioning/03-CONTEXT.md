# Phase 3: Provenance & Versioning - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver append-only provenance capture for every generation plus the three agent-facing operations that make provenance useful: diff, reproduce, iterate. Every version gets a full audit trail (workflow JSON at submit, resolved prompt JSON + models + seed at terminal) stored in a new `provenance` table. A new `version` MCP tool exposes read operations (`get | list | diff | provenance`); existing `generation` tool grows `reproduce | iterate` actions that create new versions with tracked lineage. PROV-01..PROV-06.

**In scope:**
- New `provenance` table (append-only, event-row model: `submitted | completed | failed`)
- Two-event provenance capture: **submit** writes `workflow_json` + timestamp; **terminal** writes `prompt_json` + models list + seed + output refs
- New MCP tool `version` with actions `get | list | diff | provenance`
- Extend `generation` MCP tool with actions `reproduce | iterate` (joins existing `submit | status`)
- Model-name extraction (loader-node walk at completion): `CheckpointLoader*`, `LoraLoader*`, `VAELoader`, `UNETLoader`, `ControlNetLoader`, etc.
- Checksums: nullable, best-effort (Cloud API likely does not expose; Phase 3 does NOT make this a blocker)
- `version.diff`: same-shot only, field-level within matching node IDs, returns both structured `changes` (params/models/seed/workflow/metadata) AND a human-readable `summary` string
- `version.get` returns cheap metadata + breadcrumb + output refs; `version.provenance` returns the heavy blob as explicit opt-in
- `generation.reproduce` re-submits the stored prompt blob verbatim; includes `reproduction_warnings: [...]` when checksum/environment info is unavailable
- `generation.iterate` takes node-scoped overrides (`{ "<nodeId>": {inputs: {...}} }`) deep-merged into the stored prompt blob; `seed` convenience shortcut targets the KSampler seed field
- Lineage: `parent_version_id` set to immediate parent only; new `lineage_type TEXT NULL` column on `versions` = `'reproduce' | 'iterate' | NULL`
- Schema migration (likely `0003_phase3_provenance.sql`): create `provenance` table + add `lineage_type` column on `versions`
- Typed error surface additions: `PROVENANCE_UNAVAILABLE`, `REPRODUCE_BLOCKED`, `ITERATE_INVALID_PATCH`, `VERSION_NOT_COMPLETED`

**Out of scope (belongs to later phases):**
- Tagging, metadata attachment, search/filter, pagination on tag queries — Phase 4 (ASST-*)
- Web dashboard, SSE progress, static bundle — Phase 5 (WEBUI-*)
- Multi-backend routing, function-calling adapter, advanced ops — v2
- `version.update` / `version.delete` — create-only invariant holds (Phase 1 D-03)
- Environment-info capture (ComfyUI version / instance ID at submit for strict drift detection) — deferred, tracked below
- Checksum retrieval via separate ComfyUI endpoint — deferred; Phase 3 leaves checksum columns nullable
- Cross-shot diff — rejected with `INVALID_INPUT`; no opt-in flag in Phase 3
- LLM-generated diff summaries — Phase 3 uses deterministic template-based summary strings
- JSON Patch / RFC 6902 interchange for iterate — node-scoped overrides only

</domain>

<decisions>
## Implementation Decisions

### Schema: append-only provenance table (PROV-01, PROV-02, PROV-03)

- **D-PROV-01:** Provenance lives in a **new `provenance` table**, structurally append-only. `versions` stays mutable for status/error/outputs updates (per Phase 2 D-GEN-18..D-GEN-20); `provenance` has no UPDATE or DELETE paths at all. Matches CLAUDE.md invariant ("Provenance records are never updated or deleted. States are separate rows.") and research ARCHITECTURE.md Pattern 2.
- **D-PROV-02:** `provenance` table columns (working shape — planner may refine):
  - `id TEXT PRIMARY KEY` (nanoid, `prov_` prefix per Phase 1 D-11)
  - `version_id TEXT NOT NULL REFERENCES versions(id)`
  - `event_type TEXT NOT NULL` — `'submitted' | 'completed' | 'failed'`
  - `workflow_json TEXT NULL` — populated on `submitted` events (verbatim input)
  - `prompt_json TEXT NULL` — populated on `completed` events (resolved blob; source confirmed in research)
  - `seed INTEGER NULL` — populated on `completed` events (extracted from prompt blob)
  - `models_json TEXT NULL` — populated on `completed` events (flat list `[{node_id, class_type, model_name, model_hash?}, ...]`)
  - `outputs_json TEXT NULL` — populated on `completed` events (mirrors `versions.outputs_json` at event time for append-only audit)
  - `error_code TEXT NULL` / `error_message TEXT NULL` — populated on `failed` events
  - `timestamp INTEGER NOT NULL` — event time (epoch ms)
- **D-PROV-03:** Capture model is **two events per version** (submit + terminal). Submit writes a row with `event_type='submitted'` and the input `workflow_json`. Terminal writes `event_type='completed'` (with `prompt_json`/`seed`/`models_json`/`outputs_json`) OR `event_type='failed'` (with `error_code`/`error_message`). Rationale: PROV-03 (immutability) + PROV-01 (full provenance including failed attempts). Every-state-change (`running` rows) is explicitly rejected — adds noise without new information.
- **D-PROV-04:** Failed-before-ComfyUI-responds edge case (Phase 2 D-GEN-18 allows the version row to reach `failed` without a `job_id`). When this happens: the `submitted` provenance row IS still written (workflow JSON captured), and a subsequent `failed` row is written. Guarantees PROV-01 captures the input even when ComfyUI rejects it.
- **D-PROV-05:** Prompt-blob source is **confirmed during research phase**. Researcher validates whether `/api/job/{id}/status` returns the resolved prompt blob, or whether it requires `/api/history/{id}`, or whether it must be extracted from PNG `tEXt` chunks on downloaded output. Decision lands in RESEARCH.md and feeds into the plan's `ComfyUIClient` extension task. If the cheapest available path is PNG-metadata-only, a fallback is acceptable since PNG is the dominant output format for Phase 3 use cases; non-PNG support (video/audio) becomes a deferred item.
- **D-PROV-06:** Model extraction walks the prompt blob for ComfyUI loader nodes and produces a flat list:
  - Target classes (non-exhaustive, extend as needed in research): `CheckpointLoader`, `CheckpointLoaderSimple`, `LoraLoader`, `LoraLoaderModelOnly`, `VAELoader`, `UNETLoader`, `CLIPLoader`, `ControlNetLoader`, `StyleModelLoader`.
  - Entry shape: `{ node_id: "4", class_type: "CheckpointLoaderSimple", model_name: "sd_xl_base_1.0.safetensors", model_hash: null }`.
  - Checksums are `null` in Phase 3 unless the research phase uncovers a cheap path. No block on missing checksums.
  - Extraction lives in `src/engine/provenance.ts` (pure function, zero IO).

### Tool Surface (TOOL-01..TOOL-05 continuity)

- **D-PROV-07:** New MCP tool: `version`. Actions: `get | list | diff | provenance`. Existing `generation` tool grows two actions: `reproduce | iterate` (joining `submit | status`). Tool count after Phase 3: **6 of 12** (`workspace`, `project`, `sequence`, `shot`, `generation`, `version`). Phase 4 budget remaining: 6 (query ~2, reserve ~4).
- **D-PROV-08:** `version.get` input: `{ action: 'get', version_id: string }`. Response: `{ entity: Version, breadcrumb, breadcrumb_text }` where `Version` is the Phase 2 row shape extended with `lineage_type` and `parent_version_id`. Cheap payload — no workflow/prompt blobs inline. This is the default get; agents opt in to heavy payload via `version.provenance`.
- **D-PROV-09:** `version.list` input: `{ action: 'list', shot_id: string, limit?: number, offset?: number }` (default `limit=20`, matches Phase 1 D-24). Response envelope: `{ items: Version[], total: number, limit, offset }`. Each `items[]` entry = version metadata + breadcrumb (no workflow/prompt blobs). Ordering: `version_number DESC` (latest first — standard VFX expectation).
- **D-PROV-10:** `version.provenance` input: `{ action: 'provenance', version_id: string }`. Response: `{ events: ProvenanceEvent[], breadcrumb, breadcrumb_text }` where `events[]` is every provenance row for that version in chronological order (submit first, terminal last). Heavy payload (workflow_json + prompt_json + models_json per applicable event). Explicit opt-in.
- **D-PROV-11:** `version.diff` input: `{ action: 'diff', version_a: string, version_b: string }`. Response: `{ summary: string, changes: { params, models, seed, workflow, metadata }, breadcrumb, breadcrumb_text }`. Same-shot constraint enforced at engine boundary — cross-shot returns `INVALID_INPUT` with hint `"version.diff compares versions within the same shot; v_a is in shot X, v_b is in shot Y"`.
- **D-PROV-12:** `generation.reproduce` input: `{ action: 'reproduce', version_id: string, notes?: string }`. Behavior: look up source version's `completed` provenance row, re-submit its `prompt_json` verbatim via Phase 2's submit path, create a new version row with `parent_version_id = source`, `lineage_type = 'reproduce'`. Response mirrors `generation.submit` (D-GEN-05) plus `reproduction_warnings: string[]` — e.g., `["Model 'sd_xl_base_1.0' not checksummed — cannot guarantee byte-identical output"]`.
- **D-PROV-13:** `generation.iterate` input: `{ action: 'iterate', version_id: string, overrides?: Record<string, { inputs?: Record<string, unknown>, class_type?: string }>, seed?: number, notes?: string }`. Behavior: load source's `completed` provenance row's `prompt_json`, deep-merge `overrides` (node-id keyed), optionally resolve `seed` convenience to the KSampler's `inputs.seed` field (error if >1 KSampler and no explicit node override for seed), submit the resulting blob, create a new version with `parent_version_id = source`, `lineage_type = 'iterate'`. Response mirrors `generation.submit`.
- **D-PROV-14:** Response envelope for all Phase 3 tool actions follows Phase 1 D-25 — `{ structuredContent: {...}, content: [{type: 'text', text: JSON.stringify(structured)}] }` — with breadcrumb on every response per D-22..D-27.

### Diff Representation (PROV-04)

- **D-PROV-15:** `version.diff` response shape (full specification):
  ```ts
  {
    summary: string,                    // "Node 3 (KSampler): cfg 7→9, seed 123→456. Node 7 (LoraLoader): lora switched from A to B."
    changes: {
      params: ParamChange[],            // { node_id, class_type, field, before, after }
      models: ModelChange[],            // { node_id, class_type, before: { name, hash? }, after: { name, hash? } }
      seed: { before: number|null, after: number|null } | null,
      workflow: WorkflowStructureChange[],  // { type: 'added'|'removed', node_id, class_type }
      metadata: MetadataChange[]        // { field: 'created_at'|'completed_at'|'status'|'output_count', before, after }
    },
    breadcrumb, breadcrumb_text
  }
  ```
- **D-PROV-16:** Diff scope is **all four categories** (prompt blob / workflow structure / models / metadata). Comprehensive by default — no include/exclude flags in Phase 3. Rationale: a truthful diff tells the artist everything that differs; hiding metadata forces them to ask a second tool.
- **D-PROV-17:** Diff depth is **field-level within matching node IDs**. For node IDs present in both prompts, compare `class_type` + each key in `inputs`. Emit one `ParamChange` per differing field. Link arrays (connections between nodes) are NOT walked field-level — they surface via `WorkflowStructureChange` when nodes are added/removed/rewired. Keeps summaries useful without drowning in wire-level noise.
- **D-PROV-18:** `summary` is a **deterministic template-generated string** in Phase 3 — not LLM-generated. Template structure: node-id changes listed in ascending order, comma-separated, max 6 changes before eliding with `"…and N more changes"`. Pure function in `src/engine/diff-summary.ts`, no dependencies. LLM-generated natural-language summaries can be layered on in Phase 5 or by the agent itself.
- **D-PROV-19:** Diff requires both versions to be in a **comparable state**. A version in `submitted` or `running` has no `prompt_json` to compare (terminal provenance row not yet written). Return `VERSION_NOT_COMPLETED` with hint naming the not-ready version. `failed` is comparable — its workflow_json is diffable against another failed/completed version's workflow_json (prompt-blob fields surface as "missing" in the failed side).
- **D-PROV-20:** Same-shot constraint enforced in the engine, not the tool — keeps the rule applicable to future non-MCP entry points. Error path: `TypedError('INVALID_INPUT', "version.diff compares versions within the same shot", "Pass two version ids from the same shot. (v_a is in shot '${shotA}', v_b is in shot '${shotB}')")`.

### Iterate Semantics (PROV-06)

- **D-PROV-21:** `iterate.overrides` shape is **node-scoped deep-merge**. For each entry `{ "<nodeId>": { inputs?, class_type? } }`, the engine reads the source prompt blob, deep-merges `inputs` (shallow merge at the `inputs` level is sufficient — replace fields, don't merge nested objects; ComfyUI node inputs are primitive values or node-id references), and validates the resulting node still has the required `class_type` + `inputs` shape before submit.
- **D-PROV-22:** `iterate.seed` is a **convenience shortcut**. Resolution: find all nodes in the source prompt with `class_type` in `{KSampler, KSamplerAdvanced, SamplerCustom, SamplerCustomAdvanced}` — if exactly one, set its `inputs.seed` to the provided value; if zero, return `ITERATE_INVALID_PATCH` with hint `"No KSampler node found — use explicit override instead"`; if more than one, return `ITERATE_INVALID_PATCH` with hint `"Multiple KSampler nodes found (${nodeIds.join(', ')}) — use explicit override: overrides: { '<nodeId>': { inputs: { seed: ${value} } } }"`.
- **D-PROV-23:** `iterate` validation (before submit):
  - Every override key must reference a node that EXISTS in the source prompt blob. Unknown node ID → `ITERATE_INVALID_PATCH` with hint naming the missing ID and listing valid IDs.
  - Override values for `inputs.<field>` must be primitives, arrays, or plain objects (no functions, no undefined). Shape mismatch → `ITERATE_INVALID_PATCH`.
  - Merged prompt blob still passes `validateWorkflowFormat` (Phase 2 D-GEN-23) before submit — even though the source was already valid, overrides could in principle produce an invalid shape.
- **D-PROV-24:** Iterating from a **failed** source version: allowed. Use case: artist rejects v003, tweaks and resubmits as v004. Requires the source had a `submitted` provenance row (workflow captured) — otherwise `PROVENANCE_UNAVAILABLE`. The merged blob is the WORKFLOW (not a non-existent prompt blob) + overrides. Rationale: iterate's value is also in reuse of the input intent, not just the resolved blob.
- **D-PROV-25:** Iterating from a **submitted/running** source: blocked — `VERSION_NOT_COMPLETED`. Agent should `generation.status` the source first. Exception (D-PROV-24) carved explicitly for `failed`.
- **D-PROV-26:** `iterate` does NOT auto-randomize seeds. If the caller wants a fresh seed, they pass `seed` (or an explicit node override). Rationale: reproducibility is the core value — fresh randomness must be an opt-in.

### Reproduce Semantics (PROV-05)

- **D-PROV-27:** `reproduce` re-submits the stored `prompt_json` **verbatim** — no overrides permitted. If the agent needs overrides, use `iterate`.
- **D-PROV-28:** Before submit, reproduce performs a **best-effort drift check**. Extract the models list from the stored prompt blob; if research uncovers a ComfyUI endpoint exposing current model metadata, compare; emit warnings but never block. `reproduction_warnings: string[]` is always present in the response (empty array if no warnings). Sample warning strings:
  - `"Model '<name>' not checksummed at source — cannot guarantee byte-identical output"`
  - `"Model '<name>' hash mismatch since source: <before>..<after>"` (if research unlocks current-state checksums)
  - `"Cloud API did not expose model metadata — reproduction is best-effort"`
- **D-PROV-29:** Reproduce's **new version** row gets `parent_version_id = source_id`, `lineage_type = 'reproduce'`. Submit path otherwise identical to `generation.submit` (shares the engine internals — D-PROV-33).
- **D-PROV-30:** Reproduce from a source that has no `completed` provenance row (still in `submitted/running/failed`) returns `REPRODUCE_BLOCKED` with hint naming the source's status and pointing to `generation.status`.
- **D-PROV-31:** Environment-info capture (ComfyUI version, instance ID at submit time) is **deferred** — see Deferred Ideas. Phase 3's honesty model relies on the `reproduction_warnings` string to flag what cannot be verified.

### Lineage (PROV-05, PROV-06 — cross-cutting)

- **D-PROV-32:** `versions.parent_version_id` is set to the **immediate parent** — the version id the agent explicitly cited on `reproduce`/`iterate`. Chains (e.g., v005 reproduced from v003 which reproduced from v001) are walked on demand by traversing `parent_version_id` until null. No `lineage_root` column in Phase 3 — keeps schema delta minimal; UI/tooling handles chain walks cheaply via `SELECT` against the indexed column.
- **D-PROV-33:** New column on `versions`: `lineage_type TEXT NULL` (values: `'reproduce' | 'iterate' | NULL`). NULL marks an original submission (`generation.submit`). Queryable ("show me all reproductions of v001": `WHERE parent_version_id = 'ver_...' AND lineage_type = 'reproduce'`). Checked-in set guard lives in the repo (TypeScript union type), not a DB CHECK constraint (sqlite CHECK is awkward to migrate).
- **D-PROV-34:** Schema migration name: `0003_phase3_provenance.sql`. Additive only (creates `provenance` table, adds `lineage_type` on `versions` as nullable). No data backfill: existing Phase 2 `versions` rows keep `lineage_type = NULL` and have no `provenance` rows — historical gap flagged honestly in `version.provenance` response as `events: []`.
- **D-PROV-35:** Recommended index: `CREATE INDEX idx_provenance_version_time ON provenance(version_id, timestamp)` — the two-column index lets both "all events for this version in order" (the canonical `version.provenance` query) and "is this version's latest event completed?" (diff-ready check) run on a single index lookup. Planner finalizes exact shape.

### Error Surface (TOOL-05, extends Phase 1 D-28..D-32, Phase 2 D-GEN-40..D-GEN-41)

- **D-PROV-36:** New typed error codes reserved for Phase 3 (SCREAMING_SNAKE_CASE):
  - `PROVENANCE_UNAVAILABLE` — `version.provenance` / `reproduce` / `iterate` on a version with no captured provenance (pre-Phase-3 historical rows, or versions that failed before the submit-event was written in a crash window)
  - `REPRODUCE_BLOCKED` — source version not in a reproducible state (no `completed` provenance row; credentials gone)
  - `ITERATE_INVALID_PATCH` — override references unknown node, shape mismatch, ambiguous seed shortcut
  - `VERSION_NOT_COMPLETED` — `diff` / `reproduce` on a version still in `submitted` or `running` (where the stored data needed for the operation isn't ready). NOT used for `iterate` from a `failed` source (D-PROV-24 permits that).
- **D-PROV-37:** All Phase 3 errors use the Phase 1 envelope (`{isError: true, structuredContent: {code, message, hint?}}`, D-28). Hints must name specific identifiers and point to a concrete recovery (per D-30..D-31). Zod validation failures continue to re-wrap as `INVALID_INPUT` per D-32.

### Testing Strategy

- **D-PROV-38:** Test layers:
  1. **Unit — model extraction** (`src/engine/__tests__/model-extraction.test.ts`): loader-node walk across all target class_types; handles missing inputs; returns empty list for workflows with no loaders.
  2. **Unit — diff engine** (`src/engine/__tests__/diff.test.ts`): field-level changes, added/removed nodes, model changes, seed changes, metadata changes; summary string generation; same-shot constraint; not-completed guard.
  3. **Unit — override merge** (`src/engine/__tests__/iterate-merge.test.ts`): node-scoped deep-merge; unknown-node rejection; seed convenience resolution (0/1/many KSamplers); validateWorkflowFormat guard post-merge.
  4. **Unit — provenance repo** (`src/store/__tests__/provenance-repo.test.ts`): append-only (no update/delete methods exist); event-type state machine on reads; chronological ordering; indexed lookup path.
  5. **Integration — version-tool** (`src/tools/__tests__/version-tool.test.ts`): all four actions, envelope shape, breadcrumb on every response, error wrapping.
  6. **Integration — generation-tool reproduce/iterate** (`src/tools/__tests__/generation-reproduce-iterate.test.ts`): new version row + lineage_type + parent_version_id set correctly; reproduction_warnings populated; iterate validation errors surface as ITERATE_INVALID_PATCH.
  7. **Cross-cutting** (extend Phase 1/2 suites): `architecture-purity.test.ts` adds `src/engine/diff.ts` + `src/engine/provenance.ts` to the zero-MCP-imports guard; `tool-budget.test.ts` updated from 5 → 6 tools; `stdio-hygiene.test.ts` asserts provenance events never log the prompt blob (which may contain prompts the artist considers sensitive).
  8. **Live smoke** (`src/comfyui/__tests__/live-smoke-provenance.test.ts`): gated on `COMFYUI_API_KEY` — submits a cheap workflow, waits for completion, asserts two provenance rows exist (submitted + completed), asserts seed is populated, asserts model list is non-empty. First E2E check for prompt-blob source (answers D-PROV-05's research question at runtime).
  9. **Reproduce round-trip** (live-smoke extension): after initial completion, call `generation.reproduce`, wait for second completion, assert identical `prompt_json` between source and reproduction's provenance rows. This is the PROV-05 honesty test.

### Claude's Discretion

- **Provenance repo file location** — `src/store/provenance-repo.ts`. Zero UPDATE/DELETE methods by construction. All inserts via `insertEvent(versionId, eventType, payload)`.
- **Diff engine location** — `src/engine/diff.ts` (pure, deterministic, no IO). Composes with `src/engine/provenance.ts` for event loading.
- **Summary template exact wording** — planner chooses; must fit under 200 chars typical / 400 chars max, list 0-6 changes with stable ordering.
- **Override merge depth** — shallow merge at the `inputs` level is sufficient; ComfyUI inputs are typically `string | number | boolean | [node_id, output_index]`. Deep-object inputs are rare enough that nested-merge is not a Phase 3 concern.
- **`models_json` on failed events** — can be null; models list is a completion artifact.
- **`outputs_json` duplication** — provenance `outputs_json` mirrors the `versions.outputs_json` at event time. Some duplication is acceptable; provenance wins for audit since versions can (in principle) be future-updated.
- **Warning message phrasing** — planner picks exact strings; must be actionable and honest per Pitfall 3.
- **ID prefix for provenance rows** — `prov_` per Phase 1 D-11 pattern. Planner decides whether to expose these IDs in tool responses or keep them internal.
- **`outputs_json` re-fetch on reproduce** — reproduce does NOT copy the source's outputs into the new version's row. The new version runs through the full submit → download pipeline and gets its own outputs written by Phase 2 code.
- **Migration file number** — `0003_phase3_provenance.sql` is the expected next number (Phase 2 used 0001 and 0002). Planner confirms against `drizzle/meta` at plan-time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor, checker) MUST read these before acting.**

### Prior phase context (hard dependency — load-bearing for Phase 3)

- `.planning/phases/01-foundation-hierarchy/01-CONTEXT.md` — Phase 1 decisions D-01..D-36 still apply: tool naming (D-02), typed error model (D-28..D-32), envelope (D-22..D-27), tool-engine separation (D-33), repo pattern (D-34), breadcrumb resolver (D-35). Phase 3 does NOT restate — it extends.
- `.planning/phases/02-comfyui-generation/02-CONTEXT.md` — Phase 2 decisions D-GEN-01..D-GEN-42 all load-bearing. Especially: D-GEN-18 (state machine), D-GEN-20 (completed_at immutability), D-GEN-21..D-GEN-27 (ComfyUI client surface), D-GEN-40..D-GEN-41 (error envelope). Phase 3 extends `generation` tool — MUST match existing action-discrimination shape (D-GEN-02, D-GEN-04).
- `.planning/phases/01-foundation-hierarchy/01-PATTERNS.md` — Patterns every new Phase 3 file MUST reuse: tool shape, envelope, error wrapping, repo shape.
- `.planning/phases/02-comfyui-generation/02-PLAN.md` (and `02-02-PLAN.md`, `02-03-PLAN.md`) — Concrete implementations Phase 3 builds on: `GenerationEngine`, `VersionRepo`, `ComfyUIClient`, `generation-tool.ts`.

### Project research (MUST read — locks macro decisions)

- `.planning/research/ARCHITECTURE.md` §"Pattern 2: Append-Only Provenance" — direct model for D-PROV-01..D-PROV-04. §"Database Schema" shows the reference `provenance` table shape (Phase 3's D-PROV-02 is a refinement of this). §"Provenance Query Flow" + §"Version Reproduction Flow" — target flows Phase 3 implements.
- `.planning/research/PITFALLS.md` — Pitfall #3 (Provenance gaps — locks D-PROV-05, D-PROV-06, D-PROV-28 honesty model), Pitfall UX "Version diff returns raw JSON diff" (locks D-PROV-15 summary+changes dual shape), "Looks Done But Isn't" Checklist (provenance / reproduce / version diff lines).
- `.planning/research/SUMMARY.md` — Executive summary + critical risks (provenance is the core value proposition).
- `.planning/research/STACK.md` — Phase 3 adds no new deps. Continue `better-sqlite3` + drizzle; no `fast-json-patch` / diff library needed (diff engine is hand-rolled per D-PROV-15..D-PROV-18).
- `.planning/research/FEATURES.md` — Diff/reproduce/iterate pattern landscape; confirms MCP-tool discrimination via `action` keys is the idiomatic shape.

### Project instructions

- `CLAUDE.md` — **"Prompt blob is truth"** (D-PROV-05 prompt-blob source), **"Append-only provenance: States are separate rows"** (D-PROV-01 table shape), **SQLite WAL** (Phase 1 already compliant — reused), **async generation** + **exponential backoff** (Phase 2 already compliant — reused).
- `.planning/PROJECT.md` — "Full provenance capture: workflow JSON, parameters, seed, model checksums, timestamp, artist, machine" (Phase 3 delivers everything except artist/machine which are v2 multi-user concerns). "Diff between versions", "Reproduce any version exactly", "Iterate from a version" — the three Phase 3 active requirements.
- `.planning/REQUIREMENTS.md` — PROV-01..PROV-06 canonical definitions. PROV-02 explicitly allows checksums nullable — anchor for D-PROV-06.
- `.planning/ROADMAP.md` §"Phase 3: Provenance & Versioning" — Goal + five success criteria. All five addressed by D-PROV-01..D-PROV-37. Depends-on: Phase 2 (already complete or in verification).
- `.planning/STATE.md` — Phase 2 verification in flight; Phase 3 starts from the landed schema + tool surface as of Phase 2 execution.

### External specs (must be honored during implementation)

- **ComfyUI Cloud API reference** — https://docs.comfy.org/development/cloud/api-reference — researcher confirms which endpoint exposes the resolved prompt blob (D-PROV-05). Candidate endpoints to validate: `/api/job/{id}/status` (already consumed in Phase 2), `/api/history/{id}` (unknown if exposed on Cloud), `/api/view` with `include_metadata=true` (hypothetical).
- **ComfyUI Cloud API overview** — https://docs.comfy.org/development/cloud/overview — experimental-API caveats still apply. Any behavior research depends on MUST be covered by the live-smoke test (D-PROV-38 #8).
- **Two JSON Blobs inside ComfyUI PNGs** — https://www.numonic.ai/blog/ai-dam-comfyui-two-json-blobs — fallback if no status-response path exists (PNG `tEXt` `prompt` chunk + `workflow` chunk). Drives `png-metadata.ts` implementation if research picks this path.
- **PNG Metadata vs. Workflow JSON** — https://www.numonic.ai/blog/png-metadata-vs-workflow-json-a-persistence-guide — reference for tEXt extraction reliability and caveats.
- **MCP TypeScript SDK** — https://github.com/modelcontextprotocol/typescript-sdk — v1.29 locked in Phase 1; no SDK changes required for Phase 3 (new tool registration reuses `registerTool` pattern).
- **ComfyUI API format (Issue #1335)** — https://github.com/comfyanonymous/ComfyUI/issues/1335 — Phase 2's `validateWorkflowFormat` still gates submissions on `iterate` (post-override blob must still be API format — D-PROV-23).

### Project credentials (inherited)

- `.env` at repo root — unchanged from Phase 2. `COMFYUI_API_KEY`, `COMFYUI_API_BASE`. Never echo, never log. Reused for `reproduce` + `iterate` submit path (they ride Phase 2's ComfyUIClient).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (Phase 1 + Phase 2 artefacts Phase 3 builds on)

- **`src/engine/generation.ts` — `GenerationEngine`.** Phase 3 extends with `reproduceVersion(sourceVersionId, notes?)` and `iterateFromVersion(sourceVersionId, overrides?, seed?, notes?)` methods. Both share the internal submit path with `submitGeneration` (merge blob → `versions.insertVersion` → `client.submit` → `setJobId`) plus the new lineage-setting call (D-PROV-33).
- **`src/store/version-repo.ts` — `VersionRepo`.** Add `setLineage(id, parentVersionId, lineageType)` method called during reproduce/iterate insert. Extend `Version` type with `lineage_type` field. `insertVersion` signature unchanged; lineage is set in a follow-up update so the existing submit path keeps its semantics.
- **`src/comfyui/client.ts` — `ComfyUIClient`.** Extended with a new method to fetch the resolved prompt blob (signature depends on D-PROV-05 research outcome). Candidate names: `fetchPromptBlob(promptId)` / `fetchHistory(promptId)` / `extractFromPng(pngPath)`. Zero architectural changes; purely additive.
- **`src/engine/pipeline.ts` — `Engine` facade.** Exposes the new operations: `engine.reproduceVersion(...)`, `engine.iterateFromVersion(...)`, `engine.diffVersions(va, vb)`, `engine.getVersion(id)`, `engine.listVersionsForShot(shotId, opts)`, `engine.getProvenance(versionId)`. Phase 3 does NOT add a separate `Engine` — it composes new services into the existing facade.
- **`src/engine/breadcrumb.ts` — `BreadcrumbResolver`.** Already resolves `'version'` (Phase 2 D-GEN-05). No change. Phase 3 inherits versioned breadcrumbs in every response.
- **`src/engine/errors.ts` — `TypedError`.** Reused verbatim. Phase 3 adds four new string-literal codes (D-PROV-36).
- **`src/tools/shape.ts` + `src/tools/envelope.ts`.** Response envelope helpers reused for the new `version` tool and the two new `generation` actions.
- **`src/tools/generation-tool.ts`.** Extended: Zod input schema grows a discriminated-union arm for `reproduce` and `iterate`; handler delegates to the new engine methods; error wrapping reuses D-GEN-41.
- **`src/test-utils/fake-comfyui-client.ts` + `fake-engine.ts` + `fixtures.ts`.** Extended with provenance-aware fakes. Fixtures: sample completed version with a full prompt blob, sample iterate override maps, sample diff pairs (node added, seed changed, model changed).

### Established Patterns (Phase 3 must match)

- **Tool file shape** — Zod input schema, action-discriminated union, thin delegate to engine. New `version-tool.ts` mirrors `workspace-tool.ts` / `generation-tool.ts`.
- **Repo shape** — `better-sqlite3` prepared statements, plain typed return objects, UNIQUE violation → typed error. `ProvenanceRepo` follows this with ZERO UPDATE/DELETE methods (D-PROV-01 enforced structurally).
- **Engine shape** — constructor-injected repos and clients, zero MCP imports. New `src/engine/diff.ts` + `src/engine/provenance.ts` + `src/engine/iterate-merge.ts` are pure modules (zero IO) composed into `GenerationEngine` / `Engine`.
- **Response envelope** — Phase 1 D-25 dual-form with breadcrumb on every response. `version.diff`'s `summary` + `changes` sit inside `structuredContent` alongside the breadcrumb.
- **Error wrapping** — typed code, no raw Zod / SQLite errors surfaced. Hints name specific identifiers + concrete recovery (D-30..D-31).
- **Architecture-purity test** — extend `src/__tests__/architecture-purity.test.ts` to assert `src/engine/diff.ts`, `src/engine/provenance.ts`, `src/engine/iterate-merge.ts` have zero MCP imports; extend the engine/comfyui layer purity assertion to keep these pure.
- **Tool-budget test** — update expected count from 5 → 6.

### Integration Points

- **`src/store/schema.ts` — extend.** Add `lineage_type: text('lineage_type')` nullable on `versions`. Declare new `provenance` table with the D-PROV-02 columns. Extend `SCHEMA_DDL` for fresh-DB bootstrap (follow the Phase 2 split-pattern: additive columns come via migration; keep bootstrap DDL consistent with the additive split).
- **`drizzle/0003_phase3_provenance.sql` — NEW.** Creates `provenance` table + adds `lineage_type` column + recommended index (D-PROV-35). Additive only.
- **`src/store/provenance-repo.ts` — NEW.** `insertEvent(versionId, eventType, payload)`, `getEventsForVersion(versionId)`, `getLatestCompletedEvent(versionId)`. Zero UPDATE / DELETE methods. Architecture-purity asserts.
- **`src/engine/provenance.ts` — NEW.** Pure: model extraction (D-PROV-06), seed extraction from prompt blob, orchestrates event writing via `ProvenanceRepo`. No IO beyond repo calls.
- **`src/engine/diff.ts` — NEW.** Pure: takes two provenance events' `prompt_json` + `workflow_json` + `models_json` + version metadata → returns D-PROV-15 response shape. Composes `src/engine/diff-summary.ts`.
- **`src/engine/diff-summary.ts` — NEW.** Pure: template-based summary string generation (D-PROV-18). No deps.
- **`src/engine/iterate-merge.ts` — NEW.** Pure: deep-merge overrides into a prompt blob, resolve seed convenience, validate result. Throws `ITERATE_INVALID_PATCH` or `VERSION_NOT_COMPLETED` via `TypedError`.
- **`src/engine/generation.ts` — extend.** Add `reproduceVersion` + `iterateFromVersion` methods; both reuse the existing submit path (two-phase insert + ComfyUI submit + setJobId), then call `VersionRepo.setLineage`.
- **`src/engine/pipeline.ts` — extend.** Engine facade adds `diffVersions`, `getVersion`, `listVersionsForShot`, `getProvenance`, `reproduceVersion`, `iterateFromVersion` — all delegate to the appropriate subservice.
- **`src/tools/version-tool.ts` — NEW.** Registers the `version` MCP tool with `action: get | list | diff | provenance`. Discriminated Zod union. Delegates to engine. Breadcrumb via existing envelope.
- **`src/tools/generation-tool.ts` — extend.** Widen the Zod discriminated union to include `reproduce` and `iterate` actions. Handler adds two new branches, both delegate to `engine.reproduceVersion` / `engine.iterateFromVersion`.
- **`src/tools/index.ts` — extend.** Export `registerVersion` alongside existing `registerGeneration` etc.
- **`src/server.ts` — extend.** Register the new `version` tool. No other changes.
- **`src/types/hierarchy.ts` — extend.** Add `lineage_type?: 'reproduce' | 'iterate' | null` to `Version`. Export `ProvenanceEvent` type.
- **`src/types/provenance.ts` — NEW.** `ProvenanceEvent`, `ModelRef`, `DiffResponse`, `DiffChange`, `IterateOverride` types.
- **`src/test-utils/fixtures.ts` — extend.** Provenance fixtures: complete prompt blobs, override maps, diff pairs, lineage chains.

### Build Order (Phase 3 subset — respects layering)

```
1. drizzle/0003_phase3_provenance.sql (create table + add column + index)
2. src/types/provenance.ts (pure types)
3. src/store/provenance-repo.ts (append-only repo, prepared statements)
4. src/engine/provenance.ts (model extraction, seed extraction, event orchestration)
5. src/engine/diff-summary.ts (pure template string generator)
6. src/engine/diff.ts (pure diff engine, composes diff-summary)
7. src/engine/iterate-merge.ts (pure merge + validation)
8. src/store/version-repo.ts (extend with setLineage)
9. src/engine/generation.ts (extend with reproduceVersion, iterateFromVersion)
10. src/comfyui/client.ts (extend per D-PROV-05 research outcome — prompt blob fetch)
11. src/engine/pipeline.ts (extend facade)
12. src/tools/version-tool.ts (NEW tool registration)
13. src/tools/generation-tool.ts (extend with reproduce/iterate actions)
14. src/tools/index.ts + src/server.ts (wire new tool)
15. Tests (unit first, then tool, then cross-cutting, then live-smoke)
```

</code_context>

<specifics>
## Specific Values (reproduce verbatim)

- **New tool name:** `version` (lowercase, noun, snake_case, no prefix)
- **New `version` actions:** `'get' | 'list' | 'diff' | 'provenance'`
- **New `generation` actions (added):** `'reproduce' | 'iterate'` (joining Phase 2's `'submit' | 'status'`)
- **Tool count after Phase 3:** 6 of 12 (`workspace`, `project`, `sequence`, `shot`, `generation`, `version`)
- **New table name:** `provenance` (singular noun — matches `versions`, `shots` convention only in plural mass-noun form; ARCHITECTURE.md uses `provenance`, locking that choice)
- **Provenance ID prefix:** `prov_` (per Phase 1 D-11 nanoid-prefix pattern)
- **Event type values:** `'submitted' | 'completed' | 'failed'` (lowercase strings; mirrors Phase 2 `versions.status` vocabulary with different semantics)
- **Lineage type values on `versions`:** `'reproduce' | 'iterate' | NULL` (NULL for originals from `generation.submit`)
- **New error codes:** `PROVENANCE_UNAVAILABLE`, `REPRODUCE_BLOCKED`, `ITERATE_INVALID_PATCH`, `VERSION_NOT_COMPLETED` (all SCREAMING_SNAKE_CASE per D-40)
- **Diff response top-level keys:** `summary`, `changes: { params, models, seed, workflow, metadata }`, `breadcrumb`, `breadcrumb_text`
- **Iterate input top-level keys:** `action: 'iterate'`, `version_id`, `overrides?`, `seed?`, `notes?`
- **Reproduce input top-level keys:** `action: 'reproduce'`, `version_id`, `notes?`
- **Reproduce response extra field:** `reproduction_warnings: string[]` (always present, empty array when no warnings)
- **KSampler class_types for seed convenience:** `{ 'KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced' }`
- **Loader class_types for model extraction (non-exhaustive):** `{ 'CheckpointLoader', 'CheckpointLoaderSimple', 'LoraLoader', 'LoraLoaderModelOnly', 'VAELoader', 'UNETLoader', 'CLIPLoader', 'ControlNetLoader', 'StyleModelLoader' }`
- **Default `version.list` pagination:** `limit=20, offset=0` (Phase 1 D-24)
- **`version.list` ordering:** `version_number DESC` (latest first)
- **Summary string max length:** 400 chars hard cap, ~200 chars typical
- **Summary elision sentinel:** `"…and N more changes"` when >6 changes
- **Migration file:** `drizzle/0003_phase3_provenance.sql`
- **Recommended index:** `CREATE INDEX idx_provenance_version_time ON provenance(version_id, timestamp)`

</specifics>

<deferred>
## Deferred Ideas

Surfaced during discussion. Not in Phase 3 scope — preserved so they aren't lost.

- **Environment-info capture at submit** — ComfyUI version, instance ID, region snapshot into provenance for strict drift detection on reproduce. Phase 3's honesty model (warnings in response) is the near-term substitute. Ship when ComfyUI Cloud exposes reliable environment endpoints.
- **Model checksum retrieval** — If ComfyUI exposes a model-hashes endpoint post-Phase 3, wire it into the completion event's `models_json`. Schema already accepts a `model_hash` field per entry (nullable today).
- **Cross-shot diff** — Explicit opt-in flag on `version.diff`. Real use case: same artist comparing takes across shots for a pitch. Not blocking; easy additive Phase 4+.
- **LLM-generated diff summary** — Layer over the deterministic template when the dashboard (Phase 5) needs richer natural-language descriptions.
- **JSON Patch (RFC 6902) interchange format** — Accept a `patch` field on `iterate` in addition to `overrides` for agents that prefer the standard. Not blocking; easy additive.
- **`lineage_root` column** — Walk-on-demand is cheap at demo scale. If lineage-chain queries become hot, add a materialized root column later (requires backfill once rows exist).
- **PNG metadata parser as independent utility** — If research picks PNG extraction (D-PROV-05), factor `png-metadata.ts` into a reusable util. Non-PNG formats (video/audio) become a separate concern then.
- **`version.delete` / `version.archive`** — Append-only + immutable is the Phase 3 stance. If a studio needs to soft-delete (e.g., retention policy), add an `archived_at` column later rather than deleting. v2+ concern.
- **Diff limit / pagination on changes** — If a workflow has 200+ nodes and most change, the response grows. Elide today at 6 with summary; add paging if real workflows hit this.
- **Artist / machine capture** — PROJECT.md lists these in the full provenance spec; they're multi-user (auth) concerns deferred to v2.
- **`version.history`** — Walk lineage chain end-to-end in one call (returns the DAG rooted at the given version). Cheap layered on `version.get` + `version.list` today. Ship when the dashboard needs it.
- **Webhook / SSE on terminal events** — Pipe provenance-row writes into a notification surface for the dashboard. Phase 5 concern.
- **Structured logger** — Still `console.error`. Bump to `pino` when logging surface area justifies (Phase 1/2 deferred; same call).

</deferred>

---

*Phase: 03-provenance-versioning*
*Context gathered: 2026-04-21 via /gsd-discuss-phase*
