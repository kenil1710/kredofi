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

import { checkCustom, customProfile } from './borrowers.ts';

test('build-your-own inputs are range-checked (SPEC 8b)', () => {
  assert.equal(checkCustom({ salary: 4000, months: 6, spending: 1800, fees: 0, balance: 6000 }), null);
  assert.match(checkCustom({ salary: 9000, months: 6, spending: 0, fees: 0, balance: 0 })!, /salary/);
  assert.match(checkCustom({ salary: 1000, months: 7, spending: 0, fees: 0, balance: 0 })!, /months/);
  assert.match(checkCustom({ salary: 1000, months: 6, spending: 0, fees: 0, balance: 30001 })!, /balance/);
  assert.match(checkCustom({ salary: 1000.5, months: 6, spending: 0, fees: 0, balance: 0 })!, /whole number/);
  assert.match(checkCustom({ salary: 0, months: 6, spending: 0, fees: 0, balance: 100 })!, /income or some spending/);
  assert.match(checkCustom(null)!, /salary/);
});

test('custom profile shape', () => {
  const now = new Date(Date.UTC(2026, 10, 2));
  const p = customProfile({ salary: 1200, months: 4, spending: 1500, fees: 2, balance: 200 }, 'ab12', now);
  const a = p.override_accounts[0];
  assert.equal(a.identity.names[0], 'Test Borrower ab12');
  const pay = a.transactions.filter((t) => t.amount < 0);
  assert.deepEqual(pay.map((t) => t.date_posted.slice(0, 7)), ['2026-07', '2026-08', '2026-09', '2026-10'], 'salary in the latest 4 months');
  assert.equal(a.transactions.filter((t) => t.description === 'OVERDRAFT FEE').length, 2);
  assert.equal(a.transactions.filter((t) => t.description === 'MONTHLY SPENDING').length, 6);
  assert.ok(a.transactions.every((t) => Math.abs(t.amount) <= 8000));
});

test('profiles keep their own dates: no Plaid rolling, and every month of the scoring window is present', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const window = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const months = (p: { override_accounts: { transactions: { date_posted: string }[] }[] }) => [...new Set(p.override_accounts[0].transactions.map((t) => t.date_posted.slice(0, 7)))];
  const custom = customProfile({ salary: 1750, months: 6, spending: 1330, fees: 3, balance: 700 }, 'ab12', now);
  assert.equal(custom.roll_dates_forward, false);
  assert.deepEqual(months(custom), window);
  for (const who of ['riya', 'sam', 'max'] as const) {
    const p = profileFor(who, 'ab12', now);
    assert.equal(p.roll_dates_forward, false);
    assert.deepEqual(months(p), window);
  }
});
