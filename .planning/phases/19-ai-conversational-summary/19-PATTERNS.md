# Phase 19: AI Conversational Summary - Pattern Map

**Mapped:** 2026-05-09
**Files analyzed:** 22 (15 NEW + 7 MODIFIED)
**Analogs found:** 21 / 22 (1 file has no direct codebase analog — `circuit-breaker.ts`)

This map extracts concrete patterns from existing codebase files for the planner to copy verbatim. Every analog cites file path + line numbers; every excerpt is the actual shape the new file must mirror. Phase 14 (`c2pa-node`) is the dominant precedent — its sole-importer + lazy-load + boot-validation + append-only-event-row + pure-helper-isolation discipline is reused mechanically for the Anthropic SDK introduction.

---

## File Classification

### NEW files (15)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/utils/anthropic-config.ts` | Config (boot validation) | env → typed config or null | `src/utils/c2pa-config.ts` | exact |
| `src/engine/summary/anthropic-client.ts` | Engine SDK importer (sole) | input → SDK call → result | `src/engine/c2pa/signer.ts` (lines 39-97) | exact |
| `src/engine/summary/template.ts` | Engine pure helper (constants) | constants only | `src/engine/c2pa/constants.ts` (constants) + `src/engine/diff-summary.ts` shape | role-match |
| `src/engine/summary/templates/few-shot-examples.ts` | Engine pure helper (data) | string array constant | `src/engine/c2pa/constants.ts` constant patterns | role-match |
| `src/engine/summary/sanitizer.ts` | Engine pure helper (allow-list + leak scan) | provenance dict → sanitized payload | `src/engine/output-hash.ts` (multi-encoding leak scan in `c2pa-redaction-e2e.test.ts:76-92`) | role-match |
| `src/engine/summary/validation.ts` | Engine pure helper (regex gate) | text + models → ok/reason | `src/engine/diff-summary.ts` (pure function shape, no deps) | role-match |
| `src/engine/summary/deterministic-template.ts` | Engine pure helper (fallback content) | provenance fields → text | `src/engine/diff-summary.ts` (lines 48-69) | exact |
| `src/engine/summary/circuit-breaker.ts` | Engine pure helper (state machine) | event → state transition | NONE — see "No Analog Found" | none |
| `src/engine/summary/index.ts` | Engine facade (barrel + summarizeVersion) | versionId → discriminated SummaryOutcome | `src/engine/pipeline.ts` (`Engine.signOutput` lines 1133-1395) | exact |
| `drizzle/0007_phase19_summary_generated_event.sql` | DB migration | DDL only | `drizzle/0006_phase14_manifest_signed_event.sql` | exact |
| `packages/dashboard/src/state/summaries.ts` | Dashboard signal map | server response → signal write | `packages/dashboard/src/state/active-generations.ts` + `packages/dashboard/src/state/versions.ts` | role-match |
| `packages/dashboard/src/components/SummarySection.tsx` | Dashboard component (composition) | state-prop → JSX | `packages/dashboard/src/components/C2paBadge.tsx` (discriminated-state render) + `WarningPill.tsx` (pure pill) | role-match |
| `packages/dashboard/src/components/RegenerateButton.tsx` | Dashboard component (button + countdown) | onClick + cooldown → JSX | `packages/dashboard/src/components/SortDropdown.tsx` (interactive button + ARIA + hooks) | role-match |
| `src/__tests__/summary-redact-e2e.test.ts` | E2E test (redact → cache invalidation) | sign → summarize → redact → re-summarize | `src/__tests__/c2pa-redaction-e2e.test.ts` | exact |
| `src/__tests__/summary-leak-scan.test.ts` | Negative test (leak surface) | API-key fragment round-trip → assert absent | `src/__tests__/c2pa-key-leak-negative.test.ts` + `c2pa-redaction-e2e.test.ts:76-92` | role-match |
| `src/__tests__/fixtures/summary-eval/*.json` | Test fixtures (golden eval) | JSON data | (no direct analog — author hand-curated) | none |

### MODIFIED files (7)

| Modified File | Role | Modification | Analog Section |
|---------------|------|--------------|---------------|
| `src/engine/pipeline.ts` | Engine class | Add `summarizeVersion` method + private `summaryEngine` field | `Engine.signOutput` (lines 1133-1395) + constructor `c2paConfig` field (line 260) |
| `src/store/provenance-repo.ts` | Repo (append-only) | Add `appendSummaryGeneratedEvent` + `getLatestSummaryGeneratedEvent`; extend `ProvenanceEventPayload` union | `appendManifestSignedEvent` (lines 203-211) + `getLatestManifestSignedEvent` (lines 265-291) |
| `src/store/schema.ts` | Drizzle schema | Add `summary_generated_json: text(...)` nullable column | Existing `manifest_signed_json` line 130 |
| `src/types/provenance.ts` | Type union | Extend `ProvenanceEventType` with `'summary_generated'`; add `SummaryGeneratedPayloadFields` type | `ProvenanceEventType` union line 5-10 + `ManifestSignedPayloadFields` lines 30-96 |
| `src/http/dashboard-routes.ts` | HTTP routes | Add `GET /api/versions/:id/summary` + `POST /api/versions/:id/summary/regenerate` + 60s throttle map | Existing version routes (lines 278-298) + `INVALID_INPUT` envelopes (lines 286-298) |
| `packages/dashboard/src/views/VersionDrawer.tsx` | Dashboard view | Insert `<SummarySection/>` above Output; wrap existing Provenance `<ul>` in `<details>`; add summary auto-fetch `useEffect` | Existing C2PA auto-fetch `useEffect` (lines 119-133) + Provenance section (lines 324-337) |
| `src/__tests__/architecture-purity.test.ts` | Architecture purity test | Add 7 assertions for `@anthropic-ai/sdk` allowed-set + 6 file-level pure-helper guards | Existing `c2pa-node` allowed-set test (lines 166-231) + pure-helper file-level tests (lines 233-309) |
| `package.json` | Dependency manifest | Add `"@anthropic-ai/sdk": "0.95.1"` (exact pin) | Existing `"c2pa-node": "0.5.26"` line 41 |

---

## Pattern Assignments

### `src/utils/anthropic-config.ts` (config, boot-validation)

**Analog:** `src/utils/c2pa-config.ts`

**Imports + module docstring pattern** (`src/utils/c2pa-config.ts:1-31`):

```typescript
/**
 * Phase N — <REQ-CODE>. <one-line summary>.
 *
 * Reads <env vars> from env, validates, and returns a <Config> OR null
 * (<feature> disabled). Throws TypedError('<CONFIG_INVALID_CODE>', ...)
 * when validation fails.
 *
 * Throwing BEFORE any transport connect or tool register is the parity-with-
 * Phase-10 MIGRATION_PENDING-typed-error pattern (...).
 *
 * **Path/secret leak hygiene (...):** Error messages and the boot success log
 * emit ONLY the basename of the cert/key files / last-4 of the API key,
 * never the full path/key.
 *
 * Mirrors the validateBaseUrlFromEnv pattern at src/utils/validate-base-url.ts:
 * pure helper, exported for tests, imported by src/server.ts boot path.
 */

import { ... } from 'node:fs';
import { TypedError } from '../engine/errors.js';
import type { AnthropicConfig } from '../types/anthropic.js';
```

**Public function signature pattern** (`src/utils/c2pa-config.ts:46-104`):

