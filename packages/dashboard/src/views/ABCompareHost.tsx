/**
 * ABCompareHost — Phase 22 / Plan 22-04 placeholder.
 *
 * Reads `compareModalOpen` from state/review-panel.ts and renders a z-30
 * modal backdrop when true. The full ABCompareView composition (parallel
 * thumbnail preload, MetadataDiff fetch, focus-trap, ESC/Cancel handling)
 * ships in Plan 22-06; this placeholder unblocks 22-04's App.tsx wiring
 * so the OverlayHost integration tests can validate compareModalOpen=true
 * surfaces a dialog at the right z-index.
 *
 * Lives as a sibling to OverlayHost in App.tsx — explicitly NOT mutex'd
 * with the right-rail overlays. The modal is the z-30 layer above any open
 * right-rail drawer (D-15 + RESEARCH Q4).
 *
 * Architecture-purity (D-WEBUI-31): only sibling dashboard imports.
 */

import type { JSX } from 'preact';
import { compareModalOpen } from '../state/review-panel.js';

export function ABCompareHost(): JSX.Element | null {
  if (!compareModalOpen.value) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="A/B compare placeholder"
      class="fixed inset-0 z-30 bg-black/60"
      data-testid="ab-compare-placeholder"
    />
  );
}
