import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortHash, usd, usdShort, parseUsd, absoluteDate, relativeTime, amountInWords } from './format.ts';

test('shortHash keeps 6 + 3', () => {
  assert.equal(shortHash('8u8RsNzgxKSdhSbzSwi5qb7CGeWrk9RJWhHzVvWfZfbW'), '8u8RsN…fbW');
  assert.equal(shortHash('abc'), 'abc');
});

test('usd formats 6-decimal base units', () => {
  assert.equal(usd('100000000'), '$100.00');
  assert.equal(usd(102_000_000n), '$102.00');
  assert.equal(usd('1001600000'), '$1,001.60');
  assert.equal(usd('400000'), '$0.40');
  assert.equal(usd('1999999'), '$1.99', 'truncates below a cent');
  assert.equal(usd('250000000', { cents: false }), '$250');
  assert.equal(usd(-70_000_000n), '−$70.00');
});

test('parseUsd accepts dollars with up to 2 decimals', () => {
  assert.equal(parseUsd('100'), 100_000_000n);
  assert.equal(parseUsd('$1,000.5'), 1_000_500_000n);
  assert.equal(parseUsd('0.01'), 10_000n);
  for (const bad of ['', 'abc', '1.234', '-5', '1e3']) assert.equal(parseUsd(bad), null, bad);
});

test('dates', () => {
  assert.equal(absoluteDate('1795521600000000000'), '24 November 2026');
  assert.equal(relativeTime(0, 10_000), 'just now');
  assert.equal(relativeTime(0, 120_000), '2 min ago');
  assert.equal(relativeTime(0, 3 * 3600_000), '3 h ago');
  assert.equal(relativeTime(0, 86400_000), '1 day ago');
});

test('amount in words matches the note', () => {
  assert.equal(amountInWords(100), 'One hundred US dollars, in USDC');
  assert.equal(amountInWords(250), 'Two hundred and fifty US dollars, in USDC');
  assert.equal(amountInWords(1000), 'One thousand US dollars, in USDC');
  assert.equal(amountInWords(75), 'Seventy-five US dollars, in USDC');
  assert.equal(amountInWords(0), 'Zero US dollars');
  assert.equal(amountInWords(187.5), 'One hundred and eighty-seven US dollars and 50 cents, in USDC');
  assert.equal(usdShort('187500000'), '$187.50');
  assert.equal(usdShort('75000000'), '$75');
});
