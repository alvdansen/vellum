/**
 * mirror-scene — scene seed tool.
 *
 * Mirrors a scene into Vellum FROM a manifest: creates
 * the workspace → project → sequence → shot hierarchy, retro-registers each
 * locked "Select" as a completed version (stamped with its provider + neutral
 * provenance), sets shot statuses, and writes a per-shot pipeline-log markdown
 * (generated FROM the append-only provenance) under the output root.
 *
 * It is IDEMPOTENT: hierarchy is get-or-created by name, and a Select whose
 * `externalJobRef` already appears as a version's job_id is skipped (use --force
 * to re-register). Run it repeatedly as new Selects are locked.
 *
 * Usage:
 *   npx tsx scripts/mirror-scene.mts <manifest.json> [--db ./vellum.db] [--dry-run] [--force]
 *
 * The Select files are COPIED into Vellum's structured output tree at
 * <outputRoot>/<project>/<sequence>/<shot>/<version>/<filename> — the original
 * source files are untouched; Vellum owns a provenance-tracked copy. Point
 * outputRoot at a synced folder to keep the copies in a shared drive.
 *
 * See docs/quickstart.md for the manifest reference and the hierarchy mapping.
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { openDb } from '../src/store/db.js';
import { HierarchyRepo } from '../src/store/hierarchy-repo.js';
import { VersionRepo } from '../src/store/version-repo.js';
import { ProvenanceRepo } from '../src/store/provenance-repo.js';
import { Engine } from '../src/engine/pipeline.js';
import { DEFAULT_INGEST_MAX_BYTES } from '../src/engine/ingest.js';
import { sanitizeRelativeSegment } from '../src/utils/outputs.js';
import { SHOT_NAME_REGEX, SHOT_STATUSES } from '../src/types/hierarchy.js';
import type { Workspace, Project, Sequence, Shot } from '../src/types/hierarchy.js';
import type { StoredOutput } from '../src/comfyui/types.js';

// ---- Manifest schema --------------------------------------------------------

const SelectSchema = z.object({
  /** Path to the Select file — absolute, or relative to the manifest's directory. */
  file: z.string().min(1),
  /** Provider id to stamp on the registered version (e.g. 'google-ai-studio', 'byteplus'). */
  provider: z.string().min(1).max(64),
  /** On-disk filename in Vellum's tree; defaults to the source basename. */
  filename: z.string().max(255).optional(),
  /** Caller-asserted neutral provenance stored verbatim (stage, base_model, etc.). */
  provenance: z.record(z.string(), z.unknown()).optional(),
  /** Free-text notes recorded on the version. */
  notes: z.string().max(2000).optional(),
  /** Provider media UUID / job ref — the idempotency key for skip-existing. */
  externalJobRef: z.string().max(200).optional(),
});

const ShotSchema = z.object({
  name: z.string().regex(SHOT_NAME_REGEX, 'shot name must match ^sh\\d{3,}$ (e.g. sh010)'),
  status: z.enum(SHOT_STATUSES).optional(),
  statusNote: z.string().max(500).optional(),
  selects: z.array(SelectSchema).default([]),
});

/**
 * A hierarchy name that becomes a path segment in the output tree. The engine
 * sanitizes its own asset-copy paths, but this script ALSO joins these names to
 * build the per-shot pipeline-log path — so they must be path-safe here too, or
 * a `project: ".."` would let a log write escape outputRoot. Reject traversal /
 * separator chars at parse time with a clear operator error.
 */
const pathSafeName = (label: string) =>
  z
    .string()
    .min(1)
    .max(200)
    .refine(
      (s) => s.trim() === s && s !== '.' && s !== '..' && !s.includes('..') && !/[\\/\0]/.test(s),
      { message: `${label} must not contain '/', '\\', '..', or leading/trailing whitespace` },
    );

const ManifestSchema = z.object({
  workspace: pathSafeName('workspace'),
  project: pathSafeName('project'),
  sequence: pathSafeName('sequence'),
  /** Where Vellum writes its structured copies + pipeline logs. */
  outputRoot: z.string().min(1),
  /** Per-output ingest byte cap (bump for large video Selects). */
  ingestMaxBytes: z.number().int().positive().optional(),
  shots: z.array(ShotSchema).min(1),
});

type Manifest = z.infer<typeof ManifestSchema>;

