import { describe, it, expect } from 'vitest';
import { routeFormat, type FormatRoute } from '../format-router.js';

/**
 * Phase 17 / Plan 17-01 Task 1 — pure thumbnail format-router unit tests.
 *
 * Discriminated-union routing table:
 *   - PNG / JPEG / JPG / WebP / TIF / TIFF -> { mode: 'image', mimeType }
 *   - MP4 -> { mode: 'video', mimeType }
 *   - anything else (EXR / PSD / unknown / no-ext) ->
 *       { mode: 'unsupported', reason: 'unknown-extension' }
 *
 * Mirrors the c2pa/format-router test shape — numbered tests, full
 * `toEqual()` against the discriminated-union object.
 */

describe('Plan 17-01 Task 1 — routeFormat: image extensions', () => {
  it('Test 1: routeFormat(output.png) -> image image/png', () => {
    expect(routeFormat('output.png')).toEqual({
      mode: 'image',
      mimeType: 'image/png',
    });
  });

  it('Test 2: routeFormat(OUTPUT.PNG) is case-insensitive', () => {
    expect(routeFormat('OUTPUT.PNG')).toEqual({
      mode: 'image',
      mimeType: 'image/png',
    });
  });

  it('Test 3: routeFormat(photo.jpg) -> image image/jpeg', () => {
    expect(routeFormat('photo.jpg')).toEqual({
      mode: 'image',
      mimeType: 'image/jpeg',
    });
  });

  it('Test 4: routeFormat(photo.jpeg) alias -> image image/jpeg', () => {
    expect(routeFormat('photo.jpeg')).toEqual({
      mode: 'image',
      mimeType: 'image/jpeg',
    });
  });

  it('Test 5: routeFormat(image.webp) -> image image/webp', () => {
    expect(routeFormat('image.webp')).toEqual({
      mode: 'image',
      mimeType: 'image/webp',
    });
  });

  it('Test 6: routeFormat(archive.tif) -> image image/tiff', () => {
    expect(routeFormat('archive.tif')).toEqual({
      mode: 'image',
      mimeType: 'image/tiff',
    });
  });

  it('Test 7: routeFormat(archive.tiff) alias -> image image/tiff', () => {
    expect(routeFormat('archive.tiff')).toEqual({
      mode: 'image',
      mimeType: 'image/tiff',
    });
  });

  it('Test 8: routeFormat(MIXED.JpEg) is case-insensitive (mixed case)', () => {
    expect(routeFormat('MIXED.JpEg')).toEqual({
      mode: 'image',
      mimeType: 'image/jpeg',
    });
  });
});

describe('Plan 17-01 Task 1 — routeFormat: video extensions', () => {
  it('Test 9: routeFormat(render.mp4) -> video video/mp4', () => {
    expect(routeFormat('render.mp4')).toEqual({
      mode: 'video',
      mimeType: 'video/mp4',
    });
  });

  it('Test 10: routeFormat(RENDER.MP4) is case-insensitive', () => {
    expect(routeFormat('RENDER.MP4')).toEqual({
      mode: 'video',
      mimeType: 'video/mp4',
    });
  });
});

describe('Plan 17-01 Task 1 — routeFormat: unsupported / unknown', () => {
  it('Test 11: routeFormat(file.exr) -> unsupported unknown-extension (v1.2 collapses EXR)', () => {
    expect(routeFormat('file.exr')).toEqual({
      mode: 'unsupported',
      reason: 'unknown-extension',
    });
  });

  it('Test 12: routeFormat(layered.psd) -> unsupported unknown-extension (v1.2 collapses PSD)', () => {
    expect(routeFormat('layered.psd')).toEqual({
      mode: 'unsupported',
      reason: 'unknown-extension',
    });
  });

  it('Test 13: routeFormat(noextension) -> unsupported unknown-extension', () => {
    expect(routeFormat('noextension')).toEqual({
      mode: 'unsupported',
      reason: 'unknown-extension',
    });
  });

  it('Test 14: routeFormat(unknown.xyz) -> unsupported unknown-extension', () => {
    expect(routeFormat('unknown.xyz')).toEqual({
      mode: 'unsupported',
      reason: 'unknown-extension',
    });
  });

  it('Test 15: routeFormat(empty string) -> unsupported unknown-extension', () => {
    expect(routeFormat('')).toEqual({
      mode: 'unsupported',
      reason: 'unknown-extension',
    });
  });
});

describe('Plan 17-01 Task 1 — routeFormat: discriminated-union exhaustiveness', () => {
  it('Test 16: FormatRoute discriminated union has exactly 3 modes — image / video / unsupported', () => {
    // TypeScript exhaustiveness check via switch + `never` assertion. If a
    // future revision adds a new mode, this function fails compilation.
    function exhaustive(route: FormatRoute): string {
      switch (route.mode) {
        case 'image':
          return 'image';
        case 'video':
          return 'video';
        case 'unsupported':
          return 'unsupported';
        default: {
          const _exhaustive: never = route;
          return _exhaustive;
        }
      }
    }
    expect(exhaustive({ mode: 'image', mimeType: 'image/png' })).toBe('image');
    expect(exhaustive({ mode: 'video', mimeType: 'video/mp4' })).toBe('video');
    expect(
      exhaustive({ mode: 'unsupported', reason: 'unknown-extension' }),
    ).toBe('unsupported');
  });
});
