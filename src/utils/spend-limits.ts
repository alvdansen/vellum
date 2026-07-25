/**
 * Spend-limit configuration parsing (bound what a runaway agent can cost).
 *
 * Single source of truth for the two ceilings the engine can enforce before a
 * submit reaches a provider, so server wiring and any future surface read them
 * the same way.
 *
 * BOTH ARE OPT-IN. Unset means unlimited, matching prior behaviour — turning
 * these on is an operator decision, and a Vellum that silently started refusing
 * work after an upgrade would be worse than one that spends.
 *
 * FAIL CLOSED ON A TYPO, in the opposite direction to the approval gate: a
 * malformed value here is IGNORED (treated as unset) rather than guessed at.
 * Inventing a ceiling from a typo would block legitimate work; the approval
 * gate can safely default to more gating because gating is never destructive,
 * whereas a wrong budget silently halts a production run.
 */

/**
 * Maximum generations allowed to be in flight at once. A runaway agent issuing
 * hundreds of valid submits is bounded by this rather than by the provider's
 * own concurrency billing.
 *
 * Returns null when unset, empty, non-numeric, or < 1.
 */
export function parseMaxInFlight(raw: string | undefined): number | null {
  if (raw == null) return null;
  const v = raw.trim();
  if (v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/** A recorded-spend ceiling over a rolling window. */
export interface SpendLimit {
  amount: number;
  currency: string;
  windowMs: number;
}

const DEFAULT_SPEND_WINDOW_HOURS = 24;

/**
 * Ceiling on RECORDED spend within a rolling window.
 *
 * Necessarily lagging: it sums `cost_recorded` provenance events, which are
 * caller-asserted after a take runs. A proposal's `cost_estimate` is free-form
 * text ("~12 credits") and cannot be summed, so there is no honest way to
 * pre-flight the cost of the take being submitted. What this bounds is how far
 * past the ceiling a run can get — not the individual take that crosses it.
 *
 * Currency is part of the limit because summing mixed currencies would be
 * meaningless; only events matching `currency` count toward it.
 *
 * Returns null unless a positive amount is configured.
 */
export function parseSpendLimit(
  rawAmount: string | undefined,
  rawCurrency: string | undefined,
  rawWindowHours: string | undefined,
): SpendLimit | null {
  if (rawAmount == null) return null;
  const amount = Number(rawAmount.trim());
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const currency = (rawCurrency ?? 'USD').trim().toUpperCase() || 'USD';

  const hours = Number((rawWindowHours ?? '').trim());
  const windowHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SPEND_WINDOW_HOURS;

  return { amount, currency, windowMs: windowHours * 60 * 60 * 1000 };
}
