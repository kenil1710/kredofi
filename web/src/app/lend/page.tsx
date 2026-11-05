import type { Metadata } from 'next';
import { AppChrome } from '@/components/AppChrome';
import { AppFooter } from '@/components/AppFooter';
import { LenderPage } from '@/components/LenderPage';
import { lendFirstPaint } from '@/lib/ledgerView';
import { ledgerSnapshot } from '@/server/ledgerAnswer';

export const metadata: Metadata = { title: 'Lend, KredoFi', description: 'Lend test USDC to the KredoFi pool on NEAR testnet. Lenders earn through the share price; the reserve pays losses first, up to its balance.' };
export const revalidate = 60; // first HTML: a cached chain read; the browser then refreshes every 5 s

export default async function Lend() {
  const snap = await ledgerSnapshot();
  return (
    <div className="g-deep" style={{ minHeight: '100svh' }}>
      <AppChrome />
      <LenderPage initial={snap && lendFirstPaint(snap)} />
      <AppFooter ground="night" />
    </div>
  );
}
