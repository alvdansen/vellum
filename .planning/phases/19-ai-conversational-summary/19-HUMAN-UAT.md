# Phase 19 — Human UAT Checklist

Manual verification items per VALIDATION.md "Manual-Only Verifications" — these
are human-judgment surfaces that automated tests cannot cover. The 9 code-based
eval dimensions (Plan 19-07) plus the 4 adversarial-review-class E2E tests
(Plan 19-08) cover the structural and adversarial surfaces. The 4 UAT items
below cover the visual-aesthetic + voice-quality + interaction-feel surfaces
that require a human eye.

## UAT Setup

```bash
# 1. Set ANTHROPIC_API_KEY in .env (chmod 600; never commit)
export ANTHROPIC_API_KEY="sk-ant-..."

# 2. Launch the dashboard server in HTTP mode
npx tsx src/server.ts --http

# 3. Open the dashboard
open http://localhost:8000

# 4. Navigate to a completed version with a manifest_signed event
#    (the cache-key composite needs manifest_sha256 to be present)
```

**Prerequisites:**
- 12 fixture versions populated under `src/__tests__/fixtures/summary-eval/`
  (Plan 19-07 ships these — root × 2, iterate × 4, ControlNet × 2,
  redacted × 2, KSampler-absent × 1, prompt-injection × 1, long-prompt × 1)
- ANTHROPIC_API_KEY valid (verified at boot via TypedError if invalid)
- A clean browser cache (or DevTools open in private mode) so the
  first-use disclosure logic exercises freshly

## Manual UAT Items

### UAT-1: Voice quality of generated summaries (SUM-01)

**Why manual:** Voice-drift detection is human-judgment territory; the
structural shape (sentence count, verbatim model name, AI-slop banned-lexicon
absence) is automated by Plan 19-07's eval suite, but *"feels conversational
like a Supervisor or Lead wrote it"* (PROJECT.md / REQUIREMENTS.md verbatim
user quote, Timothy Paul Bielec, 2026-04-30) requires a human read.

**Steps:**

1. Open VersionDrawer for each of the 12 fixture versions in
   `src/__tests__/fixtures/summary-eval/` (use the fixture's `version_label`
   to navigate the dashboard). Wait for the live LLM call to complete
   (~600-1000ms) or the cache hit (sub-100ms).
