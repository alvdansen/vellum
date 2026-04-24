---
phase: 01-foundation-hierarchy
plan: 02
subsystem: mcp-tools
tags: [mcp, tools, zod, zod-v4, typescript, validation, envelope, breadcrumbs]

# Dependency graph
requires:
  - phase: 01-01
    provides: Engine facade (12 methods), TypedError + 8 ErrorCodes, Breadcrumb types, FakeEngine spy, makeInMemoryDb fixture
provides:
  - 4 MCP tool registrations (workspace, project, sequence, shot) — TOOL-01 budget 4/12
  - Zod v4 discriminated-union input schemas gated by `action: create | list | get`
  - Dual-form response envelope (structuredContent + content:[text]) via toolOk
  - TypedError → `{isError:true, structuredContent:{code,message,hint?}}` via toolError
  - shapeCreateOrGet / shapeList helpers that inject breadcrumb + breadcrumb_text at every response level
  - ZodError → INVALID_INPUT re-wrap with `input.<path>` in message (D-32)
  - Shot-tool regex gate at Zod boundary + sentinel-message detection → INVALID_SHOT_FORMAT with hint
  - Defence-in-depth: no SQLite / raw Error / Zod stack ever reaches the agent
  - src/tools/index.ts barrel for Plan 03 to import
affects: [01-03, 02-01, 03-01, 04-01]

# Tech tracking
tech-stack:
  added: []  # no new runtime deps; all already installed in Wave 1
  patterns:
    - "S2: Dual-form response envelope — every tool uses toolOk / toolError, never constructs responses directly"
    - "S3 (extended): TypedError wrapping now holds at the tool boundary — envelope.toolError is the single mapping point"
    - "S4 (extended): Breadcrumb-on-every-response — shape.ts is the single translation point from engine Breadcrumb to {breadcrumb, breadcrumb_text}"
    - "T1: Tool delegate shape — Zod discriminated union on action + try/catch + one engine call per action + ZodError re-wrap. 4 tools, ~60 lines each, zero business logic. Replicable pattern for Phases 2-5 remaining 8 tools."
    - "T2: Defence-in-depth for regex/validation: both Zod at tool boundary AND engine inner regex check. Used for shot-tool now; same pattern applies to any future validated-string input."

key-files:
  created:
    - "src/tools/envelope.ts"
    - "src/tools/shape.ts"
    - "src/tools/workspace-tool.ts"
    - "src/tools/project-tool.ts"
    - "src/tools/sequence-tool.ts"
    - "src/tools/shot-tool.ts"
    - "src/tools/index.ts"
    - "src/tools/__tests__/envelope.test.ts"
    - "src/tools/__tests__/error-wrapping.test.ts"
    - "src/tools/__tests__/breadcrumb-always.test.ts"
  modified: []

key-decisions:
  - "shapeCreateOrGet + shapeList live in a shared src/tools/shape.ts module rather than being duplicated per tool — plan allowed either; shared module keeps each tool ~60 lines and makes the breadcrumb shape contract a single-edit point for Phases 2-5"
  - "Each tool's Zod-failure branch constructs an explicit TypedError('INVALID_INPUT', `Invalid input at 'input.${path}' -- ${first.message}`) so the failed path is surfaced to the agent (D-32 literal) while staying free of raw Zod stack shape"
  - "shot-tool catches its Zod-regex failure via a sentinel message ('INVALID_SHOT_FORMAT' passed as the regex error message) so the specific INVALID_SHOT_FORMAT typed code with the correct hint is produced at the tool layer — the engine ALSO checks the regex, so defence in depth holds if any future adapter bypasses the tool"
  - "Task 4 integration tests use the 'direct mirror' approach (plan-allowed fallback): tests call engine + shapers + envelope exactly like each registered handler does, plus a smoke test that registerX registers 4 tools against a real McpServer. The MCP SDK's `_registeredTools.handler` is private and driving it requires a JSON-RPC transport — disproportionate for unit-scale tests."
  - "toolOk typed as `structured: { [key: string]: unknown }` (not `unknown`) to match MCP SDK 1.29's CallToolResult structured-content requirement. Tightens the API without constraining what shape of payload flows through."

