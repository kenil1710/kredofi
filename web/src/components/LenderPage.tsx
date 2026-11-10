'use client';
// Lender page (DESIGN 3 "Lender", 7.2): pool ledger with a double rule, your share, cash available to
// withdraw now, deposit and withdraw, and how lenders earn. No yield forecast and no APY: only the share
// price and what lenders actually earned and lost, read from the chain.
import { useCallback, useEffect, useState } from 'react';
import { defaultDeposit } from '@/lib/format';
import { useAccount } from '@/lib/near/account';
import { functionCall } from '@/lib/near/wallet';
import { useTx } from '@/lib/useTx';
import { TxButton, TxStatus } from './TxButton';
import { view, getPool, usdcBalance, type PoolView } from '@/lib/chain';
import { KREDOFI_CONTRACT, USDC_CONTRACT } from '@/lib/config';
import { parseUsd, usd } from '@/lib/format';
import { lenderTotalsOf, utcMinuteMs, type LendFirstPaint } from '@/lib/ledgerView';
import { IntentsPanel } from './IntentsPanel';

type Lender = { shares: string; value: string };

export function LenderPage({ initial = null }: { initial?: LendFirstPaint | null }) {
  const account = useAccount();
  const acct = account.accountId;
  const [pool, setPool] = useState<PoolView | null>((initial?.pool as PoolView | undefined) ?? null);
  const [live, setLive] = useState(false); // false: still the server's cached read
  const [me, setMe] = useState<Lender | null>(null);
  const [bal, setBal] = useState<bigint | null>(null);
  const [lost, setLost] = useState<bigint | null>(initial ? BigInt(initial.lost) : null);
  const [earned, setEarned] = useState<bigint | null>(initial ? BigInt(initial.earned) : null);
  const [dep, setDep] = useState('100');
  const [wd, setWd] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const depTx = useTx(), wdTx = useTx();

  const refresh = useCallback(async () => {
    setPool(await getPool());
    setLive(true);
    fetch('/api/ledger').then((r) => r.json()).then((j) => {
      const t = lenderTotalsOf(j);
      setEarned(BigInt(t.earned)); setLost(BigInt(t.lost));
    }).catch(() => {});
    if (acct) {
      setMe(await view<Lender>(KREDOFI_CONTRACT, 'get_lender', { account_id: acct }));
      setBal(BigInt(await usdcBalance(acct).catch(() => '0')));
    }
  }, [acct]);
  useEffect(() => { refresh().catch(() => {}); const t = setInterval(() => refresh().catch(() => {}), 5000); return () => clearInterval(t); }, [refresh]);

  const start = async () => {
    setBusy(true); setMsg(null);
    try {
      const a = acct ?? (await account.createDemo());
      const r = await fetch('/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: a, purpose: 'lend' }) });
      const j = await r.json();
      setMsg(r.ok ? '500 test USDC arrived.' : j.error);
      await refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not set up the account.'); }
    finally { setBusy(false); }
  };

  const value = BigInt(pool?.pool_value ?? '0'), shares = BigInt(pool?.total_shares ?? '0'), cash = BigInt(pool?.cash ?? '0');
  const myValue = BigInt(me?.value ?? '0'), myShares = BigInt(me?.shares ?? '0');
  const availNow = myValue < cash ? myValue : cash;
  const price = shares > 0n ? Number(value * 1_000_000n / shares) / 1e6 : 1;
  // The deposit starts at what you hold, up to $100, rounded down (audit Nov 7), and follows every balance
  // change (faucet, deposit) until you type your own amount (bug Nov 9: stayed at 5.50 after the faucet).
  const [depTouched, setDepTouched] = useState(false);
  useEffect(() => { if (!depTouched && bal !== null) setDep(defaultDeposit(bal)); }, [bal, depTouched]);
  const depAmt = parseUsd(dep);
  const depErr = depAmt === null || depAmt <= 0n ? 'Enter an amount' : depAmt < 1_000_000n ? 'Deposit at least $1.00' : bal !== null && depAmt > bal ? `You have ${usd(bal)} test USDC` : null;
  const wdAmt = wd === '' ? availNow : parseUsd(wd);
  const wdErr = wdAmt === null || wdAmt <= 0n ? 'Enter an amount' : wdAmt > availNow ? `You can withdraw up to ${usd(availNow)} now` : null;
  // Shares for a dollar amount, rounded down so the payout never exceeds what was asked.
  const wdShares = wdAmt !== null && value > 0n ? (wdAmt === availNow && availNow === myValue ? myShares : (wdAmt * shares) / value) : 0n;

  const deposit = () => depAmt !== null && depTx.run(async () => {
    const out = await account.signAndSend(USDC_CONTRACT, [functionCall('ft_transfer_call', { receiver_id: KREDOFI_CONTRACT, amount: depAmt.toString(), msg: 'deposit' }, 40, 1n)]);
    await refresh(); return out;
  });
  const withdraw = () => wdShares > 0n && wdTx.run(async () => {
    const out = await account.signAndSend(KREDOFI_CONTRACT, [functionCall('withdraw', { shares: wdShares.toString() }, 40, 1n)]);
    setWd(''); await refresh(); return out;
  });

  return (
    <main className="wrap lend-grid">
      <div>
        <h1 style={{ fontSize: 'clamp(40px,4.6vw,66px)', lineHeight: 1.02 }}>Lend test USDC to the pool.</h1>
        <p style={{ fontSize: 17, color: '#BFCDC6', marginTop: 18, maxWidth: 480 }}>
          Borrowers pay 4% to 8% a term. Lenders get half through the share price; the other half goes to the KredoFi treasury. When a loan isn&apos;t repaid, the reserve pays first, up to its balance; lenders take what it can&apos;t cover.
        </p>
        <table className="ledger" style={{ marginTop: 44 }}>
          <caption>The testnet pool, read from {KREDOFI_CONTRACT}</caption>
          <tbody>
            <tr><th scope="row">In the pool</th><td>{pool ? usd(pool.pool_value) : 'loading'}</td></tr>
            <tr><th scope="row">Lent out right now</th><td>{pool ? usd(pool.outstanding) : 'loading'}</td></tr>
            <tr><th scope="row">Reserve, pays losses first</th><td>{pool ? usd(pool.reserve) : 'loading'}</td></tr>
            <tr><th scope="row">Earned by lenders so far (test USDC, testnet)</th><td>{earned !== null ? usd(earned) : 'loading'}</td></tr>
            <tr className="sum"><th scope="row">Lost by lenders so far</th><td>{lost !== null ? usd(lost) : 'loading'}</td></tr>
          </tbody>
        </table>
        <p className="hint" style={{ marginTop: 14 }}>
          {pool ? <>Share price {price.toFixed(4)} USDC (it started at 1.0000).</> : <>Loading live data from {KREDOFI_CONTRACT}. The share price started at 1.0000.</>} It only moves with repaid interest and uncovered losses; nothing here is a forecast.
          {!live && initial && <span className="sr-only"> These numbers were read from the chain at {utcMinuteMs(initial.at)}; an open page refreshes them every 5 seconds.</span>}
        </p>

        <section className="lend-earn" aria-labelledby="earn-h">
          <h2 id="earn-h">How lenders earn</h2>
          <p>Lenders earn only when borrowers repay. Each repaid loan pays flat interest for its term: 4% in band A, 6% in band B, 8% in band C. Half goes to lenders by raising the pool&apos;s share price; the other half goes to the KredoFi treasury. &ldquo;Earned by lenders so far&rdquo; above adds up that half from every repayment on {KREDOFI_CONTRACT}.</p>
          <p>The limits: money that isn&apos;t lent out earns nothing today. The reserve pays losses first; beyond it, lenders can lose money. This is a testnet demo with test USDC.</p>
          <p>Planned, not built: idle pool funds earning a base yield through a NEAR money market.</p>
        </section>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {!acct || (bal !== null && bal < 100_000_000n) ? (
          <div className="panel">
            <h2>{acct ? 'Get test USDC' : 'Start lending'}</h2>
            <p style={{ color: '#BFCDC6' }}>{acct ? (bal ? `${acct} holds ${usd(bal)} test USDC.` : `${acct} has no test USDC yet.`) : 'No wallet needed: we create a demo account, pay its network fees and send it 500 test USDC.'}</p>
            <p style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-light" disabled={busy} onClick={start}>{busy ? 'Setting up…' : 'Get 500 test USDC'}</button>
              {!acct && <button type="button" className="btn btn-ghost" onClick={account.connectWallet}>Connect a wallet instead</button>}
            </p>
            {msg && <p className="hint" aria-live="polite">{msg}</p>}
          </div>
        ) : null}

        <IntentsPanel accountId={acct} balance={bal} onGetTestUsdc={start} busy={busy} />

        {acct && (
          <div className="panel">
            <h2>Your share</h2>
            <dl className="terms">
              <dt>Account</dt><dd className="plain">{acct}</dd>
              <dt>Worth now</dt><dd>{usd(myValue)}</dd>
              <dt>You can withdraw now</dt><dd>{usd(availNow)}{availNow < myValue ? ' (the rest is lent out)' : ''}</dd>
              <dt>Test USDC</dt><dd>{bal !== null ? usd(bal) : '…'}</dd>
            </dl>
          </div>
        )}

        {acct && (
          <div className="panel">
            <h2>Deposit</h2>
            <div className="form">
              <div className="field">
                <label htmlFor="dep">Amount</label>
                <div className="money"><input id="dep" inputMode="decimal" value={dep} onChange={(e) => { setDepTouched(true); setDep(e.target.value); }} /><span>USDC</span></div>
                <span className={`hint${depErr ? ' err' : ''}`}>{depErr ?? 'Shares are minted at the current share price.'}</span>
              </div>
              <TxButton tx={depTx.state} label={`Deposit ${depAmt !== null ? usd(depAmt) : ''}`} onClick={deposit} variant="light" disabled={!!depErr} />
            </div>
            <TxStatus tx={depTx.state} />
          </div>
        )}

        {acct && myShares > 0n && (
          <div className="panel">
            <h2>Withdraw</h2>
            <div className="form">
              <div className="field">
                <label htmlFor="wd">Amount</label>
                <div className="money"><input id="wd" inputMode="decimal" value={wd === '' ? (Number(availNow) / 1e6).toFixed(2) : wd} onChange={(e) => setWd(e.target.value)} /><span>USDC</span></div>
                <span className={`hint${wdErr ? ' err' : ''}`}>{wdErr ?? <>Up to {usd(availNow)} now. <button type="button" className="linkbtn" onClick={() => setWd('')}>Withdraw the most I can</button></>}</span>
              </div>
              <TxButton tx={wdTx.state} label="Withdraw" onClick={withdraw} variant="ghost" disabled={!!wdErr || wdShares === 0n} />
            </div>
            <TxStatus tx={wdTx.state} />
          </div>
        )}
      </div>
    </main>
  );
}
