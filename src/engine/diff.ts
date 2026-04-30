import { TypedError } from './errors.js';
import { buildSummary } from './diff-summary.js';
import type {
  DiffInput,
  DiffResponse,
  DiffChanges,
  DiffSnapshot,
  ParamChange,
  ModelChange,
  SeedChange,
  WorkflowStructureChange,
  MetadataChange,
  ModelRef,
  ReproductionDivergence,
} from '../types/provenance.js';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** True if `v` looks like a ComfyUI node link: `[nodeId, outputIndex]`. */
function isLinkRef(v: unknown): v is [string, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number';
}

function assertComparable(a: DiffSnapshot, b: DiffSnapshot): void {
  if (a.shot_id !== b.shot_id) {
    throw new TypedError(
      'INVALID_INPUT',
      'version.diff compares versions within the same shot',
      `Pass two version ids from the same shot. (v_a is in shot '${a.shot_id}', v_b is in shot '${b.shot_id}')`,
    );
  }
  const notReady = (s: DiffSnapshot): boolean => {
    // D-PROV-19: submitted/running has no usable blob; completed and failed both have at least workflow_json.
    if (s.status === 'submitted' || s.status === 'running') return true;
    return s.workflow_json === null && s.prompt_json === null;
  };
  if (notReady(a)) {
    throw new TypedError(
      'VERSION_NOT_COMPLETED',
      `Version '${a.version_id}' has no diff-ready provenance (status: ${a.status})`,
      `Wait for version to complete, then retry. Use generation tool with action:'status'.`,
    );
  }
  if (notReady(b)) {
    throw new TypedError(
      'VERSION_NOT_COMPLETED',
      `Version '${b.version_id}' has no diff-ready provenance (status: ${b.status})`,
      `Wait for version to complete, then retry. Use generation tool with action:'status'.`,
    );
  }
}

function pickBlob(s: DiffSnapshot): Record<string, unknown> {
  return (s.prompt_json ?? s.workflow_json ?? {}) as Record<string, unknown>;
}

function diffPromptParams(a: Record<string, unknown>, b: Record<string, unknown>): ParamChange[] {
  const out: ParamChange[] = [];
  const commonIds = new Set(Object.keys(a).filter((k) => k in b));
  for (const nodeId of commonIds) {
    const na = a[nodeId];
    const nb = b[nodeId];
    if (!isPlainObject(na) || !isPlainObject(nb)) continue;
    const classType =
      typeof nb.class_type === 'string'
        ? nb.class_type
        : typeof na.class_type === 'string'
          ? na.class_type
          : 'unknown';
    const ia = isPlainObject(na.inputs) ? na.inputs : {};
    const ib = isPlainObject(nb.inputs) ? nb.inputs : {};
    const fieldKeys = new Set([...Object.keys(ia), ...Object.keys(ib)]);
    for (const field of fieldKeys) {
      const va = ia[field];
      const vb = ib[field];
      // Skip link arrays — they surface via workflow structural diff only.
      if (isLinkRef(va) || isLinkRef(vb)) continue;
      if (JSON.stringify(va) !== JSON.stringify(vb)) {
        out.push({ node_id: nodeId, class_type: classType, field, before: va, after: vb });
      }
    }
  }
  return out;
}

function diffWorkflowStructure(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): WorkflowStructureChange[] {
  const out: WorkflowStructureChange[] = [];
  const aIds = new Set(Object.keys(a));
  const bIds = new Set(Object.keys(b));
  for (const id of aIds) {
    if (!bIds.has(id)) {
      const na = a[id];
      const ct = isPlainObject(na) && typeof na.class_type === 'string' ? na.class_type : 'unknown';
      out.push({ type: 'removed', node_id: id, class_type: ct });
    }
  }
  for (const id of bIds) {
    if (!aIds.has(id)) {
      const nb = b[id];
      const ct = isPlainObject(nb) && typeof nb.class_type === 'string' ? nb.class_type : 'unknown';
      out.push({ type: 'added', node_id: id, class_type: ct });
    }
  }
  return out;
}

