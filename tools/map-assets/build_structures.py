"""Buildings, castle kit, bridges, walls and fences of the map asset catalogue (loaded by build_models.py)."""
import math
import os
import random

import bpy

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


def roof_snow():
    """snow_02 for roofs: its footprints and dark grooves lifted to a soft grey, a cold white"""
    import numpy as np
    m = pbr_material('snow-roof', 'snow_02')
    key = 'snow_02-roof'
    node = next((n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.name.startswith('snow_02_diff')), None)
    if node is None:
        return m
    if key not in bpy.data.images:
        src = node.image
        px = np.empty(src.size[0] * src.size[1] * 4, dtype=np.float32)
        src.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        px[:, :3] = (1 - (1 - px[:, :3]) * 0.35) * np.array((0.93, 0.95, 0.99), dtype=np.float32)
        img = bpy.data.images.new(key, src.size[0], src.size[1])
        img.pixels.foreach_set(px.ravel())
        folder = os.path.join(blender_kit.OUT, 'tinted')
        os.makedirs(folder, exist_ok=True)
        img.filepath_raw = os.path.join(folder, key + '.png')
        img.file_format = 'PNG'
        img.save()
    node.image = bpy.data.images[key]
    return m


def house(name, w, d, wall_h, roof_asset, wall_asset, storeys=1, barn=False, wall_tint=None, frame=True, snow=False,
          extra=None, roof_tint=None):
    """Gabled house; `frame=False` drops the timber frame (stone, log or plank walls), `snow` lays a
    white layer over the roof with rounded lips along the eaves and verges and a cushion on the ridge, and
    snow on the window sills and the step; `extra(w, d, wall_h, pitch)` returns more parts (mill wheel, porch)"""
    clear_scene()
    snow_mat = roof_snow() if snow else None
    # Rounded snow (lips, sills): the cover's material, smooth, merged with it when packed
    drift = Part(snow_mat, uv_metres=3.0, bevel=0.0, smooth=True) if snow else None
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
    glass = Part(flat_material('window-glass-old', (0.08, 0.1, 0.12), 0.08, 0.6))
    shutters = Part(pbr_material('shutter-' + ('green' if not barn else 'barn'), 'dark_planks', (0.45, 0.62, 0.45) if not frame else (0.75, 0.42, 0.3)),
                    uv_metres=1.0)

    def window(x, y, z, normal, along):
        # Frame proud of the wall, glass set back, a cross of mullions, a sill below, shutters folded open
        n, a = normal, along
        def at(u, v, du, dv):
            return u * a + v * n
        for (u, du, zz, dz) in ((-0.5, 0.1, 0.0, 1.1), (0.5, 0.1, 0.0, 1.1), (0.0, 1.1, 0.0, 0.1), (0.0, 1.1, 1.0, 0.1)):
            c = Vector((x, y, 0)) + a * u + n * 0.05
            sx, sy = (du, 0.1) if abs(a.x) > 0.5 else (0.1, du)
            box(timber, c.x, c.y, z + zz, sx, sy, dz)
        c = Vector((x, y, 0)) + n * 0.02
        box(glass, c.x, c.y, z + 0.1, 0.9 if abs(a.x) > 0.5 else 0.06, 0.06 if abs(a.x) > 0.5 else 0.9, 0.9)
        c = Vector((x, y, 0)) + n * 0.06
        box(timber, c.x, c.y, z + 0.1, 0.05 if abs(a.x) > 0.5 else 0.05, 0.05, 0.9)
        box(timber, c.x, c.y, z + 0.5, 0.9 if abs(a.x) > 0.5 else 0.05, 0.05 if abs(a.x) > 0.5 else 0.9, 0.05)
        c = Vector((x, y, 0)) + n * 0.12
        box(stone, c.x, c.y, z - 0.12, 1.3 if abs(a.x) > 0.5 else 0.22, 0.22 if abs(a.x) > 0.5 else 1.3, 0.1)
        if drift:
            box(drift, c.x, c.y, z - 0.02, 1.2 if abs(a.x) > 0.5 else 0.18, 0.18 if abs(a.x) > 0.5 else 1.2, 0.07)
        for s in (-1, 1):
            c = Vector((x, y, 0)) + a * s * 0.85 + n * 0.08
            box(shutters, c.x, c.y, z, 0.55 if abs(a.x) > 0.5 else 0.06, 0.06 if abs(a.x) > 0.5 else 0.55, 1.1)

    if not barn:
        for z in [plinth + 1.0] + ([plinth + 1.0 + (wall_h - plinth) / 2] if storeys > 1 else []):
            for x in (-w / 3, w / 3):
                for sy in (-1, 1):
                    if sy < 0 and abs(x) < 1.0:
                        continue
                    window(x, sy * d / 2, z, Vector((0, sy, 0)), Vector((1, 0, 0)))
            for sx in (-1, 1):
                window(sx * w / 2, 0, z, Vector((sx, 0, 0)), Vector((0, 1, 0)))
        # Chimney of stone with a projecting cap, a step at the door
        box(stone, w * 0.3, d * 0.2, wall_h, 0.8, 0.8, pitch * 0.8 + 1.2)
        box(stone, w * 0.3, d * 0.2, wall_h + pitch * 0.8 + 1.2, 1.0, 1.0, 0.15)
        box(dark, w * 0.3, d * 0.2, wall_h + pitch * 0.8 + 1.3, 0.5, 0.5, 0.06)
        box(stone, 0, -d / 2 - 0.45, -0.2, door_w + 0.8, 0.7, plinth * 0.3 + 0.25)
    else:
        # Vertical battens over the boards, a cross-braced door leaf, a hayloft door in the gable
        for sy in (-1, 1):
            for k in range(int(w / 0.6)):
                x = -w / 2 + 0.3 + k * 0.6
                if sy < 0 and abs(x) < door_w / 2 + 0.2:
                    continue
                box(timber, x, sy * (d / 2 + 0.03), plinth, 0.08, 0.06, wall_h - plinth - 0.1)
        for s in (-1, 1):
            oriented_box(timber, Vector((s * door_w / 4 - door_w / 4 * s * 0.9, -d / 2 - 0.14, 0.2)), Vector((s * door_w / 4 + door_w / 4 * s * 0.9, -d / 2 - 0.14, door_h - 0.2)), 0.12)
        box(timber, 0, -d / 2 - 0.14, door_h / 2, door_w, 0.08, 0.14)
        box(timber, w / 2 + 0.04, 0, wall_h + 0.3, 0.08, 1.6, 1.6)
        box(dark, w / 2 + 0.06, 0, wall_h + 0.4, 0.06, 1.3, 1.3)
    # Roof trim: fascia boards under the eaves, verge boards along the gables, a ridge cap
    ridge = Part(pbr_material('roof-' + roof_asset + '-ridge', roof_asset, (0.7, 0.7, 0.7)), uv_metres=1.0)
    over = 0.5
    eave = wall_h - over * pitch / (d / 2)
    for sy in (-1, 1):
        box(timber, 0, sy * (d / 2 + over - 0.04), eave - 0.32, w + 2 * over, 0.08, 0.22)
    for sx in (-1, 1):
        for sy in (-1, 1):
            a = Vector((sx * (w / 2 + over + 0.02), sy * (d / 2 + over), eave - 0.1))
            b = Vector((sx * (w / 2 + over + 0.02), 0, wall_h + pitch + 0.02))
            oriented_box(timber, a, b, 0.1)
    oriented_box(ridge, Vector((-w / 2 - over, 0, wall_h + pitch + 0.02)), Vector((w / 2 + over, 0, wall_h + pitch + 0.02)), 0.3)
    objects = [stone.to_object(name + '-stone'), walls.to_object(name + '-walls'), timber.to_object(name + '-timber')]
    # Roof UVs come from gable_roof, no box mapping
    objects.append(roof.to_object(name + '-roof'))
    objects.append(dark.to_object(name + '-dark'))
    for p, suffix in ((glass, '-glass'), (shutters, '-shutters'), (ridge, '-ridge')):
        if p.bm.faces:
            objects.append(p.to_object(name + suffix))
    if snow:
        cover = Part(snow_mat, uv_metres=3.0, bevel=0.0)
        gable_roof(cover, w + 0.1, d, wall_h + 0.12, pitch, 0.55)
        # Lips: lumpy rolls along the eaves and up the verges, a cushion along the ridge (its top no higher
        # than the cover), all inside the cover's outline
        hw, hd = w / 2 + 0.6, d / 2 + 0.55
        eave_s = wall_h + 0.12 - 0.55 * pitch / (d / 2)
        top_s = wall_h + 0.12 + pitch
        rnd = random.Random(len(name))
        n = max(4, int(w / 1.2))
        for sy in (-1, 1):
            pts = [Vector((-hw + 0.2 + (2 * hw - 0.4) * k / n, sy * (hd - 0.04), eave_s - 0.1)) for k in range(n + 1)]
            tube(drift, pts, [0.19 + rnd.uniform(-0.04, 0.04) for _ in pts], 8, cap=True)
            for sx in (-1, 1):
                a = Vector((sx * (hw - 0.1), sy * (hd - 0.12), eave_s + 0.02))
                b = Vector((sx * (hw - 0.1), 0, top_s - 0.1))
                tube(drift, [a, (a + b) / 2, b], [0.1, 0.11, 0.1], 6)
        # Over the ridge cap, its top level with the cap's
        tube(drift, [Vector((-hw + 0.1, 0, wall_h + pitch - 0.03)), Vector((hw - 0.1, 0, wall_h + pitch - 0.03))], [0.2, 0.2], 10, cap=True)
        if not barn:
            box(drift, 0, -d / 2 - 0.45, plinth * 0.3 + 0.05, door_w + 0.6, 0.6, 0.06)
        objects += [cover.to_object(name + '-snow'), drift.to_object(name + '-drifts')]
    if extra:
        objects += [p.to_object(name + '-extra%d' % k) for k, p in enumerate(extra(w, d, wall_h, pitch))]
    export(name, objects)


def broken_shell(part, r_out, r_in, heights, z0, rings=8):
    """Round wall between two radii, its top broken off at `heights` (one per side, the last equal to the first)"""
    bm = part.bm
    sides = len(heights) - 1
    tops = {}
    for r, flip in ((r_out, False), (r_in, True)):
        grid = []
        for k in range(rings + 1):
            row = []
            for s in range(sides + 1):
                a = s / sides * math.tau
                z = z0 + (heights[s] - z0) * k / rings
                row.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
            grid.append(row)
        for k in range(rings):
            for s in range(sides):
                q = [grid[k][s], grid[k][s + 1], grid[k + 1][s + 1], grid[k + 1][s]]
                bm.faces.new(list(reversed(q)) if flip else q)
        tops[flip] = grid[-1]
    for s in range(sides):
        bm.faces.new((tops[False][s], tops[True][s], tops[True][s + 1], tops[False][s + 1]))


