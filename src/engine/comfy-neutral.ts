// src/engine/comfy-neutral.ts
//
// Cross-family diff (pivot item "d"): derive a NeutralProvenance from a resolved
// ComfyUI prompt graph so a completed ComfyUI version becomes field-comparable
// against a URL-provider version (Replicate/FAL/BytePlus/Google) via diffParams.
//
// ComfyUI deliberately omits GenerationProvider.describeProvenance — its resolved
// graph (prompt_json) is the source of truth for the rich node-level diff. But
// that graph has no field correspondence to a URL provider's flat request bag, so
// a mixed pair was previously refused. This module bridges them: it reduces the
// graph to the same shape URL adapters emit — { model_id, flat params, models } —
// WITHOUT touching the graph itself. ComfyUI↔ComfyUI diffs still route through the
// graph path (diff.ts keys on "has a graph", not on neutral-bag presence), so no
// richness is lost; the neutral bag only enables the cross-FAMILY comparison.
//
// Leaf module: imports from ./provenance and ./c2pa/ingredient-extractor but is
// imported by neither, so there is no import cycle. Pure / zero-IO.

import { extractModels, extractSeed } from './provenance.js';
import { extractInputAssertion } from './c2pa/ingredient-extractor.js';
import type { NeutralProvenance, NeutralModelRef } from '../providers/provenance.js';

/** Loader classes whose model name is the version's primary `model_id`. */
const PRIMARY_MODEL_CLASSES: ReadonlySet<string> = new Set([
  'CheckpointLoader',
  'CheckpointLoaderSimple',
  'UNETLoader',
]);

/**
 * Reduce a resolved ComfyUI prompt graph to a NeutralProvenance. Returns null
 * when the graph yields nothing comparable (no sampler-derived params AND no
 * models) — mirroring a URL adapter's describeProvenance returning null, so the
 * completion writer records no neutral bag and the version stays graph-only.
 *
 * `params` is intentionally FLAT (prompt_positive, prompt_negative, seed, steps,
 * cfg, denoise, sampler_name, scheduler) so diffParams compares leaves directly
 * rather than nested `sampler.*` paths. Only present keys are included, so a
 * graph without a resolvable prompt does not emit null-valued noise.
 */
export function comfyNeutralProvenance(
  promptBlob: Record<string, unknown>,
  providerId: string,
): NeutralProvenance | null {
  const models = extractModels(promptBlob);
  const seed = extractSeed(promptBlob);
  const ia = extractInputAssertion(promptBlob, seed);

  const params: Record<string, unknown> = {};
  // `prompt`/`seed`/`steps` use the names URL providers commonly emit so a
  // cross-family diff aligns the fields that DO correspond (the prompt and seed)
  // instead of showing them as spurious add/remove. Backend-specific params
  // (cfg, sampler, scheduler, denoise) keep ComfyUI names — they have no URL
  // equivalent and honestly surface as backend differences.
  if (ia.prompt_positive != null) params.prompt = ia.prompt_positive;
  if (ia.prompt_negative != null) params.negative_prompt = ia.prompt_negative;
  if (ia.seed != null) params.seed = ia.seed;
  if (ia.sampler.name != null) params.sampler_name = ia.sampler.name;
  if (ia.sampler.scheduler != null) params.scheduler = ia.sampler.scheduler;
  if (ia.sampler.steps != null) params.steps = ia.sampler.steps;
  if (ia.sampler.cfg != null) params.cfg = ia.sampler.cfg;
  if (ia.sampler.denoise != null) params.denoise = ia.sampler.denoise;

  // Nothing comparable → no neutral bag (stays a graph-only version).
  if (Object.keys(params).length === 0 && models.length === 0) return null;

  const neutralModels: NeutralModelRef[] = models.map((m) => ({
    provider_model_id: m.model_name,
    hash: null,
  }));

  // model_id is ONLY a primary checkpoint/UNET — never a LoRA/VAE/CLIP/ControlNet
  // loader (which would mislabel the version's base model). Absent when the graph
  // has no primary loader.
  const primary = models.find((m) => PRIMARY_MODEL_CLASSES.has(m.class_type))?.model_name;

  return {
    provider_id: providerId,
    ...(primary != null ? { model_id: primary } : {}),
    params,
    models: neutralModels,
  };
}
