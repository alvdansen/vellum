---
phase: 12-reproduce-divergence-transparency
reviewed: 2026-04-30T09:30:48Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - src/types/provenance.ts
  - src/types/hierarchy.ts
  - src/engine/output-hash.ts
  - src/engine/pipeline.ts
  - src/engine/diff.ts
  - src/engine/generation.ts
  - src/store/schema.ts
  - src/store/version-repo.ts
  - drizzle/0005_phase12_reproduction_warnings.sql
  - packages/dashboard/src/components/WarningPill.tsx
  - packages/dashboard/src/views/VersionDrawer.tsx
  - packages/dashboard/src/types/entities.ts
  - packages/dashboard/src/__tests__/WarningPill.test.tsx
  - packages/dashboard/src/__tests__/VersionDrawer.test.tsx
  - src/test-utils/fake-engine.ts
  - src/http/__tests__/dashboard-routes.test.ts
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: findings_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-04-30T09:30:48Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** findings_found

## Summary

Phase 12 introduces a "honesty contract" surface for reproduce-lineage divergence — a streaming SHA-256 helper, a `reproduction_divergence` field on `version.diff`, a sticky `versions.reproduction_warnings_json` column, and dashboard pill + side-by-side comparison UI. The implementation is well-engineered and faithful to the plan.

**Strengths**
- Architecture purity preserved: `src/engine/output-hash.ts` is MCP-free, drizzle-free, sqlite-free. Existing purity test continues to pass.
- Pure helper / facade split is clean: `buildReproductionDivergence` stays pure in `diff.ts`, all I/O lives in `pipeline.ts`.
- Append-only provenance contract preserved: writes flow only to `versions.reproduction_warnings_json`; the `provenance` table is untouched.
- Streaming SHA-256 with `createReadStream + createHash` correctly avoids OOM on 100+ MB outputs (large-file test asserts 1 MB streaming path).
- Hash hex comparison is case-consistent (both sides come from `digest('hex')` → lower-case).
- Dashboard auto-fetch effect correctly de-dupes vs the manual "View Diff" click via the shared `diff` state slot, with the alive-flag pattern guarding against late `setState` after unmount.
- Migration 0005 is purely additive (single nullable text column), idempotent via `runMigrations()` boot path, and the journal entry is well-formed.
- Preact auto-escapes all dynamic content in `WarningPill` and the comparison block; no `dangerouslySetInnerHTML`. Hardcoded ariaLabel — no user-controlled data flows into the pill text (T-12-11 mitigation holds).
- Append-only invariant: `setReproductionWarnings` updates `versions` only — no UPDATE or DELETE on `provenance`.

**Concerns** (all non-blocking; warnings are robustness gaps, info items are minor smells)

## Warnings

### WR-01: Unhandled hash-throw breaks `version.diff` for non-ENOENT I/O errors

**File:** `src/engine/pipeline.ts:520-543`
**Issue:** `Engine.computeReproductionDivergence` calls `computeOutputSha256(...)` without try/catch. By design, `computeOutputSha256` re-throws non-ENOENT errors (EACCES, EBUSY, EISDIR, EMFILE). If the on-disk file is readable by `stat()` but unreadable by `createReadStream` (e.g., the filename happens to point at a directory, or permissions changed mid-flight), the entire `Engine.diffVersions` call rejects, surfacing a 500 to HTTP callers and a tool error to MCP callers.

The whole purpose of the divergence field is best-effort transparency — a hash failure should degrade to "output missing" (parent_output_present=false), not a hard failure. The dashboard auto-fetch effect catches the rejection silently (graceful), but the MCP `version.diff` tool path and the HTTP `/api/versions/:id/diff` route surface the error. Threat T-12-02 explicitly accepts the ENOENT signal as low-disclosure; the missing belt-and-suspenders for non-ENOENT errors is an inconsistency.

**Fix:**
```typescript
// In computeReproductionDivergence, wrap each hash call:
const safeHash = async (
  vid: string,
  fname: string | null,
): Promise<string | null> => {
  if (!fname) return null;
  try {
    return await computeOutputSha256(this.outputRoot, vid, fname);
  } catch (err) {
    // Non-ENOENT I/O failure (EACCES/EISDIR/EMFILE/...). Treat as
    // "output unreadable" — same downstream UX as a missing file.
    // Preserves the honesty contract: the diff still returns; the
    // pill renders if warnings exist; the comparison block hides.
    console.error(
      `vfx-familiar: output-hash: ${vid}/${fname} unreadable:`,
      (err as Error).message,
    );
    return null;
  }
};
const parentHash = await safeHash(parentVersionId, parentFilename);
const reproductionHash = await safeHash(reproductionVersionId, reproductionFilename);
```

