// "How it works" diagram: browser -> contract -> enclave -> contract -> pool. Plain SVG, labelled.
const BOX = { fill: 'var(--paper-2)', stroke: 'var(--ink)', strokeWidth: 1.2 };

export function DocsDiagram() {
  const box = (x: number, y: number, w: number, title: string, lines: string[], tone?: 'night') => (
    <g>
      <rect x={x} y={y} width={w} height={34 + lines.length * 18} rx={3} {...BOX} fill={tone ? '#10302A' : BOX.fill} />
      <text x={x + 14} y={y + 24} fontFamily="var(--display)" fontSize={17} fill={tone ? '#E6EAE1' : '#10302A'}>{title}</text>
      {lines.map((l, k) => <text key={k} x={x + 14} y={y + 46 + k * 18} fontSize={12.5} fill={tone ? '#BFCDC6' : '#2C4A41'}>{l}</text>)}
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number, label: string, lx: number, ly: number) => (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#4A2C8C" strokeWidth={1.5} markerEnd="url(#kf-arrow)" />
      <text x={lx} y={ly} fontSize={12} fill="#4A2C8C">{label}</text>
    </g>
  );
  return (
    <figure className="doc-diagram">
      <svg viewBox="0 0 760 340" role="img" aria-labelledby="kf-diag-t kf-diag-d">
        <title id="kf-diag-t">How a KredoFi score and loan flow</title>
        <desc id="kf-diag-d">The browser gets a one-time token from Plaid and asks the KredoFi contract for a score. The contract asks OutLayer to run the pinned scorer inside Intel TDX. The scorer fetches the bank history from Plaid, scores it and returns only a band, a score, an income cap, a fingerprint and a sealed name to the contract's private callback. The borrower then borrows from and repays to the lender pool; the reserve pays losses first.</desc>
        <defs><marker id="kf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#4A2C8C" /></marker></defs>
        {box(20, 20, 210, 'Your browser', ['Plaid Link login', 'one-time public token', 'fresh reply key'])}
        {box(275, 20, 210, 'KredoFi contract', ['request_score', 'pins the scorer hash', 'accepts only on_score'])}
        {box(530, 20, 210, 'Enclave (Intel TDX)', ['pinned scorer WASM', 'fetches from Plaid', 'five rules, seals name'], 'night')}
        {box(530, 200, 210, 'Plaid', ['bank history,', 'read-only, removed', 'after one fetch'])}
        {box(275, 230, 210, 'On-chain result', ['band, score, income cap', 'fingerprint, sealed name', 'no transactions'])}
        {box(20, 230, 210, 'Lender pool', ['borrow, repay', 'reserve pays losses first', 'lenders + treasury split'])}
        {arrow(230, 60, 273, 60, 'token', 236, 52)}
        {arrow(485, 60, 528, 60, 'run', 494, 52)}
        {arrow(635, 112, 635, 198, 'fetch', 642, 160)}
        {arrow(560, 112, 440, 226, 'one line', 500, 160)}
        {arrow(275, 290, 232, 290, 'limit', 238, 282)}
      </svg>
    </figure>
  );
}
