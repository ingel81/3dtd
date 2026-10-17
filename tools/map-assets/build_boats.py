"""Working boats of the map asset catalogue (loaded by build_models.py).

The fishing boat is a North Sea cutter in miniature: a lofted carvel hull
with a strong sheer and a cruiser stern, planked bulwarks with a capping
rail, a wheelhouse with framed windows, a mast with crosstree, stays and a
cargo derrick, and the gear of a working deck. Its look is painted, not
tiled: procedural materials (paint over planks, antifouling, rust streaks
from the fittings, algae at the waterline, chipped edges, grime in every
corner) are baked into the boat's own textures (blender_kit.bake_surface),
so the game draws it with one material and no extra shader work.

Model space: bow at -Y, waterline at z = 0 (catalogue `float`).
"""
import math

from mathutils import Vector

from blender_kit import Nodes, Part, bake_surface, box, card_material, clear_scene, export_lod, flat_material, oriented_box, tube

# Hull: length over all, beam, draft and freeboard amidships, sheer rise at bow and stern (metres)
LENGTH = 9.0
BEAM = 3.0
DRAFT = 0.85
FREEBOARD = 0.95
SHEER_BOW = 0.75
SHEER_STERN = 0.28
BULWARK = 0.55
SKIN = 0.07
STATIONS = 30
GIRTH = 12


def station(t):
    """Hull section at `t` (0 bow, 1 stern): half beam at the gunwale, keel and gunwale height, and the
    section's fullness (low: round bilge amidships, high: a sharp V forward)"""
    bow = math.sin(math.pi / 2 * min(1.0, t / 0.42)) ** 0.85
    stern = math.sin(math.pi / 2 * min(1.0, (1 - t) / 0.22)) ** 0.55
    half = BEAM / 2 * max(0.015, bow * stern)
    gunwale = FREEBOARD + SHEER_BOW * max(0.0, 1 - t / 0.55) ** 2 + SHEER_STERN * max(0.0, (t - 0.6) / 0.4) ** 2
    keel = -DRAFT + 0.12 * ((t - 0.55) / 0.45) ** 2
    if t < 0.16:
        # The stem curves up into the bow
        keel += (gunwale + DRAFT - 0.1) * (1 - t / 0.16) ** 2.2
    if t > 0.86:
        # The cruiser stern lifts its bottom out of the water
        keel += 0.85 * ((t - 0.86) / 0.14) ** 2
    full = 0.55 + 0.6 * max(0.0, 1 - t / 0.35)
    return half, keel, gunwale, full


def hull_point(t, u):
    """Point on the starboard-positive half of the hull: `u` from the keel (0) to the gunwale (1)"""
    half, keel, gunwale, full = station(t)
    x = half * math.sin(u * math.pi / 2) ** full * (1 + 0.12 * u * u * max(0.0, 1 - t / 0.4))
    return x, -LENGTH / 2 + t * LENGTH, keel + (gunwale - keel) * u ** 1.25


def deck_height(t):
    return station(t)[2] - BULWARK


def half_width_at(t, z):
    """Half the hull's outer width at height `z` at `t`; None where the bottom stands higher"""
    half, keel, gunwale, full = station(t)
    if z <= keel or gunwale <= keel:
        return None
    u = min(1.0, ((z - keel) / (gunwale - keel)) ** (1 / 1.25))
    return hull_point(t, u)[0]


def stations():
    """Station positions, closer at the ends where the hull curves most"""
    return [0.5 - 0.5 * math.cos(math.pi * i / (STATIONS - 1)) for i in range(STATIONS)]


def at_y(y):
    return (y + LENGTH / 2) / LENGTH


def hull_shell(part):
    """The outer skin from keel to gunwale, both sides; UVs in metres (u along the boat, v round the girth
    from the keel), so the paint's plank seams follow the hull's lines"""
    bm = part.bm
    ts = stations()
    for side in (1, -1):
        rings = []
        for t in ts:
            ring, arc, prev = [], 0.0, None
            for k in range(GIRTH + 1):
                x, y, z = hull_point(t, k / GIRTH)
                p = Vector((x * side, y, z))
                if prev is not None:
                    arc += (p - prev).length
                ring.append((bm.verts.new(p), arc))
                prev = p
            rings.append(ring)
        for i in range(len(ts) - 1):
            for k in range(GIRTH):
                quad = [rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]]
                if side < 0:
                    quad.reverse()
                f = bm.faces.new([v for v, _ in quad])
                for loop, (v, arc) in zip(f.loops, quad):
                    loop[part.uv].uv = (v.co.y, arc)
    bmesh_merge(bm)


def bmesh_merge(bm):
    import bmesh
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.004)


