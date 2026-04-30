---
phase: 14-c2pa-signed-manifest-emission
plan: 01
subsystem: c2pa-config

tags: [c2pa, cert-key-config, env-validation, realpath-allowlist, path-leak-hygiene, native-binding-resilience, prov-v-01, prov-v-02, prov-v-05]

# Dependency graph
requires:
  - phase: 13-model-fingerprinting
    provides: "Phase 13 architecture-purity baseline (engine-layer purity + grep gates) — Plan 14-01 extends the same gates to assert src/server.ts has zero static c2pa-node imports (Concern #11 — boot resilience)."
  - phase: 03-provenance-versioning
    provides: "TypedError + ErrorCode union (D-PROV-32). Plan 14-01 ADDs 'C2PA_CONFIG_INVALID' to the union — additive, non-breaking."
  - phase: 02-comfyui-cloud
    provides: "validateBaseUrlFromEnv pattern at src/utils/validate-base-url.ts. Plan 14-01 mirrors this pattern verbatim for src/utils/c2pa-config.ts: pure helper, exported for tests, imported by src/server.ts boot path, throws TypedError on misconfig."
provides:
  - "c2pa-node v0.5.26 pinned EXACTLY in package.json + lockfile (no caret/tilde). Integrity sha512: O/L2lJaojO7NjvWspBieiam7YFvWhKCYZyZUW5pmcUsBVhkrmMOYaQNdK8F3iR22bdBoW3no412DwB9RCvmemA=="
  - "C2paConfig type at src/types/c2pa.ts — { readonly certPemPath: string; readonly privateKeyPemPath: string }. Both paths are post-realpath, post-allowlist absolute paths validated at boot. NULL means signing disabled."
  - "loadC2paConfigFromEnv helper at src/utils/c2pa-config.ts — env read + realpath + allowlist enforcement + typed-error fail-fast. 13 test cases covering all 10 plan-mandated behaviors plus 3 supplementary cases."
  - "src/server.ts boot-path threading: load → throw-on-misconfig → log basenames-only → thread to Engine.options.c2paConfig. Throws BEFORE Engine construction, BEFORE tool registration, BEFORE transport connect."
  - "Engine constructor accepts options.c2paConfig (default null), stored on a private readonly field. Plan 14-02's signer wrapper is the SOLE consumer of the cert/key bytes."
  - "scripts/gen-dev-c2pa-cert.mts — self-signed ES256 dev cert generator. Outputs to gitignored .c2pa-dev/. DEV-ONLY (banner in script header)."
  - "C2PA_CONFIG_INVALID added to TypedError ErrorCode union."
  - "Architecture-purity grep gate asserting src/server.ts has ZERO static `from 'c2pa-node'` imports (Concern #11 — boot resilience)."
affects:
  - "14-02 (consumes C2paConfig + reads cert/key bytes lazily in the signer wrapper; native-binding load happens here, NOT at boot)"
  - "14-03 (consumes Engine.c2paConfig accessor that 14-02 will add; checks null for graceful-skip per D-CTX-9)"
  - "14-04 (consumes Engine.c2paConfig + signer wrapper to wrap the HTTP download path with sign-then-stream)"
  - "14-05 (consumes the dev cert from .c2pa-dev/ for embed/sidecar/dual-transport-parity tests)"

