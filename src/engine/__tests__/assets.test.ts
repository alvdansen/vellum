import { describe, it, expect } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { TagRepo } from '../../store/tag-repo.js';
import { MetadataRepo } from '../../store/metadata-repo.js';
import { BreadcrumbResolver } from '../breadcrumb.js';
import { AssetsEngine } from '../assets.js';
import { TypedError } from '../errors.js';
import { MAX_TAGS_PER_VERSION, MAX_METADATA_PER_VERSION } from '../../tools/shape.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as SqliteClient } from 'better-sqlite3';
import type * as schema from '../../store/schema.js';

/**
 * AssetsEngine tests — Plan 04-03 Task 1.
 *
 * Traceability (RESEARCH.md + VALIDATION.md business-logic invariants):
 *   - INV-ASST-05 tags within-field AND semantics
 *   - INV-ASST-06 metadata within-field AND semantics
 *   - INV-ASST-07 cross-field AND composition (tags + metadata + status + date range)
 *   - INV-ASST-08 scope XOR — 2 fields → INVALID_SCOPE naming both
 *   - INV-ASST-09 empty scope — global query
 *   - INV-ASST-10 ordering — created_at DESC, id DESC (stable on timestamp tie)
 *   - INV-ASST-11 date range inclusive on both ends
 *   - INV-ASST-12 date_from > date_to → INVALID_INPUT
 *   - INV-ASST-13 pagination — total_count reflects full match set, not page
 *   - INV-ASST-14 listTags/listMetadataKeys default limit 20, cap 100
 *   - INV-ASST-17 MAX_TAGS_PER_VERSION enforced → TAG_LIMIT_EXCEEDED with version id in hint
 *   - INV-ASST-18 MAX_METADATA_PER_VERSION enforced → METADATA_LIMIT_EXCEEDED with version id in hint
 *   - INV-ASST-19 VERSION_NOT_FOUND on mutators referencing unknown version_id
 *   - INV-ASST-23 tag regex + whitespace-specific hint (TAG_INVALID / METADATA_INVALID)
 *   - INV-ASST-24 query always hydrates — items have tags + metadata arrays (even [])
 *
 * Plus boundary conditions from VALIDATION.md §Boundary Conditions:
 *   - Empty filter returns all versions
 *   - 0-result query shape
 *   - date_from == date_to (same instant)
 *   - offset > total_count
 *   - Tag with colon (status:approved)
 *   - addTag idempotency on duplicate
 *   - setMetadata upsert semantics
 */

/** Widened Db type — factory intersection surfaces $client for raw SQL. */
type DbWithClient = BetterSQLite3Database<typeof schema> & { $client: SqliteClient };

function buildStack() {
  const { db } = makeInMemoryDb();
  const h = new HierarchyRepo(db);
  const v = new VersionRepo(db);
  const tagRepo = new TagRepo(db as DbWithClient, v);
  const metaRepo = new MetadataRepo(db as DbWithClient, v);
  const breadcrumb = new BreadcrumbResolver(h, v);
  const assets = new AssetsEngine(db as DbWithClient, tagRepo, metaRepo, v, breadcrumb);
  const ws = h.createWorkspace('ws1');
  const proj = h.createProject(ws.id, 'p1');
  const seq = h.createSequence(proj.id, 'sq010');
  const shot = h.createShot(seq.id, 'sh010');
  return { db, h, v, tagRepo, metaRepo, breadcrumb, assets, ws, proj, seq, shot };
}

