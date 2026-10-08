"""Trace the gold logo PNG into a one-colour SVG (alpha mask -> potrace).

uv run --with potracer --with pillow --with numpy python tools/logo/vectorize_logo.py     public/assets/images/logo/logo.png public/assets/images/logo/logo.svg
... public/favicon.svg mark   # the pin with tower and ball, square, for the favicon
"""
import sys
import numpy as np
import potrace
from PIL import Image

SRC, OUT, SCALE = sys.argv[1], sys.argv[2], 4
FILL = '#C2A055'
# 'mark': keep only the pin with tower and ball (drop the letters) in a square box
MARK = len(sys.argv) > 3 and sys.argv[3] == 'mark'

im = Image.open(SRC).convert('RGBA')
w, h = im.size
alpha = im.getchannel('A').resize((w * SCALE, h * SCALE), Image.LANCZOS)
mask = np.array(alpha) <= 127  # potracer traces the False pixels
bm = potrace.Bitmap(mask)
plist = bm.trace(turdsize=8 * SCALE, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
                 alphamax=1.0, opticurve=True, opttolerance=0.4)

def f(v):
    return f'{v / SCALE:.2f}'.rstrip('0').rstrip('.')

parts = []
for curve in plist:
    xs = [curve.start_point.x] + [s.end_point.x for s in curve.segments]
    if MARK and min(xs) / SCALE > 225:
        continue
    sp = curve.start_point
    d = [f'M{f(sp.x)} {f(sp.y)}']
    for seg in curve.segments:
        if seg.is_corner:
            d.append(f'L{f(seg.c.x)} {f(seg.c.y)}L{f(seg.end_point.x)} {f(seg.end_point.y)}')
        else:
            d.append(f'C{f(seg.c1.x)} {f(seg.c1.y)} {f(seg.c2.x)} {f(seg.c2.y)} {f(seg.end_point.x)} {f(seg.end_point.y)}')
    d.append('Z')
    parts.append(''.join(d))

box = f'-4 0 {h} {h}' if MARK else f'0 0 {w} {h}'
size = '' if MARK else f' width="{w}" height="{h}"'
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}"{size}>'
       f'<path fill="{FILL}" fill-rule="evenodd" d="{"".join(parts)}"/></svg>\n')
open(OUT, 'w').write(svg)
print(OUT, len(svg), 'bytes', len(plist), 'curves')