def tower_ruin(name, seed):
    """Round tower broken down on one side: a mossy stone shell with a jagged crown, loose stones on its
    rim, a plinth course and a string course, slit windows, a doorway, a floor beam left inside, ivy and
    rubble at its foot"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=2.5)
    dark = Part(flat_material('hole', (0.03, 0.03, 0.03), 0.95))
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    ivy = Part(card_material('ivy-wall', 'ivy-wall.png'))
    sides = 24
    r_out, r_in = 3.6, 2.7
    heights = [12.0 - (5.5 * max(0.0, math.sin(s / sides * math.tau * 1.3 + 0.8)) + rnd.uniform(0, 1.2)) for s in range(sides + 1)]
    heights[-1] = heights[0]
    broken_shell(stone, r_out, r_in, heights, -FOUNDATION)
    # Plinth and string course: rings standing proud of the shell
    tube(stone, [Vector((0, 0, -0.5)), Vector((0, 0, 0.9))], [r_out + 0.25, r_out + 0.2], sides)
    for s in range(sides):
        a = (s + 0.5) / sides * math.tau
        if min(heights[s], heights[s + 1]) > 5.0:
            box(stone, math.cos(a) * (r_out + 0.06), math.sin(a) * (r_out + 0.06), 4.6, 0.3, math.tau * r_out / sides + 0.05, 0.28, a)
        # Loose stones along the broken rim
        if rnd.random() < 0.6:
            h = min(heights[s], heights[s + 1])
            rr = (r_out + r_in) / 2
            box(stone, math.cos(a) * rr, math.sin(a) * rr, h - 0.1, rnd.uniform(0.4, 0.7), rnd.uniform(0.4, 0.8), rnd.uniform(0.25, 0.45),
                a + rnd.uniform(-0.3, 0.3))
    # Slit windows where the wall still stands, a doorway at the front (-Y)
    for s in range(0, sides, 3):
        a = (s + 0.5) / sides * math.tau
        for z in (2.6, 7.0):
            if min(heights[s], heights[s + 1]) > z + 2.0:
                box(dark, math.cos(a) * (r_out + 0.01), math.sin(a) * (r_out + 0.01), z, 0.1, 0.32, 1.3, a)
    box(dark, 0, -r_out - 0.02, 0.0, 1.4, 0.1, 2.4)
    tube(dark, [Vector((0, -r_out - 0.07, 2.4)), Vector((0, -r_out + 0.03, 2.4))], [0.7, 0.7], 10)
    oriented_box(wood, Vector((-r_in + 0.2, 0.6, 5.2)), Vector((r_in - 0.3, -0.4, 4.4)), 0.3)
    for k in range(6):
        a = rnd.uniform(0, math.tau)
        top = rnd.uniform(4.0, 7.5)
        n = Vector((math.cos(a), math.sin(a), 0))
        p = n * (r_out + 0.04) + Vector((0, 0, top))
        card(ivy, p, Vector((0, 0, -1)), n, 1.6, top - 0.2, p - n * 8)
    rubble = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=1.5, bevel=0.0)
    from build_nature import lump
    for k in range(3):
        a = 0.5 + k * 0.5
        lump(rubble, Vector((math.cos(a) * 4.6, math.sin(a) * 4.6, -0.4)), Vector((1.3, 1.0, 0.6)), seed * 10 + k, roughness=0.45, subdiv=2)
    for k in range(9):
        a = rnd.uniform(0, math.tau)
        rr = rnd.uniform(4.0, 6.5)
        box(stone, math.cos(a) * rr, math.sin(a) * rr, -0.1, rnd.uniform(0.5, 1.1), rnd.uniform(0.4, 0.8), rnd.uniform(0.3, 0.6), rnd.uniform(0, 3))
    obj = rubble.to_object(name + '-rubble')
    for p in obj.data.polygons:
        p.use_smooth = True
    export(name, [stone.to_object(name), dark.to_object(name + '-holes'), wood.to_object(name + '-beam'), ivy.to_object(name + '-ivy'), obj])


def stone_course(part, x0, x1, y, z, h, depth, rnd, seed):
    """One course of rough stones along X: lumps of varying length, slightly out of line"""
    from build_nature import lump
    x = x0
    k = 0
    while x < x1 - 0.1:
        ln = min(x1 - x, rnd.uniform(0.35, 0.7))
        # lump() centres its shape 0.3 * size above the given point: the stone fills z .. z + h with some overlap
        sz = h * 0.62 * rnd.uniform(0.95, 1.1)
        lump(part, Vector((x + ln / 2, y + rnd.uniform(-0.04, 0.04), z + h / 2 - 0.3 * sz)),
             Vector((ln / 2 + 0.06, depth / 2 * rnd.uniform(0.9, 1.05), sz)), seed + k, roughness=0.25, flat_bottom=False, subdiv=1)
        x += ln
        k += 1


def wall_stone(name, seed, length=4.0, height=1.3, depth=0.6, ruined=False):
    """Dry stone wall along X built of rough stones course by course, battered (narrower to the top), with a
    row of upright cope stones; `ruined`: courses missing in the middle, fallen stones at the foot"""
    from build_nature import lump
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('stone-slates-wall', 'castle_wall_slates', (1.05, 1.05, 1.05)), uv_metres=0.8, bevel=0.0)
    courses = 5
    for c in range(courses):
        t = c / courses
        z = -0.2 + c * height / courses
        dep = depth * (1.0 - 0.3 * t)
        if ruined:
            cut = 0.3 + 0.7 * t
            for x0, x1 in ((-length / 2, -length / 2 + length * (1 - cut) / 2), (length / 2 - length * (1 - cut) / 2, length / 2)):
                if x1 - x0 > 0.3:
                    stone_course(stone, x0, x1, 0, z, height / courses, dep, rnd, seed * 100 + c * 10)
        else:
            stone_course(stone, -length / 2, length / 2, 0, z, height / courses, dep, rnd, seed * 100 + c * 10)
    if not ruined:
        x = -length / 2 + 0.12
        while x < length / 2 - 0.1:
            box(stone, x, 0, height - 0.15, 0.14, depth * 0.62, 0.35, rnd.uniform(-0.15, 0.15))
            x += rnd.uniform(0.17, 0.22)
    else:
        for k in range(8):
            lump(stone, Vector((rnd.uniform(-1, 1), rnd.uniform(-1.2, -0.5), -0.1)), Vector((0.25, 0.18, 0.12)), seed + 50 + k, subdiv=1)
    export(name, [stone.to_object(name)])


def fence(name):
    """Post and rail fence along X: weathered posts with pointed caps, three rails let into the posts"""
    clear_scene()
    rnd = random.Random(3)
    wood = Part(pbr_material('wood-rough', 'rough_wood', (0.8, 0.72, 0.62)), uv_metres=1.0)
    for x in (-2.0, 0.0, 2.0):
        h = 1.35 + rnd.uniform(-0.05, 0.05)
        box(wood, x, 0, -0.5, 0.15, 0.15, h + 0.5)
        bm = wood.bm
        top = [bm.verts.new((x + dx, dy, h)) for dx, dy in ((-0.075, -0.075), (0.075, -0.075), (0.075, 0.075), (-0.075, 0.075))]
        apex = bm.verts.new((x, 0, h + 0.14))
        for k in range(4):
            f = bm.faces.new((top[k], top[(k + 1) % 4], apex))
            for loop in f.loops:
                loop[wood.uv].uv = (loop.vert.co.x * 2, loop.vert.co.z * 2)
    for z in (0.35, 0.7, 1.05):
        for x0 in (-2.0, 0.0):
            sag = rnd.uniform(-0.02, 0.02)
            oriented_box(wood, Vector((x0 + 0.05, 0.1, z + sag)), Vector((x0 + 1.95, 0.1, z - sag)), 0.09)
    export(name, [wood.to_object(name)])


def well(name):
    """Village well: a round wall with a cope of stones, two posts with a gabled roof, a windlass with a crank,
    rope and bucket, dark water inside"""
    clear_scene()
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=1.0)
    cope = Part(pbr_material('stone-stacked', 'stacked_stone_wall'), uv_metres=1.0)
    wood = Part(pbr_material('wood-rough', 'rough_wood', (0.8, 0.72, 0.62)), uv_metres=1.0)
    roof = Part(pbr_material('roof-clay_roof_tiles_02', 'clay_roof_tiles_02'))
    water = Part(flat_material('well-water', (0.02, 0.05, 0.05), 0.05))
    iron = Part(flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8), smooth=True)
    rope = Part(flat_material('rope', (0.55, 0.45, 0.3), 0.9), smooth=True)
    tube(stone, [Vector((0, 0, -0.8)), Vector((0, 0, 0.85))], [1.2, 1.15], 16, smooth=True)
    tube(stone, [Vector((0, 0, 0.85)), Vector((0, 0, 0.0))], [0.92, 0.92], 16, smooth=True)
    for k in range(16):
        a = (k + 0.5) / 16 * math.tau
        box(cope, math.cos(a) * 1.06, math.sin(a) * 1.06, 0.82, 0.32, 0.46, 0.16, a)
    wb = water.bm
    disc = [wb.verts.new((math.cos(a / 16 * math.tau) * 0.92, math.sin(a / 16 * math.tau) * 0.92, 0.45)) for a in range(16)]
    wb.faces.new(disc)
    for x in (-1.15, 1.15):
        box(wood, x, 0, 0.6, 0.16, 0.16, 1.9)
        oriented_box(wood, Vector((x, 0, 2.1)), Vector((x * 0.7, 0, 2.5)), 0.1)
    box(wood, 0, 0, 2.45, 2.6, 0.12, 0.12)
    gable_roof(roof, 2.8, 1.6, 2.55, 0.7, 0.12)
    tube(wood, [Vector((-1.05, 0, 1.75)), Vector((1.05, 0, 1.75))], [0.12, 0.12], 10, cap=True)
    oriented_box(iron, Vector((1.1, 0, 1.75)), Vector((1.3, 0, 1.75)), 0.04)
    oriented_box(iron, Vector((1.3, 0, 1.75)), Vector((1.3, 0, 1.45)), 0.04)
    oriented_box(iron, Vector((1.3, 0, 1.45)), Vector((1.45, 0, 1.45)), 0.05)
    tube(rope, [Vector((0, 0, 1.65)), Vector((0, 0, 1.15))], [0.015, 0.015], 5)
    tube(wood, [Vector((0, 0, 0.88)), Vector((0, 0, 1.15))], [0.16, 0.19], 10, cap=True)
    export(name, [stone.to_object(name), cope.to_object(name + '-cope'), wood.to_object(name + '-wood'), roof.to_object(name + '-roof'),
                  water.to_object(name + '-water'), iron.to_object(name + '-iron'), rope.to_object(name + '-rope')])


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


def merlons(part, x0, x1, y, z, thick, width=0.9, gap=0.7, height=1.1, cap=0.0, cap_part=None):
    """Battlements along X between x0 and x1 at depth y; `cap`: a coping stone of that height, a little
    wider, on top of each (the total height stays), in `cap_part` if given"""
    n = max(1, int((x1 - x0 + gap) // (width + gap)))
    span = n * width + (n - 1) * gap
    start = (x0 + x1) / 2 - span / 2 + width / 2
    for k in range(n):
        box(part, start + k * (width + gap), y, z, width, thick, height - cap)
        if cap:
            box(cap_part or part, start + k * (width + gap), y, z + height - cap, width + 0.1, thick + 0.1, cap)


def ring_merlons(part, r, z, thick, count, height=1.1, cap=0.0, cap_part=None):
    for k in range(count):
        a = (k + 0.5) / count * math.tau
        box(part, math.cos(a) * r, math.sin(a) * r, z, thick, math.tau * r / count * 0.55, height - cap, a)
        if cap:
            box(cap_part or part, math.cos(a) * r, math.sin(a) * r, z + height - cap, thick + 0.1, math.tau * r / count * 0.55 + 0.1, cap, a)


def slit(stone, dark, centre, normal, z, w=0.18, h=1.3):
    """An opening in a wall face (`centre` on the face, `normal` out): the dark slot in a surround of jamb
    stones, a lintel and a sill standing proud of the face, so it reads as set into the wall. `stone` is best
    a part without chamfer (small boxes, many of them)"""
    n = Vector(normal).normalized()
    u = Vector((-n.y, n.x, 0))
    rot = math.atan2(u.y, u.x)
    c = Vector(centre)
    box(dark, c.x, c.y, z, w, 0.12, h, rot)
    for s in (-1, 1):
        p = c + u * s * (w / 2 + 0.11) + n * 0.04
        box(stone, p.x, p.y, z - 0.05, 0.22, 0.16, h + 0.1, rot)
    p = c + n * 0.05
    box(stone, p.x, p.y, z + h, w + 0.55, 0.18, 0.22, rot)
    p = c + n * 0.07
    box(stone, p.x, p.y, z - 0.18, w + 0.45, 0.22, 0.16, rot)


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


# ---------------------------------------------------------------- shapes for ruins

def hull(part, points):
    """Convex solid around the points (rough stones, voussoirs)"""
    import bmesh
    tmp = bmesh.new()
    verts = [tmp.verts.new(p) for p in points]
    bmesh.ops.convex_hull(tmp, input=verts)
    for v in [v for v in tmp.verts if not v.link_faces]:
        tmp.verts.remove(v)
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
    part.add_bmesh(tmp)
    tmp.free()


def chunk(part, centre, size, rnd, tilt=35):
    """A broken block: a box with jittered corners, turned at random up to `tilt` degrees off level"""
    rot = (Matrix.Rotation(math.radians(rnd.uniform(0, 360)), 4, 'Z') @ Matrix.Rotation(math.radians(rnd.uniform(-tilt, tilt)), 4, 'X')
           @ Matrix.Rotation(math.radians(rnd.uniform(-tilt, tilt)), 4, 'Y'))
    pts = []
    for x in (-0.5, 0.5):
        for y in (-0.5, 0.5):
            for z in (-0.5, 0.5):
                p = Vector((x * size.x, y * size.y, z * size.z)) + Vector([rnd.uniform(-0.12, 0.12) * c for c in size])
                pts.append(Vector(centre) + (rot @ p.to_4d()).to_3d())
    hull(part, pts)


def break_line(x0, x1, centres, heights, rnd, notch=0.7):
    """The top of a broken wall from x0 to x1: through the old column tops (`heights` at `centres`; the highest
    a short level stretch, so the chamfer keeps the height) with two uneven notches between each two, never
    above the line between them; returns the x positions and heights"""
    xs, tops = [x0], [heights[0]]
    for k, (c, h) in enumerate(zip(centres, heights)):
        if k:
            a, ha = centres[k - 1], heights[k - 1]
            for f in (0.33, 0.67):
                f += rnd.uniform(-0.08, 0.08)
                xs.append(a + (c - a) * f)
                tops.append(ha + (h - ha) * f - rnd.uniform(0.05, notch))
        if h == max(heights):
            xs += [c - 0.12, c + 0.12]
            tops += [h, h]
        else:
            xs.append(c)
            tops.append(h)
    xs.append(x1)
    tops.append(heights[-1])
    return xs, tops


def ragged_wall(part, xs, tops, thick, z0=-0.5, matrix=None):
    """Wall along local X (thickness across Y, centred) whose top runs through `tops` at `xs`, one closed
    solid (no seams between the pieces); `matrix` places it"""
    m = matrix or Matrix()
    keep = [0] + [i for i in range(1, len(xs)) if xs[i] - xs[i - 1] > 1e-3]
    xs = [xs[i] for i in keep]
    tops = [tops[i] for i in keep]
    bm = part.bm

    def v(x, y, z):
        return bm.verts.new(m @ Vector((x, y, z)))

    fb = [v(x, -thick / 2, z0) for x in xs]
    ft = [v(x, -thick / 2, t) for x, t in zip(xs, tops)]
    bb = [v(x, thick / 2, z0) for x in xs]
    bt = [v(x, thick / 2, t) for x, t in zip(xs, tops)]
    for i in range(len(xs) - 1):
        bm.faces.new((fb[i], fb[i + 1], ft[i + 1], ft[i]))
        bm.faces.new((bb[i + 1], bb[i], bt[i], bt[i + 1]))
        bm.faces.new((ft[i], ft[i + 1], bt[i + 1], bt[i]))
        bm.faces.new((fb[i + 1], fb[i], bb[i], bb[i + 1]))
    bm.faces.new((fb[0], ft[0], bt[0], bb[0]))
    bm.faces.new((bb[-1], bt[-1], ft[-1], fb[-1]))


def rim_stones(part, xs, tops, thick, rnd, below, matrix=None, chance=0.6):
    """Loose stones lying along a broken top, only where it stays `below` the model's highest point and
    away from the wall's ends (the catalogue footprint)"""
    m = matrix or Matrix()
    for x0, x1, t0, t1 in zip(xs, xs[1:], tops, tops[1:]):
        t = min(t0, t1)
        if t > below - 0.5 or rnd.random() > chance or min((x0 + x1) / 2 - xs[0], xs[-1] - (x0 + x1) / 2) < 0.5:
            continue
        c = m @ Vector(((x0 + x1) / 2, rnd.uniform(-thick / 4, thick / 4), t + 0.05))
        chunk(part, c, Vector((rnd.uniform(0.35, 0.6), rnd.uniform(0.3, 0.5), rnd.uniform(0.2, 0.35))), rnd, 25)


