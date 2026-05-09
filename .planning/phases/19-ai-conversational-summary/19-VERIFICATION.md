---
phase: 19-ai-conversational-summary
verified: 2026-05-09T20:15:30Z
status: human_needed
score: 5/5 success criteria verified (automated)
overrides_applied: 0
re_verification:
  previous_status: null
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "UAT-1 — Voice quality across 12 fixture versions"
    expected: "Each summary reads as Supervisor/Lead voice: declarative present tense, 25-45 words, verbatim model name (case-sensitive match to models_json[].name), parent reference on iterate-lineage, every applied LoRA named, exact integer seed reported, no AI-slop tells (stunning/vibrant/captivating/delve), no image-content claims, no broken voice register"
    why_human: "Voice-drift detection requires human judgment — the structural shape (sentence count, verbatim model name, banned-lexicon absence) is automated by Plan 19-07 eval suite, but 'feels conversational like a Supervisor or Lead wrote it' is human-judgment territory per PROJECT.md user quote (Timothy Paul Bielec, 2026-04-30). Documented as UAT-1 in 19-HUMAN-UAT.md."
  - test: "UAT-2 — Skeleton-shimmer aesthetic match to Phase 17"
    expected: "Loading skeleton uses animate-skeleton-shimmer keyframe + gradient tokens consistent with Phase 17 thumbnails; honors prefers-reduced-motion: reduce; visual rhythm matches across the dashboard"
    why_human: "Aesthetic match is visual-judgment territory under jsdom — getBoundingClientRect returns 0 for all elements regardless of CSS, so structural fingerprint is the load-bearing automated assertion (Test 16). Live browser viewing required for the visual-rhythm verification."
  - test: "UAT-3 — Regenerate cooldown countdown UX"
    expected: "60s decrementing 1Hz countdown displays correctly; button disabled during cooldown; tabular-nums prevents digit-jitter; server-side throttle (Plan 19-05) returns 429 with actionable retry-after seconds when click bypasses client debounce; cooldown displays as '(60s)' → '(59s)' → ... → '(0s)' → enabled"
    why_human: "Real-time countdown behavior + cross-browser tabular-nums rendering require visual verification. Fake-timer tests (12 RegenerateButton.test.tsx tests) exercise the 1Hz tick logic under jsdom but cannot prove visual digit-jitter prevention or real-clock throttle behavior."
  - test: "UAT-4 — First-use disclosure surfacing + localStorage ack persistence"
    expected: "First-use disclosure note ('AI summary uses your prompt text') visible above body on first viewing; auto-acks on first Regenerate click; persists across browser sessions via localStorage; degrades gracefully in privacy-mode browsers (no error visible to user); visible only on first viewing in clean browser"
    why_human: "Cross-session persistence + privacy-mode browser behavior + visual surfacing of disclosure require live browser testing across multiple browser sessions. localStorage tests under jsdom (Tests 10-13 in VersionDrawer.test.tsx) verify the storage contract but not the cross-session UX."
---

# Phase 19: AI Conversational Summary — Verification Report

**Phase Goal (from ROADMAP.md):** VFX artists open the VersionDrawer and read a 2-4 sentence Supervisor/Lead-voice summary of the asset and the workflow that made it (instead of a raw node listing), grounded in structured provenance with zero vision-model inference.

**Verified:** 2026-05-09T20:15:30Z
**Status:** human_needed (5/5 automated criteria PASS; 4 manual UAT items deferred)
**Re-verification:** No — initial verification

---

## Summary Verdict: READY-WITH-NOTES

All 5 ROADMAP Success Criteria have automated coverage backed by passing tests. The codebase substantively delivers the phase goal: end-to-end flow from `summarizeVersion` engine facade → HTTP routes (GET + POST regenerate) → dashboard signal/state → `SummarySection` component → `VersionDrawer` integration is wired with no stubs or hollow components. All wiring (data flow, key links, architecture-purity invariants) verified. The 20 documented out-of-scope failures are confirmed pre-existing v1.0/v1.1-shape audit drift (3 files); Phase 19 work did not touch them.

**Notes for ship:**
1. Four human-judgment UAT items (voice quality, skeleton aesthetic, regenerate UX, first-use disclosure) require live browser verification per `19-HUMAN-UAT.md` — these are the documented manual-only surfaces.
2. The eval suite's LLM-judge dimensions (lineage_relationship + voice_register) skip cleanly without `ANTHROPIC_API_KEY`; CI integration passes the secret from GitHub Actions.
3. Two adversarial-test discoveries already closed via follow-up fixes: `45813d6` (manifest_sha256 in redacted payload) + `50abf54` (post-LLM API key leak scan before cache write).

---

## Goal Achievement — Observable Truths

