# Phase 3: Provenance & Versioning - Pattern Map

**Mapped:** 2026-04-22
**Files analyzed:** 32 (9 new + 10 modified + 13 new/extended tests)
**Analogs found:** 29 / 32 (3 files have no exact analog — PNG parser, diff engine, diff summary)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `drizzle/0003_phase3_provenance.sql` | migration | — | `drizzle/0001_phase2_version_lifecycle.sql` | exact |
| `src/types/provenance.ts` | type-only | — | `src/types/hierarchy.ts` | exact |
| `src/store/provenance-repo.ts` | store (append-only) | event-driven insert | `src/store/version-repo.ts` | exact |
| `src/engine/provenance.ts` | engine (pure + orchestrator) | transform + event orchestration | `src/comfyui/format.ts` (pure validators) + `src/engine/generation.ts` (orchestrator) | role-match (pure + orchestrator hybrid) |
| `src/engine/diff-summary.ts` | engine (pure) | transform | `src/utils/id.ts` + `src/engine/backoff.ts` | role-match (pure helper shape) |
| `src/engine/diff.ts` | engine (pure) | transform | `src/comfyui/format.ts` (pure + TypedError throws) | role-match |
| `src/engine/iterate-merge.ts` | engine (pure) | transform | `src/comfyui/format.ts` (pure validator w/ TypedError) | role-match |
| `src/comfyui/png-metadata.ts` | utility (pure binary parser) | file-I/O (read only) | `src/comfyui/format.ts` (pure detector) | partial (no PNG analog) |
| `src/comfyui/client.ts` | client (HTTP) | EXTEND — add `fetchResolvedPrompt` | (self — EXTEND) | exact |
| `src/store/schema.ts` | store (schema) | — | (self — EXTEND `versions` + new `provenance`) | exact |
| `src/store/version-repo.ts` | store | EXTEND — add `setLineage` | (self — EXTEND) | exact |
| `src/engine/generation.ts` | engine | EXTEND — reproduce/iterate methods | (self — EXTEND) | exact |
| `src/engine/pipeline.ts` | engine (facade) | EXTEND — add version/provenance/diff/reproduce/iterate | (self — EXTEND) | exact |
| `src/tools/version-tool.ts` | tool (NEW) | request-response | `src/tools/generation-tool.ts` | exact |
| `src/tools/generation-tool.ts` | tool | EXTEND — reproduce/iterate actions | (self — EXTEND) | exact |
| `src/tools/index.ts` | config (barrel) | — | (self — EXTEND) | exact |
| `src/server.ts` | config (entry) | — | (self — EXTEND `registerVersion`) | exact |
| `src/types/hierarchy.ts` | type-only | EXTEND — `lineage_type` on `Version` | (self — EXTEND) | exact |
| `src/test-utils/fixtures.ts` | test-util | EXTEND — provenance fixtures | (self — EXTEND) | exact |
| `src/store/__tests__/provenance-repo.test.ts` | test (unit, SQLite) | — | `src/store/__tests__/version-repo.test.ts` | exact |
| `src/store/__tests__/schema.test.ts` | test (SQLite init) | — | `src/store/__tests__/migrate.test.ts` | exact |
| `src/engine/__tests__/model-extraction.test.ts` | test (unit, pure) | — | `src/comfyui/__tests__/format.test.ts` | exact |
| `src/engine/__tests__/seed-extraction.test.ts` | test (unit, pure) | — | `src/comfyui/__tests__/format.test.ts` | exact |
| `src/engine/__tests__/diff.test.ts` | test (unit, pure) | — | `src/comfyui/__tests__/format.test.ts` | exact |
| `src/engine/__tests__/iterate-merge.test.ts` | test (unit, pure) | — | `src/comfyui/__tests__/format.test.ts` | exact |
| `src/tools/__tests__/version-tool.test.ts` | test (integration) | — | `src/tools/__tests__/generation-tool.test.ts` | exact |
| `src/tools/__tests__/generation-reproduce-iterate.test.ts` | test (integration) | — | `src/tools/__tests__/generation-tool.test.ts` | exact |
| `src/comfyui/__tests__/png-metadata.test.ts` | test (unit, pure) | — | `src/comfyui/__tests__/format.test.ts` | role-match |
| `src/comfyui/__tests__/live-smoke-provenance.test.ts` | test (gated e2e) | request-response + file-I/O | `src/comfyui/__tests__/live-smoke.test.ts` | exact |
| `src/__tests__/architecture-purity.test.ts` | cross-cutting test | — | (self — EXTEND with 4 new pure modules) | exact |
| `src/__tests__/tool-budget.test.ts` | cross-cutting test | — | (self — EXTEND 5→6) | exact |
| `src/__tests__/stdio-hygiene.test.ts` | cross-cutting test | — | (self — EXTEND to assert prompt blob never logged) | exact |

---

## Pattern Assignments

### `drizzle/0003_phase3_provenance.sql` (migration, NEW)

**Analog:** `drizzle/0001_phase2_version_lifecycle.sql`

**Why this analog:** Exact same migration style — raw SQL, IDM-03 rollback-not-supported comment header, additive-only columns + new table. Drizzle-generated with `statement-breakpoint` delimiters.

**Current pattern** (`drizzle/0001_phase2_version_lifecycle.sql` lines 1-12):
```sql
-- IDM-03: ROLLBACK NOT SUPPORTED.
--
-- Phase 2 migrations are purely additive: three nullable columns on an
-- existing table. Old Phase 1 code tolerates their presence because it
-- never reads from them (the Phase 1 repos selected named columns that
-- do not include error_code/error_message/outputs_json). There is no
-- scenario where a down migration would be needed — if a downgrade is
-- ever attempted, drop the DB and re-seed. Drizzle does not generate
-- down.sql files and we intentionally do not ship one.
ALTER TABLE `versions` ADD `error_code` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `error_message` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `outputs_json` text;
```

**Pattern for index migration** (`drizzle/0002_idx_versions_status.sql` lines 1-7):
```sql
-- IDM-03: ROLLBACK NOT SUPPORTED.
--
-- Additive index to support VersionRepo.listPendingVersions() (D-GEN-28
-- recovery-poller query). Old code tolerates the presence of an extra
-- index — index presence is a query-plan optimization, never a schema
-- constraint. No down migration shipped.
CREATE INDEX IF NOT EXISTS `idx_versions_status` ON `versions` (`status`);
```

**Changes when applying to `0003_phase3_provenance.sql`:**
- Start with the IDM-03 rollback-not-supported header (identical phrasing).
- Body in this order: (1) CREATE TABLE provenance, (2) ALTER TABLE versions ADD lineage_type, (3) CREATE INDEX idx_provenance_version_time (D-PROV-35).
- Structure table columns per D-PROV-02: `id TEXT PRIMARY KEY`, `version_id TEXT NOT NULL REFERENCES versions(id)`, `event_type TEXT NOT NULL`, `workflow_json TEXT`, `prompt_json TEXT`, `seed INTEGER`, `models_json TEXT`, `outputs_json TEXT`, `error_code TEXT`, `error_message TEXT`, `timestamp INTEGER NOT NULL`.
- Use `--> statement-breakpoint` between every top-level statement (Drizzle-kit format).
- No UPDATE/DELETE on provenance — this is enforced at the repo level, not via DB triggers (D-PROV-01 is a structural invariant in code, not SQLite).

---

### `src/types/provenance.ts` (type-only, NEW)

**Analog:** `src/types/hierarchy.ts`

**Why this analog:** Same file shape — pure types, zero imports, exports interfaces used by engine/store/tools uniformly. Anchor for D-PROV-02 shape and D-PROV-15 diff response.

**Existing pattern** (`src/types/hierarchy.ts` lines 1-66):
```typescript
// Pure type definitions for VFX Familiar hierarchy entities.
// ZERO imports — this file is the canonical type source consumed by engine, store, and tools.

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
  error_code: string | null;
  error_message: string | null;
  outputs_json: string | null;
}

export type VersionStatus = 'submitted' | 'running' | 'completed' | 'failed';
export type EntityType = 'workspace' | 'project' | 'sequence' | 'shot' | 'version';
```

**Apply to `src/types/provenance.ts`:**
- Header comment: "Pure type definitions for Phase 3 provenance. ZERO imports."
- Export `ProvenanceEventType` union: `'submitted' | 'completed' | 'failed'`.
- Export `LineageType` union: `'reproduce' | 'iterate'`.
- Export `ProvenanceEvent` interface (matches D-PROV-02 columns exactly).
- Export `ModelRef`: `{ node_id: string; class_type: string; model_name: string; model_hash: string | null }`.
- Export `DiffResponse`, `ParamChange`, `ModelChange`, `WorkflowStructureChange`, `MetadataChange`, `SeedChange` per D-PROV-15 shape.
- Export `IterateOverride`: `{ inputs?: Record<string, unknown>; class_type?: string }`.
- Also EXTEND `src/types/hierarchy.ts`: add `lineage_type: LineageType | null` to `Version` (D-PROV-33). Import `LineageType` from `./provenance.js` or inline the union there. Planner's call — inline keeps hierarchy.ts zero-import.

---

### `src/store/provenance-repo.ts` (store, append-only, NEW)

**Analog:** `src/store/version-repo.ts`

**Why this analog:** Same DB boundary — prepared statements via better-sqlite3 + Drizzle, plain typed returns, TypedError wrapping. The key deviation: ZERO `UPDATE`/`DELETE` methods (D-PROV-01 structural invariant). Architecture-purity test asserts no such methods exist.

**Imports + class shell pattern** (`src/store/version-repo.ts` lines 1-42):
```typescript
import { eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { versions } from './schema.js';
import type { Version } from '../types/hierarchy.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Detect SQLite unique-constraint violations — identical copy of the helper in
 * hierarchy-repo.ts. Duplicated intentionally (see 02-PATTERNS.md callout) so
 * repo files stay independent; no cross-repo import coupling.
 */
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

export class VersionRepo {
  constructor(private db: Db) {}
  // ... insertVersion, setJobId, markFailed, markCompleted, transition, getVersion, listPendingVersions
}
```

