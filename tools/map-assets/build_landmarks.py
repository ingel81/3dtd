"""Landmarks of the map asset catalogue (loaded by build_models.py).

Tunnel portals for roads through a hill (an old stone one, a modern
concrete one with lamps; the road runs in along +Y), a castle ruin on its
own as a landmark, a glacier tongue and a serac field, avalanche barriers
(steel snow bridges, bare and snowed in), a shipwreck stranded on its
side, a rocket with its launch tower, an obsidian tower, a floodlight
mast and a beacon post, a bell tower (also snowed), a stone circle, a
trebuchet and a collapsed highway. Built from Poly Haven textures and the
shared builders; every piece gets baked AO, the larger ones a
flat-coloured copy for distance.
"""
import math
import random

from mathutils import Matrix, Vector, noise

from blender_kit import (
    Part, box, card, card_material, clear_scene, export_lod, finish, flat_material, hexa, oriented_box, pbr_material, tilt,
    tube, two_sided,
)
from build_nature import lump
from build_structures import RUIN, arch_wall, merlons

ROCK = 'rock_boulder_dry'
GREY = (0.75, 0.75, 0.75)


def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def export(name, objects, lod=None, ao_size=512):
    """Baked AO, then a flat-coloured copy with `lod` triangles for distance"""
    obj = finish(name, objects, ao_size=ao_size)
    if lod:
        export_lod(name, obj, ratio=min(1.0, lod / max(1, len(obj.data.polygons))))
    return obj


def vault(part, y0, y1, half, spring, steps=12, flat=1.0):
    """Barrel vault along Y over an opening `2 * half` wide: inner faces only (seen from the road), straight
    sides up to `spring`, a segmental arch above (`flat` < 1 lowers its rise)"""
    pts = [Vector((-half, 0, 0)), Vector((-half, 0, spring))]
    for k in range(1, steps):
        a = math.pi - k / steps * math.pi
        pts.append(Vector((math.cos(a) * half, 0, spring + math.sin(a) * half * flat)))
    pts += [Vector((half, 0, spring)), Vector((half, 0, 0))]
    run = 0.0
    for a, b in zip(pts, pts[1:]):
        step = (b - a).length
        part.quad([a + Vector((0, y0, 0)), a + Vector((0, y1, 0)), b + Vector((0, y1, 0)), b + Vector((0, y0, 0))],
                  [(run, y0), (run, y1), (run + step, y1), (run + step, y0)])
        run += step
    return pts


def arch_ring(part, half, spring, depth, y, width=0.9, stones=15, flat=1.0, key=0.0):
    """Voussoirs around an arch opening: one block per stone, the keystone `key` metres taller"""
    for k in range(stones):
        a0 = math.pi - k / stones * math.pi
        a1 = math.pi - (k + 1) / stones * math.pi
        grow = key if k == stones // 2 else 0.0
        inner = [Vector((math.cos(a) * half, y, spring + math.sin(a) * half * flat)) for a in (a0, a1)]
        outer = [Vector((math.cos(a) * (half + width + grow), y, spring + math.sin(a) * (half * flat + width + grow))) for a in (a0, a1)]
        front = [inner[0], inner[1], outer[1], outer[0]]
        back = [v + Vector((0, depth, 0)) for v in front]
        bm = part.bm
        f = [bm.verts.new(v) for v in front]
        b = [bm.verts.new(v) for v in back]
        bm.faces.new(f)
        bm.faces.new(list(reversed(b)))
        for i in range(4):
            bm.faces.new((f[(i + 1) % 4], f[i], b[i], b[(i + 1) % 4]))


def hillside(part, width, height, depth, seed, rnd):
    """Rock lumps behind and above a portal façade: the hill it is cut into (reaches below the ground)"""
    pieces = [
        (Vector((-width * 0.55, depth * 0.45, -1.0)), Vector((width * 0.3, depth * 0.45, height * 0.75))),
        (Vector((width * 0.55, depth * 0.45, -1.0)), Vector((width * 0.3, depth * 0.45, height * 0.7))),
        (Vector((0, depth * 0.6, height * 0.55)), Vector((width * 0.42, depth * 0.5, height * 0.5))),
        (Vector((-width * 0.3, depth * 0.8, height * 0.35)), Vector((width * 0.3, depth * 0.4, height * 0.55))),
        (Vector((width * 0.3, depth * 0.85, height * 0.3)), Vector((width * 0.3, depth * 0.4, height * 0.6))),
    ]
    for k, (c, s) in enumerate(pieces):
        lump(part, c + Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.3, 0.3), 0)), s, seed + k, roughness=0.3, subdiv=3)


# ---------------------------------------------------------------- tunnel portals

def tunnel_portal(name, concrete=False, seed=1):
    """Road tunnel mouth cut into a hill, front -Y, the road runs in along +Y from the origin: a façade with
    an arched opening 8 m wide, wing walls stepping down at both sides, a vault 14 m deep fading into a dark
    back. Stone: a masonry façade with voussoirs, a keystone and a cornice, rock of the hill around and above.
    Concrete (the portal of OSM road tunnels): a plain headwall with a flat arch framed by a band, pilasters
    at its ends, a coping and a parapet on top, lamps along the vault and a shell round it, no rock: the
    world's ground is the hill (src/app/world/osm/convert/tunnels.ts raises it to the headwall's top),
    and from the game camera lumps of rock read as boulders, not as a portal"""
    clear_scene()
    rnd = random.Random(seed)
    if concrete:
        wall = Part(pbr_material('wall-concrete_slab_wall', 'concrete_slab_wall'), uv_metres=4.0)
        trim = Part(pbr_material('wall-brushed_concrete', 'brushed_concrete'), uv_metres=3.0)
    else:
        wall = Part(pbr_material('wall-stacked_stone_wall', 'stacked_stone_wall'), uv_metres=2.5)
        trim = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=2.0)
    inner = Part(pbr_material('tunnel-inner' + ('-concrete' if concrete else ''), 'brushed_concrete' if concrete else 'stacked_stone_wall',
                              (0.32, 0.31, 0.3)), uv_metres=2.5, bevel=0.0)
    dark = Part(flat_material('tunnel-dark', (0.01, 0.01, 0.012), 0.95), bevel=0.0)
    rock = Part(pbr_material('rock-' + ROCK, ROCK, GREY), uv_metres=6.0, bevel=0.0)
    half, spring, flat = 4.0, (4.2 if concrete else 3.4), (0.55 if concrete else 1.0)
    crown = spring + half * flat
    front_w, top, thick = 20.0, crown + 3.2, 1.6
    deep = 14.0
    # Façade with the opening, cut by vertical strips (arch_wall), from below the ground to above the crown
    if concrete:
        # A flatter arch: arch_wall's strips follow a circle, so cut the strips here for the segmental profile
        box(wall, -(front_w / 2 + half) / 2, thick / 2, -1.5, front_w / 2 - half, thick, top + 1.5)
        box(wall, (front_w / 2 + half) / 2, thick / 2, -1.5, front_w / 2 - half, thick, top + 1.5)
        steps = 16
        for k in range(steps):
            a = -half + k * 2 * half / steps
            b = a + 2 * half / steps
            m = (a + b) / 2
            bottom = spring + math.sqrt(max(0.0, half * half - m * m)) * flat
            box(wall, m, thick / 2, bottom, b - a, thick, top - bottom)
        # A band round the arch and down its jambs, standing out of the headwall
        arch_ring(trim, half, spring, thick + 0.35, -0.35, width=0.8, stones=20, flat=flat)
        for s in (-1, 1):
            box(trim, s * (half + 0.4), thick / 2 - 0.175, -0.3, 0.8, thick + 0.35, spring + 0.3)
            # Pilasters at the ends of the headwall
            box(trim, s * (front_w / 2 - 0.6), thick / 2 - 0.15, -1.5, 1.2, thick + 0.3, top + 1.5)
        # Coping over the headwall and a parapet on it, the edge one sees from above
        box(trim, 0, thick / 2 - 0.1, top - 0.35, front_w + 0.4, thick + 0.6, 0.45)
        box(wall, 0, 0.1, top + 0.1, front_w, 0.45, 1.0)
        box(trim, 0, 0.1, top + 1.1, front_w + 0.2, 0.65, 0.18)
        # A shell round the vault (under the raised ground, seen only where a map leaves it bare)
        for s in (-1, 1):
            box(wall, s * (half + 0.4), thick + deep / 2, -1.5, 0.8, deep, crown + 1.5)
        box(wall, 0, thick + deep / 2, crown, half * 2 + 1.6, deep, 0.8)
        lamps = Part(flat_material('tunnel-lamp', (1.0, 0.85, 0.55), 0.3, emission=(1.0, 0.8, 0.5), strength=2.0), bevel=0.0)
        for k in range(5):
            y = 1.5 + k * 2.8
            for s in (-1, 1):
                box(lamps, s * half * 0.62, y, spring + half * flat * 0.78, 0.5, 1.0, 0.12)
    else:
        arch_wall(wall, -front_w / 2, front_w / 2, thick / 2, thick, -1.5, top, 0.0, half * 2, spring, steps=16)
        arch_ring(trim, half, spring, thick + 0.25, -0.2, width=0.85, stones=15, key=0.35)
        for s in (-1, 1):
            box(trim, s * (half + 0.45), -0.12, -0.2, 1.3, thick + 0.25, spring + 0.05)
        # Cornice and a plain band under it
        box(trim, 0, thick / 2 - 0.25, top - 0.1, front_w + 0.6, thick + 0.7, 0.45)
        box(trim, 0, thick / 2 - 0.1, top - 0.9, front_w + 0.2, thick + 0.4, 0.3)
    # Wing walls: retaining walls angled out to the front, their coping sloping down to the ground
    for s in (-1, 1):
        start = Vector((s * (front_w / 2 - 0.4), thick / 2, 0))
        out = Vector((s * 0.55, -1.0, 0)).normalized()
        end = start + out * 9.0
        side = Vector((-out.y, out.x, 0)) * 0.6
        bottom = [start - side, end - side, end + side, start + side]
        if s < 0:
            bottom = list(reversed(bottom))
        hexa(wall, [v - Vector((0, 0, 1.5)) for v in bottom], [v + Vector((0, 0, top - 0.3 if (v - start).length < 1.0 else 1.2)) for v in bottom])
        oriented_box(trim, start + Vector((0, 0, top - 0.15)), end + Vector((0, 0, 1.35)), 0.5)
        box(trim, end.x, end.y, -0.3, 1.5, 1.5, 1.9, math.atan2(out.y, out.x))
    # The vault and its side walls, darker inside, closed by a black back
    vault(inner, thick, deep, half, spring, 14, flat)
    box(dark, 0, deep + 0.3, -1.5, half * 2 + 0.4, 0.6, crown + 2.0)
    # Road surface inside, below the opening (the terrain stops at the façade)
    floor = [Vector((-half, thick, 0.02)), Vector((half, thick, 0.02)), Vector((half, deep, 0.02)), Vector((-half, deep, 0.02))]
    inner.quad(floor, [(0, 0), (2 * half, 0), (2 * half, deep), (0, deep)])
    objects = [wall.to_object(name), trim.to_object(name + '-trim'), inner.to_object(name + '-inner'), dark.to_object(name + '-dark')]
    if concrete:
        objects.append(lamps.to_object(name + '-lamps'))
    else:
        hillside(rock, front_w + 6.0, top + 2.0, deep + 6.0, seed * 10, rnd)
        for k in range(6):
            s = -1 if k % 2 else 1
            lump(rock, Vector((s * rnd.uniform(front_w / 2 + 2.5, front_w / 2 + 6.0), rnd.uniform(-5.0, -1.0), -0.6)),
                 Vector((rnd.uniform(0.6, 1.4), rnd.uniform(0.5, 1.1), rnd.uniform(0.4, 0.9))), seed * 10 + 20 + k, subdiv=2)
        objects.append(smooth(rock.to_object(name + '-rock')))
    export(name, objects, lod=500)


