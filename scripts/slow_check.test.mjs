// node --test scripts/slow_check.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, problems, run, timePage } from './slow_check.mjs';

const quiet = { sleep: async () => {}, print: () => {} };

test('watches /, /borrow and /trust', () => assert.deepEqual(PAGES, ['/', '/borrow', '/trust']));

test('10 s exactly passes, just over goes red', () => {
  assert.deepEqual(problems('/', { status: 200, ms: 10000 }, 10), []);
  assert.match(problems('/', { status: 200, ms: 10001, attempts: '2' }, 10)[0], /\/: 10\.0 s, limit 10 s \(Worker attempts: 2\)/);
});

test('a failed or non-200 read goes red whatever the time', () => {
  assert.match(problems('/trust', { status: 504, ms: 100 }, 10)[0], /status 504/);
  assert.match(problems('/trust', { status: 0, ms: 45000, error: 'TimeoutError' }, 10).join(), /TimeoutError/);
});

test('every page is read every round; one slow read in the last round is enough', async () => {
  const seen = [];
  const time = async (u) => { seen.push(u); return { status: 200, ms: seen.length === 6 ? 15000 : 500, attempts: '1' }; };
  const bad = await run({ base: 'https://x', rounds: 2, time, ...quiet });
  assert.equal(seen.length, 6);
  assert.deepEqual(bad, ['/trust: 15.0 s, limit 10 s (Worker attempts: 1)']);
});

test('timePage counts the body and turns a thrown fetch into status 0', async () => {
  let t = 0;
  const now = () => t;
  const ok = await timePage('https://x/', { now, fetchImpl: async () => ({ status: 200, headers: new Headers({ 'x-kredofi-attempts': '1' }), text: async () => { t = 11000; return ''; } }) });
  assert.deepEqual(ok, { status: 200, ms: 11000, attempts: '1' });
  const down = await timePage('https://x/', { now, fetchImpl: async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); } });
  assert.equal(down.status, 0);
  assert.equal(down.error, 'TimeoutError');
});
