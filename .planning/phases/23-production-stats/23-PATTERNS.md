# Phase 23: Production Stats — Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 16 (1 NEW component, 7 MODIFIED dashboard, 3 MODIFIED server, 5 NEW/EXTENDED tests)
**Analogs found:** 16 / 16 (every file has a direct precedent in Phase 17-22 work; Phase 23 is a pure-composition phase)

## File Classification

| File | Status | Role | Data Flow | Closest Analog | Match Quality |
|------|--------|------|-----------|----------------|---------------|
| `packages/dashboard/src/components/ProgressBar.tsx` | NEW | component (display primitive) | render-only | `packages/dashboard/src/components/WarningPill.tsx` | role-match (pure display pill primitive) |
| `packages/dashboard/src/components/SequenceHeader.tsx` | MODIFIED | component (composition) | render-only | itself (lines 89-111 — existing mini-pills sibling row) | exact (same file extension) |
| `packages/dashboard/src/components/ShotGridCard.tsx` | MODIFIED | component (composition) | render-only | itself (lines 153-156 — existing `isOmit` conditional wrapper) | exact (same file extension) |
| `packages/dashboard/src/types/shot-grid.ts` | MODIFIED | types (wire shape) | typed contract | itself (lines 56-69 — existing `ShotGridResponse` envelope) | exact (same file extension) |
| `packages/dashboard/src/state/shot-grid.ts` | MODIFIED | state (signals + SSE handler) | event-driven + signal mutation | itself (lines 76, 123-136, 160-171 — existing signal + computed + handler) | exact (same file extension) |
| `packages/dashboard/src/views/ShotGridView.tsx` | MODIFIED | view (composition + signal seeding) | request-response → signal seed | itself (lines 132-145 — existing `fetchShotGrid.then` seed; lines 290-299 — existing prop passing) | exact (same file extension) |
| `packages/dashboard/src/lib/copy.ts` | MODIFIED | copy registry | static constants | itself (lines 313-398 — Phase 22 block append precedent) | exact (same file extension) |
| `packages/dashboard/src/styles/theme.css` | MODIFIED | theme tokens | static CSS | itself (lines 53-58 dark + lines 114-119 light — Phase 21 5-token precedent) | exact (same file extension) |
| `src/store/shot-status-repo.ts` | MODIFIED | repo (SQL query function) | request-response (DB read) | itself (lines 228-285 — `listShotsForGrid` + window-function CTE) | exact (same file extension) |
| `src/engine/pipeline.ts` | MODIFIED | engine (facade composition) | request-response (compose) | itself (lines 822-874 — existing `listShotGrid` facade) | exact (same file extension) |
| `src/http/dashboard-routes.ts` | MODIFIED (response envelope only) | route (Hono handler) | request-response | itself (lines 370-375 — existing thin handler; no signature change) | exact (same file extension) |
| `src/store/__tests__/shot-status-repo-stats.test.ts` | NEW | test (repo unit) | EXPLAIN-driven SQL | `src/store/__tests__/shot-status-repo-grid.test.ts` (Phase 21 — EXPLAIN QUERY PLAN harness) | role-match (same role: repo SQL test) |
| `packages/dashboard/src/components/__tests__/SequenceHeader.stats.test.tsx` | NEW | test (component unit) | render assertion | `packages/dashboard/src/components/__tests__/SequenceHeader.test.tsx` (Phase 21) | exact (same component test) |
| `packages/dashboard/src/components/__tests__/ShotGridCard.stale.test.tsx` | NEW | test (component unit) | render assertion | `packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` (Phase 21) | exact (same component test) |
| `packages/dashboard/src/state/__tests__/shot-grid-stats-delta.test.ts` | NEW | test (state unit) | event → signal | `packages/dashboard/src/state/__tests__/shot-grid.test.ts` (Phase 21) | exact (same state module test) |
| `src/http/__tests__/dashboard-routes-shot-grid.test.ts` | EXTENDED | test (route unit) | request-response | itself (Phase 21 — extended in place) | exact (same file extension) |

## Pattern Assignments

### 1. `packages/dashboard/src/components/ProgressBar.tsx` (NEW component, render-only)

**Analog:** `packages/dashboard/src/components/WarningPill.tsx` (pure display pill primitive; matches "small, pure, no callbacks, no state" shape).

**Imports pattern** (analog lines 1-20, header block):
```typescript
/**
 * ProgressBar — WCAG 2.1 AA progress-bar primitive.
 *
 * Phase 23 (D-06). Pure component: props-in, no callbacks, no state.
 * Renders a horizontal bar with `role="progressbar"` and the full set of
 * `aria-value{now,min,max}` + `aria-label` attributes for assistive tech.
 *
 * SECURITY — T-5-06: dynamic content (ariaLabel, label) flows as JSX text
 * children → Preact auto-escapes.
 */
```
*Mirrors WarningPill.tsx:1-20 doc-comment shape (provenance comment + SECURITY callout + "Pure component" tagline).*

**Component signature pattern** (analog WarningPill.tsx:22-32):
```typescript
export interface ProgressBarProps {
  /** Current progress value (typically 0-100). Clamped at render time. */
  value: number;
  /** Maximum value. Defaults to 100. */
  max?: number;
  /** Optional visible label rendered next to the bar (e.g., "60% approved"). */
  label?: string;
  /** REQUIRED `aria-label` on the progressbar element. */
  ariaLabel: string;
}

export function ProgressBar({ value, max = 100, label, ariaLabel }: ProgressBarProps) {
  // ...
}
```
*Mirrors WarningPill.tsx:22-32 props interface + default-arg destructuring + named-export function (no default export).*

**Core render pattern** (analog WarningPill.tsx:32-43):
```typescript
// Defensive clamp — UI-SPEC line 278 ("Math.max(0, Math.min(max, Math.round(value)))").
const clamped = Math.max(0, Math.min(max, Math.round(value)));
const pct = max === 0 ? 0 : Math.round((clamped / max) * 100);

return (
  <div class="inline-flex items-center gap-1">
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={ariaLabel}
      class="relative h-2 w-32 overflow-hidden rounded bg-[var(--color-border)]"
    >
      <div
        class="h-full bg-[var(--color-shot-status-approved)] transition-[width] duration-150 motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
    {label ? (
      <span class="num text-xs text-[var(--color-fg-muted)]">{label}</span>
    ) : null}
  </div>
);
```
*Mirrors WarningPill's `inline-flex` outer + saturated-bg inner + Tailwind v4 utility class strings.* Use `class=` (Preact convention) NOT `className=`. The `transition-[width] motion-reduce:transition-none` pair honors `prefers-reduced-motion` per D-21 + UI-SPEC line 278.

---

### 2. `packages/dashboard/src/components/SequenceHeader.tsx` (MODIFIED, render-only)

**Analog:** Itself — extend the existing `flex flex-col gap-2` column at line 66 with a NEW sibling subrow between the chevron row (lines 67-88) and the mini-pills row (lines 89-111).

**Imports pattern extension** (analog SequenceHeader.tsx:22-28):
```typescript
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-preact';
import type { ShotStatus, SequenceStats } from '../types/shot-grid.js';
import { ProgressBar } from './ProgressBar.js';
import {
  SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_OPEN,
  SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_CLOSED,
  AGGREGATE_COUNTS_REGION_LABEL_PREFIX,
  // Phase 23 — production stats copy
  STATS_PROGRESS_ARIA_PREFIX,
  STATS_APPROVED_LABEL_SUFFIX,
  STATS_BACKLOG_CALLOUT_SINGULAR,
  STATS_BACKLOG_CALLOUT_PLURAL,
  STATS_BACKLOG_CALLOUT_ARIA_PREFIX,
  STATS_STALE_INLINE_SINGULAR,
  STATS_STALE_INLINE_PLURAL,
  STATS_STALE_INLINE_ARIA_PREFIX,
} from '../lib/copy.js';
```
*Mirrors existing barrel-import block (single `lucide-preact` line for ALL icons; single copy-import barrel).*

