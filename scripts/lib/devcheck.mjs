// Live retests on kredofi.xyz never use /api/demo: its accounts look like visitors'. They use a
// devcheck… account instead, a sub-account of the relayer only we can create, set up like /api/demo
// does in OutLayer mode. /ledger tags these rows "Developer check" and keeps them out of the visitor
// numbers (web/src/lib/seeded.ts, SPEC 8d). Testnet only.
import { KeyPair, actions, PublicKey } from 'near-api-js';
import { account } from './near.mjs';

const RELAYER = 'relayer.kency.testnet';
const USDC = 'musdc.kency.testnet';
const NEAR_02 = 200_000_000_000_000_000_000_000n; // as /api/demo: 0.2 NEAR to sign request_score
const USDC_STORAGE = 12_500_000_000_000_000_000_000n;

/** Returns what the site stores for a demo account: { accountId, secretKey }. Never print secretKey. */
export async function createDevcheckAccount() {
  const relayer = account(RELAYER);
  const kp = KeyPair.fromRandom('ed25519');
  const accountId = `devcheck${Date.now()}.${RELAYER}`;
  await relayer.signAndSendTransaction({
    receiverId: accountId,
    actions: [actions.createAccount(), actions.transfer(NEAR_02), actions.addFullAccessKey(PublicKey.from(kp.getPublicKey().toString()))],
    waitUntil: 'EXECUTED_OPTIMISTIC', throwOnFailure: true,
  });
  await relayer.signAndSendTransaction({
    receiverId: USDC,
    actions: [
      actions.functionCall('storage_deposit', { account_id: accountId, registration_only: true }, 30n * 10n ** 12n, USDC_STORAGE),
      actions.functionCall('mint', { account_id: accountId, amount: '10000000' }, 20n * 10n ** 12n, 0n),
    ],
    waitUntil: 'EXECUTED_OPTIMISTIC', throwOnFailure: true,
  });
  return { accountId, secretKey: kp.toString() };
}
