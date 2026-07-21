// Pivot enhancement #3 — provider-webhook ingest route.
//
// A bearer-token-gated HTTP entry point that maps an inbound "an asset finished"
// callback (from a provider webhook, a relay, or a sibling agent) into
// Engine.registerExternalOutput — the async-completion counterpart to the MCP
// `generation register` action. Same trust boundary as that action reused
// verbatim: each output is a public https URL fetched under the ingest host
// allowlist + size cap inside registerExternalOutput. The ADDITIONAL boundary
// here is network exposure, so the route is authenticated with a shared bearer
// token (VELLUM_INGEST_TOKEN) and DISABLED when that token is unset.
//
// PURITY: no MCP SDK, no SQLite/ORM (architecture-purity guards src/http/). Only
// Hono + Zod + node:crypto, like the rest of the HTTP layer + the tool layer.

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Breadcrumb, Version } from '../types/hierarchy.js';
import type { RegisterExternalOutputInput } from '../engine/generation.js';
// Shared input bounds — the SAME constants the MCP `generation register` action
// uses, so the two ingest paths cannot drift (shape.ts is pure: types + numbers).
import { MAX_ID_LENGTH, MAX_NOTES_LENGTH } from '../tools/shape.js';

/** Cap the buffered request body (defends the single Node process from an
 *  authenticated large-payload memory-exhaustion / DB-bloat DoS). Generous for a
 *  webhook: neutral provenance is a few KB at most. */
const MAX_BODY_BYTES = 256 * 1024;

/** Whole-request cap for the multipart upload route (direct-bytes ingest —
 *  checkpoint sample images/videos from a training run). Separate from the
 *  256KB JSON-webhook cap above, which stays untouched. */
const MAX_UPLOAD_BODY_BYTES = 64 * 1024 * 1024;

/** Max file parts per multipart upload — parity with the JSON route's
 *  outputs max(20). */
const MAX_UPLOAD_FILES = 20;

/** Provider id charset/length — parity with the MCP register `provider` field. */
const PROVIDER_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** The one engine method this router needs — keeps the HTTP layer decoupled. */
export interface EngineForWebhooks {
  registerExternalOutput(
    input: RegisterExternalOutputInput,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }>;
}

export interface WebhookRouterOptions {
  /** Shared secret required as `Authorization: Bearer <token>`. When absent/empty
   *  the route is disabled (every request → 503) so ingest is never unauthenticated. */
  ingestToken?: string;
  /** Test hook: override the multipart upload route's whole-request + per-file
   *  byte cap (default 64MB). Production callers should not set this. */
  maxUploadBytes?: number;
}

