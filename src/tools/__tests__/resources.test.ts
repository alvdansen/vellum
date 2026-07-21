// Phase E — self-describing MCP resources, verified over a live InMemoryTransport
// client (wire-level, not a direct function call).
import { describe, it, expect, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { registerResources } from '../resources.js';
import { ReplicateAdapter } from '../../providers/replicate-adapter.js';

/** Narrow the text|blob resource-content union to the text form we always emit. */
function textContent(res: { contents: Array<unknown> }): { text: string; mimeType?: string } {
  return res.contents[0] as { text: string; mimeType?: string };
}

async function connect(): Promise<Client> {
  const server = new McpServer({ name: 'vellum', version: '9.9.9' });
  registerResources(server, '9.9.9');
  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await server.connect(serverTx);
  await client.connect(clientTx);
  return client;
}

describe('Phase E — self-describing MCP resources', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('advertises the three vellum:// resources', async () => {
    const client = await connect();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      'vellum://capabilities',
      'vellum://manual',
      'vellum://output-contract',
    ]);
  });

  it('manual is readable markdown describing the tools + inbound path', async () => {
    const client = await connect();
    const res = await client.readResource({ uri: 'vellum://manual' });
    const c = textContent(res);
    expect(c.mimeType).toBe('text/markdown');
    expect(c.text).toContain('provider-agnostic');
    expect(c.text).toContain('generation');
    expect(c.text).toContain('register');
    expect(c.text).toContain('vellum://output-contract');
  });

  it('capabilities is valid JSON listing tools + configured providers + reproduce support', async () => {
    delete process.env.DEFAULT_PROVIDER; // avoid a misconfig throw from stray env
    process.env.REPLICATE_API_TOKEN = 'r8_test';
    const client = await connect();
    const res = await client.readResource({ uri: 'vellum://capabilities' });
    expect(textContent(res).mimeType).toBe('application/json');
    const doc = JSON.parse(textContent(res).text) as {
      product: string;
      tools: Array<{ name: string; actions: string[] }>;
      limits: { tools_registered: number };
      providers: {
        configured: string[];
        default: string | null;
        reproduce_support: Record<string, string>;
        reproduce_available_for: string[];
        reproduce_note: string;
      };
    };
    expect(doc.product).toBe('vellum');
    expect(doc.tools.map((t) => t.name)).toContain('generation');
    expect(doc.limits.tools_registered).toBe(7);
    expect(doc.providers.configured).toContain('replicate');
    expect(doc.providers.reproduce_support.replicate).toMatch(/params-replay/);
    // Honesty: reproduce only works against the default provider, and the doc says so.
    expect(doc.providers.reproduce_available_for).toEqual(
      doc.providers.default ? [doc.providers.default] : [],
    );
    expect(doc.providers.reproduce_note).toMatch(/default provider/i);
  });

  it('capabilities reproduce_support is backed by real adapter behavior (no drift)', async () => {
    // The doc's reproduce_support strings are the human rendering of each provider's
    // reproduceStrategy. Now that URL-provider reproduce is REAL (request-replay),
    // the claim must stay tied to the adapter — a 'request-replay' provider is
    // params-replay, never byte-identical.
    expect(new ReplicateAdapter('r8_test').reproduceStrategy).toBe('request-replay');
    delete process.env.DEFAULT_PROVIDER;
    process.env.REPLICATE_API_TOKEN = 'r8_test';
    const client = await connect();
    const res = await client.readResource({ uri: 'vellum://capabilities' });
    const doc = JSON.parse(textContent(res).text) as {
      providers: { reproduce_support: Record<string, string> };
    };
    expect(doc.providers.reproduce_support.replicate).toMatch(/params-replay/);
    // request-replay explicitly disclaims byte-identical output.
    expect(doc.providers.reproduce_support.replicate).toMatch(/not byte-identical/i);
  });

  it('output-contract documents the register schema + trust boundary', async () => {
    const client = await connect();
    const res = await client.readResource({ uri: 'vellum://output-contract' });
    const doc = JSON.parse(textContent(res).text) as {
      tool: string;
      action: string;
      input: Record<string, unknown>;
      trust_boundary: { url_scheme: string; max_bytes_per_output: number };
    };
    expect(doc.tool).toBe('generation');
    expect(doc.action).toBe('register');
    expect(doc.input.shot_id).toBeDefined();
    expect(doc.input.outputs).toBeDefined();
    expect(doc.trust_boundary.url_scheme).toContain('https');
    expect(doc.trust_boundary.max_bytes_per_output).toBeGreaterThan(0);
  });
});
