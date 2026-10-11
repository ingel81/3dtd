"""Arctic, hell, mountain, swamp and desert additions of the map asset catalogue (loaded by build_models.py).

Igloo, research station, wind turbine, ice floes, pack ice, icebergs,
icicles, snow drifts; charred trees, thorns, chains, a hell gate, an
altar, glowing lava rocks, obsidian spikes; rope bridge, alpine huts, rock
needles, cairn; moss-hung swamp trees; an oasis pool, a desert temple and
a nomad tent. Built from Poly Haven textures and the shared builders.
"""
import math
import random

import bmesh
from mathutils import Vector, noise

from blender_kit import finish as export  # noqa: F401  (every structure gets baked AO)
from blender_kit import (
    Part, two_sided, box, card, card_material, clear_scene, flat_material, glow_card_material, oriented_box, pbr_material,
    tube,
)
from build_nature import crystals, dead_tree, hoodoo, lump, stalagmites
from build_structures import arch_wall, cone_roof, house, stairs

ICE = (0.5, 0.72, 0.9)


def ice_material(name='ice-solid'):
    return flat_material(name, ICE, 0.2, 0.05)


def snow_part():
    return Part(pbr_material('snow-snow_02', 'snow_02', (1.05, 1.05, 1.08)), uv_metres=3.0, smooth=True)


def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


# ---------------------------------------------------------------- arctic

def igloo(name):
    """Dome of snow blocks in rings with an entrance tunnel (front -Y)"""
    clear_scene()
    snow = Part(flat_material('snow-block', (0.86, 0.9, 0.95), 0.75))
    dark = Part(flat_material('igloo-inside', (0.08, 0.1, 0.13), 0.9))
    r = 2.4
    rings = 7
    for j in range(rings):
        t0, t1 = j / rings, (j + 1) / rings
        a0, a1 = t0 * math.pi / 2, t1 * math.pi / 2
        z0, z1 = math.sin(a0) * r, math.sin(a1) * r
        rr = math.cos((a0 + a1) / 2) * r
        n = max(4, int(math.tau * rr / 0.75))
        for k in range(n):
            a = (k + 0.5 * (j % 2)) / n * math.tau
            box(snow, math.cos(a) * rr, math.sin(a) * rr, z0, 0.36, math.tau * rr / n * 0.96, (z1 - z0) * 0.96, a)
    box(snow, 0, 0, r - 0.1, 0.9, 0.9, 0.35)
    tube(snow, [Vector((0, -r - 0.9, 0.0)), Vector((0, -r + 0.2, 0.0))], [0.95, 0.95], 10)
    box(dark, 0, -r - 0.92, 0, 1.0, 0.05, 0.9)
    export(name, [snow.to_object(name), dark.to_object(name + '-door')])


def station(name):
    """Polar research hut: an orange insulated module on stilts, stairs, windows, a mast"""
    clear_scene()
    shell = Part(flat_material('station-orange', (0.85, 0.32, 0.08), 0.5, 0.1))
    steel = Part(flat_material('galvanised', (0.45, 0.46, 0.45), 0.4, 0.8), smooth=True)
    win = Part(flat_material('station-window', (0.55, 0.7, 0.85), 0.15, emission=(0.45, 0.6, 0.75), strength=0.35))
    w, d, z = 10.0, 4.0, 1.8
    for x in (-w / 2 + 0.5, 0, w / 2 - 0.5):
        for y in (-d / 2 + 0.3, d / 2 - 0.3):
            tube(steel, [Vector((x, y, -0.8)), Vector((x, y, z))], [0.12, 0.12], 6)
    box(shell, 0, 0, z, w, d, 3.0)
    box(steel, 0, 0, z + 3.0, w + 0.2, d + 0.2, 0.2)
    for k in range(4):
        box(win, -w / 2 + 1.5 + k * 2.2, -d / 2 - 0.03, z + 1.2, 1.0, 0.08, 0.9)
    box(win, w / 2 + 0.03, 0, z + 1.2, 0.08, 1.0, 0.9)
    stairs(steel, -w / 2 - 2.6, -w / 2, -d / 2 + 0.6, 1.0, z, 8)
    oriented_box(steel, Vector((w / 2 - 1, d / 2 - 0.5, z + 3.2)), Vector((w / 2 - 1, d / 2 - 0.5, z + 9.0)), 0.08)
    box(steel, w / 2 - 1, d / 2 - 0.5, z + 8.0, 0.8, 0.08, 0.5)
    export(name, [shell.to_object(name), steel.to_object(name + '-steel'), win.to_object(name + '-windows')])


