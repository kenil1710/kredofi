// Calm reminder wherever a bank login is involved (Connect bank, Plaid opening, scoring, /scenarios).
import Link from 'next/link';

export function SandboxBanner({ link = true }: { link?: boolean }) {
  return (
    <aside className="sandbox-banner" aria-label="Test bank only">
      <p><b>Test bank only:</b> this is Plaid&apos;s sandbox. Log in with <code>user_good</code> / <code>pass_good</code>. Never enter your real bank details. Testnet, no real money.</p>
      {link && <Link href="/trust">Why is this safe?</Link>}
    </aside>
  );
}
