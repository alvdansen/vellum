/**
 * MarkdownView — a small, safe markdown renderer for the engine-generated
 * pipeline-log (Engine.getShotPipelineLog → renderShotPipelineLog). Renders to
 * Preact vnodes; NEVER uses dangerouslySetInnerHTML, so even though the engine
 * already escapes content, no server string can inject markup here.
 *
 * Scope: the exact subset the pipeline log emits (see src/engine/pipeline-log.ts):
 *   - ATX headings  # / ## / ###
 *   - unordered lists `- ` with 2-space-indent nesting
 *   - GitHub-style tables (| a | b | with a |---| separator); cells escape
 *     pipes as `\|` (engine `cell()`), which the splitter un-escapes
 *   - blockquotes `> `
 *   - fenced code blocks ```lang … ``` (may be indented under a list item)
 *   - inline: `code`, **bold**, _italic_
 *
 * Anything it does not recognise renders as a plain paragraph — never throws,
 * never drops the source text. This is deliberately NOT a general CommonMark
 * implementation; it is a projection renderer for one known producer.
 *
 * SECURITY — XSS: every text fragment reaches the DOM as a JSX text child
 * (Preact auto-escapes) or as a <code>/<pre> text child. No raw HTML.
 */

import type { JSX, VNode } from 'preact';

// ---------------------------------------------------------------------------
// Inline parsing: code → bold → italic. Order matters (code first so ** inside
// a code span is literal). Each level recurses into the non-matched remainder.
// ---------------------------------------------------------------------------

/**
 * Monotonic key source for one parseInline call. Because splitBy runs `recurse`
 * SEPARATELY on each segment between matches and flattens the results into ONE
 * children array, a per-call index would collide across segments (two sibling
 * <strong> spans both keyed 'b-0'). A single shared counter threaded through
 * every level makes every inline key unique within the produced array.
 */
interface KeyCounter {
  n: number;
}

