// Phase 15 — PROV-V-04 (D-CTX-1). Pure ingredient extraction for the C2PA
// manifest's parentOf / componentOf / inputTo assertions. Zero I/O, zero
// SDK consumption — drives off the resolved prompt blob and the Version
// record. Architecture-purity: zero MCP / DB / ORM / HTTP / native-c2pa-binding
// imports.
//
// T-15-01 mitigation: extractInputAssertion returns a STRUCTURED, BOUNDED
// shape (prompt text + sampler params + seed). NO workflow_json verbatim
// dump — that surface would leak user secrets, API keys, or inline binary.
//
// REVISION B5: extractInputAssertion resolves prompt_positive / prompt_negative
// by FOLLOWING THE KSAMPLER EDGES (positive / negative are
// [source_node_id, output_index] tuples pointing at CLIPTextEncode-class
// ancestors). The earlier "first vs second CLIPTextEncode" heuristic was
// wrong — workflows can have N CLIPTextEncode nodes (multi-conditioning,
// unused experimental branches) and only the ones the KSampler references
// affect the output. Edge walk reflects ComfyUI's actual graph semantics.

import {
  IMAGE_INPUT_CLASS_TYPES,
  IMAGE_FIELD_BY_CLASS,
  LOADER_CLASS_TYPES,
  KSAMPLER_CLASS_TYPES,
} from '../provenance.js';
import type { Version } from '../../types/hierarchy.js';

/** T-15-01 — cap inputTo prompt text at 4096 chars; longer values truncate
 *  with an explicit marker so verifiers see the truncation as a feature
 *  rather than data corruption. */
export const INPUT_PROMPT_MAX_CHARS = 4096;

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ComponentRole = 'control' | 'reference' | 'mask' | 'image';

export interface ParentIngredient {
  parent_version_id: string;
  lineage_type: 'reproduce' | 'iterate';
  manifest_hash: string | null;
  /** Reason code when manifest_hash is null. NULL when manifest_hash is populated. */
  parent_unavailable: 'parent_manifest_pending' | null;
}

export interface ComponentIngredient {
  node_id: string;
  class_type: string;
  role: ComponentRole;
  /** Filename as recorded in the prompt blob's source LoadImage* node
   *  (basename only — Comfy stores basenames). For VAEEncode* this is
   *  the upstream LoadImage*'s filename, resolved via edge walk. */
  input_filename: string;
}

export interface InputAssertion {
  prompt_positive: string | null;
  prompt_negative: string | null;
  sampler: {
    name: string | null;
    scheduler: string | null;
    steps: number | null;
    cfg: number | null;
    denoise: number | null;
  };
  seed: number | null;
}

// ────────────────────────────────────────────────────────────────────────
// Private helpers
// ────────────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** ComfyUI edge tuple: [source_node_id, output_index]. Type-guard. */
function isEdgeTuple(v: unknown): v is [string, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === 'string' &&
    typeof v[1] === 'number' &&
    Number.isFinite(v[1])
  );
}

/** Resolve `inputs[field]` as either a direct string filename OR an edge
 *  tuple to an upstream LoadImage*-class node, returning the filename in
 *  either case. Returns null when the field is missing OR the upstream
 *  node is not a recognised filename-bearing node (e.g.,
 *  EmptyLatentImage → VAEDecode → VAEEncode chain has no canonical
 *  filename). */
function resolveImageFilename(
  promptBlob: Record<string, unknown>,
  inputs: Record<string, unknown>,
  fields: string[],
): string | null {
  for (const f of fields) {
    const v = inputs[f];
    if (typeof v === 'string' && v.length > 0) {
      return v; // Direct filename (LoadImage / LoadImageMask / ControlNetApply* shape)
    }
    if (isEdgeTuple(v)) {
      // Edge walk — follow to upstream node and read its 'image' field.
      // Only one hop; we do not recurse further (defence-in-depth against
      // malformed cyclic blobs).
      const upstream = promptBlob[v[0]];
      if (!isPlainObject(upstream)) continue;
      const upstreamClass = upstream.class_type;
      if (typeof upstreamClass !== 'string') continue;
      // Only treat LoadImage / LoadImageMask as filename-bearing
      // ancestors. Other producers (EmptyLatentImage, procedural nodes)
      // are silently skipped.
      if (upstreamClass !== 'LoadImage' && upstreamClass !== 'LoadImageMask') continue;
      const upstreamInputs = upstream.inputs;
      if (!isPlainObject(upstreamInputs)) continue;
      const fname = upstreamInputs.image;
      if (typeof fname === 'string' && fname.length > 0) return fname;
    }
  }
  return null;
}

function classRole(classType: string): ComponentRole {
  switch (classType) {
    case 'LoadImageMask':
      return 'mask';
    case 'ControlNetApply':
    case 'ControlNetApplyAdvanced':
      return 'control';
    case 'VAEEncode':
    case 'VAEEncodeForInpaint':
      return 'reference';
    default:
      return 'image'; // LoadImage and any future additive entry
  }
}

