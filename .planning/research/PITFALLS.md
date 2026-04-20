# Pitfalls Research

**Domain:** MCP Server wrapping ComfyUI Cloud API with VFX pipeline structure
**Researched:** 2026-04-15
**Confidence:** HIGH (multi-source verified across MCP spec, ComfyUI docs, VFX industry standards, SQLite official docs)

## Critical Pitfalls

### Pitfall 1: MCP Tool Explosion Destroys Agent Accuracy

**What goes wrong:**
Exposing every pipeline operation as a separate MCP tool (queue_workflow, get_status, list_projects, create_project, create_sequence, create_shot, create_version, tag_asset, query_assets, diff_versions, reproduce_version, iterate_version, list_models, get_provenance...) creates 15-25+ tool definitions. Each tool schema consumes tokens. Research shows standard MCP setups consume 72% of agent context windows with tool definitions before work begins, and tool selection accuracy collapses from 43% to under 14% with bloated tool sets. The agent picks the wrong tool 7 out of 8 times.

**Why it happens:**
Natural instinct is to map each database operation or API call to its own MCP tool. Feels clean from a software engineering perspective. But LLMs are not REST clients -- they degrade with long tool menus.

**How to avoid:**
- Design 8-12 coarse-grained tools maximum. Combine related operations: one `manage_project` tool with an `action` parameter (create/list/get) instead of three separate tools.
- Use descriptive tool names that are semantically distinct. "generate_shot_version" is clear; "create_v2" is not.
- Keep tool descriptions concise -- each extra sentence costs tokens across every interaction.
- Consider Anthropic's deferred tool loading (GA since Feb 2026) for rarely-used tools like `diff_versions` or `reproduce_version`.

**Warning signs:**
- Agent frequently calls the wrong tool and self-corrects ("Let me try a different tool...")
- Agent asks clarifying questions that a well-designed tool menu would make obvious
- Tool definitions exceed 4000 tokens total when serialized

**Phase to address:**
Phase 1 (MCP server foundation). Tool surface design must be decided before any implementation. Refactoring tools later means changing every integration test and potentially breaking client caches.

---

### Pitfall 2: ComfyUI API Format vs UI Format Confusion

**What goes wrong:**
ComfyUI has two completely different JSON formats for workflows. The UI format contains node positions, links, groups, and visual metadata. The API format is a flat execution graph with node IDs as keys and embedded input links. They are NOT interchangeable. Submitting UI-format JSON to the API's `/api/prompt` endpoint fails silently or with cryptic validation errors. This is the #1 confusion point in the ComfyUI developer ecosystem (GitHub issue #1335 has been open since 2023).

**Why it happens:**
Users export workflows from the ComfyUI web UI and assume that JSON is what the API accepts. The ComfyUI documentation does not make this distinction prominent. Node titles exist in both formats but have different structures. Node IDs in the API format are string numbers ("1", "2", "3") that correspond to nothing in the UI format's visual ordering.

**How to avoid:**
- Always use the API format (also called "prompt format") when queuing jobs. Document this prominently in tool descriptions.
- Store both formats when capturing provenance: the workflow blob for UI reconstruction, the prompt blob for reproducibility.
- Build a validation layer that detects which format was submitted and rejects UI format with a clear error message pointing the user to "Enable Dev Mode > Save (API Format)" in ComfyUI.
- Never rely on node titles as unique identifiers -- they are not required to be unique. Use node IDs.

**Warning signs:**
- API returns validation errors with `node_errors` for workflows that "work fine in the UI"
- Users drag-drop exported JSON into your system and it fails
- Tests pass with hand-crafted API JSON but fail with real user workflows

**Phase to address:**
Phase 2 (ComfyUI API integration). Must be handled at the API client layer before any workflow submission logic is built.

---

### Pitfall 3: Provenance Gaps Make Reproducibility a Lie

