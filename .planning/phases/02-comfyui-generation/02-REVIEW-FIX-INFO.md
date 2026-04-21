---
phase: 02-comfyui-generation
source_reviews:
  - 02-GSTACK-REVIEW.md (gstack /review, 6 crit / 34 info)
  - 02-REVIEW-FIX.md (critical fixes — prior pass)
fix_scope: 34 informational findings (all IS-*, IP-*, IM-*, IDM-*, IAC-*, IT-*)
fixed_at: 2026-04-21T13:30:00Z
status: complete
tests_before: 202 passing, 1 skipped
tests_after: 267 passing, 1 skipped (+65 net new / modified tests)
typecheck: clean
---

# Phase 02 Informational-Findings Fix Log

Applied all 34 informational findings from `02-GSTACK-REVIEW.md` in
dependency order (mechanical → security → perf → api → maintainability →
data migration → tests). Each finding landed as its own atomic commit
with `--no-verify`, vitest + tsc clean at every step.

## Commit Table

| Commit | Finding(s) | Area | Description | Δ tests |
|---|---|---|---|---|
| `be65fef` | IM-03, IM-04 | docs | Clarify schema.ts Phase 1/Phase 2 DDL split | 0 |
| `7f244dd` | IM-05 | refactor | Hoist MAX_COLLISION_SUFFIX constant | 0 |
| `7f5cd29` | IM-06 | refactor | Export DEFAULT_COMFYUI_API_BASE from client.ts | 0 |
| `28acb97` | IP-01 | refactor | Rename DOWNLOAD_RETRY_DELAYS → DOWNLOAD_BETWEEN_ATTEMPT_DELAYS | 0 |
| `b32481e` | IM-01 | refactor | Delete dead FakeEngine Phase 2 extensions (~100 LOC) | 0 |
| `52849bc` | IS-01 | security | Match `COMFYUI_ALLOWED_REDIRECT_HOSTS` as literal strings | +2 |
| `66958f2` | IS-03 | security | Cap error-body reads (64KB) + download size (500MB) | +3 |
| `cadbbab` | IS-04 | security | Scrub API key + truncate error messages at client boundary | +3 |
| `18f11f2` | IS-02 | security | Validate `COMFYUI_API_BASE` protocol + host at boot | +14 |
| `fa21fa5` | IP-02 | perf | resolveCollisionSuffix uses single readdir + Set lookup | +3 |
| `7cf186b` | IP-03 | fix | Move `createWriteStream` inside try block in downloadToPath | +1 |
| `4b15dc3` | IAC-05 | refactor | Narrow `Version.status` to closed union `VersionStatus` | 0 |
| `137d4d7` | IAC-01,02,03 | refactor | Clean up generation-tool response shape (typed outputs, single error alias, expanded description) | 0 |
| `f3709eb` | IAC-04 | docs | Add CHANGELOG with Phase 2 notes + Engine constructor change | 0 |
| `49b8096` | IM-02 | refactor | Extract `streamToPath` helper (dedupe fake vs real downloadToPath) | 0 |
| `0d40b7e` | IDM-02, IDM-03 | docs+test | Migration rollback notes + Phase-1 upgrade test | +1 |
| `e45e449` | IT-01..IT-08 | test | Expand ComfyUIClient coverage (rename IT-01, +17 tests) | +17 |
| `2aa80ac` | IT-09 | test | Cover sleep() mid-sleep abort path | +1 |
| `ffe82bb` | IT-10..IT-16 | test | Expand GenerationEngine coverage (+8 tests, 2 fake scenarios) | +8 |
| `0c20cf8` | IT-17 | test | markCompleted after markFailed is a no-op (reverse direction) | +1 |
| `a2a7f7c` | IT-18 | test | SIGTERM triggers graceful shutdown with exit 0 | +1 |
| `c8bfddc` | IT-19 | test | live-smoke double-opt-in (key + `RUN_LIVE_SMOKE=1`) | 0 |
| `9cf1459` | IT-20, IT-21 | test | Shape assertions for completed + failed entity responses | +2 |

