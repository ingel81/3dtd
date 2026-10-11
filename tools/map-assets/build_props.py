"""Props and effect markers of the map asset catalogue (loaded by build_models.py)."""
import math
import random

from mathutils import Matrix, Vector

from blender_kit import (
    Part, box, box_uv, card, card_material, clear_scene, export, flat_material, glow_card_material, image_material,
    import_model, oriented_box, pbr_material, tube,
)
import blender_kit


def crate(name):
    clear_scene()
    planks = Part(pbr_material('planks-crate', 'brown_planks_04'), uv_metres=1.0)
    frame = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    box(planks, 0, 0, 0, 0.9, 0.9, 0.9)
    e = 0.08
    for x in (-0.45, 0.45):
        for y in (-0.45, 0.45):
            box(frame, x, y, 0, e, e, 0.9)
    for z in (0.0, 0.9 - e):
        for y in (-0.45, 0.45):
            box(frame, 0, y, z, 0.98, e, e)
        for x in (-0.45, 0.45):
            box(frame, x, 0, z, e, 0.98, e)
    export(name, [planks.to_object(name), frame.to_object(name + '-frame')])


def lamp_post(name):
    clear_scene()
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    iron = Part(flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8))
    glass = Part(flat_material('lamp-glass', (1.0, 0.8, 0.5), 0.3, 0.0, emission=(1.0, 0.7, 0.35)))
    box(wood, 0, 0, 0, 0.22, 0.22, 3.6)
    oriented_box(wood, Vector((0, 0, 3.3)), Vector((0, -0.9, 3.5)), 0.12)
    box(iron, 0, -0.85, 3.05, 0.34, 0.34, 0.06)
    box(iron, 0, -0.85, 3.45, 0.4, 0.4, 0.06)
    box(glass, 0, -0.85, 3.11, 0.28, 0.28, 0.34)
    export(name, [wood.to_object(name), iron.to_object(name + '-iron'), glass.to_object(name + '-glass')])


# ---------------------------------------------------------------- flames and effect meshes

def flame_cards(part, base, height, width, count=3, seed=0):
    """Crossed flame cards standing on `base` (emissive, alpha tested)"""
    rnd = random.Random(seed)
    up = lambda co: Vector((0, 0, 1))
    for k in range(count):
        a = k / count * math.pi + rnd.uniform(-0.2, 0.2)
        side = Vector((math.cos(a), math.sin(a), 0)) * width / 2
        h = height * rnd.uniform(0.85, 1.1)
        top = Vector((0, 0, h))
        part.quad([base - side, base + side, base + side + top, base - side + top], [(0, 0), (1, 0), (1, 1), (0, 1)], up)


def torch(name):
    """Wooden torch post with a burning head"""
    clear_scene()
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    iron = Part(flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8))
    fire = Part(glow_card_material('flame', 'flame.png'))
    tube(wood, [Vector((0, 0, -0.3)), Vector((0, 0, 1.9))], [0.07, 0.06], 6)
    tube(iron, [Vector((0, 0, 1.75)), Vector((0, 0, 2.05))], [0.09, 0.12], 8, cap=True)
    flame_cards(fire, Vector((0, 0, 2.0)), 0.7, 0.4)
    export(name, [wood.to_object(name), iron.to_object(name + '-iron'), fire.to_object(name + '-flame')])


def brazier(name):
    """Iron fire bowl on three legs"""
    clear_scene()
    iron = Part(flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8), smooth=True)
    coal = Part(flat_material('embers', (0.6, 0.15, 0.03), 0.9, emission=(1.0, 0.3, 0.05), strength=1.0))
    fire = Part(glow_card_material('flame', 'flame.png'))
    for k in range(3):
        a = k / 3 * math.tau
        oriented_box(iron, Vector((math.cos(a) * 0.45, math.sin(a) * 0.45, 0)), Vector((math.cos(a) * 0.25, math.sin(a) * 0.25, 0.8)), 0.05)
    tube(iron, [Vector((0, 0, 0.75)), Vector((0, 0, 0.95)), Vector((0, 0, 1.1))], [0.2, 0.42, 0.5], 12)
    tube(coal, [Vector((0, 0, 1.0)), Vector((0, 0, 1.02))], [0.45, 0.0], 12)
    flame_cards(fire, Vector((0, 0, 1.0)), 1.0, 0.8, 4, 1)
    export(name, [iron.to_object(name), coal.to_object(name + '-embers'), fire.to_object(name + '-flame')])


