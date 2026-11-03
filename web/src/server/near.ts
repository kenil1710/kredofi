import 'server-only';
import { clientIpFrom } from './clientIp';
// Server-side NEAR access for the testnet API routes. Keys come from web/.env.local.
import { Account, FailoverRpcProvider, JsonRpcProvider, actions } from 'near-api-js';
import { KREDOFI_CONTRACT, NETWORK, RPC, USDC_CONTRACT } from '@/lib/config';

// Free RPC endpoints rate-limit (FastNEAR returns 429 under load), so fail over between providers.
// NEAR_RPC_URLS (comma-separated) overrides the list, e.g. with a paid key in production.
export const RPC_URLS = (process.env.NEAR_RPC_URLS?.split(',').map((u) => u.trim()).filter(Boolean)) ??
  [RPC, NETWORK === 'mainnet' ? 'https://rpc.mainnet.near.org' : 'https://rpc.testnet.near.org'];
export const provider = new FailoverRpcProvider(RPC_URLS.map((url) => new JsonRpcProvider({ url })));

/** Raw JSON-RPC with the same failover (for methods near-api-js doesn't wrap the way we need). */
export async function rpc<T = unknown>(method: string, params: unknown): Promise<T> {
  let last: unknown;
  for (const url of RPC_URLS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'kf', method, params }) });
      const j = await r.json();
      if (j.result !== undefined) return j.result as T;
      last = j.error;
    } catch (e) { last = e; }
  }
  throw new Error(`RPC ${method} failed: ${JSON.stringify(last)?.slice(0, 200)}`);
}

// One Account object per signer for the whole process: near-api-js keeps the next nonce in the
// Account's nonce manager, so a fresh Account per request re-read the nonce from the chain and two
// quick transactions (create account, then faucet, then a relayed deposit) could reuse one. The
// failover provider then reported "Exceeded 2 providers" instead of the retryable nonce error.
const accounts = new Map<string, Account>();
function account(idVar: string, keyVar: string) {
  const id = process.env[idVar], key = process.env[keyVar];
  if (!id || !key) throw new Error(`${idVar}/${keyVar} not configured`);
  let a = accounts.get(id);
  if (!a) { a = new Account(id, provider, key as `ed25519:${string}`); accounts.set(id, a); }
  return a;
}
export const scorerAccount = () => account('DEV_SCORER_ACCOUNT_ID', 'DEV_SCORER_KEY');
export const relayerAccount = () => account('RELAYER_ACCOUNT_ID', 'RELAYER_KEY');

export async function view<T = unknown>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return provider.callFunction({ contractId, method, args }) as Promise<T>;
}
export const viewPool = <T,>(method: string, args: Record<string, unknown> = {}) => view<T>(KREDOFI_CONTRACT, method, args);
export const viewUsdc = <T,>(method: string, args: Record<string, unknown> = {}) => view<T>(USDC_CONTRACT, method, args);

export type CallResult = { ok: boolean; hash?: string; error?: string; value?: unknown };

/** Send one function call; never throws on contract failure. */
/** `fast`: return once the transaction and its receipts have executed (EXECUTED_OPTIMISTIC), about
 * 2 s before finality. Used where the very next step only reads the result (testnet). */
export async function call(signer: Account, receiverId: string, method: string, args: object, gasTgas = 30n, deposit = 0n, fast = false): Promise<CallResult> {
  const res = await signer.signAndSendTransaction({
    receiverId, actions: [actions.functionCall(method, args, gasTgas * 10n ** 12n, deposit)], throwOnFailure: false, waitUntil: fast ? 'EXECUTED_OPTIMISTIC' : 'FINAL',
  });
  const hash = res.transaction_outcome?.id;
  const f = (res.status as { Failure?: { ActionError?: { kind?: { FunctionCallError?: { ExecutionError?: string } } } } })?.Failure;
  if (f) return { ok: false, hash, error: (f.ActionError?.kind?.FunctionCallError?.ExecutionError ?? JSON.stringify(f)).replace(/^Smart contract panicked: /, '') };
  return { ok: true, hash };
}

/** Below this the relayer stops funding demo accounts and fee top-ups (OutLayer mode, ENCLAVE_PLAN). */
export const RELAYER_FLOOR = 3n * 10n ** 24n;
let relayerCache = { at: 0, balance: null as bigint | null };
/** The relayer's spendable NEAR (cached 60 s), or null if it can't be read. */
export async function relayerBalance(): Promise<bigint | null> {
  if (Date.now() - relayerCache.at < 60_000) return relayerCache.balance;
  const id = process.env.RELAYER_ACCOUNT_ID;
  const a = id ? await rpc<{ amount: string; storage_usage: number }>('query', { request_type: 'view_account', finality: 'final', account_id: id }).catch(() => null) : null;
  relayerCache = { at: Date.now(), balance: a ? BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n : null };
  return relayerCache.balance;
}

/** True when the account exists on chain (the faucet refuses made-up ids). */
export async function accountExists(accountId: string): Promise<boolean> {
  return !!(await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId }).catch(() => null));
}

/** Testnet account ids only (named .testnet or 64-hex implicit). */
export function isTestnetAccount(id: unknown): id is string {
  return typeof id === 'string' && id.length <= 64 && (/^([a-z0-9]+[-_])*[a-z0-9]+(\.([a-z0-9]+[-_])*[a-z0-9]+)*\.testnet$/.test(id) || /^[0-9a-f]{64}$/.test(id));
}

const last = new Map<string, number>();
/** Simple per-key rate limit (in memory; enough for the testnet demo). */
export function rateLimited(key: string, ms: number): boolean {
  const now = Date.now(), t = last.get(key) ?? 0;
  if (now - t < ms) return true;
  last.set(key, now);
  return false;
}

const windows = new Map<string, number[]>();
/** At most `max` events per `ms` window for `key` (in memory). Returns true when over the limit. */
export function overQuota(key: string, max: number, ms: number): boolean {
  const now = Date.now(), list = (windows.get(key) ?? []).filter((t) => now - t < ms);
  if (list.length >= max) { windows.set(key, list); return true; }
  list.push(now); windows.set(key, list);
  return false;
}

/** The visitor's IP for rate limits (server/clientIp.ts: Worker header only with PROXY_SECRET). */
export function clientIp(req: Request): string {
  return clientIpFrom(req.headers);
}

/** Register `accountId` with test USDC (relayer pays storage) and top it up to `topUp` base units. */
export async function fundTestUsdc(accountId: string, topUp: bigint): Promise<string[]> {
  const relayer = relayerAccount();
  const txs: string[] = [];
  if ((await viewUsdc('storage_balance_of', { account_id: accountId })) === null) {
    const r = await call(relayer, USDC_CONTRACT, 'storage_deposit', { account_id: accountId, registration_only: true }, 30n, 12_500_000_000_000_000_000_000n);
    if (!r.ok) throw new Error(r.error);
    if (r.hash) txs.push(r.hash);
  }
  const bal = BigInt(await viewUsdc<string>('ft_balance_of', { account_id: accountId }));
  if (bal < topUp) {
    const r = await call(relayer, USDC_CONTRACT, 'mint', { account_id: accountId, amount: (topUp - bal).toString() });
    if (!r.ok) throw new Error(r.error);
    if (r.hash) txs.push(r.hash);
  }
  return txs;
}
