/**
 * Phase 21 — formatRelativeTime: convert an epoch-ms timestamp to a short
 * human-readable string like "just now", "2h ago", "3d ago".
 *
 * Pure function — no side effects, no Date.now() shimming (caller passes a
 * reference time for testability). Uses 6 named copy constants from
 * lib/copy.ts (TIME_JUST_NOW, TIME_MINUTES_SUFFIX, etc.) — no inline strings.
 *
 * Bucket boundaries (mirrors GitHub / Linear precedent):
 *   - < 60 s:        "just now"
 *   - < 60 min:      "{n}m ago"
 *   - < 24 h:        "{n}h ago"
 *   - < 7 d:         "{n}d ago"
 *   - < 4 w:         "{n}w ago"
 *   - else:          "{n}mo ago"
 *
 * Architecture-purity: zero imports from src/. Only ./copy.js.
 *
 * Future-timestamp handling: `Math.max(0, ...)` clamps negative deltas to
 * zero, so a future epochMs returns "just now" rather than a "-5m ago"
 * astonishment. The 30-day month bucket is an accepted UI-SPEC approximation
 * (real calendars are 28-31 days; for "Updated 2mo ago" surface this is fine).
 */
import {
  TIME_JUST_NOW,
  TIME_MINUTES_SUFFIX,
  TIME_HOURS_SUFFIX,
  TIME_DAYS_SUFFIX,
  TIME_WEEKS_SUFFIX,
  TIME_MONTHS_SUFFIX,
} from './copy.js';

export function formatRelativeTime(epochMs: number, nowMs: number = Date.now()): string {
  const deltaSec = Math.max(0, Math.floor((nowMs - epochMs) / 1000));
  if (deltaSec < 60) return TIME_JUST_NOW;
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}${TIME_MINUTES_SUFFIX}`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}${TIME_HOURS_SUFFIX}`;
  const deltaDay = Math.floor(deltaHr / 24);
  if (deltaDay < 7) return `${deltaDay}${TIME_DAYS_SUFFIX}`;
  const deltaWk = Math.floor(deltaDay / 7);
  if (deltaWk < 4) return `${deltaWk}${TIME_WEEKS_SUFFIX}`;
  const deltaMo = Math.floor(deltaDay / 30);
  return `${deltaMo}${TIME_MONTHS_SUFFIX}`;
}
