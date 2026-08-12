import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError, zodInputError } from './envelope.js';
import { versionLabel } from '../utils/outputs.js';
import type { Version, Breadcrumb } from '../types/hierarchy.js';
import type { StoredOutput } from '../comfyui/types.js';
import {
  MAX_ID_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_WORKFLOW_NODES,
} from './shape.js';

/**
 * Submit input — action + shot_id + workflow_json + optional notes.
 * workflow_json is typed as a plain record (any JSON object) because format
 * validation lives in the engine (so future REST adapters inherit
 * the same guard).
 */
const SubmitInput = z.object({
  action: z.literal('submit'),
  shot_id: z.string().min(1).max(MAX_ID_LENGTH),
  // Cap node count at the tool boundary. Byte-size cap is enforced
  // in the engine-layer workflow-format check so future REST adapters inherit
  // the same guard.
  workflow_json: z
    .record(z.string(), z.unknown())
    .refine((obj) => Object.keys(obj).length <= MAX_WORKFLOW_NODES, {
      message: `workflow_json exceeds max ${MAX_WORKFLOW_NODES} nodes`,
    }),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
  // Multi-provider routing: submit to a specific configured backend
  // ('comfyui-cloud' | 'replicate' | 'fal' | …). Omit for the default provider.
  provider: z.string().min(1).max(64).optional(),
  // Escape hatch past the duplicate-submit guard. The guard refuses an
  // identical request to the same shot inside a short window, because the
  // earlier one may be in flight or may have been charged without returning a
  // job id. Set this when you genuinely want another take of the same prompt.
  allow_duplicate: z.boolean().optional(),
}).strict();

/**
 * Status input — action + version_id (the stable handle returned
 * from submit). No job_id lookup path.
 */
const StatusInput = z.object({
  action: z.literal('status'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
}).strict();

/**
 * Reproduce input — action + source version_id + optional notes.
 * Response is shaped as the existing submitted entity envelope PLUS the
 * ALWAYS-PRESENT `reproduction_warnings: string[]` field (honest disclosure
 * of replay limits).
 */
const ReproduceInput = z.object({
  action: z.literal('reproduce'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
}).strict();

/**
 * Iterate input — action + source version_id +
 * node-scoped overrides (deep-merged at the inputs level by the engine)
 * + optional seed convenience shortcut (resolved to KSampler.inputs.seed
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
}).strict();

/**
 * Register input. An external agent or provider webhook reports a
 * finished asset (produced OUTSIDE this server — ComfyUI, Replicate, FAL, Scenario,
 * Layer, or a sibling Claude Code workflow) into a shot. Each output is a public
 * https URL fetched under the ingest trust boundary (host allowlist + size cap).
 * `provider` is the reporting backend id; `provenance` is caller-asserted neutral
 * params/models stored verbatim in the completed event's neutral column.
 */
/** Cost actuals — numeric amount + currency so the dashboard can aggregate spend. */
const CostActualInput = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().min(1).max(32),
  note: z.string().max(MAX_NOTES_LENGTH).optional(),
}).strict();

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
  // Cost actuals — record the actual spend for this external take at register time.
  cost_actual: CostActualInput.optional(),
}).strict();

