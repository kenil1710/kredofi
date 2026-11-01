// The KredoFi credit note, drawn on canvas from data (DESIGN 2.1).
// Ported line for line from drawNote() in docs/landing-reference.html (identical in
// docs/passbook-reference.html). Additions, all optional with the reference's defaults:
//   serial / proof : the serial number (fingerprint) and the proof line come from data
//   draw           : 0..1, strokes the engraved rope border in like ink (DESIGN 7.4 #1)
//   fonts          : real CSS family names (next/font hashes them; see lib/fonts.ts)

export type Ovi = { x: number; y: number };

export type NoteData = {
  name?: string;
  band?: string;
  amount?: number | string;
  words?: string;
  repay?: string;
  denied?: boolean;
  /** Shown twice, like a banknote serial. The reference uses 'KF 9C1E 4A7B'. */
  serial?: string;
  /** Small line under the signature rule. */
  proof?: string;
};

export type NoteFonts = { display: string; body: string };

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Serial from a 64-hex fingerprint: 'KF 9C1E 4A7B' style (first 8 hex, upper case). */
export function serialFromFingerprint(fp: string): string {
  const h = fp.replace(/[^0-9a-f]/gi, '').slice(0, 8).toUpperCase().padEnd(8, '0');
  return `KF ${h.slice(0, 4)} ${h.slice(4, 8)}`;
}

