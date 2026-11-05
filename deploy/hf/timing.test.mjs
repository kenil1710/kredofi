// node --test deploy/hf/timing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

process.env.TIMING_SLOW_MS = '30';
process.env.TIMING_OPEN_MS = '60';
process.env.TIMING_MINUTE_MS = '100';
const lines = [];
const realLog = console.log;
console.log = (s) => (String(s).startsWith('[timing]') ? lines.push(s) : realLog(s));
createRequire(import.meta.url)('./timing.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/slow')) await wait(45);
  if (req.url.startsWith('/hang')) return;
  res.end('ok');
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { console.log = realLog; server.closeAllConnections(); server.close(); });

test('a slow request is logged with path, status and times, never the query', async () => {
  await (await fetch(`${base}/slow?account=secret.testnet`)).text();
  await wait(5);
  const l = lines.find((x) => x.includes('slow GET /slow'));
  assert.match(l, /slow GET \/slow 200 ttfb=\d+ total=\d+/);
  assert.ok(!lines.join().includes('secret.testnet'));
});

test('a fast request gets no line of its own', async () => {
  await (await fetch(`${base}/fast`)).text();
  await wait(5);
  assert.ok(!lines.some((x) => x.includes('/fast')));
});

test('a hung request leaves an open line, then a gone line when the client leaves', async () => {
  const ctl = new AbortController();
  const p = fetch(`${base}/hang`, { signal: ctl.signal }).catch(() => {});
  await wait(80);
  assert.ok(lines.some((x) => x === '[timing] open GET /hang 60'));
  ctl.abort();
  await p;
  await wait(20);
  assert.ok(lines.some((x) => /gone GET \/hang ttfb=- total=\d+/.test(x)));
});

test('the minute line reports traffic', async () => {
  await wait(120);
  assert.ok(lines.some((x) => /min n=\d+ p50=\d+ p95=\d+ max=\d+ open=\d+ lag=\d+/.test(x)));
});
