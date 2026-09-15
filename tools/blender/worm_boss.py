"""Worm boss (giant millipede): public/assets/models/enemies/worm_head.glb,
worm_segment.glb and worm_tail.glb.

Three skinned meshes, everything built here from bmesh, no inputs: dark
chitin plates with amber rims and rust paranota, lighter spike tips. The
colours are set per vertex while building; the shell's colour is worked out
again per texel (the paranota are narrower than a ring's faces), the plates
get their grain (mottling, pores, growth lines, sutures) and all of it an
ambient occlusion, and that is baked into one base colour texture per model
(TEX, JPEG) on new UVs: the enemy renderer's VAT path colours a mesh by its
texture or its material colour, not by vertex colours, so the GLB carries the
texture and no COLOR_0.

Each model has a rig of rigid parts, a bone per leg, mandible, feeler and
cercus (every vertex weighs 1 on one bone), and one looping clip that the
game bakes into its VAT:
  segment, tail  CRAWL: the legs step one after another; the tail's cerci sway
  head           JAWS: the mandibles open slowly and snap shut, the feelers sway
The game plays them by the distance walked, not by the clock
(EnemyTypeConfig.gaitStride in enemy-types.config.ts); see WAVE.

Worm space as in the game: x across, y up, z forward (the way the head
looks). Blender is z-up, so the worm point (x, y, z) lies at (x, -z, y); the
glTF exporter turns it back.

The pivots lie on the ground (y = 0) under the middle of the piece's ring:
  segment  the ring spans z = SEG_REAR .. SEG_FRONT round the pivot; its
           rear rim is wider than its front, so a segment placed PITCH behind
           another slips its front under the other's rim (telescoping plates,
           overlap SEG_FRONT - PITCH - SEG_REAR). Chain spacing: PITCH.
  tail     the last segment of a worm: the same ring and legs, and behind the
           ring the last plates close to a point, the cerci trailing back to
           about z = -2.7.
  head     placed like a segment at the chain's front node: its collar rim
           covers the first segment at z = -PITCH the same way; the head
           capsule, mandibles and antennae reach forward to about z = 2.2.
The feet stand on y = 0 in the rest pose.

Headless:
    blender --background --python tools/blender/worm_boss.py
From a running Blender (Blender MCP):
    REPO = r'D:/Source/3dtd'
    exec(open(REPO + '/tools/blender/worm_boss.py').read()); run()
`run(preview_count=12)` also lays a head, 12 segments and the tail along a
bend in the rest pose (not exported), to judge the chain.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

if 'REPO' not in globals():
    REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The UV rasteriser and the dilation of the enemy optimiser
sys.path.insert(0, os.path.join(REPO, 'tools/blender'))
from optimize_enemy import dilate, raster_uv_triangles, view3d_override  # noqa: E402

OUT = os.path.join(REPO, 'public/assets/models/enemies')
SCENE = 'worm_boss'
SUPERSAMPLE = 2
MARGIN = 8

# ── Body (model units) ──
PITCH = 1.0
SEG_FRONT = 0.52
SEG_REAR = -0.58
AXIS_Y = 0.8
# Ring cross-section: half width, half height above and below the axis
RX = 0.78
RY_TOP = 0.55
RY_BOTTOM = 0.42
# Side flanges (paranota) at this angle from the top, and the dorsal keel
FLANGE_AT = 1.45
FLANGE_W = 0.22
KEEL = 0.05
SEG_SIDES = 24
HEAD_SIDES = 32

# Ring loops of a segment from the rear to the front: (z, scale, lift, flange, tone);
# tone 0 is the plate, 1 a lit edge
SEGMENT_LOOPS = (
    (SEG_REAR, 1.02, 0.0, 0.20, 0.35),
    (-0.50, 1.11, 0.0, 0.23, 1.0),
    (-0.42, 1.08, 0.0, 0.22, 0.55),
    (-0.28, 1.02, 0.0, 0.20, 0.1),
    (0.10, 1.00, 0.0, 0.18, 0.0),
    (0.40, 0.92, 0.0, 0.14, 0.05),
    (SEG_FRONT, 0.84, 0.0, 0.10, 0.25),
)
# Tail: the segment's ring from its front to the last rim, then two narrowing
# plates rising a little to the point TAIL_TIP
TAIL_LOOPS = (
    (-1.66, 0.14, 0.11, 0.0, 0.45),
    (-1.56, 0.28, 0.10, 0.02, 0.3),
    (-1.40, 0.44, 0.08, 0.04, 0.1),
    (-1.26, 0.56, 0.06, 0.06, 0.7),
    (-1.20, 0.58, 0.05, 0.06, 0.2),
    (-0.98, 0.72, 0.03, 0.10, 0.0),
    (-0.86, 0.78, 0.02, 0.12, 0.75),
    (-0.80, 0.80, 0.01, 0.12, 0.25),
    (-0.62, 0.92, 0.0, 0.18, 0.1),
    (-0.50, 1.04, 0.0, 0.21, 1.0),
    (-0.42, 1.04, 0.0, 0.21, 0.55),
    (-0.28, 1.02, 0.0, 0.20, 0.1),
    (0.10, 1.00, 0.0, 0.18, 0.0),
    (0.40, 0.92, 0.0, 0.14, 0.05),
    (SEG_FRONT, 0.84, 0.0, 0.10, 0.25),
)
TAIL_TIP = (-1.74, 0.12)
# Head: the collar (collum) like a segment's rear, a neck groove, the capsule
# closing forward and down to a point
HEAD_LOOPS = (
    (-0.60, 1.00, 0.0, 0.20, 0.35),
    (-0.52, 1.13, 0.0, 0.26, 1.0),
    (-0.42, 1.10, 0.0, 0.26, 0.6),
    (-0.10, 1.04, 0.02, 0.26, 0.0),
    (0.18, 0.98, 0.02, 0.24, 0.2),
    (0.28, 1.02, 0.03, 0.24, 0.85),
    (0.34, 0.86, 0.0, 0.08, 0.1),
    (0.45, 0.88, -0.02, 0.05, 0.0),
    (0.70, 0.82, -0.06, 0.05, 0.0),
    (0.92, 0.70, -0.12, 0.04, 0.1),
    (1.08, 0.54, -0.18, 0.03, 0.25),
    (1.18, 0.34, -0.23, 0.02, 0.45),
    (1.23, 0.14, -0.26, 0.0, 0.6),
)
HEAD_TIP = (1.25, -0.27)

# ── Colours (linear) ──
CHITIN = (0.030, 0.015, 0.009)
EDGE = (0.200, 0.098, 0.042)
FLANGE = (0.200, 0.052, 0.014)
VENTRAL = (0.080, 0.042, 0.021)
LEG = (0.070, 0.034, 0.017)
LEG_TIP = (0.016, 0.011, 0.008)
SPIKE_TIP = (0.450, 0.300, 0.160)
MANDIBLE_TIP = (0.220, 0.060, 0.013)
EYE = (0.190, 0.004, 0.002)
ROUGHNESS = 0.4
# Texture size per model: the head fills the boss intro's close shot
TEX = {'WormHead': 1024, 'WormSegment': 512, 'WormTail': 512}

# ── Grain and shading baked into the texture ──
AO_RAYS = 96
AO_REACH = 0.8
AO_STRENGTH = 0.85

# ── Rig and clips ──
FPS = 30
BODY = 'Body'
BONE_LENGTH = 0.2
CRAWL = 'Crawl'
CRAWL_FRAMES = 32
JAWS = 'Jaws'
JAWS_FRAMES = 48
# A leg steps WAVE cycles after the leg in front of it per model unit of body:
# a wave running from the tail to the head, four segments long. The game
# walks a segment through one CRAWL loop per gaitStride metres, so a segment
# PITCH behind another is PITCH x scale / gaitStride loops behind it; at
# 1 - WAVE that is the same wave (gaitStride = 2.5 m / 0.75 at scale 2.5).
WAVE = 0.25
# Share of a step the foot is on the ground, going back at an even pace. The
# stance moves the foot back about as far as the segment walks meanwhile at
# that gaitStride (1.6 m against 1.7 m), so the feet hardly slide.
STANCE = 0.5
LEG_SWING = math.radians(20)
LEG_LIFT = math.radians(16)
HIP = (0.50, 0.52)
# The two legs of a side: (z, how far forward or back the foot stands)
LEGS = ((0.22, 0.10), (-0.22, -0.10))
JAW_OPEN = math.radians(28)
FEELER_SWAY = math.radians(10)
CERCUS_SWAY = math.radians(8)

# Kinds of surface, for the grain
SHELL, SPIKE, LIMB, JAW, FEELER, EYE_KIND = range(6)


def P(x, y, z):
    """Blender point of the worm point (x, y, z)."""
    return Vector((x, -z, y))


UP = P(0.0, 1.0, 0.0)
FORWARD = P(0.0, 0.0, 1.0)
ACROSS = P(1.0, 0.0, 0.0)


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


class Builder:
    """A bmesh with a colour, a bone and a kind of surface per vertex, and
    the pivot of each bone."""

    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.verts.layers.float_color.new('Col')
        self.bone_layer = self.bm.verts.layers.int.new('bone')
        self.kind_layer = self.bm.verts.layers.int.new('kind')
        self.bones = [BODY]
        self.pivots = {BODY: (0.0, 0.0, 0.0)}
        self.bone = 0
        self.kind = SHELL

    def part(self, kind, bone=BODY, pivot=None):
        """What the next vertices are: `kind` of surface on `bone`, a new
        bone turning round `pivot` (worm space) on first use."""
        if bone not in self.pivots:
            self.bones.append(bone)
            self.pivots[bone] = pivot
        self.bone = self.bones.index(bone)
        self.kind = kind

    def mark(self, v, colour):
        v[self.col] = (*colour, 1.0)
        v[self.bone_layer] = self.bone
        v[self.kind_layer] = self.kind
        return v

    def vert(self, p, colour):
        return self.mark(self.bm.verts.new(P(*p)), colour)

    def face(self, verts):
        return self.bm.faces.new(verts)


def ring_point(theta, s, lift, flange):
    """Point of a ring of scale s at angle theta from the top (+x at pi/2),
    and its flange weight."""
    c, sn = math.cos(theta), math.sin(theta)
    ry = RY_TOP if c >= 0 else RY_BOTTOM
    fw = math.exp(-((abs(theta if theta <= math.pi else theta - math.tau) - FLANGE_AT) / FLANGE_W) ** 2)
    r = 1 + flange * fw + KEEL * max(0.0, c) ** 12
    return RX * s * sn * r, AXIS_Y + lift + ry * s * c * r, fw


def ring_colour(theta, tone, fw):
    """Colour of the shell at angle theta from the top: plate to lit edge by
    `tone`, rust on the paranota (flange weight fw), the keel lighter, the
    underside paler. Takes numpy arrays too (shell_colours)."""
    c = np.asarray(np.cos(theta), dtype=np.float64)
    tone = np.asarray(tone, dtype=np.float64)[..., None]
    fw = np.asarray(fw, dtype=np.float64)[..., None]
    col = np.asarray(CHITIN) + (np.asarray(EDGE) - CHITIN) * tone
    col = col + (np.asarray(FLANGE) - col) * 0.85 * fw * fw
    keel = np.asarray(np.clip((c - 0.95) / 0.04, 0.0, 1.0))[..., None]
    col = col + (np.asarray(EDGE) - col) * 0.35 * keel
    ventral = np.asarray(np.clip(-c, 0.0, 1.0) * (c < -0.2))[..., None]
    col = col + (np.asarray(VENTRAL) - col) * ventral
    return col


def shell(b, loops, sides, tip=None, rear_tip=None):
    """The body shell through `loops` (z, scale, lift, flange, tone), from the
    rear to the front, capped at either end or closed to the point `tip` at
    the front, `rear_tip` at the rear ((z, lift) each)."""
    b.part(SHELL)
    rings = []
    for z, s, lift, flange, tone in loops:
        ring = []
        for k in range(sides):
            theta = math.tau * k / sides
            x, y, fw = ring_point(theta, s, lift, flange)
            ring.append(b.vert((x, y, z), tuple(ring_colour(theta, tone, fw))))
        rings.append(ring)
    for a, c in zip(rings, rings[1:]):
        for k in range(sides):
            n = (k + 1) % sides
            b.face([a[k], a[n], c[n], c[k]])
    for ring, point in ((rings[0], rear_tip), (rings[-1], tip)):
        if point is None:
            b.face(ring if ring is rings[-1] else list(reversed(ring)))
            continue
        t = b.vert((0.0, AXIS_Y + point[1], point[0]), lerp(CHITIN, EDGE, 0.7))
        for k in range(sides):
            b.face([ring[k], ring[(k + 1) % sides], t])
    return rings


def frames(points):
    """A frame (tangent, side, up) at each point of a path, turned as little
    as possible from one point to the next."""
    pts = [Vector(p) for p in points]
    out = []
    side = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if side is None:
            ref = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
            side = t.cross(ref).normalized()
        else:
            side = (side - t * side.dot(t)).normalized()
        out.append((t, side, side.cross(t).normalized()))
    return pts, out


def tube(b, points, radii, colours, sides, flat=1.0):
    """A tube through `points` (worm space) with a radius and a colour per
    point, capped at the first, the last radius 0 closes it to a point.
    `flat` squashes the cross-section across its up axis (a blade)."""
    pts, fr = frames(points)
    rings = []
    tip = None
    for p, (t, side, up), r, col in zip(pts, fr, radii, colours):
        if r <= 0:
            tip = b.vert(p, col)
            continue
        ring = []
        for k in range(sides):
            a = math.tau * k / sides
            q = p + side * math.cos(a) * r + up * math.sin(a) * r * flat
            ring.append(b.vert(q, col))
        rings.append(ring)
    for a, c in zip(rings, rings[1:]):
        for k in range(sides):
            n = (k + 1) % sides
            b.face([a[k], a[n], c[n], c[k]])
    b.face(list(reversed(rings[0])))
    if tip is not None:
        for k in range(sides):
            b.face([rings[-1][k], rings[-1][(k + 1) % sides], tip])
    else:
        b.face(rings[-1])


def catmull_rom(points, samples):
    """Points along a Catmull-Rom spline through `points` (3D tuples)."""
    pts = [Vector(p) for p in points]
    pts = [2 * pts[0] - pts[1]] + pts + [2 * pts[-1] - pts[-2]]
    out = []
    segs = len(points) - 1
    for s in range(samples):
        t = s / (samples - 1) * segs
        i = min(int(t), segs - 1)
        u = t - i
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return out


def spike(b, base, apex, radius, sides=5, rings=(0.5,), bend=(0.0, 0.0, 0.0)):
    """A spike from `base` to `apex`, `bend` pushes its middle."""
    base, apex, bend = Vector(base), Vector(apex), Vector(bend)
    pts = [base]
    radii = [radius]
    for share in rings:
        pts.append(base.lerp(apex, share) + bend * math.sin(math.pi * share))
        radii.append(radius * (1 - share) ** 0.8)
    pts.append(apex)
    radii.append(0.0)
    shares = [0.0, *rings, 1.0]
    colours = [lerp(CHITIN, SPIKE_TIP, s ** 1.5) for s in shares]
    tube(b, pts, radii, colours, sides)


def mirrored(p, side):
    return (p[0] * side, p[1], p[2])


def side_name(side):
    return 'R' if side > 0 else 'L'


def leg(b, side, i):
    """Leg i of a side (0 in front) from the underside out and down to the
    ground, bent at the knee, on a bone of its own at the hip."""
    z, dz = LEGS[i]
    b.part(LIMB, f'Leg{side_name(side)}{i}', mirrored((HIP[0], HIP[1], z), side))
    path = [(HIP[0], HIP[1], z), (0.78, 0.63, z), (1.12, 0.82, z + dz * 0.3), (1.36, 0.40, z + dz * 0.7),
            (1.44, 0.0, z + dz)]
    radii = (0.085, 0.072, 0.06, 0.04, 0.0)
    colours = [lerp(LEG, LEG_TIP, t) for t in (0.0, 0.1, 0.3, 0.6, 1.0)]
    tube(b, [mirrored(p, side) for p in path], radii, colours, 5)


def ring_parts(b):
    """What every ring carries: per side a flange spike out and back, a
    dorsal spike up and back, and two legs."""
    for side in (1, -1):
        b.part(SPIKE)
        spike(b, mirrored((0.88, 0.88, -0.06), side), mirrored((1.30, 1.08, -0.50), side), 0.11,
              bend=mirrored((0.04, 0.05, 0.0), side))
        spike(b, mirrored((0.33, 1.26, -0.08), side), mirrored((0.46, 1.78, -0.52), side), 0.10,
              bend=(0.0, 0.06, 0.04))
        for i in range(len(LEGS)):
            leg(b, side, i)


def build_segment():
    b = Builder()
    shell(b, SEGMENT_LOOPS, SEG_SIDES)
    ring_parts(b)
    return b


def build_tail():
    b = Builder()
    shell(b, TAIL_LOOPS, SEG_SIDES, rear_tip=TAIL_TIP)
    ring_parts(b)
    for side in (1, -1):
        # A pair of spikes on the last plate, swept back
        b.part(SPIKE)
        spike(b, mirrored((0.24, 1.18, -0.90), side), mirrored((0.36, 1.52, -1.38), side), 0.08,
              bend=(0.0, 0.05, 0.03))
        # Cerci, the last pair of legs turned into feelers: beaded, trailing
        # back and out
        base = (0.26, 0.74, -1.32)
        b.part(FEELER, f'Cercus{side_name(side)}', mirrored(base, side))
        path = [base, (0.50, 0.70, -1.62), (0.78, 0.58, -2.00), (0.96, 0.44, -2.38), (1.04, 0.34, -2.70)]
        pts = catmull_rom([mirrored(p, side) for p in path], 13)
        n = len(pts)
        radii = [(0.07 if i % 2 == 0 else 0.052) * (1 - 0.6 * i / (n - 1)) for i in range(n - 1)] + [0.0]
        colours = [lerp(LEG, SPIKE_TIP, (i / (n - 1)) ** 3) for i in range(n)]
        tube(b, pts, radii, colours, 5)
    return b


def head_scale(z):
    """Scale and lift of the head shell at z, from HEAD_LOOPS."""
    loops = HEAD_LOOPS
    for a, c in zip(loops, loops[1:]):
        if a[0] <= z <= c[0]:
            t = (z - a[0]) / (c[0] - a[0])
            return a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t
    raise ValueError(z)


def head_surface(theta, z, out=0.0):
    s, lift = head_scale(z)
    x, y, _ = ring_point(theta, s * (1 + out), lift, 0.05)
    return x, y, z


def build_head():
    b = Builder()
    shell(b, HEAD_LOOPS, HEAD_SIDES, tip=HEAD_TIP)
    for side in (1, -1):
        # Mandibles: flat curved blades from under the front, closing in, each
        # on a bone at its root
        path = [(0.33, 0.47, 0.95), (0.50, 0.44, 1.30), (0.46, 0.42, 1.62), (0.26, 0.41, 1.88), (0.07, 0.41, 1.98)]
        b.part(JAW, f'Jaw{side_name(side)}', mirrored(path[0], side))
        pts = catmull_rom([mirrored(p, side) for p in path], 11)
        n = len(pts)
        radii = [0.13 * (1 - (i / (n - 1)) ** 1.3) + 0.012 for i in range(n - 1)] + [0.0]
        colours = [lerp(lerp(CHITIN, EDGE, 0.2), MANDIBLE_TIP, (i / (n - 1)) ** 2) for i in range(n)]
        tube(b, pts, radii, colours, 8, flat=0.5)
        # Teeth on the inner edge, on the mandible's bone
        b.part(SPIKE, f'Jaw{side_name(side)}')
        for i in (3, 5, 7):
            p = pts[i]
            inward = Vector((-side, 0.0, 0.25)).normalized()
            spike(b, tuple(p), tuple(p + inward * (radii[i] + 0.1)), 0.045, sides=4, rings=())
        # Antennae: beaded, up, out and forward
        path = [(0.28, 0.98, 0.95), (0.42, 1.30, 1.25), (0.66, 1.52, 1.55), (0.92, 1.56, 1.90), (1.08, 1.45, 2.15)]
        b.part(FEELER, f'Feeler{side_name(side)}', mirrored(path[0], side))
        pts = catmull_rom([mirrored(p, side) for p in path], 14)
        n = len(pts)
        radii = [(0.05 if i % 2 == 0 else 0.034) * (1 - 0.55 * i / (n - 1)) for i in range(n - 1)] + [0.0]
        colours = [lerp(LEG, SPIKE_TIP, (i / (n - 1)) ** 3) for i in range(n)]
        tube(b, pts, radii, colours, 5)
        # Eyes: a cluster of three above the mandibles
        b.part(EYE_KIND)
        for theta, z in ((0.95, 0.66), (1.12, 0.78), (0.82, 0.84)):
            centre = Vector(head_surface(theta * side, z, out=0.0))
            res = bmesh.ops.create_icosphere(b.bm, subdivisions=1, radius=0.075)
            for v in res['verts']:
                g = Vector((v.co.x, v.co.z, -v.co.y)) + centre
                v.co = P(*g)
                b.mark(v, EYE)
        # Horns on the collar, swept back; flange spikes as on the segments
        b.part(SPIKE)
        spike(b, head_surface(0.7 * side, -0.05), mirrored((0.86, 2.02, -0.78), side), 0.16, sides=6,
              rings=(0.35, 0.7), bend=mirrored((0.05, 0.12, 0.05), side))
        spike(b, mirrored((0.95, 0.90, -0.10), side), mirrored((1.40, 1.12, -0.52), side), 0.12,
              bend=mirrored((0.04, 0.05, 0.0), side))
    return b


# ── Clips: the rotation of each moving bone round its pivot at clip time t (0..1) ──

def smoothstep(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u)


def leg_rotation(side, phase):
    """A leg at `phase` of its step: from front to back along the ground in
    the stance, then lifted and forward again."""
    if phase < STANCE:
        swing = LEG_SWING * (1 - 2 * phase / STANCE)
        lift = 0.0
    else:
        u = (phase - STANCE) / (1 - STANCE)
        swing = LEG_SWING * (2 * smoothstep(u) - 1)
        lift = LEG_LIFT * math.sin(math.pi * u)
    # Forward is round -y on the right (+x) side; up is round +z there
    return Quaternion(UP, -side * swing) @ Quaternion(FORWARD, side * lift)


def crawl_pose(bone, t):
    """CRAWL: leg i of a side steps WAVE x its z after the front of the ring,
    the left side half a step after the right. The tail's cerci sway."""
    if bone.startswith('Leg'):
        side = 1 if bone[3] == 'R' else -1
        z = LEGS[int(bone[4])][0]
        phase = (t - WAVE * z + (0.0 if side > 0 else 0.5)) % 1.0
        return leg_rotation(side, phase)
    if bone.startswith('Cercus'):
        side = 1 if bone[6] == 'R' else -1
        a = math.tau * (t + (0.0 if side > 0 else 0.5))
        return Quaternion(UP, side * CERCUS_SWAY * math.sin(a)) @ Quaternion(ACROSS, 0.6 * CERCUS_SWAY * math.cos(a))
    return None


