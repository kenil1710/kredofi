import type { Metadata } from 'next';
import { AppChrome } from '@/components/AppChrome';
import { AppFooter } from '@/components/AppFooter';
import { LenderPage } from '@/components/LenderPage';

export const metadata: Metadata = { title: 'Lend, KredoFi' };

export default function Lend() {
  return (
    <div className="g-deep" style={{ minHeight: '100svh' }}>
      <AppChrome />
      <LenderPage />
      <AppFooter ground="night" />
    </div>
  );
}
