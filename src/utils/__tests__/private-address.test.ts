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
