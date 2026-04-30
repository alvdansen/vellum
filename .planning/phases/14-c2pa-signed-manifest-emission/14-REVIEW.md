---
phase: 14-c2pa-signed-manifest-emission
reviewed: 2026-04-30T00:00:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - src/utils/c2pa-config.ts
  - src/types/c2pa.ts
  - src/types/provenance.ts
  - src/engine/c2pa/format-router.ts
  - src/engine/c2pa/manifest-builder.ts
  - src/engine/c2pa/signer.ts
  - src/engine/c2pa/index.ts
  - src/engine/pipeline.ts
  - src/engine/output-downloader.ts
  - src/engine/errors.ts
  - src/store/provenance-repo.ts
  - src/store/schema.ts
  - drizzle/0006_phase14_manifest_signed_event.sql
  - src/http/dashboard-routes.ts
  - src/server.ts
  - src/tools/version-tool.ts
  - src/__tests__/architecture-purity.test.ts
  - src/__tests__/c2pa-config.test.ts
  - src/__tests__/c2pa-key-leak-negative.test.ts
  - src/__tests__/c2pa-verification.test.ts
  - src/__tests__/c2pa-dual-transport-parity.test.ts
  - src/__tests__/c2pa-uat-mcp-tool.test.ts
  - src/engine/c2pa/__tests__/signer.test.ts
  - src/engine/c2pa/__tests__/format-router.test.ts
  - src/engine/c2pa/__tests__/manifest-builder.test.ts
  - src/engine/__tests__/sign-output.test.ts
  - packages/dashboard/src/components/C2paBadge.tsx
  - packages/dashboard/src/lib/api.ts
  - scripts/gen-dev-c2pa-cert.mts
findings:
  high: 0
  medium: 3
  low: 4
  info: 5
  total: 12
status: findings_found
---

# Phase 14: C2PA Signed Manifest Emission — Code Review

**Reviewed:** 2026-04-30
**Depth:** standard
**Status:** findings_found
**Bottom line:** Crypto correctness is solid. No HIGH-severity issues. Three MEDIUM operational concerns (TSA reachability default, manifest-event scan complexity, BUFFER_SIGNING_MAX_BYTES drift risk) plus minor cleanup items.

## Summary

Phase 14 lands the engine-layer signing facade, configuration boundary, provenance event, HTTP header surface, MCP tool field, and dashboard badge. Cryptographic correctness is well-handled: c2pa-rs internally computes and verifies `c2pa.hash.data` / `c2pa.hash.bmff` (proven by tamper-detection test 17 in `c2pa-verification.test.ts`), algorithm detection via X509Certificate fails-loud on unsupported certs (`signer.ts:207-268`), and the architecture-purity guard centralizes c2pa-node imports to `src/engine/c2pa/signer.ts` only.

The three MEDIUM items are all around operations:

1. **Default TSA reaches DigiCert public service** — `signer.ts:109` defaults `tsaUrl` to `http://timestamp.digicert.com`. This hits a third-party network on every `signer.c2pa.sign(...)` call (RFC 3161 round-trip) and is not surfaced through `C2paConfig` so operators can't disable it without code changes. Air-gapped or offline-validating deployments will silently fail-soft on every sign attempt.
2. **`getLatestManifestSignedEvent` is O(N) with JSON.parse per row** — `provenance-repo.ts:210-235` reads ALL `manifest_signed` rows for a version, then JSON.parses each to filter by filename. Hot path on every HTTP `GET /api/versions/:id/output` AND every MCP `version.get`. v1.1 outputs are usually 1 file, so impact is small; the design is fine for v1.1 but should be revisited if recovery-poller multi-attempt scenarios pile up many failed events.
3. **`BUFFER_SIGNING_MAX_BYTES` is duplicated** — defined in `pipeline.ts:85` AND `output-downloader.ts:78`. Comment acknowledges drift risk but no test enforces equality.

Architecture-purity, append-only provenance, dual-transport parity, and key-leak invariants are well-tested. The test surface is comprehensive (~1800 lines of c2pa-specific tests across unit + integration + UAT) and the negative tests (key-leak, tamper detection) actually run real crypto.

