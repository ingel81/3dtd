"""Spawn portal frame: public/assets/models/structures/spawn_portal.glb.

Builds the stone arch round the spawn portals' plane (SpawnPortalManager), bakes
its textures and exports the GLB. Everything is made here, no external
inputs: the blocks from bmesh, the noise from Cycles' procedural textures,
the sigils from tools/blender/spawn_portal_layout.json, which
tools/blender/spawn-portal-layout.spec.ts writes from spawn-portal-sigils.ts
and marker-geometry.config.ts on `npm test`.

Portal space as in the game: x across the street, y up from the ground, z
the way the enemies walk out (the front). Blender is z-up, so the portal
point (x, y, z) lies at (x, -z, y); the glTF exporter turns it back.

Textures (all share one UV set):
  base colour   TEX, JPEG, sRGB
  normal        TEX, JPEG, tangent space (OpenGL), the GLB carries tangents
  occlusion/roughness/metal   TEX_SMALL, JPEG: R ambient occlusion, G roughness, B metal
  emissive      TEX_SMALL, PNG, a data map, not a colour: R how much of each
                carved sigil is left to glow, a smooth mask over its cell (the
                game draws the glow itself from the sigil's distance field), G
                the order its strokes are written in (0 to 1 over a sigil), B
                glowing cracks

Stages (the later ones read the earlier ones' results from WORK):
  build    low-poly frame and UVs
  maps     Cycles bakes of helper maps: position, normal, piece, AO, edges, noise
  compose  numpy: height, base colour, occlusion/roughness/metal, emissive data
  normal   Cycles bake of the normal map from the height
  export   the GLB

The game shades the frame with its own unlit shader (createPortalGateMaterial
in spawn-portal-gate-material.ts), not with Blender's lights: judge the look there.

Headless, without the add-ons of the user's settings (the Blender MCP would open
its server a second time):
    blender --background --factory-startup --python tools/blender/spawn_portal.py -- all
From a running Blender (Blender MCP):
    REPO = r'D:/Source/3dtd'
    exec(open(REPO + '/tools/blender/spawn_portal.py').read()); run('all')
"""
import json
import math
import os
import sys
import zlib

import bmesh
import bpy
import numpy as np
from bpy_extras import bmesh_utils
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

if 'REPO' not in globals():
    REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

LAYOUT = json.load(open(os.path.join(REPO, 'tools/blender/spawn_portal_layout.json')))
OUT_GLB = os.path.join(REPO, 'public/assets/models/structures/spawn_portal.glb')
WORK = os.path.join(REPO, 'tmp/spawn_portal_work')

SEED = 1313
TEX = 2048
TEX_SMALL = 1024
JPEG_QUALITY = 90

# ── Layout (m, scale 1) ──
HALF = LAYOUT['opening']['width'] / 2
OPEN_H = LAYOUT['opening']['height']
FRAME_TOP = LAYOUT['frameTop']
RADIUS = LAYOUT['radius']
# The portal's plane, its void surface, at z = HALF_DEPTH: the enemies start
# HALF_DEPTH behind it and come out through it
DEPTH = LAYOUT['depth']
HALF_DEPTH = DEPTH / 2
SIGIL = LAYOUT['sigil']

BURY = 2.0
PLINTH_TOP = 1.9
LINTEL_TOP = OPEN_H + 3
CORNICE_TOP = LINTEL_TOP + 0.7
PILLAR_TOP = LINTEL_TOP - 0.2
# Pillar courses: as tall as a sigil cell, so no joint runs through a sigil
COURSE_BOTTOM = 2.6
COURSE_H = 1.6
COURSES = 5
# Lintel stones: joints between the sigil columns, leaning out like a flat arch
LINTEL_JOINTS = (-4.0, -2.0, 0.0, 2.0, 4.0)
LINTEL_TILT = 0.05
# Blocks reach this far into their neighbours, so a jitter opens no gap
OVERLAP = 0.02
# A single arch round the plane, GATE_DEPTH deep, its middle in the plane
# (GATE_Z); no walls or roof behind it: the enemies' own shaders drop what
# is still behind the plane (portal-clip.ts in the game)
GATE_DEPTH = 2.6
GATE_Z = HALF_DEPTH
# What the textures read at a depth in portal space (the noise fields, the
# rivets' spacing) they read LOOK_BACK further back, where the arch's middle
# stood when its look was settled (its front face 0.3 m ahead of the plane,
# until 2026-09-17): moved into the plane, the stones kept their look
LOOK_BACK = 1.0

STONE, IRON, HORN = 0, 1, 2
# Role of a piece: GLYPH carries sigils on the arch's front and back face,
# SPIKE is a shard with flutes and breaks
PLAIN, GLYPH, SPIKE = 0, 1, 2

# ── Texture look (linear colours): dark grey-brown basalt, no black; the
# game's frameExposure sets how bright it shows against the tiles ──
BASALT = np.array([0.100, 0.083, 0.068], np.float32)
OBSIDIAN = np.array([0.062, 0.057, 0.060], np.float32)
WORN = np.array([0.260, 0.235, 0.210], np.float32)
SOOT = np.array([0.022, 0.018, 0.016], np.float32)
SCORCH = np.array([0.110, 0.045, 0.020], np.float32)
IRON_COL = np.array([0.075, 0.070, 0.066], np.float32)
RUST = np.array([0.170, 0.075, 0.032], np.float32)
RUST_STAIN = np.array([0.130, 0.060, 0.028], np.float32)
DUST = np.array([0.160, 0.148, 0.132], np.float32)
HORN_BASE = np.array([0.090, 0.066, 0.048], np.float32)
HORN_TIP = np.array([0.040, 0.032, 0.026], np.float32)
# Relief (m)
GLYPH_DEPTH = 0.06
CRACK_DEPTH = 0.03
CHIP_DEPTH = 0.022


def P(x, y, z):
    """Blender point of the portal point (x, y, z)."""
    return Vector((x, -z, y))


def rng_for(*key):
    """A random generator for `key` (ints or names), the same on every run."""
    ints = [zlib.crc32(k.encode()) if isinstance(k, str) else int(k) & 0xFFFFFFFF for k in key]
    return np.random.default_rng([SEED, *ints])


# ════════════════════════════════════════════════════════════════════════
# BUILD
# ════════════════════════════════════════════════════════════════════════

def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)
    for img in list(bpy.data.images):
        if img.name.startswith('sp_'):
            bpy.data.images.remove(img)


def box_corners(x0, y0, z0, w0, d0, x1, y1, z1, w1, d1):
    """Corners of a block from a bottom to a top rectangle, both level:
    bottom (-x,-z), (+x,-z), (+x,+z), (-x,+z), then the top in the same order."""
    out = []
    for (x, y, z, w, d) in ((x0, y0, z0, w0, d0), (x1, y1, z1, w1, d1)):
        out += [(x - w / 2, y, z - d / 2), (x + w / 2, y, z - d / 2),
                (x + w / 2, y, z + d / 2), (x - w / 2, y, z + d / 2)]
    return out


def hexa_bmesh(corners):
    bm = bmesh.new()
    v = [bm.verts.new(P(*c)) for c in corners]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# Edge neighbours of each corner of a hexahedron (see box_corners)
HEXA_NEIGHBOURS = {0: (1, 3, 4), 1: (0, 2, 5), 2: (1, 3, 6), 3: (0, 2, 7),
                   4: (5, 7, 0), 5: (4, 6, 1), 6: (5, 7, 2), 7: (4, 6, 3)}


