// Seeded demo activity for the testnet ledger (SPEC 8d, docs/LEDGER_PLAN.md).
// Scripted borrowers go through the REAL path: a Plaid sandbox score (Dev-mode contract: the pinned
// demo scorer + dev_submit_score; OutLayer-mode contract such as app.kency.testnet from Nov 5: the
// borrower seals a Plaid sandbox token to the enclave and signs request_score itself), borrow, then repay after the minimum hold, or a real default after the grace
// period (the reserve pays the pool). Every account is under kredofi-seed.testnet, and the ledger tags
// every row from them "Seeded demo". They are not real users. Testnet only.
//
//   node --experimental-strip-types scripts/seed_ledger.mjs plan                 # print the plan (no network writes)
//   node --experimental-strip-types scripts/seed_ledger.mjs plan --score-check   # + run the scorer locally per borrower (no submit)
//   KREDOFI_CONTRACT=<contract> node ... seed_ledger.mjs setup    # create accounts, test USDC, lender deposit
//   KREDOFI_CONTRACT=<contract> node ... seed_ledger.mjs tick     # run every step that is due (cron, a few times a day)
//   KREDOFI_CONTRACT=<contract> node ... seed_ledger.mjs status
// Options: SEED_DAY_MS (default one day; 0 = everything due now, for a throwaway test contract),
//          SEED_MAX_LOANS (loans per tick, default 6), SEED_ONLY (borrower numbers, e.g. "1,21,22": test runs).
// Keys: the parent's key in ~/.near-credentials/testnet (create it with the faucet, see `setup`);
// Plaid keys and SEAL_KEY_TESTNET from .env (set -a; source .env; set +a). Never printed.
// `tick` runs on GitHub Actions (.github/workflows/seed-tick.yml, every 3 hours, testnet only), not on a
// laptop: keys come from repository secrets, SEED_START from a repository variable, and the done-list
// lives on the `seed-state` branch. Each step is also checked on-chain first (chainState), so a lost
// state file or a run killed mid-loan never repeats or strands a loan.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { actions as nearActions } from 'near-api-js';
import { customProfile } from '../web/src/lib/borrowers.ts';

if (process.env.SEAL_KEY_TESTNET) process.env.SEAL_KEY = process.env.SEAL_KEY_TESTNET; // never the mainnet key
const near = await import('./lib/near.mjs');
const { ROOT, POOL, USDC_ID, RELAYER, account, call, view, exists, createSubAccount, hasKey, sleep, fmtUsd, EXPLORER } = near;

export const PARENT = 'kredofi-seed.testnet';
const LENDER = `lender.${PARENT}`;
const DAY_MS = Number(process.env.SEED_DAY_MS ?? 86_400_000);
const MAX_LOANS = Number(process.env.SEED_MAX_LOANS ?? 6);
const ONLY = process.env.SEED_ONLY ? new Set(process.env.SEED_ONLY.split(',').map(Number)) : null;
const STATE_DIR = join(ROOT, 'scripts', '.seed');

// ---------------------------------------------------------------- the plan (deterministic)
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const id = (n) => `borrower-${String(n).padStart(2, '0')}.${PARENT}`;
const BANDS = { A: [1, 8], B: [9, 16], C: [17, 21], D: [22, 24] };
const bandOfN = (n) => Object.entries(BANDS).find(([, [a, b]]) => n >= a && n <= b)[0];