patterns-established:
  - "Canonical Tool Delegate Shape (T1): import z + McpServer + Engine + TypedError + {toolOk,toolError} + {shapeCreateOrGet,shapeList}. Define CreateInput/ListInput/GetInput z.objects with .default(20)/.default(0) on list. Combine via z.discriminatedUnion('action', [...]). Export registerX(server, engine) that calls server.registerTool(name, {title, description, inputSchema}, async handler). Handler: try { switch(input.action) { case 'create': toolOk(shapeCreateOrGet(engine.createX(...))); ... } } catch(err) { if (err instanceof z.ZodError) toolError(new TypedError('INVALID_INPUT', ...)); return toolError(err); }. See src/tools/workspace-tool.ts for the canonical form."
  - "Breadcrumb injection contract (S4 extended): Engine returns `{entity, breadcrumb: {entries, text}}` internally. Tools emit `{entity, breadcrumb: BreadcrumbEntry[], breadcrumb_text: string}` to agents. The translation is a single shape.ts helper applied via `toolOk(shapeCreateOrGet(...))` — no tool ever re-shapes manually."
  - "List envelope (S8 extended): `{items, total, limit, offset}` with defaults limit=20/offset=0. Items are entity fields + their own `breadcrumb` + `breadcrumb_text`. Phase 4 search will inherit this shape verbatim."
  - "Defence-in-depth regex (T2): Shot regex ^sh\\d{3,}$ is enforced at Zod level in shot-tool.ts AND at engine.createShot level (Wave 1). Either layer alone suffices; both together means any future bypass (direct engine call, alternative adapter, test harness) still fails closed."

requirements-completed: [HIER-01, HIER-02, HIER-03, HIER-04, HIER-05, HIER-06, TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05]

# Metrics
duration: ~9min
completed: 2026-04-21
---

# Phase 01 Plan 02: MCP Tool Surface Summary

**Four coarse-grained MCP tools (workspace, project, sequence, shot) each exposing `create | list | get` actions via Zod v4 discriminated-union schemas, all delegating to the Wave 1 Engine through a dual-form response envelope with TypedError wrapping and breadcrumb-on-every-response.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-21T05:00:30Z
- **Completed:** 2026-04-21T05:09:14Z
- **Tasks:** 4 of 4
- **Files created:** 10 (6 production + 4 test/helper)
- **Files modified:** 0
- **Commits:** 4 task commits + 1 final metadata commit
- **Tests authored (Wave 2):** 27 (9 envelope + 9 error-wrapping + 9 breadcrumb-always)
- **Full suite:** 66 / 66 passing (39 Wave 1 + 27 Wave 2) in ~400 ms
- **Tool budget:** 4 of 12 used (TOOL-01 / D-04 compliant)

## Accomplishments

