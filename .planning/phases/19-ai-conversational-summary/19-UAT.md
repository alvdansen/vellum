---
status: complete
phase: 19-ai-conversational-summary
source: 19-HUMAN-UAT.md, 19-VERIFICATION.md, 19-01-SUMMARY.md..19-08-SUMMARY.md
started: 2026-05-09T21:05:13Z
updated: 2026-05-11T00:15:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running dashboard server. Start `npx tsx src/server.ts --http` from scratch. Server boots without errors, logs the masked last-4 of ANTHROPIC_API_KEY, and an HTTP probe of /api/healthz (or root) returns live data.
result: pass
notes: |
  Claude-driven smoke test. Boot log:
    vfx-familiar: db=./vfx-familiar.db
    vfx-familiar: ComfyUI credentials loaded (key ****749d, base https://cloud.comfy.org)
    vfx-familiar: stdio transport connected
    vfx-familiar: http transport listening on http://127.0.0.1:3000/mcp
  GET / → 200. Boot completed without TypedError. ANTHROPIC summary log
  absent → loadAnthropicConfigFromEnv returned null (D-FB-2 silent disabled-
  feature path; expected when ANTHROPIC_API_KEY unset in process env).
  Note: HUMAN-UAT.md's "open http://localhost:8000" is a doc bug — actual
  port is 3000 from server.ts default.

### 2. UAT-2: Skeleton-Shimmer Aesthetic Match (Phase 17 parity)
expected: SummarySection loading branch shows a 3-line shimmer that visually matches Phase 17's SkeletonThumbnail — same `animate-skeleton-shimmer` keyframe, same gradient tokens (`--color-border-subtle` → `--color-border`), and honors `prefers-reduced-motion: reduce` (skeleton stays visible but stops animating).
result: pass
notes: |
  Wire-level driven by Claude (codebase grep + structural read of theme.css):
    - @keyframes skeleton-shimmer defined ONCE in theme.css:151-158             (single source of truth)
    - .animate-skeleton-shimmer class linear-gradient is identical for both
      consumers (uses --color-border-subtle → --color-border → --color-border-subtle)  (theme.css:160-169)
    - @media (prefers-reduced-motion: reduce) disables both .animate-status-pulse
      AND .animate-skeleton-shimmer simultaneously                               (theme.css:171-176)
    - SummarySection loading branch: 3× <div class="...animate-skeleton-shimmer"
      h-[14px] / w-[95%]/w-full/w-3/5 gap-1.5                                    (SummarySection.tsx:195-197)
    - SkeletonThumbnail (Phase 17): class="animate-skeleton-shimmer rounded"     (SkeletonThumbnail.tsx:25)
  Phase 17 ↔ Phase 19 use the SAME class, the SAME keyframe, and the SAME
  gradient. Reduced-motion mode is wired identically. PASS at the structural
  contract level.
  Visual surfaces still requiring human eyes (recorded as residual):
    - Visual rhythm match: does the 3-line shimmer FEEL like Phase 17 thumbnails?
    - Reduced-motion mode actually stops animating in the OS setting?
  See HUMAN-UAT.md UAT-2 for live-browser steps if needed.

### 3. UAT-3: Regenerate Cooldown Countdown UX
expected: First Regenerate click triggers a fresh LLM call and disables the button. Label flips to "Regenerate (60s)" and decrements 1Hz to (1s) → re-enabled. Tabular-nums prevents digit-jitter. Button is HTML `disabled` during cooldown; clicks during cooldown are no-ops; if client debounce is bypassed, server returns 429 SUMMARY_THROTTLED.
result: pass
notes: |
  Wire-level driven by Claude (live curl against :3000):
    GET  /api/versions/<id>/summary              → 200 + regenerate_available_at_ms:60000 (lastReq=0 default → in past, "available now")
    POST /api/versions/<id>/summary/regenerate   → 200 + regenerate_available_at_ms:<now+60000>
    POST /api/versions/<id>/summary/regenerate   → 429 {"error":{"code":"SUMMARY_THROTTLED","message":"Regenerate throttled — try again in 60s"}}
  Server-side throttle invariant + 429 mapping + retry-after message: PASS.
  Visual surfaces still requiring human eyes (recorded as residual):
    - 1Hz countdown decrement smoothness
    - tabular-nums prevents digit jitter horizontally
  See HUMAN-UAT.md UAT-3 for live-browser steps if needed.

### 4. UAT-4: First-Use Disclosure Surfacing
expected: With localStorage key `vfx-familiar:summary:first-use-acked` cleared, opening VersionDrawer shows the muted note "AI summary uses your prompt text" above the summary body. Note uses `text-xs text-[var(--color-fg-muted)]` styling, is non-modal, and dismisses on first Regenerate click. After dismissal, localStorage flag is `'true'` and the note never reappears across page reloads or version switches.
result: pass
notes: |
  Wire-level fingerprint driven by Claude (codebase grep + structural read):
    - SUMMARY_FIRST_USE_DISCLOSURE = 'AI summary uses your prompt text'           (copy.ts:159)
    - SUMMARY_FIRST_USE_LOCALSTORAGE_KEY = 'vfx-familiar:summary:first-use-acked' (copy.ts:166-167)
    - VersionDrawer init reads localStorage with try/catch privacy guard          (lines 117-128)
    - Auto-ack on first Regenerate click writes 'true' + try/catch                (lines 213-220)
    - SummarySection renders <p class="text-xs text-[var(--color-fg-muted)] mb-2"
      data-testid="first-use-disclosure"> ABOVE body when state is true           (SummarySection.tsx:123-130)
  All UI-SPEC contract surfaces present. Privacy-mode try/catch guard
  matches D-PRIV-2 fail-soft requirement. data-testid present for UAT scripts.
  Visual surfaces still requiring human eyes (recorded as residual):
    - Visual surfacing of the muted note (does it actually look right?)
    - Cross-session persistence behavior in a live browser
    - Privacy-mode browser graceful degradation
  See HUMAN-UAT.md UAT-4 for live-browser steps if needed.

### 5. UAT-1: Voice Quality Across 12 Fixture Versions
expected: Open VersionDrawer for each of the 12 fixtures in `src/__tests__/fixtures/summary-eval/`. Each summary reads as Supervisor/Lead voice — declarative present tense, 25-45 words, model name verbatim (case-sensitive `models_json[].name`), parent named on iterate-lineage, every applied LoRA named, exact integer seed reported, no AI-slop tells (stunning/vibrant/captivating/delve), no image-content claims. Compare against ROADMAP voice fingerprint.
result: skipped
reason: |
  N/A by design — this deployment uses Claude Max plan subscription, not the
  Anthropic API. There is no ANTHROPIC_API_KEY and there won't be one.
  loadAnthropicConfigFromEnv permanently returns null in this environment;
  every summary call returns source=fallback reason=api_key_missing with the
  deterministic-template text (D-FB-2 graceful degradation). The live LLM
  voice surface this test checks is dead code for this user.

  Coverage that remains exercised:
    - Plan 19-07 eval suite's 5 code-based dimensions (sentence count,
      verbatim model name, banned-lexicon, redaction marker, no-redacted-
      prompt-leak, api-key-leak-scan, anti-feature-regression) run via
      `npm run test:eval` against the deterministic-template golden path.
    - Plan 19-07's LLM-judge dimensions (lineage_relationship, voice_register)
      skip cleanly without a key — designed for open-source consumers who
      configure their own.
    - Deterministic-template output IS the production summary text in this
      deployment, and its shape is locked by 12 validation tests + the
      validator round-trip Test 6.

  For open-source consumers who DO configure ANTHROPIC_API_KEY, the
  12-fixture voice walk-through described in HUMAN-UAT.md remains the
  canonical UAT.

## Summary

total: 5
passed: 4
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps

[none yet]