def campfire(name, lit=True):
    """Ring of stones, crossed logs, flames (or ashes)"""
    clear_scene()
    rnd = random.Random(11)
    stone = Part(pbr_material('rock-dark_rock', 'dark_rock', (1.4, 1.35, 1.3)), uv_metres=0.6)
    wood = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02'), smooth=True)
    for k in range(10):
        a = k / 10 * math.tau
        box(stone, math.cos(a) * 0.75, math.sin(a) * 0.75, -0.05, 0.3, 0.24, 0.22, a + rnd.uniform(-0.3, 0.3))
    for k in range(4):
        a = k / 4 * math.pi + 0.3
        d = Vector((math.cos(a), math.sin(a), 0))
        tube(wood, [-d * 0.55 + Vector((0, 0, 0.08)), d * 0.55 + Vector((0, 0, 0.18 + 0.05 * k))], [0.07, 0.06], 6, cap=True)
    objects = [stone.to_object(name), wood.to_object(name + '-logs')]
    if lit:
        fire = Part(glow_card_material('flame', 'flame.png'))
        coal = Part(flat_material('embers', (0.6, 0.15, 0.03), 0.9, emission=(1.0, 0.3, 0.05), strength=1.0))
        tube(coal, [Vector((0, 0, 0.02)), Vector((0, 0, 0.06))], [0.5, 0.0], 10)
        flame_cards(fire, Vector((0, 0, 0.05)), 1.1, 0.9, 4, 2)
        objects += [fire.to_object(name + '-flame'), coal.to_object(name + '-embers')]
    export(name, objects)


def waterfall(name, width=6.0, height=12.0):
    """Falling water: a curved, slightly bowed sheet from the lip (top, front -Y) down to the pool, foam at the foot.
    Stand it against a cliff with its back (+Y) to the rock"""
    clear_scene()
    water = Part(card_material('waterfall', 'waterfall.png'))
    spray = Part(card_material('foam', 'foam.png'))
    rows = 6
    cols = 4
    front = lambda co: Vector((0, -1, 0.15)).normalized()
    for i in range(cols):
        for j in range(rows):
            x0 = -width / 2 + i * width / cols
            x1 = x0 + width / cols
            t0, t1 = j / rows, (j + 1) / rows

            def y(t):
                return -1.2 * math.sin(t * math.pi * 0.5) ** 2 + 0.6 * (1 - t)

            corners = [Vector((x0, y(t0), height * (1 - t0))), Vector((x1, y(t0), height * (1 - t0))),
                       Vector((x1, y(t1), height * (1 - t1))), Vector((x0, y(t1), height * (1 - t1)))]
            uv = [(i / cols, 1 - t0), ((i + 1) / cols, 1 - t0), ((i + 1) / cols, 1 - t1), (i / cols, 1 - t1)]
            water.quad(list(reversed(corners)), list(reversed(uv)), front)
    up = lambda co: Vector((0, 0, 1))
    rnd = random.Random(3)
    for k in range(6):
        c = Vector((rnd.uniform(-width / 2, width / 2), -1.4 + rnd.uniform(-0.8, 0.6), 0.1))
        s = rnd.uniform(1.4, 2.4)
        a = rnd.uniform(0, math.pi)
        side = Vector((math.cos(a), math.sin(a), 0)) * s / 2
        spray.quad([c - side, c + side, c + side + Vector((0, 0, s * 0.8)), c - side + Vector((0, 0, s * 0.8))],
                   [(0, 0), (1, 0), (1, 1), (0, 1)], front)
        spray.quad([c - side + Vector((0, 0, 0.05)), c + side.cross(Vector((0, 0, 1))) + Vector((0, 0, 0.05)),
                    c + side + Vector((0, 0, 0.05)), c - side.cross(Vector((0, 0, 1))) + Vector((0, 0, 0.05))],
                   [(0, 0), (1, 0), (1, 1), (0, 1)], up)
    export(name, [water.to_object(name), spray.to_object(name + '-foam')])


# ---------------------------------------------------------------- farm and camp props

