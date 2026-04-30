---
phase: 15-ingredient-graph
plan: 01
subsystem: c2pa
tags: [c2pa, ingredient-graph, extractor, sha256, image-input, ksampler-edge-walk, prov-v-04]

# Dependency graph
requires:
  - phase: 14-c2pa-manifest-scaffolding
    provides: c2pa-node signer + manifest-builder with c2pa.created assertion (extension target)
  - phase: 13-model-fingerprinting
    provides: LOADER_CLASS_TYPES + getLatestFingerprints + streaming-SHA256 patterns to mirror
  - phase: 12-reproduce-divergence
    provides: src/engine/output-hash.ts (canonical streaming-SHA256 + path-traversal guard reference)
provides:
  - IMAGE_INPUT_CLASS_TYPES Set + IMAGE_FIELD_BY_CLASS map (additive, disjoint from LOADER_CLASS_TYPES)
  - extractParentIngredient (pure D-CTX-1 / D-CTX-6 ParentIngredient builder)
  - extractComponentIngredients (pure walks resolved prompt blob; handles direct-filename + edge-tuple shapes)
  - extractInputAssertion (pure T-15-01 bounded payload via REVISION B5 KSampler edge walk)
  - hashComponentBytes (impure streaming-SHA256 + traversal guard + discriminated outcome union)
  - INPUT_PROMPT_MAX_CHARS constant (4096-char prompt cap)
  - File-level architecture-purity grep guards for the two new files
affects: [15-02-manifest-builder-extension, 15-03-engine-integration, 15-04-end-to-end-fixture, 16-redaction-and-agent-surface]

# Tech tracking
tech-stack:
  added: [discriminated-union HashOutcome type]
  patterns: [KSampler edge-walk, edge-tuple type guard isEdgeTuple, one-hop resolveImageFilename, classRole role mapping]

key-files:
  created:
    - src/engine/c2pa/ingredient-extractor.ts (313 lines)
    - src/engine/c2pa/ingredient-hasher.ts (84 lines)
    - src/engine/c2pa/__tests__/ingredient-extractor.test.ts (340 lines, 28 tests)
    - src/engine/c2pa/__tests__/ingredient-hasher.test.ts (155 lines, 13 tests)
  modified:
    - src/engine/provenance.ts (additive — IMAGE_INPUT_CLASS_TYPES + IMAGE_FIELD_BY_CLASS exports)
    - src/engine/c2pa/index.ts (barrel re-exports for new symbols)
    - src/engine/__tests__/model-extraction.test.ts (5-test describe block for v1.1 audit)
    - src/__tests__/architecture-purity.test.ts (2 file-level grep guards)

key-decisions:
  - "REVISION C1/C2 IMAGE_INPUT_CLASS_TYPES audit: removed model loaders (IPAdapter / CLIPVision loader classes belong on Phase 13 LOADER side); added VAEEncode / VAEEncodeForInpaint / ControlNetApply (non-Advanced) / ControlNetApplyAdvanced — six entries total, locked by disjointness test"
  - "REVISION B5 KSampler edge walk: prompt_positive / prompt_negative resolved by following KSampler.inputs.positive / inputs.negative as [node_id, output_index] tuples to CLIPTextEncode-class ancestors — replaces the wrong first/second positional heuristic"
  - "VAEEncode pixels-edge handling: when inputs.pixels is an edge tuple, walk one hop to upstream LoadImage* and use that node's filename; procedural producers (EmptyLatentImage) are silently skipped (no canonical filename)"
  - "T-15-01 bounded payload shape locked at 4 fields (prompt_positive + prompt_negative + sampler + seed); never workflow_json verbatim; 4096-char cap with explicit truncation marker"
  - "T-15-04 path-leak hygiene: hashComponentBytes return shape carries only hex digest OR typed reason — never the resolved filesystem path (verified by Test 10 negative assertion)"
  - "Defensive lineage_type default: when version.lineage_type is null, ParentIngredient coerces to 'iterate' (more permissive variant); the parent itself carries the authoritative lineage"
  - "TEXT_ENCODER_CLASSES set covers CLIPTextEncode + CLIPTextEncodeSDXL + CLIPTextEncodeSDXLRefiner; SDXL variants fall back text → text_g → text_l per ComfyUI schema"

