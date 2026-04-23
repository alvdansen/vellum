# Phase 5: Web Dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 05-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 05-web-dashboard
**Areas discussed:** Data flow architecture, Static bundle + build, Visual language / layout, Live generation + provenance UX

---

## Data flow architecture

### Q1: How should the dashboard read data?
| Option | Description | Selected |
|--------|-------------|----------|
| New REST routes on Hono | /api/* JSON routes alongside /mcp; delegate to Engine | ✓ |
| Dashboard as an MCP client | Preact uses MCP SDK + Streamable HTTP against /mcp | |
| Hybrid: REST reads + MCP tool parity | REST routes forward internally to tool handlers | |
| Direct Hono handlers, no MCP envelope | REST returns raw domain shapes without dual-form | |

### Q2: Where do the REST/SSE routes live in the repo?
| Option | Description | Selected |
|--------|-------------|----------|
| New src/http/ module | Parallel to src/tools/; architecture-purity extended | ✓ |
| Inline in server.ts | Simpler, but server.ts grows large | |
| Separate Hono app, mounted at / | Cleaner isolation but more surface area | |

### Q3: How should live generation updates flow?
| Option | Description | Selected |
|--------|-------------|----------|
| Single SSE stream at /api/events | Global typed-event stream; client filters by view | ✓ |
| Per-shot SSE: /api/events/shot/:id | Per-shot subscription; requires server state | |
| Per-job SSE: /api/events/job/:id | Per-job subscription; high connection count | |
| No SSE — poll /api/versions?status=running | Dashboard polls every 2s; loses live feel | |

### Q4: What auth posture for the dashboard + API?
| Option | Description | Selected |
|--------|-------------|----------|
| Trust 127.0.0.1 binding only | Same as /mcp today; no new auth | ✓ |
| Bearer token in env var | Real auth but real setup friction | |
| No auth, bind 0.0.0.0 | Remote-accessible; rejects Phase 2 boundary | |

### Q5: What shape do REST responses return?
| Option | Description | Selected |
|--------|-------------|----------|
| Bare domain shapes | {entity, tags, metadata, breadcrumb, breadcrumb_text} | ✓ |
| MCP-envelope parity | {structuredContent, content} wrapper on every read | |
| Bare for reads, MCP-envelope for mutations | Hybrid; more rules to remember | |

### Q6: Which engine transitions fire SSE events?
| Option | Description | Selected |
|--------|-------------|----------|
| Version status changed | submitted → running → completed/failed | ✓ |
| New version inserted | submitted → inserted to timeline live | ✓ |
| Tag / metadata changed | Multi-tab visibility of asset writes | ✓ |
| Hierarchy entity created | New workspace/project/sequence/shot appears live | ✓ |

**User's choice:** All four event types selected (multiSelect).

### Q7: SSE reconnection semantics?
| Option | Description | Selected |
|--------|-------------|----------|
| Simple: reconnect, stream new only | Dashboard reconciles via REST if events missed | ✓ |
| Last-Event-ID replay | Server-side ring buffer; robust but stateful | |
| Snapshot + stream | First event is full snapshot, then live | |

---

## Static bundle + build

### Q1: Where does the dashboard source live in the repo?
| Option | Description | Selected |
|--------|-------------|----------|
| packages/dashboard/ (monorepo shape) | npm workspaces; isolated dev deps | ✓ |
| apps/dashboard/ (not a workspace) | Separate manual install | |
| src/dashboard/ with shared package.json | Mixes server and client deps | |
| No build tool — vanilla JS + ESM CDN | Zero build; gives up JSX and TS | |

### Q2: How does 'no build step required' (WEBUI-05) actually work?
| Option | Description | Selected |
|--------|-------------|----------|
| Pre-built dist/ committed to git | CI enforces freshness via git-diff | ✓ |
| postinstall hook builds the dashboard | Clean git; fails in CI / prod installs | |
| Publish a bundled npm package | Ships dist inside the tarball | |
| Ship a 'dashboard fell back' static HTML | Combined with any of the above | |

### Q3: Preact flavor and client-side state?
| Option | Description | Selected |
|--------|-------------|----------|
| Preact + @preact/signals + TypeScript | Fine-grained reactive state for SSE | ✓ |
| Preact + useState/useEffect only | Simpler; more re-renders | |
| Preact + @tanstack/query | Caching, stale-while-revalidate | |
| Vanilla Preact + tiny hand-rolled store | Zero deps beyond Preact | |

### Q4: Styling / component approach?
| Option | Description | Selected |
|--------|-------------|----------|
| Tailwind CSS v4 | Hand-roll components for custom aesthetic | ✓ |
| Tailwind + shadcn-style primitives | Faster polish; needs Preact-compat variants | |
| Plain CSS modules | Full control; more verbosity | |
| CSS-in-JS (@emotion) | Styles co-located; runtime cost | |

### Q5: How does the Hono server serve the dashboard static files?
| Option | Description | Selected |
|--------|-------------|----------|
| Hono's serveStatic mounted at / | /mcp and /api/* take precedence | ✓ |
| serveStatic at /dashboard, / redirects | Clearer but viewer types /dashboard | |
| Separate /ui and /api prefixes | Structured; noisy for demo | |

### Q6: Dev loop: how does a developer iterate?
| Option | Description | Selected |
|--------|-------------|----------|
| Two-process: Vite :5173 + Hono :3000 + CORS | HMR; fast iteration | ✓ |
| Single process: Vite middleware in Hono | One port; Vite in server graph | |
| Rebuild on save: tsx watch + vite --watch | No HMR; auto-rebuild | |

### Q7: CI enforcement: keep dist/ in sync with source?
| Option | Description | Selected |
|--------|-------------|----------|
| CI runs build, fails on git-diff | Non-bypassable enforcement | ✓ |
| Pre-commit hook (husky) | Bypassable; local-only | |
| No automated check — doc only | Trust the developer | |

---

## Visual language / layout

### Q1: What aesthetic direction for the dashboard?
| Option | Description | Selected |
|--------|-------------|----------|
| VFX-industry dark (Nuke/Houdini feel) | Orange accent, grid lines, mono data | |
| Linear/Vercel-clean modern | Universal serious product aesthetic | |
| Terminal / information-dense pro tool | Dense tables, color pills | |
| ComfyUI-native (match comfy.org design) | Lift palette + typography + icons | ✓ |

**User's choice:** ComfyUI-native — strong pitch value ("this belongs inside Comfy").

### Q2: How closely should we match comfy.org's look?
| Option | Description | Selected |
|--------|-------------|----------|
| Lift palette/typography/iconography, own layouts | "Made by the Comfy team" without being a clone | ✓ |
| Mimic ComfyUI app chrome verbatim | Full clone; risks uncanny valley | |
| Comfy.org marketing site vibes only | Brand site feel; no app chrome | |

### Q3: Navigation model?
| Option | Description | Selected |
|--------|-------------|----------|
| Tree sidebar + detail pane | Familiar file-explorer model | ✓ |
| Breadcrumb drill-down, single-pane | Simpler; requires clicks for siblings | |
| Three-pane column view | Fast scanning; narrow columns | |
| Dashboard home + search-first | Modern; skips browse-structure criterion | |

### Q4: Shot detail — how is the version timeline presented?
| Option | Description | Selected |
|--------|-------------|----------|
| Image-thumbnail grid, latest first | Visual-first; matches VFX thinking | ✓ |
| Chronological row list with mini-preview | Information-dense; less image-forward | |
| Horizontal timeline strip with hero | Dramatic for demo; awkward at 20+ versions | |
| Dual: tabs for Gallery vs Table | Flexibility; doubles layout work | |

### Q5: Typography and motion posture?
| Option | Description | Selected |
|--------|-------------|----------|
| Inter + tabular figures + restrained motion | Serious product posture | ✓ |
| Geist / Berkeley Mono for techier feel | More modern-startup | |
| System UI stack, zero custom fonts | Plainer; zero network cost | |
| Inter + expressive motion (springs) | Higher wow; risks gimmicky | |

### Q6: Light, dark, or both?
| Option | Description | Selected |
|--------|-------------|----------|
| Dark by default, light toggle | Persists to localStorage | ✓ |
| Dark only | Single theme; simpler | |
| Match OS preference | prefers-color-scheme auto-switch | |
| Light only | Unusual for VFX tool | |

### Q7: Where does the sidebar start — what's the 'home' view?
| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard home: active + recent + workspaces | "Something is happening" first impression | ✓ |
| Auto-expand to latest workspace's latest shot | Lands inside real content | |
| Minimal: 'Select a workspace from the sidebar' | Directive; no magic | |

### Q8: Responsive / screen targets?
| Option | Description | Selected |
|--------|-------------|----------|
| Desktop-only, 1440px+ optimal | Saves enormous layout work; drawer < 1024px | ✓ |
| Desktop + tablet (drawer sidebar) | iPad-usable; moderate extra work | |
| Fully responsive (phone through 4K) | Phone redesign; overkill | |

---

## Live generation + provenance UX

### Q1: How do active generations surface on screen?
| Option | Description | Selected |
|--------|-------------|----------|
| Persistent panel in sidebar | Always visible; toast on completion | ✓ |
| Inline-only: on version cards | Simpler; misses live moment from other screens | |
| Top status bar "N active" | Unobtrusive; easy to miss | |
| Floating dock at bottom-right | Demo polish; fights ComfyUI-native aesthetic | |

### Q2: What progress granularity per generation?
| Option | Description | Selected |
|--------|-------------|----------|
| Status transitions + elapsed time only | Honest to what the engine knows | ✓ |
| Status + ComfyUI-level progress bar | Requires Cloud progress endpoint | |
| Indeterminate spinner only | Minimum work; loses live feel | |

### Q3: How does the provenance drill-down present itself?
| Option | Description | Selected |
|--------|-------------|----------|
| Tabbed detail panel: Summary/Workflow/Prompt/Models/Raw | Matches how VFX audits provenance | ✓ |
| Single-page: everything stacked inline | Fewer clicks; more scroll | |
| Summary + 'View raw JSON' modal | Minimalist; hides provenance story | |
| Split pane: summary + raw JSON always visible | Strong audit vibe; wide-screen only | |

### Q4: Which version actions does the dashboard expose?
| Option | Description | Selected |
|--------|-------------|----------|
| Diff + Reproduce only | Mostly-read surface; keeps scope tight | ✓ |
| Diff + Reproduce + Iterate | Adds node-override editor | |
| Diff + Reproduce + Iterate + Tag/Metadata writes | Full write surface; broadens scope materially | |
| Read-only: no actions, just view | Cheapest; loses live-pipeline impact | |

### Q5: Where do version thumbnails come from?
| Option | Description | Selected |
|--------|-------------|----------|
| Engine downloads output to outputs/<version_id>/; GET /api/versions/:id/output streams | Works offline; modest engine extension | ✓ |
| Proxy on demand: REST route fetches Cloud each time | Breaks on URL TTL | |
| Placeholder thumbnails + 'download output' button | Avoids storage question; demo impact drops | |
| Store output URL; dashboard hits it directly | CORS / auth risks | |

### Q6: What shows before output loads?
| Option | Description | Selected |
|--------|-------------|----------|
| Skeleton placeholder, fades in on load | Shimmer pulse; status-colored card when no output exists | ✓ |
| Generic 'no preview' icon | Cleaner; less polished | |
| Blurhash placeholder | Very polished; adds dep + compute | |

---

## Claude's Discretion

Captured in 05-CONTEXT.md "Claude's Discretion" section. Planner retains decision authority over:
- Exact color tokens and spacing scale (extracted during research)
- Icon library choice
- JSON syntax highlighter choice
- Exact SSE frame format details (event: header, keep-alive cadence)
- EventEmitter vs custom pub-sub
- Active generations panel animation and sort detail
- Drawer width exact values
- Diff drawer rendering (inline vs side-by-side vs hybrid)
- Output downloader retry / timeout policy
- Dashboard error-boundary granularity
- localStorage key names
- Keyboard shortcuts
- Vite config details and bundle chunking strategy

## Deferred Ideas

Captured in 05-CONTEXT.md Deferred Ideas section. Highlights:
- Iterate-from-UI (node-override editor)
- Tag / metadata writes from UI
- ComfyUI node-by-node progress bar
- Per-shot / per-job SSE endpoints
- Last-Event-ID SSE replay
- Blurhash / LQIP thumbnails
- Mobile layouts
- Lineage graph visualization
- FTS5 search UI
- Keyboard navigation (cmd-k)
- Output retention / cleanup policy
- Signed URLs for outputs
- prefers-color-scheme auto-switch
- Dashboard internationalization
- Cross-tab coordination
- Dashboard bundle size budget
- Active-generations cancel button
- E2E test harness
- npm package publication
- Structured logger (pino)
