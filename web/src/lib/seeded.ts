// Seeded demo activity (SPEC 8d, docs/LEDGER_PLAN.md): accounts our script runs with Plaid sandbox data
// so the testnet ledger shows how it looks over time. Every row from them is tagged "Seeded demo" and
// their numbers are shown apart from visitors'. They are not real users. Pure, unit-tested.
import type { LedgerEvent } from './events';

/** borrower-01.kredofi-seed.testnet … borrower-99.kredofi-seed.testnet and lender.kredofi-seed.testnet. */
export const SEED_PARENT = 'kredofi-seed.testnet';
export const SEED_PATTERN = /^(borrower-\d{2}|lender)\.kredofi-seed\.testnet$/;
export const SEEDED_LABEL = 'Seeded demo';
export const SEEDED_NOTE = 'Rows tagged Seeded demo were made by our script with Plaid sandbox data to show how the ledger looks over time. They are not real users.';

export const isSeeded = (account: unknown): boolean => typeof account === 'string' && SEED_PATTERN.test(account);
/** The account an event is about (borrower or lender), if any. */
export const actorOf = (e: LedgerEvent): string | null => {
  const a = e.data.borrower ?? e.data.lender;
  return typeof a === 'string' ? a : null;
};
export const isSeededEvent = (e: LedgerEvent) => isSeeded(actorOf(e));

export type BandStats = { scored: number; loans_issued: number; repaid: number; defaulted: number; volume: string };
export type Bands = Record<'A' | 'B' | 'C' | 'D', BandStats>;
const empty = (): Bands => ({ A: z(), B: z(), C: z(), D: z() });
function z(): BandStats { return { scored: 0, loans_issued: 0, repaid: 0, defaulted: 0, volume: '0' }; }

/** Per-band numbers for seeded accounts, counted from events the way the contract's get_stats counts:
 *  a repayment or default counts in the band of the loan it closes. */
export function seededStats(events: LedgerEvent[]): Bands {
  const out = empty(), loanBand = new Map<string, keyof Bands>();
  for (const e of [...events].sort((a, b) => a.ts - b.ts || a.idx - b.idx)) {
    const who = actorOf(e);
    if (!isSeeded(who)) continue;
    const band = String(e.data.band ?? '') as keyof Bands;
    if (e.event === 'score_issued' && out[band]) out[band].scored++;
    else if (e.event === 'loan_issued' && out[band]) {
      out[band].loans_issued++; out[band].volume = (BigInt(out[band].volume) + BigInt(String(e.data.principal ?? 0))).toString();
      loanBand.set(who!, band);
    } else if (e.event === 'loan_repaid' || e.event === 'loan_defaulted') {
      const b = loanBand.get(who!); if (!b) continue;
      if (e.event === 'loan_repaid') out[b].repaid++; else out[b].defaulted++;
    }
  }
  return out;
}

/** Visitors = the contract's own totals minus the seeded part (never below zero while the index lags). */
export function visitorStats(total: Bands, seeded: Bands): Bands {
  const out = empty();
  for (const b of ['A', 'B', 'C', 'D'] as const) {
    const t = total[b] ?? z(), s = seeded[b];
    out[b] = {
      scored: Math.max(0, t.scored - s.scored), loans_issued: Math.max(0, t.loans_issued - s.loans_issued),
      repaid: Math.max(0, t.repaid - s.repaid), defaulted: Math.max(0, t.defaulted - s.defaulted),
      volume: (BigInt(t.volume) > BigInt(s.volume) ? BigInt(t.volume) - BigInt(s.volume) : 0n).toString(),
    };
  }
  return out;
}
