// node --test deploy/cloudflare/worker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { ORIGIN, PAGE_TIMEOUT_MS, API_TIMEOUT_MS } from './worker.js';

const env = { PROXY_SECRET: 'test-secret' };
function capture(response = new Response('ok')) {
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return typeof response === 'function' ? response() : response; };
  return seen;
}

test('www and http redirect to https://kredofi.xyz, path kept', async () => {
  capture();
  for (const u of ['https://www.kredofi.xyz/borrow?x=1', 'http://kredofi.xyz/borrow?x=1']) {
    const r = await worker.fetch(new Request(u), env);
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), 'https://kredofi.xyz/borrow?x=1');
  }
});

test('proxies to the Space with the real client IP and the proxy secret; drops forged headers', async () => {
  const seen = capture();
  const req = new Request('https://kredofi.xyz/api/score?a=1', {
    method: 'POST', body: '{"x":1}',
    headers: { 'cf-connecting-ip': '203.0.113.7', 'x-kredofi-client-ip': '1.1.1.1', 'x-kredofi-proxy': 'guess', 'x-forwarded-for': '9.9.9.9', cookie: 'a=b', 'content-type': 'application/json' },
  });
  await worker.fetch(req, env);
  const { url, init } = seen[0];
  assert.equal(url, `${ORIGIN}/api/score?a=1`);
  assert.equal(init.headers.get('x-kredofi-client-ip'), '203.0.113.7');
  assert.equal(init.headers.get('x-kredofi-proxy'), 'test-secret');
  assert.equal(init.headers.get('x-forwarded-for'), null);
  assert.equal(init.headers.get('cookie'), 'a=b');
  assert.equal(init.redirect, 'manual');
  assert.ok(init.body);
});

test('streams the response, keeps cookies, rewrites Space redirects to kredofi.xyz', async () => {
  const h = new Headers({ location: `${ORIGIN}/docs/overview` });
  h.append('set-cookie', 'a=1; Path=/'); h.append('set-cookie', 'b=2; Path=/');
  capture(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('chunk')); c.close(); } }), { status: 307, headers: h }));
  const r = await worker.fetch(new Request('https://kredofi.xyz/docs'), env);
  assert.equal(r.status, 307);
  assert.equal(r.headers.get('location'), 'https://kredofi.xyz/docs/overview');
  assert.deepEqual(r.headers.getSetCookie(), ['a=1; Path=/', 'b=2; Path=/']);
  assert.equal(await r.text(), 'chunk');
});

test('other hosts 404; no secret configured fails closed', async () => {
  capture();
  assert.equal((await worker.fetch(new Request('https://evil.example/'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://kredofi.xyz/'), {})).status, 503);
});

// Fake timers: `stuck` attempts wait forever until their signal aborts, as a hung upstream does.
function upstream(t, plan) {
  const seen = [];
  globalThis.fetch = (url, init) => {
    seen.push({ url, init });
    const step = plan[seen.length - 1];
    if (step === 'stuck') return new Promise((_, no) => init.signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    if (step === 'down') return Promise.reject(new Error('connection refused'));
    return Promise.resolve(step);
  };
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.method(console, 'log', () => {});
  return seen;
}
async function advance(t, ms) { await new Promise((r) => setImmediate(r)); t.mock.timers.tick(ms); await new Promise((r) => setImmediate(r)); }

test('stuck GET: times out, retries once, serves the second answer', async (t) => {
  const seen = upstream(t, ['stuck', new Response('page')]);
  const p = worker.fetch(new Request('https://kredofi.xyz/trust'), env);
  await advance(t, PAGE_TIMEOUT_MS);
  const r = await p;
  assert.equal(seen.length, 2);
  assert.equal(await r.text(), 'page');
  assert.equal(r.headers.get('x-kredofi-attempts'), '2');
});

test('GET stuck twice: 504 page, no store, after exactly two attempts', async (t) => {
  const seen = upstream(t, ['stuck', 'stuck']);
  const p = worker.fetch(new Request('https://kredofi.xyz/borrow'), env);
  await advance(t, PAGE_TIMEOUT_MS); await advance(t, PAGE_TIMEOUT_MS);
  const r = await p;
  assert.equal(seen.length, 2);
  assert.equal(r.status, 504);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('content-type'), /text\/html/);
});

test('API GET gets the longer timeout and a JSON 504', async (t) => {
  const seen = upstream(t, ['stuck', 'stuck']);
  const p = worker.fetch(new Request('https://kredofi.xyz/api/ledger'), env);
  await advance(t, PAGE_TIMEOUT_MS);
  assert.equal(seen.length, 1, 'still on the first attempt at the page timeout');
  await advance(t, API_TIMEOUT_MS - PAGE_TIMEOUT_MS); await advance(t, API_TIMEOUT_MS);
  const r = await p;
  assert.equal(r.status, 504);
  assert.ok((await r.json()).error);
});

test('connection failure on GET retries too', async (t) => {
  const seen = upstream(t, ['down', new Response('ok')]);
  const r = await worker.fetch(new Request('https://kredofi.xyz/'), env);
  assert.equal(seen.length, 2);
  assert.equal(r.status, 200);
});

test('POST is never retried and gets no timeout', async (t) => {
  const seen = upstream(t, ['down', new Response('second call must not happen')]);
  await assert.rejects(worker.fetch(new Request('https://kredofi.xyz/api/score', { method: 'POST', body: '{}' }), env));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.signal, undefined);
});

test('the timeout never cuts a body that is still streaming', async (t) => {
  let ctl;
  const body = new ReadableStream({ start(c) { ctl = c; } });
  const seen = upstream(t, [new Response(body)]);
  const r = await worker.fetch(new Request('https://kredofi.xyz/trust'), env);
  await advance(t, PAGE_TIMEOUT_MS * 3);
  assert.equal(seen[0].init.signal.aborted, false);
  ctl.enqueue(new TextEncoder().encode('late')); ctl.close();
  assert.equal(await r.text(), 'late');
});
