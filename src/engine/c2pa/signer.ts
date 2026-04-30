// Phase 14 — PROV-V-01 (D-CTX-2 + D-CTX-6). Engine-layer signer wrapper.
//
// This is the ONLY file in the codebase that imports c2pa-node. The
// architecture-purity test asserts:
//   grep -rE "from\s*['\"]c2pa-node|import\s*\(\s*['\"]c2pa-node" src/
//   (excluding __tests__) returns matches ONLY in src/engine/c2pa/signer.ts.
//
// REVISION fixes:
//   Concern #1  — algorithm detection via X509Certificate (no hard-coded ES256)
//   Concern #10 — RFC4514-safe subject parser (no naive regex)
//   Concern #11 — lazy native binding load + try/catch (no boot crash)
//
// Plan 14-02 RUNTIME DEVIATION (documented in 14-02-SUMMARY.md):
//   c2pa-node v0.5.26's native binding requires `tsaUrl` to either be an
//   absent property OR a valid URL string. With the property missing,
//   `signClaimBytes` throws "TypeError: failed to downcast any to string"
//   from inside c2pa-rs. With `tsaUrl: ''`, the URL parser throws a
//   `RelativeUrlWithoutBase` error.
//
//   Mitigation: the signer wrapper accepts an optional `tsaUrl` parameter
//   on `loadSigner` (default `'http://timestamp.digicert.com'` — same default
//   c2pa-node's own `createTestSigner` uses). The default is a public TSA
//   that does not require credentials. Plan 14-04 will surface tsaUrl as a
//   config option in C2paConfig if production deployments need an internal
//   TSA. The LocalSigner literal is built CONDITIONALLY (property absent
//   when tsaUrl is null) so the `tsaUrl: undefined` downcast bug is
//   sidestepped.

import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { TypedError } from '../errors.js';
import type { ManifestDefinition } from './manifest-builder.js';

// c2pa-node native binding — loaded lazily (Concern #11).
type C2paNodeModule = typeof import('c2pa-node');
let c2paNodeModule: C2paNodeModule | null = null;
let c2paNodeLoadError: Error | null = null;

/**
 * Lazy + try/catch'd native binding load. The first invocation attempts the
 * dynamic import; subsequent invocations reuse the cached module OR throw
 * the cached load error wrapped in `C2PA_SIGNER_LOAD_FAILED`. Server boot
 * NEVER calls this — Plan 14-03's engine hook is the first call site at
 * download time.
 */
async function ensureC2paNode(): Promise<C2paNodeModule> {
  if (c2paNodeModule !== null) return c2paNodeModule;
  if (c2paNodeLoadError !== null) {
    throw new TypedError(
      'C2PA_SIGNER_LOAD_FAILED',
      `c2pa-node native binding unavailable: ${c2paNodeLoadError.message}`,
      'Install c2pa-node prebuilds for this platform, or run on a supported platform (macOS arm64/x64, Linux x64/arm64, Windows x64).',
    );
  }
  try {
    c2paNodeModule = await import('c2pa-node');
    return c2paNodeModule;
  } catch (err) {
    c2paNodeLoadError = err as Error;
    throw new TypedError(
      'C2PA_SIGNER_LOAD_FAILED',
      `c2pa-node native binding unavailable: ${(err as Error).message}`,
      'Install c2pa-node prebuilds for this platform, or run on a supported platform.',
    );
  }
}

/**
 * Returns true if c2pa-node has loaded successfully OR has not yet been
 * attempted. Returns false ONLY after a load attempt failed. Plan 14-03's
 * graceful-fail uses this to short-circuit retries.
 *
 * NOTE: this returns `true` BEFORE the first load attempt — the load is
 * lazy + can fail at first call. Callers cannot rely on this returning
 * `false` until after a `loadSigner` invocation that hit the load path.
 */
export function isC2paNodeAvailable(): boolean {
  return c2paNodeLoadError === null;
}

/**
 * Test-only — resets the module-scoped lazy-load state so a vi.mock on
 * `c2pa-node` can take effect in subsequent test cases. Production code
 * MUST NOT call this — it deliberately re-triggers the lazy import path.
 *
 * Exported only because vi.mock is hoisted and we cannot scope it to the
 * test file. Naming starts with `__` to discourage accidental usage.
 */
