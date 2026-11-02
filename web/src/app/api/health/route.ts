// GET /api/health: for the uptime pinger (keeps a free host awake). No chain or Plaid calls.
import { NextResponse } from 'next/server';
import { NETWORK } from '@/lib/config';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ ok: true, network: NETWORK, time: new Date().toISOString() });
}
