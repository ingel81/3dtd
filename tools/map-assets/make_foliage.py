"""Builds the foliage card textures for the tree and plant models.

    python -I tools/map-assets/make_foliage.py <leaf-download-dir> <out-dir>

Leaves come from ambientCG leaf atlases (LeafSetNNN, CC0): every leaf is cut
out of its atlas along the opacity map and scattered along drawn twigs onto
a card, so one card reads as a leafy branch from a distance. Grass cards
use the photo blades of the ambientCG Foliage atlases; flowers, reeds'
cattails, palm fronds, lily pads, flames, falling water, foam and banners
are drawn. Writes RGBA PNGs (alpha = coverage) and the cactus skin JPEG.
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
    'maple-red': 'LeafSet027',
    'maple-mixed': 'LeafSet028',
    'maple-green': 'LeafSet010',
    'oak-autumn': 'LeafSet012',
    'oak-rust': 'LeafSet030',
    'birch-yellow': 'LeafSet007',
    'birch-pale': 'LeafSet008',
    'narrow': 'LeafSet013',
    'ivy': 'LeafSet029',
    'glossy': 'LeafSet022',
}

# Grass blade atlases (ambientCG FoliageNNN, CC0): single blades and stalks, cut out like leaves
BLADES = {
    'broad': 'Foliage001',
    'seed': 'Foliage002',
    'wisp': 'Foliage003',
    'thin': 'Foliage004',
    'mixed': 'Foliage006',
    'long': 'Foliage008',
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


def grass_card(size_w, size_h, seed, flowers=False, palette=None):
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
        palette = palette or [(240, 240, 235), (250, 215, 60), (170, 120, 210), (235, 110, 120)]
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


def tinted(sprite, tint):
    arr = np.array(sprite).astype(np.float32)
    arr[..., :3] *= np.array(tint, dtype=np.float32)
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGBA')


def upright(sprites):
    """Blades with the long side vertical"""
    return [s.rotate(90, expand=True) if s.size[0] > s.size[1] else s for s in sprites]


def blade_card(sprites, size_w, size_h, count, seed, tint=(1, 1, 1), tips=None, heads=False, ears=None):
    """Photo grass blades (ambientCG Foliage atlases) standing on the bottom edge of the card.

    `tips`: colour blended onto the upper part of each blade (snow, frost);
    `heads`: brown cattail heads on some stalks; `ears`: colour of grain ears (wheat).
    """
    rnd = random.Random(seed)
    card = Image.new('RGBA', (size_w, size_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    blades = upright(sprites)
    for k in range(count):
        s = rnd.choice(blades)
        h = int(size_h * rnd.uniform(0.5, 0.98))
        w = max(2, int(min(s.size[0] * h / s.size[1], h * 0.07) * rnd.uniform(0.8, 1.3)))
        blade = s.resize((w, h), Image.LANCZOS)
        if rnd.random() < 0.5:
            blade = blade.transpose(Image.FLIP_LEFT_RIGHT)
        jitter = rnd.uniform(0.75, 1.05)
        blade = tinted(blade, [c * jitter for c in tint])
        if tips:
            arr = np.array(blade).astype(np.float32)
            t = np.clip(1.0 - np.linspace(0, 1, h) * rnd.uniform(1.6, 2.6), 0, 1)[:, None, None]
            arr[..., :3] = arr[..., :3] * (1 - t) + np.array(tips, dtype=np.float32) * t
            blade = Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGBA')
        blade = blade.rotate(rnd.uniform(-14, 14), expand=True, resample=Image.BICUBIC)
        x = int(rnd.uniform(0.04, 0.96) * size_w - blade.size[0] / 2)
        card.alpha_composite(blade, (x, size_h - blade.size[1]))
        top = (x + blade.size[0] / 2, size_h - blade.size[1])
        if heads and k % 4 == 0:
            r = size_w / 110
            draw.line([top, (top[0], top[1] - r * 2)], fill=(90, 85, 50, 255), width=max(1, int(r * 0.35)))
            draw.rounded_rectangle([top[0] - r, top[1] + r * 1.2, top[0] + r, top[1] + r * 8], radius=r,
                                   fill=(92, 58, 34, 255))
        if ears and k % 3 == 0:
            r = size_w / 160
            for e in range(7):
                y = top[1] + e * r * 1.3
                draw.ellipse([top[0] - r * 1.1, y, top[0] + r * 0.1, y + r * 1.6], fill=ears + (255,))
                draw.ellipse([top[0] - r * 0.1, y + r * 0.5, top[0] + r * 1.1, y + r * 2.1], fill=ears + (255,))
    return bleed(card)


def strand_card(sprites, size_w, size_h, leaf_px, count, twig, seed):
    """Willow: thin drooping twigs with narrow leaves from the base (bottom) to the tip (top) of the card"""
    rnd = random.Random(seed)
    card = Image.new('RGBA', (size_w, size_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    strands = []
    for k in range(5):
        x0 = size_w * (0.2 + 0.6 * k / 4) + rnd.uniform(-10, 10)
        pts = [(x0 + math.sin(t * 2.5 + k) * size_w * 0.05, size_h * (1 - t)) for t in np.linspace(0.02, 0.98, 12)]
        strands.append(pts)
        draw.line(pts, fill=twig, width=max(2, size_w // 128))
    for _ in range(count):
        pts = rnd.choice(strands)
        i = rnd.randrange(len(pts) - 1)
        t = rnd.random()
        p = (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t)
        s = rnd.choice(sprites)
        ratio = leaf_px * rnd.uniform(0.7, 1.1) / max(s.size)
        leaf = s.resize((max(1, int(s.size[0] * ratio)), max(1, int(s.size[1] * ratio))), Image.LANCZOS)
        leaf = tinted(leaf, (rnd.uniform(0.6, 0.85), rnd.uniform(0.7, 0.95), rnd.uniform(0.4, 0.6)))
        leaf = leaf.rotate(rnd.choice((-1, 1)) * rnd.uniform(15, 40), expand=True, resample=Image.BICUBIC)
        card.alpha_composite(leaf, (int(p[0] - leaf.size[0] / 2), int(p[1] - leaf.size[1] / 2)))
    return bleed(card)


def frond_card(size, seed, base_col=(58, 98, 36), dry=False):
    """Palm frond: a curved midrib from the bottom centre with long leaflets angled towards the tip"""
    rnd = random.Random(seed)
    card = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    rib = [(size * 0.5 + math.sin(t * 1.4) * size * 0.06, size * (0.99 - 0.95 * t)) for t in np.linspace(0, 1, 64)]
    for i in range(3, len(rib) - 1):
        t = i / len(rib)
        for side in (-1, 1):
            length = size * 0.42 * math.sin(math.pi * min(1.0, t * 1.1)) * rnd.uniform(0.85, 1.1)
            ang = math.radians(rnd.uniform(48, 62)) * side
            p = rib[i]
            tip = (p[0] + math.sin(ang) * length, p[1] - math.cos(ang) * length - length * 0.15)
            n = (-(tip[1] - p[1]), tip[0] - p[0])
            ln = math.hypot(*n) or 1
            w = size / 34
            mid = ((p[0] + tip[0]) / 2 + n[0] / ln * w, (p[1] + tip[1]) / 2 + n[1] / ln * w)
            mid2 = ((p[0] + tip[0]) / 2 - n[0] / ln * w * 0.4, (p[1] + tip[1]) / 2 - n[1] / ln * w * 0.4)
            shade = rnd.uniform(0.75, 1.15) * (0.9 + 0.2 * t)
            col = np.array(base_col) * shade
            if dry and rnd.random() < 0.35:
                col = np.array((140, 110, 60)) * rnd.uniform(0.8, 1.1)
            draw.polygon([p, mid, tip, mid2], fill=tuple(int(c) for c in col.clip(0, 255)) + (255,))
    draw.line(rib, fill=(110, 105, 60, 255), width=max(2, size // 120))
    return bleed(card)


def snowy(card, seed, amount=0.7):
    """Snow on a foliage card: white blobs over the leaves, denser towards the card's tip"""
    rnd = np.random.default_rng(seed)
    arr = np.array(card).astype(np.float32)
    h, w = arr.shape[:2]
    noise = ndimage.gaussian_filter(rnd.random((h, w)), 9)
    noise = (noise - noise.min()) / (noise.max() - noise.min() + 1e-6)
    up = np.linspace(1.0, 0.6, h)[:, None]
    m = np.clip((noise * up - (1 - amount)) * 6, 0, 1)
    snow = np.array((235, 240, 248), dtype=np.float32)
    arr[..., :3] = arr[..., :3] * (1 - m[..., None]) + snow * m[..., None]
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGBA')


