# Phase 13: Model Fingerprinting - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss); enriched by orchestrator codebase investigation

<domain>
## Phase Boundary

Capture a SHA-256 fingerprint for every model referenced in the resolved prompt blob (checkpoints, LoRAs, VAEs, ControlNet weights, refiners) into the version's `models_json`. This is the foundational data layer that Phase 14's C2PA manifest and Phase 15's ingredient graph reference. Closes the documented `model_hash: null` gap at `src/engine/provenance.ts:69`.

**Trigger context:** v1.0 `extractModels` is a pure function that always emits `model_hash: null` because it has no I/O. STATE.md documents this as "Model checksums confirmed null-on-Cloud per PROV-02 — closes the loop on the prior concern; full closure happens in Phase 13 of v1.1 via C2PA model fingerprinting per SEED-001." Phase 13 introduces an *impure* fingerprinting path that runs after the pure extraction.

**ComfyUI Cloud reality:** Production runs against ComfyUI Cloud where model files do NOT live on the local file system. ROADMAP success criterion #2 explicitly designs for this: "When a model file is unreachable from the server's resolution path, the entry records a typed `model_hash_unavailable: <reason>` rather than silently nulling — auditability over best-effort." Local-dev tests can prove the hash-success path with fixtures.

**Success criteria (from ROADMAP):**
1. Every model name surfaced by `extractModels()` from the resolved prompt blob has a populated `model_hash` SHA-256 field in the version's `models_json` (no more `model_hash: null` for resolvable models).
2. When a model file is unreachable from the server's resolution path, the entry records a typed `model_hash_unavailable: <reason>` rather than silently nulling — auditability over best-effort.
3. Fingerprint capture is content-addressed: identical model bytes across two versions yield identical hashes (proven by a fixture test using a stable test model file).
4. Fingerprinting does not block the generation hot path — hashes are computed and persisted on a background path that retries on transient I/O errors.
5. The architecture-purity test continues to pass: model fingerprinting lives in the engine layer, with zero MCP/tool/HTTP imports.
</domain>

<decisions>
## Implementation Decisions

### Locked
- **D-CTX-1: ModelRef shape extension.** Add `model_hash_unavailable: string | null` field to `ModelRef`. The existing `model_hash: string | null` stays. Both fields can be non-null in transit (during partial computation), but the persisted `models_json` follows this rule: exactly one of `model_hash` or `model_hash_unavailable` is non-null per entry once fingerprinting completes; `model_hash` is set when bytes were successfully hashed, `model_hash_unavailable` carries a typed reason code otherwise. A row that is mid-fingerprinting (background path running) shows both fields null — readable as "fingerprint pending".

- **D-CTX-2: Resolver via env var.** Add `VFX_FAMILIAR_MODELS_DIR` env var (optional; defaults unset). When unset, every entry records `model_hash_unavailable: "MODELS_DIR not configured"`. When set, the helper looks for model files at `${VFX_FAMILIAR_MODELS_DIR}/${subdir_for_class}/${modelName}` where the subdir is derived from class_type (e.g., CheckpointLoaderSimple → `checkpoints/`, LoraLoader → `loras/`, VAELoader → `vae/`, ControlNetLoader → `controlnet/`, UNETLoader → `unet/`, CLIPLoader → `clip/`, StyleModelLoader → `style_models/`).

