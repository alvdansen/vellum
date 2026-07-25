import { describe, test, expect } from 'vitest';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { VersionRepo } from '../version-repo.js';
import { ProvenanceRepo } from '../provenance-repo.js';

/**
 * Cost actuals — appendCostRecordedEvent / getLatestCostRecorded. Append-only:
 * a correction is a newer sibling event; the newest VALID payload wins, and a
 * malformed newest row is skipped to the next valid one (parity with the
 * manifest_signed / summary_generated bounded-scan lookups).
 */
function setup() {
  const { db, sqlite } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const ws = hierarchy.createWorkspace('W');
  const proj = hierarchy.createProject(ws.id, 'P');
  const seq = hierarchy.createSequence(proj.id, 'SC01');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const v = versions.insertVersion(shot.id, 't', undefined, 'byteplus');
  return { sqlite, provenanceRepo, versionId: v.id };
}

describe('ProvenanceRepo — cost_recorded', () => {
  test('no cost events → null', () => {
    const { provenanceRepo, versionId } = setup();
    expect(provenanceRepo.getLatestCostRecorded(versionId)).toBeNull();
  });

  test('the newest recorded cost wins (corrections append)', () => {
    const { provenanceRepo, versionId } = setup();
    provenanceRepo.appendCostRecordedEvent(versionId, { amount: 0.2, currency: 'USD' });
    provenanceRepo.appendCostRecordedEvent(versionId, { amount: 0.18, currency: 'USD', note: 'reconciled' });
    const latest = provenanceRepo.getLatestCostRecorded(versionId);
    expect(latest?.amount).toBe(0.18);
    expect(latest?.note).toBe('reconciled');
  });

  test('a malformed newest row is skipped to the next valid one', () => {
    const { sqlite, provenanceRepo, versionId } = setup();
    provenanceRepo.appendCostRecordedEvent(versionId, { amount: 0.5, currency: 'USD' });
    // Inject a malformed cost_recorded row with a LATER timestamp via raw SQL.
    sqlite
      .prepare(
        `INSERT INTO provenance (id, version_id, event_type, cost_recorded_json, timestamp) VALUES (?, ?, 'cost_recorded', ?, ?)`,
      )
      .run('prov_bad', versionId, '{not json', Date.now() + 10_000);
    // The malformed newest is skipped; the valid older record is returned.
    const latest = provenanceRepo.getLatestCostRecorded(versionId);
    expect(latest?.amount).toBe(0.5);
  });
});
