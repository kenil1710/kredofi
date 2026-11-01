import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, eventsFromReceipts, lostByLenders } from './events.ts';

const K = 'kredofi.kency.testnet';
const ev = (event: string, data: object) => `EVENT_JSON:${JSON.stringify({ standard: 'kredofi', version: '1.0.0', event, data: [data] })}`;

test('only receipts executed by the KredoFi contract count', () => {
  const r = [
    { executor_id: K, logs: [ev('lender_deposit', { lender: 'a.testnet', amount: '500000000', shares: '500000000' }), 'plain log'] },
    { executor_id: 'evil.testnet', logs: [ev('lender_deposit', { lender: 'x', amount: '999000000' })] },
    { executor_id: 'musdc.kency.testnet', logs: ['EVENT_JSON:{"standard":"nep141","event":"ft_transfer","data":[]}'] },
    { executor_id: K, logs: ['EVENT_JSON:{not json'] },
  ];
  const out = eventsFromReceipts(r, K, 'H', 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].event, 'lender_deposit');
  assert.equal(describe(out[0]).value, '$500.00');
});

test('descriptions and lost-by-lenders', () => {
  const mk = (event: string, data: object) => eventsFromReceipts([{ executor_id: K, logs: [ev(event, data)] }], K, 'H', 1)[0];
  assert.equal(describe(mk('loan_repaid', { principal: '100000000', interest: '4000000', leveled_up: true, level: 2 })).text, 'Loan repaid, level 2');
  assert.equal(describe(mk('loan_repaid', { principal: '100000000', interest: '4000000', leveled_up: true, level: 2 })).value, '$104.00');
  assert.equal(describe(mk('loan_defaulted', { principal: '100000000', lender_loss: '0' })).text, 'Default, the reserve paid');
  assert.equal(describe(mk('score_issued', { band: 'D' })).band, 'D');
  assert.equal(lostByLenders([mk('loan_defaulted', { lender_loss: '70000000' }), mk('loan_defaulted', { lender_loss: '0' })]), 70_000_000n);
});
