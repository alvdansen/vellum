/**
 * ProposalNotePopover — the note-entry confirmation popover for a proposal
 * decision. Covers the accessibility discipline shared with StatusChangePopover:
 * ESC-close, outside-click dismissal, focus-return to the anchor, blank-note →
 * null, and the confirm/cancel wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { ProposalNotePopover } from '../ProposalNotePopover.js';

/** Harness: an anchor button that opens the popover, so anchorRef is real. */
function Harness({ onConfirm }: { onConfirm: (n: string | null) => Promise<void> }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button ref={anchorRef} type="button" data-testid="anchor" onClick={() => setOpen(true)}>
        anchor
      </button>
      <ProposalNotePopover
        prompt="Approve this generation?"
        anchorRef={anchorRef}
        isOpen={open}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
      <button type="button" data-testid="outside">
        outside
      </button>
    </div>
  );
}

const onConfirm = vi.fn();

beforeEach(() => {
  onConfirm.mockReset().mockResolvedValue(undefined);
});

describe('ProposalNotePopover', () => {
  it('renders the prompt and a note textarea when open', () => {
    const { getByText, getByLabelText } = render(<Harness onConfirm={onConfirm} />);
    expect(getByText('Approve this generation?')).toBeInTheDocument();
    expect(getByLabelText('Decision note')).toBeInTheDocument();
  });

  it('confirms with the trimmed note', async () => {
    const { getByLabelText, getByText } = render(<Harness onConfirm={onConfirm} />);
    fireEvent.input(getByLabelText('Decision note'), { target: { value: '  ship it  ' } });
    fireEvent.click(getByText('Confirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('ship it'));
  });

  it('confirms with null when the note is blank', async () => {
    const { getByText } = render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(getByText('Confirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(null));
  });

  it('closes on ESC and returns focus to the anchor', () => {
    const { getByRole, getByTestId } = render(<Harness onConfirm={onConfirm} />);
    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' });
    // Popover unmounts (isOpen flipped false by onCancel)
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(getByTestId('anchor'));
  });

  it('dismisses on an outside mousedown without confirming', () => {
    const { getByTestId } = render(<Harness onConfirm={onConfirm} />);
    fireEvent.mouseDown(getByTestId('outside'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing when isOpen is false', () => {
    const anchor = { current: null };
    const { container } = render(
      <ProposalNotePopover
        prompt="x"
        anchorRef={anchor as never}
        isOpen={false}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
