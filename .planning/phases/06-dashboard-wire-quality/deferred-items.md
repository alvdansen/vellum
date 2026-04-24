# Phase 06 — Deferred Items

Out-of-scope discoveries logged during plan execution; NOT fixed by the current plan.

## Flaky / pre-existing test-harness issues

### IT-20 ENOTEMPTY race in generation-tool.test.ts

- **Discovered during:** Plan 06-02 final `npm test` verification (2026-04-23).
- **Symptom:** `Error: ENOTEMPTY: directory not empty, rmdir '…/vfx-gen-tool-*/ver_*'` in the `afterEach` teardown of `src/tools/__tests__/generation-tool.test.ts` IT-20.
- **Repro condition:** Only fires under the full parallel `npm test` suite; the test passes cleanly in isolation (`npx vitest run src/tools/__tests__/generation-tool.test.ts`).
- **Root cause (inferred):** Race between the fire-and-forget `downloadOutput(...)` path inside `Engine.getGenerationStatus` (D-WEBUI-26 dashboard-stable download hook) and the test's `afterEach` `fsp.rm(tempRoot, { recursive: true, force: true })`. The download writes `ver_<id>/<file>` while `rm` is walking the tree.
- **Why not fixed here:** Pre-existing issue unrelated to WR-04 (Plan 06-02 only touches `version-repo.ts` + `pipeline.ts:676`). Fix belongs in a future tooling plan — either make `downloadOutput` awaitable in test mode, or wrap the test teardown with a retry loop.
- **Scope:** Does not affect Plan 06-02 correctness (`src/store/__tests__/version-repo.test.ts` + `src/engine/__tests__/pipeline.test.ts` are both 100% green, both in isolation and under parallel load).
