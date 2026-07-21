#!/usr/bin/env node
import 'dotenv/config';
/**
 * vellum entry point.
 *
 * Dual-transport bootstrap:
 *   - stdio transport ALWAYS, long-lived (D-15)
 *   - Streamable HTTP on 127.0.0.1:<port> when --http is passed (D-16, T-03-03)
 *
 * Both transports expose the SAME 7 tools (workspace, project, sequence, shot,
 * generation, version, asset) against the SAME process-wide engine (so SQLite
 * writes from either path land in the same db). Tool identity is guaranteed by
 * the shared `buildServer()` factory — it's the only place the 7 register*
 * functions are called, and both transports route through it.
 *
 * Implementation note on MCP SDK 1.29 Protocol invariant:
 *   The SDK's Protocol._transport enforces a one-transport-per-server rule
 *   (see node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js#L215).
 *   We therefore create ONE long-lived McpServer for stdio and a FRESH
 *   McpServer per HTTP request (the canonical stateless pattern from the SDK
 *   examples at modelcontextprotocol/typescript-sdk). Both servers share the
 *   same Engine / HierarchyRepo / VersionRepo / db, so state is process-wide
 *   consistent.
 *
 * Phase 2 additions:
 *   - `import 'dotenv/config'` on line 2 (Pitfall 2 — must precede every
 *     relative import; module hoisting in Node ESM evaluates imports before
 *     top-level code).
 *   - Optional ComfyUIClient wiring from COMFYUI_API_KEY + COMFYUI_API_BASE env.
 *     When COMFYUI_API_KEY is absent, client is null; hierarchy tools still
 *     work; `generation submit` returns COMFYUI_CREDENTIALS_MISSING on first
 *     call (D-GEN-10, D-GEN-14 — silent-if-missing preserves TRNS-04).
 *   - engine.start() kicks the recovery poller for pending rows from prior
 *     runs before any transport accepts client traffic (D-GEN-29).
 *   - SIGINT/SIGTERM → engine.stop() → process.exit(0) (D-GEN-29 — abort all
 *     in-flight pollers gracefully).
 *   - Credential-presence stderr log at boot IF key is set. Format per D-GEN-12:
 *     `ComfyUI credentials loaded (key ****<last4>, base <base>)`.
 *
 * Deviation from literal D-GEN-12: CONTEXT.md says "on the first submit per
 * process", but the honest implementation logs at boot when the key is present.
 * Engine-side first-submit tracking would couple the engine to a logging
 * concern — violating architecture-purity (D-33). D-GEN-14 (silent if .env
 * missing) is preserved by the `if (apiKey)` branch; the presence-only intent
 * of D-GEN-12 is preserved by the exact format (last-4 only, never the key).
 *
 * Logging: stderr-only (D-21). stdout reserved for MCP JSON-RPC framing on stdio.
 * Credential hygiene: the KEY value is NEVER logged; only the last 4 chars +
 * the base URL (D-GEN-12). Extended stdio-hygiene test asserts no
 * `COMFYUI_API_KEY=` substring ever reaches stdout/stderr.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { toReqRes, toFetchResponse } from 'fetch-to-node';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseCliFlags, printHelp } from './utils/cli.js';
import { openDb } from './store/db.js';
import { HierarchyRepo } from './store/hierarchy-repo.js';
import { VersionRepo } from './store/version-repo.js';
import { ProvenanceRepo } from './store/provenance-repo.js';
import { ComfyUIClient, DEFAULT_COMFYUI_API_BASE } from './comfyui/client.js';
import type { GenerationProvider } from './providers/provider.js';
import { loadProviderConfig, createProvider } from './providers/config.js';
import { validateBaseUrlFromEnv } from './utils/validate-base-url.js';
import { loadC2paConfigFromEnv } from './utils/c2pa-config.js';
import { loadAnthropicConfigFromEnv } from './utils/anthropic-config.js';
import { basename } from 'node:path';
import { Engine } from './engine/pipeline.js';
import {
  registerWorkspace,
  registerProject,
  registerSequence,
  registerShot,
  registerGeneration,
  registerVersion,
  registerAsset,
} from './tools/index.js';
import { registerResources } from './tools/resources.js';
// Phase 5 Plan 05-06: dashboard HTTP surface (D-WEBUI-01 / D-WEBUI-12).
// Dashboard REST + SSE + static share the same Hono app as the /mcp route;
// mount order below is load-bearing — SSE before REST router, REST before
// the /* static catch-all. See Plan 05-06 SUMMARY for the full rationale.
import { createDashboardRouter, typedErrorHandler, createWebhookRouter } from './http/index.js';
import { createSseHandler } from './http/sse.js';
import { createStaticHandler } from './http/static.js';

/**
 * Read version from package.json — single source of truth, no hardcoded duplicate.
 * Resolves relative to the compiled/executed module url, so it works both when
 * run via `npx tsx src/server.ts` (from repo root) and from an installed bin.
 */
