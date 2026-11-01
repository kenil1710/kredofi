// Read-only chain access from the browser (JSON-RPC view calls; no signing, no keys).
import { KREDOFI_CONTRACT, RPC, USDC_CONTRACT } from './config';

export async function view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  const res = await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'kf', method: 'query', params: {
      request_type: 'call_function', finality: 'optimistic', account_id: contractId, method_name: method,
      args_base64: btoa(JSON.stringify(args)),
    } }),
  });
  const j = await res.json();
  if (j.error || j.result?.error) throw new Error(j.error?.data ?? j.result?.error ?? 'RPC error');
  return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) as T;
}

export type ScoreView = { band: 'A' | 'B' | 'C' | 'D'; score: number; income_cap: string; fingerprint: string; issued_at: string; expires_at: string; scorer_version: string; expired: boolean };
export type LoanView = { principal: string; interest: string; limit_at_borrow: string; band: string; issued_at: string; due_at: string; state: 'Active' | 'Repaid' | 'Defaulted' };
export type BorrowerView = { level: number; last_level_up: string; score: ScoreView | null; pending_request: boolean; defaults: number; blocked: boolean; has_active_loan: boolean; loan: LoanView | null; released_identity: string | null; limit: string };
export type PoolView = { cash: string; outstanding: string; total_shares: string; reserve: string; treasury: string; pool_value: string };
export type ConfigView = { scorer_mode: 'Dev' | 'OutLayer'; scorer_version: string; loan_term_ns: string; grace_ns: string; min_hold_ns: string; max_borrower_share_bps: number; partner_pubkey: string };

export const getBorrower = (id: string) => view<BorrowerView | null>(KREDOFI_CONTRACT, 'get_borrower', { account_id: id });
export const getPool = () => view<PoolView>(KREDOFI_CONTRACT, 'get_pool');
export const getConfig = () => view<ConfigView>(KREDOFI_CONTRACT, 'get_config');
export const usdcBalance = (id: string) => view<string>(USDC_CONTRACT, 'ft_balance_of', { account_id: id });
