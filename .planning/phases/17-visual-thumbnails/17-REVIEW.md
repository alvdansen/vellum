---
phase: 17-visual-thumbnails
reviewed: 2026-05-01T22:30:00Z
depth: standard
files_reviewed: 30
files_reviewed_list:
  - package.json
  - packages/dashboard/src/__tests__/api.test.ts
  - packages/dashboard/src/__tests__/C2paShield.test.tsx
  - packages/dashboard/src/__tests__/Thumbnail.test.tsx
  - packages/dashboard/src/__tests__/TreeSidebar.test.tsx
  - packages/dashboard/src/__tests__/VersionCard.test.tsx
  - packages/dashboard/src/components/C2paShield.tsx
  - packages/dashboard/src/components/Thumbnail.tsx
  - packages/dashboard/src/components/TreeSidebar.tsx
  - packages/dashboard/src/components/VersionCard.tsx
  - packages/dashboard/src/lib/api.ts
  - packages/dashboard/src/lib/copy.ts
  - packages/dashboard/src/views/HomeView.tsx
  - src/__tests__/architecture-purity.test.ts
  - src/__tests__/c2pa-key-leak-negative.test.ts
  - src/__tests__/c2pa-redaction-thumbnail-invalidation.test.ts
  - src/__tests__/thumbnail-route.test.ts
  - src/engine/c2pa/redaction.ts
  - src/engine/errors.ts
  - src/engine/pipeline.ts
  - src/engine/thumbnails/__tests__/cache.test.ts
  - src/engine/thumbnails/__tests__/format-router.test.ts
  - src/engine/thumbnails/__tests__/image-thumbnail.test.ts
  - src/engine/thumbnails/__tests__/video-thumbnail.test.ts
  - src/engine/thumbnails/cache.ts
  - src/engine/thumbnails/format-router.ts
  - src/engine/thumbnails/image-thumbnail.ts
  - src/engine/thumbnails/index.ts
  - src/engine/thumbnails/video-thumbnail.ts
  - src/http/dashboard-routes.ts
  - src/http/error-middleware.ts
findings:
  critical: 0
  warning: 4
  info: 5
  total: 9
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-05-01T22:30:00Z
**Depth:** standard
**Files Reviewed:** 30
**Status:** issues_found

## Summary

Phase 17 introduces visual thumbnails (image + MP4 first-frame extraction) plus
a C2PA "signed" shield overlay across the dashboard. The code is high quality
overall — strong architecture-purity discipline (sole-importer assertions for
sharp, ffmpeg, c2pa-node), monotonic native-binding-failure semantics, atomic
temp+rename writes, idempotent cache invalidation, and a coalescing mutex for
same-key thumbnail derivation. Tests are thorough and cross-encoding leak
scans guard the post-redact regenerated thumbnail bytes.

The standard review surfaced **no critical issues**. Four warnings concern:
(1) a buggy "UTF-16BE" encoding in one test's leak-scan helper that silently
fails to scan for that encoding, (2) the engine's `deriveThumbnail` lacks an
internal path-traversal defence-in-depth check (relies on the HTTP route's
`resolveOutputForVersion` for sanitization), (3) thumbnail status semantics
where a missing source file collapses to 404 instead of 503/skeleton, and
(4) an unused `imgLoaded` state in `Thumbnail.tsx` that triggers re-renders
without using the value.

Five info items cover style, dead code, and minor consistency improvements.

## Warnings

### WR-01: Buggy UTF-16BE encoding in redaction leak-scan helper silently misses the BE variant

**File:** `src/__tests__/c2pa-redaction-thumbnail-invalidation.test.ts:71`

**Issue:** The `assertNotInBuffer` helper claims to scan for the sentinel in
4 encodings (UTF-8, UTF-16LE, UTF-16BE, base64). The "UTF-16BE roughly" line
calls `Buffer.from(secret, 'utf16le').reverse().toString('binary')`. Reversing
the entire buffer does NOT produce UTF-16BE — UTF-16BE differs from UTF-16LE
only by per-codepoint byte-pair swapping (swap bytes 0/1, 2/3, 4/5...), not
by reversing the whole sequence. The reversed-buffer fragment is effectively
a never-occurring byte string in any real leak, so this test will not detect
a genuine UTF-16BE-encoded sentinel leak in the post-redact thumbnail. The
comment "UTF-16BE roughly" suggests the author was aware of the imprecision,
but the assertion advertises BE coverage that is not actually delivered.

The sibling test file (`src/__tests__/c2pa-key-leak-negative.test.ts:567-577`)
implements the correct byte-pair swap. That implementation should be reused.

