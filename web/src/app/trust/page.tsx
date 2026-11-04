import { TRUST_ROWS, splitCode } from '@/lib/trustModel';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AppChrome } from '@/components/AppChrome';
import { AppFooter } from '@/components/AppFooter';
import { GuillocheStrip } from '@/components/GuillocheStrip';
import { SandboxBanner } from '@/components/SandboxBanner';
import { IN_ENCLAVE, NETWORK } from '@/lib/config';

export const metadata: Metadata = { title: 'Why is this safe?, KredoFi', description: 'What KredoFi reads, where it is scored, what leaves, who holds the money, and what is test only.' };

const TX_SCORE = 'https://nearblocks.io/txns/3nbdkFd3uNeeoYhqmE2AQHuRMXLZYbDhEZAUzsVDFGzo';

export default function Trust() {
  return (
    <div className="g-paper" style={{ minHeight: '100svh' }}>
      <AppChrome />
      <main className="wrap trust">
        <article className="doc">
          <GuillocheStrip height={12} />
          <p className="doc-kicker">Why is this safe?</p>
          <h1>{NETWORK === 'testnet' && !IN_ENCLAVE ? 'Who sees your bank data.' : 'Your bank data stays sealed.'}</h1>
          <p className="doc-summary">A two-minute read. Every point links to the full details in the <Link href="/docs">docs</Link>.</p>
          <SandboxBanner link={false} />

          <h2 id="what-we-read">What we read</h2>
          <p>The scorer fetches your transactions from the bank, up to two years, and uses only the <b>last 6 full months</b> of your main account to work out your income and spending patterns: money in, money out, overdraft fees and your balance. On this demo, that is Plaid&apos;s test bank. <Link href="/docs/scoring-model">The five rules</Link></p>

          <h2 id="where-its-scored">Where it&apos;s scored</h2>
          <p><b>On mainnet:</b> inside a sealed enclave (OutLayer, Intel TDX), not on our server; Intel TDX is designed so the machine&apos;s operator can&apos;t read it. Your one-time bank token goes on-chain sealed to the scorer together with your account, so a copy is useless to anyone else. One caveat: the developer holds the sealing key and the Plaid keys the enclave uses, so could in principle open your token and use it first; your score would then fail. Production would keep those keys only in the enclave. A real mainnet score: <a href={TX_SCORE} target="_blank" rel="noreferrer">transaction</a>. <Link href="/mainnet" prefetch={false}>Mainnet proof, live</Link>.</p>
          {IN_ENCLAVE
            ? <p><b>On this testnet demo:</b> the same way, in OutLayer&apos;s testnet enclave, with a published testnet build of the scorer (it differs only in tying Plaid&apos;s shared test login to your account). Your bank token is sealed to the enclave together with your account before it goes on-chain, so a copied token is refused. Our server never sees the bank data. It does get your band and rule results in words if your browser asks for the plain-English summary. <Link href="/docs/testnet-vs-mainnet">Testnet vs mainnet</Link></p>
            : <p><b>On this testnet demo, honestly:</b> the same pinned scorer runs on our server, outside an enclave, so that server sees the test bank data while it scores. It keeps only the public result. <Link href="/docs/testnet-vs-mainnet">Testnet vs mainnet</Link></p>}

          <h2 id="what-leaves">What leaves</h2>
          <p>Eight fields and nothing else: <code>v</code>, <code>caller</code>, <code>band</code>, <code>score</code>, <code>income_cap</code> (the most your limit can be), <code>fingerprint</code>, <code>sealed_identity</code> (your name, sealed) and <code>reply</code> (your rule results, sealed to your browser). The chain never sees the raw data, and nobody outside can verify the enclave deletes it when the run ends. Today the developer holds the sealing key (production would make it inside the enclave).{IN_ENCLAVE ? '' : ' A real receipt from this demo:'}</p>
          {!IN_ENCLAVE && <blockquote className="trust-receipt">Plaid sent 386 transactions from 14 accounts; the scorer read the last 6 months (36 transactions from your main account), and none of it left.</blockquote>}
          <p>And everything that went on-chain for that score:</p>
          <pre className="doc-code"><code>{`{
  "band": "B",
  "score": 720,
  "income_cap": 250000000,        // $250, the most your limit can be
  "fingerprint": "7be4d3a3…2cd5", // one bank identity, one borrower
  "sealed_identity": "KbZjE5/i…", // your name, encrypted
  "v": 1
  // plus "caller" (your account) and "reply" (rule results, sealed to your browser)
}`}</code></pre>
          <p>No transactions, balances, account numbers or names. The bank connection is removed after one fetch. <Link href="/docs/privacy">Privacy &amp; the enclave</Link></p>

          <h2 id="what-you-can-check">What you can check yourself</h2>
          <ul>
            {IN_ENCLAVE
              ? <li>The scorer is a <b>pinned public WASM</b>, on mainnet and on this testnet demo: its SHA-256 is fixed in the contract, and anyone can download the file and check the hash.</li>
              : <li>The mainnet scorer is a <b>pinned public WASM</b>: its SHA-256 is fixed in the contract, and anyone can download the file and check the hash. The testnet demo build is pinned the same way but isn&apos;t published as a file yet.</li>}
            {IN_ENCLAVE
              ? <li>The contract accepts a score <b>only from that exact scorer</b>, through its own request to the enclave.</li>
              : <li>On mainnet the contract accepts a score <b>only from that exact scorer</b>, through its own request to the enclave. On this testnet demo it accepts scores from our scorer account (Dev mode), so here you trust our server to run that scorer unchanged.</li>}
            <li><b>Each enclave run has an attestation</b> signed through Intel: this input and output, this pinned scorer, on a build approved on <code>worker.outlayer.near</code>. <a href="https://app.outlayer.ai/attestation/1257953" target="_blank" rel="noreferrer">The 3 November mainnet run</a>, or check it yourself with <Link href="/docs/verify">OutLayer&apos;s verifier</Link>. It proves which build ran, not that the build keeps nothing, and OutLayer decides which builds are approved.</li>
            <li>Only you can ask for your score: each request is signed with your account&apos;s own key.</li>
            <li>Every score, loan, repayment and default is a <b>public transaction</b> on the <Link href="/ledger">ledger</Link>.</li>
          </ul>
          <p><Link href="/docs/verify">Verify it yourself, step by step</Link> · <Link href="/mainnet" prefetch={false}>Mainnet proof, live</Link></p>

          <h2 id="who-holds-what">Who you still have to trust</h2>
          <p>Checking the code doesn&apos;t cover the people holding keys. Today most of them are one person, the developer. This is a hackathon MVP with $0 in the mainnet pool, and it would not be safe for real money as it stands.</p>
          <div className="doc-table"><table>
            <thead><tr><th>What</th><th>Who holds it today</th><th>What they could do if misused</th><th>How the Pilot removes it</th></tr></thead>
            <tbody>{TRUST_ROWS.map((r) => <tr key={r.what}>{[r.what, r.holder, r.misuse, r.pilot].map((c, i) => <td key={i}>{splitCode(c).map((x, j) => x.code ? <code key={j}>{x.text}</code> : <span key={j}>{x.text}</span>)}</td>)}</tr>)}</tbody>
          </table></div>
          <p>The Pilot column is a plan, not something built, except the 24 h scorer time lock. <Link href="/docs/roadmap">Roadmap</Link> · <Link href="/docs/security">Security</Link></p>

          <h2 id="who-holds-the-money">Who holds the money</h2>
          <p>The smart contract, not KredoFi. No owner action can move the pool&apos;s cash, outstanding loans or the reserve; the owner can only take the treasury&apos;s share of interest. One honest caveat: the contract&apos;s keys can still deploy new code, which is why locking them is first on the <Link href="/docs/roadmap">roadmap</Link>. <Link href="/docs/fees-treasury">Fees &amp; treasury</Link></p>

          <h2 id="if-you-dont-repay">What if you don&apos;t repay</h2>
          <p>After the due date and a grace period, anyone can mark the loan as defaulted. The reserve pays lenders back first, up to its balance, the borrower can never borrow again, and their sealed name is released only to the recovery partner. <Link href="/docs/borrowers">For borrowers</Link></p>

          <h2 id="testnet-vs-mainnet">Testnet vs mainnet, honestly</h2>
          <ul>
            <li>This demo is <b>testnet</b>: test bank, test USDC, no real money, {IN_ENCLAVE ? 'and the scorer runs in OutLayer\'s testnet enclave.' : 'and the scorer runs on our server.'}</li>
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
