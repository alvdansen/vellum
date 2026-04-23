# Phase 5: Web Dashboard - Pattern Map

**Mapped:** 2026-04-23
**Files analyzed:** 42 new/modified files
**Analogs found:** 28 / 42

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/engine/events.ts` | utility | event-driven | `src/engine/breadcrumb.ts` | role-match |
| `src/engine/output-downloader.ts` | service | file-I/O | `src/comfyui/client.ts` lines 413-480 | role-match |
| `src/engine/pipeline.ts` (extend) | service | CRUD + event-driven | `src/engine/pipeline.ts` itself | self-extension |
| `src/engine/errors.ts` (extend) | utility | n/a | `src/engine/errors.ts` itself | self-extension |
| `src/http/index.ts` | utility | n/a | `src/tools/shape.ts` (barrel pattern) | partial |
| `src/http/dashboard-routes.ts` | controller | request-response | `src/tools/version-tool.ts` | exact |
| `src/http/sse.ts` | controller | event-driven | `src/server.ts` (Origin check) | partial |
| `src/http/static.ts` | middleware | request-response | `src/server.ts` (mount logic) | partial |
| `src/http/error-middleware.ts` | middleware | request-response | `src/tools/envelope.ts` (TypedError mapping) | role-match |
| `src/test-utils/fake-engine.ts` (extend) | utility | n/a | `src/test-utils/fake-comfyui-client.ts` | role-match |
| `src/test-utils/fixtures.ts` (extend) | utility | n/a | `src/test-utils/fixtures.ts` itself | self-extension |
| `src/http/__tests__/dashboard-routes.test.ts` | test | request-response | `src/__tests__/architecture-purity.test.ts` | partial |
| `src/http/__tests__/sse.test.ts` | test | event-driven | `src/__tests__/stdio-hygiene.test.ts` | partial |
| `src/http/__tests__/static.test.ts` | test | request-response | `src/__tests__/stdio-hygiene.test.ts` | partial |
| `src/engine/__tests__/events.test.ts` | test | event-driven | `src/__tests__/architecture-purity.test.ts` | partial |
| `src/engine/__tests__/output-downloader.test.ts` | test | file-I/O | `src/__tests__/stdio-hygiene.test.ts` (bootAndKill) | partial |
| `src/__tests__/architecture-purity.test.ts` (extend) | test | n/a | `src/__tests__/architecture-purity.test.ts` itself | self-extension |
| `src/server.ts` (extend) | config | request-response | `src/server.ts` itself | self-extension |
| `package.json` (extend) | config | n/a | n/a | no analog |
| `.gitignore` (extend) | config | n/a | n/a | no analog |
| `packages/dashboard/package.json` | config | n/a | n/a | GREENFIELD |
| `packages/dashboard/vite.config.ts` | config | n/a | n/a | GREENFIELD |
| `packages/dashboard/tsconfig.json` | config | n/a | n/a | GREENFIELD |
| `packages/dashboard/index.html` | config | n/a | n/a | GREENFIELD |
| `packages/dashboard/src/main.tsx` | component | n/a | n/a | GREENFIELD |
| `packages/dashboard/src/lib/api.ts` | service | request-response | n/a | GREENFIELD |
| `packages/dashboard/src/lib/events.ts` | service | event-driven | n/a | GREENFIELD |
| `packages/dashboard/src/types/events.ts` | utility | n/a | `src/engine/events.ts` (duplicated shape) | role-match |
| `packages/dashboard/src/state/activeGenerations.ts` | store | event-driven | n/a | GREENFIELD |
| `packages/dashboard/src/state/currentSelection.ts` | store | event-driven | n/a | GREENFIELD |
| `packages/dashboard/src/state/themePreference.ts` | store | n/a | n/a | GREENFIELD |
| `packages/dashboard/src/state/sidebarExpansion.ts` | store | n/a | n/a | GREENFIELD |
| `packages/dashboard/src/views/HomeView.tsx` | component | request-response | n/a | GREENFIELD |
| `packages/dashboard/src/views/ShotView.tsx` | component | request-response | n/a | GREENFIELD |
| `packages/dashboard/src/views/VersionDrawer.tsx` | component | request-response | n/a | GREENFIELD |
| `packages/dashboard/src/views/DiffDrawer.tsx` | component | request-response | n/a | GREENFIELD |
| `packages/dashboard/src/components/TreeSidebar.tsx` | component | event-driven | n/a | GREENFIELD |
| `packages/dashboard/src/components/VersionCard.tsx` | component | event-driven | n/a | GREENFIELD |
| `packages/dashboard/src/components/ActiveGenerationsPanel.tsx` | component | event-driven | n/a | GREENFIELD |
| `packages/dashboard/src/components/StatusPill.tsx` | component | n/a | n/a | GREENFIELD |
| `packages/dashboard/src/styles/theme.css` | config | n/a | n/a | GREENFIELD |
| `packages/dashboard/src/styles/motion.css` | config | n/a | n/a | GREENFIELD |

---

## Pattern Assignments

### `src/engine/events.ts` (utility, event-driven)

**Analog:** `src/engine/breadcrumb.ts`

**Thin-module pattern** — one class or typed factory, no MCP imports, no SQLite imports, pure engine layer. This file follows the exact same structural discipline as `breadcrumb.ts`: exported class or factory at the bottom, typed constructor params at the top.

**Import pattern from analog** (`src/engine/breadcrumb.ts` lines 1-6):
```typescript
import type { HierarchyRepo } from '../store/hierarchy-repo.js';
import type { VersionRepo } from '../store/version-repo.js';
import type { BreadcrumbEntry, Breadcrumb, EntityType } from '../types/hierarchy.js';
import { TypedError } from './errors.js';
import { versionLabel } from '../utils/outputs.js';
```

**Class + factory pattern from analog** (`src/engine/breadcrumb.ts` lines 19-81):
```typescript
export class BreadcrumbResolver {
  constructor(
    private repo: HierarchyRepo,
    private versions: VersionRepo,
  ) {}