def wind_turbine(name, height=16.0):
    """Small three-bladed turbine on a tapered tower, rotor facing -Y"""
    clear_scene()
    white = Part(flat_material('turbine-white', (0.85, 0.86, 0.87), 0.4, 0.2), smooth=True)
    tube(white, [Vector((0, 0, -0.5)), Vector((0, 0, height))], [0.45, 0.22], 12, cap=True)
    tube(white, [Vector((0, 0.8, height + 0.3)), Vector((0, -0.6, height + 0.3)), Vector((0, -1.0, height + 0.3))], [0.35, 0.4, 0.05], 10, cap=True)
    hub = Vector((0, -0.9, height + 0.3))
    for k in range(3):
        a = k / 3 * math.tau + 0.3
        tip = hub + Vector((math.cos(a), 0, math.sin(a))) * 6.0
        side = Vector((-math.sin(a), 0, math.cos(a)))
        white.quad([hub + side * 0.25, hub - side * 0.1, tip - side * 0.05, tip + side * 0.08], [(0, 0), (1, 0), (1, 1), (0, 1)])
        white.quad([tip + side * 0.08, tip - side * 0.05, hub - side * 0.1, hub + side * 0.25], [(0, 1), (1, 1), (1, 0), (0, 0)])
    export(name, [white.to_object(name)])


def ice_shapes(name, seed, kind):
    """Ice floe (flat slab), pack ice (jagged blocks) or iceberg (a towering jagged lump)"""
    clear_scene()
    rnd = random.Random(seed)
    ice = Part(ice_material(), uv_metres=3.0)
    snow = Part(flat_material('snow-cap', (0.88, 0.92, 0.96), 0.8), uv_metres=3.0)
    if kind == 'floe':
        lump(ice, Vector((0, 0, -0.3)), Vector((4.0, 3.0, 0.5)), seed, roughness=0.25, flat_top=0.55, subdiv=3)
        lump(snow, Vector((0.3, 0.2, -0.15)), Vector((3.2, 2.3, 0.45)), seed + 1, roughness=0.2, flat_top=0.6, subdiv=3)
    elif kind == 'pack':
        for k in range(9):
            a = rnd.uniform(0, math.tau)
            r = rnd.uniform(0, 3.0)
            box(ice, math.cos(a) * r, math.sin(a) * r, -0.5, rnd.uniform(0.8, 2.0), rnd.uniform(0.5, 1.4), rnd.uniform(0.8, 2.2),
                rnd.uniform(0, 3))
    else:
        lump(ice, Vector((0, 0, -2.0)), Vector((9.0, 7.0, 9.0)), seed, roughness=0.45, subdiv=4)
        export(name, [smooth(ice.to_object(name))])
        return
    export(name, [smooth(ice.to_object(name)), smooth(snow.to_object(name + '-snow'))])


def icicles(name, seed, width=4.0):
    """Ice ledge with icicles hanging below it: lay it along a cliff edge or a roof"""
    clear_scene()
    rnd = random.Random(seed)
    ice = Part(ice_material(), smooth=True)
    box(ice, 0, 0, 2.6, width, 0.8, 0.35)
    for k in range(int(width / 0.25)):
        x = -width / 2 + 0.1 + k * 0.25 + rnd.uniform(-0.05, 0.05)
        h = rnd.uniform(0.4, 2.2)
        tube(ice, [Vector((x, -0.25, 2.62)), Vector((x, -0.25, 2.62 - h))], [rnd.uniform(0.06, 0.12), 0.0], 6)
    export(name, [ice.to_object(name)])


def snow_drift(name, seed, length=8.0):
    clear_scene()
    snow = snow_part()
    lump(snow, Vector((0, 0, -1.0)), Vector((length / 2, length / 5, 1.4)), seed, roughness=0.15, subdiv=4)
    lump(snow, Vector((length / 4, 0.6, -0.9)), Vector((length / 4, length / 6, 1.0)), seed + 1, roughness=0.15, subdiv=3)
    export(name, [smooth(snow.to_object(name))])


# ---------------------------------------------------------------- hell

