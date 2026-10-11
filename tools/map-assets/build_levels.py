"""Pieces for the showcase levels (loaded by build_models.py).

Mountain village (stone houses with wooden balconies, small chapel,
retaining walls, a cable car with station, pylon and gondola), swamp at
night (boardwalk with lantern, witch's hut, rotten boat), desert canyon
(temple ruin, caravan tent, camel saddle, trade goods), archipelago
(quay, harbour crane, long jetty, fisher's hut, buoys, rowing and fishing
boats), winter village (sled, snowy woodpile, ice fishing hut), volcano
(obsidian slabs, lava bridge, forge) and autumn castle ruin (ruined wall
corner, keep ruin, gate ruin, leaf pile). Every piece gets baked AO.
"""
import math
import random

from mathutils import Vector

from blender_kit import (
    Part, box, card, card_material, clear_scene, flat_material, image_material, oriented_box, pbr_material, tilt, tube,
    two_sided,
)
from blender_kit import finish as export  # noqa: F401  (baked AO)
import blender_kit
from build_nature import lump
from build_structures import RUIN, arch_wall, gable_roof, house, merlons, pyramid_roof

WOOD = 'weathered_planks'


def planks(tint=None, uv=1.5):
    return Part(pbr_material('planks-' + WOOD + ('-t' if tint else ''), WOOD, tint), uv_metres=uv)


def dark_wood():
    return Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)


def iron():
    return flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8)


def lamp_glass(colour=(1.0, 0.75, 0.4), strength=1.2):
    return flat_material('lamp-glass-' + '-'.join('%.2f' % c for c in colour), colour, 0.3, emission=colour, strength=strength)


def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def hull(part, length, beam, depth, sheer=0.25, stations=9, broken=None, rnd=None):
    """Open boat hull along Y (bow at -Y): U-shaped sections, pointed bow, a transom stern"""
    bm = part.bm
    rings = []
    for i in range(stations):
        t = i / (stations - 1)
        y = -length / 2 + t * length
        w = beam / 2 * (math.sin(min(1.0, t * 1.25) * math.pi / 2) ** 0.8) * (1.0 if t < 0.85 else 0.95)
        w = max(w, 0.02)
        top = depth + sheer * (1 - t) ** 2 * 2
        ring = []
        for k in range(7):
            a = k / 6 * math.pi
            ring.append(bm.verts.new((-math.cos(a) * w, y, top - math.sin(a) * depth * (0.4 + 0.6 * min(1, t * 3)))))
        rings.append(ring)
    faces = []
    for i in range(stations - 1):
        for k in range(6):
            if broken and rnd and rnd.random() < broken and 0 < i < stations - 2:
                continue
            q = (rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k])
            f = bm.faces.new(q)
            faces.append(f)
            for loop, uv in zip(f.loops, [(i, k), (i, k + 1), (i + 1, k + 1), (i + 1, k)]):
                loop[part.uv].uv = (uv[0] * length / stations / 1.5, uv[1] * 0.25)
    stern = bm.faces.new(list(reversed(rings[-1])))
    faces.append(stern)
    return faces


# ---------------------------------------------------------------- mountain village

def balcony(w, d, wall_h, pitch):
    """Wooden balcony along the front of the upper floor, on brackets, with a slatted railing"""
    wood = planks((0.75, 0.62, 0.5))
    z = wall_h * 0.55
    box(wood, 0, -d / 2 - 0.6, z, w - 0.6, 1.2, 0.12)
    for k in range(int((w - 0.6) / 0.16)):
        x = -w / 2 + 0.4 + k * 0.16
        box(wood, x, -d / 2 - 1.15, z + 0.12, 0.08, 0.04, 0.95)
    box(wood, 0, -d / 2 - 1.15, z + 1.05, w - 0.6, 0.1, 0.08)
    for x in (-w / 2 + 0.5, 0, w / 2 - 0.5):
        oriented_box(wood, Vector((x, -d / 2, z - 0.9)), Vector((x, -d / 2 - 1.0, z)), 0.12)
    return [wood]


def chapel_small(name, snow=False):
    """Mountain chapel: a short stone nave with an apse, a timber bell turret on the ridge"""
    def turret(w, d, wall_h, pitch):
        wood = planks((0.6, 0.5, 0.42))
        roof = Part(pbr_material('roof-roof_slates_02', 'roof_slates_02'))
        bell = Part(flat_material('bell-bronze', (0.45, 0.32, 0.12), 0.35, 0.9), smooth=True)
        top = wall_h + pitch
        for x in (-0.5, 0.5):
            for y in (-0.5, 0.5):
                box(wood, w / 2 - 1.2 + x, y, top - 0.6, 0.12, 0.12, 2.2)
        box(wood, w / 2 - 1.2, 0, top - 0.2, 1.3, 1.3, 0.15)
        pyramid_roof(roof, 1.2, 1.2, top + 1.6, 1.6, 0.25, cx=w / 2 - 1.2)
        tube(bell, [Vector((w / 2 - 1.2, 0, top + 0.6)), Vector((w / 2 - 1.2, 0, top + 1.2))], [0.32, 0.2], 10, cap=True)
        stone = Part(pbr_material('stone-stacked', 'stacked_stone_wall'), uv_metres=2.0)
        tube(stone, [Vector((-w / 2 - 0.1, 0, -1.0)), Vector((-w / 2 - 0.1, 0, wall_h - 0.4))], [d * 0.42, d * 0.42], 12, cap=True)
        return [wood, roof, bell, stone]
    house(name, 9.0, 6.0, 4.2, 'roof_slates_02', 'stacked_stone_wall', frame=False, snow=snow, extra=turret)


def retaining_wall(name, length=6.0, height=2.6, curve=False):
    """Dry stone retaining wall with a batter and a coping, straight or a quarter circle (radius 6 m)"""
    clear_scene()
    stone = Part(pbr_material('stone-rock_wall_10', 'rock_wall_10'), uv_metres=1.5)
    cap = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=1.0)
    segs = 8 if curve else 1
    for k in range(segs):
        if curve:
            a0, a1 = k / segs * math.pi / 2, (k + 1) / segs * math.pi / 2
            am = (a0 + a1) / 2
            r = 6.0
            c = Vector((math.cos(am) * r - r, math.sin(am) * r, 0))
            seg_len = r * (a1 - a0) + 0.05
            rot = am + math.pi / 2
        else:
            c, seg_len, rot = Vector((0, 0, 0)), length, 0.0
        # Battered: wider at the foot
        for i, (z, th) in enumerate(((-0.8, 1.3), (height * 0.35, 1.0), (height * 0.7, 0.8))):
            top = height * (0.35, 0.7, 1.0)[i]
            box(stone, c.x, c.y, z, seg_len, th, top - z, rot)
        box(cap, c.x, c.y, height, seg_len + 0.05, 0.95, 0.18, rot)
    export(name, [stone.to_object(name), cap.to_object(name + '-coping')])