**Insert pattern** (`src/store/version-repo.ts` lines 69-94):
```typescript
private doInsert(shotId: string, notes?: string): Version {
  return this.db.transaction((tx) => {
    const row: Version = {
      id: newId('ver'),
      shot_id: shotId,
      // ... fields
      created_at: Date.now(),
    };
    tx.insert(versions).values(row).run();
    return row;
  });
}
```

**Changes when applying to `provenance-repo.ts`:**
- Header JSDoc: cite D-PROV-01 (append-only), D-PROV-03 (two-event model), D-PROV-04 (submitted-before-failed ordering).
- Copy `isUniqueViolation` verbatim (per 02-PATTERNS.md "duplicate intentionally" callout).
- Constructor: `constructor(private db: Db) {}`.
- **ONLY these public methods** (no update/delete by construction — enforced by tests):
  - `insertEvent(versionId: string, eventType: ProvenanceEventType, payload: ProvenanceEventPayload): ProvenanceEvent` — generates `prov_` prefixed nanoid, sets `timestamp: Date.now()`, inserts, returns row.
  - `getEventsForVersion(versionId: string): ProvenanceEvent[]` — ORDER BY timestamp ASC (D-PROV-35 index covers this).
  - `getLatestCompletedEvent(versionId: string): ProvenanceEvent | null` — WHERE version_id = ? AND event_type = 'completed' ORDER BY timestamp DESC LIMIT 1.
  - `getSubmitEvent(versionId: string): ProvenanceEvent | null` — WHERE version_id = ? AND event_type = 'submitted' LIMIT 1 (rationale: exactly one submit event per version).
- Optional: an `insertEventsBatch` if the orchestrator ever needs transactional multi-insert; defer until needed.
- `newId('prov')` — requires extending `IdPrefix` in `src/utils/id.ts`:
  ```typescript
  // src/utils/id.ts — EXTEND the union
  export type IdPrefix = 'ws' | 'proj' | 'seq' | 'shot' | 'ver' | 'prov';
  ```

---

### `src/engine/provenance.ts` (engine, pure + orchestrator, NEW)

**Analog:** `src/comfyui/format.ts` (pure part) + `src/engine/generation.ts` (orchestrator part)

**Why this analog:** The pure halves of this module (model extraction, seed extraction) mirror `format.ts` shape — pure predicates/transforms, zero IO, exported named functions. The orchestrator half (writeSubmitEvent/writeCompletedEvent/writeFailedEvent) mirrors `generation.ts` — takes repo references via constructor, calls them, no direct DB. Split may be cleaner as two files (pure `src/engine/provenance.ts` + orchestrator `src/engine/provenance-writer.ts`), but CONTEXT.md Integration Points says "orchestrates event writing" in `src/engine/provenance.ts` — keep them together.

**Pure-function pattern** (`src/comfyui/format.ts` lines 1-61):
```typescript
import { TypedError } from '../engine/errors.js';
import type { NodeError } from './types.js';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isApiFormat(payload: unknown): boolean {
  if (!isPlainObject(payload)) return false;
  const entries = Object.entries(payload);
  if (entries.length === 0) return false;
  for (const [k, v] of entries) {
    if (!/^\d+$/.test(k)) return false;
    if (!isPlainObject(v)) return false;
    const node = v;
    if (typeof node.class_type !== 'string') return false;
    if (!isPlainObject(node.inputs)) return false;
  }
  return true;
}

export function validateWorkflowFormat(payload: unknown): void {
  if (isUiFormat(payload)) {
    throw new TypedError('INVALID_WORKFLOW_FORMAT', '...', '...');
  }
  // ...
}
```

**Orchestrator pattern** (`src/engine/generation.ts` lines 61-77):
```typescript
export class GenerationEngine {
  constructor(
    private hierarchy: HierarchyRepo,
    private versions: VersionRepo,
    private client: ComfyUIClient | null,
    private breadcrumb: BreadcrumbResolver,
    private outputRoot: string = 'outputs',
    options: { maxConcurrentPollers?: number } = {},
  ) { /* ... */ }

  async submitGeneration(shotId: string, workflowJson: Record<string, unknown>, notes?: string): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    // ...
    const row = this.versions.insertVersion(shotId, notes);
    try {
      const { prompt_id } = await this.client.submit(workflowJson);
      this.versions.setJobId(row.id, prompt_id);
    } catch (err) {
      if (err instanceof TypedError) {
        this.versions.markFailed(row.id, err.code, err.message);
        throw err;
      }
      // ...
    }
    // ...
  }
}
```

**Changes when applying to `src/engine/provenance.ts`:**
- Export pure named functions at top-level (no class for these):
  - `extractModels(promptBlob: Record<string, unknown>): ModelRef[]` (RESEARCH.md §Model-list extraction algorithm lines 317-372).
  - `extractSeed(promptBlob: Record<string, unknown>): number | null` (RESEARCH.md lines 418-434).
  - Module-scoped const `LOADER_CLASS_TYPES: Set<string>` (8 entries per CONTEXT.md §Specifics loader class_types).
  - Module-scoped const `KSAMPLER_CLASS_TYPES: Set<string>` (4 entries: KSampler, KSamplerAdvanced, SamplerCustom, SamplerCustomAdvanced).
  - Module-scoped `MODEL_FIELD_BY_CLASS: Record<string, string[]>` lookup + `MODEL_FIELD_DEFAULTS` fallback.
- Export a `ProvenanceWriter` class (constructor-injected `ProvenanceRepo`):
  - `writeSubmitEvent(versionId: string, workflowJson: Record<string, unknown>): void` — serializes workflowJson, calls `repo.insertEvent(versionId, 'submitted', {workflow_json})`.
  - `writeCompletedEvent(versionId: string, promptBlob: Record<string, unknown>, outputsJson: string): void` — calls `extractSeed` + `extractModels`, serializes promptBlob, models_json, then calls `repo.insertEvent(versionId, 'completed', {prompt_json, seed, models_json, outputs_json})`.
  - `writeFailedEvent(versionId: string, errorCode: string, errorMessage: string): void` — calls `repo.insertEvent(versionId, 'failed', {error_code, error_message})`.
- **Architecture purity:** zero `@modelcontextprotocol/sdk`, zero `better-sqlite3` direct imports. Only imports `TypedError`, `ProvenanceRepo`, and types from `src/types/provenance.ts`. Asserted by extended `architecture-purity.test.ts`.

---

### `src/engine/diff-summary.ts` (engine, pure, NEW)

**Analog:** `src/engine/backoff.ts` (closest pure helper with zero deps)

**Why this analog:** Both are tiny pure-function modules with zero runtime deps, exporting one primary function. `backoff.ts` is actually `async function*` (generator), but the shape is the same — self-contained, JSDoc-referenced decision (D-GEN-24 / D-PROV-18), exported named function.

**Pattern** (`src/engine/backoff.ts` lines 1-19):
```typescript
/**
 * Exponential backoff + sleep helpers for the recovery poller (D-GEN-24, D-GEN-28).
 * Pure: zero DB / network / MCP dependencies.
 */

/**
 * Exponential backoff delay sequence per D-GEN-24: 2s, 4s, 8s, 16s, then cap at 30s.
 * Reset semantics: a new iterator per job = reset.
 */
export async function* createBackoffIterator(): AsyncGenerator<number> {
  const schedule = [2_000, 4_000, 8_000, 16_000];
  for (const delay of schedule) yield delay;
  while (true) yield 30_000;
}
```

**Changes when applying to `diff-summary.ts`:**
- JSDoc cites D-PROV-18 (deterministic template-based summary).
- Export `buildSummary(changes: DiffChanges): string` — the main entry point (RESEARCH.md lines 577-600).
- Module-scoped consts for limits: `MAX_CHANGES = 6`, `HARD_CAP = 400`, `ELISION_TEMPLATE = '…and {n} more changes'` (CONTEXT.md §Specifics).
- Internal helpers: `fmt(v: unknown): string`, `groupByNode<T>(items: T[]): Map<string, T[]>`.
- No external deps beyond `DiffChanges` and change types imported from `src/types/provenance.ts`.
- Deterministic: same input → same output string, bit-for-bit. Enables snapshot testing.
- Follow the RESEARCH.md algorithm verbatim: param changes first (grouped by node_id asc), then models, then seed, then workflow structure, then metadata. Stable.

---

### `src/engine/diff.ts` (engine, pure, NEW)

**Analog:** `src/comfyui/format.ts` (pure validator + TypedError throws)

**Why this analog:** Both are pure, zero-IO modules with exported named functions that throw `TypedError` on invalid input. `format.ts`'s `validateWorkflowFormat` is the shape precedent for `diffVersions` — pre-conditions checked, throw typed error or return result.

**Throw-on-invalid + pure pattern** (`src/comfyui/format.ts` lines 73-100):
```typescript
export function validateWorkflowFormat(payload: unknown): void {
  if (isUiFormat(payload)) {
    throw new TypedError(
      'INVALID_WORKFLOW_FORMAT',
      'Workflow is in ComfyUI UI format (contains nodes/links/groups)',
      "Export the workflow with 'Dev Mode > Save (API Format)' enabled in ComfyUI. " +
        'API format uses numeric string keys ("1", "2", ...) with class_type/inputs per node.',
    );
  }
  if (!isApiFormat(payload)) {
    throw new TypedError(
      'INVALID_WORKFLOW_FORMAT',
      'Workflow does not match the ComfyUI API format',
      "Expected an object keyed by numeric strings, each value with 'class_type' (string) and 'inputs' (object).",
    );
  }
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_WORKFLOW_BYTES) {
    throw new TypedError('INVALID_INPUT', `workflow_json exceeds ${MAX_WORKFLOW_BYTES} bytes serialized`, ...);
  }
}
```

