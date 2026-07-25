/**
 * ProviderBadge component tests (pivot enhancement #5).
 *
 * Verifies: the badge renders the provider id as escaped text with an
 * accessible label + stable data-testid, uses muted theme tokens (not a
 * status/warning color), and renders NOTHING when provider is absent (legacy
 * rows) so single-provider views are unchanged.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/preact';
import { ProviderBadge } from '../ProviderBadge.js';

afterEach(() => {
  cleanup();
});

describe('ProviderBadge (#5)', () => {
  it('renders the provider id with an accessible label', () => {
    render(<ProviderBadge provider="replicate" />);
    const badge = screen.getByTestId('provider-badge');
    expect(badge.textContent).toBe('replicate');
    expect(badge.getAttribute('aria-label')).toBe('Provider: replicate');
    expect(badge.getAttribute('role')).toBe('note');
  });

  it('uses muted (non-status) theme tokens', () => {
    render(<ProviderBadge provider="fal" />);
    const cls = screen.getByTestId('provider-badge').className;
    expect(cls).toContain('text-[var(--color-fg-muted)]');
    expect(cls).toContain('bg-[var(--color-surface)]');
    expect(cls).toContain('border-[var(--color-border)]');
  });

  it('renders nothing when provider is null/undefined (legacy rows)', () => {
    const { container: c1 } = render(<ProviderBadge provider={null} />);
    expect(c1.querySelector('[data-testid="provider-badge"]')).toBeNull();
    const { container: c2 } = render(<ProviderBadge />);
    expect(c2.querySelector('[data-testid="provider-badge"]')).toBeNull();
  });
});
