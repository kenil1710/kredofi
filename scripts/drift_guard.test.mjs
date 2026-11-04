// node --experimental-strip-types --test scripts/drift_guard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS, driftOf, isDue } from './drift_guard.mjs';

const check = (who) => CHECKS.find((c) => c.who === who);

test('expected table: Riya 1000/A, Sam 270/D, Max 1000/A, user_good band B, all on devcheck accounts', () => {
  assert.deepEqual(CHECKS.map((c) => [c.who, c.band, c.score]), [['riya', 'A', 1000], ['sam', 'D', 270], ['max', 'A', 1000], ['plaid', 'B', null]]);
  for (const c of CHECKS) assert.match(c.account, /^devcheck-[a-z]+\.relayer\.kency\.testnet$/);
});

test('any change in band or score is drift; user_good is checked on band only', () => {
  assert.equal(driftOf(check('riya'), { band: 'A', score: 1000 }), null);
  assert.match(driftOf(check('riya'), { band: 'A', score: 835 }), /score 835/);
  assert.match(driftOf(check('sam'), { band: 'C', score: 270 }), /band C/);
  assert.equal(driftOf(check('plaid'), { band: 'B', score: 700 }), null);
  assert.match(driftOf(check('plaid'), { band: 'C', score: 600 }), /band C/);
  assert.equal(driftOf(check('max'), null), 'no score');
});

test('scores once a day: due with no score or after the minimum age', () => {
  const now = Date.UTC(2026, 10, 5, 12), H = 3_600_000, at = (ms) => ({ score: { issued_at: String(ms * 1e6) } });
  assert.equal(isDue(null, now, 20 * H), true);
  assert.equal(isDue({ score: null }, now, 20 * H), true);
  assert.equal(isDue(at(now - 6 * H), now, 20 * H), false);
  assert.equal(isDue(at(now - 21 * H), now, 20 * H), true);
});
