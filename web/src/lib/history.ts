// The borrower's loan history for the passbook (every entry stays, DESIGN 3): rebuilt from the
// borrower's public KredoFi events, reconciled with the contract's current loan (the event index can
// lag a little). Pure: unit-tested in history.test.ts.
import type { LedgerEvent } from './events';
import type { LoanView } from './chain';

export type LoanRecord = {
  dueAt: string;               // ns; identifies the loan (loan_issued carries it, LoanView too)
  principal: bigint; interest: bigint; band: string; levelAtBorrow: number | null;
  issuedMs: number; issuedHash?: string;
  state: 'Active' | 'Repaid' | 'Defaulted';
  closedMs?: number; closedHash?: string;
  leveledUp?: boolean; levelAfter?: number; toPool?: bigint; toTreasury?: bigint;
  coveredByReserve?: bigint; lenderLoss?: bigint; // loan_defaulted
  limitAtBorrow: bigint | null;
};

const big = (v: unknown) => BigInt(String(v ?? 0));
const msOfNs = (ns: string) => Number(BigInt(ns) / 1_000_000n);

export function loanHistory(events: LedgerEvent[], borrower: string, current: LoanView | null): LoanRecord[] {
  const mine = events.filter((e) => e.data.borrower === borrower).sort((a, b) => a.ts - b.ts || a.idx - b.idx);
  const loans: LoanRecord[] = [];
  for (const e of mine) {
    const d = e.data;
    if (e.event === 'loan_issued') {
      loans.push({ dueAt: String(d.due_at), principal: big(d.principal), interest: big(d.interest), band: String(d.band), levelAtBorrow: Number(d.level ?? 0) || null, issuedMs: e.ts, issuedHash: e.txHash, state: 'Active', limitAtBorrow: null });
    } else if (e.event === 'loan_repaid' || e.event === 'loan_defaulted') {
      const open = [...loans].reverse().find((l) => l.state === 'Active');
      if (!open) continue;
      open.state = e.event === 'loan_repaid' ? 'Repaid' : 'Defaulted';
      open.closedMs = e.ts; open.closedHash = e.txHash;
      if (e.event === 'loan_repaid') {
        open.leveledUp = Boolean(d.leveled_up); open.levelAfter = Number(d.level);
        open.toPool = big(d.to_pool); open.toTreasury = big(d.to_treasury);
      } else {
        open.coveredByReserve = big(d.covered_by_reserve); open.lenderLoss = big(d.lender_loss);
      }
    }
  }
  if (current) {
    let rec = loans.find((l) => l.dueAt === current.due_at);
    if (!rec) {
      rec = { dueAt: current.due_at, principal: big(current.principal), interest: big(current.interest), band: current.band, levelAtBorrow: null, issuedMs: msOfNs(current.issued_at), state: 'Active', limitAtBorrow: null };
      loans.push(rec);
    }
    rec.limitAtBorrow = big(current.limit_at_borrow);
    rec.issuedMs = msOfNs(current.issued_at); // exact block time from the contract
    if (rec.state === 'Active' && current.state !== 'Active') rec.state = current.state; // index not caught up yet
  }
  return loans;
}
