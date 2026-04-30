import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { TypedError } from '../engine/errors.js';
import { loadC2paConfigFromEnv } from '../utils/c2pa-config.js';

/**
 * Phase 14 — PROV-V-01 / PROV-V-02 / PROV-V-05 (D-CTX-2). Plan 14-01 Task 3.
 *
 * Boot-time path validation tests for the C2PA cert + key env vars. Covers
 * 10 behaviors from the plan:
 *  1. Both unset → null (signing disabled, graceful per D-CTX-2).
 *  2. Only one set → throw C2PA_CONFIG_INVALID.
 *  3. Both set, one path missing → throw with basename only (Concern #4).
 *  4. Both paths exist but one is empty → throw.
 *  5. Both paths valid + INSIDE allowlist → return resolved C2paConfig.
 *  6. Path OUTSIDE allowlist root → throw, no full-path leak.
 *  7. Symlink-out-of-allowlist → realpath resolves, throw fires.
 *  8. VFX_FAMILIAR_C2PA_CERT_ROOT override → custom root accepted, outside-root rejected.
 *  9. Permissive key mode (e.g., 0644) → stderr warning (basename only), no throw.
 * 10. Boot success log → basenames only (asserted via the helper success path).
 */

const VALID_PEM_BYTES = '-----BEGIN PEM-----\nMIIBfake==\n-----END PEM-----\n';

let tempRoot: string;
let originalEnv: NodeJS.ProcessEnv;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Each test gets its own mkdtemp dir as the allowlist root, so cwd-default
  // tests can use process.chdir(tempRoot) safely. Use realpathSync because
  // mkdtempSync returns a path inside /var/folders/... which on macOS
  // resolves to /private/var/folders/... — the helper realpath-resolves
  // BOTH the root and each path, so the comparison only works if our
  // fixture root is also realpath-resolved.
  tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'vfx-c2pa-')));
  originalEnv = { ...process.env };
  delete process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH;
  delete process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH;
  delete process.env.VFX_FAMILIAR_C2PA_CERT_ROOT;
  // MR-01 fix: ensure no stale TSA URL leaks from the host shell or earlier tests.
  delete process.env.VFX_FAMILIAR_C2PA_TSA_URL;
  // Default the allowlist to our temp root for the tests that don't override.
  process.env.VFX_FAMILIAR_C2PA_CERT_ROOT = tempRoot;
  stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  stderrSpy.mockRestore();
  process.env = originalEnv;
  rmSync(tempRoot, { recursive: true, force: true });
});

function writePem(name: string, bytes: string = VALID_PEM_BYTES, mode: number = 0o600): string {
  const p = join(tempRoot, name);
  writeFileSync(p, bytes, { mode });
  // writeFileSync respects umask and may apply a more permissive mode than
  // requested. Force the exact mode with chmodSync to make permission tests
  // deterministic.
  chmodSync(p, mode);
  return p;
}

