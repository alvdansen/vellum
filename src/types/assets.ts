// Pure type definitions for Vellum asset management (tags + metadata).
// ZERO imports from drizzle/zod/mcp — engine, store, and tools all consume these.

import type { Version } from './hierarchy.js';

/** A single tag attachment on a version. */
export interface Tag {
  id: string;          // tag_<nanoid>
  version_id: string;
  tag: string;         // matches TAG_REGEX /^[A-Za-z0-9_\-.:]+$/
  created_at: number;  // epoch ms
}

/** A single metadata entry on a version. */
export interface MetadataEntry {
  id: string;          // meta_<nanoid>
  version_id: string;
  key: string;         // matches TAG_REGEX
  value: string;       // any UTF-8 ≤ MAX_METADATA_VALUE_LENGTH
  created_at: number;  // refreshed on upsert
}

/** Metadata shape as surfaced on hydrated version responses. */
export interface MetadataKV {
  key: string;
  value: string;
}

/**
 * Version entity extended with tags + metadata arrays, as returned
 * by every asset.query item and by version.get. Tags ASC alphabetical;
 * metadata ASC by key.
 */
export type VersionWithAssets = Version & {
  tags: string[];
  metadata: MetadataKV[];
};

/** Input shape for asset.query. All fields optional except limit/offset resolution. */
export interface AssetsQueryFilter {
  workspace_id?: string;
  project_id?: string;
  sequence_id?: string;
  shot_id?: string;
  tags?: string[];                    // 1..20 entries; each matches TAG_REGEX
  metadata?: MetadataKV[];            // 1..20 entries
  date_from?: number;                 // epoch-ms, inclusive
  date_to?: number;                   // epoch-ms, inclusive
  status?: 'submitted' | 'running' | 'completed' | 'failed';
  limit: number;                      // resolved default 20, cap 100
  offset: number;                     // resolved default 0
}

/** Scope echo shape for list_tags / list_metadata_keys responses. */
export interface ScopeFilter {
  workspace_id?: string;
  project_id?: string;
  sequence_id?: string;
  shot_id?: string;
}

/** Item shape for asset.list_tags and asset.list_metadata_keys. */
export interface TagCount {
  name: string;
  count: number;
}

/** Type alias — list_metadata_keys returns the same shape as list_tags. */
export type MetadataKeyCount = TagCount;
