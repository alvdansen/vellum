// Engine-layer C2PA signer wrapper.
//
// This is the ONLY file in the codebase that imports c2pa-node. The
// architecture-purity test asserts:
//   grep -rE "from\s*['\"]c2pa-node|import\s*\(\s*['\"]c2pa-node" src/
//   (excluding __tests__) returns matches ONLY in src/engine/c2pa/signer.ts.
//
// Hardening notes:
//   - algorithm detection via X509Certificate (no hard-coded ES256)
//   - RFC4514-safe subject parser (no naive regex)
//   - lazy native binding load + try/catch (no boot crash)
//
// TSA is MANDATORY on c2pa-node v0.5.26 — verified empirically, not from
// the docs, because this file used to claim the opposite in two places:
//   - `tsaUrl` absent from the LocalSigner literal → `signClaimBytes`
//     throws "TypeError: failed to downcast any to string" from c2pa-rs.
//     Every sign attempt fails. There is NO offline signing on 0.5.26.
//   - `tsaUrl: ''` → the URL parser throws `RelativeUrlWithoutBase`.
//   - `tsaUrl: <valid URL>` → signing works.
// The config loader therefore defaults VELLUM_C2PA_TSA_URL to a public
// RFC 3161 endpoint (DEFAULT_TSA_URL in utils/c2pa-config.ts) so the
// out-of-the-box configuration can actually sign; operators point it at
// an internal TSA via the env var. The trade-off is explicit: every sign
// call reaches the configured TSA. Air-gapped deployments cannot sign on
// this binding version — say so, rather than failing every call while
// logging "signing enabled". `null` remains representable for callers
// (and tests) that exercise the failure path deliberately.

import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { TypedError } from '../errors.js';
import type { BuildManifestResult, IngredientSpec } from './manifest-builder.js';

// c2pa-node native binding — loaded lazily so a broken binding cannot crash boot.
type C2paNodeModule = typeof import('c2pa-node');
let c2paNodeModule: C2paNodeModule | null = null;
let c2paNodeLoadError: Error | null = null;

/**
 * Lazy + try/catch'd native binding load. The first invocation attempts the
 * dynamic import; subsequent invocations reuse the cached module OR throw
 * the cached load error wrapped in `C2PA_SIGNER_LOAD_FAILED`. Server boot
 * NEVER calls this — the engine's signing hook is the first call site at
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
 * attempted. Returns false ONLY after a load attempt failed. The engine's
 * graceful-fail path uses this to short-circuit retries.
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
 * Fallback TSA used only when `loadSigner` is called without a third
 * argument (direct callers/tests not threaded through C2paConfig). The
 * engine call site passes `c2paConfig.tsaUrl`, whose loader default is the
 * same endpoint (DEFAULT_TSA_URL in utils/c2pa-config.ts) — a TSA is
 * mandatory for any signature at all on c2pa-node v0.5.26 (see file
 * header). Mirrors c2pa-node's own `createTestSigner` default.
 */
const FALLBACK_TSA_URL = 'http://timestamp.digicert.com';

/**
 * Loads the cert + key into memory ONCE, detects the cert's signature
 * algorithm via X509Certificate, derives a path-leak-free subject summary,
 * and returns a `LoadedSigner` carrying a configured `c2pa-node` C2pa
 * instance.
 *
 * Throws `TypedError('C2PA_SIGNER_LOAD_FAILED', ...)` on any failure path
 * (binding load, file read, cert parse, key parse, unsupported algorithm,
 * c2pa-node createC2pa rejection). NEVER logs key bytes.
 *
 * `tsaUrl` is operator-controllable via `VELLUM_C2PA_TSA_URL`; the config
 * loader defaults it to a working public endpoint because a TSA is
 * mandatory on c2pa-node v0.5.26 (see file header). The engine passes
 * `c2paConfig.tsaUrl` verbatim. When a caller passes `null` explicitly,
 * the LocalSigner literal omits the property and every sign attempt fails
 * with the binding's downcast error; the engine surfaces that as
 * status_reason='sign_call_failed' — tests exercise this path on purpose.
 *
 * @param certPemPath  Absolute path to the PEM-encoded cert (chain).
 * @param privateKeyPemPath  Absolute path to the PEM-encoded private key.
 * @param tsaUrl  RFC 3161 TSA endpoint. Default FALLBACK_TSA_URL (only when
 *                the argument is omitted entirely). `null` means NO TSA,
 *                which on c2pa-node v0.5.26 means signing cannot succeed.
 */