patterns-established:
  - "KSampler edge walk: ComfyUI graph semantics drive prompt resolution, not node-id positional heuristics — locks against multi-conditioning / experimental-branch leakage"
  - "Discriminated union outcome ({ hash } | { component_unavailable: '...' }): exact shape lock prevents accidental field bleed across success/failure branches"
  - "One-hop edge walk with type guards: defence-in-depth against malformed cyclic blobs (no recursion)"
  - "Architecture-purity docstring rephrasing: avoid literal forbidden-package strings in docstrings so directory-level grep guards stay honest (mirrors Phase 13 Plan 13-01 pattern)"

requirements-completed: []  # PROV-V-04 cohort closure happens in Plan 15-04 (full v1→v2→v3 ingredient-graph fixture). This plan is foundational primitives only.

# Metrics
duration: 19min
completed: 2026-04-30
---

# Phase 15 Plan 01: Ingredient Extractors + Hasher Summary

**Pure ingredient extraction primitives (parent / component / inputTo) plus streaming-SHA256 helper; KSampler edge walk replaces the positional CLIPTextEncode heuristic per REVISION B5; IMAGE_INPUT_CLASS_TYPES audited per REVISION C1/C2 to disjoint set vs LOADER_CLASS_TYPES.**

## Performance

- **Duration:** 19 min
- **Started:** 2026-04-30T15:36:24Z
- **Completed:** 2026-04-30T15:55:24Z
- **Tasks:** 4
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- IMAGE_INPUT_CLASS_TYPES (6 entries) + IMAGE_FIELD_BY_CLASS landed in src/engine/provenance.ts, audited per REVISION C1/C2 (model-loader classes deliberately excluded). Disjointness vs LOADER_CLASS_TYPES locked by test.
- Three pure functions in src/engine/c2pa/ingredient-extractor.ts (313 lines): extractParentIngredient (D-CTX-1, D-CTX-6), extractComponentIngredients (D-CTX-1; v1.1 audit), extractInputAssertion (T-15-01; REVISION B5 KSampler edge walk).
- KSampler edge walk locked by IA-3 test ("unreferenced CLIPTextEncode is ignored") — proves we follow ComfyUI graph semantics, not node-id position.
- Streaming-SHA256 hashComponentBytes in src/engine/c2pa/ingredient-hasher.ts (84 lines) with the same path-traversal guard as Phase 12's output-hash.ts and a discriminated HashOutcome union.
- 41 new tests across 2 new test files (28 extractor + 13 hasher) plus 5 v1.1 audit tests in model-extraction.test.ts plus 2 file-level architecture-purity grep guards. Root suite 1048 → 1096 passing; pre-existing 5 v1.1-audit failures unchanged.
- Architecture-purity preserved: zero MCP / native-binding / SQLite-driver / ORM imports in either new file, locked by file-level grep tests.

## Task Commits

Each task was committed atomically:

1. **Task 1: IMAGE_INPUT_CLASS_TYPES + IMAGE_FIELD_BY_CLASS to provenance.ts (REVISED v1.1 audit)** — `21aaf09` (feat)
2. **Task 2: ingredient-extractor.ts with three pure functions + KSampler edge walk** — `66de5f9` (feat)
3. **Task 3: ingredient-hasher.ts streaming-SHA256 + path-traversal guard** — `6e00dcb` (feat)
4. **Task 4: architecture-purity grep guards for ingredient files** — `ab73a8c` (test)

**Plan metadata:** _appended to last commit_ (this SUMMARY + STATE / ROADMAP updates ship in a single docs commit at the end of plan execution)

_Note: Each `feat` task above followed RED → GREEN — tests authored first, observed failing, then implementation made them pass. No REFACTOR commits were needed; primitives shipped clean from GREEN._

## Files Created/Modified

### Created
- `src/engine/c2pa/ingredient-extractor.ts` (313 lines) — three pure extractor functions + four exported types + INPUT_PROMPT_MAX_CHARS constant
- `src/engine/c2pa/ingredient-hasher.ts` (84 lines) — hashComponentBytes async helper + HashOutcome discriminated union
- `src/engine/c2pa/__tests__/ingredient-extractor.test.ts` (340 lines, 28 tests) — covers PI-1..3 + CI-1..6 + IA-1..10 + defensive cases incl. SDXL text_g/text_l fallback
- `src/engine/c2pa/__tests__/ingredient-hasher.test.ts` (155 lines, 13 tests) — covers happy path, file_not_found (3 variants), 4 path-traversal cases, empty filename, file_unreadable (POSIX-only), content-addressed determinism, 10MB streaming proof, T-15-04 path-leak negative, discriminated-union shape lock