/** Custom-borrower inputs (SPEC 8b) aimed at the band, with some variety. */
export function inputsFor(n) {
  const r = rng(n * 7919), band = bandOfN(n), pick = (lo, hi, step = 50) => lo + Math.floor(r() * ((hi - lo) / step + 1)) * step;
  if (band === 'A') { const salary = pick(4000, 6000, 250); const spending = Math.round(salary * (0.45 + 0.15 * r()) / 10) * 10; return { salary, months: 6, spending, fees: 0, balance: Math.round(spending * (1.2 + 2.3 * r()) / 50) * 50 }; }
  if (band === 'B') { const salary = pick(2200, 2900); const spending = Math.round(salary * (0.78 + 0.06 * r()) / 10) * 10; return { salary, months: 6, spending, fees: 2, balance: Math.round(spending * (0.5 + 0.4 * r()) / 50) * 50 }; }
  if (band === 'C') { const salary = pick(1600, 1950); const spending = Math.round(salary * (0.75 + 0.08 * r()) / 10) * 10; return { salary, months: 6, spending, fees: 3, balance: Math.round(spending * (0.4 + 0.4 * r()) / 50) * 50 }; }
  const salary = pick(1000, 1400); return { salary, months: 4, spending: Math.round(salary * 0.9 / 10) * 10, fees: 4, balance: 100 };
}

/** SPEC 6 on the custom profile, a rough estimate only (the real scorer gave B and C profiles 50 more
 *  points on Nov 2); `--score-check` runs the real scorer and is what counts. */
export function estimate(c) {
  const monthly = Array.from({ length: 6 }, (_, i) => (i >= 6 - c.months ? c.salary : 0));
  const avg = monthly.reduce((a, b) => a + b, 0) / 6;
  const sd = Math.sqrt(monthly.reduce((a, m) => a + (m - avg) ** 2, 0) / 6), cv = avg ? sd / avg : Infinity;
  const income = avg >= 3000 ? 250 : avg >= 2000 ? 180 : avg >= 1000 ? 100 : 40;
  const stability = Math.floor(150 * c.months / 6) + (cv <= 0.15 ? 100 : cv <= 0.4 ? 50 : 0);
  const payment = Math.max(0, 250 - 60 * c.fees);
  const spend = c.spending * 6 + 35 * c.fees, inc = c.salary * c.months, flow = inc ? (inc - spend) / inc : -1;
  const cash_flow = flow >= 0.3 ? 150 : flow >= 0.1 ? 100 : flow >= 0 ? 50 : 0;
  const ratio = c.balance / (spend / 6);
  const buffer = ratio >= 3 ? 100 : ratio >= 1 ? 60 : ratio >= 0.3 ? 30 : 0;
  const score = income + stability + payment + cash_flow + buffer;
  return { score, band: score >= 800 ? 'A' : score >= 650 ? 'B' : score >= 500 ? 'C' : 'D' };
}

/** 29 loans (A 12, B 11, C 6), 27 repaid, 2 defaults (one B, one C, never A), plus 3 band D scores,
 *  spread over 8 days. Each step: { day, kind: 'loan' | 'score', borrower, share, defaults }. */
export function plan() {
  const r = rng(2026), steps = [];
  const firsts = [...Array(21)].map((_, i) => i + 1);
  const seconds = [1, 2, 3, 4, 9, 10, 11, 17];
  const defaulters = new Set([16, 21]); // band B and band C, single loans
  for (const n of firsts) steps.push({ day: Math.floor(r() * 5), kind: 'loan', n, share: 0.6 + 0.4 * r(), defaults: defaulters.has(n) });
  for (const n of seconds) { const first = steps.find((s) => s.n === n).day; steps.push({ day: Math.min(7, first + 2 + Math.floor(r() * 3)), kind: 'loan', n, share: 0.55 + 0.45 * r(), defaults: false, second: true }); }
  for (const n of [22, 23, 24]) steps.push({ day: 1 + Math.floor(r() * 6), kind: 'score', n });
  steps.sort((a, b) => a.day - b.day || (a.second ? 1 : 0) - (b.second ? 1 : 0) || a.n - b.n);
  return steps.map((s, i) => ({ ...s, i, borrower: id(s.n), band: bandOfN(s.n) }));
}

export function planTotals(steps) {
  const loans = steps.filter((s) => s.kind === 'loan'), t = { A: [0, 0], B: [0, 0], C: [0, 0] };
  for (const s of loans) { t[s.band][0]++; if (s.defaults) t[s.band][1]++; }
  return { loans: loans.length, defaults: loans.filter((s) => s.defaults).length, byBand: t, dScores: steps.filter((s) => s.kind === 'score').length };
}

