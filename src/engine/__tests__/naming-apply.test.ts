import { describe, test, expect } from 'vitest';
import { basename, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { nanoid } from 'nanoid';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { Engine } from '../pipeline.js';
import { TypedError } from '../errors.js';
import type { StoredOutput } from '../../comfyui/types.js';
import { publicLookup } from '../../test-utils/fake-dns.js';

/**
 * Hybrid-v1 naming applied at output-persist. Drives the real Engine +
 * registerExternalOutput. Auto-naming (no explicit filename) applies the
 * project's naming_template; an explicit filename always wins.
 *
 * The URL path exercises auto-naming: the ingest fetch is mocked and the source
 * URL carries a filename+extension the template can re-shape.
 */
const CDN = 'cdn.test';
function bytesRes(): Response {
  return new Response(new Uint8Array([1, 2, 3]) as unknown as BodyInit, {
    status: 200,
    headers: { 'content-type': 'image/png', 'content-length': '3' },
  });
}
function mockFetch(): typeof fetch {
  return (async () => bytesRes()) as unknown as typeof fetch;
}

function setup() {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const outputRoot = mkdtempSync(join(tmpdir(), `vellum-naming-${nanoid(6)}-`));
  const engine = new Engine(db, hierarchy, versions, provenanceRepo, null, outputRoot, {
    ingestAllowedHosts: [CDN],
    ingestFetchImpl: mockFetch(),
    ingestLookupImpl: publicLookup,
  });
  const ws = engine.createWorkspace('Demo Show');
  const proj = engine.createProject(ws.entity.id, 'DEMO01');
  const seq = engine.createSequence(proj.entity.id, 'SEQ010');
  const shot = engine.createShot(seq.entity.id, 'sh010');
  return { engine, projectId: proj.entity.id, shotId: shot.entity.id };
}

function storedNames(entity: { outputs_json: string | null }): string[] {
  const outs = JSON.parse(entity.outputs_json ?? '[]') as StoredOutput[];
  return outs.map((o) => basename(o.path));
}

describe('Hybrid-v1 naming at persist', () => {
  test('setProjectNamingTemplate throws for an unknown project', () => {
    const { engine } = setup();
    try {
      engine.setProjectNamingTemplate('proj_missing', '{shot}');
      expect.unreachable('should throw');
    } catch (err) {
      expect((err as TypedError).code).toBe('PROJECT_NOT_FOUND');
    }
  });

  test('an auto-named URL output uses the project template + slots', async () => {
    const { engine, projectId, shotId } = setup();
    engine.setProjectNamingTemplate(
      projectId,
      '{project}_{sequence}_{shot:upper}_{slot:element}_{slot:descriptor}_{version}_{slot:stage}',
    );
    const res = await engine.registerExternalOutput({
      shotId,
      providerId: 'google-ai-studio',
      // No filename → auto-named. The URL supplies the .png extension.
      outputs: [{ url: `https://${CDN}/render.png` }],
      namingSlots: { element: 'BG', descriptor: 'AtriumWide', stage: 'styled' },
    });
    expect(res.entity.status).toBe('completed');
    expect(storedNames(res.entity)).toEqual(['DEMO01_SEQ010_SH010_BG_AtriumWide_v001_styled.png']);
  });

  test('an explicit filename always wins over the template', async () => {
    const { engine, projectId, shotId } = setup();
    engine.setProjectNamingTemplate(projectId, '{project}_{shot}_{version}');
    const res = await engine.registerExternalOutput({
      shotId,
      providerId: 'byteplus',
      outputs: [{ url: `https://${CDN}/x.mp4`, filename: 'artist_hand_named.mp4' }],
    });
    expect(storedNames(res.entity)).toEqual(['artist_hand_named.mp4']);
  });

  test('with no template set, the URL-derived filename is kept', async () => {
    const { engine, shotId } = setup();
    const res = await engine.registerExternalOutput({
      shotId,
      providerId: 'fal',
      outputs: [{ url: `https://${CDN}/raw_fal_output.png` }],
    });
    expect(storedNames(res.entity)).toEqual(['raw_fal_output.png']);
  });

  test('clearing the template (null) restores raw naming', async () => {
    const { engine, projectId, shotId } = setup();
    engine.setProjectNamingTemplate(projectId, '{shot}_{version}');
    engine.setProjectNamingTemplate(projectId, null);
    const res = await engine.registerExternalOutput({
      shotId,
      providerId: 'fal',
      outputs: [{ url: `https://${CDN}/plain.png` }],
    });
    expect(storedNames(res.entity)).toEqual(['plain.png']);
  });
});
