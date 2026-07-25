/**
 * Palette QC automation. Dominant colors sampled from a shot's images are
 * checked against a per-scene reference palette within a per-channel tolerance
 * (±10–15 / channel). This module is the PURE color-math
 * core — hex/rgb conversion + tolerance comparison + a compliance report — with
 * ZERO IO/sharp dependency, so it is exhaustively unit-testable. The pixel
 * sampling (sharp) lives in scripts/palette-qc.mts, which feeds sampled colors
 * into `checkPaletteCompliance` here.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A color sampled from an image, with how much of the frame it covers (0..1). */
export interface SampledColor {
  rgb: Rgb;
  /** Fraction of sampled pixels this color represents (for weighting/reporting). */
  proportion: number;
}

/** Parse '#RRGGBB' / 'RRGGBB' / '#RGB' → Rgb, or null when unparseable. */
export function hexToRgb(hex: string): Rgb | null {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Rgb → '#rrggbb' (lowercase). */
export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const h = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Per-channel absolute deltas between two colors. */
export function channelDeltas(a: Rgb, b: Rgb): Rgb {
  return { r: Math.abs(a.r - b.r), g: Math.abs(a.g - b.g), b: Math.abs(a.b - b.b) };
}

/** The largest single-channel delta — the metric the ±N/channel tolerance gates. */
export function maxChannelDelta(a: Rgb, b: Rgb): number {
  const d = channelDeltas(a, b);
  return Math.max(d.r, d.g, d.b);
}

/** Default per-channel tolerance — the ±10–15 band midpoint. */
export const DEFAULT_PER_CHANNEL_TOLERANCE = 12;

export interface ColorMatch {
  /** The sampled color. */
  sampled: Rgb;
  sampledHex: string;
  proportion: number;
  /** Nearest reference palette color (by max-channel delta), or null if palette empty. */
  nearestReferenceHex: string | null;
  /** Max single-channel delta to the nearest reference. */
  maxDelta: number;
  perChannelDelta: Rgb | null;
  /** Within the per-channel tolerance of some reference color. */
  withinTolerance: boolean;
}

export interface PaletteComplianceReport {
  perChannelTolerance: number;
  referenceHexes: string[];
  matches: ColorMatch[];
  /** True when EVERY significant sampled color is within tolerance of a reference. */
  pass: boolean;
  /** Sampled colors (>= minProportion) that failed — the "rogue" colors to review. */
  offenders: ColorMatch[];
}

export interface PaletteCheckOptions {
  perChannelTolerance?: number;
  /**
   * Ignore sampled colors below this frame coverage when deciding pass/fail — a
   * stray anti-aliased pixel shouldn't fail a shot. Default 0.02 (2%).
   */
  minProportion?: number;
}

/**
 * Compare an image's sampled colors against a scene reference palette. For each
 * sampled color, find the nearest reference (by max single-channel delta) and
 * flag whether it is within tolerance. The shot PASSES when every sampled color
 * above `minProportion` is within tolerance of some reference — i.e. no rogue
 * colors outside the scene palette.
 */
export function checkPaletteCompliance(
  sampled: SampledColor[],
  referenceHexes: string[],
  opts: PaletteCheckOptions = {},
): PaletteComplianceReport {
  const perChannelTolerance = opts.perChannelTolerance ?? DEFAULT_PER_CHANNEL_TOLERANCE;
  const minProportion = opts.minProportion ?? 0.02;

  // Parse references once; drop unparseable entries (reported via referenceHexes echo).
  const references = referenceHexes
    .map((hex) => ({ hex, rgb: hexToRgb(hex) }))
    .filter((x): x is { hex: string; rgb: Rgb } => x.rgb !== null);

  const matches: ColorMatch[] = sampled.map((s) => {
    let nearest: { hex: string; rgb: Rgb } | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const ref of references) {
      const d = maxChannelDelta(s.rgb, ref.rgb);
      if (d < best) {
        best = d;
        nearest = ref;
      }
    }
    return {
      sampled: s.rgb,
      sampledHex: rgbToHex(s.rgb),
      proportion: s.proportion,
      nearestReferenceHex: nearest?.hex ?? null,
      maxDelta: nearest ? best : Number.POSITIVE_INFINITY,
      perChannelDelta: nearest ? channelDeltas(s.rgb, nearest.rgb) : null,
      withinTolerance: nearest != null && best <= perChannelTolerance,
    };
  });

  const significant = matches.filter((m) => m.proportion >= minProportion);
  const offenders = significant.filter((m) => !m.withinTolerance);

  return {
    perChannelTolerance,
    referenceHexes,
    matches,
    // Pass requires: a non-empty reference palette, at least one significant
    // sampled color (a blank / all-transparent image with nothing sampled must
    // NOT pass — there is no evidence it matches), and zero offenders.
    pass: references.length > 0 && significant.length > 0 && offenders.length === 0,
    offenders,
  };
}
