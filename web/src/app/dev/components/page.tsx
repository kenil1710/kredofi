'use client';
// Component sheet (PLAN day 7): every signature component on its ground, at 1440 and 375 px.
// Values are examples from our real runs (Nov 1), labelled as such.
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { AppChrome } from '@/components/AppChrome';
import { CreditNote } from '@/components/CreditNote';
import { Stamp } from '@/components/Stamp';
import { Tally, RULE_NAMES } from '@/components/Tally';
import { GuillocheStrip } from '@/components/GuillocheStrip';
import { EnclavePanel, DECOR_ROWS, type EnclaveStep } from '@/components/EnclavePanel';
import { TxButton, TxStatus } from '@/components/TxButton';
import { HashLink } from '@/components/HashLink';
import { useTx } from '@/lib/useTx';
import { serialFromFingerprint } from '@/lib/drawNote';
import { amountInWords } from '@/lib/format';
import { useWallet } from '@/lib/near/wallet';

const EnclaveGL = dynamic(() => import('@/components/EnclaveGL').then((m) => m.EnclaveGL), { ssr: false });

// Real outputs (fingerprints) and the mainnet TDX scoring transaction (Nov 1).
const MAINNET_SCORE_TX = '4dgHrA97KfibKifZuVZ2YF5zoAVCy4m2pXxxf9zdijyu';
const RIYA_FP = '5d7233c680a4dbb85e077446db3a230fdba597ba686189a7d63653b12a58c25b';
const SAM_FP = 'e329d846f3946c538dd48f289e95f1970064768ad3b50d16ff10b83e88b4e7fa';
const PROOF = 'Scored inside Intel TDX, transaction 4dgHrA…zyu';

