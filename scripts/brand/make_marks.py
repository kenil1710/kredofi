# KredoFi mark (option C, "Engraved seal", chosen Nov 9) as SVG: docs/brand/mark.svg (512), mark-32.svg
# (favicon, nav), mark-16.svg (pixel-fitted 16 px). Glyphs are Bodoni Moda / Public Sans outlines (no
# font needed to display them), taken from the fonts next/font self-hosts: build web/ once first.
#   uv run --with fonttools --with brotli python3 scripts/brand/make_marks.py
# Then: PW=~/.npm/_npx/<hash>/node_modules node scripts/brand/render.mjs
import glob, json, math, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'docs', 'brand')

def find_font(family, need='K', style=('Regular', 'Thin Regular')):
    for f in sorted(glob.glob(os.path.join(ROOT, 'web', '.next', 'static', 'media', '*.woff2'))):
        t = TTFont(f)
        if t['name'].getDebugName(1).startswith(family) and t['name'].getDebugName(2) in style \
                and 'Italic' not in t['name'].getDebugName(1) and all(ord(c) in t.getBestCmap() for c in need):
            return f
    sys.exit(f'{family} not found in web/.next/static/media: run a web build first')

BODONI, PUBLIC = find_font('Bodoni Moda'), find_font('Public Sans')
BODONI_ITALIC = find_font('Bodoni Moda', 'Keep your bank statements.', ('Italic',))  # X banner (render_x.mjs)
C = dict(night='#08130F', deep='#0F2A23', paper='#E6EAE1', mint='#9FD9BF', violet='#8E6CF0')

def glyph_k(wght, opsz):
    f = instantiateVariableFont(TTFont(BODONI), {'wght': wght, 'opsz': opsz})
    gs = f.getGlyphSet(); g = f.getBestCmap()[ord('K')]
    bp = BoundsPen(gs); gs[g].draw(bp); x0, y0, x1, y1 = bp.bounds
    sp = SVGPathPen(gs); gs[g].draw(TransformPen(sp, (1, 0, 0, -1, -x0, y1)))
    return {'d': sp.getCommands(), 'w': x1 - x0, 'h': y1 - y0}
K = {'big': glyph_k(700, 96), 'small': glyph_k(800, 11)}

def k(cut, cx, cy, h, fill, dx=0):
    g = K[cut]; s = h / g['h']; w = g['w'] * s
    return f'<path transform="translate({cx - w/2 + dx:.2f} {cy - h/2:.2f}) scale({s:.5f})" d="{g["d"]}" fill="{fill}"/>'

def poly(fn, n):
    return 'M' + ' L'.join(f'{x:.2f} {y:.2f}' for x, y in (fn(2 * math.pi * i / n) for i in range(n))) + 'Z'

def guilloche(cx, cy, r, a, n, phases, stroke, sw, op):
    return ''.join(f'<path d="{poly(lambda t, p=p: (cx + (r + a * math.sin(n * t + p)) * math.cos(t), cy + (r + a * math.sin(n * t + p)) * math.sin(t)), 1440)}" fill="none" stroke="{stroke}" stroke-width="{sw}" opacity="{op}"/>' for p in phases)

ps = instantiateVariableFont(TTFont(PUBLIC), {'wght': 600})
gs, cmap, hmtx, upm = ps.getGlyphSet(), ps.getBestCmap(), ps['hmtx'], ps['head'].unitsPerEm
def ring_text(cx, cy, r, text, size, fill, track=0.12):
    s = size / upm
    adv = [hmtx[cmap[ord(ch)]][0] * s + size * track for ch in text]
    total = sum(adv); reps = max(1, round(2 * math.pi * r / total)); fit = 2 * math.pi * r / (total * reps)
    out, pos = [], 0.0
    for _ in range(reps):
        for ch, a in zip(text, adv):
            a *= fit
            if ch != ' ':
                sp = SVGPathPen(gs); gs[cmap[ord(ch)]].draw(TransformPen(sp, (s, 0, 0, -s, 0, 0)))
                ang = (pos + a / 2) / r - math.pi / 2
                x, y = cx + r * math.cos(ang), cy + r * math.sin(ang)
                w = hmtx[cmap[ord(ch)]][0] * s
                out.append(f'<path transform="translate({x:.2f} {y:.2f}) rotate({math.degrees(ang) + 90:.2f}) translate({-w/2:.2f} {size*0.36:.2f})" d="{sp.getCommands()}"/>')
            pos += a
    return f'<g fill="{fill}">{"".join(out)}</g>'

def svg(vb, body): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb} {vb}">{body}</svg>\n'

marks = {
  'mark.svg': svg(512, f'<circle cx="256" cy="256" r="244" fill="{C["deep"]}"/>'
      + f'<circle cx="256" cy="256" r="236" fill="none" stroke="{C["mint"]}" stroke-width="3"/>'
      + ring_text(256, 256, 210, 'KREDOFI CREDIT NOTE · SEALED IN THE ENCLAVE · ', 22, C['mint'])
      + f'<circle cx="256" cy="256" r="184" fill="none" stroke="{C["mint"]}" stroke-width="2"/>'
      + guilloche(256, 256, 172, 6, 30, [0, 2.1], C['violet'], 1.4, .8)
      + f'<circle cx="256" cy="256" r="160" fill="{C["night"]}" stroke="{C["mint"]}" stroke-width="1"/>'
      + k('big', 256, 256, 196, C['paper'], 6)),
  'mark-32.svg': svg(32, f'<rect width="32" height="32" rx="7" fill="{C["deep"]}"/>'
      + f'<circle cx="16" cy="16" r="13.5" fill="none" stroke="{C["mint"]}" stroke-width="1.3"/>'
      + k('small', 16, 16, 15.5, C['paper'], .4)),
  'mark-16.svg': svg(16, f'<rect width="16" height="16" rx="3.5" fill="{C["deep"]}"/>' + k('small', 8, 8, 10.5, C['paper'], .2)),
}
os.makedirs(OUT, exist_ok=True)
for name, body in marks.items():
    open(os.path.join(OUT, name), 'w').write(body)
json.dump({'bodoni': os.path.abspath(BODONI), 'bodoniItalic': os.path.abspath(BODONI_ITALIC), 'public': os.path.abspath(PUBLIC)}, open(os.path.join(OUT, '.fonts.json'), 'w'))
print('wrote', ', '.join(marks))
