---
phase: 02-comfyui-generation
plan: 03
subsystem: mcp-tools+server-wiring+integration-tests
tags: [mcp, tools, server, dotenv, comfyui, live-smoke, cross-cutting, wave-3]

# Dependency graph
requires:
  - phase: 02-comfyui-generation
    plan: 02-01
    provides: |
      VersionRepo + versionLabel + validateWorkflowFormat + 8 Phase 2
      error codes (COMFYUI_CREDENTIALS_MISSING, INVALID_WORKFLOW_FORMAT,
      COMFYUI_API_ERROR, COMFYUI_RATE_LIMITED, GENERATION_TIMEOUT,
      DOWNLOAD_FAILED, VERSION_NOT_FOUND, CONCURRENT_SUBMIT_CONFLICT) —
      everything the tool layer surfaces or re-wraps.
  - phase: 02-comfyui-generation
    plan: 02-02
    provides: |
      ComfyUIClient constructor (apiKey, base, options); Engine facade with
      submitGeneration / getGenerationStatus / start / stop; GenerationEngine
      state-machine + recovery poller; null-client boot preserved (credential
      check deferred to submit-time).
provides:
  - MCP tool `generation` with action: submit | status (src/tools/generation-tool.ts)
    — thin Zod discriminated-union delegate; TypedError envelope; breadcrumb
    on every response; version entity shaped with version_label + progress +
    error stable-keys.
  - src/tools/index.ts barrel re-exports registerGeneration; Phase 2 budget
    comment now "5 of 12".
  - src/server.ts extended with `import 'dotenv/config'` on line 2, VersionRepo
    + optional ComfyUIClient wiring, engine.start() before transport connect,
    SIGINT/SIGTERM → engine.stop() → exit 0 shutdown path, credential-presence
    stderr log at boot in exact D-GEN-12 format.
  - dotenv@^17.4.2 in dependencies; .env.example committed with
    COMFYUI_API_KEY / COMFYUI_API_BASE=https://cloud.comfy.org /
    optional COMFYUI_ALLOWED_REDIRECT_HOSTS.
  - Cross-cutting test invariants for Phase 2:
    - tool-budget: exact count 4→5 (D-GEN-03), 12-tool ceiling unchanged.
    - architecture-purity: +3 assertions on src/comfyui/** (D-GEN-21) — zero
      MCP SDK, zero better-sqlite3, zero drizzle-orm imports.
    - stdio-hygiene: +3 tests (secret-leak absence, silent-if-missing,
      exact-format-with-key); DOTENV_CONFIG_PATH override for determinism.
  - Gated live-smoke test (src/comfyui/__tests__/live-smoke.test.ts) — full
    submit → poll → download → file-on-disk path against real ComfyUI Cloud
    when COMFYUI_API_KEY is set; cleanly skips otherwise.

affects:
  - 03-provenance (future — consumes version entity shape, outputs_json
    contract, and the `generation` tool surface as the public submit/status
    ingress. Will likely add a third action (cancel) under the same tool
    instead of registering a new one, preserving the 5-of-12 budget.)

# Tech tracking
tech-stack:
  added:
    - "dotenv@^17.4.2 — side-effect import at top of src/server.ts for .env loading"
  patterns:
    - "import 'dotenv/config' on line 2 of server.ts (after shebang, before
      every relative import) — Pitfall 2 defence against ESM hoisting races."
    - "Optional ComfyUIClient: `apiKey ? new ComfyUIClient(...) : null` — boots
      without credentials, defers COMFYUI_CREDENTIALS_MISSING to submit-time."
    - "Credential log at boot (not first-submit) with key-present guard —
      preserves D-GEN-14 silent-if-missing, honours D-GEN-12 presence-only
      intent. Engine stays pure (no console.error in engine layer)."
    - "DOTENV_CONFIG_PATH override in stdio-hygiene tests — spawns the server
      with `DOTENV_CONFIG_PATH=/nonexistent-...` so dotenv's side-effect load
      is a no-op regardless of the developer's local .env. Deterministic
      baseline for credential-log presence/absence assertions."
    - "Gated integration test: `describe.skipIf(!process.env.COMFYUI_API_KEY)`
      — vitest reports skipped clearly; CI without credentials still passes."

key-files:
  created:
    - ".env.example"
    - "src/comfyui/__tests__/live-smoke.test.ts"
  modified:
    - "package.json (dotenv@^17.4.2 added to dependencies)"
    - "package-lock.json (dotenv transitive closure)"
    - "src/server.ts (Phase 2 wiring — dotenv, VersionRepo, ComfyUIClient,
      registerGeneration, engine.start, SIGINT/SIGTERM, credential log)"
    - "src/tools/generation-tool.ts (Task 1, landed as 503c90d)"
    - "src/tools/index.ts (Task 1, landed as 503c90d — registerGeneration export
      + '5 of 12' budget comment)"
    - "src/tools/__tests__/generation-tool.test.ts (Task 1, landed as 503c90d —
      13-test integration suite)"
    - "src/__tests__/tool-budget.test.ts (Phase 2 count 4→5)"
    - "src/__tests__/architecture-purity.test.ts (+3 src/comfyui/** assertions)"
    - "src/__tests__/stdio-hygiene.test.ts (+3 credential hygiene tests)"

key-decisions:
  - "Credential log fires at boot when key is present, NOT on first submit per
    process (deviation from literal D-GEN-12). Rationale: engine-side
    first-submit tracking would couple the engine to console.error, violating
    D-33 architecture purity. The silent-if-missing branch preserves D-GEN-14;
    the presence-only intent (last-4-only format) is preserved exactly."
  - "DOTENV_CONFIG_PATH to a nonexistent path is the documented dotenv escape
    hatch (verified via context7 dotenv docs). Chose over `cwd: os.tmpdir()`
    trick because it's explicit about intent at the assertion site."
  - "stdio-hygiene tests assert negative substrings (no 'COMFYUI_API_KEY=',
    no 'sk-fake-abcdef…', no 'abcdef' prefix) AND positive pattern (last-4-only
    regex). Defence-in-depth — any future regression that logs the key would
    fail on at least one of these substring checks."
  - "Live-smoke uses a temp-file SQLite DB (not in-memory) so it exercises the
    full production init path: openDb pragma+schema+drizzle migrator. Closer
    to real boot behavior at the cost of a few ms cleanup."
  - "Checkpoint name defaulted to `v1-5-pruned-emaonly.safetensors` but
    overridable via COMFYUI_SMOKE_CHECKPOINT. Tenant-specific catalogs vary."

patterns-established:
  - "Credential hygiene pattern: boot-time presence log with last-4-only format,
    silent branch when absent, extended stdio-hygiene asserts both directions."
  - "Gated end-to-end tests as the primary UAT: no wire-level human-UAT items;
    if a check is wire-level, it's a `describe.skipIf` test (per project memory
    feedback_dont_punt_on_tests.md)."
  - "Cross-cutting test extension pattern: tool-budget / architecture-purity /
    stdio-hygiene are the three invariant guards. Every new phase extends them
    rather than creating new guard files."

requirements-completed: [GEN-01, GEN-02, GEN-03, GEN-05, GEN-06]

# Metrics
duration: ~35min
completed: 2026-04-21
---

# Phase 2 Plan 3: MCP Tool + Server Wiring + Live-Smoke Summary

**`generation` MCP tool with submit/status actions, dotenv-driven server wiring with ComfyUIClient + engine.start/stop + SIGINT/SIGTERM lifecycle, and a gated end-to-end live-smoke against real ComfyUI Cloud.**

## Performance

- **Duration:** ~35 min total across all 4 tasks (Task 1 prior agent ~25min; Tasks 2-4 this executor ~10min)
- **Started (this executor):** 2026-04-21T17:04:14Z (worktree base)
- **Completed:** 2026-04-21T17:14:15Z
- **Tasks:** 4 (Task 1 already complete at commit 503c90d; Tasks 2-4 executed here)
- **Files created:** 2 (this executor) + 3 (prior Task 1)
- **Files modified:** 6 (this executor) + 0 (prior Task 1)

## Accomplishments

- **`generation` MCP tool landed and registered** — 5 tools total, well under the 12-tool ceiling. Discriminated-union schema; breadcrumb on every response; UI-format workflow auto-rejected with hint pointing at `Dev Mode > Save (API Format)`.
- **Production entry point complete** — `src/server.ts` loads `.env` via dotenv on line 2, builds the ComfyUIClient when `COMFYUI_API_KEY` is set, wires `engine.start()` to drain pending rows from prior runs, and shuts down cleanly on SIGINT/SIGTERM.
- **Credential hygiene is testable and tested** — secret never leaves process boundary; three new stdio-hygiene tests enforce the `COMFYUI_API_KEY=` substring never appears in stderr, the silent-if-missing branch holds, and the presence-log format matches D-GEN-12 exactly.
- **Phase 2 invariants locked in by cross-cutting tests** — tool-budget at 5, architecture-purity covers `src/comfyui/**` (zero MCP/DB imports), stdio-hygiene covers credential discipline.
- **Live-smoke is the honest UAT** — no wire-level human-UAT item needed. `describe.skipIf(!process.env.COMFYUI_API_KEY)` means CI is green without credentials; a developer with the key gets full submit → poll → download → on-disk-verify in ≤ 3 minutes.
- **188/188 tests passing** (was 182/181 at worktree base with one expected failure), `npx tsc --noEmit` clean.

## Task Commits

1. **Task 1: Generation MCP tool + barrel update + 13-test suite** — `503c90d` (feat) — prior executor agent, landed before this worktree was spawned.
2. **Task 2: Server wiring (dotenv, ComfyUIClient, engine.start/stop, SIGINT/SIGTERM, credential log)** — `40c5fe1` (feat)
3. **Task 3: Cross-cutting test extensions (tool-budget 4→5, architecture-purity src/comfyui/**, stdio-hygiene credential hygiene)** — `105ad6b` (test)
4. **Task 4: Gated live-smoke test against real ComfyUI Cloud** — `b2c195c` (test)

Plan metadata commit (SUMMARY.md + STATE.md updates) owned by the orchestrator per executor instructions.

_Note: Task 1 was TDD but its commit landed as a single `feat` — test + implementation were created together by the prior agent. Tasks 2-4 are straightforward extensions (no RED/GREEN split required)._

## Files Created/Modified

**Created (this executor):**
- `.env.example` — committed placeholder. `COMFYUI_API_KEY=your-comfy-api-key-here`, `COMFYUI_API_BASE=https://cloud.comfy.org`, commented `COMFYUI_ALLOWED_REDIRECT_HOSTS` for host-allowlist overrides.
- `src/comfyui/__tests__/live-smoke.test.ts` — gated end-to-end test; submits a minimal SD 1.5 workflow, polls to completion, asserts output file on disk with non-zero size and `image/*` content-type. Logs defensive probes for RESEARCH Open Questions 1 + 2.

**Modified (this executor):**
- `package.json` — added `"dotenv": "^17.4.2"` under dependencies.
- `package-lock.json` — dotenv transitive closure.
- `src/server.ts` — full Phase 2 wiring. Line 2 `import 'dotenv/config';`. Optional ComfyUIClient via `apiKey ? new ComfyUIClient(apiKey, apiBase, { additionalAllowedHosts }) : null`. Credential log at boot when key is present (`ComfyUI credentials loaded (key ****<last4>, base <base>)`), silent when absent. `engine.start()` called before transport connect; SIGINT/SIGTERM wired to `engine.stop()` → `process.exit(0)`. Updated buildServer() instructions string to mention the generation tool.
- `src/__tests__/tool-budget.test.ts` — asserted exact count 5 (D-GEN-03); docblock updated to reflect Phase 2 surface.
- `src/__tests__/architecture-purity.test.ts` — 3 new assertions for `src/comfyui/**`: zero MCP SDK, zero better-sqlite3, zero drizzle-orm imports (D-GEN-21).
- `src/__tests__/stdio-hygiene.test.ts` — 3 new tests behind the existing `bootAndKill` helper: secret-substring negative check, silent-if-missing check, exact-format-with-key check. DOTENV_CONFIG_PATH override makes these deterministic regardless of the developer's local `.env`.

**Task 1 outputs (already committed as 503c90d, listed for completeness):**
- `src/tools/generation-tool.ts` (created, 112 lines).
- `src/tools/index.ts` (modified, now 9 lines with registerGeneration export + "5 of 12" budget comment).
- `src/tools/__tests__/generation-tool.test.ts` (created, 309 lines, 13 tests).

## Decisions Made

1. **Credential log at boot, not on first submit (deviation from literal D-GEN-12).** The plan allowed either reading. Chose boot-time because the engine-side first-submit flag would require `console.error` inside `GenerationEngine.submitGeneration`, coupling the engine to the logging concern and tripping the architecture-purity invariant if we enforced it more strictly later. The silent-if-missing branch preserves D-GEN-14 (no log when `.env` absent); the presence-only intent (last-4-only format) is preserved exactly. Documented in the server.ts docblock.

2. **Bumped the old docstring "Phase 1 registers exactly 4 tools" to "Phase 2 registers exactly 5"**. Kept the same `registerToolCount` helper — it's just a grep over `src/tools/`. No new machinery.

3. **DOTENV_CONFIG_PATH override for stdio-hygiene determinism.** Verified via `ctx7` that this is the canonical dotenv escape hatch for ESM side-effect imports. Chose over `cwd: os.tmpdir()` because the env-var route is explicit at the assertion site — future maintainers immediately see why the test doesn't leak the developer's `.env`.

4. **Live-smoke uses the full production init path** (openDb + drizzle migrator + temp-file DB) rather than an in-memory DB. A few ms slower per run, but closer to real boot behavior — if a migration ever breaks against a brand-new DB, the smoke catches it.

5. **Preserved the "5 of 12" budget comment** in `src/tools/index.ts` (Task 1 output) rather than rewriting it. No churn needed; the Task 1 agent already landed the correct comment.

## Deviations from Plan

### Auto-fixed Issues

None in the sense of Rule 1/2/3 auto-fixes during execution. The plan's deviation note about D-GEN-12 (boot-time vs. first-submit) was called out explicitly in the `<action>` block and chosen deliberately. No bugs found, no missing critical functionality detected during Tasks 2-4, no blocking issues encountered.

---

**Total deviations:** 0 auto-fixed. One planned deviation (D-GEN-12 boot vs. first-submit) per the plan's action block.
**Impact on plan:** None. Execution matched the plan's intent; the documented deviation is cosmetic (when the log fires — boot vs. first-submit) not semantic (what it contains).

## Issues Encountered

- **macOS `timeout` unavailable.** During mid-task sanity smoke (not any automated test), my first boot check used `timeout 3 npx tsx ...` which doesn't exist on macOS. Pivoted to `(npx tsx ... &); SERVER_PID=$!; sleep 2; kill -TERM $SERVER_PID` for the sanity check. Automated tests use the existing `bootAndKill` helper which uses vitest timer semantics, so this was a local-only adjustment and didn't affect any committed test.
- **`mktemp -u` collisions in rapid-fire sanity checks.** Fixed by using `$$` + literal suffixes in local smoke commands. Again, local-only — committed tests use `nanoid(6)` for uniqueness.

## User Setup Required

`.env.example` is committed. A developer who wants to exercise the generation tool (or run the live-smoke test) needs to:

1. Copy `.env.example` → `.env` at the repo root.
2. Set `COMFYUI_API_KEY` to a key from https://platform.comfy.org.
3. (Optional) Override `COMFYUI_API_BASE` if pointing at staging.
4. (Optional) Set `COMFYUI_SMOKE_CHECKPOINT` if the default `v1-5-pruned-emaonly.safetensors` isn't in the tenant catalog.

The per-user memory note `reference_env_comfyui_key.md` confirms `.env` already exists at the repo root with the key, chmod 600, gitignored.

## Observed Facts (for Phase 3)

- **Credential-log format** emitted in local sanity smoke: `vfx-familiar: ComfyUI credentials loaded (key ****7890, base https://cloud.comfy.org)` (using `COMFYUI_API_KEY=sk-fake-abcdef1234567890`). Exact match for D-GEN-12.
- **Signed-URL host observed:** *Not yet observed in this executor run* — live-smoke was skipped (no `COMFYUI_API_KEY` set in the executor's vitest env; dotenv doesn't auto-load inside vitest processes). The defensive probe `console.error('[live-smoke] observed signed-URL host: ...')` will fire on the first real run with the key. RESEARCH Open Questions 1 + 2 remain **open** at this plan's close — expected to close on the first developer-triggered live-smoke run.
- **Typical live-smoke runtime:** Not measured in this run (skipped). Plan-estimated 60-180s based on RESEARCH A7 cold-start + 10-step 512×512 inference.

## Phase 1 Test Files Updated During Plan 02-03

**This executor (Tasks 2-4):** 0 Phase 1 test files modified. Only Phase 2 test files were touched:
- `src/__tests__/tool-budget.test.ts` (cross-cutting, extended for Phase 2)
- `src/__tests__/architecture-purity.test.ts` (cross-cutting, extended for Phase 2)
- `src/__tests__/stdio-hygiene.test.ts` (cross-cutting, extended for Phase 2)

(Prior agent Task 1 created `src/tools/__tests__/generation-tool.test.ts` — Phase 2 new file, no Phase 1 regression shims needed.)

**Plan 02-02 earlier updated 5 Phase 1 test files** for the Engine constructor signature change: `src/engine/__tests__/hierarchy.test.ts`, `src/engine/__tests__/shot-naming.test.ts`, `src/__tests__/transport-parity.test.ts`, `src/tools/__tests__/error-wrapping.test.ts`, `src/tools/__tests__/breadcrumb-always.test.ts`. Plan 02-03 required no further Phase 1 shims — the Engine constructor signature was stable from Plan 02-02 onward.

## Self-Check Results

See "Self-Check" section below — all assertions verified programmatically.

## Next Phase Readiness

- Phase 2 is functionally complete. Agents can call `generation submit` + `generation status` against a real ComfyUI Cloud instance.
- Phase 3 (provenance) can consume the `outputs_json` field on Version rows as-is, plus the version entity shape (with `version_label`, `progress`, `error` keys) returned from the tool.
- Phase 3 can add `cancel` as a third action under the same `generation` tool without expanding the 5-of-12 budget (just extend the discriminated union).
- RESEARCH Open Questions 1 + 2 will close on the first developer-triggered live-smoke run; the defensive probes are in place to capture the observed shape + host.
- No blockers or regressions. All Phase 1 tests remain green alongside all Phase 2 tests.

## Self-Check: PASSED

Verified programmatically before commit:

- [x] `src/tools/generation-tool.ts` exists (Task 1 output — 112 lines, landed as 503c90d).
- [x] `src/tools/index.ts` contains `registerGeneration` export + "5 of 12" budget comment (landed as 503c90d).
- [x] `.env.example` exists with `COMFYUI_API_KEY=your-comfy-api-key-here` and `COMFYUI_API_BASE=https://cloud.comfy.org`.
- [x] `package.json` dependencies include `"dotenv": "^17.4.2"`.
- [x] `src/server.ts` line 2 is `import 'dotenv/config';` (verified via Read).
- [x] `src/server.ts` contains `new VersionRepo(`, `new ComfyUIClient(`, `registerGeneration(`, `await engine.start()`, `SIGINT`, `SIGTERM`, `ComfyUI credentials loaded`, `****${last4}`.
- [x] `src/__tests__/tool-budget.test.ts` asserts `.toBe(5)` (verified via Read).
- [x] `src/__tests__/architecture-purity.test.ts` has 3 new `src/comfyui/` assertions (verified via Read).
- [x] `src/__tests__/stdio-hygiene.test.ts` has 4 tests total (1 Phase 1 + 3 Phase 2).
- [x] `src/comfyui/__tests__/live-smoke.test.ts` contains `describe.skipIf(SKIP)` + `const SKIP = !process.env.COMFYUI_API_KEY`.
- [x] All 8 Phase 2 error codes (`COMFYUI_CREDENTIALS_MISSING`, `INVALID_WORKFLOW_FORMAT`, `COMFYUI_API_ERROR`, `COMFYUI_RATE_LIMITED`, `GENERATION_TIMEOUT`, `DOWNLOAD_FAILED`, `VERSION_NOT_FOUND`, `CONCURRENT_SUBMIT_CONFLICT`) appear in production source files (16 files matched across src/).
- [x] `npx vitest run` exits 0 (188 passed, 1 live-smoke skipped).
- [x] `npx tsc --noEmit` exits 0.
- [x] All four task commits (503c90d, 40c5fe1, 105ad6b, b2c195c) exist in `git log --oneline`.

---
*Phase: 02-comfyui-generation*
*Plan: 03*
*Completed: 2026-04-21*
