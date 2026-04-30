# Phase 11: Recovery Poller Error Detail - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss); enriched by orchestrator codebase investigation

<domain>
## Phase Boundary

Make async terminal-failure provenance match submit-time fidelity. Today the submit path and the status / recovery-poller path each implement their own `node_errors` extraction shape; they happen to share `extractFirstNodeError` as the building block, but the wrapping logic (handling string `error`, missing `error`, etc.) is duplicated. This phase consolidates to a single shared helper proven by a same-fixture parity test, and ensures that when Cloud returns a terminal `failed` with `node_errors`, the provenance failed-event row carries the actionable extracted detail — not the generic `"ComfyUI reported failed"` collapse.

**Trigger context:** v1.0 demo recovery cycle showed dashboard "failed" cards collapsing to `"ComfyUI reported failed"` for some failures that the submit-time path would have decoded as e.g. `"Unauthorized: Please login first"`. Two implementations of the same flatten-shape are guaranteed to drift; one helper + one parity test removes the class of bug.

**Success criteria (from ROADMAP):**
1. When the recovery poller observes a terminal `failed` Cloud status with a `node_errors` body, the resulting provenance failed-event row carries the extracted human-readable detail (not the generic collapse string).
2. The submit-time and recovery-poller error-extraction paths share a single helper, proven by a same-fixture test that asserts both paths produce identical extracted detail.
3. Existing failed-version dashboard cards render the new actionable error string verbatim — no field renaming, no UI rework.
4. When `node_errors` is absent or unparseable, the path falls back gracefully to the generic `"ComfyUI reported failed"` string with no thrown error.
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss phase was skipped per user setting. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Likely shape (planner should validate)
- Create `flattenComfyError(error: unknown): string` in `src/comfyui/format.ts` alongside `extractFirstNodeError`. Single helper that handles the three branches:
  1. object with `.node_errors` → `extractFirstNodeError(nodeErrors)`
  2. string → use the string verbatim
  3. anything else (undefined, malformed) → `"ComfyUI reported failed"`
- Replace the call site at `src/comfyui/client.ts:427-428` (submit-time 4xx body) — currently calls `extractFirstNodeError` only; switch to `flattenComfyError(parsed?.node_errors)` or full body branching depending on what the existing test fixtures expect.
- Replace the call site at `src/engine/generation.ts:204-208` (status / recovery-poller failed branch) with the same helper.
- Add a same-fixture parity test in `src/comfyui/__tests__/format.test.ts` (or a new file) that drives identical Cloud bodies through both call sites and asserts the extracted strings match byte-for-byte.
- Preserve the IT-10 cancelled-status test contract (`error_message.toContain('ComfyUI reported failed')`) — the helper's third branch must still emit that exact string.
- No DB schema changes. No new MCP tools. No field renames. Tool budget stays at 6 of 12.
</decisions>

<code_context>
## Existing Code Insights

- `src/comfyui/format.ts:110` — `extractFirstNodeError(nodeErrors: unknown): string | null` already flattens the first actionable `node_errors` entry (D-GEN-27). Building block exists.
- `src/comfyui/client.ts:427-428` — submit-time 4xx branch: `const nodeErrors = (parsed as { node_errors?: unknown } | null)?.node_errors; const nodeMessage = extractFirstNodeError(nodeErrors);`
- `src/comfyui/client.ts:456-517` — `status()` method emits `StatusResponse` with `error` set from raw Cloud body (`raw.error` if present, else `raw.error_message` as string). Either shape can reach the engine.
- `src/engine/generation.ts:204-208` — recovery-poller / status failed branch:
  ```ts
  const nodeErrors = (remote.error as { node_errors?: unknown } | undefined)?.node_errors;
  const flat =
    extractFirstNodeError(nodeErrors) ??
    (typeof remote.error === 'string' ? remote.error : 'ComfyUI reported failed');
  ```
  This is the duplicated extraction shape that needs consolidating.
- `src/engine/generation.ts:521` — `drivePoller()` calls `getGenerationStatus(rowId)`, so the recovery poller path inherits whatever shape this branch uses. There is no separate "recovery poller" failed-state branch — all paths flow through `getGenerationStatus`.
- `src/test-utils/fake-comfyui-client.ts:76, 123` — `cannedNodeErrors` test fixture exists for driving `failed` scenarios. The parity test can re-use this.
- `src/comfyui/__tests__/format.test.ts:93` — existing `extractFirstNodeError` tests live here; the new helper's tests belong nearby.
- `src/engine/__tests__/generation.test.ts:308` — IT-10 test: `expect(res.entity.error_message).toContain('ComfyUI reported failed');` — the helper's "neither node_errors nor string error" branch must still emit this exact string for the cancelled-status fake fixture.
- Architecture-purity test enforces no MCP imports outside `src/tools/`. The helper lives in `src/comfyui/`, which is engine-side; no MCP imports allowed.
- Append-only provenance: `provenanceWriter.writeFailedEvent` records the flat string. Plan must NOT update an existing provenance row in place.
</code_context>

<specifics>
## Specific Ideas

- **Helper signature:** `export function flattenComfyError(error: unknown): string` — takes the raw `error` field as it lands in `StatusResponse`, returns a non-null string. Single source of truth for the three-branch logic. `extractFirstNodeError` stays as the building block (returns `string | null`); `flattenComfyError` wraps it with the fallback chain.
- **Parity test shape:** Drive a fixture body like `{ error: { node_errors: { "3": { errors: [{ message: "Unauthorized: Please login first" }], class_type: "KSampler" } } } }` through both:
  1. `client.submit()` failure path (returns `TypedError(COMFYUI_API_ERROR)` whose message contains the flattened detail)
  2. `getGenerationStatus()` recovery branch (writes flattened detail to `provenance.failed_event.error_message`)
  Assert both extract `"Unauthorized: Please login first"` byte-for-byte.
- **Fallback parity:** Same parity test should cover the three fallback shapes: (a) string `error`, (b) missing `error`, (c) malformed/unparseable `error`. All four cases must produce identical output across both paths.
- **Dashboard preservation:** Dashboard fetches via `version.error_message`. Field name doesn't change. Plan should explicitly include a one-line check that the existing UI rendering test (if any) still passes; if not, no UI plan is needed.
- **Submit-time helper coupling:** The submit-time call at `client.ts:427` currently only flattens `node_errors`. Decide whether to widen it to use `flattenComfyError` (which would also handle string-error and missing-error cases at the submit boundary) or keep submit narrowly scoped to `extractFirstNodeError` and let the wider helper live only in the status path. Recommend: widen submit too, so both paths produce identical output for identical bodies — this is what the parity test enforces.
</specifics>

<deferred>
## Deferred Ideas

- Structured failure-detail surface (parsed `{ code, message, node_id }` instead of flat string) — out of scope for v1.1; the helper returns `string`. Future work if agents need to react programmatically to specific failure classes.
- Failure-detail localization (i18n) — out of scope; strings stay raw from Cloud.
- New error code beyond `COMFYUI_API_ERROR` — out of scope; the existing code is correct, only the message body changes.
- Backfilling historic `provenance.failed_event` rows that landed before this phase — out of scope (append-only provenance contract; the historical rows stay as-is).
</deferred>
