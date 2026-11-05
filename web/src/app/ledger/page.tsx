import type { Metadata } from 'next';
import { AppChrome } from '@/components/AppChrome';
import { AppFooter } from '@/components/AppFooter';
import { LedgerPage } from '@/components/LedgerPage';
import { ledgerFirstPaint } from '@/lib/ledgerView';
import { ledgerSnapshot } from '@/server/ledgerAnswer';

export const metadata: Metadata = { title: 'Public ledger, KredoFi', description: 'Every score, loan, repayment and default on the KredoFi testnet contract, read from the chain. Bands and amounts only: no names, no bank data.' };
export const revalidate = 60; // first HTML: a cached chain read; the browser then polls every 5 s

export default async function Ledger() {
  const snap = await ledgerSnapshot();
  return (
    <div className="g-night" style={{ minHeight: '100svh' }}>
      <AppChrome />
      <LedgerPage initial={snap && ledgerFirstPaint(snap)} />
      <AppFooter ground="night" />
    </div>
  );
}
