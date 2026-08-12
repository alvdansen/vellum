import type {
  BreadcrumbEntry,
  Shot,
  ShotStatus,
  Version,
} from '../types/hierarchy.js';
import type {
  CostRecordedPayloadFields,
  ModelRef,
  ProvenanceEvent,
  SpecBoundPayloadFields,
} from '../types/provenance.js';
import type { ShotStatusEvent } from '../store/shot-status-repo.js';
import type { ProposalKind, ProposalStatus } from '../store/proposal-repo.js';
import type { StoredOutput } from '../comfyui/types.js';
import { versionLabel } from '../utils/outputs.js';

/**
 * Per-shot pipeline-log markdown generator.
 *
 * Production teams hand-maintain a per-shot pipeline log (state, take counts,
 * provider media UUIDs, lineage chains, per-call cost incl. rejected takes) and
 * periodically RECONCILE it against filesystem truth. This module turns Vellum's
 * append-only provenance into that same document automatically — the markdown is
 * a projection of provenance, never a second source of truth.
 *
 * PURE: this module does zero I/O and holds zero DB/MCP dependency. The engine
 * facade (pipeline.ts) gathers the rows and calls `renderShotPipelineLog`. That
 * keeps the renderer exhaustively unit-testable against hand-built fixtures and
 * keeps the append-only invariant intact — reading provenance never mutates it.
 */

/** One take (version) plus the provenance + cost context needed to render it. */
export interface PipelineLogTake {
  /** The version row (the take). */
  version: Version;
  /** Chronological provenance events for this version (oldest first). */
  events: ProvenanceEvent[];
  /**
   * Cost estimate recorded on the approval-gate proposal that produced this
   * take, when one exists (log every call + cost). Null for takes
   * generated outside the gate or with no estimate. Cost ACTUALS are a separate
   * deferred stream — this surfaces the human-reviewed ESTIMATE, labelled as such.
   */
  costEstimate: string | null;
  /** Kind of the linked proposal (submit/reproduce/iterate), or null. */
  proposalKind: ProposalKind | null;
  /** Status of the linked proposal (proposed/approved/rejected), or null. */
  proposalStatus: ProposalStatus | null;
  /**
   * The latest recorded ACTUAL cost for this take (append-only 'cost_recorded'
   * event), or null. Distinct from the proposal's pre-spend estimate.
   */
  costActual: CostRecordedPayloadFields | null;
}

/** Render a recorded actual cost as `0.04 USD`. Currency is inline-sanitized
 *  (it is caller-supplied and could carry a newline / injection attempt). The
 *  amount is guarded: a malformed persisted payload could carry a non-numeric
 *  value, and the renderer must never throw on stored data. */
function formatCost(cost: CostRecordedPayloadFields): string {
  const amount =
    typeof cost.amount === 'number' && Number.isFinite(cost.amount)
      ? String(Number(cost.amount.toFixed(6))) // drops float noise (0.1+0.2)
      : inline(String(cost.amount));
  return `${amount} ${inline(cost.currency)}`;
}

/**
 * A gate proposal that produced NO take (version_id is null): a pending
 * proposal, a rejected proposal, or an approved proposal whose execution failed
 * after the provider was hit. The requirement is to log every call + cost
 * incl. rejected takes — these calls would otherwise vanish from the log
 * because the takes projection is built only from persisted versions.
 */
export interface GateProposalEntry {
  kind: ProposalKind;
  status: ProposalStatus;
  provider: string | null;
  costEstimate: string | null;
  createdAt: number;
  decidedAt: number | null;
  decidedNote: string | null;
  /** Set when an approved proposal's execution threw (real spend, no take). */
  executionError: string | null;
}

/** Self-contained input for the pure renderer — no DB handle required. */
export interface ShotPipelineLogData {
  /** workspace → project → sequence → shot breadcrumb (in that order). */
  breadcrumb: BreadcrumbEntry[];
  shot: Shot;
  /** Current materialized status. */
  status: ShotStatus;
  /** Timestamp of the last status change, or null when never transitioned. */
  lastChangedAt: number | null;
  /** Status transition events. Any order — the renderer sorts oldest-first. */
  statusHistory: ShotStatusEvent[];
  /** Takes ordered oldest-first (version_number ASC). */
  takes: PipelineLogTake[];
  /**
   * Gate proposals that produced no take (rejected / pending / approved-but-
   * failed). Rendered in their own section so no gated call — spent or not —
   * disappears from the log. Empty for shots with no such proposals.
   */
  gateProposals: GateProposalEntry[];
  /** True when the status history was capped by the gather read (disclosed). */
  statusHistoryTruncated: boolean;
  /** True when the proposal list was capped by the gather read (disclosed). */
  proposalsTruncated: boolean;
  /** Wall-clock stamp for the "Generated" line (epoch ms). */
  generatedAt: number;
}

