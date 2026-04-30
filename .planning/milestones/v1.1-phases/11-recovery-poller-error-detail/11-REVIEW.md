---
phase: 11-recovery-poller-error-detail
reviewed: 2026-04-30T02:30:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/comfyui/format.ts
  - src/comfyui/client.ts
  - src/engine/generation.ts
  - src/comfyui/__tests__/format.test.ts
  - src/comfyui/__tests__/error-extraction-parity.test.ts
  - src/test-utils/fake-comfyui-client.ts
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: clean
---

# Phase 11: Code Review Report

**Reviewed:** 2026-04-30T02:30:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** clean (3 informational observations, no blockers)

## Summary

Reviewed all six files modified in Phase 11. The refactor is well-executed: a single
helper `flattenComfyError` consolidates the previously-duplicated three-branch flatten
chain across submit and status / recovery-poller paths, and a 14-case same-fixture
parity test proves byte-equality across helper-direct, submit-path, and status-path
arms.

**Project-rule compliance — all green:**

- **Architecture purity:** Zero MCP imports in `src/comfyui/format.ts`,
  `src/comfyui/client.ts`, the new parity test file, and `src/test-utils/fake-comfyui-client.ts`
  (verified by grep).
- **Append-only provenance:** Both call sites only call `provenanceWriter.writeFailedEvent`
  for new rows; zero `UPDATE` statements added in `src/engine/provenance.ts` or
  `src/store/provenance-repo.ts` (verified by grep).
- **Tool budget:** No new MCP tools registered (Phase 11 modifies only engine /
  comfyui / test files; tool count stays at 6 of 12).
- **Error responses human-readable:** `flattenComfyError` always returns a non-empty
  human-readable string; never throws, never returns null/undefined.
- **API key scrubbing:** Existing `scrubAndTruncate` (submit boundary) and
  `scrubErrorValue` (status boundary) wrap the helper output. No new disclosure
  surface introduced.

**Test quality — strong:**

- Real assertions (`toBe` byte-equal, not just `toContain`).
- Helper-direct arm exercises the actual `flattenComfyError` export, not a
  re-implementation.
- Submit-path arm uses the real `ComfyUIClient` against a mocked `fetchImpl` —
  not a stub of submit itself.
- Status-path arm drives the real `GenerationEngine.getGenerationStatus()` failed
  branch via the additive `cannedFailedError` escape hatch — exercises the
  actual write path through `provenanceWriter.writeFailedEvent` + `versions.markFailed`.
- The cross-arm sweep proves byte-equality between helper-direct and status-path
  in a single test — catches any future drift between the two call sites.
- IT-10 cancelled-status regression cross-check belt-and-suspenders the
  fallback-literal contract (`'ComfyUI reported failed'`).

The three findings below are informational only — none affect correctness, security,
or invariants. No Critical or Warning issues found.

## Info

### IN-01: Submit-path does not widen to extract `parsed.error` string field

**File:** `src/comfyui/client.ts:436-437`
**Issue:** The `flattenComfyError(parsed)` call covers `parsed.node_errors` (branch 1)
and `parsed` itself being a bare string (branch 2). But when Cloud sends the common
shape `{ error: 'some-string', ...no node_errors }` (object wrapping a string error
field, no `node_errors`), `flattenComfyError({ error: '...' })` walks branch 1 →
no `.node_errors` → branch 2 → not a string (it's an object) → branch 3 → returns
the literal `'ComfyUI reported failed'`. The submit-path then flips to the
`'ComfyUI request failed: ${status} ${statusText}'` fallback, dropping the
informative string in `parsed.error`.

The status path, by contrast, extracts `raw.error` upstream (`client.ts:519-524`)
before the engine ever sees it, so a string `error` field reaches the helper as
a bare string and branch 2 surfaces it.

This is an asymmetry between the two paths that the parity test does NOT cover —
the parity-test fixture C uses a bare-string body (the entire response IS the
string), not the object-wrapping-string shape. So byte-parity holds for the
shapes the test exercises, but doesn't hold for `{ error: 'foo' }` shapes.

**Status:** Pre-existing parity gap. The plan explicitly acknowledges this
(`11-01-PLAN.md:392`: "preserves today's submit-time message shape for
non-node_errors 4xx bodies"). Existing behaviour is preserved — no regression.
Worth noting for future drift watch.

**Fix:** No code change needed for v1.1. If a future plan wants tighter parity,
extract `parsed.error` first at the submit site (mirroring `client.ts:519-524`
status-path logic) before passing to `flattenComfyError`:

```typescript
const errorField =
  (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed))
    ? (parsed as { error?: unknown }).error
    : parsed;
const flat = flattenComfyError(parsed); // try node_errors first
const fromError = (flat === 'ComfyUI reported failed' && errorField !== undefined)
  ? flattenComfyError(errorField)
  : flat;
const nodeMessage = fromError === 'ComfyUI reported failed' ? null : fromError;
```

Defer until a real bug report shows submit-path swallowing useful detail. v1.0
behaviour is preserved.

### IN-02: `vi.useRealTimers()` in afterEach is a no-op (parity test never fakes timers)

**File:** `src/comfyui/__tests__/error-extraction-parity.test.ts:191`
**Issue:** `afterEach` calls `vi.useRealTimers()` to defensively restore real
timers, but the parity test never calls `vi.useFakeTimers()` anywhere. The call
is a no-op left over from a copied template.

**Fix:** Remove the line for clarity:

```typescript
afterEach(async () => {
  await ctx.engine.stop();
  await fsp.rm(ctx.tempRoot, { recursive: true, force: true });
});
```

Drop the `vi` import too if no other usage remains. Not a bug — purely cosmetic.

### IN-03: `'ComfyUI reported failed'` collision string is a single point of contract

**File:** `src/comfyui/format.ts:156`, `src/comfyui/client.ts:437`
**Issue:** The literal `'ComfyUI reported failed'` is used as both:
1. The branch-3 fallback return value of `flattenComfyError` (helper output).
2. A SIGNAL at `client.ts:437` (`flat === 'ComfyUI reported failed' ? null : flat`)
   meaning "no actionable detail; flip to status/statusText fallback".

If Cloud ever literally sends the string `'ComfyUI reported failed'` as
`parsed` (extremely unlikely — it's the engine's own fallback wording), the
submit path would mistakenly treat it as "no detail" and discard it. The status
path would surface it (since the helper just returns the string verbatim).
This is a benign edge case but couples the helper's return literal to a
string-equality check at one call site.

**Fix:** Optional hardening — return a sentinel from `flattenComfyError` (e.g.,
a tuple `{ message: string, isFallback: boolean }` or a separate
`flattenComfyErrorOrNull` variant), and have `client.ts` check the boolean
flag instead of the string literal. Not needed today; the IT-10 contract is
robust to this edge case because the fake never sends that string verbatim.

Recommend documenting the coupling at `format.ts:156` so a future refactor
that changes the literal also updates the call site:

```typescript
// Branch 3: fallback. IT-10 contract — this exact literal must remain.
// COUPLED: src/comfyui/client.ts:437 string-equality-checks this literal
// to detect "no actionable detail" and switch to its status/statusText
// fallback. Update both sites if changing the literal.
return 'ComfyUI reported failed';
```

---

_Reviewed: 2026-04-30T02:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