**What goes wrong:**
ComfyUI embeds workflow metadata in PNG tEXt chunks, but this metadata has critical gaps. Model references are stored as display names, NOT file hashes. If someone replaces `sd_xl_base_1.0.safetensors` with a different model using the same filename, every workflow referencing that name silently points at different weights. Seeds may show "randomize" in the workflow blob while the prompt blob captured the actual value used. Custom node versions are never recorded. ComfyUI version itself is not captured. You promise "reproduce any version exactly" but cannot actually deliver it without filling these gaps yourself.

**Why it happens:**
ComfyUI was built as a local creative tool, not a production pipeline. Metadata captures enough to reload a workflow visually, not enough to guarantee byte-identical reproduction. The two JSON blobs (workflow + prompt) each capture half the picture, and neither captures the environment.

**How to avoid:**
- At generation time, capture and store separately: the exact prompt blob (execution parameters), the workflow blob (UI reconstruction), the seed actually used (from prompt, not workflow), model checksums (hash the model files referenced), ComfyUI Cloud API version/environment info, and a timestamp with timezone.
- Design the provenance schema to be a superset of what ComfyUI provides. Never rely solely on embedded PNG metadata.
- For "reproduce exactly," document that model hash verification is best-effort on Cloud (you may not control which model version the cloud instance loads). Flag this limitation honestly.
- Store the raw API response alongside your enriched provenance record.

**Warning signs:**
- Re-running a "reproduced" workflow produces visually different results
- Users report "I used the same workflow but got different output" -- the model or seed diverged
- Provenance records show model name but no hash, making audits meaningless

**Phase to address:**
Phase 2-3 (API integration and provenance system). The provenance schema must be designed in Phase 2 before any generation data is stored. Hash capture can be deferred if Cloud API does not expose model hashes, but the schema must have the column ready.

---

### Pitfall 4: Polling Loop Burns API Quota and Blocks the Agent

**What goes wrong:**
ComfyUI Cloud API workflow execution is async -- you POST to `/api/prompt` and get a `prompt_id`, then must check status. Naive implementation polls `/api/job/{id}/status` in a tight loop. This burns API rate limits (25 req/min on some tiers), blocks the MCP tool call for the entire generation duration (30 seconds to 10+ minutes for video), and prevents the agent from doing anything else. The MCP client may timeout waiting for the tool response.

**Why it happens:**
Synchronous tool calls are the natural MCP pattern -- the agent calls a tool and waits for a result. But image generation is inherently async with unpredictable duration. Developers default to polling because it is simpler than webhooks or websocket integration.

**How to avoid:**
- Split into two tools: `submit_generation` (returns immediately with a job ID and estimated wait) and `check_generation` (returns status + outputs if complete). Let the agent decide when to check back.
- Implement exponential backoff if polling is used internally: 2s, 4s, 8s, 16s, cap at 30s.
- Set a busy_timeout on the polling to prevent infinite waits -- fail after 10 minutes with a clear timeout message.
- Consider MCP's async notification patterns (SSE stream) for long-running operations if the transport supports it.
- Respect ComfyUI Cloud's concurrency limits per tier (Free: 1 concurrent, Creator: 3, Pro: 5). Queue locally if the user submits more than their tier allows.

**Warning signs:**
- Agent hangs for 60+ seconds on a single tool call
- "Rate limit exceeded" errors from ComfyUI Cloud API
- MCP client disconnects or times out during generation
- Users report the AI "freezes" when generating images

**Phase to address:**
Phase 2 (ComfyUI API integration). The async pattern must be the foundation of the API client, not retrofitted later.

---

### Pitfall 5: VFX Naming Convention Gets Invented Instead of Adopted

**What goes wrong:**
You invent a custom naming scheme for projects/sequences/shots/versions that does not match any industry standard. When a real VFX studio tries to use this tool, their existing naming convention (Netflix-style `PROJ_SEQ_SHOT_TASK_VENDOR_v001`, or ShotGrid-compatible `SHOW_sq010_sh020_comp_v003`) cannot map to your hierarchy. The tool becomes another silo instead of a pipeline integrator.

