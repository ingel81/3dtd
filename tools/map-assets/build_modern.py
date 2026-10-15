"""Modern buildings of the map asset catalogue for OSM worlds (loaded by build_models.py).

A German or European small town and city centre of today: rendered houses
with gable roofs (detached, semi-detached, terraced), garages, sheds and
carports. All share one family of materials: painted plaster in a few
tints, anthracite or red roof tiles, white window frames with grey sills,
concrete plinths, zinc gutters. Walls are built around real openings
(frame and pane set back in a reveal); gable windows sit on the wall.
Front towards -Y, width along X. Every model gets baked AO and a
flat-coloured copy for distance.
"""
import math
import random

import bmesh
from mathutils import Vector

from blender_kit import Part, box, clear_scene, export_lod, finish, flat_material, pbr_material, tube
from build_city import Face, glass
from build_structures import gable_roof

FOUNDATION = 1.0
PLINTH = 0.45
T = 0.3  # wall thickness

PLASTER = 'painted_plaster_wall'
WHITE = (1.25, 1.3, 1.33)
CREAM = (1.3, 1.27, 1.12)
SAND = (1.27, 1.18, 0.98)
PALE_GREY = (1.12, 1.16, 1.2)


def export(name, objects, lod=None):
    """Baked AO, then a flat-coloured copy with `lod` triangles for distance"""
    obj = finish(name, objects)
    if lod:
        export_lod(name, obj, ratio=min(1.0, lod / max(1, len(obj.data.polygons))))
    return obj


class Kit:
    """Material parts of a modern building; one part per tint of plaster"""

    def __init__(self, roof='anthracite', frame=(0.9, 0.9, 0.88)):
        self.plaster = {}
        self.plinth = Part(pbr_material('plinth-concrete', 'brushed_concrete', (0.62, 0.62, 0.62)), uv_metres=2.0, bevel=0.02)
        if roof == 'red':
            self.roof = Part(pbr_material('roof-red-tiles', 'clay_roof_tiles_03', (0.85, 0.82, 0.8)))
            self.ridge = Part(pbr_material('roof-red-ridge', 'clay_roof_tiles_03', (0.6, 0.55, 0.52)), uv_metres=1.0)
        else:
            self.roof = Part(pbr_material('roof-anthracite-tiles', 'grey_roof_tiles_02', (0.34, 0.36, 0.39)))
            self.ridge = Part(pbr_material('roof-anthracite-ridge', 'grey_roof_tiles_02', (0.3, 0.31, 0.33)), uv_metres=1.0)
        self.frames = Part(flat_material('frame-' + '-'.join('%.2f' % c for c in frame), frame, 0.45))
        self.glass = Part(glass())
        self.door = Part(flat_material('door-anthracite', (0.08, 0.085, 0.09), 0.5, 0.3))
        self.metal = Part(flat_material('zinc', (0.55, 0.57, 0.58), 0.4, 0.8), smooth=True)
        self.sill = Part(flat_material('sill-grey', (0.42, 0.43, 0.44), 0.5, 0.5))
        self.shutter = Part(flat_material('shutter-grey', (0.5, 0.51, 0.52), 0.6, 0.3))
        self.extra = []

    def walls(self, tint):
        if tint not in self.plaster:
            self.plaster[tint] = Part(pbr_material('plaster-' + '-'.join('%.2f' % c for c in tint), PLASTER, tint), uv_metres=3.0,
                                      bevel=0.0)
        return self.plaster[tint]

    def objects(self, name):
        parts = [(p, '-plaster%d' % k) for k, p in enumerate(self.plaster.values())]
        parts += [(self.plinth, '-plinth'), (self.roof, '-roof'), (self.ridge, '-ridge'), (self.frames, '-frames'),
                  (self.glass, '-glass'), (self.door, '-door'), (self.metal, '-metal'), (self.sill, '-sill'),
                  (self.shutter, '-shutter')]
        parts += [(p, '-extra%d' % k) for k, p in enumerate(self.extra)]
        return [p.to_object(name + suffix) for p, suffix in parts if p.bm.faces]


