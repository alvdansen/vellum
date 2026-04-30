/**
 * WarningPill component tests (Phase 12 — DEMO-03).
 *
 * Covers the divergence indication primitive: an amber/yellow pill rendered
 * in the VersionDrawer header when a reproduce-lineage version's bytes drift
 * from its parent OR when partner-API non-determinism warnings exist.
 *
 * Mirrors the StatusPill structural pattern (rounded-full, uppercase tracking)
 * but with warning intent — distinct color (amber/yellow CSS-token) and free-form
 * label text. Accessibility: role="status" + aria-label so screen readers
 * announce the divergence on drawer mount.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { WarningPill } from '../components/WarningPill.js';

describe('WarningPill (Phase 12 — DEMO-03)', () => {
  it('renders the default label "non-deterministic"', () => {
    render(<WarningPill />);
    expect(screen.getByText(/non-deterministic/i)).toBeTruthy();
  });

  it('renders a custom label when provided', () => {
    render(<WarningPill label="reproduction may differ" />);
    expect(screen.getByText(/reproduction may differ/i)).toBeTruthy();
  });

  it('applies an amber/yellow/warning background class', () => {
    render(<WarningPill />);
    const el = screen.getByTestId('warning-pill');
    // Accept any of: amber, yellow, warning (CSS-token variant). One must match.
    expect(el.className).toMatch(/amber|yellow|warning/);
  });

  it('exposes role="status" and an aria-label for assistive tech', () => {
    render(<WarningPill />);
    const el = screen.getByTestId('warning-pill');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-label')).toMatch(/warning/i);
  });

  it('uses a custom aria-label when provided', () => {
    render(<WarningPill ariaLabel="non-deterministic — outputs may differ from parent" />);
    const el = screen.getByTestId('warning-pill');
    expect(el.getAttribute('aria-label')).toBe(
      'non-deterministic — outputs may differ from parent',
    );
  });
});
