// End-to-end check of day 10 against a running web server: a no-wallet lender gets 500 test USDC,
// deposits $100 through the relayer, and the deposit must show on /api/ledger within 5 s; then it
// withdraws through the relayer.   node scripts/e2e_lend.mjs [http://localhost:3000]
import { Account, JsonRpcProvider, KeyPair, actions, encodeSignedDelegate } from 'near-api-js';

const WEB = process.argv[2] || 'http://localhost:3000';
const provider = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' });
const POOL = 'kredofi.kency.testnet', USDC = 'musdc.kency.testnet';
const post = async (p, b) => { const r = await fetch(WEB + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { ok: r.ok, status: r.status, j: await r.json() }; };
const view = (c, m, a = {}) => provider.callFunction({ contractId: c, method: m, args: a });
function check(cond, msg) { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } console.log(`ok   ${msg}`); }

const kp = KeyPair.fromRandom('ed25519');
const c = await post('/api/demo', { publicKey: kp.getPublicKey().toString() });
check(c.ok, `demo lender ${c.j.accountId ?? c.j.error}`);
const id = c.j.accountId, acct = new Account(id, provider, kp.toString());
const f = await post('/api/faucet', { accountId: id, purpose: 'lend' });
check(f.ok && f.j.balance === '500000000', 'got 500 test USDC');
const again = await post('/api/faucet', { accountId: id, purpose: 'lend' });
check(again.status === 429, 'second 500 refused (once per account)');

async function relay(receiverId, method, args) {
  const { signedDelegate } = await acct.createSignedMetaTransaction({ receiverId, actions: [actions.functionCall(method, args, 40n * 10n ** 12n, 1n)] });
  return post('/api/relay', { signedDelegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64') });
}

await post('/api/ledger', {}).catch(() => {});
await fetch(WEB + '/api/ledger'); // warm the index
const dep = await relay(USDC, 'ft_transfer_call', { receiver_id: POOL, amount: '100000000', msg: 'deposit' });
const hash = dep.j.transaction_outcome?.id;
check(dep.ok && !dep.j.status?.Failure, `deposit $100 relayed: ${hash}`);
const t0 = Date.now();
let seenAt = null;
while (Date.now() - t0 < 15000) {
  const l = await (await fetch(WEB + '/api/ledger')).json();
  if (l.events.some((e) => e.txHash === hash && e.event === 'lender_deposit')) { seenAt = Date.now() - t0; break; }
  await new Promise((r) => setTimeout(r, 500));
}
check(seenAt !== null && seenAt <= 5000, `deposit on the public ledger ${seenAt} ms after confirmation (target 5 s)`);

const me = await view(POOL, 'get_lender', { account_id: id });
check(me.shares !== '0', `lender holds ${Number(me.shares) / 1e6} shares worth $${(Number(me.value) / 1e6).toFixed(2)}`);
const half = (BigInt(me.shares) / 2n).toString();
const wd = await relay(POOL, 'withdraw', { shares: half });
check(wd.ok && !wd.j.status?.Failure, `withdraw half relayed: ${wd.j.transaction_outcome?.id}`);
const bal = await view(USDC, 'ft_balance_of', { account_id: id });
check(BigInt(bal) >= 449_000_000n, `lender USDC back to $${(Number(bal) / 1e6).toFixed(2)}`);
const bad = await relay(POOL, 'withdraw_treasury', { amount: '1' });
check(bad.status === 403, `relayer refuses withdraw_treasury: "${bad.j.error}"`);
