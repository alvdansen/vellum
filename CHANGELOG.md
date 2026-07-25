# Changelog

All notable changes to `vfx-familiar` are documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project does not yet follow strict SemVer — breaking changes are called out explicitly.

## [Unreleased]

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
