"""Builds the foliage card textures for the tree and plant models.

    python -I tools/map-assets/make_foliage.py <leaf-download-dir> <out-dir>

Leaves come from ambientCG leaf atlases (LeafSetNNN, CC0): every leaf is cut
out of its atlas along the opacity map and scattered along drawn twigs onto
a card, so one card reads as a leafy branch from a distance. Grass and
flower cards are drawn procedurally. Writes RGBA PNGs (alpha = coverage).
"""
import io
import math
import os
import random
import sys
import urllib.request
import zipfile

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ATLASES = {
    'oak': 'LeafSet016',
    'beech': 'LeafSet024',
    'birch': 'LeafSet014',
    'conifer': 'LeafSet019',
    'box': 'LeafSet002',
}


def fetch_atlas(name, dl):
    path = os.path.join(dl, f'{name}.zip')
    if not os.path.exists(path):
        req = urllib.request.Request(f'https://ambientcg.com/get?file={name}_1K-JPG.zip',
                                     headers={'User-Agent': '3dtd-map-assets'})
        with urllib.request.urlopen(req) as r, open(path, 'wb') as f:
            f.write(r.read())
    z = zipfile.ZipFile(path)
    names = z.namelist()
    color = Image.open(io.BytesIO(z.read(next(n for n in names if n.endswith('_Color.jpg'))))).convert('RGB')
    alpha = Image.open(io.BytesIO(z.read(next(n for n in names if n.endswith('_Opacity.jpg'))))).convert('L')
    return color, alpha


def cut_leaves(color, alpha):
    """Each connected opaque region of the atlas as its own RGBA sprite, stem down"""
    a = np.array(alpha) > 100
    labels, n = ndimage.label(a)
    sprites = []
    for k, sl in enumerate(ndimage.find_objects(labels), start=1):
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if h * w < 400:
            continue
        rgba = np.dstack([np.array(color)[sl], (labels[sl] == k).astype(np.uint8) * np.array(alpha)[sl]])
        sprites.append(Image.fromarray(rgba, 'RGBA'))
    return sprites