def thorns(name, seed, radius=1.6, height=1.8):
    """Thicket of black thorny canes arching out of the ground"""
    clear_scene()
    rnd = random.Random(seed)
    cane = Part(flat_material('thorn-black', (0.05, 0.035, 0.03), 0.6), smooth=True)
    for k in range(24):
        a = rnd.uniform(0, math.tau)
        out = Vector((math.cos(a), math.sin(a), 0))
        reach = radius * rnd.uniform(0.6, 1.2)
        h = height * rnd.uniform(0.6, 1.0)
        pts = [Vector((0, 0, -0.1)) + out * 0.1, out * reach * 0.3 + Vector((0, 0, h * 0.7)), out * reach * 0.7 + Vector((0, 0, h)),
               out * reach + Vector((0, 0, h * 0.6))]
        tube(cane, pts, [0.08, 0.06, 0.035, 0.005], 6)
        for t in (0.2, 0.3, 0.45, 0.55, 0.65, 0.75, 0.85, 0.92):
            i = int(t * 3)
            p = pts[i].lerp(pts[i + 1], t * 3 - i)
            d = (out * rnd.uniform(-0.5, 0.5) + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.2, 0.8)))).normalized()
            tube(cane, [p, p + d * 0.22], [0.02, 0.0], 4)
    export(name, [cane.to_object(name)])


def chains(name, length=5.0, sag=1.2):
    """Two iron posts with heavy chains sagging between them"""
    clear_scene()
    iron = Part(flat_material('iron-dark', (0.1, 0.09, 0.09), 0.45, 0.85))
    for x in (-length / 2, length / 2):
        box(iron, x, 0, -0.5, 0.25, 0.25, 3.2)
        tube(iron, [Vector((x, 0, 2.7)), Vector((x, 0, 3.0))], [0.25, 0.0], 4)
    for strand, (z0, s) in enumerate(((2.4, sag), (1.6, sag * 0.7))):
        links = int(length / 0.22)
        pts = [Vector((-length / 2 + length * k / links, 0, z0 - s * (1 - (2 * k / links - 1) ** 2))) for k in range(links + 1)]
        for k, (a, b) in enumerate(zip(pts, pts[1:])):
            d = (b - a).normalized()
            side = Vector((0, 1, 0)) if k % 2 else d.cross(Vector((0, 1, 0))).normalized()
            for off in (-0.04, 0.04):
                oriented_box(iron, a + side * off, b + side * off, 0.025)
    export(name, [iron.to_object(name)])


def hell_rock():
    return Part(pbr_material('rock-dark_rock_02-hell', 'dark_rock_02', (0.62, 0.45, 0.42)), uv_metres=2.5, smooth=True)


def bone_part():
    return Part(pbr_material('bone-beige_wall_001', 'beige_wall_001', (1.0, 0.93, 0.78)), uv_metres=0.6, smooth=True)


def ember(strength=1.3):
    return flat_material('hell-glow', (1.0, 0.32, 0.05), 0.4, emission=(1.0, 0.28, 0.04), strength=strength)


def skull(part, sockets, centre, size, facing, glow=None, jaw=True):
    """A skull: rounded cranium, cheek block and jaw, dark (or glowing) eye sockets and nose, looking along `facing`"""
    f = facing.normalized()
    side = Vector((0, 0, 1)).cross(f).normalized()
    up = f.cross(side).normalized()
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=2, radius=1.0)
    for v in tmp.verts:
        p = v.co
        # Back of the head longer, face flatter, brow ridge
        x, y, z = p.x * 0.85, p.y * (1.15 if p.y < 0 else 0.85), p.z * 0.95
        v.co = (side * x + f * y + up * z) * size + centre
    part.add_bmesh(tmp)
    tmp.free()
    face = centre + f * size * 0.62 - up * size * 0.35
    oriented_box(part, face - up * size * 0.2, face + up * size * 0.25, size * 0.9)
    if jaw:
        oriented_box(part, face - up * size * 0.55 + f * size * 0.05, face - up * size * 0.25 + f * size * 0.05, size * 0.7)
    eye_mat = sockets
    for s in (-1, 1):
        e = centre + f * size * 0.72 + side * s * size * 0.33 - up * size * 0.05
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=1, radius=size * 0.2)
        bmesh.ops.translate(tmp, vec=e, verts=tmp.verts)
        (glow or eye_mat).add_bmesh(tmp)
        tmp.free()
    oriented_box(eye_mat, face + f * size * 0.42 - up * size * 0.05, face + f * size * 0.42 + up * size * 0.12, size * 0.14)


