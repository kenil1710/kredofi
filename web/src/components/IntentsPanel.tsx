'use client';
// "From another chain" (DESIGN 3 Lender, SPEC 4 "Cross-chain deposits"): a NEAR Intents 1Click
// stepper. Step 1 is a real 1Click quote, always a dry run, so no deposit address exists and nothing
// can be sent from here. 1Click has no testnet: on testnet, test USDC stands in for step 3.
import { useEffect, useRef, useState } from 'react';
import { CHAINS, type ChainKey, type QuoteAnswer } from '@/lib/intents';
import { parseUsd, usd, shortHash } from '@/lib/format';
import { NETWORK } from '@/lib/config';
import { prefersReducedMotion } from '@/lib/motion';

const KEYS = Object.keys(CHAINS) as ChainKey[];
const Y = [24, 66, 108, 150];

/** USDC moving from the four chains into NEAR; the picked chain's line is lit (landing .chains). */
function ChainsDiagram({ active }: { active: ChainKey }) {
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const paths = KEYS.map((k) => el.querySelector<SVGPathElement>(`#ic-${k}`)!), dots = KEYS.map((k) => el.querySelector<SVGCircleElement>(`#icd-${k}`)!);
    const lens = paths.map((p) => p.getTotalLength());
    let raf = 0, t0 = 0, on = true;
    const place = (clock: number) => KEYS.forEach((k, i) => {
      const tt = (clock * 0.28 + i * 0.25) % 1, pt = paths[i].getPointAtLength(tt * lens[i]);
      dots[i].setAttribute('cx', pt.x.toFixed(1)); dots[i].setAttribute('cy', pt.y.toFixed(1));
      dots[i].setAttribute('opacity', String((k === active ? 1 : 0.35) * (tt < 0.9 ? 1 : (1 - tt) * 10)));
    });
    if (prefersReducedMotion()) { place(0.5); return; }
    const f = (t: number) => { t0 ||= t; place((t - t0) / 1000); if (on) raf = requestAnimationFrame(f); };
    const io = new IntersectionObserver(([e]) => { on = e.isIntersecting; cancelAnimationFrame(raf); if (on) raf = requestAnimationFrame(f); });
    io.observe(el);
    return () => { on = false; cancelAnimationFrame(raf); io.disconnect(); };
  }, [active]);
  return (
    <svg ref={svg} viewBox="0 0 520 174" role="img" aria-label={`USDC moving from ${CHAINS[active].name} into your NEAR account`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {KEYS.map((k, i) => (
        <g key={k}>
          <path id={`ic-${k}`} d={`M92 ${Y[i]} C 250 ${Y[i]}, 300 87, 432 87`} fill="none" stroke={k === active ? 'var(--mint)' : 'rgba(230,234,225,.22)'} strokeWidth={k === active ? 1.5 : 1} />
          <text x="0" y={Y[i] + 5} fill={k === active ? 'var(--paper)' : '#93AAA1'} fontSize="15" fontWeight={k === active ? 600 : 400} fontFamily="var(--body)">{CHAINS[k].name}</text>
          <circle id={`icd-${k}`} r="4" fill="#9FD9BF" />
        </g>
      ))}
      <circle cx="470" cy="87" r="38" fill="#E6EAE1" />
      <text x="470" y="93" textAnchor="middle" fill="#08130F" fontSize="16" fontWeight="700" fontFamily="var(--body)">NEAR</text>
    </svg>
  );
}

