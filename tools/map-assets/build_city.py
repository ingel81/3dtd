"""City and wasteland models of the map asset catalogue (loaded by build_models.py).

Modern and old blocks, shops, warehouse, containers, cars (whole, wrecked,
burnt), street furniture, a concrete road bridge; for the wasteland the
same pieces broken: ruined blocks and tower stumps, rubble with rebar,
barbed wire, barricades, tank traps, toxic barrels. Built from Poly Haven
textures (brick, concrete, corrugated iron, container, rusty metal) and
drawn cards (chain-link, hazard stripes); some Poly Haven street props.
"""
import math
import random

from mathutils import Vector

import bpy

from blender_kit import (
    Part, bake_ao, box, card_material, clear_scene, export, export_lod, flat_material, hexa, image_material, import_model,
    oriented_box, pbr_material, tilt, tube,
)
import blender_kit
from build_structures import cone_roof, gable_roof

FOUNDATION = 1.0


def glass():
    return flat_material('window-glass', (0.07, 0.09, 0.11), 0.08, 0.7)


def hole():
    return flat_material('window-hole', (0.025, 0.022, 0.02), 0.95)


class Face:
    """One wall of a box building: u runs along the wall (left to right seen from outside), n points out"""

    def __init__(self, k, w, d):
        # k: 0 front (-Y), 1 east (+X), 2 back (+Y), 3 west (-X)
        self.angle = k * math.pi / 2
        self.u = Vector((math.cos(self.angle), math.sin(self.angle), 0))
        self.n = Vector((math.sin(self.angle), -math.cos(self.angle), 0))
        self.length = w if k % 2 == 0 else d
        self.depth = d if k % 2 == 0 else w
        self.k = k

    def box(self, part, u, n, z, su, sn, sz):
        """Box centred at u along the wall, n out from the wall plane (0 = facade surface)"""
        c = self.u * u + self.n * (self.depth / 2 + n)
        box(part, c.x, c.y, z, su, sn, sz, self.angle)


class Kit:
    """Parts of a facade build: walls (bevelled), trim (bevelled), frames, glass, dark (holes, doors), extras"""

    def __init__(self, wall_asset, wall_tint=None, trim_asset='brushed_concrete', trim_tint=None, frame=(0.85, 0.85, 0.82),
                 broken=False, uv=3.0, bevel=0.03):
        self.walls = Part(pbr_material('wall-' + wall_asset + ('-t' if wall_tint else ''), wall_asset, wall_tint), uv_metres=uv, bevel=bevel)
        self.trim = Part(pbr_material('trim-' + trim_asset + ('-t' if trim_tint else ''), trim_asset, trim_tint), uv_metres=2.0, bevel=0.025)
        self.frames = Part(flat_material('frame-' + '-'.join('%.2f' % c for c in frame), frame, 0.5, 0.2))
        self.glass = Part(glass() if not broken else hole())
        self.dark = Part(hole())
        self.metal = Part(flat_material('roof-metal', (0.42, 0.43, 0.44), 0.45, 0.7), smooth=True)
        self.soot = Part(flat_material('soot', (0.03, 0.025, 0.02), 0.95)) if broken else None

    def objects(self, name):
        parts = [(self.walls, ''), (self.trim, '-trim'), (self.frames, '-frames'), (self.glass, '-glass'), (self.dark, '-dark'),
                 (self.metal, '-metal')]
        if self.soot:
            parts.append((self.soot, '-soot'))
        return [p.to_object(name + suffix) for p, suffix in parts if p.bm.faces]


def facade(kit, face, z0, floors, fh, bays, win_w, win_h, sill_h, reveal=0.18, style='modern', door_bay=None, damage=None, rnd=None,
           transom=True):
    """Window bays on one wall: piers between bays and bands between storeys built around real openings,
    a recessed frame and pane, a sill (and a lintel for old buildings). `damage(b, f)` -> True hides the bay
    (broken off); broken glass comes from the kit"""
    L = face.length
    bw = L / bays
    t = 0.35
    for b in range(bays + 1):
        u = -L / 2 + b * bw
        top = z0 + floors * fh
        if damage:
            top = min(top, damage(b, None))
        if top > z0:
            face.box(kit.walls, u, -t / 2, z0, (bw - win_w) if 0 < b < bays else (bw - win_w) / 2 + 0.3, t, top - z0)
    for b in range(bays):
        u = -L / 2 + (b + 0.5) * bw
        for f in range(floors):
            zf = z0 + f * fh
            if damage and damage(b, f):
                continue
            wz = zf + sill_h
            # Band below the window (sill height) and above it (lintel to the next floor)
            face.box(kit.walls, u, -t / 2, zf, win_w + 0.02, t, sill_h)
            face.box(kit.walls, u, -t / 2, wz + win_h, win_w + 0.02, t, fh - sill_h - win_h)
            is_door = door_bay is not None and b == door_bay and f == 0
            if is_door:
                face.box(kit.dark, u, -reveal - 0.05, zf, win_w, 0.1, fh - 0.4)
                face.box(kit.frames, u, -reveal + 0.02, zf + fh - 0.45, win_w + 0.1, 0.08, 0.1)
                continue
            # Reveal: frame plate set back, pane inside, mullion
            face.box(kit.frames, u, -reveal, wz, win_w, 0.06, win_h)
            face.box(kit.glass, u, -reveal + 0.035, wz + 0.06, win_w - 0.12, 0.02, win_h - 0.12)
            face.box(kit.frames, u, -reveal + 0.05, wz + 0.04, 0.05, 0.03, win_h - 0.08)
            if transom and win_h > 1.3:
                face.box(kit.frames, u, -reveal + 0.05, wz + win_h * 0.62, win_w - 0.1, 0.03, 0.05)
            face.box(kit.trim, u, 0.04, wz - 0.06, win_w + 0.16, 0.16, 0.07)
            if style == 'old':
                face.box(kit.trim, u, 0.03, wz + win_h, win_w + 0.3, 0.1, 0.22)
            if kit.soot and rnd and rnd.random() < 0.3:
                face.box(kit.soot, u, 0.012, wz + win_h + 0.02, win_w * 0.9, 0.01, 0.9)