def chip_corners(bm, corners, picks, rng):
    """Break corners off: a plane through points on the corner's three edges,
    the part beyond it removed and the hole closed."""
    for i in picks:
        c = Vector(P(*corners[i]))
        pts = []
        for j in HEXA_NEIGHBOURS[i]:
            e = Vector(P(*corners[j])) - c
            leg = min(float(rng.uniform(0.12, 0.3)), 0.35 * e.length)
            pts.append(c + e.normalized() * leg)
        no = (pts[1] - pts[0]).cross(pts[2] - pts[0]).normalized()
        if no.dot(c - pts[0]) < 0:
            no = -no
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                               plane_co=pts[0], plane_no=no, clear_outer=True)
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def shard_bmesh(base, rx, rz, base_y, apex, sides, rings, rng, twist=0.25):
    """A jagged spike: a ring of `sides` corners around (base x, z) at base_y,
    a ring at each share of the way to the apex in `rings`, every one a
    little turned, stepped and jittered, so the shard breaks into segments,
    and the apex (portal point)."""
    bm = bmesh.new()
    a0 = float(rng.uniform(0, math.tau))
    ax, ay, az = apex
    loops = [[bm.verts.new(P(base[0] + rx * math.cos(a0 + math.tau * k / sides), base_y,
                             base[1] + rz * math.sin(a0 + math.tau * k / sides))) for k in range(sides)]]
    for n, share in enumerate(rings):
        cx = base[0] + (ax - base[0]) * share
        cz = base[1] + (az - base[1]) * share
        y = base_y + (ay - base_y) * share
        step = (1 - share) * float(rng.uniform(0.82, 1.08))
        loop = []
        for k in range(sides):
            a = a0 + twist * (n + 1) + math.tau * k / sides + float(rng.uniform(-0.12, 0.12))
            f = step * float(rng.uniform(0.88, 1.12))
            loop.append(bm.verts.new(P(cx + rx * f * math.cos(a), y + float(rng.uniform(-0.06, 0.06)),
                                       cz + rz * f * math.sin(a))))
        loops.append(loop)
    tip = bm.verts.new(P(ax, ay, az))
    bm.faces.new(list(reversed(loops[0])))
    for lower, upper in zip(loops, loops[1:]):
        for k in range(sides):
            n = (k + 1) % sides
            bm.faces.new([lower[k], lower[n], upper[n], upper[k]])
    for k in range(sides):
        bm.faces.new([loops[-1][k], loops[-1][(k + 1) % sides], tip])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def catmull_rom(points, samples):
    """Points along a Catmull-Rom spline through `points` (2D), with the
    tangent at each."""
    pts = [2 * np.subtract(points[0], points[1]) + points[1]] + [np.array(p, float) for p in points]
    pts.append(2 * np.subtract(points[-1], points[-2]) + points[-2])
    out = []
    segs = len(points) - 1
    for s in range(samples):
        t = s / (samples - 1) * segs
        i = min(int(t), segs - 1)
        u = t - i
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        pos = 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
                     + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)
        tan = 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u
                     + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u * u)
        out.append((pos, tan / np.linalg.norm(tan)))
    return out


# The horns on the arch's cornice ends, in the plane z = GATE_Z
HORN_PATH = ((6.6, 14.3), (7.6, 16.2), (7.9, 18.0), (7.3, 19.3))
HORN_RADII = (1.15, 0.78, 0.45, 0.0)
HORN_RINGS = 24
HORN_SIDES = 10
HORN_BANDS = (0.16, 0.29)


def horn_radius(u):
    k = u * (len(HORN_RADII) - 1)
    i = min(int(k), len(HORN_RADII) - 2)
    r = HORN_RADII[i] + (HORN_RADII[i + 1] - HORN_RADII[i]) * (k - i)
    # Annulations, fading toward the tip
    return r * (1 + 0.055 * max(0.0, math.sin(math.tau * 7 * u)) * (1 - u))


def horn_frame(side):
    path = [(side * x, y) for x, y in HORN_PATH]
    return catmull_rom(path, HORN_RINGS)


def horn_bmesh(side, z0):
    """Horn out of the cornice's end at depth z0: out, up and curling back in at the tip."""
    bm = bmesh.new()
    frame = horn_frame(side)
    rings = []
    for s, (c, t) in enumerate(frame[:-1]):
        u = s / (HORN_RINGS - 1)
        r = horn_radius(u)
        across = np.array([-t[1], t[0]])
        ring = []
        for k in range(HORN_SIDES):
            a = math.tau * k / HORN_SIDES
            off = across * math.cos(a) * r
            ring.append(bm.verts.new(P(c[0] + off[0], c[1] + off[1], z0 + 1.1 * r * math.sin(a))))
        rings.append(ring)
    c, _ = frame[-1]
    tip = bm.verts.new(P(c[0], c[1], z0))
    bm.faces.new(list(reversed(rings[0])))
    for a, b in zip(rings, rings[1:]):
        for k in range(HORN_SIDES):
            n = (k + 1) % HORN_SIDES
            bm.faces.new([a[k], a[n], b[n], b[k]])
    for k in range(HORN_SIDES):
        bm.faces.new([rings[-1][k], rings[-1][(k + 1) % HORN_SIDES], tip])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    return bm


def horn_band_bmesh(side, u0, z0):
    """Iron hoop round a horn at `u0` along it: an outer wall and two rims
    reaching into the horn."""
    bm = bmesh.new()
    frame = horn_frame(side)
    width = 0.16
    s0 = u0 * (HORN_RINGS - 1)
    i = int(s0)
    f = s0 - i
    c = frame[i][0] * (1 - f) + frame[i + 1][0] * f
    t = frame[i][1] * (1 - f) + frame[i + 1][1] * f
    t = t / np.linalg.norm(t)
    across = np.array([-t[1], t[0]])
    r = horn_radius(u0)
    sides = 12
    loops = []
    for (dt, rr) in ((-width / 2, r * 0.9), (-width / 2, r * 1.08 + 0.03), (width / 2, r * 1.08 + 0.03), (width / 2, r * 0.9)):
        loop = []
        for k in range(sides):
            a = math.tau * k / sides
            p = c + t * dt + across * math.cos(a) * rr
            loop.append(bm.verts.new(P(p[0], p[1], z0 + 1.1 * rr * math.sin(a))))
        loops.append(loop)
    for a, b in zip(loops, loops[1:]):
        for k in range(sides):
            n = (k + 1) % sides
            bm.faces.new([a[k], a[n], b[n], b[k]])
    # An open tube: every face turns away from the hoop's centre on the axis
    centre = P(c[0], c[1], z0)
    for face in bm.faces:
        face.normal_update()
        if face.normal.dot(face.calc_center_median() - centre) < 0:
            face.normal_flip()
    return bm


def pillar_at(y):
    """Centre x, width and depth of the right pillar at height y: the inner
    face stands plumb on the opening's edge, the outer one leans in a little,
    front and back lean in a little too, round GATE_Z."""
    t = (y + BURY) / (PILLAR_TOP + BURY)
    w = 3.2 - 0.5 * t
    d = GATE_DEPTH + 0.2 * (1 - t)
    return HALF + w / 2, w, d


def pillar_block(y0, y1, grow=0.0):
    x0, w0, d0 = pillar_at(y0)
    x1, w1, d1 = pillar_at(y1)
    return box_corners(x0 + grow / 2, y0, GATE_Z, w0 + grow, d0 + 2 * grow,
                       x1 + grow / 2, y1, GATE_Z, w1 + grow, d1 + 2 * grow)


def lintel_joint_x(j, y):
    return j * (1 + LINTEL_TILT * (y - OPEN_H) / (LINTEL_TOP - OPEN_H))


def lintel_half_depth(y):
    """Half the lintel's depth at height y round GATE_Z: its front and back
    face lean out a little toward the top."""
    return GATE_DEPTH / 2 + 0.1 * (y - OPEN_H) / (LINTEL_TOP - OPEN_H)


def z_ranges(cuts):
    """The z ranges between `cuts` (ascending) from the back to the front, each
    reaching OVERLAP into its neighbours; the first and the last are open."""
    edges = [-math.inf, *cuts, math.inf]
    return [(a - OVERLAP, b + OVERLAP) for a, b in zip(edges, edges[1:])]


def lintel_stone(xa, xb):
    """A lintel stone between the joints xa and xb (x at the lintel's foot;
    None for the lintel's end), overlapping its neighbours a little."""
    def at(j, y, end_sign):
        if j is None:
            half = 6.6 + 0.4 * (y - OPEN_H) / (LINTEL_TOP - OPEN_H)
            return end_sign * half
        return lintel_joint_x(j, y)
    corners = []
    for y in (OPEN_H, LINTEL_TOP):
        d = lintel_half_depth(y)
        xl = at(xa, y, -1) - (OVERLAP if xa is not None else 0)
        xr = at(xb, y, 1) + (OVERLAP if xb is not None else 0)
        corners += [(xl, y, GATE_Z - d), (xr, y, GATE_Z - d), (xr, y, GATE_Z + d), (xl, y, GATE_Z + d)]
    return corners


class Piece:
    def __init__(self, name, bm, kind=STONE, role=PLAIN, bevel=0.0, chips=(), jitter=None,
                 corners=None, poke=True, plumb=0, axis=None):
        self.name, self.bm, self.kind, self.role = name, bm, kind, role
        self.bevel, self.chips, self.jitter, self.corners = bevel, chips, jitter, corners
        # A spike's axis: the middle of its base and its apex (portal space), for its flutes
        self.poke, self.plumb, self.axis = poke, plumb, axis


def spike(name, base, rx, rz, base_y, apex, sides, rings, rng, twist=0.25):
    return Piece(name, shard_bmesh(base, rx, rz, base_y, apex, sides, rings, rng, twist), role=SPIKE,
                 poke=False, axis=(base[0], base_y, base[1], *apex))


