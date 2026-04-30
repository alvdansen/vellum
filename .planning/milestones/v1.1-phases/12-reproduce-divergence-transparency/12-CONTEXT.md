# Phase 12: Reproduce Divergence Transparency - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss); enriched by orchestrator codebase investigation

<domain>
## Phase Boundary

When a reproduce-lineage output diverges from its parent (because the partner-API model is non-deterministic, or because a SHA-256 of v3's output differs from v4's despite verbatim prompt replay), surface that divergence in the UI rather than silently shipping a "reproduction" that isn't bit-identical. The honesty contract from D-PROV-28 (`reproduction_warnings` is ALWAYS present on response, empty array permitted) becomes user-visible at the dashboard.

**Trigger context:** v1.0 demo showed `engine.reproduceVersion` returning `reproduction_warnings: []` for non-deterministic partner-API models even when the actual output bytes differed from the parent. The dashboard rendered the reproduction the same as the parent — silent shipping of a non-bit-identical "reproduction". This phase makes the gap visible.

**Success criteria (from ROADMAP):**
1. The version drawer renders a "non-deterministic — outputs may differ from parent" pill on any reproduce-lineage version when (a) the partner-API response carried a non-determinism warning OR (b) the SHA-256 of the reproduction output differs from the parent's output.
2. The version drawer surfaces a side-by-side "parent vs reproduction" image comparison block when both outputs exist on disk.
3. `version.diff` (engine + tool path) optionally includes a `reproduction_divergence` field carrying the SHA-256 mismatch detail and any partner-API non-determinism warnings.
4. A reproduce-lineage version whose output IS bit-identical to its parent shows no divergence pill and no comparison block — the UI signal is unambiguous.
</domain>

<decisions>
## Implementation Decisions

### Locked
- D-CTX-1: **No DB schema change.** Hash output bytes lazily on disk during `version.diff` rather than persisting `output_sha256` on the versions table. Avoids a v1.1-specific migration and decouples Phase 12 from Phase 13's `models_json` shape changes.
- D-CTX-2: **Divergence visibility is via `version.diff`.** The dashboard auto-fetches diff on `VersionDrawer` mount when the selected version has `lineage_type === 'reproduce'` AND a `priorVersion` exists. The diff response carries `reproduction_divergence` (or null when no divergence). Pill + comparison block render from this single response.
- D-CTX-3: **Append-only provenance preserved.** Phase 12 does NOT write to provenance. Reproduction warnings are derived (engine-side, on demand) when version.diff is called. The original `provenance.completed_event` row stays append-only.
- D-CTX-4: **`reproduction_divergence` shape:**
  ```ts
  reproduction_divergence: null | {
    sha256_mismatch: { parent: string; reproduction: string } | null;  // null if both outputs missing or hashes match
    warnings: string[];           // partner-API non-determinism warnings (from engine.reproduceVersion's reproduction_warnings)
    parent_output_present: boolean;
    reproduction_output_present: boolean;
  }
  ```
  `null` means "not a reproduce-lineage diff" or "no divergence detected". Anything non-null means at least one divergence signal fired.
- D-CTX-5: **Reproduction warnings sourcing.** `engine.reproduceVersion` already returns `reproduction_warnings: string[]` (D-PROV-28). For Phase 12, persist these as a JSON array on a new column `versions.reproduction_warnings_json` (NULL by default). This is the ONLY schema change — a single nullable text column on an existing table — added via a new Drizzle migration. Backward-compat: NULL on legacy rows means "no warnings" semantically. Justifies the DB touch since warnings are sticky to the version row across page reloads.
  - OR (alternative — planner decides): warnings live only in the diff response, recomputed each time. Simpler but loses the warning if the partner-API response is no longer available. Recommend persistence for durability.

### Claude's Discretion
- Hash algorithm wiring: use Node's built-in `crypto.createHash('sha256')` streaming API to handle large outputs (videos can be 100+ MB).
- Hash caching: optional in-memory LRU keyed by `${versionId}:${filename}` to avoid re-hashing on repeat diff calls. Likely premature; defer unless profiling shows a hotspot.
- Comparison block UI shape: two `<img>` elements in a CSS grid (1fr 1fr) with `Parent (vN)` and `Reproduction (vM)` captions. Mirrors the existing DiffDrawer's "before/after side by side" pattern.
- Pill style: reuse existing pill primitive (or create a new `WarningPill` component if StatusPill is not extensible). Color: amber/yellow (warning intent), distinct from StatusPill colors.
</decisions>

<code_context>
## Existing Code Insights

