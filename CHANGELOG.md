# Changelog

All notable changes to `vellum` are documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project does not yet follow strict SemVer — breaking changes are called out explicitly.

## [Unreleased]

Pre-announcement hardening. Everything below came out of a structured audit run
before making the repository public; each fix carries a regression test that was
verified to fail against the code before it.

### Fixed

- **Outbound fetches that resolve inward are refused.** The host allowlists on
  the three outbound paths — URL-provider downloads, inbound `register` ingest,
  and the ComfyUI signed-URL redirect — answered "do we trust this name?" but
  nothing checked where the name pointed. An allowlisted host rebound to a
  loopback, link-local or RFC1918 address was fetched and stored as an asset.
- **Provenance can no longer contradict itself.** Terminal provenance events
  were written before the guarded row update, so whenever that update no-opped
  the event was still appended. Two processes on one database could record two
  completions for one version, or a failure on a version that had completed —
  permanently, since the record is append-only. The row transition is now the
  atomic claim, and the event follows it.
- **Version allocation no longer fails under cross-process contention.** The
  allocate-then-insert transaction ran deferred, so a concurrent commit raised
  `SQLITE_BUSY_SNAPSHOT`, which `busy_timeout` does not retry. It surfaced to
  agents as `INVALID_INPUT`, the one code that stops them retrying.
- **Shutdown no longer resurrects pollers.** Aborting the running pollers
  scheduled a queue drain that launched new ones into the map shutdown had just
  cleared.
- **Google AI Studio staging directories are cleaned up.** The staging root was
  randomised per process and the sweep only walked in-memory state, so nothing a
  previous run left behind was reachable — including after a clean exit with a
  job in flight. Staged bytes are also no longer world-readable.
- **`sharp` and `hono` upgraded off known-vulnerable releases.** The image
  decoder is reachable with provider-delivered bytes, and the extension allowlist
  is not a defence — libvips chooses its decoder by sniffing content.

### Changed

- **The database and migrations resolve against the package, not the working
  directory.** They were `./vellum.db` and `./drizzle`, resolved against
  `process.cwd()` — so an MCP client that launches from its own directory
  (Claude Desktop uses `/`) crashed at boot with `MIGRATION_PENDING`, and any
  client that got past it opened a *different* database from the dashboard.
  `VELLUM_DB_PATH` and `--db` still take precedence. **If you relied on the old
  behaviour** — running the server from a directory holding its own
  `vellum.db` — set `VELLUM_DB_PATH` explicitly; the package default is now
  used instead.
- **`.env` is read from the package root as well as the working directory.**
  Previously only the latter, so the file next to the repo was invisible to a
  client launched from anywhere else. The working directory still wins, and
  `DOTENV_CONFIG_PATH` still replaces the search outright.
- **A blank environment variable now means "unset".** `FOO=` used to be an empty
  string that defeated every default — `COMFYUI_API_BASE=` was a fatal boot
  error, and a blank `GOOGLE_AI_STUDIO_API_KEY` silently disabled the
  `GEMINI_API_KEY` alias.
- **`version list` is documented as cursor-paginated** in `vellum://manual` and
  `vellum://capabilities`. The behaviour did not change — a non-zero `offset`
  has been an error since it stopped being silently discarded — but the
  self-describing surface still advertised the old contract.
- **The outputs root is now an absolute path.** It was a bare relative string
  that every consumer re-resolved against the current working directory, so
  under an MCP client that launches from `/` the first generation failed, and
  from anywhere else assets scattered while the database recorded relative paths
  that dangled on the next start. The default is now package-relative;
  `VELLUM_OUTPUTS_DIR` is resolved once, at boot. If you previously ran the
  server from a directory other than the repository root and relied on outputs
  landing there, set `VELLUM_OUTPUTS_DIR` explicitly.
- **Submit proposals record the resolved provider.** They stored `null` when
  the caller did not name one, and approve re-resolved the default late — so a
  default that changed between propose and approve moved the spend to a different
  backend than the one reviewed.
- **Supported Node range narrowed to `>=20.9 <26`** to match what `better-sqlite3`
  and `sharp` actually build against.
- **The package is marked private and no longer declares `bin`/`main`.** They
  pointed at a TypeScript file Node cannot execute, and the install path is a
  clone.

### Documentation

- Added `SECURITY.md` — trust boundaries, the outbound controls, and why each
  remaining `npm audit` entry is unreachable.
- `.env.example` now documents every variable the code reads, with defaults,
  instead of four of them.
- Corrected every wrong factual claim in the README: test counts, migration
  count, supported Node range, the California AI Transparency Act date, and the
  approval gate, which is opt-in and defaults off rather than unconditional.

## [2.0.0]