def bulwark_inside(part):
    """The bulwark's inner face from the deck up to the gunwale, and the strip that closes it at the top"""
    bm = part.bm
    ts = [t for t in stations() if 0.01 < t < 0.99]
    for side in (1, -1):
        rows = []
        for t in ts:
            _, _, gunwale, _ = station(t)
            low = half_width_at(t, deck_height(t))
            top = hull_point(t, 1.0)[0]
            if low is None:
                continue
            y = -LENGTH / 2 + t * LENGTH
            rows.append((Vector((side * max(0.0, low - SKIN), y, deck_height(t))), Vector((side * max(0.0, top - SKIN), y, gunwale)),
                         Vector((side * top, y, gunwale))))
        for a, b in zip(rows, rows[1:]):
            for k in range(2):
                quad = [a[k], a[k + 1], b[k + 1], b[k]]
                if side > 0:
                    quad.reverse()
                part.quad(quad, [(q.y, q.z + k) for q in quad])


def hull_deck(part):
    """The deck between the bulwarks, following the sheer"""
    ts = [t for t in stations() if 0.02 < t < 0.98]
    rows = []
    for t in ts:
        w = half_width_at(t, deck_height(t))
        if w is None or w - SKIN < 0.05:
            continue
        y = -LENGTH / 2 + t * LENGTH
        rows.append([Vector((x, y, deck_height(t))) for x in (-(w - SKIN), -(w - SKIN) / 2, 0.0, (w - SKIN) / 2, w - SKIN)])
    for a, b in zip(rows, rows[1:]):
        for k in range(4):
            part.quad([a[k], a[k + 1], b[k + 1], b[k]], [(a[k].x, a[k].y), (a[k + 1].x, a[k + 1].y), (b[k + 1].x, b[k + 1].y), (b[k].x, b[k].y)])


def along_hull(u, out, lo=0.02, hi=0.98, side=1, steps=24):
    """Points along the hull at girth fraction `u`, pushed `out` metres outwards"""
    pts = []
    for i in range(steps + 1):
        t = lo + (hi - lo) * i / steps
        x, y, z = hull_point(t, u)
        pts.append(Vector((side * (x + out), y, z)))
    return pts


def keel(part):
    """Keel along the bottom, the stem post up the bow, a rudder behind the stern"""
    for t0, t1 in zip([0.08 + 0.84 * i / 12 for i in range(12)], [0.08 + 0.84 * (i + 1) / 12 for i in range(12)]):
        _, k0, _, _ = station(t0)
        _, k1, _, _ = station(t1)
        y0, y1 = -LENGTH / 2 + t0 * LENGTH, -LENGTH / 2 + t1 * LENGTH
        a, b = Vector((0, y0, k0 - 0.18)), Vector((0, y1, k1 - 0.18))
        c, d = Vector((0, y1, k1 + 0.05)), Vector((0, y0, k0 + 0.05))
        for x in (-0.06, 0.06):
            q = [p + Vector((x, 0, 0)) for p in (a, b, c, d)]
            part.quad(q if x > 0 else list(reversed(q)), [(p.y, p.z) for p in q])
        part.quad([a + Vector((-0.06, 0, 0)), a + Vector((0.06, 0, 0)), b + Vector((0.06, 0, 0)), b + Vector((-0.06, 0, 0))],
                  [(0, a.y), (0.12, a.y), (0.12, b.y), (0, b.y)])
    stem = [Vector((0, -LENGTH / 2 + t * LENGTH, station(t)[1] - 0.02)) for t in (0.0, 0.03, 0.07, 0.12)]
    stem[0].z = station(0.0)[2] + 0.08
    tube(part, stem, [0.07, 0.08, 0.08, 0.07], 6, smooth=True)
    # Rudder: a blade on its post under the counter, aft of where the keel ends
    t = 0.9
    y = -LENGTH / 2 + t * LENGTH
    top = station(t)[1]
    box(part, 0, y + 0.3, -DRAFT + 0.12, 0.07, 0.55, top + DRAFT - 0.1)
    tube(part, [Vector((0, y + 0.03, -DRAFT + 0.12)), Vector((0, y + 0.03, top + 0.1))], [0.045, 0.045], 6)


