// GET /api/ledger: KredoFi events (newest first) plus the contract's own stats and pool.
// One answer is shared for 4 s (any number of viewers cost the same RPC calls); if the RPC or the
// index refuses, the last good answer is served with `stale: true` instead of an error.
import { NextResponse } from 'next/server';
import { allEvents, lastChange } from '@/server/ledger';
import { viewPool } from '@/server/near';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Answer = { events: unknown[]; stats: unknown; pool: unknown; config: unknown; updatedAt: number };
let last: Answer | null = null;
let inflight: Promise<Answer> | null = null;

async function build(): Promise<Answer> {
  const [events, stats, pool, config] = await Promise.all([allEvents(), viewPool('get_stats'), viewPool('get_pool'), viewPool('get_config')]);
  return { events: events.slice(0, 200), stats, pool, config, updatedAt: Date.now() };
}

export async function GET() {
  if (last && Date.now() - last.updatedAt < 4000 && last.updatedAt > lastChange()) return NextResponse.json(last);
  try {
    inflight ??= build().finally(() => { inflight = null; });
    last = await inflight;
    return NextResponse.json(last);
  } catch {
    if (last) return NextResponse.json({ ...last, stale: true });
    return NextResponse.json({ error: 'The chain did not answer. Retrying.' }, { status: 503 });
  }
}
