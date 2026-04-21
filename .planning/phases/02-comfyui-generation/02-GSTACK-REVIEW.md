---
phase: 02-comfyui-generation
reviewer: gstack /review (v1.1.0, garrytan/gstack)
reviewed: 2026-04-21T17:45:00Z
depth: standard
specialists_dispatched: critical-pass, security, performance, testing, maintainability, data-migration, api-contract
files_reviewed: 51
status: issues_found
findings_summary:
  critical: 6
  informational: 34
  total: 40
multi_specialist_confirmed:
  - path-traversal-project-sequence (critical-pass 9/10 + security 8/10)
  - missing-index-versions-status (performance 9/10 + data-migration 6/10)
  - schema-ddl-comment-drift (maintainability 8/10 + data-migration 8/10)
  - outputs_json-stringified (api-contract 8/10 + prior gsd-review WR-06)
  - concurrent-status-race (critical-pass 8/10 + prior gsd-review WR-02)
diff_base: origin/main (2288efa)
diff_stats: 51 files, +5533 / -97
---

# Gstack Pre-Landing Review — Phase 02

Second-opinion review via gstack v1.1.0 (6 specialist subagents + critical pass in parallel, diff vs `origin/main`). Complements the existing `02-REVIEW.md` from `/gsd-code-review`. Several findings overlap with the prior review's 7 warnings; others are new.

## PR Quality Score: 6.5 / 10

Baseline 10, minus (6 critical × 2 = 12 → floor at 0, then +6.5 weighted back for confirmed vs single-source). Rough guide, not absolute.

---

## CRITICAL — 6 findings

### C1. Path traversal via project/sequence names  (confirmed: critical-pass + security)
**File:** `src/utils/outputs.ts:59-62`
**Confidence:** 9/10

`buildOutputPath` only sanitizes the ComfyUI-returned `filename` via `sanitizeRelativeSegment`. `projectName`, `sequenceName`, `shotName` flow straight into `path.posix.join`. Phase 1 validated these as `z.string().min(1)` only. An agent (or compromised caller) creating a project named `..` or `../../tmp` causes generation outputs to land outside the `outputs` root — disk write attack surface.

**Fix:** Apply `sanitizeRelativeSegment` to every segment in `buildOutputPath` (not just `filename`), OR add a strict regex validator at the tool layer (`project-tool.ts`, `sequence-tool.ts`) rejecting `..`, `/`, `\`, NUL. Also resolve the final path with `path.resolve()` and assert it stays under the absolute `outputRoot` via `path.relative()` prefix check.

---

### C2. TOCTOU race in `transition()` lets completed rows regress to `running`  (critical-pass)
**File:** `src/store/version-repo.ts:131`
**Confidence:** 8/10

`transition(id, 'running')` does `UPDATE ... WHERE id = ?` with no `status` guard. `getGenerationStatus` is called from both the tool path AND the recovery poller. Race: poller A drives row to `completed`; concurrently tool B (with stale snapshot showing `submitted`) sees ComfyUI return `running` and calls `transition()`, which blindly UPDATEs status back to `running` on a row already at `completed` with `completed_at` and `outputs_json` populated. Zombie row. Violates D-GEN-20 immutability.

**Fix:** Add guard: `UPDATE versions SET status='running' WHERE id=? AND status='submitted' AND completed_at IS NULL`. Matches the pattern already used by `markCompleted` / `markFailed`.

Related to prior review's WR-02 (concurrent `getGenerationStatus`). Same root cause, different angle.

---

### C3. SSRF allowlist bypassed via secondary redirect  (security)
**File:** `src/comfyui/client.ts:210`
**Confidence:** 9/10

The signed-URL fetch in `download()` / `downloadToPath()` uses default `redirect: 'follow'`. Node's `fetch` silently follows up to 20 further redirects. If an allowlisted host (e.g. an S3 bucket misconfigured with a public redirect, or a compromised intermediary) responds with `302 http://169.254.169.254/` or `http://127.0.0.1/`, the second hop fetches internal content. The first-hop SSRF defense (`redirect: 'manual'` + host allowlist at line 188) is defeated.

**Fix:** Set `redirect: 'manual'` on the second fetch too; re-validate Location against `isAllowedHost`; enforce max-redirect-count of 0 on the signed-URL hop (signed URLs should not redirect further).

---

### C4. API key leaks across redirect from `submit()` / `status()`  (security)
**File:** `src/comfyui/client.ts:90` (submit), `client.ts:142` (status)
**Confidence:** 8/10

Neither `submit()` nor `status()` sets `redirect: 'manual'`. Node's `fetch` strips `Authorization` on cross-origin redirects but preserves custom headers — including `X-API-Key`. If `COMFYUI_API_BASE` returns a 302 (admin misconfiguration, compromised proxy, DNS attack), the API key forwards to the redirect target. This is the one secret the project's `stdio-hygiene` test spends significant effort protecting (D-GEN-12).

