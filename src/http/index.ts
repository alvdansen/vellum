// Phase 5 Plan 04 Task 2: public surface of the src/http/ module.
//
// Every downstream consumer (server.ts / Plan 05-06, tests, and future SSE or
// static-handler plans) imports from this barrel — NOT from individual files.
// Keeping the public surface in one place makes the HTTP layer's API easy to
// audit for architecture-purity (zero MCP SDK, zero SQLite).
//
// Currently exports:
//   - `createDashboardRouter` — Hono sub-router with all 18 REST routes.
//   - `typedErrorHandler` — the Hono `onError` handler that converts every
//      TypedError thrown below the route boundary into a `{ error: { code,
//      message } }` JSON body with the correct HTTP status.
//   - `statusForCode` — pure code → status mapping (exported for tests and
//      for cross-cutting wiring that wants to assemble expected responses
//      without instantiating a Hono app).
//
// Plans 05-05 (SSE) and 05-06 (static + server wiring) will extend this
// barrel with their own exports (`createSseHandler`, `createStaticHandler`).

export { createDashboardRouter } from './dashboard-routes.js';
export type { EngineForDashboard } from './dashboard-routes.js';
export { typedErrorHandler, statusForCode } from './error-middleware.js';
export { createWebhookRouter } from './webhooks.js';
export type { EngineForWebhooks, WebhookRouterOptions } from './webhooks.js';
