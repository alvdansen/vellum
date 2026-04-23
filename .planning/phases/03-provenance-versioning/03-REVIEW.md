---
phase: 03-provenance-versioning
reviewed: 2026-04-22T00:00:00Z
depth: standard
files_reviewed: 41
files_reviewed_list:
  - src/comfyui/client.ts
  - src/comfyui/png-metadata.ts
  - src/engine/diff.ts
  - src/engine/diff-summary.ts
  - src/engine/errors.ts
  - src/engine/generation.ts
  - src/engine/iterate-merge.ts
  - src/engine/pipeline.ts
  - src/engine/provenance.ts
  - src/server.ts
  - src/store/provenance-repo.ts
  - src/store/schema.ts
  - src/store/version-repo.ts
  - src/tools/generation-tool.ts
  - src/tools/index.ts
  - src/tools/version-tool.ts
  - src/types/hierarchy.ts
  - src/types/provenance.ts
  - src/utils/id.ts
  - src/test-utils/fake-comfyui-client.ts
  - src/__tests__/http-origin.test.ts
  - src/__tests__/tool-budget.test.ts
  - src/__tests__/transport-parity.test.ts
  - src/comfyui/__tests__/client.test.ts
  - src/comfyui/__tests__/live-smoke.test.ts
  - src/comfyui/__tests__/png-metadata.test.ts
  - src/engine/__tests__/diff.test.ts
  - src/engine/__tests__/generation.test.ts
  - src/engine/__tests__/hierarchy.test.ts
  - src/engine/__tests__/iterate-merge.test.ts
  - src/engine/__tests__/model-extraction.test.ts
  - src/engine/__tests__/pipeline.test.ts
  - src/engine/__tests__/seed-extraction.test.ts
  - src/engine/__tests__/shot-naming.test.ts
  - src/store/__tests__/migrate.test.ts
  - src/store/__tests__/provenance-repo.test.ts
  - src/store/__tests__/version-repo.test.ts
  - src/tools/__tests__/breadcrumb-always.test.ts
  - src/tools/__tests__/error-wrapping.test.ts
  - src/tools/__tests__/generation-tool.test.ts
  - src/tools/__tests__/input-bounds.test.ts
  - src/tools/__tests__/version-tool.test.ts
  - drizzle/0003_phase3_provenance.sql
findings:
  critical: 0
  warning: 2
  info: 6
  total: 8
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-04-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 41
**Status:** issues_found

## Summary

Phase 3 (provenance + versioning + MCP surface) is in very good shape. Every
phase-focus invariant from the prompt is structurally enforced by code:

- **Append-only provenance**: `ProvenanceRepo` exposes only `insertEvent` /
  `getEventsForVersion` / `getLatestCompletedEvent` / `getSubmitEvent` — zero
  update/delete methods (asserted reflectively by
  `provenance-repo.test.ts:198-208`).
- **Prototype-pollution guard**: `FORBIDDEN_KEYS = {__proto__, constructor,
  prototype}` is checked at both the outer node-id key layer and the nested
  `inputs.<field>` layer (`iterate-merge.ts:86,135`). Regression tests exercise
  both the JSON-parse own-property trick and the direct-object variant.
- **Credentials hygiene**: `scrubAndTruncate()` replaces every occurrence of
  `this.apiKey` with `[redacted]` on every error path (submit, status,
  download). The new `fetchResolvedPrompt` path is pure filesystem I/O — no
  network calls, so no key exposure. Server boot logs only `****<last4>`.
- **Redirect safety**: `redirect: 'manual'` is applied on `/api/prompt`,
  `/api/job/{id}/status`, `/api/view`, and the signed-URL second hop (closes
  SSRF bypass). Allowlist is regex-based for defaults and literal
  exact/suffix-string for admin-supplied hosts (`IS-01`).
- **SQL injection**: All reads/writes go through Drizzle ORM `eq()`, `and()`,
  `inArray()` helpers, or `sql` tagged templates with parameter placeholders
  (`${...}`). No raw concatenation. Migration `0003` is strictly additive: one
  new table (`provenance`), one new index, one `ALTER TABLE ... ADD`.
- **Tool-surface architecture**: Tool handlers touch only `Engine` facade —
  no direct `Repo` or `ComfyUIClient` access (verified by inspecting
  `generation-tool.ts`, `version-tool.ts`). Tool count is 6 of 12 budget
  (asserted by `tool-budget.test.ts`).
- **Discriminated-union strict re-validation (RT-02)**: Both `generation` and
  `version` handlers re-parse `rawInput` via `GenerationInputSchema.parse` /
  `VersionInputSchema.parse` inside the handler; ZodError is caught and
  re-wrapped as `INVALID_INPUT` with `input.<path>`.
- **Breadcrumb contract**: Every response shape includes
  `breadcrumb: BreadcrumbEntry[]` + `breadcrumb_text: string`. `diffVersions`
  in the Engine facade returns already-flattened
  `breadcrumb: Breadcrumb['entries']`, and the tool-layer `shapeDiffEnvelope`
  is a pass-through — no double-flatten.
