#!/usr/bin/env tsx
/**
 * Phase 14 — PROV-V-01. Local dev C2PA cert generator.
 *
 * DEV-ONLY. Generates a self-signed ES256 (P-256 ECDSA) cert + private key
 * pair to .c2pa-dev/cert.pem + .c2pa-dev/key.pem for testing the C2PA
 * signing path end-to-end without requiring a CA-issued cert. The
 * .c2pa-dev/ directory is gitignored so the key never enters git history.
 *
 * Production deployments must use a CA-issued cert (or at minimum a cert
 * whose subject the user trusts). C2PA verifiers will flag this dev cert
 * as untrusted — that is correct: it is a dev-only fixture for testing
 * the signing pipeline, not for distributing trusted manifests.
 *
 * Usage:
 *   npx tsx scripts/gen-dev-c2pa-cert.mts
 *   export VFX_FAMILIAR_C2PA_CERT_PEM_PATH=$(pwd)/.c2pa-dev/cert.pem
 *   export VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH=$(pwd)/.c2pa-dev/key.pem
 *   npx tsx src/server.ts
 *
 * Requires: openssl in PATH (macOS ships with it; Linux/CI typically have
 * it via apt/brew). On hosts without openssl, the script exits 2 with a
 * clear error message and a suggestion to either install openssl or
 * place a manually-generated cert at .c2pa-dev/cert.pem.
 *
 * The cert subject is short and ASCII-only ("/CN=vfx-familiar dev/O=local")
 * so Plan 14-02 Task 3's subject parser (using Node X509Certificate
 * built-ins per Concern #10) handles it cleanly without escape-char
 * surprises.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const OUT_DIR = '.c2pa-dev';
mkdirSync(OUT_DIR, { recursive: true });

// ES256 (P-256 ECDSA) — c2pa-node default per Context7 docs. Plan 14-02's
// signer wrapper will explicitly pass `algorithm: SigningAlgorithm.Es256`
// (Concern #1 mitigation — never rely on c2pa-node's algorithm-from-cert
// inference, which can silently mismatch).
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const keyPath = resolve(OUT_DIR, 'key.pem');
writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
  mode: 0o600,
});
// Belt-and-braces: writeFileSync mode is subject to umask, so chmod
// explicitly to 0600 in case the umask widened it.
chmodSync(keyPath, 0o600);

// Self-signed cert via openssl shell-out. Node's built-in X509Certificate
// can verify but cannot generate self-signed certs without a userland
// crypto library. openssl is the simplest portable path.
const certPath = resolve(OUT_DIR, 'cert.pem');
const opensslAvail = spawnSync('which', ['openssl'], { stdio: 'ignore' }).status === 0;
if (!opensslAvail) {
  console.error(
    'vfx-familiar: openssl not found in PATH. Install openssl (e.g., `brew install openssl` or `apt install openssl`) OR generate a cert manually and place at .c2pa-dev/cert.pem.',
  );
  process.exit(2);
}

const result = spawnSync(
  'openssl',
  [
    'req',
    '-x509',
    '-key',
    keyPath,
    '-out',
    certPath,
    '-days',
    '365',
    '-subj',
    '/CN=vfx-familiar dev/O=local',
    '-sha256',
  ],
  { stdio: 'inherit' },
);
if (result.status !== 0) {
  console.error('vfx-familiar: openssl req failed; see output above.');
  process.exit(result.status ?? 1);
}

console.log(`Generated ${certPath} (mode 0644) and ${keyPath} (mode 0600)`);
console.log('');
console.log('To enable C2PA signing, export these env vars before starting the server:');
console.log(`  export VFX_FAMILIAR_C2PA_CERT_PEM_PATH=${certPath}`);
console.log(`  export VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH=${keyPath}`);
console.log('');
console.log('NOTE: This is a SELF-SIGNED cert for local development only. C2PA verifiers');
console.log('will correctly flag it as untrusted. Use a CA-issued cert in production.');