# Tech tracking
tech-stack:
  added:
    - "c2pa-node@0.5.26 (exact pin)"
  patterns:
    - "Boot-time env validator pattern (mirror of validateBaseUrlFromEnv): pure helper, exported for tests, imported by src/server.ts boot path, throws TypedError on misconfig BEFORE any engine/transport/tool wiring. Reusable for any future env-driven config that must fail loud on misuse."
    - "realpath + allowlist containment guard for filesystem-path env vars: realpathSync follows symlinks, then assertion checks resolved path startsWith(root + sep). Defeats both `..` traversal and symlink-out-of-allowlist. Reusable for any future operator-supplied path env var."
    - "Path-leak hygiene in error messages and boot success log: emit BASENAME only (helpful debugging signal — operator can identify which file was rejected) but NEVER the full path / directory portion. Applies to TypedError messages on misconfig + the boot stderr success log."
    - "Native-binding load resilience via static-import grep gate: server boot does NOT static-import c2pa-node. The architecture-purity test enforces this with `grep -E 'from\\s+[\\\"\\']c2pa-node[\\\"\\']' src/server.ts` returning ZERO matches. Plan 14-02's signer wrapper handles the lazy load + try/catch fallback. Reusable for any other native-binding dependency where prebuild availability is platform-dependent."
    - "Boot fail-loud parity: Plan 14-01's C2PA_CONFIG_INVALID throws BEFORE Engine construction, mirroring Phase 10's MIGRATION_PENDING throw-before-tool-registration pattern. Misconfigured env vars surface immediately rather than on the first download."

key-files:
  created:
    - src/types/c2pa.ts
    - src/utils/c2pa-config.ts
    - src/__tests__/c2pa-config.test.ts
    - src/engine/__tests__/pipeline-c2pa-config.test.ts
    - scripts/gen-dev-c2pa-cert.mts
  modified:
    - package.json
    - package-lock.json
    - src/server.ts
    - src/engine/pipeline.ts
    - src/engine/errors.ts
    - src/__tests__/architecture-purity.test.ts
    - .gitignore

key-decisions:
  - "Pinned c2pa-node 0.5.26 EXACTLY (no caret/tilde). Native binding load verified on macOS arm64 via `node -e \"require('c2pa-node')\"` printing exported symbols (ManifestBuilder, SigningAlgorithm, createTestSigner, createC2pa). prebuild-install succeeded out of the box. No build-from-source step required."
  - "Allowlist root defaults to process.cwd(); operator override via VFX_FAMILIAR_C2PA_CERT_ROOT. Default-cwd is the most ergonomic for local dev (drop the cert anywhere under the repo and it just works) without sacrificing safety — a malicious VFX_FAMILIAR_C2PA_CERT_PEM_PATH pointing to /etc/shadow gets rejected with 'outside the allowed cert root'."
  - "Path-leak hygiene applied to BOTH error messages AND the boot success log. Error messages include the BASENAME of the rejected file (debugging signal — operator can identify which file was wrong) but never the full directory portion. Boot success log uses path.basename() in src/server.ts. Test 6 explicitly asserts the rejected path's directory does NOT appear in the error message (`expect(message).not.toContain(outsideRoot)`)."
  - "loadC2paConfigFromEnv accepts an optional `env` parameter (default process.env) so tests can drive it without mutating process.env. Mirrors validateBaseUrlFromEnv. Tests still mutate process.env for the typical case because that's the simplest fixture."
  - "T-14-04 mitigation surfaces as a stderr WARNING (not a throw) when key file mode is more permissive than 0600. World-readable / group-readable keys are a security concern but blocking would prevent local-dev workflows where the developer hasn't yet run `chmod 600` on a fresh key. Warning emits basename only."
  - "Engine constructor extension is purely additive: new optional `c2paConfig?: C2paConfig | null` in the options bag, default null. All 42 existing engine pipeline tests pass byte-unchanged. Plan 14-02 will wire the signer wrapper to read the field; Plan 14-01 only stores it."
  - "Dev cert generator shells out to openssl for the cert step (Node has no built-in x509 generation). Missing-openssl path detected via `which openssl` and surfaces a clear error + exit 2. Subject is short ASCII so Plan 14-02 Task 3's subject parser handles it without escape-char surprises."
  - "Architecture-purity grep gate using a regex tolerant to whitespace + either quote style: `from\\s+['\"]c2pa-node['\"]`. Avoids the fragility of literal-string matching on import shapes (the LOW-priority review note in Plan 14-01)."
  - "Helper exports DEFAULT_C2PA_CERT_ROOT_HINT as a public string constant so multiple error message hints can share it without copy-paste drift."

