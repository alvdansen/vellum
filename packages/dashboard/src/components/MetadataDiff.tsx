/**
 * MetadataDiff — pure display layer for version diff summaries.
 *
 * Extracted from DiffDrawer.tsx's summary paragraph and extended to render
 * structured `changes` for ABCompareView. DiffDrawer migrates to
 * consume this component — when only `summary` is
 * passed (no `changes`), the render is the same paragraph block as before
 * (backward-compatible refactor, no behavior change for existing callers).
 *
 * Scope decision: this component renders BOTH the human-
 * readable summary AND the structured changes (params / models / seed /
 * workflow / metadata buckets). The DiffChanges shape is dashboard-local
 * because api.ts:diffVersionsAB currently returns Promise<unknown>
 * (the engine signature is deliberately unchanged); consumers (this
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
  /** Human-readable one-line summary. Always rendered (the original DiffDrawer surface). */
  summary: string;
  /**
   * Optional structured diff buckets — rendered as a bullet list under the
   * summary when at least one bucket has content. When omitted entirely
   * (the DiffDrawer use), no list renders — same surface as before.
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
