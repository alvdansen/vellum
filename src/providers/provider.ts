// src/providers/provider.ts
//
// GenerationProvider — the neutral seam between the production/provenance engine
// and whatever backend actually produces the pixels/frames/audio. This is the
// keystone of the provider-agnostic pivot: the engine and the output-downloader
// depend on THIS interface, never on a concrete backend client.
//
// ── PIVOT PHASE A (interface extraction, ZERO behavior change) ──────────────
// The only hard ComfyUI coupling was that the engine named `ComfyUIClient` as
// its generation backend type. Phase A replaces that with `GenerationProvider`:
//   • ComfyUIClient      — the REFERENCE adapter (src/comfyui/client.ts
//                          `implements GenerationProvider`).
//   • FakeComfyUIClient  — the test double (src/test-utils, `implements` too),
//                          which is what makes the contract compiler-checked.
// Adding a second backend (Replicate — Phase C) becomes: write one class that
// satisfies this interface + register it. The engine does not change.
//
// ── PURITY ──────────────────────────────────────────────────────────────────
// This module is part of the zero-dependency core: no MCP SDK import, no SQLite
// driver, no ORM, no HTTP-server layer — enforced by
// src/__tests__/architecture-purity.test.ts. (That guard greps these files for
// the offending package names, so this note deliberately does NOT spell them
// out.) It references only the pure, import-free wire-shape types in
// src/comfyui/types.ts.
//
// ── INTERIM TYPE VOCABULARY (neutralized in Phase C) ─────────────────────────
// `SubmitResponse.prompt_id`, the ComfyUI status enum on `StatusResponse`, the
// {filename, subfolder, type} output locator, and the method name
// `fetchResolvedPrompt` are all still ComfyUI-flavored. Phase A deliberately
// PRESERVES them so the ComfyUI path stays byte-identical and the whole suite
// stays green. Phase C (the Replicate adapter) is what forces — and pays for —
// generalizing these into neutral GenerationRequest / GeneratedOutput /
// GenerationState shapes and renaming `fetchResolvedPrompt` -> `fetchProvenance`.

import type { SubmitResponse, StatusResponse } from '../comfyui/types.js';

/**
 * Result of persisting one produced output to local disk. Neutral across
 * providers: the atomic temp-then-rename write, the byte cap, and the SSRF/
 * redirect policy all live inside the adapter — the engine consumes only these
 * four fields (matches ComfyUIClient.downloadToPath and FakeComfyUIClient).
 */
export interface DownloadToPathResult {
  path: string;
  url: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * The contract every generation backend must satisfy. Derived from the four
 * call-sites the GenerationEngine actually depends on (submit / status /
 * downloadToPath / fetchResolvedPrompt) — NOT from ComfyUIClient's full surface.
 * Raw `download()` is a ComfyUI implementation detail exercised only by that
 * client's own unit tests, so it is intentionally NOT part of this interface.
 */
export interface GenerationProvider {
  /**
   * Stable adapter id, stamped onto versions.provider so multi-provider status /
   * reproduce can route by origin (e.g. 'comfyui-cloud', 'replicate'). Also
   * surfaced in vellum://capabilities so a cold agent learns which backends are
   * configured and which support reproduce. (Added in pivot Phase B.)
   */
  readonly id: string;

  /**
   * Submit a generation request and return its job handle. The engine stores the
   * returned id verbatim in `versions.job_id` and later passes it to `status()`.
   * ComfyUI: POST /api/prompt where `request` is the resolved node graph.
   */
  submit(request: Record<string, unknown>): Promise<SubmitResponse>;

  /**
   * Poll the backend for a job's current state. The ADAPTER owns mapping the
   * backend's native status vocabulary onto the canonical StatusResponse.status
   * union the engine's state machine consumes (e.g. Replicate `succeeded` ->
   * `completed`, `canceled` -> `cancelled`).
   */
  status(jobId: string): Promise<StatusResponse>;

  /**
   * Stream one produced output to `destPath` via atomic temp-then-rename, honoring
   * an optional byte cap and the adapter's own redirect/SSRF policy. `opts` carries
   * provider-specific output addressing (ComfyUI: /api/view subfolder + type).
   */
  downloadToPath(
    filename: string,
    opts: { subfolder?: string; type?: string },
    destPath: string,
    options?: { maxBytes?: number },
  ): Promise<DownloadToPathResult>;

  /**
   * OPTIONAL provenance enrichment. Returns the resolved, canonical parameters for
   * a completed output. ComfyUI reads the resolved prompt graph from the output
   * PNG's tEXt chunk ("prompt blob is truth"). URL-based providers have no embedded
   * blob and instead echo their input params, or return null. When this returns
   * null the engine degrades to its PROVENANCE_UNAVAILABLE path — never throws.
   *
   * (Kept a required member in Phase A because both current implementors provide
   * it. Phase C makes it optional + renames it `fetchProvenance` when a provider
   * without a resolvable blob first needs to opt out.)
   */
  fetchResolvedPrompt(pngPath: string): Promise<Record<string, unknown> | null>;
}
