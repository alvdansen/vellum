/**
 * C2paBadge component tests (Phase 14 — Plan 14-04 Task 2).
 *
 * Covers the C2PA signing-state badge primitive: a small inline pill rendered
 * in the VersionDrawer Output section reflecting the signing outcome of the
 * version's primary output file. Reads the X-C2PA-Signing-Status header from
 * the GET /api/versions/:id/output route via the getC2paStatus helper.
 *
 * Mirrors the StatusPill / WarningPill structural pattern (rounded-full,
 * uppercase tracking, --color-bg text). Three states:
 *   - signed     — green, "C2PA: signed"
 *   - unsigned   — red, "C2PA: unsigned (<reason>)" with reason translated to
 *                  human-readable text via a known-codes map
 *   - unknown    — gray, "C2PA: pending" (manifest_signed event not recorded
 *                  yet — legacy version, pre-Phase-14, or download in progress)
 *
 * T-14-11 mitigation: badge text is rendered via Preact JSX text interpolation
 * (NOT dangerouslySetInnerHTML). status_reason flows through a translation map
 * of known enum values; unknown codes pass through a character-class
 * sanitization filter (replace(/[^\w ]/g, '')) so a malicious code can never
 * carry HTML / script content into the rendered DOM.
 *
 * v1.1 scope reduction (Concern #2 from Plan 14-03 revision): the badge is the
 * ONLY surfacing — NO sidecar download link, NO sidecar route. v1.2 will add
 * the sidecar route + dashboard link when c2pa-node exposes a real sidecar
 * cryptographic API.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { C2paBadge } from '../components/C2paBadge.js';
import type { C2paStatus } from '../lib/api.js';

describe('C2paBadge (Phase 14 — Plan 14-04 Task 2)', () => {
  it('renders "C2PA: signed" with success styling for status=signed', () => {
    render(<C2paBadge status={{ status: 'signed' }} />);
    const el = screen.getByTestId('c2pa-badge');
    expect(el.textContent).toMatch(/C2PA:\s*signed/i);
    // Success styling — green / signed / completed CSS-token. Accept any of:
    // 'signed' literal class, 'completed', 'green', or 'success' substring.
    expect(el.className).toMatch(/signed|completed|green|success/i);
  });

  it('renders "C2PA: pending" with neutral styling for status=unknown', () => {
    render(<C2paBadge status={{ status: 'unknown' }} />);
    const el = screen.getByTestId('c2pa-badge');
    expect(el.textContent).toMatch(/C2PA:\s*pending/i);
    // Neutral styling — gray / unknown / muted CSS-token. Accept any of:
    // 'unknown' literal class, 'pending', 'gray', 'muted', 'neutral'.
    expect(el.className).toMatch(/unknown|pending|gray|muted|neutral|fg-muted/i);
  });

  it('renders "C2PA: unsigned (unsupported format)" for unsupported_format reason', () => {
    render(<C2paBadge status={{ status: 'unsigned', reason: 'unsupported_format' }} />);
    const el = screen.getByTestId('c2pa-badge');
    expect(el.textContent).toMatch(/C2PA:\s*unsigned\s*\(unsupported format\)/i);
    // Unsigned styling — red / failed / warning CSS-token.
    expect(el.className).toMatch(/unsigned|failed|red|warning|amber/i);
  });

  it('renders "C2PA: unsigned (signing disabled)" for signing_disabled reason', () => {
    render(<C2paBadge status={{ status: 'unsigned', reason: 'signing_disabled' }} />);
    const el = screen.getByTestId('c2pa-badge');
    expect(el.textContent).toMatch(/C2PA:\s*unsigned\s*\(signing disabled\)/i);
  });

  it('renders human-readable text for cert_load_failed reason', () => {
    render(<C2paBadge status={{ status: 'unsigned', reason: 'cert_load_failed' }} />);
    const el = screen.getByTestId('c2pa-badge');
    expect(el.textContent).toMatch(/C2PA:\s*unsigned\s*\(cert load failed\)/i);
  });

  it('renders human-readable text for sign_call_failed reason', () => {
    render(<C2paBadge status={{ status: 'unsigned', reason: 'sign_call_failed' }} />);
    const el = screen.getByTestId('c2pa-badge');
    expect(el.textContent).toMatch(/C2PA:\s*unsigned\s*\(signing failed\)/i);
  });

  it('renders human-readable text for native_binding_unavailable reason', () => {
    render(
      <C2paBadge status={{ status: 'unsigned', reason: 'native_binding_unavailable' }} />,
    );
    const el = screen.getByTestId('c2pa-badge');
    expect(el.textContent).toMatch(/C2PA:\s*unsigned\s*\(native binding unavailable\)/i);
  });

  it('renders human-readable text for asset_too_large_for_buffer_api reason', () => {
    render(
      <C2paBadge status={{ status: 'unsigned', reason: 'asset_too_large_for_buffer_api' }} />,
    );
    const el = screen.getByTestId('c2pa-badge');
    expect(el.textContent).toMatch(/C2PA:\s*unsigned\s*\(asset too large\)/i);
  });

  it('T-14-11: sanitizes unknown reason codes via character-class filter (no HTML, no <script>)', () => {
    // A malicious / unknown reason code containing HTML must be stripped before
    // rendering. The translation-map fallback uses replace(/[^\w ]/g, '') so
    // angle brackets / quotes / slashes / equals are removed.
    const malicious: C2paStatus = {
      status: 'unsigned',
      reason: '<script>alert(1)</script>',
    };
    render(<C2paBadge status={malicious} />);
    const el = screen.getByTestId('c2pa-badge');
    // No raw HTML reaches the DOM — the textContent must NOT contain the
    // characters < > / =. JSX text interpolation also escapes; defence-in-depth
    // via the replace() removes them BEFORE they hit the renderer.
    expect(el.textContent).not.toMatch(/[<>/]/);
    // The sanitized text should still carry SOMETHING readable — either the
    // alphanumeric residue ('scriptalert1script') or the literal 'unsigned'.
    expect(el.textContent).toMatch(/C2PA:\s*unsigned/i);
    // T-14-11: assert there are zero <script> elements inside the badge.
    expect(el.querySelectorAll('script').length).toBe(0);
  });

  it('T-14-11: does NOT render via dangerouslySetInnerHTML (children are text nodes)', () => {
    render(<C2paBadge status={{ status: 'unsigned', reason: 'unsupported_format' }} />);
    const el = screen.getByTestId('c2pa-badge');
    // dangerouslySetInnerHTML would set innerHTML directly. JSX text
    // interpolation produces TEXT_NODE children. Assert that all child
    // nodes inside the badge are text nodes (Node.TEXT_NODE === 3).
    for (const child of Array.from(el.childNodes)) {
      expect(child.nodeType).toBe(Node.TEXT_NODE);
    }
  });

  it('exposes role="status" so screen readers announce the signing state', () => {
    render(<C2paBadge status={{ status: 'signed' }} />);
    const el = screen.getByTestId('c2pa-badge');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-label')).toMatch(/c2pa/i);
  });
});