// ---------------------------------------------------------------- state
const stateFile = () => join(STATE_DIR, `${POOL}.json`);
const load = () => (existsSync(stateFile()) ? JSON.parse(readFileSync(stateFile(), 'utf8')) : { start: null, done: {} });
const save = (s) => { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(stateFile(), JSON.stringify(s, null, 1)); };

// ---------------------------------------------------------------- actions
function guard() {
  if (!/\.testnet$/.test(POOL)) throw new Error('testnet only');
  if (POOL === 'kredofi.near') throw new Error('never on mainnet');
}

// OutLayer mode: the scorer's testnet token key (scripts/token_pubkey.mjs SEAL_KEY_TESTNET; SPEC "Sealed token").
const TOKEN_PUBKEY = process.env.TOKEN_PUBKEY ?? '86658adaeb78fb559a0c3da3d7daa075cea6f3df23b6d8bd868610656ffc4078';

async function scoreInEnclave(n) {
  const { sealToken, keypair } = await import('./lib/seal.mjs');
  const acct = id(n), tag = createHash('sha256').update(acct).digest('hex').slice(0, 4);
  const bal = await near.provider.viewAccount({ accountId: acct });
  if (BigInt(bal.amount) - BigInt(bal.storage_usage) * 10n ** 19n < 170n * 10n ** 21n) throw new Error(`${acct} needs 0.17 NEAR available to sign request_score (run setup to top it up)`);
  const pt = await (await fetch('https://sandbox.plaid.com/sandbox/public_token/create', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, institution_id: 'ins_109508', initial_products: ['transactions', 'identity'],
      options: { override_username: 'user_custom', override_password: JSON.stringify(customProfile(inputsFor(n), tag)), transactions: { days_requested: 730 } } }),
  })).json();
  if (!pt.public_token) throw new Error(`Plaid: ${pt.error_code}`);
  const res = await account(acct).signAndSendTransaction({ receiverId: POOL, waitUntil: 'INCLUDED', throwOnFailure: false,
    actions: [nearActions.functionCall('request_score', { public_token: sealToken(TOKEN_PUBKEY, acct, pt.public_token), reply_pubkey: keypair().public }, 150n * near.TGAS, 10n ** 22n)] });
  const hash = res.transaction_outcome?.id || res.transaction?.hash;
  for (let i = 0; i < 48; i++) {
    await sleep(2500);
    const b = await view(POOL, 'get_borrower', { account_id: acct });
    if (b && !b.pending_request && b.score && Number(b.score.issued_at) > (Date.now() - 180_000) * 1e6) { console.log(`  enclave score ${EXPLORER}${hash}`); return b.score; }
    if (b && !b.pending_request && i > 4) break;
  }
  throw new Error(`enclave score for ${acct} did not land: ${EXPLORER}${hash}`);
}

async function scoreBorrower(n) {
  if ((await view(POOL, 'get_config')).scorer_mode === 'OutLayer') return scoreInEnclave(n);
  const { score } = await import('./dev_scorer.mjs'); // checks the pinned scorer before submitting
  const acct = id(n), tag = createHash('sha256').update(acct).digest('hex').slice(0, 4);
  const dir = join(ROOT, 'scorer', 'out', 'seed'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `${acct}.json`);
  writeFileSync(file, JSON.stringify({ op: 'score', profile: customProfile(inputsFor(n), tag) }));
  const { output, result } = await score(acct, file);
  if (!result.ok) throw new Error(`score for ${acct} rejected: ${result.error}`);
  return output;
}

async function validScore(acct) {
  const b = await view(POOL, 'get_borrower', { account_id: acct });
  return b?.score && Number(b.score.expires_at) > Date.now() * 1e6 ? b : null;
}