def block(name, corners, bevel, role=PLAIN, chip_count=0, jitter=(0.3, 0.012), plumb=0, poke=True,
          kind=STONE, protect=()):
    rng = rng_for(name)
    bm = hexa_bmesh(corners)
    candidates = [i for i in range(8) if i not in protect]
    picks = list(rng.choice(candidates, size=min(chip_count, len(candidates)), replace=False)) if chip_count else []
    if picks:
        chip_corners(bm, corners, picks, rng)
    return Piece(name, bm, kind=kind, role=role, bevel=bevel, jitter=jitter, poke=poke, plumb=plumb)


def frame_pieces():
    pieces = []
    for side in (1, -1):
        s = 'R' if side > 0 else 'L'

        def mirror(corners):
            if side > 0:
                return corners
            # Mirror in x and keep the corner order (-x before +x)
            m = [(-x, y, z) for x, y, z in corners]
            return [m[1], m[0], m[3], m[2], m[5], m[4], m[7], m[6]]

        def split(name, corners, cuts, bevel, **kw):
            """A block cut along the depth at `cuts`, as laid in stones."""
            for i, (z0, z1) in enumerate(z_ranges(cuts)):
                cut = [(x, y, min(max(z, z0), z1)) for x, y, z in corners]
                pieces.append(block(f'{name}_{i}', mirror(cut), bevel, **kw))

        # Plinth under the pillar: two steps, each laid in two stones along
        # the depth, as far out in front and behind as the arch is deep
        px = HALF + 0.05 + 1.875
        c = box_corners(px, -BURY, GATE_Z, 3.75, GATE_DEPTH + 1.2, px, 0.8, GATE_Z, 3.75, GATE_DEPTH + 1.0)
        split(f'plinth_low_{s}', c, (GATE_Z + 0.3,), 0.07, chip_count=2, jitter=(0.25, 0.006), protect=(0, 1, 2, 3))
        c = box_corners(HALF + 0.05 + 1.6, 0.8 - OVERLAP, GATE_Z, 3.2, GATE_DEPTH + 1.1,
                        HALF + 0.05 + 1.65, PLINTH_TOP, GATE_Z, 3.1, GATE_DEPTH + 0.2)
        split(f'plinth_up_{s}', c, (GATE_Z - 0.4,), 0.06, chip_count=2, jitter=(0.25, 0.006), protect=(0, 1, 2, 3))

        # Pillar: the foot down into the ground, five courses as tall as a
        # sigil cell, the impost under the lintel
        pieces.append(block(f'pillar_foot_F_{s}', mirror(pillar_block(-BURY, COURSE_BOTTOM + OVERLAP)), 0.05,
                            jitter=None, plumb=side, protect=range(8)))
        for k in range(COURSES):
            y0 = COURSE_BOTTOM + COURSE_H * k - OVERLAP
            y1 = COURSE_BOTTOM + COURSE_H * (k + 1) + OVERLAP
            pieces.append(block(f'pillar_{k}_F_{s}', mirror(pillar_block(y0, y1)), 0.05 + 0.01 * (k % 3), role=GLYPH,
                                chip_count=1 + k % 2, jitter=(0.35, 0.012), plumb=side))
        c = pillar_block(COURSE_BOTTOM + COURSE_H * COURSES - OVERLAP, OPEN_H + 0.1, grow=0.14)
        # The impost's inner face stays on the opening's edge
        c = [(HALF if i in (0, 3, 4, 7) else x, y, z) for i, (x, y, z) in enumerate(c)]
        pieces.append(block(f'impost_F_{s}', mirror(c), 0.045, chip_count=1, jitter=(0.2, 0.008), plumb=side,
                            protect=(4, 5, 6, 7)))
        # Iron band round the pillar's foot
        c = pillar_block(2.05, 2.45, grow=0.09)
        c = [(HALF - 0.045 if i in (0, 3, 4, 7) else x, y, z) for i, (x, y, z) in enumerate(c)]
        pieces.append(block(f'band_F_{s}', mirror(c), 0.012, kind=IRON, jitter=None, poke=False))

        # Horn out of the cornice, and its hoops
        pieces.append(Piece(f'horn_{s}', horn_bmesh(side, GATE_Z), kind=HORN, poke=False))
        for n, u in enumerate(HORN_BANDS):
            pieces.append(Piece(f'hoop_{n}_{s}', horn_band_bmesh(side, u, GATE_Z), kind=IRON, poke=False))

        # Spikes along the cornice between the crown and the horns, a shard
        # on the crown's base
        rng = rng_for(7, side)
        pieces.append(spike(f'spike_{s}', (side * 2.9, GATE_Z), 0.8, 0.9, CORNICE_TOP - OVERLAP,
                            (side * 3.5, 18.3, GATE_Z + 0.2), 5, (0.28, 0.52, 0.76), rng))
        pieces.append(spike(f'edge_spike_{s}', (side * 4.7, GATE_Z + 0.5), 0.55, 0.6, CORNICE_TOP - OVERLAP,
                            (side * 5.3, 16.9, GATE_Z + 0.9), 5, (0.35, 0.65), rng))
        pieces.append(spike(f'shard_{s}', (side * 1.35, GATE_Z), 0.5, 0.55, 15.9,
                            (side * 2.0, 17.4, GATE_Z + 0.05), 5, (0.35, 0.65), rng))

    # Lintel: six stones across, their joints between the sigil columns; its
    # front and back face carry the sigils
    bounds = (None, *LINTEL_JOINTS, None)
    for i, (xa, xb) in enumerate(zip(bounds, bounds[1:])):
        pieces.append(block(f'lintel_{i}_F', lintel_stone(xa, xb), 0.06, role=GLYPH,
                            chip_count=1 if i in (0, 5) else 0, jitter=(0.15, 0.008), protect=(0, 1, 2, 3)))
    # Iron cramps across the joints on the front and the back face, above the sigils
    for gz in (1, -1):
        g = 'F' if gz > 0 else 'B'
        for j in LINTEL_JOINTS:
            y0, y1 = 13.42, 13.68
            face = lintel_half_depth((y0 + y1) / 2)
            x = lintel_joint_x(j, (y0 + y1) / 2)
            z = GATE_Z + gz * (face - 0.02)
            c = box_corners(x, y0, z, 0.62, 0.11, x, y1, z, 0.62, 0.11)
            pieces.append(block(f'cramp_{j}_{g}', c, 0.01, kind=IRON, jitter=None, poke=False))

    # Bed moulding and cornice slabs, overhanging the lintel a little
    for i, (xa, xb) in enumerate(((-7.2, -3.0), (-3.0, 3.0), (3.0, 7.2))):
        c = box_corners((xa + xb) / 2, 13.8, GATE_Z, xb - xa + OVERLAP, GATE_DEPTH + 0.35,
                        (xa + xb) / 2, 14.02, GATE_Z, xb - xa + OVERLAP, GATE_DEPTH + 0.35)
        pieces.append(block(f'moulding_{i}_F', c, 0.04, jitter=(0.1, 0.006), poke=False))
    joints = (-7.7, -5.775, -1.925, 1.925, 5.775, 7.7)
    for i, (xa, xb) in enumerate(zip(joints, joints[1:])):
        wa = xa - (OVERLAP if i > 0 else 0)
        wb = xb + (OVERLAP if i < 4 else 0)
        ta = wa if i > 0 else -7.5
        tb = wb if i < 4 else 7.5
        bd = GATE_DEPTH / 2 + 0.4
        td = GATE_DEPTH / 2 + 0.3
        c = [(wa, 14.0, GATE_Z - bd), (wb, 14.0, GATE_Z - bd), (wb, 14.0, GATE_Z + bd), (wa, 14.0, GATE_Z + bd),
             (ta, CORNICE_TOP, GATE_Z - td), (tb, CORNICE_TOP, GATE_Z - td), (tb, CORNICE_TOP, GATE_Z + td),
             (ta, CORNICE_TOP, GATE_Z + td)]
        pieces.append(block(f'cornice_{i}_F', c, 0.07, chip_count=2 if i in (0, 4) else 1, jitter=(0.25, 0.012)))

    # Crown: a base on the cornice and a jagged spike on it, the top of the frame
    c = box_corners(0, CORNICE_TOP - OVERLAP, GATE_Z, 5.0, 2.4, 0, 16.1, GATE_Z, 4.0, 1.9)
    pieces.append(block('crown_base_F', c, 0.06, chip_count=2, jitter=None, protect=(0, 1, 2, 3)))
    pieces.append(spike('crown_spike_F', (0.0, GATE_Z), 1.9, 1.1, 16.1 - 0.05, (0.0, FRAME_TOP, GATE_Z), 6,
                        (0.22, 0.44, 0.64, 0.82), rng_for(11, 1), twist=0.2))
    return pieces


