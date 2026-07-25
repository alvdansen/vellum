// Pure type definitions for Phase 14 — C2PA Signed Manifest Emission.
// ZERO imports — canonical type source consumed by the engine layer + the
// boot-time loader at src/utils/c2pa-config.ts.
// Refs: PROV-V-01 / PROV-V-02 / PROV-V-05 (D-CTX-2).

/**
 * Phase 14 — PROV-V-01 / PROV-V-02 / PROV-V-05 (D-CTX-2).
 *
 * C2paConfig is the typed shape carrying the absolute (post-realpath, post-
 * allowlist-validated) paths to the cert chain PEM and the private key PEM
 * read at server boot. NULL means signing is disabled — graceful degradation
 * per D-CTX-2: download paths return original bytes unchanged when
 * c2paConfig is null.
 *
 * Both paths are guaranteed by the loader (src/utils/c2pa-config.ts) to be:
 *   - Absolute (post-realpathSync)
 *   - Inside the configured allowlist root (cwd, or VELLUM_C2PA_CERT_ROOT)
 *   - Existing + readable + non-empty at boot time
 *
 * Signing-time consumers (Plan 14-02's signer wrapper) re-read the file bytes
 * but do NOT need to re-validate the path.
 *
 * This module is engine-layer-only — zero MCP / HTTP / SQLite-driver / ORM
 * imports. Architecture-purity guard at src/__tests__/architecture-purity.test.ts
 * enforces the boundary.
 */
export interface C2paConfig {
  /** Absolute path to a PEM file containing the cert chain. Validated at
   *  boot for existence + readability + allowlist-root containment. */
  readonly certPemPath: string;
  /** Absolute path to a PEM file containing the private key. Validated at
   *  boot for existence + readability + allowlist-root containment. NEVER
   *  logged. NEVER returned in any tool envelope. T-14-01 / T-14-02 mitigation. */
  readonly privateKeyPemPath: string;
  /** Phase 14 fix MR-01: optional RFC 3161 Time-Stamp Authority endpoint.
   *  When `null` (the default when the operator has not set the
   *  VELLUM_C2PA_TSA_URL env var), the signer wrapper builds a
   *  LocalSigner WITHOUT the tsaUrl property — matching c2pa-node v0.5.26's
   *  no-TSA branch. When non-null (operator has opted in to a TSA), the
   *  string is passed through verbatim to c2pa-node; air-gapped or
   *  internal-CA deployments can supply their own TSA endpoint without
   *  touching source. The default is OFFLINE-FRIENDLY: signing succeeds
   *  fully offline when the env var is unset. */
  readonly tsaUrl: string | null;
}
