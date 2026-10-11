"""Buildings, castle kit, bridges, walls and fences of the map asset catalogue (loaded by build_models.py)."""
import math
import random

from mathutils import Matrix, Vector

from blender_kit import (
    Part, box, box_uv, card, card_material, clear_scene, export, flat_material, image_material, import_model,
    oriented_box, pbr_material, tube,
)
import blender_kit


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
          extra=None):
    """Gabled house; `frame=False` drops the timber frame (stone, log or plank walls), `snow` lays a
    white layer over the roof, `extra(w, d, wall_h, pitch)` returns more parts (mill wheel, porch)"""
    clear_scene()
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=2.0)
    walls = Part(pbr_material('wall-' + wall_asset, wall_asset, wall_tint), uv_metres=2.5 if not barn else 2.0)
    timber = Part(pbr_material('timber', 'medieval_wood', (0.45, 0.38, 0.32)), uv_metres=1.5)
    roof = Part(pbr_material('roof-' + roof_asset, roof_asset))
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
        cover = Part(flat_material('snow-cover', (0.86, 0.89, 0.93), 0.9))
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


def models():
    return {}
