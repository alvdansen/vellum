import type {
  DiffChanges,
  ParamChange,
  ModelChange,
  WorkflowStructureChange,
  MetadataChange,
  SeedChange,
} from '../types/provenance.js';

/** D-PROV-18: deterministic template-based summary. Pure. */
const MAX_CHANGES = 6;
const HARD_CAP = 400;

function fmt(v: unknown): string {
  if (typeof v === 'string') return v.length > 24 ? `${v.slice(0, 21)}...` : v;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'object') return '{…}';
  return String(v);
}

function renderParam(c: ParamChange): string {
  return `Node ${c.node_id} (${c.class_type}): ${c.field} ${fmt(c.before)}→${fmt(c.after)}`;
}

function renderModel(c: ModelChange): string {
  return `Node ${c.node_id} (${c.class_type}): model ${fmt(c.before.name)}→${fmt(c.after.name)}`;
}

function renderSeed(s: SeedChange): string {
  return `seed ${fmt(s.before)}→${fmt(s.after)}`;
}

function renderWorkflow(c: WorkflowStructureChange): string {
  return `${c.type === 'added' ? '+' : '-'}Node ${c.node_id} (${c.class_type})`;
}

function renderMetadata(c: MetadataChange): string {
  return `${c.field}: ${fmt(c.before)}→${fmt(c.after)}`;
}

/**
 * Build the deterministic diff summary. Stable ordering:
 *   params (by numeric node_id asc, then field) → models → seed → workflow → metadata.
 * At most MAX_CHANGES parts are listed; overflow elides with `"…and N more changes"`.
 * Output capped at HARD_CAP chars.
 */
export function buildSummary(changes: DiffChanges): string {
  const parts: string[] = [];
  const params = [...changes.params].sort((a, b) => {
    const na = Number(a.node_id);
    const nb = Number(b.node_id);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.field.localeCompare(b.field);
  });
  for (const p of params) parts.push(renderParam(p));
  for (const m of changes.models) parts.push(renderModel(m));
  if (changes.seed) parts.push(renderSeed(changes.seed));
  for (const w of changes.workflow) parts.push(renderWorkflow(w));
  for (const md of changes.metadata) parts.push(renderMetadata(md));

  if (parts.length === 0) return 'No changes.';
  const visible = parts.slice(0, MAX_CHANGES);
  const elided = parts.length - visible.length;
  let out = visible.join('. ');
  if (elided > 0) out += `. …and ${elided} more changes`;
  if (out.length > HARD_CAP) out = out.slice(0, HARD_CAP - 1) + '…';
  return out;
}
