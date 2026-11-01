import type { Metadata } from 'next';
import { AppChrome } from '@/components/AppChrome';
import { Passbook } from '@/components/Passbook';

export const metadata: Metadata = { title: 'Your passbook, KredoFi' };

export default function BorrowPage() {
  return (
    <div className="g-paper" style={{ minHeight: '100svh' }}>
      <AppChrome />
      <Passbook />
    </div>
  );
}
