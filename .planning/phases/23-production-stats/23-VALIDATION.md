---
phase: 23
slug: production-stats
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Filled by the planner after Wave 0 task IDs are assigned.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (server suite) + Vitest + @testing-library/preact (dashboard suite) |
| **Config file** | `vitest.config.ts` (root) + `packages/dashboard/vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose src/store/__tests__/shot-status-repo-stats.test.ts` (per-file) |
| **Full suite command** | `npx vitest run` (root) + `cd packages/dashboard && npx vitest run` |
| **Estimated runtime** | ~80–110s root suite; ~15s dashboard suite |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose <files-modified-by-task>` (per Vitest path filter)
- **After every plan wave:** Run `npx vitest run` (root) + dashboard suite
- **Before `/gsd:verify-work`:** Full root suite + dashboard suite + architecture-purity + tool-budget all green
- **Max feedback latency:** ~120s (full root suite + dashboard suite)

---

## Per-Task Verification Map

> Planner fills this after task IDs are assigned. Anticipated rows (subject to planner refinement):

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 1 | OVR-01 | — | GROUP BY query produces correct counts for whole sequence | unit | `npx vitest run src/store/__tests__/shot-status-repo-stats.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | OVR-01 | — | `EXPLAIN QUERY PLAN` shows `idx_shots_status` use, no per-row subquery (except whitelisted CORRELATED SCALAR for stale EXISTS) | unit | `npx vitest run -t "EXPLAIN QUERY PLAN"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | OVR-02 | — | `STALE_SHOT_DAYS = 14` constant unchanged; zero-version shots NOT stale (D-15 grace period) | unit | `npx vitest run -t "STALE_SHOT_DAYS"` | ✅ (line 54) | ⬜ pending |
| TBD | TBD | 1 | OVR-02 | — | Per-row `is_stale` flag computed inline via `CASE WHEN ... EXISTS` clause | unit | `npx vitest run -t "is_stale per row"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | OVR-01 | — | `engine.listShotGrid` returns `{ stats, shots, ... }` envelope | unit | `npx vitest run src/engine/__tests__/pipeline-shot-grid-stats.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | OVR-01 | — | `GET /api/sequences/:id/shot-grid` returns 200 with `stats` top-level field + per-row `is_stale` | integration | `npx vitest run src/http/__tests__/dashboard-routes-shot-grid.test.ts` | ✅ (extend) | ⬜ pending |
| TBD | TBD | 3 | OVR-01 | — | `SequenceStats` type matches engine response shape | type-check | `npx tsc --noEmit -p packages/dashboard` | ✅ | ⬜ pending |
| TBD | TBD | 3 | OVR-01 | — | Progress bar renders with `role="progressbar"` + `aria-valuenow={approved_pct}` | unit | `cd packages/dashboard && npx vitest run src/components/__tests__/SequenceHeader.stats.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | 3 | OVR-01 | — | Backlog callout hidden when `pending_review_backlog === 0` | unit | `cd packages/dashboard && npx vitest run -t "backlog hidden on zero"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 3 | OVR-02 | — | Stale border class applied to outer card wrapper when `shot.is_stale === true` | unit | `cd packages/dashboard && npx vitest run src/components/__tests__/ShotGridCard.stale.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | 3 | OVR-03 | — | `sequenceStats` signal seeded from `fetchShotGrid` response; SSE delta decrements/increments correctly | unit | `cd packages/dashboard && npx vitest run src/state/__tests__/shot-grid-stats-delta.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 3 | OVR-03 | — | SSE handler with `fromStatus === null` (first-ever transition) defaults to `'wip'` for delta | unit | `cd packages/dashboard && npx vitest run -t "null fromStatus coalesce"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 3 | OVR-03 | — | Cross-sequence SSE event ignored (existing Phase 21 guard reused) | unit | `cd packages/dashboard && npx vitest run -t "cross-sequence guard"` | ✅ (line 163) | ⬜ pending |
| TBD | TBD | 3 | OVR-02 | — | Stale-count SSE delta applies for in-buffer shots; no-op for unknown shotId | unit | `cd packages/dashboard && npx vitest run -t "stale-count delta best-effort"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 4 | OVR-01 | — | Theme tokens present in BOTH `:root` AND `[data-theme="dark"]` blocks (Pitfall 6 guard) | grep-test | `grep -c "color-shot-stale" packages/dashboard/src/styles/theme.css` (expect ≥ 2) | ❌ W0 | ⬜ pending |
| TBD | TBD | 4 | OVR-01..03 | — | Architecture-purity + tool-budget tests green (no new MCP tools, no new native deps) | regression | `npx vitest run src/__tests__/architecture-purity.test.ts src/__tests__/tool-budget.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | 4 | OVR-01..03 | — | Full root + dashboard suite green (baseline preserved) | regression | `npx vitest run && cd packages/dashboard && npx vitest run` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/store/__tests__/shot-status-repo-stats.test.ts` — new test file; stubs for `getSequenceStats(sequenceId)` covering OVR-01 (counts + total + approved_pct integer math + backlog) and OVR-02 (stale_count whole-sequence + zero-version grace per D-15)
- [ ] `src/store/__tests__/shot-status-repo-stats.test.ts` — `EXPLAIN QUERY PLAN` assertions: GROUP BY uses `idx_shots_status (sequence_id, status)`; whitelist CORRELATED SCALAR for the stale EXISTS subquery (intentional per query design)
- [ ] `src/engine/__tests__/pipeline-shot-grid-stats.test.ts` (or extension of existing pipeline tests) — covers the composition of `listShotGrid` + `getSequenceStats` into the unified envelope; covers SEQUENCE_NOT_FOUND error propagation
- [ ] `src/http/__tests__/dashboard-routes-shot-grid.test.ts` — EXTEND existing harness: assert `stats` top-level field present in 200 response; assert per-row `is_stale: boolean` present on each `ShotGridRow`
- [ ] `packages/dashboard/src/components/__tests__/SequenceHeader.stats.test.tsx` — new test file: progress bar a11y (role/aria-* attributes), backlog callout hide-on-zero, stale count adjacent rendering
- [ ] `packages/dashboard/src/components/__tests__/ShotGridCard.stale.test.tsx` — new test file: amber border class applied when `is_stale === true`; coexistence with omit `opacity-40` wrapper (omit + stale impossible by definition); coexistence with inner button focus rings
- [ ] `packages/dashboard/src/state/__tests__/shot-grid-stats-delta.test.ts` — new test file: seed `sequenceStats` from `fetchShotGrid` response; SSE delta math (decrement/increment + approved_pct + backlog + stale-count edge cases); `fromStatus === null` coalesce path; cross-sequence guard; unknown shotId no-op
- [ ] `packages/dashboard/src/__tests__/copy-floor.test.ts` (if exists) — raise the export-count floor by N for the new stats copy strings
- [ ] **No framework install** — Vitest + @testing-library/preact already wired (Phase 19 / 21 / 22 precedent)
- [ ] **No new architecture-purity allowed-set entries** — Phase 23 is pure composition; existing sole-importer rules unchanged

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Progress bar fill animation feels smooth at ≤ 150ms with prefers-reduced-motion honored (D-21) | OVR-01 | Visual perception | Open dashboard, navigate to a sequence with mixed-status shots, change a shot's status; observe bar fill animation. Toggle OS reduced-motion setting and confirm animation is instant. |
| Amber stale border is visually distinguishable from `pending-review` amber pill (D-08) when both apply to the same card | OVR-02 | Visual perception | Find a `pending-review` shot in a sequence with no completed version > 14d ago. Confirm the card has BOTH: an amber border AND the amber pending-review pill, and the two amber shades are visually distinct. |
| Stats widget update on incoming SSE feels real-time (no perceptible lag) for typical sequence sizes (< 100 shots) | OVR-03 | UX subjective | Open dashboard with sequence loaded; in another tab/agent, change a shot's status via MCP `set_status`. Confirm dashboard counters tick within ~200ms. |
| WCAG 2.1 AA contrast for `#f59e0b` (light theme stale border) against `--color-bg` light theme background — A5 open risk from RESEARCH | OVR-02 | Contrast audit | Run a contrast-ratio check (browser dev tools picker or contrast-checker tool) on `#f59e0b` against the resolved `--color-bg` light value. Confirm ≥ 3:1 for UI components. If failing, adjust to `#d97706` (amber-600). |
| Stale-count delta divergence vs server snapshot stays "best-effort acceptable" across realistic usage (D-19) | OVR-03 | Long-running session check | Open dashboard for ~15 minutes with cross-sequence SSE traffic; periodically refresh (re-open sequence) and confirm stale_count converges to server-computed value within tolerance. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (9 new/extended test files enumerated above)
- [ ] No watch-mode flags (all commands use `vitest run`, not `vitest watch`)
- [ ] Feedback latency < 120s (full root + dashboard suite)
- [ ] `nyquist_compliant: true` set in frontmatter after planner fills the verification map

**Approval:** pending
