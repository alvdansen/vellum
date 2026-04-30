---
phase: 16-redaction-and-agent-surface
plan: 03
subsystem: tools
tags: [c2pa, agent-surface, tool, export-manifest, verify-manifest, prov-v-07, dual-transport]

# Dependency graph
requires:
  - phase: 14-c2pa-signed-manifest
    provides: c2pa-uat-mcp-tool.test.ts dual-transport (stdio + HTTP) wire-level UAT pattern + bundled es256 dev cert fixtures + VFX_FAMILIAR_C2PA_TRUST_DEV_CERT='1' acceptance shim
  - phase: 16-redaction-and-agent-surface
    plan: 01
    provides: Engine.exportManifestForVersion + Engine.verifyManifestForVersion facade methods (lazy-import delegation); ExporterResult + VerificationReport shapes; D-CTX-7 architecture-purity allowed-set extension
provides:
  - Two new `version` tool action arms: `export_manifest` + `verify_manifest` (D-CTX-4)
  - Discriminated `verify_manifest` input — version-id form OR pure-bytes form (D-PLAN-3-2)
  - D-PROV-08 dual-form envelope shapers (`shapeExportManifestEnvelope` + `shapeVerifyManifestEnvelope`)
  - 100 MB payload-size cap on `manifest_bytes_base64` (T-16-17 mitigation)
  - Wire-level dual-transport parity guarantee — stdio + Streamable HTTP envelopes byte-identical
  - C-07 error-path parity — INVALID_INPUT envelope shape stable across both transports
