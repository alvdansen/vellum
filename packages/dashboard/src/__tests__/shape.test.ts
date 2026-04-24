// packages/dashboard/src/__tests__/shape.test.ts
//
// SC-6 (gap_closure IN-04): normalizeStatus exhaustive switch + throw on unknown.
//
// Contract (from 06-RESEARCH.md §SC-6 + 06-PATTERNS.md §NEW shape.test.ts):
//   - Maps every member of the Version['status'] union to the documented Status:
//       submitted → queued
//       running   → running
//       completed → complete
//       failed    → failed
//       queued    → queued   (passthrough)
//       complete  → complete (passthrough — dashboard synonym)
//   - undefined returns 'queued' (defensive default for missing-status payloads)
//   - For any other input (force-cast through TypeScript), THROWS — the
//     `_exhaustive: never` default arm catches future drift in the union.
//
// Wave 0: this file is committed BEFORE Plan 07 (SC-6 implementation). The
// "throws on unknown" cases will currently FAIL because the existing
// implementation silently returns 'queued' for unknown input. Plan 07 lands
// the rewrite to satisfy these assertions.
//
// Analog: active-generations.test.ts — pure-import, no stubs, simple
// import-call-assert idiom for a dashboard-local module.

import { describe, it, expect } from 'vitest';
import { normalizeStatus } from '../lib/shape.js';
import type { Version } from '../types/entities.js';

describe('normalizeStatus exhaustive mapping (SC-6)', () => {
  it("maps 'submitted' → 'queued'", () => {
    expect(normalizeStatus('submitted')).toBe('queued');
  });

  it("maps 'running' → 'running'", () => {
    expect(normalizeStatus('running')).toBe('running');
  });

  it("maps 'completed' → 'complete'", () => {
    expect(normalizeStatus('completed')).toBe('complete');
  });

  it("maps 'failed' → 'failed'", () => {
    expect(normalizeStatus('failed')).toBe('failed');
  });

  it("passes 'queued' through unchanged", () => {
    expect(normalizeStatus('queued')).toBe('queued');
  });

  it("passes 'complete' through unchanged (dashboard synonym)", () => {
    expect(normalizeStatus('complete')).toBe('complete');
  });

  it("returns 'queued' for undefined input (defensive default)", () => {
    expect(normalizeStatus(undefined)).toBe('queued');
  });

  it("throws on unknown 'aborted' (force-cast — exhaustive default arm)", () => {
    expect(() =>
      normalizeStatus('aborted' as unknown as Version['status']),
    ).toThrowError(/normalizeStatus: unhandled status: aborted/);
  });

  it("throws on unknown 'cancelled' (force-cast — regression guard)", () => {
    expect(() =>
      normalizeStatus('cancelled' as unknown as Version['status']),
    ).toThrowError(/normalizeStatus: unhandled status: cancelled/);
  });
});
