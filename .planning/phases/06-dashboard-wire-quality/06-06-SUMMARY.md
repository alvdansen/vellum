---
phase: 06-dashboard-wire-quality
plan: 06
subsystem: api
tags: [sse, keep-alive, wire-shape, whatwg-spec, hono, streaming-api, raw-byte-path, IN-02]

# Dependency graph
requires:
  - phase: 05-web-dashboard
    provides: createSseHandler (Plan 05-05) with keep-alive setInterval, origin gate (T-5-01), typed event forwarding + listener cleanup (T-5-08), toDashboardPayload adapter (Plan 05-13)
provides:
  - "Keep-alive frame on the wire is a true SSE comment per WHATWG spec: `: ping\\n\\n` at column 1, not `data: : ping\\n\\n`"
  - "Wire-level regex regression guard in src/http/__tests__/sse.test.ts: positive `/(^|\\n): ping\\n\\n/` + negative `not.toMatch(/data: : ping/)` — any future contributor who writes `stream.writeSSE({ data: ': ping' })` fails CI"
  - "Documented pattern for emitting SSE comment frames via the inherited raw-byte path: SSEStreamingApi extends StreamingApi, use stream.write(': ping\\n\\n') not stream.writeSSE"
affects: [future-sse-writers, proxy-hardening, protocol-analyzer-audits]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Raw-byte path for non-message SSE frames: inherited StreamingApi.write(input: string) is the correct escape hatch whenever Hono's writeSSE envelope (forced `data: ` prefix) does not match the desired wire shape"
    - "Wire-level regex assertion pattern: tests assert both the positive shape (anchored to `^` or `\\n`) AND the negative absence of the prior broken shape — single-sided positive match would silently allow prefix regressions"

key-files:
  created: []
  modified:
    - "src/http/sse.ts"
    - "src/http/__tests__/sse.test.ts"

key-decisions:
  - "Keep-alive uses stream.write(': ping\\n\\n') via the inherited StreamingApi.write — SSEStreamingApi extends StreamingApi, so the raw-byte path is type-safe with no cast or unknown-narrowing; the fix is a one-line swap plus a rewritten comment block"
  - "Event-listener path at sse.ts:182-190 continues to use stream.writeSSE for real event messages — the Hono envelope is correct there because those frames carry payload JSON; only the keep-alive comment needed the raw path"
  - "Test hardened with TWO assertions (positive regex + negative regex) instead of just tightening the positive — the negative `not.toMatch(/data: : ping/)` is the regression guard that catches a future contributor who reverts to writeSSE without anyone noticing, because a positive-only regex would still match `data: : ping\\n\\n` at column 6 if the line started with `data: `"

patterns-established:
  - "When Hono's writeSSE envelope is the wrong shape for your frame, drop to stream.write() — SSEStreamingApi extends StreamingApi and the raw-byte write() is on the prototype chain with no SSEMessage envelope"
  - "For SSE wire-level tests: anchor positive regex with `(^|\\n)` to require start-of-line position, and pair with a negative `not.toMatch` on the broken shape; single-sided matches can silently pass under a malformed prefix"

requirements-completed: []

# Metrics
duration: ~7min
completed: 2026-04-23
---

# Phase 6 Plan 06: SSE Keep-Alive Wire-Shape Fix Summary

**SSE keep-alive now emits a spec-compliant comment frame (`: ping\n\n` at column 1) via the inherited StreamingApi.write raw-byte path; closes audit item IN-02.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-24T00:18Z (worktree agent spawn)
- **Completed:** 2026-04-24T00:25Z
- **Tasks:** 1 (TDD: RED + GREEN commits)
- **Files modified:** 2 (src/http/sse.ts, src/http/__tests__/sse.test.ts)

## Accomplishments

- Keep-alive at `src/http/sse.ts:209` swapped from `stream.writeSSE({ data: ': ping' })` (produced the malformed wire shape `data: : ping\n\n`) to `stream.write(': ping\n\n')` (writes raw bytes with no `data: ` envelope). The wire shape is now a true WHATWG-SSE-§9.2 comment frame: `:` at column 1 followed by the token `ping`, terminated by the mandatory `\n\n`.
- The pre-existing loose test `expect(text).toContain(': ping')` (which matched under the broken shape too) is replaced with a wire-level regex pair: positive `expect(text).toMatch(/(^|\n): ping\n\n/)` requires `: ping\n\n` at the start of a line, and negative `expect(text).not.toMatch(/data: : ping/)` prevents silent regression to the previous envelope.
- The comment block above the keep-alive interval is rewritten to cite the WHATWG SSE §9.2 step-8 frame-terminator rule and document the StreamingApi inheritance path that makes the raw write type-safe. No future contributor needs to reverse-engineer why the raw path was chosen.
- All 11 SSE tests (10 pre-existing — origin allowlist, 5 event-type forwarding, listener cleanup, stream-closed swallowing — plus the hardened keep-alive test) remain green. Full server suite: 718/720 passing, 2 skipped (pre-existing skips, unrelated). `npx tsc --noEmit` clean.

## Task Commits

TDD workflow — the test was hardened first (RED), then the production fix landed (GREEN):