affects: [16-04-redact-manifest-tool, 16-05-cohort-closure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discriminated tool input via z.union — when two arms share a discriminator literal (verify_manifest with {version_id} OR {bytes,format}), z.discriminatedUnion can't disambiguate so VersionInputSchema widens to z.union(); first-matching-arm semantics resolve at parse time"
    - "Tool-layer field-presence dispatch — inside `case 'verify_manifest':`, the switch arm checks `'version_id' in input` to route to the right Engine facade overload (D-PLAN-3-2)"
    - "Breadcrumb-null on pure-bytes path (D-PLAN-3-4) — agents calling verify_manifest with bytes-only get breadcrumb=null in the envelope; the engine has no version_id to resolve from, so a synthetic breadcrumb would be misleading"
    - "StreamableHTTPClientTransport dual-transport test pattern — instead of raw fetch + JSON-RPC framing, wire-level UAT uses MCP SDK's HTTP client transport so framing/content-type/SSE-vs-JSON negotiation matches a production agent"
    - "Payload-size cap below the engine boundary — Zod max(MAX_VERIFY_BYTES_BASE64=100MB) on manifest_bytes_base64 rejects oversized payloads BEFORE engine I/O (T-16-17)"

key-files:
  created:
    - src/tools/__tests__/version-tool-export-verify.test.ts
    - src/__tests__/version-tool-dual-transport-export-verify.test.ts
  modified:
    - src/tools/version-tool.ts

key-decisions:
  - "D-PLAN-3-1 implemented: BOTH tool actions land in this single Wave-2 plan (not split). Splitting would double the dual-transport test fixtures (each transport needs an independent server-spawn harness) without buying parallelism. Plan 16-04 carries the third arm (redact_manifest) when its engine module from Plan 16-02 is ready."
  - "D-PLAN-3-2 implemented: verify_manifest is a Zod union of two arms sharing `action: 'verify_manifest'` literal — discriminated by FIELD presence (version_id vs manifest_bytes_base64+format). Required widening VersionInputSchema from z.discriminatedUnion to z.union; deferred-items.md tracks v1.2 hand-written inputSchema for nicer JSON-Schema output."
  - "D-PLAN-3-3 honored: D-PROV-08 dual-form envelope contract (structuredContent + JSON-string mirror in content[0].text) used verbatim — no new envelope mechanism needed."
  - "D-PLAN-3-4 implemented: breadcrumb is NULL when caller invokes verify_manifest via bytes form. Engine has no version_id to resolve from; honest null beats synthetic breadcrumb. Verified at the wire boundary by Test 3 (stdio) + Test 11 (HTTP) of the dual-transport suite."
  - "D-PLAN-3-5 implemented + C-05 hardened: MAX_VERIFY_BYTES_BASE64=100 MB (NOT 700 MB). The verify payload is metadata, not asset bytes; 100 MB still admits any plausible JUMBF size while protecting against pathological DoS. T-16-17 mitigation."
  - "C-07 addressed at the wire boundary: INVALID_INPUT envelope deepEqual across HTTP and stdio (Test 14 of the dual-transport suite). Catches transport-specific error-formatting drift (Hono error middleware reshaping) BEFORE it reaches a real agent."

patterns-established:
  - "Zod union (NOT discriminatedUnion) for action arms with shared discriminator literal — first-matching-arm semantics in declaration order; field presence inside the handler routes to the right Engine facade overload"
  - "StreamableHTTPClientTransport for dual-transport tests — preferred over raw fetch + JSON-RPC framing because the SDK transport handles content-type/SSE/JSON negotiation transparently (matches production agent path)"
  - "Tool-layer envelope shaper pattern — small typed function `shape{Action}Envelope(...)` takes the engine result + ancillary breadcrumb, returns the structuredContent shape verbatim. Tool handler stays a one-liner (`return toolOk(shapeFoo(engineResult, breadcrumb));`)"

requirements-completed: []  # PROV-V-07 substantially complete at the wire boundary; cohort closure remains in Plan 16-05 (full e2e pipeline test)

# Metrics
duration: 11min
completed: 2026-04-30
---

# Phase 16 Plan 3: Tool Surface for Export + Verify Manifest Summary

**Two new `version` tool action arms (`export_manifest` + `verify_manifest`) wired through Plan 16-01's Engine facade with discriminated input, payload-size cap, and dual-transport parity guarantee.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-04-30T19:18:00Z (approx)
- **Completed:** 2026-04-30T19:29:07Z
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 1
- **Tests added:** 38 (25 unit + 13 dual-transport wire-level UAT)

## Accomplishments

- **PROV-V-07 wire-level surface complete.** Plan 16-01 landed the Engine facade methods; this plan wires them through the discriminated `version` tool's action enum so agents can invoke `version.export_manifest` and `version.verify_manifest` over BOTH stdio and Streamable HTTP transports. Cohort closure (full e2e + cross-shot scenarios) remains in Plan 16-05.
- **Tool action count grows from 4 to 6, top-level tool count unchanged at 7 (D-CTX-6).** No new MCP tool — purely additive within the existing `version` discriminated union. Tool budget cap (12) preserved with comfortable headroom.
- **D-PROV-08 dual-form envelope honored verbatim.** Both new actions emit `structuredContent` + `content[0].text` (JSON-string mirror). Dual-transport Test 13 asserts `JSON.parse(content[0].text) === structuredContent` at the HTTP wire boundary; Tests 9/10/11 assert HTTP-vs-stdio envelopes are byte-identical via deepEqual.
- **D-CTX-7 architecture-purity preserved.** Zero c2pa-node imports in `src/tools/version-tool.ts`. Tool delegates 100% to Engine facade methods. The architecture-purity allowed-set (`signer | exporter | verifier`) extended in Plan 16-01 already covers the engine layer; the tool layer simply consumes the facade.
- **T-16-17 DoS vector mitigated.** `MAX_VERIFY_BYTES_BASE64=100 MB` Zod cap on `manifest_bytes_base64` — oversized payloads rejected at the tool boundary BEFORE the engine attempts c2pa.read. The verify payload is metadata (~1 MB typical), not asset bytes; 100 MB cap admits any plausible JUMBF while protecting against pathological inputs.
- **C-07 error-path parity locked at the wire.** Test 14 of the dual-transport suite asserts the INVALID_INPUT envelope is byte-identical across HTTP and stdio. This catches transport-specific error-formatting drift (e.g., Hono error middleware reshaping the envelope) before it reaches a real agent.

## Task Commits

Each task was committed atomically:

| Task | Commit  | Subject                                                                  |
| ---- | ------- | ------------------------------------------------------------------------ |
| 1.RED | 73a0c97 | test(16-03): Task 1 RED — failing tests for export_manifest + verify_manifest tool actions |
| 1.GREEN | 1424d45 | feat(16-03): Task 1 GREEN — wire export_manifest + verify_manifest version-tool actions |
| 2 | 328a3bf | test(16-03): Task 2 — wire-level dual-transport parity for export_manifest + verify_manifest |

## Test Coverage

### Unit (`src/tools/__tests__/version-tool-export-verify.test.ts`) — 25 tests

| Section | Tests | Description |
|---------|-------|-------------|
| Zod validation — export_manifest | 4 | happy parse, missing version_id, empty version_id, version_id too long |
| Zod validation — verify_manifest | 7 | happy by-version_id, happy by-bytes, both missing, both present (version_id wins), base64 too large (100 MB cap), empty format, empty bytes |
| Dispatch + envelope — export_manifest | 5 | engine call wiring, VERSION_NOT_FOUND, EXPORT_PATH_TRAVERSAL_REJECTED, manifest_status=absent, manifest_status=unsupported_format |
| Dispatch + envelope — verify_manifest | 6 | by version_id (engine wiring + breadcrumb non-null), by bytes (engine wiring + breadcrumb NULL), base64 round-trip, invalid base64 graceful, VERSION_NOT_FOUND, C2PA_VERIFIER_LOAD_FAILED |
| Invariants | 3 | D-PROV-08 dual-form mirror (both actions), action enum lists all 6 literals, version-tool.ts has zero c2pa-node imports |

### Dual-transport wire-level UAT (`src/__tests__/version-tool-dual-transport-export-verify.test.ts`) — 13 tests

| Section | Tests | Description |
|---------|-------|-------------|
| Section A — STDIO signed (skipIf no openssl) | 6 | export present, verify by-version valid, verify by-bytes (breadcrumb null), VERSION_NOT_FOUND, INVALID_INPUT empty version_id, INVALID_INPUT no-discriminator |
| Section B — STDIO unsigned (always-on) | 2 | export absent, verify no_manifest |
| Section C — HTTP-vs-stdio parity (skipIf no openssl) | 5 | export deepEqual, verify by-version deepEqual, verify by-bytes deepEqual + breadcrumb null, D-PROV-08 dual-form at HTTP, INVALID_INPUT C-07 parity |

Both files use the Phase 14 c2pa-uat-mcp-tool.test.ts pattern: pre-seed a SQLite DB + outputs dir, close the DB cleanly, spawn `npx tsx src/server.ts` (stdio) AND `--http --port` (HTTP), connect MCP SDK clients to each, deepEqual the structuredContent. The HTTP harness uses `StreamableHTTPClientTransport` (not raw fetch) so the MCP SDK handles JSON-RPC framing, content-type negotiation, and SSE-vs-JSON response form transparently.

## Test Metrics Delta

| Suite | Before plan | After plan | Δ |
|-------|-------------|------------|---|
| Full vitest run (excluding pre-existing failures) | 1235 passing | 1273 passing (Plan 16-03 only) | +38 |
| Pre-existing failures (4 ROADMAP) | 4 | 4 | unchanged |

(With Plan 16-02 also landed in parallel, the full suite reaches ~1295 passing.)

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 — Test expectation] Test 2 message regex too tight for z.union without discriminator**

