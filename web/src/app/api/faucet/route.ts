// POST /api/faucet {accountId, purpose?}: register the account with mock USDC (relayer pays storage,
// SPEC 7 rule 11) and top it up: $10 for borrowers (interest), or $500 once per account for lenders
// ("Get 500 test USDC", SPEC 8a). Testnet only. Budget (audit M2): the account must exist on chain,
// 10 calls per IP per hour, 10 lender grants per IP per hour, 300 calls / 60 grants a day in total.
import { NextResponse } from 'next/server';
import { accountExists, clientIp, fundTestUsdc, isTestnetAccount, rateLimited, viewUsdc } from '@/server/near';
import { FaucetBudget, publicError } from '@/server/guards';

export const runtime = 'nodejs';
const lenderGrants = new Set<string>(); // once per account (in memory; testnet)
const budget = new FaucetBudget();

export async function POST(req: Request) {
  const { accountId, purpose } = (await req.json().catch(() => ({}))) as { accountId?: unknown; purpose?: unknown };
  if (!isTestnetAccount(accountId)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  if (rateLimited(`faucet:${accountId}`, 20_000)) return NextResponse.json({ error: 'Test USDC was just sent. Wait 20 seconds.' }, { status: 429 });
  try {
    if (purpose === 'lend' && lenderGrants.has(accountId)) return NextResponse.json({ error: 'This account already received its 500 test USDC.' }, { status: 429 });
    if (!(await accountExists(accountId))) return NextResponse.json({ error: 'This testnet account does not exist yet.' }, { status: 400 });
    const refused = budget.check(clientIp(req), purpose === 'lend');
    if (refused) return NextResponse.json({ error: refused }, { status: 429 });
    const txs = await fundTestUsdc(accountId, purpose === 'lend' ? 500_000_000n : 10_000_000n);
    if (purpose === 'lend') lenderGrants.add(accountId);
    return NextResponse.json({ txs, balance: await viewUsdc<string>('ft_balance_of', { account_id: accountId }) });
  } catch (e) {
    console.error('faucet failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: publicError(e, 'Could not send test USDC. Try again.') }, { status: 502 });
  }
}
