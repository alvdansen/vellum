import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadProviderConfig } from '../providers/config.js';
import { DEFAULT_INGEST_ALLOWED_HOSTS, DEFAULT_INGEST_MAX_BYTES } from '../engine/ingest.js';
import { isApprovalRequired } from '../utils/approval-config.js';

/**
 * Pivot Phase E — self-describing capability layer.
 *
 * A cold agent (or a sibling Claude Code workflow) pointed at Vellum can read
 * these MCP resources to learn how to drive it and how to report outputs to it —
 * no prior knowledge required. Resources cost ZERO of the 12 tool slots (we stay
 * at 7 tools); they are the idiomatic MCP home for documentation + machine-readable
 * contracts. Three resources:
 *   - vellum://manual           (markdown)  — how the tools work + envelope shape
 *   - vellum://capabilities     (json)      — tools/actions/limits + configured providers
 *   - vellum://output-contract  (json)      — the registerExternalOutput schema
 */

const TOOL_SURFACE: Array<{ name: string; actions: string[]; summary: string }> = [
  { name: 'workspace', actions: ['create', 'list', 'get'], summary: 'Top-level container.' },
  {
    name: 'project',
    actions: ['create', 'list', 'get', 'set_naming_template', 'set_spec', 'get_spec', 'list_spec_revisions'],
    summary:
      'Project under a workspace; set_naming_template sets the production output-naming template. ' +
      'set_spec/get_spec/list_spec_revisions manage the project SPEC — append-only versioned standing context (style bible, look book, naming/palette contract) that every version records at creation.',
  },
  { name: 'sequence', actions: ['create', 'list', 'get'], summary: 'Sequence under a project.' },
  {
    name: 'shot',
    actions: ['create', 'list', 'get', 'set_status', 'get_status', 'list_status_history', 'pipeline_log'],
    summary:
      'Shot under a sequence; production status (set_status/get_status/list_status_history) and a markdown pipeline_log projected from provenance.',
  },
  {
    name: 'generation',
    actions: ['submit', 'status', 'reproduce', 'iterate', 'register', 'propose', 'approve', 'reject', 'list_proposals', 'record_cost'],
    summary:
      'Submit to / poll any configured provider; reproduce/iterate; register an externally-produced output; approval-gate a spend (propose → approve); record_cost logs the actual spend of a take.',
  },
  {
    name: 'version',
    actions: ['get', 'list', 'diff', 'provenance', 'export_manifest', 'verify_manifest', 'redact_manifest'],
    summary:
      'Version reads + provenance + diff; export/verify a C2PA-signed manifest and redact named manifest fields (presentation-layer, originals retained in the parent chain).',
  },
  {
    name: 'asset',
    actions: ['add_tag', 'remove_tag', 'set_metadata', 'remove_metadata', 'query', 'list_tags', 'list_metadata_keys'],
    summary: 'Tags + key/value metadata on versions; AND-only query.',
  },
];

const REPRODUCE_SUPPORT: Record<string, string> = {
  'comfyui-cloud': 'byte-identical (re-submits the resolved node graph)',
  replicate: 'params-replay (neutral params-diff; not byte-identical)',
  fal: 'params-replay (neutral params-diff; not byte-identical)',
  byteplus: 'params-replay (neutral params-diff; not byte-identical)',
};

function capabilitiesDoc(version: string): unknown {
  let configured: string[] = [];
  let defaultProvider: string | null = null;
  try {
    const reg = loadProviderConfig(process.env);
    configured = reg.providers.map((p) => p.id);
    defaultProvider = reg.defaultProviderId;
  } catch {
    // Misconfig is surfaced at boot; here we degrade to "unknown" rather than throw.
  }
  return {
    product: 'vellum',
    version,
    description:
      'Provider-agnostic asset-production + provenance layer. Manages a hierarchy ' +
      '(workspace → project → sequence → shot → version → output) with append-only ' +
      'provenance + optional C2PA, on top of any generation backend.',
    tools: TOOL_SURFACE,
    limits: {
      tool_cap: 12,
      tools_registered: TOOL_SURFACE.length,
      list_default_limit: 20,
      list_includes_total_count: true,
      // version.list advertised an offset it discarded until b973030 made it
      // cursor-paginated. An agent that assumes offset works gets page 1
      // forever, or now an error — so state the exception where it is machine
      // readable, not only in the prose manual.
      cursor_paginated_actions: ['version.list'],
    },
    providers: {
      configured,
      default: defaultProvider,
      // Per-provider strategy description (what reproduce WOULD do for that backend).
      reproduce_support: Object.fromEntries(
        configured.map((id) => [id, REPRODUCE_SUPPORT[id] ?? 'params-replay']),
      ),
      // Multi-provider routing: the engine routes submit/status/reproduce to the
      // provider that produced each version, so reproduce works for EVERY
      // configured provider. A version whose provider is no longer configured
      // returns REPRODUCE_BLOCKED with the configured list in the hint.
      reproduce_available_for: configured,
      reproduce_note:
        'Reproduce/status route to the provider that produced the version. generation submit accepts an optional `provider` to target a specific configured backend; omitted → the default.',
    },
    approval_gate: {
      required: isApprovalRequired(process.env.VELLUM_REQUIRE_APPROVAL),
      note:
        'When required, direct submit/reproduce/iterate return APPROVAL_REQUIRED. Record the verbatim request with generation propose (include cost_estimate), review it, then approve executes it exactly once. No silent credit spend.',
    },
    envelope: {
      success: 'Structured content payload (entity + breadcrumb). Never a raw JSON dump.',
      error: '{ isError: true, structuredContent: { code, message, hint } } — typed, human-readable, actionable.',
    },
    inbound: 'See vellum://output-contract for how any generator/agent registers a finished output.',
    standing_context: {
      resource: 'vellum://project/{project_id}/spec',
      note:
        'Per-project versioned spec, fetched by URI so an agent loads ONLY the project it is working in — not one monolithic context file that grows with the show. Read it before generating. Absent resource = that project has no spec.',
      binding:
        "Every version records the spec revision active at its creation as an append-only 'spec_bound' provenance event. Read it back with { tool: 'version', action: 'provenance' }.",
    },
  };
}