def evaluate_bevel(piece, coll):
    """The piece's mesh with its bevel applied, as a bmesh."""
    me = bpy.data.meshes.new(piece.name)
    piece.bm.to_mesh(me)
    piece.bm.free()
    if piece.bevel <= 0:
        bm = bmesh.new()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        return bm
    ob = bpy.data.objects.new(piece.name, me)
    coll.objects.link(ob)
    mod = ob.modifiers.new('Bevel', 'BEVEL')
    mod.width = piece.bevel
    mod.segments = 1
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(30)
    mod.use_clamp_overlap = True
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    evaluated = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    bm = bmesh.new()
    bm.from_mesh(evaluated)
    bpy.data.meshes.remove(evaluated)
    return bm


def hew(bm, rng):
    """Hewn faces: large faces poked, their centre pushed in or out a little,
    so they break into shallow facets."""
    big = [f for f in bm.faces if f.calc_area() > 1.0 and len(f.verts) == 4]
    if not big:
        return
    normals = {f: f.normal.copy() for f in big}
    res = bmesh.ops.poke(bm, faces=big)
    for v in res['verts']:
        n = Vector()
        for f in v.link_faces:
            n += f.normal
        n.normalize()
        v.co += n * float(rng.uniform(-0.012, 0.03))


def jitter(bm, piece, rng):
    """Turn and shift a block a little about the vertical, as laid by hand. A
    block on the opening's edge (plumb = side) keeps its inner face there."""
    if piece.jitter:
        yaw, shift = piece.jitter
        centre = sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
        rot = Matrix.Rotation(math.radians(float(rng.uniform(-yaw, yaw))), 4, 'Z')
        off = Vector((float(rng.uniform(-shift, shift)), float(rng.uniform(-shift, shift)), 0))
        mat = Matrix.Translation(centre + off) @ rot @ Matrix.Translation(-centre)
        bmesh.ops.transform(bm, matrix=mat, verts=bm.verts)
    if piece.plumb:
        inner = min(v.co.x * piece.plumb for v in bm.verts)
        if inner < HALF:
            bmesh.ops.translate(bm, vec=Vector((piece.plumb * (HALF - inner), 0, 0)), verts=bm.verts)


def build():
    clear_scene()
    coll = bpy.context.scene.collection
    pieces = frame_pieces()
    final = bmesh.new()
    lay_piece = final.faces.layers.int.new('piece')
    lay_kind = final.faces.layers.int.new('kind')
    lay_role = final.faces.layers.int.new('role')
    hulls = []
    for index, piece in enumerate(pieces):
        rng = rng_for(piece.name, 'jitter')
        bm = evaluate_bevel(piece, coll)
        if piece.poke:
            hew(bm, rng)
        jitter(bm, piece, rng)
        # A chip next to a bevel can leave slivers; their tangents would break the normal map
        bmesh.ops.dissolve_degenerate(bm, dist=0.005, edges=bm.edges[:])
        bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
        flat = piece.kind != HORN and not piece.name.startswith('hoop')
        for f in bm.faces:
            f.smooth = not flat
        hulls.append(BVHTree.FromBMesh(bm))
        me = bpy.data.meshes.new('tmp')
        bm.to_mesh(me)
        bm.free()
        before = len(final.faces)
        final.from_mesh(me)
        bpy.data.meshes.remove(me)
        final.faces.ensure_lookup_table()
        for f in final.faces[before:]:
            f[lay_piece] = index
            f[lay_kind] = piece.kind
            f[lay_role] = piece.role
    me = bpy.data.meshes.new('SpawnPortal')
    final.to_mesh(me)
    final.free()
    ob = bpy.data.objects.new('SpawnPortal', me)
    coll.objects.link(ob)
    mark_hidden(me, hulls)
    prune(me, hulls)
    unwrap(ob)
    check(ob)
    # compose() reads the spikes' axes by piece
    os.makedirs(WORK, exist_ok=True)
    with open(os.path.join(WORK, 'pieces.json'), 'w') as f:
        json.dump([{'name': p.name, 'role': p.role, 'axis': p.axis} for p in pieces], f)
    return ob


def mark_hidden(me, hulls):
    """Face attributes 'hidden', faces nobody sees, under the ground or
    inside another piece."""
    piece = me.attributes['piece'].data
    hidden = me.attributes.new('hidden', 'INT', 'FACE').data
    for p in me.polygons:
        c = p.center
        if max(me.vertices[v].co.z for v in p.vertices) < -0.05:
            hidden[p.index].value = 1
            continue
        probe = c + p.normal * 0.02
        own = piece[p.index].value
        for k, bvh in enumerate(hulls):
            if k == own:
                continue
            loc, nrm, _, dist = bvh.find_nearest(probe, 0.6)
            if loc is not None and (probe - loc).dot(nrm) < 0:
                hidden[p.index].value = 1
                break


def inside(bvh, co, by):
    """Whether co lies at least `by` inside the closed piece of bvh."""
    loc, nrm, _, dist = bvh.find_nearest(co, 1.0)
    return loc is not None and (co - loc).dot(nrm) < 0 and dist >= by


def prune(me, hulls):
    """Drop the hidden faces no view can reach: those under the ground and
    those wholly inside another piece, every corner 1 cm deep in it (the
    pieces are convex but for their hewn faces' shallow dents)."""
    piece = me.attributes['piece'].data
    hidden = me.attributes['hidden'].data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    drop = []
    for p in me.polygons:
        if not hidden[p.index].value:
            continue
        corners = [me.vertices[v].co for v in p.vertices]
        if max(c.z for c in corners) < -0.05:
            drop.append(bm.faces[p.index])
            continue
        own = piece[p.index].value
        for k, bvh in enumerate(hulls):
            if k != own and inside(bvh, p.center, 0.01) and all(inside(bvh, c, 0.01) for c in corners):
                drop.append(bm.faces[p.index])
                break
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(me)
    bm.free()
    print(f'[portal] pruned {len(drop)} hidden faces')


# Texel density of an island relative to the rest: the sigil faces get
# more, the back and the undersides less, hidden faces next to nothing
UV_WEIGHT = {'glyph_front': 1.7, 'glyph_back': 1.15, 'top': 1.25, 'back': 0.8, 'under': 0.6, 'hidden': 0.03}


def island_weight(island, lay):
    if all(f[lay['hidden']] for f in island):
        return UV_WEIGHT['hidden']
    n = Vector()
    for f in island:
        n += f.normal * f.calc_area()
    n.normalize()
    glyph = any(f[lay['role']] == GLYPH and f[lay['kind']] == STONE for f in island)
    # Blender -y is the portal's front
    if glyph and n.y < -0.6:
        return UV_WEIGHT['glyph_front']
    if glyph and n.y > 0.6:
        return UV_WEIGHT['glyph_back']
    # The tops are what the overview sees most
    if n.z > 0.6:
        return UV_WEIGHT['top']
    if n.z < -0.6:
        return UV_WEIGHT['under']
    if n.y > 0.6:
        return UV_WEIGHT['back']
    return 1.0


