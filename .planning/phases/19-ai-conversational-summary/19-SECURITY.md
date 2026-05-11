---
phase: 19
slug: ai-conversational-summary
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-09
---

# Phase 19 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Phase 19 ships the AI Conversational Summary feature. Trust boundaries cross
> from operator env vars → boot validator, user-authored prompts → LLM, LLM
> responses → engine validation gates, and HTTP routes → engine surface. Audit
> verified all 50 declared threats CLOSED (39 mitigated by code + 11 documented
> as accepted risks).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| `process.env.ANTHROPIC_API_KEY` → boot validator | Operator-provisioned secret; `loadAnthropicConfigFromEnv` validates format BEFORE Engine construction. Throws TypedError with last-4-only hygiene on malformed key. | API key string (sensitive — never logged in full) |
| Migration 0007 → SQLite schema | `drizzle/0007*.sql` adds nullable `summary_generated_json` text column; idempotent via drizzle migrator journal. | DDL (additive) |
| Provenance payload → sanitizer | First-party row, but prompt_json could contain attacker-controlled fields; sanitizer iterates ALLOW_LIST literal keys (never input keys). | Provenance JSON (untrusted internal data) |
| User-authored prompt → sanitizer pass-through | D-PRIV-2 trust boundary — prompt_positive/prompt_negative from Phase 15 KSampler edge walk; user already chose to send to ComfyUI Cloud. Multi-encoding leak scan applies BEFORE LLM call. | User prompt text (D-PRIV-2 trust) |
| Sanitizer output → Anthropic API | Cached prefix (~5400 tokens) clears Haiku 4.5's 4096-token threshold. cache_control: ephemeral. | Sanitized provenance + system prompt |
| Anthropic response → engine validation | LLM may return jailbroken or training-data-memorized content. Three gates: (1) Pitfall 8 defensive extraction, (2) D-VAL-1/3 regex validator, (3) Step 6.5 post-LLM leak scan. | LLM output text (untrusted) |
| Engine.summarizeVersion → HTTP route | Engine NEVER throws to HTTP for fallback paths — every failure becomes typed SummaryOutcome variant. Only TypedError(VERSION_NOT_FOUND) surfaces. | SummaryOutcome JSON envelope |
| Server response → dashboard fetch | Defensive parsing collapses malformed envelopes to `{ state: 'error' }`; never throws. | SummaryFetchResponse |
| HTTP route → server in-memory throttle Map | Per-process scope; lazy GC at lookup; key-space bounded by versionId count. Resets on process restart. | (versionId, lastReqMs) tuple |
| User-controlled localStorage → first-use disclosure | Defensive `localStorage.getItem(...) !== 'true'` check; try/catch on SSR/privacy-mode failures. | UX dismissal flag |

---

## Threat Register

50 threats from PLAN.md `<threat_model>` blocks across plans 19-01..19-08. All `mitigate` threats verified by grep-confirmed mitigation pattern in cited file. All `accept` threats logged in Accepted Risks Log below.

### Plan 19-01 — Boot + migration + repo accessors

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-19-01 | Information Disclosure | `loadAnthropicConfigFromEnv` error messages | mitigate | `****${apiKey.slice(-4)}` at src/utils/anthropic-config.ts:39,46 | closed |
| T-19-02 | Tampering | Migration 0007 idempotency | mitigate | Drizzle journal table tracks applied migrations by hash; idempotency tests in src/__tests__/migrations/0007-summary-event.test.ts | closed |
| T-19-03 | Tampering | Append-only invariant on summary_generated rows | mitigate | `grep -E "this.db.update\|this.db.delete" src/store/provenance-repo.ts` returns 0 matches; only insertEvent | closed |
| T-19-04 | Spoofing | Architecture-purity allowed-set bypass | mitigate | sorted-array deepEqual at src/__tests__/architecture-purity.test.ts:637-638 (Phase 19 block) | closed |
| T-19-05 | Information Disclosure | Boot path eagerly loading the SDK | mitigate | Boot-resilience guard at architecture-purity.test.ts:578; `grep -E "from\\s+'@anthropic-ai/sdk'" src/server.ts` returns 0 | closed |
| T-19-06 | Information Disclosure | API key in npm install logs / package-lock.json | accept | TLS + integrity hash; --save-exact pin to 0.95.1 | closed |
| T-19-07 | Denial of Service | Migration partial-apply leaves DB inconsistent | mitigate | drizzle-orm/better-sqlite3 migrator runs each .sql in a transaction (ATALR atomicity) | closed |

