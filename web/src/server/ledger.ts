import 'server-only';
// Public ledger index (DESIGN 3, 7.5). Two sources, both read from the chain:
//  1. FastNEAR's transaction index for the KredoFi account (full history, ~1-2 min behind);
//  2. transactions this server sends or relays, and wallet transactions the browser reports,
//     each re-read from the RPC right away, so a new row appears within seconds.
// Kept in memory and in a JSON file so a restart doesn't re-fetch everything.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { KREDOFI_CONTRACT, NETWORK } from '@/lib/config';
import { rpc } from './near';
import { eventsFromReceipts, settled, type LedgerEvent } from '@/lib/events';

const FASTNEAR = NETWORK === 'mainnet' ? 'https://tx.main.fastnear.com' : 'https://tx.test.fastnear.com';
const FILE = () => /* turbopackIgnore: true */ process.env.LEDGER_CACHE ?? '';
// pending: read while its receipts may still run (an OutLayer callback lands ~10-30 s later, a transfer
// callback a block or two later), so it is read again until it is old enough to be settled.
type Entry = { ts: number; events: LedgerEvent[]; pending?: boolean };
const CACHE_V = 3; // 2: events from failed receipts skipped (audit L4); 3: re-read unsettled txs (Nov 4)
const cache = new Map<string, Entry>();
let loaded = false, lastSync = 0, syncing: Promise<void> | null = null, changedAt = 0;
/** When the last transaction was recorded directly (cached answers older than this are stale). */
export const lastChange = () => changedAt;

async function load() {
  if (loaded) return; loaded = true;
  // The file names its contract: a cache from another contract (e.g. before a switch to a new
  // contract) is ignored, so its events never show on this ledger. Old files (no contract) were
  // written for kredofi.kency.testnet.
  try {
    const raw = JSON.parse(await readFile(/* turbopackIgnore: true */ FILE(), 'utf8')) as { v?: number; contract?: string; txs?: Record<string, Entry> } & Record<string, Entry>;
    if (raw.v !== CACHE_V) return; // older format (before failed receipts were skipped): rebuild from the index
    const contract = typeof raw.contract === 'string' ? raw.contract : 'kredofi.kency.testnet';
    const txs = raw.txs ?? (raw.contract ? {} : raw);
    if (contract === KREDOFI_CONTRACT) for (const [h, e] of Object.entries(txs)) cache.set(h, e as Entry);
  } catch { /* first run */ }
}
async function save() {
  if (!FILE()) return;
  try { await mkdir(dirname(/* turbopackIgnore: true */ FILE()), { recursive: true }); await writeFile(/* turbopackIgnore: true */ FILE(), JSON.stringify({ v: CACHE_V, contract: KREDOFI_CONTRACT, txs: Object.fromEntries(cache) })); } catch { /* best effort */ }
}

type FnTx = { transaction: { hash: string }; execution_outcome: { block_timestamp: number | string }; receipts: { execution_outcome: { block_timestamp?: number | string; outcome: { executor_id: string; logs: string[]; status?: unknown } } }[] };

async function fetchDetails(hashes: string[]) {
  for (let i = 0; i < hashes.length; i += 20) {
    const r = await fetch(`${FASTNEAR}/v0/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx_hashes: hashes.slice(i, i + 20) }) });
    const j = (await r.json()) as { transactions: (FnTx | null)[] };
    for (const t of j.transactions ?? []) {
      if (!t) continue;
      const ts = Math.round(Number(t.execution_outcome.block_timestamp) / 1e6);
      const receipts = t.receipts.map((x) => ({ executor_id: x.execution_outcome.outcome.executor_id, logs: x.execution_outcome.outcome.logs, status: x.execution_outcome.outcome.status }));
      cache.set(t.transaction.hash, { ts, events: eventsFromReceipts(receipts, KREDOFI_CONTRACT, t.transaction.hash, ts), pending: !settled(ts, Date.now()) });
    }
  }
}

/** Pull new transactions from the index (at most every 4 s). */
export async function sync(): Promise<void> {
  await load();
  if (Date.now() - lastSync < 4000) return syncing ?? undefined;
  lastSync = Date.now();
  syncing = (async () => {
    try {
      const r = await fetch(`${FASTNEAR}/v0/account`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: KREDOFI_CONTRACT }) });
      const j = (await r.json()) as { account_txs: { transaction_hash: string }[] };
      const missing = (j.account_txs ?? []).map((x) => x.transaction_hash).filter((h) => !cache.has(h) || cache.get(h)!.pending);
      if (missing.length) { await fetchDetails(missing); await save(); }
    } catch { /* index unavailable: serve what we have */ }
  })();
  await syncing; syncing = null;
}

/** Add one transaction now, read from the RPC (it needs the signer). */
export async function record(hash: string, signer: string): Promise<LedgerEvent[]> {
  await load();
  if (cache.has(hash) && !cache.get(hash)!.pending) return cache.get(hash)!.events;
  type Tx = { transaction_outcome: { block_hash: string }; receipts_outcome: { outcome: { executor_id: string; logs: string[]; status?: unknown } }[] };
  const res = await rpc<Tx>('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: signer, wait_until: 'FINAL' }).catch(() => null);
  if (!res) return [];
  const block = await rpc<{ header: { timestamp: number } }>('block', { block_id: res.transaction_outcome.block_hash }).catch(() => null);
  const ts = block ? Math.round(Number(block.header.timestamp) / 1e6) : Date.now();
  const receipts = res.receipts_outcome.map((x) => ({ executor_id: x.outcome.executor_id, logs: x.outcome.logs, status: x.outcome.status }));
  const events = eventsFromReceipts(receipts, KREDOFI_CONTRACT, hash, ts);
  cache.set(hash, { ts, events, pending: !settled(ts, Date.now()) });
  changedAt = Date.now();
  await save();
  return events;
}

/** Fire-and-forget helper for routes that just sent a transaction. */
export function recordSoon(hash: string | undefined, signer: string) {
  if (hash) record(hash, signer).catch(() => {});
}

export async function allEvents(): Promise<LedgerEvent[]> {
  await sync();
  return [...cache.values()].flatMap((e) => e.events).sort((a, b) => b.ts - a.ts || b.idx - a.idx);
}