### Modified
- `src/engine/provenance.ts` — additive: IMAGE_INPUT_CLASS_TYPES (6 entries) + IMAGE_FIELD_BY_CLASS (6 entries). LOADER_CLASS_TYPES, MODEL_FIELD_BY_CLASS, MODEL_DIR_BY_CLASS, KSAMPLER_CLASS_TYPES, isPlainObject, pickModelName, extractModels, extractSeed, ProvenanceWriter all untouched.
- `src/engine/c2pa/index.ts` — barrel re-exports for the new ingredient primitives (ingredient-extractor: 3 functions + 4 types + 1 constant; ingredient-hasher: 1 function + 1 type)
- `src/engine/__tests__/model-extraction.test.ts` — appended a 5-test describe block validating the v1.1 audit (contents lock, model-loader absence, field-mapping non-emptiness, image-vs-pixels split, disjointness invariant)
- `src/__tests__/architecture-purity.test.ts` — added two file-level grep guards mirroring the manifest-builder.ts + format-router.ts shape

## REVISION C1/C2: IMAGE_INPUT_CLASS_TYPES Audit Detail

**What was REMOVED from the CONTEXT-time list:**
- `IPAdapterModelLoader` — this is a MODEL LOADER (loads .safetensors / .bin IP-Adapter weights from disk via `ipadapter_file`). It does NOT consume an image; image bytes feed a downstream node like IPAdapterAdvanced / IPAdapter (varies by pack). Belongs on the LOADER side (Phase 13 fingerprinting domain).
- `CLIPVisionLoader` — also a model loader (CLIP-Vision encoder weights). Does NOT consume an image either. Same domain as above.

**What was ADDED:**
- `LoadImage` (already CONTEXT-listed) — primary user-uploaded source images, `image` STRING field
- `LoadImageMask` (already CONTEXT-listed) — mask images for inpainting workflows, `image` STRING field
- `VAEEncode` — image bytes encoded into latent for img2img, `pixels` EDGE-TUPLE field (resolved via one-hop walk to upstream LoadImage*)
- `VAEEncodeForInpaint` — image + mask encoded for inpaint, `pixels` EDGE-TUPLE field
- `ControlNetApply` — older non-Advanced ControlNet apply node (consumes image), `image` STRING field
- `ControlNetApplyAdvanced` (already CONTEXT-listed) — newer Advanced ControlNet apply, `image` STRING field

**Disjointness invariant locked:** A test in src/engine/__tests__/model-extraction.test.ts asserts no class_type appears in BOTH IMAGE_INPUT_CLASS_TYPES and LOADER_CLASS_TYPES. A future audit-time addition that mistakes a loader for an image-input node surfaces here at compile-fail time, before the prompt walk emits double-counted entries.

**Deferred to v1.2 audit (recorded for Plan 15-04 closure paragraph):**
- IPAdapter pack-shipped node variants (IPAdapter, IPAdapterAdvanced, IPAdapterUnifiedLoader, IPAdapterFromParams, IPAdapterTiled, etc. — ~12 forms in the IP-Adapter Plus pack). Each consumes an image edge. Auditing all of them against an installed pack source is out-of-scope for v1.1.

## REVISION B5: KSampler Edge-Walk Implementation Detail

**The wrong heuristic (now removed from the design):** "First CLIPTextEncode by node-id order = positive prompt; second = negative prompt."

**Why it was wrong:** ComfyUI workflows can have N CLIPTextEncode nodes — multi-conditioning splits, abandoned experimental branches, alternative prompts left in the graph. Only the nodes the KSampler actually consumes via its `positive` and `negative` edge tuples affect the output. A positional heuristic surfaces an unrelated unused branch as the "negative prompt."

**The correct semantic (now shipped):**
1. Walk the prompt blob for KSampler-class nodes in node-id order.
2. For each, read `inputs.positive` and `inputs.negative` — these are `[source_node_id, output_index]` edge tuples.
3. Follow each tuple to the referenced node. If its class_type is in the recognised TEXT_ENCODER_CLASSES set (CLIPTextEncode / CLIPTextEncodeSDXL / CLIPTextEncodeSDXLRefiner), read `inputs.text` (with text_g / text_l fallback for SDXL variants).
4. Use the FIRST KSampler whose positive OR negative edge resolves cleanly. If none resolve, fall back to the first KSampler for sampler-params extraction with both prompts null.
5. The unreferenced CLIPTextEncode nodes — including experimental branches — are IGNORED. This reduces the inputTo leak surface by only including text the user's KSampler actually consumed.

