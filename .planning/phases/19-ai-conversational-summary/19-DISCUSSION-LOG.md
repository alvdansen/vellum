# Phase 19: AI Conversational Summary - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 19-ai-conversational-summary
**Areas discussed:** Privacy & sanitization, LLM model + voice anchor, Fallback content (SUM-06), Output validation (SUM-02)

---

## Privacy & sanitization

### Sanitization stance for the LLM input payload

| Option | Description | Selected |
|--------|-------------|----------|
| Allow-list | Template explicitly names which fields can be sent; everything else stripped. Strongest adversarial defence; mirrors c2pa-node restricted-module precedent. | ✓ |
| Filter (deny patterns) | Send the structured payload as-is BUT run a sanitizer that strips matches for absolute paths, env-var-shaped strings, URLs with credentials, multi-encoding leak scan. | |
| Raw structured blob | Send the structured provenance object as-is. Simplest. Adversarial review will likely block this. | |

**User's choice:** Allow-list (Recommended).
**Notes:** Locks the architectural privacy stance. Each new field surfaced in summaries is now a code change.

### User prompt text NDA handling

| Option | Description | Selected |
|--------|-------------|----------|
| Send verbatim | Same trust boundary as ComfyUI Cloud. Dashboard discloses once on first use. | ✓ |
| Send + per-version opt-out | Default to send; per-version checkbox suppresses LLM call. | |
| Hash-only / structural mode | Send field shapes only (positive_length, has_lora, etc.). Voice quality drops. | |
| Studio mode toggle (env) | VFX_FAMILIAR_AI_SUMMARY_MODE=verbatim\|structural. | |

**User's choice:** Send verbatim (Recommended).
**Notes:** Studio mode toggle deferred to v1.3 if enterprise demand surfaces.

### Logging discipline

| Option | Description | Selected |
|--------|-------------|----------|
| Counts + timings only | { event, version_id, model_id, template_version, duration_ms, tokens, outcome }. Never log prompt/response text. | ✓ |
| Counts + redacted preview | Above PLUS first 80 chars of completion with leak-scan redaction. | |
| Full prompt + completion at DEBUG level | Behind VFX_FAMILIAR_LOG_LEVEL=debug toggle. | |

**User's choice:** Counts + timings only (Recommended).
**Notes:** Multi-encoding leak scan applies to log emission per v1.1 cross-cutting constraint extension.

### API key loading + error hygiene

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 14 c2pa-config pattern | loadAnthropicConfigFromEnv validates at boot via TypedError. Errors emit basenames + last4 only. flattenAnthropicError strips key from caught errors. | ✓ |
| Lazy load + soft fail | Boot succeeds; LLM init throws on first call → circuit breaker tripped. | |
| Boot fail-loud always | ANTHROPIC_API_KEY required for boot regardless. Breaks v1.0/v1.1 setups. | |

**User's choice:** Phase 14 c2pa-config pattern (Recommended).
**Notes:** Mirrors the established Phase 14 boot-fail-before-Engine-construction discipline.

### Prompt injection defence

| Option | Description | Selected |
|--------|-------------|----------|
| Structured + delimited | XML-like blocks with system prompt declaring user_prompt as untrusted. SUM-02 validation regex acts as second gate. | ✓ |
| Structured + suffix re-anchor | Above PLUS suffix re-anchor instruction after the user-prompt block. | |
| Strip control sequences only | Filter for known jailbreak phrases. Brittle. | |

**User's choice:** Structured + delimited (Recommended).
**Notes:** Two-gate defence: prompt-shape gate + output-validation gate.

---

## LLM model + voice anchor

### Anthropic model selection

| Option | Description | Selected |
|--------|-------------|----------|
| Haiku 4.5 | claude-haiku-4-5-20251001. Fastest, cheapest. Cache absorbs most calls. Voice sufficient given few-shot anchoring. | ✓ |
| Sonnet 4.6 | ~3x cost, ~1.5-2s latency. Worth it ONLY if Haiku fails voice eval bar. | |
| Configurable via env | VFX_FAMILIAR_SUMMARY_MODEL env var; defaults to Haiku. | |

**User's choice:** Haiku 4.5 (Recommended).
**Notes:** model_id encoded in cache key so swap is non-breaking later.

### Voice anchor strategy

| Option | Description | Selected |
|--------|-------------|----------|
| System prompt + 3-5 few-shot examples | Style guide system prompt + hand-authored examples covering canonical lineage shapes. | ✓ |
| System prompt only (no examples) | Cheaper, but voice drifts toward generic AI tone. | |
| Examples only, no style guide | Pure few-shot. Anthropic models follow few-shot well; ambiguity on edge cases. | |

