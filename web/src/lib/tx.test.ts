import { test } from 'node:test';
import assert from 'node:assert/strict';
import { txReducer, initialTx, isBusy, classifyError, outcomeFailure, outcomeHash, panicMessage } from './tx.ts';

test('happy path: signing -> sent -> confirmed', () => {
  let s = txReducer(initialTx, { type: 'start' });
  assert.equal(s.phase, 'signing');
  assert.ok(isBusy(s));
  s = txReducer(s, { type: 'sent', hash: 'H1' });
  assert.deepEqual(s, { phase: 'sent', hash: 'H1' });
  s = txReducer(s, { type: 'confirmed' });
  assert.deepEqual(s, { phase: 'confirmed', hash: 'H1' });
  assert.ok(!isBusy(s));
});

test('a running transaction ignores a second start (no double submit)', () => {
  const sent = txReducer(txReducer(initialTx, { type: 'start' }), { type: 'sent', hash: 'H' });
  assert.equal(txReducer(sent, { type: 'start' }), sent);
});

test('failure keeps the hash; retry starts fresh', () => {
  let s = txReducer(txReducer(initialTx, { type: 'start' }), { type: 'sent', hash: 'H' });
  s = txReducer(s, { type: 'failed', kind: 'contract', message: 'Band D cannot borrow' });
  assert.equal(s.phase, 'failed');
  assert.equal(s.hash, 'H');
  assert.equal(txReducer(s, { type: 'start' }).phase, 'signing');
});

test('stale sent/confirmed after reset are ignored', () => {
  assert.equal(txReducer(initialTx, { type: 'sent', hash: 'X' }), initialTx);
  assert.equal(txReducer(initialTx, { type: 'confirmed' }), initialTx);
});

test('classifyError', () => {
  assert.equal(classifyError(new Error('User rejected the request')).kind, 'rejected');
  assert.equal(classifyError(new Error('User cancelled')).kind, 'rejected');
  assert.equal(classifyError('Wallet closed').kind, 'rejected');
  assert.equal(classifyError(new Error('User rejected')).message, 'You cancelled the signature. Nothing was sent.');
  assert.equal(classifyError(new Error('{"NotEnoughBalance":{}}')).kind, 'insufficient');
  const c = classifyError(new Error('Smart contract panicked: Amount is above your limit'));
  assert.deepEqual(c, { kind: 'contract', message: 'Amount is above your limit' });
  assert.equal(classifyError(new Error('fetch failed')).kind, 'network');
});

test('outcome helpers', () => {
  const ok = { status: { SuccessValue: '' }, transaction: { hash: 'ABC' } };
  assert.equal(outcomeFailure(ok), null);
  assert.equal(outcomeHash(ok), 'ABC');
  const bad = { status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: Band D cannot borrow' } } } } }, transaction_outcome: { id: 'XYZ' } };
  assert.equal(outcomeFailure(bad), 'Band D cannot borrow');
  assert.equal(outcomeHash(bad), 'XYZ');
  assert.equal(panicMessage('Smart contract panicked: Not enough cash in the pool'), 'Not enough cash in the pool');
});

test('a relayed transaction whose inner call failed is a failure', () => {
  const meta = {
    status: { SuccessValue: '' }, transaction: { hash: 'h' },
    receipts_outcome: [
      { outcome: { status: { SuccessReceiptId: 'r2' } } },
      { outcome: { status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: Above the per-borrower share of the pool' } } } } } } },
    ],
  };
  assert.equal(outcomeFailure(meta), 'Above the per-borrower share of the pool');
  assert.equal(outcomeFailure({ status: { SuccessValue: '' }, receipts_outcome: [{ outcome: { status: { SuccessValue: '' } } }] }), null);
});

test('withTimeout: a stalled step fails with its message instead of spinning forever (audit Nov 7)', async () => {
  const { withTimeout, OFFLINE_NOT_SENT } = await import('./tx.ts');
  await assert.rejects(withTimeout(new Promise(() => {}), 20, OFFLINE_NOT_SENT), { message: OFFLINE_NOT_SENT });
  assert.equal(await withTimeout(Promise.resolve(7), 1000, 'x'), 7);
  assert.equal(classifyError(new Error(OFFLINE_NOT_SENT)).message, OFFLINE_NOT_SENT);
});

test('a wallet that never answers gives up after 60 s with a clear way out (live test Nov 8, Meteor Web)', async () => {
  const { readFileSync } = await import('node:fs');
  const { WALLET_NO_ANSWER, WALLET_TIMEOUT_MS, isWalletNoAnswer, withTimeout } = await import('./tx.ts');
  assert.equal(WALLET_TIMEOUT_MS, 60_000);
  assert.equal(WALLET_NO_ANSWER, 'Your wallet didn’t respond. Allow popups for kredofi.xyz, close other wallet tabs, and try again — or use the no-wallet demo.');
  const e = await withTimeout(new Promise(() => {}), 10, WALLET_NO_ANSWER).catch((x) => x);
  assert.ok(isWalletNoAnswer(e));
  assert.ok(!isWalletNoAnswer(new Error('Wallet closed')));
  // Shown as is, not turned into "You cancelled the signature".
  assert.deepEqual(classifyError(e), { kind: 'network', message: WALLET_NO_ANSWER });
  // Every wallet request goes through the timeout: the ownership message and every transaction.
  const wallet = readFileSync(new URL('./near/wallet.tsx', import.meta.url), 'utf8');
  assert.match(wallet, /walletCall\(wallet\.signAndSendTransaction\(/);
  assert.match(wallet, /walletCall\(wallet\.signMessage\(/);
  assert.equal((wallet.match(/wallet\.sign\w+\(/g) ?? []).length, 2, 'no wallet request without the timeout');
  // The passbook stops on it (no second wallet request) and offers the no-wallet demo.
  const pb = readFileSync(new URL('../components/Passbook.tsx', import.meta.url), 'utf8');
  assert.match(pb, /isWalletNoAnswer\(e\)\) \{ holdToken\(src\); updateSession\(\{ who \}, acctId\); setScoring\(\{ step: 'failed'/);
  assert.equal((pb.match(/onClick=\{continueWithoutWallet\}>Continue without a wallet</g) ?? []).length, 2);
});
