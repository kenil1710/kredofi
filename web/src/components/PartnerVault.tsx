'use client';
// /integrate (SPEC 8e): a separate contract reads the visitor's KredoFi band and sets collateral terms.
// Everything shown about the account is read from the chain; lib/vault.ts only previews the terms.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { GuillocheStrip } from './GuillocheStrip';
import { TxButton, TxStatus } from './TxButton';
import { getBorrower, usdcBalance, view, type BorrowerView } from '@/lib/chain';
import { EXPLORER, KREDOFI_CONTRACT, PARTNER_VAULT, USDC_CONTRACT } from '@/lib/config';
import { parseUsd, usd } from '@/lib/format';
import { useAccount } from '@/lib/near/account';
import { functionCall } from '@/lib/near/wallet';
import { useTx } from '@/lib/useTx';
import { basisFor, basisText, collateralFor, creditFor, MIN_COLLATERAL, RATIO_BPS, ratioText, STANDARD_RATIO_BPS, TERM_ROWS, type VaultPosition } from '@/lib/vault';

const EXAMPLE = 110_000_000n; // $110
const CREDIT_EXAMPLE = 100_000_000n; // $100
const cents = (v: bigint | string) => usd(v, { cents: true });

/** Real positions opened from our developer-check accounts on Nov 5, with their enclave scores. */
const RUNS = [
  { band: 'Band A', credit: '$100.00', tx: '8u7XnMuxpnewZ5YL6BztMWfx7pELQXYk5TcVRH8E2Sdg' },
  { band: 'Band B', credit: '$88.00', tx: '7CcWEYy4zebvkEi3YySWfvnAnb5ZJyiLLbv15DdwmruT' },
  { band: 'Band D', credit: '$73.33', tx: 'Bmnhbgu2pEKkhEUqUb1SHF8hgMBeriSrkrpcn1DHzpL5' },
];