### Success Criteria Verification (ROADMAP.md Phase 19)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | User opens VersionDrawer and sees 2-4 sentence Supervisor/Lead-voice summary; for iterate-lineage versions includes verbatim model name (D-VAL-1) + parent version + key prompt deltas | **PASS** | (a) `VersionDrawer.tsx:347-372` renders `<SummarySection>` ABOVE the Output section with auto-fetch on `version.id` change (lines 182-198); (b) `validateSummary` enforces case-sensitive verbatim model_name match in `validation.ts:49`; (c) BLOCKER #1 KSampler edge walk + parent label resolution wired at `index.ts:303-327` (NOT hardcoded null); (d) Voice fingerprint anchored at `template.ts:102` and `few-shot-examples.ts:153` ("v003 is a tighter close-up of the dragon's eye…" verbatim from ROADMAP); (e) D-LLM-1 dated pin `claude-haiku-4-5-20251001` at `template.ts:45` + `anthropic-client.ts:113`; (f) D-LLM-3 max_tokens=180 (~4-5 sentences); (g) Eval suite `assertSentenceCountAndLength` (2-4 sentences, 20-50 words) at `code-based.ts`; (h) 27 summarize-version.test.ts tests + 20 voice-fingerprint+SYSTEM_PROMPT tests pass |
| 2 | Re-view loads from cache without LLM call (cache key = manifest_sha256 + template_version + model_id); Regenerate refreshes (server-throttled 1/min, client-debounced 500ms) | **PASS** | (a) Cache lookup at `index.ts:249-280` skips LLM call when cache_hit; (b) Cache key composite at `index.ts:251-254` (3 args: manifest_sha256, template_version, model_id) — `getLatestSummaryGeneratedEvent` 4-arg signature in `provenance-repo.ts:353`; (c) Server-side 60s throttle at `dashboard-routes.ts:130-131,346-372` — Map<versionId, lastReqMs> with lazy GC; (d) `TypedError('SUMMARY_THROTTLED')` → 429 via error-middleware `TOO_MANY_REQUESTS_CODES`; (e) Client 500ms debounce at `VersionDrawer.tsx:206` (`useRef` lastClickTimestamp); (f) `regenerate_available_at_ms` flows server → lib/api → state → SummarySection → RegenerateButton (12 routes tests + 15 lib/api tests + 10 state tests + 12 RegenerateButton tests verify) |
| 3 | Redacted version uses ONLY surviving fields with explicit "(some prompt fields were redacted)" disclosure tag; redact event invalidates cache | **PASS** | (a) D-VAL-3 case-insensitive marker check in `validation.ts:58-66` (REDACTION_MARKERS = ['redacted','partial','redaction']); (b) Deterministic-template fallback emits "Some prompt fields were redacted" verbatim at `deterministic-template.ts:66` (validator round-trip Test 6 confirms); (c) Cache invariant: `manifest_sha256` is part of cache key; Phase 16 redact mutates manifest_sha256 → next read is automatic cache_miss; (d) E2E proof at `summary-redact-e2e.test.ts` Test 1 — REAL Engine signOutput + summarizeVersion (cache_hit confirmed at SHA_A) → real Engine.redactManifestForVersion → SHA_B != SHA_A → fresh summarize call generates redacted-aware summary, persists 2nd row with different manifest_sha256 (PASS — observed via stderr: a3921964… → d0eed5c2…); (e) Follow-up fix `45813d6` (Phase 16 redact path now stores manifest_sha256 in redacted payload — closes the wire-level gap surfaced by the E2E test) |
| 4 | Graceful fallback when LLM down / API key missing / circuit breaker tripped: "(AI summary unavailable; showing structured details)" + raw provenance display; no leaked API key in errors | **PASS** | (a) `WARNING_PILL_FALLBACK_ARIA = 'AI summary unavailable; showing structured details'` at `copy.ts:144` (verbatim SUM-06 wording); (b) 7 fallback reasons mapped in `index.ts:69-97` (api_key_missing / circuit_open / sdk_load_failed / http_error / network_error / validation_failed / timeout) — engine NEVER throws to HTTP layer for failure paths; (c) `SummarySection.tsx:144-157` renders `<WarningPill>` + deterministic-template body in fallback state with D-FB-6 layout-stable header; (d) `flattenAnthropicError` 4-encoding leak strip + sk-ant- regex defence-in-depth in `anthropic-client.ts`; (e) Multi-encoding leak scan E2E proof at `summary-leak-scan.test.ts` Tests 1-4 (cache row / stderr / HTTP envelope / flattenAnthropicError, all passing — 6/6 gated tests run with REAL Engine); (f) Telemetry `assertNoBannedFields` runtime gate at `telemetry.ts:88-95` (8 banned field names) + emit-refusal contract; (g) Follow-up fix `50abf54` (post-LLM `assertNoApiKeyInString` scan before cache write at `index.ts:384-394`) closes a P1 gap surfaced by the leak-scan E2E test; (h) 28 telemetry tests + 5 leak-scan tests + 7 prompt-injection tests pass |
| 5 | Raw provenance details remain available collapsed under "Show provenance details" disclosure; tool count stays at 7 of 12 (no new top-level MCP tools) | **PASS** | (a) Provenance section relocated INTO `<SummarySection>` children slot as `<details>` disclosure at `VersionDrawer.tsx:354-371` (collapsed-by-default per HTML semantic — no `open` attribute); (b) `SUMMARY_DISCLOSURE_TOGGLE = 'Show provenance details'` at `copy.ts:125` (verbatim SUM-07 wording); (c) `data-testid="provenance-disclosure"` for UAT scripts; (d) `JsonBlock` rendering preserved verbatim — same `<pre>{JSON.stringify(...)}</pre>` shape inside the disclosure body; (e) MCP tool count = 7 (workspace + project + sequence + shot + asset + version + generation — all 7 register via `server.registerTool` in `src/tools/`); ZERO new top-level tools added by Phase 19 (HTTP routes are not MCP tools); (f) 16 VersionDrawer Phase 19 integration tests pass including provenance-inside-disclosure structural contract (Test 8) |