function splitBy(
  text: string,
  re: RegExp,
  wrap: (inner: string, key: string) => VNode,
  recurse: (s: string) => (string | VNode)[],
  keys: KeyCounter,
): (string | VNode)[] {
  const out: (string | VNode)[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  // Fresh regex with global flag so exec walks the string.
  const g = new RegExp(re.source, 'g');
  while ((m = g.exec(text)) !== null) {
    if (m.index > last) out.push(...recurse(text.slice(last, m.index)));
    out.push(wrap(m[1], `mk${keys.n++}`));
    last = m.index + m[0].length;
    if (m[0].length === 0) g.lastIndex += 1; // guard against zero-width loops
  }
  if (last < text.length) out.push(...recurse(text.slice(last)));
  return out;
}

function parseItalic(text: string, keys: KeyCounter): (string | VNode)[] {
  // Underscore emphasis is NOT recognized intraword (CommonMark's own rule,
  // and the reason it matters here: this renderer displays pipeline logs and
  // error text full of REPLICATE_API_ERROR / SEQ020_BG_WIDE, which a naive
  // /_(...)_/ turned into REPLICATE<em>API</em>ERROR two inches from a
  // sidebar spelling the same name correctly). The lookarounds require a
  // non-word boundary on both sides; \w includes underscore, so `__x__`
  // stays literal too.
  return splitBy(
    text,
    /(?<![\w])_([^_]+)_(?![\w])/,
    (inner, key) => <em key={key}>{inner}</em>,
    (s) => [s],
    keys,
  );
}

function parseBold(text: string, keys: KeyCounter): (string | VNode)[] {
  return splitBy(
    text,
    /\*\*([^*]+)\*\*/,
    (inner, key) => <strong key={key}>{inner}</strong>,
    (s) => parseItalic(s, keys),
    keys,
  );
}

/** Parse inline formatting (code, bold, italic) into a vnode/string array. */
export function parseInline(text: string): (string | VNode)[] {
  const keys: KeyCounter = { n: 0 };
  return splitBy(
    text,
    /`([^`]+)`/,
    (inner, key) => (
      <code
        key={key}
        class="rounded bg-[var(--color-surface-alt)] px-1 py-0.5 text-xs"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {inner}
      </code>
    ),
    (s) => parseBold(s, keys),
    keys,
  );
}

// ---------------------------------------------------------------------------
// Table helpers
// ---------------------------------------------------------------------------

/** Split a markdown table row into cells, honouring `\|` escapes. */
function splitTableRow(line: string): string[] {
  let inner = line.trim();
  if (inner.startsWith('|')) inner = inner.slice(1);
  if (inner.endsWith('|')) inner = inner.slice(0, -1);
  const cells: string[] = [];
  let buf = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') {
      buf += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  cells.push(buf.trim());
  return cells;
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

// ---------------------------------------------------------------------------
// List helpers — build a nested <ul> from consecutive `- ` items keyed on the
// leading-space indent (2 spaces per level, as the engine emits).
// ---------------------------------------------------------------------------

interface ListItem {
  indent: number;
  text: string;
}

/** Render list items at the indent level of items[start], consuming any
 *  deeper-indented items that follow an item into that item's nested <ul>.
 *  Returns [vnodes, nextIndex]. */
function renderList(
  items: ListItem[],
  start: number,
  keyPrefix: string,
): [VNode[], number] {
  const lis: VNode[] = [];
  let i = start;
  const baseIndent = items[start].indent;
  while (i < items.length && items[i].indent >= baseIndent) {
    const myIndent = items[i].indent;
    const text = items[i].text;
    const liKey = `${keyPrefix}-li-${i}`;
    i += 1;
    // Any immediately-following deeper items become this item's nested list.
    let nested: VNode[] = [];
    if (i < items.length && items[i].indent > myIndent) {
      const [children, next] = renderList(items, i, `${liKey}-n`);
      nested = children;
      i = next;
    }
    lis.push(
      <li key={liKey}>
        {parseInline(text)}
        {nested.length > 0 ? (
          <ul class="ml-4 mt-1 list-disc space-y-1">{nested}</ul>
        ) : null}
      </li>,
    );
  }
  return [lis, i];
}

// ---------------------------------------------------------------------------
// Block parser
// ---------------------------------------------------------------------------

/** Parse the pipeline-log markdown subset into a flat array of block vnodes. */
export function renderMarkdown(md: string): VNode[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: VNode[] = [];
  let i = 0;
  let key = 0;
  const nextKey = () => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip.
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Fenced code block (possibly indented under a list item).
    const fence = line.match(/^(\s*)```(\w*)\s*$/);
    if (fence) {
      const indent = fence[1].length;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        // Strip the common fence indent from body lines.
        body.push(lines[i].slice(indent));
        i += 1;
      }
      i += 1; // consume closing fence
      blocks.push(
        <pre
          key={nextKey()}
          class="overflow-auto rounded bg-[var(--color-surface-alt)] p-3 text-xs text-[var(--color-fg-muted)]"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {body.join('\n')}
        </pre>,
      );
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const content = parseInline(heading[2].trim());
      const cls =
        level === 1
          ? 'text-base font-semibold mt-4 mb-2 text-[var(--color-fg)]'
          : level === 2
            ? 'text-sm font-semibold mt-4 mb-1 text-[var(--color-fg)]'
            : 'text-xs font-semibold uppercase tracking-wide mt-3 mb-1 text-[var(--color-fg-muted)]';
      const Tag = `h${Math.min(level, 6)}` as keyof JSX.IntrinsicElements;
      blocks.push(
        <Tag key={nextKey()} class={cls} style={{ fontFamily: 'var(--font-display)' }}>
          {content}
        </Tag>,
      );
      i += 1;
      continue;
    }

    // Table (header row + separator).
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2; // consume header + separator
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const tk = nextKey();
      blocks.push(
        <div key={tk} class="overflow-x-auto">
          <table class="w-full border-collapse text-xs">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th
                    key={`${tk}-h${hi}`}
                    class="border-b border-[var(--color-border)] px-2 py-1 text-left font-semibold text-[var(--color-fg-muted)]"
                  >
                    {parseInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={`${tk}-r${ri}`}>
                  {r.map((cellText, ci) => (
                    <td
                      key={`${tk}-r${ri}-c${ci}`}
                      class="border-b border-[var(--color-border-subtle)] px-2 py-1 align-top text-[var(--color-fg)]"
                    >
                      {parseInline(cellText)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Blockquote (consecutive `>` lines).
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={nextKey()}
          class="border-l-2 border-[var(--color-accent)] pl-3 text-sm italic text-[var(--color-fg-muted)]"
        >
          {parseInline(quote.join(' '))}
        </blockquote>,
      );
      continue;
    }

    // Unordered list (consecutive `- ` items, indent-nested).
    if (/^(\s*)-\s+/.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length && /^(\s*)-\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)-\s+(.*)$/)!;
        items.push({ indent: m[1].length, text: m[2] });
        i += 1;
      }
      const [lis] = renderList(items, 0, nextKey());
      blocks.push(
        <ul key={nextKey()} class="list-disc space-y-1 pl-5 text-sm text-[var(--color-fg)]">
          {lis}
        </ul>,
      );
      continue;
    }

    // Paragraph. ALWAYS consume the current line first — this branch is only
    // reached because no block detector above matched line i, so it must be
    // absorbed here to guarantee progress. (Without this, a line that starts
    // like a block but fails the block detector's stricter test — e.g. a bare
    // ``` that is not a complete fence — would match the paragraph loop's own
    // exclusion on the first iteration, run the body zero times, and spin the
    // outer while forever.) Then accumulate until a blank line or block start.
    const para: string[] = [lines[i]];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^(\s*)-\s+/.test(lines[i]) &&
      !/^(\s*)```/.test(lines[i]) &&
      !(TABLE_ROW.test(lines[i]) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]))
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={nextKey()} class="text-sm text-[var(--color-fg)]">
        {parseInline(para.join(' '))}
      </p>,
    );
  }

  return blocks;
}

export interface MarkdownViewProps {
  markdown: string;
}

export function MarkdownView({ markdown }: MarkdownViewProps): JSX.Element {
  return (
    <div class="flex flex-col gap-1" data-testid="markdown-view">
      {renderMarkdown(markdown)}
    </div>
  );
}
