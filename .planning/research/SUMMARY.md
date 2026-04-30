# Project Research Summary — v1.2 Visual & Conversational Dashboard

**Project:** VFX Familiar (comfyui-vfx-mcp)
**Domain:** Subsequent-milestone additions to a shipped TypeScript ESM Node MCP server + Preact dashboard (existing v1.0 + v1.1 surfaces)
**Researched:** 2026-04-30
**Confidence:** HIGH for stack + thumbnails + sort; MEDIUM for AI summary (LLM is a first-of-its-kind dependency surface in this codebase)

## Executive Summary

v1.2 is an **additive UX milestone** layered on shipped v1.0 (project hierarchy + provenance) and v1.1 (C2PA cryptographic signing). Three artist-driven features ship together: thumbnails on Project/Shot Asset cards, a sortable folder dropdown structure (latest-first by default), and an AI-generated conversational asset summary in the Supervisor/Lead voice. **No new MCP tools** — the 7-of-12 tool cap holds; v1.2 is dashboard-facing + transparent server-side enrichment with append-only-via-cache-table semantics that preserve every v1.0/v1.1 invariant.

**Recommended approach:** ship low-risk visual wins first (thumbnails → sort) before introducing the LLM dependency last. Three new server-side dependencies (`@anthropic-ai/sdk@^0.92.0`, `sharp@^0.34.5`, `@ffmpeg-installer/ffmpeg@^1.1.0`) are restricted to specific files via the same architecture-purity allowed-set pattern that v1.1 used to lock `c2pa-node`. The AI summary is grounded in existing structured provenance (Phase 13 model fingerprints + Phase 15 ingredient graph + the prompt blob) with **zero vision-model inference** — preventing hallucination by design, not policy. **License-viral risk caught:** the obvious `ffmpeg-static@5` dep is GPL-3.0-or-later (would cascade onto MIT); routed to `@ffmpeg-installer/ffmpeg` (LGPL-2.1, separate-process compatible).

**Key risks:** (1) privacy-leak class — a redact event must invalidate cached summary AND thumbnail (cache key = `manifest_sha256`, never `version_id`); (2) prompt-injection class — user-controlled prompt blob fed into the LLM must be XML-tagged-untrusted with output validation that requires verbatim model-name mention; (3) cost runaway — auto-fetching summaries on card render can spike to $125/hr per dashboard instance, so summaries fetch ONLY on VersionDrawer open with `manifest_sha256`-keyed cache + Anthropic prompt caching. The **adversarial review pattern** that caught 5 BLOCKERS in v1.1 Phase 16 is mandatory at the LLM-summary plan stage.

## Key Findings

### Recommended Stack

