// POST /api/summary (testnet): a plain-English summary of a score, asked for by the browser after the
// score is shown, so it never delays the score. Input: the band and the five rule results the browser
// decrypted (no bank data). Output: { summary, by } or 204 when there is none. Never stored.
import { NextResponse } from 'next/server';
import { checkParts, parseSummary, summaryRequest, SUMMARY_PLAN } from '@/lib/aiSummary';
import { isTestnetAccount, overQuota } from '@/server/near';

export const dynamic = 'force-dynamic';
const URL_ = 'https://cloud-api.near.ai/v1/chat/completions';

export async function POST(req: Request) {
  const key = process.env.NEARAI_KEY;
  if (!key) return new NextResponse(null, { status: 204 });
  const body = await req.json().catch(() => null) as { accountId?: unknown; band?: unknown; parts?: unknown } | null;
  const ok = checkParts(body?.band, body?.parts);
  if (!ok || !isTestnetAccount(body?.accountId)) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  if (overQuota(`summary:${body!.accountId}`, 10, 3_600_000) || overQuota('summary:all', 300, 3_600_000)) return new NextResponse(null, { status: 204 });
  // Qwen/Qwen3.8-27B first (8 s), then the NEAR AI fallback (15 s): both on NEAR AI Cloud, same input.
  for (const [model, ms] of SUMMARY_PLAN) {
    try {
      const r = await fetch(URL_, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(summaryRequest(ok.band, ok.parts, model)),
        signal: AbortSignal.timeout(ms),
      });
      if (!r.ok) continue;
      const summary = parseSummary(await r.json());
      if (summary) return NextResponse.json({ summary, by: model });
    } catch { /* timeout or network: next model */ }
  }
  return new NextResponse(null, { status: 204 });
}
