import { describe, it, expect, afterEach } from 'vitest';
import { buildStackWithOutputs } from '../../test-utils/fixtures.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import { sanitizeRelativeSegment } from '../../utils/outputs.js';
import { TypedError } from '../errors.js';
import { MAX_WORKFLOW_BYTES } from '../../tools/shape.js';

/**
 * REGRESSION — the submit byte cap must apply to EVERY provider.
 *
 * shape.ts documented the cap as universal ("enforced in the engine-layer
 * workflow-format check so future REST adapters inherit the same guard"), but
 * it lived inside validateWorkflowFormat, which is wired as exactly one
 * provider's validator. A Replicate/FAL/BytePlus/Google submit carried no size
 * limit at all — and the request is persisted verbatim into the append-only
 * provenance record, so an agent could write an unbounded blob into SQLite on
 * every take.
 */

/** Stands in for a non-ComfyUI adapter: validates its own shape, not size. */
class PermissiveProvider extends FakeComfyUIClient {
  override validateRequest(): void {
    // A URL-provider adapter checks its own fields (version/input, prompt, …)
    // and has never had anything to say about payload size.
  }
}

function oversizedRequest(): Record<string, unknown> {
  // Comfortably past the cap once serialized.
  return { prompt: 'x'.repeat(MAX_WORKFLOW_BYTES + 1_000) };
}

describe('submit request byte cap', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups) c();
    cleanups.length = 0;
  });

  function seed(provider?: FakeComfyUIClient): { engine: ReturnType<typeof buildStackWithOutputs>['engine']; shotId: string; sqlite: import('better-sqlite3').Database } {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    if (provider) {
      (stack.engine as unknown as { client: FakeComfyUIClient }).client = provider;
      (stack.engine as unknown as { generation: { client: FakeComfyUIClient } }).generation.client =
        provider;
    }
    const ws = stack.engine.createWorkspace('ws1');
    const proj = stack.engine.createProject(ws.entity.id, 'p1');
    const seq = stack.engine.createSequence(proj.entity.id, 'sq010');
    const shot = stack.engine.createShot(seq.entity.id, 'sh010');
    return { engine: stack.engine, shotId: shot.entity.id, sqlite: stack.sqlite };
  }

  it('rejects an oversized request from a provider whose validator ignores size', async () => {
    const { engine, shotId } = seed(new PermissiveProvider());
    await expect(engine.submitGeneration(shotId, oversizedRequest())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('writes no version row and no provenance for a rejected request', async () => {
    const { engine, shotId, sqlite } = seed(new PermissiveProvider());
    await expect(engine.submitGeneration(shotId, oversizedRequest())).rejects.toThrow();

    const versions = sqlite.prepare('SELECT COUNT(*) AS n FROM versions').get() as { n: number };
    const events = sqlite.prepare('SELECT COUNT(*) AS n FROM provenance').get() as { n: number };
    // The cap runs before the row is inserted, so an oversized blob never
    // reaches the append-only record it would otherwise be persisted into.
    expect(versions.n).toBe(0);
    expect(events.n).toBe(0);
  });

  it('a normal request is unaffected', async () => {
    const { engine, shotId } = seed(new PermissiveProvider());
    await expect(
      engine.submitGeneration(shotId, { prompt: 'a watercolour interior' }),
    ).resolves.toBeDefined();
  });

  it('ComfyUI still gets its own shape-specific message first', async () => {
    const { engine, shotId } = seed(); // the default fake validates node-graph shape
    await expect(engine.submitGeneration(shotId, oversizedRequest())).rejects.toMatchObject({
      code: 'INVALID_WORKFLOW_FORMAT',
    });
  });
});

/**
 * REGRESSION — bidirectional control characters must not reach a path segment.
 *
 * They carry no meaning in a filename but reorder how one is DISPLAYED, so a
 * name can be made to read as something other than what it is. The names come
 * from an agent, so this is hostile input rather than a typo.
 */
describe('bidi control characters in names', () => {
  const RLO = '‮';
  const LRO = '‭';
  const ISOLATE = '⁦';

  it.each([
    ['right-to-left override', `invoice${RLO}gnp.exe`],
    ['left-to-right override', `shot${LRO}010`],
    ['isolate', `shot${ISOLATE}010`],
  ])('rejects a segment containing a %s', (_label, name) => {
    expect(() => sanitizeRelativeSegment(name)).toThrow(TypedError);
  });

  it('ordinary non-ASCII names are still fine', () => {
    // The rule targets control characters, not international text.
    expect(sanitizeRelativeSegment('Ünïcodé Shöt')).toBe('Ünïcodé Shöt');
    expect(sanitizeRelativeSegment('日本語')).toBe('日本語');
  });

  it('the engine refuses such a project name at creation', () => {
    const stack = buildStackWithOutputs();
    try {
      const ws = stack.engine.createWorkspace('ws1');
      expect(() => stack.engine.createProject(ws.entity.id, `Acme${RLO}Season`)).toThrow(
        TypedError,
      );
    } finally {
      stack.cleanup();
    }
  });
});