def voussoirs(part, cx, y, thick, spring, width, count=9, depth=0.45, proud=0.06):
    """Ring of wedge stones round a round arch (along X at depth y), standing a little proud of both faces"""
    r = width / 2
    for k in range(count):
        a0 = math.pi * k / count + 0.01
        a1 = math.pi * (k + 1) / count - 0.01
        pts = []
        for a in (a0, a1):
            for rr in (r - 0.02, r + depth):
                for s in (-1, 1):
                    pts.append(Vector((cx + math.cos(a) * rr, y + s * (thick / 2 + proud), spring + math.sin(a) * rr)))
        hull(part, pts)


def ragged_arch(part, x0, x1, thick, z0, cx, width, spring, xs, tops, steps=12):
    """`arch_wall` with a broken top: piers left and right of the opening through the break line (xs, tops),
    strips over the arch up to the line where it still stands"""
    r = width / 2

    def line(x):
        for a, b, ta, tb in zip(xs, xs[1:], tops, tops[1:]):
            if a <= x <= b:
                return ta + (tb - ta) * (x - a) / max(1e-6, b - a)
        return tops[0] if x < xs[0] else tops[-1]

    for lo, hi in ((x0, cx - r), (cx + r, x1)):
        cut = [lo] + [x for x in xs if lo < x < hi] + [hi]
        ragged_wall(part, cut, [line(x) for x in cut], thick, z0)
    for k in range(steps):
        a = cx - r + k * width / steps
        b = a + width / steps
        m = (a + b) / 2 - cx
        bottom = spring + math.sqrt(max(0.0, r * r - m * m))
        ta, tb = line(a), line(b)
        if min(ta, tb) > bottom + 0.2:
            ragged_wall(part, [a, b], [ta, tb], thick, bottom)


# ---------------------------------------------------------------- castle kit (8 m grid, walls 7 m high)

def fluted_drum(part, matrix, length, r0, r1, flutes=12, rnd=None):
    """Column shaft along local Z from 0 to `length`, radius r0 to r1 with a slight swelling (entasis), cut by
    `flutes` shallow grooves (smooth-shaded, they read as soft fluting); with `rnd` the top is broken off
    unevenly, else closed flat. `matrix` places it (a fallen drum lies on its side)"""
    import bmesh
    tmp = bmesh.new()
    uv = tmp.loops.layers.uv.new('UVMap')
    n = 2 * flutes
    rings = []
    for f in (0.0, 0.33, 0.67, 1.0):
        r = r0 + (r1 - r0) * f + 0.04 * r0 * math.sin(math.pi * f)
        ring = []
        for j in range(n + 1):
            a = j / n * math.tau
            rr = r * (1.0 if j % 2 == 0 else 0.92)
            z = f * length
            if rnd and f == 1.0 and j < n:
                z -= rnd.uniform(0.0, 0.45) * r0
            ring.append(tmp.verts.new((math.cos(a) * rr, math.sin(a) * rr, z)))
        if rnd and f == 1.0:
            ring[n].co.z = ring[0].co.z
        rings.append(ring)
    around = max(1.0, round(math.tau * r0 / 1.2))
    for k in range(3):
        for j in range(n):
            face = tmp.faces.new((rings[k][j], rings[k][j + 1], rings[k + 1][j + 1], rings[k + 1][j]))
            face.smooth = True
            for loop, (u, v) in zip(face.loops, ((j, k), (j + 1, k), (j + 1, k + 1), (j, k + 1))):
                loop[uv].uv = (u / n * around, v * length / 3 / 1.5)
    top = rings[-1]
    centre = tmp.verts.new((0, 0, length - (0.3 * r0 if rnd else 0.0)))
    for j in range(n):
        face = tmp.faces.new((centre, top[j], top[j + 1]))
        for loop in face.loops:
            loop[uv].uv = (loop.vert.co.x / 1.5, loop.vert.co.y / 1.5)
    part.add_bmesh(tmp, matrix)
    tmp.free()


