/**
 * ProposalNotePopover — anchored confirmation popover for a proposal decision
 * (approve | reject). A focused sibling of StatusChangePopover: same
 * accessibility discipline (outside-click via document.mousedown, ESC-to-close,
 * focus-return-before-close), but proposal-specific copy and a plain boolean
 * decision (no ReviewAction verb map).
 *
 * The note is optional: `note.trim() === ''` submits `null` (the server treats
 * a null note as "no note recorded"). Never wrapped in a <form> — Cancel and
 * Confirm are explicit type="button" so Enter in the textarea inserts a newline
 * rather than submitting.
 *
 * Parent owns open/close: it passes `isOpen` and closes on success by flipping
 * it false. On confirm the popover awaits `onConfirm(note)` with its own
 * pending flag so a slow decide keeps the Confirm button aria-busy.
 */

import { useState, useRef, useEffect, useId } from 'preact/hooks';
import type { JSX, RefObject } from 'preact';
import {
  PROPOSAL_NOTE_PLACEHOLDER,
  PROPOSAL_NOTE_LABEL,
  PROPOSAL_DECIDE_CONFIRM,
  PROPOSAL_DECIDE_CANCEL,
} from '../lib/copy.js';

export interface ProposalNotePopoverProps {
  /** The decision prompt sentence (approve vs reject copy). */
  prompt: string;
  /** Anchor element to return focus to on close (ESC / outside-click / cancel). */
  anchorRef: RefObject<HTMLElement>;
  isOpen: boolean;
  /** Confirm button label ("Confirm") — kept a prop for future per-action copy. */
  confirmLabel?: string;
  /**
   * Called with the final note string (or null when blank). Parent closes the
   * popover (set isOpen=false) on success.
   */
  onConfirm: (note: string | null) => Promise<void>;
  onCancel: () => void;
}

export function ProposalNotePopover({
  prompt,
  anchorRef,
  isOpen,
  confirmLabel = PROPOSAL_DECIDE_CONFIRM,
  onConfirm,
  onCancel,
}: ProposalNotePopoverProps): JSX.Element | null {
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState<string>('');
  const [pending, setPending] = useState<boolean>(false);
  const promptId = useId();

  // Auto-focus the textarea on open; reset note state on close so the next
  // open starts blank.
  useEffect(() => {
    if (!isOpen) {
      setNote('');
      return;
    }
    textareaRef.current?.focus();
  }, [isOpen]);

  // Outside-click while open (mousedown, NOT click — fires before focusin from
  // the new target; matches StatusChangePopover).
  useEffect(() => {
    if (!isOpen) return;
    function onDocMouseDown(e: MouseEvent): void {
      const t = e.target as Node;
      if (
        !popoverRef.current?.contains(t) &&
        !anchorRef.current?.contains(t)
      ) {
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
      anchorRef.current?.focus();
      onCancel();
    }
  }

  async function handleConfirm(): Promise<void> {
    setPending(true);
    const finalNote = note.trim() === '' ? null : note.trim();
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
      onKeyDown={onKeyDown}
      class="absolute right-0 z-20 mt-2 min-w-[280px] max-w-[360px] rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg"
    >
      <p id={promptId} class="text-sm mb-2 text-[var(--color-fg)]">
        {prompt}
      </p>
      <textarea
        ref={textareaRef}
        value={note}
        onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        rows={3}
        placeholder={PROPOSAL_NOTE_PLACEHOLDER}
        aria-label={PROPOSAL_NOTE_LABEL}
        disabled={pending}
        class="block w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-2 text-sm text-[var(--color-fg)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50"
      />
      <div class="mt-3 flex justify-end gap-1">
        <button
          data-cancel
          type="button"
          onClick={onCancel}
          disabled={pending}
          class="rounded px-2 py-1 text-xs font-normal text-[var(--color-fg)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50"
        >
          {PROPOSAL_DECIDE_CANCEL}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          aria-busy={pending}
          class="rounded bg-[var(--color-accent)] px-2 py-1 text-xs font-normal text-[var(--color-bg)] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
