"""Bakes the ground materials of the custom maps from geometry (E214): a
patch of ground built in Blender, the size of one texture repeat, seen
straight from above. A tileable relief of soil, sand, peat or snow carries
what lies on it: grass blades in clumps, clover, flowers, leaves, needles,
twigs, roots, pebbles and stones. Every piece crossing the patch's edge is
repeated on the other side, so the texture tiles without a seam. Cycles
renders five passes of the scene through an orthographic camera: colour,
normal, height, ambient occlusion and roughness, which build_materials.py
(source `baked`) packs like the scans.

    blender --background --factory-startup --python tools/map-assets/bake_grounds.py -- <out-dir> [<id> ...]

Writes <out-dir>/<id>/{color,normal,height,ao,rough}.png at 1024 px. The
recipes are in ground_recipes.py: everything is hand-chosen, seeded, and
built the same way every time (CC0, no scans, no generators).
"""
import math
import os
import random
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ground_recipes import RECIPES  # noqa: E402

RES = 1024
GRID = 640


# ---------------------------------------------------------------- tileable noise

def stretched_noise(n, cells_x, cells_y, rng):
    """Value noise with its own cell count across (x) and down (y): long, thin shapes along x that still tile"""
    lat = rng.random((cells_y, cells_x))
    tx = np.arange(n) / n * cells_x
    ty = np.arange(n) / n * cells_y
    ix0 = np.floor(tx).astype(int) % cells_x
    iy0 = np.floor(ty).astype(int) % cells_y
    fx = tx - np.floor(tx)
    fy = ty - np.floor(ty)
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    a = lat[iy0][:, ix0] * (1 - fx)[None, :] + lat[iy0][:, (ix0 + 1) % cells_x] * fx[None, :]
    b = lat[(iy0 + 1) % cells_y][:, ix0] * (1 - fx)[None, :] + lat[(iy0 + 1) % cells_y][:, (ix0 + 1) % cells_x] * fx[None, :]
    return a * (1 - fy)[:, None] + b * fy[:, None]


def fbm(n, cells, octaves, rng, gain=0.5):
    """Fractal noise that tiles, from `cells` features across over `octaves` doublings, about 0..1 around 0.5.
    Filtered white noise (spectral synthesis), not a lattice: value noise left square cells in the colour"""
    white = rng.standard_normal((n, n))
    f = np.fft.fftfreq(n) * n
    r = np.hypot(f[None, :], f[:, None])
    lo, hi = cells * 0.7, cells * 2 ** octaves * 1.2
    band = np.clip((r - lo * 0.7) / (lo * 0.3 + 1e-6), 0, 1) * np.clip((hi * 1.3 - r) / (hi * 0.3), 0, 1)
    amp = band * (np.maximum(r, 1e-6) / cells) ** (math.log2(gain) - 1)
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * amp))
    return np.clip(0.5 + out / (out.std() + 1e-9) * 0.16, 0, 1)


def voronoi(n, cells, rng):
    """Distances to the nearest and second nearest of one jittered point per cell (tileable): F1, F2"""
    pts = rng.random((cells, cells, 2))
    t = (np.arange(n) + 0.5) / n * cells
    gx, gy = np.meshgrid(t, t)
    cx, cy = np.floor(gx).astype(int), np.floor(gy).astype(int)
    f1 = np.full((n, n), 9.0)
    f2 = np.full((n, n), 9.0)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            px = cx + dx
            py = cy + dy
            p = pts[py % cells, px % cells]
            d = np.hypot(px + p[..., 0] - gx, py + p[..., 1] - gy)
            f2 = np.where(d < f1, f1, np.minimum(f2, d))
            f1 = np.minimum(f1, d)
    return f1, f2