def column(shaft, stone, x, y, z0, h, r, rnd=None):
    """A classical column standing on z0, `h` high to the top of its capital: a square plinth and a round
    base in `stone`, the fluted shaft in `shaft`, an echinus and a square abacus on top; with `rnd` it is
    broken off at z0 + h (no capital)"""
    box(stone, x, y, z0, r * 2.5, r * 2.5, 0.35)
    tube(stone, [Vector((x, y, z0 + 0.3)), Vector((x, y, z0 + 0.5))], [r * 1.22, r * 1.1], 16, smooth=False, cap=True)
    if rnd:
        fluted_drum(shaft, Matrix.Translation((x, y, z0 + 0.45)), h - 0.45, r, r * (1 - 0.12 * (h - 0.45) / 6.0), rnd=rnd)
        return
    top = z0 + h - 0.62
    fluted_drum(shaft, Matrix.Translation((x, y, z0 + 0.45)), top - z0 - 0.45, r, r * 0.84)
    tube(stone, [Vector((x, y, top - 0.02)), Vector((x, y, top + 0.32))], [r * 0.86, r * 1.25], 16, smooth=False, cap=True)
    box(stone, x, y, top + 0.32, r * 2.7, r * 2.7, 0.3)


def castle_wall(name, stone_asset=CASTLE, ruined=False, seed=0, length=8.0, height=7.0, thick=2.4):
    """Curtain wall along X, front (-Y) with battlements, walkway on top behind a low parapet"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('castle-' + stone_asset, stone_asset), uv_metres=3.0)
    if not ruined:
        dark = Part(flat_material('window', (0.03, 0.03, 0.035), 0.9))
        # Coping and slit surrounds: the wall's stone without the chamfer (merged into one draw call when packed)
        trim = Part(stone.material, uv_metres=3.0, bevel=0.0)
        box(stone, 0, 0, -0.5, length, thick, height + 0.5)
        # Battered foot, a string course under the parapet, corbels carrying the battlements
        hexa(stone, [(-length / 2, -thick / 2 - 0.7, -1.0), (length / 2, -thick / 2 - 0.7, -1.0), (length / 2, thick / 2 + 0.3, -1.0),
                     (-length / 2, thick / 2 + 0.3, -1.0)],
             [(-length / 2, -thick / 2, 1.6), (length / 2, -thick / 2, 1.6), (length / 2, thick / 2, 1.6), (-length / 2, thick / 2, 1.6)])
        box(stone, 0, -thick / 2 - 0.05, height - 1.4, length, 0.2, 0.25)
        for k in range(int(length / 1.0)):
            box(stone, -length / 2 + 0.5 + k, -thick / 2 - 0.15, height - 0.6, 0.35, 0.3, 0.6)
        box(stone, 0, -thick / 2 + 0.2, height - 0.05, length, 0.8, 0.3)
        merlons(stone, -length / 2, length / 2, -thick / 2 + 0.05, height + 0.25, 0.6, cap=0.12, cap_part=trim)
        box(stone, 0, thick / 2 - 0.25, height, length, 0.5, 0.7)
        for x in (-length / 4, length / 4):
            slit(trim, dark, (x, -thick / 2, 0), (0, -1, 0), 3.2)
        export(name, [stone.to_object(name), trim.to_object(name + '-trim'), dark.to_object(name + '-slits')])
        return
    # Ruined: the masonry broken off along a jagged line through eight column tops, loose stones on the break,
    # a battered foot, rubble in front
    cols = 8
    centres, heights = [], []
    for k in range(cols):
        x = -length / 2 + (k + 0.5) * length / cols
        t = k / (cols - 1)
        h = height * (0.35 + 0.65 * abs(math.sin(t * 2.4 + seed))) * rnd.uniform(0.85, 1.05)
        centres.append(x)
        heights.append(h)
    rubble = Part(pbr_material('castle-' + stone_asset, stone_asset), uv_metres=2.0)
    for k in range(10):
        box(rubble, rnd.uniform(-length / 2, length / 2), -thick / 2 - rnd.uniform(0.4, 2.2), -0.15,
            rnd.uniform(0.4, 0.9), rnd.uniform(0.3, 0.6), rnd.uniform(0.25, 0.5), rnd.uniform(0, 3))
    rnd = random.Random(seed + 50)
    xs, tops = break_line(-length / 2, length / 2, centres, heights, rnd)
    ragged_wall(stone, xs, tops, thick)
    rim_stones(rubble, xs, tops, thick, rnd, max(heights))
    hexa(stone, [(-length / 2, -thick / 2 - 0.5, -0.5), (length / 2, -thick / 2 - 0.5, -0.5), (length / 2, thick / 2, -0.5), (-length / 2, thick / 2, -0.5)],
         [(-length / 2, -thick / 2, 1.2), (length / 2, -thick / 2, 1.2), (length / 2, thick / 2, 1.2), (-length / 2, thick / 2, 1.2)])
    for k in range(6):
        chunk(rubble, Vector((rnd.uniform(-length / 2 + 0.5, length / 2 - 0.5), -thick / 2 - rnd.uniform(0.6, 1.8), 0.05)),
              Vector((rnd.uniform(0.4, 0.8), rnd.uniform(0.3, 0.6), rnd.uniform(0.25, 0.45))), rnd)
    export(name, [stone.to_object(name), rubble.to_object(name + '-rubble')])


def castle_wall_block(name, along=4.4, depth=4.4, height=8.6, stone_asset=CASTLE):
    """A square block of the wall kit, a little higher than the walls and as deep as their battered foot:
    the corner where two walls meet (4.4 x 4.4) or the end that closes a wall (3.2 along it). Walls reach
    into it up to its middle, so the line tool can fit them on a 2 m grid; battlements on all four sides"""
    clear_scene()
    stone = Part(pbr_material('castle-' + stone_asset, stone_asset), uv_metres=3.0)
    trim = Part(stone.material, uv_metres=3.0, bevel=0.0)
    dark = Part(flat_material('window', (0.03, 0.03, 0.035), 0.9))
    ha, hd = along / 2, depth / 2
    box(stone, 0, 0, -0.5, along, depth, height + 0.5)
    # Battered foot on all sides, a string course, corbels under the battlements
    hexa(stone, [(-ha - 0.6, -hd - 0.6, -1.0), (ha + 0.6, -hd - 0.6, -1.0), (ha + 0.6, hd + 0.6, -1.0), (-ha - 0.6, hd + 0.6, -1.0)],
         [(-ha, -hd, 1.8), (ha, -hd, 1.8), (ha, hd, 1.8), (-ha, hd, 1.8)])
    box(stone, 0, 0, height - 1.5, along + 0.3, depth + 0.3, 0.25)
    for k in range(max(2, int(along / 1.0))):
        x = -ha + 0.5 + k * (along - 1.0) / max(1, int(along / 1.0) - 1)
        for y in (-hd - 0.15, hd + 0.15):
            box(stone, x, y, height - 0.6, 0.35, 0.3, 0.6)
    for k in range(max(2, int(depth / 1.0))):
        y = -hd + 0.5 + k * (depth - 1.0) / max(1, int(depth / 1.0) - 1)
        for x in (-ha - 0.15, ha + 0.15):
            box(stone, x, y, height - 0.6, 0.3, 0.35, 0.6)
    # The parapet's top projects over the corbels; battlements round the edge
    box(stone, 0, 0, height - 0.05, along + 0.4, depth + 0.4, 0.3)
    for side in (-1, 1):
        merlons(stone, -ha, ha, side * (hd - 0.1), height + 0.25, 0.6, cap=0.12, cap_part=trim)
        for k in range(max(1, int((depth - 1.2 + 0.7) // 1.6))):
            n = max(1, int((depth - 1.2 + 0.7) // 1.6))
            y = -hd + 0.6 + (k + 0.5) * (depth - 1.2) / n
            box(stone, side * (ha - 0.1), y, height + 0.25, 0.6, 0.9, 0.98)
            box(trim, side * (ha - 0.1), y, height + 0.25 + 0.98, 0.7, 1.0, 0.12)
    for x in (-ha / 2, ha / 2) if along > 3.5 else (0.0,):
        for side in (-1, 1):
            slit(trim, dark, (x, side * hd, 0), (0, side, 0), 4.0)
    export(name, [stone.to_object(name), trim.to_object(name + '-trim'), dark.to_object(name + '-slits')])


def castle_tower(name, roof=False, stone_asset=CASTLE, radius=3.6, height=12.0, ruined=False):
    """Round tower: wider top ring with battlements, arrow slits; optional slate cone roof. `ruined`: the shell
    broken down on one side to a jagged crown (as high as the whole tower's battlements), loose stones on the
    rim, slits and a doorway where it still stands, fallen blocks inside and at its foot"""
    clear_scene()
    stone = Part(pbr_material('castle-' + stone_asset, stone_asset), uv_metres=3.0)
    # The slits of a standing tower are lit at night (night-windows.ts), a ruin's stay dark
    dark = Part(flat_material('slit' if ruined else 'window', (0.03, 0.03, 0.035), 0.9))
    if ruined:
        rnd = random.Random(len(name))
        sides = 24
        crown = height + 2.1
        raw = [5.2 * max(0.0, math.sin(s / sides * math.tau * 1.1 + 1.3)) + rnd.uniform(0, 0.9) for s in range(sides + 1)]
        heights = [crown - h + min(raw) for h in raw]
        heights[-1] = heights[0]
        tube(stone, [Vector((0, 0, -1.0)), Vector((0, 0, 2.0))], [radius * 1.22, radius * 1.02], 24, smooth=True)
        broken_shell(stone, radius, radius - 0.9, heights, 1.9)
        rubble = Part(pbr_material('castle-' + stone_asset, stone_asset), uv_metres=1.5, bevel=0.0)
        for s in range(sides):
            a = (s + 0.5) / sides * math.tau
            lo = min(heights[s], heights[s + 1])
            if lo > height * 0.55 + 0.6:
                box(stone, math.cos(a) * (radius + 0.06), math.sin(a) * (radius + 0.06), height * 0.55, 0.3,
                    math.tau * radius / sides + 0.05, 0.25, a)
            if lo < crown - 1.0 and rnd.random() < 0.5:
                rr = radius - 0.45
                chunk(rubble, Vector((math.cos(a) * rr, math.sin(a) * rr, lo + 0.08)),
                      Vector((rnd.uniform(0.4, 0.7), rnd.uniform(0.35, 0.6), rnd.uniform(0.25, 0.4))), rnd, 20)
            if s % 4 == 0:
                for z in (3.0, 6.0):
                    if lo > z + 1.8:
                        box(dark, math.cos(a) * (radius + 0.01), math.sin(a) * (radius + 0.01), z, 0.25, 0.25, 1.1, a)
        box(dark, 0, -radius - 0.05, 0.2, 1.3, 0.12, 2.3)
        # Fallen blocks on the floor inside (outside the plinth they would widen the catalogue footprint)
        for k in range(7):
            a = rnd.uniform(0, math.tau)
            rr = rnd.uniform(0.0, radius - 1.4)
            chunk(rubble, Vector((math.cos(a) * rr, math.sin(a) * rr, 2.0)),
                  Vector((rnd.uniform(0.5, 1.0), rnd.uniform(0.4, 0.7), rnd.uniform(0.3, 0.5))), rnd)
        export(name, [stone.to_object(name), rubble.to_object(name + '-rubble'), dark.to_object(name + '-slits')])
        return
    tube(stone, [Vector((0, 0, -1.0)), Vector((0, 0, 2.0)), Vector((0, 0, height))], [radius * 1.22, radius * 1.02, radius], 24, smooth=True, cap=True)
    tube(stone, [Vector((0, 0, height * 0.55)), Vector((0, 0, height * 0.55 + 0.25))], [radius * 1.04 + 0.1, radius * 1.04 + 0.1], 24, smooth=True)
    tube(stone, [Vector((0, 0, height - 0.4)), Vector((0, 0, height + 1.0))], [radius + 0.45, radius + 0.45], 24, smooth=True, cap=True)
    for k in range(16):
        a = (k + 0.5) / 16 * math.tau
        box(stone, math.cos(a) * (radius + 0.2), math.sin(a) * (radius + 0.2), height - 1.2, 0.5, 0.35, 0.8, a)
    trim = Part(stone.material, uv_metres=3.0, bevel=0.0)
    ring_merlons(stone, radius + 0.25, height + 1.0, 0.6, 14, cap=0.12, cap_part=trim)
    for k in range(6):
        a = k / 6 * math.tau + 0.3
        n = Vector((math.cos(a), math.sin(a), 0))
        for z in (3.0, 7.0):
            # The shaft tapers from 1.02 radius at 2 m to the radius at the top
            slit(trim, dark, n * radius * (1.02 - 0.02 * (z - 2.0) / (height - 2.0)), n, z, 0.2, 1.1)
    objects = [stone.to_object(name), trim.to_object(name + '-trim'), dark.to_object(name + '-slits')]
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
    dark = Part(flat_material('window', (0.03, 0.03, 0.035), 0.9))
    trim = Part(stone.material, uv_metres=3.0, bevel=0.0)
    tw = 5.0
    for sx in (-1, 1):
        x = sx * (8 - tw / 2)
        box(stone, x, 0, -0.5, tw, 5.5, 11.5)
        for side in (-1, 1):
            merlons(stone, x - tw / 2, x + tw / 2, side * (2.75 - 0.3), 11.0, 0.6, cap=0.12, cap_part=trim)
        slit(trim, dark, (x, -2.75, 0), (0, -1, 0), 6.0, 0.3, 1.2)
    # Passage block between the towers with an arch 4 m wide, springing at 3.5 m
    arch_wall(stone, -3, 3, 0, 4.4, -0.5, 9.0, 0, 4.0, 3.5)
    merlons(stone, -3, 3, -1.9, 9.0, 0.6, cap=0.12, cap_part=trim)
    box(stone, 0, 1.9, 9.0, 6, 0.6, 0.8)
    voussoirs(trim, 0, 0, 4.4, 3.5, 4.0, count=9, depth=0.5)
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
    export(name, [stone.to_object(name), trim.to_object(name + '-trim'), wood.to_object(name + '-doors'), iron.to_object(name + '-iron'),
                  dark.to_object(name + '-windows')])


def castle_keep(name, stone_asset=CASTLE):
    """Square keep 12 x 12 x 17 m with battlements, corner turrets with slate cones and windows"""
    clear_scene()
    stone = Part(pbr_material('castle-' + stone_asset, stone_asset), uv_metres=3.0)
    slates = Part(pbr_material('roof-roof_slates_02', 'roof_slates_02'))
    dark = Part(flat_material('window', (0.04, 0.045, 0.05), 0.3))
    trim = Part(stone.material, uv_metres=3.0, bevel=0.0)
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
        merlons(stone, -s / 2 + 1.5, s / 2 - 1.5, side * (s / 2 - 0.3), h, 0.6, cap=0.12, cap_part=trim)
    # Battlements on the east and west sides: rotated copies
    for side in (-1, 1):
        n = 5
        for k in range(n):
            y = -s / 2 + 1.5 + (k + 0.5) * (s - 3) / n
            box(stone, side * (s / 2 - 0.3), y, h, 0.6, 0.9, 0.98)
            box(trim, side * (s / 2 - 0.3), y, h + 0.98, 0.7, 1.0, 0.12)
    for cx in (-1, 1):
        for cy in (-1, 1):
            x, y = cx * (s / 2 - 0.4), cy * (s / 2 - 0.4)
            tube(stone, [Vector((x, y, h - 3.5)), Vector((x, y, h + 2.0))], [1.3, 1.3], 12, smooth=True, cap=True)
            cone_roof(slates, x, y, h + 2.0, 1.6, 3.2, 12)
    for z in (5.0, 10.0, 14.0):
        for k in (-1, 0, 1):
            w, hh = (0.8, 1.6) if z > 6 else (0.3, 1.2)
            for n in ((0, -1, 0), (0, 1, 0), (-1, 0, 0), (1, 0, 0)):
                c = Vector(n) * s / 2 + Vector((-n[1], n[0], 0)) * k * 3.5
                slit(trim, dark, c, n, z, w, hh)
    box(dark, 0, -s / 2 - 0.02, 0, 2.2, 0.1, 3.2)
    export(name, [stone.to_object(name), trim.to_object(name + '-trim'), slates.to_object(name + '-roofs'), dark.to_object(name + '-windows')])


def castle_stairs(name, stone_asset=CASTLE):
    """Stair block along a wall: 8 m long, rising from the ground (west) to the wall walk (east, 7 m)"""
    clear_scene()
    stone = Part(pbr_material('castle-' + stone_asset, stone_asset), uv_metres=3.0)
    stairs(stone, -4, 4, 0, 2.0, 7.0, 20)
    export(name, [stone.to_object(name)])


# ---------------------------------------------------------------- village, chapel, mills, towers

def arched_opening(trim, dark, centre, normal, z, w, h, steps=6):
    """A round-headed opening in a wall face (`centre` on the face, `normal` out), `h` up to the springing:
    the dark glass set in, jamb stones, a ring of arch stones and a sill standing proud of the face"""
    n = Vector(normal).normalized()
    u = Vector((-n.y, n.x, 0))
    rot = math.atan2(u.y, u.x)
    c = Vector(centre)
    r = w / 2
    box(dark, c.x, c.y, z, w, 0.12, h, rot)
    for k in range(steps):
        m = -r + (k + 0.5) * w / steps
        p = c + u * m
        box(dark, p.x, p.y, z + h - 0.01, w / steps + 0.01, 0.12, math.sqrt(max(0.0, r * r - m * m)) + 0.01, rot)
    for side in (-1, 1):
        p = c + u * side * (r + 0.1) + n * 0.04
        box(trim, p.x, p.y, z - 0.05, 0.2, 0.14, h + 0.05, rot)
    ring = r + 0.1
    pts = [c + n * 0.04 + u * math.cos(a) * ring + Vector((0, 0, z + h + math.sin(a) * ring))
           for a in (math.pi * k / 7 for k in range(8))]
    for a, b in zip(pts, pts[1:]):
        oriented_box(trim, a, b, 0.2)
    p = c + n * 0.07
    box(trim, p.x, p.y, z - 0.18, w + 0.45, 0.22, 0.16, rot)


def chapel(name):
    """Stone chapel: nave with slate roof on a plinth, buttresses between round-headed windows, an eaves
    course, a round window in the back gable; bell tower at the front (-Y) with string courses, louvred
    belfry openings on all four sides, an arched doorway, a pyramid spire with a cross"""
    clear_scene()
    stone = Part(pbr_material('wall-white_sandstone_bricks', 'white_sandstone_bricks'), uv_metres=2.5)
    # Courses, surrounds and buttress caps: the wall's stone without the chamfer (one draw call when packed)
    trim = Part(stone.material, uv_metres=2.5, bevel=0.0)
    roof = Part(pbr_material('roof-roof_slates_02', 'roof_slates_02'))
    dark = Part(flat_material('window', (0.05, 0.06, 0.08), 0.2, 0.3))
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.5)
    w, d, wall_h = 7.0, 13.0, 6.0
    y0, y1 = 1.0 - d / 2, 1.0 + d / 2
    # Nave runs along Y: build it along X and turn by the gable orientation (ridge along Y)
    box(stone, 0, 1.0, -0.5, w, d, wall_h + 0.5)
    box(trim, 0, 1.0, -0.5, w + 0.3, d + 0.3, 1.0)
    box(trim, 0, 1.0, wall_h - 0.3, w + 0.25, d + 0.1, 0.3)
    pitch = w * 0.55
    for sy in (-1, 1):
        y = 1.0 + sy * d / 2
        bm = stone.bm
        tri = [bm.verts.new((-w / 2, y, wall_h)), bm.verts.new((w / 2, y, wall_h)), bm.verts.new((0, y, wall_h + pitch))]
        bm.faces.new(tri if sy < 0 else list(reversed(tri)))
    # Roof planes along Y, a ridge on top
    for side in (-1, 1):
        hw = w / 2 + 0.4
        a = Vector((side * hw, y0 - 0.3, wall_h - 0.4 * pitch / (w / 2)))
        b = Vector((side * hw, y1 + 0.3, wall_h - 0.4 * pitch / (w / 2)))
        c = Vector((0, y1 + 0.3, wall_h + pitch))
        e = Vector((0, y0 - 0.3, wall_h + pitch))
        slope = (c - b).length
        quad = [a, b, c, e] if side > 0 else [b, a, e, c]
        roof.quad(quad, [(0, 0), (d / 2.2, 0), (d / 2.2, slope / 2.2), (0, slope / 2.2)])
        roof.quad([v - Vector((0, 0, 0.15)) for v in reversed(quad)], [(0, 0), (d / 2.2, 0), (d / 2.2, slope / 2.2), (0, slope / 2.2)])
    box(roof, 0, 1.0, wall_h + pitch - 0.12, 0.3, d + 0.6, 0.22)
    # Round-headed windows on the long sides, stepped buttresses between them and at the corners
    for side in (-1, 1):
        for k in range(3):
            arched_opening(trim, dark, (side * w / 2, -2.0 + k * 3.5, 0), (side, 0, 0), 2.0, 0.9, 2.0)
        for y in (y0 + 0.4, -0.25, 3.25, y1 - 0.4):
            x = side * w / 2
            hexa(stone, [(x, y - 0.35, -0.5), (x + side * 0.75, y - 0.35, -0.5), (x + side * 0.75, y + 0.35, -0.5), (x, y + 0.35, -0.5)][::side],
                 [(x, y - 0.35, 4.6), (x + side * 0.45, y - 0.35, 2.6), (x + side * 0.45, y + 0.35, 2.6), (x, y + 0.35, 4.6)][::side])
            box(trim, x + side * 0.38, y, 2.45, 0.85, 0.82, 0.16)
    # A round window in the back gable: the glass disc in a ring of stones
    tube(dark, [Vector((0, y1 - 0.05, wall_h + 1.3)), Vector((0, y1 + 0.03, wall_h + 1.3))], [0.75, 0.75], 16, smooth=False, cap=True)
    tube(trim, [Vector((0, y1 - 0.05, wall_h + 1.3)), Vector((0, y1 + 0.12, wall_h + 1.3))], [1.0, 1.0], 16, smooth=False)
    # Tower at the front: string courses, a belfry with louvred openings, an arched doorway
    t = 3.6
    ty = y0 - t / 2 + 0.2
    box(stone, 0, ty, -0.5, t, t, 15.5)
    box(trim, 0, ty, -0.5, t + 0.3, t + 0.3, 1.0)
    for z in (6.4, 10.3, 14.7):
        box(trim, 0, ty, z, t + 0.2, t + 0.2, 0.3)
    pyramid_roof(roof, t, t, 15.0, 4.0, 0.25, cy=ty)
    for n in ((0, -1, 0), (0, 1, 0), (-1, 0, 0), (1, 0, 0)):
        c = Vector((0, ty, 0)) + Vector(n) * t / 2
        arched_opening(trim, dark, c, n, 11.2, 1.0, 1.7)
        u = Vector((-n[1], n[0], 0))
        for k in range(5):
            p = c + Vector(n) * 0.05
            box(wood, p.x, p.y, 11.35 + k * 0.38, 0.95, 0.06, 0.08, math.atan2(u.y, u.x))
    # Doorway: the door set back in an arched surround, a step before it
    arched_opening(trim, wood, (0, ty - t / 2, 0), (0, -1, 0), 0.0, 1.6, 2.4)
    box(trim, 0, ty - t / 2 - 0.12, -0.3, 2.2, 0.24, 0.42)
    # Cross on the spire
    box(wood, 0, ty, 18.9, 0.14, 0.14, 1.1)
    box(wood, 0, ty, 19.45, 0.62, 0.14, 0.13)
    export(name, [stone.to_object(name), trim.to_object(name + '-trim'), roof.to_object(name + '-roof'), dark.to_object(name + '-windows'),
                  wood.to_object(name + '-door')])


def windmill(name):
    """Tower mill: tapered plastered tower on a stone base, a reefing stage round it on struts with a
    railing, a door with a canopy and windows climbing the tower, a thatched cap with a tail pole down to
    the stage, four lattice sails on the front (-Y) with their cloth half furled"""
    clear_scene()
    walls = Part(pbr_material('wall-beige_wall_001', 'beige_wall_001'), smooth=True)
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=2.0)
    thatch = Part(pbr_material('roof-reed_roof_04', 'reed_roof_04'))
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    cloth = Part(two_sided(pbr_material('cloth-hessian', 'hessian_230', (1.15, 1.1, 1.0))))
    dark = Part(flat_material('window', (0.05, 0.06, 0.07), 0.2, 0.3))
    h = 10.0

    def radius(z):
        return 3.5 - 0.9 * (z - 1.0) / (h - 1.0)

    tube(stone, [Vector((0, 0, -0.5)), Vector((0, 0, 1.0))], [3.7, 3.6], 16)
    tube(walls, [Vector((0, 0, 1.0)), Vector((0, 0, h))], [3.5, 2.6], 16)
    cone_roof(thatch, 0, 0, h, 3.0, 3.6, 16)
    tube(wood, [Vector((0, 0, h - 0.1)), Vector((0, 0, h + 0.15))], [3.05, 3.05], 16)
    # Door with a canopy, windows round the tower
    box(wood, 0, -3.5, 0, 1.3, 0.2, 2.4)
    oriented_box(wood, Vector((-0.9, -3.9, 2.7)), Vector((0.9, -3.9, 2.7)), 0.12)
    box(thatch, 0, -3.75, 2.6, 2.0, 0.8, 0.12)
    for k, z in enumerate((3.2, 6.2, 8.4)):
        a = -math.pi / 2 + (k - 1) * 1.2
        r = radius(z) + 0.02
        box(dark, math.cos(a) * r, math.sin(a) * r, z, 0.2, 0.7, 0.9, a)
    # Stage at 4.6 m on struts, a railing round it
    zs = 4.6
    tube(wood, [Vector((0, 0, zs - 0.15)), Vector((0, 0, zs))], [radius(zs) + 1.4, radius(zs) + 1.4], 16, cap=True)
    for k in range(8):
        a = k / 8 * math.tau
        d = Vector((math.cos(a), math.sin(a), 0))
        oriented_box(wood, d * (radius(2.6) + 0.05) + Vector((0, 0, 2.6)), d * (radius(zs) + 1.2) + Vector((0, 0, zs - 0.15)), 0.14)
        oriented_box(wood, d * (radius(zs) + 1.3) + Vector((0, 0, zs)), d * (radius(zs) + 1.3) + Vector((0, 0, zs + 1.0)), 0.08)
    pts = [Vector((math.cos(k / 16 * math.tau) * (radius(zs) + 1.3), math.sin(k / 16 * math.tau) * (radius(zs) + 1.3), zs + 1.0)) for k in range(17)]
    for a, b in zip(pts, pts[1:]):
        oriented_box(wood, a, b, 0.07)
    # Tail pole from the cap down to the stage at the back
    oriented_box(wood, Vector((0, 2.4, h + 0.3)), Vector((0, radius(zs) + 1.1, zs + 0.3)), 0.22)
    oriented_box(wood, Vector((0, 1.6, h - 0.2)), Vector((0, radius(zs) + 0.6, zs + 1.6)), 0.12)
    # Sails: stock, whips, bars across, the cloth on the inner half
    hub = Vector((0, -3.3, h + 0.6))
    box(wood, 0, -2.9, h + 0.45, 0.4, 1.2, 0.4)
    tube(wood, [hub + Vector((0, 0.3, 0)), hub + Vector((0, -0.3, 0))], [0.45, 0.35], 10, cap=True)
    for k in range(4):
        a = k / 4 * math.tau + math.radians(20)
        arm = Vector((math.cos(a), 0, math.sin(a)))
        side = Vector((-math.sin(a), 0, math.cos(a)))
        tip = hub + arm * 7.0
        oriented_box(wood, hub, tip, 0.22)
        a0 = hub + arm * 1.4
        oriented_box(wood, a0 + side * 1.6, tip + side * 1.6, 0.08)
        for t in range(9):
            p = hub + arm * (1.4 + 5.6 * t / 8)
            oriented_box(wood, p, p + side * 1.6, 0.06)
        corners = [a0, a0 + arm * 3.4, a0 + arm * 3.4 + side * 1.6, a0 + side * 1.6]
        corners = [c + Vector((0, -0.12, 0)) for c in corners]
        cloth.quad(corners, [(0, 0), (1.7, 0), (1.7, 0.7), (0, 0.7)])
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
    """White tapered tower with red bands on a stone base, a door with a canopy, windows up the shaft, an
    iron gallery with railing, the lantern room with its glazing bars and a domed roof with a vane. The
    lens inside the lantern (two bright panels back to back on a drum) has materials `spin-*`: it stays a
    node of its own, turning about the tower's axis (docs/CUSTOM_MAPS.md, Drehteile)"""
    clear_scene()
    walls = Part(pbr_material('wall-whitewashed_brick', 'whitewashed_brick', (1.1, 1.1, 1.1)), smooth=True)
    red = Part(flat_material('lighthouse-red', (0.55, 0.08, 0.06), 0.6), smooth=True)
    iron = Part(flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8))
    glass = Part(flat_material('lantern-glass', (0.55, 0.62, 0.6), 0.05, 0.3, emission=(1.0, 0.82, 0.5), strength=0.35), smooth=True)
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=2.0)
    dark = Part(flat_material('window', (0.05, 0.06, 0.07), roughness=0.2, metallic=0.3))
    lens = Part(flat_material('spin-lighthouse-lens', (1.0, 0.9, 0.65), 0.2, emission=(1.0, 0.85, 0.55), strength=3.0), bevel=0.0)
    drum = Part(flat_material('spin-lighthouse-drum', (0.3, 0.26, 0.18), 0.4, 0.8), smooth=True)
    h = 18.0

    def radius(z):
        return 3.2 - 1.1 * (z - 1.2) / (h - 1.2)

    tube(stone, [Vector((0, 0, -0.5)), Vector((0, 0, 1.2))], [4.0, 3.9], 20, cap=True)
    tube(walls, [Vector((0, 0, 1.2)), Vector((0, 0, h))], [radius(1.2), radius(h)], 20)
    for z0, z1 in ((6.0, 8.5), (12.5, 15.0)):
        tube(red, [Vector((0, 0, z0)), Vector((0, 0, z1))], [radius(z0) + 0.03, radius(z1) + 0.03], 20)
    # Door with a small canopy, windows climbing the shaft
    box(dark, 0, -radius(1.2) - 0.05, 1.2, 1.1, 0.15, 2.1)
    box(stone, 0, -radius(1.2) - 0.45, 3.35, 1.7, 0.9, 0.15)
    for k, z in enumerate((5.0, 9.6, 14.0)):
        a = -math.pi / 2 + (k - 1) * 0.9
        r = radius(z) + 0.02
        box(dark, math.cos(a) * r, math.sin(a) * r, z, 0.12, 0.55, 0.9, a)
    # Gallery: a slab on corbels, a railing of posts and two rails
    tube(iron, [Vector((0, 0, h)), Vector((0, 0, h + 0.3))], [3.1, 3.1], 20, cap=True)
    for k in range(12):
        a = k / 12 * math.tau
        oriented_box(iron, Vector((math.cos(a) * (radius(h) - 0.1), math.sin(a) * (radius(h) - 0.1), h - 0.9)),
                     Vector((math.cos(a) * 2.9, math.sin(a) * 2.9, h)), 0.14)
    for k in range(20):
        a = k / 20 * math.tau
        p = Vector((math.cos(a) * 3.0, math.sin(a) * 3.0, h + 0.3))
        oriented_box(iron, p, p + Vector((0, 0, 1.0)), 0.05)
    for z in (h + 0.75, h + 1.3):
        pts = [Vector((math.cos(k / 20 * math.tau) * 3.0, math.sin(k / 20 * math.tau) * 3.0, z)) for k in range(21)]
        for a, b in zip(pts, pts[1:]):
            oriented_box(iron, a, b, 0.05)
    # Lantern room: a low wall, glazing with bars, a domed roof with a ball and a vane
    tube(walls, [Vector((0, 0, h + 0.3)), Vector((0, 0, h + 0.9))], [1.7, 1.7], 16, cap=True)
    tube(glass, [Vector((0, 0, h + 0.9)), Vector((0, 0, h + 3.0))], [1.6, 1.6], 16)
    for k in range(8):
        a = k / 8 * math.tau
        p = Vector((math.cos(a) * 1.62, math.sin(a) * 1.62, h + 0.9))
        oriented_box(iron, p, p + Vector((0, 0, 2.1)), 0.07)
    prof = [(0.0, 1.85), (0.25, 1.7), (0.7, 1.3), (1.1, 0.7), (1.3, 0.2), (1.35, 0.0)]
    tube(iron, [Vector((0, 0, h + 3.0 + z)) for z, _ in prof], [r for _, r in prof], 16)
    tube(iron, [Vector((0, 0, h + 4.3)), Vector((0, 0, h + 4.6))], [0.18, 0.18], 8, cap=True)
    oriented_box(iron, Vector((0, 0, h + 4.6)), Vector((0, 0, h + 5.6)), 0.04)
    oriented_box(iron, Vector((-0.4, 0, h + 5.3)), Vector((0.5, 0, h + 5.3)), 0.04)
    # The lens: a drum on the axis and two bright panels back to back
    tube(drum, [Vector((0, 0, h + 0.9)), Vector((0, 0, h + 1.4))], [0.35, 0.3], 10, cap=True)
    tube(drum, [Vector((0, 0, h + 1.4)), Vector((0, 0, h + 2.7))], [0.12, 0.12], 6, cap=True)
    for s in (-1, 1):
        box(lens, 0, s * 0.35, h + 1.5, 0.9, 0.12, 1.0)
    objects = [stone.to_object(name + '-base'), walls.to_object(name), red.to_object(name + '-bands'), iron.to_object(name + '-iron'),
               glass.to_object(name + '-glass'), dark.to_object(name + '-dark'), drum.to_object('spin-' + name + '-drum'),
               lens.to_object('spin-' + name + '-lens')]
    export(name, objects)


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
            # Logs of different girth and height, leaning a little, the points hewn in five facets
            h = height * rnd.uniform(0.9, 1.03)
            r = rnd.uniform(0.185, 0.21)
            lx, ly = rnd.uniform(-0.04, 0.04), rnd.uniform(-0.03, 0.03)
            tube(logs, [Vector((x, 0, -0.8)), Vector((x + lx, ly, h - 0.55)), Vector((x + lx * 1.05, ly, h - 0.45))], [r, r * 0.94, r * 0.9], 7)
            tube(logs, [Vector((x + lx * 1.05, ly, h - 0.45)), Vector((x + lx * 1.1 + rnd.uniform(-0.04, 0.04), ly, h))], [r * 0.9, 0.015], 5,
                 smooth=False)
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
        box(wood, x, -0.04, 0.05, 0.09, 0.03, 0.92)
        bm = wood.bm
        tri = [bm.verts.new((x - 0.045, -0.055, 0.97)), bm.verts.new((x + 0.045, -0.055, 0.97)), bm.verts.new((x, -0.055, 1.07))]
        f = bm.faces.new(tri)
        for loop in f.loops:
            loop[wood.uv].uv = (loop.vert.co.x * 2, loop.vert.co.z * 2)
    export(name, [wood.to_object(name)])