**Props extension pattern** (analog SequenceHeader.tsx:30-35):
```typescript
export interface SequenceHeaderProps {
  sequenceName: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  counts: Record<ShotStatus, number>;
  /** Phase 23 — D-04 stats subrow. `null` = pre-fetch; subrow does not render. */
  stats: SequenceStats | null;
}
```
*Mirrors existing `counts` prop addition shape — required prop, named-export interface, jsdoc per field.*

**Conditional subrow render pattern** (analog SequenceHeader.tsx:89-111 — existing mini-pills row with hide-on-zero logic; subrow follows identical "render-only-when-non-empty" pattern):
```typescript
// NEW Phase 23 stats subrow — inserted between line 88 (closing chevron+name <div>) and line 89 (existing mini-pills row).
// Renders ONLY when stats is non-null AND total > 0 (UI-SPEC §"Empty states" decision matrix).
{stats !== null && stats.total > 0 && (
  <div class="flex items-center gap-3">
    <ProgressBar
      value={stats.approved_pct}
      max={100}
      label={`${stats.approved_pct}${STATS_APPROVED_LABEL_SUFFIX}`}
      ariaLabel={`${STATS_PROGRESS_ARIA_PREFIX}${sequenceName}`}
    />
    {stats.pending_review_backlog > 0 && (
      <span
        role="status"
        aria-label={`${STATS_BACKLOG_CALLOUT_ARIA_PREFIX}${stats.pending_review_backlog} ${
          stats.pending_review_backlog === 1
            ? STATS_BACKLOG_CALLOUT_SINGULAR
            : STATS_BACKLOG_CALLOUT_PLURAL
        }`}
        class="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-xs uppercase tracking-widest text-[var(--color-bg)]"
      >
        <AlertCircle size={12} aria-hidden="true" />
        <span class="num">{stats.pending_review_backlog}</span>
        <span>
          {stats.pending_review_backlog === 1
            ? STATS_BACKLOG_CALLOUT_SINGULAR
            : STATS_BACKLOG_CALLOUT_PLURAL}
        </span>
      </span>
    )}
    {stats.stale_count > 0 && (
      <span
        aria-label={`${STATS_STALE_INLINE_ARIA_PREFIX}${stats.stale_count}`}
        class="text-xs text-[var(--color-shot-stale)]"
      >
        <span class="num">{stats.stale_count}</span>{' '}
        {stats.stale_count === 1
          ? STATS_STALE_INLINE_SINGULAR
          : STATS_STALE_INLINE_PLURAL}
      </span>
    )}
  </div>
)}
```
*The backlog-callout pill mirrors lines 100-109 of the mini-pill render exactly (rounded-full px-2 py-0.5 text-xs uppercase tracking-widest + saturated-bg + `--color-bg` text). The `if (n === 0) return null` pattern on line 99 reused as JSX inline `{cond && (...)}`.*

---

### 3. `packages/dashboard/src/components/ShotGridCard.tsx` (MODIFIED, render-only)

**Analog:** Itself — extend the outer `<div class="group relative">` at line 75 with a conditional border class. The existing `isOmit` opacity-40 wrapper at lines 153-156 is the closest precedent for "conditional className based on shot state."

**Conditional class pattern** (analog ShotGridCard.tsx:71-75 + 153-156 — existing `isOmit` flag computed at top then applied as wrapper):
```typescript
// Replace existing line 75:
//   <div class="group relative w-full overflow-hidden rounded">
// WITH a template-literal class that adds the amber border conditionally.
const cardBody = (
  <div
    class={`group relative w-full overflow-hidden rounded${
      shot.is_stale ? ' border-2 border-[var(--color-shot-stale)]' : ''
    }`}
  >
    {/* ... existing children unchanged ... */}
  </div>
);
```
*Mirrors the existing `isOmit ? <div class="opacity-40">...</div> : cardBody` ternary structure (line 153) but applied as an INLINE class concatenation since the border is on the SAME `<div>` (no extra wrapper). The template-literal class is the established Preact + Tailwind v4 idiom — see Phase 21 22-07 commit message for "conditional ring on outer div" precedent.*

**aria-label extension pattern** (analog ShotGridCard.tsx:84):
```typescript
// Replace existing line 84:
//   aria-label={`${SHOT_CARD_OPEN_ARIA_PREFIX}${shot.name}`}
// WITH (append SHOT_CARD_STALE_ARIA_SUFFIX when is_stale per UI-SPEC):
aria-label={`${SHOT_CARD_OPEN_ARIA_PREFIX}${shot.name}${
  shot.is_stale ? SHOT_CARD_STALE_ARIA_SUFFIX : ''
}`}
```
*Mirrors the SR-only aria-suffix pattern used by `TREE_GRID_ICON_ACTIVE_ARIA_SUFFIX` (copy.ts:306). No visible text change; the border is the visible signal.*

**Coexistence with omit wrapper** (analog ShotGridCard.tsx:153-156 — UNCHANGED):
```typescript
if (isOmit) {
  return <div class="opacity-40 transition-opacity">{cardBody}</div>;
}
return cardBody;
```
*Per OVR-02 + D-09: omit shots are by-definition not stale, so the combination cannot occur. The opacity-40 wrapper stays OUTSIDE the new border.*

---

### 4. `packages/dashboard/src/types/shot-grid.ts` (MODIFIED, typed contract)

**Analog:** Itself — extend the existing `ShotGridRow` interface (lines 42-54) with `is_stale: boolean`; extend `ShotGridResponse` (lines 62-69) with `stats: SequenceStats`.

**Interface extension pattern** (analog types/shot-grid.ts:42-54 — snake_case discipline):
```typescript
/**
 * Phase 23 — D-02 LOCKED envelope shape for sequence-wide stats. Server
 * computes via a single GROUP BY query (no N+1); seeded into the dashboard
 * `sequenceStats` signal from `fetchShotGrid` response. Mirrors the
 * snake_case convention already established at lines 11-14 for envelope
 * fields (`next_cursor`, `total_count`, `version_count`).
 *
 * `pending_review_backlog` duplicates `counts['pending-review']` BY DESIGN
 * (D-02) — keeps backlog-callout component data-source independent of the
 * mini-pills row.
 */
export interface SequenceStats {
  total: number;
  approved_pct: number;
  counts: Record<ShotStatus, number>;
  pending_review_backlog: number;
  stale_count: number;
}

export interface ShotGridRow {
  id: string;
  name: string;
  status: ShotStatus;
  version_count: number;
  /** Phase 23 — D-03 per-row staleness flag (server-computed via inline CASE). */
  is_stale: boolean;
  latest_completed_version: {
    id: string;
    thumbnail_url: string;
    completed_at: number;
  } | null;
}

export interface ShotGridResponse {
  sequence: ShotGridSequenceMeta;
  shots: ShotGridRow[];
  /** Phase 23 — D-02 sequence-wide stats (independent of pagination). */
  stats: SequenceStats;
  next_cursor: string | null;
  total_count: number;
}
```
*Mirrors existing interface shapes verbatim — snake_case fields, jsdoc per field, no exported defaults, sibling-export pattern. The `Record<ShotStatus, number>` exactly mirrors the existing `aggregateCounts` typing at state/shot-grid.ts:123.*

---

### 5. `packages/dashboard/src/state/shot-grid.ts` (MODIFIED, event-driven + signal mutation)

**Analog:** Itself — extend the existing signal bag (line 76 `shotGrid: Signal<ShotGridResponse | null>`) and the existing `onShotStatusChanged` handler (lines 160-171).

**Signal addition pattern** (analog state/shot-grid.ts:70-77):
```typescript
/**
 * Phase 23 — D-10 sequence-wide stats signal. Seeded from `fetchShotGrid`
 * response in <ShotGridView/>; mutated incrementally by `onShotStatusChanged`
 * via `applyStatsDelta` helper. `null` represents the pre-fetch / no-grid-
 * loaded state. Lives alongside the existing per-domain signals — same
 * co-location convention Phase 21 established for the shot-grid view.
 *
 * D-19 caveat: stale_count delta arithmetic is correct only for shots within
 * the paginated buffer (`shotGrid.value.shots[]`). A status change for a
 * shot beyond the loaded pages leaves stale_count at its server-snapshot
 * value — best-effort; supervisor re-opens the sequence for a fresh snapshot.
 */
export const sequenceStats = signal<SequenceStats | null>(null);
```
*Mirrors lines 70-77 verbatim — same `signal<T | null>(null)` shape, same multi-line jsdoc, same module-singleton placement (between `shotGrid` and `statusFilter` for logical group).*