- **Found during:** Task 1 GREEN — `npx vitest run src/tools/__tests__/version-tool-export-verify.test.ts`
- **Issue:** Original Test 2 asserted `expect(sc.message).toMatch(/version_id/)` — but with z.union (no discriminator), the first ZodError issue surfaces at the union level (path: []), so the wrapped message is `Invalid input at 'input.'` (empty path). The CODE is correctly `INVALID_INPUT`; the message format is just less specific than discriminatedUnion would produce.
- **Fix:** Loosened the regex to `/Invalid input/` and added an inline comment documenting the trade-off + deferred-items.md hook for v1.2 hand-written inputSchema.
- **Files modified:** `src/tools/__tests__/version-tool-export-verify.test.ts`
- **Commit:** 1424d45 (in the Task 1 GREEN commit's test-file delta)

### Other notes

- **TS type cast on `actionSchema`** — Test 25 reads the registered `inputSchema.action` Zod schema and parses literal strings against it. The original cast `as z.ZodEnum<[string, ...string[]]>` failed under Zod v4's type constraint `Readonly<Record<string, EnumValue>>`. Switched to `as unknown as z.ZodType<string>` — runtime parse behavior identical, no Zod-version coupling. Documented inline.

- **No checkpoint encountered.** Plan executed fully autonomously per `autonomous: true` frontmatter. No deviations requiring user input.

## Coordination with Plan 16-02 (parallel)

Plan 16-02 ran in parallel and modified files outside Plan 16-03's `files_modified` set (`src/engine/c2pa/redaction.ts`, `src/engine/c2pa/manifest-builder.ts`, `src/engine/c2pa/index.ts`, `src/types/provenance.ts`, `src/store/provenance-repo.ts`, `src/__tests__/architecture-purity.test.ts`, `src/engine/errors.ts`). The user's prompt warned about potential coordination on `src/engine/errors.ts`. Plan 16-03 ended up NOT needing to add any new error codes — the existing `EXPORT_PATH_TRAVERSAL_REJECTED` + `C2PA_VERIFIER_LOAD_FAILED` (added by Plan 16-01) + `VERSION_NOT_FOUND` (Phase 1) cover all error surfaces this plan exercises. **No coordination edits to `src/engine/errors.ts` from this plan.**

The architecture-purity test was failing during my Task 1 execution because Plan 16-02's redaction.ts existed but wasn't yet in the allowed-set. By the time my full-suite verification ran at end of Task 2, Plan 16-02 had updated the allowed-set + filed file-level locks, so architecture-purity is GREEN end-to-end.

## Critical Constraints Honored

- **Tool layer THIN:** Zod validation + delegation to Engine facade. Zero c2pa-node imports in `src/tools/version-tool.ts` (Test 24 self-check + architecture-purity guard).
- **D-PROV-08 dual-form:** structuredContent + content[0].text JSON-string mirror — verified by Tests 23 (unit) + 13 (HTTP wire).
- **Action enum extended:** registerTool inputSchema.action lists all 6 literals so MCP tools/list reflects the new actions (RT-01 pattern; Test 25).
- **Breadcrumb honesty:** non-null + carries breadcrumb_text on version-id forms; NULL on pure-bytes verify path (D-PLAN-3-4; Tests 18 unit + 11 HTTP wire).
- **Payload-size cap:** MAX_VERIFY_BYTES_BASE64=100 MB on manifest_bytes_base64 (T-16-17; Test 9 unit).
- **Atomic commits:** Three commits — Task 1 RED (failing tests), Task 1 GREEN (implementation + tests pass), Task 2 (dual-transport tests). All conventional-commit format with `(16-03)` scope.
- **Architecture-purity:** verified by explicit grep guard at `<verify>` step + Test 24 self-check. Zero c2pa-node imports in tool layer.

## Self-Check: PASSED

- `src/tools/__tests__/version-tool-export-verify.test.ts` exists — VERIFIED
- `src/__tests__/version-tool-dual-transport-export-verify.test.ts` exists — VERIFIED
- `src/tools/version-tool.ts` modified — VERIFIED
- Commit 73a0c97 (Task 1 RED) — VERIFIED in `git log`
- Commit 1424d45 (Task 1 GREEN) — VERIFIED in `git log`
- Commit 328a3bf (Task 2) — VERIFIED in `git log`
- 25 unit tests pass — VERIFIED (`npx vitest run src/tools/__tests__/version-tool-export-verify.test.ts`)
- 13 dual-transport tests pass — VERIFIED (`npx vitest run src/__tests__/version-tool-dual-transport-export-verify.test.ts`)
- `npx tsc --noEmit` clean — VERIFIED
- Zero c2pa-node imports in version-tool.ts — VERIFIED (`grep -E "from\\s+['\\\"]c2pa-node|import\\s*\\(\\s*['\\\"]c2pa-node" src/tools/version-tool.ts` returns nothing)
- Architecture-purity test GREEN — VERIFIED (35/35 pass)

## Plan 16-04 Unblock

Plan 16-04 (redact_manifest tool action) is unblocked at the tool-layer pattern level — it follows the same z.union arm + envelope shaper pattern. It still depends on Plan 16-02's `Engine.redactManifestForVersion` facade method to dispatch to.

## Plan 16-05 Unblock

Plan 16-05 (e2e + cohort closure) is unblocked at the dual-transport harness level — it can reuse the `seedVersionInDb` + `connectStdio` + `connectHttp` helpers from `version-tool-dual-transport-export-verify.test.ts` for full e2e pipeline coverage.