def sample(arr, x, y, size):
    """Bilinear sample of a tile image at metres (x, y), wrapping"""
    n = arr.shape[0]
    u = (x / size) * n - 0.5
    v = (y / size) * n - 0.5
    i, j = math.floor(u), math.floor(v)
    fu, fv = u - i, v - j
    a = arr[j % n, i % n] * (1 - fu) + arr[j % n, (i + 1) % n] * fu
    b = arr[(j + 1) % n, i % n] * (1 - fu) + arr[(j + 1) % n, (i + 1) % n] * fu
    return a * (1 - fv) + b * fv


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def pick(colours, rng):
    """A colour from [(rgb, weight), ...], jittered a little in brightness and hue"""
    total = sum(w for _, w in colours)
    r = rng.random() * total
    for c, w in colours:
        r -= w
        if r <= 0:
            break
    k = 1 + (rng.random() - 0.5) * 0.18
    h = (rng.random() - 0.5) * 0.06
    return (max(0, c[0] * k * (1 + h)), max(0, c[1] * k), max(0, c[2] * k * (1 - h)))


# ---------------------------------------------------------------- the patch

class Patch:
    """Vertices, faces and per-vertex colour and roughness of everything on the ground"""

    def __init__(self, size):
        self.size = size
        self.verts = []
        self.faces = []
        self.colours = []
        self.rough = []

    def add(self, verts, faces, colours, rough):
        """One piece; repeated across the patch's edges where it reaches over them"""
        xs = [v[0] for v in verts]
        ys = [v[1] for v in verts]
        s = self.size
        offsets_x = [0] + ([s] if min(xs) < 0 else []) + ([-s] if max(xs) > s else [])
        offsets_y = [0] + ([s] if min(ys) < 0 else []) + ([-s] if max(ys) > s else [])
        if not isinstance(colours, list):
            colours = [colours] * len(verts)
        for ox in offsets_x:
            for oy in offsets_y:
                base = len(self.verts)
                self.verts.extend((x + ox, y + oy, z) for x, y, z in verts)
                self.faces.extend(tuple(base + i for i in f) for f in faces)
                self.colours.extend(colours)
                self.rough.extend([rough] * len(verts))


