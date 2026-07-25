import { describe, test, expect } from 'vitest';
import {
  hexToRgb,
  rgbToHex,
  channelDeltas,
  maxChannelDelta,
  checkPaletteCompliance,
  DEFAULT_PER_CHANNEL_TOLERANCE,
  type SampledColor,
} from '../palette.js';

describe('hex/rgb conversion', () => {
  test('parses #RRGGBB, RRGGBB, and #RGB', () => {
    expect(hexToRgb('#1a2b3c')).toEqual({ r: 0x1a, g: 0x2b, b: 0x3c });
    expect(hexToRgb('1A2B3C')).toEqual({ r: 26, g: 43, b: 60 });
    expect(hexToRgb('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });
  test('rejects garbage', () => {
    expect(hexToRgb('#12')).toBeNull();
    expect(hexToRgb('nope')).toBeNull();
    expect(hexToRgb('#gggggg')).toBeNull();
  });
  test('rgbToHex round-trips and clamps', () => {
    expect(rgbToHex({ r: 26, g: 43, b: 60 })).toBe('#1a2b3c');
    expect(rgbToHex({ r: -5, g: 300, b: 128 })).toBe('#00ff80');
  });
});

describe('deltas', () => {
  test('channel + max delta', () => {
    const a = { r: 100, g: 100, b: 100 };
    const b = { r: 110, g: 90, b: 100 };
    expect(channelDeltas(a, b)).toEqual({ r: 10, g: 10, b: 0 });
    expect(maxChannelDelta(a, b)).toBe(10);
  });
});

function sc(hex: string, proportion: number): SampledColor {
  return { rgb: hexToRgb(hex)!, proportion };
}

describe('checkPaletteCompliance', () => {
  const palette = ['#101820', '#c8b89e', '#7a5c3e']; // near-black, warm cream, wood brown

  test('all sampled colors within tolerance → pass', () => {
    const sampled = [sc('#111a22', 0.5), sc('#c6b69c', 0.5)]; // small deltas
    const rep = checkPaletteCompliance(sampled, palette, { perChannelTolerance: 12 });
    expect(rep.pass).toBe(true);
    expect(rep.offenders).toHaveLength(0);
    expect(rep.matches[0]!.nearestReferenceHex).toBe('#101820');
    expect(rep.matches[0]!.withinTolerance).toBe(true);
  });

  test('a rogue significant color outside tolerance → fail + offender', () => {
    const sampled = [sc('#111a22', 0.6), sc('#ff0000', 0.4)]; // red not in palette
    const rep = checkPaletteCompliance(sampled, palette, { perChannelTolerance: 12 });
    expect(rep.pass).toBe(false);
    expect(rep.offenders).toHaveLength(1);
    expect(rep.offenders[0]!.sampledHex).toBe('#ff0000');
    expect(rep.offenders[0]!.maxDelta).toBeGreaterThan(12);
  });

  test('a tiny out-of-tolerance color below minProportion does not fail the shot', () => {
    const sampled = [sc('#111a22', 0.98), sc('#ff0000', 0.01)]; // 1% red < 2% default
    const rep = checkPaletteCompliance(sampled, palette, { perChannelTolerance: 12, minProportion: 0.02 });
    expect(rep.pass).toBe(true);
    expect(rep.offenders).toHaveLength(0);
  });

  test('tolerance boundary is inclusive', () => {
    // exactly 12 off on one channel
    const sampled = [sc('#101820', 0.5).rgb ? { rgb: { r: 0x10 + 12, g: 0x18, b: 0x20 }, proportion: 0.5 } : sc('#101820', 0.5)];
    const rep = checkPaletteCompliance(sampled, palette, { perChannelTolerance: 12 });
    expect(rep.matches[0]!.maxDelta).toBe(12);
    expect(rep.matches[0]!.withinTolerance).toBe(true);
  });

  test('a blank/empty image (no sampled colors) does not pass', () => {
    const rep = checkPaletteCompliance([], palette);
    expect(rep.pass).toBe(false);
    expect(rep.matches).toHaveLength(0);
  });

  test('an image whose only colors are all sub-threshold does not pass', () => {
    // every sampled color below minProportion → no significant evidence → not pass
    const rep = checkPaletteCompliance([sc('#111a22', 0.005), sc('#c6b69c', 0.004)], palette, { minProportion: 0.02 });
    expect(rep.pass).toBe(false);
  });

  test('empty palette never passes a non-empty image', () => {
    const rep = checkPaletteCompliance([sc('#111a22', 1)], []);
    expect(rep.pass).toBe(false);
    expect(rep.matches[0]!.nearestReferenceHex).toBeNull();
    expect(rep.matches[0]!.withinTolerance).toBe(false);
  });

  test('unparseable reference entries are ignored', () => {
    const rep = checkPaletteCompliance([sc('#111a22', 1)], ['not-a-hex', '#101820']);
    expect(rep.pass).toBe(true); // matched the one valid reference
  });

  test('default tolerance constant is the band midpoint', () => {
    expect(DEFAULT_PER_CHANNEL_TOLERANCE).toBe(12);
  });
});