def cable_pylon(name, height=16.0):
    """Lattice pylon with a crossarm and sheave trains for two cables"""
    clear_scene()
    steel = Part(flat_material('pylon-steel', (0.5, 0.52, 0.5), 0.45, 0.8))
    sheave = Part(flat_material('sheave', (0.15, 0.15, 0.16), 0.5, 0.6), smooth=True)
    s = 1.4
    corners = [Vector((x, y, 0)) for x, y in ((-s, -s), (s, -s), (s, s), (-s, s))]
    for c in corners:
        oriented_box(steel, c + Vector((0, 0, -0.6)), c * 0.35 + Vector((0, 0, height)), 0.16)
    segs = 7
    for j in range(segs):
        z0, z1 = j * height / segs, (j + 1) * height / segs
        f0, f1 = 1 - 0.65 * z0 / height, 1 - 0.65 * z1 / height
        for k in range(4):
            a, b = corners[k] * f0 + Vector((0, 0, z0)), corners[(k + 1) % 4] * f1 + Vector((0, 0, z1))
            oriented_box(steel, a, b, 0.06)
            oriented_box(steel, a, corners[(k + 1) % 4] * f0 + Vector((0, 0, z0)), 0.06)
    oriented_box(steel, Vector((-3.0, 0, height)), Vector((3.0, 0, height)), 0.3)
    for x in (-2.6, 2.6):
        for y in (-0.6, 0.0, 0.6):
            tube(sheave, [Vector((x - 0.05, y, height + 0.25)), Vector((x + 0.05, y, height + 0.25))], [0.22, 0.22], 10, cap=True)
    export(name, [steel.to_object(name), sheave.to_object(name + '-sheaves')])


def gondola(name):
    """Small cable car cabin hanging from its grip arm"""
    clear_scene()
    body = Part(flat_material('gondola-red', (0.6, 0.1, 0.08), 0.35, 0.3), bevel=0.06)
    glass = Part(flat_material('car-glass', (0.08, 0.1, 0.12), 0.05, 0.6))
    steel = Part(flat_material('pylon-steel', (0.5, 0.52, 0.5), 0.45, 0.8), smooth=True)
    box(body, 0, 0, 0.0, 2.2, 1.8, 0.9)
    box(glass, 0, 0, 0.9, 2.1, 1.7, 0.9)
    box(body, 0, 0, 1.8, 2.3, 1.9, 0.25)
    oriented_box(steel, Vector((0, 0, 2.05)), Vector((0, 0, 4.0)), 0.12)
    oriented_box(steel, Vector((0, 0, 4.0)), Vector((0.6, 0, 4.4)), 0.1)
    tube(steel, [Vector((-0.6, 0, 4.4)), Vector((0.9, 0, 4.4))], [0.12, 0.12], 8, cap=True)
    export(name, [body.to_object(name), glass.to_object(name + '-glass'), steel.to_object(name + '-hanger')])


def cable_station(name):
    """Valley station: stone base hall, a steel roof frame over the bullwheel, a parked gondola, cables out"""
    clear_scene()
    stone = Part(pbr_material('stone-stacked', 'stacked_stone_wall'), uv_metres=2.0)
    wood = planks((0.7, 0.6, 0.5))
    steel = Part(flat_material('pylon-steel', (0.5, 0.52, 0.5), 0.45, 0.8), smooth=True)
    roof = Part(pbr_material('roof-roof_slates_02', 'roof_slates_02'))
    cable = Part(flat_material('cable', (0.1, 0.1, 0.1), 0.4, 0.8), smooth=True)
    dark = Part(flat_material('window', (0.05, 0.06, 0.07), 0.2, 0.3))
    box(stone, 0, 3.0, -1.0, 10.0, 6.0, 4.6)
    for k in range(3):
        box(dark, -3 + k * 3, -0.02, 1.0, 1.2, 0.1, 1.4)
    box(wood, 0, -2.0, 3.6, 10.0, 8.0, 0.25)
    for x in (-4.6, 4.6):
        for y in (-5.6, -1.0):
            oriented_box(steel, Vector((x, y, 0)), Vector((x, y, 7.0)), 0.25)
    for y in (-5.6, -1.0):
        oriented_box(steel, Vector((-4.6, y, 7.0)), Vector((4.6, y, 7.0)), 0.25)
    gable_roof(roof, 10.6, 6.0, 7.2, 1.2, 0.4)
    for v in roof.bm.verts:
        v.co.y -= 3.3
    c = Vector((0, -3.3, 4.6))
    tube(steel, [c, c + Vector((0, 0, 0.35))], [2.4, 2.4], 24, cap=True)
    tube(steel, [c + Vector((0, 0, 0.35)), c + Vector((0, 0, 2.4))], [0.35, 0.35], 10, cap=True)
    for x in (-2.4, 2.4):
        tube(cable, [Vector((x, -3.3, 4.8)), Vector((x, -12.0, 5.5)), Vector((x, -22.0, 7.0))], [0.05, 0.05, 0.05], 6)
    cab = Part(flat_material('gondola-red', (0.6, 0.1, 0.08), 0.35, 0.3), bevel=0.06)
    box(cab, 2.4, -6.0, 1.9, 2.2, 1.8, 1.8)
    oriented_box(steel, Vector((2.4, -6.0, 3.7)), Vector((2.4, -6.0, 4.8)), 0.1)
    export(name, [stone.to_object(name), wood.to_object(name + '-deck'), steel.to_object(name + '-steel'), roof.to_object(name + '-roof'),
                  cable.to_object(name + '-cables'), dark.to_object(name + '-windows'), cab.to_object(name + '-gondola')])


# ---------------------------------------------------------------- swamp at night

def boardwalk_lantern(name):
    """Boardwalk piece (4 m along X) with a post carrying a glowing lantern"""
    clear_scene()
    deck = planks()
    posts = Part(pbr_material('bark-bark_willow', 'bark_willow', (0.8, 0.8, 0.75)), smooth=True)
    metal = Part(iron(), bevel=0.01)
    glass = Part(lamp_glass())
    rnd = random.Random(4)
    n = 13
    for k in range(n):
        x = -2.0 + (k + 0.5) * 4.0 / n
        box(deck, x, rnd.uniform(-0.04, 0.04), 0.53, 4.0 / n - 0.03, 1.8 + rnd.uniform(-0.08, 0.08), 0.07, rnd.uniform(-0.02, 0.02))
    for y in (-0.75, 0.75):
        box(deck, 0, y, 0.35, 4.0, 0.12, 0.18)
        for x in (-1.8, 1.8):
            tube(posts, [Vector((x, y, -1.2)), Vector((x, y, 0.53))], [0.1, 0.09], 6)
    tube(posts, [Vector((1.6, -0.95, -1.2)), Vector((1.6, -0.95, 2.6))], [0.09, 0.08], 6)
    oriented_box(posts, Vector((1.6, -0.95, 2.5)), Vector((1.1, -0.95, 2.6)), 0.07)
    box(metal, 1.1, -0.95, 2.0, 0.26, 0.26, 0.05)
    box(glass, 1.1, -0.95, 2.05, 0.2, 0.2, 0.3)
    box(metal, 1.1, -0.95, 2.35, 0.3, 0.3, 0.06)
    export(name, [deck.to_object(name), posts.to_object(name + '-posts'), metal.to_object(name + '-iron'), glass.to_object(name + '-glass')])


