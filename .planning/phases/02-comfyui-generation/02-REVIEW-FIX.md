---
phase: 02-comfyui-generation
source_reviews:
  - 02-REVIEW.md (gsd-code-review, 0 crit / 7 warn / 8 info)
  - 02-GSTACK-REVIEW.md (gstack /review, 6 crit / 34 info)
fix_scope: 6 critical findings from gstack review
fixed_at: 2026-04-21T19:30:00Z
status: complete
tests_before: 188 passing, 1 skipped
tests_after: 202 passing, 1 skipped (+14 regression tests)
typecheck: clean
---

# Phase 02 Code-Review Fix Log

Applied the 6 critical findings from `02-GSTACK-REVIEW.md` as atomic commits. Each fix includes a regression test and tests pass cleanly both before and after.

| # | Severity | Area | Commit | Tests added |
|---|----------|------|--------|-------------|
| C5 | perf | Missing index on `versions.status` | `8207f58` | +1 (idx_versions_status exists) |
| C2 | race-condition | TOCTOU regression in `transition()` | `9480b08` | +2 (transition-after-terminal) |
| C4 | security | `redirect: 'manual'` missing on submit/status | `0afad63` | +2 (302-rejected + redirect:manual asserted) |
| C3 | security | SSRF bypass on signed-URL second hop | `c83f0eb` | +1 (second-hop 302 rejected) |
| C1 | llm-trust | Path traversal via project/sequence names | `7b9c9a3` | +6 (.., /, \\, NUL, empty, "." / "..") |
| C6 | perf | Unbounded pollers at boot (thundering herd) | `acd1013` | +1 (cap=3 enforced on 10 pending rows) |

**Bottom line:** +14 regression tests, 202/203 pass (1 skipped live-smoke), `tsc --noEmit` clean.

---

## Individual Fix Details

### C5 — perf: add `idx_versions_status` for recovery-poller query

**Commit:** `8207f58 perf(C5): add idx_versions_status for recovery-poller query`

`VersionRepo.listPendingVersions()` runs `WHERE status IN ('submitted','running')` at every server boot (D-GEN-28 recovery poller). No index meant a full-table scan, growing O(n) with total version count as completed rows accumulate.

**What changed:**
- `src/store/schema.ts`: added `idxStatus: index('idx_versions_status').on(t.status)` drizzle definition + mirror in SCHEMA_DDL.
- `drizzle/0002_idx_versions_status.sql`: new migration with `CREATE INDEX IF NOT EXISTS`.
- `drizzle/meta/`: journal entry + snapshot for 0002.
- `src/store/__tests__/migrate.test.ts`: bumped `EXPECTED_MIGRATIONS` to 2; added `idx_versions_status exists (migration 0002)` assertion.

### C2 — fix: guard `transition()` against TOCTOU regression from terminal states

**Commit:** `9480b08 fix(C2): guard transition() against TOCTOU regression from terminal states`

`UPDATE versions SET status='running' WHERE id=?` with no `status` guard allowed a race where a concurrent tool-path call (holding a stale `submitted` snapshot) could regress a completed row back to `running`. Violated D-GEN-20 immutability.

**What changed:**
- `src/store/version-repo.ts`: `transition()` now uses `UPDATE ... WHERE id=? AND status='submitted' AND completed_at IS NULL`. Race-lose branch becomes a silent no-op — desired behaviour since the winning writer already put the row in a terminal state.
- `src/store/__tests__/version-repo.test.ts`: added `transition-after-markCompleted` and `transition-after-markFailed` tests asserting terminal fields are preserved verbatim.

### C4 — fix: `redirect: 'manual'` on `submit()` and `status()` — stop X-API-Key leak

**Commit:** `0afad63 fix(C4): redirect:manual on submit()/status() — stop X-API-Key leak across redirects`

Node's `fetch` strips `Authorization` across cross-origin redirects but preserves custom headers like `X-API-Key`. A single 302 from a compromised `COMFYUI_API_BASE` would exfiltrate the API key — the very secret `stdio-hygiene.test.ts` spends significant effort guarding (D-GEN-12).

**What changed:**
- `src/comfyui/client.ts`: `submit()` and `status()` now set `redirect: 'manual'` and reject any 3xx with a typed error that names the leak risk.
- `src/comfyui/__tests__/client.test.ts`: two new tests assert exactly 1 fetch call (not 2) and `redirect:'manual'` in the init bag for both methods.

### C3 — fix: `redirect: 'manual'` on signed-URL second hop — close SSRF bypass

**Commit:** `c83f0eb fix(C3): redirect:manual on signed-URL second hop — close SSRF bypass`

The first-hop `/api/view` fetch already used `redirect:'manual'` + host allowlist (D-GEN-22 Pattern 4). The second hop — fetching the signed URL itself — used default `redirect:'follow'`, meaning an allowlisted host responding `302 → http://169.254.169.254/` (cloud metadata) would walk right past the gate.

