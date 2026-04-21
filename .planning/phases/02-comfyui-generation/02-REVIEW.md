---
phase: 02-comfyui-generation
reviewed: 2026-04-21T00:00:00Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - .env.example
  - drizzle.config.ts
  - drizzle/0001_phase2_version_lifecycle.sql
  - package.json
  - src/__tests__/architecture-purity.test.ts
  - src/__tests__/stdio-hygiene.test.ts
  - src/__tests__/tool-budget.test.ts
  - src/comfyui/__tests__/client.test.ts
  - src/comfyui/__tests__/format.test.ts
  - src/comfyui/__tests__/live-smoke.test.ts
  - src/comfyui/client.ts
  - src/comfyui/format.ts
  - src/comfyui/types.ts
  - src/engine/__tests__/backoff.test.ts
  - src/engine/__tests__/generation.test.ts
  - src/engine/backoff.ts
  - src/engine/breadcrumb.ts
  - src/engine/errors.ts
  - src/engine/generation.ts
  - src/engine/pipeline.ts
  - src/server.ts
  - src/store/__tests__/migrate.test.ts
  - src/store/__tests__/version-repo.test.ts
  - src/store/db.ts
  - src/store/schema.ts
  - src/store/version-repo.ts
  - src/test-utils/fake-comfyui-client.ts
  - src/test-utils/fake-engine.ts
  - src/tools/__tests__/generation-tool.test.ts
  - src/tools/generation-tool.ts
  - src/tools/index.ts
  - src/types/hierarchy.ts
findings:
  critical: 0
  warning: 7
  info: 8
  total: 15
status: issues_found
---

# Phase 02 (comfyui-generation): Code Review Report

**Reviewed:** 2026-04-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

Overall, Phase 2 lands a well-architected ComfyUI Cloud generation surface on top of the Phase 1 hierarchy. The code demonstrates strong discipline around the project's architectural invariants:

- **Tool-engine separation holds** — `src/comfyui/**` is MCP/SQLite/Drizzle-free, enforced by `architecture-purity.test.ts`.
- **Tool budget is exactly 5** — verified by `tool-budget.test.ts`; well under the 12-cap.
- **SSRF defense** — manual-redirect + host-allowlist gate on `/api/view`; signed-URL fetch explicitly drops `X-API-Key`. Tests cover allowed host, disallowed host, non-302, and additional-host extension.
- **Path-traversal defense** — `sanitizeRelativeSegment` rejects `..`, `/`, `\`, `\0`; tests exist for all four branches.
- **Temp-then-rename atomic writes** — `downloadToPath` writes `{dest}.partial` and renames on success; partial unlinked on failure.
- **Credential hygiene** — stderr-only logging, last-4-only key format, literal `COMFYUI_API_KEY=` never appears in output; verified by `stdio-hygiene.test.ts`.
- **State-machine immutability** — `WHERE completed_at IS NULL` guard on terminal updates; UNIQUE-retry-once on concurrent-submit race.
- **Raw-error shielding** — `toolError` envelope re-wraps non-TypedError throws to `INVALID_INPUT` with a stderr log; SQLite/Zod shapes never reach agents.

However, several correctness and quality issues merit attention before Phase 3. No critical findings — none are security-exploitable in the current demo-scope trust model — but one category (output-validation gap in the ComfyUI status response) could cause a raw `TypeError` to bubble past the typed-error contract if the Cloud returns a malformed element. A concurrency gap between the recovery poller and agent-driven `generation status` calls for the same row can cause double work. The `outputs_json` string flowing through the tool response also violates the "no raw JSON dumps to agents" rule in CLAUDE.md.

## Warnings

### WR-01: `ComfyOutput` array elements never validated — `undefined.filename` will raise raw TypeError

**File:** `src/comfyui/client.ts:158`, consumed at `src/engine/generation.ts:186`, `src/utils/outputs.ts:29`
**Issue:** `ComfyUIClient.status()` casts the outputs array without per-element validation:

```ts
const outputs = Array.isArray(raw.outputs) ? (raw.outputs as ComfyOutput[]) : undefined;
```

If ComfyUI Cloud returns an outputs array whose elements are missing `filename` (e.g. `[{}]`, `[{type: "output"}]`, or `[null]`), the engine passes `out.filename` (i.e. `undefined` or `null`) into `buildOutputPath` → `sanitizeRelativeSegment(name: string)`, which calls `name.includes('..')`. That raises `TypeError: Cannot read properties of undefined (reading 'includes')` — a non-`TypedError` that crosses the engine boundary. The tool envelope's `toolError` will catch it at the final boundary and return generic `INVALID_INPUT`, but:

1. The defence-in-depth re-wrap loses the typed-code channel (`COMFYUI_API_ERROR` is more informative than `INVALID_INPUT`).
2. The row is left in whatever state the partial `downloadAndPersist` got to, potentially with a `.partial` file on disk and no DB-level `markFailed`. The in-flight `getGenerationStatus` call returns a raw error rather than a cached failed row.

**Fix:** Validate each output element before the cast. Either use a Zod schema in `status()` or hand-validate the shape:

```ts
const rawOutputs = raw.outputs;
const outputs = Array.isArray(rawOutputs)
  ? (rawOutputs.filter(
      (o): o is ComfyOutput =>
        o !== null &&
        typeof o === 'object' &&
        typeof (o as { filename?: unknown }).filename === 'string' &&
        (o as { filename: string }).filename.length > 0,
    ) as ComfyOutput[])
  : undefined;