/** Cost actuals — record the ACTUAL spend for an existing take (append-only). */
const RecordCostInput = z.object({
  action: z.literal('record_cost'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
  amount: z.number().nonnegative(),
  currency: z.string().min(1).max(32),
  note: z.string().max(MAX_NOTES_LENGTH).optional(),
}).strict();

/**
 * Approval gate (no silent credit spend) — propose records the FULL
 * verbatim request for human review; approve/reject decide it exactly once;
 * list_proposals pages the queue. `request` mirrors SubmitInput.workflow_json
 * for kind='submit'; reproduce/iterate proposals reference a source version.
 */
const ProposeInput = z.object({
  action: z.literal('propose'),
  kind: z.enum(['submit', 'reproduce', 'iterate', 'external']),
  shot_id: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  workflow_json: z
    .record(z.string(), z.unknown())
    .refine((obj) => Object.keys(obj).length <= MAX_WORKFLOW_NODES, {
      message: `workflow_json exceeds max ${MAX_WORKFLOW_NODES} nodes`,
    })
    .optional(),
  version_id: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  overrides: z
    .record(z.string(), z.object({ inputs: z.record(z.string(), z.unknown()).optional(), class_type: z.string().optional() }))
    .optional(),
  seed: z.number().int().optional(),
  provider: z.string().min(1).max(64).optional(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
  cost_estimate: z.string().max(200).optional(),
  // kind='external' only — an action Vellum does not execute.
  external_action: z.string().min(1).max(2000).optional(),
  external_tool: z.string().min(1).max(64).optional(),
  external_request: z.record(z.string(), z.unknown()).optional(),
}).strict();

const ApproveInput = z.object({
  action: z.literal('approve'),
  proposal_id: z.string().min(1).max(MAX_ID_LENGTH),
  note: z.string().max(MAX_NOTES_LENGTH).optional(),
}).strict();

const RejectInput = z.object({
  action: z.literal('reject'),
  proposal_id: z.string().min(1).max(MAX_ID_LENGTH),
  note: z.string().max(MAX_NOTES_LENGTH).optional(),
}).strict();

const ListProposalsInput = z.object({
  action: z.literal('list_proposals'),
  shot_id: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  status: z.enum(['proposed', 'approved', 'rejected']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
}).strict();

const GenerationInputSchema = z.discriminatedUnion('action', [
  SubmitInput,
  StatusInput,
  ReproduceInput,
  IterateInput,
  RegisterInput,
  ProposeInput,
  ApproveInput,
  RejectInput,
  ListProposalsInput,
  RecordCostInput,
]);

/**
 * Render the version entity for tool responses — adds `version_label`.
 * Surfaces progress/error as stable shape keys so the agent sees a predictable
 * payload even when the engine stored null.
 *
 * Parse `outputs_json` into a typed `outputs: StoredOutput[]` and drop
 * the stringified column from the response. Raw JSON dumps to agents are
 * forbidden — the agent should see typed data, not a column name.
 * Malformed JSON is logged and surfaced as an empty array so an agent never
 * sees the tool crash on corrupt persistence.
 *
 * The canonical error alias is `error` (parsed from
 * entity.error_message). `error_message` is destructured out of the spread so
 * the response carries exactly one error field. Drift is no longer possible.
 */
function shapeVersionEntity(result: { entity: Version; breadcrumb: Breadcrumb }) {
  const { entity, breadcrumb } = result;
  // Destructure error_message and outputs_json OUT of the spread so
  // they do not leak through into the response.
  const { error_message, outputs_json, ...rest } = entity;

  // Parse outputs_json → typed array. Malformed JSON is logged to
  // stderr (never stdout — stdout is the MCP transport) and surfaces as an
  // empty array.
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
    // Stable shape: progress is not persisted yet; null for now.
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
 * Register the `generation` MCP tool.
 *
 * Thin Zod-validated delegate. Actions: submit, status. Breadcrumb
 * injected on every response (envelope invariant, extended to version leaf).
 *
 * Raw ZodRawShape exposed to MCP, discriminated union
 * re-validated inside the handler so tools/list carries real properties AND
 * the handler's ZodError catch branch is reachable.
 *
 * Error model:
 *  - ZodError → INVALID_INPUT with `input.<path>` in message (defence-in-depth
 *    with the engine's own format validation).
 *  - Engine-thrown TypedError (INVALID_WORKFLOW_FORMAT, SHOT_NOT_FOUND,
 *    COMFYUI_CREDENTIALS_MISSING, VERSION_NOT_FOUND, COMFYUI_API_ERROR, ...)
 *    → flows through toolError unchanged.
 *  - Anything else → toolError re-wraps as INVALID_INPUT.
 */
/**
 * Shape a proposal for tool responses: parse request_json into a typed
 * `request` (the verbatim payload the approver must read — never a raw JSON
 * string dump), and surface decision fields under stable keys.
 */
function shapeProposal(p: {
  id: string;
  shot_id: string;
  kind: string;
  provider: string | null;
  request_json: string;
  notes: string | null;
  cost_estimate: string | null;
  status: string;
  created_at: number;
  decided_at: number | null;
  decided_note: string | null;
  version_id: string | null;
  execution_error: string | null;
}) {
  let request: unknown = null;
  try {
    request = JSON.parse(p.request_json);
  } catch {
    request = null;
  }
  const { request_json, ...rest } = p;
  void request_json;
  return { ...rest, request };
}

export function registerGeneration(server: McpServer, engine: Engine) {
  server.registerTool(
    'generation',
    {
      title: 'Generation',
      description:
        "Submits a generation request to a configured provider. workflow_json carries the request: for comfyui-cloud it must be a ComfyUI API-format workflow (also called 'prompt format' — UI-format exports are rejected; enable 'Dev Mode > Save (API Format)' in ComfyUI); other configured providers interpret it as their own request payload. Actions: submit, status, reproduce, iterate, register, propose, approve, reject, list_proposals, record_cost. " +
        "record_cost logs the ACTUAL spend for a completed/failed take (append-only): { version_id, amount: <number>, currency: '<USD|credits|…>', note? } — the approval gate captures a free-form ESTIMATE pre-spend; this captures the real number post-spend so per-shot cost (incl. rejected takes) is tracked. register also accepts an optional cost_actual: { amount, currency, note? }. " +
        "Approval gate: when the server runs with VELLUM_REQUIRE_APPROVAL, direct submit/reproduce/iterate are refused — record the FULL request with action:'propose' (optionally cost_estimate), have it reviewed, then action:'approve' executes it exactly once (no silent credit spend). " +
        "The same gate covers actions Vellum does NOT run: propose kind='external' with shot_id + external_action (and optionally external_tool / external_request) before doing anything irreversible in another tool — overwriting a scene file, relighting, publishing to a tracker. Approval creates no version; it records that a human authorized that exact action exactly once. Gate on irreversibility, not just on cost: a free action can still be unrecoverable. " +
        "register (provider-agnostic): report an output produced OUTSIDE this server (ComfyUI, Replicate, FAL, Scenario, Layer, or a sibling workflow) into a shot — pass { shot_id, provider, outputs: [{ url }], provenance? }; each https URL is fetched under an ingest host-allowlist + size cap and stored as a new completed version stamped with `provider`. " +
        "State machine: submitted → running → completed | failed. " +
        "Dual error model: submit/status/reproduce/iterate return a success envelope even when the generation itself failed; inspect `entity.status` and `entity.error_code` to detect domain failures (GENERATION_TIMEOUT, DOWNLOAD_FAILED, and the producing provider's upstream code — COMFYUI_API_ERROR / REPLICATE_API_ERROR / FAL_API_ERROR / BYTEPLUS_API_ERROR / GOOGLE_API_ERROR, or the neutral PROVIDER_API_ERROR). `isError: true` is reserved for tool-surface failures (missing inputs, missing credentials, shot-not-found, version-not-found, version-not-completed, reproduce-blocked, iterate-invalid-patch). " +
        "reproduce replays what Vellum originally submitted: for comfyui-cloud that is the resolved prompt blob verbatim (byte-identical replay of the graph); for other providers it re-submits the recorded request parameters, and identical output is not guaranteed. Either way it returns a new version with lineage_type='reproduce' plus an always-present reproduction_warnings: string[] array disclosing any such limits (empty when none apply). " +
        "iterate is node-graph surgery (it needs a ComfyUI-produced source): it loads the source version's prompt_json (or workflow_json for failed sources), applies node-scoped overrides { '<nodeId>': { inputs?, class_type? } } and/or an optional seed shortcut (valid only when exactly one KSampler is present), re-validates the merged blob, and submits as a new version with lineage_type='iterate'.",
      // Raw ZodRawShape: SDK wraps this into z.object(...) so
      // `tools/list` publishes real JSON-schema properties. Every field is
      // `.optional()` at this layer so the SDK's pre-handler validation never
      // short-circuits — the handler's `GenerationInputSchema.parse()` is the
      // single source of truth for shape enforcement.
      inputSchema: z.object({
        action: z.enum(['submit', 'status', 'reproduce', 'iterate', 'register', 'propose', 'approve', 'reject', 'list_proposals', 'record_cost']),
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
        // register (inbound output ingestion).
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
        // Approval gate (propose/approve/reject/list_proposals).
        kind: z.enum(['submit', 'reproduce', 'iterate', 'external']).optional(),
        external_action: z.string().optional(),
        external_tool: z.string().optional(),
        external_request: z.record(z.string(), z.unknown()).optional(),
        proposal_id: z.string().optional(),
        note: z.string().optional(),
        cost_estimate: z.string().optional(),
        status: z.enum(['proposed', 'approved', 'rejected']).optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
        // Cost actuals (record_cost + register.cost_actual).
        amount: z.number().optional(),
        currency: z.string().optional(),
        cost_actual: z
          .object({ amount: z.number(), currency: z.string(), note: z.string().optional() })
          .optional(),
      }).passthrough(),
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
                  // Multi-provider routing: optional explicit backend.
                  input.provider,
                  // Deliberate re-run past the duplicate-submit guard.
                  input.allow_duplicate,
                ),
              ),
            );
          case 'status':
            return toolOk(
              shapeVersionEntity(await engine.getGenerationStatus(input.version_id)),
            );
          case 'reproduce': {
            const result = await engine.reproduceVersion(input.version_id, input.notes);
            // reproduction_warnings is ALWAYS on the response.
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
          case 'propose': {
            if (input.kind === 'external') {
              if (!input.shot_id || !input.external_action) {
                return toolError(
                  new TypedError(
                    'INVALID_INPUT',
                    "propose kind='external' requires shot_id and external_action.",
                    'external_action describes what you are about to do, specifically enough for a human to approve or refuse it.',
                  ),
                );
              }
              const res = engine.proposeGeneration({
                kind: 'external',
                shotId: input.shot_id,
                action: input.external_action,
                tool: input.external_tool,
                request: input.external_request,
                notes: input.notes,
                costEstimate: input.cost_estimate,
              });
              return toolOk({
                proposal: shapeProposal(res.proposal),
                breadcrumb: res.breadcrumb.entries,
                breadcrumb_text: res.breadcrumb.text,
                next: "A human reviews proposal.request, then { action: 'approve', proposal_id } authorizes it exactly once. Vellum does NOT perform this action — do not act until it is approved.",
              });
            }
            if (input.kind === 'submit') {
              if (!input.shot_id || !input.workflow_json) {
                return toolError(
                  new TypedError(
                    'INVALID_INPUT',
                    "propose kind='submit' requires shot_id and workflow_json.",
                    'Pass the full request exactly as you would to action=submit.',
                  ),
                );
              }
              const res = engine.proposeGeneration({
                kind: 'submit',
                shotId: input.shot_id,
                workflowJson: input.workflow_json,
                provider: input.provider,
                notes: input.notes,
                costEstimate: input.cost_estimate,
              });
              return toolOk({
                proposal: shapeProposal(res.proposal),
                breadcrumb: res.breadcrumb.entries,
                breadcrumb_text: res.breadcrumb.text,
                next: "Review proposal.request verbatim, then { action: 'approve', proposal_id } to execute or { action: 'reject', proposal_id } to discard.",
              });
            }
            if (!input.version_id) {
              return toolError(
                new TypedError(
                  'INVALID_INPUT',
                  `propose kind='${input.kind}' requires version_id (the source version).`,
                ),
              );
            }
            const res = engine.proposeGeneration(
              input.kind === 'reproduce'
                ? { kind: 'reproduce', versionId: input.version_id, notes: input.notes, costEstimate: input.cost_estimate }
                : { kind: 'iterate', versionId: input.version_id, overrides: input.overrides, seed: input.seed, notes: input.notes, costEstimate: input.cost_estimate },
            );
            return toolOk({
              proposal: shapeProposal(res.proposal),
              breadcrumb: res.breadcrumb.entries,
              breadcrumb_text: res.breadcrumb.text,
              next: "Review proposal.request verbatim, then { action: 'approve', proposal_id } to execute or { action: 'reject', proposal_id } to discard.",
            });
          }
          case 'approve': {
            const res = await engine.approveProposal(input.proposal_id, input.note);
            // kind='external' authorizes an action Vellum does not run, so there
            // is no version to shape. Return the claim itself and tell the caller
            // it is now cleared to act — the approval is the deliverable.
            if (!res.entity) {
              return toolOk({
                proposal: shapeProposal(res.proposal),
                breadcrumb: res.breadcrumb.entries,
                breadcrumb_text: res.breadcrumb.text,
                authorized: true,
                next: 'Authorized exactly once. Perform the action now, then record any resulting asset with { action: \'register\' } so the output is tracked against this shot.',
              });
            }
            return toolOk({
              proposal: shapeProposal(res.proposal),
              ...shapeVersionEntity({ entity: res.entity, breadcrumb: res.breadcrumb }),
              ...(res.reproduction_warnings ? { reproduction_warnings: res.reproduction_warnings } : {}),
            });
          }
          case 'reject': {
            const res = engine.rejectProposal(input.proposal_id, input.note);
            return toolOk({ proposal: shapeProposal(res.proposal) });
          }
          case 'list_proposals': {
            const res = engine.listProposals({
              shot_id: input.shot_id,
              status: input.status,
              limit: input.limit,
              offset: input.offset,
            });
            return toolOk({
              items: res.items.map(shapeProposal),
              total_count: res.total_count,
              limit: res.limit,
              offset: res.offset,
            });
          }
          case 'register':
            // Inbound registration of an externally-produced output.
            return toolOk(
              shapeVersionEntity(
                await engine.registerExternalOutput({
                  shotId: input.shot_id,
                  providerId: input.provider,
                  outputs: input.outputs,
                  provenance: input.provenance,
                  notes: input.notes,
                  externalJobRef: input.external_job_ref,
                  costActual: input.cost_actual
                    ? {
                        amount: input.cost_actual.amount,
                        currency: input.cost_actual.currency,
                        ...(input.cost_actual.note ? { note: input.cost_actual.note } : {}),
                        recorded_by: 'register',
                      }
                    : undefined,
                }),
              ),
            );
          case 'record_cost': {
            // Cost actuals — append-only actual-spend record for an existing take.
            const res = engine.recordCost(input.version_id, {
              amount: input.amount,
              currency: input.currency,
              note: input.note,
              recordedBy: 'record_cost',
            });
            return toolOk({
              version_id: res.version_id,
              cost: res.cost,
              breadcrumb: res.breadcrumb.entries,
              breadcrumb_text: res.breadcrumb.text,
            });
          }
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
          return toolError(zodInputError(err));
        }
        return toolError(err);
      }
    },
  );
}
