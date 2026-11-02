import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelPlan, limitAt, mmss, noLevelUpReason } from './levels.ts';

const $ = (d: number) => BigInt(d) * 1_000_000n;
const base = { level: 1, band: 'A', incomeCap: $(1000), principal: $(100), limitAtBorrow: $(100), issuedMs: 0, minHoldMs: 60_000, lastLevelUpMs: 0, termMs: 120_000, nowMs: 18_000 };

test('limits match the contract formula', () => {
  assert.equal(limitAt(1, 'A', $(1000)), $(100));
  assert.equal(limitAt(2, 'A', $(1000)), $(250));
  assert.equal(limitAt(2, 'B', $(1000)), $(187.5 * 2) / 2n);
  assert.equal(limitAt(3, 'C', $(200)), $(200));
  assert.equal(limitAt(1, 'D', $(1000)), 0n);
});

test('repay too early: countdown to the end of the minimum hold', () => {
  const p = levelPlan(base);
  assert.deepEqual(p, { kind: 'wait', atMs: 60_000, next: $(250), why: 'hold' });
  assert.equal(mmss(60_000 - 18_000), '0:42');
});

test('after the hold, repaying now levels up', () => {
  assert.deepEqual(levelPlan({ ...base, nowMs: 61_000 }), { kind: 'ready', next: $(250) });
});

test('a level-up less than a term ago pushes the wait further', () => {
  const p = levelPlan({ ...base, level: 2, limitAtBorrow: $(250), principal: $(250), issuedMs: 100_000, lastLevelUpMs: 90_000, nowMs: 170_000 });
  assert.deepEqual(p, { kind: 'wait', atMs: 210_000, next: $(500), why: 'recent' });
});

test('small loans, top level and income-capped limits never level up', () => {
  assert.deepEqual(levelPlan({ ...base, principal: $(40) }), { kind: 'small', half: $(50) });
  assert.deepEqual(levelPlan({ ...base, level: 4 }), { kind: 'max' });
  assert.deepEqual(levelPlan({ ...base, incomeCap: $(100) }), { kind: 'capped', limit: $(100) });
});

test('the repaid entry says why there was no level-up', () => {
  assert.match(noLevelUpReason({ levelBefore: 1, principal: $(100), limitAtBorrow: $(100), heldMs: 18_000, minHoldMs: 60_000 }), /repaid after 18 s; .* at least 1 min/);
  assert.match(noLevelUpReason({ levelBefore: 1, principal: $(40), limitAtBorrow: $(100), heldMs: 90_000, minHoldMs: 60_000 }), /under half/);
  assert.match(noLevelUpReason({ levelBefore: 4, principal: $(100), limitAtBorrow: $(100), heldMs: 90_000, minHoldMs: 60_000 }), /top level/);
  assert.match(noLevelUpReason({ levelBefore: 2, principal: $(250), limitAtBorrow: $(250), heldMs: 90_000, minHoldMs: 60_000 }), /once per term/);
});

test('the level-up rule is written from the live contract settings', async () => {
  const { durationWords, levelRuleText } = await import('./levels.ts');
  assert.equal(durationWords('60000000000'), '1 minute');
  assert.equal(durationWords('120000000000'), '2 minutes');
  assert.equal(durationWords('1296000000000000'), '15 days');
  assert.equal(durationWords('2592000000000000'), '30 days');
  assert.equal(durationWords('3600000000000'), '1 hour');
  // testnet config (kredofi.kency.testnet) and mainnet config (kredofi.near), Nov 2026
  assert.equal(levelRuleText('testnet', { min_hold_ns: '60000000000', loan_term_ns: '120000000000' }), 'Hold your next loan at least 1 minute to level up.');
  assert.equal(levelRuleText('mainnet', { min_hold_ns: '1296000000000000', loan_term_ns: '2592000000000000' }),
    'Hold at least 15 days and borrow at least half your limit to level up. Limits can rise at most once per term (30 days).');
});
