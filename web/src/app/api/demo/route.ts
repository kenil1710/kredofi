// POST /api/demo {publicKey}: create a throwaway testnet account demo<ms>.<relayer> whose only
// full-access key is the browser's key (SPEC 8a). The relayer funds it with 0.005 NEAR (enough for
// 1-yocto deposits; the relayer pays all gas), registers it with test USDC and gives it $10.
import { NextResponse } from 'next/server';
import { actions, PublicKey } from 'near-api-js';
import { clientIp, fundTestUsdc, overQuota, relayerAccount } from '@/server/near';

export const runtime = 'nodejs';
const DEMO_NEAR = 5_000_000_000_000_000_000_000n; // 0.005 NEAR

export async function POST(req: Request) {
  const { publicKey } = (await req.json().catch(() => ({}))) as { publicKey?: unknown };
  if (typeof publicKey !== 'string' || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(publicKey)) {
    return NextResponse.json({ error: 'Invalid public key.' }, { status: 400 });
  }
  if (overQuota(`demo:${clientIp(req)}`, 5, 3_600_000)) {
    return NextResponse.json({ error: 'Five demo accounts per hour from one network. Reuse the one you have, or try again later.' }, { status: 429 });
  }
  try {
    const relayer = relayerAccount();
    const accountId = `demo${Date.now()}.${relayer.accountId}`;
    const res = await relayer.signAndSendTransaction({
      receiverId: accountId,
      actions: [actions.createAccount(), actions.transfer(DEMO_NEAR), actions.addFullAccessKey(PublicKey.from(publicKey))],
      waitUntil: 'FINAL',
    });
    const txs = [res.transaction_outcome.id, ...(await fundTestUsdc(accountId, 10_000_000n))];
    return NextResponse.json({ accountId, txs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    const low = /NotEnoughBalance|LackBalance/i.test(msg);
    return NextResponse.json({ error: low ? 'The demo relayer is out of test NEAR. Try again later, or connect a wallet.' : 'Could not create the demo account. Try again.' }, { status: 503 });
  }
}