Add a test in `output-hash.test.ts` (or `pipeline.test.ts`) for the EISDIR case: write a directory at `<outputsDir>/<versionId>/<filename>` and assert the diff returns a sensible response instead of rejecting.

### WR-02: `computeOutputSha256` lacks defense-in-depth path-traversal guard

**File:** `src/engine/output-hash.ts:27-49`
**Issue:** The helper assumes `filename` is a sanitized basename. In normal flow this holds — `outputs_json` is populated by `GenerationEngine.downloadAndPersist`, which runs `buildOutputPath → sanitizeRelativeSegment(args.filename)` (`src/utils/outputs.ts:35-63`) which throws on `..`, `/`, `\`, NUL. So in production, `outputs_json` cannot contain a traversal pattern.

However, the analogous read path in `src/http/dashboard-routes.ts:222-236` adds explicit defense-in-depth:
```ts
if (storedFilename.includes('..') || storedFilename.includes('/') ||
    storedFilename.includes('\\')) { throw INVALID_INPUT; }
const filename = path.basename(storedFilename);
```

The engine-side hash path has no such guard. `path.join(outputsDir, versionId, '../../etc/passwd')` happily resolves to `<outputsDir>/etc/passwd` if a row's `outputs_json` were tampered (DB-level corruption / malicious migration / future direct-write feature). The risk is currently theoretical — no MCP tool writes to `outputs_json` directly — but the asymmetry with `dashboard-routes.ts` is a smell. Threat T-12-02 (Information Disclosure) treats ENOENT as low-disclosure, but the threat model does NOT explicitly disposition path traversal at this seam.

**Fix:** Mirror the basename + separator check used by the dashboard route. Two options:

Option A (callee — apply at engine/output-hash.ts, the single trust boundary):
```typescript
import * as path from 'node:path';

export async function computeOutputSha256(
  outputsDir: string,
  versionId: string,
  filename: string,
): Promise<string | null> {
  // Defense-in-depth: outputs_json is written by trusted server code
  // post-Phase-12, but a future feature or a tampered row could leak
  // a path traversal. Reject separators / .. / NUL up front.
  if (
    filename.length === 0 ||
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0')
  ) {
    return null;
  }
  const safeName = path.basename(filename);
  const fullPath = path.join(outputsDir, versionId, safeName);
  // ...rest unchanged
}
```

Option B (caller — apply in pipeline.ts firstStoredFilename): mirror the dashboard's explicit reject with a TypedError for visibility.

Option A is preferable because it matches the principle that `output-hash.ts` should "never throw for missing-file cases" — a tampered filename is semantically the same as "no comparable bytes."

## Info

### IN-01: Three redundant `versionRepo.getVersion(B)` calls in the divergence path

**File:** `src/engine/pipeline.ts:487-543`
**Issue:** When B is reproduce-lineage, `Engine.diffVersions` reads version B from the repo three times: once in `loadDiffSnapshot(B)` (line 488), again at line 495 to check `lineage_type`, again inside `firstStoredFilename(B)` (line 549). This is functionally harmless because reads are idempotent and the in-memory query is fast, but the redundancy obscures intent. A single read with a destructured local would tighten the code.

**Fix:**
```typescript
const versionB = this.versionRepo.getVersion(versionBId);
if (!versionB) throw new TypedError('VERSION_NOT_FOUND', ...);
const versionA = this.versionRepo.getVersion(versionAId);
if (!versionA) throw new TypedError('VERSION_NOT_FOUND', ...);
const snapA = this.loadDiffSnapshotFromRow(versionA);
const snapB = this.loadDiffSnapshotFromRow(versionB);
// ...
if (versionB.lineage_type === 'reproduce') {
  reproduction_divergence = await this.computeReproductionDivergence(
    versionA, versionB,
  );
}
```

Out of scope if this is the established pattern — but worth flagging.

### IN-02: Empty-array vs NULL semantics for `reproduction_warnings_json` is asymmetric

**File:** `src/store/version-repo.ts:160-166`, `src/engine/generation.ts:285-296`
**Issue:** Per D-CTX-5 and the comment at line 160, NULL means "legacy / no warnings recorded" and `'[]'` means "explicitly empty (no warnings produced)". `engine.reproduceVersion` always calls `setReproductionWarnings(id, warnings)` with the resolved array — so post-Phase-12 reproduce rows are NEVER NULL; they are at minimum `'[]'`. The NULL/`'[]'` distinction is therefore only meaningful for legacy rows. The read path in `pipeline.ts:526-532` collapses both to the same `warnings: []` divergence input, so the distinction has no observable effect today.

The comment in `setReproductionWarnings` claims this distinction has semantic value. In practice it does not — anything that downstream-distinguishes the two would need a separate Boolean column. If the distinction is intentional for forensics, document the consumer; otherwise consider tightening the comment to reflect that the read path is intentionally NULL-tolerant for backwards compatibility but writes are uniform.

**Fix:** Either delete the "explicit empty vs legacy null" claim from the comment, or surface the distinction in a future API (e.g., `reproduction_divergence.warnings_recorded: boolean`). For Phase 12 the cleanest action is to soften the comment to "NULL on legacy rows; non-null after Phase 12 reproduce — content is the JSON-encoded warnings array."

### IN-03: Dashboard test assertion for image src uses `endsWith`/regex anchoring

**File:** `packages/dashboard/src/__tests__/VersionDrawer.test.tsx:128-129`
**Issue:** The test asserts `parentImg.src` matches `/\/api\/versions\/ver_a\/output$/`. In jsdom, `HTMLImageElement.src` is reflected as an absolute URL (`http://localhost:3000/api/...`). The trailing-anchor regex correctly matches because the URL ends at `output`. However, encoding behavior of `getOutputUrl` uses `encodeURIComponent(versionId)` — which would inject `%5F` for an underscore in some characters; `ver_a` is plain ASCII so encoding is a no-op here.

