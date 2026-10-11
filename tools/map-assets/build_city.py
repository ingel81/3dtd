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

from blender_kit import (
    Part, box, card_material, clear_scene, export, flat_material, hexa, image_material, import_model, oriented_box,
    pbr_material, tilt, tube,
)
import blender_kit
from build_structures import gable_roof

FOUNDATION = 1.0


def glass():
    return flat_material('window-glass', (0.06, 0.08, 0.1), 0.12, 0.6)


def window_grid(dark, frame, w, d, z0, floors, floor_h, spacing, win_w, win_h, skip_front_door=False, broken=None):
    """Windows on all four walls of a box w x d (centre at the origin) from z0 up, one row per floor"""
    rnd = random.Random(int(w * 13 + d * 7 + floors))
    for f in range(floors):
        z = z0 + f * floor_h + floor_h * 0.3
        for side, length, normal in (('y', w, -1), ('y', w, 1), ('x', d, -1), ('x', d, 1)):
            n = max(1, int(length // spacing))
            for k in range(n):
                t = -length / 2 + (k + 0.5) * length / n
                if skip_front_door and f == 0 and side == 'y' and normal < 0 and abs(t) < spacing * 0.6:
                    continue
                if broken and rnd.random() < broken:
                    continue
                if side == 'y':
                    box(dark, t, normal * (d / 2 + 0.02), z, win_w, 0.08, win_h)
                    box(frame, t, normal * (d / 2 + 0.05), z - 0.08, win_w + 0.2, 0.08, 0.1)
                else:
                    box(dark, normal * (w / 2 + 0.02), t, z, 0.08, win_w, win_h)
                    box(frame, normal * (w / 2 + 0.05), t, z - 0.08, 0.08, win_w + 0.2, 0.1)


# ---------------------------------------------------------------- blocks

def apartment_block(name, floors=4, w=14.0, d=10.0, wall='concrete_slab_wall', tint=None, ruined=False, seed=0):
    """Modern block: flat roof with parapet and plant room, a window grid, an entrance canopy (front -Y).
    `ruined`: upper floors broken off along a jagged line, windows blown out, rubble at the foot"""
    clear_scene()
    rnd = random.Random(seed)
    walls = Part(pbr_material('wall-' + wall + ('-t' if tint else ''), wall, tint), uv_metres=3.0)
    trim = Part(pbr_material('wall-brushed_concrete', 'brushed_concrete'), uv_metres=3.0)
    dark = Part(glass() if not ruined else flat_material('hole', (0.03, 0.03, 0.03), 0.95))
    fh = 3.0
    h = floors * fh
    if not ruined:
        box(trim, 0, 0, -FOUNDATION, w + 0.2, d + 0.2, FOUNDATION + 0.6)
        box(walls, 0, 0, 0.6, w, d, h - 0.6)
        box(trim, 0, 0, h, w + 0.3, d + 0.3, 0.9)
        box(trim, w * 0.2, d * 0.1, h + 0.9, 3.0, 2.5, 2.0)
        box(trim, 0, -d / 2 - 1.0, 2.6, 3.4, 2.0, 0.25)
        box(dark, 0, -d / 2 - 0.03, 0.2, 1.8, 0.1, 2.3)
        for f in range(1, floors):
            box(trim, 0, 0, f * fh - 0.1, w + 0.12, d + 0.12, 0.2)
        window_grid(dark, trim, w, d, 0.6, floors, fh, 2.4, 1.4, 1.5, skip_front_door=True)
        export(name, [walls.to_object(name), trim.to_object(name + '-trim'), dark.to_object(name + '-windows')])
        return
    # Ruin: columns of wall broken at random heights, floor slabs sticking out
    cols = 7
    for side in ('front', 'back', 'left', 'right'):
        length = w if side in ('front', 'back') else d
        for k in range(cols):
            t = -length / 2 + (k + 0.5) * length / cols
            top = h * (0.25 + 0.75 * abs(math.sin(k * 1.7 + seed + len(side)))) * rnd.uniform(0.8, 1.0)
            if rnd.random() < 0.18:
                top = rnd.uniform(0.8, 2.5)
            seg = length / cols + 0.01
            if side == 'front':
                box(walls, t, -d / 2 + 0.15, -FOUNDATION, seg, 0.3, top + FOUNDATION)
            elif side == 'back':
                box(walls, t, d / 2 - 0.15, -FOUNDATION, seg, 0.3, top + FOUNDATION)
            elif side == 'left':
                box(walls, -w / 2 + 0.15, t, -FOUNDATION, 0.3, seg, top + FOUNDATION)
            else:
                box(walls, w / 2 - 0.15, t, -FOUNDATION, 0.3, seg, top + FOUNDATION)
    for f in range(1, floors):
        span = w * rnd.uniform(0.3, 0.9)
        box(trim, -w / 2 + span / 2, rnd.uniform(-1, 1), f * fh - 0.15, span, d - 0.4, 0.25, rnd.uniform(-0.04, 0.04))
    window_grid(dark, trim, w, d, 0.6, max(1, floors - 2), fh, 2.4, 1.4, 1.5, broken=0.35)
    rubble = Part(pbr_material('wall-' + wall + ('-t' if tint else ''), wall, tint), uv_metres=2.0)
    for k in range(18):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0.6, 1.0)
        box(rubble, math.cos(a) * (w / 2 + 1.5) * r, math.sin(a) * (d / 2 + 1.5) * r, -0.3, rnd.uniform(0.5, 1.6),
            rnd.uniform(0.4, 1.2), rnd.uniform(0.3, 0.8), rnd.uniform(0, 3))
    export(name, [walls.to_object(name), trim.to_object(name + '-slabs'), dark.to_object(name + '-holes'),
                  rubble.to_object(name + '-rubble')])


def brick_block(name, floors=3, w=10.0, d=9.0, shop=True, ruined=False, seed=0):
    """Old town house: brick walls, stone cornice, a shop front with big windows on the ground floor"""
    clear_scene()
    rnd = random.Random(seed)
    brick = Part(pbr_material('wall-brick_wall_07', 'brick_wall_07'), uv_metres=2.5)
    stone = Part(pbr_material('wall-brushed_concrete-warm', 'brushed_concrete', (1.1, 1.0, 0.85)), uv_metres=2.0)
    dark = Part(glass() if not ruined else flat_material('hole', (0.03, 0.03, 0.03), 0.95))
    fh = 3.3
    h = floors * fh
    box(stone, 0, 0, -FOUNDATION, w + 0.1, d + 0.1, FOUNDATION + 0.4)
    if not ruined:
        box(brick, 0, 0, 0.4, w, d, h - 0.4)
        box(stone, 0, 0, h, w + 0.5, d + 0.5, 0.35)
        box(stone, 0, 0, h + 0.35, w, d, 0.8)
        window_grid(dark, stone, w, d, fh, floors - 1, fh, 2.0, 1.0, 1.7)
        if shop:
            for x in (-w / 4, w / 4):
                box(dark, x, -d / 2 - 0.03, 0.6, w / 2 - 1.2, 0.1, 2.2)
            box(dark, 0, -d / 2 - 0.03, 0.4, 1.0, 0.1, 2.4)
            awning = Part(pbr_material('cloth-hessian-green', 'hessian_230', (0.45, 0.8, 0.5)))
            a = Vector((-w / 2 + 0.3, -d / 2, 3.0))
            b = Vector((w / 2 - 0.3, -d / 2, 3.0))
            corners = [a, b, b + Vector((0, -1.3, -0.6)), a + Vector((0, -1.3, -0.6))]
            awning.quad(corners, [(0, 0), (3, 0), (3, 1), (0, 1)])
            awning.quad(list(reversed(corners)), [(0, 0), (0, 1), (3, 1), (3, 0)])
            objects = [brick.to_object(name), stone.to_object(name + '-stone'), dark.to_object(name + '-windows'),
                       awning.to_object(name + '-awning')]
        else:
            window_grid(dark, stone, w, d, 0.4, 1, fh, 2.0, 1.0, 1.7, skip_front_door=True)
            box(dark, 0, -d / 2 - 0.03, 0.4, 1.1, 0.1, 2.3)
            objects = [brick.to_object(name), stone.to_object(name + '-stone'), dark.to_object(name + '-windows')]
        export(name, objects)
        return
    # Burnt-out shell: walls only, ragged tops, no roof, rubble inside
    cols = 6
    for side in range(4):
        length = w if side < 2 else d
        for k in range(cols):
            t = -length / 2 + (k + 0.5) * length / cols
            top = h * rnd.uniform(0.35, 1.0)
            seg = length / cols + 0.01
            if side == 0:
                box(brick, t, -d / 2 + 0.2, 0.4, seg, 0.4, top)
            elif side == 1:
                box(brick, t, d / 2 - 0.2, 0.4, seg, 0.4, top)
            elif side == 2:
                box(brick, -w / 2 + 0.2, t, 0.4, 0.4, seg, top)
            else:
                box(brick, w / 2 - 0.2, t, 0.4, 0.4, seg, top)
    window_grid(dark, stone, w, d, fh, floors - 2, fh, 2.0, 1.0, 1.7, broken=0.2)
    for k in range(12):
        box(brick, rnd.uniform(-w / 3, w / 3), rnd.uniform(-d / 3, d / 3), 0.2, rnd.uniform(0.6, 1.4), rnd.uniform(0.5, 1.2),
            rnd.uniform(0.3, 0.9), rnd.uniform(0, 3))
    export(name, [brick.to_object(name), stone.to_object(name + '-stone'), dark.to_object(name + '-holes')])


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


def shop(name):
    """Single-storey corner shop: plaster walls, big windows, striped awning, a sign board"""
    clear_scene()
    walls = Part(pbr_material('wall-beige_wall_001', 'beige_wall_001'), uv_metres=3.0)
    trim = Part(pbr_material('wall-brushed_concrete', 'brushed_concrete'), uv_metres=2.0)
    dark = Part(glass())
    sign = Part(flat_material('sign-red', (0.55, 0.1, 0.08), 0.6))
    w, d, h = 9.0, 7.0, 4.0
    box(trim, 0, 0, -FOUNDATION, w + 0.1, d + 0.1, FOUNDATION + 0.3)
    box(walls, 0, 0, 0.3, w, d, h - 0.3)
    box(trim, 0, 0, h, w + 0.3, d + 0.3, 0.4)
    for x in (-2.6, 2.6):
        box(dark, x, -d / 2 - 0.03, 0.7, 2.8, 0.1, 2.2)
    box(dark, 0, -d / 2 - 0.03, 0.3, 1.4, 0.1, 2.5)
    box(sign, 0, -d / 2 - 0.08, 3.1, w - 1.0, 0.1, 0.7)
    for y in (-1.5, 1.5):
        box(dark, w / 2 + 0.03, y, 1.0, 0.1, 1.6, 1.6)
    export(name, [walls.to_object(name), trim.to_object(name + '-trim'), dark.to_object(name + '-windows'),
                  sign.to_object(name + '-sign')])


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
        'apartment-block': lambda: apartment_block('apartment-block'),
        'apartment-block-tall': lambda: apartment_block('apartment-block-tall', floors=8, w=16.0, d=12.0, wall='concrete_block_wall',
                                                        tint=(1.25, 1.2, 1.15)),
        'apartment-block-ruined': lambda: apartment_block('apartment-block-ruined', floors=5, ruined=True, seed=3),
        'brick-block': lambda: brick_block('brick-block'),
        'brick-house': lambda: brick_block('brick-house', floors=2, w=8.0, d=8.0, shop=False),
        'brick-block-ruined': lambda: brick_block('brick-block-ruined', ruined=True, seed=4),
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
