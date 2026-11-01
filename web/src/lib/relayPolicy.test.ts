import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDelegate, isDemoAccount, type DecodedDelegate } from './relayPolicy.ts';

const cfg = { relayer: 'relayer.kency.testnet', kredofi: 'kredofi.kency.testnet', usdc: 'musdc.kency.testnet' };
const SENDER = 'demo1793600000000.relayer.kency.testnet';
const enc = (o: object) => new TextEncoder().encode(JSON.stringify(o));
const call = (receiverId: string, methodName: string, args: object, deposit = 1n, gas = 40n * 10n ** 12n, senderId = SENDER): DecodedDelegate =>
  ({ senderId, receiverId, actions: [{ functionCall: { methodName, args: enc(args), gas, deposit } }] });

test('allowed calls', () => {
  assert.equal(checkDelegate(call(cfg.kredofi, 'borrow', { amount: '100000000' }), cfg), null);
  assert.equal(checkDelegate(call(cfg.usdc, 'ft_transfer_call', { receiver_id: cfg.kredofi, amount: '104000000', msg: 'repay' }), cfg), null);
  assert.equal(checkDelegate(call(cfg.usdc, 'ft_transfer_call', { receiver_id: cfg.kredofi, amount: '5', msg: 'deposit' }), cfg), null);
  assert.equal(checkDelegate(call(cfg.usdc, 'storage_deposit', {}, 1_250_000_000_000_000_000_000n), cfg), null);
  assert.equal(checkDelegate(call(cfg.kredofi, 'withdraw', { shares: '400000000' }), cfg), null);
  assert.match(checkDelegate(call(cfg.kredofi, 'withdraw', { shares: 'all' }), cfg)!, /Invalid shares/);
});

test('refused: not a demo account, wrong contract, wrong method', () => {
  assert.match(checkDelegate(call(cfg.kredofi, 'borrow', { amount: '1' }, 1n, 1n, 'kency.testnet'), cfg)!, /demo accounts/);
  assert.match(checkDelegate(call(cfg.kredofi, 'borrow', { amount: '1' }, 1n, 1n, 'demo123.evil.testnet'), cfg)!, /demo accounts/);
  assert.match(checkDelegate(call('wrap.testnet', 'near_deposit', {}), cfg)!, /only calls KredoFi/);
  for (const m of ['mark_default', 'set_grace_ns', 'withdraw_treasury', 'treasury_to_reserve', 'dev_submit_score', 'migrate']) {
    assert.match(checkDelegate(call(cfg.kredofi, m, {}), cfg)!, /does not call/, m);
  }
  assert.match(checkDelegate(call(cfg.usdc, 'ft_transfer', { receiver_id: 'x.testnet', amount: '1' }), cfg)!, /does not call/);
  assert.match(checkDelegate(call(cfg.usdc, 'mint', { account_id: SENDER, amount: '1' }), cfg)!, /does not call/);
});

test('refused: USDC to anyone but KredoFi, odd messages, deposits, gas, multiple or non-call actions', () => {
  assert.match(checkDelegate(call(cfg.usdc, 'ft_transfer_call', { receiver_id: 'thief.testnet', amount: '1', msg: 'repay' }), cfg)!, /only be sent to KredoFi/);
  assert.match(checkDelegate(call(cfg.usdc, 'ft_transfer_call', { receiver_id: cfg.kredofi, amount: '1', msg: 'seed_reserve' }), cfg)!, /repay or deposit/);
  assert.match(checkDelegate(call(cfg.kredofi, 'borrow', { amount: '1' }, 2n), cfg)!, /1 yoctoNEAR/);
  assert.match(checkDelegate(call(cfg.kredofi, 'borrow', { amount: '1' }, 1n, 300n * 10n ** 12n), cfg)!, /gas/);
  assert.match(checkDelegate(call(cfg.usdc, 'storage_deposit', {}, 10n ** 24n), cfg)!, /too large/);
  const two = call(cfg.kredofi, 'borrow', { amount: '1' });
  two.actions.push(two.actions[0]);
  assert.match(checkDelegate(two, cfg)!, /One action/);
  assert.match(checkDelegate({ senderId: SENDER, receiverId: cfg.kredofi, actions: [{ transfer: { deposit: 1n } }] }, cfg)!, /Only contract calls/);
  assert.match(checkDelegate({ senderId: SENDER, receiverId: cfg.kredofi, actions: [{ addKey: {} }] }, cfg)!, /Only contract calls/);
});

test('demo account pattern', () => {
  assert.ok(isDemoAccount(SENDER, cfg.relayer));
  assert.ok(!isDemoAccount('demo.relayer.kency.testnet', cfg.relayer));
  assert.ok(!isDemoAccount('riya.relayer.kency.testnet', cfg.relayer));
  assert.ok(!isDemoAccount('demo1793600000000.x.relayer.kency.testnet', cfg.relayer));
});