```typescript
export function loadAnthropicConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AnthropicConfig | null {
  const apiKey = env.ANTHROPIC_API_KEY;

  // Unset → feature disabled (D-CTX-2 graceful degradation).
  if (!apiKey || apiKey.trim().length === 0) return null;

  // Validate format. last-4 ONLY in any error message.
  if (!apiKey.startsWith('sk-ant-')) {
    throw new TypedError(
      'ANTHROPIC_CONFIG_INVALID',
      `ANTHROPIC_API_KEY format invalid (last 4: ****${apiKey.slice(-4)})`,
      'ANTHROPIC_API_KEY must start with "sk-ant-". See .env.example.',
    );
  }
  if (apiKey.length < 30) {
    throw new TypedError(
      'ANTHROPIC_CONFIG_INVALID',
      `ANTHROPIC_API_KEY too short (last 4: ****${apiKey.slice(-4)})`,
      'Verify the key was pasted in full from console.anthropic.com.',
    );
  }
  return { apiKey };
}
```

**Key contract:**
- Boot called BEFORE Engine construction (mirror `c2pa-config.ts` `loadC2paConfigFromEnv` call site in `src/server.ts`).
- Unset env → returns `null` (graceful disable). Invalid format → `TypedError`.
- Error messages ONLY emit `****<last-4>` of the API key — NEVER the full key.
- Mirrors `c2pa-config.ts` line 87 `basename(keyPath)` discipline.

**Test analog:** `src/__tests__/c2pa-config.test.ts:66-150` — copy the 6-test shape (unset / malformed / short / valid / mode-warning / boot-log-hygiene).

---

### `src/engine/summary/anthropic-client.ts` (engine SDK importer, sole)

**Analog:** `src/engine/c2pa/signer.ts` (lines 39-97 + 99-225)

**File header docstring pattern** (`src/engine/c2pa/signer.ts:1-31`):

```typescript
// Phase 19 — SUM-01. Engine-layer Anthropic Messages API wrapper.
//
// This is the ONLY file in the codebase that imports @anthropic-ai/sdk. The
// architecture-purity test asserts:
//   grep -rE "from\s*['\"]@anthropic-ai/sdk|import\s*\(\s*['\"]@anthropic-ai/sdk" src/
//   (excluding __tests__) returns matches ONLY in src/engine/summary/anthropic-client.ts.
//
// Mirrors Phase 14 c2pa-node sole-importer discipline. Exposes generateSummary,
// flattenAnthropicError, __resetAnthropicSdkStateForTests; the Engine facade
// in src/engine/summary/index.ts is the SOLE caller.
//
// Lazy + try/catch'd binding load — the FIRST invocation attempts the dynamic
// import; subsequent invocations reuse the cached module OR throw the cached
// load error wrapped in TypedError('ANTHROPIC_SDK_LOAD_FAILED'). Server boot
// NEVER calls this path.
```

**Lazy-import + cached error short-circuit pattern** (`src/engine/c2pa/signer.ts:39-71`) — copy this verbatim with `c2pa-node` → `@anthropic-ai/sdk`, `C2PA_SIGNER_LOAD_FAILED` → `ANTHROPIC_SDK_LOAD_FAILED`:

```typescript
// Native binding — loaded lazily.
type AnthropicSdkModule = typeof import('@anthropic-ai/sdk');
let anthropicModule: AnthropicSdkModule | null = null;
let anthropicLoadError: Error | null = null;

async function ensureAnthropicSdk(): Promise<AnthropicSdkModule> {
  if (anthropicModule !== null) return anthropicModule;
  if (anthropicLoadError !== null) {
    throw new TypedError(
      'ANTHROPIC_SDK_LOAD_FAILED',
      `Anthropic SDK unavailable: ${anthropicLoadError.message}`,
      'Reinstall @anthropic-ai/sdk@0.95.1; verify Node >=20 and ESM-compatible runtime.',
    );
  }
  try {
    anthropicModule = await import('@anthropic-ai/sdk');
    return anthropicModule;
  } catch (err) {
    anthropicLoadError = err as Error;
    throw new TypedError(
      'ANTHROPIC_SDK_LOAD_FAILED',
      `Anthropic SDK unavailable: ${(err as Error).message}`,
      'Reinstall @anthropic-ai/sdk@0.95.1; verify Node >=20.',
    );
  }
}
```

**Test-only reset hook pattern** (`src/engine/c2pa/signer.ts:86-97`):

```typescript
/**
 * Test-only — resets the module-scoped lazy-load state so a vi.mock on
 * `@anthropic-ai/sdk` can take effect in subsequent test cases. Production
 * code MUST NOT call this — it deliberately re-triggers the lazy import path.
 *
 * Exported only because vi.mock is hoisted and we cannot scope it to the
 * test file. Naming starts with `__` to discourage accidental usage.
 */
export function __resetAnthropicSdkStateForTests(): void {
  anthropicModule = null;
  anthropicLoadError = null;
}
```

**Public API pattern** — distill from `loadSigner` shape (`src/engine/c2pa/signer.ts:158-225`): take config + input, lazy-load, build SDK client locally, call SDK, return narrow result, wrap any throw in TypedError. New shape:

```typescript
export async function generateSummary(
  promptInput: { system: string; userTurn: string },
  apiKey: string,
): Promise<{ text: string; prompt_tokens: number; completion_tokens: number }> {
  const sdk = await ensureAnthropicSdk();
  const Anthropic = sdk.default;
  const client = new Anthropic({
    apiKey,
    maxRetries: 0,    // D-FB-4: engine owns retry; disable SDK retry
    timeout: 10_000,  // 10s per-call timeout
  });
  // First attempt; engine-owned single retry on transient.
  try { return await invokeAnthropic(client, sdk, promptInput); }
  catch (err) {
    if (isTransient(err, sdk)) {
      await sleep(1000);
      return await invokeAnthropic(client, sdk, promptInput);
    }
    throw err;
  }
}
```

**Error-flatten + multi-encoding leak scan helper** — promote pattern from `src/__tests__/c2pa-redaction-e2e.test.ts:76-92` into a colocated helper inside `anthropic-client.ts`:

```typescript
/**
 * Strip API key from any error string in 4 encodings (D-PRIV-3 + D-PRIV-4).
 * Mirrors the multi-encoding leak scan from c2pa-redaction-e2e.test.ts:76-92.
 */
export function flattenAnthropicError(err: unknown): string {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  let raw = err instanceof Error ? err.message : String(err);
  if (apiKey.length > 0) {
    const fragments = [
      apiKey,                                                     // UTF-8 / ASCII
      Buffer.from(apiKey, 'utf16le').toString('binary'),          // UTF-16LE
      Buffer.from(apiKey, 'utf16le').reverse().toString('binary'),// UTF-16BE
      Buffer.from(apiKey).toString('base64'),                     // base64
    ];
    for (const frag of fragments) {
      while (raw.includes(frag)) raw = raw.replaceAll(frag, '<REDACTED>');
    }
  }
  // Defence-in-depth: strip sk-ant-... pattern even if env-var diverges.
  raw = raw.replace(/sk-ant-[A-Za-z0-9_-]{40,}/g, '<REDACTED>');
  return raw;
}
```

**Architecture-purity isolation** — like `signer.ts`, this is the ONLY file allowed to `import` from `@anthropic-ai/sdk`. The `architecture-purity.test.ts` extension below enforces this at the AST/grep layer.

