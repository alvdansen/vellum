import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { buildStackWithOutputs } from '../../test-utils/fixtures.js';
import type { Engine } from '../pipeline.js';
import { EngineEmitter } from '../events.js';
import type {
  VersionCreatedPayload,
  VersionStatusChangedPayload,
  TagChangedPayload,
  MetadataChangedPayload,
  HierarchyCreatedPayload,
} from '../events.js';

/**
 * Plan 05-02 Task 2 — pipeline.ts typed event emission tests.
 *
 * D-WEBUI-29: all 8 mutation paths publish typed events via engine.events.
 * D-WEBUI-26: markCompleted calls downloadOutput non-fatally (not asserted here
 *   because markCompleted's completion path runs inside getGenerationStatus
 *   which is already covered by generation.test.ts; we assert wiring via the
 *   version.status_changed emit).
 *
 * Uses the real Engine from buildStackWithOutputs() so the actual wiring is
 * exercised (not a stub). For generation-path tests that need a seeded
 * submit+complete flow, we drive FakeComfyUIClient's canned-happy scenario.
 */

type Ctx = {
  engine: Engine;
  cleanup: () => void;
  workspaceId: string;
  projectId: string;
  sequenceId: string;
  shotId: string;
  versionId: string; // a submitted+completed version for tag/metadata/reproduce tests
};

async function setup(): Promise<Ctx> {
  const stack = buildStackWithOutputs();
  const engine = stack.engine;

  // Seed hierarchy. These create calls themselves emit hierarchy.created —
  // we capture that in a dedicated test; other tests use the returned ids.
  const ws = engine.createWorkspace('ws1');
  const proj = engine.createProject(ws.entity.id, 'p1');
  const seq = engine.createSequence(proj.entity.id, 'sq010');
  const shot = engine.createShot(seq.entity.id, 'sh010');

  // Seed a submitted+completed version so tag/metadata mutations have a
  // valid version_id to target.
  const submitted = await engine.submitGeneration(shot.entity.id, {
    '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7 } },
  });
  // Drive getGenerationStatus → FakeComfyUIClient's happy scenario completes
  // on the first status call, downloading outputs and marking completed.
  await engine.getGenerationStatus(submitted.entity.id);

  return {
    engine,
    cleanup: stack.cleanup,
    workspaceId: ws.entity.id,
    projectId: proj.entity.id,
    sequenceId: seq.entity.id,
    shotId: shot.entity.id,
    versionId: submitted.entity.id,
  };
}