def jaw_opening(t):
    """Share of JAW_OPEN over a JAWS loop: open slowly, hold, snap shut a
    little past closed, settle, chew."""
    if t < 0.40:
        return smoothstep(t / 0.40)
    if t < 0.55:
        return 1.0 + 0.05 * math.sin(math.tau * 3 * (t - 0.40) / 0.15)
    if t < 0.62:
        u = (t - 0.55) / 0.07
        return 1.0 - 1.1 * u * u
    if t < 0.70:
        return -0.1 * (1 - smoothstep((t - 0.62) / 0.08))
    return 0.06 * math.sin(math.tau * 2 * (t - 0.70) / 0.30)


def jaws_pose(bone, t):
    """JAWS: the mandibles open outward round their roots; the feelers sway,
    the left one out of step with the right."""
    if bone.startswith('Jaw'):
        side = 1 if bone[3] == 'R' else -1
        return Quaternion(UP, side * JAW_OPEN * jaw_opening(t))
    if bone.startswith('Feeler'):
        side = 1 if bone[6] == 'R' else -1
        a = math.tau * (t + (0.0 if side > 0 else 0.37))
        return Quaternion(UP, side * FEELER_SWAY * math.sin(a)) @ Quaternion(ACROSS, 0.6 * FEELER_SWAY * math.sin(2 * a + 1.0))
    return None


