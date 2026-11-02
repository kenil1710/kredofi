'use client';
// The landing page (DESIGN 3 "Landing"), ported from docs/landing-reference.html: loader, Lenis smooth
// scroll, the WebGL enclave the camera dives into, the statement, "how to check a note" with the
// loupe, the two cheques, lending (live pool and ledger from /api/ledger), proof and the CTA.
// Markup is rendered by React; the scroll story runs in one rAF loop that only writes styles and
// classes. three, gsap and lenis are loaded on demand. Reduced motion: everything shown still.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { drawNote, type Ovi } from '@/lib/drawNote';
import { display, body } from '@/lib/fonts';
import { describe, lostByLenders, type LedgerEvent } from '@/lib/events';
import { KREDOFI_CONTRACT, NETWORK } from '@/lib/config';
import { relativeTime, usd } from '@/lib/format';
import { GuillocheStrip } from './GuillocheStrip';

const FONTS = { display: display.style.fontFamily, body: body.style.fontFamily };
const PROOF_TX = 'https://nearblocks.io/txns/8u8RsNzgxKSdhSbzSwi5qb7CGeWrk9RJWhHzVvWfZfbW';
const MAINNET_TX = 'https://nearblocks.io/txns/4dgHrA97KfibKifZuVZ2YF5zoAVCy4m2pXxxf9zdijyu';

const ROWS: [string, string, string, number?][] = [
  ['Oct 01', 'Salary, Acme Corp', '+4,000.00', 1], ['Oct 02', 'Rent', '−1,200.00'], ['Oct 06', 'Groceries', '−186.40'], ['Oct 11', 'Electricity', '−92.10'], ['Oct 15', 'To savings', '−600.00'],
  ['Sep 01', 'Salary, Acme Corp', '+4,000.00', 1], ['Sep 02', 'Rent', '−1,200.00'], ['Sep 09', 'Phone', '−45.00'], ['Sep 14', 'Groceries', '−201.75'], ['Sep 20', 'Bus pass', '−64.00'],
  ['Aug 01', 'Salary, Acme Corp', '+4,000.00', 1], ['Aug 02', 'Rent', '−1,200.00'], ['Aug 18', 'To savings', '−600.00'], ['Aug 23', 'Groceries', '−164.20'],
  ['Jul 01', 'Salary, Acme Corp', '+4,000.00', 1], ['Jul 02', 'Rent', '−1,200.00'], ['Jul 20', 'Groceries', '−177.30'], ['Jul 28', 'Electricity', '−88.40'],
  ['Jun 01', 'Salary, Acme Corp', '+4,000.00', 1], ['Jun 02', 'Rent', '−1,200.00'], ['Jun 22', 'Dentist', '−80.00'], ['Jun 25', 'To savings', '−600.00'],
  ['May 01', 'Salary, Acme Corp', '+4,000.00', 1], ['May 02', 'Rent', '−1,200.00'], ['May 12', 'Groceries', '−190.10'], ['May 30', 'Phone', '−45.00'],
];
const FN = ['Income level', 'Steady income', 'On-time payments', 'Money left over', 'Savings buffer'];
const FV = [250, 250, 250, 150, 100];
const MONTHS = ['October', 'September', 'August', 'July', 'June', 'May'];
const STATEMENT = 'Lenders see a band and a limit. They never see your salary, your rent, your name, or the night you went over budget.';
const FEATS: [string, string][] = [
  ['The amount', '$100 is your limit. The rules set it, not a loan officer. Repay this one on time and your next note says $250.'],
  ['The letter', "Your band, from A to D. Like the colour-shifting ink on a real note, it changes as you move. It's the only score that goes on-chain."],
  ['The serial number', 'A keyed fingerprint of your bank account. One account can back only one borrower, ever.'],
  ['The thread', 'Your name, encrypted and woven in. It opens for our recovery partner only if you never repay.'],
  ['The watermark', 'Proof that the scoring ran inside Intel TDX with the published code. Anyone can check it against the transaction on NEAR.'],
];
const RINGS: React.CSSProperties[] = [
  { left: '77.2%', top: '71.2%', width: '15.8%', height: '18.8%' },
  { left: '59.3%', top: '21.8%', width: '19.6%', height: '56.6%', borderRadius: '50%' },
  { left: '7.6%', top: '16.2%', width: '18.2%', height: '6.8%' },
  { left: '53.4%', top: '11.6%', width: '2.8%', height: '77%' },
  { left: '80.9%', top: '22.2%', width: '15.3%', height: '41%', borderRadius: '50%' },
];
const FOCUS = [{ z: 1, x: 550, y: 270 }, { z: 2.3, x: 937, y: 435 }, { z: 1.75, x: 760, y: 262 }, { z: 2.4, x: 190, y: 110 }, { z: 1.25, x: 604, y: 270 }, { z: 2.1, x: 975, y: 232 }];
const CHEQUES = [
  { id: 'riya', name: 'Riya', final: 1000, inc: [4000, 4000, 4000, 4000, 4000, 4000], fees: [0, 0, 0, 0, 0, 0], points: ['Paid $4,000 on the 1st of every month', 'No overdraft or returned-payment fees', 'About three months of spending saved'], stamp: 'BAND A, $100', color: 'var(--violet-ink)' },
  { id: 'sam', name: 'Sam', final: 270, inc: [2500, 0, 2000, 0, 2000, 1500], fees: [0, 2, 0, 1, 1, 0], points: ['Paid in only 4 of the last 6 months', '4 overdraft or returned-payment fees', 'Spent more than he earned'], stamp: 'NOT THIS TIME', color: 'var(--red-ink)' },
];
// Shown only until the live ledger answers (and labelled as examples).
const EXAMPLE_EVENTS: [string, string][] = [
  ['Score issued, band A', '—'], ['Loan repaid', '$104.00'], ['Lender deposit from Base', '$250.00'], ['Score issued, band D', '—'],
  ['Loan issued, band A', '$100.00'], ['Reserve covered a default', '$100.00'],
];

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease3 = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function progressOf(el: Element) {
  const r = el.getBoundingClientRect(), vh = window.innerHeight, travel = r.height - vh;
  return travel <= 0 ? 1 : clamp(-r.top / travel);
}
const fmtNum = (v: number, dec: number, pre = '', suf = '') =>
  pre + (dec === 2 ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toFixed(dec)) + suf;

