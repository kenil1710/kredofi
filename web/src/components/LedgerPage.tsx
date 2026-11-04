'use client';
import Link from 'next/link';
// Public ledger (DESIGN 3, 7.5): live KredoFi events (polled every 5 s; new rows flash in without
// moving the reader's scroll), filters by band and event, per-band totals from the contract's own
// get_stats, and a Verify panel. Everything here is public chain data.
import { useEffect, useMemo, useRef, useState } from 'react';
import { describe, type LedgerEvent } from '@/lib/events';
import { EARLIER_TESTNET_CONTRACT, EXPLORER, KREDOFI_CONTRACT, NETWORK } from '@/lib/config';
import { pendingScorerText, type PinConfig } from '@/lib/pin';
import { relativeTime, usd } from '@/lib/format';
import { HashLink } from './HashLink';
import { devCheckCaption, devCheckLabel, DEV_CHECK_NOTE, isDevCheckEvent, isSeededEvent, SEEDED_LABEL, SEEDED_NOTE, visitorStats, type Bands } from '@/lib/seeded';

type Band = { scored: number; loans_issued: number; repaid: number; defaulted: number; volume: string };
type Data = { events: LedgerEvent[]; stats: Record<'A' | 'B' | 'C' | 'D', Band>; seeded?: Bands; devCheck?: Bands; devCheckTimes?: number[]; pool: { pool_value: string; reserve: string; treasury: string; outstanding: string }; config: PinConfig & { scorer_mode: string; scorer_version: string }; updatedAt: number };

const KINDS: [string, string, (e: string) => boolean][] = [
  ['all', 'All', () => true],
  ['scores', 'Scores', (e) => e.startsWith('score_')],
  ['loans', 'Loans', (e) => e === 'loan_issued' || e === 'loan_repaid'],
  ['defaults', 'Defaults', (e) => e === 'loan_defaulted' || e === 'identity_released'],
  ['lenders', 'Lenders', (e) => e.startsWith('lender_')],
  ['admin', 'Owner', (e) => ['reserve_seeded', 'scorer_version_changed', 'scorer_change_proposed', 'scorer_change_cancelled', 'param_changed', 'treasury_withdrawn', 'treasury_to_reserve'].includes(e)],
];
const keyOf = (e: LedgerEvent) => `${e.txHash}:${e.idx}`;

