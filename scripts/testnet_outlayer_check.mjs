// TESTNET ONLY: one real request_score through OutLayer testnet (Nov 3 check: do testnet workers run
// our scorer for a contract in OutLayer mode?). Copy of scripts/mainnet_score.mjs with testnet RPC,
// a throwaway OutLayer-mode contract and a faucet borrower.
//
//   set -a; source .env; set +a      # PLAID_CLIENT_ID, PLAID_SECRET (sandbox), never printed
//   OL_CONTRACT=<throwaway>.testnet OL_BORROWER=<faucet account>.testnet node scripts/testnet_outlayer_check.mjs
//
// The borrower's key is in ~/.near-credentials/testnet. The bank data is a Plaid
// SANDBOX custom user (Riya's profile); the public token is created here, which is what the web
// app's Plaid Link step will produce. The contract forwards the 0.01 NEAR fee to OutLayer with
// payer_account_id = borrower, so any unused part must come back to the borrower: the script lists
// every receipt so the refund recipient is read from the chain, not inferred.
import { Account, JsonRpcProvider, actions } from 'near-api-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { keypair, openSealed } from './lib/seal.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const RPC = 'https://test.rpc.fastnear.com';
const DEV = process.env.OL_BORROWER;
const POOL = process.env.OL_CONTRACT;
if (!/\.testnet$/.test(POOL ?? '') || !/\.testnet$/.test(DEV ?? '')) throw new Error('testnet only: set OL_CONTRACT and OL_BORROWER to .testnet accounts');
const FEE = 10n ** 22n; // 0.01 NEAR
const EXPLORER = 'https://testnet.nearblocks.io/txns/';
const provider = new JsonRpcProvider({ url: RPC });
const near = (y) => (Number(BigInt(y) / 10n ** 15n) / 1e9).toFixed(6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
};
const balance = async (id) => BigInt((await provider.viewAccount({ accountId: id })).amount);
const view = (method, args) => provider.callFunction({ contractId: POOL, method, args });

// 1. Plaid sandbox public token for Riya's custom profile (same as the demo builds use).
for (const k of ['PLAID_CLIENT_ID', 'PLAID_SECRET']) if (!process.env[k]) throw new Error(`${k} not set`);
const { profile } = JSON.parse(readFileSync(join(ROOT, 'scorer/out/borrowers/good.json'), 'utf8'));
const pt = await (await fetch('https://sandbox.plaid.com/sandbox/public_token/create', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET,
    institution_id: 'ins_109508', initial_products: ['transactions', 'identity'],
    options: { override_username: 'user_custom', override_password: JSON.stringify(profile),
               transactions: { days_requested: 730 } },
  }),
})).json();
if (!pt.public_token) throw new Error(`Plaid: ${pt.error_code}`);
console.log(`Plaid sandbox public token created (single-use, 30 min): ${pt.public_token.slice(0, 24)}…`);

// 2. Borrower's browser key for the private reply.
const reply = keypair();
mkdirSync(join(ROOT, 'scorer/out'), { recursive: true });
writeFileSync(join(ROOT, 'scorer/out/testnet_ol_reply.key'), reply.secret, { mode: 0o600 });

// 3. request_score from the dev account (signer == predecessor == borrower).
const { private_key } = JSON.parse(readFileSync(join(homedir(), '.near-credentials/testnet', `${DEV}.json`), 'utf8'));
const dev = new Account(DEV, provider, private_key);
const before = await balance(DEV);
console.log(`borrower ${DEV.slice(0, 10)}… balance before: ${near(before)} NEAR`);
const sent = await dev.signAndSendTransaction({
  receiverId: POOL,
  actions: [actions.functionCall('request_score',
    { public_token: pt.public_token, reply_pubkey: reply.public }, 150n * 10n ** 12n, FEE)],
  waitUntil: 'INCLUDED',
  throwOnFailure: false,
});
const hash = sent.transaction?.hash || sent.transaction_outcome?.id;
console.log(`request_score sent: ${EXPLORER}${hash}`);

// 4. Wait for on_score (OutLayer yields, a worker runs the TEE, then resumes the callback).
let b;
for (let i = 0; i < 60; i++) {
  await sleep(5000);
  b = await view('get_borrower', { account_id: DEV });
  if (b && !b.pending_request) break;
  process.stdout.write('.');
}
console.log('');
const tx = await rpc('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: DEV, wait_until: 'FINAL' });

console.log('\nReceipts:');
for (const r of tx.receipts_outcome) {
  const rc = tx.receipts.find((x) => x.receipt_id === r.id);
  const acts = (rc?.receipt?.Action?.actions || []).map((a) =>
    a.Transfer ? `Transfer ${near(a.Transfer.deposit)} NEAR` :
    a.FunctionCall ? `${a.FunctionCall.method_name}(${near(a.FunctionCall.deposit)} NEAR)` : Object.keys(a)[0]);
  const st = r.outcome.status;
  const status = st.SuccessValue !== undefined ? `ok ${Buffer.from(st.SuccessValue, 'base64').toString().slice(0, 60)}`
    : st.Failure ? `FAIL ${JSON.stringify(st.Failure).slice(0, 120)}` : Object.keys(st)[0];
  console.log(`  ${rc?.predecessor_id?.slice(0, 16) ?? '?'} -> ${r.outcome.executor_id.slice(0, 16)}: ${acts.join(', ') || '(data/system)'} | ${status}`);
  for (const l of r.outcome.logs) console.log(`      log: ${l.slice(0, 300)}`);
}
const refunds = tx.receipts.filter((x) => x.predecessor_id === 'outlayer.testnet' && x.receiver_id === DEV &&
  x.receipt.Action?.actions?.some((a) => a.Transfer));
const refundTotal = refunds.flatMap((x) => x.receipt.Action.actions).reduce((s, a) => s + BigInt(a.Transfer?.deposit || 0), 0n);
const toContract = tx.receipts.filter((x) => x.predecessor_id === 'outlayer.testnet' && x.receiver_id === POOL &&
  x.receipt.Action?.actions?.some((a) => a.Transfer && BigInt(a.Transfer.deposit) > 0n));

await sleep(3000);
const after = await balance(DEV);
console.log(`\nOutLayer -> borrower refund transfers: ${refunds.length}, total ${near(refundTotal)} NEAR`);
console.log(`OutLayer -> contract value transfers: ${toContract.length}`);
console.log(`borrower balance after: ${near(after)} NEAR (spent ${near(before - after)} NEAR incl. gas and fee)`);
console.log(`\nBorrower view: ${JSON.stringify(b)}`);
if (b?.score) {
  const scoreTx = tx.receipts_outcome.flatMap((r) => r.outcome.logs).find((l) => l.includes('score_issued') || l.includes('score_failed'));
  console.log(`event: ${scoreTx}`);
}
// The reply travelled inside the OutLayer result to on_score; find it in the callback's input.
const onScore = tx.receipts.find((x) => x.receipt.Action?.actions?.some((a) => a.FunctionCall?.method_name === 'on_score'));
console.log(`on_score receipt: ${onScore?.receipt_id}`);
