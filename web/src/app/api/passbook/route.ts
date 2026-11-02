// GET /api/passbook?account=<id>: one borrower's public record for the passbook: their KredoFi events
// (newest last) and the scorer output last submitted for them. That output is public already: it is the
// argument of the dev_submit_score transaction on-chain (its `reply` is sealed to the borrower's key).
import { NextResponse } from 'next/server';
import { allEvents } from '@/server/ledger';
import { loadSubmitted } from '@/server/scorer';
import { isTestnetAccount } from '@/server/near';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const account = new URL(req.url).searchParams.get('account');
  if (!isTestnetAccount(account)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  const [events, output] = await Promise.all([allEvents().catch(() => []), loadSubmitted(account)]);
  const mine = events.filter((e) => e.data.borrower === account).reverse();
  const lastScore = [...mine].reverse().find((e) => e.event === 'score_issued' || e.event === 'score_failed');
  return NextResponse.json({ events: mine, output, scoreHash: lastScore?.event === 'score_issued' ? lastScore.txHash : null });
}