def witch_hut(name):
    """Crooked hut on stilts: leaning plank walls, a sagging reed roof, a crooked chimney, glowing windows,
    herbs and bones on strings, a cauldron by the ladder"""
    clear_scene()
    rnd = random.Random(13)
    wood = planks((0.6, 0.55, 0.45))
    posts = Part(pbr_material('bark-bark_willow', 'bark_willow', (0.6, 0.6, 0.55)), smooth=True)
    reed = Part(pbr_material('roof-reed_roof_04', 'reed_roof_04', (0.7, 0.65, 0.55)))
    stone = Part(pbr_material('stone-stacked', 'stacked_stone_wall'), uv_metres=1.5)
    glow = Part(lamp_glass((0.6, 1.0, 0.35), 1.0))
    iron_p = Part(iron(), smooth=True)
    z = 2.0
    for x in (-2.0, 0.0, 2.0):
        for y in (-1.6, 1.6):
            tube(posts, [Vector((x + rnd.uniform(-0.2, 0.2), y, -1.0)), Vector((x, y, z))], [0.14, 0.12], 6)
    box(wood, 0, -0.3, z, 4.8, 4.2, 0.15)
    box(wood, 0, 0, z + 0.15, 4.0, 3.2, 2.2, 0.06)
    gable_roof(reed, 4.0, 3.2, z + 2.35, 1.6, 0.7)
    for v in reed.bm.verts:
        v.co.z -= 0.35 * (1 - abs(v.co.x) / 2.7) * (1 if v.co.z > z + 3.0 else 0)
    tube(stone, [Vector((1.4, 0.9, z + 1.5)), Vector((1.5, 0.95, z + 3.4)), Vector((1.75, 1.1, z + 4.4))], [0.32, 0.28, 0.25], 6, cap=True)
    for x in (-1.0, 0.9):
        box(glow, x, -1.62, z + 1.0, 0.6, 0.06, 0.55)
    box(glow, 2.02, 0.0, z + 1.0, 0.06, 0.6, 0.55)
    for k in range(6):
        x = -1.8 + k * 0.6
        oriented_box(posts, Vector((x, -2.0, z + 2.4)), Vector((x + 0.05, -2.0, z + 1.6 - 0.2 * (k % 2))), 0.03)
        lump(wood if k % 2 else stone, Vector((x, -2.0, z + 1.35 - 0.2 * (k % 2))), Vector((0.1, 0.1, 0.18)), 20 + k, subdiv=1)
    for k in range(6):
        t = (k + 0.5) / 6
        p = Vector((-2.3, -2.0 + t * 1.2, -0.2 + t * (z + 0.2)))
        oriented_box(posts, p - Vector((0, 0, 0)) + Vector((-0.3, 0, 0)), p + Vector((0.3, 0, 0)), 0.05)
    goo = Part(lamp_glass((0.4, 1.0, 0.2), 1.8), smooth=True)
    cauldron(iron_p, goo, Vector((-3.2, -2.6, 0.0)), random.Random(5))
    objects = [wood.to_object(name), posts.to_object(name + '-posts'), reed.to_object(name + '-roof'), stone.to_object(name + '-chimney'),
               glow.to_object(name + '-windows'), iron_p.to_object(name + '-cauldron'), goo.to_object(name + '-brew')]
    export(name, objects)


def cauldron(metal, brew, c, rnd, r=0.55):
    """Iron cauldron on three legs, brimful of a glowing brew with bubbles breaking the surface"""
    for k in range(3):
        a = k / 3 * math.tau
        oriented_box(metal, c + Vector((math.cos(a) * r * 0.7, math.sin(a) * r * 0.7, 0.3)), c + Vector((math.cos(a) * r, math.sin(a) * r, -0.05)), 0.07)
    prof = [(0.25, 0.25), (0.35, 0.7), (0.6, 1.0), (0.85, 0.95), (0.92, 0.88), (0.95, 0.92)]
    tube(metal, [c + Vector((0, 0, z)) for z, _ in prof], [r * f for _, f in prof], 16, cap=True)
    surface = [(0.9, 0.86), (0.96, 0.6), (0.99, 0.0)]
    tube(brew, [c + Vector((0, 0, z)) for z, _ in surface], [r * f for _, f in surface], 16)
    for k in range(6):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(0, r * 0.6)
        p = c + Vector((math.cos(a) * d, math.sin(a) * d, 0.97))
        tube(brew, [p - Vector((0, 0, 0.04)), p + Vector((0, 0, 0.03)), p + Vector((0, 0, 0.07))], [0.07, 0.07, 0.0], 8)


def cauldron_prop(name):
    clear_scene()
    metal = Part(iron(), smooth=True)
    brew = Part(lamp_glass((0.4, 1.0, 0.2), 1.8), smooth=True)
    cauldron(metal, brew, Vector((0, 0, 0)), random.Random(7))
    logs = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02'), smooth=True)
    for k in range(4):
        a = k / 4 * math.pi + 0.3
        d = Vector((math.cos(a), math.sin(a), 0))
        tube(logs, [-d * 0.55 + Vector((0, 0, 0.06)), d * 0.55 + Vector((0, 0, 0.1))], [0.06, 0.05], 6, cap=True)
    export(name, [metal.to_object(name), brew.to_object(name + '-brew'), logs.to_object(name + '-logs')])


def rowboat(name, rotten=False):
    clear_scene()
    rnd = random.Random(21)
    wood = planks((0.7, 0.6, 0.5) if not rotten else (0.45, 0.42, 0.36))
    wood.bevel = 0.0
    hull(wood, 4.2, 1.5, 0.6, broken=0.12 if rotten else None, rnd=rnd)
    seats = planks((0.65, 0.55, 0.45))
    for y in (-0.8, 0.3, 1.3):
        box(seats, 0, y, 0.38, 1.3 if y > -0.5 else 1.0, 0.25, 0.05)
    objects = [wood.to_object(name), seats.to_object(name + '-seats')]
    if not rotten:
        oar = planks((0.75, 0.65, 0.5))
        for s in (-1, 1):
            oriented_box(oar, Vector((s * 0.55, -0.2, 0.5)), Vector((s * 0.45, 1.8, 0.45)), 0.05)
        objects.append(oar.to_object(name + '-oars'))
        # Origin at the waterline (catalogue float): the hull reaches 0.25 m below it
        tilt(objects, lift=-0.25)
        export(name, objects)
        return
    tilt(objects, x=-6, y=14, z=0, lift=-0.35)
    export(name, objects)


def fishing_boat(name):
    """Small fishing boat: deep hull, a wheelhouse aft, a mast with a boom, nets on deck"""
    clear_scene()
    paint = Part(flat_material('hull-blue', (0.12, 0.22, 0.4), 0.45, 0.1))
    wood = planks((0.7, 0.62, 0.52))
    hull(paint, 9.0, 3.0, 1.6, sheer=0.5)
    box(wood, 0, 0.3, 1.2, 2.6, 8.0, 0.1)
    box(wood, 0, 2.3, 1.3, 2.0, 2.2, 1.9)
    cabin_roof = Part(flat_material('cabin-white', (0.82, 0.82, 0.8), 0.5))
    box(cabin_roof, 0, 2.3, 3.2, 2.2, 2.4, 0.12)
    dark = Part(flat_material('window', (0.05, 0.06, 0.07), 0.2, 0.3))
    box(dark, 0, 1.18, 2.2, 1.6, 0.05, 0.6)
    mast = Part(pbr_material('planks-dark', 'dark_planks'), smooth=True)
    tube(mast, [Vector((0, -1.5, 1.3)), Vector((0, -1.5, 7.5))], [0.12, 0.08], 8, cap=True)
    oriented_box(mast, Vector((0, -1.5, 3.0)), Vector((0, 1.2, 2.6)), 0.08)
    net = Part(card_material('net', 'net.png'))
    up = lambda co: Vector((0, 0, 1))
    net.quad([Vector((-1.0, -3.2, 1.35)), Vector((1.0, -3.2, 1.35)), Vector((1.0, -1.8, 1.45)), Vector((-1.0, -1.8, 1.45))],
             [(0, 0), (2, 0), (2, 1.4), (0, 1.4)], up)
    objects = [paint.to_object(name), wood.to_object(name + '-deck'), cabin_roof.to_object(name + '-roof'), dark.to_object(name + '-windows'),
               mast.to_object(name + '-mast'), net.to_object(name + '-net')]
    tilt(objects, lift=-0.9)  # waterline at the origin
    export(name, objects)


