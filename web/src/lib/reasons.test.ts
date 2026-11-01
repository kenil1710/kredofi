import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reason, whatWouldChange } from './reasons.ts';
import { profileFor, monthsBack } from './borrowers.ts';

test('reasons for the SPEC 6 demo table', () => {
  // Riya 250/250/250/150/100
  assert.equal(reason('income', 250), '$3,000 or more a month on average');
  assert.equal(reason('stability', 250), 'Paid every month, in steady amounts');
  assert.equal(reason('payment', 250), 'No overdraft or returned-payment fees');
  assert.equal(reason('cash_flow', 150), 'Keeps 30% or more of income');
  assert.equal(reason('buffer', 100), 'Savings cover 3 months or more');
  // Sam 100/100/10/0/60
  assert.equal(reason('income', 100), '$1,000 to $2,000 a month on average');
  assert.equal(reason('stability', 100), 'Income missing in some months, or uneven amounts');
  assert.equal(reason('payment', 10), '4 overdraft or returned-payment fees');
  assert.equal(reason('cash_flow', 0), 'Spends more than earned');
  assert.equal(reason('buffer', 60), 'Savings cover 1 to 3 months');
  assert.equal(reason('payment', 190), '1 overdraft or returned-payment fee');
});

test('what would change Sam', () => {
  const c = whatWouldChange({ income: 100, stability: 100, payment: 10, cash_flow: 0, buffer: 60 });
  assert.deepEqual(c, ['Income in all of the last 6 months, in similar amounts', 'No overdraft or returned-payment fees for six months', 'Spending well below income (keep 30% or more)']);
  assert.deepEqual(whatWouldChange({ income: 250, stability: 250, payment: 250, cash_flow: 150, buffer: 100 }), []);
});

test('profiles match gen_borrowers.py and carry a per-account identity', () => {
  const now = new Date(Date.UTC(2026, 10, 2));
  assert.deepEqual(monthsBack(now).map((d) => d.toISOString().slice(0, 7)), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  const r = profileFor('riya', '3f9a', now);
  const a = r.override_accounts[0];
  assert.equal(a.identity.names[0], 'Riya Good 3f9a');
  assert.equal(a.transactions.length, 30);
  assert.equal(a.starting_balance, 6000);
  assert.deepEqual(a.transactions[0], { date_transacted: '2026-05-01', date_posted: '2026-05-01', currency: 'USD', amount: -4000, description: 'ACME CORP PAYROLL' });
  assert.equal(profileFor('sam', 'x', now).override_accounts[0].transactions.length, 20);
  assert.equal(profileFor('max', 'x', now).override_accounts[0].transactions.length, 24);
  // Same counts as scripts/gen_borrowers.py (30 / 20 / 24).
});