Provider-agnostic release.

- **Five generation backends behind one interface** — ComfyUI Cloud, Replicate,
  FAL, BytePlus and Google AI Studio. A version records which provider produced
  it, and reproduce re-runs against that same backend.
- **Approval gate.** With `VELLUM_REQUIRE_APPROVAL` set, direct submit /
  reproduce / iterate are refused; every generation goes through
  propose → human review → approve, and a proposal executes at most once.
- **Append-only provenance** with neutral cross-provider params, model
  fingerprints, recorded cost actuals, and per-shot pipeline logs.
- **C2PA signing** of outputs, with redaction support.
- **Preact dashboard** over a REST + SSE surface sharing the server's port.
- **Relicensed MIT → AGPL-3.0-only**, with a commercial option
  (see `COMMERCIAL-LICENSE.md`).

## [1.0.0]

Initial ComfyUI-only release: hierarchy, generation lifecycle, provenance,
asset tagging and query.

### Phase 2 — ComfyUI Generation

**BREAKING: Engine constructor signature change.**

Before (Phase 1):

```ts
new Engine(repo);
```

After (Phase 2, IAC-04):

```ts
new Engine(repo, versionRepo, client, outputRoot, options);
//         ^     ^            ^       ^           ^
//         |     |            |       |           └─ { maxConcurrentPollers? }
//         |     |            |       └─ string — disk root for downloads
//         |     |            └─ ComfyUIClient | null — credential-gated
//         |     └─ new required positional — wires the generation state machine
//         └─ HierarchyRepo (unchanged)
```

The change is backwards-incompatible: any downstream consumer that built an
Engine from just a HierarchyRepo must thread in a VersionRepo, an optional
ComfyUIClient, an output root, and an options bag. The new positional
`versionRepo` is required — there is no default. A missing `client` (null)
keeps hierarchy tools working but causes `generation submit` to surface
`COMFYUI_CREDENTIALS_MISSING` on first call (D-GEN-10, D-GEN-14).

### Added

- `generation` MCP tool with `action: submit | status` — submits a ComfyUI
  API-format workflow, polls status, downloads outputs to the configured
  output root (D-GEN-01..D-GEN-42).
- `ComfyUIClient` — HTTP client for ComfyUI Cloud with SSRF-safe redirect
  handling, signed-URL allowlist, API-key scrubbing on error messages, and
  error-body / download size caps.
- Recovery poller — on server boot, pending version rows are drained by a
  bounded pool of per-row pollers (D-GEN-28, D-GEN-29).
- Drizzle migrations — `drizzle/0001_phase2_version_lifecycle.sql` adds the
  `error_code`, `error_message`, `outputs_json` nullable columns on
  `versions`; `drizzle/0002_idx_versions_status.sql` adds the index supporting
  the recovery poller query.
- `COMFYUI_MAX_CONCURRENT_POLLS` env knob — caps concurrent recovery pollers
  (default 3 = Creator tier).
- `COMFYUI_ALLOWED_REDIRECT_HOSTS` env — comma-separated additional host
  allowlist for signed-URL redirects (exact + suffix match).
- `COMFYUI_API_BASE_ALLOW_HTTP`, `COMFYUI_API_BASE_ALLOW_PRIVATE` — override
  env vars for the IS-02 base-URL validator (local dev only).

### Changed

- Tool response `entity.outputs` is now a typed `StoredOutput[]` instead of
  the stringified `outputs_json` column (IAC-01).
- Tool response uses `error` as the canonical error alias;
  `error_message` is no longer surfaced (IAC-02).
- `Version.status` is narrowed from `string` to
  `'submitted' | 'running' | 'completed' | 'failed'` — exported as
  `VersionStatus` (IAC-05).

### Security

- `redirect: 'manual'` on every ComfyUI client fetch — the X-API-Key header
  never crosses a redirect boundary (C4).
- Two-hop SSRF defence on signed-URL downloads — both the /api/view redirect
  target AND the signed URL itself are validated against the allowlist, and
  the second hop rejects further 3xx responses (C3).
- Base-URL validator rejects http://, loopback, link-local, and RFC-1918
  hosts at boot unless explicit override env vars are set (IS-02).
- Allowlist match is literal string (exact / suffix), no longer regex over
  user input (IS-01).
- Error bodies capped at 64 KiB on submit's 4xx/5xx path (IS-03).
- Downloads capped at 500 MiB by default, configurable per call (IS-03).
- API key literal is scrubbed from all error messages before they cross the
  client boundary; truncated to 1000 chars (IS-04).
- Path-traversal guard extended to every path segment in `buildOutputPath`
  (C1).
- `transition()` TOCTOU guard prevents a concurrent caller from regressing a
  terminal row (C2).
