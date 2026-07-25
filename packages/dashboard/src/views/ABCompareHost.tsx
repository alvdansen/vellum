/**
 * ABCompareHost — Phase 22 / Plan 22-06.
 *
 * Reads `compareModalOpen` + `compareSelection` from state/review-panel.ts.
 * When the modal is open AND both compareSelection.a/.b are non-null, it
 * resolves the two Version refs from the cached shotGrid (versions live
 * inside the open ReviewPanel's prop tree, but for the modal we just need
 * the id + version_number — both are present in the engine wire shape).
 * Renders `<ABCompareView/>` with `onClose={() => compareModalOpen.value = false}`.
 *
 * Pitfall 6 mitigation: when activeReviewShotId changes, clear
 * compareSelection so the modal can't open with stale (cross-shot) pairs.
 *
 * Lives as a sibling to OverlayHost in App.tsx — NOT mutex'd with the
 * right-rail drawers. Modal sits at z-30 above any open drawer (D-15 /
 * RESEARCH Q4).
 *
 * Resolving versionA + versionB: we accept them as a derived prop bag
 * passed in from a parent (the review panel surface in 22-07). For this
 * plan the host signature is "self-resolving via shotGrid" only when the
 * caller hasn't supplied versions explicitly — but in practice the
 * caller (22-07 ReviewTimeline checkboxes) sets compareSelection AND
 * passes the resolved version pair via a parent-supplied lookup. To keep
 * this layer minimal and decoupled, the host accepts an optional
 * `versionsById` map that the parent can pass through; the modal renders
 * only when both ids resolve to entries. When versionsById is absent, the
 * host falls back to rendering nothing (defensive — better to no-op than
 * crash).
 */

import { useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  compareModalOpen,
  compareSelection,
  activeReviewShotId,
} from '../state/review-panel.js';
import { ABCompareView } from './ABCompareView.js';
import { shotGrid } from '../state/shot-grid.js';

interface VersionSummary {
  id: string;
  version_number: number;
}

export interface ABCompareHostProps {
  /**
   * Optional caller-supplied resolver: maps version id → minimal Version
   * shape (id + version_number). When present, the host uses it to
   * resolve compareSelection.a/.b. When absent, the modal stays closed
   * (the consuming surface — 22-07 ReviewTimeline — passes the resolver).
   */
  versionsById?: Map<string, VersionSummary>;
}

export function ABCompareHost({ versionsById }: ABCompareHostProps = {}): JSX.Element | null {
  // Pitfall 6: clear compareSelection when the open shot changes. Prevents
  // a stale a/b pair from a prior shot triggering the modal.
  useEffect(() => {
    compareSelection.value = { a: null, b: null };
    compareModalOpen.value = false;
  }, [activeReviewShotId.value]);

  if (!compareModalOpen.value) return null;
  const sel = compareSelection.value;
  if (sel.a === null || sel.b === null) return null;
  if (versionsById === undefined) return null;

  const versionA = versionsById.get(sel.a);
  const versionB = versionsById.get(sel.b);
  if (versionA === undefined || versionB === undefined) return null;

  const shotName =
    shotGrid.value?.shots.find((s) => s.id === activeReviewShotId.value)?.name ??
    'shot';

  return (
    <ABCompareView
      shotName={shotName}
      versionA={versionA}
      versionB={versionB}
      onClose={() => {
        compareModalOpen.value = false;
      }}
    />
  );
}
