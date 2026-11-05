'use client';
// Two landing sections: the proof strip under the hero and "Every transaction in. One line out."
// Numbers come from lib/proofFacts.ts, which is tested. The row stream is CSS only; it has a pause button
// because it moves for longer than 5 seconds, and it stands still under reduced motion.
import Link from 'next/link';
import { useState } from 'react';
import { MAINNET_RUN, MAINNET_SCORER_DELAY_HOURS, MAINNET_TX_URL, ONE_LINE_HEADING, RECEIPT_RAW, RECEIPT_NOTE, RECEIPT_TX_URL, SANDBOX_ROWS } from '@/lib/proofFacts';

export function ProofStrip() {
  return (
    <section id="pstrip" aria-label="The proof, in four numbers">
      <ul className="wrap">
        <li><b>{MAINNET_RUN.seconds} s</b><span>A real mainnet score inside OutLayer, on sandbox data and our test account. <a href={MAINNET_TX_URL} target="_blank" rel="noreferrer">See the transaction</a></span></li>
        <li><b>{MAINNET_RUN.outputBytes} bytes</b><span>All that left the enclave for NEAR in that run.</span></li>
        <li><b>{MAINNET_SCORER_DELAY_HOURS} h</b><span>Public notice on mainnet before a scorer re-pin. The contract&apos;s key can still bypass it: <Link href="/trust#who-holds-what">who holds what</Link></span></li>
        <li><b>$0 gas</b><span>No wallet needed to try it on testnet. We pay the fees.</span></li>
      </ul>
    </section>
  );
}

const Rows = ({ hidden }: { hidden?: boolean }) => (
  <ul aria-hidden={hidden || undefined} aria-label={hidden ? undefined : 'sample sandbox rows'}>
    {SANDBOX_ROWS.map(([d, n, a, inc], i) => <li key={i} className={inc ? 'in' : undefined}><span className="d">{d}</span><span>{n}</span><span className="a">{a}</span></li>)}
  </ul>
);

export function OneLineOut() {
  const [paused, setPaused] = useState(false);
  const receipt = JSON.parse(RECEIPT_RAW) as Record<string, unknown>;
  return (
    <section id="oneline" aria-labelledby="oneline-h">
      <div className="wrap">
        <h2 id="oneline-h">{ONE_LINE_HEADING}</h2>
        <div className="grid">
          <div className="stream-box">
            <div className="slot">SEALED</div>
            <div className={`stream${paused ? ' paused' : ''}`}><div className="track"><Rows /><Rows hidden /></div></div>
            <div className="foot">
              <span>sample sandbox rows</span>
              <button type="button" className="pause" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>{paused ? 'Play' : 'Pause'}</button>
            </div>
          </div>
          <div className="receipt">
            <h3>The receipt on NEAR</h3>
            <p>From a testnet enclave score of Plaid&apos;s public sandbox login: the exact output, {new TextEncoder().encode(RECEIPT_RAW).length} bytes.</p>
            <pre tabIndex={0} aria-label="On-chain receipt"><code>{Object.entries(receipt).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}</code></pre>
            <a href={RECEIPT_TX_URL} target="_blank" rel="noreferrer">See the transaction</a>
          </div>
        </div>
        <p className="honest">{RECEIPT_NOTE}</p>
      </div>
    </section>
  );
}