def twisted_pillar(rock, veins, base, height, radius, seed, turns=0.7):
    """Rough rock pillar of stacked lumps turning around its axis, with glowing veins winding up it"""
    rnd = random.Random(seed)
    n = int(height / (radius * 0.9)) + 1
    for k in range(n):
        t = k / max(1, n - 1)
        a = t * turns * math.tau
        off = Vector((math.cos(a), math.sin(a), 0)) * radius * 0.2
        r = radius * (1.15 - 0.3 * t) * rnd.uniform(0.9, 1.1)
        lump(rock, base + off + Vector((0, 0, height * t - radius * 0.3)), Vector((r, r * 0.9, radius * 0.75)), seed + k, roughness=0.3,
             flat_bottom=False, subdiv=2)
    for v in range(3):
        pts = []
        for k in range(14):
            t = k / 13
            a = t * (turns + 0.5) * math.tau + v * math.tau / 3
            r = radius * (1.02 - 0.3 * t)
            pts.append(base + Vector((math.cos(a) * r, math.sin(a) * r, height * t * 0.92)))
        tube(veins, pts, [0.07] * len(pts), 4)


def horn(part, base, direction, length, radius, curl=0.6):
    """Tapered horn curving upwards"""
    d = direction.normalized()
    pts = []
    for k in range(7):
        t = k / 6
        pts.append(base + d * length * t + Vector((0, 0, length * curl * t * t)))
    tube(part, pts, [radius * (1 - t) + 0.01 for t in [k / 6 for k in range(7)]], 7)


def hell_gate(name):
    """Gate as a sculpture: two twisted rock pillars with horns and glowing veins, a thick arch with a great
    skull as keystone and skulls set into the pillars, spikes along the arch, a stepped base and a glowing
    rift inside with a hotter core"""
    clear_scene()
    rnd = random.Random(7)
    rock = hell_rock()
    veins = Part(ember(1.0), smooth=True)
    bones = bone_part()
    sockets = Part(flat_material('socket', (0.02, 0.01, 0.01), 0.9))
    eyes = Part(ember(1.6))
    rift = Part(ember(1.4))
    core = Part(flat_material('rift-core', (1.0, 0.75, 0.3), 0.4, emission=(1.0, 0.7, 0.25), strength=1.8))
    span, h = 9.0, 11.0
    for k, (w, d, z) in enumerate(((16.0, 7.0, -0.8), (13.0, 5.5, -0.3), (10.5, 4.2, 0.2))):
        lump(rock, Vector((0, 0, z - 0.4)), Vector((w / 2, d / 2, 0.55)), 30 + k, roughness=0.15, flat_top=0.55, subdiv=3)
    for s in (-1, 1):
        base = Vector((s * span / 2, 0, 0.6))
        twisted_pillar(rock, veins, base, h, 1.6, 40 + s, turns=0.6 * s)
        horn(rock, base + Vector((s * 1.0, 0, h - 0.5)), Vector((s * 1.0, -0.2, 0.2)), 4.5, 0.55)
        for k in range(3):
            skull(bones, sockets, base + Vector((0, -1.55, 2.2 + k * 2.6)), 0.42, Vector((0, -1, 0)), glow=eyes)
    # Arch of lumps from pillar top to pillar top
    n = 11
    for k in range(n):
        t = k / (n - 1)
        a = math.pi * t
        p = Vector((-math.cos(a) * span / 2, 0, h + math.sin(a) * 3.2))
        lump(rock, p - Vector((0, 0, 0.8)), Vector((1.4, 1.5, 1.2)), 60 + k, roughness=0.3, flat_bottom=False, subdiv=2)
        if 0 < k < n - 1:
            out = Vector((-math.cos(a) * 0.6, 0, math.sin(a))).normalized()
            tube(rock, [p + out * 1.0, p + out * (2.6 + rnd.uniform(0, 1.2))], [0.32, 0.0], 6)
    skull(bones, sockets, Vector((0, -1.3, h + 3.0)), 1.2, Vector((0, -1, -0.15)), glow=eyes)
    # The rift: a jagged outline filling the opening, a smaller hotter core in front
    for part, scale, y in ((rift, 1.0, 0.0), (core, 0.55, -0.15)):
        ring = []
        for k in range(40):
            a = k / 40 * math.tau
            r = 1.0 + 0.12 * noise.noise(Vector((math.cos(a) * 3, math.sin(a) * 3, 0.5)))
            ring.append(Vector((math.cos(a) * (span / 2 - 1.3) * r * scale, y, (h * 0.55) + math.sin(a) * (h * 0.58) * r * scale)))
        c = Vector((0, y, h * 0.55))
        for flip in (False, True):
            verts = [part.bm.verts.new(p) for p in ring]
            centre = part.bm.verts.new(c)
            for k in range(40):
                tri = (centre, verts[k], verts[(k + 1) % 40])
                part.bm.faces.new(tri if not flip else tuple(reversed(tri)))
    objects = [smooth(rock.to_object(name)), veins.to_object(name + '-veins'), smooth(bones.to_object(name + '-skulls')),
               sockets.to_object(name + '-sockets'), eyes.to_object(name + '-eyes'), rift.to_object(name + '-rift'),
               core.to_object(name + '-core')]
    export(name, objects)


