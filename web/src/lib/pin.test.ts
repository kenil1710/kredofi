import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingScorerText, delayText, utcMinute } from './pin.ts';

const H = 'ab'.repeat(32);
// 5 Nov 2026 12:00:00 UTC in ns.
const T = String(BigInt(Date.UTC(2026, 10, 5, 12, 0)) * 1_000_000n);

test('delay text', () => {
  assert.equal(delayText('86400000000000'), '24 h');
  assert.equal(delayText('60000000000'), '1 min');
  assert.equal(delayText('90000000000'), '90 s');
});

test('utc minute', () => assert.equal(utcMinute(T), '5 Nov 2026, 12:00 UTC'));

test('loading and old contract', () => {
  assert.equal(pendingScorerText(null, 0), '…');
  assert.match(pendingScorerText({}, 0), /no time lock on this contract version/);
});

test('none pending', () => {
  assert.equal(pendingScorerText({ scorer_delay_ns: '86400000000000', pending_scorer: null }, 0), 'none (time lock 24 h)');
});

test('pending, before and after the lock', () => {
  const cfg = { scorer_delay_ns: '86400000000000', pending_scorer: { version: H, proposed_at: '0', apply_at: T } };
  const before = Date.UTC(2026, 10, 5, 11, 59);
  assert.equal(pendingScorerText(cfg, before), `${H} applies at 5 Nov 2026, 12:00 UTC at the earliest (time lock 24 h)`);
  assert.match(pendingScorerText(cfg, Date.UTC(2026, 10, 5, 12, 0)), /can be applied now/);
});