def cart(name):
    """Two-wheeled hand cart with a plank bed and shafts, front (-Y)"""
    clear_scene()
    planks = Part(pbr_material('planks-crate', 'brown_planks_04'), uv_metres=1.0)
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    iron = Part(flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8))
    box(planks, 0, 0.2, 0.75, 1.5, 2.2, 0.08)
    for sx in (-1, 1):
        box(planks, sx * 0.72, 0.2, 0.83, 0.06, 2.2, 0.4)
    box(planks, 0, 1.28, 0.83, 1.5, 0.06, 0.4)
    for sx in (-1, 1):
        oriented_box(wood, Vector((sx * 0.55, -0.8, 0.72)), Vector((sx * 0.55, -2.4, 0.35)), 0.08)
        c = Vector((sx * 0.85, 0.3, 0.6))
        n = 12
        pts = [c + Vector((0, math.cos(k / n * math.tau) * 0.6, math.sin(k / n * math.tau) * 0.6)) for k in range(n + 1)]
        for a, b in zip(pts, pts[1:]):
            oriented_box(wood, a, b, 0.08)
            oriented_box(iron, a + Vector((sx * 0.02, 0, 0)), b + Vector((sx * 0.02, 0, 0)), 0.03)
        for k in range(0, n, 2):
            oriented_box(wood, c, pts[k], 0.05)
    oriented_box(iron, Vector((-0.9, 0.3, 0.6)), Vector((0.9, 0.3, 0.6)), 0.06)
    export(name, [planks.to_object(name), wood.to_object(name + '-wood'), iron.to_object(name + '-iron')])


def haystack(name):
    """Round haystack (straw dome) around a pole"""
    clear_scene()
    hay = Part(pbr_material('roof-reed_roof_04', 'reed_roof_04', (1.3, 1.15, 0.8)), smooth=True)
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    profile = [(0.0, 1.5), (0.6, 1.6), (1.6, 1.4), (2.4, 1.0), (3.0, 0.5), (3.3, 0.1)]
    tube(hay, [Vector((0, 0, z)) for z, _ in profile], [r for _, r in profile], 16)
    tube(wood, [Vector((0, 0, 3.0)), Vector((0, 0, 4.0))], [0.05, 0.04], 5)
    export(name, [hay.to_object(name), wood.to_object(name + '-pole')])


def hay_bales(name):
    clear_scene()
    hay = Part(pbr_material('roof-reed_roof_04', 'reed_roof_04', (1.35, 1.2, 0.8)), smooth=True)
    for k, (x, y, z, a) in enumerate(((0, 0, 0.7, 0), (-1.3, 0.1, 0.7, 0.1), (-0.65, 0.05, 2.0, 0.05))):
        d = Vector((0, math.cos(a), math.sin(a) * 0)) * 0.6
        c = Vector((x, y, z))
        tube(hay, [c - d, c + d], [0.68, 0.68], 14, cap=True)
        tube(hay, [c + d, c - d], [0.68, 0.68], 14, cap=True)
    export(name, [hay.to_object(name)])


def woodpile(name):
    """Stacked split logs between two posts"""
    clear_scene()
    rnd = random.Random(4)
    wood = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02'), smooth=True)
    ends = Part(pbr_material('wood-rough', 'rough_wood', (1.1, 1.0, 0.85)))
    for row in range(5):
        n = 7 - (row % 2)
        for k in range(n):
            x = -1.2 + (k + 0.5 * (row % 2)) * 0.38
            z = 0.17 + row * 0.3
            r = rnd.uniform(0.14, 0.17)
            tube(wood, [Vector((x, -0.6, z)), Vector((x, 0.6, z))], [r, r], 7)
            for y, sign in ((-0.6, -1), (0.6, 1)):
                ring = [ends.bm.verts.new((x + math.cos(a / 7 * math.tau) * r, y, z + math.sin(a / 7 * math.tau) * r)) for a in range(7)]
                f = ends.bm.faces.new(ring if sign > 0 else list(reversed(ring)))
                for loop in f.loops:
                    loop[ends.uv].uv = (loop.vert.co.x * 2, loop.vert.co.z * 2)
    for x in (-1.5, 1.5):
        box(wood, x, 0, 0, 0.12, 0.12, 1.7)
    export(name, [wood.to_object(name), ends.to_object(name + '-ends')])


