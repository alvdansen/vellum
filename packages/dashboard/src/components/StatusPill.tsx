/**
 * StatusPill — inline color-coded status badge for versions.
 *
 * Pure component: props-in, no callbacks (read-only display).
 * Status colors map 1:1 to UI-SPEC.md status pill contract (ComfyUI slot colors).
 *
 * Status vocabulary matches CONTEXT.md SSE payload field:
 *   - queued     (pre-running, grey)
 *   - running    (in-flight, amber + pulse)
 *   - complete   (terminal success, green)
 *   - failed     (terminal failure, red)
 */

export type Status = 'queued' | 'running' | 'complete' | 'failed';

export interface StatusPillProps {
  status: Status;
}

/**
 * Per-status Tailwind classes. Background uses status-color tokens from theme.css;
 * the running variant adds the CSS pulse keyframe from theme.css.
 *
 * Text color is always --color-bg (inverts against the saturated pill background)
 * for WCAG AA contrast both themes.
 */
const STATUS_STYLES: Record<Status, string> = {
  queued:
    'bg-[var(--color-fg-muted)] text-[var(--color-bg)]',
  running:
    'bg-[var(--color-status-running)] text-[var(--color-bg)] animate-status-pulse',
  complete:
    'bg-[var(--color-status-completed)] text-[var(--color-bg)]',
  failed:
    'bg-[var(--color-status-failed)] text-[var(--color-bg)]',
};

export function StatusPill({ status }: StatusPillProps) {
  return (
    <span
      class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-normal uppercase tracking-widest ${STATUS_STYLES[status]}`}
      data-status={status}
    >
      {status}
    </span>
  );
}
