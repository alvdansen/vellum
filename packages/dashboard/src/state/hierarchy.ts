// packages/dashboard/src/state/hierarchy.ts
//
// @preact/signals-backed store for the TreeSidebar hierarchy (Plan 05-09).
// Tracks the currently-loaded workspaces list plus the "selected path" —
// one ID per hierarchy level so the sidebar can highlight the open chain.
//
// Architecture-purity invariant (D-WEBUI-31): this file performs zero
// server-tree relative-import traversals. Uses dashboard-local entity DTOs
// from ../types/entities.ts.
//
// Plan 05-08 Task 2 — lightweight signal bag consumed by Plan 05-09
// components. Each signal is default-null / empty; view components hydrate
// them via api.ts fetches on mount or on node expansion.

import { signal } from '@preact/signals';
import type { Workspace } from '../types/entities.js';

/** Root list — hydrated via fetchWorkspaces() at app boot. */
export const workspaces = signal<Workspace[]>([]);

/** Currently-selected workspace (null = none chosen). */
export const selectedWorkspaceId = signal<string | null>(null);

/** Currently-selected project under the selected workspace. */
export const selectedProjectId = signal<string | null>(null);

/** Currently-selected sequence under the selected project. */
export const selectedSequenceId = signal<string | null>(null);

/** Currently-selected shot under the selected sequence. */
export const selectedShotId = signal<string | null>(null);
