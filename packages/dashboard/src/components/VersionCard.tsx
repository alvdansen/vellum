/**
 * VersionCard — single version's thumbnail + metadata card for the shot-detail grid.
 *
 * Pure component: props-in, callbacks-out. No fetch, no signal reads, no side
 * effects. Parent views pass the Version record + selected flag +
 * onSelect handler.
 *
 * Type contract:
 *   - `Version` shape below is the minimal field set this component reads.
 *   - Full Version type lives in the data layer (types/entities.ts) —
 *     we declare the minimal
 *     structural type this card needs and let the wider Version shape be
 *     structurally compatible via TypeScript's duck-typing.
 *
 * The preview renders via <Thumbnail size='card'/>, which
 * uses object-contain semantics — no crop-to-fill
 * (no letterbox cropping; transparent letterbox bars adapt to theme).
 * The <button> wrapper owns the click — clicks bubble
 * through Thumbnail (which has no click handlers) to onSelect.
 *
 * SECURITY: {version.label} is rendered as text via Preact's virtual
 * DOM (auto-escaped). dangerouslySetInnerHTML is not used.
 */

import { StatusPill } from './StatusPill.js';
import type { Status } from './StatusPill.js';
import { Thumbnail } from './Thumbnail.js';
import type { C2paStatus } from '../lib/api.js';

/**
 * Minimal version shape needed by this card. The full Version record (from
 * the data layer / REST API) will be structurally compatible with this — any
 * object that has these fields satisfies the prop type.
 */
export interface VersionCardVersion {
  id: string;
  label: string;
  status: Status;
}

export interface VersionCardProps {
  version: VersionCardVersion;
  isSelected: boolean;
  onSelect: (versionId: string) => void;
  /**
   * c2paStatus governs the <C2paShield/> overlay
   * (predicate is `c2paStatus?.status === 'signed'`). Optional:
   * when undefined or not 'signed', NO shield is rendered. Threaded through
   * to <Thumbnail/> verbatim. Existing call sites in HomeView do NOT yet
   * provide c2paStatus, so the optional default keeps the surface
   * backward-compatible until that wiring lands.
   */
  c2paStatus?: C2paStatus;
}

export function VersionCard({
  version,
  isSelected,
  onSelect,
  c2paStatus,
}: VersionCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(version.id)}
      aria-pressed={isSelected}
      class={`w-full overflow-hidden rounded text-left transition-colors ${
        isSelected
          ? 'ring-2 ring-[var(--color-accent)]'
          : 'hover:bg-[var(--color-surface)]'
      }`}
    >
      <Thumbnail
        version={{
          id: version.id,
          label: version.label,
          status: version.status,
        }}
        size="card"
        c2paStatus={c2paStatus}
      />
      <div class={`flex items-center justify-between gap-2 p-2 ${isSelected ? 'bg-[var(--color-accent)] text-[var(--color-bg)]' : 'text-[var(--color-fg)]'}`}>
        <span class="version-label truncate text-sm font-normal">
          {version.label}
        </span>
        <StatusPill status={version.status} />
      </div>
    </button>
  );
}