def wheelhouse_geometry(walls, roof, trim, glass, metal):
    """Planked wheelhouse on the after deck: framed windows (three forward, two a side, one aft, a door
    to starboard), a cambered roof with a visor over the front windows, rail, searchlight and horn.
    Returns its floor height and the roof's top"""
    y0, y1, w, h = -0.15, 2.25, 2.1, 1.95
    floor = deck_height(at_y((y0 + y1) / 2)) - 0.02
    box(walls, 0, (y0 + y1) / 2, floor, w, y1 - y0, h)
    top = floor + h
    # Roof: cambered boards over the walls, overhanging, a visor forward
    for k in range(6):
        x = -1.25 + (k + 0.5) * 2.5 / 6
        lift = 0.07 * (1 - (x / 1.25) ** 2)
        box(roof, x, (y0 + y1) / 2 - 0.15, top + lift, 2.5 / 6 + 0.005, y1 - y0 + 0.6, 0.07)
    # Corner posts and a band under the eaves
    for x in (-w / 2, w / 2):
        for y in (y0, y1):
            box(trim, x, y, floor, 0.1, 0.1, h)
    box(trim, 0, y0 - 0.02, top - 0.14, w + 0.1, 0.06, 0.12)
    box(trim, 0, y1 + 0.02, top - 0.14, w + 0.1, 0.06, 0.12)
    for x in (-w / 2 - 0.02, w / 2 + 0.02):
        box(trim, x, (y0 + y1) / 2, top - 0.14, 0.06, y1 - y0 + 0.1, 0.12)
    sill = floor + 1.05

    def window(cx, cy, sx, sy, height=0.6):
        """Glass a little proud of the wall in a frame of four strips"""
        box(glass, cx, cy, sill, sx, sy, height)
        t = 0.06
        if sx > sy:
            box(trim, cx, cy, sill - t, sx + 2 * t, sy + 0.04, t)
            box(trim, cx, cy, sill + height, sx + 2 * t, sy + 0.04, t)
            for x in (cx - sx / 2 - t / 2, cx + sx / 2 + t / 2):
                box(trim, x, cy, sill, t, sy + 0.04, height)
        else:
            box(trim, cx, cy, sill - t, sx + 0.04, sy + 2 * t, t)
            box(trim, cx, cy, sill + height, sx + 0.04, sy + 2 * t, t)
            for y in (cy - sy / 2 - t / 2, cy + sy / 2 + t / 2):
                box(trim, cx, y, sill, sx + 0.04, t, height)

    for x in (-0.66, 0.0, 0.66):
        window(x, y0 - 0.005, 0.52, 0.03)
    for s in (-1, 1):
        for y in ((0.35, 1.25) if s > 0 else (0.35,)):
            window(s * (w / 2 + 0.005), y, 0.03, 0.62)
    window(0.45, y1 + 0.005, 0.5, 0.03, 0.5)
    # Door to starboard (-x), a step and a handle
    box(trim, -w / 2 - 0.02, 1.45, floor + 0.05, 0.05, 0.72, 1.75)
    box(walls, -w / 2 - 0.04, 1.45, floor + 0.12, 0.03, 0.56, 1.55)
    box(metal, -w / 2 - 0.08, 1.7, floor + 0.95, 0.05, 0.05, 0.16)
    box(walls, -w / 2 - 0.25, 1.45, floor - 0.02, 0.4, 0.7, 0.08)
    # Rail round the roof on stanchions
    corners = [Vector((-1.15, y0 - 0.35, top + 0.07)), Vector((1.15, y0 - 0.35, top + 0.07)), Vector((1.15, y1 + 0.1, top + 0.07)),
               Vector((-1.15, y1 + 0.1, top + 0.07))]
    for a, b in zip(corners, corners[1:] + corners[:1]):
        tube(metal, [a + Vector((0, 0, 0.32)), b + Vector((0, 0, 0.32))], [0.022, 0.022], 6)
        n = max(2, int((b - a).length / 0.8))
        for k in range(n):
            p = a.lerp(b, k / n)
            tube(metal, [p, p + Vector((0, 0, 0.33))], [0.02, 0.02], 5)
    # Searchlight on its pedestal forward, a horn beside it
    tube(metal, [Vector((0.6, y0 - 0.05, top + 0.08)), Vector((0.6, y0 - 0.05, top + 0.32))], [0.04, 0.04], 6)
    tube(metal, [Vector((0.6, y0 + 0.08, top + 0.42)), Vector((0.6, y0 - 0.2, top + 0.42))], [0.11, 0.13], 10, cap=True)
    tube(metal, [Vector((-0.5, y0 + 0.1, top + 0.22)), Vector((-0.5, y0 - 0.25, top + 0.24))], [0.025, 0.09], 8)
    return floor, top, y0, y1


