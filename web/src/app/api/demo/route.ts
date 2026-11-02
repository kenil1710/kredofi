// POST /api/demo {publicKey}: create a throwaway testnet account demo<ms>.<relayer> whose only
// full-access key is the browser's key (SPEC 8a). The relayer funds it with 0.005 NEAR (enough for
// 1-yocto deposits; the relayer pays all gas), registers it with test USDC and gives it $10.
import { NextResponse } from 'next/server';
import { actions, PublicKey } from 'near-api-js';
import { clientIp, overQuota, relayerAccount } from '@/server/near';
import { USDC_CONTRACT } from '@/lib/config';

export const runtime = 'nodejs';
const DEMO_NEAR = 5_000_000_000_000_000_000_000n; // 0.005 NEAR
const USDC_STORAGE = 12_500_000_000_000_000_000_000n; // NEP-145 registration, as in fundTestUsdc

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
      waitUntil: 'EXECUTED_OPTIMISTIC',
    });
    // A brand-new account is never registered: register it with test USDC and give it $10 in one
    // transaction (was: two transactions, each waiting for finality; ~16 s -> ~5 s in total).
    const usdc = await relayer.signAndSendTransaction({
      receiverId: USDC_CONTRACT,
      actions: [
        actions.functionCall('storage_deposit', { account_id: accountId, registration_only: true }, 30n * 10n ** 12n, USDC_STORAGE),
        actions.functionCall('mint', { account_id: accountId, amount: '10000000' }, 20n * 10n ** 12n, 0n),
      ],
      waitUntil: 'EXECUTED_OPTIMISTIC', throwOnFailure: true,
    });
    const txs = [res.transaction_outcome.id, usdc.transaction_outcome.id];
    return NextResponse.json({ accountId, txs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    const low = /NotEnoughBalance|LackBalance/i.test(msg);
    return NextResponse.json({ error: low ? 'The demo relayer is out of test NEAR. Try again later, or connect a wallet.' : 'Could not create the demo account. Try again.' }, { status: 503 });
  }
}