def altar(name):
    """Sacrificial altar: stepped base, a carved slab with a bevelled rim and a skull, horns at the corners,
    candles in drips of wax, a glowing rune channel round the slab"""
    clear_scene()
    rock = Part(pbr_material('rock-dark_rock_02-hell', 'dark_rock_02', (0.62, 0.45, 0.42)), uv_metres=2.0, bevel=0.06)
    rough = hell_rock()
    glow = Part(ember(1.2))
    bones = bone_part()
    sockets = Part(flat_material('socket', (0.02, 0.01, 0.01), 0.9))
    wax = Part(pbr_material('wax-beige_wall_001', 'beige_wall_001', (1.0, 0.95, 0.85)), smooth=True)
    fire = Part(glow_card_material('flame', 'flame.png'))
    for k, (w, h) in enumerate(((6.4, 0.45), (5.0, 0.45), (3.8, 0.4))):
        box(rock, 0, 0, -0.35 + k * 0.45, w, w * 0.72, h + 0.35)
    box(rock, 0, 0, 1.25, 2.8, 1.4, 0.75)
    box(rock, 0, 0, 2.0, 3.1, 1.7, 0.18)
    for s in (-1, 1):
        box(glow, 0, s * 0.86, 2.02, 2.7, 0.04, 0.06)
        box(glow, s * 1.56, 0, 2.02, 0.04, 1.4, 0.06)
    skull(bones, sockets, Vector((0, 0.1, 2.5)), 0.32, Vector((0, -1, 0.1)), glow=glow)
    for sx in (-1, 1):
        for sy in (-1, 1):
            horn(rough, Vector((sx * 2.3, sy * 1.6, 0.95)), Vector((sx, sy, 0.6)), 1.6, 0.22, curl=0.9)
            p = Vector((sx * 1.3, sy * 0.6, 2.18))
            tube(wax, [p - Vector((0, 0, 0.02)), p + Vector((0, 0, 0.35))], [0.07, 0.065], 7, cap=True)
            tube(wax, [p - Vector((0, 0, 0.0)), p + Vector((0, 0, 0.04))], [0.12, 0.08], 7, cap=True)
            up = lambda co: Vector((0, 0, 1))
            b = p + Vector((0, 0, 0.35))
            for a in (0.0, 1.57):
                side = Vector((math.cos(a), math.sin(a), 0)) * 0.06
                fire.quad([b - side, b + side, b + side + Vector((0, 0, 0.2)), b - side + Vector((0, 0, 0.2))],
                          [(0, 0), (1, 0), (1, 1), (0, 1)], up)
    export(name, [rock.to_object(name), smooth(rough.to_object(name + '-horns')), glow.to_object(name + '-runes'),
                  smooth(bones.to_object(name + '-skull')),
                  sockets.to_object(name + '-sockets'), wax.to_object(name + '-candles'), fire.to_object(name + '-flames')])


def bone_pile(name, seed, size=2.4):
    """Heap of skulls, long bones with knobbed ends and ribs"""
    clear_scene()
    rnd = random.Random(seed)
    bones = bone_part()
    sockets = Part(flat_material('socket', (0.02, 0.01, 0.01), 0.9))
    lump(bones, Vector((0, 0, -0.3)), Vector((size * 0.5, size * 0.42, size * 0.18)), seed, roughness=0.3, subdiv=2)
    for k in range(14):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0, size * 0.45)
        z = (1 - r / (size * 0.5)) * size * 0.25
        p = Vector((math.cos(a) * r, math.sin(a) * r, z))
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.3, 0.3))).normalized()
        l = rnd.uniform(0.5, 0.9)
        tube(bones, [p - d * l / 2, p + d * l / 2], [0.045, 0.04], 6)
        for e in (-1, 1):
            q = p + d * e * l / 2
            tmp = bmesh.new()
            bmesh.ops.create_icosphere(tmp, subdivisions=1, radius=0.075)
            bmesh.ops.translate(tmp, vec=q, verts=tmp.verts)
            bones.add_bmesh(tmp)
            tmp.free()
    for k in range(5):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0, size * 0.35)
        p = Vector((math.cos(a) * r, math.sin(a) * r, size * 0.22 * (1 - r / (size * 0.5)) + 0.12))
        skull(bones, sockets, p, rnd.uniform(0.14, 0.2), Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.2, 0.4))))
    export(name, [smooth(bones.to_object(name)), sockets.to_object(name + '-sockets')])


