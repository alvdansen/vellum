import type { ModelRef } from '../types/provenance.js';
import type { ProvenanceRepo } from '../store/provenance-repo.js';

/** D-PROV-06 loader class_types. */
export const LOADER_CLASS_TYPES: ReadonlySet<string> = new Set([
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

/** D-PROV-22 KSampler class_types for seed extraction and iterate.seed shortcut. */
export const KSAMPLER_CLASS_TYPES: ReadonlySet<string> = new Set([
  'KSampler',
  'KSamplerAdvanced',
  'SamplerCustom',
  'SamplerCustomAdvanced',
]);

/** Per class_type, the canonical input field name(s) for the model file. */
export const MODEL_FIELD_BY_CLASS: Record<string, string[]> = {
  CheckpointLoader: ['ckpt_name'],
  CheckpointLoaderSimple: ['ckpt_name'],
  LoraLoader: ['lora_name'],
  LoraLoaderModelOnly: ['lora_name'],
  VAELoader: ['vae_name'],
  UNETLoader: ['unet_name'],
  CLIPLoader: ['clip_name', 'clip_name1', 'clip_name2'],
  ControlNetLoader: ['control_net_name'],
  StyleModelLoader: ['style_model_name'],
};

/** Phase 13 (D-CTX-2). Per loader class_type, the canonical models-subdir
 *  under VFX_FAMILIAR_MODELS_DIR — `MODEL_DIR_BY_CLASS` mirrors the structure
 *  of `MODEL_FIELD_BY_CLASS` above; every key in LOADER_CLASS_TYPES MUST
 *  appear here so fingerprintModel never falls into the
 *  `unsupported_class_type` defensive path for a recognised loader. The
 *  lockstep invariant is locked by a test in
 *  src/engine/__tests__/model-extraction.test.ts. */
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function pickModelName(inputs: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) {
    const v = inputs[f];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/**
 * D-PROV-06: walk the resolved prompt blob for loader nodes and emit
 * ModelRef[]. Sorted by node_id (numeric ascending) so the output is
 * deterministic across runs.
 *
 * Pure: zero IO. Model hashes always null in Phase 3.
 */
export function extractModels(promptBlob: Record<string, unknown>): ModelRef[] {
  const out: ModelRef[] = [];
  for (const [nodeId, raw] of Object.entries(promptBlob)) {
    if (!isPlainObject(raw)) continue;
    const classType = raw.class_type;
    if (typeof classType !== 'string') continue;
    if (!LOADER_CLASS_TYPES.has(classType)) continue;
    const inputs = raw.inputs;
    if (!isPlainObject(inputs)) continue;
    const fields = MODEL_FIELD_BY_CLASS[classType] ?? [];
    const modelName = pickModelName(inputs, fields);
    if (modelName === null) continue;
    out.push({
      node_id: nodeId,
      class_type: classType,
      model_name: modelName,
      model_hash: null,
      model_hash_unavailable: null,
    });
  }
  out.sort((a, b) => {
    const na = Number(a.node_id);
    const nb = Number(b.node_id);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.node_id.localeCompare(b.node_id);
  });
  return out;
}

/**
 * Pure seed extraction from a resolved prompt blob. Returns the seed from
 * a single KSampler node, or null for 0 / many / non-integer cases. The
 * engine layer decides how to surface "many" (ITERATE_INVALID_PATCH for
 * iterate; the completed-event writer accepts null silently).
 */
export function extractSeed(promptBlob: Record<string, unknown>): number | null {
  const ksamplers: Array<{ nodeId: string; seed: unknown }> = [];
  for (const [nodeId, raw] of Object.entries(promptBlob)) {
    if (!isPlainObject(raw)) continue;
    const classType = raw.class_type;
    if (typeof classType !== 'string') continue;
    if (!KSAMPLER_CLASS_TYPES.has(classType)) continue;
    const inputs = raw.inputs;
    if (!isPlainObject(inputs)) continue;
    ksamplers.push({ nodeId, seed: inputs.seed });
  }
  if (ksamplers.length !== 1) return null;
  const s = ksamplers[0]!.seed;
  if (typeof s === 'number' && Number.isFinite(s) && Number.isInteger(s) && s >= 0) return s;
  return null;
}

/**
 * Orchestrates provenance-event writes around the submit/terminal lifecycle.
 * Constructor-injected repo — this class has zero direct DB calls. It is
 * the only non-pure export of this module, but still MCP-free.
 */
export class ProvenanceWriter {
  constructor(private repo: ProvenanceRepo) {}

  writeSubmitEvent(versionId: string, workflowJson: Record<string, unknown>): void {
    this.repo.insertEvent(versionId, {
      event_type: 'submitted',
      workflow_json: JSON.stringify(workflowJson),
    });
  }

  writeCompletedEvent(
    versionId: string,
    promptBlob: Record<string, unknown> | null,
    outputsJson: string,
  ): void {
    const models = promptBlob ? extractModels(promptBlob) : [];
    const seed = promptBlob ? extractSeed(promptBlob) : null;
    this.repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: promptBlob ? JSON.stringify(promptBlob) : null,
      seed,
      models_json: JSON.stringify(models),
      outputs_json: outputsJson,
    });
  }

  writeFailedEvent(versionId: string, errorCode: string, errorMessage: string): void {
    this.repo.insertEvent(versionId, {
      event_type: 'failed',
      error_code: errorCode,
      error_message: errorMessage,
    });
  }
}
