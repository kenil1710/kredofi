import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basisFor, collateralFor, creditFor, ratioText, RATIO_BPS, STANDARD_RATIO_BPS, TERM_ROWS } from './vault.ts';
import type { BorrowerView } from './chain.ts';

const b = (over: { band?: string; expired?: boolean; blocked?: boolean; none?: boolean }) => ({
  blocked: !!over.blocked,
  score: over.none ? null : { band: over.band ?? 'A', expired: !!over.expired },
}) as unknown as BorrowerView;

test('the page reads a band the way the contract does', () => {
  assert.equal(basisFor(null), 'no_score');
  assert.equal(basisFor(undefined), 'no_score');
  assert.equal(basisFor(b({ none: true })), 'no_score');
  for (const band of ['A', 'B', 'C', 'D']) assert.equal(basisFor(b({ band })), band);
  assert.equal(basisFor(b({ band: 'A', expired: true })), 'expired');
  assert.equal(basisFor(b({ band: 'A', blocked: true })), 'blocked');
  assert.equal(basisFor(b({ band: 'A', expired: true, blocked: true })), 'blocked');
});

test('credit matches the positions opened on testnet', () => {
  assert.equal(creditFor(110_000_000n, RATIO_BPS.A), 100_000_000n);  // devcheck-riya
  assert.equal(creditFor(110_000_000n, RATIO_BPS.B), 88_000_000n);   // devcheck-plaid
  assert.equal(creditFor(110_000_000n, RATIO_BPS.C), 78_571_428n);   // contract test
  assert.equal(creditFor(110_000_000n, RATIO_BPS.D), 73_333_333n);   // devcheck-sam
});

test('collateral for a given credit rounds up, and always backs that credit', () => {
  assert.equal(collateralFor(100_000_000n, STANDARD_RATIO_BPS), 150_000_000n);
  assert.equal(collateralFor(100_000_000n, RATIO_BPS.A), 110_000_000n);
  for (const r of Object.values(RATIO_BPS)) assert.ok(creditFor(collateralFor(33_333_333n, r), r) >= 33_333_333n);
});

test('every answer has a row, and only bands A to C beat standard terms', () => {
  const covered = TERM_ROWS.flatMap((r) => r.bases).sort();
  assert.deepEqual(covered, Object.keys(RATIO_BPS).sort());
  for (const r of TERM_ROWS) for (const k of r.bases) assert.equal(RATIO_BPS[k], r.ratioBps);
  assert.deepEqual(Object.entries(RATIO_BPS).filter(([, v]) => v < STANDARD_RATIO_BPS).map(([k]) => k).sort(), ['A', 'B', 'C']);
  assert.equal(ratioText(RATIO_BPS.B), '125%');
});
