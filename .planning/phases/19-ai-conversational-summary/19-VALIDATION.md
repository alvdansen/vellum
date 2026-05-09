---
phase: 19
slug: ai-conversational-summary
status: revised
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-08
revised: 2026-05-09
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Config file** | `vitest.config.ts` (root) + `packages/dashboard/vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=basic` |
| **Full suite command** | `npx vitest run` |
| **Eval suite command** | `npm run test:eval` (Plan 07 + Plan 04 BLOCKER #2 token-count test) |
| **Estimated runtime** | ~30-60 seconds (existing baseline; eval suite adds ~30s with API key) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=basic`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

*Populated by gsd-planner revision-1 from the 8 PLAN.md files (24 tasks across 8 plans). Wave 0 = Plan 19-01 (foundation: SDK pin + error codes + boot validator + migration 0007 + architecture-purity guards).*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-T1 | 01 | 0 | SUM-05 | T-19-01, T-19-02 | Pinned `@anthropic-ai/sdk@0.95.1`; `loadAnthropicConfigFromEnv()` validates ANTHROPIC_API_KEY at boot via TypedError + last-4-only error hygiene | unit | `npx vitest run src/__tests__/anthropic-config.test.ts` | Wave 0 | ⬜ pending |
| 19-01-T2 | 01 | 0 | SUM-05 | T-19-03, T-19-04 | Migration 0007 adds nullable `summary_generated_json` column; `appendSummaryGeneratedEvent` + `getLatestSummaryGeneratedEvent` accessors are append-only; idempotency via cache-key composite scan | unit + integration | `npx vitest run src/__tests__/migrations/0007-summary-event.test.ts` | Wave 0 | ⬜ pending |
| 19-01-T3 | 01 | 0 | SUM-06 | T-19-05, T-19-06, T-19-07 | Architecture-purity test extends allowed-set with `@anthropic-ai/sdk` restricted (sorted-array deepEqual) to `src/engine/summary/anthropic-client.ts`; 6 pure-helper file-level guards + boot-resilience guard (`server.ts` zero static SDK import) staged as `.skip()` | architecture | `npx vitest run src/__tests__/architecture-purity.test.ts` | Wave 0 | ⬜ pending |
| 19-02-T1 | 02 | 2 | SUM-02, SUM-06 | T-19-08, T-19-09, T-19-13b | `sanitizer.ts` iterates ALLOW_LIST (never input keys → prototype-pollution defence); accepts `promptPositive`/`promptNegative` REQUIRED input fields per BLOCKER #1; `assertNoApiKeyInPayload` 4-encoding leak scan over outbound payload INCLUDING prompt content | unit | `npx vitest run src/engine/summary/__tests__/sanitizer.test.ts` | ❌ pending | ⬜ pending |
| 19-02-T2 | 02 | 2 | SUM-03, SUM-06 | T-19-10, T-19-11, T-19-12 | `validation.ts` D-VAL-1 case-sensitive verbatim model-name match + D-VAL-3 case-insensitive redaction-marker check; `deterministic-template.ts` HARD_CAP=320 + redacted-mode round-trip | unit | `npx vitest run src/engine/summary/__tests__/validation.test.ts src/engine/summary/__tests__/deterministic-template.test.ts` | ❌ pending | ⬜ pending |
| 19-02-T3 | 02 | 2 | SUM-06 | T-19-05 | Activate 3 of 6 staged architecture-purity tests for sanitizer.ts / validation.ts / deterministic-template.ts (`.skip()` → active) — verifies pure-helper invariant | architecture | `npx vitest run src/__tests__/architecture-purity.test.ts` | ❌ pending | ⬜ pending |
| 19-03-T1 | 03 | 2 | SUM-06 | T-19-16 | `circuit-breaker.ts` CLOSED→OPEN (5/60s) → HALF_OPEN (after 5min) → CLOSED-on-probe-success / OPEN-on-probe-failure deterministic state machine; injected clock; `__resetCircuitBreakerStateForTests` test hook prevents cross-test contamination | unit | `npx vitest run src/engine/summary/__tests__/circuit-breaker.test.ts` | ❌ pending | ⬜ pending |
| 19-03-T2 | 03 | 2 | SUM-01, SUM-06 | T-19-14, T-19-15, T-19-17, T-19-18 | `template.ts` exports SUMMARY_MODEL_ID + MAX_TOKENS=180 + TEMPERATURE=0.7 + TEMPLATE_VERSION + EXPANDED ~600-token SYSTEM_PROMPT; `templates/few-shot-examples.ts` 5 hand-curated examples expanded ~900-1100 tokens each via `<example_notes>` blocks per BLOCKER #2; `assemblePromptInput` emits `<prompt_positive>`/`<prompt_negative>` XML blocks; XML-escape defence | unit | `npx vitest run src/engine/summary/__tests__/template.test.ts` | ❌ pending | ⬜ pending |
| 19-03-T3 | 03 | 2 | SUM-06 | T-19-05 | Activate 3 remaining staged architecture-purity tests for template.ts / templates/few-shot-examples.ts / circuit-breaker.ts (`.skip()` → active) | architecture | `npx vitest run src/__tests__/architecture-purity.test.ts` | ❌ pending | ⬜ pending |
| 19-04-T1 | 04 | 3 | SUM-01, SUM-05, SUM-06 | T-19-19, T-19-20, T-19-21 | `anthropic-client.ts` is SOLE @anthropic-ai/sdk importer; lazy `await import` + cached load-error short-circuit + `__resetAnthropicSdkStateForTests`; `maxRetries: 0` + `timeout: 10_000` at client + per-request (defence-in-depth); `cache_control: {type: 'ephemeral'}` (D-LLM-5); `flattenAnthropicError` 4-encoding strip + `sk-ant-...` regex defence-in-depth | unit | `npx vitest run src/engine/summary/__tests__/anthropic-client.test.ts` | ❌ pending | ⬜ pending |
| 19-04-T2 | 04 | 3 | SUM-01, SUM-02, SUM-05, SUM-06 | T-19-22, T-19-26 | `summarize-version.ts` engine facade — 8-step pipeline mirrors Engine.signOutput discriminated outcome shape; D-VAL-2 cache-write gate (validation FIRST, write LAST, fallback rows = 0); circuit-breaker integration (record success/failure); regenerate=true skips cache lookup; **BLOCKER #1**: extractInputAssertion KSampler edge walk + parent-label resolution wired BEFORE sanitizeProvenance call (no hardcoded null); **WARNING #10**: 7-reason fallback union (pruned from 9) | integration | `npx vitest run src/engine/summary/__tests__/summarize-version.test.ts` | ❌ pending | ⬜ pending |
| 19-04-T2.5 | 04 | 3 | SUM-01, SUM-06 | T-19-18 | **BLOCKER #2 (revision-1) load-bearing CI gate**: `client.messages.countTokens` runtime SDK assertion proves cached prefix clears Haiku 4.5's 4096-token threshold with 4500-token safety margin (D-LLM-5 dependency); skips cleanly when ANTHROPIC_API_KEY absent | eval | `ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY npx vitest run src/engine/summary/__tests__/token-count.test.ts` | ❌ pending | ⬜ pending |
| 19-04-T3 | 04 | 3 | SUM-01, SUM-05, SUM-06 | T-19-23, T-19-24 | `Engine.summarizeVersion` facade method delegates to pure orchestration via lazy `await import`; `src/server.ts` wires `loadAnthropicConfigFromEnv` + last-4 logging hygiene; activate architecture-purity allowed-set assertion (`.skip()` → live) — confirms `anthropic-client.ts` is the sole SDK importer in src/ via sorted-array deepEqual | architecture + integration | `npx vitest run src/__tests__/architecture-purity.test.ts src/engine/summary/__tests__/summarize-version.test.ts` | ❌ pending | ⬜ pending |
| 19-05-T1 | 05 | 4 | SUM-04, SUM-06 | T-19-27, T-19-28 | `GET /api/versions/:id/summary` returns SummaryOutcome JSON envelope with `regenerate_available_at_ms`; `POST /api/versions/:id/summary/regenerate` enforces 60s server-side throttle keyed by versionId via in-memory Map; throttle violation throws `TypedError('SUMMARY_THROTTLED')` → 4xx via existing error-middleware; VERSION_NOT_FOUND → 404 (only TypedError surface to HTTP per Pattern G) | integration | `npx vitest run src/http/__tests__/summary-routes.test.ts` | ❌ pending | ⬜ pending |
| 19-05-T2 | 05 | 4 | SUM-06 | T-19-29 | `lib/api.ts` `getSummary` + `regenerateSummary` helpers with defensive error-collapse to typed `SummaryFetchResponse`; never propagates raw HTTP errors to component layer | unit | `cd packages/dashboard && npx vitest run src/lib/__tests__/api.test.ts` | ❌ pending | ⬜ pending |
| 19-05-T3 | 05 | 4 | SUM-04, SUM-05, SUM-06 | T-19-30, T-19-31, T-19-32 | `summarySignal` Map-keyed-by-versionId state + `fetchSummary` helper; auto-fetch on `version.id` change with `let alive = true` cancellation pattern (mirrors Phase 14 C2PA status); discriminated `SummaryState` union (loading / success / fallback / error) | unit | `cd packages/dashboard && npx vitest run src/state/__tests__/summaries.test.ts` | ❌ pending | ⬜ pending |
| 19-06-T1 | 06 | 5 | SUM-04, SUM-06 | T-19-39 | 11 named-constant copy strings exported from `lib/copy.ts` (SUMMARY_HEADING / DISCLOSURE_TOGGLE / REGENERATE_*  / WARNING_PILL_FALLBACK_* / SUMMARY_FIRST_USE_*) per UI-SPEC verbatim; `RegenerateButton.tsx` 3 render states (default / cooldown / fetching) + 1Hz `setInterval` countdown + ARIA + `disabled`/`aria-busy` + interval cleanup | unit | `cd packages/dashboard && npx vitest run src/components/__tests__/RegenerateButton.test.tsx` | ❌ pending | ⬜ pending |
| 19-06-T2 | 06 | 5 | SUM-01, SUM-04, SUM-06, SUM-07 | T-19-33, T-19-34, T-19-38 | `SummarySection.tsx` 4 discriminated states (loading skeleton / success / fallback WarningPill+text / error WarningPill+retry); T-5-06 XSS guard (no `dangerouslySetInnerHTML`); SUM-07 children slot for relocated Provenance disclosure; D-PRIV-2 first-use disclosure gated by parent; **BLOCKER #4**: D-FB-6 DOM-stability test — header text/height/slot positions identical across success/fallback states | unit | `cd packages/dashboard && npx vitest run src/components/__tests__/SummarySection.test.tsx` | ❌ pending | ⬜ pending |
| 19-06-T3 | 06 | 5 | SUM-01, SUM-04, SUM-07 | T-19-35, T-19-36, T-19-37 | `VersionDrawer.tsx` 3 surgical changes: `<SummarySection>` inserted ABOVE Output; existing Provenance section relocated inside `<details><summary>Show provenance details</summary>` disclosure (collapsed by default) as SummarySection's children; `useEffect([version.id])` auto-fetch + 500ms client debounce on Regenerate + localStorage first-use ack | integration | `cd packages/dashboard && npx vitest run src/views/__tests__/VersionDrawer.test.tsx` | ❌ pending | ⬜ pending |
| 19-07-T1 | 07 | 6 | SUM-01, SUM-02, SUM-03 | T-19-40, T-19-41 | 12 hand-curated fixture JSON files at `src/__tests__/fixtures/summary-eval/` covering canonical lineage shapes per AI-SPEC §5 Reference Dataset (root × 2, iterate × 4, ControlNet × 2 incl. redacted, redacted-iterate × 1, KSampler-absent × 1, prompt-injection × 1, long-prompt × 1) + README.md documenting eval methodology | unit | `npx vitest run src/__tests__/summary-eval/` | ❌ pending | ⬜ pending |
| 19-07-T2 | 07 | 6 | SUM-01, SUM-02, SUM-03 | T-19-42, T-19-43, T-19-44 | 9 eval dimensions per AI-SPEC §5 Dimensions table: 5 code-based (model-name fidelity / sentence-count + length / anti-feature regression / NDA redaction-marker / API-key leak scan) execute synchronously without API; 4 LLM-judge dimensions (lineage / Supervisor voice register / banned-lexicon AI-slop / LoRA stack) skip cleanly when ANTHROPIC_API_KEY absent | eval | `npm run test:eval` (key set) OR `npx vitest run src/__tests__/summary-eval/eval.test.ts` (no key, code-based only) | ❌ pending | ⬜ pending |
| 19-07-T3 | 07 | 6 | SUM-01, SUM-02 | T-19-45 | Eval suite wired into Vitest test runner via `npm run test:eval` script + extends CI workflow with key-gated job; produces a structured eval report at `src/__tests__/summary-eval/report.json` for CI surfaces | integration | `npm run test:eval` | ❌ pending | ⬜ pending |
| 19-08-T1 | 08 | 6 | SUM-01, SUM-06 | T-19-46, T-19-47 | `telemetry.ts` D-PRIV-3 + AI-SPEC §7 logSummaryEvent with strict counts+timings-only contract (BANNED_FIELDS sweep: text/summary_text/prompt_positive/prompt_negative/user_prompt/system_prompt/response/response_text); 1% deterministic sampling for cache_hit; 4-encoding leak scan refuses emit; **WARNING #5**: `performance.now()` wired at `summarizeVersion` entry → `Math.round(performance.now() - startedAt)` threaded to every logSummaryEvent call site (no `duration_ms: 0` literals survive) | unit + integration | `npx vitest run src/__tests__/summary-telemetry.test.ts` | ❌ pending | ⬜ pending |
| 19-08-T2 | 08 | 6 | SUM-02, SUM-03, SUM-06 | T-19-48, T-19-49, T-19-50 | 3 adversarial-review-class E2E tests: redact-event cache invariant (Phase 16 redact mutates manifest_sha256 → cache miss → fresh generation against redacted payload — mirrors c2pa-redaction-e2e.test.ts pattern); multi-encoding API-key leak scan (synthetic SK injected → real Engine flow → assertNotInBuffer over cache rows / stderr / HTTP envelope); prompt-injection resistance (fixture #11 jailbreak → D-VAL-1 / D-VAL-3 catch via real validateSummary → fallback path); **WARNING #6**: real Engine setup mirrors c2pa-redaction-e2e.test.ts:1-150 (no placeholders) | e2e | `npx vitest run src/__tests__/summary-redact-e2e.test.ts src/__tests__/summary-leak-scan.test.ts src/__tests__/summary-prompt-injection.test.ts` | ❌ pending | ⬜ pending |
| 19-08-T3 | 08 | 6 | SUM-01, SUM-06 | (cross-cutting) | `19-HUMAN-UAT.md` documents 4 manual-only verifications (voice quality / skeleton-shimmer / regenerate countdown / first-use disclosure); `19-ADVERSARIAL-REVIEW.md` 5-surface checklist (prompt-injection / API-key leak / sanitization allow-list bypass / cache poisoning / circuit-breaker state poisoning) with test cross-references per REQUIREMENTS.md cross-cutting mandate | manual | (manual review per HUMAN-UAT.md) | ❌ pending | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Wave 0 = Plan 19-01 staged tests + the foundation files those tests assert against. The 18-item gap list below is reconciled against what Plan 01 actually lands; some items move to later waves as the corresponding files arrive.*

- [x] `src/__tests__/anthropic-config.test.ts` — boot validation TypedError, basename hygiene, last-4 redaction (Plan 19-01 Task 1)
- [x] `src/__tests__/architecture-purity.test.ts` — extend allowed-set with `@anthropic-ai/sdk` restricted to `src/engine/summary/anthropic-client.ts` (sorted-array deepEqual); 6 pure-helper file-level guards staged as `.skip()`; boot-resilience guard (Plan 19-01 Task 3)
- [ ] `src/engine/summary/__tests__/anthropic-client.test.ts` — lazy-import success path, cached binding-load error short-circuit, mock SDK happy path (Wave 3 — Plan 19-04 Task 1)
- [ ] `src/engine/summary/__tests__/sanitizer.test.ts` — allow-list whitelisting, non-allow-listed field stripping, multi-encoding leak scan over output, BLOCKER #1 prompt_positive/prompt_negative passthrough tests (Wave 2 — Plan 19-02 Task 1)
- [ ] `src/engine/summary/__tests__/validation.test.ts` — verbatim model-name match (case-sensitive), redaction-marker regex branch, empty/missing reasons (Wave 2 — Plan 19-02 Task 2)
- [ ] `src/engine/summary/__tests__/circuit-breaker.test.ts` — CLOSED→OPEN transition (5 failures / 60s), HALF_OPEN probe, OPEN→CLOSED on probe success, OPEN re-opens on probe failure (deterministic with fake clock) (Wave 2 — Plan 19-03 Task 1)
- [ ] `src/engine/summary/__tests__/deterministic-template.test.ts` — fallback content matches `diff-summary.ts` shape (sorted, capped, fallback string for empty) (Wave 2 — Plan 19-02 Task 2)
- [ ] `src/engine/summary/__tests__/template.test.ts` — `SUMMARY_TEMPLATE_VERSION` constant export, system prompt structure, few-shot examples shape (5 examples × `<example_notes>` block expansion per BLOCKER #2), char-length proxy for ≥18000 chars, `<prompt_positive>`/`<prompt_negative>` XML emission per BLOCKER #1 (Wave 2 — Plan 19-03 Task 2)
- [ ] `src/engine/summary/__tests__/summarize-version.test.ts` — Engine facade discriminated outcomes (live / cache_hit / 5 fallback variants per WARNING #10 7-reason union); cache write only on validation pass; cache read by `manifest_sha256 + template_version + model_id`; **BLOCKER #1** parent-label + KSampler edge walk wiring (Wave 3 — Plan 19-04 Task 2)
- [ ] `src/engine/summary/__tests__/token-count.test.ts` — **BLOCKER #2** runtime SDK token-count assertion ≥4096 + safety margin ≥4500 with no-key skip branch (Wave 3 — Plan 19-04 Task 2.5)
- [x] `src/__tests__/migrations/0007-summary-event.test.ts` — additive `summary_generated_json` column; pre-Phase-19 rows read NULL; backward-compatible with existing event readers (Plan 19-01 Task 2)
- [ ] `src/http/__tests__/summary-routes.test.ts` — `GET /api/versions/:id/summary` happy path + error envelopes (4xx INVALID_INPUT mirroring Phase 18); `POST /api/versions/:id/summary/regenerate` 60s server-side throttle (Wave 4 — Plan 19-05 Task 1)
- [ ] `packages/dashboard/src/components/__tests__/SummarySection.test.tsx` — loading state (skeleton); success state (text); fallback state (WarningPill + deterministic text + provenance disclosure); regenerate countdown UX; **BLOCKER #4** D-FB-6 DOM-stability test (Wave 5 — Plan 19-06 Task 2)
- [ ] `packages/dashboard/src/state/__tests__/summaries.test.ts` — auto-fetch on `version.id` change (mirror Phase 14 C2PA status pattern); cancellation on unmount (Wave 4 — Plan 19-05 Task 3)
- [ ] `src/__tests__/summary-redact-e2e.test.ts` — end-to-end Phase 16 redact-event cache invariant proof (Wave 6 — Plan 19-08 Task 2)
- [ ] `src/__tests__/summary-leak-scan.test.ts` — multi-encoding leak scan negative test through real Engine flow (no placeholders per WARNING #6) (Wave 6 — Plan 19-08 Task 2)
- [ ] `src/__tests__/summary-prompt-injection.test.ts` — fixture #11 jailbreak → D-VAL-1 / D-VAL-3 catch (Wave 6 — Plan 19-08 Task 2)
- [ ] `src/__tests__/summary-telemetry.test.ts` — telemetry shape + leak-prevention tests on log emissions (WARNING #5 duration_ms threading) (Wave 6 — Plan 19-08 Task 1)
- [ ] `src/__tests__/summary-eval/eval.test.ts` — 8-12 fixture versions × golden summary structural assertions per AI-SPEC §5 Dimensions table (Wave 6 — Plan 19-07 Task 2)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Voice quality of generated summaries | SUM-01 | Voice-drift detection is human-judgment territory; structural shape is automated by Plan 07 eval suite, but "feels conversational like a Supervisor or Lead wrote it" requires human read | Open VersionDrawer for the 12 eval fixture versions; verify each summary reads as Supervisor/Lead voice (declarative, present tense, 2-4 sentences); flag in HUMAN-UAT.md |
| Skeleton-shimmer UX during live LLM call | SUM-04 | Visual shimmer aesthetic match to Phase 17 SkeletonThumbnail requires human eye | Open VersionDrawer on a never-summarized version with cold cache; observe shimmer skeleton during ~600ms Haiku latency; verify shimmer matches existing thumbnail skeleton aesthetic |
| Regenerate cooldown countdown UX | SUM-04 | Countdown timer button label vs disabled-with-tooltip is Claude's-discretion territory; user verifies which lands | Click Regenerate; observe cooldown UX; verify cooldown blocks re-click for 60s |
| First-use disclosure surfacing | SUM-01 / D-PRIV-2 | Disclosure copy + placement is Claude's-discretion | Open VersionDrawer first time after summary feature ships; verify "AI summary uses your prompt text" disclosure appears once |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (24 tasks across 8 plans, mapped above)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has a vitest command listed)
- [x] Wave 0 covers the foundation tests + staged architecture-purity guards landed in Plan 19-01
- [x] No watch-mode flags
- [x] Feedback latency < 60s for the per-task vitest commands
- [x] `nyquist_compliant: true` set in frontmatter
- [x] BLOCKER #1 (KSampler edge walk + parent-label resolution) has explicit test entries (19-04-T2)
- [x] BLOCKER #2 (runtime token-count assertion) has explicit test entry (19-04-T2.5)
- [x] BLOCKER #4 (D-FB-6 DOM-stability test) has explicit test entry (19-06-T2)
- [x] WARNING #5 (telemetry duration_ms wiring) has explicit grep guards in 19-08-T1
- [x] WARNING #6 (leak-scan placeholder fixes) has explicit grep guards in 19-08-T2
- [x] WARNING #10 (SummaryOutcome reason union pruning) reflected in 19-04-T2 secure-behavior cell

**Approval:** approved by gsd-planner revision-1 on 2026-05-09
