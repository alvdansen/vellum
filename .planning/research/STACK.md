# Stack Research — v1.2 Visual & Conversational Dashboard

**Domain:** Subsequent-milestone additions to existing TypeScript ESM Node MCP server + Preact dashboard
**Researched:** 2026-04-30
**Confidence:** HIGH

> **Scope discipline.** This document only specifies *new* dependencies for v1.2. The base stack
> (`@modelcontextprotocol/sdk`, Hono, better-sqlite3, Drizzle, Zod v4, Preact, Tailwind v4, c2pa-node)
> is locked from v1.0/v1.1 and is **not** re-researched here. See `CLAUDE.md` and `package.json` for
> the existing surface. The prior v1.0 STACK.md (researched 2026-04-15) is superseded by this file.

---

## Recommended Stack Additions

### Core New Dependencies (server-side engine layer)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@anthropic-ai/sdk` | `^0.92.0` | LLM SDK for AI-generated conversational asset summary (feature 3) | First-party Anthropic TypeScript SDK; **declares `peerDependencies: { zod: '^3.25.0 \|\| ^4.0.0' }`** — clean fit with project's Zod v4 (no peer-dep storm); ESM-native; supports prompt caching, streaming, tool use, message batches. Project owner uses Claude Code, so credential plumbing is already in their workflow. |
| `sharp` | `^0.34.5` | Server-side image resize for thumbnail pipeline (feature 1: PNG/JPEG/WebP/TIFF/GIF) | Industry-standard libvips binding; **30x faster than jimp**; ships pre-compiled platform binaries via `@img/sharp-{platform}` optional deps (no system libvips required); native AVIF support (matches v1.1 supported formats); engines `>=20.3.0` aligns with project `>=20`. |
| `@ffmpeg-installer/ffmpeg` | `^1.1.0` | First-frame extraction from MP4 outputs (feature 1: video thumbnails) | **Critical license decision** — `@ffmpeg-installer/ffmpeg` is **LGPL-2.1** (separate-process invocation = compatible with MIT). The popular `ffmpeg-static@5.x` is **GPL-3.0-or-later** which would virally relicense an MIT project. Same per-platform optional-deps architecture as sharp. Used as a sibling subprocess (not linked) — invoked once per MP4 ingest, output piped back into sharp for the actual resize. |

**No client-side new dependencies.** Sorting (feature 2) uses native `Array.prototype.sort` + existing `@preact/signals` for state; persistence uses `localStorage` via a thin custom hook. No `lodash`, no `zustand`, no `mobx`. The dashboard's ~38.55 kB JS budget is preserved.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (existing) `nanoid` | `^5.1.9` | Thumbnail filename component if we choose UUID-style sidecar names | Use only if thumbnails are written under a separate `thumbnailsDir` with non-derivable names. Simpler path: derive `<filename>.thumb.webp` from the source filename — no new ID generation needed. |
| (existing) `@preact/signals` | `^2.9.0` | Sort-state and user-preference reactivity in dashboard | Already shipped. Add a `signal('latest')` for sort mode and persist-on-change via a `useEffect`-style subscribe. Zero new deps. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `vitest` (existing) | Unit + integration tests | Mock the Anthropic SDK with `vi.mock('@anthropic-ai/sdk')` returning a deterministic 2-4 sentence stub. Tests must NOT make real API calls (cost + flakiness). One opt-in live-smoke test gated on `RUN_LIVE_LLM=1` — same pattern as the existing `RUN_LIVE_COMFY` smoke tests. |
| `tsx` (existing) | Dev server runner | No change. |

---

## Installation

```bash
# Server-side engine layer additions (root package.json)
npm install @anthropic-ai/sdk@^0.92.0 sharp@^0.34.5 @ffmpeg-installer/ffmpeg@^1.1.0

# No new dev dependencies required.
# No new dashboard dependencies required.
```