def cornice(part, w, d, z, steps=((0.15, 0.2), (0.32, 0.12), (0.45, 0.14))):
    """Stepped cornice around the top of a box w x d"""
    for out, h in steps:
        box(part, 0, 0, z, w + 2 * out, d + 2 * out, h)
        z += h


def roof_units(kit, w, d, z, rnd, water_tank=False):
    """Plant on a flat roof: stair house, air conditioners, vent pipes, optionally a water tank on legs"""
    box(kit.trim, -w * 0.25, d * 0.15, z, 2.6, 2.2, 2.4)
    box(kit.dark, -w * 0.25, d * 0.15 - 1.11, z, 0.9, 0.04, 2.0)
    for k in range(3):
        x, y = rnd.uniform(-w / 2 + 1.5, w / 2 - 1.5), rnd.uniform(-d / 2 + 1.2, d / 2 - 1.2)
        box(kit.metal, x, y, z, 1.2, 0.8, 0.9, rnd.choice((0, math.pi / 2)))
        tube(kit.metal, [Vector((x, y, z + 0.9)), Vector((x, y, z + 0.95))], [0.3, 0.3], 10, cap=True)
    for k in range(4):
        x, y = rnd.uniform(-w / 2 + 1, w / 2 - 1), rnd.uniform(-d / 2 + 1, d / 2 - 1)
        tube(kit.metal, [Vector((x, y, z)), Vector((x, y, z + 0.9))], [0.1, 0.1], 8, cap=True)
    if water_tank:
        x, y = w * 0.22, -d * 0.12
        for sx in (-1, 1):
            for sy in (-1, 1):
                box(kit.metal, x + sx * 0.9, y + sy * 0.9, z, 0.15, 0.15, 2.0)
        tube(kit.trim, [Vector((x, y, z + 2.0)), Vector((x, y, z + 4.4))], [1.35, 1.25], 14, cap=True)
        cone_roof(kit.metal, x, y, z + 4.4, 1.4, 0.8, 14)


def balconies(kit, face, z0, floors, fh, bays, every=1):
    """Concrete slabs with metal railings in front of every `every`-th bay from the first floor up"""
    L = face.length
    bw = L / bays
    for b in range(0, bays, every):
        u = -L / 2 + (b + 0.5) * bw
        for f in range(1, floors):
            z = z0 + f * fh
            face.box(kit.trim, u, 0.6, z - 0.15, bw * 0.8, 1.2, 0.15)
            face.box(kit.metal, u, 1.15, z, bw * 0.8, 0.05, 1.0)
            for s in (-1, 1):
                face.box(kit.metal, u + s * bw * 0.4, 0.6, z, 0.05, 1.15, 1.0)
            for k in range(7):
                face.box(kit.metal, u - bw * 0.36 + k * bw * 0.12, 1.15, z, 0.03, 0.03, 0.95)


def fire_escape(kit, face, z0, floors, fh, u0, width=3.2):
    """Steel fire escape: landings on every floor, a railing, stairs between the landings"""
    for f in range(1, floors):
        z = z0 + f * fh
        face.box(kit.metal, u0, 0.75, z - 0.1, width, 1.3, 0.08)
        face.box(kit.metal, u0, 1.38, z, width, 0.04, 1.0)
        face.box(kit.metal, u0, 1.38, z + 0.95, width, 0.06, 0.06)
        for s in (-1, 1):
            face.box(kit.metal, u0 + s * width / 2, 0.75, z, 0.05, 1.3, 1.0)
        if f < floors - 1:
            a = face.u * (u0 - width / 2 + 0.3) + face.n * (face.depth / 2 + 0.75) + Vector((0, 0, z))
            b = face.u * (u0 + width / 2 - 0.3) + face.n * (face.depth / 2 + 0.75) + Vector((0, 0, z + fh))
            oriented_box(kit.metal, a, b, 0.12)
    # Bracket rails down to the first landing
    for s in (-1, 1):
        a = face.u * (u0 + s * width / 2) + face.n * (face.depth / 2 + 0.05) + Vector((0, 0, z0 + fh - 0.1))
        oriented_box(kit.metal, a, a + face.n * 1.3, 0.06)


def entrance(kit, face, z0, u, w=2.2):
    """Recessed entrance with a canopy slab on two brackets and steps"""
    face.box(kit.trim, u, 0.9, z0 + 2.9, w + 1.0, 1.8, 0.18)
    for s in (-1, 1):
        a = face.u * (u + s * (w / 2 + 0.3)) + face.n * (face.depth / 2) + Vector((0, 0, z0 + 2.4))
        oriented_box(kit.metal, a, a + face.n * 1.6 + Vector((0, 0, 0.5)), 0.06)
    for k in range(2):
        face.box(kit.trim, u, 0.25 + k * 0.3, z0 - 0.3 - k * 0.15, w + 0.8 - k * 0.3, 0.5, 0.3)


