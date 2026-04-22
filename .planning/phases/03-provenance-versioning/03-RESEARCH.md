# Phase 3: Provenance & Versioning - Research

**Researched:** 2026-04-22
**Domain:** Append-only provenance capture + diff/reproduce/iterate for ComfyUI Cloud generations
**Confidence:** MEDIUM-HIGH (schema/diff/iterate HIGH; D-PROV-05 MEDIUM with fallback plan)

## Summary

Phase 3 is almost entirely a pure-TypeScript / SQLite extension of Phase 2. The only
research-sensitive area is **D-PROV-05 — where the resolved prompt blob comes from**. All
other Phase 3 work is locked by CONTEXT.md decisions and inherited Phase 1/2 patterns.

The research recommendation is a **layered prompt-blob-fetch strategy**: try the cheapest
server-side path first (`/api/job/{id}/status` extended response, then `/api/history/{id}`
if exposed on Cloud), fall back to **PNG tEXt-chunk extraction** on the downloaded output
if neither endpoint exposes the resolved blob. The schema, diff engine, iterate-merge
module, and reproduce flow are all designed to tolerate whichever source wins at runtime —
the `prompt_json` column is just a `TEXT NULL` string, and the source-detection logic
lives in one place (`ComfyUIClient.fetchResolvedPrompt()`) so any future migration to
a better endpoint is a single-file change.

