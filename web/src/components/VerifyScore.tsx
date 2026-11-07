'use client';
// "Verify my score" on the passbook's score entry. Shows only what /api/verify-score established (lib/verifyScore.ts).
import Link from 'next/link';
import { useState } from 'react';
import { resultFromResponse, type VerifyResult } from '@/lib/verifyScore';

const short = (h: string) => `${h.slice(0, 8)}…`;
const STEPS = <Link href="/docs/verify#3c-your-own-score" prefetch={false}>Full steps to check it yourself</Link>;

export function VerifyScore({ accountId, txHash }: { accountId: string; txHash: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const check = async () => {
    setBusy(true); setResult(null);
    try {
      const res = await fetch('/api/verify-score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId, txHash }) });
      setResult(resultFromResponse(res.ok, await res.json().catch(() => null)));
    } catch {
      setResult(resultFromResponse(false, null));
    } finally { setBusy(false); }
  };

  return (
    <div className="verify-score" aria-live="polite">
      {result?.status !== 'proven' && result?.status !== 'failed' && (
        <button type="button" className="btn btn-ink" disabled={busy} onClick={check}>{busy ? 'Checking the attestation…' : result ? 'Try again' : 'Verify my score'}</button>
      )}
      {busy && <p className="hint">Running OutLayer&apos;s verifier on your transaction. This takes about 10 seconds.</p>}
      {result?.status === 'proven' && (
        <>
          <p className="verify-head proven">PROVEN</p>
          <ul className="verify-checks">
            <li><b>Intel signature valid.</b> {result.intel}.</li>
            <li><b>Approved build.</b> Scorer <code>{short(result.scorer)}</code> is the {result.network} build this contract pins; the enclave&apos;s measurements are approved on {result.approvedOn}.</li>
            <li><b>Input and output bound to this transaction.</b> The signed quote covers input <code>{short(result.inputHash)}</code> and output <code>{short(result.outputHash)}</code>, and both match the bytes on-chain.</li>
            <li><b>Your score.</b> The signed output is your account&apos;s current on-chain band, score and fingerprint.</li>
          </ul>
          <p className="hint">Our server ran this check. To rely on nobody, run it yourself: <code>{result.command}</code></p>
          <p className="hint">It doesn&apos;t prove the income is real (this is Plaid&apos;s test bank), or that the enclave deleted the data after the run. {STEPS}</p>
        </>
      )}
      {result?.status === 'failed' && (
        <>
          <p className="verify-head failed">NOT PROVEN</p>
          <p>{result.reason}</p>
          <p className="hint">{STEPS}</p>
        </>
      )}
      {result?.status === 'unavailable' && (
        <>
          <p className="verify-head">Can&apos;t verify right now</p>
          <p>{result.reason}</p>
          <p className="hint">{STEPS}</p>
        </>
      )}
    </div>
  );
}
