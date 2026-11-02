'use client';
// Borrower passbook (DESIGN 3, 7.2-7.8; docs/passbook-reference.html), wired to testnet.
// Every state is read from the chain, so a refresh never loses it (DESIGN 7.3). The browser keeps
// only the reply key and the scorer output for this account, to show the five rule results.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CreditNote } from './CreditNote';
import { Stamp } from './Stamp';
import { Tally } from './Tally';
import { GuillocheStrip } from './GuillocheStrip';
import { EnclavePanel, DECOR_ROWS, DEV_PHASES, type EnclaveStep } from './EnclavePanel';
import { TxButton, TxStatus } from './TxButton';
import { HashLink } from './HashLink';
import { functionCall } from '@/lib/near/wallet';
import { useAccount } from '@/lib/near/account';
import { useTx } from '@/lib/useTx';
import { BORROWERS, CUSTOM_LIMITS, checkCustom, type BorrowerKey, type CustomInputs } from '@/lib/borrowers';
import { getBorrowerAt, getConfig, getPool, usdcBalance, type BorrowerView, type ConfigView, type PoolView } from '@/lib/chain';
import { KREDOFI_CONTRACT, USDC_CONTRACT } from '@/lib/config';
import { absoluteDate, amountInWords, parseUsd, usd } from '@/lib/format';
import { serialFromFingerprint } from '@/lib/drawNote';
import { newKeypair, openSealed } from '@/lib/seal';
import { PART_KEYS, PART_NAMES, reason, whatWouldChange, type Parts } from '@/lib/reasons';
import { primaryAction } from '@/lib/primaryAction';
import { levelPlan, mmss, noLevelUpReason } from '@/lib/levels';
import { loanHistory, type LoanRecord } from '@/lib/history';
import type { LedgerEvent } from '@/lib/events';

type Who = BorrowerKey | 'custom' | 'plaid';
type Source = { borrower: Who; custom?: CustomInputs; publicToken?: string };
type Session = { who?: Who; replySecret?: string; output?: Record<string, unknown>; extra?: string | null; scoreHash?: string; scoredIn?: number };
type Record_ = { events: LedgerEvent[]; output: Record<string, unknown> | null; extra: string | null; scoreHash: string | null };
/** Testnet extras, sealed to the borrower (demo scorer build): real fetch counts and the AI summary. */
type Extra = { receipt?: { plaid_transactions: number; plaid_accounts: number; read_transactions: number; months: number }; summary?: string; summary_by?: string };
const whoName = (w?: Who) => (w === 'custom' ? 'your test borrower' : w === 'plaid' ? 'the sandbox bank user' : w ? BORROWERS[w].name.split(' ')[0] : '');

// Plaid Link (SPEC 8c), loaded only when the judge asks for it.
type PlaidHandler = { open: () => void; destroy: () => void };
declare global { interface Window { Plaid?: { create: (o: { token: string; onSuccess: (publicToken: string) => void; onExit: (err: unknown) => void }) => PlaidHandler } } }
function loadPlaid(): Promise<NonNullable<Window['Plaid']>> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.onload = () => (window.Plaid ? res(window.Plaid) : rej(new Error('Plaid Link did not load.')));
    s.onerror = () => rej(new Error('Plaid Link did not load. Check your connection and try again.'));
    document.head.appendChild(s);
  });
}
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

function Entry({ when, sub, title, children, liRef }: { when: string; sub?: string; title: string; children: React.ReactNode; liRef?: React.Ref<HTMLLIElement> }) {
  return (
    <li className="entry" ref={liRef}>
      <div className="when">{when}{sub && <small>{sub}</small>}</div>
      <div className="body"><h2>{title}</h2>{children}</div>
    </li>
  );
}

