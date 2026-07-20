import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError } from './envelope.js';
import { versionLabel } from '../utils/outputs.js';
import type { Version, Breadcrumb } from '../types/hierarchy.js';
import type { StoredOutput } from '../comfyui/types.js';
import {
  MAX_ID_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_WORKFLOW_NODES,
} from './shape.js';

/**
 * D-GEN-04: submit input — action + shot_id + workflow_json + optional notes.
 * workflow_json is typed as a plain record (any JSON object) because format
 * validation lives in the engine (D-GEN-23 — so future REST adapters inherit
 * the same guard).
 */
const SubmitInput = z.object({
  action: z.literal('submit'),
  shot_id: z.string().min(1).max(MAX_ID_LENGTH),
  // SEC-02: cap node count at the tool boundary. Byte-size cap is enforced
  // in the engine-layer workflow-format check so future REST adapters inherit
  // the same guard.
  workflow_json: z
    .record(z.string(), z.unknown())
    .refine((obj) => Object.keys(obj).length <= MAX_WORKFLOW_NODES, {
      message: `workflow_json exceeds max ${MAX_WORKFLOW_NODES} nodes`,
    }),
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

/**
 * D-PROV-12: reproduce input — action + source version_id + optional notes.
 * Response is shaped as the existing submitted entity envelope PLUS the
 * ALWAYS-PRESENT `reproduction_warnings: string[]` field (D-PROV-28 honesty).
 */
const ReproduceInput = z.object({
  action: z.literal('reproduce'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
});

/**
 * D-PROV-13, D-PROV-21: iterate input — action + source version_id +
 * node-scoped overrides (deep-merged at the inputs level by the engine)
 * + optional seed convenience shortcut (D-PROV-22 — resolved to KSampler.inputs.seed
 * by the engine; 0/>1 KSampler surfaces as ITERATE_INVALID_PATCH).
 *
 * NOT a JSON Patch. The overrides shape is `Record<nodeId, { inputs?, class_type? }>`.
 * Compared to RFC 6902 `{ op, path, value }` arrays, this shape is ComfyUI-native
 * (node ids are the natural addressing key) and cannot introduce prototype
 * pollution — keys are structurally constrained to the source prompt blob.
 */
const IterateInput = z.object({
  action: z.literal('iterate'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
  overrides: z.record(
    z.string().min(1),
    z.object({
      inputs: z.record(z.string(), z.unknown()).optional(),
      class_type: z.string().optional(),
    }),
  ).optional(),
  seed: z.number().int().optional(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
});

/**
 * Pivot Phase D — register input. An external agent or provider webhook reports a
 * finished asset (produced OUTSIDE this server — ComfyUI, Replicate, FAL, Scenario,
 * Layer, or a sibling Claude Code workflow) into a shot. Each output is a public
 * https URL fetched under the ingest trust boundary (host allowlist + size cap).
 * `provider` is the reporting backend id; `provenance` is caller-asserted neutral
 * params/models stored verbatim in the completed event's neutral column.
 */
const RegisterInput = z.object({
  action: z.literal('register'),
  shot_id: z.string().min(1).max(MAX_ID_LENGTH),
  provider: z.string().min(1).max(64),
  outputs: z
    .array(
      z.object({
        url: z.string().url().max(2048),
        filename: z.string().max(255).optional(),
        content_type: z.string().max(128).optional(),
      }),
    )
    .min(1)
    .max(20),
  provenance: z.record(z.string(), z.unknown()).optional(),
  external_job_ref: z.string().max(MAX_ID_LENGTH).optional(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
});

const GenerationInputSchema = z.discriminatedUnion('action', [
  SubmitInput,
  StatusInput,
  ReproduceInput,
  IterateInput,
  RegisterInput,
]);

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
        "Submits a ComfyUI API-format workflow (also called 'prompt format'). UI-format exports will be rejected — enable 'Dev Mode > Save (API Format)' in ComfyUI to export the right shape. Actions: submit, status, reproduce, iterate, register. " +
        "register (provider-agnostic): report an output produced OUTSIDE this server (ComfyUI, Replicate, FAL, Scenario, Layer, or a sibling workflow) into a shot — pass { shot_id, provider, outputs: [{ url }], provenance? }; each https URL is fetched under an ingest host-allowlist + size cap and stored as a new completed version stamped with `provider`. " +
        "State machine (D-GEN-18): submitted → running → completed | failed. " +
        "Dual error model (IAC-03): submit/status/reproduce/iterate return a success envelope even when the generation itself failed; inspect `entity.status` and `entity.error_code` to detect domain failures (GENERATION_TIMEOUT, DOWNLOAD_FAILED, COMFYUI_API_ERROR). `isError: true` is reserved for tool-surface failures (missing inputs, missing credentials, shot-not-found, version-not-found, version-not-completed, reproduce-blocked, iterate-invalid-patch). " +
        "reproduce re-submits a completed version's resolved prompt blob verbatim (byte-identical) and returns a new version with lineage_type='reproduce' plus an always-present reproduction_warnings: string[] array (empty when no drift indicators — D-PROV-28 honesty). " +
        "iterate loads the source version's prompt_json (or workflow_json for failed sources per D-PROV-24), applies node-scoped overrides { '<nodeId>': { inputs?, class_type? } } and/or an optional seed shortcut (valid only when exactly one KSampler is present), re-validates the merged blob, and submits as a new version with lineage_type='iterate'.",
      // Raw ZodRawShape (RT-01): SDK wraps this into z.object(...) so
      // `tools/list` publishes real JSON-schema properties. Every field is
      // `.optional()` at this layer so the SDK's pre-handler validation never
      // short-circuits — the handler's `GenerationInputSchema.parse()` is the
      // single source of truth for shape enforcement (RT-02).
      inputSchema: {
        action: z.enum(['submit', 'status', 'reproduce', 'iterate', 'register']),
        shot_id: z.string().optional(),
        workflow_json: z.record(z.string(), z.unknown()).optional(),
        notes: z.string().optional(),
        version_id: z.string().optional(),
        overrides: z.record(
          z.string(),
          z.object({
            inputs: z.record(z.string(), z.unknown()).optional(),
            class_type: z.string().optional(),
          }),
        ).optional(),
        seed: z.number().int().optional(),
        // Pivot Phase D — register (inbound output ingestion).
        provider: z.string().optional(),
        outputs: z
          .array(
            z.object({
              url: z.string(),
              filename: z.string().optional(),
              content_type: z.string().optional(),
            }),
          )
          .optional(),
        provenance: z.record(z.string(), z.unknown()).optional(),
        external_job_ref: z.string().optional(),
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
          case 'reproduce': {
            const result = await engine.reproduceVersion(input.version_id, input.notes);
            // D-PROV-12 / D-PROV-28: reproduction_warnings is ALWAYS on the response.
            // The spread precedes reproduction_warnings so the entity/breadcrumb
            // envelope stays at the top level exactly as submit/status return it.
            return toolOk({
              ...shapeVersionEntity({
                entity: result.entity,
                breadcrumb: result.breadcrumb,
              }),
              reproduction_warnings: result.reproduction_warnings,
            });
          }
          case 'iterate':
            return toolOk(
              shapeVersionEntity(
                await engine.iterateFromVersion(
                  input.version_id,
                  input.overrides,
                  input.seed,
                  input.notes,
                ),
              ),
            );
          case 'register':
            // Pivot Phase D — inbound registration of an externally-produced output.
            return toolOk(
              shapeVersionEntity(
                await engine.registerExternalOutput({
                  shotId: input.shot_id,
                  providerId: input.provider,
                  outputs: input.outputs,
                  provenance: input.provenance,
                  notes: input.notes,
                  externalJobRef: input.external_job_ref,
                }),
              ),
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