function outputContractDoc(): unknown {
  return {
    tool: 'generation',
    action: 'register',
    purpose:
      'Report an asset produced OUTSIDE this server (ComfyUI, Replicate, FAL, Scenario, Layer, ' +
      'or a sibling Claude Code workflow) into a shot as a completed, provenance-tracked version.',
    input: {
      action: "'register'",
      shot_id: 'string (required) — target shot id',
      provider: 'string (required) — reporting backend id, stamped on the version',
      outputs:
        '[{ url: https string (required), filename?: string, content_type?: string }] — 1..20 outputs',
      provenance: 'object (optional) — neutral params/models, stored verbatim in provenance',
      external_job_ref: 'string (optional) — the backend prediction/request id',
      notes: 'string (optional)',
    },
    trust_boundary: {
      url_scheme: 'https only',
      host_allowlist: [...DEFAULT_INGEST_ALLOWED_HOSTS, '<+ VELLUM_INGEST_ALLOWED_HOSTS>'],
      max_bytes_per_output: DEFAULT_INGEST_MAX_BYTES,
      note: 'URLs are validated before any write; a rejected URL never creates a version.',
    },
    returns: 'The new completed version entity + breadcrumb (same shape as submit/status).',
    // Non-MCP entry points to the SAME engine path — for processes that are not
    // MCP clients (provider webhooks, training scripts, CI). Both are bearer-gated
    // and disabled (503) until VELLUM_INGEST_TOKEN is set in the server env.
    http_ingest: {
      auth: 'Authorization: Bearer <VELLUM_INGEST_TOKEN> — constant-time check; routes return 503 when the token is unset.',
      json_by_url: {
        method: 'POST',
        path: '/webhooks/:provider',
        content_type: 'application/json',
        body: 'Same fields as the MCP register input minus provider (taken from the path): { shot_id, outputs: [{ url, filename?, content_type? }], provenance?, external_job_ref?, notes? }',
        max_body_bytes: 256 * 1024,
        note: 'Outputs are fetched under the https + host-allowlist + byte-cap trust boundary.',
      },
      multipart_upload: {
        method: 'POST',
        path: '/webhooks/:provider/upload',
        content_type: 'multipart/form-data',
        fields: {
          meta: 'required JSON text field: { shot_id, provenance?, external_job_ref?, notes? }',
          files: '1..20 file parts — the output bytes themselves (no public URL needed)',
        },
        max_body_bytes: 64 * 1024 * 1024,
        note: "Direct-bytes ingest: no fetch, no host allowlist. Stored outputs carry url 'uploaded:direct'. Built for training scripts (e.g. Modal fine-tune checkpoints) — see docs/modal-training-ingest.md.",
      },
      returns: '201 with the same { entity, breadcrumb } envelope as the MCP register action.',
    },
  };
}

