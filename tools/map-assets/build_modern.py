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

from blender_kit import (CITY_FACADES, Nodes, Part, bake_surface, box, card, card_material, clear_scene, export_lod, finish, flat_material, hexa,
                         net_material, pbr_material, tilt, tube)
from blender_kit import export as export_plain
from build_city import Face, glass, hole
from build_nature import broadleaf
from build_structures import gable_roof, pyramid_roof

FOUNDATION = 1.0
PLINTH = 0.45
T = 0.3  # wall thickness

PLASTER = 'painted_plaster_wall'
WHITE = (1.25, 1.3, 1.33)
CREAM = (1.3, 1.27, 1.12)
SAND = (1.27, 1.18, 0.98)
PALE_GREY = (1.12, 1.16, 1.2)


# Buildings weathered in their occlusion (blender_kit.bake_ao grime; catalogue `grime`)
GRIME = {
    'kiosk',
    'transformer-station',
    'school',
    'town-hall',
    'town-church',
    'station',
    'parking-garage',
    'office-mid',
    'office-high',
    'supermarket',
    'hall-flat',
    'industrial-hall',
    'block-row-4',
    'block-row-4-end-w',
    'block-row-4-end-e',
    'block-row-4-ends',
    'block-row-6',
    'block-row-6-end-w',
    'block-row-6-end-e',
    'block-row-6-ends',
    'block-corner-4',
    'block-corner-6',
    'garage',
    'garage-row',
    'garden-shed',
    'house-modern',
    'house-modern-red',
    'house-semi',
    'house-terrace',
    'house-terrace-end-w',
    'house-terrace-end-e',
    'house-terrace-ends',
    'house-terrace-row',
    'shop-small',
    'barn-modern',
    'outbuilding',
    'annex',
    'office-ribbon',
    'shop-office',
}


def export(name, objects, lod=None, facades=None):
    """Baked AO (weathering too for the buildings of GRIME), then a flat-coloured copy with `lod` triangles for distance,
    or with its facades drawn flat (`facades`, blender_kit.facade_lod)"""
    obj = finish(name, objects, grime=name in GRIME)
    if lod:
        export_lod(name, obj, ratio=min(1.0, lod / max(1, len(obj.data.polygons))), facades=facades)
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
    out = face.n * (face.depth / 2) + getattr(face, 'off', Vector((0, 0, 0)))
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


# ---------------------------------------------------------------- garages, sheds, carports, canopies

def flat_top(kit, w, d, z, fall=0.12, edge=0.22):
    """Flat roof: a bitumen membrane falling to the back, a zinc edge trim around it"""
    felt = Part(pbr_material('roof-bitumen', 'bitumen', (0.8, 0.8, 0.8)), uv_metres=3.0, bevel=0.0)
    hw, hd = w / 2, d / 2
    prism(felt, [Vector((-hw, -hd, z + fall)), Vector((hw, -hd, z + fall)), Vector((hw, hd, z)), Vector((-hw, hd, z))],
          Vector((0, 0, -0.08)))
    for sy in (-1, 1):
        box(kit.metal, 0, sy * (hd + 0.02), z - 0.08 + (fall if sy < 0 else 0), w + 0.08, 0.04, edge)
    for sx in (-1, 1):
        plank(kit.metal, Vector((sx * (hw + 0.02), -hd, z - 0.08 + fall + edge / 2)), Vector((sx * (hw + 0.02), hd, z - 0.08 + edge / 2)),
              0.04, edge)
    kit.extra.append(felt)


def garage_door(kit, face, u, zb, w, h, part, ribs=4):
    """Up-and-over door set back in its opening, with pressed ribs and a handle"""
    face.box(part, u, -0.1, zb, w, 0.05, h)
    for k in range(1, ribs + 1):
        face.box(part, u, -0.07, zb + k * h / (ribs + 1), w - 0.1, 0.02, 0.05)
    face.box(kit.metal, u, -0.06, zb + h * 0.42, 0.18, 0.03, 0.06)


def garages(name, count=1, w=3.0, d=6.0, h=2.6, tint=PALE_GREY, seed=0):
    """Prefab concrete garages side by side (front -Y): rendered walls, an up-and-over door each, a flat roof
    falling to the back with a zinc edge, the joints between the boxes as pilasters"""
    clear_scene()
    rnd = random.Random(seed)
    kit = Kit()
    doors = [Part(flat_material('garage-door-' + c, rgb, 0.45, 0.3)) for c, rgb in
             (('white', (0.78, 0.78, 0.76)), ('anthracite', (0.12, 0.125, 0.13)), ('brown', (0.24, 0.15, 0.09)))]
    W = count * w
    z0, t = 0.1, 0.12
    box(kit.plinth, 0, 0, -FOUNDATION, W + 0.06, d + 0.06, FOUNDATION + z0)
    front = Face(0, W, d)
    ops = [(-W / 2 + (k + 0.5) * w, w - 0.6, z0, z0 + 2.0) for k in range(count)]
    punched_wall(kit.walls(tint), front, -W / 2, W / 2, z0, h, ops, t=t)
    for u, ow, zb, zt in ops:
        garage_door(kit, front, u, zb, ow, zt - zb, doors[rnd.randrange(3)] if count > 1 else doors[0])
    for k in (1, 2, 3):
        face = Face(k, W, d)
        inset = t if k % 2 else 0.0
        punched_wall(kit.walls(tint), face, -face.length / 2 + inset, face.length / 2 - inset, z0, h, [], t=t)
    for k in range(1, count):
        front.box(kit.walls(tint), -W / 2 + k * w, 0.02, z0, 0.16, 0.04, h - z0)
    flat_top(kit, W + 0.1, d + 0.1, h, fall=0.1, edge=0.2)
    kit.extra += [p for p in doors if p.bm.faces]
    export(name, kit.objects(name), lod=60 * count + 40)


def shed(name, w=2.6, d=2.2, wall_h=2.1):
    """Wooden garden house: plank walls on a low base, a felt gable roof, a door in the gable end facing
    front (-Y) and a small window at the side"""
    clear_scene()
    kit = Kit()
    planks = Part(pbr_material('planks-shed', 'wood_planks_grey', (1.15, 1.02, 0.84)), uv_metres=1.6, bevel=0.0)
    trim = Part(pbr_material('planks-shed-trim', 'brown_planks_04', (0.7, 0.6, 0.5)), uv_metres=1.0)
    felt = Part(pbr_material('roof-felt', 'bitumen', (0.55, 0.57, 0.6)))
    # Built with the ridge along X and the door on the east gable, then turned so the door faces -Y
    box(kit.plinth, 0, 0, -0.4, w + 0.1, d + 0.1, 0.5)
    for k in (0, 2):
        f = Face(k, w, d)
        ops = [(0.4, 0.6, 0.95, 1.55)] if k == 0 else []
        punched_wall(planks, f, -w / 2, w / 2, 0.1, wall_h, ops, t=0.08)
        for u, ow, zb, zt in ops:
            window(kit, f, u, zb, ow, zt - zb, reveal=0.04, split=False)
    pitch = d / 2 * math.tan(math.radians(35))
    for k in (1, 3):
        f = Face(k, w, d)
        ops = [(0.0, 0.9, 0.1, 1.95)] if k == 1 else []
        punched_wall(planks, f, -d / 2 + 0.08, d / 2 - 0.08, 0.1, wall_h, ops, t=0.08)
        gable_wall(planks, f, wall_h, pitch, d, t=0.08)
        if ops:
            f.box(trim, 0.0, -0.05, 0.1, 0.9, 0.04, 1.85)
            for zz in (0.4, 1.6):
                f.box(trim, 0.0, -0.02, zz, 0.8, 0.03, 0.1)
            f.box(kit.metal, -0.3, -0.01, 1.0, 0.05, 0.05, 0.15)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(trim, sx * (w / 2 - 0.02), sy * (d / 2 - 0.02), 0.1, 0.1, 0.1, wall_h - 0.1)
    gable_roof(felt, w, d, wall_h, pitch, 0.25)
    for sx in (-1, 1):
        for sy in (-1, 1):
            plank(trim, Vector((sx * (w / 2 + 0.27), sy * (d / 2 + 0.25), wall_h - 0.25 * pitch / (d / 2) - 0.02)),
                  Vector((sx * (w / 2 + 0.27), 0, wall_h + pitch)), 0.03, 0.14)
    objects = [planks.to_object(name), trim.to_object(name + '-trim'), felt.to_object(name + '-roof')] + kit.objects(name)
    tilt(objects, z=-90)
    export(name, objects, lod=120)


def carport(name, w=3.2, d=5.6, h=2.4, bays=1):
    """Steel carport: posts on footings, a deep fascia on all sides and a trapezoidal sheet roof falling to the back"""
    clear_scene()
    kit = Kit()
    steel = Part(flat_material('steel-anthracite', (0.1, 0.105, 0.11), 0.45, 0.6))
    W = w * bays
    for k in range(bays + 1):
        x = -W / 2 + 0.08 + k * (W - 0.16) / bays
        for y in (-d / 2 + 0.3, d / 2 - 0.3):
            box(steel, x, y, -0.4, 0.12, 0.12, h + 0.4)
            box(kit.plinth, x, y, -0.4, 0.3, 0.3, 0.45)
    box(steel, 0, -d / 2 + 0.06, h, W + 0.1, 0.12, 0.3)
    box(steel, 0, d / 2 - 0.06, h - 0.1, W + 0.1, 0.12, 0.3)
    for sx in (-1, 1):
        plank(steel, Vector((sx * W / 2, -d / 2, h + 0.15)), Vector((sx * W / 2, d / 2, h + 0.05)), 0.12, 0.3)
    roof = Part(pbr_material('roof-trapezoid', 'corrugated_iron_02', (0.75, 0.76, 0.78)), uv_metres=2.0, bevel=0.0)
    prism(roof, [Vector((-W / 2, -d / 2, h + 0.22)), Vector((W / 2, -d / 2, h + 0.22)), Vector((W / 2, d / 2, h + 0.12)),
                 Vector((-W / 2, d / 2, h + 0.12))], Vector((0, 0, 0.04)))
    kit.extra += [steel, roof]
    export(name, kit.objects(name), lod=80 * bays)


def station_canopy(name, w=22.0, d=13.0, h=5.0):
    """Petrol station roof: a slab with a deep white fascia and a red band on four columns, lights under it,
    two pump islands with two pumps each (no brand)"""
    clear_scene()
    kit = Kit()
    white = Part(flat_material('fascia-white', (0.82, 0.83, 0.84), 0.35, 0.1))
    band = Part(flat_material('fascia-red', (0.55, 0.05, 0.04), 0.4, 0.1))
    steel = Part(flat_material('column-grey', (0.5, 0.52, 0.54), 0.4, 0.6), smooth=True)
    lamp = Part(flat_material('canopy-light', (0.95, 0.95, 0.9), 0.3, emission=(1.0, 0.98, 0.92), strength=1.6))
    pump = Part(flat_material('pump-body', (0.75, 0.76, 0.77), 0.4, 0.3))
    dark = Part(flat_material('pump-dark', (0.05, 0.05, 0.06), 0.4, 0.2))
    slab = 1.1
    box(white, 0, 0, h, w, d, slab)
    box(band, 0, 0, h + slab * 0.55, w + 0.04, d + 0.04, 0.22)
    box(kit.plinth, 0, 0, h + slab - 0.02, w - 0.4, d - 0.4, 0.04)
    for x in (-w / 4, w / 4):
        for y in (-d / 4 + 0.6, d / 4 - 0.6):
            tube(steel, [Vector((x, y, -0.3)), Vector((x, y, h))], [0.25, 0.25], 12)
        # Pump island: a kerbed concrete strip with two pumps
        box(kit.plinth, x, 0, -0.3, 1.4, d * 0.62, 0.45)
        for y in (-d * 0.16, d * 0.16):
            box(pump, x, y, 0.15, 0.7, 1.1, 1.9)
            box(dark, x, y, 1.25, 0.72, 0.8, 0.45)
            box(band, x, y, 1.85, 0.74, 1.12, 0.2)
            for s in (-1, 1):
                tube(dark, [Vector((x + s * 0.36, y + 0.3, 1.1)), Vector((x + s * 0.5, y + 0.3, 0.7)),
                            Vector((x + s * 0.4, y + 0.3, 0.35))], [0.025, 0.025, 0.025], 5)
    for i in range(4):
        for j in range(3):
            box(lamp, -w * 0.375 + i * w * 0.25, -d / 3 + j * d / 3, h - 0.03, 1.4, 0.6, 0.04)
    kit.extra += [white, band, steel, lamp, pump, dark]
    export(name, kit.objects(name), lod=400)


# ---------------------------------------------------------------- city centre: perimeter blocks, offices

OCHRE = (1.28, 1.15, 0.88)
ROSE = (1.3, 1.15, 1.08)
SAGE = (1.1, 1.2, 1.08)
STONE = (0.95, 0.94, 0.92)


def shop_floor(kit, face, u0, u1, z0, h, door_every=3):
    """Ground floor of a city house: shop windows in a stone-grey wall, a door every few bays, a fascia band
    over them"""
    width = u1 - u0
    bays = max(2, int(round(width / 3.0)))
    bw = width / bays
    ops = []
    for b in range(bays):
        u = u0 + (b + 0.5) * bw
        if b % door_every == door_every // 2:
            ops.append((u, 1.3, z0, z0 + 2.5))
        else:
            ops.append((u, bw - 0.7, z0 + 0.45, z0 + 3.0))
    punched_wall(kit.walls(STONE), face, u0, u1, z0, z0 + h, ops)
    for u, w, zb, zt in ops:
        if zb == z0:
            door(kit, face, u, zb, w, zt - zb, side_light=False)
        else:
            window(kit, face, u, zb, w, zt - zb, reveal=0.1)
    face.box(kit.sill, (u0 + u1) / 2, 0.06, z0 + h - 0.55, width, 0.12, 0.4)


def upper_floors(kit, face, tint, u0, u1, z0, floors, fh, rnd, surround=True, balcony=False):
    """Upper storeys: a window per bay and storey with a sill (a lintel on old fronts), roller shutters here
    and there; `balcony`: French doors with slabs and glass railings on every other bay (courtyard side)"""
    width = u1 - u0
    bays = max(2, int(round(width / 2.9)))
    bw = width / bays
    ops = []
    for f in range(floors):
        zf = z0 + f * fh
        for b in range(bays):
            u = u0 + (b + 0.5) * bw
            if balcony and b % 2 == 1:
                ops.append((u, 1.0, zf + 0.05, zf + 2.3))
            else:
                ops.append((u, 1.25, zf + 0.85, zf + 2.45))
    punched_wall(kit.walls(tint), face, u0, u1, z0, z0 + floors * fh, ops)
    for u, w, zb, zt in ops:
        window(kit, face, u, zb, w, zt - zb, shutter=rnd.choice((0.0, 0.0, 0.0, 0.0, 0.4, 1.0)), split=w > 1.1)
        if surround and not balcony:
            face.box(kit.sill, u, 0.03, zt, w + 0.3, 0.06, 0.16)
        if balcony and w < 1.1:
            face.box(kit.plinth, u, 0.7, zb - 0.2, 2.2, 1.4, 0.18)
            face.box(kit.frames, u, 1.36, zb + 0.95, 2.2, 0.06, 0.06)
            for k in range(6):
                face.box(kit.frames, u - 1.0 + k * 0.4, 1.36, zb - 0.02, 0.04, 0.04, 0.98)
            for s in (-1, 1):
                face.box(kit.frames, u + s * 1.08, 0.7, zb + 0.95, 0.05, 1.35, 0.06)
    for f in range(1, floors):
        # String course between the storeys
        face.box(kit.walls(tint), (u0 + u1) / 2, 0.04, z0 + f * fh - 0.05, width, 0.08, 0.12)