async function readVersion(): Promise<string> {
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(await readFile(pkgUrl, 'utf8')) as { version: string };
  return pkg.version;
}

/**
 * Construct a fresh McpServer with the 7 Phase 1 + Phase 2 + Phase 3 + Phase 4
 * tools registered against the supplied engine. Single source of tool identity —
 * both stdio and each HTTP request route through this factory, so transport
 * parity is guaranteed by construction (Pitfall #7). Zero transport-specific
 * branching inside.
 */
function buildServer(engine: Engine, version: string): McpServer {
  const server = new McpServer(
    { name: 'vellum', version },
    {
      instructions:
        'Vellum — a provider-agnostic asset-production + provenance layer. Manages a hierarchy (workspace → project → sequence → shot → version → output) with append-only provenance on top of any generation backend (ComfyUI, Replicate, …). ' +
        'Read resource vellum://manual for a full guide, vellum://capabilities for the machine-readable tool/provider surface, and vellum://output-contract for how to register an externally-produced output. ' +
        'Hierarchy tools: workspace/project/sequence/shot with action: create | list | get (shot also set_status). ' +
        'Generation tool: generation with action: submit | status | reproduce | iterate | register. ' +
        'register reports an output produced OUTSIDE this server (any provider or sibling workflow) into a shot as a completed version — see vellum://output-contract. ' +
        "reproduce re-runs a completed version's prompt verbatim (byte-identical) and returns reproduction_warnings[]. " +
        'iterate applies node-scoped overrides { "<nodeId>": { inputs?, class_type? } } and/or a seed shortcut to a source version, re-validates, and submits. ' +
        'Version tool: version with action: get | list | diff | provenance. ' +
        'Asset tool: asset with action: add_tag | remove_tag | set_metadata | remove_metadata | query | list_tags | list_metadata_keys. ' +
        'add_tag/remove_tag/set_metadata/remove_metadata return the refreshed version with inline tags + metadata. ' +
        'query filters AND-only across tags/metadata/scope/date/status with paginated results. ' +
        'list_tags/list_metadata_keys aggregate names with counts for discovery. ' +
        'Every response carries a breadcrumb from workspace to the affected entity.',
    },
  );
  registerWorkspace(server, engine);
  registerProject(server, engine);
  registerSequence(server, engine);
  registerShot(server, engine);
  registerGeneration(server, engine);
  registerVersion(server, engine);
  registerAsset(server, engine);
  // Pivot Phase E — self-describing MCP resources (vellum://manual, /capabilities,
  // /output-contract). Zero tool slots; the idiomatic home for agent onboarding.
  registerResources(server, version);
  // RT-09 / API-06: SDK's registerTool unconditionally merges
  // `capabilities.tools.listChanged: true` into the server's capability set,
  // but we never emit `notifications/tools/list_changed`. Override back to
  // false AFTER all tools registered (must precede transport connect — the
  // SDK throws otherwise). Subscribed clients will not wait forever.
  server.server.registerCapabilities({
    tools: { listChanged: false },
    resources: { listChanged: false },
  });
  return server;
}

