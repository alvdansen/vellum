// src/utils/private-address.ts — refuse outbound fetches that resolve inward.
//
// The host allowlists answer "is this a delivery host we trust?" by NAME. They
// say nothing about where that name points. DNS rebinding closes the gap from
// the other side: an allowlisted hostname (or one an operator was talked into
// adding) can resolve to 169.254.169.254, 127.0.0.1, or an RFC1918 address, and
// the server will dutifully fetch it and persist the response as an asset —
// cloud instance credentials, an internal admin page, a metadata endpoint.
//
// So the name check is necessary but not sufficient: resolve first, and refuse
// if the answer points at this machine or the private network.
//
// HONEST LIMIT: this is check-then-connect, not true pinning. A record whose TTL
// expires between the check and the fetch could resolve differently the second
// time. Closing that fully means dialling the checked IP directly and carrying
// the hostname for TLS SNI + certificate validation, which needs a custom
// dispatcher. What is here defeats the realistic attack (a hostile or
// compromised delivery host pointing inward) and composes with the existing
// `redirect: 'manual'` so a 3xx cannot walk somewhere else afterwards.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { TypedError, type ErrorCode } from '../engine/errors.js';

/** Signature of the resolver, so tests can drive one without touching DNS. */
export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (hostname) => lookup(hostname, { all: true, verbatim: true });

/** Parse a dotted-quad into its four octets, or null if it is not IPv4. */
function ipv4Octets(address: string): [number, number, number, number] | null {
  if (isIP(address) !== 4) return null;
  const parts = address.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts as [number, number, number, number];
}

/**
 * True when an address belongs to this machine or a private/reserved range —
 * i.e. somewhere a public delivery host has no business pointing.
 */
export function isPrivateAddress(address: string): boolean {
  const v4 = ipv4Octets(address);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return true; // 0.0.0.0/8 "this host"
    if (a === 10) return true; // RFC1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC6598)
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 protocol assignments
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  if (isIP(address) !== 6) return false;
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  // An IPv4-mapped/compatible address is only as safe as the IPv4 inside it.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]!);
  if (ip === '::1' || ip === '::') return true; // loopback / unspecified
  const head = ip.split(':')[0] ?? '';
  if (/^f[cd]/.test(head)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(head)) return true; // fe80::/10 link-local
  if (head === 'ff00' || /^ff/.test(head)) return true; // multicast
  return false;
}

/**
 * Resolve `hostname` and throw unless every answer is a public address.
 *
 * Refuses on ALL resolved addresses rather than the first: a hostname that
 * returns one public and one private answer is exactly the shape of an attack,
 * and which one the connection picks is not ours to choose.
 *
 * A literal IP in the URL is checked directly without a lookup.
 *
 * `code` lets the caller keep its own error taxonomy — the ComfyUI client raises
 * COMFYUI_API_ERROR for everything inside `download()`, including the sibling
 * redirect-host check, so this guard must not be the one line that reports a
 * different code from the same method.
 *
 * `lookupImpl` is a seam, not an escape hatch: it substitutes the DNS *answer*,
 * never the decision. There is deliberately no way to turn this check off.
 */
export async function assertPublicHostname(
  hostname: string,
  label: string,
  lookupImpl: LookupFn = defaultLookup,
  code: ErrorCode = 'DOWNLOAD_FAILED',
): Promise<void> {
  const bare = hostname.replace(/^\[|\]$/g, '');

  if (isIP(bare) !== 0) {
    if (isPrivateAddress(bare)) {
      throw new TypedError(
        code,
        `${label} points at a private address (${bare})`,
        'Outputs must be fetched from public hosts. A private or loopback address here means the URL is pointing back into your own network.',
      );
    }
    return;
  }

  let answers: Array<{ address: string }>;
  try {
    answers = await lookupImpl(bare);
  } catch (err) {
    throw new TypedError(
      code,
      `${label} could not be resolved: ${(err as Error)?.message ?? String(err)}`,
    );
  }
  if (answers.length === 0) {
    throw new TypedError(code, `${label} resolved to no addresses`);
  }
  const offending = answers.find((a) => isPrivateAddress(a.address));
  if (offending) {
    throw new TypedError(
      code,
      `${label} resolves to a private address (${offending.address})`,
      'An allowlisted host resolving into private space is how a metadata endpoint or internal service gets fetched and stored as an asset. Check the DNS for that host.',
    );
  }
}