**Fix:**
```ts
function assertNotInBuffer(buf: Buffer, secret: string, label: string): void {
  if (secret.length === 0) return;
  // Build correct UTF-16BE by swapping byte pairs of UTF-16LE.
  const utf16leFrag = Buffer.from(secret, 'utf16le');
  const utf16beFrag = Buffer.alloc(utf16leFrag.length);
  for (let i = 0; i < utf16leFrag.length; i += 2) {
    utf16beFrag[i] = utf16leFrag[i + 1]!;
    utf16beFrag[i + 1] = utf16leFrag[i]!;
  }
  const fragments = [
    secret,                                 // UTF-8 / ASCII
    utf16leFrag.toString('binary'),         // UTF-16LE
    utf16beFrag.toString('binary'),         // UTF-16BE — correct byte-pair swap
    Buffer.from(secret).toString('base64'), // base64
  ];
  const haystack = buf.toString('binary');
  for (const frag of fragments) {
    if (frag.length === 0) continue;
    expect(
      haystack.includes(frag),
      `D-CTX-1 leak via ${label} — fragment "${frag.slice(0, 20)}..." in post-redact thumbnail bytes`,
    ).toBe(false);
  }
}
```

### WR-02: Engine.deriveThumbnail lacks internal path-traversal defence-in-depth

**File:** `src/engine/pipeline.ts:2006-2012`

**Issue:** `deriveThumbnail` constructs `sourcePath`, `cachePath`, and
`sentinelPath` directly from the `filename` argument without verifying it
contains no path-traversal characters (`..`, `/`, `\\`). Today the only
caller — the HTTP route at `dashboard-routes.ts:382-414` — calls
`resolveOutputForVersion` first, which does perform that check. But:

1. `Engine.generateThumbnail` (and through it `deriveThumbnail`) is now a
   public method on the Engine facade. A future caller (a new tool, an
   internal cron job, etc.) that bypasses the HTTP route would silently
   inherit the gap.
2. The companion engine method `Engine.invalidateThumbnail` ALSO accepts
   `filename` directly and forwards to `Thumbnails.invalidateCache` without
   sanitization (line 1992).
3. Other engine methods that accept a `filename` argument (e.g.,
   `redactManifestForVersionImpl` at `redaction.ts:606-612`) DO perform the
   internal traversal guard. The thumbnail surface should match.

This is defence-in-depth — not currently a vulnerability — but mismatched
discipline across the engine surface.

**Fix:** Add a guard at the top of `deriveThumbnail` (and `invalidateThumbnail`)
that mirrors `redactManifestForVersionImpl`'s shape:

```ts
// In src/engine/pipeline.ts — both deriveThumbnail and invalidateThumbnail
if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
  throw new TypedError(
    'INVALID_INPUT',
    `Thumbnail filename contains path-traversal characters: ${filename}`,
  );
}
// Optional: also resolve+startsWith verification (mirrors redaction.ts:632-643)
const safeName = nodepath.basename(filename);
const resolvedRoot = nodepath.resolve(this.outputRoot);
const resolvedFull = nodepath.resolve(this.outputRoot, versionId, safeName);
if (
  !resolvedFull.startsWith(resolvedRoot + nodepath.sep) &&
  resolvedFull !== resolvedRoot
) {
  throw new TypedError(
    'INVALID_INPUT',
    `Resolved thumbnail path escapes outputsDir: ${filename}`,
  );
}
```

### WR-03: Thumbnail route returns 404 OUTPUT_UNAVAILABLE when source missing — UI cannot disambiguate from "version not found"

**File:** `src/http/dashboard-routes.ts:382-395` (and `:312-319`)

**Issue:** The thumbnail GET handler delegates to `resolveOutputForVersion`,
which throws `OUTPUT_UNAVAILABLE` (mapped to 404) when the on-disk source
file is missing. The dashboard's `Thumbnail` component handles `<img>`
`onError` by switching to a skeleton + `aria-label="Preview unavailable"`.
That behavior covers 404, 500, and 503 uniformly.

However, the route's intent (per the inline doc at `dashboard-routes.ts:367-368`)
is to return 503 + THUMBNAIL_FAILED for "thumbnail unavailable but version
still healthy" cases. A missing source file is structurally the same condition
("the underlying asset is gone"), but `resolveOutputForVersion` has already
thrown 404 before `engine.generateThumbnail` is reached. The route never has
a chance to write a `.thumb.failed` sentinel for retry-suppression — every
subsequent request will repeat the same fs.stat/existsSync work without the
sentinel short-circuit.