- **4 MCP tools registered.** `registerWorkspace` / `registerProject` / `registerSequence` / `registerShot` each register a coarse-grained tool with a Zod v4 discriminated-union input and a thin handler that delegates one engine call per action. Plan 03 will import them from `src/tools/index.ts` and wire them to the server.
- **Tool budget locked at 4 of 12.** `grep -rc "server.registerTool" src/tools/ | awk '{s+=$2} END {print s}'` returns exactly 4. The remaining 8 tools are reserved for Phases 2-5 per D-04.
- **Dual-form response envelope is the single mapping point.** `toolOk(structured)` emits `{structuredContent, content:[{type:'text',text:JSON.stringify(structured)}]}`; `JSON.parse(content[0].text)` deep-equals `structuredContent` by contract (D-25). Every tool success routes through here.
- **TypedError -> isError envelope locked.** `toolError(err)` produces `{isError:true, structuredContent:{code,message,hint?}}` when given a `TypedError`, omits the `hint` key when absent (D-31), and falls back to `{code:'INVALID_INPUT', message:'Unexpected internal error'}` for any non-TypedError with stderr-only logging (D-21). Regex-verified: no `SQLITE_CONSTRAINT_*` string ever reaches the agent.
- **Breadcrumb-on-every-response invariant holds.** `shapeCreateOrGet` and `shapeList` are the only two functions that touch the `{entity, breadcrumb: {entries, text}}` engine shape and emit the tool-facing `{entity, breadcrumb: BreadcrumbEntry[], breadcrumb_text: string}` form. Verified by 9 breadcrumb-always tests covering 1-level (workspace) through 4-level (shot) breadcrumb traversal plus list-item breadcrumb carry-over.
- **Shot regex gated at both layers.** shot-tool applies `/^sh\d{3,}$/` via Zod with a sentinel message, re-maps the sentinel to `TypedError('INVALID_SHOT_FORMAT', ..., hint)`, and the Wave 1 engine redundantly enforces the same regex. Tests verify `SH010`, `sh1`, `sh_010` all fail with INVALID_SHOT_FORMAT; `sh010` succeeds.
- **Pattern S1 (tool-engine purity) still holds.** `grep -r "@modelcontextprotocol/sdk" src/engine/ src/store/ src/utils/ src/types/` returns zero matches. The tool layer is the only place the MCP SDK is imported.

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Response envelope helpers (toolOk + toolError) | `052a210` | feat |
| 2 | Workspace + Project tools + shape.ts helpers | `be90a3d` | feat |
| 3 | Sequence + Shot tools + barrel; TOOL-01 cap = 4 | `53534c9` | feat |
| 4 | Error-wrapping + breadcrumb-always integration tests | `7d31518` | test |

## Files Created

**Production layer (6):**
- `src/tools/envelope.ts` — `toolOk(structured)` + `toolError(err)` helpers. Sole point of MCP-shape response construction.
- `src/tools/shape.ts` — `shapeCreateOrGet` + `shapeList`. Sole translation between engine `Breadcrumb` and tool-facing `{breadcrumb, breadcrumb_text}`.
- `src/tools/workspace-tool.ts` — `registerWorkspace(server, engine)`. Zod discriminated union on `action`, 3 engine calls total (createWorkspace / listWorkspaces / getWorkspace). ~60 lines.
- `src/tools/project-tool.ts` — `registerProject`. Adds required `workspaceId` on create, optional filter on list. ~70 lines.
- `src/tools/sequence-tool.ts` — `registerSequence`. Adds required `projectId` on create, optional filter on list. ~70 lines.
- `src/tools/shot-tool.ts` — `registerShot`. Adds required `sequenceId` + `name` regex gate at Zod, handler catches the regex sentinel to emit INVALID_SHOT_FORMAT with the canonical hint. ~85 lines.
- `src/tools/index.ts` — Barrel re-exporting all 4 register functions. Plan 03 consumes this.

**Tests (3):**
- `src/tools/__tests__/envelope.test.ts` — 9 unit tests for toolOk / toolError including D-31 hint-absent invariant and D-13 SQLite-leak defence.
- `src/tools/__tests__/error-wrapping.test.ts` — 9 integration tests: TypedError passthrough, Zod-failure rewrap, raw-error non-leakage, shot-regex enforcement for 3 invalid names, plus a smoke test that all 4 registerX functions register on a real McpServer and produce the 4 expected tool names.
- `src/tools/__tests__/breadcrumb-always.test.ts` — 9 integration tests: 1/2/3/4-level breadcrumb walks on create + get, list envelope shape `{items,total,limit,offset}` with defaults 20/0, custom pagination `limit=2 offset=1`, each list item carries its own breadcrumb + breadcrumb_text.

