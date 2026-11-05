// node --experimental-strip-types --test scripts/drift_guard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS, countDriftOf, driftOf, isDue, readSandboxCount } from './drift_guard.mjs';
import { SANDBOX_COUNT } from '../web/src/lib/proofFacts.ts';

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

test('the count compared is the one the landing page prints; any change in it is drift, naming both numbers', () => {
  assert.deepEqual([SANDBOX_COUNT.transactions, SANDBOX_COUNT.accounts], [385, 14]);
  assert.equal(countDriftOf(SANDBOX_COUNT, { transactions: 385, accounts: 14 }), null);
  const moved = countDriftOf(SANDBOX_COUNT, { transactions: 386, accounts: 14 });
  assert.match(moved, /386 transactions/);
  assert.match(moved, /says 385/);
  assert.match(countDriftOf(SANDBOX_COUNT, { transactions: 385, accounts: 13 }), /13 accounts/);
});

// A fake Plaid: each sync call answers from `pages`, then repeats an empty complete page.
const fakePlaid = (pages, accounts = 14) => {
  const calls = [];
  let i = 0;
  const post = async (path, body) => {
    calls.push(path);
    if (path.endsWith('public_token/create')) return { public_token: 'pt' };
    if (path.endsWith('exchange')) return { access_token: 'at' };
    if (path.endsWith('accounts/get')) return { accounts: Array(accounts).fill({}) };
    if (path.endsWith('item/remove')) return {};
    assert.equal(body.access_token, 'at');
    const p = pages[Math.min(i++, pages.length - 1)];
    return { added: (p.ids ?? []).map((id) => ({ transaction_id: id })), has_more: !!p.more, next_cursor: `c${i}`, transactions_update_status: p.status ?? 'HISTORICAL_UPDATE_COMPLETE' };
  };
  return { post, calls };
};
const noSleep = async () => {};

test('a count waits out an early "complete" flag and pages, and removes its item', async () => {
  const f = fakePlaid([{ ids: ['a'], status: 'INITIAL_UPDATE_COMPLETE' }, { ids: ['b'] }, {}, { ids: ['c', 'd'], more: true }, { ids: ['e', 'a'] }, {}]);
  assert.deepEqual(await readSandboxCount(f.post, noSleep), { transactions: 5, accounts: 14 });
  assert.equal(f.calls.at(-1), '/item/remove');
});

test('a read that never settles throws instead of reporting a partial count, and still removes its item', async () => {
  const f = fakePlaid([{ ids: ['a'], status: 'NOT_READY' }]);
  await assert.rejects(readSandboxCount(f.post, noSleep), /did not settle/);
  assert.equal(f.calls.at(-1), '/item/remove');
});