async function runLoan(step, cfg) {
  const acct = step.borrower, who = account(acct);
  let b = await validScore(acct);
  if (!b) { const out = await scoreBorrower(step.n); console.log(`  scored ${acct}: band ${out.band} ${out.score}`); await sleep(1500); b = await validScore(acct); }
  if (b.score.band !== step.band) throw new Error(`${acct} scored band ${b.score.band}, plan says ${step.band}`);
  if (b.has_active_loan) throw new Error(`${acct} already has a loan`);
  const limit = BigInt(await view(POOL, 'get_limit', { account_id: acct }));
  const pool = await view(POOL, 'get_pool');
  const cap = BigInt(pool.pool_value) * BigInt(cfg.max_borrower_share_bps) / 10_000n;
  const max = limit < cap ? limit : cap;
  const amount = (max * BigInt(Math.round(step.share * 1000)) / 1000n) / 1_000_000n * 1_000_000n; // whole dollars
  const half = (limit + 1n) / 2n;
  if (half > max) throw new Error(`pool too small for a level-up loan to ${acct} (half the limit ${fmtUsd(half)} > ${fmtUsd(max)})`);
  const amt = amount < half ? half : amount; // at least half the limit, so every planned loan levels up
  const br = await call(who, POOL, 'borrow', { amount: amt.toString() }, { gas: 40n, deposit: 1n });
  if (!br.ok || br.receiptErrors.length) throw new Error(`borrow failed for ${acct}: ${br.error ?? br.receiptErrors[0]}`);
  console.log(`  ${acct} borrowed ${fmtUsd(amt)} (band ${step.band}, limit ${fmtUsd(limit)}) ${EXPLORER}${br.hash}`);
  await finishLoan(step, cfg);
}

/** Repay after the minimum hold, or (planned defaulters) mark the default after term + grace.
 *  Also used to resume a loan a killed run left open: timing comes from the loan on-chain. */
async function finishLoan(step, cfg) {
  const acct = step.borrower, who = account(acct);
  const loan = (await view(POOL, 'get_borrower', { account_id: acct })).loan;
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  if (step.defaults) {
    const at = BigInt(loan.due_at) + BigInt(cfg.grace_ns) + 5_000_000_000n;
    const waitMs = at > nowNs ? Number((at - nowNs) / 1_000_000n) : 0;
    console.log(`  ${acct} will not repay; marking the default in ${Math.round(waitMs / 1000)} s`); await sleep(waitMs);
    const d = await call(account(LENDER), POOL, 'mark_default', { borrower: acct }, { gas: 40n });
    if (!d.ok) throw new Error(`mark_default failed: ${d.error}`);
    console.log(`  default marked, reserve paid the pool first ${EXPLORER}${d.hash}`);
    return;
  }
  const at = BigInt(loan.issued_at) + BigInt(cfg.min_hold_ns) + 4_000_000_000n;
  await sleep((at > nowNs ? Number((at - nowNs) / 1_000_000n) : 0) + Math.floor(Math.random() * 20_000));
  const due = (BigInt(loan.principal) + BigInt(loan.interest)).toString();
  const rp = await call(who, USDC_ID, 'ft_transfer_call', { receiver_id: POOL, amount: due, msg: 'repay' }, { gas: 60n, deposit: 1n });
  if (!rp.ok || rp.receiptErrors.length) throw new Error(`repay failed for ${acct}: ${rp.error ?? rp.receiptErrors[0]}`);
  console.log(`  ${acct} repaid ${fmtUsd(due)} ${EXPLORER}${rp.hash}`);
}

/** What the chain says about a step, so a lost or stale state file never repeats a loan:
 *  'done', 'open' (a loan is active: finish it) or 'todo'. A first loan is done once the borrower has
 *  any closed loan; a second once they reached level 3 (each planned loan levels up: >= half the
 *  limit, held past the minimum hold); a defaulter once a default is on record. */
export function chainState(step, b) {
  if (step.kind === 'score') return b?.score ? 'done' : 'todo';
  if (b?.has_active_loan) return 'open';
  if (step.defaults) return (b?.defaults ?? 0) > 0 ? 'done' : 'todo';
  if (step.second) return (b?.level ?? 1) >= 3 ? 'done' : 'todo';
  return b?.loan ? 'done' : 'todo';
}

