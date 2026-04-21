/**
 * IS-02: validate COMFYUI_API_BASE at server boot.
 *
 * Defensive checks:
 *  - Must parse as a URL.
 *  - Protocol must be https: (cleartext http: leaks the X-API-Key header).
 *    Override: `COMFYUI_API_BASE_ALLOW_HTTP=1` for local dev against a plaintext
 *    localhost instance.
 *  - Hostname must not match RFC 1918 private ranges or cloud link-local
 *    metadata endpoints unless `COMFYUI_API_BASE_ALLOW_PRIVATE=1`.
 *
 * Fail-fast at boot with an actionable error message so a misconfiguration
 * never reaches the first submit/status call.
 */

export interface ValidateBaseUrlOptions {
  allowHttp?: boolean;
  allowPrivate?: boolean;
}

/**
 * RFC-1918 + IPv4 link-local + common loopback + IPv6 loopback/link-local.
 * Keep conservative — we want false positives (over-rejecting exotic configs)
 * rather than false negatives here.
 */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  // Trim bracketed IPv6 (e.g. "[::1]")
  const bare = h.replace(/^\[|\]$/g, '');
  if (bare === 'localhost' || bare === 'localhost.localdomain') return true;
  // IPv4 numeric
  if (/^127(?:\.\d{1,3}){3}$/.test(bare)) return true;
  if (/^169\.254(?:\.\d{1,3}){2}$/.test(bare)) return true;
  if (/^10(?:\.\d{1,3}){3}$/.test(bare)) return true;
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(bare)) return true;
  // 172.16.0.0/12 — second octet in [16,31]
  const m = bare.match(/^172\.(\d{1,3})(?:\.\d{1,3}){2}$/);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 loopback + link-local
  if (bare === '::1' || bare === '0:0:0:0:0:0:0:1') return true;
  if (/^fe80:/i.test(bare)) return true;
  if (/^fc[0-9a-f]{2}:/i.test(bare) || /^fd[0-9a-f]{2}:/i.test(bare)) return true;
  return false;
}

/**
 * Returns the parsed URL on success. Throws a descriptive `Error` on failure —
 * callers should catch and fail-fast (exit non-zero) from the boot path.
 */
export function validateBaseUrl(
  raw: string,
  opts: ValidateBaseUrlOptions = {},
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `COMFYUI_API_BASE is not a valid URL: ${raw}. ` +
        `Set COMFYUI_API_BASE to a full origin like https://cloud.comfy.org.`,
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(
      `COMFYUI_API_BASE must use http(s); got ${url.protocol}. ` +
        `Use https://cloud.comfy.org or your tenant's HTTPS URL.`,
    );
  }
  if (url.protocol === 'http:' && !opts.allowHttp) {
    throw new Error(
      `COMFYUI_API_BASE is http:// (cleartext). The X-API-Key header would leak over the network. ` +
        `Use https:// or, for local development against a plaintext localhost instance, ` +
        `set COMFYUI_API_BASE_ALLOW_HTTP=1.`,
    );
  }
  if (isPrivateHost(url.hostname) && !opts.allowPrivate) {
    throw new Error(
      `COMFYUI_API_BASE host '${url.hostname}' looks private (loopback / RFC1918 / link-local). ` +
        `That is almost certainly a misconfiguration when talking to ComfyUI Cloud. ` +
        `For local dev, set COMFYUI_API_BASE_ALLOW_PRIVATE=1 to bypass this check.`,
    );
  }
  return url;
}

/**
 * Convenience wrapper that reads the relevant env vars directly. Keeps the
 * server-boot site short and lets the pure validator stay testable.
 */
export function validateBaseUrlFromEnv(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
): URL {
  return validateBaseUrl(raw, {
    allowHttp: env.COMFYUI_API_BASE_ALLOW_HTTP === '1',
    allowPrivate: env.COMFYUI_API_BASE_ALLOW_PRIVATE === '1',
  });
}