// Throw if raw.outputs had content but none validated — prevents silent zero-output "completed" rows.
if (Array.isArray(rawOutputs) && rawOutputs.length > 0 && (outputs?.length ?? 0) === 0) {
  throw new TypedError(
    'COMFYUI_API_ERROR',
    'ComfyUI returned outputs but none matched the expected {filename, subfolder?, type?} shape',
  );
}
```

This converts a protocol drift into a typed error at the HTTP boundary where it belongs.

---

### WR-02: Race between recovery poller and agent `generation status` — double download on completion

**File:** `src/engine/generation.ts:100-152`, `238-248`
**Issue:** There is no mutual exclusion on `getGenerationStatus` calls for the same `versionId`. Two concurrent call paths exist:

1. Recovery poller (kicked by `start()`) polls every 2s/4s/8s/...
2. Agent-driven `generation status` tool calls.

If the poller and an agent call hit the same row at roughly the same moment while ComfyUI has just flipped to `completed`, both will:
- See `row.status !== 'completed'` (pre-check).
- Fetch remote status — both get `completed`.
- Run `downloadAndPersist` concurrently.

`downloadAndPersist` performs `resolveCollisionSuffix(dir, filename)` per-call. Since the race hits two parallel calls, both resolve to the same `finalName` (neither's temp-file exists yet), then two `downloadToPath` calls race against the same `{dest}.partial` path. `createWriteStream(partial)` will open the same file twice; one rename() could win while the other overwrites, or `ENOENT` may surface if one unlinks mid-flight.

The DB side is protected: `markCompleted` uses `WHERE completed_at IS NULL`, so the second write is a no-op. But:
- Duplicate download work hits the signed-URL quota twice.
- Partial-file races can leave `.partial` debris.
- `outputs_json` is set to whichever call wins `markCompleted`; the other's stored file is now "orphaned" (still on disk but not referenced).

**Fix:** Add an in-memory `Map<string, Promise<...>>` keyed by `versionId` that coalesces concurrent calls. Simplest: wrap the network fetch + persist block in a per-row mutex that returns the pending promise if another caller is already in-flight:

```ts
private inFlight = new Map<string, Promise<{ entity: Version; breadcrumb: Breadcrumb }>>();