export function IntentsPanel({ accountId, balance, onGetTestUsdc, busy }: { accountId: string | null; balance: bigint | null; onGetTestUsdc: () => void; busy: boolean }) {
  const [chain, setChain] = useState<ChainKey>('base');
  const [amt, setAmt] = useState('100');
  const [q, setQ] = useState<QuoteAnswer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const amount = parseUsd(amt);
  const amtErr = amount === null || amount < 1_000_000n ? 'At least $1' : amount > 10_000_000_000n ? 'At most $10,000 for a quote' : null;

  const getQuote = async () => {
    if (amtErr || amount === null) return;
    setLoading(true); setErr(null); setQ(null);
    try {
      const r = await fetch('/api/intents/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain, amount: amount.toString(), accountId }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No quote.');
      setQ(j as QuoteAnswer);
    } catch (e) { setErr(e instanceof Error ? e.message : 'No quote.'); }
    finally { setLoading(false); }
  };
  const fresh = q && q.chain === chain && q.quote.amountIn === amount?.toString();
  const step = !q ? 0 : 1;

  return (
    <div className="panel intents">
      <h2>From another chain</h2>
      <p style={{ color: '#BFCDC6' }}>NEAR Intents (1Click) turns USDC on another chain into USDC in your own NEAR account. Then you deposit it here, so the pool knows the deposit is yours.</p>
      <div className="filters" role="group" aria-label="Send from" style={{ padding: 0, border: 0 }}>
        {KEYS.map((k) => <button key={k} type="button" aria-pressed={chain === k} onClick={() => setChain(k)}>{CHAINS[k].name}</button>)}
      </div>
      <ChainsDiagram active={chain} />
      <div className="form">
        <div className="field">
          <label htmlFor="xamt">You send</label>
          <div className="money"><input id="xamt" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /><span>USDC on {CHAINS[chain].name}</span></div>
          <span className={`hint${amtErr ? ' err' : ''}`}>{amtErr ?? 'A real 1Click quote, as a dry run.'}</span>
        </div>
        <button type="button" className="btn btn-light" onClick={getQuote} disabled={!!amtErr || loading}>{loading ? 'Asking 1Click…' : fresh ? 'Quote again' : 'Get a quote'}</button>
      </div>
      {err && <p className="hint err" role="alert">{err}</p>}

      <ol className="steps" aria-label="Steps">
        <li className={step >= 1 ? 'done' : 'now'}>
          <b aria-hidden="true" />
          <div>
            <h3>Get a deposit address</h3>
            {q ? (
              <>
                <dl className="terms">
                  <dt>You send</dt><dd>{usd(q.quote.amountIn)} on {CHAINS[q.chain].name}</dd>
                  <dt>Arrives on NEAR</dt><dd>{usd(q.quote.amountOut)} USDC <span className="plain">(at least {usd(q.quote.minAmountOut)})</span></dd>
                  <dt>Takes</dt><dd>about {q.quote.timeEstimate} s</dd>
                  <dt>Quoted</dt><dd className="plain">{new Date(q.timestamp).toLocaleTimeString('en-GB')} by 1Click, signed {shortHash(q.signature.replace(/^ed25519:/, ''))}</dd>
                </dl>
                <p className="hint">Dry run: 1Click issued no deposit address, so nothing can be sent from this page.{q.standIn ? ` Quoted to a stand-in NEAR mainnet account (${q.recipient}), because ${accountId ? 'a testnet account' : 'you have no account yet and a testnet one'} can't receive mainnet USDC.` : ` Quoted to ${q.recipient}.`}</p>
              </>
            ) : <p className="hint">Pick a chain and an amount, then get a quote.</p>}
          </div>
        </li>
        <li className={step >= 1 ? 'skip' : ''}>
          <b aria-hidden="true" />
          <div>
            <h3>Send USDC on {CHAINS[chain].name} to that address</h3>
            <p className="hint">Not on {NETWORK}: 1Click runs on mainnet only, and this page never asks it for a live address.</p>
          </div>
        </li>
        <li className={step >= 1 ? (balance && balance > 0n ? 'done' : 'now') : ''}>
          <b aria-hidden="true" />
          <div>
            <h3>It arrives in your NEAR account</h3>
            {NETWORK === 'testnet' ? (
              balance && balance > 0n
                ? <p className="hint">On testnet, test USDC stands in: {accountId} holds {usd(balance)}.</p>
                : <p className="hint">On testnet, test USDC stands in. <button type="button" className="linkbtn" onClick={onGetTestUsdc} disabled={busy}>{busy ? 'Sending…' : 'Get 500 test USDC'}</button></p>
            ) : <p className="hint">About {q?.quote.timeEstimate ?? 35} seconds after the deposit.</p>}
          </div>
        </li>
        <li className={balance && balance > 0n ? 'now' : ''}>
          <b aria-hidden="true" />
          <div>
            <h3>Deposit it into the pool</h3>
            <p className="hint">{accountId ? <>With <a href="#dep">Deposit</a>, a normal ft_transfer_call from your account.</> : 'Start lending first, then deposit.'}</p>
          </div>
        </li>
      </ol>
    </div>
  );
}
