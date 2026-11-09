import type { Metadata, Viewport } from 'next';
import { display, body } from '@/lib/fonts';
import { SkipLink } from '@/components/SkipLink';
import { WalletProvider } from '@/lib/near/wallet';
import { AccountProvider } from '@/lib/near/account';
import './globals.css';

const DESCRIPTION = 'Prove your income on NEAR without showing your bank statements. First use: no-collateral USDC loans.';
// Every page inherits these og:/twitter: tags and the share card (web/public/share-card.png, made by
// scripts/brand/render.mjs; bump ?v= when it changes, X caches by URL). Next.js adds the favicon set
// from app/favicon.ico, icon.svg, icon1-3.png and apple-icon.png.
const CARD = { url: '/share-card.png?v=1', width: 1200, height: 630, type: 'image/png', alt: 'KredoFi seal. Prove your income on NEAR without showing your bank statements. kredofi.xyz' };
export const metadata: Metadata = {
  metadataBase: new URL('https://kredofi.xyz'),
  title: 'KredoFi',
  description: DESCRIPTION,
  openGraph: { type: 'website', siteName: 'KredoFi', title: 'KredoFi: prove your income on NEAR', description: DESCRIPTION, url: '/', images: [CARD] },
  twitter: { card: 'summary_large_image', title: 'KredoFi: prove your income on NEAR', description: DESCRIPTION, images: [CARD] },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#08130F' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <SkipLink />
        <WalletProvider>
          <AccountProvider>{children}</AccountProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