- **Race conditions**: INSERT-time lineage write (`VersionRepo.insertVersion`
  takes `lineage` param and writes `parent_version_id` + `lineage_type`
  atomically with the row allocation). HTTP submit (`client.submit`,
  `client.status`, `client.downloadToPath`, `client.fetchResolvedPrompt`) is
  NEVER called inside a SQLite transaction (T-03-02-05 pattern held).
- **Live-smoke gate**: `SKIP = !COMFYUI_API_KEY || RUN_LIVE_SMOKE !== '1'`
  with `describe.skipIf(SKIP)` — default `npx vitest run` skips cleanly even
  when a real `.env` is loaded.

No critical or security issues found. The warnings below are around test
fidelity (stale comment and misleading test title); the info items are minor
code-quality observations. All are safe to address after the phase lands, but
documenting them now keeps the next hands in sync.

## Warnings

### WR-01: Stale test-description retry schedule `[2s,4s,8s]`

**File:** `src/engine/__tests__/generation.test.ts:254`
**Issue:** The test title claims the download-flaky retry uses a
`[2s,4s,8s]` backoff, but the implementation (per the source-file comment
at `src/engine/generation.ts:22-35`) was intentionally changed to
`DOWNLOAD_BETWEEN_ATTEMPT_DELAYS = [2_000, 4_000]` (three attempts, two
sleeps between them — the earlier `8_000` third value was dead because the
loop exited before sleeping). A future reader auditing the retry schedule
by reading the test title first will assume a 14-second total budget instead
of 6 seconds.
**Fix:**
```typescript
// src/engine/__tests__/generation.test.ts:254
- test('download-flaky eventually succeeds via retry with [2s,4s,8s] backoff', async () => {
+ test('download-flaky eventually succeeds via retry with [2s,4s] between-attempt backoff', async () => {
```

### WR-02: Test name "rejects any input with a top-level `patch` key" asserts the opposite

**File:** `src/tools/__tests__/generation-tool.test.ts:698`
**Issue:** The test title says the iterate handler *rejects* a top-level
`patch` key, but the body documents and asserts that Zod
(`z.object().default('strip')`) *silently drops* unknown top-level keys —
iteration with `patch: [...]` succeeds and no `patch` symbol leaks into the
submitted blob. The prompt for this review specifically calls out that
"unknown keys (like `patch:[...]` on iterate) must be silently dropped" —
the test's behavior matches that spec, but its title misrepresents it. Any
code reader treating the title as the spec will incorrectly conclude that
`patch` is validated-and-rejected.
**Fix:**
```typescript
// src/tools/__tests__/generation-tool.test.ts:698
- it('rejects any input with a top-level `patch` key — shape is overrides, not JSON Patch (D-PROV-13)', async () => {
+ it('silently drops any top-level `patch` key — shape is overrides, not JSON Patch (Zod strips unknown keys per D-PROV-13)', async () => {
```

Consider also adding a companion explicit-reject test using `z.object({...}).strict()`
only IF the product spec actually intends to reject — otherwise the current
behavior is correct and only the title needs repair.

## Info

### IN-01: `/api/job/{id}/status` does not surface HTTP 429 as `COMFYUI_RATE_LIMITED`

**File:** `src/comfyui/client.ts:272-285`
**Issue:** `submit()` at line 219 has an explicit `if (res.status === 429)`
branch that throws `COMFYUI_RATE_LIMITED` with the tier hint. `status()` has
no matching branch — a 429 on the status endpoint falls through to the
generic `!res.ok` path at line 278 and is reported as `COMFYUI_API_ERROR`.
Agents polling a rate-limited tenant see one code from `generation submit`
and a different code from `generation status`, making rate-limit handling
inconsistent. This is not a correctness bug, but it prevents the agent from
applying the "wait for an in-flight job" hint uniformly.
**Fix:** Add the same 429 branch to `status()` before the generic `!res.ok`
check:
```typescript
if (res.status === 429) {
  throw new TypedError(
    'COMFYUI_RATE_LIMITED',
    `ComfyUI status returned 429 (rate limit)`,
    'ComfyUI rate-limit hit during status poll. The recovery poller will back off and retry automatically.',
  );
}
```

### IN-02: `IT-21` test stages a failed submit then abandons it

**File:** `src/tools/__tests__/generation-tool.test.ts:445-485`
**Issue:** The test starts by setting `stack.fake.scenario = 'submit-error'`
and firing a submit (lines 449-457), then asserts the row is terminal, then
calls `stack.fake.reset()` and creates a brand-new version via
`insertVersion` + `markFailed` directly — the first submit-error row is
completely unused by the assertions at lines 479-484. Dead setup code is
confusing for maintainers: a reader sees two failure paths and may assume
the test asserts both.
**Fix:** Remove the submit-error stanza (lines 449-464) and collapse the
test to the direct `insertVersion` + `markFailed` path that the assertions
actually exercise. The intent (covering `IAC-02` — `error` alias derived from
`error_message`) is preserved.