function manualDoc(version: string): string {
  return [
    `# Vellum ${version} — agent manual`,
    '',
    'Vellum is a **provider-agnostic asset-production + provenance layer**. It manages a',
    'hierarchy (workspace → project → sequence → shot → version → output) with append-only',
    'provenance, on top of any generation backend (ComfyUI, Replicate, and more).',
    '',
    '## Tools (7)',
    ...TOOL_SURFACE.map((t) => `- **${t.name}** — actions: ${t.actions.join(', ')}. ${t.summary}`),
    '',
    '## Response envelope',
    '- Success → structured content (an `entity` + a `breadcrumb` from workspace to the affected entity). Never a raw JSON dump.',
    '- Failure → `isError: true` with `{ code, message, hint }` — typed, human-readable, actionable.',
    '- Domain failures (a generation that failed) still return a success envelope; inspect `entity.status` / `entity.error_code`.',
    '',
    '## Two ways an output reaches Vellum',
    '1. **Outbound** — `generation submit` to the configured default provider, then `generation status` to poll.',
    '2. **Inbound** — `generation register`: report an asset you produced elsewhere. See `vellum://output-contract`.',
    '',
    '## Standing context — read the project spec first',
    'A project may carry a **spec**: versioned text (style bible, look book, naming/palette contract) that tells you what good looks like here. Read it BEFORE you generate into a project — `vellum://project/{project_id}/spec`, or `{ tool: "project", action: "get_spec" }`. Not every project has one; absence is not an error.',
    'Every version you create records which spec revision was active, automatically. So when an output is wrong *because the spec was ambiguous*, the fix is a new revision via `set_spec` (it appends — it never edits in place), not a one-off correction to the output. Earlier takes stay dated to the revision they were made under.',
    '',
    '## Before doing something irreversible',
    'The approval gate is not only about money. If you are about to take an action Vellum does not execute — overwriting a file, relighting a scene in another tool, publishing to a tracker — record it first with `{ tool: "generation", action: "propose", kind: "external", shot_id, external_action }` and wait for approval. Approval authorizes it exactly once and creates no version; you then perform the action and `register` whatever it produced. A free action can still be unrecoverable.',
    '',
    '## Discovery',
    '- `vellum://capabilities` — machine-readable tools/actions/limits + which providers are configured and their reproduce support.',
    '- `vellum://output-contract` — the exact schema for registering an external output.',
    '- `vellum://project/{project_id}/spec` — that project\'s standing context, fetched per project rather than loaded wholesale.',
    '',
    'All list actions paginate (default 20, with a total count). IDs are opaque strings; pass them back verbatim.',
    '',
    '`version list` is CURSOR-paginated, not offset-paginated: read `next_cursor` from the response and pass it back as `cursor` for the next page. Passing a non-zero `offset` is an error, not a silent no-op — it cannot advance the page.',
  ].join('\n');
}

/**
 * Minimal read surface this module needs from the engine. Declared structurally
 * (not as `Engine`) so the resource layer stays a thin reader and the tool-layer
 * boundary test keeps seeing a narrow dependency.
 */
export interface SpecReader {
  getProjectSpec(
    projectId: string,
    revision?: number,
  ): { entity: { revision: number; content: string; content_hash: string; created_at: number } };
}

export function registerResources(
  server: McpServer,
  version: string,
  specReader?: SpecReader,
): void {
  server.registerResource(
    'manual',
    'vellum://manual',
    {
      title: 'Vellum manual',
      description: 'How to drive Vellum: tools, actions, response envelope, and the two ways an output reaches it.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: manualDoc(version) }],
    }),
  );

  server.registerResource(
    'capabilities',
    'vellum://capabilities',
    {
      title: 'Vellum capabilities',
      description: 'Machine-readable tools/actions/limits + configured providers and reproduce support.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(capabilitiesDoc(version), null, 2) }],
    }),
  );

  server.registerResource(
    'output-contract',
    'vellum://output-contract',
    {
      title: 'Vellum output-registration contract',
      description: 'The exact schema for reporting an externally-produced asset into a shot (generation register).',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(outputContractDoc(), null, 2) }],
    }),
  );

  // Per-project standing context, addressed by URI.
  //
  // The alternative — assembling every project's spec into one file the agent
  // loads on every call — costs context proportional to the whole show and gets
  // worse as it grows. A templated resource lets the agent pull exactly the
  // project it is working in. Same reason the manual/capabilities/contract
  // resources exist instead of a preamble: resources cost zero tool slots and
  // are fetched on demand.
  if (specReader) {
    server.registerResource(
      'project-spec',
      new ResourceTemplate('vellum://project/{project_id}/spec', { list: undefined }),
      {
        title: 'Project spec',
        description:
          'Versioned standing context for a project (style bible, look book, naming/palette contract). Read before generating into the project. Returns the latest revision.',
        mimeType: 'text/markdown',
      },
      async (uri, variables) => {
        const raw = variables.project_id;
        const projectId = Array.isArray(raw) ? raw[0] : raw;
        if (typeof projectId !== 'string' || projectId === '') {
          throw new Error('project_id is required in vellum://project/{project_id}/spec');
        }
        // A missing project or a project with no spec both surface as the
        // engine's typed error, which the SDK reports as a resource read
        // failure — the honest answer for "there is no standing context here".
        const { entity } = specReader.getProjectSpec(projectId);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/markdown',
              text: entity.content,
            },
          ],
        };
      },
    );
  }
}
