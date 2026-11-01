// Day 6 follow-up checks on mainnet:
//  1. Open the private `reply` from the real OutLayer result with the borrower's key.
//  2. Negative test: calling OutLayer DIRECTLY (not via kredofi.near) with the kredofi secrets
//     profile and the release op must be refused, so nobody but the contract can decrypt names.
import { Account, JsonRpcProvider, actions } from 'near-api-js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openSealed } from './lib/seal.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const RPC = 'https://rpc.mainnet.fastnear.com';
const DEV = '715363554c6216e50dbbffd81750f2c6b3b8551c4f3466fdf02eee85cc7543b0';
const SCORE_TX = process.argv[2];
const provider = new JsonRpcProvider({ url: RPC });
const rpc = async (method, params) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
const near = (y) => (Number(BigInt(y) / 10n ** 15n) / 1e9).toFixed(6);

// 1. reply
const tx = await rpc('EXPERIMENTAL_tx_status', { tx_hash: SCORE_TX, sender_account_id: DEV, wait_until: 'FINAL' });
const resp = tx.receipts_outcome.find((r) => r.outcome.executor_id === 'outlayer.near' && r.outcome.status.SuccessValue?.length > 20);
const output = JSON.parse(Buffer.from(resp.outcome.status.SuccessValue, 'base64').toString());
console.log(`on-chain OutLayer output keys: ${Object.keys(output).sort().join(', ')} (${JSON.stringify(output).length} bytes)`);
const secret = readFileSync(join(ROOT, 'scorer/out/mainnet_reply.key'), 'utf8').trim();
console.log(`reply opened with the borrower's key: ${openSealed(secret, output.reply)}`);

// 2. direct call, bypassing the contract
const { private_key } = JSON.parse(readFileSync(join(homedir(), '.near-credentials/implicit', `${DEV}.json`), 'utf8'));
const dev = new Account(DEV, provider, private_key);
const cfg = await provider.callFunction({ contractId: 'kredofi.near', method: 'get_config', args: {} });
const before = BigInt((await provider.viewAccount({ accountId: DEV })).amount);
const res = await dev.signAndSendTransaction({
  receiverId: 'outlayer.near',
  actions: [actions.functionCall('request_execution', {
    source: { Project: { project_id: cfg.scorer_project, version_key: cfg.scorer_version } },
    resource_limits: { max_instructions: 1_000_000_000, max_memory_mb: 128, max_execution_seconds: 30 },
    input_data: JSON.stringify({ op: 'release', sealed: output.sealed_identity, partner_pubkey: cfg.partner_pubkey }),
    secrets_ref: { profile: 'kredofi', account_id: DEV },
    response_format: 'Json', payer_account_id: null, params: null,
  }, 100n * 10n ** 12n, 10n ** 22n)],
  waitUntil: 'FINAL', throwOnFailure: false,
});
const logs = res.receipts_outcome.flatMap((r) => r.outcome.logs);
const verdict = logs.find((l) => l.startsWith('Execution failed') || l.startsWith('Execution completed'));
const value = res.status?.SuccessValue !== undefined ? Buffer.from(res.status.SuccessValue, 'base64').toString() : JSON.stringify(res.status);
console.log(`\ndirect request_execution (release op, kredofi secrets): ${'https://nearblocks.io/txns/' + res.transaction.hash}`);
console.log(`  outlayer verdict: ${verdict?.slice(0, 220)}`);
console.log(`  returned to caller: ${value.slice(0, 80)}`);
console.log(`  cost: ${near(before - BigInt((await provider.viewAccount({ accountId: DEV })).amount))} NEAR`);
