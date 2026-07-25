import { sanitizeRelativeSegment } from '../utils/outputs.js';

/**
 * Hybrid-v1 output-naming templates (per-project). The forward naming
 * standard is a structured filename like
 *   DEMO01_SEQ010_SH010_F01_BG_AtriumWide_AD_v003_styled.png
 * that Vellum can produce automatically from the hierarchy + version + a few
 * caller-supplied descriptor slots, instead of leaving provider filenames like
 * `gemini_0.png` on disk.
 *
 * A template is a string with `{placeholder}` tokens. This module is PURE —
 * zero IO/DB/MCP — so it is exhaustively unit-testable; the engine gathers the
 * context (project/sequence/shot names, version, provider, metadata slots) and
 * calls `renderNamingTemplate` at output-persist time.
 *
 * Placeholders (optionally `{name:modifier}`):
 *   {project} {sequence} {shot}     — hierarchy names
 *   {version}                        — zero-padded label, e.g. v003
 *   {version_num}                    — bare number, e.g. 3 (pad with :pad3 → 003)
 *   {provider}                       — provider id (e.g. google-ai-studio)
 *   {index}                          — output index for a multi-output take (0-based)
 *   {basename}                       — original filename without extension
 *   {ext}                            — extension without the dot (png, mp4, …)
 *   {slot:KEY}                       — a caller descriptor slot (element, descriptor,
 *                                      artist, stage, frame, …); empty when unset
 * Modifiers: :upper :lower :pad2 :pad3 :pad4
 *
 * Empty tokens (an unset slot, a missing value) resolve to '' and the renderer
 * then COLLAPSES runs of separators the empties leave behind so the name never
 * carries a stray `__` or a leading/trailing separator. The final basename is
 * path-sanitized.
 */

export interface NamingContext {
  project: string;
  sequence: string;
  shot: string;
  /** Zero-padded version label, e.g. 'v003'. */
  versionLabel: string;
  /** Bare version number, e.g. 3. */
  versionNumber: number;
  provider?: string | null;
  /** 0-based output index for multi-output takes. */
  index?: number;
  /** Original filename (with or without extension). */
  originalFilename: string;
  /** Descriptor slots (element, descriptor, artist, stage, frame, …). */
  slots?: Record<string, string>;
}

/** Split a filename into { base, ext } where ext excludes the dot ('' when none). */
export function splitExt(filename: string): { base: string; ext: string } {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return { base: filename, ext: '' };
  return { base: filename.slice(0, dot), ext: filename.slice(dot + 1) };
}

function applyModifier(value: string, modifier: string | undefined): string {
  if (!modifier || value === '') return value;
  switch (modifier) {
    case 'upper':
      return value.toUpperCase();
    case 'lower':
      return value.toLowerCase();
    case 'pad2':
      return value.padStart(2, '0');
    case 'pad3':
      return value.padStart(3, '0');
    case 'pad4':
      return value.padStart(4, '0');
    default:
      return value;
  }
}

/** Resolve one placeholder name (already split from its modifier) to a raw value. */
function resolveToken(name: string, ctx: NamingContext): string {
  if (name.startsWith('slot:')) {
    const key = name.slice('slot:'.length);
    return ctx.slots?.[key] ?? '';
  }
  const { base, ext } = splitExt(ctx.originalFilename);
  switch (name) {
    case 'project':
      return ctx.project;
    case 'sequence':
      return ctx.sequence;
    case 'shot':
      return ctx.shot;
    case 'version':
      return ctx.versionLabel;
    case 'version_num':
      return String(ctx.versionNumber);
    case 'provider':
      return ctx.provider ?? '';
    case 'index':
      return ctx.index != null ? String(ctx.index) : '';
    case 'basename':
      return base;
    case 'ext':
      // The extension is NOT rendered inline — it is appended uniformly AFTER
      // the separator collapse (so an empty optional slot before `.{ext}` can't
      // make the collapse eat the extension separator). {ext} always resolves to
      // the original file's extension, so dropping it here loses nothing.
      return '';
    default:
      return '';
  }
}

/**
 * Render `template` against `ctx` into a safe output basename, or null when the
 * template is empty/unusable (caller falls back to the original filename).
 *
 * The extension is handled specially: whatever the template resolves to is
 * treated as the base, and the ORIGINAL file's extension is appended if the
 * rendered base doesn't already end in one — so a template that forgets {ext}
 * still produces a usable file.
 */
export function renderNamingTemplate(
  template: string | null | undefined,
  ctx: NamingContext,
): string | null {
  if (!template || template.trim() === '') return null;

  // Substitute {name} / {name:modifier} / {slot:KEY[:modifier]}; an unresolved or
  // empty token becomes ''.
  const substituted = template.replace(
    /\{([a-zA-Z_]+(?::[a-zA-Z0-9_]+){0,2})\}/g,
    (_m, token: string) => {
      const parts = token.split(':');
      let name: string;
      let modifier: string | undefined;
      if (parts[0] === 'slot') {
        name = `slot:${parts[1] ?? ''}`;
        modifier = parts[2];
      } else {
        name = parts[0]!;
        modifier = parts[1];
      }
      return applyModifier(resolveToken(name, ctx), modifier);
    },
  );

  // Collapse any run of 2+ separator chars (left behind by empty tokens) to its
  // first char, then trim leading/trailing separators.
  const collapsed = substituted
    .replace(/[_\-.]{2,}/g, (m) => m[0]!)
    .replace(/^[_\-.]+/, '')
    .replace(/[_\-.]+$/, '');

  if (collapsed === '') return null;

  // Append the original extension exactly once. We do NOT infer the rendered
  // extension by re-splitting `collapsed` — a dot inside a token VALUE (a
  // descriptor like 'Atrium.Wide', a version stem 'v2.1') is not an extension and
  // must not suppress the append. Skip only when the base already ends with the
  // source's own extension (idempotent), so a re-render never doubles it.
  const { ext: originalExt } = splitExt(ctx.originalFilename);
  let finalName = collapsed;
  if (originalExt !== '' && !collapsed.toLowerCase().endsWith(`.${originalExt.toLowerCase()}`)) {
    finalName = `${collapsed}.${originalExt}`;
  }

  // Path-safety: the templated name becomes a real path segment. Replace unsafe
  // chars, re-collapse dots, then hand to sanitizeRelativeSegment (throws on the
  // residual '.'/'..' cases → treat as unusable and fall back).
  finalName = finalName.replace(/[/\\\0]/g, '_').replace(/\.{2,}/g, '.');
  try {
    return sanitizeRelativeSegment(finalName);
  } catch {
    return null;
  }
}
