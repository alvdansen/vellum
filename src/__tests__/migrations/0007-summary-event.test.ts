import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readFileSync } from 'node:fs';
import * as schema from '../../store/schema.js';
import { SCHEMA_DDL } from '../../store/schema.js';
import { BUSY_TIMEOUT_MS } from '../../store/db.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import {
  ProvenanceRepo,
  SUMMARY_GENERATED_LOOKUP_LIMIT,
} from '../../store/provenance-repo.js';
import type {
  SummaryGeneratedPayloadFields,
  ProvenanceSummaryGeneratedPayload,
} from '../../types/provenance.js';

/**
 * Phase 19 (SUM-05) — Plan 19-01 Task 2.
 *
 * Migration 0007 + ProvenanceRepo accessors for the new 'summary_generated'
 * append-only event. Mirrors Plan 14-03's manifest_signed_json idempotency
 * tests verbatim with the cache-key composite swapped from `filename` to
 * `(manifest_sha256, template_version, model_id)`.
 *
 * Tests:
 *  1. Fresh-DB migration applies cleanly: column exists, NULL on insert without payload.
 *  2. Pre-Phase-19 rows (manifest_signed events) read summary_generated_json as NULL.
 *  3. Idempotency — running runMigrations() twice does not double-apply
 *     (no error thrown, column count unchanged on PRAGMA table_info).
 *  4. appendSummaryGeneratedEvent INSERTs round-trip — JSON parse equality.
 *  5. getLatestSummaryGeneratedEvent composite-key match (positive case).
 *  6. getLatestSummaryGeneratedEvent miss — different manifest_sha256 → null.
 *  7. getLatestSummaryGeneratedEvent miss — different template_version → null.
 *  8. Append-only architecture-purity grep — `grep -E "this.db.update|this.db.delete"
 *     src/store/provenance-repo.ts` returns ZERO.
 *
 * Cache-key invariant: Phase 16 redact mutates manifest_sha256 → cache miss
 * for free without explicit invalidation logic.
 */

const SAMPLE_PAYLOAD: SummaryGeneratedPayloadFields = {
  manifest_sha256: 'sha256-abcd1234',
  template_version: '1.0.0',
  model_id: 'claude-haiku-4-5-20251001',
  summary_text: 'v003 generated with flux1-dev at seed 42 from parent v002.',
  generated_at: '2026-05-09T12:00:00Z',
  prompt_tokens: 2100,
  completion_tokens: 95,
  outcome: 'live',
};