**Primary recommendation:** Ship the PNG-tEXt fallback as the **primary** path in
Phase 3 (highest confidence it works; universal across ComfyUI deployments), and probe
`/api/job/{id}/status` + `/api/history/{id}` in the live-smoke test (D-PROV-38 #8).
If the smoke test confirms either endpoint returns the resolved blob, swap the primary
in a follow-up commit — no schema or diff-engine change required.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Schema / Provenance table:**
- D-PROV-01: New `provenance` table, structurally append-only (zero UPDATE/DELETE paths).
- D-PROV-02: Columns — `id TEXT PK`, `version_id TEXT NOT NULL FK→versions`, `event_type TEXT` (`'submitted'|'completed'|'failed'`), `workflow_json TEXT NULL` (on submitted), `prompt_json TEXT NULL` (on completed), `seed INTEGER NULL`, `models_json TEXT NULL`, `outputs_json TEXT NULL`, `error_code/error_message TEXT NULL` (on failed), `timestamp INTEGER NOT NULL` (epoch ms).
- D-PROV-03: Two events per version — submit writes workflow + timestamp; terminal writes completed (prompt/seed/models/outputs) OR failed (error_code/message). No running-state rows.
- D-PROV-04: Failed-before-ComfyUI-responds still writes the `submitted` row before a `failed` row.
- D-PROV-05: Prompt-blob source confirmed during research phase. Decision lands in this RESEARCH.md.
- D-PROV-06: Model extraction walks the prompt blob for loader nodes. Flat list `[{node_id, class_type, model_name, model_hash: null}, ...]`. Checksums nullable. Lives in `src/engine/provenance.ts` (pure).

**Tool surface:**
- D-PROV-07: New `version` MCP tool with actions `get|list|diff|provenance`. `generation` grows `reproduce|iterate`. Total tools after Phase 3: **6 of 12**.
- D-PROV-08..14: Tool-action IO shapes locked — `version.get` cheap metadata, `version.list` paginated 20/offset, `version.provenance` heavy opt-in blob, `version.diff` same-shot `{summary, changes, breadcrumb}`, `generation.reproduce` verbatim re-submit with warnings array, `generation.iterate` node-scoped overrides + seed shortcut. All responses follow Phase 1 D-25 envelope.

**Diff engine:**
- D-PROV-15: `changes: { params, models, seed, workflow, metadata }` + deterministic `summary`.
- D-PROV-16: All four categories by default — no include/exclude flags.
- D-PROV-17: Field-level within matching node IDs; link arrays surface as `WorkflowStructureChange` only.
- D-PROV-18: Deterministic template summary — no LLM.
- D-PROV-19: Both versions must have a completed-or-failed terminal event — else `VERSION_NOT_COMPLETED`.
- D-PROV-20: Same-shot constraint enforced in engine, not tool.

**Iterate:**
- D-PROV-21: Node-scoped deep-merge shape `{ "<nodeId>": { inputs?, class_type? } }`.
- D-PROV-22: `seed` convenience — 0 KSampler → error, 1 KSampler → apply, >1 KSampler → error with hint listing node IDs.
- D-PROV-23: Validation — unknown node IDs, shape mismatches, validateWorkflowFormat post-merge.
- D-PROV-24: Iterate from **failed** allowed (uses workflow_json + overrides).
- D-PROV-25: Iterate from submitted/running blocked.
- D-PROV-26: No auto-random seeds — explicit opt-in only.

**Reproduce:**
- D-PROV-27: Verbatim re-submit — no overrides.
- D-PROV-28: Best-effort drift check, `reproduction_warnings: string[]` always present.
- D-PROV-29: New version gets `parent_version_id = source`, `lineage_type = 'reproduce'`.
- D-PROV-30: No completed event → `REPRODUCE_BLOCKED`.
- D-PROV-31: Environment-info capture deferred.

**Lineage:**
- D-PROV-32: Immediate parent only — no `lineage_root` column.
- D-PROV-33: New column `versions.lineage_type TEXT NULL` (`'reproduce'|'iterate'|NULL`).
- D-PROV-34: Migration `drizzle/0003_phase3_provenance.sql` — additive only, no backfill.
- D-PROV-35: Index `CREATE INDEX idx_provenance_version_time ON provenance(version_id, timestamp)`.

**Errors:**
- D-PROV-36: Four new codes — `PROVENANCE_UNAVAILABLE`, `REPRODUCE_BLOCKED`, `ITERATE_INVALID_PATCH`, `VERSION_NOT_COMPLETED`.
- D-PROV-37: Phase 1 envelope, hints name identifiers + recovery.

### Claude's Discretion

- Provenance repo file location: `src/store/provenance-repo.ts`.
- Diff engine location: `src/engine/diff.ts` (pure), `src/engine/diff-summary.ts` (pure).
- Summary template wording — planner chooses, ≤200 chars typical / 400 chars max.
- Override merge depth: shallow at `inputs` level is sufficient.
- `models_json` on failed events: may be null.
- `outputs_json` duplication between versions and provenance: acceptable.
- Warning message phrasing.
- `prov_` ID prefix; expose-in-responses-or-not is planner's call.
- Reproduce does NOT copy source outputs — re-downloads via Phase 2 pipeline.
- Migration file number: `0003_phase3_provenance.sql` (confirmed: next after 0001, 0002).

### Deferred Ideas (OUT OF SCOPE)

Environment-info capture at submit, model checksum retrieval, cross-shot diff, LLM-
generated diff summary, RFC 6902 JSON Patch interchange, `lineage_root` column, PNG
metadata as independent utility, `version.delete`/`version.archive`, diff paging,
artist/machine capture, `version.history` lineage walker, webhook/SSE on terminal events,
structured logger.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROV-01 | Full provenance capture: workflow JSON, resolved prompt JSON, seed, model list, timestamps | D-PROV-05 resolution (below) + append-only schema (D-PROV-01..04) |
| PROV-02 | Model list with nullable checksums | D-PROV-06 loader-walk algorithm (Model-list extraction section) |
| PROV-03 | Provenance immutable (append-only) | Structural guarantee — no UPDATE/DELETE methods on `ProvenanceRepo`; enforced by architecture-purity test |
| PROV-04 | Version diff (same-shot) | Diff engine approach (hand-rolled, field-level within matching node IDs, deterministic summary) |
| PROV-05 | Reproduce version exactly | Reproduce/iterate flow section — verbatim re-submit with best-effort drift warnings |
| PROV-06 | Iterate from a version | Reproduce/iterate flow — node-scoped overrides, seed convenience, validation gates |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Provenance event persistence | Database/Storage | — | Append-only insert-only table; SQLite owns durability |
| Model-list extraction | Engine (pure) | — | Pure function over prompt JSON; no IO, no MCP |
| Diff computation | Engine (pure) | — | Pure diff over two loaded events; deterministic |
| Iterate merge + validation | Engine (pure) | — | Pure deep-merge + shape check; throws TypedError |
| Reproduce submit path | Engine (service) | Database/Storage + ComfyUI Client | Composes provenance lookup → ComfyUI submit → version-row insert + lineage |
| Prompt-blob fetch | ComfyUI Client | — | HTTP + PNG-metadata extraction lives at the client boundary; engine stays blob-source-agnostic |
| Version.diff / .get / .list / .provenance | MCP Tool | Engine | Thin Zod validation delegating to `Engine` facade |
| Seed extraction | Engine (pure) | — | Reads KSampler.inputs.seed from prompt blob; no IO |

## Standard Stack

### Core (inherited from Phase 1/2 — no new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | inherited | `provenance` table persistence | Phase 1 decision; synchronous API, WAL |
| `drizzle-orm` | inherited | `provenance` table declaration + migration | Phase 1/2 pattern |
| `zod` | inherited (v4) | Tool input validation for `version` + `generation.reproduce`/`iterate` | Phase 1 D-21 |
| `nanoid` | inherited | `prov_*` IDs | Phase 1 D-11 |
| `vitest` | ^4.1.4 | Test runner (confirmed via package.json line 48) | Phase 1/2 |
| `@modelcontextprotocol/sdk` | ^1.29 | `registerTool('version', ...)` | Phase 1 |

### Supporting — PNG metadata extraction (if needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **Hand-rolled PNG tEXt parser** | — | Extract `prompt` and `workflow` chunks from downloaded PNG | Recommended path — avoids a new dep for a simple, deterministic parse |
| `png-chunks-extract` | ^1.0.0 | Extract all chunks from PNG buffer | Fallback if hand-roll proves awkward; small (~2KB), zero deps, MIT [CITED: npmjs.com/package/png-chunks-extract] |

**Decision:** Hand-roll. PNG's tEXt chunk structure is trivially parseable (4-byte length, 4-byte `tEXt` identifier, null-separated key+value, 4-byte CRC). A ~30-line parser in `src/comfyui/png-metadata.ts` avoids pulling a dependency and keeps the attack surface minimal. [ASSUMED: parser simplicity] — validated by skimming the PNG spec and numonic.ai's write-up.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled PNG tEXt parser | `sharp` or `image-size` | Both are heavier native deps; we only need tEXt chunks, not image decoding |
| Custom diff engine | `fast-json-patch` / `deep-diff` | CONTEXT.md D-PROV-17 explicitly mandates hand-rolled field-level — library diffs would produce wire-level noise (link-array diffs) |
| Migration by raw SQL | Drizzle-kit generated | Phase 2 established raw SQL files under `drizzle/` — continuity > tooling |

**Installation:**
```bash
# No new deps needed for Phase 3. Hand-rolled PNG parser uses Node's Buffer only.
```

**Version verification:** Phase 1/2 dependencies are already locked in package.json; Phase 3 adds zero new deps per CONTEXT.md STACK.md reference. [VERIFIED: package.json inspection]

## D-PROV-05 Resolution

**Decision:** Ship a **layered fetch strategy** with **PNG tEXt extraction as the primary path** for Phase 3. Probe server-side endpoints in the live-smoke test; if either returns the resolved blob, promote it to primary in a follow-up commit (zero schema/engine change required).

### Evidence considered

| Source | Claim | Confidence |
|--------|-------|------------|
| CLAUDE.md | "The ComfyUI prompt blob (not workflow blob) contains resolved seeds and actual model paths" | HIGH — project invariant |
| numonic.ai/blog/ai-dam-comfyui-two-json-blobs (CONTEXT.md canonical ref) | ComfyUI PNG outputs embed BOTH a `prompt` chunk (resolved) and a `workflow` chunk (authored) in tEXt | MEDIUM-HIGH [CITED] |
| numonic.ai/blog/png-metadata-vs-workflow-json-a-persistence-guide | PNG tEXt is durable persistence; reliable across ComfyUI versions | MEDIUM-HIGH [CITED] |
| docs.comfy.org/development/cloud/api-reference | Phase 2 confirmed `/api/prompt`, `/api/job/{id}/status`, `/api/view`. No documented `/api/history/{id}` on Cloud. `/api/job/{id}/status` returns status/progress/outputs/error — **no documented prompt blob field** | MEDIUM [CITED — Phase 2 research] |
| Self-hosted ComfyUI (`/history/{prompt_id}`) | Returns the resolved prompt blob on LOCAL ComfyUI | HIGH for self-hosted, UNKNOWN for Cloud [ASSUMED: not verified on Cloud in this phase] |

### Resolution: primary = PNG tEXt, probe in live-smoke

**Primary path — PNG tEXt chunk extraction:**

1. After `/api/view` downloads the PNG output to disk (Phase 2 code path), open the file, read chunks.
2. Extract `tEXt` chunk with key `prompt` → parse JSON → that is the resolved prompt blob.
3. Extract `tEXt` chunk with key `workflow` (authored workflow) for confirmatory cross-check — not strictly required for Phase 3 storage (we already persist authored workflow on submit).
4. Universal across ComfyUI deployments — the numonic.ai research confirms this is how ComfyUI-Manager, Civitai, and other tools retrieve generation metadata from outputs.

**Why PNG-first is correct for Phase 3:**

- **Highest confidence it works** — ComfyUI writes these chunks unconditionally for image outputs (has been stable since the workflow era began).
- **Independent of API exposure** — no dependency on ComfyUI Cloud exposing an `/api/history/{id}` endpoint (which docs don't confirm).
- **Matches CONTEXT.md D-PROV-05 fallback allowance** — "If the cheapest available path is PNG-metadata-only, a fallback is acceptable since PNG is the dominant output format for Phase 3 use cases."
- **Cheap** — PNG is already downloaded by Phase 2 output pipeline; we just re-read the file (or parse during download stream).

**Limitations (honestly acknowledged):**

- Video/audio outputs: PNG tEXt extraction fails. Non-PNG becomes a **deferred item** per CONTEXT.md. Completed-event provenance writes `prompt_json: null` with an explicit warning: `"prompt blob unavailable for non-PNG output (format: video/mp4)"`. Covered by the `PROVENANCE_UNAVAILABLE` typed error surface (D-PROV-36) when callers try `reproduce`/`iterate`.
- Multi-output jobs: If a single job produces multiple PNG outputs, all embedded `prompt` blobs should be identical (same execution run). Extract from the first output; assert (in dev mode) that subsequent outputs match. Mismatch → log a warning but accept the first.

**Secondary path — server-side endpoint probing (live-smoke only in Phase 3):**

In the live-smoke test (D-PROV-38 #8), after the generation completes:

1. Probe `/api/job/{id}/status` response — log the full response to stdout and check whether any field (candidates: `prompt`, `resolved_prompt`, `prompt_json`, `execution`) contains the resolved blob.
2. Probe `/api/history/{id}` (GET, with `X-API-Key`) — log response status. If 200 with a blob-shaped body, log the keys.
3. Record findings in a **`D-PROV-05-followup.md`** note (not a Phase 3 deliverable — a spike output). If an endpoint works, a follow-up commit can promote it to primary by changing the source-detection logic in one place (`ComfyUIClient.fetchResolvedPrompt`) with zero callers affected.

**Implementation plan:**

```typescript
// src/comfyui/client.ts — extend ComfyUIClient
// Primary: PNG tEXt extraction from already-downloaded file
async fetchResolvedPromptFromPng(pngPath: string): Promise<Record<string, unknown> | null> {
  const buf = await readFile(pngPath);
  const prompt = extractTextChunk(buf, 'prompt');
  if (!prompt) return null;
  try { return JSON.parse(prompt); } catch { return null; }
}

// src/comfyui/png-metadata.ts — NEW pure module
export function extractTextChunk(pngBuffer: Buffer, key: string): string | null {
  // Validate PNG magic (8 bytes: 89 50 4E 47 0D 0A 1A 0A)
  // Walk chunks: [4-byte BE length][4-byte type][data][4-byte CRC]
  // Find tEXt chunks, parse key\0value, return value when key matches
}
```

**Live-smoke probe (separate from the implementation):**

```typescript
// src/comfyui/__tests__/live-smoke-provenance.test.ts
// After job completes:
const statusResp = await client.status(jobId);
console.error('[PROBE] /api/job status keys:', Object.keys(statusResp));
const historyResp = await rawClient.get(`/api/history/${jobId}`);
console.error('[PROBE] /api/history status:', historyResp.status);
// ... record findings in a spike note; don't change Phase 3 plan
```

**Confidence:** MEDIUM-HIGH for PNG path (widely documented, numonic.ai and ComfyUI community both confirm), HIGH for schema/engine tolerance of whichever source wins at runtime.

## ComfyUIClient extension signature

The Phase 3 client extension adds a **single method** and one pure helper module. Blob-source-agnostic by design.

```typescript
// src/comfyui/client.ts — additive
class ComfyUIClient {
  /* existing: submit, status, download, downloadToPath */

  /**
   * Phase 3 (D-PROV-05): fetch the resolved prompt blob for a completed job.
   *
   * Implementation: read PNG tEXt 'prompt' chunk from the already-downloaded
   * output file. Returns null if the file is not a PNG, or if the chunk is
   * missing or malformed. Callers (GenerationEngine completion handler)
   * tolerate null by emitting PROVENANCE_UNAVAILABLE on later reproduce/iterate.
   *
   * If a follow-up spike confirms /api/job/{id}/status or /api/history/{id}
   * returns the resolved blob, this method's body can be replaced with an
   * HTTP call; the signature stays the same.
   */
  async fetchResolvedPrompt(pngPath: string): Promise<Record<string, unknown> | null>;
}
```

```typescript
// src/comfyui/png-metadata.ts — NEW pure module
export function extractTextChunk(
  pngBuffer: Buffer,
  key: string,
): string | null;

// Also export for tests:
export const PNG_MAGIC: Uint8Array;
```

**Why `fetchResolvedPrompt(pngPath)` not `fetchResolvedPrompt(jobId)`:**

- The completion handler already has the output file path (Phase 2 `downloadToPath` returns it).
- Keeps the method pure over filesystem reads — no second HTTP call, no second round of allowlist checks.
- If we later swap to server-side, the signature can change to `fetchResolvedPrompt(jobId, outputs)` with a file-path fallback; callers migrate once.

**Why keep it on `ComfyUIClient` not a separate module:**

- The fetch surface belongs to the ComfyUI boundary — tomorrow this may become an HTTP call.
- Future-proofs: when Cloud exposes the endpoint, the client is the one place that changes.

## Model-list extraction algorithm

Pure function, zero IO, lives in `src/engine/provenance.ts`.

```typescript
// src/engine/provenance.ts — pure module
export interface ModelRef {
  node_id: string;
  class_type: string;
  model_name: string;
  model_hash: string | null; // always null in Phase 3
}

const LOADER_CLASS_TYPES = new Set([
  'CheckpointLoader',
  'CheckpointLoaderSimple',
  'LoraLoader',
  'LoraLoaderModelOnly',
  'VAELoader',
  'UNETLoader',
  'CLIPLoader',
  'ControlNetLoader',
  'StyleModelLoader',
]);

/**
 * Extract all model references from a resolved prompt blob.
 * Returns a flat list; duplicates (e.g., same LoRA referenced from two nodes)
 * are preserved with distinct node_ids.
 */
export function extractModels(promptBlob: Record<string, unknown>): ModelRef[] {
  const out: ModelRef[] = [];
  for (const [nodeId, raw] of Object.entries(promptBlob)) {
    if (raw == null || typeof raw !== 'object') continue;
    const node = raw as { class_type?: unknown; inputs?: unknown };
    const classType = typeof node.class_type === 'string' ? node.class_type : null;
    if (!classType || !LOADER_CLASS_TYPES.has(classType)) continue;
    const inputs = node.inputs;
    if (inputs == null || typeof inputs !== 'object') continue;
    const modelName = pickModelNameField(classType, inputs as Record<string, unknown>);
    if (!modelName) continue;
    out.push({
      node_id: nodeId,
      class_type: classType,
      model_name: modelName,
      model_hash: null,
    });
  }
  return out;
}

/**
 * Field-name mapping per loader class_type. ComfyUI loaders use different
 * field names for the model path — checkpoint=ckpt_name, lora=lora_name,
 * etc. Returns the first non-empty string found at a known field.
 *
 * Non-exhaustive list — when a new loader class is added, extend the map.
 * An unknown field is a data-drop, not an error: the model still generated,
 * we just can't name it in provenance.
 */
function pickModelNameField(
  classType: string,
  inputs: Record<string, unknown>,
): string | null {
  const candidates = MODEL_FIELD_BY_CLASS[classType] ?? MODEL_FIELD_DEFAULTS;
  for (const field of candidates) {
    const v = inputs[field];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

const MODEL_FIELD_BY_CLASS: Record<string, string[]> = {
  CheckpointLoader: ['ckpt_name'],
  CheckpointLoaderSimple: ['ckpt_name'],
  LoraLoader: ['lora_name'],
  LoraLoaderModelOnly: ['lora_name'],
  VAELoader: ['vae_name'],
  UNETLoader: ['unet_name'],
  CLIPLoader: ['clip_name'],
  ControlNetLoader: ['control_net_name'],
  StyleModelLoader: ['style_model_name'],
};

const MODEL_FIELD_DEFAULTS = ['model_name', 'ckpt_name', 'name'];
```

**Edge cases handled:**

- Missing `inputs` → skip node silently (non-loader or malformed).
- Unknown loader class (not in set) → skip.
- Known loader with unknown field → fall through to `MODEL_FIELD_DEFAULTS`; if nothing matches, skip. Loss of data acceptable — test covers "workflow with LoRA but no lora_name field" → returns [].
- Empty prompt blob → returns `[]`.
- Duplicates (same lora_name on two LoraLoader nodes) → preserved with distinct `node_id`s (D-PROV-06 flat list).

**Tests (in `src/engine/__tests__/model-extraction.test.ts`):**

1. SDXL workflow with CheckpointLoaderSimple → 1 entry, node_id + ckpt_name populated.
2. Workflow with 2 LoraLoaders → 2 entries, distinct node_ids.
3. Workflow with no loaders (pure CLIPTextEncode + KSampler) → `[]`.
4. Malformed node (missing `inputs`) → skipped, no throw.
5. Unknown class_type → skipped.
6. Known class with field `ckpt_name: ""` → skipped (empty string check).

## Seed extraction rules

Seed extraction lives in the same pure module; driven by the KSampler class set.

```typescript
// src/engine/provenance.ts — pure module (continued)
const KSAMPLER_CLASS_TYPES = new Set([
  'KSampler',
  'KSamplerAdvanced',
  'SamplerCustom',
  'SamplerCustomAdvanced',
]);

/**
 * Extract the seed from a resolved prompt blob. Walks KSampler-family nodes
 * and returns the seed from the FIRST one found (stable ordering by node_id
 * sort). Returns null if no KSampler is present or if seed field is missing /
 * non-integer.
 *
 * Semantics note: D-PROV-02 persists a single `seed INTEGER NULL` per
 * completed event. Multi-KSampler workflows (rare in image-gen, common in
 * some video-gen patterns) will have their FIRST KSampler's seed recorded;
 * the full per-node seeds remain recoverable from prompt_json blob for diff.
 * This is a pragmatic single-column compromise — the full fidelity lives in
 * `prompt_json`, `seed` is a convenience for `WHERE seed = ?` queries and
 * summary-line rendering.
 */
export function extractSeed(promptBlob: Record<string, unknown>): number | null {
  const candidates: Array<{ nodeId: string; seed: number }> = [];
  for (const [nodeId, raw] of Object.entries(promptBlob)) {
    if (raw == null || typeof raw !== 'object') continue;
    const node = raw as { class_type?: unknown; inputs?: unknown };
    if (typeof node.class_type !== 'string') continue;
    if (!KSAMPLER_CLASS_TYPES.has(node.class_type)) continue;
    const inputs = node.inputs;
    if (inputs == null || typeof inputs !== 'object') continue;
    const seedVal = (inputs as Record<string, unknown>).seed;
    if (typeof seedVal !== 'number' || !Number.isInteger(seedVal)) continue;
    candidates.push({ nodeId, seed: seedVal });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  return candidates[0].seed;
}
```

**Edge cases:**

- `inputs.seed: -1` (ComfyUI's "randomize" sentinel) → **in the resolved prompt blob, this is already resolved to the actual seed used**. This is the whole point of the resolved blob (CLAUDE.md: "prompt blob is truth"). If we see `-1` in the resolved blob, something is wrong (the blob wasn't actually resolved) — log a warning and return null.
- `inputs.seed: 1234567890123456789` (BigInt range) → JavaScript numbers lose precision >2^53. Real ComfyUI seeds are typically 64-bit unsigned ints, and some can exceed 2^53. **Mitigation:** Persist as integer in `provenance.seed INTEGER` column (SQLite integers are 64-bit). When parsing JSON.parse returns a plain number and can lose precision. **For Phase 3:** accept the JS-number truncation risk; document as a known limitation; add TODO to migrate to TEXT storage of the seed string if a live-smoke run surfaces a truncation. (Low-priority: ComfyUI itself uses JS on the frontend so seeds stay within JS integer-safe range in practice.) [ASSUMED — JS-safe seed range]
- Multiple KSamplers → document in `models_json` surface? No — the `seed` column is a convenience; diff engine uses `prompt_json` directly for full per-node fidelity.

## Diff engine approach

Hand-rolled, deterministic, pure. Two modules: `src/engine/diff.ts` (computes change sets) + `src/engine/diff-summary.ts` (renders summary string). No dependencies.

### Inputs

```typescript
// src/engine/diff.ts
export interface DiffInput {
  a: VersionForDiff;
  b: VersionForDiff;
}

export interface VersionForDiff {
  version: Version; // metadata: created_at, completed_at, status, version_number
  terminalEvent: ProvenanceEvent; // event_type='completed' or 'failed'
  submitEvent: ProvenanceEvent; // event_type='submitted' (for workflow_json)
  outputsJson: StoredOutput[] | null;
}
```

### Algorithm (four passes)

```typescript
export function diffVersions(input: DiffInput): DiffResponse {
  const { a, b } = input;

  // Guard: both must have a completed terminal event — else VERSION_NOT_COMPLETED.
  // (Failed-vs-failed and failed-vs-completed also allowed per D-PROV-19; they surface
  // as "missing prompt blob on the failed side".)
  assertComparable(a, b);

  // Guard: same-shot constraint (D-PROV-20) enforced at engine boundary.
  if (a.version.shot_id !== b.version.shot_id) {
    throw new TypedError(
      'INVALID_INPUT',
      'version.diff compares versions within the same shot',
      `Pass two version ids from the same shot. (v_a is in shot '${a.version.shot_id}', v_b is in shot '${b.version.shot_id}')`,
    );
  }

  // Pass 1: prompt-blob param changes (field-level, matching node IDs).
  const params = diffPromptParams(
    parsePromptJson(a.terminalEvent.prompt_json),
    parsePromptJson(b.terminalEvent.prompt_json),
  );

  // Pass 2: workflow-structure changes (added/removed node IDs).
  const workflow = diffWorkflowStructure(
    parsePromptJson(a.terminalEvent.prompt_json),
    parsePromptJson(b.terminalEvent.prompt_json),
  );

  // Pass 3: models changes (flat list keyed by node_id).
  const models = diffModels(
    JSON.parse(a.terminalEvent.models_json ?? '[]'),
    JSON.parse(b.terminalEvent.models_json ?? '[]'),
  );

  // Pass 4: seed + metadata.
  const seed = diffSeeds(a.terminalEvent.seed, b.terminalEvent.seed);
  const metadata = diffMetadata(a.version, b.version);

  const summary = buildSummary({ params, workflow, models, seed, metadata });
  return {
    summary,
    changes: { params, workflow, models, seed, metadata },
    breadcrumb: /* resolved by caller */,
    breadcrumb_text: /* resolved by caller */,
  };
}
```

### Pass 1 — `diffPromptParams` (field-level, matching node IDs)

```typescript
function diffPromptParams(
  promptA: Record<string, PromptNode> | null,
  promptB: Record<string, PromptNode> | null,
): ParamChange[] {
  if (promptA == null || promptB == null) return [];
  const changes: ParamChange[] = [];
  const commonNodeIds = Object.keys(promptA).filter((id) => id in promptB);
  commonNodeIds.sort(); // deterministic order for summary
  for (const nodeId of commonNodeIds) {
    const a = promptA[nodeId];
    const b = promptB[nodeId];
    // class_type change on same node_id → treat as one ParamChange with field='class_type'
    if (a.class_type !== b.class_type) {
      changes.push({ node_id: nodeId, class_type: a.class_type, field: 'class_type', before: a.class_type, after: b.class_type });
    }
    // field-level walk (inputs are primitives, arrays, or plain objects per D-PROV-21)
    const fields = new Set([...Object.keys(a.inputs ?? {}), ...Object.keys(b.inputs ?? {})]);
    for (const field of [...fields].sort()) {
      // Skip link arrays — they surface via WorkflowStructureChange (D-PROV-17)
      if (isLinkRef(a.inputs?.[field]) || isLinkRef(b.inputs?.[field])) continue;
      const beforeVal = a.inputs?.[field];
      const afterVal = b.inputs?.[field];
      if (!deepEqualPrimitive(beforeVal, afterVal)) {
        changes.push({ node_id: nodeId, class_type: a.class_type, field, before: beforeVal, after: afterVal });
      }
    }
  }
  return changes;
}

function isLinkRef(v: unknown): boolean {
  // ComfyUI link syntax: [nodeId: string, outputIndex: number]
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number';
}
```

### Pass 2 — `diffWorkflowStructure`

Added / removed node IDs (set difference). Returns `{ type: 'added'|'removed', node_id, class_type }`.

### Pass 3 — `diffModels`

Flat list, keyed by `node_id`. For each node_id present in both, emit `ModelChange` if `model_name` or `model_hash` differ. For node_ids only in one side, emit `{ type: 'added'|'removed', ... }`.

### Pass 4 — seed + metadata

`seed: { before, after } | null` — null when equal. `metadata: MetadataChange[]` walks `created_at`, `completed_at`, `status`, `output_count` (= `outputs_json.length`).

### Summary rendering (`src/engine/diff-summary.ts`)

```typescript
/**
 * Build a deterministic summary string. Max 400 chars hard cap, ~200 typical,
 * list up to 6 changes, elide rest with "…and N more changes".
 *
 * Ordering: param changes first (grouped by node_id asc), then models, then
 * seed, then workflow structure, then metadata. Stable.
 */
export function buildSummary(changes: DiffChanges): string {
  const parts: string[] = [];
  const paramsByNode = groupByNode(changes.params);
  for (const [nodeId, paramList] of paramsByNode) {
    const classType = paramList[0].class_type;
    const fieldList = paramList
      .map((c) => `${c.field} ${fmt(c.before)}→${fmt(c.after)}`)
      .join(', ');
    parts.push(`Node ${nodeId} (${classType}): ${fieldList}`);
  }
  for (const m of changes.models) { /* "Node X: lora switched from A to B" */ }
  if (changes.seed) parts.push(`seed ${changes.seed.before}→${changes.seed.after}`);
  for (const w of changes.workflow) parts.push(`${w.type} node ${w.node_id} (${w.class_type})`);
  for (const m of changes.metadata) parts.push(`${m.field} ${fmt(m.before)}→${fmt(m.after)}`);

  const MAX_CHANGES = 6;
  const HARD_CAP = 400;
  const elided = parts.length > MAX_CHANGES
    ? [...parts.slice(0, MAX_CHANGES), `…and ${parts.length - MAX_CHANGES} more changes`]
    : parts;
  let s = elided.join('. ');
  if (s.length > HARD_CAP) s = s.slice(0, HARD_CAP - 1).trimEnd() + '…';
  return s || 'No differences';
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return `"${v}"`;
  if (v == null) return 'null';
  return String(v);
}
```

**Deterministic property:** Same input ⇒ same output string, bit-for-bit. Enables snapshot testing.

## Reproduce/iterate flow

Both operations live on `GenerationEngine` (already exists from Phase 2) as additive methods. Both compose: provenance lookup → (optional merge) → ComfyUI submit → new version row + lineage.

### Reproduce

```typescript
// src/engine/generation.ts — additive method
async reproduceVersion(
  sourceVersionId: string,
  notes?: string,
): Promise<{ version: Version; reproduction_warnings: string[] }> {
  // 1. Load source — must exist.
  const source = this.versions.getById(sourceVersionId);
  if (!source) throw new TypedError('NOT_FOUND', `Version '${sourceVersionId}' not found`);

  // 2. Find the completed provenance event — else REPRODUCE_BLOCKED (D-PROV-30).
  const completedEvent = this.provenance.getLatestCompletedEvent(sourceVersionId);
  if (!completedEvent) {
    throw new TypedError(
      'REPRODUCE_BLOCKED',
      `Version '${sourceVersionId}' has no completed provenance row`,
      `Check the version's status first via generation.status. Source status: '${source.status}'.`,
    );
  }

  // 3. Build warnings array — D-PROV-28.
  const warnings: string[] = [];
  if (!completedEvent.prompt_json) {
    throw new TypedError('PROVENANCE_UNAVAILABLE', `Version '${sourceVersionId}' missing prompt_json (likely non-PNG output)`);
  }
  const models = JSON.parse(completedEvent.models_json ?? '[]') as ModelRef[];
  for (const m of models) {
    if (m.model_hash == null) {
      warnings.push(`Model '${m.model_name}' not checksummed — cannot guarantee byte-identical output`);
    }
  }
  if (models.length === 0) {
    warnings.push(`Cloud API did not expose model metadata — reproduction is best-effort`);
  }

  // 4. Re-submit verbatim via Phase 2 submit path.
  const promptBlob = JSON.parse(completedEvent.prompt_json) as Record<string, unknown>;
  const newVersion = await this.submitInternal({
    shot_id: source.shot_id,
    workflow: promptBlob, // re-submit resolved blob verbatim
    notes,
    parent_version_id: sourceVersionId,
    lineage_type: 'reproduce',
  });

  return { version: newVersion, reproduction_warnings: warnings };
}
```

### Iterate

```typescript
// src/engine/generation.ts — additive method
async iterateFromVersion(
  sourceVersionId: string,
  overrides?: Record<string, { inputs?: Record<string, unknown>; class_type?: string }>,
  seedConvenience?: number,
  notes?: string,
): Promise<{ version: Version }> {
  const source = this.versions.getById(sourceVersionId);
  if (!source) throw new TypedError('NOT_FOUND', `Version '${sourceVersionId}' not found`);

  // D-PROV-24: iterate from failed → use workflow_json (authored intent).
  // D-PROV-25: iterate from submitted/running → VERSION_NOT_COMPLETED.
  let blob: Record<string, unknown>;
  if (source.status === 'completed') {
    const completed = this.provenance.getLatestCompletedEvent(sourceVersionId);
    if (!completed?.prompt_json) throw new TypedError('PROVENANCE_UNAVAILABLE', ...);
    blob = JSON.parse(completed.prompt_json);
  } else if (source.status === 'failed') {
    const submitted = this.provenance.getSubmitEvent(sourceVersionId);
    if (!submitted?.workflow_json) throw new TypedError('PROVENANCE_UNAVAILABLE', ...);
    blob = JSON.parse(submitted.workflow_json);
  } else {
    throw new TypedError(
      'VERSION_NOT_COMPLETED',
      `Version '${sourceVersionId}' is in '${source.status}' — cannot iterate`,
      `Iterate supports completed or failed sources. Wait for completion via generation.status.`,
    );
  }

  // Apply seed convenience (D-PROV-22).
  if (seedConvenience !== undefined) {
    blob = applySeedShortcut(blob, seedConvenience);
  }

  // Apply overrides (D-PROV-21, D-PROV-23) via pure src/engine/iterate-merge.ts.
  if (overrides) {
    blob = applyOverrides(blob, overrides); // throws ITERATE_INVALID_PATCH on unknown nodes / shape mismatch
  }

  // Validate merged blob (D-PROV-23) — Phase 2's validateWorkflowFormat.
  validateWorkflowFormat(blob); // throws INVALID_INPUT if shape is broken

  // Submit via Phase 2 path.
  const newVersion = await this.submitInternal({
    shot_id: source.shot_id,
    workflow: blob,
    notes,
    parent_version_id: sourceVersionId,
    lineage_type: 'iterate',
  });

  return { version: newVersion };
}
```

### Shared `submitInternal`

Refactor Phase 2's submit path into an internal helper that accepts the new `lineage_type` + `parent_version_id` args. The existing `submitGeneration` public method calls `submitInternal({ ..., parent_version_id: null, lineage_type: null })`.

This keeps the lineage-set as an **insert-time decision**, not a follow-up update — avoids Pattern 2 footgun of making `versions` less append-only than it should be during provenance write.

### Apply-seed-shortcut (`src/engine/iterate-merge.ts`)

```typescript
export function applySeedShortcut(
  blob: Record<string, unknown>,
  seed: number,
): Record<string, unknown> {
  const ksamplerIds = findKSamplerNodes(blob);
  if (ksamplerIds.length === 0) {
    throw new TypedError(
      'ITERATE_INVALID_PATCH',
      'No KSampler node found in prompt blob',
      'Use explicit override: overrides: { "<nodeId>": { inputs: { seed: <value> } } }',
    );
  }
  if (ksamplerIds.length > 1) {
    throw new TypedError(
      'ITERATE_INVALID_PATCH',
      `Multiple KSampler nodes found: ${ksamplerIds.join(', ')}`,
      `Use explicit override instead: overrides: { '<nodeId>': { inputs: { seed: ${seed} } } }`,
    );
  }
  // Shallow clone + set
  const out = structuredClone(blob);
  const node = out[ksamplerIds[0]] as { inputs: Record<string, unknown> };
  node.inputs = { ...node.inputs, seed };
  return out;
}

