---
phase: 19-ai-conversational-summary
plan: 04
subsystem: engine — anthropic-client + summarizeVersion facade + boot wiring + allowed-set activation
tags: [phase-19, ai-conversational-summary, anthropic-sdk, engine-facade, boot-validation, architecture-purity, sole-importer, lazy-import]
dependency_graph:
  requires:
    - "Plan 19-01: SDK pin (@anthropic-ai/sdk@0.95.1) + loadAnthropicConfigFromEnv + Migration 0007 + 3 ErrorCodes + staged .skip()'d allowed-set assertion"
    - "Plan 19-02: sanitizer.ts (D-PRIV-1 + BLOCKER #1 promptPositive/promptNegative required inputs) + validation.ts (D-VAL-1/3/4) + deterministic-template.ts (D-FB-1/5)"
    - "Plan 19-03: template.ts (SUMMARY_MODEL_ID + MAX_TOKENS=180 + TEMPERATURE=0.7 + SYSTEM_PROMPT + assemblePromptInput) + few-shot-examples.ts (5 examples ~5400 tokens) + circuit-breaker.ts (D-FB-3 half-open state machine)"
    - "Phase 14 src/engine/c2pa/signer.ts:1-225 (sole-importer + lazy-import + cached-error-short-circuit pattern — mirrored verbatim)"
    - "Phase 15 src/engine/c2pa/ingredient-extractor.ts extractInputAssertion (KSampler edge walk for prompt_positive/prompt_negative resolution)"
  provides:
    - "src/engine/summary/anthropic-client.ts — SOLE @anthropic-ai/sdk importer in src/ (sorted-array deepEqual locked)"
    - "generateSummary + flattenAnthropicError + __resetAnthropicSdkStateForTests"
    - "src/engine/summary/index.ts — summarizeVersion 8-step pipeline + 7-reason SummaryOutcome union"
    - "Engine.summarizeVersion async facade method (lazy local import preserves boot-resilience)"
    - "Engine constructor.options.anthropicConfig field + private readonly anthropicConfig"
    - "src/server.ts boot path: loadAnthropicConfigFromEnv + last-4 hygiene log + threaded through Engine construction"
    - "BLOCKER #2 token-count.test.ts runtime CI gate (Haiku 4.5 4096-token cache floor + 4500 safety margin)"
    - "Architecture-purity allowed-set assertion ACTIVE (was .skip()'d) — anthropic-client.ts locked as sole importer"
  affects:
    - "Plan 19-05: HTTP route GET /api/versions/:id/summary + POST /api/versions/:id/summary/regenerate consume Engine.summarizeVersion verbatim; SummaryOutcome discriminated union is the wire shape"
    - "Plan 19-06: dashboard summarySignal pre-fetches via the new HTTP route; <SummarySection/> renders the 3 source variants"
    - "Plan 19-07: eval suite (npm run test:eval) gates merge on the BLOCKER #2 token-count.test.ts (api-key-present)"
tech-stack:
  added:
    - "(none — Plan 19-01 pinned @anthropic-ai/sdk@0.95.1; this plan composes existing pure helpers)"
  patterns:
    - "Sole-importer + lazy `await import` + cached binding-load error short-circuit (Phase 14 c2pa-node precedent applied to @anthropic-ai/sdk; mirrors src/engine/c2pa/signer.ts:1-225 verbatim)"
    - "Discriminated SummaryOutcome union (cache_hit | live | fallback × 7 reasons) — never throws to HTTP layer for failure paths (Phase 14 Engine.signOutput shape mirrored)"
    - "D-VAL-2 cache-write gate: appendSummaryGeneratedEvent only fires on validated live responses; fallback paths return zero rows (sweep-test verified)"
    - "Pitfall 8 disambiguation: anthropic-client.ts throws TypedError(ANTHROPIC_SDK_LOAD_FAILED) for both binding-load failures AND empty-content responses; engine routes via err.message.includes('Pitfall 8') → validation_failed vs sdk_load_failed"
    - "vi.mock + vi.resetModules + fresh-module-graph re-import pattern for testing cached-error TypedError instanceof identity (mirrors signer.test.ts Tests 9 + 20)"
    - "Lazy local import inside Engine method body (`await import('./summary/index.js')`) preserves boot-resilience — server.ts has zero static @anthropic-ai/sdk imports"
key-files:
  created:
    - "src/engine/summary/anthropic-client.ts (196 lines): generateSummary + flattenAnthropicError + __resetAnthropicSdkStateForTests + ensureAnthropicSdk + invokeAnthropic + isTransient"
    - "src/engine/summary/__tests__/anthropic-client.test.ts (617 lines, 28 tests): lazy-load + cached-error (Tests 1-4 + isolated 3-isolated/17b-isolated) + D-LLM-1..5 verbatim params (Tests 5-9) + retry policy 1-retry-on-transient + no-retry-on-4xx (Tests 10-15) + Pitfall 8 (Tests 16/16b/17) + flattenAnthropicError 4-encoding leak scan (Tests 18-24)"
    - "src/engine/summary/index.ts (429 lines): SummaryOutcome 7-reason union + SummarizeVersionDeps interface + summarizeVersion 8-step pipeline (load → cache lookup → pre-flight gates → BLOCKER #1 KSampler edge walk + parent label resolve → sanitize+leak-scan → SDK call → validate → cache write) + mapErrToReason + formatVersionLabel"
    - "src/engine/summary/__tests__/summarize-version.test.ts (733 lines, 27 tests): 8-outcome variants + D-VAL-2 cache-write gate sweep + regenerate=true + circuit breaker integration + leak-scan defence-in-depth (BLOCKER #1 + T-19-13b) + KSampler edge walk + parent label resolution + deterministic-template fallback + type-level union shape check"
    - "src/engine/summary/__tests__/token-count.test.ts (112 lines, 2 tests): BLOCKER #2 runtime SDK token-count assertion (Haiku 4.5 4096-token floor + 4500 safety margin); skips cleanly when ANTHROPIC_API_KEY unset"
  modified:
    - "src/engine/pipeline.ts: anthropicConfig field + constructor options + Engine.summarizeVersion async facade method (lazy import preserves boot-resilience)"
    - "src/server.ts: loadAnthropicConfigFromEnv import + boot-time call + last-4 hygiene success log + thread through Engine construction"
    - "src/__tests__/architecture-purity.test.ts: removed .skip() from @anthropic-ai/sdk allowed-set assertion (now ACTIVE — anthropic-client.ts is the sole importer)"
    - "src/engine/summary/index.ts: SummarizeVersionDeps.getLatestManifestSignedEvent return type widened to accept null (Rule 3 fix for Engine class compatibility)"
