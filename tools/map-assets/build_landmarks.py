"""Landmarks of the map asset catalogue (loaded by build_models.py).

Tunnel portals for roads through a hill (an old stone one, a modern
concrete one with lamps; the road runs in along +Y), a castle ruin on its
own as a landmark, a glacier tongue and a serac field, avalanche barriers
(steel snow bridges, bare and snowed in), a shipwreck stranded on its
side, and a rocket with its launch tower. Built from Poly Haven textures
and the shared builders; every piece gets baked AO and a flat-coloured
copy for distance.
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


def export(name, objects, lod=None):
    """Baked AO, then a flat-coloured copy with `lod` triangles for distance"""
    obj = finish(name, objects)
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
    back, rock of the hill around and above. Stone: a masonry façade with voussoirs, a keystone and a cornice.
    Concrete: a flatter arch under a projecting hood, lamps along the vault"""
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
        # Hood: a projecting slab over the mouth on two side piers
        box(trim, 0, -0.9, crown + 0.5, half * 2 + 3.0, 2.2, 0.8)
        for s in (-1, 1):
            box(trim, s * (half + 0.9), -0.9, -0.3, 1.2, 2.2, crown + 0.8)
        box(trim, 0, -0.2, top - 0.2, front_w + 0.4, thick + 1.2, 0.5)
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
    hillside(rock, front_w + 6.0, top + 2.0, deep + 6.0, seed * 10, rnd)
    for k in range(6):
        s = -1 if k % 2 else 1
        lump(rock, Vector((s * rnd.uniform(front_w / 2 + 2.5, front_w / 2 + 6.0), rnd.uniform(-5.0, -1.0), -0.6)),
             Vector((rnd.uniform(0.6, 1.4), rnd.uniform(0.5, 1.1), rnd.uniform(0.4, 0.9))), seed * 10 + 20 + k, subdiv=2)
    objects = [wall.to_object(name), trim.to_object(name + '-trim'), inner.to_object(name + '-inner'), dark.to_object(name + '-dark'),
               smooth(rock.to_object(name + '-rock'))]
    if concrete:
        objects.append(lamps.to_object(name + '-lamps'))
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
    # Merlons left on the standing front of the keep
    merlons(stone, -s / 2, s / 2 - 3.0, ky - s / 2 + t / 2, h - 0.2, t, width=1.0, gap=0.8, height=1.2)
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
    merlons(stone, gx - 4.4, gx - 2.0, -12.5, 11.5, 0.6, width=0.8, gap=0.6)
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

def ice_part(tint=(0.72, 0.86, 1.0), name='glacier-ice', uv=6.0, smooth_faces=True):
    """Glacier ice: the snow texture tinted blue"""
    return Part(pbr_material(name, 'snow_02', tint), uv_metres=uv, smooth=smooth_faces, bevel=0.0)


def snow_cover(uv=5.0):
    return Part(pbr_material('snow-snow_02', 'snow_02', (1.05, 1.05, 1.08)), uv_metres=uv, smooth=True, bevel=0.0)


def ice_block(part, base, size, turn, lean, rnd):
    """A serac: a tilted ice block, a smaller one broken off on its top; returns its placement"""
    m = Matrix.Translation(base) @ Matrix.Rotation(turn, 4, 'Z') @ Matrix.Rotation(lean[0], 4, 'X') @ Matrix.Rotation(lean[1], 4, 'Y')
    before = len(part.bm.verts)
    box(part, 0, 0, -1.5, size.x, size.y, size.z + 1.5)
    box(part, rnd.uniform(-0.2, 0.2) * size.x, rnd.uniform(-0.2, 0.2) * size.y, size.z - 0.1, size.x * 0.6, size.y * 0.7, size.z * rnd.uniform(0.15, 0.3),
        rnd.uniform(-0.4, 0.4))
    part.bm.verts.ensure_lookup_table()
    for v in part.bm.verts[before:]:
        v.co = m @ v.co
    return m


