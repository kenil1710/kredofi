// node --test deploy/cloudflare/cron.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { dispatch, UNTIL } from './cron.js';

const stub = (...statuses) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return { status: statuses[Math.min(calls.length - 1, statuses.length - 1)] }; }; f.calls = calls; return f; };

test('dispatch posts main to the right workflow with the token', async () => {
  const f = stub(204);
  await dispatch('seed-tick.yml', 'tok', f);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://api.github.com/repos/kenil1710/kredofi/actions/workflows/seed-tick.yml/dispatches');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { ref: 'main' });
});

test('a bad token fails at once, without a retry, and the error never holds the token', async () => {
  const f = stub(401);
  await assert.rejects(dispatch('seed-tick.yml', 'secret-tok', f), (e) => { assert.ok(!e.message.includes('secret-tok')); return /401/.test(e.message); });
  assert.equal(f.calls.length, 1);
});

test('a GitHub 5xx is retried once, then fails', async () => {
  const ok = stub(502, 204);
  await dispatch('health-watch.yml', 't', ok);
  assert.equal(ok.calls.length, 2);
  await assert.rejects(dispatch('health-watch.yml', 't', stub(503)), /503/);
});

test('scheduled maps the cron to a workflow, refuses an unknown cron, and stops after its date', async () => {
  const env = { CRON_MAP: JSON.stringify({ '17 * * * *': 'seed-tick.yml' }), GH_DISPATCH_TOKEN: 't' };
  await assert.rejects(worker.scheduled({ cron: '1 1 1 1 1', scheduledTime: 0 }, env), /no workflow/);
  const real = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called++; return { status: 204 }; };
  try {
    await worker.scheduled({ cron: '17 * * * *', scheduledTime: Date.parse(UNTIL['seed-tick.yml']) - 1 }, env);
    assert.equal(called, 1);
    await worker.scheduled({ cron: '17 * * * *', scheduledTime: Date.parse(UNTIL['seed-tick.yml']) }, env);
    assert.equal(called, 1);
  } finally { globalThis.fetch = real; }
});
