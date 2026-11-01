// POST /api/ledger/report {hash, signer}: a wallet-signed transaction just confirmed; read it from the
// RPC and add its KredoFi events now. Nothing is taken from the browser except the hash and signer.
import { NextResponse } from 'next/server';
import { isTestnetAccount, rateLimited } from '@/server/near';
import { record } from '@/server/ledger';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { hash, signer } = (await req.json().catch(() => ({}))) as { hash?: unknown; signer?: unknown };
  if (typeof hash !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash) || !isTestnetAccount(signer)) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  if (rateLimited(`report:${hash}`, 10_000)) return NextResponse.json({ ok: true });
  const events = await record(hash, signer).catch(() => []);
  return NextResponse.json({ events: events.length });
}
