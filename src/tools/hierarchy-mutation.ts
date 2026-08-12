import { z } from 'zod';
import type { Engine } from '../engine/pipeline.js';
import type { HierarchyEntityType } from '../store/hierarchy-events-repo.js';
import { toolOk } from './envelope.js';
import { shapeCreateOrGet, shapeList, MAX_ID_LENGTH, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from './shape.js';

/**
 * Shared rename / archive / unarchive / history actions for the four hierarchy
 * tools.
 *
 * These four levels differ in their create and list signatures but their
 * MUTATION surface is identical, so it lives here once. Each tool splices these
 * Zod members into its own discriminated union and delegates via
 * `handleHierarchyMutation`, which keeps the wording, the validation and the
 * response envelope from drifting between workspace/project/sequence/shot.
 */

export const RenameInput = z.object({
  action: z.literal('rename'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
  name: z.string().min(1).max(200),
  note: z.string().max(1000).optional(),
  changed_by: z.string().max(200).optional(),
}).strict();

export const ArchiveInput = z.object({
  action: z.literal('archive'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
  note: z.string().max(1000).optional(),
  changed_by: z.string().max(200).optional(),
}).strict();

export const UnarchiveInput = z.object({
  action: z.literal('unarchive'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
  note: z.string().max(1000).optional(),
  changed_by: z.string().max(200).optional(),
}).strict();

export const HistoryInput = z.object({
  action: z.literal('history'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
}).strict();

/** The raw ZodRawShape fields these actions contribute to a tool's published
 *  inputSchema. Every field optional at that layer — the discriminated union
 *  inside the handler is the real enforcement (RT-02). */
export const MUTATION_RAW_FIELDS = {
  name: z.string().optional(),
  note: z.string().optional(),
  changed_by: z.string().optional(),
  include_archived: z.boolean().optional(),
} as const;

export type MutationAction =
  | z.infer<typeof RenameInput>
  | z.infer<typeof ArchiveInput>
  | z.infer<typeof UnarchiveInput>
  | z.infer<typeof HistoryInput>;

/** One sentence per tool description, so the four read identically. */
export function mutationHelpText(entityType: HierarchyEntityType): string {
  return (
    `rename fixes a wrong name (recorded in an append-only history — the old name stays traceable, and files already written do NOT move). ` +
    `archive/unarchive soft-hide a ${entityType} without deleting anything: archived rows drop out of list results and refuse new work, but stay readable and still accept registration of outputs that already exist. ` +
    `Pass include_archived: true to list them. history shows every rename and archive transition.`
  );
}

/**
 * Execute a mutation action. Returns null when the action is not one of the
 * four, so the caller's own switch keeps handling its level-specific actions.
 */
export function handleHierarchyMutation(
  engine: Engine,
  entityType: HierarchyEntityType,
  input: { action: string } & Record<string, unknown>,
): ReturnType<typeof toolOk> | null {
  switch (input.action) {
    case 'rename': {
      const i = input as z.infer<typeof RenameInput>;
      return toolOk(
        shapeCreateOrGet(
          engine.renameEntity(entityType, i.id, i.name, {
            note: i.note,
            changedBy: i.changed_by,
          }),
        ),
      );
    }
    case 'archive':
    case 'unarchive': {
      const i = input as z.infer<typeof ArchiveInput>;
      return toolOk(
        shapeCreateOrGet(
          engine.setEntityArchived(entityType, i.id, input.action === 'archive', {
            note: i.note,
            changedBy: i.changed_by,
          }),
        ),
      );
    }
    case 'history': {
      const i = input as z.infer<typeof HistoryInput>;
      const res = engine.listEntityHistory(entityType, i.id, i.limit, i.offset);
      return toolOk({ ...shapeList(res), name_history: res.name_history });
    }
    default:
      return null;
  }
}