def unwrap(ob, angle=66, margin=0.002, rotate='AXIS_ALIGNED'):
    """Smart UV project, then islands scaled to one texel density weighted
    by UV_WEIGHT, and packed."""
    me = ob.data
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.scene.objects:
        o.select_set(o == ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.active
    lay = {name: bm.faces.layers.int.get(name) for name in ('role', 'kind', 'hidden')}
    bm.faces.ensure_lookup_table()
    for island in bmesh_utils.bmesh_linked_uv_islands(bm, uv):
        area3d = sum(f.calc_area() for f in island)
        area_uv = 0.0
        for f in island:
            pts = [l[uv].uv for l in f.loops]
            for i in range(1, len(pts) - 1):
                area_uv += abs((pts[i] - pts[0]).cross(pts[i + 1] - pts[0])) / 2
        if area_uv <= 0 or area3d <= 0:
            continue
        scale = math.sqrt(area3d / area_uv) * island_weight(island, lay)
        centre = Vector((0, 0))
        n = 0
        for f in island:
            for l in f.loops:
                centre += l[uv].uv
                n += 1
        centre /= n
        for f in island:
            for l in f.loops:
                l[uv].uv = centre + (l[uv].uv - centre) * scale
    bm.to_mesh(me)
    bm.free()

    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, rotate_method=rotate, scale=True, margin_method='FRACTION',
                            margin=margin, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')


def check(ob):
    """The extents the game holds the frame to (see spawn-portal-frame.spec.ts)."""
    me = ob.data
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    x, y, z = co[:, 0], co[:, 2], -co[:, 1]
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    top = float(y.max())
    radius = float(np.hypot(x, z).max())
    smallest = min(p.area for p in me.polygons)
    print(f'[portal] {len(me.polygons)} faces, {tris} triangles, {len(me.vertices)} vertices, '
          f'smallest face {smallest * 1e4:.2f} cm2')
    assert smallest > 1e-5, f'sliver face of {smallest} m2'
    print(f'[portal] top {top:.4f} (want {FRAME_TOP}), radius {radius:.3f} (max {RADIUS}), '
          f'depth {float(z.min()):.2f} to {float(z.max()):.2f} (plane at {HALF_DEPTH:.2f})')
    assert abs(top - FRAME_TOP) < 1e-4, top
    assert radius <= RADIUS - 0.005, radius
    # One arch with its middle in the plane, in front of the enemies' start: nothing of it behind
    assert 0 < z.min() and abs((z.min() + z.max()) / 2 - HALF_DEPTH) < 0.3, (z.min(), z.max())
    for p in me.polygons:
        c = p.center
        px, py = c.x, c.z
        assert not (abs(px) < HALF - 0.2 and 1.5 < py < OPEN_H - 0.1), f'face in the opening at {px:.2f}, {py:.2f}'
    return tris


# ════════════════════════════════════════════════════════════════════════
# BAKE HELPERS
# ════════════════════════════════════════════════════════════════════════

def portal():
    return bpy.data.objects['SpawnPortal']


def use_gpu():
    prefs = bpy.context.preferences.addons['cycles'].preferences
    previous = prefs.compute_device_type
    try:
        prefs.compute_device_type = 'OPTIX'
        prefs.refresh_devices()
        bpy.context.scene.cycles.device = 'GPU'
    except TypeError:
        bpy.context.scene.cycles.device = 'CPU'
    return previous


def restore_gpu(previous):
    bpy.context.preferences.addons['cycles'].preferences.compute_device_type = previous


def new_image(name, size, float_buffer=True):
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=float_buffer)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.zeros(size * size * 4, np.float32))
    return img


def image_array(img):
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def bake_material(build_nodes):
    """A material on the portal whose emission is what build_nodes(nt) returns."""
    mat = bpy.data.materials.get('sp_bake') or bpy.data.materials.new('sp_bake')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    shader = build_nodes(nt)
    nt.links.new(shader, out.inputs['Surface'])
    ob = portal()
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return mat


def target(mat, img):
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    mat.node_tree.nodes.active = node
    return node


def emission(nt, color_socket):
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(color_socket, em.inputs['Color'])
    return em.outputs['Emission']


def combine(nt, r, g, b):
    c = nt.nodes.new('ShaderNodeCombineColor')
    for sock, src in zip(c.inputs, (r, g, b)):
        if src is None:
            continue
        if isinstance(src, (int, float)):
            sock.default_value = src
        else:
            nt.links.new(src, sock)
    return c.outputs['Color']


def math_node(nt, op, a, b=None):
    m = nt.nodes.new('ShaderNodeMath')
    m.operation = op
    for sock, src in zip(m.inputs, (a, b)):
        if src is None:
            continue
        if isinstance(src, (int, float)):
            sock.default_value = src
        else:
            nt.links.new(src, sock)
    return m.outputs['Value']


def object_coords(nt, scale=(1, 1, 1), warp=0.0, warp_scale=1.0):
    """Object coordinates for a noise field, LOOK_BACK further back."""
    tc = nt.nodes.new('ShaderNodeTexCoord')
    back = nt.nodes.new('ShaderNodeVectorMath')
    back.operation = 'ADD'
    nt.links.new(tc.outputs['Object'], back.inputs[0])
    back.inputs[1].default_value = P(0, 0, -LOOK_BACK)
    vec = back.outputs['Vector']
    if warp:
        wn = nt.nodes.new('ShaderNodeTexNoise')
        wn.inputs['Scale'].default_value = warp_scale
        wn.inputs['Detail'].default_value = 3
        nt.links.new(vec, wn.inputs['Vector'])
        sub = nt.nodes.new('ShaderNodeVectorMath')
        sub.operation = 'MULTIPLY_ADD'
        nt.links.new(wn.outputs['Color'], sub.inputs[0])
        sub.inputs[1].default_value = (warp, warp, warp)
        nt.links.new(vec, sub.inputs[2])
        vec = sub.outputs['Vector']
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = scale
    nt.links.new(vec, mp.inputs['Vector'])
    return mp.outputs['Vector']


def noise(nt, vec, scale, detail, roughness=0.55, offset=0.0):
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = roughness
    if 'W' in n.inputs and offset:
        n.noise_dimensions = '4D'
        n.inputs['W'].default_value = offset
    nt.links.new(vec, n.inputs['Vector'])
    return n.outputs['Fac']


def voronoi_edge(nt, vec, scale):
    v = nt.nodes.new('ShaderNodeTexVoronoi')
    v.feature = 'DISTANCE_TO_EDGE'
    v.inputs['Scale'].default_value = scale
    nt.links.new(vec, v.inputs['Vector'])
    return v.outputs['Distance']


def ao_node(nt, distance, inside, samples):
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
    ao.inside = inside
    ao.only_local = inside
    ao.samples = samples
    ao.inputs['Distance'].default_value = distance
    return ao.outputs['AO']


def ground_plane():
    """The street round the portal: it shades the plinths' feet in the AO bake."""
    me = bpy.data.meshes.new('sp_ground')
    bm = bmesh.new()
    s = 60
    vs = [bm.verts.new((x, y, 0.0)) for x, y in ((-s, -s), (s, -s), (s, s), (-s, s))]
    bm.faces.new(vs)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('sp_ground', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def bake(kind, img, samples, **kw):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    ob = portal()
    for o in scene.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type=kind, margin=0, use_clear=False, **kw)
    return image_array(img)


MAPS = ('pos', 'nrm', 'piece', 'edge', 'noise1', 'noise2', 'noise3', 'ao')


def maps(only=MAPS):
    """Helper maps at TEX, saved to WORK as .npy."""
    os.makedirs(WORK, exist_ok=True)
    previous = use_gpu()
    ground = None
    try:
        for name in only:
            img = new_image(f'sp_{name}', TEX)
            if name == 'pos':
                # +100 so a covered texel never reads 0
                mat = bake_material(lambda nt: emission(nt, math_vec_add(nt, nt.nodes.new('ShaderNodeNewGeometry').outputs['Position'], 100.0)))
                samples = 1
            elif name == 'nrm':
                mat = bake_material(lambda nt: emission(nt, nt.nodes.new('ShaderNodeNewGeometry').outputs['True Normal']))
                samples = 1
            elif name == 'piece':
                def nodes(nt):
                    attrs = []
                    for a in ('piece', 'kind', 'role'):
                        n = nt.nodes.new('ShaderNodeAttribute')
                        n.attribute_name = a
                        attrs.append(n.outputs['Fac'])
                    return emission(nt, combine(nt, math_node(nt, 'ADD', attrs[0], 1.0), attrs[1], attrs[2]))
                mat = bake_material(nodes)
                samples = 1
            elif name == 'edge':
                mat = bake_material(lambda nt: emission(nt, combine(
                    nt, ao_node(nt, 0.07, True, 24), ao_node(nt, 0.14, False, 24), None)))
                samples = 16
            elif name == 'noise1':
                def nodes(nt):
                    fbm = noise(nt, object_coords(nt), 0.45, 6)
                    big = voronoi_edge(nt, object_coords(nt, warp=0.6, warp_scale=1.6), 0.42)
                    fine = noise(nt, object_coords(nt), 6.0, 4)
                    return emission(nt, combine(nt, fbm, big, fine))
                mat = bake_material(nodes)
                samples = 4
            elif name == 'noise2':
                def nodes(nt):
                    streak = noise(nt, object_coords(nt, scale=(2.2, 2.2, 0.16)), 1.0, 4)
                    small = voronoi_edge(nt, object_coords(nt, warp=0.12, warp_scale=3.0), 1.7)
                    speck = noise(nt, object_coords(nt), 38.0, 1, offset=3.1)
                    return emission(nt, combine(nt, streak, small, speck))
                mat = bake_material(nodes)
                samples = 4
            elif name == 'noise3':
                def nodes(nt):
                    patches = noise(nt, object_coords(nt), 0.8, 5, offset=7.3)
                    mask = noise(nt, object_coords(nt), 0.28, 3, offset=1.9)
                    mask2 = noise(nt, object_coords(nt), 0.9, 3, offset=5.5)
                    return emission(nt, combine(nt, patches, mask, mask2))
                mat = bake_material(nodes)
                samples = 4
            elif name == 'ao':
                if ground is None:
                    ground = ground_plane()
                mat = bake_material(lambda nt: nt.nodes.new('ShaderNodeBsdfDiffuse').outputs['BSDF'])
                world = bpy.context.scene.world or bpy.data.worlds.new('sp_world')
                bpy.context.scene.world = world
                world.light_settings.distance = 4.0
                samples = 96
            target(mat, img)
            arr = bake('AO' if name == 'ao' else 'EMIT', img, samples)
            np.save(os.path.join(WORK, f'{name}.npy'), arr[..., :3].copy())
            print(f'[portal] baked {name}')
    finally:
        if ground is not None:
            bpy.data.objects.remove(ground, do_unlink=True)
        restore_gpu(previous)