---

### `src/engine/summary/template.ts` + `templates/few-shot-examples.ts` (engine pure helpers, constants)

**Analog:** `src/engine/c2pa/constants.ts` shape (constant exports, zero deps) + `src/engine/diff-summary.ts:11-12` for the cap-constant pattern.

**Pattern:** plain TypeScript file, ZERO imports, exports named string/number constants. The `SUMMARY_TEMPLATE_VERSION` constant is the cache-key driver (D-LLM-6 — bump on any change to system prompt or examples). Few-shot examples ship as a `readonly string[]` from `templates/few-shot-examples.ts`.

```typescript
// src/engine/summary/template.ts — pure constants + assembly. Zero imports.
export const SUMMARY_TEMPLATE_VERSION = '1.0.0' as const;
export const SUMMARY_MODEL_ID = 'claude-haiku-4-5-20251001' as const;
export const SUMMARY_MAX_TOKENS = 180;
export const SUMMARY_TEMPERATURE = 0.7;

export const SYSTEM_PROMPT = `You are a VFX Supervisor reviewing a generation. ...`;

export function assemblePromptInput(sanitized: SanitizedProvenance): {
  system: string;
  userTurn: string;
} {
  // Static prefix = SYSTEM_PROMPT + few-shot examples joined.
  // userTurn = XML-delimited <provenance>...</provenance> from sanitized fields (D-PRIV-5).
}
```

**Architecture-purity guard** (mirrors `architecture-purity.test.ts:233-251` for `manifest-builder.ts`):
- `template.ts` → grep ZERO `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `better-sqlite3`, `drizzle-orm`, `hono`.
- `templates/few-shot-examples.ts` → same purity assertion.

---

### `src/engine/summary/sanitizer.ts` (engine pure helper, allow-list + leak scan)

**Analog:** `src/engine/output-hash.ts` (pure helper with leak-scan defence-in-depth) + `src/__tests__/c2pa-redaction-e2e.test.ts:76-92` (multi-encoding helper).

**Pattern shape:**

```typescript
// src/engine/summary/sanitizer.ts — pure. Zero MCP / SDK / SQLite / ORM / Hono imports.
import type { ModelRef, ProvenanceCompletedPayload } from '../../types/provenance.js';

/**
 * D-PRIV-1: explicit allow-list. Any field NOT enumerated here is stripped
 * before LLM dispatch. Each field added is a code change, never a config tweak.
 */
const ALLOW_LIST = [
  'model_name', 'prompt_positive', 'prompt_negative', 'seed',
  'parent_version_id', 'ingredient_summary_counts', 'redacted',
] as const;

export interface SanitizedProvenance { /* ... narrowed shape */ }

export function sanitizeProvenance(input: {
  version: VersionEntity;
  completed: ProvenanceCompletedPayload | null;
  models: ModelRef[] | null;
  isRedacted: boolean;
}): SanitizedProvenance {
  // Iterate over ALLOW_LIST keys, never input keys (prototype pollution defence).
  // ...
}

/** D-PRIV-3: defence-in-depth leak scan on the OUTBOUND payload. */
export function assertNoApiKeyInPayload(payload: SanitizedProvenance): void {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (apiKey.length === 0) return;
  const haystack = JSON.stringify(payload);
  // Multi-encoding sweep — UTF-8 / UTF-16LE / UTF-16BE / base64.
  // (Identical fragment-array shape as flattenAnthropicError.)
}
```

**Why pure:** the architecture-purity test gains a file-level assertion that this file imports zero `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `better-sqlite3`, `drizzle-orm`, `hono` — adversarial review can read the file in isolation.

---

### `src/engine/summary/validation.ts` (engine pure helper, regex gate)

**Analog:** `src/engine/diff-summary.ts` — pure helper, no deps, returns plain TS structure.

**Pattern shape (D-VAL-4):**

```typescript
// src/engine/summary/validation.ts — pure. Zero imports beyond local types.
import type { ModelRef } from '../../types/provenance.js';

const REDACTION_MARKERS = ['redacted', 'partial', 'redaction'] as const;

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'missing_model_name' | 'missing_redaction_marker' | 'empty' };

export function validateSummary(
  text: string,
  models: ModelRef[],
  isRedacted: boolean,
): ValidationResult {
  if (!text || text.trim().length === 0) return { ok: false, reason: 'empty' };

  if (isRedacted) {
    // D-VAL-3: redaction marker mandatory; model name regex skipped for redacted versions.
    const lower = text.toLowerCase();
    const hasMarker = REDACTION_MARKERS.some((m) => lower.includes(m));
    return hasMarker ? { ok: true } : { ok: false, reason: 'missing_redaction_marker' };
  }

  // D-VAL-1: at least one model name appears verbatim (case-sensitive).
  const hasModelName = models.some((m) => m.model_name.length > 0 && text.includes(m.model_name));
  return hasModelName ? { ok: true } : { ok: false, reason: 'missing_model_name' };
}
```

**Test analog:** mirror `src/engine/__tests__/diff-summary.test.ts` shape (pure-helper unit tests with deterministic fixtures, no mocks).

---

### `src/engine/summary/deterministic-template.ts` (engine pure helper, fallback content)

**Analog:** `src/engine/diff-summary.ts:48-69` — exact pattern.

**Core pattern from `diff-summary.ts:48-69`:**

```typescript
// Sorted ordering, capped output, fallback string for empty case.
const MAX_CHANGES = 6;
const HARD_CAP = 400;

export function buildSummary(changes: DiffChanges): string {
  const parts: string[] = [];
  // ... deterministic ordering: params (numeric node_id asc, then field) → models → seed → workflow → metadata
  for (const p of params) parts.push(renderParam(p));
  for (const m of changes.models) parts.push(renderModel(m));
  if (changes.seed) parts.push(renderSeed(changes.seed));
  // ...
  if (parts.length === 0) return 'No changes.';
  const visible = parts.slice(0, MAX_CHANGES);
  const elided = parts.length - visible.length;
  let out = visible.join('. ');
  if (elided > 0) out += `. …and ${elided} more changes`;
  if (out.length > HARD_CAP) out = out.slice(0, HARD_CAP - 1) + '…';
  return out;
}
```

**Phase 19 adaptation (D-FB-1, D-FB-5):**

```typescript
// src/engine/summary/deterministic-template.ts — pure. Zero deps.
import type { ProvenanceCompletedPayload, ModelRef } from '../../types/provenance.js';

const HARD_CAP = 320;

export function buildDeterministicSummary(args: {
  completed: ProvenanceCompletedPayload | null;
  models: ModelRef[] | null;
  parentVersionLabel: string | null;
  isRedacted: boolean;
  versionLabel: string;
}): string {
  const { completed, models, parentVersionLabel, isRedacted, versionLabel } = args;
  if (!completed) return `${versionLabel} provenance unavailable.`;
  const parts: string[] = [];
  const primaryModel = models?.[0]?.model_name ?? 'an unknown model';
  parts.push(`${versionLabel} generated with ${primaryModel} at seed ${completed.seed ?? 'unspecified'}`);
  if (parentVersionLabel) parts.push(`Iterate from ${parentVersionLabel}`);
  if (models && models.length > 1) {
    parts.push(`Additional models: ${models.slice(1).map(m => m.model_name).join(', ')}`);
  }
  if (isRedacted) parts.push('Some prompt fields were redacted');
  let out = parts.join('. ') + '.';
  if (out.length > HARD_CAP) out = out.slice(0, HARD_CAP - 1) + '…';
  return out;
}
```

