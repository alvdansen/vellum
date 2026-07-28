#!/usr/bin/env tsx
/**
 * Local dev C2PA cert generator.
 *
 * DEV-ONLY. Generates a tiny two-cert chain into .c2pa-dev/:
 *
 *   ca.key   — throwaway local CA private key           (mode 0600)
 *   ca.pem   — self-signed local CA certificate
 *   key.pem  — the SIGNING private key                  (mode 0600)
 *   cert.pem — leaf + CA chain (what the server loads)
 *
 * Why a chain and not a single self-signed cert: c2pa-rs REFUSES to sign
 * with a self-signed leaf — `CertificateProfileError(SelfSignedCertificate)`
 * — so the single-cert version of this script produced a key pair that
 * could never sign anything. The leaf's profile (critical BasicConstraints
 * CA:FALSE, critical EKU emailProtection, critical KeyUsage
 * digitalSignature+nonRepudiation, ES256/P-256) is copied from c2pa-node's
 * own bundled test certs, which are the known-working reference.
 *
 * A TSA is also mandatory on c2pa-node 0.5.26 — the server defaults
 * VELLUM_C2PA_TSA_URL to a public endpoint, so signing works with just the
 * two exports printed below.
 *
 * Production deployments must use a CA-issued cert. Verifiers that evaluate
 * trust will not accept this chain — it proves the signing PIPELINE works,
 * not that anyone should trust the signature.
 *
 * Usage:
 *   npx tsx scripts/gen-dev-c2pa-cert.mts
 *   export VELLUM_C2PA_CERT_PEM_PATH=$(pwd)/.c2pa-dev/cert.pem
 *   export VELLUM_C2PA_PRIVATE_KEY_PEM_PATH=$(pwd)/.c2pa-dev/key.pem
 *   npx tsx src/server.ts
 *
 * Requires: openssl in PATH (macOS ships with it; Linux/CI via apt/brew).
 * Exits 2 with a clear message when absent.
 *
 * The .c2pa-dev/ directory is gitignored so the keys never enter history.
 */
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const OUT_DIR = '.c2pa-dev';
mkdirSync(OUT_DIR, { recursive: true });

const opensslAvail = spawnSync('which', ['openssl'], { stdio: 'ignore' }).status === 0;
if (!opensslAvail) {
  console.error(
    'vellum: openssl not found in PATH. Install openssl (e.g., `brew install openssl` or `apt install openssl`).',
  );
  process.exit(2);
}

const caKey = resolve(OUT_DIR, 'ca.key');
const caPem = resolve(OUT_DIR, 'ca.pem');
const keyPath = resolve(OUT_DIR, 'key.pem');
const leafCsr = resolve(OUT_DIR, 'leaf.csr');
const leafPem = resolve(OUT_DIR, 'leaf.pem');
const certPath = resolve(OUT_DIR, 'cert.pem');
const extCnf = resolve(OUT_DIR, 'leaf-ext.cnf');

// Leaf extension profile — mirrored from c2pa-node's bundled es256 test cert,
// the known-working reference for what c2pa-rs's cert-profile check accepts.
writeFileSync(
  extCnf,
  [
    '[ext]',
    'basicConstraints = critical, CA:FALSE',
    'extendedKeyUsage = critical, emailProtection',
    'keyUsage = critical, digitalSignature, nonRepudiation',
    'subjectKeyIdentifier = hash',
    'authorityKeyIdentifier = keyid',
    '',
  ].join('\n'),
);

function openssl(args: string[], step: string): void {
  const result = spawnSync('openssl', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (result.status !== 0) {
    console.error(`vellum: openssl ${step} failed; see output above.`);
    process.exit(result.status ?? 1);
  }
}

// 1. Throwaway local CA (ES256 / P-256, same curve as the leaf).
openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', caKey], 'CA keygen');
chmodSync(caKey, 0o600);
openssl(
  ['req', '-x509', '-new', '-key', caKey, '-out', caPem, '-days', '730', '-sha256',
   '-subj', '/O=vellum dev CA/CN=vellum dev root (FOR LOCAL TESTING ONLY)'],
  'CA self-sign',
);

// 2. Signing leaf issued by the CA.
openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', keyPath], 'leaf keygen');
chmodSync(keyPath, 0o600);
openssl(
  ['req', '-new', '-key', keyPath, '-out', leafCsr,
   '-subj', '/O=vellum dev/CN=vellum dev signer (FOR LOCAL TESTING ONLY)'],
  'leaf CSR',
);
openssl(
  ['x509', '-req', '-in', leafCsr, '-CA', caPem, '-CAkey', caKey, '-CAcreateserial',
   '-out', leafPem, '-days', '365', '-sha256', '-extfile', extCnf, '-extensions', 'ext'],
  'leaf issue',
);

// 3. cert.pem = leaf + CA (the chain the server loads). Clean up intermediates
//    the server never reads; keep ca.key/ca.pem so re-runs could reuse them if
//    this script ever grows that option — for now each run mints a fresh CA.
const leafText = spawnSync('cat', [leafPem]).stdout.toString();
const caText = spawnSync('cat', [caPem]).stdout.toString();
writeFileSync(certPath, leafText + caText);
for (const f of [leafCsr, leafPem, extCnf, resolve(OUT_DIR, 'ca.srl')]) {
  rmSync(f, { force: true });
}

console.log(`Generated ${certPath} (leaf + local CA chain) and ${keyPath} (mode 0600)`);
console.log('');
console.log('To enable C2PA signing, export these env vars before starting the server:');
console.log(`  export VELLUM_C2PA_CERT_PEM_PATH=${certPath}`);
console.log(`  export VELLUM_C2PA_PRIVATE_KEY_PEM_PATH=${keyPath}`);
console.log('');
console.log('NOTE: This chain is for local development only. It proves the signing');
console.log('pipeline works end-to-end; a manifest signed with it means nothing to');
console.log('anyone else. Use a CA-issued cert in production.');