def lily_pad(size, seed):
    """A round floating leaf with a notch and radial veins"""
    rnd = random.Random(seed)
    card = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    c = size / 2
    r = size * 0.47
    notch = math.radians(7)
    pts = [(c, c)] + [(c + math.cos(a) * r, c + math.sin(a) * r) for a in np.linspace(notch, math.tau - notch, 64)]
    draw.polygon(pts, fill=(52, 86, 34, 255))
    for k in range(18):
        a = notch + (math.tau - 2 * notch) * k / 17
        draw.line([(c, c), (c + math.cos(a) * r * 0.95, c + math.sin(a) * r * 0.95)], fill=(76, 110, 50, 255), width=2)
    arr = np.array(card).astype(np.float32)
    n = ndimage.gaussian_filter(np.random.default_rng(seed).random((size, size)), 6)
    arr[..., :3] *= (0.8 + 0.5 * (n - n.min()) / (n.max() - n.min()))[..., None]
    arr[..., 0] += 18 * rnd.random()
    return bleed(Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGBA'))


def blossom(size, petals, col, centre, seed):
    """A flower seen from above (water lily): pointed petals in two rings around a centre"""
    rnd = random.Random(seed)
    card = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    c = size / 2
    for ring, r in enumerate((0.48, 0.34)):
        for k in range(petals):
            a = (k + 0.5 * ring) / petals * math.tau
            tip = (c + math.cos(a) * size * r, c + math.sin(a) * size * r)
            side = (math.cos(a + 1.57) * size * 0.07, math.sin(a + 1.57) * size * 0.07)
            mid = (c + math.cos(a) * size * r * 0.45, c + math.sin(a) * size * r * 0.45)
            shade = rnd.uniform(0.85, 1.0) * (1.0 if ring else 0.92)
            fill = tuple(int(v * shade) for v in col) + (255,)
            draw.polygon([(c, c), (mid[0] + side[0], mid[1] + side[1]), tip, (mid[0] - side[0], mid[1] - side[1])], fill=fill)
    draw.ellipse([c - size * 0.08, c - size * 0.08, c + size * 0.08, c + size * 0.08], fill=centre + (255,))
    return bleed(card)


def cactus_skin(size, seed):
    """Opaque skin for cacti: vertical ribs with spine dots (u around, v along)"""
    rnd = np.random.default_rng(seed)
    x = np.linspace(0, 1, size)
    ribs = 0.5 + 0.5 * np.cos(x * math.tau * 8)
    shade = 0.55 + 0.45 * ribs
    n = ndimage.gaussian_filter(rnd.random((size, size)), 3)
    n = (n - n.min()) / (n.max() - n.min())
    base = np.array((62, 98, 52), dtype=np.float32)
    arr = base[None, None, :] * (shade[None, :, None] * (0.85 + 0.3 * n[..., None]))
    img = Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGB')
    draw = ImageDraw.Draw(img)
    for k in range(8):
        cx = k / 8 * size
        for y in range(0, size, size // 24):
            yy = y + (k % 2) * size / 48
            draw.ellipse([cx - 2, yy - 2, cx + 2, yy + 2], fill=(215, 205, 170))
    return img


def flame(size_w, size_h, seed):
    """A flame tongue: yellow core, orange edge, soft alpha towards the tip"""
    rnd = np.random.default_rng(seed)
    y, x = np.mgrid[0:size_h, 0:size_w].astype(np.float32)
    t = 1.0 - y / size_h  # 0 bottom, 1 top
    u = (x / size_w - 0.5) * 2
    wobble = 0.08 * np.sin(t * 9 + 1.3) + 0.05 * np.sin(t * 17)
    width = 0.95 * (1 - t) ** 0.6 * np.clip(t * 12 + 0.45, 0, 1) + 0.02
    d = np.abs(u - wobble * t) / width
    a = np.clip(1.2 - d, 0, 1) * np.clip((1 - t) * 3, 0, 1)
    n = ndimage.gaussian_filter(rnd.random((size_h, size_w)), 4)
    a *= 0.75 + 0.5 * (n - n.min()) / (n.max() - n.min())
    core = np.clip(1.0 - d * 1.6, 0, 1)[..., None]
    rgb = np.array((255, 120, 30), np.float32) * (1 - core) + np.array((255, 225, 140), np.float32) * core
    img = np.dstack([rgb, np.clip(a * 300, 0, 255)]).astype(np.uint8)
    return bleed(Image.fromarray(img, 'RGBA'))


def water_sheet(size_w, size_h, seed):
    """Falling water: vertical streaks of white and pale blue-green with ragged edges"""
    rnd = np.random.default_rng(seed)
    streaks = ndimage.gaussian_filter(rnd.random((1, size_w)), (0, 2))
    streaks = np.repeat(streaks, size_h, axis=0)
    flow = ndimage.gaussian_filter(rnd.random((size_h, size_w)), (12, 1.5))
    v = (streaks - streaks.min()) / (streaks.max() - streaks.min()) * 0.6 + (flow - flow.min()) / (flow.max() - flow.min()) * 0.4
    deep = np.array((70, 110, 115), np.float32)
    foam = np.array((235, 242, 245), np.float32)
    rgb = deep * (1 - v[..., None]) + foam * v[..., None]
    edge = np.minimum(np.linspace(0, 1, size_w) * 6, (1 - np.linspace(0, 1, size_w)) * 6).clip(0, 1)
    # Gaps between the strands and a ragged lip, so the sheet does not read as a board
    a = np.clip((v - 0.28) * 2.2, 0, 1) * edge[None, :] * 255
    lip = (ndimage.gaussian_filter(rnd.random(size_w), 3) * size_h * 0.15).astype(int)
    for x in range(size_w):
        a[:max(0, lip[x] - int(size_h * 0.04)), x] = 0
    a[a < 70] = 0
    return bleed(Image.fromarray(np.dstack([rgb, a]).clip(0, 255).astype(np.uint8), 'RGBA'))


def foam(size, seed):
    """Spray at the foot of a waterfall: white blobs with soft edges"""
    rnd = np.random.default_rng(seed)
    n = ndimage.gaussian_filter(rnd.random((size, size)), 5)
    n = (n - n.min()) / (n.max() - n.min())
    y, x = np.mgrid[0:size, 0:size] / size - 0.5
    r = np.sqrt(x * x + y * y) * 2
    a = np.clip((n - 0.35) * 3 - r * 1.2 + 0.6, 0, 1) * 255
    rgb = np.ones((size, size, 3), np.float32) * np.array((235, 240, 242), np.float32)
    return bleed(Image.fromarray(np.dstack([rgb, a]).astype(np.uint8), 'RGBA'))


def cloth_banner(size_w, size_h, colour, trim, seed):
    """A hanging banner: coloured field, golden trim, a simple emblem, swallow-tail bottom"""
    img = Image.new('RGBA', (size_w, size_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    notch = size_h * 0.12
    draw.polygon([(0, 0), (size_w, 0), (size_w, size_h), (size_w / 2, size_h - notch), (0, size_h)], fill=colour + (255,))
    b = size_w * 0.06
    draw.rectangle([0, 0, size_w, b], fill=trim + (255,))
    draw.line([(b, b), (b, size_h - notch * 0.9)], fill=trim + (255,), width=int(b * 0.5))
    draw.line([(size_w - b, b), (size_w - b, size_h - notch * 0.9)], fill=trim + (255,), width=int(b * 0.5))
    cx, cy, r = size_w / 2, size_h * 0.42, size_w * 0.24
    draw.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=trim + (255,))
    arr = np.array(img).astype(np.float32)
    n = ndimage.gaussian_filter(np.random.default_rng(seed).random(arr.shape[:2]), 3)
    arr[..., :3] *= (0.85 + 0.3 * (n - n.min()) / (n.max() - n.min()))[..., None]
    return bleed(Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGBA'))


def moss_strands(size_w, size_h, seed):
    """Hanging moss (Spanish moss): wavy grey-green threads falling from the top edge"""
    rnd = random.Random(seed)
    img = Image.new('RGBA', (size_w, size_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for _ in range(140):
        x = rnd.uniform(0.05, 0.95) * size_w
        length = rnd.uniform(0.35, 1.0) * size_h
        phase = rnd.uniform(0, 6.28)
        col = (int(rnd.uniform(95, 135)), int(rnd.uniform(110, 145)), int(rnd.uniform(85, 105)), 255)
        pts = [(x + math.sin(t / 30 + phase) * 4 + t * rnd.uniform(-0.02, 0.02), t) for t in range(0, int(length), 6)]
        draw.line(pts, fill=col, width=rnd.choice((1, 2, 2, 3)))
    return bleed(img)


def hull_panels(size, seed):
    """Station hull: off-white panels of slightly different tone, dark seams, rivet rows, grime collecting low"""
    rnd = np.random.default_rng(seed)
    arr = np.zeros((size, size, 3), np.float32)
    n = 4
    cell = size // n
    for i in range(n):
        for j in range(n):
            tone = rnd.uniform(0.86, 0.97)
            arr[j * cell:(j + 1) * cell, i * cell:(i + 1) * cell] = np.array((206, 208, 210), np.float32) * tone
    grime = ndimage.gaussian_filter(rnd.random((size, size)), 18)
    grime = (grime - grime.min()) / (grime.max() - grime.min())
    arr *= (0.88 + 0.14 * grime)[..., None]
    arr *= np.linspace(1.0, 0.9, size)[:, None, None]
    img = Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGB')
    draw = ImageDraw.Draw(img)
    for k in range(n + 1):
        draw.line([(k * cell, 0), (k * cell, size)], fill=(95, 98, 102), width=3)
        draw.line([(0, k * cell), (size, k * cell)], fill=(95, 98, 102), width=3)
        for t in range(6, size, 16):
            draw.ellipse([k * cell + 5, t, k * cell + 8, t + 3], fill=(140, 142, 146))
            draw.ellipse([t, k * cell + 5, t + 3, k * cell + 8], fill=(140, 142, 146))
    return img


def chainlink(size, cells=8):
    """Chain-link mesh: galvanised wire diamonds on transparent ground (one tile = 1 m at uv 1)"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    step = size / cells
    w = max(2, size // 128)
    for k in range(-cells, 2 * cells + 1):
        x = k * step
        draw.line([(x, 0), (x + size, size)], fill=(170, 172, 168, 255), width=w)
        draw.line([(x, size), (x + size, 0)], fill=(150, 152, 150, 255), width=w)
    return bleed(img)


def solar_cells(size, seed):
    """Photovoltaic panel: dark blue cells in a grid with silver busbars and frame"""
    rnd = np.random.default_rng(seed)
    img = Image.new('RGB', (size, size), (200, 200, 205))
    draw = ImageDraw.Draw(img)
    n = 6
    cell = size / n
    for i in range(n):
        for j in range(n):
            shade = rnd.uniform(0.85, 1.1)
            col = tuple(int(c * shade) for c in (24, 38, 82))
            draw.rectangle([i * cell + 3, j * cell + 3, (i + 1) * cell - 3, (j + 1) * cell - 3], fill=col)
            for b in (0.33, 0.66):
                x = i * cell + cell * b
                draw.line([(x, j * cell + 3), (x, (j + 1) * cell - 3)], fill=(150, 155, 165), width=1)
    return img


def hazard_stripes(size):
    """Yellow and black warning stripes"""
    img = Image.new('RGB', (size, size), (225, 180, 30))
    draw = ImageDraw.Draw(img)
    step = size / 4
    for k in range(-4, 9):
        x = k * step
        draw.polygon([(x, 0), (x + step / 2, 0), (x + step / 2 + size, size), (x + size, size)], fill=(25, 25, 22))
    return img


def gold_foil(size, seed):
    """Crumpled gold insulation foil (lander)"""
    rnd = np.random.default_rng(seed)
    n = ndimage.gaussian_filter(rnd.random((size, size)), 2) - ndimage.gaussian_filter(rnd.random((size, size)), 6)
    n = (n - n.min()) / (n.max() - n.min())
    base = np.array((205, 160, 60), np.float32)
    arr = base[None, None, :] * (0.55 + 0.8 * n[..., None])
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGB')


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

    def save(img, name):
        img.save(os.path.join(out, name))

    # Autumn crowns and other broadleaves
    save(branch_card(sprites['maple-red'] + sprites['maple-mixed'], 512, 70, 380, (70, 50, 36, 255), 11), 'leaves-maple-autumn.png')
    save(branch_card(sprites['maple-green'], 512, 66, 380, (70, 52, 36, 255), 12), 'leaves-maple.png')
    save(branch_card(sprites['oak-autumn'] + sprites['oak-rust'], 512, 60, 420, (70, 52, 36, 255), 13), 'leaves-oak-autumn.png')
    save(branch_card(sprites['birch-yellow'] + sprites['birch-pale'], 512, 46, 480, (90, 80, 70, 255), 14), 'leaves-birch-autumn.png')
    save(branch_card([tinted(s, (0.62, 0.7, 0.5)) for s in sprites['glossy']], 512, 58, 360, (55, 45, 34, 255), 15), 'leaves-swamp.png')
    save(branch_card(sprites['ivy'], 512, 70, 340, (60, 48, 34, 255), 16), 'leaves-ivy.png')
    save(branch_card([tinted(s, (0.85, 0.85, 0.6)) for s in sprites['narrow'] + sprites['birch-pale']], 512, 58, 520, (95, 80, 60, 255), 34), 'leaves-dry.png')
    save(strand_card(sprites['narrow'], 256, 1024, 70, 520, (80, 70, 50, 255), 17), 'leaves-willow.png')
    save(snowy(Image.open(os.path.join(out, 'leaves-conifer.png')), 18), 'leaves-conifer-snow.png')
    save(frond_card(512, 19), 'palm-frond.png')
    save(frond_card(512, 20, base_col=(80, 92, 40), dry=True), 'palm-frond-dry.png')
    # Grass from photo blades, per biome
    blades = {k: cut_leaves(*fetch_atlas(v, dl)) for k, v in BLADES.items()}
    green = blades['broad'] + blades['mixed'] + blades['thin']
    save(blade_card(green, 512, 256, 150, 21, tint=(0.85, 0.95, 0.8)), 'grass-green.png')
    save(blade_card(blades['seed'] + blades['wisp'] + blades['thin'], 512, 256, 150, 22, tint=(1.15, 1.0, 0.7)), 'grass-dry.png')
    save(blade_card(green + blades['seed'], 512, 256, 140, 23, tint=(1.25, 0.85, 0.5)), 'grass-autumn.png')
    save(blade_card(blades['thin'] + blades['wisp'], 512, 256, 110, 24, tint=(0.8, 0.85, 0.8), tips=(235, 240, 248)), 'grass-snow.png')
    save(blade_card(blades['long'] + blades['broad'], 512, 512, 90, 25, tint=(0.8, 0.9, 0.7), heads=True), 'reeds.png')
    save(blade_card(blades['seed'] + blades['thin'], 512, 256, 170, 26, tint=(1.35, 1.1, 0.6), ears=(205, 170, 90)), 'wheat.png')
    save(blade_card(blades['wisp'] + blades['seed'], 512, 256, 120, 27, tint=(0.7, 0.75, 0.55)), 'grass-swamp.png')
    save(grass_card(512, 256, 28, flowers=True, palette=[(200, 40, 35), (215, 50, 40), (240, 235, 230)]), 'flowers-red.png')
    save(grass_card(512, 256, 29, flowers=True, palette=[(90, 110, 210), (150, 120, 220), (245, 245, 240)]), 'flowers-blue.png')
    save(grass_card(512, 256, 30, flowers=True, palette=[(250, 210, 60), (245, 180, 40), (250, 235, 120)]), 'flowers-yellow.png')
    save(lily_pad(256, 31), 'lily-pad.png')
    save(blossom(128, 8, (245, 225, 235), (240, 200, 60), 32), 'lily-flower.png')
    cactus_skin(512, 33).save(os.path.join(out, 'cactus.jpg'), quality=90)
    # Effects and cloth
    save(flame(128, 256, 35), 'flame.png')
    save(water_sheet(256, 512, 36), 'waterfall.png')
    save(foam(256, 37), 'foam.png')
    save(cloth_banner(128, 384, (150, 28, 24), (215, 170, 60), 38), 'banner-red.png')
    save(cloth_banner(128, 384, (32, 58, 130), (220, 210, 190), 39), 'banner-blue.png')
    # Man-made surfaces for city, wasteland and stations
    save(chainlink(256), 'chainlink.png')
    save(moss_strands(256, 512, 42), 'moss-strands.png')
    solar_cells(512, 40).save(os.path.join(out, 'solar.jpg'), quality=90)
    hazard_stripes(256).save(os.path.join(out, 'hazard.jpg'), quality=90)
    gold_foil(512, 41).save(os.path.join(out, 'gold-foil.jpg'), quality=90)
    hull_panels(512, 43).save(os.path.join(out, 'hull-panels.jpg'), quality=90)
    print('foliage ok', file=sys.stderr)


main()
