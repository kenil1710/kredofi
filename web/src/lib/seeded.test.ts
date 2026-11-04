import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSeeded, isSeededEvent, seededStats, visitorStats, SEEDED_NOTE, isDevCheck, isDevCheckEvent, devCheckStats, devCheckLabel, devCheckCaption, devCheckTimes, DEV_CHECK_NOTE } from './seeded.ts';

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

test('developer checks: the prefix under accounts only we control, plus the 11 retest accounts of Nov 4', () => {
  for (const a of ['devcheck1793790000000.relayer.kency.testnet', 'devcheck-wallet-1.kency.testnet', 'demo1793787808941.relayer.kency.testnet', 'kredofi-audit-1793698130.testnet', 'kredofi-xyz-1793691803.testnet']) assert.equal(isDevCheck(a), true, a);
  // A visitor can't claim the tag: top-level names and other parents don't match, nor do fresh demo accounts.
  for (const a of ['devcheck.testnet', 'devcheck1.evil.testnet', 'devcheck1.relayer.kency.testnet.evil.testnet', 'xdevcheck1.relayer.kency.testnet', 'demo1793790000000.relayer.kency.testnet', 'borrower-01.kredofi-seed.testnet', null]) assert.equal(isDevCheck(a), false, String(a));
  assert.equal(isDevCheckEvent(ev('score_issued', { borrower: 'devcheck1.relayer.kency.testnet', band: 'A' }, 1)), true);
  assert.equal(isSeeded('devcheck1.relayer.kency.testnet'), false);
  assert.match(DEV_CHECK_NOTE, /not visitors/);
});

test('developer rows never count as visitors or seeded, and labels name the UTC day', () => {
  const nov4 = Date.UTC(2026, 10, 4, 23, 59), nov5 = Date.UTC(2026, 10, 5, 0, 1), d = 'devcheck1.relayer.kency.testnet', s = 'borrower-03.kredofi-seed.testnet', v = 'judge.testnet';
  const events = [
    ev('score_issued', { borrower: d, band: 'A' }, nov4), ev('loan_issued', { borrower: d, band: 'A', principal: '100000000' }, nov4 + 1), ev('loan_defaulted', { borrower: d }, nov4 + 2),
    ev('score_issued', { borrower: s, band: 'A' }, nov4 + 3), ev('score_issued', { borrower: v, band: 'A' }, nov4 + 4),
  ];
  const dev = devCheckStats(events), seeded = seededStats(events);
  assert.deepEqual(dev.A, { scored: 1, loans_issued: 1, repaid: 0, defaulted: 1, volume: '100000000' });
  assert.equal(seeded.A.scored, 1);
  const total = { A: { scored: 3, loans_issued: 1, repaid: 0, defaulted: 1, volume: '100000000' }, B: dev.B, C: dev.C, D: dev.D };
  assert.deepEqual(visitorStats(total, seeded, dev).A, { scored: 1, loans_issued: 0, repaid: 0, defaulted: 0, volume: '0' });
  assert.equal(devCheckLabel(nov4), 'Developer check (Nov 4)');
  assert.equal(devCheckCaption(devCheckTimes(events)), 'Developer check (Nov 4)');
  assert.equal(devCheckCaption([nov5, nov4, nov4]), 'Developer check (Nov 4, Nov 5)');
  assert.equal(devCheckCaption([nov4, nov5, Date.UTC(2026, 10, 26)]), 'Developer check (Nov 4 to Nov 26)');
});
