import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolOk, toolError } from '../envelope.js';
import { TypedError } from '../../engine/errors.js';

describe('toolOk (D-25 dual-form response)', () => {
  it('wraps a simple object into structuredContent + content[text]', () => {
    const structured = { id: 'ws_abc', name: 'demo' };
    const res = toolOk(structured);

    expect(res.structuredContent).toEqual(structured);
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe('text');
    // Contract: JSON.parse(content[0].text) must deep-equal structuredContent.
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
  });

  it('wraps a nested entity+breadcrumb object and preserves structure in both forms', () => {
    const structured = {
      entity: { id: 'shot_xyz', name: 'sh010', sequence_id: 'seq_1', created_at: 123 },
      breadcrumb: [
        { type: 'workspace', id: 'ws_1', name: 'demo' },
        { type: 'project', id: 'proj_1', name: 'my-proj' },
        { type: 'sequence', id: 'seq_1', name: 'sq010' },
        { type: 'shot', id: 'shot_xyz', name: 'sh010' },
      ],
      breadcrumb_text: 'demo > my-proj > sq010 > sh010',
    };

    const res = toolOk(structured);

    expect(res.structuredContent).toEqual(structured);
    expect(JSON.parse(res.content[0].text)).toEqual(structured);
    // Nested breadcrumb round-trips correctly.
    expect(JSON.parse(res.content[0].text).breadcrumb).toHaveLength(4);
  });
});

describe('toolError (D-28 isError envelope, D-31 hint only when present)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('maps a TypedError WITH hint to isError:true + code/message/hint payload', () => {
    const err = new TypedError(
      'DUPLICATE_NAME',
      "Workspace 'demo' already exists",
      'Pick a different name',
    );

    const res = toolError(err);

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({
      code: 'DUPLICATE_NAME',
      message: "Workspace 'demo' already exists",
      hint: 'Pick a different name',
    });
    // Text form mirrors structured form.
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
    // spy should NOT have been called for a typed error.
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('maps a TypedError WITHOUT hint and omits the hint key entirely (D-31)', () => {
    const err = new TypedError('WORKSPACE_NOT_FOUND', "Workspace 'ws_xyz' not found");

    const res = toolError(err);

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({
      code: 'WORKSPACE_NOT_FOUND',
      message: "Workspace 'ws_xyz' not found",
    });
    // D-31: hint key is absent (not just undefined).
    expect(res.structuredContent).not.toHaveProperty('hint');
    // And same in the text-form mirror.
    expect(JSON.parse(res.content[0].text)).not.toHaveProperty('hint');
  });

  it('re-wraps a plain Error to INVALID_INPUT fallback without leaking raw message', () => {
    const err = new Error('raw js error detail that must not reach the agent');

    const res = toolError(err);

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({
      code: 'INVALID_INPUT',
      message: 'Unexpected internal error',
    });
    // Raw message must not leak.
    const wireForm = JSON.stringify(res);
    expect(wireForm).not.toContain('raw js error detail');
    // Stderr logging occurred (D-21).
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it('re-wraps a plain object to INVALID_INPUT fallback without leaking its fields', () => {
    // Note: use values that cannot collide with the canonical fallback message.
    const err = { some: 'plain-object-secret', detail: 'classified-detail-xyz' };

    const res = toolError(err);

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({
      code: 'INVALID_INPUT',
      message: 'Unexpected internal error',
    });
    const wireForm = JSON.stringify(res);
    expect(wireForm).not.toContain('plain-object-secret');
    expect(wireForm).not.toContain('classified-detail-xyz');
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it('re-wraps a string error to INVALID_INPUT fallback without leaking the string', () => {
    const err = 'string error with sensitive detail';

    const res = toolError(err);

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({
      code: 'INVALID_INPUT',
      message: 'Unexpected internal error',
    });
    const wireForm = JSON.stringify(res);
    expect(wireForm).not.toContain('string error with sensitive detail');
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it('re-wraps a SQLITE_CONSTRAINT error without leaking constraint details (D-13)', () => {
    const err = new Error('SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: workspaces.name');
    (err as Error & { code?: string }).code = 'SQLITE_CONSTRAINT_UNIQUE';

    const res = toolError(err);

    expect(res.isError).toBe(true);
    const wireForm = JSON.stringify(res);
    // D-13: defence in depth — raw SQLite error text never reaches the agent.
    expect(wireForm).not.toContain('SQLITE_CONSTRAINT');
    expect(wireForm).not.toContain('UNIQUE constraint failed');
    expect(wireForm).not.toContain('workspaces.name');
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it('dual-form envelope shape is identical for typed and untyped errors', () => {
    // Typed
    const typed = toolError(new TypedError('SHOT_NOT_FOUND', "Shot 'shot_xyz' not found"));
    expect(typed).toHaveProperty('isError', true);
    expect(typed).toHaveProperty('structuredContent');
    expect(typed.content[0].type).toBe('text');
    expect(JSON.parse(typed.content[0].text)).toEqual(typed.structuredContent);

    // Untyped
    const untyped = toolError(new Error('some raw error'));
    expect(untyped).toHaveProperty('isError', true);
    expect(untyped).toHaveProperty('structuredContent');
    expect(untyped.content[0].type).toBe('text');
    expect(JSON.parse(untyped.content[0].text)).toEqual(untyped.structuredContent);
  });
});