def mast_geometry(spar, metal, rope, top):
    """Mast forward of the hatch with crosstree and masthead light, a derrick topped up over the foredeck,
    forestay, shrouds and a backstay to the wheelhouse"""
    y = -1.75
    foot = deck_height(at_y(y))
    head = foot + 5.95
    tube(spar, [Vector((0, y, foot - 0.05)), Vector((0, y, head))], [0.11, 0.075], 10, cap=True)
    cross = foot + 4.4
    oriented_box(spar, Vector((-0.65, y, cross)), Vector((0.65, y, cross)), 0.07)
    tube(metal, [Vector((0, y, head)), Vector((0, y, head + 0.12))], [0.04, 0.03], 6, cap=True)
    # Derrick: heel on a gooseneck, head topped up forward with a lift and a cargo whip with its hook
    heel = Vector((0, y - 0.12, foot + 1.25))
    boom_head = Vector((0, -3.55, foot + 3.0))
    tube(spar, [heel, boom_head], [0.07, 0.05], 8, cap=True)
    box(metal, 0, y - 0.1, foot + 1.15, 0.2, 0.16, 0.2)
    lift_from = Vector((0, y - 0.08, cross + 0.4))
    tube(rope, [lift_from, boom_head], [0.018, 0.018], 4)
    hook = boom_head + Vector((0, 0, -1.6))
    tube(rope, [boom_head, hook], [0.015, 0.015], 4)
    box(metal, 0, hook.y, hook.z - 0.18, 0.1, 0.06, 0.2)
    # Standing rigging
    stem_head = Vector((0, -LENGTH / 2 + 0.05, station(0.0)[2] + 0.05))
    tube(rope, [Vector((0, y, head - 0.15)), stem_head], [0.016, 0.016], 4)
    for s in (-1, 1):
        t = at_y(y + 0.35)
        x, yy, z = hull_point(t, 1.0)
        tube(rope, [Vector((s * 0.6, y, cross)), Vector((s * (x - 0.03), yy, z))], [0.016, 0.016], 4)
        tube(rope, [Vector((0, y, cross + 0.05)), Vector((s * (x - 0.03), yy + 0.3, z))], [0.014, 0.014], 4)
    tube(rope, [Vector((0, y, head - 0.2)), Vector((0, -0.1, top + 0.1))], [0.016, 0.016], 4)
    return head


def deck_gear(metal, wood, rope, rubber, blue, orange):
    """Windlass and anchor at the bow, bollards, the fish hold's hatch, fish boxes, tyres as fenders, a net
    drum aft, buoys and a life ring"""
    # Windlass on the foredeck, the anchor at the starboard bow
    y = -3.35
    d = deck_height(at_y(y))
    box(metal, 0, y, d, 0.5, 0.35, 0.3)
    tube(metal, [Vector((-0.55, y, d + 0.3)), Vector((0.55, y, d + 0.3))], [0.11, 0.11], 10, cap=True)
    t = at_y(-3.9)
    x, ya, z = hull_point(t, 0.86)
    shank_top = Vector((-(x + 0.08), ya, z + 0.02))
    oriented_box(metal, shank_top, shank_top + Vector((-0.04, 0.05, -0.7)), 0.07)
    crown = shank_top + Vector((-0.04, 0.05, -0.72))
    for s in (-1, 1):
        oriented_box(metal, crown, crown + Vector((-0.06, s * 0.28, 0.22)), 0.09)
    # Bollards: a pair at the bow, a pair a side aft
    for bx, by in ((0.35, -3.9), (-0.35, -3.9), (0.75, 3.4), (-0.75, 3.4)):
        bd = deck_height(at_y(by))
        for k in (-0.11, 0.11):
            tube(metal, [Vector((bx, by + k, bd)), Vector((bx, by + k, bd + 0.24))], [0.06, 0.06], 8, cap=True)
        box(metal, bx, by, bd, 0.18, 0.4, 0.05)
    # Fish hold hatch between mast and wheelhouse, its cover in boards
    hy = -0.85
    hd = deck_height(at_y(hy))
    box(wood, 0, hy, hd, 1.3, 1.05, 0.32)
    for k in range(5):
        box(wood, -0.52 + k * 0.26, hy, hd + 0.32, 0.24, 1.1, 0.05)
    # Fish boxes stacked beside the hatch
    for k, (bx, by, bz) in enumerate(((0.95, -1.05, 0), (0.95, -0.55, 0), (0.95, -0.8, 1), (-0.95, -0.3, 0), (-0.95, -0.8, 0))):
        part = blue if k % 3 else orange
        z0 = deck_height(at_y(by)) + bz * 0.27
        box(part, bx, by, z0, 0.42, 0.46, 0.26, 0.04 * (k - 2))
    # Car tyres as fenders on short ropes over the rail, two a side
    for s in (-1, 1):
        for fy in (-1.1, 1.0):
            t = at_y(fy)
            x, _, gz = hull_point(t, 1.0)
            c = Vector((s * (half_width_at(t, gz - 0.55) + 0.11), fy, gz - 0.55))
            torus(rubber, c, Vector((s, 0, 0)), 0.24, 0.09, 14, 6)
            tube(rope, [Vector((s * (x + 0.02), fy, gz + 0.04)), c + Vector((0, 0, 0.3))], [0.015, 0.015], 4)
    # Net drum on the after deck
    ny = 3.0
    nd = deck_height(at_y(ny))
    for s in (-1, 1):
        box(metal, s * 0.62, ny, nd, 0.08, 0.5, 0.7)
    tube(rope, [Vector((-0.58, ny, nd + 0.55)), Vector((0.58, ny, nd + 0.55))], [0.3, 0.3], 14, cap=True)
    for s in (-1, 1):
        tube(metal, [Vector((s * 0.6, ny, nd + 0.55)), Vector((s * 0.56, ny, nd + 0.55))], [0.38, 0.38], 14, cap=True)
    return ny


