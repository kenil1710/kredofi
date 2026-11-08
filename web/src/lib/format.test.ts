import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortHash, usd, usdShort, usdInput, parseUsd, absoluteDate, relativeTime, amountInWords, clockTime, shortDay, zoneName, dateTimeZone, defaultDeposit } from './format.ts';

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
  assert.equal(absoluteDate('1795521600000000000', 'UTC'), '24 November 2026');
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

test('usdInput rounds cents down, so a default deposit never exceeds the balance (retest Nov 7: $6.99 showed 7.00)', () => {
  assert.equal(usdInput(6_999_999n), '6.99');
  assert.equal(usdInput(7_000_000n), '7.00');
  assert.equal(usdInput(10_050_000n), '10.05');
  assert.ok(parseUsd(usdInput(6_999_999n))! <= 6_999_999n);
});

// Bug Nov 9: "Repay $79.50 by 8 November 2026, 01:41" at 9 Nov 01:39 IST: a UTC date next to a local clock.
test('due date, time and zone all come from the visitor\'s time zone', () => {
  const ns = String(BigInt(Date.UTC(2026, 10, 8, 20, 11)) * 1_000_000n); // 8 Nov 20:11 UTC = 9 Nov 01:41 IST
  assert.equal(dateTimeZone(ns, 'Asia/Kolkata'), '9 November 2026, 01:41 GMT+5:30');
  assert.equal(dateTimeZone(ns, 'America/Los_Angeles'), '8 November 2026, 12:11 GMT-8');
  assert.equal(dateTimeZone(ns, 'UTC'), '8 November 2026, 20:11 UTC');
  assert.equal(absoluteDate(ns, 'Asia/Kolkata'), '9 November 2026');
  const ms = Date.UTC(2026, 10, 8, 20, 11);
  assert.equal(clockTime(ms, 'Asia/Kolkata'), '01:41');
  assert.equal(shortDay(ms, 'Asia/Kolkata'), '9 Nov');
  assert.equal(zoneName(ms, 'Asia/Kolkata'), 'GMT+5:30');
  // no zone given: the process's own zone, and the date always matches the clock
  const local = new Date(ms);
  assert.equal(absoluteDate(ns), local.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
});

test('lend deposit default follows the balance, up to $100, rounded down', () => {
  assert.equal(defaultDeposit(null), '100');
  assert.equal(defaultDeposit(0n), '100');
  assert.equal(defaultDeposit(5_500_000n), '5.50');
  assert.equal(defaultDeposit(5_509_999n), '5.50');
  assert.equal(defaultDeposit(500_000_000n), '100');
  assert.equal(defaultDeposit(100_000_000n), '100');
});