# ---------------------------------------------------------------- desert canyon

def temple_ruin(name, seed=0):
    """Broken sandstone temple: stepped base, columns snapped at different heights, part of the lintel
    fallen, blocks scattered"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('wall-sandstone_blocks_04', 'sandstone_blocks_04'), uv_metres=3.0)
    col = Part(pbr_material('rock-sandstone_cracks', 'sandstone_cracks'), smooth=True)
    dark = Part(flat_material('temple-dark', (0.04, 0.035, 0.03), 0.9))
    w, d = 18.0, 14.0
    for k in range(3):
        box(stone, 0, 0, -0.8 + k * 0.5, w - k * 1.2, d - k * 1.2, 0.8)
    box(stone, 0, 2.0, 0.7, w - 4.0, d - 6.0, 5.5)
    box(dark, 0, -1.02, 0.7, 3.0, 0.1, 4.0)
    heights = [7.3, 3.1, 7.3, 1.8, 5.2, 7.3]
    for k, hgt in enumerate(heights):
        x = -w / 2 + 2.5 + k * (w - 5.0) / 5
        tube(col, [Vector((x, -d / 2 + 2.2, 0.7)), Vector((x, -d / 2 + 2.2, 0.7 + hgt))], [0.65, 0.58], 14, cap=True)
        box(stone, x, -d / 2 + 2.2, 0.7, 1.6, 1.6, 0.4)
    box(stone, -w / 2 + 5.0, -d / 2 + 2.2, 8.0, 8.5, 1.8, 1.2)
    box(stone, w / 2 - 2.5, -d / 2 + 2.2, 8.0, 3.0, 1.8, 1.2)
    tube(col, [Vector((1.5, -d / 2 - 1.5, 0.3)), Vector((6.0, -d / 2 - 2.6, 0.35))], [0.6, 0.6], 14, cap=True)
    for k in range(10):
        box(stone, rnd.uniform(-w / 2, w / 2), -d / 2 - rnd.uniform(0.5, 3.5), -0.2, rnd.uniform(0.8, 1.8), rnd.uniform(0.6, 1.2),
            rnd.uniform(0.5, 1.0), rnd.uniform(0, 3))
    export(name, [stone.to_object(name), smooth(col.to_object(name + '-columns')), dark.to_object(name + '-door')])


def caravan_tent(name):
    """Large striped tent: a ridge on two poles, open front with flaps tied back, guy ropes to stakes, rugs"""
    clear_scene()
    cloth = Part(two_sided(image_material('tent-stripes', blender_kit.FOLIAGE + '/tent-stripes.jpg', 0.85)))
    poles = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    rope = Part(flat_material('rope', (0.55, 0.45, 0.3), 0.9))
    rug = Part(flat_material('rug-red', (0.5, 0.12, 0.08), 0.9))
    L, W, H, eave = 8.0, 6.0, 3.6, 1.6
    for y in (-L / 2, L / 2):
        tube(poles, [Vector((0, y, -0.3)), Vector((0, y, H + 0.4))], [0.08, 0.07], 6)
    for sx in (-1, 1):
        q = [Vector((sx * W / 2, -L / 2, eave)), Vector((sx * W / 2, L / 2, eave)), Vector((0, L / 2, H)), Vector((0, -L / 2, H))]
        cloth.quad(q if sx > 0 else list(reversed(q)), [(0, 0), (4, 0), (4, 1), (0, 1)] if sx > 0 else [(0, 1), (4, 1), (4, 0), (0, 0)])
        wall = [Vector((sx * W / 2, -L / 2, 0)), Vector((sx * W / 2, L / 2, 0)), Vector((sx * W / 2, L / 2, eave)), Vector((sx * W / 2, -L / 2, eave))]
        cloth.quad(wall if sx > 0 else list(reversed(wall)), [(0, 0), (4, 0), (4, 0.4), (0, 0.4)] if sx > 0 else [(0, 0.4), (4, 0.4), (4, 0), (0, 0)])
        for y in (-L / 2, 0, L / 2):
            tube(poles, [Vector((sx * W / 2, y, -0.3)), Vector((sx * W / 2, y, eave))], [0.05, 0.05], 5)
            oriented_box(rope, Vector((sx * W / 2, y, eave)), Vector((sx * (W / 2 + 1.8), y, 0.05)), 0.02)
            box(poles, sx * (W / 2 + 1.8), y, -0.2, 0.06, 0.06, 0.35)
    back = [Vector((-W / 2, L / 2, 0)), Vector((W / 2, L / 2, 0)), Vector((W / 2, L / 2, eave)), Vector((0, L / 2, H)), Vector((-W / 2, L / 2, eave))]
    f = cloth.bm.faces.new([cloth.bm.verts.new(v) for v in back])
    for loop in f.loops:
        loop[cloth.uv].uv = (loop.vert.co.x / 2, loop.vert.co.z / 4)
    for sx in (-1, 1):
        flap = [Vector((sx * 0.3, -L / 2, H - 0.3)), Vector((sx * W / 2, -L / 2, eave)), Vector((sx * W / 2 - 0.3, -L / 2 - 0.4, 0.2)),
                Vector((sx * 1.2, -L / 2 - 0.3, 0.6))]
        cloth.quad(flap if sx > 0 else list(reversed(flap)), [(0, 1), (1, 1), (1, 0), (0, 0)] if sx > 0 else [(0, 0), (1, 0), (1, 1), (0, 1)])
    box(rug, 0, 0.5, 0.0, W * 0.75, L * 0.7, 0.03)
    export(name, [cloth.to_object(name), poles.to_object(name + '-poles'), rope.to_object(name + '-ropes'), rug.to_object(name + '-rug')])


def camel_saddle(name):
    """Camel saddle on the ground: wooden saddle arches, a striped blanket, bulging bags and a water skin"""
    clear_scene()
    wood = Part(pbr_material('planks-dark', 'dark_planks', (0.85, 0.7, 0.55)), smooth=True)
    blanket = Part(image_material('tent-stripes', blender_kit.FOLIAGE + '/tent-stripes.jpg', 0.85), uv_metres=0.8, bevel=0.04)
    bags = Part(pbr_material('cloth-hessian-bags', 'hessian_230', (0.9, 0.75, 0.55)), uv_metres=0.6, smooth=True)
    leather = Part(flat_material('leather', (0.35, 0.2, 0.1), 0.6), smooth=True)
    box(blanket, 0, 0, 0.0, 1.1, 1.4, 0.12)
    for y in (-0.45, 0.45):
        pts = [Vector((-0.5, y, 0.12)), Vector((-0.35, y, 0.55)), Vector((0.0, y, 0.75)), Vector((0.35, y, 0.55)), Vector((0.5, y, 0.12))]
        tube(wood, pts, [0.05] * 5, 6)
        tube(wood, [Vector((0, y, 0.7)), Vector((0, y, 0.95))], [0.05, 0.08], 6, cap=True)
    oriented_box(wood, Vector((0, -0.45, 0.72)), Vector((0, 0.45, 0.72)), 0.08)
    for sx in (-1, 1):
        lump(bags, Vector((sx * 0.75, 0, 0.0)), Vector((0.3, 0.45, 0.35)), 31 + sx, roughness=0.2, flat_bottom=True, subdiv=2)
    tube(leather, [Vector((0.2, 0.9, 0.1)), Vector((0.25, 1.1, 0.18)), Vector((0.3, 1.35, 0.1))], [0.12, 0.2, 0.08], 10, cap=True)
    export(name, [wood.to_object(name), blanket.to_object(name + '-blanket'), smooth(bags.to_object(name + '-bags')), leather.to_object(name + '-skin')])


def trade_goods(name, seed=5):
    """Caravan goods: sacks, rolled rugs, clay jars and a chest"""
    clear_scene()
    rnd = random.Random(seed)
    sacks = Part(pbr_material('cloth-hessian-bags', 'hessian_230', (0.9, 0.78, 0.58)), uv_metres=0.6, smooth=True)
    rugs = Part(image_material('tent-stripes', blender_kit.FOLIAGE + '/tent-stripes.jpg', 0.85), smooth=True)
    clay = Part(pbr_material('wall-patterned_clay_wall-jar', 'patterned_clay_wall', (1.1, 0.8, 0.6)), smooth=True)
    for k in range(5):
        lump(sacks, Vector((rnd.uniform(-1, 1), rnd.uniform(-0.6, 0.6), -0.05)), Vector((0.35, 0.28, 0.32)), 40 + k, roughness=0.25, subdiv=2)
    for k in range(3):
        y = -0.9 + k * 0.45
        tube(rugs, [Vector((-1.2, y, 0.18 + 0.3 * (k == 1))), Vector((1.2, y, 0.18 + 0.3 * (k == 1)))], [0.17, 0.17], 12, cap=True)
    for k in range(3):
        c = Vector((1.5 + 0.45 * k, 0.8, 0))
        prof = [(0.0, 0.12), (0.15, 0.25), (0.4, 0.27), (0.62, 0.16), (0.7, 0.09), (0.75, 0.11)]
        tube(clay, [c + Vector((0, 0, z)) for z, _ in prof], [r for _, r in prof], 12, cap=True)
    export(name, [smooth(sacks.to_object(name)), rugs.to_object(name + '-rugs'), clay.to_object(name + '-jars')])


# ---------------------------------------------------------------- archipelago

def harbor_quay(name, length=8.0):
    """Stone quay edge along X: a block wall into the water, a coping, iron bollards, a ladder, tyre fenders"""
    clear_scene()
    stone = Part(pbr_material('wall-stone_block', 'castle_wall_slates', (0.9, 0.9, 0.9)), uv_metres=2.0)
    cap = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=1.0)
    metal = Part(iron(), smooth=True)
    tyre = Part(flat_material('tyre', (0.035, 0.035, 0.035), 0.9), smooth=True)
    box(stone, 0, 1.5, -3.0, length, 4.0, 3.6)
    box(cap, 0, -0.35, 0.6, length + 0.02, 0.8, 0.25)
    for x in (-length / 3, length / 3):
        tube(metal, [Vector((x, 0.3, 0.85)), Vector((x, 0.3, 1.3)), Vector((x, 0.3, 1.4))], [0.18, 0.15, 0.22], 10, cap=True)
    for k in range(9):
        box(metal, length * 0.4, -0.55, -2.8 + k * 0.4, 0.5, 0.05, 0.05)
    for s in (-0.27, 0.27):
        oriented_box(metal, Vector((length * 0.4 + s, -0.55, -3.0)), Vector((length * 0.4 + s, -0.55, 1.4)), 0.05)
    for x in (-length * 0.2, 0.0):
        tube(tyre, [Vector((x, -0.5, -0.1)), Vector((x, -0.75, -0.1))], [0.4, 0.4], 14, cap=True)
    export(name, [stone.to_object(name), cap.to_object(name + '-coping'), metal.to_object(name + '-iron'), tyre.to_object(name + '-fenders')])


def harbor_crane(name):
    """Wooden jib crane on a stone pad: mast, jib with a rope and hook, a winch"""
    clear_scene()
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=1.0)
    wood = Part(pbr_material('planks-dark', 'dark_planks', (0.9, 0.8, 0.7)), uv_metres=1.0)
    metal = Part(iron(), smooth=True)
    rope = Part(flat_material('rope', (0.55, 0.45, 0.3), 0.9), smooth=True)
    box(stone, 0, 0, -0.5, 2.4, 2.4, 1.0)
    box(wood, 0, 0, 0.5, 0.45, 0.45, 7.0)
    oriented_box(wood, Vector((0, 0, 2.0)), Vector((0, -5.5, 6.8)), 0.3)
    oriented_box(wood, Vector((0, 0, 7.3)), Vector((0, -5.5, 6.8)), 0.15)
    tube(rope, [Vector((0, -5.5, 6.7)), Vector((0, -5.5, 2.4))], [0.03, 0.03], 5)
    tube(metal, [Vector((0, -5.5, 2.4)), Vector((0, -5.5, 2.0))], [0.12, 0.02], 6, cap=True)
    tube(wood, [Vector((-0.6, 0.5, 1.3)), Vector((0.6, 0.5, 1.3))], [0.25, 0.25], 10, cap=True)
    export(name, [stone.to_object(name), wood.to_object(name + '-wood'), metal.to_object(name + '-hook'), rope.to_object(name + '-rope')])


def jetty(name, length=12.0, width=2.4):
    """Long wooden jetty along X on pairs of piles, with a few bollards; deck at 1.2 m"""
    clear_scene()
    deck = planks()
    piles = Part(pbr_material('bark-bark_willow', 'bark_willow', (0.7, 0.7, 0.65)), smooth=True)
    rnd = random.Random(8)
    n = int(length / 0.3)
    for k in range(n):
        x = -length / 2 + (k + 0.5) * length / n
        box(deck, x, rnd.uniform(-0.03, 0.03), 1.13, length / n - 0.03, width, 0.07)
    for y in (-width / 2 + 0.2, width / 2 - 0.2):
        box(deck, 0, y, 0.85, length, 0.18, 0.28)
    for k in range(int(length / 2.5) + 1):
        x = -length / 2 + 0.2 + k * (length - 0.4) / int(length / 2.5)
        for y in (-width / 2 - 0.05, width / 2 + 0.05):
            tube(piles, [Vector((x, y, -2.5)), Vector((x, y, 1.6 if k % 2 == 0 else 1.1))], [0.14, 0.13], 7, cap=True)
    export(name, [deck.to_object(name), piles.to_object(name + '-piles')])


def fisher_hut(name):
    """Fisher's hut of tarred planks with a net drying on a rack and crab pots"""
    def nets(w, d, wall_h, pitch):
        rack = Part(pbr_material('bark-bark_willow', 'bark_willow', (0.7, 0.7, 0.65)), smooth=True)
        net = Part(card_material('net', 'net.png'))
        for x in (w / 2 + 1.0, w / 2 + 4.0):
            tube(rack, [Vector((x, -1.0, -0.3)), Vector((x, -1.0, 2.2))], [0.06, 0.06], 6)
        oriented_box(rack, Vector((w / 2 + 1.0, -1.0, 2.1)), Vector((w / 2 + 4.0, -1.0, 2.1)), 0.06)
        front = lambda co: Vector((0, -1, 0))
        net.quad([Vector((w / 2 + 1.05, -1.0, 0.4)), Vector((w / 2 + 3.95, -1.0, 0.2)), Vector((w / 2 + 3.95, -1.0, 2.05)),
                  Vector((w / 2 + 1.05, -1.0, 2.05))], [(0, 0), (3, 0), (3, 1.8), (0, 1.8)], front)
        pots = Part(flat_material('crab-pot', (0.3, 0.25, 0.18), 0.8))
        for k in range(3):
            box(pots, -w / 2 - 0.8, -1.5 + k * 0.7, 0.0 + 0.45 * (k == 1), 0.6, 0.6, 0.45)
        return [rack, net, pots]
    house(name, 5.0, 4.0, 2.8, 'roof_planks', 'weathered_planks', frame=False, barn=False, extra=nets, wall_tint=(0.55, 0.5, 0.45))


