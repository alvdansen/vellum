# Phase 14: C2PA Signed Manifest Emission - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss); enriched by orchestrator codebase + ecosystem investigation

<domain>
## Phase Boundary

Embed a signed C2PA manifest in every generated output at download time, with an explicit AI-origin disclosure assertion (`c2pa.created` + ComfyUI as generator). For formats not on C2PA's native-embed list, write a sidecar `.c2pa` file alongside the output. This phase establishes the manifest emission scaffolding that Phase 15's ingredient graph and Phase 16's redaction primitive build on.

**Trigger context:** EU AI Act Article 50 (effective Aug 2026) and California SB 942 (effective Jan 2026) both require regulator-verifiable AI-origin disclosure. SEED-001 (Matt Collie, "C2PA Content Provenance for VFX", 2026) provides the design reference. v1.0 captured private SQLite provenance — Phase 14 makes that provenance signed, portable, and externally verifiable.

**Success criteria (from ROADMAP):**
1. Downloads via `/api/versions/:id/output` (dashboard streaming route) AND the engine's direct-to-disk write path produce outputs with a valid embedded C2PA manifest for PNG / JPEG / MP4 / WebP, verifiable by an independent C2PA verifier (e.g., `c2patool`).
2. Every embedded manifest includes a `c2pa.created` assertion naming ComfyUI as the generator/softwareAgent and surfacing the workflow's primary model as the digitalSourceType.
3. For OpenEXR / EXR sequences / PSD / TIFF outputs, the engine writes a sidecar `.c2pa` file at `<output>.c2pa` and the dashboard surfaces both the original artifact and the sidecar manifest as distinct downloadable resources.
4. The signing path uses a single configured local C2PA cert (no HSM, no federated trust roots — explicit v1.1 scope per REQUIREMENTS Out-of-Scope table); private key never logged, never returned in any tool envelope, never echoed to stdout.
5. Dual-transport parity holds: stdio and Streamable HTTP paths both emit identical manifests for the same version (verified by an integration test that downloads via both transports and bit-compares the manifest bytes).
</domain>

<decisions>
## Implementation Decisions

### Locked
- **D-CTX-1: Library — `c2pa-node` v0.5.x.** Pin exact version at plan-write time (latest stable as of 2026-04-30 is 0.5.26 per `npm view c2pa-node version`). The c2pa-node binding wraps the upstream Rust c2pa SDK; native module via N-API. Phase 14 plan's first task pins the version in package.json + records the SHA-256 of the chosen tarball in the SUMMARY.md.
- **D-CTX-2: Cert + key management.** Two env vars:
  - `VFX_FAMILIAR_C2PA_CERT_PEM_PATH` — path to a PEM file containing the signing cert chain
  - `VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH` — path to a PEM file containing the private key
  Both read at server boot. Files validated for existence + readable; key never copied into a logged string. If unset, manifest signing is disabled entirely and a warning is emitted (download path returns the original bytes unmodified — graceful degradation per the "auditability over best-effort" pattern).
- **D-CTX-3: Native-embed format list (PNG, JPEG, MP4, WebP).** `c2pa-node` supports embedding directly into these via its `Builder.sign(asset, signer)` API that returns the signed bytes. Other formats (EXR, PSD, TIFF) → sidecar `.c2pa` written via `Builder.sign_external(...)` (or equivalent). MIME-type/extension detection is the routing key.
- **D-CTX-4: Manifest assertion contract for v1.1.**
  - `c2pa.created` assertion with `digitalSourceType: trainedAlgorithmicMedia` (per C2PA spec for AI-origin)
  - `softwareAgent.name = 'ComfyUI'` and `softwareAgent.version = <ComfyUI server version captured from /api/system_stats or null>`
  - `actions[]` includes one `c2pa.created` action with `parameters.descriptions[]` listing the workflow's primary model name + hash (from Phase 13's `getLatestFingerprints` — uses model_hash if available, falls back to model_hash_unavailable string for transparency)
  - Phase 14 emits ONLY the `c2pa.created` assertion. The ingredient graph (parentOf / componentOf / inputTo) lands in Phase 15.
