import { and, desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { proposals } from './schema.js';
import { newId } from '../utils/id.js';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Approval-gate store (10-ton "no silent credit spend" law).
 *
 * A proposal records the FULL verbatim generation request before any provider
 * call; a human approves or rejects it; only an approved proposal executes.
 * The single invariant that matters is decide-exactly-once: `decide()` is a
 * guarded UPDATE (`WHERE status='proposed'`) whose changed-row count is the
 * atomic claim — two concurrent approves cannot both submit (double-spend).
 */

export type ProposalKind = 'submit' | 'reproduce' | 'iterate';
export type ProposalStatus = 'proposed' | 'approved' | 'rejected';

export interface Proposal {
  id: string;
  shot_id: string;
  kind: ProposalKind;
  provider: string | null;
  request_json: string;
  notes: string | null;
  cost_estimate: string | null;
  status: ProposalStatus;
  created_at: number;
  decided_at: number | null;
  decided_note: string | null;
  version_id: string | null;
  execution_error: string | null;
}

export interface InsertProposalInput {
  shotId: string;
  kind: ProposalKind;
  provider?: string | null;
  requestJson: string;
  notes?: string | null;
  costEstimate?: string | null;
}

export class ProposalRepo {
  constructor(private db: Db) {}

  insertProposal(input: InsertProposalInput): Proposal {
    const row: Proposal = {
      id: newId('prop'),
      shot_id: input.shotId,
      kind: input.kind,
      provider: input.provider ?? null,
      request_json: input.requestJson,
      notes: input.notes ?? null,
      cost_estimate: input.costEstimate ?? null,
      status: 'proposed',
      created_at: Date.now(),
      decided_at: null,
      decided_note: null,
      version_id: null,
      execution_error: null,
    };
    this.db.insert(proposals).values(row).run();
    return row;
  }

  getProposal(id: string): Proposal | null {
    const rows = this.db.select().from(proposals).where(eq(proposals.id, id)).limit(1).all();
    return (rows[0] as Proposal | undefined) ?? null;
  }

  /**
   * The atomic decide-exactly-once claim. Returns the updated proposal, or
   * null when the proposal was already decided (or does not exist) — the
   * caller maps that to PROPOSAL_ALREADY_DECIDED / PROPOSAL_NOT_FOUND.
   */
  decide(id: string, status: 'approved' | 'rejected', note?: string | null): Proposal | null {
    const res = this.db
      .update(proposals)
      .set({ status, decided_at: Date.now(), decided_note: note ?? null })
      .where(and(eq(proposals.id, id), eq(proposals.status, 'proposed')))
      .run();
    if (res.changes === 0) return null;
    return this.getProposal(id);
  }

  /** Link the version created by an approved proposal's execution. */
  attachVersion(id: string, versionId: string): void {
    this.db
      .update(proposals)
      .set({ version_id: versionId })
      .where(and(eq(proposals.id, id), eq(proposals.status, 'approved')))
      .run();
  }

  /** Record why an approved proposal's execution threw (no version created). */
  recordExecutionError(id: string, message: string): void {
    this.db
      .update(proposals)
      .set({ execution_error: message.slice(0, 2000) })
      .where(and(eq(proposals.id, id), eq(proposals.status, 'approved')))
      .run();
  }

  listProposals(query: {
    shotId?: string;
    status?: ProposalStatus;
    limit: number;
    offset: number;
  }): { items: Proposal[]; total_count: number } {
    const conds = [
      query.shotId ? eq(proposals.shot_id, query.shotId) : undefined,
      query.status ? eq(proposals.status, query.status) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const where = conds.length > 0 ? and(...conds) : undefined;

    const countRows = this.db
      .select({ n: sql<number>`count(*)` })
      .from(proposals)
      .where(where)
      .all();
    const total = countRows[0]?.n ?? 0;

    const items = this.db
      .select()
      .from(proposals)
      .where(where)
      .orderBy(desc(proposals.created_at))
      .limit(query.limit)
      .offset(query.offset)
      .all() as Proposal[];
    return { items, total_count: total };
  }
}