def buoy(name, colour):
    """Channel buoy: a float, a cage tower and a light on top (set its height to the water level)"""
    clear_scene()
    paint = Part(flat_material('buoy-' + '-'.join('%.2f' % c for c in colour), colour, 0.4, 0.2), smooth=True)
    metal = Part(flat_material('buoy-steel', (0.2, 0.2, 0.2), 0.5, 0.7))
    glass = Part(lamp_glass(tuple(min(1.0, c * 1.6 + 0.2) for c in colour), 1.4))
    prof = [(-0.6, 0.3), (-0.3, 0.9), (0.0, 1.0), (0.3, 0.9), (0.45, 0.5)]
    tube(paint, [Vector((0, 0, z)) for z, _ in prof], [r for _, r in prof], 16, cap=True)
    for k in range(3):
        a = k / 3 * math.tau
        oriented_box(metal, Vector((math.cos(a) * 0.5, math.sin(a) * 0.5, 0.4)), Vector((math.cos(a) * 0.15, math.sin(a) * 0.15, 2.0)), 0.06)
    tube(paint, [Vector((0, 0, 1.4)), Vector((0, 0, 1.9))], [0.35, 0.3], 10, cap=True)
    tube(glass, [Vector((0, 0, 2.0)), Vector((0, 0, 2.3))], [0.12, 0.1], 8, cap=True)
    export(name, [paint.to_object(name), metal.to_object(name + '-cage'), glass.to_object(name + '-light')])


