// POST /api/faucet {accountId}: register the account with mock USDC (relayer pays storage, SPEC 7
// rule 11) and top it up to $10 of test USDC, enough for interest (SPEC 8a). Testnet only.
import { NextResponse } from 'next/server';
import { USDC_CONTRACT } from '@/lib/config';
import { call, isTestnetAccount, rateLimited, relayerAccount, viewUsdc } from '@/server/near';

export const runtime = 'nodejs';
const TOP_UP = 10_000_000n; // $10

export async function POST(req: Request) {
  const { accountId } = (await req.json().catch(() => ({}))) as { accountId?: unknown };
  if (!isTestnetAccount(accountId)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  if (rateLimited(`faucet:${accountId}`, 20_000)) return NextResponse.json({ error: 'Test USDC was just sent. Wait 20 seconds.' }, { status: 429 });
  try {
    const relayer = relayerAccount();
    const txs: string[] = [];
    if ((await viewUsdc('storage_balance_of', { account_id: accountId })) === null) {
      const r = await call(relayer, USDC_CONTRACT, 'storage_deposit', { account_id: accountId, registration_only: true }, 30n, 12_500_000_000_000_000_000_000n);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
      if (r.hash) txs.push(r.hash);
    }
    const bal = BigInt(await viewUsdc<string>('ft_balance_of', { account_id: accountId }));
    if (bal < TOP_UP) {
      const r = await call(relayer, USDC_CONTRACT, 'mint', { account_id: accountId, amount: (TOP_UP - bal).toString() });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
      if (r.hash) txs.push(r.hash);
    }
    return NextResponse.json({ txs, balance: (await viewUsdc<string>('ft_balance_of', { account_id: accountId })) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Faucet failed.' }, { status: 502 });
  }
}
