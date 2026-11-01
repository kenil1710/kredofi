'use client';
// Borrower passbook (DESIGN 3, 7.2-7.8; docs/passbook-reference.html), wired to testnet.
// Every state is read from the chain, so a refresh never loses it (DESIGN 7.3). The browser keeps
// only the reply key and the scorer output for this account, to show the five rule results.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CreditNote } from './CreditNote';
import { Stamp } from './Stamp';
import { Tally } from './Tally';
import { GuillocheStrip } from './GuillocheStrip';
import { EnclavePanel, DECOR_ROWS, DEV_PHASES, type EnclaveStep } from './EnclavePanel';
import { TxButton, TxStatus } from './TxButton';
import { HashLink } from './HashLink';
import { useWallet, functionCall } from '@/lib/near/wallet';
import { useTx } from '@/lib/useTx';
import { BORROWERS, type BorrowerKey } from '@/lib/borrowers';
import { getBorrower, getConfig, getPool, usdcBalance, type BorrowerView, type ConfigView, type PoolView } from '@/lib/chain';
import { KREDOFI_CONTRACT, USDC_CONTRACT } from '@/lib/config';
import { absoluteDate, amountInWords, parseUsd, usd } from '@/lib/format';
import { serialFromFingerprint } from '@/lib/drawNote';
import { newKeypair, openSealed } from '@/lib/seal';
import { PART_KEYS, PART_NAMES, reason, whatWouldChange, type Parts } from '@/lib/reasons';

type Session = { who?: BorrowerKey; replySecret?: string; output?: Record<string, unknown>; scoreHash?: string };
const KEY = (a: string) => `kredofi:passbook:${a}`;
const loadSession = (a: string): Session => { try { return JSON.parse(localStorage.getItem(KEY(a)) ?? '{}'); } catch { return {}; } };
const saveSession = (a: string, s: Session) => { try { localStorage.setItem(KEY(a), JSON.stringify(s)); } catch { /* private mode */ } };

// Borrower interest per band (contract: lender rate x 2). Used only to preview terms before borrowing;
// the loan itself always shows the contract's figures.
const INTEREST_BPS: Record<string, bigint> = { A: 400n, B: 600n, C: 800n, D: 0n };
const ceilBps = (a: bigint, bps: bigint) => (a * bps + 9999n) / 10000n;
const ns = (s: string) => BigInt(s);
const msOf = (nsStr: string) => Number(ns(nsStr) / 1_000_000n);
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
function span(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 120 ? `${Math.ceil(s / 60)} min` : s >= 60 ? `1 min ${s - 60} s` : `${s} s`;
}

function Entry({ when, sub, title, children }: { when: string; sub?: string; title: string; children: React.ReactNode }) {
  return (
    <li className="entry">
      <div className="when">{when}{sub && <small>{sub}</small>}</div>
      <div className="body"><h2>{title}</h2>{children}</div>
    </li>
  );
}