async getGenerationStatus(versionId: string): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
  const existing = this.inFlight.get(versionId);
  if (existing) return existing;
  const p = this.doFetchStatus(versionId).finally(() => this.inFlight.delete(versionId));
  this.inFlight.set(versionId, p);
  return p;
}
```

Alternative: queue a single poller per row at `submitGeneration` time (see WR-03), in which case agent `status` calls return cached until the poller advances the row — and there is no race because only one caller is allowed to hit ComfyUI per row.

---

### WR-03: `submitGeneration` does not kick a per-row poller — agent must poll manually

**File:** `src/engine/generation.ts:52-92`, `238-248`
**Issue:** `start()` kicks pollers only for rows already in the DB at boot. `submitGeneration` inserts a new row but never adds it to `this.pollers`. Consequence:

- The row sits in `submitted` state indefinitely.
- The only paths to advance it are: (a) agent calls `generation status` explicitly, or (b) the server restarts and `start()` picks it up.

If the agent submits and never polls (e.g. agent crashes, loses the `version_id`), the row is orphaned until next server restart. Worse, the agent receives the status response with `status: 'submitted'` and may assume ownership of polling — but no server-side poller is running, so backoff semantics (D-GEN-24, 2s/4s/8s/16s/30s) are effectively unused for the common "agent submits → poller drives to terminal" path.

The phase context lists "Async generation: Submit returns immediately; status is a separate tool call; exponential backoff for polling." This implies the backoff applies somewhere; currently it only applies on the recovery path, not on the happy path.

**Fix (option A — match the phase-context intent):** Kick a poller at the end of `submitGeneration`, matching the `start()` pattern:

```ts
const refreshed = this.versions.getVersion(row.id)!;
const controller = new AbortController();
this.pollers.set(row.id, controller);
void this.drivePoller(row.id, controller.signal).finally(() => {
  this.pollers.delete(row.id);
});
return { entity: refreshed, breadcrumb: this.breadcrumb.resolve('version', row.id) };
```

**Fix (option B — document the explicit-polling design):** Add a code comment + update the tool description to make it clear that the agent owns polling cadence. Either direction is fine, but the current implementation is ambiguous. Note: fixing WR-02 (race dedup) is a prerequisite if option A is chosen.

---

### WR-04: `/api/view` signed-URL response has no size cap — risk of OOM on malformed redirect target

**File:** `src/comfyui/client.ts:210-223`
**Issue:** After validating the redirect host, the second fetch has no body-size upper bound. If the signed URL responds with an extremely large body (either accidentally or maliciously via a compromised allowed-host target), the pipeline streams the full content to disk. `contentLength` is read from the `content-length` header but never enforced:

```ts
const contentLengthRaw = second.headers.get('content-length');
return {
  ...
  contentLength: contentLengthRaw ? Number(contentLengthRaw) : NaN,
};
```

Then `downloadToPath` streams without checking. A 10GB response would fill the disk.

**Fix:** Add a size cap defaulting to, say, 500MB (enough for videos), and abort the stream if exceeded. Consider making it configurable:

```ts
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024; // 500MB default

// In downloadToPath:
readable.on('data', (chunk: Buffer) => {
  bytes += chunk.byteLength;
  if (bytes > MAX_DOWNLOAD_BYTES) {
    readable.destroy(new Error(`Download exceeded ${MAX_DOWNLOAD_BYTES} bytes`));
  }
});

