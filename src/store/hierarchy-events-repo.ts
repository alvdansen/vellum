import { and, desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { hierarchyEvents } from './schema.js';
import { newId } from '../utils/id.js';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Append-only audit of hierarchy mutations.
 *
 * The hierarchy itself is mutable now (rename, archive), which is exactly why
 * this exists: a rename that leaves no trace turns every artifact naming the old
 * value into a lie. Inserts and reads only — an architecture-purity test greps
 * this file for the Drizzle mutation builders and fails the build if either
 * appears.
 */

export type HierarchyEntityType = 'workspace' | 'project' | 'sequence' | 'shot';
export type HierarchyEventType = 'renamed' | 'archived' | 'unarchived';

export interface HierarchyEvent {
  id: string;
  entity_type: HierarchyEntityType;
  entity_id: string;
  event_type: HierarchyEventType;
  from_value: string | null;
  to_value: string | null;
  changed_by: string;
  note: string | null;
  created_at: number;
}

export interface InsertHierarchyEventInput {
  entityType: HierarchyEntityType;
  entityId: string;
  eventType: HierarchyEventType;
  fromValue?: string | null;
  toValue?: string | null;
  changedBy?: string | null;
  note?: string | null;
}

export class HierarchyEventsRepo {
  constructor(private db: Db) {}

  /** Append one mutation record. Callers write this in the SAME transaction as
   *  the entity mutation, so history and current value cannot diverge. */
  insertEvent(input: InsertHierarchyEventInput): HierarchyEvent {
    const row: HierarchyEvent = {
      id: newId('hev'),
      entity_type: input.entityType,
      entity_id: input.entityId,
      event_type: input.eventType,
      from_value: input.fromValue ?? null,
      to_value: input.toValue ?? null,
      changed_by: input.changedBy ?? 'user',
      note: input.note ?? null,
      created_at: Date.now(),
    };
    this.db.insert(hierarchyEvents).values(row).run();
    return row;
  }

  /** Full mutation history for one entity, newest first. Uses the
   *  (entity_type, entity_id, created_at) index. */
  listForEntity(query: {
    entityType: HierarchyEntityType;
    entityId: string;
    limit: number;
    offset: number;
  }): { items: HierarchyEvent[]; total_count: number } {
    const where = and(
      eq(hierarchyEvents.entity_type, query.entityType),
      eq(hierarchyEvents.entity_id, query.entityId),
    );
    const countRows = this.db
      .select({ n: sql<number>`count(*)` })
      .from(hierarchyEvents)
      .where(where)
      .all();
    const items = this.db
      .select()
      .from(hierarchyEvents)
      .where(where)
      // rowid tiebreaks events landing in the same millisecond — ids are
      // nanoids and carry no insertion order.
      .orderBy(desc(hierarchyEvents.created_at), sql`rowid desc`)
      .limit(query.limit)
      .offset(query.offset)
      .all() as HierarchyEvent[];
    return { items, total_count: countRows[0]?.n ?? 0 };
  }

  /** Every name this entity has ever had, oldest first — the lookup that makes
   *  an old pipeline log or filename traceable to the current row. */
  nameHistory(entityType: HierarchyEntityType, entityId: string): string[] {
    const rows = this.db
      .select()
      .from(hierarchyEvents)
      .where(
        and(
          eq(hierarchyEvents.entity_type, entityType),
          eq(hierarchyEvents.entity_id, entityId),
          eq(hierarchyEvents.event_type, 'renamed'),
        ),
      )
      .orderBy(hierarchyEvents.created_at, sql`rowid asc`)
      .all() as HierarchyEvent[];
    const names: string[] = [];
    for (const r of rows) {
      if (r.from_value !== null && names.length === 0) names.push(r.from_value);
      if (r.to_value !== null) names.push(r.to_value);
    }
    return names;
  }
}
