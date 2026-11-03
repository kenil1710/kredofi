// POST /api/relay {signedDelegate: base64}: relay a demo account's meta transaction (NEP-366) and pay
// its gas, only if checkDelegate allows it (SPEC 8a: KredoFi and test USDC, borrow / ft_transfer_call
// / storage_deposit) and the account is under 20 relays per hour.
import { NextResponse } from 'next/server';
import { publicError } from '@/server/guards';
import { deserialize } from 'borsh';
import { SCHEMA, actions } from 'near-api-js';
import { KREDOFI_CONTRACT, USDC_CONTRACT } from '@/lib/config';
import { checkDelegate, type DecodedDelegate } from '@/lib/relayPolicy';
import { overQuota, relayerAccount } from '@/server/near';
import { recordSoon } from '@/server/ledger';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { signedDelegate } = (await req.json().catch(() => ({}))) as { signedDelegate?: unknown };
  if (typeof signedDelegate !== 'string' || signedDelegate.length > 8000) return NextResponse.json({ error: 'Missing signed delegate.' }, { status: 400 });
  let decoded: { delegateAction: DecodedDelegate; signature: unknown };
  try {
    decoded = deserialize(SCHEMA.SignedDelegate, Buffer.from(signedDelegate, 'base64')) as typeof decoded;
  } catch {
    return NextResponse.json({ error: 'Could not read the signed delegate.' }, { status: 400 });
  }
  const relayer = relayerAccount();
  const refused = checkDelegate(decoded.delegateAction, { relayer: relayer.accountId, kredofi: KREDOFI_CONTRACT, usdc: USDC_CONTRACT });
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });
  if (overQuota(`relay:${decoded.delegateAction.senderId}`, 20, 3_600_000)) {
    return NextResponse.json({ error: 'This demo account reached 20 actions this hour. Try again later.' }, { status: 429 });
  }
  try {
    // Same as relayMetaTransaction, but a contract refusal comes back as an outcome (useTx shows
    // the contract's reason) instead of a thrown error.
    const outcome = await relayer.signAndSendTransaction({
      receiverId: decoded.delegateAction.senderId,
      actions: [actions.signedDelegate(decoded as unknown as Parameters<typeof actions.signedDelegate>[0])],
      throwOnFailure: false,
      waitUntil: 'FINAL',
    });
    recordSoon(outcome.transaction_outcome?.id, relayer.accountId);
    return NextResponse.json(JSON.parse(JSON.stringify(outcome, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))));
  } catch (e) {
    console.error('relay failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: publicError(e, 'The relayer could not send this transaction. Try again.') }, { status: 502 });
  }
}
