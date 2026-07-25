/**
 * Phase 19 / Plan 19-05 Task 3 — Dashboard signal map for per-version
 * AI conversational summary state (SUM-01..06).
 *
 * Architecture-purity (D-WEBUI-31, Phase 5): this file performs zero
 * server-tree relative-import traversals. The dashboard speaks to the engine
 * ONLY via lib/api.ts over HTTP — same trust boundary as Phase 14
 * getC2paStatus and Phase 17 thumbnail fetches.
 *
 * The signal value is a Map<versionId, SummaryState> for per-version
 * isolation — a regenerate on version A does not affect version B's state.
 *
 * Mirrors the per-version signal pattern from
 * packages/dashboard/src/state/versions.ts (lines 26-32) and the auto-fetch +
 * cancellation idiom from packages/dashboard/src/views/VersionDrawer.tsx
 * lines 119-133 (`let alive = true; ... return () => { alive = false; };`).
 *
 * Read by SummarySection (Plan 19-06); written by VersionDrawer's
 * useEffect([version.id]) auto-fetch effect.
 */

import { signal } from '@preact/signals';
import {
  getSummary,
  regenerateSummary,
  type SummaryFetchResponse,
} from '../lib/api.js';

/**
 * Discriminated state union for the SummarySection component (UI-SPEC).
 *
 * NOTE: 'success' merges 'live' + 'cache_hit' SummaryOutcome variants — the
 * dashboard UI does NOT distinguish them visually (per UI-SPEC "discriminated
 * state union" decision). 'live' vs 'cache_hit' is server-side telemetry
 * only; both render identical prose body in SummarySection.
 *
 * 'loading' is the initial state before the first fetch resolves; it never
 * surfaces from fetchSummary itself (helper resolves to one of the other 3
 * variants). Callers seed 'loading' into the signal map manually before
 * awaiting fetchSummary.
 */
export type SummaryState =
  | { state: 'loading' }
  | {
      state: 'success';
      text: string;
      source: 'live' | 'cache_hit';
      generated_at: string;
      template_version: string;
      model_id: string;
      regenerateAvailableAtMs: number | null;
    }
  | {
      state: 'fallback';
      text: string;
      source: 'fallback';
      reason?: string;
      regenerateAvailableAtMs: number | null;
    }
  | { state: 'error'; message?: string };

/**
 * Per-version summary state. Read by SummarySection (Plan 19-06); written by
 * VersionDrawer's auto-fetch effect (Plan 19-06):
 *
 *   useEffect(() => {
 *     let alive = true;
 *     fetchSummary(version.id).then((s) => {
 *       if (alive) summarySignal.value =
 *         new Map(summarySignal.value).set(version.id, s);
 *     });
 *     return () => { alive = false; };
 *   }, [version.id]);
 */
export const summarySignal = signal<Map<string, SummaryState>>(new Map());

/**
 * fetchSummary helper used by VersionDrawer's useEffect mount + Regenerate
 * handler. Wraps lib/api.getSummary / regenerateSummary; NEVER throws —
 * collapses every error path to { state: 'error' } per defensive contract
 * (mirrors Phase 14 getC2paStatus precedent).
 *
 * The caller is responsible for writing the result back into summarySignal
 * with cancellation guards — typical pattern:
 *
 *   const state = await fetchSummary(versionId);
 *   if (alive) summarySignal.value =
 *     new Map(summarySignal.value).set(versionId, state);
 */
export async function fetchSummary(
  versionId: string,
  options: { regenerate?: boolean } = {},
): Promise<SummaryState> {
  const response: SummaryFetchResponse = options.regenerate
    ? await regenerateSummary(versionId)
    : await getSummary(versionId);
  return mapResponseToState(response);
}

/**
 * Map SummaryFetchResponse (lib/api.ts contract) to SummaryState (component
 * contract). The two shapes are intentionally near-identical — the component
 * union additionally carries 'loading' as an initial-state sentinel that
 * fetchSummary never returns.
 */
function mapResponseToState(response: SummaryFetchResponse): SummaryState {
  if (response.state === 'success') {
    return {
      state: 'success',
      text: response.text,
      source: response.source,
      generated_at: response.generated_at,
      template_version: response.template_version,
      model_id: response.model_id,
      regenerateAvailableAtMs: response.regenerateAvailableAtMs,
    };
  }
  if (response.state === 'fallback') {
    return {
      state: 'fallback',
      text: response.text,
      source: 'fallback',
      reason: response.reason,
      regenerateAvailableAtMs: response.regenerateAvailableAtMs,
    };
  }
  return { state: 'error', message: response.message };
}
