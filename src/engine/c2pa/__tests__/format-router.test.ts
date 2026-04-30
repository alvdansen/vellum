import { describe, it, expect } from 'vitest';
import {
  routeFormat,
  EMBED_BUFFER_FORMATS,
  EMBED_FILE_FORMATS,
  UNSUPPORTED_NATIVE_FORMATS,
  type FormatRoute,
} from '../format-router.js';

/**
 * Phase 14 Plan 02 Task 1 — D-CTX-3 native-embed format routing (revised).
 *
 * Pure-function unit tests. Asserts the discriminated-union routing table
 * matches c2pa-node v0.5.26's API surface:
 *   - JPEG / PNG -> embed-buffer (c2pa-node buffer API)
 *   - MP4 / WebP / TIFF -> embed-file (c2pa-node file-path API)
 *   - EXR / PSD -> unsupported(native-handler-missing) — c2pa-rs has no handler
 *   - anything else -> unsupported(unknown-extension)
 *
 * Concern #2 scope reduction: NO `mode: 'sidecar'` exists in v1.1.
 */

describe('routeFormat — buffer-API formats (PNG/JPEG)', () => {
  it('Test 1: routeFormat(output.png) -> embed-buffer image/png', () => {
    expect(routeFormat('output.png')).toEqual({
      mode: 'embed-buffer',
      mimeType: 'image/png',
    });
  });

  it('Test 2: routeFormat(OUTPUT.PNG) is case-insensitive on extension', () => {
    expect(routeFormat('OUTPUT.PNG')).toEqual({
      mode: 'embed-buffer',
      mimeType: 'image/png',
    });
  });

  it('Test 3: routeFormat(photo.jpg) -> embed-buffer image/jpeg', () => {
    expect(routeFormat('photo.jpg')).toEqual({
      mode: 'embed-buffer',
      mimeType: 'image/jpeg',
    });
  });

  it('Test 4: routeFormat(photo.jpeg) alias -> embed-buffer image/jpeg', () => {
    expect(routeFormat('photo.jpeg')).toEqual({
      mode: 'embed-buffer',
      mimeType: 'image/jpeg',
    });
  });
});

describe('routeFormat — file-API formats (MP4/WebP/TIFF)', () => {
  it('Test 5: routeFormat(video.mp4) -> embed-file video/mp4', () => {
    expect(routeFormat('video.mp4')).toEqual({
      mode: 'embed-file',
      mimeType: 'video/mp4',
    });
  });

  it('Test 6: routeFormat(image.webp) -> embed-file image/webp', () => {
    expect(routeFormat('image.webp')).toEqual({
      mode: 'embed-file',
      mimeType: 'image/webp',
    });
  });

  it('Test 7: routeFormat(archive.tif) -> embed-file image/tiff', () => {
    expect(routeFormat('archive.tif')).toEqual({
      mode: 'embed-file',
      mimeType: 'image/tiff',
    });
  });

  it('Test 8: routeFormat(archive.tiff) alias -> embed-file image/tiff', () => {
    expect(routeFormat('archive.tiff')).toEqual({
      mode: 'embed-file',
      mimeType: 'image/tiff',
    });
  });
});

describe('routeFormat — unsupported (Concern #2 scope reduction)', () => {
  it('Test 9: routeFormat(frame.exr) -> unsupported native-handler-missing image/x-exr', () => {
    expect(routeFormat('frame.exr')).toEqual({
      mode: 'unsupported',
      reason: 'native-handler-missing',
      mimeType: 'image/x-exr',
    });
  });

  it('Test 10: routeFormat(layered.psd) -> unsupported native-handler-missing image/vnd.adobe.photoshop', () => {
    expect(routeFormat('layered.psd')).toEqual({
      mode: 'unsupported',
      reason: 'native-handler-missing',
      mimeType: 'image/vnd.adobe.photoshop',
    });
  });

  it('Test 11: routeFormat(unknown.xyz) -> unsupported unknown-extension', () => {
    expect(routeFormat('unknown.xyz')).toEqual({
      mode: 'unsupported',
      reason: 'unknown-extension',
    });
  });

  it('Test 12: routeFormat(no_extension) -> unsupported unknown-extension', () => {
    expect(routeFormat('no_extension')).toEqual({
      mode: 'unsupported',
      reason: 'unknown-extension',
    });
  });
});

describe('routeFormat — exported tables + discriminated-union exhaustiveness', () => {
  it('Test 13: EMBED_BUFFER_FORMATS / EMBED_FILE_FORMATS / UNSUPPORTED_NATIVE_FORMATS exported as readonly arrays of mimeType strings', () => {
    // Buffer table: 2 distinct MIME types (image/png, image/jpeg via .jpg + .jpeg).
    // Object.values surfaces image/jpeg twice for the two extensions; spec says
    // both extensions appear in the table — caller may dedupe if needed.
    expect(EMBED_BUFFER_FORMATS).toContain('image/png');
    expect(EMBED_BUFFER_FORMATS).toContain('image/jpeg');

    expect(EMBED_FILE_FORMATS).toContain('video/mp4');
    expect(EMBED_FILE_FORMATS).toContain('image/webp');
    expect(EMBED_FILE_FORMATS).toContain('image/tiff');

    expect(UNSUPPORTED_NATIVE_FORMATS).toContain('image/x-exr');
    expect(UNSUPPORTED_NATIVE_FORMATS).toContain('image/vnd.adobe.photoshop');

    // Each is a readonly array of strings.
    EMBED_BUFFER_FORMATS.forEach((m) => expect(typeof m).toBe('string'));
    EMBED_FILE_FORMATS.forEach((m) => expect(typeof m).toBe('string'));
    UNSUPPORTED_NATIVE_FORMATS.forEach((m) => expect(typeof m).toBe('string'));
  });

  it('Test 14: FormatRoute discriminated union has exactly 3 modes — embed-buffer / embed-file / unsupported (NO sidecar)', () => {
    // TypeScript exhaustiveness check via switch + `never` assertion. If a
    // future revision adds `mode: 'sidecar'` to the type, this function will
    // fail compilation — Concern #2 scope reduction is structurally locked.
    function exhaustive(route: FormatRoute): string {
      switch (route.mode) {
        case 'embed-buffer':
          return 'buffer';
        case 'embed-file':
          return 'file';
        case 'unsupported':
          return 'unsupported';
        default: {
          const _exhaustive: never = route;
          return _exhaustive;
        }
      }
    }
    // Smoke-call with each variant to lock the runtime contract.
    expect(exhaustive({ mode: 'embed-buffer', mimeType: 'image/png' })).toBe('buffer');
    expect(exhaustive({ mode: 'embed-file', mimeType: 'video/mp4' })).toBe('file');
    expect(
      exhaustive({ mode: 'unsupported', reason: 'unknown-extension' }),
    ).toBe('unsupported');
  });
});