## Canonical Tool Delegate Shape (for Phases 2-5)

Every future MCP tool (8 remaining of 12) should replicate this pattern:

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError } from './envelope.js';
import { shapeCreateOrGet, shapeList } from './shape.js';

const CreateInput = z.object({ action: z.literal('create'), /* ...fields... */ });
const ListInput = z.object({
  action: z.literal('list'),
  /* ...optional filters... */
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
const GetInput = z.object({ action: z.literal('get'), id: z.string().min(1) });
const ToolInput = z.discriminatedUnion('action', [CreateInput, ListInput, GetInput]);

export function registerX(server: McpServer, engine: Engine) {
  server.registerTool('x', { title, description, inputSchema: ToolInput }, async (input) => {
    try {
      switch (input.action) {
        case 'create': return toolOk(shapeCreateOrGet(engine.createX(/* ... */)));
        case 'list':   return toolOk(shapeList(engine.listX(/* ... */, input.limit, input.offset)));
        case 'get':    return toolOk(shapeCreateOrGet(engine.getX(input.id)));
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        const first = err.issues[0];
        const path = first.path.join('.');
        return toolError(new TypedError('INVALID_INPUT', `Invalid input at 'input.${path}' -- ${first.message}`));
      }
      return toolError(err);
    }
  });
}
```

Invariants future tools must maintain:
1. **One engine call per action.** No orchestration in the tool layer.
2. **Always route through toolOk / toolError.** Never construct responses by hand.
3. **Always apply shapeCreateOrGet / shapeList.** Breadcrumb injection is invisible to the tool body.
4. **Zod ZodError catch before generic catch.** INVALID_INPUT must reach the agent, not Zod's stack shape.
5. **List input must carry `limit.default(20)` + `offset.default(0)`.** S8 shape is locked.

## Example Response Shapes (for Plan 03 integration tests)

**Success (workspace create):**
```json
{
  "structuredContent": {
    "entity": { "id": "ws_abc...", "name": "demo", "naming_template": null, "created_at": 1234567890 },
    "breadcrumb": [{ "type": "workspace", "id": "ws_abc...", "name": "demo" }],
    "breadcrumb_text": "demo"
  },
  "content": [{ "type": "text", "text": "{\"entity\":{...},\"breadcrumb\":[...],\"breadcrumb_text\":\"demo\"}" }]
}
```

**Success (shot create, 4-level breadcrumb):**
```json
{
  "structuredContent": {
    "entity": { "id": "shot_...", "name": "sh010", "sequence_id": "seq_...", "created_at": 1234567890 },
    "breadcrumb": [
      { "type": "workspace", "id": "ws_...", "name": "demo-ws" },
      { "type": "project",   "id": "proj_...", "name": "my-proj" },
      { "type": "sequence",  "id": "seq_...", "name": "sq010" },
      { "type": "shot",      "id": "shot_...", "name": "sh010" }
    ],
    "breadcrumb_text": "demo-ws > my-proj > sq010 > sh010"
  },
  "content": [{ "type": "text", "text": "..." }]
}
```

**Success (workspace list, default pagination):**
```json
{
  "structuredContent": {
    "items": [
      {
        "id": "ws_a...", "name": "ws-a", "naming_template": null, "created_at": 111,
        "breadcrumb": [{ "type": "workspace", "id": "ws_a...", "name": "ws-a" }],
        "breadcrumb_text": "ws-a"
      }
    ],
    "total": 1, "limit": 20, "offset": 0
  },
  "content": [{ "type": "text", "text": "..." }]
}
```

**Error (INVALID_SHOT_FORMAT):**
```json
{
  "isError": true,
  "structuredContent": {
    "code": "INVALID_SHOT_FORMAT",
    "message": "Shot name does not match expected format",
    "hint": "Shot names must match ^sh\\d{3,}$ -- e.g. 'sh010', 'sh020'"
  },
  "content": [{ "type": "text", "text": "..." }]
}
```

**Error (DUPLICATE_NAME):**
```json
{
  "isError": true,
  "structuredContent": {
    "code": "DUPLICATE_NAME",
    "message": "Workspace 'ws1' already exists",
    "hint": "Pick a different name or list existing workspaces with { tool: 'workspace', action: 'list' }"
  },
  "content": [{ "type": "text", "text": "..." }]
}
```

**Error (INVALID_INPUT from Zod):**
```json
{
  "isError": true,
  "structuredContent": {
    "code": "INVALID_INPUT",
    "message": "Invalid input at 'input.name' -- Too small: expected string to have >=1 characters"
  },
  "content": [{ "type": "text", "text": "..." }]
}
```

## Decisions Made

- **shape.ts shared module vs. per-tool duplication.** The plan explicitly allowed either. Chose shared to (a) keep each tool file at ~60 lines (D-33 asks for ≤40 but the per-entity deltas for project/sequence/shot add ~15 lines each; shared shapers avoid a further 20 lines of duplication), (b) make the breadcrumb contract a single-edit point if Phases 2-5 extend it, and (c) keep each tool body strictly about action dispatch. This is a legitimate planner-sanctioned variation.
- **toolOk signature tightened to `structured: { [key: string]: unknown }`.** MCP SDK 1.29's `CallToolResult.structuredContent` requires an object, not `unknown`. The original plan snippet typed it as `unknown` but that fails TypeScript narrowing. Tightened without constraining payload content (index signature accepts any field shape).
- **Zod-failure re-wrap constructs a fresh TypedError.** The plan suggested this pattern and it landed verbatim — catches `z.ZodError`, reads `first.issues[0]`, joins `path` as a dotted string, emits `TypedError('INVALID_INPUT', \`Invalid input at 'input.${path}' -- ${first.message}\`)`. This preserves the Zod-native "which field" context for the agent without exposing Zod stack shape (D-32).
- **shot-tool Zod regex message is the sentinel 'INVALID_SHOT_FORMAT'.** Allows the handler to detect the specific regex failure in `first.message` and emit the right typed error with the canonical hint, versus falling through to the generic INVALID_INPUT path. The engine also independently enforces the regex so direct engine callers still get INVALID_SHOT_FORMAT (T2 defence in depth).
- **Integration tests use direct-mirror pattern (plan-allowed fallback).** MCP SDK's `_registeredTools.handler` is private and protocol-driven. Reaching it via casting would couple tests to SDK internals. The plan explicitly sanctioned "call the engine + shape + envelope directly (mirrors what the tool would do, still verifies the contract)" — used, plus one smoke test confirming all 4 `registerX` functions register against a real `McpServer` and produce the 4 expected tool names under `_registeredTools`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Envelope test assertion collided with canonical fallback message**
- **Found during:** Task 1 (envelope tests)
- **Issue:** Test case 'plain object fallback' asserted `wireForm.not.toContain('internal')`, but the canonical fallback message is "Unexpected internal error". The word 'internal' legitimately appears in every fallback response.
- **Fix:** Replaced test-input field values `{some: 'plain object', detail: 'internal'}` with non-colliding values `{some: 'plain-object-secret', detail: 'classified-detail-xyz'}`. Assertion now precisely tests that these test-specific values don't leak, without false-positive on the canonical fallback string.
- **Files modified:** src/tools/__tests__/envelope.test.ts
- **Verification:** 9/9 envelope tests pass post-fix.
- **Committed in:** `052a210` (Task 1 commit)

**2. [Rule 3 - Blocking] toolOk return type's `unknown` broke MCP SDK CallToolResult typing**
- **Found during:** Task 2 (workspace + project tools)
- **Issue:** The plan's literal pattern `toolOk(structured: unknown)` produced `structuredContent: unknown`. MCP SDK 1.29 `ToolCallback` requires `structuredContent?: { [x: string]: unknown } | undefined`. Handler compile-failed with TS2345 on every tool.
- **Fix:** Tightened `toolOk(structured: StructuredContent)` where `StructuredContent = { [key: string]: unknown }`. Accepts any object payload; rejects bare primitives (which were never a legitimate response shape anyway). Existing 9 envelope tests still pass unchanged.
- **Files modified:** src/tools/envelope.ts
- **Verification:** `npx tsc --noEmit` exits 0 across full src tree; 9/9 envelope tests green.
- **Committed in:** `be90a3d` (Task 2 commit)

**3. [Rule 3 - Blocking] shapeList's generic constraint too strict for actual engine return type**
- **Found during:** Task 2 (workspace + project tools)
- **Issue:** Initial `shapeList<TItem extends Record<string, unknown>>` rejected `WithBreadcrumb<Workspace>[]` from the engine because `Workspace` doesn't declare a string index signature. TS2345 on both tools' list branches.
- **Fix:** Relaxed generic to `shapeList<TItem>(result: { items: (TItem & Breadcrumb)[]; ... })`. The cast to `TItem & {entries, text}` inside is still safe because the engine contract guarantees Breadcrumb is merged into every item.
- **Files modified:** src/tools/shape.ts
- **Verification:** `npx tsc --noEmit` clean across all 4 tools.
- **Committed in:** `be90a3d` (Task 2 commit)

**4. [Rule 1 - Bug] error-wrapping test response variables lacked TS narrowing for isError**
- **Found during:** Task 4 (error-wrapping integration tests)
- **Issue:** `invokeCreate` / `invokeShotCreate` returned `ReturnType<typeof toolOk> | ReturnType<typeof toolError>`, but `toolOk`'s return shape lacks `isError`, so TS2339 fired on every `res.isError` assertion. Runtime-correct (isError is absent on success variants) but compiler-rejected.
- **Fix:** Introduced a `ToolResponse` type alias in the test file matching MCP's CallToolResult shape (`isError?: boolean` on both variants) and typed the helper return types as `ToolResponse`. Also replaced a CJS `require('zod')` with the ESM top-level `import { z } from 'zod'` — `require` is not defined in ESM test files under NodeNext.
- **Files modified:** src/tools/__tests__/error-wrapping.test.ts
- **Verification:** `npx tsc --noEmit` clean; 9/9 error-wrapping tests green.
- **Committed in:** `7d31518` (Task 4 commit)

---

**Total deviations:** 4 auto-fixed (1 test-authoring bug, 2 blocking type errors from plan-literal code, 1 test-narrowing type bug)
**Impact on plan:** Zero functional regression. All four are mechanical adjustments to the plan's pattern sketches to match the actual engine + MCP SDK type surface. No behavior changed; no architectural deviation. The canonical tool shape as shipped matches every invariant in the plan's `<must_haves>` and `<success_criteria>` sections.

## Issues Encountered

None outside the 4 deviations above. All 4 tasks executed in order without rollback. Each task's automated verify passed on first attempt after the deviations were resolved.

## User Setup Required

None — the tool layer is pure in-process code. No external services, no env vars, no config. Plan 03 will introduce the CLI surface.

## Threat Surface

No new threat surface introduced beyond the plan's `<threat_model>` register. All 8 mitigations are in place and test-verified:

- **T-02-01 Tampering (Zod discriminated union gates every call):** Verified — each of 4 tools uses `z.discriminatedUnion('action', [...])` as its inputSchema. Zod-failure path re-wraps as INVALID_INPUT (error-wrapping test #4).
- **T-02-02 Information Disclosure (envelope fallback log-only, no raw leakage):** Verified — envelope test #5 + error-wrapping test #5 both assert `JSON.stringify(response)` contains no `SQLITE_CONSTRAINT`, no `SQLITE_MISUSE`, no original error text. Stderr-spy confirms logging occurs but response body omits.
- **T-02-03 Information Disclosure (tool descriptions factual, no agent-poisoning imperatives):** Verified by inspection — each tool description is a noun-phrase + action list (e.g., "Manage workspaces (top-level hierarchy container). Actions: create, list, get."). No "you must", no credential-fishing, no imperative that would flip agent behavior.
- **T-02-04 Denial of Service (limit cap 100, offset unbounded but paginated):** Verified — all 4 ListInput schemas use `z.number().int().min(1).max(100).default(20)` on limit; breadcrumb-always test #9 asserts echo of custom limit/offset, and Zod rejects limit>100 before the engine is touched.
- **T-02-05 Tampering (shot regex literal, both layers):** Verified — `^sh\d{3,}$` is a literal regex in `shot-tool.ts` AND in `pipeline.ts`. No runtime construction, no agent control. Error-wrapping tests 6-8 exercise all 3 common bypass attempts (uppercase, too-few-digits, underscore).
- **T-02-06 Elevation of Privilege (tool names hardcoded string literals):** Verified — grep for `server.registerTool\('` across src/tools/ returns 4 literal strings: 'workspace', 'project', 'sequence', 'shot'. No dynamic registration.
- **T-02-07 and T-02-08** remain as-accepted per the plan (breadcrumb entity id/name exposure is authorized; Zod path in INVALID_INPUT message is caller-known input shape).

## Open Loose Ends for Plan 03

- **No src/server.ts yet.** Plan 03 writes the CLI parser + dual-transport bootstrap + registers all 4 tools via `src/tools/index.ts`.
- **Transport parity test, stdio-hygiene test, zero-config test** (from VALIDATION.md) remain to be written in Plan 03 — they depend on a real server.
- **Architecture-purity test** (from VALIDATION.md, D-33) could be added now but the plan scoped it to Plan 03's validation sweep. grep-verified manually as a pre-commit check for Wave 2.
- **MCP Inspector smoke tests** (both transports) remain manual verifications blocked until Plan 03 delivers the server.
- **Tool-budget test** (from VALIDATION.md): could be added as a unit test checking `server._registeredTools` has exactly 4 keys after all 4 registers run. The smoke test in error-wrapping.test.ts covers the same invariant inline; a dedicated file can be added later if desired.

## Next Phase Readiness

Plan 03 (server bootstrap) is unblocked. Its dependency on Plan 02 was `src/tools/index.ts` re-exporting `registerWorkspace`, `registerProject`, `registerSequence`, `registerShot` — all four are exported and verified via the Task 4 smoke test. Plan 03 needs only to:

1. Import from `./tools/index.js`
2. Construct an Engine (Wave 1)
3. Construct an McpServer
4. Call the 4 `register*` functions against it
5. Connect stdio transport (always) + optional Streamable HTTP via Hono (`--http` flag)

No further tool-layer work is needed for Phase 1. Phases 2-5 add the remaining 8 tools by replicating the canonical shape documented above.

## Self-Check: PASSED

- All 10 files created exist at listed paths (7 production + 3 test)
- All 4 task commits exist in `git log --oneline -10`
- Full test suite (`npx vitest run`) exits 0 with 66/66 passing
- `npx tsc --noEmit` exits 0
- `src/tools/index.ts` re-exports all 4 `registerX` functions
- `grep -rc "server.registerTool" src/tools/` totals exactly 4
- Zero `@modelcontextprotocol/sdk` imports under `src/engine`, `src/store`, `src/utils`, `src/types`
- Zero `TODO`, `FIXME`, placeholder, or stub markers under `src/tools/`
- Every create/get shape emits `breadcrumb` array + `breadcrumb_text` string via shape.ts
- Every list envelope is `{items, total, limit, offset}` with defaults 20/0 verified by test

---
*Phase: 01-foundation-hierarchy*
*Plan: 02*
*Completed: 2026-04-21*