export function Passbook() {
  const wallet = useWallet();
  // Development only: ?as=<account> renders any testnet account's passbook read-only, for visual
  // checks without a wallet. Compiled out of production builds; signing still needs a wallet.
  const [viewAs, setViewAs] = useState<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') setViewAs(new URLSearchParams(location.search).get('as'));
  }, []);
  const acct = wallet.accountId ?? viewAs;
  const [b, setB] = useState<BorrowerView | null | undefined>(undefined);
  const [pool, setPool] = useState<PoolView | null>(null);
  const [cfg, setCfg] = useState<ConfigView | null>(null);
  const [usdcBal, setUsdcBal] = useState<bigint | null>(null);
  const [sess, setSess] = useState<Session>({});
  const [scoring, setScoring] = useState<{ step: EnclaveStep; elapsed: number; error?: string; hash?: string } | null>(null);
  const [pendingWho, setPendingWho] = useState<BorrowerKey | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [press, setPress] = useState(0);
  const [amountText, setAmountText] = useState('');
  const [faucetMsg, setFaucetMsg] = useState<string | null>(null);
  const [releaseMsg, setReleaseMsg] = useState<string | null>(null);
  const resultBox = useRef<HTMLDivElement>(null);
  const loanBox = useRef<HTMLDivElement>(null);
  const borrowTx = useTx(), repayTx = useTx(), defaultTx = useTx(), releaseTx = useTx();

  const refresh = useCallback(async () => {
    const [p, c] = await Promise.all([getPool(), getConfig()]);
    setPool(p); setCfg(c);
    if (!acct) { setB(null); return; }
    const [bb, u] = await Promise.all([getBorrower(acct), usdcBalance(acct).catch(() => '0')]);
    setB(bb); setUsdcBal(BigInt(u));
  }, [acct]);

  useEffect(() => { setSess(acct ? loadSession(acct) : {}); setB(undefined); refresh().catch(() => setB(null)); }, [acct, refresh]);

  // Tick once a second while something time-based is on screen (scoring timer, loan countdown).
  const ticking = !!scoring && scoring.step !== 'sealed' && scoring.step !== 'failed' || !!b?.has_active_loan;
  useEffect(() => { if (!ticking) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [ticking]);

  const updateSession = (patch: Session) => { if (!acct) return; const s = { ...loadSession(acct), ...patch }; saveSession(acct, s); setSess(s); };

  // ---------------------------------------------------------------- scoring (testnet Dev mode)
  const score = useCallback(async (who: BorrowerKey) => {
    if (!acct) return;
    const kp = newKeypair();
    updateSession({ who, replySecret: kp.secret, output: undefined, scoreHash: undefined });
    const started = Date.now();
    setScoring({ step: 'sent', elapsed: 0 });
    const timer = setInterval(() => setScoring((s) => (s && s.step === 'sent' ? { ...s, elapsed: Math.round((Date.now() - started) / 1000) } : s)), 1000);
    try {
      const f = await fetch('/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: acct }) });
      if (!f.ok && f.status !== 429) throw new Error((await f.json()).error ?? 'Could not set up test USDC.');
      const r = await fetch('/api/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: acct, borrower: who, replyPubkey: kp.public }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Scoring failed.');
      clearInterval(timer);
      updateSession({ who, replySecret: kp.secret, output: j.output, scoreHash: j.hash });
      setScoring({ step: 'reading', elapsed: Math.round((Date.now() - started) / 1000), hash: j.hash });
      for (let i = 0; i < 10; i++) {
        const bb = await getBorrower(acct);
        if (bb?.score && bb.score.fingerprint === j.output.fingerprint) { setB(bb); break; }
        await new Promise((res) => setTimeout(res, 1000));
      }
      setScoring((s) => (s ? { ...s, step: 'sealed' } : s));
      setPress((p) => p + 1);
      await refresh();
    } catch (e) {
      clearInterval(timer);
      setScoring((s) => ({ step: 'failed', elapsed: s?.elapsed ?? 0, error: e instanceof Error ? e.message : 'Scoring failed.' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acct, refresh]);

  // Pick before connecting: score as soon as the wallet signs in.
  useEffect(() => { if (acct && pendingWho) { const w = pendingWho; setPendingWho(null); score(w); } }, [acct, pendingWho, score]);
  const pick = (who: BorrowerKey) => { if (!acct) { setPendingWho(who); wallet.connect(); } else score(who); };

  // ---------------------------------------------------------------- derived
  const parts: Parts | null = useMemo(() => {
    const reply = sess.output?.reply;
    if (!sess.replySecret || typeof reply !== 'string') return null;
    try { return JSON.parse(openSealed(sess.replySecret, reply)).parts as Parts; } catch { return null; }
  }, [sess]);
  const who = sess.who;
  const sc = b?.score ?? null;
  const loan = b?.loan ?? null;
  const limit = b ? BigInt(b.limit) : 0n;
  const termMs = cfg ? msOf(cfg.loan_term_ns) : 0;
  const graceMs = cfg ? msOf(cfg.grace_ns) : 0;
  const denied = sc?.band === 'D';
  const amount = amountText === '' ? limit : parseUsd(amountText);
  const interest = amount !== null && sc ? ceilBps(amount, INTEREST_BPS[sc.band]) : 0n;
  const amountError = amount === null ? 'Enter an amount in dollars' : amount <= 0n ? 'Enter an amount' : amount > limit ? `Above your limit of ${usd(limit)}` : pool && amount > BigInt(pool.cash) ? 'The pool has no cash to lend right now.' : null;
  const due = loan ? ns(loan.principal) + ns(loan.interest) : 0n;
  const dueMs = loan ? msOf(loan.due_at) : 0;
  const shortBy = loan?.state === 'Active' && usdcBal !== null && usdcBal < due ? due - usdcBal : 0n;
  const canDefault = loan?.state === 'Active' && now > dueMs + graceMs;
  const scoredAt = sc ? msOf(sc.issued_at) : 0;
  const showPick = !scoring && b !== undefined && !sc && !b?.blocked;

  const defaulted = !!b?.blocked && loan?.state === 'Defaulted';
  // A defaulted borrower's note shows the loan he took, stamped DEFAULT (his limit is now 0 for good).
  const noteDollars = Number((defaulted && loan ? ns(loan.principal) : limit) / 1_000_000n);
  const noteData = sc && {
    name: acct ?? '', band: sc.band, amount: noteDollars, words: amountInWords(noteDollars),
    repay: denied ? 'Not issued' : defaulted && loan ? `${absoluteDate(loan.due_at)}, ${usd(due)}, not repaid` : loan?.state === 'Active' ? `${absoluteDate(loan.due_at)}, ${usd(due)}` : `${Math.round(termMs / 60000)} minutes after you borrow, ${usd(limit + ceilBps(limit, INTEREST_BPS[sc.band]))}`,
    serial: serialFromFingerprint(sc.fingerprint),
    proof: sess.scoreHash ? `Scored by the pinned scorer (testnet), transaction ${sess.scoreHash.slice(0, 6)}…${sess.scoreHash.slice(-3)}` : 'Scored by the pinned scorer (testnet)',
    denied: false,
  };

  // ---------------------------------------------------------------- transactions (wallet)
  const borrow = () => amount !== null && !amountError && borrowTx.run(async () => {
    const out = await wallet.signAndSend(KREDOFI_CONTRACT, [functionCall('borrow', { amount: amount.toString() }, 40, 1n)]);
    await refresh(); return out;
  });
  const repay = () => repayTx.run(async () => {
    const out = await wallet.signAndSend(USDC_CONTRACT, [functionCall('ft_transfer_call', { receiver_id: KREDOFI_CONTRACT, amount: due.toString(), msg: 'repay' }, 40, 1n)]);
    await refresh(); setPress((p) => p + 1); return out;
  });
  const markDefault = () => defaultTx.run(async () => {
    const out = await wallet.signAndSend(KREDOFI_CONTRACT, [functionCall('mark_default', { borrower: acct }, 30)]);
    await refresh(); setPress((p) => p + 1); return out;
  });
  const release = () => releaseTx.run(async () => {
    const out = b?.pending_request ? undefined : await wallet.signAndSend(KREDOFI_CONTRACT, [functionCall('request_identity_release', { borrower: acct }, 30)]);
    setReleaseMsg('Sealed name sent to the scorer for re-sealing to the recovery partner…');
    const r = await fetch('/api/release', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ borrower: acct }) });
    const j = await r.json();
    setReleaseMsg(r.ok ? null : j.error);
    await refresh();
    return out ?? { transaction: { hash: j.hash }, status: { SuccessValue: '' } };
  });
  const faucet = async () => {
    setFaucetMsg('Sending test USDC…');
    const r = await fetch('/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: acct }) });
    const j = await r.json();
    setFaucetMsg(r.ok ? 'Test USDC sent.' : j.error);
    await refresh();
  };

  // ---------------------------------------------------------------- render
  const outputJson = sess.output ? JSON.stringify({ ...sess.output, reply: sess.output.reply ? `${String(sess.output.reply).slice(0, 12)}…` : undefined, sealed_identity: `${String(sess.output.sealed_identity).slice(0, 12)}…` }, null, 2) : null;

  return (
    <main className="wrap layout" id="top">
      <div>
        <div className="title">
          <h1>Your passbook</h1>
          <p>{acct && who
            ? `You are ${BORROWERS[who].name.split(' ')[0]}, a test borrower. Every step lands here as an entry, read from the chain.`
            : 'Pick a test borrower. Each step lands here as an entry, like a bank passbook. Your bank data never appears on this page or on-chain.'}</p>
        </div>

        {showPick && (
          <section aria-label="Pick a test borrower">
            <div className="pick">
              {(Object.keys(BORROWERS) as BorrowerKey[]).map((k, i) => (
                <article key={k} className="who">
                  <GuillocheStrip />
                  <h3>{BORROWERS[k].name.split(' ')[0]}</h3>
                  <p>{BORROWERS[k].story}</p>
                  <p className="expect">{BORROWERS[k].expect}</p>
                  <button type="button" className={`btn ${i === 0 ? 'btn-violet' : 'btn-line'}`} onClick={() => pick(k)}>
                    {acct ? `Use ${BORROWERS[k].name.split(' ')[0]}` : `Connect wallet and use ${BORROWERS[k].name.split(' ')[0]}`}
                  </button>
                </article>
              ))}
            </div>
            <p className="acct">{acct ? `Signed in as ${acct}. We register it with test USDC and pay the scoring fees.` : 'You need a NEAR testnet wallet for now. A no-wallet demo account is coming next.'}</p>
          </section>
        )}

        {acct && b === undefined && <p className="hint" style={{ marginTop: 40 }}><span className="placeholder">Reading your passbook from the chain</span></p>}

        <ol className="book" aria-live="polite">
          {acct && (sc || scoring) && (
            <Entry when={clock(scoredAt || now)} sub={day(scoredAt || now)} title="Bank connected">
              <p>First Platypus Bank, checking account. Plaid sandbox, read-only{who ? `, with ${BORROWERS[who].name.split(' ')[0]}'s test history` : ''}. KredoFi never sees a bank login.</p>
            </Entry>
          )}

          {scoring && scoring.step !== 'sealed' && (
            <Entry when={clock(now)} sub="Now" title="Checking your limit">
              <EnclavePanel step={scoring.step} elapsed={scoring.elapsed} labels={DEV_PHASES} timerAt={1} failedAt={1}
                txHash={scoring.hash} failure={scoring.error} rows={who === 'sam' ? DECOR_ROWS.irregular : DECOR_ROWS.steady}
                note="Testnet: the pinned scorer runs on our server, outside the enclave. On mainnet the same code runs inside Intel TDX through OutLayer." />
              {scoring.step === 'failed' && who && (
                <p><button type="button" className="btn btn-ink" onClick={() => score(who)}>Check my limit again</button></p>
              )}
            </Entry>
          )}

          {sc && noteData && (
            <Entry when={clock(scoredAt)} sub={day(scoredAt)} title={denied ? 'Not this time' : 'Your credit note'}>
              <div className="result" ref={resultBox}>
                <CreditNote data={noteData} drawIn={press > 0} label={`${denied ? 'Not issued' : 'Credit note'} for ${acct}: band ${sc.band}, limit ${usd(limit)}`}>
                  {defaulted
                    ? <Stamp kind="default" press={press} shakeRef={resultBox}>DEFAULT</Stamp>
                    : <Stamp kind={denied ? 'rejected' : 'approved'} press={press} shakeRef={resultBox}>{denied ? 'NOT THIS TIME' : `BAND ${sc.band}, ${usd(limit, { cents: false })}`}</Stamp>}
                </CreditNote>
                {parts ? (
                  <Tally play={press} rows={PART_KEYS.map((k) => ({ label: PART_NAMES[k], detail: reason(k, parts[k]), points: parts[k] }))} />
                ) : (
                  <p className="hint">Score {sc.score}. The five rule results are shown only in the browser that asked for this score; they were sealed to its key.</p>
                )}
              </div>
              {defaulted ? (
                <p>Band {sc.band} when scored. This account defaulted, so it can&apos;t borrow again.</p>
              ) : sc.expired ? (
                <p>Your score expired on {absoluteDate(sc.expires_at)}. <button type="button" className="linkbtn" onClick={() => who && score(who)}>Check your limit again</button></p>
              ) : denied ? (
                <div className="change">
                  <h3>What would change this</h3>
                  <ul>{(parts ? whatWouldChange(parts) : ['Income in all of the last 6 months', 'No overdraft or returned-payment fees', 'Spending below income']).map((x) => <li key={x}>{x}</li>)}</ul>
                  <p style={{ marginTop: 8 }}>Lenders see only the band. Nothing else about this result is on-chain.</p>
                </div>
              ) : (
                <p>Band {sc.band}, level {b?.level}. You can borrow up to {usd(limit)} today. Only the line in &ldquo;What left the enclave&rdquo; is on-chain.</p>
              )}
            </Entry>
          )}

          {b?.blocked && loan?.state === 'Defaulted' && (
            <Entry when={clock(dueMs + graceMs)} sub={day(dueMs)} title="Defaulted">
              <div ref={loanBox} style={{ position: 'relative' }}>
                <ul className="chain">
                  <li><span>Loan marked as defaulted</span><span>{usd(loan.principal)}</span></li>
                  <li><span>Reserve paid the pool back first</span><span>up to {usd(loan.principal)}</span></li>
                  <li><span>Name released to the recovery partner</span><span>{b.released_identity ? 'sealed, then opened' : 'pending'}</span></li>
                  <li><span>Can borrow again</span><span>Never</span></li>
                </ul>
              </div>
              {!b.released_identity && (
                <>
                  <TxButton tx={releaseTx.state} label="Release the name to the recovery partner" onClick={release} variant="red" />
                  {releaseMsg && <p className="hint">{releaseMsg}</p>}
                  <TxStatus tx={releaseTx.state} />
                </>
              )}
              <p className="txline">The bank fingerprint stays taken, so this bank identity can&apos;t start over with a new account.</p>
            </Entry>
          )}

          {loan?.state === 'Active' && (
            <Entry when={clock(msOf(loan.issued_at))} sub={day(msOf(loan.issued_at))} title="Loan issued">
              <p>{usd(loan.principal)} USDC arrived in {acct}. Repay {usd(due)} by {absoluteDate(loan.due_at)}, {clock(dueMs)}.</p>
              <dl className="terms">
                <dt>Interest</dt><dd>{usd(loan.interest)} flat</dd>
                <dt>Due</dt><dd className="num">{now < dueMs ? `in ${span(dueMs - now)}` : now < dueMs + graceMs ? `overdue, grace ends in ${span(dueMs + graceMs - now)}` : 'grace period over'}</dd>
              </dl>
              {shortBy > 0n ? (
                <p className="hint err">You need {usd(shortBy)} more test USDC to repay. <button type="button" className="linkbtn" onClick={faucet}>Get test USDC</button>{faucetMsg && ` ${faucetMsg}`}</p>
              ) : null}
              <div className="form">
                <TxButton tx={repayTx.state} label={`Repay ${usd(due)}`} doneLabel="Repaid" onClick={repay} variant="ink" disabled={shortBy > 0n} />
                {canDefault && <TxButton tx={defaultTx.state} label="Mark as defaulted" onClick={markDefault} variant="red" />}
              </div>
              <TxStatus tx={repayTx.state} />
              <TxStatus tx={defaultTx.state} />
              {who === 'max' && !canDefault && <p className="hint">Max won&apos;t repay. After the due date and a {Math.round(graceMs / 60000)}-minute grace period anyone can mark the loan as defaulted; the contract checks the dates itself.</p>}
            </Entry>
          )}

          {loan?.state === 'Repaid' && (
            <Entry when={clock(now)} sub="Latest" title="Repaid">
              <div ref={loanBox} style={{ position: 'relative' }}>
                <p>{usd(due)} paid: {usd(ceilBps(ns(loan.principal), INTEREST_BPS[loan.band] / 2n))} of the interest went to lenders, the rest to the KredoFi treasury.</p>
                <Stamp kind="paid" small press={press} shakeRef={loanBox} style={{ position: 'absolute', right: 0, top: -44 }}>PAID</Stamp>
              </div>
              <div className="level" aria-label="Limit levels">
                {[100, 250, 500, 1000].map((v, i) => (
                  <div key={v} className={b && b.level > i ? 'on' : ''}><i style={{ height: [24, 44, 70, 100][i] }} />${v.toLocaleString('en-US')}</div>
                ))}
              </div>
              <p>Level {b?.level}. Your next note can be up to <b className="roll" key={b?.limit}>{usd(limit)}</b>. Limits grow only after a loan held at least half its term and at least half your limit.</p>
            </Entry>
          )}

          {sc && !denied && !sc.expired && !b?.has_active_loan && !b?.blocked && limit > 0n && (
            <Entry when="Now" title="Borrow">
              <div className="form">
                <div className="field">
                  <label htmlFor="amt">Amount</label>
                  <div className="money"><input id="amt" inputMode="decimal" value={amountText === '' ? (Number(limit) / 1e6).toFixed(2) : amountText}
                    onChange={(e) => setAmountText(e.target.value)} aria-describedby="amtHint" /><span>USDC</span></div>
                  <span className={`hint${amountError ? ' err' : ''}`} id="amtHint">
                    {amountError ?? <>Your limit is {usd(limit)}. <button type="button" className="linkbtn" onClick={() => setAmountText('')}>Use my limit</button></>}
                  </span>
                </div>
                <TxButton tx={borrowTx.state} label={`Borrow ${amount !== null ? usd(amount) : ''}`} onClick={borrow} disabled={!!amountError} />
              </div>
              <dl className="terms">
                <dt>Interest</dt><dd>{usd(interest)} flat ({Number(INTEREST_BPS[sc.band]) / 100}%)</dd>
                <dt>You repay</dt><dd>{amount !== null ? usd(amount + interest) : '—'} within {Math.round(termMs / 60000)} minutes (testnet term)</dd>
                <dt>If you don&apos;t repay</dt><dd className="plain">After a {Math.round(graceMs / 60000)}-minute grace period anyone can mark the loan as defaulted. The reserve pays lenders first, your name is released to the recovery partner, and you can&apos;t borrow again.</dd>
              </dl>
              <TxStatus tx={borrowTx.state} />
            </Entry>
          )}

          {acct && b && !sc && !scoring && b.blocked && <Entry when="Now" title="Blocked"><p>This account defaulted and can&apos;t borrow again.</p></Entry>}
        </ol>
      </div>

      <aside className="rail" aria-label="Proof">
        <div className="card">
          <h3>What left the enclave</h3>
          {outputJson ? (
            <>
              <ul className="stayed" aria-label="Stayed inside">
                <li>30 transactions, six months</li><li>Balances</li><li>Your name</li><li>The bank access token</li>
              </ul>
              <pre>{outputJson}</pre>
              {sess.scoreHash && <p className="txline" style={{ marginTop: 8 }}>On-chain in <HashLink hash={sess.scoreHash} /></p>}
            </>
          ) : <pre>Nothing yet. Pick a test borrower to start.</pre>}
        </div>
        <div className="card">
          <h3>Verify</h3>
          <dl>
            <dt>Contract</dt><dd>{KREDOFI_CONTRACT}</dd>
            <dt>Mode</dt><dd>{cfg?.scorer_mode === 'Dev' ? 'Dev (testnet)' : cfg?.scorer_mode ?? '…'}</dd>
            <dt>Scoring code</dt><dd>{cfg ? `${cfg.scorer_version.slice(0, 8)}…${cfg.scorer_version.slice(-4)}` : '…'}</dd>
            <dt>Pool</dt><dd>{pool ? `${usd(pool.pool_value)}, ${usd(pool.cash)} free` : '…'}</dd>
            <dt>Reserve</dt><dd>{pool ? usd(pool.reserve) : '…'}</dd>
            <dt>Data</dt><dd>Plaid sandbox bank</dd>
          </dl>
        </div>
        {acct && usdcBal !== null && <div className="card"><p>Test USDC in {acct}: <b>{usd(usdcBal)}</b></p></div>}
      </aside>
    </main>
  );
}