1. **Task 1 RED: Harden keep-alive test to wire-level regex** — `33a122f` (test)
2. **Task 1 GREEN: Switch keep-alive emit to raw stream.write** — `e7f13d6` (fix)

No REFACTOR commit needed — the fix is a one-line swap, already at minimum code.

## Files Created/Modified

- `src/http/sse.ts` — Lines 199-211: keep-alive `setInterval` body now calls `stream.write(': ping\n\n')` instead of `stream.writeSSE({ data: ': ping' })`; preceding comment block rewritten to document the WHATWG spec citation and the StreamingApi inheritance path. Surrounding code (listener registration loop 175-197, cleanup block 213-222, `KEEP_ALIVE_INTERVAL_MS = 30_000` at line 144) unchanged.
- `src/http/__tests__/sse.test.ts` — Lines 306-332: the keep-alive test title gained the `SC-5` tag, its body gained an inline WHATWG-spec citation comment, and the single `toContain(': ping')` assertion was replaced with a positive wire-level regex (`/(^|\n): ping\n\n/`) paired with a negative regression guard (`not.toMatch(/data: : ping/)`). All other tests in the file unchanged.

## Decisions Made

All three decisions are captured in the frontmatter key-decisions field. In prose:

- **Raw-byte path over a fork of writeSSE.** SSEStreamingApi extends StreamingApi; the inherited `write(input: Uint8Array | string): Promise<StreamingApi>` is on the prototype chain and is type-safe with no cast. The fix is the smallest possible change — one call-site swap — and it uses the type surface the library already exposes. Hono considers `write` a public API; the d.ts declares it publicly on StreamingApi. No vendor-drift risk.
- **Preserve writeSSE for real event messages.** The listener at `sse.ts:182-190` still uses `stream.writeSSE({ data: JSON.stringify(...), event: type })` — the Hono `data: ` envelope is exactly what SSE message frames require. Only the keep-alive (a comment, not a message) needed the raw path. Keeping the event-listener code untouched means zero regression risk to the 5-event forwarding path validated by Plan 05-13.
- **Two-sided assertion.** A positive-only regex (`toMatch(/^: ping\n\n/m)`) would still pass if a future contributor emitted `data: : ping\n\n` because the substring `: ping\n\n` begins at column 6 of a line, which a multiline regex could match under some anchor interpretations. The explicit negative `not.toMatch(/data: : ping/)` makes the regression guard unambiguous. This is the pattern called out in PATTERNS.md for SC-5.

## Deviations from Plan

None — plan executed exactly as written. The plan's `<action>` block provided exact replacement text for both files, the acceptance criteria enumerated all grep checks, and every criterion passed on first verification. No Rule 1/2/3 auto-fixes triggered; no Rule 4 architectural escalation needed.

## Issues Encountered

- **Worktree has no `node_modules`.** The parallel-executor worktree was spawned fresh and did not inherit node_modules from the main repo. First-action `npm install` added 547 packages in ~4 s (mostly warm cache). No functional impact; noted for future worktree hygiene.
- **Initial AC-7 sanity grep (`grep -c "stream\\.writeSSE"`) returned 0 when I expected 1.** The event-listener at `sse.ts:183-190` uses a fluent multi-line call chain where `stream` is on line 183 and `.writeSSE({` is on line 184, so a single-line grep for `stream\.writeSSE` misses it. Confirmed the writeSSE call is still present by grepping just `writeSSE` (3 hits: the closing comment, the fluent call, and the rewritten keep-alive comment). The optional sanity check in the plan's acceptance criteria served its purpose (prompted a double-check); the underlying intent — "writeSSE still used for event messages" — is satisfied.

## User Setup Required

None — no external service or environment configuration changed.

## Next Phase Readiness

- **IN-02 audit item closed.** `grep -q "SC-5 (Phase 6 gap_closure IN-02)" src/http/sse.ts` succeeds; the keep-alive comment carries a permanent marker linking the fix to the audit finding.
- **No downstream impact.** The wire shape is the only behavior that changed, and browsers already ignored the malformed message frame harmlessly (so the live dashboard at `packages/dashboard/**` saw zero behavioral shift). Proxies and protocol analyzers now see a spec-compliant comment frame and will not flag it as a malformed SSE message.
- **Other Phase 6 Wave 1 plans** (06-02 .. 06-05) touch different subsystems (CORS typing, cache headers, dashboard transcoding, env var validation) and do not depend on the SSE changes here. This SUMMARY.md is the only Plan-06 artifact the orchestrator needs at wave-merge time.

## Self-Check: PASSED

- `src/http/sse.ts` — FOUND (modified)
- `src/http/__tests__/sse.test.ts` — FOUND (modified)
- `.planning/phases/06-dashboard-wire-quality/06-06-SUMMARY.md` — will be committed after this write
- RED commit `33a122f` — FOUND in git log
- GREEN commit `e7f13d6` — FOUND in git log
- Grep assertions (AC-1 through AC-5) — all PASS
- Test suite: 11/11 SSE tests green, 718/720 full server suite green (2 pre-existing skips), `npx tsc --noEmit` clean

---
*Phase: 06-dashboard-wire-quality*
*Completed: 2026-04-23*
