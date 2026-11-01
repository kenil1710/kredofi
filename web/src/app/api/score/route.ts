// POST /api/score -> runs the pinned scorer and submits the output with dev_submit_score (testnet
// Dev mode, SPEC 2). Sources:
//   {accountId, borrower: 'riya'|'sam'|'max', replyPubkey}       test borrower, own sandbox identity
//   {accountId, borrower: 'custom', custom: {...5 inputs}, ...}  build your own (SPEC 8b)
//   {accountId, borrower: 'plaid', publicToken, ...}             real Plaid Link sandbox login (SPEC 8c)
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { checkCustom, customProfile, profileFor, type BorrowerKey, type CustomInputs } from '@/lib/borrowers';
import { KREDOFI_CONTRACT } from '@/lib/config';
import { call, isTestnetAccount, rateLimited, scorerAccount } from '@/server/near';
import { checkPinned, runScorer, saveSubmitted } from '@/server/scorer';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { accountId, borrower, replyPubkey, custom, publicToken } = body as { accountId?: unknown; borrower?: unknown; replyPubkey?: unknown; custom?: unknown; publicToken?: unknown };
  if (!isTestnetAccount(accountId)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  if (!['riya', 'sam', 'max', 'custom', 'plaid'].includes(borrower as string)) return NextResponse.json({ error: 'Pick a test borrower.' }, { status: 400 });
  if (borrower === 'custom') { const bad = checkCustom(custom); if (bad) return NextResponse.json({ error: bad }, { status: 400 }); }
  if (borrower === 'plaid' && (typeof publicToken !== 'string' || !/^public-sandbox-[0-9a-f-]{36}$/.test(publicToken))) {
    return NextResponse.json({ error: 'Connect the sandbox bank first.' }, { status: 400 });
  }
  if (typeof replyPubkey !== 'string' || !/^[0-9a-f]{64}$/.test(replyPubkey)) return NextResponse.json({ error: 'Missing reply key.' }, { status: 400 });
  if (rateLimited(`score:${accountId}`, 30_000)) return NextResponse.json({ error: 'A score was just requested for this account. Wait 30 seconds and try again.' }, { status: 429 });

  try {
    const version = await checkPinned();
    const tag = createHash('sha256').update(accountId).digest('hex').slice(0, 4);
    const input = borrower === 'plaid'
      ? { op: 'score', public_token: publicToken, reply_pubkey: replyPubkey }
      : { op: 'score', profile: borrower === 'custom' ? customProfile(custom as CustomInputs, tag) : profileFor(borrower as BorrowerKey, tag), reply_pubkey: replyPubkey };
    const output = await runScorer(input, accountId);
    const r = await call(scorerAccount(), KREDOFI_CONTRACT, 'dev_submit_score', { borrower: accountId, output });
    if (!r.ok) {
      const error = /already used by another borrower/.test(r.error ?? '')
        ? 'This sandbox bank identity already backs another KredoFi account: one bank identity, one borrower. Pick a test borrower or build your own.'
        : r.error;
      return NextResponse.json({ error, hash: r.hash }, { status: 409 });
    }
    await saveSubmitted(accountId, output);
    return NextResponse.json({ output, hash: r.hash, scorerVersion: version });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Scoring failed.' }, { status: 502 });
  }
}
