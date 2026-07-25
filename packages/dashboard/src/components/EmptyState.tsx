/**
 * EmptyState — centered "nothing here yet" messaging for empty hierarchies, shots,
 * and version grids.
 *
 * Pure component: props-in, no callbacks (read-only display).
 *
 * Copy comes from the caller (UI-SPEC.md copywriting contract has 7 variants by
 * scope: home/workspace/project/sequence/shot/active-generations/asset-query).
 * This primitive renders whatever caller provides — no copy hardcoded here.
 */

export interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div
      class="flex flex-col items-center justify-center gap-2 py-16 text-[var(--color-fg-muted)]"
      role="status"
    >
      <span class="text-sm">{message}</span>
    </div>
  );
}
