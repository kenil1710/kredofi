// GET /api/health: for the uptime pinger. Also reports the testnet reserve, so a monitor can alert
// (keyword "reserveLow":true) before judge testing drains it. Top it up with scripts/reserve_guard.sh.
import { NextResponse } from 'next/server';
import { NETWORK } from '@/lib/config';
import { viewPool } from '@/server/near';

export const dynamic = 'force-dynamic';
const RESERVE_FLOOR = 200_000_000n; // $200, same floor as scripts/reserve_guard.sh
let cached: { at: number; reserve: string | null } = { at: 0, reserve: null };

export async function GET() {
  if (Date.now() - cached.at > 30_000) {
    const pool = await viewPool<{ reserve: string }>('get_pool').catch(() => null);
    cached = { at: Date.now(), reserve: pool?.reserve ?? cached.reserve };
  }
  const reserve = cached.reserve;
  return NextResponse.json({ ok: true, network: NETWORK, time: new Date().toISOString(), reserve, reserveLow: reserve === null ? null : BigInt(reserve) < RESERVE_FLOOR });
}