describe('loadC2paConfigFromEnv — Phase 14 Plan 14-01 Task 3', () => {
  test('Test 1: both env vars unset → returns null (signing disabled, D-CTX-2 graceful)', () => {
    delete process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH;
    delete process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH;
    expect(loadC2paConfigFromEnv()).toBeNull();
  });

  test('Test 2: only cert env var set (key missing) → throws C2PA_CONFIG_INVALID', () => {
    const certPath = writePem('cert.pem');
    process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = certPath;
    delete process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH;

    let thrown: unknown;
    try {
      loadC2paConfigFromEnv();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TypedError);
    expect((thrown as TypedError).code).toBe('C2PA_CONFIG_INVALID');
    expect((thrown as TypedError).message).toMatch(/Both .* must be set together/);
  });

  test('Test 2b: only key env var set (cert missing) → throws C2PA_CONFIG_INVALID', () => {
    const keyPath = writePem('key.pem');
    delete process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH;
    process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = keyPath;

    expect(() => loadC2paConfigFromEnv()).toThrow(TypedError);
    try {
      loadC2paConfigFromEnv();
    } catch (e) {
      expect((e as TypedError).code).toBe('C2PA_CONFIG_INVALID');
    }
  });

  test('Test 3: cert env var points to non-existent file → throws with basename only (Concern #4)', () => {
    const missingPath = join(tempRoot, 'does-not-exist.pem');
    const keyPath = writePem('key.pem');
    process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = missingPath;
    process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = keyPath;

    let thrown: TypedError | undefined;
    try {
      loadC2paConfigFromEnv();
    } catch (e) {
      thrown = e as TypedError;
    }
    expect(thrown).toBeInstanceOf(TypedError);
    expect(thrown!.code).toBe('C2PA_CONFIG_INVALID');
    expect(thrown!.message).toContain('does-not-exist.pem'); // basename
    // Concern #4: must NOT leak full path. The basename appears, but the
    // directory portion ($tempRoot) must not.
    expect(thrown!.message).not.toContain(tempRoot);
  });

  test('Test 4: cert exists but is empty (zero bytes) → throws with basename', () => {
    const certPath = writePem('cert.pem', '');
    const keyPath = writePem('key.pem');
    process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = certPath;
    process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = keyPath;

    let thrown: TypedError | undefined;
    try {
      loadC2paConfigFromEnv();
    } catch (e) {
      thrown = e as TypedError;
    }
    expect(thrown).toBeInstanceOf(TypedError);
    expect(thrown!.code).toBe('C2PA_CONFIG_INVALID');
    expect(thrown!.message).toMatch(/empty/);
    expect(thrown!.message).toContain('cert.pem');
    expect(thrown!.message).not.toContain(tempRoot); // Concern #4 — no path leak
  });

  test('Test 5: both paths valid + inside allowlist → returns realpath-resolved C2paConfig', () => {
    const certPath = writePem('cert.pem');
    const keyPath = writePem('key.pem', VALID_PEM_BYTES, 0o600);
    process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = certPath;
    process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = keyPath;

    const cfg = loadC2paConfigFromEnv();
    expect(cfg).not.toBeNull();
    expect(cfg!.certPemPath).toBe(realpathSync(certPath));
    expect(cfg!.privateKeyPemPath).toBe(realpathSync(keyPath));
  });

  test('Test 6 (Concern #4 — path-traversal guard): cert path OUTSIDE allowlist root → throws without leaking the rejected path', () => {
    // Create a file in /tmp directly (outside our tempRoot).
    const outsideRoot = realpathSync(mkdtempSync(join(tmpdir(), 'vfx-c2pa-outside-')));
    const outsideCert = join(outsideRoot, 'evil.pem');
    writeFileSync(outsideCert, VALID_PEM_BYTES, { mode: 0o644 });
    const insideKey = writePem('key.pem');
    try {
      process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = outsideCert;
      process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = insideKey;
      // Allowlist is still tempRoot (from beforeEach).

      let thrown: TypedError | undefined;
      try {
        loadC2paConfigFromEnv();
      } catch (e) {
        thrown = e as TypedError;
      }
      expect(thrown).toBeInstanceOf(TypedError);
      expect(thrown!.code).toBe('C2PA_CONFIG_INVALID');
      expect(thrown!.message).toMatch(/outside the allowed cert root/);
      // basename appears (debugging signal); full directory path does NOT.
      expect(thrown!.message).toContain('evil.pem');
      expect(thrown!.message).not.toContain(outsideRoot);
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  test('Test 7 (Concern #4 — symlink follow): symlink whose target lives OUTSIDE allowlist → realpath catches + throws', () => {
    const outsideRoot = realpathSync(mkdtempSync(join(tmpdir(), 'vfx-c2pa-outside-sym-')));
    const realCertOutside = join(outsideRoot, 'real-cert.pem');
    writeFileSync(realCertOutside, VALID_PEM_BYTES, { mode: 0o644 });

    const symlinkInside = join(tempRoot, 'cert-symlink.pem');
    symlinkSync(realCertOutside, symlinkInside);

    const insideKey = writePem('key.pem');
    try {
      process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = symlinkInside;
      process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = insideKey;

      let thrown: TypedError | undefined;
      try {
        loadC2paConfigFromEnv();
      } catch (e) {
        thrown = e as TypedError;
      }
      expect(thrown).toBeInstanceOf(TypedError);
      expect(thrown!.code).toBe('C2PA_CONFIG_INVALID');
      expect(thrown!.message).toMatch(/outside the allowed cert root/);
      // The error message should reference the basename of the resolved
      // (real) target, not the symlink. Either way, no full-path leak.
      expect(thrown!.message).not.toContain(outsideRoot);
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  test('Test 8a: VFX_FAMILIAR_C2PA_CERT_ROOT override accepts a custom root', () => {
    // Use a sibling temp dir as the custom root.
    const customRoot = realpathSync(mkdtempSync(join(tmpdir(), 'vfx-c2pa-custom-')));
    try {
      const certPath = join(customRoot, 'cert.pem');
      const keyPath = join(customRoot, 'key.pem');
      writeFileSync(certPath, VALID_PEM_BYTES, { mode: 0o644 });
      writeFileSync(keyPath, VALID_PEM_BYTES, { mode: 0o600 });
      chmodSync(keyPath, 0o600);

      process.env.VFX_FAMILIAR_C2PA_CERT_ROOT = customRoot;
      process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = certPath;
      process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = keyPath;

      const cfg = loadC2paConfigFromEnv();
      expect(cfg).not.toBeNull();
      expect(cfg!.certPemPath).toBe(realpathSync(certPath));
      expect(cfg!.privateKeyPemPath).toBe(realpathSync(keyPath));
    } finally {
      rmSync(customRoot, { recursive: true, force: true });
    }
  });

  test('Test 8b: VFX_FAMILIAR_C2PA_CERT_ROOT override rejects a path outside the custom root', () => {
    const customRoot = realpathSync(mkdtempSync(join(tmpdir(), 'vfx-c2pa-custom-')));
    try {
      const insideKey = join(customRoot, 'key.pem');
      writeFileSync(insideKey, VALID_PEM_BYTES, { mode: 0o600 });
      chmodSync(insideKey, 0o600);

      // Cert lives in tempRoot — OUTSIDE the customRoot allowlist.
      const outsideCert = writePem('cert.pem');

      process.env.VFX_FAMILIAR_C2PA_CERT_ROOT = customRoot;
      process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = outsideCert;
      process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = insideKey;

      expect(() => loadC2paConfigFromEnv()).toThrow(TypedError);
    } finally {
      rmSync(customRoot, { recursive: true, force: true });
    }
  });

  test('Test 9 (T-14-04): permissive key mode → stderr warning (basename only), no throw', () => {
    const certPath = writePem('cert.pem');
    const keyPath = writePem('key.pem', VALID_PEM_BYTES, 0o644); // world-readable
    process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = certPath;
    process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = keyPath;

    const cfg = loadC2paConfigFromEnv();
    expect(cfg).not.toBeNull(); // does NOT throw
    // Warning fired with basename only — full path NOT in any stderr arg.
    const stderrCalls = stderrSpy.mock.calls.flat().join('\n');
    expect(stderrCalls).toMatch(/WARNING.*key\.pem/);
    expect(stderrCalls).toMatch(/permissive mode/);
    expect(stderrCalls).not.toContain(tempRoot);
  });

  test('Test 10: success path returns config; basename-only emission is the loader contract (server.ts emits the boot log)', () => {
    // The boot success log lives in src/server.ts (after loadC2paConfigFromEnv
    // returns). This test confirms the loader returns clean (post-realpath)
    // paths — server.ts then path.basename()s them for the log. The
    // basename-only redaction is therefore a property of the loader's
    // contract: it returns absolute paths so the consumer can log basenames.
    const certPath = writePem('cert.pem');
    const keyPath = writePem('key.pem', VALID_PEM_BYTES, 0o600);
    process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = certPath;
    process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = keyPath;

    const cfg = loadC2paConfigFromEnv();
    expect(cfg).not.toBeNull();
    expect(basename(cfg!.certPemPath)).toBe('cert.pem');
    expect(basename(cfg!.privateKeyPemPath)).toBe('key.pem');
    expect(cfg!.certPemPath).toBe(realpathSync(certPath));
    expect(cfg!.privateKeyPemPath).toBe(realpathSync(keyPath));
  });

  test('Test 11 (root-misconfig): VFX_FAMILIAR_C2PA_CERT_ROOT points to a non-existent dir → throw', () => {
    const certPath = writePem('cert.pem');
    const keyPath = writePem('key.pem');
    process.env.VFX_FAMILIAR_C2PA_CERT_ROOT = join(tempRoot, 'does-not-exist');
    process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = certPath;
    process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = keyPath;

    let thrown: TypedError | undefined;
    try {
      loadC2paConfigFromEnv();
    } catch (e) {
      thrown = e as TypedError;
    }
    expect(thrown).toBeInstanceOf(TypedError);
    expect(thrown!.code).toBe('C2PA_CONFIG_INVALID');
    expect(thrown!.message).toMatch(/allowlist root does not exist/);
  });

  // ============================================================
  // MR-01 fix — VFX_FAMILIAR_C2PA_TSA_URL plumbing.
  // ============================================================

  test('Test 12 (MR-01 fix): VFX_FAMILIAR_C2PA_TSA_URL unset → tsaUrl is null (offline-friendly default)', () => {
    const certPath = writePem('cert.pem');
    const keyPath = writePem('key.pem');
    process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = certPath;
    process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = keyPath;
    delete process.env.VFX_FAMILIAR_C2PA_TSA_URL;

    const cfg = loadC2paConfigFromEnv();
    expect(cfg).not.toBeNull();
    expect(cfg!.tsaUrl).toBeNull();
  });

  test('Test 13 (MR-01 fix): VFX_FAMILIAR_C2PA_TSA_URL set → tsaUrl flows through verbatim', () => {
    const certPath = writePem('cert.pem');
    const keyPath = writePem('key.pem');
    process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = certPath;
    process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = keyPath;
    process.env.VFX_FAMILIAR_C2PA_TSA_URL = 'https://internal-tsa.example.com/tsa';

    const cfg = loadC2paConfigFromEnv();
    expect(cfg).not.toBeNull();
    expect(cfg!.tsaUrl).toBe('https://internal-tsa.example.com/tsa');
  });

  test('Test 14 (MR-01 fix): VFX_FAMILIAR_C2PA_TSA_URL = empty string → treated as unset (null)', () => {
    const certPath = writePem('cert.pem');
    const keyPath = writePem('key.pem');
    process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = certPath;
    process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = keyPath;
    process.env.VFX_FAMILIAR_C2PA_TSA_URL = '';

    const cfg = loadC2paConfigFromEnv();
    expect(cfg).not.toBeNull();
    expect(cfg!.tsaUrl).toBeNull();
  });

  test('Test 15 (MR-01 fix): VFX_FAMILIAR_C2PA_TSA_URL = whitespace-only → treated as unset (null)', () => {
    const certPath = writePem('cert.pem');
    const keyPath = writePem('key.pem');
    process.env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH = certPath;
    process.env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH = keyPath;
    process.env.VFX_FAMILIAR_C2PA_TSA_URL = '   \t  ';

    const cfg = loadC2paConfigFromEnv();
    expect(cfg).not.toBeNull();
    expect(cfg!.tsaUrl).toBeNull();
  });
});