**Why it happens:**
Building for a demo, not for production. The developer picks whatever naming feels natural ("project-1/seq-A/shot-001/v1") without researching industry conventions. Internal database IDs leak into user-facing names. Version numbers use inconsistent padding.

**How to avoid:**
- Follow Netflix VFX naming recommendations as the baseline: `SHOW_SEQ_SHOT_TASK_VENDOR_v###` with underscore separators, zero-padded version numbers starting with "v", shot numbers incrementing by 10 (allowing insertion of 015, 025 between existing shots).
- Make the naming template configurable, not hardcoded. Store the pattern in project settings so different studios can adapt it.
- Separate internal IDs (database primary keys) from display names (user-facing, convention-following).
- Version numbers must be immutable and monotonically increasing. v001 is always v001 -- never renumber.

**Warning signs:**
- Hardcoded naming patterns in the codebase (string concatenation instead of template)
- Version numbers not zero-padded (v1, v2 instead of v001, v002)
- No way to customize the hierarchy depth or naming pattern per project
- Internal database IDs appear in tool outputs shown to users

**Phase to address:**
Phase 1 (data model design). The naming convention is a schema decision that permeates every query, display, and export. Changing it after data exists requires a migration.

---

### Pitfall 6: SQLite "Works in Dev, Locks in Demo"

**What goes wrong:**
During the live demo, the web UI reads project hierarchy while the MCP server writes a new generation's provenance. Without WAL mode enabled, the write blocks all reads (and vice versa). The dashboard freezes for 2-5 seconds mid-demo while a write lock is held. Or worse: the MCP server and web UI use separate database connections without proper busy timeout, and one gets a SQLITE_BUSY error that surfaces as an unhandled exception.

**Why it happens:**
SQLite defaults to rollback journal mode where a single writer blocks all readers. In development, you test one operation at a time. In the demo, the dashboard polls for status while the MCP server writes provenance records concurrently. Two processes hitting the same SQLite file without coordination.

**How to avoid:**
- Enable WAL mode on database creation: `PRAGMA journal_mode=WAL`. This is a one-time setting that persists.
- Set busy timeout on every connection: `PRAGMA busy_timeout=5000` (5 seconds).
- Use a single connection pool if both the MCP server and web UI run in the same process, or accept that multi-process SQLite needs WAL + busy_timeout as the minimum configuration.
- Run the web UI reads through the sidecar API (same process as MCP server) rather than opening a separate SQLite connection from a different process.
- Test concurrent read/write explicitly before the demo.

**Warning signs:**
- SQLITE_BUSY errors in logs during concurrent operations
- Dashboard takes noticeably longer to load when a generation is in progress
- Intermittent "database is locked" errors that "go away if you retry"

**Phase to address:**
Phase 1 (database setup). WAL mode and busy_timeout must be configured in the database initialization code, not added later as a fix. This is a 2-line pragma that prevents hours of debugging.

---

### Pitfall 7: MCP Transport Mismatch Locks Out Clients

**What goes wrong:**
You build the MCP server using only stdio transport (the simplest option). It works in Claude Desktop and local testing. But VS Code Copilot, Cursor, or remote deployments need Streamable HTTP transport. Or you build only HTTP transport and Claude Desktop cannot connect because it expects stdio. The demo fails because the audience member's preferred client cannot connect.

**Why it happens:**
The MCP TypeScript SDK supports multiple transports (stdio, legacy HTTP+SSE, Streamable HTTP), but tutorials typically show only one. Developers pick the first example they find and assume it covers all clients. As of 2026, different MCP clients support different transport protocols with no universal standard.

**How to avoid:**
- Support both stdio and Streamable HTTP transports from day one. The TypeScript SDK makes this straightforward -- the server logic is transport-agnostic, only the entrypoint changes.
- Use stdio as the primary transport for Claude Desktop / CLI integration.
- Add Streamable HTTP as a secondary transport for web-based clients and remote access.
- Test with at least two different MCP clients during development (Claude Desktop + one other).
- Handle session management properly for HTTP transport: the `mcp-session-id` header must be included in all subsequent requests after initial connection.