export function LedgerPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState('all');
  const [showDev, setShowDev] = useState(false);
  const [band, setBand] = useState('all');
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/ledger', { cache: 'no-store' });
        if (!r.ok) throw new Error();
        const j = (await r.json()) as Data;
        if (!alive) return;
        const keys = j.events.map(keyOf);
        if (seen.current) setFresh(new Set(keys.filter((k) => !seen.current!.has(k))));
        seen.current = new Set(keys);
        setData(j); setError(null); setNow(Date.now());
      } catch { if (alive) setError('The ledger index did not answer. Retrying every 5 seconds.'); }
    };
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // A loan's band comes from its own event, or from the borrower's latest score before it.
  const bandOf = useMemo(() => {
    const m = new Map<string, string>();
    if (!data) return m;
    const last = new Map<string, string>();
    for (const e of [...data.events].reverse()) {
      const who = String(e.data.borrower ?? '');
      if (e.event === 'score_issued' || e.event === 'loan_issued') last.set(who, String(e.data.band));
      if (who && last.has(who)) m.set(keyOf(e), last.get(who)!);
    }
    return m;
  }, [data]);

  const pred = KINDS.find((k) => k[0] === kind)![2];
  const rows = (data?.events ?? []).filter((e) => (showDev || !isDevCheckEvent(e)) && pred(e.event) && (band === 'all' || bandOf.get(keyOf(e)) === band)).slice(0, 60);
  // Visitors (the contract's own get_stats minus the seeded part) and seeded demo numbers, apart.
  const seeded = data?.seeded ?? null;
  const anySeeded = !!seeded && (['A', 'B', 'C', 'D'] as const).some((b) => seeded[b].scored + seeded[b].loans_issued > 0);
  const devCheck = data?.devCheck ?? null;
  const anyDev = !!data?.devCheckTimes?.length;
  const split = anySeeded || anyDev;
  const visitors = data ? visitorStats(data.stats, ...(seeded ? [seeded] : []), ...(devCheck ? [devCheck] : [])) : null;
  const devTitle = devCheckCaption(data?.devCheckTimes ?? []);
  const devScored = devCheck ? (['A', 'B', 'C', 'D'] as const).reduce((n, b) => n + devCheck[b].scored, 0) : 0;
  const groups: [string, Bands | null][] = split
    ? [['Visitors and judges', visitors], ...(anySeeded ? [[SEEDED_LABEL, seeded] as [string, Bands | null]] : []), ...(anyDev && showDev ? [[devTitle, devCheck] as [string, Bands | null]] : [])]
    : [['All borrowers', visitors]];

  return (
    <main className="wrap lend-grid">
      <div>
        <h1 style={{ fontSize: 'clamp(40px,4.6vw,66px)', lineHeight: 1.02 }}>Public ledger</h1>
        <p style={{ fontSize: 17, color: '#BFCDC6', marginTop: 18, maxWidth: 520 }}>Every score, loan, repayment and default on {KREDOFI_CONTRACT}. Bands and amounts only: no names, no bank data.</p>
        <div className="feed" style={{ marginTop: 40 }}>
          <h2>Events <small>{data ? `updated ${relativeTime(data.updatedAt, now)}, every 5 s` : 'loading'}</small></h2>
          <div className="filters" role="group" aria-label="Filter by event">
            {KINDS.map(([k, label]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>)}
          </div>
          <div className="filters" role="group" aria-label="Filter by band">
            {['all', 'A', 'B', 'C', 'D'].map((b) => <button key={b} type="button" aria-pressed={band === b} onClick={() => setBand(b)}>{b === 'all' ? 'All bands' : `Band ${b}`}</button>)}
          </div>
          {error && <p className="hint err" style={{ padding: '12px 24px' }}>{error}</p>}
          <ol aria-live="polite">
            {data && rows.length === 0 && <li><span>No events match these filters.</span></li>}
            {rows.map((e) => {
              const d = describe(e);
              return (
                <li key={keyOf(e)} className={fresh.has(keyOf(e)) ? 'new' : undefined}>
                  <span>{d.text}{isSeededEvent(e) && <> <span className="seedtag">{SEEDED_LABEL}</span></>}{isDevCheckEvent(e) && <> <span className="seedtag">{devCheckLabel(e.ts)}</span></>}</span><span className="v">{d.value}</span>
                  <span className="t" title={new Date(e.ts).toISOString()}>{relativeTime(e.ts, now)}, <HashLink hash={e.txHash} /></span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="panel">
          <h2>By band</h2>
{anySeeded && <p className="hint seeded-note">{SEEDED_NOTE}</p>}
          {anyDev && <p className="hint seeded-note">{DEV_CHECK_NOTE}</p>}
          {groups.map(([title, st]) => {
            const bands = (['A', 'B', 'C', 'D'] as const).map((b) => [b, st?.[b]] as const);
            const tot = bands.reduce((s, [, x]) => ({ scored: s.scored + (x?.scored ?? 0), loans: s.loans + (x?.loans_issued ?? 0), repaid: s.repaid + (x?.repaid ?? 0), defaulted: s.defaulted + (x?.defaulted ?? 0), volume: s.volume + BigInt(x?.volume ?? '0') }), { scored: 0, loans: 0, repaid: 0, defaulted: 0, volume: 0n });
            return (
              <table className="bandt" key={title} aria-label={title}>
                {split && <caption>{title === SEEDED_LABEL || title === devTitle ? <span className="seedtag">{title}</span> : title}</caption>}
                <thead><tr><th>Band</th><th>Scored</th><th>Loans</th><th>Repaid</th><th>Defaulted</th><th>Lent</th></tr></thead>
                <tbody>
                  {bands.map(([b, x]) => <tr key={b}><td>{b}</td><td>{x?.scored ?? '…'}</td><td>{x?.loans_issued ?? '…'}</td><td>{x?.repaid ?? '…'}</td><td>{x?.defaulted ?? '…'}</td><td>{x ? usd(x.volume) : '…'}</td></tr>)}
                  <tr className="sum"><td>All</td>{st ? <><td>{tot.scored}</td><td>{tot.loans}</td><td>{tot.repaid}</td><td>{tot.defaulted}</td><td>{usd(tot.volume)}</td></> : <><td>…</td><td>…</td><td>…</td><td>…</td><td>…</td></>}</tr>
                </tbody>
              </table>
            );
          })}
          {anyDev && <p style={{ marginTop: 12 }}><button type="button" className="btn btn-line" aria-expanded={showDev} onClick={() => setShowDev((v) => !v)}>{showDev ? 'Hide' : 'Show'} developer checks ({devScored})</button></p>}
          {data && <p className="hint">Pool {usd(data.pool.pool_value)}, lent out {usd(data.pool.outstanding)}, reserve {usd(data.pool.reserve)}, treasury {usd(data.pool.treasury)}.</p>}
        </div>
        <div className="panel verify">
          <h2>Verify</h2>
          <dl>
            <dt>Contract</dt><dd><a href={`${EXPLORER.replace('/txns/', '/address/')}${KREDOFI_CONTRACT}`} target="_blank" rel="noreferrer">{KREDOFI_CONTRACT}</a></dd>
            <dt>Network</dt><dd>{NETWORK}</dd>
            {KREDOFI_CONTRACT !== EARLIER_TESTNET_CONTRACT && <><dt>Earlier contract</dt><dd><a href={`${EXPLORER.replace('/txns/', '/address/')}${EARLIER_TESTNET_CONTRACT}`} target="_blank" rel="noreferrer">{EARLIER_TESTNET_CONTRACT}</a> (Nov 1–4, Dev mode: our own test runs, including the default-path tests; its history stays on-chain)</dd></>}
            <dt>Scoring</dt><dd>{data ? (data.config.scorer_mode === 'Dev' ? 'Dev mode: the pinned scorer runs on our server (testnet)' : 'OutLayer: inside Intel TDX') : '…'}</dd>
            <dt>Pinned scorer</dt><dd>{data?.config.scorer_version ?? '…'}</dd>
            <dt>Pending scorer change</dt><dd>{pendingScorerText(data?.config, Date.now())}</dd>
          </dl>
          <p className="hint">On mainnet, kredofi.near pins a scorer you can check yourself:</p>
          <code>curl -sL https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/6db115961a822664fdef8c8d19f02668b6f67e92/kredofi_scorer.wasm | shasum -a 256</code>
          <p className="hint">It must print 6888c15e1442b508…7c23e6e2, the version kredofi.near pins. <Link href="/mainnet" prefetch={false}>Mainnet proof, live</Link></p>
        </div>
      </div>
    </main>
  );
}