**Constants mirror pattern** (analog state/shot-grid.ts:108-110 — single source of truth comment):
```typescript
/**
 * Dashboard-side mirror of `STALE_SHOT_DAYS = 14` (src/store/shot-status-repo.ts:54).
 * MUST stay in sync — server uses the constant for the `is_stale` CASE
 * expression; dashboard uses this value for `applyStatsDelta`'s
 * `recomputeIsStaleClient` post-transition simulation (D-12).
 */
const STALE_SHOT_DAYS_MS = 14 * 86_400_000;
```
*Mirrors the existing inline constant declarations + jsdoc pattern. Document as "MUST stay in sync" comment per CONTEXT D-19 instructions.*

**Handler extension pattern** (analog state/shot-grid.ts:160-171 — existing `onShotStatusChanged` body extended with stats delta BEFORE the existing per-row map):
```typescript
export function onShotStatusChanged(payload: ShotStatusChangedPayload): void {
  const current = shotGrid.value;
  if (current === null) return;
  if (current.sequence.id !== payload.sequenceId) return;

  // Phase 23 — find buffer position BEFORE mutating (need OLD is_stale for delta).
  const idx = current.shots.findIndex((s) => s.id === payload.shotId);
  const shotInBuffer = idx >= 0 ? current.shots[idx] : null;

  // Existing Phase 21 per-row map — preserved.
  shotGrid.value = {
    ...current,
    shots: current.shots.map((s) =>
      s.id === payload.shotId
        ? { ...s, status: payload.toStatus, is_stale: recomputeIsStaleClient({ ...s, status: payload.toStatus }) }
        : s,
    ),
  };

  // Phase 23 — apply stats delta. No-op if sequenceStats not seeded yet
  // (Pitfall 9 — pre-fetch SSE dropped; server snapshot wins on next fetch).
  const prevStats = sequenceStats.value;
  if (prevStats === null) return;

  // Pitfall 2: payload.fromStatus is `ShotStatus | null` per events.ts:73;
  // null happens on the FIRST-ever status set for a shot. Default to 'wip'
  // (the materialized starting state per Phase 20 schema default).
  const effectiveFromStatus = payload.fromStatus ?? 'wip';

  sequenceStats.value = applyStatsDelta(
    prevStats,
    effectiveFromStatus,
    payload.toStatus,
    shotInBuffer,
  );
}

function applyStatsDelta(
  prev: SequenceStats,
  fromStatus: ShotStatus,
  toStatus: ShotStatus,
  shotInBuffer: ShotGridRow | null,
): SequenceStats {
  // Decrement old, increment new — clamp at 0 defensively (Pitfall 1).
  const counts = { ...prev.counts };
  counts[fromStatus] = Math.max(0, counts[fromStatus] - 1);
  counts[toStatus] = counts[toStatus] + 1;

  // Bracket access for hyphenated key (Pitfall 10).
  const newBacklog = counts['pending-review'];
  const newApprovedPct =
    prev.total === 0 ? 0 : Math.round((counts.approved / prev.total) * 100);

  // Stale-count delta — best-effort outside buffer (D-19 + Pitfall 3).
  let newStaleCount = prev.stale_count;
  if (shotInBuffer !== null) {
    const wasStale = shotInBuffer.is_stale;
    const isStaleNow = recomputeIsStaleClient({
      ...shotInBuffer,
      status: toStatus,
    });
    if (wasStale && !isStaleNow) newStaleCount = Math.max(0, newStaleCount - 1);
    if (!wasStale && isStaleNow) newStaleCount = newStaleCount + 1;
  }

  return {
    total: prev.total,
    approved_pct: newApprovedPct,
    counts,
    pending_review_backlog: newBacklog,
    stale_count: newStaleCount,
  };
}

function recomputeIsStaleClient(row: ShotGridRow): boolean {
  // Match server (D-15 pragmatic): zero-version shots NEVER stale.
  if (row.latest_completed_version === null) return false;
  if (row.status !== 'wip' && row.status !== 'pending-review') return false;
  return Date.now() - row.latest_completed_version.completed_at > STALE_SHOT_DAYS_MS;
}
```
*Extends the existing handler IN PLACE (no relocation) — preserves reference equality for the `onSseEvent` lifecycle at App.tsx:88. Three defensive branches preserved: null-grid guard (line 162), cross-sequence guard (line 163), unknown-shotId passthrough via `.map` identity (line 167-169). The new branches add: stats-null guard (Pitfall 9), null-fromStatus default (Pitfall 2), out-of-buffer guard (Pitfall 3).*

---

### 6. `packages/dashboard/src/views/ShotGridView.tsx` (MODIFIED, request-response → signal seed)

**Analog:** Itself — extend the existing `fetchShotGrid.then` resolved-branch at lines 132-145 with the stats seed; extend the existing `<SequenceHeader/>` render call at lines 290-299 with the `stats` prop.

**Signal seeding pattern** (analog ShotGridView.tsx:132-145 — existing `.then` body):
```typescript
fetchShotGrid(seqId, { limit: 20 })
  .then((res) => {
    if (!alive) return;
    shotGrid.value = res;
    sequenceStats.value = res.stats; // NEW Phase 23 — seed from response
    gridIsFetching.value = false;
  })
  .catch(() => {
    if (!alive) return;
    gridLoadMoreError.value = SHOT_GRID_FETCH_ERROR;
    gridIsFetching.value = false;
  });
```
*Single-line addition to the existing `.then` body. The `.catch` does NOT clear `sequenceStats.value` — same pattern as `shotGrid.value` (stays at prior snapshot on error, just like the existing handling).*

**Load-more does NOT re-seed stats:** The existing `loadMore()` function at lines 172-214 mutates `shotGrid.value` (appending to `.shots[]`); it does NOT need to touch `sequenceStats.value` because stats are sequence-wide and pagination-independent (D-13 / D-14). The server response on subsequent pages still includes `stats` — ignore it (or trust the existing one is current).

**Prop passing pattern** (analog ShotGridView.tsx:290-299 — existing render call):
```typescript
{shotGrid.value && (
  <SequenceHeader
    sequenceName={shotGrid.value.sequence.name}
    expanded={headerExpanded.value}
    onToggleExpanded={() => {
      headerExpanded.value = !headerExpanded.value;
    }}
    counts={aggregateCounts.value}
    stats={sequenceStats.value}  // NEW Phase 23
  />
)}
```
*Single-line prop addition between `counts={...}` and the closing `/>`. The signal `.value` access is required so Preact tracks the dependency.*

**Import additions** (analog ShotGridView.tsx:53-63):
```typescript
import {
  // ...existing imports...
  sequenceStats,  // NEW Phase 23
} from '../state/shot-grid.js';
```

---

### 7. `packages/dashboard/src/lib/copy.ts` (MODIFIED, static constants)

**Analog:** Itself — append a Phase 23 block at end of file (after line 398 — the Phase 22 `RESTORE_NOTE_SYSTEM_TEXT` constant).