async function setup() {
  guard();
  if (!(await exists(PARENT)) || !hasKey(PARENT)) {
    throw new Error(`create the parent first (faucet, testnet): near account create-account sponsor-by-faucet-service ${PARENT} autogenerate-new-keypair save-to-legacy-keychain network-config testnet create`);
  }
  const parent = account(PARENT), relayer = account(RELAYER);
  // OutLayer mode: a borrower signs request_score itself and needs ~0.17 NEAR available (0.01 fee +
  // 150 Tgas at the pessimistic gas price; ~0.003 is spent per score). Top each borrower up to 0.25.
  const enclave = (await view(POOL, 'get_config')).scorer_mode === 'OutLayer';
  for (const acct of [LENDER, ...[...Array(24)].map((_, i) => id(i + 1))]) {
    if (!(await exists(acct))) { await createSubAccount(parent, acct.split('.')[0], '0.2'); console.log(`created ${acct}`); }
    if (enclave && acct !== LENDER) {
      const a = await near.provider.viewAccount({ accountId: acct });
      const free = BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n, want = 250n * 10n ** 21n;
      if (free < want) { await parent.transfer({ receiverId: acct, amount: want - free }); console.log(`topped up ${acct} for enclave scoring`); }
    }
    if (!(await view(USDC_ID, 'storage_balance_of', { account_id: acct }))) {
      const r = await call(parent, USDC_ID, 'storage_deposit', { account_id: acct, registration_only: true }, { deposit: 12_500_000_000_000_000_000_000n });
      if (!r.ok) throw new Error(`storage_deposit ${acct}: ${r.error}`);
    }
    const want = acct === LENDER ? 2_000_000_000n : 30_000_000n; // lender $2,000; borrowers $30 for interest
    const bal = BigInt(await view(USDC_ID, 'ft_balance_of', { account_id: acct }));
    if (bal < want) { const r = await call(relayer, USDC_ID, 'mint', { account_id: acct, amount: (want - bal).toString() }); if (!r.ok) throw new Error(`mint ${acct}: ${r.error}`); }
  }
  const lender = await view(POOL, 'get_lender', { account_id: LENDER });
  if (!lender || BigInt(lender.shares ?? '0') === 0n) {
    const r = await call(account(LENDER), USDC_ID, 'ft_transfer_call', { receiver_id: POOL, amount: '2000000000', msg: 'deposit' }, { gas: 60n, deposit: 1n });
    if (!r.ok || r.receiptErrors.length) throw new Error(`lender deposit: ${r.error ?? r.receiptErrors[0]}`);
    console.log(`${LENDER} deposited $2,000.00 ${EXPLORER}${r.hash}`);
  }
  const s = load(); if (!s.start) { s.start = Date.now(); save(s); }
  console.log(`setup done on ${POOL}; seeding day 0 starts ${new Date(s.start).toISOString()}`);
}

async function tick() {
  guard();
  const s = load();
  if (!s.start && process.env.SEED_START) { s.start = Date.parse(process.env.SEED_START); if (!s.start) throw new Error('SEED_START is not a date'); save(s); }
  if (!s.start) throw new Error('run setup first (or set SEED_START)');
  const cfg = await view(POOL, 'get_config');
  const day = DAY_MS ? Math.floor((Date.now() - s.start) / DAY_MS) : Infinity;
  const due = plan().filter((x) => x.day <= day && !s.done[x.i] && (!ONLY || ONLY.has(x.n)));
  console.log(`${POOL}: day ${day === Infinity ? 'all' : day}, ${due.length} step(s) due`);
  let loans = 0;
  for (const step of due) {
    if (step.kind === 'loan' && loans >= MAX_LOANS) break;
    try {
      const b = await view(POOL, 'get_borrower', { account_id: step.borrower }).catch(() => null);
      const st = chainState(step, b);
      if (st === 'done') { console.log(`  step ${step.i} (${step.borrower}) already on-chain, marked done`); s.done[step.i] = Date.now(); save(s); continue; }
      if (st === 'open') { console.log(`  ${step.borrower} has an open loan from an earlier run, finishing it`); await finishLoan(step, cfg); loans++; s.done[step.i] = Date.now(); save(s); continue; }
      if (step.kind === 'score') { const out = await scoreBorrower(step.n); console.log(`  ${step.borrower} scored band ${out.band} ${out.score} (band D: no loan, as the rules say)`); }
      else { await runLoan(step, cfg); loans++; }
      s.done[step.i] = Date.now(); save(s);
    } catch (e) { console.error(`  step ${step.i} (${step.borrower}) failed: ${e.message}`); break; }
  }
}

