import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError } from './envelope.js';
import { versionLabel } from '../utils/outputs.js';
import type { Version, Breadcrumb } from '../types/hierarchy.js';
import type { StoredOutput } from '../comfyui/types.js';
import { MAX_ID_LENGTH, MAX_NOTES_LENGTH } from './shape.js';

/**
 * D-GEN-04: submit input — action + shot_id + workflow_json + optional notes.
 * workflow_json is typed as a plain record (any JSON object) because format
 * validation lives in the engine (D-GEN-23 — so future REST adapters inherit
 * the same guard).
 */
const SubmitInput = z.object({
  action: z.literal('submit'),
  shot_id: z.string().min(1).max(MAX_ID_LENGTH),
  workflow_json: z.record(z.string(), z.unknown()),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
});

/**
 * D-GEN-06: status input — action + version_id (the stable handle returned
 * from submit). No job_id lookup path in Phase 2.
 */
const StatusInput = z.object({
  action: z.literal('status'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
});

const GenerationInputSchema = z.discriminatedUnion('action', [SubmitInput, StatusInput]);

/**
 * Render the version entity for tool responses — adds `version_label` (D-GEN-17).
 * Surfaces progress/error as stable shape keys so the agent sees a predictable
 * payload even when the engine stored null (D-GEN-07).
 *
 * IAC-01: parse `outputs_json` into a typed `outputs: StoredOutput[]` and drop
 * the stringified column from the response. CLAUDE.md explicitly forbids raw
 * JSON dumps to agents — the agent should see typed data, not a column name.
 * Malformed JSON is logged and surfaced as an empty array so an agent never
 * sees the tool crash on corrupt persistence.
 *
 * IAC-02: the canonical error alias is `error` (parsed from
 * entity.error_message). `error_message` is destructured out of the spread so
 * the response carries exactly one error field. Drift is no longer possible.
 */
function shapeVersionEntity(result: { entity: Version; breadcrumb: Breadcrumb }) {
  const { entity, breadcrumb } = result;
  // IAC-02: destructure error_message and outputs_json OUT of the spread so
  // they do not leak through into the response.
  const { error_message, outputs_json, ...rest } = entity;

  // IAC-01: parse outputs_json → typed array. Malformed JSON is logged to
  // stderr (never stdout — D-21) and surfaces as an empty array.
  let outputs: StoredOutput[] = [];
  if (outputs_json != null && outputs_json.length > 0) {
    try {
      const parsed = JSON.parse(outputs_json);
      if (Array.isArray(parsed)) {
        outputs = parsed as StoredOutput[];
      } else {
        console.error(
          `[generation-tool] outputs_json for version=${entity.id} is not an array; returning []`,
        );
      }
    } catch (err) {
      console.error(
        `[generation-tool] outputs_json parse failed for version=${entity.id}:`,
        (err as Error).message,
      );
    }
  }

  const shaped = {
    ...rest,
    version_label: versionLabel(entity.version_number),
    // Phase 2 stable shape: progress is not persisted yet (D-GEN-07); null for now.
    progress: null as number | null,
    error: error_message ?? null,
    outputs,
  };
  return {
    entity: shaped,
    breadcrumb: breadcrumb.entries,
    breadcrumb_text: breadcrumb.text,
  };
}

/**
 * Register the `generation` MCP tool (D-GEN-01, D-GEN-02, GEN-01..GEN-03, GEN-05, GEN-06).
 *
 * Thin Zod-validated delegate (D-33). Actions: submit, status. Breadcrumb
 * injected on every response (D-22 Phase 1 invariant, extended to version leaf).
 *
 * RT-01/RT-02: raw ZodRawShape exposed to MCP, discriminated union
 * re-validated inside the handler so tools/list carries real properties AND
 * the handler's ZodError catch branch is reachable.
 *
 * Error model:
 *  - ZodError → INVALID_INPUT with `input.<path>` in message (defence-in-depth
 *    with the engine's own format validation).
 *  - Engine-thrown TypedError (INVALID_WORKFLOW_FORMAT, SHOT_NOT_FOUND,
 *    COMFYUI_CREDENTIALS_MISSING, VERSION_NOT_FOUND, COMFYUI_API_ERROR, ...)
 *    → flows through toolError unchanged (D-28).
 *  - Anything else → toolError re-wraps as INVALID_INPUT (D-13, D-32).
 */
export function registerGeneration(server: McpServer, engine: Engine) {
  server.registerTool(
    'generation',
    {
      title: 'Generation',
      description:
        "Submits a ComfyUI API-format workflow (also called 'prompt format'). UI-format exports will be rejected — enable 'Dev Mode > Save (API Format)' in ComfyUI to export the right shape. Actions: submit, status. " +
        "State machine (D-GEN-18): submitted → running → completed | failed. " +
        "Dual error model (IAC-03): submit and status return a success envelope even when the generation itself failed; inspect `entity.status` and `entity.error_code` to detect domain failures (GENERATION_TIMEOUT, DOWNLOAD_FAILED, COMFYUI_API_ERROR). `isError: true` is reserved for tool-surface failures (missing inputs, missing credentials, shot-not-found, version-not-found).",
      // Raw ZodRawShape (RT-01): SDK wraps this into z.object(...) so
      // `tools/list` publishes real JSON-schema properties. Every field is
      // `.optional()` at this layer so the SDK's pre-handler validation never
      // short-circuits — the handler's `GenerationInputSchema.parse()` is the
      // single source of truth for shape enforcement (RT-02).
      inputSchema: {
        action: z.enum(['submit', 'status']),
        shot_id: z.string().optional(),
        workflow_json: z.record(z.string(), z.unknown()).optional(),
        notes: z.string().optional(),
        version_id: z.string().optional(),
      },
    },
    async (rawInput) => {
      try {
        const input = GenerationInputSchema.parse(rawInput);
        switch (input.action) {
          case 'submit':
            return toolOk(
              shapeVersionEntity(
                await engine.submitGeneration(
                  input.shot_id,
                  input.workflow_json,
                  input.notes,
                ),
              ),
            );
          case 'status':
            return toolOk(
              shapeVersionEntity(await engine.getGenerationStatus(input.version_id)),
            );
          default: {
            const _exhaustive: never = input;
            throw new TypedError(
              'INVALID_INPUT',
              `Unhandled generation action: ${String(_exhaustive)}`,
            );
          }
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          const first = err.issues[0];
          const path = first.path.join('.');
          return toolError(
            new TypedError('INVALID_INPUT', `Invalid input at 'input.${path}'`),
          );
        }
        return toolError(err);
      }
    },
  );
}