This is functional today (the UI handles either status), but two concerns:
(a) observability — a 404 vs 503 split surfaces differently in dashboards/
metrics; (b) hot-path inefficiency — without the sentinel, repeated polls
of a missing source will hit the disk on every request.

**Fix:** Either accept the current behavior and document it (the simpler
path), or move the existsSync check into `engine.generateThumbnail` so the
sentinel-write path engages. Conservative recommendation: keep the existing
404 mapping but add a short doc comment to the thumbnail route explaining
the divergence:

```ts
// Phase 17 / Plan 17-03 — NOTE: a missing source file surfaces as 404
// OUTPUT_UNAVAILABLE (via resolveOutputForVersion) rather than 503
// THUMBNAIL_FAILED. The UI handles both equivalently (skeleton fallback);
// the 404 path bypasses the sentinel-write retry-suppression. If the host
// platform's fs throughput becomes a hot-path concern, move the existsSync
// check into engine.generateThumbnail so the sentinel engages.
app.get('/api/versions/:id/thumbnail', async (c) => { ... });
```

### WR-04: Unused imgLoaded state in Thumbnail.tsx triggers superfluous re-renders

**File:** `packages/dashboard/src/components/Thumbnail.tsx:121, 182`

**Issue:** Line 121 destructures `[, setImgLoaded]` (discarding the value)
and line 182 invokes `setImgLoaded(true)` on the `<img>` `onLoad` handler.
Because the value is discarded but the setter is still called, every
successful image load triggers a re-render of `Thumbnail` for no observable
effect — `showSkeleton` does not consume `imgLoaded`, the render output is
identical before and after, and Preact's reconciler still walks the tree.

Either: (a) the state is dead and should be removed, OR (b) the original
intent was to consume `imgLoaded` (e.g., for a fade-in, a different
aria-busy state, or to differentiate "still loading" from "decoded"), in
which case the consumption is missing.

Tests pass because the assertions key off `imgError`/`status`/`alt`; none
inspect a "loaded" visual indicator.

**Fix:** Drop the unused state entirely:

```ts
export function Thumbnail({...}: ThumbnailProps) {
  const [imgError, setImgError] = useState(false);
  // (removed: const [, setImgLoaded] = useState(false))

  const isComplete = version.status === 'complete';
  const showSkeleton = !isComplete || imgError;
  // ...
  <img
    src={getThumbnailUrl(version.id)}
    // ...
    onError={() => setImgError(true)}
    // (removed: onLoad={() => setImgLoaded(true)})
  />
}
```

If the author intended to consume `imgLoaded` (e.g., fade-in animation),
add a `data-loaded` attribute or a class composition that actually uses it.

## Info

### IN-01: Stub Test 7 in cache.test.ts has incomplete assertion

**File:** `src/engine/thumbnails/__tests__/cache.test.ts:109-126`

**Issue:** Test 7 ("writeAtomic cleans up the partial when the rename fails")
sets `parent` to a directory that does not exist, expects the call to reject,
and asserts only `.rejects.toThrow()`. The accompanying comment says "we
simply assert the call rejected. The cleanup is best-effort." But the test
title implies it verifies cleanup of the partial — and the parent dir does
not exist, so even checking for partial absence is impossible (no readdir).

The test name and the actual coverage diverge. Either rename the test to
match coverage, or seed a real-but-readonly parent dir so the rename fails
AFTER the writer succeeded, and assert no `.partial` file remains.

**Fix:** Either rename to `'writeAtomic rejects when the parent directory is missing'`,
or restructure to seed a writable parent + force the rename to fail (e.g.,
by `vi.mock`-ing `node:fs/promises` rename to throw):

```ts
it('Test 7: writeAtomic cleans up the partial when the rename fails', async () => {
  const parent = join(root, versionId);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(parent, { recursive: true });
  const finalPath = join(parent, 'final.webp');

  // Force rename to fail by deleting the partial mid-flight (race-free hack).
  // OR: mock node:fs/promises rename to throw.
  await expect(
    writeAtomic(finalPath, async (tempPath) => {
      await writeFile(tempPath, Buffer.from([0xab, 0xcd]));
      // simulate rename failure: unlink target dir before rename runs
      // (impossible from inside the writer — use vi.spyOn instead).
    }),
  ).rejects.toThrow();
  const partials = (await readdir(parent)).filter((e) => e.endsWith('.partial'));
  expect(partials).toEqual([]);
});
```

### IN-02: Test 5 in image-thumbnail.test.ts comment claims invocation-count proof but does not assert it

**File:** `src/engine/thumbnails/__tests__/image-thumbnail.test.ts:204-222`

