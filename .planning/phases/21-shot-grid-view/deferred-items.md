# Phase 21 — Deferred Items

> Out-of-scope discoveries logged per SCOPE BOUNDARY rule (executor.md). These
> failures pre-date Plan 21-02 (verified on `main` HEAD) and are unrelated to
> any file touched by Wave 2.

## Pre-existing test failures observed during Wave 2 regression sweep

Last verified: 2026-05-13 (during 21-02-T07 final verification on
`worktree-agent-a7cf86d6f7a718279`, base `8ac9366`).

| Test file | Categories of failure | Root cause (high-level) |
|-----------|------------------------|--------------------------|
| `src/__tests__/c2pa-redaction-uat-mcp-tool.test.ts` | HTTP/STDIO wire-level UAT | Pre-existing — c2pa signer state |
| `src/__tests__/c2pa-uat-mcp-tool.test.ts` | HTTP/STDIO wire-level UAT | Pre-existing — c2pa signer state |
| `src/__tests__/phase-attribution.test.ts` | ROADMAP.md parser tests | Doc structure mismatch — v1.3 ROADMAP.md restructure |
| `src/__tests__/requirements-cohort-closure.test.ts` | REQUIREMENTS.md parser tests | Doc structure mismatch — v1.3 REQUIREMENTS.md restructure |
| `src/__tests__/validation-flags.test.ts` | ROADMAP.md parser tests | Doc structure mismatch — v1.3 ROADMAP.md restructure |
| `src/__tests__/version-tool-dual-transport-export-verify.test.ts` | HTTP/STDIO wire-level UAT | Pre-existing |
| `src/__tests__/version-tool-dual-transport-redact.test.ts` | HTTP/STDIO wire-level UAT | Pre-existing |
| `src/tools/__tests__/generation-tool.test.ts:106` | ENOTEMPTY in tmp dir teardown | Pre-existing flaky filesystem race |

**Why deferred:** None of these tests touch any file modified by Plan 21-02
(`src/engine/pipeline.ts`, `src/http/dashboard-routes.ts`,
`packages/dashboard/src/lib/api.ts`,
`packages/dashboard/src/components/ShotStatusPill.tsx`,
`packages/dashboard/src/state/shot-grid.ts`, plus the corresponding test
files). Confirmed by running `validation-flags.test.ts` on `main` HEAD: same
2 failures appear there. Verified by inspection that the ROADMAP/REQUIREMENTS
parser tests target a doc layout that pre-dates the v1.3 milestone restructure.

**Disposition:** Out of scope for Wave 2 of Phase 21. Should be re-evaluated
during Phase 21 Wave 5 phase-gate or, more likely, in a dedicated
`/gsd-verify-work` pass after the v1.3 milestone restructure stabilizes.
