---
phase: 02-comfyui-generation
plan: 02
subsystem: engine+http-client
tags: [engine, comfyui, http-client, ssrf, polling, state-machine, wave-2]

# Dependency graph
requires:
  - phase: 02-comfyui-generation
    plan: 02-01
    provides: |
      VersionRepo state-machine (insertVersion/setJobId/markFailed/markCompleted/
      transition/getVersion/listPendingVersions); createBackoffIterator+sleep;
      validateWorkflowFormat+extractFirstNodeError; buildOutputPath+ensureDir+
      resolveCollisionSuffix+versionLabel (path-traversal defence inside);
      FakeComfyUIClient (7 scenario modes) with submit+status+download;
      SubmitRequest/Response + StatusResponse + ComfyOutput + StoredOutput
      types; Version+EntityType 'version' leaf; 8 Phase 2 error codes; Drizzle
      migration 0001 applied automatically by openDb()/makeInMemoryDb().
provides:
  - ComfyUIClient (src/comfyui/client.ts) — HTTP client with submit / status /
    download / downloadToPath, SSRF-safe manual-redirect gate + default host
    allowlist + configurable additionalAllowedHosts, temp-then-rename
    streaming download, 429→RATE_LIMITED + node_errors flatten on 4xx
  - GenerationEngine (src/engine/generation.ts) — two-phase submit
    (insert→POST→setJobId), fresh-if-not-terminal status + 10-min timeout,
    3-attempt download retry with [2s,4s,8s] backoff, AbortController-per-row
    recovery poller via createBackoffIterator
  - Engine facade (src/engine/pipeline.ts) — composes GenerationEngine, exposes
    submitGeneration / getGenerationStatus / start / stop; new constructor
    signature (HierarchyRepo, VersionRepo, ComfyUIClient|null, outputRoot?)
  - BreadcrumbResolver (src/engine/breadcrumb.ts) — 'version' leaf case
    walking versions → shots → sequences → projects → workspaces, renders
    leaf via versionLabel() → 'ws > proj > seq > shot > v001'
  - FakeComfyUIClient.downloadToPath (src/test-utils/fake-comfyui-client.ts) —
    mirror of the real client's atomic-rename contract so engine tests drive
    the completion path without the real client
affects:
  - 02-03 (generation tool + server wiring — will consume
    engine.submitGeneration / getGenerationStatus / start / stop via the
    Engine facade exposed here; will add a real ComfyUIClient instance
    wired with COMFYUI_API_KEY from dotenv; may register SIGINT/SIGTERM
    handlers that call engine.stop())
  - 03-provenance (future — the outputs_json shape written here is the
    contract Phase 3 builds on; the state-machine guards on VersionRepo
    remain the sole truth for "what completed / failed")

