/**
 * Phase 22 / Plan 22-03 — MetadataDiff component tests (D-16).
 *
 * Pure-presentational test pattern (no signals, no fetch). The component is
 * props-in / DOM-out; we render with different `changes` shapes and assert
 * via `getByText` / `queryByText`.
 *
 * RESEARCH Q2: covers both summary-only (Phase 12 DiffDrawer use) and
 * structured changes (ABCompareView 22-06 use).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { MetadataDiff } from '../MetadataDiff.js';
import {
  COMPARE_MODAL_DIFF_EMPTY,
  COMPARE_MODAL_SECTION_METADATA,
} from '../../lib/copy.js';

afterEach(() => {
  cleanup();
});

describe('MetadataDiff — summary rendering', () => {
  it('renders summary text inside a paragraph', () => {
    const { container } = render(
      <MetadataDiff summary="2 params changed, seed updated" />,
    );
    const p = container.querySelector('p');
    expect(p).not.toBeNull();
    expect(p?.textContent).toContain('2 params changed, seed updated');
  });

  it('section heading shows COMPARE_MODAL_SECTION_METADATA verbatim', () => {
    const { getByText } = render(<MetadataDiff summary="x" />);
    expect(getByText(COMPARE_MODAL_SECTION_METADATA)).toBeTruthy();
  });

  it('outer section has label-uppercase heading + surface-alt paragraph background', () => {
    const { container } = render(<MetadataDiff summary="x" />);
    const h3 = container.querySelector('h3');
    const p = container.querySelector('p');
    expect(h3?.className).toContain('label-uppercase');
    expect(p?.className).toContain('bg-[var(--color-surface-alt)]');
  });
});

describe('MetadataDiff — changes prop behavior', () => {
  it('changes undefined → no list and no empty-state text (Phase 12 backward-compat)', () => {
    const { container, queryByText } = render(<MetadataDiff summary="x" />);
    expect(container.querySelector('ul')).toBeNull();
    expect(queryByText(COMPARE_MODAL_DIFF_EMPTY)).toBeNull();
  });

  it('changes fully empty ({ params: [], models: [], metadata: [] }) → empty-state copy renders', () => {
    const { getByText } = render(
      <MetadataDiff
        summary="x"
        changes={{ params: [], models: [], metadata: [] }}
      />,
    );
    expect(getByText(COMPARE_MODAL_DIFF_EMPTY)).toBeTruthy();
  });

  it('changes with one params entry → list contains key + before → after', () => {
    const { container, getByText } = render(
      <MetadataDiff
        summary="x"
        changes={{ params: [{ key: 'steps', before: 20, after: 30 }] }}
      />,
    );
    expect(container.querySelector('ul')).not.toBeNull();
    expect(getByText('steps:')).toBeTruthy();
    expect(container.textContent).toContain('20 → 30');
  });

  it('changes with only seed delta → renders seed line', () => {
    const { container, getByText } = render(
      <MetadataDiff
        summary="x"
        changes={{ seed: { before: 100, after: 999 } }}
      />,
    );
    expect(getByText('seed:')).toBeTruthy();
    expect(container.textContent).toContain('100 → 999');
  });

  it('changes with workflow.changed=true → renders "workflow changed" line', () => {
    const { getByText } = render(
      <MetadataDiff summary="x" changes={{ workflow: { changed: true } }} />,
    );
    expect(getByText('workflow changed')).toBeTruthy();
  });

  it('changes with workflow.changed=false → does NOT render workflow line', () => {
    const { queryByText } = render(
      <MetadataDiff summary="x" changes={{ workflow: { changed: false } }} />,
    );
    expect(queryByText('workflow changed')).toBeNull();
  });

  it('models entry → renders "model {name}: before → after"', () => {
    const { container } = render(
      <MetadataDiff
        summary="x"
        changes={{
          models: [{ name: 'checkpoint', before: 'sdxl-v1', after: 'sdxl-v2' }],
        }}
      />,
    );
    expect(container.textContent).toContain('model checkpoint:');
    expect(container.textContent).toContain('sdxl-v1 → sdxl-v2');
  });
});
