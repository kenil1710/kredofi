import 'server-only';
// Server-side NEAR access for the testnet API routes. Keys come from web/.env.local.
import { Account, JsonRpcProvider, actions } from 'near-api-js';
import { KREDOFI_CONTRACT, RPC, USDC_CONTRACT } from '@/lib/config';

export const provider = new JsonRpcProvider({ url: RPC });

function account(idVar: string, keyVar: string) {
  const id = process.env[idVar], key = process.env[keyVar];
  if (!id || !key) throw new Error(`${idVar}/${keyVar} not configured`);
  return new Account(id, provider, key as `ed25519:${string}`);
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
export async function call(signer: Account, receiverId: string, method: string, args: object, gasTgas = 30n, deposit = 0n): Promise<CallResult> {
  const res = await signer.signAndSendTransaction({
    receiverId, actions: [actions.functionCall(method, args, gasTgas * 10n ** 12n, deposit)], throwOnFailure: false, waitUntil: 'FINAL',
  });
  const hash = res.transaction_outcome?.id;
  const f = (res.status as { Failure?: { ActionError?: { kind?: { FunctionCallError?: { ExecutionError?: string } } } } })?.Failure;
  if (f) return { ok: false, hash, error: (f.ActionError?.kind?.FunctionCallError?.ExecutionError ?? JSON.stringify(f)).replace(/^Smart contract panicked: /, '') };
  return { ok: true, hash };
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

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
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
