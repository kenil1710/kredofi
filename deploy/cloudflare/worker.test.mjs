// node --test deploy/cloudflare/worker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { ORIGIN } from './worker.js';

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
