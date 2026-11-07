// POST /api/verify-score {accountId, txHash}: run OutLayer's verifier on this account's own score transaction and
// compare the signed run with its current on-chain score. Costs no gas and sends nothing. 30 checks per hour per network;
// the verdict rules are in lib/verifyScore.ts.
import { NextResponse } from 'next/server';
import { IN_ENCLAVE, NETWORK } from '@/lib/config';
import { interpretRun, type OnchainScore } from '@/lib/verifyScore';
import { clientIp, isTestnetAccount, overQuota, viewPool } from '@/server/near';
import { runVerifier } from '@/server/verifyScore';

export const runtime = 'nodejs';
const TX = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const inFlight = new Set<string>(); // one check at a time per network (audit Nov 7)

export async function POST(req: Request) {
  const { accountId, txHash } = (await req.json().catch(() => ({}))) as { accountId?: unknown; txHash?: unknown };
  if (!isTestnetAccount(accountId) || typeof txHash !== 'string' || !TX.test(txHash)) return NextResponse.json({ error: 'Invalid account or transaction.' }, { status: 400 });
  if (!IN_ENCLAVE) return NextResponse.json({ status: 'unavailable', reason: 'This demo scores outside the enclave, so there is no attestation to check.' });
  const ip = clientIp(req);
  if (overQuota(`verify:${ip}`, 30, 3_600_000)) return NextResponse.json({ error: 'Thirty checks per hour from one network. Try again later, or run the steps yourself.' }, { status: 429 });
  let score: OnchainScore | null | undefined, pinned: string;
  try {
    const [b, cfg] = await Promise.all([
      viewPool<{ score: OnchainScore | null } | null>('get_borrower', { account_id: accountId }),
      viewPool<{ scorer_version: string }>('get_config'),
    ]);
    score = b?.score; pinned = cfg.scorer_version;
  } catch {
    return NextResponse.json({ status: 'unavailable', reason: 'The chain could not be read right now, so nothing was checked. Try again in a minute.' });
  }
  if (!score) return NextResponse.json({ status: 'failed', reason: 'This account has no score on-chain.' });
  if (inFlight.has(ip)) return NextResponse.json({ status: 'unavailable', reason: 'A check from your network is still running. Try again in a few seconds.' });
  inFlight.add(ip);
  try {
    const run = await runVerifier(txHash, NETWORK);
    return NextResponse.json(interpretRun(run, { tx: txHash, account: accountId, network: NETWORK, pinned, score }));
  } finally { inFlight.delete(ip); }
}
