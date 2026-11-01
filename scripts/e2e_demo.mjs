// End-to-end check of the no-wallet path (SPEC 8a) against a running web server, exactly as the
// browser does it: create a demo account, score Riya, borrow and repay through relayed meta
// transactions, and confirm the relayer refuses a call outside its allowlist.
//   node scripts/e2e_demo.mjs [http://localhost:3000]
import { Account, JsonRpcProvider, KeyPair, actions, encodeSignedDelegate } from 'near-api-js';
import { keypair, openSealed } from './lib/seal.mjs';

const WEB = process.argv[2] || 'http://localhost:3000';
const RPC = 'https://test.rpc.fastnear.com';
const POOL = 'kredofi.kency.testnet', USDC = 'musdc.kency.testnet';
const provider = new JsonRpcProvider({ url: RPC });
const post = async (path, body) => { const r = await fetch(WEB + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { ok: r.ok, status: r.status, j: await r.json() }; };
const view = (c, m, a = {}) => provider.callFunction({ contractId: c, method: m, args: a });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now(), secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
function check(cond, msg) { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } console.log(`ok   ${msg}`); }

const kp = KeyPair.fromRandom('ed25519');
const created = await post('/api/demo', { publicKey: kp.getPublicKey().toString() });
check(created.ok, `demo account created: ${created.j.accountId ?? created.j.error} (${secs()})`);
const id = created.j.accountId;
check((await view(USDC, 'ft_balance_of', { account_id: id })) === '10000000', 'demo account holds $10 test USDC');
const acct = new Account(id, provider, kp.toString());

async function relay(receiverId, method, args, deposit = 1n) {
  const { signedDelegate } = await acct.createSignedMetaTransaction({ receiverId, actions: [actions.functionCall(method, args, 40n * 10n ** 12n, deposit)] });
  return post('/api/relay', { signedDelegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64') });
}

const reply = keypair();
const sc = await post('/api/score', { accountId: id, borrower: 'riya', replyPubkey: reply.public });
check(sc.ok && sc.j.output.band === 'A', `scored band ${sc.j.output?.band ?? sc.j.error} (${secs()})`);
check(JSON.parse(openSealed(reply.secret, sc.j.output.reply)).parts.income === 250, 'browser key opens the private reply');

const nearBefore = (await provider.viewAccount({ accountId: id })).amount;
const br = await relay(POOL, 'borrow', { amount: '100000000' });
check(br.ok && !br.j.status?.Failure, `borrow $100 relayed: ${br.j.transaction?.hash ?? br.j.error} (${secs()})`);
const loan = (await view(POOL, 'get_borrower', { account_id: id })).loan;
check(loan?.state === 'Active' && loan.interest === '4000000', 'loan active, $4 interest');
check((await view(USDC, 'ft_balance_of', { account_id: id })) === '110000000', 'demo account received $100');

const bad = await relay(POOL, 'withdraw_treasury', { amount: '1' });
check(bad.status === 403, `relayer refuses withdraw_treasury: "${bad.j.error}"`);
const bad2 = await relay(USDC, 'ft_transfer_call', { receiver_id: 'kency.testnet', amount: '1', msg: 'repay' });
check(bad2.status === 403, `relayer refuses sending USDC elsewhere: "${bad2.j.error}"`);

const cfg = await view(POOL, 'get_config');
const holdUntil = Number(BigInt(loan.issued_at) / 1_000_000n) + Number(BigInt(cfg.min_hold_ns) / 1_000_000n) + 5000;
if (Date.now() < holdUntil) { console.log(`     waiting ${Math.ceil((holdUntil - Date.now()) / 1000)} s for the minimum hold`); await sleep(holdUntil - Date.now()); }
const rp = await relay(USDC, 'ft_transfer_call', { receiver_id: POOL, amount: '104000000', msg: 'repay' });
check(rp.ok && !rp.j.status?.Failure, `repay $104 relayed: ${rp.j.transaction?.hash ?? rp.j.error} (${secs()})`);
const b = await view(POOL, 'get_borrower', { account_id: id });
check(b.loan.state === 'Repaid' && b.level === 2 && b.limit === '250000000', `repaid; level ${b.level}, limit $${Number(b.limit) / 1e6}`);
const nearAfter = (await provider.viewAccount({ accountId: id })).amount;
check(BigInt(nearBefore) - BigInt(nearAfter) < 10n ** 18n, `demo account paid no gas (NEAR change ${(Number(BigInt(nearBefore) - BigInt(nearAfter)) / 1e24).toFixed(8)})`);
console.log(`\nRiya loop with no wallet: ${secs()} total (includes the ${Number(BigInt(cfg.min_hold_ns) / 1_000_000_000n)} s minimum hold)`);
