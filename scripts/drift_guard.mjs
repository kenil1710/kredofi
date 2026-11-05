// Daily drift guard until Nov 26 (SPEC 8d): real enclave scores on app.kency.testnet on fixed devcheck…
// accounts, failing if a band or score moves. Rolled sandbox dates silently moved 13 of 24 seed profiles on
// Nov 4; this is how we hear about the next one. Testnet only. /ledger tags these rows "Developer check".
//   node --experimental-strip-types scripts/drift_guard.mjs setup   # once, from this Mac: relayer creates and funds them
//   node --experimental-strip-types scripts/drift_guard.mjs check   # GitHub Actions (health-watch.yml) or locally
// `check` scores each account at most once per MIN_AGE_H (default 20) hours, so a 6-hourly schedule that
// GitHub thins out still gives one score a day, and a missed one is retried at the next run.
//   node --experimental-strip-types scripts/drift_guard.mjs count   # only the user_good count, no transaction, no keys
// Each day it also reads Plaid's user_good directly: the landing heading prints that count (SANDBOX_COUNT), so a
// change goes red here instead of leaving the page wrong.
// Needs PLAID_CLIENT_ID, PLAID_SECRET; keys in ~/.near-credentials/testnet (never printed).
import { actions } from 'near-api-js';
import { profileFor } from '../web/src/lib/borrowers.ts';
import { SANDBOX_COUNT } from '../web/src/lib/proofFacts.ts';
import { keypair, sealToken } from './lib/seal.mjs';

process.env.KREDOFI_CONTRACT ??= 'app.kency.testnet';
process.env.ALLOW_DEMO_CONTRACT = '1';
const near = await import('./lib/near.mjs');

const POOL = near.POOL, RELAYER = 'relayer.kency.testnet';
const TOKEN_PUBKEY = process.env.TOKEN_PUBKEY ?? '86658adaeb78fb559a0c3da3d7daa075cea6f3df23b6d8bd868610656ffc4078';
const MIN_AGE_MS = Number(process.env.MIN_AGE_H ?? 20) * 3_600_000;
const FUND_NEAR = '0.4'; // 0.17 must be available to sign; each score spends ~0.003, 22 days x 0.003 = 0.07

/** SPEC 6 demo table, plus the public sandbox login judges use (band only: Plaid owns its data). */
export const CHECKS = [
  { who: 'riya', account: `devcheck-riya.${RELAYER}`, band: 'A', score: 1000 },
  { who: 'sam', account: `devcheck-sam.${RELAYER}`, band: 'D', score: 270 },
  { who: 'max', account: `devcheck-max.${RELAYER}`, band: 'A', score: 1000 },
  { who: 'plaid', account: `devcheck-plaid.${RELAYER}`, band: 'B', score: null },
];

/** What is wrong with this score, or null. Pure, unit-tested. */
export function driftOf(check, score) {
  if (!score) return 'no score';
  if (score.band !== check.band) return `band ${score.band}, expected ${check.band}`;
  if (check.score !== null && Number(score.score) !== check.score) return `score ${score.score}, expected ${check.score}`;
  return null;
}
/** Due when there is no score yet, or the last one is older than minAgeMs. Pure, unit-tested. */
export const isDue = (borrower, nowMs, minAgeMs = MIN_AGE_MS) => !borrower?.score || nowMs - Number(borrower.score.issued_at) / 1e6 >= minAgeMs;

/** What differs between the count the landing page prints and a fresh read, or null. Pure, unit-tested. */
export function countDriftOf(expected, got) {
  if (got.transactions === expected.transactions && got.accounts === expected.accounts) return null;
  return `user_good has ${got.transactions} transactions in ${got.accounts} accounts; the landing page says ${expected.transactions} in ${expected.accounts} (web/src/lib/proofFacts.ts)`;
}

/**
 * Reads user_good the way Plaid hands it over, one fresh item per read, removed afterwards. Sandbox can flag the
 * history complete before its batch arrives (CLAUDE.md), so the total must also hold for STABLE_POLLS more polls;
 * a read that never settles throws rather than reporting a partial count. `post(path, body)` returns Plaid's JSON.
 */
const STABLE_POLLS = 3, MAX_POLLS = 60;
export async function readSandboxCount(post, sleep = near.sleep) {
  const { public_token } = await post('/sandbox/public_token/create', { institution_id: 'ins_109508', initial_products: ['transactions', 'identity'], options: { override_username: 'user_good', override_password: 'pass_good', transactions: { days_requested: 730 } } });
  const { access_token } = await post('/item/public_token/exchange', { public_token });
  try {
    const seen = new Set();
    let cursor = '', stable = 0, last = -1;
    for (let i = 0; i < MAX_POLLS; i++) {
      const r = await post('/transactions/sync', { access_token, cursor, count: 500 });
      for (const t of r.added) seen.add(t.transaction_id);
      cursor = r.next_cursor;
      if (r.has_more) continue;
      stable = r.transactions_update_status === 'HISTORICAL_UPDATE_COMPLETE' && seen.size === last ? stable + 1 : 0;
      last = seen.size;
      if (stable >= STABLE_POLLS) {
        const { accounts } = await post('/accounts/get', { access_token });
        return { transactions: seen.size, accounts: accounts.length };
      }
      await sleep(1500);
    }
    throw new Error(`user_good did not settle after ${MAX_POLLS} polls (${seen.size} so far)`);
  } finally {
    await post('/item/remove', { access_token }).catch(() => {});
  }
}