export function Landing() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const $ = <T extends Element = HTMLElement>(s: string) => root.current!.querySelector(s) as T;
    const $$ = <T extends Element = HTMLElement>(s: string) => Array.from(root.current!.querySelectorAll(s)) as T[];
    const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cleanups: (() => void)[] = [];
    let alive = true;

    type Gsap = typeof import('gsap').gsap;
    let gsap: Gsap | null = null;
    const libs = REDUCE ? Promise.resolve() : Promise.all([import('gsap'), import('lenis')]).then(([g, l]) => {
      if (!alive) return;
      gsap = g.gsap;
      const lenis = new l.default({ lerp: 0.09, smoothWheel: true });
      const tick = (t: number) => lenis.raf(t * 1000);
      gsap.ticker.add(tick); gsap.ticker.lagSmoothing(0);
      cleanups.push(() => { gsap?.ticker.remove(tick); lenis.destroy(); });
      lenisRef = lenis;
    }).catch(() => {});
    let lenisRef: { scrollTo(el: HTMLElement, o: { duration: number }): void } | null = null;

    /* Loader (once per visit: coming back from /borrow skips it) */
    const loader = $('#loader');
    let seen = false;
    try { seen = sessionStorage.getItem('kf-loader') === '1'; sessionStorage.setItem('kf-loader', '1'); } catch { /* storage blocked */ }
    const heroIntro = () => {
      if (REDUCE || !gsap) return;
      gsap.from($$('.hero-inner h1 .ln span'), { yPercent: 110, duration: 1.2, stagger: 0.1, ease: 'power4.out' });
      gsap.from($$('.hero-inner .lede, .hero-inner .ctas, .hero-inner .small'), { y: 24, opacity: 0, duration: 1, stagger: 0.08, delay: 0.35, ease: 'power3.out' });
    };
    libs.then(() => {
      if (!alive) return;
      if (REDUCE || seen || !gsap) { loader.style.display = 'none'; heroIntro(); return; }
      const spans = $$('#loader .word span'), count = $('#loader .count'), bar = $('#loader .bar i');
      const o = { v: 0 };
      gsap.timeline({ onComplete: () => { loader.style.display = 'none'; } })
        .to(spans, { y: 0, duration: 0.8, stagger: 0.05, ease: 'power4.out' }, 0)
        .to(o, { v: 100, duration: 1.5, ease: 'power2.inOut', onUpdate: () => { const n = Math.round(o.v); count.textContent = String(n).padStart(3, '0'); bar.style.width = `${o.v}%`; } }, 0)
        .to(spans, { y: '-105%', duration: 0.55, stagger: 0.03, ease: 'power3.in' }, 1.55)
        .to(loader, { yPercent: -100, duration: 0.9, ease: 'power4.inOut' }, 1.9)
        .add(heroIntro, 1.95);
    });

    /* In-page anchors */
    const onAnchor = (e: Event) => {
      const a = (e.target as Element).closest('a[href^="#"]');
      if (!a) return;
      const el = document.querySelector<HTMLElement>(a.getAttribute("href")!);
      if (!el) return;
      e.preventDefault();
      if (lenisRef) lenisRef.scrollTo(el, { duration: 1.6 }); else el.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth' });
    };
    root.current!.addEventListener('click', onAnchor);
    cleanups.push(() => root.current?.removeEventListener('click', onAnchor));

    /* Nav hide/show */
    const nav = $('.nav');
    const lightSecs = ['#check', '#two', '#proof'].map((s) => $(s));
    let lastY = 0;
    const navTick = () => {
      const y = window.scrollY;
      const lt = lightSecs.some((el) => { const r = el.getBoundingClientRect(); return r.top <= 40 && r.bottom > 40; });
      nav.classList.toggle('light', lt); nav.classList.toggle('solid', y > 40);
      nav.classList.toggle('hide', y > lastY + 4 && y > 300); if (y < lastY - 4) nav.classList.remove('hide');
      lastY = y;
    };

    /* Magnetic buttons */
    if (!REDUCE && matchMedia('(hover:hover)').matches) {
      for (const b of $$('.magnetic')) {
        const mv = (e: MouseEvent) => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${((e.clientX - (r.left + r.width / 2)) * 0.22).toFixed(1)}px,${((e.clientY - (r.top + r.height / 2)) * 0.3).toFixed(1)}px)`; };
        const lv = () => { b.style.transition = 'transform .5s cubic-bezier(.2,.8,.2,1)'; b.style.transform = ''; setTimeout(() => { b.style.transition = ''; }, 500); };
        b.addEventListener('mousemove', mv); b.addEventListener('mouseleave', lv);
        cleanups.push(() => { b.removeEventListener('mousemove', mv); b.removeEventListener('mouseleave', lv); });
      }
    }

    /* Enclave rows + tally */
    const rowsEl = $('#rows'), factorDD = $$('#factors dd'), scoreEl = $('#score'), stampEl = $('#stamp'), leavesEl = $('#leaves'), readingEl = $('#reading');

    /* WebGL enclave (three on demand) */
    type GL = { render(p: number, dt: number, clock: number): void; dispose(): void };
    let gl: GL | null = null;
    import('three').then((THREE) => {
      if (!alive) return;
      const canvas = $<HTMLCanvasElement>('#gl');
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch { return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
      const g = new THREE.Group(); scene.add(g);
      const mint = new THREE.Color('#9FD9BF'), violet = new THREE.Color('#8E6CF0');
      const glassMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uA: { value: mint }, uB: { value: violet }, uT: { value: 0 } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-wp.xyz); vP=position; gl_Position=projectionMatrix*viewMatrix*wp; }',
        fragmentShader: 'uniform vec3 uA; uniform vec3 uB; uniform float uT; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ float f=pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.4); float scan=0.5+0.5*sin(vP.y*42.0-uT*2.0); vec3 c=mix(uA,uB,clamp(vP.y*0.6+0.5,0.0,1.0)); float a=0.05+f*0.55+scan*0.025; gl_FragColor=vec4(c*(0.25+f*1.3),a); }',
      });
      const boxGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
      const box = new THREE.Mesh(boxGeo, glassMat); g.add(box);
      const edgeMat = new THREE.LineBasicMaterial({ color: '#CFEBDD', transparent: true, opacity: 0.75 });
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), edgeMat); g.add(edges);
      const innerMat = new THREE.LineBasicMaterial({ color: '#8E6CF0', transparent: true, opacity: 0.45 });
      const inner = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.2, 1.2, 1.2)), innerMat); g.add(inner);
      const gcv = document.createElement('canvas'); gcv.width = gcv.height = 256;
      const gx = gcv.getContext('2d')!, gg = gx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gg.addColorStop(0, 'rgba(220,205,255,1)'); gg.addColorStop(0.35, 'rgba(142,108,240,.35)'); gg.addColorStop(1, 'rgba(142,108,240,0)');
      gx.fillStyle = gg; gx.fillRect(0, 0, 256, 256);
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 2), new THREE.MeshBasicMaterial({ color: '#D9CCFF' })); g.add(core);
      const glowMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gcv), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const glow = new THREE.Sprite(glowMat); glow.scale.set(2.6, 2.6, 1); g.add(glow);
      const R0 = rng(3);
      const rings = [0, 1, 2].map((i) => { const t = new THREE.Mesh(new THREE.TorusGeometry(0.5 + i * 0.08, 0.0035, 6, 220), new THREE.MeshBasicMaterial({ color: i === 1 ? '#8E6CF0' : '#9FD9BF', transparent: true, opacity: 0.6 })); t.rotation.set(R0() * 3, R0() * 3, 0); g.add(t); return t; });
      const rosPts = [];
      for (let k = 0; k <= 1600; k++) { const a = (k / 1600) * Math.PI * 2, rr = 2.6 + 0.12 * Math.sin(a * 36) + 0.05 * Math.sin(a * 91); rosPts.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, 0)); }
      const rosGeo = new THREE.BufferGeometry().setFromPoints(rosPts);
      const rosette = new THREE.Group(); const rosMats: InstanceType<typeof THREE.LineBasicMaterial>[] = [];
      for (let m = 0; m < 6; m++) { const mat = new THREE.LineBasicMaterial({ color: '#9FD9BF', transparent: true, opacity: 0.12 }); rosMats.push(mat); const ln = new THREE.LineLoop(rosGeo, mat); ln.rotation.z = m * 0.09; ln.scale.setScalar(1 + m * 0.035); rosette.add(ln); }
      rosette.position.z = -1.6; g.add(rosette);
      const N = window.innerWidth < 700 ? 700 : 1500;
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), R2 = rng(7);
      const P = Array.from({ length: N }, (_, p) => { const q = { a: R2() * Math.PI * 2, r: 1.4 + R2() * 5, y: (R2() - 0.5) * 3.2, s: 0.25 + R2() * 0.6 }; const c = R2() < 0.75 ? mint : violet; col[p * 3] = c.r; col[p * 3 + 1] = c.g; col[p * 3 + 2] = c.b; return q; });
      const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pMat = new THREE.PointsMaterial({ size: 0.028, vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
      g.add(new THREE.Points(pGeo, pMat));
      // the note
      const nc = document.createElement('canvas'); nc.width = 2048; nc.height = 1006;
      const nctx = nc.getContext('2d')!; drawNote(nctx, 2048, 1006, { x: 0.5, y: 0.4 }, {}, FONTS);
      const ntex = new THREE.CanvasTexture(nc); ntex.anisotropy = 8; ntex.colorSpace = THREE.SRGBColorSpace;
      const nGeo = new THREE.PlaneGeometry(2.6, (2.6 * 540) / 1100, 40, 20);
      const nBase = (nGeo.attributes.position.array as Float32Array).slice();
      const nMat = new THREE.MeshBasicMaterial({ map: ntex, side: THREE.DoubleSide, transparent: true });
      const note = new THREE.Mesh(nGeo, nMat); g.add(note);
      document.fonts?.ready.then(() => { if (!alive) return; nctx.clearRect(0, 0, 2048, 1006); drawNote(nctx, 2048, 1006, { x: 0.5, y: 0.4 }, {}, FONTS); ntex.needsUpdate = true; });

      let narrow = false, mx = 0, my = 0, tmx = 0, tmy = 0;
      const size = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); narrow = w < 900; };
      size();
      const onMouse = (e: MouseEvent) => { tmx = e.clientX / window.innerWidth - 0.5; tmy = e.clientY / window.innerHeight - 0.5; };
      window.addEventListener('resize', size); window.addEventListener('mousemove', onMouse);
      gl = {
        render(p, dt, clock) {
          mx = lerp(mx, tmx, 0.05); my = lerp(my, tmy, 0.05);
          const dive = easeIO(clamp((p - 0.06) / 0.42));
          const sx = narrow ? 0.2 : -1.85, sy = narrow ? 2.1 : 0;
          const cx = lerp(sx, 0, dive), cy = lerp(sy, 0, dive), cz = lerp(narrow ? 8.6 : 7.2, 1.05, dive);
          camera.position.set(cx + mx * 0.35 * (1 - dive), cy - my * 0.25 * (1 - dive), cz); camera.lookAt(cx, cy, 0);
          glassMat.uniforms.uT.value = clock;
          box.rotation.y = 0.6 + clock * 0.08 * (1 - dive) - dive * 0.6; box.rotation.x = 0.35 * (1 - dive);
          edges.rotation.copy(box.rotation); inner.rotation.set(-clock * 0.12, clock * 0.15, 0);
          const pulse = 1 + 0.08 * Math.sin(clock * 2.2), fadeIn = 1 - clamp((dive - 0.55) / 0.3);
          core.scale.setScalar(pulse * fadeIn + 0.001); glow.scale.setScalar(2.6 * pulse * fadeIn + 0.001); glowMat.opacity = fadeIn;
          edgeMat.opacity = 0.75 * fadeIn + 0.08; innerMat.opacity = 0.45 * fadeIn; core.rotation.y += dt * 0.4;
          rings.forEach((r, i) => { r.rotation.x += dt * (0.2 + i * 0.07); r.rotation.y += dt * (0.13 + i * 0.05); });
          rosette.rotation.z = clock * 0.02; for (const m of rosMats) m.opacity = 0.12 * (1 - dive);
          const pull = 1 + dive * 2.5;
          for (let i = 0; i < N; i++) {
            const q = P[i]; q.r -= dt * q.s * pull; q.a += dt * (0.6 / q.r + 0.05);
            if (q.r < 0.35) { q.r = 4.5 + Math.random() * 2; q.a = Math.random() * Math.PI * 2; q.y = (Math.random() - 0.5) * 3.2; }
            pos[i * 3] = Math.cos(q.a) * q.r; pos[i * 3 + 1] = q.y * Math.min(1, q.r / 3.5); pos[i * 3 + 2] = Math.sin(q.a) * q.r;
          }
          pGeo.attributes.position.needsUpdate = true; pMat.opacity = 0.85 * (1 - clamp((p - 0.3) / 0.12));
          const away = ease3(clamp((p - 0.03) / 0.22));
          const nx = narrow ? 0.55 : 0.2, ny = narrow ? -1.05 : -1.15;
          note.position.set(nx + away * 2.6, ny + Math.sin(clock * 0.9) * 0.06 - away * 1.4, (narrow ? 1.35 : 0.75) + away * 1.2);
          note.rotation.set(-0.22 + my * 0.2 - away * 0.6, (narrow ? -0.55 : -0.25) + mx * 0.3 + away * 0.9, 0.1 + Math.sin(clock * 0.6) * 0.02);
          nMat.opacity = 1 - away; note.visible = away < 0.99;
          const a = nGeo.attributes.position.array as Float32Array;
          for (let v = 0; v < a.length; v += 3) a[v + 2] = nBase[v + 2] + Math.sin(nBase[v] * 1.6 + clock * 1.3) * 0.05 + Math.cos(nBase[v + 1] * 2.2 + clock) * 0.025;
          nGeo.attributes.position.needsUpdate = true;
          renderer.render(scene, camera);
        },
        dispose() {
          window.removeEventListener('resize', size); window.removeEventListener('mousemove', onMouse);
          scene.traverse((o) => { const m = o as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } }; m.geometry?.dispose(); m.material?.dispose(); });
          ntex.dispose(); renderer.dispose();
        },
      };
    }).catch(() => {});
    cleanups.push(() => gl?.dispose());

    /* Note in "check" + loupe */
    const note2d = $<HTMLCanvasElement>('#note2d'), viewer = $('.viewer'), noteWrap = $('.lnote');
    const big = document.createElement('canvas'); big.width = 3300; big.height = 1620;
    const ovi: Ovi = { x: 0.5, y: 0.4 }, oviT: Ovi = { x: 0.5, y: 0.4 };
    const paint2d = () => {
      const w = note2d.clientWidth || 800, dpr = Math.min(window.devicePixelRatio || 1, 2);
      note2d.width = Math.round(w * dpr); note2d.height = Math.round((w * dpr * 540) / 1100);
      drawNote(note2d.getContext('2d')!, note2d.width, note2d.height, ovi, {}, FONTS);
    };
    const paintBig = () => drawNote(big.getContext('2d')!, 3300, 1620, { x: 0.5, y: 0.4 }, {}, FONTS);
    paint2d(); paintBig();
    document.fonts?.ready.then(() => { if (alive) { paint2d(); paintBig(); } });
    window.addEventListener('resize', paint2d);
    cleanups.push(() => window.removeEventListener('resize', paint2d));
    const loupe = $('.loupe'), lc = $<HTMLCanvasElement>('.loupe canvas').getContext('2d')!;
    const noteZoom = { z: 1, x: 550, y: 270 };
    const onView = (e: MouseEvent) => {
      const r = viewer.getBoundingClientRect(), vx = e.clientX - r.left, vy = e.clientY - r.top;
      oviT.x = vx / r.width; oviT.y = vy / r.height;
      if (!matchMedia('(hover:hover)').matches) return;
      loupe.classList.add('on'); loupe.style.left = `${vx}px`; loupe.style.top = `${vy}px`;
      const k = r.width / 1100, z = noteZoom.z;
      const cx = noteZoom.x + (vx - r.width / 2) / (k * z), cy = noteZoom.y + (vy - r.height / 2) / (k * z);
      const mag = 3300 / 1100, src = (((220 / (k * z)) * mag) / 2.2);
      lc.fillStyle = '#EEF1E9'; lc.fillRect(0, 0, 440, 440);
      lc.drawImage(big, cx * mag - src / 2, cy * mag - src / 2, src, src, 0, 0, 440, 440);
    };
    const offView = () => { loupe.classList.remove('on'); oviT.x = 0.5; oviT.y = 0.4; };
    viewer.addEventListener('mousemove', onView); viewer.addEventListener('mouseleave', offView);
    cleanups.push(() => { viewer.removeEventListener('mousemove', onView); viewer.removeEventListener('mouseleave', offView); });
    const featLis = $$('.feats li'), rings2d = $$('.lnote .ring');
    if (REDUCE) featLis.forEach((li) => li.classList.add('on'));

    /* Statement words, cheques */
    const words = $$('#statement .w');
    const CH = CHEQUES.map((c) => {
      const el = $(`#chq-${c.id}`);
      return { ...c, bars: Array.from(el.querySelectorAll<HTMLElement>('.months i')), ems: Array.from(el.querySelectorAll('.months em')), score: el.querySelector('.score')!, st: el.querySelector('.st')!, done: false };
    });

    /* Count-ups on view (proof numbers) */
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return; io.unobserve(e.target);
      const el = e.target as HTMLElement, to = +el.dataset.to!, dec = +(el.dataset.dec || 0), pre = el.dataset.pre || '', suf = el.dataset.suf || '';
      if (REDUCE || !gsap) { el.textContent = fmtNum(to, dec, pre, suf); return; }
      const o = { v: 0 }; gsap.to(o, { v: to, duration: 1.8, ease: 'power3.out', onUpdate: () => { el.textContent = fmtNum(o.v, dec, pre, suf); } });
    }), { threshold: 0.6 });
    libs.then(() => { if (alive) $$('#proof .cnt').forEach((el) => io.observe(el)); });
    cleanups.push(() => io.disconnect());

    /* Chain dots */
    const cps = [0, 1, 2].map((i) => $<SVGPathElement>(`#cp${i}`)), cds = [0, 1, 2].map((i) => $(`#cd${i}`));
    const cpl = cps.map((p) => p.getTotalLength());

    /* Main loop */
    const journey = $('#journey'), stage = $('.stage'), heroCopy = $('.hero-copy'), enclave = $('.enclave'), cue = $('.cue');
    const statement = $('#statement'), check = $('#check'), two = $('#two'), cta = $('#cta'), ctaH = $('#cta h2');
    let jpS = 0, stamped = false, lastFeat = -2, clock = 0, prevT = performance.now(), raf = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - prevT) / 1000); prevT = now; clock += dt;
      navTick();
      const jp = REDUCE ? 1 : progressOf(journey); jpS = lerp(jpS, jp, 0.12);
      const p = jpS;
      const heroOut = ease3(clamp((p - 0.02) / 0.16));
      heroCopy.style.opacity = (1 - heroOut).toFixed(3);
      heroCopy.style.transform = `translateY(${(-heroOut * 60).toFixed(1)}px)`;
      heroCopy.style.visibility = heroOut > 0.99 ? 'hidden' : 'visible';
      cue.style.opacity = (1 - clamp(p / 0.04)).toFixed(3);
      const encIn = clamp((p - 0.44) / 0.08);
      if (!REDUCE) { enclave.style.opacity = encIn.toFixed(3); enclave.style.pointerEvents = encIn > 0.5 ? 'auto' : 'none'; }
      const e2 = clamp((p - 0.5) / 0.32), e3 = clamp((p - 0.84) / 0.08);
      rowsEl.style.transform = `translateY(${(-e2 * Math.max(0, rowsEl.scrollHeight - 320)).toFixed(1)}px)`;
      rowsEl.style.filter = `blur(${(e3 * 10).toFixed(1)}px)`;
      rowsEl.style.opacity = (1 - e3 * 0.75).toFixed(3);
      let total = 0;
      FV.forEach((v, i) => { const x = Math.round(v * clamp((e2 - i * 0.1) / 0.5)); total += x; if (factorDD[i].textContent !== String(x)) factorDD[i].textContent = String(x); });
      const shown = e3 > 0.5 || REDUCE ? 1000 : total; if (scoreEl.textContent !== String(shown)) scoreEl.textContent = String(shown);
      readingEl.textContent = e3 > 0.5 ? 'Finished reading' : `Reading ${MONTHS[Math.min(5, Math.floor(e2 * 6))]}`;
      if (e3 > 0.6 && !stamped) { stamped = true; stampEl.classList.add('on'); leavesEl.classList.add('on'); stage.classList.remove('lshake'); void stage.offsetWidth; stage.classList.add('lshake'); }
      if (e3 < 0.3 && stamped) { stamped = false; stampEl.classList.remove('on'); leavesEl.classList.remove('on'); }

      const jr = journey.getBoundingClientRect();
      if (gl && jr.bottom > 0 && jr.top < window.innerHeight) gl.render(p, dt, clock);

      if (!REDUCE) {
        const lit = Math.floor(clamp((progressOf(statement) - 0.08) / 0.75) * words.length + 0.0001);
        words.forEach((w, i) => w.classList.toggle('lit', i < lit));
      }

      ovi.x = lerp(ovi.x, oviT.x, 0.12); ovi.y = lerp(ovi.y, oviT.y, 0.12);
      const cp = REDUCE ? 0 : progressOf(check);
      const idx = REDUCE ? -1 : Math.min(5, Math.floor(cp * 6.2)), fi = idx - 1;
      if (fi !== lastFeat) { lastFeat = fi; featLis.forEach((li, i) => li.classList.toggle('on', REDUCE || i === fi)); rings2d.forEach((r, i) => r.classList.toggle('on', i === fi)); }
      const tgt = FOCUS[Math.max(0, idx)] || FOCUS[0];
      noteZoom.z = lerp(noteZoom.z, tgt.z, 0.08); noteZoom.x = lerp(noteZoom.x, tgt.x, 0.08); noteZoom.y = lerp(noteZoom.y, tgt.y, 0.08);
      const vw = viewer.clientWidth, k = vw / 1100;
      const maxX = ((noteZoom.z - 1) * vw) / 2, maxY = ((noteZoom.z - 1) * vw * 540) / 1100 / 2;
      const tx = clamp((550 - noteZoom.x) * k * noteZoom.z, -maxX, maxX), ty = clamp((270 - noteZoom.y) * k * noteZoom.z, -maxY, maxY);
      noteWrap.style.transform = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) scale(${noteZoom.z.toFixed(4)})`;
      const cr = check.getBoundingClientRect();
      if (cr.top < window.innerHeight && cr.bottom > 0 && (Math.abs(ovi.x - oviT.x) > 0.002 || Math.abs(ovi.y - oviT.y) > 0.002)) {
        const c2 = note2d.getContext('2d')!; c2.clearRect(0, 0, note2d.width, note2d.height); drawNote(c2, note2d.width, note2d.height, ovi, {}, FONTS);
      }

      const tp = REDUCE ? 1 : progressOf(two);
      for (const c of CH) {
        const mp = clamp((tp - 0.08) / 0.6);
        c.bars.forEach((bar, i) => { const t = clamp(mp * 6 - i); bar.style.transform = `scaleY(${ease3(t).toFixed(3)})`; c.ems[i].classList.toggle('on', t >= 1); });
        const sv = String(Math.round(c.final * ease3(clamp((tp - 0.12) / 0.62)))); if (c.score.textContent !== sv) c.score.textContent = sv;
        const done = tp > 0.78; if (done !== c.done) { c.done = done; c.st.classList.toggle('on', done); }
      }

      for (let d = 0; d < 3; d++) {
        const tt = (clock * 0.28 + d * 0.33) % 1, pt = cps[d].getPointAtLength(tt * cpl[d]);
        cds[d].setAttribute('cx', pt.x.toFixed(1)); cds[d].setAttribute('cy', pt.y.toFixed(1)); cds[d].setAttribute('opacity', (tt < 0.9 ? 1 : (1 - tt) * 10).toFixed(2));
      }

      if (!REDUCE) {
        const cpg = clamp(1 - cta.getBoundingClientRect().top / window.innerHeight);
        ctaH.style.letterSpacing = `${lerp(0.04, -0.04, ease3(cpg)).toFixed(4)}em`;
        ctaH.style.transform = `scale(${lerp(0.94, 1, ease3(cpg)).toFixed(4)})`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    cleanups.push(() => cancelAnimationFrame(raf));

    return () => { alive = false; cleanups.forEach((f) => f()); };
  }, []);

  return (
    <div className="lp" ref={root}>
      <div id="loader" aria-hidden="true">
        <div className="word">{'KredoFi'.split('').map((c, i) => <span key={i}>{c}</span>)}</div>
        <p className="caption">Private credit on NEAR. Reading the enclave&apos;s proof.</p>
        <div className="count">000</div>
        <div className="bar"><i /></div>
      </div>

      <header className="nav">
        <div className="wrap">
          <a className="logo" href="#journey" aria-label="KredoFi, back to top">KredoFi</a>
          <nav aria-label="Main">
            <a className="inpage" href="#check">How to check a note</a>
            <a className="inpage" href="#two">The rules</a>
            <span className="sep" aria-hidden="true" />
            <Link href="/lend">Lend</Link>
            <Link href="/ledger">Public ledger</Link>
            <Link href="/docs">Docs</Link>
            <Link href="/trust">Trust</Link>
          </nav>
          <Link className="btn btn-light magnetic" href="/borrow">Check my limit</Link>
        </div>
      </header>

      <main>
        <section id="journey" aria-label="Introduction">
          <div className="stage">
            <div className="glow" />
            <canvas id="gl" aria-hidden="true" />
            <div className="grain" aria-hidden="true" />
            <div className="hero-copy">
              <div className="wrap">
                <div className="hero-inner">
                  <h1><span className="ln"><span>Borrow against</span></span><span className="ln"><span>your payslip.</span></span></h1>
                  <p className="lede">KredoFi reads six months of your bank history inside a sealed computer, works out a limit, and lends you USDC on NEAR. Lenders never see your statements. Neither do we.</p>
                  <div className="ctas">
                    <Link className="btn btn-light magnetic" href="/borrow">Check my limit</Link>
                    <a className="btn btn-ghost magnetic" href="#check">How the privacy works</a>
                  </div>
                  <p className="small">{NETWORK === 'testnet' ? 'Testnet demo with Plaid\'s sandbox bank. No wallet needed; we pay the network fees.' : 'Mainnet.'}</p>
                </div>
              </div>
            </div>
            <div className="enclave" aria-live="off">
              <div className="wrap">
                <div>
                  <div className="head"><h2>Inside the enclave</h2><span className="reading" id="reading">Reading October</span></div>
                  <div className="rows-box">
                    <ul id="rows">
                      {ROWS.map((r, i) => <li key={i} className={r[3] ? 'in' : undefined}><span className="d">{r[0]}</span><span>{r[1]}</span><span className="a">{r[2]}</span></li>)}
                    </ul>
                  </div>
                </div>
                <div className="tally">
                  <h3>Riya&apos;s tally</h3>
                  <dl id="factors">{FN.map((n) => <div className="row" key={n}><dt>{n}</dt><dd>0</dd></div>)}</dl>
                  <div className="total"><span>Score</span><b id="score">0</b></div>
                  <div className="lstamp" id="stamp">BAND A, $100</div>
                  <p className="leaves" id="leaves">That one line is all that leaves. The 30 transactions are deleted when the run ends.</p>
                </div>
              </div>
            </div>
            <div className="cue" aria-hidden="true"><span>Scroll</span><i /></div>
          </div>
        </section>

        <section id="statement" aria-label="What lenders see">
          <div className="pin"><div className="wrap"><p>{STATEMENT.split(' ').map((w, i) => <span key={i}><span className="w">{w}</span>{' '}</span>)}</p></div></div>
        </section>

        <section id="check" aria-labelledby="check-h">
          <div className="pin">
            <div className="wrap grid">
              <div>
                <h2 id="check-h">How to check a KredoFi note</h2>
                <p className="intro">Central banks print money with details that are hard to fake. We built every loan the same way. Keep scrolling, or hover the note to look through the loupe.</p>
                <ol className="feats">{FEATS.map(([h, t]) => <li key={h}><h3>{h}</h3><div className="body"><p>{t}</p></div></li>)}</ol>
              </div>
              <div>
                <div className="viewer">
                  <div className="lnote">
                    <canvas id="note2d" role="img" aria-label="A KredoFi credit note for riya.testnet: 100 US dollars in USDC, band A, repay 104 dollars by 24 November 2026" />
                    {RINGS.map((s, i) => <div key={i} className="ring" style={s} />)}
                  </div>
                  <div className="loupe"><canvas width={440} height={440} /></div>
                </div>
                <p className="viewer-cap">Hover the note to read the microprint along the bottom edge.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="two" aria-labelledby="two-h">
          <div className="pin">
            <div className="wrap">
              <h2 id="two-h">Riya gets $100. Sam doesn&apos;t, and he&apos;s told why.</h2>
              <p className="sub">Five rules decide the band, and they&apos;re published as code. Nobody at KredoFi can nudge a score up or down.</p>
              <div className="cheques">
                {CHEQUES.map((c) => (
                  <article className="cheque" id={`chq-${c.id}`} key={c.id}>
                    <GuillocheStrip height={12} />
                    <div className="top"><h3>{c.name}</h3><span className="score">0</span></div>
                    <div className="months">
                      {c.inc.map((v, i) => (
                        <div key={i}><em>{c.fees[i] ? `${c.fees[i]} fee${c.fees[i] > 1 ? 's' : ''}` : ''}</em><i className={v ? undefined : 'none'} style={{ height: v ? 24 + (60 * v) / 4000 : 18 }} /></div>
                      ))}
                    </div>
                    <div className="mlabels">{['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'].map((m) => <span key={m}>{m}</span>)}</div>
                    <ul>{c.points.map((t) => <li key={t}>{t}</li>)}</ul>
                    <span className="st" style={{ color: c.color, borderColor: c.color }}>{c.stamp}</span>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="lend" aria-labelledby="lend-h">
          <LiveLend />
        </section>

        <section id="proof" aria-labelledby="proof-h">
          <div className="wrap">
            <h2 id="proof-h">Numbers from a real enclave run on 25 October, not from a pitch deck.</h2>
            <div className="nums">
              <div><b className="cnt" data-to="3.9" data-dec="1" data-suf=" s">3.9 s</b><span>to read 30 transactions inside Intel TDX</span></div>
              <div><b className="cnt" data-to="0.00145" data-dec="5">0.00145</b><span>NEAR for the whole scoring run</span></div>
              <div><b>0 bytes</b><span>of bank data written to the chain</span></div>
              <div><b>12 of 13</b><span>risky pieces proven before the build. <a href={PROOF_TX}>See the transaction</a></span></div>
            </div>
          </div>
        </section>

        <section id="cta" aria-labelledby="cta-h">
          <div className="halo" aria-hidden="true" />
          <div className="wrap">
            <h2 id="cta-h">Borrow against your payslip.</h2>
            <div className="row">
              <p>Connect Plaid&apos;s sandbox bank with its public test login and see your limit in about a minute. Borrow, repay, and watch your limit grow. No wallet needed.</p>
              <div className="ctas">
                <Link className="btn btn-light btn-big magnetic" href="/borrow">Check my limit</Link>
                <Link className="btn btn-ghost btn-big magnetic" href="/lend">Lend to the pool</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <p>KredoFi, built for NEAR HACKATHON in November 2026. Plaid sandbox data only; not a lending offer.</p>
          <p><a href={MAINNET_TX}>A real mainnet score</a> · <Link href="/trust">Why is this safe?</Link> · <Link href="/docs">Docs</Link> · <Link href="/ledger">Public ledger</Link> · <Link href="/scenarios">Demo scenarios</Link></p>
        </div>
      </footer>
    </div>
  );
}

type LedgerAnswer = { events: LedgerEvent[]; pool: { pool_value: string; outstanding: string; reserve: string } };

/** Count up to a value once it scrolls into view (landing .cnt), then follow live changes. */
function CountUp({ to }: { to: bigint | null }) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } }, { threshold: 0.6 });
    if (el.current) io.observe(el.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (to === null || !visible || !el.current) return;
    const target = Number(to) / 1e6, from = shown.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || from === target) { shown.current = target; el.current.textContent = usd(to); return; }
    let t0 = -1, id = 0;
    const f = (t: number) => {
      if (t0 < 0) t0 = t;
      const k = Math.min(1, (t - t0) / 1800), v = from + (target - from) * ease3(k);
      shown.current = v;
      if (el.current) el.current.textContent = k < 1 ? fmtNum(v, 2, '$') : usd(to);
      if (k < 1) id = requestAnimationFrame(f);
    };
    id = requestAnimationFrame(f);
    return () => cancelAnimationFrame(id);
  }, [to, visible]);
  return <span ref={el}>{to === null ? '…' : '$0.00'}</span>;
}

/** The lending section, with the real testnet pool and the latest real events (polled while on screen). */
function LiveLend() {
  const box = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<LedgerAnswer | null>(null);
  const [now, setNow] = useState(0);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    let alive = true, onScreen = false;
    const load = async () => {
      if (!onScreen || document.hidden) return;
      try {
        const r = await fetch('/api/ledger', { cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as LedgerAnswer;
        if (!alive) return;
        const keys = j.events.slice(0, 7).map((e) => `${e.txHash}:${e.idx}`);
        if (seen.current) setFresh(new Set(keys.filter((k) => !seen.current!.has(k))));
        seen.current = new Set(keys);
        setData(j); setNow(Date.now());
      } catch { /* keep the last answer */ }
    };
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (onScreen) load(); }, { rootMargin: '200px' });
    if (box.current) io.observe(box.current);
    const t = setInterval(load, 5000);
    return () => { alive = false; io.disconnect(); clearInterval(t); };
  }, []);

  const pool = data?.pool;
  const lost = data ? lostByLenders(data.events) : null;
  return (
    <div className="wrap grid" ref={box}>
      <div className="copy">
        <h2 id="lend-h">Lending is the boring part, on purpose.</h2>
        <p>Put USDC into the pool from NEAR, or bring it from Base, Ethereum or Solana through NEAR Intents. When a loan isn&apos;t repaid, the reserve pays you back before you lose anything.</p>
        <table className="ledger">
          <caption>The {NETWORK} pool, live from {KREDOFI_CONTRACT}</caption>
          <tbody>
            <tr><th scope="row">In the pool</th><td><CountUp to={pool ? BigInt(pool.pool_value) : null} /></td></tr>
            <tr><th scope="row">Lent out right now</th><td><CountUp to={pool ? BigInt(pool.outstanding) : null} /></td></tr>
            <tr><th scope="row">Reserve, pays losses first</th><td><CountUp to={pool ? BigInt(pool.reserve) : null} /></td></tr>
            <tr className="sum"><th scope="row">Lost by lenders so far</th><td>{lost === null ? '…' : usd(lost)}</td></tr>
          </tbody>
        </table>
        <Link className="link" href="/lend">Open the lender page</Link>
      </div>
      <div>
        <div className="feed">
          <h3>Public ledger <small>{data ? `live, ${NETWORK}` : 'example events, until the ledger answers'}</small></h3>
          <ol aria-live="off">
            {data
              ? data.events.slice(0, 7).map((e) => {
                const d = describe(e), k = `${e.txHash}:${e.idx}`;
                return <li key={k} className={fresh.has(k) ? 'new' : undefined}><span>{d.text}</span><span className="v">{d.value}</span><span className="t">{relativeTime(e.ts, now)}</span></li>;
              })
              : EXAMPLE_EVENTS.map(([t, v], i) => <li key={i}><span>{t}</span><span className="v">{v}</span><span className="t">example</span></li>)}
          </ol>
          <Link className="link" href="/ledger">See every event</Link>
        </div>
        <div className="chains">
          <p>Deposits from other chains arrive in about 35 seconds.</p>
          <svg viewBox="0 0 520 170" role="img" aria-label="USDC moving from Base, Ethereum and Solana into NEAR">
            <path id="cp0" d="M86 30 C 250 30, 300 85, 432 85" fill="none" stroke="rgba(230,234,225,.25)" strokeWidth="1" />
            <path id="cp1" d="M86 85 L 432 85" fill="none" stroke="rgba(230,234,225,.25)" strokeWidth="1" />
            <path id="cp2" d="M86 140 C 250 140, 300 85, 432 85" fill="none" stroke="rgba(230,234,225,.25)" strokeWidth="1" />
            <text x="0" y="35" fill="#C7D3CD" fontSize="15" fontFamily="var(--body)">Base</text>
            <text x="0" y="90" fill="#C7D3CD" fontSize="15" fontFamily="var(--body)">Ethereum</text>
            <text x="0" y="145" fill="#C7D3CD" fontSize="15" fontFamily="var(--body)">Solana</text>
            <circle cx="470" cy="85" r="38" fill="#E6EAE1" />
            <text x="470" y="91" textAnchor="middle" fill="#08130F" fontSize="16" fontWeight="700" fontFamily="var(--body)">NEAR</text>
            <circle id="cd0" r="4" fill="#9FD9BF" /><circle id="cd1" r="4" fill="#9FD9BF" /><circle id="cd2" r="4" fill="#9FD9BF" />
          </svg>
        </div>
      </div>
    </div>
  );
}