# ---------------------------------------------------------------- castle ruin

def broken_run(part, a, b, thick, z0, heights):
    """Wall from a to b in vertical strips, each with its own height: a broken top"""
    d = b - a
    n = len(heights)
    ang = math.atan2(d.y, d.x)
    step = d.length / n
    for k, h in enumerate(heights):
        c = a + d * ((k + 0.5) / n)
        box(part, c.x, c.y, z0, step + 0.02, thick, h - z0, ang)


def ruin_tower(part, dark, cx, cy, radius, heights, thick=1.3):
    """Round tower stump as a ring of wall strips, open at the top, heights per strip"""
    n = len(heights)
    for k, h in enumerate(heights):
        a = (k + 0.5) / n * math.tau
        r = radius - thick / 2
        box(part, cx + math.cos(a) * r, cy + math.sin(a) * r, -1.5, thick, math.tau * radius / n + 0.08, h + 1.5, a)
        if h > 7.0 and k % 3 == 0:
            box(dark, cx + math.cos(a) * (radius + 0.02), cy + math.sin(a) * (radius + 0.02), 4.5, 0.1, 0.35, 1.2, a)


def castle_ruin(name, seed=4):
    """A whole ruined castle as one landmark (about 36 x 30 m): a broken keep at the back with empty windows,
    a round tower stump at each front corner, curtain walls between them broken down in a breach, the
    gate arch standing with its top fallen, rubble heaps and ivy. Mossy stone; it sits on a hilltop"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=3.0)
    dark = Part(flat_material('hole', (0.03, 0.03, 0.03), 0.95))
    rubble = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=1.5, bevel=0.0)
    ivy = Part(card_material('ivy-wall', 'ivy-wall.png'))
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    # Keep: 12 x 12 m, up to 21 m, one corner collapsed down to 8 m
    s, t, h = 12.0, 1.6, 21.0
    ky = 8.0
    cols = 8
    for side in range(4):
        hs = []
        for k in range(cols):
            u = (k + 0.5) / cols
            drop = max(0.0, math.sin((u + side) * math.pi / 2.0 - 0.6)) if side in (1, 2) else 0.0
            hs.append(h * (1.0 - 0.6 * drop) * rnd.uniform(0.9, 1.0))
        corners = [Vector((-s / 2, ky - s / 2, 0)), Vector((s / 2, ky - s / 2, 0)), Vector((s / 2, ky + s / 2, 0)), Vector((-s / 2, ky + s / 2, 0))]
        a, b = corners[side], corners[(side + 1) % 4]
        inward = (Vector((0, ky, 0)) - (a + b) / 2).normalized() * (t / 2)
        broken_run(stone, a + inward, b + inward, t, -1.5, hs)
        if side == 0:
            front = hs
    # Merlons left on the standing front of the keep, each on the broken top of the strip under it
    n = int((s - 3.0 + 0.8) // 1.8)
    for k in range(n):
        x = -s / 2 + (s - 3.0) / 2 - (n * 1.8 - 0.8) / 2 + 0.5 + k * 1.8
        top = front[min(cols - 1, int((x + s / 2) / s * cols))]
        box(stone, x, ky - s / 2 + t / 2, top - 0.2, 1.0, t, 1.2)
    for z in (6.0, 11.5, 16.0):
        for x in (-3.0, 0.0, 3.0):
            box(dark, x, ky - s / 2 - 0.03, z, 0.7, 0.1, 1.8)
        box(dark, -s / 2 - 0.03, ky - 2.0, z, 0.1, 0.7, 1.8)
    box(dark, 0, ky - s / 2 - 0.03, 0, 2.2, 0.1, 3.4)
    oriented_box(wood, Vector((-4.0, ky - 3.0, 0.4)), Vector((3.5, ky + 3.0, 7.5)), 0.4)
    oriented_box(wood, Vector((-s / 2 + 1.0, ky + 2.0, 10.8)), Vector((s / 2 - 1.0, ky + 2.5, 10.8)), 0.35)
    # Round towers at the front corners
    for cx, seed2 in ((-15.0, 1), (15.0, 2)):
        r2 = random.Random(seed * 10 + seed2)
        n = 14
        hs = [max(3.0, 13.0 - 7.0 * max(0.0, math.sin((k / n + seed2 * 0.37) * math.tau)) + r2.uniform(-0.8, 0.8)) for k in range(n)]
        ruin_tower(stone, dark, cx, -10.0, 4.0, hs)
    # Curtain walls: front with the gate, sides back to the keep; a breach in the right one
    wall_t, wall_h = 2.2, 9.0
    gx = 0.0
    box(stone, -(3.6 + 11.0) / 2, -10.0, -1.5, 11.0 - 3.6, wall_t, wall_h + 1.5)
    box(stone, (3.6 + 11.0) / 2, -10.0, -1.5, 11.0 - 3.6, wall_t, wall_h * 0.62 + 1.5)
    merlons(stone, -11.0, -4.0, -10.0 - wall_t / 2 + 0.3, wall_h, 0.6)
    # Gate: two towers' stumps and the arch with its top fallen
    box(stone, gx - 3.2, -10.6, -1.5, 2.4, 4.4, 11.5)
    box(stone, gx + 3.2, -10.6, -1.5, 2.4, 4.4, 8.0)
    arch_wall(stone, gx - 2.0, gx + 2.0, -10.0, wall_t + 0.4, -1.5, 7.2, gx, 3.6, 3.6)
    merlons(stone, gx - 4.4, gx - 2.0, -12.5, 10.0 - 0.2, 0.6, width=0.8, gap=0.6)
    side_heights_left = [wall_h * rnd.uniform(0.85, 1.0) for _ in range(6)]
    side_heights_right = [wall_h * f for f in (0.95, 0.7, 0.35, 0.22, 0.4, 0.8)]
    broken_run(stone, Vector((-15.0, -6.5, 0)), Vector((-s / 2, ky - 2.0, 0)), wall_t, -1.5, side_heights_left)
    broken_run(stone, Vector((15.0, -6.5, 0)), Vector((s / 2, ky - 2.0, 0)), wall_t, -1.5, side_heights_right)
    # Rubble heaps at the breach, the fallen gate top and inside the keep
    heaps = [(Vector((10.5, -1.5, -0.6)), 3.0), (Vector((gx, -13.5, -0.5)), 2.2), (Vector((3.0, ky + 2.5, -0.4)), 2.6),
             (Vector((12.0, -12.5, -0.5)), 1.6)]
    for k, (c, r) in enumerate(heaps):
        lump(rubble, c, Vector((r, r * 0.8, r * 0.5)), seed * 100 + k, roughness=0.45, subdiv=2)
        for j in range(6):
            a = rnd.uniform(0, math.tau)
            d = rnd.uniform(r * 0.6, r * 1.4)
            box(stone, c.x + math.cos(a) * d, c.y + math.sin(a) * d, -0.3, rnd.uniform(0.5, 1.1), rnd.uniform(0.4, 0.8), rnd.uniform(0.35, 0.7),
                rnd.uniform(0, 3))
    # Ivy down the front faces
    for k in range(12):
        if k < 5:
            x, y, z0 = rnd.uniform(-s / 2 + 1, s / 2 - 1), ky - s / 2 - 0.05, rnd.uniform(8.0, 16.0)
        elif k < 9:
            x, y, z0 = rnd.uniform(-10.5, -4.5), -10.0 - wall_t / 2 - 0.05, rnd.uniform(4.0, 8.0)
        else:
            x, y, z0 = rnd.uniform(4.5, 10.5), -10.0 - wall_t / 2 - 0.05, rnd.uniform(3.0, 5.0)
        p = Vector((x, y, z0))
        card(ivy, p, Vector((0, 0, -1)), Vector((0, -1, 0)), rnd.uniform(1.4, 2.2), z0 - 0.2, p + Vector((0, 8, 0)))
    objects = [stone.to_object(name), dark.to_object(name + '-holes'), smooth(rubble.to_object(name + '-rubble')),
               ivy.to_object(name + '-ivy'), wood.to_object(name + '-beams')]
    export(name, objects, lod=900)


# ---------------------------------------------------------------- glacier, seracs

def ice_material(name, tint, glow=None, strength=0.35):
    """Glacier ice and snow from the one snow texture set, tinted; `glow` lets the ice shine faintly blue
    from within, as light comes through thin ice"""
    m = pbr_material(name, 'snow_02', tint)
    if glow:
        bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Emission Color'].default_value = (*glow, 1)
        bsdf.inputs['Emission Strength'].default_value = strength
    return m


def glacier(name, seed=12, length=90.0, width=44.0):
    """A glacier tongue flowing along -Y towards its snout at the origin: a low wide body that thins out to
    nothing at its flanks (it lies in a valley or on a slope, tilted with it), crevasse bands across its
    middle that bend down-glacier towards the edges and show blue ice in their walls, a dark medial
    moraine down its centre and lateral moraines along both edges, snow on the upper part, and a blue,
    broken ice cliff at the snout. Reaches 6 m into the ground. One snow texture set, tinted"""
    clear_scene()
    rnd = random.Random(seed)
    snow = Part(ice_material('glacier-snow', (1.04, 1.05, 1.08)), uv_metres=6.0, smooth=True, bevel=0.0)
    ice = Part(ice_material('glacier-ice', (0.62, 0.7, 0.78)), uv_metres=6.0, smooth=True, bevel=0.0)
    blue = Part(ice_material('glacier-ice-blue', (0.32, 0.58, 0.88), glow=(0.08, 0.2, 0.35)), uv_metres=4.0, bevel=0.0)
    dirt = Part(ice_material('glacier-moraine', (0.36, 0.33, 0.3)), uv_metres=3.0, smooth=True, bevel=0.0)
    nu, nv = 32, 90
    off = Vector((seed * 1.3, seed * 2.1, 0.5))

    def band_at(u, v):
        """Crevasse depth: chevrons across the middle of the tongue, bent down-glacier at the edges"""
        zone = max(0.0, 1.0 - abs(v - 0.42) / 0.3)
        phase = (v + 0.06 * u * u) * length / 6.0 * math.tau + 0.7 * noise.noise(Vector((u * 3.0, v * 8.0, 1.0)) + off)
        mask = 0.5 + 0.5 * noise.noise(Vector((u * 2.5, v * 5.0, 4.0)) + off)
        return zone * mask * max(0.0, math.cos(phase)) ** 10

    def surface(u, v):
        half = width / 2 * (0.55 + 0.45 * v ** 0.5) * (1.0 + 0.1 * noise.noise(Vector((v * 6.0, 0.0, 7.0)) + off))
        x = u * half + 4.0 * math.sin(v * 2.2 + 0.4)
        y = v * length
        # Low and wide: thick in the middle, thinning to nothing at the flanks
        body = (1.0 - abs(u) ** 2) ** 1.2
        z = (3.5 + 2.5 * v) * body + 0.9 * noise.noise(Vector((x * 0.06, y * 0.04, 0)) + off) * body
        z += 0.25 * noise.noise(Vector((x * 0.3, y * 0.3, 2.0)) + off)
        z -= 2.6 * band_at(u, v) * body
        # The snout: steepening into the ice cliff
        if v < 0.06:
            z *= 0.55 + 0.45 * (v / 0.06)
        return Vector((x, y, z - 0.3))

    grid = [[surface(-1 + 2 * i / nu, j / nv) for i in range(nu + 1)] for j in range(nv + 1)]
    for j in range(nv):
        v = (j + 0.5) / nv
        for i in range(nu):
            u = -1 + 2 * (i + 0.5) / nu
            q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
            if band_at(u, v) > 0.25:
                part = blue
            elif abs(u) > 0.86 - 0.05 * noise.noise(Vector((v * 9.0, 0.0, 3.0)) + off) or (abs(u - 0.04 * math.sin(v * 9.0)) < 0.03 and v < 0.85):
                part = dirt
            elif v > 0.55 + 0.12 * noise.noise(Vector((u * 2.0, v * 3.0, 9.0)) + off):
                part = snow
            else:
                part = ice
            part.quad(q, [(0, 0), (1, 0), (1, 1), (0, 1)])
    # The snout cliff: from the front edge down into the ground, broken into vertical ribs
    front = grid[0]
    for i in range(nu):
        a, b = front[i], front[i + 1]
        bottom_a = Vector((a.x, a.y - 1.5 - 0.8 * noise.noise(Vector((a.x * 0.5, 0, 2.0)) + off), -6.0))
        bottom_b = Vector((b.x, b.y - 1.5 - 0.8 * noise.noise(Vector((b.x * 0.5, 0, 2.0)) + off), -6.0))
        mid_a = a.lerp(bottom_a, 0.5) + Vector((0, -0.6 * rnd.random(), 0))
        mid_b = b.lerp(bottom_b, 0.5) + Vector((0, -0.6 * rnd.random(), 0))
        blue.quad([b, a, mid_a, mid_b], [(0, 0), (1, 0), (1, 1), (0, 1)])
        blue.quad([mid_b, mid_a, bottom_a, bottom_b], [(0, 0), (1, 0), (1, 1), (0, 1)])
    # Flanks and back: a short skirt into the ground under the moraine
    for edge in ([grid[j][nu] for j in range(nv + 1)], [grid[j][0] for j in range(nv, -1, -1)], [grid[nv][i] for i in range(nu, -1, -1)]):
        for a, b in zip(edge, edge[1:]):
            dirt.quad([b, a, a - Vector((0, 0, 6.0)), b - Vector((0, 0, 6.0))], [(0, 0), (1, 0), (1, 1), (0, 1)])
    # Ice blocks fallen from the snout, moraine boulders along the edges
    for k in range(7):
        c = Vector((rnd.uniform(-width * 0.25, width * 0.25), rnd.uniform(-5.0, -2.0), -0.4))
        lump(blue, c, Vector((rnd.uniform(0.9, 1.8), rnd.uniform(0.8, 1.5), rnd.uniform(0.8, 1.6))), seed * 30 + k, roughness=0.4, subdiv=1)
    # The medial moraine: a ridge of stones down the middle of the lower tongue
    for k in range(16):
        v = 0.03 + k * 0.05
        p = surface(0.04 * math.sin(v * 9.0), v)
        lump(dirt, p + Vector((0, 0, -0.35)), Vector((rnd.uniform(0.5, 0.9), rnd.uniform(1.2, 1.8), rnd.uniform(0.3, 0.5))), seed * 70 + k,
             roughness=0.5, subdiv=1)
    for s in (-1, 1):
        for k in range(6):
            p = surface(s * 0.95, 0.08 + k * 0.15)
            lump(dirt, p + Vector((s * 0.5, 0, -0.6)), Vector((rnd.uniform(0.8, 1.6), rnd.uniform(1.0, 2.0), rnd.uniform(0.6, 1.1))),
                 seed * 50 + k + s * 10, roughness=0.45, subdiv=1)
    objects = [snow.to_object(name), ice.to_object(name + '-ice'), blue.to_object(name + '-blue'), dirt.to_object(name + '-moraine')]
    for o in objects[:2]:
        smooth(o)
    export(name, objects, lod=700, ao_size=256)


def ice_tower(part, base, radius, height, rnd):
    """One serac: an irregular prism of 5 to 7 sides, kinked and leaning as it rises, narrowing, its top
    broken off along a slanted, jagged cut, sometimes with a sharp splinter standing up"""
    sides = rnd.randint(5, 7)
    shape = [rnd.uniform(0.65, 1.15) for _ in range(sides)]
    turn = rnd.uniform(0, math.tau)
    lean = Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 0))
    levels = 4
    cut = Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), 0))
    bm = part.bm
    rings = []
    for j in range(levels + 1):
        t = j / levels
        centre = base + lean * height * t + Vector((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), -1.0 + (height + 1.0) * t))
        r = radius * (1.0 - 0.2 * t)
        ring = []
        for k in range(sides):
            a = turn + k / sides * math.tau
            d = Vector((math.cos(a), math.sin(a), 0))
            p = centre + d * r * shape[k] * rnd.uniform(0.92, 1.08)
            if j == levels:
                # Slanted, jagged break across the top
                p.z += d.dot(cut) * radius + rnd.uniform(-0.5, 0.5)
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for j in range(levels):
        for k in range(sides):
            bm.faces.new((rings[j][k], rings[j][(k + 1) % sides], rings[j + 1][(k + 1) % sides], rings[j + 1][k]))
    top = rings[-1]
    if rnd.random() < 0.3:
        centre = sum((v.co for v in top), Vector()) / sides
        tip = bm.verts.new(centre + Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), rnd.uniform(0.5, 1.2))))
        for k in range(sides):
            bm.faces.new((top[k], top[(k + 1) % sides], tip))
    else:
        bm.faces.new(top)


def seracs(name, seed=31):
    """A field of seracs: jagged ice towers, leaning and narrowing as they rise, broken off along slanted
    cuts with splinters standing up, flat fractured faces of blue ice that shines faintly from within, a
    little old snow between them"""
    clear_scene()
    rnd = random.Random(seed)
    ice = Part(ice_material('serac-ice', (0.45, 0.68, 0.92), glow=(0.08, 0.2, 0.35), strength=0.45), uv_metres=7.0, bevel=0.0)
    snow = Part(ice_material('glacier-snow', (1.04, 1.05, 1.08)), uv_metres=3.0, smooth=True, bevel=0.0)
    for k in range(14):
        a = rnd.uniform(0, math.tau)
        r = 0.0 if k == 0 else rnd.uniform(2.0, 7.5)
        h = rnd.uniform(3.0, 7.5) * (1.3 - r / 10.0)
        ice_tower(ice, Vector((math.cos(a) * r, math.sin(a) * r, 0)), rnd.uniform(1.8, 3.0), h, rnd)
    for k in range(5):
        a = rnd.uniform(0, math.tau)
        lump(snow, Vector((math.cos(a) * rnd.uniform(3, 7), math.sin(a) * rnd.uniform(3, 7), -0.5)),
             Vector((rnd.uniform(1.2, 2.2), rnd.uniform(1.0, 1.8), 0.6)), seed * 20 + k, roughness=0.2, subdiv=2)
    objects = [ice.to_object(name), smooth(snow.to_object(name + '-snow'))]
    for p in objects[0].data.polygons:
        p.use_smooth = False
    export(name, objects, ao_size=256)


def snowfield(name, seed=19, length=40.0, width=26.0):
    """A patch of old snow for the shade of a slope or a gully: a thin, lumpy sheet with soft, ragged
    edges and a few rocks sticking through, lying on the ground (tilt it with the slope)"""
    clear_scene()
    rnd = random.Random(seed)
    snow = Part(ice_material('glacier-snow', (1.04, 1.05, 1.08)), uv_metres=6.0, smooth=True, bevel=0.0)
    rock = Part(pbr_material('rock-' + ROCK, ROCK, GREY), uv_metres=3.0, smooth=True, bevel=0.0)
    off = Vector((seed * 0.7, seed * 1.9, 0.3))
    n = 18
    grid = []
    for j in range(n + 1):
        row = []
        for i in range(n + 1):
            u, v = -1 + 2 * i / n, -1 + 2 * j / n
            r = math.hypot(u, v * 0.9)
            edge = 1.0 + 0.25 * noise.noise(Vector((u * 2.0, v * 2.0, 5.0)) + off)
            h = max(0.0, 1.0 - (r / edge) ** 3) * (1.2 + 0.5 * noise.noise(Vector((u * 3.0, v * 3.0, 0)) + off))
            row.append(Vector((u * width / 2, v * length / 2, h - 0.35)))
        grid.append(row)
    for j in range(n):
        for i in range(n):
            snow.quad([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]], [(0, 0), (1, 0), (1, 1), (0, 1)])
    for k in range(5):
        lump(rock, Vector((rnd.uniform(-width * 0.3, width * 0.3), rnd.uniform(-length * 0.3, length * 0.3), -0.2)),
             Vector((rnd.uniform(0.6, 1.4), rnd.uniform(0.5, 1.1), rnd.uniform(0.6, 1.0))), seed * 10 + k, roughness=0.4, subdiv=1)
    export(name, [smooth(snow.to_object(name)), smooth(rock.to_object(name + '-rock'))], ao_size=256)


# ---------------------------------------------------------------- avalanche barriers

def avalanche_barrier(name, snowed=False, length=4.0, height=3.5):
    """Steel snow bridge on a slope (uphill +Y): a grid of horizontal beams on two girders leaning back
    uphill, held by struts to footings; `snowed`: snow banked up against it from above"""
    clear_scene()
    steel = Part(flat_material('galvanised', (0.45, 0.46, 0.45), 0.4, 0.8), bevel=0.0)
    concrete = Part(pbr_material('wall-brushed_concrete', 'brushed_concrete'), uv_metres=2.0)
    lean = Vector((0, 0.9, height)).normalized()
    girders = (-length / 2 + 0.5, length / 2 - 0.5)
    for x in girders:
        foot = Vector((x, 0, -0.6))
        top = foot + lean * (height + 0.6)
        oriented_box(steel, foot, top, 0.16)
        back = Vector((x, 2.4, -0.6))
        oriented_box(steel, back, foot + lean * (height * 0.6), 0.12)
        box(concrete, x, 0, -0.9, 0.7, 0.7, 0.5)
        box(concrete, x, 2.4, -0.9, 0.6, 0.6, 0.5)
    beams = 8
    for k in range(beams):
        z = 0.25 + k * (height - 0.35) / (beams - 1)
        p = Vector((0, 0, -0.6)) + lean * ((z + 0.6) / lean.z)
        # I-profile: a web and two flanges, seen as one thick bar from afar
        box(steel, 0, p.y - 0.06, p.z - 0.09, length, 0.06, 0.18)
        box(steel, 0, p.y - 0.06, p.z - 0.09, length, 0.16, 0.03)
        box(steel, 0, p.y - 0.06, p.z + 0.06, length, 0.16, 0.03)
    objects = [steel.to_object(name), concrete.to_object(name + '-footings')]
    if snowed:
        snow = Part(pbr_material('snow-snow_02', 'snow_02', (1.05, 1.05, 1.08)), uv_metres=3.0, smooth=True, bevel=0.0)
        lump(snow, Vector((0, 2.5, -1.4)), Vector((length / 2 + 0.4, 1.6, 2.6)), 7, roughness=0.15, subdiv=3)
        for k in range(beams):
            z = 0.25 + k * (height - 0.35) / (beams - 1)
            p = Vector((0, 0, -0.6)) + lean * ((z + 0.6) / lean.z)
            box(snow, 0, p.y - 0.02, p.z + 0.09, length - 0.1, 0.22, 0.09)
        objects.append(smooth(snow.to_object(name + '-snow')))
    export(name, objects)


# ---------------------------------------------------------------- shipwreck

def shipwreck(name, seed=17, length=22.0, beam=6.4, depth=4.0):
    """A wooden ship stranded on its side: a hole broken into the upper flank amidships with bare ribs in
    it, a raised stern with a transom, a bowsprit, the deck half gone, the mast snapped and its top lying
    in the sand with loose planks; it sinks one and a half metres into the ground"""
    import bmesh
    from build_levels import hull
    clear_scene()
    rnd = random.Random(seed)
    planks = Part(two_sided(pbr_material('planks-wreck', 'weathered_planks', (0.55, 0.48, 0.42))), uv_metres=1.5, bevel=0.0)
    ribs = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    iron = Part(flat_material('iron-rust', (0.18, 0.09, 0.05), 0.85, 0.3), smooth=True)
    stations, sheer = 16, 0.7
    hull(planks, length, beam, depth, sheer=sheer, stations=stations)
    # The hole: planks gone on the -X flank (it ends up on top) over the middle of the ship
    hole = [f for f in planks.bm.faces if f.calc_center_median().x < -beam * 0.2 and abs(f.calc_center_median().y + 1.0) < length * 0.24
            and f.calc_center_median().z > depth * 0.25 and rnd.random() < 0.85]
    bmesh.ops.delete(planks.bm, geom=hole, context='FACES')

    def section(t, inset):
        """The hull's cross section at `t` along it, as hull() builds it, `inset` metres inside"""
        w = max(0.02, beam / 2 * (math.sin(min(1.0, t * 1.25) * math.pi / 2) ** 0.8) * (1.0 if t < 0.85 else 0.95))
        top = depth + sheer * (1 - t) ** 2 * 2
        return [Vector((-math.cos(k / 6 * math.pi) * (w - inset), -length / 2 + t * length,
                        top - math.sin(k / 6 * math.pi) * depth * (0.4 + 0.6 * min(1, t * 3)) + inset * 0.5)) for k in range(7)]

    # Ribs: frames every station, bare in the hole, stubs of them elsewhere along the inside
    for i in range(2, stations - 1):
        t = i / (stations - 1)
        pts = section(t, 0.12)
        in_hole = abs(pts[0].y + 1.0) < length * 0.24
        last = 7 if in_hole else 3
        for a, b in zip(pts[:last], pts[1:last]):
            oriented_box(ribs, a, b, 0.24)
    # Keel, stem post and bowsprit, a wale along both sides
    oriented_box(ribs, Vector((0, -length / 2 + 0.6, 0.15)), Vector((0, length / 2, 0.2)), 0.4)
    stem = Vector((0, -length / 2 + 0.1, depth + sheer * 2))
    oriented_box(ribs, Vector((0, -length / 2 + 0.4, 0.2)), stem + Vector((0, -0.4, 0.4)), 0.35)
    tube(ribs, [stem + Vector((0, 0.8, -0.3)), stem + Vector((0, -5.0, 2.0))], [0.2, 0.1], 6, cap=True)
    for s in (-1, 1):
        pts = [section(i / 12, -0.06)[0 if s < 0 else 6] - Vector((0, 0, 0.5)) for i in range(1, 13)]
        for a, b in zip(pts, pts[1:]):
            oriented_box(ribs, a, b, 0.2)
    # Deck remnants: planks across the stern half; a raised stern with side walls and a transom
    for k in range(9):
        y = 0.5 + k * 0.9
        if rnd.random() < 0.3:
            continue
        box(planks, 0, y, depth - 0.1, beam * 0.86, 0.8, 0.08)
    st = length / 2 - 3.8
    box(planks, 0, st + 1.8, depth + 0.9, beam * 0.8, 3.8, 0.1)
    for s in (-1, 1):
        box(planks, s * beam * 0.43, st + 1.8, depth - 0.1, 0.15, 3.8, 2.2)
    box(planks, 0, length / 2 - 0.05, depth - 0.6, beam * 0.86, 0.15, 2.8)
    for k in range(3):
        box(ribs, -beam * 0.25 + k * beam * 0.25, length / 2 + 0.05, depth + 0.4, 0.5, 0.1, 0.7)
    # Mast snapped at 5 m, iron hoops on it
    mast = [Vector((0, -1.5, 0.5)), Vector((0, -1.5, depth + 4.5))]
    tube(ribs, mast, [0.34, 0.28], 8, cap=True)
    for k in range(3):
        tube(iron, [Vector((0, -1.5, 2.0 + k * 1.8)), Vector((0, -1.5, 2.15 + k * 1.8))], [0.37, 0.37], 8)
    objects = [planks.to_object(name), ribs.to_object(name + '-ribs'), iron.to_object(name + '-iron')]
    # On its side: rolled 34 degrees, bow up a little, sunk into the sand
    tilt(objects, x=4.0, y=34.0, z=0.0, lift=-1.5)
    lying = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    tube(lying, [Vector((beam + 1.8, -7.0, 0.2)), Vector((beam + 3.2, 4.0, 0.35))], [0.26, 0.2], 8, cap=True)
    oriented_box(lying, Vector((beam + 1.2, -2.0, 0.3)), Vector((beam + 4.2, -2.6, 0.35)), 0.2)
    for k in range(8):
        box(lying, rnd.uniform(-beam, beam * 1.6), rnd.uniform(-length / 2, length / 2), -0.05, rnd.uniform(1.2, 3.0), 0.3, 0.08,
            rnd.uniform(0, 3))
    objects.append(lying.to_object(name + '-debris'))
    export(name, objects, lod=700)