# ---------------------------------------------------------------- winter village

def sled(name):
    clear_scene()
    wood = planks((0.8, 0.65, 0.5))
    runner = Part(iron(), smooth=True)
    for x in (-0.4, 0.4):
        pts = [Vector((x, 0.9, 0.05)), Vector((x, -0.6, 0.05)), Vector((x, -0.9, 0.2)), Vector((x, -0.95, 0.45))]
        tube(runner, pts, [0.025] * 4, 5)
        for y in (-0.5, 0.0, 0.5):
            box(wood, x, y, 0.05, 0.06, 0.08, 0.35)
    for k in range(6):
        box(wood, 0, -0.6 + k * 0.25, 0.4, 0.95, 0.18, 0.04)
    export(name, [wood.to_object(name), runner.to_object(name + '-runners')])


def woodpile_snow(name):
    """Log stack under a lean-to roof heavy with snow"""
    clear_scene()
    rnd = random.Random(4)
    wood = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02'), smooth=True)
    ends = Part(pbr_material('wood-rough', 'rough_wood', (1.1, 1.0, 0.85)))
    roof = planks((0.6, 0.55, 0.5))
    snow = Part(pbr_material('snow-snow_02', 'snow_02', (0.95, 0.97, 1.0)), uv_metres=2.0, bevel=0.0)
    for row in range(5):
        for k in range(7 - (row % 2)):
            x = -1.2 + (k + 0.5 * (row % 2)) * 0.38
            z = 0.17 + row * 0.3
            r = rnd.uniform(0.14, 0.17)
            tube(wood, [Vector((x, -0.5, z)), Vector((x, 0.5, z))], [r, r], 7)
            for y, sign in ((-0.5, -1), (0.5, 1)):
                ring = [ends.bm.verts.new((x + math.cos(a / 7 * math.tau) * r, y, z + math.sin(a / 7 * math.tau) * r)) for a in range(7)]
                f = ends.bm.faces.new(ring if sign > 0 else list(reversed(ring)))
                for loop in f.loops:
                    loop[ends.uv].uv = (loop.vert.co.x * 2, loop.vert.co.z * 2)
    for x in (-1.6, 1.6):
        box(roof, x, -0.6, 0, 0.12, 0.12, 2.0)
        box(roof, x, 0.6, 0, 0.12, 0.12, 2.3)
    box(roof, 0, 0, 2.15, 3.6, 1.6, 0.08, 0)
    box(snow, 0, 0, 2.23, 3.7, 1.7, 0.18)
    export(name, [wood.to_object(name), ends.to_object(name + '-ends'), roof.to_object(name + '-roof'), snow.to_object(name + '-snow')])


def ice_fishing_hut(name):
    """Little hut on skids, a stovepipe, a hole in the ice with a stool beside it"""
    clear_scene()
    wood = planks((0.55, 0.32, 0.22))
    trim = planks((0.9, 0.88, 0.82))
    metal = Part(iron(), smooth=True)
    hole = Part(flat_material('ice-hole', (0.02, 0.05, 0.08), 0.05, 0.3))
    snow = Part(pbr_material('snow-snow_02', 'snow_02', (0.95, 0.97, 1.0)), uv_metres=2.0, bevel=0.0)
    for x in (-0.9, 0.9):
        box(trim, x, 0, 0, 0.15, 3.0, 0.2)
    box(wood, 0, 0, 0.2, 2.2, 2.6, 2.0)
    box(trim, 0, -1.31, 0.3, 0.8, 0.04, 1.7)
    box(wood, 0, 0, 2.2, 2.5, 2.9, 0.12, 0)
    box(snow, 0, 0, 2.32, 2.5, 2.9, 0.15)
    tube(metal, [Vector((0.6, 0.8, 2.2)), Vector((0.6, 0.8, 3.0))], [0.08, 0.08], 8, cap=True)
    tube(hole, [Vector((1.8, -1.8, 0.0)), Vector((1.8, -1.8, 0.01))], [0.35, 0.35], 14, cap=True)
    box(trim, 2.4, -1.4, 0.0, 0.35, 0.35, 0.4)
    export(name, [wood.to_object(name), trim.to_object(name + '-trim'), metal.to_object(name + '-pipe'), hole.to_object(name + '-hole'),
                  snow.to_object(name + '-snow')])


# ---------------------------------------------------------------- volcano

def obsidian_material():
    """Volcanic glass: near black with a cold blue sheen, mirror-smooth so every facet catches the sky"""
    return flat_material('obsidian', (0.02, 0.02, 0.028), 0.14, 0.0, emission=(0.01, 0.018, 0.04), strength=0.6)


