"""Buildings, castle kit, bridges, walls and fences of the map asset catalogue (loaded by build_models.py)."""
import math
import random

from mathutils import Matrix, Vector

from blender_kit import finish as export  # noqa: F401  (every structure gets baked AO)
from blender_kit import (
    Part, two_sided, box, box_uv, card, card_material, clear_scene, flat_material, hexa, image_material, import_model,
    oriented_box, pbr_material, tube,
)
import blender_kit
from build_props import waterline


# ---------------------------------------------------------------- buildings and props

FOUNDATION = 1.5


def gable_roof(part, w, d, wall_h, pitch_h, overhang, ridge_along_x=True):
    """Two roof planes with thickness 0.15 m; box-mapped UVs follow the slope"""
    hw = w / 2 + overhang
    hd = d / 2 + overhang
    eave = wall_h - overhang * pitch_h / (d / 2)
    top = wall_h + pitch_h
    for side in (-1, 1):
        a = Vector((-hw, side * hd, eave))
        b = Vector((hw, side * hd, eave))
        c = Vector((hw, 0, top))
        e = Vector((-hw, 0, top))
        slope = (c - b).length
        corners = [a, b, c, e] if side < 0 else [b, a, e, c]
        uvs = [(0, 0), (w / 2.2, 0), (w / 2.2, slope / 2.2), (0, slope / 2.2)]
        part.quad(corners, uvs)
        # Underside
        under = [v - Vector((0, 0, 0.15)) for v in reversed(corners)]
        part.quad(under, uvs)


def house(name, w, d, wall_h, roof_asset, wall_asset, storeys=1, barn=False, wall_tint=None, frame=True, snow=False,
          extra=None, roof_tint=None):
    """Gabled house; `frame=False` drops the timber frame (stone, log or plank walls), `snow` lays a
    white layer over the roof, `extra(w, d, wall_h, pitch)` returns more parts (mill wheel, porch)"""
    clear_scene()
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=2.0)
    walls = Part(pbr_material('wall-' + wall_asset, wall_asset, wall_tint), uv_metres=2.5 if not barn else 2.0)
    timber = Part(pbr_material('timber', 'medieval_wood', (0.45, 0.38, 0.32)), uv_metres=1.5)
    roof = Part(pbr_material('roof-' + roof_asset + ('-tint' if roof_tint else ''), roof_asset, roof_tint))
    dark = Part(flat_material('window', (0.05, 0.06, 0.07), roughness=0.2, metallic=0.3))
    plinth = 0.6
    # The foundation reaches 1.5 m into the ground: on a slope it shows as a stone base instead of a gap
    box(stone, 0, 0, -FOUNDATION, w + 0.1, d + 0.1, plinth + FOUNDATION)
    box(walls, 0, 0, plinth, w, d, wall_h - plinth)
    pitch = d * 0.45 if not barn else d * 0.5
    # Gable triangles
    for sx in (-1, 1):
        x = sx * w / 2
        bm = walls.bm
        tri = [bm.verts.new((x, -d / 2, wall_h)), bm.verts.new((x, d / 2, wall_h)), bm.verts.new((x, 0, wall_h + pitch))]
        bm.faces.new(tri if sx > 0 else list(reversed(tri)))
    gable_roof(roof, w, d, wall_h, pitch, 0.5)
    t = 0.18
    # Timber frame: corner posts, sill and top beams, storey beam, braces
    if not barn and frame:
        for cx in (-w / 2, w / 2):
            for cy in (-d / 2, d / 2):
                box(timber, cx, cy, plinth, t, t, wall_h - plinth)
        for z in [plinth, wall_h - t] + ([plinth + (wall_h - plinth) / 2] if storeys > 1 else []):
            box(timber, 0, -d / 2, z, w + t, t, t)
            box(timber, 0, d / 2, z, w + t, t, t)
            box(timber, -w / 2, 0, z, t, d + t, t)
            box(timber, w / 2, 0, z, t, d + t, t)
        for sy in (-1, 1):
            y = sy * (d / 2 + 0.02)
            for k in range(int(w // 2.4)):
                x0 = -w / 2 + 0.3 + k * 2.4
                oriented_box(timber, Vector((x0, y, plinth + 0.1)), Vector((x0 + 1.1, y, wall_h - 0.3)), 0.14)
    elif barn:
        for cx in (-w / 2, w / 2):
            for cy in (-d / 2, d / 2):
                box(timber, cx, cy, plinth, 0.3, 0.3, wall_h - plinth)
    # Door on the front (-Y), windows on all sides
    door_w = 1.2 if not barn else 3.2
    door_h = 2.2 if not barn else 3.4
    box(timber, 0, -d / 2 - 0.06, plinth * 0.3 if not barn else 0, door_w + 0.3, 0.12, door_h + 0.2)
    box(dark, 0, -d / 2 - 0.09, plinth * 0.3 + 0.1 if not barn else 0.05, door_w, 0.08, door_h)
    if not barn:
        for z in [plinth + 1.0] + ([plinth + 1.0 + (wall_h - plinth) / 2] if storeys > 1 else []):
            for x in (-w / 3, w / 3):
                for sy in (-1, 1):
                    if sy < 0 and abs(x) < 1.0:
                        continue
                    y = sy * (d / 2 + 0.05)
                    box(timber, x, y, z - 0.08, 1.1, 0.1, 1.25)
                    box(dark, x, y + sy * 0.02, z, 0.9, 0.1, 1.05)
            for sx in (-1, 1):
                box(timber, sx * (w / 2 + 0.05), 0, z - 0.08, 0.1, 1.1, 1.25)
                box(dark, sx * (w / 2 + 0.07), 0, z, 0.1, 0.9, 1.05)
        # Chimney
        box(stone, w * 0.3, d * 0.2, wall_h, 0.7, 0.7, pitch * 0.8 + 1.0)
    objects = [stone.to_object(name + '-stone'), walls.to_object(name + '-walls'), timber.to_object(name + '-timber')]
    # Roof UVs come from gable_roof, no box mapping
    objects.append(roof.to_object(name + '-roof'))
    objects.append(dark.to_object(name + '-dark'))
    if snow:
        cover = Part(pbr_material('snow-snow_02', 'snow_02', (0.95, 0.97, 1.0)), uv_metres=3.0, bevel=0.0)
        gable_roof(cover, w + 0.1, d, wall_h + 0.12, pitch, 0.55)
        objects.append(cover.to_object(name + '-snow'))
    if extra:
        objects += [p.to_object(name + '-extra%d' % k) for k, p in enumerate(extra(w, d, wall_h, pitch))]
    export(name, objects)


def tower_ruin(name, seed):
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('castle-brick', 'castle_brick_07'))
    bm = stone.bm
    sides = 18
    r_out, r_in = 3.6, 2.8
    rings = 7
    heights = [12.0 - (5.5 * max(0.0, math.sin(s / sides * math.tau * 1.3 + 0.8)) + rnd.uniform(0, 1.2)) for s in range(sides + 1)]
    heights[-1] = heights[0]
    for r, flip in ((r_out, False), (r_in, True)):
        grid = []
        for k in range(rings + 1):
            row = []
            for s in range(sides + 1):
                a = s / sides * math.tau
                z = -FOUNDATION + (heights[s] + FOUNDATION) * k / rings
                row.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
            grid.append(row)
        circ = math.tau * r
        for k in range(rings):
            for s in range(sides):
                q = [grid[k][s], grid[k][s + 1], grid[k + 1][s + 1], grid[k + 1][s]]
                if flip:
                    q = list(reversed(q))
                f = bm.faces.new(q)
                for loop, (i, j) in zip(f.loops, [(s, k), (s + 1, k), (s + 1, k + 1), (s, k + 1)] if not flip else [(s, k + 1), (s + 1, k + 1), (s + 1, k), (s, k)]):
                    loop[stone.uv].uv = (i / sides * circ / 2.0, (heights[i] + FOUNDATION) * j / rings / 2.0)
        if not flip:
            outer_top = grid[-1]
        else:
            inner_top = grid[-1]
    for s in range(sides):
        f = bm.faces.new((outer_top[s], inner_top[s], inner_top[s + 1], outer_top[s + 1]))
        for loop, uv in zip(f.loops, [(0, 0), (0, 0.4), (0.4, 0.4), (0.4, 0)]):
            loop[stone.uv].uv = uv
    rubble = Part(pbr_material('castle-brick', 'castle_brick_07'), uv_metres=2.0)
    for k in range(9):
        a = rnd.uniform(0, math.tau)
        rr = rnd.uniform(4.0, 6.5)
        box(rubble, math.cos(a) * rr, math.sin(a) * rr, -0.1, rnd.uniform(0.5, 1.1), rnd.uniform(0.4, 0.8), rnd.uniform(0.3, 0.6), rnd.uniform(0, 3))
    export(name, [stone.to_object(name), rubble.to_object(name + '-rubble')])


def wall_stone(name, seed):
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('stone-stacked', 'stacked_stone_wall'), uv_metres=2.0)
    for k in range(4):
        h = 1.3 + rnd.uniform(-0.2, 0.15)
        box(stone, -1.5 + k * 1.0, 0, -0.8, 1.02, 0.6 - k % 2 * 0.04, h + 0.8)
    export(name, [stone.to_object(name)])


