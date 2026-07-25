import { describe, test, expect } from 'vitest';
import { renderTrainingReport, type TrainingReportData, type CheckpointSample } from '../training-report.js';

const T0 = Date.UTC(2026, 6, 22, 9, 0, 0);

function sample(overrides: Partial<CheckpointSample> = {}): CheckpointSample {
  return {
    versionLabel: 'v001',
    provider: 'google-ai-studio',
    createdAt: T0,
    meta: { base_model: 'sdxl', dataset_rev: 'demo-2026-07', step: 100, lr: 0.0001, loss: 0.42 },
    outputs: ['sample_0.png'],
    ...overrides,
  };
}

function data(overrides: Partial<TrainingReportData> = {}): TrainingReportData {
  return {
    effort: 'demo-style-lora',
    run: 'run-07',
    evalPrompts: [],
    generatedAt: T0,
    ...overrides,
  };
}

describe('renderTrainingReport', () => {
  test('empty run renders header + no-prompts notice', () => {
    const md = renderTrainingReport(data());
    expect(md).toContain('# Training Report — demo-style-lora / run-07');
    expect(md).toContain('- **Effort (project):** demo-style-lora');
    expect(md).toContain('- **Run (sequence):** run-07');
    expect(md).toContain('_No eval prompts recorded for this run yet._');
  });

  test('summarizes base model, dataset, best loss, max step across samples', () => {
    const md = renderTrainingReport(
      data({
        evalPrompts: [
          {
            name: 'figure in the doorway',
            samples: [
              sample({ versionLabel: 'v001', meta: { base_model: 'sdxl', dataset_rev: 'demo-2026-07', step: 100, lr: 0.0001, loss: 0.42 } }),
              sample({ versionLabel: 'v002', createdAt: T0 + 1000, meta: { base_model: 'sdxl', dataset_rev: 'demo-2026-07', step: 500, lr: 0.0001, loss: 0.19 } }),
            ],
          },
        ],
      }),
    );
    expect(md).toContain('- **Base model:** sdxl');
    expect(md).toContain('- **Dataset rev:** demo-2026-07');
    expect(md).toContain('- **Max step:** 500');
    expect(md).toContain('**Best loss:** 0.19');
    expect(md).toContain('- **Eval prompts:** 1  ·  **Checkpoint samples:** 2');
  });

  test('checkpoints are ordered by training step ascending', () => {
    const md = renderTrainingReport(
      data({
        evalPrompts: [
          {
            name: 'wide establishing',
            samples: [
              sample({ versionLabel: 'v003', meta: { step: 900, loss: 0.1 } }),
              sample({ versionLabel: 'v001', meta: { step: 100, loss: 0.5 } }),
              sample({ versionLabel: 'v002', meta: { step: 500, loss: 0.3 } }),
            ],
          },
        ],
      }),
    );
    const i100 = md.indexOf('| v001 | 100 |');
    const i500 = md.indexOf('| v002 | 500 |');
    const i900 = md.indexOf('| v003 | 900 |');
    expect(i100).toBeGreaterThan(-1);
    expect(i500).toBeGreaterThan(i100);
    expect(i900).toBeGreaterThan(i500);
  });

  test('missing training metadata renders em dashes, never crashes', () => {
    const md = renderTrainingReport(
      data({ evalPrompts: [{ name: 'p', samples: [sample({ meta: {}, outputs: [] })] }] }),
    );
    expect(md).toContain('| v001 | — | — | — |');
    expect(md).toContain('**Best loss:** —');
  });

  test('an eval prompt with no samples yet is shown', () => {
    const md = renderTrainingReport(data({ evalPrompts: [{ name: 'pending prompt', samples: [] }] }));
    expect(md).toContain('## pending prompt');
    expect(md).toContain('_No checkpoint samples yet._');
  });

  test('a lone CR in a caller-controlled base_model cannot forge markdown structure', () => {
    // base_model comes from the register provenance bag (caller/provider-controlled).
    // A bare CR is a CommonMark line ending — it must be scrubbed, not just LF.
    const md = renderTrainingReport(
      data({ evalPrompts: [{ name: 'p', samples: [sample({ meta: { base_model: 'sdxl\r## HACKED' } })] }] }),
    );
    expect(md).not.toMatch(/^## HACKED$/m);
    expect(md).toContain('- **Base model:** sdxl ## HACKED');
  });

  test('deterministic for identical input', () => {
    const d = data({ evalPrompts: [{ name: 'p', samples: [sample()] }] });
    expect(renderTrainingReport(d)).toBe(renderTrainingReport(d));
  });
});