def obsidian_slabs(name, seed):
    """Glassy slabs and shards tilted out of the ground; faceted (flat shaded) like conchoidal fractures"""
    clear_scene()
    rnd = random.Random(seed)
    glass = Part(obsidian_material())
    for k in range(8):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0, 1.8)
        c = Vector((math.cos(a) * r, math.sin(a) * r, -0.3))
        lump(glass, c, Vector((rnd.uniform(0.7, 1.3), rnd.uniform(0.15, 0.3), rnd.uniform(0.6, 1.4))), seed + k, roughness=0.35,
             flat_bottom=True, subdiv=1)
    obj = glass.to_object(name)
    for p in obj.data.polygons:
        p.use_smooth = False
    tilt([obj], z=0)
    export(name, [obj])


def lava_bridge(name, length=14.0, width=4.0):
    """Arch of basalt slabs across a lava channel, the underside lit by the glow (deck at about 2.6 m)"""
    clear_scene()
    rock = Part(pbr_material('rock-dark_rock_02-hell', 'dark_rock_02', (0.62, 0.45, 0.42)), uv_metres=2.0)
    glow = Part(flat_material('hell-glow', (1.0, 0.32, 0.05), 0.4, emission=(1.0, 0.28, 0.04), strength=0.9))
    n = 14
    for k in range(n):
        x0 = -length / 2 + k * length / n
        xm = x0 + length / n / 2
        t = xm / (length / 2)
        top = 0.5 + 2.1 * (1 - t * t)
        bottom = top - 0.9 - 0.4 * (1 - t * t)
        box(rock, xm, 0, min(bottom, -0.5) if abs(t) > 0.8 else bottom, length / n + 0.03, width, top - (min(bottom, -0.5) if abs(t) > 0.8 else bottom),
            0.0)
        box(glow, xm, 0, bottom - 0.02, length / n, width * 0.6, 0.03)
    for side in (-1, 1):
        for k in range(7):
            x = -length / 2 + 1 + k * (length - 2) / 6
            t = x / (length / 2)
            box(rock, x, side * (width / 2 - 0.3), 0.5 + 2.1 * (1 - t * t), 0.6, 0.5, 0.6)
    export(name, [rock.to_object(name), glow.to_object(name + '-glow')])


def forge(name):
    """Smithy: a stone hearth with glowing coals under a hood and chimney, an open timber roof on posts,
    anvil, quench trough, bellows"""
    clear_scene()
    stone = Part(pbr_material('stone-stacked', 'stacked_stone_wall'), uv_metres=1.5)
    wood = Part(pbr_material('planks-dark', 'dark_planks', (0.85, 0.75, 0.6)), uv_metres=1.0)
    roof = Part(pbr_material('roof-roof_planks', 'roof_planks', (0.7, 0.62, 0.55)))
    metal = Part(flat_material('iron-dark', (0.1, 0.1, 0.11), 0.4, 0.9), smooth=True)
    coal = Part(flat_material('embers', (0.6, 0.15, 0.03), 0.9, emission=(1.0, 0.3, 0.05), strength=1.3))
    water = Part(flat_material('trough-water', (0.04, 0.07, 0.07), 0.05))
    leather = Part(flat_material('leather', (0.35, 0.2, 0.1), 0.6), smooth=True)
    box(stone, 0, 2.0, -0.5, 2.4, 1.6, 1.4)
    box(coal, 0, 2.0, 0.9, 1.6, 1.0, 0.06)
    box(stone, 0, 2.4, 0.9, 2.4, 0.8, 1.2)
    box(stone, 0, 2.2, 2.1, 2.0, 1.2, 0.6)
    box(stone, 0, 2.3, 2.7, 1.0, 0.9, 3.2)
    for x in (-3.0, 3.0):
        for y in (-2.0, 2.6):
            box(wood, x, y, -0.3, 0.25, 0.25, 3.6)
    gable_roof(roof, 6.8, 5.6, 3.3, 1.5, 0.3)
    for v in roof.bm.verts:
        v.co.y += 0.3
    for z in (3.15,):
        box(wood, 0, -2.0, z, 6.3, 0.2, 0.2)
        box(wood, 0, 2.6, z, 6.3, 0.2, 0.2)
    tube(wood, [Vector((1.2, -0.6, 0)), Vector((1.2, -0.6, 0.55))], [0.3, 0.28], 9, cap=True)
    box(metal, 1.2, -0.6, 0.55, 0.28, 0.2, 0.12)
    box(metal, 1.2, -0.6, 0.67, 0.16, 0.14, 0.16)
    box(metal, 1.2, -0.6, 0.83, 0.55, 0.22, 0.13)
    box(wood, -1.6, -0.4, 0, 1.4, 0.6, 0.6)
    box(water, -1.6, -0.4, 0.55, 1.2, 0.45, 0.05)
    lump(leather, Vector((1.4, 2.0, 0.6)), Vector((0.5, 0.3, 0.2)), 3, roughness=0.15, subdiv=2)
    export(name, [stone.to_object(name), wood.to_object(name + '-wood'), roof.to_object(name + '-roof'), metal.to_object(name + '-iron'),
                  coal.to_object(name + '-coals'), water.to_object(name + '-water'), leather.to_object(name + '-bellows')])


# ---------------------------------------------------------------- autumn castle ruin

def ruin_corner(name, seed=0, height=6.5, thick=2.0):
    """L-shaped corner of a ruined curtain wall, both arms broken off along jagged lines, ivy patches"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=3.0)
    ivy = Part(card_material('ivy-wall', 'ivy-wall.png'))
    cols = 7
    for arm in range(2):
        for k in range(cols):
            t = k / (cols - 1)
            h = height * (1 - 0.75 * t) * rnd.uniform(0.75, 1.05)
            u = thick / 2 + k * 1.0 + 0.5
            if arm == 0:
                box(stone, u, 0, -0.5, 1.01, thick, h + 0.5)
            else:
                box(stone, 0, u, -0.5, thick, 1.01, h + 0.5)
    box(stone, 0, 0, -0.5, thick, thick, height + 0.8)
    for k in range(5):
        a = rnd.uniform(0, 2.0)
        top = rnd.uniform(3.0, 5.0)
        p = Vector((thick / 2 + a + 0.5, -thick / 2 - 0.04, top))
        # Strands hanging flat on the wall face, normals out from the wall
        card(ivy, p, Vector((0, 0, -1)), Vector((0, -1, 0)), 1.4, top - 0.1, p + Vector((0, 8, 0)))
    for k in range(8):
        box(stone, rnd.uniform(-1, 6), rnd.uniform(-3, -1.2), -0.2, rnd.uniform(0.4, 0.9), rnd.uniform(0.3, 0.6), rnd.uniform(0.3, 0.5), rnd.uniform(0, 3))
    export(name, [stone.to_object(name), ivy.to_object(name + '-ivy')])


def keep_ruin(name, seed=1):
    """Roofless keep broken down on one side, empty windows, a fallen floor beam, ivy"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=3.0)
    dark = Part(flat_material('hole', (0.03, 0.03, 0.03), 0.95))
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    ivy = Part(card_material('ivy-wall', 'ivy-wall.png'))
    s, t, h = 11.0, 1.4, 15.0
    cols = 8
    for side in range(4):
        for k in range(cols):
            u = -s / 2 + (k + 0.5) * s / cols
            top = h * (1.0 - 0.6 * max(0.0, math.sin((k / cols + side * 0.25) * math.pi * 1.3))) * rnd.uniform(0.85, 1.0)
            if side == 0:
                box(stone, u, -s / 2 + t / 2, -0.5, s / cols + 0.01, t, top + 0.5)
            elif side == 1:
                box(stone, s / 2 - t / 2, u, -0.5, t, s / cols + 0.01, top + 0.5)
            elif side == 2:
                box(stone, u, s / 2 - t / 2, -0.5, s / cols + 0.01, t, top + 0.5)
            else:
                box(stone, -s / 2 + t / 2, u, -0.5, t, s / cols + 0.01, top + 0.5)
    for z in (4.5, 9.0):
        for k in (-1, 1):
            box(dark, k * 2.5, -s / 2 - 0.02, z, 0.8, 0.1, 1.6)
    box(dark, 0, -s / 2 - 0.02, 0, 2.0, 0.1, 3.0)
    oriented_box(wood, Vector((-3, -3, 0.3)), Vector((3.5, 2.5, 4.5)), 0.35)
    for k in range(7):
        top = rnd.uniform(4.0, 9.0)
        p = Vector((rnd.uniform(-s / 2 + 1, s / 2 - 1), -s / 2 - 0.04, top))
        card(ivy, p, Vector((0, 0, -1)), Vector((0, -1, 0)), 1.8, top - 0.2, p + Vector((0, 8, 0)))
    export(name, [stone.to_object(name), dark.to_object(name + '-holes'), wood.to_object(name + '-beam'), ivy.to_object(name + '-ivy')])


