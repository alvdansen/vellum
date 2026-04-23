---
phase: 05-web-dashboard
plan: 12
status: complete
completed: 2026-04-23
requirements: [WEBUI-04, WEBUI-05]
---

# Plan 05-12 Summary — Build, commit dist, CI freshness, live smoke

## What landed

Closes Phase 5. The dashboard bundle is now pre-built and committed so the Hono static handler serves it at runtime with no build step on install. CI catches dist-drift. A live smoke script exercises the full HTTP surface.

### Commits

| SHA | Commit |
|-----|--------|
| `4f42003` | `chore(05-12): unignore packages/dashboard/dist/ for committed build artifact` |
| `7a8db18` | `build(05-12): commit pre-built dashboard dist/ for runtime serving (WEBUI-04, WEBUI-05)` |
| `5f91531` | `ci(05-12): add dashboard dist freshness check to CI (WEBUI-05)` |
| `1b1dd41` | `test(05-12): add live smoke verification script for Phase 5` |

### Key files

| Path | Role |
|------|------|
| `packages/dashboard/dist/index.html` | Pre-built entry point served by `src/http/static.ts` |
| `packages/dashboard/dist/assets/index-zoyhvWiF.js` | 38.55 kB bundled app (gzip 13.46 kB) |
| `packages/dashboard/dist/assets/index-oqCE3cPV.css` | 21.70 kB Tailwind v4 + theme (gzip 4.89 kB) |
| `packages/dashboard/dist/assets/inter-*.woff2` | Inter + Inter Tight subset fonts (all language ranges) |
| `.github/workflows/ci.yml` | Install → typecheck → root tests → dashboard tests → **`npm run build:dashboard && git diff --exit-code packages/dashboard/dist`** |
| `verify-phase5-dashboard.mts` | 116-line live smoke script — 3 checks against a running server |

## Verification

### Live smoke (executed on port 3000)
```
[OK  ] GET /                → 200 text/html
[OK  ] GET /api/workspaces  → 200 JSON array
[OK  ] GET /api/events      → 200 text/event-stream
All checks passed. exit 0
```

### Dist freshness
`npm run build:dashboard && git diff --exit-code packages/dashboard/dist` → **exit 0** (rebuild is deterministic — hashed asset names match committed dist).

### Test gates
- `npm run typecheck` → clean, zero errors
- `npx vitest run` (root) → **687 passed | 2 skipped** (1 intermittent ENOTEMPTY filesystem race in `generation-tool.test.ts`; passes on retry)
- `npm run test:dashboard` → **29 passed** (19 component + 10 cross-cutting integration)

## Deviations

- **Executor stream-timeout recovery** — The initial executor agent staged all artifacts but timed out before committing. Orchestrator committed the staged work in 3 logical groups (dist, ci, smoke) to close the plan without repeating work.
- **PORT env ignored by server** — `src/server.ts --http` hardcodes port 3000 and does not honor `PORT=13001`. Ran smoke on default port 3000 instead; verify-phase5-dashboard.mts accepts a port argument so it still works for custom ports when the server is configured for them.
- **Human UAT skipped by user** — User explicitly opted out of manual browser UAT: "test everything you can without my intervention and otherwise proceed". All programmatic gates (typecheck, root tests, dashboard tests, live smoke, dist freshness) executed green before proceeding.

## Requirements closed

- **WEBUI-04** — Dashboard served from Hono: `src/http/static.ts` reads `packages/dashboard/dist/` at runtime; live smoke verifies `GET /` returns text/html.
- **WEBUI-05** — No runtime build step: `dist/` is committed to git; CI freshness gate enforces source↔dist sync on every PR.
