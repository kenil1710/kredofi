// Engraved strip along the top of cheques and borrower cards (references: strip()).
export function GuillocheStrip({ height = 10 }: { height?: number }) {
  const mid = height / 2, amp = height === 12 ? 4.5 : 4;
  const paths = [0, 1, 2, 3].map((u) => {
    let d = '';
    for (let x = 0; x <= 400; x += 2) {
      d += `${x ? 'L' : 'M'}${x} ${(mid + amp * Math.sin((x / 400) * Math.PI * 2 * 28 + (u * Math.PI) / 2)).toFixed(1)} `;
    }
    return d;
  });
  return (
    <svg className="strip" viewBox={`0 0 400 ${height}`} preserveAspectRatio="none" aria-hidden="true"
      style={{ position: 'absolute', left: 0, right: 0, top: 0, width: '100%', height }}>
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#1F4A3D" strokeWidth=".6" strokeOpacity=".6" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