---

### `src/engine/summary/circuit-breaker.ts` (engine state machine)

**Analog:** NONE in the existing codebase. See "No Analog Found" section.

The closest related thing is the per-`(versionId, filename)` mutex in `src/engine/pipeline.ts:299-302`, but that is a coalescing mutex, not a state machine. Use the RESEARCH.md §"Code Examples — Circuit Breaker" template (lines 996-1056) verbatim — it was authored to fill exactly this gap. Adopt the test-only `__reset` hook naming convention from `__resetC2paNodeStateForTests` in `src/engine/c2pa/signer.ts:94-97`.

---

### `src/engine/summary/index.ts` (engine facade — barrel + summarizeVersion)

**Analog:** `Engine.signOutput` in `src/engine/pipeline.ts:1133-1395`.

**Discriminated outcome union pattern** (mirrors the `signOutput` 6+ outcome enumeration via `status_reason` codes at `pipeline.ts:1192-1395`):

```typescript
// src/engine/summary/index.ts — barrel + facade. Imports limited to pure
// helpers + repos + the sole anthropic-client wrapper.

export type SummaryOutcome =
  | { source: 'cache_hit'; text: string; generated_at: string;
      template_version: string; model_id: string }
  | { source: 'live'; text: string; generated_at: string;
      template_version: string; model_id: string;
      prompt_tokens: number; completion_tokens: number }
  | { source: 'fallback'; text: string;
      reason: 'api_key_missing' | 'circuit_open' | 'sdk_load_failed' | 'http_error'
            | 'network_error' | 'validation_failed' | 'output_too_short' | 'timeout' };

export interface SummarizeVersionDeps {
  versionRepo: VersionRepo;
  provenanceRepo: ProvenanceRepo;
  anthropicConfig: { apiKey: string } | null;
  clock: () => number;
}

export async function summarizeVersion(
  versionId: string,
  deps: SummarizeVersionDeps,
  options?: { regenerate?: boolean },
): Promise<SummaryOutcome> {
  // Pipeline (mirrors Engine.signOutput's 5-path layout):
  //   1. Load version + completed event + fingerprints + manifest_signed event + redact-status.
  //   2. Cache lookup (skipped when options.regenerate === true).
  //   3. Pre-flight checks → fallback paths (api_key_missing, circuit_open).
  //   4. Sanitize + assemble prompt input.
  //   5. Call Anthropic → record success/failure on circuit breaker.
  //   6. Validate output (D-VAL-2 gates the cache write).
  //   7. Write append-only event row.
  //   8. Return SummaryOutcome.
}
```

**Engine class integration** — modify `src/engine/pipeline.ts` (`class Engine` at line 233) by adding a thin facade method that delegates to the pure `summarizeVersion`. Mirrors the wiring pattern of `Engine.signOutput` (lines 1133-1173) — engine class field, public async method, optional config field, lazy load of any deps:

```typescript
// In class Engine:
private readonly anthropicConfig: { apiKey: string } | null;

constructor(/* ... existing params */, options: {
  c2paConfig?: C2paConfig | null;
  anthropicConfig?: { apiKey: string } | null;  // NEW (Phase 19)
} = {}) {
  // ... existing
  this.anthropicConfig = options.anthropicConfig ?? null;
}

async summarizeVersion(
  versionId: string,
  options?: { regenerate?: boolean },
): Promise<SummaryOutcome> {
  return summarizeVersion(versionId, {
    versionRepo: this.versionRepo,
    provenanceRepo: this.provenanceRepo,
    anthropicConfig: this.anthropicConfig,
    clock: () => Date.now(),
  }, options);
}
```

---

### `drizzle/0007_phase19_summary_generated_event.sql` (DB migration)

**Analog:** `drizzle/0006_phase14_manifest_signed_event.sql` — exact shape.

**Pattern from 0006:**

```sql
-- IDM-03: ROLLBACK NOT SUPPORTED.
--
-- Phase 14 (PROV-V-01) — append a nullable `manifest_signed_json` column to
-- `provenance` carrying the per-event JSON payload of the new
-- 'manifest_signed' event_type (Plan 14-03 Task 1, Concern #2 scope reduction
-- — no `sidecar` field). The event_type column has no CHECK constraint
-- (per Phase 13 SUMMARY) so 'manifest_signed' is purely TS-level
-- discrimination. Pre-Phase-14 rows read NULL here.
--
-- Append-only invariant preserved — ProvenanceRepo continues to expose
-- only INSERTs through the new appendManifestSignedEvent method, mirroring
-- Phase 13's appendModelsFingerprintedEvent. Architecture-purity guard
-- (no this.db.update / this.db.delete in src/store/provenance-repo.ts)
-- continues to pass.
ALTER TABLE `provenance` ADD `manifest_signed_json` text;
```

**Phase 19 verbatim copy** (s/manifest_signed/summary_generated/g + s/Phase 14/Phase 19/g + new commentary):

```sql
-- IDM-03: ROLLBACK NOT SUPPORTED.
--
-- Phase 19 (SUM-05) — append a nullable `summary_generated_json` column to
-- `provenance` carrying the per-event JSON payload of the new
-- 'summary_generated' event_type. Pre-Phase-19 rows read NULL here.
--
-- Cache-key invariant: (manifest_sha256, template_version, model_id) lives
-- INSIDE summary_generated_json. Phase 16 redact mutates manifest_sha256
-- giving cache invalidation for free without explicit invalidation logic.
--
-- Append-only invariant preserved — ProvenanceRepo continues to expose
-- only INSERTs through the new appendSummaryGeneratedEvent method.
ALTER TABLE `provenance` ADD `summary_generated_json` text;
```

---

### `src/store/schema.ts` (MODIFIED — Drizzle table extension)

**Analog:** existing `manifest_signed_json` column at line 130.

**Concrete change** — add a new column to the `provenance` table definition at `src/store/schema.ts:112-137`. Insert AFTER line 130:

```typescript
// Phase 19 addition — SUM-05. Nullable JSON-encoded payload of the
// 'summary_generated' event_type added by Plan 19-XX. Pre-Phase-19 rows
// read NULL here. Added by drizzle migrator via
// 0007_phase19_summary_generated_event.sql; SCHEMA_DDL above intentionally
// does NOT declare this column — matches the Phase 2/3/12/14 additive split.
summary_generated_json: text('summary_generated_json'),
```

**Index:** none required — the existing `idx_provenance_version_time` (version_id, timestamp) covers the LIMIT-50 newest-first scan pattern (mirrors `MANIFEST_SIGNED_LOOKUP_LIMIT` precedent at `provenance-repo.ts:23`).

---

### `src/types/provenance.ts` (MODIFIED — type union extension)

**Analog:** existing `ManifestSignedPayloadFields` (lines 30-96) + `ProvenanceEventType` (lines 5-10).

**Concrete changes:**

1. **Extend `ProvenanceEventType` union** (lines 5-10):

```typescript
export type ProvenanceEventType =
  | 'submitted'
  | 'completed'
  | 'failed'
  | 'models_fingerprinted'
  | 'manifest_signed'
  | 'summary_generated';   // <-- NEW Phase 19
```