/** Plaid's error code only: bodies and tokens stay out of the logs. */
async function plaidPost(path, body) {
  const r = await (await fetch(`https://sandbox.plaid.com${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET }),
  })).json();
  if (r.error_code) throw new Error(`Plaid ${path}: ${r.error_code}`);
  return r;
}

/** Null when the count holds. One retry on a failed or different read: a slow sandbox is not drift. */
async function countProblem() {
  let problem = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const got = await readSandboxCount(plaidPost);
      console.log(`user_good: ${got.transactions} transactions, ${got.accounts} accounts (attempt ${attempt})`);
      problem = countDriftOf(SANDBOX_COUNT, got);
    } catch (e) { problem = `user_good count: ${e.message}`; console.log(`${problem} (attempt ${attempt})`); }
    if (!problem) return null;
  }
  return problem;
}

async function publicToken(check) {
  const options = check.who === 'plaid'
    ? { override_username: 'user_good', override_password: 'pass_good', transactions: { days_requested: 730 } }
    : { override_username: 'user_custom', override_password: JSON.stringify(profileFor(check.who, 'dcheck')), transactions: { days_requested: 730 } };
  const r = await (await fetch('https://sandbox.plaid.com/sandbox/public_token/create', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, institution_id: 'ins_109508', initial_products: ['transactions', 'identity'], options }),
  })).json();
  if (!r.public_token) throw new Error(`Plaid: ${r.error_code}`);
  return r.public_token;
}

/** One real request_score; resolves with the new on-chain score, or throws if none landed. */
async function score(check) {
  const before = (await near.view(POOL, 'get_borrower', { account_id: check.account }))?.score?.issued_at ?? '0';
  const sealed = sealToken(TOKEN_PUBKEY, check.account, await publicToken(check));
  const res = await near.account(check.account).signAndSendTransaction({ receiverId: POOL, waitUntil: 'INCLUDED', throwOnFailure: false,
    actions: [actions.functionCall('request_score', { public_token: sealed, reply_pubkey: keypair().public }, 150n * near.TGAS, 10n ** 22n)] });
  const hash = res.transaction_outcome?.id || res.transaction?.hash;
  const started = Date.now();
  for (let i = 0; i < 48; i++) {
    await near.sleep(2500);
    const b = await near.view(POOL, 'get_borrower', { account_id: check.account });
    if (b?.score && b.score.issued_at !== before) return { score: b.score, hash, seconds: Math.round((Date.now() - started) / 1000) };
    if (b && !b.pending_request && i > 4) break; // answered with score_failed
  }
  throw new Error(`no score landed: ${near.EXPLORER}${hash}`);
}

async function setup() {
  const relayer = near.account(RELAYER);
  for (const c of CHECKS) {
    if (await near.exists(c.account)) { console.log(`${c.account} exists`); continue; }
    await near.createSubAccount(relayer, c.account.split('.')[0], FUND_NEAR);
    console.log(`${c.account} created with ${FUND_NEAR} NEAR`);
  }
}

async function check() {
  const problems = [];
  // Same daily rhythm as the scores: counted when the user_good score is due (before the loop refreshes it).
  const plaid = CHECKS.find((c) => c.who === 'plaid');
  const countDue = isDue(await near.view(POOL, 'get_borrower', { account_id: plaid.account }).catch(() => null), Date.now());
  if (countDue) { const p = await countProblem(); if (p) problems.push(p); } else console.log('user_good count: done less than a day ago, skipped');
  for (const c of CHECKS) {
    const b = await near.view(POOL, 'get_borrower', { account_id: c.account }).catch(() => null);
    if (!isDue(b, Date.now())) { console.log(`${c.who}: scored less than ${MIN_AGE_MS / 3_600_000} h ago, skipped`); continue; }
    let out = null, error = null;
    for (let attempt = 1; attempt <= 2 && !out; attempt++) { // one retry: a slow bank is not drift
      try { out = await score(c); } catch (e) { error = e.message; console.log(`${c.who}: attempt ${attempt} failed: ${error}`); }
    }
    if (!out) { problems.push(`${c.who}: ${error}`); continue; }
    const drift = driftOf(c, out.score);
    console.log(`${c.who}: band ${out.score.band} ${out.score.score} in ${out.seconds} s ${near.EXPLORER}${out.hash}`);
    if (drift) problems.push(`${c.who}: ${drift}`);
  }
  if (problems.length) { for (const p of problems) console.log(`::error::drift guard ${p}`); process.exitCode = 1; } else console.log('no drift');
}

const cmd = process.argv[2];
if (/drift_guard\.mjs$/.test(process.argv[1] ?? '')) {
  if (cmd === 'setup') await setup();
  else if (cmd === 'check') await check();
  else if (cmd === 'count') { const p = await countProblem(); if (p) { console.log(`::error::drift guard ${p}`); process.exitCode = 1; } else console.log('count holds'); }
  else { console.error('usage: drift_guard.mjs setup | check | count'); process.exit(2); }
}
