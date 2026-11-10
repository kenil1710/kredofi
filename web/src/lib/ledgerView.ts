// What the server puts in the first HTML of /ledger and /lend, so a reader without JavaScript sees real
// numbers. The browser replaces it with live data at its first poll. Pure: tested in ledgerView.test.ts.
import type { LedgerEvent } from './events.ts';
import { isDevCheckEvent, type Bands } from './seeded.ts';
import type { PinConfig } from './pin.ts';

type Band = { scored: number; loans_issued: number; repaid: number; defaulted: number; volume: string };
export type LedgerData = {
  events: LedgerEvent[];
  stats: Record<'A' | 'B' | 'C' | 'D', Band>;
  seeded?: Bands;
  visitors?: Bands;
  devCheck?: Bands;
  devCheckTimes?: number[];
  pool: { pool_value: string; reserve: string; treasury: string; outstanding: string; cash: string; total_shares: string };
  config: PinConfig & { scorer_mode: string; scorer_version: string };
  /** Lender totals over every indexed event (`events` holds only the newest 200). Base units, strings. */
  lenders?: LenderTotals;
  updatedAt: number;
};
export type LenderTotals = { earned: string; lost: string };
export type LendFirstPaint = { pool: LedgerData['pool']; earned: string; lost: string; at: number };

export const FIRST_PAINT_ROWS = 60;

/** The rows a visitor sees first (developer checks are hidden by default), not the whole answer. */
export function ledgerFirstPaint(d: LedgerData): LedgerData {
  return { ...d, events: d.events.filter((e) => !isDevCheckEvent(e)).slice(0, FIRST_PAINT_ROWS) };
}

export function lostByLenders(events: LedgerEvent[]): bigint {
  return events.filter((e) => e.event === 'loan_defaulted').reduce((s, e) => s + BigInt((e.data as { lender_loss?: string }).lender_loss ?? '0'), 0n);
}

/** Sum of to_pool over repayments: the lenders' half of interest, "earned by lenders so far" (loans.rs repay). */
export function earnedByLenders(events: LedgerEvent[]): bigint {
  return events.filter((e) => e.event === 'loan_repaid').reduce((s, e) => s + BigInt((e.data as { to_pool?: string }).to_pool ?? '0'), 0n);
}

/** Totals over a full event list (the server has every indexed event; the answer carries only 200). */
export function lenderTotals(events: LedgerEvent[]): LenderTotals {
  return { earned: earnedByLenders(events).toString(), lost: lostByLenders(events).toString() };
}

/** The answer's own totals when present, else computed from the events it carries. */
export function lenderTotalsOf(d: Pick<LedgerData, 'events' | 'lenders'>): LenderTotals {
  return d.lenders ?? lenderTotals(d.events);
}

export function lendFirstPaint(d: LedgerData): LendFirstPaint {
  return { pool: d.pool, ...lenderTotalsOf(d), at: d.updatedAt };
}

/** "5 Nov 2026, 14:03 UTC" from milliseconds. */
export function utcMinuteMs(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return `${day}, ${time} UTC`;
}