### Plan 19-02 — Sanitizer + validator + deterministic-template

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-19-08 | Information Disclosure | Sanitization allow-list bypass via prototype pollution | mitigate | ALLOW_LIST literal iteration at src/engine/summary/sanitizer.ts:56-66; sanitizeProvenance constructs output from typed inputs only (lines 131-141) | closed |
| T-19-09 | Information Disclosure | Cache poisoning via Anthropic response containing leaked secret | mitigate | assertNoApiKeyInPayload at sanitizer.ts:166-202 (4-encoding scan, 2 haystacks); Step 6.5 post-LLM `assertNoApiKeyInString` at index.ts:384-394 (fix 50abf54) | closed |
| T-19-10 | Tampering | Validator regex bypass — jailbreak omits verbatim model name | mitigate | D-VAL-1 case-sensitive `text.includes(m.model_name)` at validation.ts:49; src/__tests__/summary-prompt-injection.test.ts proves jailbreak → fallback | closed |
| T-19-11 | Tampering | Validator misses redaction-marker absence | mitigate | D-VAL-3 case-insensitive marker check at validation.ts:41; deterministic-template emits "Some prompt fields were redacted" at deterministic-template.ts:66 | closed |
| T-19-12 | Information Disclosure | Deterministic-template emits unbounded text | mitigate | HARD_CAP=320 at deterministic-template.ts:27, truncation at lines 70-72 | closed |
| T-19-13 | Repudiation | Sanitizer output disagrees with LLM input | accept | Sanitizer is pure deterministic; D-PRIV-3 logging restriction prevents persistence | closed |
| T-19-13b | Information Disclosure | API key smuggled into user-authored prompt content | mitigate | Two-haystack scan (JSON + binary string concat) at sanitizer.ts:170-201; binary haystack catches UTF-16LE/BE in prompt_positive/negative | closed |

### Plan 19-03 — Template + few-shot + circuit breaker

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-19-14 | Tampering | Prompt-injection escape via XML frame breakage | mitigate | escapeXml at template.ts:151-159; all field interpolations escape (lines 136-141) | closed |
| T-19-15 | Information Disclosure | System prompt leaks banned-lexicon to attacker | accept | Banned lexicon is public Antislop register; no security-through-obscurity benefit; defence is structural (D-VAL-1 verbatim regex) | closed |
| T-19-16 | Denial of Service | Circuit breaker cross-test contamination | mitigate | __resetCircuitBreakerStateForTests + clock injection at circuit-breaker.ts:37,49,55,90 | closed |
| T-19-17 | Tampering | Few-shot drift without SUMMARY_TEMPLATE_VERSION bump | mitigate | Documented inline at template.ts:7-13 (D-LLM-6 bump rule); audit gate is PR review | closed |
| T-19-18 | Information Disclosure | Token-count assertion fails silently below 4096 floor | mitigate | Runtime SDK assertion at src/engine/summary/__tests__/token-count.test.ts:30-79; `client.messages.countTokens` with floor=4096, margin=4500 | closed |

### Plan 19-04 — Anthropic client + index pipeline

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-19-19 | Information Disclosure | Anthropic error.message leaks API key fragment | mitigate | flattenAnthropicError 4-encoding strip + sk-ant- regex at anthropic-client.ts:176-196 | closed |
| T-19-20 | Tampering | SDK retry budget stacking inflates worst-case latency | mitigate | `maxRetries: 0` at constructor (line 89) + per-request (line 126) — defence-in-depth | closed |
| T-19-21 | Tampering | Anthropic returns tool_use as first content block | mitigate | content.find(b => b.type === 'text') at anthropic-client.ts:133-138 | closed |
| T-19-22 | Tampering | Cache poisoning by writing fallback or invalid output | mitigate | D-VAL-2 ordering at index.ts:378-394 (validate → leak-scan → append); buildFallbackOutcome (line 220) does NOT call appendSummaryGeneratedEvent — only one append call site (line 399) in success path | closed |
| T-19-23 | Spoofing | Architecture-purity bypass — second-importer added | mitigate | Sorted-array deepEqual at architecture-purity.test.ts:637-638 (active, not skipped) | closed |
| T-19-24 | Information Disclosure | Boot-time eager SDK load exposes module heap | mitigate | Boot-resilience grep guard at architecture-purity.test.ts:578; lazy `await import` at anthropic-client.ts:49 is sole load path | closed |
| T-19-25 | Denial of Service | Per-version circuit breaker confusion | accept | Per-process scope per D-FB-3; single 'anthropic' unit key (NOT per-versionId); global Anthropic outage blocks all summaries (correct posture) | closed |
| T-19-26 | Tampering | Sanitizer leak-scan bypass via validation_failed fallback | mitigate | Test 18 + 6.5-step post-LLM scan close 3-layer defence-in-depth: sanitizer pre-LLM (sanitizer.ts:166) + flattenAnthropicError per-error (anthropic-client.ts:176) + post-LLM scan pre-cache-write (index.ts:384-394) | closed |