export function __resetC2paNodeStateForTests(): void {
  c2paNodeModule = null;
  c2paNodeLoadError = null;
}

export interface LoadedSigner {
  readonly c2pa: import('c2pa-node').C2pa;
  readonly certSubjectSummary: string;
  readonly algorithm: import('c2pa-node').SigningAlgorithm;
}

/** c2pa-node v0.5.x BUFFER-API-supported MIME types (bindings.js line 132-134). */
const BUFFER_API_MIMETYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png']);

/**
 * Default TSA URL used when caller does not supply one. Mirrors c2pa-node's
 * own `createTestSigner` default. RFC 3161 timestamping is OPTIONAL in
 * theory but required in c2pa-node v0.5.26's native binding (see deviation
 * note in the file header).
 */
const DEFAULT_TSA_URL = 'http://timestamp.digicert.com';

/**
 * Loads the cert + key into memory ONCE, detects the cert's signature
 * algorithm via X509Certificate, derives a path-leak-free subject summary,
 * and returns a `LoadedSigner` carrying a configured `c2pa-node` C2pa
 * instance.
 *
 * Throws `TypedError('C2PA_SIGNER_LOAD_FAILED', ...)` on any failure path
 * (binding load, file read, cert parse, key parse, unsupported algorithm,
 * c2pa-node createC2pa rejection). NEVER logs key bytes (T-14-01 mitigation).
 *
 * @param certPemPath  Absolute path to the PEM-encoded cert (chain).
 * @param privateKeyPemPath  Absolute path to the PEM-encoded private key.
 * @param tsaUrl  Optional TSA endpoint. Defaults to DigiCert public TSA.
 *                Plan 14-04 may make this configurable via C2paConfig.
 */
export async function loadSigner(
  certPemPath: string,
  privateKeyPemPath: string,
  tsaUrl: string | null = DEFAULT_TSA_URL,
): Promise<LoadedSigner> {
  const c2paNode = await ensureC2paNode(); // Concern #11 — fails loud if binding broken

  let certPemBytes: Buffer;
  let privateKeyPemBytes: Buffer;
  try {
    [certPemBytes, privateKeyPemBytes] = await Promise.all([
      readFile(certPemPath),
      readFile(privateKeyPemPath),
    ]);
  } catch (err) {
    throw new TypedError(
      'C2PA_SIGNER_LOAD_FAILED',
      `Failed to read cert or key PEM: ${(err as Error).message}`,
      'Verify VFX_FAMILIAR_C2PA_CERT_PEM_PATH + VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH point to readable files.',
    );
  }

  // Parse cert + detect algorithm (Concern #1).
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certPemBytes);
  } catch (err) {
    throw new TypedError(
      'C2PA_SIGNER_LOAD_FAILED',
      `Cert PEM is not parseable as X.509: ${(err as Error).message}`,
      'Regenerate via scripts/gen-dev-c2pa-cert.mts (dev) or contact your CA (prod).',
    );
  }
  const algorithm = detectSigningAlgorithm(cert, c2paNode.SigningAlgorithm);

  // Derive subject summary (Concern #10).
  const certSubjectSummary = deriveCertSubjectSummary(cert);

  // Build C2pa instance. The LocalSigner literal omits `tsaUrl` entirely
  // when caller passed null — c2pa-node's native binding cannot handle the
  // `tsaUrl: undefined` shape (downcast error).
  let c2pa: import('c2pa-node').C2pa;
  try {
    const localSigner: import('c2pa-node').LocalSigner = tsaUrl === null
      ? {
          type: 'local',
          certificate: certPemBytes,
          privateKey: privateKeyPemBytes,
          algorithm,
        }
      : {
          type: 'local',
          certificate: certPemBytes,
          privateKey: privateKeyPemBytes,
          algorithm,
          tsaUrl,
        };
    c2pa = c2paNode.createC2pa({ signer: localSigner });
  } catch (err) {
    throw new TypedError(
      'C2PA_SIGNER_LOAD_FAILED',
      `c2pa-node createC2pa rejected the cert/key pair: ${(err as Error).message}`,
      `Verify cert + key match (detected algorithm: ${algorithm}).`,
    );
  }

  return { c2pa, certSubjectSummary, algorithm };
}