**Block append pattern** (analog copy.ts:186-194 Phase 21 block header; copy.ts:313-321 Phase 22 block header):
```typescript
// ================================================================
// Phase 23 — production stats copy
// (UI-SPEC §"Copywriting Contract" — verbatim named-constant exports)
//
// All Phase 23 surfaces — <ProgressBar/>, the new stats subrow inside
// <SequenceHeader/>, and the new stale aria-suffix on <ShotGridCard/> —
// import from this block. Zero inline string literals in component files
// (architectural rule).
// ================================================================

// ---------- ProgressBar (% approved) ----------

/** Caller concatenates: `${PREFIX}${sequenceName}` for the aria-label. */
export const STATS_PROGRESS_ARIA_PREFIX = 'Approval progress for ';

/** Caller renders: `${pct}${SUFFIX}` for the visible label, e.g. '60% approved'. */
export const STATS_APPROVED_LABEL_SUFFIX = '% approved';

// ---------- Backlog callout (pending-review) ----------

/** Singular form (n === 1). Both forms identical for verb-noun phrasing. */
export const STATS_BACKLOG_CALLOUT_SINGULAR = 'awaiting review';
export const STATS_BACKLOG_CALLOUT_PLURAL = 'awaiting review';

/** Caller concatenates: `${PREFIX}${n} ${noun}` for SR-friendly aria-label. */
export const STATS_BACKLOG_CALLOUT_ARIA_PREFIX = 'Pending review backlog: ';

// ---------- Inline stale count ----------

export const STATS_STALE_INLINE_SINGULAR = 'stale';
export const STATS_STALE_INLINE_PLURAL = 'stale';

/** Caller concatenates: `${PREFIX}${n}` for SR-friendly aria-label. */
export const STATS_STALE_INLINE_ARIA_PREFIX = 'Stale shots: ';

// ---------- Per-shot stale indicator ARIA suffix ----------

/** Appended to the existing SHOT_CARD_OPEN_ARIA_PREFIX when shot.is_stale === true. */
export const SHOT_CARD_STALE_ARIA_SUFFIX = ' — stale';
```
*Mirrors the Phase 22 block header exactly — section comment with block boundary, sub-section dividers using `// ---------- Section ----------`, jsdoc per constant, verbatim string values from UI-SPEC §"Copywriting Contract".*

**Singular/plural pairing pattern** (analog copy.ts:235-238 — Phase 21 `SHOT_CARD_VERSION_COUNT_SINGULAR / PLURAL_SUFFIX`):
The mini-pill row uses singular/plural pairs even when grammatically identical (English: "1 stale" / "3 stale") — kept as TWO constants per UI-SPEC line 219 for future i18n and to mirror the existing precedent.

---

### 8. `packages/dashboard/src/styles/theme.css` (MODIFIED, static CSS)

**Analog:** Itself — Phase 21 added 5 `--color-shot-status-*` tokens to both light (lines 114-119) and dark (lines 53-58) blocks. Phase 23 adds 1 token following the same dual-block pattern.

**Token addition pattern** (analog theme.css:53-58 dark + theme.css:114-119 light):
```css
/* Dark block — INSIDE @theme {} (after line 58 — Phase 23 stale border). */
/* ===== Phase 23 — sequence stats. WCAG 2.1 AA UI-component ≥ 3:1 vs --color-bg. ===== */
--color-shot-stale: #f97316;  /* orange-500 — DISTINCT from pending-review amber per D-08 */

/* Light block — INSIDE [data-theme="light"] {} (after line 119). */
/* ===== Phase 23 — light-theme stale border (4.62:1 vs #fafafa per UI-SPEC L122). ===== */
--color-shot-stale: #b45309;  /* amber-700 — passes 4.62:1 vs #fafafa; distinct from pending-review #d97706 */
```
*Mirrors the existing Phase 21 5-token block — section comment header with WCAG note, hex literal + alignment, inline color-name + rationale comment.*

**Pitfall 6 enforcement:** Both blocks MUST be patched in the same commit. UI-SPEC line 157 mandates a snapshot test asserting both lines exist (test belongs in a new `theme.css.test.ts` or appended to the existing `architecture-purity.test.ts`).

**Token NOT added:** `--color-stats-backlog-callout` is DEFERRED (UI-SPEC §"Color" Open Question 1). The backlog callout reuses `--color-accent` directly.

---

### 9. `src/store/shot-status-repo.ts` (MODIFIED, request-response DB read)

**Analog:** Itself — extend `listShotsForGrid` (lines 228-285) with an inline `is_stale` CASE expression; add a NEW `getSequenceStats(db, sequenceId)` function alongside it.

**Inline CASE for is_stale pattern** (analog shot-status-repo.ts:246-273 — existing CTE + outer SELECT):
```typescript
// MODIFY the existing rows query (line 246) — add is_stale to the SELECT.
const rows = db.all(sql`
  WITH ranked AS (
    SELECT v.id, v.shot_id, v.completed_at,
      ROW_NUMBER() OVER (
        PARTITION BY v.shot_id
        ORDER BY v.completed_at DESC, v.id ASC
      ) AS rn
    FROM versions v
    WHERE v.status = 'completed' AND v.completed_at IS NOT NULL
  )
  SELECT
    s.id        AS id,
    s.name      AS name,
    s.status    AS status,
    (SELECT COUNT(*) FROM versions vc WHERE vc.shot_id = s.id) AS version_count,
    r.id           AS lcv_id,
    r.completed_at AS lcv_completed_at,
    -- Phase 23 — D-03 + D-15 inline is_stale (no extra query).
    -- Per OVR-02 + D-15 pragmatic: status IN ('wip','pending-review') AND
    -- latest completed version exists AND it's older than 14 days.
    -- Zero-version shots fall out (r.completed_at IS NULL → CASE returns 0).
    CASE
      WHEN s.status IN ('wip','pending-review')
        AND r.completed_at IS NOT NULL
        AND r.completed_at < ${Date.now() - STALE_SHOT_DAYS * 86_400_000}
      THEN 1 ELSE 0
    END AS is_stale
  FROM shots s
  LEFT JOIN ranked r ON r.shot_id = s.id AND r.rn = 1
  WHERE s.sequence_id = ${sequenceId}
    AND (
      ${cursorName} IS NULL
      OR s.name > ${cursorName}
      OR (s.name = ${cursorName} AND s.id > ${cursorSid})
    )
  ORDER BY s.name ASC, s.id ASC
  LIMIT ${limit + 1}
`) as ShotGridQueryRow[];
```
*Adds 1 new column to the existing CTE outer SELECT — leverages the same `LEFT JOIN ranked` (no extra query). CASE returns integer 0/1; engine facade maps to `Boolean(r.is_stale)`. The `Date.now() - STALE_SHOT_DAYS * 86_400_000` cutoff is computed in JS and bound as a parameter (Drizzle `sql\`\`` tagged template handles this).*

**ShotGridQueryRow type extension** (analog shot-status-repo.ts:186-193):
```typescript
export interface ShotGridQueryRow {
  id: string;
  name: string;
  status: ShotStatus;
  version_count: number;
  lcv_id: string | null;
  lcv_completed_at: number | null;
  /** Phase 23 — D-03. SQLite returns 0/1 for CASE expressions; engine maps to boolean. */
  is_stale: number;
}
```