# ── Mesh, shading and texture ──

def prepare(b):
    """Triangles, smooth with sharp edges over 50 degrees, outward normals."""
    bm = b.bm
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(50):
            e.smooth = False
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    bm.normal_update()


def occluders(sources):
    """BVH of (bmesh, z offset in worm space) pieces and the ground."""
    verts, polys = [], []
    for bm, dz in sources:
        base = len(verts)
        shift = P(0.0, 0.0, dz)
        verts.extend(v.co + shift for v in bm.verts)
        polys.extend([base + v.index for v in f.verts] for f in bm.faces)
    base = len(verts)
    verts.extend(Vector(c) for c in ((-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)))
    polys.append([base, base + 1, base + 2, base + 3])
    return BVHTree.FromPolygons(verts, polys)


def ambient_occlusion(b, neighbours):
    """Per vertex the share of AO_RAYS (cosine-weighted over its normal's
    hemisphere) that leave within AO_REACH, with the piece's neighbours in
    the chain (bmesh, z offset) and the ground in the way. Into the float
    layer 'ao'."""
    tree = occluders([(b.bm, 0.0), *neighbours])
    rng = np.random.default_rng(7)
    u = rng.random((AO_RAYS, 2))
    r = np.sqrt(u[:, 0])
    phi = math.tau * u[:, 1]
    dirs = [Vector(d) for d in np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1 - u[:, 0])], -1)]
    layer = b.bm.verts.layers.float.new('ao')
    for v in b.bm.verts:
        n = v.normal if v.normal.length > 0.5 else Vector((0, 0, 1))
        turn = n.to_track_quat('Z', 'Y')
        origin = v.co + n * 1e-3
        hits = sum(1 for d in dirs if tree.ray_cast(origin, turn @ d, AO_REACH)[0] is not None)
        v[layer] = 1.0 - hits / AO_RAYS


