// packages/dashboard/src/state/versions.ts
//
// @preact/signals-backed store for the versions list under the selected
// shot, plus the currently-open version-detail drawer target (Plan 05-10).
//
// Architecture-purity invariant (D-WEBUI-31): this file performs zero
// server-tree relative-import traversals. Uses dashboard-local entity DTOs
// from ../types/entities.ts.
//
// Plan 05-08 Task 2 — lightweight signal bag consumed by Plan 05-10
// components. The version list is hydrated via fetchVersions(shotId, ...)
// when selectedShotId changes; the drawer target mirrors a row click.

import { signal } from '@preact/signals';
import type { Version } from '../types/entities.js';

/** Versions list for the currently-selected shot. Empty when no shot chosen. */
export const versions = signal<Version[]>([]);

/**
 * The version currently open in the version-detail drawer. null = drawer
 * closed. Drawer component reads this signal to decide whether to render.
 */
export const selectedVersionId = signal<string | null>(null);
