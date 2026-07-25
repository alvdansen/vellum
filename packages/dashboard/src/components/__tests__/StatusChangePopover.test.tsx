/**
 * Phase 22 / Plan 22-03 — StatusChangePopover component tests.
 *
 * Covers D-05 mechanics (outside-click + ESC + focus-return), D-07 client-side
 * note coercion (REV-04 trim-to-null), and D-09 Restore textarea-hide.
 *
 * Setup pattern (per plan): mount the popover inside a wrapper containing a
 * real `<button>` anchor — so `anchorRef.current?.focus()` is a real DOM call.
 * Outside-click is simulated by dispatching a mousedown event with target=body.
 *
 * Pitfall 9 averted: the popover is NOT a `<form>`. Enter inside textarea is
 * a newline; only the explicit Confirm button onClick triggers submit.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import type { JSX, RefObject } from 'preact';
import { StatusChangePopover } from '../StatusChangePopover.js';
import type { ReviewAction } from '../../types/review-panel.js';
import {
  REVIEW_APPROVE_PROMPT,
  REVIEW_RETAKE_PROMPT,
  REVIEW_RESTORE_PROMPT,
  POPOVER_CANCEL_LABEL,
  POPOVER_CONFIRM_LABEL,
  POPOVER_CONFIRM_PENDING,
  POPOVER_NOTE_PLACEHOLDER,
  RESTORE_NOTE_SYSTEM_TEXT,
} from '../../lib/copy.js';

afterEach(() => {
  cleanup();
});

interface HarnessProps {
  action: ReviewAction;
  initiallyOpen: boolean;
  onConfirm: (note: string | null) => Promise<void>;
  onCancel: () => void;
  /** Optional ref-tap for the test to grab the anchor directly. */
  anchorTap?: (ref: RefObject<HTMLButtonElement>) => void;
}

function Harness({
  action,
  initiallyOpen,
  onConfirm,
  onCancel,
  anchorTap,
}: HarnessProps): JSX.Element {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(initiallyOpen);
  if (anchorTap) anchorTap(anchorRef);
  return (
    <div>
      <button ref={anchorRef} type="button" onClick={() => setOpen(true)}>
        anchor
      </button>
      <StatusChangePopover
        action={action}
        anchorRef={anchorRef}
        isOpen={open}
        onConfirm={async (note) => {
          await onConfirm(note);
        }}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
      />
    </div>
  );
}