**Issue:** Test 5 (monotonic-fail) sets up `vi.doMock('sharp', ...)` to throw
once, then asserts both `first` and `second` calls return null. The block
comment at lines 209-214 says "Vitest's doMock records each `import('sharp')`
as a fresh mock setup; the second call must NOT trigger a fresh dynamic-
import. We verify by checking the monotonic invariant: a SECOND call returns
null in the same way WITHOUT throwing about a missing mock."

The actual assertion (`expect(second).toBeNull()`) is consistent with both
"second call short-circuited via cachedSharpFailed" AND "second call
re-attempted import and the mock threw again, returning null via the same
catch path". The test does not assert the mock was invoked exactly once —
so the monotonic claim is not structurally proven.

This is fine for v1.2 because the production code path is correct (verified
by reading `getSharp()` at `image-thumbnail.ts:65-87`), but the test
documentation overstates what the test verifies.

**Fix:** Either (a) tighten the comment to match the assertion ("we verify
that subsequent calls behave consistently — both return null") or (b) add
an explicit invocation-count assertion via `vi.fn()` mock factory:

```ts
const sharpImportFn = vi.fn(() => { throw new Error('synthetic-platform-mismatch'); });
vi.doMock('sharp', sharpImportFn);
// ... existing test body ...
// New assertion: import was attempted ONCE.
expect(sharpImportFn).toHaveBeenCalledTimes(1);
```

### IN-03: HomeView only populates latestCompletedVersion for the selected shot

**File:** `packages/dashboard/src/views/HomeView.tsx:194-218`

**Issue:** The "selected-shot-only" populate approach means every other
shot row in the sidebar renders the SkeletonThumbnail fallback (D-14/D-15).
The plan documents this as the v1.2 conservative ship — "cross-shot prefetch
is deferred to v1.3". Implementation matches the plan, but:

1. The fallback message degrades discoverability — users browsing the
   sidebar see skeleton rectangles for sibling shots they might want to
   compare against without selecting first.
2. The fallback is in the sidebar (high traffic), so the visible UX gap
   is large.

This is **strictly out of scope for v1.2** and is correctly documented as
a deferred item. Recording here for completeness; no action needed unless
the v1.3 prefetch lands sooner.

**Fix:** No change for v1.2. v1.3 may add a `useEffect` on `tree.workspaces`
that batches `fetchVersions` for visible shots (debounced + capped).

### IN-04: PREVIEW_UNAVAILABLE_PREFIX is a constant prefix without a parameterized helper

**File:** `packages/dashboard/src/lib/copy.ts:47, packages/dashboard/src/components/Thumbnail.tsx:146`

**Issue:** The aria-label fallback for an image-load error is
`${PREVIEW_UNAVAILABLE_PREFIX}${version.label}`. The prefix-only form means
every consumer must remember to concatenate the label. A small helper would
remove the chance of a future caller forgetting to append the label (which
would surface as just `"Preview unavailable for "` to a screen reader — a
trailing-space oddity).

**Fix:** Export a small helper in `lib/copy.ts`:

```ts
/** Helper — full preview-unavailable label including the version label. */
export function previewUnavailableFor(versionLabel: string): string {
  return `${PREVIEW_UNAVAILABLE_PREFIX}${versionLabel}`;
}
```

Then in `Thumbnail.tsx`:

```ts
import { previewUnavailableFor } from '../lib/copy.js';
// ...
aria-label={imgError ? previewUnavailableFor(version.label) : undefined}
```

### IN-05: Inconsistent test-file numbering convention across thumbnails test suite

**File:** `src/engine/thumbnails/__tests__/*.test.ts`

**Issue:** The test files use a `Test N:` prefix in `it('Test 1: ...', ...)`
(e.g., `cache.test.ts:43`, `image-thumbnail.test.ts:95`, `format-router.test.ts:18`).
The numbering occasionally restarts within a single file (e.g., `Test 6a/6b/6c`
in `image-thumbnail.test.ts:228-251` — letter-suffixed sub-cases). Other
test files in the project (`thumbnail-route.test.ts:188-419`) use a flat
`Test N:` numbering.

This is purely a style preference — the assertions all run regardless of
naming — but the inconsistency makes it harder to grep for a specific test
across files (e.g., "Test 5" appears in `cache.test.ts`, `image-thumbnail.test.ts`,
AND `format-router.test.ts` referring to different tests).

**Fix:** No correctness change required. If the team wants a unified
convention, prefer either flat numbering throughout each file (no `6a/6b/6c`)
or describe-block-grouped lettering (`'6a' / '6b'` only inside a single
describe block). v1.3 cleanup, not v1.2 blocker.

---

_Reviewed: 2026-05-01T22:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
