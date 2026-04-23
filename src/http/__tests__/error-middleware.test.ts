import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { typedErrorHandler, statusForCode } from '../error-middleware.js';
import { TypedError } from '../../engine/errors.js';

describe('statusForCode', () => {
  const notFoundCodes = [
    'WORKSPACE_NOT_FOUND',
    'PROJECT_NOT_FOUND',
    'SEQUENCE_NOT_FOUND',
    'SHOT_NOT_FOUND',
    'VERSION_NOT_FOUND',
    'PARENT_NOT_FOUND',
    'PROVENANCE_UNAVAILABLE',
    'OUTPUT_UNAVAILABLE',
  ];
  const badRequestCodes = [
    'INVALID_INPUT',
    'INVALID_SHOT_FORMAT',
    'INVALID_WORKFLOW_FORMAT',
    'INVALID_SCOPE',
    'ITERATE_INVALID_PATCH',
    'TAG_INVALID',
    'METADATA_INVALID',
  ];
  const badGatewayCodes = [
    'COMFYUI_API_ERROR',
    'COMFYUI_CREDENTIALS_MISSING',
    'COMFYUI_RATE_LIMITED',
    'GENERATION_TIMEOUT',
    'DOWNLOAD_FAILED',
  ];
  const unprocessableCodes = [
    'REPRODUCE_BLOCKED',
    'VERSION_NOT_COMPLETED',
    'TAG_LIMIT_EXCEEDED',
    'METADATA_LIMIT_EXCEEDED',
  ];
  const conflictCodes = ['DUPLICATE_NAME', 'CONCURRENT_SUBMIT_CONFLICT'];

  it.each(notFoundCodes)('%s → 404', (code) => {
    expect(statusForCode(code)).toBe(404);
  });

  it.each(badRequestCodes)('%s → 400', (code) => {
    expect(statusForCode(code)).toBe(400);
  });

  it.each(badGatewayCodes)('%s → 502', (code) => {
    expect(statusForCode(code)).toBe(502);
  });

  it.each(unprocessableCodes)('%s → 422', (code) => {
    expect(statusForCode(code)).toBe(422);
  });

  it.each(conflictCodes)('%s → 409', (code) => {
    expect(statusForCode(code)).toBe(409);
  });

  it('unknown code → 500', () => {
    expect(statusForCode('SOMETHING_WEIRD')).toBe(500);
  });
});

describe('typedErrorHandler', () => {
  function buildContext(code: string, message: string) {
    const app = new Hono();
    app.onError(typedErrorHandler);
    app.get('/test', () => {
      throw new TypedError(code as never, message);
    });
    return app;
  }

  it('TypedError → correct status + structured JSON body', async () => {
    const app = buildContext('SHOT_NOT_FOUND', 'not found');
    const res = await app.request('/test');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: { code: 'SHOT_NOT_FOUND', message: 'not found' } });
  });

  it('unknown Error → 500 with INTERNAL_ERROR code', async () => {
    const app = new Hono();
    app.onError(typedErrorHandler);
    app.get('/test', () => {
      throw new Error('boom');
    });
    const res = await app.request('/test');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('response body has no stack field', async () => {
    const app = buildContext('INVALID_INPUT', 'bad');
    const res = await app.request('/test');
    const body = await res.json();
    expect(body.error.stack).toBeUndefined();
  });

  it('unknown TypedError code → 500 with original code preserved in body', async () => {
    const app = buildContext('SOME_FUTURE_CODE', 'future error');
    const res = await app.request('/test');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('SOME_FUTURE_CODE');
  });
});
