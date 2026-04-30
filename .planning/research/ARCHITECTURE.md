# Architecture Patterns — v1.2 Visual & Conversational Dashboard

**Domain:** subsequent milestone — additive features over a shipped v1.0 + v1.1 codebase
**Researched:** 2026-04-30
**Confidence:** HIGH (codebase ground-truth read for every claim; integration points verified against actual source)

## Recommended Architecture

### Three feature-pillars + the strict boundary they each cross

```
            ┌─────────────────────────────────────────────────────────────────┐
            │                     packages/dashboard (Preact + signals)        │
            │                                                                 │
            │   Project/Shot grid    Folder dropdown    VersionDrawer "Summary"│
            │       │                      │                       │          │
            │       │ <Thumbnail/>         │ <SortControl/>        │ <ConvSum/>│
            │       │ — new component      │ — new component       │ — new    │
            │       ▼                      ▼                       ▼          │
            └───────│──────────────────────│───────────────────────│──────────┘
                    │ HTTP                 │ HTTP query params     │ HTTP
                    │                      │                       │
            ┌───────▼──────────────────────▼───────────────────────▼──────────┐
            │              src/http/dashboard-routes.ts (Hono)                 │
            │   GET .../thumbnail        ?sort=...&order=...   GET .../summary │
            │   HEAD .../thumbnail       (added to existing)                   │
            └───────│──────────────────────│───────────────────────│──────────┘
                    │ delegates            │ delegates             │ delegates
                    ▼                      ▼                       ▼
            ┌──────────────────────────────────────────────────────────────────┐
            │                src/engine/pipeline.ts (Engine facade)            │
            │  generateThumbnail(...)  listShots/listVersions(..., sort)      │
            │  invalidateThumbnail(..)                              summarizeVersion(..)│
            └───────│──────────────────────│───────────────────────│──────────┘
                    │                      │                       │
       ┌────────────▼────┐    ┌────────────▼────┐         ┌────────▼────────┐
       │ src/engine/     │    │ src/store/      │         │ src/engine/     │
       │ thumbnails/     │    │ *-repo.ts       │         │ summary/        │
       │  (NEW MODULE)   │    │  (sort params   │         │  (NEW MODULE)   │
       │                 │    │   added)        │         │                 │
       │ sharp + ffmpeg  │    │                 │         │ @anthropic-ai/sdk│
       │ ATOMIC writes   │    │                 │         │ + cache + JSON  │
       │ via temp+rename │    │                 │         │   schema enforce│
       └─────────────────┘    └─────────────────┘         └─────────────────┘
```

### Component Boundaries

| Component | Responsibility | Communicates With | Layer |
|-----------|---------------|-------------------|-------|
| `src/engine/thumbnails/` (NEW) | Generate, cache, invalidate thumbnails for image + video outputs | `outputRoot` filesystem; `sharp`; `fluent-ffmpeg` | Engine (impure — disk IO + native bindings) |
| `src/engine/summary/` (NEW) | Build conversational summary from prompt blob + ingredient graph + model fingerprints; LLM call; cache | Anthropic SDK (lazy); `provenance-repo` reader; in-memory LRU | Engine (impure — network + cache) |
| `src/store/version-repo.ts` (MODIFIED) | Add optional `sort` param to listByShot | Drizzle ORM | Store (pure-ish — DB only) |
| `src/store/hierarchy-repo.ts` (MODIFIED) | Add optional `sort` param to listShots / listSequences / listProjects | Drizzle ORM | Store |
| `src/http/dashboard-routes.ts` (MODIFIED) | New routes: GET/HEAD `/api/versions/:id/thumbnail`, GET `/api/versions/:id/summary` | Engine facade only | HTTP (no MCP, no SQL) |
| `packages/dashboard/src/components/Thumbnail.tsx` (NEW) | Lazy-load + IntersectionObserver thumbnail with fallback to existing `SkeletonThumbnail` | `lib/api.ts` | Dashboard SPA |
| `packages/dashboard/src/components/SortControl.tsx` (NEW) | Dropdown UI: latest-first default + 4 options + state persistence (localStorage) | `lib/api.ts` query params | Dashboard SPA |
| `packages/dashboard/src/components/ConversationalSummary.tsx` (NEW) | Renders summary; loading skeleton; error state; "regenerate" affordance | `lib/api.ts` | Dashboard SPA |

### Data Flow

**Thumbnail (read-through cache, FS-backed):**
```
Browser <img src=".../thumbnail">
  → HTTP GET /api/versions/:id/thumbnail?w=320
  → Engine.generateThumbnail(versionId, {width: 320})
    → Check outputRoot/<versionId>/.thumbs/<filename>.<w>.webp exists?
       → exists + mtime >= source mtime → stream from disk (304 with ETag = sha256:source_mtime)
       → else → derive from outputRoot/<versionId>/<filename>:
                 - image: sharp(filePath).resize(...).webp().toFile(temp + rename)
                 - video: ffmpeg.thumbnail(filePath).resize(...).toFile(temp + rename)
    → return {filePath, contentType: 'image/webp'}
  → Hono streams bytes with strong ETag + Cache-Control: max-age=31536000, immutable
```

