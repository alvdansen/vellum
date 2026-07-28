// Partial barrel for the src/http/ module.
//
// Re-exports a convenience subset of the HTTP layer's public surface; it is
// NOT the sole entry point — server.ts (and some tests) import individual
// files under src/http/ directly, and that is allowed. The architecture
// property that matters (zero MCP SDK, zero SQLite in this layer) is enforced
// by architecture-purity tests, not by funnelling imports through this file.
//
// Currently re-exports:
//   - `createDashboardRouter` — Hono sub-router with the dashboard REST routes.
//   - `typedErrorHandler` — the Hono `onError` handler that converts every
//      TypedError thrown below the route boundary into a `{ error: { code,
//      message } }` JSON body with the correct HTTP status.
//   - `statusForCode` — pure code → status mapping (exported for tests and
//      for cross-cutting wiring that wants to assemble expected responses
//      without instantiating a Hono app).
//   - `createWebhookRouter` — bearer-gated inbound ingest routes.
//
// Other modules in this directory (sse, static, local-guard, …) export
// directly from their own files.

export { createDashboardRouter } from './dashboard-routes.js';
export type { EngineForDashboard } from './dashboard-routes.js';
export { typedErrorHandler, statusForCode } from './error-middleware.js';
export { createWebhookRouter } from './webhooks.js';
export type { EngineForWebhooks, WebhookRouterOptions } from './webhooks.js';