def anvil(name):
    """Smithy anvil on a stump block"""
    clear_scene()
    iron = Part(flat_material('iron-dark', (0.1, 0.1, 0.11), 0.4, 0.9))
    wood = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02'), smooth=True)
    tube(wood, [Vector((0, 0, 0)), Vector((0, 0, 0.55))], [0.32, 0.3], 9, cap=True)
    box(iron, 0, 0, 0.55, 0.28, 0.2, 0.12)
    box(iron, 0, 0, 0.67, 0.16, 0.14, 0.16)
    box(iron, 0, 0, 0.83, 0.55, 0.22, 0.13)
    oriented_box(iron, Vector((0.27, 0, 0.9)), Vector((0.5, 0, 0.9)), 0.08)
    export(name, [wood.to_object(name + '-stump'), iron.to_object(name)])


def weapon_rack(name):
    """Wooden rack with spears and two shields"""
    clear_scene()
    wood = Part(pbr_material('planks-dark', 'dark_planks', (1.1, 1.0, 0.9)), uv_metres=1.0)
    iron = Part(flat_material('steel', (0.45, 0.45, 0.47), 0.35, 0.9))
    paint = Part(flat_material('shield-red', (0.32, 0.05, 0.04), 0.7))
    for x in (-1.0, 1.0):
        box(wood, x, 0, 0, 0.1, 0.1, 1.8)
        box(wood, x, 0, 0, 0.12, 0.6, 0.08)
    for z in (0.5, 1.5):
        box(wood, 0, 0.05, z, 2.1, 0.06, 0.08)
    for k in range(5):
        x = -0.75 + k * 0.37
        tube(wood, [Vector((x, 0.12, 0.1)), Vector((x, 0.0, 2.3))], [0.025, 0.022], 5)
        tube(iron, [Vector((x, 0.0, 2.3)), Vector((x, -0.005, 2.6))], [0.04, 0.0], 4)
    for x in (-0.55, 0.55):
        tube(paint, [Vector((x, -0.12, 0.8)), Vector((x, -0.14, 0.82))], [0.33, 0.33], 12, cap=True)
        tube(iron, [Vector((x, -0.14, 0.8)), Vector((x, -0.2, 0.8))], [0.08, 0.04], 8, cap=True)
    export(name, [wood.to_object(name), iron.to_object(name + '-steel'), paint.to_object(name + '-shields')])


def signpost(name):
    clear_scene()
    wood = Part(pbr_material('wood-rough', 'rough_wood', (0.85, 0.75, 0.65)), uv_metres=1.0)
    box(wood, 0, 0, -0.3, 0.14, 0.14, 2.8)
    for k, (z, a) in enumerate(((2.15, 0.4), (1.8, -0.9), (1.45, 2.3))):
        r = Matrix.Rotation(a, 3, 'Z')
        c = r @ Vector((0.45, 0, 0))
        box(wood, c.x, c.y, z, 0.9, 0.05, 0.22, a)
        tip = r @ Vector((0.95, 0, 0))
        box(wood, tip.x, tip.y, z + 0.03, 0.14, 0.05, 0.16, a + math.pi / 4)
    export(name, [wood.to_object(name)])


def banner(name, png):
    """Tall pole with a cross bar and a hanging banner (front -Y)"""
    clear_scene()
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    gold = Part(flat_material('brass', (0.6, 0.45, 0.15), 0.35, 0.9))
    cloth = Part(card_material(png.replace('.png', ''), png))
    tube(wood, [Vector((0, 0, -0.4)), Vector((0, 0, 5.6))], [0.06, 0.05], 6)
    oriented_box(wood, Vector((-0.55, -0.08, 5.2)), Vector((0.55, -0.08, 5.2)), 0.05)
    tube(gold, [Vector((0, 0, 5.6)), Vector((0, 0, 5.9))], [0.07, 0.0], 6)
    front = lambda co: Vector((0, -1, 0))
    cloth.quad([Vector((-0.5, -0.1, 2.0)), Vector((0.5, -0.1, 2.0)), Vector((0.5, -0.1, 5.15)), Vector((-0.5, -0.1, 5.15))],
               [(0, 0), (1, 0), (1, 1), (0, 1)], front)
    export(name, [wood.to_object(name), gold.to_object(name + '-tip'), cloth.to_object(name + '-cloth')])