**Sort (engine-side, no client-side memory):**
```
Browser SortControl onChange
  → fetch(`/api/shots/:id/versions?sort=created_at&order=desc&limit=20&offset=0`)
  → Hono validates enum at the boundary (zod-ish, not zod — not on this layer)
  → engine.listVersionsForShot(shotId, limit, offset, opts, {sort, order})
  → version-repo.listByShot(...) returns paginated rows in requested order
  → Browser re-renders. Sort state persisted to localStorage on change.
```

**Conversational Summary (LLM at engine-layer; cache-keyed by manifest_sha256):**
```
Browser opens VersionDrawer
  → fetch(`/api/versions/:id/summary`)
  → Engine.summarizeVersion(versionId)
    → Lookup latest manifest_signed event for this version → manifest_sha256
       → Cache hit (in-memory LRU, manifest_sha256 → text)? → return cached
       → Cache miss:
         → Build structured ground-truth from:
            - prompt_json (the prompt blob — single source of truth for resolved seeds + models)
            - manifest_signed.ingredients_summary (Phase 15 — parent_count, component_count)
            - models_fingerprinted event payload (Phase 13 — primary model + hash)
            - version.diff vs parent (Phase 12 — what changed)
         → Build a structured prompt to Anthropic ("You are a VFX Lead...")
         → ANTHROPIC API CALL (Claude Sonnet 4.5; 2-4 sentence ceiling; structured ground-truth ONLY)
         → Validate response (length, refuses-on-hallucination heuristic)
         → Cache by manifest_sha256
         → ALSO append a `summary_generated` provenance event (audit trail; append-only)
    → return { summary_text, manifest_sha256, generated_at, model: 'claude-sonnet-4-5' }
  → Browser renders. If 503/timeout → show fallback "AI summary unavailable; falling back to node listing"
```

## Patterns to Follow

### Pattern 1: Restricted-import allowed-set guard
**What:** New native/SaaS dependencies (`sharp`, `fluent-ffmpeg`, `@anthropic-ai/sdk`) are restricted to specific files via `architecture-purity.test.ts` — same pattern as v1.1 `c2pa-node` lock at `src/__tests__/architecture-purity.test.ts:190-230`.
**When:** Every new dep that has process-global side effects (native binding, network egress, key material).
**Example (extending the existing test):**
```typescript
// New block — Phase 17 / v1.2 thumbnail purity
it('sharp imports are centralized in src/engine/thumbnails/image-thumbnail.ts', () => {
  const allowedSharpImporters = new Set<string>([
    'src/engine/thumbnails/image-thumbnail.ts',
  ]);
  const out = execFileSync('grep', ['-rlE',
    "from[[:space:]]*['\"]sharp|import[[:space:]]*\\([[:space:]]*['\"]sharp",
    'src/'], { encoding: 'utf8' });
  const violators = out.trim().split('\n').filter(Boolean)
    .filter(f => !f.includes('__tests__/'))
    .filter(f => !allowedSharpImporters.has(f));
  expect(violators).toEqual([]);
});

// Same shape for fluent-ffmpeg → src/engine/thumbnails/video-thumbnail.ts
// Same shape for @anthropic-ai/sdk → src/engine/summary/anthropic-client.ts
```

