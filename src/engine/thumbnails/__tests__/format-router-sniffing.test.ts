// src/engine/thumbnails/__tests__/format-router-sniffing.test.ts
//
// The extension table in format-router.ts is ROUTING, not a security boundary.
//
// This distinction matters because it is the argument someone reaches for when a
// libvips decoder CVE lands: "we only accept PNG/JPEG/WebP/TIFF, so the GIF and
// VIPS loaders are unreachable." That is false. libvips selects its decoder by
// sniffing content, and image-thumbnail.ts calls sharp(path) with no options and
// no magic-byte pre-check — so a file's NAME decides only which branch of the
// router it takes, never which decoder ultimately reads it.
//
// The bytes in question are not first-party: they are provider-delivered
// generation outputs, or assets fetched from a caller-supplied ingest URL on an
// allowlisted host anyone can write to. Nothing upstream constrains file
// CONTENT — the byte cap, the https check and the SSRF guards are all about
// where bytes came from, not what they are.
//
// So this test exists to make the claim un-arguable and to keep it that way. The
// real defence is keeping sharp current (see SECURITY.md), not this table.
//
// Honest scope note — these are DOCUMENTATION tests, not regression tests. The
// commit that added them changed format-router.ts by comment only, so they pass
// against the code before it as well as after. What they guard is the reasoning:
// the next person to argue "the extension table already restricts the decoders"
// has to delete a passing test to do it. Only the libvips-floor assertion below
// can fail on a real change, and it is the one that matters if a lockfile ever
// walks sharp backwards.

import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeFormat } from '../format-router.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  dirs.length = 0;
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'vellum-sniff-'));
  dirs.push(d);
  return d;
}

/** A real 2x2 GIF89a, produced by sharp itself so it is genuinely well-formed. */
const GIF_BYTES = Buffer.from(
  '474946383961020002008000004c697101020321f90405000000002c00000000020002000002028c53003b',
  'hex',
);

describe('the thumbnail extension table does not constrain the decoder', () => {
  test('GIF bytes named .png route as an image and decode with the GIF loader', async () => {
    const dir = tmp();
    const disguised = join(dir, 'evil.png');
    writeFileSync(disguised, GIF_BYTES);

    // The router sees only the extension, so it says "image".
    expect(routeFormat('evil.png')).toMatchObject({ mode: 'image', mimeType: 'image/png' });

    // libvips then sniffs, and reaches a loader the table appears to exclude.
    const sharp = (await import('sharp')).default;
    const meta = await sharp(disguised).metadata();
    expect(meta.format).toBe('gif');
  });

  test('the router reports the extension mime type, not the real one', async () => {
    // Nothing downstream should treat routeFormat's mimeType as a statement
    // about content — it is derived purely from the filename.
    const dir = tmp();
    const disguised = join(dir, 'take.jpg');
    writeFileSync(disguised, GIF_BYTES);

    const route = routeFormat('take.jpg');
    expect(route).toMatchObject({ mode: 'image', mimeType: 'image/jpeg' });

    const sharp = (await import('sharp')).default;
    expect((await sharp(disguised).metadata()).format).toBe('gif');
  });

  test('the shipped sharp build exposes the loaders the table appears to exclude', async () => {
    // If a future prebuild drops them the premise changes, so assert it rather
    // than assuming it.
    const sharp = (await import('sharp')).default;
    expect(sharp.format.gif.input.file).toBe(true);
    expect(sharp.format.tiff.input.file).toBe(true);
  });
});

describe('libvips stays current', () => {
  test('the bundled libvips is at least 8.18 (the version that fixed the 0.34 CVEs)', async () => {
    // sharp <0.35.0 shipped libvips 8.17.x, which carried CVE-2026-33327 /
    // -33328 / -35590 in the GIF, TIFF and VIPS loaders — all reachable via the
    // sniffing proved above. A lockfile churn that walks sharp back should fail
    // loudly here rather than silently reintroducing them.
    const sharp = (await import('sharp')).default;
    const [major, minor] = sharp.versions.vips.split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(8);
    if (major === 8) expect(minor).toBeGreaterThanOrEqual(18);
  });
});
