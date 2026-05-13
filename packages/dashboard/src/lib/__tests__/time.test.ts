/**
 * Phase 21 — formatRelativeTime unit tests.
 *
 * Covers all 6 bucket boundaries (just-now, minutes, hours, days, weeks,
 * months) at both inclusive and exclusive edges, plus the future-timestamp
 * clamp. Uses a fixed reference epoch (REF_NOW) so tests are reproducible
 * across CI runs — the helper accepts an explicit `nowMs` parameter so no
 * fake-timer instrumentation is required.
 *
 * Pattern: pure parameter-passing tests; mirrors PATTERNS.md §6 scaffold.
 */

import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../time.js';

/** Deterministic reference epoch — NOT Date.now(). Tests are reproducible. */
const REF_NOW = 1_700_000_000_000;

describe('formatRelativeTime (Phase 21)', () => {
  it('returns "just now" for delta < 60 seconds', () => {
    expect(formatRelativeTime(REF_NOW - 30_000, REF_NOW)).toBe('just now');
  });

  it('returns "just now" for zero delta (epochMs === nowMs)', () => {
    expect(formatRelativeTime(REF_NOW, REF_NOW)).toBe('just now');
  });

  it('returns "5m ago" for delta of 5 minutes', () => {
    expect(formatRelativeTime(REF_NOW - 5 * 60_000, REF_NOW)).toBe('5m ago');
  });

  it('returns "59m ago" at the upper edge of the minutes bucket', () => {
    expect(formatRelativeTime(REF_NOW - 59 * 60_000, REF_NOW)).toBe('59m ago');
  });

  it('returns "1h ago" at the hours bucket boundary (60 minutes exactly)', () => {
    expect(formatRelativeTime(REF_NOW - 60 * 60_000, REF_NOW)).toBe('1h ago');
  });

  it('returns "23h ago" at the upper edge of the hours bucket', () => {
    expect(formatRelativeTime(REF_NOW - 23 * 60 * 60_000, REF_NOW)).toBe('23h ago');
  });

  it('returns "1d ago" at the days bucket boundary (24 hours exactly)', () => {
    expect(formatRelativeTime(REF_NOW - 24 * 60 * 60_000, REF_NOW)).toBe('1d ago');
  });

  it('returns "6d ago" at the upper edge of the days bucket', () => {
    expect(formatRelativeTime(REF_NOW - 6 * 24 * 60 * 60_000, REF_NOW)).toBe('6d ago');
  });

  it('returns "1w ago" at the weeks bucket boundary (7 days exactly)', () => {
    expect(formatRelativeTime(REF_NOW - 7 * 24 * 60 * 60_000, REF_NOW)).toBe('1w ago');
  });

  it('returns "3w ago" inside the weeks bucket', () => {
    expect(formatRelativeTime(REF_NOW - 3 * 7 * 24 * 60 * 60_000, REF_NOW)).toBe('3w ago');
  });

  it('returns "1mo ago" at the months bucket (~30 days)', () => {
    expect(formatRelativeTime(REF_NOW - 30 * 24 * 60 * 60_000, REF_NOW)).toBe('1mo ago');
  });

  it('clamps a future timestamp to "just now"', () => {
    expect(formatRelativeTime(REF_NOW + 60_000, REF_NOW)).toBe('just now');
  });
});
