---
phase: 06-dashboard-wire-quality
reviewed: 2026-04-24T16:02:35Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/http/dashboard-routes.ts
  - src/http/sse.ts
  - src/store/version-repo.ts
  - src/engine/pipeline.ts
  - src/test-utils/fake-engine.ts
  - packages/dashboard/src/lib/api.ts
  - packages/dashboard/src/lib/shape.ts
  - src/http/__tests__/dashboard-routes.test.ts
  - src/http/__tests__/sse.test.ts
  - src/store/__tests__/version-repo.test.ts
  - src/engine/__tests__/pipeline.test.ts
  - packages/dashboard/src/__tests__/api-error.test.ts
  - packages/dashboard/src/__tests__/shape.test.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-04-24T16:02:35Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Phase 06 closes 6 v1.0 audit tech debt items: WR-01 (CWD-independent output streaming), WR-04 (real DB query for recent-completed), WR-05 (typed `DashboardApiError`), IN-01 (pagination validation), IN-02 (SSE keep-alive comment frame), and IN-04 (exhaustive `normalizeStatus` switch). All 6 items are correctly implemented and test-covered.

One warning was found: the `qNum` pagination helper in `dashboard-routes.ts` uses `Number()` which is too permissive — hex literals (`0x10`), scientific notation (`1e2`), and empty strings (`?limit=`) all pass the integer check with unintuitive results. This does not open a security hole but creates behavioral edge cases that contradict the validator's documented intent ("non-negative integer"). Two informational items cover a CWD-dependent test pattern and the related empty-string silent-zero behavior.

## Warnings

### WR-01: `qNum` accepts hex, scientific notation, and empty string via `Number()`

**File:** `src/http/dashboard-routes.ts:95`
**Issue:** The `qNum` helper converts the raw query string with `Number(raw)` and then checks `!Number.isInteger(n) || n < 0`. This passes three unintuitive input classes:

- `?limit=0x10` — `Number('0x10')` = 16, passes integer check, silently paginates at 16
- `?limit=1e2` — `Number('1e2')` = 100, passes integer check, silently paginates at 100
- `?limit=` — `Number('')` = 0, passes integer check, returns 0 instead of the `fallback` (20/0)

The empty-string case is the most actionable: a client sending `?limit=` gets 0 results instead of the 20-item default, with no error to indicate anything is wrong. The docstring says "Absent params still return the fallback" but an empty-value param is not absent — `c.req.query('limit')` returns `''`, not `undefined`.

**Fix:** Replace `Number(raw)` with a strict decimal-integer parse using either a regex guard or `parseInt` with an explicit radix 10 + fractional check:

```typescript
const qNum = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined || raw === '') return fallback;  // treat empty string as absent
  const n = Number(raw);
  // Reject hex (0x), scientific notation (1e2), and fractions/negatives
  if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < 0) {
    throw new TypedError(
      'INVALID_INPUT',
      `Query parameter '${name}' must be a non-negative integer (got '${raw}')`,
      'Use a positive integer like ?limit=20',
    );
  }
  return n;
};
```

The `^\d+$` regex accepts only ASCII digit sequences, rejecting `0x10`, `1e2`, `-1`, `1.5`, and `''`. The existing `!Number.isInteger(n) || n < 0` check is kept as defence-in-depth after the regex.

## Info

### IN-01: Empty-string query param silently returns 0, not the fallback default

**File:** `src/http/dashboard-routes.ts:93-104`
**Issue:** When a client sends `GET /api/workspaces?limit=` (empty value), `c.req.query('limit')` returns `''` (not `undefined`), so `qNum` does not take the `raw === undefined` early-return path. `Number('')` evaluates to 0, which passes the integer-and-non-negative check, yielding a result with 0 items. This is confusing: the caller gets a 200 with an empty list rather than the 20-item default they likely intended. Already covered by the WR-01 fix above (`|| raw === ''` in the undefined guard).

**Fix:** Add `|| raw === ''` to the undefined guard — see WR-01 fix snippet above.

### IN-02: Architecture purity test reads source file via `process.cwd()` — fragile under non-vitest runners

**File:** `src/engine/__tests__/pipeline.test.ts:253`
**Issue:** The architecture purity assertion reads `pipeline.ts` source text with:
```typescript
const src = await fsp.readFile(pth.join(process.cwd(), 'src/engine/pipeline.ts'), 'utf8');
```
This works correctly when run under vitest (CWD = project root per `vitest.config.ts`), but would silently fail or throw if the test suite is ever run from a different working directory (e.g., a monorepo runner that sets CWD to a sub-package, or a CI step that runs `node --test` from a child directory). The test is a valuable guard but its path construction should not rely on a hidden CWD assumption.

**Fix:** Use `import.meta.url` to derive an absolute path anchored to the test file's location:
```typescript
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const pipelineSrc = path.resolve(__filename, '../../pipeline.ts');
const src = await fsp.readFile(pipelineSrc, 'utf8');
```
This is a pre-existing pattern elsewhere in the test suite and survives any CWD change.

---

_Reviewed: 2026-04-24T16:02:35Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
