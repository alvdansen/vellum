/**
 * PipelineLogSection — a collapsible per-shot pipeline-log panel rendered
 * inside the ReviewPanel review surface. Surfaces the engine's
 * cost + provenance accounting: the append-only status timeline, every take
 * with its recorded actual vs estimated cost, gate proposals, and the
 * recorded-spend total — all produced by Engine.getShotPipelineLog as markdown
 * and rendered here via the safe MarkdownView.
 *
 * Lazy: the log is fetched only when the section is first expanded (it is a
 * heavier read than the timeline). Collapsed by default. Own local state — no
 * signal bag, since it is scoped to one open review panel.
 *
 * States: a toggle button (aria-expanded), then on expand a loading label,
 * an error surface with Retry, or the rendered markdown plus a take-count
 * caption.
 */

import { useState, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { ChevronRight, ChevronDown } from 'lucide-preact';
import { MarkdownView } from './MarkdownView.js';
import { fetchShotPipelineLog } from '../lib/api.js';
import type { ShotPipelineLogResponse } from '../lib/api.js';
import {
  PIPELINE_LOG_TOGGLE_LABEL,
  PIPELINE_LOG_TOGGLE_ARIA,
  PIPELINE_LOG_HIDE_ARIA,
  PIPELINE_LOG_LOADING_LABEL,
  PIPELINE_LOG_ERROR,
  PIPELINE_LOG_RETRY_LABEL,
  PIPELINE_LOG_TAKE_COUNT_SINGULAR,
  PIPELINE_LOG_TAKE_COUNT_PLURAL,
} from '../lib/copy.js';

export interface PipelineLogSectionProps {
  shotId: string;
}

export function PipelineLogSection({ shotId }: PipelineLogSectionProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<ShotPipelineLogResponse | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setIsFetching(true);
    setError(false);
    let alive = true;
    fetchShotPipelineLog(shotId)
      .then((res) => {
        if (!alive) return;
        setData(res);
        setIsFetching(false);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setIsFetching(false);
      });
    return () => {
      alive = false;
    };
  }, [shotId]);

  function toggle(): void {
    const next = !expanded;
    setExpanded(next);
    // Lazy first-load on expand; re-fetch is only via the Retry button.
    if (next && data === null && !isFetching) {
      load();
    }
  }

  const takeCount = data?.take_count ?? 0;
  const takeNoun =
    takeCount === 1 ? PIPELINE_LOG_TAKE_COUNT_SINGULAR : PIPELINE_LOG_TAKE_COUNT_PLURAL;

  return (
    <section class="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3" data-testid="pipeline-log-section">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-label={expanded ? PIPELINE_LOG_HIDE_ARIA : PIPELINE_LOG_TOGGLE_ARIA}
        class="flex items-center gap-1 self-start rounded px-1 py-0.5 text-sm font-normal text-[var(--color-fg)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span class="label-uppercase text-xs text-[var(--color-fg-muted)]">
          {PIPELINE_LOG_TOGGLE_LABEL}
        </span>
      </button>

      {expanded ? (
        isFetching ? (
          <p class="text-sm text-[var(--color-fg-muted)]" role="status" aria-busy="true">
            {PIPELINE_LOG_LOADING_LABEL}
          </p>
        ) : error ? (
          <div class="flex flex-col items-start gap-2" role="alert">
            <span class="text-sm text-[var(--color-fg-muted)]">
              {PIPELINE_LOG_ERROR}
            </span>
            <button
              type="button"
              onClick={load}
              class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              {PIPELINE_LOG_RETRY_LABEL}
            </button>
          </div>
        ) : data ? (
          <div class="flex flex-col gap-2">
            <span class="text-xs tabular-nums text-[var(--color-fg-muted)]">
              {takeCount} {takeNoun}
            </span>
            <MarkdownView markdown={data.markdown} />
          </div>
        ) : null
      ) : null}
    </section>
  );
}