def fence(name):
    clear_scene()
    wood = Part(pbr_material('wood-rough', 'rough_wood', (0.8, 0.72, 0.62)), uv_metres=1.5)
    for x in (-2.0, 0.0, 2.0):
        box(wood, x, 0, -0.5, 0.14, 0.14, 1.8)
    for z in (0.45, 0.95):
        box(wood, 0, 0.09, z, 4.1, 0.05, 0.14)
    export(name, [wood.to_object(name)])


def well(name):
    clear_scene()
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates'))
    wood = Part(pbr_material('wood-rough', 'rough_wood', (0.8, 0.72, 0.62)), uv_metres=1.5)
    roof = Part(pbr_material('roof-clay_roof_tiles_02', 'clay_roof_tiles_02'))
    water = Part(flat_material('well-water', (0.02, 0.05, 0.05), 0.05))
    pts = [Vector((0, 0, -0.8)), Vector((0, 0, 0.9))]
    for r in (1.2,):
        tube(stone, pts, [r, r], 14, smooth=True)
    tube(stone, [Vector((0, 0, 0.9)), Vector((0, 0, 0.0))], [0.95, 0.95], 14, smooth=True)
    bm = stone.bm
    outer = [bm.verts.new((math.cos(a / 14 * math.tau) * 1.2, math.sin(a / 14 * math.tau) * 1.2, 0.9)) for a in range(14)]
    inner = [bm.verts.new((math.cos(a / 14 * math.tau) * 0.95, math.sin(a / 14 * math.tau) * 0.95, 0.9)) for a in range(14)]
    for k in range(14):
        f = bm.faces.new((outer[k], outer[(k + 1) % 14], inner[(k + 1) % 14], inner[k]))
        for loop in f.loops:
            loop[stone.uv].uv = (loop.vert.co.x / 2, loop.vert.co.y / 2)
    wb = water.bm
    disc = [wb.verts.new((math.cos(a / 14 * math.tau) * 0.95, math.sin(a / 14 * math.tau) * 0.95, 0.5)) for a in range(14)]
    wb.faces.new(disc)
    for x in (-1.1, 1.1):
        box(wood, x, 0, 0.9, 0.15, 0.15, 1.6)
    box(wood, 0, 0, 2.3, 2.4, 0.12, 0.12)
    gable_roof(roof, 2.8, 1.6, 2.45, 0.7, 0.1)
    export(name, [stone.to_object(name), wood.to_object(name + '-wood'), roof.to_object(name + '-roof'), water.to_object(name + '-water')])


def bridge_deck(name):
    """4 m of bridge along +X, 1 m wide (scaled to the path width), deck top at z = 0"""
    clear_scene()
    planks = Part(pbr_material('planks-bridge', 'brown_planks_07', (0.8, 0.75, 0.7)), uv_metres=2.0)
    beams = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.5)
    box(planks, 0, 0, -0.12, 4.0, 1.0, 0.12)
    for y in (-0.42, 0.0, 0.42):
        box(beams, 0, y, -0.45, 4.0, 0.12, 0.33)
    for y in (-0.5, 0.5):
        for x in (-1.9, 0.0, 1.9):
            box(beams, x, y, 0, 0.14, 0.06, 1.0)
        box(beams, 0, y, 0.95, 4.0, 0.06, 0.1)
    for x in (-1.9, 1.9):
        box(beams, x, 0, -4.0, 0.25, 0.25, 3.6)
    export(name, [planks.to_object(name), beams.to_object(name + '-beams')])


# ---------------------------------------------------------------- shapes for masonry

CASTLE = 'castle_wall_slates'
RUIN = 'mossy_stone_wall'