def torus(part, centre, axis, radius, thickness, segments, sides):
    """A ring about `axis` (tyres, life rings)"""
    bm = part.bm
    axis = axis.normalized()
    a = axis.orthogonal().normalized()
    b = axis.cross(a)
    rings = []
    for i in range(segments):
        phi = i / segments * math.tau
        radial = a * math.cos(phi) + b * math.sin(phi)
        ring = []
        for j in range(sides):
            th = j / sides * math.tau
            ring.append(bm.verts.new(centre + radial * (radius + thickness * math.cos(th)) + axis * thickness * math.sin(th)))
        rings.append(ring)
    for i in range(segments):
        for j in range(sides):
            r0, r1 = rings[i], rings[(i + 1) % segments]
            f = bm.faces.new((r0[j], r1[j], r1[(j + 1) % sides], r0[(j + 1) % sides]))
            f.smooth = True
            for loop, (u, v) in zip(f.loops, [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]):
                loop[part.uv].uv = (u / segments * 2, v / sides)


# ---------------------------------------------------------------- materials (baked)

def hull_paint():
    """Red antifouling, a black boot top with a white line, deep blue topsides over carvel planks; chipped
    to primer and bare wood at edges and seams, algae and salt at the waterline, rust bleeding from the
    fittings down the topsides"""
    n = Nodes('boat-hull')
    z = n.axis(2)
    zz = n.math('ADD', z, n.math('MULTIPLY', n.math('SUBTRACT', n.noise(3.0, 2), 0.5), 0.05))
    girth = n.uv(1)
    along = n.uv(0)
    strake = n.math('FRACT', n.math('DIVIDE', girth, 0.19))
    seam = n.ramp(n.math('ABSOLUTE', n.math('SUBTRACT', strake, 0.5)), 0.44, 0.5)
    butt = n.ramp(n.math('ABSOLUTE', n.math('SUBTRACT', n.math('FRACT', n.math('DIVIDE', n.math('ADD', along,
                  n.math('MULTIPLY', n.math('FLOOR', n.math('DIVIDE', girth, 0.19)), 1.37)), 3.1)), 0.5)), 0.493, 0.5)
    joints = n.math('MAXIMUM', seam, butt)
    topside = (0.028, 0.075, 0.14)
    colour = n.mix(n.ramp(zz, 0.0, -0.02), topside, (0.30, 0.06, 0.04))
    colour = n.mix(n.math('MULTIPLY', n.ramp(zz, -0.03, -0.01), n.ramp(zz, 0.14, 0.12)), colour, (0.025, 0.024, 0.022))
    colour = n.mix(n.math('MULTIPLY', n.ramp(zz, 0.13, 0.145), n.ramp(zz, 0.2, 0.185)), colour, (0.62, 0.6, 0.54))
    # Each strake a touch different: repainted boards, sun-bleached ones
    plank = n.noise(0.9, 1, stretch=(1, 0.15, 6))
    colour = n.mix(n.math('MULTIPLY', n.math('SUBTRACT', plank, 0.5), 0.6), colour, (0.09, 0.12, 0.15), 'LINEAR_LIGHT')
    # Salt and dried spray streaking down the topsides
    salt = n.ramp(n.noise(2.0, 3, stretch=(14, 14, 0.7)), 0.6, 0.72)
    colour = n.mix(n.math('MULTIPLY', salt, n.math('MULTIPLY', 0.35, n.ramp(zz, 0.2, 0.5))), colour, (0.5, 0.52, 0.5))
    # Rust from hawse, scuppers and chain plates: thin runs under a few points along the deck line
    source = n.ramp(n.voronoi(0.55, stretch=(1, 1, 0.02)), 0.16, 0.05)
    runs = n.ramp(n.noise(4.0, 2, stretch=(10, 10, 0.25)), 0.5, 0.62)
    rust = n.math('MULTIPLY', n.math('MULTIPLY', source, runs), n.ramp(zz, 0.15, 0.75))
    colour = n.mix(n.math('MULTIPLY', rust, 0.85), colour, (0.24, 0.085, 0.03))
    # Chips: paint gone at edges, along seams and at random knocks; primer round them, wood inside
    knocks = n.noise(5.0, 8, 0.65)
    wear = n.math('ADD', n.math('ADD', knocks, n.math('MULTIPLY', n.edges(0.03), 0.35)), n.math('MULTIPLY', joints, 0.12))
    wear = n.math('MULTIPLY', wear, n.ramp(zz, -0.05, 0.25))
    chips = n.ramp(wear, 0.7, 0.72)
    primer = n.math('SUBTRACT', n.ramp(wear, 0.66, 0.68), chips, clamp=True)
    wood = n.image('weathered_planks', metres=1.2, tint=(0.75, 0.68, 0.6))
    colour = n.mix(primer, colour, (0.34, 0.2, 0.15))
    colour = n.mix(chips, colour, wood)
    # Algae and weed in a ragged band at the waterline, slime below it
    algae = n.math('MULTIPLY', n.ramp(zz, 0.4, -0.02), n.ramp(n.noise(3.0, 5), 0.35, 0.6))
    colour = n.mix(n.math('MULTIPLY', algae, 0.8), colour, (0.07, 0.085, 0.035))
    colour = n.mix(n.math('MULTIPLY', n.math('MULTIPLY', n.hollows(0.3), 0.6), 1.0), colour, (0.02, 0.018, 0.015))
    colour = n.mix(n.math('MULTIPLY', joints, 0.6), colour, (0.015, 0.014, 0.012))
    rough = n.mixf(n.ramp(zz, 0.0, -0.02), 0.42, 0.85)
    rough = n.mixf(n.math('MAXIMUM', chips, algae), rough, 0.9)
    rough = n.mixf(rust, rough, 0.8)
    height = n.math('SUBTRACT', n.math('MULTIPLY', n.math('ADD', chips, primer), 0.4), n.math('MULTIPLY', joints, 1.0))
    height = n.math('ADD', height, n.math('MULTIPLY', n.noise(40.0, 3), 0.15))
    return n.finish(colour, rough, n.bump(height, 0.35, 0.01))


