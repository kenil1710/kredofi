// Proof that OutLayer honours the contract's execution limit past 30 s: one real request_score on a fresh
// devcheck… account whose sandbox history misses the latest months, so the pinned scorer spends its whole
// re-poll budget. Prints the enclave run time from the chain. Testnet only; band doesn't matter.
//   set -a; source .env; set +a; ALLOW_DEMO_CONTRACT=1 KREDOFI_CONTRACT=app.kency.testnet node scripts/devcheck_long_run.mjs
import { readFileSync } from 'node:fs';
import { Account, JsonRpcProvider, actions } from 'near-api-js';
import { createDevcheckAccount } from './lib/devcheck.mjs';
import { keypair, sealToken } from './lib/seal.mjs';

const RPC = 'https://test.rpc.fastnear.com', POOL = 'app.kency.testnet';
const TOKEN_PUBKEY = '86658adaeb78fb559a0c3da3d7daa075cea6f3df23b6d8bd868610656ffc4078';
const rpc = async (method, params) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;

const { profile } = JSON.parse(readFileSync(new URL('../scorer/out/borrowers/good.json', import.meta.url), 'utf8'));
const months = [...new Set(profile.override_accounts[0].transactions.map((t) => t.date_transacted.slice(0, 7)))].sort();
const drop = months.slice(-Number(process.env.DROP_MONTHS ?? 2));
for (const a of profile.override_accounts) a.transactions = a.transactions.filter((t) => !drop.includes(t.date_transacted.slice(0, 7)));
// PAD copies of the remaining history make Plaid slower still; dates stay inside the kept months.
for (const a of profile.override_accounts) a.transactions = Array.from({ length: Number(process.env.PAD ?? 1) }, () => a.transactions).flat();
const pt = await (await fetch('https://sandbox.plaid.com/sandbox/public_token/create', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, institution_id: 'ins_109508',
    initial_products: ['transactions', 'identity'],
    options: { override_username: 'user_custom', override_password: JSON.stringify(profile), transactions: { days_requested: 730 } } }),
})).json();
if (!pt.public_token) throw new Error(`Plaid: ${pt.error_code}`);

const demo = await createDevcheckAccount();
const acct = new Account(demo.accountId, new JsonRpcProvider({ url: RPC }), demo.secretKey);
const out = await acct.signAndSendTransaction({ receiverId: POOL, waitUntil: 'INCLUDED', throwOnFailure: false,
  actions: [actions.functionCall('request_score', { public_token: sealToken(TOKEN_PUBKEY, demo.accountId, pt.public_token), reply_pubkey: keypair().public }, 150n * 10n ** 12n, 10n ** 22n)] });
const hash = out?.transaction?.hash ?? out?.transaction_outcome?.id;
if (!hash) throw new Error('request_score not sent');
let tx, hit;
for (let i = 0; i < 60 && !hit; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  tx = await rpc('tx', { tx_hash: hash, sender_account_id: demo.accountId, wait_until: 'EXECUTED_OPTIMISTIC' });
  hit = (tx?.receipts_outcome ?? []).filter((r) => r.outcome.executor_id === POOL).flatMap((r) => r.outcome.logs.map((l) => [r, l])).filter(([, l]) => l.startsWith('EVENT_JSON:')).map(([r, l]) => [r, JSON.parse(l.slice(11))]).find(([, e]) => /score_(issued|failed)/.test(e.event));
}
const time = async (h) => BigInt((await rpc('block', { block_id: h })).header.timestamp);
const secs = hit ? Number((await time(hit[0].block_hash) - await time(tx.transaction_outcome.block_hash)) / 1_000_000n) / 1000 : null;
const usage = tx.receipts_outcome.flatMap((r) => r.outcome.logs).find((l) => l.includes('time_ms'))?.match(/time_ms: (\d+)/)?.[1];
console.log(JSON.stringify({ account: demo.accountId, hash, dropped: drop, enclaveMs: usage ? Number(usage) : null, seconds: secs, event: hit?.[1].event, band: hit?.[1].data?.[0]?.band, reason: hit?.[1].data?.[0]?.reason }));