def to_object(b, name):
    me = bpy.data.meshes.new(name)
    b.bm.to_mesh(me)
    b.bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def unwrap(ob):
    for o in bpy.context.scene.objects:
        o.select_set(o == ob)
    bpy.context.scene.view_layers[0].objects.active = ob
    with view3d_override(object=ob, active_object=ob):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=True, margin=0.004, shape_method='CONCAVE', margin_method='FRACTION')
        bpy.ops.object.mode_set(mode='OBJECT')


def to_srgb(c):
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)


def hash01(ix, iy, iz):
    """A value in [0, 1] per integer lattice point."""
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (h & 0xFFFF) / 65535.0


def value_noise(p):
    """Smooth value noise in [0, 1] at the points p (n x 3)."""
    f = np.floor(p)
    i = f.astype(np.int64)
    t = p - f
    t = t * t * (3 - 2 * t)
    out = np.zeros(len(p))
    for dx in (0, 1):
        wx = t[:, 0] if dx else 1 - t[:, 0]
        for dy in (0, 1):
            wy = t[:, 1] if dy else 1 - t[:, 1]
            for dz in (0, 1):
                wz = t[:, 2] if dz else 1 - t[:, 2]
                out += wx * wy * wz * hash01(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz)
    return out


def fbm(p, octaves):
    total, amp, norm = np.zeros(len(p)), 1.0, 0.0
    for o in range(octaves):
        total += amp * value_noise(p * (2 ** o) + 5.3 * o)
        norm += amp
        amp *= 0.5
    return total / norm