def rail_fence(name, length=4.0):
    """Rustic split-rail fence: at each end a pair of posts with the rails resting between them on a cross
    tie, three split rails (rough three-sided sections) sagging a little and turned every way"""
    clear_scene()
    rnd = random.Random(5)
    wood = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02', (0.75, 0.72, 0.68)), smooth=True)
    for x in (-length / 2 + 0.05, length / 2 - 0.05):
        for y, lean in ((-0.06, -0.03), (0.21, 0.03)):
            tube(wood, [Vector((x, y, -0.3)), Vector((x + rnd.uniform(-0.02, 0.02), y + lean, 1.3))], [0.08, 0.065], 6, cap=True)
        for z in (0.28, 0.63, 0.98):
            oriented_box(wood, Vector((x - 0.04, -0.12, z)), Vector((x - 0.04, 0.28, z)), 0.04)
    for k, z in enumerate((0.35, 0.7, 1.05)):
        sag = rnd.uniform(0.03, 0.06)
        a, b = Vector((-length / 2 - 0.1, 0.075, z + 0.02)), Vector((length / 2 + 0.1, 0.075, z + rnd.uniform(0.0, 0.05)))
        mid = a.lerp(b, 0.5) - Vector((0, rnd.uniform(-0.02, 0.02), sag))
        face = tube(wood, [a, mid, b], [0.075, 0.07, 0.065], 3, smooth=False)
        # Turn the split section about its length so the flat sides face different ways
        turn = Matrix.Rotation(rnd.uniform(0, math.tau), 4, (b - a).normalized())
        for v in {v for f in face for v in f.verts}:
            axis_pt = a + (b - a).normalized() * (v.co - a).dot((b - a).normalized())
            v.co = axis_pt + turn @ (v.co - axis_pt)
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


