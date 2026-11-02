import type { Metadata } from 'next';
import { AppChrome } from '@/components/AppChrome';
import { AppFooter } from '@/components/AppFooter';
import { LedgerPage } from '@/components/LedgerPage';

export const metadata: Metadata = { title: 'Public ledger, KredoFi' };

export default function Ledger() {
  return (
    <div className="g-night" style={{ minHeight: '100svh' }}>
      <AppChrome />
      <LedgerPage />
      <AppFooter ground="night" />
    </div>
  );
}