def shell_colours(pw, loops):
    """ring_colour() of the shell at the worm points pw, tone from `loops` by z."""
    zs = [lp[0] for lp in loops]
    lift = np.interp(pw[:, 2], zs, [lp[2] for lp in loops])
    tone = np.interp(pw[:, 2], zs, [lp[4] for lp in loops])
    theta = np.arctan2(pw[:, 0], pw[:, 1] - AXIS_Y - lift)
    fw = np.exp(-((np.abs(theta) - FLANGE_AT) / FLANGE_W) ** 2)
    return ring_colour(theta, tone, fw), theta


def chitin(col, pw, kind, theta):
    """The grain on the colours `col` at the worm points pw: broad mottling,
    fine grain and pores everywhere; on the shell growth lines round the body
    and dark sutures, the dorsal midline and a seam each side of the back."""
    shell_ = kind == SHELL
    mottle = fbm(pw * 4.0 + 3.1, 3)
    grain = value_noise(pw * 46.0)
    pores = np.clip((value_noise(pw * 34.0 + 11.0) - 0.80) / 0.10, 0.0, 1.0)
    f = (0.72 + 0.56 * mottle) * (0.88 + 0.24 * grain) * (1 - 0.35 * pores)
    lines = 0.5 + 0.5 * np.sin(math.tau * (pw[:, 2] * 11.0 + 0.8 * fbm(pw * 2.5, 2)))
    top = pw[:, 1] > AXIS_Y - 0.1
    seams = np.exp(-(np.abs(theta) / 0.045) ** 2) + np.exp(-((np.abs(theta) - 0.9) / 0.03) ** 2)
    f = np.where(shell_, f * (0.93 + 0.12 * lines) * (1 - 0.6 * np.clip(seams, 0, 1) * top), f)
    return col * f[:, None]