def deck_wood():
    """Deck planks gone grey, darker where water stands and in every corner, fish scales and oil stains"""
    n = Nodes('boat-deck')
    wood = n.image('weathered_planks', metres=1.3, tint=(0.8, 0.75, 0.68))
    colour = n.mix(n.math('MULTIPLY', n.hollows(0.35), 0.75), wood, (0.05, 0.04, 0.03))
    stains = n.ramp(n.noise(1.2, 4), 0.55, 0.7)
    colour = n.mix(n.math('MULTIPLY', stains, 0.5), colour, (0.08, 0.07, 0.05))
    scales = n.ramp(n.noise(30.0, 2), 0.72, 0.78)
    colour = n.mix(n.math('MULTIPLY', scales, n.ramp(n.noise(1.5, 2), 0.55, 0.65)), colour, (0.5, 0.52, 0.5))
    rough = n.mixf(stains, 0.85, 0.55)
    return n.finish(colour, rough, n.bump(n.noise(25.0, 4, stretch=(1, 0.15, 1)), 0.25, 0.01))


def painted_boards(name, paint, boards=0.12, dirt=(0.12, 0.1, 0.07)):
    """Painted tongue-and-groove boards: seams down the wall, paint worn off at the edges to the wood, dirt
    rising from the deck, rust tears under the window corners"""
    n = Nodes(name)
    x, y, z = n.axis(0), n.axis(1), n.axis(2)
    across = n.math('ADD', x, y)
    seam = n.ramp(n.math('ABSOLUTE', n.math('SUBTRACT', n.math('FRACT', n.math('DIVIDE', across, boards)), 0.5)), 0.44, 0.5)
    shade = n.math('MULTIPLY', n.math('SUBTRACT', n.noise(1.0, 1, stretch=(4, 4, 0.1)), 0.5), 0.3)
    colour = n.mix(n.math('ABSOLUTE', shade), paint, tuple(c * 0.7 for c in paint))
    wear = n.math('ADD', n.noise(6.0, 8, 0.65), n.math('MULTIPLY', n.edges(0.025), 0.45))
    chips = n.ramp(wear, 0.72, 0.74)
    colour = n.mix(chips, colour, n.image('weathered_planks', metres=1.0, tint=(0.7, 0.62, 0.52)))
    tears = n.math('MULTIPLY', n.ramp(n.noise(5.0, 2, stretch=(12, 12, 0.3)), 0.55, 0.66), n.ramp(n.voronoi(0.9, stretch=(1, 1, 0.05)), 0.2, 0.06))
    colour = n.mix(n.math('MULTIPLY', tears, 0.6), colour, (0.22, 0.09, 0.035))
    grime = n.math('MULTIPLY', n.ramp(z, deck_height(0.7) + 0.6, deck_height(0.7)), n.ramp(n.noise(2.0, 4), 0.3, 0.7))
    colour = n.mix(n.math('MAXIMUM', grime, n.math('MULTIPLY', n.hollows(0.2), 0.7)), colour, dirt)
    colour = n.mix(n.math('MULTIPLY', seam, 0.55), colour, (0.03, 0.025, 0.02))
    rough = n.mixf(chips, 0.5, 0.85)
    return n.finish(colour, rough, n.bump(n.math('SUBTRACT', n.math('MULTIPLY', chips, 0.3), seam), 0.35, 0.01))