def glacier(name, seed=12, length=90.0, width=40.0):
    """A glacier tongue climbing along +Y: its snout an ice cliff at the front (-Y) with seracs broken off,
    crevasses across the middle (bare blue ice in the troughs), snow on the flats and the upper part,
    moraine rock along both flanks; it reaches 10 m into the ground, so tilted with a slope (or in a valley
    floor) it shows no gap. Origin at the snout's foot"""
    clear_scene()
    rnd = random.Random(seed)
    ice = ice_part()
    deep = ice_part((0.36, 0.6, 0.92), 'glacier-ice-deep', 4.0, smooth_faces=False)
    deep.bevel = 0.05
    snow = snow_cover()
    rock = Part(pbr_material('rock-' + ROCK, ROCK, GREY), uv_metres=4.0, bevel=0.0)
    nu, nv = 20, 80
    off = Vector((seed * 1.3, seed * 2.1, 0.5))

    def surface(u, v):
        half = width / 2 * (0.6 + 0.4 * v ** 0.6) * (1.0 + 0.15 * noise.noise(Vector((v * 5.0, u * 0.5, 7.0)) + off))
        x = u * half + 3.0 * math.sin(v * 2.4 + 0.5)
        y = v * length
        # Flat across, falling steeply at the flanks; it rises little itself, the slope it lies on does that
        dome = max(0.0, 1.0 - abs(u) ** 3) ** 0.7
        z = (7.0 + 4.0 * v) * dome
        # Crevasses: troughs across the tongue in its middle, bent forward towards the edges
        band = max(0.0, 1.0 - abs(v - 0.45) / 0.28)
        phase = v * length / 7.5 * math.tau + 1.2 * u * u + 0.8 * noise.noise(Vector((u * 2.0, v * 6.0, 0)) + off)
        z -= 3.2 * band * max(0.0, math.cos(phase)) ** 6 * dome
        z += 0.5 * noise.noise(Vector((x * 0.08, y * 0.08, 0)) + off)
        return Vector((x, y, z - 0.5))

    grid = [[surface(-1 + 2 * i / nu, j / nv) for i in range(nu + 1)] for j in range(nv + 1)]
    for j in range(nv):
        for i in range(nu):
            q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
            n = (q[1] - q[0]).cross(q[3] - q[0]).normalized()
            upper = j / nv
            # Snow on the flats, more of it higher up; bare ice on the trough walls and the lowest part
            c = (q[0] + q[2]) / 2
            snowy = n.z > 0.93 and upper > 0.08 and noise.noise(Vector((c.x * 0.06, c.y * 0.04, 3.0)) + off) + upper * 1.4 > 0.15
            (snow if snowy else ice).quad(q, [(0, 0), (1, 0), (1, 1), (0, 1)])
    # Skirt from the rim down into the ground: the snout is a steep ice cliff, leaning out a little
    rim = [grid[0][i] for i in range(nu + 1)] + [grid[j][nu] for j in range(1, nv + 1)] + \
          [grid[nv][i] for i in range(nu - 1, -1, -1)] + [grid[j][0] for j in range(nv - 1, 0, -1)]
    rim.append(rim[0])
    for a, b in zip(rim, rim[1:]):
        drop = Vector((0, 0, -10.0))
        q = [b, a, a + drop + Vector((0, -1.2 if a.y < 1 else 0, 0)), b + drop + Vector((0, -1.2 if b.y < 1 else 0, 0))]
        (deep if a.y < 1 and b.y < 1 else ice).quad(q, [(0, 0), (1, 0), (1, 1), (0, 1)])
    # Seracs broken off at the snout
    for k in range(10):
        x = rnd.uniform(-width * 0.3, width * 0.3)
        size = Vector((rnd.uniform(1.6, 3.2), rnd.uniform(1.4, 2.6), rnd.uniform(1.5, 4.0)))
        ice_block(deep, Vector((x, rnd.uniform(-4.0, -1.5), -0.3)), size, rnd.uniform(0, math.pi),
                  (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3)), rnd)
    # Lateral moraines: rock ridges along both flanks, a terminal one in front
    for s in (-1, 1):
        for k in range(10):
            v = 0.05 + k * 0.09
            p = surface(s * 1.02, v)
            lump(rock, Vector((p.x + s * 1.5, p.y, -1.2)), Vector((rnd.uniform(2.0, 3.5), rnd.uniform(3.5, 5.0), rnd.uniform(1.2, 2.2))),
                 seed * 70 + k + (s + 1) * 20, roughness=0.4, subdiv=2)
    for k in range(5):
        lump(rock, Vector((rnd.uniform(-width * 0.35, width * 0.35), rnd.uniform(-8.5, -6.0), -0.8)),
             Vector((rnd.uniform(1.0, 2.0), rnd.uniform(0.8, 1.5), rnd.uniform(0.5, 1.0))), seed * 90 + k, roughness=0.45, subdiv=2)
    objects = [smooth(ice.to_object(name)), deep.to_object(name + '-deep'), smooth(snow.to_object(name + '-snow')),
               smooth(rock.to_object(name + '-moraine'))]
    export(name, objects, lod=900)