def math_vec_add(nt, vec, value):
    add = nt.nodes.new('ShaderNodeVectorMath')
    add.operation = 'ADD'
    nt.links.new(vec, add.inputs[0])
    add.inputs[1].default_value = (value, value, value)
    return add.outputs['Vector']


# ════════════════════════════════════════════════════════════════════════
# COMPOSE (numpy)
# ════════════════════════════════════════════════════════════════════════

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def box_blur(a, r, axis):
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(a, r):
    for _ in range(3):
        a = box_blur(box_blur(a, r, 0), r, 1)
    return a


def dilate(img, covered, steps):
    """Fill the texels outside the islands from their covered neighbours,
    `steps` texels out: mip levels and bilinear filtering then do not pull
    the empty background into the islands' edges."""
    img = img.copy()
    cov = covered.copy()
    for _ in range(steps):
        acc = np.zeros_like(img)
        cnt = np.zeros(cov.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            c = np.roll(cov, (dy, dx), (0, 1)).astype(np.float32)
            v = np.roll(img, (dy, dx), (0, 1))
            acc += v * (c[..., None] if img.ndim == 3 else c)
            cnt += c
        new = (~cov) & (cnt > 0)
        if img.ndim == 3:
            img[new] = acc[new] / cnt[new][:, None]
        else:
            img[new] = acc[new] / cnt[new]
        cov |= new
    return img


def downsample(a):
    return 0.25 * (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2])


def to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def part_length(part):
    if part['kind'] == 'ring':
        return math.tau * part['r']
    if part['kind'] == 'arc':
        return part['r'] * part['span']
    if part['kind'] == 'crescent':
        return math.pi * part['r']
    return 2 * part['r']


def sigil_field(sigil, qx, qy, with_order=True):
    """Distance (cell units) from (qx, qy) to the sigil's ink, as the game's
    shader has it (spawn-portal-sigils.ts), and the order its strokes run in
    there, 0 to 1 over the sigil: each part in turn, every part taking its
    share by its length; rings from the top clockwise, arcs from their
    counter-clockwise end, dots and crescents all at one order, so a glimmer
    along the order lights them whole and draws no rings in them."""
    stroke = SIGIL['stroke']
    parts = sigil['parts']
    lengths = np.array([part_length(p) for p in parts])
    starts = np.concatenate([[0.0], np.cumsum(lengths)[:-1]]) / lengths.sum()
    shares = lengths / lengths.sum()
    best = np.full(qx.shape, 1e9, np.float32)
    order = np.zeros(qx.shape, np.float32)
    for j, part in enumerate(parts):
        dx = qx - part['x']
        dy = qy - part['y']
        rr = np.hypot(dx, dy)
        ang = np.arctan2(dy, dx)
        if part['kind'] == 'ring':
            d = np.abs(rr - part['r']) - stroke
            s = np.mod((math.pi / 2 - ang) / math.tau, 1.0)
        elif part['kind'] == 'dot':
            d = rr - part['r']
            s = np.full_like(rr, 0.5)
        elif part['kind'] == 'crescent':
            shift = SIGIL['crescentShift'] * part['r']
            hollow = np.hypot(dx - math.cos(part['at']) * shift, dy - math.sin(part['at']) * shift)
            d = np.maximum(rr - part['r'], SIGIL['crescentHollow'] * part['r'] - hollow)
            s = np.full_like(rr, 0.5)
        else:
            at, span, r = part['at'], part['span'], part['r']
            dirx, diry = math.cos(at), math.sin(at)
            sx, sy = math.sin(span / 2), math.cos(span / 2)
            ax_ = np.abs(dx * diry - dy * dirx)
            ay_ = dx * dirx + dy * diry
            end = np.hypot(ax_ - sx * r, ay_ - sy * r)
            d = np.where(sy * ax_ > sx * ay_, end, np.abs(rr - r)) - stroke
            rel = np.mod(ang - at + math.pi, math.tau) - math.pi
            s = np.clip((span / 2 - rel) / span, 0, 1)
        closer = d < best
        best = np.where(closer, d, best)
        if with_order:
            order = np.where(closer, starts[j] + shares[j] * s, order)
    return best, order


def load(name):
    return np.load(os.path.join(WORK, f'{name}.npy'))


def rust_run(x, y, ny, streak):
    """Rust washed down the stone below the iron: under the lintels' cramps
    and under the bands round the pillars' feet."""
    upright = 1 - smoothstep(0.3, 0.6, np.abs(ny))
    joints = np.array(LINTEL_JOINTS)
    jx = joints[np.argmin(np.abs(x[..., None] - joints), axis=-1)]
    below = 13.42 - y
    cramp = (1 - smoothstep(0.15, 0.32, np.abs(x - jx))) * np.exp(-np.maximum(below, 0) / 0.7) * (below > -0.02)
    below = 2.05 - y
    band = np.exp(-np.maximum(below, 0) / 0.5) * (below > -0.02) * (np.abs(x) > HALF - 0.1) * (np.abs(x) < 7.0)
    return np.clip((cramp + band) * upright * (0.4 + 0.8 * streak), 0, 1)


def load_pieces():
    """Per piece, as build() wrote them: its name, role and, for a spike, its axis."""
    path = os.path.join(WORK, 'pieces.json')
    return json.load(open(path)) if os.path.exists(path) else []