2. **Add `SummaryGeneratedPayloadFields`** type (insert after line 96, mirror `ManifestSignedPayloadFields` shape):

```typescript
/**
 * Phase 19 — SUM-05. Sibling event written by Engine.summarizeVersion AFTER
 * a successful LIVE call (cache miss + Anthropic success + validation pass).
 *
 * Cache key: (manifest_sha256, template_version, model_id). Phase 16 redact
 * mutates manifest_sha256 — free invalidation without explicit logic.
 *
 * NEVER carries the prompt text or the response text inside log emissions.
 * The summary_text field stays inside the JSON cell only; the multi-encoding
 * leak scan applies BEFORE INSERT to assert no API key fragments leaked.
 *
 * Append-only: ProvenanceRepo.appendSummaryGeneratedEvent INSERTs a new row;
 * fallback paths NEVER write a row (D-VAL-2). Regenerate paths (option
 * regenerate=true) bypass the cache lookup but still INSERT a new sibling
 * row on success — getLatestSummaryGeneratedEvent returns the newer row.
 */
export type SummaryGeneratedPayloadFields = {
  /** Composite cache-key part 1. From the latest manifest_signed event. */
  manifest_sha256: string;
  /** Composite cache-key part 2. SUMMARY_TEMPLATE_VERSION constant from template.ts. */
  template_version: string;
  /** Composite cache-key part 3. 'claude-haiku-4-5-20251001'. */
  model_id: string;
  /** The validated LLM output (length-capped to ~180-token output budget). */
  summary_text: string;
  /** ISO-8601 timestamp from clock at write time. */
  generated_at: string;
  /** Anthropic response.usage.input_tokens — observability only, never logged with text. */
  prompt_tokens: number;
  /** Anthropic response.usage.output_tokens — observability only. */
  completion_tokens: number;
  /** ALWAYS 'live' — fallback paths do NOT write rows (D-VAL-2). */
  outcome: 'live';
};

export type ProvenanceSummaryGeneratedPayload = {
  event_type: 'summary_generated';
} & SummaryGeneratedPayloadFields;
```

3. **Extend `ProvenanceEvent` interface** (line 106-122) — add nullable `summary_generated_json: string | null`:

```typescript
/** Phase 19 — SUM-05. Populated on 'summary_generated' rows ONLY; carries
 *  the JSON-encoded SummaryGeneratedPayloadFields. Pre-Phase-19 rows
 *  always read NULL here (migration 0007 added the column as nullable). */
summary_generated_json: string | null;
```

---

### `src/store/provenance-repo.ts` (MODIFIED — append + lookup)

**Analog:** `appendManifestSignedEvent` (lines 203-211) + `getLatestManifestSignedEvent` (lines 265-291).

**Append pattern** (mirror line 203-211 verbatim):

```typescript
/** Phase 19 — SUM-05. `appendSummaryGeneratedEvent` writes an
 *  append-only sibling event carrying the verified-good Anthropic LLM
 *  output. Mirrors Phase 14's appendManifestSignedEvent shape exactly.
 *  Uses the new summary_generated_json column (migration 0007). NEVER carries
 *  raw API key material — the engine's flattenAnthropicError + sanitizer
 *  multi-encoding leak scan run BEFORE this writer. Cache-key composite
 *  (manifest_sha256, template_version, model_id) lives INSIDE the JSON
 *  payload — readers compose the lookup at the engine layer. */
appendSummaryGeneratedEvent(
  versionId: string,
  payload: SummaryGeneratedPayloadFields,
): ProvenanceEvent {
  return this.insertEvent(versionId, {
    event_type: 'summary_generated',
    summary_generated_json: JSON.stringify(payload),
  });
}
```

**Bounded lookup pattern** (mirror lines 265-291 verbatim) — copy the LIMIT-50 + in-memory-filter shape, change the composite key from `filename` to `(manifest_sha256, template_version, model_id)`:

```typescript
export const SUMMARY_GENERATED_LOOKUP_LIMIT = 50;

getLatestSummaryGeneratedEvent(
  versionId: string,
  manifestSha256: string,
  templateVersion: string,
  modelId: string,
): SummaryGeneratedPayloadFields | null {
  const rows = this.db
    .select()
    .from(provenance)
    .where(
      and(eq(provenance.version_id, versionId), eq(provenance.event_type, 'summary_generated')),
    )
    .orderBy(desc(provenance.timestamp))
    .limit(SUMMARY_GENERATED_LOOKUP_LIMIT)
    .all() as ProvenanceEvent[];
  for (const row of rows) {
    if (!row.summary_generated_json) continue;
    try {
      const parsed = JSON.parse(row.summary_generated_json) as SummaryGeneratedPayloadFields;
      if (
        parsed.manifest_sha256 === manifestSha256 &&
        parsed.template_version === templateVersion &&
        parsed.model_id === modelId
      ) {
        return parsed;
      }
    } catch {
      // Malformed payload — skip and keep walking newer-to-older.
      continue;
    }
  }
  return null;
}
```

**Discriminated-union extension** of `ProvenanceEventPayload` (lines 74-79) — add the new variant:

```typescript
export type ProvenanceEventPayload =
  | ({ event_type: 'submitted' } & ProvenanceSubmittedPayload)
  | ({ event_type: 'completed' } & ProvenanceCompletedPayload)
  | ({ event_type: 'failed' } & ProvenanceFailedPayload)
  | ({ event_type: 'models_fingerprinted' } & ProvenanceModelsFingerprintedPayload)
  | ({ event_type: 'manifest_signed' } & ProvenanceManifestSignedRowPayload)
  | ({ event_type: 'summary_generated' } & ProvenanceSummaryGeneratedRowPayload);  // NEW

export type ProvenanceSummaryGeneratedRowPayload = {
  summary_generated_json: string;
};
```

**`insertEvent` extension** (lines 85-118) — add the new branch in the row builder:

```typescript
// Phase 19 — SUM-05. The 'summary_generated' event_type carries its
// payload in the new summary_generated_json column (migration 0007).
summary_generated_json:
  payload.event_type === 'summary_generated' ? payload.summary_generated_json : null,
```

**Append-only architecture-purity guard** preserved — repo file stays free of `this.db.update` / `this.db.delete`. The existing literal-grep test continues to pass.

---

### `src/http/dashboard-routes.ts` (MODIFIED — add 2 routes + throttle map)

**Analog:** existing version routes (lines 278-298) + `INVALID_INPUT` envelope pattern (lines 117-122, 286-298).

**Imports + throttle map:**

```typescript
// Add near the top of registerDashboardRoutes (mirror Phase 18's pattern of
// inline throttle map declarations within registration scope).
const summaryThrottle = new Map<string, number>();
const SUMMARY_THROTTLE_MS = 60_000;
```

**GET route pattern** (mirror lines 278-298):

```typescript
app.get('/api/versions/:id/summary', async (c) => {
  const versionId = c.req.param('id');
  // Engine.summarizeVersion never throws to HTTP layer for failure paths;
  // it returns a discriminated SummaryOutcome union (cache_hit / live / fallback).
  // VERSION_NOT_FOUND is the only TypedError surface — error-middleware → 404.
  const outcome = await engine.summarizeVersion(versionId);
  // Embed regenerate-availability hint for the dashboard countdown timer.
  const lastReq = summaryThrottle.get(versionId) ?? 0;
  const regenerateAvailableAtMs = lastReq + SUMMARY_THROTTLE_MS;
  return c.json({ ...outcome, regenerate_available_at_ms: regenerateAvailableAtMs });
});
```

