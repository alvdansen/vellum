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

import { Hono } from 'hono';
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

  return app;
}