def lava_rock(name, seed, size=(1.6, 1.3, 1.1)):
    """Dark crusted rock broken open along noisy cracks, glowing from inside"""
    clear_scene()
    crust = Part(pbr_material('rock-dark_rock_02-crust', 'dark_rock_02', (0.6, 0.55, 0.55)), uv_metres=2.0)
    core = Part(flat_material('lava-core', (1.0, 0.35, 0.05), 0.4, emission=(1.0, 0.3, 0.03), strength=1.3))
    s = Vector(size)
    lump(core, Vector((0, 0, -0.3)), s * 0.9, seed, roughness=0.3, subdiv=3)
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=4, radius=1.0)
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    for v in tmp.verts:
        n = v.co.normalized()
        d = 1.0 + 0.3 * noise.noise(n * 1.6 + off) + 0.12 * noise.noise(n * 4.0 + off)
        v.co = Vector((n.x * s.x, n.y * s.y, n.z * s.z)) * d
        if v.co.z < -s.z * 0.3:
            v.co.z = -s.z * 0.3
    # Cracks: drop the faces where a ridged noise is high, so the core shows through
    gone = [f for f in tmp.faces if abs(noise.noise(f.calc_center_median() * 1.8 + off)) < 0.07 and f.calc_center_median().z > -s.z * 0.1]
    bmesh.ops.delete(tmp, geom=gone, context='FACES')
    bmesh.ops.translate(tmp, vec=Vector((0, 0, s.z * 0.3 - 0.3)), verts=tmp.verts)
    crust.add_bmesh(tmp)
    tmp.free()
    export(name, [smooth(crust.to_object(name)), smooth(core.to_object(name + '-core'))])


# ---------------------------------------------------------------- mountains

def rope_bridge(name, length=20.0, width=1.4, sag=1.8):
    """Plank footbridge hanging on ropes between two post pairs, along X, deck ends at z = 0"""
    clear_scene()
    planks = Part(pbr_material('planks-weathered', 'weathered_planks'), uv_metres=1.5)
    rope = Part(flat_material('rope', (0.45, 0.36, 0.24), 0.9), smooth=True)
    posts = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02'), smooth=True)
    n = int(length / 0.35)
    def z(x):
        return -sag * (1 - (2 * x / length) ** 2)
    for k in range(n):
        x = -length / 2 + (k + 0.5) * length / n
        box(planks, x, 0, z(x) - 0.06, length / n - 0.06, width, 0.06)
    for side in (-1, 1):
        y = side * width / 2
        for h in (0.0, 1.0):
            pts = [Vector((-length / 2 + length * k / 24, y, z(-length / 2 + length * k / 24) + h * (1 - 0.2 * (1 - (2 * k / 24 - 1) ** 2))))
                   for k in range(25)]
            for a, b in zip(pts, pts[1:]):
                oriented_box(rope, a, b, 0.04)
        for k in range(0, n, 3):
            x = -length / 2 + (k + 0.5) * length / n
            oriented_box(rope, Vector((x, y, z(x))), Vector((x, y, z(x) + 1.0 * (1 - 0.2 * (1 - (2 * x / length) ** 2)))), 0.02)
        for x in (-length / 2 - 0.3, length / 2 + 0.3):
            tube(posts, [Vector((x, y * 1.2, -1.5)), Vector((x, y * 1.2, 1.4))], [0.12, 0.1], 7, cap=True)
    export(name, [planks.to_object(name), rope.to_object(name + '-ropes'), posts.to_object(name + '-posts')])


def cairn(name, seed):
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('rock-rock_face', 'rock_face', (0.8, 0.8, 0.8)), uv_metres=1.0)
    z = 0.0
    r = 0.6
    for k in range(7):
        h = rnd.uniform(0.18, 0.3)
        lump(stone, Vector((rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), z - 0.12)), Vector((r, r * 0.85, h)), seed + k, roughness=0.25, subdiv=2)
        z += h * 1.1
        r *= 0.82
    export(name, [smooth(stone.to_object(name))])


# ---------------------------------------------------------------- swamp, desert

def mossy_swamp_tree(name, seed):
    """Dead swamp tree hung with curtains of grey moss"""
    def moss(wood, pts):
        part = Part(card_material('moss-strands', 'moss-strands.png'))
        rnd = random.Random(seed)
        for k in range(16):
            p = Vector((rnd.uniform(-2.2, 2.2), rnd.uniform(-2.2, 2.2), rnd.uniform(4.5, 7.8)))
            card(part, p, Vector((0, 0, -1)), Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)).normalized(), 0.9,
                 rnd.uniform(1.6, 3.0), Vector((0, 0, 5)))
        return [part]

    dead_tree(name, seed, tint=(0.5, 0.52, 0.45), extra=moss)


