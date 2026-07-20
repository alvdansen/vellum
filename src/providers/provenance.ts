// src/providers/provenance.ts
//
// Neutral provenance shapes — the MINIMUM every GenerationProvider can supply,
// independent of ComfyUI's prompt-graph model. Serialized into
// provenance.generation_result_json (migration 0009). ComfyUI keeps using its
// richer ModelRef / prompt_json columns; URL-based providers (Replicate / FAL /
// Scenario / Layer) fill these instead.
//
// PURITY: zero imports — pure type source, part of the zero-dependency core
// (guarded by architecture-purity.test.ts for src/providers/).
//
// Phase B introduces the TYPES + storage columns. Phase C's Replicate adapter is
// the first writer; the neutral params-diff reproduce model is the first reader.

/** Why a model's weight hash is not a cryptographic fingerprint for this provider. */
export type ModelHashUnavailableReason =
  | 'hosted_provider' // weights live behind an API — no local bytes to hash
  | 'models_dir_not_configured';

/**
 * A neutral reference to a model/checkpoint used in a generation. ComfyUI's
 * richer ModelRef (node_id / class_type) stays separate; this is what a hosted
 * provider can honestly assert.
 */
export interface NeutralModelRef {
  /** Provider-scoped model id — Replicate owner/model:version, fal-ai/flux/dev, Scenario model id, … */
  provider_model_id: string;
  /** SHA-256 of the weights when locally hashable; null for hosted providers. */
  hash?: string | null;
  /** Present iff hash is null — records WHY, so provenance strength is explicit, not silently degraded. */
  unavailable_reason?: ModelHashUnavailableReason;
}

/** One input asset fed into a generation (init image, mask, control image, …). */
export interface NeutralProvenanceInput {
  role: string; // 'image' | 'mask' | 'control' | …
  ref: string; // URL or opaque provider ref
  hash?: string | null; // SHA-256 when the bytes were available to hash
}

/**
 * The neutral generation record — the minimum contract every provider fills for
 * a completed output. `params` is the provider-agnostic bag the params-diff
 * reproduce model (Phase C) compares across versions.
 */
export interface NeutralProvenance {
  provider_id: string;
  model_id?: string;
  /** prompt_positive, prompt_negative, seed, steps, guidance/cfg, sampler, scheduler, … */
  params: Record<string, unknown>;
  inputs?: NeutralProvenanceInput[];
  models: NeutralModelRef[];
  /** SHA-256 of the produced bytes — the one hash EVERY provider can give. */
  output_hash?: string | null;
  /** ComfyUI-only enrichment: the resolved prompt graph, for diff / ingredient use. Empty elsewhere. */
  raw_provider_blob?: unknown;
}