# ---------------------------------------------------------------- rocket

def lattice_tower(part, cx, cy, size, height, bay=2.5, beam=0.22, brace=0.1):
    """Square lattice tower: four corner columns, a ring and an X brace on each face per bay"""
    corners = [Vector((cx - size / 2, cy - size / 2, 0)), Vector((cx + size / 2, cy - size / 2, 0)),
               Vector((cx + size / 2, cy + size / 2, 0)), Vector((cx - size / 2, cy + size / 2, 0))]
    for c in corners:
        oriented_box(part, c + Vector((0, 0, -0.5)), c + Vector((0, 0, height)), beam)
    bays = int(height / bay)
    for j in range(bays):
        z0, z1 = j * bay, (j + 1) * bay
        for k in range(4):
            a, b = corners[k], corners[(k + 1) % 4]
            oriented_box(part, a + Vector((0, 0, z1)), b + Vector((0, 0, z1)), brace * 1.4)
            oriented_box(part, a + Vector((0, 0, z0)), b + Vector((0, 0, z1)), brace)
            oriented_box(part, b + Vector((0, 0, z0)), a + Vector((0, 0, z1)), brace)
    return corners


def rocket(name):
    """A two-stage rocket on its launch mount with the service tower beside it: white stages with black
    roll marks, four fins and engine bells under a hold-down ring, a pointed fairing; the red lattice tower
    reaches it with two arms. Pad of concrete with a flame trench"""
    clear_scene()
    white = Part(flat_material('rocket-white', (0.86, 0.86, 0.84), 0.35, 0.05), smooth=True)
    black = Part(flat_material('rocket-black', (0.04, 0.04, 0.045), 0.4, 0.1), smooth=True)
    metal = Part(flat_material('rocket-metal', (0.4, 0.4, 0.42), 0.35, 0.85), smooth=True)
    red = Part(flat_material('tower-red', (0.5, 0.08, 0.05), 0.55, 0.3), bevel=0.0)
    pad = Part(pbr_material('wall-brushed_concrete', 'brushed_concrete'), uv_metres=4.0)
    dark = Part(flat_material('trench-dark', (0.02, 0.02, 0.02), 0.95), bevel=0.0)
    lights = Part(flat_material('pad-light', (0.2, 0.6, 1.0), 0.3, emission=(0.2, 0.6, 1.0), strength=1.0), bevel=0.0)
    r = 1.8
    base = 4.2
    # Pad and mount
    box(pad, 0, 0, -1.5, 18.0, 18.0, 2.0)
    box(dark, 0, -6.0, 0.48, 4.0, 6.0, 0.05)
    tube(pad, [Vector((0, 0, 0.5)), Vector((0, 0, base - 1.3))], [3.2, 2.8], 16, cap=True)
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 4
        p = Vector((math.cos(a) * 2.5, math.sin(a) * 2.5, base - 1.4))
        box(metal, p.x, p.y, p.z, 0.5, 0.5, 1.6, a)
    for k in range(8):
        a = k / 8 * math.tau
        box(lights, math.cos(a) * 8.6, math.sin(a) * 8.6, 0.5, 0.3, 0.3, 0.12)
    # Engines: four bells under the first stage
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 4
        c = Vector((math.cos(a) * 0.8, math.sin(a) * 0.8, base))
        tube(metal, [c, c - Vector((0, 0, 1.4))], [0.32, 0.62], 12)
    # First stage, interstage, second stage, fairing
    tube(white, [Vector((0, 0, base)), Vector((0, 0, base + 14.0))], [r, r], 24, cap=True)
    tube(black, [Vector((0, 0, base + 14.0)), Vector((0, 0, base + 15.6))], [r * 1.01, r * 1.01], 24)
    tube(white, [Vector((0, 0, base + 15.6)), Vector((0, 0, base + 23.0))], [r, r], 24)
    ogive = [(0.0, 1.0), (1.2, 0.97), (2.4, 0.86), (3.4, 0.68), (4.2, 0.45), (4.8, 0.2), (5.1, 0.02)]
    tube(white, [Vector((0, 0, base + 23.0 + z)) for z, _ in ogive], [r * f for _, f in ogive], 24)
    # Roll marks and bands
    for z0, z1 in ((base + 0.3, base + 0.9), (base + 9.0, base + 9.5), (base + 22.6, base + 23.0)):
        tube(black, [Vector((0, 0, z0)), Vector((0, 0, z1))], [r * 1.01, r * 1.01], 24)
    for k in range(4):
        a = k / 4 * math.tau
        if k % 2 == 0:
            for z0 in (base + 3.0, base + 17.5):
                c = Vector((math.cos(a) * (r + 0.005), math.sin(a) * (r + 0.005), z0))
                box(black, c.x, c.y, c.z, 0.04, 1.2, 3.0, a)
    # Fins
    for k in range(4):
        a = k / 4 * math.tau
        out = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-math.sin(a), math.cos(a), 0)) * 0.09
        root0 = out * r + Vector((0, 0, base + 0.2))
        root1 = out * r + Vector((0, 0, base + 4.5))
        tip0 = out * (r + 2.0) + Vector((0, 0, base - 0.6))
        tip1 = out * (r + 2.0) + Vector((0, 0, base + 1.8))
        bm = black.bm
        f = [bm.verts.new(v + side) for v in (root0, tip0, tip1, root1)]
        b = [bm.verts.new(v - side) for v in (root0, tip0, tip1, root1)]
        bm.faces.new(f)
        bm.faces.new(list(reversed(b)))
        for i in range(4):
            bm.faces.new((f[(i + 1) % 4], f[i], b[i], b[(i + 1) % 4]))
    # Service tower with two arms to the rocket
    tx = 7.0
    lattice_tower(red, tx, 0, 3.2, 30.0)
    box(red, tx, 0, 30.0, 4.0, 4.0, 0.3)
    tube(metal, [Vector((tx, 0, 30.3)), Vector((tx, 0, 34.0))], [0.08, 0.05], 6)
    box(lights, tx, 0, 34.0, 0.3, 0.3, 0.3)
    for z in (base + 12.0, base + 21.0):
        oriented_box(red, Vector((tx - 1.6, 0.6, z)), Vector((r + 0.3, 0.6, z)), 0.3)
        oriented_box(red, Vector((tx - 1.6, -0.6, z)), Vector((r + 0.3, -0.6, z)), 0.3)
        box(red, r + 0.6, 0, z - 0.2, 0.8, 1.6, 1.8)
    objects = [white.to_object(name), black.to_object(name + '-black'), metal.to_object(name + '-metal'), red.to_object(name + '-tower'),
               pad.to_object(name + '-pad'), dark.to_object(name + '-trench'), lights.to_object(name + '-lights')]
    export(name, objects, lod=600)