**POST regenerate route pattern** (mirror INVALID_INPUT throw at lines 286-298):

```typescript
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
```

**TypedError code addition** — add `'SUMMARY_THROTTLED'` to the `ErrorCode` union in `src/engine/errors.ts:4-57`. The existing `error-middleware.ts` will surface it as a 4xx automatically.

**Dashboard `lib/api.ts` helpers** — add `getSummary(versionId)` and `regenerateSummary(versionId)` mirroring `getC2paStatus` (`packages/dashboard/src/lib/api.ts:332-354`) shape (try/catch with defensive fallback).

---

### `packages/dashboard/src/state/summaries.ts` (NEW — signal map)

**Analog:** `packages/dashboard/src/state/active-generations.ts` (signal-based store) + `packages/dashboard/src/state/versions.ts` (per-id signal pattern, lines 26-32).

**Pattern:**

```typescript
// packages/dashboard/src/state/summaries.ts
//
// @preact/signals-backed store for per-version summary state.
//
// Architecture-purity (D-WEBUI-31): zero server-tree relative-import traversals.
// Uses dashboard-local SummaryState type colocated below.

import { signal } from '@preact/signals';
import { getSummary, regenerateSummary } from '../lib/api.js';

export type SummaryState =
  | { state: 'loading' }
  | { state: 'success'; text: string; source: 'live' | 'cache_hit';
      generated_at: string; template_version: string; model_id: string;
      regenerateAvailableAtMs: number | null }
  | { state: 'fallback'; text: string; source: 'fallback';
      reason?: string; regenerateAvailableAtMs: number | null }
  | { state: 'error'; message?: string };

/** Per-version summary state. Read by SummarySection; written by VersionDrawer effects. */
export const summarySignal = signal<Map<string, SummaryState>>(new Map());

/** Helper used by VersionDrawer's useEffect mount + Regenerate handler. */
export async function fetchSummary(
  versionId: string,
  options: { regenerate?: boolean } = {},
): Promise<SummaryState> {
  // Wraps lib/api.getSummary / regenerateSummary; never throws (defensive
  // fallback to { state: 'error' }) mirroring getC2paStatus pattern.
}
```

**Architecture-purity** — same D-WEBUI-31 guard as `state/versions.ts`: zero relative imports into `src/`.

---

### `packages/dashboard/src/components/SummarySection.tsx` (NEW — composition)

**Analog:** `packages/dashboard/src/components/C2paBadge.tsx` (discriminated state → branched JSX, lines 71-110+) + `WarningPill.tsx` (pure presentational component for the fallback marker).

**File header docstring pattern** (mirror `WarningPill.tsx:1-20`):

```tsx
/**
 * SummarySection — Phase 19 SUM-01..07 thin-wrapper component.
 *
 * Discriminated-state render — branches on `summary.state` (loading / success /
 * fallback / error). Mirrors C2paBadge's discriminated-render pattern at
 * packages/dashboard/src/components/C2paBadge.tsx:71-110.
 *
 * Composition:
 *   - <SkeletonText/> shimmer block during 'loading' (Phase 17 SkeletonThumbnail aesthetic)
 *   - <p> success body (Preact auto-escapes; T-5-06 mitigation)
 *   - <WarningPill/> fallback marker above body (Phase 12 component reuse)
 *   - <RegenerateButton/> in the section header (Phase 19 NEW component)
 *
 * SECURITY — T-5-06: ALL dynamic content flows through JSX text children.
 * NO dangerouslySetInnerHTML. summary.text comes from the engine (post
 * validation gate D-VAL-1) or from the deterministic-template fallback —
 * never user-supplied at the component boundary.
 *
 * Architecture-purity (D-WEBUI-31): zero imports from src/.
 */
```

**Discriminated render pattern** (mirror `C2paBadge.tsx:71-110`):

```tsx
export function SummarySection({ summary, regenerateAvailableAtMs, onRegenerate, versionLabel, class: className, children }: SummarySectionProps) {
  return (
    <section class={className}>
      <header class="flex items-center justify-between mb-2">
        <h3 class="label-uppercase text-[var(--color-fg-muted)]">Summary</h3>
        <RegenerateButton
          cooldownSeconds={cooldownSeconds(regenerateAvailableAtMs)}
          isFetching={summary.state === 'loading'}
          onClick={onRegenerate}
          ariaLabel={`Regenerate summary for ${versionLabel}`}
        />
      </header>
      {summary.state === 'loading' && <SkeletonText lines={3} />}
      {summary.state === 'success' && (
        <p class="text-sm text-[var(--color-fg)]">{summary.text}</p>
      )}
      {summary.state === 'fallback' && (
        <>
          <WarningPill label="AI summary unavailable"
            ariaLabel="AI summary unavailable; showing structured details" />
          <p class="text-sm text-[var(--color-fg)] mt-2">{summary.text}</p>
        </>
      )}
      {summary.state === 'error' && (
        <>
          <WarningPill label="AI summary unavailable" />
          <p class="text-sm text-[var(--color-fg)] mt-2">(AI summary unavailable; please retry.)</p>
        </>
      )}
      {/* SUM-07 disclosure — children prop carries the relocated provenance section. */}
      {children}
    </section>
  );
}
```

---

### `packages/dashboard/src/components/RegenerateButton.tsx` (NEW — button + countdown)

**Analog:** `packages/dashboard/src/components/SortDropdown.tsx` — interactive button + ARIA + `useState`/`useEffect` hook integration (lines 111-280).

