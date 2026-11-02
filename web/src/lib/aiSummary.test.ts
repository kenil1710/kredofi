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

test('the summary request carries only the band and rule results in words', async () => {
  const { summaryRequest, checkParts, parseSummary } = await import('./aiSummary.ts');
  const ok = checkParts('B', { income: 100, stability: 250, payment: 250, cash_flow: 90, buffer: 0 });
  assert.ok(ok);
  const req = summaryRequest(ok.band, ok.parts);
  const user = req.messages[1].content;
  assert.equal(user, 'Band B. income level: some points; steady income: full marks; on-time payments: full marks; money left over after spending: most points; savings buffer: no points.');
  assert.doesNotMatch(user, /\d/);
  assert.equal(req.model, 'Qwen/Qwen3.8-27B');
  const { SUMMARY_PLAN } = await import('./aiSummary.ts');
  assert.deepEqual(SUMMARY_PLAN, [['Qwen/Qwen3.8-27B', 8000], ['Qwen/Qwen3.6-35B-A3B-FP8', 15000]]);
  assert.equal(summaryRequest(ok.band, ok.parts, 'Qwen/Qwen3.6-35B-A3B-FP8').model, 'Qwen/Qwen3.6-35B-A3B-FP8');
  assert.equal(checkParts('E', ok.parts), null);
  assert.equal(checkParts('A', { ...ok.parts, buffer: 101 }), null);
  assert.equal(checkParts('A', { ...ok.parts, payment: '250' }), null);
  assert.equal(parseSummary({ choices: [{ message: { content: '<think>x</think>  Your income was steady.\n Build savings.' } }] }), 'Your income was steady. Build savings.');
  assert.equal(parseSummary({ choices: [{ message: { content: 'Paid in 4 months.' } }] }), null);
  assert.equal(parseSummary({}), null);
});
