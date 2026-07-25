/**
 * Fine-tuning training-run report (Modal stream). A training loop on Modal
 * pushes checkpoint samples into Vellum via the ingest surface. The
 * mapping convention is:
 *   project  = a fine-tune effort
 *   sequence = a training run
 *   shot     = an eval prompt
 *   version  = a checkpoint sample (registered output), whose neutral provenance
 *              carries { base_model, dataset_rev, step, lr, loss }.
 *
 * This PURE module turns that structure into an organized markdown report: the
 * run's base model / dataset / best loss, and per eval-prompt a table of
 * checkpoints ordered by step. Zero IO/DB — the gather (a script or facade)
 * feeds it structured data.
 */

/** Training metadata pulled from a checkpoint sample's neutral provenance bag. */
export interface CheckpointMeta {
  base_model?: string;
  dataset_rev?: string;
  step?: number;
  lr?: number;
  loss?: number;
}

/** One checkpoint sample (a registered version) for an eval prompt. */
export interface CheckpointSample {
  versionLabel: string;
  provider?: string | null;
  createdAt: number;
  /** Parsed from the completed event's generation_result_json bag. */
  meta: CheckpointMeta;
  /** Output filenames persisted for this sample. */
  outputs: string[];
}

/** One eval prompt (a shot) and its checkpoint samples. */
export interface EvalPrompt {
  name: string;
  samples: CheckpointSample[];
}

export interface TrainingReportData {
  /** project = fine-tune effort. */
  effort: string;
  /** sequence = training run. */
  run: string;
  evalPrompts: EvalPrompt[];
  generatedAt: number;
}

function fmtUtc(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** Sanitize a value for a markdown table cell (pipe + newline). */
function cell(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—';
  return String(v).replace(/\|/g, '\\|').replace(/[\r\n\u2028\u2029]/g, ' ');
}

function numOrDash(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? String(Number(n.toFixed(6))) : '—';
}

/** All checkpoint metas across the run (for run-level summary). */
function allSamples(data: TrainingReportData): CheckpointSample[] {
  return data.evalPrompts.flatMap((e) => e.samples);
}

/** Render a training run as an organized markdown report. Deterministic. */
export function renderTrainingReport(data: TrainingReportData): string {
  const lines: string[] = [];
  const samples = allSamples(data);

  // Run-level summary — the base model / dataset are shared across the run; take
  // the most common (mode) so a stray sample can't mislabel the header.
  const modeOf = (vals: Array<string | undefined>): string | null => {
    const counts = new Map<string, number>();
    for (const v of vals) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best: string | null = null;
    let bestN = 0;
    for (const [v, n] of counts) if (n > bestN) ((best = v), (bestN = n));
    return best;
  };
  const baseModel = modeOf(samples.map((s) => s.meta.base_model));
  const datasetRev = modeOf(samples.map((s) => s.meta.dataset_rev));
  const losses = samples.map((s) => s.meta.loss).filter((l): l is number => typeof l === 'number' && Number.isFinite(l));
  const bestLoss = losses.length > 0 ? Math.min(...losses) : null;
  const steps = samples.map((s) => s.meta.step).filter((s): s is number => typeof s === 'number' && Number.isFinite(s));
  const maxStep = steps.length > 0 ? Math.max(...steps) : null;

  lines.push(`# Training Report — ${cell(data.effort)} / ${cell(data.run)}`);
  lines.push('');
  lines.push(`- **Effort (project):** ${cell(data.effort)}`);
  lines.push(`- **Run (sequence):** ${cell(data.run)}`);
  lines.push(`- **Base model:** ${cell(baseModel)}`);
  lines.push(`- **Dataset rev:** ${cell(datasetRev)}`);
  lines.push(`- **Eval prompts:** ${data.evalPrompts.length}  ·  **Checkpoint samples:** ${samples.length}`);
  lines.push(`- **Max step:** ${cell(maxStep)}  ·  **Best loss:** ${cell(bestLoss != null ? numOrDash(bestLoss) : null)}`);
  lines.push(`- **Generated:** ${fmtUtc(data.generatedAt)} · from Vellum provenance (append-only)`);
  lines.push('');
  lines.push(
    '> Checkpoint samples pushed from Modal via the ingest surface. This report is a projection of provenance — regenerate it as training progresses.',
  );
  lines.push('');

  if (data.evalPrompts.length === 0) {
    lines.push('_No eval prompts recorded for this run yet._');
    lines.push('');
    return lines.join('\n');
  }

  for (const evalPrompt of data.evalPrompts) {
    lines.push(`## ${cell(evalPrompt.name)}`);
    lines.push('');
    if (evalPrompt.samples.length === 0) {
      lines.push('_No checkpoint samples yet._');
      lines.push('');
      continue;
    }
    // Order by training step (nulls last), then by creation time.
    const ordered = [...evalPrompt.samples].sort((a, b) => {
      const sa = a.meta.step ?? Number.POSITIVE_INFINITY;
      const sb = b.meta.step ?? Number.POSITIVE_INFINITY;
      if (sa !== sb) return sa - sb;
      return a.createdAt - b.createdAt;
    });
    lines.push('| Checkpoint | Step | Loss | LR | Provider | Created (UTC) | Outputs |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const s of ordered) {
      const outCell = s.outputs.length === 0 ? '—' : `${s.outputs.length} file${s.outputs.length === 1 ? '' : 's'}`;
      lines.push(
        `| ${cell(s.versionLabel)} | ${cell(numOrDash(s.meta.step))} | ${cell(numOrDash(s.meta.loss))} ` +
          `| ${cell(numOrDash(s.meta.lr))} | ${cell(s.provider ?? null)} | ${cell(fmtUtc(s.createdAt))} | ${outCell} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
