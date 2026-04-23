import { TypedError } from './errors.js';
import { KSAMPLER_CLASS_TYPES } from './provenance.js';
import type { IterateOverride } from '../types/provenance.js';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Dangerous keys that must never be merged (prototype-pollution guard — T-03-02). */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export function findKSamplerNodes(blob: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const [nodeId, raw] of Object.entries(blob)) {
    if (!isPlainObject(raw)) continue;
    if (typeof raw.class_type === 'string' && KSAMPLER_CLASS_TYPES.has(raw.class_type)) {
      ids.push(nodeId);
    }
  }
  return ids.sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

/**
 * D-PROV-22: seed convenience. Exactly 1 KSampler → set its inputs.seed.
 * 0 / >1 / negative → TypedError. Returns a deep-clone — does not mutate the input.
 */
export function applySeedShortcut(
  blob: Record<string, unknown>,
  seed: number,
): Record<string, unknown> {
  if (!Number.isFinite(seed) || !Number.isInteger(seed) || seed < 0) {
    throw new TypedError(
      'ITERATE_INVALID_PATCH',
      `seed must be a non-negative integer (received: ${String(seed)})`,
      'Pass seed >= 0 or use an explicit overrides entry targeting a specific node.',
    );
  }
  const ids = findKSamplerNodes(blob);
  if (ids.length === 0) {
    throw new TypedError(
      'ITERATE_INVALID_PATCH',
      'No KSampler node found in source prompt',
      `Use an explicit overrides entry instead, e.g. overrides: { '<sampler_node_id>': { inputs: { seed: ${seed} } } }.`,
    );
  }
  if (ids.length > 1) {
    throw new TypedError(
      'ITERATE_INVALID_PATCH',
      `Multiple KSampler nodes found (${ids.join(', ')}) — ambiguous seed shortcut`,
      `Use an explicit overrides entry, e.g. overrides: { '${ids[0]}': { inputs: { seed: ${seed} } } }.`,
    );
  }
  const clone = structuredClone(blob) as Record<string, unknown>;
  const node = clone[ids[0]!] as Record<string, unknown>;
  const inputs = isPlainObject(node.inputs) ? { ...node.inputs } : {};
  inputs.seed = seed;
  node.inputs = inputs;
  return clone;
}

/**
 * D-PROV-21, D-PROV-23: deep-clone + per-node shallow-merge of inputs + optional class_type.
 * Throws ITERATE_INVALID_PATCH on unknown node id, non-plain inputs, or forbidden keys.
 * Prototype-pollution guard (T-03-02): rejects __proto__, constructor, prototype
 * both as outer node-id keys and as inputs field keys.
 */
export function applyOverrides(
  blob: Record<string, unknown>,
  overrides: Record<string, IterateOverride>,
): Record<string, unknown> {
  if (!isPlainObject(overrides)) {
    throw new TypedError(
      'ITERATE_INVALID_PATCH',
      'overrides must be a plain object keyed by node id',
      'Pass overrides as { "<nodeId>": { inputs: { ... } } }.',
    );
  }
  const validIds = Object.keys(blob);
  const clone = structuredClone(blob) as Record<string, unknown>;
  for (const [nodeId, patch] of Object.entries(overrides)) {
    if (FORBIDDEN_KEYS.has(nodeId)) {
      throw new TypedError(
        'ITERATE_INVALID_PATCH',
        `override key '${nodeId}' is forbidden (prototype pollution guard)`,
        'Use numeric string node ids only.',
      );
    }
    if (!(nodeId in clone)) {
      throw new TypedError(
        'ITERATE_INVALID_PATCH',
        `override references unknown node id '${nodeId}'`,
        `Valid node ids in source: ${validIds.join(', ')}`,
      );
    }
    if (!isPlainObject(patch)) {
      throw new TypedError(
        'ITERATE_INVALID_PATCH',
        `override for node '${nodeId}' must be an object`,
        'Shape: { inputs?: { ... }, class_type?: string }.',
      );
    }
    const target = clone[nodeId];
    if (!isPlainObject(target)) {
      throw new TypedError(
        'ITERATE_INVALID_PATCH',
        `source node '${nodeId}' is not an object`,
        'Cannot override a non-object node.',
      );
    }
    if (patch.class_type !== undefined) {
      if (typeof patch.class_type !== 'string') {
        throw new TypedError(
          'ITERATE_INVALID_PATCH',
          `override '${nodeId}'.class_type must be a string`,
          'Pass a string class_type like "KSampler".',
        );
      }
      target.class_type = patch.class_type;
    }
    if (patch.inputs !== undefined) {
      if (!isPlainObject(patch.inputs)) {
        throw new TypedError(
          'ITERATE_INVALID_PATCH',
          `override '${nodeId}'.inputs must be a plain object`,
          'Pass inputs as { "<field>": <value> } with primitive, array, or plain-object values.',
        );
      }
      const mergedInputs = isPlainObject(target.inputs) ? { ...target.inputs } : {};
      for (const [field, value] of Object.entries(patch.inputs)) {
        if (FORBIDDEN_KEYS.has(field)) {
          throw new TypedError(
            'ITERATE_INVALID_PATCH',
            `override '${nodeId}'.inputs.${field} key is forbidden (prototype pollution guard)`,
            'Use ComfyUI node input field names only.',
          );
        }
        if (typeof value === 'function') {
          throw new TypedError(
            'ITERATE_INVALID_PATCH',
            `override '${nodeId}'.inputs.${field} value must not be a function`,
            'Pass primitives, arrays, or plain objects only.',
          );
        }
        if (value === undefined) {
          throw new TypedError(
            'ITERATE_INVALID_PATCH',
            `override '${nodeId}'.inputs.${field} value must not be undefined`,
            'Use null to clear a field; undefined is not serializable.',
          );
        }
        mergedInputs[field] = value;
      }
      target.inputs = mergedInputs;
    }
  }
  return clone;
}
