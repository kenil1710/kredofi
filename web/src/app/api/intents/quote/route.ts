// POST /api/intents/quote {chain, amount (base units), accountId?}: a real NEAR Intents 1Click quote,
// always a dry run (no deposit address is issued, so no money can move). The server builds the whole
// request; the browser picks only the chain and the amount. 20 quotes per minute per IP.
import { NextResponse } from 'next/server';
import { clientIp, overQuota } from '@/server/near';
import { CHAINS, MAX_QUOTE, MIN_QUOTE, ONECLICK, STAND_IN_RECIPIENT, isChain, mainnetRecipient, parseQuote, quoteRequest } from '@/lib/intents';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { chain, amount, accountId } = (await req.json().catch(() => ({}))) as { chain?: unknown; amount?: unknown; accountId?: unknown };
  if (!isChain(chain)) return NextResponse.json({ error: `Pick one of: ${Object.values(CHAINS).map((c) => c.name).join(', ')}.` }, { status: 400 });
  if (typeof amount !== 'string' || !/^\d{1,12}$/.test(amount) || BigInt(amount) < MIN_QUOTE || BigInt(amount) > MAX_QUOTE) {
    return NextResponse.json({ error: 'Quote between $1 and $10,000.' }, { status: 400 });
  }
  if (overQuota(`quote:${clientIp(req)}`, 20, 60_000)) return NextResponse.json({ error: 'Too many quotes. Wait a minute.' }, { status: 429 });
  const own = mainnetRecipient(typeof accountId === 'string' ? accountId : null);
  const recipient = own ?? STAND_IN_RECIPIENT;
  const asked = quoteRequest(chain, BigInt(amount), recipient, new Date());
  try {
    const r = await fetch(`${ONECLICK}/v0/quote`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(asked),
      signal: AbortSignal.timeout(12_000), cache: 'no-store',
    });
    const parsed = parseQuote(await r.json().catch(() => null), asked);
    return NextResponse.json({ chain, recipient, standIn: !own, ...parsed });
  } catch (e) {
    const msg = e instanceof Error && e.name !== 'TimeoutError' ? e.message : '1Click did not answer in time. Try again.';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
