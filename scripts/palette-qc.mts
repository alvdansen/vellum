/**
 * palette-qc — per-scene palette QC automation. Checks a scene's shot images against a
 * reference palette within a per-channel tolerance (default ±12) and writes a
 * per-scene "hex sheet" markdown report, replacing the hand-sampled QC pass.
 *
 * The pixel sampling uses sharp (allowed here — scripts/ is outside the src/
 * sole-importer rule); the color comparison uses the pure src/engine/palette.ts
 * core. Dominant colors are extracted by downscaling and histogramming quantized
 * pixels (a cheap top-N without a k-means dependency).
 *
 * Usage:
 *   npx tsx scripts/palette-qc.mts <config.json> [--out report.md] [--tolerance 12]
 *
 * config.json:
 *   {
 *     "scene": "SEQ010",
 *     "palette": ["#101820", "#c8b89e", "#7a5c3e"],   // reference hex values
 *     "tolerance": 12,                                  // optional, per-channel
 *     "images": [ { "label": "sh010 v003", "path": "…png" }, … ]  // paths rel. to config
 *   }
 */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import {
  checkPaletteCompliance,
  DEFAULT_PER_CHANNEL_TOLERANCE,
  type SampledColor,
} from '../src/engine/palette.js';

const ConfigSchema = z.object({
  scene: z.string().min(1).max(200),
  palette: z.array(z.string()).min(1),
  tolerance: z.number().positive().max(255).optional(),
  minProportion: z.number().min(0).max(1).optional(),
  images: z
    .array(z.object({ label: z.string().min(1), path: z.string().min(1) }))
    .min(1),
});
type Config = z.infer<typeof ConfigSchema>;

/**
 * Extract the dominant colors from an image: downscale, read raw RGB, bucket by a
 * quantized key for grouping BUT accumulate the true pixel sum per bucket so the
 * reported color is the bucket's actual MEAN (not the quantized center — that
 * bias could flip a pass/fail verdict at the tolerance boundary). Returns every
 * bucket whose frame share is >= `floor` (so a significant rogue color is never
 * dropped by a fixed top-N cap), capped at a generous 64 for safety.
 * Fully-transparent pixels are skipped.
 */
async function extractDominantColors(imagePath: string, floor = 0.01, step = 16): Promise<SampledColor[]> {
  const { data, info } = await sharp(imagePath)
    .resize(64, 64, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels; // 4 (RGBA) after ensureAlpha
  const q = (v: number) => Math.min(255, Math.round(v / step) * step);
  const hist = new Map<string, { sr: number; sg: number; sb: number; n: number }>();
  let total = 0;
  for (let i = 0; i < data.length; i += channels) {
    const a = channels >= 4 ? data[i + 3]! : 255;
    if (a === 0) continue; // skip fully transparent
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key = `${q(r)},${q(g)},${q(b)}`;
    const e = hist.get(key) ?? { sr: 0, sg: 0, sb: 0, n: 0 };
    e.sr += r;
    e.sg += g;
    e.sb += b;
    e.n++;
    hist.set(key, e);
    total++;
  }
  if (total === 0) return [];
  return [...hist.values()]
    .sort((a, b) => b.n - a.n)
    .filter((e) => e.n / total >= floor)
    .slice(0, 64)
    .map((e) => ({
      rgb: { r: Math.round(e.sr / e.n), g: Math.round(e.sg / e.n), b: Math.round(e.sb / e.n) },
      proportion: e.n / total,
    }));
}

/** Sanitize an operator-supplied label for a markdown table cell (pipe + newline). */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/[\r\n\u2028\u2029]/g, ' ');
}

function parseArgs(argv: string[]): { config: string; out?: string; tolerance?: number } {
  const positional: string[] = [];
  let out: string | undefined;
  let tolerance: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out = argv[++i];
    else if (a === '--tolerance') tolerance = Number(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 1) throw new Error('Usage: palette-qc <config.json> [--out report.md] [--tolerance N]');
  return { config: positional[0]!, out, tolerance };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configAbs = path.resolve(args.config);
  if (!existsSync(configAbs)) throw new Error(`Config not found: ${configAbs}`);
  const dir = path.dirname(configAbs);
  let config: Config;
  try {
    config = ConfigSchema.parse(JSON.parse(await readFile(configAbs, 'utf8')));
  } catch (err) {
    if (err instanceof z.ZodError) throw new Error(`Invalid config at '${err.issues[0]!.path.join('.')}': ${err.issues[0]!.message}`);
    throw new Error(`Could not parse config: ${(err as Error).message}`);
  }
  const tolerance = args.tolerance ?? config.tolerance ?? DEFAULT_PER_CHANNEL_TOLERANCE;
  const minProportion = config.minProportion;

  // Pre-flight: every image must exist.
  const missing = config.images.filter((im) => !existsSync(path.resolve(dir, im.path)));
  if (missing.length > 0) throw new Error(`Missing images:\n  ${missing.map((m) => m.path).join('\n  ')}`);

  const lines: string[] = [];
  lines.push(`# Palette QC — ${config.scene}`);
  lines.push('');
  lines.push(`- **Reference palette:** ${config.palette.map((h) => `\`${h}\``).join(' ')}`);
  lines.push(`- **Tolerance:** ±${tolerance} / channel`);
  lines.push('');
  lines.push('| Shot / take | Result | Dominant colors | Offending (nearest ref · Δ) |');
  lines.push('|---|---|---|---|');

  let passCount = 0;
  for (const im of config.images) {
    const abs = path.resolve(dir, im.path);
    await stat(abs); // exists (pre-flighted)
    const sampled = await extractDominantColors(abs);
    const rep = checkPaletteCompliance(sampled, config.palette, { perChannelTolerance: tolerance, ...(minProportion != null ? { minProportion } : {}) });
    if (rep.pass) passCount++;
    const dominant = rep.matches
      .slice(0, 4)
      .map((m) => `\`${m.sampledHex}\`(${Math.round(m.proportion * 100)}%)`)
      .join(' ');
    const offenders = rep.offenders.length === 0
      ? '—'
      : rep.offenders
          .map((o) => `\`${o.sampledHex}\` → ${o.nearestReferenceHex ?? 'none'} · Δ${o.maxDelta}`)
          .join('; ');
    const result = rep.pass ? '✅ pass' : '⚠️ review';
    lines.push(`| ${cell(im.label)} | ${result} | ${dominant} | ${offenders} |`);
  }
  lines.push('');
  lines.push(`_${passCount}/${config.images.length} within palette. Generated by palette-qc._`);

  const markdown = lines.join('\n') + '\n';
  if (args.out) {
    await writeFile(path.resolve(dir, args.out), markdown, 'utf8');
    console.log(`Wrote ${args.out} — ${passCount}/${config.images.length} shots within palette (±${tolerance}/channel).`);
  } else {
    console.log(markdown);
  }
}

main().catch((err) => {
  console.error(`palette-qc: ${(err as Error).message}`);
  process.exit(1);
});