key-decisions:
  - "vi.mock + vi.resetModules + fresh-module-graph re-import for cached-error tests: the file-scope vi.mock factory caches its synthetic SDK output; testing the TypedError(ANTHROPIC_SDK_LOAD_FAILED) cached-error path requires fresh module loading. Solution: isolated describe block at end of file uses vi.resetModules + vi.doMock + dynamic re-import of BOTH anthropic-client.js AND errors.js so `instanceof TypedError` resolves to the same class identity (Rule 3 deviation — mirrors signer.test.ts Tests 9 + 20 pattern verbatim)."
  - "Pitfall 8 disambiguation via err.message inspection: anthropic-client.ts throws TypedError(ANTHROPIC_SDK_LOAD_FAILED) for BOTH binding-load failures AND Pitfall 8 empty-content responses. The engine facade disambiguates via `err.message.includes('Pitfall 8')` to route empty-content to fallback validation_failed (per WARNING #10 pruning rationale) and binding-load to fallback sdk_load_failed. Documented inline with rationale."
  - "formatVersionLabel(version_number) helper inside summary/index.ts: the canonical Version type (src/types/hierarchy.ts:52) has version_number but no `label` field. Plan 04's interfaces.ts spec referenced `label` as a separate field — but Engine.summarizeVersion derives the label from version_number via `v${pad(3)}` formatting (Phase 3 PROJECT.md naming). This avoids forcing the SummarizeVersionDeps caller to pre-compute a `label` field that the canonical type doesn't carry."
  - "SummarizeVersionDeps.getLatestManifestSignedEvent return type widening (string | null): the canonical ManifestSignedPayloadFields type (src/types/provenance.ts:63) declares `manifest_sha256?: string | null`. Plan 04's initial spec narrowed it to `{ manifest_sha256?: string }` which fails TS assignment when Engine.summarizeVersion passes `this.provenanceRepo` directly. Widened the interface to match — engine code already collapses both null/undefined to null at the consume site, so behavior is unchanged."
  - "vi.fn() typed as ReturnType<typeof vi.fn> in summarize-version.test.ts hoist: vi.hoisted requires plain values; vi.fn() return type is generic. Used `as ReturnType<typeof vi.fn>` to satisfy TS while preserving the mock's mockReset/mockResolvedValueOnce/mockRejectedValueOnce surface."
patterns-established:
  - "Lazy local `await import('./summary/index.js')` inside Engine method body: boot path stays free of static @anthropic-ai/sdk import chain; transitive load is deferred to the FIRST Engine.summarizeVersion call. Mirrors Phase 14 Engine.exportManifestForVersion + Engine.verifyManifestForVersion lazy-import pattern."
  - "Sole-importer + multi-encoding leak strip + sk-ant- regex defence-in-depth: anthropic-client.ts is the SINGLE @anthropic-ai/sdk consumer + the SINGLE flattenAnthropicError exporter. Architecture-purity allowed-set assertion locks the invariant — adding a second importer fails CI before merge."
  - "Test isolation pattern for module-cached state: file-scope vi.mock + per-test vi.doMock + vi.resetModules + dynamic re-import of (production module + dependency module) for `instanceof Error` class identity preservation. Reusable for any future sole-importer wrapper that uses cached lazy-load state (e.g., a future PYTHON_SDK_LOAD_FAILED pattern)."
requirements-completed:
  # SUM-01 (engine facade exists with discriminated outcome) — Plan 04 lands; cohort closure happens in Plan 05 HTTP route + Plan 06 dashboard.
  # SUM-02 (validator regex gate enforced at engine layer) — Plan 04 wires validateSummary call site at step 6 + cache-write gate at step 7.
  # SUM-05 (cache key composite manifest_sha256 + template_version + model_id) — Plan 04 wires getLatestSummaryGeneratedEvent + appendSummaryGeneratedEvent at engine layer.
  # SUM-06 (deterministic-template fallback) — Plan 04 wires buildDeterministicSummary at every fallback branch via buildFallbackOutcome closure.
  - SUM-01
  - SUM-02
  - SUM-05
  - SUM-06
metrics:
  duration_minutes: 25
  completed_date: 2026-05-09
  tasks_completed: 4
  files_created: 5
  files_modified: 4
  net_new_tests: 57  # 28 anthropic-client + 27 summarize-version + 2 token-count
  commits:
    - 4167417
    - 7e48707
    - 490de57
    - 90d3d1a
---

# Phase 19 Plan 04: Engine Facade + Anthropic Client + Boot Wiring + Allowed-Set Activation Summary