def compose():
    pos, nrm, pc = load('pos'), load('nrm'), load('piece')
    edge_ao, n1m, n2m, n3m, ao = load('edge'), load('noise1'), load('noise2'), load('noise3'), load('ao')
    cov = pos[..., 0] > 1.0
    x, y, z = pos[..., 0] - 100, pos[..., 2] - 100, -(pos[..., 1] - 100)
    nx, ny, nz = nrm[..., 0], nrm[..., 2], -nrm[..., 1]
    piece = np.clip(np.rint(pc[..., 0] - 1), 0, 4095).astype(np.int32)
    kind = np.rint(pc[..., 1]).astype(np.int32)
    role = np.rint(pc[..., 2]).astype(np.int32)
    stone = cov & (kind == STONE)
    iron = cov & (kind == IRON)
    horn = cov & (kind == HORN)
    spiky = stone & (role == SPIKE)

    fbm, big_vor, fine = n1m[..., 0], n1m[..., 1], n1m[..., 2]
    streak, small_vor, speck = n2m[..., 0], n2m[..., 1], n2m[..., 2]
    patches, crack_mask, crack_mask2 = n3m[..., 0], n3m[..., 1], n3m[..., 2]
    ao_in, ao_out = edge_ao[..., 0], edge_ao[..., 1]
    ao_macro = ao[..., 0]

    rng = rng_for(99)
    pieces = int(piece.max()) + 1
    tone = (0.78 + 0.44 * rng.random(pieces)).astype(np.float32)
    obsidian_piece = rng.random(pieces) < 0.14
    hue = np.where(rng.random(pieces)[:, None] < 0.5, [[1.05, 1.0, 0.94]], [[0.97, 0.98, 1.02]]).astype(np.float32)

    # ── Sigils: carved grooves, each cell's sigil turned and sized, worn
    # away in places, crossed by cracks, some half under soot ──
    S = SIGIL['size']
    stroke = SIGIL['stroke']
    groove = np.zeros(cov.shape, np.float32)
    glow = np.zeros(cov.shape, np.float32)
    lip = np.zeros(cov.shape, np.float32)
    order = np.zeros(cov.shape, np.float32)
    stain = np.zeros(cov.shape, np.float32)
    in_cell = np.zeros(cov.shape, bool)
    # The arch's front and back face
    faces = stone & (role == GLYPH) & (nz * np.sign(z - GATE_Z) > 0.6)
    idx = np.flatnonzero(faces)
    xs, ys = x.ravel()[idx], y.ravel()[idx]
    wearing = (0.6 * patches + 0.4 * fine).ravel()[idx]
    sooting = crack_mask2.ravel()[idx]
    cell_rng = rng_for(314)
    for cell in LAYOUT['cells']:
        sigil = LAYOUT['sigils'][cell['sigil']]
        inside = (np.abs(xs - cell['x']) < 0.5 * S) & (np.abs(ys - cell['y']) < 0.5 * S)
        # A little past the cell, so bilinear filtering and mip levels do not
        # pull its edge into the glow
        around = (np.abs(xs - cell['x']) < 0.5 * S + 0.06) & (np.abs(ys - cell['y']) < 0.5 * S + 0.06)
        ii = idx[inside]
        c, s = math.cos(-cell['turn']), math.sin(-cell['turn'])
        px = (xs[inside] - cell['x']) / S - cell['dx']
        py = (ys[inside] - cell['y']) / S - cell['dy']

        def field(oy, with_order=True):
            qx = (c * px - s * (py - oy)) / cell['scale']
            qy = (s * px + c * (py - oy)) / cell['scale']
            return sigil_field(sigil, qx, qy, with_order)
        d, o = field(0.0)
        # Worn away in places, whole bits of stroke gone, how much differs
        # from cell to cell; soot fills some of what is left
        worn_from = 0.2 + 0.3 * float(cell_rng.random())
        kept = smoothstep(worn_from, worn_from + 0.1, wearing[inside])
        near = np.exp(-np.maximum(d, 0) / 0.06)
        cover = smoothstep(0.62, 0.85, sooting[inside] + 0.25 * float(cell_rng.random())) * near
        # Steep walls and a flat bottom; the cut edge
        # No part wears away wholly: a sigil never shrinks to a lone crescent and dot
        groove.ravel()[ii] = smoothstep(0.0, 0.6 * stroke, -d) * (0.4 + 0.6 * kept) * (1 - 0.45 * cover)
        # How much of the carving is left to glow: the game draws the glow
        # from the sigil's distance field and dims it by this where the
        # sigil wears away or soot fills it. Smooth, so it holds far away
        glow.ravel()[idx[around]] = 0.3 + 0.7 * smoothstep(0.2, 0.7, smoothstep(worn_from, worn_from + 0.1, wearing[around]))
        glow.ravel()[ii] *= 1 - 0.8 * cover
        lip.ravel()[ii] = np.exp(-((d - 0.008) / 0.01) ** 2) * (d > 0) * kept
        order.ravel()[ii] = o
        # Smoke rises: the stain reaches up the face from the grooves
        st = np.zeros_like(px)
        for k in (0.0, 0.07, 0.14, 0.22, 0.3):
            dk, _ = field(k, with_order=False)
            st = np.maximum(st, np.exp(-np.maximum(dk, 0) / 0.035) * (1 - k / 0.36))
        stain.ravel()[ii] = np.maximum(st, 0.8 * cover)
        in_cell.ravel()[ii] = True

    # ── Distance to the opening, soot and scorch round it; the arch's front
    # and back face alike, its inner faces as in the opening ──
    d_open = (np.hypot(np.maximum(np.abs(x) - HALF, 0), np.maximum(y - OPEN_H, 0))
              + 0.3 * np.maximum(np.abs(z - GATE_Z) - GATE_DEPTH / 2 + 0.3, 0))
    near_open = np.exp(-d_open * 0.6)

    # ── Cracks: a few deep ones in patches and round the opening, hairlines,
    # running through the sigils too ──
    width = 0.008 + 0.014 * fine
    crack_line = 1 - smoothstep(0.0, width, big_vor)
    crack_core = 1 - smoothstep(0.0, width * 0.45, big_vor)
    crack_area = np.maximum(smoothstep(0.58, 0.7, crack_mask), 0.6 * smoothstep(0.45, 0.85, near_open))
    crack = crack_line * crack_area * (1 - 0.15 * in_cell)
    hair = (1 - smoothstep(0.0, 0.02, small_vor)) * smoothstep(0.6, 0.72, crack_mask2) * 0.7

    # ── Spikes: flutes along each shard and the breaks between its segments,
    # soot toward the tip ──
    axes = np.zeros((pieces, 6), np.float32)
    for n, info in enumerate(load_pieces()[:pieces]):
        if info.get('axis'):
            axes[n] = info['axis']
    bx, by, bz, ax_, ay, az = (axes[piece, k] for k in range(6))
    rise = np.clip((y - by) / np.maximum(ay - by, 0.1), 0, 1)
    around = np.arctan2(z - (bz + (az - bz) * rise), x - (bx + (ax_ - bx) * rise))
    flute = smoothstep(0.55, 0.9, 0.5 + 0.5 * np.sin(around * 7 + 3 * fbm)) * spiky
    along = (y - by) / 0.55 + 0.35 * fbm
    breaks = (1 - smoothstep(0.004, 0.03, np.minimum(np.mod(along, 1), 1 - np.mod(along, 1)) * 0.55)) * spiky

    # ── Edges: worn, chipped ──
    convex = np.clip((1 - ao_in) * 2.4, 0, 1)
    chip = smoothstep(0.5, 0.56, 0.6 * fine + 0.4 * patches) * smoothstep(0.35, 0.7, convex)
    wear = smoothstep(0.4, 0.8, convex) * smoothstep(0.3, 0.6, fine)

    # ── Height (m) ──
    h = np.zeros(cov.shape, np.float32)
    # The basalt's pits and vesicles
    pit = smoothstep(0.7, 0.8, speck)
    vesicle = smoothstep(0.84, 0.9, speck)
    hs = (0.014 * (fbm - 0.5) - 0.004 * pit - 0.003 * vesicle
          - CHIP_DEPTH * chip - CRACK_DEPTH * crack - 0.01 * hair - GLYPH_DEPTH * groove
          - 0.014 * flute - 0.02 * breaks)
    h = np.where(stone, hs, h)
    # Iron: rivets on the bands round the pillars and at the cramps' ends
    along = np.where(np.abs(nz) > np.abs(nx), x, z - LOOK_BACK)
    band_rivet = np.hypot(np.mod(along, 0.3) - 0.15, y - 2.25)
    joints = np.array(LINTEL_JOINTS)
    jx = joints[np.argmin(np.abs(x[..., None] - joints), axis=-1)]
    cramp_rivet = np.hypot(np.abs(x - jx) - 0.21, y - 13.55)
    rivet = np.where(y < 5, band_rivet, cramp_rivet)
    dome = np.sqrt(np.clip(1 - (rivet / 0.035) ** 2, 0, 1))
    h = np.where(iron, 0.002 * fine + 0.012 * dome * (np.abs(ny) < 0.5), h)
    # Horn: growth rings and fibres
    h = np.where(horn, 0.006 * np.sin(math.tau * y / 0.32 + 2 * fbm) + 0.002 * streak, h)

    # ── Base colour (linear) ──
    grain = 0.6 + 0.8 * fbm
    col = BASALT * tone[piece][..., None] * hue[piece] * (grain * (1 + 0.25 * (fine - 0.5)))[..., None]
    obs = obsidian_piece[piece] & ~spiky
    col = np.where(obs[..., None], OBSIDIAN * (0.85 + 0.3 * fbm)[..., None], col)
    # Rain streaks on the upright faces, dust on the tops, light flecks in the grain
    upright = 1 - smoothstep(0.3, 0.6, np.abs(ny))
    col *= (1 - 0.45 * upright * smoothstep(0.5, 0.85, streak))[..., None]
    col = col + (DUST - col) * (0.18 * smoothstep(0.5, 0.95, ny) * smoothstep(0.3, 0.7, fbm))[..., None]
    # Tops weathered in dark patches where rain stands, so the slabs seen
    # from above do not read flat
    col *= (1 - 0.4 * smoothstep(0.5, 0.95, ny) * smoothstep(0.4, 0.75, patches) * (0.6 + 0.4 * fine))[..., None]
    col += (0.025 * smoothstep(0.86, 0.9, speck) * (1 - vesicle))[..., None]
    grime = 1 - smoothstep(-0.3, 2.2, y)
    col *= (1 - 0.35 * grime)[..., None]
    col *= (0.7 + 0.3 * ao_out)[..., None]
    # Edges rubbed lighter, chips fresh and pale
    col = col + (WORN - col) * (0.7 * wear)[..., None]
    col = col + (WORN * 1.15 - col) * (0.85 * chip)[..., None]
    col *= (1 - 0.4 * pit)[..., None]
    soot = near_open * (0.55 + 0.45 * patches)
    over = (y > OPEN_H) & (np.abs(x) < HALF + 0.6)
    soot = np.maximum(soot, over * smoothstep(0.35, 0.8, streak) * np.exp(-(y - OPEN_H) * 0.45))
    col = col + (SOOT - col) * np.clip(0.9 * soot, 0, 0.92)[..., None]
    scorch = smoothstep(0.5, 0.72, patches) * np.exp(-d_open * 0.7)
    col = col + (SCORCH - col) * (0.55 * scorch)[..., None]
    col = col + (SOOT * 0.7 - col) * (0.85 * stain)[..., None]
    # The grooves dark inside, their cut edge a little lighter
    col *= (1 - 0.75 * groove)[..., None]
    col = col + (col * 0.5 + 0.005) * (0.4 * lip)[..., None]
    col = col + (RUST_STAIN - col) * (0.6 * rust_run(x, y, ny, streak))[..., None]
    col *= (1 - 0.85 * crack - 0.5 * hair)[..., None]
    # Spikes: the flutes' ridges rubbed lighter, the breaks dark, soot toward the tip
    col = col + (WORN - col) * (0.35 * (1 - flute) * spiky * smoothstep(0.3, 0.7, fine))[..., None]
    col *= (1 - 0.7 * breaks - 0.3 * flute)[..., None]
    col = col + (SOOT - col) * (0.75 * smoothstep(0.45, 1.0, rise) * spiky)[..., None]
    rust = smoothstep(0.45, 0.7, patches + 0.25 * fine)
    iron_col = IRON_COL * (0.8 + 0.4 * fbm)[..., None]
    iron_col = iron_col + (RUST - iron_col) * rust[..., None]
    iron_col = iron_col + (SOOT - iron_col) * np.clip(0.7 * soot, 0, 0.8)[..., None]
    col = np.where(iron[..., None], iron_col, col)
    horn_col = HORN_BASE + (HORN_TIP - HORN_BASE) * smoothstep(15.5, 19.0, y)[..., None]
    horn_col = horn_col * (0.8 + 0.4 * streak)[..., None] * (1 + 0.25 * (np.sin(math.tau * y / 0.32 + 2 * fbm) > 0.6))[..., None]
    col = np.where(horn[..., None], horn_col, col)

    # ── Roughness, metal ──
    rough = np.where(obs, 0.42 + 0.1 * fbm, 0.8 + 0.12 * (fine - 0.5))
    rough = rough + (0.65 - rough) * wear * 0.5
    rough = np.maximum(rough, 0.9 * chip)
    rough = np.maximum(rough, 0.95 * np.clip(soot, 0, 1))
    rough = np.maximum(rough, np.maximum(crack, 0.92 * groove))
    rough = np.where(iron, 0.42 + 0.43 * rust, rough)
    rough = np.where(horn, 0.5 + 0.1 * streak, rough)
    metal = np.where(iron, 1 - 0.7 * rust, 0.0)

    # ── Occlusion: the bake, and the cavities of the height ──
    h_filled = dilate(h, cov, 8)
    cavity = np.clip(1 + 12 * (h_filled - blur(h_filled, 3)), 0.45, 1.0)
    # Deep enough that joints and crevices read dark against the lighter
    # worn edges from the overview camera
    occ = np.power(np.clip(ao_macro, 0, 1), 0.9) * cavity * (0.7 + 0.3 * np.clip(ao_out, 0, 1))

    # ── Emissive data ──
    crack_glow = crack_core * crack_area * smoothstep(0.4, 0.85, near_open)
    emis = np.stack([blur(glow, 1), order, crack_glow], -1)

    # ── Write ──
    np.save(os.path.join(WORK, 'height.npy'), dilate(h, cov, 16))
    save_png_or_jpeg('sp_base', dilate(to_srgb(col), cov, 16), 'base.jpg')
    orm = np.stack([occ, rough, metal], -1)
    save_png_or_jpeg('sp_orm', downsample(dilate(orm, cov, 16)), 'orm.jpg')
    save_png_or_jpeg('sp_emissive', downsample(dilate(emis, cov, 16)), 'emissive.png')
    print('[portal] composed', f'stone albedo mean {col[stone].mean(axis=0)}',
          f'coverage {cov.mean():.2f}')


