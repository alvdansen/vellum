// src/providers/config.ts
//
// Provider registry + factory (pivot Phase C). Discovers which generation
// backends are configured from env, picks a default, and constructs adapters.
// This is what makes the server provider-agnostic: server.ts asks the registry
// which provider is the default and builds it, instead of hardcoding ComfyUI.
//
// PURITY: imports only provider adapters + TypedError — no MCP SDK, no SQLite/ORM.
// (architecture-purity guards src/providers/.)

import type { GenerationProvider } from './provider.js';
import { ComfyUIClient, DEFAULT_COMFYUI_API_BASE } from '../comfyui/client.js';
import { ReplicateAdapter, DEFAULT_REPLICATE_API_BASE } from './replicate-adapter.js';
import { TypedError } from '../engine/errors.js';

export interface ProviderConfig {
  id: string;
  apiKey: string;
  apiBase: string;
  additionalAllowedHosts?: string[];
}

export interface ProviderRegistry {
  providers: ProviderConfig[];
  /** The provider the server builds by default. Null when nothing is configured. */
  defaultProviderId: string | null;
}

export const KNOWN_PROVIDER_IDS = ['comfyui-cloud', 'replicate'] as const;

function splitHosts(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Discover configured providers from env and resolve the default.
 *
 * Default selection precedence:
 *   1. DEFAULT_PROVIDER (must be a known id AND have credentials, else throws).
 *   2. The sole configured provider.
 *   3. comfyui-cloud when several are configured (back-compat — ComfyUI wins).
 *   4. The first configured provider otherwise.
 */
export function loadProviderConfig(
  env: Record<string, string | undefined> = process.env,
): ProviderRegistry {
  const providers: ProviderConfig[] = [];

  if (env.COMFYUI_API_KEY) {
    providers.push({
      id: 'comfyui-cloud',
      apiKey: env.COMFYUI_API_KEY,
      apiBase: env.COMFYUI_API_BASE ?? DEFAULT_COMFYUI_API_BASE,
      additionalAllowedHosts: splitHosts(env.COMFYUI_ALLOWED_REDIRECT_HOSTS),
    });
  }
  if (env.REPLICATE_API_TOKEN) {
    providers.push({
      id: 'replicate',
      apiKey: env.REPLICATE_API_TOKEN,
      apiBase: env.REPLICATE_API_BASE ?? DEFAULT_REPLICATE_API_BASE,
      additionalAllowedHosts: splitHosts(env.REPLICATE_ALLOWED_OUTPUT_HOSTS),
    });
  }

  const requested = env.DEFAULT_PROVIDER?.trim();
  let defaultProviderId: string | null = null;

  if (requested) {
    if (!(KNOWN_PROVIDER_IDS as readonly string[]).includes(requested)) {
      throw new TypedError(
        'PROVIDER_MISCONFIGURED',
        `DEFAULT_PROVIDER='${requested}' is not a known provider (${KNOWN_PROVIDER_IDS.join(', ')}).`,
        'Unset DEFAULT_PROVIDER or set it to a configured provider id.',
      );
    }
    if (!providers.some((p) => p.id === requested)) {
      throw new TypedError(
        'PROVIDER_MISCONFIGURED',
        `DEFAULT_PROVIDER='${requested}' selected but no credentials are configured for it.`,
        "Set the provider's API key/token env var, or change DEFAULT_PROVIDER.",
      );
    }
    defaultProviderId = requested;
  } else if (providers.length === 1) {
    defaultProviderId = providers[0].id;
  } else if (providers.some((p) => p.id === 'comfyui-cloud')) {
    defaultProviderId = 'comfyui-cloud';
  } else if (providers.length > 0) {
    defaultProviderId = providers[0].id;
  }

  return { providers, defaultProviderId };
}

/** Construct a live provider from its config. `fetchImpl` override supports tests. */
export function createProvider(
  cfg: ProviderConfig,
  options: { fetchImpl?: typeof fetch } = {},
): GenerationProvider {
  switch (cfg.id) {
    case 'comfyui-cloud':
      return new ComfyUIClient(cfg.apiKey, cfg.apiBase, {
        additionalAllowedHosts: cfg.additionalAllowedHosts,
        fetchImpl: options.fetchImpl,
      });
    case 'replicate':
      return new ReplicateAdapter(cfg.apiKey, cfg.apiBase, {
        additionalAllowedHosts: cfg.additionalAllowedHosts,
        fetchImpl: options.fetchImpl,
      });
    default:
      throw new TypedError('PROVIDER_MISCONFIGURED', `Unknown provider id '${cfg.id}'.`);
  }
}
