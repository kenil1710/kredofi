// POST /api/faucet {accountId}: register the account with mock USDC (relayer pays storage, SPEC 7
// rule 11) and top it up to $10 of test USDC, enough for interest (SPEC 8a). Testnet only.
import { NextResponse } from 'next/server';
import { fundTestUsdc, isTestnetAccount, rateLimited, viewUsdc } from '@/server/near';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { accountId } = (await req.json().catch(() => ({}))) as { accountId?: unknown };
  if (!isTestnetAccount(accountId)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  if (rateLimited(`faucet:${accountId}`, 20_000)) return NextResponse.json({ error: 'Test USDC was just sent. Wait 20 seconds.' }, { status: 429 });
  try {
    const txs = await fundTestUsdc(accountId, 10_000_000n);
    return NextResponse.json({ txs, balance: await viewUsdc<string>('ft_balance_of', { account_id: accountId }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Faucet failed.' }, { status: 502 });
  }
}