**User's choice:** System prompt + 3-5 few-shot examples (Recommended).
**Notes:** Examples are author-curated — not generated. Cover root, iterate, redacted, multi-LoRA, ControlNet shapes.

### Output length constraint

| Option | Description | Selected |
|--------|-------------|----------|
| max_tokens=180, post-process truncation | Hard ceiling at API + sentence-count truncation post-process. Prompt also says "Output 2-4 sentences. No more." | ✓ |
| max_tokens=180, no truncation | Trust the model + prompt. Risk: occasional 5-6 sentence slips. | |
| max_tokens=400, allow longer summaries | Looser budget. Doesn't match the 'tight Supervisor note' aesthetic. | |

**User's choice:** max_tokens=180, post-process truncation (Recommended).

### Temperature

| Option | Description | Selected |
|--------|-------------|----------|
| 0.7 default | Some variety on regenerate; few-shot anchors style consistency. | ✓ |
| 0.3 (mostly deterministic) | Regenerate produces near-identical output. Makes the button feel useless. | |
| 1.0 (high variety) | Voice may drift between regenerations. | |

**User's choice:** 0.7 default (Recommended).

### Anthropic prompt caching

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — cache_control on prefix | cache_control: ephemeral on system + examples (~2k tokens). ~90% prefix cost reduction. | ✓ |
| No — send full prompt every call | Simpler client code; misses a real cost win. | |
| Yes, but disable in tests | Production gets the cost win; tests bypass to avoid time-based eviction. | |

