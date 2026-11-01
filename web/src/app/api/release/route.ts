// POST /api/release {borrower}: after a recorded default and a release request, run the scorer's
// release op (re-seal the name to the partner key) and submit dev_submit_release (Dev mode).
import { NextResponse } from 'next/server';
import { KREDOFI_CONTRACT } from '@/lib/config';
import { call, isTestnetAccount, rateLimited, scorerAccount, viewPool } from '@/server/near';
import { checkPinned, loadSubmitted, runScorer } from '@/server/scorer';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { borrower } = (await req.json().catch(() => ({}))) as { borrower?: unknown };
  if (!isTestnetAccount(borrower)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  if (rateLimited(`release:${borrower}`, 20_000)) return NextResponse.json({ error: 'Already working on it.' }, { status: 429 });
  try {
    const b = await viewPool<{ pending_request: boolean } | null>('get_borrower', { account_id: borrower });
    if (!(await viewPool<boolean>('is_release_allowed', { account_id: borrower })) || !b?.pending_request) {
      return NextResponse.json({ error: 'No identity release has been requested for this borrower.' }, { status: 409 });
    }
    await checkPinned();
    const sub = await loadSubmitted(borrower);
    if (!sub) return NextResponse.json({ error: 'This server did not score this borrower, so it cannot release the identity.' }, { status: 409 });
    const { partner_pubkey } = await viewPool<{ partner_pubkey: string }>('get_config');
    const output = await runScorer({ op: 'release', sealed: sub.sealed_identity, partner_pubkey });
    const r = await call(scorerAccount(), KREDOFI_CONTRACT, 'dev_submit_release', { borrower, output });
    if (!r.ok) return NextResponse.json({ error: r.error, hash: r.hash }, { status: 409 });
    return NextResponse.json({ hash: r.hash });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Release failed.' }, { status: 502 });
  }
}