const RIYA = [250, 250, 250, 150, 100].map((points, i) => ({
  label: RULE_NAMES[i], points,
  detail: ['$4,000 a month on average', 'Paid in 6 of 6 months', 'No fees in six months', 'Keeps 56% of income', 'Savings cover 3.4 months'][i],
}));
const SAM = [100, 100, 10, 0, 60].map((points, i) => ({
  label: RULE_NAMES[i], points,
  detail: ['$1,333 a month on average', 'Paid in 4 of 6 months', '4 fees in six months', 'Spends more than he earns', 'Savings cover 2.2 months'][i],
}));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function ComponentSheet() {
  const [press, setPress] = useState(1);
  const [draw, setDraw] = useState(1);
  const riyaBox = useRef<HTMLDivElement>(null);
  const samBox = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<EnclaveStep>('reading');
  const [elapsed, setElapsed] = useState(12);
  const simRun = useRef(0);
  const tx = useTx();
  const wallet = useWallet();

  const simulateScore = async () => {
    const id = ++simRun.current;
    setStep('signing'); setElapsed(0); await sleep(900);
    if (id !== simRun.current) return;
    setStep('sent'); await sleep(800);
    setStep('reading');
    for (let t = 1; t <= 6 && id === simRun.current; t++) { setElapsed(t); await sleep(1000); }
    if (id === simRun.current) setStep('sealed');
  };

  // Simulated transactions (no chain involved) to show every TxButton state.
  const simulateTx = (outcome: 'ok' | 'contract' | 'rejected') =>
    tx.run(async ({ sent }) => {
      await sleep(900);
      if (outcome === 'rejected') throw new Error('User rejected the request');
      sent(MAINNET_SCORE_TX);
      await sleep(1200);
      if (outcome === 'contract') {
        return { transaction: { hash: MAINNET_SCORE_TX }, status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: Amount is above your limit' } } } } } };
      }
      return { transaction: { hash: MAINNET_SCORE_TX }, status: { SuccessValue: '' } };
    });

  return (
    <div className="g-paper">
      <AppChrome />

      <section className="g-night" style={{ position: 'relative', overflow: 'hidden' }}>
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'radial-gradient(55% 60% at 68% 48%,rgba(110,80,220,.30),transparent 70%),radial-gradient(40% 45% at 80% 90%,rgba(80,190,150,.16),transparent 70%)' }} />
        <div className="wrap sheet-hero" style={{ position: 'relative' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <h1 style={{ fontSize: 'clamp(40px,6vw,84px)', lineHeight: 0.95 }}>Component sheet</h1>
            <p style={{ color: '#BFCDC6', maxWidth: 460 }}>Every piece the app is built from, on its own ground. Values are examples from our runs on 1 November.</p>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>The enclave renders only while it is on screen.</p>
          </div>
          <div className="sheet-gl"><EnclaveGL /></div>
        </div>
      </section>

      <section className="wrap sheet-sec">
        <h2 className="sheet-h">Credit notes</h2>
        <div className="sheet-two">
          <div ref={riyaBox}>
            <CreditNote
              key={`riya-${draw}`}
              drawIn={draw > 1}
              loupe
              label="Credit note for riya.testnet: 100 US dollars in USDC, band A, repay 104 dollars by 24 November 2026"
              data={{ name: 'riya.testnet', band: 'A', amount: 100, words: amountInWords(100), repay: '24 November 2026, $104', serial: serialFromFingerprint(RIYA_FP), proof: PROOF }}
            >
              <Stamp kind="approved" press={press} shakeRef={riyaBox}>BAND A, $100</Stamp>
            </CreditNote>
            <p className="hint" style={{ marginTop: 34 }}>Move the pointer over the note: the letter and amount shift colour, and the loupe reads the microprint.</p>
          </div>
          <div ref={samBox}>
            <CreditNote
              key={`sam-${draw}`}
              drawIn={draw > 1}
              label="Not issued: sam.testnet, band D"
              data={{ name: 'sam.testnet', band: 'D', amount: 0, words: amountInWords(0), repay: 'Not issued', serial: serialFromFingerprint(SAM_FP), proof: PROOF }}
            >
              <Stamp kind="rejected" press={press} shakeRef={samBox}>NOT THIS TIME</Stamp>
            </CreditNote>
          </div>
        </div>
        <p style={{ marginTop: 44, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-line" type="button" onClick={() => setPress((p) => p + 1)}>Press the stamps again</button>
          <button className="btn btn-line" type="button" onClick={() => setDraw((d) => d + 1)}>Draw the notes in</button>
        </p>
      </section>

      <section className="wrap sheet-sec">
        <h2 className="sheet-h">Stamps</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'center', padding: '12px 0' }}>
          <Stamp kind="approved" press={press}>BAND A, $100</Stamp>
          <Stamp kind="rejected" press={press}>NOT THIS TIME</Stamp>
          <Stamp kind="paid" press={press} small>PAID</Stamp>
          <Stamp kind="default" press={press} small>DEFAULT</Stamp>
        </div>
      </section>

      <section className="wrap sheet-sec">
        <h2 className="sheet-h">Tally</h2>
        <div className="sheet-two">
          <div><h3 style={{ fontSize: 26, marginBottom: 8 }}>Riya</h3><Tally rows={RIYA} play={press} /></div>
          <div><h3 style={{ fontSize: 26, marginBottom: 8 }}>Sam</h3><Tally rows={SAM} play={press} /></div>
        </div>
      </section>

      <section className="wrap sheet-sec">
        <h2 className="sheet-h">Borrower cards</h2>
        <div className="sheet-three">
          {[
            ['Riya', '$4,000 salary on the 1st of every month. No overdraft fees. Saves about half.', 'Expect band A and a $100 first loan. She repays.', 'btn-violet'],
            ['Sam', 'Gig income that jumps around. Two months with nothing. Four overdraft or returned-payment fees.', 'Expect no loan, with the reasons and what would change them.', 'btn-line'],
            ['Max', '$3,800 salary. Looks perfect on paper. He borrows and never pays back.', 'Expect band A, then a default: the reserve pays and his name is released.', 'btn-line'],
          ].map(([n, story, expect, btn]) => (
            <article key={n} className="who">
              <GuillocheStrip />
              <h3>{n}</h3>
              <p>{story}</p>
              <p className="expect">{expect}</p>
              <button type="button" className={`btn ${btn}`}>Use {n}</button>
            </article>
          ))}
        </div>
      </section>

      <section className="wrap sheet-sec">
        <h2 className="sheet-h">Scoring, waiting honestly</h2>
        <EnclavePanel step={step} elapsed={elapsed} txHash={step === 'signing' ? undefined : MAINNET_SCORE_TX}
          rows={DECOR_ROWS.steady} failure="The bank history was not ready yet. Check your limit again in a minute." />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          <button type="button" className="btn btn-ink" onClick={simulateScore}>Simulate a scoring run</button>
          <button type="button" className="btn btn-line" onClick={() => { simRun.current++; setStep('reading'); setElapsed(30); }}>Show the 28 s note</button>
          <button type="button" className="btn btn-red" onClick={() => { simRun.current++; setStep('failed'); }}>Show a failure</button>
        </div>
      </section>

      <section className="wrap sheet-sec">
        <h2 className="sheet-h">Transactions</h2>
        <p className="hint" style={{ marginBottom: 14 }}>Simulated: nothing is sent to the chain from this page.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <TxButton tx={tx.state} label="Borrow $100" doneLabel="Borrowed" onClick={() => simulateTx('ok')} />
          <button type="button" className="btn btn-line" disabled={tx.busy} onClick={() => simulateTx('contract')}>Simulate a contract refusal</button>
          <button type="button" className="btn btn-line" disabled={tx.busy} onClick={() => simulateTx('rejected')}>Simulate a cancelled signature</button>
          <button type="button" className="btn btn-line" disabled={tx.busy} onClick={tx.reset}>Reset</button>
        </div>
        <div style={{ marginTop: 12, minHeight: 24 }}><TxStatus tx={tx.state} /></div>
      </section>

      <section className="g-deep">
        <div className="wrap sheet-sec">
          <h2 className="sheet-h">Wallet</h2>
          <p style={{ color: '#BFCDC6', marginBottom: 16 }}>
            {wallet.accountId ? <>Signed in as <b>{wallet.accountId}</b> on testnet.</> : 'Connect a NEAR testnet wallet with NEAR Connect.'}
          </p>
          {wallet.accountId
            ? <button type="button" className="btn btn-ghost" onClick={wallet.disconnect}>Sign out</button>
            : <button type="button" className="btn btn-light" onClick={wallet.connect}>Connect wallet</button>}
          <p className="txline" style={{ marginTop: 16 }}>Mainnet scoring run: <HashLink hash={MAINNET_SCORE_TX} href={`https://nearblocks.io/txns/${MAINNET_SCORE_TX}`} /></p>
        </div>
      </section>
    </div>
  );
}
