// Breadcrumb-injection shapers used by every tool. The Engine returns
// `{entity, breadcrumb: {entries, text}}` for create/get and
// `{items: (Entity & Breadcrumb)[], total, limit, offset}` for list.
//
// Tools must emit `breadcrumb` (array) + `breadcrumb_text` (string) at top level
// of the structuredContent payload per D-22. These helpers are the single
// translation point between engine-internal `Breadcrumb` and tool-facing shape.

import type { Breadcrumb, BreadcrumbEntry } from '../types/hierarchy.js';

// Shared tool-input bounds (SEC-01, API-05, RT-01). Every tool's raw ZodRawShape
// references these so the published JSON schema carries the correct maxima and
// so handler-side re-validation catches bypasses uniformly.
export const MAX_NAME_LENGTH = 200;
export const MAX_ID_LENGTH = 64;
export const MAX_NOTES_LENGTH = 4000;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Shape a create/get engine result into the tool response payload shape.
 *
 * Engine returns `{entity, breadcrumb: {entries, text}}`; tool emits
 * `{entity, breadcrumb: BreadcrumbEntry[], breadcrumb_text: string}` (D-22).
 */
export function shapeCreateOrGet<TEntity>(result: {
  entity: TEntity;
  breadcrumb: Breadcrumb;
}) {
  return {
    entity: result.entity,
    breadcrumb: result.breadcrumb.entries,
    breadcrumb_text: result.breadcrumb.text,
  };
}

/**
 * Shape a list engine result. Engine merges each entity with its Breadcrumb
 * (`{...entity, entries, text}`); tool splits `entries` / `text` back out into
 * `breadcrumb` / `breadcrumb_text` on each item so every list row carries its
 * own breadcrumb per D-23.
 */
export function shapeList<TItem>(result: {
  items: (TItem & Breadcrumb)[];
  total: number;
  limit: number;
  offset: number;
}) {
  return {
    items: result.items.map((item) => {
      // Engine merges entity fields with Breadcrumb's {entries, text} via spread;
      // split entries/text out of rest and re-emit under the D-22 key names.
      const { entries, text, ...rest } = item as TItem & {
        entries: BreadcrumbEntry[];
        text: string;
      };
      return { ...rest, breadcrumb: entries, breadcrumb_text: text };
    }),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  };
}
