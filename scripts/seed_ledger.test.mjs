// node --experimental-strip-types --test scripts/seed_ledger.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, planTotals, chainState } from './seed_ledger.mjs';

test('plan: 29 loans, 27 repaid, defaults only in band B and C, 3 band D scores, days 0-9 (Nov 4-13)', () => {
  const steps = plan(), t = planTotals(steps);
  assert.equal(t.loans, 29);
  assert.equal(t.defaults, 2);
  assert.deepEqual(t.byBand, { A: [12, 0], B: [11, 1], C: [6, 1] });
  assert.equal(t.dScores, 3);
  assert.ok(steps.every((s) => s.day >= 0 && s.day <= 9));
  for (const s of steps.filter((x) => x.second)) assert.ok(steps.find((f) => f.n === s.n && !f.second).day < s.day);
});

test('chainState: never repeats a loan the chain already shows, finishes open ones', () => {
  const first = { kind: 'loan', n: 1 }, second = { kind: 'loan', n: 1, second: true }, dflt = { kind: 'loan', n: 16, defaults: true }, score = { kind: 'score', n: 22 };
  const fresh = { level: 1, defaults: 0, has_active_loan: false, loan: null, score: { band: 'A' } };
  assert.equal(chainState(first, null), 'todo');
  assert.equal(chainState(first, fresh), 'todo');
  assert.equal(chainState(first, { ...fresh, has_active_loan: true, loan: {} }), 'open');
  assert.equal(chainState(first, { ...fresh, level: 2, loan: {} }), 'done');
  assert.equal(chainState(second, { ...fresh, level: 2, loan: {} }), 'todo');
  assert.equal(chainState(second, { ...fresh, level: 2, loan: {}, has_active_loan: true }), 'open');
  assert.equal(chainState(second, { ...fresh, level: 3, loan: {} }), 'done');
  assert.equal(chainState(dflt, { ...fresh, loan: {}, has_active_loan: true }), 'open');
  assert.equal(chainState(dflt, { ...fresh, loan: {}, defaults: 1, blocked: true }), 'done');
  assert.equal(chainState(score, null), 'todo');
  assert.equal(chainState(score, { ...fresh, score: { band: 'D' } }), 'done');
});