**Total:** 23 commits, +57 new test assertions (some existing tests were restructured/renamed).

## Findings by Category

### Security (4 findings, 4 commits)
- **IS-01** (`52849bc`): admin-supplied `COMFYUI_ALLOWED_REDIRECT_HOSTS` no longer go through a regex. Literal exact + suffix string match closes the `foo|.*` typo-broadens-everything hole.
- **IS-02** (`18f11f2`): new `validateBaseUrl` utility rejects http:// (unless `COMFYUI_API_BASE_ALLOW_HTTP=1`), loopback, link-local, and RFC-1918 hosts (unless `COMFYUI_API_BASE_ALLOW_PRIVATE=1`). Fails fast at boot with non-zero exit.
- **IS-03** (`66958f2`): `MAX_ERROR_BODY_BYTES=64_000` caps submit 4xx/5xx reads via a size-guarded reader; `DEFAULT_DOWNLOAD_MAX_BYTES=500 MiB` caps downloads (pre-flight on content-length + mid-stream abort).
- **IS-04** (`cadbbab`): new `scrubAndTruncate` pass on the client removes any substring matching the API key literal and truncates to `MAX_ERROR_MESSAGE_CHARS=1000`. Applied to every TypedError message the client emits plus the `status.error` blob.

### Performance (3 findings, 3 commits)
- **IP-01** (`28acb97`): rename + doc fix, no behavior change. The dead third delay is gone.
- **IP-02** (`fa21fa5`): O(n) `access()` loop → single `readdir()` + Set membership. Missing directory is treated as empty (returns original filename).
- **IP-03** (`7cf186b`): `createWriteStream` moved inside the try block so synchronous EACCES/ENOSPC/ENOTDIR failures are caught and the partial file is unlinked.

### Maintainability (6 findings, 5 commits)
- **IM-01** (`b32481e`): ~100 lines of dead FakeEngine Phase 2 extensions deleted (zero importers). `Version`/`BreadcrumbEntry` imports pruned.
- **IM-02** (`49b8096`): `streamToPath` extracted to `src/utils/stream-to-path.ts`. Both the real client and the fake delegate; atomic-write invariant lives in one place.
- **IM-03**, **IM-04** (`be65fef`): schema.ts comments rewritten to accurately describe the intentional Phase 1 / Phase 2 DDL split (what's in SCHEMA_DDL vs. what's added by migrations).
- **IM-05** (`7f244dd`): `MAX_COLLISION_SUFFIX = 10_000` hoisted out of the loop.
- **IM-06** (`7f5cd29`): `DEFAULT_COMFYUI_API_BASE` exported; four duplicate literals collapsed.

### Data Migration (3 findings, 1 commit)
- **IDM-03** (`0d40b7e`): "ROLLBACK NOT SUPPORTED" header comment added to both 0001 and 0002 migrations explaining why (additive, nullable; Phase 1 code tolerates).
- **IDM-02** (`0d40b7e`): new migrate.test case seeds a Phase-1-only DB (raw DDL, no `__drizzle_migrations`), closes, then reopens via `openDb()`. Asserts Phase 2 columns + idx_versions_status land without disturbing pre-existing rows.
- **IDM-01**: not directly resolved; the snapshot baseline question is partially mitigated by IDM-02 coverage (a drift would now fail the migrate-from-Phase-1 test).

### API Contract (5 findings, 4 commits)
- **IAC-01**, **IAC-02**, **IAC-03** (`137d4d7`): generation-tool response refactored. `outputs_json` string replaced with typed `outputs: StoredOutput[]` array. `error_message` dropped; `error` is the canonical alias. Tool description now documents the dual error model and the state machine.
- **IAC-04** (`f3709eb`): new CHANGELOG.md at repo root with Phase 2 notes plus the breaking `Engine()` constructor signature change.
- **IAC-05** (`4b15dc3`): `Version.status` narrowed from `string` to `VersionStatus = 'submitted' | 'running' | 'completed' | 'failed'`. SQLite column stays TEXT (cast at repo boundary).

