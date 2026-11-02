import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSealed, sealTo } from './seal.ts';
import { openWithAny, rememberSecret, replyKeyFromSignature, unlockMessage, UNLOCK_NONCE } from './replyKey.ts';

test('the same wallet signature gives the same reply key (any browser, any device)', () => {
  const sig = new Uint8Array(64).fill(9);
  assert.deepEqual(replyKeyFromSignature(sig), replyKeyFromSignature(Uint8Array.from(sig)));
  assert.notEqual(replyKeyFromSignature(sig).secret, replyKeyFromSignature(new Uint8Array(64).fill(8)).secret);
  assert.equal(UNLOCK_NONCE.length, 32);
  assert.match(unlockMessage('a.testnet'), /account: a\.testnet/);
});

test('a derived key opens what the scorer sealed to it', () => {
  const kp = replyKeyFromSignature(new Uint8Array(64).fill(3));
  assert.equal(openSealed(kp.secret, sealTo(kp.public, '{"parts":{}}')), '{"parts":{}}');
});

test('older reply secrets are kept and tried', () => {
  const a = replyKeyFromSignature(new Uint8Array(64).fill(1)), b = replyKeyFromSignature(new Uint8Array(64).fill(2));
  const list = rememberSecret(rememberSecret(undefined, a.secret), b.secret);
  assert.deepEqual(list, [b.secret, a.secret]);
  assert.equal(openWithAny(list, sealTo(a.public, 'old score'), openSealed), 'old score');
  assert.equal(openWithAny([b.secret], sealTo(a.public, 'x'), openSealed), null);
  assert.equal(rememberSecret(Array.from({ length: 9 }, (_, i) => String(i)), 'n').length, 6);
});
