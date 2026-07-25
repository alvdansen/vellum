/**
 * training-report — Modal fine-tuning stream. Render an organized training-run
 * report from Vellum provenance. The convention (see docs/modal-training-ingest.md):
 *   project = fine-tune effort, sequence = training run, shot = eval prompt,
 *   version = checkpoint sample (registered with provenance
 *   { base_model, dataset_rev, step, lr, loss }).
 *
 * Reads the DB directly and renders src/engine/training-report.ts. A script (not
 * an MCP tool) — training reports are an operator/curation view, off the 12-tool budget.
 *
 * Usage:
 *   npx tsx scripts/training-report.mts --db ./vellum.db --sequence <sequence id> [--out report.md]
 */
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { openDb } from '../src/store/db.js';
import { HierarchyRepo } from '../src/store/hierarchy-repo.js';
import { VersionRepo } from '../src/store/version-repo.js';
import { ProvenanceRepo } from '../src/store/provenance-repo.js';
import { versionLabel } from '../src/utils/outputs.js';
import {
  renderTrainingReport,
  type CheckpointSample,
  type EvalPrompt,
  type TrainingReportData,
} from '../src/engine/training-report.js';
import type { StoredOutput } from '../src/comfyui/types.js';

interface Args {
  db: string;
  sequence: string;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  let db = './vellum.db';
  let sequence: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') db = argv[++i] ?? db;
    else if (a === '--sequence') sequence = argv[++i];
    else if (a === '--out') out = argv[++i];
    else throw new Error(`Unknown/unexpected arg: ${a}`);
  }
  if (!sequence) throw new Error('Usage: training-report --db <path> --sequence <sequence id> [--out report.md]');
  return { db, sequence, out };
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { db } = openDb(args.db);
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenance = new ProvenanceRepo(db);

  const seq = hierarchy.getSequence(args.sequence);
  if (!seq) throw new Error(`Sequence '${args.sequence}' not found in ${args.db}`);
  const proj = hierarchy.getProject(seq.project_id);

  // Eval prompts = shots; checkpoint samples = their versions.
  const shots = hierarchy.listShots(seq.id, 1000, 0).items;
  const evalPrompts: EvalPrompt[] = shots.map((shot) => {
    const samples: CheckpointSample[] = versions.listAllForShot(shot.id).map((v) => {
      const completed = provenance.getLatestCompletedEvent(v.id);
      let bag: Record<string, unknown> = {};
      if (completed?.generation_result_json) {
        try {
          bag = JSON.parse(completed.generation_result_json) as Record<string, unknown>;
        } catch {
          bag = {};
        }
      }
      let outputs: string[] = [];
      if (v.outputs_json) {
        try {
          const parsed = JSON.parse(v.outputs_json) as StoredOutput[];
          if (Array.isArray(parsed)) outputs = parsed.map((o) => o?.filename).filter((f): f is string => !!f);
        } catch {
          outputs = [];
        }
      }
      return {
        versionLabel: versionLabel(v.version_number),
        provider: v.provider ?? null,
        createdAt: v.created_at,
        meta: {
          base_model: str(bag.base_model),
          dataset_rev: str(bag.dataset_rev),
          step: num(bag.step),
          lr: num(bag.lr),
          loss: num(bag.loss),
        },
        outputs,
      };
    });
    return { name: shot.name, samples };
  });

  const data: TrainingReportData = {
    effort: proj?.name ?? seq.project_id,
    run: seq.name,
    evalPrompts,
    generatedAt: Date.now(),
  };
  const markdown = renderTrainingReport(data);

  if (args.out) {
    await writeFile(path.resolve(args.out), markdown, 'utf8');
    const nSamples = evalPrompts.reduce((n, e) => n + e.samples.length, 0);
    console.log(`Wrote ${args.out} — ${evalPrompts.length} eval prompt(s), ${nSamples} checkpoint sample(s).`);
  } else {
    console.log(markdown);
  }
}

main().catch((err) => {
  console.error(`training-report: ${(err as Error).message}`);
  process.exit(1);
});
