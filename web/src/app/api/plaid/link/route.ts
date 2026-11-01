// POST /api/plaid/link {accountId}: a Plaid Link token for the sandbox (SPEC 8c), products
// transactions + identity, 730 days of history. Plaid keys stay on the server.
import { NextResponse } from 'next/server';
import { isTestnetAccount, rateLimited } from '@/server/near';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { accountId } = (await req.json().catch(() => ({}))) as { accountId?: unknown };
  if (!isTestnetAccount(accountId)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  if (rateLimited(`link:${accountId}`, 5_000)) return NextResponse.json({ error: 'Wait a few seconds.' }, { status: 429 });
  const r = await fetch('https://sandbox.plaid.com/link/token/create', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET,
      client_name: 'KredoFi (testnet demo)', user: { client_user_id: accountId },
      products: ['transactions', 'identity'], country_codes: ['US'], language: 'en',
      transactions: { days_requested: 730 },
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.link_token) return NextResponse.json({ error: `Plaid: ${j.error_code ?? 'no link token'}` }, { status: 502 });
  return NextResponse.json({ linkToken: j.link_token });
}