// Body mirrors the MCP `generation register` input MINUS `provider` (which comes
// from the :provider path param) and `action`. Kept in lockstep with RegisterInput
// in src/tools/generation-tool.ts.
const WebhookBodySchema = z.object({
  shot_id: z.string().min(1).max(MAX_ID_LENGTH),
  outputs: z
    .array(
      z.object({
        url: z.string().url().max(2048),
        filename: z.string().max(255).optional(),
        content_type: z.string().max(128).optional(),
      }),
    )
    .min(1)
    .max(20),
  provenance: z.record(z.string(), z.unknown()).optional(),
  external_job_ref: z.string().max(MAX_ID_LENGTH).optional(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
});

// The multipart upload route's 'meta' field — the JSON body MINUS `outputs`
// (files arrive as multipart parts instead). Field bounds mirror
// WebhookBodySchema so the two inbound HTTP paths cannot drift.
const UploadMetaSchema = z.object({
  shot_id: z.string().min(1).max(MAX_ID_LENGTH),
  provenance: z.record(z.string(), z.unknown()).optional(),
  external_job_ref: z.string().max(MAX_ID_LENGTH).optional(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
});

/** Constant-time bearer check, length-independent (compares SHA-256 digests). */
function bearerMatches(authHeader: string | undefined, expected: string): boolean {
  if (!authHeader) return false;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!m) return false;
  const provided = m[1];
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function errorBody(code: string, message: string, hint?: string): { error: { code: string; message: string; hint?: string } } {
  return { error: hint ? { code, message, hint } : { code, message } };
}

/** Shared gate for every webhook route: disabled-without-token (503) then
 *  constant-time bearer auth (401). Returns null when the request may proceed. */
function gateRequest(c: Context, token: string | undefined): Response | null {
  // 1. Disabled unless an ingest token is configured — never unauthenticated ingest.
  if (!token) {
    return c.json(
      errorBody(
        'WEBHOOK_INGEST_DISABLED',
        'Webhook ingest is disabled: VELLUM_INGEST_TOKEN is not set.',
        'Set VELLUM_INGEST_TOKEN in the server environment to enable POST /webhooks/:provider.',
      ),
      503,
    );
  }
  // 2. Bearer auth (constant-time).
  if (!bearerMatches(c.req.header('authorization'), token)) {
    return c.json(
      errorBody('UNAUTHORIZED', 'Missing or invalid bearer token.', 'Send Authorization: Bearer <VELLUM_INGEST_TOKEN>.'),
      401,
    );
  }
  return null;
}

/**
 * Hono sub-router exposing `POST /webhooks/:provider`. Mount on the parent app
 * (which owns `app.onError(typedErrorHandler)`); TypedErrors thrown by
 * registerExternalOutput (SHOT_NOT_FOUND / DOWNLOAD_FAILED / INVALID_INPUT) are
 * converted to the correct HTTP status by that shared handler.
 */
export function createWebhookRouter(
  engine: EngineForWebhooks,
  options: WebhookRouterOptions = {},
): Hono {
  const app = new Hono();
  const token = options.ingestToken?.trim();

  app.post(
    '/webhooks/:provider',
    // Bound the buffered body BEFORE the handler reads it — caps heap use + DB bloat.
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json(errorBody('PAYLOAD_TOO_LARGE', `Request body exceeds ${MAX_BODY_BYTES} bytes.`), 413),
    }),
    async (c) => {
    // 1+2. Disabled-without-token (503) then constant-time bearer auth (401).
    const gate = gateRequest(c, token);
    if (gate) return gate;
    // 3. Validate the body.
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(errorBody('INVALID_INPUT', 'Request body must be JSON.'), 400);
    }
    const parsed = WebhookBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        errorBody('INVALID_INPUT', `Invalid webhook body: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`),
        400,
      );
    }
    const provider = c.req.param('provider').trim();
    if (!PROVIDER_RE.test(provider)) {
      return c.json(
        errorBody('INVALID_INPUT', 'Provider must be 1–64 chars of [A-Za-z0-9._-].'),
        400,
      );
    }

    // 4. Delegate to the engine — reuses the ingest trust boundary (https + host
    //    allowlist + size cap). TypedErrors bubble to app.onError(typedErrorHandler).
    const body = parsed.data;
    const result = await engine.registerExternalOutput({
      shotId: body.shot_id,
      providerId: provider,
      outputs: body.outputs,
      provenance: body.provenance,
      externalJobRef: body.external_job_ref,
      notes: body.notes,
    });
    return c.json(result, 201);
    },
  );

  // Direct-bytes ingest (Modal training ingest) — multipart upload for callers
  // that cannot (or should not) host outputs at public URLs first. Same bearer
  // gate + provider validation; files become ByteOutputEntry inputs to
  // registerExternalOutput (no fetch, no SSRF surface).
  const maxUploadBytes = options.maxUploadBytes ?? MAX_UPLOAD_BODY_BYTES;
  app.post(
    '/webhooks/:provider/upload',
    bodyLimit({
      maxSize: maxUploadBytes,
      onError: (c) =>
        c.json(errorBody('PAYLOAD_TOO_LARGE', `Request body exceeds ${maxUploadBytes} bytes.`), 413),
    }),
    async (c) => {
      const gate = gateRequest(c, token);
      if (gate) return gate;

      const provider = c.req.param('provider').trim();
      if (!PROVIDER_RE.test(provider)) {
        return c.json(
          errorBody('INVALID_INPUT', 'Provider must be 1–64 chars of [A-Za-z0-9._-].'),
          400,
        );
      }

      // Parse the multipart body. { all: true } collects repeated 'files' parts
      // into an array instead of keeping only the last one.
      let form: Record<string, string | File | (string | File)[]>;
      try {
        form = await c.req.parseBody({ all: true });
      } catch (err) {
        // When the request streams without a Content-Length header, bodyLimit
        // errors the wrapped body stream mid-parse and expects the error to
        // propagate so its post-next() hook can emit the 413. Rethrow it.
        if ((err as Error)?.name === 'BodyLimitError') throw err;
        return c.json(
          errorBody(
            'INVALID_INPUT',
            'Request body must be multipart/form-data.',
            "Send a 'meta' JSON text field plus 1–20 'files' file parts.",
          ),
          400,
        );
      }

      // 'meta' — required JSON text field carrying everything except the bytes.
      const metaRaw = form['meta'];
      if (typeof metaRaw !== 'string') {
        return c.json(
          errorBody(
            'INVALID_INPUT',
            "Missing 'meta' text field.",
            `Send meta as a JSON string: { "shot_id": "…", "provenance"?: {…}, "external_job_ref"?: "…", "notes"?: "…" }`,
          ),
          400,
        );
      }
      let metaJson: unknown;
      try {
        metaJson = JSON.parse(metaRaw);
      } catch {
        return c.json(errorBody('INVALID_INPUT', "The 'meta' field must be valid JSON."), 400);
      }
      const meta = UploadMetaSchema.safeParse(metaJson);
      if (!meta.success) {
        return c.json(
          errorBody('INVALID_INPUT', `Invalid meta: ${meta.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`),
          400,
        );
      }

      // 'files' — 1..20 file parts.
      const filesRaw = form['files'];
      const parts = filesRaw === undefined ? [] : Array.isArray(filesRaw) ? filesRaw : [filesRaw];
      const files = parts.filter((p): p is File => p instanceof File);
      if (files.length !== parts.length) {
        return c.json(
          errorBody('INVALID_INPUT', "Every 'files' part must be a file upload, not a text field."),
          400,
        );
      }
      if (files.length === 0) {
        return c.json(
          errorBody('INVALID_INPUT', "At least one 'files' file part is required."),
          400,
        );
      }
      if (files.length > MAX_UPLOAD_FILES) {
        return c.json(
          errorBody('INVALID_INPUT', `Too many files: ${files.length} (max ${MAX_UPLOAD_FILES} per request).`),
          400,
        );
      }
      for (const f of files) {
        if (f.size > maxUploadBytes) {
          return c.json(
            errorBody('PAYLOAD_TOO_LARGE', `File '${f.name}' is ${f.size} bytes — exceeds the ${maxUploadBytes}-byte cap.`),
            413,
          );
        }
      }

      // Buffer each part (whole request is already capped) and hand the bytes to
      // the engine, which applies the identical path machinery + atomic writes as
      // the URL path. Filenames are sanitized again inside the engine.
      const outputs = await Promise.all(
        files.map(async (f, i) => ({
          bytes: new Uint8Array(await f.arrayBuffer()),
          filename: (f.name ?? '').trim() || `upload_${i}`,
          content_type: f.type || undefined,
        })),
      );

      const result = await engine.registerExternalOutput({
        shotId: meta.data.shot_id,
        providerId: provider,
        outputs,
        provenance: meta.data.provenance,
        externalJobRef: meta.data.external_job_ref,
        notes: meta.data.notes,
      });
      return c.json(result, 201);
    },
  );

  return app;
}