def build_base(patch, base, rng):
    """The ground itself: relief and colour from tileable noise, optional cracks, ripples and damp patches.
    Returns the height image (metres) the pieces stand on"""
    s = patch.size
    n = GRID
    relief = (fbm(n, max(2, round(s * 0.8)), 4, rng) - 0.5) * base.get('relief', 0.03) * 2
    relief += (fbm(n, max(4, round(s * 6)), 3, rng) - 0.5) * base.get('grain', 0.006) * 2
    tone = fbm(n, max(2, round(s * 1.2)), 4, rng)
    fine = fbm(n, max(4, round(s * 9)), 2, rng)
    grain = rng.random((n, n))
    damp = np.zeros((n, n))
    if base.get('damp'):
        damp = np.clip((fbm(n, max(2, round(s * 0.7)), 3, rng) - 0.55) * 6, 0, 1) * base['damp']
        relief -= damp * 0.01
    if base.get('ripples'):
        r = base['ripples']
        x = np.arange(n) / n
        gx, gy = np.meshgrid(x, x)
        cycles = r['count']
        # Two sets of ripples a little apart in angle and length, each bent by a slow warp of a few wavelengths;
        # where one fades the other takes over, so no straight stripe runs through the tile
        waves = []
        for k, (turn, stretch) in enumerate(((0.0, 1.0), (0.35, 0.82))):
            angle = r.get('angle', 0.3) + turn
            # Whole cycles across the tile in both axes, so the ripples tile
            cx = round(cycles * stretch * math.cos(angle))
            cy = round(cycles * stretch * math.sin(angle))
            warp = (fbm(n, 2, 3, rng) - 0.5) * r.get('warp', 1.0) * 6
            phase = gx * cx + gy * cy + warp
            wave = np.sin(phase * 2 * math.pi)
            # A gentle windward and a steep lee side, crests that break off
            wave = np.sign(wave) * np.abs(wave) ** 0.7
            waves.append(wave)
        share = np.clip((fbm(n, 3, 3, rng) - 0.5) * 3 + 0.5, 0, 1)
        fade = np.clip(fbm(n, 4, 3, rng) * 1.6 - 0.2, 0.15, 1)
        relief += (waves[0] * share + waves[1] * (1 - share)) * r['amp'] * fade
    if base.get('sastrugi'):
        # Ridges the wind carved: long, sharp-crested, broken, along x
        g = base['sastrugi']
        ridge = np.zeros((n, n))
        for k in range(3):
            v = stretched_noise(n, max(1, round(s * g['along'] * 2 ** k)), max(2, round(s * g['across'] * 2 ** k)), rng)
            ridge += (1 - np.abs(v * 2 - 1)) ** 3 / 2 ** k
        # In fields: here the wind scoured, there it laid the snow smooth
        relief += (ridge / 1.75 - 0.3) * g['amp'] * np.clip(fbm(n, 2, 3, rng) * 2 - 0.4, 0.1, 1)
    if base.get('granules'):
        # Rubber or sand grains a few millimetres across, one per quad: a relief of its own at the grid's scale
        relief += (grain - 0.5) * base['granules'] * 2
    tiles = None
    if base.get('tiles'):
        # Square tiles in a grid of whole tiles across the patch, a sunk joint of grout round each, each tile its own tone
        tl = base['tiles']
        per = max(1, round(s / tl['size']))
        u = (np.arange(n) + 0.5) / n * per
        fu = np.minimum(u % 1, 1 - u % 1) * (s / per)
        joint = np.minimum(fu[None, :], fu[:, None])
        tiles = np.clip(1 - joint / tl.get('grout', 0.004), 0, 1)
        relief -= tiles * tl.get('depth', 0.002)
        iu = np.floor(u).astype(int)
        tone_rng = np.random.default_rng(int(rng.integers(1 << 30)))
        per_tile = tone_rng.random((per, per))
        tile_tone = per_tile[iu[:, None], iu[None, :]]
    cracks = np.zeros((n, n))
    if base.get('cracks'):
        c = base['cracks']
        f1, f2 = voronoi(n, max(2, round(s * c['per_m'])), rng)
        edge = f2 - f1
        cracks = np.clip(1 - edge / c.get('width', 0.06), 0, 1) ** 2
        # The plates curl up at their rims
        relief += (np.clip(edge, 0, 0.4) * c.get('curl', 0.02)) - cracks * c.get('depth', 0.02)
    lo, hi = base['colours']
    # The relief shows in the colour too: heavier, darker grains settle in the hollows, the tops dry paler
    hp = relief - (np.roll(relief, 3, 0) + np.roll(relief, -3, 0) + np.roll(relief, 3, 1) + np.roll(relief, -3, 1)) / 4
    hp = np.clip(hp / (hp.std() * 3 + 1e-6), -1, 1)
    t = np.clip(tone * 1.2 - 0.1 + (fine - 0.5) * 0.5 + hp * base.get('relief_tone', 0.25) + (grain - 0.5) * base.get('speckle', 0.12), 0, 1)
    col = np.array(lo)[None, None, :] * (1 - t[..., None]) + np.array(hi)[None, None, :] * t[..., None]
    col *= (1 - damp * 0.35)[..., None]
    if tiles is not None:
        tl = base['tiles']
        col *= (1 + (tile_tone - 0.5) * tl.get('vary', 0.08))[..., None]
        col = col * (1 - tiles[..., None]) + np.array(tl['grout_colour'])[None, None, :] * tiles[..., None]
    if base.get('flecks'):
        # Grains of other colours strewn through (the coloured granules of a rubber floor): one quad each
        pick_rng = np.random.default_rng(int(rng.integers(1 << 30)))
        roll = pick_rng.random((n, n))
        start = 0.0
        for colour, share in base['flecks']:
            hit = (roll >= start) & (roll < start + share)
            col[hit] = np.array(colour) * (0.85 + 0.3 * grain[hit])[..., None]
            start += share
    if base.get('crack_colour'):
        col = col * (1 - cracks[..., None]) + np.array(base['crack_colour'])[None, None, :] * cracks[..., None]
    rough = base.get('rough', 0.9) - damp * 0.45
    if tiles is not None:
        rough = rough + tiles * (base['tiles'].get('grout_rough', 0.9) - base.get('rough', 0.9))
    # Grid: n x n quads over the tile, the last row and column the first again (it tiles)
    xs = np.linspace(0, s, n + 1)
    verts = []
    colours = []
    roughs = []
    for j in range(n + 1):
        for i in range(n + 1):
            verts.append((xs[i], xs[j], float(relief[j % n, i % n])))
            colours.append(tuple(float(c) for c in col[j % n, i % n]))
            roughs.append(float(rough[j % n, i % n]) if isinstance(rough, np.ndarray) else rough)
    faces = []
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            faces.append((a, a + 1, a + n + 2, a + n + 1))
    start = len(patch.verts)
    patch.verts.extend(verts)
    patch.faces.extend(tuple(start + k for k in f) for f in faces)
    patch.colours.extend(colours)
    patch.rough.extend(roughs)
    return relief


