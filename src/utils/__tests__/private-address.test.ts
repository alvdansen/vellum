import { describe, it, expect } from 'vitest';
import { isPrivateAddress, assertPublicHostname, type LookupFn } from '../private-address.js';
import { TypedError } from '../../engine/errors.js';

/**
 * Address classification for the outbound SSRF guard.
 *
 * The host allowlists answer "is this a delivery host we trust?" by NAME. They
 * say nothing about where that name points, so an allowlisted (or
 * operator-persuaded) hostname resolving to 169.254.169.254 or an RFC1918
 * address would be fetched and stored as an asset — cloud instance
 * credentials, an internal admin page, a metadata endpoint.
 *
 * NOTE: this module is not yet wired into the two download paths. See
 * .planning/LAUNCH_PICKUP.md — the adapters need a lookup seam threaded through
 * before the guard can run without every fake-fetch test hitting real DNS.
 */

describe('isPrivateAddress', () => {
  it.each([
    ['loopback', '127.0.0.1'],
    ['loopback range', '127.53.1.9'],
    ['cloud metadata', '169.254.169.254'],
    ['link-local', '169.254.0.1'],
    ['RFC1918 10/8', '10.0.0.5'],
    ['RFC1918 172.16/12 low', '172.16.0.1'],
    ['RFC1918 172.16/12 high', '172.31.255.254'],
    ['RFC1918 192.168/16', '192.168.1.1'],
    ['CGNAT', '100.64.0.1'],
    ['this host', '0.0.0.0'],
    ['multicast', '224.0.0.1'],
    ['broadcast', '255.255.255.255'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unspecified', '::'],
    ['IPv6 unique-local', 'fd00::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped metadata', '::ffff:169.254.169.254'],
  ])('treats %s as private', (_label, address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    ['a public v4', '93.184.216.34'],
    ['just outside RFC1918', '172.32.0.1'],
    ['just below RFC1918', '172.15.255.255'],
    ['not CGNAT', '100.128.0.1'],
    ['a public v6', '2606:2800:220:1:248:1893:25c8:1946'],
  ])('treats %s as public', (_label, address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('assertPublicHostname', () => {
  const lookupTo = (...addresses: string[]): LookupFn =>
    async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

  it('allows a hostname resolving to a public address', async () => {
    await expect(
      assertPublicHostname('cdn.example.com', 'host', lookupTo('93.184.216.34')),
    ).resolves.toBeUndefined();
  });

  it('refuses a hostname resolving into private space', async () => {
    await expect(
      assertPublicHostname('evil.example.com', 'host', lookupTo('169.254.169.254')),
    ).rejects.toBeInstanceOf(TypedError);
  });

  it('refuses when ANY answer is private, not just the first', async () => {
    // A split answer is the shape of the attack; which address the connection
    // picks is not ours to choose.
    await expect(
      assertPublicHostname('mixed.example.com', 'host', lookupTo('93.184.216.34', '10.0.0.1')),
    ).rejects.toBeInstanceOf(TypedError);
  });

  it('checks a literal IP without any lookup', async () => {
    const never: LookupFn = async () => {
      throw new Error('lookup must not run for a literal IP');
    };
    await expect(assertPublicHostname('127.0.0.1', 'host', never)).rejects.toBeInstanceOf(
      TypedError,
    );
    await expect(assertPublicHostname('93.184.216.34', 'host', never)).resolves.toBeUndefined();
  });

  it('refuses a bracketed IPv6 literal that is loopback', async () => {
    const never: LookupFn = async () => {
      throw new Error('should not be called');
    };
    await expect(assertPublicHostname('[::1]', 'host', never)).rejects.toBeInstanceOf(TypedError);
  });

  it('refuses when resolution fails rather than proceeding', async () => {
    const failing: LookupFn = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(assertPublicHostname('nope.example.com', 'host', failing)).rejects.toBeInstanceOf(
      TypedError,
    );
  });

  it('refuses an empty answer', async () => {
    await expect(assertPublicHostname('empty.example.com', 'host', lookupTo())).rejects.toBeInstanceOf(
      TypedError,
    );
  });
});

describe('IPv6 forms that embed an IPv4 target', () => {
  // REGRESSION. The classifier matched IPv4-mapped addresses with a regex
  // against the DOTTED spelling (`::ffff:127.0.0.1`) — but a resolver returns
  // the hex form (`::ffff:7f00:1`). The two are the same address, and only the
  // second one actually arrives, so the check saw straight past every real
  // IPv4-mapped answer. NAT64, 6to4 and IPv4-compatible were not handled at all.
  //
  // Every one of these is a way to write "reach 169.254.169.254" that the
  // wrapper alone makes look like ordinary global unicast.

  const EMBEDS_SOMETHING_PRIVATE = [
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback, dotted'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex — the form a lookup returns'],
    ['::ffff:a00:5', 'IPv4-mapped 10.0.0.5, hex'],
    ['::ffff:a9fe:a9fe', 'IPv4-mapped cloud metadata, hex'],
    ['::ffff:c0a8:1', 'IPv4-mapped 192.168.0.1, hex'],
    ['64:ff9b::7f00:1', 'NAT64 well-known prefix wrapping loopback'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 wrapping cloud metadata'],
    ['2002:7f00:1::', '6to4 wrapping loopback'],
    ['2002:a9fe:a9fe::', '6to4 wrapping cloud metadata'],
    ['2002:0a00:0005::', '6to4 wrapping RFC1918'],
    ['::7f00:1', 'deprecated IPv4-compatible loopback'],
  ] as const;

  for (const [addr, why] of EMBEDS_SOMETHING_PRIVATE) {
    test(`refuses ${addr} — ${why}`, () => {
      expect(isPrivateAddress(addr)).toBe(true);
    });
  }

  // The other half of the contract: wrapping a PUBLIC address must not be
  // refused, or a legitimate NAT64/6to4 deployment cannot download anything.
  const EMBEDS_SOMETHING_PUBLIC = [
    ['::ffff:8.8.8.8', 'IPv4-mapped public, dotted'],
    ['::ffff:808:808', 'IPv4-mapped public, hex'],
    ['64:ff9b::8.8.8.8', 'NAT64 wrapping a public address'],
    ['2002:0808:0808::', '6to4 wrapping a public address'],
    ['2606:4700:4700::1111', 'ordinary global unicast'],
    ['2001:4860:4860::8888', 'ordinary global unicast'],
  ] as const;

  for (const [addr, why] of EMBEDS_SOMETHING_PUBLIC) {
    test(`allows ${addr} — ${why}`, () => {
      expect(isPrivateAddress(addr)).toBe(false);
    });
  }

  test('a zone id does not defeat the link-local check', () => {
    expect(isPrivateAddress('fe80::1%eth0')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
  });

  test('brackets are tolerated', () => {
    expect(isPrivateAddress('[::1]')).toBe(true);
    expect(isPrivateAddress('[2606:4700:4700::1111]')).toBe(false);
  });

  test('the fc00::/7 and fe80::/10 boundaries are exact, not prefix-string guesses', () => {
    expect(isPrivateAddress('fbff::1')).toBe(false); // just below fc00::/7
    expect(isPrivateAddress('fc00::1')).toBe(true);
    expect(isPrivateAddress('fdff::1')).toBe(true);
    expect(isPrivateAddress('fe00::1')).toBe(false); // above fc00::/7, below fe80::/10
    expect(isPrivateAddress('fe7f::1')).toBe(false);
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('febf::1')).toBe(true);
    expect(isPrivateAddress('fec0::1')).toBe(false); // deprecated site-local, not link-local
    expect(isPrivateAddress('ff02::1')).toBe(true); // multicast
  });
});

describe('IPv4 reserved-range boundaries', () => {
  test('192.0.0.0/24 is refused but the rest of 192.0.0.0/16 is not', () => {
    // The check said 192.0.0.0/16 while its own comment said /24. 192.0.1.0/24
    // upward is ordinary allocated space; over-blocking a routable range is its
    // own bug.
    expect(isPrivateAddress('192.0.0.1')).toBe(true);
    expect(isPrivateAddress('192.0.0.255')).toBe(true);
    expect(isPrivateAddress('192.0.1.1')).toBe(false);
    expect(isPrivateAddress('192.0.2.1')).toBe(false);
  });

  test('the documentation range used by the test resolver stays public', () => {
    // fake-dns.ts hands out 203.0.113.10 as its "public" answer. If this range
    // were ever treated as private, every hermetic test would silently invert.
    expect(isPrivateAddress('203.0.113.10')).toBe(false);
  });

  test('CGNAT and RFC1918 boundaries', () => {
    expect(isPrivateAddress('100.63.255.255')).toBe(false);
    expect(isPrivateAddress('100.64.0.0')).toBe(true);
    expect(isPrivateAddress('100.127.255.255')).toBe(true);
    expect(isPrivateAddress('100.128.0.0')).toBe(false);
    expect(isPrivateAddress('172.15.0.1')).toBe(false);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
  });
});
