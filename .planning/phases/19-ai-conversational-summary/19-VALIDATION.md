---
phase: 19
slug: ai-conversational-summary
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
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
| **Estimated runtime** | ~30-60 seconds (existing baseline) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=basic`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

*Populated by gsd-planner from RESEARCH.md `## Validation Architecture` section. Wave 0 gap list (18 items) drives plan-stage test stubs.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 0 | SUM-* | T-19-* | TBD | unit/integration | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Derived from RESEARCH.md `## Validation Architecture`. Planner must instantiate per-test-file stubs.*

- [ ] `src/__tests__/anthropic-config.test.ts` — boot validation TypedError, basename hygiene, last-4 redaction
- [ ] `src/__tests__/architecture-purity.test.ts` — extend allowed-set with `@anthropic-ai/sdk` restricted to `src/engine/summary/anthropic-client.ts` (sorted-array deepEqual)
- [ ] `src/__tests__/summary/anthropic-client.test.ts` — lazy-import success path, cached binding-load error short-circuit, mock SDK happy path
- [ ] `src/__tests__/summary/sanitizer.test.ts` — allow-list whitelisting, non-allow-listed field stripping, multi-encoding leak scan over output
- [ ] `src/__tests__/summary/validation.test.ts` — verbatim model-name match (case-sensitive), redaction-marker regex branch, empty/missing reasons
- [ ] `src/__tests__/summary/circuit-breaker.test.ts` — CLOSED→OPEN transition (5 failures / 60s), HALF_OPEN probe, OPEN→CLOSED on probe success, OPEN re-opens on probe failure (deterministic with fake clock)
- [ ] `src/__tests__/summary/deterministic-template.test.ts` — fallback content matches `diff-summary.ts` shape (sorted, capped, fallback string for empty)
- [ ] `src/__tests__/summary/template.test.ts` — `SUMMARY_TEMPLATE_VERSION` constant export, system prompt structure, few-shot examples shape
- [ ] `src/__tests__/summary/summarize-version.test.ts` — Engine facade discriminated outcomes (live / cache_hit / fallback / circuit_open / validation_failed); cache write only on validation pass; cache read by `manifest_sha256 + template_version + model_id`
- [ ] `src/__tests__/store/summary-events.test.ts` — append-only event-row insert, idempotency guard (scan-events-and-skip-if-exists), event_type enumeration extension
- [ ] `src/__tests__/leak-scan/summary-cache-leak.test.ts` — API-key-shaped string negative test across UTF-8 / UTF-16LE / UTF-16BE / base64 encodings of persisted cache row
- [ ] `src/__tests__/leak-scan/summary-log-leak.test.ts` — log emission negative test (counts + timings only; no prompt text; no response text; no API key)
- [ ] `src/__tests__/http/summary-routes.test.ts` — `GET /api/versions/:id/summary` happy path + error envelopes (4xx INVALID_INPUT mirroring Phase 18); `POST /api/versions/:id/summary/regenerate` 60s server-side throttle
- [ ] `packages/dashboard/src/__tests__/SummarySection.test.tsx` — loading state (skeleton); success state (text); fallback state (WarningPill + deterministic text + provenance disclosure); regenerate countdown UX
- [ ] `packages/dashboard/src/__tests__/summary-signal.test.ts` — auto-fetch on `version.id` change (mirror Phase 14 C2PA status pattern); cancellation on unmount
- [ ] `src/__tests__/migrations/0007-summary-event.test.ts` — additive `summary_generated_json` column; pre-Phase-19 rows read NULL; backward-compatible with existing event readers
- [ ] `src/__tests__/eval/summary-voice-fixture.test.ts` — 8-12 fixture versions × golden summary structural assertions (sentence count 2-4, mentions model name, mentions parent if iterate)
- [ ] `src/__tests__/integration/summarize-version-flow.test.ts` — end-to-end (Engine call → SDK mock → cache → second call hits cache → redact event → cache miss → fresh generation)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Voice quality of generated summaries | SUM-01 | Voice-drift detection is human-judgment territory; structural shape is automated, but "feels conversational like a Supervisor or Lead wrote it" requires human read | Open VersionDrawer for 8-12 eval fixture versions; verify each summary reads as Supervisor/Lead voice (declarative, present tense, 2-4 sentences); flag in HUMAN-UAT.md |
| Skeleton-shimmer UX during live LLM call | SUM-04 | Visual shimmer aesthetic match to Phase 17 SkeletonThumbnail requires human eye | Open VersionDrawer on a never-summarized version with cold cache; observe shimmer skeleton during ~600ms Haiku latency; verify shimmer matches existing thumbnail skeleton aesthetic |
| Regenerate cooldown countdown UX | SUM-04 | Countdown timer button label vs disabled-with-tooltip is Claude's-discretion territory; user verifies which lands | Click Regenerate; observe cooldown UX; verify cooldown blocks re-click for 60s |
| First-use disclosure surfacing | SUM-01 / D-PRIV-2 | Disclosure copy + placement is Claude's-discretion | Open VersionDrawer first time after summary feature ships; verify "AI summary uses your prompt text" disclosure appears once |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all 18 MISSING references from RESEARCH.md `## Validation Architecture`
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