**Patterns to copy:**
- Trigger button with explicit ARIA (`SortDropdown.tsx:218-236`)
- Local interval hook for countdown timer (analog: `setInterval` pattern in any countdown — none in codebase, but the SortDropdown's outside-click `useEffect` at lines 158-171 demonstrates the cleanup contract)
- Architecture-purity: zero imports from `src/`

**Concrete shape** (UI-SPEC.md lines 397-407 already provides the implementation; component shell mirrors `WarningPill.tsx` purity discipline):

```tsx
export interface RegenerateButtonProps {
  cooldownSeconds?: number;
  isFetching?: boolean;
  onClick: () => void;
  ariaLabel: string;
  class?: string;
}

export function RegenerateButton({ cooldownSeconds = 0, isFetching = false, onClick, ariaLabel, class: className }: RegenerateButtonProps) {
  const isDisabled = isFetching || cooldownSeconds > 0;
  const label = isFetching ? 'Regenerating…'
              : cooldownSeconds > 0 ? `Regenerate (${cooldownSeconds}s)`
              : 'Regenerate';
  return (
    <button
      type="button"
      class={`h-8 px-3 py-1 text-sm rounded border ${className ?? ''}`}
      aria-label={ariaLabel}
      aria-busy={isFetching}
      disabled={isDisabled}
      onClick={isDisabled ? undefined : onClick}
    >
      {label}
    </button>
  );
}
```

**1Hz countdown timer** — own a local `useState(now)` + `useEffect(setInterval)` cleanup pattern; UI-SPEC.md lines 397-407 specifies the exact implementation.

---

### `packages/dashboard/src/views/VersionDrawer.tsx` (MODIFIED — 3 surgical changes)

**Analog:** existing C2PA auto-fetch effect (lines 119-133) + Provenance section (lines 324-337).

**Change 1 — auto-fetch `useEffect`** (mirror lines 119-133 verbatim, swap `getC2paStatus` → `fetchSummary`):

```tsx
// Phase 19 — auto-fetch summary on version change. Same `let alive = true`
// cancellation pattern as the existing C2PA effect at lines 119-133.
useEffect(() => {
  let alive = true;
  setSummary({ state: 'loading' });
  fetchSummary(version.id)
    .then((s) => { if (alive) setSummary(s); })
    .catch(() => { if (alive) setSummary({ state: 'error' }); });
  return () => { alive = false; };
}, [version.id]);
```

**Change 2 — relocate Provenance section** (lines 324-337) into a `<details>` disclosure inside the new `<SummarySection>`:

```tsx
// BEFORE (lines 324-337):
<section>
  <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">Provenance</h3>
  {provenance.length === 0 ? (
    <EmptyState message="No provenance records" />
  ) : (
    <ul class="flex flex-col gap-2">
      {provenance.map((record, i) => (
        <li key={i}><JsonBlock data={record} /></li>
      ))}
    </ul>
  )}
</section>

// AFTER:
<SummarySection
  summary={summary}
  regenerateAvailableAtMs={regenerateAvailableAtMs}
  onRegenerate={handleRegenerate}
  versionLabel={label}
>
  <details class="mt-4">
    <summary class="cursor-pointer text-sm text-[var(--color-fg-muted)]">
      Show provenance details
    </summary>
    {provenance.length === 0 ? (
      <EmptyState message="No provenance records" />
    ) : (
      <ul class="mt-2 flex flex-col gap-2">
        {provenance.map((record, i) => (
          <li key={i}><JsonBlock data={record} /></li>
        ))}
      </ul>
    )}
  </details>
</SummarySection>
```

**Change 3 — placement** — `<SummarySection>` JSX block is inserted between the existing `<header>` and the conditional Output `<section>` (UI-SPEC.md lines 412-426 specifies the exact insertion point).

---

### `src/__tests__/architecture-purity.test.ts` (MODIFIED — 7 new assertions)

**Analog:** existing `c2pa-node` allowed-set test (lines 166-231) + per-file pure-helper guards (lines 233-309).

**Concrete pattern — copy the two-layer subset+set-equality assertion** (lines 166-231 verbatim, swap `c2pa-node` → `@anthropic-ai/sdk`):

```typescript
it('@anthropic-ai/sdk imports are centralized in src/engine/summary/anthropic-client.ts (Phase 19)', () => {
  const allowedAnthropicImporters = new Set<string>([
    'src/engine/summary/anthropic-client.ts',
  ]);
  let out = '';
  try {
    out = execFileSync(
      'grep',
      [
        '-rlE',
        "from[[:space:]]*['\"]@anthropic-ai/sdk|import[[:space:]]*\\([[:space:]]*['\"]@anthropic-ai/sdk",
        'src/',
      ],
      { encoding: 'utf8' },
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 1) throw err;
  }
  const files = out ? out.trim().split('\n').filter(Boolean) : [];
  const nonTestFiles = files.filter((f) => !f.includes('__tests__/'));
  // (a) Subset check — no rogue importer outside the allowed set.
  const violations = nonTestFiles.filter((f) => !allowedAnthropicImporters.has(f));
  expect(violations,
    `@anthropic-ai/sdk imports outside the allowed list:\n${violations.join('\n')}`,
  ).toEqual([]);
  // (b) SET-equality on actual importers (sorted-array deepEqual).
  const expectedActualImporters = ['src/engine/summary/anthropic-client.ts'].sort();
  expect([...nonTestFiles].sort()).toEqual(expectedActualImporters);
});
```

**Pure-helper file-level assertions** (mirror `manifest-builder.ts` pattern at lines 233-251) — 6 new tests, one per pure-helper file:

```typescript
// One test per pure-helper file (sanitizer, validation, template, deterministic-template,
// circuit-breaker, templates/few-shot-examples). Each asserts grepCount returns 0
// for @anthropic-ai/sdk, @modelcontextprotocol/sdk, better-sqlite3, drizzle-orm,
// and (where applicable) @hono/node-server.
it('src/engine/summary/sanitizer.ts is pure (zero anthropic/MCP/SQLite/ORM imports)', () => {
  expect(grepCount('@anthropic-ai/sdk', 'src/engine/summary/sanitizer.ts')).toBe(0);
  expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/summary/sanitizer.ts')).toBe(0);
  expect(grepCount('better-sqlite3', 'src/engine/summary/sanitizer.ts')).toBe(0);
  expect(grepCount('drizzle-orm', 'src/engine/summary/sanitizer.ts')).toBe(0);
});
// ... repeat shape for validation.ts, template.ts, deterministic-template.ts,
// circuit-breaker.ts, templates/few-shot-examples.ts.
```

**Boot-resilience guard** (mirror lines 108-127 — `src/server.ts has zero static imports from c2pa-node`):

```typescript
it('src/server.ts has zero static imports from @anthropic-ai/sdk (boot resilience)', () => {
  try {
    const out = execFileSync('grep',
      ['-E', "from[[:space:]]+['\"]@anthropic-ai/sdk['\"]", 'src/server.ts'],
      { encoding: 'utf8' });
    expect(out.trim(), `static @anthropic-ai/sdk import found in src/server.ts:\n${out}`).toBe('');
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 1) throw err;
  }
});
```

---

### `src/__tests__/summary-redact-e2e.test.ts` (NEW — e2e cache-key invariant)

**Analog:** `src/__tests__/c2pa-redaction-e2e.test.ts` — full pattern.

**Pattern:** mkdtemp + openDb + Engine + sign workflow + assert cache hit → redact via `redact_manifest` → assert different `summary_text` AND new `summary_generated` row exists. The `seedSignedV1Manifest` helper at `c2pa-redaction-e2e.test.ts:117-180` is the seed-builder shape — extend it to seed a summary cache row before the redact step.

---

### `src/__tests__/summary-leak-scan.test.ts` (NEW — multi-encoding negative test)

**Analog:** `src/__tests__/c2pa-key-leak-negative.test.ts` (negative-test scaffolding) + `c2pa-redaction-e2e.test.ts:76-92` (multi-encoding helper).

**Pattern:** inject an `ANTHROPIC_API_KEY` shaped string into the prompt blob, run summarizeVersion, then assert the cache row + log lines contain ZERO occurrences across UTF-8 / UTF-16LE / UTF-16BE / base64 encodings. The `assertNotInBuffer` helper at `c2pa-redaction-e2e.test.ts:76-92` is reusable verbatim.

---

## Shared Patterns

### Pattern A: TypedError boot-fail BEFORE Engine construction
**Source:** `src/utils/c2pa-config.ts:46-104` + `src/engine/errors.ts:64-73`
**Apply to:** `src/utils/anthropic-config.ts`, `src/engine/errors.ts` (add `ANTHROPIC_CONFIG_INVALID`, `ANTHROPIC_SDK_LOAD_FAILED`, `SUMMARY_THROTTLED`)

```typescript
throw new TypedError(
  'ANTHROPIC_CONFIG_INVALID',
  `<message — last 4 only: ****${apiKey.slice(-4)}>`,
  '<actionable hint pointing at .env.example>',
);
```

---

### Pattern B: Sole-importer + lazy-import + cached-error short-circuit
**Source:** `src/engine/c2pa/signer.ts:39-97`
**Apply to:** `src/engine/summary/anthropic-client.ts`

Verbatim shape:
- Module-scope `let module: T | null` + `let loadError: Error | null`
- `ensureSdk()` async function with cached-error guard
- `__resetXxxStateForTests()` exported test-only hook

---

### Pattern C: Multi-encoding leak scan (UTF-8 / UTF-16LE / UTF-16BE / base64)
**Source:** `src/__tests__/c2pa-redaction-e2e.test.ts:76-92`
**Apply to:** `src/engine/summary/anthropic-client.ts:flattenAnthropicError`, `src/engine/summary/sanitizer.ts:assertNoApiKeyInPayload`, `src/__tests__/summary-leak-scan.test.ts`

```typescript
const fragments = [
  secret,                                                          // UTF-8 / ASCII
  Buffer.from(secret, 'utf16le').toString('binary'),               // UTF-16LE
  Buffer.from(secret, 'utf16le').reverse().toString('binary'),     // UTF-16BE
  Buffer.from(secret).toString('base64'),                          // base64
];
for (const frag of fragments) {
  if (frag.length === 0) continue;
  // ... reject / replace / assert absent
}
```

---

### Pattern D: Append-only event row (zero UPDATE/DELETE)
**Source:** `src/store/provenance-repo.ts:203-211` + `:265-291`
**Apply to:** `src/store/provenance-repo.ts:appendSummaryGeneratedEvent` + `:getLatestSummaryGeneratedEvent`

- Always INSERT via `this.insertEvent` (never `update`/`delete`)
- Lookup uses LIMIT-bounded scan + in-memory JSON filter (LIMIT-50 default — matches `MANIFEST_SIGNED_LOOKUP_LIMIT`)
- Discriminated-union extension at the `ProvenanceEventPayload` type
- The architecture-purity `grep -E "this.db.update|this.db.delete" src/store/provenance-repo.ts` returns ZERO continues to hold

---

### Pattern E: Architecture-purity sorted-array deepEqual allowed-set
**Source:** `src/__tests__/architecture-purity.test.ts:166-231`
**Apply to:** new test block extending the allowed-set with `@anthropic-ai/sdk`

Two-layer assertion:
- **(a)** Subset check — every actual importer is in the allowed-set
- **(b)** Sorted-array deepEqual on actual importers — prevents silent regression where `anthropic-client.ts` is removed from the importer set

---

### Pattern F: Pure-helper isolation (file-level grep guard)
**Source:** `src/__tests__/architecture-purity.test.ts:233-309`
**Apply to:** 6 pure-helper tests (sanitizer, validation, template, deterministic-template, circuit-breaker, templates/few-shot-examples)

Each pure helper file: zero `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `better-sqlite3`, `drizzle-orm`, `hono` imports.

---

### Pattern G: Discriminated-outcome Engine facade
**Source:** `src/engine/pipeline.ts:1133-1395` (`Engine.signOutput` → 6+ status_reason variants)
**Apply to:** `Engine.summarizeVersion` (8-outcome `SummaryOutcome` union)

- Engine method NEVER throws to HTTP layer for failure paths
- HTTP layer surfaces typed errors ONLY for INVALID_INPUT (Zod parse / VERSION_NOT_FOUND)
- Every failure path is a typed outcome variant — caller pattern-matches on `.source`

---

### Pattern H: Dashboard auto-fetch on `version.id` with cancellation
**Source:** `packages/dashboard/src/views/VersionDrawer.tsx:119-133`
**Apply to:** new summary-fetch `useEffect` + new `summarySignal` write

```tsx
useEffect(() => {
  let alive = true;
  fetchX(version.id)
    .then((s) => { if (alive) setX(s); })
    .catch(() => { if (alive) setX(fallback); });
  return () => { alive = false; };
}, [version.id]);
```

---

### Pattern I: Discriminated state union → branched JSX render
**Source:** `packages/dashboard/src/components/C2paBadge.tsx:71-110`
**Apply to:** `packages/dashboard/src/components/SummarySection.tsx`

Pattern-match on `summary.state` ('loading' / 'success' / 'fallback' / 'error') with one branch per variant; reuse `<WarningPill/>` for fallback marker; never use `dangerouslySetInnerHTML` (T-5-06 mitigation).

---

### Pattern J: HTTP route INVALID_INPUT envelope at the boundary
**Source:** `src/http/dashboard-routes.ts:117-122` + `:286-298`
**Apply to:** `GET /api/versions/:id/summary` + `POST /api/versions/:id/summary/regenerate`

```typescript
throw new TypedError(
  '<CODE>',
  '<message>',
  '<hint>',
);
```

The `error-middleware.ts` translates to 4xx JSON envelope automatically; engine never throws to HTTP for non-input errors (see Pattern G).

---

## No Analog Found

| File | Role | Data Flow | Reason | Recommendation |
|------|------|-----------|--------|----------------|
| `src/engine/summary/circuit-breaker.ts` | engine state machine | event → state transition | No state-machine pattern exists in src/. The closest thing is the per-(versionId, filename) coalescing mutex at `pipeline.ts:299-302`, which is a different shape. | Use the RESEARCH.md §"Code Examples — Circuit Breaker" template (lines 996-1056) verbatim. Adopt the `__resetCircuitBreakerStateForTests` naming convention from `__resetC2paNodeStateForTests` in `src/engine/c2pa/signer.ts:94-97`. |
| `src/__tests__/fixtures/summary-eval/*.json` | test fixtures (golden eval) | static JSON | No prior eval-set fixture pattern in the codebase | Hand-curate 8-12 versions covering canonical lineage shapes (root, iterate, redacted, multi-LoRA, ControlNet, no-KSampler, multi-output, very-old-row) per CONTEXT.md `<discretion>`. The `seedSignedV1Manifest` helper at `c2pa-redaction-e2e.test.ts:117-180` is the closest analog for fixture builders. |

---

## Metadata

**Analog search scope:** `src/utils/`, `src/engine/`, `src/engine/c2pa/`, `src/store/`, `src/http/`, `src/__tests__/`, `packages/dashboard/src/components/`, `packages/dashboard/src/state/`, `packages/dashboard/src/views/`, `packages/dashboard/src/lib/`, `drizzle/`

**Files scanned:** ~25 (verified directly): c2pa-config.ts, signer.ts, diff-summary.ts, output-hash.ts, errors.ts, schema.ts, provenance-repo.ts, pipeline.ts, dashboard-routes.ts, architecture-purity.test.ts, c2pa-redaction-e2e.test.ts, c2pa-config.test.ts, types/provenance.ts, VersionDrawer.tsx, WarningPill.tsx, SkeletonThumbnail.tsx, C2paBadge.tsx, SortDropdown.tsx, active-generations.ts, versions.ts, lib/api.ts, drizzle/0006_phase14_manifest_signed_event.sql

**Pattern extraction date:** 2026-05-09

**Confidence:** HIGH — Phase 14 (`c2pa-node`) is a near-perfect template for Phase 19 (`@anthropic-ai/sdk`) discipline. The single gap (circuit-breaker state machine) is filled by the RESEARCH.md template. All extracted excerpts are verified by direct file read; no patterns inferred from documentation.