export function applyOverrides(
  blob: Record<string, unknown>,
  overrides: Record<string, { inputs?: Record<string, unknown>; class_type?: string }>,
): Record<string, unknown> {
  const out = structuredClone(blob);
  const validIds = Object.keys(out);
  for (const [nodeId, patch] of Object.entries(overrides)) {
    if (!(nodeId in out)) {
      throw new TypedError(
        'ITERATE_INVALID_PATCH',
        `Unknown node id '${nodeId}' in overrides`,
        `Valid node ids: ${validIds.join(', ')}`,
      );
    }
    const node = out[nodeId] as { inputs?: Record<string, unknown>; class_type?: string };
    if (patch.class_type !== undefined) {
      if (typeof patch.class_type !== 'string') {
        throw new TypedError('ITERATE_INVALID_PATCH', `overrides.${nodeId}.class_type must be a string`);
      }
      node.class_type = patch.class_type;
    }
    if (patch.inputs !== undefined) {
      if (typeof patch.inputs !== 'object' || patch.inputs == null || Array.isArray(patch.inputs)) {
        throw new TypedError('ITERATE_INVALID_PATCH', `overrides.${nodeId}.inputs must be a plain object`);
      }
      // Shallow merge at inputs level (D-PROV-21: inputs are primitives/arrays/link-refs).
      node.inputs = { ...node.inputs, ...patch.inputs };
    }
  }
  return out;
}
```

## Schema migration shape

### `drizzle/0003_phase3_provenance.sql` (NEW, additive only)

```sql
-- IDM-03: ROLLBACK NOT SUPPORTED.
--
-- Phase 3 migration: adds the provenance table + lineage_type column + index.
-- Purely additive — old Phase 2 code tolerates the new table (never reads it)
-- and the new nullable column (never selected). No data backfill: existing
-- Phase 2 versions keep lineage_type = NULL and have no provenance rows.
-- version.provenance surfaces the historical gap honestly as events: [].
ALTER TABLE `versions` ADD `lineage_type` text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `provenance` (
  `id` text PRIMARY KEY NOT NULL,
  `version_id` text NOT NULL,
  `event_type` text NOT NULL,
  `workflow_json` text,
  `prompt_json` text,
  `seed` integer,
  `models_json` text,
  `outputs_json` text,
  `error_code` text,
  `error_message` text,
  `timestamp` integer NOT NULL,
  FOREIGN KEY (`version_id`) REFERENCES `versions`(`id`)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_provenance_version_time` ON `provenance` (`version_id`, `timestamp`);
```

### `src/store/schema.ts` additions

```typescript
// additive — declare the new column on `versions`
export const versions = sqliteTable('versions', {
  /* existing columns */
  lineage_type: text('lineage_type'), // NULL | 'reproduce' | 'iterate'
}, /* ... */);

// NEW — provenance table
export const provenance = sqliteTable('provenance', {
  id: text('id').primaryKey(),
  version_id: text('version_id')
    .notNull()
    .references(() => versions.id),
  event_type: text('event_type').notNull(), // 'submitted' | 'completed' | 'failed'
  workflow_json: text('workflow_json'),
  prompt_json: text('prompt_json'),
  seed: integer('seed'),
  models_json: text('models_json'),
  outputs_json: text('outputs_json'),
  error_code: text('error_code'),
  error_message: text('error_message'),
  timestamp: integer('timestamp').notNull(),
}, (t) => ({
  idxVersionTime: index('idx_provenance_version_time').on(t.version_id, t.timestamp),
}));
```

**SCHEMA_DDL decision:** Following the Phase 2 split pattern (schema.ts comment lines 98-116) — do NOT declare the Phase 3 table or the `lineage_type` column in SCHEMA_DDL. A fresh DB runs SCHEMA_DDL first, then drizzle migrations apply 0001, 0002, 0003 additively. This keeps the zero-dep bootstrap path intact.

**Boot sequence (confirmed from schema.ts comments):**

1. `openDb()` sees `user_version=0` → execs Phase 1 SCHEMA_DDL → stamps `user_version=1`.
2. `migrate()` applies `0001_phase2_version_lifecycle.sql` (adds error_code/error_message/outputs_json).
3. `migrate()` applies `0002_idx_versions_status.sql` (adds status index).
4. **NEW:** `migrate()` applies `0003_phase3_provenance.sql` (adds lineage_type + provenance table + index).

### `ProvenanceRepo` (`src/store/provenance-repo.ts`)

```typescript
// STRUCTURAL guarantee: zero UPDATE/DELETE methods. Architecture-purity test
// asserts this via AST check (no `update(` or `delete from` strings in file).
export class ProvenanceRepo {
  private insertStmt: Statement;
  private getEventsStmt: Statement;
  private getLatestCompletedStmt: Statement;
  private getSubmitEventStmt: Statement;

  constructor(private db: Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO provenance (id, version_id, event_type, workflow_json, prompt_json, seed, models_json, outputs_json, error_code, error_message, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getEventsStmt = db.prepare(`
      SELECT * FROM provenance WHERE version_id = ? ORDER BY timestamp ASC, id ASC
    `);
    this.getLatestCompletedStmt = db.prepare(`
      SELECT * FROM provenance WHERE version_id = ? AND event_type = 'completed'
      ORDER BY timestamp DESC LIMIT 1
    `);
    this.getSubmitEventStmt = db.prepare(`
      SELECT * FROM provenance WHERE version_id = ? AND event_type = 'submitted'
      ORDER BY timestamp ASC LIMIT 1
    `);
  }

  insertEvent(versionId: string, eventType: EventType, payload: EventPayload): ProvenanceEvent { /* ... */ }
  getEventsForVersion(versionId: string): ProvenanceEvent[] { /* ... */ }
  getLatestCompletedEvent(versionId: string): ProvenanceEvent | null { /* ... */ }
  getSubmitEvent(versionId: string): ProvenanceEvent | null { /* ... */ }

  // ZERO update / delete methods — structural enforcement of D-PROV-01.
}
```

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.4 [VERIFIED: package.json line 48] |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/engine/__tests__/model-extraction.test.ts` |
| Full suite command | `npx vitest run` (aliased to `npm test`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROV-01 | Two events written (submitted + completed) per successful generation | integration | `npx vitest run src/store/__tests__/provenance-repo.test.ts` | Wave 0 |
| PROV-01 | Submitted row written even when ComfyUI rejects input (D-PROV-04) | integration | `npx vitest run src/engine/__tests__/generation-provenance.test.ts` | Wave 0 |
| PROV-02 | Model list extracted from prompt blob across loader classes | unit | `npx vitest run src/engine/__tests__/model-extraction.test.ts` | Wave 0 |
| PROV-02 | Nullable checksum tolerated end-to-end | unit | Same as above | Wave 0 |
| PROV-03 | ProvenanceRepo has zero UPDATE/DELETE methods | cross-cutting | `npx vitest run src/__tests__/architecture-purity.test.ts` | Wave 0 (extend existing) |
| PROV-04 | Field-level diff within matching node IDs | unit | `npx vitest run src/engine/__tests__/diff.test.ts` | Wave 0 |
| PROV-04 | Same-shot constraint enforced | unit | Same as above | Wave 0 |
| PROV-04 | Summary string deterministic + capped at 400 chars | unit | `npx vitest run src/engine/__tests__/diff-summary.test.ts` | Wave 0 |
| PROV-05 | Reproduce verbatim re-submits prompt_json | integration | `npx vitest run src/tools/__tests__/generation-reproduce-iterate.test.ts` | Wave 0 |
| PROV-05 | reproduction_warnings populated when model_hash null | integration | Same as above | Wave 0 |
| PROV-05 | REPRODUCE_BLOCKED when no completed event | integration | Same as above | Wave 0 |
| PROV-05 | Reproduce round-trip produces identical prompt_json (live) | live-smoke | `COMFYUI_API_KEY=... npx vitest run src/comfyui/__tests__/live-smoke-provenance.test.ts` | Wave 0 |
| PROV-06 | Node-scoped deep-merge of overrides | unit | `npx vitest run src/engine/__tests__/iterate-merge.test.ts` | Wave 0 |
| PROV-06 | Seed convenience: 0/1/many KSampler resolution | unit | Same as above | Wave 0 |
| PROV-06 | Iterate from failed uses workflow_json (D-PROV-24) | integration | `npx vitest run src/tools/__tests__/generation-reproduce-iterate.test.ts` | Wave 0 |
| Phase invariant | PNG tEXt chunk parser extracts 'prompt' key reliably | unit | `npx vitest run src/comfyui/__tests__/png-metadata.test.ts` | Wave 0 |
| Phase invariant | Tool budget 5 → 6 | cross-cutting | `npx vitest run src/__tests__/tool-budget.test.ts` | Wave 0 (extend) |
| Phase invariant | Engine modules have zero MCP imports | cross-cutting | `npx vitest run src/__tests__/architecture-purity.test.ts` | Wave 0 (extend) |
| Phase invariant | Prompt blob never logged to stdout/stderr | cross-cutting | `npx vitest run src/__tests__/stdio-hygiene.test.ts` | Wave 0 (extend) |

### Sampling Rate

- **Per task commit:** `npx vitest run src/<changed-dir>/__tests__/` (scoped to changed module).
- **Per wave merge:** `npx vitest run` (full suite).
- **Phase gate:** Full suite green + live-smoke green (with `COMFYUI_API_KEY` set) before `/gsd-verify-work`.

### Wave 0 Gaps

All Phase 3 test files are NEW. None exist yet:

- [ ] `src/engine/__tests__/model-extraction.test.ts` — covers PROV-02
- [ ] `src/engine/__tests__/diff.test.ts` — covers PROV-04 field-level + same-shot + not-completed guard
- [ ] `src/engine/__tests__/diff-summary.test.ts` — covers summary determinism + elision + cap
- [ ] `src/engine/__tests__/iterate-merge.test.ts` — covers PROV-06 overrides + seed convenience
- [ ] `src/engine/__tests__/generation-provenance.test.ts` — covers PROV-01/04 integration
- [ ] `src/store/__tests__/provenance-repo.test.ts` — covers PROV-03 append-only + ordering
- [ ] `src/tools/__tests__/version-tool.test.ts` — covers all 4 version actions + envelope + breadcrumb
- [ ] `src/tools/__tests__/generation-reproduce-iterate.test.ts` — covers PROV-05/06 tool-level
- [ ] `src/comfyui/__tests__/png-metadata.test.ts` — covers tEXt chunk extraction
- [ ] `src/comfyui/__tests__/live-smoke-provenance.test.ts` — covers PROV-01/05 live (gated on env var)

**Extensions to existing cross-cutting tests:**

- [ ] `src/__tests__/architecture-purity.test.ts` — add `src/engine/diff.ts`, `src/engine/diff-summary.ts`, `src/engine/iterate-merge.ts`, `src/engine/provenance.ts`, `src/store/provenance-repo.ts`, `src/comfyui/png-metadata.ts` to the zero-MCP-imports guard. Add assertion that `ProvenanceRepo` source file contains no `UPDATE ` or `DELETE ` SQL.
- [ ] `src/__tests__/tool-budget.test.ts` — bump expected from 5 to 6.
- [ ] `src/__tests__/stdio-hygiene.test.ts` — extend to assert provenance JSON (workflow/prompt blobs) never appears on stdout/stderr during submit/complete/reproduce/iterate paths.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | v25 (Homebrew) [VERIFIED: package.json `engines.node: ">=20"`] | — |
| `better-sqlite3` | Phase 3 provenance repo | ✓ | Phase 1 dep | — |
| `drizzle-orm` | Phase 3 migration | ✓ | Phase 1 dep | — |
| `vitest` | Tests | ✓ | ^4.1.4 | — |
| `.env` with `COMFYUI_API_KEY`+`COMFYUI_API_BASE` | Live-smoke test only | Assumed ✓ | — | Unit tests skip live-smoke when env var missing |

No new environmental dependencies. All Phase 3 work is pure-TypeScript + SQLite + already-locked deps.

## Risks & Pitfalls

### Risk 1: D-PROV-05 PNG path fails on non-PNG outputs

**What goes wrong:** Future workflows that produce video/audio (animatediff, audiocraft, etc.) cannot have prompt blobs reconstructed from the output file — PNG tEXt extraction returns null.
**Likelihood:** MEDIUM — most Phase 3 demo workflows are image-gen; risk grows as users explore video.
**Mitigation:** Phase 3 honestly records `prompt_json: null` on completed events for non-PNG outputs and emits a one-line warning. `reproduce` and `iterate` surface `PROVENANCE_UNAVAILABLE` cleanly. Deferred item: "PNG metadata parser as independent utility" with non-PNG formats as a separate concern.
**Detection:** Live-smoke test must assert that `prompt_json` is non-null for its PNG workflow. Any regression where it comes back null fails the smoke test loudly.

### Risk 2: Multi-KSampler workflows lose per-node seed fidelity in `provenance.seed`

**What goes wrong:** The `seed INTEGER NULL` column stores the first KSampler's seed only. Diff between two multi-KSampler versions uses `prompt_json` for full fidelity, but a summary query like `WHERE seed = ?` is lossy.
**Likelihood:** LOW for image gen, MEDIUM for video-gen chain workflows.
**Mitigation:** Full per-node seeds live in `prompt_json` — that's the source of truth. Column `provenance.seed` is a convenience. Document in the Phase 3 readme/comment that "seed column is the primary KSampler only; full prompt_json for fidelity."
**Detection:** Unit test `extractSeed()` with a 2-KSampler fixture — asserts the smaller node_id wins deterministically.

### Risk 3: JS Number precision on ComfyUI seeds >2^53

**What goes wrong:** ComfyUI emits 64-bit unsigned seeds; JSON.parse returns a JS number which loses precision above 2^53. The `provenance.seed INTEGER` column in SQLite is 64-bit, but the parse step is the bottleneck.
**Likelihood:** LOW — ComfyUI frontend uses JS and seeds stay safe in practice. [ASSUMED]
**Mitigation:** Phase 3 accepts JS-number precision. If live-smoke surfaces a truncation, add a TODO to switch storage to TEXT with string-encoded bigint. Not shipping that change in Phase 3 — no evidence of the problem yet.
**Detection:** Live-smoke logs the parsed seed and the original `prompt_json` substring — mismatch would be visible during the live-smoke log inspection.

### Risk 4: Append-only enforcement relies on convention, not DB

**What goes wrong:** `ProvenanceRepo` has no UPDATE/DELETE methods by construction, but a future contributor could add one. SQLite does not enforce immutability at the DB layer in Phase 3.
**Likelihood:** LOW — architecture-purity test catches the regression.
**Mitigation:** Extend `src/__tests__/architecture-purity.test.ts` with a string-scan assertion on `src/store/provenance-repo.ts`: "file source contains zero occurrences of `db.prepare(` followed by `'UPDATE ` or `'DELETE `". Crude but effective — catches careless additions.
**Detection:** CI test failure on the purity suite.

### Risk 5: Migration 0003 ordering in tests

**What goes wrong:** In-memory test DBs that open a fresh DB with only SCHEMA_DDL and then expect Phase 3 behavior would fail — migrations 0001/0002/0003 need to have run. Phase 2 already established `openDb()` runs SCHEMA_DDL then migrates; tests that instantiate `better-sqlite3` directly without calling `openDb()` will miss the new table.
**Likelihood:** MEDIUM — easy bug pattern.
**Mitigation:** All Phase 3 tests must use the Phase 1/2 test fixture (`test-utils/db-fixture.ts` or equivalent) that calls `openDb()`. Add a guard in `ProvenanceRepo` constructor: `SELECT 1 FROM provenance LIMIT 0` on construction — throws immediately if the table doesn't exist, with a hint to run migrations.
**Detection:** First test that imports `ProvenanceRepo` fails loudly on startup if the table is missing.

### Risk 6: `structuredClone` unavailable in older Node

**What goes wrong:** `applyOverrides` uses `structuredClone` — available in Node 17+ globally. package.json specifies `"node": ">=20"` so this is safe.
**Likelihood:** Zero given the Node 20+ engine constraint [VERIFIED: package.json].
**Mitigation:** None needed.

### Risk 7: Diff engine performance on large workflows

**What goes wrong:** A 200-node workflow with all fields changing would emit ~1000 ParamChanges. Summary elision at 6 handles the human output, but the full `changes.params` array grows linearly.
**Likelihood:** LOW for Phase 3 demo scale.
**Mitigation:** Summary caps at 6 + "and N more". No cap on `changes.params` array length in Phase 3 — deferred item "Diff limit / pagination on changes" covers this.
**Detection:** If seen in the wild, add a `limit` parameter to `version.diff` in a later phase.

## Pattern landmines

Reuse of Phase 1/2 patterns is expected. Landmines to avoid:

1. **Do NOT refactor Phase 2's `GenerationEngine.submitGeneration` in place.** Instead, extract a shared `submitInternal` helper that both the existing `submitGeneration` and the new `reproduceVersion`/`iterateFromVersion` call. Rationale: tests that pin Phase 2 behavior must still pass; a Phase 3 rewrite that changes Phase 2's happy path invites regression.

2. **Do NOT store the prompt blob in `versions.outputs_json`.** Provenance has its own `outputs_json` column that mirrors `versions.outputs_json` at event-emit time. The duplication is intentional (D-PROV-02 + Claude's-discretion note). Writing the prompt blob into `versions` would violate D-PROV-01 (append-only provenance).

3. **Do NOT couple `ComfyUIClient.fetchResolvedPrompt` to the `outputs: ComfyOutput[]` shape.** Accept a file path. The engine already has the path after `downloadToPath` returns. Couples less; survives a future switch to server-side endpoints.

4. **Do NOT add `UPDATE provenance ...` anywhere in the codebase.** Not in the repo, not in migrations, not in future compaction logic. The table is structurally append-only.

5. **Do NOT log prompt or workflow blobs to stdout/stderr.** Prompts may contain artist-private material. stdio-hygiene test must be extended to catch leaks from submit, complete, reproduce, iterate paths.

6. **Do NOT rely on undocumented ComfyUI Cloud endpoints without a live-smoke probe.** D-PROV-05's fallback plan exists precisely because `/api/history/{id}` on Cloud is unconfirmed. If a Phase 3 commit starts calling an endpoint based on `.planning/research/STACK.md` alone, the live-smoke test MUST prove it returns the expected shape before merge.

7. **Do NOT use a regex to parse PNG chunks.** PNG binary format. Walk the byte stream: 8-byte magic check, then loop: 4-byte BE length + 4-byte type + `<length>` bytes data + 4-byte CRC. tEXt payload is `key\0value` where key is ≤79 bytes ASCII. Anything else is a malformed file — return null.

8. **Do NOT write the `lineage_type` via a follow-up UPDATE to `versions`.** Include it in the initial INSERT of the new version row. D-PROV-33 allows an update-based fallback, but append-at-insert is cleaner and avoids a race where a reader sees `lineage_type: null` momentarily.

9. **Do NOT add a Zod discriminated union to `generation` tool that breaks Phase 2's existing shape.** Extend with two new action arms (`reproduce`, `iterate`) alongside the existing `submit` / `status` arms. Phase 2 tests for the existing arms must remain green.

10. **Do NOT introduce a new engine class.** Per CONTEXT.md code-context, Phase 3 composes new pure modules into the existing `GenerationEngine` and `Engine` facade. Creating `ProvenanceEngine` as a separate class duplicates plumbing.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ComfyUI Cloud outputs include PNG tEXt `prompt` chunk with resolved blob | D-PROV-05 Resolution | PRIMARY — if wrong, all Phase 3 reproduce/iterate broken. Live-smoke test is the gate. [CITED: numonic.ai blog, cross-ref CLAUDE.md] |
| A2 | Hand-rolled PNG tEXt parser fits in ~30 lines with acceptable robustness | Standard Stack | MEDIUM — if wrong, swap to `png-chunks-extract` (~2KB dep, tree-shakeable). |
| A3 | JS number precision is sufficient for typical ComfyUI seeds (< 2^53) | Seed extraction rules | LOW — ComfyUI frontend uses JS itself. Mitigation: TEXT storage swap available later. |
| A4 | `/api/history/{id}` is NOT exposed on ComfyUI Cloud | D-PROV-05 | MEDIUM — would only matter if Cloud exposes it and we miss a cleaner path. Smoke-probe in live-smoke test confirms. |
| A5 | `ProvenanceRepo.getLatestCompletedEvent` with the `(version_id, timestamp)` index is O(log n) | Schema migration | LOW — standard B-tree index behavior on SQLite. |
| A6 | `validateWorkflowFormat` from Phase 2 accepts a resolved prompt blob (not just an authored workflow) for iterate post-merge validation | Reproduce/iterate flow | MEDIUM — need to confirm the Phase 2 validator works on the merged blob. If it doesn't, factor it out into a `validatePromptBlobFormat` pair function. |
| A7 | Multi-output jobs embed identical `prompt` chunks in each PNG output | D-PROV-05 | LOW — same execution run per job. Accept first; warn on mismatch. |

## Open Questions

1. **Does `/api/history/{id}` exist on ComfyUI Cloud?**
   - What we know: Phase 2 research documented only `/api/prompt`, `/api/job/{id}/status`, `/api/view`. docs.comfy.org does not list `/api/history/{id}` for Cloud.
   - What's unclear: Whether it's undocumented-but-functional on Cloud (like on self-hosted ComfyUI).
   - Recommendation: Probe in live-smoke test (D-PROV-38 #8). Record findings in a spike note. PNG-tEXt path is the primary regardless.

2. **Does `/api/job/{id}/status` include a resolved prompt blob in any field?**
   - What we know: Phase 2 normalises the response to `{status, progress, outputs, error}`.
   - What's unclear: The raw response may include additional fields we ignore. Worth logging the raw body in live-smoke once.
   - Recommendation: Same as #1 — probe and record.

3. **Does `ComfyUIClient.downloadToPath` return a file path we can immediately re-read for PNG metadata?**
   - What we know: Phase 2's `downloadToPath` returns `{ path, url, contentType, sizeBytes }` [VERIFIED: client.ts:411-456].
   - What's unclear: Whether `contentType` reliably tells us PNG vs. non-PNG before we open the file. (MIME sniffing fallback available.)
   - Recommendation: Check `contentType.startsWith('image/png')` first; fall back to reading the first 8 bytes of the file to verify PNG magic.

## Sources

### Primary (HIGH confidence)

- `.planning/phases/03-provenance-versioning/03-CONTEXT.md` — all D-PROV-* decisions locked by discuss-phase.
- `.planning/phases/01-foundation-hierarchy/01-CONTEXT.md` — D-01..D-36 pattern basis.
- `.planning/phases/02-comfyui-generation/02-CONTEXT.md` — D-GEN-01..D-GEN-42 generation engine basis.
- `CLAUDE.md` — "prompt blob is truth" invariant, append-only provenance invariant.
- `src/comfyui/client.ts` — Phase 2 client shape; extension point for `fetchResolvedPrompt`.
- `src/comfyui/types.ts` — StatusResponse, ComfyOutput, StoredOutput shapes.
- `src/store/schema.ts` — Phase 1/2 migration split pattern (comment lines 98-116).
- `drizzle/0001_phase2_version_lifecycle.sql`, `drizzle/0002_idx_versions_status.sql` — migration pattern reference.
- `package.json` — vitest ^4.1.4, node >=20 verified.

### Secondary (MEDIUM confidence)

- `.planning/research/ARCHITECTURE.md` — "Pattern 2: Append-Only Provenance" direct model.
- `.planning/research/PITFALLS.md` (per CONTEXT.md canonical refs) — provenance gap honesty model.
- numonic.ai/blog/ai-dam-comfyui-two-json-blobs — PNG tEXt `prompt` + `workflow` chunks [CITED: canonical-refs external specs]
- numonic.ai/blog/png-metadata-vs-workflow-json-a-persistence-guide — tEXt reliability [CITED]
- docs.comfy.org/development/cloud/api-reference — Phase 2 endpoint set (no documented history endpoint) [CITED]

### Tertiary (LOW confidence — flagged for live-smoke probe)

- ComfyUI self-hosted `/history/{prompt_id}` endpoint returning resolved prompt blob — [ASSUMED] NOT verified on Cloud. Live-smoke probe in D-PROV-38 #8.
- npmjs.com/package/png-chunks-extract — backup dep if hand-roll proves awkward [CITED for fallback]

## Metadata

**Confidence breakdown:**

- **Schema migration + provenance table shape:** HIGH — fully locked by CONTEXT.md D-PROV-01..04, D-PROV-34..35. SQLite/drizzle patterns proven in Phase 1/2.
- **Model/seed extraction algorithms:** HIGH — pure functions over a documented prompt-blob shape. Unit-testable without external dependencies.
- **Diff engine approach:** HIGH — deterministic, hand-rolled, locked by D-PROV-15..20.
- **Iterate merge + validation:** HIGH — pure, deterministic, locked by D-PROV-21..26.
- **Reproduce flow:** HIGH — locked by D-PROV-27..31, reuses Phase 2 submit path.
- **D-PROV-05 prompt-blob source:** MEDIUM — PNG tEXt path has strong community documentation but is not yet proven on ComfyUI Cloud outputs in this repo. Mitigated by live-smoke probe + fallback flexibility of the layered client method.
- **PNG tEXt parser design:** MEDIUM-HIGH — PNG spec is stable and well-documented; hand-roll is straightforward.
- **Pattern landmines:** HIGH — directly derived from CONTEXT.md + inherited Phase 1/2 patterns.
- **Validation architecture:** HIGH — Vitest confirmed in package.json; existing cross-cutting tests already cover the patterns we're extending.

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (30-day stable window — Phase 3 stack is all inherited Phase 1/2 deps + hand-rolled modules, no fast-moving external APIs depended on beyond D-PROV-05 which has a live-smoke gate)
