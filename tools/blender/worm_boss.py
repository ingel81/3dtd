"""Worm boss (giant millipede): public/assets/models/enemies/worm_head.glb and
worm_segment.glb.

Two static meshes, everything built here from bmesh, no inputs: dark brown to
black chitin with lighter rims, flanges and spike tips. The colours are set
per vertex while building and then baked into one base colour texture per
model (TEX, JPEG) on new UVs: the enemy renderer's static VAT path colours a
mesh by its texture or its material colour, not by vertex colours, so the
GLB carries the texture and no COLOR_0. The game strings the segments into a
chain and moves them; the models have no clips.

Worm space as in the game: x across, y up, z forward (the way the head
looks). Blender is z-up, so the worm point (x, y, z) lies at (x, -z, y); the
glTF exporter turns it back.

Both pivots lie on the ground (y = 0) under the middle of the piece's ring:
  segment  the ring spans z = SEG_REAR .. SEG_FRONT round the pivot; its
           rear rim is wider than its front, so a segment placed PITCH behind
           another slips its front under the other's rim (telescoping plates,
           overlap SEG_FRONT - PITCH - SEG_REAR). Chain spacing: PITCH.
  head     placed like a segment at the chain's front node: its collar rim
           covers the first segment at z = -PITCH the same way; the head
           capsule, mandibles and antennae reach forward to about z = 2.2.
The feet stand on y = 0.

Headless:
    blender --background --python tools/blender/worm_boss.py
From a running Blender (Blender MCP):
    REPO = r'D:/Source/3dtd'
    exec(open(REPO + '/tools/blender/worm_boss.py').read()); run()
`run(preview_count=12)` also lays a head and 12 segments along a bend (not
exported), to judge the chain.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

if 'REPO' not in globals():
    REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The UV rasteriser and the dilation of the enemy optimiser
sys.path.insert(0, os.path.join(REPO, 'tools/blender'))
from optimize_enemy import dilate, raster_uv_triangles, view3d_override  # noqa: E402

OUT_HEAD = os.path.join(REPO, 'public/assets/models/enemies/worm_head.glb')
OUT_SEGMENT = os.path.join(REPO, 'public/assets/models/enemies/worm_segment.glb')
SCENE = 'worm_boss'
TEX = 512
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
CHITIN = (0.017, 0.009, 0.005)
EDGE = (0.155, 0.072, 0.030)
VENTRAL = (0.061, 0.026, 0.011)
LEG = (0.050, 0.022, 0.010)
LEG_TIP = (0.010, 0.007, 0.005)
SPIKE_TIP = (0.300, 0.185, 0.090)
MANDIBLE_TIP = (0.220, 0.060, 0.013)
EYE = (0.190, 0.004, 0.002)
ROUGHNESS = 0.4


def P(x, y, z):
    """Blender point of the worm point (x, y, z)."""
    return Vector((x, -z, y))


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


class Builder:
    """A bmesh with a vertex colour per vertex."""

    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.verts.layers.float_color.new('Col')

    def vert(self, p, colour):
        v = self.bm.verts.new(P(*p))
        v[self.col] = (*colour, 1.0)
        return v

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
    c = math.cos(theta)
    col = lerp(CHITIN, EDGE, tone)
    col = lerp(col, EDGE, 0.55 * fw)
    if c > 0.98:
        col = lerp(col, EDGE, 0.35)
    if c < -0.2:
        col = lerp(col, VENTRAL, min(1.0, -c))
    return col


def shell(b, loops, sides, tip=None):
    """The body shell through `loops` (z, scale, lift, flange, tone), from the
    rear to the front, capped at the rear; at the front capped too, or closed
    to the point `tip` (z, lift)."""
    rings = []
    for z, s, lift, flange, tone in loops:
        ring = []
        for k in range(sides):
            theta = math.tau * k / sides
            x, y, fw = ring_point(theta, s, lift, flange)
            ring.append(b.vert((x, y, z), ring_colour(theta, tone, fw)))
        rings.append(ring)
    for a, c in zip(rings, rings[1:]):
        for k in range(sides):
            n = (k + 1) % sides
            b.face([a[k], a[n], c[n], c[k]])
    b.face(list(reversed(rings[0])))
    if tip is None:
        b.face(rings[-1])
    else:
        t = b.vert((0.0, AXIS_Y + tip[1], tip[0]), lerp(CHITIN, EDGE, 0.7))
        for k in range(sides):
            b.face([rings[-1][k], rings[-1][(k + 1) % sides], t])
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


def leg(b, side, z, dz):
    """A leg from the underside out and down to the ground, bent at the knee."""
    path = [(0.50, 0.52, z), (0.78, 0.63, z), (1.12, 0.82, z + dz * 0.3), (1.36, 0.40, z + dz * 0.7),
            (1.44, 0.0, z + dz)]
    radii = (0.085, 0.072, 0.06, 0.04, 0.0)
    colours = [lerp(LEG, LEG_TIP, t) for t in (0.0, 0.1, 0.3, 0.6, 1.0)]
    tube(b, [mirrored(p, side) for p in path], radii, colours, 5)


def finish(b, name):
    """The builder's mesh as an object: triangles, smooth with sharp edges
    over 50 degrees, outward normals."""
    bm = b.bm
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(50):
            e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build_segment():
    b = Builder()
    shell(b, SEGMENT_LOOPS, SEG_SIDES)
    for side in (1, -1):
        # Flange spike out to the side and back, a dorsal spike up and back
        spike(b, mirrored((0.88, 0.88, -0.06), side), mirrored((1.30, 1.08, -0.50), side), 0.11,
              bend=mirrored((0.04, 0.05, 0.0), side))
        spike(b, mirrored((0.33, 1.26, -0.08), side), mirrored((0.46, 1.78, -0.52), side), 0.10,
              bend=(0.0, 0.06, 0.04))
        for z, dz in ((0.22, 0.10), (-0.22, -0.10)):
            leg(b, side, z, dz)
    return finish(b, 'WormSegment')


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
        # Mandibles: flat curved blades from under the front, closing in
        path = [(0.33, 0.47, 0.95), (0.50, 0.44, 1.30), (0.46, 0.42, 1.62), (0.26, 0.41, 1.88), (0.07, 0.41, 1.98)]
        pts = catmull_rom([mirrored(p, side) for p in path], 11)
        n = len(pts)
        radii = [0.13 * (1 - (i / (n - 1)) ** 1.3) + 0.012 for i in range(n - 1)] + [0.0]
        colours = [lerp(lerp(CHITIN, EDGE, 0.2), MANDIBLE_TIP, (i / (n - 1)) ** 2) for i in range(n)]
        tube(b, pts, radii, colours, 8, flat=0.5)
        # Teeth on the inner edge
        for i in (3, 5, 7):
            p = pts[i]
            inward = Vector((-side, 0.0, 0.25)).normalized()
            spike(b, tuple(p), tuple(p + inward * (radii[i] + 0.1)), 0.045, sides=4, rings=())
        # Antennae: beaded, up, out and forward
        path = [(0.28, 0.98, 0.95), (0.42, 1.30, 1.25), (0.66, 1.52, 1.55), (0.92, 1.56, 1.90), (1.08, 1.45, 2.15)]
        pts = catmull_rom([mirrored(p, side) for p in path], 14)
        n = len(pts)
        radii = [(0.05 if i % 2 == 0 else 0.034) * (1 - 0.55 * i / (n - 1)) for i in range(n - 1)] + [0.0]
        colours = [lerp(LEG, SPIKE_TIP, (i / (n - 1)) ** 3) for i in range(n)]
        tube(b, pts, radii, colours, 5)
        # Eyes: a cluster of three above the mandibles
        for theta, z in ((0.95, 0.66), (1.12, 0.78), (0.82, 0.84)):
            centre = Vector(head_surface(theta * side, z, out=0.0))
            res = bmesh.ops.create_icosphere(b.bm, subdivisions=1, radius=0.075)
            for v in res['verts']:
                g = Vector((v.co.x, v.co.z, -v.co.y)) + centre
                v.co = P(*g)
                v[b.col] = (*EYE, 1.0)
        # Horns on the collar, swept back; flange spikes as on the segments
        spike(b, head_surface(0.7 * side, -0.05), mirrored((0.86, 2.02, -0.78), side), 0.16, sides=6,
              rings=(0.35, 0.7), bend=mirrored((0.05, 0.12, 0.05), side))
        spike(b, mirrored((0.95, 0.90, -0.10), side), mirrored((1.40, 1.12, -0.52), side), 0.12,
              bend=mirrored((0.04, 0.05, 0.0), side))
    return finish(b, 'WormHead')


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


def bake_colours(ob):
    """The vertex colours, interpolated over each triangle, into a TEX² image
    on the object's UVs (SUPERSAMPLE² samples a texel, islands grown by
    MARGIN texels), and a material that shows it."""
    me = ob.data
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    verts = np.empty(n * 3, dtype=np.int32)
    loops = np.empty(n * 3, dtype=np.int32)
    me.loop_triangles.foreach_get('vertices', verts)
    me.loop_triangles.foreach_get('loops', loops)
    uv = np.empty(len(me.loops) * 2, dtype=np.float64)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv_tris = uv.reshape(-1, 2)[loops.reshape(-1, 3)]
    col = np.empty(len(me.vertices) * 4, dtype=np.float32)
    me.color_attributes['Col'].data.foreach_get('color', col)
    col = col.reshape(-1, 4)[:, :3]

    res = TEX * SUPERSAMPLE
    pix, tri, bary = raster_uv_triangles(uv_tris, res)
    corner = col[verts.reshape(-1, 3)[tri]]
    linear = (corner * bary[..., None]).sum(1)
    out = np.zeros((res * res, 4), dtype=np.float32)
    # A byte image holds sRGB; `pixels` writes the stored values as they are
    out[pix, :3] = to_srgb(linear)
    filled = np.zeros(res * res, dtype=bool)
    filled[pix] = True
    out = dilate(out.reshape(res, res, 4), filled.reshape(res, res), MARGIN * SUPERSAMPLE)
    out[..., 3] = 1.0
    out = out.reshape(TEX, SUPERSAMPLE, TEX, SUPERSAMPLE, 4).mean((1, 3))
    name = f'{ob.name}_colour'
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    image = bpy.data.images.new(name, TEX, TEX, alpha=False)
    image.pixels.foreach_set(out.ravel())
    image.pack()

    mat = bpy.data.materials.new(f'{ob.name}_chitin')
    mat.use_nodes = True
    mat.use_backface_culling = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = ROUGHNESS
    me.materials.clear()
    me.materials.append(mat)


def clear_scene():
    """This script's scene, emptied; other scenes stay as they are. Headless
    Blender has no window, the script then builds in the current scene."""
    win = bpy.context.window
    sc = (bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)) if win else bpy.context.scene
    for ob in list(sc.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(sc.collection.children):
        bpy.data.collections.remove(coll)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
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


def export(ob, path):
    sc = bpy.context.scene
    for o in sc.objects:
        o.select_set(o == ob)
    sc.view_layers[0].objects.active = ob
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        use_active_scene=True,
        export_animations=False,
        export_skins=False,
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


def preview(head, segment, count):
    """A head and `count` segments along a bend, linked copies, for a look."""
    heading = 0.0
    pos = Vector((0.0, 0.0))
    for i in range(count + 1):
        ob = bpy.data.objects.new(f'preview_{i}', (head if i == 0 else segment).data)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = (pos.x + 4.0, -pos.y, 0.0)
        ob.rotation_euler = (0.0, 0.0, heading)
        heading += 0.12 * math.sin(i * 0.5)
        pos -= Vector((math.sin(-heading), math.cos(-heading))) * PITCH


def run(write=True, preview_count=0):
    clear_scene()
    segment = build_segment()
    head = build_head()
    stats(segment, grounded=True)
    # The head has no legs, it floats over its pivot like the segments' bodies
    stats(head, grounded=False)
    for ob in (segment, head):
        unwrap(ob)
        bake_colours(ob)
    if write:
        export(segment, OUT_SEGMENT)
        export(head, OUT_HEAD)
    if preview_count:
        preview(head, segment, preview_count)
    return head, segment


if __name__ == '__main__':
    run()