**New `getSequenceStats` function pattern** (analog version-repo.ts:235 — `COUNT(*)` single-row query; shot-status-repo.ts:236-240 — existing total_count COUNT):
```typescript
/**
 * Phase 23 — D-02 + D-14 + D-15. Whole-sequence stats for the dashboard
 * `<SequenceHeader/>` subrow. TWO queries:
 *   Q1: GROUP BY status — per-status counts (uses idx_shots_status covering
 *       index from drizzle/0008_shot_status.sql:25).
 *   Q2: COUNT(*) WHERE EXISTS — stale_count (uses idx_shots_status +
 *       versions.shot_id autoindex).
 *
 * NO per-row subquery; EXPLAIN QUERY PLAN test asserts the planner picks
 * the covering index (mirrors shot-status-repo-grid.test.ts:88-109 lock).
 *
 * approved_pct is computed in TypeScript at the engine layer (D-14) — NOT
 * here; this function returns raw counts. Throws nothing — for unknown
 * sequenceId returns `{ total: 0, counts: {...all zero}, stale_count: 0 }`
 * (the engine layer throws SEQUENCE_NOT_FOUND via the sibling getSequence
 * lookup; see pipeline.ts:842).
 */
export interface SequenceStatsRaw {
  total: number;
  counts: Record<ShotStatus, number>;
  stale_count: number;
}

export function getSequenceStats(db: Db, sequenceId: string): SequenceStatsRaw {
  // Q1: per-status GROUP BY.
  const countRows = db.all(sql`
    SELECT status, COUNT(*) AS c
    FROM shots
    WHERE sequence_id = ${sequenceId}
    GROUP BY status
  `) as Array<{ status: ShotStatus; c: number }>;

  // Initialize all 5 statuses at 0 — GROUP BY only emits non-empty buckets.
  const counts: Record<ShotStatus, number> = {
    'wip': 0,
    'pending-review': 0,
    'approved': 0,
    'on-hold': 0,
    'omit': 0,
  };
  let total = 0;
  for (const row of countRows) {
    counts[row.status] = Number(row.c);
    total += Number(row.c);
  }

  // Q2: stale_count via EXISTS — D-15 pragmatic (zero-version shots excluded).
  const cutoff = Date.now() - STALE_SHOT_DAYS * 86_400_000;
  const staleRow = db
    .select({ c: sql<number>`COUNT(*)` })
    .from(shots)
    .where(sql`
      shots.sequence_id = ${sequenceId}
      AND shots.status IN ('wip','pending-review')
      AND EXISTS (
        SELECT 1 FROM versions v
        WHERE v.shot_id = shots.id
          AND v.status = 'completed'
          AND v.completed_at IS NOT NULL
          AND v.completed_at < ${cutoff}
      )
    `)
    .get();

  return {
    total,
    counts,
    stale_count: Number(staleRow?.c ?? 0),
  };
}

/**
 * Returns the EXACT raw SQL text used by getSequenceStats Q2 (with `?`
 * placeholders) for the EXPLAIN QUERY PLAN test. Mirrors
 * listShotsForGridSqlText (line 301) so test introspection doesn't
 * duplicate SQL strings.
 *
 * Placeholder order (2 binds): 1. sequenceId, 2. cutoff (epoch ms).
 */
export function getSequenceStatsStaleSqlText(): string {
  return /* sql */ `
    SELECT COUNT(*) AS c
    FROM shots
    WHERE shots.sequence_id = ?
      AND shots.status IN ('wip','pending-review')
      AND EXISTS (
        SELECT 1 FROM versions v
        WHERE v.shot_id = shots.id
          AND v.status = 'completed'
          AND v.completed_at IS NOT NULL
          AND v.completed_at < ?
      )
  `;
}
```
*Mirrors the existing `listShotsForGridSqlText` (line 301) precedent — `getSequenceStatsStaleSqlText()` exposes the verbatim SQL so the EXPLAIN test can introspect without duplicating strings. The `db.select().from(shots).where(sql\`\`).get()` pattern is reused from shot-status-repo.ts:236-240 + version-repo.ts:235.*

---

### 10. `src/engine/pipeline.ts` (MODIFIED, request-response compose)

**Analog:** Itself — extend the existing `listShotGrid` facade at lines 822-874.

**Facade extension pattern** (analog pipeline.ts:840-874 — existing facade body):
```typescript
listShotGrid(
  sequenceId: string,
  opts: { cursor: ShotGridCursor | null; limit: number },
): {
  sequence: { id: string; name: string };
  shots: Array<{
    id: string;
    name: string;
    status: ShotStatus;
    version_count: number;
    is_stale: boolean;  // NEW Phase 23
    latest_completed_version: {
      id: string;
      thumbnail_url: string;
      completed_at: number;
    } | null;
  }>;
  stats: SequenceStats;  // NEW Phase 23
  next_cursor: string | null;
  total_count: number;
} {
  const sequence = this.repo.getSequence(sequenceId);
  if (!sequence) {
    throw new TypedError(
      'SEQUENCE_NOT_FOUND',
      `Sequence '${sequenceId}' not found`,
      `List sequences with { tool: 'sequence', action: 'list' }`,
    );
  }

  const { items, next_cursor, total_count } = listShotsForGrid(
    this.db,
    sequenceId,
    opts,
  );

  // Phase 23 — compose raw stats from the repo layer.
  const rawStats = getSequenceStats(this.db, sequenceId);

  const shots = items.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    version_count: r.version_count,
    is_stale: Boolean(r.is_stale),  // NEW Phase 23 — SQLite CASE returns 0/1
    latest_completed_version:
      r.lcv_id !== null && r.lcv_completed_at !== null
        ? {
            id: r.lcv_id,
            thumbnail_url: `/api/versions/${encodeURIComponent(r.lcv_id)}/thumbnail`,
            completed_at: r.lcv_completed_at,
          }
        : null,
  }));

  // Phase 23 — D-14: approved_pct in TypeScript (NOT SQL) for division-
  // by-zero clarity. counts['approved'] guaranteed present per
  // getSequenceStats initializer at shot-status-repo.ts:[Phase 23 lines].
  const approvedCount = rawStats.counts.approved;
  const approved_pct =
    rawStats.total === 0
      ? 0
      : Math.round((approvedCount / rawStats.total) * 100);

  const stats: SequenceStats = {
    total: rawStats.total,
    approved_pct,
    counts: rawStats.counts,
    pending_review_backlog: rawStats.counts['pending-review'],
    stale_count: rawStats.stale_count,
  };

  return {
    sequence: { id: sequence.id, name: sequence.name },
    shots,
    stats,
    next_cursor,
    total_count,
  };
}
```
*Mirrors the existing facade verbatim — same `if (!sequence) throw TypedError` guard, same `items.map(r => ({ ... }))` re-shape, same `return { sequence, shots, ... }` envelope shape. The new logic is additive: one call to `getSequenceStats`, one boolean cast in the row map, one compose block before the return.*

**Import additions** (anchor — existing pipeline.ts imports):
```typescript
import {
  listShotsForGrid,
  getSequenceStats,  // NEW Phase 23
  type ShotGridCursor,
} from '../store/shot-status-repo.js';
import type { SequenceStats } from '../types/something.js'; // OR inline shape — match existing dashboard
```
*The `SequenceStats` interface lives in `packages/dashboard/src/types/shot-grid.ts` per CONTEXT D-02. The server pipeline either imports it (if cross-tree imports are allowed; check architecture-purity.test.ts) OR inlines the shape in the return type signature. Verify via `Grep("import.*packages/dashboard", "src/engine")` before deciding.*

---

### 11. `src/http/dashboard-routes.ts` (MODIFIED — response envelope grows; signature unchanged)

**Analog:** Itself — lines 370-375. The handler is already thin (`return c.json(engine.listShotGrid(...))`). No code change; the wider response shape flows through verbatim.

**Pattern preserved** (analog dashboard-routes.ts:370-375):
```typescript
app.get('/api/sequences/:id/shot-grid', (c) => {
  const sequenceId = c.req.param('id');
  const limit = qNum(c.req.query('limit'), 20, 'limit');
  const cursor = parseShotGridCursorParam(c.req.query('cursor'));
  return c.json(engine.listShotGrid(sequenceId, { cursor, limit }));
});
```
*Zero code change — Hono's `c.json()` serializes whatever object the engine returns. The new `stats` field + per-row `is_stale` are emitted automatically. The thin-handler discipline (CLAUDE.md "Tool-engine separation") is preserved.*

---

### 12. `src/store/__tests__/shot-status-repo-stats.test.ts` (NEW, EXPLAIN-driven SQL test)

**Analog:** `src/store/__tests__/shot-status-repo-grid.test.ts` (Phase 21 — verbatim EXPLAIN QUERY PLAN harness + fixture pattern).

**Fixture pattern** (analog shot-status-repo-grid.test.ts:1-50):
```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb, type TestDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { VersionRepo } from '../version-repo.js';
import {
  getSequenceStats,
  getSequenceStatsStaleSqlText,
  STALE_SHOT_DAYS,
} from '../shot-status-repo.js';

let testDb: TestDb;
let hierarchy: HierarchyRepo;
let versionRepo: VersionRepo;
let sequenceId: string;

beforeEach(() => {
  testDb = makeInMemoryDb();
  hierarchy = new HierarchyRepo(testDb.db);
  versionRepo = new VersionRepo(testDb.db);
  const ws = hierarchy.createWorkspace(`ws-stats-${Date.now()}`);
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  sequenceId = seq.id;
});
```
*Mirrors lines 37-50 verbatim — fresh in-memory DB + HierarchyRepo seeding per test; `hierarchy.createShot(sequenceId, 'sh010')` for shot creation (NOT raw INSERT — comment at line 29-31 documents the landmine).*