def gate_ruin(name):
    """Broken gatehouse: one tower stump, the arch standing on the other side with its top fallen"""
    clear_scene()
    rnd = random.Random(3)
    stone = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=3.0)
    box(stone, -5.5, 0, -0.5, 5.0, 5.5, 5.2)
    box(stone, 5.5, 0, -0.5, 5.0, 5.5, 9.5)
    merlons(stone, 3.0, 8.0, -2.45, 9.0, 0.6)
    arch_wall(stone, -3, 3, 0, 4.4, -0.5, 7.0, 0, 4.0, 3.5)
    for k in range(14):
        box(stone, rnd.uniform(-6, 2), rnd.uniform(-5, -2.8), -0.2, rnd.uniform(0.5, 1.4), rnd.uniform(0.4, 1.0), rnd.uniform(0.3, 0.8), rnd.uniform(0, 3))
    export(name, [stone.to_object(name)])


def leaf_pile(name, seed):
    """Heap of fallen leaves: a soft mound with the leaf-litter texture, loose leaf cards on top"""
    clear_scene()
    rnd = random.Random(seed)
    heap = Part(pbr_material('ground-leaves_forest_ground', 'leaves_forest_ground'), uv_metres=1.0)
    leaves = Part(card_material('maple-autumn', 'leaves-maple-autumn.png'))
    lump(heap, Vector((0, 0, -0.35)), Vector((1.3, 1.0, 0.55)), seed, roughness=0.25, subdiv=3)
    for k in range(10):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0, 0.9)
        p = Vector((math.cos(a) * r, math.sin(a) * r, 0.4 * (1 - r) + 0.02))
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0.15)).normalized()
        card(leaves, p - d * 0.35, d, Vector((0, 0, 1)), 0.7, 0.7, p - Vector((0, 0, 1)))
    export(name, [smooth(heap.to_object(name)), leaves.to_object(name + '-leaves')])


def cable_span(name, length=10.0, spacing=5.2, sag=0.0):
    """Two parallel steel cables along +Z (glTF), centred on the origin, `spacing` apart in X (the sheave
    spacing of cablecar-pylon), 2.5 cm thick, sagging `sag` metres in the middle"""
    clear_scene()
    steel = Part(flat_material('cable-steel', (0.12, 0.12, 0.13), 0.35, 0.85), smooth=True)
    n = 16
    for x in (-spacing / 2, spacing / 2):
        pts = [Vector((x, -length / 2 + length * k / n, -sag * 4 * (k / n) * (1 - k / n))) for k in range(n + 1)]
        tube(steel, pts, [0.0125] * len(pts), 6)
    blender_kit.export(name, [steel.to_object(name)])


def models():
    return {
        'house-stone-balcony': lambda: house('house-stone-balcony', 9.0, 6.5, 6.0, 'roof_planks', 'stacked_stone_wall', storeys=2,
                                             frame=False, extra=balcony),
        'house-stone-balcony-snow': lambda: house('house-stone-balcony-snow', 9.0, 6.5, 6.0, 'roof_planks', 'stacked_stone_wall', storeys=2,
                                                  frame=False, snow=True, extra=balcony),
        'chapel-mountain': lambda: chapel_small('chapel-mountain'),
        'chapel-mountain-snow': lambda: chapel_small('chapel-mountain-snow', snow=True),
        'retaining-wall': lambda: retaining_wall('retaining-wall'),
        'retaining-wall-curve': lambda: retaining_wall('retaining-wall-curve', curve=True),
        'cablecar-station': lambda: cable_station('cablecar-station'),
        'cablecar-pylon': lambda: cable_pylon('cablecar-pylon'),
        'cablecar-gondola': lambda: gondola('cablecar-gondola'),
        'cable-span': lambda: cable_span('cable-span'),
        'cable-span-20': lambda: cable_span('cable-span-20', 20.0, sag=0.15),
        'cable-span-40': lambda: cable_span('cable-span-40', 40.0, sag=0.5),
        'boardwalk-lantern': lambda: boardwalk_lantern('boardwalk-lantern'),
        'witch-hut': lambda: witch_hut('witch-hut'),
        'boat-rotten': lambda: rowboat('boat-rotten', rotten=True),
        'cauldron': lambda: cauldron_prop('cauldron'),
        'rowboat': lambda: rowboat('rowboat'),
        'fishing-boat': lambda: fishing_boat('fishing-boat'),
        'temple-ruin': lambda: temple_ruin('temple-ruin', 4),
        'caravan-tent': lambda: caravan_tent('caravan-tent'),
        'camel-saddle': lambda: camel_saddle('camel-saddle'),
        'trade-goods': lambda: trade_goods('trade-goods'),
        'harbor-quay': lambda: harbor_quay('harbor-quay'),
        'harbor-crane': lambda: harbor_crane('harbor-crane'),
        'jetty': lambda: jetty('jetty'),
        'fisher-hut': lambda: fisher_hut('fisher-hut'),
        'buoy-red': lambda: buoy('buoy-red', (0.6, 0.06, 0.05)),
        'buoy-green': lambda: buoy('buoy-green', (0.05, 0.4, 0.15)),
        'sled': lambda: sled('sled'),
        'woodpile-snow': lambda: woodpile_snow('woodpile-snow'),
        'ice-fishing-hut': lambda: ice_fishing_hut('ice-fishing-hut'),
        'obsidian-slabs': lambda: obsidian_slabs('obsidian-slabs', 7),
        'lava-bridge': lambda: lava_bridge('lava-bridge'),
        'forge': lambda: forge('forge'),
        'castle-ruin-corner': lambda: ruin_corner('castle-ruin-corner', 2),
        'keep-ruin': lambda: keep_ruin('keep-ruin'),
        'gate-ruin': lambda: gate_ruin('gate-ruin'),
        'leaf-pile': lambda: leaf_pile('leaf-pile', 9),
    }
