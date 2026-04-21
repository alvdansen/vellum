import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError } from './envelope.js';
import { versionLabel } from '../utils/outputs.js';
import type { Version, Breadcrumb } from '../types/hierarchy.js';

/**
 * D-GEN-04: submit input — action + shot_id + workflow_json + optional notes.
 * workflow_json is typed as a plain record (any JSON object) because format
 * validation lives in the engine (D-GEN-23 — so future REST adapters inherit
 * the same guard).
 */
const SubmitInput = z.object({
  action: z.literal('submit'),
  shot_id: z.string().min(1),
  workflow_json: z.record(z.string(), z.unknown()),
  notes: z.string().optional(),
});

/**
 * D-GEN-06: status input — action + version_id (the stable handle returned
 * from submit). No job_id lookup path in Phase 2.
 */
const StatusInput = z.object({
  action: z.literal('status'),
  version_id: z.string().min(1),
});

const GenerationInput = z.discriminatedUnion('action', [SubmitInput, StatusInput]);

/**
 * Render the version entity for tool responses — adds `version_label` (D-GEN-17).
 * Surfaces progress/error as stable shape keys so the agent sees a predictable
 * payload even when the engine stored null (D-GEN-07). The engine's raw Version
 * row carries `error_message` as the persisted column name; we alias it to
 * `error` in the tool response for agent ergonomics.
 */
function shapeVersionEntity(result: { entity: Version; breadcrumb: Breadcrumb }) {
  const { entity, breadcrumb } = result;
  const shaped = {
    ...entity,
    version_label: versionLabel(entity.version_number),
    // Phase 2 stable shape: progress is not persisted yet (D-GEN-07); null for now.
    progress: null as number | null,
    error: entity.error_message ?? null,
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
        "Submits a ComfyUI API-format workflow (also called 'prompt format'). UI-format exports will be rejected — enable 'Dev Mode > Save (API Format)' in ComfyUI to export the right shape. Actions: submit, status.",
      inputSchema: GenerationInput,
    },
    async (input) => {
      try {
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
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          const first = err.issues[0];
          const path = first.path.join('.');
          return toolError(
            new TypedError(
              'INVALID_INPUT',
              `Invalid input at 'input.${path}' -- ${first.message}`,
            ),
          );
        }
        return toolError(err);
      }
    },
  );
}