**EXPLAIN QUERY PLAN test pattern** (analog shot-status-repo-grid.test.ts:88-109):
```typescript
describe('getSequenceStats — EXPLAIN QUERY PLAN (no per-row subquery)', () => {
  beforeEach(() => {
    // Seed 5 shots so the planner picks a representative path.
    for (let i = 0; i < 5; i++) {
      const name = `sh${String((i + 1) * 10).padStart(3, '0')}`;
      hierarchy.createShot(sequenceId, name);
    }
  });

  test('stale-count query plan uses idx_shots_status (no SCAN shots)', () => {
    const cutoff = Date.now() - STALE_SHOT_DAYS * 86_400_000;
    const planRows = testDb.sqlite
      .prepare('EXPLAIN QUERY PLAN ' + getSequenceStatsStaleSqlText())
      .all(sequenceId, cutoff) as Array<{ detail: string }>;
    // Whitelist phrasing: planner output must reference USING INDEX
    // idx_shots_status OR SEARCH shots USING (the covering index).
    const usesIndex = planRows.some(
      (r) =>
        r.detail.includes('idx_shots_status') ||
        r.detail.includes('SEARCH shots'),
    );
    expect(usesIndex).toBe(true);
    // Anti-pattern: no full table SCAN on shots.
    const fullScan = planRows.filter((r) => r.detail.startsWith('SCAN shots'));
    expect(fullScan).toEqual([]);
  });
});
```
*Mirrors the verbatim EXPLAIN harness — `testDb.sqlite.prepare('EXPLAIN QUERY PLAN ' + sqlText).all(...binds)` with exact arg count matching placeholders. The whitelist phrasing logic is the same shape as line 92-95 (filter on `detail` substring).*

**Behavior test patterns** (analog shot-status-repo-grid.test.ts:112-203 — multiple describe blocks):
```typescript
describe('getSequenceStats — GROUP BY counts', () => {
  test('5 shots all-wip return counts.wip=5, total=5, others=0', () => {
    for (let i = 0; i < 5; i++) {
      hierarchy.createShot(sequenceId, `sh${String((i + 1) * 10).padStart(3, '0')}`);
    }
    const result = getSequenceStats(testDb.db, sequenceId);
    expect(result.total).toBe(5);
    expect(result.counts.wip).toBe(5);
    expect(result.counts.approved).toBe(0);
    expect(result.stale_count).toBe(0);
  });
});

describe('getSequenceStats — stale_count semantics', () => {
  test('shot with completed version > 14d old AND status=wip is stale', () => { /* ... */ });
  test('shot with completed version > 14d old AND status=approved is NOT stale (D-15 + OVR-02)', () => { /* ... */ });
  test('shot with zero completed versions is NOT stale (D-15 pragmatic)', () => { /* ... */ });
  test('shot with completed version < 14d old is NOT stale', () => { /* ... */ });
});
```
*Mirrors describe-block-per-property structure. Each test seeds a known fixture + asserts the return shape. Time manipulation uses the same `Date.now()` + busy-wait pattern at lines 132-141 if needed for the < 14d / > 14d cases.*

---

### 13. `packages/dashboard/src/components/__tests__/SequenceHeader.stats.test.tsx` (NEW, render assertion)

**Analog:** `packages/dashboard/src/components/__tests__/SequenceHeader.test.tsx` (Phase 21 — verbatim render-assertion harness).

**Fixture pattern** (analog SequenceHeader.test.tsx:1-48):
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { SequenceHeader } from '../SequenceHeader.js';
import type { ShotStatus, SequenceStats } from '../../types/shot-grid.js';

afterEach(() => cleanup());

interface RenderOpts {
  sequenceName?: string;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  counts?: Record<ShotStatus, number>;
  stats?: SequenceStats | null;
}

function buildStats(overrides: Partial<SequenceStats> = {}): SequenceStats {
  return {
    total: 20,
    approved_pct: 60,
    counts: { wip: 5, 'pending-review': 3, approved: 12, 'on-hold': 0, omit: 0 },
    pending_review_backlog: 3,
    stale_count: 1,
    ...overrides,
  };
}

function renderHeader(opts: RenderOpts = {}) {
  const {
    sequenceName = 'SEQ_010',
    expanded = true,
    onToggleExpanded = vi.fn(),
    counts = { wip: 5, 'pending-review': 3, approved: 12, 'on-hold': 1, omit: 2 },
    stats = buildStats(),
  } = opts;
  return render(
    <SequenceHeader
      sequenceName={sequenceName}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      counts={counts}
      stats={stats}
    />,
  );
}
```
*Mirrors lines 1-48 verbatim — same `RenderOpts` shape, same `renderHeader` helper pattern, `buildStats` factory mirrors the `ShotGridCard.test.tsx:26-39 buildShot` pattern.*

**Render assertion patterns** (analog SequenceHeader.test.tsx:50-119):
```typescript
describe('SequenceHeader — stats subrow (Phase 23 GRID-23)', () => {
  it('renders ProgressBar with aria-valuenow={approved_pct}', () => {
    const { container } = renderHeader({ stats: buildStats({ approved_pct: 60 }) });
    const bar = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-label')).toBe('Approval progress for SEQ_010');
  });

  it('backlog callout renders when pending_review_backlog > 0', () => {
    const { container } = renderHeader({
      stats: buildStats({ pending_review_backlog: 3 }),
    });
    const callout = container.querySelector('[role="status"]') as HTMLElement;
    expect(callout).toBeTruthy();
    expect(callout.getAttribute('aria-label')).toBe(
      'Pending review backlog: 3 awaiting review',
    );
    expect(callout.textContent).toContain('3');
    expect(callout.textContent?.toLowerCase()).toContain('awaiting review');
  });

  it('backlog callout HIDDEN when pending_review_backlog === 0 (D-20)', () => {
    const { container } = renderHeader({
      stats: buildStats({ pending_review_backlog: 0 }),
    });
    const callout = container.querySelector('[role="status"]');
    expect(callout).toBeFalsy();
  });

  it('stale-count inline HIDDEN when stale_count === 0', () => {
    const { container } = renderHeader({ stats: buildStats({ stale_count: 0 }) });
    expect(container.textContent?.toLowerCase()).not.toContain('stale');
  });

  it('subrow HIDDEN when stats === null', () => {
    const { container } = renderHeader({ stats: null });
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toBeFalsy();
  });

  it('subrow HIDDEN when stats.total === 0', () => {
    const { container } = renderHeader({ stats: buildStats({ total: 0 }) });
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toBeFalsy();
  });
});
```
*Mirrors line 50-118 describe block structure — single it-per-property; selector via `container.querySelector(...)`; attribute assertions via `getAttribute(...)`. The hide-on-zero pattern matches the existing line 122-145 hide-on-zero tests for mini-pills verbatim.*

---

### 14. `packages/dashboard/src/components/__tests__/ShotGridCard.stale.test.tsx` (NEW, render assertion)

**Analog:** `packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` (Phase 21 — verbatim render-assertion harness; `buildShot` helper at line 26-39).

**Fixture extension** (analog ShotGridCard.test.tsx:26-39):
```typescript
function buildShot(overrides: Partial<ShotGridRow> = {}): ShotGridRow {
  return {
    id: 'shot_1',
    name: 'sh010',
    status: 'approved',
    version_count: 3,
    is_stale: false,  // NEW Phase 23 — default false; tests opt in via overrides
    latest_completed_version: {
      id: 'ver_abc',
      thumbnail_url: '/api/versions/ver_abc/thumbnail',
      completed_at: Date.now() - 60_000,
    },
    ...overrides,
  };
}
```

**Stale-border render assertions** (analog ShotGridCard.test.tsx:78-90 — existing `omit` class-on-wrapper test):
```typescript
describe('ShotGridCard — stale border (Phase 23)', () => {
  it('outer div has amber border class when is_stale === true', () => {
    const { container } = render(
      <ShotGridCard shot={buildShot({ is_stale: true })} onSelect={vi.fn()} />,
    );
    const outer = container.querySelector('.group.relative') as HTMLElement;
    expect(outer).toBeTruthy();
    expect(outer.className).toContain('border-2');
    expect(outer.className).toContain('border-[var(--color-shot-stale)]');
  });

  it('outer div has NO border class when is_stale === false', () => {
    const { container } = render(
      <ShotGridCard shot={buildShot({ is_stale: false })} onSelect={vi.fn()} />,
    );
    const outer = container.querySelector('.group.relative') as HTMLElement;
    expect(outer.className).not.toContain('border-2');
    expect(outer.className).not.toContain('border-[var(--color-shot-stale)]');
  });

  it('thumbnail button aria-label appends " — stale" suffix when is_stale === true', () => {
    const { container } = render(
      <ShotGridCard
        shot={buildShot({ is_stale: true, name: 'SH_020' })}
        onSelect={vi.fn()}
      />,
    );
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe(
      'Open version drawer for SH_020 — stale',
    );
  });

  it('omit shot is never stale (per OVR-02) — coexistence-safety asserted', () => {
    // Defensive: even if a buggy server emits is_stale=true for an omit shot,
    // the opacity-40 wrapper is still applied (border + opacity-40 both render).
    const { container } = render(
      <ShotGridCard
        shot={buildShot({ status: 'omit', is_stale: true })}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector('.opacity-40')).toBeTruthy();
    // The border class is on the INNER cardBody, not the omit wrapper.
    const inner = container.querySelector('.opacity-40 > .group.relative');
    expect(inner?.className).toContain('border-2');
  });
});
```
*Mirrors the existing class-on-wrapper test shape (line 78-90 — `container.querySelector('.opacity-40')` → assert truthy/falsy). The aria-label assertion mirrors line 105-111 of SequenceHeader.test.tsx (composed aria-label verbatim equality).*

---

### 15. `packages/dashboard/src/state/__tests__/shot-grid-stats-delta.test.ts` (NEW, event → signal)

**Analog:** `packages/dashboard/src/state/__tests__/shot-grid.test.ts` (Phase 21 — verbatim `onShotStatusChanged` harness; module-singleton signal reset at lines 59-67).

**Fixture extension** (analog shot-grid.test.ts:35-67):
```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  sequenceStats,
  shotGrid,
  selectedSequenceForGrid,
  statusFilter,
  showOmitted,
  activeView,
  onShotStatusChanged,
} from '../shot-grid.js';
import type { ShotGridResponse, SequenceStats } from '../../types/shot-grid.js';

