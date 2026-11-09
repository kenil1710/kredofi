// Renders the brand rasters from docs/brand/mark*.svg (scripts/brand/make_marks.py) with headless Chromium:
//   web/src/app: favicon.ico (16+32+48), icon.svg, icon1.png 16, icon2.png 32, icon3.png 512, apple-icon.png 180,
//   web/public/share-card.png 1200x630 (og:image and twitter:image on every page, web/src/app/layout.tsx);
//   docs/brand: share-card-1200x630.png, end-card-1920x1080.png (video).
//   PW=~/.npm/_npx/<hash>/node_modules [CHROME=<path>] node scripts/brand/render.mjs
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const BRAND = join(ROOT, 'docs/brand'), APP = join(ROOT, 'web/src/app');
const { chromium } = createRequire(join(process.env.PW ?? '.', 'x.js'))('playwright');
const fonts = JSON.parse(readFileSync(join(BRAND, '.fonts.json'), 'utf8'));
const b64 = (f) => readFileSync(f).toString('base64');
const svgUri = (n) => `data:image/svg+xml;base64,${b64(join(BRAND, n))}`;
export const TAGLINE = 'Prove your income on NEAR without showing your bank statements';

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function shot(html, w, h, path, transparent = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face{font-family:Bodoni;src:url(data:font/woff2;base64,${b64(fonts.bodoni)});font-weight:400 900}
    @font-face{font-family:Public;src:url(data:font/woff2;base64,${b64(fonts.public)});font-weight:100 900}
    html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${transparent ? 'transparent' : '#08130F'}}
    </style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ path, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
}
const icon = (n, s, path) => shot(`<img src="${svgUri(n)}" width="${s}" height="${s}" style="display:block">`, s, s, path, true);

// favicon set
const p16 = await icon('mark-16.svg', 16, join(APP, 'icon1.png'));
const p32 = await icon('mark-32.svg', 32, join(APP, 'icon2.png'));
const p48 = await icon('mark-32.svg', 48);
await icon('mark.svg', 512, join(APP, 'icon3.png'));
copyFileSync(join(BRAND, 'mark-32.svg'), join(APP, 'icon.svg'));
// .ico with PNG entries (Vista+ format): header, one 16-byte directory entry per image, then the images
const imgs = [[16, p16], [32, p32], [48, p48]];
const head = Buffer.alloc(6 + 16 * imgs.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
let off = head.length;
imgs.forEach(([s, png], i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(off, e + 12); off += png.length;
});
writeFileSync(join(APP, 'favicon.ico'), Buffer.concat([head, ...imgs.map(([, p]) => p)]));
// apple-touch-icon: opaque (iOS fills transparency with black), iOS rounds the corners itself
await shot(`<div style="width:180px;height:180px;background:#0F2A23;display:grid;place-items:center"><img src="${svgUri('mark.svg')}" width="164" height="164"></div>`, 180, 180, join(APP, 'apple-icon.png'));

// share card and video end card: the landing page's night, its violet glow and type
const glow = (x, y, r) => `radial-gradient(${r}px ${r * 0.8}px at ${x}px ${y}px, rgba(142,108,240,.28), transparent 70%)`;
const bg = (w, h, gx, gy, gr) => `position:absolute;inset:0;background:${glow(gx, gy, gr)}, radial-gradient(${w}px ${h}px at 50% 110%, #0F2A23, #08130F 70%)`;
const card = `<div style="${bg(1200, 630, 300, 315, 520)}"></div>
  <div style="position:absolute;left:72px;top:125px"><img src="${svgUri('mark.svg')}" width="380" height="380"></div>
  <div style="position:absolute;left:520px;right:72px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:26px">
    <div style="font:600 18px/1 Public;letter-spacing:.24em;color:#9FD9BF">KREDOFI</div>
    <div style="font:500 58px/1.08 Bodoni;color:#E6EAE1;letter-spacing:-.01em">${TAGLINE}.</div>
    <div style="font:500 26px/1 Public;color:#9FD9BF">kredofi.xyz</div>
  </div>`;
await shot(card, 1200, 630, join(ROOT, 'web/public/share-card.png')); // og:image / twitter:image (web/src/app/layout.tsx)
copyFileSync(join(ROOT, 'web/public/share-card.png'), join(BRAND, 'share-card-1200x630.png'));

const end = `<div style="${bg(1920, 1080, 960, 330, 760)}"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
    <img src="${svgUri('mark.svg')}" width="340" height="340">
    <div style="font:600 128px/1 Bodoni;color:#E6EAE1;margin-top:44px;letter-spacing:-.01em">KredoFi</div>
    <div style="font:500 44px/1.2 Bodoni;color:#E6EAE1;opacity:.92;margin-top:26px;max-width:1300px;text-wrap:balance">${TAGLINE}.</div>
    <div style="width:120px;height:1px;background:#9FD9BF;opacity:.6;margin:52px 0 40px"></div>
    <div style="font:600 24px/1 Public;letter-spacing:.28em;color:#9FD9BF">BUILT AT NEAR HACKATHON</div>
    <div style="font:500 36px/1 Public;color:#E6EAE1;margin-top:26px">kredofi.xyz</div>
  </div>`;
await shot(end, 1920, 1080, join(BRAND, 'end-card-1920x1080.png'));
await browser.close();
console.log('rendered favicon set, apple icon, share card, end card');
