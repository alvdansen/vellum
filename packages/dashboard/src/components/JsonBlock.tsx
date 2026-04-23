/**
 * JsonBlock — renders arbitrary JSON in a monospace <pre> block.
 *
 * Pure component: props-in, no callbacks (read-only display).
 *
 * SECURITY — T-5-06 (XSS mitigation):
 *   Data is rendered as a React/Preact text child via {JSON.stringify(data, null, 2)}.
 *   Preact's virtual DOM auto-escapes string children as text nodes — no raw HTML
 *   parsing. dangerouslySetInnerHTML is NEVER used. Verified by grep in CI.
 *
 * This component deliberately ships no syntax highlighting in the primitive layer.
 * Richer highlighting (prism/shiki/hand-rolled tokenizer per UI-SPEC.md) can be
 * added in a later plan without touching any call site — the contract stays
 * "JSON.stringify in a <pre>".
 */

export interface JsonBlockProps {
  data: unknown;
}

export function JsonBlock({ data }: JsonBlockProps) {
  return (
    <pre
      class="overflow-auto rounded bg-[var(--color-surface-alt)] p-3 font-mono text-xs text-[var(--color-fg-muted)] whitespace-pre-wrap"
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
