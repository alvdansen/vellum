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
 * Expand an IPv6 address into its eight 16-bit groups.
 *
 * Needed because the interesting cases are all about EMBEDDED IPv4, and a
 * resolver hands back whichever spelling it likes. `::ffff:127.0.0.1` and
 * `::ffff:7f00:1` are the same address; only the second is what a lookup
 * actually returns, and a string match on the first form sees straight past it.
 *
 * Handles `::` compression, a trailing dotted quad, brackets, and a zone id.
 */
function ipv6Groups(address: string): number[] | null {
  let ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone); // fe80::1%eth0
  if (isIP(ip) !== 6) return null;

  // A trailing dotted quad occupies the last two groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (dotted) {
    const o = ipv4Octets(dotted[1]!);
    if (!o) return null;
    const hi = ((o[0] << 8) | o[1]).toString(16);
    const lo = ((o[2] << 8) | o[3]).toString(16);
    ip = `${ip.slice(0, dotted.index)}${hi}:${lo}`;
  }

  const [head, tail] = ip.split('::');
  const h = head ? head.split(':').filter(Boolean) : [];
  const t = tail === undefined ? null : tail ? tail.split(':').filter(Boolean) : [];
  const groups =
    t === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  if (groups.length !== 8) return null;

  const out = groups.map((g) => Number.parseInt(g, 16));
  return out.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff) ? null : out;
}

/** Render two 16-bit groups as the dotted IPv4 they encode. */
function embeddedIPv4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
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
    // 192.0.0.0/24 IETF protocol assignments. Deliberately NOT the whole /16 —
    // 192.0.1.0/24 upward is ordinary allocated space, and over-blocking a
    // routable range is its own bug.
    if (a === 192 && b === 0 && v4[2] === 0) return true;
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  const g = ipv6Groups(address);
  if (!g) return false;

  // Every IPv6 form that carries an IPv4 target is only as safe as that target.
  // Judging the wrapper instead of the payload is how a "public" address
  // reaches 169.254.169.254.
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return isPrivateAddress(embeddedIPv4(g[6]!, g[7]!)); // ::ffff:0:0/96 IPv4-mapped
  }
  if (g.slice(0, 6).every((n) => n === 0)) {
    // ::/96 — the unspecified address, loopback, and the deprecated
    // IPv4-compatible range. None of it is somewhere a delivery host lives.
    return true;
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return isPrivateAddress(embeddedIPv4(g[6]!, g[7]!)); // 64:ff9b::/96 NAT64
  }
  if (g[0] === 0x2002) {
    return isPrivateAddress(embeddedIPv4(g[1]!, g[2]!)); // 2002::/16 6to4
  }

  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0]! & 0xff00) === 0xff00) return true; // ff00::/8 multicast
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
