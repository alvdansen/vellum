import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from '../schema.js';

/**
 * Phase 20 — STAT-01/02 schema-shape guard.
 *
 * The Drizzle definition for `shots.status` + the new `shotStatusEvents`
 * table must match the migration 0008 DDL (column names, types, defaults,
 * FK target). This file pins the Drizzle side; the migration DDL pin
 * lives in migrate.test.ts after we bump EXPECTED_MIGRATIONS to 8.
 */
describe('STAT-01 — shots.status Drizzle column', () => {
  it('shots table exports a `status` column on the Drizzle definition', () => {
    const cfg = getTableConfig(schema.shots);
    const statusCol = cfg.columns.find((c) => c.name === 'status');
    expect(statusCol, "shots.status column missing from Drizzle schema").toBeDefined();
    // notNull
    expect(statusCol!.notNull).toBe(true);
    // text/string type
    expect(statusCol!.dataType).toBe('string');
    // default 'wip'
    expect(statusCol!.default).toBe('wip');
  });
});

describe('STAT-02 — shotStatusEvents Drizzle table', () => {
  it('shotStatusEvents is exported from schema.ts', () => {
    expect(schema.shotStatusEvents, 'shotStatusEvents export missing').toBeDefined();
  });

  it('underlying SQL table name is shot_status_events', () => {
    const cfg = getTableConfig(schema.shotStatusEvents);
    expect(cfg.name).toBe('shot_status_events');
  });

  it('shotStatusEvents has exactly the seven Phase 20 columns', () => {
    const cfg = getTableConfig(schema.shotStatusEvents);
    const colNames = cfg.columns.map((c) => c.name).sort();
    expect(colNames).toEqual([
      'changed_by',
      'created_at',
      'from_status',
      'id',
      'note',
      'shot_id',
      'to_status',
    ]);
  });

  it('id is primaryKey text not-null', () => {
    const cfg = getTableConfig(schema.shotStatusEvents);
    const id = cfg.columns.find((c) => c.name === 'id')!;
    expect(id.primary).toBe(true);
    expect(id.notNull).toBe(true);
  });

  it('shot_id is not-null and FK-references shots.id', () => {
    const cfg = getTableConfig(schema.shotStatusEvents);
    const shotId = cfg.columns.find((c) => c.name === 'shot_id')!;
    expect(shotId.notNull).toBe(true);
    // FK metadata is recorded on the table config (foreignKeys list)
    expect(cfg.foreignKeys.length).toBeGreaterThanOrEqual(1);
    const fk = cfg.foreignKeys[0];
    const ref = fk.reference();
    expect(ref.foreignTable).toBe(schema.shots);
    expect(ref.columns.map((c) => c.name)).toContain('shot_id');
    expect(ref.foreignColumns.map((c) => c.name)).toContain('id');
  });

  it('from_status is nullable (null on first-ever status set)', () => {
    const cfg = getTableConfig(schema.shotStatusEvents);
    const fromStatus = cfg.columns.find((c) => c.name === 'from_status')!;
    expect(fromStatus.notNull).toBe(false);
  });

  it('to_status, changed_by, and created_at are not-null', () => {
    const cfg = getTableConfig(schema.shotStatusEvents);
    expect(cfg.columns.find((c) => c.name === 'to_status')!.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === 'changed_by')!.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === 'created_at')!.notNull).toBe(true);
  });

  it('note is nullable', () => {
    const cfg = getTableConfig(schema.shotStatusEvents);
    expect(cfg.columns.find((c) => c.name === 'note')!.notNull).toBe(false);
  });

  it('idx_shot_status_events_shot_time index on (shot_id, created_at)', () => {
    const cfg = getTableConfig(schema.shotStatusEvents);
    const idx = cfg.indexes.find((i) => i.config.name === 'idx_shot_status_events_shot_time');
    expect(idx, "idx_shot_status_events_shot_time index missing").toBeDefined();
    // Confirm both columns are present in the index
    const idxCols = idx!.config.columns.map((c) =>
      typeof c === 'object' && c !== null && 'name' in c ? (c as { name: string }).name : String(c),
    );
    expect(idxCols).toContain('shot_id');
    expect(idxCols).toContain('created_at');
  });
});