export function Passbook() {
  const account = useAccount();
  // Development only: ?as=<account> renders any testnet account's passbook read-only, for visual
  // checks without a wallet. Compiled out of production builds; signing still needs a wallet.
  const [viewAs, setViewAs] = useState<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') setViewAs(new URLSearchParams(location.search).get('as'));
  }, []);
  const acct = account.accountId ?? viewAs;
  const [custom, setCustom] = useState<CustomInputs>({ salary: 1200, months: 4, spending: 1500, fees: 2, balance: 200 });
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
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
  const [record, setRecord] = useState<Record_ | null>(null);
  const scoringBox = useRef<HTMLLIElement>(null);
  const seen = useRef<{ acct: string | null; height: number }>({ acct: null, height: 0 });
  const resultBox = useRef<HTMLDivElement>(null);
  const loanBox = useRef<HTMLDivElement>(null);
  const borrowTx = useTx(), repayTx = useTx(), defaultTx = useTx(), releaseTx = useTx();

  // Reads the account at call time: score() outlives the render that started it, and a stale closure
  // holding the pre-demo-account `null` used to wipe the fresh score (setB(null)) right after scoring.
  const acctRef = useRef(acct);
  acctRef.current = acct;
  const refresh = useCallback(async () => {
    const acct = acctRef.current;
    const [p, c] = await Promise.all([getPool(), getConfig()]);
    setPool(p); setCfg(c);
    if (acct !== acctRef.current) return;
    if (!acct) { setB(null); return; }
    const [bAt, u, rec] = await Promise.all([
      getBorrowerAt(acct), usdcBalance(acct).catch(() => '0'),
      fetch(`/api/passbook?account=${encodeURIComponent(acct)}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    // Never step back: a lagging RPC node can answer from an older block (it hid a fresh score).
    if (acct !== acctRef.current || (seen.current.acct === acct && bAt.height < seen.current.height)) return;
    seen.current = { acct, height: bAt.height };
    setB(bAt.value); setUsdcBal(BigInt(u)); if (rec) setRecord(rec);
  }, [acct]);

  useEffect(() => { setSess(acct ? loadSession(acct) : {}); setB(undefined); setRecord(null); refresh().catch(() => setB(null)); }, [acct, refresh]);

  // Tick once a second while something time-based is on screen (scoring timer, loan countdown).
  const ticking = !!scoring && scoring.step !== 'sealed' && scoring.step !== 'failed' || !!b?.has_active_loan;
  useEffect(() => { if (!ticking) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [ticking]);

  // Keyed by the account the action is for: a demo account created a moment ago is not in `acct` yet,
  // and saving under the old (empty) id lost the reply key and the output.
  const updateSession = (patch: Session, forAccount?: string | null) => {
    const id = forAccount ?? acct;
    if (!id) return;
    const s = { ...loadSession(id), ...patch }; saveSession(id, s); setSess(s);
  };

  // ---------------------------------------------------------------- scoring (testnet Dev mode)
  const score = useCallback(async (src: Source, forAccount?: string) => {
    const acctId = forAccount ?? acct;
    if (!acctId) return;
    const who = src.borrower;
    const kp = newKeypair();
    updateSession({ who, replySecret: kp.secret, output: undefined, extra: undefined, scoreHash: undefined, scoredIn: undefined }, acctId);
    const started = Date.now();
    setScoring({ step: 'sent', elapsed: 0 });
    setTimeout(() => scoringBox.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    const timer = setInterval(() => setScoring((s) => (s && s.step === 'sent' ? { ...s, elapsed: Math.round((Date.now() - started) / 1000) } : s)), 1000);
    try {
      const f = account.kind === 'demo' ? null : await fetch('/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: acctId }) });
      if (f && !f.ok && f.status !== 429) throw new Error((await f.json()).error ?? 'Could not set up test USDC.');
      const r = await fetch('/api/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: acctId, borrower: who, custom: src.custom, publicToken: src.publicToken, replyPubkey: kp.public }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Scoring failed.');
      clearInterval(timer);
      updateSession({ who, replySecret: kp.secret, output: j.output, extra: j.extra, scoreHash: j.hash, scoredIn: Math.round((Date.now() - started) / 1000) }, acctId);
      setScoring({ step: 'reading', elapsed: Math.round((Date.now() - started) / 1000), hash: j.hash });
      for (let i = 0; i < 30; i++) {
        const { value: bb, height } = await getBorrowerAt(acctId);
        if (bb?.score && bb.score.fingerprint === j.output.fingerprint) { seen.current = { acct: acctId, height: Math.max(height, seen.current.acct === acctId ? seen.current.height : 0) }; setB(bb); break; }
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
  }, [acct, refresh, account.kind]);

  // No account yet: create a no-wallet demo account first (SPEC 8a), then score.
  const ensureAccount = async (): Promise<string | null> => {
    if (acct) return acct;
    setStarting('Creating your demo account. The relayer pays its network fees…');
    try { return await account.createDemo(); }
    catch (e) { setStartError(e instanceof Error ? e.message : 'Could not create a demo account.'); return null; }
    finally { setStarting(null); }
  };
  const pick = async (src: Source) => {
    setStartError(null);
    const a = await ensureAccount();
    if (a) score(src, a);
  };
  const connectBank = async () => {
    setStartError(null);
    const a = await ensureAccount();
    if (!a) return;
    try {
      setStarting('Opening Plaid Link…');
      const [Plaid, r] = await Promise.all([loadPlaid(), fetch('/api/plaid/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: a }) })]);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Plaid Link is not available right now.');
      setStarting(null);
      const h = Plaid.create({
        token: j.linkToken,
        onSuccess: (publicToken) => { h.destroy(); score({ borrower: 'plaid', publicToken }, a); },
        onExit: () => h.destroy(),
      });
      h.open();
    } catch (e) { setStarting(null); setStartError(e instanceof Error ? e.message : 'Plaid Link failed.'); }
  };
  void pendingWho; void setPendingWho;

  // ---------------------------------------------------------------- derived
  const sc = b?.score ?? null;
  // The scorer output behind the on-chain score: this browser's copy, else the public copy the server
  // kept (it is the dev_submit_score argument). Only one whose fingerprint matches the chain counts.
  const output = useMemo(() => {
    const ok = (o?: Record<string, unknown> | null) => !!o && (!sc || o.fingerprint === sc.fingerprint);
    return ok(sess.output) ? sess.output! : ok(record?.output) ? record!.output! : null;
  }, [sess.output, record, sc]);
  const sealedExtra = output && output === sess.output ? sess.extra : output && output === record?.output ? record?.extra : null;
  const extra: Extra | null = useMemo(() => {
    if (!sess.replySecret || typeof sealedExtra !== 'string') return null;
    try { return JSON.parse(openSealed(sess.replySecret, sealedExtra)) as Extra; } catch { return null; }
  }, [sess.replySecret, sealedExtra]);
  const scoreHash = sess.scoreHash ?? record?.scoreHash ?? undefined;
  const parts: Parts | null = useMemo(() => {
    const reply = output?.reply;
    if (!sess.replySecret || typeof reply !== 'string') return null;
    try { return JSON.parse(openSealed(sess.replySecret, reply)).parts as Parts; } catch { return null; }
  }, [sess.replySecret, output]);
  const who = sess.who;
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
  const history: LoanRecord[] = useMemo(() => (acct ? loanHistory(record?.events ?? [], acct, loan) : []), [record, acct, loan]);
  // Rule 13 made visible: when repaying this loan raises the limit (DESIGN 7.8, live countdown).
  const plan = loan?.state === 'Active' && sc && cfg && b ? levelPlan({
    level: b.level, band: sc.band, incomeCap: BigInt(sc.income_cap), principal: ns(loan.principal), limitAtBorrow: ns(loan.limit_at_borrow),
    issuedMs: msOf(loan.issued_at), minHoldMs: msOf(cfg.min_hold_ns), lastLevelUpMs: b.last_level_up === '0' ? 0 : msOf(b.last_level_up), termMs, nowMs: now,
  }) : null;
  const levelText = !plan ? null
    : plan.kind === 'wait' ? `${plan.why === 'recent' ? 'Your limit rose less than one term ago. ' : ''}Repay after ${mmss(plan.atMs - now)} to level up to ${usd(plan.next)}.`
    : plan.kind === 'ready' ? `Repaying now levels you up to ${usd(plan.next)}.`
    : plan.kind === 'small' ? `This loan is under half your limit (${usd(plan.half)}), so repaying it won't raise your limit.`
    : plan.kind === 'capped' ? `Your income caps your limit at ${usd(plan.limit)}, so repaying won't raise it.`
    : 'You are at the top level.';
  const showPick = !scoring && b !== undefined && !sc && !b?.blocked;
  const showBorrow = !!sc && !denied && !sc.expired && !b?.has_active_loan && !b?.blocked && limit > 0n;

  const defaulted = !!b?.blocked && loan?.state === 'Defaulted';
  // A defaulted borrower's note shows the loan he took, stamped DEFAULT (his limit is now 0 for good).
  const noteDollars = Number((defaulted && loan ? ns(loan.principal) : limit) / 1_000_000n);
  const noteData = sc && {
    name: acct ?? '', band: sc.band, amount: noteDollars, words: amountInWords(noteDollars),
    repay: denied ? 'Not issued' : defaulted && loan ? `${absoluteDate(loan.due_at)}, ${usd(due)}, not repaid` : loan?.state === 'Active' ? `${absoluteDate(loan.due_at)}, ${usd(due)}` : `${Math.round(termMs / 60000)} minutes after you borrow, ${usd(limit + ceilBps(limit, INTEREST_BPS[sc.band]))}`,
    serial: serialFromFingerprint(sc.fingerprint),
    proof: scoreHash ? `Scored by the pinned scorer (testnet), transaction ${scoreHash.slice(0, 6)}…${scoreHash.slice(-3)}` : 'Scored by the pinned scorer (testnet)',
    denied: false,
  };

  // ---------------------------------------------------------------- transactions (wallet)
  const borrow = () => amount !== null && !amountError && borrowTx.run(async () => {
    const out = await account.signAndSend(KREDOFI_CONTRACT, [functionCall('borrow', { amount: amount.toString() }, 40, 1n)]);
    await refresh(); return out;
  });
  const repay = () => repayTx.run(async () => {
    const out = await account.signAndSend(USDC_CONTRACT, [functionCall('ft_transfer_call', { receiver_id: KREDOFI_CONTRACT, amount: due.toString(), msg: 'repay' }, 40, 1n)]);
    await refresh(); setPress((p) => p + 1); return out;
  });
  // Demo accounts can't sign mark_default (the relayer allowlist is borrow / repay only), so the
  // relayer does the permissionless default steps for them (/api/default).
  const viaRelayer = async () => {
    const r = await fetch('/api/default', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ borrower: acct }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? 'The default could not be recorded.');
    await refresh(); setPress((p) => p + 1);
    return { transaction: { hash: j.txs?.[0] }, status: { SuccessValue: '' } };
  };
  const markDefault = () => defaultTx.run(async () => {
    if (account.kind !== 'wallet') return viaRelayer();
    const out = await account.signAndSend(KREDOFI_CONTRACT, [functionCall('mark_default', { borrower: acct }, 30)]);
    await refresh(); setPress((p) => p + 1); return out;
  });
  const release = () => releaseTx.run(async () => {
    if (account.kind !== 'wallet') return viaRelayer();
    const out = b?.pending_request ? undefined : await account.signAndSend(KREDOFI_CONTRACT, [functionCall('request_identity_release', { borrower: acct }, 30)]);
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

  // ---------------------------------------------------------------- phone action bar (DESIGN 7.8)
  const retry = () => who && (who === 'plaid' ? connectBank() : score({ borrower: who, custom: who === 'custom' ? custom : undefined }));
  const primary = primaryAction({
    scoringBusy: !!scoring && scoring.step !== 'sealed' && scoring.step !== 'failed',
    scoringFailed: scoring?.step === 'failed' && !!who,
    picking: showPick && !starting,
    canBorrow: showBorrow,
    loanActive: loan?.state === 'Active',
    canDefault, isMax: who === 'max',
    releasePending: defaulted && !b?.released_identity,
  });
  const firstKey = Object.keys(BORROWERS)[0] as BorrowerKey;
  const bar = primary === 'start' ? { text: 'No wallet needed. Or pick another borrower above.', button: <button type="button" className="btn btn-violet" onClick={() => pick({ borrower: firstKey })}>Use {BORROWERS[firstKey].name.split(' ')[0]}</button> }
    : primary === 'retry' ? { text: scoring?.error ?? 'Scoring failed. Nothing changed on-chain.', button: <button type="button" className="btn btn-ink" onClick={retry}>Check my limit again</button> }
    : primary === 'borrow' ? { text: amountError ?? `Band ${sc?.band}, limit ${usd(limit)}`, button: <TxButton tx={borrowTx.state} label={`Borrow ${amount !== null ? usd(amount) : ''}`} onClick={borrow} disabled={!!amountError} /> }
    : primary === 'repay' ? { text: shortBy > 0n ? `You need ${usd(shortBy)} more test USDC` : plan?.kind === 'wait' ? `Repay after ${mmss(plan.atMs - now)} to level up to ${usd(plan.next)}` : plan?.kind === 'ready' ? `Repaying now levels you up to ${usd(plan.next)}` : now < dueMs ? `Due in ${span(dueMs - now)}` : 'Overdue', button: <TxButton tx={repayTx.state} label={`Repay ${usd(due)}`} doneLabel="Repaid" onClick={repay} variant="ink" disabled={shortBy > 0n} /> }
    : primary === 'default' ? { text: 'Grace period over. Anyone can mark it.', button: <TxButton tx={defaultTx.state} label="Mark as defaulted" onClick={markDefault} variant="red" /> }
    : primary === 'release' ? { text: 'Defaulted. The name is still sealed.', button: <TxButton tx={releaseTx.state} label="Release the name" onClick={release} variant="red" /> }
    : null;
  // Hide the bar while the same action is on screen in the passbook, so it never shows twice.
  const [inlineVisible, setInlineVisible] = useState(false);
  useEffect(() => {
    setInlineVisible(false);
    const el = primary && document.getElementById(`pa-${primary === 'default' ? 'repay' : primary}`);
    if (!el) return;
    // below the sticky banner and above the bar itself; mostly on screen counts as visible
    const io = new IntersectionObserver(([e]) => setInlineVisible(e.intersectionRatio >= 0.5), { rootMargin: '-100px 0px -96px 0px', threshold: [0, 0.5, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, [primary]);

  // ---------------------------------------------------------------- render
  const outputJson = output
    ? JSON.stringify({ ...output, reply: output.reply ? `${String(output.reply).slice(0, 12)}…` : undefined, sealed_identity: `${String(output.sealed_identity).slice(0, 12)}…` }, null, 2)
    : sc ? JSON.stringify({ band: sc.band, score: sc.score, income_cap: sc.income_cap, fingerprint: sc.fingerprint, sealed_identity: '(stored by the contract, never shown by its views)' }, null, 2) : null;

  return (
    <main className={`wrap layout${bar ? ' has-bar' : ''}`} id="top">
      <div>
        <div className="title">
          <h1>Your passbook</h1>
          <p>{acct && who
            ? `You are ${whoName(who)}. Every step lands here as an entry, read from the chain.`
            : 'Pick a test borrower. Each step lands here as an entry, like a bank passbook. Your bank data never appears on this page or on-chain.'}</p>
        </div>

        {showPick && (
          <section aria-label="Pick a test borrower">
            <div className="pick" id="pa-start">
              {(Object.keys(BORROWERS) as BorrowerKey[]).map((k, i) => (
                <article key={k} className="who">
                  <GuillocheStrip />
                  <h3>{BORROWERS[k].name.split(' ')[0]}</h3>
                  <p>{BORROWERS[k].story}</p>
                  <p className="expect">{BORROWERS[k].expect}</p>
                  <button type="button" className={`btn ${i === 0 ? 'btn-violet' : 'btn-line'}`} onClick={() => pick({ borrower: k })} disabled={!!starting}>
                    Use {BORROWERS[k].name.split(' ')[0]}
                  </button>
                </article>
              ))}
            </div>
            <div className="pick pick-2">
              <article className="who">
                <GuillocheStrip />
                <h3>Build your own borrower</h3>
                <p>Set six months of history and see which rules move the band. The real scorer reads it from a sandbox bank.</p>
                {([['salary', 'Monthly salary', 100, '$'], ['months', 'Months with income, of the last 6', 1, ''], ['spending', 'Monthly spending', 100, '$'], ['fees', 'Overdraft or returned-payment fees', 1, ''], ['balance', 'Current balance', 500, '$']] as [keyof CustomInputs, string, number, string][]).map(([k, label, step, pre]) => (
                  <label key={k} className="slider">
                    <span>{label} <b className="num">{pre}{custom[k].toLocaleString('en-US')}</b></span>
                    <input type="range" min={CUSTOM_LIMITS[k][0]} max={CUSTOM_LIMITS[k][1]} step={step} value={custom[k]}
                      onChange={(e) => setCustom((c) => ({ ...c, [k]: Number(e.target.value) }))} />
                  </label>
                ))}
                {checkCustom(custom) && <p className="hint err">{checkCustom(custom)}</p>}
                <button type="button" className="btn btn-line" disabled={!!starting || !!checkCustom(custom)} onClick={() => pick({ borrower: 'custom', custom })}>Score this borrower</button>
              </article>
              <article className="who">
                <GuillocheStrip />
                <h3>Connect a sandbox bank yourself</h3>
                <p>Open Plaid Link and log in to a test bank. The scorer fetches that account live.</p>
                <p className="expect">Test login: username <b>user_good</b>, password <b>pass_good</b>. Pick any bank.</p>
                <p className="expect">On testnet each account gets its own copy of the sandbox identity, so every judge can use the same login.</p>
                <button type="button" className="btn btn-line" disabled={!!starting} onClick={connectBank}>Connect a sandbox bank</button>
              </article>
            </div>
            {starting && <p className="acct" aria-live="polite">{starting}</p>}
            {startError && <p className="hint err" role="alert" style={{ marginTop: 12 }}>{startError}</p>}
            <p className="acct">
              {acct ? `Signed in as ${acct}. We pay the network and scoring fees.` : <>No wallet needed: we create a demo account and pay its network fees. <button type="button" className="linkbtn" onClick={account.connectWallet}>Connect a wallet instead</button></>}
            </p>
          </section>
        )}

        {acct && b === undefined && <p className="hint" style={{ marginTop: 40 }}><span className="placeholder">Reading your passbook from the chain</span></p>}

        <ol className="book" aria-live="polite">
          {account.kind === 'demo' && acct && (sc || scoring) && (
            <Entry when={clock(scoredAt || now)} sub={day(scoredAt || now)} title="Demo account">
              <p>{acct}. Its key lives only in this browser. The relayer pays every network fee and only passes on borrow and repay, so you never see a wallet pop-up.</p>
            </Entry>
          )}
          {acct && (sc || scoring) && (
            <Entry when={clock(scoredAt || now)} sub={day(scoredAt || now)} title="Bank connected">
              <p>{who === 'plaid' ? 'Your sandbox bank, connected through Plaid Link' : 'First Platypus Bank, checking account'}. Plaid sandbox, read-only{who && who !== 'plaid' ? `, with ${whoName(who)}'s test history` : ''}. KredoFi never sees a bank login.</p>
            </Entry>
          )}

          {(scoring || (sc && scoreHash)) && (
            <Entry liRef={scoringBox} when={scoring && scoring.step !== 'sealed' ? clock(now) : clock(scoredAt)} sub={scoring && scoring.step !== 'sealed' ? 'Now' : day(scoredAt)}
              title={!scoring || scoring.step === 'sealed' ? `Limit checked${(scoring?.elapsed ?? sess.scoredIn) ? ` in ${scoring?.elapsed ?? sess.scoredIn} s` : ''}` : scoring.step === 'failed' ? 'Scoring failed' : 'Checking your limit'}>
              <EnclavePanel step={scoring?.step ?? 'sealed'} elapsed={scoring?.elapsed ?? sess.scoredIn ?? 0} labels={DEV_PHASES} timerAt={1} failedAt={1}
                txHash={scoring?.hash ?? scoreHash} failure={scoring?.error} rows={who === 'sam' ? DECOR_ROWS.irregular : DECOR_ROWS.steady}
                note="Testnet: the pinned scorer runs on our server, outside the enclave. On mainnet the same code runs inside Intel TDX through OutLayer." />
              {scoring?.step === 'failed' && who && (
                <p id="pa-retry"><button type="button" className="btn btn-ink" onClick={retry}>Check my limit again</button></p>
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
              {extra?.summary && (
                <div className="change ai-summary">
                  <h3>In plain words</h3>
                  <p>{extra.summary}</p>
                  <p className="hint" style={{ marginTop: 6 }}>Written by {extra.summary_by ?? 'Qwen'} on NEAR AI Cloud from your band and rule points only, and sealed so only this browser can read it. On testnet it is generated on our server. The score never depends on it.</p>
                </div>
              )}
              {defaulted ? (
                <p>Band {sc.band} when scored. This account defaulted, so it can&apos;t borrow again.</p>
              ) : sc.expired ? (
                <p>Your score expired on {absoluteDate(sc.expires_at)}. <button type="button" className="linkbtn" onClick={() => who && (who === 'plaid' ? connectBank() : score({ borrower: who, custom: who === 'custom' ? custom : undefined }))}>Check your limit again</button></p>
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

          {history.map((r, i) => {
            const isCurrent = !!loan && r.dueAt === loan.due_at;
            const isLatest = i === history.length - 1;
            const toPool = r.toPool ?? ceilBps(r.principal, INTEREST_BPS[r.band] / 2n);
            const leveled = r.leveledUp ?? (isCurrent && b ? ns(b.last_level_up) >= ns(loan!.issued_at) : undefined);
            return (
              <Fragment key={r.dueAt}>
                {r.state === 'Active' && isCurrent && loan ? (
                <Entry when={clock(msOf(loan.issued_at))} sub={day(msOf(loan.issued_at))} title="Loan issued">
                  <p>{usd(loan.principal)} USDC arrived in {acct}. Repay {usd(due)} by {absoluteDate(loan.due_at)}, {clock(dueMs)}.</p>
                  <dl className="terms">
                    <dt>Interest</dt><dd>{usd(loan.interest)} flat</dd>
                    <dt>Due</dt><dd className="num">{now < dueMs ? `in ${span(dueMs - now)}` : now < dueMs + graceMs ? `overdue, grace ends in ${span(dueMs + graceMs - now)}` : 'grace period over'}</dd>
                  </dl>
                  {shortBy > 0n ? (
                    <p className="hint err">You need {usd(shortBy)} more test USDC to repay. <button type="button" className="linkbtn" onClick={faucet}>Get test USDC</button>{faucetMsg && ` ${faucetMsg}`}</p>
                  ) : null}
                  <div className="form" id="pa-repay">
                    <TxButton tx={repayTx.state} label={`Repay ${usd(due)}`} doneLabel="Repaid" onClick={repay} variant="ink" disabled={shortBy > 0n} />
                    {canDefault && <TxButton tx={defaultTx.state} label="Mark as defaulted" onClick={markDefault} variant="red" />}
                  </div>
                  {levelText && <p className="hint num" aria-live="off">{levelText}</p>}
                  <TxStatus tx={repayTx.state} />
                  <TxStatus tx={defaultTx.state} />
                  {who === 'max' && !canDefault && <p className="hint">Max won&apos;t repay. After the due date and a {Math.round(graceMs / 60000)}-minute grace period anyone can mark the loan as defaulted; the contract checks the dates itself.</p>}
                </Entry>
                ) : (
                  <Entry when={clock(r.issuedMs)} sub={day(r.issuedMs)} title="Loan issued">
                    <p>{usd(r.principal)} USDC arrived in {acct}. Repay {usd(r.principal + r.interest)} by {absoluteDate(r.dueAt)}, {clock(msOf(r.dueAt))}.</p>
                    {r.issuedHash && <p className="txline">Transaction <HashLink hash={r.issuedHash} /></p>}
                  </Entry>
                )}

                {r.state === 'Repaid' && (
                  <Entry when={clock(r.closedMs ?? now)} sub={r.closedMs ? day(r.closedMs) : 'Latest'} title="Repaid">
                    <div ref={isLatest ? loanBox : undefined} style={{ position: 'relative' }}>
                      <p>{usd(r.principal + r.interest)} paid: {usd(toPool)} of the interest went to lenders, {usd(r.interest - toPool)} to the KredoFi treasury.</p>
                      {isLatest && <Stamp kind="paid" small press={press} shakeRef={loanBox} style={{ position: 'absolute', right: 0, top: -44 }}>PAID</Stamp>}
                    </div>
                    {leveled === true && <p>Your limit rose to level {r.levelAfter ?? b?.level}.</p>}
                    {leveled === false && r.closedMs !== undefined && cfg && (
                      <p>No level-up. {noLevelUpReason({ levelBefore: r.levelAtBorrow ?? b?.level ?? 1, principal: r.principal, limitAtBorrow: r.limitAtBorrow, heldMs: r.closedMs - r.issuedMs, minHoldMs: msOf(cfg.min_hold_ns) })}</p>
                    )}
                    {isLatest && isCurrent && (
                      <>
                        <div className="level" aria-label="Limit levels">
                          {[100, 250, 500, 1000].map((v, k) => (
                            <div key={v} className={b && b.level > k ? 'on' : ''}><i style={{ height: [24, 44, 70, 100][k] }} />${v.toLocaleString('en-US')}</div>
                          ))}
                        </div>
                        <p>Level {b?.level}. Your next note can be up to <b className="roll" key={b?.limit}>{usd(limit)}</b>. Limits grow only after a loan held at least half its term and at least half your limit.</p>
                      </>
                    )}
                    {r.closedHash && <p className="txline">Transaction <HashLink hash={r.closedHash} /></p>}
                  </Entry>
                )}

                {r.state === 'Defaulted' && (isCurrent && b?.blocked && loan ? (
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
                      <span id="pa-release" />
                      <TxButton tx={releaseTx.state} label="Release the name to the recovery partner" onClick={release} variant="red" />
                      {releaseMsg && <p className="hint">{releaseMsg}</p>}
                      <TxStatus tx={releaseTx.state} />
                    </>
                  )}
                  <p className="txline">The bank fingerprint stays taken, so this bank identity can&apos;t start over with a new account.</p>
                </Entry>
                ) : (
                  <Entry when={clock(r.closedMs ?? now)} sub={r.closedMs ? day(r.closedMs) : ''} title="Defaulted">
                    <p>{usd(r.principal)} not repaid.</p>
                    {r.closedHash && <p className="txline">Transaction <HashLink hash={r.closedHash} /></p>}
                  </Entry>
                ))}
              </Fragment>
            );
          })}

          {showBorrow && sc && (
            <Entry when="Now" title="Borrow">
              <div className="form" id="pa-borrow">
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
              {scoreHash && <p className="txline" style={{ marginTop: 8 }}>On-chain in <HashLink hash={scoreHash} /></p>}
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

      {bar && (
        <div className={`actionbar${inlineVisible ? ' away' : ''}`} role="region" aria-label="Next step" aria-hidden={inlineVisible || undefined} inert={inlineVisible || undefined}>
          <p aria-live="polite">{bar.text}</p>
          {bar.button}
        </div>
      )}
    </main>
  );
}
