// Phase 17 / Plan 17-01 Task 1 — engine-layer thumbnail module barrel.
//
// This file re-exports the public API surface of the submodules. Plan
// 17-02 (video-thumbnail), Plan 17-03 (engine facade integration), Plan
// 17-04 (HTTP route + dashboard component), and Plan 17-05 (verification)
// import from here.
//
// Architecture-purity: zero non-thumbnails imports. The sharp import is
// confined to ./image-thumbnail.ts and the @ffmpeg-installer/ffmpeg
// import is confined to ./video-thumbnail.ts (Plan 17-02);
// everything in this barrel is re-export only.
//
// image-thumbnail.ts is the sole sharp importer per D-23.
// video-thumbnail.ts is the sole @ffmpeg-installer/ffmpeg importer per D-24
// (Plan 17-02). video-thumbnail.ts re-encodes its extracted PNG via the
// `getSharpForVideoReencode` helper exported from image-thumbnail.ts so
// sharp stays single-importer.

export { routeFormat, type FormatRoute } from './format-router.js';

export {
  cachePathFor,
  sentinelPathFor,
  partialPathFor,
  writeAtomic,
  computeETag,
  isCacheFresh,
  writeFailedSentinel,
  invalidateCache,
  type CacheFreshness,
} from './cache.js';

// image-thumbnail.ts is the sole sharp importer per D-23.
export {
  generateImageThumbnail,
  getImageBrightness,
  getSharpForVideoReencode,
  __resetSharpStateForTests,
} from './image-thumbnail.js';

// video-thumbnail.ts is the sole @ffmpeg-installer/ffmpeg importer per D-24.
export {
  generateVideoThumbnail,
  __setSpawnFfmpegForTests,
  __resetFfmpegStateForTests,
} from './video-thumbnail.js';
