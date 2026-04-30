import { TypedError } from '../engine/errors.js';
import type { NodeError } from './types.js';

/**
 * SEC-02: byte-size cap for workflow_json (serialized). Real workflows are
 * <500KB; 5MB leaves headroom for legitimate edge cases while blocking OOM.
 * Matches src/tools/shape.ts MAX_WORKFLOW_BYTES — duplicated here to keep
 * comfyui/format.ts free of tool-layer imports (D-33 purity).
 */
const MAX_WORKFLOW_BYTES = 5_000_000;

/**
 * Pure format validators for ComfyUI workflow JSON (D-GEN-23, D-GEN-27).
 * No I/O, no network, no DB. Imports only TypedError from engine/errors.
 *
 * Two top-level distinctions:
 *  - UI format (exported by ComfyUI default "Save"): has top-level `nodes/links/groups/last_node_id`.
 *  - API format (aka "prompt" format, exported with Dev Mode > Save (API Format)): keyed by
 *    numeric strings mapping to `{ class_type, inputs }`.
 *
 * Only API format is accepted for submission; UI format is rejected with a helpful hint.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * True iff the payload looks like ComfyUI UI-format. Detection is a heuristic:
 * presence of any of the UI-format sentinel keys. This runs BEFORE the API-format
 * check so mixed/transitional exports are rejected with the UI-format hint.
 */
export function isUiFormat(payload: unknown): boolean {
  if (!isPlainObject(payload)) return false;
  const o = payload;
  return (
    Array.isArray(o.nodes) ||
    Array.isArray(o.links) ||
    Array.isArray(o.groups) ||
    typeof o.last_node_id === 'number'
  );
}

/**
 * True iff the payload matches ComfyUI API-format: an object whose keys are all
 * numeric strings, each value being `{ class_type: string, inputs: object }`.
 * Empty object → false (nothing to submit).
 */
export function isApiFormat(payload: unknown): boolean {
  if (!isPlainObject(payload)) return false;
  const entries = Object.entries(payload);
  if (entries.length === 0) return false;
  for (const [k, v] of entries) {
    if (!/^\d+$/.test(k)) return false;
    if (!isPlainObject(v)) return false;
    const node = v;
    if (typeof node.class_type !== 'string') return false;
    if (!isPlainObject(node.inputs)) return false;
  }
  return true;
}

/**
 * Gate called at submit-time (engine layer). Throws TypedError('INVALID_WORKFLOW_FORMAT')
 * with a format-specific hint. UI-format check runs first so the common "wrong export"
 * case gets the actionable Dev Mode hint instead of a generic one.
 *
 * SEC-02: also enforces a byte-size ceiling. Runs once via JSON.stringify; for
 * legitimate workflows (<500KB) this is a negligible fraction of the eventual
 * POST-to-ComfyUI cost. For adversarial multi-MB payloads it caps memory
 * pressure before the network roundtrip.
 */
export function validateWorkflowFormat(payload: unknown): void {
  if (isUiFormat(payload)) {
    throw new TypedError(
      'INVALID_WORKFLOW_FORMAT',
      'Workflow is in ComfyUI UI format (contains nodes/links/groups)',
      "Export the workflow with 'Dev Mode > Save (API Format)' enabled in ComfyUI. " +
        'API format uses numeric string keys ("1", "2", ...) with class_type/inputs per node.',
    );
  }
  if (!isApiFormat(payload)) {
    throw new TypedError(
      'INVALID_WORKFLOW_FORMAT',
      'Workflow does not match the ComfyUI API format',
      "Expected an object keyed by numeric strings, each value with 'class_type' (string) and 'inputs' (object).",
    );
  }
  // SEC-02 byte-size guard. Happens AFTER format checks so an obviously-wrong
  // shape gets the more helpful hint; a well-shaped but oversized payload gets
  // the size-specific message.
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_WORKFLOW_BYTES) {
    throw new TypedError(
      'INVALID_INPUT',
      `workflow_json exceeds ${MAX_WORKFLOW_BYTES} bytes serialized`,
      `Trim the workflow or split into smaller submits.`,
    );
  }
}

/**
 * Flatten the first actionable node_errors entry per D-GEN-27.
 * Returns null if the object is empty, malformed, or missing the expected shape.
 *
 * Example:
 *   extractFirstNodeError({'3': { errors: [{message:'bad'}], class_type: 'KSampler' }})
 *   => 'Node 3 (KSampler): bad'
 */
export function extractFirstNodeError(nodeErrors: unknown): string | null {
  if (!nodeErrors || typeof nodeErrors !== 'object' || Array.isArray(nodeErrors)) return null;
  const entries = Object.entries(nodeErrors as Record<string, unknown>);
  for (const [nodeId, raw] of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as Partial<NodeError>;
    const firstMsg = node.errors?.[0]?.message;
    const classType = node.class_type ?? 'UnknownNode';
    if (typeof firstMsg === 'string' && firstMsg.length > 0) {
      return `Node ${nodeId} (${classType}): ${firstMsg}`;
    }
  }
  return null;
}

/**
 * Flatten any ComfyUI Cloud error payload to a single human-readable string.
 * Single source of truth for the three-branch flatten chain (DEMO-02).
 *
 * Branches (in order):
 *   1. If `error` is an object with a populated `.node_errors` payload that
 *      extractFirstNodeError can flatten, return that flattened string.
 *   2. Else if `error` is a non-empty string, return it verbatim.
 *   3. Else return the literal "ComfyUI reported failed" — preserves the IT-10
 *      cancelled-status contract and the v1.0 dashboard fallback rendering.
 *
 * Always returns a non-empty string. Never throws. Never returns null.
 *
 * Used by:
 *   - src/comfyui/client.ts (submit-time 4xx branch)
 *   - src/engine/generation.ts (status / recovery-poller failed branch)
 *
 * Closes the duplicated extraction shape between those two call sites
 * (DEMO-02; ROADMAP Phase 11 success criterion #2).
 */
export function flattenComfyError(error: unknown): string {
  // Branch 1: object with .node_errors → try extractFirstNodeError.
  if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
    const nodeErrors = (error as { node_errors?: unknown }).node_errors;
    const flat = extractFirstNodeError(nodeErrors);
    if (flat !== null) return flat;
    // Fall through if .node_errors is missing or unparseable.
  }
  // Branch 2: non-empty string verbatim.
  if (typeof error === 'string' && error.length > 0) return error;
  // Branch 3: fallback. IT-10 contract — this exact literal must remain.
  return 'ComfyUI reported failed';
}