Three additive server-side dependencies, no new client-side libs (dashboard's ~38.55 kB JS budget is preserved). Existing `@preact/signals` powers sort state via native `Array.prototype.sort`; native `localStorage` handles persistence. See `.planning/research/STACK.md` for full details.

**Core technologies:**

- **`@anthropic-ai/sdk@^0.92.0`** — LLM for conversational summary; declares `peerDependencies: { zod: '^3.25.0 || ^4.0.0' }` (clean fit with project Zod v4); ESM-native; supports prompt caching, streaming. Default model `claude-haiku-4-5-20251001`; 200k context, 64k max output, $1/$5 per MTok in/out.
- **`sharp@^0.34.5`** — server-side image resize; libvips binding via pre-compiled per-platform `@img/sharp-{platform}` optional deps; native AVIF + WebP + animated WebP/GIF support.
- **`@ffmpeg-installer/ffmpeg@^1.1.0`** — first-frame extraction from MP4 outputs; **LGPL-2.1 (separate-process invocation = MIT-compatible)**; `ffmpeg-static@5.x` is **GPL-3.0-or-later (license-viral; rejected)**. Bundled binary ~75 MB on macOS arm64.

**Disk footprint added:** ~80 MB. Cost-per-call budget for summaries: ~$0.00145 first call, ~$0.00071 per cached call (51% reduction via Anthropic prompt caching) — under $1 total to summarize a 200-version demo project.

**License posture:** original recommendation `ffmpeg-static` would have virally relicensed this MIT project under GPL-3. Routed to LGPL-2.1 — verify in PR review before any v1.2 plan executes.

### Expected Features

Three feature pillars with three different complexity profiles. See `.planning/research/FEATURES.md` for full details.

**Must have (table stakes):**
- Thumbnails on completed-version cards (16:9 lazy-load + skeleton fallback, click-to-fullsize)
- MP4 first-frame thumbnail (`-vf thumbnail` filter for representative frame)
- Latest-first default sort with 4-option dropdown on version grid; localStorage persistence
- Replace raw provenance JSON dump in VersionDrawer with 2-4 sentence conversational summary
- Cached summary with regenerate button (1/min throttle); summary never auto-regenerates
- Aspect-ratio reservation + skeleton placeholders (CLS=0)

**Should have (differentiators):**
- Highest-version-as-shot-card-thumbnail (Frame.io stack convention)
- C2PA-signed badge overlay on thumbnail (small shield icon)
- Smart default per scope (tree=A→Z, version grid=latest)
- "What changed from parent" inline in iterate-lineage summary
- Inline metadata pills (model + LoRAs + seed + parent version)

**Defer (v1.3+):**
- Hover-to-scrub video preview
- Streaming summary UX (SSE)
- Summary translation
- Per-shot sort persistence
- Branched-lineage narrative coherence
- AI-generated alt text on thumbnails

**Anti-features (deliberately NOT in v1.2):**
- Vision-model "describe the rendered image" (hallucination class — provenance graph IS the ground truth)
- Auto-enhanced thumbnails (sharpen/contrast/denoise)
- Summary editing in dashboard (append-only contract)
- New top-level MCP tool for summary or thumbnail (tool count holds at 7 of 12)

### Architecture Approach

Three feature pillars, three new modules at the engine layer, **one** new database migration (0007 — single column on existing `provenance` table), **zero** new database tables, **zero** MCP tool changes. Architecture mirrors v1.1's `c2pa-node` containment pattern. See `.planning/research/ARCHITECTURE.md` for component-by-component spec.

**Major components (new):**

1. **`src/engine/thumbnails/`** — `image-thumbnail.ts` (sharp), `video-thumbnail.ts` (ffmpeg), `format-router.ts` (pure), `cache.ts`, `index.ts`. Atomic write via temp+rename. Per-(versionId, filename) coalescing mutex.
2. **`src/engine/summary/`** — `anthropic-client.ts` (lazy import), `ground-truth-builder.ts` (pure), `prompt-template.ts` (versioned), `cache.ts` (LRU 1000), `summarizer.ts`, `index.ts`. Cache key = `manifest_sha256 + template_version + model_id` — free invalidation on redact.
3. **`src/store/{version-repo,hierarchy-repo,provenance-repo}.ts`** (MODIFIED) — sort param with whitelisted enum; new `appendSummaryGeneratedEvent` and `getLatestSummaryEvent`.
4. **`src/http/dashboard-routes.ts`** (MODIFIED) — three new routes: `GET/HEAD /api/versions/:id/thumbnail?w=80|160|320|640`, `GET /api/versions/:id/summary`. Existing list routes accept `?sort=...&order=...`.
5. **Dashboard components** (NEW: `Thumbnail.tsx`, `SortControl.tsx`, `ConversationalSummary.tsx`).

**Migration footprint (single migration 0007):**
```sql
ALTER TABLE `provenance` ADD `summary_generated_json` text;
```
Mirrors Phase 14's `manifest_signed_json` shape; zero new tables; append-only invariant preserved.

**Architecture-purity allowed-set extensions** (mirrors v1.1 `c2pa-node` pattern):
- `@anthropic-ai/sdk` → only `src/engine/summary/anthropic-client.ts`
- `sharp` → only `src/engine/thumbnails/image-thumbnail.ts`
- `@ffmpeg-installer/ffmpeg` → only `src/engine/thumbnails/video-thumbnail.ts`

### Critical Pitfalls

21 pitfalls documented (10 critical, 6 moderate, 5 minor) — privacy-leak class dominates. See `.planning/research/PITFALLS.md` for full prevention strategies.

**Top 10 ranked by criticality:**

1. **Stale LLM summary after redaction (privacy-leak)** — cache key = `manifest_sha256`, multi-encoding leak scan extends to summary cache, summarizer receives only post-redaction surviving fields.
2. **Prompt injection via user-controlled prompt blob** — XML-tagged untrusted user content + output validation requires verbatim `models_json` model name + length-floor check.
3. **Architecture-purity drift on `@anthropic-ai/sdk`** — extend allowed-set in same plan that introduces SDK import; tool layer never reads `process.env.ANTHROPIC_API_KEY`.
4. **Hallucination from ungrounded summarization** — structured XML-tagged input, system prompt restricts to `<provenance>` data, output validation regex requires verbatim model name.
5. **Cost runaway via auto-regeneration** — fetch ONLY on `VersionDrawer` open, cache by `manifest_sha256`, coalescing mutex, Anthropic prompt caching, env-var queue cap.
6. **MP4 frame extraction OOM on long videos** — stream-based child_process spawn with bounded accumulator, pre-flight 100MB skip, 10s hard timeout.
7. **Concurrent thumbnail generation stampede** — `thumbnailGenerationMutex` per (versionId, filename, target_size), `sharp.concurrency(2)` global cap, dashboard fetch queue cap 6.
8. **Thumbnail cache poisoning after redact** — cache key = `manifest_sha256`, explicit invalidation hook AFTER atomic rename in `redactManifestForVersion`.
9. **API key leak via LLM error message echo** — single `flattenAnthropicError` helper mirrors `flattenComfyError` (Phase 11), regex-strip auth headers, multi-encoding negative test.
10. **Sort instability across pagination** — server-side sort+paginate with composite cursor `(sort_key_value, version_id)`, sort change resets cursor.

**Cross-cutting v1.1 patterns re-applied** (mandatory):
- Adversarial review at plan stage for the LLM-summary phase (privacy + injection + API-key-leak class)
- Multi-encoding leak scan (UTF-8 + UTF-16LE + UTF-16BE + base64) extends to summary cache, thumbnail cache, error logs
- Wire-level UAT discipline (don't punt on tests)
- Append-only via cache table — separate `summary_generated_json` column on `provenance`
- Lazy native-binding import + graceful degradation

## Implications for Roadmap

**3 phases in strict ordering** (low-risk visual wins first; LLM dependency last to derisk). Phase numbers continue from v1.1 (last shipped = 16) so Phases 17, 18, 19.

### Phase 17: Visual Thumbnails

**Rationale:** Lowest risk — no new SaaS, no LLM, no API keys. `sharp` and `ffmpeg-installer` are battle-tested. Ships visible artist value on day one. Establishes the architecture-purity allowed-set extension pattern that the LLM phase will re-apply.

**Delivers:** thumbnail HTTP routes, `<Thumbnail/>` Preact component, MP4 first-frame extraction, atomic disk cache with ETag, redact-invalidation hook, architecture-purity test extensions for sharp + ffmpeg.

**Avoids (PITFALLS):** Pitfall 6 (MP4 OOM), Pitfall 7 (stampede), Pitfall 8 (cache poisoning), Pitfall 13 (unsupported format).

**Build effort estimate:** ~3 days.

### Phase 18: Sortable Folder Dropdown

**Rationale:** Architectural-mostly-trivial — server-side sort is a thin enum-whitelisted ORDER BY extension. Establishes the cursor-pagination-with-sort discipline.

**Delivers:** repo `sort` param additions, engine facade pass-through, HTTP route `?sort=...&order=...`, `<SortControl/>` Preact dropdown with localStorage persistence + URL state mirror, smart-default-per-scope.

**Avoids (PITFALLS):** Pitfall 10 (sort instability), Pitfall 15 (localStorage quota), Pitfall 20 (tool cap drift).

**Build effort estimate:** ~2 days.

### Phase 19: AI Conversational Summary

**Rationale:** Highest complexity, highest risk — ships LAST. Introduces the FIRST LLM dependency in this codebase. Adversarial review mandatory at plan stage (mirrors v1.1 Phase 16 review that caught 5 BLOCKERS).

**Delivers:** `src/engine/summary/` module, Drizzle migration 0007, engine facade `summarizeVersion`, HTTP route `GET /api/versions/:id/summary` with circuit breaker + 8s timeout, `<ConversationalSummary/>` Preact component, architecture-purity test extension for `@anthropic-ai/sdk`, `flattenAnthropicError` helper, env-config (`VFX_FAMILIAR_SUMMARY_MODEL`, `_FALLBACKS`, `_TIMEOUT_MS`, `_QUEUE_RPM`).

**Avoids (PITFALLS):** Pitfall 1 (stale-after-redact), Pitfall 2 (prompt injection), Pitfall 3 (architecture-purity drift), Pitfall 4 (hallucination), Pitfall 5 (cost runaway), Pitfall 9 (API key leak), Pitfall 11 (model deprecation), Pitfall 12 (rate limit), Pitfall 14 (Anthropic outage), Pitfall 17 (max_tokens truncation), Pitfall 18 (SSE/stdio mismatch), Pitfall 19 (append-only mutation), Pitfall 21 (migrate-on-boot).

**Build effort estimate:** ~4 days.

### Phase Ordering Rationale

- Strict ordering 17 → 18 → 19 (not parallel): each phase establishes patterns the next inherits.
- Low-risk first (de-risk ordering rule): thumbnails ship visible artist value with zero external-dependency risk → if v1.2 has to slip, Phase 17 still ships independently.
- Migration footprint locked at one file: only Phase 19 introduces 0007.

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 19 (AI Conversational Summary):** **MANDATORY adversarial codex-substitute review at plan stage.** Plus: validation harness for "is this output actually a Supervisor-voice 2-4 sentence summary?" — needs human VFX-savvy spot-check at acceptance.

**Phases with standard patterns (skip /gsd-research-phase):**
- Phase 17 (Visual Thumbnails): well-documented patterns; inherits from Phase 14 download discipline.
- Phase 18 (Sortable Folder Dropdown): SQL ORDER BY enum whitelist + cursor pagination is standard.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions pinned via npm metadata 2026-04-30; LLM model id + pricing verified; license-poison risk caught and routed; Zod v4 peer-dep verified. |
| Features | HIGH (thumbnails + sort), MEDIUM (AI summary) | Thumbnails + sort are well-trodden ground. Supervisor-voice register for AI summary is novel for this codebase. |
| Architecture | HIGH | Codebase ground-truth read; integration points verified against actual source. All v1.1 patterns directly transferable. |
| Pitfalls | HIGH | Anthropic SDK behavior + sharp performance + cursor-pagination patterns verified via Context7 + official docs; multi-encoding leak scan + adversarial review patterns verified via v1.1 RETROSPECTIVE. |

**Overall confidence:** HIGH

### Gaps to Address

- **Supervisor-voice acceptance:** Phase 19 acceptance includes a sample-output spot-check by a human VFX-savvy reviewer (Timothy as canonical reviewer) on 5+ generated summaries.
- **Anthropic prompt caching real-world hit rate:** Phase 19 ships with structured logging of `cache_creation_input_tokens` vs `cache_read_input_tokens`.
- **MP4 thumbnail format edge cases:** Phase 17 plan includes brightness-threshold fallback for `-vf thumbnail` filter on cuts.
- **Branched-lineage summary coherence:** v1.2 ships independent summaries; cross-summary intelligence deferred to v1.3.
- **Per-shot vs global sort persistence:** v1.2 ships global; per-shot evaluation deferred to v1.3.

## Sources

### Primary (HIGH confidence)
- Context7 `/anthropics/anthropic-sdk-typescript`, Context7 `/lovell/sharp`
- Anthropic Models Overview + API Docs (mitigate jailbreaks, rate limits, deprecations, prompt caching)
- npm registry metadata 2026-04-30 (version pins + license posture)
- Project source — package.json, architecture-purity.test.ts, pipeline.ts, c2pa modules, repos, drizzle migrations
- Project context — PROJECT.md, RETROSPECTIVE.md, CLAUDE.md
- Sharp performance docs (Pixelplumbing)
- Frame.io / VFX domain conventions

### Secondary (MEDIUM confidence)
- LLM hallucination mitigation literature 2026
- Sharp memory + concurrency issues (GitHub #138)
- HEIC thumbnail edge cases (immich-app/immich)
- Cursor pagination with arbitrary ordering (Drizzle ORM)
- LLM UX / streaming / TTFT (Redis blog)

### Tertiary (LOW confidence — flagged for validation during execution)
- Anthropic prompt caching real-world hit rate (validate via instrumentation)
- MP4 `-vf thumbnail` representative-frame quality (mitigate via brightness-threshold)
- Supervisor-voice register acceptance (relies on human spot-check)

---

*Research completed: 2026-04-30*
*Ready for roadmap: yes*
*Synthesis basis: 4 research dimensions (STACK/FEATURES/ARCHITECTURE/PITFALLS) + PROJECT.md context*
*Note for roadmapper: phase ordering is strict (17 → 18 → 19), not parallel. Adversarial review mandatory at Phase 19 plan stage. License-viral routing on ffmpeg is load-bearing — verify before any Phase 17 plan executes.*