def blade(p, ground, angle, tilt, length, width, colour, tip):
    """One grass blade: a tapered strip bending over as it rises"""
    verts, cols = [], []
    seg = 4
    dx, dy = math.cos(angle), math.sin(angle)
    sx, sy = -dy, dx
    x, y, z = p[0], p[1], ground
    for k in range(seg + 1):
        t = k / seg
        w = width * (1 - t) ** 0.8 * 0.5 + 0.0004
        bend = tilt * (0.4 + t)
        verts.append((x + sx * w, y + sy * w, z))
        verts.append((x - sx * w, y - sy * w, z))
        c = mix(colour, tip, t * t)
        cols += [c, c]
        step = length / seg
        x += dx * math.sin(bend) * step
        y += dy * math.sin(bend) * step
        z += math.cos(bend) * step
    faces = [(2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2) for k in range(seg)]
    return verts, faces, cols


def disc(centre, radius, angle, colour, stretch=1.0, cup=0.0, sides=8, lean=(0.0, 0.0), notch=0.0):
    """A small flat shape (leaf, petal, clover leaf) lying on the ground, a little cupped"""
    verts = [(centre[0], centre[1], centre[2] - cup * radius)]
    for k in range(sides):
        a = k / sides * math.tau
        r = radius * (1 - notch * max(0.0, math.cos(a)) ** 6)
        lx, ly = math.cos(a) * r * stretch, math.sin(a) * r
        x = centre[0] + lx * math.cos(angle) - ly * math.sin(angle)
        y = centre[1] + lx * math.sin(angle) + ly * math.cos(angle)
        verts.append((x, y, centre[2] + lean[0] * lx + lean[1] * ly))
    faces = [(0, 1 + k, 1 + (k + 1) % sides) for k in range(sides)]
    return verts, faces, colour


def stone(centre, size, flat, colour, rng, embed=0.4, detail=2):
    """A stone: a lumpy, flattened sphere sunk into the ground"""
    verts = []
    faces = []
    rings, sides = 4 + detail, 6 + 2 * detail
    seed = rng.random() * 100
    for i in range(rings + 1):
        th = math.pi * i / rings
        for k in range(sides):
            ph = math.tau * k / sides
            lump = 1 + 0.22 * math.sin(ph * 3 + seed) * math.sin(th * 2 + seed * 0.7) + 0.1 * math.sin(ph * 5 + seed * 1.3)
            r = size * lump
            verts.append((centre[0] + math.sin(th) * math.cos(ph) * r * 1.2, centre[1] + math.sin(th) * math.sin(ph) * r * 0.9,
                          centre[2] + math.cos(th) * r * flat - size * flat * embed))
    for i in range(rings):
        for k in range(sides):
            a = i * sides + k
            b = i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    cols = []
    for v in verts:
        shade = 0.85 + 0.3 * ((v[2] - centre[2]) / max(size * flat, 1e-4) * 0.5 + 0.5)
        cols.append(tuple(c * shade for c in colour))
    return verts, faces, cols