def painted_metal(name, paint, rust_amount=0.55):
    """Painted steel: rust where the paint broke at edges and in blotches, runs below them, bare metal at
    the sharpest knocks"""
    n = Nodes(name)
    wear = n.math('ADD', n.math('MULTIPLY', n.noise(7.0, 8, 0.6), 1.0), n.math('MULTIPLY', n.edges(0.02), 0.5))
    rust = n.ramp(wear, 0.95 - rust_amount * 0.3, 1.0 - rust_amount * 0.3)
    runs = n.math('MULTIPLY', n.ramp(n.noise(6.0, 2, stretch=(8, 8, 0.4)), 0.55, 0.7), 0.6)
    rust_all = n.math('MAXIMUM', rust, n.math('MULTIPLY', runs, rust_amount))
    rust_colour = n.mix(n.noise(14.0, 3), (0.2, 0.07, 0.025), (0.36, 0.15, 0.05))
    colour = n.mix(rust_all, paint, rust_colour)
    colour = n.mix(n.math('MULTIPLY', n.hollows(0.12), 0.6), colour, (0.02, 0.015, 0.01))
    bare = n.ramp(n.math('MULTIPLY', n.edges(0.01), n.noise(20.0, 2)), 0.45, 0.55)
    colour = n.mix(bare, colour, (0.45, 0.45, 0.44))
    rough = n.mixf(rust_all, 0.45, 0.9)
    metal = n.mixf(bare, 0.0, 0.85)
    return n.finish(colour, rough, n.bump(n.math('MULTIPLY', rust_all, 0.5), 0.3, 0.005), metal)


def simple(name, colour, rough=0.6, grime=0.5, grain=0.0):
    """A plain surface with dirt in its hollows and a little mottling: plastics, rope, rubber"""
    n = Nodes(name)
    mottle = n.math('MULTIPLY', n.math('SUBTRACT', n.noise(8.0, 4), 0.5), 0.5)
    c = n.mix(n.math('ABSOLUTE', mottle), colour, tuple(v * 0.6 for v in colour))
    c = n.mix(n.math('MULTIPLY', n.hollows(0.08), grime), c, (0.02, 0.018, 0.015))
    normal = n.bump(n.noise(60.0, 2, stretch=(1, 1, 1)), grain, 0.003) if grain else None
    return n.finish(c, rough, normal)