export function PartnerVault({ scenarios }: { scenarios: boolean }) {
  const account = useAccount();
  const acct = account.accountId;
  const [borrower, setBorrower] = useState<BorrowerView | null | undefined>(undefined);
  const [position, setPosition] = useState<VaultPosition | null | undefined>(undefined);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [amountText, setAmountText] = useState('110');
  const [note, setNote] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const openTx = useTx();
  const closeTx = useTx();

  const refresh = useCallback(async (id: string) => {
    const [b, p, bal] = await Promise.all([
      getBorrower(id),
      view<VaultPosition | null>(PARTNER_VAULT, 'get_position', { account_id: id }),
      usdcBalance(id).then(BigInt).catch(() => 0n),
    ]);
    setBorrower(b); setPosition(p); setBalance(bal);
    return p;
  }, []);

  useEffect(() => {
    if (!acct) { setBorrower(undefined); setPosition(undefined); setBalance(null); return; }
    let live = true;
    refresh(acct).catch(() => { if (live) setNote('Could not read the chain. Reload the page to try again.'); });
    return () => { live = false; };
  }, [acct, refresh]);

  const basis = basisFor(borrower);
  const ratio = RATIO_BPS[basis];
  const amount = parseUsd(amountText);
  const validAmount = amount !== null && amount >= MIN_COLLATERAL;
  const short = validAmount && balance !== null && amount > balance;
  const read = borrower !== undefined;

  const open = async () => {
    if (!acct || !validAmount) return;
    setNote(null);
    const out = await openTx.run(() => account.signAndSend(USDC_CONTRACT, [
      functionCall('ft_transfer_call', { receiver_id: PARTNER_VAULT, amount: amount.toString(), msg: 'open' }, 100, 1n),
    ]));
    if (out === undefined) return;
    // A refused position is a successful transaction whose collateral came back, so ask the vault.
    const p = await refresh(acct).catch(() => undefined);
    if (p === null) setNote('The vault did not open a position and your test USDC came back. Try again in a moment.');
  };

  const close = async () => {
    if (!acct) return;
    setNote(null);
    const out = await closeTx.run(() => account.signDirect(PARTNER_VAULT, [functionCall('close_position', {}, 30, 1n)]));
    if (out !== undefined) await refresh(acct).catch(() => {});
  };

  const fund = async () => {
    if (!acct) return;
    setFunding(true); setNote(null);
    try {
      const r = await fetch('/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: acct, purpose: 'lend' }) });
      const j = await r.json();
      if (!r.ok) setNote(j.error ?? 'Could not send test USDC.');
      else await refresh(acct);
    } catch { setNote('Could not send test USDC. Try again.'); }
    finally { setFunding(false); }
  };

  return (
    <main className="wrap trust vault">
      <article className="doc">
        <GuillocheStrip height={12} />
        <p className="doc-kicker">Composability demo · testnet</p>
        <h1>Your band, another contract&apos;s terms.</h1>
        <p className="doc-summary">
          <code>{PARTNER_VAULT}</code> is a separate contract that reads your band from KredoFi with a public view call, then decides how much collateral you post. Your band is public on-chain, so any app can read it without asking you. Reads that need your consent are on the <Link href="/docs/roadmap">roadmap</Link>.
        </p>
        <p>It&apos;s a demo partner we built, not a real lender: the collateral is test USDC, and the credit is a number in the vault, not a token you can spend.</p>

        <div className="doc-table">
          <table>
            <thead><tr><th>KredoFi says</th><th>Collateral</th><th>Credit for $110</th></tr></thead>
            <tbody>
              {TERM_ROWS.map((r) => {
                const you = !!acct && read && r.bases.includes(basis);
                return (
                  <tr key={r.label} className={you ? 'vault-you' : undefined} aria-current={you ? 'true' : undefined}>
                    <td>{r.label}{you && <strong> (you)</strong>}</td>
                    <td>{ratioText(r.ratioBps)}</td>
                    <td>{cents(creditFor(EXAMPLE, r.ratioBps))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <section className="mn-note" aria-label="Your terms">
          {!acct ? (
            <>
              <h2 className="vault-h">Get a band first</h2>
              <p>This browser has no KredoFi account yet. Scoring takes about a minute, with a test bank.</p>
              <p className="vault-actions">
                <Link className="btn btn-violet" href="/borrow">Check my limit</Link>
                <Link className="btn btn-line" href="/scenarios">Use a prepared borrower</Link>
              </p>
              {scenarios
                ? <p className="hint">Pick a borrower on <Link href="/scenarios">Demo scenarios</Link> and come back to this page.</p>
                : <p className="hint">Scored a prepared borrower already? <Link href="/integrate?slot=scenarios">Use that account</Link>.</p>}
            </>
          ) : !read ? (
            <p aria-live="polite">Reading your band from KredoFi…</p>
          ) : (
            <>
              <h2 className="vault-h">{basisText[basis]}: {ratioText(ratio)} collateral</h2>
              <p className="hint">Read from <code>{KREDOFI_CONTRACT}</code> for <code>{acct}</code>.{' '}
                {scenarios ? <Link href="/integrate">Use my own account</Link> : <Link href="/integrate?slot=scenarios">Use my scenarios account</Link>}
              </p>
              <dl className="mn-grid">
                <dt>$100 of credit, standard</dt><dd>{cents(collateralFor(CREDIT_EXAMPLE, STANDARD_RATIO_BPS))} collateral</dd>
                <dt>$100 of credit, your terms</dt><dd><strong>{cents(collateralFor(CREDIT_EXAMPLE, ratio))} collateral</strong>{ratio < STANDARD_RATIO_BPS ? ` (${cents(collateralFor(CREDIT_EXAMPLE, STANDARD_RATIO_BPS) - collateralFor(CREDIT_EXAMPLE, ratio))} less)` : ''}</dd>
              </dl>
              {ratio === STANDARD_RATIO_BPS && <p>{basis === 'blocked' || basis === 'D' ? 'Standard terms apply to this account.' : <>A band from <Link href="/borrow">a KredoFi score</Link> can lower this.</>}</p>}

              {position ? (
                <>
                  <h3 className="vault-h3">Your open position</h3>
                  <dl className="mn-grid">
                    <dt>Collateral in the vault</dt><dd>{cents(position.collateral)}</dd>
                    <dt>Credit</dt><dd>{cents(position.credit)} at {ratioText(position.ratio_bps)}</dd>
                    <dt>Terms set from</dt><dd>{basisText[position.basis]}, read when the position opened</dd>
                  </dl>
                  <TxStatus tx={openTx.state} />
                  {account.kind === 'wallet' ? (
                    <p className="vault-actions"><TxButton tx={closeTx.state} label="Close and take collateral back" variant="line" disabled={position.closing} onClick={close} /></p>
                  ) : (
                    <p className="hint">One position per account. Our relayer only pays to open one, so closing needs a connected testnet wallet. The collateral here is test USDC.</p>
                  )}
                  <TxStatus tx={closeTx.state} />
                </>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="vault-amt">Collateral (test USDC)</label>
                    <div className="money"><input id="vault-amt" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} aria-describedby="vault-help" /></div>
                    <p className="hint" id="vault-help" aria-live="polite">
                      {!validAmount ? 'Enter at least $1.00.' : `Credit: ${cents(creditFor(amount, ratio))}. `}
                      {balance !== null && `You hold ${cents(balance)}.`}
                    </p>
                  </div>
                  <p className="vault-actions">
                    {short
                      ? <button type="button" className="btn btn-violet" disabled={funding} aria-busy={funding} onClick={fund}>{funding ? 'Sending…' : 'Get 500 test USDC'}</button>
                      : <TxButton tx={openTx.state} label="Open position" disabled={!validAmount || position === undefined} onClick={open} />}
                  </p>
                  <TxStatus tx={openTx.state} />
                </>
              )}
            </>
          )}
          {note && <p className="hint err" role="alert">{note}</p>}
        </section>

        <h2>What happens when you open</h2>
        <ol>
          <li>Test USDC goes to the vault with <code>ft_transfer_call</code>.</li>
          <li>The vault calls <code>get_borrower</code> on KredoFi for your account. Anyone can call this view.</li>
          <li>Its callback sets the ratio and records the position. If KredoFi can&apos;t be read, all your test USDC comes back.</li>
        </ol>

        <h2>Positions already on testnet</h2>
        <p>Each one posted $110 from one of our developer-check accounts, scored in the enclave.</p>
        <ul>
          {RUNS.map((r) => <li key={r.tx}><a href={EXPLORER + r.tx} target="_blank" rel="noreferrer">{r.band}: {r.credit} credit</a></li>)}
        </ul>

        <h2>What this demo leaves out</h2>
        <ul>
          <li>There are no prices or liquidations, and the credit can&apos;t be spent.</li>
          <li>Terms are fixed when a position opens. A later default on KredoFi doesn&apos;t change an open position.</li>
          <li>The vault learns only what is already public: band, expiry and whether the account defaulted.</li>
          <li>A band rests on Plaid sandbox data here, so it shows how a contract uses a score, not that a borrower is good for the money.</li>
        </ul>
        <p>To read scores from your own app, see <Link href="/docs/integrate">Use KredoFi scores in your app</Link>.</p>
      </article>
    </main>
  );
}