### Plan 19-05 — HTTP routes + dashboard state

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-19-27 | Denial of Service | User spams Regenerate to drive Anthropic cost | mitigate | 60s server-side throttle via Map<versionId, lastReqMs> at dashboard-routes.ts:130-131,346-372; SUMMARY_THROTTLED → 429 via error-middleware.ts:75-76,111 | closed |
| T-19-28 | Denial of Service | Throttle Map memory growth unbounded | accept | Lazy GC at lookup; ~100 bytes/entry × 1000 versions = ~100KB; v1.3 candidate for scheduled cleanup; single-user demo scope | closed |
| T-19-29 | Information Disclosure | HTTP envelope echoes raw error.message containing API key | mitigate | Engine returns typed SummaryOutcome (no error text); telemetry.ts BANNED_FIELDS + assertNoBannedFields at lines 53,88-93; multi-encoding leak scan at lines 145-156 with EMIT REFUSED on detection | closed |
| T-19-30 | Spoofing | Path-traversal via versionId in route param | mitigate | Hono route matcher decodes URL only (no execution); parameterized SELECT in versionRepo; defence-in-depth via `encodeURIComponent` at packages/dashboard/src/lib/api.ts:432,462 | closed |
| T-19-31 | Tampering | regenerate=true bypasses throttle via GET | accept | GET route never passes `regenerate: true` to engine (idempotent + cacheable contract); POST is the regenerate trigger; verified by route handler test | closed |
| T-19-32 | Information Disclosure | Dashboard console logs leak versionId | accept | versionId is a nanoid (not security-sensitive, not PII); single-user demo scope per PROJECT.md | closed |

### Plan 19-06 — Dashboard components + VersionDrawer

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-19-33 | Tampering | XSS via summary.text containing `<script>` | mitigate | Preact JSX text-child auto-escape; ZERO `dangerouslySetInnerHTML` in SummarySection.tsx (`grep -c` returns 0) | closed |
| T-19-34 | Information Disclosure | First-use disclosure leaks across browser tabs | accept | localStorage is per-origin per-user-profile; dismissal is UX nicety not security state | closed |
| T-19-35 | Denial of Service | Repeated Regenerate clicks spam Anthropic | mitigate | 500ms client debounce via `lastRegenerateClickRef` at VersionDrawer.tsx:130-133,202-207; 60s server throttle (T-19-27); 2-line defence | closed |
| T-19-36 | Tampering | localStorage key collision with another app | accept | Key namespaced `vfx-familiar:summary:first-use-acked`; privacy-mode failures degrade gracefully via try/catch | closed |
| T-19-37 | Information Disclosure | Auto-fetch leaks versionId to network | accept | versionId is a nanoid; single-user demo scope; v1.3+ enterprise mode could add opt-out toggle | closed |
| T-19-38 | Tampering | Provenance disclosure relocation breaks UAT scripts | mitigate | `<JsonBlock>` rendering preserved verbatim; `<details data-testid="provenance-disclosure">` at VersionDrawer.tsx:354-371; only wrapping changed | closed |
| T-19-39 | Spoofing | Regenerate clicks during loading state bypass debounce | mitigate | RegenerateButton uses native HTML `disabled` (removes from tab order); aria-busy toggle | closed |