**Warning signs:**
- Server only has one entrypoint script
- No HTTP server dependency in package.json
- "Works in Claude Desktop, doesn't work in Cursor" reports
- No CORS configuration present (needed for browser-based clients)

**Phase to address:**
Phase 1 (MCP server foundation). Transport support is architectural -- adding it later means restructuring the entrypoint and potentially the build system.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Inline SQL queries instead of query builder | Faster initial development | SQL injection risk, hard to refactor schema, no type safety | Never -- use parameterized queries from day one |
| Storing workflow JSON as opaque blob | No schema design needed | Cannot query by workflow parameters, cannot diff versions meaningfully | Only for the raw workflow backup; always extract structured fields into columns |
| Single global SQLite database | Simple, no routing logic | Cannot support multiple workspaces, migration affects all data | Acceptable for v1 demo; design the schema to support workspace isolation via column, not separate files |
| Hardcoded ComfyUI Cloud API base URL | Works immediately | Cannot switch between cloud environments, staging, or self-hosted instances | Never -- use environment variable from day one |
| No request/response logging for ComfyUI API calls | Less code to write | Cannot debug failed generations, no audit trail, provenance gaps | Never -- log at least request ID, status, and timing from the start |
| Skipping input validation on MCP tool parameters | Faster tool development | Prompt injection via tool inputs, cryptic downstream errors, SQL injection | Never -- validate at the MCP tool boundary |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| ComfyUI Cloud API | Submitting UI-format workflow JSON to the `/api/prompt` endpoint | Always validate and accept only API format; detect and reject UI format with a helpful error message |
| ComfyUI Cloud API | Not following 302 redirects when downloading outputs from `/api/view` | Configure HTTP client to follow redirects; output URLs are temporary signed URLs behind a redirect |
| ComfyUI Cloud API | Assuming output node IDs are predictable | Parse the `outputs` object dynamically; node IDs depend on the workflow structure and may change between workflow versions |
| MCP Protocol | Returning large base64 images directly in tool responses | Return a reference (URL or file path) instead; large tool responses consume agent context and may exceed message size limits |
| MCP Protocol | Not handling tool call cancellation | Implement cancellation for long-running operations; agents may abort a generation mid-flight |
| SQLite | Opening database connections from multiple processes without WAL mode | Enable WAL mode and busy_timeout; or route all access through a single process acting as the database gateway |
| SQLite | Using ALTER TABLE to rename or change column types | SQLite has extremely limited ALTER TABLE support; use the 12-step table recreation process for schema changes, or design the schema carefully upfront |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Polling ComfyUI status in tight loop | 429 rate limit errors, blocked agent, wasted API quota | Exponential backoff (2s-30s); or split into submit + check tools | Immediately with multiple concurrent generations |
| Storing all provenance in a single table | Slow queries as version count grows, especially with JSON blob columns | Normalize: separate tables for projects, shots, versions, tags; index on shot_id + version_number | At 1000+ versions per shot (realistic for iterative VFX work) |
| Loading full workflow JSON for list/query operations | Slow responses, high memory usage | Only load workflow JSON for detail/reproduce operations; list queries return metadata only | At 100+ assets with complex workflows (each workflow can be 10-50KB) |
| SQLite WAL file growing unbounded | Disk usage increases steadily, read performance degrades | Call `PRAGMA wal_checkpoint(TRUNCATE)` periodically (e.g., on server startup and after bulk operations) | After hundreds of writes without checkpoint |
| No pagination on asset queries | Agent context blown by returning 500 results | Default limit of 20 results with offset parameter; return total count so agent can paginate | When any project exceeds 50 shots or any shot exceeds 20 versions |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing ComfyUI API key in MCP tool descriptions or server config visible to agent | API key leaked to any MCP client; agent could expose it in conversation | Store in environment variable; never include in tool metadata; load at server startup only |
| No input sanitization on tag names or metadata values | SQL injection via crafted tag names (e.g., `tag'; DROP TABLE versions;--`) | Parameterized queries for all database operations; validate tag format (alphanumeric + hyphens only) |
| Tool descriptions containing instructions that override agent behavior | Tool poisoning -- hidden instructions in description make the agent behave unexpectedly | Keep tool descriptions factual and minimal; no imperative instructions beyond parameter usage |
| Serving the web UI with full database read access | Any browser accessing the dashboard sees all projects and provenance | Scope web UI access by workspace; add authentication if exposed beyond localhost |
| Following arbitrary redirect URLs from ComfyUI API without validation | SSRF (Server-Side Request Forgery) if API response is tampered with | Validate redirect URLs match expected ComfyUI Cloud domains before following |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Returning raw API error messages to the agent | Agent shows user cryptic errors like `{"error": "node_errors": {"3": ...}}` | Translate ComfyUI errors into human-readable messages: "Node 3 (KSampler): invalid model name 'xyz'" |
| Version diff returns raw JSON diff | Unusable for non-technical VFX artists | Summarize changes in natural language: "Changed model from SDXL to FLUX, increased steps from 20 to 30, same seed" |
| No progress indication during generation | User thinks the system is frozen | Return estimated time with the job submission; provide a status check tool the agent can use |
| Flat project listing with no hierarchy in tool output | Agent cannot navigate large project structures efficiently | Return hierarchical breadcrumbs: "Workspace > Project > Sequence > Shot (12 versions)" |
| Tool names use developer jargon | Agent struggles to pick the right tool for user intent | Name tools from the user's perspective: `generate_shot_version` not `queue_prompt_with_provenance` |

