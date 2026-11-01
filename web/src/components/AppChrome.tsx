'use client';
// App top bar + the testnet banner (passbook reference; DESIGN 3 and 7.1: banner never hidden).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWallet } from '@/lib/near/wallet';
import { NETWORK } from '@/lib/config';

const LINKS = [['/borrow', 'Borrow'], ['/lend', 'Lend'], ['/ledger', 'Public ledger']] as const;

export function AppChrome() {
  const path = usePathname();
  const { accountId, connect, disconnect } = useWallet();
  return (
    <>
      <header className="banner">
        <div className="wrap">
          <Link className="logo" href="/">KredoFi</Link>
          <nav aria-label="Main">
            {LINKS.map(([href, text]) => (
              <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>{text}</Link>
            ))}
          </nav>
          {accountId ? (
            <button type="button" className="chip" onClick={disconnect} title="Sign out">{accountId}</button>
          ) : (
            <button type="button" className="chip" onClick={connect}>Connect wallet</button>
          )}
        </div>
      </header>
      {NETWORK === 'testnet' && <p className="testnet">Testnet demo. Test banks and test money only.</p>}
    </>
  );
}
