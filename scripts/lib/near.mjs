// Shared testnet helpers for KredoFi scripts (near-api-js 7.4.0, tested in prep).
// Keys come from the NEAR CLI legacy keychain (~/.near-credentials/testnet/<id>.json),
// outside the repo. Keys are never printed or logged.
import { Account, JsonRpcProvider, KeyPair, actions } from 'near-api-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NET = 'testnet';
export const RPC = process.env.NEAR_RPC || 'https://test.rpc.fastnear.com';
export const POOL = 'kredofi.kency.testnet';
export const USDC_ID = 'musdc.kency.testnet';
export const SCORER = 'scorer.kency.testnet';
export const RELAYER = 'relayer.kency.testnet';
export const OWNER = 'kency.testnet';
export const USDC = 1_000_000n; // 6 decimals
export const TGAS = 1_000_000_000_000n;
export const YOCTO = 1n;
export const NEAR = 10n ** 24n;
export const EXPLORER = 'https://testnet.nearblocks.io/txns/';

export const provider = new JsonRpcProvider({ url: RPC });
const CRED_DIR = join(homedir(), '.near-credentials', NET);

export function hasKey(id) {
  return existsSync(join(CRED_DIR, `${id}.json`));
}

export function account(id) {
  const file = join(CRED_DIR, `${id}.json`);
  if (!existsSync(file)) throw new Error(`no key for ${id} in ~/.near-credentials/${NET}`);
  const { private_key } = JSON.parse(readFileSync(file, 'utf8'));
  return new Account(id, provider, private_key);
}

/** Save a new key in the same format and place as the NEAR CLI legacy keychain. */
export function saveKey(id, keyPair) {
  mkdirSync(CRED_DIR, { recursive: true });
  const file = join(CRED_DIR, `${id}.json`);
  writeFileSync(
    file,
    JSON.stringify({ account_id: id, public_key: keyPair.getPublicKey().toString(), private_key: keyPair.toString() }),
    { mode: 0o600 },
  );
}

export async function exists(id) {
  try {
    await provider.viewAccount({ accountId: id });
    return true;
  } catch {
    return false;
  }
}

export async function view(contractId, method, args = {}) {
  return provider.callFunction({ contractId, method, args });
}

function failureText(f) {
  const e = f?.ActionError?.kind?.FunctionCallError?.ExecutionError;
  return e || JSON.stringify(f);
}

/**
 * Call a change method and never throw on contract failure.
 * Returns { ok, value, logs, events, error, receiptErrors, hash }.
 * `ok` is the transaction result; `receiptErrors` lists failed receipts (e.g. a failed
 * ft_transfer handled by a rollback callback while the transaction itself succeeds).
 */
export async function call(signer, contractId, method, args, { gas = 30n, deposit = 0n } = {}) {
  const res = await signer.signAndSendTransaction({
    receiverId: contractId,
    actions: [actions.functionCall(method, args, gas * TGAS, deposit)],
    throwOnFailure: false,
    waitUntil: 'FINAL',
  });
  const logs = res.receipts_outcome.flatMap((r) => r.outcome.logs);
  const events = logs
    .filter((l) => l.startsWith('EVENT_JSON:'))
    .map((l) => JSON.parse(l.slice('EVENT_JSON:'.length)))
    .filter((e) => e.standard === 'kredofi');
  const receiptErrors = res.receipts_outcome
    .map((r) => r.outcome.status?.Failure)
    .filter(Boolean)
    .map(failureText);
  const hash = res.transaction_outcome?.id || res.transaction?.hash;
  if (res.status?.Failure) {
    return { ok: false, error: failureText(res.status.Failure), logs, events, receiptErrors, hash };
  }
  const raw = res.status?.SuccessValue;
  let value = null;
  if (raw) {
    const text = Buffer.from(raw, 'base64').toString();
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
  }
  return { ok: true, value, logs, events, receiptErrors, hash };
}

/** Create `<prefix>.<parent>` funded with `near` (string NEAR), key saved to the legacy keychain. */
export async function createSubAccount(parent, prefix, near) {
  const id = `${prefix}.${parent.accountId}`;
  const kp = KeyPair.fromRandom('ed25519');
  await parent.createSubAccount({ accountOrPrefix: prefix, publicKey: kp.getPublicKey(), nearToTransfer: toYocto(near) });
  saveKey(id, kp);
  return id;
}

export function toYocto(near) {
  const [whole, frac = ''] = String(near).split('.');
  return BigInt(whole) * NEAR + BigInt((frac + '0'.repeat(24)).slice(0, 24));
}

export const usd = (n) => (BigInt(Math.round(n * 1e6))).toString();
export const fmtUsd = (base) => `$${(Number(BigInt(base)) / 1e6).toFixed(2)}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
