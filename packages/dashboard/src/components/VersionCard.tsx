/**
 * VersionCard — single version's thumbnail + metadata card for the shot-detail grid.
 *
 * Pure component: props-in, callbacks-out. No fetch, no signal reads, no side
 * effects. Parent (Plan 10 views) passes the Version record + selected flag +
 * onSelect handler.
 *
 * Type contract:
 *   - `Version` shape below is the minimal field set this component reads.
 *   - Full Version type lives in the data layer (Plan 08 types/entities.ts) —
 *     that file is owned by another parallel agent, so we declare the minimal
 *     structural type this card needs and let the wider Version shape be
 *     structurally compatible via TypeScript's duck-typing.
 *
 * SECURITY — T-5-06: {version.label} is rendered as text via Preact's virtual
 * DOM (auto-escaped). dangerouslySetInnerHTML is not used.
 */

import { StatusPill } from './StatusPill.js';
import type { Status } from './StatusPill.js';
import { getOutputUrl } from '../lib/api.js';

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
}

export function VersionCard({ version, isSelected, onSelect }: VersionCardProps) {
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
      {version.status === 'complete' ? (
        <img
          src={getOutputUrl(version.id)}
          alt={`Output for ${version.label}`}
          class="block aspect-video w-full object-cover"
          loading="lazy"
        />
      ) : null}
      <div class={`flex items-center justify-between gap-2 p-2 ${isSelected ? 'bg-[var(--color-accent)] text-[var(--color-bg)]' : 'text-[var(--color-fg)]'}`}>
        <span class="version-label truncate text-sm font-normal">
          {version.label}
        </span>
        <StatusPill status={version.status} />
      </div>
    </button>
  );
}