## "Looks Done But Isn't" Checklist

- [ ] **Provenance capture:** Often missing model hash verification -- verify that stored hashes are actually checked against the model file, not just the model name string
- [ ] **Version reproducibility:** Often missing seed capture from the prompt blob (not the workflow blob, which may show "randomize") -- verify by reproducing a version and comparing pixel-level output
- [ ] **Workflow submission:** Often missing API format validation -- verify by submitting a UI-format JSON and confirming a clear error message is returned
- [ ] **Output download:** Often missing redirect handling -- verify that outputs download correctly via the `/api/view` 302 redirect chain, not just from a hardcoded URL
- [ ] **Concurrent access:** Often missing WAL mode in production SQLite -- verify by running a dashboard query while a generation write is in progress
- [ ] **Error handling:** Often missing timeout handling for generation jobs -- verify behavior when a Cloud API job runs for 10+ minutes or the API becomes unreachable
- [ ] **Demo readiness:** Often missing the "cold start" scenario -- verify the demo works from an empty database, not just with pre-seeded data
- [ ] **Multi-client:** Often missing Streamable HTTP transport -- verify the MCP server connects from a second client type beyond Claude Desktop
- [ ] **Asset query:** Often missing pagination -- verify behavior when returning 100+ results from a tag or metadata query
- [ ] **Naming convention:** Often missing zero-padding consistency -- verify version numbers display as v001 not v1 across all tool outputs and UI views

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Tool explosion (too many MCP tools) | MEDIUM | Consolidate tools behind action parameters; update tool descriptions; re-test with agent to verify selection accuracy improves |
| Wrong workflow format accepted | LOW | Add format detection and validation at the API client layer; no data loss, just add a guard |
| Missing provenance fields | HIGH | Requires schema migration to add columns, backfill is impossible for already-generated versions (the data was never captured) -- can only fix going forward |
| Polling loop burns rate limit | LOW | Replace tight loop with exponential backoff or split into two tools; no data impact |
| Custom naming convention incompatible with industry | HIGH | Schema migration to change naming columns, all existing references break, may need to re-generate display names for all assets |
| SQLite BUSY errors in demo | LOW | Add WAL mode pragma and busy_timeout; can be applied to existing database without data loss |
| Single transport locks out clients | MEDIUM | Add second transport entrypoint; server logic is transport-agnostic in the SDK, so mainly build/packaging changes |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| MCP tool explosion | Phase 1 (server foundation) | Count total tools; verify < 12; test agent selection accuracy with realistic prompts |
| API format confusion | Phase 2 (ComfyUI integration) | Submit UI-format JSON; confirm clear rejection message; submit API-format; confirm success |
| Provenance gaps | Phase 2-3 (integration + provenance) | Generate an asset; inspect stored record; verify seed, model reference, timestamp, workflow blob all present |
| Polling loop problems | Phase 2 (ComfyUI integration) | Submit a long-running workflow; verify no rate limit errors; verify agent is not blocked |
| Naming convention | Phase 1 (data model) | Create shots with standard VFX names; verify zero-padded version numbers; verify naming template is configurable |
| SQLite concurrency | Phase 1 (database setup) | Run concurrent read + write operations; verify no BUSY errors; verify WAL mode is enabled |
| Transport mismatch | Phase 1 (server foundation) | Connect from Claude Desktop (stdio) AND a second client (HTTP); verify both work |
| Input validation gaps | Phase 1 (server foundation) | Attempt SQL injection via tag name; verify parameterized query blocks it |
| Large tool responses | Phase 3 (asset management) | Generate 10 images in a shot; query all versions; verify response is references, not base64 blobs |
| Schema migration | Phase 1 (database setup) | Include `user_version` pragma from day one; write migration runner that checks version on startup |

