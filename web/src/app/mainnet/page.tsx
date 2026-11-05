// /mainnet: live proof of what kredofi.near runs, read with public view calls (no wallet, no keys).
// The site stays on testnet; this page only reads mainnet. Rendered on the server from a read cached for a
// minute, so the facts are in the raw HTML; LiveRefresh re-reads it every minute in an open browser.
import type { Metadata } from 'next';
import Link from 'next/link';
import { AppChrome } from '@/components/AppChrome';
import { AppFooter } from '@/components/AppFooter';
import { GuillocheStrip } from '@/components/GuillocheStrip';
import { LiveRefresh } from '@/components/LiveRefresh';
import { pendingScorerText } from '@/lib/pin';
import { utcMinuteMs } from '@/lib/ledgerView';
import { mainnetFacts } from '@/server/mainnetFacts';

export const metadata: Metadata = { title: 'Mainnet proof, KredoFi', description: 'What kredofi.near runs right now: contract version, pinned enclave scorer, real scores, and why lender deposits are locked.' };
export const revalidate = 60;

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

export default async function Mainnet() {
  const { cfg, pool, dev, codeSha, source, readAt } = await mainnetFacts();
  const locked = !!cfg.require_production_data && !cfg.production_data;
  const usd = (v?: string) => (v ? `$${(Number(v) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—');
  const readNote = source === 'live' ? `Read at ${utcMinuteMs(readAt)}; an open page re-reads it every minute.`
    : source === 'last-read' ? `The mainnet RPC did not answer just now, so these are the values last read at ${utcMinuteMs(readAt)}.`
    : `The mainnet RPC did not answer just now, so these are the values recorded on ${utcMinuteMs(readAt)}; the links below still work.`;
  return (
    <div className="g-paper" style={{ minHeight: '100svh' }}>
      <AppChrome />
      <LiveRefresh seconds={60} />
      <main className="wrap trust mainnet">
        <article className="doc">
          <GuillocheStrip height={12} />
          <p className="doc-kicker">Mainnet proof</p>
          <h1>What kredofi.near runs, right now.</h1>
          <p className="doc-summary">This site is a testnet demo. This page reads the mainnet contract live, with public view calls (no wallet). {readNote}</p>

          <section className="mn-note" aria-label="kredofi.near">
            <div className="mn-head"><span className="mn-serial">kredofi.near</span><span className={`mn-stamp ${locked ? 'locked' : ''}`}>{locked ? 'Deposits locked' : 'Deposits open'}</span></div>
            <dl className="mn-grid">
              <dt>Contract version</dt><dd>{KNOWN_CODE[codeSha] ?? 'unknown build'}<br /><code>{codeSha}</code></dd>
              <dt>Scorer mode</dt><dd>{cfg.scorer_mode === 'OutLayer' ? <>OutLayer, inside Intel TDX (<code>{cfg.outlayer}</code>)</> : cfg.scorer_mode}</dd>
              <dt>Pinned scorer</dt><dd><code>{cfg.scorer_version}</code></dd>
              <dt>Pending scorer change</dt><dd>{pendingScorerText(cfg, Date.now())}</dd>
              <dt>Lender deposits</dt><dd>{locked ? <><b>Locked until real bank data</b> (<code>production_data</code> off). Scores still use Plaid&apos;s sandbox, where anyone can invent an income, so no lender money may come in yet.</> : 'Open'}</dd>
              <dt>Pool</dt><dd>{`cash ${usd(pool.cash)}, lent out ${usd(pool.outstanding)}, reserve ${usd(pool.reserve)}`}. No mainnet loans have been made.</dd>
              <dt>Latest stored score</dt><dd>{dev?.score ? <>band {dev.score.band}, {dev.score.score}, by scorer <code>{dev.score.scorer_version.slice(0, 8)}…</code> (the developer&apos;s test account, sandbox bank)</> : 'none stored'}</dd>
            </dl>
          </section>

          <h2 id="scores">Real scores from the enclave</h2>
          <ul>
            {SCORES.map((s) => <li key={s.tx}><a href={NB + s.tx} target="_blank" rel="noreferrer">{s.when}</a>: scorer <code>{s.scorer}…</code>, {s.note}.</li>)}
          </ul>
          <h2 id="attestation">TDX attestation of the newest score</h2>
          <p>OutLayer publishes an Intel-signed TDX quote for each run. For the 3 November score, <a href="https://app.outlayer.ai/attestation/1257953" target="_blank" rel="noreferrer">job 1257953</a> commits to scorer <code>6888c15e…</code> (the pin above) and to that transaction&apos;s input and output. We ran OutLayer&apos;s open-source verifier on it: <b>PROVEN</b>.</p>
          <pre className="doc-code"><code>{`cargo install --git https://github.com/out-layer/outlayer-verify outlayer-verify
outlayer-verify tx 3nbdkFd3uNeeoYhqmE2AQHuRMXLZYbDhEZAUzsVDFGzo --api https://api.outlayer.ai`}</code></pre>
          <p>It proves the run used approved TDX hardware and this scorer. It doesn&apos;t prove the enclave deletes the data afterwards, and OutLayer controls which enclave builds are approved. <Link href="/docs/verify">What it does and doesn&apos;t show</Link></p>
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
