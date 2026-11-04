// N real enclave scores through the live site's /scenarios page, each on a fresh devcheck… account
// (tagged "Developer check" on /ledger). Prints the timings, read from the chain, and every failure;
// a score_failed is retried only if RETRY=1, and still counts as a failure. Testnet only.
//
//   PW=~/.npm/_npx/<hash>/node_modules N=10 node scripts/devcheck_scores.mjs
//   Options: BASE (default https://kredofi.xyz), CONCURRENCY (default 1), OUT (JSON results file), CHROME (browser path)
// Then, after any retest that defaults a loan:
//   ALLOW_DEMO_CONTRACT=1 KREDOFI_CONTRACT=app.kency.testnet MIN_USD=499 ./scripts/reserve_guard.sh
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createDevcheckAccount } from './lib/devcheck.mjs';

const BASE = process.env.BASE ?? 'https://kredofi.xyz';
const N = Number(process.env.N ?? 10), CONCURRENCY = Number(process.env.CONCURRENCY ?? 1);
const RPC = 'https://test.rpc.fastnear.com', POOL = 'app.kency.testnet';
const WHO = ['Riya', 'Sam', 'Max'];
const { chromium } = createRequire(join(process.env.PW ?? '.', 'x.js'))('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rpc = async (method, params) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;

/** Seconds from the request's block to the on_score block, and the contract's verdict, from the chain. */
async function chainResult(hash, signer) {
  for (let i = 0; i < 40; i++) {
    const tx = await rpc('tx', { tx_hash: hash, sender_account_id: signer, wait_until: 'FINAL' }).catch(() => null);
    const events = (tx?.receipts_outcome ?? []).filter((r) => r.outcome.executor_id === POOL).flatMap((r) => r.outcome.logs.map((l) => [r, l]))
      .filter(([, l]) => l.startsWith('EVENT_JSON:')).map(([r, l]) => [r, JSON.parse(l.slice(11))]);
    const hit = events.find(([, e]) => e.event === 'score_issued' || e.event === 'score_failed');
    if (hit) {
      const time = async (h) => BigInt((await rpc('block', { block_id: h })).header.timestamp);
      const start = await time(tx.transaction_outcome.block_hash), end = await time(hit[0].block_hash);
      return { seconds: Number((end - start) / 1_000_000n) / 1000, event: hit[1].event, band: hit[1].data?.[0]?.band, reason: hit[1].data?.[0]?.reason };
    }
    await sleep(3000);
  }
  return { event: 'no answer', seconds: null };
}

async function one(browser, i) {
  const who = WHO[i % WHO.length];
  const demo = await createDevcheckAccount();
  const ctx = await browser.newContext();
  await ctx.addInitScript(([d]) => localStorage.setItem('kredofi:demo-account:scenarios', d), [JSON.stringify(demo)]);
  const p = await ctx.newPage();
  const started = Date.now();
  let hash = null, seenNote = false;
  try {
    await p.goto(`${BASE}/scenarios`, { waitUntil: 'networkidle', timeout: 60_000 });
    await p.getByRole('button', { name: `Use ${who}` }).click();
    await p.waitForSelector('.entry h2:has-text("Checking your limit")', { timeout: 60_000 });
    // Done when the entry says "Limit checked in N s" or "Scoring failed".
    const deadline = Date.now() + 180_000;
    let title = '';
    while (Date.now() < deadline) {
      seenNote ||= (await p.locator('text=/Still waiting for the test bank/').count()) > 0;
      title = (await p.locator('.entry h2').allTextContents()).find((t) => /Limit checked|Scoring failed/.test(t)) ?? '';
      if (title) break;
      await sleep(500);
    }
    await sleep(2500);
    hash = await p.evaluate((acct) => { const s = JSON.parse(localStorage.getItem(`kredofi:passbook:${acct}`) ?? '{}'); return s.scoreHash ?? s.pendingHash ?? null; }, demo.accountId);
    const chain = hash ? await chainResult(hash, demo.accountId) : { event: 'no tx hash', seconds: null };
    return { i: i + 1, who, account: demo.accountId, ui: title, uiWallSeconds: Math.round((Date.now() - started) / 1000), noteShown: seenNote, hash, ...chain };
  } catch (e) {
    return { i: i + 1, who, account: demo.accountId, event: 'harness error', error: String(e.message).slice(0, 200), hash, seconds: null };
  } finally { await ctx.close(); }
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const results = [];
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < N) { const r = await one(browser, next++); results.push(r); console.log(JSON.stringify(r)); }
}));
await browser.close();
const ok = results.filter((r) => r.event === 'score_issued'), times = ok.map((r) => r.seconds).sort((a, b) => a - b);
console.log(`\n${ok.length}/${results.length} scored; failures: ${results.length - ok.length}`);
if (times.length) console.log(`seconds on-chain: min ${times[0]}, median ${times[Math.floor(times.length / 2)]}, max ${times.at(-1)}; over 30 s: ${times.filter((t) => t > 30).length}`);
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(results, null, 2));
process.exit(ok.length === results.length ? 0 : 1);