- `src/types/provenance.ts:78-81` — `DiffResponse` has `summary: string` + `changes: DiffChanges`. Phase 12 adds an optional `reproduction_divergence` field.
- `src/types/provenance.ts:84-96` — `DiffSnapshot` carries the metadata diffVersions needs. Already includes `version_id`, `output_count`. Phase 12 may need to extend it with `lineage_type` (currently lives only on `Version`, not on the snapshot).
- `src/types/hierarchy.ts:67` — `lineage_type: 'reproduce' | 'iterate' | null` on the Version row.
- `src/engine/diff.ts:156` — `diffVersions(input: DiffInput): DiffResponse` — pure function. Must be extended (or wrapped) to compute hash divergence. Pure-function design means hash computation needs hash bytes injected via input, not read from disk inside the pure layer.
- `src/engine/pipeline.ts:475` — `Engine.diffVersions(versionAId, versionBId): DiffResponse` — facade that loads snapshots and delegates to `pureDiffVersions`. This is the layer where on-disk hash reading + warning lookup belongs (impure I/O).
- `src/comfyui/types.ts:27-33` — `StoredOutput` shape: `{filename, path, url, content_type, size_bytes}`. No hash field today.
- `src/engine/output-downloader.ts:46-71` — `downloadOutput()` writes bytes to `outputsDir/versionId/filename`. Phase 12 reads from this layout to hash on demand.
- `src/engine/generation.ts:387` — `downloadAndPersist` produces `StoredOutput[]`, persisted via `outputs_json`. Hash on download is a deferred option (would require a schema field on StoredOutput); Phase 12 instead hashes lazily during diff.
- `packages/dashboard/src/views/VersionDrawer.tsx` — Preact + Tailwind component. Already lazy-fetches provenance + lazy-fetches diff on "View Diff" click. Phase 12 changes: auto-fetch diff on mount when lineage_type === 'reproduce', render pill in header alongside StatusPill, render side-by-side comparison block in body.
- `packages/dashboard/src/views/DiffDrawer.tsx` — existing "before/after side by side" pattern. Style analog for the comparison block.
- `packages/dashboard/src/components/StatusPill.tsx` — existing pill primitive. Either extend or create a sibling `WarningPill` component.
- `packages/dashboard/src/lib/api.ts` — `diffVersion(idA, idB)` is the existing client. Returns the engine's DiffResponse verbatim. After Phase 12 the response shape gains `reproduction_divergence`.
- `packages/dashboard/src/lib/api.ts` — `getOutputUrl(versionId)` returns the streamable image URL. Reused for the comparison block.
- `src/test-utils/fake-engine.ts:231-251` — `reproduceVersion` fake. Tests can drive `lineage_type === 'reproduce'` versions deterministically.
- Architecture-purity guard: `src/engine/diff.ts` and any engine-layer file MUST have zero MCP imports. Hashing utility (likely `src/engine/hash.ts` or `src/engine/output-hash.ts`) must respect this.
- Test baseline at end of Phase 11: 797 passing / 5 pre-existing failing / 3 skipped.
- Dual-transport parity: Phase 12 changes are dashboard + engine, not transport-specific. Both stdio and Streamable HTTP serve `version.diff` identically — no new parity test needed.
</code_context>

<specifics>
## Specific Ideas

- **Hash compute path:** Create `src/engine/output-hash.ts` exporting `computeOutputSha256(versionId: string, outputsDir: string, filename: string): Promise<string | null>` — returns null if file missing on disk (graceful for legacy versions), otherwise streams the file and returns the SHA-256 hex. Hash a SINGLE output per version (the first stored output) for v1.1 — multi-output reproductions are out of scope unless the planner sees a clean single-pass shape.
- **Persistence (warnings):** Single migration `0005_phase12_reproduction_warnings.sql` adds `reproduction_warnings_json TEXT NULL` to versions. Or planner can choose to skip persistence and recompute (simpler, see D-CTX-5). The migration option only makes sense if reproduction_warnings come from the partner-API and would be lost without storage. **Recommendation: persist** — partner-API responses are not replayable.
- **Pill render rule:** Pill shows when `reproduction_divergence !== null` (i.e., either sha256 mismatch OR warnings non-empty). Pill text: "non-deterministic — outputs may differ from parent". Tooltip on hover (later phase) can carry the specific reason.
- **Comparison block render rule:** Block shows when `reproduction_divergence?.parent_output_present === true && reproduction_divergence?.reproduction_output_present === true`. Both `<img>` elements use `getOutputUrl(parentVersionId)` and `getOutputUrl(reproductionVersionId)`.
- **No-divergence path (criterion #4):** When SHA-256 matches AND warnings are empty, `reproduction_divergence` is `null`. Pill does not render. Comparison block does not render. Drawer looks identical to a non-reproduce version's drawer.
- **Test fixtures:** Use Vitest's tmpdir + fixture image bytes for hash computation tests. For dashboard tests, mock the diff response.
- **Dual-transport parity test (success criterion #3 mentions tool path):** Add a test that calls the version tool's `diff` action via the tool envelope and asserts the response carries `reproduction_divergence` for a reproduce-lineage version. Already covered structurally if the engine layer attaches the field — the tool envelope passes through.
</specifics>

<deferred>
## Deferred Ideas

- Multi-output reproduction hashing (current scope: hash first output only). Defer until users ship multi-output reproduce flows in production.
- Tooltip on the pill describing specific divergence reasons. Defer to UX polish.
- Pixel-diff visualization (e.g., RGB delta heatmap) in the comparison block. Defer to v1.2 or later.
- Backfilling `reproduction_warnings_json` for legacy reproduce-lineage rows. Out of scope; legacy NULL semantically equals "no warnings recorded."
- Hash caching layer (LRU). Defer until profiling shows a hotspot.
- Pill color/style design tokens — use existing palette; no new design tokens required.
</deferred>