### IN-03: `scrubAndTruncate` only scrubs the literal apiKey — URL-encoded / base64 variants bypass

**File:** `src/comfyui/client.ts:153-165`
**Issue:** `replaceAll(this.apiKey, '[redacted]')` handles the common case
(ComfyUI echoes the raw header value into an error body). If ComfyUI ever
URL-encodes or base64-encodes the header value before including it in an
error, the literal match would miss. This is a theoretical concern — the key
is only put in an `X-API-Key` header, not in URL query/path/body, so the
attack surface is narrow. Worth documenting as a known limitation rather
than fixing speculatively.
**Fix:** Add a comment documenting the assumption:
```typescript
// scrubAndTruncate only handles literal occurrences of the key. If a future
// ComfyUI version encodes the key (URL-encoding, base64) before echoing it
// into an error body, that variant would bypass the scrub. Current policy:
// the key only ever leaves this client in an `X-API-Key` header, so upstream
// is not expected to transform it. Revisit if that changes.
```
Alternative: also scrub `encodeURIComponent(this.apiKey)` and
`Buffer.from(this.apiKey).toString('base64')`. Defer unless observed.

### IN-04: Signed-URL in `outputs_json` is persisted indefinitely

**File:** `src/engine/generation.ts:412-418`, `src/comfyui/client.ts:395-400`
**Issue:** Each `StoredOutput` carries the time-limited signed URL that was
used to download the file (`url: target.toString()` from the second fetch).
This string is serialized into `versions.outputs_json` (a TEXT column) and
exposed verbatim on every subsequent `generation status` / `version get`
response. Until the signature expires, anyone with DB read access can
re-download the file without re-authenticating to ComfyUI Cloud. This is
the documented behavior (agents may want to surface the URL to users) but
should be a known-risk item for the threat model, not a silent assumption.
**Fix:** No code change needed. Document in `03-VALIDATION.md` or the
relevant decision doc that `outputs_json.url` contains a time-limited
signed token and treat the SQLite file as sensitive accordingly. If that
tradeoff is unacceptable, strip the query string before persisting:
```typescript
stored.push({
  ...,
  url: new URL(dl.url).origin + new URL(dl.url).pathname, // drop query string
  ...
});
```

### IN-05: `iterateFromVersion` does not clone baseBlob when no seed/overrides are passed

**File:** `src/engine/generation.ts:344-352`
**Issue:** When a caller passes `{action: 'iterate', version_id: x}` with
neither `overrides` nor `seed`, the handler reaches
`let mergedBlob: Record<string, unknown> = baseBlob;` and submits `baseBlob`
directly (since both `applySeedShortcut` and `applyOverrides` are skipped).
`baseBlob` is the `JSON.parse` result of a stored `prompt_json` string, so
it's already a fresh object — no cross-request aliasing is possible.
However, as defence-in-depth against a future refactor that caches the
parsed blob in-memory, cloning unconditionally would be cheap and
future-proof.
**Fix:**
```typescript
// src/engine/generation.ts:344
- let mergedBlob: Record<string, unknown> = baseBlob;
+ let mergedBlob: Record<string, unknown> = structuredClone(baseBlob);
```
Low priority — current code is correct under the present architecture.

### IN-06: `prov_` id prefix is hardcoded in one place but catalogued as a type-level value

**File:** `src/utils/id.ts:3`, `src/store/provenance-repo.ts:56`
**Issue:** `IdPrefix = 'ws' | 'proj' | 'seq' | 'shot' | 'ver' | 'prov'` is the
closed set of entity id prefixes. `ProvenanceRepo` uses `newId('prov')` at
line 56. This is internally consistent. The minor code-quality note is that
the `IdPrefix` union lives in `src/utils/id.ts` while the entity row
interfaces live in `src/types/hierarchy.ts` + `src/types/provenance.ts` —
a reader adding a new entity type has to update a third file. Consider
co-locating prefix → entity mapping or adding a JSDoc cross-reference.
**Fix:** Add a JSDoc comment at `src/utils/id.ts:3` pointing at the
consumer files:
```typescript
/**
 * Id prefixes for all hierarchy + provenance entities. Each prefix maps to
 * exactly one interface:
 *   'ws'   → Workspace (src/types/hierarchy.ts)
 *   'proj' → Project  (src/types/hierarchy.ts)
 *   'seq'  → Sequence (src/types/hierarchy.ts)
 *   'shot' → Shot     (src/types/hierarchy.ts)
 *   'ver'  → Version  (src/types/hierarchy.ts)
 *   'prov' → ProvenanceEvent (src/types/provenance.ts)
 */
export type IdPrefix = 'ws' | 'proj' | 'seq' | 'shot' | 'ver' | 'prov';
```

---

_Reviewed: 2026-04-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
