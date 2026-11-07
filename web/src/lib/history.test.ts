import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loanHistory } from './history.ts';
import type { LedgerEvent } from './events.ts';
import type { LoanView } from './chain.ts';

const ev = (event: string, ts: number, data: Record<string, unknown>, borrower = 'riya.t'): LedgerEvent => ({ event, ts, idx: 0, txHash: `h${ts}`, data: { borrower, ...data } });
const issued = (ts: number, due: string) => ev('loan_issued', ts, { principal: '100000000', interest: '4000000', band: 'A', level: 1, due_at: due });

test('every loan stays: issued then repaid, then the next loan', () => {
  const events = [
    issued(1000, '9000000000'), ev('loan_repaid', 2000, { principal: '100000000', interest: '4000000', to_pool: '2000000', to_treasury: '2000000', level: 1, leveled_up: false }),
    issued(3000, '9900000000'), ev('loan_issued', 3500, { due_at: '1' }, 'someone.else'),
  ];
  const cur: LoanView = { principal: '100000000', interest: '4000000', limit_at_borrow: '100000000', band: 'A', issued_at: '3000000000', due_at: '9900000000', state: 'Active' };
  const h = loanHistory(events, 'riya.t', cur);
  assert.equal(h.length, 2);
  assert.equal(h[0].state, 'Repaid'); assert.equal(h[0].leveledUp, false); assert.equal(h[0].closedHash, 'h2000');
  assert.equal(h[1].state, 'Active'); assert.equal(h[1].limitAtBorrow, 100_000_000n);
});

test('the contract fills in what the index has not seen yet', () => {
  const repaidNow: LoanView = { principal: '100000000', interest: '4000000', limit_at_borrow: '100000000', band: 'A', issued_at: '5000000000', due_at: '7', state: 'Repaid' };
  const h = loanHistory([], 'riya.t', repaidNow);
  assert.equal(h.length, 1); assert.equal(h[0].state, 'Repaid'); assert.equal(h[0].issuedMs, 5000);
  const h2 = loanHistory([issued(5000, '7')], 'riya.t', repaidNow);
  assert.equal(h2.length, 1); assert.equal(h2[0].state, 'Repaid');
});

test('a default closes the open loan', () => {
  const h = loanHistory([issued(1, '5'), ev('loan_defaulted', 9, { principal: '100000000', lender_loss: '0' })], 'riya.t', null);
  assert.equal(h[0].state, 'Defaulted');
});

test('a defaulted loan keeps what the reserve covered and what lenders lost (audit Nov 7)', () => {
  const ev = (event: string, data: Record<string, unknown>, ts: number) => ({ event, data: { borrower: 'max.testnet', ...data }, txHash: `h${ts}`, ts, idx: 0 }) as unknown as LedgerEvent;
  const h = loanHistory([
    ev('loan_issued', { due_at: '5', principal: '100000000', interest: '4000000', band: 'A', level: 1 }, 1),
    ev('loan_defaulted', { principal: '100000000', covered_by_reserve: '100000000', lender_loss: '0' }, 2),
  ], 'max.testnet', null);
  assert.equal(h[0].state, 'Defaulted');
  assert.equal(h[0].coveredByReserve, 100_000_000n);
  assert.equal(h[0].lenderLoss, 0n);
});