- **D-CTX-3: Background path for hot-path isolation.** Fingerprinting runs as `void fingerprintModelsAsync(versionId)` after the synchronous `writeCompletedEvent` returns. The completed-event row writes with all `model_hash: null` initially; the background path runs to completion (with retry-on-transient-I/O) and writes a SECOND completed-event row with the populated hashes via the existing append-only mechanism. **OR** (alternative — planner picks): background path UPDATEs the existing `provenance.completed_event.models_json` field in place. Hash-update is NOT a state change in the provenance lifecycle, so the planner can argue this is allowed despite append-only intent. **Recommendation:** write a sibling provenance event of type `models_fingerprinted` rather than UPDATE the original completed_event — preserves append-only by adding a row, queryable by anyone who needs final hashes (Phase 14's C2PA manifest reads "the latest fingerprints" for the version).

- **D-CTX-4: Streaming hash via crypto.** Reuse the streaming pattern from Phase 12's `src/engine/output-hash.ts` (createReadStream + createHash('sha256') + digest('hex')). Same large-file safety (videos can be 100+ MB; checkpoint .safetensors files can be 7+ GB). New helper at `src/engine/model-fingerprint.ts`.

- **D-CTX-5: Reason codes for unavailable.** Typed strings stored in `model_hash_unavailable`:
  - `"models_dir_not_configured"` — VFX_FAMILIAR_MODELS_DIR is unset
  - `"file_not_found"` — MODELS_DIR set but file absent at expected path
  - `"file_unreadable"` — Found but I/O error after exhausting retries (EACCES, EISDIR, EBUSY persisting)
  - `"unsupported_class_type"` — class_type in LOADER_CLASS_TYPES but no MODEL_DIR_BY_CLASS mapping (defensive — should not fire if mappings stay in sync)

### Claude's Discretion
- Concurrency: hash all models in a single version concurrently via `Promise.all`. Sequential would be safer for memory but slow for multi-LoRA workflows. Use `p-limit`-style cap of 4 concurrent hashes if memory is a concern (large checkpoints).
- Retry policy: 3 retries with 1s exponential backoff for non-ENOENT errors. ENOENT goes straight to `file_not_found` (no retry — file just isn't there).
- Idempotency: if `models_fingerprinted` event already exists for the version, skip recomputation. Useful for crash-recovery: if the server restarts mid-fingerprint, the boot recovery path can re-run.
- Persistence shape: `models_fingerprinted` provenance event carries a JSON array `[{node_id, model_name, model_hash} | {node_id, model_name, model_hash_unavailable}]` mirroring the original `models_json` shape.

### Deferred
- HuggingFace registry lookup as a fallback when MODELS_DIR is unset. Out of scope for v1.1 — increases the trust surface (network + API key); leave for v1.2 if user demand surfaces.
- Hash caching layer (LRU on model_name + size). Defer until profiling shows the same model being re-hashed across versions in a hotspot.
- Multi-CDN model resolution (e.g., ComfyUI Cloud's API for model checksums). Out of scope; the cloud's API does not currently expose checksums per the v1.0 audit findings.
</decisions>

<code_context>
## Existing Code Insights

- `src/engine/provenance.ts:5-15` — `LOADER_CLASS_TYPES` set: CheckpointLoader, CheckpointLoaderSimple, LoraLoader, LoraLoaderModelOnly, VAELoader, UNETLoader, CLIPLoader, ControlNetLoader, StyleModelLoader. Phase 13 introduces a parallel `MODEL_DIR_BY_CLASS` map for resolver subdirs.
- `src/engine/provenance.ts:26-36` — `MODEL_FIELD_BY_CLASS` map: existing pattern for "per-class metadata". Mirror this for `MODEL_DIR_BY_CLASS`.
- `src/engine/provenance.ts:57-77` — `extractModels` (pure). Phase 13 keeps this unchanged; the fingerprinter is a separate impure helper that consumes the pure output.
- `src/engine/provenance.ts:69` — the documented `model_hash: null` gap. After Phase 13 the line still emits null on the pure path; the fingerprinter populates it asynchronously.
- `src/types/provenance.ts:24-28` — `ModelRef` interface. Extension point for `model_hash_unavailable: string | null`.
- `src/types/provenance.ts:16` — `models_json: string | null` on ProvenanceEvent (versions table). Stays a JSON string; no schema change required (the JSON shape just gains a field).
- `src/engine/provenance.ts:123-130` — completion path that calls extractModels and persists `models_json`. Phase 13 hooks AFTER this with `void fingerprintModelsAsync(versionId, models)`.
- `src/engine/diff.ts:112-132` — `diffModels` compares model_hash; the new `model_hash_unavailable` field should also flow through the diff so users see "v1 had hash, v2 unavailable" cases.
- `src/engine/output-hash.ts` (Phase 12) — streaming SHA-256 reference pattern. Phase 13 mirrors the structure exactly.
- `src/store/provenance-repo.ts` — provenance write API. Phase 13 adds `appendModelsFingerprintedEvent(versionId, models)` (or similar) for the sibling-row approach.
- Architecture-purity guard at `src/__tests__/architecture-purity.test.ts:38` — engine has zero MCP imports. New `src/engine/model-fingerprint.ts` must respect this.
- Test baseline (after Phase 12): 824 root passing / 5 pre-existing failing / 3 skipped. Dashboard: 58/58.
- Append-only provenance: writeCompletedEvent inserts a row; never updates. The sibling `models_fingerprinted` event approach preserves this contract.
</code_context>

<specifics>
## Specific Ideas

- **Helper signature:**
  ```ts
  // src/engine/model-fingerprint.ts
  export async function fingerprintModel(
    modelsDir: string | null,
    classType: string,
    modelName: string,
  ): Promise<{ model_hash: string } | { model_hash_unavailable: string }>;
  ```
  Single-model entry point. Returns the discriminated union for type safety.

- **Batch entry point in pipeline:**
  ```ts
  // Engine method (src/engine/pipeline.ts or generation.ts)
  async fingerprintModelsForVersion(versionId: string): Promise<void> {
    const models = /* read latest models_json for version */;
    const fingerprinted = await Promise.all(models.map(m =>
      fingerprintModel(this.modelsDir, m.class_type, m.model_name)
    ));
    this.provenanceRepo.appendModelsFingerprintedEvent(versionId, fingerprinted);
  }
  ```
  Called from generation.ts after `writeCompletedEvent` returns: `void this.engine.fingerprintModelsForVersion(versionId)`.

- **MODEL_DIR_BY_CLASS:**
  ```ts
  export const MODEL_DIR_BY_CLASS: Record<string, string> = {
    CheckpointLoader: 'checkpoints',
    CheckpointLoaderSimple: 'checkpoints',
    LoraLoader: 'loras',
    LoraLoaderModelOnly: 'loras',
    VAELoader: 'vae',
    UNETLoader: 'unet',
    CLIPLoader: 'clip',
    ControlNetLoader: 'controlnet',
    StyleModelLoader: 'style_models',
  };
  ```

- **Test fixture for content-addressed proof (criterion #3):** Two versions reference the same checkpoint name. Both are fingerprinted against a fixture file. Assert both versions' `models_json` carry identical `model_hash` strings.

- **Test fixture for unavailable (criterion #2):** MODELS_DIR set, file deliberately absent. Assert `model_hash_unavailable: "file_not_found"`.

- **Test fixture for retry path (criterion #4):** Mock fs.createReadStream to throw EBUSY twice then succeed. Assert hash returns successfully with retry telemetry visible.

- **Test fixture for hot-path isolation (criterion #4):** writeCompletedEvent returns synchronously; the fingerprinter is queued via `void` and runs asynchronously. Test asserts `Engine.completedAt` returns before fingerprinter completes. Use `vi.useFakeTimers()` or a deferred promise to control timing.

- **Background-path observability:** Log to console.error for each retry. Phase 14 may want to expose fingerprint status via a health endpoint, but that's out of scope here.
</specifics>

<deferred>
## Deferred Ideas

- HuggingFace registry lookup fallback. Out of scope per D-CTX deferred section above.
- Hash caching across versions (LRU). Defer until profiling demand.
- Multi-CDN / ComfyUI Cloud model checksum API integration. Out of scope.
- Re-fingerprinting on model file change (file watcher). Out of scope; Phase 13 is point-in-time fingerprinting at completion.
- Surfacing fingerprint status in dashboard (e.g., "fingerprint pending" badge). Out of scope; Phase 14 picks up the C2PA manifest UI.
</deferred>
