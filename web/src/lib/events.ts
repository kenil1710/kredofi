// KredoFi NEP-297 events from transaction receipts. Pure (unit-tested in events.test.ts).
// Only logs from receipts executed BY the KredoFi contract are trusted: any contract can print a
// line that looks like a kredofi event. Receipts that failed are skipped: their state changes were
// rolled back, but their logs are still in the outcome (audit L4).

export type LedgerEvent = { event: string; data: Record<string, unknown>; txHash: string; ts: number; idx: number };
type Receipt = { executor_id?: string; logs?: string[]; status?: unknown };

/** True for a receipt outcome whose status is a Failure (its effects were rolled back). */
export const receiptFailed = (status: unknown) => !!status && typeof status === 'object' && 'Failure' in status;

export function eventsFromReceipts(receipts: Receipt[], contract: string, txHash: string, ts: number): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const r of receipts) {
    if (r.executor_id !== contract || receiptFailed(r.status)) continue;
    for (const l of r.logs ?? []) {
      if (!l.startsWith('EVENT_JSON:')) continue;
      try {
        const e = JSON.parse(l.slice(11));
        if (e.standard !== 'kredofi' || typeof e.event !== 'string') continue;
        for (const d of Array.isArray(e.data) ? e.data : [e.data]) out.push({ event: e.event, data: d ?? {}, txHash, ts, idx: out.length });
      } catch { /* not JSON */ }
    }
  }
  return out;
}

const usd = (v: unknown) => `$${(Number(v ?? 0) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One plain line per event for the public ledger (DESIGN 4: specific, plain). */
export function describe(e: LedgerEvent): { text: string; value: string; band?: string } {
  const d = e.data as Record<string, string | number>;
  switch (e.event) {
    case 'score_issued': return { text: `Score issued, band ${d.band}`, value: '—', band: String(d.band) };
    case 'score_failed': return { text: 'Scoring failed, nothing changed', value: '—' };
    case 'loan_issued': return { text: `Loan issued, band ${d.band}`, value: usd(d.principal), band: String(d.band) };
    case 'loan_repaid': return { text: `Loan repaid${d.leveled_up ? `, level ${d.level}` : ''}`, value: usd(Number(d.principal) + Number(d.interest)) };
    case 'loan_defaulted': return { text: Number(d.lender_loss) > 0 ? 'Default, lenders took a loss' : 'Default, the reserve paid', value: usd(d.principal) };
    case 'identity_released': return { text: 'Identity released to the recovery partner', value: '—' };
    case 'lender_deposit': return { text: 'Lender deposit', value: usd(d.amount) };
    case 'lender_withdraw': return { text: 'Lender withdrawal', value: usd(d.amount) };
    case 'reserve_seeded': return { text: 'Reserve seeded', value: usd(d.amount) };
    case 'treasury_to_reserve': return { text: 'Treasury moved into the reserve', value: usd(d.amount) };
    case 'treasury_withdrawn': return { text: 'Treasury withdrawn by the owner', value: usd(d.amount) };
    case 'scorer_version_changed': return { text: `Scorer version pinned: ${String(d.new).slice(0, 8)}…`, value: '—' };
    case 'scorer_change_proposed': return { text: `Scorer change proposed: ${String(d.new).slice(0, 8)}… (time lock)`, value: '—' };
    case 'scorer_change_cancelled': return { text: `Scorer change cancelled: ${String(d.version).slice(0, 8)}…`, value: '—' };
    case 'param_changed': return { text: `Parameter changed: ${d.param}`, value: '—' };
    default: return { text: e.event.replace(/_/g, ' '), value: '—' };
  }
}

/** A transaction's receipts are done well within 5 minutes (the OutLayer callback has a 60 s run limit);
 *  until then the ledger reads it again. */
export const SETTLE_MS = 5 * 60_000;
export const settled = (txMs: number, nowMs: number) => nowMs - txMs >= SETTLE_MS;

/** Sum of lender_loss over defaults: "lost by lenders so far". */
export const lostByLenders = (events: LedgerEvent[]) =>
  events.filter((e) => e.event === 'loan_defaulted').reduce((s, e) => s + BigInt(String(e.data.lender_loss ?? 0)), 0n);