**Changes when applying to `diff.ts`:**
- Export `diffVersions(input: DiffInput): DiffResponse` (RESEARCH.md lines 467-513) — the single entry point.
- Internal pure helpers (all zero-IO): `diffPromptParams`, `diffWorkflowStructure`, `diffModels`, `diffSeeds`, `diffMetadata`, `isLinkRef`, `deepEqualPrimitive`.
- Pre-check 1 (D-PROV-19): `assertComparable(a, b)` — throws `VERSION_NOT_COMPLETED` with hint naming the not-ready version.
- Pre-check 2 (D-PROV-20): same-shot constraint — throws `INVALID_INPUT` with hint showing both shot ids.
- Composition: `diffVersions` calls `buildSummary` (imported from `./diff-summary.js`).
- JSDoc cites D-PROV-15, D-PROV-16, D-PROV-17, D-PROV-19, D-PROV-20.
- **Architecture purity:** zero `@modelcontextprotocol/sdk`, zero `better-sqlite3`. Only `TypedError` + types.

---

### `src/engine/iterate-merge.ts` (engine, pure, NEW)

**Analog:** `src/comfyui/format.ts` (same pure-validator-with-TypedError shape)

**Why this analog:** Same rationale as `diff.ts` — pure transform + throws `TypedError` on precondition violation. The merge semantics (deep-clone + shallow-merge-inputs) are the transform; `ITERATE_INVALID_PATCH` is the throw shape.

**Pattern** (same as diff.ts, see `src/comfyui/format.ts` lines 73-100 above).

