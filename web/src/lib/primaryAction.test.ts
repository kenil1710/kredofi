import { test } from 'node:test';
import assert from 'node:assert/strict';
import { primaryAction, type PassbookState } from './primaryAction.ts';

const base: PassbookState = { scoringBusy: false, scoringFailed: false, picking: false, canBorrow: false, loanActive: false, canDefault: false, isMax: false, releasePending: false };
const at = (p: Partial<PassbookState>) => primaryAction({ ...base, ...p });

test('nothing to press while scoring or when denied', () => {
  assert.equal(at({ scoringBusy: true, picking: true }), null);
  assert.equal(at({}), null); // e.g. band D: no action
});

test('one action per step of the demo loop', () => {
  assert.equal(at({ picking: true }), 'start');
  assert.equal(at({ scoringFailed: true }), 'retry');
  assert.equal(at({ canBorrow: true }), 'borrow');
  assert.equal(at({ loanActive: true }), 'repay');
  assert.equal(at({ releasePending: true }), 'release');
});

test('repay stays primary for an honest borrower even after the grace period', () => {
  assert.equal(at({ loanActive: true, canDefault: true }), 'repay');
  assert.equal(at({ loanActive: true, isMax: true }), 'repay');
  assert.equal(at({ loanActive: true, canDefault: true, isMax: true }), 'default');
});
