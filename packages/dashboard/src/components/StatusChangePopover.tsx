/**
 * StatusChangePopover — shared anchored confirmation popover for Phase 22's
 * 5 review actions (approve / retake / hold / omit / restore).
 *
 * D-05 (single shared component): consumed by both ReviewActionBar (in 22-05)
 * and QuickApproveButton (in 22-07). The only visual differentiator across
 * actions is the prompt sentence — popover styling stays identical, no
 * destructive variant (D-08 lock: Omit is reversible via Restore).
 *
 * D-09 (Restore textarea-hide): action='restore' renders no textarea; the
 * submitted note is always the literal RESTORE_NOTE_SYSTEM_TEXT constant.
 * Other actions trim the note and substitute null when blank (REV-04 +
 * D-07 client-side discipline).
 *
 * Mechanics borrowed verbatim from SortDropdown (SortDropdown.tsx:155-211):
 *  - outside-click via document.mousedown while open (mousedown not click
 *    so close fires BEFORE focusin from the new target)
 *  - ESC closes from inside the popover
 *  - focus-return on any close path (anchorRef.current?.focus() BEFORE
 *    onCancel fires, so focus never falls to <body> on unmount).
 *
 * Pitfall 9 (RESEARCH lines 681-685): the popover is NEVER wrapped in
 * <form>. Cancel + Confirm are explicit type="button" with onClick handlers
 * so Enter inside the textarea inserts a newline (not submit).
 */

import { useState, useRef, useEffect, useId } from 'preact/hooks';
import type { JSX, RefObject } from 'preact';
import type { ReviewAction } from '../types/review-panel.js';
import {
  REVIEW_APPROVE_PROMPT,
  REVIEW_RETAKE_PROMPT,
  REVIEW_HOLD_PROMPT,
  REVIEW_OMIT_PROMPT,
  REVIEW_RESTORE_PROMPT,
  POPOVER_CANCEL_LABEL,
  POPOVER_CONFIRM_LABEL,
  POPOVER_CONFIRM_PENDING,
  POPOVER_NOTE_PLACEHOLDER,
  POPOVER_NOTE_LABEL,
  POPOVER_DIALOG_ARIA_LABEL_PREFIX,
  RESTORE_NOTE_SYSTEM_TEXT,
} from '../lib/copy.js';

const PROMPT_FOR: Record<ReviewAction, string> = {
  approve: REVIEW_APPROVE_PROMPT,
  retake: REVIEW_RETAKE_PROMPT,
  hold: REVIEW_HOLD_PROMPT,
  omit: REVIEW_OMIT_PROMPT,
  restore: REVIEW_RESTORE_PROMPT,
};

export interface StatusChangePopoverProps {
  action: ReviewAction;
  /** Anchor element to return focus to on close (ESC / outside-click / cancel). */
  anchorRef: RefObject<HTMLElement>;
  isOpen: boolean;
  /**
   * Called with the final note string (or null when blank, per REV-04/D-07).
   * For action='restore', note is always RESTORE_NOTE_SYSTEM_TEXT (D-09).
   * Parent is responsible for closing the popover (set isOpen=false) on success.
   */
  onConfirm: (note: string | null) => Promise<void>;
  onCancel: () => void;
}

export function StatusChangePopover({
  action,
  anchorRef,
  isOpen,
  onConfirm,
  onCancel,
}: StatusChangePopoverProps): JSX.Element | null {
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState<string>('');
  const [pending, setPending] = useState<boolean>(false);
  const promptId = useId();

  // Auto-focus on open: textarea for note-taking actions; Cancel for Restore.
  useEffect(() => {
    if (!isOpen) {
      // Reset note state whenever the popover closes — next open starts blank.
      setNote('');
      return;
    }
    if (action === 'restore') {
      popoverRef.current
        ?.querySelector<HTMLButtonElement>('[data-cancel]')
        ?.focus();
    } else {
      textareaRef.current?.focus();
    }
  }, [isOpen, action]);

  // Outside-click while open (mousedown, NOT click — see file header).
  useEffect(() => {
    if (!isOpen) return;
    function onDocMouseDown(e: MouseEvent): void {
      const t = e.target as Node;
      if (
        !popoverRef.current?.contains(t) &&
        !anchorRef.current?.contains(t)
      ) {
        // focus-return BEFORE close (Pattern E — don't drop focus to body)
        anchorRef.current?.focus();
        onCancel();
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [isOpen, anchorRef, onCancel]);

  function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      // focus-return BEFORE close (same discipline as outside-click handler)
      anchorRef.current?.focus();
      onCancel();
    }
  }

  async function handleConfirm(): Promise<void> {
    setPending(true);
    const finalNote =
      action === 'restore'
        ? RESTORE_NOTE_SYSTEM_TEXT
        : note.trim() === ''
          ? null
          : note.trim();
    try {
      await onConfirm(finalNote);
    } finally {
      setPending(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={promptId}
      aria-label={`${POPOVER_DIALOG_ARIA_LABEL_PREFIX}${PROMPT_FOR[action]}`}
      onKeyDown={onKeyDown}
      class="absolute z-20 mt-2 min-w-[280px] max-w-[360px] rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg"
    >
      <p id={promptId} class="text-sm mb-2 text-[var(--color-fg)]">
        {PROMPT_FOR[action]}
      </p>

      {action !== 'restore' ? (
        <textarea
          ref={textareaRef}
          value={note}
          onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          rows={3}
          placeholder={POPOVER_NOTE_PLACEHOLDER}
          aria-label={POPOVER_NOTE_LABEL}
          disabled={pending}
          class="block w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-2 text-sm text-[var(--color-fg)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50"
        />
      ) : null}

      <div class="mt-3 flex justify-end gap-1">
        <button
          data-cancel
          type="button"
          onClick={onCancel}
          disabled={pending}
          class="rounded px-2 py-1 text-xs font-normal text-[var(--color-fg)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50"
        >
          {POPOVER_CANCEL_LABEL}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          aria-busy={pending}
          class="rounded bg-[var(--color-accent)] px-2 py-1 text-xs font-normal text-[var(--color-bg)] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50"
        >
          {pending ? POPOVER_CONFIRM_PENDING : POPOVER_CONFIRM_LABEL}
        </button>
      </div>
    </div>
  );
}
