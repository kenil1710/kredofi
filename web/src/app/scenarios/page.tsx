import type { Metadata } from 'next';
import { AppChrome } from '@/components/AppChrome';
import { AppFooter } from '@/components/AppFooter';
import { Passbook } from '@/components/Passbook';
import { AccountProvider } from '@/lib/near/account';

export const metadata: Metadata = { title: 'Demo scenarios, KredoFi' };

// Prepared borrowers (Riya, Sam, Max) and build-your-own, on their own demo account (slot), so a
// scenario such as Max's default never touches the visitor's own passbook on /borrow.
export default function ScenariosPage() {
  return (
    <AccountProvider slot="scenarios">
      <div className="g-paper" style={{ minHeight: '100svh' }}>
        <AppChrome />
        <Passbook mode="scenarios" />
        <AppFooter />
      </div>
    </AccountProvider>
  );
}
