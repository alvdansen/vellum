// Hono sub-router exposing the dashboard REST routes.
// Thin delegation layer over the Engine facade —
// every route either
//   (a) parses Hono context (params/query/body),
//   (b) calls an Engine method, and
//   (c) returns the Engine result as JSON,
// or throws a TypedError that `typedErrorHandler` converts to a structured
// 4xx/5xx response.
//
// Architecture purity: this file has ZERO MCP SDK
// imports and zero SQLite imports (ORM + driver). All data moves through
// the Engine interface. Docstring phrasing convention:
// avoid sentinel package strings (MCP, ORM, DB driver) because
// architecture-purity.test.ts does substring grep against file text.
//
// One exception: GET /api/versions/:id/output — streams a binary file from
// disk via `fs.createReadStream`. This is the single FS-boundary route in the
// dashboard surface. Path is constructed as
// `outputs/<versionId>/<filename>`; the filename is pulled from the version's
// `outputs_json` field, then `path.basename()` is applied + validated so a
// malicious ComfyUI response cannot trigger path traversal.

import { Hono } from 'hono';
import { z } from 'zod';
import { createReadStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import * as path from 'node:path';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { SHOT_STATUSES } from '../types/hierarchy.js';
import {
  decodeVersionCursor,
  DEFAULT_VERSION_SORT,
  DEFAULT_HIERARCHY_SORT,
  type VersionSort,
  type VersionCursor,
  type HierarchySort,
} from '../store/sort.js';
// Shot-grid cursor decoder. Mirrors parseCursorParam's
// 4xx behavior: malformed input → TypedError('INVALID_INPUT'), never throws
// a 5xx. The decode helper itself returns null on any failure path; the
// route helper translates null → 400 envelope so the dashboard's pagination
// state machine surfaces a recoverable error.
import {
  decodeShotGridCursor,
  type ShotGridCursor,
} from '../store/shot-status-repo.js';
// Shared page-size ceiling. The tool layer caps page size via Zod; the HTTP
// surface imports the SAME constant so the two transports cannot disagree about
// what a legal page is (src/http/webhooks.ts already reaches for shape.ts this
// way). This is a plain numeric constant — no tool/SDK surface comes with it.
import { MAX_PAGE_SIZE } from '../tools/shape.js';
import {
  AssetQueryBody,
  ListTagsBody,
  ListMetadataKeysBody,
} from '../tools/asset-query-schema.js';

/**
 * Extension → Content-Type map. Unknown extensions fall through
 * to `application/octet-stream` so browsers download rather than render.
 */
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/**
 * Minimal Engine surface this router depends on. We do NOT import the full
 * `Engine` class directly — a structural subset keeps the unit tests free
 * from having to instantiate a real Engine + DB. FakeEngine satisfies this
 * surface at test time.
 *
 * The real `Engine` class (src/engine/pipeline.ts) is structurally compatible
 * with this interface; server.ts passes a real Engine at mount time and
 * TypeScript picks up the widened parameter type without a cast.
 */
export type EngineForDashboard = Pick<
  Engine,
  | 'listWorkspaces'
  | 'getWorkspace'
  | 'listProjects'
  | 'getProject'
  | 'listSequences'
  | 'getSequence'
  | 'listShots'
  | 'getShot'
  | 'listVersionsForShot'
  | 'getVersion'
  | 'getProvenance'
  | 'diffVersions'
  | 'reproduceVersion'
  | 'queryAssets'
  | 'listTags'
  | 'listMetadataKeys'
  | 'getDashboardHome'
  | 'outputRoot'
  // Read accessor for the X-C2PA-Signing-Status response
  // header. The HTTP layer NEVER signs; signing happens at write-time via the
  // engine downloader hook. This accessor returns the latest
  // manifest_signed event payload for the (versionId, filename) pair, or null.
  | 'getC2paStatusForVersion'
  // Thumbnail derivation surface. The HTTP route at
  // GET/HEAD /api/versions/:id/thumbnail delegates to engine.generateThumbnail
  // which runs the coalescing mutex + cache + format-router + sharp/ffmpeg
  // pipeline. Returns null on derivation failure;
  // route surfaces 503 + THUMBNAIL_FAILED envelope in that case.
  | 'generateThumbnail'
  // Approval gate — the dashboard is where a human reviews pending spends.
  | 'listProposals'
  | 'approveProposal'
  | 'rejectProposal'
  // AI conversational summary surface. GET + POST
  // routes at /api/versions/:id/summary delegate to engine.summarizeVersion.
  // Engine returns SummaryOutcome discriminated union; HTTP
  // layer never throws for failure paths (graceful degradation) —
  // only TypedError(VERSION_NOT_FOUND) surfaces (translated to 404 via
  // error-middleware). POST regenerate is gated by an in-memory
  // 60s throttle keyed by versionId.
  | 'summarizeVersion'
  // Denormalized shot grid surface. The route
  // at GET /api/sequences/:id/shot-grid delegates to engine.listShotGrid
  // which composes the single-pass window-function CTE (no N+1) and returns
  // the locked wire payload. TypedError('SEQUENCE_NOT_FOUND')
  // → 404 via global typedErrorHandler; cursor decode failures surface as
  // 400 INVALID_INPUT via parseShotGridCursorParam.
  | 'listShotGrid'
  // The route at
  // PATCH /api/shots/:id/status delegates to engine.setShotStatus (positional
  // args: shotId, toStatus, changedBy, note?). The
  // engine wraps UPDATE shots + INSERT shot_status_events in a single
  // db.transaction(), and the repo writes `note ?? null`
  // so the route's null/empty-string coercion ('' → undefined) collapses to
  // the invariant that DB row.note IS NULL when blank.
  | 'setShotStatus'
  // The route at
  // GET /api/shots/:id/status-history wraps engine.listShotStatusHistory so
  // the dashboard's unified timeline can read append-only events
  // alongside version events. The engine method already paginates via the
  // limit param; the route uses the existing qNum helper for closed-set
  // integer parsing.
  | 'listShotStatusHistory'
  // GET /api/shots/:id/pipeline-log wraps engine.getShotPipelineLog — a
  // markdown projection of the shot's append-only provenance (status timeline,
  // takes with recorded actual vs estimated cost, gate proposals, recorded
  // spend). TypedError('SHOT_NOT_FOUND') → 404 via the global handler.
  | 'getShotPipelineLog'
>;

/**
 * Creates a Hono sub-router with all the dashboard REST routes wired to the
 * supplied Engine. The caller is responsible for mounting `typedErrorHandler`
 * via `app.onError(typedErrorHandler)` either on this router or on the parent
 * app — server.ts mounts at the server level so both REST + SSE inherit.
 *
 * Pagination defaults: limit=20, offset=0 (matches the MCP tool layer).
 */
export function createDashboardRouter(engine: EngineForDashboard): Hono {
  const app = new Hono();

  // ==========================================================================
  // Per-versionId server-side throttle for the
  // POST /api/versions/:id/summary/regenerate route. Lazy GC at lookup time —
  // entries older than 60s are simply overwritten on the next request (no
  // scheduled cleanup needed for single-process scope).
  //
  // Per-process scope (matches the circuit breaker's granularity). Resets on
  // process restart. Multi-process deployments would split the budget but the
  // current release ships single-process (single-artist demo scope).
  //
  // The server-side throttle prevents user-driven
  // thrash on the Anthropic API. Client-side debounce is the second
  // line of defence.
  // ==========================================================================
  const summaryThrottle = new Map<string, number>();
  const SUMMARY_THROTTLE_MS = 60_000;

  // Parse a numeric query param with a default.
  // Throws TypedError('INVALID_INPUT', ...) at the HTTP boundary if the param
  // is present but not a non-negative integer (negatives, floats, non-numeric
  // all fail closed). Absent params still return the fallback so optional
  // ?limit/?offset don't suddenly become required.
  // Pattern matches the existing INVALID_INPUT throw at the /diff route below.
  const qNum = (raw: string | undefined, fallback: number, name: string): number => {
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      throw new TypedError(
        'INVALID_INPUT',
        `Query parameter '${name}' must be a non-negative integer (got '${raw}')`,
        'Use a positive integer like ?limit=20',
      );
    }
    return n;
  };

  // Page size needs an UPPER bound as well as a lower one. The MCP tool surface
  // already caps it (`z.number().max(MAX_PAGE_SIZE)` in src/tools/*-tool.ts);
  // without the same cap here, the two transports disagree and ?limit=1e9 goes
  // straight through to `.limit()` on the query, letting one request materialize
  // and serialize the entire table. Rejecting (rather than silently clamping)
  // matches both the MCP surface and qNum's existing fail-closed style.
  const qLimit = (raw: string | undefined, fallback: number): number => {
    const n = qNum(raw, fallback, 'limit');
    if (n > MAX_PAGE_SIZE) {
      throw new TypedError(
        'INVALID_INPUT',
        `Query parameter 'limit' must be at most ${MAX_PAGE_SIZE} (got '${raw}')`,
        `Request ?limit=${MAX_PAGE_SIZE} or fewer and page through with ?offset= or ?cursor=`,
      );
    }
    return n;
  };

  // ==========================================================================
  // Zod whitelist parsers for ?sort= and ?cursor=
  // Injection mitigations: closed enums refuse anything outside the
  // canonical set; engine never sees raw user strings. Disclosure hygiene: error
  // messages do NOT echo the malformed input back. And
  // cursor decode failure → 4xx (NEVER 5xx) via TypedError.
  // ==========================================================================
  const VersionSortFieldEnum = z.enum(['completed_at', 'created_at', 'name', 'version_number']);
  const HierarchySortFieldEnum = z.enum(['name', 'created_at']);
  const SortDirectionEnum = z.enum(['asc', 'desc']);

  const VERSION_FIELDS_LIST = VersionSortFieldEnum.options.join(', ');
  const HIERARCHY_FIELDS_LIST = HierarchySortFieldEnum.options.join(', ');

  // ==========================================================================
  // Closed-set body schema for
  // PATCH /api/shots/:id/status. The `to_status` field is gated by z.enum
  // against the canonical SHOT_STATUSES list — non-members surface as 400
  // INVALID_INPUT via TypedError, never reach the engine. `note` accepts
  // string | null | undefined with a 500-char ceiling that mirrors the MCP
  // tool's note.max(500) at shot-tool.ts:56 — the two transports agree.
  // `changed_by` is a free-text attribution string capped at 100 chars; the
  // route defaults to 'user' when absent (single-artist scope — no auth).
  //
  // Disclosure hygiene: the route returns the Zod path[0] in the error message,
  // never the raw input value. The dashboard renders the route's error.message
  // as JSX children (Preact auto-escape — no innerHTML).
  // ==========================================================================
  const SetShotStatusBody = z.object({
    to_status: z.enum(SHOT_STATUSES),
    note: z.string().max(500).nullable().optional(),
    changed_by: z.string().max(100).optional(),
  });

  /** Parse "field:dir" against the version-grid whitelist. Defaults to Latest when undefined. */
  function parseVersionSortParam(raw: string | undefined): VersionSort {
    if (raw === undefined || raw === '') return DEFAULT_VERSION_SORT;
    const colon = raw.indexOf(':');
    if (colon < 0) {
      throw new TypedError(
        'INVALID_INPUT',
        `Malformed sort param — expected 'field:dir'`,
        `Use ?sort=completed_at:desc (or any of: ${VERSION_FIELDS_LIST} × asc/desc)`,
      );
    }
    const fieldR = VersionSortFieldEnum.safeParse(raw.slice(0, colon));
    const dirR = SortDirectionEnum.safeParse(raw.slice(colon + 1));
    if (!fieldR.success || !dirR.success) {
      throw new TypedError(
        'INVALID_INPUT',
        `Invalid sort param — field/dir not in whitelist`,
        `Use ?sort=completed_at:desc (or any of: ${VERSION_FIELDS_LIST} × asc/desc)`,
      );
    }
    return { field: fieldR.data, dir: dirR.data };
  }

  /** Parse "field:dir" against the hierarchy whitelist (narrower set). */
  function parseHierarchySortParam(raw: string | undefined): HierarchySort {
    if (raw === undefined || raw === '') return DEFAULT_HIERARCHY_SORT;
    const colon = raw.indexOf(':');
    if (colon < 0) {
      throw new TypedError(
        'INVALID_INPUT',
        `Malformed sort param — expected 'field:dir'`,
        `Use ?sort=name:asc (or any of: ${HIERARCHY_FIELDS_LIST} × asc/desc)`,
      );
    }
    const fieldR = HierarchySortFieldEnum.safeParse(raw.slice(0, colon));
    const dirR = SortDirectionEnum.safeParse(raw.slice(colon + 1));
    if (!fieldR.success || !dirR.success) {
      throw new TypedError(
        'INVALID_INPUT',
        `Invalid sort param — field/dir not in whitelist`,
        `Use ?sort=name:asc (or any of: ${HIERARCHY_FIELDS_LIST} × asc/desc)`,
      );
    }
    return { field: fieldR.data, dir: dirR.data };
  }

  /**
   * Parse ?cursor= against decodeVersionCursor. Throws INVALID_INPUT (NOT 500)
   * on garbage — decode failure is a client error. NEVER echoes the malformed
   * input back verbatim (information-disclosure hygiene).
   */
  function parseCursorParam(raw: string | undefined): VersionCursor | null {
    if (raw === undefined || raw === '') return null;
    const decoded = decodeVersionCursor(raw);
    if (decoded === null) {
      throw new TypedError(
        'INVALID_INPUT',
        `Malformed cursor — drop the ?cursor= param to start from page 1`,
        `Cursors are opaque base64url strings issued in the response's next_cursor field`,
      );
    }
    return decoded;
  }

  /**
   * Parse ?cursor= against decodeShotGridCursor.
   * Same 4xx contract as parseCursorParam: decode failure → TypedError
   * (INVALID_INPUT) → 400 via typedErrorHandler. NEVER echoes the malformed
   * input back verbatim (information-disclosure hygiene).
   *
   * decodeShotGridCursor returns null on every failure path
   * (non-base64, non-JSON, missing fields) — this helper is the HTTP
   * translator that surfaces the null as a structured 400 envelope.
   */
  function parseShotGridCursorParam(
    raw: string | undefined,
  ): ShotGridCursor | null {
    if (raw === undefined || raw === '') return null;
    const decoded = decodeShotGridCursor(raw);
    if (decoded === null) {
      throw new TypedError(
        'INVALID_INPUT',
        `Malformed cursor — drop the ?cursor= param to start from page 1`,
        `Cursors are opaque base64url strings issued in the response's next_cursor field`,
      );
    }
    return decoded;
  }

  // --- Workspaces ---
  app.get('/api/workspaces', (c) => {
    const limit = qLimit(c.req.query('limit'), 20);
    const offset = qNum(c.req.query('offset'), 0, 'offset');
    return c.json(engine.listWorkspaces(limit, offset));
  });

  app.get('/api/workspaces/:id', (c) => {
    return c.json(engine.getWorkspace(c.req.param('id')));
  });

  app.get('/api/workspaces/:id/projects', (c) => {
    const limit = qLimit(c.req.query('limit'), 20);
    const offset = qNum(c.req.query('offset'), 0, 'offset');
    const sortRaw = c.req.query('sort');
    const opts = sortRaw !== undefined ? { sort: parseHierarchySortParam(sortRaw) } : undefined;
    return c.json(engine.listProjects(c.req.param('id'), limit, offset, opts));
  });

  // --- Projects ---
  app.get('/api/projects/:id', (c) => {
    return c.json(engine.getProject(c.req.param('id')));
  });

  app.get('/api/projects/:id/sequences', (c) => {
    const limit = qLimit(c.req.query('limit'), 20);
    const offset = qNum(c.req.query('offset'), 0, 'offset');
    const sortRaw = c.req.query('sort');
    const opts = sortRaw !== undefined ? { sort: parseHierarchySortParam(sortRaw) } : undefined;
    return c.json(engine.listSequences(c.req.param('id'), limit, offset, opts));
  });

  // --- Sequences ---
  app.get('/api/sequences/:id', (c) => {
    return c.json(engine.getSequence(c.req.param('id')));
  });

  app.get('/api/sequences/:id/shots', (c) => {
    const limit = qLimit(c.req.query('limit'), 20);
    const offset = qNum(c.req.query('offset'), 0, 'offset');
    const sortRaw = c.req.query('sort');
    const opts = sortRaw !== undefined ? { sort: parseHierarchySortParam(sortRaw) } : undefined;
    return c.json(engine.listShots(c.req.param('id'), limit, offset, opts));
  });

  // ===== Denormalized shot grid endpoint =====
  //
  // GET /api/sequences/:id/shot-grid?cursor=&limit=
  //
  // Deliberately narrow query surface (locked decision):
  //   - NO status-filter query param — filtering is client-side;
  //     dashboard reads the filter from a signal and computes the visible
  //     subset locally.
  //   - NO show-omitted query param — client-side dataset gating;
  //     the endpoint always returns every shot regardless of status,
  //     and the dashboard's toggle controls whether `omit` shots render.
  //   - NO sort query param — ships fixed sort `name ASC`;
  //     sort variability is deferred until artist feedback
  //     demands it.
  //
  // The engine.listShotGrid call throws TypedError('SEQUENCE_NOT_FOUND') for
  // unknown sequenceId; the global typedErrorHandler translates that to 404.
  // Cursor decode failures surface as 400 INVALID_INPUT via
  // parseShotGridCursorParam. No try/catch needed at this seam.
  app.get('/api/sequences/:id/shot-grid', (c) => {
    const sequenceId = c.req.param('id');
    const limit = qLimit(c.req.query('limit'), 20);
    const cursor = parseShotGridCursorParam(c.req.query('cursor'));
    return c.json(engine.listShotGrid(sequenceId, { cursor, limit }));
  });

  // --- Shots ---
  app.get('/api/shots/:id', (c) => {
    return c.json(engine.getShot(c.req.param('id')));
  });

  app.get('/api/shots/:id/versions', (c) => {
    // Full Zod whitelist parsing at the HTTP boundary.
    // Engine receives structurally-validated VersionSort + (VersionCursor|null);
    // raw user strings never reach the SQL layer (injection + decode-failure
    // mitigations). ?offset= is preserved as a no-op for graceful migration of
    // v1.1 callers (the cursor pagination supersedes offset semantics).
    const limit = qLimit(c.req.query('limit'), 20);
    void qNum(c.req.query('offset'), 0, 'offset'); // back-compat parse, value unused
    const sort = parseVersionSortParam(c.req.query('sort'));
    const cursor = parseCursorParam(c.req.query('cursor'));
    const include_tags = c.req.query('include_tags') === 'true';
    const include_metadata = c.req.query('include_metadata') === 'true';
    return c.json(
      engine.listVersionsForShot(c.req.param('id'), {
        sort,
        cursor,
        limit,
        include_tags,
        include_metadata,
      }),
    );
  });

  // PATCH delegates to engine.setShotStatus (positional
  // args: shotId, toStatus, changedBy, note?). Engine wraps UPDATE shots + INSERT
  // shot_status_events in a single db.transaction(), and the
  // repo writes `note ?? null` — the route coerces null → undefined before
  // calling engine so the DB row ends up with `note IS NULL` when blank.
  // The Restore path is structurally identical: to_status='wip' +
  // note='Restored from omit' commits without engine extension.
  app.patch('/api/shots/:id/status', async (c) => {
    const shotId = c.req.param('id');
    const rawBody = await c.req.json().catch(() => ({}));
    const parsed = SetShotStatusBody.safeParse(rawBody);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new TypedError(
        'INVALID_INPUT',
        `Invalid PATCH body at '${first.path.join('.')}'`,
        `Expected { to_status: <one of: ${SHOT_STATUSES.join(', ')}>, note?: string|null, changed_by?: string }`,
      );
    }
    // Coerce null OR '' → undefined; engine repo writes `note ?? null`
    // so blank inputs land as IS NULL in the DB row, never '' (empty string).
    const note =
      parsed.data.note === null || parsed.data.note === ''
        ? undefined
        : parsed.data.note;
    const result = engine.setShotStatus(
      shotId,
      parsed.data.to_status,
      parsed.data.changed_by ?? 'user',
      note,
    );
    const { history } = engine.listShotStatusHistory(shotId, 50);
    return c.json({ status: result.newStatus, history });
  });

  // Wraps engine.listShotStatusHistory for the unified
  // review timeline. The engine method predates this route;
  // this is the dashboard-side exposure. Reuses qNum
  // for closed-set integer parsing — bare 'abc' surfaces as
  // 400 INVALID_INPUT via TypedError before reaching the engine.
  app.get('/api/shots/:id/status-history', (c) => {
    const shotId = c.req.param('id');
    const limit = qLimit(c.req.query('limit'), 50);
    return c.json(engine.listShotStatusHistory(shotId, limit));
  });

  // GET /api/shots/:id/pipeline-log — markdown projection of the shot's
  // append-only provenance (status timeline, every take with provider/lineage/
  // cost, gate proposals, recorded-spend total). Thin delegation to
  // engine.getShotPipelineLog; SHOT_NOT_FOUND surfaces as a 404 envelope.
  app.get('/api/shots/:id/pipeline-log', (c) => {
    return c.json(engine.getShotPipelineLog(c.req.param('id')));
  });

  // --- Versions ---
  app.get('/api/versions/:id', (c) => {
    return c.json(engine.getVersion(c.req.param('id')));
  });

  app.get('/api/versions/:id/provenance', (c) => {
    return c.json(engine.getProvenance(c.req.param('id')));
  });

  app.get('/api/versions/:id/diff', async (c) => {
    const against = c.req.query('against');
    if (!against) {
      throw new TypedError(
        'INVALID_INPUT',
        "Missing required query parameter 'against'",
        'Call GET /api/versions/:id/diff?against=<other_version_id>',
      );
    }
    // engine.diffVersions is async (reads disk for output
    // hashes when B is reproduce-lineage). Hono coerces the awaited Promise
    // into the response body via c.json.
    return c.json(await engine.diffVersions(c.req.param('id'), against));
  });

  // Cross-version diff for the A/B compare modal.
  // Pass-through to engine.diffVersions which ALREADY accepts an arbitrary pair
  // (verified at src/engine/diff.ts:172). NO engine
  // signature change; same-shot constraint stays at the engine layer, where it
  // throws TypedError('INVALID_INPUT') → 400 for cross-shot pairs.
  app.get('/api/versions/:a/diff-with/:b', async (c) => {
    const a = c.req.param('a');
    const b = c.req.param('b');
    return c.json(await engine.diffVersions(a, b));
  });

  // ==========================================================================
  // AI conversational summary routes.
  //
  // GET /api/versions/:id/summary returns the SummaryOutcome envelope augmented
  // with regenerate_available_at_ms for the dashboard 1Hz countdown timer.
  //
  // engine.summarizeVersion NEVER throws to HTTP for engine-side failure paths
  // (api_key_missing / circuit_open / sdk_load_failed / http_error /
  //  network_error / validation_failed / timeout) — those become typed
  // 'fallback' SummaryOutcome variants and return 200 with the envelope per
  // the graceful-degradation contract. Only TypedError(VERSION_NOT_FOUND)
  // surfaces (translated to 404 via error-middleware).
  // ==========================================================================
  app.get('/api/versions/:id/summary', async (c) => {
    const versionId = c.req.param('id');
    const outcome = await engine.summarizeVersion(versionId);
    // Embed regenerate-availability hint for the dashboard countdown. lastReq
    // defaults to 0 → regenerate_available_at_ms is in the past → dashboard
    // interprets as "available now".
    const lastReq = summaryThrottle.get(versionId) ?? 0;
    const regenerateAvailableAtMs = lastReq + SUMMARY_THROTTLE_MS;
    return c.json({ ...outcome, regenerate_available_at_ms: regenerateAvailableAtMs });
  });

  // POST /api/versions/:id/summary/regenerate forces a fresh LLM call (engine
  // skips cache lookup at step 2 when options.regenerate=true). Server-side
  // throttle is the load-bearing invariant; client-side debounce
  // (the dashboard's RegenerateButton) is the second line of defence.
  //
  // Throttle violation throws TypedError('SUMMARY_THROTTLED', ...) which the
  // existing error-middleware translates to a 429 (standard HTTP
  // rate-limit semantics).
  app.post('/api/versions/:id/summary/regenerate', async (c) => {
    const versionId = c.req.param('id');
    const lastReq = summaryThrottle.get(versionId) ?? 0;
    const now = Date.now();
    if (now - lastReq < SUMMARY_THROTTLE_MS) {
      const retryAfterSec = Math.ceil((SUMMARY_THROTTLE_MS - (now - lastReq)) / 1000);
      throw new TypedError(
        'SUMMARY_THROTTLED',
        `Regenerate throttled — try again in ${retryAfterSec}s`,
        `One regenerate per version per 60 seconds. Available in ${retryAfterSec}s.`,
      );
    }
    summaryThrottle.set(versionId, now);
    const outcome = await engine.summarizeVersion(versionId, { regenerate: true });
    return c.json({
      ...outcome,
      regenerate_available_at_ms: now + SUMMARY_THROTTLE_MS,
    });
  });

  // --- Output streaming ---
  // Not an Engine method — streams from disk at
  // `outputs/<versionId>/<filename>`. The filename is stored in the version's
  // `outputs_json` field as `[{filename, path, url, content_type, size_bytes}]`
  // (written via GenerationEngine.downloadAndPersist +
  // Engine.getGenerationStatus.downloadOutput).
  //
  // Path-traversal mitigation: after extracting the stored filename, apply
  // `path.basename()` + explicit `..` / separator checks before constructing
  // the fs path. Even a malicious ComfyUI response that sets filename to
  // `../../etc/passwd` is neutralised (basename strips to `passwd`; then
  // existsSync() returns false for the missing file → 404).
  //
  // The response carries an `X-C2PA-Signing-Status` header
  // sourced from the latest `manifest_signed` provenance event written by the
  // engine downloader hook. The HTTP layer NEVER calls into
  // `c2pa-node`; it only READS the recorded signing outcome. Files are signed
  // at write-time, not read-time (dual-transport
  // parity for free, no signing latency on the hot HTTP path).
  //
  // Header value matrix:
  //   - 'signed'                                — manifest_signed event has signed=true
  //   - 'unsigned:<status_reason>'              — manifest_signed event has signed=false
  //                                               (signing_disabled / unsupported_format /
  //                                                cert_load_failed / sign_call_failed /
  //                                                native_binding_unavailable / etc.)
  //   - 'unknown'                               — no manifest_signed event recorded
  //                                               (legacy version predating signing, or
  //                                                download still in progress)
  //
  // Both GET and HEAD methods set the header. HEAD returns no body (byte-parity
  // invariant: header addition does NOT regress streaming bytes; HEAD is the
  // dashboard's lightweight status check via getC2paStatus in
  // packages/dashboard/src/lib/api.ts).
  //
  // v1.1 scope reduction: NO sidecar route in v1.1.
  // c2pa-node v0.5.26 has no public sidecar API; producing pseudo-sidecars
  // would be cryptographically invalid. EXR/PSD surface as
  // `unsigned:unsupported_format` in the X-C2PA-Signing-Status header. v1.2
  // will add the sidecar route + dashboard link when the c2pa-node JS surface
  // exposes signEmbeddable / sign_no_embed equivalent.

  /**
   * Resolve the signing-status string from the engine's manifest_signed event
   * lookup. Pure function — no HTTP / no FS / no c2pa-node imports.
   */
  function resolveSigningStatus(versionId: string, filename: string): string {
    const status = engine.getC2paStatusForVersion(versionId, filename);
    if (status === null) return 'unknown';
    if (status.signed) return 'signed';
    // status_reason is a server-trusted enum (one of 6 codes).
    // Defence-in-depth: empty string falls back to 'unknown' so a malformed
    // event row never surfaces as `unsigned:` (broken trailing colon).
    const reason = status.status_reason || 'unknown';
    return `unsigned:${reason}`;
  }

  /**
   * Shared resolution of (filename, contentType, filePath)
   * for both GET and HEAD on /api/versions/:id/output. Throws TypedError on
   * the same conditions as the original GET handler (OUTPUT_UNAVAILABLE,
   * INVALID_INPUT) — the error middleware converts to 4xx JSON identically
   * for both verbs.
   */
  function resolveOutputForVersion(versionId: string): {
    filename: string;
    contentType: string;
    filePath: string;
  } {
    const version = engine.getVersion(versionId); // throws VERSION_NOT_FOUND → 404

    const raw = version.entity.outputs_json;
    let parsed: Array<{ filename?: string }> = [];
    if (raw) {
      try {
        const maybe = JSON.parse(raw);
        parsed = Array.isArray(maybe) ? (maybe as Array<{ filename?: string }>) : [];
      } catch {
        parsed = [];
      }
    }
    if (parsed.length === 0 || !parsed[0]?.filename) {
      throw new TypedError(
        'OUTPUT_UNAVAILABLE',
        `No outputs recorded for version '${versionId}'`,
        'The output file may not have been downloaded. Use Reproduce Version to regenerate.',
      );
    }

    const storedFilename = parsed[0].filename;
    // Path-traversal defence: reject filenames containing path separators or traversal
    // sequences BEFORE basename normalization — defence-in-depth. basename
    // would strip `../../etc/passwd` to `passwd` (then fail existsSync), but
    // flagging the attack pattern explicitly surfaces it in logs.
    if (
      storedFilename.includes('..') ||
      storedFilename.includes('/') ||
      storedFilename.includes('\\')
    ) {
      throw new TypedError(
        'INVALID_INPUT',
        `Invalid output filename '${storedFilename}' — contains path separator or traversal sequence`,
        'This is a bug or tampering attempt. Check the version record.',
      );
    }
    const filename = path.basename(storedFilename);

    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_MAP[ext] ?? 'application/octet-stream';

    // Resolve against engine.outputRoot, not
    // the hardcoded literal. path.resolve handles both absolute and relative
    // outputRoot values — relative paths are resolved against process.cwd() at
    // call time, which matches the engine's behavior in output-downloader.ts.
    const filePath = path.resolve(engine.outputRoot, versionId, filename);
    if (!existsSync(filePath)) {
      throw new TypedError(
        'OUTPUT_UNAVAILABLE',
        `Output file missing from disk: ${filename}`,
        'The output file is missing. Provenance is still viewable. Use Reproduce Version to regenerate.',
      );
    }

    return { filename, contentType, filePath };
  }

  app.get('/api/versions/:id/output', (c) => {
    const versionId = c.req.param('id');
    const { filename, contentType, filePath } = resolveOutputForVersion(versionId);

    // Read manifest_signed event for X-C2PA-Signing-Status.
    const signingStatus = resolveSigningStatus(versionId, filename);

    const nodeStream = createReadStream(filePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return c.body(webStream, 200, {
      'Content-Type': contentType,
      // Output files are content-addressed by version_id — safe to cache
      // aggressively. The server wiring inherits this header.
      'Cache-Control': 'public, max-age=3600, immutable',
      // Signing-state header (purely additive; the byte-parity
      // invariant guarantees body bytes / Content-Type / Cache-Control are
      // byte-identical to the pre-signing baseline).
      'X-C2PA-Signing-Status': signingStatus,
    });
  });

  // HEAD /api/versions/:id/output returns the same headers
  // as GET (including X-C2PA-Signing-Status) without the body. The dashboard's
  // packages/dashboard/src/lib/api.ts getC2paStatus helper uses HEAD to read
  // the signing status without downloading file bytes.
  app.on('HEAD', '/api/versions/:id/output', (c) => {
    const versionId = c.req.param('id');
    const { filename, contentType } = resolveOutputForVersion(versionId);
    const signingStatus = resolveSigningStatus(versionId, filename);
    return c.body(null, 200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600, immutable',
      'X-C2PA-Signing-Status': signingStatus,
    });
  });

  // Thumbnail surface.
  //
  // GET /api/versions/:id/thumbnail — serves the cached 640x360 (max edge,
  // source aspect preserved) WebP for a completed version. Mirrors
  // the /output route shape but delegates to engine.generateThumbnail (which
  // runs the coalescing mutex + cache + format-router + sharp/ffmpeg
  // pipeline). Returns 503 + THUMBNAIL_FAILED envelope when
  // the engine returns null (sentinel suppresses retry until source mtime
  // advances — the dashboard onError handler swaps to <SkeletonThumbnail/>).
  //
  // Strong ETag is content-addressed via sha256 (when present in
  // outputs_json[0].sha256) or mtime: short-hash. Strong ETag invalidates
  // correctly on redact; immutable cuts the round-trip
  // when fresh.
  //
  // Path-traversal mitigation: resolveOutputForVersion (existing helper)
  // rejects '..' / '/' / '\\' in the stored filename BEFORE engine dispatch.
  // Byte-parity preserved: this route is purely additive — the
  // existing /output route is byte-unchanged.
  const THUMBNAIL_CACHE_CONTROL = 'public, max-age=31536000, immutable';

  app.get('/api/versions/:id/thumbnail', async (c) => {
    const versionId = c.req.param('id');
    const { filename } = resolveOutputForVersion(versionId);

    const result = await engine.generateThumbnail(versionId, filename);
    if (result === null) {
      // Sentinel branch — engine wrote .thumb.failed. Surface as 503 with
      // typed envelope; dashboard onError silently falls back to skeleton.
      throw new TypedError(
        'THUMBNAIL_FAILED',
        `Thumbnail generation failed or unsupported for version '${versionId}' (${filename})`,
        'The version is still viewable via the full-size /output route. Thumbnails will retry only when the source bytes change.',
      );
    }

    // 304 conditional GET — strong ETag is content-addressed via sha256 or
    // mtime: short-hash; browsers send If-None-Match on every navigation.
    const ifNoneMatch = c.req.header('If-None-Match');
    if (ifNoneMatch && ifNoneMatch === result.etag) {
      return c.body(null, 304, {
        ETag: result.etag,
        'Cache-Control': THUMBNAIL_CACHE_CONTROL,
      });
    }

    const nodeStream = createReadStream(result.filePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    return c.body(webStream, 200, {
      'Content-Type': result.contentType,
      'Cache-Control': THUMBNAIL_CACHE_CONTROL,
      ETag: result.etag,
    });
  });

  app.on('HEAD', '/api/versions/:id/thumbnail', async (c) => {
    const versionId = c.req.param('id');
    const { filename } = resolveOutputForVersion(versionId);

    const result = await engine.generateThumbnail(versionId, filename);
    if (result === null) {
      throw new TypedError(
        'THUMBNAIL_FAILED',
        `Thumbnail generation failed or unsupported for version '${versionId}' (${filename})`,
        'The version is still viewable via the full-size /output route.',
      );
    }
    return c.body(null, 200, {
      'Content-Type': result.contentType,
      'Cache-Control': THUMBNAIL_CACHE_CONTROL,
      ETag: result.etag,
    });
  });

  // --- Reproduce ---
  // POST /api/versions/:id/reproduce — returns 201 + version envelope.
  // Body is optional `{ notes?: string }`. Tolerates empty body (no body
  // headers, no JSON body) by defaulting to an empty object.
  app.post('/api/versions/:id/reproduce', async (c) => {
    const versionId = c.req.param('id');
    let notes: string | undefined;
    try {
      const body = (await c.req.json()) as { notes?: string } | null;
      notes = body?.notes;
    } catch {
      // Empty body / malformed JSON → treat as no notes.
      notes = undefined;
    }
    const result = await engine.reproduceVersion(versionId, notes);
    return c.json(result, 201);
  });

  // --- Approval gate (no silent credit spend) ---
  // GET /api/proposals?shot_id=&status=&limit=&offset= — the pending-spend queue.
  app.get('/api/proposals', (c) => {
    const q = c.req.query();
    const limit = q.limit ? Number.parseInt(q.limit, 10) : undefined;
    const offset = q.offset ? Number.parseInt(q.offset, 10) : undefined;
    // Validate status like the zod-checked MCP path — a typo'd filter must be a
    // 400, not a silently empty approval queue (review fix).
    if (q.status && !['proposed', 'approved', 'rejected'].includes(q.status)) {
      throw new TypedError(
        'INVALID_INPUT',
        `Invalid status '${q.status}' — expected proposed | approved | rejected.`,
      );
    }
    return c.json(
      engine.listProposals({
        shot_id: q.shot_id || undefined,
        status: (q.status as 'proposed' | 'approved' | 'rejected' | undefined) || undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
        offset: Number.isFinite(offset) ? offset : undefined,
      }),
    );
  });

  // POST /api/proposals/:id/approve — the decide-exactly-once claim + execute.
  app.post('/api/proposals/:id/approve', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { note?: string } | null;
    const result = await engine.approveProposal(c.req.param('id'), body?.note);
    return c.json(result, 201);
  });

  // POST /api/proposals/:id/reject — decide without executing.
  app.post('/api/proposals/:id/reject', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { note?: string } | null;
    return c.json(engine.rejectProposal(c.req.param('id'), body?.note));
  });

  // --- Assets ---
  // The asset read-queries validate against the SAME schema the MCP tool uses
  // (src/tools/asset-query-schema.ts). They used to hand the raw body straight
  // to the engine, which binds the values into SQL — so the documented empty
  // body `{}` came back as 500 INTERNAL_ERROR "datatype mismatch", a raw SQLite
  // error, because limit/offset arrived undefined with no defaults applied. A
  // non-array `tags` did the same. Parsing here applies the defaults and turns
  // a bad body into an actionable 400.
  const parseAssetBody = <T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ path: PropertyKey[] }> } } }, raw: unknown): T => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success || parsed.data === undefined) {
      const field = parsed.error?.issues[0]?.path.join('.') ?? '';
      throw new TypedError(
        'INVALID_INPUT',
        field ? `Invalid value for '${field}'` : 'Invalid request body',
        "Body mirrors the asset tool's input: optional scope ids, optional tags[]/metadata[], limit (1-100), offset (>=0).",
      );
    }
    return parsed.data;
  };

  // POST /api/assets/query — body mirrors `asset.query` MCP input.
  app.post('/api/assets/query', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(engine.queryAssets(parseAssetBody(AssetQueryBody, body)));
  });

  // POST /api/assets/list_tags — body mirrors `asset.list_tags` MCP input.
  app.post('/api/assets/list_tags', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(engine.listTags(parseAssetBody(ListTagsBody, body)));
  });

  // POST /api/assets/list_metadata_keys — body mirrors `asset.list_metadata_keys`.
  app.post('/api/assets/list_metadata_keys', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(engine.listMetadataKeys(parseAssetBody(ListMetadataKeysBody, body)));
  });

  // --- Dashboard home ---
  app.get('/api/dashboard/home', (c) => {
    return c.json(engine.getDashboardHome());
  });

  return app;
}
