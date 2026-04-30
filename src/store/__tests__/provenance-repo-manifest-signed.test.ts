import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as schema from '../schema.js';
import { SCHEMA_DDL } from '../schema.js';
import { BUSY_TIMEOUT_MS } from '../db.js';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { VersionRepo } from '../version-repo.js';
import { ProvenanceRepo } from '../provenance-repo.js';
import type {
  ManifestSignedPayloadFields,
  ProvenanceManifestSignedPayload,
} from '../../types/provenance.js';

/**
 * Phase 14 (PROV-V-01) — Plan 14-03 Task 1.
 *
 * Append-only sibling 'manifest_signed' provenance event tests.
 *
 * Mirrors Phase 13's `appendModelsFingerprintedEvent` shape verbatim. The
 * event records the OUTCOME of an Engine.signOutput call: success, skip
 * (signing disabled), unsupported format (EXR/PSD), cert-load failure, native-
 * binding failure, sign-call failure, or asset-too-large-for-buffer-API.
 *
 * v1.1 scope (Concern #2): NO `sidecar` field. c2pa-node v0.5.26 has no
 * cryptographically-bound sidecar API. EXR/PSD surface as
 * `signed=false; status_reason='unsupported_format'` events with the
 * original file untouched on disk.
 *
 * Append-only invariant (T-14-09 mitigation): the new event is INSERTED as
 * a separate row; the original 'completed' + 'models_fingerprinted' rows
 * stay byte-identical.
 */

