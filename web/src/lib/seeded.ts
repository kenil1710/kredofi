// Seeded demo activity (SPEC 8d, docs/LEDGER_PLAN.md): accounts our script runs with Plaid sandbox data
// so the testnet ledger shows how it looks over time. Every row from them is tagged "Seeded demo" and
// their numbers are shown apart from visitors'. They are not real users. Pure, unit-tested.
import type { LedgerEvent } from './events';

/** borrower-01.kredofi-seed.testnet … borrower-99.kredofi-seed.testnet and lender.kredofi-seed.testnet. */
export const SEED_PARENT = 'kredofi-seed.testnet';
export const SEED_PATTERN = /^(borrower-\d{2}|lender)\.kredofi-seed\.testnet$/;
export const SEEDED_LABEL = 'Seeded demo';
export const SEEDED_NOTE = 'Rows tagged Seeded demo were made by our script with Plaid sandbox data to show how the ledger looks over time. They are not real users.';

// Our own live checks of the site (SPEC 8d). Accounts only we can create: sub-accounts of the relayer
// and of the owner, named devcheck… (scripts/lib/devcheck.mjs), plus the 11 accounts of the first
// retest on Nov 4, from before the prefix existed. They are never counted as visitors.
export const DEV_CHECK_PATTERN = /^devcheck[a-z0-9-]*\.(relayer\.)?kency\.testnet$/;
export const DEV_CHECK_NOV4 = new Set([
  'demo1793783652206', 'demo1793783680537', 'demo1793783718793', 'demo1793783748572', 'demo1793784220359',
  'demo1793784249388', 'demo1793787737173', 'demo1793787774658', 'demo1793787808941',
].map((d) => `${d}.relayer.kency.testnet`).concat('kredofi-audit-1793698130.testnet', 'kredofi-xyz-1793691803.testnet'));
export const DEV_CHECK_NOTE = 'Rows tagged Developer check are our own live tests of this site, not visitors: real enclave scores on Plaid sandbox data, and the reserve was topped back up after their defaults.';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (ms: number) => { const d = new Date(ms); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
/** "Developer check (Nov 4)": the UTC day of the row. */
export const devCheckLabel = (ms: number) => `Developer check (${day(ms)})`;
/** Caption of the band table: every day with developer rows, oldest first. */
export const devCheckCaption = (days: number[]) => `Developer check (${[...new Set([...days].sort((a, b) => a - b).map(day))].join(', ') || 'none yet'})`;

export const isDevCheck = (account: unknown): boolean => typeof account === 'string' && (DEV_CHECK_PATTERN.test(account) || DEV_CHECK_NOV4.has(account));
export const isSeeded = (account: unknown): boolean => typeof account === 'string' && SEED_PATTERN.test(account);
/** The account an event is about (borrower or lender), if any. */
export const actorOf = (e: LedgerEvent): string | null => {
  const a = e.data.borrower ?? e.data.lender;
  return typeof a === 'string' ? a : null;
};
export const isSeededEvent = (e: LedgerEvent) => isSeeded(actorOf(e));
export const isDevCheckEvent = (e: LedgerEvent) => isDevCheck(actorOf(e));

export type BandStats = { scored: number; loans_issued: number; repaid: number; defaulted: number; volume: string };
export type Bands = Record<'A' | 'B' | 'C' | 'D', BandStats>;
const empty = (): Bands => ({ A: z(), B: z(), C: z(), D: z() });
function z(): BandStats { return { scored: 0, loans_issued: 0, repaid: 0, defaulted: 0, volume: '0' }; }

/** Per-band numbers for seeded accounts, counted from events the way the contract's get_stats counts:
 *  a repayment or default counts in the band of the loan it closes. */
export const seededStats = (events: LedgerEvent[]): Bands => statsFor(events, isSeeded);
export const devCheckStats = (events: LedgerEvent[]): Bands => statsFor(events, isDevCheck);
/** The UTC days that have developer rows (from every indexed event, not just the 200 sent). */
export const devCheckTimes = (events: LedgerEvent[]): number[] => events.filter(isDevCheckEvent).map((e) => e.ts);

function statsFor(events: LedgerEvent[], matches: (account: unknown) => boolean): Bands {
  const out = empty(), loanBand = new Map<string, keyof Bands>();
  for (const e of [...events].sort((a, b) => a.ts - b.ts || a.idx - b.idx)) {
    const who = actorOf(e);
    if (!matches(who)) continue;
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

/** Visitors = the contract's own totals minus the seeded and developer parts (never below zero while the index lags). */
export function visitorStats(total: Bands, ...parts: Bands[]): Bands {
  const out = empty();
  for (const b of ['A', 'B', 'C', 'D'] as const) {
    const t = total[b] ?? z(), sum = (k: 'scored' | 'loans_issued' | 'repaid' | 'defaulted') => Math.max(0, parts.reduce((n, p) => n - p[b][k], t[k]));
    const vol = parts.reduce((n, p) => n - BigInt(p[b].volume), BigInt(t.volume));
    out[b] = { scored: sum('scored'), loans_issued: sum('loans_issued'), repaid: sum('repaid'), defaulted: sum('defaulted'), volume: (vol > 0n ? vol : 0n).toString() };
  }
  return out;
}