/**
 * Concern #1 — match cert algorithm to c2pa-node SigningAlgorithm enum.
 *
 * Detection priority for RSA-PSS:
 *   1. asymmetricKeyDetails.hashAlgorithm (bound RSA-PSS keys expose this)
 *   2. signatureAlgorithm string parse (fallback, often returns 'rsassaPss'
 *      with no embedded hash for unbound keys — falls through to error)
 *
 * For plain RSA (PKCS#1-v1.5), c2pa-node v0.5.26's SigningAlgorithm enum
 * has NO `RS256` value. We fail loud rather than silently producing a
 * signature using the PSS algorithm with a non-PSS key.
 */
function detectSigningAlgorithm(
  cert: X509Certificate,
  enumRef: typeof import('c2pa-node').SigningAlgorithm,
): import('c2pa-node').SigningAlgorithm {
  const keyType = cert.publicKey.asymmetricKeyType; // 'ec' | 'rsa' | 'rsa-pss' | 'ed25519' | etc
  const sigAlg = cert.signatureAlgorithm ?? '';
  // asymmetricKeyDetails contains BigInt fields for RSA — JSON.stringify
  // would fail; we only access named string fields (hashAlgorithm, namedCurve).
  const details = (cert.publicKey.asymmetricKeyDetails ?? {}) as {
    namedCurve?: string;
    hashAlgorithm?: string;
  };

  if (keyType === 'ed25519') return enumRef.Ed25519;

  if (keyType === 'ec') {
    const curve = details.namedCurve ?? '';
    if (curve === 'prime256v1' || curve === 'P-256') return enumRef.ES256;
    if (curve === 'secp384r1' || curve === 'P-384') return enumRef.ES384;
    if (curve === 'secp521r1' || curve === 'P-521') return enumRef.ES512;
    throw new TypedError(
      'C2PA_SIGNER_LOAD_FAILED',
      `Unsupported EC curve '${curve}' for c2pa-node v0.5.26 (supported: P-256, P-384, P-521)`,
      'Reissue the cert with a supported curve.',
    );
  }

  if (keyType === 'rsa-pss') {
    // Prefer the bound hashAlgorithm from key details (most accurate).
    const hashAlg = (details.hashAlgorithm ?? '').toLowerCase();
    if (hashAlg === 'sha256') return enumRef.PS256;
    if (hashAlg === 'sha384') return enumRef.PS384;
    if (hashAlg === 'sha512') return enumRef.PS512;
    // Fallback to signatureAlgorithm string (rare — most rsa-pss certs
    // expose hashAlgorithm).
    const lower = sigAlg.toLowerCase();
    if (lower.includes('sha256')) return enumRef.PS256;
    if (lower.includes('sha384')) return enumRef.PS384;
    if (lower.includes('sha512')) return enumRef.PS512;
    throw new TypedError(
      'C2PA_SIGNER_LOAD_FAILED',
      `Cannot determine PS hash for rsa-pss cert (sig=${sigAlg}, hashAlgorithm=${details.hashAlgorithm ?? 'unset'})`,
      'Reissue the cert with rsa_pss_keygen_md set to sha256/sha384/sha512.',
    );
  }

  if (keyType === 'rsa') {
    // Plain RSA (PKCS#1-v1.5) has no PS-equivalent enum value in c2pa-node
    // v0.5.26. Fail loud rather than silently producing a signature.
    throw new TypedError(
      'C2PA_SIGNER_LOAD_FAILED',
      `Unsupported plain RSA cert (sig=${sigAlg}) — c2pa-node v0.5.26 SigningAlgorithm has no RS256/RS384/RS512`,
      'Reissue the cert with RSA-PSS (openssl genpkey -algorithm RSA-PSS) + SHA-256/384/512.',
    );
  }

  throw new TypedError(
    'C2PA_SIGNER_LOAD_FAILED',
    `Unsupported public key type '${keyType}' for c2pa-node v0.5.26 (supported: ec, rsa-pss, ed25519)`,
    'Reissue the cert with a supported key type.',
  );
}

/**
 * Concern #10 — RFC4514-safe subject parser.
 *
 * Walks `cert.subject` (Node X509Certificate emits one `attr=value` line per
 * RDN attribute, RFC2253-style). Splits each line on the FIRST UNESCAPED
 * `=`. Applies RFC4514 unescape rules to the value (handles `\,`, `\=`,
 * `\+`, `\;`, `\<`, `\>`, `\"`, `\\`).
 *
 * Returns the first non-empty CN, falling back to the first non-empty O,
 * falling back to a 16-char SHA-256 fingerprint prefix. The fingerprint
 * fallback ensures every cert produces a non-empty string (provenance
 * event field is never empty).
 */
