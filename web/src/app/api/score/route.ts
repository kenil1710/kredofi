// POST /api/score {accountId, borrower, replyPubkey} -> runs the pinned scorer for this account's own
// sandbox identity and submits the output with dev_submit_score (testnet Dev mode, SPEC 2).
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { profileFor, type BorrowerKey } from '@/lib/borrowers';
import { KREDOFI_CONTRACT } from '@/lib/config';
import { call, isTestnetAccount, rateLimited, scorerAccount } from '@/server/near';
import { checkPinned, runScorer, saveSubmitted } from '@/server/scorer';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { accountId, borrower, replyPubkey } = body as { accountId?: unknown; borrower?: unknown; replyPubkey?: unknown };
  if (!isTestnetAccount(accountId)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  if (borrower !== 'riya' && borrower !== 'sam' && borrower !== 'max') return NextResponse.json({ error: 'Pick Riya, Sam or Max.' }, { status: 400 });
  if (typeof replyPubkey !== 'string' || !/^[0-9a-f]{64}$/.test(replyPubkey)) return NextResponse.json({ error: 'Missing reply key.' }, { status: 400 });
  if (rateLimited(`score:${accountId}`, 30_000)) return NextResponse.json({ error: 'A score was just requested for this account. Wait 30 seconds and try again.' }, { status: 429 });

  try {
    const version = await checkPinned();
    const tag = createHash('sha256').update(accountId).digest('hex').slice(0, 4);
    const output = await runScorer({ op: 'score', profile: profileFor(borrower as BorrowerKey, tag), reply_pubkey: replyPubkey }, accountId);
    const r = await call(scorerAccount(), KREDOFI_CONTRACT, 'dev_submit_score', { borrower: accountId, output });
    if (!r.ok) return NextResponse.json({ error: r.error, hash: r.hash }, { status: 409 });
    await saveSubmitted(accountId, output);
    return NextResponse.json({ output, hash: r.hash, scorerVersion: version });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Scoring failed.' }, { status: 502 });
  }
}
