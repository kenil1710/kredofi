import type { Metadata } from 'next';
import { AppChrome } from '@/components/AppChrome';
import { AppFooter } from '@/components/AppFooter';
import { PartnerVault } from '@/components/PartnerVault';
import { AccountProvider } from '@/lib/near/account';

export const metadata: Metadata = {
  title: 'Partner vault, KredoFi',
  description: 'A second contract reads your KredoFi band and sets your collateral terms. Testnet demo with test USDC.',
};

// ?slot=scenarios uses the account from /scenarios (prepared borrowers), so a band A or D can be tried
// without touching the visitor's own passbook.
export default async function IntegratePage({ searchParams }: { searchParams: Promise<{ slot?: string }> }) {
  const { slot } = await searchParams;
  const scenarios = slot === 'scenarios';
  const page = (
    <div className="g-paper" style={{ minHeight: '100svh' }}>
      <AppChrome />
      <PartnerVault scenarios={scenarios} />
      <AppFooter />
    </div>
  );
  return scenarios ? <AccountProvider slot="scenarios">{page}</AccountProvider> : page;
}
