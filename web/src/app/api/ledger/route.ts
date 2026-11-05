// GET /api/ledger: KredoFi events (newest first) plus the contract's own stats and pool
// (server/ledgerAnswer.ts: shared for 4 s, last good answer with `stale: true` if the chain refuses).
import { NextResponse } from 'next/server';
import { ledgerAnswer } from '@/server/ledgerAnswer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await ledgerAnswer());
  } catch {
    return NextResponse.json({ error: 'The chain did not answer. Retrying.' }, { status: 503 });
  }
}
