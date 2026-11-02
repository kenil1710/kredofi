import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usableSummary } from './aiSummary.ts';

test('summaries with numbers are not shown (they can be wrong)', () => {
  assert.equal(usableSummary('Income arrived in only one of the last six months.'), null);
  assert.equal(usableSummary('You were paid 4 times.'), null);
  assert.equal(usableSummary('Your savings cover about half a month.'), null);
});

test('a plain summary is shown', () => {
  const ok = 'You earned Band A because your income was steady and your payments were always on time.';
  assert.equal(usableSummary(ok), ok);
  assert.equal(usableSummary(''), null);
  assert.equal(usableSummary(null), null);
});
