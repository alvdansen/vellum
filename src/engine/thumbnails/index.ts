// Engine-layer thumbnail module barrel.
//
// This file re-exports the public API surface of the submodules; the engine
// facade, the HTTP thumbnail route, and the dashboard component all import
// from here.
//
// Architecture-purity: zero non-thumbnails imports. The sharp import is
// confined to ./image-thumbnail.ts and the @ffmpeg-installer/ffmpeg
// import is confined to ./video-thumbnail.ts;
// everything in this barrel is re-export only.
//
// image-thumbnail.ts is the sole sharp importer.
// video-thumbnail.ts is the sole @ffmpeg-installer/ffmpeg importer.
// video-thumbnail.ts re-encodes its extracted PNG via the
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

// image-thumbnail.ts is the sole sharp importer.
export {
  generateImageThumbnail,
  getImageBrightness,
  getSharpForVideoReencode,
  __resetSharpStateForTests,
} from './image-thumbnail.js';

// video-thumbnail.ts is the sole @ffmpeg-installer/ffmpeg importer.
export {
  generateVideoThumbnail,
  __setSpawnFfmpegForTests,
  __resetFfmpegStateForTests,
} from './video-thumbnail.js';