/** Format an epoch-ms timestamp as a stable UTC string: `2026-07-21 09:00 UTC`. */
export function formatUtc(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/** Escape the pipe + newline chars that would break a markdown table cell. */
function cell(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  return String(value).replace(/\|/g, '\\|').replace(/[\r\n\u2028\u2029]/g, ' ');
}

/**
 * Sanitize a value for inline prose / heading interpolation. Provider- and
 * agent-controlled strings (breadcrumb names, model names, provider ids,
 * cost estimates) reach the log verbatim from provenance — a raw newline would
 * let them inject their own markdown headings/lines into a document whose whole
 * contract is to be a FAITHFUL projection. Collapse newlines to spaces.
 */
function inline(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  return (
    String(value)
      .replace(/[\r\n\u2028\u2029]/g, ' ')
      // Bidirectional controls too. They inject no markdown, but they reorder
      // how the rest of the LINE renders, so a hostile note or filename can
      // make the log read as something other than what provenance recorded —
      // and this document's whole contract is to be a faithful projection.
      // Rows predating the name-level rejection can still carry them.
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .trim() || '—'
  );
}

/**
 * Render a value as a safe inline code span. Strips backticks and newlines so a
 * provider-controlled job id / filename (e.g. FAL's verbatim request_id, or a
 * caller-supplied externalJobRef) cannot break out of the span or inject
 * markdown. Backslash escapes do NOT work inside code spans (CommonMark), so
 * stripping — not escaping — is the only correct defense. Empty ⇒ em dash.
 */
function codeSpan(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const s = String(value).replace(/[`\r\n]/g, ' ').trim();
  return s ? '`' + s + '`' : '—';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Defensive JSON.parse → array of plain objects. Tolerant of every malformed-
 * but-persisted shape: parse errors, non-arrays, AND arrays that contain
 * null/primitive elements (e.g. `'[null]'` is valid JSON but its elements have
 * no fields). Non-object elements are dropped so downstream field access never
 * throws — the renderer's contract is to never crash on stored data.
 */
function parseObjectArray<T>(json: string | null | undefined): T[] {
  if (json == null || json.length === 0) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed.filter(isPlainObject) as unknown as T[]) : [];
  } catch {
    return [];
  }
}

/** The completed event carries the resolved outputs; fall back to the version row. */
function outputsForTake(take: PipelineLogTake): StoredOutput[] {
  const completed = [...take.events].reverse().find((e) => e.event_type === 'completed');
  const fromEvent = parseObjectArray<StoredOutput>(completed?.outputs_json ?? null);
  if (fromEvent.length > 0) return fromEvent;
  return parseObjectArray<StoredOutput>(take.version.outputs_json);
}

/** Human bytes: 1.2 MB / 954 KB / 12 B. */
function humanBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** Render the lineage cell/line: `iterate ← v001` / `reproduce ← v003` / `—`. */
function lineageText(take: PipelineLogTake, parentLabelById: Map<string, string>): string {
  const { lineage_type, parent_version_id } = take.version;
  if (!lineage_type) return '—';
  const parentLabel = parent_version_id
    ? parentLabelById.get(parent_version_id) ?? parent_version_id
    : '?';
  return `${lineage_type} ← ${parentLabel}`;
}

/** Latest failed event's error, if the take is a failed take. */
function failureText(take: PipelineLogTake): string | null {
  if (take.version.status !== 'failed') return null;
  const failed = [...take.events].reverse().find((e) => e.event_type === 'failed');
  const code = failed?.error_code ?? take.version.error_code;
  const msg = failed?.error_message ?? take.version.error_message;
  if (!code && !msg) return null;
  return [code, msg].filter(Boolean).join(' — ');
}

function seedForTake(take: PipelineLogTake): number | null {
  const completed = [...take.events].reverse().find((e) => e.event_type === 'completed');
  return completed?.seed ?? null;
}

function modelsForTake(take: PipelineLogTake): ModelRef[] {
  // Prefer the fingerprinted sibling event; fall back to the completed event.
  const fp = [...take.events].reverse().find((e) => e.event_type === 'models_fingerprinted');
  const completed = [...take.events].reverse().find((e) => e.event_type === 'completed');
  const fromFp = parseObjectArray<ModelRef>(fp?.models_json ?? null);
  if (fromFp.length > 0) return fromFp;
  return parseObjectArray<ModelRef>(completed?.models_json ?? null);
}

/** Compact neutral-provenance block (non-ComfyUI backends), pretty + capped. */
function neutralProvenanceText(take: PipelineLogTake): string | null {
  const completed = [...take.events].reverse().find((e) => e.event_type === 'completed');
  const raw = completed?.generation_result_json ?? null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Only render a structured (object/array) blob — a bare primitive or null
    // is not meaningful provenance and would print a lone "null"/"42".
    if (parsed === null || typeof parsed !== 'object') return null;
    const pretty = JSON.stringify(parsed, null, 2);
    // Keep the log readable — cap the embedded blob.
    const CAP = 1200;
    return pretty.length > CAP ? `${pretty.slice(0, CAP)}\n… (truncated)` : pretty;
  } catch {
    return null;
  }
}

/** Provider job reference (the provider media UUID teams otherwise track by hand). */
function providerJobRef(take: PipelineLogTake): string | null {
  return take.version.job_id ?? null;
}

/**
 * The project spec revision this take was created under, read off its
 * append-only 'spec_bound' event. OLDEST valid event wins — a take binds once,
 * and a duplicate must never be able to re-date it to a later revision (repo
 * parity: ProvenanceRepo.getSpecBound). Renderer-safe: malformed stored payloads
 * are skipped rather than thrown on.
 */
function specForTake(take: PipelineLogTake): SpecBoundPayloadFields | null {
  for (const e of take.events) {
    if (e.event_type !== 'spec_bound' || !e.spec_bound_json) continue;
    try {
      const parsed = JSON.parse(e.spec_bound_json) as SpecBoundPayloadFields;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        typeof parsed.revision === 'number' &&
        typeof parsed.content_hash === 'string'
      ) {
        return parsed;
      }
    } catch {
      // Stored data — never throw while rendering a log.
    }
  }
  return null;
}

/**
 * Render a full per-shot pipeline log as markdown. Deterministic given the same
 * input (timestamps come from `generatedAt` and the row data, never the clock).
 */
export function renderShotPipelineLog(data: ShotPipelineLogData): string {
  const {
    breadcrumb,
    shot,
    status,
    lastChangedAt,
    statusHistory,
    takes,
    gateProposals,
    statusHistoryTruncated,
    proposalsTruncated,
    generatedAt,
  } = data;
  const lines: string[] = [];

  const pathText = breadcrumb.length > 0
    ? breadcrumb.map((b) => inline(b.name)).join(' › ')
    : inline(shot.name);

  // ---- Header -----------------------------------------------------------
  const seqShot = breadcrumb.length >= 2
    ? breadcrumb.slice(1).map((b) => inline(b.name)).join(' / ')
    : inline(shot.name);
  lines.push(`# Pipeline Log — ${seqShot}`);
  lines.push('');
  lines.push(`- **Shot:** ${inline(shot.name)}`);
  lines.push(`- **Path:** ${pathText}`);
  const lastChanged = lastChangedAt ? ` _(last changed ${formatUtc(lastChangedAt)})_` : '';
  lines.push(`- **Status:** ${status}${lastChanged}`);

  // What was approved, and whether it is still the newest thing here. An
  // approval with no pointer is reported as such rather than left to look
  // like an approval of whatever happens to be latest.
  if (status === 'approved') {
    const approvedId = shot.approved_version_id ?? null;
    const approvedTake = approvedId ? takes.find((t) => t.version.id === approvedId) : undefined;
    if (!approvedId) {
      lines.push('- **Approved take:** _not recorded_ — this approval predates version pointers, or none was given');
    } else if (approvedTake) {
      const label = versionLabel(approvedTake.version.version_number);
      const newer = takes.filter(
        (t) => t.version.version_number > approvedTake.version.version_number,
      ).length;
      lines.push(
        newer > 0
          ? `- **Approved take:** ${label} — ⚠️ ${newer} newer take${newer === 1 ? '' : 's'} since, not covered by this approval`
          : `- **Approved take:** ${label} _(latest)_`,
      );
    } else {
      lines.push(`- **Approved take:** ${codeSpan(approvedId)} _(not among the takes listed here)_`);
    }
  }

  // Take counts by status.
  const counts: Record<string, number> = {};
  for (const t of takes) counts[t.version.status] = (counts[t.version.status] ?? 0) + 1;
  const countParts = Object.keys(counts)
    .sort()
    .map((k) => `${counts[k]} ${k}`);
  const takeSummary = takes.length === 0
    ? '0 total'
    : `${takes.length} total — ${countParts.join(', ')}`;
  lines.push(`- **Takes:** ${takeSummary}`);

  // Recorded actual spend, summed per currency (takes with a cost_recorded event).
  const spendByCurrency = new Map<string, number>();
  for (const t of takes) {
    // Only sum well-formed numeric amounts — a malformed persisted payload must
    // not turn the total into NaN or a string concatenation.
    if (t.costActual && typeof t.costActual.amount === 'number' && Number.isFinite(t.costActual.amount)) {
      spendByCurrency.set(
        t.costActual.currency,
        (spendByCurrency.get(t.costActual.currency) ?? 0) + t.costActual.amount,
      );
    }
  }
  if (spendByCurrency.size > 0) {
    const totals = [...spendByCurrency.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cur, amt]) => `${Number(amt.toFixed(6))} ${inline(cur)}`)
      .join(', ');
    lines.push(`- **Recorded spend:** ${totals}`);
  }

  lines.push(`- **Generated:** ${formatUtc(generatedAt)} · from Vellum provenance (append-only)`);
  lines.push('');
  lines.push(
    '> This log is generated from Vellum\'s append-only provenance. It is a projection, ' +
      'not a source of truth — regenerate it rather than editing by hand.',
  );
  lines.push('');

  // ---- Status history ---------------------------------------------------
  lines.push('## Status history');
  lines.push('');
  if (statusHistory.length === 0) {
    lines.push('_No status changes recorded._');
  } else {
    // Oldest-first, correct for same-millisecond transitions.
    //
    // Reverse first: getStatusHistory returns (created_at DESC, rowid DESC),
    // so reversing yields true write order for rows sharing a millisecond —
    // which a scripted or agent-driven review round produces routinely.
    // Then sort ascending by created_at; Array.prototype.sort is stable, so
    // it repairs any out-of-order distinct stamps without disturbing the tie
    // order the reverse just established.
    //
    // Do NOT tiebreak on `id`: it is a nanoid, so an id tiebreak is
    // deterministic but causally wrong, and renders a chain that never
    // happened (approval before the rejection that preceded it).
    const ordered = [...statusHistory].reverse().sort((a, b) => a.created_at - b.created_at);
    lines.push('| When (UTC) | Transition | By | Note |');
    lines.push('|---|---|---|---|');
    for (const ev of ordered) {
      const transition = `${ev.from_status ?? '(initial)'} → ${ev.to_status}`;
      lines.push(
        `| ${cell(formatUtc(ev.created_at))} | ${cell(transition)} | ${cell(ev.changed_by)} | ${cell(ev.note)} |`,
      );
    }
    if (statusHistoryTruncated) {
      lines.push('');
      lines.push(`_⚠ Older status changes were truncated — showing the most recent ${statusHistory.length}._`);
    }
  }
  lines.push('');

  // Parent-label map so lineage cells read `iterate ← v001`, not a raw id.
  const parentLabelById = new Map<string, string>();
  for (const t of takes) parentLabelById.set(t.version.id, versionLabel(t.version.version_number));

  // ---- Takes table ------------------------------------------------------
  lines.push('## Takes');
  lines.push('');
  if (takes.length === 0) {
    lines.push('_No takes recorded yet._');
    lines.push('');
  } else {
    lines.push('| Take | Status | Provider | Lineage | Created (UTC) | Completed (UTC) | Cost | Outputs |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const t of takes) {
      const v = t.version;
      const label = versionLabel(v.version_number);
      const outs = outputsForTake(t);
      const outCell = outs.length === 0 ? '—' : `${outs.length} file${outs.length === 1 ? '' : 's'}`;
      // Cost column prefers the recorded ACTUAL; falls back to the estimate (marked).
      const costCell = t.costActual
        ? formatCost(t.costActual)
        : t.costEstimate
          ? `${t.costEstimate} (est)`
          : null;
      lines.push(
        `| ${cell(label)} | ${cell(v.status)} | ${cell(v.provider ?? null)} | ${cell(lineageText(t, parentLabelById))} ` +
          `| ${cell(formatUtc(v.created_at))} | ${cell(v.completed_at ? formatUtc(v.completed_at) : '—')} ` +
          `| ${cell(costCell)} | ${outCell} |`,
      );
    }
    lines.push('');
  }

  // ---- Per-take detail --------------------------------------------------
  if (takes.length > 0) lines.push('## Take detail');
  if (takes.length > 0) lines.push('');
  for (const t of takes) {
    const v = t.version;
    const label = versionLabel(v.version_number);
    lines.push(`### ${label} — ${v.status}${v.provider ? ` (${v.provider})` : ''}`);
    lines.push('');

    const jobRef = providerJobRef(t);
    if (jobRef) lines.push(`- **Provider job / media ref:** ${codeSpan(jobRef)}`);

    const lineage = lineageText(t, parentLabelById);
    if (lineage !== '—') lines.push(`- **Lineage:** ${lineage}`);

    const seed = seedForTake(t);
    if (seed != null) lines.push(`- **Seed:** ${seed}`);

    // Which spec revision this take was made under. Absent when the project had
    // no spec — the log says nothing rather than implying one.
    const spec = specForTake(t);
    if (spec) {
      lines.push(
        `- **Spec:** revision ${spec.revision} (${codeSpan(spec.content_hash.slice(0, 12))})`,
      );
    }

    const models = modelsForTake(t);
    if (models.length > 0) {
      const modelText = models
        .map((m) => `${cell(m.model_name)} (${cell(m.class_type)})`)
        .join(', ');
      lines.push(`- **Models:** ${modelText}`);
    }

    if (t.costActual) {
      const parts = [`**Cost (actual):** ${inline(formatCost(t.costActual))}`];
      if (t.costEstimate) parts.push(`est ${inline(t.costEstimate)}`);
      if (t.costActual.note) parts.push(inline(t.costActual.note));
      lines.push(`- ${parts.join(' · ')}`);
    } else if (t.costEstimate || t.proposalKind || t.proposalStatus) {
      const bits: string[] = [];
      if (t.costEstimate) bits.push(inline(t.costEstimate));
      const meta = [t.proposalKind, t.proposalStatus].filter(Boolean).join(', ');
      if (meta) bits.push(`proposal: ${meta}`);
      lines.push(`- **Cost (est.):** ${bits.join(' · ') || '—'}`);
    }

    if (v.notes) lines.push(`- **Notes:** ${cell(v.notes)}`);

    const failure = failureText(t);
    if (failure) lines.push(`- **Error:** ${cell(failure)}`);

    const outs = outputsForTake(t);
    if (outs.length > 0) {
      lines.push('- **Outputs:**');
      for (const o of outs) {
        const contentType = o.content_type ? inline(o.content_type) : '—';
        const parts = [humanBytes(o.size_bytes), contentType].filter((p) => p && p !== '—');
        const meta = parts.length > 0 ? ` — ${parts.join(' — ')}` : '';
        lines.push(`  - ${codeSpan(o.filename)}${meta}`);
      }
    }

    const neutral = neutralProvenanceText(t);
    if (neutral) {
      lines.push('- **Neutral provenance:**');
      lines.push('');
      lines.push('  ```json');
      for (const nl of neutral.split('\n')) lines.push(`  ${nl}`);
      lines.push('  ```');
    }

    lines.push('');
  }

  // ---- Gate proposals with no take (rejected / pending / approved-but-failed) --
  // Requirement: log every call + cost incl. rejected takes. A gated
  // call that never produced a version would otherwise vanish from the log.
  if (gateProposals.length > 0) {
    lines.push('## Gate proposals (no take produced)');
    lines.push('');
    lines.push('Rejected, pending, or approved-but-failed generation proposals — recorded for cost/spend accounting even though they produced no version.');
    lines.push('');
    lines.push('| Proposed (UTC) | Kind | Status | Provider | Cost (est.) | Decided (UTC) | Note / error |');
    lines.push('|---|---|---|---|---|---|---|');
    const ordered = [...gateProposals].sort((a, b) => a.createdAt - b.createdAt);
    for (const p of ordered) {
      // An approved proposal with an execution_error spent real credits but
      // produced no take — surface the error; otherwise show the decision note.
      const statusText = p.status === 'approved' && p.executionError ? 'approved (failed)' : p.status;
      const noteText = p.executionError ? `error: ${p.executionError}` : p.decidedNote;
      lines.push(
        `| ${cell(formatUtc(p.createdAt))} | ${cell(p.kind)} | ${cell(statusText)} | ${cell(p.provider)} ` +
          `| ${cell(p.costEstimate)} | ${cell(p.decidedAt ? formatUtc(p.decidedAt) : '—')} | ${cell(noteText)} |`,
      );
    }
    if (proposalsTruncated) {
      lines.push('');
      lines.push('_⚠ Older proposals were truncated — some gated calls may not be shown._');
    }
    lines.push('');
  } else if (proposalsTruncated) {
    // Even with no unlinked proposals to show, disclose that the proposal read
    // was capped so a truncated cost column on a take is not read as complete.
    lines.push('_⚠ The proposal history was truncated; some take costs may be missing._');
    lines.push('');
  }

  return lines.join('\n');
}