async function status() {
  const s = load(), steps = plan();
  console.log(`${POOL}: started ${s.start ? new Date(s.start).toISOString() : 'not yet'}, ${Object.keys(s.done).length} of ${steps.length} steps done`);
  const pool = await view(POOL, 'get_pool').catch(() => null);
  if (pool) console.log(`pool ${fmtUsd(pool.pool_value)}, reserve ${fmtUsd(pool.reserve)}`);
}

function printPlan(scoreCheck) {
  const steps = plan(), t = planTotals(steps);
  console.log(`Seeded demo plan: ${t.loans} loans (A ${t.byBand.A[0]}, B ${t.byBand.B[0]}, C ${t.byBand.C[0]}), ${t.loans - t.defaults} repaid, ${t.defaults} defaults (B ${t.byBand.B[1]}, C ${t.byBand.C[1]}), ${t.dScores} band D scores without a loan.`);
  for (const st of steps) {
    const c = inputsFor(st.n), e = estimate(c);
    console.log(`day ${st.day}  ${st.kind === 'score' ? 'score only' : st.defaults ? 'loan, DEFAULT' : st.second ? 'loan 2, repay' : 'loan, repay'}  ${st.borrower}  band ${st.band} (est. ${e.score})${st.kind === 'loan' ? `  ${Math.round(st.share * 100)}% of limit` : ''}  salary $${c.salary} x${c.months}, spends $${c.spending}, fees ${c.fees}, balance $${c.balance}`);
  }
  if (!scoreCheck) return;
  console.log('\nscore check (pinned demo scorer, Plaid sandbox, not submitted):');
  const wasm = join(ROOT, 'scorer', 'out', 'kredofi_scorer_demo.wasm');
  for (let n = 1; n <= 24; n++) {
    const acct = id(n), tag = createHash('sha256').update(acct).digest('hex').slice(0, 4);
    const r = spawnSync('wasmtime', ['run', '-S', 'http', '--env', 'PLAID_CLIENT_ID', '--env', 'PLAID_SECRET', '--env', 'SEAL_KEY', '--env', `NEAR_SENDER_ID=${acct}`, wasm],
      { input: JSON.stringify({ op: 'score', profile: customProfile(inputsFor(n), tag) }), encoding: 'utf8', timeout: 90_000 });
    let out = null; try { out = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* */ }
    const ok = out?.band === bandOfN(n);
    console.log(`${ok ? 'OK ' : 'BAD'} ${acct}: band ${out?.band ?? '?'} ${out?.score ?? (r.stderr || '').slice(0, 120)} (want ${bandOfN(n)}, est. ${estimate(inputsFor(n)).score})`);
  }
}

const cmd = process.argv[2] ?? 'plan';
if (/seed_ledger\.mjs$/.test(process.argv[1] ?? '')) try {
  if (cmd === 'plan') printPlan(process.argv.includes('--score-check'));
  else if (cmd === 'setup') await setup();
  else if (cmd === 'tick') await tick();
  else if (cmd === 'status') await status();
  else { console.error('usage: seed_ledger.mjs plan [--score-check] | setup | tick | status'); process.exit(2); }
} catch (e) { console.error(e.message); process.exit(1); }
