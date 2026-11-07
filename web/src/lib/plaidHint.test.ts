import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OTHER_BANK_NOTE, PLATYPUS_ID, PLATYPUS_STEPS, plaidHintAfter } from './plaidHint.ts';

test('three steps a judge can follow', () => {
  assert.deepEqual([...PLATYPUS_STEPS], ['Type Platypus', 'Pick First Platypus Bank (not OAuth)', 'user_good / pass_good']);
});

test('another bank gets an honest note (it works, with extra test screens), never a false "real login" warning', () => {
  const open = { other: null };
  assert.deepEqual(plaidHintAfter(open, 'SELECT_INSTITUTION', { institution_id: 'ins_56', institution_name: 'Chase' }), { other: 'Chase' });
  assert.match(OTHER_BANK_NOTE, /also works in this test sandbox/);
  assert.match(OTHER_BANK_NOTE, /code 1234/);
  assert.doesNotMatch(OTHER_BANK_NOTE, /real login/);
});

test('picking First Platypus Bank hides the box; other events keep it; a closed Link stays closed', () => {
  assert.equal(plaidHintAfter({ other: 'Chase' }, 'SELECT_INSTITUTION', { institution_id: PLATYPUS_ID }), null);
  assert.deepEqual(plaidHintAfter({ other: null }, 'SELECT_INSTITUTION', { institution_id: 'ins_x' }), { other: 'That bank' });
  assert.deepEqual(plaidHintAfter({ other: null }, 'TRANSITION_VIEW', {}), { other: null });
  assert.equal(plaidHintAfter(null, 'SELECT_INSTITUTION', { institution_id: 'ins_56' }), null);
});