  resolve(type: EntityType, id: string): Breadcrumb {
    // ...typed switch, throw TypedError on not-found...
    return { entries, text: entries.map((e) => e.name).join(SEP) };
  }
}
```

**Template for `events.ts`** (from RESEARCH.md — use this skeleton verbatim since no exact codebase analog exists):
```typescript
import { EventEmitter } from 'node:events';
import type { BreadcrumbEntry } from '../types/hierarchy.js';

// Five event payload types locked by D-WEBUI-06
export interface VersionStatusChangedEvent {
  type: 'version.status_changed';
  version_id: string;
  shot_id: string;
  status: 'submitted' | 'running' | 'completed' | 'failed';
  breadcrumb: BreadcrumbEntry[];
  at: string;
}
export interface VersionCreatedEvent {
  type: 'version.created';
  version_id: string;
  shot_id: string;
  breadcrumb: BreadcrumbEntry[];
  at: string;
}
export interface TagChangedEvent {
  type: 'tag.changed';
  action: 'add' | 'remove';
  version_id: string;
  shot_id: string;
  tag: string;
  at: string;
}
export interface MetadataChangedEvent {
  type: 'metadata.changed';
  action: 'set' | 'remove';
  version_id: string;
  shot_id: string;
  key: string;
  at: string; // value deliberately omitted (D-WEBUI-06)
}
export interface HierarchyCreatedEvent {
  type: 'hierarchy.created';
  entity_type: 'workspace' | 'project' | 'sequence' | 'shot';
  entity_id: string;
  parent_id: string | null;
  at: string;
}

export type EngineEvent =
  | VersionStatusChangedEvent
  | VersionCreatedEvent
  | TagChangedEvent
  | MetadataChangedEvent
  | HierarchyCreatedEvent;

export type EngineEventMap = {
  [E in EngineEvent as E['type']]: E;
};

export interface EngineEmitter extends EventEmitter {
  emit<T extends keyof EngineEventMap>(type: T, payload: EngineEventMap[T]): boolean;
  on<T extends keyof EngineEventMap>(
    type: T,
    listener: (payload: EngineEventMap[T]) => void,
  ): this;
  off<T extends keyof EngineEventMap>(
    type: T,
    listener: (payload: EngineEventMap[T]) => void,
  ): this;
}

export function createEngineEmitter(): EngineEmitter {
  return new EventEmitter() as EngineEmitter;
}
```

**Architecture-purity invariant (D-WEBUI-31):** zero `@modelcontextprotocol/sdk` imports, zero `better-sqlite3` imports, zero HTTP framework imports. Same discipline as `breadcrumb.ts`.

---

### `src/engine/output-downloader.ts` (service, file-I/O)

**Analog:** `src/comfyui/client.ts` lines 413-480 (the `downloadToPath` method)

**Import pattern from analog** (`src/comfyui/client.ts` lines 413-421):
```typescript
// downloadToPath wraps fetch with: bearer auth header, SSRF guard,
// byte cap, atomic write (partial → rename). Phase 5 reuses the
// client instance and calls this method rather than re-implementing fetch.
async downloadToPath(
  filename: string,
  opts: { job_id: string; node_id?: string },
  destPath: string,
  options?: DownloadOptions,
): Promise<{ path: string; url: string; contentType: string; sizeBytes: number }>
```

**Core pattern (non-fatal wrapper)** — The downloader must be non-fatal: version marks completed regardless of download success. This is a hard requirement from D-WEBUI-26.

```typescript
import path from 'node:path';
import fs from 'node:fs/promises';
import type { ComfyUIClient } from '../comfyui/client.js';

/**
 * D-WEBUI-26: Download the ComfyUI output for a completed version.
 * Non-fatal — logs on failure, returns null. Version still marks completed.
 * Writes to: outputs/<versionId>/<filename>
 */