def ruin_wall(name, seed=0):
    """Broken church wall 10 m long: a round-arched window with a sill and wedge stones, the top broken off
    along a jagged line highest near the middle, two stepped buttresses, a plinth course, fallen stones"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=3.0)
    rubble = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=1.5, bevel=0.0)
    length, thick = 10.02, 1.0
    centres = [-4.5 + k for k in range(10)]
    heights = [3.6, 5.2, 6.6, 7.4, 7.2, 6.9, 6.3, 5.0, 3.8, 3.1]
    xs, tops = break_line(-length / 2, length / 2, centres, heights, rnd, 0.6)
    ragged_arch(stone, -length / 2, length / 2, thick, -0.5, 0.0, 1.6, 4.2, xs, tops, steps=8)
    box(stone, 0, 0, -0.5, 1.62, thick, 2.6)
    box(stone, 0, -0.08, 2.0, 1.9, thick + 0.16, 0.14)
    voussoirs(stone, 0.0, 0, thick, 4.2, 1.6, count=7, depth=0.35)
    box(stone, 0, 0, -0.5, length, thick + 0.3, 0.8)
    for x in (-3.3, 3.3):
        box(stone, x, -thick / 2 - 0.45, -0.5, 0.8, 0.9, 2.6)
        hexa(stone, [(x - 0.4, -thick / 2 - 0.9, 2.1), (x + 0.4, -thick / 2 - 0.9, 2.1), (x + 0.4, -thick / 2, 2.1), (x - 0.4, -thick / 2, 2.1)],
             [(x - 0.4, -thick / 2 - 0.1, 3.4), (x + 0.4, -thick / 2 - 0.1, 3.4), (x + 0.4, -thick / 2, 3.4), (x - 0.4, -thick / 2, 3.4)])
    rim_stones(rubble, xs, tops, thick, rnd, max(heights))
    for k in range(10):
        chunk(rubble, Vector((rnd.uniform(-4.6, 4.6), -rnd.uniform(1.0, 2.5), 0.05)),
              Vector((rnd.uniform(0.35, 0.8), rnd.uniform(0.3, 0.6), rnd.uniform(0.2, 0.45))), rnd)
    export(name, [stone.to_object(name), rubble.to_object(name + '-rubble')])


def ruin_columns(name, seed=0):
    """Temple remains: a stepped platform, fluted columns with bases and capitals, two still carrying a piece
    of the architrave, others snapped off; one fallen and broken into drums, stones lying about"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('wall-white_sandstone_bricks', 'white_sandstone_bricks', (1.05, 1.0, 0.95)), uv_metres=2.0)
    trim = Part(stone.material, uv_metres=1.5, bevel=0.0)
    col = Part(pbr_material('rock-sandstone_cracks', 'sandstone_cracks', (1.0, 0.94, 0.86)), smooth=True)
    box(stone, 0, 0, -0.3, 12, 7, 0.6)
    box(stone, 0, 0, 0.3, 11, 6, 0.3)
    heights = [6.45, 6.45, 3.2, 1.5, 4.6, 2.4]
    for k, h in enumerate(heights):
        x = -4.5 + (k % 3) * 4.5
        y = -2.0 if k < 3 else 2.0
        column(col, trim, x, y, 0.6, h, 0.5, None if h > 6 else rnd)
    # Architrave over the two standing columns, its far end broken
    box(stone, -2.25, -2.0, 7.05, 6.2, 1.2, 0.7)
    chunk(trim, Vector((1.05, -2.0, 7.2)), Vector((0.5, 1.0, 0.45)), rnd, 15)
    # The fallen column in three drums, a capital beside them, stones from the architrave
    a, b = Vector((2.6, 4.75, 0.5)), Vector((6.6, 5.2, 0.5))
    turn = Vector((0, 0, 1)).rotation_difference((b - a).normalized()).to_matrix().to_4x4()
    for k in range(3):
        p = a + (b - a) * (k / 3) + Vector((0, rnd.uniform(-0.15, 0.15), 0))
        fluted_drum(col, Matrix.Translation(p) @ turn @ Matrix.Rotation(rnd.uniform(0, 6.3), 4, 'Z'), (b - a).length / 3 - 0.12, 0.47, 0.45)
    box(trim, -5.2, 4.2, -0.05, 1.3, 1.3, 0.3, 0.4)
    for k in range(6):
        chunk(trim, Vector((rnd.uniform(-5.5, 1.5), rnd.uniform(-3.4, -2.8) if k % 2 else rnd.uniform(3.4, 4.4), 0.1)),
              Vector((rnd.uniform(0.4, 0.8), rnd.uniform(0.3, 0.6), rnd.uniform(0.25, 0.4))), rnd)
    export(name, [stone.to_object(name), trim.to_object(name + '-trim'), col.to_object(name + '-columns')])