2. For each summary, verify it reads as Supervisor/Lead voice:
   - Declarative present tense ("v003 is..." not "v003 was generated...")
   - 25-45 words per summary
   - Names model verbatim (e.g., "flux1-dev" not "Flux Pro" — case-sensitive
     match to `models_json[].name` Phase 13 fingerprint string)
   - Names parent version on iterate-lineage (e.g., "from v002") OR omits
     parent reference on root versions
   - Names every applied LoRA (e.g., "cinematic_fantasy (0.8) and
     detail_boost (0.5)") OR truthfully omits when none applied
   - Reports the exact integer seed (e.g., "at seed 42") when seed in scope
   - No AI-slop tells: "stunning", "vibrant", "captivating", "delve",
     "in conclusion", "Here's a summary", "This impressive image",
     "delightful", "exquisite", "breathtaking", "showcases", "embodies"
   - No image-content claims: "the lighting is dramatic", "the composition
     leads the eye", "the rendered image", "this picture depicts"
3. Compare each summary against the ROADMAP voice fingerprint:
   *"v003 is a tighter close-up of the dragon's eye, generated with Flux + the cinematic_fantasy LoRA at seed 42, swapping the wide-angle env map for a HDRI from the parent shot."*

**Pass criterion:** Each of the 12 summaries reads as Supervisor voice;
banned-lexicon dimension passes (Plan 19-07 automates the regex check, but
the human eye catches subtle register slips like past-tense verb forms or
imperative-mood phrasings the regex won't flag).

**Reviewer:** VFX Supervisor / Sequence Lead (per Section 1b Domain Expert
Roles in 19-AI-SPEC.md).

### UAT-2: Skeleton-shimmer UX during live LLM call (SUM-04)

**Why manual:** Visual shimmer aesthetic match to Phase 17 SkeletonThumbnail
requires a human eye; the existing component uses `animate-skeleton-shimmer`
keyframes and gradient tokens that the new SummarySection should reuse for
consistency.

**Steps:**

1. Open VersionDrawer on a never-summarized version. Force a cold cache by
   either:
   (a) Deleting the `summary_generated` event row from the SQLite DB:
   ```sql
   DELETE FROM provenance
   WHERE version_id = '<id>' AND event_type = 'summary_generated';
   ```
   (b) Selecting a version that has not yet been summarized (a fresh
   completion event with no prior summary cache).
2. Observe the 3-line skeleton block during the ~600-1000ms Haiku 4.5
   latency. The skeleton appears in the same DOM slot where the summary
   text will render (D-FB-6 stable layout invariant).
3. Verify the shimmer matches the existing thumbnail skeleton aesthetic:
   - Same `animate-skeleton-shimmer` keyframe (no new keyframes added)
   - Same gradient color (`--color-border-subtle` → `--color-border` via
     CSS custom properties)
   - Honors `prefers-reduced-motion: reduce` (verify by toggling the OS
     setting in System Settings → Accessibility → Display → Reduce Motion;
     the skeleton should stay visible but stop animating)

**Pass criterion:** Skeleton shimmer is visually consistent with Phase 17
thumbnails; reduced-motion mode shows the skeleton without animation.

**Reviewer:** Project owner (open-source / single-developer scope; no
formal design-review bar).

### UAT-3: Regenerate cooldown countdown UX (SUM-04)

**Why manual:** Countdown timer button label vs disabled-with-tooltip is
Claude's-discretion territory — the planner picks one of two acceptable
patterns; the user verifies which lands matches the rest of the dashboard
UX.

**Steps:**

1. Open VersionDrawer on any completed + signed version.
2. Click Regenerate. The first click should:
   - Trigger a fresh LLM call (verify via Network tab — POST to
     `/api/versions/:id/summary/regenerate`)
   - Optimistically disable the button (no second click possible)
   - Apply the 500ms client-side debounce (rapid second click is no-op)
3. Observe the cooldown countdown UX. Per 19-06 / 19-RESEARCH.md, the
   button label flips to "Regenerate (60s)" then decrements 1Hz to
   "Regenerate (59s)" → ... → "Regenerate (1s)" → "Regenerate".
4. Verify:
   - Button is `disabled` during the cooldown (HTML `disabled` attribute)
   - Tabular-nums (`font-variant-numeric: tabular-nums`) prevents the
     digit from jittering as the count changes
   - Clicking the disabled button is a no-op (no second LLM call —
     verify via Network tab; the server-side throttle would 429 anyway)
5. After 60s, the button re-enables and a fresh click triggers another
   regenerate.

**Pass criterion:** Cooldown UX is intuitive; no accidental double-fire;
counting feels stable (no digit jitter); 60s server-side throttle (SUM-04
Plan 19-05) provides the second line of defence.

**Reviewer:** Project owner.

### UAT-4: First-use disclosure surfacing (SUM-01 / D-PRIV-2)

**Why manual:** Disclosure copy + placement is Claude's-discretion territory;
verify the inline muted note is non-intrusive but visible. The contract is
D-PRIV-2: the user already chose to send their prompt text to ComfyUI Cloud,
so sending the same text to Anthropic is the same trust boundary — the
disclosure is informational, not gating.

**Steps:**

1. Clear the localStorage ack:
   ```js
   localStorage.removeItem('vfx-familiar:summary:first-use-acked');
   ```
   (Run in DevTools console.)
2. Reload the dashboard, open VersionDrawer.
3. Verify:
   - Inline muted note "AI summary uses your prompt text" appears above
     the summary body (or in a position consistent with the rest of the
     drawer's hierarchy)
   - Note uses muted styling (`text-xs text-[var(--color-fg-muted)]` per
     Plan 19-06)
   - Note is non-modal (does not block the user from reading the summary)
4. Click Regenerate.
5. Verify:
   - The note disappears (auto-acked on first regenerate click)
   - `localStorage.getItem('vfx-familiar:summary:first-use-acked')` returns
     `'true'` (verify in DevTools console)
6. Reload — note no longer appears on subsequent drawer opens (across
   different versions).

**Pass criterion:** First-use disclosure is informative + dismisses on
first regenerate click; localStorage persists ack across page reloads
across different versions.

**Reviewer:** Project owner.

## Sign-off

- [ ] UAT-1: Voice quality (12 fixtures verified)
- [ ] UAT-2: Skeleton-shimmer UX
- [ ] UAT-3: Regenerate cooldown countdown UX
- [ ] UAT-4: First-use disclosure surfacing

**Sign-off date:** _____________
**Reviewer:** _____________

## References

- `19-AI-SPEC.md` §1b "Domain Context" — Supervisor voice register table,
  banned-lexicon, ROADMAP voice fingerprint.
- `19-AI-SPEC.md` §5 "Reference Dataset" — 12 fixture versions covering
  canonical lineage shapes.
- `19-AI-SPEC.md` §7 "Production Monitoring" — flywheel for periodic
  voice-drift sampling (weekly LLM-judge sample of 20 production
  summaries).
- `19-VALIDATION.md` "Manual-Only Verifications" — the 4 items above are
  the canonical manual-UAT cohort.
- `19-CONTEXT.md` D-PRIV-2 — trust-boundary rationale for the first-use
  disclosure.
- `19-CONTEXT.md` D-FB-3 + D-FB-6 — circuit breaker recovery + DOM
  stability (verified by automated tests; UAT-2 + UAT-3 are the visual
  surfaces).
- `19-06-SUMMARY.md` — dashboard component layer (SummarySection +
  RegenerateButton + first-use disclosure wiring).