# ---------------------------------------------------------------- volcano, station lights

def out_at(angle, radius, z):
    return Vector((math.cos(angle) * radius, math.sin(angle) * radius, z))


def glass_shard(part, base, radius, height, lean, rnd):
    """One spire of volcanic glass: an irregular five- or six-sided prism narrowing in three steps to a
    sharp, off-centre point, its facets flat like conchoidal fractures"""
    sides = rnd.randint(5, 6)
    shape = [rnd.uniform(0.7, 1.15) for _ in range(sides)]
    turn = rnd.uniform(0, math.tau)
    bm = part.bm
    rings = []
    for j, (t, f) in enumerate(((0.0, 1.0), (0.45, 0.72), (0.78, 0.38))):
        centre = base + lean * height * t + Vector((0, 0, -1.0 + (height + 1.0) * t))
        ring = []
        for k in range(sides):
            a = turn + k / sides * math.tau + rnd.uniform(-0.12, 0.12) * j
            ring.append(bm.verts.new(centre + Vector((math.cos(a), math.sin(a), 0)) * radius * f * shape[k]))
        rings.append(ring)
    tip = bm.verts.new(base + lean * height + Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), height)))
    for j in range(2):
        for k in range(sides):
            bm.faces.new((rings[j][k], rings[j][(k + 1) % sides], rings[j + 1][(k + 1) % sides], rings[j + 1][k]))
    for k in range(sides):
        bm.faces.new((rings[2][k], rings[2][(k + 1) % sides], tip))


