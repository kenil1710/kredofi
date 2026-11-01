// SPEC 8 demo, steps 1-5, on testnet (Dev mode), from the command line:
//
//   set -a; source .env; set +a      # PLAID_*, SEAL_KEY, PARTNER_PRIVKEY (never printed)
//   node scripts/demo.mjs
//
// 1. A lender deposits $1,000 (mock USDC); the pool shows its value.
// 2. Riya is scored inside the scorer (band A), borrows $100, waits the minimum hold, repays
//    $102 and reaches level 2 ($250 limit). Her browser key opens the private `reply`.
// 3. Sam is scored band D; borrowing is refused with a plain reason.
// 4. Fake scores are rejected: on_score is private; only dev_scorer may submit.
//    (dev_submit_score on mainnet is rejected too: shown on day 6 against the mainnet contract.)
// 5. Max (band A) borrows $100 and misses the due date; after due + grace anyone marks the
//    default; the reserve covers it; his name is released to the partner key; he is blocked.
//
// Frugal by design: accounts are reused between runs (each created once with 0.05 NEAR from
// the relayer), every call attaches 40 Tgas (tests/tests/gas_budget.rs), and finished steps
// are skipped on re-runs. Max can default only once; later runs show his recorded state.
import {
  POOL, USDC_ID, RELAYER, EXPLORER, YOCTO, NEAR, ROOT,
  account, call, view, exists, hasKey, createSubAccount, usd, fmtUsd, sleep,
} from './lib/near.mjs';
import { score as devScore, release as devRelease } from './dev_scorer.mjs';
import { keypair, openSealed } from './lib/seal.mjs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const GAS = 40n;
const ACCOUNT_NEAR = '0.05';
const ids = Object.fromEntries(['lender', 'riya', 'sam', 'max'].map((n) => [n, `${n}.${RELAYER}`]));
const inputs = { riya: 'good.json', sam: 'risky.json', max: 'cheater.json' };
const BORROWERS_DIR = join(ROOT, 'scorer', 'out', 'borrowers');
const relayer = account(RELAYER);
const links = [];

const say = (s) => console.log(s);
const step = (s) => console.log(`\n=== ${s}`);
const link = (label, r) => {
  if (r?.hash) {
    links.push(`${label}: ${EXPLORER}${r.hash}`);
    say(`   tx ${EXPLORER}${r.hash}`);
  }
};
const must = (label, r) => {
  link(label, r);
  if (!r.ok) throw new Error(`${label} failed: ${r.error}`);
  return r;
};
const ev = (r, name) => r.events.find((e) => e.event === name)?.data?.[0];
const nowNs = () => BigInt(Date.now()) * 1_000_000n;
const pool = () => view(POOL, 'get_pool');
const borrower = (id) => view(POOL, 'get_borrower', { account_id: id });
const balance = async (id) => BigInt(await view(USDC_ID, 'ft_balance_of', { account_id: id }));

async function waitUntilNs(targetNs, label) {
  const ms = Number((targetNs - nowNs()) / 1_000_000n) + 5_000; // + margin: chain time vs wall clock
  if (ms > 0) {
    say(`   waiting ${Math.ceil(ms / 1000)} s for ${label}...`);
    await sleep(ms);
  }
}

/** Create (once) and register an account; top up its test USDC to `usdMin`. */
async function ensureAccount(name, usdMin) {
  const id = ids[name];
  if (!(await exists(id))) {
    say(`   creating ${id} with ${ACCOUNT_NEAR} NEAR`);
    await createSubAccount(relayer, name, ACCOUNT_NEAR);
  } else if (!hasKey(id)) {
    throw new Error(`${id} exists but its key is not in ~/.near-credentials/testnet`);
  }
  if ((await view(USDC_ID, 'storage_balance_of', { account_id: id })) === null) {
    must(`register ${name}`, await call(relayer, USDC_ID, 'storage_deposit',
      { account_id: id, registration_only: true }, { deposit: NEAR / 80n })); // 0.0125, excess refunded
  }
  const have = await balance(id);
  const want = BigInt(usd(usdMin));
  if (have < want) {
    must(`mint ${name}`, await call(relayer, USDC_ID, 'mint', { account_id: id, amount: (want - have).toString() }));
  }
  return id;
}

