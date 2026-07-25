import { describe, test, expect } from 'vitest';
import {
  renderShotPipelineLog,
  formatUtc,
  type GateProposalEntry,
  type PipelineLogTake,
  type ShotPipelineLogData,
} from '../pipeline-log.js';
import type { BreadcrumbEntry, Shot, Version } from '../../types/hierarchy.js';
import type { ProvenanceEvent } from '../../types/provenance.js';
import type { ShotStatusEvent } from '../../store/shot-status-repo.js';

// A fixed epoch so every rendered timestamp is deterministic in assertions.
// 2026-07-21 09:00:00 UTC = 1784624400000.
const T0 = Date.UTC(2026, 6, 21, 9, 0, 0);
const hours = (n: number) => T0 + n * 3_600_000;

function breadcrumb(): BreadcrumbEntry[] {
  return [
    { type: 'workspace', id: 'ws1', name: 'Demo Show' },
    { type: 'project', id: 'pr1', name: 'DEMO01' },
    { type: 'sequence', id: 'sq1', name: 'SEQ010' },
    { type: 'shot', id: 'shot1', name: 'sh010' },
  ];
}

function shot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: 'shot1',
    sequence_id: 'sq1',
    name: 'sh010',
    created_at: T0,
    status: 'approved',
    ...overrides,
  };
}

function version(overrides: Partial<Version> = {}): Version {
  return {
    id: 'ver1',
    shot_id: 'shot1',
    version_number: 1,
    status: 'completed',
    job_id: null,
    parent_version_id: null,
    notes: null,
    created_at: T0,
    completed_at: hours(1),
    error_code: null,
    error_message: null,
    outputs_json: null,
    lineage_type: null,
    reproduction_warnings_json: null,
    provider: 'comfyui-cloud',
    ...overrides,
  };
}

function completedEvent(overrides: Partial<ProvenanceEvent> = {}): ProvenanceEvent {
  return {
    id: 'prov1',
    version_id: 'ver1',
    event_type: 'completed',
    workflow_json: null,
    prompt_json: null,
    seed: null,
    models_json: null,
    outputs_json: null,
    error_code: null,
    error_message: null,
    manifest_signed_json: null,
    summary_generated_json: null,
    generation_request_json: null,
    generation_result_json: null,
    timestamp: hours(1),
    ...overrides,
  };
}

function failedEvent(overrides: Partial<ProvenanceEvent> = {}): ProvenanceEvent {
  return {
    ...completedEvent(),
    event_type: 'failed',
    error_code: null,
    error_message: null,
    ...overrides,
  };
}

function statusEvent(overrides: Partial<ShotStatusEvent> = {}): ShotStatusEvent {
  return {
    id: 'sse1',
    shot_id: 'shot1',
    from_status: null,
    to_status: 'wip',
    changed_by: 'user',
    note: null,
    created_at: T0,
    ...overrides,
  };
}

function baseData(overrides: Partial<ShotPipelineLogData> = {}): ShotPipelineLogData {
  return {
    breadcrumb: breadcrumb(),
    shot: shot(),
    status: 'approved',
    lastChangedAt: hours(2),
    statusHistory: [],
    takes: [],
    gateProposals: [],
    statusHistoryTruncated: false,
    proposalsTruncated: false,
    generatedAt: T0,
    ...overrides,
  };
}

describe('formatUtc', () => {
  test('renders a known epoch as a stable UTC string', () => {
    expect(formatUtc(T0)).toBe('2026-07-21 09:00 UTC');
  });
  test('null / undefined / NaN render as an em dash', () => {
    expect(formatUtc(null)).toBe('—');
    expect(formatUtc(undefined)).toBe('—');
    expect(formatUtc(Number.NaN)).toBe('—');
  });
});