function truncatePrompt(text: string): string {
  if (text.length <= INPUT_PROMPT_MAX_CHARS) return text;
  const truncated = text.slice(0, INPUT_PROMPT_MAX_CHARS);
  const dropped = text.length - INPUT_PROMPT_MAX_CHARS;
  return `${truncated}...[${dropped} chars truncated]`;
}

/** Sort by node_id: numeric where possible, string fallback. Same shape
 *  as extractModels' sort (provenance.ts). */
function compareNodeId(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

/** Recognised text-encoder class names whose inputs.text (or text_g/text_l)
 *  feeds a KSampler positive/negative edge. Add to this list as new
 *  ComfyUI text-encoder nodes appear (v1.2 audit). */
const TEXT_ENCODER_CLASSES: ReadonlySet<string> = new Set([
  'CLIPTextEncode',
  'CLIPTextEncodeSDXL',
  'CLIPTextEncodeSDXLRefiner',
]);

/** Follow an edge tuple to a CLIPTextEncode-class node and return its
 *  inputs.text string. Returns null when the edge is malformed or the
 *  upstream node is not a recognised text-encoder class.
 *
 *  Note: only direct CLIPTextEncode ancestors are recognised in v1.1.
 *  Deeper traversal through ConditioningCombine / ConditioningConcat /
 *  prompt-graph nodes is deferred to v1.2 — record the limitation in
 *  15-01-SUMMARY.md. */
function resolveCLIPTextFromEdge(
  promptBlob: Record<string, unknown>,
  edge: unknown,
): string | null {
  if (!isEdgeTuple(edge)) return null;
  const upstream = promptBlob[edge[0]];
  if (!isPlainObject(upstream)) return null;
  const upstreamClass = upstream.class_type;
  if (typeof upstreamClass !== 'string') return null;
  if (!TEXT_ENCODER_CLASSES.has(upstreamClass)) return null;
  const upstreamInputs = upstream.inputs;
  if (!isPlainObject(upstreamInputs)) return null;
  // CLIPTextEncodeSDXL has both text_g and text_l; prefer text, then text_g, then text_l.
  const text = upstreamInputs.text;
  if (typeof text === 'string') return text;
  const textG = upstreamInputs.text_g;
  if (typeof textG === 'string') return textG;
  const textL = upstreamInputs.text_l;
  if (typeof textL === 'string') return textL;
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Public function 1: extractParentIngredient
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a ParentIngredient from a Version + caller-supplied parent-manifest-hash.
 *
 * Returns NULL when the version has no parent (parent_version_id is null —
 * top-of-lineage version). When parent_version_id is set, the caller MUST
 * provide getParentManifestHash; if that returns null, the ingredient
 * records 'parent_manifest_pending' per D-CTX-6.
 *
 * Pure: zero I/O — the caller is responsible for the manifest-hash lookup.
 */
export function extractParentIngredient(
  version: Pick<Version, 'parent_version_id' | 'lineage_type'>,
  getParentManifestHash: (parentVersionId: string) => string | null,
): ParentIngredient | null {
  if (version.parent_version_id === null) return null;
  // lineage_type is REQUIRED for a parentOf assertion — when null we still
  // emit the ingredient but coerce to 'iterate' (the more permissive of
  // the two lineage variants); the parent itself carries the authoritative
  // lineage_type. Defensive default — in production every reproduce/iterate
  // child has lineage_type set at creation time.
  const lineage: 'reproduce' | 'iterate' = version.lineage_type ?? 'iterate';
  const parentHash = getParentManifestHash(version.parent_version_id);
  if (parentHash === null) {
    return {
      parent_version_id: version.parent_version_id,
      lineage_type: lineage,
      manifest_hash: null,
      parent_unavailable: 'parent_manifest_pending',
    };
  }
  return {
    parent_version_id: version.parent_version_id,
    lineage_type: lineage,
    manifest_hash: parentHash,
    parent_unavailable: null,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Public function 2: extractComponentIngredients
// ────────────────────────────────────────────────────────────────────────

/**
 * Walk a resolved prompt blob and emit one ComponentIngredient per
 * non-loader image-input node. Sorted ascending by node_id (numeric where
 * possible, string fallback) — matches extractModels' determinism contract.
 *
 * For nodes whose image-input field is a STRING filename (LoadImage,
 * LoadImageMask, ControlNetApply*) the filename is read directly. For
 * nodes whose field is an EDGE TUPLE (VAEEncode.pixels, VAEEncodeForInpaint.pixels),
 * we follow the edge to the upstream LoadImage* node and use its filename.
 * When the upstream is not a recognised filename-bearing node, the entry
 * is silently skipped (no canonical filename).
 *
 * Pure: zero I/O. Hashes are NOT computed here — Plan 15-03's engine
 * integration calls hashComponentBytes per ingredient.
 */
export function extractComponentIngredients(
  promptBlob: Record<string, unknown>,
): ComponentIngredient[] {
  const out: ComponentIngredient[] = [];
  for (const [nodeId, raw] of Object.entries(promptBlob)) {
    if (!isPlainObject(raw)) continue;
    const classType = raw.class_type;
    if (typeof classType !== 'string') continue;
    if (LOADER_CLASS_TYPES.has(classType)) continue; // Phase 13's domain
    if (!IMAGE_INPUT_CLASS_TYPES.has(classType)) continue;
    const inputs = raw.inputs;
    if (!isPlainObject(inputs)) continue;
    const fields = IMAGE_FIELD_BY_CLASS[classType] ?? [];
    const filename = resolveImageFilename(promptBlob, inputs, fields);
    if (filename === null) continue;
    out.push({
      node_id: nodeId,
      class_type: classType,
      role: classRole(classType),
      input_filename: filename,
    });
  }
  out.sort((a, b) => compareNodeId(a.node_id, b.node_id));
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Public function 3: extractInputAssertion (REVISION B5 — KSampler edge walk)
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a structured inputTo payload from a resolved prompt blob + seed.
 *
 * REVISION B5: prompt_positive / prompt_negative are resolved by walking
 * KSampler.inputs.positive / inputs.negative as edge tuples
 * [source_node_id, output_index]. We follow each tuple to the referenced
 * node; if its class_type is one of the CLIPTextEncode variants, we read
 * its inputs.text. The earlier "first / second CLIPTextEncode by node_id
 * order" heuristic was wrong: workflows can have multiple unused
 * CLIPTextEncode nodes (experimental branches, multi-conditioning splits)
 * and only the ones the KSampler actually consumes affect the output.
 *
 * When prompt_blob has multiple KSamplers, we use the FIRST one (lowest
 * node_id) whose positive AND negative edges resolve to a CLIPTextEncode
 * with a string text field. If none resolve, prompt_positive /
 * prompt_negative are null but the sampler params + seed are still
 * extracted from the first KSampler.
 *
 * T-15-01 mitigation: returns a BOUNDED, STRUCTURED shape — prompt text
 * (truncated at INPUT_PROMPT_MAX_CHARS), sampler params, seed. NEVER
 * the workflow_json verbatim.
 *
 * Pure: zero I/O.
 */
export function extractInputAssertion(
  promptBlob: Record<string, unknown>,
  seed: number | null,
): InputAssertion {
  // Collect KSampler nodes in node-id order.
  const ksamplerEntries: Array<{ nodeId: string; inputs: Record<string, unknown> }> = [];
  const orderedEntries = Object.entries(promptBlob).sort(([a], [b]) => compareNodeId(a, b));
  for (const [nodeId, raw] of orderedEntries) {
    if (!isPlainObject(raw)) continue;
    const classType = raw.class_type;
    if (typeof classType !== 'string') continue;
    const inputs = raw.inputs;
    if (!isPlainObject(inputs)) continue;
    if (KSAMPLER_CLASS_TYPES.has(classType)) {
      ksamplerEntries.push({ nodeId, inputs });
    }
  }

  // Pick the first KSampler with resolvable positive AND/OR negative edges
  // pointing at CLIPTextEncode-class nodes. If none satisfy, fall back to
  // the first KSampler for sampler-params extraction.
  let chosenInputs: Record<string, unknown> | null = null;
  let prompt_positive: string | null = null;
  let prompt_negative: string | null = null;

  for (const { inputs } of ksamplerEntries) {
    const pos = resolveCLIPTextFromEdge(promptBlob, inputs.positive);
    const neg = resolveCLIPTextFromEdge(promptBlob, inputs.negative);
    if (pos !== null || neg !== null) {
      chosenInputs = inputs;
      prompt_positive = pos !== null ? truncatePrompt(pos) : null;
      prompt_negative = neg !== null ? truncatePrompt(neg) : null;
      break;
    }
  }
  // Fallback: no resolvable edges → use first KSampler for sampler params,
  // leave prompt_positive / prompt_negative as null.
  if (chosenInputs === null && ksamplerEntries.length > 0) {
    chosenInputs = ksamplerEntries[0]!.inputs;
  }

  const pickStr = (k: string): string | null => {
    if (chosenInputs === null) return null;
    const v = chosenInputs[k];
    return typeof v === 'string' ? v : null;
  };
  const pickNum = (k: string): number | null => {
    if (chosenInputs === null) return null;
    const v = chosenInputs[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  return {
    prompt_positive,
    prompt_negative,
    sampler: {
      name: pickStr('sampler_name'),
      scheduler: pickStr('scheduler'),
      steps: pickNum('steps'),
      cfg: pickNum('cfg'),
      denoise: pickNum('denoise'),
    },
    seed,
  };
}
