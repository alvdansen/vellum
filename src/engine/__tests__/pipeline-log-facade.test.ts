import { describe, test, expect } from 'vitest';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { ProvenanceWriter } from '../provenance.js';
import { ProposalRepo } from '../../store/proposal-repo.js';
import { insertStatusEvent } from '../../store/shot-status-repo.js';
import { Engine } from '../pipeline.js';
import { TypedError } from '../errors.js';

/**
 * Engine.getShotPipelineLog over the REAL facade + REAL in-memory
 * store. Seeds versions / provenance events / status transitions / a linked
 * approval-gate proposal directly through the repos, then asserts the gather
 * wiring (listAllForShot + getEventsForVersion + listProposals + status
 * history) feeds the pure renderer correctly.
 */

function setup() {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const proposals = new ProposalRepo(db);
  const engine = new Engine(db, hierarchy, versions, provenanceRepo, null, 'outputs');
  const ws = hierarchy.createWorkspace('Demo Show');
  const proj = hierarchy.createProject(ws.id, 'DEMO01');
  const seq = hierarchy.createSequence(proj.id, 'SEQ010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  return { db, engine, hierarchy, versions, provenanceRepo, provenanceWriter, proposals, shotId: shot.id };
}

describe('Engine.getShotPipelineLog', () => {
  test('unknown shot throws SHOT_NOT_FOUND', () => {
    const { engine } = setup();
    try {
      engine.getShotPipelineLog('shot_missing');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TypedError);
      expect((err as TypedError).code).toBe('SHOT_NOT_FOUND');
    }
  });

  test('fresh shot with no takes renders a valid empty log', () => {
    const { engine, shotId } = setup();
    const res = engine.getShotPipelineLog(shotId);
    expect(res.shot_id).toBe(shotId);
    expect(res.take_count).toBe(0);
    expect(res.markdown).toContain('# Pipeline Log — DEMO01 / SEQ010 / sh010');
    expect(res.markdown).toContain('_No takes recorded yet._');
    expect(res.breadcrumb_text).toContain('Demo Show');
    expect(res.breadcrumb.map((b) => b.name)).toEqual(['Demo Show', 'DEMO01', 'SEQ010', 'sh010']);
  });

  test('gathers takes, provenance, status history, and linked proposal cost', () => {
    const { db, engine, versions, provenanceWriter, proposals, shotId } = setup();

    // --- Status timeline (append-only dual-write) ---
    insertStatusEvent(db, shotId, null, 'wip', 'user');
    insertStatusEvent(db, shotId, 'wip', 'pending-review', 'tim', 'staged assets');
    insertStatusEvent(db, shotId, 'pending-review', 'approved', 'alex', 'keeper picked');

    // --- Take 1: a completed comfyui take ---
    const v1 = versions.insertVersion(shotId, 'first pass', undefined, 'comfyui-cloud');
    versions.setJobId(v1.id, 'comfy-job-aaa');
    const outputs1 = JSON.stringify([
      { filename: 'frame_001.png', path: '/x/frame_001.png', url: 'https://cdn/frame_001.png', content_type: 'image/png', size_bytes: 1_258_291 },
    ]);
    versions.markCompleted(v1.id, outputs1);
    provenanceWriter.writeSubmitEvent(v1.id, { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl_base.safetensors' } } });
    provenanceWriter.writeCompletedEvent(
      v1.id,
      { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl_base.safetensors' } } },
      outputs1,
    );

    // --- Take 2: an iterate on take 1, replicate, produced via an approved proposal (cost) ---
    const v2 = versions.insertVersion(shotId, 'value lift', { parent_version_id: v1.id, lineage_type: 'iterate' }, 'replicate');
    versions.setJobId(v2.id, 'rp_bbb222');
    const outputs2 = JSON.stringify([
      { filename: 'frame_002.png', path: '/x/frame_002.png', url: 'https://replicate.delivery/frame_002.png', content_type: 'image/png', size_bytes: 2_100_000 },
    ]);
    versions.markCompleted(v2.id, outputs2);
    provenanceWriter.writeCompletedEvent(v2.id, null, outputs2, JSON.stringify({ model: 'sdxl', seed: 42 }));
    // Link an approved proposal carrying the human-reviewed cost estimate.
    const prop = proposals.insertProposal({
      shotId,
      kind: 'iterate',
      provider: 'replicate',
      requestJson: JSON.stringify({ version_id: v2.id }),
      costEstimate: '$0.04',
    });
    proposals.decide(prop.id, 'approved');
    proposals.attachVersion(prop.id, v2.id);

    // --- Take 3: a failed take (must still appear — "incl. rejected takes") ---
    const v3 = versions.insertVersion(shotId, undefined, undefined, 'replicate');
    versions.markFailed(v3.id, 'DOWNLOAD_FAILED', 'host not in allowlist');
    provenanceWriter.writeFailedEvent(v3.id, 'DOWNLOAD_FAILED', 'host not in allowlist');

    // --- A REJECTED proposal that never produced a take (version_id stays null) ---
    // Log every call + cost incl. rejected takes — this must still show.
    const rejected = proposals.insertProposal({
      shotId,
      kind: 'submit',
      provider: 'kling',
      requestJson: JSON.stringify({ workflow: {} }),
      costEstimate: '$4.00',
    });
    proposals.decide(rejected.id, 'rejected', 'too expensive for this shot');

    const res = engine.getShotPipelineLog(shotId);
    const md = res.markdown;

    expect(res.take_count).toBe(3);

    // Header take-count summary (sorted per-status).
    expect(md).toContain('- **Takes:** 3 total — 2 completed, 1 failed');
    expect(md).toContain('- **Status:** approved');

    // Status timeline present and terminal transition captured.
    expect(md).toContain('pending-review → approved | alex | keeper picked');

    // Takes table.
    expect(md).toContain('| v001 | completed | comfyui-cloud | — |');
    expect(md).toContain('| v002 | completed | replicate | iterate ← v001 |');
    expect(md).toContain('| v003 | failed | replicate | — |');

    // Provider media refs (the hand-tracked UUIDs).
    expect(md).toContain('`comfy-job-aaa`');
    expect(md).toContain('`rp_bbb222`');

    // Models extracted from the completed comfyui provenance.
    expect(md).toContain('sdxl_base.safetensors (CheckpointLoaderSimple)');

    // Linked proposal cost surfaced.
    expect(md).toContain('**Cost (est.):** $0.04 · proposal: iterate, approved');

    // Neutral provenance for the replicate take.
    expect(md).toContain('**Neutral provenance:**');

    // Failed take error surfaced.
    expect(md).toContain('**Error:** DOWNLOAD_FAILED — host not in allowlist');

    // Outputs listed with human byte sizes.
    expect(md).toContain('`frame_001.png` — 1.2 MB — image/png');

    // The rejected proposal (no take) appears in the gate-proposals section.
    expect(md).toContain('## Gate proposals (no take produced)');
    expect(md).toContain('| submit | rejected | kling | $4.00 |');
    expect(md).toContain('too expensive for this shot');
  });

  test('recordCost surfaces the actual spend (latest wins) in the pipeline log', () => {
    const { engine, versions, provenanceWriter, provenanceRepo, shotId } = setup();
    const v = versions.insertVersion(shotId, 'a take', undefined, 'byteplus');
    versions.markCompleted(v.id, '[]');
    provenanceWriter.writeCompletedEvent(v.id, null, '[]');

    // First recording, then a correction — the latest wins.
    engine.recordCost(v.id, { amount: 0.2, currency: 'USD', note: 'first estimate of actual' });
    const res = engine.recordCost(v.id, { amount: 0.18, currency: 'USD', note: 'reconciled from invoice' });
    expect(res.cost.amount).toBe(0.18);
    expect(provenanceRepo.getLatestCostRecorded(v.id)?.amount).toBe(0.18);

    const md = engine.getShotPipelineLog(shotId).markdown;
    expect(md).toContain('**Cost (actual):** 0.18 USD');
    expect(md).toContain('reconciled from invoice');
    expect(md).toContain('- **Recorded spend:** 0.18 USD');
    expect(md).not.toContain('0.2 USD'); // superseded by the correction
  });

  test('recordCost rejects a bad amount / currency and an unknown version', () => {
    const { engine, versions, shotId } = setup();
    const v = versions.insertVersion(shotId, 't', undefined, 'fal');
    expect(() => engine.recordCost(v.id, { amount: -1, currency: 'USD' })).toThrow(/non-negative/);
    expect(() => engine.recordCost(v.id, { amount: 1, currency: '  ' })).toThrow(/currency/i);
    try {
      engine.recordCost('ver_missing', { amount: 1, currency: 'USD' });
      expect.unreachable('should throw');
    } catch (err) {
      expect((err as TypedError).code).toBe('VERSION_NOT_FOUND');
    }
  });
});
