import 'server-only';
// What /mainnet shows: public view calls on kredofi.near, read on the server. If the RPC doesn't answer, each
// fact falls back to the last value read by this server, then to the dated record below, so the page never
// shows an empty placeholder and always says which it is.
import { createHash } from 'node:crypto';
import { pickFacts, type Picked } from '@/lib/mainnetPick';
import type { PinConfig } from '@/lib/pin';

const RPC = 'https://rpc.mainnet.fastnear.com';
const CONTRACT = 'kredofi.near';
const DEV = '715363554c6216e50dbbffd81750f2c6b3b8551c4f3466fdf02eee85cc7543b0';

export type MainnetConfig = PinConfig & { scorer_mode: string; scorer_version: string; require_production_data?: boolean; production_data?: boolean; outlayer: string };
export type MainnetPool = { cash: string; outstanding: string; reserve: string; total_shares?: string };
export type MainnetBorrower = { score: { band: string; score: number; scorer_version: string; issued_at?: string } | null } | null;
export type MainnetValues = { cfg: MainnetConfig; pool: MainnetPool; dev: MainnetBorrower; codeSha: string };
export type MainnetFacts = Picked<MainnetValues>;

/** Read from kredofi.near on 5 Nov 2026. Update with every mainnet re-pin or contract deploy. */
export const MAINNET_RECORD: MainnetValues & { readAt: number } = {
  readAt: Date.UTC(2026, 10, 5, 14, 0),
  codeSha: '147d863d9413b1531eacec9dd5ad69a727837c9c0de10b270e3237306c5ed148',
  cfg: {
    scorer_mode: 'OutLayer',
    outlayer: 'outlayer.near',
    scorer_version: '6888c15e1442b508202141daf8cc246dddb9ecf5e586f1f0743671de7c23e6e2',
    require_production_data: true,
    production_data: false,
    scorer_delay_ns: '86400000000000',
    pending_scorer: { version: '5175182a13e3f3a8b737a8730524ca6f4a98575765784a0a4977fdf4151fa7ce', proposed_at: '1793877598813650059', apply_at: '1793963998813650059' },
  },
  pool: { cash: '0', outstanding: '0', reserve: '0', total_shares: '0' },
  dev: { score: { band: 'A', score: 1000, scorer_version: '6888c15e1442b508202141daf8cc246dddb9ecf5e586f1f0743671de7c23e6e2' } },
};

async function rpc<T>(params: object): Promise<T | null> {
  try {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'kf', method: 'query', params: { finality: 'final', ...params } }), next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return (j.result ?? null) as T | null;
  } catch { return null; }
}
async function view<T>(method: string, args: object = {}): Promise<T | null> {
  const r = await rpc<{ result: number[] }>({ request_type: 'call_function', account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  try { return r ? (JSON.parse(Buffer.from(r.result).toString()) as T) : null; } catch { return null; }
}

let lastGood: (MainnetValues & { readAt: number }) | null = null;

export async function mainnetFacts(): Promise<MainnetFacts> {
  const [cfg, pool, dev, code] = await Promise.all([
    view<MainnetConfig>('get_config'), view<MainnetPool>('get_pool'), view<MainnetBorrower>('get_borrower', { account_id: DEV }),
    rpc<{ code_base64: string }>({ request_type: 'view_code', account_id: CONTRACT }),
  ]);
  const codeSha = code ? createHash('sha256').update(Buffer.from(code.code_base64, 'base64')).digest('hex') : null;
  const read = cfg && pool && dev && codeSha ? { cfg, pool, dev, codeSha } : null;
  const facts = pickFacts<MainnetValues>(read, Date.now(), lastGood, MAINNET_RECORD);
  if (read) lastGood = facts;
  return facts;
}