// ---- Helpers ---------------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.exr': 'image/x-exr',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

function contentTypeFor(filename: string): string {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

interface Args {
  manifestPath: string;
  db: string;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let db = './vellum.db';
  let dryRun = false;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') db = argv[++i] ?? db;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--force') force = true;
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 1) {
    throw new Error('Usage: mirror-scene <manifest.json> [--db path] [--dry-run] [--force]');
  }
  return { manifestPath: positional[0]!, db, dryRun, force };
}

function log(msg: string): void {
  // stdout is fine for a CLI script (unlike the MCP server, which reserves stdout).
  console.log(msg);
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const manifestAbs = path.resolve(args.manifestPath);
  if (!existsSync(manifestAbs)) throw new Error(`Manifest not found: ${manifestAbs}`);
  const manifestDir = path.dirname(manifestAbs);

  let manifest: Manifest;
  try {
    manifest = ManifestSchema.parse(JSON.parse(await readFile(manifestAbs, 'utf8')));
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      throw new Error(`Invalid manifest at '${first.path.join('.')}': ${first.message}`);
    }
    throw new Error(`Could not parse manifest JSON: ${(err as Error).message}`);
  }

  const outputRoot = path.resolve(manifestDir, manifest.outputRoot);
  const resolveSelect = (file: string) => path.resolve(manifestDir, file);

  // Pre-flight: every Select file must exist and fit the byte cap. Fail before
  // any DB write so a bad manifest never leaves a half-mirrored scene. The cap
  // checked here MUST equal the one the engine will enforce (the manifest value
  // or DEFAULT_INGEST_MAX_BYTES) — otherwise an omitted ingestMaxBytes skips the
  // check yet the engine still rejects >500MB mid-run, half-mirroring the scene.
  const ingestMaxBytes = manifest.ingestMaxBytes ?? DEFAULT_INGEST_MAX_BYTES;
  const missing: string[] = [];
  const oversize: string[] = [];
  for (const shot of manifest.shots) {
    for (const sel of shot.selects) {
      const abs = resolveSelect(sel.file);
      if (!existsSync(abs)) {
        missing.push(`${shot.name}: ${sel.file}`);
        continue;
      }
      const size = (await stat(abs)).size;
      if (size > ingestMaxBytes) oversize.push(`${shot.name}: ${sel.file} (${size} B > ${ingestMaxBytes} B)`);
    }
  }
  if (missing.length > 0) throw new Error(`Missing Select files:\n  ${missing.join('\n  ')}`);
  if (oversize.length > 0) {
    throw new Error(
      `Select files exceed ingestMaxBytes (${manifest.ingestMaxBytes}):\n  ${oversize.join('\n  ')}\n` +
        `Raise "ingestMaxBytes" in the manifest for large video Selects.`,
    );
  }

  log(`Scene: ${manifest.workspace} › ${manifest.project} › ${manifest.sequence}`);
  log(`Output root: ${outputRoot}`);
  log(`Database: ${args.db}${args.dryRun ? '  (DRY RUN — no writes)' : ''}`);
  log('');

  if (args.dryRun) {
    let count = 0;
    for (const shot of manifest.shots) {
      log(`  ${shot.name}${shot.status ? `  [${shot.status}]` : ''} — ${shot.selects.length} select(s)`);
      for (const sel of shot.selects) {
        count++;
        log(`      register ${sel.provider}: ${path.basename(sel.filename ?? sel.file)}`);
      }
    }
    log('');
    log(`Dry run OK: ${manifest.shots.length} shot(s), ${count} select(s) would be registered.`);
    return;
  }

  // Real run — bootstrap the engine against the persistent DB.
  const { db } = openDb(args.db);
  const repo = new HierarchyRepo(db);
  const versionRepo = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const engine = new Engine(db, repo, versionRepo, provenanceRepo, null, outputRoot, {
    ...(manifest.ingestMaxBytes ? { ingestMaxBytes: manifest.ingestMaxBytes } : {}),
  });

  // Idempotent get-or-create by name (bounded list scan — scene counts are small).
  const findOrCreateWorkspace = (name: string): Workspace =>
    repo.listWorkspaces(1000, 0).items.find((w) => w.name === name) ?? repo.createWorkspace(name);
  const findOrCreateProject = (wsId: string, name: string): Project =>
    repo.listProjects(wsId, 1000, 0).items.find((p) => p.name === name) ?? repo.createProject(wsId, name);
  const findOrCreateSequence = (projId: string, name: string): Sequence =>
    repo.listSequences(projId, 1000, 0).items.find((s) => s.name === name) ?? repo.createSequence(projId, name);
  const findOrCreateShot = (seqId: string, name: string): Shot =>
    repo.listShots(seqId, 1000, 0).items.find((s) => s.name === name) ?? repo.createShot(seqId, name);

  const ws = findOrCreateWorkspace(manifest.workspace);
  const proj = findOrCreateProject(ws.id, manifest.project);
  const seq = findOrCreateSequence(proj.id, manifest.sequence);

  // Parse a completed version's stored output filenames (idempotency fallback
  // for Selects without an externalJobRef).
  const outputFilenames = (outputsJson: string | null): string[] => {
    if (!outputsJson) return [];
    try {
      const parsed = JSON.parse(outputsJson) as StoredOutput[];
      return Array.isArray(parsed) ? parsed.map((o) => o?.filename).filter((f): f is string => !!f) : [];
    } catch {
      return [];
    }
  };

  let registered = 0;
  let skipped = 0;
  let logsWritten = 0;

  for (const shotSpec of manifest.shots) {
    const shot = findOrCreateShot(seq.id, shotSpec.name);

    // Status: only transition when it actually differs — the status log is
    // append-only, so re-runs must not pile up redundant transitions.
    if (shotSpec.status) {
      const current = engine.getShotStatus(shot.id).status;
      if (current !== shotSpec.status) {
        engine.setShotStatus(shot.id, shotSpec.status, 'mirror-scene', shotSpec.statusNote);
      }
    }

    // Idempotency is keyed on COMPLETED versions only. A prior run that failed
    // mid-ingest leaves a 'failed' row that still carries its job_id — matching
    // against it would skip an asset that never landed on disk, forever. We
    // dedupe by externalJobRef when present, else by the resolved filename.
    const completed = versionRepo.listAllForShot(shot.id).filter((v) => v.status === 'completed');
    const doneJobRefs = new Set(completed.map((v) => v.job_id).filter((j): j is string => !!j));
    const doneFilenames = new Set(completed.flatMap((v) => outputFilenames(v.outputs_json)));

    for (const sel of shotSpec.selects) {
      const filename = sel.filename ?? path.basename(resolveSelect(sel.file));
      const alreadyDone = sel.externalJobRef
        ? doneJobRefs.has(sel.externalJobRef)
        : doneFilenames.has(filename);
      if (!args.force && alreadyDone) {
        skipped++;
        log(`  ${shotSpec.name}: skip ${sel.externalJobRef ?? filename} (already registered)`);
        continue;
      }
      const bytes = await readFile(resolveSelect(sel.file));
      const result = await engine.registerExternalOutput({
        shotId: shot.id,
        providerId: sel.provider,
        outputs: [{ bytes, filename, content_type: contentTypeFor(filename) }],
        provenance: sel.provenance,
        notes: sel.notes,
        externalJobRef: sel.externalJobRef,
      });
      registered++;
      log(`  ${shotSpec.name}: registered v${result.entity.version_number} ${sel.provider} ${filename} [${result.entity.status}]`);
    }

    // Write this shot's pipeline log RIGHT AFTER its Selects — not in a trailing
    // loop — so a later shot's failure never loses the logs for shots already
    // mirrored. Path segments are re-sanitized (defence in depth; the manifest
    // schema already rejects unsafe names) so this write can never escape the
    // tree even though it bypasses the engine's own path guard.
    const { markdown } = engine.getShotPipelineLog(shot.id);
    const dir = path.join(
      outputRoot,
      sanitizeRelativeSegment(manifest.project),
      sanitizeRelativeSegment(manifest.sequence),
      sanitizeRelativeSegment(shotSpec.name),
    );
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'pipeline-log.md'), markdown, 'utf8');
    logsWritten++;
  }

  log('');
  log(
    `Done: ${manifest.shots.length} shot(s), ${registered} registered, ${skipped} skipped, ` +
      `${logsWritten} pipeline log(s) written under ${outputRoot}.`,
  );
}

main().catch((err) => {
  console.error(`mirror-scene: ${(err as Error).message}`);
  process.exit(1);
});