def obsidian_tower(name, seed=41, height=22.0):
    """A cluster of volcanic glass spires for a crater rim: a leaning main spire about 22 m high, seven
    more shards from 6 to 15 m crowding round its foot, faceted near-black glass with a cold sheen that
    catches the lava light on its edges, dark rock and glowing cracks at the foot"""
    from build_extreme import ember, hell_rock
    clear_scene()
    rnd = random.Random(seed)
    # As obsidian_material (build_levels.py), its sheen warmed by the lava light around it
    glass = Part(flat_material('obsidian-lava-lit', (0.02, 0.018, 0.022), 0.12, 0.0, emission=(0.04, 0.012, 0.008), strength=0.5),
                 bevel=0.0)
    rock = hell_rock()
    rock.bevel = 0.0
    glow = Part(ember(1.6), bevel=0.0)
    glass_shard(glass, Vector((0, 0, 0)), 3.0, height, Vector((rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1), 0)), rnd)
    for k in range(7):
        a = k / 7 * math.tau + rnd.uniform(-0.3, 0.3)
        out = Vector((math.cos(a), math.sin(a), 0))
        h = rnd.uniform(6.0, 15.0)
        glass_shard(glass, out * rnd.uniform(2.6, 4.5), rnd.uniform(1.0, 1.9), h, out * rnd.uniform(0.08, 0.3), rnd)
    for k in range(7):
        a = rnd.uniform(0, math.tau)
        lump(rock, out_at(a, rnd.uniform(3.0, 5.5), -0.6), Vector((rnd.uniform(1.2, 2.2), rnd.uniform(1.0, 1.6), rnd.uniform(0.6, 1.1))),
             seed * 10 + k, roughness=0.4, subdiv=2)
    for k in range(9):
        a = rnd.uniform(0, math.tau)
        c = out_at(a, rnd.uniform(1.5, 5.5), 0.02)
        box(glow, c.x, c.y, c.z - 0.06, rnd.uniform(1.0, 2.4), 0.12, 0.14, a + math.pi / 2 + rnd.uniform(-0.4, 0.4))
    objects = [glass.to_object(name), smooth(rock.to_object(name + '-rock')), glow.to_object(name + '-glow')]
    for p in objects[0].data.polygons:
        p.use_smooth = False
    export(name, objects)


