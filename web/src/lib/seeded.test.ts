import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSeeded, isSeededEvent, seededStats, visitorStats, SEEDED_NOTE } from './seeded.ts';

const ev = (event: string, data: Record<string, unknown>, ts: number) => ({ event, data, txHash: 'h' + ts, ts, idx: 0 });

test('only the published seed accounts are seeded', () => {
  assert.equal(isSeeded('borrower-01.kredofi-seed.testnet'), true);
  assert.equal(isSeeded('lender.kredofi-seed.testnet'), true);
  assert.equal(isSeeded('borrower-1.kredofi-seed.testnet'), false);
  assert.equal(isSeeded('kredofi-seed.testnet'), false);
  assert.equal(isSeeded('borrower-01.kredofi-seed.testnet.evil.testnet'), false);
  assert.equal(isSeeded('xborrower-01.kredofi-seed.testnet'), false);
  assert.equal(isSeeded('riya.testnet'), false);
  assert.equal(isSeededEvent(ev('lender_deposit', { lender: 'lender.kredofi-seed.testnet', amount: '1' }, 1)), true);
  assert.match(SEEDED_NOTE, /not real users/);
});

test('seeded numbers per band, and visitors = contract totals minus seeded', () => {
  const s = 'borrower-03.kredofi-seed.testnet', v = 'judge.testnet';
  const events = [
    ev('score_issued', { borrower: s, band: 'B' }, 1), ev('loan_issued', { borrower: s, band: 'B', principal: '75000000' }, 2),
    ev('loan_defaulted', { borrower: s, principal: '75000000' }, 3),
    ev('score_issued', { borrower: v, band: 'A' }, 4), ev('loan_issued', { borrower: v, band: 'A', principal: '100000000' }, 5),
    ev('loan_repaid', { borrower: v }, 6),
  ];
  const seeded = seededStats(events);
  assert.deepEqual(seeded.B, { scored: 1, loans_issued: 1, repaid: 0, defaulted: 1, volume: '75000000' });
  assert.deepEqual(seeded.A, { scored: 0, loans_issued: 0, repaid: 0, defaulted: 0, volume: '0' });
  const total = { A: { scored: 1, loans_issued: 1, repaid: 1, defaulted: 0, volume: '100000000' }, B: { scored: 1, loans_issued: 1, repaid: 0, defaulted: 1, volume: '75000000' }, C: { scored: 0, loans_issued: 0, repaid: 0, defaulted: 0, volume: '0' }, D: { scored: 0, loans_issued: 0, repaid: 0, defaulted: 0, volume: '0' } };
  const vis = visitorStats(total, seeded);
  assert.deepEqual(vis.A, total.A);
  assert.deepEqual(vis.B, { scored: 0, loans_issued: 0, repaid: 0, defaulted: 0, volume: '0' });
});