def bleed(card):
    """Fills transparent texels with the colour of the nearest leaves, so mipmaps do not darken the edges"""
    arr = np.array(card).astype(np.float32)
    a = (arr[..., 3] > 128).astype(np.float32)
    rgb = arr[..., :3].copy()
    pre = arr[..., :3] * a[..., None]
    filled = a.copy()
    for r in (1, 2, 4, 8, 16, 32, 64):
        bp = ndimage.gaussian_filter(pre, sigma=(r, r, 0))
        ba = ndimage.gaussian_filter(a, r)
        mask = (filled == 0) & (ba > 1e-4)
        rgb[mask] = bp[mask] / ba[mask][:, None]
        filled[mask] = 1
    out = np.dstack([rgb.clip(0, 255), arr[..., 3]]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def branch_card(sprites, size, leaf_px, count, twig, seed, conifer=False):
    """A twig drawn from the bottom centre with leaves along it"""
    rnd = random.Random(seed)
    card = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    # Twigs: a main stem and side shoots
    stems = []
    base = (size * 0.5, size * 0.98)
    tip = (size * 0.5 + rnd.uniform(-0.1, 0.1) * size, size * 0.06)
    stems.append((base, tip))
    shoots = 9 if not conifer else 11
    for k in range(shoots):
        t = 0.12 + 0.8 * k / shoots
        p = (base[0] + (tip[0] - base[0]) * t, base[1] + (tip[1] - base[1]) * t)
        side = -1 if k % 2 else 1
        length = size * (0.5 if not conifer else 0.46) * (1 - t * 0.5)
        ang = math.radians(rnd.uniform(45, 80)) * side
        q = (p[0] + math.sin(ang) * length, p[1] - math.cos(ang) * length * 0.7)
        stems.append((p, q))
    for a, b in stems:
        draw.line([a, b], fill=twig, width=max(2, size // 160))
    # Leaves along the twigs, the bigger ones first so small ones sit on top
    placed = []
    for _ in range(count * 2):
        if len(placed) >= count:
            break
        a, b = rnd.choice(stems)
        t = rnd.uniform(0.15, 1.0)
        p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        if not conifer:
            # Leaves sit off the twig on short stalks
            off = rnd.uniform(-1, 1) * leaf_px * 0.6
            n = (-(b[1] - a[1]), b[0] - a[0])
            ln = math.hypot(*n) or 1
            p = (p[0] + n[0] / ln * off, p[1] + n[1] / ln * off)
        if not conifer and math.hypot(p[0] - size * 0.5, (p[1] - size * 0.5) * 1.1) > size * (0.36 + 0.08 * rnd.random()):
            continue  # keep the leafy part round, so a card never reads as a square
        direction = math.degrees(math.atan2(b[0] - a[0], -(b[1] - a[1])))
        spread = rnd.uniform(-70, 70) if not conifer else rnd.uniform(-12, 12)
        scale = leaf_px * rnd.uniform(0.7, 1.15) * (0.8 + 0.3 * (1 - t))
        placed.append((scale, p, direction + spread))
    placed.sort(key=lambda x: -x[0])
    for scale, p, ang in placed:
        s = rnd.choice(sprites)
        ratio = scale / max(s.size)
        leaf = s.resize((max(1, int(s.size[0] * ratio)), max(1, int(s.size[1] * ratio))), Image.LANCZOS)
        # Colour jitter: slight hue and brightness per leaf
        arr = np.array(leaf).astype(np.float32)
        arr[..., :3] *= rnd.uniform(0.6, 0.95)
        arr[..., 1] *= rnd.uniform(0.95, 1.06)
        leaf = Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGBA').rotate(-ang, expand=True, resample=Image.BICUBIC)
        # Stem of the leaf (bottom of the sprite) towards the twig
        card.alpha_composite(leaf, (int(p[0] - leaf.size[0] / 2), int(p[1] - leaf.size[1] / 2)))
    return bleed(card)


def grass_card(size_w, size_h, seed, flowers=False):
    rnd = random.Random(seed)
    card = Image.new('RGBA', (size_w, size_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    for _ in range(170):
        x = rnd.uniform(0.05, 0.95) * size_w
        h = rnd.uniform(0.45, 0.98) * size_h
        lean = rnd.uniform(-0.25, 0.25) * h
        w = rnd.uniform(3, 7) * size_w / 512
        # Close to the ground grass (Grass004 averages #606d30), some blades dry
        base_col = np.array([rnd.uniform(78, 100), rnd.uniform(96, 118), rnd.uniform(34, 50)])
        if rnd.random() < 0.2:
            base_col = np.array([rnd.uniform(118, 140), rnd.uniform(116, 132), rnd.uniform(58, 74)])
        steps = 10
        for k in range(steps):
            t0 = k / steps
            t1 = (k + 1) / steps
            def pt(t, side):
                bend = lean * t * t
                return (x + bend + side * w * (1 - t) / 2, size_h - h * t)
            shade = 0.85 + 0.3 * t1
            col = tuple(int(c) for c in (base_col * shade).clip(0, 255)) + (255,)
            draw.polygon([pt(t0, -1), pt(t0, 1), pt(t1, 1), pt(t1, -1)], fill=col)
    if flowers:
        palette = [(240, 240, 235), (250, 215, 60), (170, 120, 210), (235, 110, 120)]
        for _ in range(26):
            x = rnd.uniform(0.08, 0.92) * size_w
            y = size_h - rnd.uniform(0.45, 0.95) * size_h
            r = rnd.uniform(5, 9) * size_w / 512
            col = rnd.choice(palette)
            draw.line([(x, y), (x + rnd.uniform(-4, 4), size_h)], fill=(70, 105, 40, 255), width=2)
            for p in range(6):
                a = p / 6 * math.tau
                draw.ellipse([x + math.cos(a) * r - r * 0.6, y + math.sin(a) * r * 0.6 - r * 0.6,
                              x + math.cos(a) * r + r * 0.6, y + math.sin(a) * r * 0.6 + r * 0.6], fill=col + (255,))
            draw.ellipse([x - r * 0.45, y - r * 0.45, x + r * 0.45, y + r * 0.45], fill=(230, 180, 40, 255))
    return bleed(card)


def main():
    dl, out = sys.argv[1], sys.argv[2]
    os.makedirs(dl, exist_ok=True)
    os.makedirs(out, exist_ok=True)
    sprites = {k: cut_leaves(*fetch_atlas(v, dl)) for k, v in ATLASES.items()}
    branch_card(sprites['beech'] + sprites['beech'] + sprites['oak'], 512, 64, 420, (70, 52, 36, 255), 1).save(os.path.join(out, 'leaves-oak.png'))
    branch_card(sprites['birch'], 512, 46, 480, (90, 80, 70, 255), 2).save(os.path.join(out, 'leaves-birch.png'))
    branch_card(sprites['conifer'], 512, 150, 90, (60, 45, 32, 255), 3, conifer=True).save(os.path.join(out, 'leaves-conifer.png'))
    branch_card(sprites['box'], 512, 80, 300, (60, 48, 34, 255), 4).save(os.path.join(out, 'leaves-bush.png'))
    grass_card(512, 256, 5).save(os.path.join(out, 'grass.png'))
    grass_card(512, 256, 6, flowers=True).save(os.path.join(out, 'flowers.png'))
    print('foliage ok', file=sys.stderr)


main()
