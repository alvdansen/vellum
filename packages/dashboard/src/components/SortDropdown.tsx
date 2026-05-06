/**
 * Phase 18 / Plan 18-04 — <SortDropdown/> WAI-ARIA APG combobox + listbox.
 *
 * Reused for BOTH grid sort and tree sort instances (D-08 — single component
 * type, two parent-rendered instances). Generic over the field enum so the
 * grid passes <SortDropdown<SortField>/> with GRID_SORT_OPTIONS, and the
 * tree passes <SortDropdown<HierarchySortField>/> with TREE_SORT_OPTIONS.
 *
 * Render contract (UI-SPEC §"<SortDropdown/> API contract" + §"Dimensional
 * contract"):
 *   - Closed: trigger button only; popover NOT in DOM (no listbox <ul>)
 *   - Open: same trigger; popover absolute-positioned below; chevron rotated
 *     180deg via Tailwind rotate-180; option list with selected option marked
 *     by a Check icon (lucide-preact)
 *
 * Accessibility (WAI-ARIA APG combobox 1.2 select-only pattern, simplified
 * for non-typeahead v1.2):
 *   - Trigger: role='combobox' + aria-haspopup='listbox' + aria-expanded +
 *     aria-controls + aria-activedescendant + aria-label (required prop)
 *   - Popover: role='listbox' + tabIndex=-1 + matching id (so trigger's
 *     aria-controls resolves to the listbox)
 *   - Options: role='option' + aria-selected + tabIndex=-1 + stable ids for
 *     aria-activedescendant
 *
 * Keyboard handling (per APG):
 *   - Trigger focused, closed:
 *       Enter / Space / ArrowDown → opens, focus on selected option (or first
 *         if no selected match)
 *       ArrowUp → opens, focus on last option
 *   - Listbox focused, open:
 *       ArrowDown / ArrowUp → navigate with wrap (last → first, first → last)
 *       Home / End → jump to first / last option
 *       Enter / Space → select focused option, close, return focus to trigger
 *       Escape → close WITHOUT selecting, return focus to trigger
 *       Tab → APG editorial: select focused option + close (parent's normal
 *         tab order resumes from the next focusable element after the trigger)
 *   - Outside-click (mousedown on document not contained by trigger or
 *     listbox) → close WITHOUT selecting
 *
 * Motion: chevron rotates 180deg via CSS transition-transform (≤150ms) which
 * the existing theme.css `prefers-reduced-motion: reduce` rule handles
 * automatically. Popover unmount/remount has NO animation per Phase 5
 * restraint (UI-SPEC).
 *
 * SECURITY (T-18-03): option labels render as JSX text children — Preact
 * auto-escapes. NO dangerouslySetInnerHTML; option labels come from the
 * hardcoded GRID_SORT_OPTIONS / TREE_SORT_OPTIONS constants (sortHelpers.ts)
 * — never user-controlled.
 *
 * Architecture-purity (D-WEBUI-31): zero imports from src/. Types come from
 * the local mirror at '../lib/sortTypes.js'.
 */

import { useState, useRef, useEffect, useId } from 'preact/hooks';
import type { VNode, JSX } from 'preact';
import { ChevronDown, Check } from 'lucide-preact';
import type { SortDirection } from '../lib/sortTypes.js';

/**
 * One option in the dropdown — encodes both field and direction so each
 * option is a single-select pair. Mirrors SortOption in sortHelpers.ts but
 * defined locally so consumers importing only the component don't have to
 * import sortHelpers as well.
 */
export interface SortOption<TField extends string = string> {
  /** Stable id used as encoded value in localStorage + URL state. Format: 'field:dir'. */
  id: string;
  /** User-facing label (verbatim per UI-SPEC). Plain text — no HTML. */
  label: string;
  /** Field portion of id — exposed for type-safe consumers. */
  field: TField;
  /** Direction portion of id. */
  dir: SortDirection;
}