- **D-CTX-5: Engine-level boundary.** All C2PA code lives under `src/engine/c2pa/` (a new directory). Architecture-purity guard at `src/__tests__/architecture-purity.test.ts` is extended to assert this directory has zero MCP/HTTP imports. The `c2pa-node` package is allowed; no upstream-Rust calls outside it.
- **D-CTX-6: Stream-vs-buffer trade-off.** c2pa-node's signing API typically requires reading the full file into a buffer (the underlying Rust SDK doesn't expose chunked signing). For v1.1, accept the buffer approach — output sizes for PNG/JPEG/MP4/WebP are typically <100MB; large EXR sequences go via sidecar (no embed cost). Document the memory ceiling as a known limit; revisit if profiling shows hotspot.
- **D-CTX-7: Append-only provenance preserved.** The signed manifest bytes are NOT persisted to the DB (cost-prohibitive for video). Instead, record a sibling provenance event `manifest_signed` carrying `{ format, sidecar: boolean, signed_at, signing_cert_subject }` so audit trails can reconstruct what was emitted. Emitted manifest bytes flow only at download time through the HTTP streaming route + the engine's direct-write path.
- **D-CTX-8: Download-time signing (lazy).** Manifests are signed at download time (when `/api/versions/:id/output` is hit OR when the engine's direct-write path produces the file). NOT at completion time. Rationale:
  - Cert may not be configured at completion but configured later → don't lose the version
  - Manifest content can include up-to-date model fingerprints (Phase 13's getLatestFingerprints reads the latest sibling event)
  - Signing is fast for typical sizes; lazy is a clean default
  - Caching: optional in-memory LRU keyed by `versionId:filename` — defer unless profiling shows the same download served repeatedly
- **D-CTX-9: Failure mode — signing fails.** When `c2pa-node` throws (malformed cert, key mismatch, file format not supported), the download path returns the original unmodified bytes + sets a response header `X-C2PA-Signing-Status: failed:<reason>`. Logs a console.error with redacted detail. Tool envelope returns the bytes verbatim — manifest emission is best-effort to keep dashboards responsive even when crypto fails.

### Claude's Discretion
- Cert rotation: out of scope for v1.1 — single static cert per server lifetime is fine.
- Manifest version (C2PA spec): use whatever c2pa-node v0.5.x defaults to (likely C2PA 1.4 or 2.0).
- Sidecar naming: `<output>.c2pa` (literal extension append) per ROADMAP success criterion #3.
- Dev cert generation script: optional; planner decides if a `scripts/gen-dev-c2pa-cert.mts` helper is worth shipping for local development.

### Deferred
- HSM / Yubikey signing — explicit v1.1 Out-of-Scope per REQUIREMENTS table.
- Multi-CA / federated trust roots — explicit Out-of-Scope.
- Streaming-friendly C2PA for live video — Out-of-Scope.
- Editing C2PA manifests in the dashboard — Out-of-Scope (Phase 16 adds redaction; Phase 14 is emission only).
</decisions>

<code_context>
## Existing Code Insights

- `src/http/dashboard-routes.ts:199-260` — GET /api/versions/:id/output. Resolves version, reads outputs_json, streams `outputsDir/versionId/filename` via `createReadStream`. Phase 14 changes: route the bytes through C2PA signing before piping to client. Path-traversal guard at lines 222-236 already exists; reuse it.
- `src/engine/output-downloader.ts:46-71` — engine direct-to-disk write path. After Cloud download lands at `outputsDir/versionId/filename`, Phase 14 hooks here to ALSO write a signed copy (or update in-place — TBD per planner) + sidecar if needed. Two-call shape: `downloadToPath(filename, opts, destPath)` then a Phase 14 hook.
- `src/comfyui/client.ts:640` — `downloadToPath` is the single Cloud-fetch primitive. Phase 14 does NOT modify this; it operates on the file post-write.
- `src/engine/output-hash.ts` (Phase 12) — streaming SHA-256 reference. C2PA signing CANNOT stream (D-CTX-6) — file is buffered.
- `src/engine/model-fingerprint.ts` (Phase 13) — model hashes flow into the manifest's softwareAgent / digitalSourceType assertions.
- `src/store/provenance-repo.ts` — append-only event log. Phase 14 adds `appendManifestSignedEvent` mirroring Phase 13's `appendModelsFingerprintedEvent` shape.
- `src/server.ts` — env var threading (mirror Phase 13's `VFX_FAMILIAR_MODELS_DIR` pattern for the cert/key path env vars).
- `package.json` — current deps; c2pa-node is NEW. Workspace is a monorepo (`packages/*` includes dashboard); add the dep at root only.
- Architecture-purity guard at `src/__tests__/architecture-purity.test.ts` — extend with positive smoke for `src/engine/c2pa/`. Add assertion: NO `dangerouslySetInnerHTML`, no MCP imports, no HTTP imports.
- Test baseline (after Phase 13): 869 root passing / 5 pre-existing failing / 3 skipped. Dashboard 58/58.
- The 5 pre-existing failures (documented in `.planning/phases/10-migrate-on-boot-hardening/deferred-items.md`) live in `src/__tests__/phase-attribution.test.ts` and `src/__tests__/validation-flags.test.ts` — DO NOT TOUCH; they're v1.1 ROADMAP-shape audit-test mismatches that pre-date this work.
- Append-only provenance: writeCompletedEvent + appendModelsFingerprintedEvent + (new) appendManifestSignedEvent are all INSERT-only. Phase 14 must NOT update existing rows.
- Tool budget: Phase 14 adds ZERO new top-level MCP tools. The version tool remains 6 actions (PROV-V-07 in Phase 16 will add export_manifest + verify_manifest).
- Dual-transport parity: both stdio and `--http` server paths share the same Engine. The HTTP route at /api/versions/:id/output is HTTP-only by design — but the engine's direct-write path is shared. Test must download via BOTH (HTTP route AND direct file read) and bit-compare the manifest bytes.

**c2pa-node API surface (v0.5.26, primary calls the planner will use):**

```ts
import { Builder, Signer, ManifestStore, type ManifestDefinition } from 'c2pa-node';

// 1. Build a Signer from cert + key bytes
const signer = await Signer.fromPem({
  certPem: certPemContent,
  privateKeyPem: privateKeyPemContent,
  algorithm: 'es256',  // depends on cert; usually es256 or es384
  tsaUrl: undefined,    // optional time-stamp authority
});

// 2. Define a manifest
const manifest: ManifestDefinition = {
  claim_generator: 'vfx-familiar/0.1.0 c2pa-node/0.5.26',
  format: 'image/png',  // determined by output extension
  title: `Version ${versionId}`,
  assertions: [
    {
      label: 'c2pa.actions',
      data: {
        actions: [
          {
            action: 'c2pa.created',
            digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
            softwareAgent: { name: 'ComfyUI', version: comfyuiVersion ?? null },
            parameters: { description: `model=${modelName}; hash=${modelHash}` },
          },
        ],
      },
    },
  ],
};

// 3. Sign and embed
const builder = new Builder(manifest);
const signedBytes = await builder.sign({
  asset: { mimeType: 'image/png', buffer: fileBytes },
  signer,
});
// signedBytes is the file with embedded manifest; bit-identical to input for non-asset bytes.

// For sidecar (formats not in native-embed list):
const sidecarBytes = await builder.signSidecar({
  asset: { mimeType: 'image/x-exr', buffer: fileBytes },
  signer,
});
// sidecarBytes is just the JUMBF box; write to <output>.c2pa
```

(Exact API may differ slightly per c2pa-node v0.5.x — planner should verify via Context7 MCP.)
</code_context>

<specifics>
## Specific Ideas

- **Native-embed formats:** PNG, JPEG, MP4, WebP. MIME-type table in `src/engine/c2pa/format-router.ts` keyed by extension.
- **Sidecar formats:** OpenEXR (.exr), PSD (.psd), TIFF (.tif/.tiff). Write `<output>.c2pa` alongside.
- **Dev cert script:** `scripts/gen-dev-c2pa-cert.mts` — generates a self-signed cert + key pair for local testing. NOT for production use; document this in CLAUDE.md.
- **HTTP route changes:** GET /api/versions/:id/output — sign-then-stream. New route: GET /api/versions/:id/output.c2pa — returns sidecar bytes if applicable, else 404.
- **Dashboard changes:** Surface sidecar download link in VersionDrawer (Output section). Only render when sidecar exists. Reuse existing styling.
- **Engine direct-write hook:** After downloadOutput returns, if a signer is configured, build the manifest, sign, and write the embedded-manifest version OR sidecar. The original file at `outputsDir/versionId/filename` is OVERWRITTEN with the signed version (same filename). Sidecar at `outputsDir/versionId/filename.c2pa`.
- **Provenance event:** `appendManifestSignedEvent(versionId, { format, sidecar: boolean, cert_subject_summary, signed_at })` — NO key material persisted.
- **Verification fixture for tests:** Run `c2patool verify <signed-file>` (or use c2pa-node's `ManifestStore.fromAsset` + `validate`) to confirm independent verifiability. Skip in CI if c2patool is not installed.
- **Dual-transport parity test:** Submit a test version via stdio. Download via the HTTP route. Read the same file directly from `outputsDir/`. Bit-compare both byte streams.

**Plan structure (planner discretion — recommended split):**
- Plan 14-01: Dependency + cert/key config + dev cert script
- Plan 14-02: Manifest builder (pure JSON shape) + signer wrapper (engine-layer C2PA module)
- Plan 14-03: Format router + embed/sidecar emitter + provenance sibling event
- Plan 14-04: HTTP route integration (sign-then-stream) + new sidecar route + dashboard surface
- Plan 14-05: Tests — embed correctness across 4 formats, sidecar across 3 formats, signing failure graceful path, dual-transport parity, key-leak negative-tests, c2patool verification fixture

That's 5 plans. Or collapse 14-01 into 14-02 if the planner sees a clean shape (4 plans).
</specifics>

<deferred>
## Deferred Ideas

- HSM / Yubikey signing — Out-of-Scope per REQUIREMENTS.
- Multi-CA / federated trust roots — Out-of-Scope.
- Streaming-friendly C2PA for live video — Out-of-Scope (large EXR sequences go via sidecar already).
- Cert rotation / runtime cert reload — Out-of-Scope; static cert per server lifetime.
- C2PA editing in the dashboard — Out-of-Scope; Phase 16 adds redaction only.
- Cross-shot manifest aggregation — Out-of-Scope per REQUIREMENTS table.
- Watermarking — Out-of-Scope per REQUIREMENTS table.
- Caching layer for download-time signing — defer until profiling.
- TSA (time-stamp authority) integration — defer; static signature is sufficient for v1.1's regulatory ask.
- Phase 15's ingredient graph (parentOf / componentOf / inputTo) — explicitly handled in next phase.
</deferred>