export async function loadSigner(
  certPemPath: string,
  privateKeyPemPath: string,
  tsaUrl: string | null = FALLBACK_TSA_URL,
): Promise<LoadedSigner> {
  const c2paNode = await ensureC2paNode(); // fails loud if binding broken

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
      'Verify VELLUM_C2PA_CERT_PEM_PATH + VELLUM_C2PA_PRIVATE_KEY_PEM_PATH point to readable files.',
    );
  }

  // Parse cert + detect algorithm.
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

  // Derive a path-leak-free subject summary.
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
 * Match cert algorithm to c2pa-node SigningAlgorithm enum.
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
 * RFC4514-safe subject parser.
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

// ──────────────────────────────────────────────────────────────────────────
// Ingredient-aware signers.
// ──────────────────────────────────────────────────────────────────────────
//
// signer.ts is STILL the only file in src/ that imports the native binding.
// These new entry points drive createIngredient + manifestBuilder.addIngredient
// for each spec where assetRef.kind !== 'unavailable' BEFORE calling sign().
// Specs with assetRef.kind === 'unavailable' are skipped here — their audit
// trail lives in result.definition.assertions[] as a
// vellum.unavailable_ingredient custom assertion (emitted by
// buildManifestWithIngredients).

/**
 * Sign + embed manifest into a buffer asset (JPEG / PNG only),
 * threading IngredientSpec[] through the native binding's createIngredient +
 * manifestBuilder.addIngredient API before sign.
 *
 * For each spec with assetRef.kind !== 'unavailable':
 *   1. Calls signer.c2pa.createIngredient({ asset, title }) — the native
 *      binding computes its own labeled SHA (sha384-base64 by default) and
 *      produces a StorableIngredient.
 *   2. Sets storable.ingredient.relationship to the matching Relationship
 *      enum value (ParentOf | ComponentOf).
 *   3. Calls manifestBuilder.addIngredient(storable).
 *
 * Specs with assetRef.kind === 'unavailable' are SKIPPED — their audit
 * trail lives in definition.assertions as vellum.unavailable_ingredient
 * (emitted by buildManifestWithIngredients).
 *
 * Throws `TypedError('C2PA_SIGNING_FAILED', ...)` on:
 *   - unsupported MIME type (caller passed video/mp4, etc.)
 *   - c2pa-node sign() rejection (corrupted asset, network failure on TSA, etc.)
 *
 * The engine hook catches this as a graceful-fail — the caller
 * keeps the original bytes.
 */
export async function signEmbedBuffer(
  buffer: Buffer,
  mimeType: string,
  result: BuildManifestResult,
  signer: LoadedSigner,
): Promise<Buffer> {
  if (!BUFFER_API_MIMETYPES.has(mimeType)) {
    throw new TypedError(
      'C2PA_SIGNING_FAILED',
      `Buffer-API signing not supported for ${mimeType} — use signEmbedFile instead`,
      'The native binding v0.5.x supports buffer signing only for image/jpeg + image/png. MP4/WebP/TIFF must use the file-path API.',
    );
  }
  const c2paNode = await ensureC2paNode();
  const builder = new c2paNode.ManifestBuilder(result.definition as never);
  await addIngredientsToBuilder(c2paNode, signer, builder, result.ingredientSpecs);
  try {
    const signResult = await signer.c2pa.sign({
      asset: { buffer, mimeType },
      manifest: builder,
      thumbnail: false,
    });
    return signResult.signedAsset.buffer;
  } catch (err) {
    if (err instanceof TypedError) throw err;
    throw new TypedError(
      'C2PA_SIGNING_FAILED',
      `c2pa-node sign() rejected the asset: ${(err as Error).message}`,
      'The caller degrades gracefully — the original bytes are kept unsigned.',
    );
  }
}

