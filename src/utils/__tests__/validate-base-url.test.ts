import { describe, test, expect } from 'vitest';
import { validateBaseUrl } from '../validate-base-url.js';

/**
 * IS-02: COMFYUI_API_BASE validator.
 */
describe('validateBaseUrl (IS-02)', () => {
  test('accepts the default https://cloud.comfy.org', () => {
    const url = validateBaseUrl('https://cloud.comfy.org');
    expect(url.hostname).toBe('cloud.comfy.org');
  });

  test('accepts any valid https:// origin by default', () => {
    expect(() => validateBaseUrl('https://tenant.example.com')).not.toThrow();
  });

  test('rejects malformed URLs', () => {
    expect(() => validateBaseUrl('not a url')).toThrow(/not a valid URL/i);
  });

  test('rejects http:// by default (cleartext key leak)', () => {
    expect(() => validateBaseUrl('http://cloud.comfy.org')).toThrow(
      /cleartext|https/i,
    );
  });

  test('allows http:// when allowHttp=true', () => {
    expect(() =>
      validateBaseUrl('http://localhost:8188', { allowHttp: true, allowPrivate: true }),
    ).not.toThrow();
  });

  test('rejects non-http(s) protocols', () => {
    expect(() => validateBaseUrl('ftp://example.com')).toThrow(/http/i);
    expect(() => validateBaseUrl('file:///etc/passwd')).toThrow(/http/i);
  });

  test.each([
    'https://localhost',
    'https://127.0.0.1',
    'https://127.0.0.5',
    'https://169.254.169.254',
    'https://10.0.0.1',
    'https://10.255.255.255',
    'https://192.168.1.1',
    'https://172.16.0.1',
    'https://172.31.255.255',
    'https://[::1]',
    'https://[fe80::1]',
  ])('rejects private host %s by default', (raw) => {
    expect(() => validateBaseUrl(raw)).toThrow(/private|loopback|RFC1918|link-local/i);
  });

  test('172.15.x is NOT rejected (outside 172.16-31 block)', () => {
    expect(() => validateBaseUrl('https://172.15.0.1')).not.toThrow();
  });

  test('172.32.x is NOT rejected (outside 172.16-31 block)', () => {
    expect(() => validateBaseUrl('https://172.32.0.1')).not.toThrow();
  });

  test('allows private hosts when allowPrivate=true', () => {
    expect(() =>
      validateBaseUrl('https://127.0.0.1:9000', { allowPrivate: true }),
    ).not.toThrow();
    expect(() =>
      validateBaseUrl('https://192.168.1.1', { allowPrivate: true }),
    ).not.toThrow();
  });
});