This is a test-correctness Info, not a bug, but worth flagging: if a future test uses a versionId with special chars, the hardcoded URL regex will need encoding-aware updating.

**Fix:** Optional. Use `expect(parentImg.src).toContain(getOutputUrl('ver_a'))` to delegate URL composition to the same helper used by the production code, eliminating the encoding-mismatch risk.

### IN-04: `firstStoredFilename` silently swallows JSON parse errors without log

**File:** `src/engine/pipeline.ts:548-557`
**Issue:** When `outputs_json` is malformed, `firstStoredFilename` returns null with a bare `catch {}`. This mirrors the existing pattern at line 383 (download path) and `loadDiffSnapshot` line 588-590, so it is consistent with the codebase. However, the analogous `setOutputs` JSON parse in dashboard-routes.ts at line 209-211 also swallows. Across all three sites, a malformed `outputs_json` is silently treated as "no outputs" with no logging — making malformed-DB diagnosis harder.

**Fix:** Optional. Emit a single `console.warn` at parse failure (low-frequency event since `outputs_json` is server-written). Out of scope for Phase 12 but worth a future consistency pass.

---

## Project-Rule Compliance Summary

| Rule | Status |
|------|--------|
| Tool-engine separation (zero MCP imports in `src/engine/*`) | PASS — `output-hash.ts` is MCP-free; architecture-purity test green |
| Tool cap (max 12 MCP tools) | PASS — no new tools; `version.diff` envelope extended in place |
| Append-only provenance | PASS — writes go to `versions.reproduction_warnings_json` only; `provenance` untouched |
| Prompt blob is truth | PASS — `reproduceVersion` still uses `completedEvent.prompt_json` for replay |
| Async generation | N/A — Phase 12 does not change submit/check flow |
| SQLite WAL + busy_timeout | N/A — Phase 12 does not touch `db.ts` |
| Architecture-purity guard | PASS — `npx vitest run src/__tests__/architecture-purity.test.ts` 18/18 passing |
| Drizzle migration auto-applies | PASS — journal entry idx=5 well-formed; `runMigrations()` from Phase 10 picks it up |
| Dashboard separation (no server imports under `packages/dashboard/src/**`) | PASS — `ReproductionDivergence` shape duplicated dashboard-side per D-WEBUI-31 |

---

_Reviewed: 2026-04-30T09:30:48Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
