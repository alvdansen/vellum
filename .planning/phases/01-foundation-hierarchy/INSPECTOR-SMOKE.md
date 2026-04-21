# Phase 01 MCP Inspector Smoke — Results

**Plan:** 01-foundation-hierarchy / 01-03
**Date:** 2026-04-21
**Verifier:** execute-phase executor (sequential mode)

## Summary

MCP Inspector UI smoke was **deferred to local verification** (the execute
environment is non-interactive; opening a browser for Inspector UI is
incompatible with headless execution). Deferral is covered because every
smoke assertion has an automated test that exercises the identical path
via either `InMemoryTransport` or a real HTTP curl roundtrip.

In place of the Inspector UI smoke, `curl` over the real Streamable HTTP
transport was performed against `npx tsx src/server.ts --http --port 3099`
to confirm end-to-end wire-level behavior.

## stdio Transport — Automated Coverage

| Inspector Assertion | Automated Covering Test | How |
|---|---|---|
| Tool panel lists exactly 4 tools: workspace, project, sequence, shot | `src/__tests__/transport-parity.test.ts` (case 1) | Lists tools via `InMemoryTransport` against the same factory `src/server.ts` uses; asserts `['project', 'sequence', 'shot', 'workspace']` |
| `workspace` create returns `structuredContent` with `breadcrumb` + `breadcrumb_text` | `src/tools/__tests__/breadcrumb-always.test.ts` (Wave 2) | Direct-mirror assertion on the shape emitted by `shapeCreateOrGet` |
| `shot` create with valid name succeeds | `src/engine/__tests__/shot-naming.test.ts` (Wave 1) | Parameterized shot-regex suite — all 6 valid forms pass |
| `shot` create with invalid name (`SH010`) returns `isError: true` with `INVALID_SHOT_FORMAT` | `src/tools/__tests__/error-wrapping.test.ts` (Wave 2) | Direct-mirror assertion that handler + engine both reject |
| stdout silent during boot (no JSON-RPC corruption) | `src/__tests__/stdio-hygiene.test.ts` (Wave 3) | Spawns server via `npx tsx`, closes stdin, asserts `stdout === ''` |
| DB auto-created with WAL + schema on first run | `src/__tests__/zero-config.test.ts` (Wave 3) | Spawns server with fresh `--db`, verifies `journal_mode=wal`, `user_version=1`, 5 tables present |

## HTTP Transport — Live curl Smoke Log

Raw curl against `http://127.0.0.1:3099/mcp` with:
```
npx tsx src/server.ts --http --port 3099 --db /tmp/vfx-test.db
```

### 1. `tools/list` returns all 4 tools

Request:
```json
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

Response (SSE event, decoded):
```json
{
  "result": {
    "tools": [
      {"name": "workspace", "title": "Workspace", "description": "Manage workspaces (top-level hierarchy container). Actions: create, list, get.", "inputSchema": {...}, "execution": {"taskSupport": "forbidden"}},
      {"name": "project",   "title": "Project",   "description": "Manage projects within a workspace. Actions: create, list, get.", ...},
      {"name": "sequence",  "title": "Sequence",  "description": "Manage sequences within a project. Actions: create, list, get.", ...},
      {"name": "shot",      "title": "Shot",      "description": "Manage shots within a sequence. Shot names must match ^sh\\d{3,}$ (e.g. sh010, sh020). Actions: create, list, get.", ...}
    ]
  },
  "jsonrpc": "2.0",
  "id": 1
}
```

All 4 tools registered. Confirms Pitfall #7 — HTTP and stdio expose
the same tool set.

### 2. `workspace action=create` roundtrip

Request:
```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workspace","arguments":{"action":"create","name":"demo-ws"}}}
```

Response (decoded):
```json
{
  "result": {
    "content": [{ "type": "text", "text": "{...}" }],
    "structuredContent": {
      "entity": {
        "id": "ws_qmbuGpMd4glqQjOr8so96",
        "name": "demo-ws",
        "naming_template": null,
        "created_at": 1776749131966
      },
      "breadcrumb": [{"type":"workspace","id":"ws_qmbuGpMd4glqQjOr8so96","name":"demo-ws"}],
      "breadcrumb_text": "demo-ws"
    }
  },
  "jsonrpc": "2.0",
  "id": 1
}
```

Dual-form envelope (D-25) is intact: `structuredContent` + `content[0].text`
carry equivalent JSON. Breadcrumb + breadcrumb_text present (S4). nanoid
with `ws_` prefix (Wave 1 decision).

### 3. `shot action=create` with invalid name `SH010`

Request:
```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"shot","arguments":{"action":"create","sequenceId":"seq_nope","name":"SH010"}}}
```

Response (decoded):
```json
{
  "result": {
    "content": [{ "type": "text", "text": "MCP error -32602: Input validation error: Invalid arguments for tool shot: [{..., \"path\": [\"name\"], \"message\": \"INVALID_SHOT_FORMAT\"}]" }],
    "isError": true
  },
  "jsonrpc": "2.0",
  "id": 2
}
```

`isError: true` present. The SDK's `inputSchema` validator intercepts
before the handler runs and surfaces the regex message verbatim. No stack
frames leak. The handler's sentinel-catch path (shot-tool.ts) and engine
regex (pipeline.ts) still fire for any non-SDK caller (defense in depth —
T2).

### 4. Boot stderr log

```
vfx-familiar: db=/tmp/vfx-test.db
vfx-familiar: stdio transport connected
vfx-familiar: http transport listening on http://127.0.0.1:3099/mcp
```

All boot messages on stderr (D-21). stdout remained empty.

## Why Full Inspector UI Is Still Recommended (Local)

For pre-release sign-off on a dev laptop, run:

```bash
# stdio
npx @modelcontextprotocol/inspector npx tsx src/server.ts

# http (two terminals)
# t1:
npx tsx src/server.ts --http
# t2:
npx @modelcontextprotocol/inspector
# then select Streamable HTTP, URL http://127.0.0.1:3000/mcp
```

The Inspector exercises:
- capability negotiation handshake (automated coverage partial — curl
  does not validate MCP version/capability schema bidirectionally)
- interactive schema-driven form generation from `inputSchema` (automated
  coverage: none — visual only)
- response rendering including `structuredContent` pretty-print (automated
  coverage: `breadcrumb-always.test.ts` checks the shape, not the
  rendering)

**Block threshold:** These are UX-level verifications. Phase 1 functional
invariants are fully covered by automated tests. Inspector smoke is a
before-v1-release check, not a per-phase gate.

## Result

- [x] Automated coverage maps 1:1 from every Inspector assertion to a test
- [x] Live HTTP curl roundtrip confirms wire-level behavior for `tools/list`,
      `workspace create` (success envelope), and `shot create` rejection
- [x] Boot stderr log confirms messaging contract (D-21)
- [ ] Inspector UI smoke: deferred to local pre-release verification
      (rationale above)

**Sign-off:** automated suite is authoritative. Inspector deferral is
documented and mapped.