def bake_colours(ob, loops, tex):
    """The model's colours, grain and ambient occlusion into a tex² image on
    the object's UVs (SUPERSAMPLE² samples a texel, islands grown by MARGIN
    texels), and a material that shows it. Shell texels take their colour
    from `loops` (shell_colours), the rest from the vertex colours."""
    me = ob.data
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    verts = np.empty(n * 3, dtype=np.int32)
    loops_idx = np.empty(n * 3, dtype=np.int32)
    me.loop_triangles.foreach_get('vertices', verts)
    me.loop_triangles.foreach_get('loops', loops_idx)
    uv = np.empty(len(me.loops) * 2, dtype=np.float64)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv_tris = uv.reshape(-1, 2)[loops_idx.reshape(-1, 3)]
    nv = len(me.vertices)
    col = np.empty(nv * 4, dtype=np.float32)
    me.color_attributes['Col'].data.foreach_get('color', col)
    col = col.reshape(-1, 4)[:, :3]
    co = np.empty(nv * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    ao = np.empty(nv, dtype=np.float32)
    me.attributes['ao'].data.foreach_get('value', ao)
    kind = np.empty(nv, dtype=np.int32)
    me.attributes['kind'].data.foreach_get('value', kind)

    res = tex * SUPERSAMPLE
    pix, tri, bary = raster_uv_triangles(uv_tris, res)
    corner = verts.reshape(-1, 3)[tri]
    w = bary[..., None]
    linear = (col[corner] * w).sum(1)
    pos = (co[corner] * w).sum(1)
    # Worm space: Blender (x, y, z) is worm (x, z, -y)
    pw = np.stack([pos[:, 0], pos[:, 2], -pos[:, 1]], -1)
    texel_kind = kind[corner[:, 0]]
    shell_col, theta = shell_colours(pw, loops)
    linear = np.where((texel_kind == SHELL)[:, None], shell_col, linear)
    linear = chitin(linear, pw, texel_kind, theta)
    occlusion = (ao[corner] * bary).sum(1)
    linear = linear * (1 - AO_STRENGTH + AO_STRENGTH * occlusion)[:, None]

    out = np.zeros((res * res, 4), dtype=np.float32)
    # A byte image holds sRGB; `pixels` writes the stored values as they are
    out[pix, :3] = to_srgb(linear)
    filled = np.zeros(res * res, dtype=bool)
    filled[pix] = True
    out = dilate(out.reshape(res, res, 4), filled.reshape(res, res), MARGIN * SUPERSAMPLE)
    out[..., 3] = 1.0
    out = out.reshape(tex, SUPERSAMPLE, tex, SUPERSAMPLE, 4).mean((1, 3))
    name = f'{ob.name}_colour'
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    image = bpy.data.images.new(name, tex, tex, alpha=False)
    image.pixels.foreach_set(out.ravel())
    image.pack()

    mat = bpy.data.materials.new(f'{ob.name}_chitin')
    mat.use_nodes = True
    mat.use_backface_culling = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex_node = nt.nodes.new('ShaderNodeTexImage')
    tex_node.image = image
    nt.links.new(tex_node.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = ROUGHNESS
    me.materials.clear()
    me.materials.append(mat)


# ── Rig and clip ──

def rig(ob, b):
    """An armature with b's bones at their pivots, pointing up, the moving
    ones children of BODY, and `ob` skinned to it: every vertex on its bone
    with weight 1."""
    arm = bpy.data.armatures.new(ob.name + 'Rig')
    rig_ob = bpy.data.objects.new(ob.name + 'Rig', arm)
    bpy.context.scene.collection.objects.link(rig_ob)
    for o in bpy.context.scene.objects:
        o.select_set(o == rig_ob)
    bpy.context.scene.view_layers[0].objects.active = rig_ob
    with view3d_override(object=rig_ob, active_object=rig_ob):
        bpy.ops.object.mode_set(mode='EDIT')
        for name in b.bones:
            eb = arm.edit_bones.new(name)
            eb.head = P(*b.pivots[name])
            eb.tail = eb.head + UP * BONE_LENGTH
            if name != BODY:
                eb.parent = arm.edit_bones[BODY]
        bpy.ops.object.mode_set(mode='OBJECT')

    me = ob.data
    bones = np.empty(len(me.vertices), dtype=np.int32)
    me.attributes['bone'].data.foreach_get('value', bones)
    for i, name in enumerate(b.bones):
        ob.vertex_groups.new(name=name).add(np.nonzero(bones == i)[0].tolist(), 1.0, 'REPLACE')
    for attr in ('bone', 'kind', 'ao'):
        me.attributes.remove(me.attributes[attr])
    ob.parent = rig_ob
    ob.modifiers.new('Rig', 'ARMATURE').object = rig_ob
    return rig_ob


def animate(rig_ob, name, frame_count, pose):
    """One looping action `name` on the rig: `pose(bone, t)` (a rotation
    round the bone's pivot in worm axes, None for a bone that stays) at
    t = f / frame_count for the frames 0 .. frame_count, the last one the
    first again, at FPS, linear in between."""
    scene = bpy.context.scene
    scene.render.fps = FPS
    # One action per file: the exporter takes the rig's action by its name
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    edit = bpy.context.preferences.edit
    interpolation = edit.keyframe_new_interpolation_type
    edit.keyframe_new_interpolation_type = 'LINEAR'
    rig_ob.animation_data_create()
    for f in range(frame_count + 1):
        t = (f % frame_count) / frame_count
        for pb in rig_ob.pose.bones:
            q = pose(pb.name, t)
            if q is None:
                continue
            # Rest rotation to pose rotation: round the bone's head, so no translation
            rest = pb.bone.matrix_local.to_quaternion()
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = rest.inverted() @ q @ rest
            pb.keyframe_insert('rotation_quaternion', frame=f)
    edit.keyframe_new_interpolation_type = interpolation
    rig_ob.animation_data.action.name = name
    scene.frame_start = 0
    scene.frame_end = frame_count
    scene.frame_set(0)


def clear_scene():
    """This script's scene, emptied; other scenes stay as they are. Headless
    Blender has no window, the script then builds in the current scene."""
    win = bpy.context.window
    sc = (bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)) if win else bpy.context.scene
    for ob in list(sc.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(sc.collection.children):
        bpy.data.collections.remove(coll)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures, bpy.data.actions):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)
    if win:
        win.scene = sc
    return sc


