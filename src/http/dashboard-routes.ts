// Phase 5 Plan 04: Hono sub-router exposing all 18 dashboard REST routes
// (D-WEBUI-01 + D-WEBUI-05). Thin delegation layer over the Engine facade —
// every route either
//   (a) parses Hono context (params/query/body),
//   (b) calls an Engine method, and
//   (c) returns the Engine result as JSON,
// or throws a TypedError that `typedErrorHandler` converts to a structured
// 4xx/5xx response (D-WEBUI-32).
//
// Architecture purity (D-WEBUI-28 + D-WEBUI-31): this file has ZERO MCP SDK
// imports and zero SQLite imports (ORM + driver). All data moves through
// the Engine interface. Docstring phrasing per Plan 04-03 convention:
// avoid sentinel package strings (MCP, ORM, DB driver) because
// architecture-purity.test.ts does substring grep against file text.
//
// One exception: GET /api/versions/:id/output — streams a binary file from
// disk via `fs.createReadStream`. This is the single FS-boundary route in the
// dashboard surface (D-WEBUI-33). Path is constructed as
// `outputs/<versionId>/<filename>`; the filename is pulled from the version's
// `outputs_json` field, then `path.basename()` is applied + validated so a
// malicious ComfyUI response cannot trigger path traversal (T-5-04).