def city_block(name, style='modern', floors=4, w=14.0, d=10.0, ruined=False, seed=0, shopfront=False):
    """City building with real window reveals, frames and sills, storey bands, cornice or parapet, roof plant,
    an entrance with canopy; modern: concrete with balconies on the front; old: brick with stone dressings
    and a fire escape on one side. `ruined`: upper storeys broken off bay by bay, glass gone, soot and rubble.
    Ambient occlusion is baked into a second UV map."""
    clear_scene()
    rnd = random.Random(seed)
    tall = floors > 6
    if style == 'modern':
        # Tall blocks: no chamfer on the wall bands and no transoms, to stay near the building budget
        kit = Kit('concrete_slab_wall', (1.05, 1.05, 1.02), 'brushed_concrete', None, (0.75, 0.76, 0.76), broken=ruined,
                  bevel=0.0 if tall else 0.03)
        fh, win_w, win_h, sill = 3.0, 1.6, 1.5, 0.9
    else:
        kit = Kit('brick_wall_07', None, 'brushed_concrete', (1.12, 1.05, 0.92), (0.88, 0.86, 0.8), broken=ruined, uv=2.4)
        fh, win_w, win_h, sill = 3.3, 1.1, 1.8, 0.9
    h = floors * fh
    bays_w = max(2, int(w // (3.2 if tall else 2.6)))
    bays_d = max(2, int(d // (3.2 if tall else 2.6)))
    z0 = 0.6
    box(kit.trim, 0, 0, -FOUNDATION, w + 0.25, d + 0.25, FOUNDATION + z0)
    tops = {}

    def damage_of(k):
        """Ruins: each bay column of each wall breaks off at its own height"""
        if not ruined:
            return None

        def dmg(b, f):
            if (k, b) not in tops:
                tops[(k, b)] = z0 + fh * (0.8 + rnd.uniform(0.6, 1.0) * floors * abs(math.sin(b * 1.3 + seed + k)))
            if f is None:
                return tops[(k, b)]
            return z0 + (f + 1) * fh > tops[(k, b)]
        return dmg

    for k in range(4):
        face = Face(k, w, d)
        bays = bays_w if k % 2 == 0 else bays_d
        door = bays // 2 if k == 0 else None
        dmg = damage_of(k)
        if shopfront and k == 0 and not ruined:
            # Ground floor: shop windows between stone piers, a fascia board
            bw = face.length / bays
            for b in range(bays):
                u = -face.length / 2 + (b + 0.5) * bw
                if b == door:
                    face.box(kit.dark, u, -0.3, z0, bw - 0.9, 0.1, 2.6)
                else:
                    face.box(kit.glass, u, -0.25, z0 + 0.5, bw - 0.7, 0.05, 2.3)
                    face.box(kit.frames, u, -0.28, z0 + 0.4, bw - 0.6, 0.1, 0.12)
                face.box(kit.trim, u - bw / 2, -0.15, z0, 0.5, 0.4, 3.0)
            face.box(kit.trim, 0, 0.05, z0 + 2.95, face.length + 0.1, 0.25, 0.6)
            facade(kit, face, z0 + fh, floors - 1, fh, bays, win_w, win_h, sill, style=style)
        else:
            facade(kit, face, z0, floors, fh, bays, win_w, win_h, sill, style=style, door_bay=door, damage=dmg, rnd=rnd,
                   transom=not tall)
        if k == 0 and not ruined and not shopfront:
            entrance(kit, face, z0, -face.length / 2 + (door + 0.5) * face.length / bays)
        if k == 0 and style == 'modern' and not ruined:
            balconies(kit, face, z0, floors, fh, bays, every=2)
        if k == 1 and style == 'old' and floors > 1:
            fire_escape(kit, face, z0, floors, fh, face.length * 0.1)
    if not ruined:
        # Floor slabs behind the facade close the box; roof with parapet or cornice
        box(kit.walls, 0, 0, z0 + h - 0.3, w - 0.5, d - 0.5, 0.3)
        if style == 'modern':
            box(kit.trim, 0, 0, z0 + h, w + 0.1, d + 0.1, 0.25)
            for side in range(4):
                face = Face(side, w, d)
                face.box(kit.trim, 0, -0.1, z0 + h + 0.25, face.length + 0.1, 0.25, 0.7)
        else:
            cornice(kit.trim, w, d, z0 + h)
        roof_units(kit, w * 0.85, d * 0.8, z0 + h + 0.25, rnd, water_tank=style == 'old')
        # Inner box so the building is closed behind the windows
        box(kit.dark, 0, 0, z0, w - 0.9, d - 0.9, h - 0.4)
    else:
        for f in range(1, floors):
            span = w * rnd.uniform(0.3, 0.85)
            box(kit.trim, -w / 2 + span / 2 + 0.2, rnd.uniform(-0.6, 0.6), z0 + f * fh - 0.25, span, d - 0.8, 0.25, rnd.uniform(-0.05, 0.05))
        box(kit.dark, 0, 0, z0, w - 0.9, d - 0.9, fh * 0.9)
        rubble = kit.walls
        for k in range(22):
            a = rnd.uniform(0, math.tau)
            r = rnd.uniform(0.55, 1.05)
            box(rubble, math.cos(a) * (w / 2 + 1.6) * r, math.sin(a) * (d / 2 + 1.6) * r, -0.3, rnd.uniform(0.4, 1.4),
                rnd.uniform(0.3, 1.0), rnd.uniform(0.2, 0.7), rnd.uniform(0, 3))
    objects = kit.objects(name)
    joined = bake_ao(name, objects, size=1024 if floors > 4 else 512)
    export(name, [joined])
    export_lod(name, joined)


def shop(name):
    city_block(name, style='old', floors=1, w=9.0, d=7.0, shopfront=True, seed=11)


def tower_stump(name, seed=0):
    """Broken high-rise: concrete frame 8 storeys of columns and slabs, the top torn off, rebar sticking out"""
    clear_scene()
    rnd = random.Random(seed)
    concrete = Part(pbr_material('wall-concrete_floor_damaged_01', 'concrete_floor_damaged_01'), uv_metres=3.0)
    facade = Part(pbr_material('wall-rectangular_facade_tiles', 'rectangular_facade_tiles', (0.8, 0.8, 0.8)), uv_metres=3.0)
    rebar = Part(flat_material('rebar', (0.2, 0.1, 0.05), 0.7, 0.6))
    s, fh = 16.0, 3.4
    box(concrete, 0, 0, -FOUNDATION, s + 0.4, s + 0.4, FOUNDATION + 0.5)
    for i in range(4):
        for j in range(4):
            x, y = -s / 2 + 1 + i * (s - 2) / 3, -s / 2 + 1 + j * (s - 2) / 3
            h = fh * (4 + 5 * abs(math.sin(i * 1.3 + j * 0.7 + seed))) * rnd.uniform(0.85, 1.05)
            box(concrete, x, y, 0, 0.8, 0.8, h)
            for k in range(3):
                a = Vector((x + rnd.uniform(-0.3, 0.3), y + rnd.uniform(-0.3, 0.3), h))
                oriented_box(rebar, a, a + Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(0.6, 1.6))), 0.05)
    for f in range(1, 9):
        z = f * fh
        frac = max(0.0, 1 - f / 9) * rnd.uniform(0.6, 1.1)
        if frac <= 0.1:
            continue
        sx = s * min(1.0, frac + 0.3)
        box(concrete, -s / 2 + sx / 2, rnd.uniform(-1, 1), z - 0.3, sx, s - rnd.uniform(0, 4), 0.3, rnd.uniform(-0.03, 0.03))
        if f < 5:
            for side in (-1, 1):
                box(facade, -s / 2 + sx / 2, side * (s / 2 + 0.1), z - fh + 0.9, sx * rnd.uniform(0.4, 0.9), 0.2, 1.0)
    export(name, [concrete.to_object(name), facade.to_object(name + '-facade'), rebar.to_object(name + '-rebar')])


def warehouse(name, rusty=False):
    """Steel shed: corrugated walls and shallow roof, a roller door and a side door (front -Y)"""
    clear_scene()
    asset = 'corrugated_iron_02' if not rusty else 'rusty_metal_03'
    sheet = Part(pbr_material('metal-' + asset, asset, (0.95, 0.95, 0.95) if not rusty else None), uv_metres=3.0)
    trim = Part(pbr_material('wall-brushed_concrete', 'brushed_concrete'), uv_metres=2.0)
    door = Part(pbr_material('metal-painted_metal_shutter', 'painted_metal_shutter'), uv_metres=3.0)
    w, d, h = 18.0, 12.0, 6.0
    box(trim, 0, 0, -FOUNDATION, w + 0.2, d + 0.2, FOUNDATION + 0.4)
    box(sheet, 0, 0, 0.4, w, d, h - 0.4)
    pitch = 1.6
    for sx in (-1, 1):
        x = sx * w / 2
        bm = sheet.bm
        tri = [bm.verts.new((x, -d / 2, h)), bm.verts.new((x, d / 2, h)), bm.verts.new((x, 0, h + pitch))]
        bm.faces.new(tri if sx > 0 else list(reversed(tri)))
    roof = Part(pbr_material('metal-' + asset + '-roof', asset, (0.8, 0.8, 0.8) if not rusty else None))
    gable_roof(roof, w, d, h, pitch, 0.3)
    box(door, -2.5, -d / 2 - 0.05, 0.4, 5.0, 0.1, 4.4)
    box(door, 5.5, -d / 2 - 0.05, 0.4, 1.1, 0.1, 2.2)
    export(name, [sheet.to_object(name), roof.to_object(name + '-roof'), trim.to_object(name + '-base'), door.to_object(name + '-doors')])


def container(name, tint, rusty=False):
    """Shipping container 6.1 x 2.44 x 2.6 m along X"""
    clear_scene()
    asset = 'container_side' if not rusty else 'rusty_metal_03'
    body = Part(pbr_material('metal-' + asset + '-' + '-'.join('%.2f' % c for c in tint), asset, tint), uv_metres=2.6)
    frame = Part(flat_material('container-frame', tuple(c * 0.08 for c in tint), 0.6, 0.5))
    box(body, 0, 0, 0.1, 6.06, 2.44, 2.5)
    for x in (-3.0, 3.0):
        for y in (-1.17, 1.17):
            box(frame, x, y, 0, 0.16, 0.16, 2.6)
    for z in (0.0, 2.48):
        for y in (-1.17, 1.17):
            box(frame, 0, y, z, 6.1, 0.14, 0.14)
    export(name, [body.to_object(name), frame.to_object(name + '-frame')])


# ---------------------------------------------------------------- cars

def car(name, paint, state='whole', seed=0):
    """Compact car along Y (front -Y): body, cabin with glass, wheels; `wreck` rusty without glass and
    sagging on flat tyres, `burnt` charred, on its rims"""
    clear_scene()
    rnd = random.Random(seed)
    if state == 'whole':
        body = Part(flat_material('paint-' + '-'.join('%.2f' % c for c in paint), paint, 0.35, 0.3), smooth=False)
    elif state == 'wreck':
        body = Part(pbr_material('metal-rusty_metal_03-car', 'rusty_metal_03', (0.6, 0.52, 0.48)), uv_metres=1.5)
    else:
        body = Part(pbr_material('metal-burnt', 'rusty_metal_03', (0.3, 0.24, 0.22)), uv_metres=1.5)
    win = Part(glass() if state == 'whole' else flat_material('car-hole', (0.02, 0.02, 0.02), 0.95))
    tyre = Part(flat_material('tyre', (0.04, 0.04, 0.04), 0.9), smooth=True)
    rim = Part(flat_material('rim', (0.5, 0.5, 0.52), 0.4, 0.8))
    L, W = 4.2, 1.76
    z0 = 0.32
    # Lower body with sloped nose and tail
    hexa(body, [(-W / 2, -L / 2, z0), (W / 2, -L / 2, z0), (W / 2, L / 2, z0), (-W / 2, L / 2, z0)],
         [(-W / 2, -L / 2 + 0.15, z0 + 0.55), (W / 2, -L / 2 + 0.15, z0 + 0.55), (W / 2, L / 2 - 0.1, z0 + 0.62),
          (-W / 2, L / 2 - 0.1, z0 + 0.62)])
    # Cabin
    cz = z0 + 0.6
    bottom = [(-W / 2 + 0.05, -0.65, cz), (W / 2 - 0.05, -0.65, cz), (W / 2 - 0.05, 1.45, cz), (-W / 2 + 0.05, 1.45, cz)]
    top = [(-W / 2 + 0.2, -0.05, cz + 0.62), (W / 2 - 0.2, -0.05, cz + 0.62), (W / 2 - 0.2, 1.2, cz + 0.62), (-W / 2 + 0.2, 1.2, cz + 0.62)]
    hexa(body, bottom, top)
    # Glass slightly outside the cabin faces
    hexa(win, [(-W / 2 + 0.03, -0.6, cz + 0.05), (W / 2 - 0.03, -0.6, cz + 0.05), (W / 2 - 0.03, 1.42, cz + 0.05),
               (-W / 2 + 0.03, 1.42, cz + 0.05)],
         [(-W / 2 + 0.18, -0.08, cz + 0.57), (W / 2 - 0.18, -0.08, cz + 0.57), (W / 2 - 0.18, 1.17, cz + 0.57),
          (-W / 2 + 0.18, 1.17, cz + 0.57)])
    for y in (-1.3, 1.35):
        for sx in (-1, 1):
            x = sx * (W / 2 - 0.12)
            flat = state != 'whole'
            r = 0.32 if not flat else 0.26
            if state != 'burnt':
                tube(tyre, [Vector((x - 0.12, y, 0.32)), Vector((x + 0.12, y, 0.32))], [r, r], 14, cap=True)
                tube(tyre, [Vector((x + 0.12, y, 0.32)), Vector((x - 0.12, y, 0.32))], [r, r], 14, cap=True)
            tube(rim, [Vector((x - 0.13 * sx, y, 0.32)), Vector((x + 0.13 * sx, y, 0.32))], [0.2, 0.2], 10, cap=True)
    if state == 'whole':
        lights = Part(flat_material('headlight', (1.0, 0.95, 0.8), 0.2, emission=(1.0, 0.95, 0.8), strength=0.4))
        tail = Part(flat_material('taillight', (0.6, 0.05, 0.04), 0.3, emission=(0.8, 0.05, 0.03), strength=0.3))
        for sx in (-1, 1):
            box(lights, sx * 0.6, -L / 2 - 0.01, z0 + 0.35, 0.3, 0.05, 0.12)
            box(tail, sx * 0.65, L / 2 + 0.01, z0 + 0.4, 0.3, 0.05, 0.12)
        objects = [body.to_object(name), win.to_object(name + '-glass'), tyre.to_object(name + '-tyres'),
                   rim.to_object(name + '-rims'), lights.to_object(name + '-lights'), tail.to_object(name + '-tail')]
        export(name, objects)
        return
    objects = [body.to_object(name), win.to_object(name + '-holes'), tyre.to_object(name + '-tyres'), rim.to_object(name + '-rims')]
    tilt(objects, x=rnd.uniform(-2, 2), y=rnd.uniform(3, 6), z=rnd.uniform(-8, 8), lift=-0.08)
    export(name, objects)


def bus_wreck(name):
    clear_scene()
    body = Part(pbr_material('metal-rusty_metal_03-bus', 'rusty_metal_03', (0.55, 0.55, 0.58)), uv_metres=2.0)
    holes = Part(flat_material('car-hole', (0.02, 0.02, 0.02), 0.95))
    L, W, H = 11.0, 2.5, 2.9
    box(body, 0, 0, 0.3, W, L, H)
    for side in (-1, 1):
        for k in range(8):
            y = -L / 2 + 1.0 + k * 1.3
            box(holes, side * (W / 2 + 0.02), y, 1.6, 0.08, 1.0, 1.0)
    box(holes, 0, -L / 2 - 0.02, 1.4, 2.1, 0.08, 1.2)
    objects = [body.to_object(name), holes.to_object(name + '-holes')]
    tilt(objects, x=1.5, y=4, z=6, lift=-0.2)
    export(name, objects)


# ---------------------------------------------------------------- street furniture

def traffic_light(name):
    clear_scene()
    metal = Part(flat_material('pole-grey', (0.25, 0.26, 0.27), 0.5, 0.6), smooth=True)
    housing = Part(flat_material('signal-housing', (0.05, 0.05, 0.05), 0.6, 0.3))
    red = Part(flat_material('signal-red', (0.8, 0.05, 0.03), 0.3, emission=(1.0, 0.08, 0.04), strength=0.8))
    amber = Part(flat_material('signal-amber', (0.3, 0.2, 0.02), 0.3))
    green = Part(flat_material('signal-green', (0.05, 0.2, 0.08), 0.3))
    tube(metal, [Vector((0, 0, -0.5)), Vector((0, 0, 4.5))], [0.08, 0.07], 8)
    oriented_box(metal, Vector((0, 0, 4.3)), Vector((0, -3.0, 4.6)), 0.08)
    for x, y, z in ((0, -0.15, 2.4), (0, -3.0, 4.0)):
        box(housing, x, y - 0.1, z, 0.36, 0.28, 1.05)
        box(red, x, y - 0.26, z + 0.75, 0.22, 0.05, 0.22)
        box(amber, x, y - 0.26, z + 0.43, 0.22, 0.05, 0.22)
        box(green, x, y - 0.26, z + 0.11, 0.22, 0.05, 0.22)
    export(name, [metal.to_object(name), housing.to_object(name + '-housing'), red.to_object(name + '-red'),
                  amber.to_object(name + '-amber'), green.to_object(name + '-green')])


def bench(name):
    clear_scene()
    wood = Part(pbr_material('planks-crate', 'brown_planks_04'), uv_metres=1.0)
    iron = Part(flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8))
    for x in (-0.8, 0.8):
        box(iron, x, 0, 0, 0.06, 0.5, 0.45)
        oriented_box(iron, Vector((x, 0.22, 0.45)), Vector((x, 0.3, 0.85)), 0.05)
    for k in range(4):
        box(wood, 0, -0.2 + k * 0.13, 0.45, 1.9, 0.1, 0.04)
    for k in range(3):
        oriented_box(wood, Vector((-0.95, 0.26 + k * 0.02, 0.55 + k * 0.12)), Vector((0.95, 0.26 + k * 0.02, 0.55 + k * 0.12)), 0.08)
    export(name, [wood.to_object(name), iron.to_object(name + '-iron')])


def bus_stop(name):
    clear_scene()
    metal = Part(flat_material('pole-grey', (0.25, 0.26, 0.27), 0.5, 0.6))
    pane = Part(flat_material('shelter-glass', (0.35, 0.42, 0.45), 0.1, 0.3))
    for x in (-1.8, 1.8):
        for y in (-0.6, 0.6):
            box(metal, x, y, 0, 0.08, 0.08, 2.5)
    box(metal, 0, 0, 2.5, 3.9, 1.6, 0.1)
    box(pane, 0, 0.62, 0.3, 3.5, 0.03, 2.0)
    box(pane, -1.82, 0, 0.3, 0.03, 1.1, 2.0)
    export(name, [metal.to_object(name), pane.to_object(name + '-glass')])


def chainlink_fence(name, length=4.0, height=2.2, barbed=False):
    """Chain-link panel along X between two posts; `barbed`: three strands of wire on an outrigger"""
    clear_scene()
    posts = Part(flat_material('galvanised', (0.45, 0.46, 0.45), 0.4, 0.8), smooth=True)
    mesh = Part(card_material('chainlink', 'chainlink.png'))
    for x in (-length / 2, length / 2):
        tube(posts, [Vector((x, 0, -0.6)), Vector((x, 0, height + (0.5 if barbed else 0)))], [0.04, 0.04], 6)
    tube(posts, [Vector((-length / 2, 0, height)), Vector((length / 2, 0, height))], [0.025, 0.025], 6)
    front = lambda co: Vector((0, -1, 0))
    mesh.quad([Vector((-length / 2, 0, 0.05)), Vector((length / 2, 0, 0.05)), Vector((length / 2, 0, height)),
               Vector((-length / 2, 0, height))], [(0, 0), (length, 0), (length, height), (0, height)], front)
    objects = [posts.to_object(name + '-posts'), mesh.to_object(name)]
    if barbed:
        wire = Part(flat_material('barbed', (0.3, 0.28, 0.26), 0.6, 0.7))
        for k in range(3):
            z = height + 0.15 + k * 0.15
            y = -0.1 - k * 0.1
            oriented_box(wire, Vector((-length / 2, y, z)), Vector((length / 2, y, z)), 0.012)
        objects.append(wire.to_object(name + '-wire'))
    export(name, objects)


def concrete_bridge(name, length=30.0, width=9.0, height=6.0):
    """Road bridge along X: deck with kerbs and railings on two piers, abutments sunk at the ends"""
    clear_scene()
    concrete = Part(pbr_material('wall-brushed_concrete', 'brushed_concrete'), uv_metres=4.0)
    road = Part(pbr_material('road-asphalt_02', 'asphalt_02'), uv_metres=4.0)
    rail = Part(flat_material('galvanised', (0.45, 0.46, 0.45), 0.4, 0.8))
    box(concrete, 0, 0, height - 1.2, length, width, 1.0)
    box(road, 0, 0, height - 0.2, length, width - 1.4, 0.05)
    for side in (-1, 1):
        box(concrete, 0, side * (width / 2 - 0.35), height - 0.2, length, 0.7, 0.35)
        for k in range(int(length // 2) + 1):
            x = -length / 2 + k * length / int(length // 2)
            box(rail, x, side * (width / 2 - 0.1), height + 0.15, 0.08, 0.08, 1.0)
        box(rail, 0, side * (width / 2 - 0.1), height + 1.05, length, 0.1, 0.1)
    for x in (-length / 6, length / 6):
        box(concrete, x, 0, -3.0, 1.6, width * 0.7, height + 1.8)
    for x in (-length / 2, length / 2):
        box(concrete, x, 0, -3.0, 2.0, width + 0.4, height + 2.0)
    export(name, [concrete.to_object(name), road.to_object(name + '-road'), rail.to_object(name + '-rail')])


# ---------------------------------------------------------------- wasteland

def rubble_pile(name, seed, size=4.0):
    """Heap of broken concrete slabs with bent rebar"""
    clear_scene()
    rnd = random.Random(seed)
    concrete = Part(pbr_material('wall-concrete_floor_damaged_01', 'concrete_floor_damaged_01'), uv_metres=2.0)
    brick = Part(pbr_material('wall-brick_wall_07', 'brick_wall_07'), uv_metres=2.0)
    rebar = Part(flat_material('rebar', (0.2, 0.1, 0.05), 0.7, 0.6))
    for k in range(16):
        a = rnd.uniform(0, math.tau)
        r = size * 0.5 * math.sqrt(rnd.random())
        z = (1 - r / (size * 0.5)) * size * 0.35
        part = concrete if k % 3 else brick
        box(part, math.cos(a) * r, math.sin(a) * r, z - 0.4, rnd.uniform(0.6, 1.8), rnd.uniform(0.4, 1.2), rnd.uniform(0.2, 0.5),
            rnd.uniform(0, 3))
    for k in range(6):
        a = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), size * 0.25))
        oriented_box(rebar, a, a + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0.3, 1.2))), 0.04)
    export(name, [concrete.to_object(name), brick.to_object(name + '-bricks'), rebar.to_object(name + '-rebar')])