# ---------------------------------------------------------------- walls and openings

def punched_wall(part, face, u0, u1, z0, z1, openings, t=T):
    """One wall slab of `face` from u0 to u1 and z0 to z1 with rectangular openings (u, w, zb, zt): a grid
    cut at every opening edge, the closed cells as front and back faces, reveals where a closed cell meets an
    opening or the slab ends. One connected surface, so the AO bake sees no seams between pieces"""
    us = sorted({round(v, 4) for v in [u0, u1] + [u + s * w / 2 for u, w, _, _ in openings for s in (-1, 1)]})
    zs = sorted({round(v, 4) for v in [z0, z1] + [z for _, _, zb, zt in openings for z in (zb, zt)]})

    def closed(i, j):
        if i < 0 or j < 0 or i >= len(us) - 1 or j >= len(zs) - 1:
            return False
        cu, cz = (us[i] + us[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
        return not any(abs(cu - u) < w / 2 and zb < cz < zt for u, w, zb, zt in openings)

    bm = part.bm
    out = face.n * (face.depth / 2)
    verts = {}

    def v(i, j, back):
        key = (i, j, back)
        if key not in verts:
            verts[key] = bm.verts.new(out + face.u * us[i] + Vector((0, 0, zs[j])) - face.n * (t if back else 0.0))
        return verts[key]

    for i in range(len(us) - 1):
        for j in range(len(zs) - 1):
            if not closed(i, j):
                continue
            bm.faces.new((v(i, j, 0), v(i + 1, j, 0), v(i + 1, j + 1, 0), v(i, j + 1, 0)))
            bm.faces.new((v(i, j + 1, 1), v(i + 1, j + 1, 1), v(i + 1, j, 1), v(i, j, 1)))
            # Reveals and ends: a side face wherever the neighbour is open
            if not closed(i - 1, j):
                bm.faces.new((v(i, j, 1), v(i, j, 0), v(i, j + 1, 0), v(i, j + 1, 1)))
            if not closed(i + 1, j):
                bm.faces.new((v(i + 1, j, 0), v(i + 1, j, 1), v(i + 1, j + 1, 1), v(i + 1, j + 1, 0)))
            if not closed(i, j - 1):
                bm.faces.new((v(i, j, 0), v(i, j, 1), v(i + 1, j, 1), v(i + 1, j, 0)))
            if not closed(i, j + 1):
                bm.faces.new((v(i, j + 1, 1), v(i, j + 1, 0), v(i + 1, j + 1, 0), v(i + 1, j + 1, 1)))


def window(kit, face, u, zb, w, h, reveal=0.14, shutter=0.0, split=True):
    """Frame plate set back in the opening, a pane in front of it, a mullion on wide windows, a sill;
    `shutter` lowers a roller shutter over that share of the pane"""
    face.box(kit.frames, u, -reveal - 0.03, zb, w, 0.06, h)
    face.box(kit.glass, u, -reveal + 0.008, zb + 0.07, w - 0.14, 0.02, h - 0.14)
    if split and w > 1.0:
        face.box(kit.frames, u, -reveal + 0.022, zb + 0.05, 0.07, 0.03, h - 0.1)
    if shutter > 0:
        face.box(kit.shutter, u, -reveal + 0.05, zb + h * (1 - shutter), w - 0.02, 0.03, h * shutter)
    face.box(kit.sill, u, (0.06 - reveal) / 2, zb - 0.05, w + 0.08, reveal + 0.08, 0.05)


def door(kit, face, u, zb, w=1.1, h=2.15, reveal=0.16, side_light=True):
    """Front door: a dark leaf with a narrow glazed strip, set back"""
    face.box(kit.door, u, -reveal - 0.03, zb, w, 0.06, h)
    if side_light:
        face.box(kit.glass, u + w * 0.28, -reveal + 0.008, zb + 0.25, 0.14, 0.02, h - 0.5)
    face.box(kit.metal, u - w * 0.32, -reveal + 0.03, zb + 1.0, 0.04, 0.06, 0.25)


def applied_window(kit, face, u, zb, w, h):
    """A window standing on the wall (gable triangles): frame, pane and sill proud of the plaster"""
    face.box(kit.frames, u, 0.03, zb, w, 0.06, h)
    face.box(kit.glass, u, 0.065, zb + 0.07, w - 0.14, 0.02, h - 0.14)
    if w > 1.0:
        face.box(kit.frames, u, 0.08, zb + 0.05, 0.07, 0.02, h - 0.1)
    face.box(kit.sill, u, 0.08, zb - 0.05, w + 0.08, 0.16, 0.05)


def prism(part, poly, offset):
    """Closed solid from a flat convex polygon (Vectors) swept by `offset`"""
    bm = part.bm
    a = [bm.verts.new(p) for p in poly]
    b = [bm.verts.new(p + offset) for p in poly]
    faces = [bm.faces.new(a), bm.faces.new(list(reversed(b)))]
    n = len(poly)
    for i in range(n):
        faces.append(bm.faces.new((a[(i + 1) % n], a[i], b[i], b[(i + 1) % n])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def plank(part, a, b, width, height):
    """Board from a to b, `width` across (horizontal), `height` up"""
    d = (b - a).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    sw, uh = side * (width / 2), up * (height / 2)
    prism(part, [a - sw - uh, a + sw - uh, a + sw + uh, a - sw + uh], b - a)


def gabled_roof(kit, w, d, eave, pitch, over=0.45, verge=0.35, gutters=True, closed_ends=(True, True)):
    """Tiled roof over a w x d box (ridge along X): roof planes, verge boards, eave fascia, a ridge cap, zinc
    gutters with downpipes at the corners. `closed_ends` False: no verge overhang on that side (terraces)"""
    ox0 = verge if closed_ends[0] else 0.0
    ox1 = verge if closed_ends[1] else 0.0
    shift = (ox1 - ox0) / 2
    roof = Part(kit.roof.material)
    gable_roof(roof, w + ox0 + ox1, d, eave, pitch, over)
    kit.roof.add_bmesh(roof.bm, matrix=_shift_x(shift))
    roof.bm.free()
    low = eave - over * pitch / (d / 2)
    top = eave + pitch
    x0, x1 = -w / 2 - ox0, w / 2 + ox1
    for sy in (-1, 1):
        # Fascia along the eave, its top under the roof plane
        plank(kit.door, Vector((x0, sy * (d / 2 + over - 0.03), low - 0.14)), Vector((x1, sy * (d / 2 + over - 0.03), low - 0.14)), 0.05, 0.2)
        if gutters:
            y = sy * (d / 2 + over + 0.06)
            tube(kit.metal, [Vector((x0, y, low - 0.1)), Vector((x1, y, low - 0.1))], [0.07, 0.07], 6)
            for x in (x0 + 0.25, x1 - 0.25):
                if (x < 0 and closed_ends[0]) or (x > 0 and closed_ends[1]):
                    tube(kit.metal, [Vector((x, y, low - 0.1)), Vector((x, sy * (d / 2 + 0.06), low - 0.5)),
                                     Vector((x, sy * (d / 2 + 0.06), 0.1))], [0.045, 0.045, 0.045], 6)
    for x, closed in ((x0, closed_ends[0]), (x1, closed_ends[1])):
        if not closed:
            continue
        for sy in (-1, 1):
            a = Vector((x, sy * (d / 2 + over), low - 0.02))
            b = Vector((x, 0, top + 0.02))
            plank(kit.door, a, b, 0.05, 0.24)
    plank(kit.ridge, Vector((x0, 0, top + 0.02)), Vector((x1, 0, top + 0.02)), 0.34, 0.16)
    return low, top


def _shift_x(dx):
    from mathutils import Matrix
    return Matrix.Translation((dx, 0, 0))


def gable_wall(part, face, eave, pitch, depth, t=T, inset=0.03):
    """Triangle of a gable end between the eave line and the ridge, inside the wall line"""
    n = face.n
    u = face.u
    c = n * (face.depth / 2 - t)
    half = depth / 2
    poly = [c + u * -half + Vector((0, 0, eave)), c + u * half + Vector((0, 0, eave)),
            c + Vector((0, 0, eave + pitch - inset))]
    prism(part, poly, n * t)


def base(kit, w, d, z_top=PLINTH, cx=0.0, cy=0.0):
    """Concrete plinth, reaching FOUNDATION into the ground (shows as a base on slopes)"""
    box(kit.plinth, cx, cy, -FOUNDATION, w + 0.08, d + 0.08, FOUNDATION + z_top)


# ---------------------------------------------------------------- houses

FLOOR = 2.85


def house_front(kit, face, tint, u0, u1, floors, rnd, entry=True, patio=False, mirror=1):
    """Openings of one unit's long wall (front or garden side): a door and windows on the ground floor
    (patio: a wide glazed door), windows above"""
    width = u1 - u0
    bays = max(2, int(round(width / 2.8)))
    bw = width / bays
    ops = []
    fills = []
    for f in range(floors):
        zf = PLINTH + f * FLOOR
        for b in range(bays):
            u = u0 + (b + 0.5) * bw
            if f == 0 and entry and b == (bays - 1 if mirror > 0 else 0):
                ops.append((u, 1.1, zf, zf + 2.15))
                fills.append(('door', u, zf))
            elif f == 0 and patio and b == (0 if mirror > 0 else bays - 1):
                ops.append((u, 2.0, zf, zf + 2.2))
                fills.append(('win', u, zf, 2.0, 2.2, 0.0))
            elif f == 0 and entry and bays > 2 and b == bays - 2:
                # Small window next to the door (WC, hall)
                ops.append((u, 0.6, zf + 1.45, zf + 2.15))
                fills.append(('win', u, zf + 1.45, 0.6, 0.7, 0.0))
            else:
                ww = 1.26 if f == 0 else 1.13
                ops.append((u, ww, zf + 0.9, zf + 2.2))
                shut = rnd.choice((0.0, 0.0, 0.0, 0.35, 1.0)) if f > 0 else rnd.choice((0.0, 0.0, 0.3))
                fills.append(('win', u, zf + 0.9, ww, 1.3, shut))
    punched_wall(kit.walls(tint), face, u0, u1, PLINTH, PLINTH + floors * FLOOR + 0.25, ops)
    for fill in fills:
        if fill[0] == 'door':
            door(kit, face, fill[1], fill[2])
            # Canopy over the door
            face.box(kit.metal, fill[1], 0.6, fill[2] + 2.45, 1.8, 1.2, 0.08)
            face.box(kit.plinth, fill[1], 0.55, -0.1, 2.0, 1.1, 0.25)
        else:
            _, u, zb, ww, hh, shut = fill
            window(kit, face, u, zb, ww, hh, shutter=shut)


def side_wall(kit, face, tint, floors, eave, pitch, depth, windows=True):
    """Gable end: windows in each storey and an attic window in the triangle"""
    L = face.length
    u0, u1 = -L / 2 + T, L / 2 - T
    ops = []
    if windows:
        for f in range(floors):
            zf = PLINTH + f * FLOOR
            for u in ((-L * 0.2, L * 0.2) if L > 8 else (0.0,)):
                ops.append((u, 0.9, zf + 1.0, zf + 2.2))
    punched_wall(kit.walls(tint), face, u0, u1, PLINTH, eave, ops)
    for u, w, zb, zt in ops:
        window(kit, face, u, zb, w, zt - zb, split=False)
    gable_wall(kit.walls(tint), face, eave, pitch, depth)
    if windows:
        h = min(1.2, pitch * 0.4)
        applied_window(kit, face, 0.0, eave + pitch * 0.18, 0.9 if L < 8 else 1.2, h)


def gabled_house(name, units, d, floors=2, roof='anthracite', pitch_deg=36, solar=None, chimney=False, seed=0, row_ends=(True, True),
                 lod=500):
    """Rendered house with a gable roof, ridge along X, eaves to front and back. `units`: (width, tint) per
    dwelling from west to east (one: detached, two: semi-detached, more: a terrace). `row_ends`: False leaves
    that gable blank and flush (a terrace module that continues). `solar`: share of the south roof (front)
    under PV panels"""
    clear_scene()
    rnd = random.Random(seed)
    kit = Kit(roof)
    w = sum(u for u, _ in units)
    eave = PLINTH + floors * FLOOR + 0.25
    pitch = d / 2 * math.tan(math.radians(pitch_deg))
    base(kit, w, d)
    x = -w / 2
    for k, (uw, tint) in enumerate(units):
        mirror = 1 if k % 2 == 0 else -1
        for side in (0, 2):
            face = Face(side, w, d)
            # Face u runs left to right seen from outside: the back wall runs from east to west
            a, b = (x, x + uw) if side == 0 else (-(x + uw), -x)
            house_front(kit, face, tint, a, b, floors, rnd, entry=side == 0, patio=side == 2, mirror=mirror if side == 0 else -mirror)
        if len(units) > 1 and k > 0:
            # Fire wall between the dwellings rises a little out of the roof
            pass
        x += uw
    for side, end in ((3, 0), (1, 1)):
        face = Face(side, w, d)
        tint = units[0][1] if side == 3 else units[-1][1]
        side_wall(kit, face, tint, floors, eave, pitch, d, windows=row_ends[end])
    low, top = gabled_roof(kit, w, d, eave, pitch, closed_ends=row_ends)
    if solar:
        panels = Part(flat_material('pv-panel', (0.03, 0.05, 0.1), 0.15, 0.6))
        frame = kit.metal
        slope = math.atan2(pitch, d / 2)
        run = d / 2 * 0.72
        cols = max(1, int(w * solar / 1.05))
        x0 = -cols * 1.05 / 2
        for c in range(cols):
            for r in range(2):
                y0 = -d / 2 + 0.6 + r * run / 2
                z0 = eave + (y0 + d / 2) * math.tan(slope) + 0.06
                y1 = y0 + run / 2 - 0.05
                z1 = eave + (y1 + d / 2) * math.tan(slope) + 0.06
                xa, xb = x0 + c * 1.05 + 0.02, x0 + (c + 1) * 1.05 - 0.02
                prism(panels, [Vector((xa, y0, z0)), Vector((xb, y0, z0)), Vector((xb, y1, z1)), Vector((xa, y1, z1))],
                      Vector((0, -math.sin(slope), math.cos(slope))) * 0.04)
        kit.extra.append(panels)
    if chimney:
        cx, cy = w * 0.22, d * 0.18
        zc = eave + (d / 2 - cy) * pitch / (d / 2)
        box(kit.walls(units[0][1]), cx, cy, zc - 1.0, 0.6, 0.6, top - zc + 1.5)
        box(kit.plinth, cx, cy, top + 0.5, 0.72, 0.72, 0.1)
        tube(kit.metal, [Vector((cx, cy, top + 0.6)), Vector((cx, cy, top + 0.9))], [0.1, 0.1], 8, cap=True)
    export(name, kit.objects(name), lod=lod)


def models():
    return {
        'house-modern': lambda: gabled_house('house-modern', [(10.0, WHITE)], 8.6, solar=0.7, seed=1),
        'house-modern-red': lambda: gabled_house('house-modern-red', [(9.0, CREAM)], 8.2, roof='red', pitch_deg=40, chimney=True,
                                                 seed=2),
        'house-semi': lambda: gabled_house('house-semi', [(7.0, WHITE), (7.0, SAND)], 9.0, roof='red', pitch_deg=38, seed=3),
        'house-terrace': lambda: gabled_house('house-terrace', [(6.0, PALE_GREY)], 10.0, pitch_deg=35, seed=4,
                                              row_ends=(False, False), lod=350),
        'house-terrace-row': lambda: gabled_house('house-terrace-row', [(6.0, WHITE), (6.0, CREAM), (6.0, PALE_GREY), (6.0, SAND)], 10.0,
                                                  pitch_deg=35, seed=5, lod=900),
    }