def seracs(name, seed=31):
    """A field of seracs: leaning ice towers and blocks, snow on their tops, for the broken part of a glacier
    or below an ice fall"""
    clear_scene()
    rnd = random.Random(seed)
    ice = ice_part((0.42, 0.66, 0.95), 'glacier-ice-deep', 3.0, smooth_faces=False)
    ice.bevel = 0.08
    snow = snow_cover(3.0)
    snow.bevel = 0.1
    snow.smooth = False
    for k in range(13):
        a = rnd.uniform(0, math.tau)
        r = 0.0 if k == 0 else rnd.uniform(2.5, 7.5)
        h = rnd.uniform(4.0, 9.0) * (1.3 - r / 10.0)
        size = Vector((rnd.uniform(1.8, 3.2), rnd.uniform(1.6, 2.8), h))
        turn = rnd.uniform(0, math.pi)
        lean = (rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25))
        base = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        m = ice_block(ice, base, size, turn, lean, rnd)
        before = len(snow.bm.verts)
        box(snow, 0, 0, size.z - 0.02, size.x + 0.2, size.y + 0.2, 0.35)
        snow.bm.verts.ensure_lookup_table()
        for v in snow.bm.verts[before:]:
            v.co = m @ v.co
    objects = [ice.to_object(name), snow.to_object(name + '-snow')]
    export(name, objects, lod=500)


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


def obsidian_tower(name, seed=41, height=14.0):
    """A tower of volcanic glass for a crater rim: a leaning faceted spire with shards broken off around
    it, standing in dark rock with glowing cracks at its foot"""
    from build_extreme import ember, hell_rock
    from build_levels import obsidian_material
    clear_scene()
    rnd = random.Random(seed)
    glass = Part(obsidian_material())
    rock = hell_rock()
    rock.bevel = 0.0
    glow = Part(ember(1.6), bevel=0.0)
    lean = Vector((rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), 1.0)).normalized()
    pts = [Vector((0, 0, -1.0)), lean * height * 0.45, lean * height * 0.8, lean * height]
    tube(glass, pts, [2.3, 1.7, 0.9, 0.0], 7, smooth=False)
    for k in range(5):
        a = k / 5 * math.tau + rnd.uniform(-0.3, 0.3)
        out = Vector((math.cos(a), math.sin(a), 0))
        d = (out * rnd.uniform(0.25, 0.6) + Vector((0, 0, 1))).normalized()
        h = height * rnd.uniform(0.25, 0.55)
        base = out * rnd.uniform(1.6, 2.6) + Vector((0, 0, -0.8))
        tube(glass, [base, base + d * h * 0.7, base + d * h], [rnd.uniform(0.5, 0.9), rnd.uniform(0.35, 0.6), 0.0], 5, smooth=False)
    for k in range(6):
        a = rnd.uniform(0, math.tau)
        lump(rock, out_at(a, rnd.uniform(2.0, 3.6), -0.6), Vector((rnd.uniform(1.0, 1.8), rnd.uniform(0.8, 1.4), rnd.uniform(0.5, 0.9))),
             seed * 10 + k, roughness=0.4, subdiv=2)
    for k in range(7):
        a = rnd.uniform(0, math.tau)
        c = out_at(a, rnd.uniform(1.0, 3.8), 0.02)
        box(glow, c.x, c.y, c.z - 0.06, rnd.uniform(0.8, 1.8), 0.09, 0.12, a + math.pi / 2 + rnd.uniform(-0.4, 0.4))
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


def models():
    return {
        'tunnel-portal': lambda: tunnel_portal('tunnel-portal'),
        'tunnel-portal-concrete': lambda: tunnel_portal('tunnel-portal-concrete', concrete=True, seed=2),
        'castle-ruin': lambda: castle_ruin('castle-ruin'),
        'glacier': lambda: glacier('glacier'),
        'seracs': lambda: seracs('seracs'),
        'avalanche-barrier': lambda: avalanche_barrier('avalanche-barrier'),
        'avalanche-barrier-snow': lambda: avalanche_barrier('avalanche-barrier-snow', snowed=True),
        'shipwreck': lambda: shipwreck('shipwreck'),
        'rocket': lambda: rocket('rocket'),
        'obsidian-tower': lambda: obsidian_tower('obsidian-tower'),
        'floodlight-mast': lambda: floodlight_mast('floodlight-mast'),
        'beacon-post': lambda: beacon_post('beacon-post'),
        'bell-tower': lambda: bell_tower('bell-tower'),
        'bell-tower-snow': lambda: bell_tower('bell-tower-snow', snow=True),
    }