/**
 * Sign + embed manifest into a file asset (MP4 / WebP / TIFF /
 * JPEG / PNG file form), threading IngredientSpec[] through the native
 * binding's createIngredient + manifestBuilder.addIngredient API before sign.
 *
 * Writes signed bytes to destPath. If `srcPath === destPath` the original
 * file is OVERWRITTEN. Caller is responsible for choosing the right path.
 */
export async function signEmbedFile(
  srcPath: string,
  destPath: string,
  mimeType: string,
  result: BuildManifestResult,
  signer: LoadedSigner,
): Promise<void> {
  const c2paNode = await ensureC2paNode();
  const builder = new c2paNode.ManifestBuilder(result.definition as never);
  await addIngredientsToBuilder(c2paNode, signer, builder, result.ingredientSpecs);
  try {
    await signer.c2pa.sign({
      asset: { path: srcPath, mimeType },
      manifest: builder,
      thumbnail: false,
      options: { outputPath: destPath },
    });
  } catch (err) {
    if (err instanceof TypedError) throw err;
    throw new TypedError(
      'C2PA_SIGNING_FAILED',
      `c2pa-node sign() (file API) rejected the asset: ${(err as Error).message}`,
      'The caller degrades gracefully — signing is skipped and logged.',
    );
  }
}

/**
 * Drive the native binding's createIngredient + addIngredient for
 * each spec. Specs with assetRef.kind === 'unavailable' are skipped — those
 * are recorded as vellum.unavailable_ingredient custom assertions
 * inside result.definition.assertions (emitted by
 * buildManifestWithIngredients).
 *
 * Each createIngredient call streams the asset bytes through c2pa-rs to
 * compute its own labeled SHA. We do NOT supply a precomputed hash — the
 * native binding API requires the asset bytes regardless.
 *
 * RUNTIME DEVIATION (the published API surface is broken):
 *   The native binding v0.5.26 declares `export enum Relationship` in
 *   dist/js-src/types.d.ts, but NO matching dist/js-src/types.js file ships
 *   in the published tarball — `index.js` re-exports neither types.d.ts nor
 *   the Relationship symbol. At runtime, `c2paNode.Relationship` is therefore
 *   `undefined`. The relationship VALUES are pure strings — 'parentOf' /
 *   'componentOf' — and the typed `Ingredient.relationship` field accepts
 *   that same union (relationship?: Relationship). We assign the literal
 *   strings directly and cast through the enum's string-union type to keep
 *   the structural compatibility check honest.
 *
 *   The `_c2paNode` parameter remains in the signature so future versions
 *   that DO ship the enum at runtime can be picked up by replacing the
 *   literal-string assignment with `c2paNode.Relationship.ParentOf` etc.
 */
async function addIngredientsToBuilder(
  _c2paNode: typeof import('c2pa-node'),
  signer: LoadedSigner,
  builder: import('c2pa-node').ManifestBuilder,
  specs: IngredientSpec[],
): Promise<void> {
  for (const spec of specs) {
    if (spec.assetRef.kind === 'unavailable') continue;
    const asset: import('c2pa-node').Asset =
      spec.assetRef.kind === 'buffer'
        ? { buffer: spec.assetRef.buffer, mimeType: spec.assetRef.mimeType }
        : { path: spec.assetRef.path, mimeType: spec.assetRef.mimeType };
    // signer.c2pa is a `C2pa` (ReturnType<createSign> & { createIngredient }).
    const storable = await signer.c2pa.createIngredient({
      asset,
      title: spec.title,
      // No `hash` override — the native binding computes its labeled SHA
      // from the asset bytes. The manifest_signed event still records OUR
      // bytewise sha256 of the signed output (Engine.signOutput);
      // per-ingredient labeled hashes belong to the native binding's domain.
    });
    // Literal string values per the Relationship enum declaration in
    // dist/js-src/types.d.ts (no runtime export — see deviation note above).
    const relValue = spec.relationship === 'parentOf' ? 'parentOf' : 'componentOf';
    storable.ingredient.relationship =
      relValue as import('c2pa-node').types.Relationship;
    builder.addIngredient(storable);
  }
}
