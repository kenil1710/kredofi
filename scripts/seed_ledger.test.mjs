// node --experimental-strip-types --test scripts/seed_ledger.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, planTotals, chainState, seedProgress } from './seed_ledger.mjs';

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

test('seedProgress: a healthy day boundary stays within 6, missing ticks and an unfinished end go red', () => {
  const steps = plan(), H = 3_600_000, DAY = 24 * H, start = Date.UTC(2026, 10, 4, 8, 56), until = Date.UTC(2026, 10, 13, 23, 59);
  const doneUpTo = (d) => Object.fromEntries(steps.filter((x) => x.day <= d).map((x) => [x.i, 1]));
  // No single day adds more than 6 steps, so being caught up never trips the alarm.
  for (let d = 0; d <= 9; d++) assert.ok(seedProgress(steps, doneUpTo(d - 1), start, start + d * DAY + H, until).behind <= 6, `day ${d}`);
  // Nothing done for two days after day 0: over the limit (6 + 5 + 3).
  assert.equal(seedProgress(steps, {}, start, start + 2 * DAY, until).behind, 14);
  // Finished: nothing behind and not late. Past the end with a step left: late.
  const all = doneUpTo(9);
  assert.deepEqual(['behind', 'late'].map((k) => seedProgress(steps, all, start, until + H, until)[k]), [0, false]);
  const missing = { ...all }; delete missing[31];
  assert.equal(seedProgress(steps, missing, start, until + H, until).late, true);
});

test('catch-up: 6 loans per hourly tick clear the whole plan within the last day, however long the gap', () => {
  const steps = plan(), loans = steps.filter((s) => s.kind === 'loan').length;
  assert.equal(steps.length, 32);
  // Day 9 starts Nov 13 08:56 UTC and seeding ends 23:59: about 15 ticks; the whole plan needs 5.
  assert.ok(Math.ceil(loans / 6) <= 5);
});