describe('renderShotPipelineLog — header + empty shot', () => {
  test('an untouched shot renders header, zero takes, and no-history notice', () => {
    const md = renderShotPipelineLog(baseData({ status: 'wip', lastChangedAt: null }));
    expect(md).toContain('# Pipeline Log — DEMO01 / SEQ010 / sh010');
    expect(md).toContain('- **Shot:** sh010');
    expect(md).toContain('- **Path:** Demo Show › DEMO01 › SEQ010 › sh010');
    expect(md).toContain('- **Status:** wip');
    // No lastChangedAt ⇒ no "last changed" suffix.
    expect(md).not.toContain('last changed');
    expect(md).toContain('- **Takes:** 0 total');
    expect(md).toContain('_No status changes recorded._');
    expect(md).toContain('_No takes recorded yet._');
    expect(md).toContain('from Vellum provenance (append-only)');
  });

  test('status with a lastChangedAt renders the timestamp suffix', () => {
    const md = renderShotPipelineLog(baseData({ status: 'approved', lastChangedAt: hours(2) }));
    expect(md).toContain('- **Status:** approved _(last changed 2026-07-21 11:00 UTC)_');
  });
});

describe('renderShotPipelineLog — status history', () => {
  test('renders transitions oldest-first regardless of input order', () => {
    const history = [
      statusEvent({ id: 's3', from_status: 'pending-review', to_status: 'approved', changed_by: 'alex', note: 'keeper picked', created_at: hours(2) }),
      statusEvent({ id: 's1', from_status: null, to_status: 'wip', created_at: T0 }),
      statusEvent({ id: 's2', from_status: 'wip', to_status: 'pending-review', changed_by: 'tim', created_at: hours(1) }),
    ];
    const md = renderShotPipelineLog(baseData({ statusHistory: history }));
    const idxInitial = md.indexOf('(initial) → wip');
    const idxReview = md.indexOf('wip → pending-review');
    const idxApproved = md.indexOf('pending-review → approved');
    expect(idxInitial).toBeGreaterThan(-1);
    expect(idxReview).toBeGreaterThan(idxInitial);
    expect(idxApproved).toBeGreaterThan(idxReview);
    expect(md).toContain('| pending-review → approved | alex | keeper picked |');
  });
});

