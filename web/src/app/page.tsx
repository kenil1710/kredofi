import Link from 'next/link';

// The real landing page is built on day 11 from the finished components (DESIGN 7.9).
export default function Home() {
  return (
    <main className="g-night" style={{ minHeight: '100svh', display: 'flex', alignItems: 'center' }}>
      <div className="wrap" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <h1 style={{ fontSize: 'clamp(46px,8vw,120px)', lineHeight: 0.92 }}>Borrow against your payslip.</h1>
        <p style={{ color: '#BFCDC6', maxWidth: 520, fontSize: 18, fontWeight: 300 }}>
          KredoFi reads six months of your bank history inside a sealed computer, works out a limit, and lends you USDC on NEAR.
        </p>
        <p><Link className="btn btn-light" href="/dev/components">See the component sheet</Link></p>
      </div>
    </main>
  );
}