def barbed_wire(name, length=5.0):
    """Coil of barbed wire on low X-posts"""
    clear_scene()
    wire = Part(flat_material('barbed', (0.3, 0.28, 0.26), 0.6, 0.7))
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    turns = int(length * 3)
    pts = [Vector((-length / 2 + length * t / (turns * 8), math.cos(t / 8 * math.tau) * 0.45, 0.5 + math.sin(t / 8 * math.tau) * 0.45))
           for t in range(turns * 8 + 1)]
    for a, b in zip(pts, pts[1:]):
        oriented_box(wire, a, b, 0.015)
    for x in (-length / 2, 0, length / 2):
        for s in (-1, 1):
            oriented_box(wood, Vector((x, s * 0.5, -0.2)), Vector((x, -s * 0.5, 1.1)), 0.07)
    export(name, [wire.to_object(name), wood.to_object(name + '-posts')])


def sandbags(name, length=4.0, rows=3, planks=False):
    """Sandbag wall along X (curved slightly), optional planks and a corrugated sheet on top (barricade)"""
    clear_scene()
    rnd = random.Random(int(length * 10 + rows))
    bags = Part(pbr_material('cloth-hessian-bags', 'hessian_230', (0.9, 0.82, 0.62)), smooth=True)
    for r in range(rows):
        n = int(length / 0.62)
        for k in range(n):
            x = -length / 2 + (k + 0.5 * (r % 2) + 0.25) * length / n
            y = 0.04 * (x ** 2) / length
            z = 0.15 + r * 0.24
            tube(bags, [Vector((x - 0.27, y, z)), Vector((x - 0.2, y, z + 0.02)), Vector((x + 0.2, y, z + 0.02)), Vector((x + 0.27, y, z))],
                 [0.06, 0.15, 0.15, 0.06], 7, cap=True)
    objects = [bags.to_object(name)]
    if planks:
        wood = Part(pbr_material('planks-weathered', 'weathered_planks'), uv_metres=1.5)
        sheet = Part(pbr_material('metal-rusty_metal_03', 'rusty_metal_03'), uv_metres=2.0)
        for k in range(4):
            x = -length / 2 + 0.4 + k * (length - 0.8) / 3
            oriented_box(wood, Vector((x, 0.35, 0)), Vector((x + rnd.uniform(-0.3, 0.3), 0.1, 1.9)), 0.12)
        box(sheet, 0, 0.02, rows * 0.24 + 0.1, length * 0.8, 0.04, 1.1, 0.04)
        objects += [wood.to_object(name + '-planks'), sheet.to_object(name + '-sheet')]
    export(name, objects)