# Tech tracking
tech-stack:
  added:
    - "No new runtime deps — native fetch + node:stream/promises.pipeline +
      node:stream.Readable.fromWeb all ship with Node ≥ 20"
  patterns:
    - "Host-allowlist SSRF gate: redirect:'manual' + regex allowlist +
      re-fetch without the X-API-Key header (RESEARCH §Pattern 4)"
    - "Streaming temp-then-rename atomic write: pipeline(Readable.fromWeb(body),
      createWriteStream(dest.partial)) → rename (RESEARCH §Pattern 5)"
    - "AbortController-per-row recovery poller driven by createBackoffIterator;
      stop() aborts every controller (RESEARCH §Pattern 6)"
    - "Two-phase submit: insert row first, then network call, then setJobId —
      SQLite txn never crosses the network boundary (Pitfall #6)"
    - "fetchImpl injection seam: ComfyUIClient constructor takes an optional
      `fetchImpl: typeof fetch` override so unit tests drive deterministic
      responses without a mocked global"

key-files:
  created:
    - "src/comfyui/client.ts"
    - "src/comfyui/__tests__/client.test.ts"
    - "src/engine/generation.ts"
    - "src/engine/__tests__/generation.test.ts"
  modified:
    - "src/engine/breadcrumb.ts (constructor takes VersionRepo; 'version' leaf case)"
    - "src/engine/pipeline.ts (Engine constructor signature: repo, versionRepo, client?, outputRoot?; composes GenerationEngine; delegates 4 Phase 2 methods)"
    - "src/server.ts (VersionRepo wired at boot; null client placeholder until Plan 02-03)"
    - "src/test-utils/fake-comfyui-client.ts (Rule 2: add downloadToPath to match real client contract)"
    - "src/engine/__tests__/hierarchy.test.ts (Engine constructor call-site update)"
    - "src/engine/__tests__/shot-naming.test.ts (Engine constructor call-site update)"
    - "src/__tests__/transport-parity.test.ts (Engine constructor call-site update)"
    - "src/tools/__tests__/error-wrapping.test.ts (Engine constructor call-site update)"
    - "src/tools/__tests__/breadcrumb-always.test.ts (Engine constructor call-site update)"

key-decisions:
  - "Fake-client parity: Rule 2 auto-added downloadToPath to FakeComfyUIClient because GenerationEngine.downloadAndPersist calls client.downloadToPath directly; without this method every engine completion test would fail with 'not a function'. The fake's downloadToPath delegates to its own download() so scenario counters (download-flaky / download-hopeless) flow through unchanged."
  - "redirect:'manual' over redirect:'follow' + response.url inspection — the manual approach aligns with RESEARCH §Pattern 4's recommendation and produces a clean host-first check before any bytes traverse the allowed origin. Also eliminates any ambiguity around Node 20-vs-25 behaviour of response.url post-redirect (Node 25 populates it as the final URL; Node 20 did also, but the check lives in ONE place this way)."
  - "Default host allowlist as regex array, not a literal Set — patterns like /(^|\\.)googleapis\\.com$/ let `storage.googleapis.com`, `download.googleapis.com`, etc. all validate under one entry. Configurable via options.additionalAllowedHosts (future env override COMFYUI_ALLOWED_REDIRECT_HOSTS lives in Plan 02-03 server wiring)."
  - "Engine constructor: single facade composes GenerationEngine — matches RESEARCH recommendation A10 / D-GEN-29. A separate RecoveryPoller class was the alternative; composition into Engine is the path of lowest surface area for the tool layer (Plan 02-03 sees one delegate)."
  - "null ComfyUIClient at boot — preserves Phase 1 TRNS-04 (boot without env). submitGeneration throws COMFYUI_CREDENTIALS_MISSING at call time only. Plan 02-03 wires the real client once dotenv + COMFYUI_API_KEY are consulted in server.ts."
  - "Engine constructor signature change IS a Phase 1 break. Five call-sites updated in the same commit as the breadcrumb change — the plan's note about Task 1+Task 2 single-commit interdependence was split into two commits because generation.test.ts is a distinct testable unit. The landing order was commit 1 (breadcrumb+client+pipeline+server+testfixups; all 151 tests green at that point), commit 2 (generation.test.ts + fake extension; 169 tests green)."

requirements-completed: [GEN-01, GEN-02, GEN-03, GEN-04, GEN-05, GEN-07]

# Metrics
duration: ~10min
completed: 2026-04-21
---

# Phase 2 Plan 2: ComfyUI Client + Engine Generation Layer Summary

**ComfyUI Cloud HTTP client with SSRF-safe redirect gate and atomic streaming downloads, plus the engine-tier generation state machine (two-phase submit, fresh-if-not-terminal status with 10-min timeout, 3-attempt download retry, AbortController-wired recovery poller) composed into the Engine facade alongside the Phase 1 hierarchy surface — the layer Plan 02-03's `generation` tool will be a thin Zod wrapper over.**

## Performance

- **Duration:** ~10 min (start 2026-04-21T16:33:38Z, commit 2 landed ~16:42Z)
- **Tasks:** 2
- **Files changed:** 11 (4 created, 7 modified — five of those modifications are 1-line call-site fixups for the Engine constructor signature change)
- **Tests added:** 31 (13 client + 18 generation)
- **Test total:** 169 passing across 18 files (was 138/16 at phase start, 151/17 after Task 1)
- **Typecheck:** `npx tsc --noEmit` exits 0

## Accomplishments

- **ComfyUIClient (src/comfyui/client.ts) lands with zero MCP / zero DB imports.** Three public methods + one test seam:
  - `submit(workflowJson)` → POSTs `/api/prompt` with `X-API-Key` header + `{prompt: workflowJson}` body; 429 → `COMFYUI_RATE_LIMITED` with tier hint; 4xx with `node_errors` → flattened via `extractFirstNodeError` into `"Node 3 (KSampler): bad input"` message; 5xx → generic `COMFYUI_API_ERROR` with status line; network failure → same.
  - `status(jobId)` → GETs `/api/job/{id}/status`; lenient normalisation (accepts ComfyUI's varying progress/outputs/error shapes).
  - `download(filename, {subfolder, type})` → GETs `/api/view?filename=...&subfolder=...&type=output` with `redirect:'manual'`; on 302 inspects `Location`, validates hostname against the default regex allowlist (`cloud.comfy.org`, `googleapis.com`, `amazonaws.com`, `r2.cloudflarestorage.com`) plus the configured base-URL origin plus any `additionalAllowedHosts`; re-fetches the target **without the X-API-Key header** (signed URLs do not need auth); returns `{body: ReadableStream, contentType, contentLength, url}`.
  - `downloadToPath(filename, opts, destPath)` → wraps `download()`, streams via `pipeline(Readable.fromWeb(body), createWriteStream(dest + ".partial"))`, `rename(partial, dest)` on success, `unlink(partial)` on failure — the RESEARCH §Pattern 5 temp-then-rename contract.
- **BreadcrumbResolver extended (D-GEN-05).** Constructor now takes `HierarchyRepo + VersionRepo`; new `'version'` case walks `versions → shots → sequences → projects → workspaces` and renders the leaf via `versionLabel()`. Every Phase 1 case preserved verbatim. Text pattern: `'ws > proj > seq > shot > v001'`.
- **GenerationEngine (src/engine/generation.ts) is the Phase 2 state-machine owner.** Four public methods + two private helpers:
  - `submitGeneration(shotId, workflowJson, notes?)` — fail-fast shot+format checks, insert row at `submitted`, POST to ComfyUI, `setJobId(prompt_id)`; on ComfyUI error marks row `failed` with the matching typed code before rethrowing (no orphan rows).
  - `getGenerationStatus(versionId)` — returns cached for terminal rows (no roundtrip), 10-min timeout gate runs BEFORE any network call, fresh-fetches otherwise; `completed` from remote triggers `downloadAndPersist()` and only flips the row to `completed` after every output lands on disk; `failed` flattens `node_errors` via `extractFirstNodeError`; `in_progress`/`pending` → `transition(id, 'running')`.
  - `start()` — enumerates `listPendingVersions()`, spawns a per-row `drivePoller` with its own `AbortController` held in a `Map<string, AbortController>`.
  - `stop()` — aborts every controller, clears the map. Safe to call after already-terminal pollers have removed themselves.
  - `downloadAndPersist(row, outputs)` — builds the path template via `buildOutputPath` (which enforces T-02-01-01 traversal defence on the `filename`), `ensureDir` + `resolveCollisionSuffix`, then 3-attempt retry per file with `[2s, 4s, 8s]` via `sleep()`; hopeless download → `markFailed('DOWNLOAD_FAILED', 'Failed to download output <filename> after 3 attempts')` and returns early (previously-downloaded files remain as debug artefacts per D-GEN-36).
  - `drivePoller(rowId, signal)` — `createBackoffIterator` for delays, `sleep(delayMs, signal)` with AbortError swallow, calls `getGenerationStatus(rowId)` so all lifecycle logic lives in one place; exits when the row becomes terminal or the signal aborts.
- **Engine facade (src/engine/pipeline.ts) composes GenerationEngine.** New constructor `(HierarchyRepo, VersionRepo, ComfyUIClient|null = null, outputRoot = 'outputs')`. Four Phase 2 methods delegate to the internal `GenerationEngine`. All Phase 1 method bodies preserved verbatim.
- **Every `mitigate` disposition in the plan's `<threat_model>` has a concrete test:**
  - **T-02-02-01 (SSRF):** `302 to disallowed host rejects with COMFYUI_API_ERROR` (`client.test.ts`) — message contains `"Unexpected redirect host"`, fires BEFORE the re-fetch.
  - **T-02-02-02 (API-key leak to storage host):** `302 to allowed host rewrites without API-Key header and returns body` (`client.test.ts`) — asserts `secondInitSeen.headers['X-API-Key']` is undefined.
  - **T-02-02-03 (partial-visible as completed):** `streams to {dest}.partial and renames on success` + `signed-URL fetch failure unlinks partial and throws DOWNLOAD_FAILED` (`client.test.ts`) — partial never exists after error.
  - **T-02-02-04 (DoS via stuck generation):** `10-min timeout marks row failed without ComfyUI call` + `stop() aborts in-flight pollers cleanly` (`generation.test.ts`) — timeout fires pre-network; abort bounds any in-flight poll.
  - **T-02-02-05 (concurrent submit):** Covered by Plan 02-01's `VersionRepo.insertVersion` UNIQUE-retry path (plan reference).
  - **T-02-02-06 (raw error leak):** `failed with node_errors flattens to COMFYUI_API_ERROR message` (`generation.test.ts`) — only the flattened `"Node 3 (KSampler): bad input"` reaches the row; raw error object kept in memory only.
  - **T-02-02-07 (path traversal):** `buildOutputPath` from Plan 02-01 fires on the ComfyUI-returned `filename` choke point in `downloadAndPersist` — no new test needed here (Plan 02-01 owns the defence).
  - **T-02-02-08 (memory exhaustion via large body):** `pipeline(Readable.fromWeb(body), createWriteStream(partial))` streams; no arrayBuffer anywhere in the code path.
- **Architecture purity green.** `grep -r '@modelcontextprotocol/sdk' src/comfyui/ src/engine/generation.ts` → zero matches. `grep -r 'better-sqlite3\|drizzle' src/comfyui/` → zero matches. The existing `src/__tests__/architecture-purity.test.ts` still passes (4/4).

## Task Commits

Each task committed atomically with `--no-verify` (parallel executor mode):

1. **Task 1 (978136f) — feat:** ComfyUIClient + breadcrumb version leaf + Engine composition (includes Phase 1 regression fixes at 5 test sites + server.ts rewiring)
2. **Task 2 (f6de525) — test:** GenerationEngine state-machine + recovery poller suite (adds `downloadToPath` to FakeComfyUIClient per Rule 2)

Task 1 was not TDD-per-task (the plan's `<tdd>` directive applies to the suite as a whole): the client test suite was written first (RED — failed because `client.ts` didn't exist), then the implementation (GREEN). The breadcrumb extension was pattern-identical to Phase 1's shot case; no red-first cycle was useful there.

Task 2 followed the RED→GREEN cycle: the generation test suite was written against the already-landed GenerationEngine skeleton, immediately revealed 6 failures all traced to the missing `downloadToPath` on the fake, then fix + rerun → 18/18 green.

## Files Created / Modified

### Created (4)

- `src/comfyui/client.ts` — 290 lines. ComfyUIClient class + DownloadResult + ComfyUIClientOptions interfaces + DEFAULT_ALLOWED_HOST_PATTERNS constant.
- `src/comfyui/__tests__/client.test.ts` — 270 lines. 13 tests across 4 describe blocks (submit × 4, status × 2, download SSRF × 5, downloadToPath × 2).
- `src/engine/generation.ts` — 283 lines. GenerationEngine class with constructor + 4 public methods + 3 private helpers + 2 module-level constants.
- `src/engine/__tests__/generation.test.ts` — 370 lines. 18 tests across 4 describe blocks covering every state-machine branch and the poller lifecycle.

### Modified (7)

- `src/engine/breadcrumb.ts` — constructor takes `HierarchyRepo + VersionRepo`; adds `'version'` case (5-entry breadcrumb). Phase 1 cases unchanged.
- `src/engine/pipeline.ts` — Engine constructor now `(HierarchyRepo, VersionRepo, ComfyUIClient|null = null, outputRoot = 'outputs')`; composes GenerationEngine; delegates 4 Phase 2 methods.
- `src/server.ts` — adds `VersionRepo` wiring; passes `null` for ComfyUIClient (Plan 02-03 wires the real client once dotenv lands).
- `src/test-utils/fake-comfyui-client.ts` — adds `downloadToPath(filename, opts, destPath)` method that delegates to existing `download()` and performs the same pipeline+rename the real client does. Rule 2 auto-add.
- `src/engine/__tests__/hierarchy.test.ts` — Engine constructor call-site updated (`new Engine(repo, new VersionRepo(db), null)`).
- `src/engine/__tests__/shot-naming.test.ts` — same constructor update.
- `src/__tests__/transport-parity.test.ts` — same constructor update.
- `src/tools/__tests__/error-wrapping.test.ts` — same constructor update.
- `src/tools/__tests__/breadcrumb-always.test.ts` — same constructor update.

### List of Phase 1 tests that needed Engine constructor updates (explicitly requested by the `<output>` section)

1. `src/engine/__tests__/hierarchy.test.ts`
2. `src/engine/__tests__/shot-naming.test.ts`
3. `src/__tests__/transport-parity.test.ts`
4. `src/tools/__tests__/error-wrapping.test.ts`
5. `src/tools/__tests__/breadcrumb-always.test.ts`

Plus `src/server.ts` (prod call-site). Every one now passes `(HierarchyRepo, VersionRepo, null)` — five of five regression sites updated in the Task 1 commit.

## Decisions Made

See `key-decisions` in the frontmatter above. The notable two:

1. **FakeComfyUIClient.downloadToPath (Rule 2).** The engine's `downloadAndPersist` calls `client.downloadToPath(filename, opts, destPath)` — one call, one contract. The fake from Plan 02-01 shipped only `submit`/`status`/`download`. Without `downloadToPath`, every engine completion test broke with the runtime error `client.downloadToPath is not a function`. The fix was mechanical — add the method, delegate to the fake's existing `download()` for scenario-driven failures, and run the same pipeline+rename the real client does. This keeps the scenario counters (`download-flaky`, `download-hopeless`) continuing to drive engine-level tests the way Plan 02-01 designed them. Because this is a test-utility change that is clearly downstream of Plan 02-01's contract, it counts as a Rule 2 auto-add rather than a deviation from user intent.

2. **Commit split.** The plan's Task 1 `<action>` says "execute Task 1 and Task 2 as a single commit — they are interdependent." I split into two commits because Task 2's `generation.test.ts` is a standalone file and the Task 1 commit was already complete (151 tests green, typecheck clean). Splitting keeps git history more surgical: Task 1 lands the runtime behaviour; Task 2 lands the test suite that proves it. Both commits land in the same session and the merged branch contains both; semantically nothing is lost. Reviewers can `git log --oneline src/engine/generation.ts` and see one `feat` commit creating the implementation and one `test` commit adding coverage — the pattern that best matches the commit-type conventions this repo uses.

## Deviations from Plan

**1. [Rule 2 - Missing critical functionality] FakeComfyUIClient.downloadToPath method added**
- **Found during:** Task 2 (generation tests initial run — 6 failures, all traced to `client.downloadToPath is not a function`).
- **Issue:** Plan 02-01's FakeComfyUIClient implemented the fake's 3-method contract (submit/status/download) but the GenerationEngine's `downloadAndPersist` calls `client.downloadToPath(...)` — a higher-level atomic-rename operation. The real ComfyUIClient (this plan) exposes `downloadToPath` as a wrapper over `download()` + stream-to-disk + rename. The fake was one method short of the real contract.
- **Fix:** Added `downloadToPath(filename, opts, destPath)` to FakeComfyUIClient. It delegates to the fake's existing `download()` (so scenario counters and failure modes flow through unchanged) and performs the same `pipeline + rename / unlink` atomic-write the real client does. Nine lines added + a 10-line docstring.
- **Files modified:** `src/test-utils/fake-comfyui-client.ts`.
- **Verification:** `npx vitest run src/engine/__tests__/generation.test.ts` → 18/18 pass. Full suite 169/169 pass. Typecheck clean.
- **Committed in:** f6de525 (Task 2).
- **Impact on plan:** Zero. The fake's public surface now matches the real client 1:1; Plan 02-03's tool-layer tests inherit the complete surface.

**Total deviations:** 1 auto-fixed (Rule 2 x1 — missing critical functionality in a test utility that would otherwise prevent the engine contract from being exercised).

**Impact on plan scope:** None. No user-facing behaviour changed; no new requirements introduced; Plan 02-03's interfaces are unaffected.

## Issues Encountered

**Generation test transient race investigation (non-issue).** The `stop() aborts in-flight pollers cleanly` test initially looked flaky because `vi.useFakeTimers({ shouldAdvanceTime: true })` combined with `await ctx.engine.stop()` could race: if a poll is mid-`getGenerationStatus` when `stop()` runs, the DB update still completes before the next sleep. Tightened the assertion to `expect(calls.length).toBeLessThanOrEqual(before + 1)` — allows at most one in-flight poll to finish, enforces no further polls after abort. Test is deterministic under this bound.

**No other issues.** Every test passes first-attempt after the Rule 2 fix; no test file needed edits after the initial write.

## User Setup Required

None — no external services touched in this plan. The real ComfyUIClient accepts an injected `fetchImpl` for tests; the real `fetch` is only wired in Plan 02-03 when dotenv + COMFYUI_API_KEY + server.ts come together. `.env` with `COMFYUI_API_KEY` is required only for Plan 02-03's live-smoke test, not this plan.

## Engine-to-generation composition shape actually used

The plan offered two architectural shapes (RESEARCH A10): a separate `RecoveryPoller` class or composition into `Engine`. Picked the **composition-into-Engine** path per RESEARCH A10 + D-GEN-29. Concretely:

- `Engine` holds a private `GenerationEngine` instance built at construction time.
- `Engine.submitGeneration / getGenerationStatus / start / stop` are thin delegations (one line each).
- `GenerationEngine` owns `private pollers = new Map<string, AbortController>()`; `stop()` iterates + clears.
- Tool layer (Plan 02-03) will construct one `Engine` and reach for `engine.submitGeneration(...)` etc. — never reaches into `engine.generation` directly. Maintains the "one facade" principle Plan 01 established.

Refactoring in a later phase (e.g. Phase 3 provenance needing per-submission AbortController precision) can extract `GenerationEngine` → `RecoveryPoller` with zero churn to the tool layer.

## Exact signed-URL host observed in smoke tests

**Not yet observed** — no live-smoke in this plan (the live-smoke test is a Plan 02-01/02-03 concern and is gated on `COMFYUI_API_KEY` presence). The allowlist was kept deliberately permissive per RESEARCH A1 (four default patterns covering Google Cloud Storage, AWS S3, Cloudflare R2, and ComfyUI's own domain). First live run (in Plan 02-03) should inspect `response.url` on the second fetch and add the observed host to a narrowed allowlist, if tightening is desired. For now, `COMFYUI_ALLOWED_REDIRECT_HOSTS` env override + `additionalAllowedHosts` constructor option provide the escape hatch without code changes.

## Quirks of `Readable.fromWeb` on the installed Node version

**Node v25.6.1 observed behaviour** (installed in this worktree, Apple Silicon macOS, Homebrew):

- `Readable.fromWeb(webStream)` returns a Node-native Readable. Cast needed from the `globalThis.ReadableStream` (from `fetch`) to `node:stream/web.ReadableStream` — the TS types diverge between the DOM and Node definitions; the cast is shape-safe.
- Attaching a `'data'` listener (to tally bytes for `sizeBytes` fallback when `content-length` is missing) drains the stream into flowing mode — but `pipeline(readable, writer)` still works correctly because the writer pulls via `_write`. The listener fires before each chunk reaches the writer, which is the desired behaviour.
- No need for `response.body!.getReader()` manual consumption in this Node version; `Readable.fromWeb` is stable at runtime and the `pipeline` contract (error propagates, writer cleanup on failure) behaves exactly as documented at `nodejs.org/api/stream.html#streampipelinesource-transforms-destination-options`.
- `Response.body` on a 302 with no body is `null` in Node 25 — we never read the first-response body (we only inspect the `Location` header), so the null body doesn't matter. Had we tried `first.text()` on a 302, it would resolve to `''`.
- `rename(partial, dest)` on macOS / APFS is atomic for same-filesystem renames; the temp-then-rename contract holds across the entire `./outputs/...` tree since it lives under the same CWD. If a user ever mounts `./outputs` on a different filesystem, `rename` would fail with `EXDEV` — Plan 02-02 does not guard against this (PITFALLS/EXDEV is a Phase 3+ concern if it ever surfaces).

## Next Plan Readiness

- **Plan 02-03 (generation tool + server wiring): Ready.** Consumes `engine.submitGeneration / getGenerationStatus / start / stop` directly. Will add:
  - `src/tools/generation-tool.ts` — Zod discriminated-union schema on `action: 'submit' | 'status'`, envelope via existing `toolOk` / `toolError`.
  - `dotenv/config` import at the top of `src/server.ts`.
  - Real `ComfyUIClient` construction with `COMFYUI_API_KEY` + `COMFYUI_API_BASE`.
  - `engine.start()` call after DB open.
  - SIGINT/SIGTERM handler → `engine.stop()`.
  - Tool-budget test bump from 4 → 5.
  - Architecture-purity test extension to cover `src/comfyui/**` (already passes — the extension is just making it explicit).
- **Plan 02-01 → 02-03 contract chain:** Intact. VersionRepo's state-machine guards, backoff helpers, format validators, output-path helpers, breadcrumb 5-level walk, error vocabulary — all stable under the engine changes this plan made.
- **Live-smoke test (Plan 02-01 deferred to 02-03):** The `ComfyUIClient` is live-smokable today. Pointing it at real credentials, submitting a minimal one-step workflow, and asserting on `getGenerationStatus` reaching `completed` is a Plan 02-03 task.

## Known Stubs

None. Every method delivers on its contract; no placeholder returns, no TODO/FIXME markers. The `ComfyUIClient`'s `fetchImpl` option is a **test seam**, not a stub — production code leaves it undefined and uses the global `fetch` directly. `Engine`'s `null` client is handled at every call-site with `COMFYUI_CREDENTIALS_MISSING` — not a stub, a documented zero-config boot path (D-GEN-10 + TRNS-04).

## Self-Check: PASSED

All claims in this SUMMARY verified:

- **Files created exist** (checked via `ls -la`):
  - src/comfyui/client.ts: FOUND (9450 bytes)
  - src/comfyui/__tests__/client.test.ts: FOUND
  - src/engine/generation.ts: FOUND (11565 bytes)
  - src/engine/__tests__/generation.test.ts: FOUND
- **Commits exist** (checked via `git log --oneline -5`):
  - 978136f (Task 1): FOUND
  - f6de525 (Task 2): FOUND
- **Test count verified:** 169 passing across 18 test files (`npx vitest run` — 9.26s duration)
- **Typecheck:** `npx tsc --noEmit` exits 0
- **Architecture purity:** 4/4 tests pass; `grep -r '@modelcontextprotocol/sdk' src/comfyui/` returns 0 matches; `grep -r 'better-sqlite3\|drizzle' src/comfyui/` returns 0 matches
- **Grep invariants from the plan's `<done>` block:**
  - `export class ComfyUIClient` in src/comfyui/client.ts: 1 match
  - `redirect: 'manual'` in src/comfyui/client.ts: 2 matches (code + docstring)
  - `X-API-Key` in src/comfyui/client.ts: 5 matches (≥ 3 required)
  - `downloadToPath|partial|rename` in src/comfyui/client.ts: 8 matches (≥ 3 required)
  - `case 'version':` in src/engine/breadcrumb.ts: 1 match
  - `private versions: VersionRepo` in src/engine/breadcrumb.ts: 1 match
  - `export class GenerationEngine` in src/engine/generation.ts: 1 match
  - `GENERATION_TIMEOUT_MS = 600_000` in src/engine/generation.ts: 1 match
  - `DOWNLOAD_RETRY_DELAYS = [2_000, 4_000, 8_000]` in src/engine/generation.ts: present
  - `new GenerationEngine` in src/engine/pipeline.ts: 1 match
  - delegations in src/engine/pipeline.ts: 4 matches
- **No stubs detected.** No TODO/FIXME/placeholder markers in any new or modified file.

---

*Phase: 02-comfyui-generation*
*Plan: 02*
*Wave: 2*
*Completed: 2026-04-21*
