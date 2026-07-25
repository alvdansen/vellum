// Phase 17 / Plan 17-01 Task 1 — pure-ish FS helpers for the thumbnail cache.
//
// Path derivation, atomic temp+rename writer, ETag computation, freshness
// check, failed-sentinel writer, and idempotent invalidator. All exports
// are referentially transparent on inputs (path strings) modulo filesystem
// state — no engine state, no native bindings, no MCP / SQLite / ORM / HTTP
// imports.
//
// EXDEV note: Cache writes live under the same outputRoot/<versionId>/ as
// the source file. The partial path (`<final>.<nanoid>.partial`) and the
// final path (`<final>`) are co-located → EXDEV is structurally impossible.
// The output-downloader.ts renameWithFallback exists to bridge
// outputsDir/.tmp-c2pa/ → outputsDir/<vid>/ — that boundary is not crossed
// here. Do NOT add a copyFile fallback; it would be dead code (RESEARCH.md
// Pattern 3 EXDEV note).
//
// Architecture-purity: zero MCP / DB / ORM / HTTP / sharp / ffmpeg /
// native-binding imports. Verified by the directory-level grep guards in
// src/__tests__/architecture-purity.test.ts.

import { createHash } from 'node:crypto';
import { stat, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { nanoid } from 'nanoid';

/**
 * Final path for a successful thumbnail write — D-01 invariant:
 * `<outputsDir>/<versionId>/<filename>.thumb.webp`. The `.thumb.webp`
 * suffix is stable; downstream HTTP routes (Plan 17-03/17-04) compute the
 * same path.
 */
export function cachePathFor(
  outputRoot: string,
  versionId: string,
  filename: string,
): string {
  return path.join(outputRoot, versionId, `${filename}.thumb.webp`);
}

/**
 * Sentinel path for a failed thumbnail derivation — D-07 invariant:
 * `<outputsDir>/<versionId>/<filename>.thumb.failed`. Empty file (zero
 * bytes); the file's mtime carries the "when failed" semantic.
 */
export function sentinelPathFor(
  outputRoot: string,
  versionId: string,
  filename: string,
): string {
  return path.join(outputRoot, versionId, `${filename}.thumb.failed`);
}

/**
 * Per-call unique partial path — D-22 invariant. Suffix uses nanoid(8) so
 * two concurrent writers for the same `(versionId, filename)` pick
 * different partial paths and rename to the same final path independently
 * (last-writer-wins on the final). Mirrors output-downloader.ts:188 and
 * c2pa/redaction.ts:740-749 patterns.
 *
 * Pure of side effects but NOT pure of return — each call returns a fresh
 * suffix. Tests assert two calls produce distinct paths.
 */
export function partialPathFor(
  outputRoot: string,
  versionId: string,
  filename: string,
): string {
  return `${cachePathFor(outputRoot, versionId, filename)}.${nanoid(8)}.partial`;
}

/**
 * Atomic write helper — invokes `writer(tempPath)` against a unique partial
 * path then renames to `finalPath`. On any error in the writer or the
 * rename, the partial file is best-effort cleaned up (`unlink().catch(() => {})`)
 * and the original error rethrown.
 *
 * The writer callback receives the temp path so it can stream bytes
 * (e.g., `sharp(...).toFile(tempPath)`) or write a buffer
 * (`writeFile(tempPath, bytes)`); both shapes are supported because the
 * temp-path is the exact target for both APIs.
 *
 * Invariant: on a successful return, no `.partial` file with the chosen
 * suffix remains on disk — the rename moved it to `finalPath`. On a
 * thrown error, the partial is cleaned up before the throw propagates.
 *
 * EXDEV: not handled here — see file-header note. Same outputRoot/<vid>/
 * means partial+final co-located, no cross-device rename.
 */
export async function writeAtomic(
  finalPath: string,
  writer: (tempPath: string) => Promise<void>,
): Promise<void> {
  const tempPath = `${finalPath}.${nanoid(8)}.partial`;
  try {
    await writer(tempPath);
    // Late binding for the rename — `node:fs/promises` provides it. Using
    // a dynamic import here keeps the module-level imports minimal AND
    // matches the c2pa/redaction.ts shape.
    const { rename } = await import('node:fs/promises');
    await rename(tempPath, finalPath);
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

/**
 * Compute an HTTP ETag for the thumbnail of `sourcePath`.
 *
 * D-06 strategy:
 *   - When `sha256` is provided (e.g., from `outputs_json[0].sha256`), use
 *     a strong `sha256:` validator. The provided sha256 is the SOURCE
 *     bytes' content hash — invalidates correctly when bytes change.
 *   - Otherwise, fall back to a `mtime:` short-hash. Stat the source,
 *     hash `mtimeMs` to a 16-char hex prefix. Phase 16 redact rewrites
 *     the source file → mtime advances → ETag advances → browsers
 *     re-fetch automatically.
 *
 * Both shapes are quoted per RFC 7232 (`"sha256:..."`). Quoting is part of
 * the strong-validator contract so the route layer can pass through the
 * return value verbatim into the `ETag` response header.
 */
export async function computeETag(
  sourcePath: string,
  sha256?: string | null,
): Promise<string> {
  if (sha256) return `"sha256:${sha256}"`;
  const st = await stat(sourcePath);
  const h = createHash('sha256')
    .update(String(st.mtimeMs))
    .digest('hex')
    .slice(0, 16);
  return `"mtime:${h}"`;
}

/**
 * Result of an `isCacheFresh` check. The `via` discriminator surfaces WHY
 * the cache is fresh — useful for observability and the Plan 17-03 facade
 * which renders the failed-sentinel as a skeleton vs. the cached webp.
 */
export interface CacheFreshness {
  fresh: boolean;
  via: 'cache' | 'sentinel' | 'miss';
}

/**
 * D-07 freshness check for `(cachePath, sentinelPath, sourcePath)`:
 *   - If `cachePath` exists and `cache.mtimeMs >= source.mtimeMs` → fresh
 *     via 'cache'. The cached thumbnail post-dates the source bytes; serve
 *     it.
 *   - Else if `sentinelPath` exists and `sentinel.mtimeMs >= source.mtimeMs`
 *     → fresh via 'sentinel'. The last derivation attempt failed AFTER the
 *     source last changed; do NOT retry until the source advances.
 *   - Else → fresh:false, via:'miss'. Caller should derive (or re-derive
 *     after a source mtime advance).
 *
 * On both ENOENT for cache+sentinel, returns `{fresh:false, via:'miss'}`.
 * Source ENOENT propagates — that is a caller-side bug (the source MUST
 * exist when the engine asks for a thumbnail; resolveOutputForVersion
 * already enforces this).
 */
export async function isCacheFresh(
  cachePath: string,
  sentinelPath: string,
  sourcePath: string,
): Promise<CacheFreshness> {
  const sourceStat = await stat(sourcePath);
  // Cache hit?
  try {
    const cacheStat = await stat(cachePath);
    if (cacheStat.mtimeMs >= sourceStat.mtimeMs) {
      return { fresh: true, via: 'cache' };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  // Sentinel hit?
  try {
    const sentinelStat = await stat(sentinelPath);
    if (sentinelStat.mtimeMs >= sourceStat.mtimeMs) {
      return { fresh: true, via: 'sentinel' };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return { fresh: false, via: 'miss' };
}

/**
 * Write a zero-byte sentinel at `sentinelPath` — D-07 / Pitfall G hygiene.
 *
 * **CRITICAL:** NEVER write the source path, filename, error reason, stack
 * trace, or any other identifier into the sentinel content. The sentinel
 * exists ONLY to mark "we tried to derive at this mtime; do not retry until
 * source advances". The leak-scan extension in src/__tests__/c2pa-key-leak-
 * negative.test.ts asserts the sentinel file size is zero bytes (no
 * identifier hygiene — Pitfall G regression guard).
 */
export async function writeFailedSentinel(sentinelPath: string): Promise<void> {
  await writeFile(sentinelPath, '');
}

/**
 * Idempotent cache invalidation — D-05 hook surface. Removes both the
 * cached thumbnail and the failed-sentinel for `(versionId, filename)`.
 *
 * Both unlinks are wrapped in `.catch(() => {})` so an ENOENT (already
 * gone, or never written) does NOT throw. Mirrors the output-downloader.ts
 * EXDEV-fallback's best-effort cleanup shape.
 *
 * Plan 17-03 wires this into `Engine.invalidateThumbnail`; Plan 16-style
 * redact in c2pa/redaction.ts will call the engine facade AFTER the atomic
 * rename of redacted bytes (D-05 hook position).
 */
export async function invalidateCache(
  outputRoot: string,
  versionId: string,
  filename: string,
): Promise<void> {
  const cachePath = cachePathFor(outputRoot, versionId, filename);
  const sentinelPath = sentinelPathFor(outputRoot, versionId, filename);
  await unlink(cachePath).catch(() => {});
  await unlink(sentinelPath).catch(() => {});
}