async function main(): Promise<void> {
  const args = parseCliFlags(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    console.error(await readVersion());
    process.exit(0);
  }

  // Db init — auto-creates if missing, applies WAL + schema (D-18, TRNS-04).
  // openDb() returns { db, sqlite } — always destructure. Passing the object
  // directly to HierarchyRepo crashes on first query (db.select undefined).
  //
  // Rename back-compat (VFX Familiar -> Vellum): the default filename moved from
  // ./vfx-familiar.db to ./vellum.db. When no --db is given and ONLY the legacy
  // file exists, adopt it in place so a pre-rename database is not silently
  // orphaned behind an empty new default. An explicit --db always wins.
  const LEGACY_DB_PATH = './vfx-familiar.db';
  const DEFAULT_DB_PATH = './vellum.db';
  const dbPath =
    args.db ??
    (!existsSync(DEFAULT_DB_PATH) && existsSync(LEGACY_DB_PATH)
      ? LEGACY_DB_PATH
      : DEFAULT_DB_PATH);
  const { db } = openDb(dbPath);
  console.error(`vellum: db=${dbPath}`);

  const repo = new HierarchyRepo(db);
  const versionRepo = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);

  // Optional ComfyUI client — built only if COMFYUI_API_KEY is set (D-GEN-10,
  // D-GEN-14). Absent key ⇒ hierarchy tools work; `generation submit` surfaces
  // COMFYUI_CREDENTIALS_MISSING on first call.
  const apiKey = process.env.COMFYUI_API_KEY;
  const apiBase = process.env.COMFYUI_API_BASE ?? DEFAULT_COMFYUI_API_BASE;
  // IS-02: fail-fast on misconfigured base URL. Validates protocol, blocks
  // loopback / RFC1918 / link-local targets unless explicit env overrides are
  // set. Runs even when COMFYUI_API_KEY is absent so surprise misconfigs
  // surface immediately instead of on the first submit call.
  validateBaseUrlFromEnv(apiBase);
  const additionalAllowedHosts = (process.env.COMFYUI_ALLOWED_REDIRECT_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let client: GenerationProvider | null = apiKey
    ? new ComfyUIClient(apiKey, apiBase, { additionalAllowedHosts })
    : null;

  // Credential presence log — last 4 ONLY (D-GEN-12). Format is exact per
  // CONTEXT.md §Specifics. Emitted at boot when key is present; silent when
  // absent (D-GEN-14). Engine never reads process.env — credentials flow
  // through the ComfyUI client constructor.
  if (apiKey) {
    const last4 = apiKey.slice(-4);
    console.error(
      `vellum: ComfyUI credentials loaded (key ****${last4}, base ${apiBase})`,
    );
  }

  // Multi-provider routing (10-ton P0): the registry discovers ALL configured
  // backends; every one is constructed and handed to the engine, which routes
  // submit/status/reproduce per version. `client` stays the DEFAULT provider
  // (ComfyUI wins when configured — back-compat, byte-identical boot path).
  const providerRegistry = loadProviderConfig(process.env);
  const providers = new Map<string, GenerationProvider>();
  for (const cfg of providerRegistry.providers) {
    // Reuse the already-constructed ComfyUI client (identical construction);
    // build every other configured backend via the factory.
    const p = cfg.id === 'comfyui-cloud' && client ? client : createProvider(cfg);
    providers.set(cfg.id, p);
    if (cfg.id !== 'comfyui-cloud') {
      // ComfyUI's presence was already logged above (D-GEN-12 format).
      console.error(
        `vellum: provider '${cfg.id}' configured (key ****${cfg.apiKey.slice(-4)}, base ${cfg.apiBase})`,
      );
    }
  }
  if (
    providerRegistry.defaultProviderId &&
    providerRegistry.defaultProviderId !== 'comfyui-cloud'
  ) {
    client = providers.get(providerRegistry.defaultProviderId) ?? null;
    console.error(
      `vellum: default generation provider is '${providerRegistry.defaultProviderId}'`,
    );
  }

  // C6: concurrency cap for the on-start recovery poller. Env override allows
  // Pro tier users to raise the ceiling. Default (3) matches the Creator tier.
  const maxConcurrentPollersRaw = process.env.COMFYUI_MAX_CONCURRENT_POLLS;
  const maxConcurrentPollers = maxConcurrentPollersRaw
    ? Number.parseInt(maxConcurrentPollersRaw, 10)
    : undefined;

  // Phase 14 — PROV-V-01 / PROV-V-02 / PROV-V-05 (D-CTX-2). Boot-time C2PA
  // cert/key validation. Throws TypedError('C2PA_CONFIG_INVALID', ...) BEFORE
  // any Engine construction or tool registration when env vars are set but
  // any path is missing / unreadable / empty / OUTSIDE the allowlist root.
  // Returns null when both env vars are unset → signing is disabled silently.
  // Concern #4 mitigation (path-traversal / arbitrary-file-disclosure): the
  // helper realpath-resolves both paths and asserts they live inside the
  // allowlist root (cwd by default; VELLUM_C2PA_CERT_ROOT optional override).
  // Concern #11 mitigation (native-binding-load resilience): server boot does
  // NOT eagerly load c2pa-node here — the native module load is deferred to
  // Plan 14-02's signer module on first sign attempt.
  const c2paConfig = loadC2paConfigFromEnv();
  if (c2paConfig) {
    // Concern #4: log basenames ONLY, never the full resolved path.
    // MR-01 fix: surface TSA URL choice (operator-controllable via
    // VELLUM_C2PA_TSA_URL). When unset, the engine passes null to
    // loadSigner — c2pa-node v0.5.26's binding bug then surfaces as
    // status_reason='sign_call_failed' on every sign attempt. Operators
    // who haven't configured a TSA see a clear breadcrumb here.
    const tsaSummary = c2paConfig.tsaUrl
      ? `tsa ${c2paConfig.tsaUrl}`
      : 'tsa <unset — set VELLUM_C2PA_TSA_URL to enable RFC 3161 timestamping>';
    console.error(
      `vellum: C2PA signing enabled (cert ${basename(c2paConfig.certPemPath)}, key ${basename(c2paConfig.privateKeyPemPath)}, ${tsaSummary})`,
    );
  }

  // Phase 19 — SUM-01..06. Anthropic API key loading + boot validation.
  // Throws TypedError('ANTHROPIC_CONFIG_INVALID', ...) BEFORE any Engine
  // construction or tool registration when env var is set but malformed.
  // Returns null when ANTHROPIC_API_KEY is unset → summary feature disabled
  // silently (D-FB-2 graceful degradation; engine returns SummaryOutcome=
  // fallback reason='api_key_missing' on every call).
  //
  // Boot does NOT eagerly load @anthropic-ai/sdk — the SDK module load is
  // deferred to Plan 19-04's anthropic-client.ts on first user-facing call.
  // This is the boot-resilience invariant verified by the architecture-purity
  // grep guard `src/server.ts has zero static imports from @anthropic-ai/sdk`.
  const anthropicConfig = loadAnthropicConfigFromEnv();
  if (anthropicConfig) {
    // Last-4 only in success log — same hygiene as the TypedError messages
    // (D-PRIV-4 mirrors c2pa-config basename-only path discipline).
    const last4 = anthropicConfig.apiKey.slice(-4);
    console.error(
      `vellum: AI summary enabled (Anthropic ****${last4}, model claude-haiku-4-5-20251001)`,
    );
  }

  // Phase 14 Plan 14-05 — outputs root is configurable via
  // VELLUM_OUTPUTS_DIR for ops + multi-tenant deployments. Default
  // 'outputs' relative to cwd (D-WEBUI-26 stable download root pattern).
  // Tests rely on this to redirect outputs to a temp dir. Mirrors the
  // VELLUM_MODELS_DIR convention.
  const outputsDir = process.env.VELLUM_OUTPUTS_DIR ?? 'outputs';
  const engine = new Engine(db, repo, versionRepo, provenanceRepo, client, outputsDir, {
    // Multi-provider routing: the full configured-provider map (default = client).
    providers,
    // Approval gate (10-ton "no silent credit spend"): VELLUM_REQUIRE_APPROVAL=1
    // refuses direct submit/reproduce/iterate — every generation runs through
    // propose → human review → approve (decide-exactly-once).
    requireApproval:
      process.env.VELLUM_REQUIRE_APPROVAL === '1' ||
      process.env.VELLUM_REQUIRE_APPROVAL === 'true',
    maxConcurrentPollers: Number.isFinite(maxConcurrentPollers) ? maxConcurrentPollers : undefined,
    // Pivot Phase D — operator-supplied extra ingest hosts for registerExternalOutput
    // (additive to the built-in known provider delivery hosts). Comma-separated.
    ingestAllowedHosts: (process.env.VELLUM_INGEST_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Per-output ingest byte cap (URL fetches + direct-bytes uploads). Unset →
    // engine default. Raise for large video checkpoint samples (Modal ingest).
    ingestMaxBytes: (() => {
      const raw = Number.parseInt(process.env.VELLUM_INGEST_MAX_BYTES ?? '', 10);
      return Number.isFinite(raw) && raw > 0 ? raw : undefined;
    })(),
    // Phase 13 — PROV-V-03 (D-CTX-2). When unset, every entry records
    // 'models_dir_not_configured' per D-CTX-5. Production (ComfyUI Cloud)
    // ships with this unset; local-dev / self-host can populate hashes by
    // setting VELLUM_MODELS_DIR to the local checkpoints/loras root.
    modelsDir: process.env.VELLUM_MODELS_DIR ?? null,
    // Phase 14 — PROV-V-01 (D-CTX-2). NULL means signing is disabled
    // (graceful degradation). Plan 14-02's signer wrapper is the SOLE
    // consumer of the cert/key bytes — read lazily on first sign attempt.
    c2paConfig,
    // Phase 19 — SUM-01..06. NULL means summarization is disabled
    // (graceful degradation; D-FB-2). The summary/anthropic-client.ts
    // wrapper is the SOLE consumer of the API key — loaded lazily on
    // first Engine.summarizeVersion call.
    anthropicConfig,
  });
  const version = await readVersion();

  // Recovery poller (D-GEN-29) — runs once at boot, drains any pending rows
  // from prior runs. No-op if version table has no non-terminal rows.
  await engine.start();

  // Shutdown handlers (D-GEN-29) — abort all AbortControllers in the engine,
  // then exit 0. Stops the process cleanly even with in-flight pollers.
  const shutdown = async (signal: string): Promise<void> => {
    console.error(`vellum: ${signal} received — shutting down`);
    try {
      await engine.stop();
    } catch (err) {
      console.error('vellum: stop error:', err);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  // Transport 1 — stdio, always on (D-15). One long-lived McpServer.
  const stdio = new StdioServerTransport();
  const stdioServer = buildServer(engine, version);
  await stdioServer.connect(stdio);
  console.error('vellum: stdio transport connected');

  // Transport 2 — Streamable HTTP, opt-in via --http (D-16).
  // Per the MCP SDK stateless pattern, a fresh McpServer + transport is spawned
  // per request; all share the same engine/db for consistent state.
  if (args.http) {
    const port = args.port ?? 3000;
    const app = new Hono();
    // SEC-03: Origin-header allowlist for DNS-rebinding / CSRF mitigation.
    // Non-browser MCP clients (Claude Desktop, Cursor, CLI) do not send
    // Origin — they are always allowed. Browser tabs always send Origin, so
    // any unfamiliar value is rejected with a 403 + actionable hint.
    const httpAllowedOrigins = (process.env.HTTP_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // RT-07 / API-07: wrong-verb requests to /mcp get a JSON-RPC-shaped 405
    // instead of Hono's text/plain 404 default. Agents can parse the envelope
    // even on misuse.
    app.on(['GET', 'DELETE', 'PUT', 'PATCH'], '/mcp', (c) =>
      c.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: `Method ${c.req.method} not allowed on /mcp — use POST for JSON-RPC.`,
          },
          id: null,
        },
        405,
      ),
    );
    app.post('/mcp', async (c) => {
      const origin = c.req.header('origin');
      if (origin && !httpAllowedOrigins.includes(origin)) {
        return c.json(
          {
            error: 'Forbidden origin',
            hint: 'Add origin to HTTP_ALLOWED_ORIGINS env var (comma-separated) to allow browser access',
          },
          403,
        );
      }
      const { req, res } = toReqRes(c.req.raw);
      const requestServer = buildServer(engine, version);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode per STACK.md / mcp-hono-stateless
      });
      // RT-06: per-request McpServer + transport are disposable; close both on
      // client disconnect AND in the try/finally wrapper below so a thrown
      // handleRequest (disconnect, bad framing) doesn't leak them to V8's GC.
      res.on('close', () => {
        void transport.close().catch(() => {});
        void requestServer.close().catch(() => {});
      });
      try {
        await requestServer.connect(transport);
        await transport.handleRequest(req, res);
        return toFetchResponse(res);
      } finally {
        await transport.close().catch(() => {});
        await requestServer.close().catch(() => {});
      }
    });

    // Phase 5 Plan 05-06 dashboard mount sequence (D-WEBUI-12 mount order).
    //
    // The order below is load-bearing:
    //   1. /mcp handlers (registered above) — existing MCP JSON-RPC surface.
    //   2. app.onError(typedErrorHandler) — must be registered BEFORE the
    //      dashboard routes so TypedError throws inside the router convert to
    //      the structured { error: { code, message } } JSON body with the
    //      correct HTTP status (Plan 05-03).
    //   3. /api/events (SSE) — MUST come before /api/* REST routes. Hono's
    //      trie matches the most specific route, so this ordering is actually
    //      insurance against future wildcard routes; today /api/events is
    //      distinct enough that either order works, but the contract is
    //      specific-before-generic.
    //   4. /api/* (dashboard REST) — mounted at ROOT, not at '/api', because
    //      dashboard-routes.ts registers its 18 routes with FULL /api/ paths
    //      (app.get('/api/workspaces'), etc.). Mounting at '/api' would
    //      double-prefix to /api/api/workspaces — Rule 1 fix against the plan's
    //      reference code. The test fixture (dashboard-routes.test.ts#57)
    //      uses app.route('/', router) for the same reason.
    //   5. /* (static catch-all) — LAST. Serves Preact dashboard assets from
    //      packages/dashboard/dist/ or fallback HTML when unbuilt. Registered
    //      via app.use so serveStatic runs as middleware rather than a
    //      terminal route handler.
    //
    // All three mounts share `engine` + `httpAllowedOrigins` for parity with
    // the /mcp origin-allowlist check. SSE passes the allowlist verbatim; the
    // REST router inherits it implicitly via the app-level origin policy the
    // browser enforces via CORS.
    app.onError(typedErrorHandler);
    app.get('/api/events', createSseHandler(engine, httpAllowedOrigins));
    // Pivot #3 — bearer-gated provider-webhook ingest (POST /webhooks/:provider →
    // registerExternalOutput). Disabled unless VELLUM_INGEST_TOKEN is set. Mounted
    // before the static catch-all so /webhooks/* is not swallowed by serveStatic.
    app.route('/', createWebhookRouter(engine, { ingestToken: process.env.VELLUM_INGEST_TOKEN }));
    app.route('/', createDashboardRouter(engine));
    app.use('/*', createStaticHandler());

    // NOTE: do not log request bodies here — future phases will carry ComfyUI
    // keys in headers (T-03-04 reminder).
    // Bind 127.0.0.1 explicitly (T-03-03) — no remote reachability until auth lands.
    //
    // RT-04: attach a listeningListener so the "listening on …" log only fires
    // on successful bind, AND subscribe to the error event so EADDRINUSE /
    // EACCES / ERR_SOCKET_BAD_PORT don't crash the stdio path with an
    // unhandled error. The process exits 1 with an actionable message.
    const httpServer = serve(
      {
        fetch: app.fetch,
        port,
        hostname: '127.0.0.1',
      },
      (info) => {
        console.error(
          `vellum: http transport listening on http://${info.address}:${info.port}/mcp`,
        );
      },
    );
    httpServer.on('error', (err: Error) => {
      console.error(`vellum: HTTP bind failed on port ${port}: ${err.message}`);
      process.exit(1);
    });
  }
}

main().catch((err) => {
  // Any boot-time error to stderr, non-zero exit.
  console.error('vellum: fatal boot error:', err);
  process.exit(1);
});