describe('Engine — typed event emission (D-WEBUI-29)', () => {
  let ctx: Ctx;
  afterEach(async () => {
    if (ctx) {
      await ctx.engine.stop();
      ctx.cleanup();
    }
  });

  it('engine.events is an EngineEmitter instance', async () => {
    ctx = await setup();
    expect(ctx.engine.events).toBeInstanceOf(EngineEmitter);
  });

  describe('version.created (3 paths)', () => {
    it('submitGeneration emits version.created with {version_id, shot_id, breadcrumb, at}', async () => {
      ctx = await setup();
      const received: VersionCreatedPayload[] = [];
      ctx.engine.events.onEvent('version.created', (p) => received.push(p));

      const result = await ctx.engine.submitGeneration(ctx.shotId, {
        '3': { class_type: 'KSampler', inputs: { seed: 99, steps: 10, cfg: 5 } },
      });

      expect(received).toHaveLength(1);
      const payload = received[0];
      expect(payload.version_id).toBe(result.entity.id);
      expect(payload.shot_id).toBe(ctx.shotId);
      expect(payload.breadcrumb).toContain('sh010'); // breadcrumb_text from resolver
      expect(payload.at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
    });

    it('reproduceVersion emits version.created', async () => {
      ctx = await setup();
      // ctx.versionId is a completed version — eligible for reproduce.
      const received: VersionCreatedPayload[] = [];
      ctx.engine.events.onEvent('version.created', (p) => received.push(p));

      const result = await ctx.engine.reproduceVersion(ctx.versionId, 'reproduce-note');

      expect(received).toHaveLength(1);
      expect(received[0].version_id).toBe(result.entity.id);
      expect(received[0].shot_id).toBe(ctx.shotId);
    });

    it('iterateFromVersion emits version.created', async () => {
      ctx = await setup();
      const received: VersionCreatedPayload[] = [];
      ctx.engine.events.onEvent('version.created', (p) => received.push(p));

      const result = await ctx.engine.iterateFromVersion(
        ctx.versionId,
        undefined,
        123,
        'iter-note',
      );

      expect(received).toHaveLength(1);
      expect(received[0].version_id).toBe(result.entity.id);
      expect(received[0].shot_id).toBe(ctx.shotId);
    });
  });

  describe('version.status_changed', () => {
    it('fires during getGenerationStatus completion path with status=completed', async () => {
      ctx = await setup();
      const received: VersionStatusChangedPayload[] = [];
      ctx.engine.events.onEvent('version.status_changed', (p) => received.push(p));

      // Submit a fresh version; initial row is 'submitted' (no status_change yet
      // for that — status_change fires on transitions, not on insert).
      const submitted = await ctx.engine.submitGeneration(ctx.shotId, {
        '3': { class_type: 'KSampler', inputs: { seed: 555, steps: 10, cfg: 5 } },
      });
      // Drive the status transition — FakeComfyUIClient completes immediately.
      await ctx.engine.getGenerationStatus(submitted.entity.id);

      // At minimum a 'completed' transition must fire. A 'running' transition
      // may also fire depending on the fake's cadence; accept both.
      const completed = received.find((r) => r.status === 'completed');
      expect(completed).toBeDefined();
      expect(completed!.version_id).toBe(submitted.entity.id);
      expect(completed!.shot_id).toBe(ctx.shotId);
      expect(completed!.breadcrumb).toContain('sh010');
    });
  });

  describe('tag.changed (2 paths)', () => {
    it('addTag emits tag.changed with action=add', async () => {
      ctx = await setup();
      const received: TagChangedPayload[] = [];
      ctx.engine.events.onEvent('tag.changed', (p) => received.push(p));

      ctx.engine.addTag(ctx.versionId, 'hero');

      expect(received).toHaveLength(1);
      expect(received[0].action).toBe('add');
      expect(received[0].version_id).toBe(ctx.versionId);
      expect(received[0].shot_id).toBe(ctx.shotId);
      expect(received[0].tag).toBe('hero');
    });

    it('removeTag emits tag.changed with action=remove', async () => {
      ctx = await setup();
      ctx.engine.addTag(ctx.versionId, 'villain'); // seed
      const received: TagChangedPayload[] = [];
      ctx.engine.events.onEvent('tag.changed', (p) => received.push(p));

      ctx.engine.removeTag(ctx.versionId, 'villain');

      expect(received).toHaveLength(1);
      expect(received[0].action).toBe('remove');
      expect(received[0].tag).toBe('villain');
      expect(received[0].version_id).toBe(ctx.versionId);
      expect(received[0].shot_id).toBe(ctx.shotId);
    });
  });

  describe('metadata.changed (2 paths)', () => {
    it('setMetadata emits metadata.changed with action=set and NO value field', async () => {
      ctx = await setup();
      const received: MetadataChangedPayload[] = [];
      ctx.engine.events.onEvent('metadata.changed', (p) => received.push(p));

      ctx.engine.setMetadata(ctx.versionId, 'artist', 'maya-lead');

      expect(received).toHaveLength(1);
      expect(received[0].action).toBe('set');
      expect(received[0].key).toBe('artist');
      expect(received[0].version_id).toBe(ctx.versionId);
      expect(received[0].shot_id).toBe(ctx.shotId);
      // T-5-02: value must never appear on the SSE payload.
      expect(received[0]).not.toHaveProperty('value');
    });

    it('removeMetadata emits metadata.changed with action=remove and NO value field', async () => {
      ctx = await setup();
      ctx.engine.setMetadata(ctx.versionId, 'artist', 'jane'); // seed
      const received: MetadataChangedPayload[] = [];
      ctx.engine.events.onEvent('metadata.changed', (p) => received.push(p));

      ctx.engine.removeMetadata(ctx.versionId, 'artist');

      expect(received).toHaveLength(1);
      expect(received[0].action).toBe('remove');
      expect(received[0].key).toBe('artist');
      expect(received[0]).not.toHaveProperty('value');
    });
  });

  describe('hierarchy.created (4 paths)', () => {
    let stackEngine: Engine;
    let stackCleanup: () => void;
    beforeEach(() => {
      const stack = buildStackWithOutputs();
      stackEngine = stack.engine;
      stackCleanup = stack.cleanup;
    });
    afterEach(async () => {
      await stackEngine.stop();
      stackCleanup();
    });

    it('createWorkspace emits hierarchy.created with entity_type=workspace, parent_id=null', () => {
      const received: HierarchyCreatedPayload[] = [];
      stackEngine.events.onEvent('hierarchy.created', (p) => received.push(p));

      const ws = stackEngine.createWorkspace('ws-test');

      expect(received).toHaveLength(1);
      expect(received[0].entity_type).toBe('workspace');
      expect(received[0].entity_id).toBe(ws.entity.id);
      expect(received[0].parent_id).toBeNull();
    });

    it('createProject emits hierarchy.created with entity_type=project, parent_id=workspace_id', () => {
      const ws = stackEngine.createWorkspace('ws-test');
      const received: HierarchyCreatedPayload[] = [];
      stackEngine.events.onEvent('hierarchy.created', (p) => received.push(p));

      const proj = stackEngine.createProject(ws.entity.id, 'p1');

      expect(received).toHaveLength(1);
      expect(received[0].entity_type).toBe('project');
      expect(received[0].entity_id).toBe(proj.entity.id);
      expect(received[0].parent_id).toBe(ws.entity.id);
    });

    it('createSequence emits hierarchy.created with entity_type=sequence, parent_id=project_id', () => {
      const ws = stackEngine.createWorkspace('ws-test');
      const proj = stackEngine.createProject(ws.entity.id, 'p1');
      const received: HierarchyCreatedPayload[] = [];
      stackEngine.events.onEvent('hierarchy.created', (p) => received.push(p));

      const seq = stackEngine.createSequence(proj.entity.id, 'sq010');

      expect(received).toHaveLength(1);
      expect(received[0].entity_type).toBe('sequence');
      expect(received[0].entity_id).toBe(seq.entity.id);
      expect(received[0].parent_id).toBe(proj.entity.id);
    });

    it('createShot emits hierarchy.created with entity_type=shot, parent_id=sequence_id', () => {
      const ws = stackEngine.createWorkspace('ws-test');
      const proj = stackEngine.createProject(ws.entity.id, 'p1');
      const seq = stackEngine.createSequence(proj.entity.id, 'sq010');
      const received: HierarchyCreatedPayload[] = [];
      stackEngine.events.onEvent('hierarchy.created', (p) => received.push(p));

      const shot = stackEngine.createShot(seq.entity.id, 'sh010');

      expect(received).toHaveLength(1);
      expect(received[0].entity_type).toBe('shot');
      expect(received[0].entity_id).toBe(shot.entity.id);
      expect(received[0].parent_id).toBe(seq.entity.id);
    });
  });
});