def bones(name):
    """Remains of a large beast: a ring of ribs and a spine half sunk in the ground"""
    clear_scene()
    bone = Part(flat_material('bone', (0.78, 0.74, 0.62), 0.7), smooth=True)
    spine = [Vector((x, 0.0, 0.35 + 0.15 * math.sin(x))) for x in (-2.0, -1.0, 0.0, 1.0, 2.0)]
    tube(bone, spine, [0.12, 0.14, 0.14, 0.12, 0.08], 6)
    for k in range(7):
        x = -1.6 + k * 0.5
        for side in (-1, 1):
            pts = [Vector((x, 0, 0.4)), Vector((x + 0.05, side * 0.7, 0.75)), Vector((x + 0.1, side * 1.15, 0.3)),
                   Vector((x + 0.12, side * 1.2, -0.15))]
            tube(bone, pts, [0.06, 0.055, 0.045, 0.04], 5)
    tube(bone, [Vector((2.1, 0, 0.3)), Vector((2.6, 0, 0.35)), Vector((3.0, 0, 0.25))], [0.25, 0.3, 0.12], 8, cap=True)
    export(name, [bone.to_object(name)])


def models():
    return {
        # Fire and effects
        'torch': lambda: torch('torch'),
        'brazier': lambda: brazier('brazier'),
        'campfire': lambda: campfire('campfire'),
        'campfire-out': lambda: campfire('campfire-out', lit=False),
        'waterfall': lambda: waterfall('waterfall'),
        'waterfall-tall': lambda: waterfall('waterfall-tall', width=8.0, height=20.0),
        # Farm, camp, smithy
        'cart': lambda: cart('cart'),
        'haystack': lambda: haystack('haystack'),
        'hay-bales': lambda: hay_bales('hay-bales'),
        'woodpile': lambda: woodpile('woodpile'),
        'anvil': lambda: anvil('anvil'),
        'weapon-rack': lambda: weapon_rack('weapon-rack'),
        'signpost': lambda: signpost('signpost'),
        'banner-red': lambda: banner('banner-red', 'banner-red.png'),
        'banner-blue': lambda: banner('banner-blue', 'banner-blue.png'),
        'bones': lambda: bones('bones'),
        # Poly Haven props
        'barrel-wine': lambda: import_model('wine_barrel_01', None, 1500, 'barrel-wine', keep_scale=True),
        'barrel-old': lambda: import_model('Barrel_02', None, 1500, 'barrel-old', keep_scale=True),
        'barrel-small': lambda: import_model('barrel_03', None, 1200, 'barrel-small', keep_scale=True),
        'barrels-broken': lambda: import_model('wooden_barrels_01', None, 3000, 'barrels-broken', keep_scale=True),
        'crate-long': lambda: import_model('wooden_crate_02', None, 1500, 'crate-long', keep_scale=True),
        'crate-flat': lambda: import_model('wooden_crate_01', None, 1500, 'crate-flat', keep_scale=True),
        'bucket': lambda: import_model('wooden_bucket_01', None, 1000, 'bucket', keep_scale=True),
        'tub': lambda: import_model('wooden_bucket_02', None, 1200, 'tub', keep_scale=True),
        'lantern': lambda: import_model('wooden_lantern_01', None, 1500, 'lantern', keep_scale=True),
        'cannon': lambda: import_model('cannon_01', None, 4000, 'cannon', keep_scale=True),
        'treasure-chest': lambda: import_model('treasure_chest', None, 3000, 'treasure-chest', keep_scale=True),
        'shield': lambda: import_model('kite_shield', None, 1500, 'shield', keep_scale=True),
        'ladder': lambda: import_model('wooden_ladder', None, 1500, 'ladder', keep_scale=True),
        'spinning-wheel': lambda: import_model('spinning_wheel_01', None, 3000, 'spinning-wheel', keep_scale=True),
        'basket': lambda: import_model('wicker_basket_01', None, 1500, 'basket', keep_scale=True),
        'table': lambda: import_model('WoodenTable_01', None, 1000, 'table', keep_scale=True),
        'pickaxe': lambda: import_model('picke_dirty_01', None, 1000, 'pickaxe', keep_scale=True),
        'ship': lambda: import_model('dutch_ship_medium', None, 15000, 'ship', keep_scale=True, rot=90),
    }
