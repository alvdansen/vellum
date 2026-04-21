---
status: resolved
phase: 01-foundation-hierarchy
source: [01-VERIFICATION.md]
started: 2026-04-21T05:46:00Z
updated: 2026-04-21T06:00:00Z
resolution: automated
resolution_method: "programmatic MCP SDK client (scripts/inspector-smoke.mjs) drives both transports with the same Inspector contract assertions"
---

## Current Test

[all automated — no pending human action]

## Tests

### 1. MCP Inspector UI smoke over stdio
expected: Inspector UI opens, tool panel lists exactly 4 tools (workspace/project/sequence/shot); invoking `workspace action=create name=test` returns structuredContent with breadcrumb + breadcrumb_text; invoking `shot action=create sequenceId=<from earlier> name=sh010` succeeds; invoking `shot action=create sequenceId=<same> name=SH010` returns isError:true with INVALID_SHOT_FORMAT surfaced.

how to run (human UI): `npm run inspect`

how run (automated): `node scripts/inspector-smoke.mjs` — uses real MCP SDK `Client` + `StdioClientTransport`. Same handshake, same tool-list + invocation path as the browser Inspector.

result: PASSED (automated) — 28/28 wire-level assertions on stdio transport: tool discovery (4 tools), full 4-level hierarchy walk (workspace → project → sequence → shot), breadcrumb_text + breadcrumb array at every level, SH010 returns isError:true with INVALID_SHOT_FORMAT sentinel in content text, DUPLICATE_NAME + PARENT_NOT_FOUND carry structuredContent.code, no SQLite leakage, list pagination envelope, get-by-id round-trip.

### 2. MCP Inspector UI smoke over Streamable HTTP
expected: Same as test 1, but over the live Hono + StreamableHTTPServerTransport stack. Proves transport parity at the wire-protocol level (not just InMemoryTransport).

how to run (human UI): `npm run start:http` (terminal 1) + `npm run inspect:http` (terminal 2).

how to run (automated): covered in the same `scripts/inspector-smoke.mjs` run — it spawns the server with `--http --port 3097` and drives it with `StreamableHTTPClientTransport`.

result: PASSED (automated) — 28/28 wire-level assertions on HTTP transport, identical to the stdio run. Confirms transport parity at the protocol layer.

### Notable findings from the live smoke run

1. **Zod-level validation is intercepted by MCP SDK 1.29 before the handler.** Shot SH010 returns `{ isError: true, content: [{ text: "MCP error -32602: ... INVALID_SHOT_FORMAT ..." }] }` — no `structuredContent` field. The sentinel message is still surfaced in the content text, so agents see actionable error info, but structured `{ code: "INVALID_SHOT_FORMAT" }` is absent for Zod-layer failures. Engine-level TypedErrors (DUPLICATE_NAME, PARENT_NOT_FOUND) DO carry `structuredContent.code` correctly because they come from the engine via the handler's catch block. Filed as a Phase 2+ follow-up (optional): flatten Zod errors into the same typed envelope so `structuredContent.code` is present on every isError response.

2. **Entity objects use snake_case DB column names** (`workspace_id`, not `workspaceId`) in structuredContent. Consistent with the Drizzle schema; relevant for agents building clients.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

(no blocking gaps; one Phase 2+ follow-up noted above on flattening Zod errors into the typed envelope)
