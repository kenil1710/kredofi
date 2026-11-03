// GET /api/health: for the uptime pinger. Also reports the testnet reserve, so a monitor can alert
// (keyword "reserveLow":true) before judge testing drains it. Top it up with scripts/reserve_guard.sh.
// "storageLow":true when the contract has under 0.2 NEAR free for storage: it pays for every lender and
// borrower record, and a full contract makes on_score fail (audit M1). Top up the contract account.
import { NextResponse } from 'next/server';
import { KREDOFI_CONTRACT, NETWORK } from '@/lib/config';
import { rpc, viewPool } from '@/server/near';

export const dynamic = 'force-dynamic';
const RESERVE_FLOOR = 200_000_000n; // $200, same floor as scripts/reserve_guard.sh
const STORAGE_FLOOR = 200_000_000_000_000_000_000_000n; // 0.2 NEAR (~20 KB)
const BYTE_COST = 10_000_000_000_000_000_000n; // 1e19 yocto per byte
let cached: { at: number; reserve: string | null; storageFree: string | null } = { at: 0, reserve: null, storageFree: null };

export async function GET() {
  if (Date.now() - cached.at > 30_000) {
    const [pool, acct] = await Promise.all([
      viewPool<{ reserve: string }>('get_pool').catch(() => null),
      rpc<{ amount: string; storage_usage: number }>('query', { request_type: 'view_account', finality: 'final', account_id: KREDOFI_CONTRACT }).catch(() => null),
    ]);
    const free = acct ? (BigInt(acct.amount) - BigInt(acct.storage_usage) * BYTE_COST).toString() : cached.storageFree;
    cached = { at: Date.now(), reserve: pool?.reserve ?? cached.reserve, storageFree: free };
  }
  const { reserve, storageFree } = cached;
  return NextResponse.json({
    ok: true, network: NETWORK, time: new Date().toISOString(),
    reserve, reserveLow: reserve === null ? null : BigInt(reserve) < RESERVE_FLOOR,
    storageFree, storageLow: storageFree === null ? null : BigInt(storageFree) < STORAGE_FLOOR,
  });
}