function deriveCertSubjectSummary(cert: X509Certificate): string {
  const subject = cert.subject ?? '';
  const lines = subject.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const attrs: Record<string, string> = {};
  for (const line of lines) {
    const eqIdx = findUnescapedEquals(line);
    if (eqIdx < 0) continue;
    const attr = line.slice(0, eqIdx).trim();
    const value = unescapeRfc4514(line.slice(eqIdx + 1).trim());
    if (!(attr in attrs) && value.length > 0) attrs[attr] = value;
  }
  if (attrs['CN']) return attrs['CN'];
  if (attrs['O']) return attrs['O'];
  const fp = cert.fingerprint256.replace(/:/g, '').toLowerCase();
  return `fp:${fp.slice(0, 16)}`;
}

/** Returns the index of the FIRST `=` that is NOT immediately preceded by `\\`. */
function findUnescapedEquals(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && (i === 0 || s[i - 1] !== '\\')) return i;
  }
  return -1;
}

/** RFC4514 escape unwrap — handles the eight RFC4514 special chars. */
function unescapeRfc4514(s: string): string {
  return s.replace(/\\([,=+;<>"\\])/g, '$1');
}

/**
 * Sign + embed manifest into a buffer asset (JPEG / PNG only).
 *
 * Throws `TypedError('C2PA_SIGNING_FAILED', ...)` on:
 *   - unsupported MIME type (caller passed video/mp4, etc.)
 *   - c2pa-node sign() rejection (corrupted asset, network failure on TSA, etc.)
 *
 * Plan 14-03's engine hook catches this as a graceful-fail per D-CTX-9 —
 * download path returns original bytes + `X-C2PA-Signing-Status: failed:<reason>`.
 */
export async function signEmbedBuffer(
  buffer: Buffer,
  mimeType: string,
  manifestDef: ManifestDefinition,
  signer: LoadedSigner,
): Promise<Buffer> {
  if (!BUFFER_API_MIMETYPES.has(mimeType)) {
    throw new TypedError(
      'C2PA_SIGNING_FAILED',
      `Buffer-API signing not supported for ${mimeType} — use signEmbedFile instead`,
      'c2pa-node v0.5.x supports buffer signing only for image/jpeg + image/png. MP4/WebP/TIFF must use the file-path API.',
    );
  }
  const c2paNode = await ensureC2paNode();
  try {
    const result = await signer.c2pa.sign({
      asset: { buffer, mimeType },
      manifest: new c2paNode.ManifestBuilder(manifestDef as never),
      thumbnail: false,
    });
    return result.signedAsset.buffer;
  } catch (err) {
    if (err instanceof TypedError) throw err;
    throw new TypedError(
      'C2PA_SIGNING_FAILED',
      `c2pa-node sign() rejected the asset: ${(err as Error).message}`,
      'Caller should degrade gracefully (return original bytes) per D-CTX-9.',
    );
  }
}

/**
 * Sign + embed manifest into a file asset (MP4 / WebP / TIFF / JPEG / PNG file form).
 *
 * Writes signed bytes to `destPath`. If `srcPath === destPath` the original
 * file is OVERWRITTEN. Caller is responsible for choosing the right path.
 */
export async function signEmbedFile(
  srcPath: string,
  destPath: string,
  mimeType: string,
  manifestDef: ManifestDefinition,
  signer: LoadedSigner,
): Promise<void> {
  const c2paNode = await ensureC2paNode();
  try {
    await signer.c2pa.sign({
      asset: { path: srcPath, mimeType },
      manifest: new c2paNode.ManifestBuilder(manifestDef as never),
      thumbnail: false,
      options: { outputPath: destPath },
    });
  } catch (err) {
    if (err instanceof TypedError) throw err;
    throw new TypedError(
      'C2PA_SIGNING_FAILED',
      `c2pa-node sign() (file API) rejected the asset: ${(err as Error).message}`,
      'Caller should degrade gracefully (skip + log) per D-CTX-9.',
    );
  }
}