def merlons(part, x0, x1, y, z, thick, width=0.9, gap=0.7, height=1.1):
    """Battlements along X between x0 and x1 at depth y"""
    n = max(1, int((x1 - x0 + gap) // (width + gap)))
    span = n * width + (n - 1) * gap
    start = (x0 + x1) / 2 - span / 2 + width / 2
    for k in range(n):
        box(part, start + k * (width + gap), y, z, width, thick, height)


def ring_merlons(part, r, z, thick, count, height=1.1):
    for k in range(count):
        a = (k + 0.5) / count * math.tau
        box(part, math.cos(a) * r, math.sin(a) * r, z, thick, math.tau * r / count * 0.55, height, a)


def arch_wall(part, x0, x1, y, thick, z0, top, cx, width, spring, steps=10):
    """Wall from x0 to x1 (along X) with an opening of `width` around cx: straight sides up to
    `spring`, a round arch above, approximated by vertical strips"""
    box(part, (x0 + cx - width / 2) / 2, y, z0, cx - width / 2 - x0, thick, top - z0)
    box(part, (cx + width / 2 + x1) / 2, y, z0, x1 - cx - width / 2, thick, top - z0)
    r = width / 2
    for k in range(steps):
        a = cx - r + k * width / steps
        b = a + width / steps
        m = (a + b) / 2 - cx
        bottom = spring + math.sqrt(max(0.0, r * r - m * m))
        if bottom < top:
            box(part, (a + b) / 2, y, bottom, b - a, thick, top - bottom)


def cone_roof(part, cx, cy, z, r, h, sides=12):
    tube(part, [Vector((cx, cy, z)), Vector((cx, cy, z + h))], [r, 0.02], sides, smooth=False)
    ring = [part.bm.verts.new((cx + math.cos(k / sides * math.tau) * r, cy + math.sin(k / sides * math.tau) * r, z))
            for k in range(sides)]
    f = part.bm.faces.new(list(reversed(ring)))
    for loop in f.loops:
        loop[part.uv].uv = (loop.vert.co.x, loop.vert.co.y)


def pyramid_roof(part, w, d, z, h, overhang=0.3, cx=0.0, cy=0.0):
    hw, hd = w / 2 + overhang, d / 2 + overhang
    apex = Vector((cx, cy, z + h))
    corners = [Vector((cx - hw, cy - hd, z)), Vector((cx + hw, cy - hd, z)), Vector((cx + hw, cy + hd, z)), Vector((cx - hw, cy + hd, z))]
    for k in range(4):
        a, b = corners[k], corners[(k + 1) % 4]
        slope = (apex - (a + b) / 2).length
        width = (b - a).length
        verts = [part.bm.verts.new(v) for v in (a, b, apex)]
        f = part.bm.faces.new(verts)
        for loop, uv in zip(f.loops, [(0, 0), (width / 2.2, 0), (width / 4.4, slope / 2.2)]):
            loop[part.uv].uv = uv
    f = part.bm.faces.new([part.bm.verts.new(v) for v in reversed(corners)])
    for loop in f.loops:
        loop[part.uv].uv = (loop.vert.co.x, loop.vert.co.y)


def slit_windows(dark, positions):
    for x, y, z, sx, sy in positions:
        box(dark, x, y, z, sx, sy, 1.1)


def stairs(part, x0, x1, y, depth, top, steps):
    """Solid stair block from the ground at x0 up to `top` at x1"""
    for k in range(steps):
        x = x0 + (x1 - x0) * (k + 0.5) / steps
        box(part, x, y, -0.3, abs(x1 - x0) / steps + 0.02, depth, top * (k + 1) / steps + 0.3)


# ---------------------------------------------------------------- castle kit (8 m grid, walls 7 m high)

def castle_wall(name, stone_asset=CASTLE, ruined=False, seed=0, length=8.0, height=7.0, thick=2.4):
    """Curtain wall along X, front (-Y) with battlements, walkway on top behind a low parapet"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('castle-' + stone_asset, stone_asset), uv_metres=3.0)
    if not ruined:
        dark = Part(flat_material('slit', (0.03, 0.03, 0.035), 0.9))
        box(stone, 0, 0, -0.5, length, thick, height + 0.5)
        # Battered foot, a string course under the parapet, corbels carrying the battlements
        hexa(stone, [(-length / 2, -thick / 2 - 0.7, -1.0), (length / 2, -thick / 2 - 0.7, -1.0), (length / 2, thick / 2 + 0.3, -1.0),
                     (-length / 2, thick / 2 + 0.3, -1.0)],
             [(-length / 2, -thick / 2, 1.6), (length / 2, -thick / 2, 1.6), (length / 2, thick / 2, 1.6), (-length / 2, thick / 2, 1.6)])
        box(stone, 0, -thick / 2 - 0.05, height - 1.4, length, 0.2, 0.25)
        for k in range(int(length / 1.0)):
            box(stone, -length / 2 + 0.5 + k, -thick / 2 - 0.15, height - 0.6, 0.35, 0.3, 0.6)
        box(stone, 0, -thick / 2 + 0.2, height - 0.05, length, 0.8, 0.3)
        merlons(stone, -length / 2, length / 2, -thick / 2 + 0.05, height + 0.25, 0.6)
        box(stone, 0, thick / 2 - 0.25, height, length, 0.5, 0.7)
        for x in (-length / 4, length / 4):
            box(dark, x, -thick / 2 - 0.02, 3.2, 0.18, 0.1, 1.3)
        export(name, [stone.to_object(name), dark.to_object(name + '-slits')])
        return
    # Ruined: columns of masonry broken off at different heights, rubble in front
    cols = 8
    for k in range(cols):
        x = -length / 2 + (k + 0.5) * length / cols
        t = k / (cols - 1)
        h = height * (0.35 + 0.65 * abs(math.sin(t * 2.4 + seed))) * rnd.uniform(0.85, 1.05)
        box(stone, x, 0, -0.5, length / cols + 0.01, thick, h + 0.5)
    rubble = Part(pbr_material('castle-' + stone_asset, stone_asset), uv_metres=2.0)
    for k in range(10):
        box(rubble, rnd.uniform(-length / 2, length / 2), -thick / 2 - rnd.uniform(0.4, 2.2), -0.15,
            rnd.uniform(0.4, 0.9), rnd.uniform(0.3, 0.6), rnd.uniform(0.25, 0.5), rnd.uniform(0, 3))
    export(name, [stone.to_object(name), rubble.to_object(name + '-rubble')])


def castle_tower(name, roof=False, stone_asset=CASTLE, radius=3.6, height=12.0):
    """Round tower: wider top ring with battlements, arrow slits; optional slate cone roof"""
    clear_scene()
    stone = Part(pbr_material('castle-' + stone_asset, stone_asset), uv_metres=3.0)
    dark = Part(flat_material('slit', (0.03, 0.03, 0.035), 0.9))
    tube(stone, [Vector((0, 0, -1.0)), Vector((0, 0, 2.0)), Vector((0, 0, height))], [radius * 1.22, radius * 1.02, radius], 24, smooth=True, cap=True)
    tube(stone, [Vector((0, 0, height * 0.55)), Vector((0, 0, height * 0.55 + 0.25))], [radius * 1.04 + 0.1, radius * 1.04 + 0.1], 24, smooth=True)
    tube(stone, [Vector((0, 0, height - 0.4)), Vector((0, 0, height + 1.0))], [radius + 0.45, radius + 0.45], 24, smooth=True, cap=True)
    for k in range(16):
        a = (k + 0.5) / 16 * math.tau
        box(stone, math.cos(a) * (radius + 0.2), math.sin(a) * (radius + 0.2), height - 1.2, 0.5, 0.35, 0.8, a)
    ring_merlons(stone, radius + 0.25, height + 1.0, 0.6, 14)
    for k in range(6):
        a = k / 6 * math.tau + 0.3
        for z in (3.0, 7.0):
            box(dark, math.cos(a) * (radius + 0.02), math.sin(a) * (radius + 0.02), z, 0.25, 0.25, 1.1, a)
    objects = [stone.to_object(name), dark.to_object(name + '-slits')]
    if roof:
        slates = Part(pbr_material('roof-roof_slates_02', 'roof_slates_02'))
        cone_roof(slates, 0, 0, height + 1.0, radius + 0.6, radius * 1.8, 16)
        objects.append(slates.to_object(name + '-roof'))
    export(name, objects)


def castle_gate(name, stone_asset=CASTLE):
    """Gatehouse 16 m wide: two square towers and an arched passage with wooden doors, front -Y"""
    clear_scene()
    stone = Part(pbr_material('castle-' + stone_asset, stone_asset), uv_metres=3.0)
    wood = Part(pbr_material('planks-dark', 'dark_planks', (0.8, 0.7, 0.6)), uv_metres=1.5)
    iron = Part(flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8))
    dark = Part(flat_material('slit', (0.03, 0.03, 0.035), 0.9))
    tw = 5.0
    for sx in (-1, 1):
        x = sx * (8 - tw / 2)
        box(stone, x, 0, -0.5, tw, 5.5, 11.5)
        for side in (-1, 1):
            merlons(stone, x - tw / 2, x + tw / 2, side * (2.75 - 0.3), 11.0, 0.6)
        box(dark, x, -2.78, 6.0, 0.3, 0.1, 1.2)
    # Passage block between the towers with an arch 4 m wide, springing at 3.5 m
    arch_wall(stone, -3, 3, 0, 4.4, -0.5, 9.0, 0, 4.0, 3.5)
    merlons(stone, -3, 3, -1.9, 9.0, 0.6)
    box(stone, 0, 1.9, 9.0, 6, 0.6, 0.8)
    # Portcullis half raised in front of the doors, corbels and a string course on the towers
    for k in range(7):
        x = -1.8 + k * 0.6
        box(iron, x, -1.6, 2.2, 0.08, 0.08, 3.6)
    for z in (2.6, 3.6, 4.6, 5.6):
        box(iron, 0, -1.6, z, 3.8, 0.07, 0.08)
    for sx in (-1, 1):
        x = sx * (8 - tw / 2)
        box(stone, x, 0, 7.0, tw + 0.25, 5.75, 0.25)
        for k in range(5):
            box(stone, x - tw / 2 + 0.5 + k * (tw - 1.0) / 4, -2.9, 10.4, 0.35, 0.35, 0.6)
    # Doors set back in the arch, iron bands
    for sx in (-1, 1):
        box(wood, sx * 1.0, 0.6, 0, 2.0, 0.15, 5.4)
        for z in (1.0, 3.0, 4.6):
            box(iron, sx * 1.0, 0.5, z, 2.0, 0.06, 0.12)
    export(name, [stone.to_object(name), wood.to_object(name + '-doors'), iron.to_object(name + '-iron'),
                  dark.to_object(name + '-windows')])


def castle_keep(name, stone_asset=CASTLE):
    """Square keep 12 x 12 x 17 m with battlements, corner turrets with slate cones and windows"""
    clear_scene()
    stone = Part(pbr_material('castle-' + stone_asset, stone_asset), uv_metres=3.0)
    slates = Part(pbr_material('roof-roof_slates_02', 'roof_slates_02'))
    dark = Part(flat_material('window', (0.04, 0.045, 0.05), 0.3))
    s, h = 12.0, 17.0
    box(stone, 0, 0, -0.5, s, s, h + 0.5)
    hexa(stone, [(-s / 2 - 0.9, -s / 2 - 0.9, -1.0), (s / 2 + 0.9, -s / 2 - 0.9, -1.0), (s / 2 + 0.9, s / 2 + 0.9, -1.0), (-s / 2 - 0.9, s / 2 + 0.9, -1.0)],
         [(-s / 2, -s / 2, 2.0), (s / 2, -s / 2, 2.0), (s / 2, s / 2, 2.0), (-s / 2, s / 2, 2.0)])
    for z in (6.5, 12.0):
        box(stone, 0, 0, z, s + 0.3, s + 0.3, 0.25)
    for k in range(10):
        t = -s / 2 + 0.6 + k * (s - 1.2) / 9
        for x, y in ((t, -s / 2 - 0.15), (t, s / 2 + 0.15), (-s / 2 - 0.15, t), (s / 2 + 0.15, t)):
            box(stone, x, y, h - 0.7, 0.35, 0.35, 0.6)
    for side in (-1, 1):
        merlons(stone, -s / 2 + 1.5, s / 2 - 1.5, side * (s / 2 - 0.3), h, 0.6)
    # Battlements on the east and west sides: rotated copies
    for side in (-1, 1):
        n = 5
        for k in range(n):
            y = -s / 2 + 1.5 + (k + 0.5) * (s - 3) / n
            box(stone, side * (s / 2 - 0.3), y, h, 0.6, 0.9, 1.1)
    for cx in (-1, 1):
        for cy in (-1, 1):
            x, y = cx * (s / 2 - 0.4), cy * (s / 2 - 0.4)
            tube(stone, [Vector((x, y, h - 3.5)), Vector((x, y, h + 2.0))], [1.3, 1.3], 12, smooth=True, cap=True)
            cone_roof(slates, x, y, h + 2.0, 1.6, 3.2, 12)
    for z in (5.0, 10.0, 14.0):
        for k in (-1, 0, 1):
            box(dark, k * 3.5, -s / 2 - 0.02, z, 0.8 if z > 6 else 0.3, 0.1, 1.6 if z > 6 else 1.2)
            box(dark, k * 3.5, s / 2 + 0.02, z, 0.8 if z > 6 else 0.3, 0.1, 1.6 if z > 6 else 1.2)
            box(dark, -s / 2 - 0.02, k * 3.5, z, 0.1, 0.8 if z > 6 else 0.3, 1.6 if z > 6 else 1.2)
            box(dark, s / 2 + 0.02, k * 3.5, z, 0.1, 0.8 if z > 6 else 0.3, 1.6 if z > 6 else 1.2)
    box(dark, 0, -s / 2 - 0.02, 0, 2.2, 0.1, 3.2)
    export(name, [stone.to_object(name), slates.to_object(name + '-roofs'), dark.to_object(name + '-windows')])


def castle_stairs(name, stone_asset=CASTLE):
    """Stair block along a wall: 8 m long, rising from the ground (west) to the wall walk (east, 7 m)"""
    clear_scene()
    stone = Part(pbr_material('castle-' + stone_asset, stone_asset), uv_metres=3.0)
    stairs(stone, -4, 4, 0, 2.0, 7.0, 20)
    export(name, [stone.to_object(name)])


# ---------------------------------------------------------------- village, chapel, mills, towers

def chapel(name):
    """Stone chapel: nave with slate roof, bell tower with pyramid roof at the front (-Y)"""
    clear_scene()
    stone = Part(pbr_material('wall-white_sandstone_bricks', 'white_sandstone_bricks'), uv_metres=2.5)
    roof = Part(pbr_material('roof-roof_slates_02', 'roof_slates_02'))
    dark = Part(flat_material('window', (0.05, 0.06, 0.08), 0.2, 0.3))
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.5)
    w, d, wall_h = 7.0, 13.0, 6.0
    # Nave runs along Y: build it along X and turn by the gable orientation (ridge along Y)
    box(stone, 0, 1.0, 0, w, d, wall_h)
    pitch = w * 0.55
    for sy in (-1, 1):
        y = 1.0 + sy * d / 2
        bm = stone.bm
        tri = [bm.verts.new((-w / 2, y, wall_h)), bm.verts.new((w / 2, y, wall_h)), bm.verts.new((0, y, wall_h + pitch))]
        bm.faces.new(tri if sy < 0 else list(reversed(tri)))
    # Roof planes along Y
    for side in (-1, 1):
        hw = w / 2 + 0.4
        a = Vector((side * hw, 1.0 - d / 2 - 0.3, wall_h - 0.4 * pitch / (w / 2)))
        b = Vector((side * hw, 1.0 + d / 2 + 0.3, wall_h - 0.4 * pitch / (w / 2)))
        c = Vector((0, 1.0 + d / 2 + 0.3, wall_h + pitch))
        e = Vector((0, 1.0 - d / 2 - 0.3, wall_h + pitch))
        slope = (c - b).length
        quad = [a, b, c, e] if side > 0 else [b, a, e, c]
        roof.quad(quad, [(0, 0), (d / 2.2, 0), (d / 2.2, slope / 2.2), (0, slope / 2.2)])
        roof.quad([v - Vector((0, 0, 0.15)) for v in reversed(quad)], [(0, 0), (d / 2.2, 0), (d / 2.2, slope / 2.2), (0, slope / 2.2)])
    # Tower at the front
    t = 3.6
    ty = 1.0 - d / 2 - t / 2 + 0.2
    box(stone, 0, ty, 0, t, t, 15.0)
    pyramid_roof(roof, t, t, 15.0, 5.0, 0.25, cy=ty)
    for side in (-1, 1):
        for k in range(3):
            box(dark, side * (w / 2 + 0.02), -2.0 + k * 3.5, 2.2, 0.1, 0.9, 2.4)
    for sx in (-1, 1):
        box(dark, sx * (t / 2 + 0.02), ty, 11.5, 0.1, 1.0, 1.8)
    box(dark, 0, ty - t / 2 - 0.02, 11.5, 1.0, 0.1, 1.8)
    box(wood, 0, ty - t / 2 - 0.05, 0, 1.6, 0.12, 3.0)
    box(dark, 0, 1.0 + d / 2 + 0.02, 3.5, 1.4, 0.1, 2.6)
    export(name, [stone.to_object(name), roof.to_object(name + '-roof'), dark.to_object(name + '-windows'),
                  wood.to_object(name + '-door')])


def windmill(name):
    """Tower mill: tapered plastered tower, thatched cap, four sails on the front (-Y)"""
    clear_scene()
    walls = Part(pbr_material('wall-beige_wall_001', 'beige_wall_001'), smooth=True)
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=2.0)
    thatch = Part(pbr_material('roof-reed_roof_04', 'reed_roof_04'))
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    cloth = Part(two_sided(pbr_material('cloth-hessian', 'hessian_230', (1.15, 1.1, 1.0))))
    dark = Part(flat_material('window', (0.05, 0.06, 0.07), 0.2, 0.3))
    h = 10.0
    tube(stone, [Vector((0, 0, -0.5)), Vector((0, 0, 1.0))], [3.7, 3.6], 16)
    tube(walls, [Vector((0, 0, 1.0)), Vector((0, 0, h))], [3.5, 2.6], 16)
    cone_roof(thatch, 0, 0, h, 3.0, 3.6, 16)
    box(wood, 0, -3.5, 0, 1.3, 0.2, 2.4)
    for z in (4.0, 7.0):
        box(dark, 0, -3.2 + (z - 1) * 0.1, z, 0.7, 0.2, 0.9)
    hub = Vector((0, -3.3, h + 0.6))
    box(wood, 0, -2.9, h + 0.45, 0.4, 1.2, 0.4)
    for k in range(4):
        a = k / 4 * math.tau + math.radians(20)
        arm = Vector((math.cos(a), 0, math.sin(a)))
        side = Vector((-math.sin(a), 0, math.cos(a)))
        tip = hub + arm * 7.0
        oriented_box(wood, hub, tip, 0.22)
        a0 = hub + arm * 1.4
        corners = [a0, tip, tip + side * 1.6, a0 + side * 1.6]
        corners = [c + Vector((0, -0.12, 0)) for c in corners]
        cloth.quad(corners, [(0, 0), (2.8, 0), (2.8, 0.7), (0, 0.7)])
        for t in (0.3, 0.55, 0.8, 1.0):
            p = hub + arm * (1.4 + 5.6 * t)
            oriented_box(wood, p, p + side * 1.6, 0.08)
    export(name, [stone.to_object(name + '-base'), walls.to_object(name), thatch.to_object(name + '-roof'),
                  wood.to_object(name + '-wood'), cloth.to_object(name + '-sails'), dark.to_object(name + '-windows')])


def mill_wheel(w, d, wall_h, pitch):
    """Water wheel on the east gable: rims, spokes and paddles (watermill extra)"""
    wood = Part(pbr_material('planks-dark', 'dark_planks', (0.9, 0.85, 0.8)), uv_metres=1.0)
    x = w / 2 + 0.8
    c = Vector((x, 0, 2.2))
    r = 3.0
    n = 16
    for side in (-0.5, 0.5):
        pts = [c + Vector((side, math.cos(k / n * math.tau) * r, math.sin(k / n * math.tau) * r)) for k in range(n + 1)]
        for a, b in zip(pts, pts[1:]):
            oriented_box(wood, a, b, 0.14)
        for k in range(0, n, 2):
            oriented_box(wood, c + Vector((side, 0, 0)), pts[k], 0.1)
    for k in range(n):
        a = k / n * math.tau
        p = c + Vector((0, math.cos(a) * r, math.sin(a) * r))
        q = c + Vector((0, math.cos(a) * (r - 0.8), math.sin(a) * (r - 0.8)))
        # Paddle: a board across the wheel between the rims, pointing at the hub
        oriented_box(wood, (p + q) / 2 - Vector((0.5, 0, 0)), (p + q) / 2 + Vector((0.5, 0, 0)), 0.5)
    oriented_box(wood, c - Vector((1.2, 0, 0)), c + Vector((0.8, 0, 0)), 0.3)
    return [wood]


def snowy_house(*args, **kwargs):
    return house(*args, snow=True, **kwargs)


def log_cabin(name, w=7.0, d=5.0, snow=False):
    house(name, w, d, 3.4, 'roof_planks', 'wood_trunk_wall', frame=False, snow=snow, wall_tint=(0.9, 0.82, 0.75))


def adobe(name, w, d, h, upper=None, seed=0):
    """Desert house of clay: flat roof with a low parapet, protruding roof beams, small dark windows;
    `upper` = (w, d, h) of a second, smaller block on the roof"""
    clear_scene()
    rnd = random.Random(seed)
    clay = Part(pbr_material('wall-patterned_clay_wall', 'patterned_clay_wall', (1.15, 1.0, 0.88)), uv_metres=3.0)
    wood = Part(pbr_material('planks-dark', 'dark_planks', (0.85, 0.75, 0.6)), uv_metres=1.0)
    dark = Part(flat_material('window', (0.05, 0.05, 0.05), 0.6))
    cloth = Part(two_sided(pbr_material('cloth-hessian-red', 'hessian_230', (1.1, 0.5, 0.3))))

    def block(cx, cy, z0, bw, bd, bh):
        box(clay, cx, cy, z0, bw, bd, bh)
        for k in range(4):
            sx = 1 if k % 2 else -1
            box(clay, cx, cy + (bd / 2 - 0.15) * sx, z0 + bh, bw, 0.3, 0.5)
            box(clay, cx + (bw / 2 - 0.15) * sx, cy, z0 + bh, 0.3, bd, 0.5)
        for k in range(int(bw // 1.4)):
            x = cx - bw / 2 + 0.7 + k * 1.4
            box(wood, x, cy - bd / 2 - 0.3, z0 + bh - 0.45, 0.18, 0.7, 0.18)

    block(0, 0, -0.3, w, d, h + 0.3)
    box(wood, -w * 0.2, -d / 2 - 0.03, 0, 1.1, 0.1, 2.2)
    box(dark, -w * 0.2, -d / 2 - 0.06, 0.05, 0.9, 0.08, 2.0)
    for x in (w * 0.15, w * 0.35):
        box(dark, x, -d / 2 - 0.04, 1.4, 0.6, 0.1, 0.7)
    for sx in (-1, 1):
        box(dark, sx * (w / 2 + 0.03), 0, 1.4, 0.1, 0.6, 0.7)
    # Awning over the door
    a = Vector((-w * 0.2 - 1.0, -d / 2, 2.6))
    b = Vector((-w * 0.2 + 1.0, -d / 2, 2.6))
    corners = [a, b, b + Vector((0, -1.4, -0.4)), a + Vector((0, -1.4, -0.4))]
    cloth.quad(corners, [(0, 0), (1, 0), (1, 0.7), (0, 0.7)])
    for x in (a.x, b.x):
        oriented_box(wood, Vector((x, -d / 2 - 1.4, 0)), Vector((x, -d / 2 - 1.4, 2.2)), 0.08)
    if upper:
        uw, ud, uh = upper
        block(w / 2 - uw / 2 - 0.3, d / 2 - ud / 2 - 0.3, h, uw, ud, uh)
        box(dark, w / 2 - uw / 2 - 0.3, d / 2 - ud - 0.33, h + 0.3, 0.9, 0.1, 1.8)
    export(name, [clay.to_object(name), wood.to_object(name + '-wood'), dark.to_object(name + '-dark'),
                  cloth.to_object(name + '-cloth')])


def stilt_hut(name):
    """Swamp hut on stilts: plank walls, reed roof, a platform in front and a ladder"""
    clear_scene()
    planks = Part(pbr_material('planks-weathered', 'weathered_planks'), uv_metres=2.0)
    posts = Part(pbr_material('bark-bark_willow', 'bark_willow'), smooth=True)
    reed = Part(pbr_material('roof-reed_roof_04', 'reed_roof_04'))
    dark = Part(flat_material('window', (0.04, 0.04, 0.04), 0.7))
    w, d, z0 = 5.0, 4.0, 2.2
    for x in (-w / 2, 0, w / 2):
        for y in (-d / 2 - 1.6, -d / 2, d / 2):
            tube(posts, [Vector((x, y, -1.0)), Vector((x, y, z0))], [0.13, 0.11], 6)
    box(planks, 0, -0.8, z0, w + 0.4, d + 1.8, 0.15)
    box(planks, 0, 0, z0 + 0.15, w, d, 2.3)
    for sx in (-1, 1):
        bm = planks.bm
        x = sx * w / 2
        tri = [bm.verts.new((x, -d / 2, z0 + 2.45)), bm.verts.new((x, d / 2, z0 + 2.45)), bm.verts.new((x, 0, z0 + 4.0))]
        bm.faces.new(tri if sx > 0 else list(reversed(tri)))
    gable_roof(reed, w, d, z0 + 2.45, 1.55, 0.6)
    box(dark, 0, -d / 2 - 0.03, z0 + 0.15, 1.0, 0.1, 1.9)
    box(dark, w / 4 + 0.6, -d / 2 - 0.03, z0 + 1.1, 0.7, 0.1, 0.6)
    # Ladder down from the platform
    for sx in (-0.3, 0.3):
        oriented_box(posts, Vector((sx, -d / 2 - 2.8, -0.2)), Vector((sx, -d / 2 - 1.7, z0 + 0.1)), 0.07)
    for k in range(6):
        t = (k + 0.5) / 6
        p = Vector((0, -d / 2 - 2.8 + 1.1 * t, -0.2 + (z0 + 0.3) * t))
        oriented_box(posts, p - Vector((0.3, 0, 0)), p + Vector((0.3, 0, 0)), 0.05)
    export(name, [planks.to_object(name), posts.to_object(name + '-posts'), reed.to_object(name + '-roof'),
                  dark.to_object(name + '-dark')])


def round_hut(name):
    clear_scene()
    walls = Part(pbr_material('wall-clay_plaster', 'clay_plaster', (1.05, 0.95, 0.85)), smooth=True)
    thatch = Part(pbr_material('roof-reed_roof_04', 'reed_roof_04'))
    dark = Part(flat_material('window', (0.04, 0.04, 0.04), 0.7))
    tube(walls, [Vector((0, 0, -0.3)), Vector((0, 0, 2.4))], [2.6, 2.5], 16)
    cone_roof(thatch, 0, 0, 2.2, 3.2, 3.4, 16)
    box(dark, 0, -2.52, 0, 0.9, 0.1, 1.8)
    export(name, [walls.to_object(name), thatch.to_object(name + '-roof'), dark.to_object(name + '-dark')])


def watchtower(name):
    """Wooden watchtower: four posts with braces, platform at 7 m with railing, pyramid roof"""
    clear_scene()
    wood = Part(pbr_material('planks-dark', 'dark_planks', (1.0, 0.9, 0.8)), uv_metres=1.5)
    planks = Part(pbr_material('planks-weathered', 'weathered_planks'), uv_metres=2.0)
    roof = Part(pbr_material('roof-roof_planks', 'roof_planks', (0.8, 0.75, 0.7)))
    s, z = 3.6, 7.0
    for cx in (-1, 1):
        for cy in (-1, 1):
            oriented_box(wood, Vector((cx * s * 0.62, cy * s * 0.62, -0.5)), Vector((cx * s / 2, cy * s / 2, z + 3.2)), 0.25)
    for zz in (2.0, 4.5):
        for k in range(4):
            a = [(-1, -1), (1, -1), (1, 1), (-1, 1)][k]
            b = [(-1, -1), (1, -1), (1, 1), (-1, 1)][(k + 1) % 4]
            f = 0.62 - 0.12 * zz / z
            oriented_box(wood, Vector((a[0] * s * f, a[1] * s * f, zz)), Vector((b[0] * s * f, b[1] * s * f, zz + 2.2)), 0.12)
    box(planks, 0, 0, z, s + 0.6, s + 0.6, 0.18)
    for side in (-1, 1):
        box(planks, 0, side * (s / 2 + 0.25), z + 0.18, s + 0.6, 0.08, 1.0)
        box(planks, side * (s / 2 + 0.25), 0, z + 0.18, 0.08, s + 0.6, 1.0)
    pyramid_roof(roof, s, s, z + 3.2, 1.8, 0.5)
    export(name, [wood.to_object(name), planks.to_object(name + '-planks'), roof.to_object(name + '-roof')])


def lighthouse(name):
    """White tapered tower with red bands, gallery and a glowing lantern room"""
    clear_scene()
    walls = Part(pbr_material('wall-whitewashed_brick', 'whitewashed_brick', (1.1, 1.1, 1.1)), smooth=True)
    red = Part(flat_material('lighthouse-red', (0.55, 0.08, 0.06), 0.6), smooth=True)
    iron = Part(flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8))
    glass = Part(flat_material('lamp-glass', (1.0, 0.85, 0.5), 0.2, emission=(1.0, 0.8, 0.45), strength=1.0), smooth=True)
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=2.0)
    h = 18.0
    tube(stone, [Vector((0, 0, -0.5)), Vector((0, 0, 1.2))], [4.0, 3.9], 16)
    tube(walls, [Vector((0, 0, 1.2)), Vector((0, 0, h))], [3.2, 2.1], 16, cap=True)
    for z0, z1 in ((6.0, 8.5), (12.5, 15.0)):
        r0 = 3.2 - 1.1 * (z0 - 1.2) / (h - 1.2) + 0.03
        r1 = 3.2 - 1.1 * (z1 - 1.2) / (h - 1.2) + 0.03
        tube(red, [Vector((0, 0, z0)), Vector((0, 0, z1))], [r0, r1], 16)
    tube(iron, [Vector((0, 0, h)), Vector((0, 0, h + 0.25))], [3.0, 3.0], 16, cap=True)
    for k in range(16):
        a = k / 16 * math.tau
        p = Vector((math.cos(a) * 2.9, math.sin(a) * 2.9, h + 0.25))
        oriented_box(iron, p, p + Vector((0, 0, 1.0)), 0.06)
    pts = [Vector((math.cos(k / 16 * math.tau) * 2.9, math.sin(k / 16 * math.tau) * 2.9, h + 1.2)) for k in range(17)]
    for a, b in zip(pts, pts[1:]):
        oriented_box(iron, a, b, 0.06)
    tube(glass, [Vector((0, 0, h + 0.25)), Vector((0, 0, h + 2.6))], [1.5, 1.5], 12)
    cone_roof(iron, 0, 0, h + 2.6, 1.8, 1.6, 12)
    box(iron, 0, -3.2, 0, 1.2, 0.2, 2.3)
    export(name, [stone.to_object(name + '-base'), walls.to_object(name), red.to_object(name + '-bands'),
                  iron.to_object(name + '-iron'), glass.to_object(name + '-lamp')])


# ---------------------------------------------------------------- bridges, boardwalks, piers

def stone_bridge(name, length=20.0, width=4.6, rise=4.0, span=10.0):
    """Humpback bridge along X: one round arch, deck rising from 0.4 m at the ends to `rise`,
    parapets; set the object's height so the ends meet the banks"""
    clear_scene()
    stone = Part(pbr_material('stone-stacked', 'stacked_stone_wall'), uv_metres=2.5)
    deck = Part(pbr_material('road-cobble', 'castle_wall_slates', (0.9, 0.9, 0.9)), uv_metres=2.0)
    n = 24
    r = span / 2
    arch_rise = rise - 1.4

    def deck_z(x):
        return 0.4 + (rise - 0.4) * math.cos(min(1.0, abs(x) / (length / 2)) * math.pi / 2) ** 0.8

    for k in range(n):
        x0 = -length / 2 + k * length / n
        x1 = x0 + length / n
        xm = (x0 + x1) / 2
        top = deck_z(xm)
        if abs(xm) < r:
            bottom = arch_rise * math.sqrt(max(0.0, 1 - (xm / r) ** 2))
        else:
            bottom = -1.5
        box(stone, xm, 0, bottom, x1 - x0 + 0.02, width, top - bottom)
        box(deck, xm, 0, top, x1 - x0 + 0.02, width - 0.8, 0.05)
        for side in (-1, 1):
            box(stone, xm, side * (width / 2 - 0.2), top, x1 - x0 + 0.02, 0.4, 0.8)
    export(name, [stone.to_object(name), deck.to_object(name + '-deck')])


def wooden_bridge(name, length=14.0, width=3.0, height=3.0):
    """Trestle footbridge along X: plank deck at `height`, leg pairs down to 1.5 m below the base, railings"""
    clear_scene()
    planks = Part(pbr_material('planks-bridge', 'brown_planks_07', (0.8, 0.75, 0.7)), uv_metres=2.0)
    beams = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.5)
    box(planks, 0, 0, height - 0.12, length, width, 0.12)
    for y in (-width / 2 + 0.2, 0, width / 2 - 0.2):
        box(beams, 0, y, height - 0.45, length, 0.16, 0.33)
    legs = int(length // 3.5) + 1
    for k in range(legs):
        x = -length / 2 + 0.3 + k * (length - 0.6) / (legs - 1)
        for y in (-width / 2 + 0.2, width / 2 - 0.2):
            box(beams, x, y, -1.5, 0.28, 0.28, height + 1.5 - 0.45)
        oriented_box(beams, Vector((x, -width / 2 + 0.2, -0.5)), Vector((x, width / 2 - 0.2, height - 0.6)), 0.12)
        for y in (-width / 2, width / 2):
            box(beams, x, y, height, 0.14, 0.12, 1.05)
    for y in (-width / 2, width / 2):
        box(beams, 0, y, height + 0.95, length, 0.12, 0.12)
        box(beams, 0, y, height + 0.5, length, 0.06, 0.1)
    export(name, [planks.to_object(name), beams.to_object(name + '-beams')])


def boardwalk(name, length=4.0, width=1.8, height=0.6, platform=False):
    """Boardwalk piece along X, deck top at `height`, posts down to 1.2 m below the base (sunk in the mud)"""
    clear_scene()
    planks = Part(pbr_material('planks-weathered', 'weathered_planks'), uv_metres=1.5)
    posts = Part(pbr_material('bark-bark_willow', 'bark_willow', (0.8, 0.8, 0.75)), smooth=True)
    w = length if platform else width
    rnd = random.Random(int(length * 10 + width))
    n = int(length / 0.3)
    for k in range(n):
        x = -length / 2 + (k + 0.5) * length / n
        box(planks, x, rnd.uniform(-0.04, 0.04), height - 0.07, length / n - 0.03, w + rnd.uniform(-0.08, 0.08), 0.07,
            rnd.uniform(-0.02, 0.02))
    for y in (-w / 2 + 0.15, w / 2 - 0.15):
        box(planks, 0, y, height - 0.25, length, 0.12, 0.18)
        for x in (-length / 2 + 0.2, length / 2 - 0.2):
            tube(posts, [Vector((x, y, -1.2)), Vector((x, y, height - 0.07))], [0.1, 0.09], 6)
    if platform:
        box(planks, 0, 0, height - 0.25, 0.12, length, 0.18)
        for x in (-length / 2 + 0.2, length / 2 - 0.2):
            tube(posts, [Vector((x, 0, -1.2)), Vector((x, 0, height - 0.07))], [0.1, 0.09], 6)
    export(name, [planks.to_object(name), posts.to_object(name + '-posts')])


# ---------------------------------------------------------------- walls, fences, gates

def palisade(name, length=4.0, height=4.5, gate=False):
    """Sharpened log wall along X; `gate`: a 4 m wide double gate between two thick posts"""
    clear_scene()
    logs = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02', (0.9, 0.85, 0.8)), smooth=True)
    beams = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.5)
    rnd = random.Random(int(length * 7) + (1 if gate else 0))
    if not gate:
        n = int(length / 0.38)
        for k in range(n):
            x = -length / 2 + (k + 0.5) * length / n
            h = height * rnd.uniform(0.92, 1.05)
            tube(logs, [Vector((x, 0, -0.8)), Vector((x, 0, h - 0.5)), Vector((x, 0, h))], [0.19, 0.18, 0.02], 7)
        for z in (1.0, height - 1.3):
            box(beams, 0, 0.25, z, length, 0.14, 0.24)
        export(name, [logs.to_object(name), beams.to_object(name + '-beams')])
        return
    for sx in (-1, 1):
        tube(logs, [Vector((sx * 2.3, 0, -0.8)), Vector((sx * 2.3, 0, height + 1.0)), Vector((sx * 2.3, 0, height + 1.5))],
             [0.32, 0.3, 0.05], 8)
    box(beams, 0, 0, height + 0.2, 5.0, 0.4, 0.4)
    for sx in (-1, 1):
        for k in range(5):
            x = sx * (0.2 + k * 0.4)
            box(beams, x, 0, 0, 0.36, 0.12, height - 0.2)
        for z in (0.6, height - 1.2):
            box(beams, sx * 1.0, -0.1, z, 2.0, 0.08, 0.22)
    export(name, [logs.to_object(name), beams.to_object(name + '-gate')])


def picket_fence(name, length=4.0):
    clear_scene()
    wood = Part(pbr_material('wood-planks-grey', 'wood_planks_grey', (1.25, 1.22, 1.18)), uv_metres=1.0)
    for x in (-length / 2, 0, length / 2):
        box(wood, x, 0, 0, 0.12, 0.12, 1.2)
    for z in (0.3, 0.8):
        box(wood, 0, 0.08, z, length, 0.04, 0.1)
    n = int(length / 0.16)
    for k in range(n):
        x = -length / 2 + (k + 0.5) * length / n
        box(wood, x, -0.04, 0.05, 0.09, 0.03, 1.0)
    export(name, [wood.to_object(name)])


def rail_fence(name, length=4.0):
    """Rustic split-rail fence: three rails between crossed posts"""
    clear_scene()
    wood = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02', (0.75, 0.72, 0.68)), smooth=True)
    for x in (-length / 2, length / 2):
        tube(wood, [Vector((x, 0, -0.3)), Vector((x, 0, 1.3))], [0.09, 0.08], 6)
    for z in (0.35, 0.7, 1.05):
        tube(wood, [Vector((-length / 2 - 0.1, 0.12, z)), Vector((length / 2 + 0.1, 0.12, z + 0.04))], [0.06, 0.055], 5)
    export(name, [wood.to_object(name)])


def farm_gate(name):
    clear_scene()
    wood = Part(pbr_material('wood-rough', 'rough_wood', (0.8, 0.72, 0.62)), uv_metres=1.5)
    for x in (-1.8, 1.8):
        box(wood, x, 0, -0.4, 0.22, 0.22, 1.9)
    for z in (0.2, 0.6, 1.0, 1.3):
        box(wood, 0, 0, z, 3.4, 0.08, 0.12)
    oriented_box(wood, Vector((-1.6, 0, 0.25)), Vector((1.6, 0, 1.35)), 0.1)
    box(wood, -1.6, 0, 0.2, 0.14, 0.1, 1.25)
    box(wood, 1.6, 0, 0.2, 0.14, 0.1, 1.25)
    export(name, [wood.to_object(name)])


def dry_stone_wall(name, length=6.0, seed=0, ruined=False):
    """Field wall of stacked stones along X; `ruined`: gaps and a lowered middle"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('stone-rock_wall_10', 'rock_wall_10'), uv_metres=1.5)
    n = 8
    for k in range(n):
        x = -length / 2 + (k + 0.5) * length / n
        h = 1.2 * rnd.uniform(0.9, 1.05)
        if ruined:
            h *= 0.35 + 0.65 * abs(math.cos(k / (n - 1) * math.pi))
        box(stone, x, rnd.uniform(-0.04, 0.04), -0.2, length / n + 0.02, 0.7 - 0.2 * (k % 2) * 0.2, h + 0.2, rnd.uniform(-0.03, 0.03))
        box(stone, x, 0, h, length / n * 0.9, 0.5, 0.18, rnd.uniform(-0.1, 0.1))
    export(name, [stone.to_object(name)])


# ---------------------------------------------------------------- ruins, monuments

def ruin_wall(name, seed=0):
    """Broken church wall 10 m long with an arched window and a ragged top"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=3.0)
    length, thick = 10.0, 1.0
    cols = 10
    for k in range(cols):
        x0 = -length / 2 + k * length / cols
        x1 = x0 + length / cols
        xm = (x0 + x1) / 2
        top = 3.0 + 4.5 * math.sin((k + 0.5) / cols * math.pi) * rnd.uniform(0.75, 1.05)
        if abs(xm) < 1.2:
            box(stone, xm, 0, -0.5, x1 - x0 + 0.01, thick, 2.6)
            if top > 5.8:
                box(stone, xm, 0, 5.4 + 0.4 * math.cos(xm / 1.2 * math.pi / 2), x1 - x0 + 0.01, thick, top - 5.4)
        else:
            box(stone, xm, 0, -0.5, x1 - x0 + 0.01, thick, top + 0.5)
    for k in range(8):
        box(stone, rnd.uniform(-5, 5), rnd.uniform(-2.5, -0.8), -0.15, rnd.uniform(0.3, 0.8), rnd.uniform(0.3, 0.6),
            rnd.uniform(0.2, 0.45), rnd.uniform(0, 3))
    export(name, [stone.to_object(name)])


def ruin_columns(name, seed=0):
    """Temple remains: a stepped platform, standing and broken columns, one fallen"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('wall-white_sandstone_bricks', 'white_sandstone_bricks', (1.05, 1.0, 0.95)), uv_metres=2.0)
    col = Part(pbr_material('rock-sandstone_cracks', 'sandstone_cracks', (1.1, 1.05, 1.0)), smooth=True)
    box(stone, 0, 0, -0.3, 12, 7, 0.6)
    box(stone, 0, 0, 0.3, 11, 6, 0.3)
    heights = [6.0, 3.2, 6.0, 1.5, 4.6, 6.0]
    for k, h in enumerate(heights):
        x = -4.5 + (k % 3) * 4.5
        y = -2.0 if k < 3 else 2.0
        tube(col, [Vector((x, y, 0.6)), Vector((x, y, 0.6 + h))], [0.55, 0.48], 12)
        box(stone, x, y, 0.6, 1.4, 1.4, 0.35)
        if h > 5.5:
            box(stone, x, y, 0.6 + h, 1.4, 1.4, 0.45)
    box(stone, -2.25, -2.0, 7.05, 6.0, 1.2, 0.7)
    tube(col, [Vector((2.0, 4.6, 0.6)), Vector((6.5, 5.2, 0.55))], [0.5, 0.5], 12, cap=True)
    export(name, [stone.to_object(name), col.to_object(name + '-columns')])


def ruin_arch(name):
    """A freestanding broken arch 6 m wide"""
    clear_scene()
    stone = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=3.0)
    arch_wall(stone, -4.5, 4.5, 0, 1.4, -0.5, 7.5, 0, 5.0, 3.5, steps=14)
    export(name, [stone.to_object(name)])


def obelisk(name, height=9.0):
    clear_scene()
    stone = Part(pbr_material('wall-sandstone_blocks_04', 'sandstone_blocks_04'), uv_metres=2.0)
    box(stone, 0, 0, -0.3, 2.6, 2.6, 1.0)
    bm = stone.bm
    b, t = 0.75, 0.5
    lo = [bm.verts.new((x * b, y * b, 0.7)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    hi = [bm.verts.new((x * t, y * t, height - 0.8)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    apex = bm.verts.new((0, 0, height))
    for k in range(4):
        bm.faces.new((lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k]))
        bm.faces.new((hi[k], hi[(k + 1) % 4], apex))
    export(name, [stone.to_object(name)])


def shrine(name):
    """Wayside shrine: stone pillar with a little gabled roof and a candle niche"""
    clear_scene()
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=1.5)
    roof = Part(pbr_material('roof-clay_roof_tiles_02', 'clay_roof_tiles_02'))
    dark = Part(flat_material('niche', (0.06, 0.05, 0.05), 0.9))
    flame = Part(flat_material('candle', (1.0, 0.75, 0.35), 0.5, emission=(1.0, 0.65, 0.25), strength=1.0))
    box(stone, 0, 0, -0.2, 1.1, 1.1, 0.5)
    box(stone, 0, 0, 0.3, 0.7, 0.7, 1.9)
    box(dark, 0, -0.36, 1.3, 0.4, 0.05, 0.6)
    box(flame, 0, -0.37, 1.35, 0.06, 0.04, 0.16)
    gable_roof(roof, 0.9, 0.9, 2.2, 0.45, 0.12)
    for sx in (-1, 1):
        bm = stone.bm
        x = sx * 0.45
        tri = [bm.verts.new((x, -0.45, 2.2)), bm.verts.new((x, 0.45, 2.2)), bm.verts.new((x, 0, 2.65))]
        bm.faces.new(tri if sx > 0 else list(reversed(tri)))
    export(name, [stone.to_object(name), roof.to_object(name + '-roof'), dark.to_object(name + '-niche'),
                  flame.to_object(name + '-flame')])


def statue(name, asset, height):
    """A Poly Haven statue on a stone plinth"""
    def plinth(obj):
        for v in obj.data.vertices:
            v.co.z += 1.2
        stone = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=1.5)
        box(stone, 0, 0, -0.3, 2.2, 2.2, 1.3)
        box(stone, 0, 0, 1.0, 1.8, 1.8, 0.2)
        return [stone.to_object(name + '-plinth')]

    import_model(asset, height, 6000, name, extra=plinth)


def graves(name, seed):
    """A row of gravestones and a cross"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates', (0.85, 0.85, 0.85)), uv_metres=1.0)
    earth = Part(pbr_material('rock-dark_rock', 'dark_rock', (1.6, 1.4, 1.2)), uv_metres=1.0)
    for k in range(3):
        x = -1.8 + k * 1.8
        tilt = rnd.uniform(-0.08, 0.08)
        if k == 1:
            box(stone, x, 0, -0.3, 0.16, 0.16, 1.6, tilt)
            box(stone, x, 0, 0.9, 0.7, 0.16, 0.16, tilt)
        else:
            box(stone, x, 0, -0.3, 0.7, 0.16, 1.2 + rnd.uniform(-0.2, 0.2), tilt)
            tube(stone, [Vector((x - 0.35, 0, 0.9)), Vector((x + 0.35, 0, 0.9))], [0.08, 0.08], 6)
        box(earth, x, 0.9, -0.15, 0.8, 1.7, 0.3)
    export(name, [stone.to_object(name), earth.to_object(name + '-mound')])


# ---------------------------------------------------------------- market and camps

def market_stall(name, cloth_tint):
    clear_scene()
    wood = Part(pbr_material('planks-dark', 'dark_planks', (1.0, 0.9, 0.8)), uv_metres=1.0)
    counter = Part(pbr_material('planks-crate', 'brown_planks_04'), uv_metres=1.0)
    cloth = Part(two_sided(pbr_material('cloth-hessian-' + '-'.join('%.2f' % c for c in cloth_tint), 'hessian_230', cloth_tint)))
    w, d = 3.2, 2.0
    for x in (-w / 2, w / 2):
        for y, h in ((-d / 2, 2.6), (d / 2, 2.2)):
            box(wood, x, y, 0, 0.12, 0.12, h)
    box(counter, 0, -d / 2 + 0.2, 0, w, 0.5, 1.0)
    box(counter, 0, 0, 0.9, w - 0.1, d - 0.2, 0.06)
    corners = [Vector((-w / 2 - 0.2, -d / 2 - 0.5, 2.5)), Vector((w / 2 + 0.2, -d / 2 - 0.5, 2.5)),
               Vector((w / 2 + 0.2, d / 2 + 0.1, 2.25)), Vector((-w / 2 - 0.2, d / 2 + 0.1, 2.25))]
    cloth.quad(corners, [(0, 0), (1.5, 0), (1.5, 1), (0, 1)])
    goods = Part(flat_material('goods', (0.75, 0.45, 0.15), 0.7))
    rnd = random.Random(len(name))
    for k in range(7):
        box(goods, rnd.uniform(-w / 2 + 0.3, w / 2 - 0.3), rnd.uniform(-0.6, 0.3), 0.96, 0.25, 0.25, 0.18, rnd.uniform(0, 2))
    export(name, [wood.to_object(name), counter.to_object(name + '-counter'), cloth.to_object(name + '-cloth'),
                  goods.to_object(name + '-goods')])


def tent(name, large=False):
    """Canvas tent: A-frame (small) or a round pavilion with a cone top (large)"""
    clear_scene()
    canvas = Part(two_sided(pbr_material('cloth-canvas', 'hessian_230', (1.3, 1.25, 1.15))))
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    dark = Part(flat_material('tent-inside', (0.08, 0.07, 0.05), 0.9))
    if not large:
        l, w, h = 3.6, 2.6, 2.2
        # Ridge along Y, entrance at the front (-Y)
        for side in (-1, 1):
            corners = [Vector((side * w / 2, l / 2, 0)), Vector((side * w / 2, -l / 2, 0)), Vector((0, -l / 2, h)), Vector((0, l / 2, h))]
            if side < 0:
                corners = list(reversed(corners))
            canvas.quad(corners, [(0, 0), (1.5, 0), (1.5, 1), (0, 1)])
        for flip in (False,):
            back = [canvas.bm.verts.new(c) for c in ((-w / 2, l / 2, 0), (w / 2, l / 2, 0), (0, l / 2, h))]
            canvas.bm.faces.new(list(reversed(back)) if flip else back)
            front = [dark.bm.verts.new(c) for c in ((-w / 2 * 0.7, -l / 2 + 0.02, 0), (w / 2 * 0.7, -l / 2 + 0.02, 0),
                                                    (0, -l / 2 + 0.02, h * 0.7))]
            dark.bm.faces.new(list(reversed(front)) if flip else front)
        for y in (-l / 2 - 0.1, l / 2 + 0.1):
            box(wood, 0, y, 0, 0.08, 0.08, h + 0.2)
        export(name, [canvas.to_object(name), wood.to_object(name + '-poles'), dark.to_object(name + '-door')])
        return
    r, wall = 3.4, 1.8
    tube(canvas, [Vector((0, 0, 0)), Vector((0, 0, wall))], [r, r], 16)
    tube(canvas, [Vector((0, 0, wall)), Vector((0, 0, wall))], [r, r], 16)
    cone_roof(canvas, 0, 0, wall, r + 0.3, 2.4, 16)
    box(wood, 0, 0, wall + 2.2, 0.1, 0.1, 1.2)
    box(dark, 0, -r - 0.02, 0, 1.2, 0.05, 1.6)
    flag = Part(two_sided(flat_material('flag-red', (0.6, 0.08, 0.06), 0.8)))
    flag.quad([Vector((0, 0, wall + 2.9)), Vector((0.8, 0, wall + 3.1)), Vector((0.8, 0, wall + 3.4)), Vector((0, 0, wall + 3.4))],
              [(0, 0), (1, 0), (1, 1), (0, 1)])
    export(name, [canvas.to_object(name), wood.to_object(name + '-pole'), dark.to_object(name + '-door'),
                  flag.to_object(name + '-flag')])


# ---------------------------------------------------------------- catalogue

def models():
    def watermill_wheel(w, d, wall_h, pitch):
        return mill_wheel(w, d, wall_h, pitch)

    return {
        # Castle kit
        'castle-wall': lambda: castle_wall('castle-wall'),
        'castle-wall-ruined': lambda: castle_wall('castle-wall-ruined', RUIN, ruined=True, seed=1),
        'castle-wall-ruined-b': lambda: castle_wall('castle-wall-ruined-b', RUIN, ruined=True, seed=4),
        'castle-tower': lambda: castle_tower('castle-tower'),
        'castle-tower-roof': lambda: castle_tower('castle-tower-roof', roof=True),
        'castle-tower-ruined': lambda: castle_tower('castle-tower-ruined', stone_asset=RUIN, height=7.0),
        'castle-gate': lambda: castle_gate('castle-gate'),
        'castle-keep': lambda: castle_keep('castle-keep'),
        'castle-stairs': lambda: castle_stairs('castle-stairs'),
        # Village
        'cottage': lambda: house('cottage', 6.0, 4.6, 3.0, 'reed_roof_04', 'beige_wall_001', wall_tint=(1.0, 0.96, 0.9)),
        'house-stone': lambda: house('house-stone', 8.0, 5.5, 4.2, 'roof_slates_02', 'stacked_stone_wall', frame=False),
        'house-tall': lambda: house('house-tall', 6.0, 6.0, 8.0, 'clay_roof_tiles_02', 'beige_wall_001', storeys=2,
                                    wall_tint=(1.0, 0.95, 0.88)),
        'house-snow': lambda: house('house-snow', 7.0, 5.0, 3.6, 'grey_roof_tiles', 'grey_plaster_02', wall_tint=(1.05, 1.0, 0.95), snow=True),
        'house-stone-snow': lambda: house('house-stone-snow', 8.0, 5.5, 4.2, 'roof_slates_02', 'stacked_stone_wall', frame=False, snow=True),
        'log-cabin': lambda: log_cabin('log-cabin'),
        'log-cabin-snow': lambda: log_cabin('log-cabin-snow', snow=True),
        'barn-snow': lambda: house('barn-snow', 11.0, 7.5, 4.2, 'grey_roof_tiles', 'brown_planks_07', barn=True, snow=True),
        'watermill': lambda: house('watermill', 8.0, 6.0, 4.4, 'roof_slates_02', 'stacked_stone_wall', frame=False, extra=watermill_wheel),
        'windmill': lambda: windmill('windmill'),
        'chapel': lambda: chapel('chapel'),
        'watchtower': lambda: watchtower('watchtower'),
        'lighthouse': lambda: lighthouse('lighthouse'),
        'hut-stilts': lambda: stilt_hut('hut-stilts'),
        'hut-round': lambda: round_hut('hut-round'),
        'adobe-house': lambda: adobe('adobe-house', 6.0, 5.0, 3.0),
        'adobe-house-large': lambda: adobe('adobe-house-large', 9.0, 7.0, 3.4, upper=(4.5, 4.0, 2.8)),
        'market-stall-red': lambda: market_stall('market-stall-red', (1.2, 0.4, 0.3)),
        'market-stall-blue': lambda: market_stall('market-stall-blue', (0.45, 0.6, 1.2)),
        'tent': lambda: tent('tent'),
        'tent-large': lambda: tent('tent-large', large=True),
        # Bridges and walkways
        'bridge-stone': lambda: stone_bridge('bridge-stone'),
        'bridge-wood': lambda: wooden_bridge('bridge-wood'),
        'boardwalk': lambda: boardwalk('boardwalk'),
        'boardwalk-platform': lambda: boardwalk('boardwalk-platform', length=4.0, platform=True),
        'pier': lambda: import_model('modular_wooden_pier', None, 6000, 'pier', objects=['modular_wooden_pier_section_02'], keep_scale=True, rot=90,
                                     extra=waterline(1.4)),
        'pier-end': lambda: import_model('modular_wooden_pier', None, 7000, 'pier-end', objects=['modular_wooden_pier_section_01'], keep_scale=True,
                                         rot=90, extra=waterline(1.4)),
        # Walls, fences, gates
        'palisade': lambda: palisade('palisade'),
        'palisade-gate': lambda: palisade('palisade-gate', gate=True),
        'fence-picket': lambda: picket_fence('fence-picket'),
        'fence-rail': lambda: rail_fence('fence-rail'),
        'gate-farm': lambda: farm_gate('gate-farm'),
        'wall-dry-stone': lambda: dry_stone_wall('wall-dry-stone', seed=3),
        'wall-dry-stone-ruined': lambda: dry_stone_wall('wall-dry-stone-ruined', seed=5, ruined=True),
        'fort-wall': lambda: import_model('modular_fort_01', None, 3000, 'fort-wall', objects=['modular_fort_01_wall_thick_straight_01'], keep_scale=True, rot=90),
        'fort-tower': lambda: import_model('modular_fort_01', None, 5000, 'fort-tower', objects=['modular_fort_01_tower_round'], keep_scale=True),
        'iron-gate': lambda: import_model('large_iron_gate', None, 4000, 'iron-gate', keep_scale=True),
        'castle-door': lambda: import_model('large_castle_door', None, 3000, 'castle-door', keep_scale=True),
        # Ruins and monuments
        'ruin-wall': lambda: ruin_wall('ruin-wall', 7),
        'ruin-columns': lambda: ruin_columns('ruin-columns', 8),
        'ruin-arch': lambda: ruin_arch('ruin-arch'),
        'obelisk': lambda: obelisk('obelisk'),
        'shrine': lambda: shrine('shrine'),
        'graves': lambda: graves('graves', 9),
        'statue-horse': lambda: statue('statue-horse', 'horse_statue_01', 2.4),
        'statue-knight': lambda: statue('statue-knight', 'gothic_statue', 2.6),
    }
