// src/utils/__tests__/env.test.ts
//
// REGRESSION — an empty env var means "unset", not "".
//
// `.env` files are copies of `.env.example` with some blanks filled in, so a key
// left as `FOO=` means "I did not set this" to whoever wrote it.
// `process.env.FOO ?? fallback` disagrees: '' is not nullish, so the fallback
// never applies and the empty string flows into config as a real value.
//
// That was not theoretical. `COMFYUI_API_BASE=` gave `apiBase = ''`, which the
// base-URL validator rejected with a FATAL BOOT ERROR — so following the
// README's own quickstart (`cp .env.example .env`) stopped the server from
// starting at all. The same shape silently broke the GOOGLE_AI_STUDIO_API_KEY →
// GEMINI_API_KEY alias and pointed the C2PA certificate allowlist root at ''.

import { describe, test, expect } from 'vitest';
import { envValue, envList } from '../env.js';
import { loadProviderConfig } from '../../providers/config.js';

describe('envValue', () => {
  test('treats undefined, empty and whitespace-only as unset', () => {
    expect(envValue(undefined)).toBeUndefined();
    expect(envValue('')).toBeUndefined();
    expect(envValue('   ')).toBeUndefined();
    expect(envValue('\t\n ')).toBeUndefined();
  });

  test('returns a real value, trimmed', () => {
    expect(envValue('x')).toBe('x');
    expect(envValue('  https://example.test  ')).toBe('https://example.test');
  });

  test('composes with ?? so the caller gets its default', () => {
    expect(envValue('') ?? 'fallback').toBe('fallback');
    expect(envValue('set') ?? 'fallback').toBe('set');
  });
});

describe('envList', () => {
  test('empty and separator-only inputs yield no entries', () => {
    for (const raw of [undefined, '', '   ', ',', ' , , ']) {
      expect(envList(raw), JSON.stringify(raw)).toEqual([]);
    }
  });

  test('trims entries and drops blanks', () => {
    expect(envList(' a.test , ,b.test ')).toEqual(['a.test', 'b.test']);
  });
});

describe('provider config with blank-but-present variables', () => {
  // This is the shape a copied .env produces if any line is left uncommented.
  test('a blank API base falls back to the default instead of becoming ""', () => {
    const reg = loadProviderConfig({
      COMFYUI_API_KEY: 'ck_test',
      COMFYUI_API_BASE: '',
      REPLICATE_API_TOKEN: 'r8_test',
      REPLICATE_API_BASE: '   ',
    });
    for (const p of reg.providers) {
      expect(p.apiBase, `provider ${p.id}`).not.toBe('');
      expect(p.apiBase, `provider ${p.id}`).toMatch(/^https:\/\//);
    }
  });

  test('a blank GOOGLE_AI_STUDIO_API_KEY still lets GEMINI_API_KEY apply', () => {
    // `a ?? b` never reaches b when a is '', so the documented alias silently
    // stopped working the moment the primary name was present-but-blank.
    const reg = loadProviderConfig({
      GOOGLE_AI_STUDIO_API_KEY: '',
      GEMINI_API_KEY: 'gem_test',
    });
    expect(reg.providers.map((p) => p.id)).toContain('google-ai-studio');
  });

  test('a blank DEFAULT_PROVIDER is not treated as a requested provider', () => {
    const reg = loadProviderConfig({ COMFYUI_API_KEY: 'ck_test', DEFAULT_PROVIDER: '   ' });
    expect(reg.defaultProviderId).toBe('comfyui-cloud');
  });

  test('blank credentials configure no provider at all', () => {
    const reg = loadProviderConfig({
      COMFYUI_API_KEY: '',
      REPLICATE_API_TOKEN: '',
      FAL_KEY: '',
      BYTEPLUS_API_KEY: '',
      GOOGLE_AI_STUDIO_API_KEY: '',
      GEMINI_API_KEY: '',
    });
    expect(reg.providers).toEqual([]);
    expect(reg.defaultProviderId).toBeNull();
  });
});

