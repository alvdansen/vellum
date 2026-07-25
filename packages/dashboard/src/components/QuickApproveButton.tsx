/**
 * Phase 22 / Plan 22-07 — QuickApproveButton (D-10 + D-12).
 *
 * Hover-only Check icon button positioned absolute top-right of the
 * ShotGridCard thumbnail. D-10: opacity-0 by default, opacity-100 on
 * group-hover OR group-focus-within (keyboard accessibility — focus path
 * exposes the button even when the mouse isn't over the card).
 *
 * REV-02 optimistic flow (Pattern 3):
 *  1. Click → opens StatusChangePopover anchored to the button
 *  2. Confirm → mutate shotGrid.value.shots[idx].status='approved' BEFORE
 *     awaiting PATCH (optimistic)
 *  3. On success: no further change — SSE shot.status_changed arrives and
 *     hits the idempotent onShotStatusChanged handler (Pitfall 8: it
 *     converges to the broadcast value; no special coordination)
 *  4. On failure: revert the mutation AND set quickApproveError = shotId.
 *     Auto-dismiss after 5s with Pitfall 5 guard: the setTimeout no-ops
 *     if quickApproveError already changed (e.g., the user retried
 *     successfully or another shot's error displaced it).
 *
 * Pitfall 4 averted: this button is a SIBLING of the thumbnail-button and
 * ShotStatusPill button inside ShotGridCard's outer `<div class="group">`.
 * Never nested inside another button.
 */

import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Check } from 'lucide-preact';
import { setShotStatus } from '../lib/api.js';
import { shotGrid } from '../state/shot-grid.js';
import { quickApproveError } from '../state/review-panel.js';
import { StatusChangePopover } from './StatusChangePopover.js';
import { REVIEW_QUICK_APPROVE_ARIA_PREFIX } from '../lib/copy.js';
import type { ShotStatus } from '../types/shot-grid.js';

export interface QuickApproveButtonProps {
  shotId: string;
  shotName: string;
  currentStatus: ShotStatus;
}

export function QuickApproveButton({
  shotId,
  shotName,
  currentStatus,
}: QuickApproveButtonProps): JSX.Element {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  async function handleQuickApprove(note: string | null): Promise<void> {
    const current = shotGrid.value;
    if (!current) return;
    const idx = current.shots.findIndex((s) => s.id === shotId);
    if (idx < 0) return;
    const priorStatus = currentStatus;

    // 1. Optimistic mutation FIRST (D-12)
    shotGrid.value = {
      ...current,
      shots: current.shots.map((s, i) =>
        i === idx ? { ...s, status: 'approved' as ShotStatus } : s,
      ),
    };
    quickApproveError.value = null;
    setIsOpen(false);

    // 2. PATCH
    try {
      await setShotStatus(shotId, {
        to_status: 'approved',
        note,
        changed_by: 'user',
      });
      // 3a. Success — SSE will arrive; idempotent handler no-ops.
    } catch (err) {
      // 3b. Revert. Local-only — no SSE to undo since the engine rejected.
      const cur = shotGrid.value;
      if (cur) {
        shotGrid.value = {
          ...cur,
          shots: cur.shots.map((s, i) =>
            i === idx ? { ...s, status: priorStatus } : s,
          ),
        };
      }
      quickApproveError.value = shotId;
      // Auto-dismiss after 5s — Pitfall 5: guard with signal-value check
      // so a stale timer never overwrites the current error state.
      setTimeout(() => {
        if (quickApproveError.value === shotId) {
          quickApproveError.value = null;
        }
      }, 5000);
    }
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`${REVIEW_QUICK_APPROVE_ARIA_PREFIX}${shotName}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        class="absolute top-1 right-1 z-1 inline-flex h-6 w-6 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] hover:bg-[var(--color-shot-status-approved)] hover:text-[var(--color-bg)]"
      >
        <Check size={16} />
      </button>
      <StatusChangePopover
        action="approve"
        anchorRef={anchorRef}
        isOpen={isOpen}
        onConfirm={handleQuickApprove}
        onCancel={() => setIsOpen(false)}
      />
    </>
  );
}