**Changes when applying to `iterate-merge.ts`:**
- Export `applySeedShortcut(blob: Record<string, unknown>, seed: number): Record<string, unknown>` (RESEARCH.md lines 733-757).
- Export `applyOverrides(blob: Record<string, unknown>, overrides: Record<string, IterateOverride>): Record<string, unknown>` (RESEARCH.md lines 759-789).
- Export `findKSamplerNodes(blob: Record<string, unknown>): string[]` — reuses `KSAMPLER_CLASS_TYPES` constant (import from `src/engine/provenance.ts` OR duplicate — planner's call; CONTEXT.md allows either).
- Use `structuredClone(blob)` for deep-clone (Node 17+, always available in Node 20+).
- Throw `ITERATE_INVALID_PATCH` with actionable hint for: unknown node id, multiple KSamplers, zero KSamplers, shape mismatch.
- Does NOT call `validateWorkflowFormat` — that gate is called by the caller (`GenerationEngine.iterateFromVersion`) on the merged blob (D-PROV-23).
- **Architecture purity:** zero `@modelcontextprotocol/sdk`, zero `better-sqlite3`. Only `TypedError` + types.

---

### `src/comfyui/png-metadata.ts` (utility, pure binary parser, NEW)

**Analog:** `src/comfyui/format.ts` (closest pure parser — but PNG has no true analog in the codebase)

**Why partial match:** `format.ts` is the closest because it's a pure parser/detector with zero IO, but it parses JSON object shape, not binary. PNG chunk parsing is structurally different. RESEARCH.md §D-PROV-05 Resolution (lines 208-223) has the reference implementation.

**Pattern shell** (mirror `format.ts` structure):
```typescript
import { TypedError } from '../engine/errors.js';

// Module-scoped constants (export for test introspection per RESEARCH.md).
export const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Extract a tEXt chunk value by key from a PNG buffer (D-PROV-05 primary path).
 *
 * Pure, zero IO beyond the input Buffer. Returns null if PNG magic mismatch, if
 * the key is absent, or if the chunk is malformed. Callers tolerate null by
 * falling through to PROVENANCE_UNAVAILABLE on later reproduce/iterate.
 *
 * Chunk structure per PNG spec: [4-byte BE length][4-byte type][data][4-byte CRC].
 * tEXt chunk data: null-separated ASCII key + Latin-1 value. ComfyUI writes
 * the prompt/workflow JSON into these chunks unconditionally for image outputs.
 */
export function extractTextChunk(pngBuffer: Buffer, key: string): string | null {
  // 1. Validate PNG magic (first 8 bytes)
  // 2. Walk chunks from byte 8: [length:u32be][type:4 ASCII][data:length][crc:u32]
  // 3. If type === 'tEXt': split data at first null byte, compare key
  // 4. Return the value as UTF-8 string (ComfyUI stores JSON so UTF-8 is correct)
  // 5. CRC validation: optional — skip for simplicity; ComfyUI writes correct CRCs
}
```

**Changes from `format.ts`:**
- No TypedError throws (returns null on invalid input — callers decide how to surface).
- Only uses Node's built-in `Buffer` (no imports beyond TypedError for error shape consistency; can drop TypedError if no throws).
- Test fixture: a small hand-crafted PNG with known tEXt chunks.

**Companion change in `src/comfyui/client.ts` (EXTEND — see next entry):**
- Add `async fetchResolvedPrompt(pngPath: string): Promise<Record<string, unknown> | null>` — reads file from disk via `fs.promises.readFile`, calls `extractTextChunk(buf, 'prompt')`, JSON.parse the result. Returns null on any failure. Signature per RESEARCH.md lines 260-262.

---

### `src/comfyui/client.ts` (client/HTTP, EXTEND)

**Analog:** self — EXTEND by adding a single method

**Why this analog:** The file already has the HTTP + auth + allowlist scaffolding. Adding `fetchResolvedPrompt` is strictly additive — it does NOT hit the network (it reads an already-downloaded PNG from disk per RESEARCH.md D-PROV-05 Resolution). Method body uses the filesystem, which is new territory for this client but the client already reads from the filesystem indirectly via `downloadToPath`.

**Existing method signature** (`src/comfyui/client.ts` lines 411-456):
```typescript
async downloadToPath(
  filename: string,
  opts: { subfolder?: string; type?: string },
  destPath: string,
  options: { maxBytes?: number } = {},
): Promise<{ path: string; url: string; contentType: string; sizeBytes: number }> { /* ... */ }
```

**Changes when applying — additive method on ComfyUIClient class:**
```typescript
// EXTEND src/comfyui/client.ts — add AFTER downloadToPath.
import { extractTextChunk } from './png-metadata.js';
import { readFile } from 'node:fs/promises';

/**
 * Phase 3 (D-PROV-05): fetch the resolved prompt blob for a completed job.
 *
 * Implementation: read PNG tEXt 'prompt' chunk from the already-downloaded
 * output file. Returns null if the file is not a PNG, or if the chunk is
 * missing or malformed. Callers (GenerationEngine completion handler) tolerate
 * null by emitting PROVENANCE_UNAVAILABLE on later reproduce/iterate.
 *
 * If a follow-up spike confirms /api/job/{id}/status or /api/history/{id}
 * returns the resolved blob, this method's body can be replaced with an
 * HTTP call; the signature stays the same.
 */
async fetchResolvedPrompt(pngPath: string): Promise<Record<string, unknown> | null> {
  try {
    const buf = await readFile(pngPath);
    const promptStr = extractTextChunk(buf, 'prompt');
    if (!promptStr) return null;
    const parsed = JSON.parse(promptStr);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
```

**Architecture purity:** no new external deps; uses existing `fs/promises`. Zero new MCP / DB imports. Existing purity tests still pass.

---

### `src/store/schema.ts` (store schema, EXTEND)

**Analog:** self — EXTEND by adding a new drizzle table and extending existing `versions`

**Why this analog:** The file already declares `versions` via drizzle; Phase 3 adds `lineage_type` column (matching the Phase 2 `error_code/error_message/outputs_json` additive pattern) and declares a new `provenance` table.

**Existing additive-column pattern** (`src/store/schema.ts` lines 66-93):
```typescript
export const versions = sqliteTable('versions', {
  id: text('id').primaryKey(),
  shot_id: text('shot_id').notNull().references(() => shots.id),
  version_number: integer('version_number').notNull(),
  status: text('status').notNull().default('submitted'),
  job_id: text('job_id'),
  parent_version_id: text('parent_version_id'),
  notes: text('notes'),
  created_at: integer('created_at').notNull(),
  completed_at: integer('completed_at'),
  // Phase 2 additions — D-GEN-19 (all nullable).
  error_code: text('error_code'),
  error_message: text('error_message'),
  outputs_json: text('outputs_json'),
}, (t) => ({
  uniqueVersionPerShot: unique().on(t.shot_id, t.version_number),
  idxStatus: index('idx_versions_status').on(t.status),
}));
```

**Existing new-table pattern** (`src/store/schema.ts` lines 55-64):
```typescript
export const shots = sqliteTable('shots', {
  id: text('id').primaryKey(),
  sequence_id: text('sequence_id').notNull().references(() => sequences.id),
  name: text('name').notNull(),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  uniqueNamePerSequence: unique().on(t.sequence_id, t.name),
}));
```

**Changes when applying to Phase 3:**
1. **EXTEND `versions` table declaration** — add `lineage_type: text('lineage_type')` (nullable, matches D-PROV-33). Place AFTER the Phase 2 columns with a comment `// Phase 3 additions — D-PROV-33 (nullable).`.
2. **DECLARE new `provenance` table** — follow the `shots` shape but with D-PROV-02 columns:
   ```typescript
   export const provenance = sqliteTable('provenance', {
     id: text('id').primaryKey(),
     version_id: text('version_id').notNull().references(() => versions.id),
     event_type: text('event_type').notNull(),
     workflow_json: text('workflow_json'),
     prompt_json: text('prompt_json'),
     seed: integer('seed'),
     models_json: text('models_json'),
     outputs_json: text('outputs_json'),
     error_code: text('error_code'),
     error_message: text('error_message'),
     timestamp: integer('timestamp').notNull(),
   }, (t) => ({
     idxVersionTime: index('idx_provenance_version_time').on(t.version_id, t.timestamp),
   }));
   ```
3. **SCHEMA_DDL split comment** — keep the IM-04 split intentional: `provenance` table + `lineage_type` column land via migration 0003. The `SCHEMA_DDL` string in `schema.ts` is the Phase 1 bootstrap DDL; do NOT add Phase 3 changes to it (migration 0003 runs on every DB, fresh or existing, per the existing split — see lines 95-116 comment).

---

### `src/store/version-repo.ts` (store, EXTEND)

**Analog:** self — EXTEND with one new `setLineage` method

**Why this analog:** The file already has `setJobId` — a one-shot `UPDATE` method that sets a single column. `setLineage` follows the exact same pattern.

**Existing one-shot UPDATE pattern** (`src/store/version-repo.ts` lines 96-99):
```typescript
/** Set job_id after the ComfyUI POST returns a prompt_id (D-GEN-21). */
setJobId(id: string, jobId: string): void {
  this.db.update(versions).set({ job_id: jobId }).where(eq(versions.id, id)).run();
}
```

**Changes when applying — add after `setJobId`:**
```typescript
/**
 * Set lineage metadata (D-PROV-29, D-PROV-33) for a version row inserted as a
 * reproduce/iterate of a source version. One-shot update — called immediately
 * after insertVersion during the reproduce/iterate flow, before the row is
 * exposed to any caller. No retry / no state-machine guard (lineage is set
 * exactly once on row birth; no later mutation).
 */
setLineage(
  id: string,
  parentVersionId: string,
  lineageType: 'reproduce' | 'iterate',
): void {
  this.db
    .update(versions)
    .set({ parent_version_id: parentVersionId, lineage_type: lineageType })
    .where(eq(versions.id, id))
    .run();
}
```

**Also EXTEND `Version` type in `src/types/hierarchy.ts`** — add `lineage_type: 'reproduce' | 'iterate' | null` (D-PROV-33). Update `insertVersion` to initialize `lineage_type: null`.

---

### `src/engine/generation.ts` (engine, EXTEND)

**Analog:** self — EXTEND with `reproduceVersion` and `iterateFromVersion` methods; refactor `submitGeneration` internals to share `submitInternal`

**Why this analog:** Both new methods are variants of the existing submit flow — insert version row → call ComfyUI → set job_id → (new: set lineage). RESEARCH.md §Reproduce/iterate flow calls for a `submitInternal({shot_id, workflow, notes, parent_version_id, lineage_type})` helper that both the existing `submitGeneration` and the new reproduce/iterate methods delegate to.

**Existing submit pattern** (`src/engine/generation.ts` lines 83-123):
```typescript
async submitGeneration(
  shotId: string,
  workflowJson: Record<string, unknown>,
  notes?: string,
): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
  if (!this.client) { throw new TypedError('COMFYUI_CREDENTIALS_MISSING', ...); }
  const shot = this.hierarchy.getShot(shotId);
  if (!shot) throw new TypedError('SHOT_NOT_FOUND', ...);
  validateWorkflowFormat(workflowJson);

  const row = this.versions.insertVersion(shotId, notes);
  try {
    const { prompt_id } = await this.client.submit(workflowJson);
    this.versions.setJobId(row.id, prompt_id);
  } catch (err) {
    if (err instanceof TypedError) {
      this.versions.markFailed(row.id, err.code, err.message);
      throw err;
    }
    this.versions.markFailed(row.id, 'COMFYUI_API_ERROR', String(err));
    throw new TypedError('COMFYUI_API_ERROR', String(err));
  }
  const refreshed = this.versions.getVersion(row.id)!;
  return { entity: refreshed, breadcrumb: this.breadcrumb.resolve('version', row.id) };
}
```

**Changes when applying — refactor + add two methods:**

1. **Refactor: extract `submitInternal`** (private method):
   ```typescript
   private async submitInternal(args: {
     shotId: string;
     workflowJson: Record<string, unknown>;
     notes?: string;
     parentVersionId?: string;
     lineageType?: 'reproduce' | 'iterate';
   }): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
     // Existing body of submitGeneration, with added: after insertVersion, if
     // parentVersionId + lineageType set, call this.versions.setLineage(row.id, ...)
   }
   ```
   Rationale: RESEARCH.md §Shared submitInternal (lines 724-730) — keeps lineage as an insert-time concern, preserves append-only spirit.

2. **Also add**: `private provenanceWriter: ProvenanceWriter` member + constructor param; wire from Engine facade.

3. **Add `reproduceVersion`** (public method — RESEARCH.md lines 619-663):
   ```typescript
   async reproduceVersion(
     sourceVersionId: string,
     notes?: string,
   ): Promise<{ entity: Version; breadcrumb: Breadcrumb; reproduction_warnings: string[] }> {
     // 1. Load source — throw VERSION_NOT_FOUND if missing.
     // 2. Find completed provenance event — throw REPRODUCE_BLOCKED if missing.
     //    (hint: "Source status: '${source.status}'")
     // 3. Build warnings array (D-PROV-28) from models_json + prompt_json checks.
     // 4. Re-submit via submitInternal with parent_version_id + lineage_type='reproduce'.
     // 5. Return { entity, breadcrumb, reproduction_warnings }.
   }
   ```

4. **Add `iterateFromVersion`** (public method — RESEARCH.md lines 670-722):
   ```typescript
   async iterateFromVersion(
     sourceVersionId: string,
     overrides?: Record<string, IterateOverride>,
     seed?: number,
     notes?: string,
   ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
     // 1. Load source — throw VERSION_NOT_FOUND if missing.
     // 2. If source.status is 'completed' → use prompt_json.
     //    If 'failed' → use workflow_json (D-PROV-24).
     //    Else → throw VERSION_NOT_COMPLETED.
     // 3. applySeedShortcut if seed provided.
     // 4. applyOverrides if overrides provided.
     // 5. validateWorkflowFormat(mergedBlob) (D-PROV-23).
     // 6. Submit via submitInternal with parent_version_id + lineage_type='iterate'.
   }
   ```

5. **Provenance event writing**: in the existing `submitInternal`, after insertVersion, call `this.provenanceWriter.writeSubmitEvent(row.id, workflowJson)`. In `downloadAndPersist` success path, before `markCompleted`, call `client.fetchResolvedPrompt(finalPath)` → if non-null, call `writeCompletedEvent(row.id, promptBlob, outputsJson)`. In `markFailed` paths, call `writeFailedEvent(row.id, code, msg)`. Honesty: if fetchResolvedPrompt returns null, the completed event still fires with `prompt_json: null` — the `PROVENANCE_UNAVAILABLE` surfaces later on reproduce/iterate.

---

### `src/engine/pipeline.ts` (engine facade, EXTEND)

**Analog:** self — add new delegations to `GenerationEngine`, new diff/get/list methods

**Why this analog:** The Engine facade already delegates submit/status to `GenerationEngine`. Phase 3 adds a parallel set of delegation methods.

**Existing delegation pattern** (`src/engine/pipeline.ts` lines 215-231):
```typescript
async submitGeneration(
  shotId: string,
  workflowJson: Record<string, unknown>,
  notes?: string,
): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
  return this.generation.submitGeneration(shotId, workflowJson, notes);
}

async getGenerationStatus(
  versionId: string,
): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
  return this.generation.getGenerationStatus(versionId);
}
```

**Changes when applying — add constructor deps + 6 new delegations:**

1. **Extend constructor**: accept `ProvenanceRepo` (add as positional or in options), construct `ProvenanceWriter`, pass to GenerationEngine.
2. **Add `getVersion(id: string): { entity: Version; breadcrumb: Breadcrumb }`** — calls `versionRepo.getVersion`, throws `VERSION_NOT_FOUND` if null (mirrors existing `getWorkspace` not-found pattern, lines 70-80).
3. **Add `listVersionsForShot(shotId: string, limit: number, offset: number): ListResult<Version>`** — delegates to a new `VersionRepo.listByShot(shotId, limit, offset)` method (EXTEND version-repo.ts). Ordering: `version_number DESC` (CONTEXT.md §Specifics). Each item gets its own `breadcrumb` via `this.breadcrumb.resolve('version', v.id)` (same spread pattern as `listShots` lines 204-208).
4. **Add `getProvenance(versionId: string): { events: ProvenanceEvent[]; breadcrumb: Breadcrumb }`** — calls `provenanceRepo.getEventsForVersion(versionId)` + `breadcrumb.resolve('version', versionId)`. Returns empty `events: []` if the version predates Phase 3 (D-PROV-34 honesty).
5. **Add `diffVersions(aId: string, bId: string): DiffResponse & { breadcrumb: Breadcrumb; breadcrumb_text: string }`** — loads both versions + their provenance events, calls `diff.ts::diffVersions(input)`, attaches breadcrumb for the shared shot. Same-shot enforcement lives inside `diff.ts` (D-PROV-20).
6. **Add `reproduceVersion(sourceId: string, notes?: string): Promise<{ entity; breadcrumb; reproduction_warnings }>`** — delegates to `generation.reproduceVersion`.
7. **Add `iterateFromVersion(sourceId: string, overrides?, seed?, notes?): Promise<{ entity; breadcrumb }>`** — delegates to `generation.iterateFromVersion`.

---

### `src/tools/version-tool.ts` (tool, NEW)

**Analog:** `src/tools/generation-tool.ts`

**Why this analog:** Both tools are action-discriminated unions with thin delegation to Engine. `generation-tool.ts` is the closest structural match because it (1) handles multiple-arm discriminated unions (submit, status — Phase 3 version tool has four: get, list, diff, provenance), (2) uses the raw-ZodRawShape + handler re-validation pattern (RT-01/RT-02), (3) returns `{entity, breadcrumb}` through `shapeCreateOrGet`-style shaping, (4) uses `toolOk`/`toolError` + `z.ZodError` re-wrap.

**Imports + Zod discriminated union pattern** (`src/tools/generation-tool.ts` lines 1-44):
```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError } from './envelope.js';
import { versionLabel } from '../utils/outputs.js';
import type { Version, Breadcrumb } from '../types/hierarchy.js';
import type { StoredOutput } from '../comfyui/types.js';
import { MAX_ID_LENGTH, MAX_NOTES_LENGTH, MAX_WORKFLOW_NODES } from './shape.js';

const SubmitInput = z.object({
  action: z.literal('submit'),
  shot_id: z.string().min(1).max(MAX_ID_LENGTH),
  workflow_json: z.record(z.string(), z.unknown()).refine(...),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
});

const StatusInput = z.object({
  action: z.literal('status'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
});

const GenerationInputSchema = z.discriminatedUnion('action', [SubmitInput, StatusInput]);
```

**Register + handler + error wrap pattern** (`src/tools/generation-tool.ts` lines 121-181):
```typescript
export function registerGeneration(server: McpServer, engine: Engine) {
  server.registerTool(
    'generation',
    {
      title: 'Generation',
      description: '...',
      inputSchema: {
        action: z.enum(['submit', 'status']),
        shot_id: z.string().optional(),
        // ... all fields .optional() at ZodRawShape layer (RT-01)
      },
    },
    async (rawInput) => {
      try {
        const input = GenerationInputSchema.parse(rawInput);
        switch (input.action) {
          case 'submit':
            return toolOk(shapeVersionEntity(await engine.submitGeneration(...)));
          case 'status':
            return toolOk(shapeVersionEntity(await engine.getGenerationStatus(...)));
          default: {
            const _exhaustive: never = input;
            throw new TypedError('INVALID_INPUT', `Unhandled generation action: ${String(_exhaustive)}`);
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
    },
  );
}
```

**Changes when applying to `version-tool.ts`:**
- Four arms on discriminated union:
  - `GetInput`: `{ action: z.literal('get'), version_id: z.string().min(1).max(MAX_ID_LENGTH) }`.
  - `ListInput`: `{ action: z.literal('list'), shot_id: z.string().min(1).max(MAX_ID_LENGTH), limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE), offset: z.number().int().min(0).default(0) }`.
  - `DiffInput`: `{ action: z.literal('diff'), version_a: z.string().min(1).max(MAX_ID_LENGTH), version_b: z.string().min(1).max(MAX_ID_LENGTH) }`.
  - `ProvenanceInput`: `{ action: z.literal('provenance'), version_id: z.string().min(1).max(MAX_ID_LENGTH) }`.
- Raw `ZodRawShape` published to MCP (RT-01) with ALL fields optional:
  ```typescript
  inputSchema: {
    action: z.enum(['get', 'list', 'diff', 'provenance']),
    version_id: z.string().optional(),
    version_a: z.string().optional(),
    version_b: z.string().optional(),
    shot_id: z.string().optional(),
    limit: z.number().int().optional(),
    offset: z.number().int().optional(),
  },
  ```
- Handler switch:
  - `get`: `toolOk(shapeVersionEntity(engine.getVersion(input.version_id)))` (or a simpler shaper — get returns cheap metadata, no outputs parsing needed per D-PROV-08).
  - `list`: `toolOk(shapeVersionList(engine.listVersionsForShot(input.shot_id, input.limit, input.offset)))` — use `shapeList` from `src/tools/shape.ts` verbatim (same pattern as workspace-tool).
  - `diff`: `toolOk(shapeDiff(await engine.diffVersions(input.version_a, input.version_b)))` — result already includes `{summary, changes, breadcrumb, breadcrumb_text}` per D-PROV-15.
  - `provenance`: `toolOk(shapeProvenance(engine.getProvenance(input.version_id)))` — result: `{events, breadcrumb, breadcrumb_text}`.
- Tool description: "Query and compare versions. Actions: get (cheap metadata), list (paginated by shot), diff (same-shot field-level diff), provenance (full event history — heavy payload)."
- Breadcrumb invariant: every response includes `breadcrumb[]` + `breadcrumb_text` per D-22.
- Error wrap: identical ZodError re-wrap as `INVALID_INPUT`, pass-through TypedError.

**New shapers — add to `src/tools/shape.ts` OR inline:**
- `shapeVersionEntity(result)` — already exists for generation-tool; version-tool's `get` can reuse OR use a lighter variant that skips the outputs_json parse (CONTEXT.md D-PROV-08 "cheap metadata" guidance).
- `shapeDiff(result: DiffResponse & {breadcrumb; breadcrumb_text})` — passes through (already in the right shape).
- `shapeProvenance(result: {events; breadcrumb})` — similar to shapeCreateOrGet but with `events` instead of `entity`:
  ```typescript
  function shapeProvenance(result: { events: ProvenanceEvent[]; breadcrumb: Breadcrumb }) {
    return {
      events: result.events,
      breadcrumb: result.breadcrumb.entries,
      breadcrumb_text: result.breadcrumb.text,
    };
  }
  ```

---

### `src/tools/generation-tool.ts` (tool, EXTEND)

**Analog:** self — EXTEND existing 2-arm union to 4-arm union

**Why this analog:** The file already has the exact shape Phase 3 needs — discriminated union, raw ZodRawShape, handler re-validation. Phase 3 adds two new arms (`reproduce`, `iterate`) and two new switch cases.

**Existing 2-arm union** (lines 21-44, shown above).

**Changes when applying:**

1. **Extend `GenerationInputSchema`** to 4 arms:
   ```typescript
   const ReproduceInput = z.object({
     action: z.literal('reproduce'),
     version_id: z.string().min(1).max(MAX_ID_LENGTH),
     notes: z.string().max(MAX_NOTES_LENGTH).optional(),
   });

   const IterateInput = z.object({
     action: z.literal('iterate'),
     version_id: z.string().min(1).max(MAX_ID_LENGTH),
     overrides: z.record(
       z.string(),
       z.object({
         inputs: z.record(z.string(), z.unknown()).optional(),
         class_type: z.string().optional(),
       }),
     ).optional(),
     seed: z.number().int().optional(),
     notes: z.string().max(MAX_NOTES_LENGTH).optional(),
   });

   const GenerationInputSchema = z.discriminatedUnion('action', [
     SubmitInput, StatusInput, ReproduceInput, IterateInput,
   ]);
   ```

2. **Extend raw `inputSchema` ZodRawShape** — add optional `overrides`, `seed` fields; extend `action` enum to 4 values.

3. **Extend handler switch** with two new cases:
   ```typescript
   case 'reproduce': {
     const result = await engine.reproduceVersion(input.version_id, input.notes);
     // Response includes reproduction_warnings[] per D-PROV-12.
     return toolOk({
       ...shapeVersionEntity({ entity: result.entity, breadcrumb: result.breadcrumb }),
       reproduction_warnings: result.reproduction_warnings,
     });
   }
   case 'iterate': {
     return toolOk(
       shapeVersionEntity(
         await engine.iterateFromVersion(input.version_id, input.overrides, input.seed, input.notes),
       ),
     );
   }
   ```

4. **Tool description update**: append actions `reproduce | iterate` to the description line. Keep the existing state-machine + dual-error commentary.

---

### `src/tools/index.ts` (config/barrel, EXTEND)

**Analog:** self — add one export

**Existing content** (lines 1-8):
```typescript
// Barrel for Phase 1 + Phase 2 MCP tool registrations. Phase 2 budgets 5 of 12
// tools (D-GEN-03, TOOL-01). Remaining 7 tools reserved for Phases 3-5.

export { registerWorkspace } from './workspace-tool.js';
export { registerProject } from './project-tool.js';
export { registerSequence } from './sequence-tool.js';
export { registerShot } from './shot-tool.js';
export { registerGeneration } from './generation-tool.js';
```

**Changes:** Update comment header to "Phase 3 budgets 6 of 12 tools (D-PROV-07). Remaining 6 tools reserved for Phases 4-5." Add one export line:
```typescript
export { registerVersion } from './version-tool.js';
```

---

### `src/server.ts` (config/entry, EXTEND)

**Analog:** self — add `registerVersion` call + constructor param for `ProvenanceRepo`

**Existing pattern** (`src/server.ts` lines 93-113):
```typescript
function buildServer(engine: Engine, version: string): McpServer {
  const server = new McpServer({ name: 'vfx-familiar', version }, { instructions: '...' });
  registerWorkspace(server, engine);
  registerProject(server, engine);
  registerSequence(server, engine);
  registerShot(server, engine);
  registerGeneration(server, engine);
  server.server.registerCapabilities({ tools: { listChanged: false } });
  return server;
}
```

**Changes when applying:**

1. **Add import**: `import { ProvenanceRepo } from './store/provenance-repo.js';` (alongside existing repo imports).
2. **Update Engine construction** (around line 173) to pass `ProvenanceRepo`:
   ```typescript
   const provenanceRepo = new ProvenanceRepo(db);
   const engine = new Engine(repo, versionRepo, provenanceRepo, client, 'outputs', {
     maxConcurrentPollers: /* ... */,
   });
   ```
3. **In `buildServer`**, add `registerVersion(server, engine);` alongside the other five register calls.
4. **Update instructions string** in `McpServer` constructor to mention version tool actions.

---

### `src/types/hierarchy.ts` (type-only, EXTEND)

**Analog:** self — add `lineage_type` field on `Version`

**Existing `Version`** (lines 52-66):
```typescript
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
  error_code: string | null;
  error_message: string | null;
  outputs_json: string | null;
}
```

**Changes:** Add one field at the end of `Version`:
```typescript
// Phase 3 additions — D-PROV-33 (nullable).
lineage_type: 'reproduce' | 'iterate' | null;
```

No new type imports — the literal union is inlined to keep `hierarchy.ts` zero-import.

---

### `src/test-utils/fixtures.ts` (test-util, EXTEND)

**Analog:** self — the existing `makeInMemoryDb` is the backbone; Phase 3 adds fixtures on top

**Existing pattern** (lines 1-30):
```typescript
export function makeInMemoryDb(): TestDb {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(SCHEMA_DDL);
  sqlite.pragma('user_version = 1');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  return { db, sqlite };
}
```

**Changes when applying — add named exports:**
- `SAMPLE_RESOLVED_PROMPT: Record<string, unknown>` — a 4-node completed ComfyUI prompt with CheckpointLoaderSimple, KSampler (seed: 42), CLIPTextEncode, SaveImage. Used by model-extraction, seed-extraction, diff, iterate-merge tests.
- `SAMPLE_WORKFLOW_JSON: Record<string, unknown>` — a same-shape input workflow (submitted row fixture).
- `SAMPLE_ITERATE_OVERRIDES: Record<string, IterateOverride>` — sample override map changing KSampler's `seed` and `cfg`.
- `DIFF_PAIR_SEED_CHANGE: { a: VersionForDiff; b: VersionForDiff }` — two versions where only the seed differs.
- `DIFF_PAIR_NODE_ADDED: { a: VersionForDiff; b: VersionForDiff }` — two versions where `b` has an additional LoraLoader node.
- `DIFF_PAIR_MODEL_CHANGED: { a: VersionForDiff; b: VersionForDiff }` — CheckpointLoader switched from model A to model B.
- `sampleCompletedEvent(versionId: string, overrides?: Partial<ProvenanceEvent>): ProvenanceEvent` — factory helper.

Migration-file count assertion bump is an orthogonal concern (see `migrate.test.ts` — Phase 3 bumps `EXPECTED_MIGRATIONS` from 2 to 3).

---

### Test files

#### `src/store/__tests__/provenance-repo.test.ts` (NEW)

**Analog:** `src/store/__tests__/version-repo.test.ts`

**Why this analog:** Same boundary — tests a repo against `makeInMemoryDb`, uses `HierarchyRepo` fixture to seed parent rows, verifies SQL-level behavior. Phase 3 variant adds provenance events after version rows are inserted.

**Test scaffold** (`src/store/__tests__/version-repo.test.ts` lines 17-34):
```typescript
describe('VersionRepo — allocation, state transitions, immutability', () => {
  let repo: VersionRepo;
  let hierarchy: HierarchyRepo;
  let shotId: string;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    repo = new VersionRepo(db);
    hierarchy = new HierarchyRepo(db);
    const ws = hierarchy.createWorkspace('ws1');
    const proj = hierarchy.createProject(ws.id, 'p1');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const shot = hierarchy.createShot(seq.id, 'sh010');
    shotId = shot.id;
  });

  test('first insert has version_number = 1 and status submitted', () => {
    const v = repo.insertVersion(shotId);
    // ...
  });
});
```

**Changes when applying to `provenance-repo.test.ts`:**
- Scaffold: add `VersionRepo` to beforeEach, create a single version row per test (`repo.insertVersion(shotId)`), then test ProvenanceRepo methods against that version.
- Tests:
  - `insertEvent` generates a `prov_`-prefixed id + sets timestamp.
  - Two events for same version are ordered chronologically on `getEventsForVersion`.
  - `getLatestCompletedEvent` returns the latest `completed` event (not a `submitted` or earlier `completed`).
  - `getSubmitEvent` returns the single `submitted` event.
  - Empty `events: []` for a version with no events (historical Phase 2 row — D-PROV-34).
  - **Architecture-purity adjacency**: negative assertion — `ProvenanceRepo` has no UPDATE / DELETE methods (test by reflection: `Object.getOwnPropertyNames(ProvenanceRepo.prototype)` contains none of `'update*' | 'delete*'`).

#### `src/store/__tests__/schema.test.ts` (EXTEND via migrate.test.ts)

**Analog:** `src/store/__tests__/migrate.test.ts`

**Why this analog:** Phase 3 adds a migration (0003) and a new table (`provenance`) + a new column (`lineage_type`). Same scaffold as Phase 2's migrate.test.ts.

**Pattern** (`src/store/__tests__/migrate.test.ts` lines 14, 42-54, 67-85):
```typescript
const EXPECTED_MIGRATIONS = 2;

test('versions table has error_code, error_message, outputs_json after openDb', () => {
  const { sqlite } = openDb(dbPath);
  const rows = sqlite
    .prepare(`SELECT name, type, "notnull" FROM pragma_table_info('versions')`)
    .all() as { name: string; type: string; notnull: number }[];
  const cols = new Map(rows.map((r) => [r.name, r]));
  for (const c of ['error_code', 'error_message', 'outputs_json']) {
    expect(cols.get(c)).toBeDefined();
    // ...
  }
});

test(`__drizzle_migrations has exactly ${EXPECTED_MIGRATIONS} rows after first openDb`, () => { /* ... */ });
```

**Changes when applying:**
- Bump `EXPECTED_MIGRATIONS` from 2 to 3.
- Add test: `provenance` table exists after openDb (`SELECT name FROM sqlite_master WHERE type='table' AND name='provenance'`).
- Add test: `provenance` columns match D-PROV-02 (id, version_id, event_type, workflow_json, prompt_json, seed, models_json, outputs_json, error_code, error_message, timestamp).
- Add test: `versions.lineage_type` column exists (nullable TEXT).
- Add test: `idx_provenance_version_time` index exists on `provenance(version_id, timestamp)`.
- Idempotency test: second openDb still has EXPECTED_MIGRATIONS=3 rows in `__drizzle_migrations`.

#### `src/engine/__tests__/model-extraction.test.ts` + `seed-extraction.test.ts` + `diff.test.ts` + `iterate-merge.test.ts` (NEW pure-module tests)

**Analog:** `src/comfyui/__tests__/format.test.ts`

**Why this analog:** All four are pure-function tests with fixture tables and simple assertions. `format.test.ts` uses `test.each` over fixture arrays — ideal for model-extraction (multiple loader class types) and seed-extraction (0/1/many KSampler cases).

**Pattern** (`src/comfyui/__tests__/format.test.ts` lines 16-58):
```typescript
const UI_FORMAT_CASES = [
  { nodes: [] },
  { links: [] },
  // ...
];

const API_FORMAT_CASES = [
  { '1': { class_type: 'KSampler', inputs: {} } },
  // ...
];

describe('workflow format detection (D-GEN-23)', () => {
  test.each(UI_FORMAT_CASES)('UI-format rejected: %j', (p) => {
    expect(isUiFormat(p)).toBe(true);
    expect(() => validateWorkflowFormat(p)).toThrowTypedError('INVALID_WORKFLOW_FORMAT');
  });

  test.each(API_FORMAT_CASES)('API-format accepted: %j', (p) => {
    expect(isApiFormat(p)).toBe(true);
    expect(() => validateWorkflowFormat(p)).not.toThrow();
  });
});
```

**Changes when applying:**

**`model-extraction.test.ts`:**
- Fixture array of prompt blobs (from `test-utils/fixtures.ts` where possible): SDXL 1-ckpt, multi-lora, no-loader, missing-inputs-node, unknown-class-type, empty-string-ckpt-name.
- Each case asserts `extractModels(blob)` returns the expected `ModelRef[]` (entries, order, fields).
- Covers all 8 loader class types from CONTEXT.md §Specifics.

**`seed-extraction.test.ts`:**
- Fixture array: 0-KSampler, 1-KSampler (expect seed), multi-KSampler (expect first by node_id sort), KSampler-with-string-seed (expect null), KSampler-with-missing-seed (expect null), KSampler-with-seed=-1 (log warning + return null per RESEARCH.md edge cases).

**`diff.test.ts`:**
- Fixture pairs from `test-utils/fixtures.ts`: seed-change, node-added, model-changed, workflow-restructured.
- Each test: `diffVersions(input)` returns the expected `changes.*` array + summary string.
- Error-case tests: same-shot constraint (different shot_ids → INVALID_INPUT with shot hint), not-completed source (no terminal event → VERSION_NOT_COMPLETED with version id hint).
- Deterministic summary test: snapshot-matching `buildSummary` on a known fixture.

**`iterate-merge.test.ts`:**
- Positive tests: `applyOverrides` updates matching node inputs, leaves other nodes untouched, structuredClone isolation (original blob not mutated).
- Negative tests (all throw `ITERATE_INVALID_PATCH`): unknown node id, non-object inputs, non-string class_type. Error messages include the valid node id list (hint compliance per D-PROV-23).
- `applySeedShortcut` tests: 0 KSampler → error with hint, 1 KSampler → seed updated, >1 KSampler → error with explicit override hint.

**Shared matcher**: `expect(...).toThrowTypedError('CODE')` — already exists in `src/test-utils/matchers.ts` (referenced throughout Phase 2 tests). Reuse verbatim.

#### `src/tools/__tests__/version-tool.test.ts` + `generation-reproduce-iterate.test.ts` (NEW integration tests)

**Analog:** `src/tools/__tests__/generation-tool.test.ts`

**Why this analog:** Direct-mirror test scaffold — build an in-memory stack (`makeInMemoryDb` + repos + engine + FakeComfyUIClient), invoke tool handlers via the exact pipeline they use, assert envelope shape + breadcrumb + error codes.

**Pattern** (`src/tools/__tests__/generation-tool.test.ts` lines 28-42, 72-100, 141-186):
```typescript
async function buildStack() {
  const { db } = makeInMemoryDb();
  const repo = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const fake = new FakeComfyUIClient();
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-gen-tool-${nanoid(6)}-`));
  const engine = new Engine(repo, versions, fake as unknown as any, tempRoot);
  const ws = repo.createWorkspace('ws1');
  const proj = repo.createProject(ws.id, 'p1');
  const seq = repo.createSequence(proj.id, 'sq010');
  const shot = repo.createShot(seq.id, 'sh010');
  return { engine, fake, versions, shotId: shot.id, tempRoot };
}

