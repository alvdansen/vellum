// Pure type definitions for Vellum hierarchy entities.
// ZERO imports — this file is the canonical type source consumed by engine, store, and tools.

/**
 * Single source of truth for the shot naming convention.
 *
 * This used to be `/^sh\d{3,}$/` — lowercase `sh` plus digits. That encoded ONE
 * studio's convention as a global law, and every other studio's shot codes were
 * simply unrepresentable: `SH014`, `EP101_SH014`, `SC012_SH0030` all failed at
 * the tool boundary. A tracker or spreadsheet import died on its first row, and
 * a name that came in wrong could never be corrected because the hierarchy was
 * create-only. Vellum has no business dictating what a studio calls a shot.
 *
 * What it DOES have business enforcing is safety, because a shot name becomes a
 * directory segment (buildOutputPath), an entry in the ` > ` breadcrumb, and a
 * heading in generated markdown. So the rule is now "anything a sane pipeline
 * would call a shot, nothing that can escape a path or lie about what it is":
 *
 *   - 1–100 chars, ASCII letters/digits plus `.`, `_`, `-`
 *   - must START with a letter or digit (no leading dot → no hidden files,
 *     no leading dash → no argument injection in a shell that sees the path)
 *   - no `..` anywhere (path traversal) and no trailing `.` (Windows strips it,
 *     so `sh010.` and `sh010` would collide on disk while differing in the DB)
 *   - not a Windows reserved device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9),
 *     bare or with an extension — those are unopenable as files on Windows
 *   - no spaces, so the breadcrumb separator ` > ` can never appear
 *
 * Strictly WIDER than the old pattern: every previously valid name still
 * validates, so no existing row becomes illegal.
 *
 * Path-layer sanitization (sanitizeRelativeSegment) still runs independently —
 * this is the early, human-readable rejection, not the last line of defence.
 */
export const SHOT_NAME_REGEX =
  /^(?!(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$))(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,99}(?<!\.)$/i;

export interface Workspace {
  id: string;
  name: string;
  naming_template: string | null;
  created_at: number;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  naming_template: string | null;
  created_at: number;
}

export interface Sequence {
  id: string;
  project_id: string;
  name: string;
  created_at: number;
}

export interface Shot {
  id: string;
  sequence_id: string;
  name: string;
  created_at: number;
  status: ShotStatus; // added by migration 0008; default 'wip'
}

/**
 * Closed set of version lifecycle states (the generation state machine).
 * Engine-level `mapState` already treats this as a closed union; narrowing
 * the type here lets callers pattern-match exhaustively and catches stale
 * string comparisons at compile time. The SQLite column stays TEXT — a
 * cast at the repo boundary preserves schema compatibility without forcing
 * a migration.
 */
export type VersionStatus = 'submitted' | 'running' | 'completed' | 'failed';

/**
 * Closed set of shot production states. Free DAG — no transition
 * guards. Supervisors can transition any → any. The SQLite column stays
 * TEXT with DEFAULT 'wip'; the SHOT_STATUSES constant is the single source
 * of truth for the valid set (grep test enforces no inline string comparisons).
 */
export const SHOT_STATUSES = ['wip', 'pending-review', 'approved', 'on-hold', 'omit'] as const;
export type ShotStatus = typeof SHOT_STATUSES[number];

/**
 * Ceiling on a single project-spec revision body.
 *
 * A spec is standing context an agent loads before it acts, so its real cost is
 * paid on every call, not once at write time. 256 KiB is generous for a style
 * bible or look book and small enough that the cap bites before an agent's
 * context does. Enforced at the engine boundary AND mirrored as the tool-layer
 * Zod max so an oversize spec is refused before any DB write.
 */
export const MAX_SPEC_CONTENT_BYTES = 256 * 1024;

export interface Version {
  id: string;
  shot_id: string;
  version_number: number;
  status: VersionStatus;
  job_id: string | null;
  parent_version_id: string | null;
  notes: string | null;
  created_at: number;
  completed_at: number | null;
  // Generation-outcome fields (all nullable):
  error_code: string | null;
  error_message: string | null;
  outputs_json: string | null;
  // Lineage (nullable).
  lineage_type: 'reproduce' | 'iterate' | null;
  // JSON-encoded string[] persisted
  // at engine.reproduceVersion time. NULL on legacy rows.
  reproduction_warnings_json: string | null;
  // The GenerationProvider adapter id that produced this
  // version ('comfyui-cloud', 'replicate', …). Optional in the TS view because
  // additive/dual-read: DB rows post-migration always carry it (value-or-null),
  // but hand-built literals predating the pivot may omit it (absent ≡ null).
  provider?: string | null;
  // Duplicate-submit guard. Fingerprint of the request this version was
  // submitted with, so an identical re-submit inside a short window can be
  // refused rather than paying a provider twice. Optional in the TS view for
  // the same additive/dual-read reason as `provider`: legacy rows and
  // hand-built literals read NULL, which the guard treats as "never a
  // duplicate".
  request_fingerprint?: string | null;
}

export type EntityType = 'workspace' | 'project' | 'sequence' | 'shot' | 'version';

export interface BreadcrumbEntry {
  type: EntityType;
  id: string;
  name: string;
}

export interface Breadcrumb {
  entries: BreadcrumbEntry[];
  text: string;
}