**Fix:** Add `redirect: 'manual'` to both fetches; treat any 3xx as an error (or re-issue manually after validating target host matches base origin).

---

### C5. Missing index on `versions.status` for recovery poller  (confirmed: performance + data-migration)
**File:** `drizzle/0001_phase2_version_lifecycle.sql:1`, `src/store/schema.ts:72`
**Confidence:** 9/10

`VersionRepo.listPendingVersions()` runs `WHERE status IN ('submitted', 'running')` at every server boot (recovery poller per D-GEN-28). No index on `status`. Full-table scan grows O(n) in total version count as completed rows accumulate. Retrofitting an index later requires another migration — Phase 2 is the first to write `versions` rows, so adding the index now is cheap.

**Fix:** Add `idxStatus: index('idx_versions_status').on(t.status)` to the drizzle table definition and a matching SQL in migration 0001. Partial index is even better: `CREATE INDEX idx_versions_pending ON versions(status) WHERE status IN ('submitted','running')` stays tiny because terminal rows are excluded.

---

### C6. Unbounded parallel pollers at boot (thundering-herd)  (performance)
**File:** `src/engine/generation.ts:238` (inside `start()`)
**Confidence:** 8/10

`start()` spawns one `drivePoller` per pending row with no concurrency cap. Boot after a crash with N pending versions fires N parallel HTTP calls to ComfyUI Cloud every ~2s. ComfyUI concurrency tiers are Free=1, Creator=3, Pro=5 — once >1 poller is active, the 429 rate-limit path is hit instantly and recovery itself becomes the thundering herd.

**Fix:** Introduce a concurrency limiter (e.g., `p-limit` or a small in-file queue) around `drivePoller` spawns. Cap at 3 (Creator tier default) or read from `COMFYUI_MAX_CONCURRENT_POLLS`. Jitter the initial sleep (`sleep(200 + random(800))`) so N pollers don't hit `/api/job/{id}/status` in the same millisecond.

Related to prior review's WR-03 (missing in-process poller after `submitGeneration`). Two ends of the same design gap.

---

## INFORMATIONAL — 34 findings (summary; full list below)

### Security (4 info — beyond the 2 critical above)

- **IS-01** `src/comfyui/client.ts:72` — `COMFYUI_ALLOWED_REDIRECT_HOSTS` regex only escapes `.`; other metacharacters (`|`, `+`, `*`, `[`, etc.) pass through. Admin typo `foo|.*` broadens to all hosts. **Fix:** use a proper regex-escape helper, or drop regex entirely and match on exact hostname or suffix. (confidence 7/10)
- **IS-02** `src/server.ts:135` — No protocol enforcement on `COMFYUI_API_BASE`. `http://` base sends API key in cleartext. No blocklist against `127.0.0.0/8`, `169.254.169.254`, RFC1918. **Fix:** assert `protocol === 'https:'` at boot; reject loopback/RFC1918 unless explicit dev flag. (confidence 7/10)
- **IS-03** `src/comfyui/client.ts:217` — No max-body-size cap on `res.text()` (submit error path), `res.json()` (status), or streamed download. Unbounded ComfyUI or allowlisted-host response exhausts memory/disk. **Fix:** add `MAX_ERROR_BODY_BYTES = 64_000` with size-guarded reader; `maxBytes` option on downloads. (confidence 6/10) — mirrors prior review's WR-04/05.
- **IS-04** `src/engine/generation.ts:84` — ComfyUI error messages persisted verbatim into `versions.error_message` and surfaced to agents. Low-probability leak if ComfyUI echoes request headers. **Fix:** scrub API key literal before persisting; truncate to ~1000 chars. (confidence 5/10)

### Performance (3 info — beyond the 2 critical above)

- **IP-01** `src/engine/generation.ts:214` — `DOWNLOAD_RETRY_DELAYS[2]` (8000ms) is computed but never slept on; loop exits after `attempt` hits 3. Dead code that misleads readers about retry spacing (real: 2s+4s between 3 attempts). **Fix:** rename to `DOWNLOAD_BETWEEN_ATTEMPT_DELAYS = [2_000, 4_000]` with comment. Optionally parallelise per-output downloads. (confidence 8/10)
- **IP-02** `src/utils/outputs.ts:96` — `resolveCollisionSuffix` does sequential `await access()` on up to 10K candidates. **Fix:** `readdir(dirPath)` once, build a Set, scan counter space in memory. (confidence 7/10)
- **IP-03** `src/comfyui/client.ts:244` — `createWriteStream(partial)` is outside the try block in `downloadToPath`. If stream constructor throws synchronously (EACCES, ENOSPC), `.partial` leaks. **Fix:** move inside try block. (confidence 7/10)