async function invokeSubmit(stack, input) {
  try {
    const parsed = z.object({ /* schema */ }).parse(input);
    return toolOk(shapeVersion(await stack.engine.submitGeneration(...)));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return toolError(new TypedError('INVALID_INPUT', `Invalid input at 'input.${path}' -- ${first.message}`));
    }
    return toolError(err);
  }
}

describe('generation tool — submit happy path', () => {
  it('structuredContent has entity + breadcrumb + breadcrumb_text with 5-entry breadcrumb', async () => {
    const res = await invokeSubmit(stack, { action: 'submit', shot_id: stack.shotId, workflow_json: API_WF });
    expect(res.isError).toBeUndefined();
    // assert breadcrumb.length === 5, entity.version_label === 'v001', etc.
  });
});
```

**Changes when applying to `version-tool.test.ts`:**
- Extend `buildStack` to also add `ProvenanceRepo` + seed provenance events on an existing version row. Seed: one `submitted` event + one `completed` event with a known prompt blob and outputs.
- Four invoke helpers (`invokeGet`, `invokeList`, `invokeDiff`, `invokeProvenance`) mirroring `invokeSubmit`/`invokeStatus`.
- Test each action:
  - **get**: returns `entity` with no `outputs_json` field (cheap metadata per D-PROV-08), 5-entry breadcrumb.
  - **list**: returns `items[]` + `total_count` + `limit` + `offset`, ordered `version_number DESC`.
  - **diff**: returns `summary`, `changes: {params, models, seed, workflow, metadata}`, breadcrumb. Error paths: same-shot violation → INVALID_INPUT, not-completed → VERSION_NOT_COMPLETED.
  - **provenance**: returns `events[]` in chronological order with full workflow_json + prompt_json + models_json.
- Error-path tests: unknown version_id → VERSION_NOT_FOUND, empty id → INVALID_INPUT.
- **Register smoke** (mirroring generation-tool.test.ts lines 381-404): `registerVersion` works on `McpServer`, tool name `version` present in `_registeredTools`, description contains expected substrings.

**Changes when applying to `generation-reproduce-iterate.test.ts`:**
- Build a source completed version with a known prompt blob (seed via `provenanceRepo.insertEvent`).
- **Reproduce tests**:
  - Happy path: new version inserted with `parent_version_id = source`, `lineage_type = 'reproduce'`, same prompt blob resubmitted; response includes `reproduction_warnings` array (non-empty because models have null hashes per D-PROV-28).
  - No-completed-event source → REPRODUCE_BLOCKED with hint naming source status.
  - Prompt blob null → PROVENANCE_UNAVAILABLE.
- **Iterate tests**:
  - Happy override: `overrides: { '3': { inputs: { seed: 999 } } }` → new version with merged blob (original has seed 42, new has seed 999), lineage_type 'iterate'.
  - Seed convenience (1 KSampler): `seed: 999` → KSampler's seed updated.
  - Unknown node override → ITERATE_INVALID_PATCH with valid node ids listed.
  - Source in `submitted|running` → VERSION_NOT_COMPLETED.
  - Source in `failed` → iterate uses workflow_json (D-PROV-24).
  - Invalid shape from override → INVALID_INPUT from `validateWorkflowFormat` post-merge.

#### `src/comfyui/__tests__/png-metadata.test.ts` (NEW)

**Analog:** `src/comfyui/__tests__/format.test.ts` (role-match — pure parser tests)

**Why this analog:** Pure parser with a fixture table of inputs. Phase 3's PNG parser is binary rather than JSON, so fixtures are Buffer values instead of JSON objects, but the test shape (one case per describe, assert output equality) is identical.

**Pattern** (same as format.test.ts).

**Changes when applying:**
- Fixtures: small hand-crafted PNGs (base64-decoded in test setup) with known tEXt chunks.
- Positive cases:
  - PNG with `prompt` tEXt chunk → returns JSON string.
  - PNG with `workflow` tEXt chunk → returns JSON string.
  - PNG with multiple tEXt chunks → returns the requested key's value.
- Negative cases (return null):
  - Non-PNG buffer (wrong magic bytes).
  - PNG without the requested tEXt chunk.
  - PNG with malformed chunk length.
  - Empty buffer.
  - Buffer smaller than PNG magic.

#### `src/comfyui/__tests__/live-smoke-provenance.test.ts` (NEW)

**Analog:** `src/comfyui/__tests__/live-smoke.test.ts`

**Why this analog:** Same gating strategy (`COMFYUI_API_KEY` + `RUN_LIVE_SMOKE=1` double opt-in per IT-19), same teardown (temp DB + temp outputs root), same minimal-workflow fixture approach.

**Pattern** (`src/comfyui/__tests__/live-smoke.test.ts` lines 53-55):
```typescript
const SKIP = !process.env.COMFYUI_API_KEY || process.env.RUN_LIVE_SMOKE !== '1';
const describe_ = SKIP ? describe.skip : describe;

