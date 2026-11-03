import test from 'node:test';
import assert from 'node:assert/strict';
import { ChallengeStore, FaucetBudget, pastDue, PublicError, publicError, Quota } from './guards.ts';

test('challenge flood from another requester cannot evict the victim nonce (audit L3)', () => {
  const s = new ChallengeStore();
  s.issue('alice.testnet', 'victim-ip', 'victim-nonce', 0);
  for (let i = 0; i < 40; i++) s.issue('alice.testnet', 'attacker-ip', `a${i}`, 1);
  assert.ok(s.consume('alice.testnet', 'victim-nonce', 2));
  assert.ok(!s.consume('alice.testnet', 'victim-nonce', 3), 'single use');
});

test('challenge: own nonces evict after 5, expire after 5 minutes, bound to the account', () => {
  const s = new ChallengeStore();
  for (let i = 0; i < 6; i++) s.issue('bob.testnet', 'ip', `n${i}`, i);
  assert.ok(!s.consume('bob.testnet', 'n0', 10));
  assert.ok(s.consume('bob.testnet', 'n5', 10));
  assert.ok(!s.consume('carol.testnet', 'n4', 10), 'other account');
  assert.ok(!s.consume('bob.testnet', 'n4', ChallengeStore.TTL + 10), 'expired');
});

test('challenge map is swept', () => {
  const s = new ChallengeStore();
  for (let i = 0; i < 100; i++) s.issue(`a${i}.testnet`, 'ip', 'n', 0);
  s.sweep(ChallengeStore.TTL + 1);
  assert.equal(s.size, 0);
});

test('faucet budget: per IP, lender grants, daily total (audit M2)', () => {
  const f = new FaucetBudget();
  for (let i = 0; i < 10; i++) assert.equal(f.check('1.1.1.1', false, 0), null);
  assert.match(f.check('1.1.1.1', false, 0)!, /Too many/);
  for (let i = 0; i < 3; i++) assert.equal(f.check('2.2.2.2', true, 0), null);
  assert.match(f.check('2.2.2.2', true, 0)!, /lending today/);
  const g = new FaucetBudget();
  let refused = 0;
  for (let i = 0; i < 400; i++) if (g.check(`10.0.${i >> 8}.${i & 255}`, false, 0)) refused++;
  assert.equal(refused, 100, '300 a day in total');
  assert.equal(g.check('9.9.9.9', false, 86_400_001), null, 'next day');
});

test('quota window slides', () => {
  const q = new Quota(2, 1000);
  assert.ok(q.take('k', 0) && q.take('k', 1) && !q.take('k', 2) && q.take('k', 1001));
});

test('pastDue matches the contract check now > due_at + grace (audit M3)', () => {
  const due = (1_000n * 1_000_000n).toString(); // 1000 ms
  const grace = (500n * 1_000_000n).toString();
  assert.ok(!pastDue(due, grace, 1500));
  assert.ok(pastDue(due, grace, 1501));
  assert.ok(!pastDue(undefined, grace, 9e12));
});

test('publicError hides internal errors', () => {
  assert.equal(publicError(new Error('[-32000] Server error: https://rpc... key ed25519:abc'), 'Faucet failed.'), 'Faucet failed.');
  assert.match(publicError(new Error('NotEnoughBalance'), 'x'), /out of test NEAR/);
  assert.equal(publicError(new PublicError('PLAID: ITEM_LOGIN_REQUIRED'), 'x'), 'PLAID: ITEM_LOGIN_REQUIRED');
});