describe('AssetsEngine', () => {
  // ================================================================
  // addTag / removeTag
  // ================================================================

  describe('addTag / removeTag', () => {
    it('INV-ASST-01 addTag idempotent — same (version, tag) twice, entity.tags contains one instance', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      const r1 = assets.addTag(ver.id, 'hero');
      expect(r1.entity.tags).toContain('hero');
      const r2 = assets.addTag(ver.id, 'hero');
      expect(r2.entity.tags).toEqual(['hero']); // same tag, still exactly one
    });

    it('INV-ASST-19 addTag throws VERSION_NOT_FOUND on unknown version', () => {
      const { assets } = buildStack();
      expect(() => assets.addTag('ver_bogus', 'hero')).toThrowTypedError('VERSION_NOT_FOUND');
    });

    it('INV-ASST-17 addTag throws TAG_LIMIT_EXCEEDED at 51st tag with version_id in hint', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      // Seed 50 valid distinct tags
      for (let i = 0; i < MAX_TAGS_PER_VERSION; i++) {
        assets.addTag(ver.id, `tag${i.toString().padStart(3, '0')}`);
      }
      try {
        assets.addTag(ver.id, 'one_too_many');
        throw new Error('expected TAG_LIMIT_EXCEEDED');
      } catch (err) {
        expect((err as TypedError).code).toBe('TAG_LIMIT_EXCEEDED');
        // Hint must name the specific version identifier (D-ASST-23)
        expect((err as TypedError).hint).toContain('remove');
        expect((err as TypedError).message).toContain(ver.id);
      }
    });

    it('INV-ASST-23 addTag throws TAG_INVALID for whitespace with whitespace-specific hint', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      try {
        assets.addTag(ver.id, ' hero ');
        throw new Error('expected TAG_INVALID');
      } catch (err) {
        expect((err as TypedError).code).toBe('TAG_INVALID');
        // Whitespace-specific hint per RESEARCH Pitfall #7
        expect((err as TypedError).hint?.toLowerCase()).toContain('space');
      }
    });

    it('INV-ASST-23 addTag throws TAG_INVALID for regex failure ($hero)', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      expect(() => assets.addTag(ver.id, '$hero')).toThrowTypedError('TAG_INVALID');
    });

    it('addTag accepts colon in tag (status:approved — D-ASST-11 sub-decision)', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      const r = assets.addTag(ver.id, 'status:approved');
      expect(r.entity.tags).toContain('status:approved');
    });

    it('removeTag on missing tag is a no-op, returns refreshed entity', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      const r = assets.removeTag(ver.id, 'nonexistent');
      expect(r.entity.id).toBe(ver.id);
      expect(r.entity.tags).toEqual([]);
    });

    it('removeTag returns VERSION_NOT_FOUND on unknown version', () => {
      const { assets } = buildStack();
      expect(() => assets.removeTag('ver_bogus', 'hero')).toThrowTypedError('VERSION_NOT_FOUND');
    });
  });

  // ================================================================
  // setMetadata / removeMetadata
  // ================================================================

  describe('setMetadata / removeMetadata', () => {
    it('INV-ASST-03 setMetadata upsert — second call replaces value, entity.metadata reflects latest', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      const r1 = assets.setMetadata(ver.id, 'artist', 'tim');
      expect(r1.entity.metadata).toEqual([{ key: 'artist', value: 'tim' }]);
      const r2 = assets.setMetadata(ver.id, 'artist', 'bob');
      expect(r2.entity.metadata).toEqual([{ key: 'artist', value: 'bob' }]);
    });

    it('INV-ASST-18 setMetadata throws METADATA_LIMIT_EXCEEDED at 101st with version_id in hint', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      for (let i = 0; i < MAX_METADATA_PER_VERSION; i++) {
        assets.setMetadata(ver.id, `key${i.toString().padStart(3, '0')}`, `val${i}`);
      }
      try {
        assets.setMetadata(ver.id, 'overflow_key', 'v');
        throw new Error('expected METADATA_LIMIT_EXCEEDED');
      } catch (err) {
        expect((err as TypedError).code).toBe('METADATA_LIMIT_EXCEEDED');
        expect((err as TypedError).message).toContain(ver.id);
      }
    });

    it('INV-ASST-23 setMetadata rejects key with whitespace', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      expect(() => assets.setMetadata(ver.id, 'my key', 'v')).toThrowTypedError(
        'METADATA_INVALID',
      );
    });

    it('setMetadata rejects value over 2000 chars', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      const huge = 'x'.repeat(2001);
      expect(() => assets.setMetadata(ver.id, 'note', huge)).toThrowTypedError(
        'METADATA_INVALID',
      );
    });

    it('setMetadata rejects empty value', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      expect(() => assets.setMetadata(ver.id, 'note', '')).toThrowTypedError(
        'METADATA_INVALID',
      );
    });

    it('removeMetadata on missing key is a no-op, returns refreshed entity', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      const r = assets.removeMetadata(ver.id, 'nonexistent');
      expect(r.entity.id).toBe(ver.id);
      expect(r.entity.metadata).toEqual([]);
    });

    it('removeMetadata throws VERSION_NOT_FOUND on unknown version', () => {
      const { assets } = buildStack();
      expect(() => assets.removeMetadata('ver_bogus', 'artist')).toThrowTypedError(
        'VERSION_NOT_FOUND',
      );
    });
  });

  // ================================================================
  // queryAssets (the heavy filter path — Pattern 3 AND composition)
  // ================================================================

  describe('queryAssets', () => {
    it('INV-ASST-05 tags array — within-field AND (both tags required)', () => {
      const { v, assets, shot } = buildStack();
      const vA = v.insertVersion(shot.id);
      const vB = v.insertVersion(shot.id);
      const vC = v.insertVersion(shot.id);
      assets.addTag(vA.id, 'hero');
      assets.addTag(vA.id, 'final');
      assets.addTag(vB.id, 'hero'); // only one
      assets.addTag(vC.id, 'final'); // only one
      const r = assets.queryAssets({ tags: ['hero', 'final'], limit: 20, offset: 0 });
      expect(r.items).toHaveLength(1);
      expect(r.items[0]!.id).toBe(vA.id);
    });

    it('INV-ASST-06 metadata array — within-field AND on (key,value) pairs', () => {
      const { v, assets, shot } = buildStack();
      const vA = v.insertVersion(shot.id);
      const vB = v.insertVersion(shot.id);
      assets.setMetadata(vA.id, 'artist', 'tim');
      assets.setMetadata(vA.id, 'dept', 'lighting');
      assets.setMetadata(vB.id, 'artist', 'tim'); // missing dept
      const r = assets.queryAssets({
        metadata: [
          { key: 'artist', value: 'tim' },
          { key: 'dept', value: 'lighting' },
        ],
        limit: 20,
        offset: 0,
      });
      expect(r.items).toHaveLength(1);
      expect(r.items[0]!.id).toBe(vA.id);
    });

    it('INV-ASST-07 cross-field AND: tags + metadata + status + date_from all composed', () => {
      const { v, assets, shot } = buildStack();
      const vA = v.insertVersion(shot.id);
      const vB = v.insertVersion(shot.id);
      // Match all filters
      assets.addTag(vA.id, 'hero');
      assets.setMetadata(vA.id, 'artist', 'tim');
      v.markCompleted(vA.id, '[]');
      // Different version: only has tag, missing metadata
      assets.addTag(vB.id, 'hero');
      v.markCompleted(vB.id, '[]');
      const r = assets.queryAssets({
        tags: ['hero'],
        metadata: [{ key: 'artist', value: 'tim' }],
        status: 'completed',
        date_from: 0,
        limit: 20,
        offset: 0,
      });
      expect(r.items.map((i) => i.id)).toEqual([vA.id]);
    });

    it('INV-ASST-08 scope XOR — 2 fields → INVALID_SCOPE naming both in hint', () => {
      const { assets, ws, proj } = buildStack();
      try {
        assets.queryAssets({
          workspace_id: ws.id,
          project_id: proj.id,
          limit: 20,
          offset: 0,
        });
        throw new Error('expected INVALID_SCOPE');
      } catch (err) {
        expect((err as TypedError).code).toBe('INVALID_SCOPE');
        const msg = (err as TypedError).message;
        expect(msg).toContain('workspace_id');
        expect(msg).toContain('project_id');
      }
    });

    it('INV-ASST-08 scope XOR — 3 fields also rejected', () => {
      const { assets, ws, proj, seq } = buildStack();
      expect(() =>
        assets.queryAssets({
          workspace_id: ws.id,
          project_id: proj.id,
          sequence_id: seq.id,
          limit: 20,
          offset: 0,
        }),
      ).toThrowTypedError('INVALID_SCOPE');
    });

    it('INV-ASST-09 empty scope — global query returns all versions', () => {
      const { v, assets, shot } = buildStack();
      v.insertVersion(shot.id);
      v.insertVersion(shot.id);
      v.insertVersion(shot.id);
      const r = assets.queryAssets({ limit: 20, offset: 0 });
      expect(r.items).toHaveLength(3);
      expect(r.total_count).toBe(3);
    });

    it('INV-ASST-10 ordering — created_at DESC, id DESC (stable tiebreaker)', () => {
      const { v, assets, shot } = buildStack();
      // Insert three versions; they will naturally have increasing created_at.
      const v1 = v.insertVersion(shot.id);
      const v2 = v.insertVersion(shot.id);
      const v3 = v.insertVersion(shot.id);
      const r = assets.queryAssets({ shot_id: shot.id, limit: 20, offset: 0 });
      // Latest created_at first (typically v3, v2, v1); if timestamps collide, id DESC tiebreaks.
      expect(r.items.map((i) => i.id)).toEqual([v3.id, v2.id, v1.id]);
    });

    it('INV-ASST-11 date range inclusive on date_from and date_to', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      const ts = ver.created_at;
      const inclusiveResult = assets.queryAssets({
        date_from: ts,
        date_to: ts,
        limit: 20,
        offset: 0,
      });
      expect(inclusiveResult.items.map((i) => i.id)).toContain(ver.id);
    });

    it('INV-ASST-12 date_from > date_to → INVALID_INPUT with specific hint', () => {
      const { assets } = buildStack();
      try {
        assets.queryAssets({ date_from: 2000, date_to: 1000, limit: 20, offset: 0 });
        throw new Error('expected INVALID_INPUT');
      } catch (err) {
        expect((err as TypedError).code).toBe('INVALID_INPUT');
        expect((err as TypedError).hint).toBe('date_from must be <= date_to');
      }
    });

    it('INV-ASST-13 total_count reflects full match set, not page', () => {
      const { v, assets, shot } = buildStack();
      for (let i = 0; i < 5; i++) v.insertVersion(shot.id);
      const r = assets.queryAssets({ limit: 2, offset: 0 });
      expect(r.items).toHaveLength(2);
      expect(r.total_count).toBe(5);
    });

    it('INV-ASST-24 query items always include tags + metadata inline (even when empty)', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      const r = assets.queryAssets({ limit: 20, offset: 0 });
      expect(r.items).toHaveLength(1);
      const item = r.items[0]!;
      expect(Array.isArray(item.tags)).toBe(true);
      expect(Array.isArray(item.metadata)).toBe(true);
      expect(item.tags).toEqual([]);
      expect(item.metadata).toEqual([]);
      // Smoke-check breadcrumb attached (D-ASST-05)
      expect(item.breadcrumb).toBeDefined();
      expect(item.breadcrumb.entries).toHaveLength(5);
      // version_label always populated
      expect(item.version_label).toBe('v' + String(ver.version_number).padStart(3, '0'));
    });

    it('0-result query → {items:[], total_count:0, limit:20, offset:0}', () => {
      const { v, assets, shot } = buildStack();
      v.insertVersion(shot.id);
      const r = assets.queryAssets({ tags: ['nonexistent'], limit: 20, offset: 0 });
      expect(r.items).toEqual([]);
      expect(r.total_count).toBe(0);
      expect(r.limit).toBe(20);
      expect(r.offset).toBe(0);
    });

    it('offset beyond total_count → items empty, total_count preserved', () => {
      const { v, assets, shot } = buildStack();
      for (let i = 0; i < 3; i++) v.insertVersion(shot.id);
      const r = assets.queryAssets({ limit: 20, offset: 100 });
      expect(r.items).toEqual([]);
      expect(r.total_count).toBe(3);
    });

    it('filter tags[] array > 20 entries → INVALID_INPUT (engine defence-in-depth)', () => {
      const { assets } = buildStack();
      const big = Array.from({ length: 21 }, (_, i) => `t${i}`);
      expect(() =>
        assets.queryAssets({ tags: big, limit: 20, offset: 0 }),
      ).toThrowTypedError('INVALID_INPUT');
    });

    it('scope walks project_id down to shot versions correctly', () => {
      const { h, v, assets, proj } = buildStack();
      // Create a second shot under the same project
      const seq2 = h.createSequence(proj.id, 'sq020');
      const shot2 = h.createShot(seq2.id, 'sh020');
      v.insertVersion(shot2.id);
      v.insertVersion(shot2.id);
      const r = assets.queryAssets({ project_id: proj.id, limit: 20, offset: 0 });
      // Expect 2 versions under shot2 (the seeded shot has no versions in this test)
      expect(r.total_count).toBe(2);
    });
  });

  // ================================================================
  // listTags / listMetadataKeys
  // ================================================================

  describe('listTags / listMetadataKeys', () => {
    it('listTags global — returns tags from all versions ordered count DESC, name ASC', () => {
      const { v, assets, shot } = buildStack();
      const v1 = v.insertVersion(shot.id);
      const v2 = v.insertVersion(shot.id);
      assets.addTag(v1.id, 'hero');
      assets.addTag(v1.id, 'final');
      assets.addTag(v2.id, 'hero'); // hero twice
      const r = assets.listTags({ limit: 20, offset: 0 });
      expect(r.items[0]!.name).toBe('hero');
      expect(r.items[0]!.count).toBe(2);
      expect(r.items[1]!.name).toBe('final');
      expect(r.items[1]!.count).toBe(1);
    });

    it('listTags scoped to shot filters correctly (INV-ASST-08 XOR enforced)', () => {
      const { h, v, assets, proj, shot } = buildStack();
      const seq2 = h.createSequence(proj.id, 'sq020');
      const shot2 = h.createShot(seq2.id, 'sh020');
      const v1 = v.insertVersion(shot.id);
      const v2 = v.insertVersion(shot2.id);
      assets.addTag(v1.id, 'tag_in_shot1');
      assets.addTag(v2.id, 'tag_in_shot2');
      const r = assets.listTags({ shot_id: shot.id, limit: 20, offset: 0 });
      expect(r.items.map((i) => i.name)).toEqual(['tag_in_shot1']);
      // Scope echoed in response (D-ASST-06)
      expect(r.scope.shot_id).toBe(shot.id);
    });

    it('INV-ASST-14 listTags default limit=20 when undefined', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      for (let i = 0; i < 25; i++) {
        assets.addTag(ver.id, `tag${i.toString().padStart(3, '0')}`);
      }
      // Limit undefined → resolves to default 20
      const r = assets.listTags({ limit: undefined as unknown as number, offset: undefined as unknown as number });
      expect(r.items).toHaveLength(20);
      expect(r.limit).toBe(20);
      expect(r.offset).toBe(0);
    });

    it('INV-ASST-14 listTags caps limit at MAX_PAGE_SIZE=100', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      assets.addTag(ver.id, 'anything');
      const r = assets.listTags({ limit: 500, offset: 0 });
      expect(r.limit).toBe(100);
    });

    it('listMetadataKeys global — returns {name,count} with distinct keys', () => {
      const { v, assets, shot } = buildStack();
      const v1 = v.insertVersion(shot.id);
      const v2 = v.insertVersion(shot.id);
      assets.setMetadata(v1.id, 'artist', 'tim');
      assets.setMetadata(v2.id, 'artist', 'bob');
      assets.setMetadata(v1.id, 'dept', 'lighting');
      const r = assets.listMetadataKeys({ limit: 20, offset: 0 });
      expect(r.items.find((i) => i.name === 'artist')!.count).toBe(2);
      expect(r.items.find((i) => i.name === 'dept')!.count).toBe(1);
    });

    it('listTags INVALID_SCOPE on 2 scope fields', () => {
      const { assets, ws, proj } = buildStack();
      expect(() =>
        assets.listTags({ workspace_id: ws.id, project_id: proj.id, limit: 20, offset: 0 }),
      ).toThrowTypedError('INVALID_SCOPE');
    });
  });

  // ================================================================
  // hydrateVersionWithAssets
  // ================================================================

  describe('hydrateVersionWithAssets', () => {
    it('empty version returns tags:[] metadata:[] (RESEARCH Pitfall #2 — not [null])', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      const hydrated = assets.hydrateVersionWithAssets(ver);
      expect(hydrated.tags).toEqual([]);
      expect(hydrated.metadata).toEqual([]);
      // Original Version fields still present
      expect(hydrated.id).toBe(ver.id);
      expect(hydrated.shot_id).toBe(ver.shot_id);
    });

    it('populated version returns ASC-sorted tags + metadata by key', () => {
      const { v, assets, shot } = buildStack();
      const ver = v.insertVersion(shot.id);
      assets.addTag(ver.id, 'zeta');
      assets.addTag(ver.id, 'alpha');
      assets.addTag(ver.id, 'middle');
      assets.setMetadata(ver.id, 'zeta_k', 'z');
      assets.setMetadata(ver.id, 'alpha_k', 'a');
      const hydrated = assets.hydrateVersionWithAssets(ver);
      expect(hydrated.tags).toEqual(['alpha', 'middle', 'zeta']);
      expect(hydrated.metadata.map((m) => m.key)).toEqual(['alpha_k', 'zeta_k']);
    });
  });
});
