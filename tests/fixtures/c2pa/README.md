# C2PA test fixtures

Phase 14 / Plan 14-02 — engine-layer signer wrapper tests.

## What lives here

This directory holds **per-test** cert fixtures generated on demand by the
test setup helper. NO committed PEM files live here (security — even a
self-signed expired test cert can be embarrassing if leaked into a public
search engine).

Subdirectories:

- `algorithms/` — per-algorithm cert fixtures (P-256, P-384, RSA-PSS-SHA256,
  Ed25519, plus a deliberately-unsupported one) — generated lazily by the
  signer test setup using `openssl` shell-out.
- `c2pa-node-bundled/` — *not actually present*; tests that need an
  end-to-end signing round-trip use `node_modules/c2pa-node/tests/fixtures/
  certs/es256.{pub,pem}` directly. These are c2pa-node's own test certs
  with a proper trust chain, accepted by c2pa-rs's `CertificateProfileError`
  validator.

## Why no `.c2pa-dev/` here

`scripts/gen-dev-c2pa-cert.mts` generates a **self-signed** ES256 cert at
the repo root in `.c2pa-dev/cert.pem` + `.c2pa-dev/key.pem`. That cert is:

- Used for **boot-path tests** (load + validation) — Plan 14-01.
- **NOT usable for end-to-end signing tests** — c2pa-rs rejects self-signed
  certs with `CertificateProfileError(SelfSignedCertificate)` profile error.
  See Plan 14-02 deviations for full context.

So Plan 14-02 signer.test.ts uses **c2pa-node's bundled test certs** for
the round-trip sign + read flow.

## Generation flow

The signer test setup helper (`tests/fixtures/c2pa/algorithms.ts`) lazily
generates per-algorithm fixtures via `openssl req -x509 ...` if they don't
already exist. Files are written under `algorithms/` and excluded from git
via the directory-level entry in `.gitignore`.

Each fixture is a one-shot disposable cert + key — never reused across test
runs in a way that would survive `git clean`.

## Algorithm map

| Fixture file       | KeyType    | Signature algorithm    | C2PA enum value |
| ------------------ | ---------- | ---------------------- | --------------- |
| `es256-cert.pem`   | ec p256    | ecdsa-with-SHA256      | ES256           |
| `es384-cert.pem`   | ec p384    | ecdsa-with-SHA384      | ES384           |
| `ed25519-cert.pem` | ed25519    | ED25519                | Ed25519         |
| `pss256-cert.pem`  | rsa-pss    | rsassaPss + sha256     | PS256           |
| `rsa-sha1.crt`     | rsa pkcs1  | sha1WithRSAEncryption  | UNSUPPORTED     |

The `UNSUPPORTED` row is the negative-path test — Plan 14-02 mandates that
unsupported algorithms throw `C2PA_SIGNER_LOAD_FAILED` with a clear message
rather than silently producing invalid signatures (Concern #1).