def twig(p, ground, angle, length, radius, colour, rng, branches=2):
    """A thin stick lying on the ground, a side shoot or two"""
    verts, faces, cols = [], [], []

    def tube(a, b, r0, r1):
        sides = 4
        d = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        ln = math.sqrt(sum(c * c for c in d)) or 1
        nx, ny = -d[1] / ln, d[0] / ln
        base = len(verts)
        for end, r in ((a, r0), (b, r1)):
            for k in range(sides):
                t = k / sides * math.tau
                verts.append((end[0] + nx * math.cos(t) * r, end[1] + ny * math.cos(t) * r, end[2] + math.sin(t) * r))
                cols.append(colour)
        for k in range(sides):
            faces.append((base + k, base + (k + 1) % sides, base + sides + (k + 1) % sides, base + sides + k))

    a = (p[0], p[1], ground + radius * 0.6)
    b = (p[0] + math.cos(angle) * length, p[1] + math.sin(angle) * length, ground + radius * 0.6)
    tube(a, b, radius, radius * 0.6)
    for _ in range(branches):
        t = rng.uniform(0.3, 0.8)
        o = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2])
        ang = angle + rng.choice((-1, 1)) * rng.uniform(0.4, 0.9)
        ln = length * rng.uniform(0.2, 0.4)
        tube(o, (o[0] + math.cos(ang) * ln, o[1] + math.sin(ang) * ln, o[2]), radius * 0.6, radius * 0.3)
    return verts, faces, cols


# ---------------------------------------------------------------- scatter layers

def scatter_points(patch, layer, rng, ground):
    """Positions for a layer: in clumps (`clumps`: count and radius) or evenly, thinned by a tileable mask"""
    s = patch.size
    count = int(layer['count'] * s * s)
    mask = None
    if layer.get('patchy'):
        mask = fbm(128, max(2, round(s * layer.get('patch_scale', 0.8))), 3, np.random.default_rng(rng.randrange(1 << 30)))
    pts = []
    if layer.get('clumps'):
        per, radius = layer['clumps']
        centres = int(count / per)
        for _ in range(centres):
            cx, cy = rng.random() * s, rng.random() * s
            for _ in range(per):
                a = rng.random() * math.tau
                r = radius * math.sqrt(rng.random())
                pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r, cx, cy))
    else:
        pts = [(rng.random() * s, rng.random() * s, None, None) for _ in range(count)]
    if mask is not None:
        lo = layer['patchy']
        pts = [p for p in pts if sample(mask, p[0] % s, p[1] % s, s) > lo + (rng.random() - 0.5) * 0.08]
    return pts


