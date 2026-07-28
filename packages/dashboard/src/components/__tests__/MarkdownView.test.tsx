/**
 * MarkdownView — the safe pipeline-log markdown renderer. Exercises the exact
 * subset the engine (renderShotPipelineLog) emits: headings, nested lists,
 * tables with escaped pipes, blockquotes, fenced code, and inline
 * code/bold/italic. Also asserts robustness (no throw on odd input) and the
 * XSS-safety contract (angle brackets render as text, never markup).
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/preact';
import { MarkdownView } from '../MarkdownView.js';

describe('MarkdownView', () => {
  it('renders ATX headings at the right level', () => {
    const { container } = render(
      <MarkdownView markdown={'# Title\n\n## Section\n\n### Sub'} />,
    );
    expect(container.querySelector('h1')?.textContent).toBe('Title');
    expect(container.querySelector('h2')?.textContent).toBe('Section');
    expect(container.querySelector('h3')?.textContent).toBe('Sub');
  });

  it('renders inline bold, italic, and code', () => {
    const { container } = render(
      <MarkdownView markdown={'A **bold** and _em_ and `code` here'} />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('em');
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('leaves intraword underscores alone (error codes, output filenames)', () => {
    // The renderer's staple diet is pipeline logs full of snake_case — a
    // naive italic pass rendered REPLICATE_API_ERROR as REPLICATE<em>API</em>ERROR.
    const { container } = render(
      <MarkdownView
        markdown={'REPLICATE_API_ERROR on SEQ020_BG_WIDE and __dunder__ but _real emphasis_ works'}
      />,
    );
    expect(container.textContent).toContain('REPLICATE_API_ERROR');
    expect(container.textContent).toContain('SEQ020_BG_WIDE');
    expect(container.textContent).toContain('__dunder__');
    const ems = [...container.querySelectorAll('em')].map((e) => e.textContent);
    expect(ems).toEqual(['real emphasis']);
  });

  it('renders a table, un-escaping \\| in cells', () => {
    const md = [
      '| When | Note |',
      '|---|---|',
      '| now | a \\| b |',
    ].join('\n');
    const { container } = render(<MarkdownView markdown={md} />);
    const ths = container.querySelectorAll('th');
    expect(ths).toHaveLength(2);
    expect(ths[0].textContent).toBe('When');
    const tds = container.querySelectorAll('tbody td');
    expect(tds).toHaveLength(2);
    // escaped pipe collapses back to a literal '|'
    expect(tds[1].textContent).toBe('a | b');
  });

  it('renders an unordered list with nested items', () => {
    const md = ['- **Outputs:**', '  - `a.png` — 1.2 MB', '  - `b.png`'].join('\n');
    const { container } = render(<MarkdownView markdown={md} />);
    const topUl = container.querySelector('ul');
    expect(topUl).toBeTruthy();
    // one top-level li, containing a nested ul with two li
    const nested = topUl?.querySelector('ul');
    expect(nested).toBeTruthy();
    expect(nested?.querySelectorAll('li')).toHaveLength(2);
  });

  it('renders a blockquote', () => {
    const { container } = render(
      <MarkdownView markdown={'> This log is a projection.'} />,
    );
    expect(container.querySelector('blockquote')?.textContent).toContain(
      'This log is a projection.',
    );
  });

  it('renders a fenced code block, stripping the fence indent', () => {
    const md = ['- **Neutral provenance:**', '', '  ```json', '  {"a":1}', '  ```'].join('\n');
    const { container } = render(<MarkdownView markdown={md} />);
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toBe('{"a":1}');
  });

  it('does not throw on empty or odd input', () => {
    expect(() => render(<MarkdownView markdown={''} />)).not.toThrow();
    expect(() =>
      render(<MarkdownView markdown={'**unterminated and _mismatch'} />),
    ).not.toThrow();
  });

  it('terminates (does not hang) on ``` lines that are not complete fences', () => {
    // Regression: a line starting with ``` that fails the anchored fence
    // detector (4+ backticks, or an info-string with a space / non-word char)
    // used to fall through to a paragraph loop that consumed zero lines and
    // spun forever. Each of these must render without hanging the test.
    for (const md of [
      '````',
      '```json title="x"',
      '```objective-c',
      '```foo bar',
      'normal para\n````\nafter',
    ]) {
      expect(() => render(<MarkdownView markdown={md} />)).not.toThrow();
    }
  });

  it('assigns unique keys to sibling inline spans of the same type (no dup-key warning)', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <MarkdownView markdown={'**a** `b` **c** and _x_ **y** _z_'} />,
    );
    // Two <strong> siblings that previously collided on key 'b-0'.
    expect(container.querySelectorAll('strong').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('em').length).toBeGreaterThanOrEqual(2);
    const dupKeyWarning = warn.mock.calls.some((c) =>
      String(c[0]).includes('same key'),
    );
    expect(dupKeyWarning).toBe(false);
    warn.mockRestore();
  });

  it('renders angle brackets as text, never as markup (XSS safety)', () => {
    const { container, getByTestId } = render(
      <MarkdownView markdown={'plain <img src=x onerror=alert(1)> text'} />,
    );
    // No injected <img> element — the string is escaped text
    expect(container.querySelector('img')).toBeNull();
    expect(getByTestId('markdown-view').textContent).toContain(
      '<img src=x onerror=alert(1)>',
    );
  });
});