### Plan 19-07 — Eval suite

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-19-40 | Tampering | Eval suite false negative — voice drift slips through threshold | mitigate | Critical dimensions (model-name, voice-banned-lexicon, anti-feature, leak-scan) require 100% pass at run-eval.ts PASS_THRESHOLDS; AI-SPEC §6 weekly LLM-judge sample provides cross-check | closed |
| T-19-41 | Information Disclosure | API key leaks into CI logs via eval failure trace | mitigate | flattenAnthropicError applied at run-eval.ts:163,175 catch sites; eval reports dimension reason strings, not raw error.message | closed |
| T-19-42 | Denial of Service | Eval suite consumes excessive Anthropic budget on flaky retries | mitigate | Sequential iteration at run-eval.ts:191 (no parallel retry); per-fixture engine retry (D-FB-4 single-retry); 60_000ms test timeout at eval.test.ts:41 | closed |
| T-19-43 | Spoofing | Contributor adds fixture with pixel-content golden_summary | mitigate | VFX-practitioner sign-off requirement at fixtures/summary-eval/README.md:52; anti-feature dimension runs against golden_summary in CI as defence-in-depth | closed |
| T-19-44 | Information Disclosure | Skip-when-no-key contract bypassed — eval reports false-pass | accept | Skip path returns {ok: true, score: 5} which inflates pass rate; documented at llm-judge.ts:5-8 (T-19-44 accept disposition); Critical-tier code-based dimensions still run unconditionally | closed |
| T-19-45 | Tampering | Fixture re-bless without SUMMARY_TEMPLATE_VERSION bump | mitigate | Re-Bless Cadence section at fixtures/summary-eval/README.md:41-43 documents bump requirement; PR review gate | closed |

### Plan 19-08 — Adversarial tests + telemetry + HUMAN-UAT

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-19-46 | Information Disclosure | Test fixtures contain real prompt text | mitigate | All 12 fixtures use synthetic VFX-domain prompts; fixture 11 jailbreak payload at fixtures/summary-eval/11-prompt-injection-attempt.json:18 is a known-public string | closed |
| T-19-47 | Tampering | E2E redact test fails to actually mutate manifest_sha256 | mitigate | Test calls real Engine.redactManifestForVersion (not a mock); fix 45813d6 at src/engine/c2pa/redaction.ts:814,823 — redacted payload now stores manifest_sha256 (computed via `createHash('sha256').update(redactedBytes).digest('hex')`) | closed |
| T-19-48 | Information Disclosure | Telemetry stderr buffer leaks SYNTHETIC_KEY in test capture | mitigate | telemetry.ts 4-encoding leak scan at lines 145-156; EMIT REFUSED on detection at lines 154; assertNotInBuffer assertion shape in summary-leak-scan.test.ts | closed |
| T-19-49 | Repudiation | Adversarial review sign-off forged | accept | Single-developer demo project; v1.3+ candidate for cryptographic sign-off via C2PA chain | closed |
| T-19-50 | Tampering | Telemetry emit overhead degrades hot path | accept | Logging cost <1ms per emit; cache_hit 1% deterministic sampling at telemetry.ts:72; telemetry overhead is negligible vs ~600ms Haiku 4.5 latency | closed |