export async function downloadOutput(
  client: ComfyUIClient,
  versionId: string,
  outputsDir: string,
  jobId: string,
  filename: string,
): Promise<string | null> {
  const destDir = path.join(outputsDir, versionId);
  const destPath = path.join(destDir, filename);
  try {
    await fs.mkdir(destDir, { recursive: true });
    await client.downloadToPath(filename, { job_id: jobId }, destPath);
    return destPath;
  } catch (err) {
    console.error('[output-downloader] failed:', err);
    return null;
  }
}
```

**Architecture-purity invariant (D-WEBUI-31):** zero `@modelcontextprotocol/sdk` imports. Only `node:fs`, `node:path`, and the typed `ComfyUIClient` import.

---

### `src/engine/pipeline.ts` (extend — self)

**Integration points to add (do not rearrange existing code):**

1. **Constructor extension** (`src/engine/pipeline.ts` lines 83-118) — add at end of constructor:
```typescript
// Phase 5: typed event emitter — D-WEBUI-29
this.events = createEngineEmitter();
```

2. **Public field** (after constructor type declarations):
```typescript
public readonly events: EngineEmitter;
```

3. **Emit pattern on each mutation method** — copy this one-liner pattern after every DB write:
```typescript
// After DB write succeeds — fire and forget, never throws
this.events.emit('version.created', {
  type: 'version.created',
  version_id: result.version_id,
  shot_id: result.shot_id,
  breadcrumb: [], // resolve from BreadcrumbResolver.resolve('version', ...).entries
  at: new Date().toISOString(),
});
```

4. **Mutation → event mapping** (from D-WEBUI-29):
   - `createWorkspace` (line 124) → emit `hierarchy.created`, `entity_type: 'workspace'`, `parent_id: null`
   - `createProject` (line 155) → emit `hierarchy.created`, `entity_type: 'project'`, `parent_id: workspace_id`
   - `createSequence` (line 193) → emit `hierarchy.created`, `entity_type: 'sequence'`, `parent_id: project_id`
   - `createShot` (line 231) → emit `hierarchy.created`, `entity_type: 'shot'`, `parent_id: sequence_id`
   - `submitGeneration` (line 274) → emit `version.created`
   - `reproduceVersion` (line 442) → emit `version.created`
   - `iterateFromVersion` (line 450) → emit `version.created`
   - `addTag` (line 464) → emit `tag.changed`, `action: 'add'`
   - `removeTag` (line 469) → emit `tag.changed`, `action: 'remove'`
   - `setMetadata` (line 473) → emit `metadata.changed`, `action: 'set'`
   - `removeMetadata` (line 478) → emit `metadata.changed`, `action: 'remove'`
   - Status changes in `markCompleted` / recovery poller → emit `version.status_changed`

5. **Non-fatal downloader hook in `markCompleted`** — after provenance write, before return:
```typescript
// D-WEBUI-26: non-fatal download — do not await or catch inside pipeline
void downloadOutput(this.comfyClient, version.id, this.outputsDir, jobId, filename).catch(
  (err) => console.error('[pipeline] output download failed silently:', err),
);
```

---

### `src/engine/errors.ts` (extend — self)

**Current `ErrorCode` union** (`src/engine/errors.ts` lines 1-20):
```typescript
export type ErrorCode =
  | 'WORKSPACE_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'SEQUENCE_NOT_FOUND'
  | 'SHOT_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'GENERATION_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_SCOPE'
  | 'COMFYUI_CREDENTIALS_MISSING'
  | 'COMFYUI_API_ERROR'
  | 'VERSION_NOT_COMPLETED'
  | 'PROVENANCE_UNAVAILABLE'
  | 'TAG_NOT_FOUND'
  | 'METADATA_KEY_NOT_FOUND';
```

**Phase 5 addition** — append one literal to the union (D-WEBUI-34):
```typescript
  | 'OUTPUT_UNAVAILABLE';