function seedStats(overrides: Partial<SequenceStats> = {}): SequenceStats {
  return {
    total: 5,
    approved_pct: 0,
    counts: { wip: 5, 'pending-review': 0, approved: 0, 'on-hold': 0, omit: 0 },
    pending_review_backlog: 0,
    stale_count: 0,
    ...overrides,
  };
}

function seedShotGrid(): ShotGridResponse {
  return {
    sequence: { id: 'seq_1', name: 'SEQ_010' },
    shots: [
      {
        id: 'shot_1',
        name: 'sh010',
        status: 'wip',
        version_count: 0,
        is_stale: false,
        latest_completed_version: null,
      },
      {
        id: 'shot_2',
        name: 'sh020',
        status: 'wip',
        version_count: 0,
        is_stale: false,
        latest_completed_version: null,
      },
    ],
    stats: seedStats(),
    next_cursor: null,
    total_count: 2,
  };
}

beforeEach(() => {
  // Module-singleton reset — PATTERNS §14 landmine guard
  activeView.value = 'home';
  selectedSequenceForGrid.value = null;
  shotGrid.value = null;
  sequenceStats.value = null;  // NEW Phase 23
  statusFilter.value = 'all';
  showOmitted.value = false;
  window.history.replaceState(null, '', '/');
});
```
*Mirrors the existing reset block — every new signal MUST be reset in beforeEach (Phase 21 PATTERNS §14 landmine: signal state leaks across tests at module scope).*

**Stats delta test patterns** (analog shot-grid.test.ts:73-138 — existing `onShotStatusChanged` test block):
```typescript
describe('onShotStatusChanged — stats delta (Phase 23)', () => {
  it('wip → approved decrements counts.wip and increments counts.approved', () => {
    shotGrid.value = seedShotGrid();
    sequenceStats.value = seedStats();  // 5 wip / 0 approved / total 5

    onShotStatusChanged({
      shotId: 'shot_1',
      sequenceId: 'seq_1',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });

    expect(sequenceStats.value!.counts.wip).toBe(4);
    expect(sequenceStats.value!.counts.approved).toBe(1);
    expect(sequenceStats.value!.approved_pct).toBe(20); // 1/5
  });

  it('cross-sequence event leaves sequenceStats unchanged (Pitfall 1)', () => {
    shotGrid.value = seedShotGrid();
    sequenceStats.value = seedStats();
    const before = sequenceStats.value;

    onShotStatusChanged({
      shotId: 'shot_1',
      sequenceId: 'seq_DIFFERENT',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });

    expect(sequenceStats.value).toBe(before);
  });

  it('null fromStatus defaults to "wip" (Pitfall 2)', () => {
    shotGrid.value = seedShotGrid();
    sequenceStats.value = seedStats();

    onShotStatusChanged({
      shotId: 'shot_1',
      sequenceId: 'seq_1',
      fromStatus: null,
      toStatus: 'approved',
      changedBy: 'user',
    });

    expect(sequenceStats.value!.counts.wip).toBe(4);
    expect(sequenceStats.value!.counts.approved).toBe(1);
  });

  it('shot outside paginated buffer leaves stale_count unchanged (D-19 / Pitfall 3)', () => {
    shotGrid.value = seedShotGrid();
    sequenceStats.value = seedStats({ stale_count: 3 });

    onShotStatusChanged({
      shotId: 'shot_NOT_IN_BUFFER',
      sequenceId: 'seq_1',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });

    // counts still mutate (we don't need the shot to update counts);
    // stale_count stays at 3 because we can't compute the delta without
    // knowing the shot's prior is_stale + completed_at.
    expect(sequenceStats.value!.stale_count).toBe(3);
  });

  it('sequenceStats===null is a no-op (Pitfall 9)', () => {
    shotGrid.value = seedShotGrid();
    sequenceStats.value = null;

    expect(() =>
      onShotStatusChanged({
        shotId: 'shot_1',
        sequenceId: 'seq_1',
        fromStatus: 'wip',
        toStatus: 'approved',
        changedBy: 'user',
      }),
    ).not.toThrow();
    expect(sequenceStats.value).toBe(null);
  });

  it('counts decrement clamps at 0 (defensive — Pitfall 1)', () => {
    shotGrid.value = seedShotGrid();
    sequenceStats.value = seedStats({
      counts: { wip: 0, 'pending-review': 0, approved: 0, 'on-hold': 0, omit: 0 },
    });

    onShotStatusChanged({
      shotId: 'shot_1',
      sequenceId: 'seq_1',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });

    expect(sequenceStats.value!.counts.wip).toBe(0); // clamped, not -1
  });
});
```
*Mirrors the existing test-block-per-pitfall pattern (shot-grid.test.ts:73-138). Each Pitfall from CONTEXT/RESEARCH gets a dedicated test. The `beforeEach` reset pattern is the established Phase 21 landmine guard.*

---

### 16. `src/http/__tests__/dashboard-routes-shot-grid.test.ts` (EXTENDED in place)

**Analog:** Itself — the existing Phase 21 file at lines 1-150.

**Pattern: add 2 new tests to the existing describe block** (analog dashboard-routes-shot-grid.test.ts:65-99):
```typescript
// Add to EMPTY_GRID_RESPONSE fixture at lines 48-63:
const EMPTY_GRID_RESPONSE = {
  sequence: { id: 'seq_1', name: 'SEQ_010' },
  shots: [] as Array<{ /* ... existing ... */
    is_stale: boolean; // NEW Phase 23
    latest_completed_version: /* ... */;
  }>,
  // NEW Phase 23 — stats envelope field
  stats: {
    total: 0,
    approved_pct: 0,
    counts: { wip: 0, 'pending-review': 0, approved: 0, 'on-hold': 0, omit: 0 },
    pending_review_backlog: 0,
    stale_count: 0,
  },
  next_cursor: null as string | null,
  total_count: 0,
};