def add_layer(patch, layer, rng, ground):
    s = patch.size
    kind = layer['kind']
    # The pieces of one clump share a colour (one tussock fresher, the next one drier), each a little off it
    clump_colour = {}
    for x, y, cx, cy in scatter_points(patch, layer, rng, ground):
        g = sample(ground, x % s, y % s, s)
        if cx is not None:
            if (cx, cy) not in clump_colour:
                clump_colour[(cx, cy)] = pick(layer['colours'], rng)
            k = 1 + (rng.random() - 0.5) * 0.14
            colour = tuple(v * k for v in clump_colour[(cx, cy)])
        else:
            colour = pick(layer['colours'], rng)
        rough = layer.get('rough', 0.85)
        if kind == 'blades':
            # A clump's blades lean out from its middle
            if cx is not None and (x, y) != (cx, cy):
                angle = math.atan2(y - cy, x - cx) + rng.uniform(-0.6, 0.6)
            else:
                angle = rng.random() * math.tau
            tilt = rng.uniform(*layer['tilt'])
            length = rng.uniform(*layer['length'])
            width = rng.uniform(*layer['width'])
            tip = mix(colour, layer.get('tip', colour), 0.8)
            v, f, c = blade((x, y), g, angle, tilt, length, width, colour, tip)
            patch.add(v, f, c, rough)
        elif kind in ('leaves', 'petals'):
            size = rng.uniform(*layer['size'])
            lift = layer.get('lift', 0.004) + rng.random() * layer.get('pile', 0.01)
            v, f, c = disc((x, y, g + lift), size, rng.random() * math.tau, colour, layer.get('stretch', 1.6),
                           layer.get('cup', 0.15), 8, (rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3)), layer.get('notch', 0.0))
            patch.add(v, f, c, rough)
        elif kind == 'clover':
            size = rng.uniform(*layer['size'])
            z = g + rng.uniform(*layer['height'])
            for k in range(3):
                a = rng.random() * 0.4 + k * math.tau / 3
                c = (x + math.cos(a) * size * 0.9, y + math.sin(a) * size * 0.9, z)
                v, f, col = disc(c, size, a, colour, 1.0, -0.1, 7, (0, 0), 0.5)
                patch.add(v, f, col, rough)
        elif kind == 'flowers':
            size = rng.uniform(*layer['size'])
            z = g + rng.uniform(*layer['height'])
            petals = layer.get('petals', 5)
            for k in range(petals):
                a = k * math.tau / petals + rng.random() * 0.3
                c = (x + math.cos(a) * size * 0.7, y + math.sin(a) * size * 0.7, z)
                v, f, col = disc(c, size * 0.55, a, colour, 1.5, 0.0, 6)
                patch.add(v, f, col, 0.6)
            v, f, col = disc((x, y, z + 0.002), size * 0.35, 0, layer.get('centre', (0.7, 0.55, 0.05)), 1.0, 0.0, 6)
            patch.add(v, f, col, 0.6)
        elif kind == 'stones':
            size = rng.uniform(*layer['size'])
            v, f, c = stone((x, y, g), size, rng.uniform(*layer['flat']), colour, rng, layer.get('embed', 0.4))
            patch.add(v, f, c, rough)
        elif kind == 'twigs':
            v, f, c = twig((x, y), g, rng.random() * math.tau, rng.uniform(*layer['length']), rng.uniform(*layer['radius']), colour, rng,
                           layer.get('branches', 2))
            patch.add(v, f, c, rough)


# ---------------------------------------------------------------- rendering

def clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras):
        for item in list(block):
            block.remove(item)


def make_mesh(patch):
    mesh = bpy.data.meshes.new('ground')
    mesh.from_pydata(patch.verts, [], patch.faces)
    col = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    flat = np.array([c + (1.0,) for c in patch.colours], dtype=np.float32).ravel()
    col.data.foreach_set('color', flat)
    rough = mesh.attributes.new('Rough', 'FLOAT', 'POINT')
    rough.data.foreach_set('value', np.array(patch.rough, dtype=np.float32))
    for p in mesh.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new('ground', mesh)
    bpy.context.collection.objects.link(obj)
    zs = np.array([v[2] for v in patch.verts])
    return obj, float(zs.min()), float(zs.max())


