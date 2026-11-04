// /mainnet: live proof of what kredofi.near runs, read with public view calls (no wallet, no keys).
// The site stays on testnet; this page only reads mainnet. Cached for a minute.
import type { Metadata } from 'next';
import Link from 'next/link';
import { createHash } from 'node:crypto';
import { AppChrome } from '@/components/AppChrome';
import { AppFooter } from '@/components/AppFooter';
import { GuillocheStrip } from '@/components/GuillocheStrip';
import { pendingScorerText, type PinConfig } from '@/lib/pin';

export const metadata: Metadata = { title: 'Mainnet proof, KredoFi', description: 'What kredofi.near runs right now: contract version, pinned enclave scorer, real scores, and why lender deposits are locked.' };
export const revalidate = 60;

const RPC = 'https://rpc.mainnet.fastnear.com';
const CONTRACT = 'kredofi.near';
const DEV = '715363554c6216e50dbbffd81750f2c6b3b8551c4f3466fdf02eee85cc7543b0';
/** Contract builds this repository has tested and deployed (code SHA-256 -> name). */
const KNOWN_CODE: Record<string, string> = {
  '147d863d9413b1531eacec9dd5ad69a727837c9c0de10b270e3237306c5ed148': 'v4 (security review 2 fixes, 24 h time lock on scorer re-pins)',
  b7f55eaf89b2d592d1684293f5ec59d02b39e5d8e776319c65381cef94b0691c: 'v3 (3 Nov 2026: security review fixes, deposits gated)',
  '339a94ea36e49d91c60317c0e4c3dd03f14bb6eab9b19d770dc0aa231da21d86': 'v2 (1 Nov 2026)',
};
const WASM_URL = 'https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/6db115961a822664fdef8c8d19f02668b6f67e92/kredofi_scorer.wasm';
const NB = 'https://nearblocks.io/txns/';
const SCORES = [
  { tx: '3nbdkFd3uNeeoYhqmE2AQHuRMXLZYbDhEZAUzsVDFGzo', when: '3 Nov 2026', scorer: '6888c15e', note: 'band A, 1,000, 8.5 s in the enclave; bank token sealed to the scorer' },
  { tx: 'CNsoyGSj6aXtUmGzxUisxERirsv9jAsAZQ7GKVj7Udb7', when: '2 Nov 2026', scorer: '7048cc92', note: 'band A, 1,000, 7.6 s' },
  { tx: '4dgHrA97KfibKifZuVZ2YF5zoAVCy4m2pXxxf9zdijyu', when: '1 Nov 2026', scorer: '87ceab66', note: 'band A, 1,000, first mainnet score' },
];
const CHANGES = [
  { tx: 'Gj3X9axsGU2ctvrsPLo3Uhn93YzbL9XYRtC15fHPEp5c', what: 'Contract v4 deployed and migrated (4 Nov: security review 2 fixes, 24 h time lock on scorer re-pins)' },
  { tx: '2zyjvpPaybW9nUjpzQksbPVsgmHRxhmMWHkJ24VsSUAu', what: 'Contract v3 deployed and migrated (3 Nov)' },
  { tx: '2acP4tWJVNQDYeqD66kwrMcFa1XfReAffuU4qyk7VxkG', what: 'Scorer 6888c15e… pinned' },
  { tx: 'EhEiZGuqK7o7UEg7EbUq2GsRVT6YMJv6mYgnGcKaJqrt', what: 'Scorer secrets locked to that build, called from kredofi.near' },
];