describe('renderShotPipelineLog — takes', () => {
  test('renders a full multi-take shot: table rows, lineage, provider ref, cost, outputs, error', () => {
    const v1 = version({
      id: 'ver1',
      version_number: 1,
      status: 'completed',
      job_id: 'comfy-job-aaa',
      provider: 'comfyui-cloud',
    });
    const v2 = version({
      id: 'ver2',
      version_number: 2,
      status: 'completed',
      job_id: 'rp_bbb222',
      provider: 'replicate',
      lineage_type: 'iterate',
      parent_version_id: 'ver1',
      notes: 'masked value-lift',
      created_at: hours(3),
      completed_at: hours(4),
    });
    const v3 = version({
      id: 'ver3',
      version_number: 3,
      status: 'failed',
      provider: 'replicate',
      completed_at: null,
      error_code: 'DOWNLOAD_FAILED',
      error_message: 'host not in allowlist',
      created_at: hours(5),
    });

    const takes: PipelineLogTake[] = [
      {
        version: v1,
        events: [
          completedEvent({
            version_id: 'ver1',
            seed: 12345,
            models_json: JSON.stringify([
              { node_id: '4', class_type: 'CheckpointLoaderSimple', model_name: 'sdxl_base.safetensors', model_hash: null, model_hash_unavailable: null },
            ]),
            outputs_json: JSON.stringify([
              { filename: 'frame_001.png', path: '/x/frame_001.png', url: 'https://cdn/frame_001.png', content_type: 'image/png', size_bytes: 1_258_291 },
            ]),
          }),
        ],
        costEstimate: null,
        proposalKind: null,
        proposalStatus: null,
        costActual: null,
      },
      {
        version: v2,
        events: [
          completedEvent({
            id: 'prov2',
            version_id: 'ver2',
            generation_result_json: JSON.stringify({ model: 'seedance-2.0', params: { steps: 30 } }),
            outputs_json: JSON.stringify([
              { filename: 'clip_002.mp4', path: '/x/clip_002.mp4', url: 'https://cdn/clip_002.mp4', content_type: 'video/mp4', size_bytes: 5_242_880 },
            ]),
          }),
        ],
        costEstimate: '$0.04',
        proposalKind: 'iterate',
        proposalStatus: 'approved',
        costActual: null,
      },
      {
        version: v3,
        events: [failedEvent({ version_id: 'ver3', error_code: 'DOWNLOAD_FAILED', error_message: 'host not in allowlist' })],
        costEstimate: null,
        proposalKind: null,
        proposalStatus: null,
        costActual: null,
      },
    ];

    const md = renderShotPipelineLog(baseData({ takes }));

    // Take-count summary is sorted, per-status.
    expect(md).toContain('- **Takes:** 3 total — 2 completed, 1 failed');

    // Takes table rows.
    expect(md).toContain('| v001 | completed | comfyui-cloud | — |');
    expect(md).toContain('| v002 | completed | replicate | iterate ← v001 |');
    expect(md).toContain('| v003 | failed | replicate | — |');
    // v002 cost (estimate, marked) + output count in table.
    expect(md).toMatch(/\| v002 \|.*\| \$0\.04 \(est\) \| 1 file \|/);

    // Per-take detail — provider media ref (the provider media UUID teams track by hand).
    expect(md).toContain('**Provider job / media ref:** `comfy-job-aaa`');
    expect(md).toContain('**Provider job / media ref:** `rp_bbb222`');
    // Seed + models.
    expect(md).toContain('**Seed:** 12345');
    expect(md).toContain('**Models:** sdxl_base.safetensors (CheckpointLoaderSimple)');
    // Lineage detail + notes.
    expect(md).toContain('**Lineage:** iterate ← v001');
    expect(md).toContain('**Notes:** masked value-lift');
    // Cost + proposal linkage.
    expect(md).toContain('**Cost (est.):** $0.04 · proposal: iterate, approved');
    // Outputs with human bytes.
    expect(md).toContain('`frame_001.png` — 1.2 MB — image/png');
    expect(md).toContain('`clip_002.mp4` — 5.0 MB — video/mp4');
    // Failed take surfaces its error (incl. rejected/failed takes requirement).
    expect(md).toContain('**Error:** DOWNLOAD_FAILED — host not in allowlist');
    // Neutral provenance block for the non-ComfyUI take.
    expect(md).toContain('**Neutral provenance:**');
    expect(md).toContain('"model": "seedance-2.0"');
  });

  test('outputs fall back to the version row when the completed event has none', () => {
    const v = version({
      id: 'ver1',
      outputs_json: JSON.stringify([
        { filename: 'fallback.png', path: '/x/fallback.png', url: 'u', content_type: 'image/png', size_bytes: 900 },
      ]),
    });
    const takes: PipelineLogTake[] = [
      { version: v, events: [completedEvent({ outputs_json: null })], costEstimate: null, proposalKind: null, proposalStatus: null, costActual: null },
    ];
    const md = renderShotPipelineLog(baseData({ takes }));
    expect(md).toContain('`fallback.png` — 900 B — image/png');
  });
});

