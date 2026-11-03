import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failedReason, scoreFromReceipts, sealToken } from './outlayer.ts';
import { newKeypair, openSealed } from './seal.ts';

const K = 'app.kency.testnet', OL = 'outlayer.testnet', B = 'judge.testnet';
const b64 = (s: string) => Buffer.from(s).toString('base64');
const ev = (event: string, data: object) => `EVENT_JSON:${JSON.stringify({ standard: 'kredofi', version: '1.0.0', event, data: [data] })}`;
const out = { v: 1, caller: B, band: 'A', score: 1000, income_cap: 1000000000, fingerprint: 'ab'.repeat(32), sealed_identity: 'x', reply: 'r' };

test('sealed token opens to account + token (same scheme as the scorer)', () => {
  const kp = newKeypair();
  const s = sealToken(kp.public, B, 'public-sandbox-abc');
  assert.ok(s.startsWith('sealed1:') && s.length <= 256);
  assert.equal(openSealed(kp.secret, s.slice(8)), `${B}\npublic-sandbox-abc`);
});

test('score result read from the OutLayer receipt and the on_score event (shape of tx EYqjio5X)', () => {
  const receipts = [
    { outcome: { executor_id: K, logs: [], status: { SuccessReceiptId: 'x' } } },
    { outcome: { executor_id: OL, logs: ['Resolved project'], status: { SuccessReceiptId: 'y' } } },
    { outcome: { executor_id: OL, logs: ['Execution completed'], status: { SuccessValue: b64(JSON.stringify(out)) } } },
    { outcome: { executor_id: K, logs: [ev('score_issued', { borrower: B, band: 'A' })], status: { SuccessValue: b64('true') } } },
  ];
  const r = scoreFromReceipts(receipts, K, OL, B);
  assert.equal(r.event, 'score_issued');
  assert.deepEqual(r.output, out);
});

test('wrapped output, failed score, other borrower, forged executor', () => {
  const wrapped = [{ outcome: { executor_id: OL, status: { SuccessValue: b64(JSON.stringify({ success: true, output: JSON.stringify(out) })) } } },
    { outcome: { executor_id: K, logs: [ev('score_issued', { borrower: B })], status: { SuccessValue: '' } } }];
  assert.deepEqual(scoreFromReceipts(wrapped, K, OL, B).output, out);
  const failed = [{ outcome: { executor_id: K, logs: [ev('score_failed', { borrower: B, reason: 'this token was sealed for another account' })], status: { SuccessValue: '' } } }];
  const f = scoreFromReceipts(failed, K, OL, B);
  assert.equal(f.event, 'score_failed'); assert.equal(f.output, null);
  assert.match(failedReason(f.reason), /another account/);
  assert.equal(scoreFromReceipts(failed, K, OL, 'other.testnet').event, null);
  const forged = [{ outcome: { executor_id: 'evil.testnet', logs: [ev('score_issued', { borrower: B })], status: { SuccessValue: '' } } }];
  assert.equal(scoreFromReceipts(forged, K, OL, B).event, null);
  const rolledBack = [{ outcome: { executor_id: K, logs: [ev('score_issued', { borrower: B })], status: { Failure: {} } } }];
  assert.equal(scoreFromReceipts(rolledBack as never, K, OL, B).event, null);
});
