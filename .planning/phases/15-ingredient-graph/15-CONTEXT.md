# Phase 15: Ingredient Graph - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss); enriched by orchestrator codebase investigation

<domain>
## Phase Boundary

Promote the C2PA manifest from "AI-origin disclosure + primary model" (Phase 14) to a full ingredient graph: `parentOf` for lineage (reproduce/iterate parents), `componentOf` for prompt-referenced control/reference/IP-Adapter inputs, `inputTo` for prompt text + key parameters. Each ingredient links to its source artifact by hash where available.

**Trigger context:** v1.0 captures lineage in SQLite (`parent_version_id`, `lineage_type`) and identifies all loader-class models. Phase 14 emits a signed manifest with the primary model only. Phase 15 makes the manifest a *full provenance graph* — when v3 reproduces v2 which iterated v1, v3's manifest carries `parentOf` pointing at v2's manifest hash; when v3 used a control image, the manifest carries `componentOf` pointing at the image's SHA-256.

**Success criteria (from ROADMAP):**
1. Manifests for reproduce-lineage and iterate-lineage versions carry a `parentOf` ingredient assertion linking the parent version's manifest by hash.
2. Manifests carry a `componentOf` assertion for every non-loader-node input image referenced in the prompt blob (control images, reference images, IP-Adapter inputs), linked by SHA-256 of the input bytes when the file is reachable.
3. Manifests carry an `inputTo` assertion encoding the resolved prompt text plus the seed and the primary sampler parameters as a structured payload.
4. A test fixture that generates v1, reproduces it as v2 (control image + LoRA), and iterates from v2 as v3 produces a v3 manifest whose ingredient graph traces back through v2 → v1, with control-image and LoRA hashes pinned at every step — verifiable by an independent C2PA reader.
5. When an ingredient's source artifact is unreachable (e.g., control image deleted from disk after generation), the assertion records the dangling-reference state rather than silently dropping the ingredient.
</domain>

<decisions>
## Implementation Decisions

### Locked
- **D-CTX-1: Pure ingredient extraction stays in the engine.** New file `src/engine/c2pa/ingredient-extractor.ts` with three pure functions:
  - `extractParentIngredient(version: Version, getParentManifestHash): ParentIngredient | null` — uses version.parent_version_id + lineage_type. The parent's manifest hash is read from the parent's `manifest_signed` provenance event (Phase 14). If the parent has no manifest event yet (race with the recovery poller), record `parent_unavailable: 'parent_manifest_pending'`.
  - `extractComponentIngredients(promptBlob): ComponentIngredient[]` — walks the resolved prompt blob for `LoadImage`-class nodes (and a small set of named non-loader image-input class types: `LoadImageMask`, `IPAdapterModelLoader`, `ControlNetApplyAdvanced` etc.). Returns `{ node_id, input_filename, role: 'control' | 'reference' | 'ip_adapter' | 'mask' | 'image' }[]`.
  - `extractInputAssertion(promptBlob, seed): InputAssertion` — extracts CLIPTextEncode `text` field (positive prompt + negative prompt where present); KSampler params (seed, steps, cfg, sampler_name, scheduler, denoise). Returns a structured payload — NOT the full prompt blob (T-15-01 mitigation: do NOT echo the entire workflow JSON which may contain user secrets).
