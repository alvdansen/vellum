// Pure type definitions for C2PA Signed Manifest Emission.
// ZERO imports — canonical type source consumed by the engine layer + the
// boot-time loader at src/utils/c2pa-config.ts.

/**
 * C2paConfig is the typed shape carrying the absolute (post-realpath, post-
 * allowlist-validated) paths to the cert chain PEM and the private key PEM
 * read at server boot. NULL means signing is disabled — graceful degradation:
 * download paths return original bytes unchanged when
 * c2paConfig is null.
 *
 * Both paths are guaranteed by the loader (src/utils/c2pa-config.ts) to be:
 *   - Absolute (post-realpathSync)
 *   - Inside the configured allowlist root (cwd, or VELLUM_C2PA_CERT_ROOT)
 *   - Existing + readable + non-empty at boot time
 *
 * Signing-time consumers (the signer wrapper) re-read the file bytes
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
   *  logged. NEVER returned in any tool envelope (key-leak hygiene). */
  readonly privateKeyPemPath: string;
  /** RFC 3161 Time-Stamp Authority endpoint. The loader defaults this to
   *  DEFAULT_TSA_URL when VELLUM_C2PA_TSA_URL is unset, because a TSA is
   *  mandatory on c2pa-node v0.5.26 — with `null` the signer builds a
   *  LocalSigner without the property and the binding throws on every sign
   *  call. `null` stays representable so tests can exercise that failure
   *  path; production configs from loadC2paConfigFromEnv always carry a
   *  string. Operators supply an internal TSA via the env var to avoid the
   *  third-party call; air-gapped deployments cannot sign on this binding
   *  version. */
  readonly tsaUrl: string | null;
}