def oasis_pool(name, seed, radius=4.0):
    """Small pond: a ring of stones around a disc of still water just above the ground"""
    clear_scene()
    rnd = random.Random(seed)
    water = Part(flat_material('pond-water', (0.08, 0.2, 0.22), 0.05, 0.2))
    rim = Part(pbr_material('rock-sandstone_cracks', 'sandstone_cracks'), uv_metres=1.5)
    bm = water.bm
    n = 24
    c = bm.verts.new((0, 0, 0.06))
    ring = [bm.verts.new((math.cos(k / n * math.tau) * radius * rnd.uniform(0.92, 1.0), math.sin(k / n * math.tau) * radius * rnd.uniform(0.92, 1.0), 0.06))
            for k in range(n)]
    for k in range(n):
        bm.faces.new((c, ring[k], ring[(k + 1) % n]))
    for k in range(16):
        a = k / 16 * math.tau + rnd.uniform(-0.1, 0.1)
        lump(rim, Vector((math.cos(a) * radius * 1.05, math.sin(a) * radius * 1.05, -0.35)),
             Vector((rnd.uniform(0.6, 1.0), rnd.uniform(0.5, 0.8), rnd.uniform(0.3, 0.45))), seed + k, subdiv=2)
    export(name, [water.to_object(name + '-water'), smooth(rim.to_object(name))])


def desert_temple(name):
    """Sandstone temple front: stepped base, six columns, a heavy lintel and a dark doorway"""
    clear_scene()
    stone = Part(pbr_material('wall-sandstone_blocks_04', 'sandstone_blocks_04'), uv_metres=3.0)
    col = Part(pbr_material('rock-sandstone_cracks', 'sandstone_cracks'), smooth=True)
    dark = Part(flat_material('temple-dark', (0.04, 0.035, 0.03), 0.9))
    w, d = 18.0, 14.0
    for k in range(3):
        box(stone, 0, 0, -0.8 + k * 0.5, w - k * 1.2, d - k * 1.2, 0.8)
    box(stone, 0, 2.0, 0.7, w - 4.0, d - 6.0, 8.0)
    box(dark, 0, -2.02 + 2.0 - (d - 6.0) / 2, 0.7, 3.0, 0.1, 4.5)
    for k in range(6):
        x = -w / 2 + 2.5 + k * (w - 5.0) / 5
        tube(col, [Vector((x, -d / 2 + 2.2, 0.7)), Vector((x, -d / 2 + 2.2, 8.0))], [0.65, 0.55], 14)
        box(stone, x, -d / 2 + 2.2, 0.7, 1.6, 1.6, 0.4)
    box(stone, 0, -d / 2 + 2.2 + (d - 4.4) / 2 - 1.0, 8.0, w - 3.0, d - 4.4 + 2.0, 1.4)
    stairs(stone, -2, 2, -d / 2 - 0.5, 1.0, 0.7, 4)
    export(name, [stone.to_object(name), col.to_object(name + '-columns'), dark.to_object(name + '-door')])


def nomad_tent(name):
    """Low wide tent: a dark woven roof on poles, open front, rugs inside"""
    clear_scene()
    cloth = Part(two_sided(pbr_material('cloth-hessian-dark', 'hessian_230', (0.45, 0.35, 0.28))))
    poles = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    rug = Part(flat_material('rug-red', (0.5, 0.12, 0.08), 0.9))
    w, d, h = 8.0, 5.0, 2.2
    for x in (-w / 2, 0, w / 2):
        for y, hh in ((-d / 2, h), (0, h + 0.4), (d / 2, h - 0.6)):
            tube(poles, [Vector((x, y, -0.3)), Vector((x, y, hh))], [0.05, 0.05], 5)
    pts = [(-d / 2, h), (0, h + 0.4), (d / 2, h - 0.6)]
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        quad = [Vector((-w / 2 - 0.2, y0, z0)), Vector((w / 2 + 0.2, y0, z0)), Vector((w / 2 + 0.2, y1, z1)), Vector((-w / 2 - 0.2, y1, z1))]
        cloth.quad(quad, [(0, 0), (3, 0), (3, 1), (0, 1)])
    back = [Vector((-w / 2, d / 2, 0)), Vector((w / 2, d / 2, 0)), Vector((w / 2, d / 2, h - 0.6)), Vector((-w / 2, d / 2, h - 0.6))]
    cloth.quad(back, [(0, 0), (3, 0), (3, 1), (0, 1)])
    box(rug, 0, 0.3, 0.0, w * 0.7, d * 0.6, 0.03)
    export(name, [cloth.to_object(name), poles.to_object(name + '-poles'), rug.to_object(name + '-rug')])