def ruin_arch(name):
    """A freestanding broken arch 5 m wide in a wall 9 m long: the wall broken off along a jagged line that
    falls from the left pier to the right, the arch ring of wedge stones, imposts, a plinth course, fallen
    stones at its foot"""
    clear_scene()
    rnd = random.Random(6)
    stone = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=3.0)
    rubble = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=1.5, bevel=0.0)
    thick = 1.4
    xs, tops = break_line(-4.5, 4.5, [-4.0, -3.0, -1.6, 0.0, 1.6, 3.0, 4.0], [7.1, 7.5, 6.95, 6.6, 6.2, 5.3, 4.5], rnd, 0.5)
    ragged_arch(stone, -4.5, 4.5, thick, -0.5, 0, 5.0, 3.5, xs, tops, steps=14)
    voussoirs(stone, 0, 0, thick, 3.5, 5.0, count=11, depth=0.5)
    for sx in (-1, 1):
        box(stone, sx * 3.0, 0, 3.3, 1.2, thick + 0.16, 0.22)
        box(stone, sx * 3.5, 0, -0.5, 2.0, thick + 0.3, 0.9)
    rim_stones(rubble, xs, tops, thick, rnd, 7.5)
    for k in range(9):
        chunk(rubble, Vector((rnd.uniform(-4.0, 4.0), rnd.choice((-1, 1)) * rnd.uniform(1.2, 2.4), 0.1)),
              Vector((rnd.uniform(0.4, 0.8), rnd.uniform(0.3, 0.6), rnd.uniform(0.25, 0.45))), rnd)
    export(name, [stone.to_object(name), rubble.to_object(name + '-rubble')])


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
    """Market stall: four posts tied by beams carry a sagging cloth canopy with a scalloped valance at the
    front, a counter with crates of produce, sacks behind"""
    clear_scene()
    wood = Part(pbr_material('planks-dark', 'dark_planks', (1.0, 0.9, 0.8)), uv_metres=1.0)
    counter = Part(pbr_material('planks-crate', 'brown_planks_04'), uv_metres=1.0)
    cloth = Part(two_sided(pbr_material('cloth-hessian-' + '-'.join('%.2f' % c for c in cloth_tint), 'hessian_230', cloth_tint)))
    w, d = 3.2, 2.0
    for x in (-w / 2, w / 2):
        for y, h in ((-d / 2, 2.6), (d / 2, 2.2)):
            box(wood, x, y, 0, 0.12, 0.12, h)
        oriented_box(wood, Vector((x, -d / 2, 2.3)), Vector((x, d / 2, 2.0)), 0.08)
    for y, z in ((-d / 2, 2.3), (d / 2, 2.0)):
        box(wood, 0, y, z - 0.04, w + 0.1, 0.08, 0.08)
    box(counter, 0, -d / 2 + 0.2, 0, w, 0.5, 1.0)
    box(counter, 0, 0, 0.9, w - 0.1, d - 0.2, 0.06)
    # Canopy: a grid of quads, sagging between the beams, overhanging at the front
    nx, ny = 6, 4
    def roof(i, j):
        u, v = i / nx, j / ny
        x = -w / 2 - 0.2 + u * (w + 0.4)
        y = -d / 2 - 0.5 + v * (d + 0.6)
        z = 2.5 - 0.25 * v - 0.08 * math.sin(math.pi * u) * math.sin(math.pi * min(1.0, v * 1.2))
        return Vector((x, y, z))
    for i in range(nx):
        for j in range(ny):
            cloth.quad([roof(i, j), roof(i + 1, j), roof(i + 1, j + 1), roof(i, j + 1)],
                       [(i / nx * 1.5, j / ny), ((i + 1) / nx * 1.5, j / ny), ((i + 1) / nx * 1.5, (j + 1) / ny), (i / nx * 1.5, (j + 1) / ny)])
    # Valance along the front edge, scalloped
    for i in range(nx * 2):
        a, b = roof(i / 2, 0), roof((i + 1) / 2, 0)
        drop = 0.32
        dz = Vector((0, 0, drop))
        cloth.quad([a - dz * 0.6, (a + b) / 2 - dz, b - dz * 0.6, b, a], [(0, 0.08), (0.12, 0), (0.25, 0.08), (0.25, 0.2), (0, 0.2)])
    goods = Part(flat_material('goods', (0.75, 0.45, 0.15), 0.7))
    rnd = random.Random(len(name))
    for k in range(4):
        x = -w / 2 + 0.5 + k * (w - 1.0) / 3
        box(counter, x, -0.45, 0.96, 0.55, 0.4, 0.16)
        for m in range(5):
            c = Vector((x + rnd.uniform(-0.2, 0.2), -0.45 + rnd.uniform(-0.12, 0.12), 1.12))
            box(goods, c.x, c.y, c.z - 0.05, 0.11, 0.11, 0.1, rnd.uniform(0, 2))
    for k in range(3):
        tube(goods, [Vector((-1.0 + k * 0.6, 0.6, 0.0)), Vector((-1.0 + k * 0.6, 0.6, 0.55))], [0.22, 0.18], 8, cap=True)
    export(name, [wood.to_object(name), counter.to_object(name + '-counter'), cloth.to_object(name + '-cloth'),
                  goods.to_object(name + '-goods')])


