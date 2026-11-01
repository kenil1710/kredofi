import type { Metadata, Viewport } from 'next';
import { display, body } from '@/lib/fonts';
import { WalletProvider } from '@/lib/near/wallet';
import { AccountProvider } from '@/lib/near/account';
import './globals.css';

export const metadata: Metadata = {
  title: 'KredoFi',
  description: 'Borrow against your payslip. Private, income-based USDC loans on NEAR.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#08130F' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <WalletProvider>
          <AccountProvider>{children}</AccountProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