def tank_trap(name):
    """Czech hedgehog: three steel beams crossed at their middles"""
    clear_scene()
    steel = Part(pbr_material('metal-rusty_metal_03-trap', 'rusty_metal_03', (0.6, 0.5, 0.45)), uv_metres=1.0)
    c = Vector((0, 0, 0.75))
    for d in (Vector((1, 1, 0.9)), Vector((-1, 1, -0.9)), Vector((0.2, -1.4, 0.9))):
        d = d.normalized() * 1.0
        oriented_box(steel, c - d, c + d, 0.16)
    export(name, [steel.to_object(name)])


def toxic_barrel(name, leaking=False):
    """Oil drum in hazard yellow and rust; `leaking`: tipped over in a glowing green puddle"""
    clear_scene()
    drum = Part(image_material('hazard', blender_kit.FOLIAGE + '/hazard.jpg', 0.5), smooth=True)
    rust = Part(pbr_material('metal-green_metal_rust', 'green_metal_rust'), smooth=True)
    tube(rust, [Vector((0, 0, 0)), Vector((0, 0, 0.88))], [0.29, 0.29], 14, cap=True)
    tube(drum, [Vector((0, 0, 0.3)), Vector((0, 0, 0.58))], [0.295, 0.295], 14)
    objects = [rust.to_object(name), drum.to_object(name + '-band')]
    if leaking:
        tilt(objects, x=90, lift=0.29)
        goo = Part(flat_material('toxic-goo', (0.3, 0.8, 0.1), 0.15, emission=(0.35, 1.0, 0.1), strength=0.8))
        rnd = random.Random(5)
        bm = goo.bm
        n = 16
        centre = bm.verts.new((0, -0.9, 0.02))
        ring = [bm.verts.new((math.cos(k / n * math.tau) * rnd.uniform(0.6, 1.0), -0.9 + math.sin(k / n * math.tau) * rnd.uniform(0.5, 0.9), 0.02))
                for k in range(n)]
        for k in range(n):
            bm.faces.new((centre, ring[k], ring[(k + 1) % n]))
        objects.append(goo.to_object(name + '-goo'))
    export(name, objects)