### Testing (~19 info — missing coverage)

- **IT-01** `client.test.ts:293` — Test titled "throws DOWNLOAD_FAILED" actually triggers COMFYUI_API_ERROR. Assertion lax. **Fix:** correct title or add a real stream-mid-pipe-error test. (confidence 9/10)
- **IT-02** `client.test.ts:85` — `submit` network-error try/catch (thrown fetch) untested. Same gap for `status()`. (confidence 9/10)
- **IT-03** `client.test.ts:111` — Submit 200-without-prompt_id branch untested. (confidence 9/10)
- **IT-04** `client.test.ts:197` — Redirect-missing-Location and Redirect-invalid-URL branches untested. (confidence 9/10)
- **IT-05** `client.test.ts:149` — Signed-URL 403/404 paths lumped in with DOWNLOAD_FAILED. (confidence 8/10)
- **IT-06** `client.test.ts:256` — Missing `content-length` fallback branch only tested indirectly. (confidence 8/10)
- **IT-07** `client.test.ts:228` — SSRF hostile redirect targets (`127.0.0.1`, `169.254.169.254`, `::1`, suffix attacks) not tested. (confidence 8/10)
- **IT-08** `client.test.ts:63` — BASE-origin auto-inclusion in allowlist untested (self-hosted tenant regression). (confidence 7/10)
- **IT-09** `backoff.test.ts:40` — `sleep` mid-sleep abort path untested. (confidence 9/10)
- **IT-10** `generation.test.ts:156` — `'cancelled'` and unknown-status fallthrough untested. (confidence 9/10)
- **IT-11** `generation.test.ts:130` — `'missing job_id'` guard untested. (confidence 9/10)
- **IT-12** `generation.test.ts:289` — Recovery poller for rows in `'running'` state (not just `'submitted'`) untested. (confidence 8/10)
- **IT-13** `generation.test.ts:184` — Path-traversal filename at engine level (integration of C1 fix) untested. (confidence 8/10)
- **IT-14** `generation.test.ts:184` — Filename-collision at engine level untested. (confidence 8/10)
- **IT-15** `generation.test.ts:184` — Zero-outputs completed response untested. (confidence 8/10)
- **IT-16** `generation.test.ts:122` — CONCURRENT_SUBMIT_CONFLICT propagation untested. (confidence 8/10)
- **IT-17** `version-repo.test.ts:107` — `markCompleted` after `markFailed` no-op untested (reverse of existing test). (confidence 8/10)
- **IT-18** `stdio-hygiene.test.ts:75` — SIGTERM → `engine.stop()` path untested at integration level. (confidence 7/10)
- **IT-19** `live-smoke.test.ts:113` — Gate only checks `COMFYUI_API_KEY`. A dev with `.env` loaded burns credits on any `npx vitest` run. **Fix:** add `RUN_LIVE_SMOKE=1` double-opt-in. (confidence 7/10)

### Maintainability (6 info)

- **IM-01** `src/test-utils/fake-engine.ts:25` — FakeEngine's Phase 2 extensions (~100 lines) have zero importers anywhere. Grep confirms: `generation-tool.test.ts` wires a real Engine + FakeComfyUIClient. **Fix:** delete the extensions or convert the test to use FakeEngine. (confidence 9/10)
- **IM-02** `src/test-utils/fake-comfyui-client.ts:156` — `downloadToPath` is a ~30-line copy-paste of `ComfyUIClient.downloadToPath`. **Fix:** extract to `src/utils/stream-to-path.ts` shared helper. (confidence 9/10)
- **IM-03** `src/store/schema.ts:76` — "Kept in sync VERBATIM" comment is now stale — Phase 2 added columns only to the Drizzle table, not SCHEMA_DDL. **Fix:** rewrite comment to explain the intentional split (Phase 1 bootstrap vs Phase 2 migration). (confidence 8/10) — confirmed by data-migration as IDM-01.
- **IM-04** `src/store/schema.ts:63` — Comment above the 3 new columns claims they're "present at CREATE TABLE time on fresh DBs via SCHEMA_DDL" — factually wrong. They're added by migration 0001 on every DB. **Fix:** correct the comment. (confidence 8/10)
- **IM-05** `src/utils/outputs.ts:96` — Magic number `10_000` as collision-suffix ceiling. **Fix:** hoist to `MAX_COLLISION_SUFFIX` constant. (confidence 5/10)
- **IM-06** `src/server.ts:135` — Default `'https://cloud.comfy.org'` duplicated across server.ts, live-smoke.test.ts, client.test.ts, stdio-hygiene.test.ts. **Fix:** export `DEFAULT_COMFYUI_API_BASE` from client.ts. (confidence 4/10)