describe('Phase 19 (SUM-05) — migration 0007 + summary_generated event', () => {
  let repo: ProvenanceRepo;
  let versionRepo: VersionRepo;
  let versionId: string;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    repo = new ProvenanceRepo(db);
    versionRepo = new VersionRepo(db);
    const hierarchy = new HierarchyRepo(db);
    const ws = hierarchy.createWorkspace('ws19');
    const proj = hierarchy.createProject(ws.id, 'p19');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const shot = hierarchy.createShot(seq.id, 'sh010');
    versionId = versionRepo.insertVersion(shot.id).id;
  });

  test('Test 1 — Migration 0007 applies cleanly on a fresh DB; summary_generated_json column exists and is nullable', () => {
    // Fresh DB — built explicitly here so the assertion is unambiguous about
    // running on a brand-new schema state (mirrors Plan 14-03 Test 7 shape).
    const sqlite = new Database(':memory:');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(SCHEMA_DDL);
    sqlite.pragma('user_version = 1');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: './drizzle' });

    // summary_generated_json column must exist on `provenance` and be nullable.
    const cols = sqlite.prepare(`PRAGMA table_info(provenance)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const summaryCol = cols.find((c) => c.name === 'summary_generated_json');
    expect(summaryCol).toBeDefined();
    expect(summaryCol!.type.toUpperCase()).toBe('TEXT');
    expect(summaryCol!.notnull).toBe(0); // nullable

    sqlite.close();
  });

  test('Test 2 — Pre-Phase-19 rows (manifest_signed event) read summary_generated_json as NULL', () => {
    // Insert a Phase-14-shaped 'manifest_signed' event AND a 'completed'
    // row, both PREDATE the Phase-19 'summary_generated' surface. Both rows
    // must read summary_generated_json = NULL after the additive migration.
    repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: '{}',
      seed: 42,
      models_json: '[]',
      outputs_json: '[]',
    });
    repo.appendManifestSignedEvent(versionId, {
      filename: 'out.png',
      format: 'image/png',
      signed: true,
      cert_subject_summary: 'CN=test',
      signed_at: '2026-04-30T12:00:00Z',
      status_reason: '',
      algorithm: 'es256',
    });

    const events = repo.getEventsForVersion(versionId);
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.summary_generated_json).toBeNull();
    }
  });

  test('Test 3 — Idempotency: running migrate() twice on a Phase-19-state DB is a no-op (no error, column count unchanged)', () => {
    // Build a Phase-19-state DB.
    const sqlite = new Database(':memory:');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(SCHEMA_DDL);
    sqlite.pragma('user_version = 1');
    const db = drizzle(sqlite, { schema });

    // First migrate — applies migrations 0001-0007.
    migrate(db, { migrationsFolder: './drizzle' });
    const colsAfterFirst = sqlite
      .prepare(`PRAGMA table_info(provenance)`)
      .all() as Array<{ name: string }>;
    const colsAfterFirstNames = new Set(colsAfterFirst.map((c) => c.name));
    expect(colsAfterFirstNames.has('summary_generated_json')).toBe(true);

    // Second migrate — should be a no-op (drizzle's __drizzle_migrations
    // table is the deduplication source). Must not throw and must not
    // double-apply the column.
    expect(() => migrate(db, { migrationsFolder: './drizzle' })).not.toThrow();

    const colsAfterSecond = sqlite
      .prepare(`PRAGMA table_info(provenance)`)
      .all() as Array<{ name: string }>;
    expect(colsAfterSecond.length).toBe(colsAfterFirst.length);
    const colsAfterSecondNames = new Set(colsAfterSecond.map((c) => c.name));
    expect(colsAfterSecondNames).toEqual(colsAfterFirstNames);

    // __drizzle_migrations row count is stable.
    const migCount1 = (sqlite
      .prepare(`SELECT COUNT(*) AS n FROM __drizzle_migrations`)
      .get() as { n: number }).n;
    expect(migCount1).toBeGreaterThan(0);
    // Re-run again to be doubly sure.
    migrate(db, { migrationsFolder: './drizzle' });
    const migCount2 = (sqlite
      .prepare(`SELECT COUNT(*) AS n FROM __drizzle_migrations`)
      .get() as { n: number }).n;
    expect(migCount2).toBe(migCount1);

    sqlite.close();
  });

  test('Test 4 — appendSummaryGeneratedEvent INSERTs round-trip with byte-equal JSON parse', () => {
    const inserted = repo.appendSummaryGeneratedEvent(versionId, SAMPLE_PAYLOAD);

    expect(inserted.id).toMatch(/^prov_/);
    expect(inserted.event_type).toBe('summary_generated');
    expect(inserted.version_id).toBe(versionId);
    // Other event-specific columns must be null on a summary_generated row.
    expect(inserted.workflow_json).toBeNull();
    expect(inserted.prompt_json).toBeNull();
    expect(inserted.seed).toBeNull();
    expect(inserted.models_json).toBeNull();
    expect(inserted.outputs_json).toBeNull();
    expect(inserted.error_code).toBeNull();
    expect(inserted.error_message).toBeNull();
    expect(inserted.manifest_signed_json).toBeNull();

    // The new column must carry the JSON-encoded payload.
    expect(inserted.summary_generated_json).not.toBeNull();
    const parsed = JSON.parse(inserted.summary_generated_json!) as SummaryGeneratedPayloadFields;
    expect(parsed).toEqual(SAMPLE_PAYLOAD);

    // ProvenanceSummaryGeneratedPayload type is discriminable on event_type.
    const payload: ProvenanceSummaryGeneratedPayload = {
      event_type: 'summary_generated',
      ...SAMPLE_PAYLOAD,
    };
    if (payload.event_type === 'summary_generated') {
      expect(payload.summary_text).toBe(SAMPLE_PAYLOAD.summary_text);
      expect(payload.outcome).toBe('live');
    }
  });

  test('Test 5 — getLatestSummaryGeneratedEvent composite-key match (positive case)', () => {
    repo.appendSummaryGeneratedEvent(versionId, SAMPLE_PAYLOAD);

    const found = repo.getLatestSummaryGeneratedEvent(
      versionId,
      SAMPLE_PAYLOAD.manifest_sha256,
      SAMPLE_PAYLOAD.template_version,
      SAMPLE_PAYLOAD.model_id,
    );
    expect(found).not.toBeNull();
    expect(found).toEqual(SAMPLE_PAYLOAD);
  });

  test('Test 6 — getLatestSummaryGeneratedEvent miss — different manifest_sha256 → null (Phase 16 redact gives free invalidation)', () => {
    repo.appendSummaryGeneratedEvent(versionId, SAMPLE_PAYLOAD);

    // Phase 16 redact mutates manifest_sha256; lookup with the post-redact
    // hash MUST miss the pre-redact cache row.
    const miss = repo.getLatestSummaryGeneratedEvent(
      versionId,
      'sha256-DIFFERENT-after-redact',
      SAMPLE_PAYLOAD.template_version,
      SAMPLE_PAYLOAD.model_id,
    );
    expect(miss).toBeNull();
  });

  test('Test 7 — getLatestSummaryGeneratedEvent miss — different template_version → null (template bump invalidates cache)', () => {
    repo.appendSummaryGeneratedEvent(versionId, SAMPLE_PAYLOAD);

    // Bumping SUMMARY_TEMPLATE_VERSION triggers full cache regeneration on
    // next view (manifest_sha256 + model_id unchanged but template_version
    // differs → cache miss). D-LLM-6 invariant.
    const miss = repo.getLatestSummaryGeneratedEvent(
      versionId,
      SAMPLE_PAYLOAD.manifest_sha256,
      '2.0.0', // bumped
      SAMPLE_PAYLOAD.model_id,
    );
    expect(miss).toBeNull();

    // Also miss when model_id differs (e.g., switching Haiku model versions).
    const missModel = repo.getLatestSummaryGeneratedEvent(
      versionId,
      SAMPLE_PAYLOAD.manifest_sha256,
      SAMPLE_PAYLOAD.template_version,
      'claude-sonnet-other',
    );
    expect(missModel).toBeNull();
  });

  test('Test 8 — Append-only architecture-purity invariant: no this.db.update / this.db.delete substring in provenance-repo.ts', () => {
    const file = readFileSync('src/store/provenance-repo.ts', 'utf-8');
    expect(file).not.toMatch(/this\.db\.update\(/);
    expect(file).not.toMatch(/this\.db\.delete\(/);
    // Sanity: the new lookup uses the bounded LIMIT.
    expect(file).toMatch(/\.limit\(SUMMARY_GENERATED_LOOKUP_LIMIT\)/);
    expect(file).toMatch(/orderBy\(desc\(provenance\.timestamp\)\)/);
    // Sanity: SUMMARY_GENERATED_LOOKUP_LIMIT is exported as a named constant.
    expect(SUMMARY_GENERATED_LOOKUP_LIMIT).toBeGreaterThan(0);
  });

  test('Test 9 — Two appendSummaryGeneratedEvent calls insert TWO rows (no upsert, no update — append-only)', async () => {
    repo.appendSummaryGeneratedEvent(versionId, SAMPLE_PAYLOAD);
    await new Promise((r) => setTimeout(r, 5));
    repo.appendSummaryGeneratedEvent(versionId, {
      ...SAMPLE_PAYLOAD,
      summary_text: 'v003 regenerated — slightly different temperature draw.',
      generated_at: '2026-05-09T12:01:00Z',
    });

    const events = repo.getEventsForVersion(versionId);
    const summaryEvents = events.filter((e) => e.event_type === 'summary_generated');
    expect(summaryEvents).toHaveLength(2);
    expect(summaryEvents.map((e) => e.id)).not.toEqual([
      summaryEvents[0]!.id,
      summaryEvents[0]!.id,
    ]);

    // getLatestSummaryGeneratedEvent returns the NEWER row.
    const latest = repo.getLatestSummaryGeneratedEvent(
      versionId,
      SAMPLE_PAYLOAD.manifest_sha256,
      SAMPLE_PAYLOAD.template_version,
      SAMPLE_PAYLOAD.model_id,
    );
    expect(latest).not.toBeNull();
    expect(latest!.summary_text).toBe('v003 regenerated — slightly different temperature draw.');
  });
});
