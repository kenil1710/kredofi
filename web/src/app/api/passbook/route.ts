// GET /api/passbook?account=<id>: one borrower's public record for the passbook: their KredoFi events
// (newest last) and the scorer output last submitted for them. That output is public already: it is the
// argument of the dev_submit_score transaction on-chain (its `reply` is sealed to the borrower's key).
// OutLayer mode: the server never sees the output; it is read from the score transaction itself (the
// OutLayer receipt's return value), which is just as public.
import { NextResponse } from 'next/server';
import { allEvents } from '@/server/ledger';
import { loadExtra, loadSubmitted } from '@/server/scorer';
import { isTestnetAccount, rpc } from '@/server/near';
import { IN_ENCLAVE, KREDOFI_CONTRACT, OUTLAYER_CONTRACT } from '@/lib/config';
import { scoreFromReceipts } from '@/lib/outlayer';

const fromChain = new Map<string, Record<string, unknown> | null>();
async function outputFromTx(hash: string, signer: string) {
  if (fromChain.has(hash)) return fromChain.get(hash) ?? null;
  const tx = await rpc<{ receipts_outcome: { outcome: Record<string, unknown> }[] }>('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: signer, wait_until: 'NONE' }).catch(() => null);
  const out = tx ? scoreFromReceipts(tx.receipts_outcome as never, KREDOFI_CONTRACT, OUTLAYER_CONTRACT, signer).output : null;
  if (out) fromChain.set(hash, out);
  return out;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const account = new URL(req.url).searchParams.get('account');
  if (!isTestnetAccount(account)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  const [events, output, extra] = await Promise.all([allEvents().catch(() => []), loadSubmitted(account), loadExtra(account)]);
  const mine = events.filter((e) => e.data.borrower === account).reverse();
  const lastScore = [...mine].reverse().find((e) => e.event === 'score_issued' || e.event === 'score_failed');
  const scoreHash = lastScore?.event === 'score_issued' ? lastScore.txHash : null;
  const out = output ?? (IN_ENCLAVE && scoreHash ? await outputFromTx(scoreHash, account) : null);
  return NextResponse.json({ events: mine, output: out, extra, scoreHash });
}