def fishing_boat(name):
    """Small fishing cutter (see the module's notes), baked surfaces, a textured LOD"""
    clear_scene()
    hull = Part(hull_paint(), smooth=True)
    hull_shell(hull)
    inside = Part(painted_boards('boat-bulwark', (0.56, 0.54, 0.47), boards=0.19), bevel=0.0)
    bulwark_inside(inside)
    deck = Part(deck_wood(), bevel=0.0)
    hull_deck(deck)
    rail = Part(deck_wood(), smooth=False, bevel=0.015)
    for side in (1, -1):
        tube(rail, along_hull(1.0, 0.0, side=side, steps=30), [0.08] * 31, 4, smooth=False)
    strake = Part(painted_boards('boat-strake', (0.36, 0.25, 0.15), boards=2.0), smooth=False, bevel=0.0)
    for side in (1, -1):
        tube(strake, along_hull(0.8, 0.035, 0.03, 0.97, side=side, steps=30), [0.055] * 31, 4, smooth=False)
    keel_part = Part(painted_metal('boat-keel', (0.3, 0.07, 0.045), 0.3), smooth=True, bevel=0.0)
    keel(keel_part)
    walls = Part(painted_boards('boat-wheelhouse', (0.74, 0.71, 0.62)), bevel=0.012)
    roof = Part(painted_boards('boat-roof', (0.24, 0.28, 0.24), boards=0.42, dirt=(0.1, 0.1, 0.08)), bevel=0.01)
    trim = Part(painted_boards('boat-trim', (0.05, 0.16, 0.24), boards=3.0), bevel=0.008)
    metal = Part(painted_metal('boat-metal', (0.035, 0.037, 0.04)), smooth=True, bevel=0.006)
    glass = Part(flat_material('window', (0.04, 0.05, 0.06), 0.15, 0.3))
    floor, top, y0, y1 = wheelhouse_geometry(walls, roof, trim, glass, metal)
    spar = Part(painted_metal('boat-spar', (0.6, 0.58, 0.52), 0.35), smooth=True, bevel=0.0)
    rope = Part(simple('boat-rope', (0.36, 0.3, 0.2), 0.95, 0.3, 0.4), smooth=True)
    mast_geometry(spar, metal, rope, top)
    wood = Part(deck_wood(), bevel=0.01)
    rubber = Part(simple('boat-rubber', (0.03, 0.03, 0.03), 0.92, 0.2, 0.5), smooth=True)
    blue = Part(simple('boat-box-blue', (0.04, 0.17, 0.42), 0.55), bevel=0.02)
    orange = Part(simple('boat-box-orange', (0.75, 0.24, 0.03), 0.55), bevel=0.02)
    red = Part(simple('boat-ring-red', (0.7, 0.06, 0.04), 0.5), smooth=True)
    white = Part(simple('boat-ring-white', (0.75, 0.74, 0.7), 0.5), smooth=True)
    deck_gear(metal, wood, rope, rubber, blue, orange)
    # Life ring on the wheelhouse's after wall, in red and white quarters
    centre = Vector((-0.5, y1 + 0.07, floor + 1.25))
    for k in range(4):
        torus_arc(red if k % 2 else white, centre, Vector((0, 1, 0)), 0.28, 0.06, k * math.pi / 2, (k + 1) * math.pi / 2, 5, 6)
    # Two orange floats and a stack pipe on the roof
    for bx in (-0.7, -0.25):
        tube(orange, [Vector((bx, y1 - 0.4, top + 0.33)), Vector((bx, y1 - 0.4, top + 0.12))], [0.17, 0.17], 12, cap=True)
    tube(metal, [Vector((0.55, y1 - 0.25, top - 0.1)), Vector((0.55, y1 - 0.25, top + 0.95))], [0.09, 0.08], 10, cap=True)
    # Lamps: masthead white, port red and starboard green on the wheelhouse front corners
    lamps = Part(flat_material('lamp-glass-boat', (1.0, 0.92, 0.75), 0.3, emission=(1.0, 0.85, 0.6), strength=1.5))
    box(lamps, 0, -1.75, deck_height(at_y(-1.75)) + 4.5, 0.12, 0.12, 0.16)
    port = Part(flat_material('lamp-glass-port', (0.9, 0.08, 0.05), 0.3, emission=(1.0, 0.05, 0.03), strength=1.5))
    starboard = Part(flat_material('lamp-glass-starboard', (0.05, 0.8, 0.2), 0.3, emission=(0.05, 1.0, 0.25), strength=1.5))
    box(port, 1.12, y0 + 0.2, top - 0.35, 0.08, 0.14, 0.14)
    box(starboard, -1.12, y0 + 0.2, top - 0.35, 0.08, 0.14, 0.14)
    net = Part(card_material('net', 'net.png'))
    up = lambda co: Vector((0, 0, 1))  # noqa: E731
    hz = deck_height(at_y(-0.85)) + 0.38
    net.quad([Vector((-0.75, -1.45, hz)), Vector((0.75, -1.45, hz)), Vector((0.75, -0.25, hz + 0.08)), Vector((-0.75, -0.25, hz + 0.08))],
             [(0, 0), (1.6, 0), (1.6, 1.3), (0, 1.3)], up)
    baked = [o for o in (p.to_object(name + '-' + str(k)) for k, p in enumerate(
        (hull, inside, deck, rail, strake, keel_part, walls, roof, trim, metal, spar, rope, wood, rubber, blue, orange, red, white))) if o.data.polygons]
    keep = [o for o in (glass.to_object(name + '-windows'), lamps.to_object(name + '-lamp'), port.to_object(name + '-port'),
                        starboard.to_object(name + '-starboard'), net.to_object(name + '-net')) if o.data.polygons]
    obj = bake_surface(name, baked, keep, size=1024, samples=32)
    export_lod(name, obj, ratio=0.22, textured=True)


def torus_arc(part, centre, axis, radius, thickness, a0, a1, segments, sides):
    """A part of a ring from angle a0 to a1 about `axis`, its ends closed"""
    bm = part.bm
    axis = axis.normalized()
    a = axis.orthogonal().normalized()
    b = axis.cross(a)
    rings = []
    for i in range(segments + 1):
        phi = a0 + (a1 - a0) * i / segments
        radial = a * math.cos(phi) + b * math.sin(phi)
        rings.append([bm.verts.new(centre + radial * (radius + thickness * math.cos(j / sides * math.tau)) + axis * thickness * math.sin(j / sides * math.tau))
                      for j in range(sides)])
    for i in range(segments):
        for j in range(sides):
            f = bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % sides], rings[i][(j + 1) % sides]))
            f.smooth = True
            for loop, (u, v) in zip(f.loops, [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]):
                loop[part.uv].uv = (u / segments, v / sides)
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])


def models():
    return {
        'fishing-boat': lambda: fishing_boat('fishing-boat'),
    }
