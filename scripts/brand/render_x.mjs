// X (Twitter) account images from the unchanged seal (docs/brand/mark.svg, scripts/brand/make_marks.py):
//   docs/brand/x/profile-800x800.png  seal on night ink, whole seal inside X's circle crop
//   docs/brand/x/profile-48-preview.png  the profile picture as X shows it at 48 px (check only)
//   docs/brand/x/banner-1500x500.png  hero credit note + headline; bottom-left 420x220 left empty (profile picture
//                                     overlaps), everything important inside y 60..440 (X crops on mobile)
//   PW=~/.npm/_npx/<hash>/node_modules [CHROME=<path>] node scripts/brand/render_x.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const BRAND = join(ROOT, 'docs/brand'), OUT = join(BRAND, 'x');
const { chromium } = createRequire(join(process.env.PW ?? '.', 'x.js'))('playwright');
const fonts = JSON.parse(readFileSync(join(BRAND, '.fonts.json'), 'utf8'));
if (!fonts.bodoniItalic) throw new Error('rerun scripts/brand/make_marks.py (records the Bodoni italic)');
const b64 = (f) => readFileSync(f).toString('base64');
const seal = `data:image/svg+xml;base64,${b64(join(BRAND, 'mark.svg'))}`;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });
page.on('pageerror', (e) => { throw e; });
async function shot(html, w, h, path, extraCss = '') {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face{font-family:Bodoni;src:url(data:font/woff2;base64,${b64(fonts.bodoni)});font-weight:400 900}
    @font-face{font-family:Bodoni;font-style:italic;src:url(data:font/woff2;base64,${b64(fonts.bodoniItalic)});font-weight:400 900}
    @font-face{font-family:Public;src:url(data:font/woff2;base64,${b64(fonts.public)});font-weight:100 900}
    html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#08130F}${extraCss}
    </style></head><body>${html}</body></html>`);
  await page.evaluate(async () => { await document.fonts.ready; if (window.drawBanner) window.drawBanner(); });
  return page.screenshot({ path, clip: { x: 0, y: 0, width: w, height: h } });
}
// same night and violet glow as the share card (render.mjs)
const glow = (x, y, r) => `radial-gradient(${r}px ${r * 0.8}px at ${x}px ${y}px, rgba(142,108,240,.28), transparent 70%)`;
const bg = (w, h, gx, gy, gr) => `position:absolute;inset:0;background:${glow(gx, gy, gr)}, radial-gradient(${w}px ${h}px at 50% 110%, #0F2A23, #08130F 70%)`;

// profile: the seal's outer ring (r 244 of 512) is 648 px wide at 680, inside X's 800 px circle with ~76 px to spare
const profile = `<div style="${bg(800, 800, 400, 400, 620)}"></div>
  <img src="${seal}" width="680" height="680" style="position:absolute;left:60px;top:60px">`;
await shot(profile, 800, 800, join(OUT, 'profile-800x800.png'));
const profilePng = `data:image/png;base64,${b64(join(OUT, 'profile-800x800.png'))}`;
await shot(`<div style="display:flex;gap:16px;align-items:center;padding:16px;background:#fff;height:100%;box-sizing:border-box">
    <img src="${profilePng}" width="48" height="48" style="border-radius:50%">
    <div style="background:#000;padding:16px;display:flex"><img src="${profilePng}" width="48" height="48" style="border-radius:50%"></div>
    <img src="${profilePng}" width="200" height="200" style="border-radius:50%">
  </div>`, 380, 232, join(OUT, 'profile-48-preview.png'));

// banner: the real hero credit note (web/src/lib/drawNote.ts, transpiled as is) with the seal stamped on it,
// tilted 4 degrees on the right; headline from x 300; faint seal ring off the right edge. Everything sits in the
// middle 1500x380 band (y 60..440) and the bottom-left 420x220 stays empty (profile picture).
const ts = createRequire(join(ROOT, 'web/package.json'))('typescript');
const noteJs = ts.transpileModule(readFileSync(join(ROOT, 'web/src/lib/drawNote.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  .replace(/^export /gm, '').replace(/^Object\.defineProperty\(exports.*$/m, '').replace(/^exports\..*$/gm, '');
const NOTE = { w: 450, x: 1026, y: 128 }; // 1100x540 note scaled to 450x221 (~30%); rotated about its centre
const NOTE_H = Math.round(NOTE.w * 540 / 1100);
const banner = `<div style="${bg(1500, 500, NOTE.x + NOTE.w / 2, NOTE.y + NOTE_H / 2, 760)}"></div>
  <img src="${seal}" width="1000" height="1000" style="position:absolute;left:1200px;top:-250px;opacity:.06">
  <div style="position:absolute;left:300px;top:82px;display:flex;flex-direction:column">
    <div style="font:500 15px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;color:#9FD9BF">PRIVATE CREDIT SCORING ON NEAR</div>
    <div id="hl" style="font:500 58px/1.06 Bodoni;color:#E6EAE1;letter-spacing:-.01em;margin-top:16px;white-space:nowrap">Prove your income.<br>
      <span id="it" style="font-style:italic;color:#8E6CF0">Keep your bank statements.</span></div>
    <div id="sub" style="font:500 19px/1 Public;color:#9FD9BF;margin-top:16px;white-space:nowrap">Scored in an Intel TDX enclave · no-collateral USDC loans · kredofi.xyz</div>
  </div>
  <div id="note" style="position:absolute;left:${NOTE.x}px;top:${NOTE.y}px;width:${NOTE.w}px;height:${NOTE_H}px;transform:rotate(4deg);
      box-shadow:0 28px 50px rgba(0,0,0,.55),0 6px 14px rgba(0,0,0,.35)">
    <canvas id="nc" width="${NOTE.w * 3}" height="${NOTE_H * 3}" style="width:100%;height:100%;display:block"></canvas>
    <img src="${seal}" style="position:absolute;width:${Math.round(NOTE.w * 170 / 1100)}px;left:${Math.round(NOTE.w * 890 / 1100)}px;top:${Math.round(NOTE.w * 140 / 1100)}px;transform:rotate(-14deg);opacity:.93">
  </div>
  <script>{${noteJs}
    window.drawBanner = () => drawNote(document.getElementById('nc').getContext('2d'), ${NOTE.w * 3}, ${NOTE_H * 3},
      { x: 0.5, y: 0.4 }, {}, { display: 'Bodoni', body: 'Public' }); }</script>`;
await shot(banner, 1500, 500, join(OUT, 'banner-1500x500.png'));
// layout report: boxes of headline, sub line and note (rotated bounds) for the overlap/clearance check
console.log(JSON.stringify(await page.evaluate(() => Object.fromEntries(['hl', 'it', 'sub', 'note'].map((id) => {
  const r = document.getElementById(id).getBoundingClientRect(); return [id, [r.left, r.top, r.right, r.bottom].map(Math.round)];
})))));
// check copy (CHECK_DIR only): the profile zone and the 60 px bands outlined
if (process.env.CHECK_DIR) await shot(banner + `<div style="position:absolute;left:0;bottom:0;width:420px;height:220px;outline:2px dashed #f55;outline-offset:-2px"></div>
  <div style="position:absolute;left:0;right:0;top:0;height:60px;background:rgba(255,80,80,.18)"></div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:60px;background:rgba(255,80,80,.18)"></div>`,
  1500, 500, join(process.env.CHECK_DIR, 'banner-check.png'));
await browser.close();
console.log('rendered docs/brand/x: profile-800x800.png, profile-48-preview.png, banner-1500x500.png');