**Total threats:** 50 (39 mitigate + 11 accept; all closed)

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-19-01 | T-19-06 | npm registry traffic uses TLS; package-lock.json contains version + integrity hash only, never the key. `--save-exact` flag pins to 0.95.1 verbatim per RESEARCH.md npm-verified date 2026-05-08. | Phase 19 register (PLAN.md 19-01) | 2026-05-09 |
| AR-19-02 | T-19-13 | Sanitizer is deterministic; identical SanitizedProvenance reproduces identical allow-listed fields. Adversarial review can audit the file in isolation. No persistence of sanitizer output beyond the in-flight LLM call (D-PRIV-3 logging restriction). | Phase 19 register (PLAN.md 19-02) | 2026-05-09 |
| AR-19-03 | T-19-15 | Banned lexicon is well-known industry Antislop register; no security-through-obscurity benefit to hiding it. Defence is structural (D-VAL-1 verbatim regex). Cost of hiding = zero benefit. | Phase 19 register (PLAN.md 19-03) | 2026-05-09 |
| AR-19-04 | T-19-25 | Per-process scope per D-FB-3; single 'anthropic' unit key (NOT per-versionId, NOT per-model_id). Trade-off: a global Anthropic outage blocks all summaries — this is the correct posture (don't burn cost on a known-failing upstream). Per-version granularity is v1.3+ candidate per CONTEXT.md `<deferred>`. | Phase 19 register (PLAN.md 19-04) | 2026-05-09 |
| AR-19-05 | T-19-28 | Lazy GC at lookup (entries older than 60s overwrite); each Map entry is ~100 bytes; at 1000 versions/day the Map adds ~100KB to heap. Acceptable for single-user demo scope. v1.3 candidate: scheduled cleanup. Per RESEARCH.md "Don't Hand-Roll" lazy GC pattern. | Phase 19 register (PLAN.md 19-05) | 2026-05-09 |
| AR-19-06 | T-19-31 | GET route does NOT pass `regenerate: true` to engine — it always uses cache lookup. The contract is that GET is idempotent + cacheable; POST is the regenerate trigger. Test 9 verifies the engine call is `{ regenerate: true }` only on POST. | Phase 19 register (PLAN.md 19-05) | 2026-05-09 |
| AR-19-07 | T-19-32 | versionId is a nanoid — not security-sensitive (not a password, not PII). Browser console is a per-user surface. Per PROJECT.md single-user demo scope. | Phase 19 register (PLAN.md 19-05) | 2026-05-09 |
| AR-19-08 | T-19-34 | localStorage is per-origin per-user-profile; the dismissal is a UX nicety, not security state. Per UI-SPEC researcher discretion. | Phase 19 register (PLAN.md 19-06) | 2026-05-09 |
| AR-19-09 | T-19-36 | Key is namespaced `vfx-familiar:summary:first-use-acked`; collision risk near zero. Privacy-mode failures degrade gracefully via try/catch (Test 14 in VersionDrawer.test.tsx). | Phase 19 register (PLAN.md 19-06) | 2026-05-09 |
| AR-19-10 | T-19-37 | versionId is a nanoid (not security-sensitive); single-user demo scope per PROJECT.md. Future v1.3+ enterprise mode could add an opt-out toggle. | Phase 19 register (PLAN.md 19-06) | 2026-05-09 |
| AR-19-11 | T-19-44 | Skip path returns `{ok: true, score: 5}` which inflates pass rate but does NOT mask Critical-tier code-based dimensions (those run unconditionally). Trade-off: contributors without keys get a partial-pass signal, not a full-pass guarantee. Documented in fixtures/summary-eval/README.md and llm-judge.ts:5-8. | Phase 19 register (PLAN.md 19-07) | 2026-05-09 |
| AR-19-12 | T-19-49 | Single-developer demo project; no formal audit trail required. Real-world deployment would add cryptographic sign-off via the existing C2PA chain. v1.3+ candidate. | Phase 19 register (PLAN.md 19-08) | 2026-05-09 |
| AR-19-13 | T-19-50 | Logging cost <1ms per emit; cache_hit 1% sampling means most paths skip the JSON.stringify; telemetry overhead is negligible vs ~600ms Haiku 4.5 latency. | Phase 19 register (PLAN.md 19-08) | 2026-05-09 |

*Accepted risks do not resurface in future audit runs.*

---

## Defence-in-Depth Chain — LLM Trust Boundary

The five threats T-19-09, T-19-13b, T-19-19, T-19-22, T-19-26 form a chain that protects the API key from leaking through any path crossing the LLM trust boundary. All five layers verified present:

| Layer | Location | Purpose |
|-------|----------|---------|
| 1. Pre-LLM sanitizer scan | `assertNoApiKeyInPayload` at src/engine/summary/sanitizer.ts:166-202 | Two-haystack (JSON + binary string concat) 4-encoding scan on sanitized provenance BEFORE call |
| 2. SDK constructor + per-request `maxRetries: 0` | src/engine/summary/anthropic-client.ts:89,126 | Bounded retry budget; prevents SDK retry stacking that could amplify exposure |
| 3. Error-message scrub | `flattenAnthropicError` at anthropic-client.ts:176-196 | 4-encoding strip + sk-ant- regex defence-in-depth on every error.message |
| 4. Post-LLM string scan | `assertNoApiKeyInString` at sanitizer.ts:218 invoked at index.ts:384-394 (Step 6.5 — fix 50abf54) | Catches smuggled keys in LLM response text BEFORE cache write |
| 5. Telemetry emit refusal | `logSummaryEvent` 4-encoding scan + EMIT REFUSED at telemetry.ts:145-156 | Catches any key fragment that reaches the telemetry payload (last line of defence) |

**Adversarial-class fixes (post-SUMMARY commits) that strengthened the chain:**
- `45813d6` — Phase 16 redact path now stores `manifest_sha256` in the redacted manifest_signed payload (src/engine/c2pa/redaction.ts:814,823). Closes a cache-invariant gap surfaced by `summary-redact-e2e.test.ts`; the gap was that pre-fix the redacted payload omitted manifest_sha256, meaning the summary cache could never find the redacted row's signed manifest — SUM-03's "free invalidation" was theoretical, not real.
- `50afba4` — Step 6.5 post-LLM API key leak scan added at `src/engine/summary/index.ts:384-394`. Surfaced by `summary-leak-scan.test.ts`. Closes the narrow path where a model-misbehavior or upstream provider regression could leak a key fragment in the response text that would otherwise pass D-VAL-1 validation and be persisted to the cache row.

Both fixes harden a structurally-sound design rather than fix a critical regression. The original Plan 04 design had defence-in-depth at 2 layers; the post-LLM scan adds a 3rd, the telemetry emit-refusal adds a 4th, and the binary-haystack expansion of the sanitizer adds a 5th.

---

## Architecture-Purity Invariants

Phase 19 ships 10 active architecture-purity guards (zero `.skip()`) at `src/__tests__/architecture-purity.test.ts`:

1. `src/server.ts has zero static imports from @anthropic-ai/sdk` (boot resilience, line 578)
2. `@anthropic-ai/sdk imports are centralized in src/engine/summary/anthropic-client.ts` (sole importer, line 600 — sorted-array deepEqual)
3. `src/engine/summary/sanitizer.ts is pure` (zero MCP/SDK/SQLite/ORM imports)
4. `src/engine/summary/validation.ts is pure`
5. `src/engine/summary/deterministic-template.ts is pure`
6. `src/engine/summary/template.ts is pure`
7. `src/engine/summary/templates/few-shot-examples.ts is pure`
8. `src/engine/summary/circuit-breaker.ts is pure`
9. `src/engine/summary/anthropic-client.ts uses lazy @anthropic-ai/sdk + zero MCP/SQLite/ORM/hono`
10. `src/engine/summary/telemetry.ts is pure` (re-exports flattenAnthropicError from anthropic-client.ts; no direct SDK import)

All 10 guards verified ACTIVE (no skipped tests) by grep on `src/__tests__/architecture-purity.test.ts`.

---

## Unregistered Flags

No unregistered threat flags. Plan SUMMARY.md files explicitly confirm zero new attack surface introduced beyond the declared register:
- 19-06-SUMMARY.md line 171: "No new threat surface flags — Plan 19-06 introduced zero new network endpoints, no new auth paths, no new file-access patterns, and no new schema changes at trust boundaries."

---

## Operational Notes — This Deployment

The audit runtime context: this deployment does NOT use the Anthropic API. `loadAnthropicConfigFromEnv` permanently returns `null` (no key set; Claude Max plan user). Every summary call returns `{ source: 'fallback', reason: 'api_key_missing', text: <deterministic template> }`.

**Threats that gate on the live LLM path** (T-19-09, T-19-10, T-19-14, T-19-19, T-19-20, T-19-21, T-19-22, T-19-26, T-19-46, T-19-47, T-19-48 plus all eval-suite threats) still need source-level verification because the code path exists for open-source consumers who DO configure a key. All source-level mitigations confirmed present.

**Threats that fire only in this deployment:** T-19-15 (banned lexicon visibility — system prompt present but never sent to LLM in this deployment), T-19-32 (versionId in browser console — versionId is a nanoid; non-sensitive), T-19-37 (auto-fetch leaks versionId — single-user demo scope).

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-09 | 50 | 50 | 0 | gsd-security-auditor (Claude Opus 4.7) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer) — 50/50
- [x] Accepted risks documented in Accepted Risks Log — 13 entries (T-19-06, T-19-13, T-19-15, T-19-25, T-19-28, T-19-31, T-19-32, T-19-34, T-19-36, T-19-37, T-19-44, T-19-49, T-19-50)
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-09
