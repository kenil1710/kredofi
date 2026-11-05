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
  updatedAt: number;
};
export type LendFirstPaint = { pool: LedgerData['pool']; lost: string; at: number };

export const FIRST_PAINT_ROWS = 60;

/** The rows a visitor sees first (developer checks are hidden by default), not the whole answer. */
export function ledgerFirstPaint(d: LedgerData): LedgerData {
  return { ...d, events: d.events.filter((e) => !isDevCheckEvent(e)).slice(0, FIRST_PAINT_ROWS) };
}

export function lostByLenders(events: LedgerEvent[]): bigint {
  return events.filter((e) => e.event === 'loan_defaulted').reduce((s, e) => s + BigInt((e.data as { lender_loss?: string }).lender_loss ?? '0'), 0n);
}

export function lendFirstPaint(d: LedgerData): LendFirstPaint {
  return { pool: d.pool, lost: lostByLenders(d.events).toString(), at: d.updatedAt };
}

/** "5 Nov 2026, 14:03 UTC" from milliseconds. */
export function utcMinuteMs(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return `${day}, ${time} UTC`;
}
