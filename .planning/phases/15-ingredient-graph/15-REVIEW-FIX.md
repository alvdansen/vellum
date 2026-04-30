---
phase: 15-ingredient-graph
fixed_at: 2026-04-30T10:25:00Z
review_path: .planning/phases/15-ingredient-graph/15-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: applied
---

# Phase 15: Code Review Fix Report

**Fixed at:** 2026-04-30T10:25:00Z
**Source review:** .planning/phases/15-ingredient-graph/15-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (WR-01, WR-02 — MEDIUM)
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-01: Per-version sign mutex coalesces across DIFFERENT filenames

**Files modified:**
- `src/engine/pipeline.ts`
- `src/engine/__tests__/pipeline-c2pa-ingredients.test.ts`

**Commit:** 7e8ac10

**Applied fix:** Replaced `versionId`-keyed mutex with compound key `${versionId}::${filename}`. Same (versionId, filename) pairs still coalesce — preserves the re-sign idempotency intent from Plan 14-03 / B4 (second caller awaits the first's result; alreadySigned shortcut still fires for repeated identical signs). Distinct filenames under the same versionId now execute as two independent sign operations — matching the legitimate use case (Phase 16 re-derive feature in deferred REQUIREMENTS.md v1.2).

Updated docstring to document why same-pair coalescing is intentional vs. cross-filename parallel intent. Added regression Test M4: two concurrent `signOutput(v, "a.png", ...)` and `signOutput(v, "b.png", ...)` calls produce TWO manifest_signed events (one per filename), neither returns `alreadySigned`, both return non-null `signed` buffers.

### WR-02: Parent and component MIME-type fallback to `application/octet-stream`

**Files modified:**
- `src/engine/c2pa/format-router.ts`
- `src/engine/c2pa/index.ts`
- `src/engine/c2pa/manifest-builder.ts`
- `src/engine/pipeline.ts`
- `src/engine/c2pa/__tests__/format-router.test.ts`
- `src/engine/__tests__/pipeline-c2pa-ingredients.test.ts`

**Commit:** e677051

**Applied fix:**

1. **New helper `getMimeForExtensionOrNull(filename): string | null`** in `src/engine/c2pa/format-router.ts`. Returns supported MIME for PNG/JPEG/MP4/WebP/TIFF (case-insensitive); returns `null` for unknown extensions, no-extension filenames, and EXR/PSD (c2pa-rs has no native handler — passing those MIMEs to createIngredient would still fail). Pure function, mirrors `routeFormat`'s lookup tables.

2. **Pipeline asset-ref resolution** (`src/engine/pipeline.ts:1421` parent / `:1474` component): replaced `routeFormat(...).mimeType ?? 'application/octet-stream'` with `getMimeForExtensionOrNull(...)` + null check. When null: `assetRef = { kind: 'unavailable', reason: 'mime_type_unsupported' }`. The MIME check fires BEFORE the stat for components, so the contract holds even when the file IS present on disk.

3. **New reason `mime_type_unsupported`** added to `IngredientAssetRef` discriminated union and `VendorUnavailableIngredientAssertion.data.reason` type. The pure builder's two internal `const reason:` declarations (parent + component branches) widened to include the new reason.

4. **New helper exported** from `src/engine/c2pa/index.ts` so pipeline can import it through the centralized barrel.

**Tests:**
- `format-router.test.ts`: 12 new tests (Tests 15-26) cover the new helper — supported MIMEs (PNG/JPEG/MP4/WebP/TIFF), case-insensitivity, null returns for unknown / no-extension / EXR / PSD.
- `pipeline-c2pa-ingredients.test.ts` Test E11 (WR-02 regression): component pointing at `mystery.xyz` (file pre-written so MIME check fires before stat) signs cleanly with `vfx_familiar.unavailable_ingredient` + `reason='mime_type_unsupported'`. `manifest.ingredients[]` does NOT carry a componentOf entry.

## Verification

- `npx tsc --noEmit`: exits 0 (clean)
- `npx vitest run`: 1189 passing / 5 pre-existing failures (phase-attribution + validation-flags ROADMAP tests) / 3 skipped — gain of +14 new passing tests over the 1175 baseline (1 M4 + 12 format-router + 1 E11 = 14)
- `npx vitest run packages/dashboard`: 88/88 passing (matches baseline)
- `npx vitest run src/__tests__/architecture-purity.test.ts`: 32/32 passing — `c2pa-node` import still ONLY in `signer.ts`
- Append-only provenance preserved (no `db.update` / `db.delete` introduced)
- Conventional-commits format respected (`fix(15): <description>`)
- One commit per finding (atomic)

---

_Fixed: 2026-04-30T10:25:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