def floodlight_mast(name, height=12.0):
    """Floodlight mast for a pad or a base: a tapered steel pole on a concrete foot, a ladder, a head frame
    with four lamps facing the front (-Y)"""
    clear_scene()
    steel = Part(flat_material('mast-steel', (0.55, 0.56, 0.58), 0.4, 0.8), smooth=True)
    concrete = Part(pbr_material('wall-brushed_concrete', 'brushed_concrete'), uv_metres=2.0)
    lamp = Part(flat_material('flood-lamp', (1.0, 0.95, 0.85), 0.3, emission=(1.0, 0.95, 0.85), strength=3.0), bevel=0.0)
    dark = Part(flat_material('lamp-housing', (0.12, 0.12, 0.13), 0.5, 0.6))
    box(concrete, 0, 0, -0.8, 1.2, 1.2, 1.1)
    tube(steel, [Vector((0, 0, 0.3)), Vector((0, 0, height))], [0.24, 0.12], 10, cap=True)
    for k in range(int(height / 0.4) - 2):
        z = 1.0 + k * 0.4
        oriented_box(steel, Vector((-0.18, 0.28, z)), Vector((0.18, 0.28, z)), 0.03)
    for s in (-1, 1):
        oriented_box(steel, Vector((s * 0.18, 0.28, 0.8)), Vector((s * 0.18, 0.28, height - 0.6)), 0.04)
    oriented_box(steel, Vector((-1.4, 0, height)), Vector((1.4, 0, height)), 0.12)
    oriented_box(steel, Vector((-1.4, 0, height + 1.0)), Vector((1.4, 0, height + 1.0)), 0.12)
    for x in (-1.4, 1.4):
        oriented_box(steel, Vector((x, 0, height)), Vector((x, 0, height + 1.0)), 0.1)
    for k in range(4):
        x = -1.05 + k * 0.7
        z = height + 0.5
        box(dark, x, -0.15, z - 0.3, 0.6, 0.3, 0.6)
        box(lamp, x, -0.31, z - 0.25, 0.5, 0.04, 0.5)
    export(name, [steel.to_object(name), concrete.to_object(name + '-foot'), dark.to_object(name + '-housing'), lamp.to_object(name + '-lamps')])


def beacon_post(name):
    """Short post with a red position light on top, for pad edges, masts and paths"""
    clear_scene()
    steel = Part(flat_material('mast-steel', (0.55, 0.56, 0.58), 0.4, 0.8), smooth=True)
    red = Part(flat_material('beacon', (0.9, 0.1, 0.05), 0.3, emission=(1.0, 0.1, 0.05), strength=2.0), smooth=True, bevel=0.0)
    tube(steel, [Vector((0, 0, -0.3)), Vector((0, 0, 0.08))], [0.25, 0.25], 10, cap=True)
    tube(steel, [Vector((0, 0, 0.08)), Vector((0, 0, 2.0))], [0.06, 0.05], 8)
    tube(steel, [Vector((0, 0, 2.0)), Vector((0, 0, 2.08))], [0.14, 0.14], 10, cap=True)
    prof = [(0.0, 0.11), (0.1, 0.11), (0.18, 0.08), (0.24, 0.0)]
    tube(red, [Vector((0, 0, 2.08 + z)) for z, _ in prof], [r for _, r in prof], 10)
    export(name, [steel.to_object(name), red.to_object(name + '-light')])


# ---------------------------------------------------------------- village landmarks

def disc(part, centre, normal, radius, sides):
    """Flat round face looking along `normal` (horizontal normals)"""
    along = Vector((-normal.y, normal.x, 0))
    ring = [part.bm.verts.new(centre + (along * math.cos(k / sides * math.tau) + Vector((0, 0, 1)) * math.sin(k / sides * math.tau)) * radius)
            for k in range(sides)]
    f = part.bm.faces.new(ring)
    for loop in f.loops:
        loop[part.uv].uv = (0.5, 0.5)


def bell_tower(name, snow=False, w=4.6, shaft=15.0):
    """Free-standing village bell tower: a stone shaft on a plinth with corner quoins and slit windows, a
    clock face on each side, an open belfry with round arches and a bell, a steep slate spire with a
    cross; `snow` lays snow on the spire and the ledges"""
    from build_structures import FOUNDATION, pyramid_roof
    clear_scene()
    stone = Part(pbr_material('wall-stacked_stone_wall', 'stacked_stone_wall'), uv_metres=2.5)
    quoin = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=1.5)
    blocks = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=1.5, bevel=0.0)
    roof = Part(pbr_material('roof-roof_slates_02', 'roof_slates_02'))
    dark = Part(flat_material('window', (0.05, 0.06, 0.07), roughness=0.2, metallic=0.3))
    face = Part(flat_material('clock-face', (0.86, 0.84, 0.78), 0.6), smooth=True, bevel=0.0)
    bronze = Part(flat_material('bell-bronze', (0.45, 0.32, 0.12), 0.35, 0.9), smooth=True)
    box(quoin, 0, 0, -FOUNDATION, w + 0.5, w + 0.5, FOUNDATION + 0.9)
    box(stone, 0, 0, 0.9, w, w, shaft - 0.9)
    # Quoins up the corners, a string course under the belfry
    for sx in (-1, 1):
        for sy in (-1, 1):
            for k in range(int(shaft / 0.9)):
                big = k % 2 == 0
                box(blocks, sx * (w / 2 - (0.25 if big else 0.18)) + sx * 0.04, sy * (w / 2 - (0.18 if big else 0.25)) + sy * 0.04, 0.9 + k * 0.9,
                    0.58 if big else 0.42, 0.42 if big else 0.58, 0.86)
    box(quoin, 0, 0, shaft - 0.3, w + 0.3, w + 0.3, 0.3)
    # Belfry: four arches, corner piers, a cornice
    bh = 3.6
    for side in range(4):
        a = side * math.pi / 2
        n = Vector((math.cos(a - math.pi / 2), math.sin(a - math.pi / 2), 0))
        along = Vector((-n.y, n.x, 0))
        c = n * (w / 2 - 0.25)
        for s in (-1, 1):
            p = c + along * s * (w / 2 - 0.45)
            box(stone, p.x, p.y, shaft, 0.9 if abs(along.x) > 0.5 else 0.5, 0.5 if abs(along.x) > 0.5 else 0.9, bh)
        steps = 10
        span = w - 1.8
        for k in range(steps):
            m = -span / 2 + (k + 0.5) * span / steps
            bottom = shaft + bh - 1.2 + math.sqrt(max(0.0, (span / 2) ** 2 - m * m)) * (1.1 / (span / 2))
            p = c + along * m
            box(stone, p.x, p.y, bottom, span / steps + 0.01 if abs(along.x) > 0.5 else 0.5, 0.5 if abs(along.x) > 0.5 else span / steps + 0.01,
                shaft + bh - bottom)
        # Slit windows on the shaft, a clock face under the belfry
        for z in (4.0, 8.0):
            q = n * (w / 2 + 0.02)
            box(dark, q.x, q.y, z, 0.3 if abs(along.x) > 0.5 else 0.08, 0.08 if abs(along.x) > 0.5 else 0.3, 1.2)
        q = n * (w / 2 + 0.03) + Vector((0, 0, shaft - 1.6))
        tube(blocks, [q - n * 0.05, q + n * 0.06], [0.95, 0.95], 16, cap=True)
        tube(face, [q + n * 0.06, q + n * 0.16], [0.8, 0.8], 16)
        disc(face, q + n * 0.16, n, 0.8, 16)
        oriented_box(dark, q + n * 0.2, q + n * 0.2 + Vector((0, 0, 0.6)), 0.06)
        oriented_box(dark, q + n * 0.2, q + n * 0.2 + along * 0.45, 0.06)
    box(quoin, 0, 0, shaft + bh, w + 0.4, w + 0.4, 0.35)
    box(stone, 0, 0, shaft - 0.1, w - 1.0, w - 1.0, 0.2)
    # Bell on a beam
    oriented_box(quoin, Vector((-w / 2 + 0.5, 0, shaft + bh - 0.6)), Vector((w / 2 - 0.5, 0, shaft + bh - 0.6)), 0.22)
    prof = [(0.0, 0.62), (0.1, 0.6), (0.35, 0.45), (0.8, 0.36), (1.05, 0.28), (1.15, 0.0)]
    tube(bronze, [Vector((0, 0, shaft + bh - 1.9 + z)) for z, _ in prof], [r for _, r in prof], 14)
    # Spire and cross
    top = shaft + bh + 0.35
    pyramid_roof(roof, w, w, top, 6.5, overhang=0.35)
    oriented_box(dark, Vector((0, 0, top + 6.3)), Vector((0, 0, top + 7.6)), 0.08)
    oriented_box(dark, Vector((-0.35, 0, top + 7.2)), Vector((0.35, 0, top + 7.2)), 0.07)
    objects = [stone.to_object(name), quoin.to_object(name + '-quoins'), blocks.to_object(name + '-blocks'), roof.to_object(name + '-roof'), dark.to_object(name + '-dark'),
               face.to_object(name + '-clock'), bronze.to_object(name + '-bell')]
    if snow:
        cover = Part(pbr_material('snow-snow_02', 'snow_02', (0.95, 0.97, 1.0)), uv_metres=3.0, bevel=0.0)
        pyramid_roof(cover, w + 0.05, w + 0.05, top + 0.1, 6.5, overhang=0.38)
        box(cover, 0, 0, shaft + bh + 0.35, w + 0.45, w + 0.45, 0.08)
        box(cover, 0, 0, shaft, w + 0.35, w + 0.35, 0.08)
        objects.append(cover.to_object(name + '-snow'))
    export(name, objects, lod=500)