describe('renderShotPipelineLog — robustness', () => {
  test('malformed models_json / outputs_json never throw and the take still renders', () => {
    const takes: PipelineLogTake[] = [
      {
        version: version({ id: 'ver1', outputs_json: 'not json' }),
        events: [completedEvent({ models_json: '{bad', outputs_json: '<<<' })],
        costEstimate: null,
        proposalKind: null,
        proposalStatus: null,
        costActual: null,
      },
    ];
    expect(() => renderShotPipelineLog(baseData({ takes }))).not.toThrow();
    const md = renderShotPipelineLog(baseData({ takes }));
    expect(md).toContain('| v001 | completed |');
    // No models line, no outputs bullet — but no crash and the row is present.
    expect(md).not.toContain('**Models:**');
  });

  test('valid-JSON arrays with null / primitive elements never throw', () => {
    // '[null]' and '[1,"x"]' parse fine but have no object fields — the renderer
    // must drop them, not dereference them.
    const takes: PipelineLogTake[] = [
      {
        version: version({ id: 'ver1', outputs_json: '[null, 42]' }),
        events: [completedEvent({ models_json: '[null]', outputs_json: '[null, "x"]', generation_result_json: 'null' })],
        costEstimate: null,
        proposalKind: null,
        proposalStatus: null,
        costActual: null,
      },
    ];
    expect(() => renderShotPipelineLog(baseData({ takes }))).not.toThrow();
    const md = renderShotPipelineLog(baseData({ takes }));
    expect(md).toContain('| v001 | completed |');
    expect(md).not.toContain('**Models:**');
    // A bare `null` neutral-provenance blob is not rendered.
    expect(md).not.toContain('**Neutral provenance:**');
  });

  test('object elements with missing fields render safely (no "undefined")', () => {
    const takes: PipelineLogTake[] = [
      {
        version: version({ id: 'ver1' }),
        events: [
          completedEvent({
            models_json: JSON.stringify([{ node_id: '4' }]), // no model_name / class_type
            outputs_json: JSON.stringify([{ path: '/x/y' }]), // no filename / size
          }),
        ],
        costEstimate: null,
        proposalKind: null,
        proposalStatus: null,
        costActual: null,
      },
    ];
    const md = renderShotPipelineLog(baseData({ takes }));
    expect(md).not.toContain('undefined');
    expect(md).toContain('**Models:** — (—)');
  });

  test('a note containing a pipe is escaped so the table stays valid', () => {
    const takes: PipelineLogTake[] = [
      {
        version: version({ id: 'ver1', notes: 'a | b | c' }),
        events: [completedEvent()],
        costEstimate: null,
        proposalKind: null,
        proposalStatus: null,
        costActual: null,
      },
    ];
    const md = renderShotPipelineLog(baseData({ takes }));
    expect(md).toContain('**Notes:** a \\| b \\| c');
  });

  test('legacy take with null provider renders an em dash, not "null"', () => {
    const takes: PipelineLogTake[] = [
      { version: version({ id: 'ver1', provider: null }), events: [completedEvent()], costEstimate: null, proposalKind: null, proposalStatus: null, costActual: null },
    ];
    const md = renderShotPipelineLog(baseData({ takes }));
    expect(md).toContain('| v001 | completed | — | — |');
    expect(md).not.toContain('null');
  });

  test('markdown injection via newline/backtick is neutralized', () => {
    const v = version({
      id: 'ver1',
      job_id: 'abc\n# INJECTED HEADING\nrest',
      outputs_json: JSON.stringify([
        { filename: 'evil`.png', path: '/x', url: 'u', content_type: 'image/png', size_bytes: 10 },
      ]),
    });
    const takes: PipelineLogTake[] = [
      {
        version: v,
        events: [
          completedEvent({
            models_json: JSON.stringify([{ node_id: '4', class_type: 'X', model_name: 'm\n## forged', model_hash: null, model_hash_unavailable: null }]),
            outputs_json: JSON.stringify([
              { filename: 'evil`.png', path: '/x', url: 'u', content_type: 'image/png', size_bytes: 10 },
            ]),
          }),
        ],
        costEstimate: null,
        proposalKind: null,
        proposalStatus: null,
        costActual: null,
      },
    ];
    // Breadcrumb name also carries an injection attempt.
    const bc = breadcrumb();
    bc[0] = { ...bc[0], name: 'WS\n# HACKED' };
    const md = renderShotPipelineLog(baseData({ breadcrumb: bc, takes }));
    // No injected heading survives as its own line.
    expect(md).not.toMatch(/^# INJECTED HEADING$/m);
    expect(md).not.toMatch(/^## forged$/m);
    expect(md).not.toMatch(/^# HACKED$/m);
    // The job ref code span is not broken by the embedded content.
    expect(md).toContain('`abc # INJECTED HEADING rest`');
    // The backtick in the filename is replaced with a space, keeping the code span intact.
    expect(md).toContain('`evil .png`');
  });

  test('gate proposals with no take are rendered for spend accounting', () => {
    const gateProposals: GateProposalEntry[] = [
      { kind: 'submit', status: 'rejected', provider: 'kling', costEstimate: '$4.00', createdAt: hours(1), decidedAt: hours(2), decidedNote: 'too expensive', executionError: null },
      { kind: 'iterate', status: 'approved', provider: 'byteplus', costEstimate: '$0.20', createdAt: hours(3), decidedAt: hours(4), decidedNote: null, executionError: 'PROVIDER_TIMEOUT' },
    ];
    const md = renderShotPipelineLog(baseData({ gateProposals }));
    expect(md).toContain('## Gate proposals (no take produced)');
    expect(md).toContain('| submit | rejected | kling | $4.00 |');
    expect(md).toContain('too expensive');
    // Approved-but-failed is flagged and its error surfaced (real spend, no take).
    expect(md).toContain('approved (failed)');
    expect(md).toContain('error: PROVIDER_TIMEOUT');
  });

  test('no gate-proposals section when there are none', () => {
    const md = renderShotPipelineLog(baseData({ gateProposals: [] }));
    expect(md).not.toContain('## Gate proposals');
  });

  test('truncation is disclosed for status history and proposals', () => {
    const md = renderShotPipelineLog(
      baseData({
        statusHistory: [statusEvent({ to_status: 'approved', from_status: 'wip' })],
        statusHistoryTruncated: true,
        gateProposals: [{ kind: 'submit', status: 'rejected', provider: null, costEstimate: null, createdAt: hours(1), decidedAt: hours(1), decidedNote: null, executionError: null }],
        proposalsTruncated: true,
      }),
    );
    expect(md).toContain('Older status changes were truncated');
    expect(md).toContain('Older proposals were truncated');
  });

  test('recorded actual cost is shown over the estimate, with a per-shot spend total', () => {
    const takes: PipelineLogTake[] = [
      {
        version: version({ id: 'ver1', version_number: 1, provider: 'byteplus' }),
        events: [completedEvent()],
        costEstimate: '$0.20',
        proposalKind: 'iterate',
        proposalStatus: 'approved',
        costActual: { amount: 0.18, currency: 'USD', note: 'seedance 2.0 fast' },
      },
      {
        version: version({ id: 'ver2', version_number: 2, provider: 'google-ai-studio' }),
        events: [completedEvent({ version_id: 'ver2' })],
        costEstimate: null,
        proposalKind: null,
        proposalStatus: null,
        costActual: { amount: 0, currency: 'USD' },
      },
    ];
    const md = renderShotPipelineLog(baseData({ takes }));
    // Table cost cell shows the ACTUAL (no "(est)" marker).
    expect(md).toMatch(/\| v001 \|.*\| 0\.18 USD \|/);
    // Detail line shows actual + the estimate + the note.
    expect(md).toContain('**Cost (actual):** 0.18 USD · est $0.20 · seedance 2.0 fast');
    // Per-shot recorded spend total (summed per currency).
    expect(md).toContain('- **Recorded spend:** 0.18 USD');
  });

  test('a malformed (non-numeric) cost amount never crashes the renderer', () => {
    // A malformed persisted payload could carry a non-number amount (e.g. via a
    // direct engine call that bypassed validation, or a hand-edited row). The
    // renderer must degrade, not throw.
    const takes: PipelineLogTake[] = [
      {
        version: version({ id: 'ver1' }),
        events: [completedEvent()],
        costEstimate: null,
        proposalKind: null,
        proposalStatus: null,
        costActual: { amount: 'lots' as unknown as number, currency: 'USD' },
      },
    ];
    expect(() => renderShotPipelineLog(baseData({ takes }))).not.toThrow();
    const md = renderShotPipelineLog(baseData({ takes }));
    // The bad amount is not summed into the recorded-spend total.
    expect(md).not.toContain('**Recorded spend:**');
  });

  test('a newline in the cost currency cannot forge markdown in the spend total', () => {
    const takes: PipelineLogTake[] = [
      {
        version: version({ id: 'ver1' }),
        events: [completedEvent()],
        costEstimate: null,
        proposalKind: null,
        proposalStatus: null,
        costActual: { amount: 1, currency: 'USD\n# HACKED' },
      },
    ];
    const md = renderShotPipelineLog(baseData({ takes }));
    expect(md).not.toMatch(/^# HACKED$/m);
    expect(md).toContain('- **Recorded spend:** 1 USD # HACKED');
  });

  test('render is deterministic for identical input', () => {
    const data = baseData({
      statusHistory: [statusEvent({ to_status: 'approved', from_status: 'wip' })],
      takes: [{ version: version(), events: [completedEvent()], costEstimate: '$1', proposalKind: 'submit', proposalStatus: 'approved', costActual: null }],
    });
    expect(renderShotPipelineLog(data)).toBe(renderShotPipelineLog(data));
  });
});