patterns-established:
  - "Layered fail-loud config validator with optional env injection: helper at src/utils/X-config.ts exports both the loader function and any associated constants/hints. Loader takes an optional `env: NodeJS.ProcessEnv` param (default process.env) for testability. Throws TypedError with a specific code + actionable hint. Reusable for any future env-driven config that must fail loud on misuse."
  - "Realpath+allowlist for operator-supplied path env vars: every cert/key/output path env var that crosses the trust boundary should be (1) realpath-resolved (catches symlinks), then (2) asserted to live inside an allowlist root, where (3) the root itself is configurable via a paired _ROOT env var. Reusable for VFX_FAMILIAR_MODELS_DIR (Phase 13) if it's ever extended to writable artifacts, and for any future operator-supplied path."
  - "Path-leak-hygiene for filesystem-path error messages: include the BASENAME of the rejected file in the TypedError.message, but NEVER the directory portion. The basename is a useful debugging signal (operator can identify which file was wrong). The directory portion can leak unrelated filesystem layout if misconfigured. Test the contract explicitly with `expect(message).not.toContain(rejectedDirPath)`."

requirements-completed: []  # Plan 14-01 contributes to PROV-V-01 / PROV-V-02 / PROV-V-05 (D-CTX-2 cert/key threading) but does NOT close any of them. Cohort closure happens after Plan 14-04 (HTTP route integration) at the earliest, with full closure in Plan 14-05 (verification fixture).

# Metrics
duration: ~9min
completed: 2026-04-30
---

# Phase 14 Plan 01: c2pa-node pinning + cert/key config foundation Summary

