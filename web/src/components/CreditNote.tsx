'use client';
// <CreditNote>: the note drawn from data (DESIGN 2.1). Redraws only when its data or the
// pointer changes (DESIGN 7.5). The colour-shifting ink on the letter and amount follows the
// pointer; `drawIn` strokes the border in like ink the first time (1.5 s); `loupe` adds the
// magnifier that makes the microprint readable (DESIGN 2.5).
import { useEffect, useRef } from 'react';
import { drawNote, type NoteData, type Ovi } from '@/lib/drawNote';
import { display, body } from '@/lib/fonts';
import { prefersReducedMotion } from '@/lib/motion';

const FONTS = { display: display.style.fontFamily, body: body.style.fontFamily };
const REST: Ovi = { x: 0.5, y: 0.4 };
const DRAW_MS = 1500;
const BIG_W = 3300, BIG_H = 1620; // loupe source, 3x the design size
const LOUPE_PX = 440;

async function fontsReady() {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all([
    document.fonts.load(`700 40px ${FONTS.display}`),
    document.fonts.load(`italic 400 32px ${FONTS.display}`),
    document.fonts.load(`600 11px ${FONTS.body}`),
  ]).catch(() => {});
}

export function CreditNote({
  data,
  label,
  drawIn = false,
  loupe = false,
  children,
}: {
  data: NoteData;
  /** Accessible description of the note. */
  label: string;
  drawIn?: boolean;
  loupe?: boolean;
  /** Overlays, e.g. a <Stamp>. */
  children?: React.ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const loupeEl = useRef<HTMLDivElement>(null);
  const loupeCv = useRef<HTMLCanvasElement>(null);
  const big = useRef<HTMLCanvasElement | null>(null);
  const ovi = useRef<Ovi>({ ...REST });
  const target = useRef<Ovi>({ ...REST });
  const progress = useRef(drawIn ? 0 : 1);
  const raf = useRef(0);
  const dataKey = JSON.stringify(data);

  // paint at the canvas' current CSS size
  const paint = () => {
    const c = cv.current;
    if (!c) return;
    const w = c.clientWidth || 620, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(w * dpr), H = Math.round((w * dpr * 540) / 1100);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    drawNote(ctx, W, H, ovi.current, data, FONTS, progress.current);
  };

  // draw on data change, after fonts load, and on resize
  useEffect(() => {
    let alive = true;
    paint();
    fontsReady().then(() => {
      if (!alive) return;
      paint();
      if (loupe) {
        big.current ??= document.createElement('canvas');
        big.current.width = BIG_W; big.current.height = BIG_H;
        drawNote(big.current.getContext('2d')!, BIG_W, BIG_H, REST, data, FONTS, 1);
      }
    });
    const ro = new ResizeObserver(() => paint());
    if (cv.current) ro.observe(cv.current);
    return () => { alive = false; ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, loupe]);

  // ink draw-in, once
  useEffect(() => {
    if (!drawIn || prefersReducedMotion()) { progress.current = 1; paint(); return; }
    progress.current = 0;
    let start = 0, id = 0;
    const step = (t: number) => {
      start ||= t;
      progress.current = Math.min(1, (t - start) / DRAW_MS);
      paint();
      if (progress.current < 1) id = requestAnimationFrame(step);
    };
    fontsReady().then(() => { id = requestAnimationFrame(step); });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawIn, dataKey]);

  // colour-shifting ink follows the pointer; animate only until it settles
  const settle = () => {
    cancelAnimationFrame(raf.current);
    const tick = () => {
      const o = ovi.current, t = target.current;
      o.x += (t.x - o.x) * 0.12; o.y += (t.y - o.y) * 0.12;
      paint();
      if (Math.abs(o.x - t.x) > 0.002 || Math.abs(o.y - t.y) > 0.002) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const onMove = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    const vx = e.clientX - r.left, vy = e.clientY - r.top;
    target.current = { x: vx / r.width, y: vy / r.height };
    if (!prefersReducedMotion()) settle();
    if (loupe && e.pointerType === 'mouse' && big.current && loupeEl.current && loupeCv.current) {
      const L = loupeEl.current;
      L.classList.add('on');
      L.style.left = `${vx}px`; L.style.top = `${vy}px`;
      const k = r.width / 1100, mag = BIG_W / 1100;
      const cx = vx / k, cy = vy / k;
      const src = ((220 / k) * mag) / 2.2;
      const lc = loupeCv.current.getContext('2d')!;
      lc.fillStyle = '#EEF1E9'; lc.fillRect(0, 0, LOUPE_PX, LOUPE_PX);
      lc.drawImage(big.current, cx * mag - src / 2, cy * mag - src / 2, src, src, 0, 0, LOUPE_PX, LOUPE_PX);
    }
  };
  const onLeave = () => {
    target.current = { ...REST };
    if (!prefersReducedMotion()) settle();
    loupeEl.current?.classList.remove('on');
  };

  return (
    <div ref={wrap} className={`note${loupe ? ' with-loupe' : ''}`} onPointerMove={onMove} onPointerLeave={onLeave}>
      <canvas ref={cv} role="img" aria-label={label} />
      {loupe && (
        <div ref={loupeEl} className="loupe" aria-hidden="true">
          <canvas ref={loupeCv} width={LOUPE_PX} height={LOUPE_PX} />
        </div>
      )}
      {children}
    </div>
  );
}
