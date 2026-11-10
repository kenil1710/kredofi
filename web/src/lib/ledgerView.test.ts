import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_PAINT_ROWS, earnedByLenders, ledgerFirstPaint, lendFirstPaint, lenderTotals, lostByLenders, utcMinuteMs, type LedgerData } from './ledgerView.ts';

const ev = (event: string, data: Record<string, unknown> = {}) => ({ event, data, txHash: 'h', idx: 0, ts: 1 });
const base = { stats: {}, pool: { pool_value: '5' }, config: {}, updatedAt: 1793900000000 } as unknown as LedgerData;

test('first paint keeps at most the visible rows and hides developer checks', () => {
  const events = Array.from({ length: 80 }, () => ev('reserve_seeded')) as unknown as LedgerData['events'];
  const out = ledgerFirstPaint({ ...base, events });
  assert.equal(out.events.length, FIRST_PAINT_ROWS);
  const dev = [ev('score_issued', { borrower: 'devcheck-riya.relayer.kency.testnet' }), ev('reserve_seeded')] as unknown as LedgerData['events'];
  assert.deepEqual(ledgerFirstPaint({ ...base, events: dev }).events.map((e) => e.event), ['reserve_seeded']);
});

test('lender losses add up from default events only; first paint carries pool and time', () => {
  const events = [ev('loan_defaulted', { lender_loss: '7' }), ev('loan_defaulted', {}), ev('loan_defaulted', { lender_loss: '3' }), ev('loan_repaid', { lender_loss: '100' })] as unknown as LedgerData['events'];
  assert.equal(lostByLenders(events), 10n);
  assert.deepEqual(lendFirstPaint({ ...base, events }), { pool: base.pool, earned: '0', lost: '10', at: base.updatedAt });
});

test('lender earnings are the to_pool half of repayments only, never the treasury half or principal', () => {
  const events = [
    ev('loan_repaid', { principal: '100000000', interest: '4000000', to_pool: '2000000', to_treasury: '2000000' }),
    ev('loan_repaid', { principal: '75000000', interest: '4500000', to_pool: '2250000', to_treasury: '2250000' }),
    ev('loan_repaid', {}), ev('loan_issued', { to_pool: '999' }), ev('loan_defaulted', { lender_loss: '5' }),
  ] as unknown as LedgerData['events'];
  assert.equal(earnedByLenders(events), 4_250_000n);
  assert.deepEqual(lenderTotals(events), { earned: '4250000', lost: '5' });
});

test('first paint uses the server totals over every event, not the 200 the answer carries', () => {
  const events = [ev('loan_repaid', { to_pool: '1' })] as unknown as LedgerData['events'];
  const out = lendFirstPaint({ ...base, events, lenders: { earned: '68670000', lost: '0' } });
  assert.equal(out.earned, '68670000');
  assert.equal(out.lost, '0');
});

test('as-of time is UTC to the minute', () => assert.equal(utcMinuteMs(Date.UTC(2026, 10, 5, 14, 3, 40)), '5 Nov 2026, 14:03 UTC'));