**Establishes the configuration foundation for Phase 14 — pinned c2pa-node@0.5.26, typed C2paConfig threaded through Engine, boot-time env validation with realpath + allowlist guard (Concern #4 path-traversal mitigation), basename-only path-leak hygiene, native-binding-load resilience (Concern #11), and a self-signed dev cert generator. No signing logic lands here; Plans 14-02..14-05 build on this base.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-30T11:41:57Z
- **Completed:** 2026-04-30T11:50:41Z
- **Tasks:** 4
- **Files created:** 5
- **Files modified:** 7
- **Commits:** 4 (one per task, atomic)

## Accomplishments

- **c2pa-node pinned at 0.5.26 EXACTLY** (no caret, no tilde). Tarball integrity sha512: `O/L2lJaojO7NjvWspBieiam7YFvWhKCYZyZUW5pmcUsBVhkrmMOYaQNdK8F3iR22bdBoW3no412DwB9RCvmemA==`. Engine compatibility: `node >=16.13.0` (project: `node >=20`). Platform tested: macOS arm64. Native binding loaded via `node -e "require('c2pa-node')"` printing `ManifestBuilder, SigningAlgorithm, createTestSigner, createC2pa` — no prebuild caveats observed.
- **Architecture-purity grep gate** asserts `src/server.ts` has ZERO static `from 'c2pa-node'` imports. Concern #11 mitigation in place: server boot does NOT eagerly load the c2pa-node native binding. Plan 14-02's signer wrapper is the sole consumer; the load is lazy on first sign attempt.
- **C2paConfig type** at `src/types/c2pa.ts` — `{ readonly certPemPath: string; readonly privateKeyPemPath: string }`. Both paths are post-realpath, post-allowlist absolute paths guaranteed by the loader. NULL means signing disabled (graceful per D-CTX-2). Engine-layer-pure (zero MCP / DB / ORM imports).
- **Engine constructor extended** with `options.c2paConfig?: C2paConfig | null` (default null). Stored on a private readonly field. All 42 existing engine pipeline tests pass byte-unchanged (additive constructor extension is non-breaking).
- **loadC2paConfigFromEnv helper** at `src/utils/c2pa-config.ts` (mirrors `validateBaseUrlFromEnv`):
  - Reads `VFX_FAMILIAR_C2PA_CERT_PEM_PATH` + `VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH` from env.
  - Both unset → returns null (signing disabled).
  - Exactly one set → throws `TypedError('C2PA_CONFIG_INVALID', 'Both ... must be set together', '...')`.
  - `realpathSync` resolves both paths (follows symlinks).
  - Allowlist root: `VFX_FAMILIAR_C2PA_CERT_ROOT ?? process.cwd()`, also `realpathSync`-resolved.
  - Asserts each resolved path equals root OR `startsWith(root + sep)`. Throws with basename in message + allowlist root in hint, never the full rejected path.
  - `accessSync(R_OK)` + `statSync.size === 0` checks for readability + non-empty.
  - T-14-04: warns via `console.error` when key file mode is more permissive than 0600 — basename only, no throw.
- **Boot path wired** in `src/server.ts`: `loadC2paConfigFromEnv()` runs BEFORE `new Engine(...)`, so any throw fires before tool registration / transport connect (parity with Phase 10's MIGRATION_PENDING typed-error pattern). On success, stderr emits `vfx-familiar: C2PA signing enabled (cert <basename>, key <basename>)` — basenames only via `path.basename`.
- **C2PA_CONFIG_INVALID** added to `ErrorCode` union at `src/engine/errors.ts`.
- **Self-signed dev cert generator** at `scripts/gen-dev-c2pa-cert.mts` — generates ES256 (P-256 ECDSA) cert + key pair to `.c2pa-dev/cert.pem` (mode 0644) + `.c2pa-dev/key.pem` (mode 0600). Uses `node:crypto.generateKeyPairSync` for the key, shells out to `openssl req` for the self-signed cert (Node has no built-in x509 generation API). `which openssl` detection + clear exit 2 if missing. End-to-end smoke verified: generated cert + key feed cleanly through `loadC2paConfigFromEnv`.
- **`.c2pa-dev/`** added to `.gitignore` so the dev key never enters git history. `git status` confirmed the generated files are correctly hidden.
- **18 new tests** added: 13 in `src/__tests__/c2pa-config.test.ts` (covers all 10 plan-mandated behaviors plus 3 supplementary), 4 in `src/engine/__tests__/pipeline-c2pa-config.test.ts` (Engine constructor wiring), 1 in `src/__tests__/architecture-purity.test.ts` (Concern #11 grep gate).
- **Test count delta:** root suite 869 → **887 passing**. Pre-existing 5 v1.1-audit failures unchanged. 3 skipped unchanged. `npx tsc --noEmit` exits 0.

## Task Commits

Each task was committed atomically (conventional-commits format):

1. **Task 1: Pin c2pa-node 0.5.26 + boot-resilience grep guard** — `7f34cbb` (feat) — TDD-RED: arch-purity grep test added before install. GREEN via `npm install --save-exact c2pa-node@0.5.26`. Native binding loaded successfully on macOS arm64.
2. **Task 2: C2paConfig type + Engine constructor wiring** — `9f29a47` (feat) — Created `src/types/c2pa.ts`. Extended Engine constructor's options bag with `c2paConfig?: C2paConfig | null` (default null). 4 new tests prove the wiring; 42 existing pipeline tests pass byte-unchanged.
3. **Task 3: env vars + boot-time path validation w/ realpath + allowlist** — `1f4edd5` (feat) — Created `src/utils/c2pa-config.ts` (loader). Wired into `src/server.ts` boot path BEFORE Engine construction. Added `C2PA_CONFIG_INVALID` to ErrorCode. 13 test cases at `src/__tests__/c2pa-config.test.ts` covering both/neither, exactly-one, missing-file, empty-file, allowlist-containment, symlink-follow, root-override, permissive-key-mode warning, and root-misconfig.
4. **Task 4: self-signed dev cert generator + .gitignore** — `daebadc` (feat) — `scripts/gen-dev-c2pa-cert.mts` + `.c2pa-dev/` in .gitignore. Subject is short ASCII for Plan 14-02 Task 3 compatibility.

## Files Created/Modified

**Created:**
- `src/types/c2pa.ts` (37 lines) — `C2paConfig` type. Engine-layer-pure.
- `src/utils/c2pa-config.ts` (140 lines) — `loadC2paConfigFromEnv` helper + `DEFAULT_C2PA_CERT_ROOT_HINT` + private `resolveAndValidate`. Mirrors validateBaseUrlFromEnv pattern.
- `src/__tests__/c2pa-config.test.ts` (270+ lines) — 13 test cases.
- `src/engine/__tests__/pipeline-c2pa-config.test.ts` (75+ lines) — 4 test cases for Engine wiring.
- `scripts/gen-dev-c2pa-cert.mts` (97 lines) — self-signed dev cert generator.

**Modified:**
- `package.json` — added `"c2pa-node": "0.5.26"` (exact pin).
- `package-lock.json` — c2pa-node tree pinned (integrity sha512 captured).
- `src/server.ts` — added `loadC2paConfigFromEnv` import + `basename` from node:path. Inserted the boot-time load + basename-only success log + Engine options threading.
- `src/engine/pipeline.ts` — added `import type { C2paConfig }`. Extended options bag type with `c2paConfig?`. Stored on a private readonly field.
- `src/engine/errors.ts` — added `'C2PA_CONFIG_INVALID'` to the ErrorCode union with a Phase 14 / PROV-V-01 comment.
- `src/__tests__/architecture-purity.test.ts` — added grep test asserting `src/server.ts` has ZERO static c2pa-node imports (Concern #11).
- `.gitignore` — added `.c2pa-dev/` with a Phase 14 comment.

## Decisions Made

- **Default allowlist root = `process.cwd()`.** Most ergonomic for local dev (drop the cert anywhere under the repo and it just works) without sacrificing safety. A malicious env var pointing to `/etc/shadow` gets rejected because `/etc/shadow` does not start with `<cwd>/`. Operators with non-cwd cert layouts override via `VFX_FAMILIAR_C2PA_CERT_ROOT`.
- **Path-leak hygiene applied to error messages AND boot success log.** Error messages include the BASENAME of the rejected file (debugging signal) but NEVER the directory portion. Boot success log uses `path.basename()` for both cert and key. Test 6 explicitly asserts `expect(message).not.toContain(outsideRoot)` to lock the contract.
- **T-14-04 surfaces as a WARNING, not a throw.** World-readable keys are a security concern, but blocking would prevent local-dev workflows where the developer hasn't yet run `chmod 600`. Warning emits basename only. Production operators are expected to set 0600 manually.
- **`loadC2paConfigFromEnv` accepts optional `env` param** for testability without mutating `process.env`. Default is `process.env`. Tests still mutate `process.env` because that's the simplest fixture in vitest, but the option is there for future tests that need parallelism.
- **Engine constructor extension is additive (default null).** Pre-existing 42 engine pipeline tests pass byte-unchanged because the new optional field defaults to null. Plan 14-02 will wire the signer wrapper to read the field; Plan 14-01 only stores it.
- **Dev cert script shells out to openssl** because Node has no built-in x509 generation API. `node:crypto.generateKeyPairSync` handles the private key, but the cert step needs `openssl req`. Missing-openssl detected via `which` + exit 2 with a clear message.
- **Subject `/CN=vfx-familiar dev/O=local`** chosen for Plan 14-02 Task 3 compatibility — short ASCII, no escaped commas. Plan 14-02's subject parser using Node `X509Certificate` built-ins (Concern #10) handles this cleanly.
- **Architecture-purity grep regex** uses `from\s+['"]c2pa-node['"]` (whitespace + either-quote-style tolerant) to avoid the fragility of literal-string matching on import shapes (LOW-priority review note in the plan).

## Native Binding Load Strategy (Concern #11)

**Server boot does NOT load c2pa-node.** Verified by:
- Architecture-purity grep test: `grep -E "from\\s+['\"]c2pa-node['\"]" src/server.ts` returns ZERO matches.
- The only c2pa-node consumers in this plan are: (a) the dev cert script (opt-in, not boot path), (b) the manual smoke test for Task 1 verification (`node -e "require('c2pa-node')"` — manual, not server boot).

**Plan 14-02** will introduce `src/engine/c2pa/signer.ts` with the lazy import:
```typescript
let c2paNodeAvailable = false;
let c2paNode: typeof import('c2pa-node') | null = null;
try {
  c2paNode = await import('c2pa-node');
  c2paNodeAvailable = true;
} catch (err) {
  c2paNodeAvailable = false;
  // Captured error surfaces as TypedError('C2PA_SIGNER_LOAD_FAILED', ...)
  // when loadSigner is called the first time.
}
```

**Plan 14-03** will catch `C2PA_SIGNER_LOAD_FAILED` as a graceful-fail per D-CTX-9 — download path returns original bytes + `X-C2PA-Signing-Status: failed:signer-load` response header. Server boot succeeds even on platforms where c2pa-node prebuilds are unavailable (Linux x64 CI without prebuilds, platform-mismatched binary, missing libstdc++).

## Path Validation Approach (Concern #4)

The loader applies a 5-step validation pipeline:

1. **Both-or-neither:** `VFX_FAMILIAR_C2PA_CERT_PEM_PATH` and `VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH` must be both set or both unset. Mismatch throws `'Both ... must be set together'`.
2. **Allowlist root realpath:** `VFX_FAMILIAR_C2PA_CERT_ROOT ?? process.cwd()` is realpath-resolved. Missing root throws `'allowlist root does not exist'`.
3. **Per-path realpath:** each cert/key path is realpath-resolved (follows symlinks). Missing file or broken symlink throws `'<label> PEM not readable'`.
4. **Allowlist containment:** resolved path must equal root OR start with `root + sep`. Mismatch throws `'<label> path is outside the allowed cert root (<basename>)'` — basename in message, full path NEVER.
5. **R_OK + non-empty:** `accessSync(R_OK)` and `statSync.size > 0`. Failures throw `'<label> PEM not readable'` or `'<label> PEM is empty'`.

**The loader NEVER reads cert or key bytes.** Only `realpathSync`, `accessSync`, `statSync`. Plan 14-02's signer wrapper is the sole consumer of the file bytes, and it reads them lazily on first sign attempt.

## Boot Log Basename-Only Redaction (Concern #4)

Sample success log line (when both env vars are set + valid):

```
vfx-familiar: C2PA signing enabled (cert cert.pem, key key.pem)
```

Implementation in `src/server.ts`:
```typescript
const c2paConfig = loadC2paConfigFromEnv();
if (c2paConfig) {
  console.error(
    `vfx-familiar: C2PA signing enabled (cert ${basename(c2paConfig.certPemPath)}, key ${basename(c2paConfig.privateKeyPemPath)})`,
  );
}
```

Both basenames are derived via `path.basename`. The full resolved paths flow into Engine.options.c2paConfig (private, never logged). Plan 14-02's signer wrapper reads them, reads file bytes, signs — but also never logs the paths. T-14-12 mitigation enforced by code structure.

## File-Mode Warning Behavior (T-14-04)

- **Threshold:** `mode & 0o077 !== 0` — i.e., any group or world bits set.
- **Behavior:** stderr warning, NOT a throw.
- **Format:** `vfx-familiar: WARNING — C2PA private key file <basename> has permissive mode 0XXX; tighten to 0600 for production.`
- **Basename only.** Full path never appears.
- **Tested in Test 9:** `expect(stderrCalls).toMatch(/WARNING.*key\.pem/)` + `expect(stderrCalls).not.toContain(tempRoot)`.

## Dev Cert Script Approach

- **Key generation:** `node:crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })` → ES256 (P-256 ECDSA), c2pa-node default per Context7 docs.
- **Cert generation:** `openssl req -x509 -key <key.pem> -out <cert.pem> -days 365 -subj '/CN=vfx-familiar dev/O=local' -sha256`. Node has no built-in x509 generation; openssl is the simplest portable path.
- **Missing-openssl behavior:** `which openssl` runs first; on exit code != 0, the script prints a clear error and exits 2 (distinct from the usual 1 to make CI scripting easier).
- **Output modes:** `cert.pem` mode 0644 (public), `key.pem` mode 0600 (writeFileSync mode + chmodSync redundancy because writeFileSync respects umask).
- **Re-run safety:** `mkdirSync(OUT_DIR, { recursive: true })` is idempotent. The cert + key files are overwritten cleanly on re-run.

## Deviations from Plan

None — plan executed exactly as written.

The plan's `<action>` blocks for all 4 tasks were precise and required no deviations. One micro-adjustment to a TypedError message format during Test 6 GREEN flow:

- Plan's reference implementation put the basename in the `hint` field (`{label} file ${basename(resolved)} resolves outside the allowlist root...`). Test 6 expected the basename in the `message` field for debugging-signal value. I moved the basename to the message: `C2PA ${label} path is outside the allowed cert root (${basename(resolved)})` while keeping the directory information ONLY in the hint reference. Same intent (basename surfaces, full path doesn't), tighter error-message ergonomics. Documented in Decisions Made.

## Issues Encountered

- **Test 6 initial RED → GREEN:** my first implementation put the basename in `hint`, but the test asserted `expect(message).toContain('evil.pem')`. Moved the basename to the `message` field. Single-line fix; no other tests affected.
- **macOS realpath vs mkdtemp:** `mkdtempSync(join(tmpdir(), '...'))` returns a path under `/var/folders/...` which `realpathSync` resolves to `/private/var/folders/...`. The loader realpath-resolves both the root and each path, so the comparison succeeds only when the test fixture root is also realpath-resolved. Resolved by wrapping `mkdtempSync(...)` calls in `realpathSync(...)` in the test setup. Documented inline in the test header.
- **No other surprises.** All 12 plan-level grep gates passed on first verify run. tsc --noEmit clean throughout.

## Verification

**Plan-level grep gates (12/12 pass):**
- `grep -E "\"c2pa-node\":\s*\"0\.5\.26\"" package.json` → 1 match (exact pin, no semver range)
- `node -e "require('c2pa-node')"` → exits 0 (binding loads on macOS arm64)
- `! grep -E "from[[:space:]]+['\"]c2pa-node['\"]" src/server.ts` → 0 matches (Concern #11)
- `grep -E "VFX_FAMILIAR_C2PA_CERT_PEM_PATH|VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH" src/utils/c2pa-config.ts` → 5 matches
- `grep "loadC2paConfigFromEnv" src/server.ts` → 2 matches (import + invocation)
- `grep "realpathSync" src/utils/c2pa-config.ts` → 7 matches (including imports + 2 callsites + docstrings)
- `grep "VFX_FAMILIAR_C2PA_CERT_ROOT" src/utils/c2pa-config.ts` → 3 matches
- `grep "C2PA_CONFIG_INVALID" src/engine/errors.ts` → 1 match (union arm)
- `grep "C2paConfig" src/types/c2pa.ts` → 2 matches (interface + jsdoc)
- `grep "c2paConfig" src/engine/pipeline.ts` → 3 matches (field decl + options type + assignment)
- `grep "^\\.c2pa-dev" .gitignore` → 1 match
- Dev cert files exist: `.c2pa-dev/cert.pem` + `.c2pa-dev/key.pem` confirmed via `ls`.

**Test count:**
- Baseline (after Phase 13 + audit commits): 869 passing / 5 failing / 3 skipped
- After Plan 14-01: **887 passing / 5 failing / 3 skipped** — +18 new tests, 0 regressions, pre-existing failures unchanged
- New tests:
  - 13 in `src/__tests__/c2pa-config.test.ts` (loader behaviors + Concern #4 path-leak hygiene)
  - 4 in `src/engine/__tests__/pipeline-c2pa-config.test.ts` (Engine constructor wiring)
  - 1 in `src/__tests__/architecture-purity.test.ts` (Concern #11 grep gate)

**Architecture purity:** 22/22 pass (was 21; +1 for the new c2pa-node grep gate).
**TypeScript:** `npx tsc --noEmit` exits 0.

## Threat Flags

No new threat flags. The plan's `<threat_model>` covered the introduced surface:

- **T-14-01** (boot path info disclosure): mitigated. Loader uses `accessSync` + `statSync` + `realpathSync` only — never reads key bytes. Boot log emits basenames only (Test 10).
- **T-14-02** (C2paConfig type shape): mitigated. Type carries paths only, never bytes. Engine field is `private readonly`. No public getter added in this plan.
- **T-14-03** (dev cert tampering): accepted per the plan. Dev-only script; self-signed cert is intentionally untrusted by C2PA verifiers.
- **T-14-04** (private key file mode): mitigated. stderr warning when key mode is more permissive than 0600 (basename only). Dev cert script writes key with mode 0600 + chmodSync redundancy. (Test 9.)
- **T-14-05** (manifest content): N/A to this plan; lands in Plan 14-02.
- **T-14-06** (c2pa-node native module load): mitigated. Server boot does NOT load c2pa-node. Architecture-purity grep gate enforces this. (Concern #11 + grep test.)
- **T-14-07** (path validation DoS): accepted per the plan. accessSync + statSync + realpathSync are bounded-time.
- **T-14-12** (cert/key full path disclosure via boot log): mitigated. Boot success log emits basenames only via `path.basename`. Error messages on misconfig emit basenames only + allowlist root (via DEFAULT_C2PA_CERT_ROOT_HINT). Realpath + allowlist containment ensures a misconfigured env var pointing at /etc/shadow throws before any disclosure. (Test 6 + Test 7 explicitly assert no full-path leak.)

## Anchor IDs for 14-02..14-05

The following symbols / methods are now stable and referenced by downstream plans:

- **`C2paConfig`** (src/types/c2pa.ts) — type carrying `certPemPath` + `privateKeyPemPath` (post-realpath, post-allowlist absolute paths).
- **`loadC2paConfigFromEnv`** (src/utils/c2pa-config.ts) — boot helper; throws `TypedError('C2PA_CONFIG_INVALID', ...)` on misconfig, returns `C2paConfig | null`.
- **`DEFAULT_C2PA_CERT_ROOT_HINT`** (src/utils/c2pa-config.ts) — public string constant for shared hint text.
- **`Engine.c2paConfig`** (src/engine/pipeline.ts) — private readonly field of type `C2paConfig | null`. Plans 14-02 / 14-03 will add a public accessor.
- **`Engine.options.c2paConfig`** — constructor option, default null.
- **`'C2PA_CONFIG_INVALID'`** (src/engine/errors.ts) — TypedError code arm.
- **`scripts/gen-dev-c2pa-cert.mts`** — dev cert generator. Plans 14-02 / 14-05 use the generated `.c2pa-dev/cert.pem` + `.c2pa-dev/key.pem` for tests.

## Next Plan Readiness

**14-02 ready to start.** Plan 14-02's `signer.ts` module will:
1. Lazy-import c2pa-node inside a try/catch (Concern #11 — never crash boot).
2. Construct a `LocalSigner` from the cert + key bytes (re-read from `c2paConfig.certPemPath` + `c2paConfig.privateKeyPemPath` via `readFileSync`).
3. Pin `algorithm: SigningAlgorithm.Es256` explicitly (Concern #1 — never rely on c2pa-node's algorithm-from-cert inference).
4. Surface load failures as `TypedError('C2PA_SIGNER_LOAD_FAILED', ...)`.

The configuration foundation for Phase 14 is locked. Plans 14-02 / 14-03 / 14-04 / 14-05 build on:
- C2paConfig threading (✓ done in 14-01)
- Boot validation + path-leak hygiene (✓ done in 14-01)
- Native-binding load resilience (✓ enforced in 14-01)
- Dev cert artifact for tests (✓ done in 14-01)

## Self-Check: PASSED

All claimed files and commits verified on disk and in git history (see explicit checks below).

---
*Phase: 14-c2pa-signed-manifest-emission*
*Plan: 01*
*Completed: 2026-04-30*