def tent(name, large=False):
    """Canvas tent: A-frame (small) or a round pavilion with a cone top (large)"""
    clear_scene()
    canvas = Part(two_sided(pbr_material('cloth-canvas', 'hessian_230', (1.3, 1.25, 1.15))))
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    dark = Part(flat_material('tent-inside', (0.08, 0.07, 0.05), 0.9))
    if not large:
        # Ridge along Y, entrance at the front (-Y): the canvas sags a little between the poles, the front
        # flaps are tied back, pegs along the hem
        l, w, h = 3.6, 2.6, 2.2
        n = 4
        for side in (-1, 1):
            for k in range(n):
                y0, y1 = -l / 2 + k * l / n, -l / 2 + (k + 1) * l / n
                s0, s1 = 0.06 * math.sin(math.pi * k / n), 0.06 * math.sin(math.pi * (k + 1) / n)
                corners = [Vector((side * w / 2, y1, 0)), Vector((side * w / 2, y0, 0)), Vector((0, y0, h - s0)), Vector((0, y1, h - s1))]
                if side < 0:
                    corners = list(reversed(corners))
                canvas.quad(corners, [(k / n * 1.5, 0), ((k + 1) / n * 1.5, 0), ((k + 1) / n * 1.5, 1), (k / n * 1.5, 1)])
        back = [canvas.bm.verts.new(c) for c in ((-w / 2, l / 2, 0), (w / 2, l / 2, 0), (0, l / 2, h))]
        canvas.bm.faces.new(back)
        front = [dark.bm.verts.new(c) for c in ((-w / 2 * 0.7, -l / 2 + 0.02, 0), (w / 2 * 0.7, -l / 2 + 0.02, 0),
                                                (0, -l / 2 + 0.02, h * 0.7))]
        dark.bm.faces.new(front)
        for side in (-1, 1):
            # Flap folded back against the side: a triangle from the ridge down the front edge
            canvas.quad([Vector((0, -l / 2 - 0.01, h)), Vector((side * w / 2 * 0.3, -l / 2 + 0.25, h * 0.7)),
                         Vector((side * w / 2 * 0.95, -l / 2 + 0.05, 0.05)), Vector((side * w / 2 * 0.7, -l / 2 - 0.01, 0.05))][::side],
                        [(0, 1), (0.3, 0.7), (0.5, 0), (0.3, 0)][::side])
        for y in (-l / 2 - 0.1, l / 2 + 0.1):
            box(wood, 0, y, 0, 0.08, 0.08, h + 0.2)
        for side in (-1, 1):
            for y in (-l / 2 + 0.2, 0.0, l / 2 - 0.2):
                oriented_box(wood, Vector((side * (w / 2 + 0.05), y, -0.15)), Vector((side * (w / 2 + 0.12), y, 0.12)), 0.035)
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

def bridge_deck_stone(name):
    """Stone bridge piece in the bridge-deck format: 4 m along +X, 1 m wide (stretched to the path), deck
    top at z = 0. Cut slabs with joints, a deep voussoir course below, low parapet stones on both edges"""
    clear_scene()
    rnd = random.Random(21)
    slabs = Part(pbr_material('road-paving-slabs', 'castle_wall_slates', (1.0, 0.98, 0.95)), uv_metres=1.0, bevel=0.015)
    body = Part(pbr_material('stone-stacked', 'stacked_stone_wall'), uv_metres=1.5)
    cap = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=1.0, bevel=0.02)
    for k in range(5):
        x = -2.0 + 0.4 + k * 0.8
        box(slabs, x, 0, -0.1, 0.78, 0.9, 0.1 + rnd.uniform(-0.01, 0.0))
    box(body, 0, 0, -0.75, 4.0, 1.0, 0.65)
    for k in range(10):
        x = -2.0 + 0.2 + k * 0.4
        box(body, x, 0, -1.05, 0.38, 0.92, 0.35)
    for y in (-0.46, 0.46):
        for k in range(5):
            x = -2.0 + 0.4 + k * 0.8
            box(cap, x, y, 0.0, 0.76, 0.08, 0.42 + rnd.uniform(-0.02, 0.02))
        box(cap, 0, y, 0.42, 4.0, 0.1, 0.08)
    export(name, [slabs.to_object(name), body.to_object(name + '-body'), cap.to_object(name + '-parapet')])


def bridge_deck_lava(name):
    """Basalt bridge piece in the bridge-deck format with glowing seams between the slabs and along the
    underside; deck top at z = 0"""
    clear_scene()
    rnd = random.Random(22)
    rock = Part(pbr_material('rock-dark_rock-deck', 'dark_rock', (0.8, 0.78, 0.78)), uv_metres=1.0, bevel=0.02)
    glow = Part(flat_material('lava-seam', (1.0, 0.32, 0.05), 0.4, emission=(1.0, 0.3, 0.04), strength=0.55))
    k = 0
    x = -2.0
    while x < 1.95:
        ln = min(2.0 - x, rnd.uniform(0.5, 0.9))
        box(rock, x + ln / 2, rnd.uniform(-0.02, 0.02), -0.14, ln - 0.06, 0.94, 0.14 + rnd.uniform(-0.015, 0.0))
        box(glow, x + ln - 0.03, 0, -0.16, 0.05, 0.9, 0.13)
        x += ln
        k += 1
    box(rock, 0, 0, -0.9, 4.0, 0.98, 0.76)
    box(glow, 0, 0, -0.93, 3.9, 0.7, 0.04)
    for y in (-0.47, 0.47):
        for j in range(4):
            box(rock, -1.5 + j, y, -0.02, 0.8, 0.07, 0.3 + rnd.uniform(-0.05, 0.05))
    export(name, [rock.to_object(name), glow.to_object(name + '-seams')])


def models():
    def watermill_wheel(w, d, wall_h, pitch):
        return mill_wheel(w, d, wall_h, pitch)

    return {
        # Castle kit
        'castle-wall': lambda: castle_wall('castle-wall'),
        # The wall kit's other pieces: 4 and 2 m of wall, the corner and the end (the line tool fits them)
        'castle-wall-half': lambda: castle_wall('castle-wall-half', length=4.0),
        'castle-wall-short': lambda: castle_wall('castle-wall-short', length=2.0),
        'castle-wall-corner': lambda: castle_wall_block('castle-wall-corner'),
        'castle-wall-end': lambda: castle_wall_block('castle-wall-end', along=3.2),
        'castle-wall-ruined': lambda: castle_wall('castle-wall-ruined', RUIN, ruined=True, seed=1),
        'castle-wall-ruined-b': lambda: castle_wall('castle-wall-ruined-b', RUIN, ruined=True, seed=4),
        'castle-tower': lambda: castle_tower('castle-tower'),
        'castle-tower-roof': lambda: castle_tower('castle-tower-roof', roof=True),
        'castle-tower-ruined': lambda: castle_tower('castle-tower-ruined', stone_asset=RUIN, height=7.0, ruined=True),
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
        'bridge-deck-stone': lambda: bridge_deck_stone('bridge-deck-stone'),
        'bridge-deck-lava': lambda: bridge_deck_lava('bridge-deck-lava'),
        'palisade': lambda: palisade('palisade'),
        'palisade-gate': lambda: palisade('palisade-gate', gate=True),
        'fence-picket': lambda: picket_fence('fence-picket'),
        'fence-rail': lambda: rail_fence('fence-rail'),
        'gate-farm': lambda: farm_gate('gate-farm'),
        'wall-dry-stone': lambda: wall_stone('wall-dry-stone', 3, length=6.0, height=1.2, depth=0.7),
        'wall-dry-stone-ruined': lambda: wall_stone('wall-dry-stone-ruined', 5, length=6.0, height=1.2, depth=0.7, ruined=True),
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
