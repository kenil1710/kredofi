import 'server-only';
// The shared ledger answer: events (newest first) plus the contract's own stats and pool. One answer is
// shared for 4 s (any number of viewers cost the same RPC calls); if the RPC or the index refuses, the
// last good answer is served with `stale: true` instead of an error. Used by /api/ledger and by the
// cached first HTML of /ledger and /lend.
import { allEvents, lastChange } from './ledger';
import { viewPool } from './near';
import { devCheckStats, devCheckTimes, seededStats, visitorStats } from '@/lib/seeded';
import { lenderTotals, type LedgerData } from '@/lib/ledgerView';

type Answer = LedgerData & { stale?: boolean };
let last: Answer | null = null;
let inflight: Promise<Answer> | null = null;

async function build(): Promise<Answer> {
  const [events, stats, pool, config] = await Promise.all([allEvents(), viewPool('get_stats'), viewPool('get_pool'), viewPool('get_config')]);
  // Seeded demo numbers and lender totals come from every indexed event (not just the 200 sent); SPEC 8d.
  return { events: events.slice(0, 200), stats, seeded: seededStats(events), visitors: visitorStats(events), devCheck: devCheckStats(events), devCheckTimes: devCheckTimes(events), lenders: lenderTotals(events), pool, config, updatedAt: Date.now() } as Answer;
}

/** Throws only if the chain refuses and nothing was ever read. */
export async function ledgerAnswer(): Promise<Answer> {
  if (last && Date.now() - last.updatedAt < 4000 && last.updatedAt > lastChange()) return last;
  try {
    inflight ??= build().finally(() => { inflight = null; });
    last = await inflight;
    return last;
  } catch (e) {
    if (last) return { ...last, stale: true };
    throw e;
  }
}

/** For a cached page render: the answer within `ms`, else the last good one, else null. Never throws. */
export async function ledgerSnapshot(ms = 25000): Promise<Answer | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((ok) => { timer = setTimeout(() => ok(null), ms); });
  try {
    return (await Promise.race([ledgerAnswer(), late])) ?? last;
  } catch {
    return last;
  } finally {
    clearTimeout(timer);
  }
}