def pass_material(kind, zmin, zmax, ao_distance):
    """The override material of one pass: the wanted quantity as emission"""
    m = bpy.data.materials.new('pass-' + kind)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    for node in list(nt.nodes):
        nt.nodes.remove(node)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emit = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    if kind == 'color':
        a = nt.nodes.new('ShaderNodeAttribute')
        a.attribute_name = 'Col'
        nt.links.new(a.outputs['Color'], emit.inputs['Color'])
    elif kind == 'rough':
        a = nt.nodes.new('ShaderNodeAttribute')
        a.attribute_name = 'Rough'
        nt.links.new(a.outputs['Fac'], emit.inputs['Color'])
    elif kind == 'height':
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(geo.outputs['Position'], sep.inputs[0])
        rng = nt.nodes.new('ShaderNodeMapRange')
        rng.inputs['From Min'].default_value = zmin
        rng.inputs['From Max'].default_value = zmax
        nt.links.new(sep.outputs['Z'], rng.inputs['Value'])
        nt.links.new(rng.outputs['Result'], emit.inputs['Color'])
    elif kind == 'normal':
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        # Faces turned away from the camera show their other side: flip their normal
        neg = nt.nodes.new('ShaderNodeVectorMath')
        neg.operation = 'SCALE'
        neg.inputs['Scale'].default_value = -1.0
        nt.links.new(geo.outputs['Normal'], neg.inputs[0])
        pick_n = nt.nodes.new('ShaderNodeMix')
        pick_n.data_type = 'VECTOR'
        nt.links.new(geo.outputs['Backfacing'], pick_n.inputs['Factor'])
        nt.links.new(geo.outputs['Normal'], pick_n.inputs[4])
        nt.links.new(neg.outputs['Vector'], pick_n.inputs[5])
        half = nt.nodes.new('ShaderNodeVectorMath')
        half.operation = 'MULTIPLY_ADD'
        half.inputs[1].default_value = (0.5, 0.5, 0.5)
        half.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(pick_n.outputs[1], half.inputs[0])
        nt.links.new(half.outputs['Vector'], emit.inputs['Color'])
    elif kind == 'ao':
        ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
        ao.samples = 16
        ao.inputs['Distance'].default_value = ao_distance
        nt.links.new(ao.outputs['AO'], emit.inputs['Color'])
    return m


def render(patch, out_dir, ao_distance):
    obj, zmin, zmax = make_mesh(patch)
    scene = bpy.context.scene
    try:
        scene.render.engine = 'CYCLES'
    except TypeError:
        pass
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 0
    scene.render.resolution_x = scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.cycles.filter_width = 1.2
    scene.world = scene.world or bpy.data.worlds.new('World')
    scene.world.use_nodes = True
    bg = next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0, 0, 0, 1)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = patch.size
    cam.data.clip_end = 100
    cam.location = (patch.size / 2, patch.size / 2, 20)
    cam.rotation_euler = (0, 0, 0)
    scene.camera = cam
    os.makedirs(out_dir, exist_ok=True)
    for kind in ('color', 'normal', 'height', 'ao', 'rough'):
        scene.view_layers[0].material_override = pass_material(kind, zmin, zmax, ao_distance)
        # Colour through the sRGB display transform; data passes raw (the view list does not enumerate headless,
        # so the names are set as they are)
        scene.view_settings.view_transform = 'Standard' if kind == 'color' else 'Raw'
        scene.view_settings.look = 'None'
        scene.view_settings.exposure = 0
        scene.view_settings.gamma = 1
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGB'
        scene.render.image_settings.color_depth = '16' if kind in ('height', 'normal') else '8'
        scene.render.filepath = os.path.join(out_dir, kind + '.png')
        bpy.ops.render.render(write_still=True)
    print('baked', os.path.basename(out_dir), len(patch.verts), 'verts', f'{zmax - zmin:.3f} m relief')


def bake(mid, recipe, out):
    clear()
    rng_np = np.random.default_rng(recipe.get('seed', 1))
    rng = random.Random(recipe.get('seed', 1))
    patch = Patch(recipe['size'])
    ground = build_base(patch, recipe['base'], rng_np)
    for layer in recipe.get('layers', []):
        add_layer(patch, layer, rng, ground)
    render(patch, os.path.join(out, mid), recipe.get('ao', 0.12))


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    out, only = argv[0], argv[1:]
    for mid, recipe in RECIPES.items():
        if not only or mid in only:
            bake(mid, recipe, out)


main()