No HIGH-severity findings.

---

## Medium

### MR-01: Default TSA URL is a third-party plaintext endpoint with no override
**File:** `src/engine/c2pa/signer.ts:109,123-130`
**Issue:** `DEFAULT_TSA_URL = 'http://timestamp.digicert.com'` is the hard-coded default for `loadSigner`'s optional `tsaUrl` argument. The Engine call site (`pipeline.ts:1078-1082`) calls `loadSigner(config.certPemPath, config.privateKeyPemPath)` with no third arg, so every production signer hits DigiCert on every `c2pa.sign()` call. There is no `C2paConfig.tsaUrl` field — operators cannot opt out of network calls or point at an internal TSA without modifying source. The file header acknowledges Plan 14-04 should "make this configurable" but it didn't ship.

This has two real consequences:

1. **Air-gapped or restricted-egress deployments fail at sign time.** Boot succeeds (config is just paths). The first `signOutput` attempts a TLS-less RFC 3161 round-trip to a third party that the firewall blocks → `c2pa-node sign() rejected the asset` → `status_reason='sign_call_failed'` for every output. The dashboard renders `C2PA: unsigned (signing failed)` with no breadcrumb pointing at TSA reachability.
2. **Silent dependency on a third-party service for AI-origin attribution.** The cert chain says ComfyUI; the timestamp says DigiCert. For a regulator-verifiable AI-origin claim (EU AI Act Article 50), shipping with an unconfigurable third-party endpoint is a privacy/availability concern.