const MINIMAL_WORKFLOW = (checkpoint: string): Record<string, unknown> => ({
  '3': { class_type: 'KSampler', inputs: { seed: 42, /* ... */ } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
  // ...
});
```

**Changes when applying:**
- Reuse MINIMAL_WORKFLOW from the existing live-smoke test if possible.
- After submit + wait-for-complete:
  - Assert `provenance` table has exactly 2 rows for the version (`submitted` + `completed`).
  - Assert the `completed` row has non-null `prompt_json` (validates D-PROV-05 primary path — PNG tEXt extraction).
  - Assert the `completed` row has non-empty `models_json` (CheckpointLoader was extracted).
  - Assert `seed` column is 42 (matches KSampler input).
- **Reproduce round-trip** (D-PROV-38 #9): call `generation.reproduce`, wait for second completion, assert the two versions' `prompt_json` are identical (PROV-05 honesty test).
- **Probe** (per RESEARCH.md D-PROV-05 Resolution lines 226-236): log `/api/job/{id}/status` response keys + try `/api/history/{id}` to stderr — record findings in a follow-up spike note.

#### `src/__tests__/architecture-purity.test.ts` (EXTEND)

**Analog:** self — add assertions for the 4 new pure modules

**Existing pattern** (`src/__tests__/architecture-purity.test.ts` lines 32-34):
```typescript
it('src/engine/ has zero imports from @modelcontextprotocol/sdk', () => {
  expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/')).toBe(0);
});
```

**Changes when applying — NO new `it()` calls needed**: the existing `src/engine/` assertion already covers `src/engine/diff.ts`, `src/engine/provenance.ts`, `src/engine/iterate-merge.ts`, `src/engine/diff-summary.ts` because grep traverses the entire directory. Same for the `src/comfyui/` assertion covering `src/comfyui/png-metadata.ts`. Same for `src/store/` covering `src/store/provenance-repo.ts`. **Confirm via a comment** that Phase 3's files inherit these invariants:

```typescript
// Phase 3 inheritance note (D-PROV additions):
// - src/engine/diff.ts, src/engine/diff-summary.ts, src/engine/provenance.ts,
//   src/engine/iterate-merge.ts: pure modules, covered by the src/engine/ grep.
// - src/comfyui/png-metadata.ts: pure binary parser, covered by src/comfyui/ grep.
// - src/store/provenance-repo.ts: repo, covered by src/store/ grep.
```

Optionally **add a negative assertion** for the append-only invariant: `src/store/provenance-repo.ts` has no UPDATE / DELETE prepared statements:
```typescript
it('src/store/provenance-repo.ts has zero UPDATE/DELETE statements (D-PROV-01)', () => {
  // Match "db.update(" or "db.delete(" calls in the repo file.
  expect(grepCount('db.update(', 'src/store/provenance-repo.ts')).toBe(0);
  expect(grepCount('db.delete(', 'src/store/provenance-repo.ts')).toBe(0);
});
```

#### `src/__tests__/tool-budget.test.ts` (EXTEND)

**Analog:** self

**Existing assertion** (lines 37-42):
```typescript
it('Phase 2 registers exactly 5 tools (D-GEN-03)', () => {
  expect(registerToolCount()).toBe(5);
});
```

**Changes:** Rename the `it` description to "Phase 3 registers exactly 6 tools (D-PROV-07)" and bump the expected count from 5 to 6. Keep the ≤12 ceiling assertion unchanged.

#### `src/__tests__/stdio-hygiene.test.ts` (EXTEND)

**Analog:** self — add one assertion

**Existing pattern** (`src/__tests__/stdio-hygiene.test.ts` lines 107-122):
```typescript
it('stderr never contains the literal "COMFYUI_API_KEY=" (D-GEN-12 secret hygiene)', async () => {
  const env = { /* ... */, COMFYUI_API_KEY: 'sk-fake-abcdef1234567890' };
  const { stderr } = await bootAndKill(env, 'key-leak');
  expect(stderr).not.toContain('COMFYUI_API_KEY=');
  expect(stderr).not.toContain('sk-fake-abcdef1234567890');
});
```

**Changes — add one test:**
```typescript
it('stderr never logs the resolved prompt blob content (D-PROV-38 cross-cutting #7)', async () => {
  // Prompt blobs may contain prompts the artist considers sensitive.
  // Provenance events must not emit the prompt_json value to stderr — only
  // identifiers (version_id, event_type, timestamp) are permissible.
  //
  // This is a structural assertion: server boots with a seeded version that
  // has a completed provenance event containing a known sentinel string; the
  // sentinel must not appear anywhere in stderr during boot + recovery poll.
  const SENTINEL = 'SENSITIVE_PROMPT_TEXT_DO_NOT_LOG';
  // ... seed the DB, boot, assert
  expect(stderr).not.toContain(SENTINEL);
});
```

The exact implementation may need to seed a pre-existing DB + provenance row before `bootAndKill` (a new option on the helper), or it can be a simpler grep-the-codebase test that asserts no `console.error(prompt_json)` pattern exists:
```typescript
it('source has no console.error calls that would log a prompt blob (D-PROV static check)', () => {
  // Grep for patterns that would log a prompt_json/workflow_json value.
  expect(grepCount('prompt_json', 'src/engine/provenance.ts')).toBeGreaterThan(0); // ref OK
  // But never a log line with prompt_json interpolation.
  // (approximated — tighten with a more specific regex if needed)
  const leaks = execFileSync('grep', ['-rE', 'console\\.error.*prompt_json', 'src/'], { encoding: 'utf8' }).trim();
  expect(leaks).toBe('');
});
```

---

## Shared Patterns

### Pattern 1: Repo Boundary (better-sqlite3 + Drizzle + TypedError)

**Source:** `src/store/version-repo.ts` lines 1-42
**Apply to:** `src/store/provenance-repo.ts`

```typescript
import { eq, /* inArray, sql */ } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { /* table */ } from './schema.js';
import type { /* Entity */ } from '../types/provenance.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';

type Db = BetterSQLite3Database<typeof schema>;

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  const code = e.code ?? '';
  if (code.startsWith('SQLITE_CONSTRAINT')) {
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
    if (/UNIQUE/i.test(e.message ?? '')) return true;
  }
  return false;
}