### Pattern 2: Lazy-import for native + network deps
**What:** `sharp`, `fluent-ffmpeg`, `@anthropic-ai/sdk` use `await import('...')` lazy form so server boot succeeds even when the native binding is missing or the API key is unset. Identical pattern to `c2pa-node` lazy load at Phase 14 (Concern #11 — boot resilience).
**When:** Anything that can fail at module-load time (native bindings) or that should fail soft (missing API key for AI summary).
**Example:**
```typescript
// src/engine/summary/anthropic-client.ts
let cachedClient: Anthropic | null = null;
let cachedClientFailedReason: { code: 'api_key_missing' | 'sdk_load_failed'; msg: string } | null = null;

export async function getAnthropicClient(): Promise<Anthropic | null> {
  if (cachedClient) return cachedClient;
  if (cachedClientFailedReason) return null; // monotonic fail
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    if (!process.env.ANTHROPIC_API_KEY) {
      cachedClientFailedReason = { code: 'api_key_missing', msg: 'ANTHROPIC_API_KEY not set' };
      return null;
    }
    cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return cachedClient;
  } catch (err) {
    cachedClientFailedReason = { code: 'sdk_load_failed', msg: String(err) };
    return null;
  }
}
```

### Pattern 3: Atomic disk writes via temp + rename
**What:** Thumbnails written via `mkstemp → rename` so a half-written WebP cannot be served by a concurrent reader. Same pattern as Phase 14 download (`output-downloader.ts`) and Phase 16 redact (`asset-writer-mutex`).
**When:** Any cache or asset that another reader can race on.
**Example:**
```typescript
const tempPath = `${cachePath}.${nanoid()}.partial`;
await sharp(sourcePath).resize(width, height, { fit: 'inside' }).webp({quality: 80}).toFile(tempPath);
await rename(tempPath, cachePath);
```

### Pattern 4: Per-(versionId, filename) mutex for derivative outputs
**What:** Concurrent thumbnail requests for the same key COALESCE on a single in-flight Promise; different keys run in parallel. Direct copy of `signMutex` at `src/engine/pipeline.ts:288-291`. Use same shape for `thumbnailMutex`.
**When:** Any expensive derivative computation that's content-addressed (compute once, share result).
**Why this and not the asset-writer mutex:** The asset-writer mutex (`assetWriterMutex` at Plan 16-02) is FIFO-serializing because sign and redact MUST NOT interleave. Thumbnail generation is pure derivation from immutable bytes — coalescing is correct (and faster).

### Pattern 5: ETag = `sha256:<source_mtime>`
**What:** Thumbnail ETag is the SHA-256 of the source asset's mtime (or, better, the `outputs_json[0].sha256` field if present). When the source changes (e.g., Phase 16 redact rewrote the bytes), the ETag changes and the browser re-fetches.
**When:** Any cached resource whose freshness depends on a source file that can change.
**Why not the file mtime alone:** A weak validator. Conditional GET (304 Not Modified) needs a strong validator for the `Cache-Control: immutable` window to be safe.

### Pattern 6: LLM ground-truth is structured provenance, not the prompt blob string
**What:** The Anthropic call receives a *structured object* with fields like `{ primary_model, parent_version, what_changed: ['seed', 'lora_weight'], cinematic_descriptors }`. NOT the raw prompt JSON. This anchors the LLM to verified facts and prevents hallucination.
**When:** Any LLM-generated text that purports to describe deterministic technical artifacts.
**Example structured prompt skeleton:**
```typescript
const groundTruth = {
  version_label: version.label, // 'v003'
  shot_name: breadcrumb.shot.name,
  primary_model: { name: 'flux-dev', hash: 'abc12...' },
  loras: [{ name: 'cinematic_fantasy', weight: 0.85 }],
  parent: { label: 'v002', what_changed: ['seed', 'sampler_steps'] },
  components: [{ kind: 'controlnet_image', source: 'parent_shot_hdri.exr' }],
  prompt_text_truncated: prompt_blob.positive.slice(0, 200),
  seed: 42, sampler: 'euler', steps: 30,
};
const llmPrompt = `You are a VFX Supervisor describing a render in 2-4 sentences for the artist's shot review. Use ONLY these facts: ${JSON.stringify(groundTruth)}. NEVER invent details. NEVER reference facts not in the JSON.`;
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Generate-on-write thumbnails (eager)
**What:** Generate thumbnails at the moment Phase 14 download completes.
**Why bad:** Adds latency to the hot generation-completion path; couples thumbnails to the C2PA signing chain (already at the edge of the latency budget); thumbnails for legacy versions never get generated. Also forces an architecture-purity exception in `output-downloader.ts` that we'd then have to extend.
**Instead:** Generate-on-demand at the HTTP route boundary, cache to disk, serve subsequent requests instantly. The first dashboard view of a version pays the ~50–200 ms cost; every subsequent view is a 304.

### Anti-Pattern 2: Client-side sort
**What:** Fetch all versions for a shot, sort in the browser.
**Why bad:** Existing pagination is `limit=20`, default. A shot with 200 versions would need 10 round-trips to "sort by latest". Defeats pagination. Also breaks if the artist scrolls — newer items may not be in the loaded set.
**Instead:** Engine-side `ORDER BY` with a SQL-injection-safe enum whitelist. The repo already uses `ORDER BY version_number DESC` for one path (`version-repo.ts:216`); generalize.

### Anti-Pattern 3: Anthropic API call on every dashboard render
**What:** No cache; every VersionDrawer open hits the API.
**Why bad:** Cost, latency (typical 1–3 s end-to-end for a 4-sentence Sonnet call), rate-limit exposure during demo.
**Instead:** Cache by `manifest_sha256`. The manifest hash IS the content-addressing key — when bytes change (e.g., Phase 16 redact rewrote them), `manifest_sha256` changes, cache misses, summary regenerates. Free invalidation.

### Anti-Pattern 4: Storing the LLM summary in a new SQL column on `versions`
**What:** `ALTER TABLE versions ADD COLUMN summary_text TEXT`.
**Why bad:** (a) Versions are write-once-then-immutable in spirit (the prompt-blob-is-truth invariant); adding a mutable field is a regression. (b) Re-generating summaries (e.g., model upgrade from Sonnet 4 → 5) would need an UPDATE, breaking the spirit of provenance immutability. (c) Couples summary lifecycle to version lifecycle.
**Instead:** Use append-only provenance — emit a `summary_generated` event with payload `{manifest_sha256, summary_text, model: 'claude-sonnet-4-5', generated_at, prompt_template_version}`. The latest event for a `manifest_sha256` is the current summary; old events are the audit trail of how summary text evolved. Engine.summarizeVersion reads the latest matching event before falling back to a new LLM call.

### Anti-Pattern 5: AI summary as a new MCP tool
**What:** Add `version.summarize` action to the version tool.
**Why bad:** The summary is a UX surface for human readers in the dashboard. Agents calling MCP get the *raw structured provenance* — they're better off with the prompt JSON + ingredient graph + model fingerprints than a 4-sentence English paraphrase. Adding the tool action also bloats the 7-of-12 cap envelope.
**Instead:** The summary is HTTP-only (`GET /api/versions/:id/summary`). If a future agent use case emerges (e.g., "VFX Familiar describing my shot in voice"), revisit then. Tool count holds at 7/12.

## Scalability Considerations

| Concern | At 100 versions | At 10K versions | At 100K+ versions (production studio) |
|---------|-----------------|-----------------|---------------------------------------|
| Thumbnail disk usage | ~3 MB (30 KB × 100) | ~300 MB | LRU eviction policy (delete `.thumbs/` entries with mtime > 90 days untouched) |
| Thumbnail generation latency on first view | ~50–200 ms | same per-version | Same — generate-on-demand isolates each request |
| Sort performance on large shots | trivial | needs `idx_versions_completed_at` index | Already have `idx_versions_status` (Phase 2 migration 0002); add a composite `(shot_id, completed_at DESC)` for the new sort |
| LLM summary cost (Sonnet 4.5, ~500 input tokens, ~150 output) | ~$0.005 per uncached call | ~$0.01 average (high cache hit rate) | Cache pin to manifest_sha256 means cost is ~one-shot per actual generation, not per view |
| Anthropic rate limit (50 RPM default) | non-issue | non-issue | Set per-IP queue or fall back to "summary cooling — try in 60 s" message |

## Component-by-Component Specification

### Engine layer (impure — IO + network + native)

#### `src/engine/thumbnails/index.ts` (NEW — barrel export)
- Re-exports `generateThumbnail`, `invalidateThumbnail`, types
- Mirrors `src/engine/c2pa/index.ts` shape

#### `src/engine/thumbnails/image-thumbnail.ts` (NEW)
- **Pure?** No — disk read + sharp native binding
- **Lazy import:** `const sharp = (await import('sharp')).default`
- **Single function:** `generateImageThumbnail(sourcePath: string, destPath: string, opts: {width: number}): Promise<void>`
- **Atomic write:** temp + rename
- **Error contract:** TypedError('THUMBNAIL_FAILED', reason, recovery)

#### `src/engine/thumbnails/video-thumbnail.ts` (NEW)
- **Pure?** No — fluent-ffmpeg spawn
- **Lazy import:** `const ffmpeg = (await import('fluent-ffmpeg')).default`
- **Single function:** `generateVideoThumbnail(sourcePath: string, destPath: string, opts: {width: number, atSeconds?: number}): Promise<void>` — defaults to frame at 1.0s
- **Atomic write:** temp + rename
- **Error contract:** TypedError('THUMBNAIL_FAILED', reason, recovery)

#### `src/engine/thumbnails/format-router.ts` (NEW)
- **Pure?** Yes — pure function
- **Single function:** `routeThumbnailFormat(extension: string): 'image' | 'video' | 'unsupported'`
- Mirrors `src/engine/c2pa/format-router.ts` shape

#### `src/engine/thumbnails/cache.ts` (NEW)
- **Pure?** No — disk stat
- **Functions:**
  - `getCachePath(outputRoot, versionId, filename, width): string` — pure
  - `isCacheFresh(cachePath: string, sourcePath: string): Promise<boolean>` — compares mtimes
  - `computeETag(sourcePath: string): Promise<string>` — `sha256:${mtime}`
- Path: `outputRoot/<versionId>/.thumbs/<filename>.<width>.webp`

#### `src/engine/summary/index.ts` (NEW — barrel)
#### `src/engine/summary/anthropic-client.ts` (NEW)
- **Lazy import:** `@anthropic-ai/sdk`
- **Process-global cache** (load once)
- **Returns null on fail** (graceful degradation pattern, mirrors c2pa lazy-load at pipeline.ts)

#### `src/engine/summary/ground-truth-builder.ts` (NEW)
- **Pure?** Yes — takes provenance + version + diff, returns structured object
- **Inputs:** Version row, latest provenance events (manifest_signed, models_fingerprinted), parent diff result, breadcrumb
- **Output:** typed `SummaryGroundTruth` object
- **No LLM call here** — separation of "prepare facts" from "render facts"

#### `src/engine/summary/prompt-template.ts` (NEW)
- **Pure?** Yes
- **Function:** `buildSupervisorPrompt(groundTruth: SummaryGroundTruth, templateVersion: 'v1'): string`
- **Versioned templates** so future tweaks don't silently invalidate cache (cache key includes template version)

#### `src/engine/summary/cache.ts` (NEW)
- **Pure?** No — in-memory LRU
- **Lib:** vendor-in or `lru-cache` (~3 KB; trivial)
- **Key:** `${manifest_sha256}::${template_version}::${model_id}`
- **Value:** `{summary_text, generated_at}`
- **Capacity:** 1000 entries (~1 MB)

#### `src/engine/summary/summarizer.ts` (NEW)
- **Pure?** No — orchestrates LLM call
- **Function:** `summarizeVersion(deps, versionId): Promise<SummaryResult>`
- **Order:** check provenance summary_generated event → check in-memory LRU → build ground truth → call Anthropic → validate output → write provenance event → write LRU → return

#### `src/engine/pipeline.ts` (MODIFIED — Engine facade additions)
- New methods (composed delegations to the new modules):
  - `Engine.generateThumbnail(versionId: string, opts: {width: number}): Promise<{filePath, contentType, etag}>`
  - `Engine.invalidateThumbnail(versionId: string, filename: string): Promise<void>` — called from `output-downloader.ts` post-redact (and post-download as a no-op no-cache-yet)
  - `Engine.summarizeVersion(versionId: string): Promise<{summary_text, manifest_sha256, generated_at, model_id}>`
- `listVersionsForShot` signature extended with optional `sort: {field: 'version_number' | 'created_at' | 'completed_at' | 'name'; order: 'asc' | 'desc'}` param (defaults to `{field: 'version_number', order: 'desc'}` — preserves existing behavior).
- Same for `listShots`, `listSequences`, `listProjects` on `HierarchyRepo`.

#### `src/engine/output-downloader.ts` (MODIFIED — invalidation hook)
- After Phase 14 sign-in-place rewrite, call `engine.invalidateThumbnail(versionId, filename)` (NEW — added via the existing `EngineForC2pa` structural Pick, extended).
- Also called from Phase 16 `redaction.ts` after the atomic byte rewrite. The redaction flow already serializes via `assetWriterMutex` — invalidation is just an `unlink` of the cache entry (or a flag-bump in source mtime).

### Store layer (pure SQL)

#### `src/store/version-repo.ts` (MODIFIED)
- Add optional `sort` param to `listByShot(shotId, limit, offset, opts, sort?)`
- Whitelist enum at the function boundary — `version_number | created_at | completed_at | name` × `asc | desc`
- Default unchanged: `version_number DESC` (preserves current contract)
- New SQL: `ORDER BY ${field} ${order}, id DESC` (id tiebreaker for stable pagination)

#### `src/store/hierarchy-repo.ts` (MODIFIED)
- Same enum whitelist applied to `listShots`, `listSequences`, `listProjects`
- Default unchanged: `created_at ASC` (preserves current contract — but the dashboard SortControl sets it to `created_at DESC` for the latest-first artist UX)

#### `src/store/provenance-repo.ts` (MODIFIED)
- New method: `appendSummaryGeneratedEvent(versionId, payload)`
- Payload shape: `{manifest_sha256, summary_text, model_id, prompt_template_version, generated_at}`
- New method: `getLatestSummaryEvent(versionId, manifest_sha256, template_version, model_id): SummaryEvent | null`
- **Append-only invariant preserved** — only adds INSERT statements

### HTTP layer (no MCP, no SQL)

#### `src/http/dashboard-routes.ts` (MODIFIED)
- New route: `GET /api/versions/:id/thumbnail?w=320`
  - Width whitelist: 80, 160, 320, 640 (4 sizes — covers tree icon, card, drawer, future fullscreen)
  - Conditional GET via If-None-Match → 304
  - Cache-Control: `public, max-age=31536000, immutable` (ETag invalidates correctly)
  - Default Content-Type: `image/webp`
  - Error: 404 if source missing; 415 if format unsupported (EXR/PSD before native ffmpeg/sharp support)
- New route: `HEAD /api/versions/:id/thumbnail?w=320` — same headers, no body (for prefetch checks)
- New route: `GET /api/versions/:id/summary`
  - JSON: `{summary_text: string, manifest_sha256: string, generated_at: string, model_id: string, template_version: string}`
  - 503 with retry-after if Anthropic unavailable; client falls back to node listing
  - Cache-Control: `public, max-age=300, must-revalidate` (5 min — content rarely changes mid-session)
- Existing routes (sort param added):
  - `GET /api/shots/:id/versions?sort=...&order=...`
  - `GET /api/sequences/:id/shots?sort=...&order=...`
  - `GET /api/projects/:id/sequences?sort=...&order=...`
  - `GET /api/workspaces/:id/projects?sort=...&order=...`

### MCP tool layer (NO new tools, NO new actions — analyzed below)

**Recommendation: zero MCP changes.**

Considered: adding `version.summary` action.

Verdict: **don't.** Three reasons:
1. **Tool surface staying lean.** v1.1 went from 4 to 7 actions on the version tool. Holding at 7 is a feature.
2. **Agent UX.** Agents ARE NOT the audience for the conversational summary. Agents read structured provenance. The summary is for human eyes in a dashboard. Adding the action mostly serves to inflate dual-transport parity tests for negative ROI.
3. **Future opt-in.** If a real agent use case emerges (e.g., "Familiar, describe my last 5 shots in voice"), it's a one-day add. Optionality preserved by *not* adding it now.

Sort: also no MCP impact. The MCP `version.list` action already returns versions in `version_number DESC` (verified at `version-repo.ts:216`). Default behavior unchanged. If a future use case wants other sorts on the agent path, opt-in optional `sort` param trivially.

Thumbnails: also no MCP impact. Thumbnails are a dashboard concern. Agents have no need.

### Dashboard layer (Preact + signals + Tailwind v4)

#### `packages/dashboard/src/components/Thumbnail.tsx` (NEW)
- **Pure component**: props `{versionId, filename, width: 80 | 160 | 320 | 640, alt?}`
- **IntersectionObserver** for lazy load (don't fetch thumbnails outside the viewport)
- **Fallback to existing `SkeletonThumbnail`** while loading
- **Error fallback** to a small "no preview" SVG icon
- Bundle impact: ~1.5 KB

#### `packages/dashboard/src/components/SortControl.tsx` (NEW)
- **Dropdown UI:** lucide-preact ChevronDown icon (already in deps)
- **Options:** Latest first (default), Oldest first, Version (high → low), Version (low → high), Name (A → Z), Modified (recent first)
- **State:** signal-backed; persisted to `localStorage[`vfx_familiar.sort.${entityType}`]`
- **Bundle impact:** ~2 KB

#### `packages/dashboard/src/components/ConversationalSummary.tsx` (NEW)
- **Prop:** `{versionId}`
- **States:** loading skeleton, success (rendered prose), error (fallback to existing node listing), regenerate button
- **No streaming** v1.2 — simple request/response. (Streaming is a v1.3 nicety.)
- **Bundle impact:** ~2 KB

#### `packages/dashboard/src/lib/api.ts` (MODIFIED)
- New: `fetchThumbnailUrl(versionId, width): string` (just builds the URL — no fetch, used in `<img src=>`)
- New: `fetchVersionSummary(versionId): Promise<SummaryResponse>`
- Modified: existing list functions accept optional `{sort, order}` — pass through as query params

#### Dashboard views (MODIFIED)
- `views/HomeView.tsx`: project cards now show `<Thumbnail/>` from latest completed version of the most-recent shot; sortable shot listing
- `views/VersionDrawer.tsx`: replace existing summary section with `<ConversationalSummary/>` (existing node-listing remains as the fallback when summary is unavailable)
- `components/TreeSidebar.tsx`: add `<SortControl/>` at each level (workspaces, projects, sequences, shots, versions)

## Persistence Schema Changes

### Drizzle migrations: ONE new file

#### `drizzle/0007_phase17_summary_event.sql` (NEW)

```sql
-- Phase 17 (v1.2 SUMM-AI) — append nullable `summary_generated_json` column
-- to provenance carrying the per-event JSON payload of the new
-- 'summary_generated' event_type. Mirrors Phase 14's manifest_signed_json
-- column shape (migration 0006). The event_type column has no CHECK
-- constraint so 'summary_generated' is purely TS-level discrimination.
-- Pre-Phase-17 rows read NULL here.
--
-- Append-only invariant preserved — ProvenanceRepo continues to expose
-- only INSERTs through the new appendSummaryGeneratedEvent method.
ALTER TABLE `provenance` ADD `summary_generated_json` text;
```

That's it. ONE migration. ONE column. Zero new tables.

### Why no new column on `versions`
- Versions are immutable-in-spirit; the prompt blob is truth (CLAUDE.md invariant). Adding mutable text fields is a regression.
- Summary is not a property of the version — it's a derived rendering of the provenance trail. The right home is provenance.

### Why no new tables
- Thumbnails: filesystem cache (FS is fine; we never need to query "all thumbnails by tag"). Disk is the storage.
- Sort: zero schema change — pure ORDER BY parameterization.
- Summary: append-only event row, payload in the new column. Zero new tables.

### What about a thumbnail metadata index?
- **Considered:** SQLite table mapping `(version_id, filename, width) → cache_path`.
- **Rejected:** the cache path is deterministic (`outputRoot/versionId/.thumbs/filename.width.webp`); the index would just duplicate `path.join`. Disk's `existsSync` answers freshness. KISS.

## Architecture-Purity Allowed-Set Extensions

### `src/__tests__/architecture-purity.test.ts` additions

Add four blocks (one per new dependency lock):

```typescript
// ================================================================
// v1.2 — Thumbnail module purity (SUMM-VIZ).
// sharp imports are restricted to image-thumbnail.ts only.
// fluent-ffmpeg imports are restricted to video-thumbnail.ts only.
// ================================================================

it('sharp imports are centralized in src/engine/thumbnails/image-thumbnail.ts', () => {
  const allowed = new Set(['src/engine/thumbnails/image-thumbnail.ts']);
  // grep -rlE for static `from 'sharp'` and dynamic `import('sharp')`
  // ... pattern copy from c2pa-node centralization at line 166-231 ...
});

it('fluent-ffmpeg imports are centralized in src/engine/thumbnails/video-thumbnail.ts', () => {
  const allowed = new Set(['src/engine/thumbnails/video-thumbnail.ts']);
  // ... same pattern
});

it('src/engine/thumbnails/ has zero MCP / SQLite / drizzle / hono imports', () => {
  expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/thumbnails/')).toBe(0);
  expect(grepCount('better-sqlite3', 'src/engine/thumbnails/')).toBe(0);
  expect(grepCount('drizzle-orm', 'src/engine/thumbnails/')).toBe(0);
  expect(grepCount('@hono/node-server', 'src/engine/thumbnails/')).toBe(0);
});

// ================================================================
// v1.2 — Summary module purity (SUMM-AI).
// @anthropic-ai/sdk imports are restricted to anthropic-client.ts only.
// ================================================================

it('@anthropic-ai/sdk imports are centralized in src/engine/summary/anthropic-client.ts', () => {
  const allowed = new Set(['src/engine/summary/anthropic-client.ts']);
  // ... same allowed-set centralization pattern
});

it('src/engine/summary/ has zero MCP / SQLite / drizzle / hono imports', () => {
  expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/summary/')).toBe(0);
  expect(grepCount('better-sqlite3', 'src/engine/summary/')).toBe(0);
  expect(grepCount('drizzle-orm', 'src/engine/summary/')).toBe(0);
  expect(grepCount('@hono/node-server', 'src/engine/summary/')).toBe(0);
});

// Pure files — no native binding, no SDK
it('src/engine/summary/ground-truth-builder.ts is pure', () => {
  expect(grepCount('@anthropic-ai/sdk', 'src/engine/summary/ground-truth-builder.ts')).toBe(0);
  // ... etc
});

it('src/engine/summary/prompt-template.ts is pure', () => {
  expect(grepCount('@anthropic-ai/sdk', 'src/engine/summary/prompt-template.ts')).toBe(0);
});

it('src/engine/summary/cache.ts is pure (no @anthropic-ai/sdk)', () => {
  expect(grepCount('@anthropic-ai/sdk', 'src/engine/summary/cache.ts')).toBe(0);
});
```

### Why centralized lock matters
The c2pa-node lock at lines 166-231 has prevented at least three accidental "reach across the boundary" bugs since v1.1 phase 14. Same value here — `sharp` and `fluent-ffmpeg` have native binding load failures that should NOT crash the server boot, and `@anthropic-ai/sdk` has a network egress pattern that should NEVER reach the HTTP routes layer (where it would cascade into auth/secret leakage risks).

## Dual-Transport Implications

| Feature | Stdio (MCP agent) | HTTP (browser) | Parity required? |
|---------|-------------------|----------------|------------------|
| Thumbnails | N/A — agents don't need thumbnails | GET /api/versions/:id/thumbnail | NO (HTTP-only) |
| Sort | Existing `version.list` already sorts by version_number DESC; optionally extend with `sort` param later | Existing list routes get `sort` param now | YES eventually, but v1.2 ships HTTP-only sort. Existing MCP behavior unchanged. |
| Summary | Skipped per analysis above (no MCP action) | GET /api/versions/:id/summary | NO (HTTP-only) |

**Net new dual-transport parity tests: zero.** All three features are dashboard-facing. The architecture-purity guard ensures the ENGINE layer remains MCP-callable — if a future v1.3 needs to expose `version.summary` via MCP, the engine method already exists; just add the tool action wrapper.

## Cache Invalidation Story (Critical)

### Thumbnail invalidation on byte-change

The Phase 16 redaction flow (`src/engine/c2pa/redaction.ts`) writes new bytes to `outputRoot/<versionId>/<filename>` via the asset-writer mutex. The thumbnail cache for `(versionId, filename, *)` becomes stale.

**Solution: add invalidation hook at the redaction call site.**

```typescript
// In src/engine/pipeline.ts redactManifest method, after the redaction.ts
// atomic-rename completes:
await this.invalidateThumbnail(versionId, filename);
```

Where `invalidateThumbnail` is:
```typescript
async invalidateThumbnail(versionId: string, filename: string): Promise<void> {
  const thumbDir = path.join(this.outputRoot, versionId, '.thumbs');
  const widths = [80, 160, 320, 640];
  for (const w of widths) {
    const cachePath = path.join(thumbDir, `${filename}.${w}.webp`);
    await unlink(cachePath).catch(() => {/* missing is fine */});
  }
}
```

**Why not "just check mtime":** Faster + simpler. Hot path is the read; the invalidation is on the cold redact path (rare). Outright deletion + lazy regeneration on next view = correct + cheap.

### Summary invalidation on manifest_sha256 change

Free — the cache key IS `manifest_sha256`. When Phase 16 redact emits a new manifest, the manifest_sha256 changes (different bytes), the cache key changes, summary regenerates on next view. Zero invalidation code needed.

## Build Order

### Phase 17 — Visual Thumbnails (simplest, zero new SaaS deps)
1. Add `sharp` + `fluent-ffmpeg` to `package.json` dependencies
2. `src/engine/thumbnails/{format-router, cache, image-thumbnail, video-thumbnail, index}.ts`
3. Engine facade additions: `generateThumbnail`, `invalidateThumbnail`
4. HTTP routes: GET/HEAD `/api/versions/:id/thumbnail`
5. Architecture-purity allowed-set extension
6. Dashboard `<Thumbnail/>` component + integration into Project/Shot cards
7. Invalidation hook into Phase 16 redaction path
8. Tests: thumbnail-generation purity, atomic write under concurrent load, conditional GET / 304 path, cache invalidation on byte-change

**Build effort:** ~3 days. Lowest risk — no LLM, no new SaaS, sharp + ffmpeg are battle-tested.

### Phase 18 — Sortable Folder Dropdown (mostly UI)
1. Repo `sort` param additions (version-repo, hierarchy-repo) with enum whitelist
2. Engine facade pass-through
3. HTTP route query-param wire-up
4. Dashboard `<SortControl/>` component + localStorage persistence
5. Composite `(shot_id, completed_at DESC)` index migration if profiling shows the need
6. Tests: SQL injection guard at the enum boundary, default-preserves-existing-behavior

**Build effort:** ~2 days. Mostly UI work + thin engine API tweaks.

### Phase 19 — AI Conversational Summary (highest complexity)
1. Add `@anthropic-ai/sdk` to dependencies
2. `src/engine/summary/{anthropic-client, ground-truth-builder, prompt-template, cache, summarizer, index}.ts`
3. Drizzle migration 0007 — `summary_generated_json` column on provenance
4. Engine facade addition: `summarizeVersion`
5. HTTP route: GET `/api/versions/:id/summary`
6. Architecture-purity allowed-set extension
7. Dashboard `<ConversationalSummary/>` component
8. Tests: ground-truth builder purity, cache key correctness, fallback on Anthropic 503, summary-event-as-audit-trail invariant, prompt template versioning bumps cache key

**Build effort:** ~4 days. Highest risk — LLM integration, validation harness for "did the model hallucinate?", cost monitoring scaffolding.

**Recommended phase order:** 17 → 18 → 19. This puts the easy win (visual thumbnails) first to derisk the milestone, the architectural-mostly-trivial sort second, and the LLM integration last so a slip on summary doesn't block the rest of the visual UX from shipping.

## Integration Points with v1.1 Outputs (Verified)

| v1.1 Output | v1.2 Consumer | Verification |
|-------------|---------------|--------------|
| `manifest_signed.manifest_sha256` (Phase 14, payload field on provenance event) | Summary cache key | `src/types/provenance.ts:62` declares `manifest_sha256?: string \| null` on `ManifestSignedPayloadFields` — confirmed |
| `manifest_signed.ingredients_summary` (Phase 15) | Ground truth builder for summary (parent_count, component_count, input_assertion) | `src/types/provenance.ts:72` declares `ingredients_summary?: {...}` — confirmed |
| `models_fingerprinted` event (Phase 13) | Ground truth — primary model name + SHA-256 hash | `derivePrimaryModel` already exists at `src/engine/pipeline.ts:127` — pattern to follow |
| Phase 16 atomic disk write semantics | Thumbnail invalidation must hook the redact path | `src/engine/c2pa/redaction.ts` is the hook site; the asset-writer mutex serializes; invalidation goes after rename |
| Phase 14 `output-downloader.ts` atomic-rename pattern | Template for thumbnail atomic-rename | Direct copy of `mkstemp → rename` shape |
| Phase 14 `signMutex` coalescing pattern | Template for `thumbnailMutex` (same coalescing semantics) | Copy of `Map<string, Promise<...>>` at `src/engine/pipeline.ts:288-291` |

## Sources

- `/Users/macapple/comfyui-vfx-mcp/CLAUDE.md` — architecture rules
- `/Users/macapple/comfyui-vfx-mcp/.planning/PROJECT.md` — milestone context, v1.1 shipped surfaces
- `/Users/macapple/comfyui-vfx-mcp/src/engine/pipeline.ts` — Engine facade, signMutex template, EngineForC2pa pattern
- `/Users/macapple/comfyui-vfx-mcp/src/__tests__/architecture-purity.test.ts` — c2pa-node allowed-set lock at lines 166-231 (template for new locks)
- `/Users/macapple/comfyui-vfx-mcp/src/http/dashboard-routes.ts` — Hono route shape, HEAD pattern, output-streaming pattern
- `/Users/macapple/comfyui-vfx-mcp/src/engine/output-downloader.ts` — atomic write template, EngineForC2pa structural pick
- `/Users/macapple/comfyui-vfx-mcp/src/engine/c2pa/index.ts` — barrel-export pattern for new engine modules
- `/Users/macapple/comfyui-vfx-mcp/src/store/version-repo.ts:216,237` — existing ORDER BY usage
- `/Users/macapple/comfyui-vfx-mcp/src/store/hierarchy-repo.ts:83-297` — existing default sort (created_at ASC)
- `/Users/macapple/comfyui-vfx-mcp/drizzle/0006_phase14_manifest_signed_event.sql` — migration shape template for 0007
- `/Users/macapple/comfyui-vfx-mcp/packages/dashboard/src/components/SkeletonThumbnail.tsx` — existing placeholder (already shipped, ready to be powered by `<Thumbnail/>`)
- `/Users/macapple/comfyui-vfx-mcp/src/types/provenance.ts:62-72` — manifest_sha256 + ingredients_summary fields confirmed available