// And check content-length pre-flight if present:
if (Number.isFinite(result.contentLength) && result.contentLength > MAX_DOWNLOAD_BYTES) {
  throw new TypedError(
    'DOWNLOAD_FAILED',
    `Download size ${result.contentLength} exceeds max ${MAX_DOWNLOAD_BYTES}`,
  );
}
```

The threat model here is modest (signed URLs are short-lived and from an allowlisted host), but defence-in-depth against provider/network issues is cheap.

---

### WR-05: `res.text()` on error path reads unbounded response body — potential memory hit on 4xx/5xx

**File:** `src/comfyui/client.ts:112`
**Issue:** When ComfyUI returns a non-2xx status, the client slurps the entire response body with `res.text()`. A proxy or misbehaving upstream that returns a multi-megabyte HTML error page would pull it all into memory. The text is then JSON.parsed (returning `null` on failure — fine), but the memory allocation happens regardless.

**Fix:** Cap the read. Use `res.body` with a size-limited reader, or convert `await res.text()` into a manual chunked read with a cap:

```ts
if (!res.ok) {
  const MAX_ERROR_BODY = 64 * 1024; // 64KB is plenty for an error message
  const reader = res.body?.getReader();
  let text = '';
  if (reader) {
    const decoder = new TextDecoder();
    let total = 0;
    while (total < MAX_ERROR_BODY) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => undefined);
  }
  // ... rest unchanged
}
```

Or simpler — just catch and discard if the body is too large. Low-severity, but worth mentioning since the same pattern applies in `status()` (`res.json()` is also unbounded).

---

### WR-06: Tool response surfaces `outputs_json` as a pre-serialized string — violates "no raw JSON dumps"

**File:** `src/tools/generation-tool.ts:40-54`, CLAUDE.md rule "Never return raw JSON dumps to agents — structure responses with context"
**Issue:** `shapeVersionEntity` spreads `...entity`, which carries `outputs_json` as a raw string. The agent receives something like:

```json
{
  "entity": {
    "outputs_json": "[{\"filename\":\"out.png\",\"path\":\"outputs/...\",\"url\":\"https://...\",\"content_type\":\"image/png\",\"size_bytes\":12345}]",
    ...
  }
}
```

To extract the list of files, the agent must `JSON.parse(entity.outputs_json)`. This is exactly the "raw JSON dump" pattern that CLAUDE.md prohibits. Per the spec, the tool should structure the response:

```json
{
  "entity": {
    "outputs": [{ "filename": "...", "path": "...", ... }],
    ...
  }
}
```

**Fix:** Parse `outputs_json` during `shapeVersionEntity` and expose a typed `outputs` field. Drop `outputs_json` from the response (keep it in the DB for persistence):

```ts
function shapeVersionEntity(result: { entity: Version; breadcrumb: Breadcrumb }) {
  const { entity, breadcrumb } = result;
  let outputs: StoredOutput[] | null = null;
  if (entity.outputs_json) {
    try {
      outputs = JSON.parse(entity.outputs_json) as StoredOutput[];
    } catch {
      outputs = null; // persisted value corrupt — surface as null + log
      console.error(`[generation-tool] corrupt outputs_json for ${entity.id}`);
    }
  }
  const { outputs_json: _omit, ...rest } = entity;
  const shaped = {
    ...rest,
    version_label: versionLabel(entity.version_number),
    progress: null as number | null,
    error: entity.error_message ?? null,
    outputs,
  };
  return {
    entity: shaped,
    breadcrumb: breadcrumb.entries,
    breadcrumb_text: breadcrumb.text,
  };
}
```

Update `generation-tool.test.ts` to assert on `entity.outputs` instead of `entity.outputs_json`.

---

### WR-07: Non-POSIX path mixing in `downloadAndPersist` breaks on Windows

**File:** `src/engine/generation.ts:1`, `189-192`
**Issue:** `generation.ts` imports `path` from `node:path/posix` — explicitly POSIX. But the resulting `finalPath` is passed to `createWriteStream()` and `rename()` inside `ComfyUIClient.downloadToPath`, which interact with native fs APIs. On Windows, `node:fs` accepts forward-slash paths today, so this works in practice. But mixing POSIX path construction with native fs is a maintenance hazard — any new path manipulation in the call chain (e.g., joining with `__dirname` or resolving against cwd) needs to remember the convention.

The project's conventions state "POSIX-style paths (forward slash) — the output tree is OS-agnostic per demo scope" (outputs.ts:9). That's an explicit decision, not a bug. But `src/engine/generation.ts` uses POSIX paths (including joining `this.outputRoot` which might be `/tmp/vfx-smoke-out-xyz` on macOS — an absolute path — or a relative `./outputs`). Per POSIX path semantics, `path.join('/abs/root', 'Project', 'sq010', ...)` works, but this is load-bearing and not documented.

**Fix:** Either (a) explicitly document that `outputRoot` may be absolute or relative and both are supported, (b) add a test case using an absolute `outputRoot` (the live-smoke test already does this implicitly — consider promoting to a unit test), or (c) switch to native `node:path` for the engine's path joining and POSIX only for the relative-path builder. Low priority but flag-worthy.

---

## Info

### IN-01: `readVersion()` has no error handling for missing `package.json`

**File:** `src/server.ts:79-83`
**Issue:** `readVersion()` assumes `package.json` is at `../package.json` relative to the module URL. If the file is missing, malformed, or `version` is missing, the unhandled rejection bubbles up to `main().catch(...)` with a less-helpful error message than the user would want.
**Fix:** Wrap in try/catch with a concrete error message:
```ts
try {
  const pkg = JSON.parse(await readFile(pkgUrl, 'utf8')) as { version?: string };
  if (!pkg.version) throw new Error('package.json has no "version" field');
  return pkg.version;
} catch (err) {
  throw new Error(`Failed to read server version from package.json: ${(err as Error).message}`);
}
```

---

### IN-02: Dead branch in `doInsert` retry loop

**File:** `src/store/version-repo.ts:50-67`
**Issue:** The for-loop runs for `attempt < 2`, but the retry-once-then-surface logic at line 55-56 can never fall through to the `throw new TypedError('CONCURRENT_SUBMIT_CONFLICT', 'Exhausted retries (unreachable)')` line at the bottom. Specifically:
- On first attempt UNIQUE violation: `continue` (retry).
- On second attempt UNIQUE violation: `throw` immediately (`isUniqueViolation(err) && attempt === 0` is false on attempt 1, so the second `if (isUniqueViolation(err))` throws).
- Any non-UNIQUE error: rethrown immediately.

The loop can only be exited via `return` or `throw` — never via loop-end. The unreachable line is a defensive guard but obscures the intent.
**Fix:** Either add an `eslint-disable` with a comment, or refactor to a two-call sequence:
```ts
insertVersion(shotId: string, notes?: string): Version {
  try {
    return this.doInsert(shotId, notes);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  try {
    return this.doInsert(shotId, notes);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new TypedError(
        'CONCURRENT_SUBMIT_CONFLICT',
        `Concurrent submit for shot '${shotId}' — retry once`,
        'Retry the submit call; ...',
      );
    }
    throw err;
  }
}
```
This eliminates the unreachable branch and matches Phase 1's explicit retry style.

---

### IN-03: Additional-hosts allowlist accepts whole hostnames without subdomain-wildcard semantics

**File:** `src/comfyui/client.ts:76-80`, `server.ts:136-139`
**Issue:** The default allowlist uses subdomain-aware patterns like `/(^|\.)googleapis\.com$/` (matches `foo.googleapis.com`). But user-provided `additionalAllowedHosts` values go through a plain escape — `new RegExp('^' + host.replace(/\./g, '\\.') + '$')`. So `COMFYUI_ALLOWED_REDIRECT_HOSTS=example.com` matches only `example.com`, not `foo.example.com`. This is arguably correct (strict by default) but can confuse operators who expect subdomain behavior. The comment above `DEFAULT_ALLOWED_HOST_PATTERNS` (line 48-51) explains the subdomain intent for defaults but does not mention the additional-hosts semantics.
**Fix:** Document the semantic difference in a comment above the loop at line 76:
```ts
// additionalAllowedHosts is STRICT — exact hostname match only. Use the
// subdomain form via multiple entries if needed (e.g., "example.com,foo.example.com").
```
Or, if subdomain-wildcard is desired, support a `*.host` syntax:
```ts
if (trimmed.startsWith('*.')) {
  const suffix = trimmed.slice(2);
  this.allowed.push(new RegExp(`(^|\\.)${suffix.replace(/\./g, '\\.')}$`));
} else {
  this.allowed.push(new RegExp(`^${trimmed.replace(/\./g, '\\.')}$`));
}
```

---

### IN-04: Signed URL persisted in DB `outputs_json` — short-lived credential in storage

**File:** `src/engine/generation.ts:203-209`, `src/comfyui/types.ts:27-33`
**Issue:** `StoredOutput.url` holds the signed URL from ComfyUI Cloud. These typically expire within minutes/hours. Once expired, the URL in the DB is useless but non-obviously so — the agent might surface it to a human who attempts a direct fetch and gets an opaque 403. It is also a credentials-adjacent artifact that, while individually scoped to a single asset, sits in the DB alongside ordinary metadata.
**Fix:** Two options:
  1. Drop `url` from `StoredOutput` entirely. The `path` field is the durable artefact; the URL has no long-term value.
  2. Keep `url` but add a comment + TTL annotation to the `StoredOutput` type:
     ```ts
     export interface StoredOutput {
       filename: string;
       path: string;
       /** Signed-URL provenance. Expires per ComfyUI Cloud's signing TTL; do not re-fetch. */
       url: string;
       content_type: string;
       size_bytes: number;
     }
     ```
  The live-smoke test already probes the URL host for research purposes, so keep it for that use case but signal its TTL. Low-priority; signals intent for Phase 3 decisions.

---

### IN-05: `contentLength: NaN` sentinel is error-prone

**File:** `src/comfyui/client.ts:221-222`, `src/engine/generation.ts:267-268`
**Issue:** When `content-length` header is absent, `download()` returns `contentLength: NaN`. Downstream, `downloadToPath` falls back to counting bytes in the stream. The `Number.isFinite(result.contentLength) && result.contentLength > 0` check handles it, but NaN as a sentinel for "unknown" is fragile — easy to accidentally arithmetic-coerce or log. Using `null` or `undefined` is more idiomatic TypeScript.
**Fix:** Change the type and sentinel:
```ts
export interface DownloadResult {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
  url: string;
}
// In download():
contentLength: contentLengthRaw ? Number(contentLengthRaw) : null,
// In downloadToPath:
sizeBytes: result.contentLength ?? bytes,
```

---

### IN-06: `[outputs] collision:` log leaks internal state to stderr on every successful collision

**File:** `src/utils/outputs.ts:99`
**Issue:** Every collision-resolve operation logs to stderr: `console.error(\`[outputs] collision: ${filename} -> ${candidate}\`);`. In normal operation (rerunning a workflow on the same shot — the common case for iterating on a take), this fires on every download. For multi-output workflows (video frames, animation sequences), it floods stderr.
**Fix:** Drop the log or make it debug-gated:
```ts
if (process.env.VFX_DEBUG) {
  console.error(`[outputs] collision: ${filename} -> ${candidate}`);
}
```
Or, better, expose a structured logger interface that can be silenced in production. Phase 1 uses `console.error` throughout — this is a pre-existing pattern not a regression — but the collision log is louder than most and worth a second look.

---

### IN-07: `createBackoffIterator` infinite loop uses `while (true)` — unreachable termination

**File:** `src/engine/backoff.ts:18`
**Issue:** `while (true) yield 30_000;` after the initial schedule is consumed. Callers must terminate by either (a) not calling `.next()` again or (b) the `AbortSignal` interrupting `sleep()` in `drivePoller`. No bug, but a `while (true)` in a generator paired with a pull-consumer is mildly fragile — if a future refactor adds a `for await (const delay of it)` pattern somewhere, it would spin forever.
**Fix:** Add a comment clarifying the contract, or cap the iterator at a large finite count (say, 1440 iterations ≈ 12 hours of 30s polls — more than enough for any job):
```ts
// Cap at 1440 to make accidental for-await consumers eventually exit (~12h of polling).
for (let i = 0; i < 1440; i++) yield 30_000;
```
Very low priority.

---

### IN-08: `transport-parity.test.ts`, `breadcrumb-always.test.ts`, `error-wrapping.test.ts`, `hierarchy.test.ts`, `shot-naming.test.ts` listed in scope but not reviewed in depth

**Issue:** The config file list and `git diff --name-only` both include these five test files as changed, but none were surfaced in the mandatory-read block. They are Phase 1 cross-cutting tests that likely received light Phase 2 touch-ups (e.g., adjusting tool counts or adding version-leaf assertions). A defence-in-depth scan of those changes was not performed.
**Fix:** Not a code issue — a scope note. Either (a) expand the next review pass to include these files explicitly, or (b) if they were touched only for mechanical updates (counts, imports), note the SKIP in the phase SUMMARY.

---

## Architectural Observations (non-blocking)

These observations are not findings per se — they are notes for Phase 3 context.

1. **"Prompt blob is truth" unmet (CLAUDE.md):** Phase 2 stores `workflow_json` via ComfyUI submission but does not persist the resolved prompt blob returned by ComfyUI (with resolved seeds + model paths). The `versions.outputs_json` field contains downloaded-file metadata only. If the "prompt blob is truth" invariant is load-bearing for provenance reconstruction, Phase 3 should add a `versions.prompt_blob` column and a `GET /api/history/{prompt_id}` fetch after `completed`. Current implementation deliberately defers this per phase scope — noting for tracking.

2. **No provenance table yet:** CLAUDE.md mandates "Append-only provenance — Provenance records are never updated or deleted." Phase 2's `versions` row mutates its own status column (submitted → running → completed/failed). This is pragmatic for Phase 2 (the version IS the single generation event), but Phase 3+ may want a separate `provenance_events` append-only audit log.

3. **Drizzle migrator vs `user_version=1` pragma coexist deliberately** (db.ts:42-45). The comment is clear; schema.test verifies the Drizzle migration layer is idempotent. Worth noting that if `SCHEMA_VERSION` bumps to 2 in a future phase, the check at line 32-36 will throw for existing DBs unless the migration-plus-pragma-bump is coordinated. File a "schema version bump playbook" doc before Phase 3 adds migrations.

4. **Duplicated `isUniqueViolation`:** The helper is intentionally duplicated between `hierarchy-repo.ts` and `version-repo.ts` (both files' comments explain). Fine. If a third repo emerges in Phase 3, consider a `src/store/_internal.ts` module — still repo-layer-only, still no cross-repo coupling, but centralizing the SQLite-error detection.

---

_Reviewed: 2026-04-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