def power_pole(name, fallen=False):
    """Poly Haven utility pole with crossarms and transformer; `fallen`: snapped over, lying across the ground"""
    def fall(obj):
        if fallen:
            tilt([obj], x=78, lift=0.2)
        return []

    import_model('modular_electricity_poles', None, 4000, name, objects=['preset_01_*'], keep_scale=True, extra=fall)


def models():
    grey, red, blue, white = (0.55, 0.57, 0.6), (0.55, 0.08, 0.06), (0.1, 0.22, 0.5), (0.85, 0.85, 0.83)
    return {
        'apartment-block': lambda: city_block('apartment-block', 'modern', 4, 14.0, 10.0, seed=1),
        'apartment-block-tall': lambda: city_block('apartment-block-tall', 'modern', 8, 16.0, 12.0, seed=2),
        'apartment-block-ruined': lambda: city_block('apartment-block-ruined', 'modern', 5, 14.0, 10.0, ruined=True, seed=3),
        'brick-block': lambda: city_block('brick-block', 'old', 3, 10.0, 9.0, seed=4, shopfront=True),
        'brick-house': lambda: city_block('brick-house', 'old', 2, 8.0, 8.0, seed=5),
        'brick-block-ruined': lambda: city_block('brick-block-ruined', 'old', 3, 10.0, 9.0, ruined=True, seed=6),
        'tower-stump': lambda: tower_stump('tower-stump', 5),
        'shop': lambda: shop('shop'),
        'warehouse': lambda: warehouse('warehouse'),
        'warehouse-rusty': lambda: warehouse('warehouse-rusty', rusty=True),
        'container-green': lambda: container('container-green', (1.0, 1.0, 1.0)),
        'container-red': lambda: container('container-red', (1.6, 0.45, 0.4)),
        'container-blue': lambda: container('container-blue', (0.5, 0.75, 1.5)),
        'container-rusty': lambda: container('container-rusty', (1.0, 0.95, 0.9), rusty=True),
        'car-red': lambda: car('car-red', red),
        'car-blue': lambda: car('car-blue', blue),
        'car-white': lambda: car('car-white', white),
        'car-grey': lambda: car('car-grey', grey),
        'car-wreck': lambda: car('car-wreck', grey, 'wreck', 1),
        'car-wreck-b': lambda: car('car-wreck-b', grey, 'wreck', 2),
        'car-burnt': lambda: car('car-burnt', grey, 'burnt', 3),
        'bus-wreck': lambda: bus_wreck('bus-wreck'),
        'car-covered': lambda: import_model('covered_car', None, 3000, 'car-covered', keep_scale=True),
        'traffic-light': lambda: traffic_light('traffic-light'),
        'street-lamp': lambda: import_model('street_lamp_01', None, 2500, 'street-lamp', keep_scale=True),
        'bench': lambda: bench('bench'),
        'bus-stop': lambda: bus_stop('bus-stop'),
        'hydrant': lambda: import_model('fire_hydrant', None, 1200, 'hydrant', objects=['fire_hydrant'], keep_scale=True),
        'trash-can': lambda: import_model('metal_trash_can', None, 1500, 'trash-can', objects=['metal_trash_can'], keep_scale=True),
        'utility-box': lambda: import_model('utility_box_02', None, 1500, 'utility-box', keep_scale=True),
        'road-barrier': lambda: import_model('concrete_road_barrier', None, 1500, 'road-barrier', keep_scale=True),
        'road-barrier-tall': lambda: import_model('concrete_road_barrier_02', None, 1500, 'road-barrier-tall', keep_scale=True),
        'fence-chainlink': lambda: chainlink_fence('fence-chainlink'),
        'fence-chainlink-barbed': lambda: chainlink_fence('fence-chainlink-barbed', barbed=True),
        'bridge-concrete': lambda: concrete_bridge('bridge-concrete'),
        'power-pole': lambda: power_pole('power-pole'),
        'power-pole-fallen': lambda: power_pole('power-pole-fallen', fallen=True),
        # Wasteland
        'rubble-pile': lambda: rubble_pile('rubble-pile', 7),
        'rubble-pile-large': lambda: rubble_pile('rubble-pile-large', 8, size=8.0),
        'barbed-wire': lambda: barbed_wire('barbed-wire'),
        'sandbags': lambda: sandbags('sandbags'),
        'barricade': lambda: sandbags('barricade', rows=2, planks=True),
        'tank-trap': lambda: tank_trap('tank-trap'),
        'toxic-barrel': lambda: toxic_barrel('toxic-barrel'),
        'toxic-barrel-leaking': lambda: toxic_barrel('toxic-barrel-leaking', leaking=True),
        'tyres': lambda: import_model('old_tyre', None, 1200, 'tyres', keep_scale=True),
        'barrel-stove': lambda: import_model('barrel_stove', None, 1500, 'barrel-stove', keep_scale=True),
        'jerrycan': lambda: import_model('metal_jerrycan', None, 800, 'jerrycan', keep_scale=True),
        'gas-bottle': lambda: import_model('propane_tank', None, 800, 'gas-bottle', keep_scale=True),
        'ammo-crate': lambda: import_model('wooden_military_crate', None, 1500, 'ammo-crate', keep_scale=True),
        'supply-crates': lambda: import_model('old_military_crate', None, 2000, 'supply-crates', keep_scale=True),
    }
