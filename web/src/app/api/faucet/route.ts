// POST /api/faucet {accountId, purpose?}: register the account with mock USDC (relayer pays storage,
// SPEC 7 rule 11) and top it up: $10 for borrowers (interest), or $500 once per account for lenders
// ("Get 500 test USDC", SPEC 8a). Testnet only.
import { NextResponse } from 'next/server';
import { fundTestUsdc, isTestnetAccount, rateLimited, viewUsdc } from '@/server/near';

export const runtime = 'nodejs';
const lenderGrants = new Set<string>(); // once per account (in memory; testnet)

export async function POST(req: Request) {
  const { accountId, purpose } = (await req.json().catch(() => ({}))) as { accountId?: unknown; purpose?: unknown };
  if (!isTestnetAccount(accountId)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  if (rateLimited(`faucet:${accountId}`, 20_000)) return NextResponse.json({ error: 'Test USDC was just sent. Wait 20 seconds.' }, { status: 429 });
  try {
    if (purpose === 'lend' && lenderGrants.has(accountId)) return NextResponse.json({ error: 'This account already received its 500 test USDC.' }, { status: 429 });
    const txs = await fundTestUsdc(accountId, purpose === 'lend' ? 500_000_000n : 10_000_000n);
    if (purpose === 'lend') lenderGrants.add(accountId);
    return NextResponse.json({ txs, balance: await viewUsdc<string>('ft_balance_of', { account_id: accountId }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Faucet failed.' }, { status: 502 });
  }
}