async function ftCall(name, amount, msg) {
  return call(account(ids[name]), USDC_ID, 'ft_transfer_call',
    { receiver_id: POOL, amount, msg }, { gas: GAS, deposit: YOCTO });
}

async function borrow(name, amountUsd) {
  return call(account(ids[name]), POOL, 'borrow', { amount: usd(amountUsd) }, { gas: GAS, deposit: YOCTO });
}

async function scoreBorrower(name) {
  const reply = keypair(); // stands in for the borrower's browser key
  const { output, result, secs } = await devScore(ids[name], join(BORROWERS_DIR, inputs[name]), reply.public);
  say(`   scorer ran ${secs}s locally (pinned build) -> band ${output.band}, score ${output.score}, ` +
      `income cap ${fmtUsd(output.income_cap)}; output ${JSON.stringify(output).length} bytes`);
  must(`score ${name}`, result);
  const why = JSON.parse(openSealed(reply.secret, output.reply)).parts;
  say(`   private reply opened with ${name}'s key: ${JSON.stringify(why)}`);
  return output;
}

function showPool(p) {
  say(`   pool: value ${fmtUsd(p.pool_value)} (cash ${fmtUsd(p.cash)}, lent ${fmtUsd(p.outstanding)}), reserve ${fmtUsd(p.reserve)}`);
}

// ------------------------------------------------------------------ run
step('Setup: accounts (reused between runs) and the pinned scorer');
execFileSync('python3', [join(ROOT, 'scripts', 'gen_borrowers.py'), BORROWERS_DIR], { stdio: 'ignore' });
const cfg = await view(POOL, 'get_config');
say(`   contract ${POOL}, mode ${cfg.scorer_mode}, scorer_version ${cfg.scorer_version.slice(0, 16)}…`);
say(`   term ${Number(cfg.loan_term_ns) / 1e9}s, min hold ${Number(cfg.min_hold_ns) / 1e9}s, grace ${Number(cfg.grace_ns) / 1e9}s`);
if ((await pool()).reserve === '0') throw new Error('reserve not seeded: run scripts/testnet_setup.sh first');
await ensureAccount('lender', 0);
await ensureAccount('riya', 10); // SPEC 8a: 10 test USDC covers interest
await ensureAccount('sam', 0);
await ensureAccount('max', 0);

step('1. Lender deposits $1,000');
const lenderView = await view(POOL, 'get_lender', { account_id: ids.lender });
if (lenderView.shares === '0') {
  await ensureAccount('lender', 1000);
  const r = must('lender deposit', await ftCall('lender', usd(1000), 'deposit'));
  say(`   minted ${fmtUsd(ev(r, 'lender_deposit').shares)} shares`);
} else {
  say(`   lender already holds ${fmtUsd(lenderView.shares)} shares worth ${fmtUsd(lenderView.value)}`);
}
showPool(await pool());

step('2a. Riya: scored inside the scorer, borrows $100');
let riya = await borrower(ids.riya);
if (!riya?.has_active_loan) {
  await scoreBorrower('riya');
  riya = await borrower(ids.riya);
  say(`   level ${riya.level}, limit ${fmtUsd(riya.limit)}`);
  const r = must('riya borrow', await borrow('riya', 100));
  const l = ev(r, 'loan_issued');
  say(`   loan issued: ${fmtUsd(l.principal)} + ${fmtUsd(l.interest)} interest, due in ${Number(cfg.loan_term_ns) / 1e9}s`);
  riya = await borrower(ids.riya);
} else {
  say('   Riya already has an active loan from an earlier run; continuing with it');
}

step('5a. Max: scored band A, borrows $100 (his clock starts now)');
let max = await borrower(ids.max);
if (max?.blocked) {
  say('   Max already defaulted in an earlier run (blocked; his bank identity stays taken)');
} else if (!max?.has_active_loan) {
  await scoreBorrower('max');
  must('max borrow', await borrow('max', 100));
  max = await borrower(ids.max);
  say(`   Max owes ${fmtUsd(BigInt(max.loan.principal) + BigInt(max.loan.interest))}, due ${new Date(Number(BigInt(max.loan.due_at) / 1_000_000n)).toISOString().slice(11, 19)} UTC`);
}