function diffModels(a: ModelRef[] | null, b: ModelRef[] | null): ModelChange[] {
  const aMap = new Map((a ?? []).map((r) => [r.node_id, r]));
  const bMap = new Map((b ?? []).map((r) => [r.node_id, r]));
  const out: ModelChange[] = [];
  for (const [nodeId, bRef] of bMap) {
    const aRef = aMap.get(nodeId);
    if (!aRef) continue; // added — surfaced via structural diff
    if (aRef.model_name !== bRef.model_name || aRef.model_hash !== bRef.model_hash) {
      out.push({
        node_id: nodeId,
        class_type: bRef.class_type,
        before: { name: aRef.model_name, hash: aRef.model_hash },
        after: { name: bRef.model_name, hash: bRef.model_hash },
      });
    }
  }
  return out;
}

function diffSeeds(a: number | null, b: number | null): SeedChange | null {
  if (a === b) return null;
  return { before: a, after: b };
}

function diffMetadata(a: DiffSnapshot, b: DiffSnapshot): MetadataChange[] {
  const out: MetadataChange[] = [];
  if (a.created_at !== b.created_at) {
    out.push({ field: 'created_at', before: a.created_at, after: b.created_at });
  }
  if (a.completed_at !== b.completed_at) {
    out.push({ field: 'completed_at', before: a.completed_at, after: b.completed_at });
  }
  if (a.status !== b.status) {
    out.push({ field: 'status', before: a.status, after: b.status });
  }
  if (a.output_count !== b.output_count) {
    out.push({ field: 'output_count', before: a.output_count, after: b.output_count });
  }
  return out;
}

/**
 * D-PROV-15: structured + summarised diff. Pure, zero-IO.
 * Pre-conditions (D-PROV-19, D-PROV-20) throw TypedError with actionable hints.
 */
export function diffVersions(input: DiffInput): DiffResponse {
  assertComparable(input.a, input.b);
  const ab = pickBlob(input.a);
  const bb = pickBlob(input.b);
  const changes: DiffChanges = {
    params: diffPromptParams(ab, bb),
    models: diffModels(input.a.models_json, input.b.models_json),
    seed: diffSeeds(input.a.seed, input.b.seed),
    workflow: diffWorkflowStructure(ab, bb),
    metadata: diffMetadata(input.a, input.b),
  };
  return { summary: buildSummary(changes), changes };
}

/**
 * Phase 12 — DEMO-03 (D-CTX-4). Pure helper assembling the
 * reproduction_divergence field from already-resolved hashes + warnings.
 * Pure: no I/O, no disk reads, no DB reads. The Engine facade is
 * responsible for resolving the inputs (computeOutputSha256 + reading
 * reproduction_warnings_json from the version row).
 *
 * Returns null when ALL of the following hold:
 *   - warnings array is empty,
 *   - both hashes are present (i.e., outputs exist on disk) AND match,
 *     OR neither output exists.
 *
 * Returns the populated object when:
 *   - warnings is non-empty, OR
 *   - both hashes are present AND differ.
 *
 * sha256_mismatch is null when:
 *   - either hash is null (output missing — cannot compare bytes), or
 *   - hashes are equal.
 *
 * D-CTX-4 / criterion #4: a reproduce-lineage version whose bytes ARE
 * bit-identical to its parent AND has no warnings yields null here, so
 * the dashboard renders no pill + no comparison block.
 */
export function buildReproductionDivergence(args: {
  warnings: string[];
  parentHash: string | null;
  reproductionHash: string | null;
}): ReproductionDivergence | null {
  const parentPresent = args.parentHash !== null;
  const reproductionPresent = args.reproductionHash !== null;
  const bothPresent = parentPresent && reproductionPresent;
  const hashesMismatch =
    bothPresent && args.parentHash !== args.reproductionHash;
  const hasWarnings = args.warnings.length > 0;

  // Null path: no warnings AND (hashes match OR cannot compare).
  if (!hasWarnings && !hashesMismatch) return null;

  return {
    sha256_mismatch:
      bothPresent && hashesMismatch
        ? { parent: args.parentHash!, reproduction: args.reproductionHash! }
        : null,
    warnings: args.warnings,
    parent_output_present: parentPresent,
    reproduction_output_present: reproductionPresent,
  };
}
