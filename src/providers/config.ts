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
import { FalAdapter, DEFAULT_FAL_API_BASE } from './fal-adapter.js';
import { ByteplusAdapter, DEFAULT_BYTEPLUS_API_BASE } from './byteplus-adapter.js';
import { GoogleAIStudioAdapter, DEFAULT_GOOGLE_API_BASE } from './google-ai-studio-adapter.js';
import { TypedError } from '../engine/errors.js';
import { envValue, envList } from '../utils/env.js';
import type { LookupFn } from '../utils/private-address.js';

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

export const KNOWN_PROVIDER_IDS = ['comfyui-cloud', 'replicate', 'fal', 'byteplus', 'google-ai-studio'] as const;

const splitHosts = envList;

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
      apiBase: envValue(env.COMFYUI_API_BASE) ?? DEFAULT_COMFYUI_API_BASE,
      additionalAllowedHosts: splitHosts(env.COMFYUI_ALLOWED_REDIRECT_HOSTS),
    });
  }
  if (env.REPLICATE_API_TOKEN) {
    providers.push({
      id: 'replicate',
      apiKey: env.REPLICATE_API_TOKEN,
      apiBase: envValue(env.REPLICATE_API_BASE) ?? DEFAULT_REPLICATE_API_BASE,
      additionalAllowedHosts: splitHosts(env.REPLICATE_ALLOWED_OUTPUT_HOSTS),
    });
  }
  if (env.FAL_KEY) {
    providers.push({
      id: 'fal',
      apiKey: env.FAL_KEY,
      apiBase: envValue(env.FAL_API_BASE) ?? DEFAULT_FAL_API_BASE,
      additionalAllowedHosts: splitHosts(env.FAL_ALLOWED_OUTPUT_HOSTS),
    });
  }
  if (env.BYTEPLUS_API_KEY) {
    providers.push({
      id: 'byteplus',
      apiKey: env.BYTEPLUS_API_KEY,
      apiBase: envValue(env.BYTEPLUS_API_BASE) ?? DEFAULT_BYTEPLUS_API_BASE,
      additionalAllowedHosts: splitHosts(env.BYTEPLUS_ALLOWED_OUTPUT_HOSTS),
    });
  }
  // Google AI Studio (Gemini / Nano Banana) — image generation (free tier available).
  // Accept the Vellum-scoped name or the conventional GEMINI_API_KEY alias.
  const googleKey = envValue(env.GOOGLE_AI_STUDIO_API_KEY) ?? envValue(env.GEMINI_API_KEY);
  if (googleKey) {
    providers.push({
      id: 'google-ai-studio',
      apiKey: googleKey,
      apiBase: envValue(env.GOOGLE_AI_STUDIO_API_BASE) ?? DEFAULT_GOOGLE_API_BASE,
      // No output-host allowlist: inline base64 is decoded in-process, never fetched.
    });
  }

  const requested = envValue(env.DEFAULT_PROVIDER);
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

/**
 * Construct a live provider from its config. `fetchImpl` and `lookupImpl` are
 * test seams; production passes neither, so adapters use global fetch and real
 * DNS. `lookupImpl` exists so the outbound private-address guard can be driven
 * deterministically in tests WITHOUT ever being switched off.
 */
export function createProvider(
  cfg: ProviderConfig,
  options: { fetchImpl?: typeof fetch; lookupImpl?: LookupFn } = {},
): GenerationProvider {
  switch (cfg.id) {
    case 'comfyui-cloud':
      return new ComfyUIClient(cfg.apiKey, cfg.apiBase, {
        additionalAllowedHosts: cfg.additionalAllowedHosts,
        fetchImpl: options.fetchImpl,
        lookupImpl: options.lookupImpl,
      });
    case 'replicate':
      return new ReplicateAdapter(cfg.apiKey, cfg.apiBase, {
        additionalAllowedHosts: cfg.additionalAllowedHosts,
        fetchImpl: options.fetchImpl,
        lookupImpl: options.lookupImpl,
      });
    case 'fal':
      return new FalAdapter(cfg.apiKey, cfg.apiBase, {
        additionalAllowedHosts: cfg.additionalAllowedHosts,
        fetchImpl: options.fetchImpl,
        lookupImpl: options.lookupImpl,
      });
    case 'byteplus':
      return new ByteplusAdapter(cfg.apiKey, cfg.apiBase, {
        additionalAllowedHosts: cfg.additionalAllowedHosts,
        fetchImpl: options.fetchImpl,
        lookupImpl: options.lookupImpl,
      });
    case 'google-ai-studio':
      // No lookupImpl: this adapter never fetches a model-supplied URL. Outputs
      // arrive as inline base64 and downloadToPath reads the staged file, so
      // there is no outbound host for the private-address guard to check.
      return new GoogleAIStudioAdapter(cfg.apiKey, cfg.apiBase, {
        fetchImpl: options.fetchImpl,
      });
    default:
      throw new TypedError('PROVIDER_MISCONFIGURED', `Unknown provider id '${cfg.id}'.`);
  }
}
