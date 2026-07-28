// src/tools/asset-query-schema.ts — the asset read-query input contract.
//
// Shared by BOTH surfaces that accept these queries: the MCP asset tool
// (src/tools/asset-tool.ts, which composes them with an `action` literal) and
// the dashboard REST routes (src/http/dashboard-routes.ts).
//
// WHY IT LIVES ON ITS OWN: the REST routes previously handed the raw request
// body straight to the engine, which binds the values into SQL. The documented
// empty body `{}` therefore came back as `500 {"code":"INTERNAL_ERROR",
// "message":"datatype mismatch"}` — a raw SQLite error, because `limit` and
// `offset` arrived undefined with no defaults applied. The MCP path had always
// been validated. Sharing one definition is what stops the two surfaces
// disagreeing again; a copy in the route would drift the moment either moved.
//
// Deliberately free of MCP-SDK and engine imports so the HTTP layer can use it
// without reaching into the tool layer (architecture-purity: src/http/* must
// carry no SDK dependency, transitive or otherwise).

import { z } from 'zod';
import {
  MAX_ID_LENGTH,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  MAX_TAG_LENGTH,
  MAX_METADATA_KEY_LENGTH,
  MAX_METADATA_VALUE_LENGTH,
  TAG_REGEX,
} from './shape.js';

export const TagZ = z.string().min(1).max(MAX_TAG_LENGTH).regex(TAG_REGEX, 'TAG_INVALID');
export const KeyZ = z
  .string()
  .min(1)
  .max(MAX_METADATA_KEY_LENGTH)
  .regex(TAG_REGEX, 'METADATA_INVALID');
export const ValueZ = z.string().min(1).max(MAX_METADATA_VALUE_LENGTH);
export const StatusZ = z.enum(['submitted', 'running', 'completed', 'failed']);
export const ScopeIdZ = z.string().min(1).max(MAX_ID_LENGTH).optional();

/** Scope + pagination fields every asset read-query shares. */
const scopeAndPaging = {
  workspace_id: ScopeIdZ,
  project_id: ScopeIdZ,
  sequence_id: ScopeIdZ,
  shot_id: ScopeIdZ,
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
};

// Every body is .strict(): an unrecognized key is rejected instead of
// silently dropped, because the drop is a scope bug — `{sequenceId: X}`
// (the hierarchy tools' spelling) used to be ignored here and the query
// quietly returned every project's rows.
/** `asset.query` body (no `action` — the tool layer adds that). */
export const AssetQueryBody = z.object({
  ...scopeAndPaging,
  tags: z.array(TagZ).min(1).max(20).optional(),
  metadata: z
    .array(z.object({ key: KeyZ, value: ValueZ }))
    .min(1)
    .max(20)
    .optional(),
  date_from: z.number().int().nonnegative().optional(),
  date_to: z.number().int().nonnegative().optional(),
  status: StatusZ.optional(),
}).strict();

/** `asset.list_tags` body. */
export const ListTagsBody = z.object({ ...scopeAndPaging }).strict();

/** `asset.list_metadata_keys` body. */
export const ListMetadataKeysBody = z.object({ ...scopeAndPaging }).strict();
