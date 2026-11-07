// POST /api/ledger/report {hash, signer}: a wallet-signed transaction just confirmed; read it from the
// RPC and add its KredoFi events now. Nothing is taken from the browser except the hash and signer.
import { NextResponse } from 'next/server';
import { clientIp, isTestnetAccount, overQuota, rateLimited } from '@/server/near';
import { record } from '@/server/ledger';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { hash, signer } = (await req.json().catch(() => ({}))) as { hash?: unknown; signer?: unknown };
  if (typeof hash !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash) || !isTestnetAccount(signer)) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  if (rateLimited(`report:${hash}`, 10_000)) return NextResponse.json({ ok: true });
  // Each report costs up to 4 RPC reads (audit Nov 7): 60 per network per hour.
  if (overQuota(`report-ip:${clientIp(req)}`, 60, 3_600_000)) return NextResponse.json({ error: 'Too many reports. The ledger catches up on its own.' }, { status: 429 });
  const events = await record(hash, signer).catch(() => []);
  // An OutLayer score is reported as soon as it is included, but its callback lands 8-20 s later
  // (the RPC wait can time out first): try again until its events are in.
  if (!events.length) for (const ms of [12_000, 30_000, 70_000]) setTimeout(() => { record(hash, signer).catch(() => {}); }, ms);
  return NextResponse.json({ events: events.length });
}
