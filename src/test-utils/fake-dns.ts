// src/test-utils/fake-dns.ts — deterministic resolvers for the outbound
// private-address guard.
//
// WHY THIS EXISTS. `assertPublicHostname` runs on every guarded outbound fetch:
// the URL-provider download path, the ingest path, and the ComfyUI signed-URL
// second hop. It is NEVER skipped just because a test injected a fake `fetch` —
// a security control that turns itself off under test is a control that is not
// tested, and one refactor away from being off in production too.
//
// So tests inject a resolver instead. The guard executes exactly the same code
// in a test as in production; only the DNS answer is deterministic. That also
// keeps the suite hermetic — no unit test performs a real lookup, so no test
// depends on a network, a resolver, or `replicate.delivery` still existing.
//
// Addresses below come from the ranges RFC 5737 / RFC 3849 reserve for
// documentation, so they can never collide with a host anyone actually runs.

import type { LookupFn } from '../utils/private-address.js';

/** TEST-NET-3 (RFC 5737) — a public address that is guaranteed to be nobody's. */
export const PUBLIC_TEST_IPV4 = '203.0.113.10';
/** RFC 3849 documentation prefix — the IPv6 equivalent. */
export const PUBLIC_TEST_IPV6 = '2001:db8::1';

/** Every hostname resolves to a public address: the ordinary happy path. */
export const publicLookup: LookupFn = async () => [{ address: PUBLIC_TEST_IPV4, family: 4 }];

/** Every hostname resolves to a public IPv6 address. */
export const publicLookupV6: LookupFn = async () => [{ address: PUBLIC_TEST_IPV6, family: 6 }];

/**
 * Every hostname resolves to `address` — the DNS-rebinding attacker. Pass a
 * loopback, RFC1918, or link-local address (169.254.169.254 for the cloud
 * metadata endpoint) to assert the guard refuses it.
 */
export function rebindingLookup(address: string): LookupFn {
  const family = address.includes(':') ? 6 : 4;
  return async () => [{ address, family }];
}

/**
 * Resolves to a public address AND a private one. A host that answers with both
 * is the realistic shape of the attack — which address the connection picks is
 * not the caller's to choose, so the guard must refuse on ANY private answer.
 */
export function mixedLookup(privateAddress: string): LookupFn {
  return async () => [
    { address: PUBLIC_TEST_IPV4, family: 4 },
    { address: privateAddress, family: privateAddress.includes(':') ? 6 : 4 },
  ];
}

/**
 * A resolver that records whether it was called.
 *
 * Throwing from a resolver does NOT fail a test: assertPublicHostname catches a
 * lookup failure and rewrites it into the caller's own error code, so a test
 * asserting only on the code passes whether or not DNS was consulted. Count the
 * calls instead, and assert on the count.
 */
export function countingLookup(): { lookup: LookupFn; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    lookup: async (hostname) => {
      calls.push(hostname);
      return [{ address: PUBLIC_TEST_IPV4, family: 4 }];
    },
  };
}

/**
 * A resolver that must never be reached. Pair it with an assertion on the error
 * MESSAGE — a bare code assertion cannot tell "rejected by name" apart from
 * "rejected because the lookup threw", since the guard rewrites both.
 */
export const forbiddenLookup: LookupFn = async (hostname) => {
  throw new Error(`DNS lookup must not happen for '${hostname}' on this path`);
};