step('2b. Riya waits the minimum hold, then repays $102');
await waitUntilNs(BigInt(riya.loan.issued_at) + BigInt(cfg.min_hold_ns), 'the minimum hold');
const due = BigInt(riya.loan.principal) + BigInt(riya.loan.interest);
const rr = must('riya repay', await ftCall('riya', due.toString(), 'repay'));
const rep = ev(rr, 'loan_repaid');
riya = await borrower(ids.riya);
say(`   repaid ${fmtUsd(due)}: ${fmtUsd(rep.to_pool)} to lenders, ${fmtUsd(rep.to_reserve)} to the reserve`);
say(`   leveled up: ${rep.leveled_up} -> level ${riya.level}, new limit ${fmtUsd(riya.limit)}` +
    (rep.leveled_up ? '' : ' (rule 13: loan under 50% of limit or second level-up within a term)'));
showPool(await pool());

step('3. Sam: band D, borrowing refused');
const samNow = await borrower(ids.sam);
if (!samNow?.score) await scoreBorrower('sam');
say(`   limit ${fmtUsd(await view(POOL, 'get_limit', { account_id: ids.sam }))}`);
const sb = await borrow('sam', 1);
link('sam borrow (refused)', sb);
say(`   borrow refused: ${!sb.ok} -> "${(sb.error || '').replace(/^Smart contract panicked: /, '')}"`);

step('4. Fake scores are rejected');
const fake = { v: 1, caller: ids.sam, band: 'A', score: 1000, income_cap: 1_000_000_000,
  fingerprint: 'ff'.repeat(32), sealed_identity: 'ZmFrZQ==' };
const f1 = await call(account(ids.sam), POOL, 'on_score', { borrower: ids.sam }, { gas: GAS });
link('fake on_score (rejected)', f1);
say(`   Sam calls on_score directly: rejected = ${!f1.ok} ("${(f1.error || '').replace(/^Smart contract panicked: /, '')}")`);
const f2 = await call(account(ids.sam), POOL, 'dev_submit_score', { borrower: ids.sam, output: fake }, { gas: GAS });
link('fake dev_submit_score (rejected)', f2);
say(`   Sam submits his own band-A output: rejected = ${!f2.ok} ("${(f2.error || '').replace(/^Smart contract panicked: /, '')}")`);
say(`   Sam's band is still ${(await borrower(ids.sam)).score.band}`);

step('5b. Max misses the due date; anyone marks the default');
max = await borrower(ids.max);
if (max.has_active_loan) {
  await waitUntilNs(BigInt(max.loan.due_at) + BigInt(cfg.grace_ns), 'due date + grace');
  let d;
  for (let i = 0; i < 6; i++) {
    d = await call(account(ids.lender), POOL, 'mark_default', { borrower: ids.max }, { gas: GAS });
    if (d.ok || !/not past due/.test(d.error)) break;
    await sleep(5_000); // chain time can trail the wall clock by a few seconds
  }
  must('mark_default', d);
  const e = ev(d, 'loan_defaulted');
  say(`   default recorded by the lender: reserve covered ${fmtUsd(e.covered_by_reserve)}, lenders lost ${fmtUsd(e.lender_loss)}`);
  showPool(await pool());
}

step('5c. Max\'s identity is released to the recovery partner');
if (await view(POOL, 'is_release_allowed', { account_id: ids.max })) {
  max = await borrower(ids.max);
  if (!max.pending_request) {
    must('request_identity_release', await call(account(ids.lender), POOL, 'request_identity_release', { borrower: ids.max }, { gas: GAS }));
  }
  const { result } = await devRelease(ids.max);
  must('dev_submit_release', result);
}
max = await borrower(ids.max);
if (max.released_identity && process.env.PARTNER_PRIVKEY) {
  say(`   partner opens the released identity with its key: "${openSealed(process.env.PARTNER_PRIVKEY, max.released_identity)}"`);
}
say(`   Max: blocked ${max.blocked}, defaults ${max.defaults}, limit ${fmtUsd(max.limit)}`);
const mb = await borrow('max', 1);
say(`   Max tries to borrow again: refused = ${!mb.ok} ("${(mb.error || '').replace(/^Smart contract panicked: /, '')}")`);

step('Done');
const stats = await view(POOL, 'get_stats');
say(`   stats A: ${JSON.stringify(stats.A)}`);
say(`   stats D: ${JSON.stringify(stats.D)}`);
console.log('\nTransactions:\n' + links.map((l) => `   ${l}`).join('\n'));