def stats(ob, grounded):
    me = ob.data
    co = [v.co for v in me.vertices]
    tris = len(me.polygons)
    xs = [c.x for c in co]
    ys = [-c.y for c in co]
    zs = [c.z for c in co]
    print(f'[worm] {ob.name}: {tris} triangles, {len(me.vertices)} vertices, x {min(xs):.3f}..{max(xs):.3f}, '
          f'y {min(zs):.3f}..{max(zs):.3f}, z {min(ys):.3f}..{max(ys):.3f}')
    if grounded:
        assert abs(min(zs)) < 1e-4, 'feet off the ground'
    return tris


def export(ob, rig_ob, path):
    sc = bpy.context.scene
    for o in sc.objects:
        o.select_set(o in (ob, rig_ob))
    sc.view_layers[0].objects.active = rig_ob
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        use_active_scene=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_frame_range=False,
        export_skins=True,
        export_def_bones=False,
        export_morph=False,
        export_materials='EXPORT',
        export_image_format='JPEG',
        export_jpeg_quality=90,
        export_vertex_color='NONE',
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )
    print(f'[worm] wrote {path} ({os.path.getsize(path) / 1e3:.1f} kB)')


def preview(pieces, count):
    """A head, `count` segments and the tail along a bend, linked copies in
    the rest pose, for a look."""
    head, segment, tail = pieces
    heading = 0.0
    pos = Vector((0.0, 0.0))
    for i in range(count + 2):
        src = head if i == 0 else tail if i == count + 1 else segment
        ob = bpy.data.objects.new(f'preview_{i}', src.data)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = (pos.x + 4.0, -pos.y, 0.0)
        ob.rotation_euler = (0.0, 0.0, heading)
        heading += 0.12 * math.sin(i * 0.5)
        pos -= Vector((math.sin(-heading), math.cos(-heading))) * PITCH


