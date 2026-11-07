// POST /api/fund {accountId, replyPubkey, proof} (OutLayer mode, testnet): the account signs
// request_score itself, and NEAR needs ~0.16 NEAR available up front (0.01 fee + 150 Tgas at the
// pessimistic gas price; ~0.003 is actually spent). An account under 0.17 NEAR is topped up to 0.2 by
// the relayer (docs/ENCLAVE_PLAN.md). Demo accounts send the leftover back after the score; wallets
// keep it. Needs a signed one-time challenge from a full-access key of the account; at most 3 per
// account and 5 per network a day, 60 a day in total, none while the relayer holds under 3 NEAR.
import { NextResponse } from 'next/server';
import { actions } from 'near-api-js';
import { IN_ENCLAVE } from '@/lib/config';
import { clientIp, isTestnetAccount, relayerAccount, relayerBalance, rpc } from '@/server/near';
import { relayerBelowFloor } from '@/server/guards';
import { provesOwnership } from '@/server/ownership';
import { publicError, Quota } from '@/server/guards';

export const runtime = 'nodejs';
const NEED = 170_000_000_000_000_000_000_000n; // 0.17 NEAR
const TARGET = 200_000_000_000_000_000_000_000n; // 0.2 NEAR
const perAccount = new Quota(3, 86_400_000), perIp = new Quota(5, 86_400_000), daily = new Quota(60, 86_400_000);

export async function POST(req: Request) {
  if (!IN_ENCLAVE) return NextResponse.json({ error: 'Not needed: this demo scores on the server.' }, { status: 409 });
  const { accountId, replyPubkey, proof } = (await req.json().catch(() => ({}))) as { accountId?: unknown; replyPubkey?: unknown; proof?: { nonce?: unknown; publicKey?: unknown; signature?: unknown } };
  if (!isTestnetAccount(accountId)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  if (typeof replyPubkey !== 'string' || !/^[0-9a-f]{64}$/.test(replyPubkey)) return NextResponse.json({ error: 'Missing reply key.' }, { status: 400 });
  const owned = await provesOwnership(accountId, replyPubkey, proof);
  if (owned !== true) return NextResponse.json({ error: owned }, { status: 403 });
  const acct = await rpc<{ amount: string; storage_usage: number }>('query', { request_type: 'view_account', finality: 'final', account_id: accountId }).catch(() => null);
  const have = acct ? BigInt(acct.amount) - BigInt(acct.storage_usage) * 10n ** 19n : 0n;
  if (have >= NEED) return NextResponse.json({ ok: true, funded: false });
  const bal = await relayerBalance();
  if (relayerBelowFloor(bal)) return NextResponse.json({ error: 'The demo relayer is low on test NEAR. Get test NEAR from the testnet faucet.' }, { status: 503 });
  if (!perAccount.take(accountId)) return NextResponse.json({ error: 'Three top-ups per account per day. Get test NEAR from the testnet faucet.' }, { status: 429 });
  if (!perIp.take(clientIp(req))) return NextResponse.json({ error: 'Five top-ups per network per day. Get test NEAR from the testnet faucet.' }, { status: 429 });
  if (!daily.take('all')) return NextResponse.json({ error: 'Today\'s top-ups are used up. Get test NEAR from the testnet faucet.' }, { status: 429 });
  try {
    const r = await relayerAccount().signAndSendTransaction({ receiverId: accountId, actions: [actions.transfer(TARGET - have)], waitUntil: 'EXECUTED_OPTIMISTIC' });
    return NextResponse.json({ ok: true, funded: true, hash: r.transaction_outcome?.id });
  } catch (e) {
    console.error('fund failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: publicError(e, 'Could not send test NEAR. Try again.') }, { status: 502 });
  }
}
