// POST /api/score/challenge {accountId}: a one-time nonce the account signs (NEP-413) to prove it is
// asking for its own score (lib/ownership.ts). Valid 5 minutes, single use.
import { NextResponse } from 'next/server';
import { clientIp, isTestnetAccount, overQuota } from '@/server/near';
import { issueChallenge } from '@/server/challenge';
import { KREDOFI_CONTRACT } from '@/lib/config';
import { b64 } from '@/lib/ownership';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { accountId } = (await req.json().catch(() => ({}))) as { accountId?: unknown };
  if (!isTestnetAccount(accountId)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  const ip = clientIp(req);
  if (overQuota(`challenge:${ip}`, 60, 3_600_000)) return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  return NextResponse.json({ nonce: b64(issueChallenge(accountId, ip)), recipient: KREDOFI_CONTRACT });
}