import { Hono } from 'hono';
import { createReadStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import * as path from 'node:path';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';

/**
 * Extension → Content-Type map (D-WEBUI-33). Unknown extensions fall through
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
  // Phase 14 Plan 04 — read accessor for the X-C2PA-Signing-Status response
  // header. The HTTP layer NEVER signs; signing happens at write-time via the
  // engine downloader hook (Plan 14-03). This accessor returns the latest
  // manifest_signed event payload for the (versionId, filename) pair, or null.
  | 'getC2paStatusForVersion'
  // Phase 17 / Plan 17-03 — thumbnail derivation surface. The HTTP route at
  // GET/HEAD /api/versions/:id/thumbnail delegates to engine.generateThumbnail
  // which runs the coalescing mutex + cache + format-router + sharp/ffmpeg
  // pipeline (Plans 17-01 + 17-02). Returns null on derivation failure;
  // route surfaces 503 + THUMBNAIL_FAILED envelope in that case.
  | 'generateThumbnail'
>;

/**
 * Creates a Hono sub-router with all 18 dashboard REST routes wired to the
 * supplied Engine. The caller is responsible for mounting `typedErrorHandler`
 * via `app.onError(typedErrorHandler)` either on this router or on the parent
 * app — Plan 05-06 mounts at the server level so both REST + SSE inherit.
 *
 * Pagination defaults: limit=20, offset=0 (matches the MCP tool layer).
 */
export function createDashboardRouter(engine: EngineForDashboard): Hono {
  const app = new Hono();

  // SC-4 (Phase 6 gap_closure IN-01): parse a numeric query param with a default.
  // Throws TypedError('INVALID_INPUT', ...) at the HTTP boundary if the param
  // is present but not a non-negative integer (negatives, floats, non-numeric
  // all fail closed). Absent params still return the fallback so optional
  // ?limit/?offset don't suddenly become required (06-RESEARCH.md §Pitfall 4).
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

  // --- Workspaces ---
  app.get('/api/workspaces', (c) => {
    const limit = qNum(c.req.query('limit'), 20, 'limit');
    const offset = qNum(c.req.query('offset'), 0, 'offset');
    return c.json(engine.listWorkspaces(limit, offset));
  });

  app.get('/api/workspaces/:id', (c) => {
    return c.json(engine.getWorkspace(c.req.param('id')));
  });

  app.get('/api/workspaces/:id/projects', (c) => {
    const limit = qNum(c.req.query('limit'), 20, 'limit');
    const offset = qNum(c.req.query('offset'), 0, 'offset');
    return c.json(engine.listProjects(c.req.param('id'), limit, offset));
  });

  // --- Projects ---
  app.get('/api/projects/:id', (c) => {
    return c.json(engine.getProject(c.req.param('id')));
  });

  app.get('/api/projects/:id/sequences', (c) => {
    const limit = qNum(c.req.query('limit'), 20, 'limit');
    const offset = qNum(c.req.query('offset'), 0, 'offset');
    return c.json(engine.listSequences(c.req.param('id'), limit, offset));
  });

  // --- Sequences ---
  app.get('/api/sequences/:id', (c) => {
    return c.json(engine.getSequence(c.req.param('id')));
  });

  app.get('/api/sequences/:id/shots', (c) => {
    const limit = qNum(c.req.query('limit'), 20, 'limit');
    const offset = qNum(c.req.query('offset'), 0, 'offset');
    return c.json(engine.listShots(c.req.param('id'), limit, offset));
  });

  // --- Shots ---
  app.get('/api/shots/:id', (c) => {
    return c.json(engine.getShot(c.req.param('id')));
  });

  app.get('/api/shots/:id/versions', (c) => {
    const limit = qNum(c.req.query('limit'), 20, 'limit');
    // Phase 18 / Plan 18-02 TRANSITIONAL — Plan 18-03 replaces this block
    // entirely with Zod-parsed `?sort=` + `?cursor=` query params and adds
    // a typed cursor decoder at the boundary (T-18-02 mitigation). For now
    // the route forwards the engine defaults (DEFAULT_VERSION_SORT + null
    // cursor) so the wire-level surface stays stable for v1.1 dashboards
    // that still pass `?limit=&offset=`. Plan 18-02 keeps the offset query
    // param parsing for backward compatibility but ignores the value
    // (cursor pagination supersedes offset semantics). Plan 18-03 verifies
    // this TRANSITIONAL marker is removed.
    const _ignoredOffset = qNum(c.req.query('offset'), 0, 'offset');
    void _ignoredOffset;
    const include_tags = c.req.query('include_tags') === 'true';
    const include_metadata = c.req.query('include_metadata') === 'true';
    return c.json(
      engine.listVersionsForShot(c.req.param('id'), {
        sort: { field: 'completed_at', dir: 'desc' }, // TRANSITIONAL — Plan 18-03 parses ?sort=
        cursor: null,                                  // TRANSITIONAL — Plan 18-03 parses ?cursor=
        limit,
        include_tags,
        include_metadata,
      }),
    );
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
    // Phase 12 — engine.diffVersions is now async (reads disk for output
    // hashes when B is reproduce-lineage). Hono coerces the awaited Promise
    // into the response body via c.json.
    return c.json(await engine.diffVersions(c.req.param('id'), against));
  });

  // --- Output streaming ---
  // D-WEBUI-26 + D-WEBUI-33: not an Engine method — streams from disk at
  // `outputs/<versionId>/<filename>`. The filename is stored in the version's
  // `outputs_json` field as `[{filename, path, url, content_type, size_bytes}]`
  // (Plan 02 writes this via GenerationEngine.downloadAndPersist +
  // Engine.getGenerationStatus.downloadOutput).
  //
  // T-5-04 mitigation: after extracting the stored filename, apply
  // `path.basename()` + explicit `..` / separator checks before constructing
  // the fs path. Even a malicious ComfyUI response that sets filename to
  // `../../etc/passwd` is neutralised (basename strips to `passwd`; then
  // existsSync() returns false for the missing file → 404).
  //
  // Phase 14 Plan 04: response carries an `X-C2PA-Signing-Status` header
  // sourced from the latest `manifest_signed` provenance event written by the
  // Plan 14-03 engine downloader hook. The HTTP layer NEVER calls into
  // `c2pa-node`; it only READS the recorded signing outcome. Files are signed
  // at write-time, not read-time (D-CTX-8 → Plan 14-03 revision: dual-transport
  // parity for free, no signing latency on the hot HTTP path).
  //
  // Header value matrix:
  //   - 'signed'                                — manifest_signed event has signed=true
  //   - 'unsigned:<status_reason>'              — manifest_signed event has signed=false
  //                                               (signing_disabled / unsupported_format /
  //                                                cert_load_failed / sign_call_failed /
  //                                                native_binding_unavailable / etc.)
  //   - 'unknown'                               — no manifest_signed event recorded
  //                                               (legacy version, pre-Phase-14, or
  //                                                download still in progress)
  //
  // Both GET and HEAD methods set the header. HEAD returns no body (T-14-10
  // mitigation: header addition does NOT regress streaming bytes; HEAD is the
  // dashboard's lightweight status check via getC2paStatus in
  // packages/dashboard/src/lib/api.ts).
  //
  // v1.1 scope reduction (Plan 14-03 Concern #2): NO sidecar route in v1.1.
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
    // status_reason is a server-trusted enum (Plan 14-03 — one of 6 codes).
    // Defence-in-depth: empty string falls back to 'unknown' so a malformed
    // event row never surfaces as `unsigned:` (broken trailing colon).
    const reason = status.status_reason || 'unknown';
    return `unsigned:${reason}`;
  }

  /**
   * Phase 14 Plan 04: shared resolution of (filename, contentType, filePath)
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
    // T-5-04: reject filenames containing path separators or traversal
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

    // SC-2 (Phase 6 gap_closure WR-01): resolve against engine.outputRoot, not
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

    // Phase 14 Plan 04 — read manifest_signed event for X-C2PA-Signing-Status.
    const signingStatus = resolveSigningStatus(versionId, filename);

    const nodeStream = createReadStream(filePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return c.body(webStream, 200, {
      'Content-Type': contentType,
      // Output files are content-addressed by version_id — safe to cache
      // aggressively. Plan 05-06 server wiring inherits this header.
      'Cache-Control': 'public, max-age=3600, immutable',
      // Phase 14 Plan 04 — signing-state header (purely additive; T-14-10
      // mitigation guarantees body bytes / Content-Type / Cache-Control are
      // byte-identical to the pre-Phase-14 baseline).
      'X-C2PA-Signing-Status': signingStatus,
    });
  });

  // Phase 14 Plan 04 — HEAD /api/versions/:id/output returns the same headers
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

  // Phase 17 / Plan 17-03 — VIS-01 + VIS-02 + VIS-03 + VIS-06 surface.
  //
  // GET /api/versions/:id/thumbnail — serves the cached 640x360 (max edge,
  // source aspect preserved per D-04) WebP for a completed version. Mirrors
  // the /output route shape but delegates to engine.generateThumbnail (which
  // runs the coalescing mutex + cache + format-router + sharp/ffmpeg pipeline
  // from Plans 17-01 + 17-02). Returns 503 + THUMBNAIL_FAILED envelope when
  // the engine returns null (sentinel suppresses retry until source mtime
  // advances — the dashboard onError handler swaps to <SkeletonThumbnail/>).
  //
  // Strong ETag is content-addressed via sha256 (when present in
  // outputs_json[0].sha256) or mtime: short-hash. Strong ETag invalidates
  // correctly on Phase 16 redact (D-05 hook); immutable cuts the round-trip
  // when fresh.
  //
  // T-5-04 path-traversal mitigation: resolveOutputForVersion (existing helper)
  // rejects '..' / '/' / '\\' in the stored filename BEFORE engine dispatch.
  // T-14-10 byte-parity preserved: this route is purely additive — the
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

  // --- Assets ---
  // POST /api/assets/query — body mirrors `asset.query` MCP input.
  app.post('/api/assets/query', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(engine.queryAssets(body));
  });

  // POST /api/assets/list_tags — body mirrors `asset.list_tags` MCP input.
  app.post('/api/assets/list_tags', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(engine.listTags(body));
  });

  // POST /api/assets/list_metadata_keys — body mirrors `asset.list_metadata_keys`.
  app.post('/api/assets/list_metadata_keys', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(engine.listMetadataKeys(body));
  });

  // --- Dashboard home (D-WEBUI-01) ---
  app.get('/api/dashboard/home', (c) => {
    return c.json(engine.getDashboardHome());
  });

  return app;
}