export interface SortDropdownProps<TField extends string = string> {
  /**
   * The full list of options visible in the popover. Caller passes
   * GRID_SORT_OPTIONS or TREE_SORT_OPTIONS (or any custom list of
   * SortOption<TField>). The component does NOT validate the ids — the
   * engine ORDER BY whitelist + URL/localStorage validators are the
   * authoritative gates per D-16 / D-24.
   */
  options: ReadonlyArray<SortOption<TField>>;
  /**
   * The currently-selected sort. The trigger renders the matching option's
   * label; the popover marks the matching option with aria-selected='true'
   * + a Check icon. If no match, the trigger renders the first option's
   * label (defensive fallback per UI-SPEC).
   */
  value: { field: TField; dir: SortDirection };
  /**
   * Fired when the user picks an option. Receives the new {field, dir} pair.
   * Caller persists the new value to localStorage + URL state via
   * persistGridSort/persistTreeSort (sortHelpers.ts). The component itself
   * does NOT touch localStorage or window.history.
   */
  onChange: (next: { field: TField; dir: SortDirection }) => void;
  /**
   * ARIA label for the trigger button. Required (D-discretion):
   *   - Grid instance: 'Sort versions by'
   *   - Tree instance: 'Sort tree by'
   * Imported as named constants from lib/copy.ts (SORT_GRID_ARIA_LABEL /
   * SORT_TREE_ARIA_LABEL).
   */
  ariaLabel: string;
  /** Optional class for the outermost wrapper (composition with parent). */
  class?: string;
}

export function SortDropdown<TField extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  class: className,
}: SortDropdownProps<TField>): VNode {
  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState<number>(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();
  const optionIdPrefix = useId();

  // Index of the option matching the current value (for initial focus on open).
  // -1 if no match (defensive fallback — render first option's label in the
  // trigger but DO NOT mark it selected).
  const selectedIdx = options.findIndex(
    (o) => o.field === value.field && o.dir === value.dir,
  );
  const displayIdx = selectedIdx >= 0 ? selectedIdx : 0;

  function openListbox(focusOn: 'selected' | 'first' | 'last'): void {
    setOpen(true);
    setFocusedIdx(
      focusOn === 'selected'
        ? Math.max(0, selectedIdx)
        : focusOn === 'first'
          ? 0
          : Math.max(0, options.length - 1),
    );
  }

  function closeListbox(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function selectAndClose(idx: number): void {
    if (idx < 0 || idx >= options.length) return;
    onChange({ field: options[idx].field, dir: options[idx].dir });
    closeListbox(true);
  }

  // Outside-click handler — only attached while open. mousedown (NOT click)
  // so the close happens BEFORE any focusin event from the new target,
  // preventing the focus return from getting overridden.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent): void {
      const t = e.target as Node;
      if (
        !triggerRef.current?.contains(t) &&
        !listboxRef.current?.contains(t)
      ) {
        closeListbox(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  function onTriggerKeyDown(e: JSX.TargetedKeyboardEvent<HTMLButtonElement>): void {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (open) closeListbox(false);
      else openListbox('selected');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openListbox('last');
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      closeListbox(true);
    }
  }

  function onListboxKeyDown(e: JSX.TargetedKeyboardEvent<HTMLUListElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIdx((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIdx((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusedIdx(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocusedIdx(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectAndClose(focusedIdx);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeListbox(true);
    } else if (e.key === 'Tab') {
      // APG editorial — Tab selects focused option + closes (no preventDefault
      // so the natural tab order resumes from the next focusable element).
      selectAndClose(focusedIdx);
    }
  }

  const currentLabel = options[displayIdx]?.label ?? '';
  const activeDescendantId = open ? `${optionIdPrefix}-${focusedIdx}` : undefined;

  return (
    <div class={`relative inline-block${className ? ` ${className}` : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={activeDescendantId}
        class="h-8 px-3 py-2 text-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] inline-flex items-center gap-1"
        onClick={() => (open ? closeListbox(false) : openListbox('selected'))}
        onKeyDown={onTriggerKeyDown}
      >
        <span>{currentLabel}</span>
        <ChevronDown
          size={14}
          class={`text-[var(--color-fg-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          class="absolute z-10 mt-1 min-w-[180px] py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
          onKeyDown={onListboxKeyDown}
        >
          {options.map((opt, idx) => {
            const isSelected = idx === selectedIdx;
            const isFocused = idx === focusedIdx;
            return (
              <li
                key={opt.id}
                id={`${optionIdPrefix}-${idx}`}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                class={`h-8 px-3 py-2 text-sm flex items-center gap-1 cursor-pointer ${
                  isSelected
                    ? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
                    : isFocused
                      ? 'bg-[var(--color-surface-alt)]'
                      : ''
                }`}
                onClick={() => selectAndClose(idx)}
                onMouseEnter={() => setFocusedIdx(idx)}
              >
                {isSelected ? (
                  <Check size={14} />
                ) : (
                  <span class="w-3.5" aria-hidden="true" />
                )}
                <span>{opt.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
