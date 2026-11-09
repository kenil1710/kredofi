// Server signer after another process used the same key: the chain's nonce is ahead of the cached one.
// Must re-read the nonce and succeed, not fail once per missed nonce (bug Nov 9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, FailoverRpcProvider, KeyPair } from 'near-api-js';
import { InvalidNonceError } from 'near-api-js/rpc-errors';
import { SigningProvider } from './signingProvider.ts';

const kp = KeyPair.fromRandom('ed25519');
const HASH = '11111111111111111111111111111111';

/** A fake RPC: the access key's nonce is `chain.nonce`; a transaction with a lower or equal nonce is rejected. */
function fakeRpc(chain: { nonce: bigint; sent: bigint[] }) {
  return {
    async viewAccessKey() { return { nonce: chain.nonce, permission: 'FullAccess', block_hash: HASH, block_height: 1 }; },
    async viewBlock() { return { header: { hash: HASH, height: 1 } }; },
    async sendTransactionUntil(signed: { transaction: { nonce: bigint } }) {
      const n = BigInt(signed.transaction.nonce);
      if (n <= chain.nonce) throw new InvalidNonceError(Number(chain.nonce), Number(n), '', '');
      chain.nonce = n; chain.sent.push(n);
      return { status: { SuccessValue: '' }, transaction: { hash: 'h' }, transaction_outcome: { id: 'h' }, receipts_outcome: [] };
    },
  };
}

async function run(Provider: typeof FailoverRpcProvider) {
  const chain = { nonce: 100n, sent: [] as bigint[] };
  const p = new Provider([fakeRpc(chain), fakeRpc(chain)] as never);
  const a = new Account('relayer.test', p, kp.toString() as `ed25519:${string}`);
  const send = () => a.signAndSendTransaction({ receiverId: 'x.test', actions: [], throwOnFailure: false });
  await send(); // caches nonce 101
  chain.nonce += 5n; // another process signs 5 transactions with the same key
  return { chain, send };
}

test('a stale cached nonce recovers on the next request', async () => {
  const { chain, send } = await run(SigningProvider);
  await send();
  assert.deepEqual(chain.sent, [101n, 107n]);
});

test('plain FailoverRpcProvider hides the nonce error (why SigningProvider exists)', async () => {
  const { send } = await run(FailoverRpcProvider);
  await assert.rejects(send, /Exceeded 2 providers/);
});

test('other errors still come through as the failover error', async () => {
  const bad = { ...fakeRpc({ nonce: 0n, sent: [] }), async sendTransactionUntil() { throw new Error('boom'); } };
  const a = new Account('relayer.test', new SigningProvider([bad, bad] as never), kp.toString() as `ed25519:${string}`);
  await assert.rejects(a.signAndSendTransaction({ receiverId: 'x.test', actions: [] }), /Exceeded 2 providers/);
});
