import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_PAINT_ROWS, ledgerFirstPaint, lendFirstPaint, lostByLenders, utcMinuteMs, type LedgerData } from './ledgerView.ts';

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
  assert.deepEqual(lendFirstPaint({ ...base, events }), { pool: base.pool, lost: '10', at: base.updatedAt });
});

test('as-of time is UTC to the minute', () => assert.equal(utcMinuteMs(Date.UTC(2026, 10, 5, 14, 3, 40)), '5 Nov 2026, 14:03 UTC'));