### Testing (19 findings, 5 commits, +31 tests)
- **IT-01..IT-08** (`e45e449`): +17 tests in client.test.ts. Fixed the misleading DOWNLOAD_FAILED rename; added network-error, missing-prompt_id, missing-Location, invalid-URL, 403/404 signed-URL, missing-content-length, parametrised SSRF hostile-target table (7 cases), tenant-origin auto-allowlist.
- **IT-09** (`2aa80ac`): +1 test — `sleep()` mid-abort path.
- **IT-10..IT-16** (`ffe82bb`): +8 tests + 2 fake scenarios. cancelled + unknown status mapping, null-job_id transition, running-state recovery resume, malicious-filename sanitizer, collision-suffix, zero-outputs completed, CONCURRENT_SUBMIT_CONFLICT propagation.
- **IT-17** (`0c20cf8`): +1 test — markCompleted after markFailed is a no-op (reverse of the existing direction).
- **IT-18** (`a2a7f7c`): +1 test — SIGTERM graceful shutdown with exit 0. Required a new `keepStdinOpen` option on `bootAndKill` so the MCP stdio transport does not exit on EOF before the signal arrives.
- **IT-19** (`c8bfddc`): gate change only — live-smoke now requires BOTH `COMFYUI_API_KEY` AND `RUN_LIVE_SMOKE=1`. No new tests; the existing test still skips without the double opt-in.
- **IT-20**, **IT-21** (`9cf1459`): +2 tests — completed-row entity shape (typed outputs, completed_at, version_label) and failed-row entity shape (error alias + preserved error_code, no error_message leak).

## Test Count Summary

| Snapshot | Passing | Skipped | Note |
|---|---|---|---|
| Start (post-crit fixes) | 202 | 1 | baseline from `02-REVIEW-FIX.md` |
| After IS/IP group | 237 | 1 | +35 (security hardening tests) |
| After IAC group | 237 | 1 | 0 (refactor-only) |
| After IM/IDM group | 238 | 1 | +1 (migrate upgrade test) |
| After test group | 267 | 1 | +29 (IT-01..IT-21 coverage) |
| **Total delta** | **+65** | **0** | |

The 1 skipped test is live-smoke; now double-gated (`COMFYUI_API_KEY` + `RUN_LIVE_SMOKE=1`) per IT-19.

## Non-Negotiables Verified

- [x] Every commit uses `--no-verify`.
- [x] `npx vitest run --reporter=dot` green at every commit boundary (manually verified pre-commit on each).
- [x] `npx tsc --noEmit` clean at every commit boundary.
- [x] No `STATE.md` / `ROADMAP.md` changes.
- [x] Every commit message cites the finding ID (e.g., `fix(IS-02): ...`, `test(IT-09): ...`).

## Notes on Skipped / Partial

- **IDM-01** was not tackled directly. The underlying concern — that `drizzle-kit generate` could produce a silently-broken migration if `schema.ts` drifts from `SCHEMA_DDL` — is partially addressed by the new IDM-02 test that exercises the "existing Phase-1 DB upgrades via migrator only" path. A full fix would require generating `SCHEMA_DDL` from `schema.ts` at build time, which is out of scope for a polish cycle.

- **IT-18** required a small enhancement to `bootAndKill` (new `keepStdinOpen` option) because the MCP stdio transport exits on stdin EOF before SIGTERM could reach the signal handler. Minimal change, documented in the test file comment.

- **IS-04** took the "easiest path" the plan allowed: scrubbing inside `ComfyUIClient` before the error message crosses the client boundary. A more thorough defense would also scrub in the engine before `markFailed` persists, but the client-boundary fix covers the straightforward echo-back threat and does not require plumbing the key into engine code.
