// Footer for the app screens. "Demo scenarios" (prepared borrowers) is linked only from footers.
import Link from 'next/link';

export function AppFooter({ ground = 'paper' }: { ground?: 'paper' | 'night' }) {
  return (
    <footer className={`appfoot ${ground}`}>
      <div className="wrap">
        <p>KredoFi, built for NEAR HACKATHON in November 2026. Testnet, Plaid sandbox data only; not a lending offer.</p>
        <p><Link href="/trust">Why is this safe?</Link> · <Link href="/docs">Docs</Link> · <Link href="/ledger">Public ledger</Link> · <Link href="/integrate" prefetch={false}>Partner vault</Link> · <Link href="/scenarios">Demo scenarios</Link></p>
      </div>
    </footer>
  );
}
