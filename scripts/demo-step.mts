#!/usr/bin/env npx tsx
/**
 * VFX Familiar — stage-by-stage demo runner.
 *
 * Each stage is invoked as a separate process. State (workspace ids, version
 * ids) persists in .demo-state.json so the orchestrator can drive one stage
 * at a time and the human can read the dashboard reaction in between.
 *
 * Usage:
 *   npx tsx scripts/demo-step.mts <stage>
 *
 * Stages:
 *   1  hierarchy    — create workspace → project → sequence → shot
 *   2  submit       — submit a generation (Nano Banana Pro)
 *   3  watch        — poll status until terminal
 *   4  provenance   — version.provenance dump
 *   5  reproduce    — generation.reproduce + watch
 *   6  diff         — version.diff between original and reproduction
 *   reset           — clear state, drop into a fresh demo
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

const MCP_ENDPOINT = new URL(process.env.MCP_URL ?? 'http://localhost:3030/mcp');
const STATE_FILE = '.demo-state.json';

interface DemoState {
  stamp: string;
  workspaceId?: string;
  projectId?: string;
  sequenceId?: string;
  shotId?: string;
  versionId?: string;
  reproVersionId?: string;
  iterVersionId?: string;
}

interface ToolResponse {
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  teal: '\x1b[38;5;30m', cream: '\x1b[38;5;230m', coral: '\x1b[38;5;209m',
  ok: '\x1b[38;5;42m', err: '\x1b[38;5;203m',
};

const stageArg = process.argv[2];
if (!stageArg) die('usage: demo-step.mts <1|2|3|4|5|6|reset>');

if (stageArg === 'reset') {
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  console.log(`${C.ok}✓ state cleared${C.reset}`);
  process.exit(0);
}

const stage = Number.parseInt(stageArg, 10);
if (![1, 2, 3, 4, 5, 6, 7].includes(stage)) die(`unknown stage: ${stageArg}`);

main(stage).catch((err) => {
  console.error(`${C.err}stage ${stage} failed:${C.reset}`, err.message ?? err);
  process.exit(1);
});

async function main(s: number): Promise<void> {
  const transport = new StreamableHTTPClientTransport(MCP_ENDPOINT);
  const client = new Client({ name: 'vfx-familiar-demo-step', version: '1.0.0' });
  await client.connect(transport);

  const state = loadState();
  if (s === 1) await stage1(client, state);
  else if (s === 2) await stage2(client, state);
  else if (s === 3) await stage3(client, state);
  else if (s === 4) await stage4(client, state);
  else if (s === 5) await stage5(client, state);
  else if (s === 6) await stage6(client, state);
  else if (s === 7) await stage7(client, state);

  await transport.close();
}

async function stage1(client: Client, state: DemoState): Promise<void> {
  banner(1, 'Create hierarchy');
  if (!state.stamp) state.stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);

  const ws = await call(client, 'workspace', { action: 'create', name: `demo-${state.stamp}` });
  echoEntity('workspace', ws); state.workspaceId = entityId(ws);

  const proj = await call(client, 'project', { action: 'create', workspaceId: state.workspaceId, name: 'showcase' });
  echoEntity('project', proj); state.projectId = entityId(proj);

  const seq = await call(client, 'sequence', { action: 'create', projectId: state.projectId, name: 'sq010' });
  echoEntity('sequence', seq); state.sequenceId = entityId(seq);

  const shot = await call(client, 'shot', { action: 'create', sequenceId: state.sequenceId, name: 'sh010' });
  echoEntity('shot', shot); state.shotId = entityId(shot);

  saveState(state);
  hint(`Refresh http://localhost:3030 — left rail shows demo-${state.stamp} → showcase → sq010 → sh010`);
}

async function stage2(client: Client, state: DemoState): Promise<void> {
  banner(2, 'Submit generation');
  if (!state.shotId) die('run stage 1 first');

  const wf = nanoBananaProWorkflow(
    'A geometric polygonal stag standing on a midnight teal field, sacred geometry, Bauhaus poster, soft cream highlights, single warm coral accent. 16:9.',
    777,
  );

  const sub = await call(client, 'generation', {
    action: 'submit',
    shot_id: state.shotId,
    workflow_json: wf,
    notes: 'demo stage 2 — first version',
  });
  echoSubmit(sub); state.versionId = entityId(sub);

  saveState(state);
  hint(`Active Generations panel on the dashboard now shows v001 — status will move submitted → running → completed.`);
}

async function stage3(client: Client, state: DemoState): Promise<void> {
  banner(3, 'Watch live status');
  if (!state.versionId) die('run stage 2 first');

  const status = await pollUntilTerminal(client, state.versionId);
  echoStatus(status);
  if (status !== 'completed') die(`generation did not complete: ${status}`);
  hint(`Click the v001 version card in the timeline to drill into provenance.`);
}

async function stage4(client: Client, state: DemoState): Promise<void> {
  banner(4, 'Inspect provenance');
  if (!state.versionId) die('run stage 2 first');

  const prov = await call(client, 'version', { action: 'provenance', version_id: state.versionId });
  echoProvenance(prov);
  hint(`Same data is in the dashboard's version drawer. Provenance is immutable — there is no API to mutate it.`);
}

async function stage5(client: Client, state: DemoState): Promise<void> {
  banner(5, 'Reproduce');
  if (!state.versionId) die('run stage 2 first');

  const repro = await call(client, 'generation', {
    action: 'reproduce',
    version_id: state.versionId,
    notes: 'demo stage 5 — verbatim reproduction',
  });
  echoSubmit(repro); state.reproVersionId = entityId(repro);
  saveState(state);

  const status = await pollUntilTerminal(client, state.reproVersionId);
  echoStatus(status);
  hint(`v002 now appears in the timeline next to v001 with lineage_type='reproduce'.`);
}

async function stage7(client: Client, state: DemoState): Promise<void> {
  banner(7, 'Iterate with overrides');
  if (!state.versionId) die('run stage 2 first');

  // Iterate from v3 with a node-scoped override on the prompt + new seed.
  // Engine merges overrides into the captured prompt_json and submits as a
  // new version with lineage_type='iterate' + parent_version_id=v3.
  const it = await call(client, 'generation', {
    action: 'iterate',
    version_id: state.versionId,
    overrides: {
      '1': {
        inputs: {
          prompt:
            'A geometric polygonal owl perched on a midnight teal field, sacred geometry, Bauhaus poster, soft cream highlights, single warm coral accent. 16:9.',
          seed: 1234,
        },
      },
    },
    notes: 'demo stage 7 — owl iteration',
  });
  echoSubmit(it);
  const iterVersionId = entityId(it);
  (state as DemoState & { iterVersionId?: string }).iterVersionId = iterVersionId;
  saveState(state);

  const status = await pollUntilTerminal(client, iterVersionId);
  echoStatus(status);
  hint(
    `v005 should show an OWL alongside v003's stag, with lineage_type='iterate' and a real diff vs v003.`,
  );
}

async function stage6(client: Client, state: DemoState): Promise<void> {
  banner(6, 'Diff');
  if (!state.versionId || !state.reproVersionId) die('run stages 2 and 5 first');

  const diff = await call(client, 'version', {
    action: 'diff',
    version_a: state.versionId,
    version_b: state.reproVersionId,
  });
  echoDiff(diff);
  hint(`Verbatim reproduction → empty changes set. (To see real changes, use generation.iterate with overrides.)`);
}

// ── helpers ────────────────────────────────────────────────────────────

function banner(n: number, t: string): void {
  console.log(`\n${C.coral}${C.bold}── stage ${n}: ${t} ──${C.reset}\n`);
}

function hint(s: string): void {
  console.log(`\n${C.teal}${s}${C.reset}\n`);
}

function loadState(): DemoState {
  if (!existsSync(STATE_FILE)) return { stamp: '' };
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
}

function saveState(s: DemoState): void {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResponse> {
  const res = (await client.callTool({ name, arguments: args })) as ToolResponse;
  if (res.isError) {
    const text = res.content?.[0]?.text ?? JSON.stringify(res.structuredContent);
    throw new Error(`${name} → ${text}`);
  }
  return res;
}

function entityId(res: ToolResponse): string {
  const sc = res.structuredContent as { entity?: { id?: string } } | undefined;
  const id = sc?.entity?.id;
  if (!id) throw new Error(`no entity id: ${JSON.stringify(res.structuredContent)}`);
  return id;
}

function echoEntity(label: string, res: ToolResponse): void {
  const sc = res.structuredContent as
    | { entity?: { id?: string }; breadcrumb_text?: string }
    | undefined;
  console.log(`  ${C.ok}✓${C.reset} ${C.bold}${label.padEnd(10)}${C.reset} ${C.dim}${sc?.entity?.id ?? '?'}${C.reset}  ${C.cream}${sc?.breadcrumb_text ?? ''}${C.reset}`);
}

function echoSubmit(res: ToolResponse): void {
  const sc = res.structuredContent as
    | { entity?: { id?: string; version_number?: number; status?: string } }
    | undefined;
  console.log(`  ${C.ok}✓${C.reset} ${C.bold}submitted ${C.reset} ${C.dim}${sc?.entity?.id ?? '?'}${C.reset}  v${sc?.entity?.version_number ?? '?'}  ${C.coral}${sc?.entity?.status ?? '?'}${C.reset}`);
}

function echoStatus(s: string): void {
  const c = s === 'completed' ? C.ok : s === 'failed' ? C.err : C.coral;
  console.log(`  ${c}● ${s}${C.reset}`);
}

function echoProvenance(res: ToolResponse): void {
  const sc = res.structuredContent as
    | { provenance?: { seed?: number; models?: Array<{ name?: string }>; submitted_at?: string; completed_at?: string } }
    | undefined;
  const p = sc?.provenance;
  if (!p) return;
  console.log(`    ${C.dim}seed:${C.reset}        ${C.cream}${p.seed ?? '(null)'}${C.reset}`);
  console.log(`    ${C.dim}models:${C.reset}      ${C.cream}${(p.models ?? []).map((m) => m.name ?? '?').join(', ') || '(none)'}${C.reset}`);
  console.log(`    ${C.dim}submitted:${C.reset}   ${C.cream}${p.submitted_at ?? '(none)'}${C.reset}`);
  console.log(`    ${C.dim}completed:${C.reset}   ${C.cream}${p.completed_at ?? '(none)'}${C.reset}`);
}

function echoDiff(res: ToolResponse): void {
  const sc = res.structuredContent as { diff?: { summary?: string; changes?: Record<string, unknown> } } | undefined;
  const d = sc?.diff;
  if (!d) return;
  console.log(`    ${C.dim}summary:${C.reset}     ${C.cream}${d.summary ?? '(empty)'}${C.reset}`);
  const keys = Object.keys(d.changes ?? {});
  console.log(`    ${C.dim}changes:${C.reset}     ${C.cream}${keys.length ? keys.join(', ') : '(none — verbatim reproduction)'}${C.reset}`);
}

async function pollUntilTerminal(client: Client, versionId: string): Promise<string> {
  const TERMINAL = new Set(['completed', 'failed']);
  let ticks = 0;
  while (true) {
    const res = await call(client, 'generation', { action: 'status', version_id: versionId });
    const sc = res.structuredContent as { entity?: { status?: string } } | undefined;
    const status = sc?.entity?.status ?? 'unknown';
    process.stdout.write(`  ${C.dim}tick ${++ticks} → ${status}${C.reset}\r`);
    if (TERMINAL.has(status)) { process.stdout.write('\n'); return status; }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

function nanoBananaProWorkflow(prompt: string, seed: number): Record<string, unknown> {
  return {
    '1': { class_type: 'GeminiImage2Node', inputs: { prompt, model: 'gemini-3-pro-image-preview', seed, aspect_ratio: '16:9', resolution: '1K', response_modalities: 'IMAGE' } },
    '2': { class_type: 'SaveImage', inputs: { filename_prefix: 'vfx_familiar_demo', images: ['1', 0] } },
  };
}

function basicSdWorkflow(prompt: string, seed: number, ckpt = 'v1-5-pruned-emaonly.safetensors'): Record<string, unknown> {
  return {
    '3': { class_type: 'KSampler', inputs: { seed, steps: 10, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'vfx_familiar_demo', images: ['8', 0] } },
  };
}

function die(msg: string): never {
  console.error(`${C.err}${msg}${C.reset}`);
  process.exit(1);
}