def cage(name, height=2.6, radius=0.9):
    """Hanging gibbet cage: iron bands and bars, a ring and a chain up to a gallows post"""
    clear_scene()
    metal = Part(flat_material('iron-dark', (0.1, 0.09, 0.09), 0.45, 0.85), smooth=True)
    wood = Part(pbr_material('planks-dark', 'dark_planks', (0.7, 0.6, 0.5)), uv_metres=1.0)
    z0 = 1.2
    for z in (z0, z0 + height * 0.5, z0 + height):
        pts = [Vector((math.cos(k / 16 * math.tau) * radius, math.sin(k / 16 * math.tau) * radius, z)) for k in range(17)]
        for a, b in zip(pts, pts[1:]):
            oriented_box(metal, a, b, 0.06)
    for k in range(10):
        a = k / 10 * math.tau
        p = Vector((math.cos(a) * radius, math.sin(a) * radius, 0))
        oriented_box(metal, p + Vector((0, 0, z0)), p * 0.3 + Vector((0, 0, z0 + height + 0.5)), 0.05)
    oriented_box(metal, Vector((0, 0, z0 + height + 0.5)), Vector((0, 0, 6.0)), 0.04)
    box(wood, 2.2, 0, -0.5, 0.3, 0.3, 7.0)
    oriented_box(wood, Vector((2.2, 0, 6.2)), Vector((-0.3, 0, 6.2)), 0.25)
    oriented_box(wood, Vector((2.2, 0, 4.8)), Vector((1.0, 0, 6.2)), 0.15)
    export(name, [metal.to_object(name), wood.to_object(name + '-gallows')])


def models():
    return {
        # Arctic
        'igloo': lambda: igloo('igloo'),
        'research-station': lambda: station('research-station'),
        'wind-turbine': lambda: wind_turbine('wind-turbine'),
        'ice-floe': lambda: ice_shapes('ice-floe', 80, 'floe'),
        'ice-blocks': lambda: ice_shapes('ice-blocks', 81, 'pack'),
        'iceberg': lambda: ice_shapes('iceberg', 82, 'berg'),
        'icicles': lambda: icicles('icicles', 83),
        'snow-drift-mound': lambda: snow_drift('snow-drift-mound', 84),
        'ice-spikes': lambda: crystals('ice-spikes', 85, ICE, None, count=9, height=3.5),
        'tree-frozen': lambda: dead_tree('tree-frozen', 86, tint=(2.3, 2.6, 3.0), bark='bark_platanus'),
        # Hell
        'tree-charred': lambda: dead_tree('tree-charred', 87, tint=(0.12, 0.1, 0.1)),
        'thorns': lambda: thorns('thorns', 88),
        'chains': lambda: chains('chains'),
        'cage': lambda: cage('cage'),
        'hell-gate': lambda: hell_gate('hell-gate'),
        'altar': lambda: altar('altar'),
        'lava-rock': lambda: lava_rock('lava-rock', 89),
        'bone-pile': lambda: bone_pile('bone-pile', 97),
        'lava-rock-large': lambda: lava_rock('lava-rock-large', 90, size=(3.2, 2.6, 2.2)),
        'obsidian-spikes': lambda: crystals('obsidian-spikes', 91, (0.03, 0.025, 0.035), None, count=8, height=3.2),
        'hell-spires': lambda: stalagmites('hell-spires', 92, asset='dark_rock_02', count=5, height=9.0),
        # Mountains
        'rope-bridge': lambda: rope_bridge('rope-bridge'),
        'alpine-hut': lambda: house('alpine-hut', 8.0, 6.0, 4.0, 'roof_planks', 'stacked_stone_wall', frame=False),
        'alpine-hut-snow': lambda: house('alpine-hut-snow', 8.0, 6.0, 4.0, 'roof_planks', 'stacked_stone_wall', frame=False, snow=True),
        'rock-needle': lambda: hoodoo('rock-needle', 93, height=22.0, asset='rock_face'),
        'cairn': lambda: cairn('cairn', 94),
        # Swamp and desert
        'tree-swamp-moss': lambda: mossy_swamp_tree('tree-swamp-moss', 95),
        'oasis-pool': lambda: oasis_pool('oasis-pool', 96),
        'desert-temple': lambda: desert_temple('desert-temple'),
        'tent-nomad': lambda: nomad_tent('tent-nomad'),
    }
