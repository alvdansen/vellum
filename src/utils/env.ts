// src/utils/env.ts — read environment variables the way people write them.
//
// A `.env` file is almost always a copy of `.env.example` with some blanks
// filled in. To everyone who writes one, a key left as `FOO=` means "I did not
// set this". `process.env.FOO ?? fallback` disagrees: an empty string is not
// nullish, so the fallback never applies and `''` flows into config as though
// it were a deliberate value.
//
// That gap is not theoretical. `COMFYUI_API_BASE=` — the natural way to write
// "just use the default" — produced `apiBase = ''`, which the base-URL
// validator rejected with a fatal boot error. Following the documented
// quickstart (`cp .env.example .env`) was enough to hit it. The same shape
// silently broke the `GOOGLE_AI_STUDIO_API_KEY` → `GEMINI_API_KEY` alias, and
// pointed the C2PA certificate allowlist root at `''`.
//
// So: empty and whitespace-only are UNSET, everywhere.

/**
 * Read an env var, treating empty or whitespace-only as unset.
 *
 * Returns the trimmed value, or `undefined` — so `??` and `?.` behave the way
 * the calling code already assumes they do.
 */
export function envValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Read a comma-separated env list into trimmed, non-empty entries.
 * `undefined`, `''` and `'  , ,'` all yield `[]`.
 */
export function envList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
