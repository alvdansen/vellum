---
status: partial
phase: 01-foundation-hierarchy
source: [01-VERIFICATION.md]
started: 2026-04-21T05:46:00Z
updated: 2026-04-21T05:46:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. MCP Inspector UI smoke over stdio
expected: Inspector UI opens, tool panel lists exactly 4 tools (workspace/project/sequence/shot); invoking `workspace action=create name=test` returns structuredContent with breadcrumb + breadcrumb_text; invoking `shot action=create sequenceId=<from earlier> name=sh010` succeeds; invoking `shot action=create sequenceId=<same> name=SH010` returns isError:true with code:INVALID_SHOT_FORMAT

how to run: `npx @modelcontextprotocol/inspector npx tsx src/server.ts` (or `npm run inspect`) — opens browser UI that spawns the server over stdio.

result: [pending]

### 2. MCP Inspector UI smoke over Streamable HTTP
expected: Terminal 1: `npx tsx src/server.ts --http` (or `npm run start:http`). Terminal 2: `npx @modelcontextprotocol/inspector` (or `npm run inspect:http`), then in the Inspector UI select "Streamable HTTP" and URL http://127.0.0.1:3000/mcp. Inspector UI shows the same 4 tools as the stdio run; same create/list/get actions succeed; invalid shot names return isError:true

result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
