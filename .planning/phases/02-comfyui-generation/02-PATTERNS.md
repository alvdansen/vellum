# Phase 2: ComfyUI Generation - Pattern Map

**Mapped:** 2026-04-20
**Files analyzed:** 26 (new + extended + cross-cutting test extensions)
**Analogs found:** 22 / 26 (4 files have no Phase 1 analog and are flagged "implement fresh")

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/tools/generation-tool.ts` | tool | request-response (async with fresh-fetch on status) | `src/tools/shot-tool.ts` | exact |
| `src/tools/index.ts` | config (barrel) | — | (self — EXTEND in place) | exact |
| `src/engine/generation.ts` | engine | request-response + state-machine + async background poll | `src/engine/pipeline.ts` | role-match (new file alongside) |
| `src/engine/pipeline.ts` | engine | — (minor extension for delegation + `start()`/`stop()`) | (self — EXTEND in place) | exact |
| `src/engine/backoff.ts` | utility (pure) | transform (generator) | `src/utils/id.ts` | role-match (pure tiny helper) |
| `src/engine/breadcrumb.ts` | engine | CRUD-walk | (self — EXTEND `'version'` case mirrors `'shot'` case) | exact |
| `src/engine/errors.ts` | engine (type) | — | (self — EXTEND `ErrorCode` union) | exact |
| `src/comfyui/client.ts` | client (HTTP) | file-I/O + request-response | `src/store/hierarchy-repo.ts` (boundary/isolation pattern only) | partial (no existing HTTP boundary) |
| `src/comfyui/format.ts` | utility (pure validator) | transform | `src/engine/breadcrumb.ts` (TypedError-throwing pure helper) | role-match |
| `src/comfyui/types.ts` | type-only | — | `src/types/hierarchy.ts` | exact |
| `src/utils/outputs.ts` | utility (fs) | file-I/O | — (no analog — implement fresh) | none |
| `src/store/version-repo.ts` | store | CRUD + state transitions | `src/store/hierarchy-repo.ts` | exact |
| `src/store/schema.ts` | store (schema) | — | (self — EXTEND `versions` table definition + `SCHEMA_DDL` string) | exact |
| `src/store/db.ts` | store (init) | — | (self — EXTEND with Drizzle `migrate()` invocation) | exact |
| `drizzle/0001_phase2_version_lifecycle.sql` | migration | — | — (first migration in the project — implement fresh via `drizzle-kit generate`) | none |
| `src/server.ts` | config (entry) | — | (self — EXTEND for `dotenv`, `registerGeneration`, `engine.start/stop`) | exact |
| `.env.example` | config | — | — (new file — no Phase 1 analog) | none |
| `src/engine/__tests__/backoff.test.ts` | test (unit, pure) | — | `src/engine/__tests__/shot-naming.test.ts` | role-match (smallest pure-helper test) |
| `src/store/__tests__/version-repo.test.ts` | test (unit, SQLite) | — | `src/engine/__tests__/hierarchy.test.ts` | exact |
| `src/engine/__tests__/generation.test.ts` | test (unit, fake client) | — | `src/engine/__tests__/hierarchy.test.ts` + `src/test-utils/fake-engine.ts` | role-match |
| `src/tools/__tests__/generation-tool.test.ts` | test (integration) | — | `src/tools/__tests__/error-wrapping.test.ts` + `breadcrumb-always.test.ts` | exact (direct-mirror pattern) |
| `src/comfyui/__tests__/format.test.ts` | test (unit, pure) | — | `src/engine/__tests__/shot-naming.test.ts` | role-match (pure-validator fixture table) |
| `src/comfyui/__tests__/live-smoke.test.ts` | test (gated e2e) | request-response + file-I/O | — (no analog — implement fresh with `test.skipIf` / env gate) | none |
| `src/store/__tests__/migrate.test.ts` | test (SQLite init) | — | `src/store/__tests__/db-init.test.ts` | exact (temp-file SQLite pattern) |
| `src/test-utils/fake-engine.ts` | test-util | — | (self — EXTEND with `submitGeneration`/`getGenerationStatus`/`start`/`stop`) | exact |
| `src/test-utils/fake-comfyui-client.ts` | test-util | — | `src/test-utils/fake-engine.ts` | role-match (spy pattern mirror) |
| `src/__tests__/tool-budget.test.ts` | cross-cutting test | — | (self — EXTEND 4→5 count) | exact |
| `src/__tests__/architecture-purity.test.ts` | cross-cutting test | — | (self — EXTEND with `src/comfyui/` assertion) | exact |
| `src/__tests__/stdio-hygiene.test.ts` | cross-cutting test | — | (self — EXTEND to assert no `COMFYUI_API_KEY=` on stderr) | exact |

---

## Pattern Assignments

### `src/tools/generation-tool.ts` (tool, request-response)

**Analog:** `src/tools/shot-tool.ts`

**Why this analog:** `shot-tool.ts` is the closest Phase 1 tool because it (1) uses a 3-arm discriminated union on `action`, (2) does per-input sentinel-message detection for `INVALID_SHOT_FORMAT` in the catch block (exactly the shape needed for `INVALID_WORKFLOW_FORMAT` and Zod rewrap), (3) applies defence-in-depth (engine also enforces the regex). Workspace/project/sequence tools are simpler (no sentinel detection). For `generation`, Phase 2 only needs 2 actions (`submit`, `status`) but the catch-branch logic for typed-error passthrough comes from shot-tool verbatim.

**Imports pattern** (shot-tool.ts lines 1-6):
```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError } from './envelope.js';
import { shapeCreateOrGet, shapeList } from './shape.js';
```

**Discriminated union pattern** (shot-tool.ts lines 12-30):
```typescript
const CreateInput = z.object({
  action: z.literal('create'),
  sequenceId: z.string().min(1),
  name: z.string().regex(/^sh\d{3,}$/, 'INVALID_SHOT_FORMAT'),
});
const ListInput = z.object({
  action: z.literal('list'),
  sequenceId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
const GetInput = z.object({
  action: z.literal('get'),
  id: z.string().min(1),
});

const ShotInput = z.discriminatedUnion('action', [CreateInput, ListInput, GetInput]);
```

**Registration + handler body** (shot-tool.ts lines 40-88):
```typescript
export function registerShot(server: McpServer, engine: Engine) {
  server.registerTool(
    'shot',
    {
      title: 'Shot',
      description:
        "Manage shots within a sequence. Shot names must match ^sh\\d{3,}$ ...",
      inputSchema: ShotInput,
    },
    async (input) => {
      try {
        switch (input.action) {
          case 'create':
            return toolOk(shapeCreateOrGet(engine.createShot(input.sequenceId, input.name)));
          case 'list':
            return toolOk(shapeList(engine.listShots(input.sequenceId, input.limit, input.offset)));
          case 'get':
            return toolOk(shapeCreateOrGet(engine.getShot(input.id)));
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          const first = err.issues[0];
          const path = first.path.join('.');
          if (first.message === 'INVALID_SHOT_FORMAT') {
            return toolError(new TypedError('INVALID_SHOT_FORMAT', ..., ...));
          }
          return toolError(new TypedError('INVALID_INPUT', `Invalid input at 'input.${path}' -- ${first.message}`));
        }
        return toolError(err);
      }
    },
  );
}
```

**Changes when applying to `generation-tool.ts`:**
- Two arms (`SubmitInput`, `StatusInput`) — no `list`/`get` in Phase 2 (D-GEN-02).
- `SubmitInput.workflow_json` typed as `z.record(z.string(), z.unknown())` (any JSON object — format validation lives in the engine per D-GEN-23, not at Zod).
- `SubmitInput` fields: `{ action: z.literal('submit'), shot_id: z.string().min(1), workflow_json: z.record(z.string(), z.unknown()), notes: z.string().optional() }` (per D-GEN-04).
- `StatusInput` fields: `{ action: z.literal('status'), version_id: z.string().min(1) }` (per D-GEN-06).
- Tool description (D-GEN-08): *"Submits a ComfyUI API-format workflow (also called 'prompt format'). UI-format exports will be rejected — enable 'Dev Mode > Save (API Format)' in ComfyUI to export the right shape. Actions: submit, status."*
- **Response shape differs from `shapeCreateOrGet`** because `submit`/`status` return a single version row with breadcrumb — still `{entity, breadcrumb, breadcrumb_text}`. Reuse `shapeCreateOrGet` verbatim (engine returns `{entity: Version, breadcrumb: Breadcrumb}`). No new shaper needed.
- `shapeList` not used (no list action).
- No sentinel-message Zod detection needed (format validation happens post-Zod inside the engine). Keep the `z.ZodError` rewrap branch for consistency.
- Engine delegate methods: `engine.submitGeneration(input.shot_id, input.workflow_json, input.notes)` and `engine.getGenerationStatus(input.version_id)`.

**Breadcrumb shape contract (D-GEN-05, Phase 1 D-22):**
- `engine.submitGeneration` must return `{entity, breadcrumb}` where `entity` includes `version_label` (rendered via `versionLabel(n)`).
- `shapeCreateOrGet` in `src/tools/shape.ts` splits `breadcrumb.entries` → `breadcrumb[]` and `breadcrumb.text` → `breadcrumb_text` — no change needed.
- Breadcrumb array has 5 entries on a version leaf: `[workspace, project, sequence, shot, version]`.

---

### `src/tools/index.ts` (config/barrel, EXTEND)

**Current content (lines 1-8):**
```typescript
// Barrel for Phase 1 MCP tool registrations. Phase 1 budgets 4 of 12 tools
// (D-04, TOOL-01). Remaining 8 tools reserved for Phases 2-5.

export { registerWorkspace } from './workspace-tool.js';
export { registerProject } from './project-tool.js';
export { registerSequence } from './sequence-tool.js';
export { registerShot } from './shot-tool.js';
```

**Changes:** Add one export line. Update the phase-budget comment from "4 of 12" to "5 of 12" (D-GEN-03).
```typescript
export { registerGeneration } from './generation-tool.js';
```

---

### `src/engine/generation.ts` (engine, request-response + state-machine + async background poll) — NEW FILE

**Analog:** `src/engine/pipeline.ts` (the Engine class)

**Why this analog:** The entire Engine class is constructor-injected (repos + a BreadcrumbResolver built from the repo), returns `{entity, breadcrumb}` from create/get methods, throws `TypedError` on missing entities, and has zero MCP imports. Phase 2 either extends `pipeline.ts` directly or puts generation ops in `generation.ts` and has Engine delegate (CONTEXT.md Integration Points allows either). Recommendation: **new file + delegation from Engine**, because generation adds ~200 LOC (submit/status/poller/download) and keeping `pipeline.ts` focused on hierarchy CRUD preserves Phase 1 semantic clarity.

**Imports pattern** (pipeline.ts lines 1-10):
```typescript
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import { BreadcrumbResolver } from './breadcrumb.js';
import { TypedError } from './errors.js';
import type {
  Workspace,
  Project,
  Sequence,
  Shot,
  Breadcrumb,
} from '../types/hierarchy.js';
```

**Constructor + facade pattern** (pipeline.ts lines 35-40):
```typescript
export class Engine {
  private breadcrumb: BreadcrumbResolver;

  constructor(private repo: HierarchyRepo) {
    this.breadcrumb = new BreadcrumbResolver(repo);
  }
  // ...
}
```

**Create-and-return-with-breadcrumb pattern** (pipeline.ts lines 46-49):
```typescript
createWorkspace(name: string): { entity: Workspace; breadcrumb: Breadcrumb } {
  const entity = this.repo.createWorkspace(name);
  return { entity, breadcrumb: this.breadcrumb.resolve('workspace', entity.id) };
}
```

**Get-with-not-found pattern** (pipeline.ts lines 51-61):
```typescript
getWorkspace(id: string): { entity: Workspace; breadcrumb: Breadcrumb } {
  const entity = this.repo.getWorkspace(id);
  if (!entity) {
    throw new TypedError(
      'WORKSPACE_NOT_FOUND',
      `Workspace '${id}' not found`,
      `List workspaces with { tool: 'workspace', action: 'list' }`,
    );
  }
  return { entity, breadcrumb: this.breadcrumb.resolve('workspace', entity.id) };
}
```

**Pre-validate-then-delegate pattern** (pipeline.ts lines 153-164, shot regex):
```typescript
createShot(sequenceId: string, name: string): { entity: Shot; breadcrumb: Breadcrumb } {
  // Regex FIRST, before any DB work. Engine is the single authority on shot naming.
  if (!SHOT_REGEX.test(name)) {
    throw new TypedError(
      'INVALID_SHOT_FORMAT',
      `Shot name '${name}' does not match expected format`,
      `Shot names must match ^sh\\d{3,}$ — e.g. 'sh010', 'sh020'`,
    );
  }
  const entity = this.repo.createShot(sequenceId, name);
  return { entity, breadcrumb: this.breadcrumb.resolve('shot', entity.id) };
}
```

**Changes when applying to `generation.ts`:**
- Class: `GenerationEngine` with constructor `(private repo: VersionRepo, private hierarchy: HierarchyRepo, private client: ComfyUIClient, private breadcrumb: BreadcrumbResolver)` — four injected dependencies (repo + hierarchy-repo for breadcrumb-parent-lookup + comfyui client + existing breadcrumb resolver).
- `Engine` in `pipeline.ts` composes `GenerationEngine` and exposes `submitGeneration`, `getGenerationStatus`, `start`, `stop` methods — or `GenerationEngine` is wired directly into `server.ts` alongside `Engine`. Planner's call; CONTEXT.md §"Existing Code Insights" prefers single `Engine` facade.
- `submitGeneration(shotId, workflowJson, notes)` follows **two-phase submit** (RESEARCH.md Pattern 2): (a) `validateWorkflowFormat(workflowJson)` (throws `INVALID_WORKFLOW_FORMAT` — mirrors pre-validate pattern above), (b) insert row via `repo.insertVersion(shotId, notes)` (Txn 1 — row exists before network I/O), (c) `await client.submit(workflowJson)` — on success `repo.setJobId`, on failure `repo.markFailed` + rethrow typed.
- `getGenerationStatus(versionId)` follows **fresh-if-not-terminal** (RESEARCH.md Pattern 3): `repo.getVersion(id)` → throw `VERSION_NOT_FOUND` on miss (mirrors `WORKSPACE_NOT_FOUND` pattern above), check terminal (cached return), check 10-min timeout (mark failed + return), else `client.status(job_id)` → map → on `completed` call `downloadAndPersist` → return wrapped.
- `start()`/`stop()` follow **AbortController-wired poller** (RESEARCH.md Pattern 6): `pollers = new Map<string, AbortController>()`, enumerate via `repo.listPendingVersions()`, spawn `drivePoller(row, signal)` per pending row, `stop()` aborts all.
- **Return shape contract:** `{entity: Version, breadcrumb: Breadcrumb}` — same as Phase 1. `breadcrumb.resolve('version', versionId)` (new leaf, see `breadcrumb.ts` section).
- `version_label` computed via `versionLabel(n) = 'v' + String(n).padStart(3, '0')` (D-GEN-17) — helper lives in `utils/outputs.ts` or a new `utils/version-label.ts`. Planner's choice; `utils/outputs.ts` is natural home since disk path also needs it.
- **Invariant to maintain:** zero `@modelcontextprotocol/sdk` imports (D-33) — enforced by extended `architecture-purity.test.ts`.

---

### `src/engine/backoff.ts` (utility pure, NEW FILE)

**Analog:** `src/utils/id.ts` (closest Phase 1 pure tiny helper)

**Why this analog:** `id.ts` is the project's pattern for a tiny pure utility — one default export, typed, JSDoc comment tying behavior to a design decision, zero imports other than the library it wraps. `backoff.ts` mirrors that shape (generator + optional `sleep` helper).

**Imports + JSDoc + pure export pattern** (id.ts lines 1-12):
```typescript
import { nanoid } from 'nanoid';

export type IdPrefix = 'ws' | 'proj' | 'seq' | 'shot' | 'ver';

/**
 * Generate a prefixed nanoid for a hierarchy entity.
 * Format: `${prefix}_<21-char-nanoid>` — the prefix aids log/error readability
 * and matches the error-message examples from RESEARCH §Cluster E (e.g. 'ws_abc').
 */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${nanoid()}`;
}
```

**Changes when applying to `backoff.ts`:**
- Zero imports (even more pure than `id.ts`). No deps.
- Export an `async function*` generator `createBackoffIterator()` yielding `[2000, 4000, 8000, 16000]` then infinite `30000`. D-GEN-24 specifies the exact sequence.
- Also export `sleep(ms, signal?)` — wraps `setTimeout` in a Promise, clears on abort signal, rejects with `DOMException('Aborted', 'AbortError')`. See RESEARCH.md Code Examples §"Backoff generator" for the verbatim shape (~15 lines).
- JSDoc cites D-GEN-24 just like `id.ts` cites RESEARCH Cluster E.

---

### `src/engine/breadcrumb.ts` (engine, EXTEND)

**Analog:** self — the existing `'shot'` case in `breadcrumb.ts` is the exact pattern for the new `'version'` leaf.

**Shot leaf pattern** (breadcrumb.ts lines 21-32):
```typescript
case 'shot': {
  const shot = this.repo.getShot(id);
  if (!shot) throw new TypedError('SHOT_NOT_FOUND', `Shot '${id}' not found`);
  const seq = this.repo.getSequence(shot.sequence_id)!;
  const proj = this.repo.getProject(seq.project_id)!;
  const ws = this.repo.getWorkspace(proj.workspace_id)!;
  entries.push({ type: 'workspace', id: ws.id, name: ws.name });
  entries.push({ type: 'project', id: proj.id, name: proj.name });
  entries.push({ type: 'sequence', id: seq.id, name: seq.name });
  entries.push({ type: 'shot', id: shot.id, name: shot.name });
  break;
}
```

**Changes when applying to the `'version'` case:**
- Walk `version → shot → sequence → project → workspace`: five parents.
- Need a new lookup method: `VersionRepo.getVersion(id)` (included in `version-repo.ts`).
- `BreadcrumbResolver` must accept a `VersionRepo` in addition to `HierarchyRepo` — constructor signature changes to `constructor(private repo: HierarchyRepo, private versions: VersionRepo)`. Update `Engine` in `pipeline.ts` to pass both.
- Extend `EntityType` in `src/types/hierarchy.ts` from `'workspace' | 'project' | 'sequence' | 'shot'` to include `'version'`.
- The leaf label uses the version's `name` field rendered as `version_label` (e.g. `v001`). Since `Version` has no `name` field, use `versionLabel(row.version_number)` (helper from `utils/outputs.ts`) for the display — the `BreadcrumbEntry.name` value.
- New case body:
  ```typescript
  case 'version': {
    const ver = this.versions.getVersion(id);
    if (!ver) throw new TypedError('VERSION_NOT_FOUND', `Version '${id}' not found`);
    const shot = this.repo.getShot(ver.shot_id)!;
    const seq = this.repo.getSequence(shot.sequence_id)!;
    const proj = this.repo.getProject(seq.project_id)!;
    const ws = this.repo.getWorkspace(proj.workspace_id)!;
    entries.push({ type: 'workspace', id: ws.id, name: ws.name });
    entries.push({ type: 'project', id: proj.id, name: proj.name });
    entries.push({ type: 'sequence', id: seq.id, name: seq.name });
    entries.push({ type: 'shot', id: shot.id, name: shot.name });
    entries.push({ type: 'version', id: ver.id, name: versionLabel(ver.version_number) });
    break;
  }
  ```
- Text joiner (`' > '` from `SEP` constant) is unchanged — applied by the existing bottom of `resolve()` (line 58). Breadcrumb text for a version becomes `ws > proj > seq > shot > v001` (D-GEN-05).

---

### `src/engine/errors.ts` (engine type, EXTEND)

**Analog:** self — Phase 1 `ErrorCode` union. Add 8 new codes (D-GEN-40).

**Current union** (errors.ts lines 4-12):
```typescript
export type ErrorCode =
  | 'WORKSPACE_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'SEQUENCE_NOT_FOUND'
  | 'SHOT_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'DUPLICATE_NAME'
  | 'INVALID_SHOT_FORMAT'
  | 'INVALID_INPUT';
```

**Changes:** Add 8 new SCREAMING_SNAKE_CASE literals to the union:
```typescript
export type ErrorCode =
  | 'WORKSPACE_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'SEQUENCE_NOT_FOUND'
  | 'SHOT_NOT_FOUND'
  | 'VERSION_NOT_FOUND'          // NEW D-GEN-40
  | 'PARENT_NOT_FOUND'
  | 'DUPLICATE_NAME'
  | 'INVALID_SHOT_FORMAT'
  | 'INVALID_WORKFLOW_FORMAT'    // NEW D-GEN-40
  | 'INVALID_INPUT'
  | 'COMFYUI_CREDENTIALS_MISSING'// NEW D-GEN-40
  | 'COMFYUI_API_ERROR'          // NEW D-GEN-40
  | 'COMFYUI_RATE_LIMITED'       // NEW D-GEN-40
  | 'GENERATION_TIMEOUT'         // NEW D-GEN-40
  | 'DOWNLOAD_FAILED'            // NEW D-GEN-40
  | 'CONCURRENT_SUBMIT_CONFLICT';// NEW D-GEN-40
```

The `TypedError` class body (lines 19-28) needs no change — it already accepts any `ErrorCode` value.

---

### `src/comfyui/client.ts` (client/HTTP boundary, NEW FILE)

**Analog:** Partial — `src/store/hierarchy-repo.ts` is the closest "boundary isolation" pattern (zero MCP imports, parameterized calls, typed errors on well-known failures, returns plain objects). No existing HTTP boundary file exists.

**Boundary isolation pattern** (hierarchy-repo.ts lines 39-66):
```typescript
export class HierarchyRepo {
  constructor(private db: Db) {}

  createWorkspace(name: string): Workspace {
    const row: Workspace = {
      id: newId('ws'),
      name,
      naming_template: null,
      created_at: Date.now(),
    };
    try {
      this.db.insert(workspaces).values(row).run();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TypedError(
          'DUPLICATE_NAME',
          `Workspace '${name}' already exists`,
          `Pick a different name or ...`,
        );
      }
      throw err;
    }
    return row;
  }
  // ...
}
```

**Changes when applying to `ComfyUIClient`:**
- Constructor: `(private apiKey: string, private base: string, private allowedHosts?: RegExp[])` — credentials injected at wiring time (D-GEN-09, Pattern: no `process.env` reads inside this file per RESEARCH anti-pattern).
- **Zero MCP imports, zero DB imports** (D-GEN-21). Only imports: `TypedError` from `../engine/errors.js`, `validateWorkflowFormat` (optional — may live in caller), `extractFirstNodeError` from `./client.ts` itself or a sibling, types from `./types.js`, `node:stream`, `node:stream/promises`, `node:fs`, `node:fs/promises`.
- Three primary methods:
  1. `submit(workflowJson: Record<string, unknown>): Promise<{ prompt_id: string }>` — `POST /api/prompt` with `X-API-Key` header and `{prompt: workflowJson}` body (A8 confirms the wrap). On 429 → `TypedError('COMFYUI_RATE_LIMITED', ..., 'ComfyUI concurrency limit ...')`. On 4xx with `node_errors` → `TypedError('COMFYUI_API_ERROR', extractFirstNodeError(body.node_errors) ?? fallback)`. On 5xx / network error → `TypedError('COMFYUI_API_ERROR', ...)`.
  2. `status(jobId: string): Promise<ComfyStatus>` — `GET /api/job/{jobId}/status`. Normalise to `{ state, progress, outputs?, error? }`. RESEARCH Open Question 1 notes the completion shape may require a fallback to `/api/history_v2/{prompt_id}` — implement defensively.
  3. `download(filename: string, opts: {subfolder?, type?}): Promise<{ body: ReadableStream; contentType: string; contentLength: number; url: string }>` — `GET /api/view` with `redirect: 'manual'`, inspect `Location`, validate host against allowlist regex (RESEARCH.md Pattern 4 + Pitfall 7). See RESEARCH Code Examples §"Host-allowlist redirect gate" for ~25-line verbatim example.
- UNIQUE-violation-to-typed-error pattern maps cleanly onto HTTP-error-to-typed-error: same try/catch/typed-throw shape. `isUniqueViolation` helper analog is an `isRateLimitResponse(res): boolean` + `extractFirstNodeError(body): string | null`.
- Uses `fetch` (native, Node 20+). No `undici` / `node-fetch` (CONTEXT.md Claude's Discretion).
- Host allowlist defaults (Pitfall 7, A1): `/\.cloud\.comfy\.org$/`, `/\.googleapis\.com$/`, `/\.amazonaws\.com$/`, `/\.r2\.cloudflarestorage\.com$/`. Overridable via `COMFYUI_ALLOWED_REDIRECT_HOSTS` (read at wiring time in `server.ts`, not here).
- **Stream-to-disk** happens in `ComfyUIClient.downloadToPath(filename, opts, destPath)` or a sibling helper — uses RESEARCH Pattern 5 (temp-then-rename):
  ```typescript
  const partial = `${destPath}.partial`;
  const writer = createWriteStream(partial);
  try {
    await pipeline(Readable.fromWeb(body), writer);
    await rename(partial, destPath);
  } catch (err) {
    await unlink(partial).catch(() => undefined);
    throw err;
  }
  ```
  Download retry 3× with backoff `[2s, 4s, 8s]` per file (D-GEN-36); wrap in the same try/catch/typed-throw shape used by `hierarchy-repo`.

---

### `src/comfyui/format.ts` (utility, NEW FILE)

**Analog:** `src/engine/breadcrumb.ts` — closest pure helper that throws `TypedError` on malformed input and returns otherwise.

**Why this analog:** `format.ts` is a pure validator that either returns `void` on accept or throws `TypedError('INVALID_WORKFLOW_FORMAT', ...)` with a hint on reject. Breadcrumb's `resolve()` method has the same structure: "look at input, validate, return or throw typed". Both are pure (no I/O) and zero MCP imports.

**Pure-helper-throws-TypedError pattern** (breadcrumb.ts lines 21-24):
```typescript
case 'shot': {
  const shot = this.repo.getShot(id);
  if (!shot) throw new TypedError('SHOT_NOT_FOUND', `Shot '${id}' not found`);
  // ...
}
```

**Changes when applying to `format.ts`:**
- Three exports: `isUiFormat(payload: unknown): boolean`, `isApiFormat(payload: unknown): boolean`, `validateWorkflowFormat(payload: unknown): void`.
- `validateWorkflowFormat` calls `isUiFormat` first (explicit UI-format rejection gives the best hint — D-GEN-23 ordering), then `isApiFormat` (accept), else generic reject.
- See RESEARCH Code Examples §"Workflow format detection" for the exact ~45-line implementation including UI-sentinel-keys (`nodes`, `links`, `groups`, `last_node_id`) and API-format numeric-key + `class_type` + `inputs` check.
- Zero imports except `TypedError` from `../engine/errors.js`.
- Edge cases covered by dedicated tests (see `format.test.ts` below): `{}`, `[]`, `null`, `undefined`, `{foo: 'bar'}`, `{nodes: []}`, `{'1': {class_type: 'A', inputs: {}}}`, missing keys, non-numeric keys.

---

### `src/comfyui/types.ts` (type-only, NEW FILE)

**Analog:** `src/types/hierarchy.ts` — pure type file, zero imports, documented as "canonical type source".

**Imports + interface pattern** (hierarchy.ts lines 1-10):
```typescript
// Pure type definitions for VFX Familiar hierarchy entities.
// ZERO imports — this file is the canonical type source consumed by engine, store, and tools.

export interface Workspace {
  id: string;
  name: string;
  naming_template: string | null;
  created_at: number;
}
```

**Changes when applying to `comfyui/types.ts`:**
- Zero imports, same header comment pattern.
- Narrow types for the three endpoints we wrap (no full SDK):
  - `SubmitRequest` — `{ prompt: Record<string, unknown>; extra_data?: Record<string, unknown> }`
  - `SubmitResponse` — `{ prompt_id: string; /* other fields ignored */ }`
  - `StatusResponse` — `{ status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'; progress?: number; outputs?: Array<ComfyOutput>; error?: unknown }`
  - `ComfyOutput` — `{ filename: string; subfolder?: string; type?: string }` (ComfyUI native shape)
  - `StoredOutput` — `{ filename: string; path: string; url: string; content_type: string; size_bytes: number }` (what `outputs_json` stores, D-GEN-37)
  - `NodeError` — `{ errors: Array<{ type: string; message: string; details?: string }>; dependent_outputs: string[]; class_type: string }` (RESEARCH Pattern 4)
- Extend `IdPrefix` in `src/utils/id.ts` if Phase 2 adds a new ID prefix — **it doesn't** (versions already use `'ver'`, installed in Phase 1 `IdPrefix` union).

---

### `src/utils/outputs.ts` (utility, NEW FILE — NO PHASE 1 ANALOG)

**No analog.** Implement fresh. Phase 1 `utils/` has only `cli.ts` (arg parsing) and `id.ts` (nanoid wrapper) — neither touches fs. Planner guidance:

**Guidance (no existing pattern):**
- Zero MCP, zero DB imports (enforced by extended `architecture-purity.test.ts`).
- Uses `node:fs/promises` (`mkdir`, `access`, `stat`) and `node:path` (`join`, `extname`, `basename`).
- Exports:
  - `versionLabel(n: number): string` — `'v' + String(n).padStart(3, '0')`; for `n >= 1000` it's unpadded (D-GEN-17). Single-line; this is the canonical render helper. May also be co-located in `engine/generation.ts` or a dedicated `utils/version-label.ts`; planner picks the home. Any call site that needs the label imports from here.
  - `buildOutputPath({project, sequence, shot, versionLabel, filename, root?}): string` — joins `root ?? './outputs'` + `project.name` + `sequence.name` + `shot.name` + `versionLabel` + `filename`. Uses `path.posix.join` so `outputs_json[].path` is POSIX-style per D-GEN-37. Input names used verbatim (D-GEN-33; no slugify).
  - `ensureDir(dirPath: string): Promise<void>` — `await mkdir(dirPath, { recursive: true })`. Ignores `EEXIST`.
  - `resolveCollisionSuffix(dirPath: string, filename: string): Promise<string>` — checks if `{dirPath}/{filename}` exists; if yes, returns `{basename}_1.{ext}`, `{basename}_2.{ext}`, ... until a free slot (D-GEN-35). Logs each rename to stderr.
  - `sanitizeRelativeSegment(name: string): string` — rejects `..`, `/`, `\`, NUL bytes in ComfyUI-returned filenames. Throws `TypedError('COMFYUI_API_ERROR', 'Unsafe filename returned from ComfyUI: ${name}')` (path-traversal threat per RESEARCH §Security). Called inside `buildOutputPath` on the `filename` arg only (project/sequence/shot names are trusted per Phase 1 D-14).
- All functions return primitive types or Promises — no objects held.
- No logging except `console.error` on the collision-suffix rename (stderr per D-21).

---

### `src/store/version-repo.ts` (store, CRUD + state transitions, NEW FILE)

**Analog:** `src/store/hierarchy-repo.ts` — the entire file is the template.

**Imports pattern** (hierarchy-repo.ts lines 1-7):
```typescript
import { eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { workspaces, projects, sequences, shots } from './schema.js';
import type { Workspace, Project, Sequence, Shot } from '../types/hierarchy.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';
```

**Shared `isUniqueViolation` helper** (hierarchy-repo.ts lines 16-26):
```typescript
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  const code = e.code ?? '';
  if (code.startsWith('SQLITE_CONSTRAINT')) {
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
    const msg = e.message ?? '';
    if (/UNIQUE/i.test(msg)) return true;
  }
  return false;
}
```

**Class-with-db-ctor pattern** (hierarchy-repo.ts lines 39-66):
```typescript
export class HierarchyRepo {
  constructor(private db: Db) {}

  createWorkspace(name: string): Workspace {
    const row: Workspace = {
      id: newId('ws'),
      name,
      naming_template: null,
      created_at: Date.now(),
    };
    try {
      this.db.insert(workspaces).values(row).run();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TypedError(
          'DUPLICATE_NAME',
          `Workspace '${name}' already exists`,
          `Pick a different name or list existing workspaces ...`,
        );
      }
      throw err;
    }
    return row;
  }
  // ...
}
```

**Parent-existence-check pattern** (hierarchy-repo.ts lines 94-102, project create):
```typescript
createProject(workspaceId: string, name: string): Project {
  if (!this.getWorkspace(workspaceId)) {
    throw new TypedError(
      'PARENT_NOT_FOUND',
      `Parent workspace '${workspaceId}' not found for project creation`,
      `Verify the parent id with { tool: 'workspace', action: 'get' }`,
    );
  }
  // ... insert + isUniqueViolation wrap
}
```

**Changes when applying to `VersionRepo`:**
- Class name: `VersionRepo`. Constructor: `(private db: Db)` — identical shape.
- **Reuse `isUniqueViolation`** — hoist to a shared utility (e.g. `src/store/sqlite-errors.ts`) or keep a copy and note the duplication; **preferred: hoist** so Phase 3 provenance repo can reuse too. Both copies currently identical.
- Core methods (reference RESEARCH Code Examples §"Version-repo allocation + insert txn" for the verbatim shape):
  - `insertVersion(shotId, notes?): Version` — uses `this.db.transaction(tx => {...})` with SELECT `COALESCE(MAX(version_number), 0) + 1` then INSERT. Retries once on UNIQUE (Pitfall 3), second failure → `TypedError('CONCURRENT_SUBMIT_CONFLICT', ...)`. Initial row has `status='submitted'`, `job_id=null`, `completed_at=null`.
  - `setJobId(id, jobId): void` — `UPDATE versions SET job_id = ? WHERE id = ?`.
  - `markFailed(id, code, message): void` — `UPDATE ... SET status='failed', error_code=?, error_message=?, completed_at=? WHERE id=? AND completed_at IS NULL` (D-GEN-20 immutability guard).
  - `markCompleted(id, outputsJson): void` — `UPDATE ... SET status='completed', outputs_json=?, completed_at=? WHERE id=? AND completed_at IS NULL`.
  - `transition(id, next: 'running'): void` — `UPDATE ... SET status=? WHERE id=?` (only for `submitted → running`; terminal transitions use `markFailed`/`markCompleted`).
  - `getVersion(id): Version | null` — `SELECT * WHERE id = ?` — mirrors `getWorkspace` shape.
  - `listPendingVersions(): Version[]` — `SELECT * WHERE status IN ('submitted', 'running')` — used by recovery poller.
  - *(Optional, for future Phase 3 convenience)* `listByShot(shotId, limit, offset)` — mirrors Phase 1 `listShots`. Not strictly needed in Phase 2 (D-GEN-02 has no `list` action) but cheap to add if the planner wants symmetry. Phase 2 scope is minimal — skip unless asked.
- **Parent-existence check:** `insertVersion` does NOT need a `getShot` FK check; the Phase 1 `shot_id REFERENCES shots(id)` + `PRAGMA foreign_keys=ON` handles it. On FK violation, `isUniqueViolation` returns false; typed-error translation for FK is not in Phase 1 — but since `submitGeneration` loads the shot for breadcrumb anyway, the engine catches missing shots before insert. No extra code needed in the repo.
- Types: extend `Version` in `src/types/hierarchy.ts` to add `error_code: string | null`, `error_message: string | null`, `outputs_json: string | null`:
  ```typescript
  export interface Version {
    id: string;
    shot_id: string;
    version_number: number;
    status: string;
    job_id: string | null;
    parent_version_id: string | null;
    notes: string | null;
    created_at: number;
    completed_at: number | null;
    error_code: string | null;      // NEW
    error_message: string | null;   // NEW
    outputs_json: string | null;    // NEW
  }
  ```

---

### `src/store/schema.ts` (store schema, EXTEND)

**Analog:** self — the existing `versions` table definition (lines 51-66) + `SCHEMA_DDL` string (lines 109-120) are the exact extension point.

**Current `versions` table** (schema.ts lines 51-66):
```typescript
export const versions = sqliteTable('versions', {
  id: text('id').primaryKey(),
  shot_id: text('shot_id')
    .notNull()
    .references(() => shots.id),
  version_number: integer('version_number').notNull(),
  status: text('status').notNull().default('submitted'),
  job_id: text('job_id'),
  parent_version_id: text('parent_version_id'),
  notes: text('notes'),
  created_at: integer('created_at').notNull(),
  completed_at: integer('completed_at'),
}, (t) => ({
  uniqueVersionPerShot: unique().on(t.shot_id, t.version_number),
  idxShot: index('idx_versions_shot').on(t.shot_id, t.version_number),
}));
```

**Current `SCHEMA_DDL` versions block** (schema.ts lines 109-120):
```sql
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL REFERENCES shots(id),
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  job_id TEXT,
  parent_version_id TEXT REFERENCES versions(id),
  notes TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(shot_id, version_number)
);
```

**Changes (D-GEN-19 / D-GEN-38):**
- Add 3 nullable text columns to the Drizzle table definition:
  ```typescript
  error_code: text('error_code'),
  error_message: text('error_message'),
  outputs_json: text('outputs_json'),
  ```
- **Do NOT add them to `SCHEMA_DDL`** — RESEARCH §"Migration file" recommendation 1 keeps the Phase-1 DDL snapshot as-is and relies on Drizzle's `migrate()` to apply `0001_phase2_version_lifecycle.sql` on both fresh and existing DBs. Rationale: ALTER TABLE ADD COLUMN in the migration is not cleanly idempotent when the column already exists from CREATE TABLE (SQLite returns "duplicate column" error). Migration runner on fresh DB: sees no `__drizzle_migrations` table → creates it → applies 0001 → adds the 3 columns to the just-created base table.
- **Alternative considered:** add the 3 columns to both Drizzle schema AND `SCHEMA_DDL`, then turn `0001_*.sql` into a no-op. Rejected — `0001_*.sql` is auto-generated by `drizzle-kit generate`, which would produce an ALTER that fails on fresh DB.
- Verify the db-init test (`src/store/__tests__/db-init.test.ts`) still passes — extending to assert the 3 new columns exist on `versions` after `openDb` is part of the new `migrate.test.ts` (see below).

---

### `src/store/db.ts` (store init, EXTEND)

**Analog:** self. The file already shows the pragma-first init sequence and user_version handshake. Phase 2 adds one call: `migrate(db, { migrationsFolder: './drizzle' })`.

**Current openDb flow** (db.ts lines 19-39):
```typescript
export function openDb(path: string): OpenDbResult {
  const sqlite = new Database(path);

  // Pragmas FIRST, schema SECOND. Order is invariant (D-20, Pitfall #6).
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  const existingVersion = sqlite.pragma('user_version', { simple: true }) as number;
  if (existingVersion === 0) {
    sqlite.exec(SCHEMA_DDL);
    sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);
  } else if (existingVersion !== SCHEMA_VERSION) {
    throw new Error(
      `DB at ${path} is version ${existingVersion}, server expects ${SCHEMA_VERSION}`,
    );
  }

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
```

**Changes (D-GEN-38):**
- Add import: `import { migrate } from 'drizzle-orm/better-sqlite3/migrator';`.
- Add migration call **after** `drizzle(sqlite, {schema})` and **before** `return`:
  ```typescript
  const db = drizzle(sqlite, { schema });
  // Phase 2 addition: drizzle-kit-generated migrations layer on top.
  // Idempotent — drizzle's own __drizzle_migrations table tracks applied files.
  // Synchronous call; no await.
  migrate(db, { migrationsFolder: './drizzle' });
  return { db, sqlite };
  ```
- **Do NOT bump `SCHEMA_VERSION`** — Phase 1's `user_version=1` stays. Drizzle's `__drizzle_migrations` table is a separate ledger (A7 confirms coexistence).
- **Test-side:** `src/test-utils/fixtures.ts` `makeInMemoryDb()` at lines 16-26 must also call `migrate()` after the DDL exec so in-memory tests pick up Phase 2 columns. Pattern:
  ```typescript
  // Match prod init order (see src/store/db.ts)
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(SCHEMA_DDL);
  sqlite.pragma('user_version = 1');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' }); // Phase 2 addition
  return { db, sqlite };
  ```
  This keeps test parity with prod — a Phase 1 invariant (fixtures.ts line 16 comment: *"Mirrors openDb() so tests exercise the same init sequence"*).

---

### `drizzle/0001_phase2_version_lifecycle.sql` (migration, NEW FILE — NO ANALOG)

**No analog.** Phase 1 used hand-rolled `SCHEMA_DDL` + `user_version` pragma; Phase 2 is the first Drizzle-generated migration. RESEARCH §"Migration file" shows the expected shape:

```sql
-- drizzle/0001_phase2_version_lifecycle.sql
-- Generated by: npx drizzle-kit generate --dialect sqlite --schema src/store/schema.ts --out ./drizzle
-- Phase 2 additive migration: lifecycle + outputs columns on versions.
-- No backfill required — Phase 1 committed zero version rows.

ALTER TABLE `versions` ADD `error_code` text;
--> statement-breakpoint
ALTER TABLE `versions` ADD `error_message` text;
--> statement-breakpoint
ALTER TABLE `versions` ADD `outputs_json` text;
```

**Generation command:**
```bash
npx drizzle-kit generate --dialect sqlite --schema src/store/schema.ts --out ./drizzle
```

Planner should also:
- Add `drizzle.config.ts` at repo root if needed by drizzle-kit (the `--schema` / `--out` flags bypass config for a one-shot, but a config file is clearer). Not strictly required.
- Add the `drizzle/meta/` folder to git (auto-generated by drizzle-kit; tracks migration-to-schema fingerprint).
- Ensure `drizzle/0001_*.sql` is committed (gitignore currently does not exclude it — verified at `.gitignore` lines 1-10).

---

### `src/server.ts` (config entry, EXTEND)

**Analog:** self — the existing `buildServer` + `main` flow is the extension point.

**Current imports** (server.ts lines 27-43):
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// ... transport imports
import { parseCliFlags, printHelp } from './utils/cli.js';
import { openDb } from './store/db.js';
import { HierarchyRepo } from './store/hierarchy-repo.js';
import { Engine } from './engine/pipeline.js';
import {
  registerWorkspace,
  registerProject,
  registerSequence,
  registerShot,
} from './tools/index.js';
```

**Current buildServer** (server.ts lines 62-75):
```typescript
function buildServer(engine: Engine, version: string): McpServer {
  const server = new McpServer(
    { name: 'vfx-familiar', version },
    { instructions: '...' },
  );
  registerWorkspace(server, engine);
  registerProject(server, engine);
  registerSequence(server, engine);
  registerShot(server, engine);
  return server;
}
```

**Current main — db init + engine construction** (server.ts lines 77-99):
```typescript
async function main(): Promise<void> {
  const args = parseCliFlags(process.argv.slice(2));
  // ... help / version handling
  const dbPath = args.db ?? './vfx-familiar.db';
  const { db } = openDb(dbPath);
  console.error(`vfx-familiar: db=${dbPath}`);
  const repo = new HierarchyRepo(db);
  const engine = new Engine(repo);
  const version = await readVersion();
  // ... transport wiring
}
```

**Changes:**
1. **Line 1 must be `import 'dotenv/config';`** (Pitfall 2 — ESM depth-first hoisting means any relative import reading `process.env` at module-init time would race otherwise). Current file has a shebang on line 1 (`#!/usr/bin/env node`) followed by a JSDoc block on lines 2-25. Placement: put `import 'dotenv/config';` **immediately after the shebang**, before any other import. The shebang is a comment for Node and doesn't affect the import order.
2. Add imports:
   ```typescript
   import { VersionRepo } from './store/version-repo.js';
   import { ComfyUIClient } from './comfyui/client.js';
   import { registerGeneration } from './tools/index.js';
   ```
3. Update `buildServer` to register one more tool (D-GEN-03):
   ```typescript
   registerGeneration(server, engine); // <-- new line
   ```
4. Update `main` to wire `VersionRepo` + `ComfyUIClient` + Engine composition. Credentials read here (not in engine/client — constructor injection):
   ```typescript
   const versionRepo = new VersionRepo(db);
   const apiKey = process.env.COMFYUI_API_KEY;
   const apiBase = process.env.COMFYUI_API_BASE ?? 'https://cloud.comfy.org';
   const client = apiKey ? new ComfyUIClient(apiKey, apiBase, /* allowedHosts from env */) : null;
   // Engine wiring depends on planner's class layout — either Engine ctor takes generation deps,
   // or a new GenerationEngine is composed alongside.
   const engine = new Engine(repo, versionRepo, client); // (shape TBD by planner)

   // Log credential presence only (D-GEN-12) — ONCE at first submit (preferred) or at boot:
   // `ComfyUI credentials loaded (key ****${apiKey.slice(-4)}, base ${apiBase})`
   // CONTEXT.md D-GEN-12 says "on the first submit per process" — engine-side, not server-side.

   await engine.start(); // recovery poller (D-GEN-29) — see Pattern 6 in RESEARCH
   ```
5. Add SIGINT/SIGTERM cancellation **once, at the bottom of `main`**, after transport setup (RESEARCH Pattern 6):
   ```typescript
   process.on('SIGINT', () => engine.stop().then(() => process.exit(0)));
   process.on('SIGTERM', () => engine.stop().then(() => process.exit(0)));
   ```
6. **Do NOT** call `engine.start()` inside `buildServer()` — that would spawn the poller per HTTP request (RESEARCH anti-pattern). `engine.start()` runs once in `main()`.

---

### `.env.example` (config, NEW FILE — NO ANALOG)

**No analog.** Template per RESEARCH §".env.example":
```bash
# .env.example — committed placeholder. Copy to .env and fill in your values.
# Never commit .env — it's in .gitignore.

# ComfyUI Cloud API key. Generate at https://platform.comfy.org
COMFYUI_API_KEY=your-comfy-api-key-here

# ComfyUI Cloud API base URL. Default is https://cloud.comfy.org — the canonical
# cloud endpoint per docs.comfy.org/development/cloud/overview. Override for
# staging or self-hosted ComfyUI if needed.
COMFYUI_API_BASE=https://cloud.comfy.org
```

**Discrepancy note for planner:** CONTEXT.md D-GEN-11 originally listed `https://api.comfy.org` as the default. RESEARCH Pitfall 1 + docs.comfy.org both confirm `https://cloud.comfy.org` is the canonical URL. CONTEXT.md §"Decisions" was updated on 2026-04-20 to reflect `cloud.comfy.org`. `.env.example` and code default must use `https://cloud.comfy.org`.

---

## Test File Patterns

### `src/engine/__tests__/backoff.test.ts` (test, unit pure, NEW FILE)

**Analog:** `src/engine/__tests__/shot-naming.test.ts` — smallest pure-parameter-table test in Phase 1.

**Parameter-table pattern** (shot-naming.test.ts lines 12-32, 50-59):
```typescript
const VALID_SHOT_NAMES = [
  'sh010', 'sh020', 'sh015', 'sh0120', 'sh1000', 'sh999999',
];
const INVALID_SHOT_NAMES = [
  'SH010', 'sh1', 'sh_010', 'shot010', 'sh01', 'SH_010', 'sh-010', 'sh010a', '', 'Sh010',
];

describe('shot naming regex (^sh\\d{3,}$)', () => {
  // ... beforeEach setup ...
  test.each(VALID_SHOT_NAMES)('valid shot name %s is accepted', (name) => {
    const result = engine.createShot(sequenceId, name);
    expect(result.entity.name).toBe(name);
  });
  test.each(INVALID_SHOT_NAMES)('invalid shot name %j is rejected', (name) => {
    expect(() => engine.createShot(sequenceId, name)).toThrowTypedError('INVALID_SHOT_FORMAT');
  });
});
```

**Changes when applying to `backoff.test.ts`:**
- Import `createBackoffIterator` from `../backoff.js` (no engine, no SQLite needed — pure generator test).
- Assert first 6 yielded values equal `[2000, 4000, 8000, 16000, 30000, 30000]`.
- Assert the 100th yielded value equals `30000` (cap semantics, D-GEN-24).
- Assert a NEW iterator starts over at `2000` (reset-per-job semantics).
- If testing `sleep(ms, signal?)`: use `vi.useFakeTimers()` and assert `sleep(100)` resolves after `vi.advanceTimersByTime(100)`; assert an aborted signal rejects with `AbortError`. See D-GEN-24 code example in RESEARCH.
- ~30 lines total (matches RESEARCH Wave 0 estimate).

---

### `src/store/__tests__/version-repo.test.ts` (test, unit SQLite, NEW FILE)

**Analog:** `src/engine/__tests__/hierarchy.test.ts` — the template for in-memory-SQLite integration-style tests (full stack engine + repo + real SQL).

**Setup pattern** (hierarchy.test.ts lines 10-13):
```typescript
beforeEach(() => {
  const { db } = makeInMemoryDb();
  engine = new Engine(new HierarchyRepo(db));
});
```

**Duplicate-detection pattern** (hierarchy.test.ts lines 30-40):
```typescript
test('duplicate workspace name throws DUPLICATE_NAME (not raw SQLite)', () => {
  engine.createWorkspace('ws1');
  try {
    engine.createWorkspace('ws1');
    throw new Error('expected throw');
  } catch (err: any) {
    expect(err.name).toBe('TypedError');
    expect(err.code).toBe('DUPLICATE_NAME');
    expect(err.message).not.toContain('SQLITE_CONSTRAINT');
  }
});
```

**Changes when applying to `version-repo.test.ts`:**
- `beforeEach`: `makeInMemoryDb()` → create `VersionRepo` + `HierarchyRepo` → seed one workspace → project → sequence → shot (for FK satisfaction).
- Tests (per RESEARCH Phase Requirements → Test Map):
  - `version_number is MAX+1 on first insert` — first inserted version for a shot has `version_number === 1`.
  - `version_number is monotone per shot` — 5 sequential inserts produce `1,2,3,4,5`.
  - `version_number is independent per shot` — shot A and shot B each start at 1.
  - `concurrent UNIQUE violation triggers retry; second violation surfaces as CONCURRENT_SUBMIT_CONFLICT` — use a spy on `db.transaction` to force one UNIQUE rethrow, verify retry succeeds; force two rethrows, verify `toThrowTypedError('CONCURRENT_SUBMIT_CONFLICT')`.
  - `completed_at immutability` — call `markCompleted` once, then `markFailed` (or another `markCompleted`), assert second update is a no-op by inspecting row.
  - `markFailed sets status, error_code, error_message, completed_at` — verify all 4 fields.
  - `markCompleted sets status, outputs_json, completed_at` — verify all 3.
  - `listPendingVersions returns only submitted|running rows` — insert 3 rows (submitted, running, completed), assert list returns 2.
  - `getVersion returns null for missing id` — no throw, returns null (repo convention).
- Use `expect(() => repo.insertVersion(...)).toThrowTypedError('CONCURRENT_SUBMIT_CONFLICT')` via the custom matcher (`matchers.ts`).
- ~150 lines (matches RESEARCH Wave 0 estimate).

---

### `src/engine/__tests__/generation.test.ts` (test, unit with fake client, NEW FILE)

**Analog:** `src/engine/__tests__/hierarchy.test.ts` for setup + `src/test-utils/fake-engine.ts` for the spy pattern.

**Why these two analogs:** `generation.test.ts` is engine-level, so it uses a real in-mem SQLite (`hierarchy.test.ts` pattern) but swaps the HTTP boundary for a fake (`fake-engine.ts` pattern of call-recording + canned returns). This is the exact pattern Phase 1's tool tests use for engine isolation, flipped one layer up.

**In-mem DB setup (same as `hierarchy.test.ts`):**
```typescript
beforeEach(() => {
  const { db } = makeInMemoryDb();
  // seed shot chain
  // wire generation engine with FakeComfyUIClient
});
```

**Fake-spy pattern** (fake-engine.ts lines 11-23):
```typescript
export interface FakeCall {
  method: string;
  args: unknown[];
}

export class FakeEngine {
  calls: FakeCall[] = [];
  // ... each method pushes to calls, returns canned value
}
```

**Changes when applying to `generation.test.ts`:**
- Import `FakeComfyUIClient` (new, see `src/test-utils/fake-comfyui-client.ts` below).
- Construct generation engine with real `VersionRepo` + real `HierarchyRepo` (both on in-mem DB) + `FakeComfyUIClient`.
- Tests per RESEARCH Phase Requirements → Test Map:
  - `submit inserts version row` — call `submitGeneration`, assert `status='submitted'`, `version_number=1`, `job_id` matches fake's canned value.
  - `submit delegates to client.submit with workflow` — verify `fakeClient.calls` recorded the call with the expected args.
  - `submit envelope shape` — verify `{entity, breadcrumb}` returned; breadcrumb has 5 entries with version leaf labelled `v001`.
  - `status advances submitted → running` — configure fake to return `{status: 'in_progress'}`; call `getGenerationStatus`; assert row now has `status='running'`.
  - `status advances running → completed downloads outputs` — fake returns `completed` + 1 output; assert row has `status='completed'`, `outputs_json` populated, and `downloadAndPersist` wrote to disk (use a temp dir; cleanup in afterEach).
  - `status cached on terminal` — after transition to `completed`, a second `getGenerationStatus` call does NOT hit the fake (assert `fakeClient.calls.length` unchanged).
  - `timeout trips at 10 min` — fake `row.created_at = Date.now() - 600001`; call `getGenerationStatus`; assert `status='failed'`, `error_code='GENERATION_TIMEOUT'`.
  - `failed records error` — fake returns `{status: 'failed', error: {node_errors: {3: {errors: [{type, message: 'bad input'}], class_type: 'KSampler'}}}}`; assert `error_message` is `"Node 3 (KSampler): bad input"` (D-GEN-27 + Pitfall 4).
  - `download retry succeeds on 2nd attempt` — fake download throws once then returns stream; assert file on disk.
  - `download hopeless → DOWNLOAD_FAILED` — fake throws 3 times; assert `status='failed'`, `error_code='DOWNLOAD_FAILED'`.
  - `recovery poller drains pending rows` — insert 2 `submitted` rows directly via repo, configure fake to advance both to completed, call `engine.start()`, use fake timers to jump past 2s backoff, assert both rows terminal, then `engine.stop()` cancels cleanly.
  - `on-demand status bypasses backoff` — calling `getGenerationStatus` for a `submitted` row fetches immediately (no sleep).
- Use `vi.useFakeTimers()` for the poller + backoff tests (`vi.advanceTimersByTime`).
- ~200 lines (matches RESEARCH Wave 0 estimate).

---

### `src/tools/__tests__/generation-tool.test.ts` (test, integration, NEW FILE)

**Analog:** `src/tools/__tests__/error-wrapping.test.ts` + `breadcrumb-always.test.ts` — the "direct-mirror" pattern.

**Direct-mirror pattern** (error-wrapping.test.ts lines 1-7 comment + lines 45-56):
```typescript
// Approach: direct-mirror. The MCP SDK's registered-tool handler path is
// private (`_registeredTools.handler`) and is designed to be driven by a live
// JSON-RPC transport. [...] tests mirror the handler body: (a) call the engine,
// (b) pipe through shapeCreateOrGet/shapeList, (c) envelope via toolOk/toolError.

function invokeCreate<TEntity>(
  fn: () => { entity: TEntity; breadcrumb: Breadcrumb },
): ToolResponse {
  try {
    return toolOk(shapeCreateOrGet(fn()));
  } catch (err) {
    return toolError(err);
  }
}
```

**Registration-smoke pattern** (error-wrapping.test.ts lines 222-238):
```typescript
describe('error-wrapping: registerX smoke', () => {
  it('all 4 register functions register their tools against a live McpServer', () => {
    const { engine } = buildTestStack();
    const server = new McpServer({ name: 'test-server', version: '0.0.0' });

    expect(() => registerWorkspace(server, engine)).not.toThrow();
    // ...
    const registered = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(Object.keys(registered).sort()).toEqual(['project', 'sequence', 'shot', 'workspace'].sort());
  });
});
```

**Changes when applying to `generation-tool.test.ts`:**
- `buildTestStack()` returns `{engine, versionRepo, fakeClient}` — in-mem DB + fakes.
- Direct-mirror handlers: `invokeSubmit(engine, shotId, workflowJson, notes?)` and `invokeStatus(engine, versionId)` — each wraps the exact try/toolOk/toolError/catch/z.ZodError branch of `generation-tool.ts`.
- Tests:
  - `submit happy path — structuredContent has entity + breadcrumb + breadcrumb_text` (D-GEN-05, Phase 1 D-22/D-23).
  - `submit resolves quickly (< 1s) for a canned fake response` (GEN-02).
  - `submit with UI-format workflow → isError:true, code=INVALID_WORKFLOW_FORMAT, hint mentions 'Dev Mode > Save (API Format)'`.
  - `submit with invalid shot_id → isError:true, code=SHOT_NOT_FOUND` (or PARENT-style).
  - `status happy path — structuredContent.entity has progress/error/completed_at fields` (D-GEN-07).
  - `status for unknown version_id → isError:true, code=VERSION_NOT_FOUND`.
  - `submit missing COMFYUI_API_KEY → isError:true, code=COMFYUI_CREDENTIALS_MISSING` (engine-side check; test with engine built with `client=null` or a throwing stub).
  - `Zod rejection on missing shot_id → isError:true, code=INVALID_INPUT, message contains 'input.shot_id'` (mirrors Phase 1 line 131-153 Zod rewrap pattern).
  - `breadcrumb on every success response` — 5-entry breadcrumb for version leaf.
  - **Smoke:** `registerGeneration` registers against a live McpServer without throwing; `_registeredTools` contains `'generation'`.
- Also extend the existing Phase-1 `error-wrapping.test.ts` registration-smoke to include the new key (or duplicate that smoke here). Safe to do in this file for locality.
- `expect(errSpy).toHaveBeenCalledTimes(1)` for any fallback-envelope test (mirrors Phase 1 D-21 pattern).
- ~100 lines (matches RESEARCH Wave 0 estimate).

---

### `src/comfyui/__tests__/format.test.ts` (test, unit pure, NEW FILE)

**Analog:** `src/engine/__tests__/shot-naming.test.ts` — pure parameterized acceptance/rejection table.

Same `test.each` pattern as `shot-naming.test.ts`:
- `VALID_API_FORMAT`: `[{'1': {class_type: 'A', inputs: {}}}]` and minimal variations.
- `INVALID_UI_FORMAT`: `[{nodes: [], links: []}, {nodes: [], last_node_id: 5}, {groups: []}]` — assert each throws `INVALID_WORKFLOW_FORMAT` with hint mentioning 'Dev Mode > Save (API Format)'.
- `INVALID_OTHER`: `[{}, [], null, undefined, 42, 'hello', {foo: 'bar'}, {'1': {class_type: 'A'}}, {'1': {inputs: {}}}, {'a': {class_type: 'A', inputs: {}}}]` (Pitfall 5 edge cases) — assert generic INVALID_WORKFLOW_FORMAT.
- Also test `extractFirstNodeError` separately (D-GEN-27, Pitfall 4):
  - Full fixture: `{'3': {errors: [{type:'required_input_missing', message:'bad'}], dependent_outputs: [], class_type: 'KSampler'}}` → `"Node 3 (KSampler): bad"`.
  - Empty object → `null`.
  - `null` → `null`.
  - Array input → `null`.
  - Missing `errors[0].message` → `null`.
- ~80 lines (matches RESEARCH Wave 0 estimate).

---

### `src/comfyui/__tests__/live-smoke.test.ts` (test, gated e2e, NEW FILE — NO ANALOG)

**No analog.** Phase 1 has no network/filesystem end-to-end test. Implement fresh.

**Gated-skip pattern** (RESEARCH §"Live smoke"):
```typescript
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, unlinkSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const SKIP = !process.env.COMFYUI_API_KEY;

describe.skipIf(SKIP)('live ComfyUI smoke', () => {
  // ... setup real client + real engine against a real in-mem or temp-file SQLite
  // ... submit a minimal API-format workflow (cheap: SD 1.5 at 512x512, ~20 steps)
  // ... poll via the real hybrid strategy until 'completed' (timeout: 180s)
  // ... assert output file on disk, size > 0, content-type correct
  // ... afterAll: delete downloaded file + DB row (cleanup)
});
```

**Guidance (since no analog):**
- Use `describe.skipIf(SKIP)` or `test.skipIf(SKIP, ...)` per Vitest docs — stable API. Both patterns work; `describe.skipIf` avoids repeating the condition.
- API key presence is the gate (NOT the key value itself — don't compare or log).
- Submit the cheapest possible workflow from A6 — planner can keep it inline as a JS object or load from a fixture file `src/comfyui/__tests__/fixtures/minimal-workflow.json`.
- Use a temp dir for outputs (`os.tmpdir()` + nanoid suffix) to avoid polluting `./outputs/` during local dev.
- Use a temp-file SQLite DB (same pattern as `db-init.test.ts` lines 12-25) — mirrors production code path more faithfully than in-mem DB.
- `afterAll` cleanup must delete both the temp DB (`.db`, `-wal`, `-shm` side-cars) and the output tree.
- Timeout: `test('...', async () => { ... }, 180_000)` — 3 minutes is the p95 for a cheap image workflow.
- ~60 lines (matches RESEARCH Wave 0 estimate).

---

### `src/store/__tests__/migrate.test.ts` (test, SQLite migration, NEW FILE)

**Analog:** `src/store/__tests__/db-init.test.ts` — the temp-file SQLite setup + cleanup pattern is exactly reusable.

**Temp-file SQLite setup pattern** (db-init.test.ts lines 12-25):
```typescript
function uniqueDbPath(label: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return path.join(os.tmpdir(), `vfx-familiar-${label}-${rand}.db`);
}

function cleanup(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* ignore missing files */
    }
  }
}
```

**Schema-inspection pattern** (db-init.test.ts lines 75-102):
```typescript
test('schema tables present after first run', () => {
  const { sqlite } = openDb(dbPath);
  const rows = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as { name: string }[];
  const tableNames = rows.map((r) => r.name);
  for (const expected of ['workspaces', 'projects', 'sequences', 'shots', 'versions']) {
    expect(tableNames).toContain(expected);
  }
  sqlite.close();
});
```

**Changes when applying to `migrate.test.ts`:**
- Same `uniqueDbPath` + `cleanup` helpers (or extract to a shared `test-utils/temp-db.ts`).
- Tests:
  - `after openDb, versions table has error_code, error_message, outputs_json columns` — query `PRAGMA table_info(versions)` and assert the 3 new columns present with type TEXT and `notnull=0`.
  - `__drizzle_migrations table exists after openDb` — assert it's in `sqlite_master`.
  - `__drizzle_migrations has one row after first openDb` — matches 0001 applied.
  - `second openDb is idempotent (no duplicate rows in __drizzle_migrations)` — call `openDb` twice, assert still 1 row.
  - `new db created from scratch includes Phase 2 columns` — fresh db path, `openDb`, inspect `versions`.
- `PRAGMA table_info` query: `SELECT name, type, "notnull" FROM pragma_table_info('versions')`.
- ~80 lines.

---

### `src/test-utils/fake-engine.ts` (test-util, EXTEND)

**Analog:** self. Add generation-op methods to the existing `FakeEngine` class. Same spy-call recording pattern already in use.

**Existing pattern for a method** (fake-engine.ts lines 117-128, `createShot`):
```typescript
createShot(sequenceId: string, name: string): { entity: Shot; breadcrumb: Breadcrumb } {
  this.calls.push({ method: 'createShot', args: [sequenceId, name] });
  if (!SHOT_REGEX.test(name)) {
    throw new TypedError(
      'INVALID_SHOT_FORMAT',
      `Shot name '${name}' does not match expected format`,
      `Shot names must match ^sh\\d{3,}$ — e.g. 'sh010', 'sh020'`,
    );
  }
  const entity: Shot = { id: 'shot_fake', sequence_id: sequenceId, name, created_at: 0 };
  return { entity, breadcrumb: this.bc('shot', entity.id, name) };
}
```

**Changes — add 4 new methods:**
- `submitGeneration(shotId: string, workflowJson: unknown, notes?: string): Promise<{entity: Version; breadcrumb: Breadcrumb}>` — push call, return canned `Version` with `status='submitted'`, `version_number=1`, `job_id='prompt_fake_123'`, breadcrumb 5-entry.
- `getGenerationStatus(versionId: string): Promise<{entity: Version; breadcrumb: Breadcrumb}>` — push call, return canned row. Support a scenario-mode field on the fake (e.g. `this.scenario = 'completed' | 'running' | 'failed' | 'not_found'`) so tool-level tests can drive different branches.
- `start(): Promise<void>` — push call, noop.
- `stop(): Promise<void>` — push call, noop.
- Extend `Version` canned shape to include the 3 new fields (`error_code: null, error_message: null, outputs_json: null`).
- **Invariant preserved:** `FakeEngine` must NOT pull in a real `ComfyUIClient` or `VersionRepo`. Pure in-memory canned responses.

---

### `src/test-utils/fake-comfyui-client.ts` (test-util, NEW FILE)

**Analog:** `src/test-utils/fake-engine.ts` — the spy pattern is the template.

**Spy pattern** (fake-engine.ts lines 11-23):
```typescript
export interface FakeCall {
  method: string;
  args: unknown[];
}

export class FakeEngine {
  calls: FakeCall[] = [];
  // ...
}
```

**Changes when applying to `FakeComfyUIClient`:**
- Same `calls: FakeCall[]` recorder.
- Three methods mirroring the real client:
  - `submit(workflowJson): Promise<{ prompt_id: string }>` — push call; default canned `{prompt_id: 'prompt_fake_123'}`; configurable to throw `TypedError('COMFYUI_API_ERROR', ...)` or `('COMFYUI_RATE_LIMITED', ...)` via a scenario setter.
  - `status(jobId): Promise<ComfyStatus>` — push call; scenario-driven return (`pending` / `in_progress` with optional progress / `completed` with outputs / `failed` with node_errors / `cancelled`).
  - `download(filename, opts): Promise<{body: ReadableStream; ...}>` — push call; return a small in-memory `ReadableStream` of test bytes (use `new Blob([Uint8Array])` + `.stream()`). Scenario: succeed / throw once then succeed / throw 3× (tests `DOWNLOAD_FAILED`).
- Scenario modes documented in file header: `'happy' | 'failed-validation' | 'slow-running' | 'timeout-prone' | 'download-flaky' | 'download-hopeless'`.
- ~120 lines (matches RESEARCH Wave 0 estimate).

---

## Cross-Cutting Test Extensions

### `src/__tests__/tool-budget.test.ts` (EXTEND)

**Current exact-count assertion** (lines 30-38):
```typescript
describe('tool budget', () => {
  it('stays under the 12-tool cap (Pitfall #1)', () => {
    expect(registerToolCount()).toBeLessThanOrEqual(12);
  });

  it('Phase 1 registers exactly 4 tools (D-04)', () => {
    expect(registerToolCount()).toBe(4);
  });
});
```

**Changes:** Update the exact-count test label + value:
```typescript
it('Phase 2 registers exactly 5 tools (D-GEN-03)', () => {
  expect(registerToolCount()).toBe(5);
});
```
The `<=12` ceiling test is unchanged.

---

### `src/__tests__/architecture-purity.test.ts` (EXTEND)

**Current per-directory assertions** (lines 28-43):
```typescript
describe('architecture purity', () => {
  it('src/engine/ has zero imports from @modelcontextprotocol/sdk', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/')).toBe(0);
  });
  // ... repeat for store, utils, types
});
```

**Changes:** Add three assertions for `src/comfyui/` covering MCP SDK + Drizzle + better-sqlite3 (D-GEN-21):
```typescript
it('src/comfyui/ has zero imports from @modelcontextprotocol/sdk', () => {
  expect(grepCount('@modelcontextprotocol/sdk', 'src/comfyui/')).toBe(0);
});
it('src/comfyui/ has zero imports from better-sqlite3', () => {
  expect(grepCount('better-sqlite3', 'src/comfyui/')).toBe(0);
});
it('src/comfyui/ has zero imports from drizzle-orm', () => {
  expect(grepCount('drizzle-orm', 'src/comfyui/')).toBe(0);
});
```

---

### `src/__tests__/stdio-hygiene.test.ts` (EXTEND)

**Current boot-stdout assertion** (lines 48-54):
```typescript
const stdout = Buffer.concat(chunks).toString('utf8');
const stderr = Buffer.concat(stderrChunks).toString('utf8');

expect(stdout).toBe('');
// stderr should have the boot marker from server.ts.
expect(stderr).toMatch(/stdio transport connected/);
```

**Changes:** Add an assertion that `COMFYUI_API_KEY=` (literal) never appears on either stream (D-GEN-12 presence-only log):
```typescript
expect(stdout).toBe('');
expect(stderr).toMatch(/stdio transport connected/);
// D-GEN-12: the KEY VALUE must never appear, only last-4 via the format
// `ComfyUI credentials loaded (key ****<last4>, base <base>)`.
expect(stderr).not.toMatch(/COMFYUI_API_KEY=/);
// Even the env-var name with an equals sign appearing in any log path is a red flag.
```
The child-process spawn env-scrubbing pattern (lines 28-40) of `zero-config.test.ts` can be adapted if the test needs `.env` isolation — for Phase 2, the test should `spawn` with `env: {PATH, HOME /* nothing else */}` so `COMFYUI_API_KEY` is absent and no credential log fires, confirming the "silent if .env missing" path (D-GEN-14).

---

## Shared Patterns

### Tool-layer Zod + Envelope + TypedError triad

**Source:** `src/tools/shot-tool.ts` (reference) + `src/tools/envelope.ts` + `src/tools/shape.ts`

**Apply to:** `src/tools/generation-tool.ts`

**Template pattern (complete handler body):**
```typescript
async (input) => {
  try {
    switch (input.action) {
      case 'submit':
        return toolOk(shapeCreateOrGet(await engine.submitGeneration(input.shot_id, input.workflow_json, input.notes)));
      case 'status':
        return toolOk(shapeCreateOrGet(await engine.getGenerationStatus(input.version_id)));
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      const path = first.path.join('.');
      return toolError(
        new TypedError('INVALID_INPUT', `Invalid input at 'input.${path}' -- ${first.message}`),
      );
    }
    return toolError(err);
  }
}
```

---

### Repo-layer DB + TypedError + isUniqueViolation triad

**Source:** `src/store/hierarchy-repo.ts` lines 16-26 (`isUniqueViolation`) + lines 46-66 (`createWorkspace` pattern).

**Apply to:** `src/store/version-repo.ts` (UNIQUE retry + `CONCURRENT_SUBMIT_CONFLICT` translation).

**Template for a try/catch/typed-throw:**
```typescript
try {
  this.db.insert(versions).values(row).run();
} catch (err) {
  if (isUniqueViolation(err)) {
    throw new TypedError(
      'CONCURRENT_SUBMIT_CONFLICT',
      `Concurrent submit for shot '${shotId}' — retry once`,
      'Retry the submit call; rare race between two near-simultaneous submits.',
    );
  }
  throw err;
}
```

---

### Defence-in-depth error envelope

**Source:** `src/tools/envelope.ts` lines 32-60 (`toolError`).

**Apply to:** All new tools. No new file needed — `toolError` handles `TypedError` + any fallback. Phase 2 adds 8 new `ErrorCode` literals; `TypedError` constructor already accepts any `ErrorCode`. No envelope changes.

**Invariant:** Raw SQLite errors, ComfyUI API error objects, stream errors, fetch network errors all get caught by `toolError`'s fallback and re-wrapped as `{code: 'INVALID_INPUT', message: 'Unexpected internal error'}` (defence-in-depth D-13 / D-32). Engine-level `TypedError` throws propagate with the intended code.

---

### Breadcrumb on every response

**Source:** `src/engine/pipeline.ts` + `src/tools/shape.ts` (unchanged Phase 1).

**Apply to:** Every `submit` / `status` response in `generation-tool.ts`. Engine returns `{entity, breadcrumb}`; `shapeCreateOrGet` splits into top-level `breadcrumb` array + `breadcrumb_text`. `breadcrumb.resolve('version', id)` walks all 5 levels.

**Invariant (D-22, D-23 from Phase 1):** every tool response — success or list — has `breadcrumb` array + `breadcrumb_text` at the structuredContent top level. Generation tool inherits this for free by reusing `shapeCreateOrGet` on the single-entity return.

---

### In-memory SQLite test fixture

**Source:** `src/test-utils/fixtures.ts` lines 16-26 (`makeInMemoryDb`).

**Apply to:** `version-repo.test.ts`, `generation.test.ts`, `generation-tool.test.ts`, `breadcrumb-always.test.ts` extension (if version-leaf breadcrumb gets integration-tested here).

**Change required:** `fixtures.ts` `makeInMemoryDb()` must call `migrate(db, { migrationsFolder: './drizzle' })` after `sqlite.exec(SCHEMA_DDL)` so in-memory tests pick up Phase 2 columns. This is the only change to the fixture for Phase 2 — otherwise re-used verbatim.

---

### Custom matcher `toThrowTypedError(code)`

**Source:** `src/test-utils/matchers.ts` lines 4-28.

**Apply to:** Any Phase 2 test that asserts a specific `ErrorCode`. Pattern:
```typescript
expect(() => engine.submitGeneration(bogusShotId, wf)).toThrowTypedError('SHOT_NOT_FOUND');
expect(() => repo.insertVersion(validShotId)).toThrowTypedError('CONCURRENT_SUBMIT_CONFLICT');
```
No change to `matchers.ts` itself — all new codes are already accepted via `ErrorCode` type union.

**One caveat:** the matcher is sync-only (`received: () => unknown` called directly). Phase 2 tests asserting errors from **async** engine methods (`submitGeneration`, `getGenerationStatus`) should use Vitest's native `await expect(fn()).rejects.toThrow()` or extend the matcher. Planner's call; suggested pattern for async:
```typescript
await expect(engine.submitGeneration(bogus, wf)).rejects.toMatchObject({
  name: 'TypedError',
  code: 'SHOT_NOT_FOUND',
});
```

---

## No Analog Found

Files with no close match in the Phase 1 codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/utils/outputs.ts` | utility (fs) | file-I/O | Phase 1 `utils/` has only arg-parsing (`cli.ts`) and ID gen (`id.ts`); no filesystem helper. Implement fresh per RESEARCH §"Don't Hand-Roll" row "Output disk path". |
| `drizzle/0001_phase2_version_lifecycle.sql` | migration | — | Phase 1 used hand-rolled `SCHEMA_DDL`; no previous Drizzle migration. Generate via `drizzle-kit generate`. Template in RESEARCH Code Examples. |
| `.env.example` | config | — | New file; no Phase 1 analog. Template in RESEARCH §".env.example". |
| `src/comfyui/__tests__/live-smoke.test.ts` | test (gated e2e) | network + fs | No Phase 1 e2e test exists. Use Vitest `describe.skipIf(!process.env.COMFYUI_API_KEY)` gate. |

**Partial analogs (role-match only, data flow differs):**

| File | Role | Data Flow | Nearest Phase 1 file | Why partial |
|------|------|-----------|----------------------|-------------|
| `src/comfyui/client.ts` | HTTP client | request-response + file-I/O | `src/store/hierarchy-repo.ts` | Boundary-isolation + TypedError-on-well-known-failure pattern transfers; HTTP + streams do not exist in Phase 1. RESEARCH Patterns 4, 5 are authoritative for the new I/O shapes. |
| `src/engine/backoff.ts` | utility (pure) | transform (generator) | `src/utils/id.ts` | Pure-tiny-helper shape transfers; async generator + `AbortSignal` semantics are novel. RESEARCH Code Examples §"Backoff generator" is the direct template. |

---

## Metadata

**Analog search scope:**
- `src/tools/**/*.ts` — 5 files read (workspace, project, sequence, shot tools + shape + envelope + index)
- `src/engine/**/*.ts` — 3 files read (pipeline, breadcrumb, errors)
- `src/store/**/*.ts` — 3 files read (hierarchy-repo, schema, db)
- `src/utils/**/*.ts` — 2 files read (cli, id)
- `src/types/**/*.ts` — 1 file read (hierarchy)
- `src/test-utils/**/*.ts` — 3 files read (fake-engine, fixtures, matchers)
- `src/__tests__/**/*.ts` — 4 files read (architecture-purity, tool-budget, stdio-hygiene, zero-config)
- `src/tools/__tests__/**/*.ts` — 3 files read (breadcrumb-always, envelope, error-wrapping)
- `src/engine/__tests__/**/*.ts` — 2 files read (hierarchy, shot-naming)
- `src/store/__tests__/**/*.ts` — 1 file read (db-init)
- `src/server.ts` — 1 file read

**Files scanned:** 28 (all Phase 1 source files).

**Pattern extraction date:** 2026-04-20

**Key patterns identified:**
1. **Tool-engine-store triad discipline** — tools import engine; engine imports repo + breadcrumb + errors; repo imports drizzle + types + errors; zero cycles. Phase 2 `src/comfyui/` adds a fourth sibling tier (HTTP boundary) that imports nothing from the triad except `errors.ts`.
2. **TypedError-only error surface** — every throw below the tool boundary is a `TypedError`; `toolError` in `envelope.ts` is the single translation point. Phase 2 adds 8 new codes to the same single union.
3. **Breadcrumb on every response** — `shapeCreateOrGet` + `shapeList` split engine's `{entries, text}` into `breadcrumb[]` + `breadcrumb_text`; Phase 2 extends `BreadcrumbResolver` with a `'version'` leaf and the same shapers work.
4. **In-memory SQLite test doubles** — `makeInMemoryDb()` + real `HierarchyRepo` is the Phase 1 test idiom for store-level tests; Phase 2 adds one `migrate()` call to `makeInMemoryDb` to pick up the new columns.
5. **Direct-mirror tool-layer tests** — the MCP SDK's internal `_registeredTools.handler` is private, so Phase 1 tool tests mirror the handler body manually. Phase 2 `generation-tool.test.ts` reuses the `error-wrapping.test.ts` scaffold verbatim.
6. **Test-first cross-cutting asserts** — `tool-budget`, `architecture-purity`, `stdio-hygiene` are grep-based invariants extended in every phase. Phase 2 bumps the count, adds a directory, adds a key-leak regex.

---

## PATTERN MAPPING COMPLETE