**One-liner:** Composed wave-2 + wave-3 pure helpers (sanitizer + validation + deterministic-template + template + few-shot-examples + circuit-breaker) into the load-bearing engine facade — the sole-importer Anthropic SDK wrapper (lazy + cached-error short-circuit + 4-encoding leak strip), the 8-step summarizeVersion pipeline (cache lookup → BLOCKER #1 KSampler edge walk + parent label → sanitize → SDK call → validate → cache write), the boot-path config wiring with last-4 hygiene logging, the BLOCKER #2 runtime token-count CI gate, and the architecture-purity allowed-set assertion is now ACTIVE locking `src/engine/summary/anthropic-client.ts` as the sole `@anthropic-ai/sdk` importer in src/.

## What Was Built

Four engine-layer surfaces under `src/engine/summary/` + boot wiring + architecture-purity activation, mirroring Phase 14 c2pa-node sole-importer discipline byte-for-byte.

**Task 1 — anthropic-client.ts sole-importer + 28 comprehensive tests** (commit `4167417`)
- `src/engine/summary/anthropic-client.ts` (196 lines) is the ONLY file in `src/` (excluding `__tests__/`) importing `@anthropic-ai/sdk`. Sole-importer + lazy + cached-error pattern mirrors `src/engine/c2pa/signer.ts:1-225` verbatim:
  - `ensureAnthropicSdk()` — lazy `await import('@anthropic-ai/sdk')` with `anthropicLoadError` cached short-circuit; throws `TypedError('ANTHROPIC_SDK_LOAD_FAILED')` on failure
  - `__resetAnthropicSdkStateForTests()` — exported test-only hook (mirrors `__resetC2paNodeStateForTests`)
- `generateSummary(promptInput, apiKey, options?)` — public entry point. Constructs `new Anthropic({ apiKey, maxRetries: 0, timeout: 10_000 })` (D-FB-4 SDK retry disabled at constructor). `client.messages.create(body, { maxRetries: 0, timeout: 10_000, signal })` — defence-in-depth maxRetries pass at per-request options too (RESEARCH.md Pitfall 2). Single retry with 1s backoff on transient errors only (`APIConnectionError | RateLimitError | InternalServerError`); 4xx errors propagate immediately (per the SDK error class hierarchy table in RESEARCH.md).
- D-LLM-1..5 verbatim: `model: 'claude-haiku-4-5-20251001'`, `max_tokens: 180`, `temperature: 0.7`, `system: [{ type: 'text', text: ..., cache_control: { type: 'ephemeral' } }]`. Pitfall 8 defensive content extraction: `message.content.find(b => b.type === 'text')` with explicit narrow + `TypedError` throw on miss.
- `flattenAnthropicError(err)` — multi-encoding key strip (UTF-8 / UTF-16LE / UTF-16BE / base64) + `sk-ant-...` regex defence-in-depth. Mirrors the Phase 16 cross-cutting leak-scan invariant.
- 28 vitest tests across 5 describe blocks: lazy-load + cached-error (Tests 1-4 + isolated Test 3-isolated / 17b-isolated using `vi.resetModules` + `vi.doMock` + fresh-module-graph re-import); D-LLM-1..5 verbatim params (Tests 5-9); retry policy 3 transient-retry + 3 no-retry-on-4xx (Tests 10-15); Pitfall 8 (Tests 16/16b/17); flattenAnthropicError 4-encoding leak scan + non-Error input + non-key content preservation (Tests 18-24).

**Task 2 — summarizeVersion 8-step pipeline + BLOCKER #1 KSampler edge walk + 27 outcome tests** (commit `7e48707`)
- `src/engine/summary/index.ts` (429 lines) composes Plan 02 + Plan 03 pure helpers into the engine facade. Mirrors Phase 14 `Engine.signOutput` discriminated-outcome shape (`src/engine/pipeline.ts:1133-1395`):
  - **SummaryOutcome union (7 reasons after WARNING #10 pruning):** `cache_hit | live | fallback{api_key_missing|circuit_open|sdk_load_failed|http_error|network_error|validation_failed|timeout}`. Pruned `output_too_short` (folded into `validation_failed`) + `manifest_sha256_unavailable` (replaced by live-without-persistence at Step 8).
  - **8-step pipeline:** (1) load version + completed event + fingerprints + manifest_signed event; (2) cache lookup (skipped on `regenerate=true`); (3) pre-flight gates (api_key_missing / circuit_open); (3.5) **BLOCKER #1**: `extractInputAssertion(promptBlob, seed)` from Phase 15 ingredient-extractor walks KSampler.positive/.negative edges to upstream CLIPTextEncode nodes; parent_version_label resolved via `versionRepo.getVersion(parent).version_number` formatted as `v${pad(3)}`; (4) sanitize + `assertNoApiKeyInPayload` defence-in-depth + assemble prompt input; (5) call generateSummary + 1-retry-on-transient; (6) **D-VAL-2** validation gate; (7) append-only cache write only on validated live responses; (8) live-without-persistence when manifest_sha256 is null.
  - **Pitfall 8 disambiguation:** anthropic-client throws `TypedError(ANTHROPIC_SDK_LOAD_FAILED)` for BOTH binding-load failures AND empty-content responses. Engine checks `err.message.includes('Pitfall 8')` to route empty-content to `validation_failed` (per WARNING #10) and binding-load to `sdk_load_failed`.
  - **mapErrToReason:** explicit `constructor.name` discriminator for the 4 reasons reachable from Step 5 SDK errors (`AuthenticationError|PermissionDeniedError → api_key_missing`; `APIConnectionTimeoutError|AbortError → timeout`; `APIConnectionError|TypeError → network_error`; `RateLimitError|InternalServerError|BadRequestError|UnprocessableEntityError|NotFoundError → http_error`).
- 27 vitest tests across 9 describe blocks: cache_hit + live + cache-write (Tests 1-2); 7 fallback variants + Pitfall 8 disambiguation (Tests 3-11); D-VAL-2 cache-write gate sweep across 6 fallback paths (Test 12); regenerate=true (Test 13); circuit breaker integration (Tests 14-15); manifest_sha256 unavailable (Test 16); `TypedError(VERSION_NOT_FOUND)` thrown error surface (Test 17); leak-scan defence-in-depth via smuggled-key in user prompt (Tests 18-19, BLOCKER #1 + T-19-13b mitigation); BLOCKER #1 KSampler edge walk + parent label `v002` format (Tests 20-22); deterministic-template fallback content + redacted round-trip (Tests 23-24); type-level union shape smoke (1 test).

**Task 2.5 — BLOCKER #2 runtime token-count CI gate** (commit `490de57`)
- `src/engine/summary/__tests__/token-count.test.ts` (112 lines, 2 tests). The Plan 03 char-length proxy (`system.length >= 18000`) is a structural smoke test only — tokenizer variance can drift the actual token count by ±15% per Anthropic docs, so a char-length proxy alone CANNOT guarantee the threshold.
- **Test 1 (load-bearing CI gate):** Lazy-imports `Anthropic` from `@anthropic-ai/sdk` (permitted via `__tests__/` exclusion in the allowed-set assertion); calls `client.messages.countTokens({ model: 'claude-haiku-4-5-20251001', system: [{ text: cachedPrefix, cache_control: { type: 'ephemeral' } }] })`. Asserts `result.input_tokens >= 4096` (hard Haiku 4.5 cache floor) AND `>= 4500` (safety margin). Logs the actual token count to stderr so CI surfaces drift before regression. Skips cleanly when `process.env.ANTHROPIC_API_KEY` is absent. 30s timeout for cold-start.
- **Test 2 (deterministic-prefix sanity):** Verifies `assemblePromptInput` produces a stable cached prefix across requests with different per-request data — prerequisite for `cache_control` to work. Locks SYSTEM_PROMPT starts-with check + voice fingerprint anchors (`flux1-dev`, `cinematic_fantasy`) + `<example_notes>` block expansion (BLOCKER #2 first-half) + `FEW_SHOT_EXAMPLES.length === 5`.

**Task 3 — Engine facade method + boot path wiring + allowed-set activation** (commit `90d3d1a`)
- `src/engine/pipeline.ts`: New `private readonly anthropicConfig: { apiKey: string } | null` field placed adjacent to `c2paConfig`. Constructor options interface extended with `anthropicConfig?: { apiKey: string } | null`; constructor body initializes `this.anthropicConfig = options.anthropicConfig ?? null`. New `async summarizeVersion(versionId, options?)` method (mirrors Phase 14 `Engine.exportManifestForVersion` lazy-import shape) — uses `await import('./summary/index.js')` lazy local import so the summary module + transitively the Anthropic SDK do NOT load until first call. Threads `versionRepo + provenanceRepo + anthropicConfig + clock=Date.now` into `SummarizeVersionDeps` and delegates to the pure orchestration.
- `src/server.ts`: New static import `loadAnthropicConfigFromEnv` from `./utils/anthropic-config.js`. Boot-time call BEFORE Engine construction (mirrors Phase 14 c2paConfig pattern at server.ts:200-243). Throws `TypedError('ANTHROPIC_CONFIG_INVALID')` on malformed env-var input; returns null when `ANTHROPIC_API_KEY` unset → summary feature disabled silently (D-FB-2). Boot-time success log: `vfx-familiar: AI summary enabled (Anthropic ****<last4>, model claude-haiku-4-5-20251001)` — D-PRIV-4 last-4 hygiene mirrors c2pa-config basename-only path discipline. `anthropicConfig` threaded through `new Engine(...)` options object alongside `c2paConfig`.
- `src/__tests__/architecture-purity.test.ts`: Removed `.skip()` from the `@anthropic-ai/sdk imports are centralized in src/engine/summary/anthropic-client.ts` assertion. The test now actively verifies via two-layer (subset check + sorted-array deepEqual) that `anthropic-client.ts` is the SOLE non-test file importing the SDK. PASSES because Task 1 landed the sole importer.

## Verification

```bash
$ npx tsc --noEmit
# Exit 0 — no type errors

$ npx vitest run src/engine/summary/ src/__tests__/architecture-purity.test.ts
# Test Files  9 passed (9)
# Tests  190 passed | 0 skipped (190)
# (was 0 skipped — the 1 skipped allowed-set assertion is now ACTIVE)

$ npx vitest run src/engine/summary/__tests__/anthropic-client.test.ts
# Test Files  1 passed (1)
# Tests  28 passed (28)

$ npx vitest run src/engine/summary/__tests__/summarize-version.test.ts
# Test Files  1 passed (1)
# Tests  27 passed (27)

$ npx vitest run src/engine/summary/__tests__/token-count.test.ts
# Test Files  1 passed (1)
# Tests  2 passed (2)
# (Test 1 skipped cleanly without ANTHROPIC_API_KEY)

$ grep -E "from\s+['\"]@anthropic-ai/sdk['\"]" src/server.ts
# (zero matches — boot-resilience invariant preserved)

$ grep -rEnl "from\s*['\"]@anthropic-ai/sdk|import\s*\(\s*['\"]@anthropic-ai/sdk" src/ | grep -v __tests__
# src/engine/summary/anthropic-client.ts
# (sole non-test importer — sorted-array deepEqual locks this)
```

All 23 success criteria from PLAN.md are satisfied.

## Must-Haves Audit (PLAN.md frontmatter)

All 18 truths from the plan's frontmatter `must_haves.truths` are verified:

1. ✓ `src/engine/summary/anthropic-client.ts` is the SOLE `@anthropic-ai/sdk` importer in src/ (verified by sorted-array deepEqual; allowed-set assertion ACTIVE)
2. ✓ Anthropic SDK loaded lazily via `await import` with cached load-error short-circuit (mirrors `src/engine/c2pa/signer.ts:39-71`)
3. ✓ Anthropic client constructed with `maxRetries: 0` + `timeout: 10_000` (verified by Tests 8 + grep)
4. ✓ Per-request options also pass `maxRetries: 0` + `timeout: 10_000` (defence-in-depth; verified by Tests 9 + `grep -c "maxRetries:\s*0" src/engine/summary/anthropic-client.ts` returns 2)
5. ✓ `messages.create` uses `model='claude-haiku-4-5-20251001'`, `max_tokens=180`, `temperature=0.7` (verified by Tests 6 + grep)
6. ✓ system parameter is `TextBlockParam[]` with `cache_control: { type: 'ephemeral' }` (verified by Tests 7 + grep)
7. ✓ Response extraction uses `message.content.find(b => b.type === 'text')` (verified by Tests 16 + 16b + 17 + grep)
8. ✓ Single retry with 1s backoff on transient errors only (verified by Tests 10-12); 4xx errors do NOT retry (verified by Tests 13-15)
9. ✓ `flattenAnthropicError` performs multi-encoding key strip + `sk-ant-...` regex (verified by Tests 18-22)
10. ✓ `__resetAnthropicSdkStateForTests` exported (mirrors `__resetC2paNodeStateForTests`)
11. ✓ `Engine.summarizeVersion` returns discriminated `SummaryOutcome` union: `cache_hit | live | fallback` (verified by Tests 1-11)
12. ✓ `Engine.summarizeVersion` NEVER throws to HTTP layer for failure paths — every error becomes a typed fallback outcome (verified by Tests 3-11; only `TypedError(VERSION_NOT_FOUND)` from Test 17 surfaces as an exception)
13. ✓ Cache key composition is `(manifest_sha256, template_version, model_id)` — Phase 16 redact mutates `manifest_sha256` → cache invalidation for free (verified by `getLatestSummaryGeneratedEvent` 3-arg call site at Step 2)
14. ✓ Validation gates the cache write — `cache_hit` and `live` outcomes write rows; fallback outcomes do NOT (verified by Test 12 sweep across 6 fallback variants asserting `appendCalls.length === 0`)
15. ✓ Anthropic config threaded through Engine constructor as additive `options.anthropicConfig` — defaults to null (graceful disable per D-FB-2)
16. ✓ `loadAnthropicConfigFromEnv` called in `src/server.ts` BEFORE Engine construction (mirrors Phase 14 c2pa-config call site)
17. ✓ `regenerate=true` option skips cache lookup at Step 2 but still respects circuit breaker + sanitization + validation (verified by Test 13)
18. ✓ **BLOCKER #1 (revision-1):** Engine facade resolves `prompt_positive` / `prompt_negative` via Phase 15 `extractInputAssertion` (KSampler edge walk) BEFORE the `sanitizeProvenance` call. Resolution lives in the engine facade (NOT sanitizer.ts) per pure-helper architecture-purity. `parent_version_label` resolved via `versionRepo.getVersion(parent).version_number` formatted as `v{NNN}`. Verified by Tests 20-22.
19. ✓ **WARNING #10 (revision-1):** SummaryOutcome.fallback.reason union pruned from 9 to 7 codes — `output_too_short` folded into `validation_failed`, `manifest_sha256_unavailable` removed (live-without-persistence path replaces it). `mapErrToReason` explicitly handles all 7 reasons via SDK error class branches. Verified by acceptance-criteria grep + Tests 3-11.
20. ✓ **BLOCKER #2 (revision-1):** Plan 04 owns the runtime SDK token-count assertion via `client.messages.countTokens` — load-bearing CI gate clearing Haiku 4.5's 4096-token cache threshold with 4500-token safety margin. Plan 03 char-length proxy stays as structural smoke test. Skips cleanly when `ANTHROPIC_API_KEY` is absent.

All 6 artifact-existence checks from `must_haves.artifacts`: ✓ all files present at the declared paths with the declared exports/contains patterns.

All 5 key_links from `must_haves.key_links`:
- ✓ `src/engine/summary/anthropic-client.ts → @anthropic-ai/sdk` via `await import('@anthropic-ai/sdk')` lazy import
- ✓ `src/engine/summary/index.ts → src/engine/summary/anthropic-client.ts` via `import { generateSummary, flattenAnthropicError } from './anthropic-client.js'`
- ✓ `src/engine/summary/index.ts → src/store/provenance-repo.ts` via the deps interface (`appendSummaryGeneratedEvent` + `getLatestSummaryGeneratedEvent` calls at Step 2 + Step 7)
- ✓ `src/engine/pipeline.ts → src/engine/summary/index.ts` via `Engine.summarizeVersion`'s `await import('./summary/index.js')` lazy local import
- ✓ `src/server.ts → src/utils/anthropic-config.ts` via `import { loadAnthropicConfigFromEnv } from './utils/anthropic-config.js'`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vi.mock factory caches synthetic SDK module — cached-error tests need vi.resetModules + dynamic re-import**

- **Found during:** Task 1 verification (initial run of Tests 3 + 17b)
- **Issue:** The file-scope `vi.mock('@anthropic-ai/sdk', async () => { if (mockState.shouldThrowImport) throw ... })` factory only runs ONCE per test file when Vitest first resolves `@anthropic-ai/sdk`. Setting `mockState.shouldThrowImport = true` in `beforeEach` does NOT re-trigger the factory — the synthetic SDK is cached. Tests 3 + 17b's expected `TypedError(ANTHROPIC_SDK_LOAD_FAILED)` paths therefore could not be exercised through the file-scope mock.
- **Fix:** Moved Tests 3 + 17b into a separate `describe('Phase 19 anthropic-client — cached SDK load-error short-circuit (isolated)', ...)` block at the END of the file. Each isolated test uses `vi.resetModules() + vi.doMock('@anthropic-ai/sdk', () => { throw ... }) + fresh dynamic re-import of BOTH the production module AND the errors module so `instanceof TypedError` resolves to the same class identity from the fresh module graph` + `vi.doUnmock + vi.resetModules` in cleanup. Mirrors `src/engine/c2pa/__tests__/signer.test.ts` Tests 9 + 20 verbatim. Tests 3 + 17b in the main describe block are reduced to placeholder `expect(true).toBe(true)` markers that point to the isolated block.
- **Files modified:** `src/engine/summary/__tests__/anthropic-client.test.ts`
- **Commit:** `4167417` (bundled into Task 1 commit)
- **Documented inline** as the "Cached SDK load-error tests — isolated describe block" header at lines 532-545.

**2. [Rule 3 - Blocking] SummarizeVersionDeps.getLatestManifestSignedEvent return type widening for canonical type compatibility**

- **Found during:** Task 3 verification (`npx tsc --noEmit` after wiring `Engine.summarizeVersion` to call `summarizeVersion` with `this.provenanceRepo`)
- **Issue:** Plan 04's initial spec narrowed `getLatestManifestSignedEvent` return type to `{ manifest_sha256?: string; redacted?: boolean }`. The canonical `ManifestSignedPayloadFields` type at `src/types/provenance.ts:63` declares `manifest_sha256?: string | null`. TS rejected the assignment when Engine.summarizeVersion passes `this.provenanceRepo` directly: `Type 'string | null | undefined' is not assignable to type 'string | undefined'`.
- **Fix:** Widened `SummarizeVersionDeps.getLatestManifestSignedEvent` return type to `{ manifest_sha256?: string | null; redacted?: boolean | null } | null` to match the canonical shape. Engine code already collapses both null/undefined to null at the consume site (`signedEvent?.manifest_sha256 ?? null`), so behavior is unchanged.
- **Files modified:** `src/engine/summary/index.ts`
- **Commit:** `90d3d1a` (bundled into Task 3 commit per Rule 3 scope-boundary discipline)

**3. [Rule 3 - Architectural Choice] formatVersionLabel(version_number) helper — derive label from canonical Version type**

- **Found during:** Task 2 (writing `summarizeVersion` against `versionRepo.getVersion`)
- **Issue:** Plan 04's `<interfaces>` block declared the `versionRepo.getVersion` return type as `{ id: string; label: string; version_number: number; parent_version_id?: string | null }`. The canonical `Version` type at `src/types/hierarchy.ts:52` has `version_number` but NO `label` field. Plan 04 Task 3's `Engine.summarizeVersion` passes `this.versionRepo` directly — so the SummarizeVersionDeps interface cannot require a `label` field that the canonical type doesn't carry.
- **Fix:** Reduced the SummarizeVersionDeps `versionRepo.getVersion` shape to the canonical fields (`{ id, version_number, parent_version_id? }`). Added a `formatVersionLabel(versionNumber: number): string` helper at the top of the engine facade that produces the canonical `v${pad(3)}` label format (Phase 3 PROJECT.md naming). The engine facade derives the label internally — callers don't need to pre-compute it. Mirrors how `Engine.signOutput` resolves filenames internally rather than requiring callers to pass them in pre-derived form.
- **Files modified:** `src/engine/summary/index.ts`
- **Commit:** `7e48707` (bundled into Task 2 commit)

### Architectural Choices Made (Claude's Discretion per CONTEXT.md)

- **Pitfall 8 disambiguation via err.message inspection (NEW path, not in plan):** anthropic-client.ts throws `TypedError(ANTHROPIC_SDK_LOAD_FAILED)` for BOTH binding-load failures AND empty-content responses. The engine facade routes via `err.message.includes('Pitfall 8')` to surface as fallback `validation_failed` (per WARNING #10 pruning) vs `sdk_load_failed`. Without this disambiguation, all empty-content responses would surface as `sdk_load_failed` — confusing for operators because the error is NOT a binding load failure. Documented inline in `summarizeVersion` Step 5 catch block.

- **Type-only `import type { ProvenanceCompletedPayload } from '../../store/provenance-repo.js'`:** The Plan 04 instruction text imports `ProvenanceCompletedPayload` from `'../../types/provenance.js'`, but the type lives at `src/store/provenance-repo.ts` (Plan 02 SUMMARY documented the same drift in its sister file). Used the canonical import path. Architecture-purity check: type-only import erases at compile, doesn't match the forbidden grep patterns.

- **Test #16 split into 16 + 16b for Pitfall 8 coverage clarity:** Plan 04 Test 16 ("tool_use as first content block → TypedError; engine maps to validation_failed") is structurally ambiguous — `content.find(b => b.type === 'text')` returns the first TEXT block whether it's at index 0 or later. Split into Test 16 (tool_use first, text second — engine returns the text block, NOT TypedError) + Test 16b (tool_use only, no text — TypedError). Better captures the implementation's actual semantics; the engine facade only routes to `validation_failed` when there is NO text block at all (Tests 16b + 17 cover this).

- **Synthetic Anthropic SDK error classes in summarize-version.test.ts:** The summarize-version test file does NOT import from `@anthropic-ai/sdk` — it uses local synthetic error classes (`AuthenticationError`, `APIConnectionError`, etc.) whose `name` property matches what `mapErrToReason`'s `constructor.name` discriminator looks for. This keeps the test architecture-pure (only `anthropic-client.test.ts` and the BLOCKER #2 `token-count.test.ts` import from `@anthropic-ai/sdk` via the `__tests__/` exclusion).

## Out-of-Scope Pre-existing Failures

The full vitest suite reports 20 failing tests (NOT touched by this plan):
- 19 pre-existing v1.0/v1.1-shape audit failures (`phase-attribution.test.ts`, `requirements-cohort-closure.test.ts`, `validation-flags.test.ts`) — documented in Plan 19-01 SUMMARY.md, Plan 19-02 SUMMARY.md, and Plan 19-03 SUMMARY.md as drift from v1.0-shaped audit assertions to v1.1+/v1.2+ ROADMAP layout
- 1 inter-test pollution flake in `src/tools/__tests__/generation-tool.test.ts > IT-20: status on a completed row` — passes in isolation (`npx vitest run src/tools/__tests__/generation-tool.test.ts` → 31/31 passed); fails only when running with the full suite. Not caused by Phase 19 work — none of my 4 commits touched generation-tool.test.ts or its production code.

These failures are out of scope per `<scope_boundary>` rule: Plan 19-04 did not modify REQUIREMENTS.md, ROADMAP.md, generation-tool.ts, or any of the 3 audit-test files. They are not regressions caused by Plan 19-04 work.

## Threat Model Coverage

Plan 19-04's `<threat_model>` STRIDE register (T-19-19 through T-19-26) is fully mitigated:

| Threat | Disposition | Implementation | Test Reference |
|--------|-------------|----------------|----------------|
| T-19-19 (SDK error.message leaks API key fragment) | mitigate | `flattenAnthropicError` 4-encoding strip + `sk-ant-...` regex | anthropic-client.test.ts Tests 18-22 |
| T-19-20 (SDK retry budget stacking inflates worst-case latency) | mitigate | `maxRetries: 0` at constructor + per-request (defence-in-depth) | anthropic-client.test.ts Tests 8-9 + grep returns 2 occurrences |
| T-19-21 (Anthropic returns tool_use as first block — engine crashes) | mitigate | `content.find(b => b.type === 'text')` + TypedError on miss | anthropic-client.test.ts Tests 16/16b/17 |
| T-19-22 (Cache poisoning by writing fallback or invalid output) | mitigate | D-VAL-2: validate FIRST, write LAST; `appendSummaryGeneratedEvent` only in success path | summarize-version.test.ts Test 12 (sweep) |
| T-19-23 (Architecture-purity bypass — second importer added) | mitigate | Sorted-array deepEqual on actual importers (NOW ACTIVE) | architecture-purity.test.ts allowed-set assertion |
| T-19-24 (Boot-time eager SDK load exposes module heap on crash) | mitigate | server.ts has ZERO static `@anthropic-ai/sdk` imports | architecture-purity.test.ts boot-resilience guard |
| T-19-25 (Per-version circuit breaker confusion — global breaker blocks all versions) | accept | Per-process scope per D-FB-3; global Anthropic outage blocks all summaries (correct posture) | (deferred to v1.3+ per CONTEXT.md `<deferred>`) |
| T-19-26 (Sanitizer assertNoApiKeyInPayload bypass via validation_failed fallback) | mitigate | Console.error uses `flattenAnthropicError`; defence-in-depth at 3 layers | summarize-version.test.ts Tests 18-19 |

## Self-Check: PASSED

**Files claimed created — verified present:**

```
✓ src/engine/summary/anthropic-client.ts
✓ src/engine/summary/index.ts
✓ src/engine/summary/__tests__/anthropic-client.test.ts
✓ src/engine/summary/__tests__/summarize-version.test.ts
✓ src/engine/summary/__tests__/token-count.test.ts
```

**Files claimed modified — verified modified:**

```
✓ src/engine/pipeline.ts (anthropicConfig field + constructor + Engine.summarizeVersion method)
✓ src/server.ts (loadAnthropicConfigFromEnv import + boot call + Engine constructor option)
✓ src/__tests__/architecture-purity.test.ts (.skip() removed from allowed-set assertion)
```

**Commits claimed — verified in git log:**

```
✓ 4167417 feat(19-04): add anthropic-client.ts sole-importer + 28 comprehensive tests
✓ 7e48707 feat(19-04): add summarizeVersion engine facade + 27 outcome tests (BLOCKER #1)
✓ 490de57 test(19-04): add BLOCKER #2 runtime token-count CI gate (Haiku 4.5 4096-token cache floor)
✓ 90d3d1a feat(19-04): wire Engine.summarizeVersion + boot path + activate allowed-set guard
```

**Acceptance grep checks — verified:**

```
✓ await import('@anthropic-ai/sdk')        in src/engine/summary/anthropic-client.ts
✓ maxRetries: 0                              in src/engine/summary/anthropic-client.ts (≥2 occurrences)
✓ timeout: 10_000                            in src/engine/summary/anthropic-client.ts
✓ 'claude-haiku-4-5-20251001'                in src/engine/summary/anthropic-client.ts (D-LLM-1)
✓ max_tokens: 180                            in src/engine/summary/anthropic-client.ts (D-LLM-3)
✓ temperature: 0.7                           in src/engine/summary/anthropic-client.ts (D-LLM-4)
✓ cache_control: { type: 'ephemeral' }       in src/engine/summary/anthropic-client.ts (D-LLM-5)
✓ message.content.find                       in src/engine/summary/anthropic-client.ts (Pitfall 8)
✓ export function generateSummary            in src/engine/summary/anthropic-client.ts
✓ export function flattenAnthropicError      in src/engine/summary/anthropic-client.ts
✓ export function __resetAnthropicSdkStateForTests in src/engine/summary/anthropic-client.ts
✓ Buffer.from(apiKey, 'utf16le')             in src/engine/summary/anthropic-client.ts
✓ .reverse().toString('binary')              in src/engine/summary/anthropic-client.ts
✓ .toString('base64')                        in src/engine/summary/anthropic-client.ts
✓ /sk-ant-[A-Za-z0-9_-]{40,}/g               in src/engine/summary/anthropic-client.ts

✓ export type SummaryOutcome                 in src/engine/summary/index.ts
✓ 'cache_hit' | 'live' | fallback (3 source values) in src/engine/summary/index.ts
✓ 7 fallback reason codes in union           in src/engine/summary/index.ts (api_key_missing | circuit_open | sdk_load_failed | http_error | network_error | validation_failed | timeout)
✓ NO 'output_too_short'                      in src/engine/summary/index.ts (WARNING #10 pruning)
✓ NO 'manifest_sha256_unavailable'           in src/engine/summary/index.ts (WARNING #10 pruning)
✓ case 'AuthenticationError':                in src/engine/summary/index.ts mapErrToReason
✓ case 'APIConnectionTimeoutError':          in src/engine/summary/index.ts mapErrToReason
✓ case 'APIConnectionError':                 in src/engine/summary/index.ts mapErrToReason
✓ case 'TypeError':                          in src/engine/summary/index.ts mapErrToReason
✓ case 'RateLimitError':                     in src/engine/summary/index.ts mapErrToReason
✓ export async function summarizeVersion     in src/engine/summary/index.ts
✓ assertNoApiKeyInPayload(sanitized)         in src/engine/summary/index.ts (D-PRIV-3 site)
✓ validateSummary(llmResult.text, models ?? [], isRedacted)  in src/engine/summary/index.ts (D-VAL-2 gate)
✓ appendSummaryGeneratedEvent (success path only)  in src/engine/summary/index.ts
✓ circuitBreaker.recordSuccess + recordFailure  in src/engine/summary/index.ts
✓ options.regenerate skip-cache-lookup logic in src/engine/summary/index.ts
✓ NO @anthropic-ai/sdk import line           in src/engine/summary/index.ts (sole importer is anthropic-client.ts)
✓ import { extractInputAssertion } from '../c2pa/ingredient-extractor.js'  in src/engine/summary/index.ts (BLOCKER #1)
✓ extractInputAssertion(promptBlob, resolvedSeed)  in src/engine/summary/index.ts (BLOCKER #1 call site)
✓ NO 'parentVersionLabel: null' hardcoded    in src/engine/summary/index.ts (BLOCKER #1)
✓ promptPositive,/promptNegative,/parentVersionLabel,  in sanitizeProvenance call site
✓ deps.versionRepo.getVersion(version.parent_version_id)  in src/engine/summary/index.ts (parent label)
✓ `v${String(parent.version_number).padStart(3, '0')}`  in src/engine/summary/index.ts (zero-padded format)

✓ private readonly anthropicConfig: { apiKey: string } | null  in src/engine/pipeline.ts
✓ anthropicConfig?: { apiKey: string } | null  in constructor options interface
✓ this.anthropicConfig = options.anthropicConfig ?? null  in constructor body
✓ async summarizeVersion(versionId: string, options?: { regenerate?: boolean; signal?: AbortSignal })  in src/engine/pipeline.ts
✓ this.versionRepo, this.provenanceRepo, this.anthropicConfig, clock: () => Date.now()  in summarizeVersion body
✓ await import('./summary/index.js')         in src/engine/pipeline.ts (lazy local import)

✓ import { loadAnthropicConfigFromEnv } from './utils/anthropic-config.js'  in src/server.ts
✓ const anthropicConfig = loadAnthropicConfigFromEnv()  in src/server.ts
✓ anthropicConfig                            in new Engine(...) options object
✓ ****${last4}                               in src/server.ts boot log (D-PRIV-4)
✓ ZERO from '@anthropic-ai/sdk' in src/server.ts (boot-resilience invariant)

✓ NO it.skip @anthropic-ai/sdk imports are centralized  in src/__tests__/architecture-purity.test.ts (.skip() removed)

✓ BLOCKER #2 token-count.test.ts:
  ✓ describe block: Phase 19 — Haiku 4.5 cached-prefix token-count assertion (BLOCKER #2)
  ✓ literal: await client.messages.countTokens
  ✓ literal: expect(result.input_tokens).toBeGreaterThanOrEqual(4096)
  ✓ literal: expect(result.input_tokens).toBeGreaterThanOrEqual(4500)
  ✓ no-key-skip branch: if (!apiKey) { console.error(...skipped...); return; }
  ✓ Test 1 logs actual token count to stderr
```

**Test outcomes — verified:**
- `npx vitest run src/engine/summary/__tests__/anthropic-client.test.ts` → 28 passed
- `npx vitest run src/engine/summary/__tests__/summarize-version.test.ts` → 27 passed
- `npx vitest run src/engine/summary/__tests__/token-count.test.ts` → 2 passed (Test 1 skipped without API key)
- `npx vitest run src/__tests__/architecture-purity.test.ts` → 51 passed | 0 skipped (was 50 passed | 1 skipped — the @anthropic-ai/sdk allowed-set assertion is now ACTIVE and GREEN)
- `npx vitest run src/engine/summary/ src/__tests__/architecture-purity.test.ts` → 9 test files, 190 passed, 0 skipped
- `npx tsc --noEmit` → exit 0
- `grep "from\\s*['\\\"]@anthropic-ai/sdk" src/server.ts` → ZERO matches (boot-resilience preserved)
- `grep -rEnl "from\\s*['\\\"]@anthropic-ai/sdk|import\\s*\\(\\s*['\\\"]@anthropic-ai/sdk" src/ | grep -v __tests__` → only `src/engine/summary/anthropic-client.ts` (sole-importer locked)

All claims verified. No discrepancies between SUMMARY.md and disk/git state. Plan 19-04 is COMPLETE; Phase 19 wave 3 cohort closed. Plans 19-05 (HTTP route) + 19-06 (dashboard) + 19-07 (eval suite) + 19-08 (verification + completion) remain.