it('response envelope includes top-level stats field (Phase 23)', async () => {
  (engine as unknown as { listShotGrid: unknown }).listShotGrid = ((
    seqId: string,
    opts: { cursor: unknown; limit: number },
  ) => {
    engine.calls.push({ method: 'listShotGrid', args: [seqId, opts] });
    return {
      ...EMPTY_GRID_RESPONSE,
      sequence: { id: seqId, name: 'SEQ_010' },
      stats: {
        total: 10,
        approved_pct: 60,
        counts: { wip: 4, 'pending-review': 0, approved: 6, 'on-hold': 0, omit: 0 },
        pending_review_backlog: 0,
        stale_count: 2,
      },
    };
  }) as never;
  const app = buildApp(engine);

  const res = await app.request('/api/sequences/seq_1/shot-grid');

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('stats');
  expect(body.stats).toEqual({
    total: 10,
    approved_pct: 60,
    counts: { wip: 4, 'pending-review': 0, approved: 6, 'on-hold': 0, omit: 0 },
    pending_review_backlog: 0,
    stale_count: 2,
  });
});

it('shot rows include per-row is_stale field (Phase 23)', async () => {
  (engine as unknown as { listShotGrid: unknown }).listShotGrid = ((
    seqId: string,
    opts: { cursor: unknown; limit: number },
  ) => {
    engine.calls.push({ method: 'listShotGrid', args: [seqId, opts] });
    return {
      ...EMPTY_GRID_RESPONSE,
      sequence: { id: seqId, name: 'SEQ_010' },
      shots: [
        {
          id: 'shot_1',
          name: 'sh010',
          status: 'wip' as const,
          version_count: 1,
          is_stale: true,
          latest_completed_version: {
            id: 'ver_old',
            thumbnail_url: '/api/versions/ver_old/thumbnail',
            completed_at: Date.now() - 30 * 86_400_000,
          },
        },
      ],
    };
  }) as never;
  const app = buildApp(engine);

  const res = await app.request('/api/sequences/seq_1/shot-grid');

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.shots[0]).toHaveProperty('is_stale');
  expect(body.shots[0].is_stale).toBe(true);
});
```
*Mirrors the existing FakeEngine override pattern verbatim — `(engine as unknown as { listShotGrid: unknown }).listShotGrid = ((seqId, opts) => { ... }) as never;`. The new tests slot into the existing `describe('GET /api/sequences/:id/shot-grid (GRID-04)')` block.*

---

## Shared Patterns

### Snake_case envelope fields (apply to all server → wire types)

**Source:** `packages/dashboard/src/types/shot-grid.ts:11-14` (existing convention comment)

**Apply to:** `SequenceStats` (`approved_pct`, `pending_review_backlog`, `stale_count`), `ShotGridRow.is_stale`.

```typescript
// Field-naming convention: snake_case for envelope-level pagination fields
// (`next_cursor`, `total_count`, `version_count`, `latest_completed_version`,
// `thumbnail_url`, `completed_at`) — mirrors PaginatedVersionsResponse at
// src/lib/api.ts:209-215 and the existing server convention. CamelCase is
// reserved for SSE wire-shape payloads (see events.ts).
```

### Module-singleton signal reset (apply to all state tests)

**Source:** `packages/dashboard/src/state/__tests__/shot-grid.test.ts:59-67`

**Apply to:** Every new test file that touches `sequenceStats` signal.

```typescript
beforeEach(() => {
  // Module-singleton reset — PATTERNS §14 landmine guard
  // Without this, one test's mutations leak into the next because
  // @preact/signals instances live at module scope.
  activeView.value = 'home';
  selectedSequenceForGrid.value = null;
  shotGrid.value = null;
  sequenceStats.value = null;
  statusFilter.value = 'all';
  showOmitted.value = false;
  window.history.replaceState(null, '', '/');
});
```

### EXPLAIN QUERY PLAN harness (apply to all repo SQL tests)

**Source:** `src/store/__tests__/shot-status-repo-grid.test.ts:88-109`

**Apply to:** New `shot-status-repo-stats.test.ts` (EXPLAIN test for `getSequenceStatsStaleSqlText`).

```typescript
const planRows = testDb.sqlite
  .prepare('EXPLAIN QUERY PLAN ' + getSequenceStatsStaleSqlText())
  .all(sequenceId, cutoff) as Array<{ detail: string }>;
const usesIndex = planRows.some((r) => r.detail.includes('idx_shots_status'));
expect(usesIndex).toBe(true);
```

### Hide-on-zero rule (apply to all stats subrow elements)

**Source:** `packages/dashboard/src/components/SequenceHeader.tsx:94-99` (existing mini-pill `if (n === 0) return null`)

**Apply to:** Backlog callout pill (hidden when `pending_review_backlog === 0`); inline stale-count text (hidden when `stale_count === 0`); entire subrow (hidden when `stats === null || stats.total === 0`).

```typescript
{condition && (
  /* render element */
)}
```

### Architecture-purity (apply to ALL dashboard files)

**Source:** `packages/dashboard/src/types/shot-grid.ts:1-15` + `state/shot-grid.ts:11-15`

**Apply to:** Every new/modified dashboard file. **Forbidden:** any `import from '../../../src/'` traversal into the server tree. All dashboard files import only sibling modules under `packages/dashboard/src/` plus `@preact/signals`, `zod`, `lucide-preact`, `preact`, and `@testing-library/preact`. The architecture-purity test asserts this via grep.

### Verbatim copy-constant exports (apply to all user-facing strings)

**Source:** `packages/dashboard/src/lib/copy.ts:313-321` (Phase 22 block header comment — "Zero inline string literals in component files (architectural rule)")

**Apply to:** Every Phase 23 user-facing string. New component files import from `lib/copy.js`; tests assert constant-name equality (not raw literals). The 9 Phase 23 constants (per UI-SPEC §"Copywriting Contract") land in a single block at end of file.

---

## No Analog Found

None. Every Phase 23 file has a direct precedent in Phase 17-22 work. This is a pure-composition phase — the primary "creative" work is the `<ProgressBar/>` primitive, and even that mirrors `<WarningPill/>` structurally (pure component, props-in/no-callbacks, rounded outer + saturated inner + Tailwind utility class string).

---

## Metadata

**Analog search scope:**
- `packages/dashboard/src/components/` (1 NEW analog, 2 MODIFIED analogs)
- `packages/dashboard/src/state/` (1 MODIFIED analog)
- `packages/dashboard/src/types/` (1 MODIFIED analog)
- `packages/dashboard/src/views/` (1 MODIFIED analog)
- `packages/dashboard/src/lib/` (1 MODIFIED analog — copy.ts)
- `packages/dashboard/src/styles/` (1 MODIFIED analog — theme.css)
- `src/store/` (1 MODIFIED analog — shot-status-repo.ts)
- `src/engine/` (1 MODIFIED analog — pipeline.ts)
- `src/http/` (1 MODIFIED analog — dashboard-routes.ts)
- `src/store/__tests__/` (1 NEW analog)
- `src/http/__tests__/` (1 EXTENDED in place)
- `packages/dashboard/src/components/__tests__/` (2 NEW analogs)
- `packages/dashboard/src/state/__tests__/` (1 NEW analog)

**Files scanned:** 13 source files read in full or in targeted ranges; 5 test files read for harness pattern extraction.

**Pattern extraction date:** 2026-05-15

**Key precedent files (load-bearing):**
- `packages/dashboard/src/components/SequenceHeader.tsx` — the modified component itself
- `packages/dashboard/src/components/ShotGridCard.tsx` — the modified card itself + `<WarningPill/>` (analog for new ProgressBar primitive)
- `packages/dashboard/src/state/shot-grid.ts` — the modified state module itself (signal + computed + handler)
- `packages/dashboard/src/types/shot-grid.ts` — the modified types file itself
- `src/store/shot-status-repo.ts` — the modified repo + `listShotsForGrid` precedent for the new `getSequenceStats`
- `src/engine/pipeline.ts:822-874` — the modified facade (existing `listShotGrid`)
- `src/store/__tests__/shot-status-repo-grid.test.ts` — the EXPLAIN QUERY PLAN harness precedent for the new stats SQL test
- `packages/dashboard/src/state/__tests__/shot-grid.test.ts` — the signal-reset + onShotStatusChanged harness precedent for the new stats-delta test
