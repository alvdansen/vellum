/**
 * MetadataDiff — pure display layer for version diff summaries.
 *
 * Extracted from DiffDrawer.tsx:101-108 (Phase 12) and extended to render
 * structured `changes` for ABCompareView (22-06) per D-16. Phase 12
 * DiffDrawer migrates to consume this component — when only `summary` is
 * passed (no `changes`), the render is the same paragraph block as before
 * (backward-compatible refactor, no Phase 12 behavior change).
 *
 * RESEARCH Q2 — scope decision: this component renders BOTH the human-
 * readable summary AND the structured changes (params / models / seed /
 * workflow / metadata buckets). The DiffChanges shape is dashboard-local
 * because api.ts:diffVersionsAB currently returns Promise<unknown> per
 * RESEARCH Pitfall 2 (engine signature unchanged); consumers (this
 * component) narrow at use-site.
 */

import type { JSX } from 'preact';
import {
  COMPARE_MODAL_DIFF_EMPTY,
  COMPARE_MODAL_SECTION_METADATA,
} from '../lib/copy.js';

export interface DiffChanges {
  params?: Array<{ key: string; before: unknown; after: unknown }>;
  models?: Array<{ name: string; before: string; after: string }>;
  seed?: { before: number; after: number };
  workflow?: { changed: boolean };
  metadata?: Array<{ key: string; before: unknown; after: unknown }>;
}

export interface MetadataDiffProps {
  /** Human-readable one-line summary. Always rendered (Phase 12 surface). */
  summary: string;
  /**
   * Optional structured diff buckets — rendered as a bullet list under the
   * summary when at least one bucket has content. When omitted entirely
   * (Phase 12 DiffDrawer use), no list renders — same surface as before.
   */
  changes?: DiffChanges;
}

export function MetadataDiff({
  summary,
  changes,
}: MetadataDiffProps): JSX.Element {
  const hasChanges =
    changes !== undefined &&
    Boolean(
      (changes.params?.length ?? 0) > 0 ||
        (changes.models?.length ?? 0) > 0 ||
        changes.seed !== undefined ||
        changes.workflow?.changed === true ||
        (changes.metadata?.length ?? 0) > 0,
    );

  // changes prop was explicitly passed but every bucket is empty → empty state.
  const passedEmpty = changes !== undefined && !hasChanges;

  return (
    <section>
      <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">
        {COMPARE_MODAL_SECTION_METADATA}
      </h3>
      <p class="rounded bg-[var(--color-surface-alt)] p-3 text-sm text-[var(--color-fg)]">
        {summary}
      </p>

      {hasChanges ? (
        <ul class="mt-3 flex flex-col gap-2">
          {changes!.params?.map((p) => (
            <li class="text-sm" key={`p-${p.key}`}>
              <span class="font-semibold">{p.key}:</span>{' '}
              <span class="num">
                {String(p.before)} → {String(p.after)}
              </span>
            </li>
          ))}
          {changes!.models?.map((m) => (
            <li class="text-sm" key={`m-${m.name}`}>
              <span class="font-semibold">model {m.name}:</span> {m.before} →{' '}
              {m.after}
            </li>
          ))}
          {changes!.seed !== undefined ? (
            <li class="text-sm" key="seed">
              <span class="font-semibold">seed:</span>{' '}
              <span class="num">
                {changes!.seed.before} → {changes!.seed.after}
              </span>
            </li>
          ) : null}
          {changes!.workflow?.changed === true ? (
            <li class="text-sm font-semibold" key="workflow">
              workflow changed
            </li>
          ) : null}
          {changes!.metadata?.map((m) => (
            <li class="text-sm" key={`md-${m.key}`}>
              <span class="font-semibold">{m.key}:</span>{' '}
              <span class="num">
                {String(m.before)} → {String(m.after)}
              </span>
            </li>
          ))}
        </ul>
      ) : passedEmpty ? (
        <p class="mt-3 text-sm text-[var(--color-fg-muted)]">
          {COMPARE_MODAL_DIFF_EMPTY}
        </p>
      ) : null}
    </section>
  );
}