def run(write=True, preview_count=0):
    clear_scene()
    segment, head, tail = build_segment(), build_head(), build_tail()
    for b in (segment, head, tail):
        prepare(b)
    # The neighbours in the chain shade each other where the rings overlap
    ambient_occlusion(segment, [(segment.bm, PITCH), (segment.bm, -PITCH)])
    ambient_occlusion(head, [(segment.bm, -PITCH)])
    ambient_occlusion(tail, [(segment.bm, PITCH)])

    models = (
        ('WormSegment', segment, SEGMENT_LOOPS, True, CRAWL, CRAWL_FRAMES, crawl_pose, 'worm_segment.glb'),
        # The head has no legs, it floats over its pivot like the segments' bodies
        ('WormHead', head, HEAD_LOOPS, False, JAWS, JAWS_FRAMES, jaws_pose, 'worm_head.glb'),
        ('WormTail', tail, TAIL_LOOPS, True, CRAWL, CRAWL_FRAMES, crawl_pose, 'worm_tail.glb'),
    )
    obs = {}
    for name, b, loops, grounded, clip, frame_count, pose, file in models:
        ob = to_object(b, name)
        stats(ob, grounded)
        unwrap(ob)
        bake_colours(ob, loops, TEX[name])
        rig_ob = rig(ob, b)
        animate(rig_ob, clip, frame_count, pose)
        if write:
            export(ob, rig_ob, os.path.join(OUT, file))
        obs[name] = ob
    if preview_count:
        preview((obs['WormHead'], obs['WormSegment'], obs['WormTail']), preview_count)
    return obs


if __name__ == '__main__':
    run()