export class /* Repo */ {
  constructor(private db: Db) {}
  // insert/select methods
}
```

### Pattern 2: Tool Boundary (raw ZodRawShape + handler re-validation + dual error wrap)

**Source:** `src/tools/generation-tool.ts` lines 121-181
**Apply to:** `src/tools/version-tool.ts` (NEW), `src/tools/generation-tool.ts` (EXTEND with reproduce/iterate)

```typescript
export function register<Name>(server: McpServer, engine: Engine) {
  server.registerTool(
    '<name>',
    {
      title: '<Title>',
      description: '...',
      // RT-01: all fields .optional() at ZodRawShape layer; handler re-validates.
      inputSchema: { /* action: z.enum([...]), ...all fields optional */ },
    },
    async (rawInput) => {
      try {
        const input = <Name>InputSchema.parse(rawInput);
        switch (input.action) {
          case 'X': return toolOk(shape<Entity>(await engine.<op>(...)));
          default: {
            const _exhaustive: never = input;
            throw new TypedError('INVALID_INPUT', `Unhandled <name> action: ${String(_exhaustive)}`);
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
    },
  );
}
```

### Pattern 3: Pure Engine Module (TypedError throws, zero IO)

**Source:** `src/comfyui/format.ts` lines 1-100
**Apply to:** `src/engine/diff.ts`, `src/engine/iterate-merge.ts`, `src/engine/provenance.ts` (pure half), `src/engine/diff-summary.ts`, `src/comfyui/png-metadata.ts`

```typescript
import { TypedError } from '../engine/errors.js';
import type { /* types */ } from '../types/provenance.js';

export function <purePredicateOrTransform>(input: /* ... */): /* ... */ {
  // Pre-condition checks — throw TypedError with actionable hint.
  if (/* invalid */) {
    throw new TypedError(
      '<CODE>',
      `<specific message naming the offending identifier>`,
      `<actionable recovery — list valid ids, point to a tool, etc.>`,
    );
  }
  // Pure transform — no IO, no mutation of input.
  return /* result */;
}
```

### Pattern 4: Engine Orchestrator (constructor-injected deps, return {entity, breadcrumb})

**Source:** `src/engine/generation.ts` lines 61-123
**Apply to:** `src/engine/generation.ts` (EXTEND with reproduceVersion / iterateFromVersion / submitInternal refactor)

```typescript
export class GenerationEngine {
  constructor(
    private hierarchy: HierarchyRepo,
    private versions: VersionRepo,
    private provenance: ProvenanceRepo,           // NEW Phase 3
    private provenanceWriter: ProvenanceWriter,   // NEW Phase 3
    private client: ComfyUIClient | null,
    private breadcrumb: BreadcrumbResolver,
    private outputRoot: string = 'outputs',
    options: { maxConcurrentPollers?: number } = {},
  ) { /* ... */ }

  async <op>(...): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    // 1. Precondition checks throwing TypedError.
    // 2. Fail-fast before any DB write (shot-exists / validateWorkflowFormat).
    // 3. Insert row — first mutation point.
    // 4. Network / external I/O with try/catch wrapping to markFailed on error.
    // 5. setLineage (reproduce/iterate only) or setJobId (submit).
    // 6. Return { entity: refreshed, breadcrumb: this.breadcrumb.resolve('version', id) }.
  }
}
```

### Pattern 5: Response Envelope (Phase 1 D-25 dual-form + breadcrumb)

**Source:** `src/tools/envelope.ts` lines 1-60 + `src/tools/shape.ts` lines 32-41
**Apply to:** Every Phase 3 tool response (version-tool + extended generation-tool)

```typescript
// Engine returns { entity, breadcrumb: { entries, text } }.
// Tool emits { structuredContent: { entity, breadcrumb: BreadcrumbEntry[], breadcrumb_text }, content: [{type:'text', text: JSON.stringify(structured)}] }.

export function toolOk(structured: StructuredContent) {
  return {
    structuredContent: structured,
    content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
  };
}

// Contract: JSON.parse(content[0].text) must deep-equal structuredContent.
```

### Pattern 6: Error Wrap (typed-error passthrough, unknown-error defence-in-depth)

**Source:** `src/tools/envelope.ts` lines 32-60
**Apply to:** Every Phase 3 tool catch branch

```typescript
export function toolError(err: unknown) {
  if (err instanceof TypedError) {
    const payload: { code: string; message: string; hint?: string } = {
      code: err.code,
      message: err.message,
    };
    if (err.hint) payload.hint = err.hint;
    return { isError: true, structuredContent: payload, content: [{ type: 'text', text: JSON.stringify(payload) }] };
  }
  console.error('[envelope] Unwrapped error at tool boundary:', err);
  const fallback = { code: 'INVALID_INPUT' as const, message: 'Unexpected internal error' };
  return { isError: true, structuredContent: fallback, content: [{ type: 'text', text: JSON.stringify(fallback) }] };
}
```

### Pattern 7: Direct-Mirror Tool Test (Zod parse + engine call + envelope)

**Source:** `src/tools/__tests__/generation-tool.test.ts` lines 72-127
**Apply to:** `src/tools/__tests__/version-tool.test.ts`, `src/tools/__tests__/generation-reproduce-iterate.test.ts`

```typescript
async function invoke<Action>(stack, input) {
  try {
    const parsed = z.object({ /* action-specific schema */ }).parse(input);
    return toolOk(
      shape<Entity>(await stack.engine.<op>(/* args */)),
    );
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

### Pattern 8: Breadcrumb Resolver Case (already covers 'version')

**Source:** `src/engine/breadcrumb.ts` lines 64-77
**Apply to:** No Phase 3 change — the existing `'version'` case already resolves `version → shot → sequence → project → workspace`. Phase 3 tool responses inherit this for free. (Internal note: the `Version` leaf name renders via `versionLabel(ver.version_number)` — the `v###` format.)

### Pattern 9: In-Memory Test Fixture (`makeInMemoryDb`)

**Source:** `src/test-utils/fixtures.ts` lines 18-30
**Apply to:** All Phase 3 repo + engine + tool integration tests (provenance-repo.test.ts, diff.test.ts, iterate-merge.test.ts, version-tool.test.ts, etc.)

```typescript
import { makeInMemoryDb } from '../../test-utils/fixtures.js';

// In beforeEach or setup function:
const { db } = makeInMemoryDb();
// Migration 0003 applies automatically via migrate() in makeInMemoryDb — no extra wiring.
const hierarchy = new HierarchyRepo(db);
const versions = new VersionRepo(db);
const provenance = new ProvenanceRepo(db);
// Seed workspaces/projects/sequences/shots as needed.
```

---

## No Analog Found

These files have no close analog in the Phase 1/2 codebase — planner should use RESEARCH.md sections as the primary reference:

| File | Role | Data Flow | Reason | RESEARCH.md Reference |
|------|------|-----------|--------|----------------------|
| `src/comfyui/png-metadata.ts` | binary parser | file-I/O | No PNG parser exists yet; `format.ts` is JSON-only | §D-PROV-05 Resolution (lines 208-223) — 30-line hand-rolled parser per PNG spec |
| `src/engine/diff.ts` | pure diff engine | transform | No prior diff engine in codebase; `format.ts` is the shape precedent only | §Diff engine approach (lines 443-609) — full 4-pass algorithm |
| `src/engine/diff-summary.ts` | deterministic template renderer | transform | No template renderer in codebase; `backoff.ts` is only a structural precedent | §Summary rendering (lines 567-607) — verbatim algorithm |

For all three, the planner should paste the RESEARCH.md algorithm into the implementation rather than pattern-match from code that doesn't exist yet.

---

## Metadata

**Analog search scope:**
- `src/store/` — all repos (hierarchy-repo, version-repo)
- `src/engine/` — all engine modules (pipeline, generation, breadcrumb, backoff, errors)
- `src/tools/` — all tool files (workspace-tool, project-tool, sequence-tool, shot-tool, generation-tool, envelope, shape)
- `src/comfyui/` — client.ts, format.ts, types.ts
- `src/types/` — hierarchy.ts
- `src/utils/` — outputs.ts, id.ts
- `src/test-utils/` — fixtures.ts, fake-comfyui-client.ts, matchers.ts
- `src/__tests__/` — cross-cutting tests
- `drizzle/` — 0001 and 0002 migrations

**Files scanned:** 38 source files + 7 test files + 2 migrations.

**Pattern extraction date:** 2026-04-22.

**Phase 1/2 output summary:**
- Phase 1 landed D-01..D-36 (4 tools, hierarchy CRUD, dual transport, typed errors, envelope).
- Phase 2 landed D-GEN-01..D-GEN-42 (1 tool + schema migration + ComfyUI client + recovery poller + live smoke). Tool count: 5 of 12.
- Phase 3 extends both: **6 of 12 tools** after, adds `provenance` table + `lineage_type` column, 4 new pure engine modules (diff, diff-summary, iterate-merge, provenance), 1 new HTTP-client method (`fetchResolvedPrompt`), 1 new binary parser module (`png-metadata`), 4 new error codes.

## PATTERN MAPPING COMPLETE