describe('StatusChangePopover — visibility', () => {
  it('renders null when isOpen=false', () => {
    const { container } = render(
      <Harness
        action="approve"
        initiallyOpen={false}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders dialog when isOpen=true', () => {
    const { container } = render(
      <Harness
        action="approve"
        initiallyOpen={true}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('false');
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy();
  });
});

describe('StatusChangePopover — prompt text per action', () => {
  it('action=approve → renders REVIEW_APPROVE_PROMPT verbatim', () => {
    const { getByText } = render(
      <Harness
        action="approve"
        initiallyOpen={true}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );
    expect(getByText(REVIEW_APPROVE_PROMPT)).toBeTruthy();
  });

  it('action=retake → renders REVIEW_RETAKE_PROMPT verbatim', () => {
    const { getByText } = render(
      <Harness
        action="retake"
        initiallyOpen={true}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );
    expect(getByText(REVIEW_RETAKE_PROMPT)).toBeTruthy();
  });
});

describe('StatusChangePopover — D-09 Restore textarea-hide', () => {
  it('action=restore → textarea is NOT in DOM', () => {
    const { container } = render(
      <Harness
        action="restore"
        initiallyOpen={true}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelector('textarea')).toBeNull();
    // Prompt still renders
    expect(container.textContent).toContain(REVIEW_RESTORE_PROMPT);
  });

  it('action=approve → textarea IS in DOM', () => {
    const { container } = render(
      <Harness
        action="approve"
        initiallyOpen={true}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );
    const ta = container.querySelector('textarea');
    expect(ta).not.toBeNull();
    expect(ta?.getAttribute('placeholder')).toBe(POPOVER_NOTE_PLACEHOLDER);
    expect(ta?.getAttribute('rows')).toBe('3');
  });
});

describe('StatusChangePopover — ESC + focus-return (D-05)', () => {
  it('ESC key on dialog calls onCancel AND returns focus to anchor', () => {
    const onCancel = vi.fn();
    let capturedAnchor: RefObject<HTMLButtonElement> | null = null;
    const { container } = render(
      <Harness
        action="approve"
        initiallyOpen={true}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={onCancel}
        anchorTap={(ref) => {
          capturedAnchor = ref;
        }}
      />,
    );
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    const focusSpy = vi.spyOn(
      capturedAnchor!.current as HTMLButtonElement,
      'focus',
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(focusSpy).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('StatusChangePopover — outside-click closes + focus return', () => {
  it('mousedown outside popover & anchor → onCancel + anchor.focus()', () => {
    const onCancel = vi.fn();
    let capturedAnchor: RefObject<HTMLButtonElement> | null = null;
    render(
      <Harness
        action="approve"
        initiallyOpen={true}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={onCancel}
        anchorTap={(ref) => {
          capturedAnchor = ref;
        }}
      />,
    );
    const focusSpy = vi.spyOn(
      capturedAnchor!.current as HTMLButtonElement,
      'focus',
    );
    // Dispatch a mousedown on document.body (truly outside)
    const outsideEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(outsideEvent);
    expect(focusSpy).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('StatusChangePopover — D-07 + REV-04 note coercion', () => {
  it('action=approve + empty textarea + Confirm → onConfirm(null)', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const { getByText } = render(
      <Harness
        action="approve"
        initiallyOpen={true}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(getByText(POPOVER_CONFIRM_LABEL));
    // Promise microtask flush
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it('action=approve + textarea "looks great" + Confirm → onConfirm("looks great")', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const { container, getByText } = render(
      <Harness
        action="approve"
        initiallyOpen={true}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: 'looks great' } });
    fireEvent.click(getByText(POPOVER_CONFIRM_LABEL));
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalledWith('looks great');
  });

  it('action=approve + textarea whitespace-only + Confirm → onConfirm(null)', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const { container, getByText } = render(
      <Harness
        action="approve"
        initiallyOpen={true}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: '   ' } });
    fireEvent.click(getByText(POPOVER_CONFIRM_LABEL));
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it('action=restore + Confirm → onConfirm(RESTORE_NOTE_SYSTEM_TEXT)', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const { getByText } = render(
      <Harness
        action="restore"
        initiallyOpen={true}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(getByText(POPOVER_CONFIRM_LABEL));
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalledWith(RESTORE_NOTE_SYSTEM_TEXT);
  });
});

describe('StatusChangePopover — pending state on Confirm', () => {
  it('Confirm in flight → button disabled + shows POPOVER_CONFIRM_PENDING', async () => {
    let resolveConfirm: () => void = () => {};
    const pendingPromise = new Promise<void>((r) => {
      resolveConfirm = r;
    });
    const onConfirm = vi.fn().mockReturnValue(pendingPromise);
    const { getByText, queryByText, container } = render(
      <Harness
        action="approve"
        initiallyOpen={true}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(getByText(POPOVER_CONFIRM_LABEL));
    await Promise.resolve();
    // After click, the button label flips to "Submitting…" and is disabled
    expect(queryByText(POPOVER_CONFIRM_PENDING)).toBeTruthy();
    const buttons = container.querySelectorAll('button[aria-busy]');
    expect(buttons.length).toBeGreaterThan(0);
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    // Cancel is also disabled during pending
    const cancelBtn = getByText(POPOVER_CANCEL_LABEL) as HTMLButtonElement;
    expect(cancelBtn.disabled).toBe(true);
    // Resolve the pending promise and tick again — pending clears
    resolveConfirm();
    await pendingPromise;
    await new Promise((r) => setTimeout(r, 0));
    expect(queryByText(POPOVER_CONFIRM_PENDING)).toBeNull();
  });
});