def standing_stone(part, base, width, depth, height, turn, lean, seed):
    """An upright slab of rough rock: a noisy lump stretched upwards, turned and leaning"""
    before = len(part.bm.verts)
    lump(part, Vector((0, 0, -0.6)), Vector((width / 2, depth / 2, height / 1.3)), seed, roughness=0.18, subdiv=2)
    m = Matrix.Translation(base) @ Matrix.Rotation(turn, 4, 'Z') @ Matrix.Rotation(lean, 4, 'X')
    part.bm.verts.ensure_lookup_table()
    for v in part.bm.verts[before:]:
        v.co = m @ v.co


def stone_circle(name, seed=23, radius=7.5, count=13):
    """A ring of weathered standing stones (about 15 m across): uprights, two pairs carrying lintels, one
    fallen, a flat altar stone in the middle; lichen-grey rock, structure without a plate"""
    clear_scene()
    rnd = random.Random(seed)
    rock = Part(pbr_material('rock-' + ROCK + '-lichen', 'rock_boulder_dry', (0.7, 0.72, 0.66)), uv_metres=2.5, smooth=True, bevel=0.0)
    moss = Part(pbr_material('castle-' + RUIN, RUIN), uv_metres=2.0, smooth=True, bevel=0.0)
    tops = []
    for k in range(count):
        a = k / count * math.tau + rnd.uniform(-0.05, 0.05)
        p = Vector((math.cos(a) * radius, math.sin(a) * radius, 0))
        if k == 5:
            # Fallen outwards, half sunk
            standing_stone(moss, p + Vector((math.cos(a), math.sin(a), 0)) * 1.6 + Vector((0, 0, 0.5)), 1.5, 0.8, 3.2, a + math.pi / 2,
                           math.radians(84), seed + k)
            continue
        h = rnd.uniform(2.8, 4.2) * (1.25 if k in (0, 1, 7, 8) else 1.0)
        standing_stone(rock, p, rnd.uniform(1.2, 1.7), rnd.uniform(0.6, 0.9), h, a + math.pi / 2, rnd.uniform(-0.08, 0.08), seed + k)
        tops.append((k, p, h))
    # Lintels across two neighbouring pairs
    by = {k: (p, h) for k, p, h in tops}
    for a, b in ((0, 1), (7, 8)):
        pa, ha = by[a]
        pb, hb = by[b]
        z = min(ha, hb) - 0.15
        oriented_box(rock, pa + Vector((0, 0, z)), pb + Vector((0, 0, z)), 0.9)
    lump(moss, Vector((0, 0, -0.3)), Vector((1.6, 1.0, 0.55)), seed + 50, roughness=0.15, flat_top=0.7, subdiv=2)
    objects = [smooth(rock.to_object(name)), smooth(moss.to_object(name + '-moss'))]
    export(name, objects, lod=500)


# ---------------------------------------------------------------- siege

def trebuchet(name, seed=29):
    """A counterweight trebuchet, cocked, throwing towards the front (-Y): a timber base on four solid
    wheels, two A-frames carrying the axle at 6 m, the long arm drawn down to the rear, the counterweight
    box raised at the front, the sling lying in its trough; a few stone balls beside it"""
    clear_scene()
    rnd = random.Random(seed)
    wood = Part(pbr_material('wood-rough', 'rough_wood', (0.8, 0.72, 0.62)), uv_metres=1.0)
    iron = Part(flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8), smooth=True)
    rope = Part(flat_material('rope', (0.55, 0.47, 0.33), 0.9), smooth=True, bevel=0.0)
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=1.0, smooth=True, bevel=0.0)
    hw, hl, axle = 1.4, 3.6, 6.0
    for s in (-1, 1):
        box(wood, s * hw, 0, 0.55, 0.4, hl * 2, 0.4)
        for y in (-hl + 0.5, hl - 0.5):
            tube(wood, [Vector((s * (hw + 0.25), y, 0.55)), Vector((s * (hw + 0.55), y, 0.55))], [0.55, 0.55], 12)
            tube(iron, [Vector((s * (hw + 0.55), y, 0.55)), Vector((s * (hw + 0.62), y, 0.55))], [0.12, 0.12], 8)
        # A-frame: two legs and a brace up to the axle
        top = Vector((s * hw, 0, axle))
        for y in (-2.2, 2.2):
            oriented_box(wood, Vector((s * hw, y, 0.75)), top, 0.3)
        oriented_box(wood, Vector((s * hw, -1.3, 3.0)), Vector((s * hw, 1.3, 3.0)), 0.22)
        oriented_box(wood, Vector((s * hw, 0, 0.75)), top, 0.26)
    for y in (-hl + 0.3, -1.0, 1.0, hl - 0.3):
        box(wood, 0, y, 0.6, hw * 2 + 0.4, 0.3, 0.3)
    tube(iron, [Vector((-hw - 0.3, 0, axle)), Vector((hw + 0.3, 0, axle))], [0.12, 0.12], 8)
    # The arm: long end drawn down to the rear, short end up at the front with the counterweight
    pivot = Vector((0, 0, axle))
    back = pivot + Vector((0, 8.2, -4.6)).normalized() * 9.0
    front = pivot + (pivot - back).normalized() * 3.0
    oriented_box(wood, back, front, 0.4)
    for k in range(4):
        p = pivot.lerp(back, 0.15 + k * 0.22)
        tube(iron, [p + Vector((-0.27, 0, 0)), p + Vector((0.27, 0, 0))], [0.24, 0.24], 8)
    hang = front + Vector((0, 0, -0.4))
    for s in (-1, 1):
        oriented_box(iron, front + Vector((s * 0.3, 0, 0)), hang + Vector((s * 0.6, 0, -1.2)), 0.08)
    box(wood, hang.x, hang.y, hang.z - 3.4, 2.0, 1.8, 2.2)
    box(iron, hang.x, hang.y, hang.z - 1.3, 2.1, 1.9, 0.12)
    # Sling from the arm's tip forward along the trough, a pouch at its end
    pts = [back, back + Vector((0, -1.5, -0.4)), Vector((0, back.y - 3.0, 0.95)), Vector((0, -1.0, 0.95))]
    for a, b in zip(pts, pts[1:]):
        tube(rope, [a, b], [0.04, 0.04], 5)
    lump(rope, Vector((0, -1.3, 0.85)), Vector((0.35, 0.3, 0.2)), seed, roughness=0.2, subdiv=1)
    for k in range(5):
        lump(stone, Vector((-hw - 1.6 + rnd.uniform(-0.6, 0.6), rnd.uniform(-1.5, 1.5), -0.1)), Vector((0.4, 0.4, 0.4)), seed + k,
             roughness=0.1, flat_bottom=False, subdiv=2)
    objects = [wood.to_object(name), iron.to_object(name + '-iron'), rope.to_object(name + '-rope'), stone.to_object(name + '-stones')]
    export(name, objects, lod=600)


# ---------------------------------------------------------------- city

def placed_box(part, m, cx, cy, z0, sx, sy, sz):
    """A box built at the origin's frame and moved by the matrix `m` (any rotation)"""
    before = len(part.bm.verts)
    box(part, cx, cy, z0, sx, sy, sz)
    part.bm.verts.ensure_lookup_table()
    for v in part.bm.verts[before:]:
        v.co = m @ v.co