- **D-CTX-2: Component image hashing is impure (engine facade).** Create `src/engine/c2pa/ingredient-hasher.ts` with `hashComponentBytes(inputDir, filename): Promise<string | null>` mirroring Phase 12's output-hash.ts pattern (streaming SHA-256 + same path-traversal guard + null-on-missing). When the file is unreachable, the assertion records `component_unavailable: 'file_not_found' | 'file_unreadable'`.
- **D-CTX-3: Manifest builder extension.** Extend `BuildManifestOptions` in src/engine/c2pa/manifest-builder.ts with `ingredients: { parentOf: ParentIngredient | null; componentOf: ComponentIngredient[]; inputTo: InputAssertion }`. The builder emits the appropriate C2PA assertions:
  - `parentOf` → `c2pa.ingredient` assertion with `relationship: 'parentOf'` carrying the parent version_id + manifest hash
  - `componentOf` → `c2pa.ingredient` assertions with `relationship: 'componentOf'` carrying the input filename + SHA-256
  - `inputTo` → custom `vfx_familiar.input` assertion (since C2PA spec doesn't have a first-class "inputTo" — we use a vendor-namespaced label)
  Manifest still includes the Phase 14 `c2pa.created` action — Phase 15 layers on additional assertions, NOT replacing.
- **D-CTX-4: Image input directory is the same as outputsDir.** Control/reference/IP-Adapter input images live alongside outputs in `outputsDir/<versionId>/<filename>` per the existing convention. Comfy uploads them via the workflow's `LoadImage` node which writes to the input subfolder of the ComfyUI install — but for VFX Familiar's purposes, when the dashboard surfaces an input image, it's read from outputsDir-relative paths. **However, the actual file location for control images is platform-specific (cloud storage on ComfyUI Cloud)** — for v1.1, accept that most control image hashes will be `component_unavailable: 'file_not_found'` in production cloud-based deployments. Local test fixtures populate the directory directly to prove the success path.
- **D-CTX-5: Append-only provenance preserved.** The ingredient graph is computed at sign-time (lazy, just like the manifest itself). Manifest_signed event payload extended with `ingredients_summary: { parent_count, component_count, input_assertion: bool }` so audits can reconstruct what was emitted without reading the bytes.
- **D-CTX-6: Failure mode for parent-manifest-pending.** When the parent version exists but doesn't yet have a `manifest_signed: true` event (recovery poller race), the parentOf assertion carries `parent_unavailable: 'parent_manifest_pending'` rather than blocking the child's signing. Future invocations of signOutput on the child re-derive and re-sign with the populated parent hash. (Note: re-sign idempotency from Plan 14-03 means signing only happens once per version — to refresh, the user must explicitly call something like `version.export_manifest` from Phase 16.)

### Claude's Discretion
- Vendor-namespaced label for inputTo: `vfx_familiar.input` keeps the JUMBF assertion's `label` field within the C2PA convention. Alternative: use the IPTC vocabulary if a standard "input" assertion exists.
- Component role detection: trust the class_type (LoadImage = image, IPAdapterModelLoader = ip_adapter). Skip role detection for ControlNet — the role is implicit from the class.
- Component file ordering: sort by node_id for determinism (mirror extractModels).
- Cap inputTo prompt text at 4096 chars; truncate longer with "...[N chars truncated]" marker.

### Deferred
- Cross-shot/cross-project ingredient aggregation — explicit Out-of-Scope per REQUIREMENTS.
- Bidirectional ingredient queries (version X is parentOf which versions?) — out of scope; not needed for v1.1's regulatory ask.
- Per-pixel control-image diff visualization — defer.
- Pinning ingredient bytes when the source file is deleted (snapshot-on-sign) — defer; Phase 16's redaction primitive doesn't need it either.
</decisions>

<code_context>
## Existing Code Insights

- `src/types/hierarchy.ts:58, 67` — Version has `parent_version_id: string | null` AND `lineage_type: 'reproduce' | 'iterate' | null`. Phase 15 reads both for parentOf.
- `src/engine/provenance.ts:5-15` — LOADER_CLASS_TYPES already in use. Phase 15 introduces a NEW set: `IMAGE_INPUT_CLASS_TYPES` for non-loader nodes (LoadImage, LoadImageMask, IPAdapterModelLoader, ControlNetApplyAdvanced, etc.).
- `src/engine/provenance.ts:111-126` — extractSeed pattern. Phase 15 introduces `extractInputAssertion` (mostly pure, similar shape).
- `src/engine/c2pa/manifest-builder.ts` — extension target. Add ingredients param; emit additional c2pa.ingredient + vfx_familiar.input assertions.
- `src/engine/c2pa/signer.ts` — pass-through; the new assertions are part of the manifest definition the builder emits.
- `src/engine/output-hash.ts` (Phase 12) — streaming SHA-256 reference. Mirror pattern for `ingredient-hasher.ts`.
- `src/engine/pipeline.ts` — Engine.signOutput is the call site that consumes the manifest builder. Extend signOutput to:
  1. Read the version + parent_version_id
  2. If parent exists, read parent's latest `manifest_signed` event for the manifest hash
  3. Walk the resolved prompt blob for component images, hash each
  4. Build the ingredient assertion shapes
  5. Pass to buildManifestDefinition
- `src/store/provenance-repo.ts` — getLatestManifestSignedEvent (added in Phase 14) is the parent-manifest-hash reader.
- Test baseline (after Phase 14): 1048 root passing / 5 pre-existing failing / 3 skipped + 88 dashboard passing.
- Architecture-purity: src/engine/c2pa/ stays MCP-free; extends naturally with the new files.
- Append-only provenance: the manifest_signed event payload extension is a JSON shape change — no schema migration needed (TEXT column).
</code_context>

<specifics>
## Specific Ideas

- **IMAGE_INPUT_CLASS_TYPES:**
  ```ts
  export const IMAGE_INPUT_CLASS_TYPES: ReadonlySet<string> = new Set([
    'LoadImage',
    'LoadImageMask',
    'IPAdapterModelLoader',  // image input via 'image' field
    'ControlNetApplyAdvanced', // control image via 'image' field
    'CLIPVisionLoader',  // for IP-Adapter image conditioning
  ]);
  ```

- **IMAGE_FIELD_BY_CLASS:** mirror MODEL_FIELD_BY_CLASS — per-class field name for the image input.

- **InputAssertion shape:**
  ```ts
  interface InputAssertion {
    prompt_positive: string | null;  // first CLIPTextEncode 'text' field (truncated 4096)
    prompt_negative: string | null;  // negative-prompt CLIPTextEncode (heuristic: second-positioned)
    sampler: { name: string | null; scheduler: string | null; steps: number | null; cfg: number | null; denoise: number | null };
    seed: number | null;
  }
  ```

- **C2PA ingredient assertion shape (per spec):**
  ```ts
  // c2pa.ingredient assertion
  {
    label: 'c2pa.ingredient',
    data: {
      title: 'Parent Version v2',
      relationship: 'parentOf',  // or 'componentOf'
      hash: 'sha256:...',  // for componentOf, the image hash; for parentOf, the parent manifest hash
      validation_status?: ['c2pa.assertion.dataHash.match'],  // when verifiable
      metadata: { /* version_id for parent; node_id + role for component */ },
    },
  }
  ```

- **Test fixture for end-to-end (criterion #4):** v1 → v2 (reproduce + LoRA + control image) → v3 (iterate from v2). Drive through Engine.submit/reproduce/iterate. Each version's manifest_signed event captures the manifest. Read v3's manifest, walk ingredients, verify:
  - parentOf → v2's manifest hash matches
  - componentOf → control image hash matches
  - LoRA fingerprint flows in via Phase 13's getLatestFingerprints (already in primary model assertion)
  - Reading v2's manifest similarly traces back to v1.

- **Independent C2PA reader verification:** use c2pa-node's `createC2pa().read({ buffer })` to enumerate ingredient assertions on the signed file. Assert relationship + hash fields match expected shape.

- **Plan structure (planner discretion):**
  - Plan 15-01: IMAGE_INPUT_CLASS_TYPES + ingredient extractors (pure) + ingredient hasher (impure, mirror output-hash.ts)
  - Plan 15-02: Manifest builder extension + signer pass-through verification
  - Plan 15-03: Engine.signOutput integration (read parent manifest hash, walk components, hash, build ingredients) + manifest_signed payload extension
  - Plan 15-04: End-to-end fixture test (v1→v2→v3) + dangling-reference test + cohort closure (PROV-V-04)
</specifics>

<deferred>
## Deferred Ideas

- Cross-shot ingredient aggregation — explicit Out-of-Scope.
- Snapshot-on-sign for ingredient bytes (preserving against future deletion) — defer.
- Bidirectional ingredient queries — defer.
- Per-pixel control-image diff visualization — defer.
- Custom IPTC vocabulary integration for inputTo — defer; vendor-namespaced label is sufficient for v1.1.
- Recursive ingredient resolution (parentOf parent's parentOf...) — out of scope; the chain is implicit via parent's own manifest, which independently carries its own parentOf.
- Phase 16's redaction primitive can operate on ingredient assertions — that's Phase 16's concern.
</deferred>
