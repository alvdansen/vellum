// src/engine/params-diff.ts
//
// Neutral params-diff (pivot Phase C) — the provider-agnostic reproduce model.
//
// ComfyUI reproduce/iterate is byte-identical because it re-submits a resolved
// node graph, and diff.ts compares that graph node-by-node (keyed on
// node_id/class_type). URL providers (Replicate/FAL/Scenario/Layer) have no
// graph — their generation is fully described by a flat `params` bag (the request
// `input`: prompt, seed, steps, guidance, sampler, …). This module diffs two such
// bags so reproduce/iterate/compare works across ANY provider, and a re-submit of
// the stored params IS the neutral "reproduce".
//
// PURE: zero imports. Deterministic. Consumed by the engine's cross-provider
// reproduce/diff paths and surfaced to agents via the diff tool envelope.

export type ParamChangeKind = 'added' | 'removed' | 'changed';

export interface ParamDiffEntry {
  /** Dot-path to the leaf that changed, e.g. "prompt" or "controlnet.scale". */
  path: string;
  kind: ParamChangeKind;
  before: unknown;
  after: unknown;
}

export interface ParamsDiffResult {
  changes: ParamDiffEntry[];
  identical: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Order-insensitive deep equality for leaf comparison (arrays compared in order). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
    return ak.every((k) => deepEqual(a[k], b[k]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  return false;
}

function walk(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  prefix: string,
  out: ParamDiffEntry[],
): void {
  // Stable union of keys so output ordering is deterministic.
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const inBefore = Object.prototype.hasOwnProperty.call(before, key);
    const inAfter = Object.prototype.hasOwnProperty.call(after, key);
    const bv = before[key];
    const av = after[key];

    if (inBefore && !inAfter) {
      out.push({ path, kind: 'removed', before: bv, after: undefined });
      continue;
    }
    if (!inBefore && inAfter) {
      out.push({ path, kind: 'added', before: undefined, after: av });
      continue;
    }
    // Present on both sides — recurse into nested objects, else compare as leaf.
    if (isPlainObject(bv) && isPlainObject(av)) {
      walk(bv, av, path, out);
    } else if (!deepEqual(bv, av)) {
      out.push({ path, kind: 'changed', before: bv, after: av });
    }
  }
}

/**
 * Diff two neutral param bags into a flat, deterministic list of leaf changes.
 * `identical` is true iff nothing changed. Nested objects are recursed by
 * dot-path; arrays and primitives are compared as leaves.
 */
export function diffParams(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ParamsDiffResult {
  const changes: ParamDiffEntry[] = [];
  walk(before ?? {}, after ?? {}, '', changes);
  return { changes, identical: changes.length === 0 };
}

/**
 * One-line human summary of a params diff (for agent-facing envelopes).
 * e.g. "3 params changed: seed 42→99, steps 20→30, +guidance".
 */
export function summarizeParamsDiff(result: ParamsDiffResult): string {
  if (result.identical) return 'No parameter changes.';
  const parts = result.changes.map((c) => {
    if (c.kind === 'added') return `+${c.path}`;
    if (c.kind === 'removed') return `-${c.path}`;
    return `${c.path} ${formatLeaf(c.before)}→${formatLeaf(c.after)}`;
  });
  return `${result.changes.length} parameter change${result.changes.length === 1 ? '' : 's'}: ${parts.join(', ')}`;
}

function formatLeaf(v: unknown): string {
  if (typeof v === 'string') return v.length > 24 ? `"${v.slice(0, 24)}…"` : `"${v}"`;
  if (v === null) return 'null';
  if (typeof v === 'object') return Array.isArray(v) ? `[${v.length}]` : '{…}';
  return String(v);
}
