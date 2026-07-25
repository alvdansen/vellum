/**
 * C2paBadge — small inline pill rendering the C2PA signing-state for a
 * version's primary output. Mounted in VersionDrawer's Output section
 * alongside the original-file thumbnail link.
 *
 * Phase 14 Plan 04 (Task 2) primitive. Mirrors the StatusPill / WarningPill
 * structural shape (rounded-full, uppercase tracking, --color-bg text on
 * a saturated CSS-token background) — three intent variants:
 *
 *   - signed   → green   (--color-status-completed)  "C2PA: signed"
 *   - unsigned → red     (--color-status-failed)     "C2PA: unsigned (<reason>)"
 *   - unknown  → muted   (--color-fg-muted)          "C2PA: pending"
 *
 * `unsigned` reasons are translated via a known-codes map (the 6 enum values
 * Plan 14-03 emits, plus a defensive 'unknown' fallback). Unknown / unmapped
 * reason codes pass through a character-class sanitization filter
 * `replace(/[^\w ]/g, '')` so a malicious or unexpected code can never carry
 * HTML / script content into the rendered DOM (T-14-11 mitigation;
 * defence-in-depth on top of Preact's automatic text-node escaping).
 *
 * SECURITY — T-14-11: badge text is rendered via Preact JSX text
 * interpolation. We do NOT use dangerouslySetInnerHTML. All children are
 * TEXT_NODEs. Even if the server-trusted enum is bypassed and a malicious
 * reason string reaches this component, the character-class filter strips
 * angle brackets / quotes / slashes / equals BEFORE rendering, AND Preact's
 * default text-node behavior escapes any leftovers as text content.
 *
 * v1.1 scope reduction (Plan 14-03 Concern #2 carried forward): the badge is
 * the ONLY surfacing of signing state in the dashboard. There is NO sidecar
 * download link in v1.1 — c2pa-node v0.5.26 has no public sidecar API.
 * EXR/PSD outputs surface as `unsigned (unsupported format)`.
 */

export type C2paBadgeStatus =
  | { status: 'signed' }
  | { status: 'unsigned'; reason: string }
  | { status: 'unknown' };

/**
 * Translation map: server-trusted enum → human-readable text. Mirrors the 6
 * status_reason codes Plan 14-03's Engine.signOutput emits (Concern #2 v1.1
 * reduction: NO `sidecar` field; EXR/PSD surface as `unsupported_format`).
 *
 * Unknown codes fall through to the character-class sanitization filter
 * below — defence-in-depth on top of Preact's text-node escaping.
 */
const REASON_TEXT: Record<string, string> = {
  signing_disabled: 'signing disabled',
  unsupported_format: 'unsupported format',
  cert_load_failed: 'cert load failed',
  sign_call_failed: 'signing failed',
  native_binding_unavailable: 'native binding unavailable',
  asset_too_large_for_buffer_api: 'asset too large',
};

/**
 * T-14-11 sanitization filter for unmapped / unknown reason codes. Strips any
 * character that is not a word character or space. Even a code containing
 * `<script>alert(1)</script>` becomes `scriptalert1script` — no angle
 * brackets, no quotes, no slashes, no equals. JSX text interpolation also
 * escapes the result as a text node (defence-in-depth).
 */
function sanitizeUnknownReason(reason: string): string {
  return reason.replace(/[^\w ]/g, '');
}

export interface C2paBadgeProps {
  status: C2paBadgeStatus;
}

export function C2paBadge({ status }: C2paBadgeProps) {
  if (status.status === 'signed') {
    return (
      <span
        class="c2pa-badge c2pa-badge-signed inline-flex items-center rounded-full bg-[var(--color-status-completed)] px-2 py-0.5 text-xs font-normal uppercase tracking-widest text-[var(--color-bg)]"
        role="status"
        aria-label="C2PA: signed"
        data-testid="c2pa-badge"
      >
        C2PA: signed
      </span>
    );
  }
  if (status.status === 'unknown') {
    return (
      <span
        class="c2pa-badge c2pa-badge-unknown c2pa-badge-pending inline-flex items-center rounded-full bg-[var(--color-fg-muted)] px-2 py-0.5 text-xs font-normal uppercase tracking-widest text-[var(--color-bg)]"
        role="status"
        aria-label="C2PA: pending"
        data-testid="c2pa-badge"
      >
        C2PA: pending
      </span>
    );
  }
  // unsigned — translate known codes, sanitize unknown ones (T-14-11).
  const translated = REASON_TEXT[status.reason];
  const text = translated ?? sanitizeUnknownReason(status.reason);
  // The full label flows through JSX text interpolation — Preact escapes as
  // a text node. Defence-in-depth: sanitizeUnknownReason already stripped any
  // non-word/space characters before this point.
  const label = `C2PA: unsigned (${text})`;
  return (
    <span
      class="c2pa-badge c2pa-badge-unsigned c2pa-badge-failed inline-flex items-center rounded-full bg-[var(--color-status-failed)] px-2 py-0.5 text-xs font-normal uppercase tracking-widest text-[var(--color-bg)]"
      role="status"
      aria-label={label}
      data-testid="c2pa-badge"
    >
      {label}
    </span>
  );
}