**User's choice:** Yes — cache_control on prefix (Recommended).
**Notes:** Tests bypass via flag (effectively the third option's tests-side concern is honoured). Pure additive optimization.

### template_version stamping

| Option | Description | Selected |
|--------|-------------|----------|
| Semver string in code constant | SUMMARY_TEMPLATE_VERSION exported from src/engine/summary/template.ts. Bumped on prompt/example/sanitizer/format change. | ✓ |
| Hash of template + examples file | Auto-bumps on whitespace too. Spurious cache invalidation. | |
| Date-based stamp at boot | Dev-machine-dependent timestamps. | |

**User's choice:** Semver string in code constant (Recommended).

---

## Fallback content (SUM-06)

### Fallback content shape

| Option | Description | Selected |
|--------|-------------|----------|
| Deterministic template summary + raw provenance disclosure | Mirrors src/engine/diff-summary.ts pattern. Users always see something readable. | ✓ |
| Marker text + raw provenance only | Strict reading of SUM-06; less polish. | |
| Cached previous summary + warning pill | If we have a stale cache row from a different manifest_sha256, show with warning. Risk: stale could leak redacted content. | |

**User's choice:** Deterministic template summary + raw provenance disclosure (Recommended).

### Fallback triggers (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| API key missing or invalid | Boot validation OR runtime 401. | ✓ |
| Circuit breaker tripped | Skip LLM entirely while open. | ✓ |
| Anthropic 5xx / network error | Transient infra failures (after retry exhausted). | ✓ |
| Output validation failure (SUM-02 regex miss) | Model name not present verbatim. | ✓ |

**User's choice:** All four — full coverage of failure paths to fallback.

### Circuit breaker design

| Option | Description | Selected |
|--------|-------------|----------|
| Half-open probe pattern | 5 failures in 60s → OPEN; 5min cooldown then probe; success closes, failure re-opens. In-memory per-process. | ✓ |
| Naive count + fixed cooldown | 5 failures in 60s → OPEN for 5min → CLOSE unconditionally. Risk: thundering herd. | |
| No breaker — per-call timeout only | 10s timeout, fail fast each call. Costs more API calls during outages. | |

**User's choice:** Half-open probe pattern (Recommended).

### Retry policy

| Option | Description | Selected |
|--------|-------------|----------|
| Single retry with 1s backoff | Smooths transient blips; bounded delay (~12s incl 10s timeout). | ✓ |
| No retry — fail fast | Lower latency on outages; thundering breaker trips on Anthropic blips. | |
| Exponential backoff (3 attempts: 1s, 2s, 4s) | More resilient; max ~17s before fallback; UX risk (page feels hung). | |

**User's choice:** Single retry with 1s backoff (Recommended).

### Template-fallback voice

| Option | Description | Selected |
|--------|-------------|----------|
| Plain structural sentences | Mirrors diff-summary.ts. Honest signal of structured output. | ✓ |
| Pseudo-conversational template | Approximates Supervisor voice. Risk: jarring swap when LLM returns. | |
| Just a model-name + seed line | Tightest. Less satisfying fallback. | |

**User's choice:** Plain structural sentences (Recommended).

### Render location

| Option | Description | Selected |
|--------|-------------|----------|
| Same slot, distinct WarningPill | Fallback text in the same Summary section; WarningPill (Phase 12 component) above. | ✓ |
| Separate fallback section above raw provenance | Distinct visual block. Looks like an error banner. | |
| Marker text only in a summary slot | Strict reading; contradicts the deterministic-template choice above. | |

**User's choice:** Same slot, distinct WarningPill (Recommended).

---

## Output validation (SUM-02 / SUM-03)

### Strictness of model-name regex

| Option | Description | Selected |
|--------|-------------|----------|
| Verbatim substring (any model in models_json) | Case-sensitive substring; at least one model_name must match. | ✓ |
| Verbatim AND case-insensitive | More forgiving; case-shifts shouldn't happen with structured input. | |
| All models from models_json must appear | Strictest; risks failing on infrastructure models (VAE, CLIP). | |

**User's choice:** Verbatim substring (any model in models_json) (Recommended).

### Cache-write gating on validation

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — fail-validation → no cache write → Regenerate retries | Caches only verified-good outputs; user can recover via Regenerate. | ✓ |
| Cache the validation outcome too | Persists 'broken' state across sessions; user can't recover. | |
| Cache + Regenerate forces re-call | Compromise; costs more API calls when validation keeps failing. | |

**User's choice:** Yes — fail-validation → no cache write → Regenerate retries (Recommended).

### Redacted-version validation (SUM-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Skip model-name regex; require redaction marker | If redact event present, enforce a redaction-marker regex instead. | ✓ |
| Both regexes — model name AND redaction marker | Strict; fallback when nothing about models survived redaction. | |
| Only redaction marker, no model name | More forgiving; less verifiable grounding in surviving fields. | |

**User's choice:** Skip model-name regex; require redaction marker (Recommended).

### Validator location

| Option | Description | Selected |
|--------|-------------|----------|
| Pure helper in src/engine/summary/validation.ts | Easy to test in isolation; zero MCP/SDK/SQL imports. | ✓ |
| Inline in the engine summary client | Closer to call site; harder to unit test. | |
| Compose validators from primitives | Two helpers + composition. More flexible; test surface explosion risk. | |

**User's choice:** Pure helper in src/engine/summary/validation.ts (Recommended).

---

## Claude's Discretion

The following implementation details were captured as Claude's-discretion territory in CONTEXT.md `<decisions>` (the planner picks based on best practice + research outcomes):

- HTTP route shape: `GET /api/versions/:id/summary` + regenerate path (60s server-side throttle)
- Dashboard `summarySignal` per-version map; pre-fetch on `VersionDrawer` mount
- Regenerate button UX: button label countdown vs disabled-with-tooltip
- Loading state: skeleton text shimmer mirroring `<SkeletonThumbnail/>` aesthetic
- Engine facade: `Engine.summarizeVersion(versionId): Promise<SummaryOutcome>` discriminated-union shape
- Migration 0007 shape: separate `summary_generated` event row vs new column on existing rows (recommend the former for append-only event-row consistency)
- Anthropic SDK lazy-import discipline (mirrors c2pa-node Phase 14 pattern)
- Few-shot example authorship (5 hand-written examples) — authored at plan execution time
- Eval set: small fixture set (8-12 versions) with golden summaries; structural-shape assertions; voice-quality flagged in HUMAN-UAT.md
- Architecture-purity assertion: extend allowed-set with `@anthropic-ai/sdk` restricted to `src/engine/summary/anthropic-client.ts`

## Deferred Ideas

- Streaming summary UX (SSE) — already deferred in REQUIREMENTS.md
- Multi-language translation — already deferred
- Summary editing in dashboard — already deferred (append-only contract)
- Branched-lineage narrative coherence — already deferred
- Configurable VFX_FAMILIAR_SUMMARY_MODEL env override — v1.3 if studio-internal demand surfaces
- Studio mode toggle for hash-only / structural prompt sending (NDA-safe mode) — v1.3 if enterprise demand surfaces
- Eval-set automation for voice-quality drift detection — v1.3
- Two-call prompt architecture (extract facts → write prose) — single-call is v1.2 ship; revisit only if voice fails the eval bar
- Persisted circuit-breaker state across restarts — in-memory per-process is v1.2; SQLite-backed if process-restart thrash becomes an issue
- Per-`model_id` circuit breakers — per-process granularity is v1.2; revisit if multi-model deployments surface
- Granular regenerate-rate UX (countdown vs disabled-with-tooltip) — Claude's discretion territory; planner picks
