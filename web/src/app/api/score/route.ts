// POST /api/score -> runs the pinned scorer and submits the output with dev_submit_score (testnet
// Dev mode, SPEC 2). Sources:
//   {accountId, borrower: 'riya'|'sam'|'max', replyPubkey}       test borrower, own sandbox identity
//   {accountId, borrower: 'custom', custom: {...5 inputs}, ...}  build your own (SPEC 8b)
//   {accountId, borrower: 'plaid', publicToken, ...}             real Plaid Link sandbox login (SPEC 8c)
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { checkCustom, customProfile, profileFor, type BorrowerKey, type CustomInputs } from '@/lib/borrowers';
import { KREDOFI_CONTRACT } from '@/lib/config';
import { call, clientIp, isTestnetAccount, overQuota, rateLimited, scorerAccount } from '@/server/near';
import { checkPinned, saveExtra, saveSubmitted, startScorer } from '@/server/scorer';
import { recordSoon } from '@/server/ledger';
import { consumeChallenge } from '@/server/challenge';
import { fromB64, verifyScoreSignature } from '@/lib/ownership';
import { rpc } from '@/server/near';

/** The signed challenge is for this account and request, and the key is one of its full-access keys. */
async function provesOwnership(accountId: string, replyPubkey: string, proof: { nonce?: unknown; publicKey?: unknown; signature?: unknown } | undefined): Promise<true | string> {
  const nonce = proof?.nonce, publicKey = proof?.publicKey, signature = proof?.signature;
  if (typeof nonce !== 'string' || typeof publicKey !== 'string' || typeof signature !== 'string') return 'Sign the score request with your account first.';
  let n: Uint8Array;
  try { n = fromB64(nonce); } catch { return 'Invalid challenge.'; }
  if (!verifyScoreSignature({ accountId, replyPubkey, recipient: KREDOFI_CONTRACT, nonce: n, publicKey, signature })) return 'The signature does not match this score request.';
  if (!consumeChallenge(accountId, nonce)) return 'This challenge expired or was already used. Try again.';
  // A demo account created a moment ago may not be visible yet: retry briefly.
  for (let i = 0; i < 4; i++) {
    const key = await rpc<{ permission?: unknown }>('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: accountId, public_key: publicKey }).catch(() => null);
    if (key?.permission === 'FullAccess') return true;
    if (key?.permission) return 'Use a full-access key of this account.';
    await new Promise((r) => setTimeout(r, 1000));
  }
  return 'This key does not belong to the account.';
}

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { accountId, borrower, replyPubkey, custom, publicToken, proof } = body as { accountId?: unknown; borrower?: unknown; replyPubkey?: unknown; custom?: unknown; publicToken?: unknown; proof?: { nonce?: unknown; publicKey?: unknown; signature?: unknown } };
  if (!isTestnetAccount(accountId)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  if (!['riya', 'sam', 'max', 'custom', 'plaid'].includes(borrower as string)) return NextResponse.json({ error: 'Pick a test borrower.' }, { status: 400 });
  if (borrower === 'custom') { const bad = checkCustom(custom); if (bad) return NextResponse.json({ error: bad }, { status: 400 }); }
  if (borrower === 'plaid' && (typeof publicToken !== 'string' || !/^public-sandbox-[0-9a-f-]{36}$/.test(publicToken))) {
    return NextResponse.json({ error: 'Connect the sandbox bank first.' }, { status: 400 });
  }
  if (typeof replyPubkey !== 'string' || !/^[0-9a-f]{64}$/.test(replyPubkey)) return NextResponse.json({ error: 'Missing reply key.' }, { status: 400 });
  // Per network too: each score costs the scorer and the contract a little testnet NEAR.
  if (overQuota(`score-ip:${clientIp(req)}`, 15, 3_600_000)) return NextResponse.json({ error: 'Fifteen scores per hour from one network. Try again later.' }, { status: 429 });
  // Only the account itself may ask for its score (on mainnet the contract checks the signer).
  const owned = await provesOwnership(accountId, replyPubkey, proof);
  if (owned !== true) return NextResponse.json({ error: owned }, { status: 403 });
  if (rateLimited(`score:${accountId}`, 30_000)) return NextResponse.json({ error: 'A score was just requested for this account. Wait 30 seconds and try again.' }, { status: 429 });

  const t0 = Date.now(), lap: Record<string, number> = {};
  const mark = (k: string) => { lap[k] = Date.now() - t0; };
  try {
    const version = await checkPinned(); mark('pinned');
    const tag = createHash('sha256').update(accountId).digest('hex').slice(0, 4);
    const input = borrower === 'plaid'
      ? { op: 'score', public_token: publicToken, reply_pubkey: replyPubkey }
      : { op: 'score', profile: borrower === 'custom' ? customProfile(custom as CustomInputs, tag) : profileFor(borrower as BorrowerKey, tag), reply_pubkey: replyPubkey };
    // `extra` (demo build: fetch receipt + AI summary, sealed to the borrower) never goes on-chain.
    // Demo builds print the on-chain output as soon as the score exists, then remove the bank
    // connection and ask for the AI summary; the submit runs in parallel with that tail.
    let latestExtra: string | undefined, submitted = false;
    // Save each sealed extra the moment it exists (receipt first, then receipt + AI summary).
    const run = startScorer(input, accountId, (x) => { latestExtra = x; if (submitted) saveExtra(accountId, x).catch(() => {}); });
    const { extra: _early, ...output } = await run.first; mark('scored');
    const scorer = scorerAccount();
    const tail = run.done.then((x) => { mark('tail'); return x; }).catch((e) => { console.error(`scorer tail failed after the score: ${e instanceof Error ? e.message : e}`); return null; });
    const r = await call(scorer, KREDOFI_CONTRACT, 'dev_submit_score', { borrower: accountId, output }, 30n, 0n, true); mark('submit');
    // Never hold the score back for the tail (bank-connection removal, AI summary): wait at most
    // 6 s more, then answer; a late `extra` is saved when it arrives and the passbook picks it up.
    const fin = await Promise.race([tail, new Promise<'late'>((res) => setTimeout(() => res('late'), 6000))]);
    const late = fin === 'late';
    if (late) tail.then(() => console.log(`score tail ${borrower}: done at ${Date.now() - t0}ms, extra ${latestExtra ? 'yes' : 'no'}`));
    if (r.ok) submitted = true;
    const extra = late ? latestExtra : fin?.extra ?? latestExtra;
    // Server log only: where the time goes (no data).
    console.log(`score timing ${borrower}: ${Object.entries(lap).map(([k, v]) => `${k}=${v}ms`).join(' ')}`);
    recordSoon(r.hash, scorer.accountId);
    if (!r.ok) {
      const error = /already used by another borrower/.test(r.error ?? '')
        ? 'This sandbox bank identity already backs another KredoFi account: one bank identity, one borrower. Pick a test borrower or build your own.'
        : r.error;
      return NextResponse.json({ error, hash: r.hash }, { status: 409 });
    }
    await saveSubmitted(accountId, output);
    if (typeof extra === 'string') await saveExtra(accountId, extra);
    else if (r.ok && latestExtra) await saveExtra(accountId, latestExtra);
    return NextResponse.json({ output, extra: typeof extra === 'string' ? extra : null, extraPending: late, hash: r.hash, scorerVersion: version });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Scoring failed.' }, { status: 502 });
  }
}