def save_png_or_jpeg(name, rgb, filename):
    size = rgb.shape[0]
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.concatenate([np.clip(rgb, 0, 1), np.ones(rgb.shape[:2] + (1,), np.float32)], -1)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    path = os.path.join(WORK, filename)
    img.filepath_raw = path
    img.file_format = 'JPEG' if filename.endswith('.jpg') else 'PNG'
    if img.file_format == 'JPEG':
        try:
            img.save(filepath=path, quality=JPEG_QUALITY)
        except TypeError:
            bpy.context.scene.render.image_settings.quality = JPEG_QUALITY
            img.save_render(path)
    else:
        img.save(filepath=path)
    bpy.data.images.remove(img)
    print(f'[portal] {filename}: {os.path.getsize(path) / 1024:.0f} KB')


# ════════════════════════════════════════════════════════════════════════
# NORMAL MAP
# ════════════════════════════════════════════════════════════════════════

def normal():
    h = np.load(os.path.join(WORK, 'height.npy'))
    himg = new_image('sp_height', TEX)
    himg.pixels.foreach_set(np.repeat(h[..., None], 4, -1).astype(np.float32).ravel())
    nimg = new_image('sp_normal', TEX, float_buffer=False)

    def nodes(nt):
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = himg
        tex.interpolation = 'Cubic'
        tex.extension = 'EXTEND'
        uvn = nt.nodes.new('ShaderNodeUVMap')
        nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 1.0
        bump.inputs['Distance'].default_value = 1.0
        if 'Filter Width' in bump.inputs:
            bump.inputs['Filter Width'].default_value = 1.0
        nt.links.new(tex.outputs['Color'], bump.inputs['Height'])
        bsdf = nt.nodes.new('ShaderNodeBsdfDiffuse')
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        return bsdf.outputs['BSDF']
    mat = bake_material(nodes)
    target(mat, nimg)
    previous = use_gpu()
    try:
        arr = bake('NORMAL', nimg, 8, normal_space='TANGENT', normal_r='POS_X', normal_g='POS_Y', normal_b='POS_Z')
    finally:
        restore_gpu(previous)
    pos = load('pos')
    cov = pos[..., 0] > 1.0
    rgb = dilate(arr[..., :3], cov, 16)
    save_png_or_jpeg('sp_normal_out', rgb, 'normal.jpg')


# ════════════════════════════════════════════════════════════════════════
# EXPORT
# ════════════════════════════════════════════════════════════════════════

def load_image(filename, color):
    path = os.path.join(WORK, filename)
    for img in list(bpy.data.images):
        if img.filepath and os.path.normcase(bpy.path.abspath(img.filepath)) == os.path.normcase(path):
            bpy.data.images.remove(img)
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    return img


def gltf_output_group():
    """The node group the glTF exporter reads the occlusion from."""
    group = bpy.data.node_groups.get('glTF Material Output')
    if group:
        return group
    group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    group.nodes.new('NodeGroupInput')
    return group


def final_material():
    mat = bpy.data.materials.get('SpawnPortalStone') or bpy.data.materials.new('SpawnPortalStone')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    base = nt.nodes.new('ShaderNodeTexImage')
    base.image = load_image('base.jpg', True)
    nt.links.new(base.outputs['Color'], bsdf.inputs['Base Color'])
    orm = nt.nodes.new('ShaderNodeTexImage')
    orm.image = load_image('orm.jpg', False)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    occ = nt.nodes.new('ShaderNodeGroup')
    occ.node_tree = gltf_output_group()
    nt.links.new(sep.outputs['Red'], occ.inputs['Occlusion'])
    nrm = nt.nodes.new('ShaderNodeTexImage')
    nrm.image = load_image('normal.jpg', False)
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nrm.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    emis = nt.nodes.new('ShaderNodeTexImage')
    emis.image = load_image('emissive.png', False)
    nt.links.new(emis.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 1.0
    return mat


def export():
    ob = portal()
    ob.data.materials.clear()
    ob.data.materials.append(final_material())
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    options = dict(
        export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_tangents=True, export_materials='EXPORT',
        export_image_format='AUTO', export_attributes=False, export_animations=False,
        export_draco_mesh_compression_enable=False, export_extras=False, export_all_vertex_colors=False,
        export_vertex_color='NONE', export_cameras=False, export_lights=False)
    known = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, **{k: v for k, v in options.items() if k in known})
    print(f'[portal] {OUT_GLB}: {os.path.getsize(OUT_GLB) / 1024:.0f} KB')


# ════════════════════════════════════════════════════════════════════════

def run(*stages):
    if not stages or stages == ('all',):
        stages = ('build', 'maps', 'compose', 'normal', 'export')
    for stage in stages:
        globals()[stage]()


if __name__ == '__main__' and '--' in sys.argv:
    run(*sys.argv[sys.argv.index('--') + 1:])
