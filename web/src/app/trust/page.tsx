import type { Metadata } from 'next';
import Link from 'next/link';
import { AppChrome } from '@/components/AppChrome';
import { AppFooter } from '@/components/AppFooter';
import { GuillocheStrip } from '@/components/GuillocheStrip';
import { SandboxBanner } from '@/components/SandboxBanner';

export const metadata: Metadata = { title: 'Why is this safe?, KredoFi', description: 'What KredoFi reads, where it is scored, what leaves, who holds the money, and what is test only.' };

const TX_SCORE = 'https://nearblocks.io/txns/4dgHrA97KfibKifZuVZ2YF5zoAVCy4m2pXxxf9zdijyu';

export default function Trust() {
  return (
    <div className="g-paper" style={{ minHeight: '100svh' }}>
      <AppChrome />
      <main className="wrap trust">
        <article className="doc">
          <GuillocheStrip height={12} />
          <p className="doc-kicker">Why is this safe?</p>
          <h1>Your bank data stays sealed.</h1>
          <p className="doc-summary">A two-minute read. Every point links to the full details in the <Link href="/docs">docs</Link>.</p>
          <SandboxBanner link={false} />

          <h2 id="what-we-read">What we read</h2>
          <p>The scorer fetches your transactions from the bank, up to two years, and uses only the <b>last 6 full months</b> of your main account to work out your income and spending patterns: money in, money out, overdraft fees and your balance. On this demo, that is Plaid&apos;s test bank. <Link href="/docs/scoring-model">The five rules</Link></p>

          <h2 id="where-its-scored">Where it&apos;s scored</h2>
          <p><b>On mainnet:</b> inside a sealed enclave (OutLayer, Intel TDX). Not on our server and not by us; even the machine&apos;s operator can&apos;t read it. A real mainnet score: <a href={TX_SCORE} target="_blank" rel="noreferrer">transaction</a>.</p>
          <p><b>On this testnet demo, honestly:</b> the same pinned scorer runs on our server, outside an enclave, so that server sees the test bank data while it scores. It keeps only the public result. <Link href="/docs/testnet-vs-mainnet">Testnet vs mainnet</Link></p>

          <h2 id="what-leaves">What leaves</h2>
          <p>Only a band, a score, an income cap (the most your limit can be), a fingerprint and your name sealed so nobody can read it. A real receipt from this demo:</p>
          <blockquote className="trust-receipt">Plaid sent 386 transactions from 14 accounts; the scorer read the last 6 months (36 transactions from your main account), and none of it left.</blockquote>
          <p>And everything that went on-chain for that score:</p>
          <pre className="doc-code"><code>{`{
  "band": "B",
  "score": 720,
  "income_cap": 250000000,        // $250, the most your limit can be
  "fingerprint": "7be4d3a3…2cd5", // one bank identity, one borrower
  "sealed_identity": "KbZjE5/i…", // your name, encrypted
  "v": 1
}`}</code></pre>
          <p>No transactions, balances, account numbers or names. The bank connection is removed after one fetch. <Link href="/docs/privacy">Privacy &amp; the enclave</Link></p>

          <h2 id="why-you-dont-have-to-trust-us">Why you don&apos;t have to trust us</h2>
          <ul>
            <li>The scorer is a <b>pinned public WASM</b>: its SHA-256 is fixed in the contract, and anyone can download the file and check the hash.</li>
            <li>The contract accepts a score <b>only from that exact scorer</b>, through its own request.</li>
            <li>Only you can ask for your score: each request is signed with your account&apos;s own key.</li>
            <li>Every score, loan, repayment and default is a <b>public transaction</b> on the <Link href="/ledger">ledger</Link>.</li>
          </ul>
          <p><Link href="/docs/verify">Verify it yourself, step by step</Link></p>

          <h2 id="who-holds-the-money">Who holds the money</h2>
          <p>The smart contract, not KredoFi. No owner action can move the pool&apos;s cash, outstanding loans or the reserve; the owner can only take the treasury&apos;s share of interest. One honest caveat: the contract&apos;s keys can still deploy new code, which is why locking them is first on the <Link href="/docs/roadmap">roadmap</Link>. <Link href="/docs/fees-treasury">Fees &amp; treasury</Link></p>

          <h2 id="if-you-dont-repay">What if you don&apos;t repay</h2>
          <p>After the due date and a grace period, anyone can mark the loan as defaulted. The reserve pays lenders back first, the borrower can never borrow again, and their sealed name is released only to the recovery partner. <Link href="/docs/borrowers">For borrowers</Link></p>

          <h2 id="testnet-vs-mainnet">Testnet vs mainnet, honestly</h2>
          <ul>
            <li>This demo is <b>testnet</b>: test bank, test USDC, no real money, and the scorer runs on our server.</li>
            <li><b>Mainnet</b> (<code>kredofi.near</code>) scores inside the enclave and has produced a real score, but has made no loans yet.</li>
            <li>Bank data is Plaid&apos;s sandbox only; real banks need production access and a licensed lending partner.</li>
          </ul>

          <h2 id="who-built-it">Who built it</h2>
          <p>Kenil Vekariya (Kency), Surat, India. X: <a href="https://x.com/vekariya_kenil" target="_blank" rel="noreferrer">@vekariya_kenil</a>. Built for the NEAR Hackathon, November 2026.</p>

          <h2 id="faq">FAQ</h2>
          <h3>Can KredoFi see my bank password?</h3>
          <p>No. You log in inside Plaid&apos;s window; we only get a one-time token.</p>
          <h3>Is my bank data stored?</h3>
          <p>No. The scorer reads it, keeps only the result, and removes the bank connection after scoring.</p>
          <h3>Is this real money?</h3>
          <p>Not on this testnet demo: test USDC and a test bank.</p>
          <p className="doc-pager"><Link href="/docs">Read the full docs →</Link><Link href="/borrow">Check my limit →</Link></p>
        </article>
      </main>
      <AppFooter />
    </div>
  );
}