**What changed:**
- `src/comfyui/client.ts`: second-hop fetch in `download()` now sets `redirect:'manual'` and rejects any 3xx.
- `src/comfyui/__tests__/client.test.ts`: regression test — allowlisted host → 302 to internal metadata — asserts exactly 2 fetches (not 3) and `redirect:'manual'` on the second init bag.

### C1 — fix: sanitize every path segment in `buildOutputPath`

**Commit:** `7b9c9a3 fix(C1): sanitize every path segment in buildOutputPath, not just filename`

Before the fix, `buildOutputPath` only validated `filename` via `sanitizeRelativeSegment`. `projectName`, `sequenceName`, `shotName`, and `versionLabel` flowed straight into `path.posix.join`. Phase 1 D-14 marked names as "trusted per demo-scope constraint" — but Phase 2 was the first phase to turn these names into disk paths, so the assumption became load-bearing and breached. An agent-created project named `..` (or `../../tmp`) would cause a generation download to land outside the outputs root.

**What changed:**
- `src/utils/outputs.ts`: `sanitizeRelativeSegment` now rejects empty / whitespace-only names, literal `.` and `..` segments (in addition to the existing `..`, `/`, `\\`, NUL checks). `buildOutputPath` sanitizes all 5 segments (project, sequence, shot, version, filename). Error code moved from `COMFYUI_API_ERROR` to `INVALID_INPUT` — the failure is semantically about bad input regardless of source.
- `src/utils/__tests__/outputs.test.ts`: added 6 regression tests covering `..` / slash / backslash / NUL / empty / literal-dot in project/sequence/shot segments, plus positive cases (spaces, dotted extensions).

### C6 — fix: cap concurrent pollers at boot + jitter initial sleep

**Commit:** `acd1013 fix(C6): cap concurrent recovery pollers at boot + jitter initial sleep`

`start()` was firing one `drivePoller` per pending row with zero concurrency limit. Boot after a crash with N pending versions fired N parallel HTTP calls to ComfyUI Cloud every ~2s. ComfyUI concurrency tiers are Free=1, Creator=3, Pro=5 — anything above the tier cap hits 429 instantly, so recovery itself became the thundering herd.

**What changed:**
- `src/engine/generation.ts`: `start()` now launches at most `maxConcurrentPollers` at once (default 3 = Creator tier, clamped [1, 20]). Extra rows queue and drain as earlier pollers terminate. Each poller's first sleep gets bounded jitter (0..800ms) so N parallel pollers do not fire in the same millisecond window.
- `src/engine/pipeline.ts`: `Engine` constructor forwards a `maxConcurrentPollers` option.
- `src/server.ts`: new env knob `COMFYUI_MAX_CONCURRENT_POLLS` threads through to the engine.
- `src/test-utils/fake-comfyui-client.ts`: added `inFlightStatus` / `maxInFlightStatus` trackers and a `statusDelayMs` field for observable concurrency windows.
- `src/engine/__tests__/generation.test.ts`: regression test with real timers — seed 10 pending rows, cap=3, 150ms status delay. Drain and assert `fake.maxInFlightStatus <= 3`. Run time ~10s.

---

## Untouched Findings

**34 informational findings from `02-GSTACK-REVIEW.md` remain** — intentionally not fixed in this pass per the user's selection of "Fix the 6 criticals now". These are tracked in `02-GSTACK-REVIEW.md` and can be addressed individually or bundled into a future Phase 2.1 polish cycle:

- Security polish: IS-01 (allowlist regex escaping), IS-02 (protocol enforcement), IS-03 (max body size — mirrors WR-04/05), IS-04 (scrub error persistence)
- Performance polish: IP-01 (dead retry delay constant), IP-02 (collision O(n) → O(1)), IP-03 (stream constructor error path)
- Testing coverage: 19 missing tests across client / engine / stdio-hygiene / live-smoke gate
- Maintainability: IM-01 (~100 lines dead FakeEngine code), IM-02 (downloadToPath duplication), IM-03/04 (stale schema.ts comments), IM-05 (magic number), IM-06 (duplicated default URL)
- Data migration: IDM-01 (snapshot baseline misaligned), IDM-02 (missing Phase-1→Phase-2 upgrade test), IDM-03 (no rollback)
- API contract: IAC-01 (outputs_json as string — confirms WR-06), IAC-02 (duplicate error / error_message), IAC-03 (dual error model documentation), IAC-04 (Engine constructor breaking change note), IAC-05 (`Version.status` discriminated union)

---

## What This Review Pipeline Proved

Two-reviewer pipeline (gsd-code-review + gstack /review) caught 6 critical issues on a phase where a single reviewer found 0. The highest-confidence new critical (C1 path traversal) was surfaced by both the gstack critical pass AND the security specialist independently — classic multi-specialist confirmation, and a strong argument for this being standard practice on any phase that introduces a new trust boundary with disk writes or network I/O.