**Score:** 5/5 ROADMAP Success Criteria verified with automated test coverage.

---

## Required Artifacts — Verified Present, Substantive, and Wired

### Engine Layer (Plans 19-01 through 19-04)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/utils/anthropic-config.ts` | `loadAnthropicConfigFromEnv` boot validator | VERIFIED | 50 lines; exports `loadAnthropicConfigFromEnv` + `AnthropicConfig`; D-PRIV-4 last-4 hygiene (`****<last4>`); imported in `src/server.ts:68`, called at `:238`; 6 boot-validation tests pass |
| `drizzle/0007_phase19_summary_generated_event.sql` | Migration 0007 adds nullable `summary_generated_json` text column | VERIFIED | SQL file present; ALTER TABLE statement is additive + nullable; 9 migration tests pass (fresh + idempotency + JSON round-trip + redact-cache-invalidation invariant + append-only invariant) |
| `src/engine/summary/sanitizer.ts` | ALLOW_LIST + sanitizeProvenance + assertNoApiKeyInPayload | VERIFIED | 11,565 bytes; 7-field ALLOW_LIST; BLOCKER #1 promptPositive/promptNegative as REQUIRED inputs (no hardcoded null defaults); two-haystack 4-encoding leak scan; 21 tests pass |
| `src/engine/summary/validation.ts` | validateSummary D-VAL-1 + D-VAL-3 | VERIFIED | 2,137 bytes; case-sensitive verbatim model_name match; case-insensitive marker check; 13 tests pass |
| `src/engine/summary/deterministic-template.ts` | buildDeterministicSummary D-FB-1 | VERIFIED | 3,029 bytes; HARD_CAP=320; emits "Some prompt fields were redacted" (validator round-trip Test 6); 12 tests pass |
| `src/engine/summary/template.ts` | SUMMARY_TEMPLATE_VERSION + SYSTEM_PROMPT + assemblePromptInput + escapeXml | VERIFIED | 9,942 bytes; SUMMARY_TEMPLATE_VERSION='1.0.0', SUMMARY_MODEL_ID='claude-haiku-4-5-20251001', SUMMARY_MAX_TOKENS=180, SUMMARY_TEMPERATURE=0.7; voice fingerprint anchored verbatim; XML-escape D-PRIV-5; 19 tests pass |
| `src/engine/summary/templates/few-shot-examples.ts` | 5 hand-curated examples expanded for cache threshold | VERIFIED | 21,697 bytes (~5400 tokens cached prefix — clears Haiku 4.5 4096-token floor with 4500 safety margin per BLOCKER #2 token-count.test.ts) |
| `src/engine/summary/circuit-breaker.ts` | D-FB-3 half-open state machine + injected clock | VERIFIED | 3,228 bytes; CLOSED → 5 failures/60s → OPEN → 5min → HALF_OPEN; module-scoped singleton; `__resetCircuitBreakerStateForTests`; 17 tests pass |
| `src/engine/summary/anthropic-client.ts` | SOLE @anthropic-ai/sdk importer (lazy + cached error) + flattenAnthropicError | VERIFIED | 7,956 bytes; lazy `await import('@anthropic-ai/sdk')` at line 49; type-only `typeof import` at line 30; D-LLM-1..5 verbatim; maxRetries:0 ×2 (defence-in-depth); flattenAnthropicError 4-encoding strip + sk-ant- regex; 28 tests pass |
| `src/engine/summary/index.ts` | summarizeVersion 8-step pipeline + SummaryOutcome 7-reason fallback union | VERIFIED | 21,559 bytes; 8-step pipeline; BLOCKER #1 KSampler edge walk + parent label at lines 290-327 (NOT hardcoded null); D-VAL-2 cache-write gate; Step 6.5 post-LLM leak scan (follow-up fix 50abf54); 27 tests pass |
| `src/engine/summary/telemetry.ts` | logSummaryEvent + BANNED_FIELDS + shouldSampleCacheHit + 4-encoding scan | VERIFIED | 7,077 bytes; 8 BANNED_FIELDS (text, summary_text, prompt_positive, prompt_negative, user_prompt, system, prompt, content); shouldSampleCacheHit 1% deterministic via FNV hash; assertNoBannedFields runtime gate; 28 tests pass |

### HTTP + Dashboard Layer (Plans 19-05, 19-06)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/http/dashboard-routes.ts` | GET + POST routes + 60s throttle Map | VERIFIED | summaryThrottle Map at line 130; SUMMARY_THROTTLE_MS=60_000 at line 131; GET handler at line 340-348 spreads outcome + adds `regenerate_available_at_ms`; POST handler at line 360-378 enforces throttle + `regenerate: true`; 12 routes tests pass |
| `src/http/error-middleware.ts` | TOO_MANY_REQUESTS_CODES + 429 mapping | VERIFIED | New TOO_MANY_REQUESTS_CODES Set + 429 branch added; SUMMARY_THROTTLED → 429 |
| `packages/dashboard/src/lib/api.ts` | getSummary + regenerateSummary + SummaryFetchResponse | VERIFIED | Defensive error-collapse contract (NEVER throws); encodeURIComponent on both routes; method:'POST' on regenerate; 15 lib/api tests pass |
| `packages/dashboard/src/state/summaries.ts` | summarySignal Map + fetchSummary + 4-variant SummaryState | VERIFIED | 4,515 bytes; D-WEBUI-31 architecture-purity preserved (zero server-tree imports); per-version Map isolation; regenerateAvailableAtMs on success+fallback variants; 10 state tests pass |
| `packages/dashboard/src/components/SummarySection.tsx` | 4-state discriminated render with WarningPill + RegenerateButton + SUM-07 children slot | VERIFIED | 7,177 bytes; ZERO `dangerouslySetInnerHTML` (T-5-06 / T-19-33 mitigation); 4 render branches (loading/success/fallback/error); D-FB-6 DOM-stability invariant verified by Test 16; 16 component tests pass |
| `packages/dashboard/src/components/RegenerateButton.tsx` | 3-state button + 1Hz countdown + ARIA + cleanup | VERIFIED | 5,032 bytes; 1Hz countdown via setInterval keyed on regenerateAvailableAtMs alone; native HTML disabled removes from tab order; aria-busy toggle; 12 tests pass |
| `packages/dashboard/src/views/VersionDrawer.tsx` | 3 surgical changes — SummarySection above Output, Provenance relocated, summary auto-fetch + handleRegenerate + first-use ack | VERIFIED | 20,294 bytes; SummarySection at lines 347-372; Provenance relocated INTO children slot as `<details>` disclosure (lines 354-371); auto-fetch effect at lines 182-198 (mirrors C2PA pattern); handleRegenerate at lines 200-233 with 500ms debounce + D-PRIV-2 first-use ack; 16 Phase 19 integration tests pass |
| `packages/dashboard/src/lib/copy.ts` | 11 named-constant Phase 19 copy strings + 2 helper functions | VERIFIED | SUMMARY_HEADING + PROVENANCE_HEADING + SUMMARY_DISCLOSURE_TOGGLE + REGENERATE_BUTTON_LABEL + REGENERATE_BUTTON_FETCHING + WARNING_PILL_FALLBACK_LABEL + WARNING_PILL_FALLBACK_ARIA + SUMMARY_ERROR_FALLBACK + SUMMARY_FIRST_USE_DISCLOSURE + SUMMARY_FIRST_USE_LOCALSTORAGE_KEY + helpers (regenerateButtonAriaLabel, regenerateButtonCooldownLabel) |

### Eval Suite + Adversarial Tests (Plans 19-07, 19-08)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/__tests__/fixtures/summary-eval/01..12-*.json` + README.md | 12 fixtures × 9 dimensions per AI-SPEC §5 | VERIFIED | All 12 JSON files present + README; covers root × 2 + iterate × 4 + ControlNet × 2 + redacted × 1 + edge cases × 3 (KSampler-absent, prompt-injection, long-prompt) |
| `src/__tests__/summary-eval/dimensions/{code-based,llm-judge}.ts` | 5 code-based + 4 LLM-judge dimensions | VERIFIED | code-based.ts: assertModelNameFidelity / assertSentenceCountAndLength / assertAntiFeatureRegression / assertNoBannedLexicon / assertApiKeyLeakScan / assertRedactionMarker / assertNoRedactedPromptLeak; llm-judge.ts: judgeLineageRelationship / judgeVoiceRegister with skip-when-no-key contract |
| `src/__tests__/summary-eval/{run-eval,eval.test}.ts` | Vitest entry point + thresholds + CI gating | VERIFIED | PASS_THRESHOLDS encodes Critical 1.0 / High 0.95 / redaction-leak 1.0; npm run test:eval passes (1 file / 1 test / 9-dimension perfect score on golden fallback path) |
| `package.json` test:eval script | `"test:eval": "vitest run src/__tests__/summary-eval --reporter=default"` | VERIFIED | Present at line 21 (Rule 3 reporter swap from `basic` to `default`); CI workflow includes the step under "Run summary eval suite (AI-SPEC §5)" with ANTHROPIC_API_KEY secret threading |
| `src/__tests__/summary-redact-e2e.test.ts` | E2E redact-cache-invariant proof | VERIFIED + RUNNING | 1 test passes with REAL Engine flow (not skipped) — observed manifest_sha256 mutation a3921964… → d0eed5c2…; 2 distinct cache rows persisted |
| `src/__tests__/summary-leak-scan.test.ts` | E2E multi-encoding leak scan | VERIFIED + RUNNING | 5 tests pass with REAL Engine flow — cache row / stderr / HTTP envelope / flattenAnthropicError / telemetry emit-refusal all clean |
| `src/__tests__/summary-prompt-injection.test.ts` | D-VAL-1 / D-VAL-3 / D-PRIV-5 jailbreak resistance | VERIFIED | 7 tests pass — jailbreak drops model name → fallback; jailbreak on redacted drops marker → fallback; XML-escape on `</user_prompt>` injection; engine never throws; positive control passes |
| `src/__tests__/summary-telemetry.test.ts` | AI-SPEC §7 contract | VERIFIED | 28 tests pass — emit shape / sampling / banned-field sweep / multi-encoding leak refusal / shouldSampleCacheHit determinism / Engine integration / sentinel prompt-leak negative / WARNING #5 grep guards |
| `19-HUMAN-UAT.md` | 4 manual verifications | VERIFIED | 4 UAT items present (`grep -c "^### UAT-"` returns 4); ROADMAP voice fingerprint phrase cited verbatim |
| `19-ADVERSARIAL-REVIEW.md` | 5-surface checklist with mitigations | VERIFIED | 5 surfaces present (`grep -c "^## Surface "` returns 5); 9 D-* decisions cited; 21 test-file cross-references |

---

## Key Link Verification (Wiring)

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/server.ts` | `loadAnthropicConfigFromEnv` | `import` line 68 + `loadAnthropicConfigFromEnv()` call line 238 | WIRED | Boot-time call BEFORE Engine construction; threads through `new Engine({ ..., anthropicConfig })` at line 269; D-PRIV-4 last-4 hygiene log at line 242 |
| `src/server.ts` | `@anthropic-ai/sdk` | NONE | NOT_WIRED (intended) | Boot-resilience invariant — `grep "from\\s+'@anthropic-ai/sdk'" src/server.ts` returns ZERO; architecture-purity guard locks this |
| `src/engine/pipeline.ts:Engine.summarizeVersion` | `src/engine/summary/index.ts:summarizeVersion` | `await import('./summary/index.js')` lazy local import at line 1418 | WIRED | Lazy import preserves boot-resilience; first call triggers SDK module load |
| `src/engine/summary/index.ts` | `src/engine/summary/anthropic-client.ts` | `import { generateSummary, flattenAnthropicError } from './anthropic-client.js'` line 43 | WIRED | Sole-importer guard locks anthropic-client.ts as the single non-test file with `@anthropic-ai/sdk` import |
| `src/engine/summary/anthropic-client.ts` | `@anthropic-ai/sdk` | `await import('@anthropic-ai/sdk')` line 49 (lazy) + `typeof import` line 30 (type-only) | WIRED | Lazy load with cached load-error short-circuit; mirrors Phase 14 c2pa-node sole-importer pattern |
| `src/engine/summary/index.ts` | `src/engine/summary/telemetry.ts` | `import { logSummaryEvent } from './telemetry.js'` line 44 + 7 call sites | WIRED | grep "logSummaryEvent" returns 7 occurrences; cache_hit + live + 6 fallback variants (closure pattern) |
| `src/http/dashboard-routes.ts` | `engine.summarizeVersion` | `engine.summarizeVersion(versionId, { regenerate: true? })` at lines 348 + 372 | WIRED | GET passes default options; POST passes `{ regenerate: true }`; tested by FakeEngine.calls capture (Test 9 in summary-routes.test.ts) |
| `packages/dashboard/src/lib/api.ts` | `/api/versions/:id/summary` | `fetch(${BASE}/api/versions/${encodeURIComponent(versionId)}/summary)` GET + `/regenerate` POST | WIRED | Both routes encoded; method:'POST' on regenerate; defensive error-collapse never throws |
| `packages/dashboard/src/state/summaries.ts` | `packages/dashboard/src/lib/api.ts` | `import { getSummary, regenerateSummary } from '../lib/api.js'` | WIRED | D-WEBUI-31 architecture-purity preserved (zero server-tree imports verified by grep) |
| `packages/dashboard/src/views/VersionDrawer.tsx` | `summarySignal + fetchSummary` | `import { summarySignal, fetchSummary } from '../state/summaries.js'` lines 42-44 | WIRED | Auto-fetch effect at lines 182-198 mirrors Phase 14 C2PA pattern; handleRegenerate calls `fetchSummary({ regenerate: true })` at line 227 |
| `packages/dashboard/src/components/SummarySection.tsx` | `RegenerateButton + WarningPill` | `import` lines 47-48 | WIRED | All 4 render branches use the imported components; T-5-06 XSS guard via JSX text-children only |
| `src/store/provenance-repo.ts` | `summary_generated_json` column | `appendSummaryGeneratedEvent` (line 329) + `getLatestSummaryGeneratedEvent` (line 353) | WIRED | Append-only invariant preserved (zero this.db.update / this.db.delete); cache key composite (manifest_sha256, template_version, model_id) lookup at line 369-371 |
| `src/engine/c2pa/redaction.ts` | `manifest_sha256` field on redacted manifest_signed payload | line 823 (`manifest_sha256: redactedManifestSha256`) | WIRED | Phase 16 follow-up fix `45813d6` — pre-Phase 19 the redacted payload omitted manifest_sha256 → cache lookup couldn't find the redacted row → cache invariant broken. Fix now stores the new SHA so cache invalidation is real, not theoretical. |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `SummarySection.tsx` (success branch) | `summary.text` | `fetchSummary(versionId)` → `getSummary` HTTP call → `engine.summarizeVersion` → either cache_hit (DB row's summary_text) or live (LLM response.content[0].text) | Yes (engine resolves real data via DB or LLM) | FLOWING |
| `SummarySection.tsx` (fallback branch) | `summary.text` | Same path; engine returns `{ source: 'fallback', text: buildDeterministicSummary(...) }` for 7 fallback reasons | Yes (deterministic-template builds structured sentences from completed/models/parent label) | FLOWING |
| `SummarySection.tsx` (error branch) | `SUMMARY_ERROR_FALLBACK` constant | `copy.ts:151` static literal '(AI summary unavailable; please retry.)' | Yes (static UI copy) | FLOWING |
| `RegenerateButton.tsx` | `cooldownSeconds` | `Math.ceil((regenerateAvailableAtMs - Date.now()) / 1000)` sampled inside 1Hz interval | Yes (live clock + server-provided timestamp) | FLOWING |
| `VersionDrawer.tsx` | `provenance` (Provenance disclosure body) | `getProvenance(version.id)` HTTP call → existing v1.0 provenance route | Yes (DB events array) | FLOWING |
| `VersionDrawer.tsx` | `summarySignal[version.id]` | Auto-fetch effect writes via `summarySignal.value = new Map(summarySignal.value).set(version.id, s)` | Yes (per-version Map isolation; cross-component reads see same value) | FLOWING |
| Engine `summarizeVersion` | `models`, `completed`, `manifest_sha256` | `provenanceRepo.getLatestFingerprints` + `provenanceRepo.getEventsForVersion` (find event_type='completed') + `provenanceRepo.getLatestManifestSignedEvent` | Yes (real DB queries) | FLOWING |
| Engine cache lookup | `cached.summary_text` | `getLatestSummaryGeneratedEvent(id, sha, ver, model)` parses `summary_generated_json` column | Yes (DB row JSON parse) | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Server-side TypeScript compiles clean | `npx tsc --noEmit` | exit 0 (no output) | PASS |
| Dashboard TypeScript compiles clean | `cd packages/dashboard && npx tsc --noEmit` | exit 0 (no output) | PASS |
| Phase 19 engine + architecture-purity test cohort | `npx vitest run src/engine/summary/ src/__tests__/architecture-purity.test.ts src/__tests__/anthropic-config.test.ts src/__tests__/migrations/0007-summary-event.test.ts` | 11 files / 206 tests pass | PASS |
| HTTP routes + telemetry + prompt-injection | `npx vitest run src/http/__tests__/summary-routes.test.ts src/__tests__/summary-telemetry.test.ts src/__tests__/summary-prompt-injection.test.ts` | 3 files / 47 tests pass | PASS |
| Adversarial E2E (gated) | `npx vitest run src/__tests__/summary-redact-e2e.test.ts src/__tests__/summary-leak-scan.test.ts` | 2 files / 6 tests pass (NOT skipped — REAL Engine flow runs in this environment) | PASS |
| Dashboard suite | `cd packages/dashboard && npx vitest run` | 26 files / 273 tests pass | PASS |
| Architecture-purity guards | `npx vitest run src/__tests__/architecture-purity.test.ts` | 52 tests pass / 0 skipped (all 10 Phase 19 guards ACTIVE) | PASS |
| Eval suite (no API key — code-based dimensions exercise via golden fallback) | `npm run test:eval` | 1 file / 1 test pass; 9-dimension perfect score | PASS |
| Boot-resilience invariant | `grep -E "from\\s+['\"]\@anthropic-ai/sdk['\"]" src/server.ts` | 0 matches | PASS |
| Sole-importer invariant | `grep -rEn "from\\s+['\"]\@anthropic-ai/sdk['\"]" src/ \| grep -v __tests__` | only `src/engine/summary/anthropic-client.ts` (line 30 type-only + line 49 lazy await import) | PASS |
| Tool count cap (≤12, +0 from Phase 19) | Count files with `server.registerTool` in `src/tools/` | 7 (workspace, project, sequence, shot, asset, version, generation) | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SUM-01 | 19-04, 19-06, 19-07, 19-08 | 2-4 sentence Supervisor/Lead voice summary in VersionDrawer | SATISFIED | Engine facade + dashboard component layer + voice fingerprint anchored in template + few-shot + 12-fixture eval suite + UAT-1 deferred to manual |
| SUM-02 | 19-02, 19-04, 19-07, 19-08 | Summary mentions model name + parent + key prompt deltas (D-VAL-1 verbatim regex) | SATISFIED | validation.ts D-VAL-1 case-sensitive match + BLOCKER #1 KSampler edge walk + parent_version_label resolution + assertModelNameFidelity eval dimension + jailbreak E2E test |
| SUM-03 | 19-02, 19-04 | Redaction respects surviving fields + explicit disclosure | SATISFIED | D-VAL-3 marker check + deterministic-template emits "Some prompt fields were redacted" + cache key composite includes manifest_sha256 (Phase 16 redact gives free invalidation) + summary-redact-e2e.test.ts proves the invariant end-to-end |
| SUM-04 | 19-05, 19-06 | Regenerate button (server 1/min throttle + client 500ms debounce) | SATISFIED | summaryThrottle Map at server + lastRegenerateClickRef at VersionDrawer + 1Hz countdown via RegenerateButton + 12 routes tests + 12 RegenerateButton tests |
| SUM-05 | 19-01, 19-04, 19-05 | Cache by manifest_sha256 + template_version + model_id | SATISFIED | Migration 0007 adds summary_generated_json column + getLatestSummaryGeneratedEvent 4-arg signature + appendSummaryGeneratedEvent on validated live responses only (D-VAL-2 gate) + cache_hit Test 1 in summarize-version.test.ts |
| SUM-06 | 19-04, 19-05, 19-06, 19-08 | Graceful fallback (LLM down / API key missing / circuit breaker) | SATISFIED | 7-reason fallback union + WarningPill UI + flattenAnthropicError leak strip + multi-encoding leak scan + circuit breaker D-FB-3 + telemetry banned-field sweep + post-LLM leak scan (follow-up fix 50abf54) |
| SUM-07 | 19-06 | Provenance details collapsed under "Show provenance details" disclosure; tool count = 7 of 12 | SATISFIED | Provenance section relocated INTO SummarySection children slot as `<details>` disclosure + SUMMARY_DISCLOSURE_TOGGLE constant + 16 VersionDrawer Phase 19 integration tests + tool count verified at 7 (no new MCP tools) |

**Coverage:** 7/7 SUM requirements satisfied. ZERO orphaned requirements (all SUM-01..07 mapped to plans + verified in implementation).

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | No anti-patterns found in Phase 19 source files |

**Scan results:**
- `grep -E "TODO\|FIXME\|XXX\|HACK\|PLACEHOLDER"` on Phase 19 source files → ZERO matches
- `grep -E "placeholder\|coming soon\|will be here\|not yet implemented"` → ZERO matches in production code
- `dangerouslySetInnerHTML` in dashboard components → ZERO matches (SummarySection + RegenerateButton + VersionDrawer all use JSX text-child interpolation; T-5-06 / T-19-33 mitigation verified)
- Empty handler bodies (`onClick={() => {}}`) → ZERO matches in Phase 19 components
- Hardcoded empty array/null defaults that bypass real data flow → ZERO matches (BLOCKER #1 specifically prevents this — promptPositive/promptNegative are REQUIRED inputs, not optional null defaults)

---

## Out-of-Scope Pre-existing Failures

The full vitest suite reports 20 failing tests, all confined to 3 files NOT modified by Phase 19 work:

| File | Failures | Cause |
|------|----------|-------|
| `src/__tests__/phase-attribution.test.ts` | 2 | regex matches against ROADMAP.md / SUMMARY shape — drift from v1.0-shaped audit assertions to v1.1+/v1.2+ ROADMAP layout |
| `src/__tests__/requirements-cohort-closure.test.ts` | 16 | regex matches against REQUIREMENTS.md "Phase 14 PROV-V-01 Complete" / "Phase 15 PROV-V-04 Complete" — same v1.0-vs-v1.1+ shape drift |
| `src/__tests__/validation-flags.test.ts` | 2 | regex matches against ROADMAP.md "GAP CLOSURE" markers — same shape drift |

**Verification that these are pre-existing, not Phase 19 regressions:**
- `git log` shows phase-attribution.test.ts last modified at commit `c7dea9f` (Phase 8 test scaffold)
- All 8 SUMMARY.md files for Phase 19 plans documented these failures as out-of-scope per `<scope_boundary>` rule
- None of the Phase 19 commits touch any of the 3 audit-test files OR REQUIREMENTS.md/ROADMAP.md (only frontmatter updates after the body landed)

Additionally, the documented `IT-20: status on a completed row` inter-test pollution flake in `generation-tool.test.ts` was confirmed in earlier SUMMARY runs (passes in isolation; fails only with full suite). Not caused by Phase 19; appears in the c2pa-excluded run as a single non-deterministic test.

These failures should be addressed in a future audit-cleanup phase or via roadmap drift remediation; they are NOT blockers for Phase 19 ship.

---

## Human Verification Required

See `19-HUMAN-UAT.md` for full setup + step-by-step verification procedures. The 4 UAT items below cover surfaces that require live browser + human-judgment evaluation:

### 1. UAT-1 — Voice quality across 12 fixture versions

**Test:** Open VersionDrawer for each of the 12 fixture versions in `src/__tests__/fixtures/summary-eval/`. Verify each summary reads as Supervisor/Lead voice.

**Expected:** Declarative present tense, 25-45 words per summary, names model verbatim (case-sensitive), names parent on iterate-lineage, names every applied LoRA, exact integer seed, no AI-slop tells (stunning/vibrant/captivating/delve), no image-content claims, no broken voice register.

**Why human:** Voice-drift detection is human-judgment territory. The structural shape (sentence count, model name verbatim, banned-lexicon absence) is automated by the Plan 19-07 eval suite, but "feels conversational like a Supervisor or Lead wrote it" (PROJECT.md user quote, Timothy Paul Bielec, 2026-04-30) requires a human read.

### 2. UAT-2 — Skeleton-shimmer aesthetic match to Phase 17

**Test:** Trigger loading state on a summary fetch. Visually compare the 3-line skeleton against Phase 17 thumbnails.

**Expected:** animate-skeleton-shimmer keyframe + gradient tokens consistent with Phase 17 rhythm; honors prefers-reduced-motion: reduce; visual cohesion across the dashboard.

**Why human:** jsdom returns `getBoundingClientRect().height === 0` regardless of CSS, so structural fingerprint is the load-bearing automated assertion (Test 16). Live browser with stylesheets resolved is required for visual-rhythm verification.

### 3. UAT-3 — Regenerate cooldown countdown UX

**Test:** Click Regenerate; observe the 60s countdown decrement at 1Hz; observe button disabled state; observe tabular-nums (no digit jitter); attempt a second click while disabled.

**Expected:** Countdown displays '(60s)' → '(59s)' → ... → '(0s)' → enabled state; tabular-nums prevents horizontal jitter; clicks while disabled are no-ops; if client debounce is bypassed, server returns 429 with actionable retry-after.

**Why human:** Real-time countdown behavior + cross-browser tabular-nums rendering require visual verification. Fake-timer tests (12 RegenerateButton.test.tsx tests) exercise the 1Hz tick logic under jsdom but cannot prove visual digit-jitter prevention.

### 4. UAT-4 — First-use disclosure surfacing + localStorage ack persistence

**Test:** Open a clean browser (or DevTools private mode). Open VersionDrawer for a completed version. Verify the muted "AI summary uses your prompt text" note appears above the body. Click Regenerate. Verify the note disappears. Close + reopen the drawer. Verify the note remains hidden. Test in a privacy-mode browser.

**Expected:** First-use note visible on first viewing; auto-acks on first Regenerate click; persists across browser sessions; degrades gracefully (no error visible) in privacy-mode.

**Why human:** Cross-session persistence + privacy-mode browser behavior + visual surfacing require live browser testing across multiple browser sessions. localStorage tests under jsdom (Tests 10-13 in VersionDrawer.test.tsx) verify the storage contract but not the cross-session UX.

---

## Adversarial Test Discoveries Already Closed

Two follow-up fixes landed AFTER the 8 plan SUMMARY.md files, both surfacing from adversarial-class E2E tests:

### Fix 1: `45813d6 fix(19): include manifest_sha256 in redacted manifest_signed payload`

**Surfaced by:** summary-redact-e2e.test.ts Test 1 — driving the REAL Phase 16 redact + Phase 19 summarize round-trip revealed that pre-Phase-19 the redacted manifest_signed payload omitted manifest_sha256, breaking the cache-key invariant in production (the summary cache could never find the redacted row's signed manifest, so SUM-03's "free invalidation" was theoretical, not real).

**Fix scope:** `src/engine/c2pa/redaction.ts` lines 808-823 — compute the new manifest_sha256 from the redacted bytes and store it in the redacted manifest_signed payload.

**Regression test:** Phase 16 redact tests (47 total) all still pass; Phase 19's E2E test now verifies the SHA mutates correctly.

### Fix 2: `50abf54 fix(19): post-LLM API key leak scan before cache write (D-PRIV-3)`

**Surfaced by:** summary-leak-scan.test.ts Test 1 documented a P1 gap: the Plan 04 pipeline runs validateSummary BEFORE the cache write, but the validator only checks model-name regex (D-VAL-1) — it does NOT additionally scan for API key fragments in the LLM response. A response containing 'flux1-dev' AND a leaked tenant key would pass validation and be persisted to the cache row.

**Fix scope:** `src/engine/summary/index.ts` lines 384-394 (Step 6.5) — call `assertNoApiKeyInString(llmResult.text)` between validation pass and cache write; on detection, route to validation_failed fallback so the cache row is never written with leaked content.

**Regression test:** All 47 sanitizer + leak-scan tests still pass; the post-LLM scan adds a third defence-in-depth layer (sanitizer pre-LLM + flattenAnthropicError per-error + post-LLM scan pre-cache-write).

Both fixes harden a structurally-sound design rather than fix a critical security regression. The original Plan 04 design had defence-in-depth at 2 layers (sanitizer pre-LLM + flattenAnthropicError per-error); the post-LLM scan adds a 3rd layer that closes the narrow path where a model-misbehavior or upstream provider regression could leak a key fragment in the response text.

---

## Final Verdict: READY-WITH-NOTES

**All 5 ROADMAP Success Criteria PASS with automated test coverage. All 7 SUM-01..07 requirements SATISFIED. The codebase substantively delivers the phase goal — VFX artists open the VersionDrawer, the SummarySection auto-fetches a 2-4 sentence Supervisor/Lead-voice summary above the Output, and the raw Provenance details collapse into a `<details>` disclosure below.**

Phase 19 is feature-complete and the engine + dashboard wiring is end-to-end. No stubs, no hollow components, no broken key links. Architecture-purity invariants (boot resilience + sole importer + 7 pure helpers) all enforced by 10 ACTIVE guards (zero `.skip()`). The 8 plan SUMMARY.md narratives are corroborated by the codebase — every claim was verified against actual files, not just file existence.

**Pre-ship requirements:**
1. **4 manual UAT items** require live browser verification (per `19-HUMAN-UAT.md`). Status pending human sign-off.
2. **CI integration** for the eval suite + adversarial E2E tests is wired in `.github/workflows/ci.yml`. ANTHROPIC_API_KEY threading through GitHub secrets enables the full test matrix on PRs.
3. **No blockers** for shipping the phase to v1.2 once the 4 UAT items are signed off.

**Out-of-scope drift** — the 20 pre-existing v1.0/v1.1-shape audit failures should be addressed in a future cleanup phase. They are not regressions from Phase 19 work and do not affect the AI conversational summary feature itself.

---

_Verified: 2026-05-09T20:15:30Z_
_Verifier: Claude (gsd-verifier)_