async function rpc<T>(params: object): Promise<T | null> {
  try {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'kf', method: 'query', params: { finality: 'final', ...params } }), next: { revalidate: 60 } });
    const j = await r.json();
    return (j.result ?? null) as T | null;
  } catch { return null; }
}
async function view<T>(method: string, args: object = {}): Promise<T | null> {
  const r = await rpc<{ result: number[] }>({ request_type: 'call_function', account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  try { return r ? (JSON.parse(Buffer.from(r.result).toString()) as T) : null; } catch { return null; }
}

type Config = PinConfig & { scorer_mode: string; scorer_version: string; require_production_data?: boolean; production_data?: boolean; outlayer: string };
type Pool = { cash: string; outstanding: string; reserve: string; total_shares: string };
type Borrower = { score: { band: string; score: number; scorer_version: string; issued_at: string } | null } | null;

export default async function Mainnet() {
  const [cfg, pool, dev, code] = await Promise.all([
    view<Config>('get_config'), view<Pool>('get_pool'), view<Borrower>('get_borrower', { account_id: DEV }),
    rpc<{ code_base64: string }>({ request_type: 'view_code', account_id: CONTRACT }),
  ]);
  const codeSha = code ? createHash('sha256').update(Buffer.from(code.code_base64, 'base64')).digest('hex') : null;
  const locked = cfg ? !!cfg.require_production_data && !cfg.production_data : null;
  const usd = (v?: string) => (v ? `$${(Number(v) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—');
  const live = !!cfg;
  return (
    <div className="g-paper" style={{ minHeight: '100svh' }}>
      <AppChrome />
      <main className="wrap trust mainnet">
        <article className="doc">
          <GuillocheStrip height={12} />
          <p className="doc-kicker">Mainnet proof</p>
          <h1>What kredofi.near runs, right now.</h1>
          <p className="doc-summary">This site is a testnet demo. This page reads the mainnet contract live, with public view calls (no wallet). {live ? 'Read within the last minute.' : 'The mainnet RPC did not answer just now; the links below still work.'}</p>

          <section className="mn-note" aria-label="kredofi.near">
            <div className="mn-head"><span className="mn-serial">kredofi.near</span><span className={`mn-stamp ${locked ? 'locked' : ''}`}>{locked === null ? '…' : locked ? 'Deposits locked' : 'Deposits open'}</span></div>
            <dl className="mn-grid">
              <dt>Contract version</dt><dd>{codeSha ? (KNOWN_CODE[codeSha] ?? 'unknown build') : '…'}{codeSha && <><br /><code>{codeSha}</code></>}</dd>
              <dt>Scorer mode</dt><dd>{cfg ? (cfg.scorer_mode === 'OutLayer' ? <>OutLayer, inside Intel TDX (<code>{cfg.outlayer}</code>)</> : cfg.scorer_mode) : '…'}</dd>
              <dt>Pinned scorer</dt><dd>{cfg ? <code>{cfg.scorer_version}</code> : '…'}</dd>
              <dt>Pending scorer change</dt><dd>{pendingScorerText(cfg, Date.now())}</dd>
              <dt>Lender deposits</dt><dd>{locked === null ? '…' : locked ? <><b>Locked until real bank data</b> (<code>production_data</code> off). Scores still use Plaid&apos;s sandbox, where anyone can invent an income, so no lender money may come in yet.</> : 'Open'}</dd>
              <dt>Pool</dt><dd>{pool ? `cash ${usd(pool.cash)}, lent out ${usd(pool.outstanding)}, reserve ${usd(pool.reserve)}` : '…'}. No mainnet loans have been made.</dd>
              <dt>Latest stored score</dt><dd>{dev?.score ? <>band {dev.score.band}, {dev.score.score}, by scorer <code>{dev.score.scorer_version.slice(0, 8)}…</code> (the developer&apos;s test account, sandbox bank)</> : '…'}</dd>
            </dl>
          </section>

          <h2 id="scores">Real scores from the enclave</h2>
          <ul>
            {SCORES.map((s) => <li key={s.tx}><a href={NB + s.tx} target="_blank" rel="noreferrer">{s.when}</a>: scorer <code>{s.scorer}…</code>, {s.note}.</li>)}
          </ul>
          <h2 id="changes">Latest changes</h2>
          <ul>
            {CHANGES.map((c) => <li key={c.tx}><a href={NB + c.tx} target="_blank" rel="noreferrer">{c.what}</a></li>)}
          </ul>

          <h2 id="check">Check it yourself</h2>
          <ol>
            <li>The published scorer is the pinned one: <pre className="doc-code"><code>{`curl -sL ${WASM_URL} | shasum -a 256`}</code></pre>It must print the pinned scorer above.</li>
            <li>Rebuild it from source on x86_64 Linux with Docker: <pre className="doc-code"><code>./scorer/build-docker.sh</code></pre>Same hash (or run the repository&apos;s workflow &quot;scorer reproducible build&quot;).</li>
            <li>Open the newest score above: its <code>public_token</code> argument starts with <code>sealed1:</code>, OutLayer logs &quot;Resolved project … version 6888c15e…&quot;, and <code>on_score</code> emits <code>score_issued</code>.</li>
            <li>Every command, step by step: <Link href="/docs/verify">Verify it yourself</Link>. What this does and doesn&apos;t protect: <Link href="/trust">Why is this safe?</Link></li>
          </ol>
        </article>
      </main>
      <AppFooter />
    </div>
  );
}