The c2pa-node v0.5.26 downcast bug (TSA can't be `undefined` or `''`) is real, but the workaround should be operator-controllable.

**Fix:** Add `tsaUrl?: string | null` to `C2paConfig`, threaded from `loadC2paConfigFromEnv` via `VFX_FAMILIAR_C2PA_TSA_URL`. Default to `null` (signing without TSA where the c2pa-node bug allows) OR keep DigiCert as a documented fallback only when `null` would crash. Currently signer.ts already supports `tsaUrl: null` via the conditional LocalSigner literal at lines 169-182, so the null branch is plumbed — it just isn't reachable from production config.
```typescript
// src/types/c2pa.ts — add field
export interface C2paConfig {
  readonly certPemPath: string;
  readonly privateKeyPemPath: string;
  /** Optional RFC 3161 TSA endpoint. Null disables timestamping. Defaults to
   *  null (no TSA) — operator must opt in to a TSA via env var. */
  readonly tsaUrl: string | null;
}

// src/utils/c2pa-config.ts — read env, default null
const tsaUrl = env.VFX_FAMILIAR_C2PA_TSA_URL ?? null;
return { certPemPath, privateKeyPemPath, tsaUrl };

// src/engine/pipeline.ts:1078-1082
const signer = await loadSigner(
  this.c2paConfig.certPemPath,
  this.c2paConfig.privateKeyPemPath,
  this.c2paConfig.tsaUrl,
);
```

### MR-02: `getLatestManifestSignedEvent` does an unindexed full scan + JSON.parse per row
**File:** `src/store/provenance-repo.ts:210-235`
**Issue:** Every call (and there are several per HTTP request — the resolve happens for both GET + HEAD on `/api/versions/:id/output`, plus on MCP `version.get`) executes:

```typescript
const rows = this.db.select().from(provenance)
  .where(and(eq(provenance.version_id, versionId), eq(provenance.event_type, 'manifest_signed')))
  .orderBy(desc(provenance.timestamp))
  .all();  // pulls ALL manifest_signed events for the version
for (const row of rows) {
  if (!row.manifest_signed_json) continue;
  try {
    const parsed = JSON.parse(row.manifest_signed_json) as ManifestSignedPayloadFields;
    if (parsed.filename === filename) return parsed;  // O(N) linear scan
  } catch { continue; }
}
```

The comment explicitly chose this over `json_extract` for portability — fine. But:

- Every call materializes ALL manifest_signed events into JS heap (no LIMIT clause).
- JSON.parse runs against every row until the matching filename is found.
- The recovery-poller's idempotency guard ALSO calls this — every retry burns the same scan.

Worst case: a multi-output version (Phase 15+ ingredient graph could fan out) with many signed=false retries would O(N²) the scan across attempts. v1.1 outputs are typically 1 file per version, so the practical impact is small.

**Fix:** Add `LIMIT 50` (or similar bound) on the rows query — newest-first ordering means the latest matching event is overwhelmingly within the first 1-2 rows. Alternatively, store filename in a dedicated indexed column (would require migration 0007). Lowest-cost fix:
```typescript
.orderBy(desc(provenance.timestamp))
.limit(50)  // newest 50 — beyond this is recovery-poller noise
.all();
```
A comment + matching test should document the assumption that "no version emits more than 50 manifest_signed events in any reasonable scenario."

### MR-03: `BUFFER_SIGNING_MAX_BYTES` is duplicated across two files with no enforced equality
**File:** `src/engine/pipeline.ts:85` AND `src/engine/output-downloader.ts:78`
**Issue:**
```typescript
// src/engine/pipeline.ts:85
export const BUFFER_SIGNING_MAX_BYTES = 500 * 1024 * 1024;

// src/engine/output-downloader.ts:78  (same value, different name, with comment pleading for sync)
const DOWNLOADER_BUFFER_SIGNING_MAX_BYTES = 500 * 1024 * 1024;
```
The downloader's comment acknowledges this is a duplication and asks future contributors to keep them in sync, but no test enforces equality. The comment notes the duplication exists to avoid a "circular dependency" — that's not actually a circular dep (pipeline.ts already exports the constant; output-downloader.ts imports nothing from pipeline.ts at present). The downloader could safely import the constant.

**Fix:** Either import the constant from pipeline.ts:
```typescript
// src/engine/output-downloader.ts
import { BUFFER_SIGNING_MAX_BYTES } from './pipeline.js';
// ...use BUFFER_SIGNING_MAX_BYTES directly
```
OR add an architecture-purity test that asserts both literals are the same:
```typescript
it('BUFFER_SIGNING_MAX_BYTES literal in pipeline.ts == output-downloader.ts (drift guard)', () => {
  const pipeline = readFileSync('src/engine/pipeline.ts', 'utf8');
  const downloader = readFileSync('src/engine/output-downloader.ts', 'utf8');
  const pVal = pipeline.match(/BUFFER_SIGNING_MAX_BYTES = (\S+) \* (\S+) \* (\S+);/);
  const dVal = downloader.match(/DOWNLOADER_BUFFER_SIGNING_MAX_BYTES = (\S+) \* (\S+) \* (\S+);/);
  expect(pVal?.slice(1)).toEqual(dVal?.slice(1));
});
```
The shared-import option is preferable — it eliminates the drift class entirely.

---

## Low

### LR-01: Temp-dir `<outputsDir>/.tmp-c2pa/<versionId>/` accumulates empty directories indefinitely
**File:** `src/engine/pipeline.ts:1115-1162`
**Issue:** `signViaTempFiles` creates `<outputsDir>/.tmp-c2pa/<versionId>/` per version on first file-API sign and deletes ONLY the temp files inside via `rm(srcTempPath, { force: true })` and `rm(destTempPath, { force: true })`. The `<versionId>` subdirectory itself is never removed. On a long-running server with many version IDs producing MP4/WebP/TIFF outputs, the operator ends up with `.tmp-c2pa/{N empty subdirs}` over weeks/months.

```typescript
// pipeline.ts:1146-1161 — no rmdir of tmpRoot, only of files inside
} finally {
  if (usedSrcTemp) {
    await rm(srcTempPath, { force: true });
  }
  if ('bytes' in input) {
    await rm(destTempPath, { force: true });
  }
}
```

Not a bug, but a cleanup hygiene gap. Easy to address with a final empty-dir prune.

**Fix:** After both file unlinks, attempt a non-recursive rmdir of the version subdir (success or not — empty-only):
```typescript
} finally {
  // ... existing file cleanup ...
  // Best-effort: remove the empty version subdir. If other concurrent signs
  // are mid-flight (unlikely — idempotency guard upstream), rmdir fails on
  // ENOTEMPTY and we leave it.
  try {
    await rmdir(tmpRoot);  // non-recursive — only deletes if empty
  } catch {
    // Either dir not empty (concurrent sign) or already gone — both acceptable.
  }
}
```
Optionally add a Phase-14 boot cleanup step that prunes `<outputsDir>/.tmp-c2pa/` on server start (mirrors the migrate-on-boot pattern).

### LR-02: `isC2paNodeAvailable()` returns `true` BEFORE the first load attempt
**File:** `src/engine/c2pa/signer.ts:69-79`
**Issue:** The function is documented (in the JSDoc) but the name "is available" is misleading. Before any `loadSigner` call, `c2paNodeLoadError === null` is true so the function returns true even when c2pa-node hasn't yet been imported.
```typescript
export function isC2paNodeAvailable(): boolean {
  return c2paNodeLoadError === null;  // true before any load attempt
}
```
Plan 14-03's `getOrLoadSigner` uses `signerLoadFailedReason` (separate state) so it's not affected by this — but a future contributor could reasonably write `if (isC2paNodeAvailable()) { ... }` before any load and get a misleading "yes."

**Fix:** Rename to `isC2paNodeLoadFailed()` (inverted semantics) OR document the tri-state more aggressively in the function name:
```typescript
export function hasC2paNodeLoadFailed(): boolean {
  return c2paNodeLoadError !== null;  // false until first failure caches the error
}
```
Or expose a `LoadState = 'unattempted' | 'loaded' | 'failed'` enum.

### LR-03: Verification tests depend on third-party fixture paths under `node_modules/c2pa-node/tests/fixtures/certs/`
**File:** `src/__tests__/c2pa-verification.test.ts:76-77`, `c2pa-key-leak-negative.test.ts:63-64`, `c2pa-dual-transport-parity.test.ts:73-74`, `c2pa-uat-mcp-tool.test.ts:49-50`, `sign-output.test.ts:43-44`, `signer.test.ts:163-167`
**Issue:** Six test files hard-code `resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pub')` and `.../es256.pem`. If c2pa-node ships a v0.5.27+ that reorganizes its `tests/fixtures/` directory, the entire C2PA test suite breaks with `ENOENT`. The package.json pin at exactly `0.5.26` reduces but doesn't eliminate this risk (an `npm install` against a fresh registry could in theory yank or replace the tarball).

**Fix:** Defensively check fixture availability via `existsSync` and `describe.skipIf(!certsExist)` — same pattern already used for openssl + ffmpeg gates. OR copy the bundled certs into a project-owned fixture path (e.g., `tests/fixtures/c2pa/bundled/`) at install time via a `postinstall` script. The `existsSync` skip is the cheaper option:
```typescript
const haveBundledCerts = existsSync(BUNDLED_CERT_PATH) && existsSync(BUNDLED_KEY_PATH);
describe.skipIf(!haveOpenssl || !haveBundledCerts)('...', () => {
  // tests
});
```

### LR-04: `void rm` import in output-downloader.ts is dead code
**File:** `src/engine/output-downloader.ts:32-41,234-237`
**Issue:** The `rm` import from `node:fs/promises` is included with a comment "Reserved for future cleanup helpers ... Tree-shaking / dead-code elimination at the bundler removes the unused binding." TypeScript + Node.js ESM doesn't actually tree-shake this — `import { rm }` retains the binding at runtime. The `void rm;` discard pattern at line 237 explicitly prevents the lint from removing it. Either use `rm` for a real cleanup task (LR-01 above is one candidate), or remove the import.

**Fix:** Either remove the `rm` import entirely OR wire it into the LR-01 fix as the `rmdir`/`rm` boundary cleanup. Don't keep a dead import alive on speculative future use.

---

## Info

### IR-01: Engine `c2paConfig` private field; no public getter, no test asserting accessor invariant
**File:** `src/engine/pipeline.ts:182,212`
**Issue:** The Engine's `c2paConfig` is declared `private readonly` and stored at construction. Plan 14-01 deliberately omitted a public getter "until needed" but Plan 14-03 / 14-04 / 14-05 all read it through `signOutput` / `getOrLoadSigner` indirectly. There is no test that asserts the path strings are NEVER returned in any tool envelope or HTTP body. The key-leak negative test covers the cert/key BYTES, not the config path strings (which could leak directory layout if accidentally serialized).

**Fix:** Add an explicit negative test asserting `engine.getVersion(...)` envelope and `engine.getProvenance(...)` payload contain ZERO substring matches of `engine.c2paConfig.certPemPath` or `.privateKeyPemPath`. Defence-in-depth on top of T-14-12 mitigation.

### IR-02: tsaUrl downcast bug workaround is hard-coded in a runtime constant
**File:** `src/engine/c2pa/signer.ts:13-27,109`
**Issue:** The file header is excellent — it documents the c2pa-node v0.5.26 native binding bug clearly (tsaUrl can't be `undefined` or `''`, must be a valid URL string OR property absent). However, the workaround is to default to `http://timestamp.digicert.com`. If c2pa-node fixes this in v0.5.27+ (or v0.6.0), a code review will need to revisit this default. There's no version-gate or warning when the upstream might have moved on.

**Fix:** Add a TODO-like comment with a c2pa-node version reference + GitHub issue link (if one exists). Better: add a runtime check that warns at first signer load if `c2pa-node`'s detected version doesn't match the pinned 0.5.26.

### IR-03: `loadC2paConfigFromEnv` permissive-key-mode warning is non-blocking
**File:** `src/utils/c2pa-config.ts:79-89`
**Issue:** When the private key file mode is more permissive than `0o600` (e.g., world-readable), the loader emits a stderr warning but does NOT refuse to boot. Test 9 in `c2pa-config.test.ts` validates this is "warn but don't throw" behavior. For some operator profiles (CI test runners with `umask 0022`) the warning will fire on every startup, training operators to ignore it. For a regulated AI-origin claim, refusing to boot on a world-readable cert key is defensible.

**Fix:** Promote the warning to an opt-out. Add `VFX_FAMILIAR_C2PA_PERMISSIVE_KEY_MODE=allow` env var. Default = throw `C2PA_CONFIG_INVALID` when key file has any group/world bits set; opt-out logs a warning.

### IR-04: `__resetC2paNodeStateForTests` is exported from production code
**File:** `src/engine/c2pa/signer.ts:89-92`
**Issue:** The `__` prefix and JSDoc warn against production use, but it's still in the runtime export surface. Future agentic refactors / IDE auto-imports could pull this in by mistake.

**Fix:** Move test-only escape hatches into a sibling `signer-test-helpers.ts` only imported by `__tests__/`. The architecture-purity test could then assert `__reset` is not imported outside `__tests__/`.

### IR-05: `getLatestManifestSignedEvent` JSON.parse failure path silently continues
**File:** `src/store/provenance-repo.ts:226-232`
**Issue:** When a `manifest_signed_json` row fails to parse (e.g., truncated write, corrupted column), the function silently `continue`s to the next row. No log, no metric, no health signal. If a database corruption or storage layer issue starts truncating JSON payloads, the system silently degrades to "C2PA: pending" state for affected versions with no operator-visible signal.

**Fix:** Add a `console.error('vfx-familiar: malformed manifest_signed_json for version=...; skipping')` log on the catch path. Counts toward operator visibility but doesn't change behavior.

---

## Cryptographic correctness review (focused)

These items were specifically requested for crypto-rigor. All are verified PRESENT and CORRECT:

| Concern | Status | Evidence |
|---|---|---|
| `c2pa.hash.data` binds to asset bytes (not metadata) | OK | `c2pa-verification.test.ts:692-727` (Test 17) flips a byte in IDAT, asserts `assertion.dataHash.mismatch` validation status. c2pa-rs computes hash internally — clean validation in Test 4 (PNG), Test 6 (JPEG), Test 8 (MP4 BMFF). |
| Algorithm selection from cert (ES256/ES384/PS256/PS384/ED25519) | OK | `signer.ts:207-268` `detectSigningAlgorithm` inspects `cert.publicKey.asymmetricKeyType` + `asymmetricKeyDetails`. Tests 2-6 in `signer.test.ts` cover ES256, ES384, PS256, Ed25519, and unsupported plain RSA fail-loud. |
| Race conditions on concurrent signers | OK | `output-downloader.ts:190` uses unique `nanoid(8)` partial paths. Test D6 in `sign-output.test.ts:652-684` runs two parallel `downloadOutput` calls and asserts no orphan partial files. |
| EXDEV (cross-device) rename fallback | OK | `output-downloader.ts:221-232` `renameWithFallback` catches `EXDEV` and falls back to `copyFile + unlink`. Test D11 `sign-output.test.ts:784-807` asserts the source-level pattern. |
| Re-sign idempotency (already-signed file detection) | OK | `pipeline.ts:903-911` `prior` check + `output-downloader.ts:172-178` `alreadySigned` short-circuit. Tests D8 + 11 in `sign-output.test.ts` confirm second download emits zero new events. |
| Lazy native binding load failure | OK | `signer.ts:36-79` `ensureC2paNode` + `c2paNodeLoadError` cache. Tests 9, 20 in `signer.test.ts` simulate `vi.doMock('c2pa-node', ...)` throwing. |
| Pre-stat OOM guard (>500MB → file API) | OK | `output-downloader.ts:165-168` selects `filePath` input over `bytes` input above cap. `pipeline.ts:976-990` second-line defense fails with `asset_too_large_for_buffer_api`. |
| Private key NEVER in logs / envelopes / HTTP / provenance JSON | OK | `c2pa-key-leak-negative.test.ts` covers 9 channels: stdout, stderr, console.*, tool envelope, HTTP body, provenance events, cert subject, file-mode warning, schema regression. Random 32-byte slices from PKCS#8 body assert no leak. |
| Cert/key path traversal (realpathSync + allowlist) | OK | `c2pa-config.ts:99-117` realpath + allowlist containment. Test 6 (out-of-allowlist), Test 7 (symlink-out-of-allowlist), Test 8 (custom root override) in `c2pa-config.test.ts`. Path leak hygiene: only basenames in error messages (Tests 3, 4, 6, 9). |
| RFC4514 cert subject parser (escaped commas) | OK | `signer.ts:283-311` `deriveCertSubjectSummary` with `unescapeRfc4514`. Tests 7, 8 in `signer.test.ts` cover `CN=Acme\, Inc` + serialNumber-only fallback to `fp:<sha256-prefix>`. |
| Manifest content (no full filesystem paths, no PII, no prompt blob leakage) | OK | `manifest-builder.ts:127-131` emits `model=<basename>; hash=<hex>` — no path components. Phase 13 already extracts basenames into models_json. Test 11 in `manifest-builder.test.ts` asserts no `/` characters in description. |
| Buffer DoS (size cap on buffer-API formats) | OK | 500 MB cap at `pipeline.ts:85` and `output-downloader.ts:78`. See MR-03 for drift concern. |
| Architecture-purity (c2pa-node centralized in signer.ts) | OK | `architecture-purity.test.ts:166-200` asserts `c2pa-node` imports appear ONLY in `src/engine/c2pa/signer.ts` (excluding `__tests__/`). Robust regex covers static + dynamic imports. |
| Append-only provenance (no UPDATE/DELETE on provenance) | OK | `provenance-repo.ts` has zero `db.update` / `db.delete` calls; existing architecture-purity guard (Phase 3) enforces this. `appendManifestSignedEvent` is INSERT-only via `insertEvent`. |
| Tool budget unchanged | OK | `version-tool.ts:122-123` adds `c2pa_status` + `c2pa_status_reason` fields to the existing `version.get` envelope. No new top-level MCP tool registered. |
| Dual-transport parity | OK | `c2pa-dual-transport-parity.test.ts` covers PNG, MP4, TIFF body parity + header parity + signing-disabled + EXR-unsupported + Cache-Control + HEAD across both stdio and HTTP paths. |
| No PII / secret data in logs | OK | All boot logs and error messages use `basename(path)` only. Comprehensively tested in `c2pa-config.test.ts` Tests 3, 4, 6, 9. |

---

## REVIEW COMPLETE — findings: H=0 M=3 L=4