```

**`TypedError` class** (`src/engine/errors.ts` lines 22-50 approximately):
```typescript
export class TypedError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'TypedError';
  }
}
```
REST error middleware catches `TypedError` — no change to this class needed.

---

### `src/http/dashboard-routes.ts` (controller, request-response)

**Analog:** `src/tools/version-tool.ts`

The REST route handler is the HTTP equivalent of an MCP tool: thin Zod-validated delegate → engine call → shape response. The key difference is the response wrapper: MCP uses `toolOk()`; REST uses `c.json()` directly (D-WEBUI-05).

**Import pattern from analog** (`src/tools/version-tool.ts` lines 1-16):
```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError } from './envelope.js';
import { versionLabel } from '../utils/outputs.js';
import {
  shapeList,
  MAX_ID_LENGTH,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from './shape.js';
```

**Adapted import pattern for `dashboard-routes.ts`** (drop MCP SDK imports, add Hono):
```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import {
  MAX_ID_LENGTH,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from '../tools/shape.js';
```

**Zod validation pattern from analog** (`src/tools/version-tool.ts` lines 23-71):
```typescript
const GetInput = z.object({
  action: z.literal('get'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
});
const VersionInputSchema = z.discriminatedUnion('action', [GetInput, ListInput, ...]);
```

**Adapted per-route schema pattern for REST** (inline schema per route, not discriminated union):
```typescript
const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

app.get('/versions/:id', async (c) => {
  const { id } = c.req.param();
  if (!id || id.length > MAX_ID_LENGTH) {
    throw new TypedError('INVALID_INPUT', `version_id must be 1-${MAX_ID_LENGTH} chars`);
  }
  const result = engine.getVersion(id);
  return c.json(shapeVersionEntity(result));
});
```

**Try/catch pattern from analog** (`src/tools/version-tool.ts` lines 191-231):
```typescript
async (rawInput) => {
  try {
    const input = VersionInputSchema.parse(rawInput);
    switch (input.action) {
      case 'get':
        return toolOk(shapeVersionEntity(engine.getVersion(input.version_id)));
      // ...
      default: {
        const _exhaustive: never = input;
        throw new TypedError('INVALID_INPUT', `Unhandled action: ${String(_exhaustive)}`);
      }
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      const path = first.path.join('.');
      return toolError(new TypedError('INVALID_INPUT', `Invalid input at 'input.${path}'`));
    }
    return toolError(err);
  }
}
```

**Adapted error pattern for REST routes** — errors are thrown, not returned. The Hono error middleware (`error-middleware.ts`) catches them:
```typescript
app.get('/versions/:id', async (c) => {
  const { id } = c.req.param();
  // ZodError or TypedError thrown here → caught by app.onError
  const parsed = PaginationSchema.parse(c.req.query());
  const result = engine.getVersion(id);
  return c.json(shapeVersionEntity(result));
});
```

**Shape function pattern from analog** (`src/tools/version-tool.ts` lines 86-102):
```typescript
function shapeVersionEntity(result: {
  entity: VersionWithAssets;
  breadcrumb: Breadcrumb;
}): {
  entity: VersionWithAssets & { version_label: string };
  breadcrumb: Breadcrumb['entries'];
  breadcrumb_text: string;
} {
  return {
    entity: {
      ...result.entity,
      version_label: versionLabel(result.entity.version_number),
    },
    breadcrumb: result.breadcrumb.entries,
    breadcrumb_text: result.breadcrumb.text,
  };
}
```

**REST route catalog** (16 routes from D-WEBUI-01 / CONTEXT.md `<specifics>`):
- `GET /api/workspaces` → `engine.listWorkspaces()`
- `GET /api/workspaces/:id` → `engine.getWorkspace(id)`
- `GET /api/workspaces/:id/projects` → `engine.listProjectsForWorkspace(id)`
- `GET /api/projects/:id` → `engine.getProject(id)`
- `GET /api/projects/:id/sequences` → `engine.listSequencesForProject(id)`
- `GET /api/sequences/:id` → `engine.getSequence(id)`
- `GET /api/sequences/:id/shots` → `engine.listShotsForSequence(id)`
- `GET /api/shots/:id` → `engine.getShot(id)`
- `GET /api/shots/:id/versions` → `engine.listVersionsForShot(id, limit, offset, { include_tags: true, include_metadata: true })`
- `GET /api/versions/:id` → `engine.getVersion(id)` (always-hydrated)
- `GET /api/versions/:id/provenance` → `engine.getProvenance(id)`
- `GET /api/versions/:id/diff?against=<other_id>` → `engine.diffVersions(id, against)`
- `GET /api/versions/:id/output` → stream file from disk (see `static.ts` pattern)
- `POST /api/versions/:id/reproduce` → `engine.reproduceVersion(id)` → 202 response
- `POST /api/assets/query` → `engine.queryAssets(body)`
- `POST /api/assets/list_tags` → `engine.listTags(body)`
- `POST /api/assets/list_metadata_keys` → `engine.listMetadataKeys(body)`
- `GET /api/dashboard/home` → aggregate: active + recent versions + workspaces

---

### `src/http/sse.ts` (controller, event-driven)

**Analog:** `src/server.ts` (Origin allowlist + Hono wiring, lines 232-262)

**Origin check pattern from analog** (`src/server.ts` lines 232-262):
```typescript
// From server.ts (boot phase)
const httpAllowedOrigins = (process.env.HTTP_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Per-request origin guard (inside route handler)
const origin = c.req.header('origin');
if (origin && !httpAllowedOrigins.includes(origin)) {
  return c.json({ error: 'Forbidden origin', hint: 'Set HTTP_ALLOWED_ORIGINS env var' }, 403);
}
```

**SSE handler template** (from RESEARCH.md skeleton — no exact codebase analog):
```typescript
import { stream } from 'hono/streaming';
import type { Engine } from '../engine/pipeline.js';
import type { EngineEvent } from '../engine/events.js';

export function createSseHandler(engine: Engine, allowedOrigins: string[]) {
  return async (c: Context) => {
    // 1. Origin check (reuse origin pattern from server.ts)
    const origin = c.req.header('origin');
    if (origin && !allowedOrigins.includes(origin)) {
      return c.json({ error: 'Forbidden origin' }, 403);
    }

    // 2. SSE headers
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    return stream(c, async (stream) => {
      // 3. Subscribe to all five event types
      const handler = (event: EngineEvent) => {
        void stream.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      const eventTypes: Array<EngineEvent['type']> = [
        'version.status_changed',
        'version.created',
        'tag.changed',
        'metadata.changed',
        'hierarchy.created',
      ];
      for (const t of eventTypes) engine.events.on(t, handler as never);

      // 4. Keep-alive ping every 30s
      const pingInterval = setInterval(() => {
        void stream.write(': ping\n\n');
      }, 30_000);

      // 5. Clean up on disconnect
      await stream.onAbort(() => {
        clearInterval(pingInterval);
        for (const t of eventTypes) engine.events.off(t, handler as never);
      });

      // 6. Block until client disconnects
      await new Promise((resolve) => c.req.raw.signal.addEventListener('abort', resolve));
    });
  };
}
```

---

### `src/http/static.ts` (middleware, request-response)

**Analog:** `src/server.ts` (mount order pattern, lines 239-283)

**Mount order pattern from analog** (`src/server.ts` lines 239-283 — structural reference):
```typescript
// MCP routes first (already registered)
app.post('/mcp', ...)
app.on([...], '/mcp', ...)

// Phase 5 adds these AFTER MCP, BEFORE catch-all:
app.route('/api', dashboardApi)
app.get('/api/events', sseHandler)

// Static handler LAST — wildcard catch-all
app.use('/*', serveStatic({ root: './packages/dashboard/dist' }))
```

**Static handler template** (from RESEARCH.md skeleton):
```typescript
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import path from 'node:path';

const FALLBACK_HTML = `<!doctype html>
<html><head><title>Dashboard not built</title></head>
<body><h1>Dashboard not built</h1>
<p>Run <code>npm run build:dashboard</code></p></body></html>`;

export function createStaticHandler(distPath: string) {
  const distExists = existsSync(distPath);
  if (!distExists) {
    console.error(`[static] Dashboard dist missing at ${distPath}. Serving fallback HTML.`);
  }

  if (!distExists) {
    return async (c: Context) => {
      if (c.req.path === '/') {
        return c.html(FALLBACK_HTML, 200);
      }
      return c.notFound();
    };
  }

  // SPA fallback: unknown paths return index.html
  return serveStatic({
    root: path.relative(process.cwd(), distPath),
    rewriteRequestPath: (reqPath) => reqPath,
    onNotFound: async (path, c) => {
      // Return index.html for SPA client-side routing
      await serveStatic({ root: path, path: '/index.html' })(c, async () => {});
    },
  });
}
```

**File-streaming pattern for `GET /api/versions/:id/output`** (D-WEBUI-33 — in `dashboard-routes.ts`):
```typescript
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { stat } from 'node:fs/promises';

app.get('/versions/:id/output', async (c) => {
  const { id } = c.req.param();
  const version = engine.getVersion(id); // throws VERSION_NOT_FOUND if missing
  const outputPath = resolveOutputPath(outputsDir, id); // find first file in outputs/<id>/
  try {
    await stat(outputPath);
  } catch {
    throw new TypedError(
      'OUTPUT_UNAVAILABLE',
      `Output file not found for version ${id}`,
      'The generation completed but the output file failed to download. Try reproducing.',
    );
  }
  const ext = path.extname(outputPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp4': 'video/mp4',
  };
  const contentType = mimeMap[ext] ?? 'application/octet-stream';
  const nodeStream = createReadStream(outputPath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return c.body(webStream, 200, { 'Content-Type': contentType });
});
```

---

### `src/http/error-middleware.ts` (middleware, request-response)

**Analog:** `src/tools/envelope.ts` (TypedError → structured response mapping)

**TypedError mapping from analog** (`src/tools/envelope.ts` lines 30-60):
```typescript
export function toolError(err: unknown): CallToolResult {
  if (err instanceof TypedError) {
    return {
      isError: true,
      content: [{ type: 'text', text: err.message }],
      structuredContent: {
        code: err.code,
        message: err.message,
        ...(err.hint ? { hint: err.hint } : {}),
      },
    };
  }
  // fallback for unknown errors
  return {
    isError: true,
    content: [{ type: 'text', text: String(err) }],
    structuredContent: { code: 'INTERNAL_ERROR', message: String(err) },
  };
}
```

**HTTP status code map** (REST equivalent — codes match the typed error vocabulary):
```typescript
const STATUS_MAP: Record<string, number> = {
  WORKSPACE_NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  SEQUENCE_NOT_FOUND: 404,
  SHOT_NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  OUTPUT_UNAVAILABLE: 404,
  TAG_NOT_FOUND: 404,
  METADATA_KEY_NOT_FOUND: 404,
  INVALID_INPUT: 400,
  INVALID_SCOPE: 400,
  VERSION_NOT_COMPLETED: 409,
  COMFYUI_CREDENTIALS_MISSING: 502,
  COMFYUI_API_ERROR: 502,
  PROVENANCE_UNAVAILABLE: 409,
};
```

**Hono error middleware template**:
```typescript
import type { ErrorHandler } from 'hono';
import { TypedError } from '../engine/errors.js';
import { z } from 'zod';

export const typedErrorHandler: ErrorHandler = (err, c) => {
  if (err instanceof TypedError) {
    const status = STATUS_MAP[err.code] ?? 500;
    return c.json(
      { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) },
      status as never,
    );
  }
  if (err instanceof z.ZodError) {
    const first = err.issues[0];
    return c.json(
      { code: 'INVALID_INPUT', message: `Invalid input at '${first.path.join('.')}'` },
      400,
    );
  }
  console.error('[http] unhandled error:', err);
  return c.json({ code: 'INTERNAL_ERROR', message: 'Internal server error' }, 500);
};
```

Register on the Hono sub-app (not global app):
```typescript
const api = new Hono();
api.onError(typedErrorHandler);
```

---

### `src/http/index.ts` (utility, barrel)

**Pattern:** Simple factory barrel. Export three factory functions consumed by `server.ts`:

```typescript
export { createDashboardRoutes } from './dashboard-routes.js';
export { createSseHandler } from './sse.js';
export { createStaticHandler } from './static.js';
```

---

### `src/server.ts` (extend — self)

**Integration points** (from D-WEBUI-12 + CONTEXT.md `<code_context>`):

Add AFTER existing `/mcp` registration, BEFORE any existing catch-all (if any):
```typescript
// Phase 5 additions — add inside the `if (args.http)` branch
import { createDashboardRoutes, createSseHandler, createStaticHandler } from './http/index.js';

const dashboardApi = createDashboardRoutes(engine, httpAllowedOrigins);
const sseHandler = createSseHandler(engine, httpAllowedOrigins);
const staticHandler = createStaticHandler('./packages/dashboard/dist');

app.route('/api', dashboardApi);
app.get('/api/events', sseHandler);
app.use('/*', staticHandler);
```

**Existing origin allowlist pattern** (`src/server.ts` lines 232-235) — reused verbatim by SSE and REST handlers:
```typescript
const httpAllowedOrigins = (process.env.HTTP_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
```

---

### `src/test-utils/fake-engine.ts` (extend)

**Analog:** `src/test-utils/fake-comfyui-client.ts`

**FakeComfyUIClient structure from analog** (`src/test-utils/fake-comfyui-client.ts` lines 1-50):
```typescript
export class FakeComfyUIClient implements ComfyUIClientInterface {
  public calls: Array<{ method: string; args: unknown[] }> = [];
  public scenario: 'happy' | 'poll-fail' | 'never-complete' = 'happy';
  public cannedOutputs: OutputInfo[] = [];

  async submitWorkflow(promptBlob: object): Promise<{ job_id: string }> {
    this.calls.push({ method: 'submitWorkflow', args: [promptBlob] });
    if (this.scenario === 'poll-fail') throw new Error('ComfyUI submit failed');
    return { job_id: `fake-job-${nanoid(6)}` };
  }

  async downloadToPath(filename, opts, destPath, options) {
    this.calls.push({ method: 'downloadToPath', args: [filename, opts, destPath, options] });
    if (this.scenario === 'happy') { /* write a fake file */ }
    return { path: destPath, url: 'fake-url', contentType: 'image/png', sizeBytes: 0 };
  }
}
```

**Pattern for `fake-engine.ts`** — fake engine wraps a real Engine shape but uses in-memory DB + controllable emitter:
```typescript
import { EventEmitter } from 'node:events';
import type { EngineEmitter } from '../engine/events.js';
import type { Engine } from '../engine/pipeline.js';

export class FakeEngine implements Pick<Engine, keyof Engine> {
  public readonly events: EngineEmitter = new EventEmitter() as EngineEmitter;
  public calls: Array<{ method: string; args: unknown[] }> = [];

  // Tests call fakeEngine.events.emit('version.created', payload) directly
  // to simulate SSE events without running real generation

  getVersion(id: string) { /* return fixture */ }
  listVersionsForShot(...) { /* return fixture list */ }
  // ... mirror every Engine public method
}

export function buildFakeEngine(): FakeEngine {
  return new FakeEngine();
}
```

---

### `src/test-utils/fixtures.ts` (extend — self)

**Existing pattern** (`src/test-utils/fixtures.ts` lines 1-50 — import block):
```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../store/schema.js';
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import { VersionRepo } from '../store/version-repo.js';
import { ProvenanceRepo } from '../store/provenance-repo.js';
import { Engine } from '../engine/pipeline.js';
```

**`makeInMemoryDb` pattern** (`src/test-utils/fixtures.ts` lines 51-80 approximately):
```typescript
export function makeInMemoryDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  return { sqlite, db };
}
```

**Phase 5 extension to add** (`buildStackWithOutputs` helper):
```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function buildStackWithOutputs() {
  const { sqlite, db } = makeInMemoryDb();
  const outputsDir = mkdtempSync(path.join(tmpdir(), 'vfx-test-outputs-'));
  const hierarchyRepo = new HierarchyRepo(db);
  const versionRepo = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const client = new FakeComfyUIClient();
  const engine = new Engine(db, hierarchyRepo, versionRepo, provenanceRepo, client, outputsDir, {
    maxConcurrentPollers: 1,
  });
  return { engine, outputsDir, client, sqlite };
}
```

---

### `src/__tests__/architecture-purity.test.ts` (extend — self)

**Existing `grepCount` helper pattern** (`src/__tests__/architecture-purity.test.ts` lines 1-20):
```typescript
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

function grepCount(pattern: string, ...paths: string[]): number {
  try {
    const result = execFileSync('grep', ['-r', '-l', pattern, ...paths], {
      encoding: 'utf8',
    });
    return result.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}
```

**Existing assertion pattern** (`src/__tests__/architecture-purity.test.ts` lines 21-79):
```typescript
describe('architecture purity', () => {
  it('src/engine/* has zero imports from @modelcontextprotocol/sdk (D-33)', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/')).toBe(0);
  });
  it('src/store/* has zero imports from @modelcontextprotocol/sdk (D-33)', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/store/')).toBe(0);
  });
  // ... file-level assertions for individual Phase 4 files ...
});
```

**Phase 5 additions to append** (3 new `it()` blocks inside the same `describe` — from D-WEBUI-31):
```typescript
it('src/http/* has zero imports from @modelcontextprotocol/sdk (D-WEBUI-31)', () => {
  expect(grepCount('@modelcontextprotocol/sdk', 'src/http/')).toBe(0);
});
it('src/http/* has zero imports from better-sqlite3 or drizzle-orm (D-WEBUI-31)', () => {
  expect(
    grepCount('better-sqlite3', 'src/http/') +
    grepCount('drizzle-orm', 'src/http/'),
  ).toBe(0);
});
it('src/engine/events.ts has zero MCP imports (D-WEBUI-31)', () => {
  expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/events.ts')).toBe(0);
});
it('src/engine/output-downloader.ts has zero MCP imports (D-WEBUI-31)', () => {
  expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/output-downloader.ts')).toBe(0);
});
```

---

### `src/http/__tests__/dashboard-routes.test.ts` (test, request-response)

**Analog:** `src/__tests__/architecture-purity.test.ts` (test structure) + `src/__tests__/stdio-hygiene.test.ts` (fake-stack wiring)

**Test structure pattern** (`src/__tests__/stdio-hygiene.test.ts` lines 1-30):
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { Engine } from '../../engine/pipeline.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';

describe('dashboard routes', () => {
  let engine: Engine;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    const client = new FakeComfyUIClient();
    engine = new Engine(db, /* repos */, client, 'outputs', { maxConcurrentPollers: 1 });
  });

  it('GET /api/versions/:id returns bare domain shape (D-WEBUI-05)', async () => {
    // seed version, call route handler directly (not HTTP), assert no {structuredContent} wrapper
  });
});
```

---

### `packages/dashboard/src/types/events.ts` (utility — type duplication)

**D-WEBUI-31 constraint:** Client code at `packages/dashboard/src/**` cannot import from `../../src/**`. Event types must be duplicated.

**Source to duplicate** (from `src/engine/events.ts` — the five payload interfaces):

Copy `VersionStatusChangedEvent`, `VersionCreatedEvent`, `TagChangedEvent`, `MetadataChangedEvent`, `HierarchyCreatedEvent`, `EngineEvent`, `EngineEventMap` verbatim into `packages/dashboard/src/types/events.ts`. Remove the `createEngineEmitter` factory (client doesn't need a Node EventEmitter). Add a comment: `// Duplicated from src/engine/events.ts per D-WEBUI-31 — keep in sync manually`.

---

## Shared Patterns

### Origin allowlist check
**Source:** `src/server.ts` lines 232-262
**Apply to:** `src/http/sse.ts`, `src/http/dashboard-routes.ts` (register on the Hono sub-app via middleware)
```typescript
const httpAllowedOrigins = (process.env.HTTP_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Per-handler origin guard
const origin = c.req.header('origin');
if (origin && !httpAllowedOrigins.includes(origin)) {
  return c.json({ error: 'Forbidden origin', hint: 'Set HTTP_ALLOWED_ORIGINS env var' }, 403);
}
```

### TypedError → JSON response mapping
**Source:** `src/tools/envelope.ts` (mapping logic) + `src/engine/errors.ts` (ErrorCode type)
**Apply to:** `src/http/error-middleware.ts` (registered on the `/api` Hono sub-app via `api.onError(typedErrorHandler)`)

The REST equivalent replaces `toolError()` return with `c.json({code, message, hint?}, httpStatus)`. Status code map: 404 for `*_NOT_FOUND` / `OUTPUT_UNAVAILABLE`, 400 for `INVALID_INPUT` / `INVALID_SCOPE`, 409 for `VERSION_NOT_COMPLETED` / `PROVENANCE_UNAVAILABLE`, 502 for `COMFYUI_*`, 500 for unknown.

### Zod input parsing at route boundaries
**Source:** `src/tools/version-tool.ts` lines 23-71 (discriminated union) and lines 191-231 (parse + switch)
**Apply to:** `src/http/dashboard-routes.ts` — use inline `z.object()` per route rather than a discriminated union (REST has one schema per path, not one schema for all actions). Throw `TypedError('INVALID_INPUT', ...)` on `ZodError` (or let the Hono error middleware handle the raw `ZodError`).

### Breadcrumb on read responses
**Source:** `src/engine/breadcrumb.ts` — `BreadcrumbResolver.resolve(type, id)`
**Apply to:** All `src/http/dashboard-routes.ts` GET handlers that return entity detail (versions, shots, sequences, projects, workspaces). Same pattern as MCP tools: call resolver, spread `.entries` + `.text` into response. Import `BreadcrumbResolver` from `../engine/breadcrumb.js`.

### stdout-clean discipline
**Source:** `src/__tests__/stdio-hygiene.test.ts` (asserts no stdout from server process)
**Apply to:** ALL `src/http/*` and `src/engine/events.ts` and `src/engine/output-downloader.ts` — use `console.error(...)` for logs, never `console.log(...)`. stdout is reserved for MCP JSON-RPC framing. The existing `stdio-hygiene.test.ts` will catch violations at integration test time.

### Thin-module discipline (engine layer)
**Source:** `src/engine/breadcrumb.ts` (one class, typed deps, no MCP/HTTP/SQLite imports)
**Apply to:** `src/engine/events.ts`, `src/engine/output-downloader.ts` — must satisfy the same constraints verified by `architecture-purity.test.ts`.

---

## GREENFIELD Files (No Codebase Analog)

These files have no analog in the current codebase. The planner should scaffold them using RESEARCH.md skeletons as the primary reference.

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/dashboard/package.json` | config | n/a | First Preact/Vite package in this repo |
| `packages/dashboard/vite.config.ts` | config | n/a | First Vite config in this repo |
| `packages/dashboard/tsconfig.json` | config | n/a | First client-side TS config |
| `packages/dashboard/index.html` | config | n/a | SPA entry shell |
| `packages/dashboard/src/main.tsx` | component | n/a | Preact root entry; no prior Preact code |
| `packages/dashboard/src/lib/api.ts` | service | request-response | Typed fetch client; no prior browser HTTP layer |
| `packages/dashboard/src/lib/events.ts` | service | event-driven | EventSource SSE client; no prior browser event client |
| `packages/dashboard/src/state/*.ts` | store | event-driven | `@preact/signals` stores; first use of signals in this repo |
| `packages/dashboard/src/views/*.tsx` | component | request-response | Preact views; no prior UI code |
| `packages/dashboard/src/components/*.tsx` | component | event-driven | Preact components; no prior UI code |
| `packages/dashboard/src/styles/theme.css` | config | n/a | Tailwind v4 `@theme` tokens; first Tailwind in this repo |
| `packages/dashboard/src/styles/motion.css` | config | n/a | CSS keyframes; no prior animation code |
| `packages/dashboard/src/__tests__/*.test.tsx` | test | n/a | `@testing-library/preact`; no prior component tests |
| `packages/dashboard/dist/**` | config | n/a | Build artifact; committed per D-WEBUI-09 |

**RESEARCH.md skeletons to use for GREENFIELD files** (all confirmed present in `05-RESEARCH.md`):
- `packages/dashboard/package.json` — verified skeleton in RESEARCH.md §Package Configuration
- `packages/dashboard/vite.config.ts` — verified skeleton in RESEARCH.md §Vite Configuration
- `packages/dashboard/tsconfig.json` — verified skeleton in RESEARCH.md §TypeScript Configuration
- `packages/dashboard/src/styles/theme.css` — verified skeleton in RESEARCH.md §Tailwind Theme
- `packages/dashboard/src/lib/api.ts` — verified skeleton in RESEARCH.md §API Client
- `packages/dashboard/src/lib/events.ts` — verified skeleton in RESEARCH.md §SSE Client
- `packages/dashboard/src/state/activeGenerations.ts` — verified skeleton in RESEARCH.md §State Management
- Preact component skeletons — verified in RESEARCH.md §Component Skeletons
- `src/engine/events.ts` — complete skeleton in RESEARCH.md §Engine Events

---

## Metadata

**Analog search scope:** `src/tools/`, `src/engine/`, `src/server.ts`, `src/comfyui/`, `src/test-utils/`, `src/__tests__/`
**Files scanned:** 14 analog files read (version-tool.ts, envelope.ts, pipeline.ts, errors.ts, breadcrumb.ts, server.ts, client.ts, fake-comfyui-client.ts, fixtures.ts, architecture-purity.test.ts, tool-budget.test.ts, stdio-hygiene.test.ts, shape.ts — referenced for constants)
**Pattern extraction date:** 2026-04-23
**GREENFIELD files:** 20 of 42 — use RESEARCH.md skeletons as scaffold
**Files with exact analog:** 1 (`src/http/dashboard-routes.ts` ← `src/tools/version-tool.ts`)
**Files with role-match analog:** 11
**Files with partial analog:** 9
**Files with no analog (GREENFIELD):** 20
**Files that are self-extensions:** 7 (pipeline.ts, errors.ts, server.ts, architecture-purity.test.ts, fixtures.ts, tool-budget.test.ts, stdio-hygiene.test.ts)