describe('Phase 14 (PROV-V-01) — manifest_signed sibling event', () => {
  let repo: ProvenanceRepo;
  let versionRepo: VersionRepo;
  let versionId: string;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    repo = new ProvenanceRepo(db);
    versionRepo = new VersionRepo(db);
    const hierarchy = new HierarchyRepo(db);
    const ws = hierarchy.createWorkspace('ws1');
    const proj = hierarchy.createProject(ws.id, 'p1');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const shot = hierarchy.createShot(seq.id, 'sh010');
    versionId = versionRepo.insertVersion(shot.id).id;
  });

  test('Test 1 — appendManifestSignedEvent inserts a row with event_type=manifest_signed and parseable payload', () => {
    const inserted = repo.appendManifestSignedEvent(versionId, {
      filename: 'out.png',
      format: 'image/png',
      signed: true,
      cert_subject_summary: 'CN=test',
      signed_at: '2026-04-30T12:00:00Z',
      status_reason: '',
      algorithm: 'es256',
    });

    expect(inserted.id).toMatch(/^prov_/);
    expect(inserted.event_type).toBe('manifest_signed');
    expect(inserted.version_id).toBe(versionId);
    // Other event-specific fields must be null on a manifest_signed row.
    expect(inserted.workflow_json).toBeNull();
    expect(inserted.prompt_json).toBeNull();
    expect(inserted.seed).toBeNull();
    expect(inserted.models_json).toBeNull();
    expect(inserted.outputs_json).toBeNull();
    expect(inserted.error_code).toBeNull();
    expect(inserted.error_message).toBeNull();

    // Payload is parseable.
    const events = repo.getEventsForVersion(versionId);
    const fp = events.find((e) => e.event_type === 'manifest_signed');
    expect(fp).toBeDefined();
    // The migration 0006 column must carry the JSON-encoded payload.
    expect((fp as unknown as { manifest_signed_json: string | null }).manifest_signed_json).not.toBeNull();
    const payload = JSON.parse(
      (fp as unknown as { manifest_signed_json: string }).manifest_signed_json,
    ) as ManifestSignedPayloadFields;
    expect(payload.filename).toBe('out.png');
    expect(payload.format).toBe('image/png');
    expect(payload.signed).toBe(true);
    expect(payload.cert_subject_summary).toBe('CN=test');
    expect(payload.signed_at).toBe('2026-04-30T12:00:00Z');
    expect(payload.status_reason).toBe('');
    expect(payload.algorithm).toBe('es256');
  });

  test('Test 2 — appendManifestSignedEvent with signed=false / status_reason=unsupported_format records an EXR/PSD-like event', () => {
    const inserted = repo.appendManifestSignedEvent(versionId, {
      filename: 'out.exr',
      format: 'image/x-exr',
      signed: false,
      cert_subject_summary: '',
      signed_at: '2026-04-30T12:00:00Z',
      status_reason: 'unsupported_format',
      algorithm: '',
    });

    expect(inserted.event_type).toBe('manifest_signed');
    const events = repo.getEventsForVersion(versionId);
    const fp = events.find((e) => e.id === inserted.id)!;
    const payload = JSON.parse(
      (fp as unknown as { manifest_signed_json: string }).manifest_signed_json,
    ) as ManifestSignedPayloadFields;
    expect(payload.signed).toBe(false);
    expect(payload.status_reason).toBe('unsupported_format');
    expect(payload.format).toBe('image/x-exr');
  });

  test('Test 3 — getEventsForVersion includes the new event in chronological order', async () => {
    repo.insertEvent(versionId, { event_type: 'submitted', workflow_json: '{}' });
    await new Promise((r) => setTimeout(r, 2));
    repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: '{}',
      seed: null,
      models_json: '[]',
      outputs_json: '[]',
    });
    await new Promise((r) => setTimeout(r, 2));
    repo.appendModelsFingerprintedEvent(versionId, []);
    await new Promise((r) => setTimeout(r, 2));
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
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.event_type)).toEqual([
      'submitted',
      'completed',
      'models_fingerprinted',
      'manifest_signed',
    ]);
    expect(events[3]!.timestamp).toBeGreaterThanOrEqual(events[2]!.timestamp);
  });

  test('Test 4 — Two appendManifestSignedEvent calls insert TWO rows (no upsert, no update — append-only invariant)', () => {
    repo.appendManifestSignedEvent(versionId, {
      filename: 'out.png',
      format: 'image/png',
      signed: false,
      cert_subject_summary: '',
      signed_at: '2026-04-30T12:00:00Z',
      status_reason: 'cert_load_failed',
      algorithm: '',
    });
    repo.appendManifestSignedEvent(versionId, {
      filename: 'out.png',
      format: 'image/png',
      signed: true,
      cert_subject_summary: 'CN=retry',
      signed_at: '2026-04-30T12:01:00Z',
      status_reason: '',
      algorithm: 'es256',
    });

    const events = repo.getEventsForVersion(versionId);
    const signedEvents = events.filter((e) => e.event_type === 'manifest_signed');
    expect(signedEvents).toHaveLength(2);
    expect(signedEvents.map((e) => e.id)).not.toEqual([
      signedEvents[0]!.id,
      signedEvents[0]!.id,
    ]);
  });

  test('Test 5 — ProvenanceManifestSignedPayload type is discriminable on event_type', () => {
    // Compile-time discriminated-union narrowing: this test exists primarily
    // to fail at TypeScript-compile time if the union extension is missing.
    // The runtime check confirms the event_type discriminator works as expected.
    const payload: ProvenanceManifestSignedPayload = {
      event_type: 'manifest_signed',
      filename: 'out.png',
      format: 'image/png',
      signed: true,
      cert_subject_summary: 'CN=test',
      signed_at: '2026-04-30T12:00:00Z',
      status_reason: '',
      algorithm: 'es256',
    };
    if (payload.event_type === 'manifest_signed') {
      expect(payload.filename).toBe('out.png');
      expect(payload.signed).toBe(true);
    } else {
      // Unreachable at runtime; the assertion would fail loudly if the union
      // disjunction breaks.
      expect.unreachable('payload.event_type discriminator failed');
    }
  });

  test('Test 6 — Append-only architecture-purity invariant: no db.update / db.delete substring in provenance-repo.ts', () => {
    const file = readFileSync('src/store/provenance-repo.ts', 'utf-8');
    expect(file).not.toMatch(/this\.db\.update\(/);
    expect(file).not.toMatch(/this\.db\.delete\(/);
  });

  test('Test 7 — Migration 0006 applies cleanly on a Phase 13 baseline DB; manifest_signed_json column is nullable, existing rows still readable', () => {
    // Build a fresh DB at the Phase 13 baseline state by running Drizzle's
    // migrator over the local drizzle/ folder. Migration 0006 is included
    // in that folder and applies as part of `migrate(...)`.
    //
    // The makeInMemoryDb helper does this end-to-end already — we re-do it
    // explicitly here to assert the new column exists + tolerate-NULL on
    // pre-existing rows.
    const sqlite = new Database(':memory:');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(SCHEMA_DDL);
    sqlite.pragma('user_version = 1');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: './drizzle' });

    // Manifest_signed_json must exist as a column on `provenance`.
    const cols = sqlite.prepare(`PRAGMA table_info(provenance)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const manifestCol = cols.find((c) => c.name === 'manifest_signed_json');
    expect(manifestCol).toBeDefined();
    expect(manifestCol!.type.toUpperCase()).toBe('TEXT');
    // Nullable — notnull=0 in PRAGMA table_info.
    expect(manifestCol!.notnull).toBe(0);

    // Insert a pre-Phase-14 'completed' row and assert it round-trips with
    // manifest_signed_json=NULL.
    const hierarchy = new HierarchyRepo(db);
    const versionRepoLocal = new VersionRepo(db);
    const ws = hierarchy.createWorkspace('mig-ws');
    const proj = hierarchy.createProject(ws.id, 'p');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const shot = hierarchy.createShot(seq.id, 'sh010');
    const ver = versionRepoLocal.insertVersion(shot.id);
    const repoLocal = new ProvenanceRepo(db);
    repoLocal.insertEvent(ver.id, {
      event_type: 'completed',
      prompt_json: '{}',
      seed: null,
      models_json: '[]',
      outputs_json: '[]',
    });
    const events = repoLocal.getEventsForVersion(ver.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('completed');
    // The new column should default to NULL on rows where it was not set.
    expect(
      (events[0] as unknown as { manifest_signed_json: string | null }).manifest_signed_json,
    ).toBeNull();
    sqlite.close();
  });

  test('Test 8 — getLatestManifestSignedEvent returns the most recent event for a version+filename pair', async () => {
    // First event — failure.
    repo.appendManifestSignedEvent(versionId, {
      filename: 'out.png',
      format: 'image/png',
      signed: false,
      cert_subject_summary: '',
      signed_at: '2026-04-30T12:00:00Z',
      status_reason: 'cert_load_failed',
      algorithm: '',
    });
    await new Promise((r) => setTimeout(r, 5));
    // Second event — success retry.
    repo.appendManifestSignedEvent(versionId, {
      filename: 'out.png',
      format: 'image/png',
      signed: true,
      cert_subject_summary: 'CN=retry',
      signed_at: '2026-04-30T12:01:00Z',
      status_reason: '',
      algorithm: 'es256',
    });
    // Third event — different filename, should not affect the lookup for out.png.
    repo.appendManifestSignedEvent(versionId, {
      filename: 'other.mp4',
      format: 'video/mp4',
      signed: true,
      cert_subject_summary: 'CN=retry',
      signed_at: '2026-04-30T12:02:00Z',
      status_reason: '',
      algorithm: 'es256',
    });

    const latest = repo.getLatestManifestSignedEvent(versionId, 'out.png');
    expect(latest).not.toBeNull();
    expect(latest!.signed).toBe(true);
    expect(latest!.cert_subject_summary).toBe('CN=retry');
    expect(latest!.signed_at).toBe('2026-04-30T12:01:00Z');

    const otherLatest = repo.getLatestManifestSignedEvent(versionId, 'other.mp4');
    expect(otherLatest).not.toBeNull();
    expect(otherLatest!.format).toBe('video/mp4');
  });

  test('Test 9 — getLatestManifestSignedEvent returns null when no manifest_signed event exists', () => {
    expect(repo.getLatestManifestSignedEvent(versionId, 'never.png')).toBeNull();
  });
});
