// POST /api/plaid/sandbox {accountId, borrower: 'riya'|'sam'|'max'|'custom', custom?} (OutLayer mode,
// testnet): a Plaid sandbox public token for a prepared or build-your-own borrower (SPEC 8b), made
// with Plaid's custom sandbox user from the same profile generator the Dev-mode scorer uses. The
// browser seals it to the enclave and signs request_score, so the enclave fetches this made-up bank
// history from Plaid itself. Only fake sandbox data: nothing here is a real person's bank.
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { checkCustom, customProfile, profileFor, type BorrowerKey, type CustomInputs } from '@/lib/borrowers';
import { IN_ENCLAVE } from '@/lib/config';
import { clientIp, isTestnetAccount, overQuota, rateLimited } from '@/server/near';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!IN_ENCLAVE) return NextResponse.json({ error: 'This demo scores on the server (/api/score).' }, { status: 409 });
  const { accountId, borrower, custom } = (await req.json().catch(() => ({}))) as { accountId?: unknown; borrower?: unknown; custom?: unknown };
  if (!isTestnetAccount(accountId)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  if (!['riya', 'sam', 'max', 'custom'].includes(borrower as string)) return NextResponse.json({ error: 'Pick a test borrower.' }, { status: 400 });
  if (borrower === 'custom') { const bad = checkCustom(custom); if (bad) return NextResponse.json({ error: bad }, { status: 400 }); }
  if (overQuota(`sandbox-ip:${clientIp(req)}`, 15, 3_600_000)) return NextResponse.json({ error: 'Fifteen scores per hour from one network. Try again later.' }, { status: 429 });
  if (rateLimited(`sandbox:${accountId}`, 20_000)) return NextResponse.json({ error: 'Wait a few seconds.' }, { status: 429 });
  const tag = createHash('sha256').update(accountId).digest('hex').slice(0, 4);
  const profile = borrower === 'custom' ? customProfile(custom as CustomInputs, tag) : profileFor(borrower as BorrowerKey, tag);
  const r = await fetch('https://sandbox.plaid.com/sandbox/public_token/create', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET,
      institution_id: 'ins_109508', initial_products: ['transactions', 'identity'],
      options: { override_username: 'user_custom', override_password: JSON.stringify(profile), transactions: { days_requested: 730 } },
    }),
  }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok || typeof j.public_token !== 'string') return NextResponse.json({ error: `Plaid: ${j.error_code ?? 'no sandbox token'}` }, { status: 502 });
  return NextResponse.json({ publicToken: j.public_token });
}
