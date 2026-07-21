import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadProviderConfig } from '../providers/config.js';
import { DEFAULT_INGEST_ALLOWED_HOSTS, DEFAULT_INGEST_MAX_BYTES } from '../engine/ingest.js';

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
  { name: 'project', actions: ['create', 'list', 'get'], summary: 'Project under a workspace.' },
  { name: 'sequence', actions: ['create', 'list', 'get'], summary: 'Sequence under a project.' },
  { name: 'shot', actions: ['create', 'list', 'get', 'set_status'], summary: 'Shot under a sequence; production status.' },
  {
    name: 'generation',
    actions: ['submit', 'status', 'reproduce', 'iterate', 'register'],
    summary: 'Submit to / poll the default provider; reproduce/iterate; register an externally-produced output.',
  },
  { name: 'version', actions: ['get', 'list', 'diff', 'provenance'], summary: 'Version reads + provenance + diff.' },
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
    limits: { tool_cap: 12, tools_registered: TOOL_SURFACE.length, list_default_limit: 20, list_includes_total_count: true },
    providers: {
      configured,
      default: defaultProvider,
      // Per-provider strategy description (what reproduce WOULD do for that backend).
      reproduce_support: Object.fromEntries(
        configured.map((id) => [id, REPRODUCE_SUPPORT[id] ?? 'params-replay']),
      ),
      // The engine holds ONE default client, so reproduce only runs against the
      // default provider today; a version produced by a non-default provider
      // returns REPRODUCE_BLOCKED until that provider is configured as the default.
      // Disclosed so a cold agent does not plan an unsupported reproduce call.
      reproduce_available_for: defaultProvider ? [defaultProvider] : [],
      reproduce_note:
        'Reproduce runs only against the default provider. A version from a non-default (or a legacy pre-provider) backend returns REPRODUCE_BLOCKED until that provider is made the default.',
    },
    envelope: {
      success: 'Structured content payload (entity + breadcrumb). Never a raw JSON dump.',
      error: '{ isError: true, structuredContent: { code, message, hint } } — typed, human-readable, actionable.',
    },
    inbound: 'See vellum://output-contract for how any generator/agent registers a finished output.',
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
    '## Discovery',
    '- `vellum://capabilities` — machine-readable tools/actions/limits + which providers are configured and their reproduce support.',
    '- `vellum://output-contract` — the exact schema for registering an external output.',
    '',
    'All list actions paginate (default 20, with a total count). IDs are opaque strings; pass them back verbatim.',
  ].join('\n');
}

export function registerResources(server: McpServer, version: string): void {
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
}