### Data Migration (3 info — beyond the index already in C5)

- **IDM-01** `drizzle/meta/0001_snapshot.json:5` — Snapshot baseline declares 0001 as "first ever migration" (`prevId = 0000...`), but on fresh DBs SCHEMA_DDL creates base tables first. Future `drizzle-kit generate` will only diff schema.ts vs snapshot — any SCHEMA_DDL/schema.ts drift ships silently broken on fresh DBs. **Fix:** either generate SCHEMA_DDL from schema.ts at build time, or add a test that simulates a Phase-1-only DB then runs openDb. (confidence 7/10)
- **IDM-02** `src/store/__tests__/migrate.test.ts:29` — No test for "existing Phase-1 DB → migrate-only upgrade". Current tests only co-apply SCHEMA_DDL + migration on fresh DBs. The actual upgrade path has no coverage. **Fix:** add a test that manually writes Phase-1 DDL without migrate, closes, then reopens to trigger migrate. (confidence 7/10)
- **IDM-03** `drizzle/0001_phase2_version_lifecycle.sql:1` — No down/rollback migration. Phase 2 additions are all nullable/additive so rollback is not code-path-critical, but establishing rollback discipline now is cheaper. **Fix:** add a no-op down file with documented "rollback not supported — additive migration, old code tolerates new columns". (confidence 6/10)

### API Contract (5 info)

- **IAC-01** `src/tools/generation-tool.ts:43` — `outputs_json` reaches agents as a JSON-encoded string instead of a typed `StoredOutput[]`. Violates CLAUDE.md's "no raw JSON dumps to agents" rule. **Fix:** parse in `shapeVersionEntity`; surface `outputs` as typed array, drop the stringified column. (confidence 8/10) — confirmed by prior gsd-review WR-06.
- **IAC-02** `src/tools/generation-tool.ts:47` — Response entity carries both `error_message` (from `...entity` spread) AND new `error` alias. Duplicate field, drift risk. **Fix:** pick one name; destructure `error_message` out of spread. (confidence 8/10)
- **IAC-03** `src/engine/generation.ts:113` — Dual error model: domain failures (TIMEOUT, DOWNLOAD_FAILED) return success envelope with `entity.status='failed'`; infra failures (MISSING_CREDS, SHOT_NOT_FOUND) throw TypedError → `isError: true`. Agents only checking `isError` miss domain failures. **Fix:** document explicitly in tool description; consider adding `entity.terminal` boolean for agent ergonomics. (confidence 7/10)
- **IAC-04** `src/engine/pipeline.ts:44` — Engine constructor signature changed from `(repo)` to `(repo, versionRepo, client?, outputRoot?)`. `versionRepo` is required positional with no default — silent breakage risk. All Phase 1 test call-sites updated, but any downstream consumers are broken. **Fix:** document in changelog, or accept an options object for backwards-compat. (confidence 9/10)
- **IAC-05** `src/types/hierarchy.ts:37` — `Version.status` typed as wide `string` rather than `'submitted' | 'running' | 'completed' | 'failed'`. Engine already treats this as a closed set. **Fix:** narrow to a discriminated union and export `VersionStatus` alias. (confidence 7/10)

---

## Overlap With Prior `02-REVIEW.md`

| Prior finding | Gstack echo | Status |
|---|---|---|
| WR-01 (raw.outputs no validation) | IT-03, IT-04 (testing coverage) + IS-04 (security truncation) | Elaborated |
| WR-02 (concurrent status mutex) | C2 (TOCTOU in transition) + IT-12 | Deeper diagnosis, specific fix |
| WR-03 (no poller on submit) | C6 (unbounded pollers at boot) | Different angle on same gap |
| WR-04/05 (no body size cap) | IS-03 | Confirmed |
| WR-06 (outputs_json as string) | IAC-01 | Confirmed |
| WR-07 (POSIX path joining) | (no echo) | Gstack did not flag — cross-platform nit only |

---

## New Findings Not in Prior Review

The material new critical finds that `/gsd-code-review` missed:

1. **C1 Path traversal via project/sequence names** — the most important. Project names are user/agent input; nothing sanitizes them when they become disk paths.
2. **C3 SSRF bypass via secondary redirect** — the security story is incomplete. First hop is defended; second hop forwards.
3. **C4 API key leaks across redirect from submit/status** — `redirect: 'manual'` is only on download. Submit/status have none.
4. **C5 Missing index on `versions.status`** — boot-time recovery-poller query will degrade.
5. **C6 Unbounded poller concurrency at boot** — thundering herd on restart with many pending rows.
6. **IM-01 FakeEngine Phase 2 extensions are ~100 lines of dead code** — delete or use them.