export function drawNote(
  ctx: CanvasRenderingContext2D,
  W: number,
  _H: number,
  ovi: Ovi,
  o: NoteData = {},
  fonts: NoteFonts = { display: '"Bodoni Moda"', body: '"Public Sans"' },
  draw = 1,
) {
  const NM = o.name || 'riya.testnet';
  const BD = o.band || 'A';
  const AMT = o.amount === undefined ? 100 : o.amount;
  const WD = o.words || 'One hundred US dollars, in USDC';
  const RP = o.repay || '24 November 2026, $104';
  const SER = o.serial || 'KF 9C1E 4A7B';
  const PROOF = o.proof || 'Scored inside Intel TDX, transaction 8u8RsN…fbW';
  const D = `${fonts.display}, Didot, Georgia, serif`;
  const B = `${fonts.body}, Arial, sans-serif`;
  const rope = clamp(draw / 0.8);
  const ink = clamp((draw - 0.3) / 0.7);

  const s = W / 1100;
  ctx.save();
  ctx.scale(s, s);
  const g = ctx.createLinearGradient(0, 0, 1100, 440);
  g.addColorStop(0, '#E7EEE7');
  g.addColorStop(0.5, '#EFEDF3');
  g.addColorStop(1, '#E6EEE8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1100, 540);

  ctx.globalAlpha = ink;
  ctx.strokeStyle = '#B9CBC1';
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 24; i++) {
    const y0 = 30 + i * 21, ph = i * 0.55;
    ctx.beginPath();
    for (let x = 0; x <= 1100; x += 6) {
      const t = (x / 1100) * Math.PI * 2;
      const y = y0 + 7 * Math.sin(t * 6 + ph) + 3 * Math.sin(t * 17 - ph);
      if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  const R = rng(42), cols = ['#B3261E', '#2F5DA8', '#4A2C8C', '#1F6B52'];
  ctx.lineWidth = 0.8;
  ctx.globalAlpha = 0.55 * ink;
  for (let j = 0; j < 40; j++) {
    const fx = R() * 1100, fy = R() * 540, a = R() * Math.PI, len = 6 + R() * 10;
    ctx.strokeStyle = cols[j % 4];
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo(fx + Math.cos(a) * len * 0.5 + (R() - 0.5) * 6, fy + Math.sin(a) * len * 0.5 + (R() - 0.5) * 6, fx + Math.cos(a) * len, fy + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = ink;
  // watermark
  ctx.fillStyle = 'rgba(246,247,242,.88)';
  ctx.beginPath(); ctx.ellipse(975, 230, 70, 95, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(16,48,42,.22)'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.arc(975, 230, 40, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(975, 230, 34, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(958, 231); ctx.lineTo(969, 242); ctx.lineTo(991, 218); ctx.stroke();
  ctx.globalAlpha = 1;

  // frame ropes (stroked in like ink while `draw` < 1)
  function band(x0: number, y0: number, w: number, h: number, amp: number, waves: number, phase: number, lw: number) {
    const L = 2 * (w + h), n = 1400, last = Math.round(n * rope);
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let k = 0; k <= last; k++) {
      const d = (k / n) * L;
      let px: number, py: number, nx: number, ny: number;
      if (d < w) { px = x0 + d; py = y0; nx = 0; ny = -1; }
      else if (d < w + h) { px = x0 + w; py = y0 + d - w; nx = 1; ny = 0; }
      else if (d < 2 * w + h) { px = x0 + w - (d - w - h); py = y0 + h; nx = 0; ny = 1; }
      else { px = x0; py = y0 + h - (d - 2 * w - h); nx = -1; ny = 0; }
      const off = amp * Math.sin((2 * Math.PI * waves * k) / n + phase);
      const X = px + nx * off, Y = py + ny * off;
      if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
    }
    if (last === n) ctx.closePath();
    ctx.stroke();
  }
  if (rope > 0) {
    ctx.strokeStyle = '#1F4A3D';
    band(32, 32, 1036, 476, 0, 1, 0, 1.3);
    band(40, 40, 1020, 460, 5, 120, 0, 0.7); band(40, 40, 1020, 460, 5, 120, Math.PI, 0.7);
    band(48, 48, 1004, 444, 3, 180, 0.8, 0.5); band(48, 48, 1004, 444, 3, 180, 0.8 + Math.PI, 0.5);
  }
  ctx.globalAlpha = ink;
  ctx.lineWidth = 1; ctx.strokeRect(62, 62, 976, 416);
  // rosette
  ctx.globalAlpha = 0.7 * ink; ctx.lineWidth = 0.55;
  for (let r = 0; r < 12; r++) {
    const ph2 = (r * Math.PI * 2) / (12 * 20);
    ctx.beginPath();
    for (let si = 0; si <= 360; si++) {
      const tt = (si / 360) * Math.PI * 2, rr = 1 + 0.045 * Math.sin(20 * tt + ph2);
      const X2 = 760 + 128 * rr * Math.cos(tt), Y2 = 262 + 158 * rr * Math.sin(tt);
      if (si) ctx.lineTo(X2, Y2); else ctx.moveTo(X2, Y2);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = ink;
  ctx.fillStyle = '#EEF1EA';
  ctx.beginPath(); ctx.ellipse(760, 262, 96, 126, 0, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 1; ctx.stroke();
  const og = ctx.createLinearGradient(640, 140 + ovi.y * 120, 880, 380 - ovi.y * 120);
  og.addColorStop(0, '#1F6B52'); og.addColorStop(clamp(0.2 + 0.6 * ovi.x, 0.05, 0.95), '#B07035'); og.addColorStop(1, '#4A2C8C');
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = og; ctx.font = `700 190px ${D}`; ctx.fillText(BD, 760, 330);
  ctx.fillStyle = '#1F4A3D'; ctx.font = `600 11px ${B}`; spaced('BAND', 760, 366, 3, 'center');
  // thread
  ctx.fillStyle = 'rgba(74,44,140,.84)';
  for (let q = 0; q < 9; q++) ctx.fillRect(598, 70 + q * 46, 12, 30);
  ctx.save(); ctx.translate(606, 72); ctx.rotate(Math.PI / 2);
  ctx.fillStyle = '#EDE7FA'; ctx.font = `700 5px ${B}`; ctx.textAlign = 'left';
  ctx.fillText('KREDOFI SEALED  '.repeat(10).trim(), 0, 2);
  ctx.restore();
  // text
  ctx.textAlign = 'left';
  ctx.fillStyle = '#4A2C8C'; ctx.font = `600 21px ${D}`; spaced(SER, 96, 112, 2, 'left');
  ctx.fillStyle = '#10302A'; ctx.font = `600 22px ${D}`; spaced('KREDOFI CREDIT NOTE', 470, 112, 6, 'center');
  ctx.fillStyle = '#1F4A3D'; ctx.font = `700 40px ${D}`; ctx.textAlign = 'right'; ctx.fillText(String(AMT), 1004, 116); ctx.textAlign = 'left';
  const lab = `600 11px ${B}`;
  ctx.fillStyle = '#4E635B'; ctx.font = lab; spaced('PAY TO', 96, 176, 2, 'left');
  ctx.fillStyle = '#10302A'; ctx.font = `italic 400 32px ${D}`; ctx.fillText(NM, 96, 210);
  ctx.fillStyle = '#4E635B'; ctx.font = lab; spaced('THE SUM OF', 96, 256, 2, 'left');
  ctx.fillStyle = '#10302A'; ctx.font = `400 27px ${D}`; ctx.fillText(WD, 96, 290);
  ctx.fillStyle = '#4E635B'; ctx.font = lab; spaced('REPAY BY', 96, 336, 2, 'left');
  ctx.fillStyle = '#10302A'; ctx.font = `400 27px ${D}`; ctx.fillText(RP, 96, 370);
  ctx.strokeStyle = '#10302A'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(96, 420); ctx.lineTo(420, 420); ctx.stroke();
  ctx.fillStyle = '#4E635B'; ctx.font = `400 12px ${B}`; ctx.fillText(PROOF, 96, 440);
  const og2 = ctx.createLinearGradient(850, 380 + ovi.y * 60, 1010, 470 - ovi.y * 60);
  og2.addColorStop(0, '#1F6B52'); og2.addColorStop(clamp(0.2 + 0.6 * ovi.x, 0.05, 0.95), '#B07035'); og2.addColorStop(1, '#4A2C8C');
  ctx.fillStyle = og2; ctx.font = `700 92px ${D}`; ctx.textAlign = 'right'; ctx.fillText('$' + AMT, 1004, 462); ctx.textAlign = 'left';
  ctx.fillStyle = '#4A2C8C'; ctx.font = `600 17px ${D}`; spaced(SER, 96, 470, 2, 'left');
  ctx.fillStyle = '#1F4A3D'; ctx.font = `400 4.2px ${B}`; ctx.textAlign = 'center';
  ctx.fillText(Array(3).fill('THIS NOTE IS BACKED BY SIX MONTHS OF INCOME READ IN PRIVATE AND BY NOTHING ELSE').join('     '), 550, 497);
  ctx.globalAlpha = 1;
  if (o.denied) {
    ctx.save(); ctx.translate(550, 280); ctx.rotate(-0.18);
    ctx.strokeStyle = '#A3241C'; ctx.fillStyle = '#A3241C';
    ctx.lineWidth = 5; ctx.strokeRect(-250, -58, 500, 116);
    ctx.lineWidth = 2; ctx.strokeRect(-240, -48, 480, 96);
    ctx.font = `700 58px ${D}`; ctx.textAlign = 'center'; ctx.fillText('NOT ISSUED', 0, 20);
    ctx.restore();
  }
  ctx.restore();

  function spaced(txt: string, x: number, y: number, sp: number, align: 'left' | 'center') {
    let w = 0;
    const ws: number[] = [];
    for (let c = 0; c < txt.length; c++) {
      const cw = ctx.measureText(txt[c]).width;
      ws.push(cw);
      w += cw + (c < txt.length - 1 ? sp : 0);
    }
    let sx = align === 'center' ? x - w / 2 : x;
    const prev = ctx.textAlign;
    ctx.textAlign = 'left';
    for (let c2 = 0; c2 < txt.length; c2++) {
      ctx.fillText(txt[c2], sx, y);
      sx += ws[c2] + sp;
    }
    ctx.textAlign = prev;
  }
}