After install, expect the lockfile to grow by:
- `@anthropic-ai/sdk` — 1 direct, ~3 transitive (`json-schema-to-ts` + a couple of Anthropic-internal helpers)
- `sharp` — 1 direct, ~25 *optional* platform binaries (only your platform's binary actually downloads); 3 small transitive (`semver`, `@img/colour`, `detect-libc`)
- `@ffmpeg-installer/ffmpeg` — 1 direct, 1 platform-optional binary (~75 MB on disk for your platform's ffmpeg)

**Total disk footprint added:** ~80 MB on macOS arm64 (mostly the ffmpeg binary). Acceptable for a desktop dev tool; revisit if we ever ship a slim Docker image.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@anthropic-ai/sdk` (Anthropic) | `openai` SDK + GPT-4o-mini | Only if the project explicitly diversifies away from a single LLM vendor. Pricing is similar ($0.15/$0.60 per MTok for 4o-mini vs $1/$5 for Haiku 4.5), but Haiku 4.5 is markedly stronger on grounded summarization tasks where the prompt blob is the source of truth. Also: project owner is on Claude Code, so the credential and operational story is already understood. **Reject for v1.2.** |
| `@anthropic-ai/sdk` | Local model via `@xenova/transformers` or `node-llama-cpp` | Only if regulatory/air-gap constraints rule out cloud LLM calls. Adds ~2-4 GB of model weights and 5-20s latency per summary on consumer hardware. The grounded-summary task doesn't need frontier capability — but it also doesn't justify the operational cost of shipping local inference. **Reject for v1.2; keep as v1.4+ option for offline mode.** |
| `sharp` | `jimp` (pure-JS) | If the deployment target genuinely cannot run native binaries (extremely rare for Node 20+; libvips is now wasm-fallback-capable via `@img/sharp-wasm32`). Jimp is ~30x slower and lacks AVIF. **Reject.** |
| `sharp` | `@squoosh/lib` | Squoosh has been in maintenance-only mode since 2023 with no Node 20+ guarantees. **Reject.** |
| `@ffmpeg-installer/ffmpeg` | `ffmpeg-static@^5` | **DO NOT USE.** GPL-3.0-or-later. License-viral against this project's MIT license. |
| `@ffmpeg-installer/ffmpeg` | System `ffmpeg` (assume on PATH) | Acceptable for self-hosted deployments where the operator can install ffmpeg. Adds operational fragility (which version? installed where?) for the demo / out-of-the-box experience. **Use as a fallback** — try `@ffmpeg-installer/ffmpeg`'s bundled binary first, fall back to `process.env.VFX_FAMILIAR_FFMPEG_PATH \|\| 'ffmpeg'` if the bundled binary fails to spawn. |
| `@ffmpeg-installer/ffmpeg` | `fluent-ffmpeg` wrapper | Adds a fluent API but also adds another LGPL/MIT mixed dep with weak typings. Direct `child_process.spawn` with a 4-arg ffmpeg invocation (`-i input.mp4 -frames:v 1 -f image2pipe -vcodec png -`) is simpler and contained. **Reject.** |
| Native client-side sort + `localStorage` | `zustand` / `mobx` / `lodash.orderby` | The project already uses `@preact/signals`. Adding another state library would violate the "single source of state truth" pattern shipped in v1.0. Native `Array.prototype.sort` with a tiny comparator factory is 12 lines of code. **Reject all.** |
| (no separate vector DB) | `pgvector` / `lancedb` / `chroma` | The grounded-summary task synthesizes from already-stored prompt blob + Phase 15 ingredient graph + Phase 13 model fingerprints. **There is no retrieval problem here** — the manifest IS the context. Adding an embedding store would be solving a problem we don't have. **Reject.** |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `ffmpeg-static@^5.x` | **GPL-3.0-or-later. License-viral.** This package wraps the same upstream ffmpeg binaries but distributes them under GPL-3, which would cascade to any project that includes it as a runtime dependency under the strong GPL contagion clause. MIT-licensed open-source distribution becomes legally compromised. | `@ffmpeg-installer/ffmpeg` (LGPL-2.1, separate-process invocation = compatible) |
| `jimp` | Pure-JS image processing — 10-30x slower than sharp for resize, no AVIF, no WebP-animation. Acceptable for a script, unacceptable for a dashboard hot-path that may resize 100s of thumbnails on bulk-import. | `sharp` |
| `node-canvas` | Heavy native binary, designed for Canvas API rendering not bulk resize, no AVIF in older versions. | `sharp` |
| OpenAI SDK as a *primary* (vendor-neutral first-vendor) | The project already has a clear Anthropic-aligned story (Claude Code). Adding an OpenAI dependency as the *default* would either (a) require a credential-routing layer the v1.2 scope doesn't justify, or (b) silently shift the operator burden. Project owner has explicitly preferred sticking with Anthropic. | `@anthropic-ai/sdk` for v1.2; revisit multi-provider in v1.4+ |
| `axios` for the LLM HTTP layer | The Anthropic SDK uses native `fetch` (Node 20+) under the hood. Adding axios would re-introduce a dep the project successfully avoided in v1.0. | (n/a — Anthropic SDK handles transport) |
| `dayjs` / `moment` for sort timestamps | Native `Date` ordering is sufficient for v1.2's "newest-first" semantic (records already store ISO-8601 strings). | Native `Date` + `String` comparators |
| Adding a new top-level MCP tool | v1.2 scope is dashboard-side + transparent server-side enrichment. **Tool count stays at 7 of 12.** The conversational summary is exposed via the existing `version.get` action's response shape, not a new tool. | Extend `engine/version-service` to include an optional `summary` field; thin REST route on the dashboard side; no MCP surface change. |

---

## Stack Patterns by Variant

### If LLM-summary feature must work offline / air-gapped:
- Keep `@anthropic-ai/sdk` as the default
- Add a config flag `VFX_FAMILIAR_SUMMARY_PROVIDER=disabled|anthropic|local` (default `anthropic`)
- When `disabled`, the engine returns the existing structured node listing (current behavior) — feature gracefully degrades
- Local-model path is **out of scope for v1.2** (see Alternatives)

### If thumbnail input is animated WebP / GIF:
- `sharp` handles natively via `{ animated: true }` constructor option, then `.resize()` + `.toBuffer()` returns a still frame (the first frame by default)
- **No ffmpeg required for animated WebP/GIF — only for MP4**

### If thumbnail input is MP4:
- Spawn `@ffmpeg-installer/ffmpeg`'s `path` with `-i <input> -frames:v 1 -f image2pipe -vcodec png -` to extract frame-1 to stdout
- Pipe stdout buffer into `sharp(buffer).resize(256).webp().toBuffer()`
- Fallback chain on failure:
  1. `@ffmpeg-installer/ffmpeg` bundled binary (default)
  2. `process.env.VFX_FAMILIAR_FFMPEG_PATH` if set
  3. System `ffmpeg` on PATH
  4. Skip thumbnail → return placeholder 1x1 transparent PNG with a `vfx_familiar_placeholder` content-type hint header so the dashboard renders a "video, no preview" badge

### If thumbnail generation fails entirely:
- Return a 1x1 transparent WebP with header `X-Vfx-Familiar-Thumbnail: missing` (clean degradation; no broken-image icon)
- Log structured error event with version_id + filename + reason
- Dashboard shows a film-strip icon overlay ("video unavailable" or "thumbnail pending")
- **Never block** the asset card render or the version drawer load on thumbnail availability

### If Anthropic API is down / rate-limited / network-failing:
- Engine wraps `messages.create()` in a 5-second timeout + 1 retry with 2x backoff
- On final failure, returns the existing structured node listing as the `summary` field with `summary_source: "fallback_node_listing"`
- Dashboard shows the structured listing (current pre-v1.2 UX) without a degradation banner — the *content* is the degradation signal
- Add a Prometheus-style counter `vfx_familiar_summary_failures_total{reason}` to existing telemetry (if telemetry layer exists; otherwise log-only for v1.2)

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@anthropic-ai/sdk@^0.92.0` | `zod@^4.3.6` (project's pin) | SDK declares `peerDependencies: { zod: '^3.25.0 \|\| ^4.0.0' }` — explicit Zod 4 support. Verified via npm metadata 2026-04-30. |
| `@anthropic-ai/sdk@^0.92.0` | Node `>=20` (project's `engines`) | SDK uses native `fetch` (Node 20+). No undici or node-fetch needed. |
| `sharp@^0.34.5` | Node `^18.17.0 \|\| ^20.3.0 \|\| >=21.0.0` | Project pins `>=20`, fully covered. macOS arm64 + linux-x64 + linux-arm64 binaries all in `@img/sharp-{platform}` optional deps. |
| `sharp@^0.34.5` | `c2pa-node@0.5.26` (project's pin) | Both load native bindings via prebuild-install / N-API; zero overlap (sharp uses libvips, c2pa-node uses Rust c2pa). They share no transitive deps that conflict. Verified by inspecting `sharp.dependencies` and `c2pa-node`'s static lib. |
| `@ffmpeg-installer/ffmpeg@^1.1.0` | All Node 18+ | Pure binary distribution — no Node API usage; spawned via `child_process`. Cross-platform (darwin-arm64, darwin-x64, linux-arm, linux-arm64, linux-x64, linux-ia32, win32-x64, win32-ia32). |
| `claude-haiku-4-5-20251001` | `@anthropic-ai/sdk@^0.92.0` | Verified at https://platform.claude.com/docs/en/docs/about-claude/models/overview — alias `claude-haiku-4-5` also works. 200k context window, 64k max output, supports prompt caching. **Reliable knowledge cutoff: Feb 2025.** |

---

## Cost-Per-Call Budget (LLM Summary)

**Verified pricing** (Anthropic platform docs, 2026-04-30):
- Claude Haiku 4.5 input: **$1.00 per million tokens** (NOT $0.80 — the prompt's pre-research estimate was low)
- Claude Haiku 4.5 output: **$5.00 per million tokens** (NOT $4 — the prompt's estimate was low)

**Sample summary call breakdown:**

```
SYSTEM PROMPT (cacheable, ~600 tokens):
  Role + voice instructions + grounding rules + format constraints

USER MESSAGE (per-call, ~250 tokens):
  - Manifest sha256 (16 chars)
  - Resolved prompt blob projection: model name + LoRA names + sampler/steps/cfg/seed (~80 tokens)
  - Phase 15 ingredient graph: parent version_id + componentOf images count (~30 tokens)
  - Phase 13 model fingerprints: 1-3 SHA-256 prefixes (~50 tokens)
  - Diff vs parent (if exists): 2-3 changed-fields (~50 tokens)
  - Asset metadata: tags + project context (~40 tokens)

ASSISTANT RESPONSE (~120 tokens, 2-4 sentences in Supervisor voice)

TOTAL PER CALL:
  Input: 850 tokens × $1.00/MTok = $0.00085
  Output: 120 tokens × $5.00/MTok = $0.00060
  Per-call cost: ~$0.00145 (~$1.45 per 1000 summaries)
```

**With prompt caching enabled** (5-min cache TTL on the system prompt — supported by Haiku 4.5 + SDK):
- First call: $0.00085 + $0.0006 = $0.00145 (system prompt is "cache write" at 1.25x base = $0.00075 instead of $0.0006)
- Subsequent calls within 5 min: System prompt becomes "cache read" at 0.1x = $0.00006 instead of $0.0006
- Effective per-call after first: **~$0.00071** (~$0.71 per 1000 summaries) — **51% cost reduction**

**Cache key for client-side memoization:** `manifest_sha256 + summary_prompt_version`
- Persist generated summaries in a new SQLite table `version_summaries(version_id PRIMARY KEY, manifest_sha256, summary_text, model, generated_at)`
- Re-use across dashboard reloads — only re-generate when `manifest_sha256` changes (i.e., re-sign / redact)
- This cache is **separate** from the Anthropic API's prompt-cache; they stack

**Realistic v1.2 demo budget:**
- 200 versions in a typical demo project × $0.00145 = $0.29 total to generate every summary once
- After persistence, zero further cost on dashboard navigation
- **Total LLM spend for a demo: under $1.** Negligible.

---

## Architecture-Purity Implications

The v1.0/v1.1 codebase enforces a strict allowed-set for the `c2pa-node` import via
`src/__tests__/architecture-purity.test.ts` (lines 166-220). v1.2 must extend the same pattern for
`@anthropic-ai/sdk`:

### New restricted-import rule (Phase to introduce in v1.2)

```typescript
// Add to architecture-purity.test.ts
const allowedAnthropicSdkImporters = new Set<string>([
  'src/engine/summary/anthropic-client.ts', // ONLY this file imports the SDK
  'src/engine/summary/index.ts',            // Barrel export — no SDK import, but reserved
]);
```

**Why this matters:**
- The MCP tool layer (`src/tools/`) must NOT directly import `@anthropic-ai/sdk` — same discipline as `c2pa-node`. The summary engine is invoked through `engine/summary/generate.ts` which returns plain `{ summary: string, source: 'llm' | 'fallback_node_listing' }`. The tool layer sees only the typed result.
- The engine layer outside `engine/summary/` must NOT import the SDK. The summary engine is sealed behind a single entry point.
- Test-time mocking is on `@anthropic-ai/sdk` directly — `vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: vi.fn() } } }))` — so non-summary tests never accidentally make a network call.

### Sharp + ffmpeg-installer scope

These are less sensitive than LLM SDKs (no API keys, no cost, no network), but the architecture review still recommends a *softer* containment:

```typescript
// Recommended (soft containment — review-time check, not test-enforced)
// Sharp imports allowed in:
//   src/engine/thumbnails/*
//   src/engine/c2pa/* (already has manifest thumbnail logic)
// Ffmpeg-installer imports allowed in:
//   src/engine/thumbnails/video-frame-extract.ts (the ONLY caller)
```

We do NOT need an architecture-purity test for sharp/ffmpeg, because:
1. They have no security-sensitive surface (vs. c2pa cryptography or LLM API keys)
2. The cost of accidental cross-module import is "duplicated resize logic", which would be caught in code review
3. Adding test enforcement for every native lib would inflate the test suite without proportionate value

---

## Fallback Story (Failure Modes)

| Failure | Detection | User-Visible Behavior | Engine Behavior |
|---------|-----------|----------------------|-----------------|
| Anthropic API down | 5s timeout + 1 retry | Dashboard shows structured node listing (existing v1.0/v1.1 UX); no banner | `summary_source: "fallback_node_listing"` in response; structured logger event |
| Anthropic API rate-limited (429) | SDK throws `RateLimitError` | Same as above | Counter `summary_failures_total{reason="rate_limit"}++`; degrade silently |
| Anthropic API key missing/invalid | SDK throws `AuthenticationError` on first call | Same as above; admin sees structured log with "set ANTHROPIC_API_KEY" hint | Engine continues to serve all other features; only summary degrades |
| `@anthropic-ai/sdk` import fails (binary or runtime) | Lazy-import wrapped in try/catch | Same as above | Engine logs once at boot; summary feature disabled until restart |
| Sharp binary missing | Native bind error on first call | Dashboard shows generic file-icon placeholder + "thumbnail unavailable" badge | Counter `thumbnail_failures_total{reason="sharp_init"}++`; structured log with libvips diagnostic |
| Sharp resize fails (corrupt PNG, oversized image) | Sharp throws `Error` | Same as above | Per-file failure; other thumbnails continue rendering |
| Ffmpeg binary missing (Linux distro without bundled binary, locked-down container) | `child_process.spawn` ENOENT | Video assets show "video, no preview" badge | Try fallback: `process.env.VFX_FAMILIAR_FFMPEG_PATH` → system `ffmpeg` on PATH; if all fail, mark MP4 thumbnails as `pending` permanently |
| MP4 frame extraction times out (>10s for a single frame) | `child_process` timeout | Same as video badge | Kill subprocess; counter `thumbnail_failures_total{reason="ffmpeg_timeout"}++` |
| MP4 file is corrupt or non-video | ffmpeg exits non-zero | Same as video badge | One-time log; do not retry on subsequent thumbnail requests for the same file (cache the failure with TTL) |
| Sort preference localStorage write fails (quota / private mode) | `try/catch` around `localStorage.setItem` | Sort preference resets on next load (loses user choice but doesn't crash) | Console warn; no engine impact — sort is fully client-side |

**Cross-cutting principle:** *Never block the dashboard render on a v1.2 enrichment.* Thumbnails, summaries, and sort preferences are all augmentations. The v1.0/v1.1 baseline UX must remain functional even if every v1.2 dependency fails simultaneously.

---

## Sources

- **Context7 `/anthropics/anthropic-sdk-typescript`** — verified SDK shape, model id format (`claude-haiku-4-5-20251001`), `messages.create()` API, prompt caching support. HIGH confidence.
- **Context7 `/lovell/sharp`** — verified resize API, animated WebP/GIF support, JPEG/PNG/WebP/AVIF output, NO native MP4 support. HIGH confidence.
- **Anthropic Models Overview** ([https://platform.claude.com/docs/en/docs/about-claude/models/overview](https://platform.claude.com/docs/en/docs/about-claude/models/overview)) — verified Claude Haiku 4.5 API id `claude-haiku-4-5-20251001` (alias `claude-haiku-4-5`), pricing **$1/$5 per MTok** (input/output), 200k context, 64k max output, prompt caching support, knowledge cutoff Feb 2025. HIGH confidence (official source).
- **npm registry** — verified versions on 2026-04-30: `@anthropic-ai/sdk@0.92.0` (modified 2026-04-30), `sharp@0.34.5` (modified 2026-04-25), `@ffmpeg-installer/ffmpeg@1.1.0` (LGPL-2.1), `ffmpeg-static@5.3.0` (GPL-3.0-or-later — **rejected**). HIGH confidence.
- **Project source** — `package.json`, `packages/dashboard/package.json`, `src/__tests__/architecture-purity.test.ts:166-220` (existing allowed-set pattern for `c2pa-node` imports). HIGH confidence.
- **Project context** — `.planning/PROJECT.md` v1.2 milestone definition (visual-first artist feedback, 7-of-12 tool cap holds, ~38.55 kB JS budget). HIGH confidence.

---

*Stack research for: v1.2 Visual & Conversational Dashboard milestone (additive scope on existing TypeScript ESM Node MCP server + Preact dashboard)*
*Researched: 2026-04-30*
*Confidence: HIGH — every version pinned via npm metadata; LLM model id + pricing verified at official Anthropic docs same day; license-poison risk on `ffmpeg-static` caught and routed to `@ffmpeg-installer/ffmpeg`*