**The behaviour-locking test (IA-3):** A prompt blob with THREE CLIPTextEncode nodes where the KSampler references nodes 6 and 7 (positive and negative respectively); node 10 is an unreferenced experimental branch with text "EXPERIMENTAL UNUSED — should not appear." The test asserts:
- `prompt_positive === "good positive"` (node 6's text)
- `prompt_negative === "good negative"` (node 7's text)
- `JSON.stringify(result)` does NOT contain "EXPERIMENTAL UNUSED" (defensive sweep)

This single test makes any future regression to a positional heuristic immediately visible at PR review time.

**Other edge-walk cases covered by tests:**
- IA-4: edge points at a non-CLIPTextEncode node (e.g., ConditioningCombine) — the prompt is null on that side; deeper traversal through Conditioning* nodes is explicitly deferred to v1.2.
- IA-5: prompt blob has no KSampler — both prompts null; sampler params null.
- IA-6: multiple KSamplers — uses the first resolvable (lowest node_id with valid edges).
- IA-10: KSamplerAdvanced (uses noise_seed not seed) recognised via KSAMPLER_CLASS_TYPES set membership; sampler params extracted normally.
- IA-defensive (CLIPTextEncodeSDXL): text_g / text_l fallback when plain text absent.

## Test Count Delta

| Suite | Before Plan 15-01 | After Plan 15-01 | Delta |
|-------|--------------------|------------------|-------|
| Root passing | 1048 | 1096 | +48 |
| Root pre-existing failures | 5 | 5 | 0 |
| Root skipped | 3 | 3 | 0 |
| Dashboard passing | 88 | 88 | 0 |

**The +48 delta breaks down as:**
- 5 tests in src/engine/__tests__/model-extraction.test.ts (v1.1 audit + disjointness invariant)
- 28 tests in src/engine/c2pa/__tests__/ingredient-extractor.test.ts
- 13 tests in src/engine/c2pa/__tests__/ingredient-hasher.test.ts
- 2 tests in src/__tests__/architecture-purity.test.ts (file-level guards)

**Pre-existing 5 v1.1-audit ROADMAP-shape failures unchanged** — same files, same test names as documented in STATE.md (phase-attribution.test.ts × 3, validation-flags.test.ts × 2). Out-of-scope for Plan 15-01 per scope-boundary rule.

## Threat Mitigations Locked by Tests

| Threat ID | Category | Mitigation Test | Test Name |
|-----------|----------|-----------------|-----------|
| T-15-01 | Information Disclosure (workflow_json leak via inputTo) | IA-1 | "returns InputAssertion structure; never workflow_json verbatim" — asserts `Object.keys(result)` does NOT contain 'workflow_json' or 'prompt' |
| T-15-01 | Information Disclosure (long prompt overflow) | IA-7 | "prompt text capped at INPUT_PROMPT_MAX_CHARS with truncation marker" — 4596-char input → 4096+marker output |
| T-15-01 (extension) | Information Disclosure (unreferenced branch leak) | IA-3 | "unreferenced CLIPTextEncode is IGNORED" — REVISION B5 lock |
| T-15-02 | Path Traversal | hasher Tests 3, 4, 5, 6, 6b | '..' / '/' / '\\' / NUL / empty filename → file_not_found before any FS call |
| T-15-04 | Information Disclosure (path leak) | hasher Test 10 | "return shape never contains the resolved filesystem path" — JSON.stringify negative assertion |

## Decisions Made

- **REVISION C1/C2 audit applied as Path A in-place fix** rather than a separate revision plan — keeps Plan 15-01 self-contained and the executor narrative linear.
- **Defensive lineage_type default ('iterate')** chosen over hard-fail because in production every reproduce/iterate child has lineage_type set at creation time; the default exists only for legacy / partially-migrated rows. The parent itself carries the authoritative value, so this default is safe.
- **One-hop edge walk only** (no recursion through ConditioningCombine / ConditioningConcat) — defence-in-depth against malformed cyclic blobs and a deliberate v1.1 / v1.2 split. v1.2 will audit the conditioning-graph traversal in concert with IPAdapter pack node variants.
- **Discriminated HashOutcome union** ({ hash } | { component_unavailable: 'file_not_found' | 'file_unreadable' }) chosen over `string | null` because callers (Plan 15-03 manifest builder) need to record the typed unavailable reason directly into the c2pa.ingredient assertion; a flat null loses the failure-mode signal.
- **`return null` rather than `throw`** in hashComponentBytes mirrors output-hash.ts and lets callers degrade the manifest to dangling-reference state without a try/catch boundary at the call site.
- **TEXT_ENCODER_CLASSES set with three members** (CLIPTextEncode / CLIPTextEncodeSDXL / CLIPTextEncodeSDXLRefiner) chosen over the canonical-only single-class set so SDXL workflows produce a non-null inputTo. v1.2 audit will sweep additional pack-shipped text encoders.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Docstring rephrasing to avoid forbidden-package literal strings**
- **Found during:** Task 1 (verify gate `! grep -E "IPAdapterModelLoader|CLIPVisionLoader" src/engine/provenance.ts`)
- **Issue:** The plan's `<action>` block for Task 1 instructed a docstring containing the literal class-name strings `IPAdapterModelLoader` and `CLIPVisionLoader`. The same plan's `<verify>` block requires the grep to return ZERO matches. The docstring would have failed the verify gate.
- **Fix:** Rephrased the docstring to use generic descriptions ("the IP-Adapter model-loader and CLIP-Vision-loader classes") instead of the literal class names. Same intent (these classes are deliberately excluded as model loaders); no behavioural change.
- **Files modified:** src/engine/provenance.ts (docstring on IMAGE_INPUT_CLASS_TYPES export)
- **Verification:** `! grep -E "IPAdapterModelLoader|CLIPVisionLoader" src/engine/provenance.ts` succeeds.
- **Committed in:** 21aaf09 (Task 1 commit, bundled per Rule 3 scope-boundary)

**2. [Rule 3 - Blocking] ingredient-extractor docstring rephrasing**
- **Found during:** Task 2 (verify gate forbidden-imports grep)
- **Issue:** The plan's `<action>` block specified a header docstring containing the literal substring "zero MCP / DB / ORM / HTTP / c2pa-node imports." The same plan's verify gate `grep -E "@modelcontextprotocol/sdk|c2pa-node|better-sqlite3|drizzle-orm" src/engine/c2pa/ingredient-extractor.ts` would match the docstring mention of "c2pa-node" and fail.
- **Fix:** Rephrased to "zero MCP / DB / ORM / HTTP / native-c2pa-binding imports." Same architecture-purity claim, no literal package name.
- **Files modified:** src/engine/c2pa/ingredient-extractor.ts (file header docstring)
- **Verification:** `grep -E "@modelcontextprotocol/sdk|c2pa-node|better-sqlite3|drizzle-orm" src/engine/c2pa/ingredient-extractor.ts` returns no match.
- **Committed in:** 66de5f9 (Task 2 commit, bundled per Rule 3 scope-boundary)

**3. [Rule 3 - Blocking] ingredient-extractor.test.ts docstring rephrasing (directory-level grep collision)**
- **Found during:** Task 4 (after writing the new file-level architecture-purity tests, the directory-level `src/engine/c2pa/ has zero imports from better-sqlite3` and `... from drizzle-orm` tests started failing)
- **Issue:** Test 138-143 in src/__tests__/architecture-purity.test.ts uses `grepCount('better-sqlite3', 'src/engine/c2pa/')` which counts FILES containing the pattern (not import statements). The new ingredient-extractor.test.ts header docstring contained the literal substring "better-sqlite3 / drizzle-orm" describing the architecture-purity intent — this caused grepCount to return 1 instead of 0, failing two passing tests.
- **Fix:** Rephrased the test header docstring to "zero MCP / native-binding / SQLite-driver / ORM imports" — same intent, no literal package-name strings.
- **Files modified:** src/engine/c2pa/__tests__/ingredient-extractor.test.ts (file header docstring)
- **Verification:** Architecture-purity suite passes 32/32.
- **Committed in:** ab73a8c (Task 4 commit, bundled per Rule 3 scope-boundary)

---

**Total deviations:** 3 auto-fixed (3 Rule 3 blocking — same docstring-vs-grep pattern recurring across the three new files)
**Impact on plan:** All three fixes preserve the plan's stated intent and mirror the pattern Phase 13 Plan 13-01 already adopted ("zero SQLite-driver imports, zero ORM imports" docstring shape). No scope creep; no behavioural change.

## Issues Encountered

None during planned work — TDD RED → GREEN ran cleanly for all three implementation tasks; all 41 new tests passed on first GREEN attempt.

## v1.1 Documented Limitations (carried forward to Plan 15-04 closure)

1. **IPAdapter pack node variants** (~12 forms in IP-Adapter Plus pack: IPAdapter, IPAdapterAdvanced, IPAdapterUnifiedLoader, IPAdapterFromParams, IPAdapterTiled, etc.) are NOT in IMAGE_INPUT_CLASS_TYPES. Plan 15-04 Task 3 closure paragraph documents this in REQUIREMENTS.md "Deferred to v1.2."
2. **Deeper Conditioning-graph traversal** through ConditioningCombine / ConditioningConcat / ConditioningSetMask / ConditioningSetTimestepRange is NOT performed by extractInputAssertion in v1.1 — only direct CLIPTextEncode-class ancestors are recognised (verified by IA-4 test). Workflows that use prompt-graph nodes between CLIPTextEncode and KSampler will surface `prompt_positive: null` or `prompt_negative: null` in their inputTo assertion, which Plan 15-04's fixture test will exercise. v1.2 audit covers the conditioning-graph traversal.
3. **VAEEncode upstream-walk is one-hop only** — when the upstream of VAEEncode.pixels is itself an edge (e.g., LoadImage → ImageScale → VAEEncode), the ImageScale's image edge is NOT followed. The component is silently skipped. v1.2 audit covers multi-hop walks if production usage demonstrates the need.

## Architecture-Purity Status

| File | MCP | native-binding | SQLite-driver | ORM | HTTP-server | Verified by |
|------|-----|----------------|---------------|-----|-------------|-------------|
| src/engine/provenance.ts | 0 | 0 | 0 | 0 | 0 | directory-level grep at architecture-purity.test.ts:34 |
| src/engine/c2pa/ingredient-extractor.ts | 0 | 0 | 0 | 0 | 0 | file-level grep at architecture-purity.test.ts:240 (NEW) + directory-level guards |
| src/engine/c2pa/ingredient-hasher.ts | 0 | 0 | 0 | 0 | 0 | file-level grep at architecture-purity.test.ts:258 (NEW) + directory-level guards |

## Self-Check: PASSED

Verified by direct re-reading after writing this SUMMARY:
- FOUND: src/engine/c2pa/ingredient-extractor.ts (313 lines)
- FOUND: src/engine/c2pa/ingredient-hasher.ts (84 lines)
- FOUND: src/engine/c2pa/__tests__/ingredient-extractor.test.ts (28 tests)
- FOUND: src/engine/c2pa/__tests__/ingredient-hasher.test.ts (13 tests)
- FOUND commit 21aaf09: feat(15-01) IMAGE_INPUT_CLASS_TYPES
- FOUND commit 66de5f9: feat(15-01) ingredient-extractor
- FOUND commit 6e00dcb: feat(15-01) ingredient-hasher
- FOUND commit ab73a8c: test(15-01) architecture-purity guards

## Next Phase Readiness

**Plan 15-02 (Manifest Builder Extension) unblocked.** Plan 15-02 imports the four type aliases (ParentIngredient, ComponentIngredient, InputAssertion, ComponentRole) and INPUT_PROMPT_MAX_CHARS via `from '../ingredient-extractor.js'` (or via the c2pa/index.ts barrel) and extends BuildManifestOptions with the `ingredients` field. The pure functions can be invoked from manifest-builder tests as direct fixtures.

**Plan 15-03 (Engine Integration) unblocked.** Plan 15-03 imports both extractParentIngredient + extractComponentIngredients + extractInputAssertion + hashComponentBytes into Engine.signOutput (impure boundary) — passing the resolved prompt blob, calling the parent-manifest-hash reader, and looping the components through hashComponentBytes for the on-disk SHA-256.

**Plan 15-04 (End-to-End Fixture)** will close PROV-V-04 and document the v1.1 deferred items above.

---
*Phase: 15-ingredient-graph*
*Completed: 2026-04-30*