def dormer(kit, tint, x, eave, d, pitch, y_off=1.2, w=1.6, h=1.5):
    """Shed dormer on the front slope (-Y): plastered body, a window, a zinc top falling to the front"""
    slope = pitch / (d / 2)
    yf = -d / 2 + y_off
    zf = eave + y_off * slope
    run = h / slope + 0.3
    box(kit.walls(tint), x, yf + run / 2, zf - 0.6, w, run, h + 0.6)
    box(kit.frames, x, yf - 0.03, zf + 0.15, w - 0.5, 0.06, h - 0.45)
    box(kit.glass, x, yf - 0.065, zf + 0.22, w - 0.64, 0.02, h - 0.59)
    prism(kit.metal, [Vector((x - w / 2 - 0.1, yf - 0.15, zf + h + 0.02)), Vector((x + w / 2 + 0.1, yf - 0.15, zf + h + 0.02)),
                      Vector((x + w / 2 + 0.1, yf + run, zf + h + 0.18)), Vector((x - w / 2 - 0.1, yf + run, zf + h + 0.18))],
          Vector((0, 0, 0.06)))


def city_house(name, w, d, floors, tint, roof='gable', street=(0,), blank=(1, 3), seed=0, fh=3.1, ground=4.2, lod=900):
    """Perimeter-block house of a city centre: shops on the ground floor of the street fronts, storeys of
    windows above, a courtyard side with balconies, blank party walls where the next house abuts.
    `street`: faces on the street (0 front -Y, 3 west for a corner house); `roof`: gable (dormers on the
    front slope), hip (corner houses) or flat (a set-back top storey, modern blocks)"""
    clear_scene()
    rnd = random.Random(seed)
    kit = Kit('red' if roof in ('gable', 'hip') else 'anthracite')
    eave = PLINTH + ground + (floors - 1) * fh + 0.4
    base(kit, w, d)
    for k in range(4):
        face = Face(k, w, d)
        L = face.length
        u0, u1 = (-L / 2, L / 2) if k % 2 == 0 else (-L / 2 + T, L / 2 - T)
        if k in blank:
            punched_wall(kit.walls(tint), face, u0, u1, PLINTH, eave, [])
            continue
        if k in street:
            shop_floor(kit, face, u0, u1, PLINTH, ground)
            upper_floors(kit, face, tint, u0, u1, PLINTH + ground, floors - 1, fh, rnd, surround=roof != 'flat')
        elif k in (1, 3):
            # The end of a row where no house abuts: windows on every storey, no balconies
            bays = max(1, int(round((u1 - u0) / 3.2)))
            ops = [(u0 + (b + 0.5) * (u1 - u0) / bays, 1.2, PLINTH + 1.0, PLINTH + 2.6) for b in range(bays)]
            punched_wall(kit.walls(tint), face, u0, u1, PLINTH, PLINTH + ground, ops)
            for u, ow, zb, zt in ops:
                window(kit, face, u, zb, ow, zt - zb)
            upper_floors(kit, face, tint, u0, u1, PLINTH + ground, floors - 1, fh, rnd, surround=roof != 'flat')
        else:
            ud = u0 + (u1 - u0) * 0.3
            punched_wall(kit.walls(tint), face, u0, u1, PLINTH, PLINTH + ground, [(ud, 1.2, PLINTH, PLINTH + 2.3)])
            door(kit, face, ud, PLINTH, 1.2, 2.3)
            upper_floors(kit, face, tint, u0, u1, PLINTH + ground, floors - 1, fh, rnd, surround=False, balcony=True)
        punched_wall(kit.walls(tint), face, u0, u1, PLINTH + ground + (floors - 1) * fh, eave, [])
    if roof == 'gable':
        pitch = d / 2 * math.tan(math.radians(42))
        for k in (1, 3):
            gable_wall(kit.walls(tint), Face(k, w, d), eave, pitch, d)
        # Cornice under the eaves of the street front
        box(kit.sill, 0, -d / 2 - 0.12, eave - 0.35, w, 0.3, 0.3)
        gabled_roof(kit, w, d, eave, pitch, over=0.35, closed_ends=(3 not in blank, 1 not in blank))
        bays = max(2, int(round(w / 2.9)))
        for b in range(1, bays, 2):
            dormer(kit, tint, -w / 2 + (b + 0.5) * w / bays, eave, d, pitch)
    elif roof == 'hip':
        h = min(w, d) / 2 * math.tan(math.radians(38))
        for k in range(4):
            face = Face(k, w, d)
            face.box(kit.sill, 0, 0.12, eave - 0.35, face.length + 0.24, 0.3, 0.3)
        hip = Part(kit.roof.material)
        pyramid_roof(hip, w, d, eave, h, overhang=0.35)
        kit.roof.add_bmesh(hip.bm)
        hip.bm.free()
        for sx in (-1, 1):
            for sy in (-1, 1):
                plank(kit.ridge, Vector((sx * (w / 2 + 0.35), sy * (d / 2 + 0.35), eave + 0.02)), Vector((0, 0, eave + h + 0.02)), 0.25, 0.12)
    else:
        # Parapet with a zinc coping, a set-back top storey under a thin roof slab
        for k in range(4):
            face = Face(k, w, d)
            face.box(kit.walls(tint), 0, -0.15, eave, face.length, 0.3, 0.6)
            face.box(kit.metal, 0, 0.0, eave + 0.6, face.length + 0.04, 0.36, 0.05)
        flat = Part(pbr_material('roof-bitumen', 'bitumen', (0.8, 0.8, 0.8)), uv_metres=3.0, bevel=0.0)
        box(flat, 0, 0, eave - 0.05, w - 0.5, d - 0.5, 0.1)
        kit.extra.append(flat)
        aw, ad = w - 1.2, d - 4.0
        for k in range(4):
            face = Face(k, aw, ad)
            L = face.length
            u0, u1 = (-L / 2, L / 2) if k % 2 == 0 else (-L / 2 + T, L / 2 - T)
            bays = max(1, int(L // 3.2))
            ops = [(u0 + (b + 0.5) * (u1 - u0) / bays, 1.8, eave + 0.05, eave + 2.45) for b in range(bays)] if k in (0, 2) else []
            punched_wall(kit.walls(WHITE), face, u0, u1, eave + 0.05, eave + 2.85, ops)
            for u, ow, zb, zt in ops:
                window(kit, face, u, zb, ow, zt - zb, reveal=0.1)
        box(kit.metal, 0, 0, eave + 2.85, aw + 0.6, ad + 0.6, 0.25)
        box(flat, 0, 0, eave + 3.1, aw, ad, 0.05)
    export(name, kit.objects(name), lod=lod, facades=CITY_FACADES)


def roof_plant(kit, w, d, z, rnd, units=3):
    """Plant on a flat roof: a stair house, air handling boxes, vent pipes"""
    box(kit.walls(PALE_GREY), -w * 0.28, d * 0.12, z, 3.0, 2.4, 2.6)
    box(kit.metal, -w * 0.28, d * 0.12, z + 2.6, 3.2, 2.6, 0.12)
    for k in range(units):
        x, y = rnd.uniform(-w / 2 + 2, w / 2 - 2), rnd.uniform(-d / 2 + 1.5, d / 2 - 1.5)
        box(kit.metal, x, y, z, 2.2, 1.2, 1.3)
        tube(kit.door, [Vector((x, y, z + 1.3)), Vector((x, y, z + 1.36))], [0.4, 0.4], 10, cap=True)
    for k in range(units + 1):
        x, y = rnd.uniform(-w / 2 + 1, w / 2 - 1), rnd.uniform(-d / 2 + 1, d / 2 - 1)
        tube(kit.metal, [Vector((x, y, z)), Vector((x, y, z + 1.0))], [0.12, 0.12], 8, cap=True)


def office(name, w, d, floors, band_asset=None, band_tint=(1.0, 1.0, 1.0), fh=3.5, ground=4.5, fin=1.5, seed=0, lod=900):
    """Office building with ribbon windows: solid spandrel bands between the storeys, a glass ribbon set
    back behind them, vertical aluminium fins over the full height, a glazed lobby with a canopy, roof
    plant behind a parapet"""
    clear_scene()
    rnd = random.Random(seed)
    kit = Kit(frame=(0.16, 0.17, 0.18))
    if band_asset:
        bands = Part(pbr_material('band-' + band_asset, band_asset, band_tint), uv_metres=3.0, bevel=0.0)
        kit.extra.append(bands)
    else:
        bands = kit.walls(WHITE)
    top = PLINTH + ground + (floors - 1) * fh
    base(kit, w, d)
    # Glass core behind the bands, the lobby glazing on the ground floor
    box(kit.glass, 0, 0, PLINTH, w - 0.5, d - 0.5, top - PLINTH)
    for k in range(4):
        face = Face(k, w, d)
        L = face.length
        face.box(kit.plinth, 0, -0.1, PLINTH + ground - 0.6, L, 0.2, 0.6)
        for f in range(1, floors):
            z = PLINTH + ground + (f - 1) * fh
            face.box(bands, 0, -0.15, z + fh - 1.05, L, 0.3, 1.05)
        face.box(bands, 0, -0.15, top, L, 0.3, 1.2)
        n = max(2, int(L / fin))
        for i in range(n + 1):
            u = -L / 2 + i * L / n
            face.box(kit.frames, u, 0.05, PLINTH + ground - 0.6, 0.1, 0.3, top - PLINTH - ground + 0.6)
            face.box(kit.frames, u, -0.2, PLINTH, 0.08, 0.1, ground - 0.6)
        face.box(kit.frames, 0, -0.2, PLINTH + 2.6, L, 0.1, 0.08)
    front = Face(0, w, d)
    front.box(kit.door, 0, -0.22, PLINTH, 3.2, 0.06, 2.6)
    front.box(kit.metal, 0, 1.6, PLINTH + 3.4, 7.0, 3.6, 0.25)
    for s in (-1, 1):
        front.box(kit.frames, s * 3.2, 3.0, 0.0, 0.18, 0.18, PLINTH + 3.4)
    flat = Part(pbr_material('roof-bitumen', 'bitumen', (0.8, 0.8, 0.8)), uv_metres=3.0, bevel=0.0)
    box(flat, 0, 0, top + 0.9, w - 0.6, d - 0.6, 0.05)
    kit.extra.append(flat)
    for k in range(4):
        face = Face(k, w, d)
        face.box(kit.metal, 0, -0.1, top + 1.2, face.length + 0.04, 0.34, 0.05)
    roof_plant(kit, w * 0.8, d * 0.7, top + 0.95, rnd)
    export(name, kit.objects(name), lod=lod)


class Moved:
    """A Face whose boxes and walls land shifted by `off` (annexes beside the main body)"""

    def __init__(self, face, off):
        self.face, self.off = face, off
        self.u, self.n, self.length, self.depth = face.u, face.n, face.length, face.depth

    def box(self, part, u, n, z, su, sn, sz):
        c = self.u * u + self.n * (self.depth / 2 + n) + self.off
        box(part, c.x, c.y, z, su, sn, sz, self.face.angle)


def hall(name, w, d, h, wall_asset, wall_tint=(1.0, 1.0, 1.0), roof='flat', shop=False, doors=2, annex=False, lod=300):
    """Big shed of panels on a concrete base: `shop` gives a supermarket front (a glazed entrance with a
    canopy, a fascia stripe, a trolley shelter); otherwise roller doors on the front. `roof`: flat behind a
    parapet with roof lights, or a shallow gable (industrial). `annex`: a two-storey office block at the west
    end. A band of high windows on the long sides, a loading door at the back"""
    clear_scene()
    kit = Kit(frame=(0.2, 0.21, 0.22))
    panels = Part(pbr_material('panel-' + wall_asset + '-' + '-'.join('%.2f' % c for c in wall_tint), wall_asset, wall_tint),
                  uv_metres=4.0, bevel=0.0)
    shutter = Part(pbr_material('door-shutter', 'painted_metal_shutter', (1.2, 1.2, 1.2)), uv_metres=3.0, bevel=0.0)
    kit.extra += [panels, shutter]
    sock = 1.2
    box(kit.plinth, 0, 0, -FOUNDATION, w + 0.1, d + 0.1, FOUNDATION + sock)
    for k in range(4):
        face = Face(k, w, d)
        L = face.length
        u0, u1 = (-L / 2, L / 2) if k % 2 == 0 else (-L / 2 + T, L / 2 - T)
        ops = []
        if k in (0, 2) and h > 6:
            n = int(L // 6)
            ops += [(u0 + (i + 0.5) * (u1 - u0) / n, 4.0, h - 2.4, h - 1.2) for i in range(n)]
        if k == 0 and shop:
            ops.append((u0 + 9.0, 12.0, sock, h - 1.0))
        elif k == 0:
            ops += [(u0 + (i + 1) * (u1 - u0) / (doors + 1), 4.5, sock, sock + 4.5) for i in range(doors)]
        if k == 2:
            ops.append((u1 - 6.0, 3.5, sock, sock + 3.8))
        punched_wall(panels, face, u0, u1, sock, h, ops, t=0.2)
        for u, ow, zb, zt in ops:
            if zb == sock and k == 0 and shop:
                face.box(kit.glass, u, -0.12, zb, ow, 0.02, zt - zb)
                for i in range(7):
                    face.box(kit.frames, u - ow / 2 + i * ow / 6, -0.1, zb, 0.1, 0.06, zt - zb)
                face.box(kit.frames, u, -0.1, zb + 2.6, ow, 0.06, 0.1)
                face.box(kit.door, u - 2.0, -0.08, zb, 2.2, 0.03, 2.4)
                face.box(kit.metal, u, 2.0, h - 1.2, ow + 2.0, 4.0, 0.3)
                for s in (-1, 1):
                    face.box(kit.frames, u + s * (ow / 2 + 0.6), 3.7, 0.0, 0.2, 0.2, h - 1.2)
            elif zb == sock:
                face.box(shutter, u, -0.1, zb, ow, 0.05, zt - zb)
                face.box(kit.metal, u, 0.15, zt, ow + 0.4, 0.3, 0.4)
            else:
                window(kit, face, u, zb, ow, zt - zb, reveal=0.08)
    if roof == 'flat':
        attic = 1.4 if shop else 0.9
        for k in range(4):
            face = Face(k, w, d)
            face.box(kit.door if shop else panels, 0, -0.1, h, face.length + 0.02, 0.22, attic)
            face.box(kit.metal, 0, 0.0, h + attic, face.length + 0.06, 0.3, 0.05)
        felt = Part(pbr_material('roof-bitumen', 'bitumen', (0.8, 0.8, 0.8)), uv_metres=3.0, bevel=0.0)
        box(felt, 0, 0, h - 0.1, w - 0.3, d - 0.3, 0.1)
        for i in range(int(w // 8)):
            x = -w / 2 + 4 + i * 8
            box(kit.frames, x, 0, h, 1.6, d * 0.5, 0.4)
            box(kit.glass, x, 0, h + 0.4, 1.4, d * 0.5 - 0.2, 0.05)
        kit.extra.append(felt)
        if shop:
            # Brand-free fascia stripe and a trolley shelter beside the entrance
            band = Part(flat_material('fascia-green', (0.08, 0.35, 0.18), 0.4, 0.1))
            Face(0, w, d).box(band, 0, 0.12, h + 0.5, w, 0.04, 0.4)
            kit.extra.append(band)
            tx = -w / 2 + 20.0
            for x in (tx - 2.5, tx + 2.5):
                box(kit.frames, x, -d / 2 - 4.0, 0, 0.1, 0.1, 2.3)
            prism(kit.metal, [Vector((tx - 2.7, -d / 2 - 5.0, 2.3)), Vector((tx + 2.7, -d / 2 - 5.0, 2.3)),
                              Vector((tx + 2.7, -d / 2 - 3.2, 2.45)), Vector((tx - 2.7, -d / 2 - 3.2, 2.45))], Vector((0, 0, 0.05)))
            for i in range(6):
                box(kit.metal, tx - 2.0 + i * 0.8, -d / 2 - 4.1, 0.15, 0.55, 0.9, 0.9)
    else:
        pitch = d / 2 * math.tan(math.radians(6))
        sheet = Part(pbr_material('roof-sheet', 'corrugated_iron_02', (0.8, 0.82, 0.84)))
        gable_roof(sheet, w, d, h, pitch, 0.4)
        for k in (1, 3):
            gable_wall(panels, Face(k, w, d), h, pitch, d, t=0.2)
        kit.extra.append(sheet)
        for sy in (-1, 1):
            tube(kit.metal, [Vector((-w / 2 - 0.4, sy * (d / 2 + 0.45), h - 0.1)), Vector((w / 2 + 0.4, sy * (d / 2 + 0.45), h - 0.1))],
                 [0.1, 0.1], 6)
    if annex:
        aw, ad = 10.0, 9.0
        ah = PLINTH + 2 * 3.2 + 0.4
        off = Vector((-w / 2 - aw / 2, -d / 2 + ad / 2, 0))
        box(kit.plinth, off.x, off.y, -FOUNDATION, aw + 0.1, ad + 0.1, FOUNDATION + PLINTH)
        for k in (0, 2, 3):
            face = Moved(Face(k, aw, ad), off)
            L = face.length
            u0, u1 = (-L / 2, L / 2) if k % 2 == 0 else (-L / 2 + T, L / 2 - T)
            n = max(2, int(L // 2.5))
            ops = [(u0 + (i + 0.5) * (u1 - u0) / n, 1.5, PLINTH + 0.9 + f * 3.2, PLINTH + 2.3 + f * 3.2) for i in range(n) for f in range(2)]
            punched_wall(kit.walls(WHITE), face, u0, u1, PLINTH, ah, ops)
            for u, ow, zb, zt in ops:
                window(kit, face, u, zb, ow, zt - zb, reveal=0.1)
        box(kit.metal, off.x, off.y, ah, aw + 0.2, ad + 0.2, 0.3)
    export(name, kit.objects(name), lod=lod)


# ---------------------------------------------------------------- public buildings

def storeys_wall(kit, part, face, u0, u1, z0, floors, fh, win_w, win_h, sill, bay, top=None, door_u=None, door_w=1.8):
    """Wall of a public building: one window per bay and storey, an optional double door on the ground floor"""
    n = max(2, int(round((u1 - u0) / bay)))
    ops = []
    for f in range(floors):
        for i in range(n):
            u = u0 + (i + 0.5) * (u1 - u0) / n
            if f == 0 and door_u is not None and abs(u - door_u) < (u1 - u0) / n / 2:
                ops.append((u, door_w, z0, z0 + 2.6))
            else:
                ops.append((u, win_w, z0 + f * fh + sill, z0 + f * fh + sill + win_h))
    punched_wall(part, face, u0, u1, z0, top if top is not None else z0 + floors * fh, ops)
    for u, w, zb, zt in ops:
        if zb == z0:
            door(kit, face, u, zb, w, zt - zb, side_light=False)
            face.box(kit.glass, u, -0.13, zb + 0.3, w * 0.6, 0.02, 1.8)
        else:
            window(kit, face, u, zb, w, zt - zb, reveal=0.16, shutter=0.0)


def school(name, w=46.0, d=14.0, floors=3, fh=3.6, seed=0):
    """Long school or office of the town: three storeys of wide windows in a rendered front, a projecting
    entrance bay with a canopy, a flat roof behind a parapet with roof plant"""
    clear_scene()
    rnd = random.Random(seed)
    kit = Kit(frame=(0.2, 0.21, 0.22))
    top = PLINTH + floors * fh
    base(kit, w, d)
    for k in range(4):
        face = Face(k, w, d)
        L = face.length
        u0, u1 = (-L / 2, L / 2) if k % 2 == 0 else (-L / 2 + T, L / 2 - T)
        if k % 2 == 0:
            storeys_wall(kit, kit.walls(WHITE), face, u0, u1, PLINTH, floors, fh, 2.4, 1.7, 0.9, 3.1, top=top + 0.6,
                         door_u=0.0 if k == 0 else u1 - 4.0)
        else:
            storeys_wall(kit, kit.walls(WHITE), face, u0, u1, PLINTH, floors, fh, 1.2, 1.7, 0.9, 4.5, top=top + 0.6)
        face.box(kit.metal, 0, 0.0, top + 0.6, L + 0.04, 0.36, 0.05)
        # Coloured band under the windows of each storey
        for f in range(floors):
            face.box(kit.walls(OCHRE), (u0 + u1) / 2, 0.02, PLINTH + f * fh + 0.55, u1 - u0, 0.04, 0.3)
    front = Face(0, w, d)
    front.box(kit.metal, 0, 1.4, PLINTH + 2.9, 8.0, 2.8, 0.3)
    for s in (-1, 1):
        front.box(kit.frames, s * 3.8, 2.6, 0.0, 0.2, 0.2, PLINTH + 2.9)
    flat = Part(pbr_material('roof-bitumen', 'bitumen', (0.8, 0.8, 0.8)), uv_metres=3.0, bevel=0.0)
    box(flat, 0, 0, top - 0.05, w - 0.5, d - 0.5, 0.1)
    kit.extra.append(flat)
    roof_plant(kit, w * 0.8, d * 0.7, top + 0.05, rnd, units=4)
    export(name, kit.objects(name), lod=500)


def town_hall(name, w=30.0, d=15.0, floors=3, fh=3.8, seed=0):
    """Town hall or district office: three storeys under a red hipped roof, a projecting centre bay with a
    gable, a clock and a flagpole, steps to a double door"""
    clear_scene()
    kit = Kit('red')
    top = PLINTH + floors * fh + 0.4
    base(kit, w, d, z_top=PLINTH + 0.3)
    for k in range(4):
        face = Face(k, w, d)
        L = face.length
        u0, u1 = (-L / 2, L / 2) if k % 2 == 0 else (-L / 2 + T, L / 2 - T)
        storeys_wall(kit, kit.walls(CREAM), face, u0, u1, PLINTH + 0.3, floors, fh, 1.3, 2.0, 1.0, 3.0, top=top,
                     door_u=0.0 if k == 0 else None, door_w=2.2)
        face.box(kit.sill, 0, 0.12, top - 0.4, L + 0.24, 0.3, 0.35)
        face.box(kit.sill, 0, 0.04, PLINTH + 0.3 + fh - 0.1, L, 0.1, 0.2)
    # Centre bay: a gabled front standing proud of the facade
    bw, depth = 9.0, 1.0
    box(kit.walls(SAND), 0, -d / 2 - depth / 2 + 0.05, PLINTH, bw, depth, top - PLINTH)
    pitch = 3.0
    prism(kit.walls(SAND), [Vector((-bw / 2, -d / 2 - depth, top)), Vector((bw / 2, -d / 2 - depth, top)),
                            Vector((0, -d / 2 - depth, top + pitch))], Vector((0, depth + 2.0, 0)))
    for s in (-1, 1):
        plank(kit.ridge, Vector((s * (bw / 2 + 0.2), -d / 2 - depth - 0.2, top - 0.1)), Vector((0, -d / 2 - depth - 0.2, top + pitch + 0.1)),
              0.5, 0.2)
    tube(kit.frames, [Vector((0, -d / 2 - depth - 0.05, top + 1.2)), Vector((0, -d / 2 - depth - 0.1, top + 1.2))], [0.8, 0.8], 16, cap=True)
    for a in (0, 1):
        box(kit.door, 0.0, -d / 2 - depth - 0.12, top + 1.2 - 0.03, 0.06 if a else 0.5, 0.03, 0.5 if a else 0.06)
    for f in range(floors):
        zb = PLINTH + 0.3 + f * fh + (1.0 if f else 2.9)
        if f == 0:
            continue
        for u in (-2.6, 0.0, 2.6):
            applied_window(kit, Face(0, bw, 2 * (d / 2 + depth)), u, zb, 1.3, 2.0)
    for k in range(3):
        box(kit.plinth, 0, -d / 2 - depth - 0.2 - k * 0.35, -0.3, 4.5, 0.35, 0.3 + PLINTH + 0.3 - k * 0.25)
    h = d / 2 * math.tan(math.radians(40))
    _hip_roof(kit, w, d, top, h)
    tube(kit.metal, [Vector((w / 2 - 3, -d / 2 + 2, top + h * 0.6)), Vector((w / 2 - 3, -d / 2 + 2, top + h * 0.6 + 6.0))], [0.05, 0.03], 6)
    flag = Part(flat_material('flag', (0.7, 0.1, 0.08), 0.8))
    box(flag, w / 2 - 3 + 0.7, -d / 2 + 2, top + h * 0.6 + 4.6, 1.4, 0.02, 0.9)
    kit.extra.append(flag)
    export(name, kit.objects(name), lod=600)


def _hip_roof(kit, w, d, z, h, over=0.4):
    """Hipped roof over a long box: two trapezoids along X, two triangles at the ends, hip and ridge caps"""
    hw, hd = w / 2 + over, d / 2 + over
    r = w / 2 - d / 2
    zt = z + h
    a, b, c, e = (Vector((-hw, -hd, z)), Vector((hw, -hd, z)), Vector((hw, hd, z)), Vector((-hw, hd, z)))
    p, q = Vector((-r, 0, zt)), Vector((r, 0, zt))
    bm = kit.roof.bm
    uv = kit.roof.uv
    for poly in ((a, b, q, p), (c, e, p, q), (b, c, q), (e, a, p)):
        f = bm.faces.new([bm.verts.new(v) for v in poly])
        n = f.normal
        for loop in f.loops:
            co = loop.vert.co
            along = Vector((-n.y, n.x, 0)).normalized() if abs(n.z) < 0.999 else Vector((1, 0, 0))
            up = n.cross(along)
            loop[uv].uv = (co.dot(along) / 2.2, co.dot(up) / 2.2)
    for corner, apex in ((a, p), (e, p), (b, q), (c, q)):
        plank(kit.ridge, corner, apex, 0.25, 0.12)
    plank(kit.ridge, p, q, 0.3, 0.14)
    bm.faces.new([bm.verts.new(v - Vector((0, 0, 0.01))) for v in (e, c, b, a)])


def town_church(name, seed=0):
    """Town church: a sandstone nave 28 x 13 m under a slate roof, tall pointed windows, a west tower 7 m
    square with louvred belfry openings, clock faces and a slate spire to 48 m"""
    clear_scene()
    kit = Kit()
    stone = Part(pbr_material('stone-white_sandstone_bricks', 'white_sandstone_bricks', (1.05, 1.0, 0.92)), uv_metres=3.0, bevel=0.0)
    dress = Part(pbr_material('stone-sandstone-dress', 'sandstone_blocks_04', (1.0, 0.95, 0.85)), uv_metres=2.0)
    slate = Part(pbr_material('roof-slate', 'roof_slates_02', (0.55, 0.57, 0.62)))
    lead = Part(flat_material('glass-lead', (0.1, 0.12, 0.16), 0.2, 0.5))
    kit.extra += [stone, dress, slate, lead]
    nw, nd, nh = 26.0, 13.0, 12.0
    nx = 3.5  # nave centre east of the tower
    box(dress, nx, 0, -FOUNDATION, nw + 0.3, nd + 0.3, FOUNDATION + 0.8)
    box(stone, nx, 0, 0.8, nw, nd, nh - 0.8)
    pitch = nd / 2 * math.tan(math.radians(52))
    gable_roof(slate, nw, nd, nh, pitch, 0.5)
    for v in slate.bm.verts:
        v.co.x += nx
    for x in (nx - nw / 2, nx + nw / 2 - 0.4):
        prism(stone, [Vector((x, -nd / 2, nh)), Vector((x, nd / 2, nh)), Vector((x, 0, nh + pitch - 0.1))], Vector((0.4, 0, 0)))
    plank(dress, Vector((nx - nw / 2, 0, nh + pitch + 0.05)), Vector((nx + nw / 2 + 0.5, 0, nh + pitch + 0.05)), 0.3, 0.15)

    def lancet(cx, cy, z, w, h, normal):
        """Pointed window proud of the wall: dressed surround, leaded glass, a pointed head"""
        side = Vector((-normal.y, normal.x, 0))
        o = Vector((cx, cy, 0)) + normal * 0.05
        for part, grow, out in ((dress, 0.3, 0.0), (lead, 0.0, 0.06)):
            ww = w + grow
            base_pts = [o + normal * out - side * ww / 2 + Vector((0, 0, z - grow / 2)), o + normal * out + side * ww / 2 + Vector((0, 0, z - grow / 2)),
                        o + normal * out + side * ww / 2 + Vector((0, 0, z + h)), o + normal * out + Vector((0, 0, z + h + ww * 0.8)),
                        o + normal * out - side * ww / 2 + Vector((0, 0, z + h))]
            prism(part, base_pts, normal * 0.08)

    for k in range(5):
        x = nx - nw / 2 + 3.0 + k * (nw - 6.0) / 4
        for sy in (-1, 1):
            lancet(x, sy * nd / 2, 3.0, 1.6, 5.5, Vector((0, sy, 0)))
            # Buttress between the windows
            if k < 4:
                box(dress, x + (nw - 6.0) / 8, sy * (nd / 2 + 0.4), 0.0, 0.8, 0.8, nh - 2.0)
    lancet(nx + nw / 2, 0, 3.5, 3.0, 6.5, Vector((1, 0, 0)))
    # West tower
    tw, th = 7.0, 30.0
    tx = nx - nw / 2 - tw / 2 + 0.5
    box(dress, tx, 0, -FOUNDATION, tw + 0.6, tw + 0.6, FOUNDATION + 1.2)
    box(stone, tx, 0, 1.2, tw, tw, th - 1.2)
    for z in (11.0, 21.0, th - 0.6):
        box(dress, tx, 0, z, tw + 0.3, tw + 0.3, 0.5)
    box(kit.door, tx, -tw / 2 - 0.02, 0.0, 2.2, 0.1, 3.6)
    for k in range(4):
        n = Vector((math.sin(k * math.pi / 2), -math.cos(k * math.pi / 2), 0))
        c = Vector((tx, 0, 0)) + n * (tw / 2)
        lancet(c.x, c.y, th - 7.0, 1.6, 3.6, n)
        for i in range(5):
            box(kit.door, c.x + n.x * 0.12, c.y + n.y * 0.12, th - 6.6 + i * 0.7, 1.2 if abs(n.y) > 0.5 else 0.06, 0.06 if abs(n.y) > 0.5 else 1.2,
                0.1)
        tube(kit.frames, [c + n * 0.05 + Vector((0, 0, 22.8)), c + n * 0.15 + Vector((0, 0, 22.8))], [1.1, 1.1], 16, cap=True)
        tube(kit.door, [c + n * 0.16 + Vector((0, 0, 22.8)), c + n * 0.2 + Vector((0, 0, 22.8))], [0.06, 0.06], 6, cap=True)
        box(kit.door, c.x + n.x * 0.2, c.y + n.y * 0.2, 22.8, 0.06, 0.06, 0.8)
    spire = 18.0
    sp = Part(slate.material)
    pyramid_roof(sp, tw - 0.4, tw - 0.4, th, spire, overhang=0.0, cx=tx)
    slate.add_bmesh(sp.bm)
    sp.bm.free()
    gold = Part(flat_material('cross-gold', (0.8, 0.6, 0.2), 0.3, 0.9))
    box(gold, tx, 0, th + spire - 0.2, 0.12, 0.12, 2.2)
    box(gold, tx, 0, th + spire + 1.3, 1.0, 0.12, 0.12)
    kit.extra.append(gold)
    export(name, kit.objects(name), lod=600)


def station(name, w=28.0, d=11.0, seed=0):
    """Small-town railway station: a two-storey rendered building under a red hipped roof with a station
    clock, the platform side (+Y) with a canopy on cast-iron posts along the whole front"""
    clear_scene()
    kit = Kit('red', frame=(0.32, 0.18, 0.12))
    fh = 3.6
    top = PLINTH + 2 * fh + 0.3
    base(kit, w, d)
    for k in range(4):
        face = Face(k, w, d)
        L = face.length
        u0, u1 = (-L / 2, L / 2) if k % 2 == 0 else (-L / 2 + T, L / 2 - T)
        storeys_wall(kit, kit.walls(SAND), face, u0, u1, PLINTH, 2, fh, 1.3, 2.1, 0.8, 3.2, top=top,
                     door_u=0.0 if k in (0, 2) else None, door_w=2.0)
        face.box(kit.sill, 0, 0.1, top - 0.3, L + 0.2, 0.25, 0.3)
        face.box(kit.walls(STONE), 0, 0.02, PLINTH, L, 0.04, 0.8)
    _hip_roof(kit, w, d, top, d / 2 * math.tan(math.radians(35)))
    # Platform canopy on the +Y side
    cd = 4.0
    for i in range(7):
        x = -w / 2 + 1.0 + i * (w - 2.0) / 6
        tube(kit.door, [Vector((x, d / 2 + cd - 0.4, 0.0)), Vector((x, d / 2 + cd - 0.4, 3.4))], [0.1, 0.08], 8)
    prism(kit.metal, [Vector((-w / 2 - 0.5, d / 2, 3.9)), Vector((w / 2 + 0.5, d / 2, 3.9)), Vector((w / 2 + 0.5, d / 2 + cd, 3.4)),
                      Vector((-w / 2 - 0.5, d / 2 + cd, 3.4))], Vector((0, 0, 0.1)))
    box(kit.door, 0, d / 2 + cd - 0.05, 3.2, w + 1.0, 0.1, 0.3)
    # Station clock on a bracket
    tube(kit.frames, [Vector((0, d / 2 + 1.5, 2.9)), Vector((0, d / 2 + 1.6, 2.9))], [0.35, 0.35], 16, cap=True)
    tube(kit.frames, [Vector((0, d / 2 + 1.4, 2.9)), Vector((0, d / 2 + 1.5, 2.9))], [0.35, 0.35], 16, cap=True)
    box(kit.door, 0, d / 2 + 1.5, 3.25, 0.06, 0.06, 0.6)
    sign = Part(flat_material('sign-blue', (0.05, 0.15, 0.45), 0.4, 0.1))
    box(sign, 0, -d / 2 - 0.08, PLINTH + fh + 0.2, 6.0, 0.06, 0.7)
    box(sign, 0, d / 2 + 0.08, PLINTH + fh + 0.2, 6.0, 0.06, 0.7)
    kit.extra.append(sign)
    export(name, kit.objects(name), lod=500)


def parking_garage(name, w=32.0, d=40.0, decks=4, dh=2.9, seed=0):
    """Open multi-storey car park: concrete decks on columns, precast parapet bands, a stair tower with a
    lift at one corner, a ramp at the back, a few cars on the top deck"""
    clear_scene()
    rnd = random.Random(seed)
    kit = Kit()
    concrete = Part(pbr_material('deck-concrete', 'brushed_concrete', (1.1, 1.1, 1.1)), uv_metres=3.0, bevel=0.0)
    parapet = Part(pbr_material('parapet-precast', 'precast_concrete_wall', (1.15, 1.15, 1.15)), uv_metres=3.0, bevel=0.0)
    asphalt = Part(pbr_material('deck-asphalt', 'asphalt_02', (0.8, 0.8, 0.8)), uv_metres=4.0, bevel=0.0)
    paint = Part(flat_material('deck-lines', (0.85, 0.85, 0.8), 0.6))
    kit.extra += [concrete, parapet, asphalt, paint]
    box(kit.plinth, 0, 0, -FOUNDATION, w + 0.1, d + 0.1, FOUNDATION + 0.15)
    for k in range(1, decks + 1):
        z = k * dh
        box(concrete, 0, 0, z - 0.35, w, d, 0.35)
        if k == decks:
            box(asphalt, 0, 0, z, w - 0.6, d - 0.6, 0.02)
            for i in range(12):
                for sy in (-1, 1):
                    box(paint, -w / 2 + 2.5 + i * 2.5, sy * (d / 2 - 3.0), z + 0.02, 0.1, 5.0, 0.01)
        for j in range(4):
            face = Face(j, w, d)
            face.box(parapet, 0, -0.1, z, face.length, 0.2, 1.1)
    for i in range(6):
        for j in range(6):
            x = -w / 2 + 0.4 + i * (w - 0.8) / 5
            y = -d / 2 + 0.4 + j * (d - 0.8) / 5
            box(concrete, x, y, 0.15, 0.5, 0.5, decks * dh - 0.5)
    # Stair and lift tower at the front west corner, rendered
    sx, sy = -w / 2 - 2.5, -d / 2 + 3.5
    th = decks * dh + 3.5
    box(kit.walls(PALE_GREY), sx, sy, 0.0, 5.0, 7.0, th)
    box(kit.glass, sx - 2.52, sy, 0.6, 0.04, 2.5, th - 1.2)
    box(kit.metal, sx, sy, th, 5.3, 7.3, 0.2)
    box(kit.door, sx, sy - 3.52, 0.0, 1.4, 0.04, 2.3)
    sign = Part(flat_material('sign-parking', (0.05, 0.2, 0.6), 0.4, 0.1))
    box(sign, sx, sy - 3.54, th - 2.2, 1.8, 0.04, 1.8)
    box(paint, sx, sy - 3.57, th - 2.0, 0.3, 0.04, 1.4)
    kit.extra.append(sign)
    # Ramp at the back up to the first deck
    prism(concrete, [Vector((-w / 2 + 2, d / 2 + 14, 0.15)), Vector((-w / 2 + 8, d / 2 + 14, 0.15)), Vector((-w / 2 + 8, d / 2, dh)),
                     Vector((-w / 2 + 2, d / 2, dh))], Vector((0, 0, -0.3)))
    for x in (-w / 2 + 2, -w / 2 + 8):
        plank(parapet, Vector((x, d / 2 + 14, 0.65)), Vector((x, d / 2, dh + 0.5)), 0.2, 1.0)
    colours = [(0.6, 0.05, 0.05), (0.08, 0.1, 0.3), (0.75, 0.75, 0.75), (0.1, 0.1, 0.1)]
    cars = [Part(flat_material('car-%d' % i, c, 0.3, 0.5)) for i, c in enumerate(colours)]
    kit.extra += cars
    for i in range(7):
        if rnd.random() < 0.4:
            continue
        for s in (-1, 1):
            if rnd.random() < 0.5:
                continue
            x = -w / 2 + 3.75 + i * 2.5 * 1.7
            y = s * (d / 2 - 3.0)
            p = cars[rnd.randrange(4)]
            box(p, x, y, decks * dh + 0.25, 1.8, 4.3, 0.75)
            box(p, x, y + 0.2 * s, decks * dh + 1.0, 1.6, 2.2, 0.55)
            box(kit.glass, x, y + 0.2 * s, decks * dh + 1.05, 1.62, 2.0, 0.42)
    export(name, kit.objects(name), lod=500)


# ---------------------------------------------------------------- small buildings

def greenhouse(name, w=12.0, d=6.0, wall_h=2.2):
    """Glasshouse: a low brick base, aluminium glazing bars on all walls and the gable roof, a door at the
    front gable (turned so it faces -Y)"""
    clear_scene()
    kit = Kit()
    brick = Part(pbr_material('brick-base', 'brick_wall_07'), uv_metres=2.0, bevel=0.0)
    alu = Part(flat_material('alu', (0.75, 0.77, 0.78), 0.35, 0.8))
    pane = Part(flat_material('greenhouse-glass', (0.45, 0.55, 0.52), 0.05, 0.3))
    kit.extra += [brick, alu, pane]
    sock = 0.6
    box(brick, 0, 0, -0.5, w, d, sock + 0.5)
    pitch = d / 2 * math.tan(math.radians(28))
    box(pane, 0, 0, sock, w - 0.06, d - 0.06, wall_h - sock)
    for k in range(2):
        prism(pane, [Vector((-w / 2 + 0.03 if k == 0 else w / 2 - 0.03, -d / 2 + 0.03, wall_h)), Vector((-w / 2 + 0.03 if k == 0 else w / 2 - 0.03, d / 2 - 0.03, wall_h)),
                     Vector((-w / 2 + 0.03 if k == 0 else w / 2 - 0.03, 0, wall_h + pitch))], Vector((0.01 if k == 0 else -0.01, 0, 0)))
    roof = Part(pane.material)
    gable_roof(roof, w, d, wall_h, pitch, 0.05)
    pane.add_bmesh(roof.bm)
    roof.bm.free()
    n = int(w / 1.2)
    for i in range(n + 1):
        x = -w / 2 + i * w / n
        for sy in (-1, 1):
            box(alu, x, sy * d / 2, sock, 0.06, 0.06, wall_h - sock)
            plank(alu, Vector((x, sy * (d / 2 + 0.05), wall_h)), Vector((x, 0, wall_h + pitch + 0.02)), 0.05, 0.06)
    for sy in (-1, 1):
        box(alu, 0, sy * d / 2, wall_h - 0.05, w, 0.08, 0.08)
    plank(alu, Vector((-w / 2, 0, wall_h + pitch + 0.03)), Vector((w / 2, 0, wall_h + pitch + 0.03)), 0.1, 0.08)
    for sx in (-1, 1):
        for i in range(5):
            y = -d / 2 + i * d / 4
            box(alu, sx * w / 2, y, sock, 0.06, 0.06, wall_h - sock + (pitch * (1 - abs(y) / (d / 2))))
    box(kit.door, w / 2 + 0.02, 0, 0.0, 0.04, 1.0, 2.0)
    objects = kit.objects(name)
    tilt(objects, z=-90)
    export(name, objects, lod=150)


def kiosk(name, w=4.0, d=3.0, h=2.7):
    """Street kiosk: a rendered box with a serving hatch under an awning, a projecting flat roof, a menu
    board"""
    clear_scene()
    kit = Kit()
    awning = Part(flat_material('awning-red', (0.6, 0.08, 0.06), 0.8))
    board = Part(flat_material('board-dark', (0.06, 0.07, 0.08), 0.5))
    kit.extra += [awning, board]
    box(kit.plinth, 0, 0, -0.5, w, d, 0.6)
    front = Face(0, w, d)
    ops = [(-0.3, 2.4, 1.0, 2.2), (1.55, 0.7, 0.1, 2.15)]
    punched_wall(kit.walls(CREAM), front, -w / 2, w / 2, 0.1, h, ops, t=0.15)
    window(kit, front, -0.3, 1.0, 2.4, 1.2, reveal=0.08)
    door(kit, front, 1.55, 0.1, 0.7, 2.05, reveal=0.08, side_light=False)
    front.box(kit.sill, -0.3, 0.2, 0.95, 2.6, 0.45, 0.06)
    for k in (1, 2, 3):
        f = Face(k, w, d)
        inset = 0.15 if k % 2 else 0.0
        punched_wall(kit.walls(CREAM), f, -f.length / 2 + inset, f.length / 2 - inset, 0.1, h, [], t=0.15)
    prism(awning, [Vector((-1.6, -d / 2, 2.4)), Vector((1.0, -d / 2, 2.4)), Vector((1.0, -d / 2 - 1.0, 2.05)),
                   Vector((-1.6, -d / 2 - 1.0, 2.05))], Vector((0, 0, 0.03)))
    box(kit.metal, 0, 0, h, w + 0.6, d + 0.6, 0.18)
    box(board, w / 2 + 0.03, 0, 1.0, 0.04, 1.4, 1.2)
    box(board, 0, -d / 2 - 0.25, h - 0.1, w + 0.6, 0.04, 0.4)
    export(name, kit.objects(name), lod=120)


def transformer(name, w=3.6, d=2.6, h=2.6):
    """Compact transformer station: a concrete box with louvred steel doors, a flat roof with a drip
    edge, a warning sign"""
    clear_scene()
    kit = Kit()
    shell = Part(pbr_material('concrete-box', 'brushed_concrete', (1.45, 1.43, 1.38)), uv_metres=2.5, bevel=0.02)
    steel = Part(flat_material('doors-grey', (0.5, 0.52, 0.5), 0.5, 0.5))
    sign = Part(flat_material('warning-yellow', (0.85, 0.65, 0.05), 0.5))
    kit.extra += [shell, steel, sign]
    box(shell, 0, 0, -0.6, w, d, h + 0.6)
    box(shell, 0, 0, h, w + 0.2, d + 0.2, 0.15)
    for x in (-0.95, 0.95):
        box(steel, x, -d / 2 - 0.02, 0.2, 1.2, 0.04, 2.0)
        for i in range(6):
            box(steel, x, -d / 2 - 0.05, 1.3 + i * 0.12, 1.0, 0.03, 0.04)
    box(steel, w / 2 + 0.02, 0, 0.2, 0.04, 1.0, 2.0)
    prism(sign, [Vector((-0.2, -d / 2 - 0.06, 2.1)), Vector((0.2, -d / 2 - 0.06, 2.1)), Vector((0.0, -d / 2 - 0.06, 2.45))],
          Vector((0, -0.01, 0)))
    export(name, kit.objects(name), lod=60)


# ---------------------------------------------------------------- railway, power, leisure, farming

GAUGE = 1.435


def steel_material():
    return flat_material('steel-rail', (0.32, 0.3, 0.28), 0.35, 0.9)


def rails(part, sleepers, x0, x1, z=0.0, spacing=0.625, clips=None):
    """Two rails along X (head, web, foot as one profile box each) on sleepers; a whole number of sleepers per
    piece, so the 10 m and 2.5 m pieces keep one pitch across their joints. `clips`: a rail clip either side
    of each rail on every sleeper"""
    for s in (-1, 1):
        y = s * (GAUGE / 2 + 0.035)
        box(part, (x0 + x1) / 2, y, z + 0.17, x1 - x0, 0.15, 0.03)
        box(part, (x0 + x1) / 2, y, z + 0.2, x1 - x0, 0.03, 0.1)
        box(part, (x0 + x1) / 2, y, z + 0.3, x1 - x0, 0.07, 0.05)
    n = max(1, round((x1 - x0) / spacing))
    for i in range(n):
        x = x0 + (i + 0.5) * (x1 - x0) / n
        box(sleepers, x, 0, z, 0.26, 2.6, 0.17)
        if clips is not None:
            for s in (-1, 1):
                for side in (-1, 1):
                    box(clips, x, s * (GAUGE / 2 + 0.035) + side * 0.11, z + 0.17, 0.1, 0.07, 0.045)


BALLAST_TOP = 0.35
# The railway's surfaces repeat along X every LATTICE metres (convert/rails.ts tiles its lines with 10 and
# 2.5 m pieces): their noises run round a circle of that circumference, their images repeat twice in it
LATTICE = 2.5


def ballast_material():
    return pbr_material('ballast', 'gravel_floor_02', (0.62, 0.6, 0.58))


def sleeper_material():
    return pbr_material('sleeper-concrete', 'brushed_concrete', (1.1, 1.1, 1.05))


def periodic_vector(n, scale):
    """Model coordinates times `scale` with X wound round a circle of LATTICE metres' circumference: a texture
    read there repeats along X every LATTICE metres; Y and Z stay as they are"""
    nt = n.nt
    x, y, z = n.axis(0), n.axis(1), n.axis(2)
    turn = n.math('MULTIPLY', x, 2 * math.pi / LATTICE)
    r = LATTICE / (2 * math.pi)
    v = nt.nodes.new('ShaderNodeCombineXYZ')
    n.put(v.inputs['X'], n.math('MULTIPLY', n.math('COSINE', turn), r))
    n.put(v.inputs['Y'], n.math('MULTIPLY', n.math('SINE', turn), r))
    n.put(v.inputs['Z'], n.math('ADD', y, n.math('MULTIPLY', z, 0.7)))
    m = nt.nodes.new('ShaderNodeVectorMath')
    m.operation = 'SCALE'
    nt.links.new(v.outputs[0], m.inputs[0])
    m.inputs['Scale'].default_value = scale
    return m.outputs[0]


def periodic(n, scale, detail=3.0, roughness=0.55):
    """Noise at `scale` per metre repeating along X every LATTICE metres (periodic_vector)"""
    t = n.nt.nodes.new('ShaderNodeTexNoise')
    t.noise_dimensions = '3D'
    n.nt.links.new(periodic_vector(n, scale), t.inputs['Vector'])
    t.inputs['Scale'].default_value = 1.0
    t.inputs['Detail'].default_value = detail
    t.inputs['Roughness'].default_value = roughness
    return t.outputs['Fac']


def stones(n, scale):
    """Crushed stone repeating every LATTICE metres along X: each stone's own shade (0 to 1) and how far a
    point lies inside its stone (0 at the gap between stones)"""
    vec = periodic_vector(n, scale)
    cell = n.nt.nodes.new('ShaderNodeTexVoronoi')
    cell.feature = 'F1'
    n.nt.links.new(vec, cell.inputs['Vector'])
    cell.inputs['Scale'].default_value = 1.0
    cell.inputs['Randomness'].default_value = 0.9
    shade = n.nt.nodes.new('ShaderNodeRGBToBW')
    n.nt.links.new(cell.outputs['Color'], shade.inputs['Color'])
    edge = n.nt.nodes.new('ShaderNodeTexVoronoi')
    edge.feature = 'DISTANCE_TO_EDGE'
    n.nt.links.new(vec, edge.inputs['Vector'])
    edge.inputs['Scale'].default_value = 1.0
    edge.inputs['Randomness'].default_value = 0.9
    return shade.outputs['Val'], edge.outputs['Distance']


RAIL_Y = GAUGE / 2 + 0.035


def ballast_surface(name):
    """Track ballast: crushed basalt and granite, each stone its own shade between dark grey and a light warm
    grey with dark gaps between them and the gravel scan's fine grain over it, a broad warmer tone along the
    line, rust brown brake dust along each rail, oil and grime in patches between them, earth and a little
    green at the foot of the shoulders; the stones domed in the normal"""
    n = Nodes(name)
    shade, inside = stones(n, 13.0)
    grain = n.image('gravel_floor_02', 'diff', metres=LATTICE / 4)
    bw = n.nt.nodes.new('ShaderNodeRGBToBW')
    n.put(bw.inputs['Color'], grain)
    tone = n.math('ADD', n.math('MULTIPLY', shade, 0.75), n.math('MULTIPLY', bw.outputs['Val'], 0.5))
    c = n.mix(n.ramp(tone, 0.15, 0.95), (0.03, 0.029, 0.028), (0.2, 0.19, 0.175))
    c = n.mix(n.math('MULTIPLY', n.ramp(inside, 0.06, 0.0), 0.7), c, (0.012, 0.012, 0.011))
    c = n.mix(n.math('MULTIPLY', n.ramp(periodic(n, 0.5), 0.35, 0.7), 0.3), c, (0.11, 0.09, 0.07))
    ay = n.math('ABSOLUTE', n.axis(1))
    rail = n.math('ABSOLUTE', n.math('SUBTRACT', ay, RAIL_Y))
    rust = n.math('MULTIPLY', n.ramp(rail, 0.38, 0.04), n.mixf(periodic(n, 2.2), 0.45, 1.0))
    c = n.mix(n.math('MULTIPLY', rust, 0.6), c, (0.075, 0.038, 0.02))
    oil = n.math('MULTIPLY', n.ramp(ay, 0.62, 0.3), n.ramp(periodic(n, 0.9), 0.42, 0.62))
    c = n.mix(n.math('MULTIPLY', oil, 0.6), c, (0.016, 0.014, 0.012))
    toe = n.math('MULTIPLY', n.ramp(n.axis(2), 0.1, -0.2), n.ramp(ay, 1.9, 2.4))
    c = n.mix(n.math('MULTIPLY', toe, 0.6), c, (0.07, 0.055, 0.035))
    moss = n.math('MULTIPLY', toe, n.ramp(periodic(n, 1.8), 0.55, 0.75))
    c = n.mix(n.math('MULTIPLY', moss, 0.45), c, (0.04, 0.055, 0.02))
    normal = n.bump(n.ramp(inside, 0.0, 0.25), strength=0.9, distance=0.025)
    return n.finish(c, n.mixf(oil, 0.95, 0.65), normal)


def sleeper_surface(name, wood):
    """Sleepers: weathered concrete (light grey, darker and rust stained under the rail seats) or creosoted
    timber (dark brown grain, oily where the rails stand, lighter on the worn edges)"""
    n = Nodes(name)
    ay = n.math('ABSOLUTE', n.axis(1))
    seat = n.ramp(n.math('ABSOLUTE', n.math('SUBTRACT', ay, RAIL_Y)), 0.2, 0.06)
    if wood:
        c = n.image('dark_planks', 'diff', metres=LATTICE / 2, tint=(0.42, 0.33, 0.25))
        c = n.mix(n.math('MULTIPLY', seat, 0.7), c, (0.03, 0.022, 0.016))
        c = n.mix(n.math('MULTIPLY', n.edges(0.015), 0.35), c, (0.2, 0.16, 0.12))
        return n.finish(c, n.mixf(seat, 0.85, 0.6), n.bump(periodic(n, 14.0), strength=0.25, distance=0.01))
    c = n.image('brushed_concrete', 'diff', metres=LATTICE / 2, tint=(0.62, 0.61, 0.58))
    c = n.mix(n.math('MULTIPLY', n.ramp(periodic(n, 3.0), 0.4, 0.75), 0.3), c, (0.2, 0.19, 0.17))
    c = n.mix(n.math('MULTIPLY', seat, n.mixf(periodic(n, 6.0), 0.35, 0.8)), c, (0.12, 0.055, 0.025))
    c = n.mix(n.math('MULTIPLY', n.edges(0.015), 0.25), c, (0.42, 0.41, 0.39))
    return n.finish(c, 0.85)


def rail_surface(name, top):
    """Rails: the running surface of the heads bright steel, the rest rust brown"""
    n = Nodes(name)
    head = n.ramp(n.axis(2), top - 0.012, top - 0.002)
    c = n.mix(head, n.mix(n.ramp(periodic(n, 4.0), 0.3, 0.7), (0.035, 0.022, 0.015), (0.024, 0.019, 0.016)), (0.5, 0.5, 0.52))
    return n.finish(c, n.mixf(head, 0.88, 0.28), metallic=n.mixf(head, 0.1, 0.9))


def track_parts(length, wood, top_z):
    """The ballast bed, sleepers and rails of a straight track along X with the procedural
    surfaces; `top_z` the ballast's top"""
    kind = 'wood' if wood else 'concrete'
    ballast = Part(ballast_surface('ballast-baked'))
    sleepers = Part(sleeper_surface('sleeper-' + kind + '-baked', wood), bevel=0.012)
    steel = Part(rail_surface('rail-baked', top_z - 0.08 + 0.35))
    rails(steel, sleepers, -length / 2, length / 2, z=top_z - 0.08)
    return ballast, sleepers, steel


def without_undersides(objects):
    """Takes off the faces looking down (the ballast's base, the sleepers' and rails' feet): nobody sees them,
    and the bake gives their texture room to the faces that show"""
    import bmesh as bm_
    for obj in objects:
        b = bm_.new()
        b.from_mesh(obj.data)
        bm_.ops.delete(b, geom=[f for f in b.faces if f.normal.z < -0.7], context='FACES')
        b.to_mesh(obj.data)
        b.free()
    return objects


def track(name, length=10.0, wood=False):
    """Straight track along X, 10 m and 2.5 m long (the OSM railway tiles its lines with both,
    convert/rails.ts), origin on the formation: a ballast bed with a flat crest a little past the sleepers'
    ends and shoulders falling 1:1.5 into the levelled ground, concrete or timber sleepers (the rail seats
    stained), two rails. Its surfaces are baked (bake_surface) and repeat every LATTICE metres along X, so pieces of any
    length join without a seam"""
    clear_scene()
    ballast, sleepers, steel = track_parts(length, wood, BALLAST_TOP)
    h = BALLAST_TOP
    x0 = -length / 2
    prism(ballast, [Vector((x0, -2.68, -0.3)), Vector((x0, 2.68, -0.3)), Vector((x0, 1.82, h - 0.03)), Vector((x0, 1.7, h)),
                    Vector((x0, -1.7, h)), Vector((x0, -1.82, h - 0.03))], Vector((length, 0, 0)))
    objects = without_undersides([ballast.to_object(name), sleepers.to_object(name + '-sleepers'), steel.to_object(name + '-rails')])
    obj = bake_surface(name, objects, size=1024 if length >= 10 else 512, samples=24, ao_distance=0.4)
    export_lod(name, obj, ratio=min(1.0, (70 if length >= 10 else 26) / max(1, len(obj.data.polygons))), textured=True)


PANEL_TOP = 0.08


def level_crossing(name, length=2.5):
    """A 2.5 m module of a level crossing along X in the track's format: the track's ballast bed, sleepers and
    rails (origin on the formation, so bed and crossing pieces join rail to rail and bed to bed), concrete panels
    over them between and beside the rails, flush with the rail heads, their outer edges chamfered down to the road
    PANEL_TOP under them; steel angles along the flangeways, a dark joint between modules. The panels reach down to
    the ballast (no slot under them at a piece's end). convert/rails.ts lays the formation CROSSING_SINK under the
    road there, so the road meets the chamfers and hides the ballast; past the road the bed shows as on the track.
    Baked like the track (one material). The road runs across (Y)"""
    clear_scene()
    ballast, sleepers, steel = track_parts(length, False, BALLAST_TOP)
    panel = Part(pbr_material('crossing-panel', 'concrete_slab_wall', (0.78, 0.78, 0.76)), uv_metres=2.5, bevel=0.01)
    edge = Part(flat_material('crossing-angle', (0.18, 0.18, 0.17), 0.55, 0.7))
    h = BALLAST_TOP
    top = h - 0.08 + 0.35
    road = top - PANEL_TOP
    x0 = -length / 2
    prism(ballast, [Vector((x0, -2.68, -0.3)), Vector((x0, 2.68, -0.3)), Vector((x0, 1.82, h - 0.03)), Vector((x0, 1.7, h)),
                    Vector((x0, -1.7, h)), Vector((x0, -1.82, h - 0.03))], Vector((length, 0, 0)))
    gap = 0.02
    px0, px1 = x0 + gap / 2, length / 2 - gap / 2
    inner = GAUGE / 2 - 0.04
    box(panel, 0, 0, h, px1 - px0, inner * 2, top - h)
    # The ballast's shoulder under the panels' outer edge: 1.82 m out at h - 0.03, falling to -0.3 at 2.68 m
    y2 = 2.35
    foot = -0.3 + (2.68 - y2) * (h - 0.03 + 0.3) / (2.68 - 1.82)
    for s in (-1, 1):
        y0 = s * (GAUGE / 2 + 0.11)
        y1 = s * 1.82
        lo, hi = (y0, y1) if s > 0 else (y1, y0)
        box(panel, 0, (lo + hi) / 2, h - 0.03, px1 - px0, abs(hi - lo), top - h + 0.03)
        # The chamfer down to the road, the panel's underside on the shoulder
        prism(panel, [Vector((px0, y1, h - 0.03)), Vector((px0, s * y2, foot)), Vector((px0, s * y2, road)), Vector((px0, s * 2.0, top)),
                      Vector((px0, y1, top))], Vector((px1 - px0, 0, 0)))
        # Steel angles along the flangeways
        for y in (s * (inner + 0.012), y0 - s * 0.012):
            box(edge, 0, y, top - 0.025, px1 - px0, 0.024, 0.025)
    objects = without_undersides([ballast.to_object(name), sleepers.to_object(name + '-sleepers'), steel.to_object(name + '-rails'),
                                  panel.to_object(name + '-panels'), edge.to_object(name + '-angles')])
    obj = bake_surface(name, objects, size=512, samples=24, ao_distance=0.4)
    export_lod(name, obj, ratio=min(1.0, 40 / max(1, len(obj.data.polygons))), textured=True)


STREET_TOP = 0.05


def street_track(name, length=2.5):
    """A 2.5 m module of track in a street or yard along X in the track's format: the track's ballast bed, sleepers
    and rails (origin on the formation, so street and bed pieces join rail to rail and bed to bed), an asphalt strip
    over them flush with the rail heads (grooves beside the heads, a setts band along each rail), its edges chamfered
    down to the road STREET_TOP under it, reaching down to the ballast. convert/rails.ts lays the formation
    STREET_SINK under the road there, so the road hides the ballast. Baked like the track (one material). A tramway
    down a street, a siding in a yard"""
    clear_scene()
    ballast, sleepers, steel = track_parts(length, False, BALLAST_TOP)
    asphalt = Part(pbr_material('street-track-asphalt', 'asphalt_02', (0.9, 0.9, 0.9)), uv_metres=2.5, bevel=0.0)
    setts = Part(pbr_material('street-track-setts', 'concrete_slab_wall', (0.55, 0.55, 0.53)), uv_metres=0.6, bevel=0.0)
    groove = Part(flat_material('street-track-groove', (0.05, 0.05, 0.05), 0.7, 0.3))
    h = BALLAST_TOP
    top = h - 0.08 + 0.35
    road = top - STREET_TOP
    x0, x1 = -length / 2, length / 2
    prism(ballast, [Vector((x0, -2.68, -0.3)), Vector((x0, 2.68, -0.3)), Vector((x0, 1.82, h - 0.03)), Vector((x0, 1.7, h)),
                    Vector((x0, -1.7, h)), Vector((x0, -1.82, h - 0.03))], Vector((length, 0, 0)))
    head = GAUGE / 2 + 0.035
    inner = head - 0.075
    box(asphalt, 0, 0, h, length, inner * 2 - 0.3, top - h)
    # The ballast's shoulder under the strip's outer edge: 1.82 m out at h - 0.03, falling to -0.3 at 2.68 m
    y2 = 2.1
    foot = -0.3 + (2.68 - y2) * (h - 0.03 + 0.3) / (2.68 - 1.82)
    for s in (-1, 1):
        # A setts band either side of each rail, the groove between band and head
        for a, b in ((inner - 0.15, inner), (head + 0.075, head + 0.3)):
            lo, hi = (a, b) if s > 0 else (-b, -a)
            box(setts, 0, (lo + hi) / 2, h, length, hi - lo, top - h)
        # The grooves either side of the head, down to the ballast (no slot at a piece's end)
        for a, b in ((inner, head - 0.035), (head + 0.035, head + 0.075)):
            g0, g1 = (a, b) if s > 0 else (-b, -a)
            box(groove, 0, (g0 + g1) / 2, h, length, g1 - g0, top - 0.02 - h)
        y0, y1 = s * (head + 0.3), s * 1.82
        lo, hi = (y0, y1) if s > 0 else (y1, y0)
        box(asphalt, 0, (lo + hi) / 2, h - 0.03, length, hi - lo, top - h + 0.03)
        # The chamfer down to the road, the strip's underside on the shoulder
        prism(asphalt, [Vector((x0, y1, h - 0.03)), Vector((x0, s * y2, foot)), Vector((x0, s * y2, road)), Vector((x0, s * 1.9, top)),
                        Vector((x0, y1, top))], Vector((length, 0, 0)))
    objects = without_undersides([ballast.to_object(name), sleepers.to_object(name + '-sleepers'), steel.to_object(name + '-rails'),
                                  asphalt.to_object(name + '-asphalt'), setts.to_object(name + '-setts'), groove.to_object(name + '-grooves')])
    obj = bake_surface(name, objects, size=512, samples=24, ao_distance=0.4)
    export_lod(name, obj, ratio=min(1.0, 40 / max(1, len(obj.data.polygons))), textured=True)


def crossed_board(part, z, y, size, width, thick):
    """One arm pair of a St Andrew's cross: two boards in the XZ plane crossed at 45 degrees about (0, y, z)"""
    for a in (math.radians(45), math.radians(-45)):
        c, s = math.cos(a), math.sin(a)
        corners = []
        for dy in (-thick / 2, thick / 2):
            for u, v in ((-size / 2, -width / 2), (size / 2, -width / 2), (size / 2, width / 2), (-size / 2, width / 2)):
                corners.append(Vector((u * c - v * s, y + dy, z + u * s + v * c)))
        hexa(part, corners[:4], corners[4:])


def crossing_post(name, light=False):
    """St Andrew's cross on a galvanised post at a level crossing, its face to -Y: red-rimmed white boards;
    with `light` the yellow and red lights below it in a black board with a white rim and hoods (the German
    Lichtzeichen)"""
    clear_scene()
    post = Part(flat_material('crossing-post', (0.6, 0.62, 0.63), 0.45, 0.8), smooth=True)
    footing = Part(pbr_material('footing-concrete', 'brushed_concrete', (0.7, 0.7, 0.7)), uv_metres=1.0)
    red = Part(flat_material('saltire-red', (0.62, 0.04, 0.03), 0.35))
    white = Part(flat_material('saltire-white', (0.88, 0.88, 0.85), 0.35))
    parts = [post, footing, red, white]
    top = 3.6 if light else 2.75
    box(footing, 0, 0, -0.4, 0.36, 0.36, 0.48)
    tube(post, [Vector((0, 0, 0.05)), Vector((0, 0, top))], [0.055, 0.05], 10)
    zc = top - 0.45
    crossed_board(red, zc, -0.075, 1.2, 0.17, 0.03)
    crossed_board(white, zc, -0.095, 1.1, 0.09, 0.01)
    if light:
        board = Part(flat_material('signal-board', (0.03, 0.03, 0.035), 0.5))
        rim = Part(flat_material('signal-rim', (0.85, 0.85, 0.82), 0.45))
        yellow = Part(flat_material('lamp-yellow', (0.75, 0.48, 0.05), 0.12, emission=(0.6, 0.35, 0.02), strength=0.4))
        lamp = Part(flat_material('lamp-red', (0.62, 0.04, 0.02), 0.12, emission=(0.5, 0.02, 0.01), strength=0.4))
        parts += [board, rim, yellow, lamp]
        z0, z1 = 1.55, 2.6
        box(rim, 0, -0.07, z0 - 0.04, 0.58, 0.02, z1 - z0 + 0.08)
        box(board, 0, -0.095, z0, 0.5, 0.03, z1 - z0)
        for z, part in ((z1 - 0.27, yellow), (z0 + 0.27, lamp)):
            disc = [Vector((math.cos(k / 16 * math.tau) * 0.15, -0.115, z + math.sin(k / 16 * math.tau) * 0.15)) for k in range(16)]
            f = part.bm.faces.new([part.bm.verts.new(v) for v in disc])
            for loop in f.loops:
                loop[part.uv].uv = (0.5, 0.5)
            # The hood over the lamp: a half ring reaching forward, both sides
            for k in range(8):
                a0, a1 = k / 8 * math.pi, (k + 1) / 8 * math.pi
                p = [Vector((math.cos(a) * 0.18, y, z + math.sin(a) * 0.18)) for a, y in ((a0, -0.11), (a1, -0.11), (a1, -0.33), (a0, -0.33))]
                board.quad(p, [(0, 0), (1, 0), (1, 1), (0, 1)])
                board.quad(list(reversed(p)), [(0, 0), (1, 0), (1, 1), (0, 1)])
    export(name, [p.to_object(name + '-%d' % k) for k, p in enumerate(parts) if p.bm.faces], lod=80 if light else 50)


def crossing_barrier(name, boom=4.5):
    """Half barrier at a level crossing (Halbschranke), its face to -Y: a grey drive housing on a concrete
    footing, the red and white boom raised upright (open), its counterweight behind the pivot"""
    clear_scene()
    housing = Part(flat_material('barrier-housing', (0.52, 0.55, 0.56), 0.45, 0.5))
    footing = Part(pbr_material('footing-concrete', 'brushed_concrete', (0.7, 0.7, 0.7)), uv_metres=1.0)
    red = Part(flat_material('boom-red', (0.62, 0.04, 0.03), 0.35))
    white = Part(flat_material('boom-white', (0.88, 0.88, 0.85), 0.35))
    steel = Part(flat_material('barrier-steel', (0.3, 0.31, 0.32), 0.45, 0.8), smooth=True)
    box(footing, 0, 0, -0.4, 0.8, 0.7, 0.5)
    box(housing, 0, 0, 0.1, 0.5, 0.42, 0.9)
    prism(housing, [Vector((-0.25, -0.21, 1.0)), Vector((-0.25, 0.21, 1.0)), Vector((-0.25, 0.12, 1.1)), Vector((-0.25, -0.12, 1.1))],
          Vector((0.5, 0, 0)))
    pivot = Vector((0.38, 0, 0.85))
    tube(steel, [Vector((0.2, 0, 0.85)), Vector((0.46, 0, 0.85))], [0.07, 0.07], 10, cap=True)
    # Upright, leaning back a little; stripes half a metre long
    lean = math.radians(4)
    d = Vector((0, math.sin(lean), math.cos(lean)))
    for k in range(int(boom / 0.5)):
        a = pivot + d * (0.1 + k * 0.5)
        b = a + d * 0.5
        part = red if k % 2 == 0 else white
        ring = [Vector((-0.04, -0.06, 0)), Vector((0.04, -0.06, 0)), Vector((0.04, 0.06, 0)), Vector((-0.04, 0.06, 0))]
        hexa(part, [a + v for v in ring], [b + v for v in ring])
    box(steel, 0.38, 0.12, 0.35, 0.12, 0.26, 0.45)
    export(name, [p.to_object(name + '-%d' % k) for k, p in enumerate([housing, footing, red, white, steel]) if p.bm.faces], lod=60)


def rail_bridge(name, length=10.0):
    """A piece of a ballasted rail bridge along X, in the track's format (origin on the formation, ballast
    top 0.35 m over it): a concrete trough (slab 1 m deep, edge beams with a cornice and a drip nose)
    holding the track's ballast, sleepers and rails, a galvanised railing on both edges. 10 m and 2.5 m
    long; baked like the track, its surfaces repeating every LATTICE metres along X"""
    clear_scene()
    n = Nodes('bridge-concrete-baked')
    c = n.image('precast_concrete_wall', 'diff', metres=LATTICE / 2, tint=(0.8, 0.8, 0.78))
    streaks = n.math('MULTIPLY', n.ramp(n.axis(2), 0.3, -1.4), n.ramp(periodic(n, 2.0, detail=2.0), 0.45, 0.7))
    c = n.mix(n.math('MULTIPLY', streaks, 0.45), c, (0.1, 0.095, 0.085))
    concrete = Part(n.finish(c, 0.88), bevel=0.02)
    ballast, sleepers, steel = track_parts(length, False, BALLAST_TOP)
    rail = Part(flat_material('railing-galvanised', (0.55, 0.57, 0.6), 0.45, 0.8))
    h = BALLAST_TOP
    x0, x1 = -length / 2, length / 2
    box(concrete, 0, 0, -1.3, length, 5.0, 1.0)
    for s in (-1, 1):
        box(concrete, 0, s * 2.65, -1.3, length, 0.3, 1.7)
        box(concrete, 0, s * 2.75, 0.4, length, 0.5, 0.15)
        box(concrete, 0, s * 2.95, -1.5, length, 0.14, 0.25)
        k_n = max(1, round(length / 1.25))
        for k in range(k_n):
            box(rail, x0 + (k + 0.5) * length / k_n, s * 2.85, 0.55, 0.06, 0.05, 1.0)
        box(rail, 0, s * 2.85, 1.5, length, 0.06, 0.05)
        box(rail, 0, s * 2.85, 1.0, length, 0.03, 0.04)
    box(ballast, 0, 0, -0.3, length, 5.0, 0.45)
    prism(ballast, [Vector((x0, -2.5, 0.15)), Vector((x0, 2.5, 0.15)), Vector((x0, 1.82, h - 0.03)), Vector((x0, 1.7, h)),
                    Vector((x0, -1.7, h)), Vector((x0, -1.82, h - 0.03))], Vector((length, 0, 0)))
    objects = [concrete.to_object(name), ballast.to_object(name + '-ballast'), sleepers.to_object(name + '-sleepers'),
               steel.to_object(name + '-rails'), rail.to_object(name + '-railing')]
    obj = bake_surface(name, without_undersides(objects[1:4]) and objects, size=1024 if length >= 10 else 512, samples=24, ao_distance=0.5)
    export_lod(name, obj, ratio=min(1.0, (90 if length >= 10 else 50) / max(1, len(obj.data.polygons))), textured=True)


def abutment(name, width=6.4, height=10.0, wing=6.0):
    """A bridge abutment, origin at its foot under the middle of its face, the face to -Y and the top at
    `height`: the wall with a bearing shelf and two bearings, the back wall rising behind them, wing walls
    running back into the embankment and falling with it (1:1.5), a cap on each"""
    clear_scene()
    concrete = Part(pbr_material('abutment-concrete', 'precast_concrete_wall', (0.86, 0.86, 0.84)), uv_metres=3.0, bevel=0.03)
    cap = Part(pbr_material('abutment-cap', 'brushed_concrete', (0.8, 0.8, 0.78)), uv_metres=2.0, bevel=0.02)
    bearing = Part(flat_material('bearing-steel', (0.25, 0.25, 0.26), 0.5, 0.7))
    w = width / 2
    shelf = height - 0.7
    box(concrete, 0, 0.7, 0, width - 1.2, 1.4, shelf)
    box(concrete, 0, 1.05, shelf, width - 1.2, 0.7, 0.7)
    for x in (-w * 0.5, w * 0.5):
        box(bearing, x, 0.35, shelf, 0.6, 0.45, 0.12)
    for s in (-1, 1):
        x = s * (w - 0.3)
        drop = wing / 1.5
        hexa(concrete, [Vector((x - 0.3, 0.0, 0)), Vector((x + 0.3, 0.0, 0)), Vector((x + 0.3, wing, 0)), Vector((x - 0.3, wing, 0))],
             [Vector((x - 0.3, 0.0, height)), Vector((x + 0.3, 0.0, height)), Vector((x + 0.3, wing, height - drop)),
              Vector((x - 0.3, wing, height - drop))])
        hexa(cap, [Vector((x - 0.38, -0.08, height)), Vector((x + 0.38, -0.08, height)), Vector((x + 0.38, wing, height - drop)),
                   Vector((x - 0.38, wing, height - drop))],
             [Vector((x - 0.38, -0.08, height + 0.15)), Vector((x + 0.38, -0.08, height + 0.15)),
              Vector((x + 0.38, wing, height - drop + 0.15)), Vector((x - 0.38, wing, height - drop + 0.15))])
    export(name, [concrete.to_object(name), cap.to_object(name + '-cap'), bearing.to_object(name + '-bearings')], lod=70)


def pier(name, width=4.6, height=12.0):
    """A bridge pier, origin at its foot: a wall pier with rounded ends (wide along X, across the bridge), a
    cap beam on top reaching past it to carry the deck, top at `height`"""
    clear_scene()
    concrete = Part(pbr_material('pier-concrete', 'precast_concrete_wall', (0.86, 0.86, 0.84)), uv_metres=3.0, bevel=0.03)
    cap = Part(pbr_material('pier-cap', 'brushed_concrete', (0.8, 0.8, 0.78)), uv_metres=2.0, bevel=0.03)
    r = 0.55
    body = height - 0.8
    box(concrete, 0, 0, 0, width - 2 * r, 2 * r, body)
    for s in (-1, 1):
        tube(concrete, [Vector((s * (width / 2 - r), 0, 0)), Vector((s * (width / 2 - r), 0, body))], [r, r], 12, cap=True)
    box(cap, 0, 0, body, width + 1.4, 1.6, 0.8)
    export(name, [concrete.to_object(name), cap.to_object(name + '-cap')], lod=80)


def platform(name, length=20.0, width=4.0, h=0.76):
    """Station platform along X, its edge to -Y: a concrete wall, paving on top, the white safety line and
    the tactile strip, a bench and a sign at the middle"""
    clear_scene()
    kit = Kit()
    wall = Part(pbr_material('platform-wall', 'brushed_concrete'), uv_metres=2.5, bevel=0.02)
    paving = Part(pbr_material('platform-paving', 'concrete_slab_wall', (0.95, 0.95, 0.95)), uv_metres=3.0, bevel=0.0)
    white = Part(flat_material('line-white', (0.85, 0.85, 0.82), 0.6))
    sign = Part(flat_material('sign-blue', (0.05, 0.15, 0.45), 0.4, 0.1))
    kit.extra += [wall, paving, white, sign]
    box(wall, 0, 0, -0.5, length, width, h + 0.4)
    box(paving, 0, 0.1, h - 0.1, length, width - 0.2, 0.1)
    box(wall, 0, -width / 2 + 0.15, h - 0.12, length, 0.3, 0.14)
    box(white, 0, -width / 2 + 0.5, h, length, 0.08, 0.01)
    box(white, 0, -width / 2 + 0.85, h, length, 0.3, 0.008)
    for x in (-length * 0.25, length * 0.25):
        box(kit.metal, x - 0.8, width * 0.2, h, 0.06, 0.4, 0.45)
        box(kit.metal, x + 0.8, width * 0.2, h, 0.06, 0.4, 0.45)
        box(kit.frames, x, width * 0.2, h + 0.45, 1.8, 0.45, 0.05)
    tube(kit.metal, [Vector((0, width * 0.3, h)), Vector((0, width * 0.3, h + 2.6))], [0.05, 0.05], 8)
    box(sign, 0, width * 0.3, h + 2.2, 2.0, 0.06, 0.45)
    export(name, kit.objects(name))


SUBWAY_DEPTH = 3.0
SUBWAY_RISE = SUBWAY_DEPTH / 18
SUBWAY_TREAD = 0.30


def subway_parts():
    """Concrete of the subway's descents: walls, coping and steps in brushed concrete (the walls lighter), the
    floor in slabs, galvanised steel for the rails"""
    wall = Part(pbr_material('subway-wall', 'brushed_concrete', (0.95, 0.95, 0.93)), uv_metres=3.0, bevel=0.015)
    trim = Part(pbr_material('subway-trim', 'brushed_concrete', (0.78, 0.78, 0.76)), uv_metres=2.0, bevel=0.015)
    floor = Part(pbr_material('subway-floor', 'concrete_slab_wall', (0.8, 0.8, 0.8)), uv_metres=2.5)
    steel = Part(flat_material('subway-steel', (0.6, 0.62, 0.63), 0.45, 0.8), smooth=True)
    return wall, trim, floor, steel


def subway_walls(wall, trim, length, width, top_at, foot=-SUBWAY_DEPTH - 0.2):
    """The side walls of a descent along +X from x 0 to `length`, `width` apart, their coping at `top_at`"""
    for s in (-1, 1):
        y = s * (width / 2 + 0.125)
        box(wall, length / 2, y, foot, length, 0.25, top_at - foot)
        box(trim, length / 2, y + s * 0.03, top_at, length + 0.02, 0.32, 0.08)


def subway_handrails(steel, points, width):
    """Handrails on both walls along `points` (x, z of the walking surface), 0.9 m above it, on brackets"""
    for s in (-1, 1):
        y = s * (width / 2 - 0.07)
        line = [Vector((x, y, z + 0.9)) for x, z in points]
        tube(steel, line, [0.025] * len(line), 6)
        for x, z in points:
            tube(steel, [Vector((x, y, z + 0.9)), Vector((x, y + s * 0.07, z + 0.9))], [0.012, 0.012], 4)


def subway_stairs(name, width=3.0):
    """Stairs down into a subway along +X, the top at the ground (z 0) at x 0: two flights of nine steps of
    SUBWAY_RISE with a landing between, walls either side up to the ground with a coping, handrails"""
    clear_scene()
    wall, trim, floor, steel = subway_parts()
    nosing = Part(flat_material('subway-nosing', (0.62, 0.6, 0.55), 0.6))
    foot = -SUBWAY_DEPTH - 0.2
    x = 0.0
    z = 0.0
    rails = [(0.0, 0.0)]
    for flight in range(2):
        for _ in range(9):
            z -= SUBWAY_RISE
            box(trim, x + SUBWAY_TREAD / 2, 0, foot, SUBWAY_TREAD, width, z - foot)
            box(nosing, x + 0.04, 0, z, 0.08, width - 0.02, 0.004)
            x += SUBWAY_TREAD
        rails.append((x, z))
        if flight == 0:
            box(floor, x + 0.75, 0, foot, 1.5, width, z - foot)
            x += 1.5
            rails.append((x, z))
    box(floor, x + 0.5, 0, foot, 1.0, width, z - foot)
    length = x + 1.0
    subway_walls(wall, trim, length, width, 0.1)
    subway_handrails(steel, rails, width)
    export(name, [wall.to_object(name), trim.to_object(name + '-steps'), floor.to_object(name + '-floor'),
                  nosing.to_object(name + '-nosing'), steel.to_object(name + '-rails')], lod=300)


def subway_ramp(name, length=20.0, width=3.0):
    """Ramp down into a subway along +X, from the ground at x 0 to SUBWAY_DEPTH at `length`, walls and
    handrails as the stairs have"""
    clear_scene()
    wall, trim, floor, steel = subway_parts()
    foot = -SUBWAY_DEPTH - 0.2
    steps = 8
    for k in range(steps):
        x0, x1 = k * length / steps, (k + 1) * length / steps
        z0, z1 = -SUBWAY_DEPTH * x0 / length, -SUBWAY_DEPTH * x1 / length
        floor.quad([Vector((x0, -width / 2, z0)), Vector((x1, -width / 2, z1)), Vector((x1, width / 2, z1)), Vector((x0, width / 2, z0))],
                   [(x0 / 2.5, 0), (x1 / 2.5, 0), (x1 / 2.5, width / 2.5), (x0 / 2.5, width / 2.5)])
    box(trim, length / 2, 0, foot, length, width, 0.05)
    subway_walls(wall, trim, length, width, 0.1)
    subway_handrails(steel, [(0.0, 0.0), (length / 2, -SUBWAY_DEPTH / 2), (length, -SUBWAY_DEPTH)], width)
    export(name, [wall.to_object(name), trim.to_object(name + '-trim'), floor.to_object(name + '-floor'),
                  steel.to_object(name + '-rails')])


def subway_entrance(name, width=5.0, opening=3.0, high=2.5, depth=4.0):
    """The head wall at the foot of a descent, its front to -X at x 0, the floor at z 0: a concrete wall up to
    the ground above (SUBWAY_DEPTH and its coping) with the subway's opening, inside tiled walls and ceiling
    and a slab floor going dark the further in, a black back"""
    clear_scene()
    wall, trim, floor, steel = subway_parts()
    tiles = Part(pbr_material('subway-tiles', 'rectangular_facade_tiles', (0.82, 0.84, 0.82)), uv_metres=2.0)
    shade = Part(flat_material('subway-shade', (0.09, 0.09, 0.085), 0.9))
    dark = Part(hole())
    top = SUBWAY_DEPTH + 0.1
    side = (width - opening) / 2
    for s in (-1, 1):
        box(wall, -0.2, s * (opening / 2 + side / 2), -0.2, 0.4, side, top + 0.2)
    box(wall, -0.2, 0, high, 0.4, opening, top - high)
    box(trim, -0.42, 0, high - 0.02, 0.06, opening + 0.3, 0.3)
    box(trim, -0.2, 0, top, 0.5, width + 0.02, 0.08)
    # Inside: lit near the mouth, dark further in
    lit = depth * 0.4
    for x0, x1, part in ((0.0, lit, tiles), (lit, depth, shade)):
        box(part, (x0 + x1) / 2, -opening / 2 - 0.05, 0, x1 - x0, 0.1, high)
        box(part, (x0 + x1) / 2, opening / 2 + 0.05, 0, x1 - x0, 0.1, high)
        box(part, (x0 + x1) / 2, 0, high, x1 - x0, opening, 0.1)
    box(floor, lit / 2, 0, -0.2, lit, opening, 0.2)
    box(shade, (lit + depth) / 2, 0, -0.2, depth - lit, opening, 0.2)
    box(dark, depth + 0.05, 0, -0.2, 0.1, opening + 0.2, high + 0.3)
    export(name, [wall.to_object(name), trim.to_object(name + '-trim'), floor.to_object(name + '-floor'),
                  tiles.to_object(name + '-tiles'), shade.to_object(name + '-shade'), dark.to_object(name + '-dark')])


def concrete_retaining_wall(name, length=6.0, height=3.0):
    """Retaining wall in concrete along X, the foot at z 0: plain face, a darker coping"""
    clear_scene()
    wall, trim, _, _ = subway_parts()
    box(wall, 0, 0, -0.5, length, 0.3, height + 0.5)
    box(trim, 0, 0, height, length + 0.02, 0.38, 0.08)
    export(name, [wall.to_object(name), trim.to_object(name + '-coping')])


def steel_railing(name, length=3.0):
    """Galvanised steel railing along X: posts at the ends and the middle, a handrail at 1.1 m and a knee rail"""
    clear_scene()
    _, _, _, steel = subway_parts()
    for x in (-length / 2 + 0.03, 0.0, length / 2 - 0.03):
        tube(steel, [Vector((x, 0, -0.1)), Vector((x, 0, 1.1))], [0.022, 0.022], 6)
    for z, r in ((1.1, 0.025), (0.55, 0.016), (0.12, 0.012)):
        tube(steel, [Vector((-length / 2, 0, z)), Vector((length / 2, 0, z))], [r, r], 6)
    export(name, [steel.to_object(name)])


def catenary_mast(name, height=7.6, reach=3.2):
    """Overhead line mast beside the track: an H-beam mast on a concrete footing, a cantilever over the
    track (+Y) with insulators, a stub of contact and messenger wire along X"""
    clear_scene()
    kit = Kit()
    steel = Part(flat_material('mast-steel', (0.42, 0.45, 0.43), 0.5, 0.7))
    insul = Part(flat_material('insulator', (0.45, 0.3, 0.2), 0.3, 0.1), smooth=True)
    wire = Part(flat_material('wire-copper', (0.25, 0.2, 0.15), 0.4, 0.8), smooth=True)
    kit.extra += [steel, insul, wire]
    box(kit.plinth, 0, 0, -0.8, 0.8, 0.8, 1.0)
    for s in (-1, 1):
        box(steel, s * 0.13, 0, 0.2, 0.03, 0.3, height)
    box(steel, 0, 0, 0.2, 0.26, 0.02, height)
    za, zb = height - 0.4, height - 1.7
    tube(steel, [Vector((0, 0.15, za)), Vector((0, reach + 0.5, za - 0.2))], [0.05, 0.05], 6)
    tube(steel, [Vector((0, 0.15, zb)), Vector((0, reach + 0.3, za - 0.25))], [0.04, 0.04], 6)
    for p in (Vector((0, 0.5, za)), Vector((0, 0.5, zb))):
        tube(insul, [p, p + Vector((0, 0.5, 0))], [0.09, 0.09], 8, cap=True)
    tube(steel, [Vector((0, reach, za - 0.2)), Vector((0, reach, za - 1.25))], [0.03, 0.03], 5)
    for z in (za - 0.15, za - 1.3):
        tube(wire, [Vector((-6, reach, z)), Vector((6, reach, z))], [0.02, 0.02], 4)
    export(name, kit.objects(name))


def buffer_stop(name):
    """End of a track: a short rail stub, a welded steel frame with a timber beam and a red-white board"""
    clear_scene()
    sleepers = Part(pbr_material('sleeper-concrete', 'brushed_concrete', (1.1, 1.1, 1.05)), uv_metres=1.0, bevel=0.01)
    steel = Part(steel_material())
    frame = Part(flat_material('stop-frame', (0.35, 0.12, 0.08), 0.6, 0.4))
    beam = Part(pbr_material('stop-beam', 'dark_planks'), uv_metres=1.0)
    red = Part(flat_material('board-red', (0.7, 0.05, 0.04), 0.5))
    white = Part(flat_material('board-white', (0.85, 0.85, 0.82), 0.5))
    rails(steel, sleepers, -3.0, 1.0)
    for s in (-1, 1):
        y = s * (GAUGE / 2 + 0.035)
        plank(frame, Vector((-1.5, y, 0.35)), Vector((0.4, y, 1.15)), 0.12, 0.12)
        box(frame, 0.4, y, 0.3, 0.14, 0.14, 0.95)
    box(beam, 0.3, 0, 0.75, 0.3, 2.6, 0.35)
    for i in range(5):
        box(red if i % 2 == 0 else white, 0.47, -1.0 + i * 0.5, 1.15, 0.04, 0.5, 0.5)
    export(name, [steel.to_object(name), sleepers.to_object(name + '-sleepers'), frame.to_object(name + '-frame'),
                  beam.to_object(name + '-beam'), red.to_object(name + '-red'), white.to_object(name + '-white')], lod=60)


def pylon(name, height=44.0, base_w=9.0, top_w=1.8, seed=0):
    """High-voltage pylon (Danube type): four tapering lattice legs, two cross-arm levels with insulator
    strings, an earth wire peak, concrete footings"""
    clear_scene()
    kit = Kit()
    steel = Part(flat_material('pylon-steel', (0.5, 0.53, 0.52), 0.5, 0.7))
    insul = Part(flat_material('insulator-glass', (0.35, 0.45, 0.4), 0.15, 0.2), smooth=True)
    kit.extra += [steel, insul]

    def half(z):
        t = min(1.0, z / (height * 0.68))
        return (base_w + (top_w - base_w) * t ** 0.8) / 2

    levels = [0.0, 5.0, 10.5, 15.5, 20.0, 24.0, 27.5, 30.0, 33.5, 37.0, 40.5, height]
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(kit.plinth, sx * half(0), sy * half(0), -0.8, 1.2, 1.2, 1.1)
            for z0, z1 in zip(levels, levels[1:]):
                plank(steel, Vector((sx * half(z0), sy * half(z0), z0)), Vector((sx * half(z1), sy * half(z1), z1)), 0.2, 0.2)
    for j, (z0, z1) in enumerate(zip(levels, levels[1:])):
        h0, h1 = half(z0), half(z1)
        for k in range(4):
            ang = k * math.pi / 2
            u = Vector((math.cos(ang), math.sin(ang), 0))
            n = Vector((math.sin(ang), -math.cos(ang), 0))
            a0, b0 = n * h0 - u * h0 + Vector((0, 0, z0)), n * h0 + u * h0 + Vector((0, 0, z0))
            a1, b1 = n * h1 - u * h1 + Vector((0, 0, z1)), n * h1 + u * h1 + Vector((0, 0, z1))
            plank(steel, a0, b1, 0.08, 0.08)
            plank(steel, b0, a1, 0.08, 0.08)
            plank(steel, a1, b1, 0.1, 0.1)
    for z, reach in ((30.0, 11.0), (37.0, 7.5)):
        hz = half(z)
        for s in (-1, 1):
            for sy in (-1, 1):
                plank(steel, Vector((s * hz, sy * hz, z)), Vector((s * reach, 0, z)), 0.12, 0.12)
                plank(steel, Vector((s * hz, sy * hz, z + 2.0)), Vector((s * reach, 0, z)), 0.08, 0.08)
            for x in (s * (reach - 0.3), s * (hz + (reach - hz) * 0.45)):
                tube(insul, [Vector((x, 0, z)), Vector((x, 0, z - 2.6))], [0.13, 0.13], 8)
                box(steel, x, 0, z - 2.8, 0.25, 0.4, 0.2)
    plank(steel, Vector((0, 0, height)), Vector((0, 0, height + 3.0)), 0.25, 0.25)
    export(name, kit.objects(name), lod=600)


def vine_row(name, length=10.0, seed=0):
    """Vineyard row along X: oak posts every 2.5 m, three wires, gnarled vine stocks with a leafy hedge
    trained along the wires"""
    clear_scene()
    rnd = random.Random(seed)
    wood = Part(pbr_material('post-oak', 'rough_wood', (0.75, 0.68, 0.58)), uv_metres=1.0)
    stock = Part(pbr_material('vine-bark', 'bark_brown_01', (0.8, 0.7, 0.6)))
    wire = Part(flat_material('wire-steel', (0.5, 0.5, 0.5), 0.4, 0.9), smooth=True)
    leaves = Part(card_material('vine', 'leaves-ivy.png'))
    n = int(length / 2.5)
    for i in range(n + 1):
        x = -length / 2 + i * length / n
        box(wood, x, 0, -0.4, 0.09, 0.09, 2.2)
    for z in (0.8, 1.25, 1.7):
        tube(wire, [Vector((-length / 2, 0, z)), Vector((length / 2, 0, z))], [0.008, 0.008], 3)
    for i in range(int(length / 1.1)):
        x = -length / 2 + 0.5 + i * 1.1 + rnd.uniform(-0.1, 0.1)
        tube(stock, [Vector((x, 0, -0.1)), Vector((x + rnd.uniform(-0.1, 0.1), rnd.uniform(-0.05, 0.05), 0.5)),
                     Vector((x + rnd.uniform(-0.15, 0.15), 0, 0.8))], [0.05, 0.04, 0.03], 5)
    centre = Vector((0, 0, 1.2))
    for k in range(int(length * 6)):
        x = rnd.uniform(-length / 2, length / 2)
        p = Vector((x, rnd.uniform(-0.2, 0.2), rnd.uniform(0.75, 1.75)))
        side = Vector((0, 1 if rnd.random() < 0.5 else -1, 0))
        d = Vector((rnd.uniform(-0.4, 0.4), side.y * 0.2, 1.0)).normalized()
        size = rnd.uniform(0.5, 0.75)
        card(leaves, p - d * size * 0.5, d, side, size, size, Vector((x, 0, centre.z)))
    export_plain(name, [wood.to_object(name + '-posts'), stock.to_object(name + '-stocks'), wire.to_object(name + '-wire'),
                        leaves.to_object(name + '-leaves')])


def swing(name):
    """Playground swing: two A-frames of round timber, a cross beam, two seats on chains"""
    clear_scene()
    wood = Part(pbr_material('playground-wood', 'rough_wood', (0.95, 0.8, 0.6)), smooth=True)
    steel = Part(flat_material('chain', (0.45, 0.46, 0.47), 0.4, 0.9), smooth=True)
    seat = Part(flat_material('seat-red', (0.65, 0.08, 0.06), 0.6))
    w, h = 3.4, 2.5
    for sx in (-1, 1):
        for sy in (-1, 1):
            tube(wood, [Vector((sx * w / 2, sy * 1.0, -0.3)), Vector((sx * w / 2, 0, h))], [0.07, 0.06], 8)
    tube(wood, [Vector((-w / 2 - 0.2, 0, h)), Vector((w / 2 + 0.2, 0, h))], [0.08, 0.08], 8)
    for x in (-0.8, 0.8):
        for s in (-1, 1):
            tube(steel, [Vector((x + s * 0.22, 0, h)), Vector((x + s * 0.22, 0, 0.5))], [0.012, 0.012], 4)
        box(seat, x, 0, 0.45, 0.5, 0.2, 0.05)
    export(name, [wood.to_object(name), steel.to_object(name + '-chains'), seat.to_object(name + '-seats')])


def slide(name):
    """Playground slide: a timber tower with a roof, a ladder up the back, a stainless chute down the front"""
    clear_scene()
    wood = Part(pbr_material('playground-wood', 'rough_wood', (0.95, 0.8, 0.6)), uv_metres=1.0)
    steel = Part(flat_material('chute-steel', (0.7, 0.72, 0.74), 0.2, 0.9))
    roof = Part(flat_material('roof-green', (0.12, 0.35, 0.15), 0.6))
    s, h = 1.4, 1.5
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(wood, sx * s / 2, sy * s / 2, -0.3, 0.1, 0.1, h + 1.8)
    box(wood, 0, 0, h, s + 0.1, s + 0.1, 0.06)
    for sx in (-1, 1):
        box(wood, sx * s / 2, 0, h + 0.5, 0.05, s, 0.08)
    box(wood, 0, s / 2, h + 0.5, s, 0.05, 0.08)
    prism(roof, [Vector((-s / 2 - 0.15, -s / 2 - 0.15, h + 1.5)), Vector((s / 2 + 0.15, -s / 2 - 0.15, h + 1.5)),
                 Vector((0, 0, h + 2.2))], Vector((0, s + 0.3, 0)))
    for sx in (-1, 1):
        plank(wood, Vector((sx * 0.25, s / 2 + 1.2, -0.1)), Vector((sx * 0.25, s / 2, h)), 0.05, 0.08)
    for k in range(5):
        t = (k + 0.5) / 5
        box(wood, 0, s / 2 + 1.2 * (1 - t), -0.1 + (h + 0.1) * t, 0.5, 0.05, 0.04)
    chute_len = 3.0
    a, b = Vector((0, -s / 2, h + 0.05)), Vector((0, -s / 2 - chute_len, 0.3))
    plank(steel, a, b, 0.6, 0.03)
    for sx in (-1, 1):
        plank(steel, a + Vector((sx * 0.3, 0, 0.12)), b + Vector((sx * 0.3, 0, 0.12)), 0.03, 0.25)
    export(name, [wood.to_object(name), steel.to_object(name + '-chute'), roof.to_object(name + '-roof')], lod=100)


def football_goal(name, w=7.32, h=2.44, depth=2.0):
    """Football goal: white posts and crossbar, the net held by back stanchions (front -Y)"""
    clear_scene()
    white = Part(flat_material('goal-white', (0.9, 0.9, 0.88), 0.4), smooth=True)
    # Cords a quarter of the mesh wide: the shared net card vanished a few metres off (blender_kit.net_material)
    net = Part(net_material('goal', (0.88, 0.88, 0.86), diamond=True))
    for sx in (-1, 1):
        tube(white, [Vector((sx * w / 2, 0, -0.2)), Vector((sx * w / 2, 0, h))], [0.06, 0.06], 8)
        tube(white, [Vector((sx * w / 2, depth, 0.0)), Vector((sx * w / 2, 0.6, h)), Vector((sx * w / 2, 0.0, h))], [0.025, 0.025, 0.025], 6)
    tube(white, [Vector((-w / 2, 0, h)), Vector((w / 2, 0, h))], [0.06, 0.06], 8)
    tube(white, [Vector((-w / 2, depth, 0.02)), Vector((w / 2, depth, 0.02))], [0.025, 0.025], 6)
    reps = 6.0
    net.quad([Vector((-w / 2, 0.6, h)), Vector((w / 2, 0.6, h)), Vector((w / 2, depth, 0.02)), Vector((-w / 2, depth, 0.02))],
             [(0, 0), (w / 1.2, 0), (w / 1.2, reps * 0.5), (0, reps * 0.5)])
    net.quad([Vector((-w / 2, 0.0, h)), Vector((w / 2, 0.0, h)), Vector((w / 2, 0.6, h)), Vector((-w / 2, 0.6, h))],
             [(0, 0), (w / 1.2, 0), (w / 1.2, 0.5), (0, 0.5)])
    for sx in (-1, 1):
        f = net.bm.faces.new([net.bm.verts.new(v) for v in (Vector((sx * w / 2, 0, 0)), Vector((sx * w / 2, depth, 0.02)),
                                                              Vector((sx * w / 2, 0.6, h)), Vector((sx * w / 2, 0, h)))])
        for loop in f.loops:
            loop[net.uv].uv = (loop.vert.co.y / 1.2, loop.vert.co.z / 1.2)
    export_plain(name, [white.to_object(name), net.to_object(name + '-net')])


def fountain(name, r=2.6, seed=0):
    """Town fountain: a round sandstone basin with a moulded rim, still water, a column with a bowl and a
    finial in the middle"""
    clear_scene()
    stone = Part(pbr_material('stone-sandstone-dress', 'sandstone_blocks_04', (1.0, 0.95, 0.85)), smooth=True)
    water = Part(flat_material('fountain-water', (0.16, 0.3, 0.32), 0.05, 0.2))
    sides = 20
    tube(stone, [Vector((0, 0, -0.3)), Vector((0, 0, 0.55))], [r, r], sides, smooth=False)
    tube(stone, [Vector((0, 0, 0.55)), Vector((0, 0, 0.7))], [r + 0.12, r + 0.12], sides, smooth=False)
    # Rim top as a ring, the inner face of the basin down to the water
    ring = [(math.cos(k / sides * math.tau), math.sin(k / sides * math.tau)) for k in range(sides)]
    for k in range(sides):
        (c0, s0), (c1, s1) = ring[k], ring[(k + 1) % sides]
        ro, ri = r + 0.12, r - 0.25
        stone.quad([Vector((c0 * ri, s0 * ri, 0.7)), Vector((c0 * ro, s0 * ro, 0.7)), Vector((c1 * ro, s1 * ro, 0.7)),
                    Vector((c1 * ri, s1 * ri, 0.7))], [(0, 0), (0.4, 0), (0.4, 0.8), (0, 0.8)])
        stone.quad([Vector((c0 * ri, s0 * ri, 0.4)), Vector((c0 * ri, s0 * ri, 0.7)), Vector((c1 * ri, s1 * ri, 0.7)),
                    Vector((c1 * ri, s1 * ri, 0.4))], [(0, 0), (0, 0.3), (0.8, 0.3), (0.8, 0)])
    disc = [water.bm.verts.new((math.cos(k / sides * math.tau) * (r - 0.25), math.sin(k / sides * math.tau) * (r - 0.25), 0.6))
            for k in range(sides)]
    water.bm.faces.new(disc)
    tube(stone, [Vector((0, 0, 0.5)), Vector((0, 0, 0.9)), Vector((0, 0, 1.8))], [0.45, 0.3, 0.25], 10)
    tube(stone, [Vector((0, 0, 1.8)), Vector((0, 0, 2.0)), Vector((0, 0, 2.2))], [0.25, 0.9, 0.95], 12, cap=True)
    tube(stone, [Vector((0, 0, 2.2)), Vector((0, 0, 2.7)), Vector((0, 0, 3.0))], [0.15, 0.2, 0.05], 8)
    export(name, [stone.to_object(name), water.to_object(name + '-water')])


def fruit_tree(name, seed=0):
    """Orchard tree: a short trunk and a low, wide crown of small light leaves (apple, pear, plum)"""
    broadleaf(name, seed, 5.5, 2.6, 0.16, 'bark_brown_01', 'leaves-bush')


def models():
    return {
        'rail-track': lambda: track('rail-track'),
        'rail-track-short': lambda: track('rail-track-short', length=2.5),
        'rail-track-wood': lambda: track('rail-track-wood', wood=True),
        'rail-track-wood-short': lambda: track('rail-track-wood-short', length=2.5, wood=True),
        'rail-crossing': lambda: level_crossing('rail-crossing'),
        'rail-street': lambda: street_track('rail-street'),
        'crossing-saltire': lambda: crossing_post('crossing-saltire'),
        'crossing-signal': lambda: crossing_post('crossing-signal', light=True),
        'crossing-barrier': lambda: crossing_barrier('crossing-barrier'),
        'rail-bridge': lambda: rail_bridge('rail-bridge'),
        'rail-bridge-short': lambda: rail_bridge('rail-bridge-short', length=2.5),
        'bridge-abutment': lambda: abutment('bridge-abutment'),
        'bridge-pier': lambda: pier('bridge-pier'),
        'rail-platform': lambda: platform('rail-platform'),
        'subway-stairs': lambda: subway_stairs('subway-stairs'),
        'subway-ramp': lambda: subway_ramp('subway-ramp'),
        'subway-entrance': lambda: subway_entrance('subway-entrance'),
        'retaining-wall-concrete': lambda: concrete_retaining_wall('retaining-wall-concrete'),
        'railing-steel': lambda: steel_railing('railing-steel'),
        'catenary-mast': lambda: catenary_mast('catenary-mast'),
        'buffer-stop': lambda: buffer_stop('buffer-stop'),
        'power-pylon': lambda: pylon('power-pylon'),
        'vine-row': lambda: vine_row('vine-row', seed=41),
        'fruit-tree': lambda: fruit_tree('fruit-tree', seed=42),
        'playground-swing': lambda: swing('playground-swing'),
        'playground-slide': lambda: slide('playground-slide'),
        'football-goal': lambda: football_goal('football-goal'),
        'fountain': lambda: fountain('fountain'),
        'greenhouse': lambda: greenhouse('greenhouse'),
        'kiosk': lambda: kiosk('kiosk'),
        'transformer-station': lambda: transformer('transformer-station'),
        'school': lambda: school('school', seed=31),
        'town-hall': lambda: town_hall('town-hall', seed=32),
        'town-church': lambda: town_church('town-church', seed=33),
        'station': lambda: station('station', seed=34),
        'parking-garage': lambda: parking_garage('parking-garage', seed=35),
        'office-mid': lambda: office('office-mid', 24.0, 14.0, 5, seed=21, lod=450),
        'office-high': lambda: office('office-high', 22.0, 18.0, 8, band_asset='concrete_slab_wall', band_tint=(1.1, 1.1, 1.1),
                                      seed=22, lod=550),
        'supermarket': lambda: hall('supermarket', 40.0, 26.0, 5.5, 'exterior_wall_cladding_03', shop=True),
        'hall-flat': lambda: hall('hall-flat', 30.0, 20.0, 6.5, 'exterior_wall_cladding_03', (0.85, 0.88, 0.9)),
        'industrial-hall': lambda: hall('industrial-hall', 60.0, 30.0, 9.0, 'box_profile_metal_sheet', (0.9, 0.95, 1.0), roof='gable',
                                        doors=3, annex=True, lod=400),
        'block-row-4': lambda: city_house('block-row-4', 15.0, 12.0, 4, OCHRE, seed=11),
        # Ends of a row where no house abuts (convert/buildings.ts rowEnds): the open side west, east, or both
        'block-row-4-end-w': lambda: city_house('block-row-4-end-w', 15.0, 12.0, 4, OCHRE, blank=(1,), seed=11),
        'block-row-4-end-e': lambda: city_house('block-row-4-end-e', 15.0, 12.0, 4, OCHRE, blank=(3,), seed=11),
        'block-row-4-ends': lambda: city_house('block-row-4-ends', 15.0, 12.0, 4, OCHRE, blank=(), seed=11),
        'block-row-6-end-w': lambda: city_house('block-row-6-end-w', 16.0, 13.0, 6, PALE_GREY, roof='flat', blank=(1,), seed=12, lod=1100),
        'block-row-6-end-e': lambda: city_house('block-row-6-end-e', 16.0, 13.0, 6, PALE_GREY, roof='flat', blank=(3,), seed=12, lod=1100),
        'block-row-6-ends': lambda: city_house('block-row-6-ends', 16.0, 13.0, 6, PALE_GREY, roof='flat', blank=(), seed=12, lod=1100),
        'block-row-6': lambda: city_house('block-row-6', 16.0, 13.0, 6, PALE_GREY, roof='flat', seed=12, lod=1100),
        'block-corner-4': lambda: city_house('block-corner-4', 14.0, 14.0, 4, ROSE, roof='hip', street=(0, 3), blank=(1, 2), seed=13),
        'block-corner-6': lambda: city_house('block-corner-6', 15.0, 15.0, 6, SAGE, roof='flat', street=(0, 3), blank=(1, 2), seed=14,
                                             lod=1100),
        'garage': lambda: garages('garage', 1, seed=6),
        'garage-row': lambda: garages('garage-row', 5, seed=7),
        'garden-shed': lambda: shed('garden-shed'),
        'carport': lambda: carport('carport'),
        'carport-double': lambda: carport('carport-double', bays=2),
        'station-canopy': lambda: station_canopy('station-canopy'),
        'house-modern': lambda: gabled_house('house-modern', [(10.0, WHITE)], 8.6, solar=0.7, seed=1),
        'house-modern-red': lambda: gabled_house('house-modern-red', [(9.0, CREAM)], 8.2, roof='red', pitch_deg=40, chimney=True,
                                                 seed=2),
        'house-semi': lambda: gabled_house('house-semi', [(7.0, WHITE), (7.0, SAND)], 9.0, roof='red', pitch_deg=38, seed=3),
        'house-terrace': lambda: gabled_house('house-terrace', [(6.0, PALE_GREY)], 10.0, pitch_deg=35, seed=4,
                                              row_ends=(False, False), lod=350),
        'house-terrace-end-w': lambda: gabled_house('house-terrace-end-w', [(6.0, PALE_GREY)], 10.0, pitch_deg=35, seed=4,
                                                    row_ends=(True, False), lod=350),
        'house-terrace-end-e': lambda: gabled_house('house-terrace-end-e', [(6.0, PALE_GREY)], 10.0, pitch_deg=35, seed=4,
                                                    row_ends=(False, True), lod=350),
        'house-terrace-ends': lambda: gabled_house('house-terrace-ends', [(6.0, PALE_GREY)], 10.0, pitch_deg=35, seed=4, lod=350),
        'house-terrace-row': lambda: gabled_house('house-terrace-row', [(6.0, WHITE), (6.0, CREAM), (6.0, PALE_GREY), (6.0, SAND)], 10.0,
                                                  pitch_deg=35, seed=5, lod=900),
    }