def deck(concrete, asphalt, m, x0, x1, width, rnd, broken_end=None, rebar=None):
    """A stretch of elevated road along X in the frame `m`: the slab with its haunches, asphalt, parapets;
    `broken_end` (x) frays that end with rebar sticking out"""
    length = x1 - x0
    cx = (x0 + x1) / 2
    placed_box(concrete, m, cx, 0, -1.2, length, width, 1.2)
    placed_box(concrete, m, cx, 0, -2.0, length, width * 0.55, 0.8)
    placed_box(asphalt, m, cx, 0, 0.0, length, width - 1.0, 0.06)
    for s in (-1, 1):
        placed_box(concrete, m, cx, s * (width / 2 - 0.25), 0.0, length, 0.5, 0.95)
    if broken_end is not None:
        for k in range(9):
            y = -width / 2 + 0.6 + k * (width - 1.2) / 8
            out = rnd.uniform(0.6, 1.8)
            a = m @ Vector((broken_end, y, -0.5 + rnd.uniform(-0.3, 0.3)))
            b = m @ Vector((broken_end + out * (1 if broken_end > cx else -1), y + rnd.uniform(-0.3, 0.3), -0.5 - rnd.uniform(0.0, 0.8)))
            oriented_box(rebar, a, b, 0.05)
        for k in range(5):
            y = -width / 2 + rnd.uniform(0.5, width - 0.5)
            sz = rnd.uniform(0.6, 1.4)
            placed_box(concrete, m, broken_end + (0.3 if broken_end > cx else -0.3) * rnd.uniform(0.5, 1.5), y, -1.2, rnd.uniform(0.6, 1.2),
                       rnd.uniform(0.8, 1.6), sz)


def highway_collapsed(name, seed=37, height=9.0, width=12.0):
    """A collapsed elevated highway (about 50 m along X): a span still standing on two pillars and broken
    off in mid-air with its rebar hanging out, the next span fallen with one end on the ground, a pillar
    snapped half way, rubble below. Concrete with asphalt and parapets; a structure that blocks sight and
    building"""
    clear_scene()
    rnd = random.Random(seed)
    concrete = Part(pbr_material('wall-brushed_concrete-grey', 'brushed_concrete', (1.2, 1.25, 1.35)), uv_metres=4.0)
    asphalt = Part(pbr_material('ground-asphalt_02', 'asphalt_02'), uv_metres=4.0, bevel=0.0)
    rebar = Part(flat_material('iron-rust', (0.18, 0.09, 0.05), 0.85, 0.3), bevel=0.0)
    stains = Part(flat_material('soot', (0.05, 0.05, 0.05), 0.95), bevel=0.0)
    standing = Matrix.Translation(Vector((0, 0, height)))
    deck(concrete, asphalt, standing, -26.0, -3.0, width, rnd, broken_end=-3.0, rebar=rebar)
    for x in (-22.0, -10.0):
        box(concrete, x, 0, -1.0, 1.8, 3.4, height - 1.0)
        box(concrete, x, 0, height - 2.6, 2.4, width * 0.7, 0.7)
    # Fallen span: the far end still on its pillar's cap, the near end on the ground
    far, near = Vector((24.0, 0, height - 0.6)), Vector((1.0, 0.8, 0.9))
    d = far - near
    m = Matrix.Translation(near) @ Matrix.Rotation(math.atan2(d.y, d.x), 4, 'Z') @ Matrix.Rotation(-math.atan2(d.z, math.hypot(d.x, d.y)), 4, 'Y') \
        @ Matrix.Rotation(math.radians(6), 4, 'X')
    deck(concrete, asphalt, m, 0.0, d.length, width, rnd, broken_end=0.0, rebar=rebar)
    box(concrete, 24.0, 0, -1.0, 1.8, 3.4, height - 1.0 - 1.2)
    # Snapped pillar between them, its top lying beside it
    box(concrete, 8.0, 0, -1.0, 1.8, 3.4, 4.6)
    for k in range(5):
        a = Vector((8.0 + rnd.uniform(-0.7, 0.7), rnd.uniform(-1.4, 1.4), 3.6))
        oriented_box(rebar, a, a + Vector((rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), rnd.uniform(0.6, 1.4))), 0.05)
    top = Matrix.Translation(Vector((10.5, -3.5, 0.9))) @ Matrix.Rotation(math.radians(80), 4, 'Y') @ Matrix.Rotation(0.4, 4, 'Z')
    placed_box(concrete, top, 0, 0, -0.9, 3.4, 1.8, 1.8)
    # Rubble heaps under the break, soot below them
    for k, (c, r) in enumerate(((Vector((-2.0, 0, -0.4)), 2.6), (Vector((2.5, -2.5, -0.4)), 2.0), (Vector((8.0, 2.4, -0.4)), 1.6))):
        lump(concrete, c, Vector((r, r * 0.8, r * 0.45)), seed + k, roughness=0.5, subdiv=2)
        for j in range(5):
            a = rnd.uniform(0, math.tau)
            p = c + Vector((math.cos(a), math.sin(a), 0)) * rnd.uniform(r, r * 1.8)
            box(concrete, p.x, p.y, -0.2, rnd.uniform(0.6, 1.6), rnd.uniform(0.5, 1.2), rnd.uniform(0.3, 0.7), rnd.uniform(0, 3))
    for c in (Vector((-1.0, 0.5, 0.03)), Vector((3.0, -2.0, 0.03))):
        stains.quad([c + Vector((-3, -3, 0)), c + Vector((3, -3, 0)), c + Vector((3, 3, 0)), c + Vector((-3, 3, 0))],
                    [(0, 0), (1, 0), (1, 1), (0, 1)])
    objects = [concrete.to_object(name), asphalt.to_object(name + '-asphalt'), rebar.to_object(name + '-rebar'),
               stains.to_object(name + '-soot')]
    export(name, objects, lod=700)


# ---------------------------------------------------------------- desert

def rock_arch_large(name, seed=43, span=26.0, rise=17.0):
    """A natural arch a road runs under: two massive weathered legs flaring at the foot and a thick, flat
    topped span about 13 m clear above the ground, swept along a half ellipse with a blocky cross section,
    its faces pitted and stepped by noise, banded sandstone; boulders fallen from it at the feet. Front -Y,
    the road runs along Y"""
    clear_scene()
    rnd = random.Random(seed)
    rock = Part(pbr_material('rock-cliff_side', 'cliff_side'), uv_metres=6.0, smooth=True, bevel=0.0)
    off = Vector((seed * 1.1, seed * 0.7, 2.0))
    n, sides = 30, 12
    # Cross section: a rounded block, deeper (along Y) than thick, its outline the same along the arch
    outline = []
    for k in range(sides):
        a = k / sides * math.tau
        c, s_ = math.cos(a), math.sin(a)
        r = 1.0 / max(abs(c), abs(s_)) ** 0.6
        outline.append((c * r * rnd.uniform(0.9, 1.1), s_ * r * rnd.uniform(0.9, 1.1)))
    rings = []
    for k in range(n + 1):
        t = k / n * math.pi
        centre = Vector((-math.cos(t) * span / 2, 0, math.sin(t) * rise - 3.0 * (1 - math.sin(t))))
        tangent = Vector((math.sin(t) * span / 2, 0, math.cos(t) * (rise + 3.0))).normalized()
        across = Vector((0, 1, 0))
        normal = tangent.cross(across).normalized()
        foot = (1.0 - math.sin(t)) ** 2
        thick = 2.4 + 2.6 * foot
        deep = 3.6 + 3.0 * foot
        ring = []
        for cx, cy in outline:
            p = centre + normal * cx * thick + across * cy * deep
            d = noise.noise(p * 0.22 + off) * 0.9 + noise.noise(p * 0.7 + off) * 0.25
            p = p + (p - centre).normalized() * d
            ring.append(rock.bm.verts.new(p))
        rings.append(ring)
    for k in range(n):
        for j in range(sides):
            a, b = rings[k][j], rings[k][(j + 1) % sides]
            c, d = rings[k + 1][(j + 1) % sides], rings[k + 1][j]
            f = rock.bm.faces.new((a, b, c, d))
            f.smooth = True
    for k in range(7):
        side = -1 if k % 2 else 1
        lump(rock, Vector((side * rnd.uniform(span / 2 - 1, span / 2 + 5), rnd.uniform(-7, 7), -0.6)),
             Vector((rnd.uniform(1.2, 2.6), rnd.uniform(1.0, 2.2), rnd.uniform(0.8, 1.8))), seed * 10 + k, roughness=0.35, subdiv=2)
    export(name, [smooth(rock.to_object(name))], lod=600)

def models():
    return {
        'tunnel-portal': lambda: tunnel_portal('tunnel-portal'),
        'tunnel-portal-concrete': lambda: tunnel_portal('tunnel-portal-concrete', concrete=True, seed=2),
        'castle-ruin': lambda: castle_ruin('castle-ruin'),
        'glacier': lambda: glacier('glacier'),
        'seracs': lambda: seracs('seracs'),
        'snowfield': lambda: snowfield('snowfield'),
        'avalanche-barrier': lambda: avalanche_barrier('avalanche-barrier'),
        'avalanche-barrier-snow': lambda: avalanche_barrier('avalanche-barrier-snow', snowed=True),
        'shipwreck': lambda: shipwreck('shipwreck'),
        'rocket': lambda: rocket('rocket'),
        'obsidian-tower': lambda: obsidian_tower('obsidian-tower'),
        'floodlight-mast': lambda: floodlight_mast('floodlight-mast'),
        'beacon-post': lambda: beacon_post('beacon-post'),
        'bell-tower': lambda: bell_tower('bell-tower'),
        'bell-tower-snow': lambda: bell_tower('bell-tower-snow', snow=True),
        'stone-circle': lambda: stone_circle('stone-circle'),
        'trebuchet': lambda: trebuchet('trebuchet'),
        'highway-collapsed': lambda: highway_collapsed('highway-collapsed'),
        'rock-arch-large': lambda: rock_arch_large('rock-arch-large'),
    }
