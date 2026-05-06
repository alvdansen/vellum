/**
 * Phase 18 / Plan 18-04 Task 2 — SortDropdown component tests.
 *
 * 14 tests covering:
 *   - Tests 1-2: trigger label rendering (current value + defensive fallback)
 *   - Test 3: closed-by-default — popover not in DOM
 *   - Test 4: click trigger opens popover
 *   - Tests 5-6: WAI-ARIA APG combobox attributes (closed + open)
 *   - Test 7: option roles + aria-selected + check icon
 *   - Tests 8-10: keyboard navigation (Enter/ArrowDown opens; ArrowDown wraps)
 *   - Test 11: Escape closes + returns focus to trigger
 *   - Test 12: Enter on focused option fires onChange + closes + returns focus
 *   - Test 13: Click on option fires onChange + closes + returns focus
 *   - Test 14: Outside-click closes WITHOUT selecting
 *
 * Mirrors the Thumbnail.test.tsx + TreeSidebar.test.tsx setup pattern:
 * vitest + @testing-library/preact (NO @testing-library/user-event — not
 * in dashboard deps). Keyboard interactions use fireEvent.keyDown directly.
 *
 * Architecture-purity (D-WEBUI-31): zero server-tree imports. The component
 * imports types from ../lib/sortTypes; the test file imports the option
 * arrays from ../lib/sortHelpers (both dashboard-local).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { SortDropdown } from '../components/SortDropdown.js';
import { GRID_SORT_OPTIONS, TREE_SORT_OPTIONS } from '../lib/sortHelpers.js';

const ARIA_LABEL = 'Sort versions by';

describe('SortDropdown — Plan 18-04 Task 2', () => {
  it('Test 1: renders trigger with current option label', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={GRID_SORT_OPTIONS}
        value={{ field: 'completed_at', dir: 'desc' }}
        onChange={onChange}
        ariaLabel={ARIA_LABEL}
      />,
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Latest');
  });

  it('Test 2: trigger label falls back to first option when value is unmatched', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={GRID_SORT_OPTIONS}
        value={{ field: 'name' as const, dir: 'asc' }}
        onChange={onChange}
        ariaLabel={ARIA_LABEL}
      />,
    );
    // First option is Latest (completed_at:desc) — defensive fallback per UI-SPEC.
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Latest');
  });

  it('Test 3: closed by default — popover not in DOM', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={GRID_SORT_OPTIONS}
        value={{ field: 'completed_at', dir: 'desc' }}
        onChange={onChange}
        ariaLabel={ARIA_LABEL}
      />,
    );
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Test 4: click trigger → popover renders', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={GRID_SORT_OPTIONS}
        value={{ field: 'completed_at', dir: 'desc' }}
        onChange={onChange}
        ariaLabel={ARIA_LABEL}
      />,
    );
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('Test 5: ARIA attributes on closed trigger (combobox + haspopup + expanded=false + label)', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={GRID_SORT_OPTIONS}
        value={{ field: 'completed_at', dir: 'desc' }}
        onChange={onChange}
        ariaLabel={ARIA_LABEL}
      />,
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-label')).toBe(ARIA_LABEL);
    // aria-controls is set even when closed (always points to the listbox id)
    expect(trigger.getAttribute('aria-controls')).toBeTruthy();
  });

  it('Test 6: ARIA attributes on open trigger + listbox (expanded=true + activedescendant)', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={GRID_SORT_OPTIONS}
        value={{ field: 'completed_at', dir: 'desc' }}
        onChange={onChange}
        ariaLabel={ARIA_LABEL}
      />,
    );
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const listbox = screen.getByRole('listbox');
    // Trigger's aria-controls matches the listbox's id
    expect(trigger.getAttribute('aria-controls')).toBe(listbox.getAttribute('id'));
    // aria-activedescendant points to a real option element id
    const activeId = trigger.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId!)).not.toBeNull();
  });

  it('Test 7: each option has role="option" + aria-selected; selected option matches value', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={GRID_SORT_OPTIONS}
        value={{ field: 'completed_at', dir: 'asc' }} // index 1 = 'Oldest'
        onChange={onChange}
        ariaLabel={ARIA_LABEL}
      />,
    );
    fireEvent.click(screen.getByRole('combobox'));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(GRID_SORT_OPTIONS.length);
    // The 'Oldest' option (index 1) is the selected one
    const oldest = options.find((o) => o.textContent?.includes('Oldest'));
    expect(oldest).toBeTruthy();
    expect(oldest!.getAttribute('aria-selected')).toBe('true');
    const latest = options.find((o) => o.textContent?.includes('Latest'));
    expect(latest!.getAttribute('aria-selected')).toBe('false');
  });

  it('Test 8: Enter on closed trigger opens popover focused on selected option', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={GRID_SORT_OPTIONS}
        value={{ field: 'completed_at', dir: 'asc' }} // index 1
        onChange={onChange}
        ariaLabel={ARIA_LABEL}
      />,
    );
    const trigger = screen.getByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    const activeId = trigger.getAttribute('aria-activedescendant');
    const focused = document.getElementById(activeId!);
    expect(focused?.textContent).toContain('Oldest');
  });

  it('Test 9: ArrowDown on closed trigger opens popover (focuses selected)', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={GRID_SORT_OPTIONS}
        value={{ field: 'completed_at', dir: 'desc' }} // index 0
        onChange={onChange}
        ariaLabel={ARIA_LABEL}
      />,
    );
    const trigger = screen.getByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    // First option focused — 'Latest'
    const activeId = trigger.getAttribute('aria-activedescendant');
    expect(document.getElementById(activeId!)?.textContent).toContain('Latest');
  });

  it('Test 10: ArrowDown inside listbox advances focus (wraps from last to first)', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={GRID_SORT_OPTIONS} // 3 options
        value={{ field: 'completed_at', dir: 'desc' }} // index 0
        onChange={onChange}
        ariaLabel={ARIA_LABEL}
      />,
    );
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger); // open at selected (index 0)
    const listbox = screen.getByRole('listbox');

    // Step from index 0 → 1
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    let activeId = trigger.getAttribute('aria-activedescendant');
    expect(document.getElementById(activeId!)?.textContent).toContain('Oldest');

    // Step from index 1 → 2 ('Version ↓')
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    activeId = trigger.getAttribute('aria-activedescendant');
    expect(document.getElementById(activeId!)?.textContent).toContain('Version');

    // Step from last (index 2) → wraps back to first (index 0 = 'Latest')
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    activeId = trigger.getAttribute('aria-activedescendant');
    expect(document.getElementById(activeId!)?.textContent).toContain('Latest');
  });

  it('Test 11: Escape closes popover + returns focus to trigger', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={GRID_SORT_OPTIONS}
        value={{ field: 'completed_at', dir: 'desc' }}
        onChange={onChange}
        ariaLabel={ARIA_LABEL}
      />,
    );
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    // Importantly, onChange was NOT fired (Escape cancels — no selection)
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Test 12: Enter on focused option fires onChange + closes + returns focus', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={GRID_SORT_OPTIONS}
        value={{ field: 'completed_at', dir: 'desc' }} // index 0
        onChange={onChange}
        ariaLabel={ARIA_LABEL}
      />,
    );
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox');
    // ArrowDown twice → index 2 (Version ↓)
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      field: 'version_number',
      dir: 'desc',
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Test 13: Click on option fires onChange + closes + returns focus', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={TREE_SORT_OPTIONS}
        value={{ field: 'name', dir: 'asc' }}
        onChange={onChange}
        ariaLabel="Sort tree by"
      />,
    );
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    const options = screen.getAllByRole('option');
    // Click the 3rd option ('Newest' = created_at:desc)
    fireEvent.click(options[2]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      field: 'created_at',
      dir: 'desc',
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Test 14: Outside-click (mousedown on body) closes popover WITHOUT selecting', () => {
    const onChange = vi.fn();
    render(
      <SortDropdown
        options={GRID_SORT_OPTIONS}
        value={{ field: 'completed_at', dir: 'desc' }}
        onChange={onChange}
        ariaLabel={ARIA_LABEL}
      />,
    );
    fireEvent.click(screen.getByRole('combobox')); // open
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
