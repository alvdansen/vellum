import { describe, test, expect } from 'vitest';
import { loadProviderConfig, createProvider } from '../config.js';
import { ComfyUIClient } from '../../comfyui/client.js';
import { ReplicateAdapter } from '../replicate-adapter.js';

describe('loadProviderConfig — discovery', () => {
  test('discovers ComfyUI when COMFYUI_API_KEY is set', () => {
    const r = loadProviderConfig({ COMFYUI_API_KEY: 'k' });
    expect(r.providers.map((p) => p.id)).toEqual(['comfyui-cloud']);
    expect(r.defaultProviderId).toBe('comfyui-cloud');
  });

  test('discovers Replicate when REPLICATE_API_TOKEN is set', () => {
    const r = loadProviderConfig({ REPLICATE_API_TOKEN: 'r8_x' });
    expect(r.providers.map((p) => p.id)).toEqual(['replicate']);
    expect(r.defaultProviderId).toBe('replicate');
  });

  test('empty env -> no providers, null default', () => {
    const r = loadProviderConfig({});
    expect(r.providers).toHaveLength(0);
    expect(r.defaultProviderId).toBeNull();
  });

  test('carries apiBase overrides and allowlisted hosts', () => {
    const r = loadProviderConfig({
      REPLICATE_API_TOKEN: 'r8_x',
      REPLICATE_API_BASE: 'https://proxy.example.com',
      REPLICATE_ALLOWED_OUTPUT_HOSTS: 'cdn.example.com, mirror.example.com',
    });
    const cfg = r.providers[0];
    expect(cfg.apiBase).toBe('https://proxy.example.com');
    expect(cfg.additionalAllowedHosts).toEqual(['cdn.example.com', 'mirror.example.com']);
  });
});

describe('loadProviderConfig — default selection', () => {
  test('ComfyUI wins over Replicate when both configured and none chosen (back-compat)', () => {
    const r = loadProviderConfig({ COMFYUI_API_KEY: 'k', REPLICATE_API_TOKEN: 'r8_x' });
    expect(r.providers.map((p) => p.id).sort()).toEqual(['comfyui-cloud', 'replicate']);
    expect(r.defaultProviderId).toBe('comfyui-cloud');
  });

  test('DEFAULT_PROVIDER selects an explicit configured provider', () => {
    const r = loadProviderConfig({
      COMFYUI_API_KEY: 'k',
      REPLICATE_API_TOKEN: 'r8_x',
      DEFAULT_PROVIDER: 'replicate',
    });
    expect(r.defaultProviderId).toBe('replicate');
  });

  test('DEFAULT_PROVIDER for an unknown provider throws PROVIDER_MISCONFIGURED', () => {
    expect(() => loadProviderConfig({ COMFYUI_API_KEY: 'k', DEFAULT_PROVIDER: 'midjourney' })).toThrowError(
      /PROVIDER_MISCONFIGURED|not a known provider/,
    );
  });

  test('DEFAULT_PROVIDER without credentials throws PROVIDER_MISCONFIGURED', () => {
    expect(() => loadProviderConfig({ COMFYUI_API_KEY: 'k', DEFAULT_PROVIDER: 'replicate' })).toThrowError(
      /no credentials are configured/,
    );
  });
});

describe('createProvider — factory', () => {
  test('builds a ComfyUIClient for comfyui-cloud', () => {
    const p = createProvider({ id: 'comfyui-cloud', apiKey: 'k', apiBase: 'https://cloud.comfy.org' });
    expect(p).toBeInstanceOf(ComfyUIClient);
    expect(p.id).toBe('comfyui-cloud');
  });

  test('builds a ReplicateAdapter for replicate', () => {
    const p = createProvider({ id: 'replicate', apiKey: 'r8_x', apiBase: 'https://api.replicate.com' });
    expect(p).toBeInstanceOf(ReplicateAdapter);
    expect(p.id).toBe('replicate');
  });

  test('throws PROVIDER_MISCONFIGURED for an unknown id', () => {
    expect(() => createProvider({ id: 'nope', apiKey: 'x', apiBase: 'https://x' })).toThrowError(
      /Unknown provider/,
    );
  });
});