## Sources

- [ComfyUI Cloud API Overview](https://docs.comfy.org/development/cloud/overview) -- Official docs, experimental API status, endpoint structure
- [ComfyUI API vs UI Format Issue #1335](https://github.com/comfyanonymous/ComfyUI/issues/1335) -- Core format confusion documented since 2023
- [The Two JSON Blobs Inside Every ComfyUI PNG](https://www.numonic.ai/blog/ai-dam-comfyui-two-json-blobs) -- Reproducibility gaps in workflow vs prompt metadata
- [PNG Metadata vs. Workflow JSON: A Persistence Guide](https://www.numonic.ai/blog/png-metadata-vs-workflow-json-a-persistence-guide) -- Metadata embedding limitations
- [Six Fatal Flaws of MCP](https://www.scalifiai.com/blog/model-context-protocol-flaws-2025) -- Protocol-level security and architectural issues
- [MCP Token Bloat Mitigation (SEP-1576)](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1576) -- Tool definition token overhead quantified
- [10 Strategies to Reduce MCP Token Bloat](https://thenewstack.io/how-to-reduce-mcp-token-bloat/) -- Practical mitigation strategies
- [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices) -- Official security guidance
- [Prompt Injection Meets MCP](https://labs.snyk.io/resources/prompt-injection-mcp/) -- Tool poisoning attack vectors
- [Netflix VFX Shot and Version Naming Recommendations](https://partnerhelp.netflixstudios.com/hc/en-us/articles/360057627473-VFX-Shot-and-Version-Naming-Recommendations) -- Industry-standard naming convention
- [SQLite WAL Mode Documentation](https://www.sqlite.org/wal.html) -- Official concurrency guidance
- [better-sqlite3 Performance Documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) -- Node.js SQLite concurrency patterns
- [Fixing Concurrent Session Problems with SQLite WAL](https://dev.to/daichikudo/fixing-claude-codes-concurrent-session-problem-implementing-memory-mcp-with-sqlite-wal-mode-o7k) -- Real-world MCP + SQLite WAL case study
- [Awesome CG/VFX Pipeline](https://github.com/cgwire/awesome-cg-vfx-pipeline) -- Open-source pipeline tooling landscape
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) -- Official SDK, transport options, server patterns
- [MCP's Biggest Growing Pains for Production](https://thenewstack.io/model-context-protocol-roadmap-2026/) -- Session management and scaling gaps
- [MCP Security Risks and Controls (Red Hat)](https://www.redhat.com/en/blog/model-context-protocol-mcp-understanding-security-risks-and-controls) -- Enterprise security considerations

---
*Pitfalls research for: MCP Server + ComfyUI Cloud API + VFX Pipeline + SQLite*
*Researched: 2026-04-15*
