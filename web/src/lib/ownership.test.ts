import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { baseEncode } from 'near-api-js';
import { b64, nep413Hash, scoreMessage, verifyScoreSignature } from './ownership.ts';

const secret = ed25519.utils.randomSecretKey();
const publicKey = `ed25519:${baseEncode(ed25519.getPublicKey(secret))}`;
const nonce = new Uint8Array(32).fill(7);
const recipient = 'kredofi.kency.testnet', accountId = 'demo1.relayer.kency.testnet', replyPubkey = 'ab'.repeat(32);
const sign = (acct = accountId, reply = replyPubkey, n = nonce, sk = secret) => b64(ed25519.sign(nep413Hash(scoreMessage(acct, reply), n, recipient), sk));
const base = { accountId, replyPubkey, recipient, nonce, publicKey };

test('the account key signing this exact request is accepted', () => {
  assert.equal(verifyScoreSignature({ ...base, signature: sign() }), true);
});

test('a signature for another account, reply key or nonce is refused', () => {
  assert.equal(verifyScoreSignature({ ...base, signature: sign('someone.else.testnet') }), false);
  assert.equal(verifyScoreSignature({ ...base, signature: sign(accountId, 'cd'.repeat(32)) }), false);
  assert.equal(verifyScoreSignature({ ...base, signature: sign(accountId, replyPubkey, new Uint8Array(32).fill(8)) }), false);
});

test('a different key, or garbage, is refused', () => {
  const other = ed25519.utils.randomSecretKey();
  assert.equal(verifyScoreSignature({ ...base, signature: sign(accountId, replyPubkey, nonce, other) }), false);
  assert.equal(verifyScoreSignature({ ...base, signature: 'not-a-signature' }), false);
  assert.equal(verifyScoreSignature({ ...base, publicKey: 'ed25519:short', signature: sign() }), false);
});

test('NEP-413 hash: tag, borsh strings, 32-byte nonce, no callback', () => {
  assert.throws(() => nep413Hash('m', new Uint8Array(31), recipient));
  assert.equal(nep413Hash('m', nonce, recipient).length, 32);
  assert.notDeepEqual(nep413Hash('m', nonce, recipient), nep413Hash('m', nonce, 'other.testnet'));
});

test('matches near-api-js NEP-413 signing (what demo accounts and wallets produce)', async () => {
  const { KeyPair, KeyPairSigner } = await import('near-api-js');
  const kp = KeyPair.fromRandom('ed25519');
  const signer = new KeyPairSigner(kp);
  const signed = await signer.signNep413Message(accountId, { message: scoreMessage(accountId, replyPubkey), recipient, nonce });
  const sig = signed.signature instanceof Uint8Array ? b64(signed.signature) : String(signed.signature);
  assert.equal(verifyScoreSignature({ ...base, publicKey: kp.getPublicKey().toString(), signature: sig }), true);
});
